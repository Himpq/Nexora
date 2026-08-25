// settings-v2-check.mjs — 本轮重做特性聚焦验证
// quota-meter、认证权限/scope、Skill 市场网格、偏好记忆、统计 ECharts 实例
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
await page.waitForTimeout(1200)

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(1000)
}

// 1. 统计信息:ECharts 画布存在
await openTab('统计信息')
const charts = await page.evaluate(() => {
    const canvases = document.querySelectorAll('.settings-modal-shell .admin-token-trend-chart canvas')
    const trendTop = document.querySelectorAll('.settings-modal-shell .trend-top-chip').length

    return { canvasCount: canvases.length, trendChips: trendTop }
})
console.log('1 stats charts:', JSON.stringify(charts))

// 2. 模型管理:quota meter
await openTab('模型管理')
const quota = await page.evaluate(() => {
    const meters = document.querySelectorAll('.settings-modal-shell .quota-meter-shell').length
    const unitSelect = document.querySelector('.settings-modal-shell .model-admin-toolbar-unit .setting-select-trigger')
    const rows = document.querySelectorAll('.settings-modal-shell .admin-model-row').length
    const firstCtx = document.querySelector('.settings-modal-shell .admin-model-ctx')?.textContent || ''

    return { meters, unitSelect: !!unitSelect, rows, firstCtx }
})
console.log('2 models quota:', JSON.stringify(quota))

// 3. 认证管理:权限/scope/剩余时长
await openTab('认证管理')
const authDetail = await page.evaluate(() => {
    const first = document.querySelector('.settings-modal-shell .papi-key-list-item')

    if (!first) return { hasKey: false }

    first.click()

    return { hasKey: true }
})
await page.waitForTimeout(500)
const authFields = await page.evaluate(() => {
    const perms = [...document.querySelectorAll('.settings-modal-shell .papi-permission-toggle-row input[type=checkbox]')].length
    const segments = [...document.querySelectorAll('.settings-modal-shell .papi-segment-button')].map((b) => b.textContent.trim())
    const hasRemaining = [...document.querySelectorAll('.settings-modal-shell .admin-user-detail-grid .admin-info-text')].some((el) => el.textContent.includes('永久') || el.textContent.includes('天') || el.textContent.includes('分钟') || el.textContent.includes('已过期'))

    return { permissionCheckboxes: perms, segments, hasRemaining }
})
console.log('3 auth detail:', JSON.stringify({ ...authDetail, ...authFields }))

// 4. Skill 市场网格
await openTab('Skill')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-subtab')].find((b) => b.textContent.includes('Skill 市场'))
    btn?.click()
})
await page.waitForTimeout(1000)
const market = await page.evaluate(() => {
    const list = document.querySelector('.settings-modal-shell .skill-market-list')
    const cols = list ? getComputedStyle(list).gridTemplateColumns : ''
    const cards = document.querySelectorAll('.settings-modal-shell .skill-market-card').length

    return { cards, multiCol: cols.split(' ').length >= 2, cols: cols.slice(0, 40) }
})
console.log('4 skill market:', JSON.stringify(market))

// 5. 偏好设置:记忆 textarea 已加载
await openTab('偏好设置')
const prefs = await page.evaluate(() => {
    const memory = document.querySelector('.settings-modal-shell #settingsMemoryProfile')
    const selectTriggers = document.querySelectorAll('.settings-modal-shell .setting-select-trigger').length

    return {
        memoryLoaded: memory ? memory.value.length > 0 : false,
        memoryValue: memory ? memory.value.slice(0, 30) : '',
        selectTriggers,
    }
})
console.log('5 preferences:', JSON.stringify(prefs))

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')