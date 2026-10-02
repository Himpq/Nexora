<template>
    <div
        ref="stageRoot"
        class="tool-stage-focus"
        :style="{ '--tool-stage-controls-bottom': `${controlsBottom}px` }"
        :class="{
            'is-focused': focused,
            'is-chat-condensed': focused && !chatVisible,
            'is-chat-expanded': focused && chatVisible,
            'has-reply-preview': focused && replyPreviewVisible,
        }"
    >
        <Transition
            name="tool-stage-focus"
            @after-enter="notifyFocusedContentResize"
            @after-leave="restoreFocusedContent"
        >
            <div v-if="focused" class="tool-stage-focus__overlay" role="region" :aria-label="activeTitle">
                <div ref="stageSurface" class="tool-stage-focus__surface"></div>
            </div>
        </Transition>

        <Teleport v-if="focused && activeControlsTarget" :to="activeControlsTarget">
            <button
                class="btn-icon tool-stage-focus__close"
                type="button"
                title="退出放大"
                aria-label="退出放大"
                @click="close('close-button')"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 6l12 12M18 6 6 18"></path>
                </svg>
            </button>
        </Teleport>

        <div ref="compactSize" class="tool-stage-focus__chat-compact-size" aria-hidden="true"></div>

        <div ref="chatDock" class="tool-stage-focus__chat-dock">
            <button
                v-if="focused"
                class="tool-stage-focus__chat-toggle"
                type="button"
                :title="expanded ? '收起聊天' : '展开聊天'"
                :aria-label="expanded ? '收起聊天' : '展开聊天'"
                :aria-expanded="expanded"
                @click="toggleChat"
            >
                <svg v-if="expanded" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4l6 6M10 4v6H4M20 20l-6-6M14 20v-6h6"></path>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 4H4v5M4 4l6 6M15 20h5v-5m0 5-6-6"></path>
                </svg>
            </button>

            <ToolStageReplyPreview
                v-if="focused"
                :active="!expanded"
                :reply="reply"
                @visibility-change="handleReplyPreviewVisibility"
            />

            <ToolStageChatContent ref="chatContent" :follow-bottom="followBottom">
                <slot />
            </ToolStageChatContent>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import ToolStageChatContent from './ToolStageChatContent.vue'
    import ToolStageReplyPreview from './ToolStageReplyPreview.vue'
    import { ToolStageChatMotion } from '@/ui/toolStageChatMotion'

    import {
        notifyToolStageResize,
        TOOL_STAGE_OPEN_EVENT,
        type ToolStageOpenRequest,
        type ToolStageReplySource,
    } from '@/ui/toolStage'

    const props = withDefaults(defineProps<{
        active?: boolean
        resetKey?: string
        reply?: ToolStageReplySource | null
        followBottom?: () => boolean
    }>(), {
        active: true,
        resetKey: '',
        reply: null,
    })

    const focused = ref(false)
    const expanded = ref(false)
    const chatVisible = ref(false)
    const chatDock = ref<HTMLDivElement | null>(null)
    const compactSize = ref<HTMLDivElement | null>(null)
    const replyPreviewVisible = ref(false)
    const chatContent = ref<InstanceType<typeof ToolStageChatContent> | null>(null)
    const activeTitle = ref('Tool')
    const activeControlsTarget = ref<HTMLElement | null>(null)
    const controlsBottom = ref(0)
    const stageRoot = ref<HTMLDivElement | null>(null)
    const stageSurface = ref<HTMLDivElement | null>(null)

    let activeContent: HTMLElement | null = null
    let activePlaceholder: HTMLDivElement | null = null
    let returnFocusTarget: HTMLElement | null = null
    let controlsObserver: ResizeObserver | null = null
    const chatMotion = new ToolStageChatMotion(
        () => chatDock.value!,
        () => compactSize.value!.getBoundingClientRect(),
        (visible) => { chatVisible.value = visible },
        () => { chatContent.value!.restoreScroll() },
    )

    /** 仅记录预览开合状态,正文增量和用户内容不写入日志。 */
    function handleReplyPreviewVisibility(visible: boolean): void {
        replyPreviewVisible.value = visible

        console.info('[ToolStageFocus] Reply preview visibility', {
            visible,
            focused: focused.value,
            expanded: expanded.value,
        })
    }

    /** 聊天面板为工具 header 留出真实高度,长标题和小屏布局变化时退出入口仍可点击。 */
    function updateControlsGeometry(): void {
        const root = stageRoot.value
        const controls = activeControlsTarget.value

        if (!focused.value || !root || !controls) {
            return
        }

        controlsBottom.value = Math.max(0, controls.getBoundingClientRect().bottom - root.getBoundingClientRect().top)
    }

    /** 工具显式提供退出按钮的容器,通用舞台不依赖具体工具或页面的 DOM 结构。 */
    function handleOpenRequest(event: Event): void {
        const request = (event as CustomEvent<ToolStageOpenRequest>).detail

        if (!props.active || !request || !(request.element instanceof HTMLElement) || !request.element.isConnected) {
            console.warn('[ToolStageFocus] Open requests require an active view and a connected HTMLElement')
            return
        }

        if (!(request.controlsTarget instanceof HTMLElement) || !request.controlsTarget.isConnected) {
            console.error('[ToolStageFocus] Open requests require a connected controls target')
            return
        }

        console.info('[ToolStageFocus] Open request', {
            contentClass: request.element.className,
            controlsClass: request.controlsTarget.className,
            triggerClass: request.trigger?.className,
            focused: focused.value,
            expanded: expanded.value,
        })

        if (activeContent === request.element) {
            close('same-tool')
            return
        }

        if (activeContent) {
            restoreContent(false)
        }

        const parent = request.element.parentElement

        if (!parent) {
            console.warn('[ToolStageFocus] The requested tool element has no parent')
            return
        }

        const bounds = request.element.getBoundingClientRect()
        const computedStyle = window.getComputedStyle(request.element)
        const placeholder = document.createElement('div')

        placeholder.className = 'tool-stage-focus__placeholder'
        placeholder.setAttribute('aria-hidden', 'true')
        placeholder.style.width = String(Math.ceil(bounds.width)) + 'px'
        placeholder.style.height = String(Math.ceil(bounds.height)) + 'px'
        placeholder.style.margin = computedStyle.margin
        parent.insertBefore(placeholder, request.element)

        activeContent = request.element
        activePlaceholder = placeholder
        returnFocusTarget = request.trigger
            ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
                ? document.activeElement
                : null)
        activeTitle.value = request.title.trim() || 'Tool'
        activeControlsTarget.value = request.controlsTarget
        chatContent.value!.rememberScroll()
        chatMotion.reset()
        replyPreviewVisible.value = false
        focused.value = true
        expanded.value = false

        void nextTick(() => {
            if (!focused.value || activeContent !== request.element) {
                return
            }

            if (!stageSurface.value) {
                console.error('[ToolStageFocus] The stage surface did not mount after an open request')
                close('missing-surface')
                return
            }

            stageSurface.value.append(request.element)
            controlsObserver!.observe(stageRoot.value!)
            controlsObserver!.observe(request.controlsTarget)
            updateControlsGeometry()
        })
    }

    function notifyFocusedContentResize(): void {
        if (activeContent) {
            notifyToolStageResize(activeContent)
        }
    }

    function restoreFocusedContent(): void {
        restoreContent()
    }

    function restoreContent(restoreFocus = true): void {
        const content = activeContent

        if (!content) {
            return
        }

        if (activePlaceholder?.isConnected) {
            activePlaceholder.replaceWith(content)
        }
        else {
            content.remove()
        }

        activeContent = null
        activePlaceholder = null
        activeControlsTarget.value = null
        controlsObserver?.disconnect()
        controlsBottom.value = 0

        notifyToolStageResize(content)

        const focusTarget = returnFocusTarget
        returnFocusTarget = null

        if (restoreFocus && focusTarget?.isConnected) {
            focusTarget.focus({ preventScroll: true })
        }
    }

    /** 记录实际触发聊天收起的点击,用于区分 ring 点击与展开按钮命中。 */
    function toggleChat(event: MouseEvent): void {
        expanded.value = !expanded.value

        if (!expanded.value) {
            chatContent.value!.rememberScroll()
        }

        void chatMotion.setExpanded(expanded.value)

        console.info('[ToolStageFocus] Chat toggled', {
            expanded: expanded.value,
            targetTag: (event.target as Element).tagName,
            clientX: event.clientX,
            clientY: event.clientY,
        })
    }

    /** 带原因记录舞台关闭,定位视图/会话变化导致的意外收起。 */
    function close(reason: string): void {
        if (!focused.value) {
            return
        }

        console.info('[ToolStageFocus] Stage closed', {
            reason,
            expanded: expanded.value,
        })

        if (chatVisible.value && reason !== 'conversation-change') {
            chatContent.value!.rememberScroll()
        }

        focused.value = false
        expanded.value = false
        chatMotion.reset()
        replyPreviewVisible.value = false

        if (reason !== 'conversation-change') {
            void nextTick(() => {

                if (!focused.value) {
                    chatContent.value?.restoreScroll()
                }
            })
        }
    }

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || !focused.value) {
            return
        }

        event.preventDefault()
        event.stopPropagation()
        close('escape')
    }

    watch(() => props.active, (active) => {
        if (!active) {
            close('inactive-view')
        }
    })

    watch(() => props.resetKey, () => {
        close('conversation-change')
        chatContent.value?.resetScroll()
    })

    onMounted(() => {
        controlsObserver = new ResizeObserver(updateControlsGeometry)
        window.addEventListener(TOOL_STAGE_OPEN_EVENT, handleOpenRequest)
        window.addEventListener('keydown', handleWindowKeydown)
    })

    onBeforeUnmount(() => {
        chatMotion.reset()
        controlsObserver?.disconnect()
        window.removeEventListener(TOOL_STAGE_OPEN_EVENT, handleOpenRequest)
        window.removeEventListener('keydown', handleWindowKeydown)
        focused.value = false
        restoreContent()
    })
</script>
