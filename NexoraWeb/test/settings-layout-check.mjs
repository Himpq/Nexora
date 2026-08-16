// settings-layout-check.mjs — 设置窗口全新布局回归测试
// 验证:新 Modal(非 legacy)+ 左右壳布局 → 分组导航在左 → 页头 → 圆形头像(无 img 溢出)→ API Key 面板
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

// 1. 打开设置
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1200)

const layout = await page.evaluate(() => {
    const card = document.querySelector('.g-modal.settings-modal')
    const shell = document.querySelector('.settings-modal-shell')
    const nav = document.querySelector('.settings-nav')
    const main = document.querySelector('.settings-main')
    const head = document.querySelector('.g-modal-head')
    const body = card?.querySelector('.g-modal-body')

    const shellDisplay = shell ? getComputedStyle(shell).display : ''
    const navRect = nav?.getBoundingClientRect()
    const mainRect = main?.getBoundingClientRect()
    const bodyPadding = body ? getComputedStyle(body).padding : ''

    return {
        hasCard: !!card,
        cardSize: card ? { w: Math.round(card.getBoundingClientRect().width), h: Math.round(card.getBoundingClientRect().height) } : null,
        hasShell: !!shell,
        shellDisplay,
        navWidth: navRect ? Math.round(navRect.width) : null,
        mainLeft: mainRect ? Math.round(mainRect.left) : null,
        navIsLeftOfMain: navRect && mainRect ? navRect.left < mainRect.left : false,
        headText: head?.querySelector('h3')?.textContent || null,
        bodyPadding,
        legacyClasses: !!document.querySelector('#settingsModal, .modal-backdrop.active'),
    }
})
console.log('1 settings layout:', JSON.stringify(layout))

// 2. profile tab:圆形头像(div + background-cover,无 img 溢出)
const profile = await page.evaluate(() => {
    const avatar = document.querySelector('#settingsAvatarImg')
    const style = avatar ? getComputedStyle(avatar) : null

    return {
        avatarTag: avatar?.tagName || null,
        isDiv: avatar?.tagName === 'DIV',
        size: avatar ? `${Math.round(avatar.getBoundingClientRect().width)}x${Math.round(avatar.getBoundingClientRect().height)}` : null,
        radius: style?.borderRadius || null,
        bgSize: style?.backgroundSize || null,
        uploadBtn: document.querySelector('.settings-avatar-actions .btn-primary-outline')?.textContent?.trim() || null,
        rows: document.querySelectorAll('.setting-row').length,
        cards: document.querySelectorAll('.setting-card').length,
        pageHead: document.querySelector('.settings-page-head h2')?.textContent || null,
    }
})
console.log('2 profile tab:', JSON.stringify(profile))

// 3. 我的 API Key tab:toolbar + 列表/详情布局
await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.settings-nav-item')]
    const target = tabs.find((b) => b.textContent.trim() === '我的 API Key')
    target?.click()
})
await page.waitForTimeout(800)

const apiKeysTab = await page.evaluate(() => {
    const toolbar = document.querySelector('.settings-management-toolbar')
    const layout = document.querySelector('.settings-management-layout')
    const createBtn = toolbar ? [...toolbar.querySelectorAll('button')].find((b) => b.textContent.includes('新建 Key')) : null
    const layoutCols = layout ? getComputedStyle(layout).gridTemplateColumns : ''

    return {
        hasToolbar: !!toolbar,
        hasLayout: !!layout,
        createBtnClass: createBtn ? createBtn.className : null,
        layoutCols,
    }
})
console.log('3 api keys tab:', JSON.stringify(apiKeysTab))

await page.keyboard.press('Escape')
await page.waitForTimeout(400)

const closed = await page.evaluate(() => !document.querySelector('.g-modal.settings-modal'))
console.log('4 closed:', closed)

await browser.close()