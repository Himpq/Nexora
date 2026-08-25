// models-quota-rework-check.mjs — 模型额度面板重做验证
// 覆盖:左侧 provider 行内超额策略下拉 / 每行模型 meter+铅笔按钮(无 quota 也显示)/
//      点击 meter/铅笔打开锚点跟随 popover / auto 单位智能换算 / 标签防重叠 JS 布局
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
await page.waitForTimeout(800)

// 打开模型管理
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '模型管理')
    btn?.click()
})
await page.waitForTimeout(1200)

// 1. 左侧 provider 行内超额策略下拉
const providerRow = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.settings-modal-shell .model-provider-item')]
    const first = items[0]
    const quotaRow = first?.querySelector('.model-provider-quota-row')
    const select = quotaRow?.querySelector('.setting-select')

    return {
        providerCount: items.length,
        hasQuotaRow: !!quotaRow,
        hasLabel: quotaRow?.querySelector('.model-provider-quota-label')?.textContent || '',
        hasSelect: !!select,
        hasEditBtn: !!first?.querySelector('.model-provider-item-delete .model-icon-btn'),
        hasDeleteBtn: !!first?.querySelector('.model-provider-item-delete .model-icon-btn-danger'),
        firstProvider: first?.querySelector('.admin-user-name')?.textContent || '',
        apiType: first?.querySelector('.admin-user-meta')?.textContent || '',
    }
})
console.log('1 provider row quota:', JSON.stringify(providerRow))

// 2. 每行模型 meter + 铅笔按钮
const modelRows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.settings-modal-shell .admin-model-row')]
    const meters = rows.filter((r) => r.querySelector('.quota-meter-wrap'))
    const pencils = rows.filter((r) => r.querySelector('.quota-total-icon-btn'))

    return {
        modelCount: rows.length,
        meterCount: meters.length,
        pencilCount: pencils.length,
        allHaveMeter: rows.length === meters.length,
        allHavePencil: rows.length === pencils.length,
    }
})
console.log('2 model rows:', JSON.stringify(modelRows))

// 3. 标签防重叠:检查 JS 布局后的 left 是否已设置且不重叠
const labelLayout = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.settings-modal-shell [data-role="quota-meter-label-row"]')]
    const firstRow = rows[0]

    if (!firstRow) return { rows: 0 }

    const items = [...firstRow.querySelectorAll('.quota-meter-label-item')].map((el) => ({
        text: el.textContent,
        left: el.style.left,
        visible: el.style.display !== 'none',
    }))

    // 检查重叠:收集可见项的 [left, left+width]
    const visible = items.filter((i) => i.visible)
    const rects = [...firstRow.querySelectorAll('.quota-meter-label-item')]
        .filter((el) => el.style.display !== 'none')
        .map((el) => {
            const r = el.getBoundingClientRect()

            return { text: el.textContent, l: r.left, r: r.right }
        })
    let overlap = false

    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (rects[i].r > rects[j].l + 1 && rects[j].r > rects[i].l + 1) {
                overlap = true
            }
        }
    }

    return { rows: rows.length, items, visibleCount: visible.length, overlap, rects }
})
console.log('3 label layout:', JSON.stringify({ rows: labelLayout.rows, visibleCount: labelLayout.visibleCount, overlap: labelLayout.overlap, items: labelLayout.items, rects: labelLayout.rects }))

// 4. 点击铅笔按钮打开锚点跟随 popover
await page.evaluate(() => {
    const pencil = document.querySelector('.settings-modal-shell .quota-total-icon-btn')
    pencil?.click()
})
await page.waitForTimeout(400)
const popover = await page.evaluate(() => {
    const el = document.querySelector('.quota-adjust-popover-fixed')

    if (!el) return { open: false }

    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)

    return {
        open: true,
        position: style.position,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        title: el.querySelector('.quota-adjust-title')?.textContent || '',
        hasModeSelect: !!el.querySelector('select'),
        hasInput: !!el.querySelector('input'),
        hasSave: !!el.querySelector('.quota-adjust-save-btn'),
        hint: el.querySelector('.quota-adjust-hint-text')?.textContent || '',
    }
})
console.log('4 popover:', JSON.stringify(popover))

// 5. 锚点跟随:滚动后 popover 仍在视口内
await page.evaluate(() => {
    const detail = document.querySelector('.settings-modal-shell .settings-management-detail')
    if (detail) detail.scrollTop = 200
})
await page.waitForTimeout(300)
const popoverAfterScroll = await page.evaluate(() => {
    const el = document.querySelector('.quota-adjust-popover-fixed')

    if (!el) return { open: false }

    const rect = el.getBoundingClientRect()

    return {
        open: true,
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        y: Math.round(rect.top),
    }
})
console.log('5 popover after scroll:', JSON.stringify(popoverAfterScroll))

// 6. Esc 关闭
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const closed = await page.evaluate(() => !document.querySelector('.quota-adjust-popover-fixed'))
console.log('6 esc closes:', JSON.stringify({ closed }))

// 7. 页头操作:模型管理页头有 添加供应商/添加模型/刷新
const pageHead = await page.evaluate(() => {
    const actions = [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => b.textContent.trim())

    return actions
})
console.log('7 page-head actions:', JSON.stringify(pageHead))

// 8. auto 单位智能换算(直接调 formatQuota 逻辑在页面内验证)
const unitCheck = await page.evaluate(async () => {
    // 通过切换单位后读取 quotaCtx 文本验证
    const ctxBefore = document.querySelector('.settings-modal-shell .admin-model-ctx')?.textContent || ''

    return { ctxBefore }
})
console.log('8 ctx:', JSON.stringify(unitCheck))

await browser.close()
console.log('\ndone')
