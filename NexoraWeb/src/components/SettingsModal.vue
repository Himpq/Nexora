<!--
    SettingsModal.vue — 设置窗口(原版 #settingsModal 结构,legacy Modal 模式)

    布局(与原版 chat.html 完全一致):
      #settingsModal.modal-backdrop > .modal.settings-modal-custom
        > .modal-head(设置 + ×)
        > .modal-body > .admin-shell.settings-shell
          > aside.admin-nav.settings-nav(基础 tab + 管理员 tab,按角色显示)
          > section.admin-content.settings-content(各 tab 详情)

    依赖原版 CSS:style.css / chat_settings_dialog.css / chat_settings_management.css / chat_papi_keys.css
    (原版所有规则都挂在 #settingsModal 下,因此 Modal 组件以 legacy + rootId 模式渲染)
-->

<template>
    <Modal
        :open="open"
        legacy
        root-id="settingsModal"
        title="设置"
        modal-class="settings-modal-custom"
        :show-close="false"
        @close="emit('close')"
    >
        <!-- 原版 modal-head:设置 + × -->
        <template #head>
            <h3>设置</h3>
            <button class="btn-modal-close" type="button" title="关闭" @click="emit('close')">×</button>
        </template>

        <div class="admin-shell settings-shell">
            <aside class="admin-nav settings-nav">
                <button
                    v-for="tab in baseTabs"
                    :key="tab.key"
                    type="button"
                    class="admin-tab"
                    :class="{ active: activeTab === tab.key }"
                    :data-tab="tab.key"
                    @click="activeTab = tab.key"
                >
                    {{ tab.label }}
                </button>

                <!-- 基础与管理员 tab 之间的虚线分隔(对齐原版 settings-nav-gap) -->
                <div v-if="isAdmin" class="settings-nav-gap"></div>

                <button
                    v-for="tab in adminTabs"
                    :key="tab.key"
                    type="button"
                    class="admin-tab settings-admin-entry"
                    :class="{ active: activeTab === tab.key }"
                    :data-tab="tab.key"
                    @click="activeTab = tab.key"
                >
                    {{ tab.label }}
                </button>
            </aside>

            <section class="admin-content settings-content">
                <!-- 个人资料(对齐原版 settings-profile-tab:头像面板 + 资料 + 统计) -->
                <div v-if="activeTab === 'profile'" id="settings-profile-tab" class="admin-tab-content active">
                    <div class="settings-placeholder">个人资料</div>
                    <div class="settings-profile-head">
                        <div class="settings-avatar-panel">
                            <img
                                v-if="userStore.avatarUrl"
                                id="settingsAvatarImg"
                                class="settings-avatar"
                                :src="userStore.avatarUrl"
                                alt="avatar"
                                @error="userStore.avatarUrl = ''"
                            >
                            <div v-else id="settingsAvatarImg" class="settings-avatar settings-avatar-placeholder">{{ avatarChar }}</div>
                            <div class="settings-avatar-actions">
                                <button class="btn-primary-outline" type="button" @click="openAvatarPicker">上传头像</button>
                                <input ref="avatarFileInput" type="file" accept="image/*" style="display:none" @change="handleAvatarFile" />
                            </div>
                        </div>
                        <div class="settings-profile-meta">
                            <div class="form-group">
                                <label>用户名</label>
                                <input
                                    id="set-username-input"
                                    v-model="profileName"
                                    class="input-modern"
                                    type="text"
                                    maxlength="60"
                                    placeholder="输入用户名"
                                >
                            </div>
                            <div class="settings-userid-inline">UserID: {{ userStore.userId || '-' }}</div>
                            <div class="form-group">
                                <label>角色</label>
                                <div class="settings-field">{{ roleLabel }}</div>
                            </div>
                            <div class="form-group settings-profile-actions">
                                <button class="btn-primary btn-compact" type="button" @click="saveProfile">保存资料</button>
                            </div>
                        </div>
                    </div>
                    <div class="settings-profile-stats-grid">
                        <div class="form-group">
                            <label>创建时间</label>
                            <div class="settings-field">{{ formatUserTime(userStore.user?.created_at) }}</div>
                        </div>
                        <div class="form-group">
                            <label>最后登录</label>
                            <div class="settings-field">{{ formatUserTime(userStore.user?.last_login) }}</div>
                        </div>
                        <div class="form-group">
                            <label>对话数</label>
                            <div class="settings-field">{{ stats.total_conversations ?? '-' }}</div>
                        </div>
                        <div class="form-group">
                            <label>Token 消耗</label>
                            <div class="settings-field">{{ formatTokens(stats.total_tokens) }}</div>
                        </div>
                        <div class="form-group">
                            <label>知识点数</label>
                            <div class="settings-field">{{ stats.total_knowledge ?? '-' }}</div>
                        </div>
                    </div>
                </div>

                <!-- 偏好设置 -->
                <div v-if="activeTab === 'preferences'" class="admin-tab-content active">
                    <div class="settings-placeholder">偏好设置</div>
                    <PreferencesPanel />
                </div>

                <!-- Skill -->
                <div v-if="activeTab === 'skills'" class="admin-tab-content active">
                    <div class="settings-placeholder">Skill</div>
                    <SkillsPanel />
                </div>

                <!-- 使用统计 -->
                <div v-if="activeTab === 'statistics'" class="admin-tab-content active">
                    <div class="settings-placeholder">使用统计</div>
                    <div class="settings-stat-summary-grid">
                        <div class="form-group">
                            <label>对话数</label>
                            <div class="settings-stat">{{ stats.total_conversations ?? '-' }}</div>
                        </div>
                        <div class="form-group">
                            <label>Token 消耗</label>
                            <div class="settings-stat">{{ formatTokens(stats.total_tokens) }}</div>
                        </div>
                        <div class="form-group">
                            <label>知识点数</label>
                            <div class="settings-stat">{{ stats.total_knowledge ?? '-' }}</div>
                        </div>
                    </div>
                </div>

                <!-- 我的 API Key -->
                <div v-if="activeTab === 'user-api-keys'" class="admin-tab-content active settings-management-panel active">
                    <UserApiKeysPanel />
                </div>

                <!-- ===== 管理员面板(统一 AdminPanel 布局,GDDP 可复用组件) ===== -->
                <!-- 已实现:用户管理 / 系统设置 / 统计信息 / 向量库 / 模型管理 / 认证管理;其余 tab 待接入 -->
                <div v-if="activeTab === 'admin-users'" class="admin-tab-content active settings-management-panel active">
                    <AdminUsersPanel />
                </div>

                <div v-if="activeTab === 'admin-system'" class="admin-tab-content active settings-management-panel active">
                    <AdminSystemPanel />
                </div>

                <div v-if="activeTab === 'admin-stats'" class="admin-tab-content active">
                    <div class="settings-placeholder">统计信息</div>
                    <AdminStatsPanel />
                </div>

                <div v-if="activeTab === 'admin-chroma'" class="admin-tab-content active">
                    <div class="settings-placeholder">向量库</div>
                    <AdminChromaPanel />
                </div>

                <div v-if="activeTab === 'admin-models'" class="admin-tab-content active settings-management-panel active">
                    <AdminModelsPanel />
                </div>

                <div v-if="activeTab === 'admin-auth'" class="admin-tab-content active settings-management-panel active">
                    <AdminAuthPanel />
                </div>

                <div v-if="activeTab === 'admin-gen-image'" class="admin-tab-content active settings-management-panel active">
                    <AdminGenImagePanel />
                </div>

                <div v-if="activeTab === 'admin-map'" class="admin-tab-content active settings-management-panel active">
                    <AdminMapPanel />
                </div>

                <div v-if="activeTab === 'admin-mail'" class="admin-tab-content active settings-management-panel active">
                    <AdminMailPanel />
                </div>
            </section>
        </div>

        <!-- 头像裁切弹窗 -->
        <AvatarCropModal
            ref="avatarCropRef"
            :open="avatarCropOpen"
            @close="avatarCropOpen = false"
            @saved="userStore.refreshAvatar()"
        />
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, watch } from 'vue'

    import { apiFetch } from '@/api/client'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import Modal from '@/ui/Modal.vue'

    import AvatarCropModal from './AvatarCropModal.vue'
    import AdminAuthPanel from './AdminAuthPanel.vue'
    import AdminChromaPanel from './AdminChromaPanel.vue'
    import AdminGenImagePanel from './AdminGenImagePanel.vue'
    import AdminMailPanel from './AdminMailPanel.vue'
    import AdminMapPanel from './AdminMapPanel.vue'
    import AdminModelsPanel from './AdminModelsPanel.vue'
    import AdminStatsPanel from './AdminStatsPanel.vue'
    import AdminSystemPanel from './AdminSystemPanel.vue'
    import AdminUsersPanel from './AdminUsersPanel.vue'
    import PreferencesPanel from './PreferencesPanel.vue'
    import SkillsPanel from './SkillsPanel.vue'
    import UserApiKeysPanel from './UserApiKeysPanel.vue'

    const emit = defineEmits<{
        close: []
    }>()

    const props = defineProps<{
        open: boolean
    }>()

    const userStore = useUserStore()

    const activeTab = ref('profile')
    const avatarCropOpen = ref(false)
    const avatarCropRef = ref<InstanceType<typeof AvatarCropModal> | null>(null)
    const avatarFileInput = ref<HTMLInputElement | null>(null)

    /** 个人资料:用户名编辑值 */
    const profileName = ref('')

    /** 保存资料(显示名;对齐原版 saveProfileBtn → PUT /api/user/profile) */
    async function saveProfile(): Promise<void> {
        const name = profileName.value.trim()

        if (!name || name === userStore.username) {
            return
        }

        try {
            const data = await apiFetch<{ success: boolean; user?: { username?: string } }>('/api/user/profile', {
                method: 'PUT',
                body: JSON.stringify({ display_name: name }),
            })

            if (data.user?.username) {
                userStore.user = {
                    ...userStore.user,
                    username: data.user.username,
                } as typeof userStore.user
            }

            showToast('资料已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 用户时间格式化(秒时间戳 → 本地时间) */
    function formatUserTime(value: unknown): string {
        const n = Number(value || 0)

        if (!n) {
            return '-'
        }

        try {
            const ms = n > 1000000000000 ? n : n * 1000

            return new Date(ms).toLocaleString()
        } catch {
            return '-'
        }
    }

    /** 打开文件选择器 */
    function openAvatarPicker(): void {
        avatarFileInput.value?.click()
    }

    /** 选择图片后打开裁切弹窗 */
    function handleAvatarFile(event: Event): void {
        const input = event.target as HTMLInputElement
        const file = input.files?.[0]

        if (!file) {
            return
        }

        avatarCropOpen.value = true

        // 下一帧再 openWithFile(等弹窗渲染)
        setTimeout(() => {
            avatarCropRef.value?.openWithFile(file)
        }, 50)

        input.value = ''
    }

    /** 是否管理员(对齐原版 checkUserRole:管理员显示 admin 入口) */
    const isAdmin = computed(() => {
        return String(userStore.user?.role || '').toLowerCase() === 'admin'
    })

    /** 头像首字符 */
    const avatarChar = computed(() => {
        const name = userStore.username || 'U'

        return name.charAt(0).toUpperCase()
    })

    /** 角色友好显示 */
    const roleLabel = computed(() => {
        const role = userStore.user?.role || 'member'
        const labels: Record<string, string> = {
            admin: '管理员',
            member: '成员',
        }

        return labels[String(role)] || String(role)
    })

    /** 基础菜单(与原版 settings-nav 一致) */
    const baseTabs = [
        { key: 'profile', label: '个人资料', admin: false },
        { key: 'preferences', label: '偏好设置', admin: false },
        { key: 'skills', label: 'Skill', admin: false },
        { key: 'statistics', label: '使用统计', admin: false },
        { key: 'user-api-keys', label: '我的 API Key', admin: false },
    ]

    /** 管理员菜单(对齐原版 settings-admin-entry 列表) */
    const adminTabs = [
        { key: 'admin-system', label: '系统设置', admin: true },
        { key: 'admin-users', label: '用户管理', admin: true },
        { key: 'admin-mail', label: '邮箱管理', admin: true },
        { key: 'admin-models', label: '模型管理', admin: true },
        { key: 'admin-gen-image', label: '生图 API', admin: true },
        { key: 'admin-map', label: '地图 API', admin: true },
        { key: 'admin-auth', label: '认证管理', admin: true },
        { key: 'admin-stats', label: '统计信息', admin: true },
        { key: 'admin-chroma', label: '向量库', admin: true },
    ]

    /** 使用统计 */
    const stats = ref<{
        total_conversations?: number
        total_tokens?: number
        total_knowledge?: number
        model_usage?: Record<string, unknown>
    }>({})

    function formatTokens(value: unknown): string {
        const num = Number(value || 0)

        return Number.isFinite(num) ? num.toLocaleString() : '-'
    }

    /** 打开时重置到个人资料页 */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                activeTab.value = 'profile'
                profileName.value = userStore.username

                // 打开时刷新头像(带版本号防缓存)
                userStore.refreshAvatar()
            }
        }
    )

    onMounted(() => {
        apiFetch<{ success: boolean; stats?: typeof stats.value }>('/api/user/stats')
            .then((data) => {
                if (data.stats) {
                    stats.value = data.stats
                }
            })
            .catch(() => undefined)
    })
</script>
