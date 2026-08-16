// admin-crud-check.mjs — 管理员 CRUD 全流程回归测试
// 验证:供应商 增/删,模型 增/删(删除需输入确认文本),生图接口增删,邮箱用户增删
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
await page.waitForTimeout(1000)

/** 找到真正的弹窗 backdrop(排除 settingsModal 自身) */
function findModal(title) {
    return page.evaluate((t) => {
        const backdrops = [...document.querySelectorAll('.g-modal-backdrop')]
        const modal = backdrops.find((el) => el.id !== 'settingsModal' && el.textContent.includes(t))
        return modal ? {
            found: true,
            inputs: [...modal.querySelectorAll('input, select')].map((n) => n.id),
        } : { found: false }
    }, title)
}

/** 在弹窗 backdrop 里填值并点确认按钮 */
async function fillAndSubmit(title, fillers, confirmLabel) {
    await page.evaluate(({ t, f, c }) => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.id !== 'settingsModal' && el.textContent.includes(t))

        if (!backdrop) return

        for (const [id, value] of Object.entries(f)) {
            const input = backdrop.querySelector(`#${id}`)

            if (!input) continue

            input.value = value
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const confirm = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes(c))
        confirm?.click()
    }, { t: title, f: fillers, c: confirmLabel })
    await page.waitForTimeout(1200)
}

/** 用 GDDP showPrompt 完成“确认修改”文本删除 */
async function confirmDeleteViaPrompt() {
    await page.waitForTimeout(400)
    const done = await page.evaluate(() => {
        const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')

        if (!backdrop) return false

        const input = backdrop.querySelector('[data-input]')

        if (input) {
            input.value = '确认修改'
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        backdrop.querySelector('[data-action="confirm"]')?.click()

        return true
    })
    await page.waitForTimeout(1200)

    return done
}

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('#settingsModal .settings-nav .admin-tab')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(800)
}

// ===== 1. 添加模型(模型管理 tab) =====
await openTab('模型管理')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-management-toolbar button')].find((b) => b.textContent.includes('添加模型'))
    btn?.click()
})
await page.waitForTimeout(500)

const modelModal = await findModal('模型 ID')
console.log('1 add model modal:', JSON.stringify(modelModal))

await fillAndSubmit('模型 ID', { adminModelId: 'zzz_e2e_test_model', adminModelCtx: '64000' }, '添加')

const modelSaved = await page.evaluate(async () => {
    const res = await fetch('/api/admin/models/config')
    const data = await res.json()

    return {
        hasModel: !!data.models?.['zzz_e2e_test_model'],
        ctx: data.models?.['zzz_e2e_test_model']?.context_window,
    }
})
console.log('2 model saved:', JSON.stringify(modelSaved))

// ===== 3. 新增供应商 =====
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-management-toolbar button')].find((b) => b.textContent.includes('添加供应商'))
    btn?.click()
})
await page.waitForTimeout(500)

const providerModal = await findModal('供应商名称')
console.log('3 add provider modal:', JSON.stringify(providerModal))

await fillAndSubmit('供应商名称', {
    adminProviderName: 'zzz_e2e_provider',
    adminProviderBaseUrl: 'https://e2e.example.com/v1',
}, '添加')

const providerSaved = await page.evaluate(async () => {
    const res = await fetch('/api/admin/models/config')
    const data = await res.json()

    return {
        hasProvider: !!data.providers?.['zzz_e2e_provider'],
        baseUrl: data.providers?.['zzz_e2e_provider']?.base_url,
    }
})
console.log('4 provider saved:', JSON.stringify(providerSaved))

// ===== 5. 编辑供应商(改 Base URL) =====
await page.evaluate(() => {
    // 选中 zzz_e2e_provider 行,点击“编辑供应商”
    const row = [...document.querySelectorAll('#settingsModal .settings-management-list .admin-user-item')].find((el) => el.textContent.includes('zzz_e2e_provider'))
    row?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .admin-system-toolbar-row button')].find((b) => b.textContent.includes('编辑供应商'))
    btn?.click()
})
await page.waitForTimeout(500)
await fillAndSubmit('供应商名称', { adminProviderBaseUrl: 'https://e2e-updated.example.com/v1' }, '保存')

const providerEdited = await page.evaluate(async () => {
    const res = await fetch('/api/admin/models/config')
    const data = await res.json()

    return {
        baseUrl: data.providers?.['zzz_e2e_provider']?.base_url,
    }
})
console.log('5 provider edited:', JSON.stringify(providerEdited))

// ===== 6. 删除供应商(UI 确认文本) =====
await page.evaluate(() => {
    const row = [...document.querySelectorAll('#settingsModal .settings-management-list .admin-user-item')].find((el) => el.textContent.includes('zzz_e2e_provider'))
    row?.querySelector('.admin-item-delete')?.click()
})
const providerDeletePrompt = await confirmDeleteViaPrompt()

const providerDeleted = await page.evaluate(async () => {
    const res = await fetch('/api/admin/models/config')
    const data = await res.json()

    return {
        hasProvider: !!data.providers?.['zzz_e2e_provider'],
    }
})
console.log('6 provider deleted:', JSON.stringify({ promptShown: providerDeletePrompt, ...providerDeleted }))

// ===== 7. 删除模型(UI 确认文本) =====
await page.evaluate(() => {
    // 选择含测试模型的 provider(LLMFaker),再删行内模型
    const row = [...document.querySelectorAll('#settingsModal .settings-management-list .admin-user-item')].find((el) => el.textContent.includes('LLMFaker'))
    row?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
    const modelRow = [...document.querySelectorAll('#settingsModal .admin-model-row')].find((el) => el.textContent.includes('zzz_e2e_test_model'))
    modelRow?.querySelector('.admin-item-delete')?.click()
})
const modelDeletePrompt = await confirmDeleteViaPrompt()

const modelDeleted = await page.evaluate(async () => {
    const res = await fetch('/api/admin/models/config')
    const data = await res.json()

    return {
        hasModel: !!data.models?.['zzz_e2e_test_model'],
    }
})
console.log('7 model deleted:', JSON.stringify({ promptShown: modelDeletePrompt, ...modelDeleted }))

// ===== 8. 添加生图接口 =====
await openTab('生图 API')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-management-toolbar button')].find((b) => b.textContent.includes('添加接口'))
    btn?.click()
})
await page.waitForTimeout(500)

const genModal = await findModal('添加生图接口')
console.log('8 add gen-image modal:', JSON.stringify(genModal))

await fillAndSubmit('添加生图接口', {
    genApiId: 'zzz_e2e_gen_api',
    genApiModel: 'test-image-model',
}, '添加')

const genSaved = await page.evaluate(async () => {
    const res = await fetch('/api/admin/gen-image/apis')
    const data = await res.json()

    const list = Array.isArray(data.apis) ? data.apis : []
    const target = list.find((a) => a.api_id === 'zzz_e2e_gen_api')

    return {
        hasApi: !!target,
        model: target?.model,
    }
})
console.log('9 gen-image saved:', JSON.stringify(genSaved))

// 生图接口通过后端 delete 清理
const genCleaned = await page.evaluate(async () => {
    const res = await fetch('/api/admin/gen-image/apis/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_id: 'zzz_e2e_gen_api' }),
    })

    return await res.json()
}).then((r) => r.success)
console.log('10 gen-image cleaned:', genCleaned)

// ===== 11. 添加邮箱用户 =====
await openTab('邮箱管理')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#settingsModal .settings-management-toolbar button')].find((b) => b.textContent.includes('添加邮箱用户'))
    btn?.click()
})
await page.waitForTimeout(500)

const mailModal = await findModal('添加邮箱用户')
console.log('11 add mail modal:', JSON.stringify(mailModal))

await fillAndSubmit('添加邮箱用户', {
    mailUserUsername: 'zzz_e2e_mail',
    mailUserPassword: 'e2e_test_pass_123',
}, '创建')

const mailSaved = await page.evaluate(async () => {
    const res = await fetch('/api/admin/nexora-mail/users')
    const data = await res.json()

    return {
        hasUser: (data.users || []).some((u) => u.username === 'zzz_e2e_mail'),
    }
})
console.log('12 mail saved:', JSON.stringify(mailSaved))

// 邮箱用户清理
const mailCleaned = await page.evaluate(async () => {
    const res = await fetch('/api/admin/nexora-mail/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'zzz_e2e_mail' }),
    })

    return (await res.json()).success === true
})
console.log('13 mail cleaned:', mailCleaned)

await page.keyboard.press('Escape')
await browser.close()