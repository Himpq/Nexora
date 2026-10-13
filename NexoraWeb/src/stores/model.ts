/**
 * model.ts — 模型状态
 *
 * 职责:
 *   - 模型目录 / 当前选中模型
 *   - /api/config 结果 localStorage 缓存(避免每次进入都拉取,对齐原版行为)
 *   - 本地 Code 的新会话默认模型由后端持久化, localStorage 仅作兼容缓存
 */

import { defineStore } from 'pinia'

import { fetchAppConfig, normalizeModelItems, type AppConfig, type ModelItem } from '@/api/config'
import {
    fetchLocalConversationSettings,
    saveLocalConversationSettings,
    saveLocalDefaultModel,
} from '@/api/nexoracodeLocal'
import { showError } from '@/stores/notify'

const IS_NEXORACODE = import.meta.env.MODE === 'nexoracode'

/** 本地 Code 模式沿用旧前端的 selectedModel 键,避免覆盖 NexoraWeb 的模型选择。 */
const SELECTED_MODEL_KEY = IS_NEXORACODE ? 'selectedModel' : 'nexora.selectedModelId'

/** 两个应用使用独立配置缓存,防止模型目录串用。 */
const CONFIG_CACHE_KEY = IS_NEXORACODE ? 'nexoracode.config' : 'nexora.config'

/** config 缓存有效期(5 分钟) */
const CONFIG_CACHE_TTL = 5 * 60 * 1000

let defaultModelSaveQueue: Promise<void> = Promise.resolve()

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

/** 按用户选择顺序写默认模型，避免快速连续切换时旧请求最后落盘。 */
function persistLocalDefaultModel(modelId: string): Promise<void> {
    const pending = defaultModelSaveQueue.then(() => saveLocalDefaultModel(modelId))
    defaultModelSaveQueue = pending.catch(() => undefined)

    return pending
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
                if (!options.force) {
                    const cached = readConfigCache()

                    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
                        await this.applyConfig(cached)

                        return
                    }
                }

                const config = await fetchAppConfig()

                writeConfigCache(config)

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

            const persisted = IS_NEXORACODE ? String(config.local_selected_model_id || '').trim() : ''

            if (persisted && this.models.some((item) => item.id === persisted)) {
                this.selectedId = persisted
                localStorage.setItem(SELECTED_MODEL_KEY, persisted)

                return
            }

            const cached = localStorage.getItem(SELECTED_MODEL_KEY)

            if (cached && this.models.some((item) => item.id === cached)) {
                this.selectedId = cached

                if (IS_NEXORACODE) {
                    try {
                        await persistLocalDefaultModel(cached)
                        writeConfigCache({ ...config, local_selected_model_id: cached })
                    } catch (error) {
                        showError(error instanceof Error ? error.message : '保存默认模型失败')
                    }
                }

                return
            }

            const preferred = IS_NEXORACODE ? String(config.default_model || '').trim() : ''

            if (preferred && this.models.some((item) => item.id === preferred)) {
                // 仅作为全局初值写入本地缓存；不调用 selectModel，避免在有活动会话时
                // 把全局默认模型误写进该会话（重启后覆盖会话自身模型）。
                this.selectedId = preferred
                localStorage.setItem(SELECTED_MODEL_KEY, preferred)

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
         * 有当前会话时写该会话的独立设置（只影响本会话）；没有会话时更新全局默认
         * （作为之后新建会话的初值）。
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
            localStorage.setItem(SELECTED_MODEL_KEY, modelId)

            if (IS_NEXORACODE) {
                try {
                    await persistLocalDefaultModel(modelId)
                } catch (error) {
                    showError(error instanceof Error ? error.message : '保存默认模型失败')

                    return
                }

                const cachedConfig = readConfigCache()

                if (cachedConfig) {
                    writeConfigCache({ ...cachedConfig, local_selected_model_id: modelId })
                }
            }
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
         * 会话无模型（老会话）则回退全局初值（本地缓存 → 目录首项）。
         * 只改 selectedId，不落盘、不写会话。
         */
        applyConversationModel(modelId: string): void {
            const clean = String(modelId || '').trim()

            if (clean) {
                this.selectedId = clean

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
