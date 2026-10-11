/**
 * run-all.mjs — 依次运行 test/ 下全部 *.test.mjs
 *
 * 为什么不用 `node --test test/`:Node 24 的 --test 不接受目录导入,
 * 且这些用例是普通脚本(靠 assert 抛错),逐个 spawn 才能拿到准确退出码。
 */

import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter((name) => name.endsWith('.test.mjs')).sort()
const failed = []

for (const file of files) {
    const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--import', './test/alias-loader.mjs', join('test', file)],
        { cwd: join(here, '..'), encoding: 'utf8' },
    )

    if (result.status === 0) {
        console.log(`PASS ${file}`)
        continue
    }

    failed.push(file)
    console.log(`FAIL ${file}`)
    console.log((result.stdout || '').trim())
    console.log((result.stderr || '').trim())
}

console.log(`\n${files.length - failed.length}/${files.length} passed`)

if (failed.length > 0) {
    console.log(`failed: ${failed.join(', ')}`)
    process.exitCode = 1
}
