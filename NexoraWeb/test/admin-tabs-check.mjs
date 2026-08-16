// admin-tabs-check.mjs — 管理员设置 tab 回归测试
// 验证:头像不再无穷大(32px) + 用户管理/统计/系统设置/向量库 tab 真实内容
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

// 1. 侧边栏头像尺寸(应为 32×32,不再 256)
const sidebarAvatar = await page.evaluate(() => {
    const el = document.querySelector('#sidebar-avatar')
    const r = el.getBoundingClientRect()

    return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        hasImage: el.classList.contains('has-image'),
        bgImage: getComputedStyle(el).backgroundImage.slice(0, 60),
        bgSize: getComputedStyle(el).backgroundSize,
    }
})
console.log('1 sidebar avatar:', JSON.stringify(sidebarAvatar))

// 2. 打开设置 → 用户管理 tab
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1000)

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(800)
}

await openTab('用户管理')
const usersTab = await page.evaluate(() => {
    const items = document.querySelectorAll('.settings-modal-shell .admin-user-item')

    return {
        userCount: items.length,
        firstName: items[0]?.querySelector('.admin-user-name')?.textContent || null,
        hasDetail: !!document.querySelector('.settings-modal-shell .admin-user-detail .admin-user-detail-content, .settings-modal-shell .admin-user-detail .admin-user-detail-empty'),
        hasAddBtn: [...document.querySelectorAll('.settings-modal-shell .settings-management-toolbar button')].some((b) => b.textContent.includes('添加新用户')),
    }
})
console.log('2 users tab:', JSON.stringify(usersTab))

await openTab('统计信息')
const statsTab = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-modal-shell .stat-card')]
    const trendChart = document.querySelector('.settings-modal-shell .admin-token-trend-chart canvas')
    const userQuery = document.querySelector('.settings-modal-shell .admin-user-token-query')

    return {
        cardCount: cards.length,
        labels: cards.map((c) => c.querySelector('.label')?.textContent),
        hasTrendChart: !!trendChart,
        hasUserQuery: !!userQuery,
    }
})
console.log('3 stats tab:', JSON.stringify(statsTab))

await openTab('系统设置')
const systemTab = await page.evaluate(() => {
    const modules = document.querySelectorAll('.settings-modal-shell .admin-system-module-item')
    const sections = document.querySelectorAll('.settings-modal-shell .admin-system-section-head')

    return {
        moduleCount: modules.length,
        moduleNames: [...modules].map((m) => m.querySelector('.admin-user-name')?.textContent),
        hasSave: [...document.querySelectorAll('.settings-modal-shell .admin-system-section-actions button')].some((b) => b.textContent.includes('保存')),
        hasHealth: [...document.querySelectorAll('.settings-modal-shell .admin-system-section-health')].length > 0,
        baseUrl: document.querySelector('#sysPublicBaseUrl')?.value ?? null,
        activeSection: document.querySelector('.settings-modal-shell .admin-system-section-head h4')?.textContent,
    }
})
console.log('4 system tab:', JSON.stringify(systemTab))

await openTab('向量库')
const chromaTab = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-modal-shell .stat-card')]
    const table = document.querySelector('.settings-modal-shell .admin-table')

    return {
        cardCount: cards.length,
        hasSearch: !!document.querySelector('.settings-modal-shell .admin-search-bar input'),
        hasTable: !!table,
        tableHeaders: table ? [...table.querySelectorAll('th')].map((t) => t.textContent) : [],
    }
})
console.log('5 chroma tab:', JSON.stringify(chromaTab))

await page.keyboard.press('Escape')
await browser.close()
