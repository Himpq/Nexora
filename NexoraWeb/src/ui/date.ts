/**
 * date.ts — 通用日期工具(General Design Development Package 基础模块)
 *
 * 职责:
 *   - 本地时区 YYYY-MM-DD 键的格式化/解析/校验、短标签、月份归一化与平移
 *   - 自 components/workspaces/workspaceDisplay.ts 上收:凡与 Workspace 业务
 *     无关的纯日期函数统一落位此处,供 GDDP 组件(ui/DatePicker 等)与业务层共用;
 *   - workspaceDisplay.ts 对这些名字做转发导出,历史引用不受影响。
 */

/** 本地时区 YYYY-MM-DD 键 */
export function formatDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${date.getFullYear()}-${month}-${day}`
}

export function todayKey(): string {
    return formatDateKey(new Date())
}

/** 解析 YYYY-MM-DD;格式或真实日期不合法返回 null */
export function parseDateKey(value: unknown): Date | null {
    const text = String(value || '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return null
    }

    const year = Number(text.slice(0, 4))
    const month = Number(text.slice(5, 7))
    const day = Number(text.slice(8, 10))
    const date = new Date(year, month - 1, day)

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null
    }

    return date
}

/** 空串合法(表示未选择),其余必须是真实存在的 YYYY-MM-DD */
export function isValidDateKey(value: unknown): boolean {
    const text = String(value || '').trim()

    return !text || parseDateKey(text) !== null
}

/** MM-DD 短标签 */
export function formatDateLabel(value: unknown): string {
    const date = parseDateKey(value)

    if (!date) {
        return String(value || '').trim()
    }

    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${month}-${day}`
}

/** YYYY-MM 归一化(非法返回空串) */
export function normalizeMonth(value: unknown): string {
    const text = String(value || '').trim()

    if (!/^\d{4}-\d{2}$/.test(text)) {
        return ''
    }

    const month = Number(text.slice(5, 7))

    return month >= 1 && month <= 12 ? text : ''
}

/** 月份输入宽容解析(支持 202503 / 2025-3 / 2025年3月 等) */
export function normalizeMonthInput(value: unknown): string {
    const text = String(value || '').trim()

    if (!text) {
        return ''
    }

    const compactMatch = text.match(/^(\d{4})(\d{2})$/)
    const separatedMatch = text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/)
    const match = compactMatch || separatedMatch

    if (!match) {
        return normalizeMonth(text)
    }

    return normalizeMonth(`${match[1]}-${String(Number(match[2])).padStart(2, '0')}`)
}

/** 月份平移 */
export function shiftMonth(monthValue: string, offset: number): string {
    const month = normalizeMonth(monthValue) || todayKey().slice(0, 7)
    const year = Number(month.slice(0, 4))
    const monthIndex = Number(month.slice(5, 7)) - 1
    const date = new Date(year, monthIndex + offset, 1)

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 日期范围选择器初始月份:优先开始,其次截止,否则当月 */
export function dateRangeMonth(startDate = '', dueDate = ''): string {
    return (startDate || dueDate || todayKey()).slice(0, 7)
}
