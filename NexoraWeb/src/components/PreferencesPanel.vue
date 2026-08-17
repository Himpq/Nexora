<!--
    PreferencesPanel.vue — 偏好设置(对齐原版 settings-preferences-tab)

    结构:
      - SettingCard 分组 + SettingRow/SettingSelect/SettingToggle 统一组件
      - 主题 / 语言(自建下拉,定宽)/ 流式输出开关
      - 学习模式(开关)+ 默认打开视图(学习模式开启时显示)
      - 用户记忆:只读文本 + 刷新 + 记忆更新模型
-->

<template>
    <div class="settings-preferences-grid">
        <SettingCard title="外观与行为">
            <SettingRow label="主题">
                <SettingSelect v-model="form.theme" :options="themeOptions" width="150px" />
            </SettingRow>
            <SettingRow label="语言">
                <SettingSelect v-model="form.language" :options="languageOptions" width="150px" />
            </SettingRow>
            <SettingRow label="流式输出" hint="回复时逐字流式显示">
                <SettingToggle v-model="form.streaming" label="" />
            </SettingRow>
        </SettingCard>

        <SettingCard title="学习模式" description="学习模式开关与默认视图">
            <SettingRow label="NexoraLearning 服务" hint="服务端门控:关闭后 Learning 功能不可用">
                <div class="settings-mode-toggle" role="tablist" aria-label="NexoraLearning 服务">
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_runtime !== false }"
                        type="button"
                        @click="form.learning_runtime = true"
                    >启用</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_runtime === false }"
                        type="button"
                        @click="form.learning_runtime = false"
                    >禁用</button>
                </div>
            </SettingRow>
            <SettingRow label="学习模式" hint="开启后默认进入 Learning 侧边栏">
                <div class="settings-mode-toggle" role="tablist" aria-label="学习模式">
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_mode !== 'on' }"
                        :disabled="form.learning_runtime === false"
                        type="button"
                        @click="form.learning_mode = 'off'"
                    >Nexora</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_mode === 'on' }"
                        :disabled="form.learning_runtime === false"
                        type="button"
                        @click="form.learning_mode = 'on'"
                    >Learning</button>
                </div>
            </SettingRow>
            <SettingRow v-if="form.learning_mode === 'on' && form.learning_runtime !== false" label="默认打开" hint="学习模式开启时,默认打开的视图">
                <div class="settings-mode-toggle" role="tablist" aria-label="默认打开">
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.default_open_view !== 'learning' }"
                        type="button"
                        @click="form.default_open_view = 'nexora'"
                    >Nexora</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.default_open_view === 'learning' }"
                        type="button"
                        @click="form.default_open_view = 'learning'"
                    >NexoraLearning</button>
                </div>
            </SettingRow>
        </SettingCard>

        <SettingCard title="用户记忆">
            <textarea
                id="settingsMemoryProfile"
                v-model="memoryText"
                class="input-modern settings-memory-textarea"
                rows="7"
                readonly
                placeholder="正在读取用户记忆..."
            ></textarea>
            <div class="settings-memory-row">
                <div class="settings-memory-model-field">
                    <div class="settings-memory-model-label">记忆更新模型</div>
                    <SettingModelSelect
                        v-model="form.memory_update_model"
                        placeholder="使用当前对话模型"
                        width="min(100%, 320px)"
                    />
                </div>
                <button class="btn-primary-outline btn-compact" type="button" title="刷新用户记忆" @click="loadMemory">
                    <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                    <span>刷新</span>
                </button>
            </div>
        </SettingCard>

        <div class="settings-pref-actions">
            <button class="btn-primary" type="button" @click="handleSave">
                <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                <span>保存偏好</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue'

    import { apiFetch } from '@/api/client'
    import type { UserPreferences } from '@/api/preferences'
    import { fetchUserPreferences, saveUserPreferences } from '@/api/preferences'
    import { showError, showToast } from '@/stores/notify'

    import SettingCard from '@/ui/settings/SettingCard.vue'
    import SettingModelSelect from '@/ui/settings/SettingModelSelect.vue'
    import SettingRow from '@/ui/settings/SettingRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'
    import SettingToggle from '@/ui/settings/SettingToggle.vue'

    const loading = ref(false)
    const memoryText = ref('')

    const themeOptions = [
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' },
        { value: 'system', label: '跟随系统' },
    ]

    const languageOptions = [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
        { value: 'ja', label: '日本語' },
    ]

    const form = reactive<{
        theme: string
        streaming: boolean
        language: string
        learning_runtime: boolean
        learning_mode: string
        default_open_view: string
        memory_update_model: string
    }>({
        theme: 'system',
        streaming: true,
        language: 'zh',
        learning_runtime: true,
        learning_mode: 'off',
        default_open_view: 'learning',
        memory_update_model: '',
    })

    onMounted(() => {
        void load()
    })

    /** 拉取偏好 + 用户记忆(模型列表由 SettingModelSelect 内部拉取) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const preferences = await fetchUserPreferences()

            if (preferences) {
                applyPreferences(preferences)
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载偏好失败')
        } finally {
            loading.value = false
        }

        void loadMemory()
    }

    /** 拉取用户记忆(只读) */
    async function loadMemory(): Promise<void> {
        try {
            const data = await apiFetch<{ success: boolean; profile?: string }>('/api/memory/profile')

            memoryText.value = String(data.profile || '(暂无记忆内容)')
        } catch {
            memoryText.value = '(加载失败)'
        }
    }

    /** 填充表单(仅覆盖存在的键) */
    function applyPreferences(preferences: UserPreferences): void {
        if (typeof preferences.theme === 'string' && preferences.theme) {
            form.theme = preferences.theme
        }

        if (typeof preferences.streaming === 'boolean') {
            form.streaming = preferences.streaming
        }

        if (typeof preferences.language === 'string' && preferences.language) {
            form.language = preferences.language
        }

        if (preferences.learning_runtime && typeof preferences.learning_runtime === 'object') {
            form.learning_runtime = preferences.learning_runtime.enabled !== false
        }

        if (typeof preferences.learning_mode === 'string') {
            form.learning_mode = preferences.learning_mode
        }

        if (typeof preferences.default_open_view === 'string') {
            form.default_open_view = preferences.default_open_view
        }

        if (typeof preferences.memory_update_model === 'string') {
            form.memory_update_model = preferences.memory_update_model
        }
    }

    /** 保存偏好 */
    async function handleSave(): Promise<void> {
        try {
            await saveUserPreferences({
                theme: form.theme,
                streaming: form.streaming,
                language: form.language,
                learning_runtime: { enabled: form.learning_runtime },
                learning_mode: form.learning_mode,
                default_open_view: form.default_open_view,
                memory_update_model: form.memory_update_model,
            })

            showToast('偏好已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }
</script>

<style scoped>
    .settings-preferences-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .settings-memory-textarea {
        width: 100%;
        min-height: 140px;
        font-family: inherit;
        font-size: 12.5px;
        line-height: 1.6;
        color: #3c3c3c;
        margin-bottom: 12px;
    }

    .settings-memory-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
    }

    .settings-memory-model-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .settings-memory-model-label {
        font-size: 12px;
        color: #7a7a7a;
    }

    .settings-pref-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 6px;
    }
</style>