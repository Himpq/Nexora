"""Safety checks for user storage paths and explicit memory cleanup."""

from __future__ import annotations

import contextlib
import io
import json
import sqlite3
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest

from core.memory.evidence_memory import _path, record_user_message
from core.user.user import _user_dir
from tools.retract_machine_memories import main as retract_main


@pytest.mark.parametrize("username", ["../other", "..\\other", "C:other", ".", ".."])
def test_user_storage_rejects_path_aliases(username: str) -> None:
    with TemporaryDirectory() as directory:
        cfg = {"data_dir": directory}

        with pytest.raises(ValueError):
            _user_dir(cfg, username)

        with pytest.raises(ValueError):
            _path(cfg, username)


def test_cleanup_retracts_only_explicit_memory_id() -> None:
    with TemporaryDirectory() as directory:
        cfg = {"data_dir": directory}
        first = record_user_message(cfg, "同学甲", text="continue_learning", source_id="first")
        second = record_user_message(cfg, "同学甲", text="review", source_id="second")
        first_id = first["memories"][0]["id"]
        second_id = second["memories"][0]["id"]
        output = io.StringIO()

        with patch.object(sys, "argv", ["retract_machine_memories", "--username", "同学甲",
                                        "--data-dir", directory, "--memory-id", first_id]), contextlib.redirect_stdout(output):
            assert retract_main() == 0

        assert json.loads(output.getvalue())["retracted"][0]["id"] == first_id

        with contextlib.closing(sqlite3.connect(_path(cfg, "同学甲"))) as connection:
            statuses = dict(connection.execute("SELECT id, status FROM memories"))

        assert statuses[first_id] == "retracted"
        assert statuses[second_id] == "active"
