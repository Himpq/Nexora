import os, sys
# Ensure unittest discover works without manual PYTHONPATH
# Add ChatDBServer and ChatDBServer/api to sys.path
_here = os.path.dirname(__file__)
# tests -> Conversation -> basis -> api -> ChatDBServer
_server_dir = os.path.abspath(os.path.join(_here, "..", "..", "..", ".."))
_api_dir = os.path.join(_server_dir, "api")
for _p in (_server_dir, _api_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)
# Ensure cwd is server dir for repository path resolution
try:
    os.chdir(_server_dir)
except Exception:
    pass
