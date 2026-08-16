// debug-profile2.mjs — 深挖个人资料溢出(卡内溢出/不同视口)+ 验证修复
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

async function run(viewport, label) {
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
    })
    const page = await browser.newPage({ viewport })

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
    await page.waitForTimeout(1000)

    const profile = await page.evaluate(() => {
        const issues = []
        const modal = document.querySelector('.g-modal.settings-modal')
        const modalRect = modal.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight

        // 弹窗越出视口?
        if (modalRect.right > vw + 1 || modalRect.bottom > vh + 1 || modalRect.left < -1 || modalRect.top < -1) {
            issues.push({ type: 'modal-out-of-viewport', rect: { l: Math.round(modalRect.left), r: Math.round(modalRect.right), t: Math.round(modalRect.top), b: Math.round(modalRect.bottom) }, vw, vh })
        }

        // 卡内内容横向溢出
        for (const card of document.querySelectorAll('.setting-card')) {
            const cardRect = card.getBoundingClientRect()
            for (const el of card.querySelectorAll('*')) {
                const r = el.getBoundingClientRect()
                if (r.right > cardRect.right + 2 || r.left < cardRect.left - 2) {
                    const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 40) : el.tagName
                    issues.push({ type: 'card-overflow-x', cardCls: card.className.slice(0, 20), el: `${el.tagName}.${cls}`, w: Math.round(r.width), cardW: Math.round(cardRect.width) })
                    break
                }
            }
        }

        // 卡内内容纵向溢出(内容超出卡片高度)
        for (const card of document.querySelectorAll('.setting-card')) {
            const cardRect = card.getBoundingClientRect()
            const kids = [...card.children]
            const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom), cardRect.top)
            if (bottom > cardRect.bottom + 2) {
                issues.push({ type: 'card-overflow-y', cardCls: card.className.slice(0, 20), contentBottom: Math.round(bottom), cardBottom: Math.round(cardRect.bottom) })
            }
        }

        return { issues, modalSize: { w: Math.round(modalRect.width), h: Math.round(modalRect.height) }, vw, vh }
    })
    console.log(`${label}:`, JSON.stringify(profile, null, 1))

    // 验证记忆 textarea 已全宽
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '偏好设置')
        btn?.click()
    })
    await page.waitForTimeout(700)
    const ta = await page.evaluate(() => {
        const el = document.querySelector('#settingsMemoryProfile')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
    })
    console.log(`${label} textarea:`, JSON.stringify(ta))

    await browser.close()
}

await run({ width: 1440, height: 900 }, '1440x900')
await run({ width: 2560, height: 1080 }, '2560x1080')
await run({ width: 1280, height: 720 }, '1280x720')
console.log('\ndone')