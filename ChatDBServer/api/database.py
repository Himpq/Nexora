"""
database.py — 兼容层

用户实体（User 类）与相关常量已迁移至 Nexora.basis.User。
本文件保留为 re-export，供既有 `from database import User` 引用平滑过渡。
"""
from basis.User import (
    BASIS,
    SHORT_TIME,
    USER_PROFILE_DEFAULT_TEMPLATE,
    USER_PROFILE_MAX_CHARS,
    User,
)

__all__ = [
    "BASIS",
    "SHORT_TIME",
    "USER_PROFILE_DEFAULT_TEMPLATE",
    "USER_PROFILE_MAX_CHARS",
    "User",
]
