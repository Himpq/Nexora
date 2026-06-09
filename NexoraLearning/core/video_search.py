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
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event

_BILIBILI_API = "https://api.bilibili.com/x/web-interface/search/type"
_ICOURSE163_API = "https://www.icourse163.org/web/j/mocSearchBean.searchCourse.rpc"
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


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
    except Exception:
        pass
    return []


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
    from core.booksproc import build_memory_runner, get_memory_settings
    from prompts import VIDEO_KEYWORD_PROMPT

    summaries = []
    for m in re.finditer(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>[\s\S]*?<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        str(bookinfo_xml or ""), flags=re.IGNORECASE | re.DOTALL,
    ):
        name = str(m.group(1) or "").strip()
        summary = str(m.group(2) or "").strip()[:150]
        if name and summary:
            summaries.append(f"{name}: {summary}")
    summaries_text = "\n".join(summaries[:10])

    prompt = VIDEO_KEYWORD_PROMPT.replace(
        "{{lecture_title}}", lecture_title
    ).replace(
        "{{book_title}}", book_title
    ).replace(
        "{{chapter_summaries}}", summaries_text or "（无摘要）"
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())

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
                        parsed.append({"keyword": kw, "count": max(5, min(count, 20))})
                if parsed:
                    return parsed[:5]
    except Exception as exc:
        log_event("video_keyword_error", "关键词生成失败", payload={"error": str(exc)})

    # 兜底
    fallback = []
    if lecture_title:
        fallback.append({"keyword": lecture_title, "count": 15})
    if book_title and book_title != lecture_title:
        fallback.append({"keyword": book_title, "count": 10})
    return fallback[:2]


def generate_book_overview(
    cfg: Mapping[str, Any],
    lecture_title: str,
    bookinfo_content: str = "",
) -> str:
    """用模型生成书籍概括（2-3句话描述这本书的核心身份）。"""
    from core.booksproc import build_memory_runner, get_memory_settings
    from prompts import VIDEO_BOOK_OVERVIEW_PROMPT

    bookinfo_text = str(bookinfo_content or "").strip()
    if len(bookinfo_text) > 6000:
        bookinfo_text = bookinfo_text[:6000] + "\n...(已截断)"

    prompt = VIDEO_BOOK_OVERVIEW_PROMPT.replace(
        "{{lecture_title}}", lecture_title
    ).replace(
        "{{bookinfo_content}}", bookinfo_text or "（无章节信息）"
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

    video_list = "\n".join(
        f"{i+1}. {v.get('title', '')} - {v.get('up_name', '')} (播放: {v.get('play_count', '0')})"
        for i, v in enumerate(videos)
    )

    prompt = VIDEO_FILTER_PROMPT.replace(
        "{{book_overview}}", book_overview or "（无概括信息）"
    ).replace(
        "{{video_list}}", video_list
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())

    try:
        result = runner.run(
            prompt,
            context_payload={"username": "system"},
            model_name=str(settings.get("model_name") or "").strip() or None,
            options={"temperature": 0.2, "max_output_tokens": 300},
            request_timeout=60,
        )
        # 解析保留的序号列表
        json_match = re.search(r"\[.*?\]", str(result or ""), flags=re.DOTALL)
        if json_match:
            keep_indices = json.loads(json_match.group(0))
            if isinstance(keep_indices, list):
                kept = []
                for idx in keep_indices:
                    try:
                        i = int(idx) - 1
                        if 0 <= i < len(videos):
                            kept.append(videos[i])
                    except (ValueError, TypeError):
                        pass
                if kept:
                    return kept
    except Exception as exc:
        log_event("video_filter_error", "视频筛选失败", payload={"error": str(exc)})

    return videos


def search_bilibili(keyword: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """直接调用 Bilibili 搜索 API。"""
    url = (
        f"{_BILIBILI_API}?search_type=video"
        f"&keyword={urllib.parse.quote(keyword)}"
        f"&page=1&pagesize={min(max_results, 50)}"
    )
    headers = {
        "User-Agent": _USER_AGENT,
        "Referer": f"https://search.bilibili.com/all?keyword={urllib.parse.quote(keyword)}",
        "Origin": "https://search.bilibili.com",
        "Cookie": "buvid3=placeholder; b_nut=100",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        content = resp.read().decode("utf-8")
        data = json.loads(content)

    if data.get("code") != 0:
        return []

    results = (data.get("data") or {}).get("result") or []
    items = []
    for item in results[:max_results]:
        title = re.sub(r"<[^>]+>", "", str(item.get("title") or "")).strip()
        if not title:
            continue
        cover = str(item.get("pic") or "").strip()
        if cover.startswith("//"):
            cover = "https:" + cover
        items.append({
            "title": title,
            "up_name": str(item.get("author") or item.get("uname") or "").strip(),
            "play_count": str(item.get("play", 0)).strip(),
            "duration": str(item.get("duration") or "").strip(),
            "url": str(item.get("arcurl") or "").strip(),
            "cover": cover,
        })
    return items


def search_icourse163(keyword: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """搜索中国大学MOOC课程。"""
    import http.cookiejar

    session = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    session.addheaders = [("User-Agent", _USER_AGENT)]

    # 先访问首页获取 csrfKey
    try:
        home_resp = session.open("https://www.icourse163.org/", timeout=10)
        home_resp.read()
    except Exception:
        pass

    # 提取 csrfKey
    csrf_key = ""
    for cookie in session.cookiejar:
        if cookie.name == "NTESSTUDYSI":
            csrf_key = cookie.value
            break

    if not csrf_key:
        return []

    # 调用搜索 API
    payload = json.dumps({
        "keyword": keyword,
        "pageIndex": 1,
        "highlight": True,
        "orderBy": 0,
        "stats": 30,
        "pageSize": min(max_results, 20),
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{_ICOURSE163_API}?csrfKey={csrf_key}",
        data=payload,
        headers={
            "User-Agent": _USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://www.icourse163.org",
            "Referer": f"https://www.icourse163.org/search.htm?keyword={urllib.parse.quote(keyword)}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []

    if data.get("code") != 0:
        return []

    result_data = data.get("result") or {}
    courses = result_data.get("list") or result_data.get("courses") or []

    items = []
    for course in courses[:max_results]:
        if not isinstance(course, dict):
            continue
        title = str(course.get("name") or course.get("title") or "").strip()
        if not title:
            continue
        school = str(course.get("schoolName") or "").strip()
        teacher = str(course.get("teacherName") or "").strip()
        cover = str(course.get("coverUrl") or course.get("imgUrl") or "").strip()
        if cover.startswith("//"):
            cover = "https:" + cover
        course_id = str(course.get("id") or course.get("courseId") or "").strip()
        url = f"https://www.icourse163.org/course/{course_id}" if course_id else ""
        enrollment = course.get("enrollmentCount") or course.get("learnerCount") or 0

        items.append({
            "title": title,
            "up_name": f"{school} {teacher}".strip(),
            "play_count": str(enrollment).strip(),
            "duration": "",
            "url": url,
            "cover": cover,
            "source": "icourse163",
        })
    return items


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
        keyword_specs = [{"keyword": book_title or lecture_title, "count": 15}]
    log_event("video_keyword_done", "关键词生成完成", payload={"keywords": keyword_specs})

    # 第二步：搜索 B 站 + 慕课
    all_items: List[Dict[str, Any]] = []
    seen_urls: set = set()

    # 用第一个关键词搜慕课
    first_kw = str(keyword_specs[0].get("keyword") or "").strip() if keyword_specs else ""
    if first_kw:
        try:
            log_event("video_api_request", "慕课API请求", payload={"keyword": first_kw})
            mooc_items = search_icourse163(first_kw, max_results=8)
            for item in mooc_items:
                if item.get("url") and item["url"] not in seen_urls:
                    seen_urls.add(item["url"])
                    all_items.append(item)
            log_event("video_api_done", "慕课搜索完成", payload={"count": len(mooc_items)})
        except Exception as exc:
            log_event("video_api_error", "慕课搜索失败", payload={"keyword": first_kw, "error": str(exc)})

    # 用所有关键词搜 B 站
    for spec in keyword_specs:
        kw = str(spec.get("keyword") or "").strip()
        count = int(spec.get("count") or 10)
        if not kw:
            continue
        try:
            log_event("video_api_request", "B站API请求", payload={"keyword": kw, "count": count})
            items = search_bilibili(kw, max_results=count)
            for item in items:
                if item.get("url") and item["url"] not in seen_urls:
                    seen_urls.add(item["url"])
                    all_items.append(item)
        except Exception as exc:
            log_event("video_api_error", "B站搜索失败", payload={"keyword": kw, "error": str(exc)})

    if not all_items:
        log_event("video_search_empty", "视频搜索无结果", payload={"keywords": keyword_specs})
        _save_cache(cfg, lecture_id, book_id, [], keyword_specs)
        return []

    # 第三步：生成书籍概括
    log_event("video_overview_start", "开始生成书籍概括")
    book_overview = generate_book_overview(cfg, lecture_title, bookinfo_xml)
    if not book_overview:
        book_overview = lecture_title

    # 第四步：基于书籍概括筛选结果
    log_event("video_filter_start", "开始筛选视频", payload={"count": len(all_items)})
    filtered = filter_videos_with_llm(cfg, all_items, book_overview)
    log_event("video_filter_done", "视频筛选完成", payload={"before": len(all_items), "after": len(filtered)})

    _save_cache(cfg, lecture_id, book_id, filtered, keyword_specs)
    return filtered


def _save_cache(cfg: Mapping[str, Any], lecture_id: str, book_id: str, items: List[Dict[str, Any]], keywords: List[Dict[str, Any]]) -> None:
    path = _videos_path(cfg, lecture_id, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    cache_data = {"items": items, "keywords": keywords}
    path.write_text(json.dumps(cache_data, ensure_ascii=False, indent=2), encoding="utf-8")
