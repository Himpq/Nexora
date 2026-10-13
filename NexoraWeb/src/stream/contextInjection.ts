/**
 * contextInjection.ts — Modified Injection 卡片纯逻辑(协议解析 + 文案格式化)
 *
 * 职责:
 *   - 定义后端 context_injection 数据块的结构与解析(纯函数,无 DOM/Vue 依赖)
 *   - 构建卡片状态文案,展示本轮注入了哪些 volatile 块(名称 + 字符数)
 *
 * 协议(见 NexoraCode/model/turn_injection.py):
 *   type: context_injection
 *   head_chars: head(system prompt)字符数,恒定不变
 *   blocks: [{ name, chars, mode, rows }] —— tail volatile 注入块诊断;
 *           rows 为本轮变更行(added/removed),与真正注入模型的内容同源,
 *           界面直接渲染成 diff,不再只显示字符数。
 *
 * 设计契约(与 ChatDBServer 的 knowledge diff 通道同构):
 *   head 恒定(prefix cache 命中),volatile 块走 tail 每轮重发;
 *   卡片按知识库 diff 的行样式渲染 + / - 变更行。
 */

/** 单个变更行:与知识库 diff 同构,added 绿色 / removed 红色 / note 说明行 */
export interface ContextInjectionRow {
    kind: 'added' | 'removed' | 'note'
    text: string
}

/** 单个 volatile 注入块的诊断信息 */
export interface ContextInjectionBlock {
    name: string
    chars: number
    /** full=首轮全量注入,diff=与基线比对后的增量 */
    mode: 'full' | 'diff'
    rows: ContextInjectionRow[]
}

/** 后端 context_injection 数据块(字段均可能缺失,读取必须容错) */
export interface ContextInjectionStep {
    type?: string
    head_chars: number
    blocks: ContextInjectionBlock[]
}

/** 注入块稳定名称 → 中文展示名 */
const INJECTION_BLOCK_LABELS: Record<string, string> = {
    project_conventions: '项目约定 (AGENTS.md)',
    custom_instructions: '自定义提示词',
}

/** 非负整数化(NaN/负数统一归零) */
function safeInt(value: unknown): number {
    const num = Number(value || 0)

    if (!Number.isFinite(num)) {
        return 0
    }

    return Math.max(0, Math.floor(num))
}

/** 注入块名称 → 展示名;未知名称原样返回,保证新增通道不改前端也能显示 */
export function injectionBlockLabel(name: unknown): string {
    const key = String(name || '').trim()

    if (!key) {
        return '未知注入块'
    }

    return INJECTION_BLOCK_LABELS[key] || key
}

/** 解析变更行:非数组或结构非法一律丢弃,只保留 kind/text 合法的行 */
export function parseInjectionRows(raw: unknown): ContextInjectionRow[] {
    if (!Array.isArray(raw)) {
        return []
    }

    const rows: ContextInjectionRow[] = []

    raw.forEach((row) => {
        if (!row || typeof row !== 'object') {
            return
        }

        const item = row as Record<string, unknown>
        const text = String(item.text ?? '')
        const rawKind = String(item.kind || '').trim()
        const kind: ContextInjectionRow['kind'] = rawKind === 'removed'
            ? 'removed'
            : rawKind === 'note' ? 'note' : 'added'

        if (!text.trim()) {
            return
        }

        rows.push({ kind, text })
    })

    return rows
}

/**
 * 解析后端数据块为注入诊断;非 context_injection 或结构非法返回 null。
 * 纯函数,供流式块与历史 metadata 复用,避免各调用点重复判断。
 */
export function parseContextInjectionStep(raw: unknown): ContextInjectionStep | null {
    if (!raw || typeof raw !== 'object') {
        return null
    }

    const record = raw as Record<string, unknown>

    if (String(record.type || '').trim() !== 'context_injection') {
        return null
    }

    const rawBlocks = Array.isArray(record.blocks) ? record.blocks : []
    const blocks: ContextInjectionBlock[] = []

    rawBlocks.forEach((block) => {
        if (!block || typeof block !== 'object') {
            return
        }

        const item = block as Record<string, unknown>
        const name = String(item.name || '').trim()

        if (!name) {
            return
        }

        blocks.push({
            name,
            chars: safeInt(item.chars),
            mode: String(item.mode || '').trim() === 'diff' ? 'diff' : 'full',
            rows: parseInjectionRows(item.rows),
        })
    })

    // 无有效块时不展示卡片:避免空卡片干扰阅读。
    if (blocks.length === 0) {
        return null
    }

    return {
        type: 'context_injection',
        head_chars: safeInt(record.head_chars),
        blocks,
    }
}

/** 从消息 metadata 提取注入诊断(重进对话后从快照恢复) */
export function contextInjectionFromMetadata(metadata: unknown): ContextInjectionStep | null {
    if (!metadata || typeof metadata !== 'object') {
        return null
    }

    const record = metadata as Record<string, unknown>

    return parseContextInjectionStep(record.context_injection)
}

/** 取消息上"当前生效"的注入诊断:流式本地字段优先,历史回退到 metadata */
export function resolveActiveContextInjectionStep(
    message: Record<string, unknown> | null | undefined
): ContextInjectionStep | null {
    if (!message) {
        return null
    }

    const live = parseContextInjectionStep(message.injectionStep)

    if (live) {
        return live
    }

    return contextInjectionFromMetadata(message.metadata)
}

/** 卡片状态文案:列出本轮注入的块名与变更行数 */
export function buildContextInjectionStatusText(step: ContextInjectionStep): string {
    const parts = step.blocks.map((block) => {
        const added = block.rows.filter((row) => row.kind === 'added').length
        const removed = block.rows.filter((row) => row.kind === 'removed').length
        const label = injectionBlockLabel(block.name)

        if (added === 0 && removed === 0) {
            return `${label} ${block.chars} 字符`
        }

        return `${label} +${added} -${removed}`
    })

    return parts.length > 0 ? parts.join(' · ') : '本轮无注入'
}


\n