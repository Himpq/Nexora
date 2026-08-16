// workspaces-full-check.mjs — Workspaces 完整回归测试
// 验证:列表 → 新建 → 详情六 tab → 改名 → 添加对话 → 右键置顶 → 添加云端文件 → 新增任务 → 删除清理
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

// 打开 Workspaces
await page.click('#workspacesBtn')
await page.waitForTimeout(1500)

// 1. 列表视图
const listView = await page.evaluate(() => ({
    view: !!document.querySelector('.workspace-projects-view'),
    rows: document.querySelectorAll('.workspace-projects-item').length,
    tabs: [...document.querySelectorAll('.workspace-projects-tab')].map((b) => b.textContent.trim()),
}))
console.log('1 list view:', JSON.stringify(listView))

// 2. 新建 Workspace(GDDP prompt)
await page.click('.workspace-projects-create')
await page.waitForTimeout(500)
await page.evaluate(() => {
    const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
    const input = backdrop?.querySelector('[data-input]')
    if (input) {
        input.value = 'zzz_e2e_ws'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    backdrop?.querySelector('[data-action="confirm"]')?.click()
})
await page.waitForTimeout(1500)

const created = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/list?include_marks=1')
    const data = await res.json()
    const list = Array.isArray(data.workspaces) ? data.workspaces : []

    return {
        hasWs: list.some((w) => String(w.title || '') === 'zzz_e2e_ws'),
        rows: document.querySelectorAll('.workspace-projects-item').length,
    }
})
console.log('2 created:', JSON.stringify(created))

// 3. 打开详情
await page.evaluate(() => {
    const row = [...document.querySelectorAll('.workspace-projects-item')].find((el) => el.textContent.includes('zzz_e2e_ws'))
    row?.click()
})
await page.waitForTimeout(1500)

const detailView = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.workspace-detail-tab')].map((b) => b.textContent.trim()),
    stats: document.querySelectorAll('.workspace-projects-stat').length,
    editor: !!document.querySelector('.workspace-detail-title-edit-btn'),
    share: !!document.querySelector('.workspace-detail-share-btn'),
    delete: !!document.querySelector('.workspace-detail-delete-btn'),
}))
console.log('3 detail view:', JSON.stringify(detailView))

// 4. 改名
await page.evaluate(() => {
    document.querySelector('.workspace-detail-title-edit-btn')?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => {
    const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
    const input = backdrop?.querySelector('[data-input]')
    if (input) {
        input.value = 'zzz_e2e_ws_renamed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    backdrop?.querySelector('[data-action="confirm"]')?.click()
})
await page.waitForTimeout(1200)
const renamed = await page.evaluate(() => document.querySelector('.workspace-detail-title-text')?.textContent || '')
console.log('4 renamed title:', JSON.stringify(renamed))

// 5. 先创建会话再挂到 Workspace(经 API 种子数据)
const wsId = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/list?include_marks=1')
    const data = await res.json()
    const ws = (Array.isArray(data.workspaces) ? data.workspaces : []).find((w) => String(w.title || '') === 'zzz_e2e_ws_renamed')

    // 创建会话
    const convRes = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const convData = await convRes.json()
    const convId = convData.conversation_id || (convData.conversation && convData.conversation.id) || ''

    if (ws && convId) {
        await fetch(`/api/workspace/${ws.workspace_id}/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: convId }),
        })
    }

    return { wsId: ws?.workspace_id || '', convId }
})
console.log('5 seeded conversation:', JSON.stringify(wsId))

// 重新加载详情(切 tab 已缓存;直接刷新详情)
await page.evaluate(() => {
    document.querySelector('.workspace-projects-back')?.click()
})
await page.waitForTimeout(800)
await page.evaluate(() => {
    const row = [...document.querySelectorAll('.workspace-projects-item')].find((el) => el.textContent.includes('zzz_e2e_ws_renamed'))
    row?.click()
})
await page.waitForTimeout(1200)

// 6. 聊天 tab:显示会话
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-detail-tab')].find((b) => b.textContent.trim() === '聊天')
    btn?.click()
})
await page.waitForTimeout(500)

const chatTab = await page.evaluate(() => ({
    rows: document.querySelectorAll('.workspace-detail-conversations .workspace-resource-row').length,
}))
console.log('6 chat tab:', JSON.stringify(chatTab))

// 7. 右键置顶对话
await page.evaluate(() => {
    const row = document.querySelector('.workspace-detail-conversations .workspace-resource-row')
    const rect = row?.getBoundingClientRect()
    row?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: (rect?.left || 0) + 40,
        clientY: (rect?.top || 0) + 8,
    }))
})
await page.waitForTimeout(400)
const menu = await page.evaluate(() => {
    const el = document.querySelector('.workspace-resource-context-menu.active')
    return { visible: !!el, label: el?.querySelector('span')?.textContent || '' }
})
console.log('7 context menu:', JSON.stringify(menu))

await page.evaluate(() => {
    document.querySelector('.workspace-resource-context-menu.active button')?.click()
})
await page.waitForTimeout(1000)
const pinned = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/list?include_marks=1')
    const data = await res.json()
    const list = Array.isArray(data.workspaces) ? data.workspaces : []
    const ws = list.find((w) => String(w.title || '') === 'zzz_e2e_ws_renamed')
    const convs = (ws?.conversation_ids || [])

    return { count: convs.length }
})
console.log('8 pinned (conversation present):', JSON.stringify(pinned))

// 9. 添加云端文件(使用已上传的 attach_e2e_test 文件)
const fileAdded = await page.evaluate(async () => {
    const listRes = await fetch('/api/files/list')
    const listData = await listRes.json()
    const files = Array.isArray(listData.files) ? listData.files : []
    const target = files.find((f) => String(f.name || f.alias || '').includes('attach_e2e_test'))

    if (!target) return { added: false, reason: 'no cloud file' }

    const res = await fetch('/api/workspace/list?include_marks=1')
    const data = await res.json()
    const ws = (Array.isArray(data.workspaces) ? data.workspaces : []).find((w) => String(w.title || '') === 'zzz_e2e_ws_renamed')
    const fileRef = String(target.sandbox_path || target.alias || target.name || '')

    const addRes = await fetch(`/api/workspace/${ws.workspace_id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ref: fileRef }),
    })
    const addData = await addRes.json()

    return { added: addData.success === true, fileRef }
})
console.log('9 add file (API seed):', JSON.stringify(fileAdded))

// 10. 文件 tab UI 显示
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-detail-tab')].find((b) => b.textContent.trim() === '文件')
    btn?.click()
})
await page.waitForTimeout(500)
const filesTab = await page.evaluate(() => ({
    rows: document.querySelectorAll('.workspace-detail-panel:not([style*="display: none"]) .workspace-resource-row, .workspace-detail-panels .workspace-resource-row').length,
    addBtn: [...document.querySelectorAll('.workspace-resource-add')].some((b) => b.textContent.includes('添加云端文件')),
}))
console.log('10 files tab:', JSON.stringify(filesTab))

// 11. 新建任务(tasks tab)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-detail-tab')].find((b) => b.textContent.trim() === '任务')
    btn?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-resource-add')].find((b) => b.textContent.includes('新建任务'))
    btn?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => {
    const backdrop = document.querySelector('#nexora-confirm-root .g-modal-backdrop')
    const input = backdrop?.querySelector('[data-input]')
    if (input) {
        input.value = 'zzz_e2e_task'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    backdrop?.querySelector('[data-action="confirm"]')?.click()
})
await page.waitForTimeout(1200)
const taskCreated = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.workspace-task-row')]
    return { hasTask: rows.some((r) => r.textContent.includes('zzz_e2e_task')), count: rows.length }
})
console.log('11 task created:', JSON.stringify(taskCreated))

// 12. 记忆 tab
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-detail-tab')].find((b) => b.textContent.trim() === '记忆')
    btn?.click()
})
await page.waitForTimeout(400)
const memoryTab = await page.evaluate(() => ({
    panel: !!document.querySelector('.workspace-detail-memory'),
    content: document.querySelector('.workspace-detail-memory-markdown')?.textContent?.slice(0, 30) || '(空)',
}))
console.log('12 memory tab:', JSON.stringify(memoryTab))

// 清理:删除该 Workspace
const cleaned = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/list?include_marks=1')
    const data = await res.json()
    const list = Array.isArray(data.workspaces) ? data.workspaces : []
    const ws = list.find((w) => String(w.title || '') === 'zzz_e2e_ws_renamed')

    if (!ws) return { deleted: false }

    const delRes = await fetch(`/api/workspace/${ws.workspace_id}`, { method: 'DELETE' })

    return { deleted: (await delRes.json()).success === true }
})
console.log('13 cleaned:', JSON.stringify(cleaned))

await browser.close()
console.log('\ndone')