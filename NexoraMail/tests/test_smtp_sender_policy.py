"""Tests for the SMTP sender-ownership policy and TLS-required AUTH.

Covers the two fixes:
  1. handle_mail_from enforces sender ownership:
       - authenticated sessions must send as themselves
       - unauthenticated (inbound) sessions may NOT claim a local domain
       - ordinary external inbound mail is still accepted
  2. handle_auth refuses to run without TLS (538), while never affecting
     inbound mail delivery (which does not use AUTH at all).
"""

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


class FakeUserGroup:
    groupname = "default"

    def __init__(self, domains=("local.test",)):
        self._domains = list(domains)

    def getDomain(self, address):
        return address.split("@", 1)[1]

    def getDomains(self):
        return list(self._domains)

    def isIn(self, address):
        try:
            return address.split("@", 1)[1] in self._domains
        except Exception:
            return False


class SenderPolicyTests(unittest.TestCase):
    def setUp(self):
        self.original_conf = SMTPService.conf
        SMTPService.conf = {
            "SMTPServices": {
                "settings": {
                    "sender_policy": {
                        "enabled": True,
                        "reject_unauthenticated_local_sender": True,
                        "auth_user_allow_domains": [],
                    }
                }
            }
        }
        self.logger = RecordingLogger()
        self.connection = RecordingConnection()
        self.user_group = FakeUserGroup()

    def tearDown(self):
        SMTPService.conf = self.original_conf

    def make_state(self, *, authenticated=False, username=None):
        state = SMTPService.SessionState(
            peer="203.0.113.10",
            listen_port=25,
            port_label="25",
            logger=self.logger,
            max_errors=5,
            block_seconds=60,
        )
        state.authenticated = authenticated
        if username:
            state.user = {"username": username, "password": "x"}
        return state

    def run_mail_from(self, address, state):
        cmds = ["MAIL", "FROM:<%s>" % address]
        SMTPService.handle_mail_from(self.connection, cmds, state, self.user_group)

    # --- unauthenticated (inbound) -----------------------------------------

    def test_external_inbound_mail_is_accepted(self):
        """A normal external sender must NOT be blocked (core requirement)."""
        state = self.make_state(authenticated=False)
        self.run_mail_from("someone@gmail.com", state)
        self.assertEqual(state.mail_from, "someone@gmail.com")

    def test_unauthenticated_local_domain_is_rejected(self):
        """Spoofing our own domain without auth must be rejected."""
        state = self.make_state(authenticated=False)
        with self.assertRaises(ErrorService.SMTPInvalidCommand) as ctx:
            self.run_mail_from("admin@local.test", state)
        self.assertEqual(ctx.exception.code, "550")

    # --- authenticated ------------------------------------------------------

    def test_authenticated_user_can_send_as_self(self):
        state = self.make_state(authenticated=True, username="bob@local.test")
        self.run_mail_from("bob@local.test", state)
        self.assertEqual(state.mail_from, "bob@local.test")

    def test_authenticated_user_cannot_impersonate_another_local_user(self):
        state = self.make_state(authenticated=True, username="bob@local.test")
        with self.assertRaises(ErrorService.SMTPInvalidCommand) as ctx:
            self.run_mail_from("admin@local.test", state)
        self.assertEqual(ctx.exception.code, "550")

    # --- tracing ------------------------------------------------------------

    def test_peer_ip_is_recorded_without_rewriting_envelope(self):
        state = self.make_state(authenticated=False)
        self.run_mail_from("someone@gmail.com", state)
        self.assertEqual(state.attributes.get("peer_ip"), "203.0.113.10")
        self.assertEqual(state.mail_from, "someone@gmail.com")

    # --- policy can be disabled --------------------------------------------

    def test_policy_can_be_disabled(self):
        SMTPService.conf["SMTPServices"]["settings"]["sender_policy"]["enabled"] = False
        state = self.make_state(authenticated=False)
        self.run_mail_from("admin@local.test", state)
        self.assertEqual(state.mail_from, "admin@local.test")


class AuthRequiresTLSTests(unittest.TestCase):
    def setUp(self):
        self.original_conf = SMTPService.conf
        SMTPService.conf = {"SMTPServices": {"settings": {"require_tls_for_auth": True}}}
        self.logger = RecordingLogger()
        self.connection = RecordingConnection()
        self.user_group = FakeUserGroup()

    def tearDown(self):
        SMTPService.conf = self.original_conf

    def make_state(self, *, using_tls):
        state = SMTPService.SessionState(
            peer="203.0.113.10",
            listen_port=25,
            port_label="25",
            logger=self.logger,
            max_errors=5,
            block_seconds=60,
            using_tls=using_tls,
        )
        return state

    def test_auth_without_tls_is_rejected(self):
        state = self.make_state(using_tls=False)
        with self.assertRaises(ErrorService.SMTPAuthError) as ctx:
            SMTPService.handle_auth(
                self.connection, None, ["AUTH", "LOGIN"], state, self.user_group
            )
        self.assertEqual(ctx.exception.code, "538")

    def test_auth_with_tls_proceeds(self):
        """With TLS the TLS gate passes; it must not raise the 538 error."""
        state = self.make_state(using_tls=True)
        try:
            SMTPService.handle_auth(
                self.connection, None, ["AUTH", "BOGUS"], state, self.user_group
            )
        except ErrorService.SMTPAuthError as exc:
            self.fail("TLS session wrongly rejected with 538: %s" % exc)
        except ErrorService.SMTPInvalidCommand:
            # Expected: unsupported mechanism, i.e. we got past the TLS gate.
            pass

    def test_gate_can_be_disabled_for_legacy_clients(self):
        SMTPService.conf["SMTPServices"]["settings"]["require_tls_for_auth"] = False
        state = self.make_state(using_tls=False)
        try:
            SMTPService.handle_auth(
                self.connection, None, ["AUTH", "BOGUS"], state, self.user_group
            )
        except ErrorService.SMTPAuthError as exc:
            self.fail("Gate should be disabled but got 538: %s" % exc)
        except ErrorService.SMTPInvalidCommand:
            pass


if __name__ == "__main__":
    unittest.main()
