"""Learning feed route helper functions."""

from typing import Any, List

def _normalize_channel_members(raw_members: Any) -> List[str]:
    if not isinstance(raw_members, list):
        return []
    rows: List[str] = []
    seen = set()
    for item in raw_members:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        rows.append(value)
    return rows
