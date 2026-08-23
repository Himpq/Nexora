<!--
    KnowledgeViewer.vue — 知识库正文视图(宿主层)

    职责:
      - 加载知识正文并交给 GDDP MarkdownEditor 组件渲染/编辑
      - 图片上传(知识库 API:allocate → upload → 占位替换)
      - 在线协作(迁移路线第 3 阶段):metadata 满足 public+collaborative 时
        通过 src/stream/knowledge-collab.ts 建立 ws 连接,渲染成员条 + 远程光标 + 离线遮罩
      - 保存:工具栏「保存」按钮 + Ctrl/Cmd+S(无自动保存,需显式提交);向量化经 expose 供后续接入
    编辑器内核、工具栏、视图模式、全屏、布局修正均由 MarkdownEditor 自包含管理
-->

<template>
    <section ref="viewerEl" class="knowledge-viewer">
        <div v-if="collabEnabled" class="knowledge-collab-strip">
            <span class="knowledge-collab-status" :class="`is-${collabStatus}`">
                {{ collabStatusText || '实时协作已连接' }}
            </span>

            <span
                v-for="member in collabMembers"
                :key="member.client_id"
                class="knowledge-collab-member"
                :class="{ 'is-self': member.client_id === collabSelfId }"
            >
                <span class="knowledge-collab-dot" :style="{ background: getMemberColor(member.client_id) }"></span>
                <span class="knowledge-collab-name">{{ getMemberName(member) }}</span>
                <span v-if="member.cursor" class="knowledge-collab-cursor">
                    L{{ (member.cursor.line ?? 0) + 1 }}:C{{ (member.cursor.col ?? 0) + 1 }}
                </span>
            </span>
        </div>

        <MarkdownEditor
            v-if="ready"
            ref="editorRef"
            :key="props.title"
            :initial-value="content"
            placeholder="开始编写知识库正文…"
            @change="handleEditorChange"
            @image-files="handleImageFiles"
            @save="handleSave"
            @settings="emit('open-settings')"
        />
    </section>
</template>

<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import MarkdownEditor from '@/ui/editor/MarkdownEditor.vue'
    import {
        fetchKnowledgeContent,
        saveKnowledgeContent,
        uploadKnowledgeImage,
        vectorizeKnowledge,
        buildKnowledgeCollabWsUrl,
        readKnowledgeCollabMeta,
        type KnowledgeContent,
    } from '@/api/knowledge'
    import { useUserStore } from '@/stores/user'
    import { showError, showToast } from '@/stores/notify'
    import {
        createClient,
        createOfflineMask,
        createToastCursorOverlay,
        getToastSelectionOffsets,
        setToastCursorOffset,
        type CollabMember,
        type CursorInfo,
        type CursorOverlay,
        type KnowledgeCollabClient,
        type OfflineMask,
        type SetTextMeta,
    } from '@/stream/knowledge-collab'

    const props = defineProps<{
        open: boolean
        title: string
    }>()

    const emit = defineEmits<{
        /** 编辑器工具栏「设置」→ 打开知识库设置弹窗 */
        'open-settings': []
    }>()

    const userStore = useUserStore()

    const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
    const viewerEl = ref<HTMLElement | null>(null)
    const version = ref<Partial<KnowledgeContent>>({})
    const loading = ref(false)
    const ready = ref(false)
    const content = ref('')

    // ---------- 在线协作状态 ----------

    const collabClient = ref<KnowledgeCollabClient | null>(null)
    const collabEnabled = ref(false)
    const collabStatus = ref<'ok' | 'saving' | 'error'>('ok')
    const collabStatusText = ref('')
    const collabMembers = ref<CollabMember[]>([])
    const collabSelfId = ref('')

    let cursorOverlay: CursorOverlay | null = null
    let offlineMask: OfflineMask | null = null
    let viewerCleanupFns: (() => void)[] = []

    watch(
        () => [props.open, props.title] as const,
        ([opened, title]) => {
            stopCollab()
            ready.value = false
            content.value = ''

            if (opened && title) {
                void load(title)
            }
        },
        { immediate: true }
    )

    onBeforeUnmount(() => {
        window.removeEventListener('keydown', handleGlobalKeydown)
        stopCollab()
        viewerCleanupFns.forEach((cleanup) => cleanup())
        viewerCleanupFns = []
    })

    /** 工具栏「保存」按钮:显式提交正文 */
    function handleSave(): void {
        void save()
    }

    /** Ctrl/Cmd+S 保存(仅知识库视图打开且有目标标题时拦截浏览器的"另存为") */
    function handleGlobalKeydown(event: KeyboardEvent): void {
        if (!props.open || !props.title) {
            return
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()

            void save()
        }
    }

    onMounted(() => {
        window.addEventListener('keydown', handleGlobalKeydown)
    })

    /** 加载知识正文(就绪后渲染编辑器,再按 metadata 决定是否启动协作) */
    async function load(title: string): Promise<void> {
        loading.value = true

        try {
            const data = await fetchKnowledgeContent(title)

            version.value = data
            content.value = data.content ?? ''
            ready.value = true
            await nextTick()
            startCollab(data.metadata)
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取知识库失败')
        } finally {
            loading.value = false
        }
    }

    /** 元数据满足 public+collaborative 时启动在线协作 */
    function startCollab(metadata?: Record<string, unknown> | null): void {
        stopCollab()

        const meta = readKnowledgeCollabMeta(metadata)

        if (!props.open || !props.title || !meta.share_id || !meta.public || !meta.collaborative || !editorRef.value) {
            return
        }

        const wsUrl = buildKnowledgeCollabWsUrl(meta, 'owner', userStore.username, userStore.userId)

        if (!wsUrl) {
            return
        }

        collabClient.value = createClient({
            wsUrl,
            getText: () => editorRef.value?.getMarkdown() ?? '',
            setText: handleCollabSetText,
            getCursorOffset: () => getToastSelectionOffsets(editorRef.value?.getEditor() ?? null).head,
            getCursorAnchor: () => getToastSelectionOffsets(editorRef.value?.getEditor() ?? null).anchor,
            setCursorOffset: handleCollabSetCursor,
            renderMembers: (members, selfId) => {
                collabMembers.value = members
                collabSelfId.value = selfId
            },
            renderCursors: (members, selfId) => ensureCursorOverlay()?.render(members, selfId),
            notifyPresence: (member, action) => {
                const name = getMemberName(member)
                showToast(action === 'join' ? `${name} 加入了协作` : `${name} 离开了协作`)
            },
            onConnectionChange: (connected) => {
                const mask = ensureOfflineMask()

                if (connected) {
                    mask.hide()
                } else {
                    mask.show()
                }
            },
            setStatus: (kind, text) => {
                collabStatus.value = kind
                collabStatusText.value = text

                if (kind === 'error' && text) {
                    showError(text)
                }
            },
        })
        collabEnabled.value = true
        collabStatus.value = 'saving'
        collabStatusText.value = '正在连接实时协作…'
        collabClient.value.start()
        bindViewerInputEvents()
    }

    /**
     * 远端写入:统一全量替换。
     * 不可用增量应用——Toast UI 的 dispatchTransaction 钩子中 updateMarkdown(preview)先于
     * applyTransaction(editor)执行,增量坐标一旦错位(代码块/列表/标题破坏"每行一段"假设)
     * 就会让 preview 已同步而 editor 未同步,且异常被吞造成两端永久脱节。
     * 全量替换走 markdown 源文本坐标系,editor 与 preview 由 Toast UI 原子同步。
     * 兜底:setMarkdown 实际仍走 view.dispatch,PM 内部状态一旦受损会抛错(preview 已更新、
     * editor 未更新),这里校验 PM doc 与目标文本是否一致,不一致则重建编辑器强制原子同步。
     */
    function handleCollabSetText(value: string, meta?: SetTextMeta): boolean {
        const editorComp = editorRef.value

        if (!editorComp) {
            return false
        }

        if (meta?.source === 'snapshot' && editorComp.getMarkdown() === value) {
            return true
        }

        try {
            // cursorToEnd=false:全量替换不拉光标,远端光标落位由 setCursorOffset 回调完成
            editorComp.setMarkdown(value, false)

            if (!isEditorTextSynced(editorComp.getEditor(), value)) {
                // setMarkdown 抛出前 preview 已通过 updateMarkdown 更新,而 editor 的 PM doc 未变;
                // 此时 getMarkdown() 已等于 value,协作协议会误判"已同步",必须重建编辑器兜底。
                editorComp.reset(value)
            }
        } catch {
            editorComp.reset(value)
        }

        return false
    }

    /** 校验编辑器 PM doc 与目标文本是否真正一致(trim 兼容行尾差异) */
    function isEditorTextSynced(rawEditor: ReturnType<NonNullable<typeof editorRef.value>['getEditor']> | null, target: string): boolean {
        if (!rawEditor) {
            return false
        }

        // Toast UI 的 @types 未暴露 mdEditor(内部 md 模式 ProseMirror view),需跳过类型检查访问
        const inner = rawEditor as unknown as {
            mdEditor?: {
                view?: {
                    state?: {
                        doc?: {
                            content?: {
                                size: number
                                textBetween: (a: number, b: number, c: string) => string
                            }
                        }
                    }
                }
            }
        }
        const doc = inner.mdEditor?.view?.state?.doc
        const content = doc?.content

        if (!content) {
            return false
        }

        const docText = content.textBetween(0, content.size, '\n')

        return docText.trimEnd() === target.trimEnd()
    }

    /** 远端光标落位(增量应用时 ProseMirror 自动映射,此回调仅在回退全量替换时使用) */
    function handleCollabSetCursor(cursor: CursorInfo): void {
        const rawEditor = editorRef.value?.getEditor()

        if (rawEditor) {
            setToastCursorOffset(rawEditor, cursor.offset)
        }
    }

    /** 本地输入联动:远端应用回写时跳过,避免重复 diff */
    function handleEditorChange(): void {
        const client = collabClient.value

        if (!client || !client.isActive() || client.isApplyingRemote()) {
            return
        }

        client.notifyLocalChange()
    }

    /** 光标 overlay / 离线 mask 的宿主:优先 md 容器,退化为整个查看器 */
    function getEditorHost(): HTMLElement | null {
        return viewerEl.value?.querySelector('.toastui-editor-md-container') ?? viewerEl.value ?? null
    }

    function ensureCursorOverlay(): CursorOverlay | null {
        if (!cursorOverlay) {
            cursorOverlay = createToastCursorOverlay({
                getEditor: () => editorRef.value?.getEditor() ?? null,
                getHost: getEditorHost,
                getColor: getMemberColor,
                getName: getMemberName,
            })
        }

        return cursorOverlay
    }

    function ensureOfflineMask(): OfflineMask {
        if (!offlineMask) {
            offlineMask = createOfflineMask(getEditorHost)
        }

        return offlineMask
    }

    /** 成员名:display_name 优先,owner 回退为当前用户名 */
    function getMemberName(member: CollabMember): string {
        return String(member.display_name || (member.role === 'owner' ? userStore.username : '匿名协作者') || '协作者')
    }

    /** 成员颜色:按 client_id 哈希取调色板(对齐原版) */
    function getMemberColor(clientId: string): string {
        const palette = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#be123c']
        const key = String(clientId || '')
        let hash = 0

        for (let i = 0; i < key.length; i += 1) {
            hash = ((hash * 31) + key.charCodeAt(i)) >>> 0
        }

        return palette[hash % palette.length]
    }

    /** keyup/mouseup/touchend 联动光标上报(对齐原版 viewer 绑定) */
    function bindViewerInputEvents(): void {
        const el = viewerEl.value

        if (!el || el.dataset.knowledgeCollabBound === '1') {
            return
        }

        el.dataset.knowledgeCollabBound = '1'
        const onInput = (): void => {
            const client = collabClient.value

            if (client?.isActive()) {
                client.scheduleCursorSend()
            }
        }
        const inputEvents = ['keyup', 'mouseup', 'touchend'] as const

        inputEvents.forEach((eventName) => {
            el.addEventListener(eventName, onInput, true)
            viewerCleanupFns.push(() => {
                el.removeEventListener(eventName, onInput, true)
            })
        })
    }

    /** 停止协作并清理 overlay / mask / 状态 */
    function stopCollab(): void {
        collabClient.value?.stop()
        collabClient.value = null
        cursorOverlay?.clear()
        cursorOverlay = null
        offlineMask?.hide()
        offlineMask = null
        collabEnabled.value = false
        collabMembers.value = []
        collabSelfId.value = ''
        collabStatus.value = 'ok'
        collabStatusText.value = ''
    }

    /** 上传单张图片:插入占位 markdown,上传成功后替换为真实地址 */
    async function uploadImage(file: File): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        const fileName = file.name || 'image'
        const placeholder = `![${fileName}](uploading)`

        editorRef.value.replaceSelection(`\n${placeholder}\n`)

        try {
            const url = await uploadKnowledgeImage(file, props.title)

            replacePlaceholderInMarkdown(placeholder, `![${fileName}](${url})`)
            showToast(`图片已上传：${fileName}`, 'success')
        } catch (error) {
            replacePlaceholderInMarkdown(placeholder, `![${fileName}](上传失败)`)
            showError(error instanceof Error ? error.message : '图片上传失败')
        }
    }

    /** 用真实 markdown 替换编辑器内的占位文本 */
    function replacePlaceholderInMarkdown(placeholder: string, replacement: string): void {
        if (!editorRef.value) {
            return
        }

        const markdown = editorRef.value.getMarkdown()

        editorRef.value.setMarkdown(markdown.replace(placeholder, replacement))
    }

    /** 编辑器图片事件(按钮选择 / 粘贴 / 拖拽)统一入口 */
    async function handleImageFiles(files: File[]): Promise<void> {
        for (const file of files) {
            await uploadImage(file)
        }
    }

    /** 保存正文 */
    async function save(): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        try {
            version.value = await saveKnowledgeContent(props.title, editorRef.value.getMarkdown(), version.value)
            showToast('知识库已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存知识库失败')
        }
    }

    /** 向量化当前正文 */
    async function vectorize(): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        try {
            await vectorizeKnowledge(props.title, editorRef.value.getMarkdown())
            showToast('知识库向量化完成', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '知识库向量化失败')
        }
    }

    defineExpose({ save, vectorize, loading })
</script>

<style scoped>
    .knowledge-viewer {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: var(--color-bg-elevated);
    }

    /* ---------- 在线协作成员条 ---------- */

    .knowledge-collab-strip {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        flex-shrink: 0;
        min-height: 28px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    /* 手机端空间窄:改为单行横向滚动,避免状态与成员被强制换行挤乱 */
    @media (max-width: 760px) {
        .knowledge-collab-strip {
            flex-wrap: nowrap;
            gap: 6px;
            padding: 6px 8px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }

        .knowledge-collab-status {
            flex: 0 0 auto;
            white-space: nowrap;
        }

        .knowledge-collab-member {
            flex: 0 0 auto;
        }
    }

    .knowledge-collab-status {
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
    }

    .knowledge-collab-status.is-ok {
        background: #ecfdf5;
        color: #047857;
    }

    .knowledge-collab-status.is-saving {
        background: #fffbeb;
        color: #b45309;
    }

    .knowledge-collab-status.is-error {
        background: var(--color-danger-surface);
        color: #be123c;
    }

    .knowledge-collab-member {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 220px;
        padding: 5px 8px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        line-height: 1;
        white-space: nowrap;
    }

    .knowledge-collab-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        flex: 0 0 auto;
    }

    .knowledge-collab-name {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .knowledge-collab-cursor {
        color: var(--color-text-secondary);
        font-variant-numeric: tabular-nums;
    }

    .knowledge-collab-member.is-self {
        border-color: var(--color-accent-border);
        background: var(--color-accent-surface);
        color: var(--color-accent-text);
    }
</style>