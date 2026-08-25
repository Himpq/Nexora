<!--
    SelectionContextMenu.vue — 选区右键菜单(基于 GDDP ui/ContextMenu)

    触发:在消息区域选中文本后右键,显示"添加到笔记 / 复制选中文本 / 解释"。
    定位与视口钳制由 GDDP ContextMenu 统一负责;本组件仅维护待处理文本与来源锚点,
    并按菜单项 key 分发到对应动作。位置互斥复用 --z-right-click 层级语义。
-->

<template>
    <ContextMenu
        ref="menuRef"
        :items="menuItems"
        @select="onSelect"
    />
</template>

<script setup lang="ts">
    import { ref } from 'vue'

    import type { NoteAnchor } from '@/api/notes'
    import { showToast } from '@/stores/notify'
    import ContextMenu, { type ContextMenuItem } from '@/ui/ContextMenu.vue'

    const emit = defineEmits<{
        /** 添加笔记:文本 + 来源标题 + 定位(conversationId + messageIndex,供跳转来源) */
        'add-note': [text: string, sourceTitle: string, anchor: NoteAnchor | null]
        /** 解释选中文本(原版由 AI 完成,当前未接入) */
        explain: [text: string]
    }>()

    const menuItems: ContextMenuItem[] = [
        { key: 'add-note', label: '添加到笔记', icon: 'fa-solid fa-note-sticky' },
        { key: 'copy', label: '复制选中文本', icon: 'fa-regular fa-copy' },
        { key: 'explain', label: '解释', icon: 'fa-solid fa-lightbulb' },
    ]

    const menuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

    let pendingText = ''
    let pendingAnchor: NoteAnchor | null = null

    /** 打开菜单(由父级 contextmenu 监听调用) */
    function open(
        text: string,
        clientX: number,
        clientY: number,
        anchor: NoteAnchor | null = null,
    ): void {
        pendingText = text
        pendingAnchor = anchor

        menuRef.value?.open(clientX, clientY)
    }

    /** 关闭菜单 */
    function close(): void {
        menuRef.value?.close()
        pendingText = ''
        pendingAnchor = null
    }

    /** 菜单是否当前打开(供外部点击关闭判断) */
    function isOpen(): boolean {
        return menuRef.value?.isOpen() ?? false
    }

    function onSelect(key: string): void {
        const text = pendingText

        if (key === 'add-note') {
            if (!text.trim()) {
                return
            }

            emit('add-note', text, document.title || '', pendingAnchor)
            pendingText = ''
            pendingAnchor = null

            return
        }

        if (key === 'copy') {
            void navigator.clipboard.writeText(text)
                .then(() => showToast('已复制', 'success'))
                .catch(() => showToast('复制失败', 'error'))

            pendingText = ''
            pendingAnchor = null

            return
        }

        if (key === 'explain') {
            if (text.trim()) {
                emit('explain', text)
            }

            pendingText = ''
            pendingAnchor = null
        }
    }

    defineExpose({ open, close, isOpen })
</script>
