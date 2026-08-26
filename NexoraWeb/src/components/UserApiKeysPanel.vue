<!--
    UserApiKeysPanel.vue — 我的 API Key 管理面板(对齐原版 chat_user_api_keys.js)

    设计:
      - 复用 AdminPanel 布局(左列表 + 右详情)
      - 列表:key 名称 + key_preview;详情:名称/预览/创建时间/有效期/权限
      - 创建/轮换/删除走统一 Modal 与确认框
-->

<template>
    <AdminPanel>
        <template #list>
            <div v-if="loading" class="admin-user-detail-empty settings-management-list-state">加载中...</div>
            <div v-else-if="!keys.length" class="admin-user-detail-empty settings-management-list-state">暂无 API Key</div>
            <button
                v-for="key in keys"
                :key="key.id"
                class="admin-user-item papi-key-list-item"
                :class="{ active: selectedId === key.id }"
                type="button"
                @click="selectKey(key.id)"
            >
                <span class="admin-user-avatar admin-public-api-key-icon"><i class="fa-solid fa-key" aria-hidden="true"></i></span>
                <span class="papi-key-list-main">
                    <span class="admin-user-name">{{ key.name || key.id }}</span>
                    <span class="admin-user-meta mono">{{ key.key_preview || '-' }}</span>
                </span>
            </button>
        </template>

        <template #detail>
            <div v-if="!selectedKey" class="admin-user-detail-empty">请选择左侧 Key 查看详情</div>
            <div v-else>
                <div class="admin-user-detail-grid">
                    <div class="gddp-form-field">
                        <label>Key Name</label>
                        <input v-model="detailName" class="gddp-input" type="text" maxlength="120">
                    </div>
                    <div class="gddp-form-field">
                        <label>Key 预览</label>
                        <div class="admin-info-text mono">{{ selectedKey.key_preview || '-' }}</div>
                    </div>
                    <div class="gddp-form-field">
                        <label>创建时间</label>
                        <div class="admin-info-text mono">{{ formatDateTime(selectedKey.created_at) }}</div>
                    </div>
                    <div class="gddp-form-field">
                        <label>过期时间</label>
                        <div class="admin-info-text mono">{{ formatDateTime(selectedKey.expires_at) || '永久有效' }}</div>
                    </div>
                </div>
                <div class="gddp-form-field">
                    <label>有效期</label>
                    <SettingExpirySlider v-model="detailExpire" :options="expireSliderOptions" />
                </div>
                <div class="gddp-form-field">
                    <label>权限</label>
                    <div class="settings-toggle-grid">
                        <label v-for="(label, key) in permissionLabels" :key="key" class="settings-toggle-row">
                            <input v-model="detailPermissions[key]" type="checkbox">
                            <span>{{ label }}</span>
                        </label>
                        <span v-if="!Object.keys(permissionLabels).length" class="admin-user-meta">无可用权限</span>
                    </div>
                </div>
                <SettingActionRow>
                    <button class="btn-primary-outline" type="button" @click="saveDetail">
                        <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                        <span>保存设置</span>
                    </button>
                    <button class="btn-primary-outline" type="button" @click="handleRotate">
                        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                        <span>轮换 Key</span>
                    </button>
                    <button class="btn-danger-small" type="button" @click="handleDelete">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        <span>删除 Key</span>
                    </button>
                </SettingActionRow>
            </div>
        </template>
    </AdminPanel>

    <!-- 创建 Key 弹窗 -->
    <Modal :open="createOpen" title="创建 API Key" size="sm" @close="createOpen = false">
        <div class="gddp-form-field">
            <label for="userPapiKeyCreateName">名称</label>
            <input
                id="userPapiKeyCreateName"
                v-model="createName"
                class="gddp-input"
                type="text"
                maxlength="120"
                placeholder="例如:测试客户端"
            >
        </div>
        <div class="gddp-form-field">
            <label>有效期</label>
            <SettingExpirySlider v-model="createExpire" :options="expireSliderOptions" />
        </div>
        <div class="gddp-form-field">
            <label>权限</label>
            <div class="settings-toggle-grid">
                <label v-for="(label, key) in permissionLabels" :key="key" class="settings-toggle-row">
                    <input v-model="createPermissions[key]" type="checkbox">
                    <span>{{ label }}</span>
                </label>
                <span v-if="!Object.keys(permissionLabels).length" class="admin-user-meta">无可用权限</span>
            </div>
        </div>
        <template #footer>
            <button class="btn-cancel" type="button" @click="createOpen = false">取消</button>
            <button class="btn-confirm" type="button" @click="submitCreate">创建</button>
        </template>
    </Modal>

    <!-- 明文 Key 展示弹窗(仅创建/轮换时出现一次) -->
    <Modal :open="plainKeyOpen" title="复制你的 Key" size="sm" @close="plainKeyOpen = false">
        <div class="papi-key-plain">
            <code>{{ plainKey }}</code>
            <div class="papi-key-plain-tip">请立即复制保存,关闭后将无法再次查看。</div>
        </div>
        <template #footer>
            <button class="btn-confirm" type="button" @click="copyPlainKey">复制</button>
            <button class="btn-cancel" type="button" @click="plainKeyOpen = false">完成</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref, watch } from 'vue'

    import type { ExpireOption, UserApiKey } from '@/api/user-keys'
    import {
        createUserApiKey,
        deleteUserApiKey,
        listUserApiKeys,
        regenerateUserApiKey,
        updateUserApiKey,
    } from '@/api/user-keys'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingExpirySlider from '@/ui/settings/SettingExpirySlider.vue'

    const keys = ref<UserApiKey[]>([])
    const expireOptions = ref<ExpireOption[]>([])
    const permissionLabels = ref<Record<string, string>>({})
    const loading = ref(false)
    const selectedId = ref('')

    const createOpen = ref(false)
    const createName = ref('')
    const createExpire = ref('forever')
    const createPermissions = reactive<Record<string, boolean>>({})

    const plainKeyOpen = ref(false)
    const plainKey = ref('')

    const detailName = ref('')
    const detailExpire = ref('forever')
    const detailPermissions = reactive<Record<string, boolean>>({})

    const selectedKey = computed(() => {
        return keys.value.find((key) => key.id === selectedId.value) || null
    })

    /** 有效期滑条选项(id → value 映射) */
    const expireSliderOptions = computed(() => {
        return expireOptions.value.map((option) => ({ value: option.id, label: option.label }))
    })

    onMounted(() => {
        void load()
    })

    /** 选中变化时同步详情状态 */
    watch(selectedKey, (key) => {
        detailName.value = key ? key.name : ''
        detailExpire.value = key?.expire_option || 'forever'

        for (const permKey of Object.keys(permissionLabels.value)) {
            detailPermissions[permKey] = Array.isArray(key?.permissions) ? key.permissions.includes(permKey) : true
        }
    })

    /** 拉取列表(对齐原版 loadUserApiKeys;自动选中第一个) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const data = await listUserApiKeys()

            keys.value = data.keys
            expireOptions.value = data.expireOptions
            permissionLabels.value = data.permissionLabels

            // 初始化创建权限默认全选
            for (const key of Object.keys(data.permissionLabels)) {
                createPermissions[key] = true
                detailPermissions[key] = true
            }

            // 自动选中第一个 Key(对齐原版 applyPayload)
            if (!selectedId.value && keys.value.length) {
                selectedId.value = keys.value[0].id
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 API Key 失败')
        } finally {
            loading.value = false
        }
    }

    function selectKey(keyId: string): void {
        selectedId.value = keyId
    }

    /** 收集勾选的权限键 */
    function collectPermissions(source: Record<string, boolean>): string[] {
        return Object.entries(source)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
    }

    /** 打开创建弹窗(默认永久 + 权限全选) */
    function openCreate(): void {
        createName.value = ''
        createExpire.value = 'forever'

        for (const key of Object.keys(permissionLabels.value)) {
            createPermissions[key] = true
        }

        createOpen.value = true
    }

    /** 提交创建(对齐原版 submitCreate:name+expire+permissions) */
    async function submitCreate(): Promise<void> {
        const name = createName.value.trim()

        if (!name) {
            showToast('请输入名称', 'warning')

            return
        }

        try {
            const result = await createUserApiKey({
                name,
                expire: createExpire.value,
                permissions: collectPermissions(createPermissions),
            })

            createOpen.value = false
            plainKey.value = result.plainKey
            plainKeyOpen.value = true

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }

    /** 保存详情(名称 + 有效期 + 权限,对齐原版 saveSelectedKey) */
    async function saveDetail(): Promise<void> {
        const key = selectedKey.value

        if (!key) {
            return
        }

        const name = detailName.value.trim()

        if (!name) {
            showToast('名称不能为空', 'warning')

            return
        }

        try {
            await updateUserApiKey(key.id, {
                name,
                expire: detailExpire.value,
                permissions: collectPermissions(detailPermissions),
            })

            showToast('已保存', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 轮换 Key(对齐原版 rotateSelectedKey:携带当前有效期) */
    async function handleRotate(): Promise<void> {
        const key = selectedKey.value

        if (!key) {
            return
        }

        const confirmed = await showConfirm({
            title: '轮换 API Key',
            content: `确定轮换「${key.name}」吗?旧 Key 将立即失效。`,
            confirmText: '轮换',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            const result = await regenerateUserApiKey(key.id, { expire: detailExpire.value })

            plainKey.value = result.plainKey
            plainKeyOpen.value = true

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '轮换失败')
        }
    }

    /** 删除 Key(对齐原版 deleteSelectedKey) */
    async function handleDelete(): Promise<void> {
        const key = selectedKey.value

        if (!key) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除 API Key',
            content: `确定删除「${key.name}」吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteUserApiKey(key.id)

            showToast('已删除', 'success')
            selectedId.value = ''
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 复制明文 Key */
    async function copyPlainKey(): Promise<void> {
        try {
            await navigator.clipboard.writeText(plainKey.value)

            showToast('已复制', 'success')
        } catch {
            showToast('复制失败', 'error')
        }
    }

    /** 时间格式化(对齐原版 formatDateTime) */
    function formatDateTime(value: number | undefined): string {
        const n = Number(value || 0)

        if (!n) {
            return ''
        }

        try {
            const ms = n > 1000000000000 ? n : n * 1000

            return new Date(ms).toLocaleString()
        } catch {
            return ''
        }
    }

    defineExpose({
        openCreate,
        load,
    })
</script>
