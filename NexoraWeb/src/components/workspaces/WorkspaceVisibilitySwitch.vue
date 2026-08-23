<!--
    WorkspaceVisibilitySwitch.vue — 资源共享状态开关(对话/知识库/文件行内复用)

    轨道 + 滑块 + 文案;仅资源添加者可操作(disabled 由面板按 added_by 计算)。
    对齐原版 renderWorkspaceVisibilitySwitch 的视觉与交互。
-->

<template>
    <button
        class="ws-visibility-switch"
        :class="{ 'is-share': isShare }"
        type="button"
        :aria-pressed="isShare"
        :disabled="disabled"
        :title="title"
        @click.stop="emit('toggle')"
    >
        <span class="ws-visibility-track" aria-hidden="true">
            <span class="ws-visibility-thumb"></span>
        </span>
        <span class="ws-visibility-text">{{ label }}</span>
    </button>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import { normalizeVisibility, visibilityLabel } from './workspaceDisplay'

    const props = defineProps<{
        visibility: string
        disabled: boolean
    }>()

    const emit = defineEmits<{
        toggle: []
    }>()

    const isShare = computed(() => normalizeVisibility(props.visibility) === 'share')

    const label = computed(() => visibilityLabel(props.visibility))

    const title = computed(() => {
        if (props.disabled) {
            return '仅资源添加者可修改共享状态'
        }

        return `切换为 ${isShare.value ? '私有' : '共享'}`
    })
</script>

<style scoped>
    .ws-visibility-switch {
        width: 112px;
        min-width: 112px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 9px;
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
    }

    .ws-visibility-switch:hover {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
    }

    .ws-visibility-switch:focus-visible {
        outline: 2px solid var(--color-accent-text);
        outline-offset: 2px;
    }

    .ws-visibility-switch:disabled {
        cursor: default;
        opacity: 0.68;
    }

    .ws-visibility-switch.is-share {
        border-color: var(--color-text-primary);
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .ws-visibility-track {
        width: 32px;
        height: 18px;
        border-radius: 999px;
        background: var(--color-control-track);
        display: inline-flex;
        align-items: center;
        padding: 2px;
        box-sizing: border-box;
        transition: background 0.16s ease;
    }

    .ws-visibility-switch.is-share .ws-visibility-track {
        background: var(--color-text-primary);
    }

    .ws-visibility-thumb {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: var(--color-control-active);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.24);
        transform: translateX(0);
        transition: transform 0.16s ease;
    }

    .ws-visibility-switch.is-share .ws-visibility-thumb {
        transform: translateX(14px);
    }

    @media (max-width: 720px) {
        .ws-visibility-switch {
            width: 96px;
            min-width: 96px;
            padding: 0 7px;
        }

        .ws-visibility-track {
            width: 28px;
            height: 16px;
        }

        .ws-visibility-thumb {
            width: 12px;
            height: 12px;
        }

        .ws-visibility-switch.is-share .ws-visibility-thumb {
            transform: translateX(12px);
        }
    }
</style>
