<!--
    ContextInjectionCard.vue — Modified Injection 卡片

    显式展示本轮注入的 tail volatile 块(项目约定 / 自定义提示词):
      - 徽标头:图标 + "Modified Injection" 名称 + 块摘要(可点击展开)
      - 展开正文:head 恒定说明 + 每个注入块的变更行(+ / - 行,与知识库 diff 同源)
    设计契约(与 ChatDBServer 的 knowledge diff 通道同构):
      head 恒定(prefix cache 命中),volatile 块走 tail 每轮重发;
      rows 由后端按注入块正文提取,界面展示的 diff 与真正注入内容一致。
    样式与 ContextCompressionCard 同源,保持视觉一致。
-->

<template>
    <div class="context-injection-card" :class="{ expanded: expanded }">
        <div
            class="ci-card-head"
            role="button"
            tabindex="0"
            :aria-expanded="expanded"
            @click="toggle"
            @keydown.enter.prevent="toggle"
        >
            <svg
                class="ci-card-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <path d="M12 2 2 7l10 5 10-5-10-5z"></path>
                <path d="M2 17l10 5 10-5"></path>
                <path d="M2 12l10 5 10-5"></path>
            </svg>
            <span class="ci-card-name">Modified Injection</span>
            <span class="ci-card-status" :title="statusText">{{ statusText }}</span>
            <svg class="ci-card-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>

        <div v-if="outputText" class="ci-card-output">
            <div class="ci-card-summary">{{ outputText }}</div>

            <div
                v-for="block in step.blocks"
                :key="block.name"
                class="ci-block"
            >
                <div class="ci-block-head">
                    <span class="ci-block-name">{{ injectionBlockLabel(block.name) }}</span>
                    <span class="ci-block-meta">{{ block.mode === 'diff' ? 'diff' : '全量' }} · {{ block.chars.toLocaleString() }} 字符</span>
                </div>

                <div
                    v-for="(row, rowIndex) in block.rows"
                    :key="`${row.kind}-${rowIndex}`"
                    class="knowledge-diff-row"
                    :class="row.kind"
                >
                    <span class="knowledge-diff-sign">{{ row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : '' }}</span>
                    <span>{{ row.text }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ContextInjectionStep } from '@/stream/contextInjection'
    import {
        buildContextInjectionOutputText,
        buildContextInjectionStatusText,
        injectionBlockLabel,
    } from '@/stream/contextInjection'

    const props = defineProps<{
        step: ContextInjectionStep
    }>()

    const expanded = ref(false)

    /** 状态文案:列出本轮注入的块名与字符数 */
    const statusText = computed(() => buildContextInjectionStatusText(props.step))

    /** 展开正文(纯函数构建,保证流式/历史回放文案一致) */
    const outputText = computed(() => buildContextInjectionOutputText(props.step))

    /** 点击徽标头切换展开 */
    function toggle(): void {
        if (!outputText.value) {
            return
        }

        expanded.value = !expanded.value
    }
</script>

<style scoped>
    /* 卡片本体:GDDP 克制白底 + 浅灰描边 + 轻阴影(与压缩卡片同源) */
    .context-injection-card {
        margin: 8px 0;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        overflow: hidden;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .ci-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
    }

    .ci-card-head:hover {
        background: var(--color-bg-hover);
    }

    .ci-card-icon {
        flex: none;
        color: var(--color-text-secondary);
    }

    .ci-card-name {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary);
    }

    .ci-card-status {
        margin-left: auto;
        font-weight: 500;
        color: var(--color-accent-text);
    }

    .ci-card-toggle {
        flex: none;
        color: var(--color-text-secondary);
        transition: transform 0.2s ease;
    }

    .context-injection-card.expanded .ci-card-toggle {
        transform: rotate(180deg);
    }

    .ci-card-output {
        display: none;
        padding: 10px 12px;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.6;
        max-height: 320px;
        overflow-y: auto;
    }

    .context-injection-card.expanded .ci-card-output {
        display: block;
    }

    /* 概要(恒定说明 + 块清单):等宽字体,与 diff 行区分 */
    .ci-card-summary {
        font-family: 'JetBrains Mono', monospace;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
    }

    /* 单个注入块:块头 + 变更行列表 */
    .ci-block {
        margin-top: 10px;
        border-top: 1px dashed var(--color-border);
        padding-top: 8px;
    }

    .ci-block-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 4px;
    }

    .ci-block-name {
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .ci-block-meta {
        color: var(--color-text-secondary);
        font-size: 11px;
    }

    /* 变更行:与知识库 diff 同款(绿加红删),note 行为中性说明 */
    .knowledge-diff-row {
        display: flex;
        gap: 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
    }

    .knowledge-diff-row.added {
        color: #15803d;
    }

    .knowledge-diff-row.removed {
        color: #b91c1c;
    }

    .knowledge-diff-row.note {
        color: var(--color-text-secondary);
        font-style: italic;
    }

    .knowledge-diff-sign {
        width: 12px;
        flex: 0 0 12px;
        font-weight: 700;
        text-align: center;
    }
</style>
