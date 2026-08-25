// debug-auth-submit.mjs — 捕获认证生成提交后的报错
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 250)))
page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 250))
})

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
    const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === '认证管理')
    btn?.click()
})
await page.waitForTimeout(800)

await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-management-toolbar button')].find((b) => b.textContent.includes('生成'))
    btn?.click()
})
await page.waitForTimeout(600)
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#adminAuthCreateName'))
    const input = backdrop?.querySelector('#adminAuthCreateName')
    if (input) {
        input.value = 'zzz_e2e_auth_key'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('确认'))
    confirm?.click()
})
await page.waitForTimeout(2500)

const state = await page.evaluate(async () => {
    const bodyText = document.body.textContent || ''
    const errorMatch = (bodyText.match(/(生成失败[^\n]{0,80}|操作失败[^\n]{0,80}|重新生成失败[^\n]{0,80}|Failed[^\n]{0,80})/g) || []).slice(-5)

    // 直接调 API 看后端返回
    let apiErr = null
    try {
        const res = await fetch('/api/admin/auth/public-api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'zzz_e2e_api_probe', expire: '7d', scope: 'owner', owner: '' }),
        })
        const data = await res.json()
        if (data.success && data.public_api_key) {
            // 清理
            const keysRes = await fetch('/api/admin/auth/public-api/keys')
            const keysData = await keysRes.json()
            const target = (Array.isArray(keysData.keys) ? keysData.keys : []).find((k) => k.name === 'zzz_e2e_api_probe')
            if (target) await fetch('/api/admin/auth/public-api/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_id: target.id }) })
            apiErr = { ok: true }
        } else {
            apiErr = { ok: false, message: data.message, resStatus: res.status }
        }
    } catch (e) {
        apiErr = { ok: false, error: String(e) }
    }

    return { errorMatch, apiErr }
})

console.log('state:', JSON.stringify(state, null, 1))

// 检查明文弹窗
const plainModal = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('复制你的 Key'))
    return {
        exists: !!backdrop,
        code: backdrop?.querySelector('code')?.textContent?.slice(0, 12) || '',
    }
})
console.log('plain modal:', JSON.stringify(plainModal))

await browser.close()