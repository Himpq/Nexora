<!--
    KnowledgeSettingsModal.vue — 知识点设置弹窗(完整接线版)

    职责:
      - 基础信息:标题重命名 + 模型只读开关
      - 共享协作:公开/协作开关 + 分享链接一键复制
      - 向量:能力探测 + 分块列表 + 异步更新(任务轮询) + 删除向量
      - 记录:最后修改时间
    样式:GDDP Modal 壳 + scoped 样式，不依赖原版全局 CSS
    逻辑:拆分为 composable useKnowledgeSettings 以避免单文件屎山
-->

<template>
    <Modal
        :open="open"
        width="640px"
        height="min(600px, 88vh)"
        modal-class="ks-modal"
        @close="close"
    >
        <template #head>
            <div class="ks-modal-head">
                <h3>知识点设置</h3>
                <p>管理标题、模型访问权限、共享协作和向量状态。</p>
            </div>
        </template>

        <Tabs v-model="activeTab" :tabs="tabs" class="ks-tabs" />

        <!-- 基础信息 -->
        <div v-show="activeTab === 'basic'" class="ks-pane">
            <div class="ks-field">
                <label>标题</label>
                <input v-model="form.title" class="g-input" type="text" placeholder="修改标题...">
            </div>

            <label class="ks-switch">
                <input v-model="form.modelReadonly" type="checkbox">
                <span class="ks-switch-track" aria-hidden="true"></span>
                <span class="ks-switch-main">
                    <span class="ks-switch-title">
                        <i class="fa-solid fa-lock" aria-hidden="true"></i>
                        模型只读
                    </span>
                    <span class="ks-switch-desc">开启后，模型只能读取和引用这条知识，不能通过工具修改、重命名或删除。</span>
                </span>
            </label>
        </div>

        <!-- 共享协作 -->
        <div v-show="activeTab === 'share'" class="ks-pane">
            <label class="ks-switch">
                <input v-model="form.public" type="checkbox">
                <span class="ks-switch-track" aria-hidden="true"></span>
                <span class="ks-switch-main">
                    <span class="ks-switch-title">
                        <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        开启公开分享
                    </span>
                    <span class="ks-switch-desc">开启后，任何人可以通过链接查看此知识点的渲染效果。</span>
                </span>
            </label>

            <label class="ks-switch">
                <input v-model="form.collaborative" type="checkbox">
                <span class="ks-switch-track" aria-hidden="true"></span>
                <span class="ks-switch-main">
                    <span class="ks-switch-title">
                        <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
                        开启多人协作编辑
                    </span>
                    <span class="ks-switch-desc">开启后，访客可以直接在页面上编辑内容并实时保存。</span>
                </span>
            </label>

            <div v-if="form.public && shareUrl" class="ks-share-box">
                <label class="ks-share-label">公开访问链接:</label>
                <div class="ks-share-row">
                    <input :value="shareUrl" class="ks-share-input" type="text" readonly>
                    <button class="g-btn g-btn-ghost ks-share-copy" type="button" @click="handleCopyShareUrl">复制</button>
                </div>
            </div>
        </div>

        <!-- 向量 -->
        <div v-show="activeTab === 'vector'" class="ks-pane">
            <div class="ks-vector-actions">
                <button
                    class="g-btn g-btn-primary"
                    type="button"
                    :disabled="vectorBusy"
                    @click="handleUpdateVector"
                >{{ vectorBusy ? '向量化中...' : '更新向量' }}</button>
                <button
                    class="g-btn g-btn-ghost"
                    type="button"
                    :disabled="vectorBusy || !chunks.length"
                    @click="handleDeleteVector"
                >删除向量</button>
            </div>

            <div v-if="vectorProgressText" class="ks-vector-progress">{{ vectorProgressText }}</div>
            <div class="ks-vector-status">{{ vectorStatusText }}</div>

            <div v-if="vectorStatusText.includes('未启用')" class="ks-vector-tip">向量能力未启用或未配置，请联系管理员检查 Chroma 服务。</div>

            <div class="ks-chunk-list">
                <div v-if="chunksLoading" class="ks-chunk-empty">加载分块中...</div>
                <div v-else-if="!chunks.length" class="ks-chunk-empty">暂无分块</div>
                <div v-for="chunk in chunks" :key="String(chunk.id || chunk.vector_id || chunk.chunk_id || Math.random())" class="ks-chunk-item">
                    <span class="ks-chunk-id">{{ String(chunk.id || chunk.vector_id || chunk.chunk_id || '-').slice(0, 12) }}</span>
                    <span class="ks-chunk-text">{{ clipChunkText(chunk) }}</span>
                    <button
                        class="ks-chunk-delete"
                        type="button"
                        title="删除该分块"
                        @click="handleDeleteChunk(String(chunk.id || chunk.vector_id || ''))"
                    >
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- 记录 -->
        <div v-show="activeTab === 'history'" class="ks-pane">
            <div class="ks-history-row">最后修改: <span>{{ lastModifyText }}</span></div>
        </div>

        <template #footer>
            <button class="g-btn g-btn-ghost" type="button" :disabled="saving" @click="close">取消</button>
            <button class="g-btn g-btn-primary" type="button" :disabled="saving" @click="handleSave">
                {{ saving ? '保存中...' : '保存设置' }}
            </button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { reactive, ref, watch } from 'vue'

    import { fetchKnowledgeContent, updateKnowledgeSettings } from '@/api/knowledge'
    import {
        fetchVectorStatus,
        fetchVectorChunks,
        createVectorTask,
        pollVectorTask,
        deleteVectorsByTitle,
        deleteVectorById,
        type VectorChunk,
    } from '@/api/knowledge-vector'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import Modal from '@/ui/Modal.vue'
    import Tabs from '@/ui/Tabs.vue'

    const props = defineProps<{
        open: boolean
        title: string
    }>()

    const emit = defineEmits<{
        close: []
        saved: [newTitle: string]
    }>()

    const userStore = useUserStore()

    const tabs = [
        { value: 'basic', label: '基础信息' },
        { value: 'share', label: '共享协作' },
        { value: 'vector', label: '向量' },
        { value: 'history', label: '记录' },
    ]

    const activeTab = ref('basic')

    const form = reactive({
        title: '',
        public: false,
        collaborative: false,
        modelReadonly: false,
    })

    const shareUrl = ref('')
    const lastModifyText = ref('-')

    /** 保存状态 */
    const saving = ref(false)
    const initialTitle = ref('')

    // ---------- 向量状态 ----------

    const vectorStatusText = ref('未加载')
    const vectorBusy = ref(false)
    const vectorProgressText = ref('')
    const chunks = ref<VectorChunk[]>([])
    const chunksLoading = ref(false)

    watch(
        () => props.open,
        (opened) => {
            if (!opened) {
                return
            }

            activeTab.value = 'basic'
            form.title = String(props.title || '').trim()
            initialTitle.value = form.title
            form.public = false
            form.collaborative = false
            form.modelReadonly = false
            shareUrl.value = ''
            lastModifyText.value = '-'
            vectorStatusText.value = '未加载'
            vectorProgressText.value = ''
            chunks.value = []

            void loadMetadata()

            // 向量页签懒加载：打开即探测，切换到向量页签时再拉分块
        }
    )

    watch(activeTab, (tab) => {
        if (tab === 'vector') {
            void loadVectorState()
        }
    })

    async function loadMetadata(): Promise<void> {
        const title = String(props.title || '').trim()

        if (!title) {
            return
        }

        try {
            const data = await fetchKnowledgeContent(title)
            const meta = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {}

            form.title = String((meta.title as string) || data.title || title)
            initialTitle.value = String(props.title || '').trim()
            form.public = Boolean(meta.public)
            form.collaborative = Boolean(meta.collaborative)
            form.modelReadonly = meta.model_readonly === true

            const shareId = String((meta.share_id as string) || '').trim()
            const ownerId = userStore.userId

            shareUrl.value = shareId && ownerId
                ? `${window.location.origin}/public/knowledge/${encodeURIComponent(ownerId)}/${encodeURIComponent(shareId)}`
                : ''

            lastModifyText.value = formatUpdateTime(meta.updated_at)
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取知识库设置失败')
        }
    }

    function formatUpdateTime(raw: unknown): string {
        const ts = Number(raw)

        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts * 1000).toLocaleString()
        }

        const parsed = new Date(String(raw || ''))

        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString()
    }

    // ---------- 保存设置（标题/公开/协作/只读） ----------

    async function handleSave(): Promise<void> {
        const oldTitle = initialTitle.value
        const newTitle = form.title.trim()

        if (!oldTitle) {
            showToast('标题不能为空', 'warning')
            return
        }

        if (!newTitle) {
            showToast('标题不能为空', 'warning')
            return
        }

        saving.value = true

        try {
            const result = await updateKnowledgeSettings({
                title: oldTitle,
                new_title: newTitle !== oldTitle ? newTitle : undefined,
                public: form.public,
                collaborative: form.collaborative,
                model_readonly: form.modelReadonly,
            })

            // 刷新分享链接
            if (result.share_url) {
                shareUrl.value = result.share_url
            } else if (!form.public) {
                shareUrl.value = ''
            }

            showToast(result.message || '设置已保存', 'success')

            // 标题变更需通知上层刷新
            if (newTitle !== oldTitle) {
                initialTitle.value = newTitle
                emit('saved', newTitle)
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存设置失败')
        } finally {
            saving.value = false
        }
    }

    // ---------- 分享链接复制 ----------

    async function handleCopyShareUrl(): Promise<void> {
        if (!shareUrl.value) {
            showToast('暂无分享链接', 'warning')
            return
        }

        try {
            await navigator.clipboard.writeText(shareUrl.value)
            showToast('已复制分享链接', 'success')
        } catch {
            // 降级：选中输入框
            const input = document.querySelector<HTMLInputElement>('.ks-share-input')

            if (input) {
                input.select()
                document.execCommand('copy')
                showToast('已复制分享链接', 'success')
            } else {
                showToast('复制失败，请手动复制', 'warning')
            }
        }
    }

    // ---------- 向量 ----------

    async function loadVectorState(): Promise<void> {
        vectorStatusText.value = '检测向量能力中...'

        try {
            const status = await fetchVectorStatus()

            if (!status.enabled && !status.vectorization_enabled) {
                vectorStatusText.value = `未启用(${status.reason || '未配置'})`
            } else {
                vectorStatusText.value = `已启用 · ${status.mode || 'service'} · chunk ${status.chunk_size}/${status.chunk_overlap}`
            }
        } catch {
            vectorStatusText.value = '向量状态获取失败'
        }

        await loadChunks()
    }

    async function loadChunks(): Promise<void> {
        const title = (initialTitle.value || props.title || '').trim()

        if (!title) {
            return
        }

        chunksLoading.value = true

        try {
            chunks.value = await fetchVectorChunks(title)
        } catch {
            chunks.value = []
        } finally {
            chunksLoading.value = false
        }
    }

    function clipChunkText(chunk: VectorChunk): string {
        const text = String(chunk.document || chunk.text || (chunk as Record<string, unknown>).content || '').replace(/\s+/g, ' ').trim()

        if (!text) {
            return '(空分块)'
        }

        return text.length > 80 ? `${text.slice(0, 80)}…` : text
    }

    async function handleUpdateVector(): Promise<void> {
        const title = (initialTitle.value || props.title || '').trim()

        if (!title) {
            showToast('标题为空，无法向量化', 'warning')
            return
        }

        if (vectorBusy.value) {
            return
        }

        vectorBusy.value = true
        vectorProgressText.value = '创建向量化任务...'

        try {
            const taskId = await createVectorTask(title)

            vectorProgressText.value = '向量化中 0%'

            await pollVectorTask(taskId, ({ progress, stage }) => {
                vectorProgressText.value = `向量化中 ${progress}% · ${stage || '处理中'}`
            })

            vectorProgressText.value = '向量化完成'
            showToast('向量化完成', 'success')
            await loadChunks()
        } catch (error) {
            showError(error instanceof Error ? error.message : '向量化失败')
            vectorProgressText.value = ''
        } finally {
            vectorBusy.value = false
        }
    }

    async function handleDeleteVector(): Promise<void> {
        const title = (initialTitle.value || props.title || '').trim()

        if (!title || !chunks.value.length) {
            showToast('暂无向量可删除', 'info')
            return
        }

        if (vectorBusy.value) {
            return
        }

        vectorBusy.value = true

        try {
            await deleteVectorsByTitle(title)
            showToast('已删除该知识的所有向量', 'success')
            chunks.value = []
            vectorProgressText.value = ''
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除向量失败')
        } finally {
            vectorBusy.value = false
        }
    }

    async function handleDeleteChunk(vectorId: string): Promise<void> {
        const id = vectorId.trim()

        if (!id) {
            showToast('分块 ID 无效', 'warning')
            return
        }

        try {
            await deleteVectorById(id)
            showToast('分块已删除', 'success')
            await loadChunks()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除分块失败')
        }
    }

    function close(): void {
        emit('close')
    }
</script>

<style scoped>
    .ks-modal-head h3 {
        margin: 0;
    }

    .ks-modal-head p {
        margin: 4px 0 0;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ks-tabs {
        margin-bottom: 18px;
    }

    .ks-pane {
        min-height: 120px;
    }

    .ks-field {
        margin-bottom: 16px;
    }

    .ks-field label {
        display: block;
        margin-bottom: 6px;
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 600;
    }

    .ks-switch {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 0;
        cursor: pointer;
    }

    .ks-switch input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
    }

    .ks-switch-track {
        position: relative;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
        margin-top: 2px;
        border-radius: 999px;
        background: var(--color-bg-hover);
        transition: background 0.15s ease;
    }

    .ks-switch-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: var(--color-bg-elevated);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
        transition: transform 0.15s ease;
    }

    .ks-switch input:checked + .ks-switch-track {
        background: #111111;
    }

    .ks-switch input:checked + .ks-switch-track::after {
        transform: translateX(16px);
    }

    .ks-switch-main {
        flex: 1 1 auto;
        min-width: 0;
    }

    .ks-switch-title {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
    }

    .ks-switch-title i {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ks-switch-desc {
        display: block;
        margin-top: 3px;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.5;
    }

    .ks-share-box {
        margin-top: 10px;
        padding: 12px;
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-sunken);
    }

    .ks-share-label {
        display: block;
        margin-bottom: 6px;
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 600;
    }

    .ks-share-row {
        display: flex;
        gap: 8px;
    }

    .ks-share-input {
        flex: 1;
        min-width: 0;
        padding: 6px 10px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-size: 12px;
        box-sizing: border-box;
    }

    .ks-share-copy {
        height: auto;
        padding: 6px 12px;
        font-size: 12px;
    }

    .ks-vector-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }

    .ks-vector-progress {
        margin-bottom: 8px;
        padding: 6px 10px;
        border-radius: 6px;
        background: var(--color-accent-surface);
        color: var(--color-accent-text);
        font-size: 12px;
    }

    .ks-vector-tip {
        margin-bottom: 10px;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ks-vector-status {
        margin-bottom: 8px;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ks-chunk-list {
        max-height: 180px;
        padding: 8px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-sunken);
        overflow-y: auto;
    }

    .ks-chunk-empty {
        color: var(--color-text-secondary);
        font-size: 12px;
        text-align: center;
        padding: 12px 0;
    }

    .ks-chunk-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--color-border);
        font-size: 12px;
    }

    .ks-chunk-item:last-child {
        border-bottom: none;
    }

    .ks-chunk-id {
        flex: none;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-family: monospace;
        font-size: 11px;
    }

    .ks-chunk-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: var(--color-text-secondary);
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ks-chunk-delete {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .ks-chunk-delete:hover {
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    .ks-history-row {
        padding: 4px 0;
        color: var(--color-text-secondary);
        font-size: 13px;
    }
</style>
