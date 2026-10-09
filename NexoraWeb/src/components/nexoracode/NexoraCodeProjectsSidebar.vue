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
                @click="projectsCollapsed = !projectsCollapsed"
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
                    @click="projectsCollapsed = !projectsCollapsed"
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
                    <div class="nexoracode-sidebar-project-row">
                        <button
                            type="button"
                            class="nexoracode-sidebar-project-main"
                            :title="group.project.path || group.project.name"
                            :aria-expanded="!isProjectCollapsed(group)"
                            @click="toggleProject(group)"
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
                                @click="handleNewProjectConversation(group.project)"
                            >
                                <i class="fa-solid fa-message" aria-hidden="true"></i>
                            </button>
                            <button
                                type="button"
                                class="nexoracode-sidebar-icon-btn nexoracode-sidebar-caret-btn"
                                title="展开 / 折叠项目会话"
                                aria-label="展开 / 折叠项目会话"
                                :aria-expanded="!isProjectCollapsed(group)"
                                @click="toggleProject(group)"
                            >
                                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                            </button>
                        </span>
                    </div>

                    <div class="nexoracode-sidebar-project-conversations">
                        <div class="nexoracode-sidebar-project-conversations-inner">
                            <ConversationSidebarItem
                                v-for="row in group.rows"
                                :key="row.conversation.id"
                                :conversation="row.conversation"
                                :depth="row.depth"
                                :orphan="row.orphan"
                                :active="row.conversation.id === currentId"
                                :streaming="store.isConversationGenerating(row.conversation.id)"
                                project-item
                                @open="emit('open-conversation', row.conversation.id)"
                                @delete="emit('delete-conversation', row.conversation)"
                            />
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ConversationSummary } from '@/api/conversations'
    import type { ConversationBranchRow } from '@/stores/conversation'
    import {
        selectLocalProjectFolder,
        type NexoraCodeProject,
    } from '@/api/nexoracodeLocal'
    import { showError } from '@/stores/notify'
    import { useConversationStore } from '@/stores/conversation'
    import ConversationSidebarItem from '@/components/ConversationSidebarItem.vue'
    import { groupNexoraCodeProjectRows, type NexoraCodeProjectConversationGroup } from './projectConversations'
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
    }>()

    const store = useConversationStore()
    const projectsCollapsed = ref(false)
    const selectingProject = ref(false)
    const collapseOverrides = ref(new Map<string, boolean>())
    const projectGroups = computed(() => groupNexoraCodeProjectRows(props.rows))

    function isProjectCollapsed(group: NexoraCodeProjectConversationGroup): boolean {
        const override = collapseOverrides.value.get(group.project.project_id)

        if (override !== undefined) {
            return override
        }

        return !group.rows.some((row) => row.conversation.id === props.currentId)
    }

    function toggleProject(group: NexoraCodeProjectConversationGroup): void {
        const next = new Map(collapseOverrides.value)
        next.set(group.project.project_id, !isProjectCollapsed(group))
        collapseOverrides.value = next
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
