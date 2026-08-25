<!--
    ContextCompressionCard.vue — 上下文压缩卡片(GDDP 视觉)

    对齐原版 chat.js upsertContextCompressionCard 的上下文压缩卡片:
      - 徽标头:图标 + "Context Compression" 名称 + 状态文案(可点击展开)
      - 展开正文:触发原因 + token 统计 + 摘要(数据源自 context_compression_status 块)
      - 状态色:进行中蓝 / 完成绿 / 跳过中性灰,卡片本体遵循 GDDP 克制白底描边
    样式为组件级作用域,不依赖原版 style.css 的 .tool-usage 旧类,便于独立演进。
-->

<template>
    <div class="context-compression-card" :class="{ done: done, skipped: skipped, expanded: expanded }">
        <div
            class="cc-card-head"
            role="button"
            tabindex="0"
            :aria-expanded="expanded"
            @click="toggle"
            @keydown.enter.prevent="toggle"
        >
            <svg class="cc-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="4 14 10 14 10 20"></polyline>
                <polyline points="20 10 14 10 14 4"></polyline>
                <line x1="14" y1="10" x2="21" y2="3"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
            <span class="cc-card-name">Context Compression</span>
            <span class="cc-card-status" :title="statusText">{{ statusText }}</span>
            <svg class="cc-card-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>

        <div v-if="outputText" class="cc-card-output">{{ outputText }}</div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ContextCompressionStep } from '@/stream/contextCompression'
    import { buildContextCompressionOutputText } from '@/stream/contextCompression'

    const props = defineProps<{
        step: ContextCompressionStep
    }>()

    const expanded = ref(false)

    /** 完成态:非 start 即视为已结束(对齐原版 status !== 'start' 时挂 .done) */
    const done = computed(() => props.step.status !== 'start')

    /** 跳过态:跳过时卡片整体走中性灰视觉 */
    const skipped = computed(() => props.step.status === 'skipped')

    /** 状态文案:优先后端 content,缺失时按状态兜底 */
    const statusText = computed(() => {
        if (props.step.content) {
            return props.step.content
        }

        if (props.step.status === 'done') {
            return '上下文压缩完成'
        }

        if (props.step.status === 'skipped') {
            return '上下文压缩跳过'
        }

        return '上下文压缩中'
    })

    /** 展开正文(纯函数构建,保证流式/历史回放文案一致) */
    const outputText = computed(() => buildContextCompressionOutputText(props.step))

    /** 点击徽标头切换展开(对齐原版 bindToolUsageToggle 的 tool-badge 点击) */
    function toggle(): void {
        if (!outputText.value) {
            return
        }

        expanded.value = !expanded.value
    }
</script>

<style scoped>
    /* 卡片本体:GDDP 克制白底 + 浅灰描边 + 轻阴影 */
    .context-compression-card {
        margin: 8px 0;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        overflow: hidden;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .cc-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
    }

    .cc-card-head:hover {
        background: var(--color-bg-hover);
    }

    .cc-card-icon {
        flex: none;
        color: var(--color-text-secondary);
    }

    .cc-card-name {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary);
    }

    .cc-card-status {
        margin-left: auto;
        font-weight: 500;
        color: var(--color-accent-text);
    }

    .cc-card-toggle {
        flex: none;
        color: var(--color-text-secondary);
        transition: transform 0.2s ease;
    }

    .context-compression-card.expanded .cc-card-toggle {
        transform: rotate(180deg);
    }

    /* 完成态:状态文案转绿,与徽标一致(对齐原版 .done 的绿色系) */
    .context-compression-card.done .cc-card-status {
        color: #0f766e;
    }

    /* 跳过态:中性灰,弱化存在感 */
    .context-compression-card.skipped .cc-card-status {
        color: var(--color-text-secondary);
    }

    .cc-card-output {
        display: none;
        padding: 10px 12px;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
        max-height: 240px;
        overflow-y: auto;
    }

    .context-compression-card.expanded .cc-card-output {
        display: block;
    }
</style>