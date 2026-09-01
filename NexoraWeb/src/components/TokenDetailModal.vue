<!--
    TokenDetailModal.vue — Token 使用详情弹窗(GDDP)

    设计:
      - 复用 g-modal 视觉(大圆角/柔和遮罩)，与 TrashModal/SettingsModal 同体系
      - 头部 head 插槽承载标题 + 刷新按钮
      - 统计栅格 2x2（累计/今日/输入/输出）贴近 AdminStatsPanel 卡片
      - 明细表 20 行点击可下钻详情（同弹窗内抽屉，避免二级 backdrop）
      - 详情复用 MarkdownView 渲染用户提问/模型响应
-->

<template>
    <Modal
        :open="open"
        width="760px"
        modal-class="token-detail-modal"
        @close="handleClose"
    >
        <template #head>
            <div class="token-detail-head">
                <div class="token-detail-head-title">
                    <h3>Token 使用详情</h3>
                    <span class="token-detail-head-hint">当前对话消耗 · 最近 20 条可下钻</span>
                </div>

                <div class="token-detail-head-actions">
                    <Button
                        variant="quiet"
                        size="compact"
                        icon="fa-solid fa-rotate"
                        title="刷新"
                        :disabled="loading"
                        @click="loadStats"
                    >刷新</Button>
                </div>
            </div>
        </template>

        <!-- 详情下钻视图 -->
        <div v-if="detail" class="token-detail-drill">
            <div class="token-detail-drill-head">
                <Button
                    variant="quiet"
                    size="compact"
                    icon="fa-solid fa-arrow-left"
                    @click="handleBackToList"
                >返回列表</Button>

                <div class="token-detail-drill-meta">
                    <span v-if="detail.timestamp">{{ detail.timestamp }}</span>
                    <span v-if="detail.action" class="token-detail-badge" :class="`token-detail-badge--${normalizeAction(detail.action)}`">{{ detail.action.toUpperCase() }}</span>
                    <span v-if="detail.model">{{ detail.model }}</span>
                    <span class="token-detail-drill-tokens">I {{ formatNumber(detail.input_tokens) }} / O {{ formatNumber(detail.output_tokens) }}</span>
                </div>
            </div>

            <div v-if="detailLoading" class="token-detail-state">加载中...</div>

            <div v-else class="token-detail-sections">
                <section class="token-detail-section">
                    <h4>用户提问</h4>
                    <MarkdownView :content="detail.user_markdown || '该消息没有文本内容。'" />
                </section>

                <section class="token-detail-section">
                    <h4>模型响应</h4>
                    <MarkdownView :content="detail.response_markdown || '该消息没有文本内容。'" />
                </section>
            </div>
        </div>

        <!-- 列表视图 -->
        <template v-else>
            <div v-if="loading" class="token-detail-state">加载中...</div>

            <div v-else-if="loadError" class="token-detail-state is-error">
                <span>{{ loadError }}</span>
                <Button variant="secondary" size="compact" @click="loadStats">重试</Button>
            </div>

            <template v-else>
                <!-- 统计栅格 -->
                <div class="token-detail-grid">
                    <div class="token-detail-card is-total">
                        <span class="token-detail-card-label">累计消耗</span>
                        <span class="token-detail-card-value mono">{{ formatNumber(stats.total) }}</span>
                        <span class="token-detail-card-sub">输入 {{ formatNumber(stats.input_total) }} · 输出 {{ formatNumber(stats.output_total) }}</span>
                    </div>

                    <div class="token-detail-card is-today">
                        <span class="token-detail-card-label">今日消耗</span>
                        <span class="token-detail-card-value mono">{{ formatNumber(stats.today) }}</span>
                        <span class="token-detail-card-sub">输入 {{ formatNumber(stats.today_input) }} · 输出 {{ formatNumber(stats.today_output) }}</span>
                    </div>
                </div>

                <!-- 消耗趋势(ECharts) -->
                <div class="token-detail-chart-card">
                    <div class="token-detail-chart-head">
                        <h4>Token 消耗趋势</h4>
                        <span class="token-detail-chart-meta">{{ chartMeta }}</span>
                    </div>
                    <div v-if="!stats.history.length" class="token-detail-empty">{{ !props.conversationId ? '当前对话为空' : '暂无数据' }}</div>
                    <div v-else ref="chartRef" class="token-detail-chart"></div>
                </div>

                <!-- 明细表 -->
                <div class="token-detail-logs">
                    <div class="token-detail-logs-head">
                        <h4>最近记录</h4>
                        <span class="token-detail-logs-hint">显示最近 20 条 · 点击查看调用详情</span>
                    </div>

                    <div v-if="!stats.history.length" class="token-detail-empty">{{ !props.conversationId ? '当前对话为空，请先选择或创建对话' : '当前对话暂无 Token 记录' }}</div>

                    <div v-else class="token-detail-table-wrap">
                        <table class="token-detail-table">
                            <colgroup>
                                <col class="col-time" />
                                <col class="col-title" />
                                <col class="col-type" />
                                <col class="col-num" />
                            </colgroup>

                            <thead>
                                <tr>
                                    <th>时间</th>
                                    <th>对话 / 操作</th>
                                    <th>类型</th>
                                    <th class="num">合计</th>
                                </tr>
                            </thead>

                            <tbody>
                                <tr
                                    v-for="log in stats.history"
                                    :key="log.detail_ref || `${log.timestamp}-${log.total_tokens}`"
                                    class="token-detail-row"
                                    tabindex="0"
                                    role="button"
                                    :aria-label="`查看 ${log.action} 调用详情`"
                                    :class="{ 'is-disabled': !log.detail_ref }"
                                    @click="handleRowClick(log)"
                                    @keydown.enter.prevent="handleRowClick(log)"
                                    @keydown.space.prevent="handleRowClick(log)"
                                >
                                    <td :title="log.timestamp">
                                        <div class="token-log-time-date">{{ timeDate(log.timestamp) }}</div>
                                        <div class="token-log-time-clock">{{ timeClock(log.timestamp) }}</div>
                                    </td>

                                    <td class="title-cell" :title="log.conversation_title || ''">
                                        <span class="text-truncate">{{ log.conversation_title || 'Chat Operation' }}</span>
                                    </td>

                                    <td>
                                        <span class="token-detail-badge" :class="`token-detail-badge--${normalizeAction(log.action)}`">{{ normalizeAction(log.action).toUpperCase() }}</span>
                                    </td>

                                    <td class="num">
                                        <div class="token-log-split">{{ formatNumber(log.input_tokens) }}+{{ formatNumber(log.output_tokens) }}</div>
                                        <div class="token-log-total mono">{{ formatNumber(log.total_tokens || (log.input_tokens + log.output_tokens)) }}</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

    import * as echarts from 'echarts'
    import { chartPalette, echartsTheme, theme } from '@/ui/theme'

    import type { TokenDetail, TokenLog, TokenStats } from '@/api/tokens'
    import { fetchTokenDetail, fetchTokenStats } from '@/api/tokens'
    import { showError } from '@/stores/notify'

    import Button from '@/ui/Button.vue'
    import Modal from '@/ui/Modal.vue'
    import MarkdownView from '@/components/MarkdownView.vue'

    const props = defineProps<{
        open: boolean
        /** 当前对话 ID（弹窗仅展示当前对话的 Token，设置页已展示全局统计） */
        conversationId?: string
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    const loading = ref(false)
    const loadError = ref('')
    const stats = ref<TokenStats>({
        input_total: 0,
        output_total: 0,
        total: 0,
        today_input: 0,
        today_output: 0,
        today: 0,
        history: [],
    })

    const detail = ref<TokenDetail | null>(null)
    const detailLoading = ref(false)

    /** ECharts 趋势 */
    const chartRef = ref<HTMLDivElement | null>(null)
    const chartMeta = ref('加载中...')
    let chartInstance: echarts.ECharts | null = null

    /** 打开时加载一次；对话切换时若弹窗仍打开则刷新 */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                detail.value = null
                void loadStats()
            } else {
                disposeChart()
            }
        },
    )

    /*
     * 主题切换时重建图表(echarts canvas 不继承 CSS 令牌);仅面板打开时需要。
     */
    watch(
        () => theme.resolved,
        () => {
            if (props.open) {
                void loadStats()
            }
        },
    )

    watch(
        () => props.conversationId,
        () => {
            if (props.open) {
                detail.value = null
                void loadStats()
            }
        },
    )

    // 关闭弹窗时由 handleClose 主动清理,不应触发返回列表的重建逻辑
    let suppressDetailWatcher = false

    /*
     * 下钻返回列表时 chart 容器由 v-else 分支重建,原 ECharts 实例仍挂在已移除的旧 DOM 上。
     * loadStats 仅在打开/刷新时调用,此处需在 detail 置空后重新挂载图表。
     */
    watch(
        () => detail.value,
        async (current) => {
            if (suppressDetailWatcher) {
                suppressDetailWatcher = false

                return
            }

            if (current !== null) {
                return
            }

            if (!props.open || loading.value || loadError.value || !stats.value.history.length) {
                return
            }

            await nextTick()

            renderChart()
        },
    )

    function handleBackToList(): void {
        detail.value = null
    }

    onBeforeUnmount(() => {
        disposeChart()
    })

    /** 拉取统计（仅当前对话） */
    async function loadStats(): Promise<void> {
        if (loading.value) {
            return
        }

        const cid = String(props.conversationId || '').trim()

        if (!cid) {
            stats.value = {
                input_total: 0,
                output_total: 0,
                total: 0,
                today_input: 0,
                today_output: 0,
                today: 0,
                history: [],
            }
            chartMeta.value = '当前对话为空'
            loadError.value = ''
            await nextTick()
            disposeChart()

            return
        }

        loading.value = true
        loadError.value = ''

        try {
            stats.value = await fetchTokenStats(cid)
        } catch (error) {
            loadError.value = error instanceof Error ? error.message : '获取 Token 统计失败'
            chartMeta.value = '加载失败'
        } finally {
            // 先解除加载态,让 v-else 分支(统计栅格/图表/明细表)进入 DOM,再渲染图表
            loading.value = false
        }

        await nextTick()

        if (!loadError.value) {
            renderChart()
        }
    }

    /** 行点击下钻 */
    async function handleRowClick(log: TokenLog): Promise<void> {
        const refId = String(log.detail_ref || '').trim()

        if (!refId) {
            return
        }

        detailLoading.value = true

        // 先展示标题与占位，避免空白
        detail.value = {
            title: String(log.conversation_title || 'Token 调用详情'),
            timestamp: String(log.timestamp || ''),
            action: String(log.action || 'chat'),
            model: String(log.model || ''),
            input_tokens: Number(log.input_tokens || 0),
            output_tokens: Number(log.output_tokens || 0),
            user_markdown: '正在读取 Token 调用详情...',
            response_markdown: '',
        }

        try {
            const data = await fetchTokenDetail(refId)

            detail.value = data
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Token 详情读取失败')

            detail.value = null
        } finally {
            detailLoading.value = false
        }
    }

    /** 渲染 ECharts 趋势(对齐 AdminStatsPanel Token Trend) */
    function renderChart(): void {
        if (!chartRef.value || !stats.value.history.length) {
            chartMeta.value = stats.value.history.length ? '' : '暂无数据'

            return
        }

        const history = [...stats.value.history].reverse()
        const labels = history.map((log) => {
            const ts = String(log.timestamp || '')
            const parts = ts.split(' ')

            return parts[1] ? `${parts[0].slice(5)} ${parts[1].slice(0, 5)}` : ts.slice(5, 16)
        })
        const inputData = history.map((log) => Number(log.input_tokens || 0))
        const outputData = history.map((log) => Number(log.output_tokens || 0))
        const totalData = history.map((log) => Number(log.total_tokens || log.input_tokens + log.output_tokens))

        const totalSum = totalData.reduce((a, b) => a + b, 0)

        chartMeta.value = `共 ${totalSum.toLocaleString()} tokens · ${history.length} 条记录`

        // 刷新等场景下容器随 loading 态被 v-else 重新创建,若实例仍挂在已移除的旧容器上
        // 必须先销毁(释放 resize 监听)再对新容器重新 init,否则 canvas 不会出现在新容器
        if (chartInstance && chartInstance.getDom() !== chartRef.value) {
            disposeChart()
        }

        if (!chartInstance) {
            chartInstance = echarts.init(chartRef.value, echartsTheme())
            window.addEventListener('resize', handleResize)
        } else {
            chartInstance.resize()
        }

        chartInstance.setOption({
            
                    backgroundColor: 'transparent',grid: { left: 12, right: 12, top: 28, bottom: 8, containLabel: true },
            tooltip: { trigger: 'axis', confine: true },
            legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: chartPalette.value.muted } },
            xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: chartPalette.value.lineSplit } }, axisLabel: { fontSize: 10, color: chartPalette.value.muted, interval: Math.max(0, Math.floor(labels.length / 6)) } },
            yAxis: { type: 'value', splitLine: { lineStyle: { color: chartPalette.value.lineSplit } }, axisLabel: { fontSize: 10, color: chartPalette.value.muted } },
            series: [
                { name: '输入', type: 'line', smooth: true, showSymbol: false, data: inputData, lineStyle: { width: 2, color: '#8b95a7' }, itemStyle: { color: '#8b95a7' }, areaStyle: { color: 'rgba(139, 149, 167, 0.08)' } },
                { name: '输出', type: 'line', smooth: true, showSymbol: false, data: outputData, lineStyle: { width: 2, color: '#4f46e5' }, itemStyle: { color: '#4f46e5' }, areaStyle: { color: 'rgba(79,70,229,0.08)' } },
                { name: '总计', type: 'line', smooth: true, showSymbol: false, data: totalData, lineStyle: { width: 2, color: chartPalette.value.text }, itemStyle: { color: chartPalette.value.text } },
            ],
        })

        window.setTimeout(() => chartInstance?.resize(), 220)
    }

    function disposeChart(): void {
        window.removeEventListener('resize', handleResize)
        chartInstance?.dispose()
        chartInstance = null
    }

    function handleResize(): void {
        chartInstance?.resize()
    }

    function handleClose(): void {
        disposeChart()
        // 避免 detail watcher 在关闭流程中误重建图表
        if (detail.value !== null) {
            suppressDetailWatcher = true
        }

        detail.value = null
        emit('close')
    }

    function normalizeAction(raw: string): string {
        const v = String(raw || 'chat').trim().toLowerCase()

        if (['chat', 'tool', 'search', 'memory'].includes(v)) {
            return v
        }

        return 'chat'
    }

    function timeDate(ts: string): string {
        const parts = String(ts || '').trim().split(' ')

        return parts[0] || '-'
    }

    function timeClock(ts: string): string {
        const parts = String(ts || '').trim().split(' ')

        return parts[1] || String(ts || '-')
    }

    function formatNumber(value: unknown): string {
        const n = Number(value || 0)

        return Number.isFinite(n) ? n.toLocaleString() : '0'
    }
</script>

<style scoped>
    /* 头部:对齐 g-modal-head 与 settings-page-head 视觉 */
    .token-detail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex: 1 1 auto;
        min-width: 0;
    }

    .token-detail-head-title {
        min-width: 0;
    }

    .token-detail-head-title h3 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0;
        line-height: 1.3;
    }

    .token-detail-head-hint {
        display: block;
        margin-top: 2px;
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 400;
    }

    .token-detail-head-actions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .token-detail-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        min-height: 220px;
        padding: 28px;
        color: var(--color-text-secondary);
        font-size: 13px;
        text-align: center;
    }

    .token-detail-state.is-error {
        color: var(--color-danger-text);
    }

    /* 统计栅格:复用 settings.css .stat-card 视觉(白底/浅灰边/无彩色左条) */
    .token-detail-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin: 2px 0 14px;
    }

    .token-detail-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
    }

    .token-detail-card-label {
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 550;
    }

    .token-detail-card-value {
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
    }

    .token-detail-card-sub {
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-variant-numeric: tabular-nums;
    }

    /* 明细表:对齐 AdminStatsPanel admin-user-token-recent-table */
    .token-detail-logs {
        border: 1px solid var(--color-border);
        border-radius: 10px;
        overflow: hidden;
        background: var(--color-bg-elevated);
    }

    .token-detail-logs-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-sunken);
    }

    .token-detail-logs-head h4 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
    }

    .token-detail-logs-hint {
        color: var(--color-text-secondary);
        font-size: 11.5px;
    }

    .token-detail-empty {
        padding: 28px 16px;
        color: var(--color-text-secondary);
        font-size: 13px;
        text-align: center;
    }

    .token-detail-chart-card {
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        padding: 16px;
        margin-bottom: 14px;
    }

    .token-detail-chart-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
    }

    .token-detail-chart-head h4 {
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        color: var(--color-text-primary);
    }

    .token-detail-chart-meta {
        font-size: 11.5px;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .token-detail-chart {
        width: 100%;
        height: 180px;
    }

    .token-detail-table-wrap {
        max-height: min(38vh, 360px);
        overflow-y: auto;
    }

    .token-detail-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
    }

    .token-detail-table col.col-time {
        width: 128px;
    }

    .token-detail-table col.col-type {
        width: 84px;
    }

    .token-detail-table col.col-num {
        width: 110px;
    }

    .token-detail-table thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 8px 12px;
        background: var(--color-bg-sunken);
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-secondary);
        font-size: 11.5px;
        font-weight: 600;
        text-align: left;
        white-space: nowrap;
    }

    .token-detail-table thead th.num {
        text-align: right;
    }

    .token-detail-table tbody td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-border);
        vertical-align: middle;
    }

    .token-detail-table tbody td.num {
        text-align: right;
    }

    .token-detail-row {
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .token-detail-row:hover,
    .token-detail-row:focus-visible {
        background: var(--color-bg-sunken);
        outline: none;
    }

    .token-detail-row.is-disabled {
        cursor: default;
        opacity: 0.6;
    }

    .token-detail-row.is-disabled:hover {
        background: transparent;
    }

    .token-log-time-date {
        color: var(--color-text-secondary);
        font-size: 12px;
        white-space: nowrap;
    }

    .token-log-time-clock {
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
    }

    .token-log-split {
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .token-log-total {
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .title-cell .text-truncate {
        display: block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text-primary);
        font-size: 12.5px;
    }

    /* 徽标:对齐 GDDP 克制风格(灰底浅灰边，无彩色) */
    .token-detail-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 52px;
        padding: 3px 10px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
    }

    .token-detail-badge--chat,
    .token-detail-badge--tool,
    .token-detail-badge--search,
    .token-detail-badge--memory {
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        border-color: var(--color-border);
    }

    /* 详情下钻 */
    .token-detail-drill-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--color-border);
        margin-bottom: 14px;
    }

    .token-detail-drill-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        color: var(--color-text-secondary);
        font-size: 12px;
        justify-content: flex-end;
        min-width: 0;
    }

    .token-detail-drill-tokens {
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }

    .token-detail-sections {
        display: flex;
        flex-direction: column;
        gap: 22px;
    }

    .token-detail-section {
        padding: 0;
    }

    .token-detail-section + .token-detail-section {
        padding-top: 22px;
        border-top: 1px solid var(--color-border);
    }

    .token-detail-section h4 {
        margin: 0 0 10px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
    }

    /*
     * 详情内 markdown 代码块(记忆更新正文等纯文本块):
     * 禁用横向滚动条,长行自动换行、高度随内容自适应,
     * 形态对齐 tool-chain.css 思考内容面板的代码块规则(pre-wrap + anywhere 断行)。
     * 选择器带 .token-detail-drill 前级抬高优先级,保证压过 MarkdownView 内部的 overflow-x: auto。
     */
    .token-detail-drill .token-detail-section :deep(pre) {
        overflow-x: hidden;
    }

    .token-detail-drill .token-detail-section :deep(pre code) {
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
    }

    .mono {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 640px) {
        .token-detail-grid {
            grid-template-columns: 1fr;
        }

        .token-detail-table col.col-title {
            width: auto;
        }
    }
</style>
