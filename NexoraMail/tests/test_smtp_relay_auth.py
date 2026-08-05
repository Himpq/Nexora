import unittest

from NexoraMail.core import ErrorService, SMTPService


class RecordingLogger:
    def __init__(self):
        self.messages = []

    def write(self, message):
        self.messages.append(message)


class RecordingConnection:
    def __init__(self):
        self.responses = []

    def sendall(self, payload):
        self.responses.append(payload)


class ExternalRecipientGroup:
    groupname = "default"

    def getDomain(self, address):
        return address.split("@", 1)[1]

    def getDomains(self):
        return ["local.test"]

    def isIn(self, address):
        return False


class SMTPRelayAuthenticationTests(unittest.TestCase):
    """Verify that encrypted SMTP sessions still require relay authentication."""

    def setUp(self):
        self.original_conf = SMTPService.conf
        SMTPService.conf = {
            "SMTPServices": {
                "MailRelay": {"enable": True},
                "settings": {"maxRecipients": 5},
            }
        }
        self.logger = RecordingLogger()
        self.connection = RecordingConnection()
        self.user_group = ExternalRecipientGroup()

    def tearDown(self):
        SMTPService.conf = self.original_conf
        SMTPService.IPSendLimiter.init(None, {"enabled": False})

    def make_state(self, *, using_tls, authenticated):
        state = SMTPService.SessionState(
            peer="203.0.113.10",
            listen_port=465,
            port_label="465",
            logger=self.logger,
            max_errors=5,
            block_seconds=60,
            using_tls=using_tls,
            authenticated=authenticated,
            mail_from="sender@local.test",
        )

        if authenticated:
            state.user = {"username": "sender"}

        return state

    def test_tls_session_without_authentication_cannot_relay(self):
        state = self.make_state(using_tls=True, authenticated=False)

        with self.assertRaises(ErrorService.SMTPAuthError) as raised:
            SMTPService.handle_rcpt_to(
                self.connection,
                ["RCPT", "TO:<recipient@external.test>"],
                state,
                self.user_group,
            )

        self.assertEqual(raised.exception.code, "530")
        self.assertIn("tls=True, authenticated=False", raised.exception.log_message)
        self.assertEqual(state.rcpt_list, [])
        self.assertNotIn("mail_relay", state.attributes)

    def test_authenticated_tls_session_can_enter_relay_route(self):
        state = self.make_state(using_tls=True, authenticated=True)

        SMTPService.handle_rcpt_to(
            self.connection,
            ["RCPT", "TO:<recipient@external.test>"],
            state,
            self.user_group,
        )

        self.assertEqual(state.rcpt_list, ["recipient@external.test"])
        self.assertEqual(state.attributes["mail_relay"], "relay")
        self.assertEqual(self.connection.responses, [b"250 Recipient ok\r\n"])

    def test_data_is_rejected_while_ip_is_cooling_down(self):
        SMTPService.IPSendLimiter.init(None, {
            "enabled": True,
            "max_messages": 1,
            "window_seconds": 3600,
            "cooldown_seconds": 3600,
            "report_threshold_percent": 50,
            "report_recipient": "admin@local.test",
            "recent_subject_count": 5,
        })
        SMTPService.IPSendLimiter.reserve("203.0.113.10")
        state = self.make_state(using_tls=True, authenticated=True)
        state.rcpt_list.append("recipient@external.test")

        with self.assertRaises(ErrorService.SMTPTransientError) as raised:
            SMTPService.handle_data(self.connection, state, self.user_group)

        self.assertEqual(raised.exception.code, "451")
        self.assertFalse(raised.exception.count_error)
        self.assertIn("retry after", raised.exception.message)

    def test_ip_limit_report_contains_recent_subjects(self):
        report = SMTPService.IPSendLimiter.IPSendLimitReport(
            ip="203.0.113.10",
            message_count=6,
            max_messages=10,
            window_started_at=1_750_000_000,
            observed_at=1_750_000_300,
            report_recipient="himpq@himpqblog.cn",
            recent_subjects=["First message", "Second message"],
        )
        captured = {}
        original_send_mail = SMTPService.sendMail
        original_loginfo = SMTPService.loginfo

        class LocalAdminGroup:
            def isIn(self, address):
                return address == "himpq@himpqblog.cn"

        def record_send(sender, recipient, data, session, user_group, suppressError=False):
            captured.update({
                "sender": sender,
                "recipient": recipient,
                "data": data,
                "session": session,
                "suppress_error": suppressError,
            })
            return True, []

        try:
            SMTPService.sendMail = record_send
            SMTPService.loginfo = self.logger

            sent = SMTPService.sendIPLimitReport(report, LocalAdminGroup())
        finally:
            SMTPService.sendMail = original_send_mail
            SMTPService.loginfo = original_loginfo

        self.assertTrue(sent)
        self.assertEqual(captured["recipient"], "himpq@himpqblog.cn")
        self.assertIsNone(captured["session"])
        self.assertTrue(captured["suppress_error"])
        self.assertIn("Current usage: 6/10", captured["data"])
        self.assertIn("1. First message", captured["data"])
        self.assertIn("2. Second message", captured["data"])


if __name__ == "__main__":
    unittest.main()
