/**
 * useSidebarCollapseState.ts — NexoraCode 侧边栏 Projects 折叠状态缓存(防刷新丢失)
 *
 * 存储:localStorage `nexora_sidebar_collapse_v1`
 *   → { projects: boolean, projectOverrides: { [projectId]: boolean } }
 *   - `projects`:Projects 区块整体是否收起
 *   - `projectOverrides`:单个项目是否收起,仅记录用户手动切换过的项目
 *     (未记录的项目沿用「当前会话所在项目自动展开」的默认规则)
 *   - 读取失败/隐私模式静默降级,不阻塞渲染
 */

const STORAGE_KEY = 'nexora_sidebar_collapse_v1'

export interface SidebarCollapseState {
    /** Projects 区块整体是否收起 */
    projects: boolean
    /** 单个项目折叠覆盖:{ [projectId]: 是否收起 } */
    projectOverrides: Record<string, boolean>
}

function emptyState(): SidebarCollapseState {
    return { projects: false, projectOverrides: {} }
}

/** 读取折叠状态(缺失/损坏返回默认值) */
export function loadSidebarCollapseState(): SidebarCollapseState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)

        if (!raw) {
            return emptyState()
        }

        const parsed = JSON.parse(raw)

        if (!parsed || typeof parsed !== 'object') {
            return emptyState()
        }

        const source = parsed as Record<string, unknown>
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
    } catch {
        return emptyState()
    }
}

/** 保存折叠状态(全部为默认值时删除整键,避免脏数据残留) */
export function saveSidebarCollapseState(state: SidebarCollapseState): void {
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
