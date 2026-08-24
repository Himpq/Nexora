<!--
    WorkspaceResourceMenu.vue — Workspace 资源右键菜单(基于 GDDP ui/ContextMenu)

    仅负责"置顶 / 取消置顶"与可选"从 Workspace 移除"两项;定位、视口钳制、
    外部点击关闭与暗色视觉统一交由 GDDP ContextMenu 处理。根组件通过
    open(x, y) 命令式打开,并预先把置顶态 / 是否显示移除项经 props 传入。
-->

<template>
    <ContextMenu
        ref="menuRef"
        :items="menuItems"
        :keep-panel="true"
        @select="onSelect"
    />
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import ContextMenu, { type ContextMenuItem } from '@/ui/ContextMenu.vue'

    const props = defineProps<{
        /** 当前资源是否置顶(决定首项文案) */
        pinned: boolean
        /** 显示「从 Workspace 移除」(当前仅自己添加的文件行) */
        showRemove?: boolean
    }>()

    const emit = defineEmits<{
        confirm: []
        remove: []
    }>()

    const menuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

    /** 菜单项:置顶态文案 + 可选移除项 */
    const menuItems = computed<ContextMenuItem[]>(() => {
        const items: ContextMenuItem[] = [
            {
                key: 'confirm',
                label: props.pinned ? '取消置顶' : '置顶',
                icon: 'fa-solid fa-thumbtack',
            },
        ]

        if (props.showRemove) {
            items.push({
                key: 'remove',
                label: '从 Workspace 移除',
                icon: 'fa-solid fa-folder-minus',
                danger: true,
            })
        }

        return items
    })

    /** 命令式打开(由父级 contextmenu 监听调用,传入视口坐标) */
    function open(x: number, y: number): void {
        menuRef.value?.open(x, y)
    }

    /** 命令式关闭 */
    function close(): void {
        menuRef.value?.close()
    }

    /** 菜单是否当前打开 */
    function isOpen(): boolean {
        return menuRef.value?.isOpen() ?? false
    }

    function onSelect(key: string): void {
        if (key === 'confirm') {
            emit('confirm')

            return
        }

        if (key === 'remove') {
            emit('remove')
        }
    }

    defineExpose({ open, close, isOpen })
</script>
