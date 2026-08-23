<!--
    WorkspaceOverviewPanel.vue — Workspace 总览面板

    统计卡(资源计数)+ 待办(未结任务/逾期计数)+ 活动流(图标 + 行动文案 + 资源标题 + @actor · 时间,
    带时间线连接线;对齐原版 renderWorkspaceOverviewActivityRows / renderWorkspaceOverviewTaskRows)。
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
                <div v-if="!activityItems.length" class="ws-empty">暂无近期动态</div>
                <div v-for="item in activityItems" :key="String(item.activity_id || item.time)" class="ws-overview-activity-row">
                    <span class="ws-overview-row-icon ws-overview-activity-icon"><i :class="activityIcon(item)" aria-hidden="true"></i></span>
                    <span class="ws-overview-row-main">
                        <span class="ws-overview-row-title">{{ activityText(item) }}</span>
                        <span class="ws-overview-row-meta">{{ item.title }}</span>
                        <span class="ws-overview-row-meta">{{ activityMeta(item) }}</span>
                    </span>
                </div>
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
        taskScheduleText,
        taskStatusLabel,
        taskStatusIcon,
    } from '../workspaceDisplay'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const overview = computed(() => props.workspace.overview ?? {})

    const counts = computed(() => overview.value.resource_counts ?? {})

    /** 统计卡:计数取总览聚合,与原版 renderWorkspaceOverviewPanel 一致 */
    const statCards = computed(() => [
        { label: '聊天', value: Number(counts.value.conversations ?? 0), icon: 'fa-regular fa-comments' },
        { label: '知识库', value: Number(counts.value.knowledge_documents ?? 0), icon: 'fa-solid fa-database' },
        { label: '文件', value: Number(counts.value.workspace_files ?? 0), icon: 'fa-regular fa-file-lines' },
        { label: '未完成任务', value: Number(overview.value.open_task_count ?? 0), icon: 'fa-regular fa-circle-check' },
    ])

    const overdueTaskCount = computed(() => Number(overview.value.overdue_task_count ?? 0))

    /** 未结任务(后端 upcoming_tasks 已按日期排序截前 8) */
    const upcomingTasks = computed<WorkspaceTaskEntry[]>(() => overview.value.upcoming_tasks ?? [])

    const activityItems = computed<WorkspaceActivityItem[]>(() => overview.value.activity_items ?? [])

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
     * 活动流时间线:图标块之间以竖线相连(对齐原版 ::before 连接线),
     * 图标块自带底色遮住穿过自身的线段。
     */
    .ws-overview-activity-row {
        position: relative;
        align-items: flex-start;
    }

    .ws-overview-activity-row::before {
        content: '';
        position: absolute;
        left: 26px;
        top: 44px;
        bottom: -10px;
        width: 1px;
        background: var(--color-border);
    }

    .ws-overview-activity-row:last-child::before {
        display: none;
    }

    .ws-overview-activity-icon {
        position: relative;
        z-index: 1;
        background: var(--color-bg-elevated);
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
