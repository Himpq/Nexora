"""Count serialized local requests with tiktoken's cl100k_base encoding."""

from functools import lru_cache
import json


class TokenEstimator:
    _ENCODING_NAME = "cl100k_base"

    @classmethod
    def count(cls, value) -> int:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))

        return len(cls._encoding().encode_ordinary(serialized))

    @staticmethod
    @lru_cache(maxsize=1)
    def _encoding():
        try:
            import tiktoken
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "NexoraCode token estimation requires tiktoken; install NexoraCode requirements"
            ) from exc

        return tiktoken.get_encoding(TokenEstimator._ENCODING_NAME)
