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
                <SettingSelect v-model="themeModel" :options="themeOptions" width="150px" popover-key="preferences-theme" />
            </SettingRow>
            <SettingRow label="语言">
                <SettingSelect v-model="form.language" :options="languageOptions" width="150px" popover-key="preferences-language" />
            </SettingRow>
            <SettingRow label="流式输出" hint="回复时逐字流式显示">
                <SettingToggle v-model="form.streaming" label="" />
            </SettingRow>
        </SettingCard>

        <SettingCard title="学习模式" description="学习模式开关与默认视图">
            <SettingRow label="NexoraLearning 服务" hint="关闭后隐藏当前账号的 Learning 入口(管理端服务地址在系统配置中维护)">
                <div class="settings-mode-toggle" role="tablist" aria-label="NexoraLearning 服务">
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_runtime !== false }"
                        type="button"
                        @click="handleLearningRuntimeImmediate(true)"
                    >启用</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_runtime === false }"
                        type="button"
                        @click="handleLearningRuntimeImmediate(false)"
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
                        @click="handleLearningModeImmediate('off')"
                    >Nexora</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_mode === 'on' }"
                        :disabled="form.learning_runtime === false"
                        type="button"
                        @click="handleLearningModeImmediate('on')"
                    >Learning</button>
                </div>
            </SettingRow>
        </SettingCard>

        <SettingCard title="用户记忆">
            <div class="settings-memory-row">
                <div class="settings-memory-model-field">
                    <div class="settings-memory-model-label">记忆更新模型</div>
                    <SettingModelSelect
                        v-model="settingsModel"
                        placeholder="使用当前对话模型"
                        width="min(100%, 320px)"
                    />
                </div>
            </div>
            <textarea
                id="settingsMemoryProfile"
                v-model="memoryText"
                class="gddp-input settings-memory-textarea"
                rows="7"
                readonly
                placeholder="正在读取用户记忆..."
            ></textarea>
            <div class="settings-memory-actions">
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
    import { computed, onMounted, reactive, ref } from 'vue'

    import { apiFetch } from '@/api/client'
    import type { UserPreferences } from '@/api/preferences'
    import { fetchUserPreferences, saveUserPreferences } from '@/api/preferences'
    import { showError, showToast } from '@/stores/notify'

    import { isThemePreference, setTheme, theme, type ThemePreference } from '@/ui/theme'

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

    /*
     * 主题下拉的读写模型:
     *   - get 读表单值(服务器回填只改 form.theme,不经过 setter,绝不反向改变当前主题);
     *   - set 仅在用户操作下拉时触发:立即应用主题(保存前可预览),持久化仍由 handleSave 落库。
     * 此前用 watch(form.theme) 存在竞态:watch 默认异步 flush,
     * load() 的 finally 同步清掉 loading 后回调才执行,守卫失效导致
     * 打开面板被服务器旧值"莫名其妙切回暗色"。computed setter 无此问题。
     */
    const themeModel = computed<ThemePreference>({
        get: () => (isThemePreference(form.theme) ? form.theme : 'system'),
        set: (value) => {
            form.theme = value
            setTheme(value)
        },
    })

    /**
     * 记忆模型与对话模型完全解耦:
     *   - 显示:直接透出记忆偏好,空字符串即"使用当前对话模型"(跟随对话动态解析,见后端 _resolve_analysis_model);
     *   - 修改:只写 form.memory_update_model,点"保存偏好"才落库,绝不触碰 modelStore.selectedId。
     * 此前 get 用 `form || modelStore.selectedId` 回退,导致空偏好被快照为当前对话模型名;
     * set 又调用 modelStore.selectModel,导致改记忆模型污染左上角对话模型。
     */
    const settingsModel = computed<string>({
        get: () => form.memory_update_model,
        set: (value: string) => {
            form.memory_update_model = value
        },
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

    /** 学习服务开关即刻同步（无需点击保存，前端马上更新） */
    async function handleLearningRuntimeImmediate(enabled: boolean): Promise<void> {
        if (form.learning_runtime === enabled) return
        const prev = form.learning_runtime
        form.learning_runtime = enabled
        try {
            await saveUserPreferences({ learning_runtime: { enabled } })
            showToast(enabled ? 'Learning 已启用' : 'Learning 已禁用', 'success')
            window.dispatchEvent(new CustomEvent('nexora:preferences-updated', {
                detail: { learning_runtime: enabled },
            }))
            // 同步缓存，供刷新闪现优化
            try { localStorage.setItem('nexora_learning_enabled', JSON.stringify(enabled)) } catch {}
        } catch (error) {
            form.learning_runtime = prev
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 学习模式即刻同步（切换 Nexora/Learning 时立即落库并刷新侧栏） */
    async function handleLearningModeImmediate(value: string): Promise<void> {
        const normalized = value === 'on' ? 'on' : 'off'
        if (form.learning_mode === normalized) return
        const prevMode = form.learning_mode
        const prevView = form.default_open_view
        const normalizedDefaultView = normalized === 'on' ? 'learning' : 'nexora'
        form.learning_mode = normalized
        form.default_open_view = normalizedDefaultView
        try {
            await saveUserPreferences({ learning_mode: normalized, default_open_view: normalizedDefaultView })
            showToast(normalized === 'on' ? '已切换至 Learning 模式' : '已切换至 Nexora 模式', 'success')
            window.dispatchEvent(new CustomEvent('nexora:preferences-updated', {
                detail: { learning_mode: normalized, default_open_view: normalizedDefaultView },
            }))
        } catch (error) {
            form.learning_mode = prevMode
            form.default_open_view = prevView
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 填充表单(仅覆盖存在的键) */
    function applyPreferences(preferences: UserPreferences): void {
        /*
         * 主题表单始终显示当前实际偏好(theme.preference),不回填服务器旧值:
         * 否则面板下拉与界面实际明暗不一致,保存时还会把旧值写回服务器。
         * 用户改下拉经 themeModel setter 立即生效,点"保存偏好"才落服务器。
         */
        form.theme = theme.preference

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

    /** 保存偏好(默认视图与学习模式保持一致,消除重复配置) */
    async function handleSave(): Promise<void> {
        const normalizedDefaultView = form.learning_mode === 'on' ? 'learning' : 'nexora'

        // 保持表单内同步,避免下次读取仍显示旧值
        form.default_open_view = normalizedDefaultView

        try {
            await saveUserPreferences({
                theme: form.theme,
                streaming: form.streaming,
                language: form.language,
                learning_runtime: { enabled: form.learning_runtime },
                learning_mode: form.learning_mode,
                default_open_view: normalizedDefaultView,
                memory_update_model: form.memory_update_model,
            })

            showToast('偏好已保存', 'success')

            // 通知宿主(ChatView)刷新 Learning 侧栏显示与切换状态(无需刷新页面)
            try {
                window.dispatchEvent(new CustomEvent('nexora:preferences-updated', {
                    detail: {
                        learning_runtime: form.learning_runtime,
                        learning_mode: form.learning_mode,
                        default_open_view: normalizedDefaultView,
                    },
                }))
            } catch {
                // 忽略派发失败
            }
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
        color: var(--color-text-secondary);
        margin-bottom: 12px;
    }

    .settings-memory-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }

    .settings-memory-model-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .settings-memory-model-label {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .settings-memory-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 8px;
    }

    .settings-pref-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 6px;
    }
</style>