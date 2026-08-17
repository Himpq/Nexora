// quota-interaction-check.mjs — 模型额度完整交互验证(新结构)
// 单位切换、provider 行内超额策略、种子额度 → 计量条 → 点击铅笔/计量条 → 锚点跟随弹层 → 调整 → 持久化
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
await page.waitForTimeout(1000)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '模型管理')
    btn?.click()
})
await page.waitForTimeout(1200)

// 1. provider 行内超额策略下拉(替代旧额度策略卡)
const quotaRows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.settings-modal-shell .model-provider-quota-row')]
    const providers = rows.map((r) => {
        const item = r.closest('.admin-user-item')
        const name = item?.querySelector('.admin-user-name')?.textContent || ''

        return {
            name,
            hasLabel: r.querySelector('.model-provider-quota-label')?.textContent || '',
            hasSelect: !!r.querySelector('.setting-select-trigger'),
        }
    })

    return { rowCount: rows.length, providers: providers.slice(0, 4) }
})
console.log('1 provider quota rows:', JSON.stringify(quotaRows))

// 2. 单位切换:切到 w,验证模型行 ctx 文案变化
const beforeUnit = await page.evaluate(() => document.querySelector('.settings-modal-shell .admin-model-ctx')?.textContent || '')
await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.settings-modal-shell .setting-select-trigger')]
    const unitTrigger = triggers.find((t) => t.textContent.trim().startsWith('自动'))
    unitTrigger?.click()
})
await page.waitForTimeout(300)
await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.settings-modal-shell .setting-select-menu.open')].find((m) => [...m.querySelectorAll('button')].some((b) => b.textContent.trim() === 'w'))
    const w = [...(menu?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === 'w')
    w?.click()
})
await page.waitForTimeout(300)
const afterUnit = await page.evaluate(() => document.querySelector('.settings-modal-shell .admin-model-ctx')?.textContent || '')
console.log('2 unit switch:', JSON.stringify({ before: beforeUnit, after: afterUnit, changed: beforeUnit !== afterUnit }))

// 3. 种子额度 → 计量条(债务状态)
const seed = await page.evaluate(async () => {
    const modelsRes = await fetch('/api/admin/models/config')
    const modelsData = await modelsRes.json()
    const firstModel = Object.entries(modelsData.models || {})[0]

    if (!firstModel) return { seeded: false }

    const [modelId, info] = firstModel
    const provider = String(info.provider || 'LLMFaker')

    await fetch('/api/admin/quota/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: modelId, op: 'set', total_tokens: 1 }),
    })

    return { seeded: true, provider, model: modelId }
})
console.log('3 seed quota:', JSON.stringify(seed))

// 刷新额度(页头刷新)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-page-head-actions button')].find((b) => b.textContent.includes('刷新'))
    btn?.click()
})
await page.waitForTimeout(1000)

// 选中该 provider,检查计量条
await page.evaluate((p) => {
    const item = [...document.querySelectorAll('.settings-modal-shell .model-provider-item')].find((el) => el.textContent.includes(p))
    item?.click()
}, seed.provider || 'LLMFaker')
await page.waitForTimeout(600)

const meter = await page.evaluate(() => {
    const wraps = document.querySelectorAll('.settings-modal-shell .quota-meter-wrap')
    const first = wraps[0]
    const debtSeg = first?.querySelector('.quota-meter-seg-overage')
    const labels = first ? [...first.querySelectorAll('.quota-meter-label-item')].map((l) => ({ cls: l.className.split(' ')[1] || '', text: l.textContent.trim(), visible: l.style.display !== 'none' })) : []

    return { meterCount: wraps.length, hasDebtSeg: !!debtSeg, labels }
})
console.log('4 meter with debt:', JSON.stringify(meter))

// 5. 点击铅笔按钮 → 锚点跟随弹层 → 改为 1000000
if (meter.meterCount > 0) {
    await page.evaluate(() => {
        document.querySelector('.settings-modal-shell .quota-total-icon-btn')?.click()
    })
    await page.waitForTimeout(400)

    const popover = await page.evaluate(() => {
        const el = document.querySelector('.quota-adjust-popover-fixed')
        const rect = el ? el.getBoundingClientRect() : null

        return {
            open: !!el,
            position: el ? getComputedStyle(el).position : '',
            x: rect ? Math.round(rect.left) : -1,
            y: rect ? Math.round(rect.top) : -1,
            title: el?.querySelector('.quota-adjust-title')?.textContent || '',
            meta: el?.querySelector('.quota-adjust-meta')?.textContent || '',
            hasInput: !!el?.querySelector('input'),
            hasMode: !!el?.querySelector('select'),
        }
    })
    console.log('5 adjust popover:', JSON.stringify(popover))

    // 输入新总量并保存
    await page.evaluate(() => {
        const el = document.querySelector('.quota-adjust-popover-fixed')
        const input = el?.querySelector('input')
        if (input) {
            input.value = '1000000'
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        el?.querySelector('.quota-adjust-save-btn')?.click()
    })
    await page.waitForTimeout(1500)

    const persisted = await page.evaluate(async () => {
        const res = await fetch('/api/admin/quota')
        const data = await res.json()
        const rows = data.quota?.model_status_map || {}
        const target = Object.values(rows).find((r) => r.quota_total_tokens === 1000000)

        return { persisted: !!target, name: target?.name }
    })
    console.log('6 quota persisted:', JSON.stringify(persisted))

    // 清理:设回 1e12
    await page.evaluate(async (p) => {
        await fetch('/api/admin/quota/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: p.provider, model: p.model, op: 'set', total_tokens: 1000000000000 }),
        })
    }, seed)
    console.log('7 cleanup done')
}

await browser.close()
console.log('\ndone')
