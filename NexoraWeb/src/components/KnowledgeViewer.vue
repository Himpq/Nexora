<!--
    KnowledgeViewer.vue — 知识库正文视图(GDDP 内嵌视图,对齐原版 Toast UI Markdown 编辑器)

    职责:
      - 自定义编辑器工具栏:标题/粗体/斜体/删除线/引用/列表/链接/图片/表格 + 预览/分屏/全屏
      - viewMode 状态机:preview(默认,渲染正文)↔ edit 由「预览」按钮切换;split ↔ edit 由「分屏」按钮切换
      - 图片上传:按钮选择 + 粘贴/拖拽,allocate 分配 → upload 上传 → markdown 占位替换
      - 布局契约:视图模式 class 挂在编辑器宿主上,配合 :deep 修正 Toast UI v3.2.2 垂直布局
      - 保存与向量化由顶栏按钮经 ref 调用
-->

<template>
    <section class="knowledge-viewer" :class="{ 'knowledge-toast-fullscreen': fullscreen }">
        <div class="knowledge-editor-toolbar">
            <div ref="headingMenuRef" class="heading-control">
                <button type="button" class="toolbar-btn" title="标题" @click="toggleHeadingMenu">
                    <i class="fa fa-header" aria-hidden="true"></i>
                </button>
                <div v-show="headingMenuOpen" class="heading-menu">
                    <button v-for="level in headingLevels" :key="level" type="button" class="heading-option" @click="applyHeading(level)">
                        {{ '#'.repeat(level) }}
                    </button>
                </div>
            </div>

            <button type="button" class="toolbar-btn" title="粗体" :disabled="formatDisabled" @click="applyCommand('bold')">
                <i class="fa fa-bold" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="斜体" :disabled="formatDisabled" @click="applyCommand('italic')">
                <i class="fa fa-italic" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="删除线" :disabled="formatDisabled" @click="applyCommand('strike')">
                <i class="fa fa-strikethrough" aria-hidden="true"></i>
            </button>

            <span class="toolbar-separator" aria-hidden="true"></span>

            <button type="button" class="toolbar-btn" title="引用" :disabled="formatDisabled" @click="applyCommand('quote')">
                <i class="fa fa-quote-left" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="无序列表" :disabled="formatDisabled" @click="applyCommand('ul')">
                <i class="fa fa-list-ul" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="有序列表" :disabled="formatDisabled" @click="applyCommand('ol')">
                <i class="fa fa-list-ol" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="链接" :disabled="formatDisabled" @click="applyCommand('link')">
                <i class="fa fa-link" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="图片" :disabled="formatDisabled" @click="triggerImagePicker">
                <i class="fa-solid fa-image" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" title="表格" :disabled="formatDisabled" @click="applyCommand('table')">
                <i class="fa fa-table" aria-hidden="true"></i>
            </button>

            <span class="toolbar-separator" aria-hidden="true"></span>

            <button type="button" class="toolbar-btn" :class="{ active: viewMode === 'preview' }" title="预览" @click="togglePreview">
                <i class="fa fa-eye" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" :class="{ active: viewMode === 'split' }" title="分屏" @click="toggleSplit">
                <i class="fa fa-columns" aria-hidden="true"></i>
            </button>
            <button type="button" class="toolbar-btn" :class="{ active: fullscreen }" title="全屏" @click="toggleFullscreen">
                <i class="fa fa-arrows-alt" aria-hidden="true"></i>
            </button>
        </div>

        <div ref="editorHost" id="knowledgeEditor" class="knowledge-toast-editor" :class="modeClasses"></div>

        <input ref="imageInputRef" type="file" accept="image/*" multiple hidden @change="handleImageFiles">
    </section>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

    import {
        fetchKnowledgeContent,
        saveKnowledgeContent,
        uploadKnowledgeImage,
        vectorizeKnowledge,
        type KnowledgeContent,
    } from '@/api/knowledge'
    import { showError, showToast } from '@/stores/notify'

    const props = defineProps<{
        open: boolean
        title: string
    }>()

    const editorHost = ref<HTMLElement | null>(null)
    const imageInputRef = ref<HTMLInputElement | null>(null)
    const headingMenuRef = ref<HTMLElement | null>(null)

    const editor = ref<ToastUiEditorInstance | null>(null)
    const version = ref<Partial<KnowledgeContent>>({})
    const loading = ref(false)

    /** 视图模式:preview(渲染正文) / edit(纯编辑) / split(分屏);preview ↔ edit 与 split ↔ edit 由按钮切换 */
    const viewMode = ref<'preview' | 'edit' | 'split'>('preview')
    const fullscreen = ref(false)
    const headingMenuOpen = ref(false)

    const headingLevels = [1, 2, 3, 4]

    /** 预览模式下禁用格式命令(对齐原版 disabled 行为) */
    const formatDisabled = computed(() => viewMode.value === 'preview')

    /** 视图模式 class 必须挂在编辑器宿主上,:deep 规则才与 Toast UI DOM 匹配 */
    const modeClasses = computed(() => ({
        'knowledge-toast-mode-edit': viewMode.value === 'edit',
        'knowledge-toast-mode-preview': viewMode.value === 'preview',
        'knowledge-toast-mode-split': viewMode.value === 'split',
    }))

    /** 卸载时清理编辑器与全局监听 */
    let pasteCleanupFns: (() => void)[] = []

    watch(
        () => [props.open, props.title] as const,
        ([opened, title]) => {
            if (opened && title) {
                void load(title)
            }
        },
        { immediate: true }
    )

    onBeforeUnmount(() => {
        editor.value?.destroy()
        editor.value = null
        document.removeEventListener('click', handleDocumentClick)
        clearImageUploadBridge()
    })

    /** 加载知识正文并挂载编辑器 */
    async function load(title: string): Promise<void> {
        loading.value = true

        try {
            const data = await fetchKnowledgeContent(title)

            version.value = data
            await mountEditor(data.content)
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取知识库失败')
        } finally {
            loading.value = false
        }
    }

    /** 创建 Toast UI 编辑器(隐藏原生工具栏)并绑定图片粘贴/拖拽上传 */
    async function mountEditor(content: string): Promise<void> {
        await nextTick()

        if (!editorHost.value) {
            return
        }

        editor.value?.destroy()
        editor.value = null

        editor.value = new window.toastui.Editor({
            el: editorHost.value,
            initialValue: content,
            initialEditType: 'markdown',
            previewStyle: 'vertical',
            height: '100%',
            usageStatistics: false,
            hideModeSwitch: true,
            toolbarItems: [],
        })

        bindImageUploadBridge()

        // 强制 Toast UI 重新计算布局与预览渲染(容器曾被 display:none 挂载时预览会空白)
        window.setTimeout(() => {
            window.dispatchEvent(new Event('resize'))
        }, 0)

        document.removeEventListener('click', handleDocumentClick)
        document.addEventListener('click', handleDocumentClick)
    }

    /** 点击工具栏外关闭标题下拉菜单 */
    function handleDocumentClick(event: MouseEvent): void {
        if (headingMenuRef.value && !headingMenuRef.value.contains(event.target as Node)) {
            headingMenuOpen.value = false
        }
    }

    /** 切换标题下拉菜单 */
    function toggleHeadingMenu(): void {
        headingMenuOpen.value = !headingMenuOpen.value
    }

    /** 应用标题级别 */
    function applyHeading(level: number): void {
        if (!editor.value || formatDisabled.value) {
            return
        }

        if (!runToastCommand('heading', { level })) {
            insertMarkdownFallback(`\n${'#'.repeat(level)} 标题`)
        }

        headingMenuOpen.value = false
    }

    /** 命令别名表(Toast UI markdown 命令) */
    const commandAliases: Record<string, string[]> = {
        heading: ['heading'],
        bold: ['bold'],
        italic: ['italic'],
        strike: ['strike'],
        quote: ['blockQuote', 'quote'],
        ul: ['bulletList', 'unorderedList', 'ul'],
        ol: ['orderedList', 'ol'],
        link: ['addLink', 'link'],
        image: ['addImage', 'image'],
        table: ['addTable', 'table'],
    }

    /** 尝试执行 Toast UI 命令;所有别名都失败时返回 false */
    function runToastCommand(name: string, payload?: Record<string, unknown>): boolean {
        const aliases = commandAliases[name] || [name]

        for (const alias of aliases) {
            try {
                const result = editor.value
                    ? (payload === undefined ? editor.value.exec(alias) : editor.value.exec(alias, payload))
                    : false

                if (result !== false) {
                    return true
                }
            } catch {
                // 尝试下一个命令别名
            }
        }

        return false
    }

    /** 命令失败时的 markdown 回退插入 */
    function insertMarkdownFallback(markdown: string): void {
        if (!editor.value) {
            return
        }

        if (typeof editor.value.replaceSelection === 'function') {
            editor.value.replaceSelection(markdown)

            return
        }

        editor.value.insertText(markdown)
    }

    /** 工具栏格式命令分发 */
    function applyCommand(cmd: string): void {
        if (!editor.value || formatDisabled.value) {
            return
        }

        if (cmd === 'link') {
            if (!runToastCommand('link')) {
                const selected = editor.value.getSelectedText() || '链接文本'

                insertMarkdownFallback(`[${selected}](https://)`)
            }

            showToast('已插入链接模板', 'info')

            return
        }

        if (cmd === 'table') {
            if (!runToastCommand('table')) {
                insertMarkdownFallback('\n| 列1 | 列2 |\n| --- | --- |\n|  |  |')
            }

            showToast('已插入表格模板', 'info')

            return
        }

        if (!runToastCommand(cmd)) {
            if (cmd === 'quote') {
                insertMarkdownFallback('\n> ')
            }

            if (cmd === 'ul') {
                insertMarkdownFallback('\n- ')
            }

            if (cmd === 'ol') {
                insertMarkdownFallback('\n1. ')
            }
        }
    }

    /** 「预览」按钮:preview ↔ edit 切换(对齐原版,非直接设置) */
    function togglePreview(): void {
        setViewMode(viewMode.value === 'preview' ? 'edit' : 'preview')
    }

    /** 「分屏」按钮:split ↔ edit 切换(对齐原版) */
    function toggleSplit(): void {
        setViewMode(viewMode.value === 'split' ? 'edit' : 'split')
    }

    /** 设置视图模式并关闭标题菜单 */
    function setViewMode(mode: 'preview' | 'edit' | 'split'): void {
        viewMode.value = mode
        headingMenuOpen.value = false
    }

    /** 切换全屏 */
    function toggleFullscreen(): void {
        fullscreen.value = !fullscreen.value
    }

    /** 打开图片选择器 */
    function triggerImagePicker(): void {
        imageInputRef.value?.click()
    }

    /** 选择图片文件后逐个上传 */
    async function handleImageFiles(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const files = input.files ? Array.from(input.files).filter((f) => f.type.startsWith('image/')) : []

        input.value = ''

        if (!files.length) {
            return
        }

        for (const file of files) {
            await uploadImage(file)
        }
    }

    /** 从粘贴/拖拽事件中提取图片文件(对齐原版 extractFilesFromClipboardEvent) */
    function extractImageFilesFromEvent(event: ClipboardEvent | DragEvent): File[] {
        const dt = 'dataTransfer' in event ? event.dataTransfer : null
        const items = dt?.items ? Array.from(dt.items) : []
        const files = dt?.files ? Array.from(dt.files) : []
        const collected: File[] = []

        if (items.length) {
            items.forEach((item) => {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile()

                    if (file) {
                        collected.push(file)
                    }
                }
            })
        }

        files.forEach((file) => {
            if (file.type.startsWith('image/') && !collected.some((f) => f === file)) {
                collected.push(file)
            }
        })

        return collected
    }

    /** 绑定编辑器与宿主的图片粘贴/拖拽上传(捕获阶段拦截,避免 ProseMirror 吞掉图片) */
    function bindImageUploadBridge(): void {
        clearImageUploadBridge()

        const targets = [editorHost.value].filter(Boolean) as HTMLElement[]

        targets.forEach((target) => {
            const onPaste = (evt: ClipboardEvent) => {
                const files = extractImageFilesFromEvent(evt)

                if (!files.length) {
                    return
                }

                evt.preventDefault()
                evt.stopPropagation()

                for (const file of files) {
                    void uploadImage(file)
                }
            }
            const onDrop = (evt: DragEvent) => {
                const files = extractImageFilesFromEvent(evt)

                if (!files.length) {
                    return
                }

                evt.preventDefault()
                evt.stopPropagation()

                for (const file of files) {
                    void uploadImage(file)
                }
            }

            target.addEventListener('paste', onPaste, true)
            target.addEventListener('drop', onDrop, true)
            pasteCleanupFns.push(() => {
                target.removeEventListener('paste', onPaste, true)
                target.removeEventListener('drop', onDrop, true)
            })
        })
    }

    /** 清理图片粘贴/拖拽监听 */
    function clearImageUploadBridge(): void {
        pasteCleanupFns.forEach((cleanup) => cleanup())
        pasteCleanupFns = []
    }

    /** 上传单张图片:插入占位 markdown,上传成功后替换为真实地址 */
    async function uploadImage(file: File): Promise<void> {
        if (!editor.value || !props.title) {
            return
        }

        const fileName = file.name || 'image'
        const placeholder = `![${fileName}](uploading)`

        editor.value.replaceSelection(`\n${placeholder}\n`)

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
        if (!editor.value) {
            return
        }

        const markdown = editor.value.getMarkdown()

        editor.value.setMarkdown(markdown.replace(placeholder, replacement))
    }

    /** 保存正文 */
    async function save(): Promise<void> {
        if (!editor.value || !props.title) {
            return
        }

        try {
            version.value = await saveKnowledgeContent(props.title, editor.value.getMarkdown(), version.value)
            showToast('知识库已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存知识库失败')
        }
    }

    /** 向量化当前正文 */
    async function vectorize(): Promise<void> {
        if (!editor.value || !props.title) {
            return
        }

        try {
            await vectorizeKnowledge(props.title, editor.value.getMarkdown())
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
        background: #fff;
    }

    /* 全屏:脱离视图布局覆盖整个视口(设计令牌 --z-viewer) */
    .knowledge-viewer.knowledge-toast-fullscreen {
        position: fixed;
        inset: 0;
        z-index: var(--z-viewer);
        height: auto;
    }

    /* ---------- 工具栏(GDDP 单色视觉) ---------- */

    .knowledge-editor-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        padding: 6px 10px;
        border-bottom: 1px solid #e5e7eb;
        background: #fff;
    }

    .knowledge-editor-toolbar .heading-control {
        position: relative;
        display: inline-flex;
        align-items: center;
    }

    .knowledge-editor-toolbar .toolbar-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--gddp-border-radius);
        background: transparent;
        color: #3f3f46;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .knowledge-editor-toolbar .toolbar-btn:hover {
        background: #f4f4f5;
        color: #18181b;
    }

    .knowledge-editor-toolbar .toolbar-btn.active {
        background: #ececee;
        color: #18181b;
        box-shadow: inset 0 0 0 1px #d4d4d8;
    }

    .knowledge-editor-toolbar .toolbar-btn:disabled {
        opacity: 0.42;
        pointer-events: none;
    }

    .knowledge-editor-toolbar .toolbar-btn i {
        font-size: 14px;
    }

    .knowledge-editor-toolbar .toolbar-separator {
        display: inline-block;
        width: 1px;
        height: 18px;
        margin: 0 6px;
        background: #d4d4d8;
    }

    .knowledge-editor-toolbar .heading-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: var(--z-dropdown);
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 44px;
        padding: 4px;
        border: 1px solid #d0d7de;
        border-radius: 6px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
    }

    .knowledge-editor-toolbar .heading-option {
        min-width: 36px;
        padding: 0 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
    }

    /* ---------- 编辑器宿主与 Toast UI 布局修正 ---------- */

    .knowledge-toast-editor {
        flex: 1;
        min-height: 0;
        position: relative;
    }

    /* 隐藏 Toast UI 原生工具栏,改用自定义工具栏 */
    .knowledge-toast-editor :deep(.toastui-editor-toolbar) {
        display: none !important;
    }

    /* 高度链:defaultUI → main → main-container → md-container → vertical-style */
    .knowledge-toast-editor :deep(.toastui-editor-defaultUI) {
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 0;
    }

    .knowledge-toast-editor :deep(.toastui-editor-main) {
        flex: 1 1 auto;
        min-height: 0;
    }

    .knowledge-toast-editor :deep(.toastui-editor-main-container) {
        height: 100%;
        min-height: 0;
    }

    .knowledge-toast-editor :deep(.toastui-editor-md-container) {
        display: block;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }

    /* 垂直布局:编辑区 + 预览区 flex 各占 50% */
    .knowledge-toast-editor :deep(.toastui-editor-md-vertical-style) {
        display: flex;
        align-items: stretch;
        height: 100% !important;
        min-height: 0 !important;
    }

    .knowledge-toast-editor :deep(.toastui-editor-md-container .toastui-editor) {
        display: flex;
        flex-direction: column;
        flex: 1 1 50%;
        min-width: 0;
        height: 100% !important;
        min-height: 0 !important;
    }

    /* ProseMirror 撑满编辑区(修复其 height 非 100% 导致编辑区塌陷) */
    .knowledge-toast-editor :deep(.toastui-editor-md-container .ProseMirror) {
        flex: 1 1 auto;
        height: 100% !important;
        min-height: 100% !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }

    .knowledge-toast-editor :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        flex: 1 1 50%;
        min-width: 0;
        height: 100%;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }

    /* 分屏分隔条:位于 main-container 内、md-container 的兄弟节点,默认隐藏 */
    .knowledge-toast-editor :deep(.toastui-editor-main .toastui-editor-md-splitter) {
        display: none;
    }

    .knowledge-toast-editor.knowledge-toast-mode-split :deep(.toastui-editor-main .toastui-editor-md-splitter) {
        display: block;
    }

    /* 编辑模式:隐藏预览,编辑区占满 */
    .knowledge-toast-editor.knowledge-toast-mode-edit :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        display: none !important;
    }

    .knowledge-toast-editor.knowledge-toast-mode-edit :deep(.toastui-editor-md-container .toastui-editor) {
        flex: 1 1 100%;
    }

    /* 预览模式:隐藏编辑区,预览区占满 */
    .knowledge-toast-editor.knowledge-toast-mode-preview :deep(.toastui-editor-md-container .toastui-editor) {
        display: none !important;
    }

    .knowledge-toast-editor.knowledge-toast-mode-preview :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        flex: 1 1 100%;
    }
</style>