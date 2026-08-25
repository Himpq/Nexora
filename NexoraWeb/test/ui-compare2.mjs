/**
 * ui-compare2.mjs — 深度 UI 对比:原版 /chat vs 新版 /new
 *
 * 检查点:
 *   1. sidebar-content 滚动能力(overflow + 会话数)
 *   2. conversation-item hover 时出现什么元素(原版 vs 新版)
 *   3. token-budget-ring(上下文圆环)存在性与尺寸
 *   4. turn-indicator-panel 显示条件
 *   5. 打开会话后 model-badge 渲染
 *   6. 右键菜单结构
 *
 * 运行:node test/ui-compare2.mjs
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5000'

const usersRaw = fs.readFileSync(path.resolve('..', 'ChatDBServer', 'data', 'user.json'), 'utf-8')
const users = JSON.parse(usersRaw)
const TEST_USER = 'test_user'
const TEST_PWD = users[TEST_USER].password

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\HimpqNotebook\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 150)}`))

// 登录
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#username', TEST_USER)
await page.fill('#password', TEST_PWD)
await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#loginBtn'),
])
await page.waitForTimeout(2000)

async function inspectOrigin() {
    console.log('\n===== 原版 /chat =====')
    await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const base = await page.evaluate(() => {
        const sidebarContent = document.querySelector('.sidebar-content')
        const ring = document.getElementById('tokenBudgetRing')
        const turnPanel = document.getElementById('turnIndicatorPanel')
        const convItems = document.querySelectorAll('.conversation-item')
        const css = sidebarContent ? getComputedStyle(sidebarContent) : null

        return {
            convCount: convItems.length,
            sidebarOverflowY: css ? css.overflowY : null,
            sidebarOverflowX: css ? css.overflowX : null,
            sidebarScrollHeight: sidebarContent ? sidebarContent.scrollHeight : 0,
            sidebarClientHeight: sidebarContent ? sidebarContent.clientHeight : 0,
            ringExists: !!ring,
            ringSize: ring ? `${ring.offsetWidth}x${ring.offsetHeight}` : null,
            ringBg: ring ? getComputedStyle(ring).backgroundImage.slice(0, 60) : null,
            turnPanelVisible: turnPanel ? turnPanel.classList.contains('visible') : null,
            turnPanelDisplay: turnPanel ? getComputedStyle(turnPanel).display : null,
        }
    })
    console.log('base:', JSON.stringify(base))

    // hover 第一个会话项
    if (base.convCount > 0) {
        const hoverInfo = await page.evaluate(() => {
            const item = document.querySelector('.conversation-item')
            const rect = item.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2

            return { x, y }
        })
        await page.mouse.move(hoverInfo.x, hoverInfo.y)
        await page.waitForTimeout(400)

        const afterHover = await page.evaluate(() => {
            const item = document.querySelector('.conversation-item')
            const children = Array.from(item.querySelectorAll('*')).map((el) => {
                const cls = el.className

                return typeof cls === 'string' ? cls : ''
            }).filter((c) => c && (c.includes('del') || c.includes('action') || c.includes('btn')))

            const pseudo = getComputedStyle(item, '::after')

            return {
                visibleChildren: children,
                itemBg: getComputedStyle(item).background,
                pseudoContent: pseudo.content,
                titleRight: (item.querySelector('.conversation-item-right') || {}).innerHTML
                    ? item.querySelector('.conversation-item-right').innerHTML.slice(0, 200)
                    : null,
            }
        })
        console.log('hover first item:', JSON.stringify(afterHover))
    }

    // 打开第一个会话,检查消息 + model-badge
    const openInfo = await page.evaluate(() => {
        const item = document.querySelector('.conversation-item')

        if (!item) return null

        const rect = item.getBoundingClientRect()

        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })

    if (openInfo) {
        await page.mouse.click(openInfo.x, openInfo.y)
        await page.waitForTimeout(2500)

        const msgInfo = await page.evaluate(() => {
            const badges = document.querySelectorAll('.model-badge')
            const msgs = document.querySelectorAll('.message')

            return {
                messageCount: msgs.length,
                badgeCount: badges.length,
                badgeSample: badges.length ? badges[0].textContent.slice(0, 80) : null,
            }
        })
        console.log('after open conv:', JSON.stringify(msgInfo))
    }

    // 右键菜单结构
    const ctxMenu = await page.evaluate(() => {
        const menu = document.getElementById('pinContextMenu')

        if (!menu) return null

        return {
            exists: true,
            buttons: Array.from(menu.querySelectorAll('button')).map((b) => b.textContent.trim()),
        }
    })
    console.log('pinContextMenu:', JSON.stringify(ctxMenu))
}

async function inspectNew() {
    console.log('\n===== 新版 /new =====')
    await page.goto(`${BASE}/new`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const base = await page.evaluate(() => {
        const sidebarContent = document.querySelector('.sidebar-content')
        const ring = document.getElementById('tokenBudgetRing')
        const turnPanel = document.getElementById('turnIndicatorPanel')
        const convItems = document.querySelectorAll('.conversation-item')
        const css = sidebarContent ? getComputedStyle(sidebarContent) : null

        return {
            convCount: convItems.length,
            sidebarOverflowY: css ? css.overflowY : null,
            sidebarOverflowX: css ? css.overflowX : null,
            sidebarScrollHeight: sidebarContent ? sidebarContent.scrollHeight : 0,
            sidebarClientHeight: sidebarContent ? sidebarContent.clientHeight : 0,
            ringExists: !!ring,
            ringSize: ring ? `${ring.offsetWidth}x${ring.offsetHeight}` : null,
            ringBg: ring ? getComputedStyle(ring).backgroundImage.slice(0, 60) : null,
            turnPanelVisible: turnPanel ? turnPanel.classList.contains('visible') : null,
            turnPanelDisplay: turnPanel ? getComputedStyle(turnPanel).display : null,
        }
    })
    console.log('base:', JSON.stringify(base))

    // hover 第一个会话项
    if (base.convCount > 0) {
        const hoverInfo = await page.evaluate(() => {
            const item = document.querySelector('.conversation-item')
            const rect = item.getBoundingClientRect()

            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })
        await page.mouse.move(hoverInfo.x, hoverInfo.y)
        await page.waitForTimeout(400)

        const afterHover = await page.evaluate(() => {
            const item = document.querySelector('.conversation-item')
            const children = Array.from(item.querySelectorAll('*')).map((el) => {
                const cls = el.className

                return typeof cls === 'string' ? cls : ''
            }).filter((c) => c && (c.includes('del') || c.includes('action') || c.includes('btn')))

            return {
                visibleChildren: children,
                itemBg: getComputedStyle(item).background,
                titleRight: (item.querySelector('.conversation-item-right') || {}).innerHTML
                    ? item.querySelector('.conversation-item-right').innerHTML.slice(0, 200)
                    : null,
            }
        })
        console.log('hover first item:', JSON.stringify(afterHover))
    }

    // 打开第一个会话
    const openInfo = await page.evaluate(() => {
        const item = document.querySelector('.conversation-item')

        if (!item) return null

        const rect = item.getBoundingClientRect()

        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })

    if (openInfo) {
        await page.mouse.click(openInfo.x, openInfo.y)
        await page.waitForTimeout(2500)

        const msgInfo = await page.evaluate(() => {
            const badges = document.querySelectorAll('.model-badge')
            const msgs = document.querySelectorAll('.message')

            return {
                messageCount: msgs.length,
                badgeCount: badges.length,
                badgeSample: badges.length ? badges[0].textContent.slice(0, 80) : null,
            }
        })
        console.log('after open conv:', JSON.stringify(msgInfo))
    }

    // 右键菜单结构
    const ctxMenu = await page.evaluate(() => {
        const menu = document.getElementById('pinContextMenu')

        if (!menu) return null

        return {
            exists: true,
            buttons: Array.from(menu.querySelectorAll('button')).map((b) => b.textContent.trim()),
        }
    })
    console.log('pinContextMenu:', JSON.stringify(ctxMenu))
}

await inspectOrigin()
await inspectNew()

await browser.close()
console.log('\ndone')
