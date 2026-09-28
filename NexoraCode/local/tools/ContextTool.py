"""当前本地会话的历史检索工具，不开放其他会话或任意文件路径。"""
from ..Tool import LocalTool, ToolContext


class ContextTool(LocalTool):
    def run(self, args: dict, context: ToolContext) -> dict:
        from model.ContextHistory import ContextHistory
        from model.ConversationStore import ConversationStore

        history = ContextHistory(ConversationStore(), context.conversation_id)

        if self.name == "local_context_length":
            result = history.length()
        elif self.name == "local_context_read":
            result = history.read(args["from_pos"], args.get("to_pos"))
        else:
            result = history.search(args["keyword"], args.get("max_hits", 20))

        return {"success": True, "result": result}


class ContextLengthTool(ContextTool):
    name = "local_context_length"
    description = "获取当前会话完整原始历史的字符长度。摘要未包含的事实可通过历史读取和搜索找回。"
    parameters = {"type": "object", "properties": {}, "required": []}


class ContextReadTool(ContextTool):
    name = "local_context_read"
    description = "按字符坐标读取当前会话原始历史，每次最多 20000 字符；返回 to_pos 和 has_more 供继续读取。"
    parameters = {"type": "object", "properties": {
        "from_pos": {"type": "integer", "minimum": 0},
        "to_pos": {"type": "integer", "minimum": 0},
    }, "required": ["from_pos"]}


class ContextSearchTool(ContextTool):
    name = "local_context_search"
    description = "在当前会话完整历史中搜索关键词，返回原始字符位置和附近片段，用于核实摘要中的具体事实。"
    parameters = {"type": "object", "properties": {
        "keyword": {"type": "string"},
        "max_hits": {"type": "integer", "minimum": 1, "maximum": 20},
    }, "required": ["keyword"]}
