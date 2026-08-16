// gap-final-check.mjs — 隔离验证剩余新功能(模型权限/统计模型卡/邮件详情)
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

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
await page.waitForTimeout(1500)

async function openTab(label, wait = 1800) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(wait)
}

// 1. 使用统计:模型使用统计卡(单独验证)
await openTab('使用统计')
const stats = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.setting-card')].find((c) => c.textContent.includes('模型使用统计'))
    const rows = card ? card.querySelectorAll('.setting-row').length : 0
    const empty = card ? card.textContent.includes('暂无数据') : false

    return { hasCard: !!card, rows, empty }
})
console.log('1 stats model usage:', JSON.stringify(stats))

// 2. 用户管理:模型权限弹窗(选中非本人用户)
await openTab('用户管理')
await page.evaluate(() => {
    const item = [...document.querySelectorAll('.admin-user-item')].find((el) => el.textContent.includes('mujica'))
    item?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.papi-action-row button')].find((b) => b.textContent.includes('模型权限'))
    btn?.click()
})
await page.waitForTimeout(1500)
const perm = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('为「'))
    return {
        opened: !!backdrop,
        rows: backdrop ? backdrop.querySelectorAll('.model-perm-row').length : 0,
        hasBadges: backdrop ? backdrop.querySelectorAll('.model-perm-badge').length > 0 : false,
    }
})
console.log('2 model perm:', JSON.stringify(perm))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 3. 邮箱管理:种子用户 → 详情按钮 + 分组下拉
await page.evaluate(async () => {
    await fetch('/api/admin/nexora-mail/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail_username: 'gap_mail_v2', password: 'gap_pass_123' }),
    })
})
await openTab('邮箱管理')
const mail = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.settings-management-toolbar .setting-select-trigger')]
    const first = document.querySelector('.admin-user-item')

    return { toolbarSelects: triggers.length, groupLabel: triggers[0]?.textContent?.trim() || '' }
})
await page.waitForTimeout(300)
await page.evaluate(() => {
    const item = [...document.querySelectorAll('.admin-user-item')].find((el) => el.textContent.includes('gap_mail_v2'))
    item?.click()
})
await page.waitForTimeout(500)
const mailDetail = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.papi-action-row button')].map((b) => b.textContent.trim())

    return { detailButtons: btns }
})
console.log('3 mail:', JSON.stringify({ ...mail, ...mailDetail }))

// 清理
await page.evaluate(async () => {
    await fetch('/api/admin/nexora-mail/groups/default/users/gap_mail_v2', { method: 'DELETE' })
})

await page.keyboard.press('Escape')
await browser.close()
console.log('\ndone')