<!--
    WorkspaceOverviewPanel.vue — Workspace 总览面板

    统计卡(资源计数,缺省回落实时计数)+ 待办(未结任务/逾期计数,
    后端未聚合时本地排序截前 8)+ 活动流(后端活动条目优先,
    缺省回落 recent_items 简版行);对齐原版 renderWorkspaceOverviewPanel 的兜底链。
-->

<template>
    <div class="ws-overview">
        <div class="ws-overview-stats">
            <div v-for="stat in statCards" :key="stat.label" class="ws-overview-stat">
                <span class="ws-overview-stat-icon"><i :class="stat.icon" aria-hidden="true"></i></span>
                <span class="ws-overview-stat-main">
                    <span class="ws-overview-stat-value">{{ stat.value }}</span>
                    <span class="ws-overview-stat-label">{{ stat.label }}</span>
                </span>
            </div>
        </div>

        <div class="ws-overview-grid">
            <section class="ws-overview-section">
                <div class="ws-overview-section-head">
                    <h2>待办</h2>
                    <span>{{ overdueTaskCount }} 个逾期</span>
                </div>
                <div v-if="!upcomingTasks.length" class="ws-empty">暂无待办事项</div>
                <div v-for="task in upcomingTasks" :key="taskKey(task)" class="ws-overview-row">
                    <span class="ws-overview-row-icon"><i :class="taskStatusIcon(task.status)" aria-hidden="true"></i></span>
                    <span class="ws-overview-row-main">
                        <span class="ws-overview-row-title">{{ task.title || '未命名任务' }}</span>
                        <span class="ws-overview-row-meta">{{ taskMeta(task) }}</span>
                    </span>
                </div>
            </section>

            <section class="ws-overview-section">
                <div class="ws-overview-section-head">
                    <h2>活动流</h2>
                </div>
                <template v-if="activityItems.length">
                    <div v-for="item in activityItems" :key="`act:${String(item.activity_id || item.time)}`" class="ws-overview-activity-row">
                        <span class="ws-overview-activity-node">
                            <i :class="activityIcon(item)" aria-hidden="true"></i>
                        </span>
                        <div class="ws-overview-activity-card">
                            <div class="ws-overview-activity-line">
                                <span class="ws-overview-activity-action">{{ activityText(item) }}</span>
                                <span v-if="activityTitle(item)" class="ws-overview-activity-target">{{ activityTitle(item) }}</span>
                            </div>
                            <div class="ws-overview-activity-meta">{{ activityMeta(item) }}</div>
                        </div>
                    </div>
                </template>
                <template v-else-if="recentRows.length">
                    <div v-for="(row, index) in recentRows" :key="`recent:${index}`" class="ws-overview-row">
                        <span class="ws-overview-row-icon"><i :class="overviewTypeIcon(row.type)" aria-hidden="true"></i></span>
                        <span class="ws-overview-row-main">
                            <span class="ws-overview-row-title">{{ row.title }}</span>
                            <span class="ws-overview-row-meta">{{ [row.subtitle, row.time].filter(Boolean).join(' · ') }}</span>
                        </span>
                    </div>
                </template>
                <div v-else class="ws-empty">暂无近期动态</div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { WorkspaceActivityItem, WorkspaceDetail, WorkspaceTaskEntry } from '@/api/workspaces'
    import { formatWorkspaceDate } from '@/api/workspaces'

    import {
        activityIcon,
        activityText,
        overviewTypeIcon,
        sortTasks,
        isTaskOpen,
        taskScheduleText,
        taskStatusLabel,
        taskStatusIcon,
    } from '../workspaceDisplay'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const overview = computed(() => props.workspace.overview ?? {})

    const counts = computed(() => overview.value.resource_counts ?? {})

    const conversations = computed(() => Array.isArray(props.workspace.conversations) ? props.workspace.conversations : [])

    const knowledgeDocuments = computed(() => Array.isArray(props.workspace.knowledge_documents) ? props.workspace.knowledge_documents : [])

    const files = computed(() => Array.isArray(props.workspace.workspace_files) ? props.workspace.workspace_files : [])

    const tasks = computed<WorkspaceTaskEntry[]>(() => Array.isArray(props.workspace.workspace_tasks) ? props.workspace.workspace_tasks : [])

    const drafts = computed(() => Array.isArray(props.workspace.workspace_drafts) ? props.workspace.workspace_drafts : [])

    /**
     * 统计卡:后端聚合优先,字段缺省回落各资源数组长度
     * (对齐原版 counts.x || items.length 的兜底顺序)
     */
    const statCards = computed(() => [
        {
            label: '聊天',
            value: Number(counts.value.conversations || conversations.value.length || 0),
            icon: 'fa-regular fa-comments',
        },
        {
            label: '知识库',
            value: Number(counts.value.knowledge_documents || knowledgeDocuments.value.length || 0),
            icon: 'fa-solid fa-database',
        },
        {
            label: '文件',
            value: Number(counts.value.workspace_files || files.value.length || 0),
            icon: 'fa-regular fa-file-lines',
        },
        {
            label: '未完成任务',
            value: Number(overview.value.open_task_count ?? tasks.value.filter(isTaskOpen).length),
            icon: 'fa-regular fa-circle-check',
        },
        {
            label: '草稿',
            value: Number(counts.value.workspace_drafts || drafts.value.length || 0),
            icon: 'fa-regular fa-pen-to-square',
        },
    ])

    const overdueTaskCount = computed(() => Number(overview.value.overdue_task_count ?? 0))

    /** 未结任务:后端 upcoming_tasks 优先;缺省本地排序取未结前 8(对齐原版 fallback 链) */
    const upcomingTasks = computed<WorkspaceTaskEntry[]>(() => {
        const remote = overview.value.upcoming_tasks

        if (Array.isArray(remote)) {
            return remote
        }

        return sortTasks(tasks.value).filter(isTaskOpen).slice(0, 8)
    })

    /** 活动流:后端 activity_items 优先 */
    const activityItems = computed<WorkspaceActivityItem[]>(() => overview.value.activity_items ?? [])

    /** 活动流缺省时的 recent_items 简版行(对齐原版 renderWorkspaceOverviewRows) */
    interface RecentRow {
        title: string
        subtitle: string
        time: string
        type: string
    }

    const recentRows = computed<RecentRow[]>(() => {
        const rows = Array.isArray(overview.value.recent_items) ? overview.value.recent_items as Array<Record<string, unknown>> : []

        return rows.map((item) => ({
            title: String(item.title || '未命名').trim(),
            subtitle: String(item.subtitle || '').trim(),
            time: formatWorkspaceDate(item.time as string | undefined),
            type: String(item.type || '').trim(),
        }))
    })

    function taskKey(task: WorkspaceTaskEntry): string {
        return String(task.task_id || task.title || '')
    }

    /** 待办行元信息:状态 · 负责人 · 排期(对齐原版 metaParts) */
    function taskMeta(task: WorkspaceTaskEntry): string {
        const parts = [
            taskStatusLabel(task.status),
            String(task.assignee || '').trim(),
            taskScheduleText(task),
        ]

        return parts.filter(Boolean).join(' · ')
    }

    /** 活动行元信息:@actor · 时间 */
    function activityMeta(item: WorkspaceActivityItem): string {
        return [item.actor ? `@${item.actor}` : '', formatWorkspaceDate(item.time)].filter(Boolean).join(' · ')
    }

    /**
     * 活动资源标题:后端偶发把原始 epoch(如 1787080769.0539062)塞进 title 字段,
     * 这种纯时间戳对使用者无意义,直接隐藏,避免与 action 文案重复且挤压布局;
     * 仅当 title 含非数字内容(真实资源名)时才展示。
     */
    function activityTitle(item: WorkspaceActivityItem): string {
        const title = String(item.title || '').trim()

        if (!title) {
            return ''
        }

        // 纯数字(含小数点)视为时间戳,不展示
        if (/^[\d.]+$/.test(title)) {
            return ''
        }

        return title
    }
</script>

<style scoped>
    .ws-overview {
        display: flex;
        flex-direction: column;
        gap: 26px;
        padding-bottom: 36px;
    }

    .ws-overview-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
    }

    .ws-overview-stat {
        min-height: 82px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
    }

    .ws-overview-row-icon {
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

    .ws-overview-stat-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-overview-stat-value {
        color: var(--color-text-primary);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.15;
    }

    .ws-overview-stat-label {
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
    }

    .ws-overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 24px;
    }

    .ws-overview-section {
        min-width: 0;
        border-top: 1px solid var(--color-border);
        padding-top: 14px;
    }

    .ws-overview-section-head {
        min-height: 30px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
    }

    .ws-overview-section-head h2 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
    }

    .ws-overview-section-head span {
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
    }

    /* 待办行与活动行共用的行几何 */
    .ws-overview-row {
        min-height: 54px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
    }

    .ws-overview-row:hover {
        background: var(--color-bg-sunken);
    }

    .ws-overview-row-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .ws-overview-row-title {
        min-width: 0;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-overview-row-meta {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /*
     * 活动流:左侧图标节点(竖线时间线连接)+ 右侧信息卡(左右分栏布局)。
     * 信息卡内部分两块:动作行(动作文案 + 资源名)、元信息行(@操作者 · 时间),
     * 与原版 renderWorkspaceOverviewActivityRows 的「动作 + 标题 + 元信息」分块一致。
     */
    .ws-overview-activity-row {
        position: relative;
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
        align-items: stretch;
        gap: 0;
        padding: 4px 0;
    }

    /* 竖线时间线:贯穿图标节点之间,节点底色遮住穿过自身的线段 */
    .ws-overview-activity-row::before {
        content: '';
        position: absolute;
        left: 21px;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--color-border);
    }

    .ws-overview-activity-row:first-child::before {
        top: 22px;
    }

    .ws-overview-activity-row:last-child::before {
        bottom: auto;
        height: 22px;
    }

    /* 左侧图标节点:固定 44px 列宽,竖线从节点中心穿过 */
    .ws-overview-activity-node {
        position: relative;
        z-index: 1;
        width: 44px;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 8px;
    }

    .ws-overview-activity-node i {
        width: 30px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 9px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
    }

    /* 右侧信息卡:统一底色 + 圆角,内部动作行与元信息行分明 */
    .ws-overview-activity-card {
        min-width: 0;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .ws-overview-activity-line {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 8px;
    }

    .ws-overview-activity-action {
        min-width: 0;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
        line-height: 1.4;
    }

    .ws-overview-activity-target {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-overview-activity-meta {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    @media (max-width: 1180px) {
        .ws-overview-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .ws-overview-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    @media (max-width: 720px) {
        .ws-overview-stats {
            grid-template-columns: minmax(0, 1fr);
        }

        .ws-overview-stat {
            min-height: 70px;
            padding: 12px;
        }

        .ws-overview-stat-value {
            font-size: 19px;
        }
    }
</style>
