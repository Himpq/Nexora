/**
 * ui-compare3.mjs — 小视口布局 + pin 排序 + turn indicator 验证
 *
 * 运行:node test/ui-compare3.mjs(需 ChatDBServer 已启动)
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
// 笔记本常见视口
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
const page = await context.newPage()

page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 150)}`))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(2000)

console.log('===== 新版 /new @1366x768 =====')
await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1. 布局:footer 可见性 + 滚动
const layout = await page.evaluate(() => {
    const footer = document.querySelector('.sidebar-footer')
    const content = document.querySelector('.sidebar-content')
    const app = document.querySelector('.app-container')
    const sidebar = document.querySelector('.sidebar')
    const footerRect = footer ? footer.getBoundingClientRect() : null

    return {
        footerInViewport: footerRect ? footerRect.top >= 0 && footerRect.bottom <= window.innerHeight : null,
        footerRect: footerRect ? { top: footerRect.top, bottom: footerRect.bottom, h: footerRect.height } : null,
        viewportH: window.innerHeight,
        contentScrollH: content ? content.scrollHeight : 0,
        contentClientH: content ? content.clientHeight : 0,
        contentOverflow: content ? getComputedStyle(content).overflowY : null,
        appHeight: app ? app.getBoundingClientRect().height : 0,
        sidebarHeight: sidebar ? sidebar.getBoundingClientRect().height : 0,
    }
})
console.log('layout:', JSON.stringify(layout))

// 2. pin 排序验证:右键第一个会话打开菜单,点置顶
const firstRect = await page.evaluate(() => {
    const item = document.querySelector('.conversation-item')
    const r = item.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2, firstId: item.getAttribute('data-conversation-id') }
})
console.log('first item:', firstRect)

const beforeTitles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.conversation-item .title')).slice(0, 3).map((t) => t.textContent.trim())
})
console.log('before pin:', JSON.stringify(beforeTitles))

await page.mouse.click(firstRect.x, firstRect.y, { button: 'right' })
await page.waitForTimeout(400)

const menuState = await page.evaluate(() => {
    const menu = document.getElementById('pinContextMenu')

    return {
        active: menu ? menu.classList.contains('active') : null,
        display: menu ? getComputedStyle(menu).display : null,
        btnText: document.querySelector('#pinContextMenuAction span')?.textContent,
    }
})
console.log('context menu:', JSON.stringify(menuState))

// 点"置顶"
await page.click('#pinContextMenuAction')
await page.waitForTimeout(1000)

const pinResult = await page.evaluate(() => {
    const after = Array.from(document.querySelectorAll('.conversation-item .title')).slice(0, 3).map((t) => t.textContent.trim())
    const pinnedItems = Array.from(document.querySelectorAll('.conversation-item'))
        .filter((el) => el.querySelector('.conversation-pin-icon'))
        .map((el) => el.getAttribute('data-conversation-id'))

    return { after, pinnedItems }
})
console.log('after pin:', JSON.stringify(pinResult))

// 3. 打开会话,检查 turn indicator
await page.mouse.click(firstRect.x, firstRect.y)
await page.waitForTimeout(2500)

const openResult = await page.evaluate(() => {
    const turnPanel = document.getElementById('turnIndicatorPanel')
    const turnLines = document.querySelectorAll('.turn-indicator-line')
    const msgs = document.querySelectorAll('.message')

    return {
        turnPanelVisible: turnPanel ? turnPanel.classList.contains('visible') : null,
        turnLineCount: turnLines.length,
        messageCount: msgs.length,
        turnLineActive: document.querySelectorAll('.turn-indicator-line.active').length,
    }
})
console.log('open conv:', JSON.stringify(openResult))

// 4. 清理:取消 pin
const pinnedRect = await page.evaluate(() => {
    const el = document.querySelector('.conversation-item .conversation-pin-icon')?.closest('.conversation-item')

    if (!el) return null

    const r = el.getBoundingClientRect()

    return { x: r.left + 20, y: r.top + 10 }
})
if (pinnedRect) {
    await page.mouse.click(pinnedRect.x, pinnedRect.y, { button: 'right' })
    await page.waitForTimeout(400)
    await page.click('#pinContextMenuAction')
    await page.waitForTimeout(800)
    console.log('cleanup pin done')
}

await browser.close()
console.log('\ndone')
