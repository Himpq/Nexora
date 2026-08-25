/**
 * questionCard.ts — question/ask_for_permission 工具卡片纯逻辑
 *
 * 职责:
 *   - 问题载荷规范化与稳定 ID(含一次性问题的内容哈希 ID,对齐原版 buildQuestionCardId)
 *   - 回答锁定存储(与原版 nexora_question_locks_v1 完全互操作,刷新后不再开放作答)
 *
 * 存储格式(对齐原版 writeStoredQuestionLock):
 *   localStorage["nexora_question_locks_v1"] = { "<conversationId>::<questionId>": "<answer>" }
 */

/** 权限请求描述(ask_for_permission 附带) */
export interface QuestionPermissionRequest {
    path: string
    operation: 'read' | 'write' | 'read_write'
    scope: 'file' | 'dir'
    reason: string
    sensitive: boolean
}

/** question 工具载荷(process_steps 中 type=question 的 question 字段) */
export interface QuestionPayload {
    track_answer?: boolean
    question_id?: string
    question_card_id?: string
    question_title?: string
    question_content?: string
    choices?: Array<string>
    allow_other?: boolean
    permission_request?: Record<string, unknown> | null
    resolved?: boolean
    answer?: string
    [key: string]: unknown
}

export const QUESTION_LOCK_STORAGE_KEY = 'nexora_question_locks_v1'

const DRAFT_CONVERSATION_KEY = '__draft__'

/** FNV-1a 32bit → base36(对齐原版 buildQuestionIdentityHash) */
export function buildQuestionIdentityHash(sourceText: string): string {
    const src = String(sourceText || '')
    let hash = 2166136261

    for (let i = 0; i < src.length; i += 1) {
        hash ^= src.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }

    return (hash >>> 0).toString(36)
}

/** 权限请求规范化(非法返回 null,对齐原版 normalizeQuestionPermissionRequest) */
export function normalizeQuestionPermissionRequest(value: unknown): QuestionPermissionRequest | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value as Record<string, unknown>
    const requestPath = String(record.path || '').trim()
    const rawOperation = String(record.operation || record.access || '').trim().toLowerCase()
    const scope = String(record.scope || '').trim().toLowerCase()
    const reason = String(record.reason || '').trim()

    if (!requestPath || !reason) {
        return null
    }

    if (!['read', 'write', 'read_write'].includes(rawOperation)) {
        return null
    }

    if (!['file', 'dir'].includes(scope)) {
        return null
    }

    return {
        path: requestPath,
        operation: rawOperation as QuestionPermissionRequest['operation'],
        scope: scope as QuestionPermissionRequest['scope'],
        reason,
        sensitive: !!record.sensitive,
    }
}

/**
 * 稳定卡片 ID:
 * question_card_id → question_id → 内容哈希(一次性问题刷新后不重新开放作答)
 */
export function buildQuestionCardId(payload: QuestionPayload): string {
    const requestCardId = String(payload.question_card_id || '').trim()

    if (requestCardId) {
        return requestCardId
    }

    const persistentQuestionId = String(payload.question_id || '').trim()

    if (persistentQuestionId) {
        return persistentQuestionId
    }

    const choices = Array.isArray(payload.choices)
        ? payload.choices.map((choice) => String(choice || '').trim()).filter(Boolean)
        : []
    const identityParts = [
        String(payload.question_title || '').trim(),
        String(payload.question_content || '').trim(),
        choices.join('\n'),
        String(payload.allow_other !== false),
    ]

    return `question_${buildQuestionIdentityHash(identityParts.join('\n---\n'))}`
}

function readLockStore(): Record<string, string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_LOCK_STORAGE_KEY) || '{}')

        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
    } catch {
        return {}
    }
}

function lockScopeKey(conversationId: string, questionId: string): string {
    const convKey = String(conversationId || '').trim() || DRAFT_CONVERSATION_KEY

    return `${convKey}::${String(questionId || '').trim()}`
}

/** 读取已锁定回答(空串表示未回答) */
export function readQuestionLock(conversationId: string, questionId: string): string {
    const qid = String(questionId || '').trim()

    if (!qid) {
        return ''
    }

    return String(readLockStore()[lockScopeKey(conversationId, qid)] || '').trim()
}

/** 写入回答锁(写入即视为已回答;空回答不写) */
export function writeQuestionLock(conversationId: string, questionId: string, answerText: string): void {
    const qid = String(questionId || '').trim()
    const answer = String(answerText || '').trim()

    if (!qid || !answer) {
        return
    }

    try {
        const store = readLockStore()

        store[lockScopeKey(conversationId, qid)] = answer

        localStorage.setItem(QUESTION_LOCK_STORAGE_KEY, JSON.stringify(store))
    } catch {
        // 存储失败不影响本次会话内的回答态,仅刷新后可能重新开放
    }
}
