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
            <div class="model-admin-toolbar-unit">
                <label>单位</label>
                <SettingSelect
                    v-model="quotaUnit"
                    :options="quotaUnitOptions"
                    width="110px"
                />
            </div>
        </div>

        <!-- 额度策略卡(对齐原版 quotaProviderList:Provider 用量 + 超额策略) -->
        <div v-if="quotaProviders.length" class="admin-quota-card">
            <div class="admin-quota-card-head">
                <h4><i class="fa-solid fa-gauge" aria-hidden="true"></i> 模型额度</h4>
                <button class="btn-primary-outline btn-compact" type="button" @click="loadQuota">
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    <span>刷新额度</span>
                </button>
            </div>
            <div class="admin-quota-providers">
                <div v-for="provider in quotaProviders" :key="provider.name" class="admin-quota-provider">
                    <span class="provider-icon provider-icon-sm">
                        <img v-if="providerIconUrl(provider.name)" :src="providerIconUrl(provider.name)" alt="">
                        <template v-else>{{ providerIconFallback(provider.name) }}</template>
                    </span>
                    <span class="admin-quota-provider-name">{{ provider.name }}</span>
                    <span class="admin-quota-provider-stats">
                        用 {{ fmtQuota(provider.tokens) }} · 负债满刻度 {{ fmtQuota(provider.max_model_overage_tokens) }}
                    </span>
                    <div class="admin-quota-provider-action">
                        <span class="admin-quota-action-label">超额</span>
                        <SettingSelect
                            :model-value="overageAction(provider.name)"
                            :options="overageActionOptions"
                            width="130px"
                            @update:model-value="saveOverageAction(provider.name, String($event))"
                        />
                    </div>
                </div>
            </div>
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
                    <span class="provider-icon">
                        <img v-if="providerIconUrl(provider)" :src="providerIconUrl(provider)" alt="">
                        <template v-else>{{ providerIconFallback(provider) }}</template>
                    </span>
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
                        <div class="admin-model-row-main">
                            <span class="provider-icon provider-icon-sm">
                                <img v-if="providerIconUrl(selectedProvider)" :src="providerIconUrl(selectedProvider)" alt="">
                                <template v-else>{{ providerIconFallback(selectedProvider) }}</template>
                            </span>
                            <span class="admin-model-name">{{ model.name }}</span>
                            <span class="admin-model-status" :class="`model-status-${normalizeStatus(model.status)}`">
                                {{ statusLabel(model.status) }}
                            </span>
                            <span class="admin-model-ctx">{{ quotaCtx(model) }}</span>
                            <button
                                class="admin-item-delete"
                                type="button"
                                title="删除模型"
                                @click.stop="requestDeleteModel(model.id, model.name)"
                            >
                                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                        <!-- 额度计量条(对齐原版 quota-meter-shell;点击调整额度) -->
                        <div v-if="quotaByModel(model)?.quota_set" class="quota-meter-wrap" @click.stop="openQuotaAdjust(model)">
                            <div class="quota-meter-shell">
                                <div class="quota-meter-track">
                                    <div
                                        v-if="meterOverage(model) > 0"
                                        class="quota-meter-seg quota-meter-seg-overage"
                                        :style="{ right: '50%', width: `${meterOverage(model)}%` }"
                                    ></div>
                                    <div
                                        v-if="!meterHasDebt(model) && meterRemaining(model) > 0"
                                        class="quota-meter-seg quota-meter-seg-remaining"
                                        :style="{ left: '50%', width: `${meterRemaining(model)}%` }"
                                    ></div>
                                    <div
                                        v-if="!meterHasDebt(model) && meterUsed(model) > 0"
                                        class="quota-meter-seg quota-meter-seg-used"
                                        :style="{ left: `${50 + meterRemaining(model)}%`, width: `${meterUsed(model)}%` }"
                                    ></div>
                                    <div class="quota-meter-midline"></div>
                                </div>
                                <div class="quota-meter-label-row">
                                    <span class="quota-meter-label debt" v-if="(quotaByModel(model)?.overage_tokens ?? 0) > 0">负{{ fmtQuota(quotaByModel(model)?.overage_tokens) }}</span>
                                    <span class="quota-meter-label remaining" v-if="!meterHasDebt(model) && (quotaByModel(model)?.remaining_tokens ?? 0) > 0">剩{{ fmtQuota(quotaByModel(model)?.remaining_tokens) }}</span>
                                    <span class="quota-meter-label used" v-if="!meterHasDebt(model) && meterUsed(model) > 0">已用{{ fmtQuota(quotaByModel(model)?.tokens) }}</span>
                                    <span class="quota-meter-label total">共{{ fmtQuota(quotaByModel(model)?.quota_total_tokens) }}</span>
                                </div>
                            </div>
                            <span class="quota-adjust-hint">点击调整额度</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 额度调整弹层(对齐原版 quotaAdjustPopover) -->
        <div v-if="adjustPopover.open" class="quota-adjust-popover" @click.self="adjustPopover.open = false">
            <div class="quota-adjust-popover-card">
                <div class="quota-adjust-title">{{ adjustPopover.provider }} / {{ adjustPopover.model }}</div>
                <div class="quota-adjust-meta">用 {{ fmtQuota(adjustPopover.used) }} / 共 {{ fmtQuota(adjustPopover.total) }}</div>
                <div class="quota-adjust-mode">
                    <span class="quota-adjust-mode-label">调整</span>
                    <SettingSelect
                        :model-value="adjustPopover.mode"
                        :options="adjustModeOptions"
                        width="110px"
                        @update:model-value="switchAdjustMode(String($event) as 'total' | 'remaining')"
                    />
                </div>
                <div class="quota-adjust-input">
                    <input v-model="adjustPopover.input" class="input-modern" type="number" min="0" placeholder="输入额度数值" @keydown.enter="submitQuotaAdjust">
                </div>
                <div class="quota-adjust-hint-text">{{ adjustHint }}</div>
                <div class="quota-adjust-actions">
                    <button class="btn-cancel" type="button" @click="adjustPopover.open = false">取消</button>
                    <button class="btn-confirm" type="button" :disabled="adjustPopover.submitting" @click="submitQuotaAdjust">确认</button>
                </div>
            </div>
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
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { ModelInfo } from '@/api/admin-models'
    import { deleteModel, deleteProvider, fetchModelsConfig, upsertModel, upsertProvider } from '@/api/admin-models'
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
    const providersRecord = ref<Record<string, ProviderInfo>>({})
    const query = ref('')
    const selectedProvider = ref('')

    /** 额度计量(对齐原版 model-admin-item-meter) */
    const quotaMap = ref<Record<string, QuotaModelStatus>>({})
    const quotaProviders = ref<QuotaProvider[]>([])
    const quotaOverageActions = ref<Record<string, string>>({})
    const quotaDefaultAction = ref('disable_model')
    const quotaUnit = ref('auto')

    const quotaUnitOptions = [
        { value: 'auto', label: '自动' },
        { value: 'k', label: 'K' },
        { value: 'w', label: 'w' },
        { value: 'm', label: 'M' },
        { value: 'token', label: 'token' },
    ]

    /** Provider 超额策略选项(对齐原版 resolveAdminProviderOverageAction) */
    const overageActionOptions = [
        { value: 'no_op', label: '无操作' },
        { value: 'disable_model', label: '停用模型' },
        { value: 'notify_admin', label: '发送通知' },
        { value: 'disable_and_notify', label: '停用并通知' },
    ]

    /** 额度调整弹层状态(对齐原版 quotaAdjustPopover) */
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
    })

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

    const adjustModeOptions = [
        { value: 'total', label: '总量' },
        { value: 'remaining', label: '剩余' },
    ]

    /** 调整弹层提示(对齐原版 _refreshQuotaAdjustPopoverHint) */
    const adjustHint = computed(() => {
        const state = adjustPopover.value
        const input = Number(state.input)
        const nextTotal = state.mode === 'remaining' ? state.used + (Number.isFinite(input) ? input : 0) : (Number.isFinite(input) ? input : 0)
        const delta = nextTotal - state.total

        if (state.mode === 'remaining') {
            return `剩余 ${fmtQuota(input)} => 总量 ${fmtQuota(nextTotal)}(较当前${delta >= 0 ? `增加 ${fmtQuota(delta)}` : `减少 ${fmtQuota(-delta)}`})`
        }

        return `总量设为 ${fmtQuota(input)}(较当前${delta >= 0 ? `增加 ${fmtQuota(delta)}` : `减少 ${fmtQuota(-delta)}`})`
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
    })

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
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载模型配置失败')
        } finally {
            loading.value = false
        }
    }

    function selectProvider(provider: string): void {
        selectedProvider.value = provider
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
            showToast('额度已刷新', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '刷新额度失败')
        }
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

    /** 某 provider 的债务满刻度(最大超额,对齐原版 providerDebtScaleTokens) */
    function providerDebtScale(provider: string): number {
        const row = quotaProviders.value.find((item) => item.name === provider)

        return Number(row?.max_model_overage_tokens || 0)
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

    /** 是否存在债务(超额) */
    function meterHasDebt(model: { id: string; context_window?: number }): boolean {
        const quota = quotaByModel(model)

        return Boolean(quota && quota.overage_tokens > 0)
    }

    /** 右侧剩余段宽度(占总额度 50% 内的百分比;有债务时不显示) */
    function meterRemaining(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)

        if (!quota || meterHasDebt(model) || !quota.quota_total_tokens || quota.remaining_tokens === null) {
            return 0
        }

        return Math.max(0, Math.min(50, (quota.remaining_tokens / quota.quota_total_tokens) * 50))
    }

    /** 右侧已用段宽度(有债务时不显示;与剩余段合计不超过 50%) */
    function meterUsed(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)

        if (!quota || meterHasDebt(model) || !quota.quota_total_tokens) {
            return 0
        }

        const remaining = meterRemaining(model)

        return Math.max(0, Math.min(50 - remaining, (quota.tokens / quota.quota_total_tokens) * 50))
    }

    /** 左侧超额段宽度(按 provider 债务满刻度缩放,最多 50%) */
    function meterOverage(model: { id: string; context_window?: number }): number {
        const quota = quotaByModel(model)
        const debtScale = providerDebtScale(String(selectedProvider.value || ''))

        if (!quota || debtScale <= 0 || quota.overage_tokens <= 0) {
            return 0
        }

        return Math.max(0, Math.min(50, (quota.overage_tokens / debtScale) * 50))
    }

    /** 打开额度调整弹层(对齐原版 _openQuotaAdjustPopover) */
    function openQuotaAdjust(model: { id: string; context_window?: number }): void {
        const quota = quotaByModel(model)

        if (!quota) {
            return
        }

        const remaining = Math.max(0, (quota.quota_total_tokens || 0) - quota.tokens)

        adjustPopover.value = {
            open: true,
            x: 0,
            y: 0,
            provider: String(selectedProvider.value || ''),
            model: model.id,
            used: quota.tokens,
            total: quota.quota_total_tokens,
            mode: 'total',
            input: String(quota.quota_total_tokens || 0),
            submitting: false,
        }
        void remaining
    }

    /** 调整模式切换时预填输入 */
    function switchAdjustMode(mode: 'total' | 'remaining'): void {
        const state = adjustPopover.value

        if (mode === 'total') {
            state.input = String(state.total)
        } else {
            state.input = String(Math.max(0, state.total - state.used))
        }

        state.mode = mode
    }

    /** 提交额度调整(对齐原版 admin_model_quota_update) */
    async function submitQuotaAdjust(): Promise<void> {
        const state = adjustPopover.value
        const value = Number(state.input)

        if (!Number.isFinite(value) || value < 0) {
            showToast('请输入有效的额度数值', 'warning')

            return
        }

        state.submitting = true

        try {
            const total = state.mode === 'remaining' ? state.used + Math.round(value) : Math.round(value)

            await updateModelQuota({
                provider: state.provider,
                model: state.model,
                op: 'set',
                total_tokens: total,
            })

            showToast('额度已更新', 'success')
            state.open = false
            await loadQuota()
        } catch (error) {
            showError(error instanceof Error ? error.message : '额度调整失败')
        } finally {
            state.submitting = false
        }
    }

    /** 上下文/额度展示(定宽对齐) */
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