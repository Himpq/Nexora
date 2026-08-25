<!--
    AdminMapPanel.vue — 管理员:地图 API(对齐原版 settings-admin-map-tab)

    设计:
      - 复用 AdminPanel 布局:左 Provider 列表(默认/配置完整徽标) + 右可编辑配置表单
      - 详情按 provider 渲染可编辑字段(auth_mode 下拉、timeout 数字、URL 全宽)
      - 保存走 /api/admin/map/provider;设为默认需配置完整(后端校验)
      - 底部展示历史地图策略说明
-->

<template>
    <AdminPanel>
        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
            <div v-else-if="!providerEntries.length" class="admin-user-detail-empty">暂无 Provider</div>
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
                    <i class="fa-regular fa-map" aria-hidden="true"></i>
                </span>
                <span class="admin-user-main">
                    <span class="admin-user-name">{{ provider }}</span>
                    <span class="admin-user-meta">
                        {{ String(info.coord_type || '-') }}
                        <template v-if="provider === config?.provider"> · 默认</template>
                    </span>
                    <span class="admin-map-badges">
                        <span class="model-status-pill" :class="provider === config?.provider ? 'ok' : 'muted'">
                            {{ provider === config?.provider ? '默认' : '可选' }}
                        </span>
                        <span class="model-status-pill" :class="info.ready ? 'ok' : 'warn'">
                            {{ info.ready ? '配置完整' : '配置缺失' }}
                        </span>
                    </span>
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selectedInfo" class="admin-user-detail-empty">请选择左侧 Provider 查看详情</div>
            <div v-else>
                <div class="admin-user-detail-head">
                    <span class="admin-user-avatar">
                        <i class="fa-regular fa-map" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name">{{ selectedProvider }}</div>
                        <div class="admin-user-meta">{{ isCurrentDefault ? '当前默认地图服务' : '可切换地图服务' }}</div>
                    </div>
                </div>

                <div v-if="selectedInfo.missing?.length" class="form-group" style="margin-bottom:10px;">
                    <label>缺失项</label>
                    <div class="admin-map-missing">
                        <div v-for="(item, index) in selectedInfo.missing" :key="index" class="admin-map-missing-item">{{ item }}</div>
                    </div>
                </div>

                <div class="admin-map-config-title">接口配置</div>
                <div class="admin-user-detail-grid admin-map-config-grid">
                    <template v-for="field in fieldsFor(selectedProvider)" :key="field">
                        <div class="form-group" :class="{ 'admin-map-config-field-full': isFullWidthField(field) }">
                            <label>{{ fieldLabel(field) }}</label>
                            <SettingSelect
                                v-if="field === 'auth_mode'"
                                :model-value="String(configForm[field] ?? 'ak')"
                                :options="authModeOptions"
                                width="100%"
                                @update:model-value="configForm[field] = String($event)"
                            />
                            <input
                                v-else
                                v-model="configForm[field]"
                                class="input-modern"
                                :type="field === 'timeout' ? 'number' : 'text'"
                                :min="field === 'timeout' ? 1 : undefined"
                                :max="field === 'timeout' ? 120 : undefined"
                                :step="field === 'timeout' ? 1 : undefined"
                            >
                        </div>
                    </template>
                </div>

                <div v-if="config?.history_policy?.summary" class="admin-map-history-policy">
                    {{ config.history_policy.summary }}
                </div>

                <div v-if="config?.config_errors?.length" class="admin-map-errors">
                    <div v-for="(error, index) in config.config_errors" :key="index" class="admin-map-error">{{ error }}</div>
                </div>

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
                        <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                        <span>{{ isCurrentDefault ? '已是默认' : '设为默认' }}</span>
                    </button>
                </SettingActionRow>
            </div>
        </template>
    </AdminPanel>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref, watch } from 'vue'

    import type { MapProviderConfig, MapProviderStatus } from '@/api/admin-map'
    import {
        MAP_PROVIDER_FIELD_LABELS,
        MAP_PROVIDER_FIELDS,
        MAP_PROVIDER_FULL_WIDTH_FIELDS,
        fetchMapProviderConfig,
        saveMapProviderConfig,
    } from '@/api/admin-map'
    import { showError, showToast } from '@/stores/notify'

    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const authModeOptions = [
        { value: 'ak', label: 'ak' },
        { value: 'sn', label: 'sn' },
    ]

    const loading = ref(false)
    const saving = ref(false)
    const config = ref<MapProviderConfig | null>(null)
    const selectedProvider = ref('')

    /** 可编辑配置表单(按选中 provider 重建) */
    const configForm = reactive<Record<string, string>>({})

    const providerEntries = computed(() => {
        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return []
        }

        return Object.entries(providers as Record<string, MapProviderStatus>)
    })

    const selectedInfo = computed<MapProviderStatus | null>(() => {
        if (!selectedProvider.value) {
            return null
        }

        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return null
        }

        return (providers as Record<string, MapProviderStatus>)[selectedProvider.value] || null
    })

    const isCurrentDefault = computed(() => {
        return String(config.value?.provider || '') === String(selectedProvider.value || '')
    })

    watch(selectedProvider, () => {
        syncFormFromConfig()
    })

    onMounted(() => {
        void load()
    })

    /** 该 provider 的可编辑字段列表 */
    function fieldsFor(provider: string): string[] {
        return MAP_PROVIDER_FIELDS[provider] || []
    }

    /** 字段中文标签 */
    function fieldLabel(field: string): string {
        return MAP_PROVIDER_FIELD_LABELS[field] || field
    }

    /** 是否全宽字段(URL 类) */
    function isFullWidthField(field: string): boolean {
        return MAP_PROVIDER_FULL_WIDTH_FIELDS.has(field)
    }

    /** 从 config 回填表单(对齐原版 renderProviderConfigFields) */
    function syncFormFromConfig(): void {
        const info = selectedInfo.value

        for (const key of Object.keys(configForm)) {
            delete configForm[key]
        }

        if (!info || !info.config || typeof info.config !== 'object') {
            return
        }

        for (const field of fieldsFor(selectedProvider.value)) {
            const raw = info.config[field]
            configForm[field] = raw === undefined || raw === null ? '' : String(raw)
        }
    }

    /** 拉取地图配置 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            config.value = await fetchMapProviderConfig()

            // 默认选中配置的默认 provider
            if (providerEntries.value.length) {
                const configured = String(config.value?.provider || '').trim()

                if (configured && providerEntries.value.some(([name]) => name === configured)) {
                    selectedProvider.value = configured
                } else {
                    selectedProvider.value = providerEntries.value[0][0]
                }
            }

            syncFormFromConfig()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载地图配置失败')
        } finally {
            loading.value = false
        }
    }

    /** 保存配置(set_default 时同时切换默认;对齐原版 saveMapProviderSettings) */
    async function saveConfig(setDefault: boolean): Promise<void> {
        if (!selectedProvider.value) {
            showToast('请选择地图 Provider', 'warning')

            return
        }

        if (saving.value) {
            return
        }

        // timeout 校验(对齐原版 readMapProviderConfigFromDetail)
        const timeoutText = String(configForm.timeout ?? '').trim()

        if (timeoutText && (!/^\d+$/.test(timeoutText) || Number(timeoutText) < 1 || Number(timeoutText) > 120)) {
            showToast('地图 API timeout 必须在 1 到 120 秒之间', 'warning')

            return
        }

        saving.value = true

        try {
            const payload: Record<string, unknown> = { ...configForm }

            if (payload.timeout !== undefined && payload.timeout !== '') {
                payload.timeout = Number(payload.timeout)
            }

            const next = await saveMapProviderConfig({
                provider: selectedProvider.value,
                config: payload,
                set_default: setDefault,
            })

            config.value = next

            if (!setDefault) {
                showToast('地图配置已保存', 'success')
            } else {
                showToast('已切换为默认地图服务', 'success')
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
        color: #3c3c3c;
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
        border: 1px solid #f3e2b3;
        border-radius: 7px;
        background: #fdf6e3;
        color: #8a6116;
        font-size: 12px;
        font-family: ui-monospace, "SF Mono", Consolas, monospace;
        word-break: break-all;
    }

    .admin-map-history-policy {
        margin-top: 14px;
        padding: 10px 12px;
        border: 1px solid #eeeeee;
        border-radius: 7px;
        background: #fafafa;
        color: #7a7a7a;
        font-size: 12px;
        line-height: 1.6;
    }

    .admin-map-errors {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 14px;
    }

    .admin-map-error {
        padding: 10px 12px;
        border: 1px solid #f0c4c4;
        border-radius: 7px;
        background: #fff7f7;
        color: #b03a2e;
        font-size: 12.5px;
    }
</style>
