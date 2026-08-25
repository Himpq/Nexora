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

const item = await page.evaluate(() => {
    const el = document.querySelector('.conversation-item')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.click(item.x, item.y)
await page.waitForTimeout(2500)

// 诊断:最后一条 user 消息的按钮
const diag = await page.evaluate(() => {
    const userMsgs = document.querySelectorAll('.message.user')
    const last = userMsgs[userMsgs.length - 1]

    if (!last) return { noUserMsg: true }

    const actions = Array.from(last.querySelectorAll('.msg-actions .btn-action')).map((b) => b.title)

    return {
        lastUserIndex: last.getAttribute('data-index'),
        actions,
        html: last.innerHTML.slice(0, 300),
    }
})
console.log('diag:', JSON.stringify(diag, null, 2))

// 滚动到最后一条 user 消息,再点编辑按钮
const btnInfo = await page.evaluate(() => {
    const userMsgs = document.querySelectorAll('.message.user')
    const last = userMsgs[userMsgs.length - 1]

    if (!last) return null

    last.scrollIntoView({ block: 'center' })

    const btn = last.querySelector('.msg-actions .btn-action')
    if (!btn) return null

    const r = btn.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: btn.title }
})
console.log('first btn:', JSON.stringify(btnInfo))

if (btnInfo) {
    await page.mouse.click(btnInfo.x, btnInfo.y)
    await page.waitForTimeout(500)

    const afterClick = await page.evaluate(() => {
        const editor = document.querySelector('.message.user .user-prompt-inline-editor')

        return {
            editorExists: !!editor,
            editorValue: editor ? editor.value.slice(0, 50) : null,
            hint: document.querySelector('.user-prompt-inline-hint')?.textContent,
        }
    })
    console.log('after click:', JSON.stringify(afterClick))

    // Enter 保存(值不变则无提交;测试只验证编辑态)
    await page.keyboard.press('Escape')
}

await browser.close()
