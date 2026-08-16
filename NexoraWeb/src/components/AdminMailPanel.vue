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
                <input v-model="query" class="input-modern" placeholder="筛选邮箱用户:用户名 / 权限">
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
                    <span class="admin-user-name">{{ user.username }}</span>
                    <span class="admin-user-meta">{{ (user.permissions || []).length }} 项权限</span>
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
                        <div class="admin-mail-permissions">
                            <span v-for="permission in (selectedUser.permissions || [])" :key="permission" class="admin-mail-permission">
                                {{ permission }}
                            </span>
                            <span v-if="!(selectedUser.permissions || []).length" class="admin-user-meta">无权限</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>路径</label>
                        <div class="admin-info-text mono">{{ selectedUser.path || '-' }}</div>
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
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { MailUser } from '@/api/admin-mail'
    import { createMailUser, fetchMailUsers } from '@/api/admin-mail'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'

    const users = ref<MailUser[]>([])
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

    const filteredUsers = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return users.value
        }

        return users.value.filter((user) => {
            const haystack = [user.username, ...(user.permissions || [])].join(' ').toLowerCase()

            return haystack.includes(keyword)
        })
    })

    const selectedUser = computed(() => {
        return users.value.find((user) => user.username === selectedName.value) || null
    })

    onMounted(() => {
        void load()
    })

    /** 拉取邮箱用户 + 服务状态 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const mailUsers = await fetchMailUsers()

            users.value = mailUsers
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载邮箱用户失败')
        } finally {
            loading.value = false
        }
    }

    function selectUser(username: string): void {
        selectedName.value = username
    }

    /** 打开添加邮箱用户弹窗 */
    function handleAdd(): void {
        addForm.mail_username = ''
        addForm.password = ''
        addForm.permissions = ['receive', 'sendlocal']
        addOpen.value = true
    }

    /** 提交创建邮箱用户(对齐原版 admin_nexora_mail_create_user) */
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
            })

            showToast('邮箱用户已创建', 'success')
            addOpen.value = false
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }
</script>
