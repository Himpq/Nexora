"""
系统托盘（pystray）
"""

import sys
from pathlib import Path
from core.config import get_app_root

def run_tray():
    try:
        import pystray
        from PIL import Image
    except ImportError:
        print("[Tray] pystray/Pillow not installed, tray disabled.")
        return

    icon_path = get_app_root() / "assets" / "icon.png"
    if not icon_path.exists() and getattr(sys, 'frozen', False):
        # Fallback for local testing without bundled assets
        fallback = get_app_root().parents[2] / "ChatDBServer" / "static" / "img" / "icon.png"
        if fallback.exists():
            icon_path = fallback

    if not getattr(sys, 'frozen', False) and not icon_path.exists():
        fallback_dev = get_app_root().parent / "ChatDBServer" / "static" / "img" / "icon.png"
        if fallback_dev.exists():
            icon_path = fallback_dev

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
