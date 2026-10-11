/**
 * alias-loader.mjs — 注册 `@/` 路径别名解析钩子
 *
 * 用法: node --experimental-strip-types --import ./test/alias-loader.mjs test/xxx.test.mjs
 * 解析逻辑见同目录 alias-hooks.mjs。
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./alias-hooks.mjs', pathToFileURL(import.meta.filename))
