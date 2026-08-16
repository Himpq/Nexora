/**
 * model.ts — 模型状态
 *
 * 职责:
 *   - 模型目录 / 当前选中模型
 *   - /api/config 结果 localStorage 缓存(避免每次进入都拉取,对齐原版行为)
 *   - 选中模型持久化到 localStorage(模型使用历史缓存)
 */

import { defineStore } from 'pinia'

import { fetchAppConfig, type AppConfig, type ModelItem } from '@/api/config'

/** localStorage 键:选中模型 */
const SELECTED_MODEL_KEY = 'nexora.selectedModelId'

/** localStorage 键:/api/config 缓存 */
const CONFIG_CACHE_KEY = 'nexora.config'

/** config 缓存有效期(5 分钟) */
const CONFIG_CACHE_TTL = 5 * 60 * 1000

interface ConfigCacheEntry {
    data: AppConfig
    ts: number
}

interface ModelState {
    models: ModelItem[]
    selectedId: string
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
    }),

    getters: {
        selectedModel(state): ModelItem | undefined {
            return state.models.find((item) => item.id === state.selectedId)
        },
    },

    actions: {
        /** 加载模型目录:优先读缓存,再恢复上次选中的模型 */
        async loadModels(): Promise<void> {
            const cached = readConfigCache()

            if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
                this.applyConfig(cached)

                return
            }

            const config = await fetchAppConfig()

            writeConfigCache(config)

            this.applyConfig(config)
        },

        /** 应用 config:填充模型目录并恢复选中模型 */
        applyConfig(config: AppConfig): void {
            this.models = Array.isArray(config.models) ? config.models : []

            const cached = localStorage.getItem(SELECTED_MODEL_KEY)

            if (cached && this.models.some((item) => item.id === cached)) {
                this.selectedId = cached

                return
            }

            if (this.models.length > 0) {
                this.selectModel(this.models[0].id)
            }
        },

        /** 选中模型并持久化 */
        selectModel(modelId: string): void {
            this.selectedId = modelId

            localStorage.setItem(SELECTED_MODEL_KEY, modelId)
        },
    },
})
