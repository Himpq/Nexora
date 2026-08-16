<!--
    MessageItem.vue — 单条消息(逐像素复刻原版消息结构)

    结构(与原版 chat_messages.js appendMessage 一致):
      .message.user|.assistant > .message-content
        > user: .message-bubble(markdown) + .msg-actions(编辑/复制/删除)
        > assistant: .reasoning(折叠) + .content-body(markdown)

    渲染实现可替换(markdown 统一走 MarkdownView),class 结构与原版一致。
-->

<template>
    <div class="message" :class="[message.role, { pending: message.pending }]" :data-index="message.index">
        <div class="message-content">
            <template v-if="message.role === 'user'">
                <!-- 内联编辑(对齐原版 toggleEditUserPrompt:气泡变 textarea,Enter 保存重答) -->
                <div v-if="editing" class="message-bubble">
                    <textarea
                        ref="editInputRef"
                        class="user-prompt-inline-editor"
                        :value="editDraft"
                        rows="3"
                        @input="editDraft = ($event.target as HTMLTextAreaElement).value"
                        @keydown="handleEditKeydown"
                    ></textarea>
                    <div class="user-prompt-inline-hint">Enter 保存并重答,Shift+Enter 换行,Esc 取消</div>
                </div>

                <div v-else-if="message.content" class="message-bubble">
                    <MarkdownView :content="message.content" />
                </div>

                <!-- 附件(对齐原版 appendUserAttachments:图片缩略图可点击查看大图,文件为胶囊) -->
                <div v-if="!editing && attachments.length" class="message-attachments" :class="{ 'file-list': !hasImageAttachments }">
                    <button
                        v-for="att in imageAttachments"
                        :key="att.url"
                        type="button"
                        class="message-attachment image"
                        :title="att.name || 'image'"
                        @click="emit('open-image', att.url)"
                    >
                        <img loading="lazy" :src="att.url" :alt="att.name || 'image'">
                    </button>

                    <div
                        v-for="att in fileAttachments"
                        :key="att.url || att.name"
                        class="message-attachment file"
                        :title="att.type === 'sandbox_file' ? `沙箱文件: ${att.sandbox_path || ''}` : att.name"
                    >
                        <i
                            :class="att.type === 'sandbox_file'
                                ? 'fa-solid fa-folder-tree'
                                : (att.type === 'text' ? 'fa-regular fa-file-lines' : 'fa-regular fa-file')"
                            aria-hidden="true"
                        ></i>
                        <span class="name">{{ att.name || 'attachment' }}</span>
                        <span class="meta">{{ formatFileSize(att.size || 0) }}</span>
                    </div>
                </div>

                <div class="msg-actions">
                    <button
                        v-if="isLastUserMessage"
                        class="btn-action"
                        :title="editing ? '保存修改' : '编辑提示词'"
                        @click="handleEditClick"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                        </svg>
                    </button>
                    <button class="btn-action" title="复制消息" @click="handleCopy">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="btn-action btn-del" title="删除" @click="handleDelete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                </div>
            </template>

            <template v-else>
                <!-- model badge(对齐原版:有 token 数据展开显示 I/O,无数据折叠为模型名,点击切换) -->
                <div
                    v-if="badgeText"
                    class="model-badge"
                    :class="{ collapsed: !badgeExpanded || !hasIoData }"
                    :title="badgeTitle"
                    @click="badgeExpanded = !badgeExpanded"
                >
                    {{ badgeExpanded && hasIoData ? badgeFullText : badgeText }}
                </div>

                <div v-if="message.reasoning" class="thinking-block" :class="{ collapsed: reasoningCollapsed }">
                    <div class="thinking-header" @click="reasoningCollapsed = !reasoningCollapsed">
                        <i class="fa-solid fa-brain thinking-icon" aria-hidden="true"></i>
                        <span class="thinking-title">思考过程</span>
                        <i class="fa-solid fa-chevron-down chevron-icon" aria-hidden="true"></i>
                    </div>
                    <div v-if="!reasoningCollapsed" class="thinking-content">
                        {{ message.reasoning }}
                    </div>
                </div>

                <div v-if="message.content" class="content-body">
                    <MarkdownView :content="message.content" />
                </div>

                <div v-else-if="streaming" class="streaming-dots">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </div>

                <div v-if="message.content" class="msg-actions">
                    <button class="btn-action" title="复制消息" @click="handleCopy">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="btn-action" title="重新回答" @click="emit('regenerate', message)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import { showToast } from '@/stores/notify'

    import MarkdownView from './MarkdownView.vue'

    const props = defineProps<{
        message: ChatMessage
        streaming?: boolean
        modelName?: string
        isLastUserMessage?: boolean
    }>()

    const emit = defineEmits<{
        delete: [message: ChatMessage]
        'edit-save': [message: ChatMessage, content: string]
        regenerate: [message: ChatMessage]
        'open-image': [url: string]
    }>()

    const reasoningCollapsed = ref(true)
    const badgeExpanded = ref(true)

    /** 内联编辑状态 */
    const editing = ref(false)
    const editDraft = ref('')
    const editInputRef = ref<HTMLTextAreaElement | null>(null)

    /** 编辑按钮:切换内联编辑(对齐原版 toggleEditUserPrompt) */
    function handleEditClick(): void {
        if (editing.value) {
            submitEdit()

            return
        }

        editing.value = true
        editDraft.value = String(props.message.content || '')

        requestAnimationFrame(() => {
            editInputRef.value?.focus()
        })
    }

    /** 编辑框键盘:Enter 保存重答,Shift+Enter 换行,Esc 取消 */
    function handleEditKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()

            editing.value = false

            return
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()

            submitEdit()
        }
    }

    /** 提交编辑内容 */
    function submitEdit(): void {
        const content = editDraft.value.trim()

        editing.value = false

        if (!content || content === props.message.content) {
            return
        }

        emit('edit-save', props.message, content)
    }

    /** 助手消息模型徽标(对齐原版:metadata.model_name 优先,有 tool_calls 的中间轮不显示) */
    const badgeText = computed(() => {
        if (props.message.role !== 'assistant') {
            return ''
        }

        const hasToolCalls = Array.isArray(props.message.tool_calls) && props.message.tool_calls.length > 0

        if (hasToolCalls) {
            return ''
        }

        const metadataName = readMetadataString('model_name')

        return metadataName || props.message.model_name || props.modelName || ''
    })

    /** 展开文本:模型名 - I/O: 输入/输出(对齐原版 buildModelBadgeText) */
    const badgeFullText = computed(() => {
        const model = badgeText.value || '-'
        const tokens = ioTokens.value
        const input = tokens.input
        const output = tokens.output

        return `${model} - I/O: ${input.toLocaleString()}/${output.toLocaleString()}`
    })

    /** 折叠时 title:多行详情(对齐原版 buildModelBadgeDetailTitle) */
    const badgeTitle = computed(() => {
        const model = badgeText.value || '-'
        const tokens = ioTokens.value
        const input = tokens.input
        const output = tokens.output

        return `模型: ${model}\n输入: ${input.toLocaleString()} | 输出: ${output.toLocaleString()}`
    })

    /** 是否有真实 token 数据(无数据时折叠显示,避免 0/0 噪音) */
    const hasIoData = computed(() => {
        const tokens = ioTokens.value

        return tokens.input > 0 || tokens.output > 0 || tokens.rawInput > 0
    })

    /** 读 metadata 字符串字段 */
    function readMetadataString(key: string): string {
        const metadata = messageMetadata()

        const value = metadata[key]

        return typeof value === 'string' ? value : ''
    }

    /** 消息 metadata(对齐原版 normalizeIoTokensPayload 读 io_tokens_cumulative / io_tokens_window) */
    function messageMetadata(): Record<string, unknown> {
        return (props.message.metadata && typeof props.message.metadata === 'object')
            ? props.message.metadata as Record<string, unknown>
            : {}
    }

    /** 本次轮次 I/O token(优先 window 口径,回退 cumulative) */
    const ioTokens = computed(() => {
        const metadata = messageMetadata()
        const windowTokens = readIoPayload(metadata.io_tokens_window)
        const cumulative = readIoPayload(metadata.io_tokens_cumulative || metadata.io_tokens)

        return hasAnyIo(windowTokens) ? windowTokens : cumulative
    })

    interface IoPayload {
        input: number
        rawInput: number
        cachedInput: number
        output: number
    }

    function readIoPayload(raw: unknown): IoPayload {
        if (!raw || typeof raw !== 'object') {
            return { input: 0, rawInput: 0, cachedInput: 0, output: 0 }
        }

        const record = raw as Record<string, unknown>

        return {
            input: safeToken(record.input),
            rawInput: safeToken(record.rawInput),
            cachedInput: safeToken(record.cachedInput),
            output: safeToken(record.output),
        }
    }

    function hasAnyIo(payload: IoPayload): boolean {
        return payload.input > 0 || payload.output > 0 || payload.rawInput > 0 || payload.cachedInput > 0
    }

    function safeToken(value: unknown): number {
        const num = Number(value)

        return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
    }

    async function handleCopy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(props.message.content || '')

            showToast('已复制', 'success')
        } catch {
            showToast('复制失败', 'error')
        }
    }

    function handleDelete(): void {
        emit('delete', props.message)
    }

    interface MessageAttachment {
        type?: string
        mime?: string
        name?: string
        url: string
        asset_url?: string
        size?: number
        sandbox_path?: string
    }

    /** 归一化附件列表:url 取 asset_url || url(对齐原版 appendUserAttachments) */
    const attachments = computed<MessageAttachment[]>(() => {
        const metadata = messageMetadata()
        const raw = metadata.attachments

        if (!Array.isArray(raw)) {
            return []
        }

        const list: MessageAttachment[] = []

        raw.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return
            }

            const record = entry as Record<string, unknown>
            const url = String(record.asset_url || record.url || '').trim()

            if (!url) {
                return
            }

            list.push({
                type: String(record.type || '').toLowerCase(),
                mime: String(record.mime || '').toLowerCase(),
                name: String(record.name || '').trim() || 'attachment',
                url,
                size: Number(record.size || 0),
                sandbox_path: String(record.sandbox_path || ''),
            })
        })

        return list
    })

    /** 图片附件:type 为 image/image_url 或 mime 以 image/ 开头(对齐原版过滤) */
    const imageAttachments = computed(() => {
        return attachments.value.filter((att) => {
            if (att.type === 'image' || att.type === 'image_url') {
                return true
            }

            return (att.mime || '').startsWith('image/')
        })
    })

    /** 其余附件(文件胶囊) */
    const fileAttachments = computed(() => {
        return attachments.value.filter((att) => !imageAttachments.value.includes(att))
    })

    /** 是否含图片附件(决定 message-attachments 是否加 file-list 类) */
    const hasImageAttachments = computed(() => imageAttachments.value.length > 0)

    /** 文件大小格式化(对齐原版 chat_files.js formatFileSize) */
    function formatFileSize(bytes: number): string {
        const n = Number(bytes || 0)

        if (!Number.isFinite(n) || n <= 0) {
            return '0 B'
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB']
        let val = n
        let idx = 0

        while (val >= 1024 && idx < units.length - 1) {
            val /= 1024
            idx += 1
        }

        return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`
    }
</script>

<style scoped>
    /* 生成中打字指示(原版未定义,补最小样式) */
    .streaming-dots {
        display: flex;
        gap: 4px;
        padding: 8px 0;
    }

    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #94a3b8;
        animation: dot-blink 1.2s infinite ease-in-out;
    }

    .dot:nth-child(2) {
        animation-delay: 0.2s;
    }

    .dot:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes dot-blink {
        0%, 80%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
        }

        40% {
            opacity: 1;
            transform: scale(1);
        }
    }
</style>
