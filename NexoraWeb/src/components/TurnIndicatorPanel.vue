<!--
    TurnIndicatorPanel.vue — 轮次指示器(对齐原版 turn-indicator-panel)

    设计:
      - 从 ChatView 中抽象:线条渲染 + hover 预览弹层 + 点击跳转回调
      - 输入:消息列表;输出:jump 事件(父级滚动到对应消息)
-->

<template>
    <div
        id="turnIndicatorPanel"
        class="turn-indicator-panel"
        :class="{ visible: lineCount > 0 }"
    >
        <div id="turnIndicatorLines" class="turn-indicator-lines">
            <div
                v-for="lineIndex in lineCount"
                :key="lineIndex"
                class="turn-indicator-line"
                :class="{ active: lineIndex === activeLine }"
                :title="lineTitle(lineIndex)"
                @click="handleClick(lineIndex)"
                @mouseenter="showPopup(lineIndex)"
                @mouseleave="hidePopup"
            ></div>
        </div>

        <!-- 轮次 hover 预览(对齐原版 turn-indicator-popup) -->
        <div class="turn-indicator-popup" :class="{ visible: popupVisible }">
            <div
                v-for="(message, index) in userMessages"
                :key="message.index"
                class="turn-indicator-popup-item"
                :class="{ active: index + 1 === hoveredLine }"
            >
                <div class="turn-indicator-popup-text">{{ messagePreview(message) }}</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ChatMessage } from '@/api/conversations'

    const props = defineProps<{
        messages: ChatMessage[]
    }>()

    const emit = defineEmits<{
        jump: [lineIndex: number]
    }>()

    /** 轮次数 = 用户消息数(对齐原版:每条用户消息一条线) */
    const lineCount = computed(() => {
        return props.messages.filter((message) => message.role === 'user').length
    })

    /** 用户消息列表(轮次 popup 内容) */
    const userMessages = computed(() => {
        return props.messages.filter((message) => message.role === 'user')
    })

    const activeLine = ref(0)
    const popupVisible = ref(false)
    const hoveredLine = ref(0)

    /** 消息摘要(对齐原版 turnIndicator 的文本预览) */
    function messagePreview(message: ChatMessage): string {
        const text = String(message.content || '').replace(/\s+/g, ' ').trim()

        return text.length > 40 ? `${text.slice(0, 40)}...` : text || '(空消息)'
    }

    /** 线条 title(对齐原版:第 N 轮 + 预览) */
    function lineTitle(lineIndex: number): string {
        const message = userMessages.value[lineIndex - 1]

        return `第 ${lineIndex} 轮: ${message ? messagePreview(message) : '(空消息)'}`
    }

    /** hover 显示预览 */
    function showPopup(lineIndex: number): void {
        hoveredLine.value = lineIndex
        popupVisible.value = true
    }

    function hidePopup(): void {
        popupVisible.value = false
    }

    /** 点击跳转到对应轮次(父级滚动) */
    function handleClick(lineIndex: number): void {
        activeLine.value = lineIndex

        emit('jump', lineIndex)
    }
</script>
