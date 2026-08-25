// debug-skill-tab.mjs — 单独验证 Skill tab 列表 + mode 下拉
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)))

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
await page.waitForTimeout(1500)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.trim() === 'Skill')
    btn?.click()
})
await page.waitForTimeout(2500)

const info = await page.evaluate(async () => {
    const items = document.querySelectorAll('.settings-skill-item').length
    const triggers = document.querySelectorAll('.settings-skill-item-actions .setting-select-trigger').length

    // 直接查 API 看有多少 skill
    const res = await fetch('/api/skills/my')
    const data = await res.json()
    const apiSkills = (data.skills || []).length

    return { items, triggers, apiSkills }
})
console.log('skill tab:', JSON.stringify(info))
await browser.close()