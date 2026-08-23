<!--
    BrowserSyncConnector.vue — 浏览器实时同步通道挂载点(/ws/browser)

    设计:
      - 无渲染组件:仅负责 browserSync 服务的生命周期与会话订阅联动
      - 进入聊天页自动连接,卸载时断开;切换会话自动更新会话级事件订阅
      - 事件到 store 的分发逻辑统一在 src/stream/browserSync.ts,本组件不承载业务
-->

<template></template>

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, watch } from 'vue'

    import { browserSync } from '@/stream/browserSync'
    import { useConversationStore } from '@/stores/conversation'
    import { useMailStore } from '@/stores/mail'

    const conversationStore = useConversationStore()
    const mailStore = useMailStore()

    onMounted(() => {
        browserSync.start()
        mailStore.init()
        browserSync.syncConversation(conversationStore.currentId)
    })

    onBeforeUnmount(() => {
        browserSync.stop()
    })

    // 切换会话时同步会话订阅,保证会话级推送路由到当前连接
    watch(
        () => conversationStore.currentId,
        (conversationId) => {
            browserSync.syncConversation(conversationId)
        }
    )
</script>
