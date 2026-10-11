/**
 * alias-hooks.mjs — `@/` 路径别名的模块解析钩子
 *
 * 由 test/alias-loader.mjs 通过 module.register 注册。
 * 除别名映射外还补全省略的 `.ts` 扩展名(vite 允许省略,node 不允许)。
 */

import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'

const SRC_ROOT = path.resolve(import.meta.dirname, '..', 'src')

/** 无扩展名时按 .ts / .tsx / /index.ts 顺序探测 */
function withExtension(target) {
    if (path.extname(target)) {
        return target
    }

    for (const candidate of [`${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')]) {
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return target
}

export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        const target = withExtension(path.join(SRC_ROOT, specifier.slice(2)))

        return {
            url: pathToFileURL(target).href,
            shortCircuit: true,
        }
    }

    return nextResolve(specifier, context)
}
