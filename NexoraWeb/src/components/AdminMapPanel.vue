<!--
    AdminMapPanel.vue — 管理员:地图 API(对齐原版 settings-admin-map-tab)

    结构:
      - 工具栏:刷新状态 + 默认 Provider 选择
      - 左:Provider 列表(可用状态徽标)
      - 右:Provider 详情(认证方式 / 浏览器配置 / 版本)
-->

<template>
    <AdminPanel>
        <template #toolbar>
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新状态</span>
            </button>
            <span v-if="config" class="settings-field" style="padding:6px 12px;font-size:12px;">
                默认:{{ config.provider || '-' }} · {{ config.provider_ready ? '可用' : '未配置' }}
            </span>
        </template>

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
                    <template v-if="providerIconFallback(provider)">{{ providerIconFallback(provider) }}</template>
                </span>
                <span class="admin-user-main">
                    <span class="admin-user-name">{{ provider }}</span>
                    <span class="admin-user-meta">{{ providerSummary(info) }}</span>
                </span>
                <span class="provider-status" :class="providerStatusClass(info)">
                    {{ providerStatusLabel(info) }}
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selectedInfo" class="admin-user-detail-empty">请选择左侧 Provider 查看详情</div>
            <div v-else>
                <div class="admin-user-detail-grid">
                    <div class="form-group">
                        <label>Provider</label>
                        <div class="admin-info-text">{{ selectedProvider }}</div>
                    </div>
                    <div class="form-group">
                        <label>认证方式</label>
                        <div class="admin-info-text">{{ String(selectedInfo.auth_mode || '-') }}</div>
                    </div>
                    <div class="form-group">
                        <label>浏览器配置</label>
                        <div class="admin-info-text">{{ selectedInfo.browser_configured ? '已配置' : '未配置' }}</div>
                    </div>
                    <div class="form-group">
                        <label>浏览器版本</label>
                        <div class="admin-info-text mono">{{ String(selectedInfo.browser_version || '-') }}</div>
                    </div>
                    <div class="form-group">
                        <label>可用状态</label>
                        <div class="admin-info-text">{{ providerStatusLabel(selectedInfo) }}</div>
                    </div>
                </div>

                <div v-if="config?.config_errors?.length" class="admin-map-errors" style="margin-top:14px;">
                    <h4 style="margin:0 0 8px;font-size:13px;">配置问题</h4>
                    <div v-for="(error, index) in config.config_errors" :key="index" class="admin-map-error">{{ error }}</div>
                </div>
            </div>
        </template>
    </AdminPanel>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { MapProviderConfig } from '@/api/admin-map'
    import { fetchMapProviderConfig } from '@/api/admin-map'
    import { providerIconFallbackText } from '@/api/providerIcons'
    import { showError } from '@/stores/notify'

    import AdminPanel from '@/ui/AdminPanel.vue'

    const loading = ref(false)
    const config = ref<MapProviderConfig | null>(null)
    const selectedProvider = ref('')

    const providerEntries = computed(() => {
        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return []
        }

        return Object.entries(providers as Record<string, Record<string, unknown>>)
    })

    const selectedInfo = computed(() => {
        if (!selectedProvider.value) {
            return null
        }

        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return null
        }

        return (providers as Record<string, Record<string, unknown>>)[selectedProvider.value] || null
    })

    onMounted(() => {
        void load()
    })

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
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载地图配置失败')
        } finally {
            loading.value = false
        }
    }

    function providerIconFallback(provider: string): string {
        return providerIconFallbackText(provider)
    }

    /** provider 摘要 */
    function providerSummary(info: Record<string, unknown>): string {
        const parts: string[] = []

        if (typeof info.auth_mode === 'string' && info.auth_mode) {
            parts.push(`认证:${info.auth_mode}`)
        }

        if (info.browser_configured) {
            parts.push('浏览器已配置')
        }

        return parts.join(' · ') || '未配置'
    }

    function providerStatusClass(info: Record<string, unknown>): string {
        return info.ready ? 'ok' : 'off'
    }

    function providerStatusLabel(info: Record<string, unknown>): string {
        return info.ready ? '可用' : '未配置'
    }
</script>

<style scoped>
    .provider-status {
        flex: none;
        padding: 2px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
    }

    .provider-status.ok {
        background: #e8f5e9;
        color: #2e7d32;
    }

    .provider-status.off {
        background: #f2f2f2;
        color: #7a7a7a;
    }

    .admin-map-errors {
        display: flex;
        flex-direction: column;
        gap: 8px;
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