// debug-tabs2.mjs — 诊断邮件/Skill/统计 tab 渲染
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
page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 300))
})

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

async function dump(tab) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, tab)
    await page.waitForTimeout(1500)

    const info = await page.evaluate(() => {
        const body = document.querySelector('.settings-page-body')

        return {
            childCount: body ? body.children.length : 0,
            html: body ? body.innerHTML.slice(0, 300) : 'NO BODY',
            triggers: document.querySelectorAll('.setting-select-trigger').length,
        }
    })
    console.log(`[${tab}]`, JSON.stringify(info))
}

await dump('邮箱管理')
await dump('Skill')
await dump('使用统计')
await dump('模型管理')
await browser.close()