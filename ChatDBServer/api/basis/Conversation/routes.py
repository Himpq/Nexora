"""
Nexora.basis.Conversation.routes — 会话域路由（按 server.py Strangler Fig 拆分硬规则新增）

新增路由一律写入对应域的 Blueprint 文件，server.py 只负责装配注册。
"""

from __future__ import annotations

from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from basis.Permission.session_auth import require_login

from .errors import ConversationError, ConversationNotFoundError, ConversationValidationError
from .service import ConversationService

conversation_bp = Blueprint('conversation', __name__)


@conversation_bp.route('/api/conversations/<conv_id>/question/resolve', methods=['POST'])
@require_login
def resolve_conversation_question(conv_id):
    """question 工具作答登记：回写会话文件中 question 载荷的 resolved/answer。

    各客户端作答时先调用本接口，再发送回答消息；历史加载时按 payload.resolved
    锁定作答卡片，使回答锁跨设备生效（不再依赖设备本地存储）。
    """
    username = session['username']
    data = request.get_json(silent=True) or {}

    question_id = str(data.get('question_id') or '').strip()
    answer = str(data.get('answer') or '').strip()

    if not question_id:
        return jsonify({'success': False, 'message': 'question_id 不能为空'}), 400

    if not answer:
        return jsonify({'success': False, 'message': 'answer 不能为空'}), 400

    try:
        result: Dict[str, Any] = ConversationService(username).resolve_question(conv_id, question_id, answer)
    except ConversationValidationError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except ConversationNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except ConversationError as e:
        return jsonify({'success': False, 'message': str(e)}), 409
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

    return jsonify({
        'success': True,
        'message_index': result.get('message_index'),
        'already_resolved': bool(result.get('already_resolved')),
        'question': result.get('question', {}),
    })
