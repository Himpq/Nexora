"""
Nexora.app.Observability — 可观测性

承载通知、服务监控与测试：
- notification.py: 用户通知
- service_status_monitor.py: 服务状态监控（ServiceStatusMonitor）
- testapi.py: 服务健康测试（create_testapi_blueprint）

对外提供：
- ServiceStatusMonitor / create_testapi_blueprint / 通知 API
"""
from .notification import (
    configure_notification_realtime,
    create_announcement_notification,
    create_notification,
    create_user_notification,
    list_notifications,
    mark_notification_read,
    notification_bp,
    remove_notification,
)
from .service_status_monitor import ServiceStatusMonitor
from .testapi import create_testapi_blueprint

__all__ = [n for n in globals() if not n.startswith('_')]
