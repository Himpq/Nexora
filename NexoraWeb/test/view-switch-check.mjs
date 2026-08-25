// view-switch-check.mjs — Files/Workspaces 视图切换回归测试
// 验证:打开 Files → header 返回按钮切回聊天;打开 Workspaces → 返回切回;侧边栏按钮互斥切换
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

// 1. 打开 Files
await page.evaluate(() => document.querySelector('#fileCenterBtn')?.click())
await page.waitForTimeout(1000)

const filesOpen = await page.evaluate(() => {
    const header = document.querySelector('.chat-header')

    return {
        fileCenterVisible: !!document.querySelector('.file-center-view'),
        headerTitle: document.querySelector('#conversationTitle')?.textContent?.trim(),
        hasBackBtn: !!header?.querySelector('.header-left .btn-icon'),
        hasModelSelect: !!header?.querySelector('.header-left #modelSelectContainer, .header-left .custom-select-container'),
        hasSidebarToggle: !!header?.querySelector('.header-left #toggleSidebar'),
    }
})
console.log('1 files open:', JSON.stringify(filesOpen))

// 2. header 返回按钮 → 回聊天
await page.evaluate(() => {
    document.querySelector('.chat-header .header-left .btn-icon')?.click()
})
await page.waitForTimeout(800)

const backToChat1 = await page.evaluate(() => {
    return {
        fileCenterGone: !document.querySelector('.file-center-view'),
        chatVisible: !!document.querySelector('.messages-area, .welcome-screen'),
        headerTitle: document.querySelector('#conversationTitle')?.textContent?.trim(),
        hasModelSelect: !!document.querySelector('.header-left .custom-select-container'),
    }
})
console.log('2 back to chat:', JSON.stringify(backToChat1))

// 3. 打开 Workspaces
await page.evaluate(() => document.querySelector('#workspacesBtn')?.click())
await page.waitForTimeout(1000)

const workspacesOpen = await page.evaluate(() => {
    return {
        workspacesVisible: !!document.querySelector('.workspace-projects-view'),
        headerTitle: document.querySelector('#conversationTitle')?.textContent?.trim(),
        hasBackBtn: !!document.querySelector('.chat-header .header-left .btn-icon'),
    }
})
console.log('3 workspaces open:', JSON.stringify(workspacesOpen))

// 4. header 返回 → 回聊天
await page.evaluate(() => {
    document.querySelector('.chat-header .header-left .btn-icon')?.click()
})
await page.waitForTimeout(800)

const backToChat2 = await page.evaluate(() => {
    return {
        workspacesGone: !document.querySelector('.workspace-projects-view'),
        chatVisible: !!document.querySelector('.messages-area, .welcome-screen'),
    }
})
console.log('4 back from workspaces:', JSON.stringify(backToChat2))

// 5. Files ↔ Workspaces 互斥(打开 Files 后点 Workspaces 应切换)
await page.evaluate(() => document.querySelector('#fileCenterBtn')?.click())
await page.waitForTimeout(800)
await page.evaluate(() => document.querySelector('#workspacesBtn')?.click())
await page.waitForTimeout(800)

const exclusive = await page.evaluate(() => {
    return {
        workspacesVisible: !!document.querySelector('.workspace-projects-view'),
        fileCenterGone: !document.querySelector('.file-center-view'),
    }
})
console.log('5 exclusive switch:', JSON.stringify(exclusive))

// 清理:返回聊天
await page.evaluate(() => {
    document.querySelector('.chat-header .header-left .btn-icon')?.click()
})
await page.waitForTimeout(500)

await browser.close()
