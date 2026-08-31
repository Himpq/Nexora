import json
import logging
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

def fetch_article(url: str, max_length: int = 4000) -> str:
    """
    Fetch article text safely.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = resp.apparent_encoding
        try:
            html = resp.content.decode("utf-8")
        except:
            try:
                html = resp.content.decode("gb18030")
            except:
                html = resp.content.decode("euc-kr", errors="ignore")

        soup = BeautifulSoup(html, "html.parser")
        for t in soup(["script", "style", "header", "footer", "nav", "aside"]): 
            t.decompose()

        paragraphs = soup.find_all(["p", "div"], text=True)
        text = "\n".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 10)
        return text[:max_length].strip() or "无法提取正文"

    except Exception as e:
        logger.error(f"抓取失败：{url} - {str(e)}")
        return f"抓取失败：{str(e)}"

def duckduckgo_search(query: str, max_results: int = 5, backend: str = "html", fetch_content: bool = False) -> str:
    """
    Search DuckDuckGo using duckduckgo_search library.

    兼容保留：内部委托至 DuckDuckGoSearchProvider，避免双份实现
    """
    try:
        from .providers.duckduckgo import DuckDuckGoSearchProvider

        provider = DuckDuckGoSearchProvider(
            provider_name="duckduckgo",
            provider_config={
                "backend": backend,
                "fetch_content": fetch_content,
            },
        )

        result = provider.search(
            query=query,
            num_results=max_results,
            backend=backend,
            fetch_content=fetch_content,
        )

        if not result.ok:
            return json.dumps({"error": result.error}, ensure_ascii=False)

        results = []

        for hit in result.hits:
            item = {
                "title": hit.title,
                "url": hit.url,
                "snippet": hit.snippet,
            }

            if fetch_content and isinstance(hit.raw, dict) and hit.raw.get("content"):
                item["content"] = hit.raw.get("content")

            results.append(item)

        return json.dumps({"success": True, "results": results}, ensure_ascii=False)

    except Exception as e:
        logger.error(f"DuckDuckGo search error: {e}")
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Testing DDG Search...")
    print(duckduckgo_search("人工智能最新进展", max_results=3, backend="html", fetch_content=False))
