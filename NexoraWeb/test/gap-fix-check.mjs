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

// 1. 我的 API Key:权限网格 + 自动选中 + 详情有效期
await openTab('我的 API Key')
const userKey = await page.evaluate(() => {
    const perms = [...document.querySelectorAll('.settings-modal-shell .settings-toggle-grid input[type=checkbox]')].length
    const autoSelected = !!document.querySelector('.settings-modal-shell .papi-key-list-item.active')
    const expireSelects = document.querySelectorAll('.settings-modal-shell .settings-toggle-grid + .form-group .setting-select-trigger, .settings-modal-shell .papi-key-list-item.active ~ * .setting-select-trigger').length

    return { permissionCheckboxes: perms, autoSelected, expireSelects }
})
console.log('1 user api keys:', JSON.stringify(userKey))

// 2. 用户管理:保存资料/模型权限按钮 + 自删隐藏(当前用户=自己)
await openTab('用户管理')
const userMgmt = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.settings-modal-shell .papi-action-row button')].map((b) => b.textContent.trim())
    const selfItem = document.querySelector('.settings-modal-shell .admin-user-item.active')
    const isSelfShown = !!selfItem && selfItem.textContent.includes('test_user')

    return { buttons, selfSelected: isSelfShown, hasDeleteForSelf: buttons.includes('删除用户') }
})
console.log('2 user mgmt:', JSON.stringify(userMgmt))

// 打开模型权限弹窗
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .papi-action-row button')].find((b) => b.textContent.includes('模型权限'))
    btn?.click()
})
await page.waitForTimeout(800)
const modelPerm = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('模型权限'))
    const rows = backdrop ? backdrop.querySelectorAll('.model-perm-row').length : 0

    return { opened: !!backdrop, modelRows: rows }
})
console.log('3 model perm modal:', JSON.stringify(modelPerm))
await page.evaluate(() => {
    document.querySelector('.g-modal-backdrop .g-modal-close')?.click()
})
await page.waitForTimeout(400)

// 3. 邮箱管理:分组下拉 + 重置/删除按钮
await openTab('邮箱管理')
const mail = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.settings-modal-shell .settings-management-toolbar .setting-select-trigger')]
    const detailBtns = [...document.querySelectorAll('.settings-modal-shell .papi-action-row button')].map((b) => b.textContent.trim())

    return { toolbarSelects: triggers.length, detailButtons: detailBtns }
})
console.log('4 mail:', JSON.stringify(mail))

// 4. Skill:mode 下拉存在
await openTab('Skill')
const skill = await page.evaluate(() => {
    const items = document.querySelectorAll('.settings-modal-shell .settings-skill-item').length
    const modeSelects = document.querySelectorAll('.settings-modal-shell .settings-skill-item-actions .setting-select-trigger').length

    return { items, modeSelects }
})
console.log('5 skill modes:', JSON.stringify(skill))

// 5. 使用统计:模型使用统计卡片
await openTab('使用统计')
const stats = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.settings-modal-shell .setting-card')].find((c) => c.textContent.includes('模型使用统计'))

    return { hasModelUsageCard: !!card }
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