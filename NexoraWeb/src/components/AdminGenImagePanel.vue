<!--
    AdminGenImagePanel.vue — 管理员:生图 API(对齐原版 settings-admin-gen-image-tab)

    设计:
      - 复用 AdminPanel 布局:左接口列表 + 右详情
      - 详情为完整可编辑表单(标识/名称/类型/Key/BaseURL/模型/尺寸/质量/返回格式/超时/启用)
      - 保存走 upsert(original_api_id 支持重命名),启用/停用/删除与后端一致
-->

<template>
    <AdminPanel>
        <template #list>
            <div v-if="loading" class="admin-user-detail-empty">加载中...</div>
            <div v-else-if="!filteredApis.length" class="admin-user-detail-empty">暂无生图接口</div>
            <div
                v-for="api in filteredApis"
                :key="api.id"
                class="admin-user-item"
                :class="{ active: selectedId === api.id }"
                role="button"
                tabindex="0"
                @click="selectApi(api.id)"
                @keydown.enter="selectApi(api.id)"
            >
                <span class="admin-user-main">
                    <span class="admin-user-name">{{ api.name || api.id }}</span>
                    <span class="admin-user-meta">
                        {{ api.enabled ? '启用' : '停用' }}
                        <template v-if="api.id === enabledApi"> · 当前</template>
                    </span>
                </span>
            </div>
        </template>

        <template #detail>
            <div v-if="!selectedApi && !addingNew" class="admin-user-detail-empty">请选择左侧接口查看详情</div>
            <div v-else class="gen-image-detail">
                <div class="admin-user-detail-head">
                    <span class="admin-user-avatar">
                        <i class="fa-regular fa-image" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name">{{ isEditingExisting ? (form.name || form.api_id) : '新增生图接口' }}</div>
                        <div class="admin-user-meta">{{ isEditingExisting ? `ID: ${form.api_id}` : '填写接口数据后保存' }}</div>
                    </div>
                </div>

                <div class="admin-user-detail-grid">
                    <div class="gddp-form-field">
                        <label for="genDetailId">接口标识</label>
                        <input id="genDetailId" v-model="form.api_id" class="gddp-input" type="text" maxlength="80" placeholder="openai_image">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailName">接口名称</label>
                        <input id="genDetailName" v-model="form.name" class="gddp-input" type="text" maxlength="120" placeholder="OpenAI Image">
                    </div>
                    <div class="gddp-form-field">
                        <label>API Type</label>
                        <SettingSelect v-model="form.api_type" :options="genApiTypeOptions" width="100%" />
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailKey">API Key</label>
                        <input
                            id="genDetailKey"
                            v-model="form.api_key"
                            class="gddp-input"
                            type="password"
                            autocomplete="off"
                            :placeholder="selectedApi?.api_key_masked || 'api key'"
                        >
                    </div>
                    <div class="gddp-form-field" style="grid-column: 1 / -1;">
                        <label for="genDetailBaseUrl">Base URL</label>
                        <input id="genDetailBaseUrl" v-model="form.base_url" class="gddp-input" type="text" placeholder="https://api.openai.com/v1">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailModel">模型 ID</label>
                        <input id="genDetailModel" v-model="form.model" class="gddp-input" type="text" maxlength="120" placeholder="gpt-image-1">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailSize">尺寸</label>
                        <input id="genDetailSize" v-model="form.size" class="gddp-input" type="text" placeholder="1024x1024">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailQuality">质量</label>
                        <input id="genDetailQuality" v-model="form.quality" class="gddp-input" type="text" placeholder="auto">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailFormat">返回格式</label>
                        <input id="genDetailFormat" v-model="form.response_format" class="gddp-input" type="text" placeholder="b64_json">
                    </div>
                    <div class="gddp-form-field">
                        <label for="genDetailTimeout">超时秒数</label>
                        <input id="genDetailTimeout" v-model="form.timeout" class="gddp-input" type="number" min="10" max="600" placeholder="120">
                    </div>
                    <label class="settings-toggle-row">
                        <input v-model="form.enabled" type="checkbox">
                        <span>保存后作为当前启用接口</span>
                    </label>
                    <div class="gddp-form-field">
                        <label>创建时间</label>
                        <div class="admin-info-text">{{ formatTs(selectedApi?.created_at) }}</div>
                    </div>
                    <div class="gddp-form-field">
                        <label>更新时间</label>
                        <div class="admin-info-text">{{ formatTs(selectedApi?.updated_at) }}</div>
                    </div>
                </div>

                <SettingActionRow>
                    <button class="btn-primary-outline" type="button" @click="saveDetail">
                        <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                        <span>保存</span>
                    </button>
                    <button
                        v-if="isEditingExisting"
                        class="btn-primary-outline"
                        type="button"
                        @click="handleEnableOrDisable"
                    >
                        <i :class="form.enabled ? 'fa-solid fa-pause' : 'fa-solid fa-play'" aria-hidden="true"></i>
                        <span>{{ form.enabled ? '停用' : '启用' }}</span>
                    </button>
                    <button v-if="isEditingExisting" class="btn-danger-small" type="button" @click="handleDelete">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        <span>删除</span>
                    </button>
                    <button v-if="addingNew" class="btn-cancel" type="button" @click="cancelAdd">
                        <span>取消</span>
                    </button>
                </SettingActionRow>
            </div>
        </template>
    </AdminPanel>
</template>

<script setup lang="ts">
    import { computed, reactive, ref, watch } from 'vue'

    import type { GenImageApi, GenImageApiForm } from '@/api/admin-gen-image'
    import { deleteGenImageApi, disableGenImageApi, enableGenImageApi, fetchGenImageApis, upsertGenImageApi } from '@/api/admin-gen-image'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import AdminPanel from '@/ui/AdminPanel.vue'
    import SettingActionRow from '@/ui/settings/SettingActionRow.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    /** API 类型(对齐原版 openai / openai_compatible 二选一) */
    const genApiTypeOptions = [
        { value: 'openai', label: 'openai' },
        { value: 'openai_compatible', label: 'openai_compatible' },
    ]

    const apis = ref<GenImageApi[]>([])
    const enabledApi = ref('')
    const loading = ref(false)
    const selectedId = ref('')
    const query = ref('')

    /** 详情编辑表单(与后端 record 字段一一对应) */
    const form = reactive<GenImageApiForm>({
        api_id: '',
        name: '',
        api_type: 'openai',
        api_key: '',
        base_url: '',
        model: '',
        size: '1024x1024',
        quality: 'auto',
        response_format: 'b64_json',
        timeout: '120',
        enabled: false,
    })

    /** 搜索过滤后的接口列表 */
    const filteredApis = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        if (!keyword) {
            return apis.value
        }

        return apis.value.filter((api) => {
            return [
                api.id,
                api.name,
                api.base_url,
                api.model,
                api.enabled ? '启用' : '停用',
            ].join(' ').toLowerCase().includes(keyword)
        })
    })

    const selectedApi = computed(() => {
        return apis.value.find((api) => api.id === selectedId.value) || null
    })

    const isEditingExisting = computed(() => Boolean(selectedApi.value))
    const addingNew = ref(false)

    watch(selectedApi, (api) => {
        if (!api) {
            return
        }

        addingNew.value = false

        form.api_id = api.api_id || api.id || ''
        form.name = api.name || ''
        form.api_type = api.api_type === 'openai_compatible' ? 'openai_compatible' : 'openai'
        form.api_key = ''
        form.base_url = api.base_url || ''
        form.model = api.model || ''
        form.size = api.size || '1024x1024'
        form.quality = api.quality || 'auto'
        form.response_format = api.response_format || 'b64_json'
        form.timeout = String(api.timeout ?? 120)
        form.enabled = Boolean(api.enabled)
    })

    /** 时间戳格式化 */
    function formatTs(ts: number | undefined): string {
        if (!ts) {
            return '-'
        }

        try {
            return new Date(Number(ts) * 1000).toLocaleString()
        } catch {
            return '-'
        }
    }

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

            if (selectedId.value && !apis.value.some((api) => api.id === selectedId.value)) {
                selectedId.value = ''
            }

            if (!selectedId.value && apis.value.length) {
                selectedId.value = apis.value[0].id
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载生图接口失败')
        } finally {
            loading.value = false
        }
    }

    function selectApi(apiId: string): void {
        selectedId.value = apiId
    }

    /** 启用/停用当前接口 */
    async function handleEnableOrDisable(): Promise<void> {
        const apiId = selectedApi.value?.id

        if (!apiId) {
            return
        }

        try {
            if (form.enabled) {
                await disableGenImageApi(apiId)
                showToast('接口已停用', 'success')
            } else {
                await enableGenImageApi(apiId)
                showToast('接口已启用', 'success')
            }

            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }
    }

    /** 删除接口 */
    async function handleDelete(): Promise<void> {
        const apiId = selectedApi.value?.id

        if (!apiId) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除生图接口',
            content: '确定删除这个生图接口吗?',
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteGenImageApi(apiId)

            showToast('接口已删除', 'success')
            selectedId.value = ''
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 打开新增模式:清空表单并保持编辑态 */
    function handleAdd(): void {
        form.api_id = ''
        form.name = ''
        form.api_type = 'openai'
        form.api_key = ''
        form.base_url = ''
        form.model = ''
        form.size = '1024x1024'
        form.quality = 'auto'
        form.response_format = 'b64_json'
        form.timeout = '120'
        form.enabled = false
        selectedId.value = ''
        addingNew.value = true
    }

    /** 取消新增:回到列表选中态 */
    function cancelAdd(): void {
        addingNew.value = false

        if (apis.value.length) {
            selectedId.value = apis.value[0].id
        }
    }

    /** 保存详情(对齐原版 saveAdminGenImageApiDetail:upsert 支持重命名) */
    async function saveDetail(): Promise<void> {
        const apiId = form.api_id.trim()

        if (!apiId) {
            showToast('接口标识不能为空', 'warning')

            return
        }

        const timeoutValue = /^\d+$/.test(form.timeout) ? Number.parseInt(form.timeout, 10) : NaN

        if (!Number.isFinite(timeoutValue)) {
            showToast('超时秒数必须是数字', 'warning')

            return
        }

        try {
            await upsertGenImageApi({
                original_api_id: isEditingExisting.value ? selectedApi.value?.id : undefined,
                api_id: apiId,
                name: form.name.trim() || apiId,
                api_type: form.api_type,
                api_key: form.api_key.trim(),
                base_url: form.base_url.trim(),
                model: form.model.trim(),
                size: form.size.trim(),
                quality: form.quality.trim(),
                response_format: form.response_format.trim(),
                timeout: timeoutValue,
                enabled: form.enabled,
            })

            showToast('生图接口已保存', 'success')
            selectedId.value = apiId
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 页头筛选输入转发 */
    function setQuery(value?: string): void {
        query.value = String(value || '')
    }

    defineExpose({
        handleAdd,
        load,
        setQuery,
    })
</script>
