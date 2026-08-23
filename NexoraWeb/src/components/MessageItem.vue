<!--
    MessageItem.vue — 单条消息(逐像素复刻原版消息结构)

    结构(与原版 chat_messages.js appendMessage 一致):
      .message.user|.assistant > .message-content
        > user: .message-bubble(markdown) + .msg-actions(编辑/复制/删除)
        > assistant: model-badge + 内容分段顺序渲染(思考块/正文按输出时序交错)
                     + .msg-actions(复制/重答/分支/版本切换)

    思考块策略(对齐原版 chat_render.js):
      正在输出的思考块自动展开,思考结束自动收起;用户手动切换过的块不被自动策略覆盖。

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

                <!--
                    内容分段顺序渲染(思考/正文/工具链按输出时序交错):
                    思考行与工具行共用执行流程时间线形态;
                    思考默认收起,流式输出时标题显示「思考中:末段字符滚动窗口」,点击展开完整内容;
                    工具行为时间线节点 + 中文动作标题。
                -->
                <template v-for="item in renderItems" :key="`${item.kind}-${item.sourceIndex}`">
                    <div
                        v-if="item.kind === 'reasoning'"
                        class="thinking-block reasoning-thinking-block execution-flow-item"
                        :class="{ collapsed: isReasoningCollapsed(item.sourceIndex), 'is-live': isLiveReasoning(item.sourceIndex) }"
                    >
                        <div class="thinking-header execution-flow-header" @click="toggleReasoning(item.sourceIndex)">
                            <span class="execution-flow-node thinking-flow-node" aria-hidden="true"></span>
                            <span class="execution-flow-main">
                                <span class="thinking-title execution-flow-title">{{ reasoningTitle(item.segment, item.sourceIndex) }}</span>
                            </span>
                            <i class="fa-solid fa-chevron-down chevron-icon" aria-hidden="true"></i>
                        </div>
                        <div class="thinking-content">
                            <MarkdownView :content="item.segment.text" />
                        </div>
                    </div>

                    <div v-else-if="item.kind === 'content'" class="content-body" :class="{ 'is-streaming-tail': isTailContent(item) }">
                        <MarkdownView :content="item.segment.text" />
                        <span v-if="isTailContent(item)" class="stream-caret" aria-hidden="true"></span>
                    </div>

                    <!--
                        交互问题卡片(question / ask_for_permission):
                        等待回答时可选选项或自由输入;提交后锁定并作为普通消息发送;
                        回答态持久化(localStorage nexora_question_locks_v1,与原版互操作)。
                    -->
                    <div
                        v-else-if="item.kind === 'question'"
                        class="question-tool-card"
                        :data-question-card-id="questionCardIdOf(item)"
                    >
                        <div class="question-card-body" :class="{ answered: isQuestionAnswered(item) }">
                            <div class="question-card-topline">
                                <span class="question-card-kicker">{{ isPermissionCard(item) ? '权限请求' : '提问' }}</span>
                                <span class="question-card-pill" :class="{ answered: isQuestionAnswered(item) }">
                                    {{ isQuestionAnswered(item) ? '已回答' : (isPermissionCard(item) ? '等待授权' : '等待回答') }}
                                </span>
                            </div>

                            <div class="question-card-title">{{ item.payload.question_title || '问题' }}</div>
                            <div class="question-card-content">{{ item.payload.question_content }}</div>

                            <template v-if="!isQuestionAnswered(item)">
                                <div v-if="(item.payload.choices || []).length" class="question-card-choices">
                                    <button
                                        v-for="(choice, choiceIndex) in item.payload.choices"
                                        :key="choiceIndex"
                                        type="button"
                                        class="question-choice-btn"
                                        :disabled="questionSubmitting[item.sourceIndex] === true"
                                        @click="submitQuestionAnswer(item, String(choice))"
                                    >{{ choice }}</button>
                                </div>

                                <div v-if="item.payload.allow_other !== false" class="question-card-other">
                                    <input
                                        class="question-other-input"
                                        type="text"
                                        placeholder="其他…"
                                        :value="otherDraftValue(item)"
                                        :disabled="questionSubmitting[item.sourceIndex] === true"
                                        @input="setOtherDraft(item.sourceIndex, ($event.target as HTMLInputElement).value)"
                                        @keydown.enter.prevent="submitQuestionOther(item)"
                                    >
                                    <button
                                        type="button"
                                        class="question-other-submit"
                                        :disabled="!otherDraftValue(item).trim() || questionSubmitting[item.sourceIndex] === true"
                                        @click="submitQuestionOther(item)"
                                    >提交</button>
                                </div>
                            </template>

                            <div v-if="isQuestionAnswered(item)" class="question-card-answer">
                                Your answer: {{ lockedAnswerText(item) }}
                            </div>
                        </div>
                    </div>

                    <template v-else-if="item.kind === 'tool'" :key="`tool-${item.sourceIndex}`">
                        <div
                            class="tool-usage execution-flow-item"
                            :class="{ expanded: isToolExpanded(item), 'has-output': item.hasOutput, 'is-running': item.running }"
                            :data-flow-kind="item.flowKind"
                        >
                            <div class="tool-badge execution-flow-header" @click="toggleTool(item)">
                                <span class="execution-flow-node" aria-hidden="true">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                                </span>
                                <span class="execution-flow-main">
                                    <span class="tool-name execution-flow-title" :title="item.rawName">{{ item.title }}</span>
                                </span>
                                <span class="tool-status execution-flow-summary">{{ item.status }}</span>
                                <span class="tool-toggle" aria-hidden="true">▸</span>
                            </div>
                            <div class="tool-output" :class="{ 'tool-output-markdown': item.markdownMode }">
                                <MarkdownView v-if="item.markdownMode && item.outputText" :content="item.outputText" />
                                <template v-else>{{ item.outputText }}</template>
                            </div>
                        </div>

                        <!-- 地图工具:独立渲染交互地图卡片(渲染器自动扫描 ```nexora-map* 围栏) -->
                        <div
                            v-if="item.mapMarkdown"
                            class="content-body generated-map-result"
                            :data-call-id="item.callId || undefined"
                        >
                            <MarkdownView :content="item.mapMarkdown" />
                        </div>
                    </template>
                </template>

                <!-- 上下文压缩卡片(对齐原版 upsertContextCompressionCard:流式/历史回放均从此渲染) -->
                <ContextCompressionCard
                    v-if="compressionStep"
                    :step="compressionStep"
                />

                <!--
                    操作栏(对齐原版:助手消息无条件提供重答/分支,不依赖正文存在,
                    思考阶段被终止的回复同样可重答;生成中隐藏整条操作栏)
                -->
                <div v-if="!streaming" class="msg-actions">
                    <!-- 版本切换器(对齐原版 buildVersionNavigation:多版本时显示 prev/next + 计数) -->
                    <div v-if="versionNav.total > 1" class="version-switcher">
                        <button
                            class="btn-ver"
                            :title="'上一版本'"
                            :disabled="versionNav.prevIndex === null"
                            @click="handleSwitchVersion(versionNav.prevIndex)"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>
                        <span>{{ versionNav.current }} / {{ versionNav.total }}</span>
                        <button
                            class="btn-ver"
                            :title="'下一版本'"
                            :disabled="versionNav.nextIndex === null"
                            @click="handleSwitchVersion(versionNav.nextIndex)"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>
                    <button v-if="message.content" class="btn-action" title="复制消息" @click="handleCopy">
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
                    <button class="btn-action" title="从这里创建分支" @click="handleFork">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="6" cy="4" r="2"></circle>
                            <circle cx="18" cy="8" r="2"></circle>
                            <circle cx="6" cy="20" r="2"></circle>
                            <path d="M6 6v12"></path>
                            <path d="M8 10h4a6 6 0 0 0 6-6"></path>
                        </svg>
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import type { ChatMessage } from '@/api/conversations'
    import type { MessageSegment } from '@/stream/messageSegments'
    import {
        buildChineseToolAction,
        buildMapResultMarkdown,
        getToolExecutionFlowKind,
        isMapToolName,
        stripMapSceneSection,
    } from '@/stream/toolFlow'
    import type { QuestionPayload } from '@/stream/questionCard'
    import { buildQuestionCardId, readQuestionLock, writeQuestionLock } from '@/stream/questionCard'
    import { ensureNexoraMapRendererAssets } from '@/stream/mapRenderer'
    import { showToast } from '@/stores/notify'
    import type { ContextCompressionStep } from '@/stream/contextCompression'
    import { resolveActiveContextCompressionStep } from '@/stream/contextCompression'
    import { hasAnyIo, readMessageIoTokens } from '@/stream/tokenBudget'

    import MarkdownView from './MarkdownView.vue'
    import ContextCompressionCard from './ContextCompressionCard.vue'

    const props = defineProps<{
        message: ChatMessage
        streaming?: boolean
        modelName?: string
        isLastUserMessage?: boolean
        /** 当前会话 ID(地图 ref 结果组装 conversation_id 用) */
        conversationId?: string
    }>()

    const emit = defineEmits<{
        delete: [message: ChatMessage]
        'edit-save': [message: ChatMessage, content: string]
        regenerate: [message: ChatMessage]
        'open-image': [url: string]
        fork: [message: ChatMessage]
        'switch-version': [message: ChatMessage, versionIndex: number]
        /** question 卡片作答:父级把回答作为普通用户消息发送 */
        'question-answer': [message: ChatMessage, questionId: string, answer: string]
    }>()

    /** 用户手动切换过的思考块折叠状态(分段索引 → 是否折叠);未手动操作的分块走自动策略 */
    const reasoningUserStates = ref<Record<number, boolean>>({})
    const badgeExpanded = ref(true)

    /** 用户手动展开过的工具徽标(分段索引 → 是否展开);默认全部收起 */
    const expandedTools = ref<Record<number, boolean>>({})

    /** 文本类渲染项(思考/正文,携带源分段索引用于折叠状态键) */
    interface TextRenderItem {
        kind: 'reasoning' | 'content'
        segment: MessageSegment
        sourceIndex: number
    }

    /** 工具行渲染项:一次调用与其结果配成一行执行流程节点(对齐原版 tool-usage 结构) */
    interface ToolRenderItem {
        kind: 'tool'
        sourceIndex: number
        callId: string
        /** 原始工具名(title 提示用) */
        rawName: string
        /** 中文动作标题(对齐原版 buildChineseToolAction) */
        title: string
        /** 流程节点分类(file/shell/web/knowledge/...),驱动节点配色 */
        flowKind: string
        status: string
        running: boolean
        hasOutput: boolean
        /** 调用参数对象(标题提取 subject/title 等字段用) */
        args: Record<string, unknown>
        /** 展开区内容:运行中为格式化参数,完成后为结果(markdown 或纯文本) */
        outputText: string
        /** 结果是否按 markdown 渲染(原版 model_visible_result 优先走 markdown) */
        markdownMode: boolean
        /** 地图工具:独立地图卡片 markdown(```nexora-map* 围栏,渲染器自动扫描) */
        mapMarkdown?: string
    }

    /** 交互问题渲染项:等待/已回答的 question 卡片 */
    interface QuestionRenderItem {
        kind: 'question'
        sourceIndex: number
        callId: string
        payload: QuestionPayload
    }

    type RenderItem = TextRenderItem | ToolRenderItem | QuestionRenderItem

    /** 参数 JSON 美化(非 JSON 文本原样展示,对齐原版 formatToolArgsForOutput) */
    function prettyToolArgs(raw: string): string {
        const text = String(raw || '').trim()

        if (!text) {
            return ''
        }

        try {
            return JSON.stringify(JSON.parse(text), null, 2)
        } catch {
            return text
        }
    }

    /** 参数 JSON 解析为对象(供中文动作标题提取 subject/title 等字段) */
    function parseToolArgsObject(raw: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(String(raw || ''))

            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
            return {}
        }
    }

    /** 文件读取类工具:结果只保留折叠摘要,不提供展开(对齐原版 isFileReadTool 规则) */
    function isFileReadToolName(rawName: string): boolean {
        return /(?:^|_)(?:local_|cloud_)?file_read$/i.test(String(rawName || ''))
    }

    /** 工具结果文本 → JSON 载荷(非 JSON 返回 null,对齐原版 parseToolResultPayload) */
    function parseToolResultPayload(raw: string): Record<string, unknown> | null {
        try {
            const parsed = JSON.parse(String(raw || ''))

            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null
        } catch {
            return null
        }
    }

    /**
     * 分段 → 渲染项:
     * 思考/正文逐段直出;function_call 开一行工具流程节点,function_result 按
     * callId 回溯配对到最近的未填结果调用行(无匹配时独立成行,不丢数据)。
     */
    const renderItems = computed<Array<RenderItem>>(() => {
        const items: Array<RenderItem> = []

        contentSegments.value.forEach((segment, sourceIndex) => {
            if (segment.type === 'function_call') {
                const rawName = segment.name || 'tool'
                const args = parseToolArgsObject(segment.text)

                items.push({
                    kind: 'tool',
                    sourceIndex,
                    callId: String(segment.callId || ''),
                    rawName,
                    // 运行中标题仅由工具名+参数决定(与原版 appendToolEvent 一致)
                    title: buildChineseToolAction(rawName, args),
                    flowKind: getToolExecutionFlowKind(rawName),
                    status: '执行中',
                    running: true,
                    hasOutput: false,
                    args,
                    outputText: prettyToolArgs(segment.text),
                    markdownMode: false,
                })

                return
            }

            if (segment.type === 'function_result') {
                const rawName = segment.name || 'tool'
                const markdownMode = String(segment.modelVisibleResult || '').trim() !== ''
                const display = markdownMode
                    ? String(segment.modelVisibleResult)
                    : String(segment.text || '')

                for (let i = items.length - 1; i >= 0; i -= 1) {
                    const candidate = items[i]

                    if (candidate.kind !== 'tool' || !candidate.running) {
                        continue
                    }

                    const callId = String(segment.callId || '')

                    if (callId && candidate.callId && candidate.callId !== callId) {
                        continue
                    }

                    applyToolResult(candidate, display, markdownMode, String(segment.text || ''))

                    return
                }

                const orphan: ToolRenderItem = {
                    kind: 'tool',
                    sourceIndex,
                    callId: String(segment.callId || ''),
                    rawName,
                    title: buildChineseToolAction(rawName, {}, display, String(segment.text || '')),
                    flowKind: getToolExecutionFlowKind(rawName),
                    status: '完成',
                    running: false,
                    hasOutput: false,
                    args: {},
                    outputText: '',
                    markdownMode: false,
                }

                applyToolResult(orphan, display, markdownMode, String(segment.text || ''))
                items.push(orphan)

                return
            }

            if (segment.type === 'question') {
                items.push({
                    kind: 'question',
                    sourceIndex,
                    callId: String(segment.callId || ''),
                    payload: (segment.question && typeof segment.question === 'object')
                        ? segment.question as QuestionPayload
                        : {},
                })

                return
            }

            items.push({ kind: segment.type, segment, sourceIndex })
        })

        return items
    })

    /** 结果落位到工具行:更新标题/状态/输出(文件读取类不提供展开,对齐原版规则) */
    function applyToolResult(item: ToolRenderItem, display: string, markdownMode: boolean, rawResult: string): void {
        item.running = false
        item.status = '完成'
        item.title = buildChineseToolAction(item.rawName, item.args, display, rawResult)
        item.markdownMode = markdownMode

        if (isFileReadToolName(item.rawName)) {
            item.outputText = ''
            item.hasOutput = false

            return
        }

        let output = display.trim() ? display : item.outputText

        // 地图工具:结果转独立交互地图卡片;输出面板去掉 ### Scene 原始段(对齐原版)
        if (isMapToolName(item.rawName)) {
            const payload = parseToolResultPayload(rawResult)

            if (payload && payload.success === true) {
                const mapMarkdown = buildMapResultMarkdown(payload, props.conversationId || '')

                if (mapMarkdown) {
                    item.mapMarkdown = mapMarkdown
                    output = stripMapSceneSection(output.trim() ? output : mapMarkdown)
                }
            }
        }

        item.outputText = output
        item.hasOutput = !!item.outputText.trim()
    }

    /**
     * 工具行展开状态:用户手动操作优先;
     * 自动策略对齐原版「新结果到达展开当前行、更早的已完成行收起」——
     * 仅最后一条已有结果的工具行默认展开。
     */
    const lastResolvedToolIndex = computed<number>(() => {
        let last = -1

        renderItems.value.forEach((item) => {
            if (item.kind === 'tool' && item.hasOutput) {
                last = item.sourceIndex
            }
        })

        return last
    })

    function isToolExpanded(item: ToolRenderItem): boolean {
        const userState = expandedTools.value[item.sourceIndex]

        if (userState !== undefined) {
            return userState
        }

        // 自动展开仅限流式进行中(执行中行可见参数、最新完成行保持展开);
        // 流结束/历史回放一律默认收起,避免刷新后工具块自动摊开
        if (!props.streaming) {
            return false
        }

        return item.running || (item.hasOutput && item.sourceIndex === lastResolvedToolIndex.value)
    }

    /** 切换工具行展开态(仅在有可看内容时生效,记录用户选择,对齐原版 bindToolUsageToggle) */
    function toggleTool(item: ToolRenderItem): void {
        if (!item.hasOutput) {
            return
        }

        expandedTools.value[item.sourceIndex] = !isToolExpanded(item)
    }

    // ---------- question 交互卡片 ----------

    /** 作答提交中(分段索引 → 防重复) */
    const questionSubmitting = ref<Record<number, boolean>>({})

    /** 其他选项输入草稿(分段索引 → 文本) */
    const questionOtherDrafts = ref<Record<number, string>>({})

    /** 回答锁版本号:提交后自增驱动已答状态重算(localStorage 读取非响应式) */
    const questionLockVersion = ref(0)

    function setOtherDraft(sourceIndex: number, value: string): void {
        questionOtherDrafts.value[sourceIndex] = value
    }

    function otherDraftValue(item: QuestionRenderItem): string {
        return String(questionOtherDrafts.value[item.sourceIndex] || '')
    }

    /** 卡片稳定 ID(question_card_id → question_id → 内容哈希) */
    function questionCardIdOf(item: QuestionRenderItem): string {
        return buildQuestionCardId(item.payload)
    }

    /** 已回答判定:载荷 resolved 标记优先,其次本地锁定存储 */
    function isQuestionAnswered(item: QuestionRenderItem): boolean {
        if (item.payload.resolved === true) {
            return true
        }

        void questionLockVersion.value

        return !!readQuestionLock(props.conversationId || '', questionCardIdOf(item))
    }

    function lockedAnswerText(item: QuestionRenderItem): string {
        if (item.payload.resolved === true) {
            return String(item.payload.answer || '').trim()
        }

        void questionLockVersion.value

        return readQuestionLock(props.conversationId || '', questionCardIdOf(item))
    }

    function isPermissionCard(item: QuestionRenderItem): boolean {
        return !!item.payload.permission_request
    }

    async function submitQuestionAnswer(item: QuestionRenderItem, answerText: string): Promise<void> {
        const answer = String(answerText || '').trim()

        if (!answer || isQuestionAnswered(item) || questionSubmitting.value[item.sourceIndex]) {
            return
        }

        questionSubmitting.value[item.sourceIndex] = true

        try {
            const qid = questionCardIdOf(item)

            writeQuestionLock(props.conversationId || '', qid, answer)

            questionLockVersion.value += 1

            emit('question-answer', props.message, qid, answer)
        } finally {
            questionSubmitting.value[item.sourceIndex] = false
        }
    }

    function submitQuestionOther(item: QuestionRenderItem): void {
        const draft = otherDraftValue(item)

        if (!draft.trim() || isQuestionAnswered(item)) {
            return
        }

        void submitQuestionAnswer(item, draft)
        setOtherDraft(item.sourceIndex, '')
    }

    /** 内容分段(顺序结构:思考与正文按输出时序交错) */
    const contentSegments = computed<MessageSegment[]>(() => {
        const segments = props.message.segments

        return Array.isArray(segments) ? segments : []
    })

    /**
     * 正在输出的思考段索引(滚动窗口标题的判定依据):
     * 仅当本消息处于流式中且最后一个分段是思考时,该思考块处于"思考中"状态。
     */
    const liveReasoningIndex = computed<number>(() => {
        if (!props.streaming) {
            return -1
        }

        const segments = contentSegments.value
        const last = segments.length > 0 ? segments[segments.length - 1] : undefined

        return last && last.type === 'reasoning' ? segments.length - 1 : -1
    })

    /**
     * 思考行折叠状态:默认恒收起(DeepSeek 风格,流式中以标题滚动窗口代替展开);
     * 用户手动点击过的块记录选择,自动策略不再覆盖。
     */
    function isReasoningCollapsed(segmentIndex: number): boolean {
        const userState = reasoningUserStates.value[segmentIndex]

        return userState !== undefined ? userState : true
    }

    /**
     * 思考行标题:流式中显示末段字符滚动窗口「思考中:…xxx」;
     * 其余状态(已完成/历史回放)显示「思考过程」。
     */
    function reasoningTitle(segment: MessageSegment, sourceIndex: number): string {
        if (!isLiveReasoning(sourceIndex)) {
            return '思考过程'
        }

        const raw = String(segment.text || '')
        const tail = raw.slice(-32).trimStart()

        return `思考中：${raw.length > 32 ? '…' : ''}${tail}`
    }

    /** 手动切换思考块折叠(记录用户选择,后续自动展开/收起策略不再覆盖该块) */
    function toggleReasoning(segmentIndex: number): void {
        reasoningUserStates.value[segmentIndex] = !isReasoningCollapsed(segmentIndex)
    }

    /** 正在输出的思考块(驱动 data-stream-live,复用原版旋转图标样式) */
    function isLiveReasoning(segmentIndex: number): boolean {
        return segmentIndex === liveReasoningIndex.value
    }

    /**
     * 正文流式尾标:仅当本条消息生成中、该段是最后一个分段且为正文时显示光标。
     * (思考行有节点脉冲/滚动窗口,工具行有执行中状态,互不打架)
     */
    const tailContentIndex = computed<number>(() => {
        if (!props.streaming) {
            return -1
        }

        const segments = contentSegments.value
        const last = segments.length > 0 ? segments[segments.length - 1] : undefined

        return last && last.type === 'content' ? segments.length - 1 : -1
    })

    function isTailContent(item: TextRenderItem): boolean {
        return item.sourceIndex === tailContentIndex.value
    }

    // 新一轮流式开始时分段被清空:重置手动折叠记录,避免旧状态影响新思考块/工具徽标
    watch(() => contentSegments.value.length, (length) => {
        if (length === 0) {
            reasoningUserStates.value = {}
            expandedTools.value = {}
        }
    })

    // 出现真实地图结果时才按需加载地图渲染器(其 observer 常驻扫描,不可无条件加载)
    const hasMapCard = computed(() => renderItems.value.some(
        (renderItem) => renderItem.kind === 'tool' && !!renderItem.mapMarkdown
    ))

    watch(hasMapCard, (present) => {
        if (present) {
            void ensureNexoraMapRendererAssets()
        }
    }, { immediate: true })

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

    /**
     * 当前生效的上下文压缩步骤:
     * 流式阶段优先读本地 compressionStep(store 由 context_compression_status 块驱动),
     * 历史回放回退到 metadata.process_steps 中的最后一条,保证重载/收尾后卡片不消失。
     */
    const compressionStep = computed<ContextCompressionStep | null>(() => {
        return resolveActiveContextCompressionStep(props.message)
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
        const tokens = readMessageIoTokens(messageMetadata())

        return hasAnyIo(tokens.round) ? tokens.round : tokens.cumulative
    })

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

    /** 从这里创建分支:通知父级发起 fork(对齐原版 fork-conversation 按钮) */
    function handleFork(): void {
        emit('fork', props.message)
    }

    /** 切换到指定历史版本(对齐原版 switchVersion:verIndex 为 null 时不触发) */
    function handleSwitchVersion(versionIndex: number | null): void {
        if (versionIndex === null || versionIndex === undefined || Number.isNaN(Number(versionIndex))) {
            return
        }

        emit('switch-version', props.message, Number(versionIndex))
    }

    interface VersionVariant {
        content: string
        timestamp: string
        __serverIndex: number
        __isCurrent: boolean
    }

    /** 历史版本列表(metadata.versions 中的有内容变体,对齐原版 rawVersions 过滤) */
    const versionVariants = computed<VersionVariant[]>(() => {
        const metadata = messageMetadata()
        const raw = metadata.versions

        if (!Array.isArray(raw)) {
            return []
        }

        const variants: VersionVariant[] = []

        raw.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                return
            }

            const record = entry as Record<string, unknown>
            const content = String(record.content || '').trim()

            if (!content) {
                return
            }

            variants.push({
                content: String(record.content || ''),
                timestamp: String(record.timestamp || ''),
                __serverIndex: index,
                __isCurrent: false,
            })
        })

        return variants
    })

    /** 版本导航信息(对齐原版 buildVersionNavigation:全部变体按时间戳排序后定位当前位次) */
    const versionNav = computed<{
        total: number
        current: number
        prevIndex: number | null
        nextIndex: number | null
    }>(() => {
        const currentVariant: VersionVariant = {
            content: props.message.content || '',
            timestamp: String(props.message.timestamp || ''),
            __serverIndex: versionVariants.value.length,
            __isCurrent: true,
        }
        const pool = [
            ...versionVariants.value,
            currentVariant,
        ]

        if (pool.length <= 1) {
            return { total: 1, current: 1, prevIndex: null, nextIndex: null }
        }

        const sorted = pool
            .map((variant, index) => ({ ...variant, __originOrder: index }))
            .sort((left, right) => {
                const leftTime = parseTimestamp(left.timestamp)
                const rightTime = parseTimestamp(right.timestamp)

                if (leftTime !== rightTime) {
                    return leftTime - rightTime
                }

                return left.__originOrder - right.__originOrder
            })
        const currentSignature = `${currentVariant.timestamp}::${currentVariant.content.slice(0, 120)}`
        let currentPosition = sorted.findIndex((variant) => {
            return `${variant.timestamp}::${variant.content.slice(0, 120)}` === currentSignature && variant.__isCurrent
        })

        if (currentPosition < 0) {
            currentPosition = sorted.length - 1
        }

        const previous = currentPosition > 0 ? sorted[currentPosition - 1] : null
        const next = currentPosition < sorted.length - 1 ? sorted[currentPosition + 1] : null

        return {
            total: sorted.length,
            current: currentPosition + 1,
            prevIndex: previous ? Number(previous.__serverIndex) : null,
            nextIndex: next ? Number(next.__serverIndex) : null,
        }
    })

    /** 解析变体时间戳(无效返回 0,对齐原版 normalizeVariantTimestamp) */
    function parseTimestamp(raw: string): number {
        const value = String(raw || '').trim()

        if (!value) {
            return 0
        }

        const parsed = Date.parse(value)

        return Number.isFinite(parsed) ? parsed : 0
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
    /* 正文流式尾标光标(DeepSeek 风格:文本末尾闪烁方块,仅合成器层动画不阻塞主线程) */
    .stream-caret {
        display: inline-block;
        width: 7px;
        height: 15px;
        margin-left: 2px;
        vertical-align: -2px;
        background: #94a3b8;
        animation: nc-caret-blink 1s steps(2, start) infinite;
    }

    @keyframes nc-caret-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
    }

    /* 版本切换器(对齐原版 style.css .version-switcher/.btn-ver) */
    .version-switcher {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 2px;
        font-size: 11px;
        color: var(--color-text-secondary);
    }

    .btn-ver {
        border: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        width: 20px;
        height: 20px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
    }

    .btn-ver:hover:not(:disabled) {
        background: var(--color-bg-sunken);
        color: var(--color-text-primary);
    }

    .btn-ver:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
</style>
