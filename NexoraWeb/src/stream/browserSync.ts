/**
 * browserSync.ts — 浏览器实时同步通道(/ws/browser)
 *
 * 职责:
 *   - 维持与后端 /ws/browser 的 WebSocket 长连接(断线指数退避重连 + 心跳保活)
 *   - 将服务端推送事件分发给对应 store:服务端推事实,前端只渲染
 *
 * 事件约定(后端 server.py /ws/browser):
 *   model_config_changed              → 模型目录变更,绕过缓存强制重拉 /api/config
 *   notification_created/read/removed → 通知增删改,合入通知 store
 *   mail_changed                      → 邮件变更,刷新未读徽标并静默同步邮件列表
 *   其余事件类型(agent_status / knowledge_changed / ollama_status_* 等)当前端未接管,按协议忽略
 */

import { useMailStore } from '@/stores/mail'
import { useModelStore } from '@/stores/model'
import { useNotificationStore } from '@/stores/notification'

/** 重连基础间隔(ms),按失败次数指数退避 */
const RECONNECT_BASE_MS = 2000

/** 重连间隔上限(ms) */
const RECONNECT_MAX_MS = 60000

/** 心跳间隔(ms):发送 ping 防止中间代理回收空闲连接 */
const PING_INTERVAL_MS = 30000

/** 构建浏览器同步 WebSocket 地址(同源,随页面协议自动 ws/wss) */
function buildBrowserSyncWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    return `${protocol}//${window.location.host}/ws/browser`
}

/**
 * 浏览器同步服务(有状态域,单例)
 *
 * 连接生命周期:start → connect → (open 后心跳 + 订阅) → close 时指数退避重连。
 * socketSerial 用于串号防护:重连/停止后,旧连接的迟到事件一律丢弃。
 */
class BrowserSyncService {
    private socket: WebSocket | null = null
    private socketSerial = 0
    private reconnectTimer: number | null = null
    private pingTimer: number | null = null
    private reconnectAttempts = 0
    private started = false
    private hasConnectedOnce = false
    /** 当前订阅的会话 id(重连成功后自动补订) */
    private conversationId = ''

    /** 启动连接(幂等):登录后的页面挂载时调用 */
    start(): void {
        if (this.started) {
            return
        }

        this.started = true
        this.connect()
    }

    /** 停止连接并清理定时器(页面卸载时调用) */
    stop(): void {
        this.started = false
        this.clearTimers()

        this.socketSerial += 1

        if (this.socket) {
            this.socket.close()
            this.socket = null
        }
    }

    /** 订阅会话级事件(切换会话时调用;重连成功后按最近值补订) */
    syncConversation(conversationId: string): void {
        this.conversationId = String(conversationId || '').trim()
        this.send({
            type: 'subscribe_conversation',
            conversation_id: this.conversationId,
        })
    }

    /** 建立连接(serial 防串号:每次连接自增,仅当前连接的事件被处理) */
    private connect(): void {
        if (!this.started) {
            return
        }

        this.socketSerial += 1
        const serial = this.socketSerial
        let socket: WebSocket

        try {
            socket = new WebSocket(buildBrowserSyncWsUrl())
        } catch (error) {
            console.warn('[BrowserSync] 连接创建失败', error)
            this.scheduleReconnect()

            return
        }

        this.socket = socket

        socket.addEventListener('open', () => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            this.reconnectAttempts = 0
            this.startPing()

            // 断线期间可能错过推送,重连(非首次连接)时强制重拉一次模型目录恢复状态
            if (this.hasConnectedOnce) {
                void useModelStore().loadModels({ force: true })
            }

            this.hasConnectedOnce = true
            this.syncConversation(this.conversationId)
        })

        socket.addEventListener('message', (event) => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            this.handleMessage(event)
        })

        socket.addEventListener('close', () => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            this.socket = null
            this.clearTimers()
            this.scheduleReconnect()
        })

        socket.addEventListener('error', () => {
            if (this.socket !== socket || serial !== this.socketSerial) {
                return
            }

            console.warn('[BrowserSync] 连接异常')
        })
    }

    /** 指数退避安排重连,避免服务端不可用时重连风暴 */
    private scheduleReconnect(): void {
        if (!this.started || this.reconnectTimer !== null) {
            return
        }

        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_MS
        )

        this.reconnectAttempts += 1

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
        }, delay)
    }

    /** 启动心跳定时器 */
    private startPing(): void {
        this.stopPing()

        this.pingTimer = window.setInterval(() => {
            this.send({ type: 'ping', ts: Date.now() })
        }, PING_INTERVAL_MS)
    }

    private stopPing(): void {
        if (this.pingTimer !== null) {
            window.clearInterval(this.pingTimer)
            this.pingTimer = null
        }
    }

    /** 清理重连与心跳定时器 */
    private clearTimers(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }

        this.stopPing()
    }

    /** 发送消息(仅连接就绪时) */
    private send(payload: Record<string, unknown>): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return
        }

        this.socket.send(JSON.stringify(payload))
    }

    /** 解析服务端消息并分发 */
    private handleMessage(event: MessageEvent): void {
        let payload: unknown

        try {
            payload = JSON.parse(String(event.data || '{}'))
        } catch {
            console.warn('[BrowserSync] 非 JSON 消息已忽略')

            return
        }

        if (!payload || typeof payload !== 'object') {
            return
        }

        this.dispatch(payload as Record<string, unknown>)
    }

    /**
     * 事件分发表:每个分支只做"把服务端算好的事实写入 store"。
     * 未接管的类型(browser_ready / pong / agent_status / mail_changed 等)静默忽略。
     */
    private dispatch(payload: Record<string, unknown>): void {
        const type = String(payload.type || '').trim()

        if (type === 'model_config_changed') {
            void useModelStore().loadModels({ force: true })

            return
        }

        if (type === 'mail_changed') {
            // 新邮件/邮件状态变更:刷新未读徽标并静默同步已加载的列表
            useMailStore().handleRemoteChange()

            return
        }

        if (type === 'notification_created') {
            useNotificationStore().applyCreated(payload)

            return
        }

        if (type === 'notification_read') {
            useNotificationStore().applyRead(payload)

            return
        }

        if (type === 'notification_removed') {
            useNotificationStore().applyRemoved(payload)

            return
        }
    }
}

/** 全局单例:应用内共享同一条浏览器同步连接 */
export const browserSync = new BrowserSyncService()
