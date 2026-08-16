<!--
    UserApiKeysPanel.vue — 我的 API Key 管理面板(对齐原版 chat_user_api_keys.js)

    设计:
      - 复用 AdminPanel 布局(左列表 + 右详情)
      - 列表:key 名称 + key_preview;详情:名称/预览/创建时间/有效期/权限
      - 创建/轮换/删除走统一 Modal 与确认框
-->

<template>
    <AdminPanel>
        <template #toolbar>
            <button class="btn-primary" type="button" @click="openCreate">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                <span>新建 Key</span>
            </button>
            <button class="btn-primary-outline btn-compact settings-management-icon-button" type="button" title="刷新 Key 列表" aria-label="刷新 Key 列表" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
            </button>
        </template>

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
            <div v-else class="admin-user-detail-grid">
                <div class="form-group">
                    <label>Key Name</label>
                    <input v-model="detailName" class="input-modern" type="text" maxlength="120">
                </div>
                <div class="form-group">
                    <label>Key 预览</label>
                    <div class="admin-info-text mono">{{ selectedKey.key_preview || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>创建时间</label>
                    <div class="admin-info-text mono">{{ formatDateTime(selectedKey.created_at) }}</div>
                </div>
                <div class="form-group">
                    <label>过期时间</label>
                    <div class="admin-info-text mono">{{ formatDateTime(selectedKey.expires_at) || '永久' }}</div>
                </div>
                <div class="papi-action-row">
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
                </div>
            </div>
        </template>
    </AdminPanel>

    <!-- 创建 Key 弹窗 -->
    <Modal :open="createOpen" title="创建 API Key" size="sm" @close="createOpen = false">
        <div class="form-group">
            <label for="userPapiKeyCreateName">名称</label>
            <input
                id="userPapiKeyCreateName"
                v-model="createName"
                class="input-modern"
                type="text"
                maxlength="120"
                placeholder="例如:测试客户端"
            >
        </div>
        <div class="form-group">
            <label for="userPapiKeyCreateExpire">有效期</label>
            <div class="chat-announcement-level-select">
                <button
                    id="userPapiKeyCreateExpire"
                    class="chat-announcement-level-button"
                    type="button"
                    :aria-expanded="expireMenuOpen"
                    @click="expireMenuOpen = !expireMenuOpen"
                >
                    <span>{{ expireLabel }}</span>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div class="chat-announcement-level-menu" role="listbox" :hidden="!expireMenuOpen">
                    <button
                        v-for="option in expireOptions"
                        :key="option.id"
                        type="button"
                        role="option"
                        :aria-selected="createExpire === option.id"
                        @click="createExpire = option.id; expireMenuOpen = false"
                    >{{ option.label }}</button>
                </div>
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
    import { computed, onMounted, ref, watch } from 'vue'

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

    const keys = ref<UserApiKey[]>([])
    const expireOptions = ref<ExpireOption[]>([])
    const loading = ref(false)
    const selectedId = ref('')

    const createOpen = ref(false)
    const createName = ref('')
    const createExpire = ref('1m')
    const expireMenuOpen = ref(false)

    const plainKeyOpen = ref(false)
    const plainKey = ref('')

    const detailName = ref('')

    const selectedKey = computed(() => {
        return keys.value.find((key) => key.id === selectedId.value) || null
    })

    const expireLabel = computed(() => {
        const option = expireOptions.value.find((item) => item.id === createExpire.value)

        return option ? option.label : createExpire.value
    })

    onMounted(() => {
        void load()
    })

    /** 选中变化时同步详情名称 */
    watch(selectedKey, (key) => {
        detailName.value = key ? key.name : ''
    })

    /** 拉取列表(对齐原版 loadUserApiKeys) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const data = await listUserApiKeys()

            keys.value = data.keys
            expireOptions.value = data.expireOptions
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 API Key 失败')
        } finally {
            loading.value = false
        }
    }

    function selectKey(keyId: string): void {
        selectedId.value = keyId
    }

    /** 打开创建弹窗 */
    function openCreate(): void {
        createName.value = ''
        createExpire.value = '1m'
        createOpen.value = true
    }

    /** 提交创建(对齐原版 submitCreate) */
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
            })

            createOpen.value = false
            plainKey.value = result.plainKey
            plainKeyOpen.value = true

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }

    /** 保存详情(名称) */
    async function saveDetail(): Promise<void> {
        const key = selectedKey.value

        if (!key) {
            return
        }

        const name = detailName.value.trim()

        if (!name || name === key.name) {
            return
        }

        try {
            await updateUserApiKey(key.id, { name })

            showToast('已保存', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 轮换 Key(对齐原版 rotateSelectedKey) */
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
            const result = await regenerateUserApiKey(key.id)

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
</script>
