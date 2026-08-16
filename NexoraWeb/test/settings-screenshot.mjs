// settings-screenshot.mjs — 打开新设置面板截图 + 结构检查
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

await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1200)

const info = await page.evaluate(() => {
    const modal = document.querySelector('.g-modal.settings-modal')
    const shell = document.querySelector('.settings-modal-shell')
    const nav = document.querySelector('.settings-nav')
    const navItems = document.querySelectorAll('.settings-nav-item')
    const groups = [...document.querySelectorAll('.settings-nav-group-label')].map((el) => el.textContent)
    const pageHead = document.querySelector('.settings-page-head h2')?.textContent
    const avatar = document.querySelector('.settings-avatar')
    const avatarStyle = avatar ? getComputedStyle(avatar) : null

    return {
        modalExists: !!modal,
        modalWidth: modal ? Math.round(modal.getBoundingClientRect().width) : 0,
        modalHeight: modal ? Math.round(modal.getBoundingClientRect().height) : 0,
        shell: !!shell,
        navWidth: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
        navItems: navItems.length,
        groups,
        pageHead,
        avatarSize: avatar ? `${Math.round(avatar.getBoundingClientRect().width)}x${Math.round(avatar.getBoundingClientRect().height)}` : 'none',
        avatarRadius: avatarStyle?.borderRadius,
        legacyBackdrop: !!document.querySelector('#settingsModal.modal-backdrop'),
    }
})
console.log('settings info:', JSON.stringify(info, null, 1))

// 截图:个人资料页
await page.screenshot({ path: 'test/_shot-settings-profile.png' })

// 切到管理组-用户管理(管理员账号? test_user 可能非管理员 → 无管理组)
if (info.groups.includes('管理')) {
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.includes('用户管理'))
        btn?.click()
    })
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'test/_shot-settings-users.png' })
}

await browser.close()
console.log('\ndone')