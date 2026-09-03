<!--
    TurnIndicatorPanel.vue — 轮次指示器(严格对齐原版 chat.js turnIndicator 的重实现)

    原版参照(ChatDBServer/static/js/chat.js L14300-15005 + style.css L14644-14770):
      - 面板固定右侧垂直居中,滚动窗口显示轮次线(.turn-indicator-lines)
      - 激活线 = 最后一条"消息中心点 ≤ 消息视口底边"的用户轮次,随消息区滚动实时跟随
        (updateTurnIndicatorActive 按视口底边判定,反映用户正在阅读的消息区域)
      - 首次加载/新轮次追加/点击跳转时,激活线在窗口内居中(scrollActiveTurnIndicatorIntoView)
      - hover 面板弹出预览列表,移出 300ms 延迟隐藏,进入弹层取消隐藏
      - 预览弹层 Teleport 到 body:面板带 transform,固定定位子元素必须脱离其包含块
        (对齐原版将 popup 挂载到 document.body)
      - 点击预览项跳转对应用户消息:跳转期间屏蔽滚动监听 500ms(对齐原版 _isJumping)
      - 消息中心点缓存(centers)单遍批量读取(一次重排),仅布局脏且需要时经 rAF 合并重建
-->

<template>
    <div
        id="turnIndicatorPanel"
        class="turn-indicator-panel"
        :class="{ visible: panelVisible }"
        @mouseenter="handlePanelEnter"
        @mouseleave="scheduleHideTurnListPopup"
    >
        <div id="turnIndicatorLines" ref="linesEl" class="turn-indicator-lines">
            <div
                v-for="(turn, turnIndex) in userTurns"
                :key="turn.index"
                class="turn-indicator-line"
                :class="{ active: turnIndex === activeTurnIndex }"
                :data-turn-index="turnIndex"
            ></div>
        </div>

        <!-- 预览弹层:Teleport 到 body(原因见文件头),显隐由 visible 类控制以保留淡出过渡 -->
        <Teleport to="body">
            <div
                ref="popupEl"
                class="turn-indicator-popup"
                :class="{ visible: popupVisible }"
                @mouseenter="cancelPopupHide"
                @mouseleave="scheduleHideTurnListPopup"
            >
                <div
                    v-for="(turn, turnIndex) in userTurns"
                    :key="turn.index"
                    class="turn-indicator-popup-item"
                    :class="{ active: turnIndex === activeTurnIndex }"
                    :title="messagePreview(turn) || '(空消息)'"
                    @click="jumpToUserMessage(turnIndex)"
                >{{ messagePreview(turn) || '(空消息)' }}</div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import { useConversationStore } from '@/stores/conversation'
    import { overlay } from '@/ui/overlay'

    const props = defineProps<{
        messages: ChatMessage[]
    }>()

    const emit = defineEmits<{
        jump: [messageIndex: number]
    }>()

    const conversationStore = useConversationStore()

    /** 轮次更新选项(对齐原版 scheduleTurnIndicatorActiveUpdate 的 options 结构) */
    interface TurnUpdateOptions {
        animate?: boolean
        forceScroll?: boolean
    }

    const linesEl = ref<HTMLElement | null>(null)
    const popupEl = ref<HTMLElement | null>(null)

    /** 激活轮次下标(响应式,驱动线条/popup 项的 active 类) */
    const activeTurnIndex = ref(-1)

    /** 预览弹层显隐 */
    const popupVisible = ref(false)

    /**
     * 非响应式运行时状态(对齐原版 turnIndicatorState)
     * DOM 测量/rAF/定时器不进入响应式系统,避免测量本身触发重渲染
     */
    const state = {
        /** 各用户轮次消息的中心点(offsetTop + offsetHeight/2),null = 尚未渲染 */
        centers: [] as (number | null)[],
        /** 布局脏标记:消息增删/内容变化时置位,实际重建合并到下次需要时的 rAF */
        layoutDirty: true,
        /** active 更新 rAF 句柄(合并同帧多次调度) */
        activeUpdateRaf: 0,
        /** 布局重建 rAF 句柄(防重入) */
        layoutRefreshRaf: 0,
        /** popup 延迟隐藏定时器(300ms) */
        popupHideTimer: 0,
        /** 跳转中屏蔽滚动监听(对齐原版 _isJumping) */
        jumping: false,
        /** messageIndex → DOM 元素缓存(对齐原版 domElement 复用,isConnected 校验失效) */
        elementCache: new Map<number, HTMLElement>(),
    }

    /** 用户轮次列表(每条用户消息一轮,对齐原版 collectTurnIndicatorUserMessages) */
    const userTurns = computed(() => {
        return props.messages.filter((message) => message.role === 'user')
    })

    /**
     * 面板可见性(对齐原版 _shouldShowTurnIndicator + _syncTurnIndicatorVisibility):
     * 需有当前会话、知识库右侧栏未打开且至少一轮;
     * 还要求宿主(.gddp-chat-view)实际可见(overlay.view 为空)——隐藏期间若放行
     * 重建链,offsetTop 全为 0 的假缓存会被 layoutDirty=false 标记为有效,
     * 回到聊天后激活线将永久钉在最后一轮(底部),直到切换会话才恢复。
     */
    const panelVisible = computed(() => {
        if (!conversationStore.currentId) {
            return false
        }

        if (overlay.panel === 'knowledge') {
            return false
        }

        if (overlay.view !== null) {
            return false
        }

        return userTurns.value.length > 0
    })

    /** 消息预览文本(对齐原版 extractMessageText:trim + 截断 200 字) */
    function messagePreview(message: ChatMessage): string {
        return String(message.content || '').trim().substring(0, 200)
    }

    function getMessagesContainer(): HTMLElement | null {
        return document.getElementById('messagesContainer')
    }

    /** 用户消息 DOM 元素解析(带缓存,对齐原版 bindTurnIndicatorDomElements 的 domElement 复用) */
    function resolveMessageElement(messageIndex: number): HTMLElement | null {
        const cached = state.elementCache.get(messageIndex)

        if (cached && cached.isConnected) {
            return cached
        }

        const container = getMessagesContainer()
        const element = container
            ? container.querySelector<HTMLElement>(`.message.user[data-index="${messageIndex}"]`)
            : null

        if (element) {
            state.elementCache.set(messageIndex, element)
        }

        return element
    }

    /**
     * 重建中心点缓存(对齐原版 rebuildTurnIndicatorLayoutCacheChunked 的单遍批量策略):
     * 先解析全部元素(querySelector 不触发重排),再单遍读 offsetTop/offsetHeight,
     * 整轮只强制一次重排
     */
    function rebuildCentersCache(): void {
        const container = getMessagesContainer()
        const turns = userTurns.value

        if (!container || !turns.length) {
            state.centers = []
            state.layoutDirty = false
            return
        }

        const elements: (HTMLElement | null)[] = new Array(turns.length)

        for (let index = 0; index < turns.length; index++) {
            elements[index] = resolveMessageElement(turns[index].index)
        }

        const centers: (number | null)[] = new Array(turns.length)

        for (let index = 0; index < turns.length; index++) {
            const element = elements[index]

            centers[index] = element ? element.offsetTop + (element.offsetHeight / 2) : null
        }

        state.centers = centers
        state.layoutDirty = false
    }

    /**
     * 按视口位置查找激活轮次(对齐原版 findActiveTurnIndexByViewportMiddle):
     * 取最后一个中心点 ≤ viewportMiddle 的轮次;全部在其下方时回落首个已加载轮次
     */
    function findActiveTurnIndex(viewportMiddle: number): number {
        const centers = state.centers

        if (!centers.length) {
            return -1
        }

        let firstLoadedIndex = -1
        let activeIndex = -1

        for (let index = 0; index < centers.length; index++) {
            const center = centers[index]

            if (center === null || !Number.isFinite(center)) {
                continue
            }

            if (firstLoadedIndex < 0) {
                firstLoadedIndex = index
            }

            if (center <= viewportMiddle) {
                activeIndex = index
                continue
            }

            break
        }

        return activeIndex >= 0 ? activeIndex : firstLoadedIndex
    }

    /**
     * 激活线滚动定位(对齐原版 scrollActiveTurnIndicatorIntoView 的增强):
     *   - align="center":线居中对齐窗口中心(跳转/新增轮次/首次加载);
     *   - align="nearest"(默认):仅当线滚出可视区时做最小滚动贴回边缘,
     *     保证滚动阅读时高亮线始终可见,又不与消息区滚动互相干扰。
     * 计算基于 getBoundingClientRect 差值:不依赖 offsetParent 链
     * (lines 容器无 position,offsetTop 会跳到 fixed 面板导致基准错误),
     * 每次至多两次矩形读取,仅在激活线变化时触发。
     */
    function scrollActiveLineIntoView(animate: boolean, align: 'center' | 'nearest' = 'nearest'): void {
        const container = linesEl.value

        if (!container || activeTurnIndex.value < 0) {
            return
        }

        const activeLine = container.children[activeTurnIndex.value] as HTMLElement | undefined

        if (!activeLine) {
            return
        }

        requestAnimationFrame(() => {
            const containerRect = container.getBoundingClientRect()
            const lineRect = activeLine.getBoundingClientRect()

            // 线在容器可视坐标系中的位置(视口差值即容器内位置,滚动实时反映)
            const lineTopInView = lineRect.top - containerRect.top
            const lineBottomInView = lineTopInView + lineRect.height

            let targetTop: number

            if (align === 'center') {
                targetTop = Math.max(
                    0,
                    container.scrollTop + (lineTopInView + (lineRect.height / 2)) - (containerRect.height / 2)
                )
            } else {

                // nearest:已在可视区内则不动;越出上/下边缘时贴回对应边缘
                if (lineTopInView >= 0 && lineBottomInView <= containerRect.height) {
                    return
                }

                targetTop = lineTopInView < 0
                    ? container.scrollTop + lineTopInView
                    : container.scrollTop + (lineBottomInView - containerRect.height)
            }

            targetTop = Math.max(0, targetTop)

            if (Math.abs(container.scrollTop - targetTop) < 1) {
                return
            }

            container.scrollTo({
                top: targetTop,
                behavior: animate ? 'smooth' : 'auto'
            })
        })
    }

    /** 设置激活轮次(更新高亮;跳转/新增走居中,滚动跟随走最小可见滚动) */
    function setActiveTurnLine(index: number, options: TurnUpdateOptions = {}): void {
        activeTurnIndex.value = index

        if (options.forceScroll) {
            scrollActiveLineIntoView(!!options.animate, 'center')
        } else {
            scrollActiveLineIntoView(false, 'nearest')
        }
    }

    /**
     * 计算并同步激活轮次(对齐原版 updateTurnIndicatorActive):
     * 以视口"中心"(scrollTop + clientHeight/2)为阈值,高亮用户正在阅读/居中的轮次,
     * 使跳转后指示器与阅读位置一致;布局脏时先经 rAF 重建缓存再计算
     */
    function updateActive(options: TurnUpdateOptions = {}): void {
        const container = getMessagesContainer()

        if (!container || !panelVisible.value || !userTurns.value.length) {
            return
        }

        if (state.layoutDirty) {
            scheduleLayoutRefresh(options)
            return
        }

        if (!state.centers.length) {
            return
        }

        const viewportCenter = container.scrollTop + (container.clientHeight / 2)
        const nextIndex = findActiveTurnIndex(viewportCenter)

        if (nextIndex !== activeTurnIndex.value) {
            setActiveTurnLine(nextIndex, options)
        }
    }

    /** active 更新调度:rAF 合并同帧多次滚动事件(对齐原版 scheduleTurnIndicatorActiveUpdate) */
    function scheduleActiveUpdate(options: TurnUpdateOptions): void {
        if (state.activeUpdateRaf) {
            cancelAnimationFrame(state.activeUpdateRaf)
        }

        state.activeUpdateRaf = requestAnimationFrame(() => {
            state.activeUpdateRaf = 0
            updateActive(options)
        })
    }

    /** 布局重建调度:rAF 防重入,重建后按同一选项计算激活态(对齐原版 scheduleTurnIndicatorLayoutRefresh) */
    function scheduleLayoutRefresh(options: TurnUpdateOptions): void {
        if (state.layoutRefreshRaf) {
            return
        }

        state.layoutRefreshRaf = requestAnimationFrame(() => {
            state.layoutRefreshRaf = 0
            rebuildCentersCache()
            updateActive(options)
        })
    }

    /** 消息区滚动监听:跳转中屏蔽(对齐原版 _isJumping),其余随滚动更新激活态 */
    function handleMessagesScroll(): void {
        if (state.jumping) {
            return
        }

        scheduleActiveUpdate({ animate: false, forceScroll: false })
    }

    /** 显示预览弹层(对齐原版 showTurnListPopup:清除隐藏定时器 + 激活项滚动居中) */
    function showTurnListPopup(): void {
        popupVisible.value = true

        // 激活项居中(对齐原版常量:项高 34px / 顶部留白 8px / 弹层高 360px)
        void nextTick(() => {
            const popup = popupEl.value

            if (!popup || activeTurnIndex.value < 0) {
                return
            }

            const ITEM_H = 34
            const PAD = 8
            const POPUP_HEIGHT = 360
            const itemTop = PAD + activeTurnIndex.value * ITEM_H

            popup.scrollTop = itemTop - (POPUP_HEIGHT / 2) + (ITEM_H / 2)
        })
    }

    function hideTurnListPopup(): void {
        popupVisible.value = false
    }

    /** 延迟 300ms 隐藏(对齐原版 scheduleHideTurnListPopup),供面板/弹层 mouseleave 共用 */
    function scheduleHideTurnListPopup(): void {
        window.clearTimeout(state.popupHideTimer)

        state.popupHideTimer = window.setTimeout(() => {
            hideTurnListPopup()
            state.popupHideTimer = 0
        }, 300)
    }

    /** 取消待执行的隐藏(对齐原版:进入面板/弹层时先清定时器) */
    function cancelPopupHide(): void {
        if (state.popupHideTimer) {
            window.clearTimeout(state.popupHideTimer)
            state.popupHideTimer = 0
        }
    }

    /** 面板 hover 入口:清除隐藏定时器并展示预览(对齐原版 panel mouseenter) */
    function handlePanelEnter(): void {
        cancelPopupHide()
        showTurnListPopup()
    }

    /**
     * 点击预览项跳转(对齐原版 jumpToUserMessage + scrollToAndHighlight 前半段):
     * 先立即更新激活线给用户即时反馈,再屏蔽滚动监听 500ms 交由父级执行平滑滚动;
     * 目标消息元素的滚动定位与高亮由父级(ChatView)完成
     */
    function jumpToUserMessage(turnIndex: number): void {
        const turn = userTurns.value[turnIndex]

        if (!turn) {
            return
        }

        setActiveTurnLine(turnIndex, { animate: false, forceScroll: true })

        hideTurnListPopup()

        state.jumping = true

        window.setTimeout(() => {
            state.jumping = false
        }, 500)

        emit('jump', turn.index)
    }

    /**
     * 消息内容变化(流式增长/编辑/删除):仅标记布局脏,不做 DOM 测量。
     * 实际重建合并到下次 active 更新/轮次变化时的 rAF,避免流式期间逐帧重排。
     * 注意:面板吃的是全量 turns,但中心点依赖"窗口化消息"的 DOM 元素;
     * 仅监听 turns 会在向前补载(切换/跳转触发 conversationStore.messages 变化)时
     * 漏掉重建,导致新加载区域的轮次中心点恒为 null、激活判定错位。故同时监听窗口消息。
     */
    watch(
        () => [props.messages, conversationStore.messages],
        () => {
            state.layoutDirty = true
        },
        { deep: true }
    )

    /**
     * 轮次列表变化(对齐原版 appendTurnIndicatorLine / renderTurnIndicator 的分流):
     *   - 用户轮次增加:最新一轮置为激活并在窗口内居中(forceScroll)
     *   - 减少/替换(删除消息/切换会话):重建缓存后重算激活态
     * 等待 nextTick 保证 v-for 线条与消息 DOM 均已更新
     */
    watch(userTurns, (turns, previousTurns) => {
        const previousLength = previousTurns ? previousTurns.length : 0

        void nextTick(() => {
            if (!panelVisible.value) {
                activeTurnIndex.value = -1
                hideTurnListPopup()
                return
            }

            state.layoutDirty = true

            if (turns.length > previousLength) {
                rebuildCentersCache()
                setActiveTurnLine(turns.length - 1, { animate: false, forceScroll: true })
                return
            }

            scheduleLayoutRefresh({ animate: false, forceScroll: false })
        })
    })

    /** 可见性变化(对齐原版 _syncTurnIndicatorVisibility):隐藏时收弹层,恢复时重算 */
    watch(panelVisible, (visible) => {
        if (!visible) {
            activeTurnIndex.value = -1
            hideTurnListPopup()
            return
        }

        state.layoutDirty = true
        scheduleLayoutRefresh({ animate: false, forceScroll: false })
    })

    onMounted(() => {
        const container = getMessagesContainer()

        if (container) {
            container.addEventListener('scroll', handleMessagesScroll, { passive: true })
        }

        // 首次状态计算(对齐原版 loadConversationTurnIndicatorList 后的 forceScroll 居中)
        void nextTick(() => {
            state.layoutDirty = true
            scheduleLayoutRefresh({ animate: false, forceScroll: true })
        })
    })

    onBeforeUnmount(() => {
        const container = getMessagesContainer()

        if (container) {
            container.removeEventListener('scroll', handleMessagesScroll)
        }

        if (state.activeUpdateRaf) {
            cancelAnimationFrame(state.activeUpdateRaf)
        }

        if (state.layoutRefreshRaf) {
            cancelAnimationFrame(state.layoutRefreshRaf)
        }

        window.clearTimeout(state.popupHideTimer)
    })
</script>
