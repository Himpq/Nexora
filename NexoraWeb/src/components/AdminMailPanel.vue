<!--
    AdminMailPanel.vue — 管理员:邮箱管理(对齐原版 settings-admin-mail-tab)

    设计:
      - AdminPanel 布局:工具栏(添加 + 筛选)+ 左邮箱用户列表 + 右详情(权限)
      - 服务状态等杂项不再展示(原版即无)
-->

<template>
    <div class="admin-mail-panel">
        <AdminPanel>
            <template #toolbar>
                <button class="btn-primary" type="button" @click="handleAdd">+ 添加邮箱用户</button>
                <SettingSelect
                    :model-value="currentGroup"
                    :options="groupOptions"
                    placeholder="分组"
                    width="150px"
                    @update:model-value="switchGroup(String($event))"
                />
                <input v-model="query" class="input-modern" placeholder="筛选邮箱用户:用户名 / 权限 / 路径">
            </template>

            <template #list>
                <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
                <div v-else-if="!filteredUsers.length" class="admin-user-detail-empty">暂无邮箱用户</div>
                <div
                    v-for="user in filteredUsers"
                    :key="user.username"
                    class="admin-user-item"
                    :class="{ active: selectedName === user.username }"
                    role="button"
                    tabindex="0"
                    @click="selectUser(user.username)"
                    @keydown.enter="selectUser(user.username)"
                >
                    <span class="admin-user-main">
                        <span class="admin-user-name">{{ user.username }}</span>
                        <span class="admin-user-meta">group: {{ currentGroup }} · {{ (user.permissions || []).length }} 项权限</span>
                    </span>
                </div>
            </template>

            <template #detail>
                <div v-if="!selectedUser" class="admin-user-detail-empty">请选择左侧邮箱用户查看详情</div>
                <div v-else>
                    <div class="form-group">
                        <label>用户名</label>
                        <div class="admin-info-text">{{ selectedUser.username }}</div>
                    </div>
                    <div class="form-group">
                        <label>权限</label>
                        <div class="admin-info-text">{{ (selectedUser.permissions || []).join(', ') || '-' }}</div>
                    </div>
                    <div class="form-group">
                        <label>路径</label>
                        <div class="admin-info-text mono">{{ selectedUser.path || '-' }}</div>
                    </div>
                    <div class="papi-action-row">
                        <button class="btn-primary-outline" type="button" @click="resetOpen = true">
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

    import type { MailUser } from '@/api/admin-mail'
    import { createMailUser, deleteMailUser, fetchMailGroups, fetchMailUsers, resetMailUserPassword } from '@/api/admin-mail'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const users = ref<MailUser[]>([])
    const groups = ref<string[]>([])
    const currentGroup = ref('')
    const loading = ref(false)
    const query = ref('')
    const selectedName = ref('')

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

    /** 分组下拉选项 */
    const groupOptions = computed(() => {
        return groups.value.map((group) => ({ value: group, label: group }))
    })

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
</script>
