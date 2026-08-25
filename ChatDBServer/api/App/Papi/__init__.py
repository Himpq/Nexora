"""
Nexora.app.Papi — 公开 API

承载 Public API（PAPI）面：
- core.py: PAPI 核心（鉴权装饰器/请求转发）
- routes.py: PAPI 路由（papi_bp）
- scope.py: PAPI 权限范围
- user_keys.py: 用户 API 密钥（user_papi_keys_bp）

对外提供：
- papi_bp / user_papi_keys_bp
"""
from .routes import papi_bp
from .user_keys import user_papi_keys_bp
from .core import require_papi_key

__all__ = [n for n in globals() if not n.startswith('_')]
