<!--
    AdminChromaPanel.vue — 管理员:向量库(对齐原版 settings-admin-chroma-tab)

    设计:
      - 顶部状态卡片(启用 / 模式 / 服务地址 / 向量总数)
      - 下方集合列表(每个集合的名称与向量数)
-->

<template>
    <div class="admin-chroma-panel">
        <div class="admin-users-toolbar admin-system-toolbar-row settings-management-toolbar">
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </div>

        <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
        <div v-else-if="!stats.enabled" class="admin-user-detail-empty">
            向量库未启用{{ stats.message ? `:${stats.message}` : '' }}
        </div>
        <div v-else>
            <div class="admin-stats-grid">
                <div class="stat-card">
                    <span class="label">模式</span>
                    <span class="value mono">{{ stats.mode || '-' }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">服务地址</span>
                    <span class="value mono">{{ stats.service_url || '-' }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">集合数</span>
                    <span class="value mono">{{ collections.length }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">向量总数</span>
                    <span class="value mono">{{ totalVectors.toLocaleString() }}</span>
                </div>
            </div>

            <div class="admin-chroma-collections">
                <div class="admin-users-toolbar admin-system-toolbar-row">
                    <h4 style="margin:0;">集合列表</h4>
                </div>
                <div v-if="!collections.length" class="admin-user-detail-empty">暂无集合</div>
                <div v-for="collection in collections" :key="String(collection.name || collection.id || '')" class="admin-chroma-collection">
                    <span class="admin-chroma-collection-name">{{ String(collection.name || collection.id || '未命名') }}</span>
                    <span class="admin-user-meta">{{ formatVectorCount(collection) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { ChromaStats } from '@/api/admin-chroma'
    import { fetchChromaStats } from '@/api/admin-chroma'
    import { showError } from '@/stores/notify'

    const loading = ref(false)
    const stats = ref<ChromaStats>({
        enabled: false,
        collections: [],
        total_vectors: 0,
    })

    const collections = computed(() => {
        return Array.isArray(stats.value.collections) ? stats.value.collections : []
    })

    const totalVectors = computed(() => Number(stats.value.total_vectors || 0))

    onMounted(() => {
        void load()
    })

    /** 拉取向量库统计 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            stats.value = await fetchChromaStats()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载向量库失败')
        } finally {
            loading.value = false
        }
    }

    /** 集合向量数显示 */
    function formatVectorCount(collection: Record<string, unknown>): string {
        const count = Number(collection.count || collection.vector_count || 0)

        return Number.isFinite(count) && count > 0 ? `${count.toLocaleString()} 个向量` : ''
    }
</script>
