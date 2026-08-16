<!--
    AdminSystemPanel.vue — 管理员:系统设置(对齐原版 settings-admin-system-tab)

    结构:
      - 工具栏:重新加载 + 状态
      - 左:模块列表(基础运行/默认模型/RAG/NexoraSearch/NexoraLearning/NexoraMail)
      - 右:模块详情(表单 + 启用开关 + 健康检查测试 + 保存)
-->

<template>
    <div class="admin-system-panel">
        <div class="admin-users-toolbar admin-system-toolbar-row settings-management-toolbar">
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>重新加载</span>
            </button>
            <span class="settings-field" style="margin-left: auto;">{{ statusText }}</span>
        </div>

        <div class="admin-users-layout settings-management-layout">
            <!-- 模块列表 -->
            <div class="admin-users-list settings-management-list">
                <div
                    v-for="module in modules"
                    :key="module.key"
                    class="admin-user-item admin-system-module-item"
                    :class="{ active: activeModule === module.key }"
                    role="button"
                    tabindex="0"
                    @click="activeModule = module.key"
                    @keydown.enter="activeModule = module.key"
                >
                    <span class="admin-user-avatar admin-system-module-icon"><i :class="module.icon" aria-hidden="true"></i></span>
                    <span class="admin-system-module-main">
                        <span class="admin-user-name">{{ module.name }}</span>
                        <span class="admin-user-meta">{{ module.meta }}</span>
                    </span>
                </div>
            </div>

            <!-- 模块详情 -->
            <div class="admin-user-detail settings-management-detail">
                <!-- 基础运行 -->
                <template v-if="activeModule === 'runtime'">
                    <div class="admin-system-section-head">
                        <h4><i class="fa-solid fa-gauge-high" aria-hidden="true"></i><span>基础运行</span></h4>
                        <div class="admin-system-section-actions">
                            <button class="btn-primary-outline btn-compact" type="button" @click="saveModule('runtime')">
                                <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                                <span>保存</span>
                            </button>
                        </div>
                    </div>
                    <div class="admin-system-form-grid">
                        <div class="form-group admin-system-wide">
                            <label for="sysPublicBaseUrl">Public Base URL</label>
                            <input id="sysPublicBaseUrl" v-model="form.runtime.public_base_url" class="input-modern" type="text" placeholder="https://chat.example.com">
                        </div>
                    </div>
                </template>

                <!-- 默认模型 -->
                <template v-else-if="activeModule === 'default_models'">
                    <div class="admin-system-section-head">
                        <h4><i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>默认模型</span></h4>
                        <div class="admin-system-section-actions">
                            <button class="btn-primary-outline btn-compact" type="button" @click="saveModule('default_models')">
                                <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                                <span>保存</span>
                            </button>
                        </div>
                    </div>
                    <div class="admin-system-form-grid">
                        <div class="form-group" v-for="field in defaultModelFields" :key="field.key">
                            <label>{{ field.label }}</label>
                            <SettingSelect
                                :model-value="String(form.default_models[field.key] || '')"
                                :options="modelSelectOptions"
                                placeholder="不指定"
                                width="100%"
                                @update:model-value="form.default_models[field.key] = String($event)"
                            />
                        </div>
                    </div>
                </template>

                <!-- 服务模块:RAG / 搜索 / 学习 / 邮件 -->
                <template v-else-if="serviceModule">
                    <div class="admin-system-section-head">
                        <h4><i :class="serviceModule.icon" aria-hidden="true"></i><span>{{ serviceModule.name }}</span></h4>
                        <div class="admin-system-section-actions">
                            <label class="admin-system-enable-check">
                                <input v-model="form.services[activeModule].enabled" type="checkbox">
                                <span>启用</span>
                            </label>
                            <button
                                class="btn-primary-outline btn-compact admin-system-section-health"
                                :class="healthResult ? (healthResult.ok ? 'is-success' : 'is-error') : ''"
                                type="button"
                                :disabled="healthTesting"
                                @click="runHealthTest"
                            >
                                <i class="fa-solid fa-plug" aria-hidden="true"></i>
                                <span>{{ healthTesting ? '测试中...' : '测试' }}</span>
                            </button>
                            <button class="btn-primary-outline btn-compact admin-system-section-save" type="button" @click="saveModule(activeModule)">
                                <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                                <span>保存</span>
                            </button>
                        </div>
                    </div>
                    <div v-if="healthResult" class="admin-system-health-result" :class="healthResult.ok ? 'ok' : 'error'">
                        {{ healthResult.ok ? '服务正常' : `连接失败: ${healthResult.message}` }}
                    </div>
                    <div class="admin-system-form-grid">
                        <template v-for="field in serviceFields" :key="field.key">
                            <div class="form-group" :class="{ 'admin-system-wide': field.wide }">
                                <label>{{ field.label }}</label>
                                <input
                                    v-if="field.type === 'number'"
                                    v-model.number="form.services[activeModule][field.key]"
                                    class="input-modern"
                                    type="number"
                                    min="1"
                                >
                                <input
                                    v-else-if="field.type === 'password'"
                                    v-model="form.services[activeModule][field.key]"
                                    class="input-modern"
                                    type="password"
                                    autocomplete="off"
                                >
                                <SettingSelect
                                    v-else-if="field.select"
                                    :model-value="String(form.services[activeModule][field.key] || '')"
                                    :options="field.select"
                                    width="100%"
                                    @update:model-value="form.services[activeModule][field.key] = String($event)"
                                />
                                <input
                                    v-else
                                    v-model="form.services[activeModule][field.key]"
                                    class="input-modern"
                                    type="text"
                                >
                            </div>
                        </template>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { AdminSystemSettings } from '@/api/admin-system'
    import { fetchAdminSystemSettings, saveAdminSystemSettings } from '@/api/admin-system'
    import { fetchModelsConfig } from '@/api/admin-models'
    import { showError, showToast } from '@/stores/notify'

    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const loading = ref(false)
    const statusText = ref('未加载')
    const activeModule = ref('runtime')

    /** 模块定义(对齐原版 admin-system-module-item 列表) */
    const modules = [
        { key: 'runtime', name: '基础运行', meta: '公开访问地址', icon: 'fa-solid fa-gauge-high' },
        { key: 'default_models', name: '默认模型', meta: '对话 / 总结 / 整理', icon: 'fa-solid fa-layer-group' },
        { key: 'rag_database', name: 'RAG 向量库', meta: '向量检索服务', icon: 'fa-solid fa-database' },
        { key: 'nexora_search', name: 'NexoraSearch', meta: '搜索服务', icon: 'fa-solid fa-magnifying-glass' },
        { key: 'nexora_learning', name: 'NexoraLearning', meta: '学习前端服务', icon: 'fa-solid fa-graduation-cap' },
        { key: 'nexora_mail', name: 'NexoraMail', meta: '邮件服务', icon: 'fa-solid fa-envelope-open-text' },
    ] as const

    /** 默认模型字段(对齐原版四个 select) */
    const defaultModelFields = [
        { key: 'chat', label: '默认对话模型' },
        { key: 'conclusion', label: '总结模型' },
        { key: 'organization', label: '整理模型' },
        { key: 'websearch', label: '联网搜索模型' },
    ]

    const modelSelectOptions = ref<Array<{ value: string; label: string }>>([{ value: '', label: '不指定' }])

    /** 服务字段配置(对齐原版 admin-system-form-grid) */
    interface ServiceField {
        key: string
        label: string
        type?: 'number' | 'password' | 'text'
        wide?: boolean
        select?: Array<{ value: string; label: string }>
    }

    const serviceFieldsMap: Record<string, ServiceField[]> = {
        rag_database: [
            { key: 'mode', label: '模式', select: [{ value: 'service', label: 'service' }, { value: 'local', label: 'local' }] },
            { key: 'host', label: 'Host' },
            { key: 'port', label: 'Port', type: 'number' },
            { key: 'service_url', label: 'Service URL', wide: true },
            { key: 'api_key', label: 'API Key', type: 'password', wide: true },
        ],
        nexora_search: [
            { key: 'host', label: 'Host' },
            { key: 'port', label: 'Port', type: 'number' },
            { key: 'timeout', label: 'Timeout', type: 'number' },
            { key: 'service_url', label: 'Service URL', wide: true },
            { key: 'api_key', label: 'API Key', type: 'password', wide: true },
        ],
        nexora_learning: [
            { key: 'host', label: 'Host' },
            { key: 'port', label: 'Port', type: 'number' },
            { key: 'frontend_url', label: 'Frontend URL', wide: true },
            { key: 'api_key', label: 'API Key', type: 'password', wide: true },
        ],
        nexora_mail: [
            { key: 'host', label: 'Host' },
            { key: 'port', label: 'Port', type: 'number' },
            { key: 'service_url', label: 'Service URL', wide: true },
            { key: 'api_key', label: 'API Key', type: 'password', wide: true },
            { key: 'default_group', label: '默认分组' },
        ],
    }

    const serviceModule = computed(() => {
        return modules.find((module) => module.key === activeModule.value && module.key !== 'runtime' && module.key !== 'default_models')
    })

    const serviceFields = computed<ServiceField[]>(() => {
        return serviceFieldsMap[activeModule.value] || []
    })

    /** 表单(与后端 payload 同构,必填结构避免可选链噪音) */
    interface SystemForm {
        runtime: { public_base_url: string }
        default_models: Record<string, string>
        services: {
            rag_database: { enabled: boolean; mode: string; host: string; port: number; api_key: string; service_url: string }
            nexora_search: { enabled: boolean; host: string; port: number; api_key: string; service_url: string; timeout: number }
            nexora_learning: { enabled: boolean; host: string; port: number; api_key: string; frontend_url: string; request_timeout: number }
            nexora_mail: { enabled: boolean; host: string; port: number; api_key: string; service_url: string; timeout: number; send_timeout: number; default_group: string }
            [key: string]: Record<string, unknown>
        }
    }

    const form = reactive<SystemForm>({
        runtime: { public_base_url: '' },
        default_models: {},
        services: {
            rag_database: { enabled: false, mode: 'service', host: '', port: 8100, api_key: '', service_url: '' },
            nexora_search: { enabled: false, host: '', port: 45678, api_key: '', service_url: '', timeout: 15 },
            nexora_learning: { enabled: true, host: '', port: 5001, api_key: '', frontend_url: '', request_timeout: 30 },
            nexora_mail: { enabled: false, host: '', port: 17171, api_key: '', service_url: '', timeout: 10, send_timeout: 120, default_group: 'default' },
        },
    })

    /** 健康检查状态 */
    const healthTesting = ref(false)
    const healthResult = ref<{ ok: boolean; message: string } | null>(null)

    onMounted(() => {
        void load()
    })

    /** 拉取系统设置并填充表单 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true
        statusText.value = '加载中...'

        try {
            const settings = await fetchAdminSystemSettings()

            if (settings) {
                applySettings(settings)
                statusText.value = '已加载'
            } else {
                statusText.value = '无配置'
            }

            // 模型选项(默认模型下拉)
            try {
                const config = await fetchModelsConfig()

                modelSelectOptions.value = [
                    { value: '', label: '不指定' },
                    ...Object.keys(config.models).map((id) => ({ value: id, label: id })),
                ]
            } catch {
                // 模型选项加载失败不影响系统设置展示
            }
        } catch (error) {
            statusText.value = '加载失败'
            showError(error instanceof Error ? error.message : '加载系统设置失败')
        } finally {
            loading.value = false
        }
    }

    /** 深合并后端返回(保留本地默认,避免 undefined 覆盖) */
    function applySettings(settings: AdminSystemSettings): void {
        if (settings.runtime && typeof settings.runtime === 'object') {
            Object.assign(form.runtime, settings.runtime)
        }

        if (settings.default_models && typeof settings.default_models === 'object') {
            form.default_models = { ...settings.default_models } as Record<string, string>
        }

        const services = settings.services

        if (!services || typeof services !== 'object') {
            return
        }

        for (const key of ['rag_database', 'nexora_search', 'nexora_learning', 'nexora_mail'] as const) {
            const incoming = services[key]

            if (incoming && typeof incoming === 'object') {
                const target = form.services[key]

                if (target) {
                    Object.assign(target, incoming)
                }
            }
        }
    }

    /** 保存当前模块(整体提交后端) */
    async function saveModule(moduleKey: string): Promise<void> {
        try {
            await saveAdminSystemSettings(form)

            const module = modules.find((item) => item.key === moduleKey)

            showToast(`${module?.name || '配置'}已保存`, 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 健康检查:客户端直连服务 /health(对齐原版 admin-system-section-health) */
    async function runHealthTest(): Promise<void> {
        const service = form.services[activeModule.value] as Record<string, unknown>
        const url = String(service.service_url || '').trim()
        const host = String(service.host || '').trim()
        const port = Number(service.port || 0)

        const base = url || (host && port ? `http://${host}:${port}` : '')

        if (!base) {
            healthResult.value = { ok: false, message: '请先填写 Service URL 或 Host/Port' }

            return
        }

        healthTesting.value = true
        healthResult.value = null

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 6000)

        try {
            const res = await fetch(`${base.replace(/\/+$/, '')}/health`, { signal: controller.signal })

            healthResult.value = { ok: res.ok, message: res.ok ? '' : `HTTP ${res.status}` }
        } catch (error) {
            healthResult.value = { ok: false, message: error instanceof Error ? error.message : '无法连接' }
        } finally {
            clearTimeout(timer)
            healthTesting.value = false
        }
    }
</script>

<style scoped>
    .admin-system-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .admin-system-panel .admin-users-toolbar .settings-field {
        flex: none;
        font-size: 12px;
        padding: 6px 12px;
    }

    .admin-system-module-item {
        border-bottom: 1px solid #f4f4f4;
    }

    .admin-system-module-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .admin-system-module-icon {
        font-size: 13px;
        color: #7a7a7a;
    }

    .admin-system-module-item.active .admin-system-module-icon {
        color: #111111;
    }

    .admin-system-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 14px;
    }

    .admin-system-section-head h4 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 14px;
        font-weight: 650;
        color: #111111;
    }

    .admin-system-section-head h4 i {
        color: #7a7a7a;
        font-size: 13px;
    }

    .admin-system-section-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .admin-system-enable-check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12.5px;
        font-weight: 550;
        color: #3c3c3c;
        cursor: pointer;
        margin-right: 4px;
    }

    .admin-system-enable-check input {
        width: 15px;
        height: 15px;
        accent-color: #111111;
    }

    .admin-system-form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px 20px;
    }

    .admin-system-form-grid .admin-system-wide {
        grid-column: 1 / -1;
    }

    .admin-system-health-result {
        margin-bottom: 12px;
        padding: 8px 12px;
        border-radius: 7px;
        font-size: 12.5px;
    }

    .admin-system-health-result.ok {
        background: #e8f5e9;
        color: #2e7d32;
    }

    .admin-system-health-result.error {
        background: #fdecea;
        color: #b03a2e;
    }

    .admin-system-section-health.is-success {
        border-color: #9ccc9f;
        color: #2e7d32;
    }

    .admin-system-section-health.is-error {
        border-color: #e0a0a0;
        color: #b03a2e;
    }
</style>