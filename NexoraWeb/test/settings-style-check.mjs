// settings-style-check.mjs — 新设置 UI 视觉与溢出回归
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
await page.waitForTimeout(1200)

// 1. 个人资料页视觉
const profile = await page.evaluate(() => {
    const navActive = document.querySelector('.settings-nav-item.active')
    const navActiveStyle = navActive ? getComputedStyle(navActive) : null
    const card = document.querySelector('.setting-card')
    const cardStyle = card ? getComputedStyle(card) : null
    const row = document.querySelector('.setting-row')
    const rowStyle = row ? getComputedStyle(row) : null
    const avatar = document.querySelector('.settings-avatar')
    const avatarStyle = avatar ? getComputedStyle(avatar) : null

    return {
        navActiveBg: navActiveStyle?.backgroundColor,
        navActiveColor: navActiveStyle?.color,
        cardRadius: cardStyle?.borderRadius,
        cardBorder: cardStyle?.borderColor,
        rowJustify: rowStyle?.justifyContent,
        rowMinHeight: rowStyle?.minHeight,
        avatarBg: avatarStyle?.backgroundImage.slice(0, 50),
        avatarCover: avatarStyle?.backgroundSize,
    }
})
console.log('1 profile styles:', JSON.stringify(profile, null, 1))

// 2. 用户管理面板(旧框架类已由新 css 接管)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.includes('用户管理'))
    btn?.click()
})
await page.waitForTimeout(1200)

const usersPanel = await page.evaluate(() => {
    const toolbar = document.querySelector('.settings-management-toolbar')
    const list = document.querySelector('.settings-management-list')
    const detail = document.querySelector('.settings-management-detail')
    const item = document.querySelector('.admin-user-item')
    const itemStyle = item ? getComputedStyle(item) : null
    const avatar = document.querySelector('.admin-user-avatar')
    const avatarImg = avatar?.querySelector('img')
    const avatarStyle = avatar ? getComputedStyle(avatar) : null
    const imgStyle = avatarImg ? getComputedStyle(avatarImg) : null

    // 溢出检查
    let overflow = 'none'
    if (item) {
        if (item.scrollWidth > item.clientWidth + 1) overflow = 'item-h'
        if (item.scrollHeight > item.clientHeight + 1) overflow = 'item-v'
    }
    if (avatar) {
        const rect = avatar.getBoundingClientRect()
        if (imgStyle && (parseFloat(imgStyle.width) > rect.width + 1 || parseFloat(imgStyle.height) > rect.height + 1)) {
            overflow = 'avatar-img'
        }
    }

    return {
        toolbar: !!toolbar,
        list: !!list,
        detail: !!detail,
        listRadius: list ? getComputedStyle(list).borderRadius : null,
        listBorder: list ? getComputedStyle(list).borderColor : null,
        itemBg: itemStyle?.backgroundColor,
        itemBorder: itemStyle?.borderBottomColor,
        avatarSize: avatar ? `${Math.round(avatar.getBoundingClientRect().width)}x${Math.round(avatar.getBoundingClientRect().height)}` : 'none',
        avatarRadius: avatarStyle?.borderRadius,
        avatarOverflow: avatarStyle?.overflow,
        imgFit: imgStyle?.objectFit,
        imgSize: imgStyle ? `${imgStyle.width}x${imgStyle.height}` : 'no-img',
        overflow,
    }
})
console.log('2 users panel:', JSON.stringify(usersPanel, null, 1))

// 3. 截图存档(用户可打开查看)
await page.screenshot({ path: 'test/_shot-settings-users.png' })
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.includes('个人资料'))
    btn?.click()
})
await page.waitForTimeout(600)
await page.screenshot({ path: 'test/_shot-settings-profile.png' })

await browser.close()
console.log('\ndone')