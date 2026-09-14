// QuestionLocks.ets - question 工具载荷归一化与回答锁
// 回答锁与 NexoraWeb localStorage nexora_question_locks_v1 互操作：
// key = conversationId::cardId，空会话 id 归 __draft__

import { Json } from './JsonUtil';

// 权限请求描述（ask_for_permission 附带）
export interface QuestionPermissionRequest {
    path: string;
    operation: string;
    scope: string;
    reason: string;
    sensitive: boolean;
}

// question 工具载荷（process_steps / SSE 中 type=question 的 question 字段）
export interface QuestionPayload {
    trackAnswer: boolean;
    questionId: string;
    questionCardId: string;
    questionTitle: string;
    questionContent: string;
    choices: string[];
    allowOther: boolean;
    permissionRequest: QuestionPermissionRequest | null;
    resolved: boolean;
    answer: string;
}

export function emptyQuestionPayload(): QuestionPayload {
    return {
        trackAnswer: false,
        questionId: '',
        questionCardId: '',
        questionTitle: '',
        questionContent: '',
        choices: [],
        allowOther: true,
        permissionRequest: null,
        resolved: false,
        answer: ''
    };
}

// 权限请求规范化：同 Web normalizeQuestionPermissionRequest，字段不全一律视为非权限卡
function parsePermissionRequest(raw: Object | null): QuestionPermissionRequest | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }

    const record: Record<string, Object> = raw as Record<string, Object>;
    const requestPath: string = Json.string(record, 'path').trim();
    const rawOperation: string = Json.string(record, 'operation').length > 0
        ? Json.string(record, 'operation')
        : Json.string(record, 'access');
    const operation: string = rawOperation.trim().toLowerCase();
    const scope: string = Json.string(record, 'scope').trim().toLowerCase();
    const reason: string = Json.string(record, 'reason').trim();

    if (requestPath.length === 0 || reason.length === 0) {
        return null;
    }

    if (operation !== 'read' && operation !== 'write' && operation !== 'read_write') {
        return null;
    }

    if (scope !== 'file' && scope !== 'dir') {
        return null;
    }

    return {
        path: requestPath,
        operation: operation,
        scope: scope,
        reason: reason,
        sensitive: Json.boolean(record, 'sensitive')
    };
}

export function parseQuestionPayload(source: Object | null): QuestionPayload {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        return emptyQuestionPayload();
    }

    const record: Record<string, Object> = source as Record<string, Object>;
    const rawChoices: Object[] = Json.array(record, 'choices');
    const choices: string[] = [];

    for (let i: number = 0; i < rawChoices.length; i++) {
        const rawChoice: Object = rawChoices[i];

        if (typeof rawChoice === 'string') {
            const choice: string = (rawChoice as string).trim();

            if (choice.length > 0) {
                choices.push(choice);
            }
        }
    }

    return {
        trackAnswer: Json.boolean(record, 'track_answer'),
        questionId: Json.string(record, 'question_id').trim(),
        questionCardId: Json.string(record, 'question_card_id').trim(),
        questionTitle: Json.string(record, 'question_title').trim(),
        questionContent: Json.string(record, 'question_content').trim(),
        choices: choices,
        allowOther: Json.fieldOrNull(record, 'allow_other') !== false,
        permissionRequest: parsePermissionRequest(Json.fieldOrNull(record, 'permission_request')),
        resolved: Json.boolean(record, 'resolved'),
        answer: Json.string(record, 'answer').trim()
    };
}

// FNV-1a 32bit → base36（与 Web buildQuestionIdentityHash 逐位一致）
function buildQuestionIdentityHash(sourceText: string): string {
    let hash: number = 2166136261;

    for (let i: number = 0; i < sourceText.length; i++) {
        hash = hash ^ sourceText.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

// 稳定卡片 ID：question_card_id → question_id → 内容哈希
export function buildQuestionCardId(payload: QuestionPayload): string {
    if (payload.questionCardId.length > 0) {
        return payload.questionCardId;
    }

    if (payload.questionId.length > 0) {
        return payload.questionId;
    }

    const identity: string = [
        payload.questionTitle,
        payload.questionContent,
        payload.choices.join('\n'),
        String(payload.allowOther)
    ].join('\n---\n');

    return 'question_' + buildQuestionIdentityHash(identity);
}

const DRAFT_CONVERSATION_KEY: string = '__draft__';

function lockScopeKey(conversationId: string, cardId: string): string {
    const convKey: string = conversationId.trim().length > 0 ? conversationId.trim() : DRAFT_CONVERSATION_KEY;

    return convKey + '::' + cardId.trim();
}

// 锁存储 JSON → 字典：非字符串值一律忽略
function parseLockStore(storeJson: string): Record<string, string> {
    const parsed: Record<string, Object> | null = Json.parseObject(storeJson);

    if (parsed === null) {
        return {};
    }

    const store: Record<string, string> = {};
    const keys: string[] = Object.keys(parsed);

    for (let i: number = 0; i < keys.length; i++) {
        const value: Object = parsed[keys[i]];

        if (typeof value === 'string') {
            store[keys[i]] = value as string;
        }
    }

    return store;
}

// 读取已锁定回答（空串表示未回答）
export function readQuestionLock(storeJson: string, conversationId: string, cardId: string): string {
    if (cardId.trim().length === 0) {
        return '';
    }

    const store: Record<string, string> = parseLockStore(storeJson);
    const value: string | undefined = store[lockScopeKey(conversationId, cardId)];

    return value === undefined ? '' : value.trim();
}

// 写入回答锁，返回新存储 JSON（空回答不写，原样返回）
export function writeQuestionLock(
    storeJson: string,
    conversationId: string,
    cardId: string,
    answerText: string
): string {
    const card: string = cardId.trim();
    const answer: string = answerText.trim();

    if (card.length === 0 || answer.length === 0) {
        return storeJson;
    }

    const store: Record<string, string> = parseLockStore(storeJson);
    store[lockScopeKey(conversationId, card)] = answer;

    return JSON.stringify(store);
}

// 回答卡片渲染项：一条 question 的完整生命周期（等待 / 提交中 / 已回答）
@Observed
export class QuestionItem {
    callId: string;
    cardId: string;
    payload: QuestionPayload;
    answered: boolean;
    submitting: boolean;
    answer: string;

    constructor(callId: string, payload: QuestionPayload) {
        this.callId = callId;
        this.cardId = buildQuestionCardId(payload);
        this.payload = payload;
        this.answered = payload.resolved;
        this.submitting = false;
        this.answer = payload.resolved ? payload.answer : '';
    }

    // 历史/回放更新载荷时重算卡片 ID 与已回答态（已本地作答的卡片保持不变）
    applyPayload(payload: QuestionPayload): void {
        this.payload = payload;
        this.cardId = buildQuestionCardId(payload);

        if (!this.answered && payload.resolved) {
            this.answered = true;
            this.answer = payload.answer;
        }
    }

    markAnswered(answerText: string): void {
        this.answer = answerText;
        this.answered = true;
        this.submitting = false;
    }

    // 权限请求卡片判定：UI 路径走普通方法（项目约定：@ObjectLink 组件内不用 getter）
    isPermissionCard(): boolean {
        return this.payload.permissionRequest !== null;
    }
}
