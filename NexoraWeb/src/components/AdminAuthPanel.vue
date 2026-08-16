<!--
    AdminAuthPanel.vue — 管理员:认证管理(对齐原版 settings-admin-auth-tab)

    设计:
      - 复用 AdminPanel 布局:左 Public API Key 列表 + 右详情
      - 生成 Key(统一 Modal + 明文展示)/ 吊销
-->

<template>
    <AdminPanel>
        <template #toolbar>
            <button class="btn-primary-outline" type="button" @click="openCreate">
                <i class="fa-solid fa-key" aria-hidden="true"></i>
                <span>生成 Public API Key</span>
            </button>
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </template>

        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">Loading...</div>
            <div v-else-if="!keys.length" class="admin-user-detail-empty">暂无 Public API Key</div>
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
                <div class="form-group">
                    <label>Key Name</label>
                    <div class="admin-info-text">{{ selectedKey.name || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>Owner</label>
                    <div class="admin-info-text">{{ selectedKey.owner || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>Scope</label>
                    <div class="admin-info-text">{{ selectedKey.scope || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>Key 预览</label>
                    <div class="admin-info-text mono">{{ selectedKey.key_preview || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>创建时间</label>
                    <div class="admin-info-text">{{ formatTime(selectedKey.created_at) }}</div>
                </div>
                <div class="form-group">
                    <label>过期时间</label>
                    <div class="admin-info-text">{{ formatTime(selectedKey.expires_at) }}</div>
                </div>
                <div class="papi-action-row">
                    <button class="btn-danger-small" type="button" @click="handleRevoke">
                        <i class="fa-solid fa-ban" aria-hidden="true"></i>
                        <span>吊销 Key</span>
                    </button>
                </div>
            </div>
        </template>
    </AdminPanel>

    <!-- 生成 Key 弹窗 -->
    <Modal :open="createOpen" title="生成 Public API Key" size="sm" @close="createOpen = false">
        <div class="form-group">
            <label for="adminAuthCreateName">Key 名称</label>
            <input
                id="adminAuthCreateName"
                v-model="createName"
                class="input-modern"
                type="text"
                maxlength="120"
                placeholder="例如:外部客户端"
            >
        </div>
        <template #footer>
            <button class="btn-cancel" type="button" @click="createOpen = false">取消</button>
            <button class="btn-confirm" type="button" @click="submitCreate">生成</button>
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
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import type { PublicApiKey } from '@/api/admin-auth'
    import { fetchPublicApiKeys, generatePublicApiKey, revokePublicApiKey } from '@/api/admin-auth'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'

    const keys = ref<PublicApiKey[]>([])
    const loading = ref(false)
    const selectedId = ref('')

    const createOpen = ref(false)
    const createName = ref('')
    const plainKeyOpen = ref(false)
    const plainKey = ref('')

    const selectedKey = computed(() => {
        return keys.value.find((key) => key.id === selectedId.value) || null
    })

    onMounted(() => {
        void load()
    })

    /** 拉取 key 列表 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            keys.value = await fetchPublicApiKeys()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Key 失败')
        } finally {
            loading.value = false
        }
    }

    function selectKey(keyId: string): void {
        selectedId.value = keyId
    }

    /** 打开生成弹窗 */
    function openCreate(): void {
        createName.value = ''
        createOpen.value = true
    }

    /** 生成 key */
    async function submitCreate(): Promise<void> {
        const name = createName.value.trim()

        if (!name) {
            showToast('请输入 Key 名称', 'warning')

            return
        }

        try {
            const result = await generatePublicApiKey(name)

            createOpen.value = false
            plainKey.value = result.plainKey
            plainKeyOpen.value = true

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '生成失败')
        }
    }

    /** 吊销 key */
    async function handleRevoke(): Promise<void> {
        if (!selectedKey.value) {
            return
        }

        const confirmed = await showConfirm({
            title: '吊销 Public API Key',
            content: `确定吊销「${selectedKey.value.name || selectedKey.value.id}」吗?`,
            confirmText: '吊销',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await revokePublicApiKey(selectedKey.value.id)

            showToast('Key 已吊销', 'success')
            selectedId.value = ''
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '吊销失败')
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
            return '-'
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
