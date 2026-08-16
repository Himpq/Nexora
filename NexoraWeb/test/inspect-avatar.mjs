// inspect-avatar.mjs — 检查页面所有头像尺寸
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 150)))

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

// 侧边栏头像
const sidebar = await page.evaluate(() => {
    const img = document.querySelector('#sidebar-avatar img, .avatar-circle img')
    const circle = document.querySelector('#sidebar-avatar, .avatar-circle')

    if (!img) return { found: false }

    const r = img.getBoundingClientRect()
    const cr = circle ? circle.getBoundingClientRect() : null

    return {
        found: true,
        img: { w: Math.round(r.width), h: Math.round(r.height) },
        circle: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
        cls: img.className,
        parentCls: circle?.className || null,
    }
})
console.log('1 sidebar avatar:', JSON.stringify(sidebar))

// 设置窗口头像
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1000)

const settingsAvatar = await page.evaluate(() => {
    const img = document.querySelector('#settingsAvatarImg')
    const panel = document.querySelector('.settings-avatar-panel')

    if (!img) return { found: false }

    const r = img.getBoundingClientRect()
    const pr = panel ? panel.getBoundingClientRect() : null

    return {
        found: true,
        img: { w: Math.round(r.width), h: Math.round(r.height) },
        panel: pr ? { w: Math.round(pr.width), h: Math.round(pr.height) } : null,
        cls: img.className,
        computedW: img ? getComputedStyle(img).width : null,
        computedH: img ? getComputedStyle(img).height : null,
    }
})
console.log('2 settings avatar:', JSON.stringify(settingsAvatar))

await browser.close()
