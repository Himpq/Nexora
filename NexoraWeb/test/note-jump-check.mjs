// note-jump-check.mjs — 笔记来源跳转回归测试
// 验证:选区右键添加笔记(带 anchor)→ 笔记面板点击来源 → 跳转到对应消息高亮
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

// 1. 先打开笔记面板(确保添加后立即可见)
await page.evaluate(() => document.querySelector('#toggleNotesPanel')?.click())
await page.waitForTimeout(1000)

// 2. 选区右键添加笔记(带 anchor)
const added = await page.evaluate(async () => {
    const msg = document.querySelector('.message.user .message-bubble, .message.assistant .content-body')

    if (!msg) return { ok: false, reason: 'no message' }

    const sel = window.getSelection()
    const range = document.createRange()

    range.selectNodeContents(msg)
    sel.removeAllRanges()
    sel.addRange(range)

    const rect = msg.getBoundingClientRect()
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 50,
        clientY: rect.top + 20,
    })

    msg.dispatchEvent(event)

    await new Promise((resolve) => setTimeout(resolve, 400))

    const menu = document.querySelector('.notes-context-menu')

    if (!menu) return { ok: false, reason: 'no menu' }

    const btn = [...menu.querySelectorAll('button')].find((b) => b.textContent.includes('添加到笔记'))
    btn?.click()

    await new Promise((resolve) => setTimeout(resolve, 1500))

    return { ok: true }
})
console.log('1 add note:', JSON.stringify(added))

// 3. 笔记面板出现带来源的笔记
const noteInfo = await page.evaluate(() => {
    const note = document.querySelector('.note-item')
    const sourceBtn = note?.querySelector('.note-source-link')

    return {
        noteExists: !!note,
        sourceDisabled: sourceBtn ? sourceBtn.disabled : null,
        sourceText: sourceBtn?.textContent?.trim() || null,
        notesPanelOpen: document.querySelector('.notes-panel')?.classList.contains('active') || false,
    }
})
console.log('2 note with source:', JSON.stringify(noteInfo))

// 4. 点击来源 → 跳转到对应消息
const jumpResult = await page.evaluate(async () => {
    const sourceBtn = document.querySelector('.note-item .note-source-link')

    if (!sourceBtn || sourceBtn.disabled) return { jumped: false, reason: 'disabled' }

    sourceBtn.click()

    // 等待跳转(关闭面板 + 打开会话 + 滚动)
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const highlighted = document.querySelector('.message.turn-jump-highlight, .message.user.turn-jump-highlight')

    return {
        jumped: true,
        highlighted: !!highlighted,
        panelClosed: !document.querySelector('.notes-panel')?.classList.contains('active'),
        chatVisible: !!document.querySelector('.messages-area'),
    }
})
console.log('3 jump:', JSON.stringify(jumpResult))

await browser.close()
