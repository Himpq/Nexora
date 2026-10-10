"""Thinking protocol selection for OpenAI-compatible providers."""


SUPPORTED_THINKING_PROTOCOLS = frozenset({
    "none",
    "deepseek",
    "dashscope",
    "ollama",
})


def normalize_thinking_protocol(value):
    """Validate a provider's explicitly selected Thinking request protocol."""
    if value is None:
        return "none"

    protocol = str(value).strip().lower()

    if not protocol:
        return "none"

    if protocol not in SUPPORTED_THINKING_PROTOCOLS:
        raise ValueError(f"Unsupported Thinking protocol: {protocol}")

    return protocol


def apply_thinking_protocol(payload, protocol, enabled):
    """Write the selected provider's on/off field into a Chat Completions body."""
    protocol = normalize_thinking_protocol(protocol)

    if protocol == "none":
        return

    if protocol == "deepseek":
        payload["thinking"] = {"type": "enabled" if enabled else "disabled"}

    elif protocol == "dashscope":
        payload["enable_thinking"] = bool(enabled)

    elif protocol == "ollama":
        payload["think"] = bool(enabled)
