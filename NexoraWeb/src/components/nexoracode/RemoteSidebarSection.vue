<!--
    RemoteSidebarSection.vue — 侧边栏远程电脑与项目

    结构对齐 NexoraCode 桌面端侧边栏（chat_conversations.js 的
    renderConversationList + renderNexoraCodeProjectPanel，样式见 style.css 的
    nexoracode-sidebar-* 系列）:
        电脑(整行可点，收起) → 项目(整行可点，收起；行尾新建对话) → 会话
    电脑行与项目行的折叠区都是 grid 1fr/0fr 过渡（与原版逐像素一致），
    就地切 class 不重建列表。

    两个与原版不同的取舍:
      - 不显示没有项目归属的对话。电脑上的对话若 metadata.nexoracode_project 为空，
        在这里没有可挂靠的项目行，平铺出来只会和项目下的对话混在一起；
        数量徽标也只算项目下的对话，保证徽标与实际可见条数一致。
      - 没有额外的「Remote」标题栏。电脑列表直接挂在云端会话列表上方，
        省掉一层不含信息的折叠。

    电脑行的整行点击同时承担「切电脑」与「收起」：store.selectDevice 对当前电脑
    是幂等的，所以收起当前电脑不会清掉正在看的会话；点另一台才是真正的切换。
-->

<template>
    <section class="remote-sidebar" aria-label="远程电脑">
        <p v-if="!store.devices.length" class="remote-sidebar-empty">
            还没有电脑绑定。在左下角用户菜单的「远程连接」里生成配对码。
        </p>

        <div
            v-for="device in store.devices"
            :key="device.device_id"
            class="remote-sidebar-device"
            :class="{ 'is-collapsed': isCollapsed(device.device_id) }"
        >
            <div class="remote-sidebar-device-row" @click="handleDeviceRow(device)">
                <button type="button" class="remote-sidebar-device-main">
                    <i class="fa-solid fa-laptop-code remote-sidebar-row-icon" aria-hidden="true"></i>
                    <span class="remote-sidebar-row-name">{{ device.name || '未命名电脑' }}</span>
                    <span
                        class="remote-sidebar-device-dot"
                        :class="{ 'is-online': device.online }"
                        :title="device.online ? '在线' : '离线'"
                    ></span>
                    <span class="remote-sidebar-row-count">{{ countConversations(device.device_id) }}</span>
                </button>
                <span class="remote-sidebar-actions">
                    <button
                        type="button"
                        class="remote-sidebar-icon-btn remote-sidebar-caret-btn"
                        title="展开 / 折叠对话"
                        @click.stop="toggle(device.device_id)"
                    >
                        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                </span>
            </div>

            <div class="remote-sidebar-body">
                <div class="remote-sidebar-body-inner">
                    <p v-if="!projectGroups(device.device_id).length" class="remote-sidebar-conversation-empty">
                        {{ device.online ? '电脑上还没有项目对话' : '电脑离线，无法读取对话' }}
                    </p>

                    <div
                        v-for="group in projectGroups(device.device_id)"
                        :key="projectKey(group.project || null)"
                        class="remote-sidebar-project"
                        :class="{ 'is-collapsed': isCollapsed(projectKey(group.project || null)) }"
                    >
                        <div class="remote-sidebar-project-row" @click="toggle(projectKey(group.project || null))">
                            <button type="button" class="remote-sidebar-project-main" :title="group.project?.path">
                                <i class="fa-solid fa-folder remote-sidebar-row-icon" aria-hidden="true"></i>
                                <span class="remote-sidebar-row-name">{{ group.project?.name || group.project?.path }}</span>
                                <span class="remote-sidebar-row-count">{{ group.conversations.length }}</span>
                            </button>
                            <span class="remote-sidebar-actions">
                                <button
                                    type="button"
                                    class="remote-sidebar-icon-btn"
                                    title="在此项目新建对话"
                                    :disabled="!device.online || store.busy"
                                    @click.stop="group.project && createConversation(device, group.project)"
                                >
                                    <i class="fa-solid fa-message" aria-hidden="true"></i>
                                </button>
                                <button
                                    type="button"
                                    class="remote-sidebar-icon-btn remote-sidebar-caret-btn"
                                    title="展开 / 折叠对话"
                                    @click.stop="toggle(projectKey(group.project || null))"
                                >
                                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                                </button>
                            </span>
                        </div>

                        <div class="remote-sidebar-conversations">
                            <div class="remote-sidebar-conversations-inner">
                                <div
                                    v-for="conversation in group.conversations"
                                    :key="conversation.conversation_id"
                                    class="conversation-item remote-sidebar-conversation"
                                    :class="{
                                        active: isActive(device, conversation),
                                        'is-streaming': isRunning(conversation),
                                    }"
                                    :title="conversation.title"
                                    @click="openConversation(device, conversation.conversation_id)"
                                >
                                    <span class="title">{{ conversation.title || '未命名对话' }}</span>
                                    <span
                                        v-if="isRunning(conversation)"
                                        class="conversation-stream-indicator is-loading"
                                        title="任务在电脑上执行中"
                                        aria-hidden="true"
                                    >
                                        <i class="fa-solid fa-circle-notch fa-spin"></i>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'

    import type { RemoteConversation, RemoteConversationGroup, RemoteDevice, RemoteProjectRef } from '@/api/nexoracode'
    import { remoteStore } from '@/stores/remote'

    import '@/styles/remote-sidebar-section.css'

    const emit = defineEmits<{ open: [] }>()

    const store = remoteStore

    /**
     * 折叠状态按 key 记:电脑用 device_id,项目用 project.path。
     * 原版用两个 Map 分开记,这里合成一张表——键空间天然不冲突。
     * 项目默认收起,由用户主动展开查看对话;新建项目对话时会主动展开目标行。
     */
    const collapsedKeys = ref<Record<string, boolean>>({})

    function projectKey(project: RemoteProjectRef | null): string {
        return `project:${project?.path || ''}`
    }

    function isCollapsed(key: string): boolean {
        if (collapsedKeys.value[key] !== undefined) {
            return collapsedKeys.value[key]
        }

        return key.startsWith('project:')
    }

    function toggle(key: string): void {
        collapsedKeys.value = { ...collapsedKeys.value, [key]: !isCollapsed(key) }
    }

    /** 只展示有项目归属的对话；无项目归属的在这里不出现，数量徽标也不计入。 */
    function projectGroups(deviceId: string): RemoteConversationGroup[] {
        return store.groupsOf(deviceId).filter(group => !!group.project)
    }

    function countConversations(deviceId: string): number {
        return projectGroups(deviceId).reduce((total, group) => total + group.conversations.length, 0)
    }

    /** 电脑行整行可点：切电脑 + 收起。对当前电脑是幂等的，只收起不会清掉会话。 */
    function handleDeviceRow(device: RemoteDevice): void {
        store.selectDevice(device.device_id)
        toggle(device.device_id)
        emit('open')
    }

    function openConversation(device: RemoteDevice, conversationId: string): void {
        if (device.device_id !== store.deviceId) {
            store.selectDevice(device.device_id)
        }

        store.selectConversation(conversationId)
        emit('open')
    }

    /** 在电脑的指定项目下新建对话。 */
    function createConversation(device: RemoteDevice, project: RemoteProjectRef): void {
        if (device.device_id !== store.deviceId) {
            store.selectDevice(device.device_id)
        }

        // 新建完要把所在的那一行展开,否则新对话落在看不见的折叠层里。
        collapsedKeys.value = {
            ...collapsedKeys.value,
            [device.device_id]: false,
            [projectKey(project)]: false,
        }

        void store.createConversation(project)
        emit('open')
    }

    function isActive(device: RemoteDevice, conversation: RemoteConversation): boolean {
        return device.device_id === store.deviceId && conversation.conversation_id === store.conversationId
    }

    /**
     * 正在跑任务的对话挂运行标记。
     *
     * 按会话逐个判断而不是读全局 running：电脑端支持多会话并行，
     * 侧栏要能同时标出多个在跑的会话。
     */
    function isRunning(conversation: RemoteConversation): boolean {
        return store.isRunning(conversation.conversation_id)
    }

    onMounted(() => {
        store.start()
    })
</script>
