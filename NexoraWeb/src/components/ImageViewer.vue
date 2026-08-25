<!--
    ImageViewer.vue — 全屏图片查看器(对齐原版 chat_image_viewer.js)

    设计:
      - 复用原版全局样式类(.image-viewer-backdrop / -shell / -toolbar / -btn / -viewport / -image)
      - 交互复刻原版:按钮缩放 / 滚轮缩放 / 拖拽平移 / Esc 关闭 / 点击遮罩空白关闭
      - z-index 走令牌 --z-viewer(不硬编码)
-->

<template>
    <Teleport to="body">
        <Transition name="g-modal">
            <div
                v-if="open"
                class="image-viewer-backdrop active"
                @mousedown.self="emit('close')"
            >
                <div class="image-viewer-shell" role="dialog" aria-modal="true" aria-label="图片查看器">
                    <div class="image-viewer-toolbar">
                        <button type="button" class="image-viewer-btn" title="缩小" @click="zoom(1 / 1.2)">−</button>
                        <span class="image-viewer-scale">{{ scalePercent }}</span>
                        <button type="button" class="image-viewer-btn" title="放大" @click="zoom(1.2)">+</button>
                        <button type="button" class="image-viewer-btn" title="重置" @click="resetTransform">重置</button>
                        <button type="button" class="image-viewer-btn close" title="关闭" @click="emit('close')">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div
                        class="image-viewer-viewport"
                        :class="{ dragging }"
                        @wheel.prevent="handleWheel"
                        @pointerdown="handlePointerDown"
                        @pointermove="handlePointerMove"
                        @pointerup="finishDrag"
                        @pointercancel="finishDrag"
                    >
                        <img
                            ref="imageRef"
                            class="image-viewer-image"
                            :src="url"
                            :alt="alt"
                            :style="imageTransform"
                            draggable="false"
                        >
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    const props = defineProps<{
        open: boolean
        url: string
        alt?: string
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    /** 缩放/平移状态(原版 imageViewerState) */
    const scale = ref(1)
    const tx = ref(0)
    const ty = ref(0)
    const dragging = ref(false)
    const dragStartX = ref(0)
    const dragStartY = ref(0)
    const offsetX = ref(0)
    const offsetY = ref(0)

    /** 图片 transform(原版 flushImageViewerTransform 的 translate3d + scale) */
    const imageTransform = computed(() => {
        return {
            transform: `translate3d(${tx.value}px, ${ty.value}px, 0) scale(${scale.value})`,
        }
    })

    /** 缩放百分比标签(原版 updateImageViewerScaleLabel) */
    const scalePercent = computed(() => `${Math.round(scale.value * 100)}%`)

    /** 缩放范围(原版 minScale 0.2 / maxScale 6) */
    const MIN_SCALE = 0.2
    const MAX_SCALE = 6

    /** 打开时重置视图;关闭时清空状态(原版 openImageViewer/closeImageViewer) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                resetTransform()
            } else {
                scale.value = 1
                tx.value = 0
                ty.value = 0
                dragging.value = false
            }
        }
    )

    /** 按系数缩放并夹取到允许范围(原版 clampImageViewerScale + zoomImageViewer) */
    function zoom(factor: number): void {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))

        scale.value = next
    }

    /** 重置缩放与平移(原版 resetImageViewerTransform immediate) */
    function resetTransform(): void {
        scale.value = 1
        tx.value = 0
        ty.value = 0
        dragging.value = false
    }

    /** 滚轮缩放(原版 viewport wheel:上滚放大 1.08) */
    function handleWheel(event: WheelEvent): void {
        if (event.deltaY < 0) {
            zoom(1.08)
        } else {
            zoom(1 / 1.08)
        }
    }

    /** 开始拖拽平移(原版 pointerdown) */
    function handlePointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return
        }

        dragging.value = true
        dragStartX.value = event.clientX - tx.value
        dragStartY.value = event.clientY - ty.value
        offsetX.value = tx.value
        offsetY.value = ty.value
    }

    /** 拖拽中更新平移(原版 pointermove) */
    function handlePointerMove(event: PointerEvent): void {
        if (!dragging.value) {
            return
        }

        tx.value = event.clientX - dragStartX.value
        ty.value = event.clientY - dragStartY.value
    }

    /** 结束拖拽(原版 finishImageViewerDrag) */
    function finishDrag(): void {
        dragging.value = false
    }

    /** 键盘操作(原版 keydown:Esc 关闭,+ 放大,- 缩小,0 重置) */
    function onDocumentKeydown(event: KeyboardEvent): void {
        if (!props.open) {
            return
        }

        if (event.key === 'Escape') {
            emit('close')
        } else if (event.key === '+') {
            zoom(1.2)
        } else if (event.key === '-') {
            zoom(1 / 1.2)
        } else if (event.key === '0') {
            resetTransform()
        }
    }

    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                document.addEventListener('keydown', onDocumentKeydown)
            } else {
                document.removeEventListener('keydown', onDocumentKeydown)
            }
        }
    )

    onBeforeUnmount(() => {
        document.removeEventListener('keydown', onDocumentKeydown)
    })
</script>
