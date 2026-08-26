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
        :width="modalWidth"
        :height="modalHeight"
        :title="modalTitle"
        modal-class="settings-modal"
        @close="emit('close')"
    >
        <div class="settings-modal-shell" :class="{ 'is-drilled': isCompactViewport && mobileLevel === 2 }">
            <SettingsNav :groups="navGroups" :active="activeTab" @select="onTabSelect" />

            <section class="settings-main">
                <!-- 手机端二级页返回条(桌面端由 CSS 隐藏) -->
                <button type="button" class="settings-mobile-back" @click="mobileLevel = 1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span>返回分类</span>
                </button>

                <SettingsPageHeader
                    :title="activeTabMeta?.title"
                    :description="activeTabMeta?.description"
                    :actions="activeTabActions"
                    :selects="headSelects"
                    :subtabs="headSubTabs"
                    @action="runPanelAction"
                    @select="onHeadSelect"
                    @subtab="onHeadSubTab"
                />

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
                                            class="gddp-input settings-profile-name-input"
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
                        <SkillsPanel :ref="(el) => setPanelRef('skills', el)" />
                    </template>

                    <!-- 使用统计 -->
                    <template v-else-if="activeTab === 'statistics'">
                        <UserStatsPanel />
                    </template>

                    <!-- 我的 API Key -->
                    <template v-else-if="activeTab === 'user-api-keys'">
                        <UserApiKeysPanel :ref="(el) => setPanelRef('user-api-keys', el)" />
                    </template>

                    <!-- 管理员面板 -->
                    <template v-else-if="activeTab === 'admin-users'">
                        <AdminUsersPanel :ref="(el) => setPanelRef('admin-users', el)" />
                    </template>

                    <template v-else-if="activeTab === 'admin-system'">
                        <AdminSystemPanel :ref="(el) => setPanelRef('admin-system', el)" />
                    </template>

                    <template v-else-if="activeTab === 'admin-stats'">
                        <AdminStatsPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-chroma'">
                        <AdminChromaPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-models'">
                        <AdminModelsPanel :ref="(el) => setPanelRef('admin-models', el)" />
                    </template>

                    <template v-else-if="activeTab === 'admin-auth'">
                        <AdminAuthPanel :ref="(el) => setPanelRef('admin-auth', el)" />
                    </template>

                    <template v-else-if="activeTab === 'admin-gen-image'">
                        <AdminGenImagePanel :ref="(el) => setPanelRef('admin-gen-image', el)" />
                    </template>

                    <template v-else-if="activeTab === 'admin-map'">
                        <AdminMapPanel />
                    </template>

                    <template v-else-if="activeTab === 'admin-mail'">
                        <AdminMailPanel :ref="(el) => setPanelRef('admin-mail', el)" />
                    </template>
                </div>
            </section>
        </div>

        <!-- 头像裁切弹窗 -->
        <AvatarCropModal
            ref="avatarCropRef"
            :open="avatarCropOpen"
            @close="avatarCropOpen = false"
            @cropped="onAvatarCropped"
        />
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import { apiFetch } from '@/api/client'
    import { fetchMailGroups } from '@/api/admin-mail'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'
    import Modal from '@/ui/Modal.vue'
    import SettingCard from '@/ui/settings/SettingCard.vue'
    import SettingRow from '@/ui/settings/SettingRow.vue'
    import SettingsNav, { type SettingsNavGroup } from '@/ui/settings/SettingsNav.vue'
    import SettingsPageHeader from '@/ui/settings/SettingsPageHeader.vue'

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
    import UserStatsPanel from './UserStatsPanel.vue'

    const emit = defineEmits<{
        close: []
    }>()

    const props = defineProps<{
        open: boolean
    }>()

                const userStore = useUserStore()

    /** 窄视口(≤760px):弹窗完全全屏(inset 0 无缝隙,杜绝顶栏从边缘透出的"重合"观感),
     *  布局由 settings.css 切为两级导航(一级分类页 → 二级内容页) */
    const isCompactViewport = ref(false)

    /** 手机端导航层级:1=分类列表页,2=内容页(点击分类进入) */
    const mobileLevel = ref<1 | 2>(1)

    /**
     * 紧凑视口判定:820px 断点 + 触屏设备强制命中。
     * 之前用 760px 且仅 matchMedia——部分全面屏(视口 780-820)或系统缩放
     * 会导致 matchMedia 不命中,桌面 1060px 布局硬塞进手机屏,
     * 表现为"所有 tab 点不了/没有二级菜单/内容窗口极小"。
     * 触屏设备('ontouchstart' in window)一律走两级导航,不再依赖像素宽度。
     */
    function syncCompactViewport(): void {
        const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0
        isCompactViewport.value = isTouch || window.innerWidth <= 820
    }

    onMounted(() => {
        syncCompactViewport()
        window.addEventListener('resize', syncCompactViewport)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', syncCompactViewport)
    })

    const modalWidth = computed(() => (isCompactViewport.value ? '100%' : '1060px'))

    const modalHeight = computed(() => (isCompactViewport.value ? '100%' : 'min(80vh, 720px)'))

    /** 弹窗标题:手机端二级页带层级(「设置 - 偏好设置」),其余为「设置」 */
    const modalTitle = computed(() => {
        if (isCompactViewport.value && mobileLevel.value === 2 && activeTabMeta.value?.title) {
            return `设置 - ${activeTabMeta.value.title}`
        }

        return '设置'
    })

    const activeTab = ref('profile')
    const avatarCropOpen = ref(false)
    const avatarCropRef = ref<InstanceType<typeof AvatarCropModal> | null>(null)
    const avatarFileInput = ref<HTMLInputElement | null>(null)

    /** 裁切暂存的头像 base64(对齐原版 pendingAvatarDataUrl:点击保存资料后统一上传) */
    const pendingAvatarBase64 = ref('')

    /** 个人资料:用户名编辑值 */
    const profileName = ref('')

    /** 头像背景(优先展示暂存裁切图,其次当前头像;background-cover 杜绝 img 溢出) */
    const avatarBackground = computed(() => {
        const src = pendingAvatarBase64.value || userStore.avatarUrl

        return src ? { backgroundImage: `url("${src}")` } : {}
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

    /** 面板实例注册(页头操作通过实例方法触发) */
    const panelRefs = ref<Record<string, { [key: string]: (value?: string) => unknown } | null>>({})

    function setPanelRef(key: string, el: unknown): void {
        panelRefs.value[key] = (el as { [key: string]: (value?: string) => unknown }) || null
    }

    /** 邮箱分组选项(页头下拉数据源;切到邮箱 tab 时拉取) */
    const mailGroupOptions = ref<Array<{ value: string; label: string }>>([])

    /** 页头动作:button=按钮 / select=下拉 / subtabs=胶囊子标签 */
    interface PageHeadAction {
        type?: 'button' | 'select' | 'subtabs'
        label?: string
        icon?: string
        method: string
        placeholder?: string
        options?: Array<{ value: string; label: string }>
        width?: string
        /** 按钮仅在指定子标签激活时显示(subtabs 的 value) */
        subTab?: string
    }

    /** 各 tab 页头操作:页级下拉、按钮和 Skill 子标签 */
    const pageActionsMap = computed<Record<string, PageHeadAction[]>>(() => ({
        'skills': [
            { type: 'subtabs', method: 'switchSubTab', options: [
                { value: 'my', label: '我的 Skill' },
                { value: 'market', label: 'Skill 市场' },
            ] },
            { label: '上传 Skill', icon: 'fa-solid fa-upload', method: 'triggerUpload', subTab: 'my' },
            { label: '新建 Skill', icon: 'fa-solid fa-plus', method: 'openEditor', subTab: 'my' },
        ],
        'user-api-keys': [
            { label: '新建 Key', icon: 'fa-solid fa-plus', method: 'openCreate' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-users': [
            { label: '添加用户', icon: 'fa-solid fa-user-plus', method: 'openCreate' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-models': [
            { type: 'select', method: 'setQuotaUnit', placeholder: '自动', width: '110px', options: [
                { value: 'auto', label: '自动' },
                { value: 'k', label: 'K' },
                { value: 'w', label: 'w' },
                { value: 'm', label: 'M' },
                { value: 'token', label: 'token' },
            ] },
            { label: '添加供应商', icon: 'fa-solid fa-plus', method: 'handleAddProvider' },
            { label: '添加模型', icon: 'fa-solid fa-plus', method: 'handleAddModel' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-auth': [
            { label: '生成 Public API Key', icon: 'fa-solid fa-key', method: 'openCreate' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-gen-image': [
            { label: '添加接口', icon: 'fa-solid fa-plus', method: 'handleAdd' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-map': [
            { label: '刷新状态', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-mail': [
            // options 经 computed 读取 mailGroupOptions.value,拉取后自动更新
            { type: 'select', method: 'setGroup', placeholder: '分组', width: '150px', options: mailGroupOptions.value },
            { label: '添加邮箱用户', icon: 'fa-solid fa-user-plus', method: 'handleAdd' },
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
        ],
        'admin-system': [{ label: '重新加载', icon: 'fa-solid fa-rotate-right', method: 'load' }],
    }))

    const activeTabActions = computed(() => pageActionsMap.value[activeTab.value] || [])

    /** 切 tab:重置页头下拉/子标签值,并按需拉取动态选项;手机端钻入二级内容页 */
    function onTabSelect(tab: string): void {
        activeTab.value = tab
        headSelects.value = {}
        headSubTabs.value = {}

        if (isCompactViewport.value) {
            mobileLevel.value = 2
        }

        // skills 页头子标签默认"我的 Skill"
        if (tab === 'skills') {
            headSubTabs.value = { switchSubTab: 'my' }
        }

        if (tab === 'admin-mail') {
            void loadMailGroupOptions()
        }
    }

        /** 拉取邮箱分组(对齐原版 fetchMailGroups → domains);失败显式上报并保留 default 可操作 */
    async function loadMailGroupOptions(): Promise<void> {
        try {
            const groups = await fetchMailGroups()

            mailGroupOptions.value = groups.map((group) => ({ value: group, label: group }))
        } catch (error) {
            showError(error instanceof Error ? error.message : '邮箱分组加载失败')
            mailGroupOptions.value = [{ value: 'default', label: 'default' }]
        }
    }

    /** 页头下拉值(按 action.method 索引) */
    const headSelects = ref<Record<string, string>>({})
    /** 页头子标签激活值(按 action.method 索引,切 tab 时重置) */
    const headSubTabs = ref<Record<string, string>>({})

    /** 页头下拉选择:转发给面板 setQuotaUnit / setGroup 等方法 */
    function onHeadSelect(method: string, value: string): void {
        headSelects.value[method] = value
        runPanelAction(method, value)
    }

    /** 页头子标签切换:记录激活值并转发给面板 switchSubTab 等方法 */
    function onHeadSubTab(method: string, value: string): void {
        headSubTabs.value[method] = value
        runPanelAction(method, value)
    }

    /** 执行面板页头操作(可携带筛选/下拉值) */
    function runPanelAction(method: string, value?: string): void {
        const panel = panelRefs.value[activeTab.value]

        if (panel && typeof panel[method] === 'function') {
            void panel[method](value)
        }
    }

    /** 保存资料(显示名 + 暂存头像;对齐原版 saveUserProfile → PUT /api/user/profile) */
    async function saveProfile(): Promise<void> {
        const name = profileName.value.trim()

        if (!name || (name === userStore.username && !pendingAvatarBase64.value)) {
            return
        }

        try {
            const data = await apiFetch<{ success: boolean; user?: { username?: string } }>('/api/user/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    display_name: name,
                    avatar_base64: pendingAvatarBase64.value || null,
                }),
            })

            if (data.user?.username) {
                userStore.user = {
                    ...userStore.user,
                    username: data.user.username,
                } as typeof userStore.user
            }

            pendingAvatarBase64.value = ''
            userStore.refreshAvatar()
            showToast('资料已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 裁切暂存:预览立即切换,等待保存资料时上传(对齐原版 pendingAvatarDataUrl + toast) */
    function onAvatarCropped(avatarBase64: string): void {
        pendingAvatarBase64.value = avatarBase64
        showToast('头像已裁切,点击「保存资料」后生效', 'info')
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


    /** 打开时重置到个人资料页(手机端回到一级分类页);同时收起移动端侧栏抽屉 */
    watch(
        () => props.open,
        (opened) => {
            // 设置窗打开期间隐藏移动端侧栏(legacy 抽屉 z 7600 高于弹窗 4400,会盖住设置窗)
            document.body.classList.toggle('settings-modal-open', opened)

            if (opened) {
                onTabSelect('profile')
                mobileLevel.value = 1
                profileName.value = userStore.username
                pendingAvatarBase64.value = ''

                // 打开时刷新用户信息 + 头像(带版本号防缓存;对齐原版 loadUserSettings)
                void userStore.init()
                userStore.refreshAvatar()
            }
        }
    )

    onBeforeUnmount(() => {
        // 组件卸载时兜底移除标记,避免侧栏被永久隐藏
        document.body.classList.remove('settings-modal-open')
    })

</script>
