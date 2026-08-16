import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5000'
const usersRaw = fs.readFileSync(path.resolve('..', 'ChatDBServer', 'data', 'user.json'), 'utf-8')
const users = JSON.parse(usersRaw)
const TEST_USER = 'test_user'
const TEST_PWD = users[TEST_USER].password

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(2000)
await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 打开第一个会话
const item = await page.evaluate(() => {
    const el = document.querySelector('.conversation-item')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(item.x, item.y)
await page.waitForTimeout(2500)

// 检查消息渲染:找含 ** 的消息
const render = await page.evaluate(() => {
    const results = []
    const msgs = document.querySelectorAll('.message')
    msgs.forEach((m) => {
        const text = m.textContent || ''
        if (text.includes('**')) {
            const html = m.innerHTML.slice(0, 300)
            const strongCount = m.querySelectorAll('strong').length
            results.push({
                role: m.className,
                hasDoubleStar: true,
                strongCount,
                htmlSnippet: html,
            })
        }
    })

    // 检查 strong 的 computed style
    const strong = document.querySelector('.message strong')
    let strongStyle = null
    if (strong) {
        const cs = getComputedStyle(strong)
        strongStyle = { fontWeight: cs.fontWeight, display: cs.display }
    }

    return { results, strongStyle, totalMsgs: msgs.length }
})
console.log(JSON.stringify(render, null, 2))

await browser.close()
