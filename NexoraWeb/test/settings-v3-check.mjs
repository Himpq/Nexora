// settings-v3-check.mjs — 设置 V3(GDDP 深度集成)回归
// 验证:
//   1. 页头 subtabs(Skill 胶囊子标签)+ 条件按钮(上传/新建仅"我的 Skill"可见)
//   2. 面板内 toolbar 全部移除(auth-toolbar/mail-toolbar/设置壳 settings-management-toolbar)
//   3. 认证管理所属用户 = SettingSelect(search),菜单内滚动不关闭
//   4. 偏好设置记忆更新模型 = SettingModelSelect 下拉(非 chips)
//   5. Skill 统一完整编辑器(个人/全局管理员同入口;无阉割版第二弹窗)
//   6. settings-page-body 无 padding-top
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

await page.click('#usernameBtn')
await page.waitForTimeout(300)
await page.evaluate(() => {
    const items = [...document.querySelectorAll('#userMenu .menu-item')]
    const target = items.find((el) => el.textContent.includes('设置'))
    target?.click()
})
await page.waitForTimeout(1200)

let passed = 0
let failed = 0

function report(name, ok, detail = '') {
    if (ok) {
        passed += 1
        console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`)
    } else {
        failed += 1
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    }
}

async function openTab(label) {
    await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('.settings-modal-shell .settings-nav-item')].find((b) => b.textContent.trim() === t)
        btn?.click()
    }, label)
    await page.waitForTimeout(900)
}

// ============ 1. settings-page-body 无 padding-top ============
console.log('\n[1] settings-page-body padding')
const bodyPadding = await page.evaluate(() => {
    const body = document.querySelector('.settings-modal-shell .settings-page-body')

    if (!body) return { found: false }

    const cs = getComputedStyle(body)

    return { found: true, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft, paddingBottom: cs.paddingBottom }
})
report('page-body 无 padding-top', bodyPadding.found && bodyPadding.paddingTop === '0px', JSON.stringify(bodyPadding))

// ============ 2. Skill 页头 subtabs + 条件按钮 ============
console.log('\n[2] Skill 页头 subtabs + 条件按钮')
await openTab('Skill')
const skillHeadMy = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.settings-page-head-tabs .settings-page-head-tab')]
    const actions = [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => b.textContent.trim())
    const bodyTabs = document.querySelectorAll('.skill-subtabs-row, .skill-subtabs, .skill-my-toolbar').length
    const active = tabs.find((t) => t.classList.contains('active'))?.textContent.trim()

    return {
        tabCount: tabs.length,
        tabLabels: tabs.map((t) => t.textContent.trim()),
        activeTab: active || '',
        actions,
        legacyToolbarNodes: bodyTabs,
    }
})
report('subtabs 两个胶囊', skillHeadMy.tabCount === 2, JSON.stringify(skillHeadMy.tabLabels))
report('默认激活"我的 Skill"', skillHeadMy.activeTab.includes('我的 Skill'))
report('my 下显示上传/新建', skillHeadMy.actions.some((a) => a.includes('上传 Skill')) && skillHeadMy.actions.some((a) => a.includes('新建 Skill')), JSON.stringify(skillHeadMy.actions))
report('面板内旧 subtabs/toolbar DOM 已删', skillHeadMy.legacyToolbarNodes === 0)

// 切到 Skill 市场(先经 API 播种一个市场 Skill,空市场无法验证列表渲染)
await page.evaluate(async () => {
    await fetch('/api/skills/market/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: {
            id: 'zzz-v3-skill',
            title: 'zzz_v3_market_skill',
            description: 'v3 回归播种 Skill',
            tags: [],
            required_tools: [],
            mode: 'auto',
            main_content: 'v3 market seed content',
            version: '1.0.0',
        } }),
    })
})
await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-page-head-tabs .settings-page-head-tab')].find((t) => t.textContent.includes('市场'))
    tab?.click()
})
await page.waitForTimeout(1500)
const skillHeadMarket = await page.evaluate(() => {
    const actionBtns = [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => ({
        text: b.textContent.trim(),
        visibility: getComputedStyle(b).visibility,
        offsetWidth: b.offsetWidth,
    }))
    const active = [...document.querySelectorAll('.settings-page-head-tabs .settings-page-head-tab')].find((t) => t.classList.contains('active'))?.textContent.trim()
    const marketList = document.querySelectorAll('#skillMarketList .skill-market-card').length
    const sortSelect = document.querySelectorAll('.skill-market-toolbar .setting-select').length
    const legacySort = document.querySelectorAll('.skill-market-sort-wrap, .skill-market-sort-menu').length

    return { active: active || '', actionBtns, marketCards: marketList, sortSelect, legacySort }
})
report('市场 subtab 激活', skillHeadMarket.active.includes('市场'))

// 页头按钮改为 is-hidden(visibility:hidden 保留占位):切换 subtab 时 tabs 不因按钮增删而跳动
const hiddenUpload = skillHeadMarket.actionBtns.find((b) => b.text.includes('上传 Skill'))
const hiddenCreate = skillHeadMarket.actionBtns.find((b) => b.text.includes('新建 Skill'))
report(
    '市场下上传/新建不可见但占位(tabs 不跳)',
    !!hiddenUpload && !!hiddenCreate
        && hiddenUpload.visibility === 'hidden' && hiddenUpload.offsetWidth > 0
        && hiddenCreate.visibility === 'hidden' && hiddenCreate.offsetWidth > 0,
    JSON.stringify(skillHeadMarket.actionBtns)
)
report('市场列表渲染', skillHeadMarket.marketCards > 0, `cards=${skillHeadMarket.marketCards}`)
report('排序为 SettingSelect 且旧自建下拉已删', skillHeadMarket.sortSelect >= 1 && skillHeadMarket.legacySort === 0)

// 切回我的 Skill → 按钮恢复
await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-page-head-tabs .settings-page-head-tab')].find((t) => t.textContent.includes('我的'))
    tab?.click()
})
await page.waitForTimeout(800)
const skillBackMy = await page.evaluate(() => {
    return [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => ({
        text: b.textContent.trim(),
        visibility: getComputedStyle(b).visibility,
    }))
})
report(
    '切回 my 按钮恢复可见',
    skillBackMy.some((a) => a.text.includes('新建 Skill') && a.visibility !== 'hidden'),
    JSON.stringify(skillBackMy)
)

// ============ 3. Skill 统一完整编辑器 ============
console.log('\n[3] Skill 统一完整编辑器')
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.settings-page-head-actions button')].find((b) => b.textContent.includes('新建 Skill'))
    btn?.click()
})
await page.waitForTimeout(600)
const editorModal = await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
    const globalLegacy = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#globalSkillEditorContent'))

    return {
        open: !!backdrop,
        fields: backdrop ? {
            title: !!backdrop.querySelector('#psEditorTitle'),
            id: !!backdrop.querySelector('#psEditorId'),
            desc: !!backdrop.querySelector('#psEditorDesc'),
            tags: !!backdrop.querySelector('#psEditorTags'),
            tools: !!backdrop.querySelector('#psEditorTools'),
            content: !!backdrop.querySelector('#psEditorContent'),
            modeSelect: !!backdrop.querySelector('.setting-select'),
        } : null,
        isLg: backdrop ? backdrop.querySelector('.g-modal.g-modal-lg, .g-modal-lg') !== null || !!backdrop.closest('.g-modal-lg') : false,
        legacyGlobalEditor: !!globalLegacy,
    }
})
report('编辑器打开', editorModal.open)
report('完整字段(标题/ID/描述/标签/工具/模式/内容)', editorModal.fields && Object.values(editorModal.fields).every(Boolean), JSON.stringify(editorModal.fields))
report('阉割版全局编辑器已删', !editorModal.legacyGlobalEditor)

// 经"取消"按钮关闭编辑器(Escape 可能冒泡关掉整个设置壳)
await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
    const cancel = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('取消'))
    cancel?.click()
})
await page.waitForTimeout(500)
const settingsStillOpen = await page.evaluate(() => !!document.querySelector('.settings-modal-shell'))
report('关闭编辑器后设置壳仍在', settingsStillOpen)

// 3b. 管理员点全局 Skill 卡片 → 同一完整编辑器(统一入口,仅回填不保存)
const globalCard = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.settings-skill-card')].find((el) => el.getAttribute('data-skill-origin') === 'global')
    card?.querySelector('.settings-skill-main')?.click()

    return !!card
})
await page.waitForTimeout(600)
if (globalCard) {
    const globalEditor = await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
        const title = backdrop?.querySelector('#psEditorTitle')?.value || ''
        const content = backdrop?.querySelector('#psEditorContent')?.value || ''
        const publishBtn = [...(backdrop?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('发布到市场'))

        return { opened: !!backdrop, prefilledTitle: title.slice(0, 20), hasContent: content.length > 0, publishHidden: !publishBtn }
    })
    report('全局 Skill 打开统一完整编辑器', globalEditor.opened && globalEditor.hasContent, `title=${globalEditor.prefilledTitle}`)
    report('全局编辑隐藏发布按钮', globalEditor.publishHidden)

    await page.evaluate(() => {
        const backdrop = [...document.querySelectorAll('.g-modal-backdrop')].find((el) => el.querySelector('#psEditorTitle'))
        const cancel = [...(backdrop?.querySelectorAll('button') || [])].find((b) => b.textContent.includes('取消'))
        cancel?.click()
    })
    await page.waitForTimeout(400)
} else {
    console.log('  SKIP 全局 Skill 卡片不存在(环境无全局 Skill)')
}

// ============ 4. 认证管理 ============
console.log('\n[4] 认证管理')
await openTab('认证管理')
const authPanel = await page.evaluate(() => {
    const legacyToolbar = document.querySelectorAll('.auth-toolbar, .auth-filter-input, .auth-owner-menu, .auth-owner-item').length
    const headInputs = document.querySelectorAll('.settings-page-head-actions input').length
    const headButtons = [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => b.textContent.trim())
    const keyItems = document.querySelectorAll('.auth-key-list .auth-key-item').length

    return { legacyToolbar, headInputs, headButtons, keyItems }
})
report('面板内 auth-toolbar/owner-menu 已删', authPanel.legacyToolbar === 0)
report('页头有筛选输入', authPanel.headInputs >= 1)
report('页头有生成/刷新按钮', authPanel.headButtons.some((b) => b.includes('生成')) && authPanel.headButtons.some((b) => b.includes('刷新')), JSON.stringify(authPanel.headButtons))
report('Key 列表渲染', authPanel.keyItems > 0, `keys=${authPanel.keyItems}`)

// 选中第一个 key → 所属用户 SettingSelect(search)
await page.evaluate(() => {
    document.querySelector('.auth-key-list .auth-key-item')?.click()
})
await page.waitForTimeout(600)
const ownerSelect = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.auth-detail .setting-select-trigger')]
    const ownerGroup = triggers.map((t) => t.closest('.form-group')).find((g) => g?.textContent.includes('所属用户'))

    return {
        triggerCount: triggers.length,
        hasOwnerSelect: !!ownerGroup,
        label: ownerGroup?.querySelector('.setting-select-label')?.textContent || '',
    }
})
report('所属用户 = SettingSelect', ownerSelect.hasOwnerSelect, `label=${ownerSelect.label}`)

// 打开 owner 下拉 → 菜单内有搜索框;菜单内滚动不关闭
const ownerMenu = await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.auth-detail .setting-select-trigger')]
    const ownerTrigger = triggers.map((t) => t.closest('.form-group')).find((g) => g?.textContent.includes('所属用户'))?.querySelector('.setting-select-trigger')
    ownerTrigger?.click()

    return !!ownerTrigger
})
await page.waitForTimeout(400)
const ownerMenuState = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('.setting-select-menu.open')]
    const ownerMenu = menu.find((m) => m.querySelector('.setting-select-search'))

    if (!ownerMenu) return { open: false }

    // 菜单内滚动(模拟长列表滚动条拖动):scroll 事件 target 在菜单 DOM 子树内,不应关闭
    ownerMenu.querySelector('.setting-select-search input')?.dispatchEvent(new Event('input', { bubbles: true }))
    ownerMenu.dispatchEvent(new Event('scroll', { bubbles: true }))
    ownerMenu.querySelectorAll('button').forEach((b) => b.dispatchEvent(new Event('scroll', { bubbles: true })))

    return {
        open: true,
        hasSearch: !!ownerMenu.querySelector('.setting-select-search input'),
        stillOpenAfterInnerScroll: ownerMenu.classList.contains('open'),
        optionCount: ownerMenu.querySelectorAll('button').length,
        position: getComputedStyle(ownerMenu).position,
    }
})
report('owner 下拉打开 + 搜索框', ownerMenuState.open && ownerMenuState.hasSearch, `options=${ownerMenuState.optionCount || 0}`)
report('菜单内滚动不关闭(scroll 滚动 bug 修复)', ownerMenuState.stillOpenAfterInnerScroll)
report('菜单 fixed 浮层不占父体积', ownerMenuState.position === 'fixed')

// 外部点击关闭
await page.evaluate(() => {
    document.querySelector('.settings-page-head-main')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(300)
const ownerClosed = await page.evaluate(() => {
    return ![...document.querySelectorAll('.setting-select-menu.open')].some((m) => m.querySelector('.setting-select-search'))
})
report('外部点击关闭下拉', ownerClosed)

// ============ 5. 邮箱管理 ============
console.log('\n[5] 邮箱管理')
await openTab('邮箱管理')
await page.waitForTimeout(1500)
const mailPanel = await page.evaluate(() => {
    const legacy = document.querySelectorAll('.mail-toolbar, .mail-group-segment, .mail-group-btn, .mail-add-btn, .mail-filter-input').length
    const headSelects = document.querySelectorAll('.settings-page-head-actions .setting-select').length
    const headInputs = document.querySelectorAll('.settings-page-head-actions input').length
    const headButtons = [...document.querySelectorAll('.settings-page-head-actions button')].map((b) => b.textContent.trim())
    const listItems = document.querySelectorAll('.mail-key-list .mail-list-item').length
    const groupOptions = [...document.querySelectorAll('.settings-page-head-actions .setting-select-menu button')].map((b) => b.textContent.trim())

    return { legacy, headSelects, headInputs, headButtons, listItems, groupOptions }
})
report('面板内 mail-toolbar 已删', mailPanel.legacy === 0)
report('页头有分组下拉+筛选输入', mailPanel.headSelects >= 1 && mailPanel.headInputs >= 1)
report('分组下拉选项已拉取(响应式)', mailPanel.groupOptions.length > 0, JSON.stringify(mailPanel.groupOptions.slice(0, 4)))
report('页头有添加/刷新按钮', mailPanel.headButtons.some((b) => b.includes('添加')) && mailPanel.headButtons.some((b) => b.includes('刷新')), JSON.stringify(mailPanel.headButtons))
report('邮箱列表渲染', mailPanel.listItems > 0, `users=${mailPanel.listItems}`)

// ============ 6. 偏好设置(记忆更新模型 = SettingModelSelect) ============
console.log('\n[6] 偏好设置')
await openTab('偏好设置')
const prefPanel = await page.evaluate(() => {
    const modelField = [...document.querySelectorAll('.form-group, .settings-memory-model-field')].find((g) => g.textContent.includes('记忆更新模型'))
    const modelSelect = modelField?.querySelector('.setting-model-select .setting-select-trigger')
    const legacyChips = document.querySelectorAll('.settings-modal-shell .model-chip, .settings-modal-shell #memoryModelOptions').length

    return {
        found: !!modelField,
        isDropdown: !!modelSelect,
        triggerLabel: modelSelect?.querySelector('.setting-select-label')?.textContent || '',
        legacyChips,
    }
})
report('记忆更新模型 = SettingModelSelect 下拉', prefPanel.found && prefPanel.isDropdown, `label=${prefPanel.triggerLabel}`)
report('无 model-chips/门户容器残留', prefPanel.legacyChips === 0)

// 打开模型下拉验证源版结构(fixed + scroll 层 + 分组)
if (prefPanel.isDropdown) {
    await page.evaluate(() => {
        document.querySelector('.setting-model-select .setting-select-trigger')?.click()
    })
    await page.waitForTimeout(1200)
    const modelMenu = await page.evaluate(() => {
        const menu = document.querySelector('.setting-model-menu.open')

        if (!menu) return { open: false }

        menu.querySelector('.model-options-scroll')?.dispatchEvent(new Event('scroll', { bubbles: true }))

        return {
            open: true,
            hasScrollLayer: !!menu.querySelector('.model-options-scroll'),
            groups: menu.querySelectorAll('.setting-model-group').length,
            stillOpenAfterInnerScroll: menu.classList.contains('open'),
            position: getComputedStyle(menu).position,
        }
    })
    report('模型菜单源版结构(scroll 层+分组)', modelMenu.open && modelMenu.hasScrollLayer && modelMenu.groups > 0, `groups=${modelMenu.groups || 0}`)
    report('模型菜单内滚动不关闭', modelMenu.stillOpenAfterInnerScroll)
    report('模型菜单 fixed 浮层', modelMenu.position === 'fixed')

    // 点击外部关闭模型菜单(避免 Escape 冒泡关掉设置壳)
    await page.evaluate(() => {
        document.querySelector('.settings-page-head-main')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(300)
}

// ============ 7. 通用:设置壳内无 settings-management-toolbar 空壳 ============
console.log('\n[7] 通用布局')
const shellState = await page.evaluate(() => {
    return {
        settingsOpen: !!document.querySelector('.settings-modal-shell'),
        legacyToolbarCount: document.querySelectorAll('.settings-modal-shell .settings-management-toolbar').length,
    }
})
report('设置壳仍打开', shellState.settingsOpen)
report('设置壳内无 settings-management-toolbar 残留', shellState.legacyToolbarCount === 0)

// 清理市场播种 Skill
const cleaned = await page.evaluate(async () => {
    const res = await fetch('/api/skills/market/zzz-v3-skill', { method: 'DELETE' })

    return (await res.json()).success === true
})
report('市场播种 Skill 已清理', cleaned)

await page.keyboard.press('Escape')
await browser.close()
console.log(`\nresult: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
