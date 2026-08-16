// gddp-review-check.mjs — GDDP 综合审查回归
// 验证:视图切换返回 + 笔记跳转 + admin-user-item 是 div 非 button + 回收站 legacy + profile 可编辑
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 150)))

await page.goto('http://127.0.0.1:5000/login', { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'test_user')
await page.fill('#password', users.test_user.password)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)
await page.goto('http://127.0.0.1:5000/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1. Files 打开 → 返回聊天
await page.evaluate(() => document.querySelector('#fileCenterBtn')?.click())
await page.waitForTimeout(800)
await page.evaluate(() => document.querySelector('.chat-header .header-left .btn-icon')?.click())
await page.waitForTimeout(600)
const backToChat = await page.evaluate(() => {
    return {
        chatVisible: !!document.querySelector('.messages-area, .welcome-screen'),
        fileGone: !document.querySelector('.file-center-view'),
    }
})
console.log('1 view back:', JSON.stringify(backToChat))

// 2. 设置打开 → 用户管理 admin-user-item 是 div
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1000)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-nav .admin-tab')].find((b) => b.textContent.trim() === '用户管理')
    btn?.click()
})
await page.waitForTimeout(800)

const userItems = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#settingsModal .admin-user-item')]
    const first = items[0]

    return {
        itemCount: items.length,
        tagName: first?.tagName,
        isDiv: first?.tagName === 'DIV',
        hasRole: first?.getAttribute('role'),
        tabindex: first?.getAttribute('tabindex'),
    }
})
console.log('2 admin-user-item:', JSON.stringify(userItems))

// 3. profile tab:用户名输入框 + 保存按钮 + 创建/最后登录
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-nav .admin-tab')].find((b) => b.textContent.trim() === '个人资料')
    btn?.click()
})
await page.waitForTimeout(600)

const profile = await page.evaluate(() => {
    return {
        hasNameInput: !!document.querySelector('#set-username-input'),
        nameValue: document.querySelector('#set-username-input')?.value,
        hasSave: [...document.querySelectorAll('#settingsModal .settings-profile-actions button')].some((b) => b.textContent.includes('保存资料')),
        hasCreated: [...document.querySelectorAll('#settingsModal .settings-field')].some((el) => el.textContent.trim() !== '-' && el.textContent.trim() !== ''),
        fieldCount: document.querySelectorAll('#settingsModal .settings-profile-stats-grid .form-group').length,
    }
})
console.log('3 profile:', JSON.stringify(profile))

// 4. 回收站 legacy(#trashModal id 生效)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('回收站'))
    target?.click()
})
await page.waitForTimeout(800)

const trash = await page.evaluate(() => {
    const backdrop = document.querySelector('#trashModal')
    const card = document.querySelector('#trashModal .trash-modal-custom')

    return {
        hasId: !!backdrop,
        cardSize: card ? { w: Math.round(card.getBoundingClientRect().width), h: Math.round(card.getBoundingClientRect().height) } : null,
        hasHead: !!document.querySelector('#trashModal .modal-head'),
    }
})
console.log('4 trash legacy:', JSON.stringify(trash))

await page.keyboard.press('Escape')
await browser.close()
