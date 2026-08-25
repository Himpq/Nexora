// notes-check.mjs — 笔记面板回归测试
// 验证:笔记按钮打开面板 → 云同步加载 → 选区右键添加到笔记 → 笔记列表渲染 → 删除 → 新建笔记本
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

// 打开有消息的会话("测试会话"含 7 条消息;空会话无法选区)
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 3, null, { timeout: 8000 }).catch(() => {})
const convOpened = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.textContent.includes('测试会话')) || items.find((el) => !el.textContent.includes('新对话'))

    if (!target) return false

    target.click()

    return true
})
console.log('0 open conv with messages:', convOpened)
await page.waitForTimeout(2500)

// 1. 打开笔记面板
await page.evaluate(() => {
    document.querySelector('#toggleNotesPanel')?.click()
})
await page.waitForTimeout(1200)

const panel = await page.evaluate(() => {
    const el = document.querySelector('.notes-panel')

    return {
        open: !!el && el.classList.contains('active'),
        hasNotebookSelect: !!el?.querySelector('.notes-notebook-select'),
        hasAdd: !!el?.querySelector('.notes-notebook-add'),
        hasTools: el ? el.querySelectorAll('.notes-notebook-tool').length : 0,
        style: el ? { w: el.style.width, h: el.style.height } : null,
    }
})
console.log('1 panel open:', JSON.stringify(panel))

// 2. 选区 + 右键菜单:在一次 evaluate 内完成选区与 contextmenu 派发,避免 selection 丢失
const ctxMenu = await page.evaluate(async () => {
    const msg = document.querySelector('.message.user .message-bubble, .message.assistant .content-body')

    if (!msg) {
        return { visible: false, buttons: [], reason: 'no message' }
    }

    const sel = window.getSelection()
    const range = document.createRange()

    range.selectNodeContents(msg)
    sel.removeAllRanges()
    sel.addRange(range)

    if (!sel.toString().trim()) {
        return { visible: false, buttons: [], reason: 'empty selection' }
    }

    const rect = msg.getBoundingClientRect()
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 50,
        clientY: rect.top + 20,
    })

    msg.dispatchEvent(event)

    // 等待 Vue 响应后读取菜单
    await new Promise((resolve) => setTimeout(resolve, 400))

    const menu = document.querySelector('.notes-context-menu')

    return {
        visible: !!menu && menu.classList.contains('active'),
        buttons: menu ? [...menu.querySelectorAll('button span')].map((b) => b.textContent) : [],
    }
})
console.log('2 context menu:', JSON.stringify(ctxMenu))

// 3. 点击"添加到笔记"
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.notes-context-menu button')]
        .find((b) => b.textContent.includes('添加到笔记'))
    btn?.click()
})
await page.waitForTimeout(1500)

const afterAdd = await page.evaluate(() => {
    const notes = document.querySelectorAll('.note-item')

    return {
        noteCount: notes.length,
        panelOpen: document.querySelector('.notes-panel')?.classList.contains('active') || false,
        firstText: notes[0]?.querySelector('.note-text')?.textContent?.trim().slice(0, 40) || null,
        hasDelete: !!notes[0]?.querySelector('.note-del-btn'),
    }
})
console.log('3 after add note:', JSON.stringify(afterAdd))

// 4. 云同步校验:刷新页面后笔记仍在
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

await page.evaluate(() => {
    document.querySelector('#toggleNotesPanel')?.click()
})
await page.waitForTimeout(1200)

const afterReload = await page.evaluate(() => {
    return {
        noteCount: document.querySelectorAll('.note-item').length,
        firstText: document.querySelector('.note-item .note-text')?.textContent?.trim().slice(0, 40) || null,
    }
})
console.log('4 after reload:', JSON.stringify(afterReload))

// 5. 新建笔记本(自建 prompt)
await page.evaluate(() => {
    document.querySelector('.notes-notebook-add')?.click()
})
await page.waitForTimeout(600)

const promptShown = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('新建笔记本'))

    return !!modal
})
console.log('5 create notebook prompt:', promptShown)

await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('新建笔记本'))
    const input = backdrop?.querySelector('input')
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('创建'))

    if (input) {
        input.value = '测试笔记本'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    confirm?.click()
})
await page.waitForTimeout(1000)

const afterCreate = await page.evaluate(() => {
    return {
        selectText: document.querySelector('.notes-notebook-select span')?.textContent || null,
        notebookCount: document.querySelectorAll('.notes-notebook-menu button').length,
    }
})
console.log('6 after create notebook:', JSON.stringify(afterCreate))

// 7. 删除新建的笔记本
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.notes-notebook-tool')].find((b) => b.title.includes('删除当前笔记本'))
    btn?.click()
})
await page.waitForTimeout(600)

await page.evaluate(() => {
    const confirmBtn = [...document.querySelectorAll('.g-btn')].find((b) => b.textContent.includes('删除'))
    confirmBtn?.click()
})
await page.waitForTimeout(1000)

const afterDelete = await page.evaluate(() => {
    return {
        selectText: document.querySelector('.notes-notebook-select span')?.textContent || null,
    }
})
console.log('7 after delete notebook:', JSON.stringify(afterDelete))

// 清理:删除测试笔记
await page.evaluate(() => {
    const delBtn = document.querySelector('.note-item .note-del-btn')
    if (delBtn) delBtn.click()
})
await page.waitForTimeout(600)
await page.evaluate(() => {
    const confirmBtn = [...document.querySelectorAll('.g-btn')].find((b) => b.textContent.includes('删除'))
    confirmBtn?.click()
})
await page.waitForTimeout(1200)

const cleaned = await page.evaluate(() => document.querySelectorAll('.note-item').length)
console.log('8 cleaned:', cleaned)

await page.keyboard.press('Escape')
await browser.close()
