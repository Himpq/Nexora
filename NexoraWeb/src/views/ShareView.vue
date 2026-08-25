<script setup lang="ts">
    /**
     * ShareView.vue — 读取码下载页(GDDP 独立公开页)
     *
     * 职责:
     *   - 公开访问,无需登录(后端 /api/files/transfer/<code> 为公开接口)
     *   - 输入/URL 携带读取码查询传输记录,展示文件信息
     *   - 单文件直接下载,多文件逐条或批量下载
     */

    import { computed, onMounted, ref } from 'vue'
    import { useRoute } from 'vue-router'

    import { buildDownloadUrl, normalizeTransferCode, queryTransfer, type TransferRecord } from '@/api/transfer'

    const route = useRoute()

    const codeInput = ref('')
    const loading = ref(false)
    const loadError = ref('')
    const record = ref<TransferRecord | null>(null)
    const rowStatus = ref<Record<number, string>>({})

    const files = computed<TransferRecord['files']>(() => (record.value ? record.value.files || [] : []))
    const isMulti = computed(() => files.value.length > 1)

    /** 标题文件名:多文件显示数量 */
    const displayName = computed(() => {
        if (!record.value) {
            return ''
        }

        return isMulti.value ? `${files.value.length} 个文件` : record.value.file_name
    })

    /** 展示用总大小(多文件为合计) */
    const displaySize = computed(() => {
        if (!record.value) {
            return ''
        }

        const total = isMulti.value
            ? files.value.reduce((sum, item) => sum + Number(item.size || 0), 0)
            : Number(record.value.size || 0)

        return formatFileSize(total)
    })

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

    function formatUnixTime(seconds: number): string {
        const timestamp = Number(seconds || 0)

        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return '未设置'
        }

        const date = new Date(timestamp * 1000)

        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date)
    }

    function transferTypeText(transfer: TransferRecord): string {
        return String(transfer.transfer_type || '').trim() === 'live' ? '在线传输' : '云文件'
    }

    function setStatus(message: string, isError = false): void {
        loadError.value = isError ? message : ''
    }

    async function handleQuery(): Promise<void> {
        if (loading.value) {
            return
        }

        const code = normalizeTransferCode(codeInput.value)

        if (!code) {
            setStatus('请输入读取码', true)

            return
        }

        loading.value = true
        record.value = null
        rowStatus.value = {}
        setStatus('')

        try {
            record.value = await queryTransfer(code)
            setStatus('')
        } catch (error) {
            setStatus(error instanceof Error ? error.message : '读取文件信息失败', true)
        } finally {
            loading.value = false
        }
    }

    function downloadSingle(): void {
        const code = normalizeTransferCode(codeInput.value)

        if (!code || !record.value) {
            setStatus('请先读取读取码', true)

            return
        }

        window.location.assign(buildDownloadUrl(code, 0))
    }

    function downloadIndex(index: number): void {
        const code = normalizeTransferCode(codeInput.value)

        if (!code) {
            return
        }

        const link = document.createElement('a')
        link.href = buildDownloadUrl(code, index)
        link.download = ''
        document.body.appendChild(link)
        link.click()
        link.remove()

        rowStatus.value = { ...rowStatus.value, [index]: '已触发下载' }
    }

    function downloadAll(): void {
        if (!isMulti.value) {
            return
        }

        files.value.forEach((_, index) => downloadIndex(index))

        setStatus(`已触发 ${files.value.length} 个文件的下载。若浏览器提示“此网站要下载多个文件”，选择“允许”后自动继续。`)
    }

    onMounted(() => {
        const urlCode = route.query.code

        if (typeof urlCode === 'string' && urlCode.trim()) {
            codeInput.value = urlCode.trim()
            void handleQuery()
        }
    })
</script>

<template>
    <div class="share-page">
        <section class="share-panel">
            <div class="share-brand">
                <span class="share-brand-mark">N</span>
                <span class="share-brand-name">Nexora</span>
            </div>

            <header class="share-header">
                <h1>读取码下载</h1>
                <p>输入读取码查看文件信息，确认后开始下载。</p>
            </header>

            <form class="share-code-form" @submit.prevent="handleQuery">
                <label class="share-code-field" for="shareCodeInput">
                    <span>读取码</span>
                    <input
                        id="shareCodeInput"
                        v-model="codeInput"
                        name="code"
                        type="text"
                        inputmode="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="ABCD-EFGH-JKLM"
                        :disabled="loading"
                    />
                </label>

                <button class="share-primary-btn" type="submit" :disabled="loading">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <span>{{ loading ? '读取中…' : '查看文件' }}</span>
                </button>
            </form>

            <div class="share-status" :class="{ 'is-error': !!loadError }" role="status" aria-live="polite">
                {{ loadError }}
            </div>

            <section v-if="record" class="share-file-panel" aria-label="文件信息">
                <div class="share-file-icon">
                    <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
                </div>

                <div class="share-file-main">
                    <h2>{{ displayName }}</h2>
                    <dl class="share-file-meta">
                        <div>
                            <dt>大小</dt>
                            <dd>{{ displaySize }}</dd>
                        </div>
                        <div>
                            <dt>有效期</dt>
                            <dd>{{ formatUnixTime(record.expires_at) }}</dd>
                        </div>
                        <div>
                            <dt>剩余次数</dt>
                            <dd>{{ record.remaining_downloads }} / {{ record.max_downloads }}</dd>
                        </div>
                        <div>
                            <dt>传输方式</dt>
                            <dd>{{ transferTypeText(record) }}</dd>
                        </div>
                    </dl>
                </div>

                <button class="share-download-btn" type="button" :disabled="loading" @click="downloadSingle">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                    <span>下载</span>
                </button>

                <button
                    v-if="isMulti"
                    class="share-download-btn"
                    type="button"
                    :disabled="loading"
                    @click="downloadAll"
                >
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                    <span>下载全部</span>
                </button>

                <div v-if="isMulti" class="share-file-list">
                    <div v-for="(file, index) in files" :key="index" class="share-file-row">
                        <div class="share-file-row-main">
                            <span class="share-file-row-name" :title="file.file_name">{{ file.file_name }}</span>
                            <span class="share-file-row-size">{{ formatFileSize(Number(file.size || 0)) }}</span>
                        </div>
                        <div class="share-file-row-side">
                            <span class="share-file-row-status">{{ rowStatus[index] || '' }}</span>
                            <button class="share-file-row-btn" type="button" @click="downloadIndex(index)">下载</button>
                        </div>
                    </div>
                </div>
            </section>
        </section>
    </div>
</template>

<style scoped>
    .share-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: var(--gddp-page-bg, #f6f7f9);
        font-family: var(--nc-font-sans, 'Inter', sans-serif);
        color: var(--gddp-text, #111);
    }

    .share-panel {
        width: 100%;
        max-width: 460px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        padding: 28px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }

    .share-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
    }

    .share-brand-mark {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        background: #111;
        color: #fff;
        font-weight: 700;
        font-size: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .share-brand-name {
        font-weight: 600;
        font-size: 15px;
        letter-spacing: 0.2px;
    }

    .share-header h1 {
        font-size: 20px;
        font-weight: 600;
        margin: 0 0 6px;
    }

    .share-header p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0 0 18px;
    }

    .share-code-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .share-code-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .share-code-field span {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .share-code-field input {
        height: 42px;
        padding: 0 12px;
        border: 1px solid #d8dde3;
        border-radius: 9px;
        font-size: 15px;
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
        letter-spacing: 1px;
        background: var(--color-bg-elevated);
        outline: none;
        transition: border-color 0.15s ease;
    }

    .share-code-field input:focus {
        border-color: var(--color-text-primary);
    }

    .share-primary-btn {
        height: 42px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        border-radius: 9px;
        font-size: 14px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .share-primary-btn:hover {
        background: #111;
        color: #fff;
    }

    .share-primary-btn:disabled {
        opacity: 0.55;
        cursor: default;
    }

    .share-status {
        min-height: 18px;
        margin-top: 10px;
        font-size: 12px;
        color: var(--color-accent-text);
    }

    .share-status.is-error {
        color: var(--color-danger-text);
    }

    .share-file-panel {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--color-border);
    }

    .share-file-icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        margin-bottom: 12px;
    }

    .share-file-main h2 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 12px;
        word-break: break-all;
    }

    .share-file-meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 16px;
        margin: 0 0 16px;
    }

    .share-file-meta dt {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-bottom: 2px;
    }

    .share-file-meta dd {
        margin: 0;
        font-size: 13px;
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
        color: var(--color-text-primary);
    }

    .share-download-btn {
        width: 100%;
        height: 42px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        border-radius: 9px;
        font-size: 14px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .share-download-btn + .share-download-btn {
        margin-top: 10px;
    }

    .share-download-btn:hover {
        background: #111;
        color: #fff;
    }

    .share-download-btn:disabled {
        opacity: 0.55;
        cursor: default;
    }

    .share-file-list {
        margin-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .share-file-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 9px;
        background: #fbfcfe;
    }

    .share-file-row-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .share-file-row-name {
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .share-file-row-size {
        font-size: 11px;
        color: var(--color-text-secondary);
        font-family: var(--nc-font-mono, 'JetBrains Mono', monospace);
    }

    .share-file-row-side {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .share-file-row-status {
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .share-file-row-btn {
        height: 30px;
        padding: 0 12px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .share-file-row-btn:hover {
        background: #111;
        color: #fff;
    }
</style>
