"""
Nexora.basis.Conversation.routes — 会话域路由（按 server.py Strangler Fig 拆分硬规则新增）

新增路由一律写入对应域的 Blueprint 文件，server.py 只负责装配注册。
"""

from __future__ import annotations

from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from basis.Permission.session_auth import require_login

from .errors import (
    ConversationConflictError,
    ConversationError,
    ConversationNotFoundError,
    ConversationValidationError,
)
from .service import ConversationService
from .trash import ConversationTrashService

conversation_bp = Blueprint('conversation', __name__)


@conversation_bp.route('/api/conversations', methods=['POST'])
@require_login
def create_conversation_api():
    """创建一个空对话，供前端预创建使用"""
    username = session['username']
    manager = ConversationService(username)
    data = request.get_json(silent=True) or {}
    title = str(data.get('title') or '新对话').strip() or '新对话'
    conversation_mode = str(data.get('conversation_mode') or 'chat').strip() or 'chat'
    raw_tags = data.get('tags')
    tags = raw_tags if isinstance(raw_tags, list) else []
    metadata = data.get('metadata') if isinstance(data.get('metadata'), dict) else {}
    conversation_id = data.get('conversation_id')
    conversation_id = str(conversation_id or '').strip() or None

    try:
        if conversation_id:
            try:
                manager.get_conversation(conversation_id)
                return jsonify({'success': True, 'conversation_id': conversation_id, 'title': title, 'existed': True})
            except Exception:
                pass

        conv_id = manager.create_conversation(
            conversation_id=conversation_id,
            title=title,
            conversation_mode=conversation_mode,
            tags=tags,
            metadata=metadata,
        )
        return jsonify({'success': True, 'conversation_id': conv_id, 'title': title})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@conversation_bp.route('/api/conversations/<conv_id>/title', methods=['PUT'])
@require_login
def update_conversation_title(conv_id):
    """更新对话标题"""
    username = session['username']
    manager = ConversationService(username)
    data = request.get_json(silent=True) or {}
    title = str(data.get('title') or '').strip()

    if not title:
        return jsonify({'success': False, 'message': 'title is required'}), 400

    if len(title) > 120:
        return jsonify({'success': False, 'message': 'title too long'}), 400

    try:
        manager.update_title(conv_id, title)
        return jsonify({'success': True, 'conversation_id': conv_id, 'title': title})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@conversation_bp.route('/api/conversations/<conv_id>', methods=['DELETE'])
@require_login
def delete_conversation(conv_id):
    """删除对话（完整资源包原子归档）"""
    username = session['username']

    try:
        trash_id = ConversationTrashService(username).archive_and_delete(username, conv_id)
        return jsonify({'success': True, 'trash_id': trash_id})
    except ConversationNotFoundError as e:
        return jsonify({'success': False, 'message': str(e)}), 404
    except ConversationConflictError as e:
        return jsonify({'success': False, 'message': str(e)}), 409
    except ConversationValidationError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


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
