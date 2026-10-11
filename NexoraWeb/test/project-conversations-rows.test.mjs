/**
 * project-conversations-rows.test.mjs — 项目会话「默认 5 条 + 展开更多」分页逻辑测试
 *
 * 覆盖:
 *   1. 总数 <= 5:全部展示,无隐藏
 *   2. 总数 > 5:默认只展示最新 5 条,其余隐藏
 *   3. 每次展开追加 10 条,直到全部展开
 *   4. 展开步数超量时夹取到总条数,不越界
 *   5. sliceVisibleRows 保持原顺序且不修改入参
 *   6. 边界:0 条 / 负数 / 非法输入
 */

import assert from 'node:assert/strict'

import {
    PROJECT_INITIAL_VISIBLE_ROWS,
    PROJECT_REVEAL_STEP_ROWS,
    resolveVisibleRowLimit,
    sliceVisibleRows,
} from '../src/components/nexoracode/projectConversations.ts'

// ---------- 常量契约 ----------

assert.equal(PROJECT_INITIAL_VISIBLE_ROWS, 5, '默认展示条数应为 5')
assert.equal(PROJECT_REVEAL_STEP_ROWS, 10, '每次展开追加条数应为 10')

// ---------- 1. 总数 <= 5 ----------

assert.equal(resolveVisibleRowLimit(0), 0, '0 条时可见 0 条')
assert.equal(resolveVisibleRowLimit(1), 1, '1 条时可见 1 条')
assert.equal(resolveVisibleRowLimit(5), 5, '正好 5 条时全部可见')
assert.equal(resolveVisibleRowLimit(3, 2), 3, '总数少于 5 时展开也不越界')

// ---------- 2. 总数 > 5:默认 5 条 ----------

assert.equal(resolveVisibleRowLimit(6), 5, '6 条时默认可见 5 条')
assert.equal(resolveVisibleRowLimit(20), 5, '20 条时默认可见 5 条')
assert.equal(resolveVisibleRowLimit(100), 5, '100 条时默认可见 5 条')

// ---------- 3. 逐次展开 ----------

assert.equal(resolveVisibleRowLimit(20, 1), 15, '展开 1 次 → 15 条')
assert.equal(resolveVisibleRowLimit(20, 2), 20, '展开 2 次 → 夹取到 20 条')
assert.equal(resolveVisibleRowLimit(100, 1), 15, '展开 1 次 → 15 条')
assert.equal(resolveVisibleRowLimit(100, 2), 25, '展开 2 次 → 25 条')
assert.equal(resolveVisibleRowLimit(100, 9), 95, '展开 9 次 → 95 条')
assert.equal(resolveVisibleRowLimit(100, 10), 100, '展开 10 次 → 全部 100 条')

// ---------- 4. 超量夹取 ----------

assert.equal(resolveVisibleRowLimit(20, 99), 20, '展开次数超量时夹取到总条数')
assert.equal(resolveVisibleRowLimit(7, 50), 7, '小集合超量展开也不越界')

// ---------- 5. sliceVisibleRows 顺序与不可变性 ----------

const rows = Array.from({ length: 23 }, (_, index) => ({ id: `c${index}` }))
const snapshot = rows.map((row) => row.id)

assert.deepEqual(
    sliceVisibleRows(rows).map((row) => row.id),
    ['c0', 'c1', 'c2', 'c3', 'c4'],
    '默认应取最新 5 条(前缀,保持原顺序)',
)

assert.deepEqual(
    sliceVisibleRows(rows, 1).map((row) => row.id),
    Array.from({ length: 15 }, (_, index) => `c${index}`),
    '展开 1 次应取前 15 条',
)

assert.deepEqual(
    sliceVisibleRows(rows, 2).map((row) => row.id),
    Array.from({ length: 23 }, (_, index) => `c${index}`),
    '展开 2 次应取全部 23 条',
)

assert.deepEqual(rows.map((row) => row.id), snapshot, 'sliceVisibleRows 不应修改入参')

// 每次展开结果都是前一次的超集(只追加,不重排)
let previous = sliceVisibleRows(rows, 0).length

for (let step = 1; step <= 4; step += 1) {
    const current = sliceVisibleRows(rows, step).length

    assert.ok(current >= previous, `展开第 ${step} 次后可见条数不应减少`)
    previous = current
}

// ---------- 6. 边界与非法输入 ----------

assert.equal(resolveVisibleRowLimit(-5), 0, '负数总数应归零')
assert.equal(resolveVisibleRowLimit(Number.NaN), 0, 'NaN 总数应归零')
assert.equal(resolveVisibleRowLimit(20, -3), 5, '负数展开步数应视为 0')
assert.equal(resolveVisibleRowLimit(20, Number.NaN), 5, 'NaN 展开步数应视为 0')
assert.equal(resolveVisibleRowLimit(10.9), 5, '小数总数应向下取整')
assert.deepEqual(sliceVisibleRows(null), [], 'null 入参返回空数组')
assert.deepEqual(sliceVisibleRows(undefined), [], 'undefined 入参返回空数组')

console.log('project-conversations-rows.test.mjs: all assertions passed')
