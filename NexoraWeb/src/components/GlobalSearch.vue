<!--
    GlobalSearch.vue — 全局搜索命令面板(对齐原版 global_search.js,快捷键 Ctrl+K / Cmd+K)

    功能:
      - 跨会话搜索:标题命中 + 消息全文命中(后端 /api/search/global)
      - 消息命中点击后跳转会话并定位到消息(窗口外加载由 conversation store 保证)
      - 空输入时展示快速动作列表
    键盘捕获阶段处理,面板打开时无论焦点在哪 Esc/↑↓/Enter 均有效。
    跳转动作经事件上抛,由 ChatView 统一导航(避免组件直接耦合视图状态)。
-->

<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="gsp-overlay"
            @mousedown="handleOverlayMousedown"
        >
            <div class="gsp-panel" role="dialog" aria-modal="true" aria-label="全局搜索">
                <div class="gsp-input-row">
                    <span class="gsp-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="M21 21l-4.35-4.35"></path>
                        </svg>
                    </span>

                    <input
                        ref="inputRef"
                        v-model="keyword"
                        class="gsp-input"
                        type="text"
                        placeholder="搜索对话与消息…"
                        aria-label="全局搜索"
                        @input="scheduleSearch"
                        @keydown="handlePanelKeydown"
                    >

                    <kbd class="gsp-kbd">Esc</kbd>
                </div>

                <div ref="resultsRef" class="gsp-results">
                    <div v-if="status" class="gsp-status">{{ status }}</div>

                    <div v-else>
                        <div v-for="group in groups" :key="group.title" class="gsp-group">
                            <div class="gsp-group-title">{{ group.title }}</div>

                            <div
                                v-for="(item, index) in group.items"
                                :key="item.key"
                                class="gsp-item"
                                :class="{ 'is-active': index + group.start === activeIndex }"
                                @mouseenter="activeIndex = index + group.start"
                                @click="runItem(index + group.start)"
                            >
                                <span class="gsp-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path v-for="path in item.iconPaths" :key="path" :d="path"></path>
                                    </svg>
                                </span>

                                <span class="gsp-item-text">
                                    <span class="gsp-item-title">
                                        <!-- 关键词高亮片段,全部经文本节点渲染,杜绝 innerHTML 注入 -->
                                        <template v-for="(part, partIndex) in highlightParts(item.title)" :key="partIndex">
                                            <mark v-if="part.hit" class="gsp-mark">{{ part.text }}</mark>
                                            <template v-else>{{ part.text }}</template>
                                        </template>
                                    </span>

                                    <span v-if="item.meta" class="gsp-item-meta">{{ item.meta }}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="gsp-footer">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type {
        SearchFileHit,
        SearchKnowledgeHit,
        SearchMessageHit,
        SearchTitleHit,
    } from '@/api/search'
    import { globalSearch } from '@/api/search'

    interface PaletteItem {
        key: string
        title: string
        meta?: string
        iconPaths: string[]
        run: () => void
    }

    interface PaletteGroup {
        title: string
        start: number
        items: PaletteItem[]
    }

    /** 图标路径(与 line 风格一致,对齐原版 svgIcon 的 path 集合) */
    const ICON_PATHS: Record<string, string[]> = {
        chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
        message: ['M4 4h16v12H8l-4 4z', 'M8 9h8', 'M8 12h5'],
        book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
        file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
        plus: ['M12 5v14', 'M5 12h14'],
    }

    /** 快捷动作:空输入时展示 */
    const quickActions: PaletteItem[] = [{
        key: 'quick-new-conversation',
        title: '新建对话',
        meta: '开启一个空白会话',
        iconPaths: ICON_PATHS.plus,
        run: () => emit('new-conversation'),
    }]

    const emit = defineEmits<{
        'open-conversation': [conversationId: string]
        'jump-to-message': [hit: SearchMessageHit]
        'open-knowledge': [title: string]
        'open-file': [hit: SearchFileHit]
        'new-conversation': []
    }>()

    const open = ref(false)
    const keyword = ref('')
    const status = ref('')
    const activeIndex = ref(-1)
    const inputRef = ref<HTMLInputElement | null>(null)
    const resultsRef = ref<HTMLDivElement | null>(null)

    let searchTimer: number | null = null
    let searchSeq = 0
    let items: PaletteItem[] = []

    /** 当前关键字是否为空(决定展示快速动作) */
    const isEmptyInput = computed(() => !String(keyword.value).trim())

    /** 渲染结果前的原始命中数据(每次搜索写入,供 groups 消费) */
    const titleHits = ref<SearchTitleHit[]>([])
    const messageHits = ref<SearchMessageHit[]>([])
    const knowledgeHits = ref<SearchKnowledgeHit[]>([])
    const fileHits = ref<SearchFileHit[]>([])

    /** 分组渲染:依赖 items 顺序与 activeIndex 对应 */
    const groups = computed<PaletteGroup[]>(() => {
        const result: PaletteGroup[] = []
        let offset = 0

        for (const group of buildGroups()) {
            result.push({
                title: group.title,
                start: offset,
                items: group.items,
            })

            offset += group.items.length
        }

        return result
    })

    /** 构建分组(空输入显示快速动作;否则按命中显示四类) */
    function buildGroups(): { title: string; items: PaletteItem[] }[] {
        const result: { title: string; items: PaletteItem[] }[] = []
        const titleItems: PaletteItem[] = []
        const messageItems: PaletteItem[] = []
        const knowledgeItems: PaletteItem[] = []
        const fileItems: PaletteItem[] = []

        if (isEmptyInput.value) {
            for (const action of quickActions) {
                titleItems.push({ ...action, run: action.run })
            }
        }

        for (const hit of titleHits.value) {
            titleItems.push({
                key: `title-${hit.conversation_id}`,
                title: hit.title,
                meta: hit.preview,
                iconPaths: ICON_PATHS.chat,
                run: () => emit('open-conversation', hit.conversation_id),
            })
        }

        for (const hit of messageHits.value) {
            messageItems.push({
                key: `message-${hit.conversation_id}-${hit.message_index}`,
                title: hit.snippet,
                meta: `${hit.role === 'user' ? '我' : '助手'} · ${hit.title}`,
                iconPaths: ICON_PATHS.message,
                run: () => emit('jump-to-message', hit),
            })
        }

        for (const hit of knowledgeHits.value) {
            knowledgeItems.push({
                key: `knowledge-${hit.title}`,
                title: hit.title,
                meta: hit.snippet,
                iconPaths: ICON_PATHS.book,
                run: () => emit('open-knowledge', hit.title),
            })
        }

        for (const hit of fileHits.value) {
            fileItems.push({
                key: `file-${hit.alias}`,
                title: hit.name,
                meta: hit.alias === hit.name ? '云盘文件' : hit.alias,
                iconPaths: ICON_PATHS.file,
                run: () => emit('open-file', hit),
            })
        }

        if (isEmptyInput.value) {
            if (titleItems.length) {
                result.push({ title: '快速动作', items: titleItems })
            }
        } else {
            if (titleItems.length) {
                result.push({ title: '对话', items: titleItems })
            }

            if (messageItems.length) {
                result.push({ title: '消息', items: messageItems })
            }

            if (knowledgeItems.length) {
                result.push({ title: '知识库', items: knowledgeItems })
            }

            if (fileItems.length) {
                result.push({ title: '云盘文件', items: fileItems })
            }
        }

        return result
    }

    // 面板每次打开时同步刷新(保持最新结果,对齐原版 open → renderForKeyword)
    watch(open, (opened) => {
        if (opened) {
            void nextTick(() => renderForKeyword(String(keyword.value).trim()))
        }
    })

    /** 打开面板:聚焦输入框并全选 */
    function openPalette(): void {
        open.value = true

        void nextTick(() => {
            inputRef.value?.focus()
            inputRef.value?.select()
        })
    }

    /** 关闭面板 */
    function closePalette(): void {
        if (!open.value) {
            return
        }

        open.value = false
        status.value = ''
        activeIndex.value = -1
        items = []
        titleHits.value = []
        messageHits.value = []
        knowledgeHits.value = []
        fileHits.value = []
    }

    /** 开关面板 */
    function toggle(): void {
        if (open.value) {
            closePalette()
        } else {
            openPalette()
        }
    }

    /** 点击遮罩(面板外)关闭 */
    function handleOverlayMousedown(event: MouseEvent): void {
        if ((event.target as HTMLElement).classList.contains('gsp-overlay')) {
            closePalette()
        }
    }

    /** 输入防抖搜索(对齐原版 scheduleSearch:250ms) */
    function scheduleSearch(): void {
        if (searchTimer) {
            window.clearTimeout(searchTimer)
        }

        const value = String(keyword.value).trim()

        searchTimer = window.setTimeout(() => renderForKeyword(value), 250)
    }

    /** 渲染:空输入 → 快速动作;否则发起搜索 */
    function renderForKeyword(value: string): void {
        if (!value) {
            renderQuickActions()

            return
        }

        void runSearch(value)
    }

    /** 展示快速动作 */
    function renderQuickActions(): void {
        status.value = ''
        titleHits.value = []
        messageHits.value = []
        knowledgeHits.value = []
        fileHits.value = []

        items = quickActions.map((action) => ({ ...action }))

        activeIndex.value = items.length ? 0 : -1
    }

    /** 发起搜索(序号防过期响应覆盖) */
    async function runSearch(value: string): Promise<void> {
        const seq = ++searchSeq
        const keywordSnapshot = value

        status.value = '搜索中…'

        let payload: Awaited<ReturnType<typeof globalSearch>> | null = null

        try {
            payload = await globalSearch(keywordSnapshot)
        } catch {
            payload = null
        }

        // 丢弃过期请求的响应,避免旧结果覆盖新输入
        if (seq !== searchSeq || !open.value) {
            return
        }

        if (!payload || !payload.success) {
            status.value = '搜索失败,请稍后重试'

            return
        }

        renderResults(payload)
    }

    /** 渲染搜索结果:写入分组数据并重建 items 索引 */
    function renderResults(payload: Awaited<ReturnType<typeof globalSearch>>): void {
        titleHits.value = payload.titles
        messageHits.value = payload.messages
        knowledgeHits.value = payload.knowledge
        fileHits.value = payload.files

        const allEmpty = !titleHits.value.length
            && !messageHits.value.length
            && !knowledgeHits.value.length
            && !fileHits.value.length

        if (allEmpty) {
            status.value = '没有找到相关内容'
            titleHits.value = []
            messageHits.value = []
            knowledgeHits.value = []
            fileHits.value = []

            return
        }

        status.value = ''

        // 按最终渲染顺序重建 items(activeIndex 定位依据)
        const rebuilt: PaletteItem[] = []

        for (const group of buildGroups()) {
            for (const item of group.items) {
                rebuilt.push(item)
            }
        }

        items = rebuilt

        activeIndex.value = items.length ? 0 : -1
    }

    /** 关键词高亮切分:返回文本片段序列(hit 标记命中段) */
    function highlightParts(text: string): { text: string; hit: boolean }[] {
        const source = String(text || '')
        const needle = String(keyword.value || '').trim()

        if (!needle) {
            return [{ text: source, hit: false }]
        }

        const sourceLower = source.toLowerCase()
        const needleLower = needle.toLowerCase()
        const parts: { text: string; hit: boolean }[] = []
        let rest = source
        let restLower = sourceLower

        while (rest) {
            const hitPos = restLower.indexOf(needleLower)

            if (hitPos < 0) {
                if (rest) {
                    parts.push({ text: rest, hit: false })
                }

                break
            }

            if (hitPos > 0) {
                parts.push({ text: rest.slice(0, hitPos), hit: false })
            }

            parts.push({
                text: rest.slice(hitPos, hitPos + needle.length),
                hit: true,
            })

            rest = rest.slice(hitPos + needle.length)
            restLower = rest.toLowerCase()
        }

        return parts
    }

    /** 面板打开时输入框内按键:阻止默认并交给统一键盘处理(避免与全局捕获重复) */
    function handlePanelKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()

            moveActive(1)

            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()

            moveActive(-1)

            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()

            void runActive()

            return
        }
    }

    /** 文档捕获阶段统一键盘处理(对齐原版 handleGlobalKeydown) */
    function handleGlobalKeydown(event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'k') {
            event.preventDefault()
            event.stopPropagation()

            toggle()

            return
        }

        if (!open.value) {
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()

            closePalette()

            return
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()

            moveActive(1)

            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()

            moveActive(-1)

            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()

            void runActive()
        }
    }

    /** 移动选中项(循环) */
    function moveActive(delta: number): void {
        if (!items.length) {
            return
        }

        activeIndex.value = (activeIndex.value + delta + items.length) % items.length

        scrollActiveIntoView()
    }

    /** 执行当前选中项 */
    async function runItem(index: number): Promise<void> {
        const item = items[index]

        if (!item) {
            return
        }

        closePalette()

        try {
            await item.run()
        } catch {
            // 跳转失败提示由 ChatView 统一处理;此处静默兜底由上层保证
        }
    }

    async function runActive(): Promise<void> {
        await runItem(activeIndex.value)
    }

    /** 选中项滚动到可视区(对齐原版 block:'nearest') */
    function scrollActiveIntoView(): void {
        void nextTick(() => {
            const activeEl = resultsRef.value?.querySelector<HTMLElement>('.gsp-item.is-active')

            activeEl?.scrollIntoView({ block: 'nearest' })
        })
    }

    onMounted(() => {
        document.addEventListener('keydown', handleGlobalKeydown, true)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('keydown', handleGlobalKeydown, true)
    })
</script>

<style scoped>
    .gsp-overlay {
        position: fixed;
        inset: 0;
        z-index: 10050;
        background: rgba(15, 15, 15, 0.42);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 16vh;
    }

    .gsp-panel {
        width: min(640px, 92vw);
        max-height: 62vh;
        display: flex;
        flex-direction: column;
        background: var(--color-bg-elevated);
        border-radius: 12px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
        overflow: hidden;
    }

    .gsp-input-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }

    .gsp-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 15px;
        background: transparent;
        color: var(--color-text-primary);
    }

    .gsp-kbd {
        font-size: 11px;
        color: var(--color-text-secondary);
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 4px;
        padding: 1px 6px;
        background: #f7f7f7;
    }

    .gsp-results {
        flex: 1;
        overflow-y: auto;
        padding: 6px 0;
    }

    .gsp-status {
        padding: 26px 16px;
        text-align: center;
        color: var(--color-text-secondary);
        font-size: 13px;
    }

    .gsp-group-title {
        padding: 8px 16px 4px;
        font-size: 11px;
        color: var(--color-text-secondary);
        letter-spacing: 0.4px;
    }

    .gsp-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 9px 16px;
        cursor: pointer;
    }

    .gsp-item.is-active {
        background: var(--color-bg-hover);
    }

    .gsp-icon {
        flex: none;
        width: 18px;
        height: 18px;
        margin-top: 2px;
        color: var(--color-text-secondary);
    }

    .gsp-icon svg {
        width: 18px;
        height: 18px;
        display: block;
    }

    .gsp-item-text {
        flex: 1;
        min-width: 0;
    }

    .gsp-item-title {
        font-size: 14px;
        color: var(--color-text-primary);
        line-height: 1.45;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .gsp-item-meta {
        margin-top: 2px;
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .gsp-mark {
        background: rgba(255, 205, 66, 0.55);
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
    }

    .gsp-footer {
        padding: 8px 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    @media (max-width: 640px) {
        .gsp-overlay {
            padding-top: 8vh;
        }

        .gsp-panel {
            max-height: 74vh;
        }
    }
</style>
