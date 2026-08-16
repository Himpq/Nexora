// modal-check.mjs — 弹窗体系回归测试(GDDP)
// 验证:设置弹窗(legacy #settingsModal + 现代样式)、div 头像无回归、会话删除确认小窗(showConfirm)
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

// 1. 设置弹窗(全新 UI:现代 Modal + 分组导航)
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(800)

const settingsModal = await page.evaluate(() => {
    const card = document.querySelector('.g-modal.settings-modal')
    const shell = document.querySelector('.settings-modal-shell')
    const nav = document.querySelector('.settings-nav')
    const cs = card ? getComputedStyle(card) : null
    const body = card?.querySelector('.g-modal-body')

    return {
        exists: !!card,
        shell: !!shell,
        borderRadius: cs ? cs.borderRadius : null,
        width: card ? Math.round(card.getBoundingClientRect().width) : 0,
        height: card ? Math.round(card.getBoundingClientRect().height) : 0,
        bodyPadding: body ? getComputedStyle(body).padding : null,
        navItems: nav ? nav.querySelectorAll('.settings-nav-item').length : 0,
        groups: nav ? nav.querySelectorAll('.settings-nav-group-label').length : 0,
    }
})
console.log('1 settings modal:', JSON.stringify(settingsModal))

// 关闭设置
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 2. 头像仍显示(div.avatar-circle.has-image + background-image,无 <img> 溢出)
const avatar = await page.evaluate(() => {
    const el = document.querySelector('#sidebar-avatar')
    const style = el ? getComputedStyle(el) : null

    return {
        hasImageClass: el?.classList.contains('has-image') || false,
        bgImage: style?.backgroundImage.slice(0, 60) || '',
        size: el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null,
        hasImgTag: !!el?.querySelector('img'),
    }
})
console.log('2 avatar:', JSON.stringify(avatar))

// 3. 进入一个有会话的对话,触发删除确认小窗
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 1, null, { timeout: 8000 }).catch(() => {})
await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => !el.textContent.includes('新对话')) || items[0]
    target?.click()
})
await page.waitForTimeout(2000)

const deleteBtnFound = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.classList.contains('active')) || items.find((el) => !el.textContent.includes('新对话'))
    const btn = target?.querySelector('.delete-chat')

    if (!btn) return false

    btn.click()

    return true
})

if (deleteBtnFound) {
    await page.waitForTimeout(600)

    const confirmModal = await page.evaluate(() => {
        const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
        const modal = backdrop ? backdrop.querySelector('.g-modal') : null
        const cs = modal ? getComputedStyle(modal) : null

        return {
            exists: !!modal,
            borderRadius: cs ? cs.borderRadius : null,
            title: modal ? modal.querySelector('.g-modal-head h3')?.textContent : null,
            hasDangerBtn: !!modal?.querySelector('.g-btn-danger'),
            hasGhostBtn: !!modal?.querySelector('.g-btn-ghost'),
        }
    })
    console.log('3 confirm modal:', JSON.stringify(confirmModal))

    // 取消,不删除
    await page.evaluate(() => {
        document.querySelector('#nexora-confirm-root [data-action="cancel"]')?.click()
    })
    await page.waitForTimeout(400)
}

await browser.close()
console.log('\ndone')