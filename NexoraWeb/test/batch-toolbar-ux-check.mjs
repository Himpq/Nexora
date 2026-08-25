// batch-toolbar-and-ux-check.mjs — 本轮整改验证
// 覆盖:toolbar→页头 / skill 卡片预览 / 模型 quota(超额在标题行+点 meter 弹层)/
//      统计 user_id+头像菜单 / 认证操作行 grid / 有效期滑条 / 弹窗白色按钮
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)))

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
await page.waitForTimeout(900)

async function openTab(label) {
    await page.evaluate((l) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === l)
        btn?.click()
    }, label)
    await page.waitForTimeout(1000)
}

// 1. 用户管理:toolbar 全部进页头(页头有 筛选输入 + 添加 + 刷新;面板内无 toolbar)
await openTab('用户管理')
const usersHead = await page.evaluate(() => {
    const pageHead = document.querySelector('.settings-page-head-actions')
    const hasFilter = !!pageHead?.querySelector('input.settings-page-head-filter')
    const buttons = [...(pageHead?.querySelectorAll('button') || [])].map((b) => b.textContent.trim())
    const toolbarInputs = document.querySelectorAll('.settings-management-toolbar input').length

    return { hasFilter, buttons, toolbarInputs }
})
console.log('1 admin-users head:', JSON.stringify(usersHead))

// 2. Skill 卡片:预览 = main_content 裁切;编辑与点击同窗体
await openTab('Skill')
const skillCards = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-skill-card')]
    const first = cards[0]
    const preview = first?.querySelector('.settings-skill-preview')?.textContent || ''
    const title = first?.querySelector('.settings-skill-title')?.textContent || ''
    const hasMode = !!first?.querySelector('.setting-select-trigger')
    const badge = first?.querySelector('.settings-skill-badge')?.textContent || ''
    const hasDesc = ![...document.querySelectorAll('.settings-skill-preview')].some((el) => el.textContent === '(无描述)')

    return { cardCount: cards.length, title, previewPreview: preview.slice(0, 40), hasMode, badge, hasDesc }
})
console.log('2 skill cards:', JSON.stringify(skillCards))

// 打开 skill 编辑器检查按钮为白色(点击首个含编辑按钮的卡片)
await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-skill-card')]
    const editable = cards.find((card) => card.querySelector('.settings-skill-actions button[title="编辑"]'))
    editable?.querySelector('.settings-skill-actions button[title="编辑"]')?.click()
})
await page.waitForTimeout(700)
const skillEditor = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
    const buttons = [...(backdrop?.querySelectorAll('button') || [])].map((b) => {
        const cs = getComputedStyle(b)
        const hover = ''

        return { text: b.textContent.trim(), bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, hover }
    })

    return { opened: !!backdrop, buttons }
})
console.log('3 skill editor buttons:', JSON.stringify(skillEditor))
// 关闭编辑器
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
    backdrop?.querySelector('.g-modal-close')?.click()
})
await page.waitForTimeout(300)

// 4. 模型管理:超额在右侧标题行 + 点 meter 弹层
await openTab('模型管理')
const models = await page.evaluate(() => {
    const detailToolbar = document.querySelector('.settings-admin-detail-toolbar, .admin-users-toolbar.admin-system-toolbar-row')
    const quotaRow = [...document.querySelectorAll('.model-provider-quota-row')]
    const providerQuotaInList = [...document.querySelectorAll('.settings-management-list .model-provider-quota-row')].length
    const meter = document.querySelector('.quota-meter-wrap')
    const meterHasClick = !!meter

    return { quotaRowCount: quotaRow.length, providerQuotaInList, meterHasClick }
})
await page.waitForTimeout(400)
// 点击 meter 打开 popover
await page.evaluate(() => {
    document.querySelector('.quota-meter-wrap')?.click()
})
await page.waitForTimeout(400)
const popover = await page.evaluate(() => {
    const el = document.querySelector('.quota-adjust-popover-fixed')

    return { open: !!el, x: el ? Math.round(el.getBoundingClientRect().left) : -1, mode: !!el?.querySelector('select') }
})
console.log('4 models quota:', JSON.stringify({ ...models, popover }))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 5. 统计:user_id + 头像菜单(focus 触发,等待菜单渲染)
await openTab('统计信息')
await page.evaluate(() => {
    const userCard = [...document.querySelectorAll('.admin-token-trend-card')].find((el) => el.textContent.includes('单用户 Token 查询'))
    userCard?.querySelector('.admin-user-token-selector input')?.focus()
})
await page.waitForTimeout(400)
const statsMenu = await page.evaluate(() => {
    const userCard = [...document.querySelectorAll('.admin-token-trend-card')].find((el) => el.textContent.includes('单用户 Token 查询'))
    const items = [...(userCard?.querySelectorAll('.admin-user-token-item') || [])].map((it) => ({
        avatar: !!it.querySelector('.admin-user-token-avatar img, .admin-user-token-avatar i'),
        handle: it.querySelector('.admin-user-token-handle')?.textContent || '',
        name: it.querySelector('.admin-user-token-name')?.textContent || '',
    }))

    return { hasMenu: items.length > 0, items: items.slice(0, 3) }
})
console.log('5 stats user menu:', JSON.stringify(statsMenu))

// 6. 认证管理:操作行 grid + 有效期滑条
await openTab('认证管理')
const auth = await page.evaluate(() => {
    const detail = document.querySelector('.settings-public-api-detail, .admin-user-detail')
    detail?.querySelector('.papi-key-list-item')?.click()

    // 打开生成弹窗
    const btn = [...document.querySelectorAll('.settings-page-head-actions button')].find((b) => b.textContent.includes('生成 Public API Key'))
    btn?.click()

    return { hasGenerate: !!btn }
})
await page.waitForTimeout(500)
const authModal = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
    const slider = backdrop?.querySelector('.setting-expiry-slider')
    const marks = slider?.querySelectorAll('.setting-expiry-slider-mark').length || 0
    const current = slider?.querySelector('.setting-expiry-slider-current strong')?.textContent || ''

    return { opened: !!backdrop, hasSlider: !!slider, marks, current }
})
console.log('6 auth key modal:', JSON.stringify(authModal))
// 关闭弹窗
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
    const cancel = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('取消'))
    cancel?.click()
})
await page.waitForTimeout(300)
// 详情操作行 grid(先点选第一个 key)
await page.evaluate(() => {
    document.querySelector('.auth-key-list .auth-key-item')?.click()
})
await page.waitForTimeout(500)
const actionRow = await page.evaluate(() => {
    const row = document.querySelector('.auth-detail .setting-action-row')
    const cs = row ? getComputedStyle(row) : null

    return {
        hasRow: !!row,
        display: cs?.display || '',
        buttons: row ? row.querySelectorAll('button').length : 0,
    }
})
console.log('7 auth action row:', JSON.stringify(actionRow))

await browser.close()
console.log('\ndone')
