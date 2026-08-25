/**
 * ui-compare5.mjs — 浮层协调器(overlay)互斥与自动关闭验证
 *
 * 验证:
 *   1. 模型下拉与工具下拉互斥(开一个关另一个)
 *   2. 文件侧栏被工具下拉自动关闭
 *   3. 用户菜单被模型下拉自动关闭
 *   4. 点击外部自动关闭当前下拉
 *   5. 右键菜单打开后点击外部关闭
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5000'

const usersRaw = fs.readFileSync(path.resolve('..', 'ChatDBServer', 'data', 'user.json'), 'utf-8')
const users = JSON.parse(usersRaw)
const TEST_USER = 'test_user'
const TEST_PWD = users[TEST_USER].password

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(2000)
await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const state = () => page.evaluate(() => ({
    modelOpen: document.querySelector('#modelOptions')?.classList.contains('select-hide') === false,
    toolsOpen: document.querySelector('#toolsModeDropdown')?.classList.contains('open'),
    userMenuActive: document.querySelector('#userMenu')?.classList.contains('active'),
    filePanelVisible: document.querySelector('#filePanel')?.classList.contains('visible'),
    ctxMenuActive: document.querySelector('#pinContextMenu')?.classList.contains('active'),
}))

// 1. 模型下拉 → 工具下拉互斥
await page.click('#currentModelDisplay')
await page.waitForTimeout(300)
let s = await state()
console.log('1a model open (tools should be closed):', JSON.stringify(s))

await page.click('#toolsModeTrigger')
await page.waitForTimeout(300)
s = await state()
console.log('1b tools open (model should auto-close):', JSON.stringify(s))

// 2. 文件侧栏被工具下拉关闭
await page.click('#toggleFilePanel')
await page.waitForTimeout(400)
s = await state()
console.log('2a file panel open:', JSON.stringify(s))

await page.click('#toolsModeTrigger')
await page.waitForTimeout(300)
s = await state()
console.log('2b tools open (file panel should auto-close):', JSON.stringify(s))

// 3. 用户菜单被模型下拉关闭
await page.click('#usernameBtn')
await page.waitForTimeout(300)
s = await state()
console.log('3a user menu open:', JSON.stringify(s))

await page.click('#currentModelDisplay')
await page.waitForTimeout(300)
s = await state()
console.log('3b model open (user menu should auto-close):', JSON.stringify(s))

// 4. 点击外部关闭当前下拉
await page.click('#conversationTitle')
await page.waitForTimeout(300)
s = await state()
console.log('4 click outside (model should close):', JSON.stringify(s))

// 5. 右键菜单打开 → 点击外部关闭
const firstItem = await page.evaluate(() => {
    const item = document.querySelector('.conversation-item')
    const r = item.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(firstItem.x, firstItem.y, { button: 'right' })
await page.waitForTimeout(300)
s = await state()
console.log('5a context menu open:', JSON.stringify(s))

await page.mouse.click(700, 400)
await page.waitForTimeout(300)
s = await state()
console.log('5b click outside (context menu should close):', JSON.stringify(s))

await browser.close()
console.log('\ndone')
