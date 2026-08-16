<!--
    SkillsPanel.vue — Skill(对齐原版 chat_skill_market.js)

    设计:
      - 复用原版 .skill-subtabs / .skill-market-* / .settings-skill-* 样式
      - 我的 Skill:列表 + 新建/上传/编辑/删除/发布
      - Skill 市场:搜索 + 排序 + 卡片列表 + 详情弹窗 + 安装
      - 弹窗统一 GDDP Modal,下拉为自建(禁用原生 select)
-->

<template>
    <div>
        <div class="skill-subtabs-row">
            <div class="skill-subtabs">
                <button
                    class="skill-subtab"
                    :class="{ active: subTab === 'my' }"
                    type="button"
                    @click="switchSubTab('my')"
                >我的 Skill</button>
                <button
                    class="skill-subtab"
                    :class="{ active: subTab === 'market' }"
                    type="button"
                    @click="switchSubTab('market')"
                >Skill 市场</button>
            </div>

            <!-- 我的 Skill 工具栏与子 tab 同行 -->
            <div v-if="subTab === 'my'" class="skill-my-toolbar">
                <button class="btn-skill-create" type="button" title="上传 Skill 文件" @click="triggerUpload">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    上传 Skill
                </button>
                <button class="btn-skill-create" type="button" title="新建 Skill" @click="openEditor()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    新建 Skill
                </button>
                <input ref="skillFileInput" type="file" accept=".skill,.md,.txt,.json" style="display:none" @change="handleSkillFile">
            </div>
        </div>

        <!-- 我的 Skill -->
        <div v-if="subTab === 'my'" class="skill-subtab-content active">
            <div class="settings-skill-list">
                <div v-if="loading" class="settings-skill-empty">加载中...</div>
                <div v-else-if="!skills.length" class="settings-skill-empty">暂无自定义 Skill</div>
                <div v-for="skill in skills" :key="skill.id" class="settings-skill-item">
                    <div class="settings-skill-item-main">
                        <div class="settings-skill-item-name">{{ skillTitle(skill) }}</div>
                        <div class="settings-skill-item-desc">{{ skill.description || '(无描述)' }}</div>
                        <div class="settings-skill-item-meta">
                            <span :class="`settings-skill-origin settings-skill-origin-${skill.origin || 'global'}`">
                                {{ originLabel(skill.origin) }}
                            </span>
                        </div>
                    </div>
                    <div class="settings-skill-item-actions">
                        <button
                            v-if="skill.origin === 'self'"
                            class="btn-skill-small"
                            type="button"
                            title="编辑"
                            @click="openEditor(skill)"
                        >
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                        </button>
                        <button
                            v-if="skill.origin === 'self'"
                            class="btn-skill-small"
                            type="button"
                            title="发布到市场"
                            @click="handlePublish(skill)"
                        >
                            <i class="fa-solid fa-upload" aria-hidden="true"></i>
                        </button>
                        <button
                            v-if="skill.origin === 'self'"
                            class="btn-skill-small danger"
                            type="button"
                            title="删除"
                            @click="handleDelete(skill.id)"
                        >
                            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Skill 市场 -->
        <div v-else class="skill-subtab-content active">
            <div class="skill-market-toolbar">
                <div class="skill-market-search">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input
                        v-model="marketQuery"
                        placeholder="搜索 Skill..."
                        @input="debouncedSearch"
                    >
                </div>
                <!-- 自建排序下拉(禁用原生 select) -->
                <div class="skill-market-sort-wrap" ref="sortWrapRef">
                    <button class="skill-market-sort" type="button" :aria-expanded="sortOpen" @click.stop="sortOpen = !sortOpen">
                        {{ sortLabel }}
                        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                    <div class="skill-market-sort-menu" :class="{ open: sortOpen }">
                        <button
                            v-for="option in sortOptions"
                            :key="option.value"
                            type="button"
                            :class="{ active: marketSort === option.value }"
                            @click="selectSort(option.value)"
                        >{{ option.label }}</button>
                    </div>
                </div>
            </div>

            <div class="skill-market-list" id="skillMarketList">
                <div v-if="marketLoading" class="settings-skill-empty">加载中...</div>
                <div v-else-if="!marketSkills.length" class="settings-skill-empty">市场暂无 Skill</div>
                <div
                    v-for="item in marketSkills"
                    :key="item.id"
                    class="skill-market-card"
                    role="button"
                    tabindex="0"
                    @click="openMarketDetail(item.id)"
                    @keydown.enter="openMarketDetail(item.id)"
                >
                    <div class="skill-market-card-body">
                        <div class="skill-market-card-title">{{ item.title || item.id }}</div>
                        <div class="skill-market-card-desc">{{ item.description || '暂无描述' }}</div>
                        <div v-if="item.tags?.length" class="skill-market-tags">
                            <span v-for="tag in item.tags" :key="tag" class="skill-market-tag">{{ tag }}</span>
                        </div>
                        <div class="skill-market-card-meta">
                            <span>by {{ item.author || '匿名' }}</span>
                            <span v-if="item.version">v{{ item.version }}</span>
                            <span>{{ Number(item.install_count || 0).toLocaleString() }} 次安装</span>
                        </div>
                    </div>
                    <div class="skill-market-card-actions" @click.stop>
                        <button class="btn-skill-detail" type="button" @click="openMarketDetail(item.id)">详情</button>
                        <button
                            v-if="item.installed"
                            class="btn-skill-installed"
                            type="button"
                            disabled
                        >已安装</button>
                        <button
                            v-else
                            class="btn-skill-install"
                            type="button"
                            :disabled="installingId === item.id"
                            @click="handleInstall(item.id)"
                        >{{ installingId === item.id ? '安装中...' : '安装' }}</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 市场详情弹窗 -->
        <Modal :open="detailOpen" :title="detailSkill?.title || 'Skill 详情'" size="lg" @close="detailOpen = false">
            <div v-if="detailSkill" class="skill-detail-body">
                <div class="skill-detail-meta">
                    <span>by {{ detailSkill.author || '匿名' }}</span>
                    <span v-if="detailSkill.version">v{{ detailSkill.version }}</span>
                    <span>{{ Number(detailSkill.install_count || 0).toLocaleString() }} 次安装</span>
                    <span v-if="detailSkill.mode">{{ modeLabel(detailSkill.mode) }}</span>
                </div>
                <div v-if="detailSkill.tags?.length" class="skill-market-tags">
                    <span v-for="tag in detailSkill.tags" :key="tag" class="skill-market-tag">{{ tag }}</span>
                </div>
                <div class="skill-detail-content">
                    <MarkdownView :content="detailSkill.main_content || detailSkill.description || '暂无正文'" />
                </div>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="detailOpen = false">关闭</button>
                <button
                    v-if="detailSkill && !detailSkill.installed"
                    class="btn-confirm"
                    type="button"
                    :disabled="installingId === detailSkill?.id"
                    @click="handleInstall(detailSkill.id, true)"
                >安装</button>
                <button v-else-if="detailSkill" class="btn-confirm" type="button" disabled>已安装</button>
            </template>
        </Modal>

        <!-- 个人 Skill 编辑器 -->
        <Modal :open="editorOpen" :title="editorMode === 'edit' ? '编辑 Skill' : (editorFromUpload ? '上传 Skill' : '新建 Skill')" size="lg" @close="editorOpen = false">
            <div class="ps-editor-grid">
                <div class="form-group">
                    <label for="psEditorTitle">标题 *</label>
                    <input id="psEditorTitle" v-model="editorForm.title" class="input-modern" type="text" maxlength="120" placeholder="Skill 标题">
                </div>
                <div class="form-group">
                    <label for="psEditorId">ID</label>
                    <input id="psEditorId" v-model="editorForm.id" class="input-modern" type="text" maxlength="80" :readonly="editorMode === 'edit'" placeholder="留空自动生成">
                </div>
                <div class="form-group full-width">
                    <label for="psEditorDesc">描述</label>
                    <input id="psEditorDesc" v-model="editorForm.description" class="input-modern" type="text" maxlength="300" placeholder="一句话描述(市场展示用)">
                </div>
                <div class="form-group">
                    <label for="psEditorTags">标签(逗号分隔)</label>
                    <input id="psEditorTags" v-model="editorTagsText" class="input-modern" type="text" maxlength="200" placeholder="例如:开发, 写作">
                </div>
                <div class="form-group">
                    <label for="psEditorTools">绑定工具(逗号分隔)</label>
                    <input id="psEditorTools" v-model="editorToolsText" class="input-modern" type="text" maxlength="300" placeholder="留空为全局 Skill">
                </div>
                <div class="form-group">
                    <label>默认模式</label>
                    <div class="skill-mode-select-wrap">
                        <button class="skill-mode-select" type="button" :aria-expanded="modeOpen" @click.stop="modeOpen = !modeOpen">
                            {{ modeLabel(editorForm.mode || 'auto') }}
                            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="skill-mode-menu" :class="{ open: modeOpen }">
                            <button
                                v-for="option in modeOptions"
                                :key="option.value"
                                type="button"
                                :class="{ active: (editorForm.mode || 'auto') === option.value }"
                                @click="selectMode(option.value)"
                            >{{ option.label }}</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label for="psEditorContent">指令内容</label>
                <textarea id="psEditorContent" v-model="editorForm.main_content" class="input-modern skill-content-textarea" rows="8" placeholder="Skill 提示词/指令正文..."></textarea>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="editorOpen = false">取消</button>
                <button
                    v-if="editorMode === 'edit'"
                    class="btn-primary-outline"
                    type="button"
                    @click="handlePublishFromEditor"
                >发布到市场</button>
                <button class="btn-confirm" type="button" :disabled="editorSaving" @click="handleSaveEditor">
                    {{ editorMode === 'edit' ? '保存' : '创建' }}
                </button>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

    import type { MarketSkillItem, SkillItem, SkillPayload } from '@/api/skills'
    import {
        createMySkill,
        deleteMySkill,
        fetchMarketSkillDetail,
        fetchMarketSkills,
        fetchMySkills,
        installMarketSkill,
        parseSkillText,
        publishMarketSkill,
        updateMySkill,
    } from '@/api/skills'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import MarkdownView from './MarkdownView.vue'
    import Modal from '@/ui/Modal.vue'

    const subTab = ref<'my' | 'market'>('my')
    const skills = ref<SkillItem[]>([])
    const loading = ref(false)

    /** 市场状态 */
    const marketSkills = ref<MarketSkillItem[]>([])
    const marketLoading = ref(false)
    const marketQuery = ref('')
    const marketSort = ref('installs')
    const installingId = ref('')
    const sortOpen = ref(false)
    const sortWrapRef = ref<HTMLElement | null>(null)

    const sortOptions = [
        { value: 'installs', label: '按安装量' },
        { value: 'newest', label: '最新发布' },
        { value: 'title', label: '按标题' },
    ]

    const sortLabel = computed(() => {
        return sortOptions.find((option) => option.value === marketSort.value)?.label || '按安装量'
    })

    /** 市场详情 */
    const detailOpen = ref(false)
    const detailSkill = ref<MarketSkillItem | null>(null)

    /** 编辑器状态 */
    const editorOpen = ref(false)
    const editorSaving = ref(false)
    const editorMode = ref<'create' | 'edit'>('create')
    const editorFromUpload = ref(false)
    const modeOpen = ref(false)
    const modeOptions = [
        { value: 'off', label: 'Off' },
        { value: 'auto', label: 'Auto' },
        { value: 'force', label: 'Force' },
    ]
    const editorForm = reactive({
        id: '',
        title: '',
        description: '',
        tags: [] as string[],
        required_tools: [] as string[],
        mode: 'auto',
        main_content: '',
    })
    const editorTagsText = computed({
        get: () => editorForm.tags.join(', '),
        set: (value: string) => {
            editorForm.tags = value.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
        },
    })
    const editorToolsText = computed({
        get: () => editorForm.required_tools.join(', '),
        set: (value: string) => {
            editorForm.required_tools = value.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
        },
    })

    const skillFileInput = ref<HTMLInputElement | null>(null)

    onMounted(() => {
        void load()
        document.addEventListener('click', onPageClick)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', onPageClick)
    })

    /** 页面点击:关闭自建下拉 */
    function onPageClick(event: MouseEvent): void {
        const target = event.target as Node

        if (sortWrapRef.value && !sortWrapRef.value.contains(target)) {
            sortOpen.value = false
        }
    }

    function originLabel(origin?: string): string {
        if (origin === 'market') {
            return '市场安装'
        }

        if (origin === 'self') {
            return '自建'
        }

        return '全局'
    }

    /** 运行时 Skill 的展示名(对齐后端 title 字段;兼容 name) */
    function skillTitle(skill: SkillItem): string {
        return String(skill.name || skill.title || skill.id || '')
    }

    function modeLabel(mode?: string): string {
        const value = String(mode || 'auto').toLowerCase()

        if (value === 'force') {
            return 'Force'
        }

        if (value === 'off') {
            return 'Off'
        }

        return 'Auto'
    }

    function switchSubTab(tab: 'my' | 'market'): void {
        subTab.value = tab

        if (tab === 'market' && !marketSkills.value.length) {
            void loadMarket()
        }
    }

    /** 拉取我的 Skill 列表 */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            skills.value = await fetchMySkills()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Skill 失败')
        } finally {
            loading.value = false
        }
    }

    /** 拉取市场列表 */
    async function loadMarket(): Promise<void> {
        if (marketLoading.value) {
            return
        }

        marketLoading.value = true

        try {
            const data = await fetchMarketSkills({ q: marketQuery.value.trim(), sort: marketSort.value })

            marketSkills.value = data.skills
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Skill 市场失败')
        } finally {
            marketLoading.value = false
        }
    }

    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

    /** 搜索防抖(对齐原版 400ms) */
    function debouncedSearch(): void {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer)
        }

        searchDebounceTimer = setTimeout(() => {
            void loadMarket()
        }, 400)
    }

    function selectSort(value: string): void {
        marketSort.value = value
        sortOpen.value = false
        void loadMarket()
    }

    /** 打开市场详情 */
    async function openMarketDetail(skillId: string): Promise<void> {
        try {
            detailSkill.value = await fetchMarketSkillDetail(skillId)
            detailOpen.value = true
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载详情失败')
        }
    }

    /** 安装市场 Skill(对齐原版 installMarketSkill) */
    async function handleInstall(skillId: string, fromDetail = false): Promise<void> {
        installingId.value = skillId

        try {
            await installMarketSkill(skillId)

            showToast('Skill 已安装', 'success')
            detailOpen.value = false
            await load()
            await loadMarket()
        } catch (error) {
            showError(error instanceof Error ? error.message : '安装失败')
        } finally {
            installingId.value = ''
            void fromDetail
        }
    }

    /** 删除个人 Skill */
    async function handleDelete(skillId: string): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除 Skill',
            content: '确定删除这个 Skill 吗?此操作不可撤销。',
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteMySkill(skillId)

            showToast('Skill 已删除', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 打开编辑器(新建或编辑) */
    function openEditor(skill?: SkillItem): void {
        editorMode.value = skill ? 'edit' : 'create'
        editorFromUpload.value = false
        editorForm.id = String(skill?.id || '')
        editorForm.title = skill ? skillTitle(skill) : ''
        editorForm.description = String(skill?.description || '')
        editorForm.tags = Array.isArray(skill?.tags) ? (skill?.tags as string[]) : []
        editorForm.required_tools = Array.isArray(skill?.required_tools) ? (skill?.required_tools as string[]) : []
        editorForm.mode = String(skill?.mode || 'auto')
        editorForm.main_content = String(skill?.main_content || '')
        editorOpen.value = true
    }

    /** 触发上传文件选择 */
    function triggerUpload(): void {
        skillFileInput.value?.click()
    }

    /** 解析上传的 Skill 文件并预填编辑器(对齐原版 prefillEditorFromSkill) */
    async function handleSkillFile(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const file = input.files?.[0]

        input.value = ''

        if (!file) {
            return
        }

        try {
            const text = await file.text()
            const parsed = parseSkillText(text, file.name)

            editorMode.value = 'create'
            editorFromUpload.value = true
            editorForm.id = parsed.id || ''
            editorForm.title = parsed.title || file.name
            editorForm.description = parsed.description || ''
            editorForm.tags = parsed.tags || []
            editorForm.required_tools = parsed.required_tools || []
            editorForm.mode = parsed.mode || 'auto'
            editorForm.main_content = parsed.main_content || ''
            editorOpen.value = true
        } catch (error) {
            showError(error instanceof Error ? error.message : '解析 Skill 文件失败')
        }
    }

    function selectMode(value: string): void {
        editorForm.mode = value
        modeOpen.value = false
    }

    /** 保存个人 Skill(对齐原版 savePersonalSkill) */
    async function handleSaveEditor(): Promise<void> {
        const title = editorForm.title.trim()

        if (!title) {
            showToast('标题不能为空', 'warning')

            return
        }

        editorSaving.value = true

        try {
            const payload: SkillPayload = {
                id: editorForm.id.trim() || undefined,
                title,
                description: editorForm.description.trim(),
                tags: editorForm.tags,
                required_tools: editorForm.required_tools,
                mode: editorForm.mode,
                main_content: editorForm.main_content,
            }

            if (editorMode.value === 'edit') {
                await updateMySkill(editorForm.id.trim(), payload)

                showToast('Skill 已更新', 'success')
            } else {
                await createMySkill(payload)

                showToast('Skill 已创建', 'success')
            }

            editorOpen.value = false
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        } finally {
            editorSaving.value = false
        }
    }

    /** 发布当前 Skill 到市场(从列表行) */
    async function handlePublish(skill: SkillItem): Promise<void> {
        const title = skillTitle(skill).trim()

        if (!title) {
            showToast('标题不能为空,无法发布', 'warning')

            return
        }

        const confirmed = await showConfirm({
            title: '发布到市场',
            content: '发布后所有用户可在市场看到该 Skill,确认发布?',
            confirmText: '发布',
            cancelText: '取消',
        })

        if (!confirmed) {
            return
        }

        try {
            const payload: SkillPayload = {
                id: String(skill.id || ''),
                title,
                description: String(skill.description || ''),
                tags: Array.isArray(skill.tags) ? (skill.tags as string[]) : [],
                required_tools: Array.isArray(skill.required_tools) ? (skill.required_tools as string[]) : [],
                mode: String(skill.mode || 'auto'),
                main_content: String(skill.main_content || ''),
                version: '1.0.0',
            }

            await publishMarketSkill(payload)

            showToast('Skill 已发布到市场', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '发布失败')
        }
    }

    /** 从编辑器发布(编辑模式时正文可能未保存,直接用表单内容) */
    async function handlePublishFromEditor(): Promise<void> {
        const title = editorForm.title.trim()

        if (!title) {
            showToast('标题不能为空,无法发布', 'warning')

            return
        }

        const confirmed = await showConfirm({
            title: '发布到市场',
            content: '发布后所有用户可在市场看到该 Skill,确认发布?',
            confirmText: '发布',
            cancelText: '取消',
        })

        if (!confirmed) {
            return
        }

        try {
            const payload: SkillPayload = {
                id: editorForm.id.trim() || undefined,
                title,
                description: editorForm.description.trim(),
                tags: editorForm.tags,
                required_tools: editorForm.required_tools,
                mode: editorForm.mode,
                main_content: editorForm.main_content,
                version: '1.0.0',
            }

            await publishMarketSkill(payload)

            showToast('Skill 已发布到市场', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '发布失败')
        }
    }
</script>

<style scoped>
    /* 自建排序下拉(对齐原版 .skill-market-sort 视觉) */
    .skill-market-sort-wrap {
        position: relative;
        flex: none;
    }

    .skill-market-sort {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: 1px solid var(--border-color, #ddd);
        border-radius: 8px;
        background: var(--card-bg, #fff);
        font-size: 13px;
        color: var(--text-primary, #333);
        cursor: pointer;
        outline: none;
        white-space: nowrap;
    }

    .skill-market-sort i {
        font-size: 11px;
        color: var(--text-tertiary, #999);
    }

    .skill-market-sort-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 30;
        min-width: 130px;
        padding: 4px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10);
        display: none;
    }

    .skill-market-sort-menu.open {
        display: block;
    }

    .skill-market-sort-menu button {
        display: block;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 12.5px;
        color: #334155;
        text-align: left;
        cursor: pointer;
    }

    .skill-market-sort-menu button:hover,
    .skill-market-sort-menu button.active {
        background: #eef2ff;
        color: #4f46e5;
    }

    /* 列表行操作按钮 */
    .settings-skill-item-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }

    .btn-skill-small {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #fff;
        color: #64748b;
        font-size: 12px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease;
    }

    .btn-skill-small:hover {
        border-color: #4f46e5;
        color: #4f46e5;
    }

    .btn-skill-small.danger:hover {
        border-color: #e53935;
        color: #e53935;
    }

    /* 详情弹窗 */
    .skill-detail-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .skill-detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
        color: #64748b;
    }

    .skill-detail-content {
        max-height: 380px;
        overflow-y: auto;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #f8fafc;
        font-size: 13px;
        color: #0f172a;
        white-space: pre-wrap;
        word-break: break-word;
    }

    /* 编辑器模式自建下拉 */
    .skill-mode-select-wrap {
        position: relative;
        display: inline-block;
    }

    .skill-mode-select {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 130px;
        padding: 8px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
        font-size: 13px;
        color: #0f172a;
        cursor: pointer;
    }

    .skill-mode-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 30;
        min-width: 130px;
        padding: 4px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10);
        display: none;
    }

    .skill-mode-menu.open {
        display: block;
    }

    .skill-mode-menu button {
        display: block;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 12.5px;
        color: #334155;
        text-align: left;
        cursor: pointer;
    }

    .skill-mode-menu button:hover,
    .skill-mode-menu button.active {
        background: #eef2ff;
        color: #4f46e5;
    }

    .skill-content-textarea {
        width: 100%;
        resize: vertical;
        font-family: inherit;
        line-height: 1.6;
    }
</style>