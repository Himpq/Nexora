/**
 * useSidebarCollapseState.ts — NexoraCode 侧边栏 Projects 折叠状态持久化
 *
 * 为什么不能只用 localStorage:
 *   桌面端每次启动都会向系统申请一个随机空闲端口作为本地服务 origin
 *   (NexoraCode/core/server.py 的 bind_local_port),而 localStorage 按 origin
 *   (含端口)隔离。于是「刷新页面」端口不变能读到,「关闭重开 NexoraCode」
 *   端口变了就读不到,折叠状态表现为丢失。
 *
 * 因此权威存储放在后端 /api/user/preferences(落盘 config.json,与端口无关),
 * localStorage 仅作为同步首帧缓存:让组件挂载时立刻有值可用,避免闪一下默认态。
 *   读取:先取 localStorage 缓存渲染,再异步拉后端覆盖。
 *   写入:同时写后端(权威)与 localStorage(缓存)。
 *
 * 存储结构:
 *   { projects: boolean, projectOverrides: { [projectId]: boolean } }
 *   - `projects`:Projects 区块整体是否收起
 *   - `projectOverrides`:单个项目是否收起,仅记录用户手动切换过的项目
 *     (未记录的项目沿用「当前会话所在项目自动展开」的默认规则)
 *   - 读取失败/隐私模式静默降级,不阻塞渲染
 */

const STORAGE_KEY = 'nexora_sidebar_collapse_v1'
const PREFERENCE_KEY = 'ui_sidebar_collapse'
const PREFERENCES_ENDPOINT = '/api/user/preferences'

export interface SidebarCollapseState {
    /** Projects 区块整体是否收起 */
    projects: boolean
    /** 单个项目折叠覆盖:{ [projectId]: 是否收起 } */
    projectOverrides: Record<string, boolean>
}

function emptyState(): SidebarCollapseState {
    return { projects: false, projectOverrides: {} }
}

/** 把任意来源的原始数据规整为合法状态(脏数据静默丢弃) */
export function normalizeSidebarCollapseState(raw: unknown): SidebarCollapseState {
    if (!raw || typeof raw !== 'object') {
        return emptyState()
    }

    const source = raw as Record<string, unknown>
    const overrides: Record<string, boolean> = {}
    const rawOverrides = source.projectOverrides

    if (rawOverrides && typeof rawOverrides === 'object') {
        Object.entries(rawOverrides as Record<string, unknown>).forEach(([key, value]) => {
            const projectId = String(key || '').trim()

            if (projectId && typeof value === 'boolean') {
                overrides[projectId] = value
            }
        })
    }

    return {
        projects: source.projects === true,
        projectOverrides: overrides,
    }
}

/** 读取 localStorage 缓存(同步,供首帧渲染;缺失/损坏返回默认值) */
export function loadSidebarCollapseState(): SidebarCollapseState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)

        if (!raw) {
            return emptyState()
        }

        return normalizeSidebarCollapseState(JSON.parse(raw))
    } catch {
        return emptyState()
    }
}

/** 写入 localStorage 缓存(全默认值时删除整键,避免脏数据残留) */
export function cacheSidebarCollapseState(state: SidebarCollapseState): void {
    const overrides = state.projectOverrides || {}
    const hasOverrides = Object.keys(overrides).length > 0

    try {
        if (!state.projects && !hasOverrides) {
            localStorage.removeItem(STORAGE_KEY)

            return
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            projects: state.projects === true,
            projectOverrides: overrides,
        }))
    } catch {
        // 配额/隐私模式失败不阻塞交互
    }
}

/** 从后端拉取权威折叠状态;失败时回退到 localStorage 缓存 */
export async function fetchSidebarCollapseState(): Promise<SidebarCollapseState> {
    try {
        const res = await fetch(PREFERENCES_ENDPOINT, { credentials: 'include' })

        if (!res.ok) {
            return loadSidebarCollapseState()
        }

        const data = await res.json()
        const stored = data && typeof data === 'object'
            ? (data as Record<string, unknown>).preferences
            : null
        const raw = stored && typeof stored === 'object'
            ? (stored as Record<string, unknown>)[PREFERENCE_KEY]
            : null

        // 后端从未存过该键(首次运行)时,沿用本地缓存,避免把已有状态清掉
        if (!raw || typeof raw !== 'object') {
            return loadSidebarCollapseState()
        }

        const state = normalizeSidebarCollapseState(raw)
        cacheSidebarCollapseState(state)

        return state
    } catch {
        return loadSidebarCollapseState()
    }
}

/** 保存折叠状态:后端为权威存储,同时刷新 localStorage 缓存 */
export function saveSidebarCollapseState(state: SidebarCollapseState): void {
    cacheSidebarCollapseState(state)

    try {
        void fetch(PREFERENCES_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preferences: {
                    [PREFERENCE_KEY]: {
                        projects: state.projects === true,
                        projectOverrides: state.projectOverrides || {},
                    },
                },
            }),
        }).catch(() => {
            // 网络失败不阻塞交互;下次变更会重试写入
        })
    } catch {
        // fetch 同步抛异常(极少见)时同样不阻塞交互
    }
}

/**
 * 判定单个项目是否应收起。
 *
 * 规则:手动折叠记录优先,它只在「用户从未操作过该项目」时让位给默认值。
 * 默认值 = 该项目是否包含当前会话(包含则展开,否则收起)。
 *
 * 这样两种诉求都成立:
 *   - 切到某个会话时,它所在的项目默认自动展开,侧边栏里能直接看到;
 *   - 用户仍可手动收起/展开任意项目,包括当前会话所在的项目 ——
 *     旧实现把「当前会话项目」做成硬锁(override 被无条件压过),
 *     导致该项目点击毫无反应,既收不起也展不开。
 *
 * 抽成纯函数以便单测。
 */
export function resolveProjectCollapsed(options: {
    /** 该项目是否包含当前会话 */
    holdsCurrent: boolean
    /** 用户手动折叠记录;undefined 表示未手动操作过 */
    override: boolean | undefined
}): boolean {
    if (options.override !== undefined) {
        return options.override
    }

    return !options.holdsCurrent
}
