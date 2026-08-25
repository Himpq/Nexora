<!--
    WorkspaceTasksPanel.vue — Workspace 任务面板

    工具栏(计数 + 新建)+ 月历视图(月份导航/跳月/今天定位/42 格日程 ribbon)+
    任务列表行(状态图标/元信息/状态胶囊/快捷操作)。对齐原版 renderWorkspaceTasksPanel。
-->

<template>
    <div class="ws-tasks">
        <div class="ws-tasks-toolbar">
            <div>
                <h2>任务排期</h2>
                <span>{{ tasks.length }} 个任务</span>
            </div>
            <Button variant="secondary" icon="fa-solid fa-plus" @click="actions.editTask(null)">新建任务</Button>
        </div>

        <!-- 月历 -->
        <div class="ws-calendar">
            <div class="ws-calendar-head">
                <button class="ws-calendar-nav" type="button" title="上个月" aria-label="上个月" @click="shiftCurrentMonth(-1)">
                    <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                </button>
                <span class="ws-calendar-title-tools">
                    <!-- 跳月表单:GDDP 统一浮动(不再内嵌推挤月历布局) -->
                    <Popover ref="jumpPopover" placement="bottom">
                        <template #trigger="{ open }">
                            <button
                                class="ws-calendar-title-btn"
                                type="button"
                                :aria-expanded="open"
                                title="跳转月份"
                                aria-label="跳转月份"
                                @click="open ? closeJump() : openJump()"
                            ><strong>{{ monthLabel }}</strong></button>
                        </template>
                        <form class="ws-calendar-jump" @submit.prevent="submitJump" @keydown.esc.prevent="closeJump">
                            <input
                                ref="jumpInputRef"
                                v-model="jumpInput"
                                type="text"
                                placeholder="YYYY-MM"
                                maxlength="7"
                                inputmode="numeric"
                                autocomplete="off"
                                aria-label="跳转月份"
                            >
                            <button type="submit" title="跳转" aria-label="跳转"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
                        </form>
                    </Popover>
                    <button class="ws-calendar-today-btn" type="button" title="定位到今天" aria-label="定位到今天" @click="goToday">
                        <i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>
                    </button>
                </span>
                <button class="ws-calendar-nav" type="button" title="下个月" aria-label="下个月" @click="shiftCurrentMonth(1)">
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>

            <div class="ws-calendar-weekdays">
                <span v-for="day in WEEKDAYS" :key="day">{{ day }}</span>
            </div>

            <div class="ws-calendar-grid">
                <div
                    v-for="cell in calendarCells"
                    :key="cell.dateKey"
                    class="ws-calendar-day"
                    :class="{ 'is-muted': cell.outsideMonth, 'is-today': cell.isToday, 'has-tasks': cell.tasks.length > 0 }"
                    :data-workspace-task-date="cell.dateKey"
                    @dblclick="createTaskOnDate(cell.dateKey)"
                >
                    <div class="ws-calendar-cell-head">
                        <div class="ws-calendar-date">{{ cell.dayNumber }}</div>
                        <span v-if="cell.tasks.length" class="ws-calendar-count">{{ cell.tasks.length }}项</span>
                    </div>
                    <div class="ws-calendar-items">
                        <button
                            v-for="(item, itemIndex) in cell.visibleItems"
                            :key="`${cell.dateKey}:${itemIndex}`"
                            class="ws-calendar-item"
                            :class="[`task-color-${item.color}`, { 'is-ribbon-title': item.showTitle }]"
                            type="button"
                            :title="item.tooltip"
                            :aria-label="item.ariaLabel"
                            @click.stop="editTaskById(item.task)"
                        >
                            <span class="ws-calendar-ribbon" :class="{ 'has-title': item.showTitle }">{{ item.showTitle ? item.title : '' }}</span>
                        </button>
                        <span v-if="cell.hiddenCount" class="ws-calendar-more" :title="`还有 ${cell.hiddenCount} 个日程`">+{{ cell.hiddenCount }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 任务列表 -->
        <div class="ws-task-list">
            <div v-if="!sortedTasks.length" class="ws-empty">暂无任务</div>
            <div
                v-for="task in sortedTasks"
                :key="String(task.task_id || task.title)"
                class="ws-task-row"
                :class="[`is-${normalizeTaskStatus(task.status)}`, { 'is-overdue': isOverdue(task) }]"
            >
                <span class="ws-task-row-icon"><i :class="taskStatusIcon(task.status)" aria-hidden="true"></i></span>
                <span class="ws-task-row-main">
                    <strong>{{ task.title || '未命名任务' }}</strong>
                    <small>{{ rowMeta(task) }}</small>
                </span>
                <span class="ws-task-status-pill" :class="`is-${normalizeTaskStatus(task.status)}`">{{ taskStatusLabel(task.status) }}</span>
                <span class="ws-task-row-actions">
                    <button
                        class="ws-task-icon-btn"
                        type="button"
                        :title="nextStatusTitle(task)"
                        :aria-label="nextStatusTitle(task)"
                        @click="toggleDone(task)"
                    >
                        <i :class="nextStatusIcon(task)" aria-hidden="true"></i>
                    </button>
                    <button class="ws-task-icon-btn" type="button" title="编辑任务" aria-label="编辑任务" @click="actions.editTask(task)">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    </button>
                    <button class="ws-task-icon-btn danger" type="button" title="删除任务" aria-label="删除任务" @click="actions.removeTask(task)">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref } from 'vue'

    import Button from '@/ui/Button.vue'
    import Popover from '@/ui/Popover.vue'

    import { showToast } from '@/stores/notify'

    import type { WorkspaceDetail, WorkspaceTaskEntry } from '@/api/workspaces'

    import {
        defaultCalendarMonth,
        formatDateKey,
        isTaskOnDate,
        isTaskOpen,
        normalizeMonth,
        normalizeMonthInput,
        normalizeTaskColor,
        normalizeTaskStatus,
        shiftMonth,
        sortTasks,
        taskScheduleText,
        taskStatusLabel,
        taskStatusIcon,
        todayKey,
    } from '../workspaceDisplay'
    import { useWorkspaceActions } from '../workspaceContext'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()

    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

    const tasks = computed<WorkspaceTaskEntry[]>(() => Array.isArray(props.workspace.workspace_tasks) ? props.workspace.workspace_tasks : [])

    const sortedTasks = computed(() => sortTasks(tasks.value))

    /** ===== 日历月份状态(空串表示跟随默认月份) ===== */
    const monthValue = ref('')
    const jumpPopover = ref<InstanceType<typeof Popover> | null>(null)
    const jumpInput = ref('')
    const jumpInputRef = ref<HTMLInputElement | null>(null)

    const currentMonth = computed(() => normalizeMonth(monthValue.value) || defaultCalendarMonth(tasks.value))

    const monthLabel = computed(() => {
        const month = currentMonth.value

        return `${month.slice(0, 4)}年${month.slice(5, 7)}月`
    })

    function shiftCurrentMonth(offset: number): void {
        monthValue.value = shiftMonth(currentMonth.value, offset)
    }

    function goToday(): void {
        monthValue.value = todayKey().slice(0, 7)
        closeJump()
    }

    /** 打开跳月浮层:预填当前月份并聚焦全选(对齐原版 focusWorkspaceTaskCalendarMonthInput) */
    async function openJump(): Promise<void> {
        jumpInput.value = currentMonth.value
        jumpPopover.value?.open()

        await nextTick(() => {
            const input = jumpInputRef.value

            if (input) {
                input.focus()
                input.select()
            }
        })
    }

    function closeJump(): void {
        jumpPopover.value?.close()
    }

    async function submitJump(): Promise<void> {
        const parsed = normalizeMonthInput(jumpInput.value)

        if (!parsed) {
            // 无效输入:提示并回焦继续编辑(对齐原版 focusWorkspaceTaskCalendarMonthInput)
            showToast('请输入正确的月份，例如 2026-07', 'warning')

            await nextTick(() => {
                const input = jumpInputRef.value

                if (input) {
                    input.focus()
                    input.select()
                }
            })

            return
        }

        monthValue.value = parsed
        closeJump()
    }

    /** 双击日历格:以该日为开始+截止预填新建任务(对齐原版 taskPanel dblclick) */
    function createTaskOnDate(dateKey: string): void {
        actions.editTask(null, { startDate: dateKey, dueDate: dateKey })
    }

    /** ===== 日历格构建(对齐原版 renderWorkspaceTaskCalendar) ===== */

    interface CalendarItem {
        task: WorkspaceTaskEntry
        color: string
        title: string
        showTitle: boolean
        tooltip: string
        ariaLabel: string
    }

    interface CalendarCell {
        dateKey: string
        dayNumber: number
        outsideMonth: boolean
        isToday: boolean
        tasks: WorkspaceTaskEntry[]
        visibleItems: CalendarItem[]
        hiddenCount: number
    }

    /** 跨天任务的唯一标识(优先 task_id,对齐原版 getWorkspaceTaskCalendarIdentity) */
    function taskIdentity(task: WorkspaceTaskEntry): string {
        const taskId = String(task.task_id || '').trim()

        if (taskId) {
            return taskId
        }

        return [
            String(task.title || '').trim(),
            String(task.start_date || '').trim(),
            String(task.due_date || '').trim(),
        ].join(':')
    }

    const calendarCells = computed<CalendarCell[]>(() => {
        const month = currentMonth.value
        const year = Number(month.slice(0, 4))
        const monthIndex = Number(month.slice(5, 7)) - 1
        const monthStart = new Date(year, monthIndex, 1)
        // 周一为第一列:周日偏移 6 天
        const firstDayOffset = (monthStart.getDay() + 6) % 7
        const gridStart = new Date(year, monthIndex, 1 - firstDayOffset)
        const today = todayKey()
        const cells: CalendarCell[] = []
        const namedRibbons = new Set<string>()

        for (let index = 0; index < 42; index += 1) {
            const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
            const dateKey = formatDateKey(day)
            const dayTasks = sortTasks(tasks.value.filter((task) => isTaskOnDate(task, dateKey)))
            const visible = dayTasks.slice(0, 3)
            const hiddenCount = Math.max(0, dayTasks.length - visible.length)
            const outsideMonth = day.getMonth() !== monthIndex

            const items: CalendarItem[] = visible.map((task) => {
                const startDate = String(task.start_date || '').trim()
                const dueDate = String(task.due_date || '').trim()
                const titleDate = (startDate || dueDate) === dateKey
                const endDate = Boolean(startDate && dueDate && startDate !== dueDate && dueDate === dateKey)
                const identity = taskIdentity(task)
                const isFirstNamed = !titleDate && !endDate && identity !== '' && !namedRibbons.has(identity)
                const showTitle = titleDate || isFirstNamed

                if ((titleDate || isFirstNamed) && identity && !endDate) {
                    namedRibbons.add(identity)
                }

                const title = String(task.title || '未命名任务').trim()
                const tooltip = [title, taskStatusLabel(task.status), taskScheduleText(task)].join(' · ')

                return {
                    task,
                    color: normalizeTaskColor(task.color),
                    title,
                    showTitle,
                    tooltip,
                    ariaLabel: ['编辑日程', title, taskStatusLabel(task.status), taskScheduleText(task)].filter(Boolean).join(':'),
                }
            })

            cells.push({
                dateKey,
                dayNumber: day.getDate(),
                outsideMonth,
                isToday: dateKey === today,
                tasks: dayTasks,
                visibleItems: items,
                hiddenCount,
            })
        }

        return cells
    })

    /** ===== 列表行 ===== */

    function editTaskById(task: WorkspaceTaskEntry): void {
        actions.editTask(task)
    }

    function isOverdue(task: WorkspaceTaskEntry): boolean {
        const dueDate = String(task.due_date || '').trim()

        return isTaskOpen(task) && Boolean(dueDate) && dueDate < todayKey()
    }

    function rowMeta(task: WorkspaceTaskEntry): string {
        const parts = [
            String(task.assignee || '').trim() ? `负责人 ${task.assignee}` : '',
            taskScheduleText(task),
            String(task.source_title || '').trim() ? `来源 ${task.source_title}` : '',
            isOverdue(task) ? '逾期' : '',
        ]

        return parts.filter(Boolean).join(' · ')
    }

    function toggleDone(task: WorkspaceTaskEntry): void {
        const status = normalizeTaskStatus(task.status)
        const next = status === 'done' ? 'todo' : 'done'

        void actions.changeTaskStatus(task, next)
    }

    function nextStatusTitle(task: WorkspaceTaskEntry): string {
        return normalizeTaskStatus(task.status) === 'done' ? '重新设为待办' : '标记完成'
    }

    function nextStatusIcon(task: WorkspaceTaskEntry): string {
        return normalizeTaskStatus(task.status) === 'done' ? 'fa-solid fa-rotate-left' : 'fa-solid fa-check'
    }
</script>

<style scoped>
    .ws-tasks {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding-bottom: 36px;
    }

    /* 空态基础样式来自全局 workspaces.css(.ws-empty),此处不重复 */

    .ws-tasks-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }

    /* ===== 月历 ===== */
    .ws-calendar {
        width: min(100%, 760px);
        margin: 0 auto;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
    }

    .ws-calendar-head {
        height: 38px;
        border-bottom: 1px solid var(--color-border);
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) 36px;
        align-items: center;
    }

    .ws-calendar-title-tools {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }

    .ws-calendar-title-btn {
        border: none;
        background: transparent;
        color: var(--color-text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        min-width: 108px;
        height: 30px;
        border-radius: 6px;
        padding: 0 8px;
    }

    .ws-calendar-title-btn strong {
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 700;
        text-align: center;
    }

    .ws-calendar-today-btn {
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .ws-calendar-title-btn:hover,
    .ws-calendar-today-btn:hover {
        background: var(--color-bg-hover);
    }

    /* 跳月表单(浮动在 ui/Popover 卡片内) */
    .ws-calendar-jump {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 10px;
    }

    .ws-calendar-jump input {
        width: 112px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        outline: none;
    }

    .ws-calendar-jump input:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-calendar-jump button {
        width: 30px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .ws-calendar-jump button:hover {
        border-color: var(--color-border-strong);
        color: var(--color-text-primary);
    }

    .ws-calendar-nav {
        width: 36px;
        height: 38px;
        border: none;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .ws-calendar-nav:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .ws-calendar-weekdays,
    .ws-calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .ws-calendar-weekdays {
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-sunken);
    }

    .ws-calendar-weekdays span {
        height: 26px;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 650;
    }

    .ws-calendar-day {
        min-height: 78px;
        border-right: 1px solid var(--color-border);
        border-bottom: 1px solid var(--color-border);
        padding: 5px;
        overflow: hidden;
        cursor: pointer;
    }

    .ws-calendar-day.has-tasks {
        background: var(--color-bg-elevated);
    }

    .ws-calendar-day:nth-child(7n) {
        border-right: none;
    }

    .ws-calendar-day:nth-last-child(-n + 7) {
        border-bottom: none;
    }

    .ws-calendar-day.is-muted {
        background: var(--color-bg-sunken);
    }

    .ws-calendar-day.is-muted .ws-calendar-date {
        opacity: 0.55;
    }

    .ws-calendar-cell-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
    }

    .ws-calendar-date {
        width: 20px;
        height: 20px;
        border-radius: 999px;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .ws-calendar-day.is-today .ws-calendar-date {
        background: var(--color-text-primary);
        color: var(--color-bg-page);
    }

    .ws-calendar-count {
        color: var(--color-text-secondary);
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
    }

    .ws-calendar-items {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 3px;
    }

    /*
     * 日程条:颜色只由 ribbon 色条承载,按钮本体透明。
     * (旧版给 item 铺 --ribbon-bg 淡色底,min-height 20px > ribbon 8px,
     *  底色从条上下露出,玫瑰色看起来像"红任务带粉色条",已移除。)
     */
    .ws-calendar-item {
        --ribbon-color: var(--color-accent-text);
        width: 100%;
        min-height: 20px;
        border: none;
        border-radius: 5px;
        background: transparent;
        display: grid;
        padding: 0;
        cursor: pointer;
    }

    .ws-calendar-ribbon {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background: var(--ribbon-color);
        display: block;
    }

    .ws-calendar-item.is-ribbon-title {
        min-height: 18px;
    }

    .ws-calendar-ribbon.has-title {
        height: 16px;
        color: #ffffff;
        padding: 1px 6px 0;
        font-size: 10px;
        font-weight: 700;
        line-height: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /*
     * 日程颜色语义(对齐原版 task-color-*;色值与任务编辑弹窗色板一致,
     * 保证"编辑器选的颜色 = 日历看到的颜色")
     */
    .ws-calendar-item.task-color-blue {
        --ribbon-color: var(--color-accent-text);
    }

    .ws-calendar-item.task-color-green {
        --ribbon-color: var(--color-success-text);
    }

    .ws-calendar-item.task-color-amber {
        --ribbon-color: #f59e0b;
    }

    .ws-calendar-item.task-color-rose {
        --ribbon-color: #f43f5e;
    }

    .ws-calendar-item.task-color-violet {
        --ribbon-color: #8b5cf6;
    }

    .ws-calendar-item.task-color-cyan {
        --ribbon-color: #06b6d4;
    }

    .ws-calendar-item.task-color-slate {
        --ribbon-color: var(--color-text-secondary);
    }

    .ws-calendar-more {
        color: var(--color-text-secondary);
        font-size: 11px;
        font-weight: 650;
        padding-left: 4px;
    }

    /* ===== 任务列表 ===== */
    .ws-task-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-task-row {
        min-height: 62px;
        border-radius: 8px;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) 92px 112px;
        align-items: center;
        gap: 12px;
        padding: 9px 10px;
    }

    .ws-task-row:hover {
        background: var(--color-bg-sunken);
    }

    .ws-task-row.is-overdue .ws-task-row-main strong {
        color: var(--color-danger-text);
    }

    .ws-task-row-icon {
        width: 34px;
        height: 34px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    .ws-task-row-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .ws-task-row-main strong {
        min-width: 0;
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-task-row-main small {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-task-status-pill {
        min-width: 76px;
        height: 26px;
        border-radius: 999px;
        background: var(--color-control-track);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
    }

    .ws-task-status-pill.is-doing {
        background: var(--color-accent-text);
        color: #ffffff;
    }

    .ws-task-status-pill.is-blocked {
        background: var(--color-danger-text);
        color: #ffffff;
    }

    .ws-task-status-pill.is-done {
        background: var(--color-success-text);
        color: #ffffff;
    }

    .ws-task-row-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
    }

    .ws-task-icon-btn {
        width: 30px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .ws-task-icon-btn:hover {
        border-color: var(--color-border-strong);
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .ws-task-icon-btn.danger:hover {
        border-color: var(--color-danger-border);
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    @media (max-width: 1180px) {
        .ws-task-row {
            grid-template-columns: 34px minmax(0, 1fr) 92px;
        }

        .ws-task-row-actions {
            grid-column: 2 / -1;
            justify-content: flex-start;
        }
    }

    @media (max-width: 720px) {
        .ws-tasks-toolbar {
            align-items: flex-start;
            flex-direction: column;
        }

        .ws-calendar-weekdays,
        .ws-calendar-grid {
            min-width: 0;
        }

        .ws-calendar-day {
            min-height: 64px;
            padding: 4px;
        }

        .ws-calendar-date {
            width: 18px;
            height: 18px;
            font-size: 11px;
        }

        .ws-calendar-count {
            font-size: 9px;
        }

        .ws-calendar-item {
            min-height: 16px;
            gap: 2px;
        }

        .ws-calendar-more {
            font-size: 10px;
        }

        .ws-task-row {
            grid-template-columns: 30px minmax(0, 1fr);
            gap: 8px 10px;
        }

        .ws-task-status-pill,
        .ws-task-row-actions {
            grid-column: 2;
            justify-content: flex-start;
        }
    }
</style>
