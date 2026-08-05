import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional


@dataclass(frozen=True)
class IPSendLimitConfig:
    enabled: bool
    max_messages: int
    window_seconds: int
    cooldown_seconds: int
    report_threshold_percent: int
    report_recipient: str
    recent_subject_count: int

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any]) -> "IPSendLimitConfig":
        """Validate the canonical ip_send_limit configuration."""
        enabled = values.get("enabled", False)

        if not isinstance(enabled, bool):
            raise ValueError("smtp_services.settings.ip_send_limit.enabled must be boolean")

        if not enabled:
            return cls(
                enabled=False,
                max_messages=0,
                window_seconds=0,
                cooldown_seconds=0,
                report_threshold_percent=0,
                report_recipient="",
                recent_subject_count=0,
            )

        required_integer_fields = (
            "max_messages",
            "window_seconds",
            "cooldown_seconds",
            "report_threshold_percent",
            "recent_subject_count",
        )
        parsed: Dict[str, int] = {}

        for field_name in required_integer_fields:
            value = values.get(field_name)

            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(
                    f"smtp_services.settings.ip_send_limit.{field_name} must be an integer"
                )

            parsed[field_name] = value

        if parsed["max_messages"] < 1:
            raise ValueError("ip_send_limit.max_messages must be at least 1")

        if parsed["window_seconds"] < 1:
            raise ValueError("ip_send_limit.window_seconds must be at least 1")

        if parsed["cooldown_seconds"] < 1:
            raise ValueError("ip_send_limit.cooldown_seconds must be at least 1")

        if not 0 < parsed["report_threshold_percent"] < 100:
            raise ValueError("ip_send_limit.report_threshold_percent must be between 1 and 99")

        if parsed["recent_subject_count"] < 1:
            raise ValueError("ip_send_limit.recent_subject_count must be at least 1")

        report_recipient = values.get("report_recipient")

        if (
            not isinstance(report_recipient, str)
            or not re.fullmatch(r"[^@\s]+@[^@\s]+", report_recipient.strip())
        ):
            raise ValueError("ip_send_limit.report_recipient must be a complete email address")

        return cls(
            enabled=True,
            max_messages=parsed["max_messages"],
            window_seconds=parsed["window_seconds"],
            cooldown_seconds=parsed["cooldown_seconds"],
            report_threshold_percent=parsed["report_threshold_percent"],
            report_recipient=report_recipient.strip(),
            recent_subject_count=parsed["recent_subject_count"],
        )


@dataclass(frozen=True)
class IPSendLimitReport:
    ip: str
    message_count: int
    max_messages: int
    window_started_at: int
    observed_at: int
    report_recipient: str
    recent_subjects: List[str]


@dataclass(frozen=True)
class IPSendLimitDecision:
    allowed: bool
    enabled: bool
    message_count: int = 0
    max_messages: int = 0
    retry_after_seconds: int = 0
    cooldown_until: int = 0
    report: Optional[IPSendLimitReport] = None


@dataclass
class _IPSendState:
    window_started_at: int
    message_count: int = 0
    cooldown_until: int = 0
    report_pending: bool = False
    report_sent: bool = False
    recent_subjects: List[str] = field(default_factory=list)


class IPSendLimiter:
    """Thread-safe per-IP SMTP message quota and cooldown tracker."""

    def __init__(
        self,
        config: IPSendLimitConfig,
        clock: Callable[[], float] = time.time,
    ):
        self._config = config
        self._clock = clock
        self._lock = threading.Lock()
        self._states: Dict[str, _IPSendState] = {}
        self._last_cleanup_at = 0

    @property
    def config(self) -> IPSendLimitConfig:
        return self._config

    def reserve(self, ip: str) -> IPSendLimitDecision:
        """Atomically consume one message slot before SMTP accepts DATA."""
        if not self._config.enabled:
            return IPSendLimitDecision(allowed=True, enabled=False)

        if not ip:
            raise ValueError("IP send limiting requires a non-empty peer IP")

        now = int(self._clock())

        with self._lock:
            self._cleanup_expired_states(now)
            state = self._states.get(ip)

            if state and state.cooldown_until > now:
                retry_after = max(1, state.cooldown_until - now)

                return IPSendLimitDecision(
                    allowed=False,
                    enabled=True,
                    message_count=state.message_count,
                    max_messages=self._config.max_messages,
                    retry_after_seconds=retry_after,
                    cooldown_until=state.cooldown_until,
                )

            if state and (
                state.cooldown_until > 0
                or now - state.window_started_at >= self._config.window_seconds
            ):
                state = None
                self._states.pop(ip, None)

            if state is None:
                state = _IPSendState(window_started_at=now)
                self._states[ip] = state

            state.message_count += 1

            if state.message_count == self._config.max_messages:
                state.cooldown_until = now + self._config.cooldown_seconds

            report = self._build_report_if_due(ip, state, now)

            return IPSendLimitDecision(
                allowed=True,
                enabled=True,
                message_count=state.message_count,
                max_messages=self._config.max_messages,
                retry_after_seconds=(
                    self._config.cooldown_seconds
                    if state.cooldown_until > now
                    else 0
                ),
                cooldown_until=state.cooldown_until,
                report=report,
            )

    def _cleanup_expired_states(self, now: int) -> None:
        cleanup_interval = min(60, self._config.window_seconds)

        if now - self._last_cleanup_at < cleanup_interval:
            return

        expired_ips = [
            tracked_ip
            for tracked_ip, state in self._states.items()
            if (
                0 < state.cooldown_until <= now
                or (
                    state.cooldown_until == 0
                    and now - state.window_started_at >= self._config.window_seconds
                )
            )
        ]

        for tracked_ip in expired_ips:
            self._states.pop(tracked_ip, None)

        self._last_cleanup_at = now

    def _build_report_if_due(
        self,
        ip: str,
        state: _IPSendState,
        now: int,
    ) -> Optional[IPSendLimitReport]:
        threshold = self._config.max_messages * self._config.report_threshold_percent / 100

        if state.message_count <= threshold or state.report_pending or state.report_sent:
            return None

        state.report_pending = True

        return IPSendLimitReport(
            ip=ip,
            message_count=state.message_count,
            max_messages=self._config.max_messages,
            window_started_at=state.window_started_at,
            observed_at=now,
            report_recipient=self._config.report_recipient,
            recent_subjects=list(state.recent_subjects),
        )

    def complete_report(self, report: IPSendLimitReport, sent: bool) -> None:
        """Commit or release a report reservation for the matching quota window."""
        with self._lock:
            state = self._states.get(report.ip)

            if not state or state.window_started_at != report.window_started_at:
                return

            state.report_pending = False

            if sent:
                state.report_sent = True

    def record_subject(self, ip: str, subject: str) -> None:
        """Store a sanitized completed-message subject for future reports."""
        if not self._config.enabled:
            return

        normalized = " ".join(str(subject or "(no subject)").split())[:200]

        with self._lock:
            state = self._states.get(ip)

            if not state:
                return

            state.recent_subjects.append(normalized)
            state.recent_subjects = state.recent_subjects[-self._config.recent_subject_count:]

    def clear_all(self) -> None:
        with self._lock:
            self._states.clear()


_limiter = IPSendLimiter(IPSendLimitConfig.from_mapping({"enabled": False}))
_logger = None


def init(logger: Any, settings: Mapping[str, Any]) -> None:
    """Initialize the process-wide limiter from canonical SMTP settings."""
    global _limiter, _logger

    config = IPSendLimitConfig.from_mapping(settings)
    _limiter = IPSendLimiter(config)
    _logger = logger

    if _logger:
        _logger.write(
            "[IPSendLimiter] initialized "
            f"(enabled={config.enabled}, max_messages={config.max_messages}, "
            f"window_seconds={config.window_seconds}, cooldown_seconds={config.cooldown_seconds})"
        )


def reserve(ip: str) -> IPSendLimitDecision:
    return _limiter.reserve(ip)


def complete_report(report: IPSendLimitReport, sent: bool) -> None:
    _limiter.complete_report(report, sent)


def record_subject(ip: str, subject: str) -> None:
    _limiter.record_subject(ip, subject)


def clear_all() -> None:
    _limiter.clear_all()
