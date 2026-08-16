<!--
    AdminAuthPanel.vue — 管理员:认证管理(对齐原版 settings-admin-auth-tab)

    功能:
      - 工具栏:生成 Public API Key + 按用户筛选
      - 左列表 / 右详情
      - 详情:Key Name 编辑 / 访问范围(用户私有·全局)/ 所属用户选择器 / 权限 7 项 / 剩余时长
      - 操作:保存当前 Key 设置 / 重新生成 / 删除(吊销)
-->

<template>
    <div class="admin-auth-panel">
        <div class="admin-users-toolbar settings-management-toolbar">
            <button class="btn-primary-outline" type="button" @click="openCreate">
                <i class="fa-solid fa-key" aria-hidden="true"></i>
                <span>生成 Public API Key</span>
            </button>
            <div class="admin-user-token-selector" ref="filterRef">
                <input
                    v-model="ownerFilter"
                    class="input-modern"
                    placeholder="按用户筛选"
                    autocomplete="off"
                    @focus="openFilterMenu"
                    @input="openFilterMenu"
                >
                <div v-if="filterMenuOpen && filteredOwnerOptions.length" class="admin-user-token-menu" role="listbox">
                    <button
                        v-for="user in filteredOwnerOptions"
                        :key="user.username"
                        type="button"
                        @click="pickOwnerFilter(user.username)"
                    >{{ user.username }}</button>
                </div>
            </div>
            <button v-if="ownerFilter" class="admin-user-token-clear-inline" type="button" title="清除筛选" @click="ownerFilter = ''">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </div>

        <div class="admin-users-layout settings-management-layout">
            <div class="admin-users-list settings-management-list">
                <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
                <div v-else-if="!filteredKeys.length" class="admin-user-detail-empty">暂无 Public API Key</div>
                <button
                    v-for="key in filteredKeys"
                    :key="key.id"
                    class="admin-user-item papi-key-list-item"
                    :class="{ active: selectedId === key.id }"
                    type="button"
                    @click="selectKey(key)"
                >
                    <span class="admin-user-avatar admin-public-api-key-icon"><i class="fa-solid fa-key" aria-hidden="true"></i></span>
                    <span class="papi-key-list-main">
                        <span class="admin-user-name">{{ key.name || key.id }}</span>
                        <span class="admin-user-meta mono">{{ key.key_preview || '-' }}</span>
                    </span>
                </button>
            </div>

            <div class="admin-user-detail settings-management-detail">
                <div v-if="!selectedKey" class="admin-user-detail-empty">请选择左侧 Key 查看详情</div>
                <div v-else>
                    <div class="form-group">
                        <label for="adminPublicApiNameInput">Key Name</label>
                        <input id="adminPublicApiNameInput" v-model="detailName" class="input-modern" type="text" maxlength="120" placeholder="Key Name">
                    </div>
                    <div class="form-group">
                        <label>Key 预览</label>
                        <div class="settings-field mono">{{ selectedKey.key_preview || '-' }}</div>
                    </div>
                    <div class="form-group">
                        <label>访问范围</label>
                        <div class="papi-segment" role="group" aria-label="访问范围">
                            <button
                                type="button"
                                class="papi-segment-button"
                                :class="{ active: detailScope === 'owner' }"
                                @click="detailScope = 'owner'"
                            >用户私有</button>
                            <button
                                type="button"
                                class="papi-segment-button"
                                :class="{ active: detailScope === 'global' }"
                                @click="detailScope = 'global'"
                            >全局访问</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>所属用户</label>
                        <div class="admin-user-token-selector" ref="ownerRef">
                            <input
                                v-model="detailOwner"
                                class="input-modern"
                                placeholder="选择用户"
                                autocomplete="off"
                                @focus="openOwnerMenu"
                                @input="openOwnerMenu"
                            >
                            <div v-if="ownerMenuOpen && filteredOwnerOptions.length" class="admin-user-token-menu" role="listbox">
                                <button
                                    v-for="user in filteredOwnerOptions"
                                    :key="user.username"
                                    type="button"
                                    @click="pickOwner(user.username)"
                                >{{ user.username }}</button>
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>创建时间</label>
                        <div class="settings-field mono">{{ formatTime(selectedKey.created_at) }}</div>
                    </div>
                    <div class="form-group">
                        <label>过期时间</label>
                        <div class="settings-field mono">{{ formatTime(selectedKey.expires_at) || '永久' }}</div>
                    </div>
                    <div class="form-group">
                        <label>剩余时长</label>
                        <div class="settings-field mono">{{ remainingText }}</div>
                    </div>
                    <div class="form-group">
                        <label>权限</label>
                        <div class="settings-toggle-grid">
                            <label v-for="perm in permissionOptions" :key="perm.key" class="settings-toggle-row">
                                <input v-model="detailPermissions[perm.key]" type="checkbox">
                                <span>{{ perm.label }}</span>
                            </label>
                        </div>
                    </div>
                    <div class="papi-action-row">
                        <button class="btn-primary-outline" type="button" @click="handleSaveSettings">
                            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                            <span>保存设置</span>
                        </button>
                        <button class="btn-primary-outline" type="button" @click="openRegenerate">
                            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                            <span>重新生成</span>
                        </button>
                        <button class="btn-danger-small" type="button" @click="handleRevoke">
                            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                            <span>删除 Key</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 生成 / 重新生成 Key 弹窗 -->
        <Modal :open="keyModalOpen" :title="keyModalMode === 'regenerate' ? '重新生成 Public API Key' : '生成 Public API Key'" size="sm" @close="keyModalOpen = false">
            <p v-if="keyModalMode === 'regenerate'" class="papi-key-plain-tip" style="margin-top:0;">
                将为当前选中的 Key 重新生成明文 key,旧 key 会立即失效。
            </p>
            <div class="form-group">
                <label for="adminAuthCreateName">Key 名称</label>
                <input id="adminAuthCreateName" v-model="keyName" class="input-modern" type="text" maxlength="120" placeholder="例如:外部客户端">
            </div>
            <div class="form-group">
                <label>有效期</label>
                <div class="settings-mode-toggle" role="tablist" aria-label="有效期">
                    <button
                        v-for="option in expireOptions"
                        :key="option.value"
                        type="button"
                        class="settings-mode-toggle-btn"
                        :class="{ active: expire === option.value }"
                        @click="expire = option.value"
                    >{{ option.label }}</button>
                </div>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="keyModalOpen = false">取消</button>
                <button class="btn-confirm" type="button" :disabled="keySubmitting" @click="submitKey">
                    {{ keySubmitting ? '处理中...' : '确认' }}
                </button>
            </template>
        </Modal>

        <!-- 明文 Key 展示 -->
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
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

    import { PUBLIC_API_PERMISSIONS, fetchPublicApiKeys, generatePublicApiKey, regeneratePublicApiKey, revokePublicApiKey, savePublicApiKeySettings, type PublicApiKey } from '@/api/admin-auth'
    import type { AdminUser } from '@/api/admin-users'
    import { listAdminUsers } from '@/api/admin-users'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import Modal from '@/ui/Modal.vue'

    const userStore = useUserStore()

    const keys = ref<PublicApiKey[]>([])
    const loading = ref(false)
    const selectedId = ref('')
    const selectedKey = ref<PublicApiKey | null>(null)

    /** 详情编辑状态 */
    const detailName = ref('')
    const detailScope = ref<'owner' | 'global'>('owner')
    const detailOwner = ref('')
    const detailPermissions = reactive<Record<string, boolean>>({})

    /** 用户列表(所属用户/筛选) */
    const allUsers = ref<AdminUser[]>([])
    const ownerFilter = ref('')
    const filterRef = ref<HTMLElement | null>(null)
    const ownerRef = ref<HTMLElement | null>(null)
    const filterMenuOpen = ref(false)
    const ownerMenuOpen = ref(false)

    const permissionOptions = PUBLIC_API_PERMISSIONS

    const filteredKeys = computed(() => {
        const filter = ownerFilter.value.trim()

        if (!filter) {
            return keys.value
        }

        return keys.value.filter((key) => String(key.owner || '') === filter)
    })

    const filteredOwnerOptions = computed(() => {
        const keyword = ownerFilter.value.trim().toLowerCase() || detailOwner.value.trim().toLowerCase()

        if (!keyword) {
            return allUsers.value.slice(0, 8)
        }

        return allUsers.value.filter((user) => user.username.toLowerCase().includes(keyword)).slice(0, 8)
    })

    /** 剩余时长文案 */
    const remainingText = computed(() => {
        const key = selectedKey.value

        if (!key) {
            return '-'
        }

        if (key.is_expired) {
            return '已过期'
        }

        const seconds = Number(key.expires_in_seconds ?? 0)

        if (!seconds) {
            return key.expires_at ? formatTime(key.expires_at) : '永久'
        }

        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)

        if (days > 0) {
            return `${days} 天 ${hours} 小时`
        }

        if (hours > 0) {
            return `${hours} 小时`
        }

        return `${Math.max(1, Math.floor(seconds / 60))} 分钟`
    })

    /** Key 弹窗状态 */
    const keyModalOpen = ref(false)
    const keyModalMode = ref<'generate' | 'regenerate'>('generate')
    const keySubmitting = ref(false)
    const keyName = ref('')
    const expire = ref('7d')

    const expireOptions = [
        { value: '1d', label: '1 天' },
        { value: '7d', label: '7 天' },
        { value: '1m', label: '1 个月' },
        { value: '3m', label: '3 个月' },
        { value: 'forever', label: '永久' },
    ]

    const plainKeyOpen = ref(false)
    const plainKey = ref('')

    onMounted(() => {
        void load()
        document.addEventListener('click', onPageClick)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', onPageClick)
    })

    function onPageClick(event: MouseEvent): void {
        const target = event.target as Node

        if (filterRef.value && !filterRef.value.contains(target)) {
            filterMenuOpen.value = false
        }

        if (ownerRef.value && !ownerRef.value.contains(target)) {
            ownerMenuOpen.value = false
        }
    }

    /** 拉取 key 列表 + 用户列表 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const [keyList, users] = await Promise.all([fetchPublicApiKeys(), listAdminUsers()])

            keys.value = keyList
            allUsers.value = users

            // 保持选中
            if (selectedKey.value) {
                const matched = keys.value.find((key) => key.id === selectedId.value)

                if (matched) {
                    selectKey(matched)
                } else {
                    selectedKey.value = null
                }
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Key 失败')
        } finally {
            loading.value = false
        }
    }

    /** 选中 key 并初始化详情编辑状态 */
    function selectKey(key: PublicApiKey): void {
        selectedId.value = key.id
        selectedKey.value = key
        detailName.value = String(key.name || '')
        detailScope.value = (String(key.scope || 'owner') === 'global' ? 'global' : 'owner')
        detailOwner.value = String(key.owner || '')

        for (const perm of permissionOptions) {
            detailPermissions[perm.key] = Boolean(key.permissions?.[perm.key] ?? true)
        }
    }

    function openFilterMenu(): void {
        filterMenuOpen.value = true
    }

    function pickOwnerFilter(username: string): void {
        ownerFilter.value = username
        filterMenuOpen.value = false
    }

    function openOwnerMenu(): void {
        ownerMenuOpen.value = true
    }

    function pickOwner(username: string): void {
        detailOwner.value = username
        ownerMenuOpen.value = false
    }

    /** 打开生成弹窗 */
    function openCreate(): void {
        keyModalMode.value = 'generate'
        keyName.value = ''
        expire.value = '7d'
        keyModalOpen.value = true
    }

    /** 打开重新生成弹窗 */
    function openRegenerate(): void {
        if (!selectedKey.value) {
            showToast('请先选择一个 Key', 'warning')

            return
        }

        keyModalMode.value = 'regenerate'
        keyName.value = detailName.value || ''
        expire.value = String(selectedKey.value.expire_option || '7d') || '7d'
        keyModalOpen.value = true
    }

    /** 提交生成 / 重新生成 */
    async function submitKey(): Promise<void> {
        const name = keyName.value.trim()

        if (!name) {
            showToast('请输入 Key 名称', 'warning')

            return
        }

        keySubmitting.value = true

        try {
            const result = keyModalMode.value === 'regenerate' && selectedKey.value
                ? await regeneratePublicApiKey(selectedKey.value.id, name, { expire: expire.value })
                : await generatePublicApiKey(name, { expire: expire.value, owner: String(userStore.username || '') })

            keyModalOpen.value = false
            plainKey.value = result.plainKey
            plainKeyOpen.value = true

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        } finally {
            keySubmitting.value = false
        }
    }

    /** 保存当前 Key 设置(名称/范围/所属用户/权限) */
    async function handleSaveSettings(): Promise<void> {
        if (!selectedKey.value) {
            return
        }

        try {
            const permissions: Record<string, boolean> = {}

            for (const perm of permissionOptions) {
                permissions[perm.key] = Boolean(detailPermissions[perm.key])
            }

            await savePublicApiKeySettings(selectedKey.value.id, {
                name: detailName.value.trim(),
                scope: detailScope.value,
                owner: detailOwner.value.trim(),
                permissions,
            })

            showToast('Key 设置已保存', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 删除(吊销)key */
    async function handleRevoke(): Promise<void> {
        if (!selectedKey.value) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除 Public API Key',
            content: `确定删除「${selectedKey.value.name || selectedKey.value.id}」吗?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await revokePublicApiKey(selectedKey.value.id)

            showToast('Key 已删除', 'success')
            selectedId.value = ''
            selectedKey.value = null
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

    /** 时间格式化 */
    function formatTime(value: string | number | undefined): string {
        const raw = String(value || '')

        if (!raw) {
            return ''
        }

        try {
            const ms = /^\d+$/.test(raw)
                ? (Number(raw) > 1000000000000 ? Number(raw) : Number(raw) * 1000)
                : Date.parse(raw)

            return new Date(ms).toLocaleString()
        } catch {
            return raw
        }
    }
</script>

<style scoped>
    .admin-auth-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .admin-user-token-selector {
        position: relative;
        width: 180px;
    }

    .admin-user-token-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 60;
        max-height: 220px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid #e2e2e2;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10);
    }

    .admin-user-token-menu button {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 12.5px;
        color: #3c3c3c;
        text-align: left;
        cursor: pointer;
    }

    .admin-user-token-menu button:hover {
        background: #f1f1f1;
        color: #111111;
    }

    .admin-user-token-clear-inline {
        flex: none;
        width: 30px;
        height: 30px;
        border: 1px solid #dddddd;
        border-radius: 7px;
        background: #fff;
        color: #999999;
        cursor: pointer;
    }

    .admin-user-token-clear-inline:hover {
        color: #b03a2e;
        border-color: #e0a0a0;
    }

    /* 访问范围 segment(对齐原版 papi-segment) */
    .papi-segment {
        display: inline-flex;
        border: 1px solid #dddddd;
        border-radius: 7px;
        overflow: hidden;
    }

    .papi-segment-button {
        padding: 7px 16px;
        border: none;
        background: #fff;
        font-size: 12.5px;
        font-weight: 550;
        color: #7a7a7a;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .papi-segment-button + .papi-segment-button {
        border-left: 1px solid #dddddd;
    }

    .papi-segment-button.active {
        background: #f1f1f1;
        color: #111111;
    }

    /* 权限网格 */
    .settings-toggle-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 20px;
    }
</style>