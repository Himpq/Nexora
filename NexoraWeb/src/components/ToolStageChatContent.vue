<template>
    <!-- 独立渲染边界:舞台动画只更新外壳,消息变化仍由此 slot 正常响应。 -->
    <div ref="contentRoot" class="tool-stage-focus__chat-content">
        <slot />
    </div>
</template>

<script setup lang="ts">
    import { onBeforeUnmount, ref } from 'vue'
    import { ToolStageScroll } from '@/ui/toolStageScroll'
    import '@/styles/tool-stage-scroll.css'

    const props = defineProps<{
        followBottom?: () => boolean
    }>()

    const contentRoot = ref<HTMLDivElement | null>(null)
    const scroll = new ToolStageScroll(() => contentRoot.value!, () => props.followBottom?.())

    /** 收起时记录各聊天滚动区的位置,隐藏布局不应改变用户正在阅读的记录。 */
    function rememberScroll(): void {
        scroll.remember()
    }

    /** 展开后的布局已生效,只还原之前记录过的同一个滚动区。 */
    function restoreScroll(): void {
        scroll.restore()
    }

    function resetScroll(): void {
        scroll.reset()
    }

    onBeforeUnmount(resetScroll)

    defineExpose({ rememberScroll, restoreScroll, resetScroll })
</script>
