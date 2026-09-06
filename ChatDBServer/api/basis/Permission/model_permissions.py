"""
Nexora.basis.Permission.model_permissions — 用户级模型黑名单

数据源为 data/model_permissions.json（相对 server 工作目录，
server.py 导入时会 chdir 到自身目录，路径语义与迁移前一致）。
"""

import json
import os
from typing import List


def get_user_model_blacklist(username: str) -> List[str]:
    """
    读取指定用户的模型黑名单；用户未配置时回退 default_blacklist。
    """
    blacklist_path = './data/model_permissions.json'

    if not os.path.exists(blacklist_path):
        return []

    with open(blacklist_path, 'r', encoding='utf-8') as file:
        permission_config = json.load(file)

    user_blacklists = permission_config.get('user_blacklists', {})
    blacklist = user_blacklists.get(username, permission_config.get('default_blacklist', []))
    return [str(model_id) for model_id in blacklist if str(model_id).strip()]
