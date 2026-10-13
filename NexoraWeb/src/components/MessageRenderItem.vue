<!--
    MessageRenderItem.vue — 单个渲染项的模板(从 MessageItem 抽出)

    抽出目的:让「过程区折叠容器」只包住过程项,最终回复渲染在容器之外。
    否则容器 `grid-template-rows: 0fr` 塌陷时会把最终回复一起隐藏。

    状态与方法由父组件通过 provide 注入(见 MESSAGE_ITEM_RENDER_KEY),
    避免十几个 props 回调穿透。
-->

<template>
    <!-- 上下文压缩卡片:append 到内容流末尾 -->
    <ContextCompressionCard
        v-if="item.kind === 'compression'"
        :step="item.step"
    />

    <!-- Modified Injection 卡片:仅 NexoraCode 本地模式渲染;
         网页版后端不发 context_injection,此门控保证网页版渲染路径不变。 -->
    <ContextInjectionCard
        v-else-if="item.kind === 'injection' && ctx.nexoracode"
        :step="item.step"
    />

    <div
        v-else-if="item.kind === 'reasoning'"
        class="thinking-block reasoning-thinking-block execution-flow-item"
        :class="{ collapsed: ctx.isReasoningCollapsed(item.sourceIndex), 'is-live': ctx.isLiveReasoning(item.sourceIndex) }"
    >
        <div class="thinking-header execution-flow-header" @click="ctx.toggleReasoning(item.sourceIndex)">
            <span class="execution-flow-node thinking-flow-node" aria-hidden="true"></span>
            <span class="execution-flow-main">
                <span
                    class="thinking-title execution-flow-title"
                    :ref="(el: unknown) => ctx.setReasoningTitleRef(item.sourceIndex, el)"
                >{{ ctx.reasoningTitle(item.segment, item.sourceIndex) }}</span>
            </span>
            <i class="fa-solid fa-chevron-down chevron-icon" aria-hidden="true"></i>
        </div>
        <div class="thinking-content">
            <MarkdownView
                :content="item.segment.text"
                @knowledge-reference="ctx.handleKnowledgeReference"
            />
            <!-- 展开态左下角收起按钮:与标题栏切换同一折叠状态 -->
            <button
                type="button"
                class="thinking-collapse-btn"
                title="收起思考过程"
                @click="ctx.toggleReasoning(item.sourceIndex)"
            >
                <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
                <span>收起</span>
            </button>
        </div>
    </div>

    <div v-else-if="item.kind === 'content'" class="content-body" :class="{ 'is-streaming-tail': ctx.isTailContent(item) }">
        <MarkdownView
            :content="item.segment.text"
            raw-html-mode="interactive"
            :interactive-html-ready="ctx.interactiveHtmlReady"
            @knowledge-reference="ctx.handleKnowledgeReference"
        />
        <span v-if="ctx.isTailContent(item)" class="stream-caret" aria-hidden="true"></span>
    </div>

    <!--
        交互问题卡片(question / ask_for_permission):
        等待回答时可选选项或自由输入;提交后锁定并作为普通消息发送;
        回答态持久化(localStorage nexora_question_locks_v1,与原版互操作)。
    -->
    <div
        v-else-if="item.kind === 'question'"
        class="question-tool-card"
        :data-question-card-id="ctx.questionCardIdOf(item)"
    >
        <div class="question-card-body" :class="{ answered: ctx.isQuestionAnswered(item) }">
            <div class="question-card-topline">
                <span class="question-card-kicker">{{ ctx.isPermissionCard(item) ? '权限请求' : '提问' }}</span>
                <span class="question-card-pill" :class="{ answered: ctx.isQuestionAnswered(item) }">
                    {{ ctx.isQuestionAnswered(item) ? '已回答' : (ctx.isPermissionCard(item) ? '等待授权' : '等待回答') }}
                </span>
            </div>

            <div class="question-card-title">{{ item.payload.question_title || '问题' }}</div>
            <div class="question-card-content">{{ item.payload.question_content }}</div>

            <!--
                readonly 只挡云端会话的删除/重答/分叉,不挡问卡作答:
                远程会话的答案由父组件转给电脑端(见 RemoteTaskPanel 的
                answer-question),把它一起藏掉会让权限请求永远无法授权。
            -->
            <template v-if="!ctx.isQuestionAnswered(item)">
                <div v-if="(item.payload.choices || []).length" class="question-card-choices">
                    <button
                        v-for="(choice, choiceIndex) in item.payload.choices"
                        :key="choiceIndex"
                        type="button"
                        class="question-choice-btn"
                        :disabled="ctx.questionSubmitting[item.sourceIndex] === true"
                        @click="ctx.submitQuestionAnswer(item, String(choice))"
                    >{{ choice }}</button>
                </div>

                <div v-if="item.payload.allow_other !== false" class="question-card-other">
                    <input
                        class="question-other-input"
                        type="text"
                        placeholder="其他…"
                        :value="ctx.otherDraftValue(item)"
                        :disabled="ctx.questionSubmitting[item.sourceIndex] === true"
                        @input="ctx.setOtherDraft(item.sourceIndex, ($event.target as HTMLInputElement).value)"
                        @keydown.enter.prevent="ctx.submitQuestionOther(item)"
                    >
                    <button
                        type="button"
                        class="question-other-submit"
                        :disabled="!ctx.otherDraftValue(item).trim() || ctx.questionSubmitting[item.sourceIndex] === true"
                        @click="ctx.submitQuestionOther(item)"
                    >提交</button>
                </div>
            </template>

            <div v-if="ctx.isQuestionAnswered(item)" class="question-card-answer">
                Your answer: {{ ctx.lockedAnswerText(item) }}
            </div>
        </div>
    </div>

    <template v-else-if="item.kind === 'tool'">
        <!-- Workspace 草稿:内联小卡片,参数流式期间逐步呈现标题与正文,像正文内容一样直接展示 -->
        <div v-if="item.draft" class="draft-call-card" :data-call-id="item.callId || undefined">
            <div class="draft-call-head">
                <span class="draft-call-icon"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></span>
                <span class="draft-call-kicker">草稿</span>
                <span class="draft-call-title">{{ item.draft.title || '正在记录草稿…' }}</span>
                <span class="draft-call-state" :class="`is-${item.draft.state}`">
                    <i v-if="item.draft.state === 'streaming'" class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                    <i v-else-if="item.draft.state === 'success'" class="fa-solid fa-check" aria-hidden="true"></i>
                    <i v-else-if="item.draft.state === 'failed'" class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <span>{{ draftCallStateText(item.draft) }}</span>
                </span>
            </div>
            <MarkdownView
                v-if="item.draft.content"
                class="draft-call-content"
                :content="item.draft.content"
                @knowledge-reference="ctx.handleKnowledgeReference"
            />
            <div v-if="item.draft.state === 'failed' && item.draft.message" class="draft-call-error">{{ item.draft.message }}</div>
        </div>

        <div
            v-else
            class="tool-usage execution-flow-item"
            :class="{ expanded: ctx.isToolExpanded(item), 'has-output': item.hasOutput, 'is-running': item.running }"
            :data-flow-kind="item.flowKind"
        >
            <div class="tool-badge execution-flow-header" @click="ctx.toggleTool(item)">
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
                <MarkdownView
                    v-if="item.markdownMode && item.outputText"
                    :content="item.outputText"
                    @knowledge-reference="ctx.handleKnowledgeReference"
                />
                <template v-else>{{ item.outputText }}</template>
            </div>
        </div>

        <!-- Exa 图片直接贴在搜索工具行下方，不增加标题/数量/说明 -->
        <ExaImageGallery
            v-if="item.exaImageGallery"
            :gallery="item.exaImageGallery"
            @open-image="ctx.emitOpenImage($event)"
        />

        <GeneratedImageGallery
            v-if="item.generatedImageGallery"
            :gallery="item.generatedImageGallery"
            @open-image="ctx.emitOpenImage($event)"
        />

        <!-- 地图工具:独立渲染交互地图卡片(渲染器自动扫描 ```nexora-map* 围栏) -->
        <div
            v-if="item.mapMarkdown"
            class="content-body generated-map-result"
            :data-call-id="item.callId || undefined"
        >
            <MarkdownView
                :content="item.mapMarkdown"
                @knowledge-reference="ctx.handleKnowledgeReference"
            />
        </div>
    </template>
</template>

<script setup lang="ts">
    import { inject } from 'vue'

    import MarkdownView from './MarkdownView.vue'
    import ContextCompressionCard from './ContextCompressionCard.vue'
    import ContextInjectionCard from './ContextInjectionCard.vue'
    import ExaImageGallery from './ExaImageGallery.vue'
    import GeneratedImageGallery from './GeneratedImageGallery.vue'

    import { draftCallStateText } from '@/stream/draftCall'
    import { MESSAGE_ITEM_RENDER_KEY, type MessageItemRenderContext, type RenderItem } from './messageItemRenderContext'

    defineProps<{ item: RenderItem }>()

    const ctx = inject(MESSAGE_ITEM_RENDER_KEY) as MessageItemRenderContext
</script>

<style scoped>
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
</style>
