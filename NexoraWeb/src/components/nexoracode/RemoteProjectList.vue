<!--
    RemoteProjectList.vue — 电脑项目与会话列表

    只负责导航：选电脑、选项目、选会话、新建会话。
    真正的执行状态在右侧任务面板，这里不显示运行中标记之外的任何任务信息。
-->

<template>
    <aside class="remote-project-list">
        <div class="remote-project-list-head">
            <span class="remote-project-list-title">电脑项目与会话</span>
            <Button
                size="compact"
                icon="fa-regular fa-square-plus"
                :disabled="disabled || running"
                title="在该电脑的默认项目下新建会话"
                @click="$emit('new-conversation', null)"
            >新建</Button>
        </div>

        <div v-if="loading" class="remote-project-list-hint">正在读取电脑上的项目…</div>

        <p v-else-if="!projects.length" class="remote-project-list-hint">
            这台电脑上还没有带项目标记的会话。在电脑端 NexoraCode 中打开项目后即可在此选择。
        </p>

        <template v-else>
            <section v-for="project in projects" :key="project.path" class="remote-project">
                <header class="remote-project-head">
                    <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
                    <span class="remote-project-name" :title="project.path">{{ project.name }}</span>
                </header>
                <p class="remote-project-path" :title="project.path">{{ project.path }}</p>

                <ul class="remote-conversation-list">
                    <li v-for="conversation in project.conversations" :key="conversation.conversation_id">
                        <button
                            type="button"
                            class="remote-conversation"
                            :class="{ 'is-active': conversation.conversation_id === conversationId }"
                            :disabled="disabled"
                            @click="$emit('select-conversation', conversation.conversation_id)"
                        >
                            <span class="remote-conversation-title">{{ conversation.title || '未命名会话' }}</span>
                        </button>
                    </li>
                </ul>

                <Button
                    size="compact"
                    class="remote-project-new"
                    :disabled="disabled || running"
                    @click="$emit('new-conversation', project)"
                >在此项目新建会话</Button>
            </section>
        </template>
    </aside>
</template>

<script setup lang="ts">
    import type { RemoteProject, RemoteProjectRef } from '@/api/nexoracode'
    import { Button } from '@/ui'

    import '@/styles/remote-project-list.css'

    defineProps<{
        projects: RemoteProject[]
        conversationId: string
        loading: boolean
        /** 电脑离线或读取失败时置灰，不允许下发任何操作。 */
        disabled: boolean
        running: boolean
    }>()

    defineEmits<{
        'select-conversation': [conversationId: string]
        'new-conversation': [project: RemoteProjectRef | null]
    }>()
</script>
