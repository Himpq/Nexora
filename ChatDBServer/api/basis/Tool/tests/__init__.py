import os
import sys


# 确保从 ChatDBServer/api 运行 unittest 时可加载 legacy 顶层模块。
_here = os.path.dirname(__file__)
_server_dir = os.path.abspath(os.path.join(_here, "..", "..", "..", ".."))
_api_dir = os.path.join(_server_dir, "api")

for _path in (_server_dir, _api_dir):
    if _path not in sys.path:
        sys.path.insert(0, _path)
