<!--
    AdminMailPanel.vue — 管理员:邮箱管理(对齐原版 settings-admin-mail-tab)

    设计:
      - GDDP 布局:左邮箱用户列表 + 右详情(权限);分组/筛选/添加操作由 SettingsModal 页头提供
      - 服务状态等杂项不再展示(原版即无)
-->

<template>
    <div class="admin-mail-panel">
        <!-- 主体:左列表 + 右详情(GDDP 框架;分组/筛选/添加操作由 SettingsModal 页头提供) -->
        <AdminPanel>
            <template #list>
                <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
                <div v-else-if="!filteredUsers.length" class="admin-user-detail-empty">暂无邮箱用户</div>
                <button
                    v-for="user in filteredUsers"
                    :key="user.username"
                    class="admin-user-item"
                    :class="{ active: selectedName === user.username }"
                    type="button"
                    @click="selectUser(user.username)"
                >
                    <span class="admin-user-avatar">
                        <i class="fa-regular fa-envelope" aria-hidden="true"></i>
                    </span>
                    <span class="admin-user-main">
                        <span class="admin-user-name">{{ user.username }}</span>
                        <span class="admin-user-meta">{{ (user.permissions || []).length }} 项权限</span>
                    </span>
                </button>
            </template>

            <template #detail>
                <div v-if="!selectedUser" class="admin-user-detail-empty mail-detail-empty">
                    <i class="fa-regular fa-envelope mail-empty-icon" aria-hidden="true"></i>
                    <span>请选择左侧邮箱用户查看详情</span>
                </div>
                <div v-else class="mail-detail-inner">
                    <div class="admin-user-detail-head">
                        <span class="admin-user-avatar">
                            <i class="fa-regular fa-envelope" aria-hidden="true"></i>
                        </span>
                        <div>
                            <div class="admin-user-name">{{ selectedUser.username }}</div>
                            <div class="admin-user-meta">{{ currentGroup }}</div>
                        </div>
                    </div>

                    <!-- 绑定对:邮箱用户 ↔ Nexora 用户 -->
                    <SettingDetailSection title="用户绑定">
                        <div class="mail-bind-pair" :class="{ 'mail-bind-single': !boundUser }">
                            <div v-if="boundUser" class="mail-bind-item">
                                <span class="mail-bind-avatar">
                                    <img v-if="boundUser.avatar_url" :src="boundUser.avatar_url" alt="">
                                    <i v-else class="fa-solid fa-user" aria-hidden="true"></i>
                                </span>
                                <div class="mail-bind-info">
                                    <div class="mail-bind-name">{{ boundUser.username || boundUser.user_id }}</div>
                                </div>
                            </div>
                        </div>
                        <div class="mail-bind-input-row">
                            <input
                                v-model="bindUserId"
                                class="input-modern"
                                type="text"
                                placeholder="输入 Nexora 用户ID"
                            >
                            <button class="btn-primary-outline" type="button" :disabled="binding" @click="handleBind">
                                {{ boundUser ? '重新绑定' : '绑定' }}
                            </button>
                            <button v-if="boundUser" class="btn-danger-small" type="button" :disabled="binding" @click="handleUnbind">
                                解绑
                            </button>
                        </div>
                    </SettingDetailSection>

                    <!-- 用户信息 -->
                    <SettingDetailSection title="用户信息">
                        <div class="mail-info-grid">
                            <div class="mail-info-cell">
                                <span class="mail-info-label">邮箱用户名</span>
                                <span class="mail-info-value">{{ selectedUser.username }}</span>
                            </div>
                            <div class="mail-info-cell">
                                <span class="mail-info-label">权限</span>
                                <span class="mail-info-value">{{ (selectedUser.permissions || []).join(', ') || '-' }}</span>
                            </div>
                            <div class="mail-info-cell mail-info-cell-full">
                                <span class="mail-info-label">存储路径</span>
                                <span class="mail-info-value mono">{{ selectedUser.path || '-' }}</span>
                            </div>
                        </div>
                    </SettingDetailSection>

                    <!-- 操作 -->
                    <SettingActionRow>
                        <button class="btn-primary-outline" type="button" @click="resetOpen = true">
                            <i class="fa-solid fa-key" aria-hidden="true"></i>
                            <span>重置密码</span>
                        </button>
                        <button class="btn-danger-small" type="button" @click="handleDelete">
                            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                            <span>删除用户</span>
                        </button>
                    </SettingActionRow>
                </div>
            </template>
        </AdminPanel>

        <!-- 添加邮箱用户弹窗 -->
        <Modal :open="addOpen" title="添加邮箱用户" size="sm" @close="addOpen = false">
            <div class="form-group">
                <label for="mailUserUsername">用户名</label>
                <input id="mailUserUsername" v-model="addForm.mail_username" class="input-modern" type="text" maxlength="80" placeholder="例如:alice">
            </div>
            <div class="form-group">
                <label for="mailUserPassword">密码</label>
                <input id="mailUserPassword" v-model="addForm.password" class="input-modern" type="password" maxlength="120" placeholder="输入密码">
            </div>
            <div class="form-group">
                <label>权限</label>
                <div class="admin-mail-permissions">
                    <label v-for="permission in ['receive', 'sendlocal', 'sendrelay', 'sendoutside']" :key="permission" class="settings-toggle-row">
                        <input v-model="addForm.permissions" type="checkbox" :value="permission">
                        <span>{{ permission }}</span>
                    </label>
                </div>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="addOpen = false">取消</button>
                <button class="btn-confirm" type="button" @click="submitAdd">创建</button>
            </template>
        </Modal>
        <!-- 重置密码弹窗 -->
        <Modal :open="resetOpen" title="重置邮箱密码" size="sm" @close="resetOpen = false">
            <div class="form-group">
                <label for="mailUserResetPassword">新密码</label>
                <input id="mailUserResetPassword" v-model="resetPassword" class="input-modern" type="password" maxlength="120" placeholder="输入新密码">
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="resetOpen = false">取消</button>
                <button class="btn-confirm" type="button" @click="submitReset">重置</button>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { AdminUser } from '@/api/admin-users'
    import { listAdminUsers } from '@/api/admin-users'
    import type { MailUser } from '@/api/admin-mail'
    import { bindMailForUser, createMailUser, deleteMailUser, fetchMailGroups, fetchMailUsers, resetMailUserPassword, unbindMailForUser } from '@/api/admin-mail'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import AdminPanel from '@/ui/AdminPanel.vue'
    import Modal from '@/ui/Modal.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingDetailSection from '@/ui/settings/SettingDetailSection.vue'

    const users = ref<MailUser[]>([])
    const groups = ref<string[]>([])
    const currentGroup = ref('')
    const loading = ref(false)
    const query = ref('')
    const selectedName = ref('')

    /** Nexora 用户缓存(用于展示绑定对,对齐原版 getAdminUsersRuntime getUsersCache) */
    const adminUsers = ref<AdminUser[]>([])
    const bindUserId = ref('')
    const binding = ref(false)

    /** 添加邮箱用户弹窗状态 */
    const addOpen = ref(false)
    const addForm = reactive({
        mail_username: '',
        password: '',
        permissions: [] as string[],
    })

    /** 重置密码弹窗状态 */
    const resetOpen = ref(false)
    const resetPassword = ref('')

    const filteredUsers = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return users.value
        }

        return users.value.filter((user) => {
            const haystack = [user.username, String(user.path || ''), ...(user.permissions || [])].join(' ').toLowerCase()

            return haystack.includes(keyword)
        })
    })

    const selectedUser = computed(() => {
        return users.value.find((user) => user.username === selectedName.value) || null
    })

    /** 当前邮箱用户绑定的 Nexora 用户(按 local_mail.username + group 匹配,对齐原版 renderAdminMailUserDetail) */
    const boundUser = computed<AdminUser | null>(() => {
        const user = selectedUser.value

        if (!user) {
            return null
        }

        return adminUsers.value.find((item) => {
            const lm = item.local_mail || {}

            return (lm.username || '') === user.username && (lm.group || 'default') === currentGroup.value
        }) || null
    })

    onMounted(() => {
        void load()
    })

    /** 拉取分组列表 + 默认组用户 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const groupList = await fetchMailGroups().catch(() => [])

            groups.value = groupList.length ? groupList : ['default']
            currentGroup.value = groups.value[0]

            // 拉取 Nexora 用户列表用于绑定对展示(对齐原版 loadAdminUsersList)
            adminUsers.value = await listAdminUsers().catch(() => [])

            await loadUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载邮箱用户失败')
        } finally {
            loading.value = false
        }
    }

    /** 按当前分组拉取用户 */
    async function loadUsers(): Promise<void> {
        try {
            users.value = await fetchMailUsers(currentGroup.value)
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载邮箱用户失败')
        }
    }

    /** 切换分组(对齐原版 setAdminMailGroup) */
    async function switchGroup(group: string): Promise<void> {
        currentGroup.value = group
        selectedName.value = ''
        await loadUsers()
    }

    function selectUser(username: string): void {
        selectedName.value = username
        bindUserId.value = ''
    }

    /** 绑定邮箱用户到 Nexora 用户(对齐原版 adminBindNexoraUserForMail:PUT local-mail) */
    async function handleBind(): Promise<void> {
        const user = selectedUser.value

        if (!user) {
            return
        }

        const userId = bindUserId.value.trim()

        if (!userId) {
            showToast('请输入目标 Nexora 用户ID', 'warning')

            return
        }

        binding.value = true

        try {
            await bindMailForUser({
                user_id: userId,
                group: currentGroup.value,
                mail_username: user.username,
            })

            showToast('绑定已更新', 'success')
            bindUserId.value = ''
            adminUsers.value = await listAdminUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '绑定失败')
        } finally {
            binding.value = false
        }
    }

    /** 解绑邮箱(对齐原版 DELETE /api/admin/users/<user_id>/local-mail) */
    async function handleUnbind(): Promise<void> {
        const target = boundUser.value

        if (!target) {
            return
        }

        const confirmed = await showConfirm({
            title: '解绑邮箱',
            content: `确定解绑「${target.username || target.user_id}」的本地邮箱吗?`,
            confirmText: '解绑',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        binding.value = true

        try {
            await unbindMailForUser(target.user_id)

            showToast('已解绑', 'success')
            adminUsers.value = await listAdminUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '解绑失败')
        } finally {
            binding.value = false
        }
    }

    /** 打开添加邮箱用户弹窗(显示当前分组) */
    function handleAdd(): void {
        addForm.mail_username = ''
        addForm.password = ''
        addForm.permissions = ['receive', 'sendlocal']
        addOpen.value = true
    }

    /** 提交创建邮箱用户(对齐原版 admin_nexora_mail_create_user:含 group) */
    async function submitAdd(): Promise<void> {
        const username = addForm.mail_username.trim()

        if (!username || !addForm.password) {
            showToast('用户名和密码不能为空', 'warning')

            return
        }

        try {
            await createMailUser({
                mail_username: username,
                password: addForm.password,
                permissions: addForm.permissions,
                group: currentGroup.value,
            })

            showToast('邮箱用户已创建', 'success')
            addOpen.value = false
            await loadUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }

    /** 提交重置密码 */
    async function submitReset(): Promise<void> {
        const user = selectedUser.value

        if (!user) {
            return
        }

        if (!resetPassword.value) {
            showToast('请输入新密码', 'warning')

            return
        }

        try {
            await resetMailUserPassword(currentGroup.value, user.username, resetPassword.value)

            showToast('密码已重置', 'success')
            resetOpen.value = false
            resetPassword.value = ''
        } catch (error) {
            showError(error instanceof Error ? error.message : '重置失败')
        }
    }

    /** 删除邮箱用户(对齐原版 adminDeleteMailUser) */
    async function handleDelete(): Promise<void> {
        const user = selectedUser.value

        if (!user) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除邮箱用户',
            content: `确定删除「${user.username}」吗?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteMailUser(currentGroup.value, user.username)

            showToast('邮箱用户已删除', 'success')
            selectedName.value = ''
            await loadUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 页头分组下拉选择(对齐原版 switchGroup) */
    function setGroup(group?: string): void {
        if (group) {
            void switchGroup(group)
        }
    }

    /** 页头筛选输入转发 */
    function setQuery(value?: string): void {
        query.value = String(value || '')
    }

    defineExpose({
        handleAdd,
        load,
        setGroup,
        setQuery,
    })
</script>

<style scoped>
    /* ==================== 面板容器 ==================== */

    .admin-mail-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    /* ==================== 列表项 ==================== */

    /* 列表与详情基础布局、列表项视觉由 AdminPanel 与设置壳统一提供。 */

    /* ==================== 空状态 ==================== */

    .mail-detail-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        height: 100%;
        min-height: 200px;
    }

    .mail-empty-icon {
        font-size: 24px;
        color: var(--color-text-secondary);
    }

    /* ==================== 详情区 ==================== */

    .mail-detail-inner {
        display: flex;
        flex-direction: column;
    }

    /* ==================== 绑定对 ==================== */

    .mail-bind-pair {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }

    .mail-bind-single {
        justify-content: center;
    }

    .mail-bind-item {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
    }

    .mail-bind-avatar {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
        font-size: 13px;
        overflow: hidden;
    }

    .mail-bind-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .mail-bind-info {
        flex: 1;
        min-width: 0;
    }

    .mail-bind-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .mail-bind-meta {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-top: 2px;
    }

    .mail-bind-arrow {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .mail-bind-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .mail-bind-input-row .input-modern {
        flex: 1;
        min-width: 0;
    }

    /* ==================== 用户信息网格 ==================== */

    .mail-info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    .mail-info-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .mail-info-cell-full {
        grid-column: 1 / -1;
    }

    .mail-info-label {
        font-size: 11px;
        font-weight: 550;
        color: var(--color-text-secondary);
    }

    .mail-info-value {
        font-size: 13px;
        color: var(--color-text-primary);
        word-break: break-all;
    }
</style>
