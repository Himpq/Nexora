<!--
    SkillsPanel.vue — Skill(对齐原版 chat_skill_market.js)

    设计:
      - 子标签(我的 Skill / Skill 市场)+ 上传/新建按钮由 SettingsModal 页头提供(pageActionsMap['skills'])
      - 我的 Skill:列表 + 统一完整编辑器(个人/市场/全局管理员同入口)
      - Skill 市场:搜索 + SettingSelect 排序 + 卡片列表 + 详情弹窗 + 安装
      - 弹窗统一 GDDP Modal,下拉统一 SettingSelect
-->

<template>
    <div>
        <!-- 隐藏文件选择(页头"上传 Skill"经 expose triggerUpload 触发) -->
        <input ref="skillFileInput" type="file" accept=".skill,.txt,.md,.markdown,.json,.yaml,.yml,.prompt" style="display:none" @change="handleSkillFile">

        <!-- 我的 Skill -->
        <div v-if="subTab === 'my'">
            <div class="settings-skill-list">
                <div v-if="loading" class="settings-skill-empty">加载中...</div>
                <div v-else-if="!skills.length" class="settings-skill-empty">暂无自定义 Skill</div>
                <div
                    v-for="skill in skills"
                    :key="skill.id"
                    class="settings-skill-card"
                    :data-skill-id="skill.id"
                    :data-skill-origin="skill.origin || 'global'"
                >
                    <div class="settings-skill-top">
                        <div class="settings-skill-icon" aria-hidden="true">
                            <i :class="skillIconClass(skill)" style="font-size:20px;"></i>
                        </div>
                        <div
                            class="settings-skill-main"
                            role="button"
                            tabindex="0"
                            @click="openEditor(skill)"
                            @keydown.enter="openEditor(skill)"
                        >
                            <div class="settings-skill-title">
                                {{ skillTitle(skill) }}
                            </div>
                            <div class="settings-skill-preview">{{ skillPreview(skill) }}</div>
                        </div>
                        <div class="settings-skill-controls">
                            <span class="settings-skill-mode-label">Mode</span>
                            <SettingSelect
                                :model-value="skillMode(skill)"
                                :options="modeSelectOptions"
                                width="88px"
                                @update:model-value="changeSkillMode(skill, String($event))"
                            />
                        </div>
                    </div>
                    <div class="settings-skill-divider"></div>
                    <div class="settings-skill-footer">
                        <span class="settings-skill-badge" :title="skillTools(skill).join(', ') || '无工具约束'">
                            {{ skillBadgeText(skill) }}
                        </span>
                        <div class="settings-skill-actions">
                            <button
                                v-if="canEditSkill(skill)"
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
                                v-if="isEditableSkill(skill)"
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
        </div>

        <!-- Skill 市场 -->
        <div v-else>
            <div class="skill-market-toolbar">
                <div class="skill-market-search">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input
                        v-model="marketQuery"
                        placeholder="搜索 Skill..."
                        @input="debouncedSearch"
                    >
                </div>
                <SettingSelect
                    :model-value="marketSort"
                    :options="sortOptions"
                    width="130px"
                    @update:model-value="selectSort"
                />
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

            <!-- 市场分页(对齐原版 loadMarketSkills page/page_size=20) -->
            <div v-if="marketTotal > 0" class="skill-market-pagination">
                <button
                    class="btn-skill-detail"
                    type="button"
                    :disabled="marketPage <= 1 || marketLoading"
                    @click="goMarketPage(marketPage - 1)"
                >上一页</button>
                <span class="skill-market-page-info">
                    第 {{ marketPage }} / {{ marketTotalPages }} 页 · 共 {{ marketTotal }} 个
                </span>
                <button
                    class="btn-skill-detail"
                    type="button"
                    :disabled="marketPage >= marketTotalPages || marketLoading"
                    @click="goMarketPage(marketPage + 1)"
                >下一页</button>
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
                    <span v-if="detailSkill.required_tools?.length">工具:{{ detailSkill.required_tools.join(',') }}</span>
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
                    <SettingSelect
                        :model-value="editorForm.mode || 'auto'"
                        :options="modeSelectOptions"
                        width="130px"
                        @update:model-value="selectMode"
                    />
                </div>
            </div>
            <div class="form-group">
                <label for="psEditorContent">指令内容</label>
                <textarea id="psEditorContent" v-model="editorForm.main_content" class="input-modern skill-content-textarea" rows="8" placeholder="Skill 提示词/指令正文..."></textarea>
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="editorOpen = false">取消</button>
                <button
                    v-if="editorMode === 'edit' && !editingGlobalSkill"
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
    import { computed, onMounted, reactive, ref } from 'vue'

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
        saveSkillModes,
        updateMySkill,
        upsertCatalogSkill,
    } from '@/api/skills'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import MarkdownView from './MarkdownView.vue'
    import Modal from '@/ui/Modal.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    const userStore = useUserStore()

    const subTab = ref<'my' | 'market'>('my')
    const skills = ref<SkillItem[]>([])
    const skillModes = ref<Record<string, string>>({})
    const loading = ref(false)

    /** 市场状态 */
    const marketSkills = ref<MarketSkillItem[]>([])
    const marketLoading = ref(false)
    const marketQuery = ref('')
    const marketSort = ref('installs')
    const installingId = ref('')
    /** 市场分页(对齐原版 loadMarketSkills:page + page_size=20 + total) */
    const marketPage = ref(1)
    const marketTotal = ref(0)
    const MARKET_PAGE_SIZE = 20

    /** 市场总页数 */
    const marketTotalPages = computed(() => {
        return Math.max(1, Math.ceil(marketTotal.value / MARKET_PAGE_SIZE))
    })

    const sortOptions = [
        { value: 'installs', label: '按安装量' },
        { value: 'newest', label: '最新发布' },
        { value: 'title', label: '按标题' },
    ]

    /** 市场详情 */
    const detailOpen = ref(false)
    const detailSkill = ref<MarketSkillItem | null>(null)

    /** 编辑器状态 */
    const editorOpen = ref(false)
    const editorSaving = ref(false)
    const editorMode = ref<'create' | 'edit'>('create')
    const editorFromUpload = ref(false)
    /** 正在编辑的全局 Skill 原始数据(管理员经 upsert 保存;个人 Skill 编辑时为 null) */
    const editingGlobalSkill = ref<SkillItem | null>(null)

    /** mode 下拉选项(列表行与编辑器共用) */
    const modeSelectOptions = [
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
    })

    /** 可编辑/可删除的 skill(自建 + 市场安装,对齐原版 isPersonal) */
    function isEditableSkill(skill: SkillItem): boolean {
        return skill.origin === 'self' || skill.origin === 'market'
    }

    /** 当前用户是否为管理员(全局 Skill 编辑权限,对齐原版 canEditCatalog) */
    function isAdmin(): boolean {
        return String(userStore.user?.role || 'member').toLowerCase() === 'admin'
    }

    /** 可打开编辑器的 skill(个人/市场安装 + 全局管理员;统一完整编辑器) */
    function canEditSkill(skill: SkillItem): boolean {
        return isEditableSkill(skill) || (skill.origin === 'global' && isAdmin())
    }

    /** skill 绑定工具列表(对齐原版 required_tools 徽标) */
    function skillTools(skill: SkillItem): string[] {
        const tools = skill.required_tools

        return Array.isArray(tools) ? (tools as string[]) : []
    }

    /** 运行时 Skill 的展示名(对齐后端 title 字段;兼容 name) */
    function skillTitle(skill: SkillItem): string {
        return String(skill.name || skill.title || skill.id || '')
    }

    /**
     * 卡片预览(对齐原版 buildSkillPreviewText:优先 description,缺失时用 main_content 裁切片段)
     * 确保无描述元信息的 Skill 也展示可读摘要,而不是"(无描述)"
     */
    function skillPreview(skill: SkillItem): string {
        const desc = String(skill.description || '').replace(/\s+/g, ' ').trim()
        const raw = desc || String(skill.main_content || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()

        if (!raw) {
            return '(暂无内容)'
        }

        return raw.length <= 180 ? raw : `${raw.slice(0, 180)}...`
    }

    /** 卡片图标(对齐原版 resolveSkillCardIcon:按标题/绑定工具推断,用 fa 图标替代 emoji) */
    function skillIconClass(skill: SkillItem): string {
        const title = String(skill.title || skill.name || '').toLowerCase()
        const tools = skillTools(skill).map((t) => String(t).toLowerCase())
        const merged = `${title} ${tools.join(' ')}`

        if (/mail|email|smtp|imap/.test(merged)) {
            return 'fa-regular fa-envelope'
        }

        if (/web|search|crawl|browser/.test(merged)) {
            return 'fa-solid fa-magnifying-glass'
        }

        if (/file|upload|sandbox|document/.test(merged)) {
            return 'fa-solid fa-folder-open'
        }

        if (/code|python|js|tool/.test(merged)) {
            return 'fa-solid fa-code'
        }

        return 'fa-solid fa-wand-magic-sparkles'
    }

    /** 卡片底部工具徽标(对齐原版 settings-skill-badge:首工具 +N 或无工具约束) */
    function skillBadgeText(skill: SkillItem): string {
        const tools = skillTools(skill)

        if (!tools.length) {
            return '无工具约束'
        }

        return tools.length > 1 ? `${tools[0]} +${tools.length - 1}` : tools[0]
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

    /** 切换子标签(页头 subtabs 转发;首次进入市场时拉取列表) */
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
            const data = await fetchMySkills()

            skills.value = data.skills
            skillModes.value = data.skillModes
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Skill 失败')
        } finally {
            loading.value = false
        }
    }

    /** 某 skill 的当前运行模式(对齐原版 skill_modes 联动) */
    function skillMode(skill: SkillItem): string {
        const mode = skillModes.value[String(skill.id || '')]

        return String(mode || skill.mode || 'off').toLowerCase()
    }

    /** 切换 skill 运行模式(对齐原版 saveSkillModesState → /api/skills/settings) */
    async function changeSkillMode(skill: SkillItem, mode: string): Promise<void> {
        try {
            const next = { ...skillModes.value, [String(skill.id || '')]: mode }

            await saveSkillModes(next)

            skillModes.value = next
            showToast(`Skill 已设为 ${modeLabel(mode)}`, 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        }
    }

    /** 拉取市场列表(对齐原版 loadMarketSkills:分页参数) */
    async function loadMarket(): Promise<void> {
        if (marketLoading.value) {
            return
        }

        marketLoading.value = true

        try {
            const data = await fetchMarketSkills({
                q: marketQuery.value.trim(),
                sort: marketSort.value,
                page: marketPage.value,
                pageSize: MARKET_PAGE_SIZE,
            })

            marketSkills.value = data.skills
            marketTotal.value = data.total
            marketPage.value = Math.max(1, data.page || marketPage.value)
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Skill 市场失败')
        } finally {
            marketLoading.value = false
        }
    }

    /** 翻页 */
    async function goMarketPage(page: number): Promise<void> {
        const target = Math.max(1, Math.min(page, marketTotalPages.value))

        if (target === marketPage.value) {
            return
        }

        marketPage.value = target
        await loadMarket()
    }

    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

    /** 搜索防抖(对齐原版 400ms;搜索重置回第 1 页) */
    function debouncedSearch(): void {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer)
        }

        searchDebounceTimer = setTimeout(() => {
            marketPage.value = 1
            void loadMarket()
        }, 400)
    }

    /** 市场排序切换(SettingSelect 转发;重置回第 1 页) */
    function selectSort(value: string | number): void {
        marketSort.value = String(value)
        marketPage.value = 1
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

    /** 打开编辑器(新建或编辑;全局 Skill 仅管理员可达,记录原始数据供 upsert 保存) */
    function openEditor(skill?: SkillItem): void {
        editorMode.value = skill ? 'edit' : 'create'
        editorFromUpload.value = false
        editingGlobalSkill.value = skill && skill.origin === 'global' ? skill : null
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
            editingGlobalSkill.value = null
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

    /** 编辑器默认模式下拉(SettingSelect 转发) */
    function selectMode(value: string | number): void {
        editorForm.mode = String(value)
    }

    /** 描述派生 (对齐原版 buildSkillPreviewText:若 description 为空则从 main_content 裁剪 180 字符) */
    function deriveDescription(description: string, mainContent: string): string {
        const desc = String(description || '').replace(/\s+/g, ' ').trim()

        if (desc) {
            return desc
        }

        const raw = String(mainContent || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()

        if (!raw) {
            return ''
        }

        return raw.length <= 180 ? raw : `${raw.slice(0, 180)}...`
    }

    /** 保存 Skill(全局走目录 upsert 尽传字段;个人走 my 接口,对齐原版 savePersonalSkill) */
    async function handleSaveEditor(): Promise<void> {
        const title = editorForm.title.trim()

        if (!title) {
            showToast('标题不能为空', 'warning')

            return
        }

        editorSaving.value = true

        try {
            if (editorMode.value === 'edit' && editingGlobalSkill.value) {
                const skill = editingGlobalSkill.value

                await upsertCatalogSkill({
                    id: editorForm.id.trim(),
                    title,
                    required_tools: editorForm.required_tools,
                    mode: editorForm.mode,
                    author: String(skill.author || ''),
                    release_date: String(skill.release_date || ''),
                    version: String(skill.version || ''),
                    update_date: String(skill.update_date || ''),
                    main_content: editorForm.main_content,
                })

                showToast('Skill 已更新', 'success')
            } else if (editorMode.value === 'edit') {
                await updateMySkill(editorForm.id.trim(), {
                    id: editorForm.id.trim(),
                    title,
                    description: deriveDescription(editorForm.description, editorForm.main_content),
                    tags: editorForm.tags,
                    required_tools: editorForm.required_tools,
                    mode: editorForm.mode,
                    main_content: editorForm.main_content,
                })

                showToast('Skill 已更新', 'success')
            } else {
                await createMySkill({
                    id: editorForm.id.trim() || undefined,
                    title,
                    description: deriveDescription(editorForm.description, editorForm.main_content),
                    tags: editorForm.tags,
                    required_tools: editorForm.required_tools,
                    mode: editorForm.mode,
                    main_content: editorForm.main_content,
                })

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
                description: deriveDescription(String(skill.description || ''), String(skill.main_content || '')),
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
                description: deriveDescription(editorForm.description, editorForm.main_content),
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

    /** 页头操作转发入口(switchSubTab/openEditor/triggerUpload) */
    defineExpose({
        switchSubTab,
        openEditor,
        triggerUpload,
    })
</script>

<style scoped>
    /* 列表行操作按钮(与 SettingSelect 34px 同高,对齐原版 settings-skill-actions) */
    .settings-skill-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }

    .btn-skill-small {
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #dddddd;
        border-radius: 7px;
        background: #fff;
        color: #3c3c3c;
        font-size: 12px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease;
    }

    .btn-skill-small:hover {
        border-color: #111111;
        color: #111111;
    }

    .btn-skill-small.danger:hover {
        border-color: #e0a0a0;
        color: #c0392b;
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

    .skill-content-textarea {
        width: 100%;
        resize: vertical;
        font-family: inherit;
        line-height: 1.6;
    }

    /* 市场分页 */
    .skill-market-pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid #eeeeee;
    }

    .skill-market-page-info {
        font-size: 12px;
        color: #7a7a7a;
        font-variant-numeric: tabular-nums;
    }
</style>