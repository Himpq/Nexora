"""Learner profile center routes."""

from api import routes as _routes

_routes._export_route_context(globals())


@bp.route("/frontend/profile-center", methods=["GET"])
def frontend_profile_center():
    """Return the six-dimensional profile score state and quick-interview prompt."""
    from core.memory import build_profile_center_payload

    user_id = _resolve_runtime_user_id()

    try:
        payload = build_profile_center_payload(_cfg, user_id)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    return jsonify({"success": True, "user_id": user_id, **payload})
