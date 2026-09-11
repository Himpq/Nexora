// ChatTypes.ets - 对话领域模型
// 与 Web 端 messageSegments 协议对齐，消息整体作为一个可观察对象，
// 流式增量只更新自己的字段，依赖它的气泡 / 思考块 / 工具卡片各自精确刷新

import { ExaImageGallery, isExaWebSearchToolName, readExaImageGallery, readExaImageGalleryFromResult, stripExaImageMarkdown } from './ExaMedia';
import { isMapToolName, stripMapSceneSection } from './MapTool';
import { parseQuestionPayload, QuestionItem, QuestionPayload } from './QuestionLocks';

export type SegmentType = 'reasoning' | 'content' | 'function_call' | 'function_result' | 'question' | 'error';
export type MessageRole = 'user' | 'assistant';
export type ToolStatus = 'running' | 'done' | 'error';

// 工具结果载荷：SSE function_result 帧与历史 trace 共用的双轨字段
// - result: 原始结果（模型上下文同源）
// - modelVisibleResult: 模型可见结果（展示与上下文分离的旧轨）
// - displayResult: 前端优先展示结果（display_model_visible_result / display_result）
// - displayMedia: 结构化媒体（Exa 图片画廊）
export interface ToolResultPayload {
    result: string;
    modelVisibleResult: string;
    displayResult: string;
    displayMedia: Object | null;
}

export function makeToolResultPayload(
    result: string,
    modelVisibleResult: string,
    displayResult: string,
    displayMedia: Object | null
): ToolResultPayload {
    return {
        result: result,
        modelVisibleResult: modelVisibleResult,
        displayResult: displayResult,
        displayMedia: displayMedia
    };
}

// Token 用量：流式 token_usage 帧与历史消息 usage 字段统一映射到此
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    rawInputTokens: number;
    cachedInputTokens: number;
}

// 流式分片：与后端 SSE 的 segment 一一对应
export interface MessageSegment {
    type: SegmentType;
    text: string;
    name?: string;
    callId?: string;
    modelVisibleResult?: string;
    round?: number;
    // question 分段专用：交互问题载荷（渲染等待/已回答卡片）
    question?: QuestionPayload;
}

// 工具调用卡片：一条调用从发起(running)到回结果(done/error)的完整生命周期
@Observed
export class ToolCallItem {
    callId: string;
    name: string;
    argumentsText: string;
    resultText: string;
    displayText: string;
    round: number;
    status: ToolStatus;
    expanded: boolean;
    // Exa Web Search：搜索行下方独立图片画廊（null 表示非 Exa 或无图）
    exaGallery: ExaImageGallery | null;
    // 地图工具：原始结果 JSON，MessageBubble 交给 MapCard 解析并渲染
    mapResultJson: string;

    constructor(callId: string, name: string, argumentsText: string, round: number) {
        this.callId = callId;
        this.name = name;
        this.argumentsText = argumentsText;
        this.resultText = '';
        this.displayText = '';
        this.round = round;
        this.status = 'running';
        this.expanded = false;
        this.exaGallery = null;
        this.mapResultJson = '';
    }

    // 工具名称转成可读中文，方便演示时一眼看懂调用链
    get displayName(): string {
        return ToolNames.toDisplay(this.name);
    }

    // 完成时统一落展示轨：displayResult → modelVisibleResult → result，
    // Exa 剥离独立图片行、地图剔除 Scene 原始段并按需生成画廊/地图数据
    completeWith(payload: ToolResultPayload): void {
        this.resultText = payload.result;
        this.displayText = this.composeDisplayText(payload);
        this.exaGallery = isExaWebSearchToolName(this.name) ? this.composeExaGallery(payload) : null;
        this.mapResultJson = isMapToolName(this.name) ? payload.result : '';
        this.status = 'done';
        this.expanded = false;
    }

    failWith(errorText: string): void {
        this.resultText = errorText;
        this.displayText = errorText;
        this.status = 'error';
        this.expanded = true;
    }

    toggleExpanded(): void {
        this.expanded = !this.expanded;
    }

    private composeDisplayText(payload: ToolResultPayload): string {
        let text: string = payload.displayResult.length > 0
            ? payload.displayResult
            : (payload.modelVisibleResult.length > 0 ? payload.modelVisibleResult : payload.result);

        if (isExaWebSearchToolName(this.name)) {
            text = stripExaImageMarkdown(text);
        }

        if (isMapToolName(this.name)) {
            text = stripMapSceneSection(text);
        }

        return text;
    }

    private composeExaGallery(payload: ToolResultPayload): ExaImageGallery | null {
        const structured: ExaImageGallery | null = readExaImageGallery(payload.displayMedia);

        if (structured !== null) {
            return structured;
        }

        return readExaImageGalleryFromResult(payload.result);
    }
}

// 工具名本地化映射，未收录的工具原样展示
export class ToolNames {
    private static readonly MAP: Record<string, string> = {
        'web_search': '联网搜索',
        'search': '联网搜索',
        'knowledge_search': '知识库检索',
        'query_knowledge': '知识库检索',
        'read_file': '读取文件',
        'write_file': '写入文件',
        'python': '代码执行',
        'code_interpreter': '代码执行',
        'send_mail': '发送邮件',
        'get_weather': '天气查询'
    };

    static toDisplay(rawName: string): string {
        const key: string = rawName.trim().toLowerCase();
        return ToolNames.MAP[key] ?? rawName;
    }
}

// 一条消息：既是渲染数据源，也是流式写入的目标
@Observed
export class ChatMessage {
    index: number;
    role: MessageRole;
    content: string;
    reasoning: string;
    modelName: string;
    createdAt: number;
    streaming: boolean;
    errorMessage: string;
    thinkingExpanded: boolean;
    toolCalls: ToolCallItem[];
    questions: QuestionItem[];
    segments: MessageSegment[];
    usage: TokenUsage | null;

    constructor(index: number, role: MessageRole, content: string) {
        this.index = index;
        this.role = role;
        this.content = content;
        this.reasoning = '';
        this.modelName = '';
        this.createdAt = Date.now();
        this.streaming = false;
        this.errorMessage = '';
        this.thinkingExpanded = false;
        this.toolCalls = [];
        this.questions = [];
        this.segments = [];
        this.usage = null;
    }

    static createUser(text: string): ChatMessage {
        return new ChatMessage(0, 'user', text);
    }

    static createAssistant(): ChatMessage {
        const message: ChatMessage = new ChatMessage(0, 'assistant', '');
        message.streaming = true;
        message.thinkingExpanded = true;
        return message;
    }


    get isUser(): boolean {
        return this.role === 'user';
    }

    get hasThinking(): boolean {
        return this.reasoning.length > 0;
    }

    get hasToolCalls(): boolean {
        return this.toolCalls.length > 0;
    }

    get hasQuestions(): boolean {
        return this.questions.length > 0;
    }

    get isEmpty(): boolean {
        return this.content.length === 0
            && this.reasoning.length === 0
            && this.toolCalls.length === 0
            && this.questions.length === 0;
    }

    // 流式分片追加：同类型续写在末段，类型切换新开一段。
    // 扁平字段（content / reasoning）只做 O(1) 追加，避免思考文本（可达数万字、数百帧）时
    // 每帧全量重算所有 segments 造成 UI 主线程卡顿、流式输出像"没在输出"
    appendDelta(type: SegmentType, delta: string): void {
        if (delta.length === 0) {
            return;
        }

        const last: MessageSegment | undefined = this.segments[this.segments.length - 1];

        if (last !== undefined && last.type === type) {
            // 续写时创建新 segment 对象并赋值新数组：ArkUI ForEach 对对象属性续写
            // 不触发子项刷新，只有 item 引用变化时才重新渲染
            const updated: MessageSegment = {
                type: last.type,
                text: last.text + delta,
                name: last.name,
                callId: last.callId,
                modelVisibleResult: last.modelVisibleResult,
                round: last.round
            };
            this.segments = [...this.segments.slice(0, -1), updated];
        } else {
            this.segments = [...this.segments, { type: type, text: delta }];
        }

        if (type === 'reasoning') {
            this.reasoning += delta;
        } else if (type === 'content' || type === 'error') {
            this.content += delta;
        }
    }

    // 工具调用发起：首次创建时同步写入 segments，保证流式期间工具卡按真实时序渲染
    // （MessageBubble 按 segments 遍历渲染 ToolCallCard，缺段则工具卡不显示）
    beginToolCall(callId: string, name: string, argumentsText: string, round: number): void {
        const existing: ToolCallItem | undefined = this.findToolCall(callId);

        if (existing !== undefined) {
            existing.argumentsText = argumentsText;
            this.toolCalls = [...this.toolCalls];
            return;
        }

        this.toolCalls = [...this.toolCalls, new ToolCallItem(callId, name, argumentsText, round)];
        this.segments = [...this.segments, { type: 'function_call', text: argumentsText, name: name, callId: callId, round: round }];
    }

    // 工具结果回填，按 callId 精确匹配：同步写入 segments 占位，确保后续正文新开段。
    // 已有结果（轮询与 SSE 补发同一帧）直接忽略，避免同一次调用重复追加 function_result 段
    completeToolCall(callId: string, payload: ToolResultPayload): void {
        const target: ToolCallItem | undefined = this.findToolCall(callId);

        if (target === undefined || target.status !== 'running') {
            return;
        }

        target.completeWith(payload);
        this.toolCalls = [...this.toolCalls];
        this.segments = [...this.segments, { type: 'function_result', text: payload.result, name: target.name, callId: callId, round: target.round }];
    }

    failToolCall(callId: string, errorText: string): void {
        const target: ToolCallItem | undefined = this.findToolCall(callId);

        if (target === undefined) {
            return;
        }

        target.failWith(errorText);
        this.toolCalls = [...this.toolCalls];
    }

    // 流式 question 帧：注册卡片 + 写入 segments 时序，
    // 并闭合同 callId 的运行中工具卡（服务端 question 工具只发 question 帧，
    // 不发 function_result 帧；不闭合会一直转圈，历史回放却显示完成，两态必须一致）。
    // 同一 callId 只允许一个 question 分段（轮询与 SSE 补发同一帧时不重复渲染卡片）
    beginQuestion(callId: string, payloadSource: Object | null): QuestionItem {
        const item: QuestionItem = this.registerQuestion(callId, payloadSource);

        if (!this.hasQuestionSegment(callId)) {
            this.segments = [...this.segments, {
                type: 'question',
                text: '',
                name: 'question',
                callId: callId,
                question: item.payload
            }];
        }

        const running: ToolCallItem | undefined = this.findToolCall(callId);

        if (running !== undefined && running.status === 'running') {
            running.completeWith(makeToolResultPayload('', '', '', null));
            this.toolCalls = [...this.toolCalls];
        }

        return item;
    }

    // 注册 question 卡片（历史回放与流式共用）：同 callId 只保留一个实例
    registerQuestion(callId: string, payloadSource: Object | null): QuestionItem {
        const payload: QuestionPayload = parseQuestionPayload(payloadSource);
        const existing: QuestionItem | undefined = this.findQuestion(callId);

        if (existing !== undefined) {
            existing.applyPayload(payload);
            this.questions = [...this.questions];
            return existing;
        }

        const item: QuestionItem = new QuestionItem(callId, payload);
        this.questions = [...this.questions, item];
        return item;
    }

    markQuestionAnswered(callId: string, answerText: string): void {
        const item: QuestionItem | undefined = this.findQuestion(callId);

        if (item === undefined) {
            return;
        }

        item.markAnswered(answerText);
        this.questions = [...this.questions];
    }

    setError(text: string): void {
        this.errorMessage = text;
        this.streaming = false;
    }

    setUsage(usage: TokenUsage): void {
        this.usage = usage;
    }

    finish(): void {
        this.streaming = false;
    }

    private findToolCall(callId: string): ToolCallItem | undefined {
        for (let i: number = 0; i < this.toolCalls.length; i++) {
            if (this.toolCalls[i].callId === callId) {
                return this.toolCalls[i];
            }
        }

        return undefined;
    }

    private findQuestion(callId: string): QuestionItem | undefined {
        for (let i: number = 0; i < this.questions.length; i++) {
            if (this.questions[i].callId === callId) {
                return this.questions[i];
            }
        }

        return undefined;
    }

    private hasQuestionSegment(callId: string): boolean {
        for (let i: number = 0; i < this.segments.length; i++) {
            const segment: MessageSegment = this.segments[i];

            if (segment.type === 'question' && segment.callId === callId) {
                return true;
            }
        }

        return false;
    }
}

// ---------- 历史消息还原 ----------
// v3 存储：后端 process_steps 形如 [{type:'content'|'reasoning_content'|'function_call'|'function_result', ...}]
export interface RawProcessStep {
    type?: string;
    content?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    result?: string;
    round?: number;
    // function_result 双轨展示字段（v3 老会话可能只有 result + model_visible_result）
    model_visible_result?: string;
    display_result?: string;
    display_model_visible_result?: string;
    display_media?: Object | null;
    // question 步骤：question 载荷（v3/v4 均在 events/process_steps 中保留）
    question?: Object | null;
}

// v4 存储：assistant 消息的调试数据与可见正文分离——可见正文在顶层 content，
// 推理链 / 工具轨迹以「trace」结构化保存（events 保序保 type，或 tool_calls /
// tool_results / content_segments / errors 四桶）。messageFromHistory 必须读 trace
// 才能还原 thinking 块与工具卡（曾只读 reasoning/metadata.process_steps，v4 会话
// 重开后思考与工具全部丢失）
export interface RawTrace {
    events?: RawProcessStep[];
    tool_calls?: RawProcessStep[];
    tool_results?: RawProcessStep[];
    content_segments?: RawProcessStep[];
    errors?: RawProcessStep[];
}

export interface RawHistoryMessage {
    index?: number;
    role?: string;
    content?: string;
    reasoning?: string;
    model_name?: string;
    created_at?: number;
    metadata?: Record<string, Object>;
    trace?: RawTrace;
    usage?: Record<string, Object>;
}

// 从历史响应还原一条可渲染消息：优先按 process_steps / trace 还原完整链路，否则退化为正文+思考
export function messageFromHistory(raw: RawHistoryMessage, index: number): ChatMessage {
    const role: MessageRole = raw.role === 'user' ? 'user' : 'assistant';
    const message: ChatMessage = new ChatMessage(index, role, raw.content ?? '');
    message.modelName = raw.model_name ?? '';
    message.reasoning = raw.reasoning ?? '';
    message.createdAt = raw.created_at ?? Date.now();
    message.usage = readUsageFromHistory(raw);

    // 步骤源优先级：v3 metadata.process_steps → v4 trace(events 或四桶)。trace 里的
    // reasoning_content 步骤让思考链可还原；tool_calls/tool_results 重建工具卡生命周期
    let steps: RawProcessStep[] = readProcessSteps(raw.metadata);

    if (steps.length === 0) {
        steps = readStepsFromTrace(raw.trace);
    }

    if (steps.length > 0) {
        applyProcessSteps(message, steps);

        // 兜底合并：步骤只含工具轮（正文全在顶层 content）时补齐正文；
        // 步骤无 reasoning 而顶层带 reasoning（个别 v3 变体）时补思考，保证任何存储都不丢块
        if (message.content.length === 0) {
            const topContent: string = raw.content ?? '';

            if (topContent.length > 0) {
                message.content = topContent;
                message.segments.push({ type: 'content', text: topContent });
            }
        }

        if (message.reasoning.length === 0) {
            const topReasoning: string = raw.reasoning ?? '';

            if (topReasoning.length > 0) {
                message.reasoning = topReasoning;
                message.segments.unshift({ type: 'reasoning', text: topReasoning });
            }
        }

        return message;
    }

    message.segments = [];

    if (message.reasoning.length > 0) {
        message.segments.push({ type: 'reasoning', text: message.reasoning });
    }

    if (message.content.length > 0) {
        message.segments.push({ type: 'content', text: message.content });
    }

    return message;
}

// v4 trace → 步骤序列。events 存在时保序保 type 直接使用（与后端 extract 一致）；
// 否则把四桶投影为 v3 步骤形态（content_segments 保留自身 type——推理段是
// reasoning_content，不能像后端回放投影那样压成 content，否则鸿蒙端丢思考块）
function readStepsFromTrace(trace?: RawTrace): RawProcessStep[] {
    if (trace === undefined) {
        return [];
    }

    const events: RawProcessStep[] | undefined = trace.events;

    if (Array.isArray(events) && events.length > 0) {
        const out: RawProcessStep[] = [];

        for (let i: number = 0; i < events.length; i++) {
            out.push(events[i] as RawProcessStep);
        }

        return out;
    }

    const steps: RawProcessStep[] = [];

    const segments: RawProcessStep[] | undefined = trace.content_segments;

    if (Array.isArray(segments)) {
        for (let i: number = 0; i < segments.length; i++) {
            const segment: RawProcessStep = segments[i] as RawProcessStep;

            if (typeof segment === 'object' && segment !== null) {
                steps.push({
                    type: (segment.type ?? '').length > 0 ? (segment.type as string) : 'content',
                    content: segment.content ?? '',
                    round: segment.round
                });
            }
        }
    }

    const calls: RawProcessStep[] | undefined = trace.tool_calls;
    const results: RawProcessStep[] | undefined = trace.tool_results;
    const callCount: number = Array.isArray(calls) ? calls.length : 0;
    const resultCount: number = Array.isArray(results) ? results.length : 0;

    // 工具步骤按桶内同序配对：v4 存储 call/result 一一对应（旧数据部分 call_id 为空，
    // 两个桶的空 id 数量一致）。按序号交错生成 function_call/function_result，
    // 空 id 用桶内序号合成，保证完整 ToolCallItem 生命周期可重建且 ForEach key 唯一
    const paired: number = callCount > resultCount ? callCount : resultCount;

    for (let k: number = 0; k < paired; k++) {
        if (k < callCount) {
            const call: RawProcessStep = (calls as RawProcessStep[])[k] as RawProcessStep;

            if (typeof call === 'object' && call !== null) {
                const rawCid: string = call.call_id ?? '';
                steps.push({
                    type: 'function_call',
                    name: call.name ?? '',
                    arguments: call.arguments ?? call.content ?? '{}',
                    call_id: rawCid.length > 0 ? rawCid : 'tc_' + k,
                    round: call.round
                });
            }
        }

        if (k < resultCount) {
            const result: RawProcessStep = (results as RawProcessStep[])[k] as RawProcessStep;

            if (typeof result === 'object' && result !== null) {
                const rawCid: string = result.call_id ?? '';
                steps.push({
                    type: 'function_result',
                    name: result.name ?? '',
                    result: result.result ?? '',
                    call_id: rawCid.length > 0 ? rawCid : 'tc_' + k,
                    round: result.round
                });
            }
        }
    }

    const errors: RawProcessStep[] | undefined = trace.errors;

    if (Array.isArray(errors)) {
        for (let i: number = 0; i < errors.length; i++) {
            const error: RawProcessStep = errors[i] as RawProcessStep;

            if (typeof error === 'object' && error !== null) {
                steps.push({
                    type: 'error',
                    content: error.content ?? ''
                });
            }
        }
    }

    return steps;
}

function readProcessSteps(metadata?: Record<string, Object>): RawProcessStep[] {
    if (metadata === undefined) {
        return [];
    }

    const raw: Object | undefined = metadata['process_steps'];

    if (!Array.isArray(raw)) {
        return [];
    }

    const source: Object[] = raw as Object[];
    const steps: RawProcessStep[] = [];

    for (let i: number = 0; i < source.length; i++) {
        steps.push(source[i] as RawProcessStep);
    }

    return steps;
}

function applyProcessSteps(message: ChatMessage, steps: RawProcessStep[]): void {
    const segments: MessageSegment[] = [];

    for (let i: number = 0; i < steps.length; i++) {
        applyOneStep(message, steps[i], segments);
    }

    message.segments = segments;
    rebuildFlatFromSegments(message);
}

function applyOneStep(message: ChatMessage, step: RawProcessStep, segments: MessageSegment[]): void {
    const type: string = step.type ?? '';
    const text: string = step.content ?? '';
    const name: string = (step.name ?? '').trim();
    const callId: string = step.call_id ?? '';
    const round: number = step.round ?? 0;

    if (type === 'reasoning_content') {
        segments.push({ type: 'reasoning', text: text });
        return;
    }

    if (type === 'content' || type === 'error') {
        const segmentType: SegmentType = type === 'error' ? 'error' : 'content';
        segments.push({ type: segmentType, text: text });
        return;
    }

    if (type === 'function_call') {
        const args: string = step.arguments ?? '';
        segments.push({ type: 'function_call', text: args, name: name, callId: callId, round: round });
        message.beginToolCall(callId, name, args, round);
        return;
    }

    if (type === 'function_result') {
        const payload: ToolResultPayload = makeToolResultPayload(
            step.result ?? '',
            step.model_visible_result ?? '',
            readStepDisplayResult(step),
            step.display_media ?? null
        );
        segments.push({ type: 'function_result', text: payload.result, name: name, callId: callId, round: round });
        message.completeToolCall(callId, payload);
        return;
    }

    if (type === 'question') {
        const item: QuestionItem = message.registerQuestion(callId, step.question ?? null);
        segments.push({ type: 'question', text: '', name: 'question', callId: callId, question: item.payload });

        // 历史载荷带 resolved/answer 时直接呈现已回答态（线上作答态另由本地回答锁补齐）
        if (item.payload.resolved) {
            item.markAnswered(item.payload.answer);
        }

        return;
    }
}

// 展示轨优先级：display_model_visible_result → display_result（与 Web stepToSegment 一致）
function readStepDisplayResult(step: RawProcessStep): string {
    const displayModelVisible: string = (step.display_model_visible_result ?? '').trim();

    if (displayModelVisible.length > 0) {
        return displayModelVisible;
    }

    return (step.display_result ?? '').trim();
}

function rebuildFlatFromSegments(message: ChatMessage): void {
    let reasoning: string = '';
    let content: string = '';

    for (let i: number = 0; i < message.segments.length; i++) {
        const segment: MessageSegment = message.segments[i];

        if (segment.type === 'reasoning') {
            reasoning += segment.text;
            continue;
        }

        if (segment.type === 'content' || segment.type === 'error') {
            content += segment.text;
        }
    }

    message.reasoning = reasoning;
    message.content = content;
}

// 从历史消息还原 Token 用量：v4 顶层 usage → v3 metadata.io_tokens
function readUsageFromHistory(raw: RawHistoryMessage): TokenUsage | null {
    const fromTop: TokenUsage | null = readUsageDict(raw.usage);

    if (fromTop !== null) {
        return fromTop;
    }

    if (raw.metadata !== undefined) {
        const ioRaw: Object | undefined = raw.metadata['io_tokens'];

        if (ioRaw !== undefined && typeof ioRaw === 'object') {
            return readUsageDict(ioRaw as Record<string, Object>);
        }
    }

    return null;
}

function readUsageDict(dict: Record<string, Object> | undefined): TokenUsage | null {
    if (dict === undefined) {
        return null;
    }

    const input: number = readNum(dict, 'input', 'input_tokens');
    const output: number = readNum(dict, 'output', 'output_tokens');

    if (input === 0 && output === 0) {
        return null;
    }

    return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: readNum(dict, 'total', 'total_tokens'),
        rawInputTokens: readNum(dict, 'raw_input', 'raw_input_tokens'),
        cachedInputTokens: readNum(dict, 'cached_input', 'cached_input_tokens')
    };
}

function readNum(dict: Record<string, Object>, key1: string, key2: string): number {
    const v1: Object | undefined = dict[key1];

    if (typeof v1 === 'number') {
        return v1;
    }

    const v2: Object | undefined = dict[key2];

    if (typeof v2 === 'number') {
        return v2;
    }

    return 0;
}
