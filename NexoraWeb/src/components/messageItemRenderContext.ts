/**
 * messageItemRenderContext.ts — MessageItem 与 MessageRenderItem 之间的渲染上下文
 *
 * 抽出背景:
 *   过程区折叠要求「最终回复」渲染在折叠容器之外,否则容器塌陷会把它一起隐藏。
 *   为此把渲染项模板抽成 MessageRenderItem 子组件,由父组件用两个循环分别渲染
 *   过程项(容器内)与最终回复(容器外)。
 *
 *   渲染项需要父组件的大量状态与方法(折叠状态、问卡作答、地图/图片回调等),
 *   逐个走 props 会形成十几个回调穿透,故用 provide/inject 传一个上下文对象。
 */

import type { InjectionKey } from 'vue'

import type { MessageSegment } from '@/stream/messageSegments'
import type { QuestionPayload } from '@/stream/questionCard'
import type { ContextCompressionStep } from '@/stream/contextCompression'
import type { ContextInjectionStep } from '@/stream/contextInjection'
import type { ExaImageGalleryData } from '@/stream/exaMedia'
import type { GeneratedImageGalleryData } from '@/stream/generatedImage'
import type { DraftCallView } from '@/stream/draftCall'
import type { KnowledgeReference } from '@/stream/knowledgeReferences'

/** 文本类渲染项(思考/正文,携带源分段索引用于折叠状态键) */
export interface TextRenderItem {
    kind: 'reasoning' | 'content'
    segment: MessageSegment
    sourceIndex: number
}

/** 工具行渲染项:一次调用与其结果配成一行执行流程节点(对齐原版 tool-usage 结构) */
export interface ToolRenderItem {
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
    /** Exa 工具:搜索行下方的独立图片画廊 */
    exaImageGallery?: ExaImageGalleryData
    /** 生图工具:生成行下方的独立图片画廊 */
    generatedImageGallery?: GeneratedImageGalleryData
    /** Workspace 草稿工具:内联小卡片视图(参数流式呈现,替代折叠工具行) */
    draft?: DraftCallView
}

/** 交互问题渲染项:等待/已回答的 question 卡片 */
export interface QuestionRenderItem {
    kind: 'question'
    sourceIndex: number
    callId: string
    payload: QuestionPayload
}

/** 上下文压缩卡片渲染项:按 append 语义追加到内容流末尾 */
export interface CompressionRenderItem {
    kind: 'compression'
    sourceIndex: number
    step: ContextCompressionStep
}

/** Modified Injection 卡片渲染项:同样按 append 语义追加到内容流末尾 */
export interface InjectionRenderItem {
    kind: 'injection'
    sourceIndex: number
    step: ContextInjectionStep
}

export type RenderItem =
    | TextRenderItem
    | ToolRenderItem
    | QuestionRenderItem
    | CompressionRenderItem
    | InjectionRenderItem

/** 子组件渲染所需的状态与方法(由 MessageItem 提供) */
export interface MessageItemRenderContext {
    nexoracode: boolean
    interactiveHtmlReady: boolean
    questionSubmitting: Record<number, boolean>

    isReasoningCollapsed: (segmentIndex: number) => boolean
    isLiveReasoning: (segmentIndex: number) => boolean
    toggleReasoning: (segmentIndex: number) => void
    reasoningTitle: (segment: MessageSegment, sourceIndex: number) => string
    setReasoningTitleRef: (segmentIndex: number, el: unknown) => void

    isTailContent: (item: TextRenderItem) => boolean

    isToolExpanded: (item: ToolRenderItem) => boolean
    toggleTool: (item: ToolRenderItem) => void

    isQuestionAnswered: (item: QuestionRenderItem) => boolean
    isPermissionCard: (item: QuestionRenderItem) => boolean
    questionCardIdOf: (item: QuestionRenderItem) => string
    lockedAnswerText: (item: QuestionRenderItem) => string
    otherDraftValue: (item: QuestionRenderItem) => string
    setOtherDraft: (sourceIndex: number, value: string) => void
    submitQuestionAnswer: (item: QuestionRenderItem, answer: string) => void
    submitQuestionOther: (item: QuestionRenderItem) => void

    handleKnowledgeReference: (reference: KnowledgeReference) => void
    emitOpenImage: (url: string) => void
}

export const MESSAGE_ITEM_RENDER_KEY: InjectionKey<MessageItemRenderContext> =
    Symbol('message-item-render-context')
