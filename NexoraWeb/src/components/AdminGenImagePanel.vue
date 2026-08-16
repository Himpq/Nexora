<!--
    AdminGenImagePanel.vue — 管理员:生图 API(对齐原版 settings-admin-gen-image-tab)

    设计:
      - 复用 AdminPanel 布局:左接口列表 + 右详情
      - 显示接口 id / 名称 / 启用状态;详情含 base_url / model
-->

<template>
    <AdminPanel>
        <template #toolbar>
            <button class="btn-primary-outline" type="button" @click="handleAdd">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                <span>添加接口</span>
            </button>
            <button class="btn-primary-outline" type="button" @click="load">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>刷新</span>
            </button>
        </template>

        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
            <div v-else-if="!apis.length" class="admin-user-detail-empty">暂无生图接口</div>
            <div
                v-for="api in apis"
                :key="api.id"
                class="admin-user-item"
                :class="{ active: selectedId === api.id }"
                role="button"
                tabindex="0"
                @click="selectApi(api.id)"
                @keydown.enter="selectApi(api.id)"
            >
                <span class="admin-user-name">{{ api.name || api.id }}</span>
                <span class="admin-user-meta">
                    {{ api.enabled === false ? '停用' : '启用' }}
                    <template v-if="api.id === enabledApi"> · 当前</template>
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selectedApi" class="admin-user-detail-empty">请选择左侧接口查看详情</div>
            <div v-else>
                <div class="form-group">
                    <label>接口标识</label>
                    <div class="admin-info-text mono">{{ selectedApi.id }}</div>
                </div>
                <div class="form-group">
                    <label>名称</label>
                    <div class="admin-info-text">{{ selectedApi.name || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>Base URL</label>
                    <div class="admin-info-text mono">{{ selectedApi.base_url || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>模型</label>
                    <div class="admin-info-text">{{ selectedApi.model || '-' }}</div>
                </div>
                <div class="form-group">
                    <label>状态</label>
                    <div class="admin-info-text">
                        <span v-if="selectedApi.id === enabledApi">当前启用</span>
                        <span v-else>{{ selectedApi.enabled === false ? '停用' : '启用' }}</span>
                    </div>
                </div>
            </div>
        </template>
    </AdminPanel>

    <!-- 添加生图接口弹窗 -->
    <Modal :open="addOpen" title="添加生图接口" size="sm" @close="addOpen = false">
        <div class="form-group">
            <label for="genApiId">接口标识</label>
            <input id="genApiId" v-model="addForm.api_id" class="input-modern" type="text" maxlength="80" placeholder="例如:openai-image">
        </div>
        <div class="form-group">
            <label for="genApiName">名称</label>
            <input id="genApiName" v-model="addForm.name" class="input-modern" type="text" maxlength="120" placeholder="例如:OpenAI 图像">
        </div>
        <div class="form-group">
            <label for="genApiType">类型</label>
            <select id="genApiType" v-model="addForm.api_type" class="input-modern">
                <option value="openai">OpenAI</option>
                <option value="dashscope">DashScope</option>
                <option value="custom">自定义</option>
            </select>
        </div>
        <div class="form-group">
            <label for="genApiBaseUrl">Base URL</label>
            <input id="genApiBaseUrl" v-model="addForm.base_url" class="input-modern" type="text" placeholder="https://api.example.com/v1">
        </div>
        <div class="form-group">
            <label for="genApiModel">模型</label>
            <input id="genApiModel" v-model="addForm.model" class="input-modern" type="text" maxlength="120" placeholder="例如:gpt-image-1">
        </div>
        <div class="form-group">
            <label for="genApiKey">API Key</label>
            <input id="genApiKey" v-model="addForm.api_key" class="input-modern" type="password">
        </div>
        <label class="settings-toggle-row">
            <input v-model="addForm.enabled" type="checkbox">
            <span>设为启用接口</span>
        </label>
        <template #footer>
            <button class="btn-cancel" type="button" @click="addOpen = false">取消</button>
            <button class="btn-confirm" type="button" @click="submitAdd">添加</button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onMounted, reactive, ref } from 'vue'

    import type { GenImageApi } from '@/api/admin-gen-image'
    import { fetchGenImageApis, upsertGenImageApi } from '@/api/admin-gen-image'
    import { showError, showToast } from '@/stores/notify'

    import Modal from '@/ui/Modal.vue'
    import AdminPanel from '@/ui/AdminPanel.vue'

    const apis = ref<GenImageApi[]>([])
    const enabledApi = ref('')
    const loading = ref(false)
    const selectedId = ref('')

    /** 添加接口弹窗状态 */
    const addOpen = ref(false)
    const addForm = reactive({
        api_id: '',
        name: '',
        api_type: 'openai',
        base_url: '',
        model: '',
        api_key: '',
        enabled: false,
    })

    const selectedApi = computed(() => {
        return apis.value.find((api) => api.id === selectedId.value) || null
    })

    onMounted(() => {
        void load()
    })

    /** 拉取生图接口列表 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const data = await fetchGenImageApis()

            apis.value = data.apis
            enabledApi.value = data.enabledApi
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载生图接口失败')
        } finally {
            loading.value = false
        }
    }

    function selectApi(apiId: string): void {
        selectedId.value = apiId
    }

    /** 打开添加接口弹窗 */
    function handleAdd(): void {
        addForm.api_id = ''
        addForm.name = ''
        addForm.api_type = 'openai'
        addForm.base_url = ''
        addForm.model = ''
        addForm.api_key = ''
        addForm.enabled = false
        addOpen.value = true
    }

    /** 提交新增生图接口(对齐原版 admin_upsert_gen_image_api) */
    async function submitAdd(): Promise<void> {
        const apiId = addForm.api_id.trim()

        if (!apiId) {
            showToast('接口标识不能为空', 'warning')

            return
        }

        try {
            await upsertGenImageApi({
                api_id: apiId,
                name: addForm.name.trim() || apiId,
                api_type: addForm.api_type,
                base_url: addForm.base_url.trim(),
                model: addForm.model.trim(),
                api_key: addForm.api_key,
                enabled: addForm.enabled,
            })

            showToast('接口已保存', 'success')
            addOpen.value = false
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }
</script>
