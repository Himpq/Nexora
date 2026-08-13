import json
import logging
import asyncio

try:
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    logging.warning("Playwright is not installed. Run: pip install playwright && playwright install chromium")

logger = logging.getLogger(__name__)

async def render_page_async(url: str, timeout: int = 15000) -> dict:
    """
    Renders a webpage using a headless chromium browser via Playwright.
    Best choice for headless Linux terminal environments.
    """
    try:
        async with async_playwright() as p:
            # Launch chromium in headless mode (perfect for Linux without GUI)
            browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox'])
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 800}
            )
            page = await context.new_page()
            
            try:
                # Wait until the network is mostly idle (useful for SPA and JS-rendered pages)
                await page.goto(url, timeout=timeout, wait_until='networkidle')
            except PlaywrightTimeoutError:
                logger.warning(f"Timeout while rendering {url}, moving forward with current content...")
            
            # Scroll down to trigger lazy-loaded elements
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            
            # Wait briefly for content to load after scroll or client-side redirects (JS window.location)
            await asyncio.sleep(1.5) 
            
            # 💡 [NEW]: Extract the final URL after ANY browser redirects (301, 302, or JS redirects)
            final_url = page.url
            
            title = await page.title()
            
            # Extract main readable text
            # We use a simple script to grab all readable text instead of full HTML to save tokens
            text_content = await page.evaluate("""
                () => {
                    const elements = document.querySelectorAll('script, style, nav, footer, header, aside, noscript, iframe');
                    elements.forEach(el => el.remove());
                    return document.body ? document.body.innerText : '';
                }
            """)
            
            await browser.close()
            
            return {
                "success": True,
                "original_url": url,
                "url": final_url, # Now accurately contains the post-jump URL!
                "title": title,
                "content": "\n".join([line.strip() for line in text_content.split('\n') if line.strip()]),
            }

    except PlaywrightTimeoutError as pte:
        logger.error(f"Playwright hard timeout: {str(pte)}")
        return {"success": False, "url": url, "error": f"Timeout {timeout}ms exceeded"}
    except Exception as e:
        logger.error(f"Failed to render page with Playwright: {url} - {str(e)}")
        # 💡 [NEW]: Simple fallback to requests if Playwright OOM crashes or fails (perfect for 1C1G)
        import requests
        from bs4 import BeautifulSoup
        try:
            logger.info("Falling back to requests rendering...")
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10, allow_redirects=True)
            resp.encoding = resp.apparent_encoding
            soup = BeautifulSoup(resp.content, "html.parser")
            for t in soup(["script", "style", "header", "footer", "nav", "aside"]): t.decompose()
            return {
                "success": True,
                "original_url": url,
                "url": resp.url,
                "title": soup.title.string if soup.title else '',
                "content": " ".join(soup.stripped_strings)[:10000],
                "warning": "Rendered via fallback (requests) due to Playwright error."
            }
        except Exception as fallback_e:
            return {
                "success": False,
                "url": url,
                "error": f"Playwright failed: {str(e)}. Fallback also failed: {str(fallback_e)}"
            }

def universal_webview_render(url: str, timeout: int = 15000) -> str:
    """
    Sync wrapper wrapper around render_page_async.
    Returns: JSON string with extracted 'content' and 'title'.
    Note: When deploying on headless Linux, install playwright properly:
    pip install playwright
    playwright install --with-deps chromium
    """
    try:
        # Check if we are already in an event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Not ideal for synchronous environments like thread pools, but standard fallback
                # If running inside FastAPI/async code, use render_page_async directly.
                import threading
                def run_in_thread(coro, result_container):
                    new_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(new_loop)
                    result_container.append(new_loop.run_until_complete(coro))
                
                res = []
                t = threading.Thread(target=run_in_thread, args=(render_page_async(url, timeout), res))
                t.start()
                t.join()
                return json.dumps(res[0], ensure_ascii=False)
        except RuntimeError:
            pass
            
        result = asyncio.run(render_page_async(url, timeout))
        return json.dumps(result, ensure_ascii=False)

    except Exception as e:
        logger.error(f"Error wrapping playwright rendering: {e}")
        return json.dumps({"success": False, "error": str(e)})

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Testing universal_webview_render...")
    # example URL
    print(universal_webview_render("https://himpqblog.cn/"))
