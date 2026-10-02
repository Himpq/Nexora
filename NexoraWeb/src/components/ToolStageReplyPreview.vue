<template>
    <div
        v-show="visible"
        class="tool-stage-reply-preview"
        :data-phase="state?.phase"
        role="region"
        aria-label="正在生成的回复预览"
    >
        <div v-if="state?.title" class="tool-stage-reply-preview__status">{{ state.title }}</div>
        <div ref="previewWindow" class="tool-stage-reply-preview__window">{{ excerpt }}</div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type { ToolStageReplySource } from '@/ui/toolStage'
    import { clipToolStagePreviewText, readToolStageReplyPreview } from '@/ui/toolStageReplyPreview'

    const props = defineProps<{
        active: boolean
        reply: ToolStageReplySource | null
    }>()

    const emit = defineEmits<{
        'visibility-change': [visible: boolean]
    }>()

    const previewWindow = ref<HTMLDivElement | null>(null)
    let scrollFrame = 0
    let sizeObserver: ResizeObserver | null = null

    /** 当前阶段只在小窗口内消费,思考/工具增量不会驱动聊天外壳重新渲染。 */
    const state = computed(() => {

        if (!props.active || !props.reply) {
            return null
        }

        return readToolStageReplyPreview(props.reply)
    })

    const excerpt = computed(() => state.value ? clipToolStagePreviewText(state.value.text) : '')
    const visible = computed(() => !!state.value && (state.value.title !== '' || excerpt.value !== ''))

    /** 同一帧内的增量只滚动一次,固定窗口始终显示最新的几行。 */
    function scheduleScroll(): void {

        if (scrollFrame !== 0) {
            return
        }

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0

            if (visible.value) {
                const element = previewWindow.value!
                element.scrollTop = element.scrollHeight
            }
        })
    }

    watch(visible, (value) => { emit('visibility-change', value) }, { immediate: true, flush: 'sync' })
    watch(excerpt, scheduleScroll, { flush: 'post' })

    // 仅记录阶段切换,不记录思考正文、工具参数和结果。
    watch(() => state.value?.phase, (phase) => {

        if (phase) {
            console.info('[ToolStageReplyPreview] Stream phase changed', { phase })
        }
    })

    onMounted(() => {
        // 窗口变矮时仍显示正文末尾,不必等到下一个回复增量。
        sizeObserver = new ResizeObserver(scheduleScroll)
        sizeObserver.observe(previewWindow.value!)
        scheduleScroll()
    })

    onBeforeUnmount(() => {
        sizeObserver?.disconnect()

        if (scrollFrame !== 0) {
            cancelAnimationFrame(scrollFrame)
        }
    })
</script>
