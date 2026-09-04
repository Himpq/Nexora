<!--
    ChatInput.vue — 消息输入区(72px 紧凑单行:工具簇 / 正文 / 状态+发送 同排)

    结构:
      input-wrapper > input-container.composer-compact(单行 flex)
        > input-options(左侧工具簇:上传/Thinking/Search/Tools)
        > textarea#messageInput(flex:1 自适应)
        > input-footer(右侧:token 簇 + 折叠按钮 + sendBtn)
    多行输入时容器增高(is-multiline 改为底对齐),收起态(44px 圆钮)见 chat-input.css。
-->

<template>
    <div class="input-dock" :class="{ 'input-dock-collapsed': inputDockCollapsed }">
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
            :class="{ 'input-wrapper-collapsed': inputWrapperCollapsed }"
        >
            <div
                class="input-container composer-compact"
                :class="{ 'input-collapsed': inputContainerCollapsed, 'is-multiline': isMultiline, 'tools-mode-menu-open': toolsMenuOpen, 'file-drop-active': isDragOver }"
                @dragover.prevent="handleDragOver"
                @dragleave="handleDragLeave"
                @drop.prevent="handleDrop"
            >
                <!-- 行内工具簇(左侧):上传 / Thinking / Search / Tools —— 与正文同排,不占独立行 -->
                <div class="input-options">
                    <div class="input-options-tools">
                        <div class="input-options-tools-inner" :class="{ 'tools-mode-menu-open': toolsMenuOpen }">
                            <label
                                class="composer-chip composer-chip-upload"
                                :title="uploadingFiles ? '上传中...' : 'Upload File / Image'"
                                :class="{ 'is-uploading': uploadingFiles }"
                            >
                                <input type="file" id="fileInput" style="display:none" multiple @change="handleFileSelection">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                </svg>
                            </label>

                            <button
                                type="button"
                                class="composer-chip composer-chip-thinking"
                                :class="{ 'is-active': enableThinking }"
                                :title="enableThinking ? 'Deep Thinking: On' : 'Deep Thinking: Off'"
                                :aria-pressed="enableThinking"
                                @click="enableThinking = !enableThinking"
                            >
                                <i class="fa-solid fa-brain" aria-hidden="true"></i>
                            </button>

                            <button
                                type="button"
                                class="composer-chip composer-chip-search"
                                :class="{ 'is-active': enableWebSearch }"
                                :title="enableWebSearch ? 'Web Search: On' : 'Web Search: Off'"
                                :aria-pressed="enableWebSearch"
                                @click="enableWebSearch = !enableWebSearch"
                            >
                                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                            </button>

                            <!-- Tools 模式下拉(复用通用 GDDP SettingSelect,icon + 当前模式) -->
                            <SettingSelect
                                v-model="toolsMode"
                                :options="toolsModes"
                                popover-key="tools-menu"
                                placement="top"
                                class="chat-tools-select"
                                prefix-icon="fa-solid fa-screwdriver-wrench"
                            />
                        </div>
                    </div>
                </div>

                <textarea
                    id="messageInput"
                    ref="inputRef"
                    placeholder="Type a message..."
                    rows="1"
                    :value="draft"
                    @input="handleInput"
                    @keydown="handleKeydown"
                >                </textarea>

                <!-- 上下文/队列状态簇:作为容器独立子级(桌面与 footer 同排视觉不变;
                    手机 Grid 布局放工具行右端作锚点,平衡整行) -->
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
                        title="查看上下文窗口"
                        aria-label="查看上下文窗口"
                        @click.stop="toggleTokenBudgetCard($event)"
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
                        :title="hoverText"
                        :style="{ color: tokenRing.color }"
                        @click.stop="toggleTokenBudgetCard($event)"
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
                        TK <span id="totalInputTokens">{{ tokenMiniInput }}</span> / <span id="totalOutputTokens">{{ tokenMiniOutput }}</span>
                    </button>
                </div>

                <div class="input-footer">
                    <button
                        type="button"
                        class="btn-icon-small input-collapse-btn"
                        id="inputCollapseBtn"
                        :title="collapsed ? '展开输入框' : '折叠输入框'"
                        :aria-label="collapsed ? '展开输入框' : '折叠输入框'"
                        :aria-expanded="!collapsed"
                        @click="toggleCollapsed"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline :points="collapsed ? '18 15 12 9 6 15' : '6 9 12 15 18 9'"></polyline>
                        </svg>
                    </button>

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

        <!-- 上下文窗口卡片:点击 tokenBudgetMini / tokenBudgetUsage 触发(对齐原版 #tokenBudgetTooltip) -->
        <TokenBudgetCard
            :open="tokenBudgetCardOpen"
            :model="tipModel"
            :trigger="cardTrigger"
            :estimated="usedEstimated"
            @open-token-detail="emit('open-token-detail')"
            @close="closePopover('token-budget-card')"
        />
    </div>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, watch } from 'vue'

    import type { AttachmentInput } from '@/api/attachments'
    import { uploadFile } from '@/api/files-center'
    import { useConversationStore } from '@/stores/conversation'
    import { useModelStore } from '@/stores/model'
    import { showToast } from '@/stores/notify'
    import {
        buildTokenBudgetHoverText,
        buildTokenBudgetTooltipModel,
        computeContextWindowUsedTokens,
        estimateStreamTokensByText,
        normalizeContextWindow,
        readLastAssistantIoTokens,
        safeTokenInt,
    } from '@/stream/tokenBudget'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'
    import { clearDraft, loadDraft, saveDraft } from '@/composables/useChatDraft'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'
    import TokenBudgetCard from '@/components/TokenBudgetCard.vue'

    const props = defineProps<{
        /** 待发送附件列表(由 ChatView 管理,发送成功后清空) */
        attachments?: AttachmentInput[]
    }>()

    const emit = defineEmits<{
        send: [content: string, options: {
            enableThinking: boolean
            enableWebSearch: boolean
            enableTools: boolean
            /** Tools 模式原值(auto_off/force/off),发送链路透传给后端 tool_mode */
            toolsMode: string
        }]
        stop: []
        /** 移除某条待发送附件 */
        'remove-attachment': [index: number]
        /** 直选文件上传完成:父级并入待发送附件列表 */
        'files-uploaded': [attachments: AttachmentInput[]]
        /** 打开 Token 详情弹窗(GDDP) */
        'open-token-detail': []
    }>()

    const conversationStore = useConversationStore()
    const modelStore = useModelStore()

    const draft = ref('')
    const inputRef = ref<HTMLTextAreaElement | null>(null)

    /** 是否多行输入:容器由垂直居中切为底对齐,工具簇/发送按钮贴近末行(对齐主流聊天输入框) */
    const isMultiline = ref(false)

    /** 恢复当前会话草稿(挂载与切换对话时调用):回到上次未发送的文字,并同步输入框高度 */
    function restoreDraft(): void {
        const saved = loadDraft(conversationStore.currentId)

        if (saved === draft.value) {
            return
        }

        draft.value = saved

        const el = inputRef.value

        if (el) {
            el.value = saved

            autoResize()
        }
    }

    onMounted(() => {
        restoreDraft()
    })

    // 切换对话/新建对话:换回该会话的草稿
    watch(
        () => conversationStore.currentId,
        () => {
            restoreDraft()
        }
    )

    // 输入即按会话落缓存(防刷新丢失);草稿清空时自动移除该会话缓存
    watch(draft, (text) => {
        saveDraft(conversationStore.currentId, text)
    })

    /** 附件列表(空值安全:父级未传时为空数组) */
    const attachmentList = computed(() => props.attachments || [])

    /** 输入区偏好(Thinking/Search/Tools)localStorage 键,对齐原版 CHAT_COMPOSER_PREFS_KEY */
    const COMPOSER_PREFS_KEY = 'nexora_chat_composer_prefs_v1'

    interface ComposerPrefs {
        thinking: boolean
        search: boolean
        toolsMode: string
    }

    const toolsModes = [
        { value: 'off', label: 'Off' },
        { value: 'auto_off', label: 'Auto(OFF)' },
        { value: 'force', label: 'Force' },
    ]

    /** 读取输入区偏好缓存(缺失/损坏返回空对象) */
    function readComposerPrefs(): Partial<ComposerPrefs> {
        try {
            const raw = localStorage.getItem(COMPOSER_PREFS_KEY)

            if (!raw) {
                return {}
            }

            const parsed = JSON.parse(raw) as Partial<ComposerPrefs>

            return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
            return {}
        }
    }

    /** 写入输入区偏好缓存(失败静默,不影响输入区使用) */
    function writeComposerPrefs(prefs: ComposerPrefs): void {
        try {
            localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs))
        } catch {
            // 缓存写入失败不影响输入区使用
        }
    }

    /** 归一化 Tools 模式:非法值回退 auto_off(对齐原版 normalizeToolsMode) */
    function normalizeToolsMode(raw: unknown): string {
        const value = String(raw || '').trim()

        return toolsModes.some((item) => item.value === value) ? value : 'auto_off'
    }

    /** 输入区偏好:优先恢复本地缓存,无缓存用默认(Thinking 关 / Search 开 / Tools auto_off) */
    const composerPrefs = readComposerPrefs()

    const enableThinking = ref(typeof composerPrefs.thinking === 'boolean' ? composerPrefs.thinking : false)
    const enableWebSearch = ref(typeof composerPrefs.search === 'boolean' ? composerPrefs.search : true)

    /** 输入区折叠状态(容器与 wrapper 同步单段收缩,按钮随卡片右缘平滑滑入右下角,不会先居中再跳变) */
    const collapsed = ref(false)
    const inputContainerCollapsed = ref(false)
    const inputWrapperCollapsed = ref(false)

    /** input-dock 收起态:dock 保持自然高度(不清零),按钮始终可见可点 */
    const inputDockCollapsed = ref(false)

    /** Tools 模式(对齐原版 auto_off 默认);下拉状态由浮层协调器管理 */
    const toolsMode = ref(normalizeToolsMode(composerPrefs.toolsMode))
    const toolsMenuOpen = computed(() => overlay.popover === 'tools-menu')

    /** 生成中:输入框保持可用,发送按钮切换为"停止" */
    const streaming = computed(() => conversationStore.currentConversationGenerating)

    /** CTX 显示:当前模型上下文窗口(对齐原版 tokenBudgetUsage) */
    const ctxText = computed(() => {
        return tokenRing.value.text
    })

    /** token 画像(prompt_token_profile 块,CTX/卡片数据源) */
    const tokenProfile = computed(() => (conversationStore.streamTokenProfile || {}) as Record<string, unknown>)

    /**
     * 本轮上下文真实占用:优先最后一条助手消息 io_tokens_window 的 raw_input
     * (完整 prompt 口径,含缓存命中历史);缺失时回退 input 补全或文本估算。
     */
    const ctxUsed = computed(() => {
        const systemTokens = safeTokenInt(tokenProfile.value.system_tokens)
        const toolsTokens = safeTokenInt(tokenProfile.value.tools_tokens)
        const ioTokens = readLastAssistantIoTokens(conversationStore.messages)
        const historyText = conversationStore.messages.map((m) => String(m.content || '')).join('')

        // input 是缓存计费增量(命中缓存的历史不计入),不能代表窗口占用;
        // 只有 raw_input 缺失时才走"增量+固定部分"补全公式(responses 续接场景)。
        if (ioTokens.round.rawInput > 0) {
            return ioTokens.round.rawInput
        }

        const roundInput = ioTokens.round.input > 0 ? ioTokens.round.input : estimateStreamTokensByText(historyText)

        return computeContextWindowUsedTokens({ roundInput, systemTokens, toolTokens: toolsTokens })
    })

    /** 是否估算口径(本轮无真实 usage 数据,展示"近似/上限估算"标注) */
    const usedEstimated = computed(() => {
        const ioTokens = readLastAssistantIoTokens(conversationStore.messages)

        return ioTokens.round.input <= 0 && ioTokens.round.rawInput <= 0
    })

    /** 上下文窗口卡片数据模型(对齐原版 buildTokenBudgetTooltipModel) */
    const tipModel = computed(() => {
        const limit = normalizeContextWindow(modelStore.selectedModel?.context_window)
        const ioTokens = readLastAssistantIoTokens(conversationStore.messages)

        return buildTokenBudgetTooltipModel({
            limit,
            used: ctxUsed.value,
            contextOn: true,
            totalInput: ioTokens.round.input,
            rawInput: ioTokens.round.rawInput,
            cumulativeInput: ioTokens.cumulative.input,
            cachedInput: ioTokens.round.cachedInput,
            systemTokens: safeTokenInt(tokenProfile.value.system_tokens),
            toolTokens: safeTokenInt(tokenProfile.value.tools_tokens),
            estimated: usedEstimated.value,
        })
    })

    /** usage 悬浮提示文本(对齐原版 buildTokenBudgetHoverText) */
    const hoverText = computed(() => buildTokenBudgetHoverText(tipModel.value))

    /** 上下文窗口卡片:触发按钮引用 + 打开状态(经 overlay 协调器管理) */
    const cardTrigger = ref<HTMLElement | null>(null)
    const tokenBudgetCardOpen = computed(() => overlay.popover === 'token-budget-card')

    /** 点击 tokenBudgetMini / tokenBudgetUsage 切换上下文窗口卡片(对齐原版 bindTokenBudgetTooltipTriggers) */
    function toggleTokenBudgetCard(event: Event): void {
        cardTrigger.value = (event.currentTarget as HTMLElement) || null

        if (overlay.popover === 'token-budget-card') {
            closePopover('token-budget-card')

            return
        }

        openPopover('token-budget-card')
    }

    /** 上下文圆环:用量/预算 conic-gradient(对齐原版 renderTokenBudgetUi) */
    const tokenRing = computed(() => {
        const limit = Number(modelStore.selectedModel?.context_window || 0)
        const used = ctxUsed.value

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

    /** TK mini 输入/输出展示(今日基数 + 流式增量,数据源 conversation store,对齐原版 applyTokenMiniDisplay) */
    const tokenMiniInput = computed(() => conversationStore.tokenMiniText.input)
    const tokenMiniOutput = computed(() => conversationStore.tokenMiniText.output)

    function handleInput(event: Event): void {
        draft.value = (event.target as HTMLTextAreaElement).value

        autoResize()
    }

    /** 直选上传进行中(防重入,按钮置灰) */
    const uploadingFiles = ref(false)

    /** 拖拽悬停高亮(对齐原版 input-container.file-drop-active) */
    const isDragOver = ref(false)

    function handleDragOver(): void {
        isDragOver.value = true
    }

    function handleDragLeave(event: DragEvent): void {
        // 仅当离开容器本身时清除，避免子元素间移动触发闪烁
        const related = event.relatedTarget as HTMLElement | null

        if (!related || !(event.currentTarget as HTMLElement).contains(related)) {
            isDragOver.value = false
        }
    }

    async function handleDrop(event: DragEvent): Promise<void> {
        isDragOver.value = false

        const files = Array.from(event.dataTransfer?.files || [])

        if (!files.length || uploadingFiles.value) {
            return
        }

        uploadingFiles.value = true

        try {
            const uploaded: AttachmentInput[] = []

            for (const file of files) {
                const result = await uploadFile(file)
                const sandboxPath = String(result.sandbox_path || '').trim()

                if (!sandboxPath) {
                    throw new Error(`${file.name} 上传结果缺少文件路径`)
                }

                const displayName = String(result.original_name || file.name)

                uploaded.push({
                    type: 'sandbox_file',
                    name: displayName,
                    original_name: displayName,
                    sandbox_path: sandboxPath,
                    stored_path: String(result.stored_path || sandboxPath),
                    size: Number(result.size || file.size || 0),
                })
            }

            emit('files-uploaded', uploaded)

            showToast(`已附加 ${uploaded.length} 个文件`, 'success')
        } catch (error) {
            showToast(error instanceof Error ? error.message : '上传失败', 'error')
        } finally {
            uploadingFiles.value = false
        }
    }

    /**
     * 输入区直选文件上传(对齐原版 fileInput → uploadSingleFileWithProgress):
     * 逐个走 /api/upload 任务链,成功后转为 sandbox_file 附件交父级并入待发送列表。
     */
    async function handleFileSelection(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const files = Array.from(input.files || [])

        input.value = ''

        if (!files.length || uploadingFiles.value) {
            return
        }

        uploadingFiles.value = true

        try {
            const uploaded: AttachmentInput[] = []

            for (const file of files) {
                const result = await uploadFile(file)
                const sandboxPath = String(result.sandbox_path || '').trim()

                if (!sandboxPath) {
                    throw new Error(`${file.name} 上传结果缺少文件路径`)
                }

                const displayName = String(result.original_name || file.name)

                uploaded.push({
                    type: 'sandbox_file',
                    name: displayName,
                    original_name: displayName,
                    sandbox_path: sandboxPath,
                    stored_path: String(result.stored_path || sandboxPath),
                    size: Number(result.size || file.size || 0),
                })
            }

            emit('files-uploaded', uploaded)

            showToast(`已附加 ${uploaded.length} 个文件`, 'success')
        } catch (error) {
            showToast(error instanceof Error ? error.message : '上传失败', 'error')
        } finally {
            uploadingFiles.value = false
        }
    }

    /** 与原版一致:输入时自动调整高度 */
    function autoResize(): void {
        const el = inputRef.value

        if (!el) {
            return
        }

        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`

        // 超过单行(约 1 行高 22px + 上下留白)即判定为多行,切换容器底对齐
        isMultiline.value = el.scrollHeight > 34
    }

    /** 折叠/展开:容器与 wrapper 同步切换,两条 max-width 过渡同进同退,
     *  按钮始终锚定卡片右缘(右对齐 margin),随收缩平滑滑入右下角,dock 保持自然高度不裁按钮;
     *  消息区底部 margin 同步过渡为负值,延伸到底部消除白色条带(见 chat-input.css)。 */
    function toggleCollapsed(): void {
        if (!collapsed.value) {
            collapsed.value = true
            inputContainerCollapsed.value = true
            inputWrapperCollapsed.value = true
            inputDockCollapsed.value = true

            return
        }

        collapsed.value = false
        inputContainerCollapsed.value = false
        inputWrapperCollapsed.value = false
        inputDockCollapsed.value = false
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

        // 纯附件(单图/单文件)允许空文本发送,附件随消息持久化展示(对齐原版 uploadedFileIds 语义)
        if (!content && attachmentList.value.length === 0) {
            return
        }

        emit('send', content, {
            enableThinking: enableThinking.value,
            enableWebSearch: enableWebSearch.value,
            enableTools: toolsMode.value !== 'off',
            toolsMode: toolsMode.value,
        })

        // 发送成功后清除该会话草稿(避免刷新后旧草稿复活)
        clearDraft(conversationStore.currentId)

        draft.value = ''

        const el = inputRef.value

        if (el) {
            el.value = ''
            el.style.height = 'auto'
            isMultiline.value = false
        }
    }

    /** 偏好变更即写回本地缓存(对齐原版 saveComposerPrefsToStorage) */
    watch([enableThinking, enableWebSearch, toolsMode], () => {
        writeComposerPrefs({
            thinking: enableThinking.value,
            search: enableWebSearch.value,
            toolsMode: toolsMode.value,
        })
    })

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
        /** 供父级在重答/编辑重发等路径读取当前 Tools 模式(对齐原版重答沿用 toolsMode) */
        getToolsMode(): string {
            return toolsMode.value
        },
    })
</script>

<style scoped>
    /* 消息队列徽标(新功能元素,样式贴近原版 token 显示;单行布局下压缩右距) */
    .queue-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: var(--color-bg-hover);
        color: var(--color-accent-text);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        margin-right: 2px;
        user-select: none;
        line-height: 1;
    }

    /* 待发送附件条(复用全局 upload-preview-card 卡片式样式,对齐原版 filePreviewArea) */
    .input-attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-border);
    }

    /* ============ 行内工具芯片(上传/Thinking/Search) ============
       图标芯片:未激活灰显、hover 反显;激活态着色(思考靛蓝 / 搜索天蓝)。
       高度与发送按钮同簇,单行不额外占高,折叠/多行时随容器联动。 */
    .composer-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0;
        box-sizing: border-box;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    }

    .composer-chip:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .composer-chip:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 1px;
    }

    .composer-chip-thinking.is-active {
        background: rgba(99, 102, 241, 0.14);
        border-color: rgba(99, 102, 241, 0.42);
        color: #6366f1;
    }

    .composer-chip-search.is-active {
        background: rgba(2, 132, 199, 0.14);
        border-color: rgba(2, 132, 199, 0.42);
        color: #0284c7;
    }

    /* 上传进行中:图标半透明提示 */
    .is-uploading {
        opacity: 0.45;
        pointer-events: none;
    }

    /* 折叠按钮与发送同簇:清除 legacy 的 margin-left:auto 推挤,垂直居中即可 */
    .input-collapse-btn {
        margin: 0;
        flex: 0 0 auto;
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
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 400;
        white-space: nowrap;
        line-height: 1;
    }

    .token-mini {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 400;
        color: var(--color-text-secondary);
        line-height: 1;
    }

    .token-budget-mini:focus-visible,
    .token-budget-usage:focus-visible,
    .token-mini:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
        border-radius: 4px;
    }

    /* Tools 模式下拉:收敛为紧凑幽灵触发器(wrench 前缀图标 + 当前模式),
       未激活样式对齐相邻芯片(透明底无边框),hover/展开反显 */
    .chat-tools-select :deep(.setting-select-trigger) {
        height: 30px;
        min-width: 0;
        padding: 0 6px 0 8px;
        gap: 6px;
        font-size: 12px;
        border-radius: 8px;
        background: transparent;
        border-color: transparent;
        color: var(--color-text-secondary);
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .chat-tools-select :deep(.setting-select-trigger:hover),
    .chat-tools-select :deep(.setting-select-trigger.open) {
        background: var(--color-bg-hover);
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }

    .chat-tools-select :deep(.setting-select-prefix) {
        display: inline-flex;
        align-items: center;
        font-size: 13px;
        color: inherit;
    }

    .chat-tools-select :deep(.setting-select-trigger > i:last-child) {
        font-size: 10px;
    }

    .chat-tools-select :deep(.setting-select-label) {
        font-size: 12px;
        white-space: nowrap;
    }

    /* 窄屏:先收掉 CTX/TK 文字(圆环仍可点开卡片),再收掉队列徽标与 Tools 文字 →
        Tools 退化为仅 wrench 图标的圆芯片,保证 320px 宽度内不溢出 */
    @media (max-width: 760px) {
        .token-budget-usage,
        .token-mini {
            display: none;
        }
    }

    @media (max-width: 560px) {
        /* 工具 chip 收窄到 26px:工具行明显矮于输入行,拉开主次层次 */
        .composer-chip {
            width: 26px;
            height: 26px;
        }

        .chat-tools-select :deep(.setting-select-trigger) {
            width: 26px;
            height: 26px;
            padding: 0;
            justify-content: center;
        }

        .chat-tools-select :deep(.setting-select-label),
        .chat-tools-select :deep(.setting-select-trigger > i:last-child) {
            display: none;
        }

        /* Grid 行1右端有充裕空间:恢复 CTX 用量文字(被 ≤760 规则隐藏),
           与 CTX 环构成工具行右侧锚点,平衡整行 */
        .token-budget-usage {
            display: inline-flex;
        }
    }
</style>
