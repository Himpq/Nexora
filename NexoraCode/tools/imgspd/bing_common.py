from __future__ import annotations

from urllib.parse import parse_qs, urlparse


def read_dimension(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None

    return number if number > 0 else None


def extract_dimensions_from_detail_url(page_url: str) -> tuple[int | None, int | None]:
    if not page_url:
        return None, None

    query = parse_qs(urlparse(page_url).query)
    width = read_dimension((query.get("expw") or [None])[0])
    height = read_dimension((query.get("exph") or [None])[0])

    return width, height


def is_valid_bing_result(image_url: str, source_url: str, page_url: str) -> bool:
    if not image_url or not source_url or not page_url:
        return False

    parsed = urlparse(page_url)
    query = parse_qs(parsed.query)

    if query.get("view", [""])[0] != "detailV2":
        return False

    if "mediaurl" not in query:
        return False

    return True
