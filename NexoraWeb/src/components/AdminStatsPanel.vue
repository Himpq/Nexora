<!--
    AdminStatsPanel.vue — 管理员:统计信息(对齐原版 settings-admin-stats-tab)

    结构:
      - 总览卡(总用户 / 管理员 / 总 Token)
      - Token Trend 30d:ECharts 折线 + 模型 Top
      - 单用户 Token 查询:用户选择器 + 范围 + 摘要卡 + 明细表
      - Tool Observability 30d:四卡 + ECharts + 24h 失败工具
-->

<template>
    <div class="admin-stats-panel">
        <!-- 总览 -->
        <div class="admin-stats-grid">
            <div class="stat-card">
                <span class="label">总用户数</span>
                <span class="value mono">{{ totalUsers }}</span>
            </div>
            <div class="stat-card">
                <span class="label">管理员数</span>
                <span class="value mono">{{ adminCount }}</span>
            </div>
            <div class="stat-card">
                <span class="label">总 Token 消耗</span>
                <span class="value mono">{{ formatNumber(totalTokens) }}</span>
            </div>
        </div>

        <!-- Token Trend -->
        <div class="admin-token-trend-card">
            <div class="admin-token-trend-head">
                <h4>Token Trend (30d)</h4>
                <span class="admin-token-trend-meta">{{ trendMeta }}</span>
            </div>
            <div ref="trendChartRef" class="admin-token-trend-chart"></div>
            <div v-if="trendTopModels.length" class="admin-token-trend-top">
                <span v-for="row in trendTopModels" :key="row.name" class="trend-top-chip" :title="`${row.name}: ${formatNumber(row.tokens)}`">
                    {{ row.name }} <b>{{ formatNumber(row.tokens) }}</b>
                </span>
            </div>
        </div>

        <!-- 单用户 Token 查询 -->
        <div class="admin-token-trend-card admin-user-token-card">
            <div class="admin-token-trend-head">
                <h4>单用户 Token 查询</h4>
                <span class="admin-token-trend-meta">{{ userQueryMeta }}</span>
            </div>
            <div class="admin-user-token-query">
                <div class="admin-user-token-selector" ref="userSelectorRef">
                    <input
                        v-model="userQueryInput"
                        class="input-modern"
                        placeholder="输入用户 ID"
                        autocomplete="off"
                        @focus="openUserMenu"
                        @input="openUserMenu"
                        @keydown="onUserKeydown"
                    >
                    <button class="admin-user-token-clear" type="button" title="清空" @click="clearUserQuery">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                    <div v-if="userMenuOpen && filteredUsers.length" class="admin-user-token-menu" role="listbox">
                        <button
                            v-for="(user, index) in filteredUsers"
                            :key="user.user_id"
                            type="button"
                            class="admin-user-token-item"
                            :class="{ 'is-active': index === userActiveIndex }"
                            @click="pickUser(user)"
                        >
                            <span class="admin-user-token-avatar">
                                <img v-if="user.avatar_url" :src="user.avatar_url" alt="">
                                <i v-else class="fa-solid fa-user" aria-hidden="true"></i>
                            </span>
                            <span class="admin-user-token-meta">
                                <span class="admin-user-token-name">{{ user.username || user.user_id }}</span>
                                <span class="admin-user-token-handle">@{{ user.user_id }} · {{ roleText(user.role) }}</span>
                            </span>
                        </button>
                    </div>
                </div>
                <SettingSelect
                    v-model="userQueryRange"
                    :options="rangeOptions"
                    width="120px"
                />
                <button class="btn-primary-outline" type="button" @click="submitUserQuery">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <span>查询</span>
                </button>
            </div>

            <div v-if="userStats" class="admin-user-token-summary-grid">
                <div class="stat-card">
                    <span class="label">PAPI 调用 Token</span>
                    <span class="value mono">{{ formatNumber(userStats.summary.papi_total_tokens) }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">输入 Token</span>
                    <span class="value mono">{{ formatNumber(userStats.summary.input_tokens) }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">输出 Token</span>
                    <span class="value mono">{{ formatNumber(userStats.summary.output_tokens) }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">总 Token</span>
                    <span class="value mono">{{ formatNumber(userStats.summary.total_tokens) }}</span>
                </div>
            </div>

            <div v-if="userStats" class="admin-user-token-recent-wrap">
                <table class="admin-user-token-recent-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>来源</th>
                            <th>模型</th>
                            <th>Token</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="!userStats.recent.length"><td colspan="4">暂无查询结果</td></tr>
                        <tr v-for="(row, index) in userStats.recent" :key="index">
                            <td>{{ formatDateTime(row.timestamp) }}</td>
                            <td>{{ row.source }}</td>
                            <td>{{ row.model }}</td>
                            <td class="mono">{{ formatNumber(row.total_tokens) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Top Providers / Top Models(对齐原版 renderAdminUserTokenStats topEl) -->
            <div v-if="userStats" class="admin-user-token-top-blocks">
                <div class="admin-user-token-top-block">
                    <div class="admin-user-token-top-title">Top Providers</div>
                    <div v-if="userStats.top_providers.length" class="admin-user-token-top-rows">
                        <div v-for="row in userStats.top_providers.slice(0, 5)" :key="row.name" class="admin-user-token-top-row">
                            <span>{{ row.name }}</span>
                            <span class="mono">{{ formatNumber(row.tokens) }}</span>
                        </div>
                    </div>
                    <div v-else class="admin-user-token-top-empty">-</div>
                </div>
                <div class="admin-user-token-top-block">
                    <div class="admin-user-token-top-title">Top Models</div>
                    <div v-if="userStats.top_models.length" class="admin-user-token-top-rows">
                        <div v-for="row in userStats.top_models.slice(0, 5)" :key="row.name" class="admin-user-token-top-row">
                            <span>{{ row.name }}</span>
                            <span class="mono">{{ formatNumber(row.tokens) }}</span>
                        </div>
                    </div>
                    <div v-else class="admin-user-token-top-empty">-</div>
                </div>
            </div>
        </div>

        <!-- Tool Observability -->
        <div class="admin-token-trend-card">
            <div class="admin-token-trend-head">
                <h4>Tool Observability (30d)</h4>
                <span class="admin-token-trend-meta">{{ toolMeta }}</span>
            </div>
            <div class="admin-tool-stats-grid">
                <div class="stat-card">
                    <span class="label">工具调用总数</span>
                    <span class="value mono">{{ formatNumber(toolSummary.total_calls) }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">错误率</span>
                    <span class="value mono">{{ toolSummary.error_rate }}%</span>
                </div>
                <div class="stat-card">
                    <span class="label">平均耗时(ms)</span>
                    <span class="value mono">{{ toolSummary.avg_latency_ms }}</span>
                </div>
                <div class="stat-card">
                    <span class="label">24h 失败工具数</span>
                    <span class="value mono">{{ failedTools24h }}</span>
                </div>
            </div>
            <div ref="toolChartRef" class="admin-token-trend-chart"></div>
            <div v-if="topFailedTools.length" class="admin-token-trend-top">
                <span v-for="row in topFailedTools" :key="row.name" class="trend-top-chip danger" :title="`${row.name}: ${row.errors} 次失败`">
                    {{ row.name }} <b>{{ row.errors }}</b>
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
    import * as echarts from 'echarts'

    import type { AdminUser } from '@/api/admin-users'
    import { listAdminUsers } from '@/api/admin-users'
    import type { ToolStats, UserTokenStats } from '@/api/admin-stats'
    import { fetchAdminTokenStats, fetchToolStats, fetchTokenTimeseries, fetchUserTokenStats } from '@/api/admin-stats'
    import { showError } from '@/stores/notify'

    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const totalUsers = ref(0)
    const adminCount = ref(0)
    const totalTokens = ref(0)

    /** Token 趋势 */
    const trendChartRef = ref<HTMLDivElement | null>(null)
    const trendMeta = ref('加载中...')
    const trendTopModels = ref<Array<{ name: string; tokens: number }>>([])
    let trendChart: echarts.ECharts | null = null

    /** 单用户查询 */
    const userSelectorRef = ref<HTMLElement | null>(null)
    const userQueryInput = ref('')
    const userQueryRange = ref('30d')
    const userMenuOpen = ref(false)
    const userActiveIndex = ref(0)
    const userQueryMeta = ref('请选择用户')
    const userStats = ref<UserTokenStats | null>(null)
    const allUsers = ref<AdminUser[]>([])

    const rangeOptions = [
        { value: 'today', label: '今日' },
        { value: '7d', label: '7 天' },
        { value: '30d', label: '30 天' },
        { value: 'all', label: '全部' },
    ]

    /** Tool 观测 */
    const toolChartRef = ref<HTMLDivElement | null>(null)
    const toolSummary = ref({ total_calls: 0, error_rate: 0, avg_latency_ms: 0 })
    const toolMeta = ref('加载中...')
    const failedTools24h = ref(0)
    const topFailedTools = ref<Array<{ name: string; errors: number }>>([])
    let toolChart: echarts.ECharts | null = null

    const filteredUsers = computed(() => {
        const keyword = userQueryInput.value.trim().toLowerCase()

        if (!keyword) {
            return allUsers.value.slice(0, 8)
        }

        return allUsers.value.filter((user) => {
            return [
                String(user.user_id || ''),
                String(user.username || ''),
                String(user.role || ''),
            ].join(' ').toLowerCase().includes(keyword)
        }).slice(0, 8)
    })

    /** 角色友好文案(对齐原版菜单 handle) */
    function roleText(role: string): string {
        return String(role || 'member').toLowerCase() === 'admin' ? '管理员' : '成员'
    }

    onMounted(() => {
        void loadAll()
    })

    onBeforeUnmount(() => {
        trendChart?.dispose()
        toolChart?.dispose()
        document.removeEventListener('click', onPageClick)
    })

    async function loadAll(): Promise<void> {
        try {
            const [users, tokens] = await Promise.all([listAdminUsers(), fetchAdminTokenStats()])

            allUsers.value = users
            totalUsers.value = users.length
            adminCount.value = users.filter((user) => String(user.role || '').toLowerCase() === 'admin').length
            totalTokens.value = tokens
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载统计失败')
        }

        void loadTrend()
        void loadTools()
    }

    /** Token 趋势图 */
    async function loadTrend(): Promise<void> {
        try {
            const data = await fetchTokenTimeseries(30)

            trendMeta.value = data.series.total_tokens.length
                ? `共 ${formatNumber(data.series.total_tokens.reduce((a, b) => a + b, 0))} tokens · ${data.series.requests.reduce((a, b) => a + b, 0)} 次请求`
                : '暂无数据'
            trendTopModels.value = data.top_models.map((row) => ({ name: row.name, tokens: row.tokens }))

            await nextTick()

            if (trendChartRef.value) {
                trendChart?.dispose()
                trendChart = echarts.init(trendChartRef.value)

                trendChart.setOption({
                    grid: { left: 12, right: 12, top: 28, bottom: 8, containLabel: true },
                    tooltip: { trigger: 'axis', confine: true },
                    legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#7a7a7a' } },
                    xAxis: { type: 'category', data: data.labels, axisLine: { lineStyle: { color: '#e2e2e2' } }, axisLabel: { fontSize: 10, color: '#999' } },
                    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { fontSize: 10, color: '#999' } },
                    series: [
                        { name: '输入', type: 'line', smooth: true, showSymbol: false, data: data.series.input_tokens, lineStyle: { width: 2, color: '#8b95a7' }, itemStyle: { color: '#8b95a7' } },
                        { name: '输出', type: 'line', smooth: true, showSymbol: false, data: data.series.output_tokens, lineStyle: { width: 2, color: '#4f46e5' }, itemStyle: { color: '#4f46e5' } },
                        { name: '总', type: 'line', smooth: true, showSymbol: false, data: data.series.total_tokens, lineStyle: { width: 2, color: '#111111' }, itemStyle: { color: '#111111' } },
                    ],
                })
            }
        } catch (error) {
            trendMeta.value = '加载失败'
            showError(error instanceof Error ? error.message : '加载趋势失败')
        }
    }

    /** 单用户查询 */
    function onPageClick(event: MouseEvent): void {
        if (userSelectorRef.value && !userSelectorRef.value.contains(event.target as Node)) {
            userMenuOpen.value = false
        }
    }

    function openUserMenu(): void {
        userMenuOpen.value = true
        userActiveIndex.value = 0
        document.addEventListener('click', onPageClick)
    }

    /** 用户选择器键盘导航(对齐原版 papi-scope bindSelector keydown) */
    function onUserKeydown(event: KeyboardEvent): void {
        const rows = filteredUsers.value

        if (event.key === 'Escape') {
            event.preventDefault()
            userMenuOpen.value = false

            return
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            userActiveIndex.value = (userActiveIndex.value + 1) % Math.max(rows.length, 1)

            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            userActiveIndex.value = (userActiveIndex.value - 1 + Math.max(rows.length, 1)) % Math.max(rows.length, 1)

            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()
            const user = rows[userActiveIndex.value]

            if (user) {
                pickUser(user)
            } else if (!userMenuOpen.value) {
                void submitUserQuery()
            }
        }
    }

    /** 选中用户:填入 user_id(后端按 user_id 查,对齐原版 selectAdminUserTokenUser) */
    function pickUser(user: AdminUser): void {
        userQueryInput.value = String(user.user_id || user.username || '')
        userMenuOpen.value = false
        void submitUserQuery()
    }

    function clearUserQuery(): void {
        userQueryInput.value = ''
        userStats.value = null
        userQueryMeta.value = '请选择用户'
    }

    async function submitUserQuery(): Promise<void> {
        const userId = userQueryInput.value.trim()

        if (!userId) {
            userQueryMeta.value = '请先输入用户 ID'

            return
        }

        userQueryMeta.value = '查询中...'
        userMenuOpen.value = false

        try {
            const stats = await fetchUserTokenStats(userId, userQueryRange.value)

            userStats.value = stats
            userQueryMeta.value = `${userId} · ${stats.matched_logs} 条记录`
        } catch (error) {
            userStats.value = null
            userQueryMeta.value = '查询失败'
            showError(error instanceof Error ? error.message : '查询失败')
        }
    }

    /** Tool 观测图 */
    async function loadTools(): Promise<void> {
        try {
            const data: ToolStats = await fetchToolStats(30)

            toolSummary.value = {
                total_calls: data.summary.total_calls,
                error_rate: data.summary.error_rate,
                avg_latency_ms: data.summary.avg_latency_ms,
            }
            toolMeta.value = data.summary.total_calls
                ? `${data.summary.total_calls} 次调用 · 成功率 ${(100 - data.summary.error_rate).toFixed(1)}%`
                : '暂无数据'
            failedTools24h.value = data.top_failed_tools_24h.reduce((sum, row) => sum + row.errors, 0)
            topFailedTools.value = data.top_failed_tools_24h.map((row) => ({ name: row.name, errors: row.errors }))

            await nextTick()

            if (toolChartRef.value) {
                toolChart?.dispose()
                toolChart = echarts.init(toolChartRef.value)

                toolChart.setOption({
                    grid: { left: 12, right: 12, top: 28, bottom: 8, containLabel: true },
                    tooltip: { trigger: 'axis', confine: true },
                    legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#7a7a7a' } },
                    xAxis: { type: 'category', data: data.labels, axisLine: { lineStyle: { color: '#e2e2e2' } }, axisLabel: { fontSize: 10, color: '#999' } },
                    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { fontSize: 10, color: '#999' } },
                    series: [
                        { name: '调用', type: 'bar', barMaxWidth: 14, data: data.series.map((row) => row.calls), itemStyle: { color: '#111111', borderRadius: [3, 3, 0, 0] } },
                        { name: '错误', type: 'bar', barMaxWidth: 14, data: data.series.map((row) => row.errors), itemStyle: { color: '#e0a0a0', borderRadius: [3, 3, 0, 0] } },
                    ],
                })
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载工具统计失败')
        }
    }

    /** 时间格式化 */
    function formatDateTime(raw: string): string {
        if (!raw) {
            return '-'
        }

        const ms = /^\d+$/.test(raw) ? (Number(raw) > 1000000000000 ? Number(raw) : Number(raw) * 1000) : Date.parse(raw)

        try {
            return new Date(ms).toLocaleString()
        } catch {
            return raw
        }
    }

    function formatNumber(value: number | undefined): string {
        const num = Number(value || 0)

        return Number.isFinite(num) ? num.toLocaleString() : '-'
    }
</script>

<style scoped>
    .admin-stats-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .admin-token-trend-card {
        border: 1px solid #e8e8e8;
        border-radius: 10px;
        background: #fff;
        padding: 16px;
    }

    .admin-token-trend-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
    }

    .admin-token-trend-head h4 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 650;
        color: #111111;
    }

    .admin-token-trend-meta {
        font-size: 11.5px;
        color: #999999;
    }

    .admin-token-trend-chart {
        width: 100%;
        height: 220px;
    }

    .admin-token-trend-top {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
    }

    .trend-top-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px;
        border: 1px solid #e8e8e8;
        border-radius: 999px;
        background: #fafafa;
        font-size: 11.5px;
        color: #3c3c3c;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .trend-top-chip b {
        color: #111111;
        font-variant-numeric: tabular-nums;
    }

    .trend-top-chip.danger {
        border-color: #f0c4c4;
        color: #b03a2e;
    }

    .trend-top-chip.danger b {
        color: #b03a2e;
    }

    /* 单用户查询 */
    .admin-user-token-query {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 14px;
    }

    .admin-user-token-selector {
        position: relative;
        flex: 1;
        max-width: 260px;
    }

    .admin-user-token-selector .input-modern {
        padding-right: 32px;
    }

    .admin-user-token-clear {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: #999999;
        cursor: pointer;
    }

    .admin-user-token-clear:hover {
        background: #f1f1f1;
        color: #111111;
    }

    .admin-user-token-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 60;
        max-height: 220px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid #e2e2e2;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10);
    }

    .admin-user-token-menu button {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 12.5px;
        color: #3c3c3c;
        text-align: left;
        cursor: pointer;
    }

    .admin-user-token-avatar {
        flex: none;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: #f1f1f1;
        color: #7a7a7a;
        font-size: 11px;
        overflow: hidden;
    }

    .admin-user-token-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .admin-user-token-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .admin-user-token-name {
        font-size: 12.5px;
        font-weight: 550;
        color: #222222;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .admin-user-token-handle {
        font-size: 11px;
        color: #999999;
        font-variant-numeric: tabular-nums;
    }

    .admin-user-token-menu button:hover {
        background: #f1f1f1;
        color: #111111;
    }

    .admin-user-token-menu button.is-active {
        background: #f1f1f1;
        color: #111111;
    }

    .admin-user-token-menu button span {
        color: #999999;
        font-size: 11px;
    }

    .admin-user-token-summary-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 14px;
    }

    .admin-user-token-recent-wrap {
        border: 1px solid #eeeeee;
        border-radius: 8px;
        overflow: hidden;
    }

    .admin-user-token-recent-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
    }

    .admin-user-token-recent-table th,
    .admin-user-token-recent-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid #f4f4f4;
    }

    .admin-user-token-recent-table th {
        background: #fafafa;
        font-size: 11.5px;
        font-weight: 600;
        color: #7a7a7a;
    }

    .admin-user-token-recent-table tr:last-child td {
        border-bottom: none;
    }

    /* Top Providers / Top Models(对齐原版 trend-block) */
    .admin-user-token-top-blocks {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-top: 14px;
    }

    .admin-user-token-top-block {
        border: 1px solid #eeeeee;
        border-radius: 8px;
        padding: 10px 12px;
        min-width: 0;
    }

    .admin-user-token-top-title {
        font-size: 11.5px;
        font-weight: 650;
        color: #7a7a7a;
        margin-bottom: 6px;
    }

    .admin-user-token-top-rows {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .admin-user-token-top-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 12px;
        color: #3c3c3c;
        min-width: 0;
    }

    .admin-user-token-top-row span:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .admin-user-token-top-row .mono {
        flex: none;
        color: #111111;
        font-variant-numeric: tabular-nums;
    }

    .admin-user-token-top-empty {
        font-size: 12px;
        color: #999999;
    }

    /* Tool 观测 */
    .admin-tool-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 12px;
    }
</style>