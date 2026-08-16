// admin-tabs-all-check.mjs — 全部 14 个设置 tab 内容验证
// 验证:5 基础 + 9 管理员 tab 全部有真实内容,无"功能将在后续版本接入"占位
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

const tabs = ['个人资料', '偏好设置', 'Skill', '使用统计', '我的 API Key', '系统设置', '用户管理', '邮箱管理', '模型管理', '生图 API', '地图 API', '认证管理', '统计信息', '向量库']

const results = []

for (const tab of tabs) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('#settingsModal .settings-nav .admin-tab')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, tab)
    await page.waitForTimeout(700)

    const info = await page.evaluate(() => {
        const content = document.querySelector('#settingsModal .settings-content')
        const text = content ? content.textContent.replace(/\s+/g, ' ').trim() : ''
        const hasPlaceholder = text.includes('功能将在后续版本接入')
        const hasItems = !!content?.querySelector('.admin-user-item, .stat-card, .admin-system-card, .settings-skill-list, .settings-preferences-grid, .admin-model-row, .admin-chroma-collection, .admin-mail-permissions, .papi-key-list-item')
        const itemCount = content?.querySelectorAll('.admin-user-item, .stat-card, .admin-system-card, .admin-model-row, .admin-chroma-collection, .papi-key-list-item').length || 0

        return {
            hasPlaceholder,
            hasItems,
            itemCount,
            preview: text.slice(0, 80),
        }
    })

    results.push({ tab, ...info })
}

console.log(JSON.stringify(results, null, 1))

await page.keyboard.press('Escape')
await browser.close()
