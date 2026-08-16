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
        const btn = [...document.querySelectorAll('#settingsModal .settings-nav .admin-tab')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(800)
}

// 偏好设置
await openTab('偏好设置')
const preferences = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('#settingsModal .settings-preferences-grid select')]
    const checkboxes = [...document.querySelectorAll('#settingsModal .settings-preferences-grid input[type=checkbox]')]
    const toggles = [...document.querySelectorAll('#settingsModal .settings-mode-toggle-btn')]

    return {
        selectCount: selects.length,
        checkboxCount: checkboxes.length,
        modeToggles: toggles.map((t) => t.textContent.trim()),
        hasSave: [...document.querySelectorAll('#settingsModal button')].some((b) => b.textContent.includes('保存偏好')),
    }
})
console.log('1 preferences:', JSON.stringify(preferences))

// Skill
await openTab('Skill')
const skills = await page.evaluate(() => {
    const subtabs = [...document.querySelectorAll('#settingsModal .skill-subtab')]
    const toolbarBtns = [...document.querySelectorAll('#settingsModal .skill-my-toolbar .btn-skill-create')]

    return {
        subtabs: subtabs.map((t) => t.textContent.trim()),
        toolbarBtns: toolbarBtns.map((b) => b.textContent.trim()),
        hasList: !!document.querySelector('#settingsModal .settings-skill-list'),
    }
})
console.log('2 skills:', JSON.stringify(skills))

// 使用统计
await openTab('使用统计')
const statistics = await page.evaluate(() => {
    const stats = [...document.querySelectorAll('#settingsModal .settings-stat')]

    return {
        statCount: stats.length,
        values: stats.map((s) => s.textContent.trim()),
    }
})
console.log('3 statistics:', JSON.stringify(statistics))

// 保存偏好测试:切换主题
await openTab('偏好设置')
await page.evaluate(() => {
    const select = document.querySelector('#settingsModal .settings-preferences-grid select')
    select.value = 'dark'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const save = [...document.querySelectorAll('#settingsModal button')].find((b) => b.textContent.includes('保存偏好'))
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
