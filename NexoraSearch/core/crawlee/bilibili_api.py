"""
Bilibili search API crawler (direct API, no Playwright).

API: https://api.bilibili.com/x/web-interface/search/type
"""

import json
import re
import ssl
import urllib.request
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import certifi


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
CERTIFI_CA_BUNDLE = certifi.where()


def _build_verified_ssl_context() -> ssl.SSLContext:
    """Create a verified SSL context using certifi's CA bundle."""
    return ssl.create_default_context(cafile=CERTIFI_CA_BUNDLE)


def crawl_bilibili_api(
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    event_callback=None,
) -> dict:
    """Search Bilibili videos via API.

    Args:
        keyword: Search keyword.
        page: Page number (1-based).
        page_size: Results per page (max 50).
        event_callback: Optional callable(event_dict) for streaming progress.

    Returns:
        dict with 'success', 'items', 'count', 'error' keys.
    """

    def _emit(event_type: str, data: dict):
        if event_callback:
            try:
                event_callback({"type": event_type, **data})
            except Exception:
                pass

    if not keyword:
        return {"success": False, "error": "搜索关键词不能为空", "items": [], "count": 0}

    _emit("log", {"content": f"B站API搜索: {keyword}"})

    url = f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={quote(keyword)}&page={page}&pagesize={min(page_size, 50)}"

    headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"https://search.bilibili.com/all?keyword={quote(keyword)}",
        "Origin": "https://search.bilibili.com",
        "Cookie": "buvid3=placeholder; b_nut=100",
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        _emit("log", {"content": f"使用CA证书包: {CERTIFI_CA_BUNDLE}"})

        ssl_context = _build_verified_ssl_context()

        with urllib.request.urlopen(req, timeout=15, context=ssl_context) as resp:
            content = resp.read().decode("utf-8")
            data = json.loads(content)

        if data.get("code") != 0:
            error_msg = data.get("message", "未知错误")
            _emit("log", {"content": f"API返回错误: {error_msg}"})
            return {"success": False, "error": error_msg, "items": [], "count": 0}

        results = (data.get("data") or {}).get("result") or []
        _emit("log", {"content": f"找到 {len(results)} 个视频"})

        items = []
        for i, item in enumerate(results):
            # 清理HTML高亮标记
            title = re.sub(r'<[^>]+>', '', str(item.get("title") or "")).strip()
            author = str(item.get("author") or item.get("uname") or "").strip()
            play = item.get("play", 0)
            danmaku = item.get("danmaku", 0)
            duration = str(item.get("duration") or "").strip()
            cover = str(item.get("pic") or "").strip()
            if cover.startswith("//"):
                cover = "https:" + cover
            video_url = str(item.get("arcurl") or "").strip()
            bvid = str(item.get("bvid") or "").strip()
            description = str(item.get("description") or item.get("desc") or "").strip()
            like = item.get("like", 0)

            video_data = {
                "title": title,
                "author": author,
                "play": int(play) if play else 0,
                "danmaku": int(danmaku) if danmaku else 0,
                "duration": duration,
                "cover": cover,
                "url": video_url,
                "bvid": bvid,
                "description": description[:200],
                "like": int(like) if like else 0,
                "source": "bilibili_api",
            }
            items.append(video_data)

            _emit("result", {
                "index": len(items),
                "title": video_data["title"],
                "author": video_data["author"],
                "play": video_data["play"],
                "danmaku": video_data["danmaku"],
                "duration": video_data["duration"],
                "cover": video_data["cover"],
                "url": video_data["url"],
            })

        _emit("log", {"content": f"搜索完成，共 {len(items)} 个视频"})
        return {
            "success": True,
            "items": items,
            "count": len(items),
        }

    except Exception as e:
        _emit("log", {"content": f"搜索失败: {str(e)}"})
        return {"success": False, "error": str(e), "items": [], "count": 0}


# 测试用
if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)

    def print_event(evt):
        evt_type = evt.get("type", "")
        if evt_type == "result":
            print(f"[{evt.get('index')}] {evt.get('title')} - {evt.get('author')}")
        elif evt_type == "log":
            print(f"  {evt.get('content')}")

    print("=== 搜索 Python ===")
    result = crawl_bilibili_api(keyword="Python", page_size=5, event_callback=print_event)
    print(f"\n成功: {result['success']}, 数量: {result['count']}")
    for item in result.get("items", []):
        print(f"  - {item['title']} ({item['author']})")
        print(f"    播放: {item['play']} | 弹幕: {item['danmaku']}")
        print(f"    封面: {item['cover']}")
