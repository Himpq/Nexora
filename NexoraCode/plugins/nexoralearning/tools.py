"""Agent tools backed by the local NexoraLearning HTTP API."""

from __future__ import annotations

from urllib.parse import urlsplit

import requests

from local import LocalTool, ToolContext


class ListCoursesTool(LocalTool):
    name = "nexoralearning_list_lectures"
    description = "查询本地 NexoraLearning 中的课程，可按关键词筛选。"
    permission_operation = "network"
    parameters = {
        "type": "object",
        "properties": {
            "search": {
                "type": "string",
                "description": "可选关键词，匹配课程名称或说明。",
                "default": "",
            }
        },
        "required": [],
    }

    def __init__(self, api):
        self._api = api

    def run(self, args: dict, context: ToolContext) -> dict:
        if context.cancelled():
            return {"success": False, "error": "任务已取消"}

        settings = self._api.get_settings().get("values", {})
        base_url = str(settings.get("service_url") or "").strip().rstrip("/")
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return {"success": False, "error": "请先在 NexoraCode 设置中配置有效的 NexoraLearning 服务地址"}

        params = {}
        username = str(settings.get("username") or "").strip()
        if username:
            params["username"] = username

        try:
            response = requests.get(f"{base_url}/api/lectures", params=params, timeout=15)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            return {"success": False, "error": f"连接 NexoraLearning 失败：{exc}"}
        except ValueError:
            return {"success": False, "error": "NexoraLearning 返回了无效 JSON"}

        if not isinstance(payload, dict) or payload.get("success") is False:
            message = payload.get("error") if isinstance(payload, dict) else "响应格式不正确"
            return {"success": False, "error": str(message or "课程查询失败")}

        courses = payload.get("lectures") if isinstance(payload.get("lectures"), list) else []
        query = str(args.get("search") or "").strip().casefold()
        if query:
            courses = [
                item for item in courses
                if isinstance(item, dict)
                and query in " ".join(str(item.get(key) or "") for key in ("name", "title", "description")).casefold()
            ]

        result = []
        for item in courses[:100]:
            if not isinstance(item, dict):
                continue
            result.append({
                "id": str(item.get("id") or item.get("course_id") or ""),
                "name": str(item.get("name") or item.get("title") or ""),
                "description": str(item.get("description") or ""),
                "status": str(item.get("status") or ""),
            })

        return {"success": True, "total": len(result), "lectures": result}
