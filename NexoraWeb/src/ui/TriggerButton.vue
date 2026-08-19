<script setup lang="ts">
    /**
     * TriggerButton.vue — 统一下拉触发按钮(GDDP)
     *
     * 职责:
     *   - 取代散落的 .tool-mode-trigger / .file-center-sort-trigger,统一高度与圆角风格
     *   - 仅渲染按钮本体,下拉菜单由父级 .tool-mode-dropdown / .tool-mode-menu 负责定位
     */

    defineProps<{
        open?: boolean
    }>()

    defineEmits<{
        toggle: []
    }>()
</script>

<template>
    <button
        type="button"
        class="gddp-button tool-mode-trigger"
        :class="{ open }"
        aria-haspopup="listbox"
        :aria-expanded="!!open"
        @click.stop="$emit('toggle')"
    >
        <slot />
    </button>
</template>

<style scoped>
    /* 复用全局 GDDP gddp-button 的高度/边框/圆角,仅补充下拉打开态与内容细节 */
    .gddp-button.tool-mode-trigger {
        justify-content: space-between;
        max-width: 200px;
        gap: 8px;
        padding: 0 10px;
    }

    .gddp-button.tool-mode-trigger.open {
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
    }

    .gddp-button.tool-mode-trigger :deep(span) {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .gddp-button.tool-mode-trigger :deep(i) {
        font-size: 10px;
        color: #64748b;
        flex: 0 0 auto;
        transition: transform 0.16s ease;
    }

    .gddp-button.tool-mode-trigger.open :deep(i.fa-chevron-down),
    .gddp-button.tool-mode-trigger.open :deep(i.fa-chevron-up) {
        transform: rotate(180deg);
    }
</style>
