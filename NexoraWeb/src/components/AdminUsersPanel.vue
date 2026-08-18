<!--
    AdminUsersPanel.vue — 管理员:用户管理(对齐原版 settings-admin-users-tab)

    设计:
      - 复用 AdminPanel 布局(toolbar + 左列表 + 右详情)
      - 列表:用户 ID + 角色 + token;详情:资料 + 角色切换 + 重置密码 + 删除
      - 创建用户走统一 Modal(用户名 + 密码 + 角色)
-->

<template>
    <AdminPanel>
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
                        <label>用户名</label>
                        <input v-model="detailDisplayName" class="input-modern" type="text" maxlength="32" placeholder="显示名称">
                    </div>
                    <div class="form-group">
                        <label>角色</label>
                        <SettingSelect v-if="!isSelf" v-model="detailRole" :options="roleOptions" width="140px" />
                        <div v-else class="admin-info-text">{{ roleLabel(detailRole) }}(本人不可改)</div>
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

                <SettingActionRow>
                    <button class="btn-primary" type="button" @click="saveProfile">
                        <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                        <span>保存资料</span>
                    </button>
                    <button class="btn-primary-outline" type="button" @click="openModelPerm">
                        <i class="fa-solid fa-lock" aria-hidden="true"></i>
                        <span>模型权限</span>
                    </button>
                    <button class="btn-primary-outline" type="button" @click="openResetPassword">
                        <i class="fa-solid fa-key" aria-hidden="true"></i>
                        <span>重置密码</span>
                    </button>
                    <button v-if="!isSelf" class="btn-danger-small" type="button" @click="handleDelete">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        <span>删除用户</span>
                    </button>
                </SettingActionRow>
            </div>
        </template>
    </AdminPanel>

    <!-- 模型权限弹窗(对齐原版 modelPermModal) -->
    <Modal :open="modelPermOpen" title="模型权限" size="lg" @close="modelPermOpen = false">
        <div class="settings-help-text" style="margin-bottom:12px;">
            为「{{ permTargetUser }}」设置可用模型:取消勾选表示禁止该模型。
        </div>
        <div v-if="permLoading" class="admin-user-detail-empty">加载中...</div>
        <div v-else class="model-perm-list">
            <div v-for="model in permModels" :key="model.id" class="model-perm-row">
                <label class="settings-toggle-row">
                    <input v-model="model.allowed" type="checkbox">
                    <span>
                        <span class="model-perm-name">{{ model.name }}</span>
                        <span class="model-perm-id mono">{{ model.id }}</span>
                        <span class="model-perm-badge" :class="`provider-${String(model.provider || '').toLowerCase()}`">{{ model.provider }}</span>
                        <span class="model-perm-badge" :class="`status-${String(model.status || 'normal').toLowerCase()}`">{{ model.status }}</span>
                    </span>
                </label>
            </div>
            <div v-if="!permModels.length" class="admin-user-detail-empty">暂无模型</div>
        </div>
        <template #footer>
            <button class="btn-cancel" type="button" @click="modelPermOpen = false">取消</button>
            <button class="btn-confirm" type="button" :disabled="permSaving" @click="saveModelPerm">保存更改</button>
        </template>
    </Modal>

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

    import type { AdminUser, UserModelEntry } from '@/api/admin-users'
    import {
        addAdminUser,
        deleteAdminUser,
        fetchUserModels,
        listAdminUsers,
        resetAdminUserPassword,
        setAdminUserRole,
        updateAdminUserProfile,
        updateUserModelBlacklist,
    } from '@/api/admin-users'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const userStore = useUserStore()

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
    const detailDisplayName = ref('')

    /** 模型权限弹窗状态(对齐原版 modelPermModal) */
    const modelPermOpen = ref(false)
    const permTargetUser = ref('')
    const permLoading = ref(false)
    const permSaving = ref(false)
    const permModels = ref<Array<UserModelEntry & { allowed: boolean }>>([])

    const selected = computed(() => {
        return users.value.find((user) => user.user_id === selectedId.value) || null
    })

    /** 当前登录用户是否为被查看用户(对齐原版 isSelf:本人角色/删除受限) */
    const isSelf = computed(() => {
        return String(selected.value?.user_id || '') === String(userStore.userId || '')
    })

    /** 筛选后的用户列表(对齐原版 adminUserFilterInput:匹配用户名/ID/角色中文/IP) */
    const filteredUsers = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return users.value
        }

        return users.value.filter((user) => {
            const roleText = user.role === 'admin' ? 'admin 管理员' : 'member 普通用户'
            const haystack = [
                user.user_id,
                user.username,
                user.role,
                roleText,
                user.last_ip,
            ].join(' ').toLowerCase()

            return haystack.includes(keyword)
        })
    })

    onMounted(() => {
        void load()
    })

    /** 拉取用户列表(对齐原版 adminGetUsers;自动选中第一个) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            users.value = await listAdminUsers()

            const selectionExists = users.value.some((user) => user.user_id === selectedId.value)

            if (!selectionExists && users.value.length) {
                const firstDeletableUser = users.value.find((user) => {
                    return String(user.user_id) !== String(userStore.userId || '')
                })

                selectUser(firstDeletableUser || users.value[0])
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载用户失败')
        } finally {
            loading.value = false
        }
    }

    /** 页头筛选输入转发(computed 自动响应) */
    function setQuery(value?: string): void {
        query.value = String(value || '')
    }

    function selectUser(user: AdminUser): void {
        selectedId.value = user.user_id
        detailRole.value = String(user.role || 'member')
        detailDisplayName.value = String(user.username || user.user_id)
    }

    /** 保存资料(显示名 + 非本人角色,对齐原版 saveAdminUserProfile) */
    async function saveProfile(): Promise<void> {
        if (!selected.value) {
            return
        }

        const displayName = detailDisplayName.value.trim()

        if (!displayName) {
            showToast('用户名不能为空', 'warning')

            return
        }

        try {
            const currentRole = String(selected.value.role || 'member')
            const tasks: Promise<unknown>[] = []

            if (displayName !== String(selected.value.username || selected.value.user_id)) {
                tasks.push(updateAdminUserProfile(selected.value.user_id, displayName))
            }

            if (!isSelf.value && detailRole.value !== currentRole) {
                tasks.push(setAdminUserRole(selected.value.user_id, detailRole.value))
            }

            await Promise.all(tasks)

            showToast('资料已保存', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 打开模型权限弹窗(对齐原版 openUserModelPerm) */
    async function openModelPerm(): Promise<void> {
        if (!selected.value) {
            return
        }

        permTargetUser.value = selected.value.username || selected.value.user_id
        modelPermOpen.value = true
        permLoading.value = true

        try {
            const models = await fetchUserModels(permTargetUser.value)

            permModels.value = models.map((model) => ({
                ...model,
                allowed: !model.is_blocked,
            }))
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载模型权限失败')
        } finally {
            permLoading.value = false
        }
    }

    /** 保存模型权限(对齐原版 saveUserModelPermissions) */
    async function saveModelPerm(): Promise<void> {
        permSaving.value = true

        try {
            const blocked = permModels.value.filter((model) => !model.allowed).map((model) => model.id)

            await updateUserModelBlacklist(permTargetUser.value, blocked)

            showToast('模型权限已保存', 'success')
            modelPermOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        } finally {
            permSaving.value = false
        }
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

        if (isSelf.value) {
            showToast('不能删除当前登录用户', 'warning')

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

    defineExpose({
        openCreate,
        load,
        setQuery,
    })
</script>
