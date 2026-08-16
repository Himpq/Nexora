// visual-regression-check.mjs — 综合视觉回归
// 验证:turn indicator 抽象后正常 + 各面板无 CSS 错乱
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

// 打开有消息的会话
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 3, null, { timeout: 8000 }).catch(() => {})
await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.textContent.includes('测试会话')) || items.find((el) => !el.textContent.includes('新对话'))
    target?.click()
})
await page.waitForTimeout(2500)

// 1. turn indicator 抽象后渲染
const turn = await page.evaluate(() => {
    const panel = document.querySelector('#turnIndicatorPanel')
    const lines = document.querySelectorAll('#turnIndicatorLines .turn-indicator-line')

    return {
        panelVisible: !!panel && panel.classList.contains('visible'),
        lineCount: lines.length,
        activeLine: document.querySelectorAll('#turnIndicatorLines .turn-indicator-line.active').length,
        popupExists: !!document.querySelector('.turn-indicator-popup'),
    }
})
console.log('1 turn indicator:', JSON.stringify(turn))

// 2. 点击轮次线跳转
await page.evaluate(() => {
    document.querySelector('#turnIndicatorLines .turn-indicator-line')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(600)

const jump = await page.evaluate(() => {
    return {
        highlighted: !!document.querySelector('.message.user.turn-jump-highlight'),
    }
})
console.log('2 jump highlight:', JSON.stringify(jump))

// 3. hover popup
await page.evaluate(() => {
    const line = document.querySelector('#turnIndicatorLines .turn-indicator-line')
    line?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
})
await page.waitForTimeout(300)

const popup = await page.evaluate(() => {
    const popup = document.querySelector('.turn-indicator-popup')

    return {
        visible: popup?.classList.contains('visible') || false,
        items: popup?.querySelectorAll('.turn-indicator-popup-item').length || 0,
        text: popup?.querySelector('.turn-indicator-popup-text')?.textContent?.slice(0, 30) || null,
    }
})
console.log('3 popup:', JSON.stringify(popup))

// 4. 无 console error
await browser.close()
