"""
进程级服务健康监控单例。

单例由 server.py 组装期通过 install_service_status_monitor() 注入依赖后创建，
全进程共享。依赖以参数注入而非本模块内构造，是因为配置访问函数（含迁移钩子）
与历史文件路径都定义在 server 组装层。
"""

from App.Observability import ServiceStatusMonitor

_service_monitor = None


def install_service_status_monitor(get_config_all, history_path):
    """
    组装进程级监控单例（仅允许 server 组装期调用一次）。

    get_config_all: 配置访问函数（含迁移钩子的 server 侧包装）
    history_path:   服务状态历史文件路径
    """
    global _service_monitor

    if _service_monitor is not None:
        raise RuntimeError('service status monitor already installed')

    _service_monitor = ServiceStatusMonitor(
        get_config_all,
        history_path,
        interval_seconds=60,
    )


def get_service_status_monitor():
    """返回进程级监控单例（装配前调用视为组装顺序错误）。"""
    if _service_monitor is None:
        raise RuntimeError('service status monitor not installed')

    return _service_monitor


def start_service_status_monitor():
    """启动监控线程。ServiceStatusMonitor.start() 内部自检线程存活，可安全重复调用。"""
    get_service_status_monitor().start()
