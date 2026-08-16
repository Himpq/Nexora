<!--
    SelectionContextMenu.vue — 选区右键菜单(对齐原版 notesContextMenu)

    触发:在消息区域选中文本后右键,显示"添加到笔记 / 复制选中文本 / 解释"。
    位置经浮层协调器保证互斥(z-index 低于右键菜单,复用 --z-right-click 层级语义)。
-->

<template>
    <div
        v-if="visible"
        class="notes-context-menu active"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @click.stop
    >
        <button type="button" @click="handleAddNote">
            <i class="fa-solid fa-note-sticky" aria-hidden="true"></i>
            <span>添加到笔记</span>
        </button>
        <button type="button" @click="handleCopy">
            <i class="fa-regular fa-copy" aria-hidden="true"></i>
            <span>复制选中文本</span>
        </button>
        <button type="button" @click="handleExplain">
            <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
            <span>解释</span>
        </button>
    </div>
</template>

<script setup lang="ts">
    import { ref } from 'vue'

    import type { NoteAnchor } from '@/api/notes'
    import { showToast } from '@/stores/notify'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const emit = defineEmits<{
        /** 添加笔记:文本 + 来源标题 + 定位(conversationId + messageIndex,供跳转来源) */
        'add-note': [text: string, sourceTitle: string, anchor: NoteAnchor | null]
        /** 解释选中文本(原版由 AI 完成,当前未接入) */
        explain: [text: string]
    }>()

    const visible = ref(false)
    const x = ref(0)
    const y = ref(0)

    let pendingText = ''
    let pendingAnchor: NoteAnchor | null = null

    /** 打开菜单(由父级 contextmenu 监听调用) */
    function open(
        text: string,
        clientX: number,
        clientY: number,
        anchor: NoteAnchor | null = null
    ): void {
        pendingText = text
        pendingAnchor = anchor
        x.value = Math.min(Math.max(8, clientX), Math.max(8, window.innerWidth - 190))
        y.value = Math.min(Math.max(8, clientY), Math.max(8, window.innerHeight - 120))

        visible.value = true

        openPopover('selection-menu')
    }

    /** 关闭菜单 */
    function close(): void {
        visible.value = false
        pendingText = ''
        pendingAnchor = null

        closePopover('selection-menu')
    }

    /** 菜单是否当前打开(供外部点击关闭判断) */
    function isOpen(): boolean {
        return visible.value && overlay.popover === 'selection-menu'
    }

    function handleAddNote(): void {
        const text = pendingText
        const anchor = pendingAnchor

        close()

        if (!text.trim()) {
            return
        }

        emit('add-note', text, document.title || '', anchor)
    }

    async function handleCopy(): Promise<void> {
        const text = pendingText

        close()

        try {
            await navigator.clipboard.writeText(text)

            showToast('已复制', 'success')
        } catch {
            showToast('复制失败', 'error')
        }
    }

    function handleExplain(): void {
        const text = pendingText

        close()

        if (!text.trim()) {
            return
        }

        emit('explain', text)
    }

    defineExpose({ open, close, isOpen })
</script>
