from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from main import _apply_environment_overrides


class MainConfigTests(unittest.TestCase):
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
                "NEXORALEARNING_PORT": "5017",
            },
            clear=False,
        ):
            resolved = _apply_environment_overrides(config)

        self.assertEqual(resolved["nexora"]["base_url"], "https://chat.himpqblog.cn")
        self.assertEqual(resolved["nexora"]["api_key"], "test-secret")
        self.assertEqual(resolved["nexoradb"]["service_url"], "https://chat.himpqblog.cn:8100")
        self.assertEqual(resolved["runtime_api"]["api_key"], "agent-secret")
        self.assertEqual(resolved["port"], 5017)


if __name__ == "__main__":
    unittest.main()
