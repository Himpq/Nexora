"""booksproc 包：教材处理队列与模型调度入口。"""

from .manager import (
    cancel_book_refinement,
    enqueue_book_refinement,
    get_refinement_queue_snapshot,
    init_booksproc,
    list_refinement_candidates,
    mark_book_uploaded,
)
from .modeling import get_rough_reading_settings, update_rough_reading_settings

__all__ = [
    "init_booksproc",
    "mark_book_uploaded",
    "list_refinement_candidates",
    "enqueue_book_refinement",
    "cancel_book_refinement",
    "get_refinement_queue_snapshot",
    "get_rough_reading_settings",
    "update_rough_reading_settings",
]
