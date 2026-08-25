// debug-profile-layout.mjs — 复现个人资料溢出 + textarea 小方块
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

// 1. 个人资料:所有子元素 vs 容器宽高 + 溢出检测
const profile = await page.evaluate(() => {
    const body = document.querySelector('.settings-page-body')
    const bodyRect = body.getBoundingClientRect()
    const issues = []

    // 遍历 profile 区所有元素,找出宽度超过 body 的元素
    for (const el of body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width > bodyRect.width + 2) {
            const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 60) : el.tagName
            issues.push({ tag: el.tagName, cls, w: Math.round(r.width), bodyW: Math.round(bodyRect.width), left: Math.round(r.left - bodyRect.left) })
        }
    }

    return {
        bodyW: Math.round(bodyRect.width),
        bodyH: Math.round(bodyRect.height),
        issues: issues.slice(0, 15),
        issueCount: issues.length,
    }
})
console.log('1 profile overflow:', JSON.stringify(profile, null, 1))

// 2. 偏好设置:textarea 尺寸
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '偏好设置')
    btn?.click()
})
await page.waitForTimeout(800)

const textarea = await page.evaluate(() => {
    const ta = document.querySelector('#settingsMemoryProfile')
    if (!ta) return { found: false }

    const r = ta.getBoundingClientRect()
    const cs = getComputedStyle(ta)
    const row = ta.closest('.setting-row')
    const rowRect = row?.getBoundingClientRect()
    const control = ta.closest('.setting-row-control')

    return {
        found: true,
        w: Math.round(r.width),
        h: Math.round(r.height),
        rowW: rowRect ? Math.round(rowRect.width) : 0,
        controlW: control ? Math.round(control.getBoundingClientRect().width) : 0,
        display: cs.display,
        widthProp: cs.width,
        rows: ta.getAttribute('rows'),
    }
})
console.log('2 memory textarea:', JSON.stringify(textarea))

// 3. Skill 编辑器 textarea(psEditorContent)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === 'Skill')
    btn?.click()
})
await page.waitForTimeout(600)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-my-toolbar button')].find((b) => b.textContent.includes('新建 Skill'))
    btn?.click()
})
await page.waitForTimeout(500)
const editorTextarea = await page.evaluate(() => {
    const ta = document.querySelector('#psEditorContent')
    if (!ta) return { found: false }
    const r = ta.getBoundingClientRect()

    return { found: true, w: Math.round(r.width), h: Math.round(r.height) }
})
console.log('3 editor textarea:', JSON.stringify(editorTextarea))

await browser.close()