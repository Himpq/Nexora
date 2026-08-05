import concurrent.futures
import unittest

from NexoraMail.core.IPSendLimiter import IPSendLimitConfig, IPSendLimiter


class FakeClock:
    def __init__(self, current=1_000):
        self.current = current

    def __call__(self):
        return self.current

    def advance(self, seconds):
        self.current += seconds


def make_config(**overrides):
    values = {
        "enabled": True,
        "max_messages": 10,
        "window_seconds": 3600,
        "cooldown_seconds": 3600,
        "report_threshold_percent": 50,
        "report_recipient": "himpq@himpqblog.cn",
        "recent_subject_count": 5,
    }
    values.update(overrides)
    return IPSendLimitConfig.from_mapping(values)


class IPSendLimiterTests(unittest.TestCase):
    """Exercise quota, cooldown, warning, and concurrency semantics."""

    def setUp(self):
        self.clock = FakeClock()
        self.limiter = IPSendLimiter(make_config(), clock=self.clock)

    def test_sixth_message_reports_previous_five_subjects_once(self):
        for index in range(1, 6):
            decision = self.limiter.reserve("203.0.113.10")
            self.assertIsNone(decision.report)
            self.limiter.record_subject("203.0.113.10", f"Subject {index}")

        warning_decision = self.limiter.reserve("203.0.113.10")

        self.assertIsNotNone(warning_decision.report)
        self.assertEqual(warning_decision.message_count, 6)
        self.assertEqual(
            warning_decision.report.recent_subjects,
            [f"Subject {index}" for index in range(1, 6)],
        )

        self.limiter.complete_report(warning_decision.report, sent=True)
        self.limiter.record_subject("203.0.113.10", "Subject 6")

        self.assertIsNone(self.limiter.reserve("203.0.113.10").report)

    def test_failed_report_is_retried_on_next_submission(self):
        for index in range(1, 7):
            decision = self.limiter.reserve("203.0.113.10")
            self.limiter.record_subject("203.0.113.10", f"Subject {index}")

        first_report = decision.report
        self.assertIsNotNone(first_report)
        self.limiter.complete_report(first_report, sent=False)

        retry_decision = self.limiter.reserve("203.0.113.10")

        self.assertIsNotNone(retry_decision.report)
        self.assertEqual(retry_decision.message_count, 7)

    def test_tenth_message_starts_one_hour_cooldown(self):
        decisions = [self.limiter.reserve("203.0.113.10") for _ in range(10)]

        self.assertTrue(all(decision.allowed for decision in decisions))
        self.assertEqual(decisions[-1].cooldown_until, 4_600)

        blocked = self.limiter.reserve("203.0.113.10")

        self.assertFalse(blocked.allowed)
        self.assertEqual(blocked.retry_after_seconds, 3600)

        self.clock.advance(3600)
        reset = self.limiter.reserve("203.0.113.10")

        self.assertTrue(reset.allowed)
        self.assertEqual(reset.message_count, 1)

    def test_incomplete_window_resets_after_one_hour(self):
        self.limiter.reserve("203.0.113.10")
        self.limiter.reserve("203.0.113.10")
        self.clock.advance(3600)

        reset = self.limiter.reserve("203.0.113.10")

        self.assertEqual(reset.message_count, 1)

    def test_concurrent_reservations_never_exceed_quota(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            decisions = list(
                executor.map(lambda _: self.limiter.reserve("203.0.113.10"), range(20))
            )

        allowed = [decision for decision in decisions if decision.allowed]
        blocked = [decision for decision in decisions if not decision.allowed]

        self.assertEqual(len(allowed), 10)
        self.assertEqual(len(blocked), 10)
        self.assertEqual(max(decision.message_count for decision in allowed), 10)

    def test_enabled_configuration_requires_report_recipient(self):
        with self.assertRaisesRegex(ValueError, "report_recipient"):
            make_config(report_recipient="")

        with self.assertRaisesRegex(ValueError, "report_recipient"):
            make_config(report_recipient="admin@example.com\r\nBcc: attacker@example.com")


if __name__ == "__main__":
    unittest.main()
