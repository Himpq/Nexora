<!--
    SettingsModal.vue — 设置窗口(全新 UI,替换原版 #settingsModal 旧框架)

    设计:
      - GDDP Modal(现代遮罩/圆角),宽度 1060px
      - 左侧栏分组导航(SettingsNav 复用组件):常规 / 管理(仅管理员)
      - 右侧:页头(标题 + 说明)+ 可滚动内容区
      - 个人资料 / 偏好 / 统计等使用 SettingCard + SettingRow 复用左右布局
      - 头像一律 background-cover 圆形 div,杜绝 img 溢出
      - 管理面板(AdminPanel 系)放同壳内,视觉由 settings.css 统一接管
-->

<template>
    <Modal
        :open="open"
        width="1060px"
        modal-class="settings-modal"
        title="设置"
        @close="emit('close')"
    >
        <div class="settings-modal-shell">
            <SettingsNav :groups="navGroups" :active="activeTab" @select="activeTab = $event" />

            <section class="settings-main">
                <header class="settings-page-head">
                    <h2>{{ activeTabMeta?.title }}</h2>
                    <p>{{ activeTabMeta?.description }}</p>
                </header>

                <div class="settings-page-body">
                    <!-- 个人资料 -->
                    <template v-if="activeTab === 'profile'">
                        <SettingCard title="个人资料" description="与账号相关的基本信息与头像">
                            <div class="settings-profile-head">
                                <div class="settings-avatar-panel">
                                    <div
                                        v-if="userStore.avatarUrl"
                                        id="settingsAvatarImg"
                                        class="settings-avatar"
                                        :style="avatarBackground"
                                        alt="avatar"
                                    ></div>
                                    <div v-else id="settingsAvatarImg" class="settings-avatar settings-avatar-placeholder">{{ avatarChar }}</div>
                                    <div class="settings-avatar-actions">
                                        <button class="btn-primary-outline btn-compact" type="button" @click="openAvatarPicker">上传头像</button>
                                        <input ref="avatarFileInput" type="file" accept="image/*" style="display:none" @change="handleAvatarFile" />
                                    </div>
                                </div>
                                <div class="settings-profile-meta">
                                    <SettingRow label="用户名" hint="登录与展示所用名称">
                                        <input
                                            id="set-username-input"
                                            v-model="profileName"
                                            class="input-modern"
                                            style="width: 240px;"
                                            type="text"
                                            maxlength="60"
                                        >
                                    </SettingRow>
                                    <SettingRow label="角色">
                                        <span class="settings-field" style="background:transparent;border:none;padding:0;">{{ roleLabel }}</span>
                                    </SettingRow>
                                    <SettingRow label="UserID" hint="系统内部标识,不可修改">
                                        <span class="mono" style="font-size:12.5px;color:#8b95a7;">{{ userStore.userId || '-' }}</span>
                                    </SettingRow>
                                </div>
                            </div>
                            <div class="settings-profile-actions" style="justify-content:flex-end;">
                                <button class="btn-primary" type="button" @click="saveProfile">保存资料</button>
                            </div>
                        </SettingCard>

                        <SettingCard title="账号概览" description="账号使用情况统计">
                            <SettingRow label="创建时间">
                                <span class="settings-field" style="min-width:160px;">{{ formatUserTime(userStore.user?.created_at) }}</span>
                            </SettingRow>
                            <SettingRow label="最后登录">
                                <span class="settings-field" style="min-width:160px;">{{ formatUserTime(userStore.user?.last_login) }}</span>
                            </SettingRow>
                        </SettingCard>
                    </template>

                    <!-- 偏好设置 -->
                    <template v-else-if="activeTab === 'preferences'">
                        <PreferencesPanel />
                    </template>

                    <!-- Skill -->
                    <template v-else-if="activeTab === 'skills'">
                        <SkillsPanel />
                    </template>

                    <!-- 使用统计 -->
                    <template v-else-if="activeTab === 'statistics'">
                        <div class="settings-stat-summary-grid">
                            <div class="settings-stat-card">
                                <span class="label">对话数</span>
                                <span class="value">{{ stats.total_conversations ?? '-' }}</span>
                            </div>
                            <div class="settings-stat-card">
                                <span class="label">Token 消耗</span>
                                <span class="value">{{ formatTokens(stats.total_tokens) }}</span>
                            </div>
                            <div class="settings-stat-card">
                                <span class="label">知识点数</span>
                                <span class="value">{{ stats.total_knowledge ?? '-' }}</span>
                            </div>
                        </div>
                    </template>

                    <!-- 我的 API Key -->
                    <template v-else-if="activeTab === 'user-api-keys'">
                        <UserApiKeysPanel />
                    </template>

                    <!-- 管理员面板 -->
                    <template v-else-if="activeTab === 'admin-users'">
                        <AdminUsersPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-system'">
                        <AdminSystemPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-stats'">
                        <AdminStatsPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-chroma'">
                        <AdminChromaPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-models'">
                        <AdminModelsPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-auth'">
                        <AdminAuthPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-gen-image'">
                        <AdminGenImagePanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-map'">
                        <AdminMapPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-mail'">
                        <AdminMailPanel />
                    </template>
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
    import SettingCard from '@/ui/settings/SettingCard.vue'
    import SettingRow from '@/ui/settings/SettingRow.vue'
    import SettingsNav, { type SettingsNavGroup } from '@/ui/settings/SettingsNav.vue'

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

    /** 头像背景(background-cover,杜绝 img 溢出,对齐侧栏头像方案) */
    const avatarBackground = computed(() => {
        return userStore.avatarUrl ? { backgroundImage: `url("${userStore.avatarUrl}")` } : {}
    })

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

    /** 常规菜单 */
    const baseTabs = [
        { key: 'profile', label: '个人资料', icon: 'fa-solid fa-user', title: '个人资料', description: '管理你的头像、用户名与账号概览' },
        { key: 'preferences', label: '偏好设置', icon: 'fa-solid fa-sliders', title: '偏好设置', description: '界面主题、语言与交互偏好' },
        { key: 'skills', label: 'Skill', icon: 'fa-solid fa-wand-magic-sparkles', title: 'Skill', description: '管理个人 Skill 与浏览 Skill 市场' },
        { key: 'statistics', label: '使用统计', icon: 'fa-solid fa-chart-column', title: '使用统计', description: '你的使用情况概览' },
        { key: 'user-api-keys', label: '我的 API Key', icon: 'fa-solid fa-key', title: '我的 API Key', description: '管理对外公开的 API 密钥' },
    ]

    /** 管理员菜单 */
    const adminTabs = [
        { key: 'admin-system', label: '系统设置', icon: 'fa-solid fa-gear', title: '系统设置', description: '平台级系统参数与功能开关' },
        { key: 'admin-users', label: '用户管理', icon: 'fa-solid fa-users', title: '用户管理', description: '查看与管理平台用户' },
        { key: 'admin-mail', label: '邮箱管理', icon: 'fa-solid fa-envelope', title: '邮箱管理', description: '管理 NexoraMail 邮箱用户' },
        { key: 'admin-models', label: '模型管理', icon: 'fa-solid fa-cube', title: '模型管理', description: '供应商与模型配置维护' },
        { key: 'admin-gen-image', label: '生图 API', icon: 'fa-solid fa-image', title: '生图 API', description: '图片生成接口配置' },
        { key: 'admin-map', label: '地图 API', icon: 'fa-solid fa-map-location-dot', title: '地图 API', description: '地图服务接口配置' },
        { key: 'admin-auth', label: '认证管理', icon: 'fa-solid fa-shield-halved', title: '认证管理', description: '公开 API 认证与密钥配置' },
        { key: 'admin-stats', label: '统计信息', icon: 'fa-solid fa-chart-pie', title: '统计信息', description: 'Token 用量与系统统计数据' },
        { key: 'admin-chroma', label: '向量库', icon: 'fa-solid fa-database', title: '向量库', description: '向量数据库状态与集合' },
    ]

    /** 导航分组(常规 + 管理) */
    const navGroups = computed<SettingsNavGroup[]>(() => {
        const groups: SettingsNavGroup[] = [
            {
                label: '常规',
                items: baseTabs.map((tab) => ({ key: tab.key, label: tab.label, icon: tab.icon })),
            },
        ]

        if (isAdmin.value) {
            groups.push({
                label: '管理',
                items: adminTabs.map((tab) => ({ key: tab.key, label: tab.label, icon: tab.icon })),
            })
        }

        return groups
    })

    /** 当前激活 tab 的页头元信息 */
    const activeTabMeta = computed(() => {
        const all = [...baseTabs, ...adminTabs]

        return all.find((tab) => tab.key === activeTab.value) || baseTabs[0]
    })

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