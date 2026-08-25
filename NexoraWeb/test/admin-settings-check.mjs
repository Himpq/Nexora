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
page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 150))
})
await page.goto('http://127.0.0.1:5000/login', { waitUntil: 'domcontentloaded' })
await page.fill('#username', 'test_user')
await page.fill('#password', users.test_user.password)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(1500)
console.log('after login url:', page.url())
await page.goto('http://127.0.0.1:5000/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
console.log('new page url:', page.url())
const hasSidebar = await page.evaluate(() => !!document.querySelector('.sidebar'))
console.log('has sidebar:', hasSidebar)
await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.click('#userMenu .menu-item')
await page.waitForTimeout(800)
const r = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.settings-nav-item')).map((t) => t.textContent.trim()),
    width: document.querySelector('.settings-modal-custom')?.getBoundingClientRect().width,
    height: document.querySelector('.settings-modal-custom')?.getBoundingClientRect().height,
}))
console.log(JSON.stringify(r, null, 2))
await browser.close()
