<template>
    <div ref="viewportRoot" class="chat-messages-viewport">
        <div ref="messagesRoot" id="messagesContainer" class="messages-area" data-tool-stage-scroll>
            <slot />
        </div>

        <div v-if="showScrollToBottom" class="chat-scroll-to-bottom">
            <Button
                class="chat-scroll-to-bottom__button"
                size="icon"
                icon="fa-solid fa-arrow-down"
                aria-label="滚动到底部"
                aria-controls="messagesContainer"
                @click="$emit('scroll-to-bottom')"
            />
            <span class="chat-scroll-to-bottom__tooltip" aria-hidden="true">滚动到底部</span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref } from 'vue'
    import Button from '@/ui/Button.vue'
    import { ChatComposerOverlayLayout } from '@/ui/chatComposerOverlayLayout'
    import '@/styles/chat-scroll-to-bottom.css'
    import '@/styles/chat-composer-overlay.css'

    const props = defineProps<{
        showScrollToBottom: boolean
        followBottom: () => boolean
    }>()

    defineEmits<{
        'scroll-to-bottom': []
    }>()

    const viewportRoot = ref<HTMLDivElement | null>(null)
    const messagesRoot = ref<HTMLDivElement | null>(null)
    let composerLayout: ChatComposerOverlayLayout | null = null

    onMounted(() => {
        composerLayout = new ChatComposerOverlayLayout(
            viewportRoot.value!.parentElement!,
            messagesRoot.value!,
            () => props.followBottom(),
        )
    })

    onBeforeUnmount(() => composerLayout?.destroy())
</script>
