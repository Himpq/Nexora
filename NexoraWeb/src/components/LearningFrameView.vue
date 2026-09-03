<!--
    LearningFrameView.vue — NexoraLearning iframe 薄挂载层
    对齐 NEXORALEARNING_FRONTEND_ARCHITECTURE.md §4
    职责: 仅承载一个 iframe + learningHostBridge(PostMessageAdapter)，
          不含任何 Learning 业务代码。
-->
<template>
    <section class="gddp-content-view learning-frame-view" aria-label="Learning" v-show="open">
        <div v-if="!frameSrc" class="learning-frame-empty">
            <div class="learning-frame-empty-icon" aria-hidden="true">
                <i class="fa-solid fa-graduation-cap"></i>
            </div>
            <h3 class="learning-frame-empty-title">Learning 未配置</h3>
            <p class="learning-frame-empty-desc">请在 管理控制台 → 系统配置 → NexoraLearning 中填写前端地址</p>
            <button class="learning-frame-empty-action" type="button" @click="emit('request-open-settings')">去配置</button>
        </div>
        <iframe
            v-else
            ref="frameRef"
            class="learning-frame"
            :src="frameSrc"
            :title="frameTitle"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
            loading="lazy"
            @load="handleFrameLoad"
        ></iframe>
        <div v-if="frameSrc && loading" class="learning-frame-loading" aria-hidden="true">
            <span class="learning-frame-loading-spinner"></span>
            <span>加载中…</span>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
    LEARNING_BRIDGE_PROTOCOL,
    LEARNING_BRIDGE_VERSION,
    isLearningEnvelope,
    normalizeLegacyLearningMessage,
    type LearningBridgeEnvelope,
    type LearningHostEnvelope,
} from '@/bridge/learningBridge'

const props = defineProps<{
    open: boolean
    frameUrl: string
    title?: string
    /** 宿主 Learning 侧栏视图:对话视图下宿主导航条隐藏,iframe 需恢复自身顶部 tab 行 */
    learningSidebarView?: 'list' | 'conversation'
}>()

const emit = defineEmits<{
    'request-open-settings': []
    'host-message': [message: LearningHostEnvelope]
}>()

const frameRef = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const hasLoaded = ref(false)
/** load 前收到的宿主命令队列(load 后补发,见 postCommand) */
const pendingCommands: Record<string, unknown>[] = []

const frameSrc = computed(() => {
    const raw = String(props.frameUrl || '').trim()
    if (!raw) return ''
    // 附加 dashboard_nav 标记，供 Learning 首帧消闪（host-dashboard-nav-active）
    try {
        const url = new URL(raw, window.location.href)
        const isDesktop = !window.matchMedia('(max-width: 980px)').matches
        if (isDesktop) {
            url.searchParams.set('dashboard_nav', '1')
        }
        return url.toString()
    } catch {
        return raw
    }
})

const frameTitle = computed(() => props.title || 'NexoraLearning')

function getFrameOrigin(): string {
    const src = frameSrc.value
    if (!src) return '*'
    try {
        return new URL(src, window.location.href).origin
    } catch {
        return '*'
    }
}

function postToLearning(message: Record<string, unknown>): void {
    const frame = frameRef.value
    if (!frame || !frame.contentWindow) return
    const envelope: LearningBridgeEnvelope = {
        protocol: LEARNING_BRIDGE_PROTOCOL,
        version: LEARNING_BRIDGE_VERSION,
        source: 'host',
        type: String(message.type || ''),
        ...message,
    }
    frame.contentWindow.postMessage(envelope, getFrameOrigin())
}

/**
 * 对外暴露：供 ChatView 转发 HostLearningCommand。
 * iframe 应用层监听器注册晚于 load 事件(对齐原版 pendingDashboardTab 指令留存):
 * 首帧命令入队,load 后统一补发,避免挂载时序导致指令丢失。
 */
function postCommand(command: Record<string, unknown>): void {
    if (!hasLoaded.value) {
        pendingCommands.push(command)
        return
    }
    postToLearning(command)
}

function handleFrameLoad(): void {
    loading.value = false
    hasLoaded.value = true
    const queued = pendingCommands.splice(0, pendingCommands.length)
    queued.forEach((command) => postToLearning(command))
    // 首帧加载后立即下发 layout 状态（sidebar 是否为 overlay 抽屉）
    postLayoutState()
}

function isSidebarOverlayLayout(): boolean {
    try {
        const sidebar = document.getElementById('sidebar')
        if (!sidebar) return false
        const styles = window.getComputedStyle(sidebar)
        const pos = String(styles.position || '').trim().toLowerCase()
        return pos === 'fixed' || pos === 'absolute'
    } catch {
        return false
    }
}

/**
 * 宿主侧栏功能区入口是否可见(对齐原版 isSidebarNavActuallyVisible +
 * syncLearningSidebarNavigationVisibility 的 navVisible = learning && view==='list'):
 * 对话视图下宿主无导航条,iframe 恢复自身顶部 kicker tab 行,避免导航真空
 */
function isSidebarNavVisible(): boolean {
    if (!props.open || props.learningSidebarView === 'conversation') {
        return false
    }

    try {
        const sidebar = document.getElementById('sidebar')

        if (!sidebar || sidebar.classList.contains('collapsed')) {
            return false
        }
    } catch {
        return false
    }

    return !isSidebarOverlayLayout()
}

function postLayoutState(): void {
    postToLearning({
        type: 'layout',
        sidebar_auto_collapse: isSidebarOverlayLayout(),
    })
    postToLearning({
        type: 'dashboard-layout',
        nav_visible: isSidebarNavVisible(),
    })
}

function handleMessage(event: MessageEvent): void {
    const envelope = normalizeLegacyLearningMessage(event.data) || (isLearningEnvelope(event.data) ? (event.data as LearningHostEnvelope) : null)
    if (!envelope) return
    // 仅处理 learning → host 的消息
    if (String(envelope.source) !== 'learning') return
    emit('host-message', envelope as LearningHostEnvelope)
}

let resizeTimer: number | null = null
function handleResize(): void {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        postLayoutState()
    }, 120)
}

watch(
    () => props.open,
    (open) => {
        if (open) {
            loading.value = !hasLoaded.value
            // 重新可见时补发一次 layout
            if (hasLoaded.value) {
                window.setTimeout(postLayoutState, 0)
            }
        }
    },
)

// 侧栏视图切换(list↔conversation)改变宿主导航可见性,iframe 顶部 tab 行需联动
watch(
    () => props.learningSidebarView,
    () => {
        if (hasLoaded.value) {
            postLayoutState()
        }
    },
)

watch(
    () => frameSrc.value,
    () => {
        loading.value = true
        hasLoaded.value = false
    },
)

onMounted(() => {
    window.addEventListener('message', handleMessage)
    window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
    window.removeEventListener('message', handleMessage)
    window.removeEventListener('resize', handleResize)
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
})

defineExpose({ postCommand, postLayoutState })
</script>

<style scoped>
/*
 * 布局契约沿用 .gddp-content-view(absolute inset:0),此处严禁覆盖 position:
 * scoped 选择器特异性更高,一旦写 position:relative 会把本节拉回文档流,
 * 高度链断裂,iframe 的 height:100% 退化为替换元素默认高度(约150px)。
 * 仅覆盖背景:iframe 应用固定白底,不随暗色令牌变化。
 */
.learning-frame-view {
    background: #ffffff;
}

.learning-frame {
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1 1 auto;
    border: none;
    display: block;
    background: #ffffff;
}

.learning-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(2px);
    color: var(--color-text-secondary);
    font-size: 13px;
}

.learning-frame-loading-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-text-secondary);
    border-radius: 50%;
    animation: learning-frame-spin 0.8s linear infinite;
}

@keyframes learning-frame-spin {
    to { transform: rotate(360deg); }
}

.learning-frame-empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 24px;
    text-align: center;
}

.learning-frame-empty-icon {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--color-bg-sunken);
    color: var(--color-text-secondary);
    font-size: 22px;
}

.learning-frame-empty-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-primary);
}

.learning-frame-empty-desc {
    margin: 0;
    max-width: 420px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
}

.learning-frame-empty-action {
    margin-top: 6px;
    padding: 8px 16px;
    border: 1px solid var(--color-border-strong);
    border-radius: 8px;
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    font-size: 13px;
    cursor: pointer;
}

.learning-frame-empty-action:hover {
    background: #111;
    color: #fff;
    border-color: #111;
}
</style>
