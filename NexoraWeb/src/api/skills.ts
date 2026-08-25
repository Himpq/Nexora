/**
 * skills.ts — Skill 管理 API
 *
 * 对应后端路由:
 *   GET  /api/skills/my                 我的 Skill(合并视图)
 *   POST /api/skills/my                 创建个人 Skill
 *   PUT  /api/skills/my/<skill_id>      更新
 *   DELETE /api/skills/my/<skill_id>    删除
 *   GET  /api/skills/market             Skill 市场(搜索/排序/分页)
 *   GET  /api/skills/market/<id>        市场详情
 *   POST /api/skills/market/<id>/install 安装到个人空间
 *   POST /api/skills/market/publish     发布/更新到市场
 */

import { apiFetch } from './client'

export interface SkillItem {
    id: string
    name: string
    description?: string
    origin?: string
    [key: string]: unknown
}

/** 市场 Skill 条目(对齐原版 chat_skill_market.js 的字段) */
export interface MarketSkillItem {
    id: string
    title: string
    description?: string
    author?: string
    version?: string
    install_count?: number
    tags?: string[]
    required_tools?: string[]
    installed?: boolean
    mode?: string
    main_content?: string
    [key: string]: unknown
}

/** 个人 Skill 保存负载(对齐原版 savePersonalSkill) */
export interface SkillPayload {
    id?: string
    title: string
    description?: string
    tags?: string[]
    required_tools?: string[]
    mode?: string
    main_content?: string
    version?: string
}

interface MySkillsResponse {
    success: boolean
    skills?: SkillItem[]
    personal_skills?: SkillItem[]
    skill_modes?: Record<string, string>
    [key: string]: unknown
}

interface MarketListResponse {
    success: boolean
    skills?: MarketSkillItem[]
    total?: number
    page?: number
    [key: string]: unknown
}

/** 获取我的 Skill 列表 + 运行模式(合并视图) */
export async function fetchMySkills(): Promise<{ skills: SkillItem[]; skillModes: Record<string, string> }> {
    const data = await apiFetch<MySkillsResponse>('/api/skills/my')

    return {
        skills: Array.isArray(data.skills) ? data.skills : [],
        skillModes: data.skill_modes && typeof data.skill_modes === 'object'
            ? data.skill_modes as Record<string, string>
            : {},
    }
}

/** 保存 Skill 运行模式(对齐原版 POST /api/skills/settings) */
export async function saveSkillModes(skillModes: Record<string, string>): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/skills/settings', {
        method: 'PUT',
        body: JSON.stringify({ skill_modes: skillModes }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }
}

/** 创建个人 Skill */
export async function createMySkill(skill: SkillPayload): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/skills/my', {
        method: 'POST',
        body: JSON.stringify({ skill }),
    })

    if (!data.success) {
        throw new Error(data.message || '创建失败')
    }
}

/** 更新个人 Skill */
export async function updateMySkill(skillId: string, skill: SkillPayload): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/skills/my/${encodeURIComponent(skillId)}`, {
        method: 'PUT',
        body: JSON.stringify({ skill }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }
}

/** 删除个人 Skill */
export async function deleteMySkill(skillId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/skills/my/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
    })
}

/** 浏览 Skill 市场 */
export async function fetchMarketSkills(options: {
    q?: string
    sort?: string
    page?: number
    pageSize?: number
} = {}): Promise<{ skills: MarketSkillItem[]; total: number; page: number }> {
    const params = new URLSearchParams({
        sort: options.sort || 'installs',
        page: String(options.page || 1),
        page_size: String(options.pageSize || 20),
    })

    if (options.q) {
        params.set('q', options.q)
    }

    const data = await apiFetch<MarketListResponse>(`/api/skills/market?${params.toString()}`)

    return {
        skills: Array.isArray(data.skills) ? data.skills : [],
        total: Number(data.total || 0),
        page: Number(data.page || 1),
    }
}

/** 市场 Skill 详情(含正文) */
export async function fetchMarketSkillDetail(skillId: string): Promise<MarketSkillItem> {
    const data = await apiFetch<{ success: boolean; skill?: MarketSkillItem; message?: string }>(
        `/api/skills/market/${encodeURIComponent(skillId)}`
    )

    if (!data.success || !data.skill) {
        throw new Error(data.message || '加载详情失败')
    }

    return data.skill
}

/** 安装市场 Skill 到个人空间 */
export async function installMarketSkill(skillId: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(
        `/api/skills/market/${encodeURIComponent(skillId)}/install`,
        { method: 'POST' }
    )

    if (!data.success) {
        throw new Error(data.message || '安装失败')
    }
}

/** 发布/更新 Skill 到市场 */
export async function publishMarketSkill(skill: SkillPayload): Promise<void> {
    const data = await apiFetch<{ success: boolean; action?: string; message?: string }>('/api/skills/market/publish', {
        method: 'POST',
        body: JSON.stringify({ skill }),
    })

    if (!data.success) {
        throw new Error(data.message || '发布失败')
    }
}

/**
 * 管理员更新全局 Skill 目录(对齐原版 saveSkillContentById → PUT /api/skills/upsert)
 * 仅管理员可调用;用于编辑全局(非个人)Skill 的内容
 */
export async function upsertCatalogSkill(skill: {
    id: string
    title?: string
    required_tools?: string[]
    mode?: string
    author?: string
    release_date?: string
    version?: string
    update_date?: string
    main_content: string
}): Promise<void> {
    const data = await apiFetch<{ success: boolean; skill?: unknown; message?: string }>('/api/skills/upsert', {
        method: 'PUT',
        body: JSON.stringify({ skill }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }
}

/**
 * 解析 .skill 文件文本(对齐原版 parseSkillText):
 *   1. 标准 .skill 格式(title:/id:/mode: 头部 + ---content--- 正文) → 结构化
 *   2. 普通文本 → 全文作为正文,文件名作为标题
 */
export function parseSkillText(rawText: string, fileName: string): SkillPayload {
    const text = String(rawText || '')
    const defaultTitle = String(fileName || '').trim().replace(/\.[^./\\]+$/, '')
    const lines = text.split(/\r?\n/)
    const markerIndex = lines.findIndex((line) => String(line || '').trim().toLowerCase() === '---content---')

    const headerKeys = ['title:', 'id:', 'required_tools:', 'mode:', 'author:', 'version:']
    const hasSkillHeader = markerIndex >= 0 || lines.slice(0, 15).some((line) => {
        const lower = String(line || '').trim().toLowerCase()

        return headerKeys.some((key) => lower.startsWith(key))
    })

    if (!hasSkillHeader) {
        return {
            title: defaultTitle,
            main_content: text.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
            mode: 'auto',
        }
    }

    const headerLines = markerIndex < 0 ? lines : lines.slice(0, markerIndex)
    const contentLines = markerIndex < 0 ? [] : lines.slice(markerIndex + 1)
    const header: Record<string, string> = {}

    for (const rawLine of headerLines) {
        const line = String(rawLine || '').trim()

        if (!line || line.startsWith('#')) {
            continue
        }

        const sepIndex = line.indexOf(':') >= 0 ? line.indexOf(':') : (line.indexOf('=') >= 0 ? line.indexOf('=') : -1)

        if (sepIndex < 0) {
            continue
        }

        header[line.slice(0, sepIndex).trim().toLowerCase()] = line.slice(sepIndex + 1).trim()
    }

    return {
        id: header.id || '',
        title: header.title || defaultTitle,
        description: header.description || '',
        tags: String(header.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        required_tools: String(header.required_tools || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        mode: header.mode || 'auto',
        version: header.version || '',
        main_content: contentLines.join('\n').replace(/[\r\n]+$/, ''),
    }
}