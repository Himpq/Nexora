"""
Nexora.app.utils.coerce — 基础类型归一化工具

纯标准库依赖，被应用层与基础层各模块复用。
"""


def as_bool(value, default=False):
    """
    将请求参数等宽松布尔值归一化为 bool。

    字符串按常见开关字面量解析；None 视为未提供，返回 default；
    其余对象按真值转换。
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "y", "on"}:
            return True
        if v in {"0", "false", "no", "n", "off"}:
            return False
    if value is None:
        return default
    return bool(value)
