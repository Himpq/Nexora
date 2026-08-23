<!--
    WorkspaceResourceMenu.vue — Workspace 资源右键菜单(置顶/取消置顶)

    根组件只投递原始坐标与状态;视口边界钳制在本组件内用实测尺寸完成
    (对齐原版 showWorkspaceResourceContextMenu 的 offsetWidth/Height 钳制)。
-->

<template>
    <div
        v-if="visible"
        ref="menuRef"
        class="ws-context-menu"
        :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
        role="menu"
        @click.stop
        @contextmenu.prevent
    >
        <button type="button" role="menuitem" @click="emit('confirm')">
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
            <span>{{ pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button v-if="showRemove" type="button" role="menuitem" class="ws-context-danger" @click="emit('remove')">
            <i class="fa-solid fa-folder-minus" aria-hidden="true"></i>
            <span>从 Workspace 移除</span>
        </button>
    </div>
</template>

<script setup lang="ts">
    import { nextTick, reactive, ref, watch } from 'vue'

    const props = defineProps<{
        visible: boolean
        x: number
        y: number
        pinned: boolean
        /** 显示「从 Workspace 移除」(当前仅自己添加的文件行) */
        showRemove?: boolean
    }>()

    const emit = defineEmits<{
        confirm: []
        remove: []
    }>()

    const menuRef = ref<HTMLElement | null>(null)

    /** 钳制后的定位(视口内边距 8px,右/下留出实测菜单尺寸) */
    const pos = reactive({ x: props.x, y: props.y })

    /** 显示或坐标变化后按实测尺寸钳制,防止菜单溢出视口 */
    watch(
        () => [props.visible, props.x, props.y] as const,
        async ([visible]) => {
            if (!visible) {
                return
            }

            await nextTick()

            const menu = menuRef.value
            const width = menu?.offsetWidth || 136
            const height = menu?.offsetHeight || 48

            pos.x = Math.min(Math.max(8, props.x), Math.max(8, window.innerWidth - width - 12))
            pos.y = Math.min(Math.max(8, props.y), Math.max(8, window.innerHeight - height - 12))
        },
        { immediate: true }
    )
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

    .ws-context-menu button.ws-context-danger {
        color: var(--color-danger-text);
    }
</style>
