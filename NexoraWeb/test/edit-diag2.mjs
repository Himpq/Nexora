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
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200))
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

const item = await page.evaluate(() => {
    const el = document.querySelector('.conversation-item')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(item.x, item.y)
await page.waitForTimeout(2500)

// 滚动 + 点击编辑按钮(用 DOM 直接触发,排除坐标问题)
const result = await page.evaluate(() => {
    const userMsgs = document.querySelectorAll('.message.user')
    const last = userMsgs[userMsgs.length - 1]
    const btn = last?.querySelector('.msg-actions .btn-action')

    if (!btn) return { noBtn: true }

    const beforeTitle = btn.title
    btn.click()
    // 等待 Vue 响应
    return new Promise((resolve) => {
        setTimeout(() => {
            const editor = document.querySelector('.message.user .user-prompt-inline-editor')
            const btnAfter = document.querySelector('.message.user .msg-actions .btn-action')

            resolve({
                beforeTitle,
                afterTitle: btnAfter ? btnAfter.title : null,
                editorExists: !!editor,
                editingClass: last.className,
            })
        }, 300)
    })
})
console.log('result:', JSON.stringify(result))

await browser.close()
