<!--
    AdminModelsPanel.vue — 管理员:模型管理(对齐原版 settings-admin-models-tab)

    设计:
      - 复用 AdminPanel 布局:左 Provider 列表 + 右该 Provider 的模型列表
      - 支持供应商/模型的新增、编辑、删除(删除需输入确认文本 确认修改)
      - 搜索过滤 Provider / 模型名 / 状态
      - 弹窗复用 GDDP Modal,删除确认复用 GDDP showPrompt
-->

<template>
    <div class="admin-models-panel">
        <div class="admin-users-toolbar settings-management-toolbar settings-management-toolbar-models">
            <button class="btn-primary" type="button" @click="handleAddProvider">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                <span>添加供应商</span>
            </button>
            <button class="btn-primary" type="button" @click="handleAddModel">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                <span>添加模型</span>
            </button>
            <input v-model="query" class="input-modern model-admin-search" placeholder="筛选:Provider / 模型ID / 名称 / 状态">
        </div>

        <div class="admin-users-layout model-admin-users-layout settings-management-layout">
            <div class="admin-users-list settings-management-list">
                <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
                <div v-else-if="!filteredProviders.length" class="admin-user-detail-empty">暂无供应商</div>
                <div
                    v-for="provider in filteredProviders"
                    :key="provider"
                    class="admin-user-item"
                    :class="{ active: selectedProvider === provider }"
                    role="button"
                    tabindex="0"
                    @click="selectProvider(provider)"
                    @keydown.enter="selectProvider(provider)"
                >
                    <span class="admin-user-name">{{ provider }}</span>
                    <span class="admin-user-meta">{{ modelCountByProvider(provider) }} 个模型</span>
                    <button
                        class="admin-item-delete"
                        type="button"
                        title="删除供应商"
                        @click.stop="requestDeleteProvider(provider)"
                    >
                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            <div class="admin-user-detail settings-management-detail">
                <div v-if="!selectedProvider" class="admin-user-detail-empty">请选择左侧供应商查看模型</div>
                <div v-else>
                    <div class="admin-users-toolbar admin-system-toolbar-row">
                        <h4 style="margin:0;">{{ selectedProvider }}</h4>
                        <button class="btn-primary-outline" type="button" @click="handleEditProvider(selectedProvider)">
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                            <span>编辑供应商</span>
                        </button>
                    </div>
                    <div v-if="!providerModels.length" class="admin-user-detail-empty">该供应商暂无模型</div>
                    <div
                        v-for="model in providerModels"
                        :key="model.id"
                        class="admin-model-row"
                        role="button"
                        tabindex="0"
                        @click="handleEditModel(model)"
                        @keydown.enter="handleEditModel(model)"
                    >
                        <span class="admin-model-name">{{ model.name }}</span>
                        <span class="admin-model-status" :class="`model-status-${normalizeStatus(model.status)}`">
                            {{ statusLabel(model.status) }}
                        </span>
                        <span v-if="model.context_window" class="admin-model-ctx">{{ model.context_window.toLocaleString() }} ctx</span>
                        <button
                            class="admin-item-delete"
                            type="button"
                            title="删除模型"
                            @click.stop="requestDeleteModel(model.id, model.name)"
                        >
                            <i class="fa-solid fa-trash" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 添加/编辑模型弹窗 -->
        <Modal :open="modelFormOpen" :title="editingModel ? '编辑模型' : '添加模型'" size="sm" @close="modelFormOpen = false">
            <div class="form-group">
                <label for="adminModelProvider">供应商</label>
                <select id="adminModelProvider" v-model="modelForm.provider" class="input-modern">
                    <option v-for="provider in providers" :key="provider" :value="provider">{{ provider }}</option>
                </select>
            </div>
            <div class="form-group">
                <label for="adminModelId">模型 ID</label>
                <input id="adminModelId" v-model="modelForm.model_id" class="input-modern" type="text" maxlength="120" placeholder="例如:my-model-v1">
            </div>
            <div class="form-group">
                <label for="adminModelName">名称(可选)</label>
                <input id="adminModelName" v-model="modelForm.name" class="input-modern" type="text" maxlength="120" placeholder="默认同模型 ID">
            </div>
            <div class="form-group">
                <label for="adminModelCtx">Context Window(可选)</label>
                <input id="adminModelCtx" v-model="modelForm.context_window" class="input-modern" type="number" min="0" placeholder="例如:128000">
            </div>
            <div class="form-group">
                <label for="adminModelStatus">状态</label>
                <select id="adminModelStatus" v-model="modelForm.status" class="input-modern">
                    <option value="normal">正常</option>
                    <option value="error">异常</option>
                    <option value="disabled">停用</option>
                </select>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="modelFormOpen = false">取消</button>
                <button class="btn-confirm" type="button" @click="submitModel">{{ editingModel ? '保存' : '添加' }}</button>
            </template>
        </Modal>

        <!-- 添加/编辑供应商弹窗 -->
        <Modal :open="providerFormOpen" :title="editingProvider ? '编辑供应商' : '添加供应商'" size="lg" @close="providerFormOpen = false">
            <div class="form-group">
                <label for="adminProviderName">供应商名称</label>
                <input id="adminProviderName" v-model="providerForm.provider" class="input-modern" type="text" maxlength="80" placeholder="例如:openai">
            </div>
            <div class="form-group">
                <label for="adminProviderType">接口类型</label>
                <select id="adminProviderType" v-model="providerForm.api_type" class="input-modern" @change="syncProviderType">
                    <option value="openai">OpenAI 兼容</option>
                    <option value="azure">Azure</option>
                    <option value="dashscope">DashScope</option>
                    <option value="ollama">Ollama</option>
                </select>
            </div>
            <div class="form-group">
                <label for="adminProviderBaseUrl">Base URL</label>
                <input id="adminProviderBaseUrl" v-model="providerForm.base_url" class="input-modern" type="text" placeholder="https://api.example.com/v1">
            </div>
            <div class="form-group">
                <label for="adminProviderApiKey">API Key</label>
                <input id="adminProviderApiKey" v-model="providerForm.api_key" class="input-modern" type="password" autocomplete="off" placeholder="留空保持不变">
            </div>
            <div class="form-group">
                <label for="adminProviderUserAgent">User-Agent(可选)</label>
                <input id="adminProviderUserAgent" v-model="providerForm.user_agent" class="input-modern" type="text" maxlength="200" placeholder="请求 UA,留空自动">
            </div>
            <div v-if="providerForm.api_type === 'ollama'" class="form-group">
                <label for="adminProviderKeepAlive">Keep-Alive</label>
                <input id="adminProviderKeepAlive" v-model="providerForm.keep_alive" class="input-modern" type="text" maxlength="20" placeholder="例如:5m">
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="providerFormOpen = false">取消</button>
                <button class="btn-confirm" type="button" @click="submitProvider">{{ editingProvider ? '保存' : '添加' }}</button>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { ModelInfo } from '@/api/admin-models'
    import { deleteModel, deleteProvider, fetchModelsConfig, upsertModel, upsertProvider } from '@/api/admin-models'
    import { showError, showToast } from '@/stores/notify'
    import { showPrompt } from '@/stores/confirm'

    import Modal from '@/ui/Modal.vue'

    interface ProviderInfo {
        api_key?: string
        base_url?: string
        api_type?: string
        user_agent?: string
        settings?: Record<string, unknown>
    }

    const loading = ref(false)
    const models = ref<Record<string, ModelInfo>>({})
    const providersRecord = ref<Record<string, ProviderInfo>>({})
    const query = ref('')
    const selectedProvider = ref('')

    /** provider 名列表 */
    const providers = computed(() => Object.keys(providersRecord.value))

    /** 过滤后的 Provider 列表 */
    const filteredProviders = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return providers.value
        }

        return providers.value.filter((provider) => {
            const providerModels = Object.values(models.value).filter((m) => String(m.provider || '') === provider)

            const haystack = [
                provider,
                ...providerModels.map((m) => String(m.name || '')),
                ...providerModels.map((m) => String(m.status || '')),
            ].join(' ').toLowerCase()

            return haystack.includes(keyword)
        })
    })

    /** 选中 provider 的模型列表 */
    const providerModels = computed(() => {
        return Object.entries(models.value)
            .filter(([, info]) => String(info.provider || '') === selectedProvider.value)
            .map(([id, info]) => ({
                id,
                name: String(info.name || id),
                status: String(info.status || ''),
                context_window: Number(info.context_window || 0),
            }))
    })

    onMounted(() => {
        void load()
    })

    /** 拉取模型配置 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const config = await fetchModelsConfig()

            models.value = config.models
            providersRecord.value = config.providers as Record<string, ProviderInfo>

            // 默认选中第一个 provider
            if (providers.value.length && !providers.value.includes(selectedProvider.value)) {
                selectedProvider.value = providers.value[0]
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载模型配置失败')
        } finally {
            loading.value = false
        }
    }

    function selectProvider(provider: string): void {
        selectedProvider.value = provider
    }

    /** 某 provider 的模型数 */
    function modelCountByProvider(provider: string): number {
        return Object.values(models.value).filter((m) => String(m.provider || '') === provider).length
    }

    /** 状态归一化 */
    function normalizeStatus(status: string): string {
        const s = String(status || '').toLowerCase()

        return s === 'normal' || s === 'error' || s === 'disabled' ? s : 'unknown'
    }

    /** 状态中文标签 */
    function statusLabel(status: string): string {
        const s = String(status || '').toLowerCase()

        if (s === 'normal') {
            return '正常'
        }

        if (s === 'error') {
            return '异常'
        }

        if (s === 'disabled') {
            return '停用'
        }

        return '未知'
    }

    /** 删除确认弹窗:必须输入 确认修改 文本(对齐原版 showAdminTextConfirmModal) */
    async function confirmWithText(title: string, label: string): Promise<boolean> {
        const text = await showPrompt({
            title,
            label,
            placeholder: '确认修改',
            confirmText: '确认删除',
        })

        return text?.trim() === '确认修改'
    }

    /** 模型表单状态 */
    const modelFormOpen = ref(false)
    const editingModel = ref('')
    const modelForm = reactive({
        model_id: '',
        name: '',
        provider: '',
        context_window: '',
        status: 'normal',
    })

    /** 打开新增模型弹窗(默认选中当前 provider) */
    function handleAddModel(): void {
        editingModel.value = ''
        modelForm.model_id = ''
        modelForm.name = ''
        modelForm.provider = selectedProvider.value || (providers.value[0] || '')
        modelForm.context_window = ''
        modelForm.status = 'normal'
        modelFormOpen.value = true
    }

    /** 打开编辑模型弹窗 */
    function handleEditModel(model: { id: string; name: string; status: string; context_window: number }): void {
        editingModel.value = model.id
        modelForm.model_id = model.id
        modelForm.name = model.name === model.id ? '' : model.name
        modelForm.provider = selectedProvider.value
        modelForm.context_window = model.context_window ? String(model.context_window) : ''
        modelForm.status = normalizeStatus(model.status) === 'unknown' ? 'normal' : model.status
        modelFormOpen.value = true
    }

    /** 提交新增/编辑模型(对齐原版 admin_upsert_model) */
    async function submitModel(): Promise<void> {
        const modelId = modelForm.model_id.trim()

        if (!modelId || !modelForm.provider) {
            showToast('模型 ID 与供应商不能为空', 'warning')

            return
        }

        try {
            await upsertModel({
                model_id: modelId,
                original_model_id: editingModel.value || undefined,
                name: modelForm.name.trim() || modelId,
                provider: modelForm.provider,
                status: modelForm.status,
                context_window: Number(modelForm.context_window) || 0,
            })

            showToast(editingModel.value ? '模型已保存' : '模型已添加', 'success')
            modelFormOpen.value = false
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 删除模型(需确认文本) */
    async function requestDeleteModel(modelId: string, modelName: string): Promise<void> {
        const ok = await confirmWithText('删除模型', `确定删除模型「${modelName}」?请输入 确认修改 完成删除。`)

        if (!ok) {
            return
        }

        try {
            await deleteModel(modelId, '确认修改')

            showToast('模型已删除', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 供应商表单状态 */
    const providerFormOpen = ref(false)
    const editingProvider = ref('')
    const providerForm = reactive({
        provider: '',
        api_type: 'openai',
        base_url: '',
        api_key: '',
        user_agent: '',
        keep_alive: '5m',
    })

    /** 打开新增供应商弹窗 */
    function handleAddProvider(): void {
        editingProvider.value = ''
        providerForm.provider = ''
        providerForm.api_type = 'openai'
        providerForm.base_url = ''
        providerForm.api_key = ''
        providerForm.user_agent = ''
        providerForm.keep_alive = '5m'
        providerFormOpen.value = true
    }

    /** 打开编辑供应商弹窗 */
    function handleEditProvider(provider: string): void {
        const info = providersRecord.value[provider] || {}

        editingProvider.value = provider
        providerForm.provider = provider
        providerForm.api_type = normalizeProviderType(String(info.api_type || 'openai'))
        providerForm.base_url = String(info.base_url || '')
        providerForm.api_key = ''
        providerForm.user_agent = String(info.user_agent || '')
        providerForm.keep_alive = String((info.settings as Record<string, unknown>)?.keep_alive || '5m')
        providerFormOpen.value = true
    }

    /** 接口类型归一化(仅保留后端认识的值) */
    function normalizeProviderType(raw: string): string {
        const text = String(raw || '').toLowerCase()

        if (text === 'azure' || text === 'dashscope' || text === 'ollama') {
            return text
        }

        return 'openai'
    }

    /** 接口类型改变时归一化(select 的 change 事件回调) */
    function syncProviderType(): void {
        providerForm.api_type = normalizeProviderType(providerForm.api_type)
    }

    /** 提交新增/编辑供应商(对齐原版 admin_upsert_provider) */
    async function submitProvider(): Promise<void> {
        const provider = providerForm.provider.trim()

        if (!provider) {
            showToast('供应商名称不能为空', 'warning')

            return
        }

        try {
            await upsertProvider({
                provider,
                original_provider: editingProvider.value || undefined,
                api_key: providerForm.api_key,
                base_url: providerForm.base_url.trim(),
                api_type: providerForm.api_type,
                user_agent: providerForm.user_agent.trim(),
                settings: providerForm.api_type === 'ollama' ? { keep_alive: providerForm.keep_alive.trim() || '5m' } : {},
            })

            showToast(editingProvider.value ? '供应商已保存' : '供应商已添加', 'success')
            providerFormOpen.value = false
            selectedProvider.value = provider
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 删除供应商(需确认文本;被模型引用时后端会拒绝) */
    async function requestDeleteProvider(provider: string): Promise<void> {
        const ok = await confirmWithText('删除供应商', `确定删除供应商「${provider}」?请输入 确认修改 完成删除。`)

        if (!ok) {
            return
        }

        try {
            await deleteProvider(provider, '确认修改')

            showToast('供应商已删除', 'success')
            selectedProvider.value = ''
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }
</script>