import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('F:/Code/AI/ChatDB/ChatDBServer/data/user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Users/HimpqNotebook/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

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
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === 'Skill')
    btn?.click()
})
await page.waitForTimeout(900)
await page.evaluate(() => {
    const card = document.querySelector('.settings-skill-card')
    const dots = card?.querySelector('.btn-skill-small[title*="编辑全局"]')
    dots?.click()
})
await page.waitForTimeout(800)

const btnInfo = await page.evaluate(() => {
    const modal = document.querySelector('.g-modal-backdrop')
    if (!modal) return { error: 'no modal found' }
    const buttons = [...modal.querySelectorAll('button')]
    return buttons.map((b) => {
        const cs = window.getComputedStyle(b)
        return {
            text: b.textContent.trim(),
            class: b.className,
            bg: cs.backgroundColor,
            color: cs.color,
            border: cs.borderColor,
        }
    })
})
console.log('Buttons:', JSON.stringify(btnInfo, null, 2))

await browser.close()
