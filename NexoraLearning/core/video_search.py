"""Bilibili video search for course materials.

Flow:
1. Read book's coarse reading summary (bookinfo.xml)
2. Call LLM to generate search keywords based on content
3. Search Bilibili API with generated keywords
4. Call LLM to filter/rank results
5. Cache results to disk
"""

from __future__ import annotations

import json
import re
import ssl
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event

_BILIBILI_API = "https://api.bilibili.com/x/web-interface/search/type"
_ICOURSE163_API = "https://www.icourse163.org/web/j/mocSearchBean.searchCourse.rpc"
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
_BILIBILI_PAGE_SIZE = 20
_BILIBILI_MAX_PAGES = 3
_ICOURSE163_PAGE_SIZE = 12
_FILTER_INPUT_LIMIT = 80
_VIDEO_CONTEXT_BLOCK_CHARS = 1400
_VIDEO_KEYWORD_CONTEXT_CHARS = 9000
_VIDEO_OVERVIEW_CONTEXT_CHARS = 10000
_VIDEO_FILTER_CONTEXT_CHARS = 16000
_VIDEO_CHAPTER_SUMMARY_LIMIT = 24
_VIDEO_CHAPTER_SUMMARY_CHARS = 260


def _build_ssl_context() -> ssl.SSLContext:
    """构建 SSL 上下文，优先使用 certifi 证书，验证失败时回退到不验证模式。"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass

    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()


def _urlopen_with_ssl_fallback(req: urllib.request.Request, timeout: int = 15):
    """打开 URL 请求，SSL 验证失败时自动回退到不验证模式。"""
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=_build_ssl_context())
    except Exception as exc:
        error_text = str(exc)
        if "CERTIFICATE_VERIFY_FAILED" not in error_text and "certificate verify failed" not in error_text.lower():
            raise
        log_event(
            "video_ssl_fallback",
            "SSL 证书验证失败，回退到不验证模式",
            payload={"url": str(getattr(req, 'full_url', '')), "error": error_text},
        )
        fallback_ctx = ssl._create_unverified_context()
        return urllib.request.urlopen(req, timeout=timeout, context=fallback_ctx)


def _videos_path(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Path:
    data_dir = Path(str(cfg.get("data_dir") or "data")).resolve()
    return data_dir / "lectures" / lecture_id / "books" / book_id / "videos.json"


def load_cached_videos(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> List[Dict[str, Any]]:
    """Load cached videos from disk. Returns empty list if no cache."""
    path = _videos_path(cfg, lecture_id, book_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return list(data["items"])
    except Exception as exc:
        log_event(
            "video_cache_read_error",
            "视频缓存读取失败",
            payload={"path": str(path), "error": str(exc)},
        )

    return []


def _strip_html(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\{##|##\}", "", text)
    return text.strip()


def _first_text(*values: Any) -> str:
    for value in values:
        text = _strip_html(value)
        if text:
            return text
    return ""


def _normalise_url(url: Any) -> str:
    text = str(url or "").strip()
    if text.startswith("//"):
        return "https:" + text
    return text


def _append_unique_video(items: List[Dict[str, Any]], seen_urls: set, item: Mapping[str, Any]) -> bool:
    url = str(item.get("url") or "").strip()
    if not url or url in seen_urls:
        return False

    seen_urls.add(url)
    items.append(dict(item))
    return True


def _preview_titles(items: List[Dict[str, Any]], limit: int = 3) -> List[str]:
    titles = []

    for item in items[:limit]:
        title = str(item.get("title") or "").strip()

        if title:
            titles.append(title[:80])

    return titles


def _extract_chapter_summary_rows(
    bookinfo_xml: str,
    *,
    limit: int = _VIDEO_CHAPTER_SUMMARY_LIMIT,
    summary_chars: int = _VIDEO_CHAPTER_SUMMARY_CHARS,
) -> List[Dict[str, str]]:
    rows = []

    for match in re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        str(bookinfo_xml or ""),
        flags=re.IGNORECASE | re.DOTALL,
    ):
        name = _strip_html(match.group(1))
        summary = _strip_html(match.group(2))[:summary_chars]

        if name and summary:
            rows.append({"name": name, "summary": summary})

        if len(rows) >= limit:
            break

    return rows


def _split_text_blocks(title: str, text: str, *, max_chars: int = _VIDEO_CONTEXT_BLOCK_CHARS) -> List[Dict[str, str]]:
    value = str(text or "").strip()
    if not value:
        return []

    blocks = []
    block_index = 1

    for start in range(0, len(value), max_chars):
        chunk = value[start:start + max_chars].strip()

        if chunk:
            blocks.append({"title": f"{title} {block_index}", "content": chunk})
            block_index += 1

    return blocks


def _split_line_blocks(title: str, lines: List[str], *, max_chars: int = _VIDEO_CONTEXT_BLOCK_CHARS) -> List[Dict[str, str]]:
    blocks = []
    current_lines = []
    current_chars = 0
    block_index = 1

    for line in lines:
        text = str(line or "").strip()

        if not text:
            continue

        projected = current_chars + len(text) + 1

        if current_lines and projected > max_chars:
            blocks.append({"title": f"{title} {block_index}", "content": "\n".join(current_lines)})
            block_index += 1
            current_lines = []
            current_chars = 0

        current_lines.append(text)
        current_chars += len(text) + 1

    if current_lines:
        blocks.append({"title": f"{title} {block_index}", "content": "\n".join(current_lines)})

    return blocks


def _build_video_llm_context(
    *,
    lecture_title: str = "",
    book_title: str = "",
    bookinfo_xml: str = "",
    book_overview: str = "",
    videos: Optional[List[Dict[str, Any]]] = None,
    include_raw_bookinfo: bool = False,
) -> List[Dict[str, str]]:
    """构建视频搜索模型上下文块，具体长度控制交给 Context 管理。"""
    blocks: List[Dict[str, str]] = []
    course_lines = [
        f"课程：{str(lecture_title or '').strip()}",
        f"教材：{str(book_title or '').strip()}",
    ]
    blocks.append({"title": "课程与教材", "content": "\n".join(course_lines)})

    overview = str(book_overview or "").strip()

    if overview:
        blocks.append({"title": "书籍概括", "content": overview})

    chapter_rows = _extract_chapter_summary_rows(bookinfo_xml)

    if chapter_rows:
        chapter_lines = [
            f"{index + 1}. {row['name']}：{row['summary']}"
            for index, row in enumerate(chapter_rows)
        ]
        blocks.extend(_split_line_blocks("章节摘要", chapter_lines))
    elif include_raw_bookinfo and str(bookinfo_xml or "").strip():
        blocks.extend(_split_text_blocks("章节信息", str(bookinfo_xml or "").strip()))

    video_rows = list(videos or [])

    if video_rows:
        video_lines = []

        for index, video in enumerate(video_rows):
            title = _strip_html(video.get("title"))
            up_name = _strip_html(video.get("up_name"))
            play_count = _strip_html(video.get("play_count"))
            source = _strip_html(video.get("source"))
            keyword = _strip_html(video.get("keyword"))
            meta_parts = [part for part in [source, up_name, f"播放:{play_count}" if play_count else "", f"关键词:{keyword}" if keyword else ""] if part]
            video_lines.append(f"{index + 1}. {title} - {' / '.join(meta_parts)}")

        blocks.extend(_split_line_blocks("候选视频", video_lines, max_chars=1800))

    return blocks


def _prepare_video_prompt(
    task_name: str,
    instruction: str,
    context_blocks: List[Dict[str, str]],
    *,
    max_chars: int,
) -> str:
    """把视频业务上下文接入通用 Context 管理层，并输出模型可读提示词。"""
    from core.booksproc.context import Context, ContextPolicy

    ctx = Context(
        max_chars=max_chars,
        policy=ContextPolicy.TRUNCATE,
        trace_meta={"source": "video_search", "task": task_name},
    )
    ctx.add("system", "你是学习资源检索助手，只根据给定上下文生成可执行的视频资源检索结果。")

    for block in context_blocks:
        title = str(block.get("title") or "").strip()
        content = str(block.get("content") or "").strip()

        if title and content:
            ctx.add("user", f"## {title}\n{content}")

    ctx.add("user", str(instruction or "").strip())
    before_chars = ctx.chars()
    before_messages = ctx.count()
    executed = ctx.prepare()
    messages = ctx.build()
    prepared_prompt = "\n\n".join(
        str(message.get("content") or "").strip()
        for message in messages
        if str(message.get("content") or "").strip()
    )
    log_event(
        "video_context_prepared",
        "视频模型上下文已准备",
        payload={
            "task": task_name,
            "executed": bool(executed),
            "before_chars": int(before_chars),
            "after_chars": int(ctx.chars()),
            "before_messages": int(before_messages),
            "after_messages": int(ctx.count()),
            "context_blocks": len(context_blocks),
            "policy": ContextPolicy.TRUNCATE.value,
        },
    )
    return prepared_prompt


def generate_search_keywords(
    cfg: Mapping[str, Any],
    lecture_title: str,
    book_title: str,
    bookinfo_xml: str,
) -> List[Dict[str, Any]]:
    """用模型根据教材内容生成搜索关键词列表，每个关键词带搜索数量。

    Returns:
        List of {"keyword": str, "count": int} dicts.
    """
    from core.booksproc import build_video_keyword_runner, get_memory_settings
    from prompts import VIDEO_KEYWORD_PROMPT

    instruction = VIDEO_KEYWORD_PROMPT.replace(
        "{{lecture_title}}", lecture_title
    ).replace(
        "{{book_title}}", book_title
    ).replace(
        "{{chapter_summaries}}", "请参考上方章节摘要上下文。"
    )
    context_blocks = _build_video_llm_context(
        lecture_title=lecture_title,
        book_title=book_title,
        bookinfo_xml=bookinfo_xml,
    )

    if not any(str(block.get("title") or "").startswith("章节摘要") for block in context_blocks):
        raise RuntimeError("视频关键词生成缺少章节摘要上下文，请先完成教材概读。")

    prompt = _prepare_video_prompt(
        "keyword",
        instruction,
        context_blocks,
        max_chars=_VIDEO_KEYWORD_CONTEXT_CHARS,
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_video_keyword_runner(cfg, str(settings.get("model_name") or "").strip())

    try:
        result = runner.run(
            prompt,
            context_payload={"username": "system"},
            model_name=str(settings.get("model_name") or "").strip() or None,
            options={"temperature": 0.3, "max_output_tokens": 500},
            request_timeout=60,
        )
        json_match = re.search(r"\[.*?\]", str(result or ""), flags=re.DOTALL)
        if json_match:
            items = json.loads(json_match.group(0))
            if isinstance(items, list):
                parsed = []
                for item in items:
                    if isinstance(item, dict):
                        kw = str(item.get("keyword") or "").strip()
                        count = int(item.get("count") or 10)
                    else:
                        kw = str(item or "").strip()
                        count = 10
                    if kw:
                        parsed.append({"keyword": kw, "count": max(8, min(count, 30))})
                if parsed:
                    return parsed[:8]
    except Exception as exc:
        log_event("video_keyword_error", "关键词生成失败", payload={"error": str(exc)})

    log_event(
        "video_keyword_empty",
        "关键词生成没有得到有效结果",
        payload={"lecture_title": lecture_title, "book_title": book_title},
    )
    return []


def generate_book_overview(
    cfg: Mapping[str, Any],
    lecture_title: str,
    bookinfo_content: str = "",
) -> str:
    """用模型生成书籍概括（2-3句话描述这本书的核心身份）。"""
    from core.booksproc import build_memory_runner, get_memory_settings
    from prompts import VIDEO_BOOK_OVERVIEW_PROMPT

    bookinfo_text = str(bookinfo_content or "").strip()
    if not bookinfo_text:
        raise RuntimeError("视频书籍概括缺少章节信息，请先完成教材概读。")

    instruction = VIDEO_BOOK_OVERVIEW_PROMPT.replace(
        "{{lecture_title}}", lecture_title
    ).replace(
        "{{bookinfo_content}}", "请参考上方章节信息上下文。"
    )
    prompt = _prepare_video_prompt(
        "overview",
        instruction,
        _build_video_llm_context(
            lecture_title=lecture_title,
            bookinfo_xml=bookinfo_text,
            include_raw_bookinfo=True,
        ),
        max_chars=_VIDEO_OVERVIEW_CONTEXT_CHARS,
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())

    try:
        result = runner.run(
            prompt,
            context_payload={"username": "system"},
            model_name=str(settings.get("model_name") or "").strip() or None,
            options={"temperature": 0.3, "max_output_tokens": 200},
            request_timeout=30,
        )
        overview = str(result or "").strip()
        if overview:
            log_event("video_overview_done", "书籍概括生成完成", payload={"overview": overview[:200]})
            return overview
    except Exception as exc:
        log_event("video_overview_error", "书籍概括生成失败", payload={"error": str(exc)})

    return ""


def filter_videos_with_llm(
    cfg: Mapping[str, Any],
    videos: List[Dict[str, Any]],
    book_overview: str = "",
) -> List[Dict[str, Any]]:
    """用模型筛选和排序视频结果，基于书籍概括而非原始章节内容。"""
    if not videos or len(videos) <= 2:
        return videos

    from core.booksproc import build_memory_runner, get_memory_settings
    from prompts import VIDEO_FILTER_PROMPT

    overview_text = str(book_overview or "").strip()
    if not overview_text:
        raise RuntimeError("视频筛选缺少书籍概括上下文。")

    ranked_videos = videos[:_FILTER_INPUT_LIMIT]
    if len(videos) > len(ranked_videos):
        log_event(
            "video_filter_input_limited",
            "视频筛选输入已限制",
            payload={"before": len(videos), "used": len(ranked_videos)},
        )

    instruction = VIDEO_FILTER_PROMPT.replace(
        "{{book_overview}}", overview_text
    ).replace(
        "{{video_list}}", "请参考上方候选视频列表，序号必须使用候选视频前面的编号。"
    )
    prompt = _prepare_video_prompt(
        "filter",
        instruction,
        _build_video_llm_context(
            book_overview=overview_text,
            videos=ranked_videos,
        ),
        max_chars=_VIDEO_FILTER_CONTEXT_CHARS,
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())

    try:
        result = runner.run(
            prompt,
            context_payload={"username": "system"},
            model_name=str(settings.get("model_name") or "").strip() or None,
            options={"temperature": 0.2, "max_output_tokens": 800},
            request_timeout=60,
        )
        # 解析保留的序号列表
        json_match = re.search(r"\[.*?\]", str(result or ""), flags=re.DOTALL)
        if json_match:
            keep_indices = json.loads(json_match.group(0))
            if isinstance(keep_indices, list):
                kept = []
                invalid_indices = []
                for idx in keep_indices:
                    try:
                        i = int(idx) - 1
                        if 0 <= i < len(ranked_videos):
                            kept.append(ranked_videos[i])
                        else:
                            invalid_indices.append(str(idx))
                    except (ValueError, TypeError):
                        invalid_indices.append(str(idx))

                if invalid_indices:
                    log_event(
                        "video_filter_invalid_indices",
                        "视频筛选返回了无效序号",
                        payload={"invalid_indices": invalid_indices[:20], "candidate_count": len(ranked_videos)},
                    )

                if kept:
                    return kept
    except Exception as exc:
        log_event("video_filter_error", "视频筛选失败", payload={"error": str(exc)})
        raise RuntimeError(f"视频筛选失败：{exc}") from exc

    raise RuntimeError("视频筛选失败：模型未返回有效视频序号。")


def search_bilibili(keyword: str, max_results: int = 10, max_pages: int = _BILIBILI_MAX_PAGES) -> List[Dict[str, Any]]:
    """直接调用 Bilibili 搜索 API，并按页扩展候选集。"""
    headers = {
        "User-Agent": _USER_AGENT,
        "Referer": f"https://search.bilibili.com/all?keyword={urllib.parse.quote(keyword)}",
        "Origin": "https://search.bilibili.com",
        "Cookie": "buvid3=placeholder; b_nut=100",
    }

    target_count = max(1, int(max_results or 10))
    page_count = max(1, min(int(max_pages or 1), _BILIBILI_MAX_PAGES))
    items: List[Dict[str, Any]] = []

    for page in range(1, page_count + 1):

        if len(items) >= target_count:
            break

        request_size = min(_BILIBILI_PAGE_SIZE, target_count - len(items))
        url = (
            f"{_BILIBILI_API}?search_type=video"
            f"&keyword={urllib.parse.quote(keyword)}"
            f"&page={page}&pagesize={request_size}"
        )
        req = urllib.request.Request(url, headers=headers)

        with _urlopen_with_ssl_fallback(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            data = json.loads(content)

        if data.get("code") != 0:
            raise RuntimeError(str(data.get("message") or data.get("code") or "B站搜索接口返回异常"))

        results = (data.get("data") or {}).get("result") or []
        page_items = []

        for item in results:
            title = _strip_html(item.get("title"))

            if not title:
                continue

            page_items.append({
                "title": title,
                "up_name": str(item.get("author") or item.get("uname") or "").strip(),
                "play_count": str(item.get("play", 0)).strip(),
                "duration": str(item.get("duration") or "").strip(),
                "url": str(item.get("arcurl") or "").strip(),
                "cover": _normalise_url(item.get("pic")),
                "source": "bilibili",
                "keyword": keyword,
            })

        items.extend(page_items[:max(0, target_count - len(items))])
        log_event(
            "video_bilibili_page_done",
            "B站分页搜索完成",
            payload={
                "keyword": keyword,
                "page": page,
                "raw_count": len(results),
                "parsed_count": len(page_items),
                "total_count": len(items),
                "first_titles": _preview_titles(page_items),
            },
        )

        if not results:
            break

    return items


def search_icourse163(keyword: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """搜索中国大学MOOC课程。"""
    import http.cookiejar

    cookie_jar = http.cookiejar.CookieJar()
    ssl_context = _build_ssl_context()
    https_handler = urllib.request.HTTPSHandler(context=ssl_context)
    session = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cookie_jar),
        https_handler,
    )
    session.addheaders = [
        ("User-Agent", _USER_AGENT),
        ("Accept", "*/*"),
        ("Accept-Language", "zh-CN,zh;q=0.9"),
    ]

    try:
        home_resp = session.open("https://www.icourse163.org/", timeout=10)
        home_resp.read()
    except Exception as exc:
        error_text = str(exc)
        if "CERTIFICATE_VERIFY_FAILED" in error_text or "certificate verify failed" in error_text.lower():
            log_event(
                "video_ssl_fallback",
                "慕课首页 SSL 证书验证失败，回退到不验证模式",
                payload={"error": error_text},
            )
            fallback_handler = urllib.request.HTTPSHandler(context=ssl._create_unverified_context())
            session = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cookie_jar),
                fallback_handler,
            )
            session.addheaders = [
                ("User-Agent", _USER_AGENT),
                ("Accept", "*/*"),
                ("Accept-Language", "zh-CN,zh;q=0.9"),
            ]
            home_resp = session.open("https://www.icourse163.org/", timeout=10)
            home_resp.read()
        else:
            raise

    # 提取 csrfKey
    csrf_key = ""
    for cookie in cookie_jar:
        if cookie.name == "NTESSTUDYSI":
            csrf_key = cookie.value
            break

    if not csrf_key:
        raise RuntimeError("中国大学MOOC首页未返回 NTESSTUDYSI，无法构造搜索请求。")

    # 调用搜索 API
    query_payload = {
        "keyword": keyword,
        "pageIndex": 1,
        "highlight": True,
        "orderBy": 0,
        "stats": 30,
        "pageSize": min(max_results, 20),
    }
    payload = urllib.parse.urlencode({
        "mocCourseQueryVo": json.dumps(query_payload, ensure_ascii=False),
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{_ICOURSE163_API}?csrfKey={csrf_key}",
        data=payload,
        headers={
            "User-Agent": _USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://www.icourse163.org",
            "Referer": f"https://www.icourse163.org/search.htm?keyword={urllib.parse.quote(keyword)}",
            "X-Requested-With": "XMLHttpRequest",
        },
        method="POST",
    )

    with _urlopen_with_ssl_fallback(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if data.get("code") != 0:
        raise RuntimeError(str(data.get("message") or data.get("code") or "中国大学MOOC搜索接口返回异常"))

    result_data = data.get("result") or {}
    courses = result_data.get("list") or result_data.get("courses") or []

    items = []
    for course in courses[:max_results]:
        if not isinstance(course, dict):
            continue

        item = _extract_icourse163_course(course, keyword)

        if item:
            items.append(item)

    return items


def _extract_icourse163_course(course: Mapping[str, Any], keyword: str) -> Dict[str, Any]:
    base_info = course.get("mocCourseKyCardBaseInfoDto") if isinstance(course.get("mocCourseKyCardBaseInfoDto"), dict) else {}
    card = course.get("mocCourseCard") if isinstance(course.get("mocCourseCard"), dict) else {}
    card_dto = card.get("mocCourseCardDto") if isinstance(card.get("mocCourseCardDto"), dict) else {}
    term_panel = card_dto.get("termPanel") if isinstance(card_dto.get("termPanel"), dict) else {}
    school_panel = term_panel.get("schoolPanel") if isinstance(term_panel.get("schoolPanel"), dict) else {}

    title = _first_text(
        base_info.get("courseName"),
        card_dto.get("name"),
        course.get("courseName"),
        course.get("name"),
        course.get("title"),
    )

    if not title:
        return {}

    school = _first_text(
        school_panel.get("name"),
        course.get("highlightUniversity"),
        course.get("schoolName"),
    )
    teacher = _first_text(
        base_info.get("teacherName"),
        course.get("highlightTeacherNames"),
        course.get("teacherName"),
    )
    lector_panels = term_panel.get("lectorPanels") if isinstance(term_panel.get("lectorPanels"), list) else []

    if not teacher and lector_panels:
        first_lector = lector_panels[0] if isinstance(lector_panels[0], dict) else {}
        teacher = _first_text(first_lector.get("nickName"), first_lector.get("realName"))

    cover = _normalise_url(_first_text(
        base_info.get("realBigPhoto"),
        card_dto.get("imgUrl"),
        term_panel.get("bigPhotoUrl"),
        base_info.get("bigPhoto"),
        course.get("coverUrl"),
        course.get("imgUrl"),
    ))
    term_id = _first_text(
        base_info.get("termId"),
        term_panel.get("id"),
        card_dto.get("currentTermId"),
        course.get("termId"),
    )
    course_id = _first_text(
        base_info.get("courseId"),
        card_dto.get("id"),
        course.get("courseId"),
        course.get("id"),
    )
    short_name = _first_text(card_dto.get("shortName"))
    school_prefix = ""
    short_name_match = re.match(r"^\d+([A-Za-z]+)", short_name)

    if short_name_match:
        school_prefix = short_name_match.group(1).upper()

    url = ""

    if school_prefix and course_id:
        url = f"https://www.icourse163.org/course/{school_prefix}-{course_id}"
    elif term_id:
        url = f"https://kaoyan.icourse163.org/course/terms/{term_id}.htm"
    elif course_id:
        url = f"https://www.icourse163.org/course/{course_id}"

    enrollment = (
        term_panel.get("enrollCount")
        or base_info.get("enrollNum")
        or card_dto.get("learnerCount")
        or course.get("enrollmentCount")
        or course.get("learnerCount")
        or 0
    )

    return {
        "title": title,
        "up_name": f"{school} {teacher}".strip(),
        "play_count": str(enrollment).strip(),
        "duration": "",
        "url": url,
        "cover": cover,
        "source": "icourse163",
        "keyword": keyword,
    }


def search_and_cache_videos(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    lecture_title: str = "",
    book_title: str = "",
    bookinfo_xml: str = "",
) -> List[Dict[str, Any]]:
    """完整视频搜索流程：模型生成关键词 → 搜索 → 模型筛选 → 缓存。"""
    # 检查缓存
    cached = load_cached_videos(cfg, lecture_id, book_id)
    if cached:
        log_event("video_search_skip", "视频搜索跳过：已有缓存", payload={"lecture_id": lecture_id, "count": len(cached)})
        return cached

    # 第一步：模型生成搜索关键词（带数量）
    log_event("video_keyword_start", "开始生成视频搜索关键词", payload={"lecture_id": lecture_id, "book_id": book_id})
    keyword_specs = generate_search_keywords(cfg, lecture_title, book_title, bookinfo_xml)
    if not keyword_specs:
        raise RuntimeError("视频搜索关键词生成失败：模型没有返回有效关键词。")
    log_event("video_keyword_done", "关键词生成完成", payload={"keywords": keyword_specs})

    # 第二步：搜索 B 站 + 慕课
    all_items: List[Dict[str, Any]] = []
    seen_urls: set = set()
    provider_stats: List[Dict[str, Any]] = []

    for spec in keyword_specs:
        kw = str(spec.get("keyword") or "").strip()
        count = int(spec.get("count") or 10)

        if not kw:
            continue

        try:
            log_event("video_api_request", "慕课API请求", payload={"keyword": kw, "count": _ICOURSE163_PAGE_SIZE})
            mooc_items = search_icourse163(kw, max_results=_ICOURSE163_PAGE_SIZE)
            mooc_added = 0

            for item in mooc_items:

                if _append_unique_video(all_items, seen_urls, item):
                    mooc_added += 1

            provider_stats.append({
                "source": "icourse163",
                "keyword": kw,
                "requested": _ICOURSE163_PAGE_SIZE,
                "received": len(mooc_items),
                "added": mooc_added,
            })
            log_event(
                "video_api_done",
                "慕课搜索完成",
                payload={
                    "keyword": kw,
                    "count": len(mooc_items),
                    "added": mooc_added,
                    "first_titles": _preview_titles(mooc_items),
                },
            )
        except Exception as exc:
            provider_stats.append({
                "source": "icourse163",
                "keyword": kw,
                "requested": _ICOURSE163_PAGE_SIZE,
                "received": 0,
                "added": 0,
                "error": str(exc),
            })
            log_event("video_api_error", "慕课搜索失败", payload={"keyword": kw, "error": str(exc)})

        try:
            log_event("video_api_request", "B站API请求", payload={"keyword": kw, "count": count})
            items = search_bilibili(kw, max_results=count)
            bili_added = 0

            for item in items:

                if _append_unique_video(all_items, seen_urls, item):
                    bili_added += 1

            provider_stats.append({
                "source": "bilibili",
                "keyword": kw,
                "requested": count,
                "received": len(items),
                "added": bili_added,
            })
            log_event(
                "video_api_done",
                "B站搜索完成",
                payload={
                    "keyword": kw,
                    "count": len(items),
                    "added": bili_added,
                    "first_titles": _preview_titles(items),
                },
            )
        except Exception as exc:
            provider_stats.append({
                "source": "bilibili",
                "keyword": kw,
                "requested": count,
                "received": 0,
                "added": 0,
                "error": str(exc),
            })
            log_event("video_api_error", "B站搜索失败", payload={"keyword": kw, "error": str(exc)})

    if not all_items:
        log_event("video_search_empty", "视频搜索无结果", payload={"keywords": keyword_specs, "provider_stats": provider_stats})
        source_errors = [
            f"{row.get('source')}:{row.get('keyword')}:{row.get('error')}"
            for row in provider_stats
            if str(row.get("error") or "").strip()
        ]

        if source_errors:
            raise RuntimeError("视频搜索失败：" + "；".join(source_errors[:3]))

        _save_cache(cfg, lecture_id, book_id, [], keyword_specs, provider_stats=provider_stats, raw_count=0)
        return []

    # 第三步：生成书籍概括
    log_event("video_overview_start", "开始生成书籍概括")
    book_overview = generate_book_overview(cfg, lecture_title, bookinfo_xml)
    if not book_overview:
        raise RuntimeError("视频书籍概括生成失败：模型没有返回有效概括。")

    # 第四步：基于书籍概括筛选结果
    log_event("video_filter_start", "开始筛选视频", payload={"count": len(all_items), "provider_stats": provider_stats})
    filtered = filter_videos_with_llm(cfg, all_items, book_overview)
    log_event("video_filter_done", "视频筛选完成", payload={"before": len(all_items), "after": len(filtered)})

    _save_cache(cfg, lecture_id, book_id, filtered, keyword_specs, provider_stats=provider_stats, raw_count=len(all_items))
    return filtered


def _save_cache(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    items: List[Dict[str, Any]],
    keywords: List[Dict[str, Any]],
    *,
    provider_stats: Optional[List[Dict[str, Any]]] = None,
    raw_count: int = 0,
) -> None:
    path = _videos_path(cfg, lecture_id, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    cache_data = {
        "items": items,
        "keywords": keywords,
        "raw_count": int(raw_count or 0),
        "provider_stats": list(provider_stats or []),
    }
    path.write_text(json.dumps(cache_data, ensure_ascii=False, indent=2), encoding="utf-8")
