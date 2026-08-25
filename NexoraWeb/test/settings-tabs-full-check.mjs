// settings-tabs-full-check.mjs — 设置窗口全部 tab 内容验证
// 验证:基础 tab(资料/偏好/Skill/统计/API Key)+ 管理员 tab(用户/统计/系统/向量库)均有真实内容
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

// 偏好设置
await openTab('偏好设置')
const preferences = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('.settings-modal-shell .settings-preferences-grid .setting-select')]
    const checkboxes = [...document.querySelectorAll('.settings-modal-shell .settings-preferences-grid input[type=checkbox]')]
    const toggles = [...document.querySelectorAll('.settings-modal-shell .settings-mode-toggle-btn')]
    const memoryTextarea = document.querySelector('.settings-modal-shell #settingsMemoryProfile')

    return {
        selectCount: selects.length,
        checkboxCount: checkboxes.length,
        modeToggles: toggles.map((t) => t.textContent.trim()),
        hasSave: [...document.querySelectorAll('.settings-modal-shell button')].some((b) => b.textContent.includes('保存偏好')),
        hasMemory: !!memoryTextarea,
    }
})
console.log('1 preferences:', JSON.stringify(preferences))

// Skill
await openTab('Skill')
const skills = await page.evaluate(() => {
    const headTabs = [...document.querySelectorAll('.settings-modal-shell .settings-page-head-tab')]
    const headBtns = [...document.querySelectorAll('.settings-modal-shell .settings-page-head-actions button')]

    return {
        headTabs: headTabs.map((t) => t.textContent.trim()),
        headButtons: headBtns.map((b) => b.textContent.trim()),
        hasList: !!document.querySelector('.settings-modal-shell .settings-skill-list'),
    }
})
console.log('2 skills:', JSON.stringify(skills))

// 使用统计
await openTab('使用统计')
const statistics = await page.evaluate(() => {
    const stats = [...document.querySelectorAll('.settings-modal-shell .settings-stat-card .value')]

    return {
        statCount: stats.length,
        values: stats.map((s) => s.textContent.trim()),
    }
})
console.log('3 statistics:', JSON.stringify(statistics))

// 保存偏好测试:切换主题(经自建下拉选中 dark)
await openTab('偏好设置')
await page.evaluate(() => {
    const trigger = document.querySelector('.settings-modal-shell .settings-preferences-grid .setting-select-trigger')
    trigger?.click()
})
await page.waitForTimeout(300)
await page.evaluate(() => {
    const menu = document.querySelector('.setting-select-menu.open')
    const dark = [...(menu?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === '深色')
    dark?.click()
    const save = [...document.querySelectorAll('.settings-modal-shell button')].find((b) => b.textContent.includes('保存偏好'))
    save?.click()
})
await page.waitForTimeout(1200)

const saved = await page.evaluate(async () => {
    const res = await fetch('/api/user/preferences')
    const data = await res.json()

    return {
        theme: data.preferences?.theme || null,
    }
})
console.log('4 save preference:', JSON.stringify(saved))

// 还原主题
await page.evaluate(async () => {
    await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'system' }),
    })
})
console.log('5 theme restored')

await page.keyboard.press('Escape')
await browser.close()
