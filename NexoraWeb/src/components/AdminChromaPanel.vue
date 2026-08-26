<!--
    AdminChromaPanel.vue — 管理员:向量库(对齐原版 settings-admin-chroma-tab)

    结构:
      - 状态卡(ChromaDB 状态 / 向量总数 / 集合数)
      - 搜索框 + admin-table(Collection / 向量数)
-->

<template>
    <div class="admin-chroma-panel">
        <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
        <div v-else-if="!stats.enabled" class="admin-user-detail-empty">
            向量库未启用{{ stats.message ? `:${stats.message}` : '' }}
        </div>
        <div v-else>
            <div class="admin-stats-grid">
                <div class="stat-card">
                    <span class="label">ChromaDB 状态</span>
                    <span class="value mono" style="font-size:14px;">{{ stats.mode || 'service' }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">向量总数</span>
                    <span class="value mono" style="font-size:14px;">{{ totalVectors.toLocaleString() }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">集合数</span>
                    <span class="value mono" style="font-size:14px;">{{ filteredCollections.length }}</span>
                </div>
            </div>

            <div class="admin-search-bar">
                <input v-model="query" class="gddp-input" placeholder="搜索向量库..." style="flex:1;" @keydown.enter="applyFilter">
                <button class="btn-primary" type="button" @click="applyFilter">搜索</button>
            </div>
            <div v-if="searchHint" class="chroma-search-hint">{{ searchHint }}</div>

            <div class="admin-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Collection</th>
                            <th>向量数</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="!filteredCollections.length">
                            <td colspan="2">暂无集合</td>
                        </tr>
                        <tr v-for="collection in filteredCollections" :key="String(collection.name || collection.id || '')">
                            <td>{{ String(collection.name || collection.id || '未命名') }}</td>
                            <td class="mono">{{ formatVectorCount(collection) }}</td>
                        </tr>
                    </tbody>
                </table>
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
    const query = ref('')
    const searchHint = ref('')
    const stats = ref<ChromaStats>({
        enabled: false,
        collections: [],
        total_vectors: 0,
    })

    const collections = computed(() => {
        return Array.isArray(stats.value.collections) ? stats.value.collections : []
    })

    const filteredCollections = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return collections.value
        }

        return collections.value.filter((collection) => {
            return String(collection.name || collection.id || '').toLowerCase().includes(keyword)
        })
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

    /** 搜索按钮(输入即过滤,此处给即时反馈) */
    function applyFilter(): void {
        searchHint.value = query.value.trim()
            ? `匹配 ${filteredCollections.value.length} 个集合`
            : ''
    }

    /** 集合向量数显示 */
    function formatVectorCount(collection: Record<string, unknown>): string {
        const count = Number(collection.count || collection.vector_count || 0)

        return Number.isFinite(count) && count > 0 ? `${count.toLocaleString()}` : '0'
    }
</script>

<style scoped>
    .admin-chroma-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .admin-search-bar {
        display: flex;
        gap: 8px;
        margin-bottom: 4px;
    }

    .chroma-search-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-bottom: 8px;
    }

    .admin-table-wrapper {
        border: 1px solid var(--color-border);
        border-radius: 10px;
        overflow: hidden;
    }

    .admin-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    .admin-table th,
    .admin-table td {
        padding: 10px 14px;
        text-align: left;
        border-bottom: 1px solid var(--color-border);
    }

    .admin-table th {
        background: var(--color-bg-sunken);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-secondary);
    }

    .admin-table tr:last-child td {
        border-bottom: none;
    }
</style>