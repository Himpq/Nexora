import sys
from pathlib import Path

import importlib

from flask import Flask


API_ROOT = Path(__file__).resolve().parents[1] / "api"

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def test_billing_snapshot_separates_cached_input_costs():
    from basis.TokenUsage.billing import build_billing_snapshot

    billing = build_billing_snapshot(
        input_tokens=1000,
        output_tokens=500,
        raw_input_tokens=1200,
        cached_tokens=200,
        pricing={
            "currency": "CNY",
            "input_per_million": 1,
            "output_per_million": 2,
            "cache_hit_per_million": 0.5,
        },
    )

    assert billing["uncached_input_tokens"] == 1000
    assert billing["input_cost"] == 0.001
    assert billing["output_cost"] == 0.001
    assert billing["cache_hit_cost"] == 0.0001
    assert billing["cost"] == 0.0021


def test_new_model_uses_default_context_window_when_input_is_blank(monkeypatch):
    session_auth = importlib.import_module("basis.Permission.session_auth")
    model_routes = importlib.import_module("basis.Model.admin_routes")
    monkeypatch.setattr(session_auth, "get_request_users_meta", lambda: {"admin": {}})

    config = {
        "providers": {"openai": {}},
        "models": {},
    }
    model_routes.configure_model_admin_routes(
        lambda: config,
        lambda payload, sync_source=None: None,
    )

    app = Flask(__name__)
    app.secret_key = "test"
    app.register_blueprint(model_routes.model_admin_bp)
    client = app.test_client()

    with client.session_transaction() as session:
        session["username"] = "admin"
        session["role"] = "admin"

    response = client.post(
        "/api/admin/models/model/upsert",
        json={
            "model_id": "new-model",
            "provider": "openai",
            "name": "New Model",
            "context_window": 0,
            "pricing": None,
        },
    )

    assert response.status_code == 200
    assert config["models"]["new-model"]["context_window"] == 128000
