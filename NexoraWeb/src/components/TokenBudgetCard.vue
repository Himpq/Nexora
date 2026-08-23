<!--
    TokenBudgetCard.vue — 上下文窗口卡片(点击 tokenBudgetMini / tokenBudgetUsage 触发,对齐原版 #tokenBudgetTooltip)

    设计:
      - Teleport 到 body + position:fixed,避免祖先 transform/filter 约束导致定位偏移
      - 定位在触发元素正下方,视口边缘自动回弹(对齐原版 positionTokenBudgetTooltipFromPoint)
      - 经 overlay 协调器以 popover 注册,点击外部自动关闭;打开期间滚动/缩放跟随重定位
      - 卡片底部提供"查看 Token 使用详情"入口,打开 GDDP TokenDetailModal
-->

<template>
    <Teleport to="body">
        <div
            v-if="open && model"
            ref="cardRef"
            class="token-budget-card"
            :style="cardStyle"
            role="tooltip"
            aria-hidden="false"
        >
            <div class="token-budget-tip-head">
                <div class="token-budget-tip-title">上下文窗口</div>
                <div class="token-budget-tip-pct">{{ pctText }}</div>
            </div>
            <div class="token-budget-tip-sub">{{ subText }}</div>
            <div class="token-budget-tip-bar"><span :style="{ width: `${barWidth}%` }"></span></div>
            <div class="token-budget-tip-grid">
                <div class="token-budget-tip-row">
                    <span>System Instructions</span>
                    <em>{{ model.systemTokens.toLocaleString() }} ({{ model.pct(model.systemTokens) }})</em>
                </div>
                <div class="token-budget-tip-row">
                    <span>Tool Definitions</span>
                    <em>{{ model.toolTokens.toLocaleString() }} ({{ model.pct(model.toolTokens) }})</em>
                </div>
                <div class="token-budget-tip-row">
                    <span>User Messages</span>
                    <em>{{ model.contextTokens.toLocaleString() }} ({{ model.pct(model.contextTokens) }})</em>
                </div>
                <div class="token-budget-tip-row">
                    <span>Cache Hits</span>
                    <em>{{ model.cachedInput.toLocaleString() }}</em>
                </div>
                <div class="token-budget-tip-row">
                    <span>Billable Input</span>
                    <em>{{ model.totalInput.toLocaleString() }} / {{ model.cumulativeInput.toLocaleString() }}</em>
                </div>
                <div class="token-budget-tip-row">
                    <span>Remaining</span>
                    <em>{{ remainText }}</em>
                </div>
            </div>
            <button type="button" class="token-budget-card-action" @click="openTokenDetail">
                <i class="fa-solid fa-chart-column" aria-hidden="true"></i>
                <span>查看 Token 使用详情</span>
            </button>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

    import { closePopover, openPopover, overlay } from '@/ui/overlay'
    import type { TokenBudgetTooltipModel } from '@/stream/tokenBudget'

    const POPOVER_KEY = 'token-budget-card'

    const props = withDefaults(defineProps<{
        open: boolean
        model: TokenBudgetTooltipModel | null
        /** 触发元素(点击的 tokenBudgetMini / tokenBudgetUsage),卡片定位基准 */
        trigger: HTMLElement | null
        /** 已配置上下文窗口时是否显示"上限估算"标注(对齐原版 estimated) */
        estimated?: boolean
    }>(), {
        estimated: false,
    })

    const emit = defineEmits<{
        close: []
        /** 打开 Token 详情弹窗(GDDP) */
        'open-token-detail': []
    }>()

    const cardRef = ref<HTMLElement | null>(null)

    /** 卡片定位(fixed,对齐原版 positionTokenBudgetTooltipFromPoint) */
    const cardStyle = ref<Record<string, string>>({})

    /** 打开期间跟随滚动/缩放重定位 */
    function reposition(): void {
        if (overlay.popover === POPOVER_KEY) {
            positionCard()
        }
    }

    /** Esc 关闭(对齐原版 keydown Escape 分支) */
    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && overlay.popover === POPOVER_KEY) {
            closePopover(POPOVER_KEY)
        }
    }

    watch(() => props.open, (isOpen) => {
        if (isOpen && props.trigger) {
            openPopover(POPOVER_KEY, cardRef.value)
            void nextTick(() => {
                // 挂载完成后 cardRef 才可用,补注册容器(点击卡片内部不关闭,对齐原版 tipEl.contains)
                openPopover(POPOVER_KEY, cardRef.value)
                positionCard()
            })
            window.addEventListener('resize', reposition)
            window.addEventListener('scroll', reposition, true)
            document.addEventListener('keydown', handleKeydown, true)
        } else {
            window.removeEventListener('resize', reposition)
            window.removeEventListener('scroll', reposition, true)
            document.removeEventListener('keydown', handleKeydown, true)

            if (overlay.popover === POPOVER_KEY) {
                closePopover(POPOVER_KEY)
            }
        }
    }, { immediate: true })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', reposition)
        window.removeEventListener('scroll', reposition, true)
        document.removeEventListener('keydown', handleKeydown, true)

        if (overlay.popover === POPOVER_KEY) {
            closePopover(POPOVER_KEY)
        }
    })

    /** 依据触发元素底部中心定位,视口边缘回弹(对齐原版 positionTokenBudgetTooltipFromPoint) */
    function positionCard(): void {
        const trigger = props.trigger
        const card = cardRef.value

        if (!trigger || !card) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const clientX = rect.left + rect.width / 2
        const clientY = rect.top + rect.height
        const pad = 12
        const vw = window.innerWidth || document.documentElement.clientWidth || 0
        const vh = window.innerHeight || document.documentElement.clientHeight || 0
        const w = card.offsetWidth || 220
        const h = card.offsetHeight || 80
        let left = Math.round(clientX + 12)
        let top = Math.round(clientY + 14)

        if (left + w + pad > vw) {
            left = Math.max(pad, vw - w - pad)
        }

        if (top + h + pad > vh) {
            top = Math.max(pad, Math.round(clientY - h - 14))
        }

        if (top < pad) {
            top = pad
        }

        cardStyle.value = {
            left: `${left}px`,
            top: `${top}px`,
        }
    }

    const hasContextWindow = computed(() => !!props.model && props.model.hasContextWindow)

    /** 已配置窗口:占比小数 1 位;未配置显示"未配置" */
    const pctText = computed(() => {
        if (!props.model) {
            return ''
        }

        if (!hasContextWindow.value) {
            return '未配置'
        }

        return `${Math.max(0, Math.min(100, Math.round(props.model.ratioRaw * 1000) / 10)).toFixed(1)}%`
    })

    const subText = computed(() => {
        if (!props.model) {
            return ''
        }

        return hasContextWindow.value
            ? `${props.model.used.toLocaleString()}/${props.model.limit.toLocaleString()} 个令牌`
            : '当前模型未配置上下文窗口'
    })

    const remainText = computed(() => {
        if (!props.model) {
            return ''
        }

        return hasContextWindow.value
            ? `${props.model.remain.toLocaleString()}${props.estimated ? ' (估算上限)' : ''}`
            : '未配置'
    })

    const barWidth = computed(() => {
        if (!props.model) {
            return 0
        }

        return hasContextWindow.value ? Math.max(0, Math.min(100, Math.round(props.model.ratioRaw * 1000) / 10)) : 0
    })

    /** 打开 Token 详情弹窗并关闭本卡片 */
    function openTokenDetail(): void {
        emit('open-token-detail')
        emit('close')
    }
</script>