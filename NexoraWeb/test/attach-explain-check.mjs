// attach-explain-check.mjs — 附件到输入框 + 解释选中文本 回归测试
// 验证:文件右侧栏附加 → 附件芯片出现/去重/移除;选中文本右键解释 → 输入框填入 解释 <text>
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

// 打开一个有消息的会话
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 1, null, { timeout: 8000 }).catch(() => {})
await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.textContent.includes('测试会话')) || items.find((el) => !el.textContent.includes('新对话')) || items[0]
    target?.click()
})
await page.waitForTimeout(2000)

// 0. 准备云端文件:经 /api/upload 上传一个 txt(异步任务,轮询完成)
const uploadResult = await page.evaluate(async () => {
    const blob = new Blob(['这是一份用于测试云端文件附件的文本内容。'], { type: 'text/plain' })
    const form = new FormData()
    form.append('file', blob, 'attach_e2e_test.txt')
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()

    if (!data.success || !data.task_id) {
        return { ok: false, message: data.message || 'upload failed' }
    }

    // 轮询异步任务直到完成
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500))
        const taskRes = await fetch(`/api/upload/task/${data.task_id}`)
        const task = await taskRes.json()
        const status = task.status || ''

        if (status === 'done' || status === 'completed') {
            return { ok: true }
        }

        if (status === 'error' || task.error) {
            return { ok: false, message: task.error || 'task error' }
        }
    }

    return { ok: false, message: 'task timeout' }
})
console.log('0 upload:', JSON.stringify(uploadResult))

// 1. 附件流程:打开文件右侧栏 → 附加第一个文件
await page.click('#toggleFilePanel')
await page.waitForTimeout(1500)

const fileCount = await page.evaluate(() => document.querySelectorAll('#filePanel .cloud-file-item').length)
console.log('1 files in panel:', fileCount)

if (fileCount > 0) {
    await page.evaluate(() => {
        document.querySelector('#filePanel .cloud-file-item .cloud-file-attach')?.click()
    })
    await page.waitForTimeout(500)

    const chip = await page.evaluate(() => {
        const chips = document.querySelectorAll('.input-attachments .input-attachment-chip')
        const first = chips[0]

        return {
            count: chips.length,
            name: first?.querySelector('.input-attachment-name')?.textContent || '',
        }
    })
    console.log('2 attach chip:', JSON.stringify(chip))

    // 重复附加 → 不新增(该文件已附加)
    await page.evaluate(() => {
        document.querySelector('#filePanel .cloud-file-item .cloud-file-attach')?.click()
    })
    await page.waitForTimeout(500)
    const afterDup = await page.evaluate(() => document.querySelectorAll('.input-attachments .input-attachment-chip').length)
    console.log('3 duplicate attach chip count:', afterDup)

    // 移除附件
    await page.evaluate(() => {
        document.querySelector('.input-attachments .input-attachment-remove')?.click()
    })
    await page.waitForTimeout(400)
    const afterRemove = await page.evaluate(() => document.querySelectorAll('.input-attachments .input-attachment-chip').length)
    console.log('4 after remove chip count:', afterRemove)
}

// 关闭文件侧栏(用面板内关闭按钮,避免被面板遮挡)
await page.click('#filePanel #btnToggleFilePanel, #filePanel .k-actions .btn-icon-small:last-child').catch(() => {})
await page.waitForTimeout(500)

// 2. 解释选中文本:选中最后一条用户消息内容 → 右键 → 解释 → 输入框填入
const hasUserMsg = await page.evaluate(() => !!document.querySelector('.message.user'))
console.log('5 has user message:', hasUserMsg)

if (hasUserMsg) {
    const explained = await page.evaluate(() => {
        const userMsg = document.querySelector('.message.user')
        const contentEl = userMsg?.querySelector('.message-content, .text-content, p, .user-prompt-text') || userMsg

        if (!contentEl) return { selection: false }

        const range = document.createRange()
        range.selectNodeContents(contentEl)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)

        const rect = contentEl.getBoundingClientRect()
        contentEl.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 40,
            clientY: rect.top + 10,
        }))

        return { selection: true, hasRange: (sel?.rangeCount || 0) > 0 }
    })
    console.log('6 selection:', JSON.stringify(explained))

    await page.waitForTimeout(500)

    const menuVisible = await page.evaluate(() => !!document.querySelector('.notes-context-menu.active'))
    console.log('7 context menu visible:', menuVisible)

    if (menuVisible) {
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('.notes-context-menu button')].find((b) => b.textContent.includes('解释'))
            btn?.click()
        })
        await page.waitForTimeout(500)

        const inputValue = await page.evaluate(() => {
            const input = document.querySelector('#messageInput')

            return input ? input.value : ''
        })
        console.log('8 input value:', JSON.stringify(inputValue.slice(0, 60)))
    }
}

await browser.close()
console.log('\ndone')