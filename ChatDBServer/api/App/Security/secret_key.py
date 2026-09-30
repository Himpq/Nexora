"""Secure storage for the Flask session signing key."""

from __future__ import annotations

import os
import secrets


def load_flask_secret_key(server_dir: str) -> str:
    """Load the configured key or persist one with owner-only POSIX permissions."""
    env_key = str(os.environ.get("CHATDB_SECRET_KEY") or os.environ.get("NEXORA_SECRET_KEY") or "").strip()

    if env_key:
        return env_key

    data_dir = os.path.join(os.path.abspath(server_dir), "data")
    secret_path = os.path.join(data_dir, "flask_secret.key")
    os.makedirs(data_dir, exist_ok=True)

    if os.path.islink(secret_path):
        raise RuntimeError("Flask session key path must not be a symbolic link")

    if os.path.exists(secret_path):
        if not os.path.isfile(secret_path):
            raise RuntimeError("Flask session key path is not a regular file")

        os.chmod(secret_path, 0o600)

        with open(secret_path, "r", encoding="utf-8") as secret_file:
            existing = secret_file.read().strip()

        if existing:
            return existing

    secret = secrets.token_urlsafe(48)
    open_flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    file_descriptor = os.open(secret_path, open_flags, 0o600)

    with os.fdopen(file_descriptor, "w", encoding="utf-8") as secret_file:
        secret_file.write(secret)

    os.chmod(secret_path, 0o600)
    return secret
