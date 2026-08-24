<!--
    KnowledgeSettingsModal.vue — 知识点设置弹窗(接入原版 knowledgeSettingsModal 内容)

    职责:
      - 复刻原版 4 个设置页:基础信息 / 共享协作 / 向量 / 记录
      - 打开时读取当前知识元数据填充展示(标题 / 公开 / 协作 / 只读 / 最后修改时间 / 分享链接)
      - 具体功能占位:保存设置 / 复制链接 / 更新向量 / 删除向量 仅提示待接入,不调用后端
    样式:GDDP Modal 壳 + scoped 样式,不依赖原版全局 CSS
-->

<template>
    <Modal
        :open="open"
        width="640px"
        modal-class="ks-modal"
        @close="close"
    >
        <template #head>
            <div class="ks-modal-head">
                <h3>知识点设置</h3>
                <p>管理标题、模型访问权限、共享协作和向量状态。</p>
            </div>
        </template>

        <SettingSegmented
            v-model="activeTab"
            :options="tabs"
        />

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
                    <button class="g-btn g-btn-ghost ks-share-copy" type="button" @click="handlePlaceholderAction">复制</button>
                </div>
            </div>
        </div>

        <!-- 向量 -->
        <div v-show="activeTab === 'vector'" class="ks-pane">
            <div class="ks-vector-actions">
                <button class="g-btn g-btn-primary" type="button" @click="handlePlaceholderAction">更新向量</button>
                <button class="g-btn g-btn-primary" type="button" @click="handlePlaceholderAction">删除向量</button>
            </div>
            <div class="ks-vector-tip">向量更新、删除与分块查看功能待接入</div>
            <div class="ks-vector-status">未加载</div>
            <div class="ks-chunk-list">
                <div class="ks-chunk-empty">暂无分块</div>
            </div>
        </div>

        <!-- 记录 -->
        <div v-show="activeTab === 'history'" class="ks-pane">
            <div class="ks-history-row">最后修改: <span>{{ lastModifyText }}</span></div>
        </div>

        <template #footer>
            <button class="g-btn g-btn-ghost" type="button" @click="close">取消</button>
            <button class="g-btn g-btn-primary" type="button" @click="handleSave">保存设置</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { reactive, ref, watch } from 'vue'

    import { fetchKnowledgeContent } from '@/api/knowledge'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import Modal from '@/ui/Modal.vue'
    import SettingSegmented from '@/ui/settings/SettingSegmented.vue'

    const props = defineProps<{
        open: boolean
        title: string
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    const userStore = useUserStore()

    /** 四个设置页(对齐原版 knowledgeSettingsModal 的 tab;复用 GDDP SettingSegmented) */
    const tabs = [
        { value: 'basic', label: '基础信息' },
        { value: 'share', label: '共享协作' },
        { value: 'vector', label: '向量' },
        { value: 'history', label: '记录' },
    ]

    const activeTab = ref('basic')

    /** 弹窗内可编辑的表单状态(仅本地展示,保存功能待接入) */
    const form = reactive({
        title: '',
        public: false,
        collaborative: false,
        modelReadonly: false,
    })

    const shareUrl = ref('')
    const lastModifyText = ref('-')

    /** 打开弹窗:重置为当前知识元数据(仅读取展示) */
    watch(
        () => props.open,
        (opened) => {
            if (!opened) {
                return
            }

            activeTab.value = 'basic'
            form.title = String(props.title || '').trim()
            form.public = false
            form.collaborative = false
            form.modelReadonly = false
            shareUrl.value = ''
            lastModifyText.value = '-'

            void loadMetadata()
        }
    )

    /** 读取当前知识元数据填充表单与分享链接(纯读取,不修改) */
    async function loadMetadata(): Promise<void> {
        const title = String(props.title || '').trim()

        if (!title) {
            return
        }

        try {
            const data = await fetchKnowledgeContent(title)
            const meta = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {}

            form.title = String(meta.title || data.title || title)
            form.public = Boolean(meta.public)
            form.collaborative = Boolean(meta.collaborative)
            form.modelReadonly = meta.model_readonly === true

            const shareId = String(meta.share_id || '').trim()
            const ownerId = userStore.userId

            shareUrl.value = shareId && ownerId
                ? `${window.location.origin}/public/knowledge/${encodeURIComponent(ownerId)}/${encodeURIComponent(shareId)}`
                : ''

            lastModifyText.value = formatUpdateTime(meta.updated_at)
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取知识库设置失败')
        }
    }

    /** 秒级/字符串时间戳统一转为本地时间文本 */
    function formatUpdateTime(raw: unknown): string {
        const ts = Number(raw)

        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts * 1000).toLocaleString()
        }

        const parsed = new Date(String(raw || ''))

        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString()
    }

    /** 保存设置:功能待接入,暂不调用后端 */
    async function handleSave(): Promise<void> {
        showToast('知识库设置保存功能待接入', 'info')
    }

    /** 复制/更新向量/删除向量等未接入操作统一提示 */
    function handlePlaceholderAction(): void {
        showToast('该功能待接入', 'info')
    }

    function close(): void {
        emit('close')
    }
</script>

<style scoped>
    /* ---------- 头部(标题 + 说明) ---------- */

    .ks-modal-head h3 {
        margin: 0;
    }

    .ks-modal-head p {
        margin: 4px 0 0;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    /* ---------- 页签(GDDP SettingSegmented 壳适配) ---------- */

    :deep(.setting-segmented) {
        margin-bottom: 14px;
    }

    /* ---------- 面板 ---------- */

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

    /* ---------- 开关行 ---------- */

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

    /* ---------- 分享链接 ---------- */

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

    /* ---------- 向量 ---------- */

    .ks-vector-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
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
        color: var(--color-text-secondary);
        font-size: 12px;
        overflow-y: auto;
    }

    .ks-chunk-empty {
        color: var(--color-text-secondary);
    }

    /* ---------- 记录 ---------- */

    .ks-history-row {
        padding: 4px 0;
        color: var(--color-text-secondary);
        font-size: 13px;
    }
</style>