"""
Nexora.App.Mail — NexoraMail 服务客户端与用户邮箱路由

mailbox.py 承载：服务配置读取、HTTP 调用客户端、用户级邮件缓存、
绑定解析与 /api/mail/me/* 路由（自 server.py 分批迁移）。

实时事件推送与浏览器 WS 通道属于 server 组装层，经 configure_mail_client()
注入本包；本包不反向 import server。
"""

from .mailbox import (
    _get_nexora_mail_config,
    _mail_cache_invalidate_all_users,
    _mail_cache_invalidate_user,
    configure_mail_client,
    mail_bp,
)
