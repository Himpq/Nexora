// gap-fix-check.mjs — 本轮补全功能聚焦验证
// 用户Key权限/详情有效期/轮换带expire;用户管理模型权限弹窗/保存资料/自删隐藏;邮箱分组;Skill mode
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

// 0. 种子数据:创建用户 API Key + 邮箱用户
const seeded = await page.evaluate(async () => {
    const out = {}

    const keyRes = await fetch('/api/user/papi-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'gap_test_key', expire: '7d' }),
    })
    out.key = (await keyRes.json()).success === true

    const mailRes = await fetch('/api/admin/nexora-mail/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail_username: 'gap_test_mail', password: 'gap_test_pass_123' }),
    })
    out.mail = (await mailRes.json()).success === true

    return out
})
console.log('0 seeded:', JSON.stringify(seeded))

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(1200)
}

// 1. 我的 API Key:权限网格 + 自动选中 + 详情有效期滑条
await openTab('我的 API Key')
const userKey = await page.evaluate(() => {
    const perms = [...document.querySelectorAll('.settings-modal-shell .settings-toggle-grid input[type=checkbox]')].length
    const autoSelected = !!document.querySelector('.settings-modal-shell .papi-key-list-item.active')
    const expireSlider = document.querySelectorAll('.settings-modal-shell .setting-expiry-slider').length

    return { permissionCheckboxes: perms, autoSelected, expireSlider }
})
console.log('1 user api keys:', JSON.stringify(userKey))

// 2. 用户管理:保存资料/模型权限按钮 + 自删隐藏(当前用户=自己)
await openTab('用户管理')
const userMgmt = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.settings-modal-shell .setting-action-row button')].map((b) => b.textContent.trim())
    const selfItem = document.querySelector('.settings-modal-shell .admin-user-item.active')
    const isSelfShown = !!selfItem && selfItem.textContent.includes('test_user')

    return { buttons, selfSelected: isSelfShown, hasDeleteForSelf: buttons.includes('删除用户') }
})
console.log('2 user mgmt:', JSON.stringify(userMgmt))

// 打开模型权限弹窗(行数据异步拉取,轮询等待渲染;排除设置壳 backdrop 误匹配)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .setting-action-row button')].find((b) => b.textContent.includes('模型权限'))
    btn?.click()
})
await page.waitForFunction(
    () => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
            .filter((el) => !el.querySelector('.settings-modal-shell'))
            .find((el) => el.textContent.includes('模型权限'))

        return backdrop && backdrop.querySelectorAll('.model-perm-row').length > 0
    },
    null,
    { timeout: 4000 }
).catch(() => {})
const modelPerm = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
        .filter((el) => !el.querySelector('.settings-modal-shell'))
        .find((el) => el.textContent.includes('模型权限'))
    const rows = backdrop ? backdrop.querySelectorAll('.model-perm-row').length : 0

    return { opened: !!backdrop, modelRows: rows }
})
console.log('3 model perm modal:', JSON.stringify(modelPerm))
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')]
        .filter((el) => !el.querySelector('.settings-modal-shell'))
        .find((el) => el.textContent.includes('模型权限'))

    backdrop?.querySelector('.g-modal-close')?.click()
})
await page.waitForTimeout(400)

// 3. 邮箱管理:分组下拉(页头) + 点选用户后详情按钮
await openTab('邮箱管理')
await page.evaluate(() => {
    document.querySelector('.settings-modal-shell .mail-list-item')?.click()
})
await page.waitForTimeout(500)
const mail = await page.evaluate(() => {
    const headSelects = document.querySelectorAll('.settings-page-head-actions .setting-select-trigger').length
    const detailBtns = [...document.querySelectorAll('.settings-modal-shell .setting-action-row button')].map((b) => b.textContent.trim())

    return { headSelects, detailButtons: detailBtns }
})
console.log('4 mail:', JSON.stringify(mail))

// 4. Skill:mode 下拉存在
await openTab('Skill')
const skill = await page.evaluate(() => {
    const items = document.querySelectorAll('.settings-modal-shell .settings-skill-card').length
    const modeSelects = document.querySelectorAll('.settings-modal-shell .settings-skill-controls .setting-select-trigger').length

    return { items, modeSelects }
})
console.log('5 skill modes:', JSON.stringify(skill))

// 5. 统计信息(管理员):Token 趋势/单用户查询/工具观测卡片
await openTab('统计信息')
const stats = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-modal-shell .admin-token-trend-card')]

    return {
        trendCards: cards.length,
        labels: cards.map((c) => c.querySelector('.admin-token-trend-head')?.textContent?.trim().slice(0, 20) || ''),
    }
})
console.log('6 stats model usage:', JSON.stringify(stats))

// 清理种子数据
await page.evaluate(async () => {
    const keyRes = await fetch('/api/user/papi-keys')
    const keyData = await keyRes.json()
    for (const key of (keyData.keys || [])) {
        if (key.name === 'gap_test_key') {
            await fetch(`/api/user/papi-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
        }
    }

    const mailRes = await fetch('/api/admin/nexora-mail/users?group=default')
    const mailData = await mailRes.json()
    for (const user of (mailData.users || [])) {
        if (user.username === 'gap_test_mail') {
            await fetch(`/api/admin/nexora-mail/groups/default/users/gap_test_mail`, { method: 'DELETE' })
        }
    }
})
console.log('cleanup done')

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')