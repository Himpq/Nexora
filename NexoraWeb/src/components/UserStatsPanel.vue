<template>
    <div class="user-stats-panel">
        <div class="settings-stat-summary-grid">
            <div class="settings-stat-card">
                <span class="label">对话数</span>
                <span class="value">{{ stats.total_conversations ?? '-' }}</span>
            </div>
            <div class="settings-stat-card">
                <span class="label">Token 消耗</span>
                <span class="value">{{ formatNumber(stats.total_tokens) }}</span>
            </div>
            <div class="settings-stat-card">
                <span class="label">知识点数</span>
                <span class="value">{{ stats.total_knowledge ?? '-' }}</span>
            </div>
        </div>

        <SettingCard title="Token 消耗趋势" description="按来源筛选聊天与 API Key 的消耗">
            <div class="user-stats-toolbar">
                <SettingSelect v-model="sourceFilter" :options="sourceOptions" width="150px" />
                <span class="user-stats-total">{{ formatNumber(filteredTotal) }} tokens</span>
            </div>
            <div ref="chartRef" class="user-stats-chart"></div>
        </SettingCard>

        <SettingCard v-if="sourceFilter === 'papi' && apiKeyRows.length" title="API Key 消耗" description="当前账号关联的 Public API Key 消耗">
            <SettingRow v-for="row in apiKeyRows" :key="row.name" :label="row.name">
                <span class="settings-stat-count">{{ formatNumber(row.tokens) }} tokens</span>
            </SettingRow>
        </SettingCard>

        <SettingCard title="模型使用统计" description="各模型调用次数">
            <div v-if="!modelUsageRows.length" class="settings-stat-empty">暂无数据</div>
            <SettingRow v-for="row in modelUsageRows" v-else :key="row.model" :label="row.model">
                <span class="settings-stat-count">{{ row.count }} 次调用</span>
            </SettingRow>
        </SettingCard>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import * as echarts from 'echarts'
    import { chartPalette, echartsTheme, theme } from '@/ui/theme'

    import { apiFetch } from '@/api/client'
    import { showError } from '@/stores/notify'

    import SettingCard from '@/ui/settings/SettingCard.vue'
    import SettingRow from '@/ui/settings/SettingRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    interface UserStats {
        total_conversations?: number
        total_tokens?: number
        total_knowledge?: number
        model_usage?: Record<string, number>
        source_usage?: Record<string, number>
        api_key_usage?: Record<string, number>
        daily_usage?: Record<string, Record<string, number>>
    }

    const stats = ref<UserStats>({})
    const sourceFilter = ref('all')
    const chartRef = ref<HTMLDivElement | null>(null)
    let chart: echarts.ECharts | null = null

    const sourceOptions = [
        { value: 'all', label: '全部来源' },
        { value: 'chat', label: '聊天' },
        { value: 'papi', label: 'API Key' },
    ]

    const filteredTotal = computed(() => {
        const sourceUsage = stats.value.source_usage || {}

        if (sourceFilter.value === 'all') {
            return Object.values(sourceUsage).reduce((sum, value) => sum + Number(value || 0), 0)
        }

        return Number(sourceUsage[sourceFilter.value] || 0)
    })

    const apiKeyRows = computed(() => Object.entries(stats.value.api_key_usage || {})
        .map(([name, tokens]) => ({ name, tokens: Number(tokens || 0) }))
        .sort((a, b) => b.tokens - a.tokens))

    const modelUsageRows = computed(() => Object.entries(stats.value.model_usage || {})
        .map(([model, count]) => ({ model, count: Number(count || 0) }))
        .sort((a, b) => b.count - a.count))

    /*
 * 主题切换时重建图表(echarts canvas 不继承 CSS 令牌)。
 */
watch(() => theme.resolved, () => {
    void load()
})
onMounted(() => {
        void load()
    })

    onBeforeUnmount(() => {
        chart?.dispose()
    })

    watch([sourceFilter, stats], () => {
        void renderChart()
    }, { deep: true })

    async function load(): Promise<void> {
        try {
            const data = await apiFetch<{ success: boolean; stats?: UserStats }>('/api/user/stats')

            stats.value = data.stats || {}
            await renderChart()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载统计失败')
        }
    }

    async function renderChart(): Promise<void> {
        await nextTick()

        if (!chartRef.value) {
            return
        }

        const dailyUsage = stats.value.daily_usage || {}
        const labels = Object.keys(dailyUsage).sort()
        const values = labels.map((day) => {
            const row = dailyUsage[day] || {}

            if (sourceFilter.value === 'all') {
                return Object.values(row).reduce((sum, value) => sum + Number(value || 0), 0)
            }

            return Number(row[sourceFilter.value] || 0)
        })

        chart?.dispose()
        chart = echarts.init(chartRef.value, echartsTheme())
        chart.setOption({
            
                    backgroundColor: 'transparent',grid: { left: 12, right: 12, top: 20, bottom: 8, containLabel: true },
            tooltip: { trigger: 'axis', confine: true },
            xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10, color: chartPalette.value.muted } },
            yAxis: { type: 'value', axisLabel: { fontSize: 10, color: chartPalette.value.muted }, splitLine: { lineStyle: { color: chartPalette.value.lineSplit } } },
            series: [{ name: 'Token', type: 'line', smooth: true, showSymbol: false, data: values, lineStyle: { width: 2, color: chartPalette.value.text }, itemStyle: { color: chartPalette.value.text } }],
        })
    }

    function formatNumber(value: unknown): string {
        const number = Number(value || 0)

        return Number.isFinite(number) ? number.toLocaleString() : '-'
    }
</script>

<style scoped>
    .user-stats-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .user-stats-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
    }

    .user-stats-total {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .user-stats-chart {
        width: 100%;
        height: 220px;
    }
</style>
