<!--
    MarkdownEditor.vue — GDDP 独立 Markdown 编辑器组件(内核 @toast-ui/editor v3,ProseMirror)

    职责(自包含,便于跨页复用与维护):
      - 编辑器生命周期:创建/销毁、隐藏原生工具栏、高度链布局修正(:deep 覆盖 v3.2.2 DOM)
      - 视图模式状态机:preview(渲染正文,默认)↔ edit 由「预览」按钮切换;split ↔ edit 由「分屏」按钮切换
      - 全屏:内部状态 + 设计令牌 --z-viewer
      - 内置 GDDP 单色工具栏:标题/粗体/斜体/删除线/引用/列表/链接/图片/表格 + 预览/分屏/全屏
      - 图片粘贴/拖拽捕获:提取 File[] 通过 imageFiles 事件交给宿主上传,编辑器保持通用

    对外:
      - props: initialValue / placeholder / toolbar / imageUploadEnabled
      - emits: change(markdown) / imageFiles(files)
      - expose: getMarkdown / setMarkdown / getEditor / getMode / setMode / togglePreview / toggleSplit /
                getSelectedText / replaceSelection / insertText / exec / runCommand / destroy / reset
-->

<template>
    <div class="gddp-markdown-editor" :class="{ 'gddp-markdown-fullscreen': fullscreen }">
        <div v-if="toolbar" class="gddp-markdown-toolbar">
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

            <span class="toolbar-separator" aria-hidden="true"></span>
            <button type="button" class="toolbar-btn gddp-markdown-settings-btn" title="设置" @click="emit('settings')">
                <i class="fa-solid fa-gear" aria-hidden="true"></i>
            </button>
        </div>

        <div ref="editorHost" class="gddp-markdown-host" :class="modeClasses"></div>

        <input v-if="imageUploadEnabled" ref="imageInputRef" type="file" accept="image/*" multiple hidden @change="handleImageFiles">
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import Editor from '@toast-ui/editor'
    import '@toast-ui/editor/dist/toastui-editor.css'

    import { showToast } from '@/stores/notify'

    const props = withDefaults(defineProps<{
        initialValue?: string
        placeholder?: string
        toolbar?: boolean
        imageUploadEnabled?: boolean
    }>(), {
        initialValue: '',
        placeholder: '',
        toolbar: true,
        imageUploadEnabled: true,
    })

    const emit = defineEmits<{
        change: [markdown: string]
        imageFiles: [files: File[]]
        settings: []
    }>()

    const editorHost = ref<HTMLElement | null>(null)
    const imageInputRef = ref<HTMLInputElement | null>(null)
    const headingMenuRef = ref<HTMLElement | null>(null)

    const editor = ref<Editor | null>(null)
    const viewMode = ref<'preview' | 'edit' | 'split'>('preview')
    const fullscreen = ref(false)
    const headingMenuOpen = ref(false)
    const headingLevels = [1, 2, 3, 4]

    // 全屏标记:固定定位的全屏编辑器无法脱离 .gddp-content-view 的层叠上下文(z-index:1),
    // 需在 body 上打标,由 gddp-layout 提升内容视图到顶栏(z-index:100)之上才能完整覆盖 chat-header
    watch(fullscreen, (active) => {
        document.body.classList.toggle('gddp-markdown-fullscreen-active', active)
    })

    /** 预览模式下禁用格式命令(对齐原版 disabled 行为) */
    const formatDisabled = computed(() => viewMode.value === 'preview')

    /** 视图模式 class 必须挂在编辑器宿主上,:deep 规则才与 Toast UI DOM 匹配 */
    const modeClasses = computed(() => ({
        'gddp-markdown-mode-edit': viewMode.value === 'edit',
        'gddp-markdown-mode-preview': viewMode.value === 'preview',
        'gddp-markdown-mode-split': viewMode.value === 'split',
    }))

    /** 卸载时清理编辑器与全局监听 */
    let pasteCleanupFns: (() => void)[] = []

    onMounted(() => mountEditor())

    onBeforeUnmount(() => {
        editor.value?.destroy()
        editor.value = null
        document.removeEventListener('click', handleDocumentClick)
        clearImageUploadBridge()
        document.body.classList.remove('gddp-markdown-fullscreen-active')
    })

    /** 创建 Toast UI 编辑器(隐藏原生工具栏)并绑定图片粘贴/拖拽上传 */
    function mountEditor(initialValue = props.initialValue): void {
        if (!editorHost.value) {
            return
        }

        editor.value?.destroy()
        editor.value = null

        editor.value = new Editor({
            el: editorHost.value,
            initialValue,
            initialEditType: 'markdown',
            previewStyle: 'vertical',
            height: '100%',
            usageStatistics: false,
            hideModeSwitch: true,
            toolbarItems: [],
            placeholder: props.placeholder,
        })

        editor.value.on('change', () => emit('change', editor.value?.getMarkdown() ?? ''))

        if (props.imageUploadEnabled) {
            bindImageUploadBridge()
        }

        // 强制 Toast UI 重新计算布局与预览渲染(容器曾被 display:none 挂载时预览会空白)
        window.setTimeout(() => {
            window.dispatchEvent(new Event('resize'))
        }, 0)
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

        if (!runCommand('heading', { level })) {
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

    /** 尝试执行 Toast UI 命令;执行过程抛异常(命令不存在)时尝试下一个别名,全部失败返回 false */
    function runCommand(name: string, payload?: Record<string, unknown>): boolean {
        const aliases = commandAliases[name] || [name]

        for (const alias of aliases) {
            try {
                if (payload === undefined) {
                    editor.value?.exec(alias)
                } else {
                    editor.value?.exec(alias, payload)
                }

                return true
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
            if (!runCommand('link')) {
                const selected = editor.value.getSelectedText() || '链接文本'

                insertMarkdownFallback(`[${selected}](https://)`)
            }

            showToast('已插入链接模板', 'info')

            return
        }

        if (cmd === 'table') {
            if (!runCommand('table')) {
                insertMarkdownFallback('\n| 列1 | 列2 |\n| --- | --- |\n|  |  |')
            }

            showToast('已插入表格模板', 'info')

            return
        }

        if (!runCommand(cmd)) {
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
        setMode(viewMode.value === 'preview' ? 'edit' : 'preview')
    }

    /** 「分屏」按钮:split ↔ edit 切换(对齐原版) */
    function toggleSplit(): void {
        setMode(viewMode.value === 'split' ? 'edit' : 'split')
    }

    /** 设置视图模式并关闭标题菜单 */
    function setMode(mode: 'preview' | 'edit' | 'split'): void {
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

    /** 选择图片文件后交给宿主上传 */
    function handleImageFiles(event: Event): void {
        const input = event.target as HTMLInputElement
        const files = input.files ? Array.from(input.files).filter((f) => f.type.startsWith('image/')) : []

        input.value = ''

        if (files.length) {
            emit('imageFiles', files)
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

                emit('imageFiles', files)
            }
            const onDrop = (evt: DragEvent) => {
                const files = extractImageFilesFromEvent(evt)

                if (!files.length) {
                    return
                }

                evt.preventDefault()
                evt.stopPropagation()

                emit('imageFiles', files)
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

    /** 执行原生命令,命令不存在时返回 false */
    function exec(name: string, payload?: Record<string, unknown>): boolean {
        try {
            if (payload === undefined) {
                editor.value?.exec(name)
            } else {
                editor.value?.exec(name, payload)
            }

            return true
        } catch {
            return false
        }
    }

    defineExpose({
        getMarkdown: () => editor.value?.getMarkdown() ?? '',
        setMarkdown: (markdown: string, cursorToEnd = true) => editor.value?.setMarkdown(markdown, cursorToEnd),
        getEditor: () => editor.value,
        getMode: () => viewMode.value,
        setMode,
        togglePreview,
        toggleSplit,
        getSelectedText: () => editor.value?.getSelectedText() ?? '',
        replaceSelection: (text: string) => editor.value?.replaceSelection(text),
        insertText: (text: string) => editor.value?.insertText(text),
        exec,
        runCommand,
        destroy: () => {
            editor.value?.destroy()
            editor.value = null
        },
        /** 强制重建编辑器实例:用于 setMarkdown 失败(PM doc 与 preview 脱节)后的兜底,保证 editor 与 preview 原子同步 */
        reset: (markdown: string) => mountEditor(markdown),
    })
</script>

<style scoped>
    .gddp-markdown-editor {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: #fff;
    }

    /* 全屏:脱离视图布局覆盖整个视口(设计令牌 --z-viewer) */
    .gddp-markdown-editor.gddp-markdown-fullscreen {
        position: fixed;
        inset: 0;
        z-index: var(--z-viewer);
        height: auto;
    }

    /* ---------- 工具栏(GDDP 单色视觉) ---------- */

    .gddp-markdown-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        padding: 6px 10px;
        border-bottom: 1px solid #e5e7eb;
        background: #fff;
    }

    .gddp-markdown-toolbar .heading-control {
        position: relative;
        display: inline-flex;
        align-items: center;
    }

    .gddp-markdown-toolbar .toolbar-btn {
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

    .gddp-markdown-toolbar .toolbar-btn:hover {
        background: #f4f4f5;
        color: #18181b;
    }

    .gddp-markdown-toolbar .toolbar-btn.active {
        background: #ececee;
        color: #18181b;
        box-shadow: inset 0 0 0 1px #d4d4d8;
    }

    .gddp-markdown-toolbar .toolbar-btn:disabled {
        opacity: 0.42;
        pointer-events: none;
    }

    .gddp-markdown-toolbar .toolbar-btn i {
        font-size: 14px;
    }

    .gddp-markdown-toolbar .toolbar-separator {
        display: inline-block;
        width: 1px;
        height: 18px;
        margin: 0 6px;
        background: #d4d4d8;
    }

    /* 设置按钮靠右对齐 */
    .gddp-markdown-toolbar .gddp-markdown-settings-btn {
        margin-left: auto;
    }

    .gddp-markdown-toolbar .heading-menu {
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

    .gddp-markdown-toolbar .heading-option {
        min-width: 36px;
        padding: 0 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
    }

    /* ---------- 编辑器宿主与 Toast UI 布局修正 ---------- */

    .gddp-markdown-host {
        flex: 1;
        min-height: 0;
        position: relative;
    }

    /* 隐藏 Toast UI 原生工具栏,改用自定义工具栏 */
    .gddp-markdown-host :deep(.toastui-editor-toolbar) {
        display: none !important;
    }

    /* 高度链:defaultUI → main → main-container → md-container → vertical-style */
    .gddp-markdown-host :deep(.toastui-editor-defaultUI) {
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 0;
    }

    .gddp-markdown-host :deep(.toastui-editor-main) {
        flex: 1 1 auto;
        min-height: 0;
    }

    .gddp-markdown-host :deep(.toastui-editor-main-container) {
        height: 100%;
        min-height: 0;
    }

    .gddp-markdown-host :deep(.toastui-editor-md-container) {
        display: block;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }

    /* 垂直布局:编辑区 + 预览区 flex 各占 50% */
    .gddp-markdown-host :deep(.toastui-editor-md-vertical-style) {
        display: flex;
        align-items: stretch;
        height: 100% !important;
        min-height: 0 !important;
    }

    .gddp-markdown-host :deep(.toastui-editor-md-container .toastui-editor) {
        display: flex;
        flex-direction: column;
        flex: 1 1 50%;
        min-width: 0;
        height: 100% !important;
        min-height: 0 !important;
    }

    /* ProseMirror 撑满编辑区(修复其 height 非 100% 导致编辑区塌陷) */
    .gddp-markdown-host :deep(.toastui-editor-md-container .ProseMirror) {
        flex: 1 1 auto;
        height: 100% !important;
        min-height: 100% !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }

    .gddp-markdown-host :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        flex: 1 1 50%;
        min-width: 0;
        height: 100%;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }

    /* 分屏分隔条:位于 main-container 内、md-container 的兄弟节点,默认隐藏 */
    .gddp-markdown-host :deep(.toastui-editor-main .toastui-editor-md-splitter) {
        display: none;
    }

    .gddp-markdown-host.gddp-markdown-mode-split :deep(.toastui-editor-main .toastui-editor-md-splitter) {
        display: block;
    }

    /* 编辑模式:隐藏预览,编辑区占满 */
    .gddp-markdown-host.gddp-markdown-mode-edit :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        display: none !important;
    }

    .gddp-markdown-host.gddp-markdown-mode-edit :deep(.toastui-editor-md-container .toastui-editor) {
        flex: 1 1 100%;
    }

    /* 预览模式:隐藏编辑区,预览区占满 */
    .gddp-markdown-host.gddp-markdown-mode-preview :deep(.toastui-editor-md-container .toastui-editor) {
        display: none !important;
    }

    .gddp-markdown-host.gddp-markdown-mode-preview :deep(.toastui-editor-md-container .toastui-editor-md-preview) {
        flex: 1 1 100%;
    }
</style>