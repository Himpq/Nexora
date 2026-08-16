// skills-check.mjs — Skill 管理回归测试
// 验证:我的 Skill 列表;新建 → 发布到市场 → 市场列表可见 → 详情弹窗 → 删除清理
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

// 打开设置 → Skill tab
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(800)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === 'Skill')
    btn?.click()
})
await page.waitForTimeout(800)

// 1. 我的 Skill 列表加载
const myList = await page.evaluate(() => {
    const items = document.querySelectorAll('.settings-skill-item').length
    const empty = !!document.querySelector('.settings-skill-empty')

    return { items, empty }
})
console.log('1 my skills list:', JSON.stringify(myList))

// 2. 新建 Skill
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-my-toolbar button')].find((b) => b.textContent.includes('新建 Skill'))
    btn?.click()
})
await page.waitForTimeout(600)

const editorOpened = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.id !== 'settingsModal')
    const title = backdrop?.querySelector('.g-modal-head h3')?.textContent || ''

    return {
        opened: !!backdrop,
        title,
        hasTitle: !!backdrop?.querySelector('#psEditorTitle'),
        hasContent: !!backdrop?.querySelector('#psEditorContent'),
    }
})
console.log('2 editor modal:', JSON.stringify(editorOpened))

await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.id !== 'settingsModal')
    const fill = (id, value) => {
        const input = backdrop?.querySelector(`#${id}`)
        if (!input) return
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    fill('psEditorTitle', 'zzz_e2e_skill')
    fill('psEditorId', 'zzz-e2e-skill')
    fill('psEditorDesc', 'e2e 测试 Skill')
    fill('psEditorTools', 'web_search')
    const area = backdrop?.querySelector('#psEditorContent')
    if (area) {
        area.value = '当用户要求执行任务时,按照步骤执行。'
        area.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('创建'))
    confirm?.click()
})
await page.waitForTimeout(1500)

const created = await page.evaluate(async () => {
    const res = await fetch('/api/skills/my')
    const data = await res.json()
    const list = Array.isArray(data.skills) ? data.skills : []

    return {
        hasSkill: list.some((s) => String(s.id || '') === 'zzz-e2e-skill'),
        listCount: list.length,
    }
})
console.log('3 skill created:', JSON.stringify(created))

// 3. 发布到市场
await page.evaluate(() => {
    const item = [...document.querySelectorAll('.settings-modal-shell .settings-skill-item')].find((el) => el.textContent.includes('zzz_e2e_skill'))
    const btn = [...(item?.querySelectorAll('button') || [])].find((b) => b.title === '发布到市场' || b.textContent.includes('发布'))
    btn?.click()
})
await page.waitForTimeout(600)

const confirmState = await page.evaluate(() => {
    const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
    const confirmBtn = backdrop?.querySelector('[data-action="confirm"]')

    return {
        modalOpen: !!backdrop,
        confirmText: confirmBtn?.textContent || '',
    }
})
console.log('3b publish confirm:', JSON.stringify(confirmState))

await page.evaluate(() => {
    const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
    backdrop?.querySelector('[data-action="confirm"]')?.click()
})
await page.waitForTimeout(1500)

const toastCheck = await page.evaluate(() => {
    const text = document.body.textContent
    const matches = (text.match(/(Skill 已发布到市场|发布失败[^\n]{0,60}|保存失败[^\n]{0,60})/g) || []).slice(-4)

    return matches
})
console.log('3c toast:', JSON.stringify(toastCheck))

const published = await page.evaluate(async () => {
    const res = await fetch('/api/skills/market?page=1&page_size=50&sort=installs')
    const data = await res.json()
    const list = Array.isArray(data.skills) ? data.skills : []

    return {
        inMarket: list.some((s) => String(s.id || '') === 'zzz-e2e-skill'),
        total: data.total || 0,
    }
})
console.log('4 published to market:', JSON.stringify(published))

// 4. 市场 tab:列表展示
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-subtab')].find((b) => b.textContent.includes('Skill 市场'))
    btn?.click()
})
await page.waitForTimeout(1200)

const marketView = await page.evaluate(() => {
    const cards = document.querySelectorAll('.settings-modal-shell .skill-market-card').length
    const search = !!document.querySelector('.settings-modal-shell .skill-market-search input')
    const sortBtn = !!document.querySelector('.settings-modal-shell .skill-market-sort')

    return { cards, search, sortBtn }
})
console.log('5 market view:', JSON.stringify(marketView))

// 5. 详情弹窗
await page.evaluate(() => {
    const card = [...document.querySelectorAll('.settings-modal-shell .skill-market-card')].find((el) => el.textContent.includes('zzz_e2e_skill'))
    const btn = [...(card?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('详情'))
    btn?.click()
})
await page.waitForTimeout(800)

const detail = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.id !== 'settingsModal' && el.textContent.includes('zzz_e2e_skill'))
    const title = backdrop?.querySelector('.g-modal-head h3')?.textContent || ''
    const content = backdrop?.querySelector('.skill-detail-content')?.textContent?.slice(0, 40) || ''

    return { opened: !!backdrop, title, content }
})
console.log('6 market detail:', JSON.stringify(detail))

// 关闭详情
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.id !== 'settingsModal' && el.textContent.includes('zzz_e2e_skill'))
    const close = backdrop?.querySelector('.g-modal-close')
    if (close) {
        close.click()
    } else {
        backdrop?.querySelector('[data-action="cancel"], .btn-cancel')?.click()
    }
})
await page.waitForTimeout(400)

// 6. 从市场安装(自身发布的也可安装)
await page.evaluate(() => {
    const card = [...document.querySelectorAll('.settings-modal-shell .skill-market-card')].find((el) => el.textContent.includes('zzz_e2e_skill'))
    const btn = [...(card?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('安装'))
    btn?.click()
})
await page.waitForTimeout(1500)

const installed = await page.evaluate(async () => {
    const res = await fetch('/api/skills/my')
    const data = await res.json()
    const list = Array.isArray(data.skills) ? data.skills : []

    return {
        hasMarketCopy: list.some((s) => String(s.origin || '') === 'market' && (String(s.origin_id || '') === 'zzz-e2e-skill' || String(s.id || '') === 'zzz-e2e-skill')),
    }
})
console.log('7 installed:', JSON.stringify(installed))

// 清理:删除市场中该 Skill + 个人副本
const cleaned = await page.evaluate(async () => {
    const results = {}

    const delMarket = await fetch('/api/skills/market/zzz-e2e-skill', { method: 'DELETE' })
    results.market = (await delMarket.json()).success === true

    const myRes = await fetch('/api/skills/my')
    const myData = await myRes.json()
    const list = Array.isArray(myData.skills) ? myData.skills : []

    for (const s of list) {
        const sid = String(s.id || '')
        if (sid === 'zzz-e2e-skill' || String(s.origin_id || '') === 'zzz-e2e-skill' || sid.startsWith('zzz')) {
            await fetch(`/api/skills/my/${encodeURIComponent(sid)}`, { method: 'DELETE' })
        }
    }
    results.mine = true

    return results
})
console.log('8 cleaned:', JSON.stringify(cleaned))

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')