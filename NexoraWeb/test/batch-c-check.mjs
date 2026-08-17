// batch-c-check.mjs — Batch C 聚焦验证
// 覆盖:生图完整编辑器 / 地图完整字段+保存 / Ollama 状态点 / 邮箱绑定块 /
//      默认模型分组下拉 / 统计 Top Providers / 市场分页 / 认证键盘导航
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

// 1. 生图 API:完整编辑器字段(点击添加接口进入新增模式)
await openTab('生图 API')
const genImage = await page.evaluate(() => {
    const addBtn = [...document.querySelectorAll('.settings-page-head-actions button')].find((b) => b.textContent.includes('添加接口'))
    addBtn?.click()

    return { addMode: !!addBtn }
})
await page.waitForTimeout(400)
const genImageForm = await page.evaluate(() => {
    const detail = document.querySelector('.settings-modal-shell .admin-user-detail')
    const ids = ['genDetailId', 'genDetailName', 'genDetailKey', 'genDetailBaseUrl', 'genDetailModel', 'genDetailSize', 'genDetailQuality', 'genDetailFormat', 'genDetailTimeout']
    const inputs = ids.map((id) => !!detail?.querySelector(`#${id}`))
    const hasTypeSelect = !!detail?.querySelector('.setting-select')

    return {
        inputs,
        hasTypeSelect,
        hasSave: [...(detail?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('保存')),
        hasCancel: [...(detail?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('取消')),
    }
})
console.log('1 gen-image editor:', JSON.stringify({ ...genImage, ...genImageForm }))

// 2. 地图 API:完整字段 + 保存按钮(遍历两个 provider,检查 baidu 的 auth_mode 下拉)
await openTab('地图 API')
const mapProviders = await page.evaluate(() => {
    return [...document.querySelectorAll('.settings-modal-shell .admin-users-list .admin-user-item')].map((el) => el.textContent.trim()).slice(0, 4)
})
const mapDetails = {}
for (const provider of ['baidu', 'tianditu']) {
    const clicked = await page.evaluate((p) => {
        const item = [...document.querySelectorAll('.settings-modal-shell .admin-users-list .admin-user-item')].find((el) => el.textContent.trim().startsWith(p))
        item?.click()

        return !!item
    }, provider)
    await page.waitForTimeout(400)
    const detail = await page.evaluate(() => {
        const d = document.querySelector('.settings-modal-shell .admin-user-detail')
        const labels = [...(d?.querySelectorAll('label') || [])].map((l) => l.textContent.trim())
        const saveBtns = [...(d?.querySelectorAll('button') || [])].filter((b) => b.textContent.includes('保存配置') || b.textContent.includes('已是默认') || b.textContent.includes('设为默认'))
        const inputs = d?.querySelectorAll('.admin-map-config-grid input').length || 0

        return {
            hasDetail: !!d,
            labels: labels.slice(0, 16),
            inputs,
            actionButtons: saveBtns.length,
            hasMissing: !!d?.querySelector('.admin-map-missing'),
            hasHistory: !!d?.querySelector('.admin-map-history-policy'),
        }
    })
    mapDetails[provider] = { clicked, ...detail }
}
console.log('2 map detail:', JSON.stringify(mapDetails))

// 3. 模型管理:Ollama 状态点 + 默认模型分组(系统设置)
await openTab('模型管理')
const models = await page.evaluate(() => {
    const dots = document.querySelectorAll('.settings-modal-shell .model-status-btn').length
    const providers = [...document.querySelectorAll('.settings-modal-shell .admin-users-list .admin-user-item .admin-user-name')].map((el) => el.textContent.trim())

    return { statusDots: dots, providers: providers.slice(0, 5) }
})
console.log('3 models panel:', JSON.stringify(models))

await openTab('系统设置')
await page.evaluate(() => {
    const module = [...document.querySelectorAll('.settings-modal-shell .admin-system-module-item')].find((el) => el.textContent.includes('默认模型'))
    module?.click()
})
await page.waitForTimeout(800)
const systemModels = await page.evaluate(() => {
    const selects = document.querySelectorAll('.settings-modal-shell .admin-system-form-grid .setting-select')
    const firstSelect = selects[0]

    if (!firstSelect) return { selects: 0 }

    // 打开下拉检查分组标题
    firstSelect.querySelector('button.setting-select-trigger')?.click()

    return { selects: selects.length }
})
await page.waitForTimeout(300)
const groupTitles = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.setting-select-group-title')].map((el) => el.textContent.trim())

    return { count: titles.length, titles: titles.slice(0, 6) }
})
console.log('4 default-model groups:', JSON.stringify({ ...systemModels, ...groupTitles }))
// 关闭下拉(点击触发器切换,不能按 Escape——那会关闭整个设置弹窗)
await page.evaluate(() => {
    document.querySelector('.settings-modal-shell .admin-system-form-grid .setting-select button.setting-select-trigger')?.click()
})
await page.waitForTimeout(200)

// 5. 统计:Top Providers/Models 块
await openTab('统计信息')
const statsTop = await page.evaluate(() => {
    const userCard = [...document.querySelectorAll('.settings-modal-shell .admin-token-trend-card')].find((el) => el.textContent.includes('单用户 Token 查询'))
    const input = userCard?.querySelector('.admin-user-token-selector input')
    input?.focus()
    const menuItems = [...(userCard?.querySelectorAll('.admin-user-token-menu button') || [])].map((b) => b.textContent.trim())

    return {
        hasQueryCard: !!userCard,
        menuItems: menuItems.slice(0, 4),
    }
})
console.log('5 stats user selector:', JSON.stringify(statsTop))

// 执行一次用户查询验证 Top 块出现
await page.evaluate(() => {
    const userCard = [...document.querySelectorAll('.settings-modal-shell .admin-token-trend-card')].find((el) => el.textContent.includes('单用户 Token 查询'))
    const input = userCard?.querySelector('.admin-user-token-selector input')
    if (input) {
        input.value = 'test_user'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const queryBtn = [...(userCard?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('查询'))
    queryBtn?.click()
})
await page.waitForTimeout(1500)
const topBlocks = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.admin-user-token-top-block')].map((el) => ({
        title: el.querySelector('.admin-user-token-top-title')?.textContent || '',
        rows: el.querySelectorAll('.admin-user-token-top-row').length,
    }))

    return blocks
})
console.log('6 stats top blocks:', JSON.stringify(topBlocks))

// 7. 认证管理:键盘导航
await openTab('认证管理')
const authKb = await page.evaluate(() => {
    const ownerInput = document.querySelector('.settings-modal-shell .admin-user-detail .admin-user-token-selector input')
    ownerInput?.focus()
    document.querySelector('.settings-modal-shell .admin-user-detail .admin-user-token-selector input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    document.querySelector('.settings-modal-shell .admin-user-detail .admin-user-token-selector input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    return {
        hasOwnerInput: !!ownerInput,
        hasCreatedBy: [...document.querySelectorAll('.settings-modal-shell .admin-user-detail .admin-info-text')].some((el) => el.textContent === '-' || el.textContent.length > 0),
    }
})
console.log('7 auth panel:', JSON.stringify(authKb))

// 8. 邮箱管理:绑定块(先种一个邮箱用户确保详情可展示)
await openTab('邮箱管理')
const mailSeed = await page.evaluate(async () => {
    try {
        const groups = await (await fetch('/api/admin/nexora-mail/groups')).json()
        const group = (groups.domains || ['default'])[0] || 'default'
        const check = await (await fetch(`/api/admin/nexora-mail/users?group=${encodeURIComponent(group)}`)).json()
        const hasAny = Array.isArray(check.users) && check.users.length > 0

        if (!hasAny) {
            await fetch('/api/admin/nexora-mail/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group, mail_username: 'zzz_e2e_mail', password: 'zzz_e2e_pwd', permissions: ['receive', 'sendlocal'] }),
            })
        }

        return { group, seeded: !hasAny }
    } catch (error) {
        return { group: '', seeded: false, error: String(error).slice(0, 80) }
    }
})
await page.evaluate(() => {
    const refresh = [...document.querySelectorAll('.settings-modal-shell .settings-management-toolbar button, .settings-modal-shell .admin-users-toolbar button')].find((b) => b.textContent.includes('刷新'))
    refresh?.click()
})
await page.waitForTimeout(800)
const mailList = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.settings-modal-shell .admin-user-item')].map((el) => el.textContent.trim())
    const target = items.find((t) => t.includes('zzz_e2e_mail')) ? 'zzz_e2e_mail' : (items[0] || '')

    return { items: items.slice(0, 3), target }
})
if (mailList.target) {
    await page.evaluate((name) => {
        const item = [...document.querySelectorAll('.settings-modal-shell .admin-user-item')].find((el) => el.textContent.trim().includes(name))
        item?.click()
    }, mailList.target)
    await page.waitForTimeout(400)
}
const mailDetail = await page.evaluate(() => {
    const detail = document.querySelector('.settings-modal-shell .admin-user-detail')

    return {
        hasDetail: !!detail,
        hasBindPair: !!detail?.querySelector('.admin-bind-pair'),
        hasBindRow: !!detail?.querySelector('.admin-mail-bind-row'),
        hasBindInput: !!detail?.querySelector('.admin-mail-bind-row input'),
        hasBindButton: [...(detail?.querySelectorAll('button') || [])].some((b) => b.textContent.trim() === '绑定' || b.textContent.trim() === '重新绑定'),
        hasReset: [...(detail?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('重置密码')),
        hasDelete: [...(detail?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('删除用户')),
    }
})
console.log('8 mail bind:', JSON.stringify({ seed: mailSeed, list: mailList, ...mailDetail }))

// 9. Skill 市场分页
await openTab('Skill')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-modal-shell .skill-subtab')].find((b) => b.textContent.includes('Skill 市场'))
    btn?.click()
})
await page.waitForTimeout(1200)
const pagination = await page.evaluate(() => {
    const pager = document.querySelector('.settings-modal-shell .skill-market-pagination')

    return {
        hasPager: !!pager,
        pageInfo: pager?.querySelector('.skill-market-page-info')?.textContent || '',
        hasPrev: !!pager?.querySelector('button'),
    }
})
console.log('9 market pagination:', JSON.stringify(pagination))

await browser.close()
console.log('\ndone')
