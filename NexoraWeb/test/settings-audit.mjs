// settings-audit.mjs — 设置面板真实布局/交互审计
// 检查:横向溢出、元素越界、卡片异常拉伸、重叠、下拉/按钮交互
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
await page.waitForTimeout(1200)

const results = {}

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(900)
}

// 通用溢出检查:页面内是否有元素超出其容器
async function auditOverflow(tabName) {
    const info = await page.evaluate(() => {
        const issues = []
        const shell = document.querySelector('.settings-modal-shell')
        const body = document.querySelector('.settings-page-body')

        if (!body) return { issues: [], ok: true }

        const bodyRect = body.getBoundingClientRect()

        // 直接子元素:检查是否横向溢出 body
        for (const el of body.children) {
            const r = el.getBoundingClientRect()
            if (r.width > bodyRect.width + 2) {
                issues.push({ el: el.className.slice(0, 50), type: 'overflow-x', w: Math.round(r.width), bodyW: Math.round(bodyRect.width) })
            }
        }

        // 关键区域:检测明显重叠(两个兄弟卡片矩形交叉且都有内容)
        const cards = [...body.querySelectorAll('.setting-card, .admin-token-trend-card, .admin-system-section, .admin-system-card')]
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                const a = cards[i].getBoundingClientRect()
                const b = cards[j].getBoundingClientRect()
                const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
                const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
                if (overlapX > 30 && overlapY > 30) {
                    issues.push({ type: 'overlap', a: cards[i].className.slice(0, 30), b: cards[j].className.slice(0, 30) })
                }
            }
        }

        return { issues, ok: issues.length === 0 }
    })
    results[tabName] = { overflow: info }
    console.log(`${tabName} overflow:`, JSON.stringify(info.issues))
}

// 1. 个人资料:检查两卡片是否被拉伸(flex:1 平分高度)
await openTab('个人资料')
const profile = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-modal-shell .setting-card')]
    const bodyRect = document.querySelector('.settings-page-body')?.getBoundingClientRect()

    return {
        cardCount: cards.length,
        cardHeights: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
        bodyHeight: bodyRect ? Math.round(bodyRect.height) : 0,
        // 若两卡各占 ~50% body 高度说明被拉伸
        stretched: cards.length === 2 && cards.every((c) => c.getBoundingClientRect().height > bodyRect.height * 0.4),
    }
})
console.log('profile stretch:', JSON.stringify(profile))
results['个人资料'] = { stretch: profile }

await auditOverflow('个人资料')

// 2. 偏好设置
await openTab('偏好设置')
await auditOverflow('偏好设置')

// 3. Skill
await openTab('Skill')
await auditOverflow('Skill')

// 4. 使用统计
await openTab('使用统计')
await auditOverflow('使用统计')

// 5. 用户管理
await openTab('用户管理')
await auditOverflow('用户管理')

// 6. 认证管理:交互 — 按用户筛选下拉点击后是否真的筛选
await openTab('认证管理')
const authFilter = await page.evaluate(() => {
    const filterInput = document.querySelector('.settings-modal-shell .admin-user-token-selector input')
    if (!filterInput) return { found: false }

    filterInput.focus()
    filterInput.value = ''
    filterInput.dispatchEvent(new Event('input', { bubbles: true }))
    return { found: true }
})
await page.waitForTimeout(300)
const authFilterMenu = await page.evaluate(() => {
    const menu = document.querySelector('.settings-modal-shell .admin-user-token-menu')
    const items = menu ? [...menu.querySelectorAll('button')] : []
    return { menuOpen: !!menu, items: items.map((b) => b.textContent.trim()) }
})
console.log('auth filter menu:', JSON.stringify(authFilterMenu))

// 点击第一个筛选项,验证 ownerFilter 生效
if (authFilterMenu.items.length) {
    await page.evaluate(() => {
        document.querySelector('.settings-modal-shell .admin-user-token-menu button')?.click()
    })
    await page.waitForTimeout(400)
    const afterPick = await page.evaluate(() => {
        const input = document.querySelector('.settings-modal-shell .admin-user-token-selector input')
        return { filterValue: input?.value || '' }
    })
    console.log('auth filter after pick:', JSON.stringify(afterPick))
}

await auditOverflow('认证管理')

// 7. 系统设置
await openTab('系统设置')
await auditOverflow('系统设置')

// 8. 模型管理
await openTab('模型管理')
await auditOverflow('模型管理')

// 9. 生图 API
await openTab('生图 API')
await auditOverflow('生图 API')

// 10. 地图 API
await openTab('地图 API')
await auditOverflow('地图 API')

// 11. 向量库
await openTab('向量库')
await auditOverflow('向量库')

// 12. 邮箱管理
await openTab('邮箱管理')
await auditOverflow('邮箱管理')

await browser.close()
console.log('\ndone')