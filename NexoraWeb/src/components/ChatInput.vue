<!--
    ChatInput.vue — 消息输入区(逐像素复刻原版 input-wrapper 结构)

    结构(与原版 chat.html 一致):
      input-wrapper > input-container
        > input-options(上传/Thinking/Search/Tools + 折叠按钮)
        > textarea#messageInput
        > input-footer(token 显示/CTX + sendBtn)
-->

<template>
    <div class="input-dock">
        <!-- 待发送附件条(对齐原版 filePreviewArea:卡片式预览,右上角删除) -->
        <div v-if="attachmentList.length" class="input-attachments" id="filePreviewArea">
            <div
                v-for="(att, index) in attachmentList"
                :key="`${att.sandbox_path || att.name}-${index}`"
                class="upload-preview-card"
                :class="isImageAttachment(att) ? 'is-image' : 'is-file'"
            >
                <button type="button" class="upload-preview-remove" title="移除" @click="emit('remove-attachment', index)">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>

                <div class="upload-preview-media">
                    <img
                        v-if="isImageAttachment(att)"
                        :src="attachmentPreviewUrl(att)"
                        :alt="attachmentDisplayName(att)"
                        loading="lazy"
                    >
                    <i v-else :class="attachmentIconClass(att)" aria-hidden="true"></i>
                </div>

                <div class="upload-preview-body">
                    <div class="upload-preview-title" :title="att.sandbox_path || att.name">{{ attachmentDisplayName(att) }}</div>
                    <div class="upload-preview-meta">{{ attachmentMeta(att) }}</div>
                </div>
            </div>
        </div>

        <div
            id="inputWrapper"
            class="input-wrapper"
            :class="{ 'input-wrapper-collapsed': collapsed }"
        >
            <div class="input-container" :class="{ 'input-collapsed': collapsed, 'tools-mode-menu-open': toolsMenuOpen }">
                <div class="input-options">
                    <div class="input-options-tools">
                        <div class="input-options-tools-inner" :class="{ 'tools-mode-menu-open': toolsMenuOpen }">
                            <label class="btn-icon-small" title="Upload File / Image" style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-right: 8px; color: var(--text-secondary);">
                                <input type="file" id="fileInput" style="display:none" multiple>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                </svg>
                            </label>

                            <label class="check-box" title="Deep Thinking">
                                <input type="checkbox" id="enableThinking" :checked="enableThinking" @change="enableThinking = ($event.target as HTMLInputElement).checked">
                                <span class="check-label-wrap">
                                    <i class="fa-solid fa-brain check-label-icon" aria-hidden="true"></i>
                                    <span class="check-label check-label-text">Thinking</span>
                                </span>
                            </label>

                            <label class="check-box" title="Web Search">
                                <input type="checkbox" id="enableWebSearch" :checked="enableWebSearch" @change="enableWebSearch = ($event.target as HTMLInputElement).checked">
                                <span class="check-label-wrap">
                                    <i class="fa-solid fa-magnifying-glass check-label-icon" aria-hidden="true"></i>
                                    <span class="check-label check-label-text">Search</span>
                                </span>
                            </label>

                            <!-- Tools 模式下拉(对齐原版) -->
                            <label class="check-box tool-mode-box" title="Tool Use Mode">
                                <span class="check-label-wrap">
                                    <i class="fa-solid fa-screwdriver-wrench check-label-icon" aria-hidden="true"></i>
                                    <span class="check-label check-label-text">Tools</span>
                                </span>
                                <div
                                    ref="toolsDropdownRef"
                                    class="tool-mode-dropdown"
                                    id="toolsModeDropdown"
                                    :class="{ open: toolsMenuOpen }"
                                >
                                    <input type="hidden" id="toolsMode" :value="toolsMode">
                                    <button type="button" class="tool-mode-trigger" id="toolsModeTrigger" aria-haspopup="listbox" :aria-expanded="toolsMenuOpen" @click.stop="toggleToolsMenu">
                                        <span id="toolsModeLabel">{{ toolsModeLabel }}</span>
                                        <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
                                    </button>
                                    <div class="tool-mode-menu" id="toolsModeMenu" role="listbox" aria-label="Tools mode">
                                        <button
                                            v-for="mode in toolsModes"
                                            :key="mode.value"
                                            type="button"
                                            class="tool-mode-item"
                                            :class="{ active: toolsMode === mode.value }"
                                            :data-mode="mode.value"
                                            role="option"
                                            :aria-selected="toolsMode === mode.value"
                                            @click.stop="selectToolsMode(mode.value)"
                                        >
                                            {{ mode.label }}
                                        </button>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                    <button
                        type="button"
                        class="btn-icon-small input-collapse-btn"
                        id="inputCollapseBtn"
                        :title="collapsed ? '展开输入框' : '折叠输入框'"
                        :aria-label="collapsed ? '展开输入框' : '折叠输入框'"
                        :aria-expanded="!collapsed"
                        @click="collapsed = !collapsed"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline :points="collapsed ? '18 15 12 9 6 15' : '6 9 12 15 18 9'"></polyline>
                        </svg>
                    </button>
                </div>

                <textarea
                    id="messageInput"
                    ref="inputRef"
                    placeholder="Type a message..."
                    rows="1"
                    :value="draft"
                    @input="handleInput"
                    @keydown="handleKeydown"
                ></textarea>

                <div class="input-footer">
                    <div class="token-footer-left">
                        <span
                            v-if="conversationStore.queueCount > 0"
                            class="queue-badge"
                            title="待发送消息数"
                        >
                            <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                            {{ conversationStore.queueCount }}
                        </span>

                        <button
                            type="button"
                            class="token-budget-mini"
                            id="tokenBudgetMini"
                            title="查看 Token 使用详情"
                            aria-label="查看 Token 使用详情"
                            @click="emit('open-token-detail')"
                        >
                            <span
                                class="token-budget-ring"
                                id="tokenBudgetRing"
                                :style="{ '--tb-color': tokenRing.color, '--tb-angle': `${tokenRing.angle}deg` }"
                            ></span>
                        </button>
                        <button
                            type="button"
                            class="token-budget-usage"
                            id="tokenBudgetUsage"
                            :title="`${ctxTitle} · 点击查看详情`"
                            :style="{ color: tokenRing.color }"
                            @click="emit('open-token-detail')"
                        >
                            {{ ctxText }}
                        </button>
                        <button
                            type="button"
                            class="token-mini"
                            id="tokenDisplay"
                            title="查看 Token 使用详情"
                            aria-label="查看 Token 使用详情"
                            @click="emit('open-token-detail')"
                        >
                            TK <span id="totalInputTokens">0</span> / <span id="totalOutputTokens">0</span>
                        </button>
                    </div>

                    <button
                        id="sendBtn"
                        class="btn-send"
                        :class="{ 'stop-mode': streaming }"
                        :title="streaming ? 'Stop Generation' : 'Send Message'"
                        @click="handleSendOrStop"
                    >
                        <template v-if="!streaming">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </template>
                        <template v-else>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                            </svg>
                        </template>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { AttachmentInput } from '@/api/attachments'
    import { useConversationStore } from '@/stores/conversation'
    import { useModelStore } from '@/stores/model'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const props = defineProps<{
        /** 待发送附件列表(由 ChatView 管理,发送成功后清空) */
        attachments?: AttachmentInput[]
    }>()

    const emit = defineEmits<{
        send: [content: string, options: { enableThinking: boolean; enableWebSearch: boolean; enableTools: boolean }]
        stop: []
        /** 移除某条待发送附件 */
        'remove-attachment': [index: number]
        /** 打开 Token 详情弹窗(GDDP) */
        'open-token-detail': []
    }>()

    const conversationStore = useConversationStore()
    const modelStore = useModelStore()

    const draft = ref('')
    const inputRef = ref<HTMLTextAreaElement | null>(null)

    /** 附件列表(空值安全:父级未传时为空数组) */
    const attachmentList = computed(() => props.attachments || [])

    const enableThinking = ref(false)
    const enableWebSearch = ref(true)

    /** 输入区折叠状态(对齐原版 .input-collapsed) */
    const collapsed = ref(false)

    /** Tools 模式(对齐原版 auto_off 默认);下拉状态由浮层协调器管理 */
    const toolsMode = ref('auto_off')
    const toolsMenuOpen = computed(() => overlay.popover === 'tools-menu')
    const toolsDropdownRef = ref<HTMLElement | null>(null)

    const toolsModes = [
        { value: 'off', label: 'Off' },
        { value: 'auto_off', label: 'Auto(OFF)' },
        { value: 'force', label: 'Force' },
    ]

    const toolsModeLabel = computed(() => {
        return toolsModes.find((mode) => mode.value === toolsMode.value)?.label || 'Auto(OFF)'
    })

    /** 生成中:输入框保持可用,发送按钮切换为"停止" */
    const streaming = computed(() => conversationStore.generating)

    /** CTX 显示:当前模型上下文窗口(对齐原版 tokenBudgetUsage) */
    const ctxText = computed(() => {
        return tokenRing.value.text
    })

    const ctxTitle = computed(() => {
        const model = modelStore.selectedModel

        return model ? `${model.name} 上下文窗口` : '上下文窗口未知'
    })

    /** 上下文圆环:用量/预算 conic-gradient(对齐原版 renderTokenBudgetUi) */
    const tokenRing = computed(() => {
        const limit = Number(modelStore.selectedModel?.context_window || 0)
        const profile = (conversationStore.streamTokenProfile || {}) as Record<string, unknown>
        const systemTokens = safeToken(profile.system_tokens)
        const toolsTokens = safeToken(profile.tools_tokens)

        // 用量估算:固定部分(system+tools)+ 消息文本估算
        const historyText = conversationStore.messages.map((m) => String(m.content || '')).join('')
        const estimated = estimateTextTokens(historyText)
        const used = systemTokens + toolsTokens + estimated

        if (limit <= 0) {
            return {
                angle: 0,
                color: '#64748b',
                text: used > 0 ? `CTX ${used.toLocaleString()}/未配置` : 'CTX --/未配置',
            }
        }

        const ratio = Math.max(0, Math.min(1, used / limit))
        let color = '#22c55e'

        if (ratio >= 0.8) {
            color = '#ef4444'
        } else if (ratio >= 0.6) {
            color = '#f59e0b'
        }

        return {
            angle: Math.round(ratio * 360),
            color,
            text: `CTX ${used.toLocaleString()}/${limit.toLocaleString()}`,
        }
    })

    /** 安全数字转换 */
    function safeToken(value: unknown): number {
        const num = Number(value)

        return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
    }

    /** 附件大小展示(对齐原版 formatFileSize) */
    function formatSize(size?: number): string {
        const bytes = Number(size || 0)

        if (!Number.isFinite(bytes) || bytes <= 0) {
            return ''
        }

        if (bytes >= 1024 * 1024) {
            return `${(bytes / 1024 / 1024).toFixed(1)}MB`
        }

        if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(1)}KB`
        }

        return `${bytes}B`
    }

    /** 附件显示名(对齐原版 getUploadPreviewDisplayName:取路径末段) */
    function attachmentDisplayName(att: AttachmentInput): string {
        const raw = String(att.name || att.original_name || att.sandbox_path || '').trim()

        if (!raw) {
            return '未命名'
        }

        const parts = raw.split(/[\\/]/).filter(Boolean)

        return String(parts[parts.length - 1] || raw).trim() || '未命名'
    }

    /** 附件类型(对齐原版 getUploadPreviewMeta:扩展名 + 大小) */
    function attachmentMeta(att: AttachmentInput): string {
        const name = attachmentDisplayName(att).toLowerCase()
        const ext = name.includes('.') ? name.split('.').pop() || '' : ''
        const size = formatSize(att.size)

        return [ext || 'file', size].filter(Boolean).join(' · ')
    }

    /** 是否图片附件(原版 type=image 显缩略图;本端按扩展名推断) */
    function isImageAttachment(att: AttachmentInput): boolean {
        const name = String(att.name || att.original_name || att.sandbox_path || '').toLowerCase()

        return /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)
    }

    /** 图片附件预览 URL(对齐原版 file.url:走文件中心 inline 下载) */
    function attachmentPreviewUrl(att: AttachmentInput): string {
        const fileRef = String(att.sandbox_path || att.stored_path || '').trim()

        if (!fileRef) {
            return ''
        }

        return `/api/files/download?file_ref=${encodeURIComponent(fileRef)}&inline=1`
    }

    /** 文件附件图标(对齐原版 getUploadPreviewIconClass) */
    function attachmentIconClass(att: AttachmentInput): string {
        const name = attachmentDisplayName(att).toLowerCase()

        if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) return 'fa-regular fa-file-lines'
        if (name.endsWith('.pdf')) return 'fa-regular fa-file-pdf'
        if (name.endsWith('.doc') || name.endsWith('.docx')) return 'fa-regular fa-file-word'
        if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'fa-regular fa-file-excel'
        if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'fa-regular fa-file-powerpoint'
        if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) return 'fa-regular fa-file-zipper'
        if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.xml')) return 'fa-regular fa-file-code'

        return 'fa-regular fa-file'
    }

    /** 文本 token 估算(对齐原版 estimateStreamTokensByText) */
    function estimateTextTokens(text: string): number {
        const source = String(text || '')

        if (!source) {
            return 0
        }

        const nonAscii = (source.match(/[^\x00-\x7F]/g) || []).length
        const ascii = source.length - nonAscii

        return Math.max(0, Math.ceil(nonAscii / 1.25 + ascii / 4))
    }

    function toggleToolsMenu(): void {
        if (toolsMenuOpen.value) {
            closePopover('tools-menu')

            return
        }

        // 打开工具下拉:浮层协调器自动关闭右侧栏等浮层
        openPopover('tools-menu', toolsDropdownRef.value)
    }

    function selectToolsMode(value: string): void {
        toolsMode.value = value

        closePopover('tools-menu')
    }

    function handleInput(event: Event): void {
        draft.value = (event.target as HTMLTextAreaElement).value

        autoResize()
    }

    /** 与原版一致:输入时自动调整高度 */
    function autoResize(): void {
        const el = inputRef.value

        if (!el) {
            return
        }

        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }

    /** Enter 发送(Shift 换行),中文输入法组合时不触发 */
    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()

            handleSend()
        }
    }

    function handleSendOrStop(): void {
        if (streaming.value) {
            emit('stop')

            return
        }

        handleSend()
    }

    function handleSend(): void {
        // 生成中按 Enter 不发送、不清空输入(消息会进入队列,由 ChatView 处理)
        if (streaming.value) {
            return
        }

        const content = draft.value.trim()

        if (!content) {
            return
        }

        emit('send', content, {
            enableThinking: enableThinking.value,
            enableWebSearch: enableWebSearch.value,
            enableTools: toolsMode.value !== 'off',
        })

        draft.value = ''

        const el = inputRef.value

        if (el) {
            el.value = ''
            el.style.height = 'auto'
        }
    }

    /** 外部填充输入内容(解释指令等,对齐原版 fillMessageInputWithExplainText) */
    function fillDraft(text: string): void {
        draft.value = text

        const el = inputRef.value

        if (el) {
            el.value = text

            autoResize()

            el.focus()
            el.setSelectionRange(text.length, text.length)
        }
    }

    defineExpose({
        focus() {
            inputRef.value?.focus()
        },
        fillDraft,
    })
</script>

<style scoped>
    /* 消息队列徽标(新功能元素,样式贴近原版 token 显示) */
    .queue-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #eef2ff;
        color: #4f46e5;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
        font-weight: 600;
        margin-right: 8px;
        user-select: none;
    }

    /* 待发送附件条(复用全局 upload-preview-card 卡片式样式,对齐原版 filePreviewArea) */
    .input-attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px 12px;
        border-bottom: 1px solid #eef2f7;
    }

    /* Token 点击区改为按钮后去默认样式，保留原版等宽字体与尺寸 */
    .token-budget-mini,
    .token-budget-usage,
    .token-mini {
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
    }

    .token-budget-mini {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .token-budget-usage {
        font-family: var(--nc-font-mono);
        font-size: 11px;
        font-weight: 400;
        white-space: nowrap;
        line-height: 1;
    }

    .token-mini {
        font-family: var(--nc-font-mono);
        font-size: 11px;
        font-weight: 400;
        color: #7a7a7a;
        line-height: 1;
    }

    .token-budget-mini:focus-visible,
    .token-budget-usage:focus-visible,
    .token-mini:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
        border-radius: 4px;
    }
</style>
