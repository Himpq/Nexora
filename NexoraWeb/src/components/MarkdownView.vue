<!--
    MarkdownView.vue — Markdown 渲染组件(对话与知识库共用)

    职责:
      - 流式 120ms 尾随节流(高频增量不逐字重解析,停止增量后补一次最终态)
      - 渲染委托 stream/markdownEngine.ts(全站唯一 marked 配置点:
        高亮/公式/表格容错/XSS 清洗都在引擎里,本组件不得直接触碰 marked)

    性能约定(重要):
      - 禁止在本组件或任何组件内直接调用 marked.use:它修改的是全局 marked 实例,
        且打包器会把模块顶层代码内联进组件 setup,组件挂载一次就叠一层高亮钩子,
        导致同一次解析内 token 被反复高亮/转义(2026-08 二次事故根因)。
-->

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import { renderMarkdownHtml } from '@/stream/markdownEngine'

    /** 流式节流间隔(ms):该周期内的多次增量合并为一次解析 */
    const RENDER_THROTTLE_MS = 120

    const props = defineProps<{
        content: string
    }>()

    /** 实际参与渲染的内容(节流缓冲区) */
    const displayContent = ref(props.content || '')

    let throttleTimer: number | null = null
    let lastRenderAt = 0

    function flushNow(): void {
        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }

        lastRenderAt = Date.now()
        displayContent.value = props.content || ''
    }

    watch(() => props.content, () => {
        if (!props.content) {
            flushNow()

            return
        }

        const elapsed = Date.now() - lastRenderAt

        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }

        if (elapsed >= RENDER_THROTTLE_MS) {
            flushNow()

            return
        }

        throttleTimer = window.setTimeout(() => {
            throttleTimer = null
            lastRenderAt = Date.now()
            displayContent.value = props.content || ''
        }, RENDER_THROTTLE_MS - elapsed)
    })

    onBeforeUnmount(() => {
        if (throttleTimer !== null) {
            window.clearTimeout(throttleTimer)

            throttleTimer = null
        }
    })

    const renderedHtml = computed(() => renderMarkdownHtml(displayContent.value))
</script>

<template>
    <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<style scoped>
    .markdown-body {
        line-height: 1.7;
        word-break: break-word;
        font-size: 14px;
    }

    .markdown-body :deep(p) {
        margin: 0.5em 0;
    }

    .markdown-body :deep(pre) {
        background: var(--color-bg-sunken);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 12px;
        overflow-x: auto;
    }

    .markdown-body :deep(code) {
        font-family: 'Cascadia Code', Consolas, monospace;
        font-size: 13px;
    }

    .markdown-body :deep(:not(pre) > code) {
        background: var(--color-bg-hover);
        border-radius: 4px;
        padding: 0.1em 0.4em;
    }

    .markdown-body :deep(table) {
        border-collapse: collapse;
        margin: 0.5em 0;
    }

    .markdown-body :deep(th),
    .markdown-body :deep(td) {
        border: 1px solid var(--color-border);
        padding: 4px 10px;
    }

    /* 表头底色与正文区分,暗色下不再呈"黑底白字"的裸表格观感 */
    .markdown-body :deep(th) {
        background: var(--color-bg-sunken);
        color: var(--color-text-primary);
        font-weight: 600;
    }

    /*
     * markdown 分隔符(---):浏览器默认 hr 继承文字色,
     * 暗色下会渲染成白色横线,显式收敛到边框令牌。
     */
    .markdown-body :deep(hr) {
        border: none;
        border-top: 1px solid var(--color-border);
    }

    .markdown-body :deep(blockquote) {
        border-left: 3px solid var(--color-border-strong);
        margin: 0.5em 0;
        padding-left: 12px;
        color: var(--color-text-secondary);
    }

    .markdown-body :deep(img) {
        max-width: 100%;
    }
</style>
