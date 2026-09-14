<!--
    ExaImageGallery.vue — Exa 搜索结果横向图片画廊

    设计:
      - 直接贴在搜索工具行下方，不显示标题、数量或说明文字
      - 只展示图片卡片，横向滚动由 track 自身承载
      - 点击图片复用聊天页现有的全屏图片查看器
-->

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ExaImageGalleryData } from '@/stream/exaMedia'

    const props = defineProps<{
        gallery: ExaImageGalleryData
    }>()

    const emit = defineEmits<{
        'open-image': [url: string]
    }>()

    const failedImages = ref<Record<string, boolean>>({})

    const items = computed(() => props.gallery.items)

    /** 记录单张图片加载失败，保留卡片位置并显示明确状态。 */
    function handleImageError(url: string): void {
        failedImages.value[url] = true
    }

    function isImageFailed(url: string): boolean {
        return failedImages.value[url] === true
    }

    /** 将画廊区域内的普通滚轮转换为横向滚动，边界处把事件交还给消息容器。 */
    function handleWheel(event: WheelEvent): void {
        if (event.ctrlKey) {
            return
        }

        const track = event.currentTarget as HTMLElement | null

        if (!track) {
            return
        }

        const maxScrollLeft = track.scrollWidth - track.clientWidth

        if (maxScrollLeft <= 0) {
            return
        }

        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY

        if (!delta) {
            return
        }

        const nextScrollLeft = Math.max(
            0,
            Math.min(maxScrollLeft, track.scrollLeft + delta),
        )

        if (nextScrollLeft === track.scrollLeft) {
            return
        }

        track.scrollLeft = nextScrollLeft
        event.preventDefault()
    }
</script>

<template>
    <div v-if="items.length" class="exa-image-gallery">
        <div
            class="exa-image-gallery-track"
            role="region"
            :aria-label="gallery.query || '搜索结果图片'"
            @wheel="handleWheel"
        >
            <button
                v-for="item in items"
                :key="item.imageUrl"
                type="button"
                class="exa-image-card"
                :class="{ 'is-failed': isImageFailed(item.imageUrl) }"
                :aria-label="item.title || '打开搜索结果图片'"
                :disabled="isImageFailed(item.imageUrl)"
                @click="emit('open-image', item.imageUrl)"
            >
                <img
                    v-if="!isImageFailed(item.imageUrl)"
                    loading="lazy"
                    decoding="async"
                    :src="item.imageUrl"
                    :alt="item.title || '搜索结果图片'"
                    referrerpolicy="no-referrer"
                    @error="handleImageError(item.imageUrl)"
                >
                <span v-else class="exa-image-card-error">图片无法加载</span>
            </button>
        </div>
    </div>
</template>
