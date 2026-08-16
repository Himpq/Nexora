// api-keys-check.mjs — 我的 API Key 管理回归测试
// 验证:设置 → 我的 API Key → 列表空态 → 创建(弹窗+明文展示) → 列表出现 → 删除
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

// 清理旧测试 key
await page.evaluate(async () => {
    const res = await fetch('/api/user/papi-keys')
    const data = await res.json()

    for (const key of data.keys || []) {
        if (key.name && key.name.includes('回归测试')) {
            await fetch(`/api/user/papi-keys/${key.id}`, { method: 'DELETE' })
        }
    }
})

// 1. 打开设置 → 我的 API Key tab
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(800)

await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.settings-nav-item')]
    const target = tabs.find((b) => b.textContent.trim() === '我的 API Key')
    target?.click()
})
await page.waitForTimeout(800)

const panel = await page.evaluate(() => {
    return {
        hasCreateBtn: [...document.querySelectorAll('.settings-management-toolbar button')].some((b) => b.textContent.includes('新建 Key')),
        emptyText: document.querySelector('.settings-management-list-state')?.textContent || null,
    }
})
console.log('1 panel:', JSON.stringify(panel))

// 2. 创建 Key
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-management-toolbar button')].find((b) => b.textContent.includes('新建 Key'))
    btn?.click()
})
await page.waitForTimeout(600)

const createModal = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('创建 API Key'))

    return {
        visible: !!modal,
        hasName: !!modal?.querySelector('input'),
        hasExpire: !!modal?.querySelector('.chat-announcement-level-select'),
    }
})
console.log('2 create modal:', JSON.stringify(createModal))

await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('创建 API Key'))
    const input = backdrop?.querySelector('input')
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('创建'))

    if (input) {
        input.value = '回归测试Key'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    confirm?.click()
})
await page.waitForTimeout(1500)

// 3. 明文 Key 展示弹窗
const plain = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
    const modal = backdrop.find((el) => el.textContent.includes('复制你的 Key'))

    return {
        visible: !!modal,
        keyLen: modal?.querySelector('code')?.textContent?.length || 0,
        hasCopy: !!modal?.querySelector('.g-btn-primary'),
    }
})
console.log('3 plain key modal:', JSON.stringify(plain))

// 关闭明文弹窗
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('复制你的 Key'))
    const btn = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('完成'))
    btn?.click()
})
await page.waitForTimeout(600)

// 4. 列表出现新 key
const listAfterCreate = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.papi-key-list-item')]

    return {
        itemCount: items.length,
        firstName: items[0]?.querySelector('.admin-user-name')?.textContent || null,
        preview: items[0]?.querySelector('.admin-user-meta')?.textContent || null,
    }
})
console.log('4 list after create:', JSON.stringify(listAfterCreate))

// 5. 选中 → 详情(原版 papi-action-row + admin-info-text)
await page.evaluate(() => {
    document.querySelector('.papi-key-list-item')?.click()
})
await page.waitForTimeout(500)

const detail = await page.evaluate(() => {
    return {
        hasName: !!document.querySelector('.admin-user-detail-grid input'),
        hasActions: document.querySelectorAll('.papi-action-row button').length,
        preview: document.querySelector('.admin-user-detail-grid .admin-info-text')?.textContent || null,
        actionLabels: [...document.querySelectorAll('.papi-action-row button span')].map((b) => b.textContent),
    }
})
console.log('5 detail:', JSON.stringify(detail))

// 6. 删除
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.papi-action-row button')].find((b) => b.textContent.includes('删除'))
    btn?.click()
})
await page.waitForTimeout(600)

await page.evaluate(() => {
    document.querySelector('.g-btn-danger')?.click()
})
await page.waitForTimeout(1200)

const afterDelete = await page.evaluate(() => {
    return {
        itemCount: document.querySelectorAll('.papi-key-list-item').length,
        emptyText: document.querySelector('.settings-management-list-state')?.textContent || null,
    }
})
console.log('6 after delete:', JSON.stringify(afterDelete))

await page.keyboard.press('Escape')
await browser.close()
