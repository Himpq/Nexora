"""
icourse163 (中国大学MOOC) crawler powered by Crawlee PlaywrightCrawler.

Supports two modes:
- search: crawl search results for keyword
- detail: crawl course detail page for full info

API endpoint: https://www.icourse163.org/web/j/mocSearchBean.searchCourse.rpc
"""

import asyncio
import json
import random
import re
from datetime import timedelta
from urllib.parse import quote, urlencode

from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext

from .loop import run_crawlee


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]


def crawl_icourse163(
    keyword: str = "",
    mode: str = "search",
    max_results: int = 20,
    event_callback=None,
) -> dict:
    """Crawl icourse163 (中国大学MOOC) courses.

    Args:
        keyword: Search keyword (used when mode='search').
        mode: 'search' for keyword search, 'detail' for course detail page.
        max_results: Maximum number of results to collect.
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

    if mode == "search":
        if not keyword:
            return {"success": False, "error": "搜索模式需要提供关键词", "items": [], "count": 0}
        url = f"https://www.icourse163.org/search.htm?keyword={quote(keyword)}"
        _emit("log", {"content": f"搜索模式: keyword={keyword}"})
    else:
        return {"success": False, "error": "详情模式暂未实现", "items": [], "count": 0}

    _emit("log", {"content": f"初始化 Crawlee PlaywrightCrawler (max={max_results})"})

    collected_items = []
    api_data_holder = {"courses": []}

    async def _run():
        crawler = PlaywrightCrawler(
            max_requests_per_crawl=1,
            headless=True,
            request_handler_timeout=timedelta(seconds=90),
        )

        @crawler.router.default_handler
        async def request_handler(context: PlaywrightCrawlingContext) -> None:
            context.log.info(f"正在打开页面: {context.request.url}")

            page = context.page

            user_agent = random.choice(USER_AGENTS)
            await page.set_extra_http_headers({"User-Agent": user_agent})

            # 拦截API响应
            async def handle_response(response):
                try:
                    url = response.url
                    if "mocSearchBean.searchCourse.rpc" in url:
                        body = await response.text()
                        try:
                            data = json.loads(body)
                            if data.get("code") == 0 and data.get("result"):
                                courses = data["result"].get("list", [])
                                if courses:
                                    api_data_holder["courses"] = courses
                                    _emit("log", {"content": f"拦截到API数据: {len(courses)} 门课程"})
                        except Exception:
                            pass
                except Exception:
                    pass

            page.on("response", handle_response)

            _emit("progress", {"content": "等待页面加载..."})

            # 等待页面加载 - 需要更长时间因为是SPA
            await asyncio.sleep(8)

            # 打印页面标题用于调试
            page_title = await page.title()
            _emit("log", {"content": f"页面标题: {page_title}"})
            _emit("log", {"content": f"页面URL: {page.url}"})

            # 滚动触发加载
            _emit("progress", {"content": "滚动加载内容..."})
            for i in range(5):
                await page.evaluate("window.scrollBy(0, 500)")
                await asyncio.sleep(1)

            # 等待更长时间让数据加载完成
            await asyncio.sleep(3)

            # 检查是否拦截到API数据
            if api_data_holder["courses"]:
                _emit("log", {"content": f"使用拦截到的API数据: {len(api_data_holder['courses'])} 门课程"})
                for course in api_data_holder["courses"][:max_results]:
                    item = _extract_course_from_json(course)
                    if item and item.get("title"):
                        collected_items.append(item)
                        _emit("result", {
                            "index": len(collected_items),
                            "title": item["title"],
                            "school": item["school"],
                            "teacher": item["teacher"],
                            "cover_url": item["cover_url"],
                            "url": item["url"],
                        })
                return

            # 如果没有拦截到数据，尝试从DOM提取
            _emit("progress", {"content": "尝试从DOM提取数据..."})

            # 尝试从页面脚本中提取数据
            try:
                page_content = await page.content()
                # 查找页面中的课程数据
                json_patterns = [
                    r'window\.__INITIAL_STATE__\s*=\s*({.*?});',
                    r'window\.__NEXT_DATA__\s*=\s*({.*?});',
                    r'"list"\s*:\s*(\[.*?\])',
                    r'"courses"\s*:\s*(\[.*?\])',
                ]
                for pattern in json_patterns:
                    json_match = re.search(pattern, page_content, re.DOTALL)
                    if json_match:
                        try:
                            json_data = json.loads(json_match.group(1))
                            _emit("log", {"content": f"找到JSON数据: {type(json_data)}"})
                            courses = []
                            if isinstance(json_data, list):
                                courses = json_data
                            elif isinstance(json_data, dict):
                                for key in ["list", "courses", "courseList", "searchResults"]:
                                    if key in json_data:
                                        val = json_data[key]
                                        if isinstance(val, list):
                                            courses = val
                                        elif isinstance(val, dict) and "list" in val:
                                            courses = val["list"]
                                        elif isinstance(val, dict) and "courses" in val:
                                            courses = val["courses"]
                                        break
                            if courses:
                                _emit("log", {"content": f"从JSON提取到 {len(courses)} 门课程"})
                                for course in courses[:max_results]:
                                    item = _extract_course_from_json(course)
                                    if item and item.get("title"):
                                        collected_items.append(item)
                                        _emit("result", {
                                            "index": len(collected_items),
                                            "title": item["title"],
                                            "school": item["school"],
                                            "teacher": item["teacher"],
                                            "cover_url": item["cover_url"],
                                            "url": item["url"],
                                        })
                                return
                        except json.JSONDecodeError:
                            continue
            except Exception as e:
                _emit("log", {"content": f"JSON提取失败: {e}"})

            # 最后尝试从DOM选择器提取
            _emit("log", {"content": "尝试从DOM选择器提取..."})

            # 搜索课程链接
            links = await page.locator("a[href*='/course/']").all()
            _emit("log", {"content": f"找到 {len(links)} 个课程链接"})

            for link in links[:max_results]:
                try:
                    href = await link.get_attribute("href") or ""
                    text = await link.inner_text()
                    if href and text.strip():
                        course_url = href
                        if course_url.startswith("/"):
                            course_url = "https://www.icourse163.org" + course_url

                        # 尝试获取封面图
                        cover_url = ""
                        try:
                            parent = link.locator("..").first
                            img = parent.locator("img").first
                            if await img.count() > 0:
                                cover_url = await img.get_attribute("src") or ""
                                if cover_url.startswith("//"):
                                    cover_url = "https:" + cover_url
                        except Exception:
                            pass

                        item = {
                            "title": text.strip(),
                            "school": "",
                            "teacher": "",
                            "description": "",
                            "enrollment": "",
                            "cover_url": cover_url,
                            "url": course_url,
                            "source": "icourse163",
                        }
                        collected_items.append(item)
                        _emit("result", {
                            "index": len(collected_items),
                            "title": item["title"],
                            "school": item["school"],
                            "teacher": item["teacher"],
                            "cover_url": item["cover_url"],
                            "url": item["url"],
                        })
                except Exception as e:
                    _emit("log", {"content": f"提取链接失败: {e}"})

        _emit("log", {"content": f"开始爬取: {url}"})
        await crawler.run([url])

    try:
        run_crawlee(_run())
        _emit("log", {"content": f"爬取完成，共 {len(collected_items)} 条结果"})
        return {
            "success": True,
            "items": collected_items,
            "count": len(collected_items),
        }
    except Exception as e:
        _emit("error", {"content": f"爬取异常: {str(e)}"})
        return {
            "success": False,
            "error": str(e),
            "items": collected_items,
            "count": len(collected_items),
        }


def _extract_course_from_json(course: dict) -> dict:
    """从JSON数据中提取课程信息。"""
    try:
        base_info = course.get("mocCourseKyCardBaseInfoDto") or {}
        card_dto = (course.get("mocCourseCard") or {}).get("mocCourseCardDto") or {}
        term_panel = card_dto.get("termPanel") or {}

        # 标题 - 优先使用不带高亮标记的
        title = (base_info.get("courseName") or card_dto.get("name") or
                 course.get("courseName") or "")
        # 清理高亮标记
        title = re.sub(r'\{##|##\}', '', title).strip()

        # 学校
        school_panel = term_panel.get("schoolPanel") or {}
        school = (school_panel.get("name") or course.get("highlightUniversity") or "")
        school = re.sub(r'\{##|##\}', '', school).strip()
        school_img = card_dto.get("schoolImgUrl") or ""

        # 教师
        lector_panels = term_panel.get("lectorPanels") or []
        teacher = ""
        teacher_photo = ""
        if lector_panels:
            teacher = lector_panels[0].get("nickName") or lector_panels[0].get("realName") or ""
            teacher_photo = lector_panels[0].get("photoUrl") or ""
        if not teacher:
            teacher = base_info.get("teacherName") or course.get("highlightTeacherNames") or ""
            teacher = re.sub(r'\{##|##\}', '', teacher).strip().rstrip(";")
        if not teacher_photo:
            teacher_photo = base_info.get("teacherPhoto") or ""

        # 描述
        description = term_panel.get("jsonContent") or base_info.get("description") or ""
        description = re.sub(r'\{##|##\}', '', description).strip()

        # 封面图 - 优先使用 realBigPhoto 或 imgUrl
        cover_url = (base_info.get("realBigPhoto") or
                     card_dto.get("imgUrl") or
                     term_panel.get("bigPhotoUrl") or
                     base_info.get("bigPhoto") or "")

        # 课程ID和学期ID - 从多个位置尝试获取
        term_id = (
            base_info.get("termId") or
            term_panel.get("id") or
            card_dto.get("currentTermId") or
            course.get("termId") or ""
        )
        course_id = (
            base_info.get("courseId") or
            card_dto.get("id") or
            course.get("courseId") or ""
        )

        # 课程类型
        course_type = course.get("type", 0)

        # 从 shortName 提取学校前缀
        short_name = card_dto.get("shortName") or ""
        school_prefix = ""
        if short_name:
            # 格式如 "0807XIDIAN030" 或 "0809uestc044" -> 提取学校前缀
            match = re.match(r'^\d+([A-Za-z]+)', short_name)
            if match:
                school_prefix = match.group(1).upper()

        # 构建课程URL
        # type=306 的课程通常有学校前缀，使用 www 格式
        # type=301 的课程通常没有学校前缀，使用 kaoyan 格式
        url = ""
        if school_prefix and course_id:
            # 使用 www 格式：https://www.icourse163.org/course/{SCHOOL_PREFIX}-{courseId}
            url = f"https://www.icourse163.org/course/{school_prefix}-{course_id}"
        elif int(course_type) == 306 and course_id:
            # type=306 但没有提取到学校前缀，尝试用 kaoyan 格式
            if term_id:
                url = f"https://kaoyan.icourse163.org/course/terms/{term_id}.htm"
        elif term_id:
            # 使用 kaoyan 格式：https://kaoyan.icourse163.org/course/terms/{termId}.htm
            url = f"https://kaoyan.icourse163.org/course/terms/{term_id}.htm"
        elif course_id:
            url = f"https://www.icourse163.org/course/{course_id}"

        # 选课人数
        enrollment = (term_panel.get("enrollCount") or base_info.get("enrollNum") or
                      card_dto.get("learnerCount") or 0)

        # 课程数
        lessons_count = term_panel.get("lessonsCount") or 0

        # 价格
        price = term_panel.get("price") or base_info.get("price") or 0

        # 清理URL
        if cover_url and cover_url.startswith("//"):
            cover_url = "https:" + cover_url
        if teacher_photo and teacher_photo.startswith("//"):
            teacher_photo = "https:" + teacher_photo
        if school_img and school_img.startswith("//"):
            school_img = "https:" + school_img

        return {
            "title": str(title).strip(),
            "school": str(school).strip(),
            "teacher": str(teacher).strip(),
            "description": str(description).strip()[:500],
            "enrollment": int(enrollment) if enrollment else 0,
            "lessons_count": int(lessons_count) if lessons_count else 0,
            "price": float(price) if price else 0,
            "cover_url": cover_url,
            "teacher_photo": teacher_photo,
            "school_img": school_img,
            "url": url,
            "term_id": str(term_id).strip(),
            "course_id": str(course_id).strip(),
            "source": "icourse163",
        }
    except Exception as e:
        return {}


def crawl_icourse163_api(
    keyword: str = "",
    page_index: int = 1,
    page_size: int = 20,
    event_callback=None,
) -> dict:
    """使用API方式爬取icourse163课程（备用方案）。

    注意：此方法需要有效的csrfKey和cookies，可能会过期。
    """

    def _emit(event_type: str, data: dict):
        if event_callback:
            try:
                event_callback({"type": event_type, **data})
            except Exception:
                pass

    import requests

    if not keyword:
        return {"success": False, "error": "搜索关键词不能为空", "items": [], "count": 0}

    _emit("log", {"content": f"API搜索模式: keyword={keyword}"})

    headers = {
        'authority': 'www.icourse163.org',
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://www.icourse163.org',
        'user-agent': random.choice(USER_AGENTS),
    }

    # 注意：这些cookies和token可能会过期，需要定期更新
    cookies = {
        'EDUWEBDEVICE': '9f5cabe982764fb09e250dc5a33506f6',
    }

    # 尝试获取新的csrfKey
    try:
        session = requests.Session()
        session.headers.update(headers)
        session.cookies.update(cookies)

        # 先访问首页获取cookies
        _emit("log", {"content": "正在获取csrfKey..."})
        home_resp = session.get("https://www.icourse163.org/", timeout=10)
        _emit("log", {"content": f"首页响应状态: {home_resp.status_code}"})
        _emit("log", {"content": f"Cookies: {dict(session.cookies)}"})

        csrf_key = session.cookies.get('NTESSTUDYSI', '')
        _emit("log", {"content": f"csrfKey: {csrf_key[:20]}..." if csrf_key else "csrfKey为空"})

        if not csrf_key:
            _emit("log", {"content": "无法获取csrfKey，使用Playwright模式"})
            return crawl_icourse163(keyword=keyword, mode="search", max_results=page_size, event_callback=event_callback)

        params = {
            'csrfKey': csrf_key,
        }

        data = f'mocCourseQueryVo={{"keyword":"{keyword}","pageIndex":{page_index},"highlight":true,"orderBy":0,"stats":30,"pageSize":{page_size}}}'

        _emit("log", {"content": f"正在调用API: {keyword}"})
        response = session.post(
            'https://www.icourse163.org/web/j/mocSearchBean.searchCourse.rpc',
            params=params,
            data=data,
            timeout=15,
        )

        _emit("log", {"content": f"API响应状态: {response.status_code}"})

        result = response.json()
        _emit("log", {"content": f"JSON解析成功，code: {result.get('code')}"})

        # 检查API返回状态
        if result.get("code") != 0:
            _emit("log", {"content": f"API返回错误: {result.get('message', '未知错误')}"})
            return crawl_icourse163(keyword=keyword, mode="search", max_results=page_size, event_callback=event_callback)

        # 提取课程列表 - icourse163 API 返回在 list 字段中
        result_data = result.get("result") or {}
        courses = []
        if isinstance(result_data, dict):
            courses = result_data.get("list", [])
        if not courses:
            courses = result_data.get("courses", [])

        _emit("log", {"content": f"提取到 {len(courses)} 门课程"})

        if courses:
            _emit("log", {"content": f"第一门课程keys: {list(courses[0].keys()) if courses else '无'}"})

        items = []
        for course in courses:
            item = _extract_course_from_json(course)
            if item and item.get("title"):
                items.append(item)
                _emit("result", {
                    "index": len(items),
                    "title": item["title"],
                    "school": item["school"],
                    "teacher": item["teacher"],
                    "cover_url": item["cover_url"],
                    "teacher_photo": item.get("teacher_photo", ""),
                    "enrollment": item.get("enrollment", 0),
                    "lessons_count": item.get("lessons_count", 0),
                    "price": item.get("price", 0),
                    "url": item["url"],
                })

        _emit("log", {"content": f"API搜索完成，共 {len(items)} 条结果"})

        # 如果API搜索没有结果，回退到Playwright模式
        if not items:
            _emit("log", {"content": "API搜索无结果，回退到Playwright模式"})
            return crawl_icourse163(keyword=keyword, mode="search", max_results=page_size, event_callback=event_callback)

        return {
            "success": True,
            "items": items,
            "count": len(items),
        }

    except Exception as e:
        _emit("log", {"content": f"API搜索失败: {e}，回退到Playwright模式"})
        return crawl_icourse163(keyword=keyword, mode="search", max_results=page_size, event_callback=event_callback)


# 测试用
if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)

    def print_event(evt):
        evt_type = evt.get("type", "")
        content = evt.get("content", "")
        if evt_type == "result":
            print(f"[{evt.get('index')}] {evt.get('title')} - {evt.get('school')}")
        elif evt_type == "log":
            print(f"  {content}")

    print("=== 搜索 Python ===")
    result = crawl_icourse163(keyword="Python", max_results=5, event_callback=print_event)
    print(f"\n成功: {result['success']}, 数量: {result['count']}")
    for item in result.get("items", []):
        print(f"  - {item['title']} ({item['school']})")
        print(f"    封面: {item['cover_url']}")
        print(f"    链接: {item['url']}")
