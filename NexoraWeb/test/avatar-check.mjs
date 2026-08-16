import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))
const TEST_USER = 'test_user'

// 1x1 红色 PNG base64
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 150)))

// 登录
await page.goto('http://127.0.0.1:5000/login', { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', users[TEST_USER].password)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)

// 直接 API 上传头像(验证后端链路)
const uploadResult = await page.evaluate(async (b64) => {
    const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'test_user', avatar_base64: b64 }),
    })
    const data = await res.json()
    return { ok: res.ok, data }
}, RED_PNG)
console.log('upload:', JSON.stringify(uploadResult).slice(0, 200))

// 重新加载 /new,检查 sidebar 头像
await page.goto('http://127.0.0.1:5000/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const avatarState = await page.evaluate(() => {
    const avatar = document.querySelector('#sidebar-avatar')
    const img = avatar ? avatar.querySelector('img') : null

    return {
        hasImageClass: avatar ? avatar.classList.contains('has-image') : null,
        hasImg: !!img,
        imgSrc: img ? img.src.slice(0, 80) : null,
        imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
        text: avatar ? avatar.textContent.trim() : null,
    }
})
console.log('avatar after upload:', JSON.stringify(avatarState))

await browser.close()
