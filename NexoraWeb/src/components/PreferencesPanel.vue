<!--
    PreferencesPanel.vue — 偏好设置(对齐原版 settings-preferences-tab)

    设计:
      - 复用原版 .settings-preferences-grid / .settings-mode-toggle / .settings-help-text 样式
      - 主题 / 流式输出 / 语言 / 学习模式开关,保存走统一按钮
-->

<template>
    <div class="settings-preferences-grid">
        <div class="form-group">
            <label>主题</label>
            <select v-model="form.theme" class="input-modern settings-pref-select">
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
            </select>
        </div>

        <div class="form-group">
            <label>流式输出</label>
            <label class="settings-toggle-row">
                <input v-model="form.streaming" type="checkbox">
                <span>回复时逐字流式显示</span>
            </label>
        </div>

        <div class="form-group">
            <label>语言</label>
            <select v-model="form.language" class="input-modern settings-pref-select">
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
            </select>
        </div>

        <div class="form-group settings-pref-card settings-pref-card-wide">
            <label>学习模式</label>
            <div class="settings-pref-inline">
                <div class="settings-mode-toggle" role="tablist" aria-label="学习模式">
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_mode !== 'on' }"
                        type="button"
                        @click="form.learning_mode = 'off'"
                    >Nexora</button>
                    <button
                        class="settings-mode-toggle-btn"
                        :class="{ active: form.learning_mode === 'on' }"
                        type="button"
                        @click="form.learning_mode = 'on'"
                    >Learning</button>
                </div>
            </div>
            <div class="settings-help-text">开启后默认进入 Learning 侧边栏;点击侧边栏里的 New Chat 可打开 NexoraLearning 学习界面。</div>
        </div>

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

    import type { UserPreferences } from '@/api/preferences'
    import { fetchUserPreferences, saveUserPreferences } from '@/api/preferences'
    import { showError, showToast } from '@/stores/notify'

    const loading = ref(false)

    const form = reactive<{
        theme: string
        streaming: boolean
        language: string
        learning_mode: string
    }>({
        theme: 'system',
        streaming: true,
        language: 'zh',
        learning_mode: 'off',
    })

    onMounted(() => {
        void load()
    })

    /** 拉取偏好并填充表单 */
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

        if (typeof preferences.learning_mode === 'string') {
            form.learning_mode = preferences.learning_mode
        }
    }

    /** 保存偏好 */
    async function handleSave(): Promise<void> {
        try {
            await saveUserPreferences({
                theme: form.theme,
                streaming: form.streaming,
                language: form.language,
                learning_mode: form.learning_mode,
            })

            showToast('偏好已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }
</script>
