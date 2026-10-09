"""
系统托盘（pystray）
"""

import sys
from pathlib import Path
from core.config import get_app_root, get_bundle_root

def run_tray():
    try:
        import pystray
        from PIL import Image
    except ImportError:
        print("[Tray] pystray/Pillow not installed, tray disabled.")
        return

    # 图标随包分发，位于 bundle 内的 ui/static/img/；
    # 不再用 assets/ 及跨项目 ChatDBServer 回退路径。
    icon_path = get_bundle_root() / "ui" / "static" / "img" / "icon.png"

    if icon_path.exists():
        image = Image.open(icon_path)
    else:
        # 无图标时生成一个简单的占位图
        image = Image.new("RGB", (64, 64), color=(30, 120, 200))

    def on_quit(icon, _):
        icon.stop()
        import os, signal
        os.kill(os.getpid(), signal.SIGTERM)

    tray = pystray.Icon(
        "NexoraCode",
        image,
        "NexoraCode",
        menu=pystray.Menu(
            pystray.MenuItem("NexoraCode", lambda: None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", on_quit),
        ),
    )
    tray.run()
