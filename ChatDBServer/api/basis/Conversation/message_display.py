"""Scoped presentation overrides for messages persisted by background flows."""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator


_persisted_user_message_display = ContextVar(
    "persisted_user_message_display",
    default=None,
)


@contextmanager
def persisted_user_message_display(content: str) -> Iterator[None]:
    """Persist a safe display label while keeping the original model input intact."""
    display_content = str(content or "").strip()

    if not display_content:
        yield
        return

    token = _persisted_user_message_display.set(display_content)

    try:
        yield
    finally:
        _persisted_user_message_display.reset(token)


def get_persisted_user_message_display() -> str | None:
    """Return the active persisted-message display override, if one exists."""
    return _persisted_user_message_display.get()
