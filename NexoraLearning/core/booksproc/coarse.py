"""粗读模型流程模块。

说明：
1. 该模块承载粗读入口逻辑，避免 `manager.py` 持续膨胀。
2. 具体粗读分阶段循环仍通过回调注入（沿用当前稳定实现），以降低回归风险。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Mapping, Optional


def run_rough_model(
    cfg: Mapping[str, Any],
    lecture: Mapping[str, Any],
    book: Mapping[str, Any],
    text: str,
    *,
    get_rough_reading_settings: Callable[[Mapping[str, Any]], Dict[str, Any]],
    build_coarse_reading_runner: Callable[[Mapping[str, Any], str], Any],
    as_bool: Callable[[Any, bool], bool],
    job_key: Callable[[str, str], str],
    is_cancelled_key: Callable[[str], bool],
    append_log_text: Callable[[str], None],
    log_event: Callable[..., None],
    run_coarse_reading_chunked: Callable[..., Any],
) -> Dict[str, Any]:
    """调用粗读模型处理教材（入口编排层）。"""
    model_cfg = get_rough_reading_settings(cfg)
    if not bool(model_cfg.get("enabled", True)):
        return {"status": "skipped", "content": "", "model_name": "", "error": ""}

    model_name = str(model_cfg.get("model_name") or "").strip() or None
    max_output_chars = max(2000, int(model_cfg.get("max_output_chars") or 240000))
    max_output_tokens = max(256, int(model_cfg.get("max_output_tokens") or 4000))
    request_timeout = max(30, int(model_cfg.get("request_timeout") or 240))
    stream_enabled = as_bool(model_cfg.get("stream", True), True)
    think_enabled = as_bool(model_cfg.get("think", False), False)
    api_mode = str(model_cfg.get("api_mode") or "chat").strip().lower() or "chat"
    try:
        temperature = float(model_cfg.get("temperature") or 0.2)
    except Exception:
        temperature = 0.2

    full_text = str(text or "")
    total_chars = len(full_text)
    notes = str(model_cfg.get("prompt_notes") or "").strip()
    request_text = "请输出章节结构、章节范围和章节摘要。"
    if notes:
        request_text = f"{request_text}\n附加要求：{notes}"

    log_event(
        "model_context_input",
        "粗读模型输入",
        payload={
            "model_type": "coarse_reading",
            "model_name": model_name or "",
            "lecture_id": str(lecture.get("id") or ""),
            "book_id": str(book.get("id") or ""),
            "text_chars": total_chars,
            "max_output_chars": max_output_chars,
        },
        content="coarse_reading uses single-run with resume mode.",
    )

    runner = build_coarse_reading_runner(cfg, model_name=model_name or "")
    cancel_key = job_key(str(lecture.get("id") or ""), str(book.get("id") or ""))

    def _on_delta(delta: str) -> None:
        piece = str(delta or "")
        if not piece:
            return
        append_log_text(piece)
        if is_cancelled_key(cancel_key):
            raise RuntimeError("cancelled by admin")

    max_input_chars = max(2000, int(model_cfg.get("max_input_chars") or 24000))
    review_model_name = str(model_cfg.get("summary_review_model_name") or "").strip()
    try:
        review_temperature = float(model_cfg.get("summary_review_temperature") or 0.1)
    except Exception:
        review_temperature = 0.1
    review_max_tokens = max(128, int(model_cfg.get("summary_review_max_output_tokens") or 900))
    review_timeout = max(20, int(model_cfg.get("summary_review_request_timeout") or 120))
    review_stream = as_bool(model_cfg.get("summary_review_stream", True), True)
    review_think = as_bool(model_cfg.get("summary_review_think", False), False)
    section_review_model_name = str(model_cfg.get("section_review_model_name") or "").strip()
    try:
        section_review_temperature = float(model_cfg.get("section_review_temperature") or 0.1)
    except Exception:
        section_review_temperature = 0.1
    section_review_max_tokens = max(128, int(model_cfg.get("section_review_max_output_tokens") or 1200))
    section_review_timeout = max(20, int(model_cfg.get("section_review_request_timeout") or 120))
    section_review_stream = as_bool(model_cfg.get("section_review_stream", True), True)
    section_review_think = as_bool(model_cfg.get("section_review_think", False), False)

    rough_run = run_coarse_reading_chunked(
        runner=runner,
        request_text=request_text,
        lecture_name=str(lecture.get("title") or ""),
        book_name=str(book.get("title") or ""),
        model_name=model_name,
        api_mode=api_mode,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        request_timeout=request_timeout,
        stream=stream_enabled,
        think=think_enabled,
        full_text=full_text,
        max_input_chars=max_input_chars,
        max_output_chars=max_output_chars,
        lecture_id=str(lecture.get("id") or ""),
        book_id=str(book.get("id") or ""),
        on_delta=_on_delta,
        cancel_key=cancel_key,
        summary_review_model_name=review_model_name,
        summary_review_temperature=review_temperature,
        summary_review_max_tokens=review_max_tokens,
        summary_review_timeout=review_timeout,
        summary_review_stream=review_stream,
        summary_review_think=review_think,
        section_review_model_name=section_review_model_name,
        section_review_temperature=section_review_temperature,
        section_review_max_tokens=section_review_max_tokens,
        section_review_timeout=section_review_timeout,
        section_review_stream=section_review_stream,
        section_review_think=section_review_think,
    )
    if isinstance(rough_run, dict):
        output = str(rough_run.get("content") or "").strip()
        run_status = str(rough_run.get("status") or "").strip().lower() or "partial"
        outline_built = bool(rough_run.get("outline_built"))
        completed_chapters = int(rough_run.get("completed_chapters") or 0)
        chapters_count = int(rough_run.get("chapters_count") or 0)
    else:
        output = str(rough_run or "").strip()
        run_status = "done"
        outline_built = bool(output)
        completed_chapters = 0
        chapters_count = 0
    if not str(output or "").strip():
        raise RuntimeError("粗读模型返回空内容（stream success but empty output）")

    log_event(
        "model_output",
        "粗读模型输出",
        payload={
            "model_type": "coarse_reading",
            "model_name": model_name or runner.model_name,
            "lecture_id": str(lecture.get("id") or ""),
            "book_id": str(book.get("id") or ""),
            "coarse_status": run_status,
            "outline_built": outline_built,
            "completed_chapters": completed_chapters,
            "chapters_count": chapters_count,
        },
        content=output[:12000],
    )
    return {
        "status": run_status,
        "content": output,
        "model_name": model_name or runner.model_name,
        "error": "",
        "outline_built": outline_built,
        "completed_chapters": completed_chapters,
        "chapters_count": chapters_count,
    }
