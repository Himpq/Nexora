/**
 * sidebar-collapse-state.test.mjs — NexoraCode 侧边栏 Projects 折叠状态持久化测试
 *
 * 权威存储在后端 /api/user/preferences(桌面端每次启动端口都变,localStorage
 * 按 origin 隔离跨启动会丢),localStorage 仅作同步首帧缓存。
 *
 * 覆盖:
 *   1. 无缓存时返回默认值(Projects 展开、无项目覆盖)
 *   2. 缓存写入后可原样读回(Projects 整体 + 单项目覆盖)
 *   3. 全部为默认值时删除整键,不留脏数据
 *   4. 损坏 JSON / 非对象 / 非布尔覆盖值 静默降级
 *   5. localStorage 抛异常(隐私模式)时不崩溃
 *   6. 后端拉取:命中后端值 / 后端无键时回退缓存 / 请求失败回退缓存
 *   7. 保存:POST 到后端并刷新缓存
 *   8. 项目折叠规则:手动记录优先,当前会话项目仅作默认展开
 */

import assert from 'node:assert/strict'

import {
    cacheSidebarCollapseState,
    fetchSidebarCollapseState,
    loadSidebarCollapseState,
    normalizeSidebarCollapseState,
    resolveProjectCollapsed,
    saveSidebarCollapseState,
} from '../src/composables/useSidebarCollapseState.ts'

const STORAGE_KEY = 'nexora_sidebar_collapse_v1'

/** 最小 localStorage 替身,可注入异常 */
function installStorage(options = {}) {
    const map = new Map()

    globalThis.localStorage = {
        getItem(key) {
            if (options.throwOnGet) {
                throw new Error('storage disabled')
            }

            return map.has(key) ? map.get(key) : null
        },
        setItem(key, value) {
            if (options.throwOnSet) {
                throw new Error('quota exceeded')
            }

            map.set(key, String(value))
        },
        removeItem(key) {
            map.delete(key)
        },
    }

    return map
}

/** 最小 fetch 替身:记录请求,按 handler 返回响应 */
function installFetch(handler) {
    const calls = []

    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, init })

        return handler(url, init)
    }

    return calls
}

function jsonResponse(payload, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        json: async () => payload,
    }
}

// ---------- 1. 无缓存 → 默认值 ----------

installStorage()
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: {} },
    '无缓存时应返回默认值',
)

// ---------- 2. 缓存写入后读回 ----------

installStorage()
cacheSidebarCollapseState({
    projects: true,
    projectOverrides: { 'F:\\Code\\AI\\ChatDB': true, 'D:\\work\\demo': false },
})
assert.deepEqual(
    loadSidebarCollapseState(),
    {
        projects: true,
        projectOverrides: { 'F:\\Code\\AI\\ChatDB': true, 'D:\\work\\demo': false },
    },
    '缓存的 Projects 与项目覆盖应能原样读回',
)

// 只收起单个项目、Projects 整体展开
installStorage()
cacheSidebarCollapseState({ projects: false, projectOverrides: { projA: true } })
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: { projA: true } },
    '仅项目覆盖也应缓存',
)

// ---------- 3. 全默认值 → 删除整键 ----------

const cleaned = installStorage()
cacheSidebarCollapseState({ projects: false, projectOverrides: {} })
assert.equal(cleaned.has(STORAGE_KEY), false, '全默认值时应删除整键')

// 先写入再清空,键应被移除
const reused = installStorage()
cacheSidebarCollapseState({ projects: true, projectOverrides: { projA: true } })
assert.equal(reused.has(STORAGE_KEY), true, '有状态时应写入键')
cacheSidebarCollapseState({ projects: false, projectOverrides: {} })
assert.equal(reused.has(STORAGE_KEY), false, '状态清空后应删除键')

// ---------- 4. 脏数据静默降级 ----------

installStorage().set(STORAGE_KEY, '{ not json')
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: {} },
    '损坏 JSON 应降级为默认值',
)

installStorage().set(STORAGE_KEY, '"a string"')
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: {} },
    '非对象 JSON 应降级为默认值',
)

assert.deepEqual(
    normalizeSidebarCollapseState({
        projects: 'yes',
        projectOverrides: { good: true, bad: 'x', '': true },
    }),
    { projects: false, projectOverrides: { good: true } },
    '非布尔 projects 与非布尔/空键覆盖应被过滤',
)

// ---------- 5. localStorage 抛异常不崩溃 ----------

installStorage({ throwOnGet: true })
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: {} },
    '读取抛异常时应降级为默认值',
)

installStorage({ throwOnSet: true })
cacheSidebarCollapseState({ projects: true, projectOverrides: { projA: true } })

// ---------- 6. 后端拉取 ----------

// 后端有值 → 用后端值,并回写缓存
installStorage()
installFetch(() => jsonResponse({
    success: true,
    preferences: {
        ui_sidebar_collapse: { projects: true, projectOverrides: { projA: false } },
    },
}))
assert.deepEqual(
    await fetchSidebarCollapseState(),
    { projects: true, projectOverrides: { projA: false } },
    '后端有值时应用后端权威状态',
)
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: true, projectOverrides: { projA: false } },
    '后端值应回写 localStorage 缓存',
)

// 后端无该键(首次运行) → 沿用本地缓存,不清掉已有状态
installStorage()
cacheSidebarCollapseState({ projects: false, projectOverrides: { local: true } })
installFetch(() => jsonResponse({ success: true, preferences: {} }))
assert.deepEqual(
    await fetchSidebarCollapseState(),
    { projects: false, projectOverrides: { local: true } },
    '后端无键时应沿用本地缓存',
)

// 请求失败 → 回退本地缓存
installStorage()
cacheSidebarCollapseState({ projects: false, projectOverrides: { cached: true } })
installFetch(() => { throw new Error('network down') })
assert.deepEqual(
    await fetchSidebarCollapseState(),
    { projects: false, projectOverrides: { cached: true } },
    '请求失败时应回退本地缓存',
)

// 非 2xx → 回退本地缓存
installStorage()
cacheSidebarCollapseState({ projects: false, projectOverrides: { cached: true } })
installFetch(() => jsonResponse({}, false))
assert.deepEqual(
    await fetchSidebarCollapseState(),
    { projects: false, projectOverrides: { cached: true } },
    '非 2xx 响应应回退本地缓存',
)

// ---------- 7. 保存 → POST 后端 + 刷新缓存 ----------

installStorage()
const saveCalls = installFetch(() => jsonResponse({ success: true }))
saveSidebarCollapseState({ projects: true, projectOverrides: { projA: false } })
assert.equal(saveCalls.length, 1, '保存应发起一次后端请求')
assert.equal(saveCalls[0].url, '/api/user/preferences', '应 POST 到偏好端点')
assert.equal(saveCalls[0].init.method, 'POST', '保存应使用 POST')
assert.deepEqual(
    JSON.parse(saveCalls[0].init.body).preferences.ui_sidebar_collapse,
    { projects: true, projectOverrides: { projA: false } },
    '请求体应携带折叠状态',
)
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: true, projectOverrides: { projA: false } },
    '保存应同时刷新 localStorage 缓存',
)

// ---------- 8. 项目折叠规则:手动记录优先,当前会话项目仅作默认展开 ----------

// 未手动操作过:当前会话所在项目默认展开,其余项目默认收起
assert.equal(
    resolveProjectCollapsed({ holdsCurrent: true, override: undefined }),
    false,
    '未手动操作时,当前会话所在项目应默认展开',
)
assert.equal(
    resolveProjectCollapsed({ holdsCurrent: false, override: undefined }),
    true,
    '未手动操作时,非当前项目应默认收起',
)

// 手动记录优先:当前会话所在项目也能被手动收起/展开,不再被自动展开压住
assert.equal(
    resolveProjectCollapsed({ holdsCurrent: true, override: true }),
    true,
    '当前会话所在项目手动收起后应保持收起(不得被自动展开压住)',
)
assert.equal(
    resolveProjectCollapsed({ holdsCurrent: true, override: false }),
    false,
    '当前会话所在项目手动展开后应保持展开',
)

// 非当前项目的手动记录同样优先
assert.equal(
    resolveProjectCollapsed({ holdsCurrent: false, override: false }),
    false,
    '手动展开过的非当前项目应保持展开',
)
assert.equal(resolveProjectCollapsed({ holdsCurrent: false, override: true }), true)

console.log('sidebar-collapse-state.test.mjs: all assertions passed')
