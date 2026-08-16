<!--
    AdminMapPanel.vue — 管理员:地图 API(对齐原版 settings-admin-map-tab)

    设计:
      - 当前默认 provider + 可用性状态
      - 各 provider 配置摘要(认证方式 / 浏览器配置)
-->

<template>
    <div class="admin-map-panel">
        <div class="admin-users-toolbar admin-system-toolbar-row settings-management-toolbar">
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </div>

        <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
        <div v-else-if="!config" class="admin-user-detail-empty">暂无地图配置</div>
        <div v-else>
            <div class="admin-stats-grid">
                <div class="stat-card">
                    <span class="label">默认 Provider</span>
                    <span class="value mono">{{ config.provider || '-' }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">可用状态</span>
                    <span class="value mono">{{ config.provider_ready ? '可用' : '未配置' }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">Provider 数</span>
                    <span class="value mono">{{ providerCount }}</span>
                </div>
            </div>

            <div class="admin-chroma-collections">
                <div class="admin-users-toolbar admin-system-toolbar-row">
                    <h4 style="margin:0;">Provider 配置</h4>
                </div>
                <div v-if="!providerEntries.length" class="admin-user-detail-empty">暂无 Provider</div>
                <div v-for="[provider, info] in providerEntries" :key="provider" class="admin-chroma-collection">
                    <span class="admin-chroma-collection-name">{{ provider }}</span>
                    <span class="admin-user-meta">{{ providerSummary(info) }}</span>
                </div>
            </div>

            <div v-if="config.config_errors && config.config_errors.length" class="admin-map-errors">
                <h4>配置问题</h4>
                <div v-for="(error, index) in config.config_errors" :key="index" class="admin-map-error">{{ error }}</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { MapProviderConfig } from '@/api/admin-map'
    import { fetchMapProviderConfig } from '@/api/admin-map'
    import { showError } from '@/stores/notify'

    const loading = ref(false)
    const config = ref<MapProviderConfig | null>(null)

    const providerCount = computed(() => {
        const providers = config.value?.providers

        return providers && typeof providers === 'object' ? Object.keys(providers).length : 0
    })

    const providerEntries = computed(() => {
        const providers = config.value?.providers

        if (!providers || typeof providers !== 'object') {
            return []
        }

        return Object.entries(providers as Record<string, Record<string, unknown>>)
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
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载地图配置失败')
        } finally {
            loading.value = false
        }
    }

    /** provider 摘要(认证方式 + 浏览器配置) */
    function providerSummary(info: Record<string, unknown>): string {
        const parts: string[] = []

        if (typeof info.auth_mode === 'string' && info.auth_mode) {
            parts.push(`认证:${info.auth_mode}`)
        }

        if (info.browser_configured) {
            parts.push('浏览器已配置')
        }

        if (typeof info.browser_version === 'string' && info.browser_version) {
            parts.push(`v${info.browser_version}`)
        }

        return parts.join(' · ') || '未配置'
    }
</script>
