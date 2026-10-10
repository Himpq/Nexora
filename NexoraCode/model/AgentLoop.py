"""
NexoraCode.model.AgentLoop — 本地 Agent Loop

对话在本地驱动：维护消息历史 → 调 Provider 流式推理 → 解析 tool_calls →
本地执行工具 → 回传结果 → 循环，直到模型不再调用工具。

对外提供：
- AgentLoop.stream_send(): 流式生成器，yield 对齐云端 SSE 的事件：
  content / function_call / function_result / question / conversation_id / done
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any, Generator, Optional

from core.config import config
from local import ToolExecutor
from .Provider import ProviderClient, ProviderConfig, _extract_usage_io
from .ConversationStore import ConversationStore, is_placeholder_title
from .ContextManager import ContextManager
from .RetrySettings import DEFAULT_EMPTY_RESPONSE_RETRY_COUNT, configured_retry_count
from .TitleGenerator import maybe_generate_title
from .ToolPermissionPolicy import (
    build_tool_permission_question,
    create_pending_tool_action,
    evaluate_tool_call,
    get_permission_settings,
)
from .turn_injection import plan_injection


# 会话级已询问过的权限路径记忆（path 归一化），避免授权后模型重试同路径时反复弹卡。
_PERMISSION_ASKED_LOCK = threading.Lock()
_PERMISSION_ASKED: dict[str, set] = {}

# 会话级「因权限不足被阻断」的待续跑登记：授权接口据此自动续跑本轮。
# 保存恢复所需的完整信息（被阻断的 tool_call_id、工具名、原始参数、请求路径）：
# 授权后由服务端直接执行这次调用，把真实结果写回占位消息，再让模型基于
# 真实结果继续——比让模型自己重新发起调用可靠（模型常顺着"等待授权"的
# 上下文继续说话，而不是重试工具）。
_PENDING_RESUME_LOCK = threading.Lock()
_PENDING_RESUME: dict[str, dict] = {}
# 续跑登记的有效期：超过这个时间的授权不再自动续跑（用户早已离开该上下文）。
_PENDING_RESUME_TTL_SECONDS = 30 * 60


def register_pending_permission_resume(
    conversation_id: str,
    *,
    tool_call_id: str,
    tool_name: str,
    path: str,
    operation: str,
    arguments: Any = None,
    project_root: str = "",
) -> None:
    """登记一次被权限阻断的续跑点，供授权成功后自动续跑。"""
    clean_conversation_id = str(conversation_id or "").strip()

    if not clean_conversation_id:
        return

    frozen_arguments = arguments if isinstance(arguments, dict) else {}

    with _PENDING_RESUME_LOCK:
        _cleanup_pending_resume_locked()
        _PENDING_RESUME[clean_conversation_id] = {
            "conversation_id": clean_conversation_id,
            "tool_call_id": str(tool_call_id or "").strip(),
            "tool_name": str(tool_name or "").strip(),
            "path": str(path or "").strip(),
            "operation": str(operation or "read").strip().lower() or "read",
            "arguments": dict(frozen_arguments),
            "project_root": str(project_root or "").strip(),
            "created_at": time.time(),
        }


def take_pending_permission_resume(conversation_id: str) -> dict | None:
    """原子领取并清除待续跑登记，避免并发授权导致重复续跑。"""
    clean_conversation_id = str(conversation_id or "").strip()

    if not clean_conversation_id:
        return None

    with _PENDING_RESUME_LOCK:
        _cleanup_pending_resume_locked()
        return _PENDING_RESUME.pop(clean_conversation_id, None)


def peek_pending_permission_resume(conversation_id: str) -> dict | None:
    """只读查询待续跑登记（不消费），用于判断是否存在被阻断的流。"""
    clean_conversation_id = str(conversation_id or "").strip()

    if not clean_conversation_id:
        return None

    with _PENDING_RESUME_LOCK:
        _cleanup_pending_resume_locked()
        item = _PENDING_RESUME.get(clean_conversation_id)
        return dict(item) if item else None


def _cleanup_pending_resume_locked() -> None:
    now = time.time()
    expired = [
        conversation_id
        for conversation_id, item in _PENDING_RESUME.items()
        if now - float(item.get("created_at") or 0) > _PENDING_RESUME_TTL_SECONDS
    ]

    for conversation_id in expired:
        _PENDING_RESUME.pop(conversation_id, None)

DEFAULT_SYSTEM_PROMPT = (
    "你是 NexoraCode，运行在用户本地电脑上的编程助手。"
    "你可以通过 local_* 工具读取/修改用户本地文件、执行命令、搜索代码，"
    "以完成用户的开发任务。执行文件操作时保持在用户项目根路径内，"
    "所有文件路径必须以项目根路径为基准精确构造，禁止编造、猜测或沿用旧路径；"
    "不确定目录结构时先 local_file_list 项目根路径。"
    "需要用户授权访问路径时，系统会自动向用户发起权限询问，无需额外调用权限工具。"
)


def _truncate_approval_context(value: Any, max_chars: int = 1600) -> str:
    """限制附加给审批模型的历史上下文长度，并明确标记截断。"""
    text = str(value or "")

    if len(text) <= max_chars:
        return text

    return text[:max_chars] + "\n[审批上下文已截断]"


# 审批上下文预算：头/尾固定保留，中间历史按此字符预算裁剪。
_APPROVAL_HEAD_KEEP = 1        # 固定保留会话最初 1 条用户请求，锚定任务大方向
_APPROVAL_TAIL_USER_KEEP = 2   # 固定保留最近 2 条历史用户请求（当前请求单独保留）
_APPROVAL_TAIL_REPLY_KEEP = 2  # 固定保留最近 2 条助手可见回复
_APPROVAL_MIDDLE_BUDGET = 1200  # 中间历史允许占用的字符预算


def _collect_role_texts(conversation_messages: list, role: str) -> list[str]:
    """按时间顺序收集指定角色的可见文本（空内容跳过）。"""
    texts: list[str] = []

    for message in conversation_messages:
        if not isinstance(message, dict) or message.get("role") != role:
            continue

        text = _truncate_approval_context(message.get("content"))

        if text:
            texts.append(text)

    return texts


def _build_approval_context(
    user_text: str,
    conversation_messages: list,
    assistant_explanation: str,
    previous_actions: list[dict],
) -> dict:
    """构造审批模型的上下文：头固定 + 尾固定 + 中间可裁并显式标注。

    设计目标：让审批模型既能看清"任务最初要什么"（头），也能看清"此刻在做什么、
    用户最近授权了什么"（尾）。中间的历史按字符预算裁剪，被裁掉的部分显式标注条数，
    避免模型因"关键上下文被静默丢弃"而误判为意图不匹配。
    """
    user_history = _collect_role_texts(conversation_messages, "user")
    reply_history = _collect_role_texts(conversation_messages, "assistant")

    # 头：会话最初若干条用户请求（若与尾部重叠则不重复计入）。
    head_user = user_history[:_APPROVAL_HEAD_KEEP]
    # 尾：最近若干条历史用户请求，去掉与头重叠的部分。
    tail_user = user_history[_APPROVAL_HEAD_KEEP:][-_APPROVAL_TAIL_USER_KEEP:]
    tail_reply = reply_history[-_APPROVAL_TAIL_REPLY_KEEP:]

    # 中间：剩余的用户请求与助手回复，按预算裁剪。
    middle_user = user_history[_APPROVAL_HEAD_KEEP:][:-_APPROVAL_TAIL_USER_KEEP] if _APPROVAL_TAIL_USER_KEEP else user_history[_APPROVAL_HEAD_KEEP:]
    middle_reply = reply_history[:-_APPROVAL_TAIL_REPLY_KEEP] if _APPROVAL_TAIL_REPLY_KEEP else reply_history

    middle_kept_user: list[str] = []
    middle_kept_reply: list[str] = []
    used = 0
    omitted = 0

    # 中间历史从近到远保留，超出预算的部分计入省略条数。
    for text in reversed(middle_user):
        if used + len(text) > _APPROVAL_MIDDLE_BUDGET:
            omitted += 1
            continue
        used += len(text)
        middle_kept_user.insert(0, text)

    for text in reversed(middle_reply):
        if used + len(text) > _APPROVAL_MIDDLE_BUDGET:
            omitted += 1
            continue
        used += len(text)
        middle_kept_reply.insert(0, text)

    omitted_note = ""
    if omitted > 0:
        omitted_note = f"（中间另有 {omitted} 条较早对话因长度限制已省略，仅作参考）"

    return {
        "user_intent": user_text,
        "previous_user_requests": tail_user,
        "assistant_explanation": assistant_explanation,
        "previous_agent_replies": tail_reply,
        "previous_actions": previous_actions,
        # 头：任务最初的目标，用于理解整体方向。
        "initial_user_request": head_user[0] if head_user else "",
        # 中间：较早但仍可能相关的对话，已按预算裁剪并标注省略。
        "earlier_user_requests": middle_kept_user,
        "earlier_agent_replies": middle_kept_reply,
        "omitted_history_note": omitted_note,
    }


def _log_elapsed_ms(
    stage: str,
    started_at: float,
    round_index: int,
    call_ordinal: Optional[int] = None,
    detail: str = "",
) -> None:
    """记录本地 Agent 阶段耗时，不输出会话或工具调用内容。"""
    identifiers = f"round={round_index}"

    if call_ordinal is not None:
        identifiers += f" call={call_ordinal}"

    suffix = f" {detail}" if detail else ""
    elapsed_ms = (time.monotonic() - started_at) * 1000
    print(f"[LocalAgentTiming] {identifiers} {stage}_ms={elapsed_ms:.1f}{suffix}")


class AgentLoop:
    def __init__(
        self,
        provider: ProviderClient,
        executor: ToolExecutor,
        store: ConversationStore,
    ):
        self.provider = provider
        self.executor = executor
        self.store = store
        self.context_manager = ContextManager(provider, store)

    def stream_send(self, conversation_id: str, user_text: str, system_prompt: str = "", cancel_checker: Any = None, force_context_compression: bool = False, injection_sources: Any = None, skip_user_message: bool = False) -> Generator[dict, None, None]:
        conversation = self.store.get(conversation_id) if conversation_id else None

        if conversation is None:
            conversation = self.store.create()

        conversation_id = str(conversation.get("conversation_id") or "")
        project_path = _project_path_from_conversation(conversation)
        model_name = self._model_name()
        conversation_messages = conversation.get("messages")
        conversation_messages = conversation_messages if isinstance(conversation_messages, list) else []
        print(f"[LocalAgent] stream_send start: conversation_id={conversation_id} user_text={user_text[:60]!r} project_root={project_path or '(none)'}")

        yield {"type": "conversation_id", "conversation_id": conversation_id}
        yield {"type": "model_info", "model_name": model_name, "provider": self._provider_name(), "search_enabled": False}

        # 历史自愈：进程被外部终止（工具命令杀掉自身、崩溃）时，落盘历史可能停在
        # assistant.tool_calls 而没有对应的 tool 结果。补齐占位结果并落盘，
        # 否则该会话此后每次请求都会在工具协议校验处失败、永久不可用。
        repaired_count = self.store.repair_dangling_tool_calls(conversation_id)

        if repaired_count:
            print(f"[LocalAgent] repaired_dangling_tool_calls conversation={conversation_id} added={repaired_count}")
            conversation = self.store.get(conversation_id) or conversation
            conversation_messages = conversation.get("messages")
            conversation_messages = conversation_messages if isinstance(conversation_messages, list) else []

        # 首条消息落盘前先取原标题：append_message 会把占位标题替换为截断标题，
        # 只有此刻仍是占位值才说明这是首条消息，值得异步生成智能标题。
        # 权限授权后的自动续跑不落盘用户消息：本轮 user 消息与工具占位结果都已在历史里，
        # 再写一条会让对话出现多余的「继续」气泡。
        title_before_append = str(conversation.get("title") or "")

        if not skip_user_message:
            self.store.append_message(conversation_id, {"role": "user", "content": user_text, "timestamp": _now()})

            if is_placeholder_title(title_before_append):
                maybe_generate_title(conversation_id, user_text, title_before_append)

        effective_system = str(system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT

        if get_permission_settings()["mode"] == "auto":
            effective_system += (
                "\n\n自动审批协作要求：调用写入、命令或进程变更工具前，先在普通回复中用一句简短的话说明"
                "准备执行什么操作，以及它如何对应当前用户请求；不要输出内部推理。"
            )

        # tail 注入块（项目约定 / 自定义提示词）：按基线比对决定是否注入。
        # 首轮全量注入并建立基线；后续只在内容变化时注入 diff，稳定轮次不注入，
        # 这样 [head + 历史] 前缀始终可缓存。
        # 另外准备一份忽略基线的全量块：上下文被压缩重建时历史被摘要替换，
        # 此前的注入块已从窗口消失，必须用全量块重新注入一次。
        # 基线不在这里落盘：首轮请求可能失败，失败前写基线会让重发不再注入，
        # 因此推迟到首轮 provider 成功产出后再落盘。
        volatile_blocks, volatile_full_blocks, injection_baseline, injection_diag, injection_full_diag = self._resolve_injection_blocks(
            conversation_id, injection_sources, len(effective_system)
        )
        injection_baseline_saved = False

        if injection_diag:
            yield {
                "type": "context_injection",
                "blocks": injection_diag["blocks"],
                "head_chars": injection_diag["head_chars"],
            }

        # 本次请求首轮压缩的终态事件（start→progress*→done/skipped/trimmed 的最后一条）。
        # 落盘进 assistant metadata，保证重进对话后压缩卡片仍可见（前端历史回放数据源）。
        compression_step: dict | None = None

        question_sent = False
        permission_blocked = False
        approval_action_history: list[dict] = []
        # 一次 stream_send = 一个 trace，跨工具轮次的所有 usage 记录都挂在它下面，
        # 便于把预估与实测、对话记录与压缩调用对应起来（对齐云端 response_trace_id）。
        response_trace_id = uuid.uuid4().hex
        # 本次请求内第几次调用模型，从 1 开始；provider 尚未返回过 usage 时为 0。
        round_index = 0
        # 最终答复是否已落盘：正常完成/中断落盘都置位，避免中断路径重复落盘。
        final_persisted = False
        # 工具结果已经返回但正文为空时，按设置次数额外请求模型回复。
        tool_results_executed = 0
        empty_post_tool_retry_count = 0
        empty_post_tool_retry_limit = configured_retry_count(
            config,
            "local_empty_response_retry_count",
            DEFAULT_EMPTY_RESPONSE_RETRY_COUNT,
        )
        retry_after_empty_post_tool_response = False
        # 上一轮产生的文本与 usage（中断落盘用，循环内每轮更新）。
        content_text = ""
        reasoning_text = ""
        last_round_io = None
        last_round_had_tool_calls = False
        last_tool_result_yielded_at = 0.0

        # 本次请求跨工具轮次的 usage 累计（provider 每轮流式返回 usage 时更新）
        totals = {
            "raw_input": 0,
            "cached_input": 0,
            "effective_input": 0,
            "output": 0,
            "total": 0,
            "cost": 0.0,
        }
        request_first_round_chars = 0
        context_window = self._context_window()

        # 本次请求的 badge timing：落盘进消息 metadata，重进对话后前端可从快照恢复。
        # providerMs 为跨全部工具轮次的「净模型生成时长」累计（不含工具执行/权限审批/
        # 网络往返等待），前端 token 速率以此为分母，避免工具轮把速率摊薄。
        badge_timing = {
            "startedAt": int(time.time() * 1000),
            "firstTokenAt": 0,
            "endedAt": 0,
            "cachedInput": 0,
            "rawInput": 0,
            "outputTokens": 0,
            "providerMs": 0,
        }

        def _snapshot_timing(ended: bool = False) -> None:
            """写入请求级用量快照（缓存命中 / 原始输入 / 输出 / 净生成时长）。

            中断与模型异常路径同样要带上缓存数据，否则徽标上只有输出没有命中率。
            """
            badge_timing["cachedInput"] = int(totals.get("cached_input") or 0)
            badge_timing["rawInput"] = int(totals.get("raw_input") or 0)
            badge_timing["outputTokens"] = int(totals.get("output") or 0)

            if ended:
                badge_timing["endedAt"] = int(time.time() * 1000)

        # 工具轮次不设上限，由取消、权限阻断、模型错误或模型最终答复结束。
        while True:
            if self._is_cancelled(cancel_checker):
                # 用户中断：落盘当前回复为最终消息，保证中断的回复在重进对话后
                # 有完整消息与 model badge。工具轮不在此落盘：中间轮 assistant 已落盘，
                # 只需补工具结果（见下方循环）。
                if content_text and not final_persisted and not last_round_had_tool_calls:
                    final_persisted = True
                    _snapshot_timing(ended=True)
                    self.store.append_message(
                        conversation_id,
                        {
                            "role": "assistant",
                            "content": content_text,
                            "metadata": self._build_message_metadata(
                                model_name,
                                last_round_io,
                                totals,
                                context_window,
                                request_first_round_chars,
                                badge_timing,
                                reasoning_content=reasoning_text,
                                response_trace_id=response_trace_id,
                                round_index=round_index,
                                context_injection=injection_diag,
                                context_compression=compression_step,
                            ),
                            "timestamp": _now(),
                        },
                    )

                # 中断也要推 token_usage：前端据此给这条消息补 model badge，
                # 否则被停止的回复落盘了却没有用量徽标。无正文时同样推送——
                # 前端用本地缓冲定稿占位，badge 数据仍来自这里。
                token_usage_event = self._emit_token_usage(last_round_io)

                if token_usage_event:
                    yield token_usage_event

                if final_persisted:
                    yield {"type": "done", "conversation_id": conversation_id}

                break

            tools = self.executor.list_tools_llm_format()
            round_volatile_instructions = list(volatile_blocks or [])
            round_volatile_full_instructions = list(volatile_full_blocks or [])

            if retry_after_empty_post_tool_response:
                round_volatile_instructions.append(
                    "上一轮工具结果已经返回，但模型没有生成正文。请依据已有工具结果直接完成用户请求并给出简洁正文；"
                    "只有结果不足时才继续调用工具，不要重复推理内容。"
                )

            try:
                # 显式转发 prepare 的压缩事件：yield from 无法在转发时拦截，
                # 而压缩状态既需要推给前端流式展示，也需要落盘进 assistant metadata
                # （否则重进对话后压缩卡片消失，用户只看到 token 骤降却无任何提示）。
                prepared = self.context_manager.prepare(
                    conversation_id,
                    effective_system,
                    tools,
                    force=force_context_compression,
                    cancel_checker=cancel_checker,
                    response_trace_id=response_trace_id,
                    # 只有本次请求的首轮可以压缩：后续轮次一旦压缩，
                    # 摘要坑位改写会让本请求已缓存的整段前缀立即失效。
                    allow_compression=round_index <= 1,
                    volatile_instructions=round_volatile_instructions,
                    # 压缩重建路径改用全量块：历史被摘要替换后，此前的注入块
                    # 已从窗口消失，必须重新全量注入一次。
                    volatile_full_instructions=round_volatile_full_instructions,
                )
                messages = None

                while True:
                    try:
                        event = next(prepared)
                    except StopIteration as stop:
                        messages = stop.value
                        break

                    if str(event.get("type") or "") == "context_compression_status":
                        # 压缩事件按 start→progress*→done/skipped/trimmed 顺序产出，
                        # 保留最后一条作为本轮压缩终态落盘（progress 会被后续终态覆盖）。
                        compression_step = event

                        # 压缩重建（done）时历史被摘要替换，prepare 改用全量注入块，
                        # 因此本轮注入诊断也切换到全量块，并补发一次注入事件——
                        # 首轮注入事件在压缩前就已发出（那时还不知道会压缩），
                        # 不补发前端卡片会与实际注入不一致。
                        if str(event.get("status") or "") == "done" and injection_full_diag:
                            injection_diag = injection_full_diag
                            yield {
                                "type": "context_injection",
                                "blocks": injection_full_diag["blocks"],
                                "head_chars": injection_full_diag["head_chars"],
                            }

                    yield event

                force_context_compression = False
                retry_after_empty_post_tool_response = False
            except Exception as exc:
                print(f"[LocalContext] prepare_failed conversation={conversation_id} error={type(exc).__name__}: {exc}")
                raise

            # 本轮实际发出的消息条数与整体估算，落盘后作为下一轮占用的实测锚点。
            input_estimate = self.context_manager.estimate_tokens({"messages": messages, "tools": tools})
            request_max_tokens = self.context_manager.request_output_limit(
                conversation_id, messages, tools
            )

            if request_first_round_chars <= 0:
                try:
                    request_first_round_chars = len(json.dumps(messages, ensure_ascii=False, default=str))
                except Exception:
                    request_first_round_chars = 0

            assistant_parts = []
            assistant_reasoning_parts = []
            assistant_tool_calls = []
            round_usage = None
            finish_reason = ""
            round_index += 1
            provider_started = time.monotonic()
            provider_first_event_logged = False

            if last_tool_result_yielded_at:
                _log_elapsed_ms("next_round_kickoff", last_tool_result_yielded_at, round_index)

            try:
                for event in self.provider.stream_chat(
                    messages, tools=tools, max_tokens=request_max_tokens
                ):
                    if not provider_first_event_logged:
                        provider_first_event_logged = True
                        _log_elapsed_ms("provider_first_event", provider_started, round_index)

                    event_type = event.get("type")

                    if event_type == "content":
                        if badge_timing["firstTokenAt"] <= 0:
                            badge_timing["firstTokenAt"] = int(time.time() * 1000)

                        assistant_parts.append(str(event.get("delta") or ""))
                        yield {"type": "content", "content": str(event.get("delta") or "")}

                    elif event_type == "reasoning_content":
                        # 推理过程增量透传给前端实时展示。
                        assistant_reasoning_parts.append(str(event.get("delta") or ""))
                        yield {"type": "reasoning_content", "content": str(event.get("delta") or "")}

                    elif event_type == "tool_call":
                        assistant_tool_calls.append(event)

                    elif event_type == "usage":
                        round_usage = event.get("usage")

                    elif event_type == "finish":
                        finish_reason = str(event.get("finish_reason") or "")
                        yield {"type": "finish", "finish_reason": finish_reason}
            except Exception as exc:
                # 模型流异常：打印完整错误（含 HTTP 状态与响应体），便于定位 4xx/5xx 配置问题。
                print(f"[LocalAgent] provider stream error: {type(exc).__name__}: {exc}")

                # 模型流异常：若已产出部分内容，落盘为最终消息（带 badge_timing），
                # 避免异常中断后重进对话缺消息/缺 badge。
                if "".join(assistant_parts).strip() and not final_persisted and not assistant_tool_calls:
                    final_persisted = True
                    content_text = "".join(assistant_parts)
                    reasoning_text += "".join(assistant_reasoning_parts)
                    last_round_io = self._accumulate_usage(round_usage, totals)
                    _snapshot_timing(ended=True)
                    self.store.append_message(
                        conversation_id,
                        {
                            "role": "assistant",
                            "content": content_text,
                            "metadata": self._build_message_metadata(
                                model_name,
                                last_round_io,
                                totals,
                                context_window,
                                request_first_round_chars,
                                badge_timing,
                                reasoning_content=reasoning_text,
                                response_trace_id=response_trace_id,
                                round_index=round_index,
                                context_injection=injection_diag,
                                context_compression=compression_step,
                            ),
                            "timestamp": _now(),
                        },
                    )

                yield {"type": "error", "message": f"模型调用失败: {exc}"}

                break
            finally:
                _log_elapsed_ms(
                    "provider_wall",
                    provider_started,
                    round_index,
                    detail=f"first_event={int(provider_first_event_logged)}",
                )
                # 累计本轮净生成时长（含首 token 等待，不含工具执行/审批），
                # 供 badge 速率以生成口径为分母，而非整次请求墙钟时间。
                badge_timing["providerMs"] += max(0, int((time.monotonic() - provider_started) * 1000))

                # 首轮 provider 成功产出（收到过至少一个事件）后才落盘注入基线：
                # 若请求彻底失败（连接错误、鉴权失败、无任何事件），基线不落盘，
                # 用户重发时仍按首轮全量注入，不会因「基线已存在」而丢失项目约定。
                if provider_first_event_logged and not injection_baseline_saved and injection_baseline is not None:
                    try:
                        self.store.save_injection_baseline(conversation_id, injection_baseline)
                        injection_baseline_saved = True
                    except Exception as exc:
                        print(f"[LocalAgent] injection_baseline_save_failed conversation={conversation_id} "
                              f"error={type(exc).__name__}: {exc}")

            content_text = "".join(assistant_parts)
            reasoning_text += "".join(assistant_reasoning_parts)
            grouped_tool_calls = self._group_tool_calls(assistant_tool_calls)

            last_round_io = self._accumulate_usage(round_usage, totals)

            if last_round_io:
                self.store.record_context_usage(conversation_id, int(last_round_io.get("raw_input") or 0),
                                               len(messages), input_estimate)
            last_round_had_tool_calls = bool(grouped_tool_calls)
            _snapshot_timing()

            if not grouped_tool_calls:
                if not content_text.strip():
                    token_usage_event = self._emit_token_usage(last_round_io)

                    if token_usage_event:
                        yield token_usage_event

                    if self._is_cancelled(cancel_checker):
                        break

                    should_retry_after_tool = (
                        tool_results_executed > 0
                        and empty_post_tool_retry_count < empty_post_tool_retry_limit
                        and finish_reason != "tool_calls"
                    )
                    print(
                        f"[LocalAgent] empty_final_response conversation_id={conversation_id} "
                        f"trace={response_trace_id} round={round_index} "
                        f"finish_reason={finish_reason or 'missing'} content_chars=0 "
                        f"reasoning_chars={sum(len(str(part)) for part in assistant_reasoning_parts)} "
                        f"tool_results={tool_results_executed} "
                        f"auto_retry={int(should_retry_after_tool)}"
                    )

                    if should_retry_after_tool:
                        empty_post_tool_retry_count += 1
                        retry_after_empty_post_tool_response = True

                        continue

                    _snapshot_timing(ended=True)
                    finish_detail = {
                        "length": "已达到单轮输出上限",
                        "stop": "模型正常结束",
                        "tool_calls": "模型要求调用工具但没有返回可执行调用",
                    }.get(finish_reason, "模型流结束但没有结束原因")

                    if finish_reason == "tool_calls":
                        error_message = f"{finish_detail}，本轮已停止。"
                    elif tool_results_executed > 0:
                        error_message = (
                            f"工具结果已返回，但模型自动重试 {empty_post_tool_retry_count} 次后仍没有生成正文"
                            f"（{finish_detail}）。"
                        )
                    else:
                        error_message = f"{finish_detail}，没有生成可见正文。"

                    yield {"type": "error", "message": error_message}

                    break

                final_persisted = True
                _snapshot_timing(ended=True)
                self.store.append_message(
                    conversation_id,
                    {
                        "role": "assistant",
                        "content": content_text,
                        "metadata": self._build_message_metadata(
                            model_name,
                            last_round_io,
                            totals,
                            context_window,
                            request_first_round_chars,
                            badge_timing,
                            reasoning_content=reasoning_text,
                            response_trace_id=response_trace_id,
                            round_index=round_index,
                            context_injection=injection_diag,
                            context_compression=compression_step,
                        ),
                        "timestamp": _now(),
                    },
                )

                token_usage_event = self._emit_token_usage(last_round_io)

                if token_usage_event:
                    yield token_usage_event

                print(f"[LocalAgent] done: conversation_id={conversation_id} content_len={len(content_text)}")
                yield {"type": "done", "conversation_id": conversation_id}

                break

            print(f"[LocalAgent] round {round_index}: assistant tool_calls={len(grouped_tool_calls)} content_len={len(content_text)}")
            # 中间工具轮的 assistant 消息不带 badge_timing：此时 endedAt 尚未确定（为 0），
            # 若落盘，前端历史渲染会 fallback 到 Date.now() 显示错误且持续增长的耗时。
            assistant_message = {
                "role": "assistant",
                "content": content_text,
                "tool_calls": grouped_tool_calls,
                "metadata": self._build_message_metadata(
                    model_name,
                    last_round_io,
                    totals,
                    context_window,
                    request_first_round_chars,
                    reasoning_content=reasoning_text,
                    response_trace_id=response_trace_id,
                    round_index=round_index,
                    context_injection=injection_diag,
                    context_compression=compression_step,
                ),
            }
            self.store.append_message(conversation_id, assistant_message)

            for tool_index, tool_call in enumerate(grouped_tool_calls):
                if self._is_cancelled(cancel_checker):
                    # 未执行的调用也必须有明确结果，才能在下次请求维持工具协议完整。
                    for remaining in grouped_tool_calls[tool_index:]:
                        self.store.append_message(conversation_id, {
                            "role": "tool",
                            "tool_call_id": str(remaining.get("id") or ""),
                            "content": "已取消：用户停止任务，该工具未执行。",
                            "timestamp": _now(),
                        })

                    break

                call_id = str(tool_call.get("id") or "")
                tool_name = str(tool_call.get("name") or "")
                arguments = tool_call.get("arguments")
                call_ordinal = tool_index + 1

                yield {"type": "function_call", "name": tool_name, "call_id": call_id, "arguments": arguments}

                permission_started = time.monotonic()
                authorization = evaluate_tool_call(
                    self.executor,
                    tool_name,
                    arguments,
                    cancel_checker,
                    approval_context=_build_approval_context(
                        user_text,
                        conversation_messages,
                        _truncate_approval_context(content_text),
                        approval_action_history[-8:],
                    ),
                )
                _log_elapsed_ms(
                    "permission",
                    permission_started,
                    round_index,
                    call_ordinal,
                    detail=f"decision={authorization.get('decision', 'unknown')}",
                )

                if self._is_cancelled(cancel_checker):
                    authorization = {
                        "decision": "deny",
                        "mode": authorization.get("mode", ""),
                        "call": authorization.get("call", {}),
                        "message": "任务已停止，本次工具操作未执行。",
                    }

                if authorization["decision"] == "confirm":
                    try:
                        pending_request = create_pending_tool_action(
                            conversation_id=conversation_id,
                            tool_call_id=call_id,
                            tool_name=authorization["call"]["tool_name"],
                            arguments=authorization["call"]["arguments"],
                            operation=authorization["call"]["operation"],
                            project_root=project_path,
                        )
                        result = {
                            "success": False,
                            "permission_required": True,
                            "deferred_tool_call": True,
                            "permission_question": build_tool_permission_question(pending_request),
                            "content": "等待用户确认后执行本次工具操作。",
                        }
                    except Exception as exc:
                        result = {
                            "success": False,
                            "content": f"未能创建权限确认请求，操作未执行：{exc}",
                        }
                elif authorization["decision"] == "deny":
                    result = {"success": False, "content": authorization["message"]}
                else:
                    tool_execution_started = time.monotonic()

                    try:
                        result = self._execute_tool(
                            tool_name,
                            arguments,
                            conversation_id,
                            project_path,
                            cancel_checker,
                            permission_mode=authorization["mode"],
                            confirmed_tool_call=bool(authorization.get("approved_once", False)),
                        )
                    finally:
                        _log_elapsed_ms(
                            "tool_execution",
                            tool_execution_started,
                            round_index,
                            call_ordinal,
                            detail="executed=1",
                        )

                tool_execution_finished = time.monotonic()

                if authorization["decision"] != "allow":
                    print(
                        f"[LocalAgentTiming] round={round_index} call={call_ordinal} "
                        "tool_execution_ms=0.0 executed=0"
                    )

                tool_content = result.get("content")
                success = result.get("success")
                authorized_call = authorization.get("call") or {}
                approval_action_history.append({
                    "tool_name": str(authorized_call.get("tool_name") or tool_name),
                    "operation": str(authorized_call.get("operation") or ""),
                    "decision": str(authorization.get("decision") or ""),
                    "success": bool(success),
                })

                if result.get("permission_required"):
                    if result.get("deferred_tool_call"):
                        # 先补齐 Provider 要求的工具结果；审批路由会在执行后替换这条占位结果。
                        self.store.append_message(
                            conversation_id,
                            {
                                "role": "tool",
                                "tool_call_id": call_id,
                                "content": "等待用户确认；本次工具操作尚未执行。",
                                "timestamp": _now(),
                            },
                        )

                        if not question_sent:
                            question_sent = True
                            _log_elapsed_ms(
                                "result_processing",
                                tool_execution_finished,
                                round_index,
                                call_ordinal,
                            )
                            yield {
                                "type": "question",
                                "question": result.get("permission_question"),
                                "conversation_id": conversation_id,
                            }

                        for remaining in grouped_tool_calls[tool_index + 1:]:
                            self.store.append_message(
                                conversation_id,
                                {
                                    "role": "tool",
                                    "tool_call_id": str(remaining.get("id") or ""),
                                    "content": "已跳过：等待用户确认期间不执行其余工具调用。",
                                    "timestamp": _now(),
                                },
                            )

                        permission_blocked = True
                        break

                    # 权限不足：弹卡后立即终止本轮，等待用户授权后由 grant 接口自动续跑，
                    # 避免模型循环重试同一路径。
                    question_payload = result.get("permission_question") or {}
                    permission_request = question_payload.get("permission_request") or {}
                    request_path = str(permission_request.get("path") or "")
                    request_operation = str(permission_request.get("operation") or "read")
                    already_asked = _remember_permission_asked(conversation_id, request_path)
                    print(f"[LocalAgent] tool {tool_name} permission_required for conversation {conversation_id} path={request_path} already_asked={already_asked}")

                    # 无论是否重复弹卡，都要登记续跑点：授权接口据此自动续跑本轮，
                    # 否则「已询问过」的路径会静默失败，用户只看到工具不执行。
                    register_pending_permission_resume(
                        conversation_id,
                        tool_call_id=call_id,
                        tool_name=tool_name,
                        path=request_path,
                        operation=request_operation,
                        arguments=arguments,
                        project_root=project_path,
                    )

                    if not question_sent and not already_asked:
                        question_sent = True
                        print(f"[LocalAgent] emitting permission question: path={request_path}")
                        _log_elapsed_ms(
                            "result_processing",
                            tool_execution_finished,
                            round_index,
                            call_ordinal,
                        )
                        yield {
                            "type": "question",
                            "question": result.get("permission_question"),
                            "conversation_id": conversation_id,
                        }
                    else:
                        print("[LocalAgent] question skipped (already sent this stream or asked this session)")

                    self.store.append_message(
                        conversation_id,
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": tool_content,
                            "timestamp": _now(),
                        },
                    )

                    # 同一轮剩余工具调用不再执行，补占位结果保证历史完整（续流时 provider 要求 tool_calls 有对应 tool 消息）。
                    for remaining in grouped_tool_calls[tool_index + 1:]:
                        self.store.append_message(
                            conversation_id,
                            {
                                "role": "tool",
                                "tool_call_id": str(remaining.get("id") or ""),
                                "content": "已跳过：用户授权询问期间不执行其余工具调用。",
                                "timestamp": _now(),
                            },
                        )

                    permission_blocked = True
                    break

                print(f"[LocalAgent] tool result: {tool_name} success={success} content_len={len(str(tool_content))}")
                _log_elapsed_ms(
                    "result_processing",
                    tool_execution_finished,
                    round_index,
                    call_ordinal,
                )
                last_tool_result_yielded_at = time.monotonic()

                yield {
                    "type": "function_result",
                    "name": tool_name,
                    "call_id": call_id,
                    "result": tool_content,
                    "success": success,
                }

                self.store.append_message(
                    conversation_id,
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": tool_content,
                        "timestamp": _now(),
                    },
                )

                if authorization["decision"] == "allow":
                    tool_results_executed += 1

            # 每轮工具调用结束后立即推送 token 统计（本轮窗口口径，前端 CTX / badge / token mini 实时更新）
            token_usage_event = self._emit_token_usage(last_round_io)

            if token_usage_event:
                yield token_usage_event

            if permission_blocked:
                print(f"[LocalAgent] stream stopped awaiting permission: conversation_id={conversation_id}")
                yield {"type": "done", "conversation_id": conversation_id}

                break

    def _is_cancelled(self, cancel_checker) -> bool:
        if callable(cancel_checker):
            try:
                return bool(cancel_checker())
            except Exception:
                return False

        return False

    def cancel(self) -> None:
        """中断当前 Provider 请求，使阻塞读取立即返回。"""
        self.provider.cancel()

    def _model_name(self) -> str:
        """模型展示名（纯模型名，与云端 model_name 对齐）。"""
        config = getattr(self.provider, "config", None)

        if config is None:
            return ""

        return str(getattr(config, "model", "") or "").strip()

    def _provider_name(self) -> str:
        config = getattr(self.provider, "config", None)

        if config is None:
            return ""

        return str(getattr(config, "name", "") or "").strip()

    def _context_window(self) -> int:
        """Provider 配置的上下文窗口（未配置返回 0）。"""
        config = getattr(self.provider, "config", None)

        if config is None:
            return 0

        try:
            return int(getattr(config, "context_window", 0) or 0)
        except Exception:
            return 0

    def _accumulate_usage(self, round_usage: Any, totals: dict) -> dict | None:
        """归一化本轮 usage 并累加进请求级统计；无 usage 返回 None。"""
        if not round_usage:
            return None

        io = _extract_usage_io(round_usage)

        totals["raw_input"] += int(io.get("raw_input") or 0)
        totals["cached_input"] += int(io.get("cached_input") or 0)
        totals["effective_input"] += int(io.get("effective_input") or 0)
        totals["output"] += int(io.get("output") or 0)
        totals["total"] += int(io.get("total") or 0)
        totals["cost"] += float(io.get("cost") or 0.0)

        return io

    @staticmethod
    def _io_tokens_dict(io: dict) -> dict:
        """把内部 usage 口径转换为前端 io_tokens 期望格式（input 为扣除缓存的计费输入）。"""
        effective = int(io.get("effective_input") or 0)

        return {
            "input": effective,
            "output": int(io.get("output") or 0),
            "raw_input": int(io.get("raw_input") or 0),
            "cached_input": int(io.get("cached_input") or 0),
            "cached_tokens_source": str(io.get("cached_tokens_source") or ""),
            "uncached_input": int(io.get("uncached_input") or 0),
            "effective_input": effective,
            "total": int(io.get("total") or 0),
            "reasoning_tokens": int(io.get("reasoning_tokens") or 0),
            "cost": float(io.get("cost") or 0.0),
        }

    def _build_message_metadata(
        self,
        model_name: str,
        last_round_io: dict | None,
        totals: dict,
        context_window: int,
        first_round_chars: int,
        badge_timing: dict | None = None,
        reasoning_content: str = "",
        response_trace_id: str = "",
        round_index: int = 0,
        context_injection: dict | None = None,
        context_compression: dict | None = None,
    ) -> dict:
        """构建 assistant 消息 metadata（口径与 SSE token_usage 对齐，避免流式/落盘切换跳变）：
        - io_tokens / io_tokens_window: 本轮窗口口径（provider prompt_tokens 即该轮完整上下文）
        - io_tokens_cumulative:        本次请求跨工具轮次累计（计费展示 / model badge / stats 口径）
        - badge_timing:                请求级计时与速率（总耗时/首token/输出/缓存），
                                       供前端重进对话后从快照恢复 model badge 展示。
        - request_debug:               窗口上限与首轮载荷字符（前端脏数据保护）
        - reasoning_content:           推理过程全文（前端历史渲染的 thinking 折叠块）
        - response_trace_id/round_index: 请求分组与轮次序号，用于把用量对回具体哪次请求的哪一轮
        - context_injection:           head 字符数与 tail volatile 注入块诊断（重进对话后仍可见）
        - context_compression:         本轮首轮压缩终态（done/skipped/trimmed），
                                       重进对话后压缩卡片据此恢复，避免 token 骤降无任何解释
        """
        metadata: dict = {}

        if model_name:
            metadata["model_name"] = model_name

        if context_injection:
            metadata["context_injection"] = {
                "head_chars": max(0, int(context_injection.get("head_chars") or 0)),
                "blocks": list(context_injection.get("blocks") or []),
            }

        if context_compression:
            # 只保留前端渲染所需字段，避免把整条事件原样落盘（含无关键）。
            metadata["context_compression"] = {
                "type": "context_compression_status",
                "status": str(context_compression.get("status") or ""),
                "content": str(context_compression.get("content") or ""),
                "forced": bool(context_compression.get("forced")),
                "raw_input_tokens": int(context_compression.get("raw_input_tokens") or 0),
                "post_raw_input_tokens": int(context_compression.get("post_raw_input_tokens") or 0),
                "saved_tokens": int(context_compression.get("saved_tokens") or 0),
                "saved_ratio": float(context_compression.get("saved_ratio") or 0.0),
                "context_window": int(context_compression.get("context_window") or 0),
                "history_cut_index": context_compression.get("history_cut_index"),
                "summary_chars": int(context_compression.get("summary_chars") or 0),
                "summary_text": str(context_compression.get("summary_text") or ""),
            }

        if reasoning_content:
            metadata["reasoning_content"] = reasoning_content

        if response_trace_id:
            metadata["response_trace_id"] = response_trace_id
            metadata["round_index"] = max(0, int(round_index or 0))

        if badge_timing:
            metadata["badge_timing"] = {
                "startedAt": int(badge_timing.get("startedAt") or 0),
                "firstTokenAt": int(badge_timing.get("firstTokenAt") or 0),
                "endedAt": int(badge_timing.get("endedAt") or 0),
                "cachedInput": int(badge_timing.get("cachedInput") or 0),
                "rawInput": int(badge_timing.get("rawInput") or 0),
                "outputTokens": int(badge_timing.get("outputTokens") or 0),
                "providerMs": int(badge_timing.get("providerMs") or 0),
            }

        if last_round_io:
            metadata["io_tokens"] = self._io_tokens_dict(last_round_io)
            metadata["io_tokens_window"] = dict(metadata["io_tokens"])
            metadata["io_tokens_cumulative"] = self._io_tokens_dict(totals)
            metadata["request_debug"] = {
                "context_window_limit": max(0, int(context_window or 0)),
                "first_round_input_chars": max(0, int(first_round_chars or 0)),
            }

        return metadata

    def _emit_token_usage(self, round_io: dict | None) -> dict | None:
        """把本轮 usage 归一化为前端 token_usage 事件（input_tokens 为扣除缓存的计费输入）。

        本轮值即"当前窗口占用"（provider 每轮 prompt_tokens 为该轮完整上下文），
        累计口径仅由 io_tokens_cumulative 承载。全 0 说明 provider 未返回 usage，不推送。
        """
        if not round_io:
            return None

        raw = int(round_io.get("raw_input") or 0)
        cached = int(round_io.get("cached_input") or 0)
        effective = int(round_io.get("effective_input") or 0)
        output = int(round_io.get("output") or 0)
        total = int(round_io.get("total") or 0)

        if effective <= 0 and output <= 0 and raw <= 0:
            return None

        if total <= 0:
            total = effective + output

        return {
            "type": "token_usage",
            "input_tokens": effective,
            "output_tokens": output,
            "total_tokens": total,
            "raw_input_tokens": raw,
            "cached_input_tokens": cached,
        }

    def _build_messages(self, conversation_id: str, system_prompt: str, volatile_instructions: Any = None) -> list[dict]:
        conversation = self.store.get(conversation_id)

        if conversation is None:
            raise ValueError("本地会话不存在")

        return self.context_manager.build_messages(conversation, system_prompt, volatile_instructions)

    def _resolve_injection_blocks(self, conversation_id: str, injection_sources: Any, head_chars: int = 0) -> tuple[list[str], list[str], dict | None, dict | None, dict | None]:
        """按基线比对解析本轮 tail 注入块，返回 diff 与 full 两套结果。

        首轮（无基线）全量注入并建立基线；后续只在内容变化时注入 diff；
        无变化返回空列表——稳定轮次不注入任何 tail 块，[head + 历史] 前缀可缓存。

        返回 (diff_blocks, full_blocks, new_baseline, diff_diag, full_diag)：
        - diff_blocks: 按基线比对的结果，常规轮次注入。
        - full_blocks: 忽略基线的全量结果，供「上下文压缩重建」轮次使用——
          历史被摘要替换后，此前的注入块已从窗口消失，必须重新全量注入一次。
        - new_baseline: 采样后的最新基线，由调用方在请求成功后再落盘。
        - diff_diag / full_diag: 对应块的诊断信息（前端展示用）。

        基线不在这里落盘：首轮请求可能失败（provider 报错），若失败前就写基线，
        用户重发时会因「基线无变化」而不再注入。落盘时机交给调用方在请求成功后决定。
        """

        sources = injection_sources if isinstance(injection_sources, dict) else {}

        if not any(str(value or "").strip() for value in sources.values()):
            # 两个通道都为空：无需比对，也无需落盘基线。
            return [], [], None, None, None

        conversation = self.store.get(conversation_id) or {}
        baseline = conversation.get("injection_baseline")
        diff_blocks, new_baseline, diagnostics = plan_injection(sources, baseline)
        full_blocks, _, full_diagnostics = plan_injection(sources, baseline, force_full=True)

        diff_diag = None

        if diff_blocks:
            diff_diag = {"head_chars": max(0, int(head_chars or 0)), "blocks": diagnostics}

        full_diag = None

        if full_blocks:
            full_diag = {"head_chars": max(0, int(head_chars or 0)), "blocks": full_diagnostics}

        return diff_blocks, full_blocks, new_baseline, diff_diag, full_diag

    def _execute_tool(
        self,
        tool_name: str,
        arguments: Any,
        conversation_id: str,
        project_root: str = "",
        cancel_checker=None,
        *,
        permission_mode: str = "confirm",
        confirmed_tool_call: bool = False,
    ) -> dict:
        args = arguments if isinstance(arguments, dict) else {}

        if isinstance(arguments, str):
            try:
                args = json.loads(arguments)
            except Exception:
                args = {}

        if not isinstance(args, dict):
            args = {}

        result = self.executor.execute(
            tool_name,
            args,
            context={
                "conversation_id": conversation_id,
                "project_root": project_root,
                "permission_mode": permission_mode,
                "confirmed_tool_call": confirmed_tool_call,
                "is_cancelled": cancel_checker,
            },
        )

        success = bool(result.get("success", False))
        detail = result.get("result") if isinstance(result.get("result"), dict) else result

        permission_required = bool(
            detail.get("permission_required")
            or str(detail.get("error") or "") == "permission_required"
        )

        if permission_required:
            from .Permission import build_local_permission_question

            hint = _build_permission_hint(detail, project_root)

            return {
                "success": False,
                "permission_required": True,
                "permission_question": build_local_permission_question(detail),
                "content": "权限不足，已向用户发起授权询问，等待用户允许后重试。" + hint,
            }

        if not success:
            return {
                "success": False,
                "content": str(result.get("error") or detail.get("error") or "工具执行失败"),
            }

        # 工具结果以简洁 Markdown 呈现，避免整段 JSON dump 污染模型上下文。
        from .Present import present_tool_result

        return {"success": True, "content": present_tool_result(detail)}

    @staticmethod
    def _group_tool_calls(events: list[dict]) -> list[dict]:
        grouped: dict[int, dict] = {}
        order: list[int] = []

        for event in events:
            index = int(event.get("index", 0) or 0)

            if index not in grouped:
                grouped[index] = {"id": "", "name": "", "arguments": ""}
                order.append(index)

            target = grouped[index]

            if event.get("id"):
                target["id"] = str(event.get("id") or "")

            if event.get("name"):
                target["name"] = str(event.get("name") or "")

            target["arguments"] += str(event.get("arguments_delta") or "")

        result = []

        for index in order:
            item = grouped[index]
            arguments = item["arguments"]

            try:
                parsed = json.loads(arguments) if arguments.strip() else {}
            except Exception:
                parsed = {}

            result.append({
                "id": item["id"],
                "name": item["name"],
                "arguments": parsed if isinstance(parsed, dict) else {},
            })

        return result

    @staticmethod
    def _stringify_content(content: Any) -> str:
        if content is None:
            return ""

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts = []

            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text") or ""))

            return "".join(parts)

        try:
            return json.dumps(content, ensure_ascii=False)
        except Exception:
            return str(content)


def _now() -> str:
    import datetime

    return datetime.datetime.now().isoformat()


def _project_path_from_conversation(conversation: dict) -> str:
    if not isinstance(conversation, dict):
        return ""

    metadata = conversation.get("metadata") if isinstance(conversation.get("metadata"), dict) else {}
    project = metadata.get("nexoracode_project") if isinstance(metadata.get("nexoracode_project"), dict) else {}

    return str(project.get("path") or "").strip()


def _build_permission_hint(detail: Any, project_root: str) -> str:
    """权限不足时给模型的纠正提示：请求路径是否在项目根内，避免路径幻觉导致反复询问。"""
    detail_path = str((detail.get("path") if isinstance(detail, dict) else None) or "").strip()

    if not detail_path or not project_root:
        return ""

    try:
        from pathlib import Path

        Path(detail_path).resolve().relative_to(Path(project_root).resolve())
    except Exception:
        return (
            f"\n注意：请求路径 {detail_path} 不在项目根 {project_root} 内，"
            "请先用 local_file_list 列出项目根路径确认真实结构，不要编造或猜测路径。"
        )

    return f"\n该路径在项目根 {project_root} 内，等待用户授权后即可重试。"


def _remember_permission_asked(conversation_id: str, path: str) -> bool:
    """记录会话级已询问的权限路径；返回该路径是否已询问过（避免重复弹卡）。"""
    clean_path = str(path or "").strip()

    if not clean_path:
        return False

    with _PERMISSION_ASKED_LOCK:
        bucket = _PERMISSION_ASKED.setdefault(str(conversation_id or "").strip(), set())

        if clean_path in bucket:
            return True

        bucket.add(clean_path)
        return False
