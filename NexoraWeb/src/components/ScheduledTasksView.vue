<template>
    <section class="scheduled-view" aria-label="定时任务">
        <header class="scheduled-head">
            <div>
                <h1>定时任务</h1>
                <p>按北京时间运行提示词，结果保存到知识库并发送通知。</p>
            </div>
            <button class="scheduled-primary" type="button" @click="startCreate">新建任务</button>
        </header>

        <div v-if="error" class="scheduled-error" role="alert">{{ error }}</div>

        <div class="scheduled-layout">
            <aside class="scheduled-list" aria-label="任务列表">
                <div v-if="loading" class="scheduled-empty">正在加载…</div>
                <div v-else-if="tasks.length === 0" class="scheduled-empty">暂无任务。你也可以直接在对话中让 Nexora 创建。</div>

                <button
                    v-for="task in tasks"
                    :key="task.task_id"
                    type="button"
                    class="scheduled-item"
                    :class="{ active: selectedId === task.task_id && !creating }"
                    @click="selectTask(task)"
                >
                    <strong>{{ task.title }}</strong>
                    <span>{{ scheduleLabel(task) }}</span>
                    <small>{{ task.enabled ? `下次 ${formatTime(task.next_run_at)}` : '已暂停' }}</small>
                </button>
            </aside>

            <div class="scheduled-detail">
                <form v-if="creating || editing" class="scheduled-form" @submit.prevent="saveTask">
                    <h2>{{ editing ? '编辑任务' : '新建任务' }}</h2>
                    <label for="scheduled-title">任务标题</label>
                    <input id="scheduled-title" v-model.trim="draft.title" maxlength="120" required placeholder="例如：机器学习论文周报">

                    <label for="scheduled-prompt">每次执行的提示词</label>
                    <textarea id="scheduled-prompt" v-model.trim="draft.prompt" maxlength="12000" required placeholder="告诉 Nexora 到点后要做什么"></textarea>

                    <label>每周执行日</label>
                    <div class="scheduled-weekdays">
                        <button
                            v-for="(name, day) in weekdayNames"
                            :key="day"
                            type="button"
                            :class="{ active: draft.weekdays.includes(day) }"
                            :aria-pressed="draft.weekdays.includes(day)"
                            @click="toggleWeekday(day)"
                        >{{ name }}</button>
                    </div>

                    <label>执行时间（北京时间）</label>
                    <div class="scheduled-time">
                        <input v-model.number="draft.hour" type="number" min="0" max="23" required aria-label="小时">
                        <span>时</span>
                        <input v-model.number="draft.minute" type="number" min="0" max="59" required aria-label="分钟">
                        <span>分</span>
                    </div>

                    <div class="scheduled-actions">
                        <button class="scheduled-primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : editing ? '保存修改' : '创建任务' }}</button>
                        <button class="scheduled-secondary" type="button" @click="cancelEdit">取消</button>
                    </div>
                </form>

                <template v-else-if="selectedTask">
                    <div class="scheduled-detail-head">
                        <div>
                            <h2>{{ selectedTask.title }}</h2>
                            <p>{{ scheduleLabel(selectedTask) }}</p>
                        </div>
                        <span class="scheduled-state" :class="{ paused: !selectedTask.enabled }">{{ selectedTask.enabled ? '运行中' : '已暂停' }}</span>
                    </div>

                    <div class="scheduled-actions">
                        <button class="scheduled-secondary" type="button" @click="startEdit">编辑</button>
                        <button class="scheduled-secondary" type="button" :disabled="saving" @click="toggleEnabled">{{ selectedTask.enabled ? '暂停' : '启用' }}</button>
                        <button class="scheduled-danger" type="button" :disabled="saving" @click="removeTask">删除</button>
                    </div>

                    <div class="scheduled-info">
                        <span>下次执行</span>
                        <strong>{{ selectedTask.enabled ? formatTime(selectedTask.next_run_at) : '已暂停' }}</strong>
                    </div>
                    <div class="scheduled-info">
                        <span>上次状态</span>
                        <strong>{{ statusLabel(selectedTask.last_status) }}</strong>
                    </div>
                    <div v-if="selectedTask.last_error" class="scheduled-error">{{ selectedTask.last_error }}</div>

                    <h3>提示词</h3>
                    <pre class="scheduled-prompt">{{ selectedTask.prompt }}</pre>

                    <h3>执行记录</h3>
                    <div v-if="runsLoading" class="scheduled-empty">正在加载…</div>
                    <div v-else-if="runs.length === 0" class="scheduled-empty">暂无执行记录</div>
                    <div v-for="run in runs" :key="run.run_id" class="scheduled-run">
                        <div>
                            <strong>{{ formatTime(run.scheduled_at) }}</strong>
                            <span>{{ statusLabel(run.status) }}</span>
                        </div>
                        <button v-if="run.knowledge_title" type="button" @click="emit('open-knowledge', run.knowledge_title)">{{ run.knowledge_title }}</button>
                        <p v-if="run.error" class="scheduled-run-error">{{ run.error }}</p>
                    </div>
                </template>

                <div v-else class="scheduled-empty">选择任务查看详情，或创建一个新任务。</div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, reactive, ref, watch } from 'vue'

    import {
        createScheduledTask,
        deleteScheduledTask,
        listScheduledTaskRuns,
        listScheduledTasks,
        updateScheduledTask,
        type ScheduledTask,
        type ScheduledTaskInput,
        type ScheduledTaskRun,
    } from '@/api/scheduled-tasks'
    import { showConfirm } from '@/stores/confirm'
    import { showToast } from '@/stores/notify'

    const props = defineProps<{ open: boolean }>()
    const emit = defineEmits<{ 'open-knowledge': [title: string] }>()
    const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    const tasks = ref<ScheduledTask[]>([])
    const runs = ref<ScheduledTaskRun[]>([])
    const selectedId = ref('')
    const creating = ref(false)
    const editing = ref(false)
    const loading = ref(false)
    const runsLoading = ref(false)
    const saving = ref(false)
    const error = ref('')
    const draft = reactive<ScheduledTaskInput>({ title: '', prompt: '', weekdays: [0], hour: 9, minute: 0 })

    const selectedTask = computed(() => tasks.value.find((task) => task.task_id === selectedId.value) || null)

    function formatTime(timestamp: number): string {
        if (!timestamp) return '暂无'

        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(timestamp * 1000))
    }

    function scheduleLabel(task: ScheduledTask): string {
        const days = task.weekdays.map((day) => weekdayNames[day]).join('、')
        return `${days} ${String(task.hour).padStart(2, '0')}:${String(task.minute).padStart(2, '0')}（北京时间）`
    }

    function statusLabel(status: string): string {
        const names: Record<string, string> = {
            success: '成功',
            failed: '失败',
            running: '执行中',
        }
        return names[status] || '尚未执行'
    }

    async function loadRuns(taskId: string): Promise<void> {
        runsLoading.value = true
        runs.value = []

        try {
            runs.value = await listScheduledTaskRuns(taskId)
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : '加载执行记录失败'
        } finally {
            runsLoading.value = false
        }
    }

    async function loadTasks(): Promise<void> {
        loading.value = true
        error.value = ''

        try {
            tasks.value = await listScheduledTasks()

            if (!tasks.value.some((task) => task.task_id === selectedId.value)) {
                selectedId.value = tasks.value[0]?.task_id || ''
            }

            if (selectedId.value) {
                await loadRuns(selectedId.value)
            }
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : '加载定时任务失败'
        } finally {
            loading.value = false
        }
    }

    function selectTask(task: ScheduledTask): void {
        selectedId.value = task.task_id
        creating.value = false
        editing.value = false
        error.value = ''
        void loadRuns(task.task_id)
    }

    function setDraft(task?: ScheduledTask): void {
        draft.title = task?.title || ''
        draft.prompt = task?.prompt || ''
        draft.weekdays = task ? [...task.weekdays] : [0]
        draft.hour = task?.hour ?? 9
        draft.minute = task?.minute ?? 0
    }

    function startCreate(): void {
        setDraft()
        creating.value = true
        editing.value = false
        error.value = ''
    }

    function startEdit(): void {
        if (!selectedTask.value) return

        setDraft(selectedTask.value)
        editing.value = true
        creating.value = false
        error.value = ''
    }

    function cancelEdit(): void {
        creating.value = false
        editing.value = false
        error.value = ''
    }

    function toggleWeekday(day: number): void {
        draft.weekdays = draft.weekdays.includes(day)
            ? draft.weekdays.filter((value) => value !== day)
            : [...draft.weekdays, day].sort((left, right) => left - right)
    }

    function validateDraft(): void {
        if (!draft.weekdays.length) throw new Error('请至少选择一个执行日')
        if (!Number.isInteger(draft.hour) || draft.hour < 0 || draft.hour > 23) throw new Error('小时必须在 0 到 23 之间')
        if (!Number.isInteger(draft.minute) || draft.minute < 0 || draft.minute > 59) throw new Error('分钟必须在 0 到 59 之间')
    }

    async function saveTask(): Promise<void> {
        try {
            validateDraft()
            saving.value = true

            if (editing.value && selectedTask.value) {
                await updateScheduledTask(selectedTask.value.task_id, { ...draft, weekdays: [...draft.weekdays] })
            } else {
                const created = await createScheduledTask({ ...draft, weekdays: [...draft.weekdays] })
                selectedId.value = created.task_id
            }

            cancelEdit()
            await loadTasks()
            showToast('定时任务已保存', 'success')
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : '保存任务失败'
        } finally {
            saving.value = false
        }
    }

    async function toggleEnabled(): Promise<void> {
        if (!selectedTask.value) return

        try {
            saving.value = true
            await updateScheduledTask(selectedTask.value.task_id, { enabled: !selectedTask.value.enabled })
            await loadTasks()
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : '更新任务失败'
        } finally {
            saving.value = false
        }
    }

    async function removeTask(): Promise<void> {
        if (!selectedTask.value) return

        const task = selectedTask.value
        const confirmed = await showConfirm({
            title: '删除定时任务',
            content: `确定删除「${task.title}」？已生成的知识库报告不会随任务删除。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) return

        try {
            saving.value = true
            await deleteScheduledTask(task.task_id)
            selectedId.value = ''
            await loadTasks()
            showToast('定时任务已删除', 'success')
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : '删除任务失败'
        } finally {
            saving.value = false
        }
    }

    watch(() => props.open, (open) => {
        if (open) void loadTasks()
    }, { immediate: true })
</script>

<style scoped>
    .scheduled-view { height: 100%; overflow: auto; padding: 28px; color: var(--color-text-primary); }
    .scheduled-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
    .scheduled-head h1 { margin: 0 0 6px; font-size: 24px; }
    .scheduled-head p, .scheduled-detail-head p { margin: 0; color: var(--color-text-secondary); font-size: 13px; }
    .scheduled-layout { display: grid; grid-template-columns: minmax(190px, 270px) minmax(0, 1fr); gap: 18px; min-height: 450px; }
    .scheduled-list, .scheduled-detail { border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-bg-elevated); }
    .scheduled-list { padding: 8px; }
    .scheduled-item { display: flex; flex-direction: column; width: 100%; gap: 5px; padding: 12px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .scheduled-item.active, .scheduled-item:hover { background: var(--color-bg-hover); }
    .scheduled-item strong { font-size: 14px; }
    .scheduled-item span, .scheduled-item small { color: var(--color-text-secondary); font-size: 12px; }
    .scheduled-detail { padding: 22px; }
    .scheduled-detail-head { display: flex; justify-content: space-between; gap: 12px; }
    .scheduled-detail h2 { margin: 0 0 7px; font-size: 19px; }
    .scheduled-detail h3 { margin: 22px 0 10px; font-size: 14px; }
    .scheduled-state { align-self: flex-start; font-size: 12px; color: #167b4d; }
    .scheduled-state.paused { color: var(--color-text-secondary); }
    .scheduled-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    .scheduled-actions button, .scheduled-primary { border-radius: 7px; padding: 8px 13px; font: inherit; font-size: 13px; cursor: pointer; }
    .scheduled-primary { border: 1px solid var(--color-text-primary); background: var(--color-text-primary); color: var(--color-bg-page); }
    .scheduled-secondary, .scheduled-danger { border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: inherit; }
    .scheduled-danger { color: #b42318; }
    button:disabled { opacity: .55; cursor: default; }
    .scheduled-info { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--color-border); font-size: 13px; }
    .scheduled-info span, .scheduled-empty { color: var(--color-text-secondary); }
    .scheduled-prompt { overflow-wrap: anywhere; white-space: pre-wrap; font: inherit; font-size: 13px; line-height: 1.6; }
    .scheduled-run { padding: 12px 0; border-top: 1px solid var(--color-border); font-size: 12px; }
    .scheduled-run > div { display: flex; justify-content: space-between; gap: 12px; }
    .scheduled-run button { border: 0; background: transparent; padding: 6px 0 0; color: var(--color-text-primary); text-decoration: underline; cursor: pointer; text-align: left; }
    .scheduled-run-error, .scheduled-error { color: #b42318; font-size: 12px; }
    .scheduled-error { margin: 10px 0; }
    .scheduled-empty { padding: 18px; font-size: 13px; }
    .scheduled-form { display: flex; flex-direction: column; }
    .scheduled-form label { margin: 13px 0 6px; font-size: 13px; font-weight: 600; }
    .scheduled-form input, .scheduled-form textarea { border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-bg-elevated); color: inherit; padding: 9px; font: inherit; font-size: 13px; }
    .scheduled-form textarea { min-height: 150px; resize: vertical; }
    .scheduled-weekdays { display: flex; flex-wrap: wrap; gap: 6px; }
    .scheduled-weekdays button { border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-bg-elevated); color: inherit; padding: 7px 10px; cursor: pointer; }
    .scheduled-weekdays button.active { border-color: var(--color-text-primary); background: var(--color-text-primary); color: var(--color-bg-page); }
    .scheduled-time { display: flex; align-items: center; gap: 8px; }
    .scheduled-time input { width: 70px; }

    @media (max-width: 720px) {
        .scheduled-view { padding: 16px; }
        .scheduled-layout { grid-template-columns: 1fr; }
    }
</style>
