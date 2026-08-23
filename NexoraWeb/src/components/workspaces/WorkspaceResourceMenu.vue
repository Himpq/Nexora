<!--
    WorkspaceResourceMenu.vue — Workspace 资源右键菜单(置顶/取消置顶)

    定位与显隐由根组件控制(对齐原版 showWorkspaceResourceContextMenu 的边界钳制),
    本组件只负责渲染与确认回调。
-->

<template>
    <div
        v-if="visible"
        class="ws-context-menu"
        :style="{ left: `${x}px`, top: `${y}px` }"
        role="menu"
        @click.stop
        @contextmenu.prevent
    >
        <button type="button" role="menuitem" @click="emit('confirm')">
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
            <span>{{ pinned ? '取消置顶' : '置顶' }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
    defineProps<{
        visible: boolean
        x: number
        y: number
        pinned: boolean
    }>()

    const emit = defineEmits<{
        confirm: []
    }>()
</script>

<style scoped>
    .ws-context-menu {
        position: fixed;
        z-index: var(--z-right-click);
        min-width: 136px;
        padding: 6px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        box-shadow: 0 16px 42px rgba(15, 23, 42, 0.16);
    }

    .ws-context-menu button {
        width: 100%;
        min-height: 34px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-primary);
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 10px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
    }

    .ws-context-menu button:hover {
        background: var(--color-bg-hover);
    }
</style>
