import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5000'
const usersRaw = fs.readFileSync(path.resolve('..', 'ChatDBServer', 'data', 'user.json'), 'utf-8')
const users = JSON.parse(usersRaw)
const TEST_PWD = users['test_user'].password

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext()
const page = await context.newPage()

// 打开页面(不需要登录,直接测试 DOM 逻辑)
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'test_user')
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)
await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// 在浏览器环境模拟 MarkdownView 的完整流程(marked 已由页面加载)
const result = await page.evaluate(async () => {
    const { marked } = await import('https://cdn.jsdelivr.net/npm/marked@18/marked.min.mjs')
    marked.setOptions({ gfm: true, breaks: true })

    function sanitizeHtml(html) {
        const template = document.createElement('template')
        template.innerHTML = html
        template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove())
        template.content.querySelectorAll('*').forEach((node) => {
            Array.from(node.attributes).forEach((attr) => {
                if (attr.name.startsWith('on')) node.removeAttribute(attr.name)
            })
        })
        return template.innerHTML
    }

    const cases = [
        '你好，**世界**！',
        '**中文加粗**。',
        '价格 $5 和 **加粗**',
    ]

    const out = []
    for (const c of cases) {
        const raw = marked.parse(c)
        const safe = sanitizeHtml(raw)
        out.push({
            input: c,
            raw,
            safe,
            hasStrong: safe.includes('<strong>'),
            strongInRaw: raw.includes('<strong>'),
        })
    }

    return out
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
