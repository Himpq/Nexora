"""
进程级运行时单例包。

server.py 在组装期把进程级对象装配进本包；路由迁移到各域模块后，
需要访问这些单例时从本包导入，严禁 import server（会造成循环依赖）。
"""

from .service_monitor import (
    get_service_status_monitor,
    install_service_status_monitor,
    start_service_status_monitor,
)
