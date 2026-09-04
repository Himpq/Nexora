<!--
    AdminSearchPanel.vue — 管理员:搜索 API(对齐地图/生图 管理面板)

    设计:
      - 复用 AdminPanel 布局:左 Provider 列表(首位 Exa 必填密钥) + 右可编辑配置表单
      - 详情按 provider 渲染表单，Exa 的 api_key 为必填（红星），支持设为默认
      - 保存走 /api/admin/search/config；移动端通过 AdminPanel 的 detailOpen 两级钻取兼容
-->

<template>
    <AdminPanel class="admin-search-panel">
        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
            <div v-else-if="!providerEntries.length" class="admin-user-detail-empty">暂无搜索提供方</div>
            <div
                v-for="[provider, info] in providerEntries"
                :key="provider"
                class="admin-user-item"
                :class="{ active: selectedProvider === provider }"
                role="button"
                tabindex="0"
                @click="selectedProvider = provider"
                @keydown.enter="selectedProvider = provider"
            >
                <span class="provider-icon">
                    <i :class="providerIcon(provider)" aria-hidden="true"></i>
                </span>
                <span class="admin-user-main">
                    <span class="admin-user-name">{{ providerLabel(provider) }}</span>
                    <span class="admin-user-meta">
                        {{ providerMeta(provider, info) }}
                        <template v-if="provider === config?.active_provider"> · 默认</template>
                    </span>
                    <span class="admin-map-badges">
                        <span class="model-status-pill" :class="provider === config?.active_provider ? 'ok' : 'muted'">
                            {{ provider === config?.active_provider ? '默认' : '可选' }}
                        </span>
                        <span class="model-status-pill" :class="isProviderReady(provider, info) ? 'ok' : 'warn'">
                            {{ isProviderReady(provider, info) ? '配置完整' : '配置缺失' }}
                        </span>
                    </span>
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selectedInfo" class="admin-user-detail-empty">请选择左侧提供方查看详情</div>
            <div v-else>
                <div class="admin-user-detail-head">
                    <span class="admin-user-avatar">
                        <i :class="providerIcon(selectedProvider)" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name">{{ providerLabel(selectedProvider) }}</div>
                        <div class="admin-user-meta">{{ isCurrentDefault ? '当前默认搜索服务' : '可切换搜索服务' }}</div>
                    </div>
                </div>

                <div v-if="selectedProvider === 'exa' && !formExa.has_api_key" class="admin-map-missing" style="margin-bottom:10px;">
                    <div class="admin-map-missing-item">Exa Web Search 需要填写 API Key（首位必填）</div>
                </div>

                <!-- Exa 表单 -->
                <template v-if="selectedProvider === 'exa'">
                    <div class="admin-map-config-title">Exa Web Search 配置</div>
                    <div class="admin-user-detail-grid admin-map-config-grid">
                        <div class="gddp-form-field">
                            <label>API Key <span style="color:var(--color-danger-text)">*</span></label>
                            <input
                                v-model="formExa.api_key"
                                class="gddp-input"
                                type="password"
                                autocomplete="off"
                                :placeholder="formExa.api_key_masked || 'exa-...'"
                            >
                        </div>

                        <div class="gddp-form-field">
                            <label>搜索类型</label>
                            <SettingSelect v-model="formExa.type" :options="exaTypeOptions" width="100%" />
                        </div>
                        <div class="gddp-form-field" style="grid-column: 1 / -1;">
                            <label>Base URL</label>
                            <input v-model="formExa.base_url" class="gddp-input" type="text" placeholder="https://api.exa.ai">
                        </div>

                        <div class="gddp-form-field">
                            <label>超时秒数</label>
                            <input v-model="formExa.timeout" class="gddp-input" type="number" :min="5" :max="60" placeholder="20">
                        </div>
                        <div class="gddp-form-field">
                            <label>默认条数</label>
                            <input v-model="formExa.num_results" class="gddp-input" type="number" :min="1" :max="20" placeholder="10">
                        </div>
                    </div>
                    <div class="settings-help-text" style="margin-top:8px;">
                        获取 Key：<a href="https://dashboard.exa.ai" target="_blank" rel="noopener">dashboard.exa.ai</a> · 文档以 https://docs.exa.ai/reference/search-api-guide-for-coding-agents 为准
                    </div>
                </template>

                <!-- DuckDuckGo 表单 -->
                <template v-else-if="selectedProvider === 'duckduckgo'">
                    <div class="admin-map-config-title">DuckDuckGo 配置（免 Key）</div>
                    <div class="admin-user-detail-grid admin-map-config-grid">
                        <div class="gddp-form-field">
                            <label>Backend</label>
                            <SettingSelect v-model="formDdg.backend" :options="ddgBackendOptions" width="100%" />
                        </div>
                        <div class="gddp-form-field">
                            <label>Region</label>
                            <input v-model="formDdg.region" class="gddp-input" type="text" placeholder="wt-wt">
                        </div>
                        <div class="gddp-form-field">
                            <label>SafeSearch</label>
                            <SettingSelect v-model="formDdg.safesearch" :options="ddgSafeOptions" width="100%" />
                        </div>
                        <div class="gddp-form-field">
                            <label>TimeLimit</label>
                            <input v-model="formDdg.timelimit" class="gddp-input" type="text" placeholder="w">
                        </div>
                        <div class="gddp-form-field">
                            <label>超时秒数</label>
                            <input v-model="formDdg.timeout" class="gddp-input" type="number" :min="1" :max="120" placeholder="15">
                        </div>
                    </div>
                    <div class="settings-help-text" style="margin-top:8px;">
                        无需密钥，适合本地/内网演示；反爬时建议切换至 Exa
                    </div>
                </template>

                <SettingActionRow>
                    <button class="btn-primary-outline" type="button" @click="saveConfig(false)">
                        <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                        <span>保存配置</span>
                    </button>
                    <button
                        class="btn-primary-outline"
                        type="button"
                        :disabled="isCurrentDefault"
                        @click="saveConfig(true)"
                    >
                        <i class="fa-solid fa-star" aria-hidden="true"></i>
                        <span>{{ isCurrentDefault ? '已是默认' : '设为默认' }}</span>
                    </button>
                </SettingActionRow>
            </div>
        </template>
    </AdminPanel>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref, watch } from 'vue'

    import { fetchSearchConfig, saveSearchConfig } from '@/api/admin-search'
    import type { SearchConfig, SearchProviderConfig } from '@/api/admin-search'
    import { showError, showToast } from '@/stores/notify'

    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const exaTypeOptions = [
        { value: 'auto', label: 'auto（推荐）' },
        { value: 'fast', label: 'fast' },
        { value: 'instant', label: 'instant' },
        { value: 'deep-lite', label: 'deep-lite' },
        { value: 'deep', label: 'deep' },
        { value: 'deep-reasoning', label: 'deep-reasoning' },
    ]

    const ddgBackendOptions = [
        { value: 'html', label: 'html（推荐）' },
        { value: 'api', label: 'api' },
    ]

    const ddgSafeOptions = [
        { value: 'moderate', label: 'moderate' },
        { value: 'strict', label: 'strict' },
        { value: 'off', label: 'off' },
    ]

    const STORAGE_KEY = 'admin_search_selected_provider'

    const loading = ref(false)
    const saving = ref(false)
    const config = ref<SearchConfig | null>(null)
    const selectedProvider = ref('exa')

    const formExa = reactive<{
        api_key: string
        api_key_masked: string
        has_api_key: boolean
        base_url: string
        type: string
        timeout: string
        num_results: string
    }>({
        api_key: '',
        api_key_masked: '',
        has_api_key: false,
        base_url: 'https://api.exa.ai',
        type: 'auto',
        timeout: '20',
        num_results: '10',
    })

    const formDdg = reactive<{
        backend: string
        region: string
        safesearch: string
        timelimit: string
        timeout: string
    }>({
        backend: 'html',
        region: 'wt-wt',
        safesearch: 'moderate',
        timelimit: 'w',
        timeout: '15',
    })

    /** 左侧列表：首位 exa，其余按 supported_providers 顺序 */
    const providerEntries = computed(() => {
        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return [['exa', {}], ['duckduckgo', {}]] as Array<[string, SearchProviderConfig]>
        }

        // 固定 exa 首位
        const order = ['exa', 'duckduckgo']
        const entries: Array<[string, SearchProviderConfig]> = []

        for (const key of order) {
            if (key in providers) {
                entries.push([key, providers[key] as SearchProviderConfig])
            }
        }

        // 兼容额外 provider
        for (const [k, v] of Object.entries(providers)) {
            if (!order.includes(k)) {
                entries.push([k, v as SearchProviderConfig])
            }
        }

        return entries
    })

    const selectedInfo = computed<SearchProviderConfig | null>(() => {
        if (!selectedProvider.value) return null
        return config.value?.providers?.[selectedProvider.value] as SearchProviderConfig || null
    })

    const isCurrentDefault = computed(() => {
        return String(config.value?.active_provider || '') === String(selectedProvider.value || '')
    })

    watch(selectedProvider, (val) => {
        try {
            if (val) localStorage.setItem(STORAGE_KEY, String(val))
        } catch {
            // ignore storage errors
        }

        syncFormFromConfig()
    })

    onMounted(() => {
        void load()
    })

    function providerLabel(provider: string): string {
        if (provider === 'exa') return 'Exa Web Search'
        if (provider === 'duckduckgo') return 'DuckDuckGo'
        return provider
    }

    function providerIcon(provider: string): string {
        if (provider === 'exa') return 'fa-solid fa-magnifying-glass'
        if (provider === 'duckduckgo') return 'fa-brands fa-duckduckgo'
        return 'fa-solid fa-magnifying-glass'
    }

    function providerMeta(provider: string, info: SearchProviderConfig): string {
        if (provider === 'exa') {
            return info?.has_api_key ? '已配置密钥' : '未配置密钥'
        }

        return String((info as unknown as Record<string, unknown>)?.backend || 'html')
    }

    function isProviderReady(provider: string, info: SearchProviderConfig): boolean {
        if (provider === 'exa') return Boolean(info?.has_api_key)
        return true
    }

    function syncFormFromConfig(): void {
        const providers = config.value?.providers || {}

        const exa = providers['exa'] as SearchProviderConfig | undefined
        if (exa) {
            formExa.api_key = ''
            formExa.api_key_masked = String(exa.api_key_masked || '')
            formExa.has_api_key = Boolean(exa.has_api_key)
            formExa.base_url = String(exa.base_url || 'https://api.exa.ai')
            formExa.type = String(exa.type || 'auto')
            formExa.timeout = String(exa.timeout ?? 20)
            formExa.num_results = String(exa.num_results ?? 10)
        }

        const ddg = providers['duckduckgo'] as SearchProviderConfig | undefined
        if (ddg) {
            formDdg.backend = String(ddg.backend || 'html')
            formDdg.region = String(ddg.region || 'wt-wt')
            formDdg.safesearch = String(ddg.safesearch || 'moderate')
            formDdg.timelimit = String(ddg.timelimit || 'w')
            formDdg.timeout = String(ddg.timeout ?? 15)
        }
    }

    async function load(): Promise<void> {
        if (loading.value) return
        loading.value = true

        try {
            config.value = await fetchSearchConfig()

            // 优先恢复上次用户选择（localStorage），否则回落到 active_provider，否则首位 exa
            let desired = ''

            try {
                desired = String(localStorage.getItem(STORAGE_KEY) || '').trim()
            } catch {
                desired = ''
            }

            const active = String(config.value.active_provider || 'exa').trim()
            const candidates = providerEntries.value.map(([k]) => k)

            if (desired && candidates.includes(desired)) {
                selectedProvider.value = desired
            } else if (active && candidates.includes(active)) {
                selectedProvider.value = active
            } else if (candidates.length) {
                selectedProvider.value = candidates[0]
            }

            syncFormFromConfig()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载搜索配置失败')
        } finally {
            loading.value = false
        }
    }

    async function saveConfig(setDefault: boolean): Promise<void> {
        if (!selectedProvider.value) {
            showToast('请选择搜索提供方', 'warning')
            return
        }

        if (saving.value) return

        // Exa 校验：若设为默认或保存的是 exa 且已设为默认，需检查 key
        if (selectedProvider.value === 'exa' && setDefault) {
            const hasKey = Boolean(formExa.has_api_key || formExa.api_key.trim())
            if (!hasKey) {
                showToast('Exa Web Search 需要填写 API Key 才能设为默认', 'warning')
                return
            }
        }

        const timeoutExa = formExa.timeout.trim()
        if (selectedProvider.value === 'exa' && timeoutExa && (!/^\d+$/.test(timeoutExa) || Number(timeoutExa) < 5 || Number(timeoutExa) > 60)) {
            showToast('Exa 超时必须在 5 到 60 秒之间', 'warning')
            return
        }

        const timeoutDdg = formDdg.timeout.trim()
        if (selectedProvider.value === 'duckduckgo' && timeoutDdg && (!/^\d+$/.test(timeoutDdg) || Number(timeoutDdg) < 1 || Number(timeoutDdg) > 120)) {
            showToast('DuckDuckGo 超时必须在 1 到 120 秒之间', 'warning')
            return
        }

        saving.value = true

        try {
            const providers: Record<string, Record<string, unknown>> = {}

            // 仅提交当前选中 provider 的增量，避免覆盖另一家
            if (selectedProvider.value === 'exa') {
                const exaPayload: Record<string, unknown> = {
                    base_url: formExa.base_url.trim() || 'https://api.exa.ai',
                    type: formExa.type,
                    timeout: Number(formExa.timeout) || 20,
                    num_results: Number(formExa.num_results) || 10,
                }

                // 仅当用户输入了新 key 时才提交，避免 masked 覆盖
                if (formExa.api_key.trim()) {
                    exaPayload.api_key = formExa.api_key.trim()
                }

                providers.exa = exaPayload
            } else if (selectedProvider.value === 'duckduckgo') {
                providers.duckduckgo = {
                    backend: formDdg.backend,
                    region: formDdg.region.trim() || 'wt-wt',
                    safesearch: formDdg.safesearch,
                    timelimit: formDdg.timelimit.trim() || 'w',
                    timeout: Number(formDdg.timeout) || 15,
                }
            }

            const next = await saveSearchConfig({
                active_provider: setDefault ? selectedProvider.value : undefined,
                providers,
            })

            config.value = next
            syncFormFromConfig()

            if (setDefault) {
                showToast(`已切换为默认搜索：${providerLabel(selectedProvider.value)}`, 'success')
            } else {
                showToast('搜索配置已保存', 'success')
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        } finally {
            saving.value = false
        }
    }

    defineExpose({
        load,
    })
</script>

<style scoped>
    .admin-map-badges {
        display: inline-flex;
        gap: 6px;
        margin-top: 4px;
    }

    .admin-map-config-title {
        margin: 14px 0 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-secondary);
    }

    .admin-map-config-field-full {
        grid-column: 1 / -1;
    }

    .admin-map-missing {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .admin-map-missing-item {
        padding: 6px 10px;
        border: 1px solid var(--color-warning-border);
        border-radius: 7px;
        background: var(--color-warning-surface);
        color: var(--color-warning-text);
        font-size: 12px;
        font-family: ui-monospace, "SF Mono", Consolas, monospace;
        word-break: break-all;
    }

    .admin-exa-billing {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-sunken);
    }

    .admin-exa-billing-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
    }

    .admin-exa-billing-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .admin-exa-billing-refresh {
        padding: 4px 10px;
        font-size: 12px;
        line-height: 1;
    }

    .admin-exa-billing-empty,
    .admin-exa-billing-loading {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .admin-exa-billing-error {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--color-danger-text);
        background: var(--color-danger-surface);
        border: 1px solid var(--color-danger-border);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 12px;
        word-break: break-all;
    }

    .admin-exa-billing-value {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
    }

    .admin-exa-billing-amount {
        font-size: 22px;
        font-weight: 700;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
    }

    .admin-exa-billing-currency {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-secondary);
    }

    .admin-exa-billing-sub {
        margin-left: 6px;
        font-size: 11px;
        font-weight: 400;
        color: var(--color-text-tertiary, #999);
    }

    .admin-exa-billing-period {
        font-size: 11px;
        color: var(--color-text-secondary);
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 2px 8px;
    }

    .admin-exa-billing-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .admin-exa-billing-breakdown {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 2px;
    }

    .admin-exa-billing-breakdown-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .admin-exa-billing-breakdown-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .admin-exa-billing-breakdown-qty {
        font-variant-numeric: tabular-nums;
        color: var(--color-text-secondary);
    }

    .admin-exa-billing-breakdown-amt {
        font-weight: 600;
        color: var(--color-text-primary);
        font-variant-numeric: tabular-nums;
    }

    .admin-exa-billing-endpoint {
        font-size: 11px;
        color: var(--color-text-tertiary, #999);
        font-family: ui-monospace, "SF Mono", Consolas, monospace;
    }
</style>
