"""
火山引擎大模型封装类
使用Responses API，支持web_search和function calling同时使用
纯工具类，不包含终端输出逻辑
"""
import os
import json
from volcenginesdkarkruntime import Ark
from tools import TOOLS
from database import User
from conversation_manager import ConversationManager

ARK_API_KEY = ""

if 'HTTP_PROXY' in os.environ and os.environ['HTTP_PROXY']:
    del os.environ['HTTP_PROXY']
    del os.environ['HTTPS_PROXY']


class Model:
    """
    火山引擎大模型封装类，使用Responses API
    支持web_search和function calling同时使用
    """
    def __init__(self, username, model_name="", system_prompt=None, conversation_id=None, auto_create=True):
        """
        初始化Model类
        
        Args:
            username: 用户名，用于操作知识库
            model_name: 模型名称
            system_prompt: 系统级提示词
            conversation_id: 对话ID，如果为None且auto_create=True则创建新对话
            auto_create: 是否自动创建新对话（False时conversation_id为None将保持为None）
        """
        self.username = username
        self.user = User(username)
        self.model_name = model_name
        
        # 初始化对话管理器
        self.conversation_manager = ConversationManager(username)
        
        # 对话ID处理
        if conversation_id:
            self.conversation_id = conversation_id
        elif auto_create:
            self.conversation_id = self.conversation_manager.create_conversation()
        else:
            self.conversation_id = None
        self.conversation_created = conversation_id is not None  # 标记是否已创建对话
        
        # 初始化Ark客户端
        self.client = Ark(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=ARK_API_KEY
        )
        
        # 系统提示词
        self.system_prompt = system_prompt or self._get_default_system_prompt()
        
        # 转换TOOLS格式：从Chat API格式转换为Responses API格式
        self.tools = [
            # web_search工具 - 联网搜索
            {
                "type": "web_search",
                "max_keyword": 3,
                "limit": 10
            }
        ]
        
        # 转换function calling工具格式
        for tool in TOOLS:
            if tool["type"] == "function" and "function" in tool:
                func_def = tool["function"]
                # Responses API格式：去掉嵌套的function字段
                self.tools.append({
                    "type": "function",
                    "name": func_def["name"],
                    "description": func_def.get("description", ""),
                    "parameters": func_def.get("parameters", {})
                })
    
    def _get_default_system_prompt(self):
        """获取默认系统提示词"""
        return """你是智能助手，可以管理知识库并回答问题。

**知识库查询流程：**
1. 查询基础知识时，**优先使用 searchKeyword** 快速搜索相关内容
2. 如需完整内容，再调用 getKnowledgeList(_type=1) 获取标题列表
3. 最后调用 getBasisContent(title="具体标题") 获取完整内容

**上下文管理：**
1. 系统已提供最近3次交流的概览（用户问题+总结）
2. 需要详细内容时，使用以下工具：
   - getMainTitle(offset) - 获取之前某次交流的总结
   - getContext_findKeyword(offset, keyword, range) - 精确搜索关键词
   - getContext(offset, from, to) - 获取完整内容
3. **每次交流结束前，必须调用 setMainTitleOfThisConversation 总结本次交流**

**工具使用规则：**
- 优先从知识库获取答案（使用 searchKeyword 快速查找）
- 知识库没有相关内容时，使用 searchOnline 联网搜索
- web_search 完成后立即整理结果给出答案
- **严禁重复调用相同工具和参数** - 如果一次调用没有找到需要的信息，应该：
  1. 调整参数（如搜索不同的 offset、关键词或范围）
  2. 更换不同的工具（如从 getContext 改用 getContext_findKeyword）
  3. 如果多次尝试仍无结果，直接告知用户"未找到相关信息"并结束查询
- **完成工具调用后，必须给用户一个确认消息**，例如：
  - "好的，我已经成功保存了XXX到知识库中。"
  - "已为您查询到以下信息：..."
  - 然后调用 setMainTitleOfThisConversation 总结本次交流

**重要：setMainTitleOfThisConversation 使用规范：**
- 总结必须基于用户的原始问题和你的实际回答内容
- 禁止编造或臆测用户没有问过的问题（如用户问MyGO，不要总结成"询问时间"）
- 示例：用户问"MyGO是什么"→总结："介绍MyGO乐队信息并添加到知识库"
- 禁止：用户问"MyGO是什么"→总结："用户询问当前时间" ❌

- 使用 Markdown 格式回复"""
    
    def set_system_prompt(self, prompt):
        """设置新的系统提示词"""
        self.system_prompt = prompt
    
    def _get_history_messages(self, limit=10):
        """
        获取当前对话的历史消息，转换为API输入格式
        
        Args:
            limit: 获取最近N条消息（user和assistant配对）
            
        Returns:
            list: 格式化的消息列表（清理后，避免上下文污染）
        """
        messages = self.conversation_manager.get_messages(self.conversation_id)
        
        # 只保留user和assistant角色的消息
        formatted_messages = []
        for msg in messages[-limit*2:]:  # 获取最近的消息对
            if msg['role'] in ['user', 'assistant']:
                content = msg['content']
                
                # 清理assistant消息中的冗余描述性文字
                # 避免模型看到历史中的"让我XXX"后重复执行
                if msg['role'] == 'assistant':
                    # 移除常见的过渡性描述短语
                    unwanted_phrases = [
                        "让我查看", "让我查询", "让我获取", "让我检查",
                        "让我先", "首先让我", "我来", "我先"
                    ]
                    # 如果内容很短（<50字）且包含这些短语，可能是中间过程，跳过
                    if len(content) < 50:
                        skip = False
                        for phrase in unwanted_phrases:
                            if phrase in content:
                                skip = True
                                break
                        if skip:
                            continue
                
                formatted_messages.append({
                    "role": msg['role'],
                    "content": content
                })
        
        return formatted_messages
    
    def _execute_function(self, function_name, arguments):
        """
        执行函数调用（纯工具函数，不输出任何内容）
        优化返回值：直接返回简洁数据，减少token开销
        
        Args:
            function_name: 函数名称
            arguments: 函数参数(JSON字符串或字典)
            
        Returns:
            简化的结果数据（字符串或列表），失败时返回错误信息字符串
        """
        try:
            # 如果arguments是字符串，解析为字典
            if isinstance(arguments, str):
                args = json.loads(arguments)
            else:
                args = arguments
            
            # 参数验证：检测嵌套函数调用（参数幻觉）
            # Deepseek R1 可能会生成类似 get_weather:{city: get_location()} 的嵌套调用
            for key, value in args.items():
                if isinstance(value, str) and ('(' in value and ')' in value):
                    # 可能是嵌套函数调用，返回错误提示
                    return f"错误：参数 '{key}' 的值似乎是一个函数调用 '{value}'。请先调用该函数获取结果，然后再调用 {function_name}。"
            
            # 执行对应的函数并返回简化数据
            if function_name == "getKnowledgeList":
                result = self.user.getKnowledgeList(args.get("_type", 0))
                # 直接返回标题列表
                if isinstance(result, dict):
                    if args.get("_type", 0) == 0:  # 短期记忆
                        return "\n".join([f"{k}: {v}" for k, v in result.items()]) or "(空)"
                    else:  # 基础知识库
                        return "\n".join(result.keys()) or "(空)"
                return str(result)
            
            elif function_name == "addShort":
                self.user.addShort(args.get("title", ""))
                return "已添加到短期记忆"
            
            elif function_name == "addBasis":
                self.user.addBasis(
                    args.get("title", ""),
                    args.get("context", ""),
                    args.get("url", "")
                )
                return "已添加到基础知识库"
            
            elif function_name == "removeShort":
                self.user.removeShort(args.get("ID"))
                return "已从短期记忆删除"
            
            elif function_name == "removeBasis":
                self.user.removeBasis(args.get("title", ""))
                return "已从基础知识库删除"
            
            elif function_name == "getBasisContent":
                # 直接返回内容字符串
                content = self.user.getBasisContent(args.get("title", ""))
                return content
            
            elif function_name == "searchOnline":
                # 注意：使用Responses API时，web_search由模型自动调用
                return "searchOnline由web_search工具自动处理"
            
            elif function_name == "analyzeConnections":
                # 调用串联分析函数
                return self.analyzeConnections(args.get("title", ""))
            
            elif function_name == "getContextLength":
                offset = args.get("offset", 0)
                length = self.conversation_manager.get_context_length(offset)
                return f"对话长度: {length} 字符"
            
            elif function_name == "getContext":
                offset = args.get("offset", 0)
                from_pos = args.get("from_pos", 0)
                to_pos = args.get("to_pos", None)
                content = self.conversation_manager.get_context(offset, from_pos, to_pos)
                return content if content else "无内容"
            
            elif function_name == "getContext_findKeyword":
                offset = args.get("offset", 0)
                keyword = args.get("keyword", "")
                range_size = args.get("range", 10)
                result = self.conversation_manager.get_context_find_keyword(offset, keyword, range_size)
                return result
            
            elif function_name == "searchKeyword":
                keyword = args.get("keyword", "")
                range_size = args.get("range", 10)
                result = self.user.search_keyword(keyword, range_size)
                return result
            
            elif function_name == "setMainTitleOfThisConversation":
                main_title = args.get("main_title", "")
                # 设置当前交流的总结（会在add_message时保存）
                self._pending_exchange_summary = main_title
                return f"已设置本次交流总结: {main_title}"
            
            elif function_name == "getMainTitle":
                offset = args.get("offset", 0)
                title = self.conversation_manager.get_main_title(self.conversation_id, offset)
                return title
            
            else:
                return f"错误: 未知的函数 {function_name}"
                
        except Exception as e:
            return f"错误: {str(e)}"
    
    def sendMessage(self, msg, stream=True, max_rounds=10, enable_thinking=False, 
                    enable_web_search=True, enable_tools=True, show_token_usage=False,
                    load_history=False):
        """
        发送消息并处理函数调用（支持多轮对话）
        
        Args:
            msg: 用户消息内容
            stream: 是否使用流式输出
            max_rounds: 最大对话轮次，防止无限循环（默认10轮）
            enable_thinking: 是否启用深度思考模式
            enable_web_search: 是否启用联网搜索
            enable_tools: 是否启用工具调用
            show_token_usage: 是否显示token使用量
            load_history: 是否自动加载历史对话（False时模型需按需使用getContext工具）
            
        Yields:
            dict: 消息块
                - {"type": "content", "content": str} - 文本内容
                - {"type": "reasoning", "content": str} - 思考过程
                - {"type": "function_call", "name": str, "arguments": dict} - 函数调用
                - {"type": "function_result", "name": str, "result": str} - 函数结果
                - {"type": "token_usage", "input_tokens": int, "output_tokens": int, "total_tokens": int} - token使用量
                - {"type": "error", "content": str} - 错误
                - {"type": "done", "content": str} - 完成
        """
        try:
            # 如果还没有创建对话，现在创建
            if not self.conversation_created:
                self.conversation_id = self.conversation_manager.create_conversation()
                self.conversation_created = True
            
            # 记录用户消息到对话
            self.conversation_manager.add_message(
                self.conversation_id, 
                "user", 
                msg
            )
            
            # 构建初始输入：系统提示 + 最近交流总结 + 当前消息
            # 如果没有启用工具，修改system prompt避免模型输出JSON格式
            if enable_tools:
                system_content = self.system_prompt
            else:
                system_content = "你是智能助手，请直接用自然语言回答用户问题。使用 Markdown 格式回复。"
            
            input_data = [{"role": "system", "content": system_content}]
            
            # 添加最近交流的总结作为简短上下文（不加载完整内容）
            # 这样模型能知道之前聊过什么，但不会消耗大量token
            recent_summaries = self.conversation_manager.get_recent_exchange_summaries(
                self.conversation_id, limit=3
            )
            if recent_summaries:
                context_summary = "## 最近交流概览\n"
                for i, exchange in enumerate(recent_summaries, 1):
                    context_summary += f"{i}. 用户: {exchange['user']}...\n"
                    if 'summary' in exchange:
                        context_summary += f"   总结: {exchange['summary']}\n"
                
                input_data.append({
                    "role": "system",
                    "content": context_summary + "\n需要详细内容时请使用 getContext 系列工具查询。"
                })
            
            # 添加当前用户消息
            input_data.append({"role": "user", "content": msg})
            
            accumulated_content = ""
            previous_response_id = None
            function_outputs = []  # 收集本轮的函数调用结果
            last_function_calls = []  # 记录最近的函数调用（用于检测重复）
            self._pending_exchange_summary = None  # 待保存的交流总结
            
            # 创建日志文件记录所有通信
            import json
            from datetime import datetime
            log_dir = "./logs"
            if not os.path.exists(log_dir):
                os.makedirs(log_dir)
            log_file = os.path.join(log_dir, f"api_communication_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
            communication_log = {
                "start_time": datetime.now().isoformat(),
                "user_message": msg,
                "rounds": []
            }
            
            # 多轮对话循环
            for round_num in range(max_rounds):
                print(f"\n[DEBUG] ========== 第 {round_num + 1} 轮对话 ==========")
                print(f"[DEBUG] previous_response_id: {previous_response_id}")
                print(f"[DEBUG] 函数结果数量: {len(function_outputs)}")
                
                # 记录本轮开始前的content长度，用于回滚
                content_length_before_round = len(accumulated_content)
                current_round_function_calls = []  # 本轮的函数调用记录
                
                # 记录本轮日志
                round_log = {
                    "round": round_num + 1,
                    "previous_response_id": previous_response_id,
                    "request": {},
                    "response_chunks": [],
                    "final_state": {}
                }
                
                # 调用Responses API
                request_params = {
                    "model": self.model_name,
                    "stream": True  # 启用流式输出
                }
                
                # 只在启用深度思考且不使用工具时添加thinking参数
                # thinking和tools不能同时使用
                if enable_thinking and not enable_tools:
                    request_params["thinking"] = True
                
                # 根据enable_tools决定是否传入tools和max_tool_calls
                if enable_tools:
                    request_params["tools"] = self.tools
                    # max_tool_calls设为1，每轮只调用一次工具，更容易控制流程
                    request_params["max_tool_calls"] = 1
                    # 禁用并行工具调用（deepseek-v3-1-terminus不支持parallel_tool_calls控制字段）
                    # request_params["parallel_tool_calls"] = False
                
                # 首次调用传入用户消息
                if previous_response_id is None:
                    request_params["input"] = input_data
                else:
                    # 后续轮次：保留完整上下文 + 追加函数调用结果
                    # 重新构建完整input，确保模型能看到用户原始问题
                    request_params["previous_response_id"] = previous_response_id
                    # 将function_outputs作为tool消息追加到input_data后面
                    full_input = input_data.copy()
                    full_input.extend(function_outputs)
                    request_params["input"] = full_input
                    print(f"[DEBUG] 传递完整上下文，消息数量: {len(full_input)}")
                
                response = self.client.responses.create(**request_params)
                
                # 清空函数输出准备收集新的
                function_outputs = []
                has_function_call = False
                has_web_search = False
                has_content = False
                current_response_id = None
                round_content = ""  # 本轮的内容
                
                chunk_count = 0
                # 流式解析响应
                for chunk in response:
                    chunk_count += 1
                    if chunk_count <= 10:  # 打印前10个chunk
                        print(f"[DEBUG] Chunk {chunk_count}: {chunk}")
                    
                    # 获取chunk类型
                    chunk_type = getattr(chunk, 'type', None)
                    if chunk_count <= 15:
                        print(f"[DEBUG] Chunk {chunk_count} type: {chunk_type}")
                    
                    # 记录chunk到日志（前100个chunk）
                    if chunk_count <= 100:
                        try:
                            chunk_log = {
                                "index": chunk_count,
                                "type": chunk_type,
                                "data": str(chunk)[:500]  # 限制长度
                            }
                            round_log["response_chunks"].append(chunk_log)
                        except:
                            pass
                    
                    # 记录特殊事件（排除所有 delta 增量事件和常规流程事件）
                    if chunk_type not in [
                        'response.reasoning_summary_text.delta',
                        'response.output_text.delta', 
                        'response.function_call_arguments.delta',
                        'response.created', 
                        'response.in_progress'
                    ]:
                        print(f"[DEBUG] !!! 特殊事件 chunk {chunk_count}: {chunk_type}")
                        if chunk_count <= 50:  # 打印前50个特殊事件的详情
                            print(f"[DEBUG] 特殊事件详情: {chunk}")
                    
                    # 保存response_id用于下一轮
                    if hasattr(chunk, 'id') and chunk.id:
                        current_response_id = chunk.id
                        print(f"[DEBUG] 从chunk.id获取到 response_id: {current_response_id}")
                    
                    # 从response对象中获取id
                    if hasattr(chunk, 'response') and hasattr(chunk.response, 'id'):
                        current_response_id = chunk.response.id
                        print(f"[DEBUG] 从chunk.response.id获取到 response_id: {current_response_id}")
                    
                    # 处理推理摘要文本增量事件（只在启用thinking时发送到前端）
                    if chunk_type == 'response.reasoning_summary_text.delta':
                        reasoning_delta = getattr(chunk, 'delta', '')
                        if reasoning_delta and enable_thinking:
                            yield {
                                "type": "reasoning_delta",
                                "content": reasoning_delta
                            }
                        continue
                    
                    # 处理消息内容增量事件
                    if chunk_type == 'response.output_text.delta':
                        content_delta = getattr(chunk, 'delta', '')
                        if content_delta:
                            has_content = True
                            round_content += content_delta  # 累加到本轮内容
                            accumulated_content += content_delta  # 也累加到总内容（暂时）
                            yield {
                                "type": "content_delta",
                                "content": content_delta
                            }
                        continue
                    
                    # 处理函数调用参数增量事件（静默处理，不输出）
                    if chunk_type == 'response.function_call_arguments.delta':
                        # delta 事件只是参数构建过程，在 done 事件中才处理完整参数
                        continue
                    
                    # 处理web搜索事件
                    if chunk_type in ['response.web_search_call.in_progress', 'response.web_search_call.searching', 'response.web_search_call.completed']:
                        has_web_search = True
                        print(f"[DEBUG] Web搜索事件: {chunk_type}")
                        if chunk_type == 'response.web_search_call.searching':
                            yield {
                                "type": "web_search",
                                "content": "正在联网搜索..."
                            }
                        continue
                    
                    # 检查响应完成事件 - 在这里处理完成后的output
                    if chunk_type == 'response.done' or chunk_type == 'response.completed':
                        print(f"[DEBUG] 响应完成事件: {chunk_type}")
                        if hasattr(chunk, 'response'):
                            resp = chunk.response
                            resp_status = getattr(resp, 'status', 'N/A')
                            resp_output = getattr(resp, 'output', None)
                            print(f"[DEBUG] Response status: {resp_status}")
                            print(f"[DEBUG] Response output: {resp_output}")
                            
                            # 如果启用了token统计，发送使用量
                            if show_token_usage and hasattr(resp, 'usage'):
                                usage = resp.usage
                                yield {
                                    "type": "token_usage",
                                    "input_tokens": getattr(usage, 'input_tokens', 0),
                                    "output_tokens": getattr(usage, 'output_tokens', 0),
                                    "total_tokens": getattr(usage, 'total_tokens', 0)
                                }
                            
                            # 在响应完成时，处理最终的output
                            if resp_output:
                                print(f"[DEBUG] 处理完成后的output，数量: {len(resp_output)}")
                                for output_item in resp_output:
                                    item_type = getattr(output_item, 'type', None)
                                    print(f"[DEBUG] 完成后的Output item type: {item_type}")
                                    
                                    # 处理函数调用
                                    if item_type == 'function_call':
                                        has_function_call = True
                                        func_name = getattr(output_item, 'name', None)
                                        func_args_str = getattr(output_item, 'arguments', '{}')
                                        call_id = getattr(output_item, 'call_id', None)
                                        
                                        print(f"[DEBUG] 函数调用: {func_name}, 参数: {func_args_str}, call_id: {call_id}")
                                        
                                        yield {
                                            "type": "function_call",
                                            "name": func_name,
                                            "arguments": func_args_str,
                                            "call_id": call_id
                                        }
                                        
                                        # 执行函数
                                        result = self._execute_function(func_name, func_args_str)
                                        print(f"[DEBUG] 函数执行结果: {result[:200] if isinstance(result, str) and len(result) > 200 else result}")
                                        
                                        # 记录本轮函数调用（用于检测重复）
                                        func_call_str = f"{func_name}({func_args_str})"
                                        current_round_function_calls.append(func_call_str)
                                        print(f"[DEBUG] 记录函数调用: {func_call_str}")
                                        
                                        yield {
                                            "type": "function_result",
                                            "name": func_name,
                                            "result": result,
                                            "call_id": call_id
                                        }
                                        
                                        # 将函数结果添加到下一轮的input中
                                        result_str = result if isinstance(result, str) else str(result)
                                        function_outputs.append({
                                            "type": "function_call_output",
                                            "call_id": call_id,
                                            "output": result_str
                                        })
                                    
                                    # 处理最终消息
                                    elif item_type == 'message':
                                        has_content = True
                                        if hasattr(output_item, 'content'):
                                            for content_item in output_item.content:
                                                if hasattr(content_item, 'text'):
                                                    text_chunk = content_item.text
                                                    accumulated_content += text_chunk
                                                    yield {
                                                        "type": "content_delta",
                                                        "content": text_chunk
                                                    }
                    
                    # 解析输出
                    if hasattr(chunk, 'output') and chunk.output:
                        print(f"[DEBUG] Chunk有output，数量: {len(chunk.output)}")
                        for output_item in chunk.output:
                            item_type = getattr(output_item, 'type', None)
                            print(f"[DEBUG] Output item type: {item_type}")
                            
                            # 1. 推理/思考过程
                            if item_type == 'reasoning':
                                reasoning_text = ""
                                if hasattr(output_item, 'summary'):
                                    for summary_item in output_item.summary:
                                        if hasattr(summary_item, 'text'):
                                            reasoning_text += summary_item.text
                                if reasoning_text:
                                    yield {
                                        "type": "reasoning",
                                        "content": reasoning_text
                                    }
                            
                            # 2. 函数调用
                            elif item_type == 'function_call':
                                has_function_call = True
                                func_name = getattr(output_item, 'name', None)
                                func_args_str = getattr(output_item, 'arguments', '{}')
                                call_id = getattr(output_item, 'call_id', None)
                                
                                print(f"[DEBUG] 函数调用: {func_name}, 参数: {func_args_str}, call_id: {call_id}")
                                
                                yield {
                                    "type": "function_call",
                                    "name": func_name,
                                    "arguments": func_args_str,
                                    "call_id": call_id
                                }
                                
                                # 执行函数
                                result = self._execute_function(func_name, func_args_str)
                                print(f"[DEBUG] 函数执行结果: {result[:200] if isinstance(result, str) and len(result) > 200 else result}")
                                
                                # 记录本轮函数调用（用于检测重复）
                                func_call_str = f"{func_name}({func_args_str})"
                                current_round_function_calls.append(func_call_str)
                                print(f"[DEBUG] 记录函数调用: {func_call_str}")
                                
                                yield {
                                    "type": "function_result",
                                    "name": func_name,
                                    "result": result,
                                    "call_id": call_id
                                }
                                
                                # 将函数结果添加到下一轮的input中
                                result_str = result if isinstance(result, str) else str(result)
                                function_output = {
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": result_str
                                }
                                function_outputs.append(function_output)
                                print(f"[DEBUG] 添加function_output到列表: call_id={call_id}, output长度={len(result_str)}")
                            
                            # 3. Web搜索调用（内置工具，API自动处理）
                            elif item_type == 'web_search_call':
                                has_web_search = True
                                yield {
                                    "type": "web_search",
                                    "content": "执行联网搜索..."
                                }
                            
                            # 4. 最终消息输出
                            elif item_type == 'message':
                                has_content = True
                                # 注意：内容已经在output_text.delta事件中累加过了
                                # 这里不需要再累加，否则会导致内容重复
                                if hasattr(output_item, 'content'):
                                    for content_item in output_item.content:
                                        if hasattr(content_item, 'text'):
                                            text_chunk = content_item.text
                                            # 不再累加到accumulated_content（避免重复）
                                            # 只在没有delta事件的情况下才输出（备用）
                                            if not round_content:  # 如果delta没有内容，使用完整文本
                                                round_content += text_chunk
                                                accumulated_content += text_chunk
                                                yield {
                                                    "type": "content",
                                                    "content": text_chunk
                                                }
                
                print(f"[DEBUG] ========== 流式响应结束，共 {chunk_count} 个chunk ==========")
                print(f"[DEBUG] has_content: {has_content}, has_function_call: {has_function_call}, has_web_search: {has_web_search}")
                print(f"[DEBUG] accumulated_content 长度: {len(accumulated_content)}")
                print(f"[DEBUG] current_response_id: {current_response_id}")
                
                # 记录本轮最终状态
                round_log["final_state"] = {
                    "has_content": has_content,
                    "has_function_call": has_function_call,
                    "has_web_search": has_web_search,
                    "accumulated_content_length": len(accumulated_content),
                    "accumulated_content": accumulated_content,  # 记录当前累积内容
                    "current_response_id": current_response_id,
                    "function_calls": current_round_function_calls
                }
                communication_log["rounds"].append(round_log)
                
                # 每轮结束后立即保存日志（防止中途出错丢失）
                try:
                    with open(log_file, 'w', encoding='utf-8') as f:
                        json.dump(communication_log, f, ensure_ascii=False, indent=2)
                    print(f"[LOG] 第 {round_num + 1} 轮日志已保存")
                except Exception as e:
                    print(f"[ERROR] 保存第 {round_num + 1} 轮日志失败: {str(e)}")
                
                # 保存本轮的response_id
                if current_response_id:
                    previous_response_id = current_response_id
                
                # 检查是否达到最大轮数
                if round_num >= max_rounds - 1:
                    print(f"[WARNING] 已达到最大对话轮数 {max_rounds}，强制结束")
                    if not accumulated_content:
                        accumulated_content = "抱歉，操作步骤过多，已达到最大处理轮数限制。请简化您的请求或分多次提问。"
                    break
                
                # 判断是否需要继续下一轮
                # 优先级1: 如果本轮有函数调用，需要先处理完函数
                if function_outputs:
                    # 检查是否调用了setMainTitleOfThisConversation
                    # 如果调用了这个函数，说明模型认为对话已完成，不应继续
                    has_set_main_title = any('setMainTitleOfThisConversation' in call for call in current_round_function_calls)
                    
                    if has_set_main_title:
                        print(f"[DEBUG] 检测到setMainTitleOfThisConversation调用，对话完成")
                        # 如果accumulated_content为空，说明之前被回滚了
                        # 需要生成一个完成提示，避免报错
                        if not accumulated_content or len(accumulated_content) < 20:
                            accumulated_content = "已完成您的请求。"
                        break
                    
                    # 检测函数调用重复
                    print(f"[DEBUG] 检查重复：current={current_round_function_calls}, last={last_function_calls}")
                    if current_round_function_calls and last_function_calls:
                        # 比较本轮和上轮的函数调用
                        if current_round_function_calls == last_function_calls:
                            print(f"[WARNING] 检测到重复的函数调用模式！")
                            print(f"[WARNING] 本轮: {current_round_function_calls}")
                            print(f"[WARNING] 上轮: {last_function_calls}")
                            print(f"[WARNING] 强制结束循环，避免无限重复")
                            # 给用户一个提示
                            if not accumulated_content or len(accumulated_content) < 50:
                                accumulated_content = "检测到重复操作，已自动停止。知识库查询结果已获取。"
                            break
                    
                    # 额外检查：如果轮次过多(>5轮)且一直在调用函数，强制结束
                    if round_num >= 4 and function_outputs:
                        print(f"[WARNING] 已进行{round_num + 1}轮对话且仍在调用函数，可能陷入循环")
                        if not accumulated_content or len(accumulated_content) < 50:
                            accumulated_content = "抱歉，处理过程较复杂，已自动停止。请简化您的请求。"
                        break
                    
                    # 记录本轮的函数调用，用于下轮比较
                    last_function_calls = current_round_function_calls.copy()
                    
                    # 有函数调用且有结果要回传，继续下一轮（优先处理函数调用）
                    print(f"[DEBUG] 有函数调用结果需要回传，继续第 {round_num + 2} 轮")
                    print(f"[DEBUG] 本轮content长度: {len(round_content)} 字符")
                    # 回滚accumulated_content：移除本轮添加的中间描述性内容
                    # 保留这些内容会导致用户看到重复的"让我XXX"描述
                    accumulated_content = accumulated_content[:content_length_before_round]
                    print(f"[DEBUG] 回滚后accumulated_content长度: {len(accumulated_content)}")
                    # 发送清除事件，通知前端清除本轮的中间内容
                    yield {
                        "type": "clear_round_content",
                        "reason": "continuing_with_function_call"
                    }
                    continue
                
                # 优先级2: 如果有web_search或实质性内容，对话可以结束
                elif has_web_search or (has_content and len(accumulated_content) > 50):
                    print(f"[DEBUG] 对话完成（has_web_search={has_web_search}, has_content={has_content}, accumulated_content长度={len(accumulated_content)}）")
                    break
                
                else:
                    # 其他情况：没有足够内容，也没有函数调用
                    print(f"[DEBUG] 其他情况退出：has_content={has_content}, has_function_call={has_function_call}, has_web_search={has_web_search}")
                    if not accumulated_content:
                        accumulated_content = "抱歉，处理出现异常，未能获取有效响应。"
                    break
            
            # 记录助手回复到对话
            if accumulated_content:
                # 准备metadata，包含交流总结
                metadata = {}
                if self._pending_exchange_summary:
                    metadata["exchange_summary"] = self._pending_exchange_summary
                
                self.conversation_manager.add_message(
                    self.conversation_id,
                    "assistant",
                    accumulated_content,
                    metadata if metadata else None
                )
                
                # 如果是第一次对话（消息数为2），生成标题
                conversation = self.conversation_manager.get_conversation(self.conversation_id)
                if len(conversation['messages']) == 2 and conversation.get('title') == '新对话':
                    # 生成简洁标题（取用户第一句话的前20个字）
                    title = msg[:20] if len(msg) <= 20 else msg[:17] + "..."
                    self.conversation_manager.update_title(self.conversation_id, title)
                    yield {"type": "title", "title": title}
                    # 只在第一次对话后才发送refresh_list事件
                    yield {"type": "refresh_list", "is_new": True}
            else:
                # 如果没有内容，可能是因为达到max_tool_calls限制
                print(f"[ERROR] 模型未生成有效回复")
                print(f"[DEBUG] round_num: {round_num}, has_content: {has_content}")
                print(f"[DEBUG] has_function_call: {has_function_call}, function_outputs: {function_outputs}")
                print(f"[DEBUG] has_web_search: {has_web_search}")
                print(f"[DEBUG] previous_response_id: {previous_response_id}")
                print(f"[DEBUG] accumulated_content: '{accumulated_content}'")
                error_msg = "模型未能生成有效回复（可能达到最大工具调用限制）"
                yield {"type": "error", "content": error_msg}
            
            # 保存通信日志
            communication_log["end_time"] = datetime.now().isoformat()
            communication_log["final_content"] = accumulated_content
            try:
                with open(log_file, 'w', encoding='utf-8') as f:
                    json.dump(communication_log, f, ensure_ascii=False, indent=2)
                print(f"\n[LOG] 通信日志已保存到: {log_file}")
            except Exception as e:
                print(f"[ERROR] 保存日志失败: {str(e)}")
            
            yield {"type": "done", "content": accumulated_content}
                
        except Exception as e:
            import traceback
            print(f"[ERROR] 聊天异常: {str(e)}")
            traceback.print_exc()
            yield {"type": "error", "content": str(e)}
    
    def reset_conversation(self):
        """重置对话历史"""
        pass  # Responses API自动管理上下文，无需手动重置
    
    def get_conversation_history(self):
        """获取对话历史"""
        return []  # Responses API自动管理，不暴露历史
    
    def analyzeConnections(self, title):
        """分析知识串联关系"""
        try:
            connections = self.user.get_knowledge_connections(title)
            
            if not connections:
                return f"知识【{title}】暂无串联关系"
            
            result = f"知识【{title}】的串联关系分析：\n\n"
            for conn in connections:
                from_title = conn['from']
                to_title = conn['to']
                rel_type = conn['type']
                description = conn.get('description', '')
                
                # 判断方向
                if from_title == title:
                    result += f"→ {rel_type} 【{to_title}】"
                else:
                    result += f"← {rel_type} 【{from_title}】"
                
                if description:
                    result += f"：{description}"
                result += "\n"
            
            return result
            
        except Exception as e:
            return f"分析串联关系失败：{str(e)}"


# 测试代码
if __name__ == "__main__":
    import sys
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    os.chdir(parent_dir)
    
    print(f"工作目录: {os.getcwd()}\n")
    
    model = Model("test_user")
    
    # 测试
    user_input = input(">>> ")
    for chunk in model.sendMessage(user_input, stream=False):
        print(chunk)
