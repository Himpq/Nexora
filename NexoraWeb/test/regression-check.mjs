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

// 打开"测试会话"(有用户消息;空会话无编辑按钮)
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 3, null, { timeout: 8000 }).catch(() => {})
await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.textContent.includes('测试会话')) || items.find((el) => !el.textContent.includes('新对话'))

    if (!target) return

    target.click()
})
await page.waitForTimeout(2500)

// 1. 内联编辑:DOM 点击最后一条用户消息的编辑按钮
// (编辑按钮仅存在于最后一条用户消息;坐标点击在视口外会假阴性,统一用 DOM click)
await page.waitForFunction(() => {
    const userMsgs = document.querySelectorAll('.message.user')
    return userMsgs.length > 0
}, null, { timeout: 8000 }).catch(() => {})

const editBtnFound = await page.evaluate(() => {
    const userMsgs = document.querySelectorAll('.message.user')
    const last = userMsgs[userMsgs.length - 1]
    const btn = last?.querySelector('.msg-actions .btn-action')

    if (!btn) return false

    btn.click()

    return true
})

if (editBtnFound) {
    await page.waitForTimeout(500)

    const editing = await page.evaluate(() => {
        const editor = document.querySelector('.message.user .user-prompt-inline-editor')

        return {
            editorExists: !!editor,
            hint: document.querySelector('.message.user .user-prompt-inline-hint')?.textContent,
        }
    })
    console.log('1 inline edit:', JSON.stringify(editing))

    // Esc 取消
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const afterEsc = await page.evaluate(() => !document.querySelector('.message.user .user-prompt-inline-editor'))
    console.log('   esc cancel:', afterEsc)
}

// 2. 设置 → admin tab → AdminPanel 结构
// (用户菜单第一项是"模型榜单",必须点击含"设置"文本的项)
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(600)
await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.settings-nav-item')).find((b) => b.textContent.trim() === '用户管理')
    if (btn) btn.click()
})
await page.waitForTimeout(400)

const adminPanel = await page.evaluate(() => ({
    toolbar: !!document.querySelector('.settings-management-toolbar'),
    layout: !!document.querySelector('.settings-management-layout'),
    list: !!document.querySelector('.settings-management-list'),
    detail: !!document.querySelector('.settings-management-detail'),
    activeTab: document.querySelector('.settings-nav-item.active')?.textContent.trim(),
}))
console.log('2 admin panel:', JSON.stringify(adminPanel))

// 3. avatar 无回归(改用原版 background-image 方式:has-image 类 + 背景图)
const avatar = await page.evaluate(() => {
    const el = document.querySelector('#sidebar-avatar')
    const style = el ? getComputedStyle(el) : null

    return {
        hasImage: el?.classList.contains('has-image') || false,
        bgImage: style?.backgroundImage.slice(0, 60) || '',
        size: el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null,
    }
})
console.log('3 avatar:', JSON.stringify(avatar))

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')

