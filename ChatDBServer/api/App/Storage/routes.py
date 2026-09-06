"""
Nexora.App.Storage.routes — 管理端向量库路由（自 server.py 分批迁移）

- /api/admin/chroma/stats (GET)：ChromaDB 集合与向量规模概览

组装契约：get_config_all（含迁移钩子的 server 侧包装）与 get_chroma_store
（向量库单例访问，亦被检索链路使用）经 configure_storage_admin_routes() 注入。
"""

from flask import Blueprint, jsonify

from basis.Permission import require_admin

storage_admin_bp = Blueprint('storage_admin', __name__)

_get_config_all = None
_get_chroma_store = None


def configure_storage_admin_routes(get_config_all, get_chroma_store):
    """server 组装期注入依赖（仅允许调用一次）。"""
    global _get_config_all, _get_chroma_store

    if _get_config_all is not None:
        raise RuntimeError('storage admin routes already configured')

    _get_config_all = get_config_all
    _get_chroma_store = get_chroma_store


@storage_admin_bp.route('/api/admin/chroma/stats', methods=['GET'])
@require_admin
def admin_chroma_stats():
    """ChromaDB stats for admin UI"""
    config = _get_config_all()
    rag = config.get('rag_database', {})
    if not rag.get('rag_database_enabled', False):
        return jsonify({'success': True, 'enabled': False, 'message': 'disabled'})

    store, store_err = _get_chroma_store()
    if not store:
        return jsonify({'success': True, 'enabled': False, 'message': store_err})

    try:
        stats = store.stats()
        return jsonify({
            'success': True,
            'enabled': True,
            'mode': rag.get('mode'),
            'service_url': rag.get('service_url'),
            'collections': stats.get('collections', []),
            'total_vectors': stats.get('total_vectors', 0)
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
