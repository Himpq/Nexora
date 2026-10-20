/**
 * model.ts — 模型状态
 *
 * 职责:
 *   - 模型目录 / 当前选中模型
 *   - /api/config 结果 localStorage 缓存(避免每次进入都拉取,对齐原版行为)
 *   - 本地 Code 的「新会话默认模型」由后端决定(providers.json 的 default_id),
 *     前端不持久化任何全局选中项
 *
 * 本地 Code 的模型职责划分:
 *   新会话  → 后端按设置页的默认 Provider 复制一份到会话设置;
 *   历史会话 → 用该会话自己保存的 model_name;
 *   顶栏换模型 → 只写当前会话,不影响新会话默认。
 *
 * 为什么本地 Code 不能用 localStorage:
 *   本地服务端口每次启动随机分配(core/server.py:bind_local_port),窗口 URL 是
 *   http://127.0.0.1:<随机端口>/nc/shell。localStorage 按 origin 隔离,每个端口
 *   一份,重启后新 origin 必然为空。任何「localStorage 兜底」在本地 Code 里都是
 *   死代码,只会把选中项悄悄退回 Provider 的 default_id(列表第一个模型)。
 */

import { defineStore } from 'pinia'

import { fetchAppConfig, normalizeModelItems, type AppConfig, type ModelItem } from '@/api/config'
import {
    fetchLocalConversationSettings,
    saveLocalConversationSettings,
} from '@/api/nexoracodeLocal'

const IS_NEXORACODE = import.meta.env.MODE === 'nexoracode'

/** 仅 NexoraWeb 使用:本地 Code 的选中项由后端持有,不落 localStorage。 */
const SELECTED_MODEL_KEY = 'nexora.selectedModelId'

/** 两个应用使用独立配置缓存,防止模型目录串用。 */
const CONFIG_CACHE_KEY = IS_NEXORACODE ? 'nexoracode.config' : 'nexora.config'

/** config 缓存有效期(5 分钟) */
const CONFIG_CACHE_TTL = 5 * 60 * 1000

interface ConfigCacheEntry {
    data: AppConfig
    ts: number
}

interface ModelState {
    models: ModelItem[]
    selectedId: string
    /** 模型目录加载状态(供选择器显示读取中) */
    loading: boolean
    /**
     * 会话 id → 该会话选用的模型。
     *
     * 模型按会话独立保存：切到某会话时用它的模型，改模型只影响该会话。
     * 全局 selectedId 仍保留，作为新建会话的初值。
     */
    conversationModels: Record<string, string>
    /** 当前会话 id：selectModel 时据此决定写到哪个会话。 */
    activeConversationId: string
    /** 会话模型是否已从后端加载过（避免切会话时重复请求）。 */
    conversationModelLoaded: Record<string, boolean>
}

/** 读取 config 缓存;有效则直接返回 */
function readConfigCache(): AppConfig | null {
    try {
        const raw = localStorage.getItem(CONFIG_CACHE_KEY)

        if (!raw) {
            return null
        }

        const entry = JSON.parse(raw) as ConfigCacheEntry

        if (!entry || !entry.data || !entry.ts) {
            return null
        }

        if (Date.now() - entry.ts > CONFIG_CACHE_TTL) {
            return null
        }

        return entry.data
    } catch {
        return null
    }
}

/** 写入 config 缓存 */
function writeConfigCache(data: AppConfig): void {
    try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
            data,
            ts: Date.now(),
        } satisfies ConfigCacheEntry))
    } catch {
        // 缓存写入失败不影响主流程
    }
}

export const useModelStore = defineStore('model', {
    state: (): ModelState => ({
        models: [],
        selectedId: '',
        loading: false,
        conversationModels: {},
        activeConversationId: '',
        conversationModelLoaded: {},
    }),

    getters: {
        selectedModel(state): ModelItem | undefined {
            return state.models.find((item) => item.id === state.selectedId)
        },
    },

    actions: {
        /** 加载模型目录:优先读缓存,再恢复上次选中的模型;force 时绕过缓存强制拉取 */
        async loadModels(options: { force?: boolean } = {}): Promise<void> {
            this.loading = true

            try {
                // 本地 Code 不读缓存：端口每次随机，origin 一变缓存必然落空；
                // 而万一端口重复，5 分钟 TTL 的旧缓存会喂回过期的 default_model。
                // 直接以 /api/config 为准，逻辑只有一条路径。
                if (!options.force && !IS_NEXORACODE) {
                    const cached = readConfigCache()

                    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
                        await this.applyConfig(cached)

                        return
                    }
                }

                const config = await fetchAppConfig()

                if (!IS_NEXORACODE) {
                    writeConfigCache(config)
                }

                await this.applyConfig(config)
            } finally {
                this.loading = false
            }
        },

        /** 应用 config:填充模型目录并恢复选中模型 */
        async applyConfig(config: AppConfig): Promise<void> {
            this.models = normalizeModelItems(config.models)

            // 有活动会话时，selectedId 由 setActiveConversation 按会话设置决定，
            // 此处不覆盖，避免 loadModels 与切会话并发时用全局默认冲掉会话模型。
            if (IS_NEXORACODE && String(this.activeConversationId || '').trim()) {
                return
            }

            if (IS_NEXORACODE) {
                // 本地 Code：后端是唯一权威。default_model 已由后端处理为
                // 「用户选过的模型 → Provider default_id → 空」的优先级，
                // 这里不再读 localStorage（换端口即失效，见文件头说明）。
                const preferred = String(config.default_model || '').trim()

                if (preferred && this.models.some((item) => item.id === preferred)) {
                    this.selectedId = preferred

                    return
                }

                if (this.models.length > 0) {
                    this.selectedId = this.models[0].id
                }

                return
            }

            const cached = localStorage.getItem(SELECTED_MODEL_KEY)

            if (cached && this.models.some((item) => item.id === cached)) {
                this.selectedId = cached

                return
            }

            if (this.models.length > 0) {
                this.selectedId = this.models[0].id
                localStorage.setItem(SELECTED_MODEL_KEY, this.models[0].id)
            }
        },

        /**
         * 选中模型并持久化。
         *
         * 有当前会话时写该会话的独立设置（只影响本会话）；没有会话时只更新
         * 顶栏显示，不落盘——新会话的模型由后端按设置页的默认 Provider 复制，
         * 顶栏临时换模型不应改变「新会话用哪个模型」这件事。
         */
        async selectModel(modelId: string): Promise<void> {
            const conversationId = IS_NEXORACODE ? String(this.activeConversationId || '').trim() : ''

            if (conversationId) {
                this.selectedId = modelId
                this.conversationModels[conversationId] = modelId
                // 落盘到会话设置；失败不影响界面（下次进入会话会以服务端为准）。
                void saveLocalConversationSettings(conversationId, { model_name: modelId }).catch(() => {
                    // 静默：模型选择本身已生效，落盘失败只影响下次进入会话的默认值。
                })

                return
            }

            this.selectedId = modelId

            if (IS_NEXORACODE) {
                // 本地 Code：无会话时只改顶栏显示。新会话的模型由后端
                // （/api/conversations 创建时按 providers.json 的 default_id 复制）
                // 决定，这里不写任何持久化，避免顶栏临时选择污染新会话默认。
                return
            }

            localStorage.setItem(SELECTED_MODEL_KEY, modelId)
        },

        /**
         * 切换当前会话：加载该会话的模型设置并应用到 selectedId。
         *
         * 会话模型按会话独立保存；老会话没有设置时后端会用全局默认补齐。
         * 仅 NexoraCode 形态启用（云端会话的模型由云端自己的机制管理）。
         */
        async setActiveConversation(conversationId: string): Promise<void> {
            const cleanId = IS_NEXORACODE ? String(conversationId || '').trim() : ''
            this.activeConversationId = cleanId

            if (!cleanId) {
                return
            }

            if (this.conversationModelLoaded[cleanId]) {
                this.applyConversationModel(this.conversationModels[cleanId])

                return
            }

            try {
                const settings = await fetchLocalConversationSettings(cleanId)
                const modelName = String(settings.model_name || '').trim()

                this.conversationModelLoaded[cleanId] = true

                if (modelName) {
                    this.conversationModels[cleanId] = modelName
                }

                this.applyConversationModel(modelName)
            } catch {
                // 读取失败回退全局初值，不阻断会话切换。
                this.applyConversationModel('')
            }
        },

        /**
         * 应用某会话的模型到 selectedId。
         *
         * 会话有模型则用它（不校验模型目录是否已加载，避免与 loadModels 竞态）；
         * 会话无模型（老会话）则回退全局初值（本地 Code 用后端 default_model，
         * 云端用 localStorage 缓存 → 目录首项）。
         * 只改 selectedId，不落盘、不写会话。
         */
        applyConversationModel(modelId: string): void {
            const clean = String(modelId || '').trim()

            if (clean) {
                this.selectedId = clean

                return
            }

            if (IS_NEXORACODE) {
                // 老会话没有自己的模型：保持当前全局初值（applyConfig 已按后端
                // default_model 设好），没有才退到目录首项。
                if (!this.selectedId && this.models.length > 0) {
                    this.selectedId = this.models[0].id
                }

                return
            }

            const cached = localStorage.getItem(SELECTED_MODEL_KEY)

            if (cached) {
                this.selectedId = cached

                return
            }

            if (this.models.length > 0) {
                this.selectedId = this.models[0].id
            }
        },
    },
})
