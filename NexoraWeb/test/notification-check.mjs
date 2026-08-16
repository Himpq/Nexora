// notification-check.mjs — 通知面板回归测试
// 验证:铃铛徽标 → 打开面板 → 列表渲染(级别图标/未读) → 标记已读 → 删除 → 公告弹窗(管理员)
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

// 1. 打开通知面板(铃铛)
await page.evaluate(() => {
    document.querySelector('#toggleNotificationPanel')?.click()
})
await page.waitForTimeout(1000)

const panel = await page.evaluate(() => {
    const popover = document.querySelector('.chat-notification-popover')
    const items = [...document.querySelectorAll('.chat-notification-item')].map((el) => ({
        title: el.querySelector('.chat-notification-item-title')?.textContent,
        isRead: el.classList.contains('is-read'),
        hasReadBtn: !!el.querySelector('.chat-notification-read'),
        hasRemoveBtn: !!el.querySelector('.chat-notification-remove'),
        iconClass: el.querySelector('.chat-notification-icon i')?.getAttribute('class') || '',
    }))

    return {
        open: !!popover && popover.classList.contains('open'),
        subtitle: popover?.querySelector('.chat-notification-subtitle')?.textContent || null,
        itemCount: items.length,
        items: items.slice(0, 3),
        hasAddBtn: !!popover?.querySelector('.chat-notification-add'),
    }
})
console.log('1 panel open:', JSON.stringify(panel))

// 2. 标记已读第一条
await page.evaluate(() => {
    document.querySelector('.chat-notification-item .chat-notification-read')?.click()
})
await page.waitForTimeout(800)

const afterRead = await page.evaluate(() => {
    const first = document.querySelector('.chat-notification-item')
    const badge = document.querySelector('#chatNotificationBadge')

    return {
        firstIsRead: first?.classList.contains('is-read') || false,
        firstReadBtnGone: !first?.querySelector('.chat-notification-read'),
        subtitle: document.querySelector('.chat-notification-subtitle')?.textContent || null,
        badgeHidden: badge?.hasAttribute('hidden') ?? true,
        badgeText: badge?.textContent || '',
    }
})
console.log('2 after read:', JSON.stringify(afterRead))

// 3. 删除第一条
await page.evaluate(() => {
    document.querySelector('.chat-notification-item .chat-notification-remove')?.click()
})
await page.waitForTimeout(800)

const afterRemove = await page.evaluate(() => {
    return {
        itemCount: document.querySelectorAll('.chat-notification-item').length,
        subtitle: document.querySelector('.chat-notification-subtitle')?.textContent || null,
    }
})
console.log('3 after remove:', JSON.stringify(afterRemove))

// 4. 外部点击关闭面板
await page.mouse.click(700, 450)
await page.waitForTimeout(400)

const closed = await page.evaluate(() => {
    const popover = document.querySelector('.chat-notification-popover')

    return popover ? !popover.classList.contains('open') : true
})
console.log('4 closed by outside click:', closed)

// 5. 公告弹窗(管理员)
await page.evaluate(() => {
    document.querySelector('#toggleNotificationPanel')?.click()
})
await page.waitForTimeout(600)

await page.evaluate(() => {
    document.querySelector('.chat-notification-add')?.click()
})
await page.waitForTimeout(500)

const announcementModal = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('设置公告'))

    return {
        visible: !!modal,
        hasTitle: !!modal?.querySelector('#announcementTitleInput'),
        hasContent: !!modal?.querySelector('#announcementContentInput'),
        levelLabel: modal?.querySelector('#announcementLevelSelectButton span')?.textContent || null,
    }
})
console.log('5 announcement modal:', JSON.stringify(announcementModal))

// 6. 级别下拉选择
await page.evaluate(() => {
    document.querySelector('#announcementLevelSelectButton')?.click()
})
await page.waitForTimeout(300)

const levelMenu = await page.evaluate(() => {
    const menu = document.querySelector('#announcementLevelSelectMenu')

    return {
        visible: menu ? !menu.hasAttribute('hidden') : false,
        options: menu ? [...menu.querySelectorAll('[role=option]')].map((o) => o.textContent) : [],
    }
})
console.log('6 level menu:', JSON.stringify(levelMenu))

// 选"重要"
await page.evaluate(() => {
    const menu = document.querySelector('#announcementLevelSelectMenu')
    const option = [...menu.querySelectorAll('[role=option]')].find((o) => o.textContent === '重要')
    option?.click()
})
await page.waitForTimeout(300)

const levelSelected = await page.evaluate(() => {
    return document.querySelector('#announcementLevelSelectButton span')?.textContent || null
})
console.log('7 level selected:', levelSelected)

// 关闭弹窗(Esc)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

const announcementClosed = await page.evaluate(() => {
    return ![...document.querySelectorAll('.g-modal-backdrop')].some((el) => el.textContent.includes('设置公告'))
})
console.log('8 announcement closed:', announcementClosed)

await browser.close()
