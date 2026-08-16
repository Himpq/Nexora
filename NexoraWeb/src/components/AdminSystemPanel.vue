<!--
    AdminSystemPanel.vue — 管理员:系统设置(对齐原版 settings-admin-system-tab)

    设计:
      - 复用原版 admin-system-toolbar-row + 表单组样式
      - 运行环境(公开地址)+ 四项服务(RAG / 搜索 / 学习 / 邮件)开关与连接参数
      - 保存走统一按钮(btn-primary)
-->

<template>
    <div class="admin-system-panel">
        <div class="admin-users-toolbar admin-system-toolbar-row settings-management-toolbar">
            <button class="btn-primary" type="button" @click="handleSave">
                <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                <span>保存设置</span>
            </button>
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </div>

        <div class="admin-system-detail-grid">
            <section class="admin-system-card">
                <h4>运行环境</h4>
                <div class="form-group">
                    <label for="sysPublicBaseUrl">公开访问地址</label>
                    <input id="sysPublicBaseUrl" v-model="form.runtime.public_base_url" class="input-modern" type="text" placeholder="https://example.com">
                </div>
            </section>

            <section class="admin-system-card">
                <h4>RAG 数据库</h4>
                <label class="settings-toggle-row">
                    <input v-model="form.services.rag_database.enabled" type="checkbox">
                    <span>启用</span>
                </label>
                <div class="form-group">
                    <label>模式</label>
                    <select v-model="form.services.rag_database.mode" class="input-modern">
                        <option value="service">Service</option>
                        <option value="embedded">Embedded</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>地址</label>
                    <input v-model="form.services.rag_database.host" class="input-modern" type="text">
                </div>
                <div class="form-group">
                    <label>端口</label>
                    <input v-model.number="form.services.rag_database.port" class="input-modern" type="number">
                </div>
                <div class="form-group">
                    <label>API Key</label>
                    <input v-model="form.services.rag_database.api_key" class="input-modern" type="password">
                </div>
            </section>

            <section class="admin-system-card">
                <h4>Nexora 搜索</h4>
                <label class="settings-toggle-row">
                    <input v-model="form.services.nexora_search.enabled" type="checkbox">
                    <span>启用</span>
                </label>
                <div class="form-group">
                    <label>地址</label>
                    <input v-model="form.services.nexora_search.host" class="input-modern" type="text">
                </div>
                <div class="form-group">
                    <label>端口</label>
                    <input v-model.number="form.services.nexora_search.port" class="input-modern" type="number">
                </div>
                <div class="form-group">
                    <label>API Key</label>
                    <input v-model="form.services.nexora_search.api_key" class="input-modern" type="password">
                </div>
            </section>

            <section class="admin-system-card">
                <h4>Nexora 学习</h4>
                <label class="settings-toggle-row">
                    <input v-model="form.services.nexora_learning.enabled" type="checkbox">
                    <span>启用</span>
                </label>
                <div class="form-group">
                    <label>地址</label>
                    <input v-model="form.services.nexora_learning.host" class="input-modern" type="text">
                </div>
                <div class="form-group">
                    <label>端口</label>
                    <input v-model.number="form.services.nexora_learning.port" class="input-modern" type="number">
                </div>
                <div class="form-group">
                    <label>API Key</label>
                    <input v-model="form.services.nexora_learning.api_key" class="input-modern" type="password">
                </div>
                <div class="form-group">
                    <label>前端地址</label>
                    <input v-model="form.services.nexora_learning.frontend_url" class="input-modern" type="text">
                </div>
            </section>

            <section class="admin-system-card">
                <h4>Nexora 邮件</h4>
                <label class="settings-toggle-row">
                    <input v-model="form.services.nexora_mail.enabled" type="checkbox">
                    <span>启用</span>
                </label>
                <div class="form-group">
                    <label>地址</label>
                    <input v-model="form.services.nexora_mail.host" class="input-modern" type="text">
                </div>
                <div class="form-group">
                    <label>端口</label>
                    <input v-model.number="form.services.nexora_mail.port" class="input-modern" type="number">
                </div>
                <div class="form-group">
                    <label>API Key</label>
                    <input v-model="form.services.nexora_mail.api_key" class="input-modern" type="password">
                </div>
                <div class="form-group">
                    <label>默认分组</label>
                    <input v-model="form.services.nexora_mail.default_group" class="input-modern" type="text">
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue'

    import type { AdminSystemSettings } from '@/api/admin-system'
    import { fetchAdminSystemSettings, saveAdminSystemSettings } from '@/api/admin-system'
    import { showError, showToast } from '@/stores/notify'

    const loading = ref(false)

    /** 表单服务字段(与后端 payload 同构,本地默认值确保表单可编辑) */
    interface ServiceForm {
        runtime: { public_base_url: string }
        services: {
            rag_database: { enabled: boolean; mode: string; host: string; port: number; api_key: string; service_url: string }
            nexora_search: { enabled: boolean; host: string; port: number; api_key: string; service_url: string; timeout: number }
            nexora_learning: { enabled: boolean; host: string; port: number; api_key: string; frontend_url: string; request_timeout: number }
            nexora_mail: { enabled: boolean; host: string; port: number; api_key: string; service_url: string; timeout: number; send_timeout: number; default_group: string }
        }
    }

    /** 表单(与后端 payload 同构,默认值对齐 ensure_main_config_defaults) */
    const form = reactive<ServiceForm>({
        runtime: { public_base_url: '' },
        services: {
            rag_database: { enabled: false, mode: 'service', host: '', port: 8100, api_key: '', service_url: '' },
            nexora_search: { enabled: false, host: '', port: 45678, api_key: '', service_url: '', timeout: 15 },
            nexora_learning: { enabled: true, host: '', port: 5001, api_key: '', frontend_url: '', request_timeout: 30 },
            nexora_mail: { enabled: false, host: '', port: 17171, api_key: '', service_url: '', timeout: 10, send_timeout: 120, default_group: 'default' },
        },
    })

    onMounted(() => {
        void load()
    })

    /** 拉取系统设置并填充表单 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const settings = await fetchAdminSystemSettings()

            if (settings) {
                applySettings(settings)
            }
        } catch (error) {
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

    /** 保存设置 */
    async function handleSave(): Promise<void> {
        try {
            await saveAdminSystemSettings(form)

            showToast('系统设置已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }
</script>
