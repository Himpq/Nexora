<template>
    <div
        v-show="visible"
        class="tool-stage-reply-preview"
        :data-phase="state?.phase"
        :data-compact="compact"
        role="region"
        aria-label="回复预览"
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

    /** 完成的正文预览回到开头,并把窗口限制为两行。 */
    const compact = computed(() => {
        const current = state.value

        return current?.completed === true && current.phase === 'content'
    })
    const excerpt = computed(() => state.value
        ? clipToolStagePreviewText(state.value.text, 480, compact.value)
        : '')
    const visible = computed(() => !!state.value && (state.value.title !== '' || excerpt.value !== ''))

    /** 同一帧内只调整一次位置;流式追尾,完成后回到正文开头。 */
    function scheduleScroll(): void {

        if (scrollFrame !== 0) {
            return
        }

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0

            if (visible.value) {
                const element = previewWindow.value!
                element.scrollTop = compact.value ? 0 : element.scrollHeight
            }
        })
    }

    watch(visible, (value) => { emit('visibility-change', value) }, { immediate: true, flush: 'sync' })
    watch([excerpt, compact], scheduleScroll, { flush: 'post' })

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
