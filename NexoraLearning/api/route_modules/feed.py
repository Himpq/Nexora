"""Learning feed routes."""

from api import routes as _routes

# The first split keeps common helpers in api.routes while route handlers move by domain.
_routes._export_route_context(globals())


@bp.route("/frontend/learning-feeds/channels", methods=["GET"])
def frontend_learning_feed_channels():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    is_admin = bool(_is_runtime_admin())
    rows = _resolve_learning_feed_channels_for_user(username, is_admin)
    return jsonify({"success": True, "items": rows, "total": len(rows)})

@bp.route("/frontend/settings/feed-channels", methods=["POST"])
def frontend_settings_feed_channels_create():
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can create channels."}), 403
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400
    member_user_ids = _normalize_channel_members(data.get("member_user_ids"))
    if "ALL" in {item.upper() for item in member_user_ids}:
        member_user_ids = []
        channel_type = "public"
    else:
        channel_type = "private"
    record = upsert_learning_feed_channel(
        _cfg,
        {
            "title": title,
            "type": channel_type,
            "member_user_ids": member_user_ids,
            "created_by": str(_resolve_runtime_user_id() or "").strip(),
        },
    )
    return jsonify({"success": True, "item": record})

@bp.route("/frontend/settings/feed-channels/<channel_id>", methods=["DELETE"])
def frontend_settings_feed_channels_delete(channel_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can delete channels."}), 403
    removed = delete_learning_feed_channel(_cfg, channel_id)
    if not removed:
        return jsonify({"success": False, "error": "channel not found."}), 404
    return jsonify({"success": True, "channel_id": channel_id})

@bp.route("/frontend/settings/feed-channels/<channel_id>", methods=["PATCH"])
def frontend_settings_feed_channels_update(channel_id: str):
    if not _is_runtime_admin():
        return jsonify({"success": False, "error": "Only admin can update channels."}), 403

    data = request.get_json(silent=True) or {}

    # 获取现有频道记录
    from core.learning_feed import list_learning_feed_channels
    existing_channels = list_learning_feed_channels(_cfg)
    existing_channel = None
    for ch in existing_channels:
        if str(ch.get("id") or "").strip() == channel_id:
            existing_channel = ch
            break

    if not existing_channel:
        return jsonify({"success": False, "error": "channel not found."}), 404

    # 合并更新字段
    updates = {}

    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            return jsonify({"success": False, "error": "title cannot be empty."}), 400
        updates["title"] = title

    if "member_user_ids" in data:
        member_user_ids = _normalize_channel_members(data.get("member_user_ids"))
        if "ALL" in {item.upper() for item in member_user_ids}:
            member_user_ids = []
            updates["type"] = "public"
        else:
            updates["type"] = "private"
        updates["member_user_ids"] = member_user_ids

    if not updates:
        return jsonify({"success": False, "error": "No valid fields to update."}), 400

    # 合并现有记录和更新
    merged_record = {**existing_channel, **updates, "id": channel_id}

    record = upsert_learning_feed_channel(
        _cfg,
        merged_record,
    )
    return jsonify({"success": True, "item": record})

@bp.route("/frontend/learning-feeds", methods=["GET"])
def frontend_learning_feeds():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    limit = _safe_int(request.args.get("limit"), 50)
    selected_channel_id = str(request.args.get("channel_id") or "public_all").strip() or "public_all"
    current_is_admin = bool(_is_runtime_admin())
    visible_channels = _resolve_learning_feed_channels_for_user(username, current_is_admin)
    channel_map = {str(row.get("id") or "").strip(): row for row in visible_channels if isinstance(row, dict)}
    if selected_channel_id not in channel_map:
        selected_channel_id = "public_all"
    rows = list_learning_feed_items(_cfg, limit=max(limit, 200))
    rows = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("channel_id") or "public_all").strip() == selected_channel_id
        and _can_view_feed_channel(channel_map.get(selected_channel_id, {"id": "public_all", "type": "public"}), username, current_is_admin)
    ][:limit]
    author_cache: Dict[str, Dict[str, Any]] = {}
    current_user_keys = _resolve_feed_user_key_set(username)

    def _resolve_author_view(user_id: str) -> Dict[str, Any]:
        key = str(user_id or "").strip()
        if not key:
            return {}
        cached = author_cache.get(key)
        if cached is not None:
            return cached
        resolved: Dict[str, Any] = {"user_id": key, "username": key}
        if _proxy is not None:
            try:
                result = _get_cached_nexora_user_info(key)
                if isinstance(result, dict) and result.get("success"):
                    user = result.get("user") if isinstance(result.get("user"), dict) else {}
                    resolved["user_id"] = str(user.get("id") or key).strip() or key
                    resolved["username"] = str(user.get("username") or key).strip() or key
                    nickname = str(user.get("nickname") or "").strip()
                    display_name = str(user.get("display_name") or "").strip()
                    avatar_url = str(user.get("avatar_url") or user.get("avatar") or "").strip()
                    if nickname:
                        resolved["nickname"] = nickname
                    if display_name:
                        resolved["display_name"] = display_name
                    if avatar_url:
                        resolved["avatar_url"] = avatar_url
                    if str(user.get("role") or "").strip().lower() == "admin":
                        resolved["author_is_admin"] = True
            except Exception:
                pass
        author_cache[key] = resolved
        return resolved

    def _build_author_payload(view: Dict[str, Any], fallback_user_id: str) -> Dict[str, str]:
        fallback = str(fallback_user_id or "").strip()
        payload = {
            "user_id": str(view.get("user_id") or fallback or "").strip(),
            "username": str(view.get("username") or fallback or "").strip(),
        }
        nickname = str(view.get("nickname") or "").strip()
        display_name = str(view.get("display_name") or "").strip()
        avatar_url = str(view.get("avatar_url") or "").strip()
        if nickname:
            payload["nickname"] = nickname
        if display_name:
            payload["display_name"] = display_name
        if avatar_url:
            payload["avatar_url"] = avatar_url
        return payload

    for row in rows:
        if not isinstance(row, dict):
            continue
        author = row.get("author") if isinstance(row.get("author"), dict) else {}
        author_id = str(author.get("user_id") or row.get("username") or row.get("user_id") or "").strip()
        author_view = _resolve_author_view(author_id)
        row["author"] = _build_author_payload(author_view, author_id)
        row["author_is_admin"] = bool(author_view.get("author_is_admin"))
        row["can_delete"] = bool(
            current_is_admin
            or _feed_user_keys_match(current_user_keys, author, author_view, row.get("username"), row.get("user_id"))
        )
        comments = row.get("comments")
        if isinstance(comments, list):
            rendered_comments = []
            for comment in comments:
                if not isinstance(comment, dict):
                    continue
                comment_author = comment.get("author") if isinstance(comment.get("author"), dict) else {}
                comment_author_id = str(comment_author.get("user_id") or comment.get("username") or "").strip()
                comment_author_view = _resolve_author_view(comment_author_id)
                rendered_comments.append(
                    {
                        **comment,
                        "author": _build_author_payload(comment_author_view, comment_author_id),
                        "author_is_admin": bool(comment_author_view.get("author_is_admin")),
                        "likes_count": max(0, _safe_int(comment.get("likes_count"), 0)),
                        "liked_user_ids": comment.get("liked_user_ids") if isinstance(comment.get("liked_user_ids"), list) else [],
                        "can_delete": bool(
                            current_is_admin
                            or _feed_user_keys_match(
                                current_user_keys,
                                comment_author,
                                comment_author_view,
                                comment_author_id,
                                comment.get("username"),
                            )
                        ),
                    }
                )
            row["comments"] = rendered_comments
    return jsonify(
        {
            "success": True,
            "items": rows,
            "total": len(rows),
            "channel_id": selected_channel_id,
            "channels": visible_channels,
        }
    )

@bp.route("/frontend/learning-feeds", methods=["POST"])
def frontend_learning_feeds_create():
    data = request.get_json(silent=True) or {}
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    current_is_admin = bool(_is_runtime_admin())
    content = str(data.get("content") or data.get("summary") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content is required."}), 400
    selected_channel_id = str(data.get("channel_id") or "public_all").strip() or "public_all"
    visible_channels = _resolve_learning_feed_channels_for_user(str(username), current_is_admin)
    channel_map = {str(row.get("id") or "").strip(): row for row in visible_channels if isinstance(row, dict)}
    channel = channel_map.get(selected_channel_id)
    if not channel or not _can_view_feed_channel(channel, str(username), current_is_admin):
        return jsonify({"success": False, "error": "invalid channel."}), 400
    if selected_channel_id == "public_admin" and not current_is_admin:
        return jsonify({"success": False, "error": "only admin can post to admin channel."}), 403
    author = _build_feed_author_snapshot(username)
    record = prepend_learning_feed_item(
        _cfg,
        {
            "type": "user_post",
            "channel_id": selected_channel_id,
            "summary": content,
            "content": content,
            "username": username,
            "author": author,
            "liked_user_ids": [],
            "likes_count": 0,
            "comments_count": 0,
        },
    )
    _notify_feed_mentions(
        username,
        content,
        title=f"你在动态中被 @{username} 提到",
    )
    log_event("learning_feed_posted", {"username": username, "chars": len(content), "channel_id": selected_channel_id, "source": "feed"})
    return jsonify({"success": True, "item": record})

@bp.route("/frontend/learning-feeds/users/search", methods=["GET"])
def frontend_learning_feed_users_search():
    username = str(_resolve_runtime_user_id() or "").strip()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    query = str(request.args.get("q") or "").strip()
    limit = max(1, min(_safe_int(request.args.get("limit"), 8), 20))
    if not query:
        rows = _list_recent_feed_user_examples(limit=min(limit, 5))
        return jsonify({"success": True, "items": rows, "total": len(rows), "query": ""})
    rows = _search_nexora_users(query, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows), "query": query})

@bp.route("/frontend/users/search", methods=["GET"])
def frontend_users_search():
    """通用用户搜索接口 (教师管理等场景)"""
    query = str(request.args.get("q") or "").strip()
    limit = max(1, min(_safe_int(request.args.get("limit"), 10), 30))
    if not query:
        # 空查询：优先获取最近活跃用户，不足时用通用搜索补充
        rows = _list_recent_feed_user_examples(limit=limit)
        if len(rows) < limit and _proxy is not None:
            seen = {str(r.get("user_id") or "").strip() for r in rows}
            # 用常见字符做宽泛搜索，补充更多用户
            for filler_q in ["a", "e", "1", "2"]:
                extra = _search_nexora_users(filler_q, limit=limit)
                for u in extra:
                    uid = str(u.get("user_id") or "").strip()
                    if uid and uid not in seen:
                        seen.add(uid)
                        rows.append(u)
                    if len(rows) >= limit:
                        break
                if len(rows) >= limit:
                    break
        return jsonify({"success": True, "items": rows[:limit], "total": len(rows[:limit]), "query": ""})
    rows = _search_nexora_users(query, limit=limit)
    return jsonify({"success": True, "items": rows, "total": len(rows), "query": query})

@bp.route("/frontend/learning-feeds/<feed_id>/like", methods=["POST"])
def frontend_learning_feed_like(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    updated = toggle_learning_feed_like(_cfg, feed_id, username)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    log_event("learning_feed_liked", {"feed_id": feed_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "item": updated})

@bp.route("/frontend/learning-feeds/<feed_id>/comments", methods=["POST"])
def frontend_learning_feed_comment(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "content is required."}), 400
    comment = {
        "content": content,
        "author": _build_feed_author_snapshot(username),
        "username": username,
    }
    updated = append_learning_feed_comment(_cfg, feed_id, username, comment)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    _notify_feed_mentions(
        username,
        content,
        title=f"你在评论中被 @{username} 提到",
    )
    log_event("learning_feed_commented", {"feed_id": feed_id, "username": username, "chars": len(content), "source": "feed"})
    return jsonify({"success": True, "item": updated})

@bp.route("/frontend/learning-feeds/<feed_id>/comments/<comment_id>/like", methods=["POST"])
def frontend_learning_feed_comment_like(feed_id: str, comment_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    updated = toggle_learning_feed_comment_like(_cfg, feed_id, comment_id, username)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    log_event(
        "learning_feed_comment_liked",
        {"feed_id": feed_id, "comment_id": comment_id, "username": username, "source": "feed"},
    )
    return jsonify({"success": True, "item": updated})

@bp.route("/frontend/learning-feeds/<feed_id>", methods=["DELETE"])
def frontend_learning_feed_delete(feed_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    rows = list_learning_feed_items(_cfg, limit=500)
    target = next((row for row in rows if isinstance(row, dict) and str(row.get("id") or "").strip() == str(feed_id or "").strip()), None)
    if not isinstance(target, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    author = target.get("author") if isinstance(target.get("author"), dict) else {}
    author_id = str(author.get("user_id") or target.get("username") or "").strip()
    current_user_keys = _resolve_feed_user_key_set(username)
    if not (
        _is_runtime_admin()
        or _feed_user_keys_match(current_user_keys, author, author_id, target.get("username"), target.get("user_id"))
    ):
        return jsonify({"success": False, "error": "forbidden"}), 403
    removed = delete_learning_feed_item(_cfg, feed_id)
    if not removed:
        return jsonify({"success": False, "error": "feed not found."}), 404
    log_event("learning_feed_deleted", {"feed_id": feed_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "feed_id": feed_id})

@bp.route("/frontend/learning-feeds/<feed_id>/comments/<comment_id>", methods=["DELETE"])
def frontend_learning_feed_comment_delete(feed_id: str, comment_id: str):
    username = _resolve_runtime_user_id()
    if not username:
        return jsonify({"success": False, "error": "username is required."}), 400
    rows = list_learning_feed_items(_cfg, limit=500)
    target_feed = next((row for row in rows if isinstance(row, dict) and str(row.get("id") or "").strip() == str(feed_id or "").strip()), None)
    if not isinstance(target_feed, dict):
        return jsonify({"success": False, "error": "feed not found."}), 404
    comments = target_feed.get("comments") if isinstance(target_feed.get("comments"), list) else []
    target_comment = next((row for row in comments if isinstance(row, dict) and str(row.get("id") or "").strip() == str(comment_id or "").strip()), None)
    if not isinstance(target_comment, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    comment_author = target_comment.get("author") if isinstance(target_comment.get("author"), dict) else {}
    comment_author_id = str(comment_author.get("user_id") or target_comment.get("username") or "").strip()
    current_user_keys = _resolve_feed_user_key_set(username)
    if not (
        _is_runtime_admin()
        or _feed_user_keys_match(
            current_user_keys,
            comment_author,
            comment_author_id,
            target_comment.get("username"),
        )
    ):
        return jsonify({"success": False, "error": "forbidden"}), 403
    updated = delete_learning_feed_comment(_cfg, feed_id, comment_id)
    if not isinstance(updated, dict):
        return jsonify({"success": False, "error": "comment not found."}), 404
    log_event("learning_feed_comment_deleted", {"feed_id": feed_id, "comment_id": comment_id, "username": username, "source": "feed"})
    return jsonify({"success": True, "item": updated})
