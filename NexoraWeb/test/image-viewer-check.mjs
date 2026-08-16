// image-viewer-check.mjs — 图片查看器回归测试
// 验证:附件缩略图渲染 → 点击打开查看器 → 缩放/重置 → Esc 关闭 → 遮罩点击关闭
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

// 准备测试数据:向"测试会话"(12.json)注入图片附件(后端无注入 API,直接写存储文件)
const convPath = '..\\ChatDBServer\\data\\users\\test_user\\conversations\\12.json'
const convData = JSON.parse(fs.readFileSync(convPath, 'utf-8'))

convData.messages = convData.messages || []
convData.messages.unshift({
    role: 'user',
    content: '这是一条带图片附件的测试消息',
    metadata: {
        attachments: [
            { type: 'image', asset_url: '/static/img/Nexora.ico', name: 'test-image-1', size: 1024 },
            { type: 'image_url', asset_url: '/static/img/Nexora.ico', name: 'test-image-2', size: 2048 },
        ],
    },
})
fs.writeFileSync(convPath, JSON.stringify(convData, null, 2), 'utf-8')

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

// 等待会话列表加载完成(最长 8s)
await page.waitForFunction(() => document.querySelectorAll('.conversation-item').length >= 5, null, { timeout: 8000 }).catch(() => {})

// 打开"测试会话"(含注入的图片附件)
const convClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.conversation-item')]
    const target = items.find((el) => el.textContent.includes('测试会话'))

    if (!target) return false

    target.click()

    return true
})
console.log('1 open conv:', convClicked)
await page.waitForTimeout(2000)

// 2. 附件缩略图渲染
const attachments = await page.evaluate(() => {
    return {
        imageCount: document.querySelectorAll('.message-attachment.image').length,
        firstSrc: document.querySelector('.message-attachment.image img')?.getAttribute('src') || null,
        hasZoomCursor: getComputedStyle(document.querySelector('.message-attachment.image')).cursor,
    }
})
console.log('2 attachments:', JSON.stringify(attachments))

// 3. 点击第一张图 → 查看器打开
await page.evaluate(() => {
    document.querySelector('.message-attachment.image')?.click()
})
await page.waitForTimeout(600)

const viewerOpen = await page.evaluate(() => {
    const backdrop = document.querySelector('.image-viewer-backdrop')
    const img = document.querySelector('.image-viewer-image')

    return {
        visible: !!backdrop && getComputedStyle(backdrop).display !== 'none',
        hasImg: !!img,
        imgSrc: img?.getAttribute('src') || null,
        scaleLabel: document.querySelector('.image-viewer-scale')?.textContent || null,
        toolbarBtns: [...document.querySelectorAll('.image-viewer-btn')].map((b) => b.textContent.trim()),
    }
})
console.log('3 viewer open:', JSON.stringify(viewerOpen))

// 4. 放大按钮 → 缩放标签变化
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.image-viewer-btn')].find((b) => b.textContent.trim() === '+')
    btn?.click()
})
await page.waitForTimeout(300)

const afterZoom = await page.evaluate(() => {
    const img = document.querySelector('.image-viewer-image')
    const transform = img ? getComputedStyle(img).transform : ''

    return {
        scaleLabel: document.querySelector('.image-viewer-scale')?.textContent || null,
        transform: transform,
        hasScale: transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)',
    }
})
console.log('4 zoom:', JSON.stringify(afterZoom))

// 5. 重置按钮 → 回到 100%
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.image-viewer-btn')].find((b) => b.textContent.includes('重置'))
    btn?.click()
})
await page.waitForTimeout(300)

const afterReset = await page.evaluate(() => document.querySelector('.image-viewer-scale')?.textContent || null)
console.log('5 reset label:', afterReset)

// 6. Esc 关闭
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

const afterEsc = await page.evaluate(() => !document.querySelector('.image-viewer-backdrop'))
console.log('6 closed by Esc:', afterEsc)

// 7. 再次打开 → 点击遮罩空白关闭
await page.evaluate(() => {
    document.querySelector('.message-attachment.image')?.click()
})
await page.waitForTimeout(500)

await page.mouse.click(20, 20)
await page.waitForTimeout(500)

const afterBackdrop = await page.evaluate(() => !document.querySelector('.image-viewer-backdrop'))
console.log('7 closed by backdrop click:', afterBackdrop)

// 清理测试数据:移除注入的图片附件消息
const cleanedConv = JSON.parse(fs.readFileSync(convPath, 'utf-8'))

cleanedConv.messages = (cleanedConv.messages || []).filter((m) => m.content !== '这是一条带图片附件的测试消息')
fs.writeFileSync(convPath, JSON.stringify(cleanedConv, null, 2), 'utf-8')

await browser.close()

