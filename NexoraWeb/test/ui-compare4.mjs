/**
 * ui-compare4.mjs — 验证 ring / 设置窗口尺寸 / 工具下拉联动 / 移动端
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

async function login(context) {
    const page = await context.newPage()

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('#username', TEST_USER)
    await page.fill('#password', TEST_PWD)
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.click('#loginBtn'),
    ])
    await page.waitForTimeout(2000)

    return page
}

// ===== 桌面端 =====
console.log('===== 桌面 1440x900 =====')
const ctxDesktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await login(ctxDesktop)

await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1. 打开会话,检查 ring
const firstRect = await page.evaluate(() => {
    const item = document.querySelector('.conversation-item')
    const r = item.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(firstRect.x, firstRect.y)
await page.waitForTimeout(2500)

const ringState = await page.evaluate(() => {
    const ring = document.getElementById('tokenBudgetRing')
    const usage = document.getElementById('tokenBudgetUsage')
    const ringStyle = ring ? getComputedStyle(ring) : null

    return {
        ringBg: ringStyle ? ringStyle.backgroundImage.slice(0, 100) : null,
        usageText: usage ? usage.textContent : null,
        usageColor: usage ? getComputedStyle(usage).color : null,
    }
})
console.log('ring:', JSON.stringify(ringState))

// 2. 打开文件侧栏,再打开工具下拉,检查文件侧栏是否关闭
await page.click('#toggleFilePanel')
await page.waitForTimeout(600)
const filePanelOpenBefore = await page.evaluate(() => {
    return document.getElementById('filePanel')?.classList.contains('visible')
})
console.log('filePanel open before tools:', filePanelOpenBefore)

await page.click('#toolsModeTrigger')
await page.waitForTimeout(600)
const afterTools = await page.evaluate(() => {
    return {
        filePanelVisible: document.getElementById('filePanel')?.classList.contains('visible'),
        toolsMenuOpen: document.getElementById('toolsModeDropdown')?.classList.contains('open'),
        toolsMenuDisplay: getComputedStyle(document.querySelector('.tool-mode-menu')).display,
    }
})
console.log('after tools open:', JSON.stringify(afterTools))

// 3. 打开设置,检查尺寸
await page.click('#usernameBtn')
await page.waitForTimeout(400)
await page.click('#userMenu .menu-item')
await page.waitForTimeout(800)

const settings = await page.evaluate(() => {
    const modal = document.querySelector('#settingsModal .settings-modal-custom')
    const backdrop = document.getElementById('settingsModal')
    const rect = modal.getBoundingClientRect()

    return {
        active: backdrop.classList.contains('active'),
        width: rect.width,
        height: rect.height,
        maxWidth: getComputedStyle(modal).maxWidth,
        maxHeight: getComputedStyle(modal).maxHeight,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        navTabs: document.querySelectorAll('.settings-nav .admin-tab').length,
        hasProfile: !!document.querySelector('#settings-profile-tab'),
    }
})
console.log('settings modal:', JSON.stringify(settings))

await ctxDesktop.close()

// ===== 移动端 =====
console.log('\n===== 移动端 390x844 =====')
const ctxMobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
})
const mpage = await login(ctxMobile)
await mpage.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await mpage.waitForTimeout(2500)

const mobileState = await mpage.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')
    const sidebarRect = sidebar.getBoundingClientRect()
    const input = document.getElementById('messageInput')
    const sendBtn = document.getElementById('sendBtn')

    return {
        sidebarTransform: sidebarRect.left,
        sidebarVisible: sidebarRect.width > 0 && sidebarRect.left >= 0,
        inputExists: !!input,
        sendBtnExists: !!sendBtn,
        inputRect: input ? input.getBoundingClientRect().toJSON() : null,
        sendRect: sendBtn ? sendBtn.getBoundingClientRect().toJSON() : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        messagesArea: document.getElementById('messagesContainer') ? getComputedStyle(document.getElementById('messagesContainer')).overflowY : null,
    }
})
console.log('mobile:', JSON.stringify(mobileState))

// 移动端点击发送按钮测试
const sendClick = await mpage.evaluate(() => {
    const input = document.getElementById('messageInput')
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const btn = document.getElementById('sendBtn')

    return { btnDisabled: btn.disabled, btnRect: btn.getBoundingClientRect().toJSON() }
})
console.log('mobile send btn:', JSON.stringify(sendClick))

await ctxMobile.close()
await browser.close()
console.log('\ndone')
