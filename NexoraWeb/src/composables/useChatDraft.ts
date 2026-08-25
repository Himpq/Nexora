/**
 * useChatDraft.ts — 输入框草稿缓存(按会话,防刷新丢失)
 *
 * 存储:localStorage `nexora_chat_drafts_v1` → { [conversationId]: "草稿文字" }
 *   - 无会话(未创建/未选中,currentId 为空串)时使用独立键 `''`,草稿独立保留
 *   - 空草稿不落缓存,全部为空时删除整键(避免脏数据残留)
 *   - 读取失败/隐私模式静默降级,不阻塞输入
 */

const STORAGE_KEY = 'nexora_chat_drafts_v1'

/** 会话键归一:空串保持独立键,不做 trim 归并(会话 ID 本身无前后空白) */
function draftKey(conversationId: string): string {
    return String(conversationId || '')
}

/** 读取全部草稿(缺失/损坏返回空对象) */
function readDrafts(): Record<string, string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)

        if (!raw) {
            return {}
        }

        const parsed = JSON.parse(raw)

        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
    } catch {
        return {}
    }
}

/** 保存会话草稿(空文本视为清除该会话草稿) */
export function saveDraft(conversationId: string, text: string): void {
    const key = draftKey(conversationId)
    const drafts = readDrafts()
    const value = String(text || '')

    if (!value) {
        delete drafts[key]
    } else {
        drafts[key] = value
    }

    try {
        if (Object.keys(drafts).length === 0) {
            localStorage.removeItem(STORAGE_KEY)
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
        }
    } catch {
        // 配额/隐私模式失败不阻塞输入
    }
}

/** 读取会话草稿(无则空串) */
export function loadDraft(conversationId: string): string {
    const drafts = readDrafts()

    return String(drafts[draftKey(conversationId)] ?? '')
}

/** 清除会话草稿(发送成功后调用) */
export function clearDraft(conversationId: string): void {
    saveDraft(conversationId, '')
}