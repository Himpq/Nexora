/**
 * providerIcons.ts — Provider 图标解析(对齐原版 LOCAL_PROVIDER_ICON_MAP + resolveProviderSimpleIconSlug)
 *
 * 职责:
 *   - provider 规范化 → 图标 slug → 图标 URL
 *   - 无图标时提供单字符 fallback(对齐原版 providerIconFallbackText)
 */

/** 原版图标映射:slug → 静态图标路径(空值表示无图标,走单字符 fallback) */
const PROVIDER_ICON_MAP: Record<string, string> = {
    github: '',
    alibabacloud: '/static/img/Index/static/icons/aliyun.png',
    bytedance: '/static/img/icons/volcengine_single_icon.svg',
    qq: '/static/img/icons/tencent_cloud_single_icon.svg',
    wechat: '/static/img/icons/tencent_cloud_single_icon.svg',
    deepseek: '/static/img/icons/deepseek_single_icon.svg',
    openai: '/static/img/icons/openai_single_icon.svg',
    stepfun: '/static/img/icons/stepfun_single_icon.png',
    kimi: '/static/img/icons/kimi_single_icon.png',
    minimax: '/static/img/icons/minimax_single_icon.png',
    siliconflow: '/static/img/icons/siliconflow_single_icon.svg',
    openrouter: '/static/img/icons/openrouter_single_icon.svg',
    xunfei: '/static/img/icons/xunfei_spark_single_icon.svg',
    hunyuan: '/static/img/icons/hunyuan_single_icon.png',
    ollama: '/static/img/icons/ollama_single_icon.svg',
    nvidia: '/static/img/icons/nvidia.svg',
    zhipu: '/static/img/icons/zhipu_single_icon.svg',
}

/** provider 值 → 图标 slug(对齐原版 resolveProviderSimpleIconSlug) */
export function resolveProviderIconSlug(provider: string): string {
    const p = String(provider || '').trim().toLowerCase()

    if (!p) {
        return ''
    }

    const exactMap: Record<string, string> = {
        github: 'github',
        aliyun: 'alibabacloud',
        alibabacloud: 'alibabacloud',
        volcengine: 'bytedance',
        bytedance: 'bytedance',
        tencent: 'qq',
        tencentcloud: 'qq',
        qq: 'qq',
        wechat: 'wechat',
        deepseek: 'deepseek',
        openai: 'openai',
        stepfun: 'stepfun',
        moonshot: 'kimi',
        kimi: 'kimi',
        minimax: 'minimax',
        siliconflow: 'siliconflow',
        openrouter: 'openrouter',
        xunfei: 'xunfei',
        spark: 'xunfei',
        hunyuan: 'hunyuan',
        ollama: 'ollama',
        nvidia: 'nvidia',
        zhipu: 'zhipu',
        zhipuai: 'zhipu',
        zai: 'zhipu',
        bigmodel: 'zhipu',
    }

    if (exactMap[p]) {
        return exactMap[p]
    }

    if (p.includes('aliyun') || p.includes('alibaba')) return 'alibabacloud'
    if (p.includes('volc') || p.includes('byte')) return 'bytedance'
    if (p.includes('tencent')) return 'qq'
    if (p.includes('github')) return 'github'
    if (p.includes('openai')) return 'openai'
    if (p.includes('deepseek')) return 'deepseek'
    if (p.includes('moonshot') || p.includes('kimi')) return 'kimi'
    if (p.includes('step')) return 'stepfun'
    if (p.includes('minimax')) return 'minimax'
    if (p.includes('silicon')) return 'siliconflow'
    if (p.includes('openrouter')) return 'openrouter'
    if (p.includes('xunfei') || p.includes('spark')) return 'xunfei'
    if (p.includes('hunyuan')) return 'hunyuan'
    if (p.includes('ollama')) return 'ollama'
    if (p.includes('nvidia')) return 'nvidia'
    if (p.includes('zhipu') || p.includes('bigmodel')) return 'zhipu'

    return ''
}

/** 解析 provider 图标 URL;无映射时返回空字符串(调用方显示单字符 fallback) */
export function resolveProviderIconUrl(provider: string): string {
    const slug = resolveProviderIconSlug(provider)

    return slug ? PROVIDER_ICON_MAP[slug] || '' : ''
}

/** 单字符 fallback(对齐原版 providerIconFallbackText:取清洗后首字母大写) */
export function providerIconFallbackText(text: string): string {
    const src = String(text || '').trim()

    if (!src) {
        return '?'
    }

    const first = src.slice(0, 1)

    return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first
}

/** 上下文窗口友好显示(如 128000 → 128k) */
export function formatContextWindow(value?: number): string {
    const tokens = Number(value || 0)

    if (!Number.isFinite(tokens) || tokens <= 0) {
        return ''
    }

    if (tokens >= 1000000) {
        return `${Math.round(tokens / 1000000)}M`
    }

    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}k`
    }

    return String(tokens)
}
