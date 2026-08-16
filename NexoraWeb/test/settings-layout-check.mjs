// settings-layout-check.mjs — 设置窗口布局回归测试
// 验证:legacy Modal + #settingsModal 原版样式生效 → 导航在左侧(grid) → 原版按钮类 → 头像用 user_id
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
    const backdrop = document.querySelector('#settingsModal')
    const card = document.querySelector('#settingsModal .settings-modal-custom')
    const shell = document.querySelector('#settingsModal .admin-shell.settings-shell')
    const nav = document.querySelector('#settingsModal .admin-nav.settings-nav')
    const content = document.querySelector('#settingsModal .admin-content.settings-content')
    const head = document.querySelector('#settingsModal .modal-head')

    const shellDisplay = shell ? getComputedStyle(shell).display : ''
    const shellCols = shell ? getComputedStyle(shell).gridTemplateColumns : ''
    const navDisplay = nav ? getComputedStyle(nav).display : ''
    const navRect = nav?.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect()

    return {
        hasBackdrop: !!backdrop,
        hasCard: !!card,
        hasShell: !!shell,
        hasHead: !!head,
        headText: head?.querySelector('h3')?.textContent || null,
        closeBtn: head?.querySelector('.btn-modal-close')?.textContent || null,
        shellDisplay,
        shellCols,
        navDisplay,
        navLeft: navRect ? Math.round(navRect.left) : null,
        contentLeft: contentRect ? Math.round(contentRect.left) : null,
        // 导航在内容左侧(原版 grid 220px 1fr)
        navIsLeftOfContent: navRect && contentRect ? navRect.left < contentRect.left : false,
        cardSize: card ? { w: Math.round(card.getBoundingClientRect().width), h: Math.round(card.getBoundingClientRect().height) } : null,
    }
})
console.log('1 settings layout:', JSON.stringify(layout))

// 2. profile tab:原版按钮类 + 头像 URL 基于 user_id
const profile = await page.evaluate(() => {
    const uploadBtn = document.querySelector('.settings-avatar-actions .btn-primary-outline')
    const avatarImg = document.querySelector('#settingsAvatarImg')
    const useridLine = document.querySelector('.settings-userid-inline')

    return {
        uploadBtnClass: uploadBtn ? uploadBtn.className : null,
        uploadBtnText: uploadBtn?.textContent?.trim() || null,
        avatarSrc: avatarImg?.getAttribute('src') || null,
        avatarIsImg: avatarImg?.tagName === 'IMG',
        useridText: useridLine?.textContent || null,
    }
})
console.log('2 profile tab:', JSON.stringify(profile))

// 3. 我的 API Key tab:toolbar 按钮类 + 列表/详情布局
await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.settings-nav .admin-tab')]
    const target = tabs.find((b) => b.textContent.trim() === '我的 API Key')
    target?.click()
})
await page.waitForTimeout(800)

const apiKeysTab = await page.evaluate(() => {
    const toolbar = document.querySelector('#settingsModal .settings-management-toolbar')
    const layout = document.querySelector('#settingsModal .settings-management-layout')
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

const closed = await page.evaluate(() => !document.querySelector('#settingsModal'))
console.log('4 closed:', closed)

await browser.close()
