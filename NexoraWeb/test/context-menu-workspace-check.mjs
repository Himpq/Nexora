// context-menu-workspace-check.mjs — 右键菜单"归入工作区"回归测试
// 验证:右键会话 → 归入工作区子菜单 → 选择工作区 → 会话归入 → 后端校验
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

// 准备:创建测试工作区(直接 API)
const wsId = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '右键归入测试' }),
    })
    const data = await res.json()

    return data.workspace?.workspace_id || ''
})
console.log('0 workspace created:', wsId)

// 1. 右键第一个会话 → 打开右键菜单
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 3, null, { timeout: 8000 }).catch(() => {})
await page.evaluate(() => {
    const el = document.querySelector('.conversation-item')
    const rect = el.getBoundingClientRect()
    const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 100,
        clientY: rect.top + 20,
    })
    el.dispatchEvent(event)
})
await page.waitForTimeout(500)

const menuOpen = await page.evaluate(() => {
    const menu = document.querySelector('#pinContextMenu')

    return menu ? menu.classList.contains('active') : false
})
console.log('1 context menu open:', menuOpen)

// 2. 展开"归入工作区"子菜单
await page.evaluate(() => {
    document.querySelector('#pinContextMenuWorkspace')?.click()
})
await page.waitForTimeout(1000)

const submenu = await page.evaluate(() => {
    const list = document.querySelector('#pinContextMenuWorkspaceList')
    const items = list ? [...list.querySelectorAll('.pin-context-workspace-item')].map((el) => el.textContent.trim()) : []

    return {
        open: !!list,
        itemCount: items.length,
        items,
    }
})
console.log('2 workspace submenu:', JSON.stringify(submenu))

// 3. 点击第一个工作区(归入会话)
const convId = await page.evaluate(() => {
    return document.querySelector('.conversation-item')?.getAttribute('data-conversation-id') || ''
})
console.log('   target conv:', convId)

await page.evaluate(() => {
    document.querySelector('#pinContextMenuWorkspaceList .pin-context-workspace-item')?.click()
})
await page.waitForTimeout(1200)

// 4. 后端校验:会话已归入工作区
const verify = await page.evaluate(async (workspaceId) => {
    const res = await fetch(`/api/workspace/${workspaceId}`)
    const data = await res.json()
    const conversations = data.workspace?.conversations || []

    return {
        convCount: conversations.length,
        hasConv: conversations.some((c) => String(c.conversation_id || c.id || '') === 'conv'),
    }
}, wsId)
console.log('4 backend verify:', JSON.stringify(verify))

// 清理:删除测试工作区
await page.evaluate(async (workspaceId) => {
    await fetch(`/api/workspace/${workspaceId}`, { method: 'DELETE' })
}, wsId)
console.log('5 cleanup done')

await browser.close()
