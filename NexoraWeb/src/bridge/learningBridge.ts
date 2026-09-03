/**
 * learningBridge.ts — Nexora ↔ NexoraLearning 类型化消息协定
 *
 * 决策来源: NexoraLearning/NEXORALEARNING_FRONTEND_ARCHITECTURE.md §2
 * 目标: 取代 course_workspace_bridge.js 裸 postMessage 的人肉契约，
 *       两端只依赖此文件，互不知内部结构。
 */

// ── 信封 ──────────────────────────────────────────────
export const LEARNING_BRIDGE_PROTOCOL = 'nexora-learning' as const
export const LEARNING_BRIDGE_VERSION = 1 as const

export type LearningBridgeSource = 'host' | 'learning'

export interface LearningBridgeEnvelope {
    protocol: typeof LEARNING_BRIDGE_PROTOCOL
    version: typeof LEARNING_BRIDGE_VERSION
    source: LearningBridgeSource
    type: string
    [key: string]: unknown
}

// ── Learning → Host ─────────────────────────────────
export type LearningHostMessage =
    | {
          type: 'state-snapshot'
          active: boolean
          lecture_id: string
          title: string
          hero_html?: string
          tabs: Array<{ key: string; label: string; active: boolean }>
          active_tab: string
          activation: 'user' | 'sync'
      }
    | {
          type: 'learning-demand'
          lecture_id: string
      }
    | {
          type: 'open-chat-conversation'
          conversation_id: string
      }
    | {
          type: 'pointer-down'
      }
    | {
          /** iframe dashboard 当前视图/功能区 tab 回报,驱动宿主侧栏功能区入口高亮 */
          type: 'dashboard-state'
          view: string
          side_tab: string
      }

export type LearningHostEnvelope = LearningBridgeEnvelope & LearningHostMessage

// ── Host → Learning ─────────────────────────────────
export type HostLearningCommand =
    | { type: 'open-course'; lecture_id: string }
    | { type: 'start-learning-path'; lecture_id: string }
    | { type: 'switch-tab'; tab: string }
    | { type: 'layout'; sidebar_auto_collapse: boolean }
    | {
          /** 打开 iframe dashboard 指定功能区(progress/push/questionBank/questionBankMistakes/profileCenter/feed/materials) */
          type: 'open-dashboard-tab'
          tab: string
      }
    | {
          /** 打开资源/视频工作台独立视图(resource/video) */
          type: 'open-studio'
          studio: string
      }
    | {
          /** 宿主侧栏功能区入口可见性:iframe 据此隐藏自身顶部 kicker tab 行,避免双重导航 */
          type: 'dashboard-layout'
          nav_visible: boolean
      }
    // 兼容旧版 course_workspace_bridge.js 的 action 命名
    | { type: 'action'; action: 'toggle-learning' | 'start-learning-path' | 'switch-tab'; lecture_id?: string; tab?: string }

export type HostLearningEnvelope = LearningBridgeEnvelope & HostLearningCommand

// ── 传输层适配器 ────────────────────────────────────
export interface LearningBridgeAdapter {
    post(message: LearningBridgeEnvelope): void
    on(callback: (message: LearningBridgeEnvelope) => void): () => void
}

// ── 校验 ────────────────────────────────────────────
export function isLearningEnvelope(value: unknown): value is LearningBridgeEnvelope {
    if (!value || typeof value !== 'object') return false
    const v = value as Record<string, unknown>
    return v.protocol === LEARNING_BRIDGE_PROTOCOL && v.version === LEARNING_BRIDGE_VERSION && typeof v.type === 'string' && typeof v.source === 'string'
}

// ── PostMessage 适配器（iframe parent/child 薄封装） ─
export function createPostMessageAdapter(targetWindow: Window, targetOrigin = '*'): LearningBridgeAdapter {
    const listeners = new Set<(message: LearningBridgeEnvelope) => void>()

    function handleMessage(event: MessageEvent): void {
        const data = event.data
        if (!isLearningEnvelope(data)) return
        listeners.forEach((cb) => cb(data))
    }

    window.addEventListener('message', handleMessage)

    return {
        post(message: LearningBridgeEnvelope): void {
            const envelope = {
                ...message,
                protocol: LEARNING_BRIDGE_PROTOCOL,
                version: LEARNING_BRIDGE_VERSION,
            } as LearningBridgeEnvelope
            targetWindow.postMessage(envelope, targetOrigin)
        },
        on(callback: (message: LearningBridgeEnvelope) => void): () => void {
            listeners.add(callback)
            return () => {
                listeners.delete(callback)
                if (listeners.size === 0) {
                    window.removeEventListener('message', handleMessage)
                }
            }
        },
    }
}

// ── iframe 子侧 PostMessage 适配器（Learning 侧：发往 parent） ─
export function createChildPostMessageAdapter(): LearningBridgeAdapter {
    const listeners = new Set<(message: LearningBridgeEnvelope) => void>()

    function handleMessage(event: MessageEvent): void {
        if (!isLearningEnvelope(event.data)) return
        // Learning 侧只接收 source==='host' 的指令
        if (String((event.data as LearningBridgeEnvelope).source) !== 'host') return
        listeners.forEach((cb) => cb(event.data as LearningBridgeEnvelope))
    }

    window.addEventListener('message', handleMessage)

    return {
        post(message: LearningBridgeEnvelope): void {
            const envelope = {
                ...message,
                protocol: LEARNING_BRIDGE_PROTOCOL,
                version: LEARNING_BRIDGE_VERSION,
            } as LearningBridgeEnvelope
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(envelope, '*')
            }
            // 同时派发 CustomEvent，供同域直接监听（兼容旧版 CXCourseWorkspaceBridge 的 CustomEvent 分发）
            window.dispatchEvent(new CustomEvent(envelope.type, { detail: envelope }))
        },
        on(callback: (message: LearningBridgeEnvelope) => void): () => void {
            listeners.add(callback)
            return () => listeners.delete(callback)
        },
    }
}

// ── 兼容：旧版 payload → 新信封的归一化 ──────────────
export function normalizeLegacyHostMessage(raw: unknown): HostLearningEnvelope | null {
    if (!raw || typeof raw !== 'object') return null
    const v = raw as Record<string, unknown>
    const source = String(v.source || '').toLowerCase()
    const type = String(v.type || '').toLowerCase()

    // 新信封直接通过
    if (isLearningEnvelope(v)) {
        return v as HostLearningEnvelope
    }

    // 旧版: nexora:course-workspace:layout / action
    if (source === 'nexora-host' && type === 'nexora:course-workspace:layout') {
        return {
            protocol: LEARNING_BRIDGE_PROTOCOL,
            version: LEARNING_BRIDGE_VERSION,
            source: 'host',
            type: 'layout',
            sidebar_auto_collapse: !!v.sidebar_auto_collapse,
        }
    }
    if (source === 'nexora-host' && type === 'nexora:course-workspace:action') {
        return {
            protocol: LEARNING_BRIDGE_PROTOCOL,
            version: LEARNING_BRIDGE_VERSION,
            source: 'host',
            type: 'action',
            action: String(v.action || '').toLowerCase() as unknown as (HostLearningCommand & { type: 'action' })['action'],
            lecture_id: String(v.lecture_id || ''),
            tab: String(v.tab || ''),
        } as HostLearningEnvelope
    }
    return null
}

export function normalizeLegacyLearningMessage(raw: unknown): LearningHostEnvelope | null {
    if (!raw || typeof raw !== 'object') return null
    const v = raw as Record<string, unknown>
    if (isLearningEnvelope(v)) return v as LearningHostEnvelope
    const source = String(v.source || '').toLowerCase()
    const type = String(v.type || '').toLowerCase()
    if (source === 'nexora-learning' && type === 'nexora:course-workspace:state') {
        const tabsRaw = Array.isArray(v.tabs) ? (v.tabs as unknown as Extract<LearningHostEnvelope, { type: 'state-snapshot' }>['tabs']) : []
        return {
            protocol: LEARNING_BRIDGE_PROTOCOL,
            version: LEARNING_BRIDGE_VERSION,
            source: 'learning',
            type: 'state-snapshot',
            active: !!v.active,
            lecture_id: String(v.lecture_id || ''),
            title: String(v.title || ''),
            hero_html: String(v.hero_html || ''),
            tabs: tabsRaw,
            active_tab: String((v as Record<string, unknown>).active_tab || ''),
            activation: String((v as Record<string, unknown>).activation || 'sync') === 'user' ? 'user' : 'sync',
        }
    }
    if (source === 'nexora-learning' && type === 'nexora:learning-frame:pointerdown') {
        return {
            protocol: LEARNING_BRIDGE_PROTOCOL,
            version: LEARNING_BRIDGE_VERSION,
            source: 'learning',
            type: 'pointer-down',
        }
    }
    if (source === 'nexora-learning' && type === 'nexora:dashboard:state') {
        return {
            protocol: LEARNING_BRIDGE_PROTOCOL,
            version: LEARNING_BRIDGE_VERSION,
            source: 'learning',
            type: 'dashboard-state',
            view: String(v.view || ''),
            side_tab: String(v.side_tab || ''),
        }
    }
    return null
}
