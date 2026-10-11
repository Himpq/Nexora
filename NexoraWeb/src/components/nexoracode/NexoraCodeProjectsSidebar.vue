<template>
    <section
        class="nexoracode-sidebar-section"
        :class="{ 'is-collapsed': projectsCollapsed }"
        aria-label="Projects"
    >
        <div class="nexoracode-sidebar-projects-subtitle">
            <button
                type="button"
                class="nexoracode-sidebar-projects-main"
                :aria-expanded="!projectsCollapsed"
                @click="toggleProjectsSection"
            >
                <span class="nexoracode-sidebar-projects-title">Projects</span>
            </button>
            <span class="nexoracode-sidebar-actions">
                <button
                    type="button"
                    class="nexoracode-sidebar-icon-btn"
                    title="添加项目文件夹"
                    aria-label="添加项目文件夹"
                    :disabled="selectingProject"
                    @click="handleAddProject"
                >
                    <i class="fa-solid fa-folder-plus" aria-hidden="true"></i>
                </button>
                <button
                    type="button"
                    class="nexoracode-sidebar-icon-btn nexoracode-sidebar-caret-btn"
                    title="展开 / 折叠项目"
                    aria-label="展开 / 折叠项目"
                    :aria-expanded="!projectsCollapsed"
                    @click="toggleProjectsSection"
                >
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
            </span>
        </div>

        <div class="nexoracode-sidebar-project-list">
            <div class="nexoracode-sidebar-project-list-inner">
                <div v-if="!projectGroups.length" class="nexoracode-sidebar-project-empty">
                    暂无项目。选择文件夹开始项目会话。
                </div>

                <section
                    v-for="group in projectGroups"
                    :key="group.project.project_id"
                    class="nexoracode-sidebar-project"
                    :class="{ 'is-collapsed': isProjectCollapsed(group) }"
                >
                    <div
                        class="nexoracode-sidebar-project-row"
                        @click="toggleProject(group)"
                    >
                        <button
                            type="button"
                            class="nexoracode-sidebar-project-main"
                            :title="group.project.path || group.project.name"
                            :aria-expanded="!isProjectCollapsed(group)"
                        >
                            <i class="fa-solid fa-folder nexoracode-sidebar-project-icon" aria-hidden="true"></i>
                            <span class="nexoracode-sidebar-project-name">{{ group.project.name }}</span>
                            <span v-if="group.rows.length" class="nexoracode-sidebar-project-count">
                                {{ group.rows.length }}
                            </span>
                        </button>
                        <span class="nexoracode-sidebar-actions">
                            <button
                                type="button"
                                class="nexoracode-sidebar-icon-btn"
                                title="在此项目新建会话"
                                aria-label="在此项目新建会话"
                                @click.stop="handleNewProjectConversation(group.project)"
                            >
                                <i class="fa-solid fa-message" aria-hidden="true"></i>
                            </button>
                            <button
                                type="button"
                                class="nexoracode-sidebar-icon-btn nexoracode-sidebar-caret-btn"
                                title="展开 / 折叠项目会话"
                                aria-label="展开 / 折叠项目会话"
                                :aria-expanded="!isProjectCollapsed(group)"
                                @click.stop="toggleProject(group)"
                            >
                                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                            </button>
                        </span>
                    </div>

                    <div class="nexoracode-sidebar-project-conversations">
                        <div class="nexoracode-sidebar-project-conversations-inner">
                            <ConversationSidebarItem
                                v-for="row in visibleRows(group)"
                                :key="row.conversation.id"
                                :conversation="row.conversation"
                                :depth="row.depth"
                                :orphan="row.orphan"
                                :active="row.conversation.id === currentId"
                                :streaming="store.isConversationGenerating(row.conversation.id)"
                                :unread="store.unreadConversations.includes(row.conversation.id)"
                                project-item
                                @open="emit('open-conversation', row.conversation.id)"
                                @delete="emit('delete-conversation', row.conversation)"
                                @contextmenu="emit('context-menu', $event, row.conversation)"
                            />

                            <button
                                v-if="hasHiddenRows(group)"
                                type="button"
                                class="nexoracode-sidebar-project-more"
                                :aria-label="`展开 ${group.project.name} 的更多会话`"
                                @click="revealMore(group)"
                            >
                                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                <span>展开更多（剩余 {{ hiddenRowCount(group) }} 条）</span>
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { ConversationSummary } from '@/api/conversations'
    import type { ConversationBranchRow } from '@/stores/conversation'
    import {
        selectLocalProjectFolder,
        type NexoraCodeProject,
    } from '@/api/nexoracodeLocal'
    import { showError } from '@/stores/notify'
    import { useConversationStore } from '@/stores/conversation'
    import {
        fetchSidebarCollapseState,
        loadSidebarCollapseState,
        resolveProjectCollapsed,
        saveSidebarCollapseState,
    } from '@/composables/useSidebarCollapseState'
    import ConversationSidebarItem from '@/components/ConversationSidebarItem.vue'
    import {
        groupNexoraCodeProjectRows,
        resolveVisibleRowLimit,
        sliceVisibleRows,
        type NexoraCodeProjectConversationGroup,
    } from './projectConversations'
    import '@/styles/nexoracode-project-sidebar.css'

    const props = defineProps<{
        rows: ConversationBranchRow[]
        currentId: string
    }>()

    const emit = defineEmits<{
        'open-chat': []
        'new-project-chat': [project: NexoraCodeProject]
        'open-conversation': [conversationId: string]
        'delete-conversation': [conversation: ConversationSummary]
        'context-menu': [event: MouseEvent, conversation: ConversationSummary]
    }>()

    const store = useConversationStore()
    const storedCollapse = loadSidebarCollapseState()
    const projectsCollapsed = ref(storedCollapse.projects)
    const selectingProject = ref(false)
    const collapseOverrides = ref(new Map<string, boolean>(
        Object.entries(storedCollapse.projectOverrides),
    ))
    const projectGroups = computed(() => groupNexoraCodeProjectRows(props.rows))
    /** 各项目已点「展开更多」的次数(未记录时视为 0,即默认只显示最新 5 条) */
    const expandedSteps = ref(new Map<string, number>())

    /** 折叠状态写入后端(权威)+ localStorage 缓存,下次打开侧边栏时自动恢复 */
    function persistCollapseState(): void {
        saveSidebarCollapseState({
            projects: projectsCollapsed.value,
            projectOverrides: Object.fromEntries(collapseOverrides.value),
        })
    }

    /**
     * 挂载后拉取后端权威状态并应用。
     *
     * 组件挂载时先用 localStorage 缓存渲染(同步,避免闪默认态),这里再异步覆盖:
     * 桌面端每次启动端口都变,localStorage 跨启动读不到,后端才是可靠来源。
     * 用户已在本会话内手动操作过(状态被改动)时不覆盖,避免异步结果回退用户操作。
     */
    let collapseTouched = false

    onMounted(async () => {
        const state = await fetchSidebarCollapseState()

        if (collapseTouched) {
            return
        }

        projectsCollapsed.value = state.projects
        collapseOverrides.value = new Map(Object.entries(state.projectOverrides))
    })

    function toggleProjectsSection(): void {
        projectsCollapsed.value = !projectsCollapsed.value
        collapseTouched = true
        persistCollapseState()
    }

    /** 当前会话是否落在该项目内(仅决定未手动操作时的默认展开) */
    function holdsCurrentConversation(group: NexoraCodeProjectConversationGroup): boolean {
        return group.rows.some((row) => row.conversation.id === props.currentId)
    }

    /** 项目是否收起(规则见 resolveProjectCollapsed) */
    function isProjectCollapsed(group: NexoraCodeProjectConversationGroup): boolean {
        return resolveProjectCollapsed({
            holdsCurrent: holdsCurrentConversation(group),
            override: collapseOverrides.value.get(group.project.project_id),
        })
    }

    function toggleProject(group: NexoraCodeProjectConversationGroup): void {
        // 任意项目都可手动切换(含当前会话所在项目):写入折叠记录后由
        // resolveProjectCollapsed 让手动记录优先,不再被「自动展开」压住。
        const next = new Map(collapseOverrides.value)
        next.set(group.project.project_id, !isProjectCollapsed(group))
        collapseOverrides.value = next
        collapseTouched = true
        persistCollapseState()
    }

    /**
     * 每个项目默认只展示最新 5 条会话,其余折叠为「展开更多」。
     * rows 已按后端顺序(置顶在前、其余按最近活动)排列,取前缀即最新。
     */
    function visibleRows(group: NexoraCodeProjectConversationGroup): ConversationBranchRow[] {
        return sliceVisibleRows(group.rows, expandedSteps.value.get(group.project.project_id) ?? 0)
    }

    function hiddenRowCount(group: NexoraCodeProjectConversationGroup): number {
        const limit = resolveVisibleRowLimit(group.rows.length, expandedSteps.value.get(group.project.project_id) ?? 0)

        return Math.max(0, group.rows.length - limit)
    }

    function hasHiddenRows(group: NexoraCodeProjectConversationGroup): boolean {
        return hiddenRowCount(group) > 0
    }

    /** 展开更多:追加一批(默认 10 条),直到全部展开后按钮自动消失 */
    function revealMore(group: NexoraCodeProjectConversationGroup): void {
        const projectId = group.project.project_id
        const next = new Map(expandedSteps.value)
        next.set(projectId, (expandedSteps.value.get(projectId) ?? 0) + 1)
        expandedSteps.value = next
    }

    function handleNewProjectConversation(project: NexoraCodeProject): void {
        emit('open-chat')
        emit('new-project-chat', project)
    }

    async function handleAddProject(): Promise<void> {
        if (selectingProject.value) {
            return
        }

        selectingProject.value = true

        try {
            const project = await selectLocalProjectFolder()

            if (project) {
                handleNewProjectConversation(project)
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '选择项目文件夹失败')
        } finally {
            selectingProject.value = false
        }
    }
</script>
