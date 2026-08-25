// workspaces-check.mjs — Workspaces 项目视图回归测试
// 验证:sidebar Workspaces → 列表 → 新建 → 详情(统计/活动) → 删除 → 返回
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

// 1. 打开 Workspaces(sidebar #workspacesBtn)
await page.evaluate(() => {
    document.querySelector('#workspacesBtn')?.click()
})
await page.waitForTimeout(1200)

const view = await page.evaluate(() => {
    const section = document.querySelector('.workspace-projects-view')

    return {
        visible: !!section,
        title: section?.querySelector('h1')?.textContent || null,
        hasSearch: !!section?.querySelector('.workspace-projects-search input'),
        hasCreate: !!section?.querySelector('.workspace-projects-create'),
        tabs: section ? [...section.querySelectorAll('.workspace-projects-tab')].map((t) => t.textContent) : [],
        empty: section?.querySelector('.workspace-projects-empty')?.textContent || null,
    }
})
console.log('1 view:', JSON.stringify(view))

// 2. 新建 Workspace
await page.evaluate(() => {
    document.querySelector('.workspace-projects-create')?.click()
})
await page.waitForTimeout(600)

const promptShown = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('新建 Workspace'))

    return !!modal
})
console.log('2 create prompt:', promptShown)

await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('新建 Workspace'))
    const input = backdrop?.querySelector('input')
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('创建'))

    if (input) {
        input.value = '回归测试工作区'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    confirm?.click()
})
await page.waitForTimeout(1200)

const afterCreate = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.workspace-projects-item')]

    return {
        itemCount: items.length,
        firstTitle: items[0]?.querySelector('.workspace-projects-name span:last-child')?.textContent || null,
        hasDate: !!items[0]?.querySelector('.workspace-projects-date'),
    }
})
console.log('3 after create:', JSON.stringify(afterCreate))

// 3. 打开详情
await page.evaluate(() => {
    document.querySelector('.workspace-projects-item')?.click()
})
await page.waitForTimeout(1000)

const detail = await page.evaluate(() => {
    const stats = [...document.querySelectorAll('.workspace-projects-stat-num')].map((el) => el.textContent)
    const activity = document.querySelector('.workspace-projects-activity-item .workspace-projects-activity-title')?.textContent || null

    return {
        hasDetail: !!document.querySelector('.workspace-projects-stats'),
        stats,
        hasActivity: !!document.querySelector('.workspace-projects-activity'),
        activityFirst: activity,
        hasDelete: !!document.querySelector('.workspace-projects-actions .workspace-projects-create'),
        hasBack: !!document.querySelector('.workspace-projects-detail-head .workspace-projects-back'),
    }
})
console.log('4 detail:', JSON.stringify(detail))

// 4. 删除工作区
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-projects-actions .workspace-projects-create')].find((b) => b.textContent.includes('删除'))
    btn?.click()
})
await page.waitForTimeout(600)

const confirmShown = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('删除 Workspace'))

    return !!modal && !!modal.querySelector('.g-btn-danger')
})
console.log('5 delete confirm:', confirmShown)

await page.evaluate(() => {
    document.querySelector('.g-btn-danger')?.click()
})
await page.waitForTimeout(1200)

const afterDelete = await page.evaluate(() => {
    return {
        backToList: !!document.querySelector('.workspace-projects-table'),
        itemCount: document.querySelectorAll('.workspace-projects-item').length,
    }
})
console.log('6 after delete:', JSON.stringify(afterDelete))

// 5. 返回聊天
await page.evaluate(() => {
    document.querySelector('.workspace-projects-head-left .workspace-projects-back')?.click()
})
await page.waitForTimeout(500)

const backToChat = await page.evaluate(() => {
    return {
        workspacesGone: !document.querySelector('.workspace-projects-view'),
        chatVisible: !!document.querySelector('.messages-area') || !!document.querySelector('.welcome-screen'),
    }
})
console.log('7 back to chat:', JSON.stringify(backToChat))

await browser.close()
