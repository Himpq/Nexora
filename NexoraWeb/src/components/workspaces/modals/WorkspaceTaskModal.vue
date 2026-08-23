<!--
    WorkspaceTaskModal.vue — 任务新建/编辑弹窗

    标题 / 状态五选项 / 颜色七选项 / 负责人 / 时间范围(浮动日历选择器:
    开始-截止双模式接续选择,起始晚于截止自动清空截止)/ 备注。
    提交校验对齐原版 submitWorkspaceTaskModal;载荷组装对齐 getWorkspaceTaskModalPayload。
-->

<template>
    <Modal :open="open" :title="isEdit ? '编辑任务' : '新建任务'" size="default" @close="emit('close')">
        <div class="ws-task-form">
            <label class="ws-task-field" for="workspaceTaskTitleInput">
                <span>标题</span>
                <input id="workspaceTaskTitleInput" v-model="title" class="ws-task-input" type="text" maxlength="160" autocomplete="off">
            </label>

            <div class="ws-task-field">
                <span>状态</span>
                <div class="ws-task-status-options" role="group" aria-label="任务状态">
                    <button
                        v-for="option in WORKSPACE_TASK_STATUS_OPTIONS"
                        :key="option.value"
                        class="ws-task-status-option"
                        :class="{ active: status === option.value }"
                        type="button"
                        :aria-pressed="status === option.value"
                        @click="status = option.value"
                    >
                        <i :class="option.icon" aria-hidden="true"></i>
                        <span>{{ option.label }}</span>
                    </button>
                </div>
            </div>

            <div class="ws-task-field">
                <span>颜色</span>
                <div class="ws-task-color-options" role="group" aria-label="任务颜色">
                    <button
                        v-for="option in WORKSPACE_TASK_COLOR_OPTIONS"
                        :key="option.value"
                        class="ws-task-color-option"
                        :class="[`task-color-${option.value}`, { active: color === option.value }]"
                        type="button"
                        :title="option.label"
                        :aria-label="option.label"
                        :aria-pressed="color === option.value"
                        @click="color = option.value"
                    >
                        <span aria-hidden="true"></span>
                    </button>
                </div>
            </div>

            <label class="ws-task-field" for="workspaceTaskAssigneeInput">
                <span>负责人</span>
                <input id="workspaceTaskAssigneeInput" v-model="assignee" class="ws-task-input" type="text" maxlength="128" autocomplete="off">
            </label>

            <!-- 时间范围:GDDP 统一浮动日历(Popover + DatePicker) -->
            <div class="ws-task-field">
                <span>时间范围</span>
                <Popover ref="rangePopover" placement="bottom">
                    <template #trigger="{ open, toggle }">
                        <button
                            class="ws-task-range-trigger"
                            type="button"
                            :aria-expanded="open"
                            @click="toggle()"
                        >
                            <span class="ws-task-range-copy">
                                <span class="ws-task-range-main">{{ rangeLabel.main }}</span>
                                <span class="ws-task-range-meta">{{ rangeLabel.meta }}</span>
                            </span>
                            <i class="fa-regular fa-calendar-days" aria-hidden="true"></i>
                        </button>
                    </template>
                    <DatePicker
                        :start="startDate"
                        :due="dueDate"
                        @change="applyRange"
                        @done="closeRangePicker"
                    />
                </Popover>
            </div>

            <label class="ws-task-field" for="workspaceTaskNotesInput">
                <span>备注</span>
                <textarea id="workspaceTaskNotesInput" v-model="notes" class="ws-task-input ws-task-notes" maxlength="1000"></textarea>
            </label>
        </div>

        <template #footer>
            <Button variant="quiet" :disabled="saving" @click="emit('close')">取消</Button>
            <Button variant="primary" :disabled="saving" @click="submit">{{ saving ? '保存中...' : '保存' }}</Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import type { WorkspaceTaskEntry, WorkspaceTaskPayload } from '@/api/workspaces'

    import { showToast } from '@/stores/notify'

    import Button from '@/ui/Button.vue'
    import DatePicker from '@/ui/DatePicker.vue'
    import Modal from '@/ui/Modal.vue'
    import Popover from '@/ui/Popover.vue'
    import {
        WORKSPACE_TASK_COLOR_OPTIONS,
        WORKSPACE_TASK_STATUS_OPTIONS,
        dateRangeLabel,
        isValidDateKey,
        normalizeTaskColor,
        normalizeTaskStatus,
    } from '../workspaceDisplay'

    const props = defineProps<{
        open: boolean
        /** 编辑目标;null 为新建 */
        task: WorkspaceTaskEntry | null
        /** 新建时的日期预设(日历格点入) */
        draftDate?: string
        defaultAssignee: string
        /** 保存请求进行中(由根组件持有) */
        saving: boolean
    }>()

    const emit = defineEmits<{
        close: []
        submit: [payload: WorkspaceTaskPayload]
    }>()

    const isEdit = computed(() => props.task !== null)

    // ===== 表单状态 =====
    const title = ref('')
    const status = ref('todo')
    const color = ref('blue')
    const assignee = ref('')
    const startDate = ref('')
    const dueDate = ref('')
    const notes = ref('')

    // ===== 时间范围浮动日历 =====
    const rangePopover = ref<InstanceType<typeof Popover> | null>(null)

    const rangeLabel = computed(() => dateRangeLabel(startDate.value, dueDate.value))

    function applyRange(range: { start: string; due: string }): void {
        startDate.value = range.start
        dueDate.value = range.due
    }

    function closeRangePicker(): void {
        rangePopover.value?.close()
    }

    /** 打开时按目标任务/预设初始化表单(对齐原版 openWorkspaceTaskModal) */
    watch(
        () => props.open,
        (opened) => {
            if (!opened) {
                return
            }

            const source = props.task
            const presetStart = source ? String(source.start_date || '').trim() : String(props.draftDate || '').trim()
            const presetDue = source ? String(source.due_date || '').trim() : String(props.draftDate || '').trim()

            title.value = source ? String(source.title || '') : ''
            status.value = normalizeTaskStatus(source?.status ?? 'todo')
            color.value = normalizeTaskColor(source?.color ?? 'blue')
            assignee.value = source ? String(source.assignee || '') : props.defaultAssignee
            notes.value = source ? String(source.notes || '') : ''

            startDate.value = presetStart
            dueDate.value = presetDue
        },
        { immediate: true }
    )

    /** 提交(校验对齐原版):标题/负责人必填,日期格式合法且截止不早于开始 */
    function submit(): void {
        const payloadTitle = title.value.trim()
        const payloadAssignee = assignee.value.trim()

        if (!payloadTitle) {
            showToast('任务标题不能为空')

            return
        }

        if (!payloadAssignee) {
            showToast('负责人不能为空')

            return
        }

        if (!isValidDateKey(startDate.value)) {
            showToast('开始日期必须使用 YYYY-MM-DD')

            return
        }

        if (!isValidDateKey(dueDate.value)) {
            showToast('截止日期必须使用 YYYY-MM-DD')

            return
        }

        if (startDate.value && dueDate.value && dueDate.value < startDate.value) {
            showToast('截止日期不能早于开始日期')

            return
        }

        emit('submit', {
            title: payloadTitle,
            status: status.value,
            color: color.value,
            assignee: payloadAssignee,
            start_date: startDate.value,
            due_date: dueDate.value,
            source_type: isEdit.value ? String(props.task?.source_type || 'manual') : 'manual',
            source_title: isEdit.value ? String(props.task?.source_title || '') : '',
            source_ref: isEdit.value ? String(props.task?.source_ref || '') : '',
            notes: notes.value.trim(),
        })
    }
</script>

<style scoped>
    .ws-task-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .ws-task-field {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }

    .ws-task-field > span {
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 650;
    }

    .ws-task-input {
        width: 100%;
        height: 38px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        padding: 0 12px;
        box-sizing: border-box;
        font: inherit;
        font-size: 13px;
        outline: none;
    }

    .ws-task-input:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-task-notes {
        min-height: 92px;
        height: auto;
        padding: 10px 12px;
        resize: vertical;
        line-height: 1.5;
    }

    /* 状态选项 */
    .ws-task-status-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .ws-task-status-option {
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 10px;
        font: inherit;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
    }

    .ws-task-status-option:hover {
        border-color: var(--color-border-strong);
        color: var(--color-text-primary);
    }

    .ws-task-status-option.active {
        border-color: var(--color-text-primary);
        background: var(--color-text-primary);
        color: var(--color-bg-page);
    }

    /* 颜色选项 */
    .ws-task-color-options {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .ws-task-color-option {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .ws-task-color-option:hover {
        border-color: var(--color-border-strong);
    }

    .ws-task-color-option span {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
    }

    .ws-task-color-option.task-color-blue {
        color: #3b82f6;
    }

    .ws-task-color-option.task-color-green {
        color: #22c55e;
    }

    .ws-task-color-option.task-color-amber {
        color: #f59e0b;
    }

    .ws-task-color-option.task-color-rose {
        color: #f43f5e;
    }

    .ws-task-color-option.task-color-violet {
        color: #8b5cf6;
    }

    .ws-task-color-option.task-color-cyan {
        color: #06b6d4;
    }

    .ws-task-color-option.task-color-slate {
        color: var(--color-text-secondary);
    }

    .ws-task-color-option.active {
        border-color: var(--color-text-primary);
        box-shadow: 0 0 0 3px var(--color-bg-hover);
    }

    /* 时间范围触发器(日历本体在 ui/DatePicker 浮层内) */
    .ws-task-range-trigger {
        width: 100%;
        min-height: 48px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        display: grid;
        grid-template-columns: minmax(0, 1fr) 24px;
        align-items: center;
        gap: 10px;
        padding: 8px 11px;
        font: inherit;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
    }

    .ws-task-range-trigger:hover {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
    }

    .ws-task-range-copy {
        min-width: 0;
        display: grid;
        gap: 2px;
    }

    .ws-task-range-main {
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 650;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-task-range-meta {
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-task-range-trigger i {
        color: var(--color-text-secondary);
        justify-self: center;
    }
</style>
