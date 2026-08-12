import threading
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional


@dataclass
class AppContext:
    log: Optional[Any] = None
    config: Optional[Dict[str, Any]] = field(default_factory=dict)

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _user_groups: Dict[str, Any] = field(default_factory=dict)

    def get_config(self, *keys, default=None):
        with self._lock:
            node = self.config
            for key in keys:
                if isinstance(node, dict) and key in node:
                    node = node[key]
                else:
                    return default
            return node

    def set_config(self, value, *keys):
        with self._lock:
            if not keys:
                return
            node = self.config
            for key in keys[:-1]:
                if key not in node or not isinstance(node[key], dict):
                    node[key] = {}
                node = node[key]
            node[keys[-1]] = value


_context = AppContext()


def get_context() -> AppContext:
    return _context


def init_context(log, config):
    global _context
    _context = AppContext(log=log, config=config or {})


def log_exception(msg: str = "", exc: Optional[BaseException] = None):
    if _context.log:
        try:
            tb = traceback.format_exc() if exc is None else "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            _context.log.write(f"[ERROR]{(' ' + msg) if msg else ''}\n{tb}")
        except Exception:
            pass


def safe_call(func: Callable, *args, default=None, error_msg: str = ""):
    try:
        return func(*args)
    except Exception as e:
        log_exception(error_msg, e)
        return default
