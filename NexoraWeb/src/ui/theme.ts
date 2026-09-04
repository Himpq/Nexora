/**
 * theme.ts — 外观主题服务(GDDP 基础模块)
 *
 * 职责:
 *   - 浅色 / 深色 / 跟随系统 三态偏好管理,选择持久化到 localStorage,首次访问跟随系统
 *   - 将解析后的实际主题写到 <html data-theme>,颜色切换由 gddp.css 引入的
 *     tokens-color.css([data-theme="dark"] 令牌覆盖区)响应,本模块不接触具体颜色
 *   - system 态监听 prefers-color-scheme 变化实时跟随
 *   - 代码高亮主题(github 亮色 / github-dark 暗色)与外观联动启停
 *
 * 与 overlay.ts 同为 GDDP 服务层:reactive 响应式单例 + 显式操作函数,
 * 业务组件读取 theme.resolved / theme.preference 渲染,写入一律走 setTheme。
 */

import { computed, reactive } from 'vue'

/** 用户可选择的偏好档位 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 实际渲染的主题档位(system 经媒体查询解析后只剩两种) */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'nexora-theme'

/*
 * 入口页声明的暗色代码高亮 <link> id:
 * 亮色 github.min.css 常开;暗色 github-dark.min.css 默认 disabled,
 * 由本模块按主题联动启停(两套全局规则互斥,不能靠层叠共存)。
 */
const HLJS_DARK_LINK_ID = 'hljs-theme-dark'

/** 校验并读取本地存储的偏好;存储值被外部改动为非法值时视为未设置 */
function readStoredPreference(): ThemePreference {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (isThemePreference(raw)) {
        return raw
    }

    return 'system'
}

/**
 * 外部输入(服务器偏好 / localStorage)的主题档位守卫:
 * 主题的持久化以服务器偏好为权威源,localStorage 仅作启动期缓存,
 * 两处的存量字符串都必须经过本守卫才能进入主题状态。
 */
export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system'
}

function readSystemTheme(): ResolvedTheme {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 主题状态(响应式单例) */
export const theme = reactive({
    /** 用户偏好档位(持久化) */
    preference: readStoredPreference(),
    /** 当前实际渲染的主题 */
    resolved: 'light' as ResolvedTheme,
})

/**
 * 将解析后的主题落到文档:
 * - data-theme 仅在深色时写入,浅色保持无属性(亮色为 CSS 默认语义)
 * - 代码高亮双主题按档位互斥启停
 */
function applyDocument(): void {
    if (theme.resolved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }

    // 入口页(index.html)声明的暗色高亮样式表;该 link 由同一工程的入口模板保证存在
    const hljsDark = document.getElementById(HLJS_DARK_LINK_ID) as HTMLLinkElement | null

    if (hljsDark) {
        hljsDark.disabled = theme.resolved !== 'dark'
    }
}

/**
 * 应用启动初始化:解析初始主题落文档 + 挂系统偏好变化监听。
 * 必须在应用挂载前调用,保证首帧即为目标主题(避免浅色闪屏)。
 */
export function initTheme(): void {
    theme.resolved = theme.preference === 'system' ? readSystemTheme() : theme.preference
    applyDocument()

    // 启动诊断:主题不生效时,先看这行确认偏好来源与解析结果
    console.info(`[theme] preference=${theme.preference} resolved=${theme.resolved} data-theme=${document.documentElement.getAttribute('data-theme') ?? '(none)'}`)

    const media = window.matchMedia('(prefers-color-scheme: dark)')

    media.addEventListener('change', () => {
        if (theme.preference !== 'system') {
            return
        }

        const next = readSystemTheme()

        // Learning 强制亮色期间跟随系统:只刷新暂存,界面保持亮色
        if (learningLightDepth > 0) {
            savedLearningResolved = next

            return
        }

        withThemeSwitchGuard(() => {
            theme.resolved = next
            applyDocument()
        })
    })
}

/**
 * 切换瞬间的过渡抑制:大量组件对 background/color 声明了 transition,
 * 直接切 data-theme 会看到颜色"分批渐变"的脏帧。
 * 加 theme-switching 类全局禁用过渡,短延时后恢复,主题切换即变为瞬时硬切。
 */
function withThemeSwitchGuard(apply: () => void): void {
    const root = document.documentElement

    root.classList.add('theme-switching')
    apply()

    window.setTimeout(() => root.classList.remove('theme-switching'), 120)
}

/** 设置偏好档位:持久化并立即应用到文档 */
export function setTheme(preference: ThemePreference): void {
    theme.preference = preference
    localStorage.setItem(STORAGE_KEY, preference)

    withThemeSwitchGuard(() => {
        theme.resolved = preference === 'system' ? readSystemTheme() : preference
        applyDocument()
    })

    // Learning 强制亮色期间改偏好:同步暂存,退出恢复时以最新选择为准
    if (learningLightDepth > 0) {
        savedLearningResolved = theme.resolved
    }
}

/**
 * Learning 强制亮色(内容区为白色 iframe,顶栏/侧栏跟暗色会断层):
 * 进入压亮、退出恢复,用户偏好档位全程不动,仅暂存实际主题。
 * 计数可重入,归零才恢复,避免嵌套调用失衡。
 */
let learningLightDepth = 0
let savedLearningResolved: ResolvedTheme = 'light'

/** 进入 Learning:强制整站亮色 */
export function enterLearningLightTheme(): void {
    if (learningLightDepth === 0) {
        savedLearningResolved = theme.resolved
    }

    learningLightDepth += 1

    if (theme.resolved !== 'light') {
        withThemeSwitchGuard(() => {
            theme.resolved = 'light'
            applyDocument()
        })
    }
}

/** 离开 Learning:恢复进入前的实际主题 */
export function exitLearningLightTheme(): void {
    learningLightDepth = Math.max(0, learningLightDepth - 1)

    if (learningLightDepth === 0 && theme.resolved !== savedLearningResolved) {
        withThemeSwitchGuard(() => {
            theme.resolved = savedLearningResolved
            applyDocument()
        })
    }
}

/*
 * echarts 图表暗色适配:
 * canvas 内部不继承 CSS 令牌,颜色必须按当前主题显式传值。
 * 图表在面板打开时重新 init,因此读取 init 时刻的主题即可;
 * 主题切换后已渲染图表保持旧配色属已知限制(下次打开自动更新)。
 */

/** echarts.init 的主题参数;dark 内置主题必须配合透明底使用 */
export function echartsTheme(): string | undefined {
    return theme.resolved === 'dark' ? 'dark' : undefined
}

/**
 * 图表基础调色板(text/muted 为文字层级,lineSplit/axis 为网格与轴线):
 * 数值系列色(品牌色/状态色)明暗通用,不在本调色板内。
 */
export const chartPalette = computed(() => {
    if (theme.resolved === 'dark') {
        return { text: '#ececf1', muted: '#a6a6b0', lineSplit: '#3a3a41', axis: '#5c5c66' }
    }

    return { text: '#111111', muted: '#7a7a7a', lineSplit: '#e2e2e2', axis: '#d9d9d9' }
})
