// api-debug-skill.mjs — 直接调后端 skill 接口定位发布失败原因
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage()
const ctx = await browser.newContext()
await page.goto('http://127.0.0.1:5000/login', { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'test_user')
await page.fill('#password', users.test_user.password)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)
await ctx.close()

// 用页面 cookie 直接调用
const result = await page.evaluate(async () => {
    const out = {}

    // 先看个人列表里 zzz-e2e-skill 的完整字段
    const myRes = await fetch('/api/skills/my')
    const myData = await myRes.json()
    out.mySkill = (Array.isArray(myData.skills) ? myData.skills : []).find((s) => String(s.id || '') === 'zzz-e2e-skill') || null

    // 直接发布
    const pubRes = await fetch('/api/skills/market/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            skill: {
                id: 'zzz-e2e-skill',
                title: 'zzz_e2e_skill',
                description: 'e2e 测试 Skill',
                tags: [],
                required_tools: ['web_search'],
                mode: 'auto',
                main_content: '当用户要求执行任务时,按照步骤执行。',
                version: '1.0.0',
            },
        }),
    })
    out.publish = await pubRes.json()

    // 市场读取
    const marketRes = await fetch('/api/skills/market?page=1&page_size=50&sort=installs')
    out.market = await marketRes.json()

    return out
})

console.log('mySkill:', JSON.stringify(result.mySkill, null, 1))
console.log('publish:', JSON.stringify(result.publish, null, 1))
console.log('market:', JSON.stringify({ success: result.market.success, total: result.market.total, skills: (result.market.skills || []).map((s) => s.id) }))

// 清理
await page.evaluate(async () => {
    await fetch('/api/skills/market/zzz-e2e-skill', { method: 'DELETE' })
})

await browser.close()