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
        <div class="admin-users-layout model-admin-users-layout settings-management-layout" :class="{ 'show-detail': detailOpen }">
            <div class="admin-users-list settings-management-list">
                <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
                <div v-else-if="!filteredProviders.length" class="admin-user-detail-empty">暂无供应商</div>
                <div
                    v-for="provider in filteredProviders"
                    :key="provider"
                    class="admin-user-item model-provider-item"
                    :class="{ active: selectedProvider === provider }"
                    data-role="model-provider-item"
                    role="button"
                    tabindex="0"
                    @click="selectProvider(provider)"
                    @keydown.enter="selectProvider(provider)"
                >
                    <span class="provider-icon">
                        <img v-if="providerIconUrl(provider)" :src="providerIconUrl(provider)" alt="">
                        <template v-else>{{ providerIconFallback(provider) }}</template>
                    </span>
                    <span class="admin-user-main">
                        <span class="admin-user-name">{{ provider }}</span>
                        <span class="admin-user-meta">{{ modelCountByProvider(provider) }} 个模型 · {{ providerApiType(provider) }}</span>
                    </span>
                    <span class="model-provider-item-actions">
                        <button
                            class="model-icon-btn"
                            type="button"
                            title="编辑供应商"
                            @click.stop="handleEditProvider(provider)"
                        >
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                        </button>
                        <button
                            class="model-icon-btn model-icon-btn-danger"
                            type="button"
                            title="删除供应商"
                            @click.stop="requestDeleteProvider(provider)"
                        >
                            <i class="fa-solid fa-trash" aria-hidden="true"></i>
                        </button>
                    </span>
                </div>
            </div>

            <div class="admin-user-detail settings-management-detail">
                <!-- 手机端返回条(桌面端由 CSS 隐藏) -->
                <button type="button" class="settings-mobile-back" @click="detailOpen = false">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span>返回列表</span>
                </button>
                <div v-if="!selectedProvider" class="admin-user-detail-empty">请选择左侧供应商查看模型</div>
                <div v-else>
                    <div class="admin-users-toolbar admin-system-toolbar-row">
                        <h4 style="margin:0;">{{ selectedProvider }}</h4>
                        <!-- 超额策略下拉(对齐原版 quota-provider-overage-action-inline:放在详情标题行) -->
                        <span class="model-provider-quota-row" @click.stop>
                            <label class="model-provider-quota-label">超额策略</label>
                            <SettingSelect
                                :model-value="overageAction(selectedProvider)"
                                :options="overageActionOptions"
                                width="130px"
                                @update:model-value="saveOverageAction(selectedProvider, String($event))"
                            />
                        </span>
                        <button class="btn-primary-outline btn-compact" type="button" @click="handleEditProvider(selectedProvider)">
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                            <span>编辑供应商</span>
                        </button>
                    </div>
                    <div v-if="!providerModels.length" class="admin-user-detail-empty">该供应商暂无模型</div>
                    <div
                        v-for="model in providerModels"
                        :key="model.id"
                        class="admin-model-row"
                    >
                        <span class="provider-icon provider-icon-sm">
                            <img v-if="providerIconUrl(selectedProvider)" :src="providerIconUrl(selectedProvider)" alt="">
                            <template v-else>{{ providerIconFallback(selectedProvider) }}</template>
                        </span>
                        <div class="admin-model-row-main">
                            <!-- 名称行(对齐原版 model-admin-item-name-row:左侧名称+状态,右侧 hover 编辑/删除) -->
                            <div class="admin-model-name-row">
                                <div class="admin-model-name-main">
                                    <button
                                        v-if="isOllamaProvider(selectedProvider)"
                                        class="model-status-btn"
                                        :class="ollamaStatusClass(model.id)"
                                        type="button"
                                        :title="ollamaStatusTitle(model.id)"
                                        @click.stop="openOllamaDialog(model.id)"
                                    >
                                        <i class="fa-solid fa-circle" aria-hidden="true"></i>
                                    </button>
                                    <span class="admin-model-name">{{ model.name }}</span>
                                    <span class="admin-model-status" :class="`model-status-${normalizeStatus(model.status)}`">
                                        {{ statusLabel(model.status) }}
                                    </span>
                                </div>
                                <div class="admin-model-row-actions">
                                    <button
                                        class="model-icon-btn"
                                        type="button"
                                        title="编辑模型"
                                        @click.stop="handleEditModel(model)"
                                    >
                                        <i class="fa-solid fa-pen" aria-hidden="true"></i>
                                    </button>
                                    <button
                                        class="model-icon-btn model-icon-btn-danger"
                                        type="button"
                                        title="删除模型"
                                        @click.stop="requestDeleteModel(model.id, model.name)"
                                    >
                                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <span class="admin-model-ctx">{{ quotaCtx(model) }}</span>
                            <!-- 额度计量条(对齐原版 model-admin-item-meter-wrap:点击直接打开额度调整) -->
                            <div
                                class="quota-meter-wrap"
                                :data-provider="selectedProvider"
                                :data-model="model.id"
                                :data-total-tokens="quotaTotal(model)"
                                :data-used-tokens="modelTokens(model)"
                                title="点击编辑额度"
                                @click.stop="openQuotaAdjustAt($event, model)"
                            >
                                <div class="quota-meter-shell">
                                    <div class="quota-meter-track">
                                        <div
                                            v-if="meterRemaining(model) > 0"
                                            class="quota-meter-seg quota-meter-seg-remaining"
                                            :style="{ left: '50%', width: `${meterRemaining(model)}%` }"
                                        ></div>
                                        <div
                                            v-if="!meterHasDebt(model) && meterUsed(model) > 0"
                                            class="quota-meter-seg quota-meter-seg-used"
                                            :style="{ left: `${50 + meterRemaining(model)}%`, width: `${meterUsed(model)}%` }"
                                        ></div>
                                        <div
                                            v-if="meterOverage(model) > 0"
                                            class="quota-meter-seg quota-meter-seg-overage"
                                            :style="{ right: '50%', width: `${meterOverage(model)}%` }"
                                        ></div>
                                        <div class="quota-meter-midline"></div>
                                    </div>
                                    <div class="quota-meter-label-row" data-role="quota-meter-label-row">
                                        <div
                                            class="quota-meter-label-item debt"
                                            data-role="quota-meter-label-debt"
                                            :data-visible="meterHasDebt(model) ? '1' : '0'"
                                            :data-anchor="meterDebtAnchor(model)"
                                            :style="{ display: meterHasDebt(model) ? '' : 'none' }"
                                        >{{ meterHasDebt(model) ? `负${fmtQuota(meterOverageTokens(model))}` : '' }}</div>
                                        <div
                                            class="quota-meter-label-item remaining"
                                            data-role="quota-meter-label-remaining"
                                            :data-visible="!meterHasDebt(model) && (quotaByModel(model)?.remaining_tokens ?? 0) > 0 ? '1' : '0'"
                                            :data-anchor="meterRemainAnchor(model)"
                                            :style="{ display: !meterHasDebt(model) && (quotaByModel(model)?.remaining_tokens ?? 0) > 0 ? '' : 'none' }"
                                        >剩{{ fmtQuota(quotaByModel(model)?.remaining_tokens) }}</div>
                                        <div
                                            class="quota-meter-label-item used"
                                            data-role="quota-meter-label-used"
                                            :data-visible="!meterHasDebt(model) && meterUsed(model) > 0 ? '1' : '0'"
                                            :style="{ display: !meterHasDebt(model) && meterUsed(model) > 0 ? '' : 'none' }"
                                        >已用{{ fmtQuota(modelTokens(model)) }}</div>
                                        <div class="quota-meter-label-item total" data-role="quota-meter-label-total">
                                            共{{ fmtQuota(quotaTotal(model)) }}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 额度调整 popover(对齐原版 quotaAdjustPopover:fixed 锚点跟随,外部点击/Esc 关闭) -->
        <div
            v-if="adjustPopover.open"
            ref="adjustPopoverRef"
            class="quota-adjust-popover-fixed"
            :style="{ left: `${adjustPopover.x}px`, top: `${adjustPopover.y}px` }"
        >
            <div class="quota-adjust-title">{{ adjustPopover.provider }} / {{ adjustPopover.model }}</div>
            <div class="quota-adjust-meta">用 {{ fmtQuota(adjustPopover.used) }} / 共 {{ fmtQuota(adjustPopover.total) }}</div>
            <div class="quota-adjust-mode">
                <span class="quota-adjust-mode-label">调整</span>
                <select
                    v-model="adjustPopover.mode"
                    class="input-modern"
                    style="width:64px; height:30px; padding:4px 6px; font-size:12px;"
                    @change="onAdjustModeChange"
                >
                    <option value="total">共</option>
                    <option value="remaining">剩</option>
                </select>
                <input
                    v-model="adjustPopover.input"
                    class="input-modern"
                    type="number"
                    min="0"
                    step="1"
                    style="flex:1; min-width:0; height:30px; padding:4px 8px; font-size:12px;"
                    placeholder="输入额度数值"
                    @keydown.enter="submitQuotaAdjust"
                >
                <button class="quota-adjust-save-btn" type="button" :disabled="adjustPopover.submitting" title="保存额度" @click="submitQuotaAdjust">
                    <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                </button>
            </div>
            <div class="quota-adjust-hint-text">{{ adjustHint }}</div>
        </div>

        <!-- 添加/编辑模型弹窗 -->
        <Modal :open="modelFormOpen" :title="editingModel ? '编辑模型' : '添加模型'" size="sm" @close="modelFormOpen = false">
            <div class="form-group">
                <label>供应商</label>
                <SettingSelect v-model="modelForm.provider" :options="providerSelectOptions" width="100%" />
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
                <label>状态</label>
                <SettingSelect v-model="modelForm.status" :options="modelStatusOptions" width="100%" />
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
                <label>接口类型</label>
                <SettingSelect v-model="providerForm.api_type" :options="providerTypeOptions" width="100%" @update:model-value="syncProviderType" />
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

        <!-- Ollama 模型状态弹窗(对齐原版 ollamaModelStatusModal) -->
        <Modal :open="ollamaDialog.open" title="Ollama 模型状态" size="sm" @close="ollamaDialog.open = false">
            <div class="form-group">
                <label>供应商 / 模型</label>
                <div class="admin-info-text mono">{{ ollamaDialog.provider }} / {{ ollamaDialog.model }}</div>
            </div>
            <div class="ollama-status-grid">
                <div class="ollama-status-row">
                    <span>状态</span>
                    <strong>{{ ollamaStatusLabel(ollamaDialog.status) }}</strong>
                </div>
                <div class="ollama-status-row">
                    <span>运行中</span>
                    <strong>{{ ollamaDialog.status?.running ? '是' : '否' }}</strong>
                </div>
                <div class="ollama-status-row">
                    <span>已安装</span>
                    <strong>{{ ollamaDialog.status?.installed ? '是' : '否' }}</strong>
                </div>
                <div class="ollama-status-row">
                    <span>keep_alive</span>
                    <strong>{{ String(ollamaDialog.status?.keep_alive || '5m') }}</strong>
                </div>
                <div class="ollama-status-row">
                    <span>tags</span>
                    <strong>{{ ollamaDialog.status?.tag?.name || ollamaDialog.status?.tag?.model || ollamaDialog.status?.tag?.id || ollamaDialog.status?.model || '-' }}</strong>
                </div>
                <div class="ollama-status-row">
                    <span>ps</span>
                    <strong>{{ ollamaDialog.status?.ps?.name || ollamaDialog.status?.ps?.model || ollamaDialog.status?.ps?.id || '-' }}</strong>
                </div>
            </div>
            <div
                v-if="ollamaDialog.status?.message"
                class="ollama-status-message"
                :class="`level-${ollamaStatusLevel(ollamaDialog.status)}`"
            >{{ ollamaDialog.status.message }}</div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="ollamaDialog.open = false">关闭</button>
                <button class="btn-primary-outline" type="button" :disabled="ollamaDialog.loading" @click="refreshOllamaDialogStatus">
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    <span>刷新</span>
                </button>
                <button
                    class="btn-confirm"
                    type="button"
                    :disabled="ollamaDialog.loading || ollamaDialog.toggling || !canToggleOllama"
                    @click="toggleOllamaModel"
                >{{ ollamaDialog.status?.running ? 'Unload' : 'Load' }}</button>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

    import type { ModelInfo } from '@/api/admin-models'
    import { deleteModel, deleteProvider, fetchModelsConfig, upsertModel, upsertProvider } from '@/api/admin-models'
    import type { OllamaModelStatus, OllamaProviderStatus } from '@/api/admin-ollama'
    import { fetchOllamaProviderStatus, toggleOllamaModelStatus } from '@/api/admin-ollama'
    import type { QuotaModelStatus, QuotaProvider } from '@/api/admin-quota'
    import { fetchAdminQuota, formatQuota, saveProviderOverageAction, updateModelQuota } from '@/api/admin-quota'
    import { providerIconFallbackText, resolveProviderIconUrl } from '@/api/providerIcons'
    import { showError, showToast } from '@/stores/notify'
    import { showPrompt } from '@/stores/confirm'

    import Modal from '@/ui/Modal.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    interface ProviderInfo {
        api_key?: string
        base_url?: string
        api_type?: string
        user_agent?: string
        settings?: Record<string, unknown>
    }

    const loading = ref(false)
    const models = ref<Record<string, ModelInfo>>({})
    /** 手机端两级钻取:选择供应商后整页切到模型详情(桌面端双栏并排不受影响) */
    const detailOpen = ref(false)
    const providersRecord = ref<Record<string, ProviderInfo>>({})
    const query = ref('')
    const selectedProvider = ref('')

    /** 额度计量(对齐原版 model-admin-item-meter) */
    const quotaMap = ref<Record<string, QuotaModelStatus>>({})
    const quotaProviders = ref<QuotaProvider[]>([])
    const quotaOverageActions = ref<Record<string, string>>({})
    const quotaDefaultAction = ref('disable_model')
    /** 显示单位(持久化到 localStorage,对齐原版 ADMIN_QUOTA_UNIT_STORAGE_KEY) */
    const QUOTA_UNIT_STORAGE_KEY = 'chatdb.admin.quota_display_unit'
    const quotaUnit = ref(normalizeQuotaUnit(localStorage.getItem(QUOTA_UNIT_STORAGE_KEY)))

    /** 归一化额度显示单位(仅保留后端认识的值,对齐原版 normalizeAdminQuotaDisplayUnit) */
    function normalizeQuotaUnit(raw: string | null): string {
        const value = String(raw || '').trim().toLowerCase()

        if (value === 'auto' || value === 'k' || value === 'w' || value === 'm' || value === 'token') {
            return value
        }

        return 'auto'
    }

    /** 单位切换:持久化(对齐原版 saveAdminQuotaDisplayUnitPreference) */
    function onQuotaUnitChange(value: string): void {
        const normalized = normalizeQuotaUnit(value)

        quotaUnit.value = normalized

        try {
            localStorage.setItem(QUOTA_UNIT_STORAGE_KEY, normalized)
        } catch {
            // localStorage 不可用时忽略
        }
    }

    /** Provider 超额策略选项(对齐原版 resolveAdminProviderOverageAction) */
    const overageActionOptions = [
        { value: 'no_op', label: '无操作' },
        { value: 'disable_model', label: '停用模型' },
        { value: 'notify_admin', label: '发送通知' },
        { value: 'disable_and_notify', label: '停用并通知' },
    ]

    /** Ollama 模型状态(对齐原版 adminOllamaModelStatusCache:provider -> 模型状态表) */
    const ollamaStatusMap = ref<Record<string, OllamaProviderStatus>>({})
    const ollamaStatusPending = ref<Record<string, boolean>>({})

    /** Ollama 状态弹窗状态(对齐原版 adminOllamaStatusModalState) */
    const ollamaDialog = ref<{
        open: boolean
        provider: string
        model: string
        status: OllamaModelStatus | null
        loading: boolean
        toggling: boolean
    }>({
        open: false,
        provider: '',
        model: '',
        status: null,
        loading: false,
        toggling: false,
    })

    /** 额度调整 popover 状态(对齐原版 quotaAdjustPopover:锚点跟随) */
    const adjustPopover = ref<{
        open: boolean
        x: number
        y: number
        provider: string
        model: string
        used: number
        total: number
        mode: 'total' | 'remaining'
        input: string
        submitting: boolean
        anchor: HTMLElement | null
    }>({
        open: false,
        x: 0,
        y: 0,
        provider: '',
        model: '',
        used: 0,
        total: 0,
        mode: 'total',
        input: '',
        submitting: false,
        anchor: null,
    })
    const adjustPopoverRef = ref<HTMLElement | null>(null)

    /** 弹窗下拉选项 */
    const providerSelectOptions = computed(() => {
        return providers.value.map((provider) => ({ value: provider, label: provider }))
    })

    const modelStatusOptions = [
        { value: 'normal', label: '正常' },
        { value: 'error', label: '异常' },
        { value: 'disabled', label: '停用' },
    ]

    const providerTypeOptions = [
        { value: 'openai', label: 'OpenAI 兼容' },
        { value: 'azure', label: 'Azure' },
        { value: 'dashscope', label: 'DashScope' },
        { value: 'ollama', label: 'Ollama' },
    ]

    /** 调整模式文案(对齐原版 _refreshQuotaAdjustPopoverHint:token 精确提示) */
    const adjustHint = computed(() => {
        const state = adjustPopover.value
        const inputValue = Number(state.input)
        const validInput = Number.isFinite(inputValue) ? Math.max(0, inputValue) : 0
        const currentTotal = state.total
        const usedTokens = state.used

        if (state.mode === 'remaining') {
            const nextTotal = Math.max(0, usedTokens + validInput)
            const delta = nextTotal - currentTotal
            const deltaText = delta > 0
                ? `增加 ${formatQuota(delta, 'token')}`
                : (delta < 0 ? `减少 ${formatQuota(Math.abs(delta), 'token')}` : '不变')

            return `剩余 ${formatQuota(validInput, 'token')} => 总量 ${formatQuota(nextTotal, 'token')}(较当前${deltaText})`
        }

        const delta = validInput - currentTotal
        const deltaText = delta > 0
            ? `增加 ${formatQuota(delta, 'token')}`
            : (delta < 0 ? `减少 ${formatQuota(Math.abs(delta), 'token')}` : '不变')

        return `总量设为 ${formatQuota(validInput, 'token')}(较当前${deltaText})`
    })

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
        window.addEventListener('resize', onWindowResize)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', onWindowResize)
        closeAdjustPopover()
    })

    /** 视口变化时重排额度标签(对齐原版 _ensureQuotaMeterLayoutEvents) */
    function onWindowResize(): void {
        layoutQuotaMeterLabels()
    }

    /** 拉取模型配置 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const [config, quota] = await Promise.all([
                fetchModelsConfig(),
                fetchAdminQuota().catch(() => null),
            ])

            models.value = config.models
            providersRecord.value = config.providers as Record<string, ProviderInfo>
            applyQuota(quota)

            // 默认选中第一个 provider
            if (providers.value.length && !providers.value.includes(selectedProvider.value)) {
                selectedProvider.value = providers.value[0]
            }

            // 选中 provider 为 Ollama 时预拉取模型状态(对齐原版 refreshAdminOllamaStatusCache)
            if (isOllamaProvider(selectedProvider.value)) {
                void loadOllamaStatus(selectedProvider.value)
            }

            await nextTick()
            layoutQuotaMeterLabels()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载模型配置失败')
        } finally {
            loading.value = false
        }
    }

    function selectProvider(provider: string): void {
        selectedProvider.value = provider
        detailOpen.value = true

        void loadOllamaStatus(provider)

        // provider 切换后重排额度标签
        void nextTick().then(() => {
            layoutQuotaMeterLabels()
        })
    }

    /** provider 接口类型展示(对齐原版 admin-user-meta api_type) */
    function providerApiType(provider: string): string {
        const raw = String(providersRecord.value[provider]?.api_type || 'openai').toLowerCase()

        if (raw === 'openai' || raw === 'azure' || raw === 'dashscope' || raw === 'ollama') {
            return raw
        }

        return 'openai'
    }

    /** 该 provider 是否为 Ollama(对齐原版 isAdminOllamaProvider) */
    function isOllamaProvider(provider: string): boolean {
        return String(providersRecord.value[provider]?.api_type || '').trim().toLowerCase() === 'ollama'
    }

    /** 拉取 Ollama provider 模型状态(去重 + 缓存,对齐原版 loadAdminOllamaStatusForProvider) */
    async function loadOllamaStatus(provider: string): Promise<void> {
        const key = String(provider || '').trim()

        if (!key || !isOllamaProvider(key)) {
            return
        }

        if (ollamaStatusPending.value[key]) {
            return
        }

        ollamaStatusPending.value[key] = true

        try {
            ollamaStatusMap.value[key] = await fetchOllamaProviderStatus(key)
        } catch (error) {
            ollamaStatusMap.value[key] = {
                byModelId: {},
                raw: null,
                error: error instanceof Error ? error.message : '加载失败',
                loaded: false,
                loadedAt: Date.now(),
            }
        } finally {
            ollamaStatusPending.value[key] = false
        }
    }

    /** 某模型的 Ollama 状态条目(按小写模型 id 匹配,对齐原版 getAdminOllamaModelStatus) */
    function ollamaStatusEntry(modelId: string): OllamaModelStatus | null {
        const providerStatus = ollamaStatusMap.value[selectedProvider.value]

        if (!providerStatus) {
            return null
        }

        return providerStatus.byModelId[String(modelId || '').trim().toLowerCase()] || null
    }

    /** 状态点样式类(对齐原版 getAdminOllamaStatusButtonClass) */
    function ollamaStatusClass(modelId: string): string {
        const entry = ollamaStatusEntry(modelId)
        const providerStatus = ollamaStatusMap.value[selectedProvider.value]
        const providerLoaded = Boolean(providerStatus && providerStatus.loaded)
        const status = String(
            (entry && entry.status)
            || (providerStatus && providerStatus.error ? 'error' : providerLoaded ? 'missing' : '')
        ).trim().toLowerCase() || 'loading'

        if (status === 'running' || status === 'online' || status === 'ok') {
            return 'model-status-btn-success'
        }

        if (status === 'offline' || status === 'idle' || status === 'warning') {
            return 'model-status-btn-warn'
        }

        if (status === 'missing' || status === 'error' || status === 'failed') {
            return 'model-status-btn-danger'
        }

        return 'model-status-btn-loading'
    }

    /** 状态点标题(对齐原版 renderAdminOllamaStatusButton title) */
    function ollamaStatusTitle(modelId: string): string {
        const entry = ollamaStatusEntry(modelId)
        const providerStatus = ollamaStatusMap.value[selectedProvider.value]
        const providerLoaded = Boolean(providerStatus && providerStatus.loaded)
        const label = String(
            (entry && entry.status_label)
            || (providerStatus && providerStatus.error ? '错误' : providerLoaded ? '不在线' : '加载中')
            || '状态'
        ).trim()

        return `${selectedProvider.value} / ${modelId} · ${label}`
    }

    /** 打开 Ollama 状态弹窗(对齐原版 loadAdminOllamaModelStatus) */
    async function openOllamaDialog(modelId: string): Promise<void> {
        const key = String(selectedProvider.value || '').trim()

        if (!key || !modelId) {
            return
        }

        ollamaDialog.value = {
            open: true,
            provider: key,
            model: modelId,
            status: null,
            loading: true,
            toggling: false,
        }

        await refreshOllamaDialogStatus()
    }

    /** 刷新弹窗状态(对齐原版 loadAdminOllamaModelStatus 主体) */
    async function refreshOllamaDialogStatus(): Promise<void> {
        const dialog = ollamaDialog.value

        if (!dialog.provider || !dialog.model) {
            return
        }

        dialog.loading = true

        try {
            await loadOllamaStatus(dialog.provider)
            const providerStatus = ollamaStatusMap.value[dialog.provider]

            if (providerStatus && providerStatus.error && !providerStatus.loaded) {
                throw new Error(providerStatus.error)
            }

            dialog.status = ollamaStatusEntry(dialog.model) || {
                ok: true,
                provider: dialog.provider,
                api_type: 'ollama',
                model: dialog.model,
                installed: false,
                running: false,
                status: 'missing',
                status_label: '未安装',
                status_level: 'danger',
                keep_alive: '5m',
                message: '模型未安装或未出现在 Ollama 列表中',
                ps: null,
                tag: null,
            }
        } catch (error) {
            dialog.status = {
                success: false,
                provider: dialog.provider,
                model: dialog.model,
                status: 'error',
                status_label: '错误',
                status_level: 'danger',
                message: error instanceof Error ? error.message : '加载失败',
                installed: false,
                running: false,
                keep_alive: '5m',
            }
        } finally {
            dialog.loading = false
        }
    }

    /** 状态中文标签(对齐原版 formatAdminOllamaStatusLabel) */
    function ollamaStatusLabel(entry: OllamaModelStatus | null): string {
        if (!entry) {
            return '加载中'
        }

        const status = String(entry.status || '').trim().toLowerCase()

        if (status === 'running') {
            return '在线'
        }

        if (status === 'offline') {
            return '不在线'
        }

        if (status === 'missing' || status === 'uninstalled') {
            return '未安装'
        }

        if (status === 'error') {
            return '错误'
        }

        return entry.status_label || '状态未知'
    }

    /** 是否可执行 Load/Unload(missing / error 状态不可切换,对齐原版 canToggle) */
    const canToggleOllama = computed(() => {
        const status = String(ollamaDialog.value.status?.status || '').trim().toLowerCase()

        return status !== 'missing' && status !== 'error'
    })

    /** 弹窗消息级别(对齐原版 formatAdminOllamaStatusLevel) */
    function ollamaStatusLevel(entry: OllamaModelStatus | null): string {
        if (!entry) {
            return 'info'
        }

        const status = String(entry.status || '').trim().toLowerCase()

        if (status === 'running') {
            return 'success'
        }

        if (status === 'offline') {
            return 'warning'
        }

        if (status === 'missing' || status === 'error') {
            return 'danger'
        }

        return entry.status_level || 'info'
    }

    /** Load/Unload 切换(对齐原版 toggleAdminOllamaModelStatus) */
    async function toggleOllamaModel(): Promise<void> {
        const dialog = ollamaDialog.value

        if (!dialog.provider || !dialog.model) {
            return
        }

        const current = dialog.status || {}
        const running = Boolean(current.running)
        const action = running ? 'unload' : 'load'

        dialog.toggling = true

        try {
            const result = await toggleOllamaModelStatus({
                provider: dialog.provider,
                model_id: dialog.model,
                action,
                keep_alive: String(current.keep_alive || '5m'),
            })

            const providerStatus = ollamaStatusMap.value[dialog.provider] || { byModelId: {}, raw: null, error: '', loaded: true, loadedAt: Date.now() }

            providerStatus.byModelId = providerStatus.byModelId || {}
            providerStatus.byModelId[String(dialog.model || '').trim().toLowerCase()] = result
            providerStatus.error = ''
            providerStatus.loaded = true
            providerStatus.loadedAt = Date.now()
            ollamaStatusMap.value[dialog.provider] = providerStatus

            dialog.status = result
            showToast(running ? '模型已卸载' : '模型已加载', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        } finally {
            dialog.toggling = false
        }
    }

    /** Provider 图标 URL(对齐原版 resolveProviderSimpleIconSlug) */
    function providerIconUrl(provider: string): string {
        return resolveProviderIconUrl(provider)
    }

    /** Provider 图标 fallback 字符(取首字母大写) */
    function providerIconFallback(provider: string): string {
        return providerIconFallbackText(provider)
    }

    /** 应用额度数据(对齐原版 get_server_quota_status) */
    function applyQuota(quota: Awaited<ReturnType<typeof fetchAdminQuota>> | null): void {
        quotaMap.value = quota?.model_status_map || {}
        quotaProviders.value = (Array.isArray(quota?.providers) ? quota.providers : []).filter((provider) => {
            const name = String(provider.name || '').trim().toLowerCase()

            return !!name && name !== 'unknown'
        })
        quotaOverageActions.value = quota?.provider_overage_actions || {}
        quotaDefaultAction.value = String(quota?.on_exhausted || 'disable_model')
    }

    /** 仅刷新额度(不影响模型列表) */
    async function loadQuota(): Promise<void> {
        try {
            const quota = await fetchAdminQuota()

            applyQuota(quota)
            await nextTick()
            layoutQuotaMeterLabels()
            showToast('额度已刷新', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '刷新额度失败')
        }
    }

    /**
     * 额度计量标签防重叠布局(对齐原版 _layoutSingleQuotaMeterLabelRow)
     *
     * 标签全部绝对定位,依据 data-anchor(锚点百分比)+ 各自实际宽度在行内动态计算 left,
     * 保证「负X / 剩X / 已用X / 共X」互不重叠,右端为共X 让位。
     */
    function layoutQuotaMeterLabels(): void {
        const rows = document.querySelectorAll('.settings-modal-shell [data-role="quota-meter-label-row"]')

        rows.forEach((rowEl) => {
            const row = rowEl as HTMLElement
            const debtEl = row.querySelector('[data-role="quota-meter-label-debt"]') as HTMLElement | null
            const remainEl = row.querySelector('[data-role="quota-meter-label-remaining"]') as HTMLElement | null
            const totalEl = row.querySelector('[data-role="quota-meter-label-total"]') as HTMLElement | null
            const usedEl = row.querySelector('[data-role="quota-meter-label-used"]') as HTMLElement | null

            if (!debtEl || !remainEl || !totalEl) {
                return
            }

            const rowWidth = Math.max(0, row.clientWidth || 0)

            if (rowWidth <= 0) {
                return
            }

            const gap = 8
            const rightReserve = 0
            const debtVisible = debtEl.dataset.visible !== '0' && debtEl.style.display !== 'none'
            const remainVisible = remainEl.dataset.visible !== '0' && remainEl.style.display !== 'none'
            const usedVisible = !!usedEl && usedEl.dataset.visible !== '0' && usedEl.style.display !== 'none'
            const debtWidth = debtVisible ? Math.ceil(debtEl.getBoundingClientRect().width || 0) : 0
            const remainWidth = remainVisible ? Math.ceil(remainEl.getBoundingClientRect().width || 0) : 0
            const totalWidth = Math.ceil(totalEl.getBoundingClientRect().width || 0)
            const usedWidth = usedVisible ? Math.ceil(usedEl.getBoundingClientRect().width || 0) : 0

            const rightBlocked = rightReserve + (usedVisible ? usedWidth + gap : 0)
            const layoutWidth = Math.max(0, rowWidth - rightBlocked)

            if (layoutWidth <= 0) {
                return
            }

            const debtAnchorPct = Math.max(0, Math.min(100, Number.parseFloat(debtEl.dataset.anchor || '0') || 0))
            const remainAnchorPct = Math.max(0, Math.min(100, Number.parseFloat(remainEl.dataset.anchor || '0') || 0))
            const debtAnchorPx = (debtAnchorPct / 100) * layoutWidth
            const remainAnchorPx = (remainAnchorPct / 100) * layoutWidth

            let totalRight = layoutWidth
            let remainRight = remainVisible ? Math.max(remainWidth, Math.min(layoutWidth, remainAnchorPx)) : 0
            let debtRight = debtVisible ? Math.max(debtWidth, Math.min(layoutWidth, debtAnchorPx)) : 0

            const maxRemainRight = remainVisible ? Math.max(remainWidth, totalRight - totalWidth - gap) : 0

            if (remainVisible && remainRight > maxRemainRight) {
                remainRight = maxRemainRight
            }

            const minRemainRight = remainVisible ? (debtVisible ? debtRight + remainWidth + gap : remainWidth) : 0

            if (remainVisible && remainRight < minRemainRight) {
                remainRight = Math.min(maxRemainRight, minRemainRight)
            }

            if (debtVisible && remainVisible) {
                const maxDebtRight = remainRight - remainWidth - gap

                if (debtRight > maxDebtRight) {
                    debtRight = Math.max(debtWidth, maxDebtRight)
                }
            } else if (debtVisible) {
                const maxDebtRight = totalRight - totalWidth - gap

                if (debtRight > maxDebtRight) {
                    debtRight = Math.max(debtWidth, maxDebtRight)
                }
            }

            const debtLeft = Math.max(0, Math.min(layoutWidth - debtWidth, debtRight - debtWidth))
            const remainLeft = Math.max(0, Math.min(layoutWidth - remainWidth, remainRight - remainWidth))
            const totalLeft = Math.max(0, Math.min(layoutWidth - totalWidth, totalRight - totalWidth))

            debtEl.style.left = `${Math.round(debtLeft)}px`

            if (remainVisible) {
                remainEl.style.left = `${Math.round(remainLeft)}px`
            }

            totalEl.style.left = `${Math.round(totalLeft)}px`

            if (usedVisible && usedEl) {
                const usedLeft = Math.max(0, Math.min(rowWidth - usedWidth, rowWidth - rightReserve - usedWidth))

                usedEl.style.left = `${Math.round(usedLeft)}px`
            }
        })
    }

    /** Provider 超额策略当前值 */
    function overageAction(provider: string): string {
        return quotaOverageActions.value[provider] || quotaDefaultAction.value
    }

    /** 保存 Provider 超额策略 */
    async function saveOverageAction(provider: string, action: string): Promise<void> {
        try {
            await saveProviderOverageAction(provider, action)

            quotaOverageActions.value[provider] = action
            showToast(`${provider} 超额策略已保存`, 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 某 provider 的债务满刻度(取该 provider 全部模型最大超额,500000 步进向上取整,对齐原版 _roundQuotaDebtScale) */
    function providerDebtScale(provider: string): number {
        const row = quotaProviders.value.find((item) => item.name === provider)

        if (!row || !Array.isArray(row.models)) {
            return 0
        }

        const maxOverageRaw = row.models.reduce((max, m) => {
            const rowTokens = Math.max(0, Number((m && m.tokens) || 0))
            const rowTotal = Math.max(0, Number((m && m.quota_total_tokens) || 0))
            const rowOverage = Math.max(0, Number((m && m.overage_tokens) || 0))

            if (rowOverage > 0) {
                return Math.max(max, rowOverage)
            }

            if (rowTotal <= 0 && rowTokens > 0) {
                return Math.max(max, rowTokens)
            }

            return max
        }, 0)

        if (maxOverageRaw <= 0) {
            return 0
        }

        const step = 500000

        return Math.ceil(maxOverageRaw / step) * step
    }

    /** 按 provider + 模型名定位额度记录(键为 provider::model 规范化形式,故按值匹配) */
    function quotaByModel(model: { id: string; context_window?: number }): QuotaModelStatus | null {
        const provider = String(selectedProvider.value || '').toLowerCase()
        const name = String(model.id || '').toLowerCase()

        for (const row of Object.values(quotaMap.value)) {
            if (String(row.provider || '').toLowerCase() === provider && String(row.name || '').toLowerCase() === name) {
                return row
            }
        }

        return null
    }

    /** 当前单位下的额度格式化(模板用) */
    function fmtQuota(value: number | null | undefined): string {
        return formatQuota(value ?? 0, quotaUnit.value)
    }

    /** 模型已用 token(无额度记录按 0,对齐原版 model.tokens) */
    function modelTokens(model: { id: string }): number {
        const quota = quotaByModel(model)

        return Math.max(0, Number(quota?.tokens || 0))
    }

    /** 模型总额度(无记录按 0) */
    function quotaTotal(model: { id: string }): number {
        const quota = quotaByModel(model)

        return Math.max(0, Number(quota?.quota_total_tokens || 0))
    }

    /** 模型超额 token(无债务按 0;无总额度但有已用时按已用计,对齐原版 modelOverage) */
    function meterOverageTokens(model: { id: string }): number {
        const quota = quotaByModel(model)
        const overageRaw = Math.max(0, Number(quota?.overage_tokens || 0))

        if (overageRaw > 0) {
            return overageRaw
        }

        const total = quotaTotal(model)
        const used = modelTokens(model)

        return total <= 0 && used > 0 ? used : 0
    }

    /** 是否存在债务(超额) */
    function meterHasDebt(model: { id: string; context_window?: number }): boolean {
        const quota = quotaByModel(model)

        return Boolean(quota && quota.overage_tokens > 0)
    }

    /** 右侧剩余段宽度(占总额度 50% 内的百分比;有债务时不显示,对齐原版 remainingRight) */
    function meterRemaining(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)

        if (!quota || meterHasDebt(model) || !quota.quota_total_tokens || quota.remaining_tokens === null) {
            return 0
        }

        return Math.max(0, Math.min(50, (quota.remaining_tokens / quota.quota_total_tokens) * 50))
    }

    /** 右侧已用段宽度(有债务时不显示;与剩余段合计不超过 50%,对齐原版 usedRight) */
    function meterUsed(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)

        if (!quota || meterHasDebt(model) || !quota.quota_total_tokens) {
            return 0
        }

        const remaining = meterRemaining(model)

        return Math.max(0, Math.min(50 - remaining, (quota.tokens / quota.quota_total_tokens) * 50))
    }

    /** 左侧超额段宽度(按 provider 债务满刻度缩放,最多 50%,对齐原版 overflowLeft) */
    function meterOverage(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)
        const debtScale = providerDebtScale(String(selectedProvider.value || ''))

        if (!quota || debtScale <= 0 || quota.overage_tokens <= 0) {
            return 0
        }

        return Math.max(0, Math.min(50, (quota.overage_tokens / debtScale) * 50))
    }

    /** 债务标签锚点百分比(对齐原版 debtAnchor:靠近中线但为超额段让位) */
    function meterDebtAnchor(model: { id: string }): number {
        const overflowLeft = meterOverage(model)

        return overflowLeft > 0 ? Math.max(2, Math.min(50, 50 - overflowLeft)) : 50
    }

    /** 剩余标签锚点百分比(对齐原版 remainAnchor) */
    function meterRemainAnchor(model: { id: string }): number {
        const quota = quotaByModel(model)

        if (!meterHasDebt(model) && quota?.quota_total_tokens) {
            return Math.max(50, Math.min(98, 50 + meterRemaining(model)))
        }

        return 50
    }

    /** 打开额度调整 popover(锚点跟随;无额度记录也可打开设置,对齐原版 _openQuotaAdjustPopover) */
    function openQuotaAdjustAt(event: MouseEvent, model: { id: string; context_window?: number }): void {
        const anchor = event.currentTarget as HTMLElement
        const quota = quotaByModel(model)
        const used = quota ? Math.max(0, Number(quota.tokens || 0)) : 0
        const total = quota ? Math.max(0, Number(quota.quota_total_tokens || 0)) : 0
        const remaining = Math.max(0, total - used)

        adjustPopover.value = {
            open: true,
            x: 0,
            y: 0,
            provider: String(selectedProvider.value || ''),
            model: model.id,
            used,
            total,
            mode: 'total',
            input: String(total || 0),
            submitting: false,
            anchor,
        }

        void remaining
        // 等 popover 挂载后再测量定位(对齐原版先 display:block 再 getBoundingClientRect)
        void nextTick().then(() => {
            positionAdjustPopover()
            bindAdjustPopoverFollow()
        })
    }

    /** 依据锚点定位 popover(fixed,视口内夹取,对齐原版 _positionQuotaAdjustPopover) */
    function positionAdjustPopover(): void {
        const state = adjustPopover.value
        const popover = adjustPopoverRef.value

        if (!state.open || !popover || !state.anchor) {
            return
        }

        const rect = state.anchor.getBoundingClientRect()
        const popRect = popover.getBoundingClientRect()
        const gap = 10
        const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0)
        const vh = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0)

        let left = rect.left + (rect.width / 2) - (popRect.width / 2)
        let top = rect.bottom + gap

        if (left < 12) {
            left = 12
        }

        if (left + popRect.width > vw - 12) {
            left = vw - popRect.width - 12
        }

        if (top + popRect.height > vh - 12) {
            top = rect.top - popRect.height - gap
        }

        if (top < 12) {
            top = 12
        }

        state.x = Math.round(left)
        state.y = Math.round(top)
    }

    /** 绑定 popover 跟随锚点(滚动/resize 时 reposition,对齐原版 _queueFollowAnchor) */
    function bindAdjustPopoverFollow(): void {
        document.addEventListener('pointerdown', onAdjustPopoverOutside, true)
        document.addEventListener('keydown', onAdjustPopoverKeydown, true)
        window.addEventListener('resize', onAdjustPopoverFollow)
        window.addEventListener('scroll', onAdjustPopoverFollow, true)
    }

    /** 外部点击关闭(点击锚点本身不关,对齐原版 _closeByOutside) */
    function onAdjustPopoverOutside(event: PointerEvent): void {
        const state = adjustPopover.value

        if (!state.open) {
            return
        }

        const target = event.target as HTMLElement | null

        if (!target) {
            return
        }

        const popover = adjustPopoverRef.value

        if (popover && popover.contains(target)) {
            return
        }

        if (state.anchor && state.anchor.contains(target)) {
            return
        }

        closeAdjustPopover()
    }

    /** Esc 关闭;Enter 由输入框 keydown 处理(对齐原版 popover keydown + document keydown) */
    function onAdjustPopoverKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeAdjustPopover()
        }
    }

    /** 滚动/缩放时跟随锚点 */
    function onAdjustPopoverFollow(): void {
        if (!adjustPopover.value.open || !adjustPopover.value.anchor?.isConnected) {
            closeAdjustPopover()

            return
        }

        positionAdjustPopover()
    }

    /** 关闭 popover 并解绑监听 */
    function closeAdjustPopover(): void {
        const state = adjustPopover.value

        state.open = false
        state.anchor = null
        document.removeEventListener('pointerdown', onAdjustPopoverOutside, true)
        document.removeEventListener('keydown', onAdjustPopoverKeydown, true)
        window.removeEventListener('resize', onAdjustPopoverFollow)
        window.removeEventListener('scroll', onAdjustPopoverFollow, true)
    }

    /** 模式切换预填输入(对齐原版 popover change 事件) */
    function onAdjustModeChange(): void {
        const state = adjustPopover.value

        if (state.mode === 'remaining') {
            state.input = String(Math.max(0, state.total - state.used))
        } else {
            state.input = String(state.total)
        }
    }

    /** 提交额度调整(对齐原版 _savePopoverValue → admin_model_quota_update) */
    async function submitQuotaAdjust(): Promise<void> {
        const state = adjustPopover.value
        const inputRaw = Number.parseInt(state.input, 10)
        const inputValue = Math.max(0, Number.isFinite(inputRaw) ? inputRaw : 0)

        state.submitting = true

        try {
            const nextTotal = state.mode === 'remaining' ? state.used + inputValue : inputValue

            await updateModelQuota({
                provider: state.provider,
                model: state.model,
                op: 'set',
                total_tokens: nextTotal,
            })

            showToast('模型额度已更新', 'success')
            closeAdjustPopover()
            await loadQuota()
        } catch (error) {
            showError(error instanceof Error ? error.message : '额度调整失败')
        } finally {
            state.submitting = false
        }
    }

    /** 上下文/额度展示(定宽对齐;每行都显示用/共,无额度记录显示 0,对齐原版 quota-model-row) */
    function quotaCtx(model: { id: string; context_window: number }): string {
        const quota = quotaByModel(model)

        if (quota?.quota_set) {
            return quota.is_exhausted ? '已耗尽' : `${formatQuota(quota.tokens, quotaUnit.value)}/${formatQuota(quota.quota_total_tokens, quotaUnit.value)}`
        }

        if (model.context_window) {
            return `${model.context_window.toLocaleString()} ctx`
        }

        return ''
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

    /** 提交新增/编辑供应商(对齐原版 admin_upsert_provider) */    async function submitProvider(): Promise<void> {
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

    /** 页头筛选输入转发 */
    function setQuery(value?: string): void {
        query.value = String(value || '')
    }

    /** 页头单位下拉选择(持久化) */
    function setQuotaUnit(value?: string): void {
        onQuotaUnitChange(String(value || 'auto'))
    }

    /** 某 provider 的模型数 */
    function modelCountByProvider(provider: string): number {
        return Object.values(models.value).filter((m) => String(m.provider || '') === provider).length
    }

    defineExpose({
        handleAddProvider,
        handleAddModel,
        load,
        loadQuota,
        setQuery,
        setQuotaUnit,
    })
</script>