// trash-check.mjs — 回收站弹窗回归测试
// 验证:用户菜单入口 → 回收站弹窗 → 条目渲染 → 清空确认 → 恢复
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

// 1. 打开用户菜单 → 点击回收站
await page.click('#usernameBtn')
await page.waitForTimeout(400)

const trashMenuVisible = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item span')]
    return items.some((el) => el.textContent.includes('回收站'))
})
console.log('1 user menu trash entry:', trashMenuVisible)

await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('回收站'))
    target?.click()
})
await page.waitForTimeout(800)

// 2. 弹窗与条目渲染
const modal = await page.evaluate(() => {
    const card = document.querySelector('.g-modal.trash-modal-custom')
    const items = [...document.querySelectorAll('.trash-item')].map((el) => ({
        type: el.querySelector('.trash-item-type')?.textContent,
        title: el.querySelector('.trash-item-title')?.textContent,
        preview: el.querySelector('.trash-item-preview')?.textContent,
        hasRestore: !!el.querySelector('.trash-action-btn'),
    }))
    const empty = document.querySelector('.trash-empty')

    return {
        modalOpen: !!card,
        cardSize: card ? { w: card.getBoundingClientRect().width, h: card.getBoundingClientRect().height } : null,
        itemCount: items.length,
        firstItem: items[0] || null,
        emptyText: empty?.textContent || null,
        headBtns: [...document.querySelectorAll('.trash-head-btn')].map((b) => b.textContent.trim()),
    }
})
console.log('2 trash modal:', JSON.stringify(modal))

// 3. 清空确认流程(危险按钮)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.trash-head-btn')].find((b) => b.textContent.includes('清空'))
    btn?.click()
})
await page.waitForTimeout(600)

const confirmShown = await page.evaluate(() => {
    const dialog = document.querySelector('.g-modal-backdrop .g-modal')
    const texts = dialog ? dialog.textContent : ''
    return {
        visible: !!dialog,
        hasTitle: texts.includes('清空回收站'),
        hasDangerBtn: !!dialog?.querySelector('.g-btn-danger'),
        dangerText: dialog?.querySelector('.g-btn-danger')?.textContent?.trim() || null,
    }
})
console.log('3 clear confirm:', JSON.stringify(confirmShown))

// 点确认清空
await page.evaluate(() => {
    document.querySelector('.g-btn-danger')?.click()
})
await page.waitForTimeout(1200)

const afterClear = await page.evaluate(() => {
    return {
        itemCount: document.querySelectorAll('.trash-item').length,
        emptyText: document.querySelector('.trash-empty')?.textContent || null,
    }
})
console.log('4 after clear:', JSON.stringify(afterClear))

// 4. 恢复:先再制造一个回收站条目(直接 API),再走 UI 恢复
await page.evaluate(async () => {
    const res = await fetch('/api/conversations', { method: 'POST', credentials: 'include' })
    const created = await res.json()
    await fetch(`/api/conversations/${created.conversation_id}`, { method: 'DELETE', credentials: 'include' })
    await fetch('/api/trash/list?limit=200', { credentials: 'include' })
})
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.trash-head-btn')].find((b) => b.textContent.includes('刷新'))
    btn?.click()
})
await page.waitForTimeout(1000)

const beforeRestore = await page.evaluate(() => document.querySelectorAll('.trash-item').length)
console.log('5 items before restore:', beforeRestore)

await page.evaluate(() => {
    document.querySelector('.trash-item .trash-action-btn')?.click()
})
await page.waitForTimeout(1200)

const afterRestore = await page.evaluate(() => {
    const convCount = document.querySelectorAll('.conversation-item').length

    return {
        trashItems: document.querySelectorAll('.trash-item').length,
        convCount,
        toast: document.querySelector('.g-toast')?.textContent || null,
    }
})
console.log('6 after restore:', JSON.stringify(afterRestore))

// 关闭弹窗
await page.evaluate(() => {
    document.querySelector('.g-modal.trash-modal-custom .btn-modal-close')?.click()
})
await page.waitForTimeout(500)

const closed = await page.evaluate(() => !document.querySelector('.g-modal.trash-modal-custom'))
console.log('7 modal closed:', closed)

await browser.close()
