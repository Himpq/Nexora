// api-debug-skill2.mjs — 查看运行时 skill 列表字段
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5000/login', { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'test_user')
await page.fill('#password', users.test_user.password)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)

const out = await page.evaluate(async () => {
    // 创建
    const pub = await fetch('/api/skills/my', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            skill: { id: 'zzz-e2e-skill', title: 'zzz_e2e_skill', description: 'e2e 测试 Skill', required_tools: ['web_search'], mode: 'auto', main_content: '内容' },
        }),
    })
    const create = await pub.json()

    const myRes = await fetch('/api/skills/my')
    const myData = await myRes.json()
    const list = Array.isArray(myData.skills) ? myData.skills : []
    const runtime = list.find((s) => String(s.id || '') === 'zzz-e2e-skill') || null

    // 清理
    await fetch('/api/skills/my/zzz-e2e-skill', { method: 'DELETE' })

    return { create: create.success, runtime }
})

console.log('create:', out.create)
console.log('runtime item:', JSON.stringify(out.runtime, null, 1))

await browser.close()