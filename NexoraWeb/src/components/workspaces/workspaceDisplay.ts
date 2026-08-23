/**
 * workspaceDisplay.ts — Workspaces 展示纯函数集
 *
 * 职责:
 *   - 承接原版 workspace.js 中与渲染相关的无副作用逻辑:
 *     任务状态/颜色枚举、可见性文案、活动流文案与图标映射、日期工具、置顶排序
 *   - 组件与 API 层都不再各自散落这些映射,统一从这里取用
 */

import type { WorkspaceActivityItem, WorkspaceFileEntry, WorkspaceTaskEntry } from '@/api/workspaces'

/** ===== 任务状态 / 颜色(对齐原版 WORKSPACE_TASK_STATUS_OPTIONS 等) ===== */

export interface WorkspaceTaskStatusOption {
    value: string
    label: string
    icon: string
}

export const WORKSPACE_TASK_STATUS_OPTIONS: WorkspaceTaskStatusOption[] = [
    { value: 'todo', label: '待办', icon: 'fa-regular fa-circle' },
    { value: 'doing', label: '进行中', icon: 'fa-solid fa-spinner' },
    { value: 'blocked', label: '阻塞', icon: 'fa-solid fa-triangle-exclamation' },
    { value: 'done', label: '完成', icon: 'fa-regular fa-circle-check' },
    { value: 'cancelled', label: '取消', icon: 'fa-regular fa-circle-xmark' },
]

const TASK_STATUS_VALUES = new Set<string>(WORKSPACE_TASK_STATUS_OPTIONS.map((item) => item.value))

export const WORKSPACE_TASK_COLOR_OPTIONS = [
    { value: 'blue', label: '蓝色' },
    { value: 'green', label: '绿色' },
    { value: 'amber', label: '琥珀' },
    { value: 'rose', label: '玫瑰' },
    { value: 'violet', label: '紫色' },
    { value: 'cyan', label: '青色' },
    { value: 'slate', label: '灰色' },
] as const

const TASK_COLOR_VALUES = new Set<string>(WORKSPACE_TASK_COLOR_OPTIONS.map((item) => item.value))

/** 归一化任务状态(非法值回落 todo,对齐原版 normalizeWorkspaceTaskStatus) */
export function normalizeTaskStatus(value: unknown): string {
    const status = String(value || 'todo').trim().toLowerCase()

    return TASK_STATUS_VALUES.has(status) ? status : 'todo'
}

/** 归一化任务颜色(对齐原版 normalizeWorkspaceTaskColor) */
export function normalizeTaskColor(value: unknown): string {
    const color = String(value || 'blue').trim().toLowerCase()

    return TASK_COLOR_VALUES.has(color) ? color : 'blue'
}

export function taskStatusLabel(status: unknown): string {
    const safe = normalizeTaskStatus(status)

    return WORKSPACE_TASK_STATUS_OPTIONS.find((item) => item.value === safe)?.label || '待办'
}

export function taskStatusIcon(status: unknown): string {
    const safe = normalizeTaskStatus(status)

    return WORKSPACE_TASK_STATUS_OPTIONS.find((item) => item.value === safe)?.icon || 'fa-regular fa-circle'
}

/** 任务是否未结(todo/doing/blocked 视为未结,对齐原版 isWorkspaceTaskOpen) */
export function isTaskOpen(task: WorkspaceTaskEntry): boolean {
    const status = normalizeTaskStatus(task.status)

    return status !== 'done' && status !== 'cancelled'
}

/** ===== 可见性(对齐原版 normalizeWorkspaceVisibility / getWorkspaceVisibilityLabel) ===== */

export function normalizeVisibility(value: unknown): string {
    const visibility = String(value || 'private').trim().toLowerCase()

    return visibility === 'share' ? 'share' : 'private'
}

export function visibilityLabel(value: unknown): string {
    return normalizeVisibility(value) === 'share' ? '共享' : '私有'
}

/** ===== 活动流(对齐原版 getWorkspaceActivityText / getWorkspaceActivityIcon / overview icons) ===== */

function taskStatusText(status: string): string {
    if (!status) {
        return ''
    }

    return taskStatusLabel(status)
}

/** 活动条目主文案(对齐原版 getWorkspaceActivityText 的 action → 文案映射) */
export function activityText(item: WorkspaceActivityItem): string {
    const action = String(item.action || '').trim()
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    const targetUser = String(metadata.target_user || '').trim()
    const status = String(metadata.status || '').trim()
    const previousStatus = String(metadata.previous_status || '').trim()

    const texts: Record<string, string> = {
        workspace_created: '创建了 Workspace',
        workspace_renamed: '重命名了 Workspace',
        workspace_shared: targetUser ? `分享给 ${targetUser}` : '分享了 Workspace',
        workspace_unshared: targetUser ? `移除 ${targetUser}` : '移除了共享用户',
        workspace_prompt_updated: '更新了 Workspace Prompt',
        workspace_memory_updated: '沉淀了 Workspace 记忆',
        conversation_added: '添加了对话',
        conversation_shared: '共享了对话',
        conversation_private: '取消共享对话',
        knowledge_added: '添加了知识库',
        knowledge_shared: '共享了知识库',
        knowledge_private: '取消共享知识库',
        file_added: '添加了文件',
        file_shared: '共享了文件',
        file_private: '取消共享文件',
        task_created: '创建了任务',
        task_deleted: '删除了任务',
        task_updated: '更新了任务',
    }

    if (texts[action]) {
        return texts[action]
    }

    if (action === 'task_status_updated') {
        const nextText = taskStatusText(status)
        const previousText = taskStatusText(previousStatus)

        if (previousText && nextText && previousText !== nextText) {
            return `任务状态由 ${previousText} 改为 ${nextText}`
        }

        return nextText ? `任务状态改为 ${nextText}` : '更新了任务状态'
    }

    return String(item.subtitle || '更新了 Workspace').trim()
}

/** 总览资源类型图标(对齐原版 getWorkspaceOverviewIcon) */
export function overviewTypeIcon(type: unknown): string {
    const normalized = String(type || '').trim()

    if (normalized === 'task') {
        return 'fa-regular fa-circle-check'
    }

    if (normalized === 'conversation') {
        return 'fa-regular fa-comments'
    }

    if (normalized === 'knowledge') {
        return 'fa-solid fa-database'
    }

    if (normalized === 'file') {
        return 'fa-regular fa-file-lines'
    }

    return 'fa-regular fa-folder'
}

/** 活动条目图标(action 关键词优先于资源类型,对齐原版 getWorkspaceActivityIcon) */
export function activityIcon(item: WorkspaceActivityItem): string {
    const name = String(item.action || '').trim()
    const type = String(item.resource_type || '').trim()

    if (name.includes('shared')) {
        return 'fa-solid fa-share-nodes'
    }

    if (name.includes('memory')) {
        return 'fa-solid fa-brain'
    }

    if (name.includes('prompt')) {
        return 'fa-solid fa-sliders'
    }

    if (name.includes('deleted') || name.includes('unshared')) {
        return 'fa-regular fa-circle-xmark'
    }

    if (type === 'task') {
        return 'fa-regular fa-circle-check'
    }

    return overviewTypeIcon(type)
}

/** ===== 日期工具(对齐原版 formatWorkspaceTaskDateKey 系列函数) ===== */

/** 本地时区 YYYY-MM-DD 键 */
export function formatDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${date.getFullYear()}-${month}-${day}`
}

export function todayKey(): string {
    return formatDateKey(new Date())
}

/** 解析 YYYY-MM-DD;格式或真实日期不合法返回 null(对齐原版 parseWorkspaceTaskDate) */
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

export function isValidDateKey(value: unknown): boolean {
    const text = String(value || '').trim()

    return !text || parseDateKey(text) !== null
}

/** MM-DD 短标签(对齐原版 formatWorkspaceTaskDateLabel) */
export function formatDateLabel(value: unknown): string {
    const date = parseDateKey(value)

    if (!date) {
        return String(value || '').trim()
    }

    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${month}-${day}`
}

/** 任务排期描述(对齐原版 formatWorkspaceTaskSchedule) */
export function taskScheduleText(task: Pick<WorkspaceTaskEntry, 'start_date' | 'due_date'>): string {
    const startDate = String(task.start_date || '').trim()
    const dueDate = String(task.due_date || '').trim()

    if (startDate && dueDate && startDate !== dueDate) {
        return `${formatDateLabel(startDate)} 至 ${formatDateLabel(dueDate)}`
    }

    if (dueDate) {
        return `截止 ${formatDateLabel(dueDate)}`
    }

    if (startDate) {
        return `开始 ${formatDateLabel(startDate)}`
    }

    return '未排期'
}

/** 任务落在某日的键(截止优先,对齐原版 getWorkspaceTaskDateKey) */
export function taskDateKey(task: Pick<WorkspaceTaskEntry, 'start_date' | 'due_date'>): string {
    const dueDate = String(task.due_date || '').trim()

    return dueDate || String(task.start_date || '').trim()
}

/** 任务是否覆盖某日(区间/单日,对齐原版 isWorkspaceTaskOnDate) */
export function isTaskOnDate(task: WorkspaceTaskEntry, dateKey: string): boolean {
    const startDate = String(task.start_date || '').trim()
    const dueDate = String(task.due_date || '').trim()

    if (startDate && dueDate) {
        return dateKey >= startDate && dateKey <= dueDate
    }

    if (dueDate) {
        return dateKey === dueDate
    }

    if (startDate) {
        return dateKey === startDate
    }

    return false
}

/** YYYY-MM 归一化(非法返回空串,对齐原版 normalizeWorkspaceTaskMonth) */
export function normalizeMonth(value: unknown): string {
    const text = String(value || '').trim()

    if (!/^\d{4}-\d{2}$/.test(text)) {
        return ''
    }

    const month = Number(text.slice(5, 7))

    return month >= 1 && month <= 12 ? text : ''
}

/** 月输入宽容解析(支持 202503 / 2025-3 / 2025年3月 等,对齐原版 normalizeWorkspaceTaskMonthInput) */
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

/** 月份平移(对齐原版 shiftWorkspaceTaskCalendarMonth) */
export function shiftMonth(monthValue: string, offset: number): string {
    const month = normalizeMonth(monthValue) || todayKey().slice(0, 7)
    const year = Number(month.slice(0, 4))
    const monthIndex = Number(month.slice(5, 7)) - 1
    const date = new Date(year, monthIndex + offset, 1)

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 默认日历月份:最近的含任务月份,否则当月(对齐原版 getWorkspaceDefaultTaskCalendarMonth) */
export function defaultCalendarMonth(tasks: WorkspaceTaskEntry[]): string {
    const today = todayKey()
    const datedTasks = tasks
        .map((task) => taskDateKey(task))
        .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
        .sort()
    const nearestDate = datedTasks.find((dateKey) => dateKey >= today) || datedTasks[0] || today

    return nearestDate.slice(0, 7)
}

/** 日期范围选择器初始月份(对齐原版 getWorkspaceTaskDateRangeMonth) */
export function dateRangeMonth(startDate = '', dueDate = ''): string {
    return (startDate || dueDate || todayKey()).slice(0, 7)
}

/** 时间范围触发器两行文案(对齐原版 formatWorkspaceTaskDateRangeLabel + meta 行) */
export function dateRangeLabel(startDate: string, dueDate: string): { main: string; meta: string } {
    const start = String(startDate || '').trim()
    const due = String(dueDate || '').trim()

    if (start && due && start !== due) {
        return { main: `${formatDateLabel(start)} 至 ${formatDateLabel(due)}`, meta: `开始 ${start} · 截止 ${due}` }
    }

    if (start && due) {
        return { main: formatDateLabel(start), meta: `开始 ${start} · 截止 ${due}` }
    }

    if (start) {
        return { main: `开始 ${formatDateLabel(start)}`, meta: `开始 ${start}` }
    }

    if (due) {
        return { main: `截止 ${formatDateLabel(due)}`, meta: `截止 ${due}` }
    }

    return { main: '未排期', meta: '开始 - · 截止 -' }
}

/** ===== 排序(对齐原版 sortWorkspacePinnedItems / sortWorkspaceTasks) ===== */

/** 置顶优先,组内保持原顺序(稳定排序) */
export function sortPinnedFirst<T>(items: T[], isPinned: (item: T) => boolean): T[] {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const aPinned = isPinned(a.item)
            const bPinned = isPinned(b.item)

            if (aPinned !== bPinned) {
                return aPinned ? -1 : 1
            }

            return a.index - b.index
        })
        .map((entry) => entry.item)
}

/** 任务排序:有日期在前按日期升序,无日期在后按创建时间倒序(对齐原版 sortWorkspaceTasks) */
export function sortTasks(tasks: WorkspaceTaskEntry[]): WorkspaceTaskEntry[] {
    return tasks
        .map((task, index) => ({ task, index }))
        .sort((a, b) => {
            const aDate = taskDateKey(a.task)
            const bDate = taskDateKey(b.task)

            if (!!aDate !== !!bDate) {
                return aDate ? -1 : 1
            }

            if (aDate && bDate && aDate !== bDate) {
                return aDate < bDate ? -1 : 1
            }

            return String(b.task.created_at || '').localeCompare(String(a.task.created_at || ''))
        })
        .map((entry) => entry.task)
}

/** ===== 文件卡辅助(对齐原版 getWorkspaceFileTypeText) ===== */

/** 文件类型短标(取扩展名大写,无扩展名 FILE) */
export function fileTypeText(file: WorkspaceFileEntry): string {
    const candidates = [file.title, file.original_name, file.alias, file.file_ref]

    for (const candidate of candidates) {
        const name = String(candidate || '').trim()
        const match = name.match(/\.([^.]+)$/)

        if (match) {
            return match[1].toUpperCase()
        }
    }

    return 'FILE'
}
