<!--
    AdminAuthPanel.vue — 管理员:认证管理(Public API Keys)

    功能:
      - 页头操作(生成/筛选/刷新)由 SettingsModal pageActionsMap 提供,面板不再自带 toolbar
      - 左列表(带范围文字 + 过期状态)/ 右详情
      - 详情:可编辑区(名称/范围/所属用户 SettingSelect 搜索)+ 只读信息卡 + 权限开关 + 操作按钮
      - 弹窗:生成/重新生成 Key + 明文展示
-->

<template>
    <div class="admin-auth-panel">
        <!-- 主体:左列表 + 右详情(手机端两级钻取由 CSS 类驱动,与 AdminPanel 一致) -->
        <div class="settings-management-layout" :class="{ 'show-detail': authDetailOpen }">
            <!-- 左列表 -->
            <div class="settings-management-list auth-key-list" @click="authDetailOpen = true">
                <div v-if="loading" class="auth-empty">加载中...</div>
                <div v-else-if="!filteredKeys.length" class="auth-empty">暂无 Public API Key</div>
                <button
                    v-for="key in filteredKeys"
                    :key="key.id"
                    class="auth-key-item"
                    :class="{ active: selectedId === key.id }"
                    type="button"
                    @click="selectKey(key)"
                >
                    <span class="auth-key-avatar">
                        <i class="fa-solid fa-key" aria-hidden="true"></i>
                    </span>
                    <span class="auth-key-main">
                        <span class="auth-key-name-row">
                            <span class="auth-key-name">{{ key.name || key.id }}</span>
                            <span class="auth-scope-text">
                                {{ key.scope === 'global' ? '全局' : '私有' }}
                            </span>
                        </span>
                        <span class="auth-key-meta-row">
                            <span class="auth-key-preview">{{ key.key_preview || '-' }}</span>
                            <span class="auth-key-expiry" :class="{ expired: key.is_expired }">
                                {{ key.is_expired ? '已过期' : (key.expires_at ? remainingShort(key) : '永久' ) }}
                            </span>
                        </span>
                    </span>
                </button>
            </div>

            <!-- 右详情(统一 .settings-management-detail 容器,使手机端 show-detail 钻取规则生效) -->
            <div class="settings-management-detail">
                <!-- 手机端返回条(桌面端由 CSS 隐藏) -->
                <button type="button" class="settings-mobile-back" @click="authDetailOpen = false">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span>返回列表</span>
                </button>

                <div v-if="!selectedKey" class="auth-empty auth-detail-empty">
                    <i class="fa-solid fa-key auth-empty-icon" aria-hidden="true"></i>
                    <span>请选择一个 API Key 查看详情</span>
                </div>
                <div v-else class="auth-detail-inner">
                    <!-- 可编辑区 -->
                    <div class="auth-card">
                        <div class="auth-card-title">基本设置</div>
                        <div class="auth-edit-grid">
                            <div class="form-group">
                                <label for="adminPublicApiNameInput">Key 名称</label>
                                <input id="adminPublicApiNameInput" v-model="detailName" class="input-modern" type="text" maxlength="120" placeholder="Key 名称">
                            </div>
                            <div class="form-group">
                                <label>访问范围</label>
                                <SettingSegmented
                                    :model-value="detailScope"
                                    :options="scopeOptions"
                                    @update:model-value="detailScope = $event as 'owner' | 'global'"
                                />
                            </div>
                            <div class="form-group">
                                <label>所属用户</label>
                                <SettingSelect
                                    v-model="detailOwner"
                                    :options="ownerOptions"
                                    search
                                    search-placeholder="搜索用户..."
                                    width="220px"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- 只读信息卡 -->
                    <div class="auth-card">
                        <div class="auth-card-title">密钥信息</div>
                        <div class="auth-info-grid">
                            <div class="auth-info-cell">
                                <span class="auth-info-label">Key 预览</span>
                                <span class="auth-info-value mono">{{ selectedKey.key_preview || '-' }}</span>
                            </div>
                            <div class="auth-info-cell">
                                <span class="auth-info-label">生成者</span>
                                <span class="auth-info-value">{{ selectedKey.created_by || '-' }}</span>
                            </div>
                            <div class="auth-info-cell">
                                <span class="auth-info-label">创建时间</span>
                                <span class="auth-info-value mono">{{ formatTime(selectedKey.created_at) }}</span>
                            </div>
                            <div class="auth-info-cell">
                                <span class="auth-info-label">过期时间</span>
                                <span class="auth-info-value mono">{{ formatTime(selectedKey.expires_at) || '永久' }}</span>
                            </div>
                            <div class="auth-info-cell">
                                <span class="auth-info-label">剩余时长</span>
                                <span class="auth-info-value mono" :class="{ 'auth-expired': selectedKey.is_expired }">{{ remainingText }}</span>
                            </div>
                            <div class="auth-info-cell">
                                <span class="auth-info-label">最后使用</span>
                                <span class="auth-info-value mono">{{ formatTime(selectedKey.last_used_at) || '从未使用' }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 权限开关 -->
                    <div class="auth-card">
                        <div class="auth-card-title">权限配置</div>
                        <div class="auth-perm-grid">
                            <button
                                v-for="perm in permissionOptions"
                                :key="perm.key"
                                type="button"
                                class="auth-perm-toggle"
                                :class="{ active: detailPermissions[perm.key] }"
                                @click="detailPermissions[perm.key] = !detailPermissions[perm.key]"
                            >
                                <span class="auth-perm-label">{{ perm.label }}</span>
                                <span class="auth-perm-track">
                                    <span class="auth-perm-thumb"></span>
                                </span>
                            </button>
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <SettingActionRow>
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
                    </SettingActionRow>
                </div>
            </div>
            </div>

        <!-- 生成 / 重新生成 Key 弹窗 -->
        <Modal :open="keyModalOpen" :title="keyModalMode === 'regenerate' ? '重新生成 Public API Key' : '生成 Public API Key'" size="sm" @close="keyModalOpen = false">
            <p v-if="keyModalMode === 'regenerate'" class="auth-modal-tip">
                将为当前选中的 Key 重新生成明文 key,旧 key 会立即失效。
            </p>
            <div class="form-group">
                <label for="adminAuthCreateName">Key 名称</label>
                <input id="adminAuthCreateName" v-model="keyName" class="input-modern" type="text" maxlength="120" placeholder="例如:外部客户端">
            </div>
            <div class="form-group">
                <label>有效期</label>
                <SettingExpirySlider v-model="expire" :options="expireOptions" />
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
            <div class="auth-plain-key">
                <code class="auth-plain-key-value">{{ plainKey }}</code>
                <div class="auth-plain-key-tip">请立即复制保存,关闭后将无法再次查看。</div>
            </div>
            <template #footer>
                <button class="btn-confirm" type="button" @click="copyPlainKey">复制</button>
                <button class="btn-cancel" type="button" @click="plainKeyOpen = false">完成</button>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import { PUBLIC_API_PERMISSIONS, fetchPublicApiKeys, generatePublicApiKey, regeneratePublicApiKey, revokePublicApiKey, savePublicApiKeySettings, type PublicApiKey } from '@/api/admin-auth'
    import type { AdminUser } from '@/api/admin-users'
    import { listAdminUsers } from '@/api/admin-users'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import Modal from '@/ui/Modal.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingExpirySlider from '@/ui/settings/SettingExpirySlider.vue'
    import SettingSegmented from '@/ui/settings/SettingSegmented.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const userStore = useUserStore()

    const keys = ref<PublicApiKey[]>([])
    const loading = ref(false)
    const selectedId = ref('')
    /** 手机端两级钻取:点列表项进详情,返回条回列表 */
    const authDetailOpen = ref(false)
    const selectedKey = ref<PublicApiKey | null>(null)

    /** 详情编辑状态 */
    const detailName = ref('')
    const detailScope = ref<'owner' | 'global'>('owner')
    const detailOwner = ref('')
    const detailPermissions = reactive<Record<string, boolean>>({})

    /** 访问范围分段选项(GDDP SettingSegmented) */
    const scopeOptions = [
        { value: 'owner', label: '用户私有', icon: 'fa-solid fa-user' },
        { value: 'global', label: '全局访问', icon: 'fa-solid fa-globe' },
    ]

    /** 用户列表(所属用户候选) */
    const allUsers = ref<AdminUser[]>([])
    const ownerFilter = ref('')

    const permissionOptions = PUBLIC_API_PERMISSIONS

    const filteredKeys = computed(() => {
        const filter = ownerFilter.value.trim()

        if (!filter) {
            return keys.value
        }

        return keys.value.filter((key) => String(key.owner || '') === filter)
    })

    /** 详情所属用户下拉候选:全部用户 + 当前值不在列表时补入(历史遗留 owner 保证回显) */
    const ownerOptions = computed(() => {
        const options = allUsers.value.map((user) => {
            const name = String(user.username || user.user_id || '')

            return { value: name, label: name }
        })

        const current = detailOwner.value.trim()

        if (current && !options.some((option) => option.value === current)) {
            options.unshift({ value: current, label: current })
        }

        return options
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
    })

    /** 列表项的简短过期文案(用于列表内展示) */
    function remainingShort(key: PublicApiKey): string {
        const seconds = Number(key.expires_in_seconds ?? 0)

        if (!seconds) {
            return '永久'
        }

        const days = Math.floor(seconds / 86400)

        if (days > 30) {
            return `${Math.floor(days / 30)} 月`
        }

        if (days > 0) {
            return `${days} 天`
        }

        const hours = Math.floor((seconds % 86400) / 3600)

        if (hours > 0) {
            return `${hours} 小时`
        }

        return `${Math.max(1, Math.floor(seconds / 60))} 分钟`
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

    /** 页头筛选输入转发(按用户筛选 key 列表) */
    function setOwnerFilter(value?: string): void {
        ownerFilter.value = String(value || '')
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

    defineExpose({
        openCreate,
        load,
        setOwnerFilter,
    })
</script>

<style scoped>
    /* ==================== 面板容器 ==================== */

    .admin-auth-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    /* ==================== 列表项(范围文字 + 过期状态) ==================== */

    .auth-key-list {
        /* 使用框架 .settings-management-list 基础样式 */
    }

    .auth-key-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 9px 12px;
        border: none;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
        transition: background 0.15s ease;
    }

    .auth-key-item:hover {
        background: var(--color-bg-sunken);
    }

    .auth-key-item.active {
        background: var(--color-bg-hover);
    }

    .auth-key-avatar {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        font-size: 13px;
    }

    .auth-key-item.active .auth-key-avatar {
        background: var(--color-text-primary);
        color: var(--color-bg-elevated);
    }

    .auth-key-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .auth-key-name-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .auth-key-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .auth-key-item.active .auth-key-name {
        color: var(--color-text-primary);
    }

    /* 范围信息使用普通灰色文字,不再使用 owner/global 彩色胶囊。 */
    .auth-scope-text {
        flex: none;
        color: var(--color-text-secondary);
        font-size: 10.5px;
        font-weight: 550;
    }

    .auth-key-meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .auth-key-preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .auth-key-expiry {
        flex: none;
        color: var(--color-text-secondary);
    }

    .auth-key-expiry.expired {
        color: var(--color-danger-text);
        font-weight: 600;
    }

    /* ==================== 空状态 ==================== */

    .auth-empty {
        padding: 28px 16px;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .auth-detail-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        height: 100%;
        min-height: 200px;
    }

    .auth-empty-icon {
        font-size: 24px;
        color: var(--color-text-secondary);
    }

    /* ==================== 详情区 ==================== */

    .auth-detail {
        /* 使用框架 .settings-management-detail 基础样式 */
    }

    .auth-detail-inner {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    /* 卡片容器(可编辑区 / 只读信息 / 权限) */
    .auth-card {
        padding: 14px 16px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
    }

    .auth-card-title {
        font-size: 11.5px;
        font-weight: 650;
        color: var(--color-text-secondary);
        letter-spacing: 0.03em;
        margin-bottom: 12px;
        text-transform: uppercase;
    }

    /* 可编辑字段网格 */
    .auth-edit-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) max-content;
        gap: 10px 20px;
    }

    .auth-edit-grid .form-group:last-child {
        grid-column: 1 / -1;
    }

    /* 只读信息网格 */
    .auth-info-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
    }

    .auth-info-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .auth-info-label {
        font-size: 11px;
        font-weight: 550;
        color: var(--color-text-secondary);
    }

    .auth-info-value {
        font-size: 13px;
        color: var(--color-text-primary);
        padding: 6px 10px;
        background: var(--color-bg-sunken);
        border-radius: 6px;
        border: 1px solid var(--color-border);
        word-break: break-all;
    }

    .auth-info-value.auth-expired {
        color: var(--color-danger-text);
        background: var(--color-danger-surface);
        border-color: var(--color-danger-border);
    }

    /* ==================== 权限 toggle 开关 ==================== */

    .auth-perm-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }

    .auth-perm-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 12px;
        border: 1px solid var(--color-border);
        border-radius: 7px;
        background: var(--color-bg-sunken);
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
    }

    .auth-perm-toggle:hover {
        border-color: var(--color-border);
    }

    .auth-perm-toggle.active {
        border-color: var(--color-border-strong);
        background: var(--color-bg-hover);
    }

    .auth-perm-label {
        font-size: 12.5px;
        color: var(--color-text-secondary);
        font-weight: 500;
    }

    .auth-perm-toggle.active .auth-perm-label {
        color: var(--color-text-primary);
    }

    /* toggle 滑轨(关态用控制件轨道令牌,随主题生效) */
    .auth-perm-track {
        position: relative;
        flex: none;
        width: 32px;
        height: 18px;
        border-radius: 9px;
        background: var(--color-control-track);
        transition: background 0.2s ease;
    }

    .auth-perm-toggle.active .auth-perm-track {
        background: var(--color-text-primary);
    }

    .auth-perm-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--color-bg-elevated);
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }

    .auth-perm-toggle.active .auth-perm-thumb {
        transform: translateX(14px);
    }

    /* ==================== 明文 Key 展示 ==================== */

    .auth-plain-key {
        padding: 12px;
        background: var(--color-bg-sunken);
        border-radius: 8px;
        border: 1px solid var(--color-border);
    }

    .auth-plain-key-value {
        display: block;
        padding: 10px 12px;
        background: var(--color-bg-elevated);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 13px;
        word-break: break-all;
        user-select: all;
        line-height: 1.5;
    }

    .auth-plain-key-tip {
        margin-top: 10px;
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    /* ==================== 弹窗提示 ==================== */

    .auth-modal-tip {
        margin: 0 0 14px;
        padding: 10px 12px;
        border-radius: 7px;
        background: var(--color-warning-surface);
        border: 1px solid var(--color-warning-border);
        font-size: 12.5px;
        color: var(--color-warning-text);
        line-height: 1.5;
    }
</style>
