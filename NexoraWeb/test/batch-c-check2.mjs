// batch-c-check2.mjs — 补充验证:认证详情字段 + 市场分页(需先种数据)
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

async function openTab(label) {
    await page.evaluate((l) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === l)
        btn?.click()
    }, label)
    await page.waitForTimeout(1000)
}

// 1. 认证管理:选中 key 后检查详情字段(生成者/权限/剩余时长)
await openTab('认证管理')
const authDetail = await page.evaluate(() => {
    const first = document.querySelector('.settings-modal-shell .papi-key-list-item')
    first?.click()

    return { hasList: !!first }
})
await page.waitForTimeout(500)
const authFields = await page.evaluate(() => {
    const detail = document.querySelector('.settings-modal-shell .admin-user-detail')
    const grid = detail?.querySelector('.admin-public-api-grid')
    const labels = [...(grid?.querySelectorAll('label') || [])].map((l) => l.textContent.trim())
    const perms = detail?.querySelectorAll('.papi-permission-toggle-row input[type=checkbox]').length || 0

    return {
        hasDetail: !!detail,
        labels,
        perms,
        hasNameInput: !!detail?.querySelector('#adminPublicApiNameInput'),
        hasOwnerInput: !!detail?.querySelector('.admin-user-token-selector input'),
        hasCreatedBy: labels.includes('生成者'),
        hasRemaining: labels.includes('剩余时长'),
        hasLastUsed: labels.includes('最后使用'),
        actionButtons: [...(detail?.querySelectorAll('button') || [])].filter((b) => ['保存设置', '重新生成', '删除 Key'].includes(b.textContent.trim())).length,
    }
})
console.log('1 auth detail:', JSON.stringify({ ...authDetail, ...authFields }))

// 2. 认证筛选:全部用户选项 + 键盘导航
const filterNav = await page.evaluate(() => {
    const filterInput = document.querySelector('.settings-modal-shell .admin-users-toolbar .admin-user-token-selector input')
    filterInput?.focus()
    filterInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    filterInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    const menu = document.querySelector('.settings-modal-shell .admin-users-toolbar .admin-user-token-menu')

    return {
        hasFilter: !!filterInput,
        menuButtons: [...(menu?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()).slice(0, 3),
    }
})
console.log('2 auth filter nav:', JSON.stringify(filterNav))

// 3. 市场分页:先发布一个 Skill 再检查分页条
const seed = await page.evaluate(async () => {
    try {
        await fetch('/api/skills/market/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill: { id: 'zzz-pager-skill', title: 'zzz_pager_skill', description: 'pager test', main_content: 'test', mode: 'auto', version: '1.0.0' } }),
        })
        return { published: true }
    } catch (error) {
        return { published: false, error: String(error).slice(0, 80) }
    }
})

await openTab('Skill')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-subtab')].find((b) => b.textContent.includes('Skill 市场'))
    btn?.click()
})
await page.waitForTimeout(1200)
const pager = await page.evaluate(() => {
    const pagerEl = document.querySelector('.settings-modal-shell .skill-market-pagination')

    return {
        hasPager: !!pagerEl,
        pageInfo: pagerEl?.querySelector('.skill-market-page-info')?.textContent || '',
        hasButtons: pagerEl ? pagerEl.querySelectorAll('button').length : 0,
    }
})
console.log('3 market pager:', JSON.stringify({ seed, ...pager }))

// 清理
await page.evaluate(async () => {
    await fetch('/api/skills/market/zzz-pager-skill', { method: 'DELETE' })
})
await browser.close()
console.log('\ndone')
