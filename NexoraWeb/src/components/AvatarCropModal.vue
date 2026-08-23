<!--
    AvatarCropModal.vue — 头像裁切弹窗(对齐原版 chat_avatar.js)

    结构:
      统一 Modal 组件 > avatar-crop-layout(画布+缩放+重置 / 圆形预览)
      底部:取消 / 重置 / 应用(应用仅暂存,不立即上传)

    对齐原版:
      - 应用 = crop-stash:导出**方形**图(圆形仅用于定位预览),emit cropped 交给父级,
        由「保存资料」统一 PUT avatar_base64(原版 pendingAvatarDataUrl 机制)
      - 画布双击重置位置(dblclick → resetAvatarCropPosition)
      - 缩放 100% ~ 250%(原版 zoomInput 范围)
-->

<template>
    <Modal
        :open="open"
        title="裁剪头像"
        size="lg"
        @close="emit('close')"
    >
        <div class="ac-layout">
            <div class="ac-main">
                <div class="ac-canvas-wrap">
                    <canvas
                        ref="cropCanvas"
                        class="ac-canvas"
                        width="320"
                        height="320"
                        @pointerdown="startDrag"
                        @pointermove="drag"
                        @pointerup="endDrag"
                        @pointercancel="endDrag"
                        @pointerleave="endDrag"
                        @dblclick="reset"
                        @wheel.prevent="onWheelZoom"
                    ></canvas>
                </div>
                <div class="ac-controls">
                    <label for="avatarCropZoom">缩放</label>
                    <input
                        id="avatarCropZoom"
                        type="range"
                        min="100"
                        max="250"
                        step="1"
                        :value="Math.round(zoom * 100)"
                        @input="onZoomRange"
                    />
                    <button class="btn-primary-outline btn-compact ac-reset" type="button" @click="reset">重置</button>
                </div>
            </div>
            <div class="ac-preview-wrap">
                <div class="ac-preview-title">圆形预览</div>
                <canvas ref="previewCanvas" class="ac-preview" width="120" height="120"></canvas>
                <div class="ac-tip">拖动图片定位,双击画布可重置位置。</div>
            </div>
        </div>

        <template #footer>
            <button type="button" class="g-btn g-btn-ghost" @click="emit('close')">取消</button>
            <button type="button" class="g-btn g-btn-ghost" @click="reset">重置</button>
            <button type="button" class="g-btn g-btn-primary" :disabled="!image" @click="apply">应用</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'

    import Modal from '@/ui/Modal.vue'

    const emit = defineEmits<{
        close: []
        /** 裁切暂存(原版 applyAvatarCropAndPreview:导出方形 base64,由父级「保存资料」统一上传) */
        cropped: [avatarBase64: string]
    }>()

    const props = defineProps<{
        open: boolean
    }>()

    const cropCanvas = ref<HTMLCanvasElement | null>(null)
    const previewCanvas = ref<HTMLCanvasElement | null>(null)

    /** 缩放(1 = 100%,对齐原版 zoom = input / 100) */
    const zoom = ref(1)
    const offsetX = ref(0)
    const offsetY = ref(0)

    let image: HTMLImageElement | null = null
    let dragging = false
    let lastX = 0
    let lastY = 0
    let pendingFile: File | null = null

    /** 加载用户选择的图片(对齐原版 openAvatarCropModal FileReader 流程) */
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
        zoom.value = 1
        offsetX.value = 0
        offsetY.value = 0

        draw()
    }

    /** 绘制画布与圆形预览(对齐原版 drawAvatarCropCanvas + drawAvatarPreviewCanvas) */
    function draw(): void {
        const canvas = cropCanvas.value

        if (!canvas || !image) {
            return
        }

        const ctx = canvas.getContext('2d')

        if (!ctx) {
            return
        }

        const circleR = 150
        const scale = Math.max(circleR * 2 / image.width, circleR * 2 / image.height) * zoom.value
        const drawWidth = image.width * scale
        const drawHeight = image.height * scale
        const drawX = (320 - drawWidth) / 2 + clampOffsetX(drawWidth, 160, circleR)
        const drawY = (320 - drawHeight) / 2 + clampOffsetY(drawHeight, 160, circleR)

        ctx.clearRect(0, 0, 320, 320)

        // 图片主体
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)

        // 遮罩:圆形外压暗(对齐原版 evenodd 填充)
        ctx.save()
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)'
        ctx.beginPath()
        ctx.rect(0, 0, 320, 320)
        ctx.arc(160, 160, circleR, 0, Math.PI * 2, true)
        ctx.fill('evenodd')
        ctx.restore()

        // 圆形边框(白 + 蓝双圈,对齐原版)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(160, 160, circleR + 1, 0, Math.PI * 2)
        ctx.stroke()

        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(160, 160, circleR, 0, Math.PI * 2)
        ctx.stroke()

        drawPreview(drawX, drawY, drawWidth, drawHeight)
    }

    /** 圆形预览(对齐原版 getAvatarCircleSourceRect + drawAvatarPreviewCanvas) */
    function drawPreview(drawX: number, drawY: number, drawWidth: number, drawHeight: number): void {
        const preview = previewCanvas.value

        if (!preview || !image) {
            return
        }

        const pctx = preview.getContext('2d')

        if (!pctx) {
            return
        }

        const circleR = 150
        const sx = Math.max(0, ((160 - circleR - drawX) / drawWidth) * image.width)
        const sy = Math.max(0, ((160 - circleR - drawY) / drawHeight) * image.height)
        const sw = Math.min(image.width - sx, ((circleR * 2) / drawWidth) * image.width)
        const sh = Math.min(image.height - sy, ((circleR * 2) / drawHeight) * image.height)

        pctx.clearRect(0, 0, 120, 120)
        pctx.save()
        pctx.beginPath()
        pctx.arc(60, 60, 58, 0, Math.PI * 2)
        pctx.clip()
        pctx.drawImage(image, sx, sy, sw, sh, 0, 0, 120, 120)
        pctx.restore()
    }

    /** 导出 512×512 方形 PNG(原版上传保持方形,圆形仅用于定位预览) */
    function exportBase64(): string {
        if (!image) {
            return ''
        }

        const circleR = 150
        const scale = Math.max(circleR * 2 / image.width, circleR * 2 / image.height) * zoom.value
        const drawWidth = image.width * scale
        const drawHeight = image.height * scale
        const drawX = (320 - drawWidth) / 2 + clampOffsetX(drawWidth, 160, circleR)
        const drawY = (320 - drawHeight) / 2 + clampOffsetY(drawHeight, 160, circleR)

        const sx = Math.max(0, ((160 - circleR - drawX) / drawWidth) * image.width)
        const sy = Math.max(0, ((160 - circleR - drawY) / drawHeight) * image.height)
        const sw = Math.min(image.width - sx, ((circleR * 2) / drawWidth) * image.width)
        const sh = Math.min(image.height - sy, ((circleR * 2) / drawHeight) * image.height)

        const canvas = document.createElement('canvas')

        canvas.width = 512
        canvas.height = 512

        const ctx = canvas.getContext('2d')

        if (!ctx) {
            return ''
        }

        ctx.clearRect(0, 0, 512, 512)
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 512, 512)

        return canvas.toDataURL('image/png')
    }

    /** X 方向偏移夹取(对齐原版 clampAvatarCropOffset,保证圆形始终被图片覆盖) */
    function clampOffsetX(drawWidth: number, circleX: number, circleR: number): number {
        const centeredX = (320 - drawWidth) / 2
        const minX = circleX + circleR - drawWidth - centeredX
        const maxX = circleX - circleR - centeredX

        return Math.max(minX, Math.min(maxX, offsetX.value))
    }

    /** Y 方向偏移夹取 */
    function clampOffsetY(drawHeight: number, circleY: number, circleR: number): number {
        const centeredY = (320 - drawHeight) / 2
        const minY = circleY + circleR - drawHeight - centeredY
        const maxY = circleY - circleR - centeredY

        return Math.max(minY, Math.min(maxY, offsetY.value))
    }

    function startDrag(event: PointerEvent): void {
        if (event.button !== 0) {
            return
        }

        dragging = true
        lastX = event.clientX
        lastY = event.clientY
    }

    function drag(event: PointerEvent): void {
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

    function onWheelZoom(event: WheelEvent): void {
        const current = Math.round(zoom.value * 100)
        const delta = event.deltaY < 0 ? 8 : -8
        const next = Math.max(100, Math.min(250, current + delta))

        zoom.value = next / 100

        draw()
    }

    function onZoomRange(event: Event): void {
        zoom.value = Number((event.target as HTMLInputElement).value) / 100

        draw()
    }

    /** 重置位置与缩放(对齐原版 resetAvatarCropPosition;双击画布也会触发) */
    function reset(): void {
        zoom.value = 1
        offsetX.value = 0
        offsetY.value = 0

        draw()
    }

    /** 应用:导出方形 base64 并 emit cropped(暂存,不直接上传,对齐原版 pendingAvatarDataUrl) */
    function apply(): void {
        if (!image) {
            return
        }

        const avatarBase64 = exportBase64()

        if (!avatarBase64) {
            return
        }

        emit('cropped', avatarBase64)
        emit('close')
    }

    onMounted(() => {
        if (props.open && pendingFile) {
            void openWithFile(pendingFile)
        }
    })

    defineExpose({ openWithFile })
</script>

<style scoped>
    /* 裁切区整体:画布列 + 预览列 */
    .ac-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 200px;
        gap: 16px;
        align-items: stretch;
        min-height: 360px;
    }

    /* 画布列:画布区 + 控制条 */
    .ac-main {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 12px;
    }

    .ac-canvas-wrap {
        min-width: 0;
        min-height: 360px;
        overflow: hidden;
        border: 1px solid #d6deea;
        border-radius: 10px;
        background: #9ca3af;
    }

    .ac-canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: grab;
    }

    .ac-controls {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-sunken);
    }

    .ac-controls label {
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
    }

    .ac-controls input[type="range"] {
        width: 100%;
        min-width: 0;
    }

    .ac-reset {
        width: 88px;
        min-width: 88px;
        height: 34px;
    }

    /* 预览列 */
    .ac-preview-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-sunken);
    }

    .ac-preview-title {
        font-size: 12px;
        color: var(--color-text-secondary);
        font-weight: 600;
    }

    .ac-preview {
        width: 140px;
        height: 140px;
        border-radius: 999px;
        border: 1px solid #dbeafe;
        background: var(--color-bg-elevated);
    }

    .ac-tip {
        font-size: 11px;
        color: var(--color-text-secondary);
        line-height: 1.4;
        text-align: center;
    }

    @media (max-width: 560px) {
        .ac-layout {
            grid-template-columns: minmax(0, 1fr);
        }

        .ac-canvas-wrap {
            min-height: 260px;
        }
    }
</style>
