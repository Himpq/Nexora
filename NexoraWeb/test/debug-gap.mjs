// debug-gap.mjs — 诊断 gap-fix 失败原因
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

const base = await page.evaluate(() => ({
    modal: !!document.querySelector('.g-modal.settings-modal'),
    navItems: document.querySelectorAll('.settings-nav-item').length,
    bodyText: document.querySelector('.settings-page-body')?.textContent?.slice(0, 80),
}))

await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.trim() === '我的 API Key')
    btn?.click()
})
await page.waitForTimeout(2000)

const keysTab = await page.evaluate(async () => {
    const listItems = document.querySelectorAll('.papi-key-list-item').length
    const detailEmpty = document.querySelector('.admin-user-detail-empty')?.textContent || ''
    // 直接看 API
    let apiCount = -1
    try {
        const res = await fetch('/api/user/papi-keys')
        const data = await res.json()
        apiCount = (data.keys || []).length
    } catch (e) {
        apiCount = String(e)
    }

    return { listItems, detailEmpty, apiCount, permGrids: document.querySelectorAll('.settings-toggle-grid').length }
})

console.log('base:', JSON.stringify(base))
console.log('keysTab:', JSON.stringify(keysTab))
await browser.close()