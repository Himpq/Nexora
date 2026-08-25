// settings-shoot.mjs — 设置面板各 tab 截图(现状/修复后对比)
// 每个 shot 独立确保设置弹窗打开,避免 Escape 关闭后失效
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const OUT = 'F:/Code/AI/ChatDB/Rubbish/shots'
fs.mkdirSync(OUT, { recursive: true })

const usersRaw = fs.readFileSync('F:\\Code\\AI\\ChatDB\\ChatDBServer\\data\\user.json', 'utf-8')
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

/** 确保设置弹窗打开(可能被 Escape 关闭) */
async function ensureSettings() {
    const open = await page.evaluate(() => !!document.querySelector('.settings-modal-shell'))

    if (!open) {
        await page.click('#usernameBtn')
        await page.waitForTimeout(300)
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('#userMenu .menu-item')]
            const target = items.find((el) => el.textContent.includes('设置'))
            target?.click()
        })
        await page.waitForTimeout(1200)
    }
}

/** 切 tab 并截图 */
async function shot(tabName, fileName, extra = '') {
    await ensureSettings()
    await page.evaluate((tab) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === tab)
        btn?.click()
    }, tabName)
    await page.waitForTimeout(900)
    if (extra) {
        await page.evaluate(extra)
        await page.waitForTimeout(600)
    }
    await page.screenshot({ path: `${OUT}/${fileName}.png` })
    console.log('shot:', fileName)
}

await shot('Skill', 'skills-list')

// 全局 skill 编辑弹窗(ellipsis 按钮)
await ensureSettings()
await page.evaluate(() => {
    const card = document.querySelector('.settings-skill-card')
    const dots = card?.querySelector('.btn-skill-small[title*="编辑全局"]')
    dots?.click()
})
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/skills-editor-global.png` })
console.log('shot: skills-editor-global')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// 新建 skill 弹窗(自建编辑器,非 g-modal-backdrop 兼容路径也拍一下)
await ensureSettings()
await page.evaluate(() => {
    ;[...document.querySelectorAll('.skill-my-toolbar button')].find((b) => b.textContent.includes('新建'))?.click()
})
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/skills-editor-create.png` })
console.log('shot: skills-editor-create')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

await shot('我的 API Key', 'papi-keys-detail')
await shot('偏好设置', 'preferences')
await shot('模型管理', 'admin-models')

// 模型行 quota popover(点击第一个 meter)
await ensureSettings()
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '模型管理')
    btn?.click()
})
await page.waitForTimeout(900)
await page.evaluate(() => {
    const meter = document.querySelector('.quota-meter-wrap')
    meter?.click()
})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/admin-models-quota.png` })
console.log('shot: admin-models-quota')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

await shot('用户管理', 'admin-users')
await shot('统计信息', 'admin-stats')

// 单用户 token 查询菜单
await ensureSettings()
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '统计信息')
    btn?.click()
})
await page.waitForTimeout(900)
await page.evaluate(() => {
    const input = document.querySelector('.admin-user-token-search input, .settings-modal-shell input[placeholder*="User"]')
    if (input) {
        input.focus()
        input.value = 't'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/admin-stats-usermenu.png` })
console.log('shot: admin-stats-usermenu')

await browser.close()
console.log('DONE')
