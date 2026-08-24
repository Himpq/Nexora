<script setup lang="ts">
    /**
     * FileUploadDialog.vue — 文件上传 / 在线传输(分享)弹窗(GDDP)
     *
     * 对齐原版 chat_files.js 的 file center 上传弹窗:
     *   - 拖拽/选择文件
     *   - 「直接上传」落到 Files 沙箱
     *   - 「在线传输」创建读取码:发送端保持窗口打开,通过事件轮询感知接收端连接,
     *     再以分片流式推送文件;接收端在 /share?code= 页下载
     */

    import { onBeforeUnmount, ref, watch } from 'vue'

    import { uploadFile } from '@/api/files-center'
    import {
        createLiveTransfer,
        finishLiveTransferUpload,
        heartbeatLiveTransfer,
        LIVE_TRANSFER_CHUNK_SIZE,
        listLiveTransferEvents,
        pushLiveTransferChunk,
        revokeLiveTransfer,
        type LiveTransferEvent,
    } from '@/api/liveTransfer'
    import Modal from '@/ui/Modal.vue'
    import Button from '@/ui/Button.vue'
    import { showError, showToast } from '@/stores/notify'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
        /** 直接上传成功后通知父级刷新列表 */
        uploaded: []
    }>()

    interface SelectedFile {
        file: File
        name: string
        size: number
        type: string
    }

    interface TransferSession {
        downloadId: string
        fileIndex: number
        file: File
        abort: AbortController
        bytesSent: number
        startedAt: number
        speedBps: number
        done: boolean
    }

    interface ProgressRow {
        name: string
        size: number
        bytesSent: number
        speedBps: number
        done: boolean
        startedAt?: number
    }

    const selectedFiles = ref<SelectedFile[]>([])
    const dragging = ref(false)
    const uploading = ref(false)

    const activeCode = ref('')
    const linkUrl = ref('')
    const statusText = ref('')
    const progressList = ref<ProgressRow[]>([])
    const events = ref<LiveTransferEvent[]>([])

    const sessions = ref<Record<string, TransferSession>>({})
    const lastEventId = ref(0)
    const heartbeatTimer = ref<number | null>(null)
    const eventTimer = ref<number | null>(null)
    const fileInputRef = ref<HTMLInputElement | null>(null)

    const hasActiveTransfer = () => Boolean(activeCode.value)

    /** 弹窗打开时重置(每次进入都从干净状态开始) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                resetState()
            } else {
                void teardownTransfer()
            }
        },
    )

    onBeforeUnmount(() => {
        void teardownTransfer()
    })

    function resetState(): void {
        selectedFiles.value = []
        dragging.value = false
        uploading.value = false
        activeCode.value = ''
        linkUrl.value = ''
        statusText.value = ''
        progressList.value = []
        events.value = []
        sessions.value = {}
        lastEventId.value = 0
        stopTimers()
    }

    /* ---------- 文件选择 ---------- */

    function openPicker(): void {
        fileInputRef.value?.click()
    }

    function handleInputChange(event: Event): void {
        const input = event.target as HTMLInputElement
        const list = Array.from(input.files || [])

        input.value = ''
        addFiles(list)
    }

    function handleDrop(event: DragEvent): void {
        event.preventDefault()
        dragging.value = false

        const list = Array.from(event.dataTransfer?.files || [])

        addFiles(list)
    }

    function addFiles(list: File[]): void {
        if (!list.length) {
            return
        }

        selectedFiles.value = [
            ...selectedFiles.value,
            ...list.map((file) => ({
                file,
                name: file.name || '未命名文件',
                size: Number(file.size || 0),
                type: file.type || 'application/octet-stream',
            })),
        ]
    }

    function removeSelected(index: number): void {
        selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
    }

    /* ---------- 直接上传 ---------- */

    async function directUpload(): Promise<void> {
        if (!selectedFiles.value.length || uploading.value) {
            return
        }

        uploading.value = true

        try {
            for (const item of selectedFiles.value) {
                await uploadFile(item.file, '', () => {})
            }

            showToast('文件已上传', 'success')
            emit('uploaded')
            emit('close')
        } catch (error) {
            showError(error instanceof Error ? error.message : '上传失败')
        } finally {
            uploading.value = false
        }
    }

    /* ---------- 在线传输(分享) ---------- */

    async function createTransfer(): Promise<void> {
        if (!selectedFiles.value.length || uploading.value) {
            return
        }

        uploading.value = true
        setStatus('正在创建在线传输...')

        try {
            const meta = selectedFiles.value.map((item) => ({
                file_name: item.name,
                file_size: item.size,
                mime_type: item.type,
            }))

            const result = await createLiveTransfer(meta)

            activeCode.value = String(result.transfer.code || '').trim()

            if (!activeCode.value) {
                throw new Error('后端未返回读取码')
            }

            linkUrl.value = `${window.location.origin}/share?code=${encodeURIComponent(activeCode.value)}`
            progressList.value = selectedFiles.value.map((item) => ({
                name: item.name,
                size: item.size,
                bytesSent: 0,
                speedBps: 0,
                done: false,
            }))

            setStatus('在线传输已开启,等待接收端打开链接。')

            startTimers()
            bindBeforeUnload()
        } catch (error) {
            setStatus(String((error as Error)?.message || '创建在线传输失败'))
            showError(error instanceof Error ? error.message : '创建在线传输失败')
        } finally {
            uploading.value = false
        }
    }

    /* ---------- 心跳 + 事件轮询 ---------- */

    function startTimers(): void {
        stopTimers()
        void sendHeartbeat()
        void pollEvents()
        heartbeatTimer.value = window.setInterval(() => void sendHeartbeat(), 5000)
        eventTimer.value = window.setInterval(() => void pollEvents(), 2000)
    }

    function stopTimers(): void {
        if (heartbeatTimer.value !== null) {
            window.clearInterval(heartbeatTimer.value)
            heartbeatTimer.value = null
        }

        if (eventTimer.value !== null) {
            window.clearInterval(eventTimer.value)
            eventTimer.value = null
        }
    }

    async function sendHeartbeat(): Promise<void> {
        const code = activeCode.value

        if (!code) {
            return
        }

        try {
            await heartbeatLiveTransfer(code)
        } catch (error) {
            setStatus(String((error as Error)?.message || '在线传输已失效'))
            stopTimers()
        }
    }

    async function pollEvents(): Promise<void> {
        const code = activeCode.value

        if (!code) {
            return
        }

        try {
            const data = await listLiveTransferEvents(code, lastEventId.value)

            for (const event of data.events || []) {
                lastEventId.value = Math.max(lastEventId.value, Number(event.id || 0))
                handleEvent(event)
            }
        } catch {
            // 瞬时错误忽略,下一个周期重试
        }
    }

    function handleEvent(event: LiveTransferEvent): void {
        events.value = [...events.value, event].slice(-20)

        const type = String(event.type || '').trim()
        const downloadId = String(event.download_id || '').trim()
        const fileIndex = Math.max(0, Number(event.file_index || 0))

        if (type === 'download_request') {
            if (selectedFiles.value.length > 1 && event.message) {
                setStatus(`接收端已连接：${event.message}`)
            } else {
                setStatus('接收端已连接,正在在线传输...')
            }

            if (downloadId) {
                void streamFile(downloadId, fileIndex).catch((error) => {
                    const message = String((error as Error)?.message || '在线传输失败')

                    setStatus(message)
                    showToast(message)
                })
            }
        } else if (type === 'download_complete' || type === 'download') {
            markDone(fileIndex)
            setStatus('接收端已完成下载。')
        } else if (type === 'download_aborted') {
            setStatus(String(event.message || '接收端已断开'))
        } else if (type === 'download_failed') {
            setStatus(String(event.message || '在线传输失败'))
        }
    }

    /* ---------- 分片流式推送 ---------- */

    async function streamFile(downloadId: string, fileIndex: number): Promise<void> {
        const code = activeCode.value
        const file = selectedFiles.value[fileIndex]?.file

        if (!code || !file) {
            return
        }

        // 同文件的新连接接管:中止旧会话循环,从分片 0 重推
        for (const id of Object.keys(sessions.value)) {
            if (sessions.value[id].fileIndex === fileIndex && id !== downloadId) {
                sessions.value[id].abort.abort()
                delete sessions.value[id]
            }
        }

        if (sessions.value[downloadId]) {
            return
        }

        const abort = new AbortController()
        const session: TransferSession = {
            downloadId,
            fileIndex,
            file,
            abort,
            bytesSent: 0,
            startedAt: 0,
            speedBps: 0,
            done: false,
        }

        sessions.value = { ...sessions.value, [downloadId]: session }

        try {
            let offset = 0
            let chunkIndex = 0

            while (offset < file.size && !abort.signal.aborted) {
                const nextOffset = Math.min(offset + LIVE_TRANSFER_CHUNK_SIZE, file.size)
                const chunk = file.slice(offset, nextOffset)

                await pushLiveTransferChunk(code, downloadId, chunkIndex, chunk)

                offset = nextOffset
                chunkIndex += 1
                updateProgress(fileIndex, offset)
            }

            if (abort.signal.aborted) {
                return
            }

            await finishLiveTransferUpload(code, downloadId, file.size)
            markDone(fileIndex)
            setStatus('文件已发送,等待接收端保存完成。')
        } catch (error) {
            if (abort.signal.aborted) {
                return
            }

            delete sessions.value[downloadId]
            throw error
        }
    }

    function updateProgress(fileIndex: number, bytesSent: number): void {
        const now = performance.now()
        const row = progressList.value[fileIndex]

        if (!row) {
            return
        }

        const startedAt = row.startedAt || now
        const elapsed = Math.max(0.001, (now - startedAt) / 1000)
        const speedBps = bytesSent / elapsed

        progressList.value = progressList.value.map((item, i) =>
            i === fileIndex
                ? { ...item, bytesSent, speedBps, startedAt }
                : item,
        )
    }

    function markDone(fileIndex: number): void {
        progressList.value = progressList.value.map((item, i) =>
            i === fileIndex ? { ...item, bytesSent: item.size, speedBps: 0, done: true } : item,
        )
    }

    /* ---------- 收尾 ---------- */

    async function teardownTransfer(): Promise<void> {
        stopTimers()
        unbindBeforeUnload()

        const code = activeCode.value

        activeCode.value = ''

        if (code) {
            for (const id of Object.keys(sessions.value)) {
                sessions.value[id].abort.abort()
            }

            sessions.value = {}

            try {
                await revokeLiveTransfer(code)
            } catch {
                // 关闭时撤销失败可忽略
            }
        }
    }

    async function handleClose(): Promise<void> {
        await teardownTransfer()
        resetState()
        emit('close')
    }

    function copyLink(): void {
        const url = linkUrl.value

        if (!url) {
            return
        }

        navigator.clipboard?.writeText(url).then(
            () => showToast('下载地址已复制', 'success'),
            () => showToast('复制失败,请手动选择复制', 'warning'),
        )
    }

    function setStatus(text: string): void {
        statusText.value = text
    }

    /* ---------- 工具 ---------- */

    function formatFileSize(bytes: number): string {
        const size = Number(bytes || 0)

        if (!Number.isFinite(size) || size <= 0) {
            return '0 B'
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB']
        let value = size
        let index = 0

        while (value >= 1024 && index < units.length - 1) {
            value = value / 1024
            index += 1
        }

        const digits = value >= 100 || index === 0 ? 0 : 1

        return `${value.toFixed(digits)} ${units[index]}`
    }

    function formatByteRate(bytesPerSecond: number): string {
        const rate = Number(bytesPerSecond || 0)

        if (rate <= 0) {
            return '0 B/s'
        }

        return `${formatFileSize(rate)}/s`
    }

    function bindBeforeUnload(): void {
        if (!beforeUnloadBound) {
            beforeUnloadBound = true
            window.addEventListener('beforeunload', beforeUnloadHandler)
        }
    }

    function unbindBeforeUnload(): void {
        if (beforeUnloadBound) {
            beforeUnloadBound = false
            window.removeEventListener('beforeunload', beforeUnloadHandler)
        }
    }

    function beforeUnloadHandler(): void {
        if (hasActiveTransfer()) {
            void revokeLiveTransfer(activeCode.value)
        }
    }

    /** 全局 beforeunload 仅绑定一次,避免重复注册 */
    let beforeUnloadBound = false
</script>

<template>
    <Modal
        :open="open"
        title="上传文件"
        modal-class="file-upload-dialog"
        width="880px"
        @close="handleClose"
    >
        <div class="fud-body">
            <div class="fud-left">
                <div
                    class="fud-dropzone"
                    :class="{ 'is-drag': dragging }"
                    tabindex="0"
                    role="button"
                    aria-label="选择或拖拽文件"
                    @click="openPicker"
                    @keydown.enter.prevent="openPicker"
                    @keydown.space.prevent="openPicker"
                    @dragover.prevent="dragging = true"
                    @dragleave.prevent="dragging = false"
                    @drop="handleDrop"
                >
                    <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                    <strong>拖拽文件到这里</strong>
                    <span>或点击打开文件选择窗口</span>
                </div>

                <ul v-if="selectedFiles.length" class="fud-selected">
                    <li v-for="(item, index) in selectedFiles" :key="index" class="fud-selected-row">
                        <span class="fud-selected-name" :title="item.name">{{ item.name }}</span>
                        <span class="fud-selected-size">{{ formatFileSize(item.size) }}</span>
                        <button
                            class="fud-selected-remove"
                            type="button"
                            title="移除"
                            aria-label="移除"
                            :disabled="uploading"
                            @click="removeSelected(index)"
                        >
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </li>
                </ul>
            </div>

            <aside class="fud-right">
                <div class="fud-actions">
                    <Button
                        variant="primary"
                        :disabled="!selectedFiles.length || uploading"
                        @click="directUpload"
                    >
                        <i class="fa-solid fa-upload" aria-hidden="true"></i>
                        直接上传
                    </Button>
                    <Button
                        variant="secondary"
                        :disabled="!selectedFiles.length || uploading"
                        @click="createTransfer"
                    >
                        <i class="fa-solid fa-link" aria-hidden="true"></i>
                        在线传输
                    </Button>
                </div>

                <div v-if="activeCode" class="fud-live-panel">
                    <div class="fud-live-status">{{ statusText || '等待创建传输链接' }}</div>

                    <div v-if="linkUrl" class="fud-live-link-row">
                        <input :value="linkUrl" type="text" readonly aria-label="下载地址">
                        <button class="fud-live-copy" type="button" title="复制下载地址" aria-label="复制下载地址" @click="copyLink">
                            <i class="fa-regular fa-copy" aria-hidden="true"></i>
                        </button>
                    </div>

                    <div v-if="activeCode" class="fud-live-code">读取码：{{ activeCode }}</div>

                    <div class="fud-live-progress-list">
                        <div v-for="(row, index) in progressList" :key="index" class="fud-live-progress-row">
                            <div class="fud-live-progress-head">
                                <span class="fud-live-progress-name" :title="row.name">{{ row.name }}</span>
                                <span class="fud-live-progress-state">{{ row.done ? '传输完成' : formatByteRate(row.speedBps) }}</span>
                            </div>
                            <div class="fud-live-progress-bar">
                                <div
                                    class="fud-live-progress-fill"
                                    :style="{ width: `${row.size > 0 ? Math.min(100, (row.bytesSent / row.size) * 100) : (row.done ? 100 : 0)}%` }"
                                ></div>
                            </div>
                            <div class="fud-live-progress-bytes">{{ formatFileSize(row.bytesSent) }} / {{ formatFileSize(row.size) }}</div>
                        </div>
                    </div>

                    <div v-if="events.length" class="fud-live-events">
                        <div v-for="(event, index) in events" :key="index" class="fud-live-event">
                            {{ event.type === 'download_request' ? '接收端已连接' : event.type === 'download_complete' || event.type === 'download' ? '接收完成' : event.type === 'download_aborted' ? '接收端已断开' : event.type === 'download_failed' ? '传输失败' : '传输事件' }}
                        </div>
                    </div>
                </div>
            </aside>
        </div>

        <input
            ref="fileInputRef"
            type="file"
            multiple
            hidden
            @change="handleInputChange"
        >
    </Modal>
</template>

<style scoped>
    .fud-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 18px;
        min-height: 360px;
    }

    .fud-left {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .fud-right {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    @media (max-width: 720px) {
        .fud-body {
            grid-template-columns: 1fr;
        }

        .fud-dropzone {
            min-height: 220px;
        }
    }

    .fud-dropzone {
        min-height: 320px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        border: 1px dashed #94a3b8;
        border-radius: 8px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        text-align: center;
        cursor: pointer;
        outline: none;
        transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }

    .fud-dropzone:hover,
    .fud-dropzone:focus-visible,
    .fud-dropzone.is-drag {
        border-color: var(--color-text-primary);
        background: var(--color-bg-elevated);
        box-shadow: inset 0 0 0 1px #111827;
    }

    .fud-dropzone i {
        font-size: 34px;
        color: var(--color-text-primary);
    }

    .fud-dropzone strong {
        font-size: 16px;
        color: var(--color-text-primary);
        line-height: 1.3;
    }

    .fud-dropzone span {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .fud-selected {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 180px;
        overflow-y: auto;
    }

    .fud-selected-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: 9px;
        background: var(--color-bg-elevated);
    }

    .fud-selected-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .fud-selected-size {
        font-size: 12px;
        color: var(--color-text-secondary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
        flex: 0 0 auto;
    }

    .fud-selected-remove {
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        border: none;
        background: transparent;
        color: var(--color-text-secondary);
        border-radius: 6px;
        cursor: pointer;
    }

    .fud-selected-remove:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
    }

    .fud-actions {
        display: flex;
        gap: 10px;
    }

    .fud-actions :deep(.gddp-button) {
        flex: 1;
    }

    .fud-live-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-bg-sunken);
    }

    .fud-live-status {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .fud-live-link-row {
        display: flex;
        gap: 8px;
    }

    .fud-live-link-row input {
        flex: 1;
        min-width: 0;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
        font-size: 12px;
        outline: none;
    }

    .fud-live-copy {
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        border: 1px solid #111827;
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .fud-live-copy:hover {
        background: #111827;
        color: #fff;
    }

    .fud-live-code {
        font-size: 12px;
        color: var(--color-text-secondary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
    }

    .fud-live-progress-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .fud-live-progress-head {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        margin-bottom: 4px;
    }

    .fud-live-progress-name {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--color-text-secondary);
    }

    .fud-live-progress-state {
        color: var(--color-text-secondary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
        flex: 0 0 auto;
    }

    .fud-live-progress-bar {
        height: 6px;
        border-radius: 999px;
        background: var(--color-bg-hover);
        overflow: hidden;
    }

    .fud-live-progress-fill {
        height: 100%;
        background: #4f46e5;
        transition: width 0.2s ease;
    }

    .fud-live-progress-bytes {
        margin-top: 3px;
        font-size: 11px;
        color: var(--color-text-secondary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
    }

    .fud-live-events {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 120px;
        overflow-y: auto;
    }

    .fud-live-event {
        font-size: 12px;
        color: var(--color-text-secondary);
        padding: 4px 8px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 6px;
    }
</style>
