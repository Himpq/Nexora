// debug-auth-modal.mjs — 调试认证生成弹窗
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)))

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
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '认证管理')
    btn?.click()
})
await page.waitForTimeout(800)

// 点击生成
const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-management-toolbar button')].find((b) => b.textContent.includes('生成'))
    if (!btn) return { clicked: false }
    btn.click()
    return { clicked: true, label: btn.textContent.trim() }
})
console.log('clicked:', JSON.stringify(clicked))
await page.waitForTimeout(800)

const dump = await page.evaluate(() => {
    const backdrops = [...document.querySelectorAll('.g-modal-backdrop')]
    return backdrops.map((el, i) => ({
        i,
        text: (el.textContent || '').slice(0, 60),
        hasCreateName: !!el.querySelector('#adminAuthCreateName'),
        hasExpireBtns: el.querySelectorAll('.settings-mode-toggle-btn').length,
        buttons: [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 5),
    }))
})
console.log('backdrops:', JSON.stringify(dump, null, 1))

await browser.close()