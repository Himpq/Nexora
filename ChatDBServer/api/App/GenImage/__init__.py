"""
Nexora.App.GenImage — 生图接口配置管理（自 server.py 分批迁移）

admin_routes.py 承载 /api/admin/gen-image/apis 配置 CRUD 与归一化辅助。
本模块只管理配置，不发起任何生图请求。

组装契约：主配置读写经 configure_gen_image_admin_routes() 注入。
"""

from .admin_routes import configure_gen_image_admin_routes, gen_image_admin_bp
