/**
 * ui-compare.mjs — Playwright 对照原版 /chat 与新版 /new 的 UI 差异
 *
 * 运行:node test/ui-compare.mjs
 * 前置:ChatDBServer 已启动,test_user 存在
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5000'
const OUT_DIR = path.resolve('test', 'shots')

// 读取 test_user 密码(仅用于登录,不打印)
const usersRaw = fs.readFileSync(path.resolve('..', 'ChatDBServer', 'data', 'user.json'), 'utf-8')
const users = JSON.parse(usersRaw)
const TEST_USER = 'test_user'
const TEST_PWD = users[TEST_USER].password

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
}

const browser = await chromium.launch({
    headless: true,
    // 使用已缓存的 chromium(版本与 playwright-core 不完全匹配时显式指定)
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

page.on('console', (msg) => {
    if (msg.type() === 'error') {
        console.log(`[console.error] ${msg.text().slice(0, 200)}`)
    }
})
page.on('pageerror', (err) => {
    console.log(`[pageerror] ${String(err).slice(0, 200)}`)
})

// 1. 登录(原版 Flask 登录页)
console.log('--- login ---')
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)
console.log('after login url:', page.url())

// 2. 检查新版 /new
console.log('--- /new ---')
await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const newUserInfo = await page.evaluate(() => {
    const btn = document.querySelector('.user-profile-button')
    const avatar = document.querySelector('#sidebar-avatar')
    const name = document.querySelector('.profile-name')

    return {
        btnExists: !!btn,
        btnVisible: btn ? !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length) : false,
        btnRect: btn ? btn.getBoundingClientRect().toJSON() : null,
        btnDisplay: btn ? getComputedStyle(btn).display : null,
        avatarText: avatar ? avatar.textContent : null,
        nameText: name ? name.textContent : null,
        sidebarFooterExists: !!document.querySelector('.sidebar-footer'),
        sidebarVisible: !!document.querySelector('.sidebar'),
    }
})
console.log('new user area:', JSON.stringify(newUserInfo))
await page.screenshot({ path: path.join(OUT_DIR, 'new-overview.png'), fullPage: false })

// 3. 检查原版 /chat
console.log('--- /chat ---')
await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const origUserInfo = await page.evaluate(() => {
    const btn = document.querySelector('.user-profile-button')
    const avatar = document.querySelector('#sidebar-avatar')
    const name = document.querySelector('.profile-name')

    return {
        btnExists: !!btn,
        btnVisible: btn ? !!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length) : false,
        btnRect: btn ? btn.getBoundingClientRect().toJSON() : null,
        btnDisplay: btn ? getComputedStyle(btn).display : null,
        avatarText: avatar ? avatar.textContent : null,
        nameText: name ? name.textContent : null,
        sidebarFooterExists: !!document.querySelector('.sidebar-footer'),
        sidebarVisible: !!document.querySelector('.sidebar'),
    }
})
console.log('origin user area:', JSON.stringify(origUserInfo))
await page.screenshot({ path: path.join(OUT_DIR, 'origin-overview.png'), fullPage: false })

await browser.close()

console.log('\nscreenshots saved to', OUT_DIR)
