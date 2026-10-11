/**
 * sidebar-collapse-state.test.mjs — NexoraCode 侧边栏 Projects 折叠状态持久化测试
 *
 * 覆盖:
 *   1. 无缓存时返回默认值(Projects 展开、无项目覆盖)
 *   2. 保存后可原样读回(Projects 整体 + 单项目覆盖)
 *   3. 全部为默认值时删除整键,不留脏数据
 *   4. 损坏 JSON / 非对象 / 非布尔覆盖值 静默降级
 *   5. localStorage 抛异常(隐私模式)时不崩溃
 */

import assert from 'node:assert/strict'

import {
    loadSidebarCollapseState,
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

// ---------- 1. 无缓存 → 默认值 ----------

installStorage()
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: {} },
    '无缓存时应返回默认值',
)

// ---------- 2. 保存后读回 ----------

installStorage()
saveSidebarCollapseState({
    projects: true,
    projectOverrides: { 'F:\\Code\\AI\\ChatDB': true, 'D:\\work\\demo': false },
})
assert.deepEqual(
    loadSidebarCollapseState(),
    {
        projects: true,
        projectOverrides: { 'F:\\Code\\AI\\ChatDB': true, 'D:\\work\\demo': false },
    },
    '保存的 Projects 与项目覆盖应能原样读回',
)

// 只收起单个项目、Projects 整体展开
installStorage()
saveSidebarCollapseState({ projects: false, projectOverrides: { projA: true } })
assert.deepEqual(
    loadSidebarCollapseState(),
    { projects: false, projectOverrides: { projA: true } },
    '仅项目覆盖也应持久化',
)

// ---------- 3. 全默认值 → 删除整键 ----------

const cleaned = installStorage()
saveSidebarCollapseState({ projects: false, projectOverrides: {} })
assert.equal(cleaned.has(STORAGE_KEY), false, '全默认值时应删除整键')

// 先写入再清空,键应被移除
const reused = installStorage()
saveSidebarCollapseState({ projects: true, projectOverrides: { projA: true } })
assert.equal(reused.has(STORAGE_KEY), true, '有状态时应写入键')
saveSidebarCollapseState({ projects: false, projectOverrides: {} })
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

installStorage().set(STORAGE_KEY, JSON.stringify({
    projects: 'yes',
    projectOverrides: { good: true, bad: 'x', '': true },
}))
assert.deepEqual(
    loadSidebarCollapseState(),
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
saveSidebarCollapseState({ projects: true, projectOverrides: { projA: true } })

console.log('sidebar-collapse-state.test.mjs: all assertions passed')
