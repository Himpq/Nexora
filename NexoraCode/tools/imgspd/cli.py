from __future__ import annotations

import argparse
import json
import sys

from .bing import BingImageSearchConfig, BingImageSearcher
from .crawlee_bing import CrawleeBingImageSearchConfig, CrawleeBingImageSearcher
from .mediawiki import MediaWikiCommonsSearcher


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        response = _run(args)
        _write_json(sys.stdout, response.to_dict())

        return 0
    except Exception as exc:
        _write_json(sys.stderr, {"status": "error", "message": str(exc)})

        return 1


def _run(args):
    if args.command == "bing":
        config = BingImageSearchConfig(
            proxy=args.proxy or "",
            headless=args.headless,
            channel=args.channel,
            user_data_dir=args.user_data_dir or "",
            timeout_ms=args.timeout * 1000,
            scroll_times=args.scrolls,
            pause_on_anti_spider=not args.no_pause_on_anti_spider,
        )

        return BingImageSearcher(config).search(args.query, limit=args.limit)

    if args.command == "commons":
        return MediaWikiCommonsSearcher(proxy=args.proxy or "", timeout=args.timeout).search(args.query, limit=args.limit)

    if args.command == "bing-crawlee":
        config = CrawleeBingImageSearchConfig(
            proxy=args.proxy or "",
            headless=args.headless,
            channel=args.channel,
            user_data_dir=args.user_data_dir or "",
            timeout_sec=args.timeout,
            scroll_times=args.scrolls,
        )

        return CrawleeBingImageSearcher(config).search(args.query, limit=args.limit)

    raise ValueError(f"未知命令: {args.command}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="imgspd", description="NexoraCode 独立本地图片搜索工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bing = subparsers.add_parser("bing", help="使用本地浏览器抓取 Bing 图片搜索")
    bing.add_argument("query", help="搜索关键词")
    bing.add_argument("--limit", type=int, default=20, help="最多返回图片数量")
    bing.add_argument("--proxy", default="", help="浏览器代理，例如 http://127.0.0.1:15555")
    bing.add_argument("--headless", action="store_true", help="使用无界面浏览器")
    bing.add_argument("--channel", default="msedge", help="Chromium 通道，默认 msedge")
    bing.add_argument("--user-data-dir", default="", help="浏览器持久化用户目录")
    bing.add_argument("--timeout", type=int, default=30, help="超时秒数")
    bing.add_argument("--scrolls", type=int, default=4, help="滚动加载次数")
    bing.add_argument("--no-pause-on-anti-spider", action="store_true", help="检测到人机验证时直接返回状态")

    bing_crawlee = subparsers.add_parser("bing-crawlee", help="使用 Python Crawlee 抓取 Bing 图片搜索")
    bing_crawlee.add_argument("query", help="搜索关键词")
    bing_crawlee.add_argument("--limit", type=int, default=20, help="最多返回图片数量")
    bing_crawlee.add_argument("--proxy", default="", help="浏览器代理，例如 http://127.0.0.1:15555")
    bing_crawlee.add_argument("--headless", action="store_true", help="使用无界面浏览器")
    bing_crawlee.add_argument("--channel", default="msedge", help="Chromium 通道，默认 msedge")
    bing_crawlee.add_argument("--user-data-dir", default="", help="浏览器持久化用户目录")
    bing_crawlee.add_argument("--timeout", type=int, default=45, help="超时秒数")
    bing_crawlee.add_argument("--scrolls", type=int, default=4, help="滚动加载次数")

    commons = subparsers.add_parser("commons", help="通过 Wikimedia Commons API 搜索图片")
    commons.add_argument("query", help="搜索关键词")
    commons.add_argument("--limit", type=int, default=20, help="最多返回图片数量")
    commons.add_argument("--proxy", default="", help="请求代理，例如 http://127.0.0.1:15555")
    commons.add_argument("--timeout", type=int, default=25, help="超时秒数")

    return parser


def _write_json(stream, payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    buffer = getattr(stream, "buffer", None)

    if buffer is None:
        stream.write(text)
        stream.flush()

        return

    buffer.write(text.encode("utf-8"))
    buffer.flush()
