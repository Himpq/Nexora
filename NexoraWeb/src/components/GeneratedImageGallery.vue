<!--
    GeneratedImageGallery.vue — 生图工具结果图片展示

    生图结果独立显示在工具流程行下方，点击图片复用聊天页全屏图片查看器。
-->

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { GeneratedImageGalleryData } from '@/stream/generatedImage'

    const props = defineProps<{
        gallery: GeneratedImageGalleryData
    }>()

    const emit = defineEmits<{
        'open-image': [url: string]
    }>()

    const failedImages = ref<Record<string, boolean>>({})
    const items = computed(() => props.gallery.items)

    /** 记录加载失败的图片，保留位置并给出明确提示。 */
    function handleImageError(url: string): void {
        failedImages.value[url] = true
    }

    function isImageFailed(url: string): boolean {
        return failedImages.value[url] === true
    }
</script>

<template>
    <div v-if="items.length" class="generated-image-gallery">
        <div class="generated-image-gallery-grid" role="region" aria-label="生成图片">
            <button
                v-for="item in items"
                :key="item.imageUrl"
                type="button"
                class="generated-image-card"
                :class="{ 'is-failed': isImageFailed(item.imageUrl) }"
                :aria-label="item.title"
                :disabled="isImageFailed(item.imageUrl)"
                @click="emit('open-image', item.imageUrl)"
            >
                <img
                    v-if="!isImageFailed(item.imageUrl)"
                    loading="lazy"
                    decoding="async"
                    :src="item.imageUrl"
                    :alt="item.title"
                    referrerpolicy="no-referrer"
                    @error="handleImageError(item.imageUrl)"
                >
                <span v-else class="generated-image-card-error">图片无法加载</span>
            </button>
        </div>
    </div>
</template>
