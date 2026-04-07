import json
import logging
import time
import random
import requests
from bs4 import BeautifulSoup
from threading import Semaphore

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    logging.warning("Playwright not installed. Fallback forced.")

logger = logging.getLogger(__name__)

# 随机 User-Agent 列表（可根据需要扩充）
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
]

def random_user_agent():
    return random.choice(USER_AGENTS)

def extract_all_text(html: str) -> str:
    """提取可见文本，保留主要内容区域"""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "iframe", "svg", "canvas"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    lines = (line.strip() for line in text.splitlines())
    text = " ".join(line for line in lines if line)
    return text if text else "无文本内容"

def fallback_fetch(url: str, error_context: str = "") -> dict:
    try:
        logger.info(f"Fallback requests: {url}")
        headers = {
            "User-Agent": random_user_agent(),
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        resp = requests.get(url, headers=headers, timeout=12)
        clean_text = extract_all_text(resp.text)
        return {
            "success": True,
            "original_url": url,
            "url": resp.url,
            "title": "",
            "content": clean_text,
            "full_html": resp.text,
            "warning": f"Fallback: {error_context}"
        }
    except Exception as e:
        return {"success": False, "url": url, "error": str(e)}

class RenderManager:
    def __init__(self, max_concurrency: int = 3, allow_fallback: bool = True):
        self.semaphore = Semaphore(max_concurrency)
        self.allow_fallback = allow_fallback

    def render_webview(self, url: str, timeout: int = 30000, use_sogou_fix: bool = True) -> dict:
        """
        渲染网页，如果 use_sogou_fix=True 且域名是 sogou.com，则使用针对搜狗的优化策略
        """
        if not PLAYWRIGHT_AVAILABLE:
            return fallback_fetch(url, "Playwright not installed")

        acquired = self.semaphore.acquire(timeout=20)
        if not acquired:
            return fallback_fetch(url, "Concurrency full")

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                        "--window-size=1920,1080",
                    ]
                )
                # 随机视口大小，模拟不同设备
                viewport_width = random.randint(1200, 1920)
                viewport_height = random.randint(800, 1080)
                context = browser.new_context(
                    user_agent=random_user_agent(),
                    viewport={"width": viewport_width, "height": viewport_height},
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai",
                    extra_http_headers={
                        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "Connection": "keep-alive",
                    }
                )
                page = context.new_page()
                
                # 反检测脚本
                page.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                    Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
                    window.chrome = {runtime: {}};
                """)
                
                # 访问页面
                try:
                    page.goto(url, timeout=timeout, wait_until="domcontentloaded")
                except PlaywrightTimeoutError:
                    logger.warning(f"Timeout on goto: {url}")
                    browser.close()
                    return fallback_fetch(url, "Page load timeout")
                
                # 针对搜狗搜索的特殊等待和滚动（模拟人类行为）
                if "sogou.com" in url and use_sogou_fix:
                    # 等待搜索结果容器出现
                    try:
                        page.wait_for_selector("#main", timeout=10000)  # 搜狗搜索结果主区域
                    except PlaywrightTimeoutError:
                        logger.warning("Sogou main container not found")
                    
                    # 随机滚动几次，模拟用户浏览
                    for _ in range(random.randint(2, 4)):
                        page.mouse.wheel(0, random.randint(300, 800))
                        time.sleep(random.uniform(0.5, 1.2))
                    
                    # 随机悬停在某个结果上（可选）
                    try:
                        first_result = page.query_selector(".vr-title a, .results .result")
                        if first_result:
                            first_result.hover()
                            time.sleep(random.uniform(0.3, 0.7))
                    except:
                        pass
                else:
                    # 通用等待：等待 body 或网络空闲
                    try:
                        page.wait_for_load_state("networkidle", timeout=10000)
                    except:
                        pass
                    time.sleep(1.5)
                
                # 获取最终数据
                final_url = page.url
                title = page.title()
                full_html = page.content()
                clean_text = extract_all_text(full_html)
                
                browser.close()
                
                # 内容过短时降级
                if len(clean_text) < 100 and self.allow_fallback:
                    logger.warning(f"Short content ({len(clean_text)} chars), fallback to requests")
                    return fallback_fetch(url, f"Playwright returned short content ({len(clean_text)})")
                
                return {
                    "success": True,
                    "original_url": url,
                    "url": final_url,
                    "title": title,
                    "content": clean_text,
                    "full_html": full_html,
                    "mode": "playwright"
                }
                
        except Exception as e:
            logger.error(f"Render failed: {url} | {str(e)}")
            if self.allow_fallback:
                return fallback_fetch(url, str(e))
            else:
                return {"success": False, "url": url, "error": str(e)}
        finally:
            self.semaphore.release()


# ==================== 测试与使用示例 ====================
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    rm = RenderManager()
    
    # 测试搜狗搜索（稳定）
    # test_query = "嘉豪"
    # test_url = f"https://www.sogou.com/web?query={test_query}"
    test_url = input()
    logger.info(f"Testing Sogou: {test_url}")
    res = rm.render_webview(test_url, use_sogou_fix=True)
    
    print("\n" + "="*60)
    print(f"成功: {res['success']}")
    print(f"标题: {res.get('title', 'N/A')}")
    print(f"正文长度: {len(res.get('content', ''))}")
    print(f"模式: {res.get('mode', res.get('warning', 'unknown'))}")
    print("\n=== 最终完整文本（前800字符） ===")
    print(res.get('content', '')[:800])
    print("="*60)
    
    # 如果还需要 Bing，可增加重试和间隔
    # 但不建议高频使用