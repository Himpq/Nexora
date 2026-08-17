/**
 * ui-compare6.mjs — 综合验证:config 缓存/turn 完整交互/消息操作/知识库/设置 5 tab/avatar
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

page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 150)}`))

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

// 1. config 缓存
const configCache = await page.evaluate(() => localStorage.getItem('nexora.config'))
console.log('1 config cache:', configCache ? `cached(${configCache.length} chars)` : 'NOT CACHED')

// 2. 打开有消息的会话,检查消息操作/turn/avatar
const firstItem = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const item = items.find((el) => el.textContent.includes('测试会话'))
        || items.find((el) => !el.textContent.includes('新对话'))
        || items[0]
    const r = item.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(firstItem.x, firstItem.y)
await page.waitForTimeout(2500)

const convState = await page.evaluate(() => {
    const userMsg = document.querySelector('.message.user')
    const asstMsg = document.querySelector('.message.assistant')
    const userActions = userMsg ? userMsg.querySelectorAll('.msg-actions .btn-action').length : 0
    const asstActions = asstMsg ? asstMsg.querySelectorAll('.msg-actions .btn-action').length : 0
    const badge = document.querySelector('.model-badge')
    const avatar = document.querySelector('#sidebar-avatar')

    return {
        userActions,
        asstActions,
        badgeText: badge ? badge.textContent.slice(0, 40) : null,
        avatarHasImage: avatar ? avatar.classList.contains('has-image') : null,
        avatarText: avatar ? avatar.textContent.trim() : null,
        turnLines: document.querySelectorAll('.turn-indicator-line').length,
    }
})
console.log('2 conversation:', JSON.stringify(convState))

// 3. turn indicator hover → popup
const turnLine = await page.evaluate(() => {
    const line = document.querySelector('.turn-indicator-line')
    const r = line.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.move(turnLine.x, turnLine.y)
await page.waitForTimeout(400)
const popupState = await page.evaluate(() => {
    const popup = document.querySelector('.turn-indicator-popup')

    return {
        visible: popup ? popup.classList.contains('visible') : null,
        items: popup ? popup.querySelectorAll('.turn-indicator-popup-item').length : 0,
        opacity: popup ? getComputedStyle(popup).opacity : null,
    }
})
console.log('3 turn popup:', JSON.stringify(popupState))

// 4. 点击预览项 → 跳转高亮(对齐原版:跳转入口是 popup 项,线条本身无点击)
const popupItemPos = await page.evaluate(() => {
    const item = document.querySelector('.turn-indicator-popup.visible .turn-indicator-popup-item')

    if (!item) {
        return null
    }

    const r = item.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})

if (popupItemPos) {
    await page.mouse.click(popupItemPos.x, popupItemPos.y)
}

await page.waitForTimeout(500)
const highlightState = await page.evaluate(() => {
    return {
        highlighted: document.querySelectorAll('.message.turn-jump-highlight').length,
        activeLine: document.querySelectorAll('.turn-indicator-line.active').length,
    }
})
console.log('4 turn jump:', JSON.stringify(highlightState))

// 5. 知识库面板
await page.click('#toggleKnowledgePanel')
await page.waitForTimeout(800)
const kbState = await page.evaluate(() => ({
    kbVisible: document.getElementById('knowledgePanel')?.classList.contains('visible'),
    kbItems: document.querySelectorAll('#knowledgePanel .knowledge-item').length,
}))
console.log('5 knowledge panel:', JSON.stringify(kbState))

// 6. 设置各 tab
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(800)
const settingsState = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.settings-nav-item').length,
    active: document.querySelector('.settings-nav-item.active')?.textContent.trim(),
    width: document.querySelector('.g-modal.settings-modal')?.getBoundingClientRect().width,
}))
console.log('6 settings:', JSON.stringify(settingsState))

// 切换每个 tab
for (const label of ['偏好设置', 'Skill', '使用统计', '我的 API Key']) {
    await page.evaluate((lbl) => {
        const btn = Array.from(document.querySelectorAll('.settings-nav-item')).find((b) => b.textContent.trim() === lbl)
        if (btn) btn.click()
    }, label)
    await page.waitForTimeout(300)
    const active = await page.evaluate(() => document.querySelector('.settings-nav-item.active')?.textContent.trim())
    console.log(`   tab -> ${active}`)
}

// 7. 统计 tab 数据
await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.settings-nav-item')).find((b) => b.textContent.trim() === '使用统计')
    if (btn) btn.click()
})
await page.waitForTimeout(500)
const statsText = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.settings-stat-card')).map((el) => el.textContent.trim().replace(/\s+/g, ' '))
})
console.log('7 stats values:', JSON.stringify(statsText))

await browser.close()
console.log('\ndone')
