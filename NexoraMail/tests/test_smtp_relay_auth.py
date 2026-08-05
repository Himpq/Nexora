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


if __name__ == "__main__":
    unittest.main()
