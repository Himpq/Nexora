from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from main import _apply_environment_overrides, _load_local_env


class MainConfigTests(unittest.TestCase):
    def test_direct_launch_loads_ignored_local_env_without_overwriting_process_env(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.local").write_text(
                "NEXORALEARNING_NEXORA_API_KEY=from-file\nNEXORALEARNING_PORT=5001\n",
                encoding="utf-8",
            )
            with patch("main.ROOT", root), patch.dict(os.environ, {"NEXORALEARNING_PORT": "5019"}, clear=False):
                previous_key = os.environ.pop("NEXORALEARNING_NEXORA_API_KEY", None)
                try:
                    _load_local_env()
                    self.assertEqual(os.environ["NEXORALEARNING_NEXORA_API_KEY"], "from-file")
                    self.assertEqual(os.environ["NEXORALEARNING_PORT"], "5019")
                finally:
                    if previous_key is None:
                        os.environ.pop("NEXORALEARNING_NEXORA_API_KEY", None)
                    else:
                        os.environ["NEXORALEARNING_NEXORA_API_KEY"] = previous_key

    def test_environment_overrides_do_not_require_config_file(self):
        config = {
            "port": 5001,
            "nexora": {"base_url": "http://127.0.0.1:5000", "api_key": ""},
            "nexoradb": {"service_url": "http://127.0.0.1:8100", "api_key": ""},
            "runtime_api": {"api_key": ""},
        }
        with patch.dict(
            os.environ,
            {
                "NEXORALEARNING_NEXORA_BASE_URL": "https://chat.himpqblog.cn",
                "NEXORALEARNING_NEXORA_API_KEY": "test-secret",
                "NEXORALEARNING_NEXORADB_SERVICE_URL": "https://chat.himpqblog.cn:8100",
                "NEXORALEARNING_RUNTIME_API_KEY": "agent-secret",
                "NEXORALEARNING_PUBLIC_BASE_URL": "https://chat.himpqblog.cn:5002/",
                "NEXORALEARNING_PORT": "5017",
            },
            clear=False,
        ):
            resolved = _apply_environment_overrides(config)

        self.assertEqual(resolved["nexora"]["base_url"], "https://chat.himpqblog.cn")
        self.assertEqual(resolved["nexora"]["api_key"], "test-secret")
        self.assertEqual(resolved["nexoradb"]["service_url"], "https://chat.himpqblog.cn:8100")
        self.assertEqual(resolved["runtime_api"]["api_key"], "agent-secret")
        self.assertEqual(resolved["public_base_url"], "https://chat.himpqblog.cn:5002")
        self.assertEqual(resolved["port"], 5017)


if __name__ == "__main__":
    unittest.main()
