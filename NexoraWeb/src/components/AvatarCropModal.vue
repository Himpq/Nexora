<!--
    AvatarCropModal.vue — 头像裁切弹窗(现代 Modal 组件 + 原版裁切布局)

    结构:
      统一 Modal 组件 > avatar-crop-layout(画布+缩放 / 圆形预览)
      底部:重置 / 应用(现代按钮)

    第 0 期实现:图片加载到画布,拖动定位 + 缩放,应用导出 256×256 PNG base64。
-->

<template>
    <Modal
        :open="open"
        title="裁剪头像"
        size="lg"
        @close="emit('close')"
    >
        <div class="avatar-crop-layout">
            <div class="avatar-crop-main">
                <div class="avatar-crop-canvas-wrap">
                    <canvas
                        ref="cropCanvas"
                        class="avatar-crop-canvas"
                        width="320"
                        height="320"
                        @mousedown="startDrag"
                        @mousemove="drag"
                        @mouseup="endDrag"
                        @mouseleave="endDrag"
                        @wheel.prevent="zoom"
                    ></canvas>
                </div>
                <div class="avatar-crop-controls">
                    <label>缩放</label>
                    <input
                        type="range"
                        min="1"
                        max="4"
                        step="0.01"
                        :value="scale"
                        @input="onZoomRange"
                    />
                </div>
            </div>
            <div class="avatar-crop-preview-wrap">
                <div class="avatar-crop-preview-title">圆形预览</div>
                <canvas ref="previewCanvas" class="avatar-crop-preview" width="120" height="120"></canvas>
                <div class="avatar-crop-tip">拖动图片定位,圆形区域将作为头像。</div>
            </div>
        </div>

        <template #footer>
            <button type="button" class="g-btn g-btn-ghost" @click="reset">重置</button>
            <button type="button" class="g-btn g-btn-primary" @click="apply">应用</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'

    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import Modal from '@/ui/Modal.vue'

    const emit = defineEmits<{
        close: []
        saved: []
    }>()

    const props = defineProps<{
        open: boolean
    }>()

    const userStore = useUserStore()

    const cropCanvas = ref<HTMLCanvasElement | null>(null)
    const previewCanvas = ref<HTMLCanvasElement | null>(null)

    const scale = ref(1)
    const offsetX = ref(0)
    const offsetY = ref(0)

    let image: HTMLImageElement | null = null
    let dragging = false
    let lastX = 0
    let lastY = 0
    let pendingFile: File | null = null

    /** 加载用户选择的图片 */
    async function openWithFile(file: File): Promise<void> {
        pendingFile = file

        const url = URL.createObjectURL(file)
        const img = new Image()

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('图片加载失败'))
            img.src = url
        })

        image = img
        scale.value = 1
        offsetX.value = 0
        offsetY.value = 0

        draw()
    }

    /** 绘制画布与圆形预览 */
    function draw(): void {
        const canvas = cropCanvas.value
        const preview = previewCanvas.value

        if (!canvas || !image) {
            return
        }

        const ctx = canvas.getContext('2d')

        if (!ctx) {
            return
        }

        ctx.clearRect(0, 0, 320, 320)
        ctx.save()

        // 圆形裁剪遮罩
        ctx.beginPath()
        ctx.arc(160, 160, 150, 0, Math.PI * 2)
        ctx.clip()

        // 绘制图片:居中 + 缩放 + 偏移
        const size = Math.min(image.width, image.height)
        const sx = (image.width - size) / 2
        const sy = (image.height - size) / 2

        ctx.drawImage(
            image,
            sx, sy, size, size,
            160 - 150 * scale.value + offsetX.value,
            160 - 150 * scale.value + offsetY.value,
            300 * scale.value,
            300 * scale.value,
        )

        ctx.restore()

        // 圆形边框
        ctx.beginPath()
        ctx.arc(160, 160, 150, 0, Math.PI * 2)
        ctx.strokeStyle = '#2080f0'
        ctx.lineWidth = 2
        ctx.stroke()

        // 圆形预览
        if (preview) {
            const pctx = preview.getContext('2d')

            if (pctx) {
                pctx.clearRect(0, 0, 120, 120)
                pctx.save()
                pctx.beginPath()
                pctx.arc(60, 60, 58, 0, Math.PI * 2)
                pctx.clip()
                pctx.drawImage(
                    image,
                    sx, sy, size, size,
                    60 - 56 * scale.value + offsetX.value / 2.5,
                    60 - 56 * scale.value + offsetY.value / 2.5,
                    112 * scale.value,
                    112 * scale.value,
                )
                pctx.restore()
            }
        }
    }

    /** 画布导出 256×256 PNG base64 data URL */
    function exportBase64(): string {
        const canvas = document.createElement('canvas')

        canvas.width = 256
        canvas.height = 256

        const ctx = canvas.getContext('2d')

        if (!ctx || !image) {
            return ''
        }

        ctx.save()
        ctx.beginPath()
        ctx.arc(128, 128, 126, 0, Math.PI * 2)
        ctx.clip()

        const size = Math.min(image.width, image.height)
        const sx = (image.width - size) / 2
        const sy = (image.height - size) / 2

        ctx.drawImage(
            image,
            sx, sy, size, size,
            128 - 120 * scale.value + offsetX.value / 1.25,
            128 - 120 * scale.value + offsetY.value / 1.25,
            240 * scale.value,
            240 * scale.value,
        )

        ctx.restore()

        return canvas.toDataURL('image/png')
    }

    function startDrag(event: MouseEvent): void {
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
    }

    function drag(event: MouseEvent): void {
        if (!dragging) {
            return
        }

        offsetX.value += event.clientX - lastX
        offsetY.value += event.clientY - lastY
        lastX = event.clientX
        lastY = event.clientY

        draw()
    }

    function endDrag(): void {
        dragging = false
    }

    function zoom(event: WheelEvent): void {
        const delta = event.deltaY > 0 ? -0.05 : 0.05

        scale.value = Math.max(1, Math.min(4, scale.value + delta))

        draw()
    }

    function onZoomRange(event: Event): void {
        scale.value = Number((event.target as HTMLInputElement).value)

        draw()
    }

    function reset(): void {
        scale.value = 1
        offsetX.value = 0
        offsetY.value = 0

        draw()
    }

    async function apply(): Promise<void> {
        if (!image) {
            return
        }

        try {
            const avatarBase64 = exportBase64()

            await userStore.uploadAvatar(avatarBase64)

            showToast('头像已更新', 'success')

            emit('saved')
            emit('close')
        } catch (error) {
            showError(error instanceof Error ? error.message : '头像上传失败')
        }
    }

    onMounted(() => {
        if (props.open && pendingFile) {
            void openWithFile(pendingFile)
        }
    })

    defineExpose({ openWithFile })
</script>
