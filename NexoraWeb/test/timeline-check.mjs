// timeline-check.mjs — 时间线浮动面板回归测试
// 验证:用户菜单入口 → 面板打开 → 列表渲染(日期/图标/差异) → 拖拽移动 → 缩放 → 关闭
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

// 1. 用户菜单入口
await page.click('#usernameBtn')
await page.waitForTimeout(400)

const timelineEntry = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]

    return items.some((el) => el.textContent.includes('时间线'))
})
console.log('1 menu entry:', timelineEntry)

await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('时间线'))
    target?.click()
})
await page.waitForTimeout(1200)

// 2. 面板打开 + 列表渲染
const panel = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')
    const items = [...document.querySelectorAll('.timeline-item')].map((item) => ({
        date: item.querySelector('.timeline-date-main')?.textContent,
        time: item.querySelector('.timeline-date-time')?.textContent,
        title: item.querySelector('.timeline-title')?.textContent,
        kind: item.querySelector('.timeline-kind-label')?.textContent,
        icon: item.querySelector('.timeline-type-icon i')?.getAttribute('class') || '',
        diffSign: item.querySelector('.timeline-diff-sign')?.textContent || '',
        diffBody: item.querySelector('.timeline-diff-body')?.textContent || item.querySelector('.timeline-diff-summary')?.textContent || '',
        diffClass: item.querySelector('.timeline-diff')?.className || '',
        by: item.querySelector('.timeline-update-by span')?.textContent,
    }))

    return {
        open: !!el && el.classList.contains('active'),
        style: el ? { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height } : null,
        itemCount: items.length,
        items: items.slice(0, 3),
    }
})
console.log('2 panel:', JSON.stringify(panel))

// 3. 拖拽头部移动
const before = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')

    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) }
})
const head = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel-head')
    const r = el.getBoundingClientRect()

    return { x: r.left + 100, y: r.top + 15 }
})
await page.mouse.move(head.x, head.y)
await page.mouse.down()
await page.mouse.move(head.x + 80, head.y + 40, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(400)

const after = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')

    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) }
})
console.log('3 drag moved:', JSON.stringify({ before, after, moved: before.left !== after.left && before.top !== after.top }))

// 4. 缩放(右下角手柄)
const beforeSize = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')

    return { width: parseFloat(el.style.width), height: parseFloat(el.style.height) }
})
const handle = await page.evaluate(() => {
    const el = document.querySelector('.timeline-resize-handle')
    const r = el.getBoundingClientRect()

    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.move(handle.x, handle.y)
await page.mouse.down()
await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(400)

const afterSize = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')

    return { width: parseFloat(el.style.width), height: parseFloat(el.style.height) }
})
console.log('4 resize:', JSON.stringify({ beforeSize, afterSize, grew: afterSize.width > beforeSize.width && afterSize.height > beforeSize.height }))

// 5. 位置持久化(localStorage)
const persisted = await page.evaluate(() => localStorage.getItem('nexora_timeline_panel_layout_v1'))
console.log('5 persisted layout:', persisted)

// 6. 关闭
await page.evaluate(() => {
    document.querySelector('.timeline-panel-close')?.click()
})
await page.waitForTimeout(400)

const closed = await page.evaluate(() => {
    const el = document.querySelector('.timeline-panel')

    return el ? !el.classList.contains('active') : true
})
console.log('6 closed:', closed)

await browser.close()
