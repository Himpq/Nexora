// settings-fix-check.mjs — 设置面板修复项回归
// 验证:工具栏按钮非 100% 宽;管理布局撑满高度;统计三栏;模型 icon;认证 生成/重新生成 全流程
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

await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1200)

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(800)
}

// 1. 我的 API Key:工具栏按钮宽度(应 < 300px,非 100%)
await openTab('我的 API Key')
const btnWidth = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.settings-management-toolbar button')]
    const width = buttons.map((b) => Math.round(b.getBoundingClientRect().width))
    const toolbarWidth = Math.round(document.querySelector('.settings-management-toolbar').getBoundingClientRect().width)

    return { buttonWidths: width, toolbarWidth, allNarrow: width.every((w) => w < toolbarWidth * 0.5) }
})
console.log('1 toolbar button widths:', JSON.stringify(btnWidth))

// 2. 用户管理:布局撑满高度(列表高度 ≈ 布局高度,非 fit-content)
await openTab('用户管理')
const layoutHeight = await page.evaluate(() => {
    const layout = document.querySelector('.settings-management-layout')
    const list = document.querySelector('.settings-management-list')
    const detail = document.querySelector('.settings-management-detail')

    if (!layout || !list || !detail) return { found: false }

    const lr = layout.getBoundingClientRect()
    const lir = list.getBoundingClientRect()
    const dr = detail.getBoundingClientRect()

    return {
        found: true,
        layoutH: Math.round(lr.height),
        listH: Math.round(lir.height),
        detailH: Math.round(dr.height),
        listFills: Math.abs(lr.height - lir.height) < 40,
        detailFills: Math.abs(lr.height - dr.height) < 40,
    }
})
console.log('2 layout heights:', JSON.stringify(layoutHeight))

// 3. 使用统计:三栏网格
await openTab('使用统计')
const statsGrid = await page.evaluate(() => {
    const grid = document.querySelector('.settings-stat-summary-grid')
    const cards = document.querySelectorAll('.settings-stat-card')
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns : ''

    return {
        cards: cards.length,
        cols,
        multiCol: cols.split(' ').length >= 2,
        firstValue: cards[0]?.querySelector('.value')?.textContent,
    }
})
console.log('3 stats grid:', JSON.stringify(statsGrid))

// 4. 模型管理:Provider icon 显示
await openTab('模型管理')
const providerIcons = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.settings-management-list .admin-user-item')]
    const icons = items.map((item) => {
        const icon = item.querySelector('.provider-icon')
        const img = icon?.querySelector('img')

        return {
            provider: item.querySelector('.admin-user-name')?.textContent,
            hasIcon: !!icon,
            isImg: !!img,
            fallback: icon && !img ? icon.textContent.trim() : '',
        }
    })

    return { count: items.length, icons: icons.slice(0, 5) }
})
console.log('4 provider icons:', JSON.stringify(providerIcons))

// 5. 认证管理:生成 key 全流程(expire + scope 已修复)
await openTab('认证管理')
const authUI = await page.evaluate(() => {
    const hasGenerate = [...document.querySelectorAll('.settings-management-toolbar button')].some((b) => b.textContent.includes('生成'))
    const hasRegenerate = [...document.querySelectorAll('.papi-action-row button')].some((b) => b.textContent.includes('重新生成'))

    return { hasGenerate, hasRegenerate }
})
console.log('5 auth UI:', JSON.stringify(authUI))

// 生成一个 key
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-management-toolbar button')].find((b) => b.textContent.includes('生成'))
    btn?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => {
    // 用输入框存在性定位真实弹窗(设置壳工具栏也有"生成 Public API Key"文字)
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
    const input = backdrop?.querySelector('#adminAuthCreateName')
    if (input) {
        input.value = 'zzz_e2e_auth_key'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('确认'))
    confirm?.click()
})
await page.waitForTimeout(1800)

const generateResult = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('复制你的 Key'))
    const plain = backdrop?.querySelector('code')?.textContent || ''

    return {
        plainShown: plain.length > 20,
        plainPrefix: plain.slice(0, 8),
    }
})
console.log('6 generate result:', JSON.stringify(generateResult))

// 关闭明文弹窗,吊销清理该 key
if (generateResult.plainShown) {
    await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('复制你的 Key'))
        const done = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('完成'))
        done?.click()
    })
    await page.waitForTimeout(500)
}

const cleaned = await page.evaluate(async () => {
    const res = await fetch('/api/admin/auth/public-api/keys')
    const data = await res.json()
    const keys = Array.isArray(data.keys) ? data.keys : []
    const target = keys.find((k) => k.name === 'zzz_e2e_auth_key')

    if (!target) return { found: false }

    await fetch('/api/admin/auth/public-api/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: target.id }),
    })

    return { found: true, revoked: true }
})
console.log('7 cleaned:', JSON.stringify(cleaned))

// 8. 重新生成流程(先经 API 生成一个 key 作为选中对象)
const regenKey = await page.evaluate(async () => {
    const res = await fetch('/api/admin/auth/public-api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'zzz_e2e_regen_key', expire: '7d', scope: 'owner', owner: 'test_user' }),
    })
    const data = await res.json()
    const keys = Array.isArray(data.auth?.keys) ? data.auth.keys : []

    return keys.find((k) => k.name === 'zzz_e2e_regen_key')?.id || ''
})
console.log('8 regen seed key:', regenKey)

if (regenKey) {
    // 刷新列表并选中
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.settings-management-toolbar button')].find((b) => b.textContent.includes('刷新'))
        btn?.click()
    })
    await page.waitForTimeout(800)
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('.papi-key-list-item')].find((el) => el.textContent.includes('zzz_e2e_regen_key'))
        item?.click()
    })
    await page.waitForTimeout(400)

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.papi-action-row button')].find((b) => b.textContent.includes('重新生成'))
        btn?.click()
    })
    await page.waitForTimeout(500)

    const regenModal = await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
        const input = backdrop?.querySelector('#adminAuthCreateName')

        return {
            opened: !!backdrop,
            prefilled: input?.value || '',
            title: backdrop?.querySelector('.g-modal-head h3')?.textContent || '',
            hasExpire: backdrop ? backdrop.querySelectorAll('.settings-mode-toggle-btn').length : 0,
        }
    })
    console.log('9 regen modal:', JSON.stringify(regenModal))

    // 提交重新生成
    await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
        const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('确认'))
        confirm?.click()
    })
    await page.waitForTimeout(1800)

    const regenResult = await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('复制你的 Key'))
        const plain = backdrop?.querySelector('code')?.textContent || ''

        return { plainShown: plain.length > 20 }
    })
    console.log('10 regen result:', JSON.stringify(regenResult))

    // 清理
    await page.evaluate(async () => {
        const res = await fetch('/api/admin/auth/public-api/keys')
        const data = await res.json()
        const keys = Array.isArray(data.keys) ? data.keys : []
        const target = keys.find((k) => k.name === 'zzz_e2e_regen_key')

        if (target) {
            await fetch('/api/admin/auth/public-api/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key_id: target.id }),
            })
        }
    })
}

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')