(function () {
    'use strict';

    const MODULE_NAME = 'streamReconnect';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Stream Reconnect 模块');
        }

        return shared;
    }

    function requireReconnectDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_stream_reconnect 缺少依赖: ${name}`);
        }

        return value;
    }

    function createStreamReconnectController(deps = {}) {
        const getMessagesContainer = requireReconnectDependency(deps, 'getMessagesContainer');
        const getConversationTitleElement = requireReconnectDependency(deps, 'getConversationTitleElement');
        const getCurrentConversationId = requireReconnectDependency(deps, 'getCurrentConversationId');
        const setCurrentConversationId = requireReconnectDependency(deps, 'setCurrentConversationId');
        const getIsGenerating = requireReconnectDependency(deps, 'getIsGenerating');
        const getCurrentAbortController = requireReconnectDependency(deps, 'getCurrentAbortController');
        const setCurrentAbortController = requireReconnectDependency(deps, 'setCurrentAbortController');
        const getCurrentConversationMode = requireReconnectDependency(deps, 'getCurrentConversationMode');
        const getCurrentConversationLongtermState = requireReconnectDependency(deps, 'getCurrentConversationLongtermState');
        const setCurrentConversationLongtermState = requireReconnectDependency(deps, 'setCurrentConversationLongtermState');
        const getShouldAutoScroll = requireReconnectDependency(deps, 'getShouldAutoScroll');
        const getTokenMiniStreamOutput = requireReconnectDependency(deps, 'getTokenMiniStreamOutput');
        const getTokenMiniEstimatedStreamOutput = requireReconnectDependency(deps, 'getTokenMiniEstimatedStreamOutput');
        const loadActiveStreamResumeState = requireReconnectDependency(deps, 'loadActiveStreamResumeState');
        const patchActiveStreamResumeState = requireReconnectDependency(deps, 'patchActiveStreamResumeState');
        const clearActiveStreamResumeState = requireReconnectDependency(deps, 'clearActiveStreamResumeState');
        const normalizeStreamMessageIndex = requireReconnectDependency(deps, 'normalizeStreamMessageIndex');
        const readStreamRegenerateFlag = requireReconnectDependency(deps, 'readStreamRegenerateFlag');
        const readStreamAssistantIndexFromMeta = requireReconnectDependency(deps, 'readStreamAssistantIndexFromMeta');
        const readStreamRegenerateIndexFromMeta = requireReconnectDependency(deps, 'readStreamRegenerateIndexFromMeta');
        const stripHistoryTimeMarkerEchoForStream = requireReconnectDependency(deps, 'stripHistoryTimeMarkerEchoForStream');
        const getConversationStreamState = requireReconnectDependency(deps, 'getConversationStreamState');
        const setConversationStreamState = requireReconnectDependency(deps, 'setConversationStreamState');
        const moveConversationStreamState = requireReconnectDependency(deps, 'moveConversationStreamState');
        const markConversationStreamFinished = requireReconnectDependency(deps, 'markConversationStreamFinished');
        const isTerminalStreamSessionChunk = requireReconnectDependency(deps, 'isTerminalStreamSessionChunk');
        const shouldAutoAttachDetachedStream = requireReconnectDependency(deps, 'shouldAutoAttachDetachedStream');
        const attachDetachedStreamConsumer = requireReconnectDependency(deps, 'attachDetachedStreamConsumer');
        const loadConversation = requireReconnectDependency(deps, 'loadConversation');
        const loadConversations = requireReconnectDependency(deps, 'loadConversations');
        const loadKnowledge = requireReconnectDependency(deps, 'loadKnowledge');
        const syncNotesForConversation = requireReconnectDependency(deps, 'syncNotesForConversation');
        const noteTokenMiniConversationId = requireReconnectDependency(deps, 'noteTokenMiniConversationId');
        const syncGenerationStateForCurrentConversation = requireReconnectDependency(deps, 'syncGenerationStateForCurrentConversation');
        const syncLocalConversationModeFlags = requireReconnectDependency(deps, 'syncLocalConversationModeFlags');
        const beginTokenMiniStreaming = requireReconnectDependency(deps, 'beginTokenMiniStreaming');
        const finishTokenMiniStreaming = requireReconnectDependency(deps, 'finishTokenMiniStreaming');
        const applyRegenerateStreamDomWindow = requireReconnectDependency(deps, 'applyRegenerateStreamDomWindow');
        const appendMessage = requireReconnectDependency(deps, 'appendMessage');
        const resetAssistantMessageForLiveStream = requireReconnectDependency(deps, 'resetAssistantMessageForLiveStream');
        const createContentSpan = requireReconnectDependency(deps, 'createContentSpan');
        const createThinkingBlock = requireReconnectDependency(deps, 'createThinkingBlock');
        const resolveReasoningThinkingBlockForAppend = requireReconnectDependency(deps, 'resolveReasoningThinkingBlockForAppend');
        const markReasoningThinkingBlockLive = requireReconnectDependency(deps, 'markReasoningThinkingBlockLive');
        const readReasoningContentRaw = requireReconnectDependency(deps, 'readReasoningContentRaw');
        const buildReasoningAppendText = requireReconnectDependency(deps, 'buildReasoningAppendText');
        const updateThinkingBlockSummary = requireReconnectDependency(deps, 'updateThinkingBlockSummary');
        const renderStreamingMarkdownWithNewTabLinks = requireReconnectDependency(deps, 'renderStreamingMarkdownWithNewTabLinks');
        const renderMarkdownWithNewTabLinks = requireReconnectDependency(deps, 'renderMarkdownWithNewTabLinks');
        const bindSourceMarkdown = requireReconnectDependency(deps, 'bindSourceMarkdown');
        const highlightCode = requireReconnectDependency(deps, 'highlightCode');
        const replayStreamPrefillChunks = requireReconnectDependency(deps, 'replayStreamPrefillChunks');
        const updateMessageDivTools = requireReconnectDependency(deps, 'updateMessageDivTools');
        const appendLearningCardStep = requireReconnectDependency(deps, 'appendLearningCardStep');
        const appendQuestionStep = requireReconnectDependency(deps, 'appendQuestionStep');
        const appendPuzzleStep = requireReconnectDependency(deps, 'appendPuzzleStep');
        const rememberToolArgsDeltaSeen = requireReconnectDependency(deps, 'rememberToolArgsDeltaSeen');
        const hasToolArgsDeltaSeen = requireReconnectDependency(deps, 'hasToolArgsDeltaSeen');
        const yieldToolStreamPaintForChunk = requireReconnectDependency(deps, 'yieldToolStreamPaintForChunk');
        const appendDebugTraceChunk = requireReconnectDependency(deps, 'appendDebugTraceChunk');
        const appendErrorEvent = requireReconnectDependency(deps, 'appendErrorEvent');
        const renderAssistantTerminalErrorMessage = requireReconnectDependency(deps, 'renderAssistantTerminalErrorMessage');
        const renderConversationSnapshotFromServer = requireReconnectDependency(deps, 'renderConversationSnapshotFromServer');
        const getStreamingModelBadgeName = requireReconnectDependency(deps, 'getStreamingModelBadgeName');
        const updateMessageModelBadge = requireReconnectDependency(deps, 'updateMessageModelBadge');
        const syncStreamingModelBadgeEstimate = requireReconnectDependency(deps, 'syncStreamingModelBadgeEstimate');
        const finalizeMessageRenderForIndex = requireReconnectDependency(deps, 'finalizeMessageRenderForIndex');
        const collapseReasoningBlocksForMessage = requireReconnectDependency(deps, 'collapseReasoningBlocksForMessage');
        const applyLongtermPlanFromText = requireReconnectDependency(deps, 'applyLongtermPlanFromText');
        const normalizeLongtermState = requireReconnectDependency(deps, 'normalizeLongtermState');
        const renderLongtermPlanPanel = requireReconnectDependency(deps, 'renderLongtermPlanPanel');
        const applyPromptTokenProfileChunk = requireReconnectDependency(deps, 'applyPromptTokenProfileChunk');
        const onTokenStreamTextChunk = requireReconnectDependency(deps, 'onTokenStreamTextChunk');
        const onTokenStreamReasoningChunk = requireReconnectDependency(deps, 'onTokenStreamReasoningChunk');
        const onTokenStreamToolArgsChunk = requireReconnectDependency(deps, 'onTokenStreamToolArgsChunk');
        const onTokenStreamUsageChunk = requireReconnectDependency(deps, 'onTokenStreamUsageChunk');
        const safeTokenInt = requireReconnectDependency(deps, 'safeTokenInt');
        const pinMessagesToBottomFor = requireReconnectDependency(deps, 'pinMessagesToBottomFor');
        const scheduleLearningSidebarBridgeNotify = requireReconnectDependency(deps, 'scheduleLearningSidebarBridgeNotify');
        const showToast = requireReconnectDependency(deps, 'showToast');
        const isLikelyRetryableNetworkErrorText = requireReconnectDependency(deps, 'isLikelyRetryableNetworkErrorText');
        const waitForStreamServerFinalized = requireReconnectDependency(deps, 'waitForStreamServerFinalized');

        let streamResumeRestoredOnce = false;

        function readCurrentConversationId() {
            return String(getCurrentConversationId() || '').trim();
        }

        function getCurrentStreamOutputTokens() {
            return safeTokenInt(getTokenMiniStreamOutput());
        }

        function getCurrentEstimatedStreamOutputTokens() {
            return safeTokenInt(getTokenMiniEstimatedStreamOutput());
        }

        function resolveAssistantIndexForStreamResume(state, fallbackIndex = null) {
            const src = (state && typeof state === 'object') ? state : {};
            const directIndex = normalizeStreamMessageIndex(src.assistant_index)
                ?? (src.is_regenerate ? normalizeStreamMessageIndex(src.regenerate_index) : null);

            if (directIndex !== null) {
                return directIndex;
            }

            const streamId = String(src.stream_id || '').trim();
            const messagesContainer = getMessagesContainer();

            if (streamId && messagesContainer) {
                const byStreamId = Array.from(messagesContainer.querySelectorAll('.message.assistant'))
                    .find((row) => String(row && row.dataset ? row.dataset.streamId || '' : '').trim() === streamId) || null;
                const streamIndex = byStreamId && byStreamId.dataset
                    ? normalizeStreamMessageIndex(byStreamId.dataset.index)
                    : null;

                if (streamIndex !== null) {
                    return streamIndex;
                }
            }

            return normalizeStreamMessageIndex(fallbackIndex);
        }

        function findLatestAppendableStreamContentBody(messageDiv) {
            if (!messageDiv) return null;

            const bodies = Array.from(messageDiv.querySelectorAll('.content-body')).filter((node) => {
                return node
                    && !node.classList.contains('generated-image-result')
                    && !node.classList.contains('generated-map-result');
            });

            if (!bodies.length) return null;

            return bodies[bodies.length - 1];
        }

        function prepareLatestContentBodyForStreamResume(messageDiv) {
            const body = findLatestAppendableStreamContentBody(messageDiv);
            if (!body) return null;

            const raw = String(
                body.dataset.streamRaw
                || body.__sourceMarkdown
                || ''
            );

            if (!raw) {
                console.warn('[StreamResume] existing content body has no markdown source', {
                    conversation_id: readCurrentConversationId(),
                    message_index: messageDiv && messageDiv.dataset ? String(messageDiv.dataset.index || '') : ''
                });
                return null;
            }

            body.dataset.streamLive = '1';
            body.dataset.streamRaw = raw;
            bindSourceMarkdown(body, raw);
            return body;
        }

        function getLatestLiveStreamResumeNode(messageDiv) {
            if (!messageDiv) {
                return { type: '', node: null };
            }

            const root = messageDiv.querySelector('.message-content') || messageDiv;
            const candidates = [];

            root.querySelectorAll('.content-body, .thinking-block.reasoning-thinking-block').forEach((node) => {
                if (!node) return;

                if (node.classList.contains('content-body')) {
                    if (String(node.dataset.streamLive || '') === '1') {
                        candidates.push({ type: 'content', node });
                    }

                    return;
                }

                const content = node.querySelector('.thinking-content');
                const live = String(node.dataset.streamLive || '') === '1'
                    || !!(content && String(content.dataset.streamLive || '') === '1');

                if (live) {
                    candidates.push({ type: 'reasoning', node });
                }
            });

            return candidates.length > 0
                ? candidates[candidates.length - 1]
                : { type: '', node: null };
        }

        function prepareLatestThinkingBlockForStreamResume(messageDiv, preferredBlock = null) {
            if (!messageDiv) return null;

            let thinkingBlock = preferredBlock
                && preferredBlock.isConnected
                && preferredBlock.classList.contains('reasoning-thinking-block')
                ? preferredBlock
                : null;

            if (!thinkingBlock) {
                const latest = getLatestLiveStreamResumeNode(messageDiv);
                thinkingBlock = latest.type === 'reasoning' ? latest.node : null;
            }

            if (!thinkingBlock) return null;

            const contentDiv = thinkingBlock.querySelector('.thinking-content');
            if (!contentDiv) return null;

            const raw = String(
                contentDiv.dataset.streamRaw
                || contentDiv.dataset.rawText
                || (typeof contentDiv.__sourceMarkdown === 'string' ? contentDiv.__sourceMarkdown : '')
                || contentDiv.textContent
                || ''
            );

            contentDiv.dataset.streamRaw = raw;
            markReasoningThinkingBlockLive(thinkingBlock);
            messageDiv.__activeReasoningThinkingBlock = thinkingBlock;
            messageDiv.__reasoningSegmentOpen = true;
            updateThinkingBlockSummary(thinkingBlock, raw);

            return thinkingBlock;
        }

        async function resumeActiveStreamAfterReload(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const forceResume = !!opts.force;

            if (!forceResume) {
                if (streamResumeRestoredOnce) return;
                streamResumeRestoredOnce = true;
            }

            const providedState = (opts.state && typeof opts.state === 'object') ? opts.state : null;
            const state = providedState || loadActiveStreamResumeState();
            if (!state || !state.stream_id) return;
            if (!forceResume && getIsGenerating() && getCurrentAbortController()) return;

            const updatedAt = Number(state.updated_at || 0);
            if (updatedAt > 0 && (Date.now() - updatedAt) > (2 * 60 * 60 * 1000)) {
                clearActiveStreamResumeState();
                return;
            }

            const targetConversationId = String(opts.conversationId || state.conversation_id || '').trim();
            if (targetConversationId && readCurrentConversationId() !== targetConversationId) {
                if (opts.allowSwitch === false) {
                    return;
                }

                await loadConversation(targetConversationId, { deferStreamAttach: true });
            }

            const reconnectBoundConversationId = String(targetConversationId || readCurrentConversationId() || '').trim();
            let reconnectStreamConversationId = reconnectBoundConversationId;
            setConversationStreamState(reconnectStreamConversationId, {
                ...state,
                status: 'running',
                unread: false,
                stopping: false
            });

            let assistantIndex = resolveAssistantIndexForStreamResume(state);

            if (assistantIndex === null) {
                const messagesContainer = getMessagesContainer();
                const pendingAssistants = messagesContainer
                    ? Array.from(messagesContainer.querySelectorAll('.message.assistant.pending, .message.assistant[data-local-only="1"]'))
                    : [];
                const pendingAssistant = pendingAssistants.length > 0 ? pendingAssistants[pendingAssistants.length - 1] : null;
                const pendingIndex = pendingAssistant && pendingAssistant.dataset
                    ? normalizeStreamMessageIndex(pendingAssistant.dataset.index)
                    : null;

                if (pendingIndex !== null) {
                    assistantIndex = pendingIndex;
                    setConversationStreamState(reconnectStreamConversationId, {
                        assistant_index: assistantIndex
                    });
                    patchActiveStreamResumeState({
                        assistant_index: assistantIndex
                    });
                    console.debug('[StreamResume] recovered assistant index from pending DOM', {
                        conversation_id: reconnectBoundConversationId,
                        stream_id: String(state.stream_id || ''),
                        assistant_index: assistantIndex
                    });
                }
            }

            if (assistantIndex === null) {
                const messagesContainer = getMessagesContainer();
                const rows = messagesContainer
                    ? Array.from(messagesContainer.querySelectorAll('.message'))
                    : [];
                const lastRow = rows.length ? rows[rows.length - 1] : null;
                const lastAssistantIndex = lastRow && lastRow.classList.contains('assistant')
                    ? normalizeStreamMessageIndex(lastRow.dataset.index)
                    : null;
                assistantIndex = lastAssistantIndex !== null ? lastAssistantIndex : rows.length;
                console.warn('[StreamResume] assistant index missing; using append position', {
                    conversation_id: reconnectBoundConversationId,
                    stream_id: String(state.stream_id || ''),
                    assistant_index: assistantIndex
                });
            }

            if (state.is_regenerate) {
                applyRegenerateStreamDomWindow(reconnectBoundConversationId, assistantIndex);
            }

            let assistantDiv = document.querySelector(`.message.assistant[data-index="${assistantIndex}"]`);
            const hasExistingStreamContent = assistantDiv && assistantDiv.querySelector(
                '.content-body[data-stream-live="1"], .thinking-content[data-stream-live="1"]'
            );
            // 只有 live DOM 才能续写；历史快照里的旧回答必须由流缓冲重建，不能继续拼接。
            const canReuseExistingContent = !!hasExistingStreamContent;
            let resumeFromSeq = canReuseExistingContent
                ? (Number.isFinite(Number(state.last_seq)) ? Number(state.last_seq) : 0)
                : 0;
            let prefilledFromApi = false;
            let prefillEndedWithContent = canReuseExistingContent;

            if (!assistantDiv) {
                assistantDiv = appendMessage({ role: 'assistant', content: '', pending: true }, assistantIndex);
            }

            if (!assistantDiv) {
                clearActiveStreamResumeState();
                return;
            }

            assistantDiv.dataset.streamId = String(state.stream_id || '');

            if (canReuseExistingContent) {
                assistantDiv.classList.add('pending');
            } else {
                resetAssistantMessageForLiveStream(assistantDiv, {
                    modelBadgeState: {
                        modelName: getStreamingModelBadgeName(),
                        searchFlag: 'unknown',
                        inputTokens: 0,
                        outputTokens: 0
                    }
                });

                // 服务端快照无流式内容，尝试从流缓冲区获取累积内容。
                if (state.stream_id) {
                    try {
                        const accRes = await fetch(`/api/chat/stream/content?stream_id=${encodeURIComponent(state.stream_id)}`);
                        const accData = await accRes.json().catch(() => ({}));
                        const prefillResult = replayStreamPrefillChunks(
                            assistantDiv,
                            accData && Array.isArray(accData.render_chunks) ? accData.render_chunks : [],
                            assistantIndex
                        );

                        if (prefillResult.rendered) {
                            resumeFromSeq = Number.isFinite(Number(accData.last_seq))
                                ? Number(accData.last_seq)
                                : prefillResult.lastSeq;
                            prefilledFromApi = true;
                            prefillEndedWithContent = !!prefillResult.endedWithContent;
                        }

                        if (!prefillResult.rendered && accData && accData.success && accData.content) {
                            const content = assistantDiv.querySelector('.message-content') || assistantDiv;
                            const body = document.createElement('div');
                            body.className = 'content-body';
                            body.dataset.streamLive = '1';
                            body.dataset.streamRaw = accData.content;
                            body.innerHTML = renderStreamingMarkdownWithNewTabLinks(accData.content, {
                                streamingMathProvisional: true
                            });
                            bindSourceMarkdown(body, accData.content);
                            highlightCode(body);
                            content.appendChild(body);
                            resumeFromSeq = Number.isFinite(Number(accData.last_seq)) ? Number(accData.last_seq) : 0;
                            prefilledFromApi = true;
                            prefillEndedWithContent = true;
                        }

                        if (!prefillResult.rendered && accData && accData.success && accData.reasoning_content) {
                            const content = assistantDiv.querySelector('.message-content') || assistantDiv;
                            const thinkingBlock = createThinkingBlock(false);
                            const thinkingContent = thinkingBlock.querySelector('.thinking-content');
                            markReasoningThinkingBlockLive(thinkingBlock);
                            thinkingContent.dataset.streamRaw = accData.reasoning_content;
                            thinkingContent.innerHTML = renderMarkdownWithNewTabLinks(accData.reasoning_content, {
                                breaks: true,
                                streamingMathProvisional: true
                            });
                            bindSourceMarkdown(thinkingContent, accData.reasoning_content);
                            highlightCode(thinkingContent);
                            updateThinkingBlockSummary(thinkingBlock, accData.reasoning_content);
                            content.prepend(thinkingBlock);
                            resumeFromSeq = Number.isFinite(Number(accData.last_seq)) ? Number(accData.last_seq) : resumeFromSeq;
                            prefilledFromApi = true;
                            prefillEndedWithContent = false;
                        }
                    } catch (_) {
                        // 缓冲读取失败时从第 0 个事件重新读取，避免旧回复内容参与续接。
                    }
                }
            }

            if (opts.showToast !== false) {
                showToast('检测到未完成回复，正在重连...');
            }

            beginTokenMiniStreaming(reconnectStreamConversationId);

            const previousStreamState = getConversationStreamState(reconnectStreamConversationId);
            if (previousStreamState && previousStreamState.monitoring && previousStreamState.controller) {
                try {
                    previousStreamState.controller.abort();
                } catch (_) {}
            }

            const reconnectAbortController = new AbortController();
            setCurrentAbortController(reconnectAbortController);
            setConversationStreamState(reconnectStreamConversationId, {
                controller: reconnectAbortController,
                monitoring: false
            });
            syncGenerationStateForCurrentConversation();

            let streamCompleted = false;
            let streamAbortedByUser = false;
            let streamDetachedByNavigation = false;
            let streamEndedWithError = false;
            let streamErrorRetryable = false;
            let streamErrorCode = '';
            let streamErrorMessage = '';
            let currentFullContent = '';
            let currentSegmentContent = '';
            let currentContentSpan = null;
            let liveHistoryTimeMarkerBuffer = '';
            let buffer = '';
            let replayCatchupSeq = 0;
            const decoder = new TextDecoder();
            const latestLiveResumeNode = getLatestLiveStreamResumeNode(assistantDiv);
            const resumeContentBody = (
                latestLiveResumeNode.type === 'reasoning'
                || (!canReuseExistingContent && prefilledFromApi && !prefillEndedWithContent)
            )
                ? null
                : prepareLatestContentBodyForStreamResume(assistantDiv);
            const resumeThinkingBlock = latestLiveResumeNode.type === 'reasoning'
                ? prepareLatestThinkingBlockForStreamResume(assistantDiv, latestLiveResumeNode.node)
                : null;

            if (resumeContentBody) {
                currentContentSpan = resumeContentBody;
                currentSegmentContent = String(resumeContentBody.dataset.streamRaw || '');
                currentFullContent = currentSegmentContent;
            }

            if (resumeThinkingBlock) {
                console.debug('[StreamResume] resume live reasoning block', {
                    conversation_id: reconnectBoundConversationId,
                    stream_id: String(state.stream_id || ''),
                    assistant_index: assistantIndex,
                    reasoning_chars: String((resumeThinkingBlock.querySelector('.thinking-content') || {}).dataset?.streamRaw || '').length
                });
            }

            try {
                const response = await fetch('/api/chat/stream/reconnect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        stream_id: state.stream_id,
                        from_seq: Number.isFinite(Number(opts.fromSeq)) ? Number(opts.fromSeq) : resumeFromSeq
                    }),
                    signal: reconnectAbortController.signal
                });

                if (!response.ok || !response.body) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const reader = response.body.getReader();

                while (true) {
                    const { value, done } = await reader.read();
                    if (value) buffer += decoder.decode(value, { stream: !done });
                    if (done) buffer += decoder.decode();

                    const lines = buffer.split('\n');
                    buffer = done ? '' : (lines.pop() || '');

                    const dirtiedContentSpans = new Set();
                    const dirtiedThinkingBlocks = new Set();
                    const freshContentSpans = new Set();

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;

                        const jsonStr = line.slice(6);

                        if (jsonStr === '[DONE]') {
                            streamCompleted = true;
                            continue;
                        }

                        let chunk = null;

                        try {
                            chunk = JSON.parse(jsonStr);
                        } catch (_) {
                            continue;
                        }

                        if (!chunk || typeof chunk !== 'object') continue;

                        if (chunk.type === 'stream_session') {
                            const sid = String(chunk.stream_id || '').trim();
                            replayCatchupSeq = Number.isFinite(Number(chunk.last_seq)) ? Number(chunk.last_seq) : 0;

                            if (isTerminalStreamSessionChunk(chunk)) {
                                const finalCid = String(chunk.conversation_id || reconnectStreamConversationId || readCurrentConversationId() || '').trim();

                                if (finalCid && finalCid !== reconnectStreamConversationId) {
                                    moveConversationStreamState(reconnectStreamConversationId, finalCid);
                                    reconnectStreamConversationId = finalCid;
                                }

                                streamCompleted = true;
                                clearActiveStreamResumeState();
                                markConversationStreamFinished(reconnectStreamConversationId, {
                                    error: String(chunk.error || '').trim()
                                });
                                continue;
                            }

                            if (sid) {
                                assistantDiv.dataset.streamId = sid;
                                const sessionCid = String(chunk.conversation_id || reconnectStreamConversationId || readCurrentConversationId() || '').trim();

                                if (sessionCid && sessionCid !== reconnectStreamConversationId) {
                                    moveConversationStreamState(reconnectStreamConversationId, sessionCid);
                                    reconnectStreamConversationId = sessionCid;
                                }

                                const previousState = getConversationStreamState(sessionCid || reconnectStreamConversationId) || {};
                                const sameStream = String(previousState.stream_id || '').trim() === sid;
                                const sessionIsRegenerate = readStreamRegenerateFlag(chunk, sameStream ? !!previousState.is_regenerate : !!state.is_regenerate);
                                const sessionAssistantIndex = readStreamAssistantIndexFromMeta(
                                    chunk,
                                    sameStream ? previousState.assistant_index : assistantIndex
                                );
                                const sessionRegenerateIndex = sessionIsRegenerate
                                    ? readStreamRegenerateIndexFromMeta(chunk, sameStream ? previousState.regenerate_index : sessionAssistantIndex)
                                    : null;

                                patchActiveStreamResumeState({
                                    stream_id: sid,
                                    conversation_id: sessionCid,
                                    is_regenerate: sessionIsRegenerate,
                                    assistant_index: sessionAssistantIndex,
                                    regenerate_index: sessionRegenerateIndex
                                });
                                setConversationStreamState(sessionCid || reconnectStreamConversationId, {
                                    stream_id: sid,
                                    conversation_id: sessionCid || reconnectStreamConversationId,
                                    status: 'running',
                                    unread: false,
                                    is_regenerate: sessionIsRegenerate,
                                    assistant_index: sessionAssistantIndex,
                                    regenerate_index: sessionRegenerateIndex,
                                    stopping: false
                                });
                            }
                        }

                        const chunkSeq = Number.isFinite(Number(chunk._stream_seq)) ? Number(chunk._stream_seq) : 0;
                        const isReplayChunk = (canReuseExistingContent || prefilledFromApi) && replayCatchupSeq > 0 && chunkSeq > 0 && chunkSeq <= replayCatchupSeq;

                        if (chunkSeq > 0) {
                            patchActiveStreamResumeState({ last_seq: chunkSeq });
                            setConversationStreamState(reconnectStreamConversationId, {
                                last_seq: chunkSeq
                            });
                        }

                        if (chunk.type === 'stream_cancel_requested') {
                            streamAbortedByUser = true;
                            setConversationStreamState(reconnectStreamConversationId, {
                                stopping: true,
                                monitoring: false
                            });
                            syncGenerationStateForCurrentConversation();

                            try {
                                reconnectAbortController.abort();
                            } catch (abortError) {
                                console.error('[StreamCancel] reconnect abort after cancel event failed', abortError);
                            }

                            continue;
                        }

                        if (chunk.conversation_id) {
                            const incomingCid = String(chunk.conversation_id || '').trim();
                            patchActiveStreamResumeState({ conversation_id: incomingCid });

                            if (incomingCid && incomingCid !== reconnectStreamConversationId) {
                                moveConversationStreamState(reconnectStreamConversationId, incomingCid);
                                reconnectStreamConversationId = incomingCid;
                            }

                            if (incomingCid && incomingCid === reconnectBoundConversationId) {
                                const activeCid = readCurrentConversationId();

                                if (!activeCid) {
                                    setCurrentConversationId(incomingCid);
                                    syncNotesForConversation(incomingCid);
                                } else if (activeCid === reconnectBoundConversationId) {
                                    noteTokenMiniConversationId(incomingCid);
                                }
                            }
                        }

                        if (chunk.type === 'debug_trace') {
                            appendDebugTraceChunk(chunk, `resume:${String(state.stream_id || '')}`);
                        } else if (chunk.type === 'model_info') {
                            updateMessageModelBadge(assistantDiv, {
                                modelName: String(chunk.model_name || getStreamingModelBadgeName()),
                                searchFlag: (typeof chunk.search_enabled === 'boolean') ? chunk.search_enabled : 'unknown',
                                inputTokens: 0,
                                outputTokens: Math.max(getCurrentStreamOutputTokens(), getCurrentEstimatedStreamOutputTokens())
                            });
                        } else if (chunk.type === 'content') {
                            assistantDiv.__reasoningSegmentOpen = false;
                            let chunkContent = String(chunk.content || '');

                            if (!currentFullContent && !currentSegmentContent) {
                                const checked = stripHistoryTimeMarkerEchoForStream(`${liveHistoryTimeMarkerBuffer}${chunkContent}`);

                                if (checked.pending) {
                                    liveHistoryTimeMarkerBuffer = `${liveHistoryTimeMarkerBuffer}${chunkContent}`;
                                    continue;
                                }

                                liveHistoryTimeMarkerBuffer = '';
                                chunkContent = checked.text;

                                if (checked.removed) {
                                    console.warn('[StreamSanitize] stripped echoed history time marker from reconnect stream chunk');
                                }

                                if (!chunkContent) {
                                    continue;
                                }
                            }

                            currentFullContent += chunkContent;

                            if (!isReplayChunk) {
                                onTokenStreamTextChunk(chunkContent);
                            }

                            if (!isReplayChunk) {
                                if (assistantDiv.__contentAfterGeneratedImage) {
                                    currentContentSpan = createContentSpan(assistantDiv, { afterGeneratedImage: true });
                                    currentSegmentContent = '';
                                    assistantDiv.__contentAfterGeneratedImage = false;
                                } else if (!currentContentSpan || !currentContentSpan.isConnected) {
                                    currentContentSpan = createContentSpan(assistantDiv);
                                }

                                currentSegmentContent += chunkContent;
                                currentContentSpan.dataset.streamRaw = currentSegmentContent;
                                dirtiedContentSpans.add(currentContentSpan);
                                freshContentSpans.add(currentContentSpan);
                            }
                        } else if (chunk.type === 'reasoning_content') {
                            if (!isReplayChunk) {
                                onTokenStreamReasoningChunk(chunk.content);
                            }

                            if (!isReplayChunk) {
                                const msgContentContainer = assistantDiv.querySelector('.message-content');
                                const wasReasoningSegmentOpen = !!assistantDiv.__reasoningSegmentOpen;
                                const thinkingBlock = resolveReasoningThinkingBlockForAppend(assistantDiv, msgContentContainer);
                                markReasoningThinkingBlockLive(thinkingBlock);
                                const contentDiv = thinkingBlock.querySelector('.thinking-content');
                                const currentRaw = readReasoningContentRaw(contentDiv);
                                const appendText = buildReasoningAppendText(
                                    currentRaw,
                                    chunk.content || '',
                                    !wasReasoningSegmentOpen
                                );
                                const nextRaw = `${currentRaw}${appendText}`;
                                contentDiv.dataset.streamRaw = nextRaw;
                                dirtiedThinkingBlocks.add(contentDiv);
                            }
                        } else if (chunk.type === 'prompt_token_profile') {
                            applyPromptTokenProfileChunk(chunk);
                        } else if (
                            chunk.type === 'web_search' ||
                            chunk.type === 'search_meta' ||
                            chunk.type === 'context_compression_status' ||
                            chunk.type === 'function_call_delta' ||
                            chunk.type === 'function_call' ||
                            chunk.type === 'function_call_running' ||
                            chunk.type === 'function_result' ||
                            chunk.type === 'learning_card' ||
                            chunk.type === 'question' ||
                            chunk.type === 'puzzle'
                        ) {
                            if (chunk.type === 'learning_card') {
                                appendLearningCardStep(assistantDiv, chunk);
                            } else if (chunk.type === 'question') {
                                appendQuestionStep(assistantDiv, chunk);
                            } else if (chunk.type === 'puzzle') {
                                appendPuzzleStep(assistantDiv, chunk);
                            } else if (chunk.type === 'function_call_delta') {
                                const rawCallId = String(chunk.call_id || chunk.callId || '').trim();

                                if (rawCallId) {
                                    rememberToolArgsDeltaSeen(assistantDiv, rawCallId);
                                }

                                if (!isReplayChunk) {
                                    onTokenStreamToolArgsChunk(chunk.arguments_delta || chunk.delta || '');
                                }
                            } else if (chunk.type === 'function_call') {
                                const rawCallId = String(chunk.call_id || chunk.callId || '').trim();

                                if (!isReplayChunk && (!rawCallId || !hasToolArgsDeltaSeen(assistantDiv, rawCallId))) {
                                    onTokenStreamToolArgsChunk(chunk.arguments || '');
                                }
                            }

                            if (chunk.type !== 'learning_card' && chunk.type !== 'question' && chunk.type !== 'puzzle') {
                                assistantDiv.__reasoningSegmentOpen = false;
                                currentContentSpan = null;
                                currentSegmentContent = '';
                                updateMessageDivTools(assistantIndex, chunk, assistantDiv);
                                syncStreamingModelBadgeEstimate(assistantDiv, {
                                    modelName: getStreamingModelBadgeName(),
                                    searchFlag: 'unknown',
                                    inputTokens: 0,
                                    outputTokens: 0
                                });

                                if (
                                    !isReplayChunk &&
                                    (
                                        chunk.type === 'function_call_delta' ||
                                        chunk.type === 'function_call' ||
                                        chunk.type === 'function_call_running'
                                    )
                                ) {
                                    await yieldToolStreamPaintForChunk(
                                        assistantDiv,
                                        chunk,
                                        chunk.type !== 'function_call_delta'
                                    );
                                }
                            }
                        } else if (chunk.type === 'token_usage') {
                            onTokenStreamUsageChunk(chunk);
                            updateMessageModelBadge(assistantDiv, {
                                modelName: getStreamingModelBadgeName(),
                                searchFlag: 'unknown',
                                inputTokens: safeTokenInt(chunk.input_tokens),
                                outputTokens: Math.max(
                                    safeTokenInt(chunk.output_tokens),
                                    getCurrentStreamOutputTokens(),
                                    getCurrentEstimatedStreamOutputTokens()
                                )
                            });
                        } else if (chunk.type === 'title') {
                            const titleEl = getConversationTitleElement();

                            if (titleEl) {
                                titleEl.textContent = String(chunk.title || '');
                            }
                        } else if (chunk.type === 'error') {
                            streamEndedWithError = true;
                            streamErrorRetryable = !!chunk.retryable;
                            streamErrorCode = String(chunk.error_code || '').trim().toLowerCase();
                            streamErrorMessage = String(chunk.content || '').trim() || 'Unknown error';

                            if (streamErrorRetryable || streamErrorCode === 'network_error') {
                                appendErrorEvent(assistantDiv, streamErrorMessage);
                                showToast('连接中断，可刷新页面后自动重连此条回复');
                            } else {
                                showToast(streamErrorMessage);
                            }
                        }

                        scheduleLearningSidebarBridgeNotify();
                    }

                    for (const contentDiv of freshContentSpans) {
                        const segmentRaw = contentDiv.dataset.streamRaw || '';
                        const segmentPlanInfo = applyLongtermPlanFromText(segmentRaw, { source: 'live-segment', messageDiv: assistantDiv });
                        const displaySegmentContent = String(segmentPlanInfo && segmentPlanInfo.text !== undefined ? segmentPlanInfo.text : segmentRaw || '');
                        contentDiv.dataset.streamLive = '1';
                        contentDiv.innerHTML = renderStreamingMarkdownWithNewTabLinks(displaySegmentContent, {
                            streamingMathProvisional: true
                        });
                        bindSourceMarkdown(contentDiv, displaySegmentContent);
                        highlightCode(contentDiv);
                    }

                    if (freshContentSpans.size > 0 && getShouldAutoScroll()) {
                        pinMessagesToBottomFor(700);
                        syncStreamingModelBadgeEstimate(assistantDiv, {
                            modelName: getStreamingModelBadgeName(),
                            searchFlag: 'unknown',
                            inputTokens: 0,
                            outputTokens: 0
                        });
                    }

                    for (const contentDiv of dirtiedThinkingBlocks) {
                        const nextRaw = contentDiv.dataset.streamRaw || '';
                        contentDiv.innerHTML = renderMarkdownWithNewTabLinks(nextRaw, {
                            breaks: true,
                            streamingMathProvisional: true
                        });
                        bindSourceMarkdown(contentDiv, nextRaw);
                        highlightCode(contentDiv);
                        const pt = contentDiv.closest('.thinking-block');

                        if (pt) {
                            markReasoningThinkingBlockLive(pt);
                            updateThinkingBlockSummary(pt, nextRaw);
                        }
                    }

                    if (dirtiedThinkingBlocks.size > 0) {
                        if (getShouldAutoScroll()) {
                            pinMessagesToBottomFor(700);
                        }

                        syncStreamingModelBadgeEstimate(assistantDiv, {
                            modelName: getStreamingModelBadgeName(),
                            searchFlag: 'unknown',
                            inputTokens: 0,
                            outputTokens: 0
                        });
                    }

                    if (done) {
                        streamCompleted = true;
                        break;
                    }
                }
            } catch (e) {
                if (e && e.name === 'AbortError') {
                    if (reconnectAbortController.__nexoraDetachOnly) {
                        streamDetachedByNavigation = true;
                    } else {
                        streamAbortedByUser = true;
                    }
                } else {
                    console.error('Reconnect failed:', e);

                    if (e && e.message && e.message.includes('404')) {
                        streamEndedWithError = true;
                        streamErrorRetryable = false;
                        streamErrorCode = 'resume_expired';
                        streamErrorMessage = '重连状态已过期';
                        clearActiveStreamResumeState();

                        if (opts.showToast !== false) {
                            showToast('重连状态已过期，将重新加载历史记录');
                        }

                        const targetCid = String(state.conversation_id || readCurrentConversationId() || '').trim();

                        if (targetCid) {
                            loadConversation(targetCid);
                        }
                    } else {
                        const errText = String((e && e.message) || e || '重连失败');
                        const isRetryableNetwork = isLikelyRetryableNetworkErrorText(errText);
                        streamEndedWithError = true;
                        streamErrorRetryable = !!isRetryableNetwork;
                        streamErrorCode = isRetryableNetwork ? 'network_error' : 'reconnect_failed';
                        streamErrorMessage = errText;

                        if (streamErrorRetryable) {
                            if (opts.showToast !== false) {
                                showToast('连接中断，可刷新页面后自动重连此条回复');
                            }
                        } else if (opts.showToast !== false) {
                            showToast('重连失败，请稍后刷新重试');
                        }
                    }
                }
            } finally {
                const streamErroredRetryable = !!(streamEndedWithError && (streamErrorRetryable || streamErrorCode === 'network_error'));
                const streamEndedTerminally = !!(streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable));
                let streamServerFinalized = true;

                if (streamEndedTerminally) {
                    markConversationStreamFinished(reconnectStreamConversationId, {
                        error: streamEndedWithError ? (streamErrorMessage || 'reconnect_error') : ''
                    });
                } else if (streamDetachedByNavigation) {
                    const existingState = getConversationStreamState(reconnectStreamConversationId);
                    const ownsController = !!(existingState && existingState.controller === reconnectAbortController);
                    const latestState = setConversationStreamState(reconnectStreamConversationId, {
                        status: 'running',
                        ...(ownsController ? { controller: null, monitoring: false } : {})
                    });

                    if (shouldAutoAttachDetachedStream(reconnectAbortController)) {
                        attachDetachedStreamConsumer(reconnectStreamConversationId, latestState);
                    }
                } else if (streamErroredRetryable) {
                    setConversationStreamState(reconnectStreamConversationId, {
                        status: 'running',
                        controller: null,
                        monitoring: false,
                        error: streamErrorMessage || ''
                    });
                }

                syncGenerationStateForCurrentConversation();

                if (streamCompleted) {
                    finalizeMessageRenderForIndex(assistantIndex, assistantDiv);
                    collapseReasoningBlocksForMessage(assistantDiv);
                }

                if (streamEndedTerminally) {
                    assistantDiv.classList.remove('pending');
                }

                if (streamAbortedByUser && !streamCompleted) {
                    assistantDiv.dataset.localOnly = '1';
                    const activeStreamId = String(
                        (assistantDiv && assistantDiv.dataset && assistantDiv.dataset.streamId)
                        || state.stream_id
                        || ''
                    ).trim();
                    streamServerFinalized = await waitForStreamServerFinalized(activeStreamId, reconnectStreamConversationId);

                    if (!streamServerFinalized && readCurrentConversationId() === reconnectBoundConversationId) {
                        showToast('已中断，服务端仍在保存已输出内容');
                    }
                }

                if (streamEndedWithError && !streamErroredRetryable) {
                    const terminalText = renderAssistantTerminalErrorMessage(
                        assistantDiv,
                        assistantIndex,
                        currentFullContent,
                        streamErrorMessage || '重连失败'
                    );
                    currentFullContent = terminalText;
                    assistantDiv.dataset.localOnly = '1';
                }

                if (getCurrentConversationMode() === 'longterm') {
                    const nextLongtermState = normalizeLongtermState({
                        ...getCurrentConversationLongtermState(),
                        active: streamErroredRetryable ? true : false
                    });

                    setCurrentConversationLongtermState(nextLongtermState);
                    renderLongtermPlanPanel();
                    syncLocalConversationModeFlags(readCurrentConversationId(), {
                        conversation_mode: 'longterm',
                        longterm_active: streamErroredRetryable ? true : false,
                        longterm: nextLongtermState
                    });
                }

                await finishTokenMiniStreaming(reconnectStreamConversationId);

                if (streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable)) {
                    clearActiveStreamResumeState();
                }

                if (
                    streamEndedTerminally
                    && readCurrentConversationId() === reconnectBoundConversationId
                    && (!streamAbortedByUser || streamServerFinalized)
                ) {
                    await renderConversationSnapshotFromServer(reconnectBoundConversationId, {
                        instant: true,
                        silent: true,
                        render: !(streamCompleted && !streamAbortedByUser && !streamEndedWithError),
                        preserveScrollAnchor: true
                    });
                }

                if (streamCompleted) {
                    loadConversations();

                    if (readCurrentConversationId() === reconnectBoundConversationId) {
                        loadKnowledge(readCurrentConversationId());
                    }
                }

                scheduleLearningSidebarBridgeNotify(0);
            }
        }

        return {
            resumeActiveStreamAfterReload,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createStreamReconnectController,
    });
})();
