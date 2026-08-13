from pathlib import Path
from typing import Any, Dict, List, Optional

from App.Convert import MarkdownWordConverter, WORD_MIMETYPE


class KnowledgeWordExporter:
    """Collect knowledge-base entries and export them through the shared Word converter."""

    mimetype = WORD_MIMETYPE

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir or Path(__file__).resolve().parents[1]).resolve()
        self.converter = MarkdownWordConverter(base_dir=str(self.base_dir))

    @classmethod
    def collect_items(cls, user, title: str = "") -> List[Dict[str, Any]]:
        """Collect basis-knowledge entries from a User object."""
        knowledge_map = user.getKnowledgeList(1)

        if not isinstance(knowledge_map, dict):
            return []

        requested_title = str(title or "").strip()

        if requested_title:

            if requested_title not in knowledge_map:
                raise KeyError(f"知识不存在: {requested_title}")

            titles = [requested_title]
        else:
            titles = [str(item_title) for item_title in knowledge_map.keys() if str(item_title or "").strip()]

        items = []

        for item_title in titles:
            meta = knowledge_map.get(item_title)

            if not isinstance(meta, dict):
                meta = {}

            items.append({
                "title": item_title,
                "content": user.getBasisContent(item_title),
            })

        return items

    def build(self, username: str, items: List[Dict[str, Any]]):
        """Build a Word stream from collected knowledge entries."""
        contents = [str(item.get("content") or "") for item in items]
        return self.converter.build(contents)
