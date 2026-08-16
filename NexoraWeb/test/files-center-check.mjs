// files-center-check.mjs — 文件中心回归测试
// 验证:sidebar Files → 文件中心视图 → 列表渲染(已有上传文件) → 搜索 → 排序 → 详情预览 → 返回
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

// 1. 打开文件中心(sidebar Files 按钮 id=fileCenterBtn)
const opened = await page.evaluate(() => {
    const btn = document.querySelector('#fileCenterBtn')

    if (!btn) return false

    btn.click()

    return true
})
await page.waitForTimeout(1200)

const view = await page.evaluate(() => {
    const section = document.querySelector('.file-center-view')

    return {
        visible: !!section,
        title: section?.querySelector('h1')?.textContent || null,
        count: section?.querySelector('#fileCenterCount')?.textContent || null,
        cards: document.querySelectorAll('.file-center-card').length,
        hasSearch: !!section?.querySelector('.file-center-search input'),
        hasUpload: !!section?.querySelector('.file-center-upload-btn'),
        firstCard: document.querySelector('.file-center-card .file-center-card-name')?.textContent || null,
    }
})
console.log('1 file center:', JSON.stringify(view))

// 2. 搜索
await page.evaluate(() => {
    const input = document.querySelector('.file-center-search input')
    input.value = 'test_upload'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(1000)

const afterSearch = await page.evaluate(() => {
    return {
        count: document.querySelector('#fileCenterCount')?.textContent || null,
        cards: document.querySelectorAll('.file-center-card').length,
        firstCard: document.querySelector('.file-center-card .file-center-card-name')?.textContent || null,
    }
})
console.log('2 search:', JSON.stringify(afterSearch))

// 清空搜索
await page.evaluate(() => {
    const input = document.querySelector('.file-center-search input')
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await page.waitForTimeout(1000)

// 3. 排序切换
await page.evaluate(() => {
    document.querySelector('.file-center-sort-trigger')?.click()
})
await page.waitForTimeout(300)

const sortMenu = await page.evaluate(() => {
    const menu = document.querySelector('.file-center-sort-menu')

    return {
        visible: !!menu && menu.style.display !== 'none' && !menu.closest('[hidden]'),
        options: menu ? [...menu.querySelectorAll('button')].map((b) => b.textContent) : [],
    }
})
console.log('3 sort menu:', JSON.stringify(sortMenu))

// 4. 双击打开详情(文本预览)
await page.evaluate(() => {
    const card = document.querySelector('.file-center-card')
    card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
})
await page.waitForTimeout(1500)

const detail = await page.evaluate(() => {
    const detailView = document.querySelector('.file-center-detail')

    return {
        visible: !!detailView,
        title: detailView?.querySelector('h1')?.textContent || null,
        hasMeta: !!detailView?.querySelector('.file-center-detail-meta'),
        text: detailView?.querySelector('.file-center-detail-text')?.textContent?.slice(0, 60) || null,
        hasImage: !!detailView?.querySelector('.file-center-detail-image'),
    }
})
console.log('4 detail:', JSON.stringify(detail))

// 5. 返回列表
await page.evaluate(() => {
    document.querySelector('.file-center-detail-head .file-center-tool-btn')?.click()
})
await page.waitForTimeout(600)

const backTo = await page.evaluate(() => {
    return {
        listVisible: !!document.querySelector('.file-center-list'),
        detailGone: !document.querySelector('.file-center-detail'),
    }
})
console.log('5 back to list:', JSON.stringify(backTo))

await browser.close()
