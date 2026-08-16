// debug-modal-dump.mjs — dump add-model modal DOM to find real structure
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
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
await page.waitForTimeout(1000)

await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '模型管理')
    btn?.click()
})
await page.waitForTimeout(800)

await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-management-toolbar button')].find((b) => b.textContent.includes('添加模型'))
    btn?.click()
})
await page.waitForTimeout(800)

const dump = await page.evaluate(() => {
    const backdrops = [...document.querySelectorAll('.g-modal-backdrop, .modal-backdrop')]
    return backdrops.map((el, i) => ({
        index: i,
        cls: el.className,
        id: el.id,
        text: (el.textContent || '').slice(0, 200),
        inputs: [...el.querySelectorAll('input, select')].map((n) => ({ tag: n.tagName, id: n.id, cls: n.className, type: n.type || n.tagName })),
    }))
})
console.log(JSON.stringify(dump, null, 1))

await browser.close()
