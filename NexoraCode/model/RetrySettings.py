"""共享的模型自动重试次数配置与校验。"""

MAX_AUTO_RETRY_COUNT = 10
DEFAULT_ERROR_RETRY_COUNT = 5
DEFAULT_EMPTY_RESPONSE_RETRY_COUNT = 2


def normalize_retry_count(value: object) -> int:
    """校验重试次数为 0 到 10 的整数。"""
    if isinstance(value, bool):
        raise ValueError("重试次数必须是 0 到 10 的整数")

    if isinstance(value, int):
        retry_count = value
    elif isinstance(value, str) and value.strip().isdecimal():
        retry_count = int(value.strip())
    else:
        raise ValueError("重试次数必须是 0 到 10 的整数")

    if not 0 <= retry_count <= MAX_AUTO_RETRY_COUNT:
        raise ValueError("重试次数必须是 0 到 10 的整数")

    return retry_count


def configured_retry_count(settings: object, key: str, default: int) -> int:
    """读取并校验本地重试配置；缺少新配置时使用指定默认值。"""
    if not hasattr(settings, "get"):
        raise TypeError("设置存储不支持读取配置")

    value = settings.get(key, default)
    return normalize_retry_count(value)
