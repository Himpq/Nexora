<!--
    AdminUsersPanel.vue — 管理员:用户管理(对齐原版 settings-admin-users-tab)

    设计:
      - 复用 AdminPanel 布局(toolbar + 左列表 + 右详情)
      - 列表:用户 ID + 角色 + token;详情:资料 + 角色切换 + 重置密码 + 删除
      - 创建用户走统一 Modal(用户名 + 密码 + 角色)
-->

<template>
    <AdminPanel>
        <template #toolbar>
            <button class="btn-primary" type="button" @click="openCreate">+ 添加新用户</button>
            <input v-model="query" class="input-modern" placeholder="筛选用户:用户名 / ID / 角色 / IP" @input="applyFilter">
        </template>

        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
            <div v-else-if="!filteredUsers.length" class="admin-user-detail-empty">暂无用户</div>
            <div
                v-for="user in filteredUsers"
                :key="user.user_id"
                class="admin-user-item"
                :class="{ active: selectedId === user.user_id }"
                role="button"
                tabindex="0"
                @click="selectUser(user)"
                @keydown.enter="selectUser(user)"
            >
                <span class="admin-user-avatar">
                    <img v-if="user.avatar_url" :src="user.avatar_url" alt="">
                    <i v-else class="fa-solid fa-user" aria-hidden="true"></i>
                </span>
                <span class="admin-user-main">
                    <span class="admin-user-name">{{ user.username || user.user_id }}</span>
                    <span class="admin-user-meta">{{ user.user_id }} · {{ roleLabel(user.role) }}</span>
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selected" class="admin-user-detail-empty">请选择左侧用户查看详情</div>
            <div v-else class="admin-user-detail-content">
                <div class="admin-user-detail-head">
                    <span class="admin-user-avatar">
                        <img v-if="selected.avatar_url" :src="selected.avatar_url" alt="">
                        <i v-else class="fa-solid fa-user" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name">{{ selected.username || selected.user_id }}</div>
                        <div class="admin-user-meta">UserID: {{ selected.user_id }}</div>
                    </div>
                </div>

                <div class="admin-user-detail-grid">
                    <div class="form-group">
                        <label>角色</label>
                        <SettingSelect v-model="detailRole" :options="roleOptions" width="140px" @update:model-value="handleRoleChange" />
                    </div>
                    <div class="form-group">
                        <label>最近登录</label>
                        <div class="admin-info-text">{{ formatTime(selected.last_login) }}</div>
                    </div>
                    <div class="form-group">
                        <label>创建时间</label>
                        <div class="admin-info-text">{{ formatTime(selected.created_at) }}</div>
                    </div>
                    <div class="form-group">
                        <label>Token 消耗</label>
                        <div class="admin-info-text mono">{{ Number(selected.total_token_usage || 0).toLocaleString() }}</div>
                    </div>
                    <div class="form-group">
                        <label>最近 IP</label>
                        <div class="admin-info-text">{{ selected.last_ip || '未知' }}</div>
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <div class="admin-info-text">{{ selected.has_password ? '已设置' : '未设置' }}</div>
                    </div>
                </div>

                <div class="papi-action-row">
                    <button class="btn-primary-outline" type="button" @click="openResetPassword">
                        <i class="fa-solid fa-key" aria-hidden="true"></i>
                        <span>重置密码</span>
                    </button>
                    <button class="btn-danger-small" type="button" @click="handleDelete">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        <span>删除用户</span>
                    </button>
                </div>
            </div>
        </template>
    </AdminPanel>

    <!-- 添加用户弹窗 -->
    <Modal :open="createOpen" title="添加新用户" size="sm" @close="createOpen = false">
        <div class="form-group">
            <label for="adminUserCreateUsername">用户名</label>
            <input
                id="adminUserCreateUsername"
                v-model="createUsername"
                class="input-modern"
                type="text"
                maxlength="60"
                placeholder="输入用户名"
            >
        </div>
        <div class="form-group">
            <label for="adminUserCreatePassword">密码</label>
            <input
                id="adminUserCreatePassword"
                v-model="createPassword"
                class="input-modern"
                type="password"
                maxlength="120"
                placeholder="输入密码"
            >
        </div>
        <div class="form-group">
            <label>角色</label>
            <SettingSelect v-model="createRole" :options="roleOptions" width="140px" />
        </div>
        <template #footer>
            <button class="btn-cancel" type="button" @click="createOpen = false">取消</button>
            <button class="btn-confirm" type="button" @click="submitCreate">创建</button>
        </template>
    </Modal>

    <!-- 重置密码弹窗 -->
    <Modal :open="resetOpen" title="重置密码" size="sm" @close="resetOpen = false">
        <div class="form-group">
            <label for="adminUserResetPassword">新密码</label>
            <input
                id="adminUserResetPassword"
                v-model="resetPassword"
                class="input-modern"
                type="password"
                maxlength="120"
                placeholder="输入新密码"
            >
        </div>
        <template #footer>
            <button class="btn-cancel" type="button" @click="resetOpen = false">取消</button>
            <button class="btn-confirm" type="button" @click="submitResetPassword">确定</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { AdminUser } from '@/api/admin-users'
    import {
        addAdminUser,
        deleteAdminUser,
        listAdminUsers,
        resetAdminUserPassword,
        setAdminUserRole,
    } from '@/api/admin-users'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const roleOptions = [
        { value: 'member', label: '成员' },
        { value: 'admin', label: '管理员' },
    ]

    const users = ref<AdminUser[]>([])
    const loading = ref(false)
    const query = ref('')
    const selectedId = ref('')

    const createOpen = ref(false)
    const createUsername = ref('')
    const createPassword = ref('')
    const createRole = ref('member')

    const resetOpen = ref(false)
    const resetPassword = ref('')

    const detailRole = ref('member')

    const selected = computed(() => {
        return users.value.find((user) => user.user_id === selectedId.value) || null
    })

    /** 筛选后的用户列表(对齐原版 adminUserFilterInput) */
    const filteredUsers = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return users.value
        }

        return users.value.filter((user) => {
            const haystack = [
                user.user_id,
                user.username,
                user.role,
                user.last_ip,
            ].join(' ').toLowerCase()

            return haystack.includes(keyword)
        })
    })

    onMounted(() => {
        void load()
    })

    /** 拉取用户列表(对齐原版 adminGetUsers) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            users.value = await listAdminUsers()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载用户失败')
        } finally {
            loading.value = false
        }
    }

    function applyFilter(): void {
        // 输入即筛选(computed 自动响应)
    }

    function selectUser(user: AdminUser): void {
        selectedId.value = user.user_id
        detailRole.value = String(user.role || 'member')
    }

    /** 角色中文标签 */
    function roleLabel(role: string): string {
        return role === 'admin' ? '管理员' : '成员'
    }

    /** 打开添加用户弹窗 */
    function openCreate(): void {
        createUsername.value = ''
        createPassword.value = ''
        createRole.value = 'member'
        createOpen.value = true
    }

    /** 提交添加用户 */
    async function submitCreate(): Promise<void> {
        const username = createUsername.value.trim()
        const password = createPassword.value

        if (!username || !password) {
            showToast('用户名和密码不能为空', 'warning')

            return
        }

        try {
            await addAdminUser({
                username,
                password,
                role: createRole.value,
            })

            showToast('用户已创建', 'success')
            createOpen.value = false
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }

    /** 修改角色 */
    async function handleRoleChange(): Promise<void> {
        if (!selected.value) {
            return
        }

        const nextRole = detailRole.value
        const currentRole = String(selected.value.role || 'member')

        if (nextRole === currentRole) {
            return
        }

        try {
            await setAdminUserRole(selected.value.user_id, nextRole)

            showToast('角色已更新', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '更新失败')
        }
    }

    /** 打开重置密码弹窗 */
    function openResetPassword(): void {
        resetPassword.value = ''
        resetOpen.value = true
    }

    /** 提交重置密码 */
    async function submitResetPassword(): Promise<void> {
        if (!selected.value) {
            return
        }

        const password = resetPassword.value

        if (!password) {
            showToast('密码不能为空', 'warning')

            return
        }

        try {
            await resetAdminUserPassword(selected.value.user_id, password)

            showToast('密码已重置', 'success')
            resetOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '重置失败')
        }
    }

    /** 删除用户 */
    async function handleDelete(): Promise<void> {
        if (!selected.value) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除用户',
            content: `确定删除用户「${selected.value.username || selected.value.user_id}」吗?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteAdminUser(selected.value.user_id)

            showToast('用户已删除', 'success')
            selectedId.value = ''
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 时间格式化 */
    function formatTime(value: number | undefined): string {
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
</script>
