import logging
from ddgs import DDGS
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ====================== 【黑名单：直接过滤垃圾链接】======================
BAD_DOMAINS = {
    "instagram.com", "youtube.com", "youtu.be", "tiktok.com",
    "twitter.com", "x.com", "facebook.com", "pinterest.com",
    "linkedin.com", "t.co", "bit.ly", "amazon.com", "dropbox.com"
}

# 只保留国内正常站点（可选增强）
ALLOW_SUFFIX = (".cn", ".com.cn", ".net.cn", ".org.cn", ".cc", ".tv")

def is_bad_url(url):
    if not url:
        return True
    for bad in BAD_DOMAINS:
        if bad in url:
            return True
    # 可选：只保留国内域名（开启更干净）
    # if not url.lower().startswith(("http://", "https://")):
    #     return True
    # if not url.lower().endswith(ALLOW_SUFFIX):
    #     return False
    return False

# ====================== 【正文抓取（不乱码、不报错）】======================
def fetch_article(url: str, max_length: int = 3000) -> str:
    if is_bad_url(url):
        return "境外/社交链接，已过滤"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=9)
        resp.encoding = resp.apparent_encoding or "utf-8"
        
        soup = BeautifulSoup(resp.text, "html.parser")
        for t in soup(["script", "style", "header", "footer", "nav", "aside", "iframe"]):
            t.decompose()

        paragraphs = soup.find_all("p")
        text = "\n".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 5)
        text = text.strip()
        
        # 如果 max_length > 0 才进行截断，否则保留全部全量正文
        if max_length > 0:
            text = text[:max_length]
            
        return text or "无正文内容"

    except Exception as e:
        logger.warning(f"抓取失败 {url}: {str(e)}")
        return "无法抓取"

# ====================== 【预留：多引擎 CSS Selector 搜索提取 (HTML 抓取方案)】======================
ENGINE_CSS_SELECTORS = {
    "bing": {"item": "li.b_algo", "title": "h2", "link": "a", "snippet": ".b_caption p"},
    "google": {"item": "div.g", "title": "h3", "link": "a", "snippet": ".VwiC3b"},
    "baidu": {"item": "div.result.c-container", "title": "h3", "link": "a", "snippet": ".c-abstract"}
}

def search_by_html_selectors(query: str, engine: str = "bing", max_results: int = 5) -> list:
    """
    预留接口：当 API 不可用或需要扩展其他搜索引擎时，基于 CSS Selector 从搜索结果页抓取数据。
    使用 BeautifulSoup 匹配 ENGINE_CSS_SELECTORS[engine]。
    """
    logger.info(f"Prepared to search {engine} for '{query}' using CSS selectors: {ENGINE_CSS_SELECTORS.get(engine)}")
    # 需要在实际联调时接入具体的请求地址和 cookie/headers 策略
    return []

# ====================== 【干净搜索：无垃圾、无重复、国内可用】======================
def search_clean(query: str, max_results: int = 5, fetch_content: bool = False):
    try:
        results = []
        seen_urls = set()  # 去重

        with DDGS() as ddgs:
            responses = ddgs.text(
                query=query,
                region="cn-zh",
                safesearch="moderate",
                timelimit="w",
                max_results=max_results * 2  # 多拿点用来过滤
            )

            for r in responses:
                url = r.get("href", "")
                title = r.get("title", "")
                snippet = r.get("body", "")

                if not url or url in seen_urls:
                    continue
                if is_bad_url(url):
                    continue
                if len(title) < 2:
                    continue

                seen_urls.add(url)
                item = {
                    "title": title,
                    "url": url,
                    "snippet": snippet
                }
                if fetch_content:
                    item["content"] = fetch_article(url)

                results.append(item)
                if len(results) >= max_results:
                    break

        return {"success": True, "results": results}

    except Exception as e:
        logger.error(f"搜索错误: {e}")
        return {"success": False, "error": str(e)}

# ====================== 测试 ======================
if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    keyword = "嘉豪"

    print("\n【1】干净搜索（无垃圾、无Ins/YouTube）")
    res = search_clean(keyword, max_results=3, fetch_content=False)
    for i, item in enumerate(res["results"], 1):
        print(f"{i}. {item['title']}")
        print(f"   {item['url']}\n")

    print("\n【2】搜索 + 正文抓取（正常中文）")
    res = search_clean(keyword, max_results=1, fetch_content=True)
    for item in res["results"]:
        print(f"标题: {item['title']}")
        print(f"正文:\n{item['content'][:600]}...\n")