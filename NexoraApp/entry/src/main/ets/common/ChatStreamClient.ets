// ChatStreamClient.ets - 对话流式传输客户端
// 协议：POST /api/chat/stream，SSE 增量推送 data: {type, delta, ...}，结束为 data: [DONE]
// 本类只做「字节流 -> 事件」，事件如何落到消息模型由调用方决定
//
// v0.10.0 新增「SSE 静默探测 -> 内容轮询接管」兜底：若 ArkUI http 栈把 SSE 聚合成整包
// （dataReceive 直到流结束才回调，[recv] blocks=1 即实锤），content/reasoning 帧要等生成
// 完毕才一次性到达 -> 界面"整包刷新"。此时客户端凭预创建的 conversation_id 轮询
// /api/chat/stream/content 拉服务端实时累积内容做差量渲染，生成途中界面仍逐段增长。

import http from '@ohos.net.http';
import util from '@ohos.util';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HttpUtil, HttpResult } from './HttpUtil';
import { Json } from './JsonUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraStream';

const STREAM_CONNECT_TIMEOUT: number = 15000;
const STREAM_READ_TIMEOUT: number = 120000;

// 轮询兜底节奏：SSE 静默（整包聚合）时每 200ms 拉一次累积内容做差量渲染，
// 与服务端生成速率(~30-60 token/s)匹配，每批约 2-6 token，视觉接近逐字流式；
// SSE 逐帧正常时首个周期内探测到帧即自动停表，零行为变化
const POLL_INTERVAL_MS: number = 200;

// SSE 分片：字段可选是因为后端按 type 差异返回不同载荷
export interface StreamChunk {
    type?: string;
    delta?: string;
    content?: string;
    conversation_id?: string;
    stream_id?: string;
    done?: boolean;
    error?: string;
    message?: string;
    cancel_requested?: boolean;
    cancel_reason?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    // function_call_delta 增量参数（服务端工具参数流式分段，逐段 arguments_delta 累积）
    arguments_delta?: string;
    result?: string;
    round?: number;
}

// 流式事件回调：全部必填，避免出现「事件来了没人处理」的静默分支
export interface StreamListener {
    onConversationId: (conversationId: string) => void;
    onReasoningDelta: (delta: string) => void;
    onContentDelta: (delta: string) => void;
    onToolCall: (name: string, callId: string, args: string, round: number) => void;
    onToolResult: (name: string, callId: string, result: string, round: number) => void;
    onError: (message: string) => void;
    onComplete: (finalContent: string) => void;
    onAborted: () => void;
}

export interface StreamOptions {
    message: string;
    conversationId?: string;
    modelName?: string;
    enableThinking: boolean;
    enableWebSearch: boolean;
    enableTools: boolean;
    toolMode?: string;
}

// 流式请求体：conversation_id / model_name 可选，后端在缺省时新建会话 / 使用默认模型
export interface StreamRequestBody {
    message: string;
    conversation_id?: string;
    model_name?: string;
    enable_thinking: boolean;
    enable_web_search: boolean;
    enable_tools: boolean;
    tool_mode?: string;
}

export class ChatStreamClient {
    private streaming: boolean = false;
    private request: http.HttpRequest | null = null;
    private streamId: string = '';
    private conversationId: string = '';
    private buffer: string = '';
    private finished: boolean = false;

    // 接收诊断统计：判断 ArkUI http 栈是「逐块到达」还是「整包聚合」
    // （真机反馈"网页逐字、设备整包"，怀疑 dataReceive 分块粒度被聚合，需日志二分定位）
    private recvBlocks: number = 0;
    private recvBytes: number = 0;
    private firstRecvAt: number = 0;
    private lastRecvAt: number = 0;
    private contentFrames: number = 0;
    private reasoningFrames: number = 0;
    private sessionFrames: number = 0;
    private otherFrames: number = 0;

    // ---------- 轮询兜底状态（见类头注释） ----------
    private pollTimer: number = -1;
    private pollInFlight: boolean = false;
    private pollContentLen: number = 0;
    private pollReasoningLen: number = 0;
    private pollDoneSeen: boolean = false;
    private pollSkipWarned: boolean = false;

    // 客户端已渲染的总长度（SSE 帧 + 轮询差量合计），作为轮询差量基准。
    // 仅用 pollContentLen 会在 SSE 已渲染部分内容后轮询从 0 开始重复渲染；
    // 用 renderedContentLen 可保证轮询只补 SSE 没渲染到的部分
    private renderedContentLen: number = 0;
    private renderedReasoningLen: number = 0;

    // SSE 提前结束（dataEnd/err 未收 [DONE]）但服务端仍在执行时，保存 resolve 让轮询接管到 done 再结束
    private pendingResolve: (() => void) | null = null;

    // 当前流的 listener，供 cancel 在 handover 状态下正确触发 onAborted 收尾
    private currentListener: StreamListener | null = null;

    // dataReceive 是否回调过：区分「SSE 正常逐帧」与「整包聚合」。
    // 正常逐帧时轮询不拉 content（避免 pollContentLen>0 跳过 SSE 后续帧导致丢内容）；
    // 整包聚合或 handover 时轮询才接管
    private sseDataStarted: boolean = false;

    // 轮询在 SSE 首帧前已渲染过内容时设为 true：此后轮询持续接管，SSE 帧全跳过避免重复
    private pollerTakeover: boolean = false;

    // 轮询已处理到的 render_chunks 索引：每次只派发新增的工具帧，避免重复
    private pollRenderChunkIdx: number = 0;

    // 工具参数流式累积：function_call_delta 按 call_id 归并增量参数，
    // 每次 delta 后把「累积到当前的完整参数」派发给 UI（覆盖语义建卡/更新参数），
    // 不依赖上游是否补发完整 function_call 帧，卡片实时呈现且最终参数完整
    private toolArgBufs: Map<string, string> = new Map();

    get isStreaming(): boolean {
        return this.streaming;
    }

    // 发起一次流式对话，返回时流已结束（完成 / 取消 / 出错）
    async start(options: StreamOptions, listener: StreamListener): Promise<void> {
        if (this.streaming) {
            return;
        }

        this.streaming = true;
        this.streamId = '';
        this.conversationId = options.conversationId ?? '';
        this.buffer = '';
        this.finished = false;
        this.recvBlocks = 0;
        this.recvBytes = 0;
        this.firstRecvAt = 0;
        this.lastRecvAt = 0;
        this.contentFrames = 0;
        this.reasoningFrames = 0;
        this.sessionFrames = 0;
        this.otherFrames = 0;
        this.pollContentLen = 0;
        this.pollReasoningLen = 0;
        this.pollDoneSeen = false;
        this.pollSkipWarned = false;
        this.renderedContentLen = 0;
        this.renderedReasoningLen = 0;
        this.pendingResolve = null;
        this.currentListener = null;
        this.sseDataStarted = false;
        this.pollerTakeover = false;
        this.pollRenderChunkIdx = 0;
        this.toolArgBufs.clear();
        this.stopPoller('reset');

        try {
            await this.openStream(options, listener);
        } finally {
            this.streaming = false;
            this.request = null;
            this.stopPoller('start-finally');
        }
    }

    // 取消：先通知后端停流，再本地断开，避免后端继续生成
    cancel(): void {
        if (!this.streaming) {
            return;
        }

        this.finished = true;
        this.stopPoller('cancel');
        this.notifyCancel();

        if (this.request !== null) {
            this.request.destroy();
            this.request = null;
        }

        // handover 状态下需触发 onAborted 并 resolve，否则 openStream Promise 永远 pending
        if (this.pendingResolve !== null) {
            if (this.currentListener !== null) {
                this.currentListener.onAborted();
            }

            const resolve: () => void = this.pendingResolve;
            this.pendingResolve = null;
            resolve();
        }

        hilog.info(DOMAIN, TAG, 'cancel requested, stream=%{public}s', this.streamId);
    }

    // ---------- 内部实现 ----------
    private async openStream(options: StreamOptions, listener: StreamListener): Promise<void> {
        const url: string = HttpUtil.getBackendUrl() + '/api/chat/stream';
        const decoder: util.TextDecoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });
        this.currentListener = listener;

        await new Promise<void>((resolve: () => void) => {
            const request: http.HttpRequest = http.createHttp();
            this.request = request;

            // 增量到达：按行切分，末行不完整时留在缓冲里等待后续数据。
            // 每块都打日志：若真机观察到 dataReceive 只回调一次且 len=整包体量，
            // 即实锤 ArkUI http 栈聚合（此时客户端已自动切轮询兜底渲染）
            request.on('dataReceive', (data: ArrayBuffer) => {
                if (this.finished) {
                    return;
                }

                // 首次收到 SSE 数据：标记 SSE 已启动。若轮询已先渲染过内容，
                // 设 pollerTakeover 让轮询持续接管（SSE 帧全跳过避免重复）
                if (!this.sseDataStarted) {
                    this.sseDataStarted = true;

                    if (this.pollContentLen > 0 || this.pollReasoningLen > 0) {
                        this.pollerTakeover = true;
                        hilog.info(DOMAIN, TAG, '[sse] dataReceive starts after poll rendered, poller takes over');
                    }
                }

                this.recvBlocks = this.recvBlocks + 1;
                this.recvBytes = this.recvBytes + data.byteLength;
                const now: number = Date.now();

                if (this.firstRecvAt === 0) {
                    this.firstRecvAt = now;
                }

                this.lastRecvAt = now;
                hilog.info(DOMAIN, TAG, '[recv] block#%{public}d len=%{public}d total=%{public}d',
                    this.recvBlocks, data.byteLength, this.recvBytes);

                // decodeToString(stream:true)：跨 dataReceive 分块保留不完整的多字节序列（中文/emoji 不会被截断），SDK12+ 推荐 API
                this.buffer += decoder.decodeToString(new Uint8Array(data), { stream: true });
                this.drainBuffer(listener);
            });

            // 连接结束：把缓冲里剩余的一行补完。
            // 若未收 [DONE] 且会话已建立，说明 SSE 提前断开但服务端可能仍在执行——
            // 不立即结束，保存 resolve 交由轮询接管拉取剩余内容直到服务端 done
            request.on('dataEnd', () => {
                hilog.info(DOMAIN, TAG, '[DBG:dataEnd] finished=%{public}s pollC=%{public}d pollR=%{public}d contentFrames=%{public}d takeover=%{public}s',
                    this.finished, this.pollContentLen, this.pollReasoningLen, this.contentFrames, this.pollerTakeover);

                if (this.finished) {
                    this.logRecvSummary('dataEnd-skip');
                    resolve();
                    return;
                }

                const tail: string = this.buffer;
                this.buffer = '';

                if (tail.trim().length > 0) {
                    this.finished = this.handleLine(tail, listener);
                }

                if (this.finished) {
                    this.logRecvSummary('dataEnd-done');
                    resolve();
                    return;
                }

                // SSE 提前结束且未收 [DONE]：交轮询接管
                this.handoverToPoller(resolve, listener, 'dataEnd');
            });

            request.request(url, {
                method: http.RequestMethod.POST,
                header: this.buildHeaders(),
                extraData: JSON.stringify(this.buildBody(options)),
                // 关键传输参数：禁用 http 缓存层；强制二进制流解码（默认 STRING 模式可能把
                // 整个 SSE 响应按字符串聚合解码——"网页逐块、设备整包"的最大客户端嫌疑）
                usingCache: false,
                expectDataType: http.HttpDataType.ARRAY_BUFFER,
                connectTimeout: STREAM_CONNECT_TIMEOUT,
                readTimeout: STREAM_READ_TIMEOUT,
                remoteValidation: 'skip'
            }, (err: BusinessError, data: http.HttpResponse) => {
                request.off('dataReceive');
                request.off('dataEnd');
                request.destroy();
                this.request = null;

                this.resolveTransportResult(err, data, listener, resolve);
            });

            // SSE 静默探测 -> 内容轮询接管：conversation_id 已知（新会话预创建 / 追问既有会话）时
            // 挂上兜底轮询。传输正常（帧逐块到达）时首个周期内自动停；整包聚合时凭 status 端点
            // 解出 stream_id，再拉累积内容做增量渲染，让真机在生成途中就能逐段看到正文
            this.startPoller(listener);
        });
    }

    // SSE 提前结束（dataEnd/err 未收 [DONE]）但服务端可能仍在执行时，交轮询接管。
    // 保存 resolve，启动轮询，直到轮询拉到 status=done 再 resolve 结束本次流
    private handoverToPoller(resolve: () => void, listener: StreamListener, reason: string): void {
        if (this.conversationId.length === 0) {
            // 无会话 id 无法轮询，直接结束
            listener.onComplete('');
            this.finished = true;
            this.logRecvSummary(reason);
            resolve();
            return;
        }

        hilog.info(DOMAIN, TAG, '[handover] sse ended without [DONE], poller takes over conv=%{public}s reason=%{public}s',
            this.conversationId, reason);
        this.pendingResolve = resolve;
        this.startPoller(listener);
    }

    private resolveTransportResult(err: BusinessError, data: http.HttpResponse, listener: StreamListener, resolve: () => void): void {
        if (this.finished) {
            this.stopPoller('transport-finished');
            resolve();
            return;
        }

        if (err) {
            const message: string = err.message as string;
            const aborted: boolean = err.code === 2300012 || message.indexOf('abort') >= 0;

            hilog.info(DOMAIN, TAG, '[DBG:transportErr] code=%{public}d aborted=%{public}s conv=%{public}s pollC=%{public}d contentFrames=%{public}d',
                err.code, aborted, this.conversationId, this.pollContentLen, this.contentFrames);

            if (aborted) {
                listener.onAborted();
                this.finished = true;
                this.stopPoller('transport-abort');
                resolve();
                return;
            }

            // 非中断错误：若会话已建立，交轮询接管（服务端可能仍在执行）；
            // 否则无会话 id 无法轮询，只能报错结束
            hilog.error(DOMAIN, TAG, 'stream error: %{public}s', JSON.stringify(err));
            this.handoverToPoller(resolve, listener, 'transport-error');
            return;
        }

        if (data.responseCode !== 200) {
            hilog.error(DOMAIN, TAG, 'stream http code=%{public}d', data.responseCode);
            listener.onError('请求失败(' + data.responseCode + ')');
            this.finished = true;
            this.stopPoller('transport-http');
            resolve();
            return;
        }

        // 服务端未走增量、一次性返回时的收尾。
        // 注意：部分网关/代理会把 SSE 攒成整包在一次回调里返回，此时 data.result 是
        // 一长串 "data: {...}\n\n..." 原始帧文本——必须按 SSE 逐行解析，绝不能原样塞进
        // content，否则气泡里会整屏显示 data: {"type":...} 协议原文（曾实测复现）。
        const body: string = typeof data.result === 'string' ? (data.result as string) : '';

        if (body.length > 0) {
            // 走到这里说明 dataReceive 没有把 body 逐块派发完（或整包兜底路径），
            // 记录真实接收粒度，供日志二分定位
            this.recvBlocks = this.recvBlocks + 1;
            this.recvBytes = this.recvBytes + body.length;
            this.lastRecvAt = Date.now();

            if (this.firstRecvAt === 0) {
                this.firstRecvAt = this.lastRecvAt;
            }

            hilog.info(DOMAIN, TAG, '[result] whole-body len=%{public}d (dataReceive blocks=%{public}d)',
                body.length, this.recvBlocks);

            this.buffer = (this.buffer.length > 0 ? this.buffer + '\n' : '') + body;
            this.drainBuffer(listener);

            // 冲刷 drainBuffer 遗留的末行（整包结尾无换行时 [DONE]/收尾帧会残留在缓冲里）
            if (!this.finished) {
                const tail: string = this.buffer;
                this.buffer = '';

                if (tail.trim().length > 0) {
                    this.finished = this.handleLine(tail, listener);
                }
            }
        }

        this.logRecvSummary('result');

        if (this.finished) {
            this.stopPoller('transport-done');
            resolve();
            return;
        }

        // 未收 [DONE]：交轮询接管（纯文本兜底仅在无 SSE 帧标记时把整体当最终正文）
        const plain: string = body.indexOf('data:') >= 0 ? '' : body.trim();

        if (plain.length > 0) {
            listener.onComplete(plain);
            this.finished = true;
            this.stopPoller('transport-plain');
            resolve();
            return;
        }

        this.handoverToPoller(resolve, listener, 'transport-end');
    }

    // 汇总接收粒度日志：block 数=1 且 len 接近整包 => ArkUI http 栈聚合，轮询兜底已自动接管
    private logRecvSummary(where: string): void {
        const spanMs: number = this.firstRecvAt > 0 ? (this.lastRecvAt - this.firstRecvAt) : 0;
        hilog.info(DOMAIN, TAG,
            '[recv-summary@%{public}s] blocks=%{public}d bytes=%{public}d spanMs=%{public}d ' +
            'frames(content=%{public}d reasoning=%{public}d session=%{public}d other=%{public}d)',
            where, this.recvBlocks, this.recvBytes, spanMs,
            this.contentFrames, this.reasoningFrames, this.sessionFrames, this.otherFrames);
    }

    // ---------- SSE 静默探测 -> 内容轮询接管（传输整包聚合时的兜底渲染） ----------
    // 背景：若 ArkUI http 栈把 SSE 聚合成整包、dataReceive 直到流结束才回调一次
    // （[recv] blocks=1 即实锤），content/reasoning 帧要等生成完毕才一次性到达。
    // 兜底机制：
    //   1) 若 content/reasoning 帧已逐帧到达 -> 传输正常，首个周期内自动停，零行为变化；
    //   2) 否则用 /api/chat/stream/status 按 conversation_id 解出运行中 stream_id，
    //      再用 /api/chat/stream/content 拉服务端实时累积正文/思考，与已渲染长度做差量，
    //      走同一套 onReasoningDelta/onContentDelta 回调 -> 生成途中界面仍逐段增长；
    //   3) SSE 帧照常负责 done/取消/错误/工具帧与收尾；轮询已渲染过的 content/reasoning
    //      在整包补发时被 dispatch 跳过（见 dispatch），绝不双写。
    private startPoller(listener: StreamListener): void {
        if (this.pollTimer >= 0 || this.conversationId.length === 0) {
            return;
        }

        hilog.info(DOMAIN, TAG, '[poll] armed conv=%{public}s interval=%{public}dms',
            this.conversationId, POLL_INTERVAL_MS);
        this.pollTimer = setInterval(() => {
            this.pollTick(listener);
        }, POLL_INTERVAL_MS);
    }

    private stopPoller(reason: string): void {
        if (this.pollTimer >= 0) {
            clearInterval(this.pollTimer);
            this.pollTimer = -1;
            hilog.info(DOMAIN, TAG, '[poll] stopped reason=%{public}s', reason);
        }
    }

    private async pollTick(listener: StreamListener): Promise<void> {
        if (this.pollInFlight) {
            return;
        }

        if (!this.streaming || this.finished) {
            this.stopPoller('stream-end');
            return;
        }

        this.pollInFlight = true;

        try {
            // SSE 正常逐帧推送时（dataReceive 已回调、未 handover、轮询未先接管），
            // 轮询不拉 content——避免 pollContentLen>0 导致 SSE 后续 content 帧被 dispatch 跳过丢失。
            // 仅 handover（SSE 断开）、整包聚合（dataReceive 未回调）或轮询已先接管时才拉
            const sseAlive: boolean = this.sseDataStarted && this.pendingResolve === null && !this.pollerTakeover;

            hilog.info(DOMAIN, TAG,
                '[DBG:pollTick] sseStarted=%{public}s takeover=%{public}s pending=%{public}s sseAlive=%{public}s streamId=%{public}s pollC=%{public}d pollR=%{public}d',
                this.sseDataStarted, this.pollerTakeover, this.pendingResolve !== null, sseAlive,
                this.streamId, this.pollContentLen, this.pollReasoningLen);

            if (sseAlive) {
                return;
            }

            if (this.streamId.length === 0) {
                await this.resolveStreamIdViaStatus();

                // status 端点可能直接返回 done（生成已结束），尝试拉内容收尾
                if (this.streamId.length === 0) {
                    return;
                }
            }

            await this.pullAccumulatedContent(listener);
        } finally {
            this.pollInFlight = false;
        }
    }

    // conversation_id -> stream_id：status 端点按会话返回全部 session（含 done），优先运行中的最新一条
    private async resolveStreamIdViaStatus(): Promise<void> {
        const result: HttpResult = await HttpUtil.get(
            '/api/chat/stream/status?conversation_ids=' + encodeURIComponent(this.conversationId));

        if (!result.ok) {
            hilog.warn(DOMAIN, TAG, '[poll] status failed code=%{public}d', result.code);
            return;
        }

        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        if (payload === null) {
            return;
        }

        const rows: Object[] = Json.array(payload, 'sessions');
        let runningRow: Record<string, Object> | null = null;
        let runningAt: number = -1;
        let anyRow: Record<string, Object> | null = null;
        let anyAt: number = -1;

        for (let i: number = 0; i < rows.length; i++) {
            const row: Record<string, Object> = rows[i] as Record<string, Object>;
            const createdAt: number = Json.number(row, 'created_at');

            if (createdAt > anyAt) {
                anyAt = createdAt;
                anyRow = row;
            }

            if (Json.string(row, 'status') === 'running' && createdAt > runningAt) {
                runningAt = createdAt;
                runningRow = row;
            }
        }

        const pick: Record<string, Object> | null = runningRow !== null ? runningRow : anyRow;

        if (pick === null) {
            return;
        }

        const sid: string = Json.string(pick, 'stream_id');

        if (sid.length > 0) {
            this.streamId = sid;
            hilog.info(DOMAIN, TAG, '[poll] stream resolved sid=%{public}s status=%{public}s',
                sid, Json.string(pick, 'status'));
        }
    }

    // 拉累积正文做差量派发。差量基准为 renderedReasoningLen/renderedContentLen
    // （SSE 已渲染 + 轮询已渲染的总长度），保证 SSE 渲染过的部分轮询不重复。
    // 服务端 done 时触发 onComplete 收尾并 resolve 结束本次流
    private async pullAccumulatedContent(listener: StreamListener): Promise<void> {
        const result: HttpResult = await HttpUtil.get(
            '/api/chat/stream/content?stream_id=' + encodeURIComponent(this.streamId));

        if (!result.ok) {
            hilog.warn(DOMAIN, TAG, '[poll] content failed code=%{public}d', result.code);
            return;
        }

        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        if (payload === null) {
            return;
        }

        const content: string = Json.string(payload, 'content');
        const reasoning: string = Json.string(payload, 'reasoning_content');
        const status: string = Json.string(payload, 'status');

        hilog.info(DOMAIN, TAG,
            '[DBG:pollContent] status=%{public}s contentLen=%{public}d reasoningLen=%{public}d renderedC=%{public}d renderedR=%{public}d',
            status, content.length, reasoning.length, this.renderedContentLen, this.renderedReasoningLen);

        if (reasoning.length >= this.renderedReasoningLen) {
            const delta: string = reasoning.substring(this.renderedReasoningLen);

            if (delta.length > 0) {
                this.renderedReasoningLen = reasoning.length;
                this.pollReasoningLen = this.pollReasoningLen + delta.length;
                listener.onReasoningDelta(delta);
            }
        }

        if (content.length >= this.renderedContentLen) {
            const delta: string = content.substring(this.renderedContentLen);

            if (delta.length > 0) {
                this.renderedContentLen = content.length;
                this.pollContentLen = this.pollContentLen + delta.length;
                listener.onContentDelta(delta);
            }
        }

        // 派发 render_chunks 里的工具帧（function_call/function_result）。
        // content/reasoning 已上面差量渲染，这里只处理工具生命周期帧，避免工具卡丢失
        this.dispatchRenderChunks(payload, listener);

        // 服务端 done：触发收尾，resolve 结束本次流
        if (status === 'done' && !this.finished) {
            hilog.info(DOMAIN, TAG,
                '[poll] server done contentLen=%{public}d reasoningLen=%{public}d, completing',
                this.renderedContentLen, this.renderedReasoningLen);
            this.finished = true;
            this.stopPoller('poll-done');
            listener.onComplete('');

            if (this.pendingResolve !== null) {
                const resolve: () => void = this.pendingResolve;
                this.pendingResolve = null;
                resolve();
            }
        }
    }

    // 从 render_chunks 派发工具帧：按 pollRenderChunkIdx 只处理新增的 chunk，
    // 对 function_call 调 onToolCall 建卡，function_result 调 onToolResult 回填。
    // content/reasoning 帧跳过（已由 content/reasoning_content 字段差量渲染）
    private dispatchRenderChunks(payload: Record<string, Object>, listener: StreamListener): void {
        const chunks: Object[] = Json.array(payload, 'render_chunks');

        for (let i: number = this.pollRenderChunkIdx; i < chunks.length; i++) {
            const rc: Record<string, Object> = chunks[i] as Record<string, Object>;
            const rcType: string = Json.string(rc, 'type');

            if (rcType === 'function_call') {
                const name: string = Json.string(rc, 'name');
                const callId: string = Json.string(rc, 'call_id');
                const args: string = Json.string(rc, 'arguments');
                const round: number = Json.number(rc, 'round');

                hilog.info(DOMAIN, TAG, '[DBG:pollRender] function_call name=%{public}s call=%{public}s', name, callId);
                listener.onToolCall(name, callId, args, round);
            } else if (rcType === 'function_result') {
                const name: string = Json.string(rc, 'name');
                const callId: string = Json.string(rc, 'call_id');
                const resultText: string = Json.string(rc, 'result');
                const round: number = Json.number(rc, 'round');

                hilog.info(DOMAIN, TAG, '[DBG:pollRender] function_result name=%{public}s call=%{public}s', name, callId);
                listener.onToolResult(name, callId, resultText, round);
            }
        }

        this.pollRenderChunkIdx = chunks.length;
    }

    // 轮询已接管渲染后，SSE 整包补发同族帧只在第一次触发时打一条日志，避免逐帧刷屏
    private warnPollSkipOnce(kind: string): void {
        if (this.pollSkipWarned) {
            return;
        }

        this.pollSkipWarned = true;
        hilog.info(DOMAIN, TAG, '[poll] skip sse %{public}s frames (poller rendered, avoid dup)', kind);
    }

    // 把缓冲里的完整行逐条派发，保留最后一个不完整行
    private drainBuffer(listener: StreamListener): void {
        const lines: string[] = this.buffer.split('\n');
        this.buffer = lines[lines.length - 1];

        for (let i: number = 0; i < lines.length - 1; i++) {
            if (this.handleLine(lines[i], listener)) {
                this.finished = true;
                return;
            }
        }
    }

    // 处理单行，返回 true 表示流已终止
    private handleLine(line: string, listener: StreamListener): boolean {
        const trimmed: string = line.trim();

        if (trimmed.length === 0) {
            return false;
        }

        if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') {
            listener.onComplete('');
            return true;
        }

        if (!trimmed.startsWith('data: ')) {
            return false;
        }

        return this.dispatch(trimmed.substring(6), listener);
    }

    // 按分片类型派发事件，返回 true 表示流已终止
    // 类型名做归一处理：不同后端子流/历史版本对正文帧可能叫 content / content_delta / delta / text，
    // 思考帧可能叫 reasoning / reasoning_content / reasoning_delta / thinking——全部归一，杜绝"帧被 default 静默丢弃"
    private dispatch(payloadText: string, listener: StreamListener): boolean {
        let chunk: StreamChunk;

        try {
            chunk = JSON.parse(payloadText) as StreamChunk;
        } catch {
            hilog.warn(DOMAIN, TAG, 'skip non-json payload');
            return false;
        }

        this.rememberIdentifiers(chunk, listener);

        const type: string = (chunk.type ?? '').toLowerCase().trim();

        hilog.info(DOMAIN, TAG,
            '[DBG:dispatch] type=%{public}s pollContentLen=%{public}d pollReasoningLen=%{public}d sseStarted=%{public}s takeover=%{public}s pending=%{public}s',
            type, this.pollContentLen, this.pollReasoningLen,
            this.sseDataStarted, this.pollerTakeover, this.pendingResolve !== null);

        switch (type) {
            case 'stream_session':
                this.sessionFrames = this.sessionFrames + 1;
                return this.handleSessionChunk(chunk, listener);
            case 'reasoning':
            case 'reasoning_content':
            case 'reasoning_delta':
            case 'thinking':
            case 'thinking_content':
                this.reasoningFrames = this.reasoningFrames + 1;

                // 轮询接管期间 SSE 整包补发思考帧：轮询已渲染过，跳过避免双写
                if (this.pollReasoningLen > 0) {
                    this.warnPollSkipOnce('reasoning');
                    return false;
                }

                {
                    const delta: string = this.deltaOf(chunk);
                    this.renderedReasoningLen = this.renderedReasoningLen + delta.length;
                    listener.onReasoningDelta(delta);
                }
                return false;
            case 'content':
            case 'content_delta':
            case 'delta':
            case 'text':
                this.contentFrames = this.contentFrames + 1;

                // 轮询接管期间 SSE 整包补发正文帧：同上，跳过避免双写
                if (this.pollContentLen > 0) {
                    hilog.warn(DOMAIN, TAG, '[DBG:dispatch] SKIP content frame pollContentLen=%{public}d', this.pollContentLen);
                    this.warnPollSkipOnce('content');
                    return false;
                }

                {
                    const delta: string = this.deltaOf(chunk);
                    this.renderedContentLen = this.renderedContentLen + delta.length;
                    hilog.info(DOMAIN, TAG, '[DBG:dispatch] content delta len=%{public}d rendered=%{public}d', delta.length, this.renderedContentLen);
                    listener.onContentDelta(delta);
                }
                return false;
            case 'function_call_delta':
                hilog.info(DOMAIN, TAG, '[DBG:dispatch] function_call_delta name=%{public}s call=%{public}s', chunk.name ?? '', chunk.call_id ?? '');
                // 工具参数流式分段：按 call_id 归并增量，把累积到当前的完整参数派发出去
                // （UI 覆盖语义：首帧建卡，后续帧更新入参，无需等待完整 function_call）
                this.toolCallDelta(chunk, listener);
                return false;
            case 'function_call':
                hilog.info(DOMAIN, TAG, '[DBG:dispatch] function_call name=%{public}s call=%{public}s', chunk.name ?? '', chunk.call_id ?? '');
                // 完整参数帧：重置该 call_id 的累积缓冲，直接以全量参数建卡/更新
                {
                    const callId: string = chunk.call_id ?? '';
                    const args: string = chunk.arguments ?? '';

                    if (callId.length > 0) {
                        this.toolArgBufs.set(callId, args);
                    }

                    listener.onToolCall(chunk.name ?? '', callId, args, chunk.round ?? 0);
                }
                return false;
            case 'function_call_running':
                // 工具执行中状态：卡片已由 delta/call 帧创建并保持 running；此帧仅做日志。
                // 极端情况下（上游只发 running+result、从不发 call/delta），result 因找不到
                // callId 会被 completeToolCall 静默忽略，此处打日志便于确认该类上游存在
                hilog.info(DOMAIN, TAG, 'tool running name=%{public}s call=%{public}s',
                    chunk.name ?? '', chunk.call_id ?? '');
                return false;
            case 'function_result':
                listener.onToolResult(chunk.name ?? '', chunk.call_id ?? '', chunk.result ?? '', chunk.round ?? 0);
                return false;
            case 'error':
                listener.onError(chunk.message ?? chunk.error ?? '生成过程出错');
                return false;
            case 'done':
                listener.onComplete(chunk.content ?? '');
                return true;
            default:
                this.otherFrames = this.otherFrames + 1;
                hilog.warn(DOMAIN, TAG, 'unhandled chunk type=%{public}s', type);
                return false;
        }
    }

    // function_call_delta 归并：按 call_id 累积 arguments_delta，
    // 把累积到当前的完整参数以 onToolCall 派发（ChatTypes.beginToolCall 覆盖语义：
    // 首帧建卡，后续帧刷新入参），保证不丢任何参数片段
    private toolCallDelta(chunk: StreamChunk, listener: StreamListener): void {
        const callId: string = chunk.call_id ?? '';
        const delta: string = chunk.arguments_delta ?? chunk.delta ?? '';

        if (callId.length === 0) {
            hilog.warn(DOMAIN, TAG, 'tool delta without call_id dropped');
            return;
        }

        const accumulated: string = (this.toolArgBufs.get(callId) ?? '') + delta;
        this.toolArgBufs.set(callId, accumulated);

        const name: string = chunk.name ?? '';
        listener.onToolCall(name.length > 0 ? name : 'tool', callId, accumulated, chunk.round ?? 0);
    }

    private handleSessionChunk(chunk: StreamChunk, listener: StreamListener): boolean {
        if (chunk.done !== true) {
            return false;
        }

        if (chunk.error !== undefined && chunk.error.length > 0) {
            listener.onError(chunk.error);
            return true;
        }

        if (chunk.cancel_requested === true) {
            listener.onAborted();
            return true;
        }

        listener.onComplete(chunk.content ?? '');
        return true;
    }

    private rememberIdentifiers(chunk: StreamChunk, listener: StreamListener): void {
        if (chunk.stream_id !== undefined && chunk.stream_id.length > 0) {
            this.streamId = chunk.stream_id;
        }

        if (this.conversationId.length === 0 && chunk.conversation_id !== undefined && chunk.conversation_id.length > 0) {
            this.conversationId = chunk.conversation_id;
            listener.onConversationId(this.conversationId);
        }
    }

    private deltaOf(chunk: StreamChunk): string {
        return chunk.delta ?? chunk.content ?? '';
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            // 请求明文传输：显式禁止内容压缩。若让 cURL 自动协商 gzip，
            // 代理/网关可能把整段 SSE 压缩成一块 gzip，客户端只能整体解压 -> 整包到达
            'Accept-Encoding': 'identity'
        };

        if (HttpUtil.hasSession()) {
            headers['Cookie'] = HttpUtil.getSessionCookie();
        }

        return headers;
    }

    private buildBody(options: StreamOptions): StreamRequestBody {
        const body: StreamRequestBody = {
            message: options.message,
            conversation_id: options.conversationId,
            model_name: options.modelName,
            enable_thinking: options.enableThinking,
            enable_web_search: options.enableWebSearch,
            enable_tools: options.enableTools,
            tool_mode: options.toolMode
        };

        return body;
    }

    private notifyCancel(): void {
        const payload: Record<string, string> = {};

        if (this.streamId.length > 0) {
            payload['stream_id'] = this.streamId;
        }

        if (this.conversationId.length > 0) {
            payload['conversation_id'] = this.conversationId;
        }

        const request: http.HttpRequest = http.createHttp();

        request.request(HttpUtil.getBackendUrl() + '/api/chat/stream/cancel', {
            method: http.RequestMethod.POST,
            header: this.buildHeaders(),
            extraData: JSON.stringify(payload),
            connectTimeout: 5000,
            readTimeout: 5000,
            remoteValidation: 'skip'
        }, (_err: BusinessError, _data: http.HttpResponse) => {
            request.destroy();
        });
    }
}

// 全局唯一流式客户端：同一时刻只允许一条流在运行
export const chatStream: ChatStreamClient = new ChatStreamClient();
