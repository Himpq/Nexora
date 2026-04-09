import logging
import requests
from bs4 import BeautifulSoup
import trafilatura

logger = logging.getLogger(__name__)

urls_map = {
    "bing": "https://www.bing.com/search?q={query}",
    "baidu": "https://www.baidu.com/s?wd={query}",
    "sogou": "https://www.sogou.com/web?query={query}",
    "baidu_baike": "https://baike.baidu.com/item/{query}"
}

def parse_search_html(engine: str, html: str) -> list:
    """使用传统 CSS selector 解析搜索结果页。"""
    soup = BeautifulSoup(html, 'html.parser')
    results = []

    if engine == "bing":
        items = soup.find_all("li", class_=lambda c: c and "b_algo" in c)
        for item in items:
            title_node = item.find("h2")
            if not title_node:
                continue
            a_node = title_node.find("a")
            if not a_node:
                continue
            results.append({
                "title": a_node.get_text(strip=True),
                "url": a_node.get("href"),
                "snippet": item.get_text(separator=" ", strip=True),
                "source": "css_select",
                "engine": engine,
            })
        return results

    if engine == "baidu":
        items = soup.find_all("div", class_=lambda c: c and "result" in c and "c-container" in c)
        for item in items:
            title_node = item.find("h3")
            if not title_node:
                continue
            a_node = title_node.find("a")
            if not a_node:
                continue
            results.append({
                "title": a_node.get_text(strip=True),
                "url": a_node.get("href"),
                "snippet": item.get_text(separator=" ", strip=True),
                "source": "css_select",
                "engine": engine,
            })
        return results

    if engine == "sogou":
        items = soup.find_all("div", class_=lambda c: c and ("special-wrap" in c or "vrwrap" in c or "rb" in c))
        for item in items:
            title_node = item.find("h3")
            if not title_node:
                continue
            a_node = title_node.find("a")
            if not a_node:
                continue
            url = a_node.get("href", "")
            if url and not url.startswith("http"):
                url = "https://www.sogou.com" + url
            results.append({
                "title": a_node.get_text(strip=True),
                "url": url,
                "snippet": item.get_text(separator=" ", strip=True),
                "source": "css_select",
                "engine": engine,
            })
        return results

    return results


def _extract_baike_with_trafilatura(html: str, page_url: str, engine: str = "baidu_baike") -> tuple[list, dict]:
    """仅用于百度百科页面：使用 trafilatura 抽取正文和元信息。"""
    metadata = None
    extracted_text = ""

    try:
        metadata = trafilatura.extract_metadata(html, default_url=page_url)
    except Exception as exc:
        logger.warning("trafilatura metadata extraction failed on baidu_baike: %s", exc)

    try:
        extracted_text = trafilatura.extract(
            html,
            url=page_url,
            include_comments=False,
            include_tables=True,
            include_links=True,
            no_fallback=False,
        ) or ""
    except Exception as exc:
        logger.warning("trafilatura text extraction failed on baidu_baike: %s", exc)

    title = str(getattr(metadata, "title", "") or "").strip()
    source_url = str(getattr(metadata, "url", "") or page_url or "").strip() or page_url
    description = str(getattr(metadata, "description", "") or "").strip()
    sitename = str(getattr(metadata, "sitename", "") or "").strip()
    hostname = str(getattr(metadata, "hostname", "") or "").strip()
    text = str(extracted_text or "").strip()

    if not title:
        title = f"{engine.upper()} 搜索页"
    if not text:
        text = title

    result_item = {
        "title": title,
        "url": source_url,
        "snippet": text[:2000],
        "content": text,
        "content_length": len(text),
        "description": description,
        "sitename": sitename,
        "hostname": hostname,
        "source": "trafilatura",
        "engine": "baidu_baike",
    }

    meta = {
        "title": title,
        "url": source_url,
        "description": description,
        "sitename": sitename,
        "hostname": hostname,
        "content_length": len(text),
        "has_content": bool(text),
        "source": "trafilatura",
    }

    return [result_item], meta

def render_search(query: str):
    """
    针对主流搜索引擎使用传统 CSS selector 抽取搜索结果页。
    仅 baidu_baike 页面使用 trafilatura 抽取正文，避免百科页面结构变动导致解析不稳定。
    """
    parsed_results = {}
    meta = {
        "query": query,
        "total_results": 0,
        "engines": {}
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }

    for engine, url_template in urls_map.items():
        url = url_template.format(query=requests.utils.quote(query))
        logger.info(f"Searching on {engine}: {url}")
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            resp.encoding = resp.apparent_encoding
            html_content = resp.text
            if engine == "baidu_baike":
                items, engine_meta = _extract_baike_with_trafilatura(html_content, resp.url or url, engine=engine)
            else:
                items = parse_search_html(engine, html_content)
                engine_meta = {
                    "url": resp.url or url,
                    "source": "css_select",
                    "result_count": len(items),
                    "content_length": 0,
                    "title": items[0].get("title", "") if items else "",
                    "description": "",
                    "sitename": "",
                    "hostname": "",
                }
            parsed_results[engine] = items
            meta["engines"][engine] = {
                "url": engine_meta.get("url", resp.url or url),
                "status": "ok" if items else "empty",
                "result_count": len(items),
                "title": engine_meta.get("title", ""),
                "description": engine_meta.get("description", ""),
                "sitename": engine_meta.get("sitename", ""),
                "hostname": engine_meta.get("hostname", ""),
                "content_length": engine_meta.get("content_length", 0),
                "source": engine_meta.get("source", "css_select"),
            }
            meta["total_results"] += len(items)
            logger.info("Search engine %s returned %d results", engine, len(items))
        except Exception as e:
            logger.error(f"Error searching {engine}: {e}")
            parsed_results[engine] = []
            meta["engines"][engine] = {
                "url": url,
                "status": "error",
                "result_count": 0,
                "error": str(e)
            }
            
    return {
        "results": parsed_results,
        "meta": meta,
    }

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    search_results = render_search("ChatGPT")
    meta = search_results.get("meta", {}) if isinstance(search_results, dict) else {}
    items_by_engine = search_results.get("results", {}) if isinstance(search_results, dict) else {}

    print(f"\n=== 汇总 ===")
    print(f"query: {meta.get('query', 'ChatGPT')}")
    print(f"total_results: {meta.get('total_results', 0)}")

    for engine, items in items_by_engine.items():
        print(f"\n=== {engine.upper()} 结果 === (共找到 {len(items)} 条)")
        for i, res in enumerate(items, 1):
            print(f"{i}. 标题: {res.get('title')}")
            print(f"   链接: {res.get('url')}")
            print(f"   摘要: {res.get('snippet')}...\n")
