// avatar-upload-check.mjs — 头像 UI 上传路径回归测试
// 验证:设置 → 上传头像 → 文件选择 → 裁切弹窗 → 应用 → 侧边栏头像更新 + toast
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import zlib from 'node:zlib'

const usersRaw = fs.readFileSync('..\\ChatDBServer\\data\\user.json', 'utf-8')
const users = JSON.parse(usersRaw.replace(/^\uFEFF/, ''))

// 生成测试 PNG(64×64 蓝色,保证测试自包含,不依赖外部文件)
function writeTestPng(path) {
    const w = 64
    const h = 64
    const raw = Buffer.alloc(h * (w * 3 + 1))

    for (let y = 0; y < h; y++) {
        const row = y * (w * 3 + 1)

        raw[row] = 0
        for (let x = 0; x < w; x++) {
            const offset = row + 1 + x * 3

            raw[offset] = 0x20
            raw[offset + 1] = 0x40
            raw[offset + 2] = 0xc0
        }
    }

    // 极简 PNG 编码器(IHDR + IDAT + IEND)

    function chunk(type, data) {
        const len = Buffer.alloc(4)

        len.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
        const crc = Buffer.alloc(4)

        crc.writeUInt32BE(crc32(body) >>> 0)

        return Buffer.concat([len, body, crc])
    }

    const crcTable = (() => {
        const table = []

        for (let n = 0; n < 256; n++) {
            let c = n

            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            }
            table[n] = c
        }

        return table
    })()

    function crc32(buf) {
        let c = 0xffffffff

        for (const byte of buf) {
            c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
        }

        return c ^ 0xffffffff
    }

    const ihdr = Buffer.alloc(13)

    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr[8] = 8
    ihdr[9] = 2

    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ])

    fs.writeFileSync(path, png)
}

const TEST_PNG = 'test/avatar-test.png'

writeTestPng(TEST_PNG)

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

// 1. 打开设置(用户菜单第一项是"模型榜单",点击含"设置"文本的项)
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(800)

const settingsOpen = await page.evaluate(() => !!document.querySelector('.settings-modal-custom'))
console.log('1 settings open:', settingsOpen)

// 2. 点击"上传头像"→ 文件选择框(display:none 但可被 setInputFiles 触发)
await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.settings-profile-head button')]
    const upload = btns.find((b) => b.textContent.includes('上传头像'))
    upload?.click()
})
await page.waitForTimeout(400)

// 3. 注入文件到隐藏 input
await page.setInputFiles('.settings-profile-head input[type=file]', 'test/avatar-test.png')
await page.waitForTimeout(900)

// 4. 裁切弹窗出现
const cropOpen = await page.evaluate(() => {
    const modal = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('裁剪头像'))

    return {
        visible: !!modal,
        hasCanvas: !!modal?.querySelector('.avatar-crop-canvas'),
        hasPreview: !!modal?.querySelector('.avatar-crop-preview'),
        hasRange: !!modal?.querySelector('input[type=range]'),
        scale: modal?.querySelector('input[type=range]')?.value || null,
    }
})
console.log('2 crop modal:', JSON.stringify(cropOpen))

// 5. 缩放滑块拖动
await page.evaluate(() => {
    const range = document.querySelector('.avatar-crop-controls input[type=range]')
    range.value = '1.6'
    range.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(300)

const zoomed = await page.evaluate(() => document.querySelector('.avatar-crop-controls input[type=range]')?.value)
console.log('3 zoomed:', zoomed)

// 6. 点击"应用"→ 上传
await page.evaluate(() => {
    const modal = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.textContent.includes('裁剪头像'))
    const btns = [...modal.querySelectorAll('.g-btn')]
    const apply = btns.find((b) => b.textContent.includes('应用'))
    apply?.click()
})
await page.waitForTimeout(1500)

// 7. 结果:弹窗关闭 + 头像更新
const result = await page.evaluate(() => {
    const sidebarEl = document.querySelector('#sidebar-avatar')
    const sidebarStyle = sidebarEl ? getComputedStyle(sidebarEl) : null
    const settingsImg = document.querySelector('.settings-avatar-panel img')

    return {
        cropClosed: ![...document.querySelectorAll('.g-modal-backdrop')].some((el) => el.textContent.includes('裁剪头像')),
        sidebarHasImage: sidebarEl?.classList.contains('has-image') || false,
        sidebarBg: sidebarStyle?.backgroundImage.slice(0, 50) || null,
        sidebarSize: sidebarEl ? Math.round(sidebarEl.getBoundingClientRect().width) : null,
        settingsImg: settingsImg?.getAttribute('src')?.slice(0, 40) || null,
    }
})
console.log('4 after apply:', JSON.stringify(result))

// 8. 服务端校验:头像文件已更新
const serverAvatar = await page.evaluate(async () => {
    const res = await fetch('/api/user/avatar/test_user')
    const blob = await res.blob()

    return { ok: res.ok, size: blob.size, type: blob.type }
})
console.log('5 server avatar:', JSON.stringify(serverAvatar))

await page.keyboard.press('Escape')
await browser.close()
