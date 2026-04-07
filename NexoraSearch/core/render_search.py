import logging
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

urls_map = {
    "bing": "https://www.bing.com/search?q={query}",
    "baidu": "https://www.baidu.com/s?wd={query}",
    "sogou": "https://www.sogou.com/web?query={query}"
}

def parse_search_html(engine: str, html: str) -> list:
    """根据不同搜索引擎解析返回的DOM内容进行特定筛选"""
    soup = BeautifulSoup(html, 'html.parser')
    results = []
    
    if engine == "bing":
        # 必应筛选 <li class="b_algo" (或其包含的值，如 li.b_algo)
        items = soup.find_all("li", class_=lambda c: c and "b_algo" in c)
        for item in items:
            title_node = item.find("h2")
            if not title_node: continue
            a_node = title_node.find("a")
            if not a_node: continue
            results.append({
                "title": a_node.get_text(strip=True),
                "url": a_node.get("href"),
                "snippet": item.get_text(separator=" ", strip=True)
            })

    elif engine == "baidu":
        # 百度筛选 <div class="result c-container"
        items = soup.find_all("div", class_=lambda c: c and "result" in c and "c-container" in c)
        for item in items:
            title_node = item.find("h3")
            if not title_node: continue
            a_node = title_node.find("a")
            if not a_node: continue
            results.append({
                "title": a_node.get_text(strip=True),
                "url": a_node.get("href"),
                "snippet": item.get_text(separator=" ", strip=True)
            })
            
    elif engine == "sogou":
        # 搜狗筛选 <div class="special-wrap" 和 <div class="vrwrap"
        items = soup.find_all("div", class_=lambda c: c and ("special-wrap" in c or "vrwrap" in c or "rb" in c))
        for item in items:
            title_node = item.find("h3")
            if not title_node: continue
            a_node = title_node.find("a")
            if not a_node: continue
            url = a_node.get("href", "")
            if url and not url.startswith("http"):
                url = "https://www.sogou.com" + url
            results.append({
                "title": a_node.get_text(strip=True),
                "url": url,
                "snippet": item.get_text(separator=" ", strip=True)
            })

    return results

def render_search(query: str):
    """
    针对主流搜索引擎发起请求并进行特定的 CSS 规则过滤，提取纯干货搜索结果（非通用 Render）
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
            
            # 使用针对引擎定制的选择器进行解析
            items = parse_search_html(engine, html_content)
            parsed_results[engine] = items
            meta["engines"][engine] = {
                "url": url,
                "status": "ok",
                "result_count": len(items)
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
    # print("Testing render_search with specific CSS parsers for query '人工智能'...")
    search_results = render_search("ChatGPT")
    meta = search_results.get("meta", {}) if isinstance(search_results, dict) else {}
    items_by_engine = search_results.get("results", {}) if isinstance(search_results, dict) else {}

    print(f"\n=== 汇总 ===")
    print(f"query: {meta.get('query', 'ChatGPT')}")
    print(f"total_results: {meta.get('total_results', 0)}")

    for engine, items in items_by_engine.items():
        print(f"\n=== {engine.upper()} 结果 === (共找到 {len(items)} 条)")
        for i, res in enumerate(items, 1): # 仅打印前3条演示
            print(f"{i}. 标题: {res.get('title')}")
            print(f"   链接: {res.get('url')}")
            print(f"   摘要: {res.get('snippet')}...\n")
