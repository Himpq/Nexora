(function () {
    'use strict';

    const MODULE_NAME = 'messages';
    const renderMessagesLogger = window.NexoraLog.logger('renderMessages');
    const renderTurnIndicatorLogger = window.NexoraLog.logger('renderTurnIndicator');

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Messages 模块');
        }

        return shared;
    }

    function requireMessagesDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_messages 缺少依赖: ${name}`);
        }

        return value;
    }

    function createMessagesController(deps = {}) {
        const getMessagesContainer = requireMessagesDependency(deps, 'getMessagesContainer');
        const getCurrentConversationId = requireMessagesDependency(deps, 'getCurrentConversationId');
        const getConversationStreamState = requireMessagesDependency(deps, 'getConversationStreamState');
        const normalizeStreamMessageIndex = requireMessagesDependency(deps, 'normalizeStreamMessageIndex');
        const readMessageRenderIndex = requireMessagesDependency(deps, 'readMessageRenderIndex');
        const buildIndexedMessageRows = requireMessagesDependency(deps, 'buildIndexedMessageRows');
        const getNextVisibleMessageIndex = requireMessagesDependency(deps, 'getNextVisibleMessageIndex');
        const getRenderLastUserMessageIndexHint = requireMessagesDependency(deps, 'getRenderLastUserMessageIndexHint');
        const getIsBatchRenderingMessages = requireMessagesDependency(deps, 'getIsBatchRenderingMessages');
        const getLastUserMessageIndexFromMessages = requireMessagesDependency(deps, 'getLastUserMessageIndexFromMessages');
        const setRenderLastUserMessageIndexHint = requireMessagesDependency(deps, 'setRenderLastUserMessageIndexHint');
        const setIsBatchRenderingMessages = requireMessagesDependency(deps, 'setIsBatchRenderingMessages');
        const refreshConversationImageHistoryFlag = requireMessagesDependency(deps, 'refreshConversationImageHistoryFlag');
        const clearHoverProxyMessage = requireMessagesDependency(deps, 'clearHoverProxyMessage');
        const renderWelcomeScreen = requireMessagesDependency(deps, 'renderWelcomeScreen');
        const syncLearningHeaderMode = requireMessagesDependency(deps, 'syncLearningHeaderMode');
        const clearLearningWelcomeState = requireMessagesDependency(deps, 'clearLearningWelcomeState');
        const captureMessagesScrollAnchor = requireMessagesDependency(deps, 'captureMessagesScrollAnchor');
        const restoreMessagesScrollAnchor = requireMessagesDependency(deps, 'restoreMessagesScrollAnchor');
        const refreshLastUserPromptEditButtons = requireMessagesDependency(deps, 'refreshLastUserPromptEditButtons');
        const getShouldAutoScroll = requireMessagesDependency(deps, 'getShouldAutoScroll');
        const scrollMessagesToBottomNow = requireMessagesDependency(deps, 'scrollMessagesToBottomNow');
        const setMessagesLastObservedScrollTop = requireMessagesDependency(deps, 'setMessagesLastObservedScrollTop');
        const pinMessagesToBottomFor = requireMessagesDependency(deps, 'pinMessagesToBottomFor');
        const getMessagesBottomPinUntilTs = requireMessagesDependency(deps, 'getMessagesBottomPinUntilTs');
        const setMessagesBottomPinPendingRestoreBehavior = requireMessagesDependency(deps, 'setMessagesBottomPinPendingRestoreBehavior');
        const notifyLearningSidebarBridge = requireMessagesDependency(deps, 'notifyLearningSidebarBridge');
        const renderTurnIndicator = requireMessagesDependency(deps, 'renderTurnIndicator');
        const updateMessageModelBadge = requireMessagesDependency(deps, 'updateMessageModelBadge');
        const isCurrentConversation = requireMessagesDependency(deps, 'isCurrentConversation');
        const hideTurnListPopup = requireMessagesDependency(deps, 'hideTurnListPopup');
        const markTurnIndicatorLayoutDirty = requireMessagesDependency(deps, 'markTurnIndicatorLayoutDirty');
        const getMessageElementByIndex = requireMessagesDependency(deps, 'getMessageElementByIndex');
        const openImageViewer = requireMessagesDependency(deps, 'openImageViewer');
        const formatFileSize = requireMessagesDependency(deps, 'formatFileSize');
        const escapeHtml = requireMessagesDependency(deps, 'escapeHtml');
        const collectContentMarkdownBeforeNode = requireMessagesDependency(deps, 'collectContentMarkdownBeforeNode');
        const resetUserPromptInlineEditor = requireMessagesDependency(deps, 'resetUserPromptInlineEditor');
        const renderMarkdownWithNewTabLinks = requireMessagesDependency(deps, 'renderMarkdownWithNewTabLinks');
        const bindSourceMarkdown = requireMessagesDependency(deps, 'bindSourceMarkdown');
        const renderMathSafe = requireMessagesDependency(deps, 'renderMathSafe');
        const renderLongtermHookBlock = requireMessagesDependency(deps, 'renderLongtermHookBlock');
        const appendReasoningThinkingBlock = requireMessagesDependency(deps, 'appendReasoningThinkingBlock');
        const updateWebSearchStatus = requireMessagesDependency(deps, 'updateWebSearchStatus');
        const appendSearchMeta = requireMessagesDependency(deps, 'appendSearchMeta');
        const resolveToolNameFromEvent = requireMessagesDependency(deps, 'resolveToolNameFromEvent');
        const appendAddBasisView = requireMessagesDependency(deps, 'appendAddBasisView');
        const collapseResolvedToolUsages = requireMessagesDependency(deps, 'collapseResolvedToolUsages');
        const allocateToolCallId = requireMessagesDependency(deps, 'allocateToolCallId');
        const rememberJsExecuteCanvasCall = requireMessagesDependency(deps, 'rememberJsExecuteCanvasCall');
        const finalizeToolCallBadge = requireMessagesDependency(deps, 'finalizeToolCallBadge');
        const extractLearningCardPayload = requireMessagesDependency(deps, 'extractLearningCardPayload');
        const appendLearningCardStep = requireMessagesDependency(deps, 'appendLearningCardStep');
        const updateLastToolResult = requireMessagesDependency(deps, 'updateLastToolResult');
        const applyLongtermPlanFromText = requireMessagesDependency(deps, 'applyLongtermPlanFromText');
        const updateMessageDivTools = requireMessagesDependency(deps, 'updateMessageDivTools');
        const appendErrorEvent = requireMessagesDependency(deps, 'appendErrorEvent');
        const extractStandaloneSystemErrorMessage = requireMessagesDependency(deps, 'extractStandaloneSystemErrorMessage');
        const highlightCode = requireMessagesDependency(deps, 'highlightCode');
        const appendLearningCardsToContent = requireMessagesDependency(deps, 'appendLearningCardsToContent');
        const appendQuestionStep = requireMessagesDependency(deps, 'appendQuestionStep');
        const appendPuzzleStep = requireMessagesDependency(deps, 'appendPuzzleStep');
        const readMessageIoTokens = requireMessagesDependency(deps, 'readMessageIoTokens');
        const readMessageMemoryIoTokens = requireMessagesDependency(deps, 'readMessageMemoryIoTokens');
        const safeTokenInt = requireMessagesDependency(deps, 'safeTokenInt');
        const buildVersionNavigation = requireMessagesDependency(deps, 'buildVersionNavigation');
        const rememberVisibleMessageInWindow = requireMessagesDependency(deps, 'rememberVisibleMessageInWindow');
        const appendTurnIndicatorLine = requireMessagesDependency(deps, 'appendTurnIndicatorLine');
        const forkConversationFromMessage = requireMessagesDependency(deps, 'forkConversationFromMessage');

        function requireMessagesContainer() {
            const container = getMessagesContainer();

            if (!container) {
                throw new Error('chat_messages 缺少消息容器');
            }

            return container;
        }

        function createContentSpan(parentMsgDiv, options = {}) {
            collapseResolvedToolUsages(parentMsgDiv);
            const parent = parentMsgDiv.querySelector('.message-content') || parentMsgDiv;
            const span = document.createElement('div');
            span.className = 'content-body fade-in';

            if (options && options.afterGeneratedImage === true) {
                span.classList.add('generated-image-followup');
                const generatedImages = parent.querySelectorAll('.content-body.generated-image-result');
                const anchor = generatedImages.length > 0 ? generatedImages[generatedImages.length - 1] : null;
                parentMsgDiv.__generatedImageFollowupSpan = span;

                if (anchor && anchor.parentElement === parent) {
                    anchor.insertAdjacentElement('afterend', span);
                    return span;
                }
            }

            parent.appendChild(span);
            return span;
        }

        function appendUserAttachments(contentEl, msg) {
            if (!contentEl || !msg || !msg.metadata || !Array.isArray(msg.metadata.attachments)) return;

            const allAttachments = msg.metadata.attachments.filter((att) => att && typeof att === 'object');
            const imageAttachments = allAttachments.filter((att) => {
                if (!att || typeof att !== 'object') return false;

                const type = String(att.type || '').toLowerCase();
                const url = String(att.asset_url || att.url || '').trim();

                if (!url) return false;
                if (type === 'image' || type === 'image_url') return true;

                const mime = String(att.mime || '').toLowerCase();
                return mime.startsWith('image/');
            });
            const fileAttachments = allAttachments.filter((att) => !imageAttachments.includes(att));

            if (!imageAttachments.length && !fileAttachments.length) return;

            if (imageAttachments.length) {
                const wrap = document.createElement('div');
                wrap.className = 'message-attachments';
                imageAttachments.forEach((att) => {
                    const rawUrl = String(att.asset_url || att.url || '').trim();
                    const displayUrl = rawUrl.startsWith('/') ? rawUrl : rawUrl;
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'message-attachment image';
                    item.title = String(att.name || 'image').trim() || 'image';
                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openImageViewer(displayUrl, item.title);
                    });

                    const img = document.createElement('img');
                    img.loading = 'lazy';
                    img.src = displayUrl;
                    img.alt = String(att.name || 'image').trim() || 'image';
                    item.appendChild(img);

                    wrap.appendChild(item);
                });
                contentEl.appendChild(wrap);
            }

            if (fileAttachments.length) {
                const wrap = document.createElement('div');
                wrap.className = 'message-attachments file-list';
                fileAttachments.forEach((att) => {
                    const type = String(att.type || 'file').toLowerCase();
                    const name = String(att.name || 'attachment').trim() || 'attachment';
                    const sizeText = formatFileSize(att.size || 0);
                    const chip = document.createElement('div');
                    chip.className = 'message-attachment file';
                    const iconClass = type === 'sandbox_file'
                        ? 'fa-solid fa-folder-tree'
                        : (type === 'text' ? 'fa-regular fa-file-lines' : 'fa-regular fa-file');
                    chip.innerHTML = `
                <i class="${iconClass}" aria-hidden="true"></i>
                <span class="name">${escapeHtml(name)}</span>
                <span class="meta">${escapeHtml(sizeText)}</span>
            `;
                    chip.title = type === 'sandbox_file'
                        ? `沙箱文件: ${String(att.sandbox_path || '')}`
                        : name;
                    wrap.appendChild(chip);
                });
                contentEl.appendChild(wrap);
            }
        }

        function appendMessage(msg, index, options = {}) {
            const appendOptions = (options && typeof options === 'object') ? options : {};
            const message = (msg && typeof msg === 'object') ? msg : {};
            const container = requireMessagesContainer();

            // If index is not provided (live message), continue from the largest visible server index.
            if (index === undefined || index === null) {
                index = getNextVisibleMessageIndex();
            }

            const div = document.createElement('div');
            div.className = `message ${message.role}`;

            if (message.pending) {
                div.classList.add('pending');
            }

            div.dataset.index = index;
            div.dataset.conversationId = String(getCurrentConversationId() || '');

            if (message.role === 'assistant') {
                div.dataset.localOnly = message.pending ? '1' : '0';
            }

            const content = document.createElement('div');
            content.className = 'message-content';
            div.appendChild(content);
            div.__messageData = message;
            div.__toolCallState = {
                seq: 0,
                pendingByName: {},
                callIdByIndex: {},
                pendingQueue: [],
                explicitIdByLocalId: {},
                activeAnonCallId: '',
                argsDeltaSeenByCallId: {}
            };

            if (message.role === 'user') {
                appendUserAttachments(content, message);

                const textContent = String(message.content || '').trim();

                if (textContent) {
                    const bubble = document.createElement('div');
                    bubble.className = 'message-bubble';
                    bubble.innerHTML = renderMarkdownWithNewTabLinks(textContent);
                    bindSourceMarkdown(bubble, textContent);
                    renderMathSafe(bubble);
                    content.appendChild(bubble);
                }

                const canRenderEditBtn = !message.pending && !!textContent && (
                    (getRenderLastUserMessageIndexHint() >= 0 && Number(index) === Number(getRenderLastUserMessageIndexHint()))
                    || (!getIsBatchRenderingMessages())
                );

                const actions = document.createElement('div');
                actions.className = 'msg-actions';
                actions.innerHTML = `
            ${canRenderEditBtn ? `
            <button class="btn-action" data-action="edit-user-prompt" onclick="toggleEditUserPrompt(${index})" title="编辑提示词">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                </svg>
            </button>
            ` : ''}
            <button class="btn-action" onclick="copyUserMessage(${index})" title="复制消息">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;
                content.appendChild(actions);
            } else {
                const processSteps = (message.metadata && Array.isArray(message.metadata.process_steps))
                    ? message.metadata.process_steps
                    : [];
                const learningCards = (message.metadata && Array.isArray(message.metadata.learning_cards))
                    ? message.metadata.learning_cards
                    : [];
                const hasReasoningStep = processSteps.some((step) => step && step.type === 'reasoning_content');
                const longtermHook = (message.metadata && message.metadata.longterm_hook && typeof message.metadata.longterm_hook === 'object')
                    ? message.metadata.longterm_hook
                    : null;

                if (longtermHook) {
                    content.appendChild(renderLongtermHookBlock(longtermHook));
                }

                // 兼容老数据：仅 metadata.reasoning_content（无分段 step）
                let historyReasoningBlock = null;

                if (message.metadata && message.metadata.reasoning_content && !hasReasoningStep) {
                    historyReasoningBlock = appendReasoningThinkingBlock(content, message.metadata.reasoning_content);
                }

                if (processSteps.length > 0) {
                    processSteps.forEach((step) => {
                        if (step.type === 'reasoning_content') {
                            if (historyReasoningBlock && historyReasoningBlock.isConnected) {
                                appendReasoningThinkingBlock(content, step.content || '', {
                                    reuseBlock: historyReasoningBlock
                                });
                            } else {
                                historyReasoningBlock = appendReasoningThinkingBlock(content, step.content || '');
                            }
                        } else if (step.type === 'web_search') {
                            updateWebSearchStatus(div, step.status || step.content, step.query, step.content, true);
                        } else if (step.type === 'search_meta') {
                            appendSearchMeta(div, step, true);
                        } else if (step.type === 'function_call') {
                            const toolName = resolveToolNameFromEvent(step, step.name);

                            if (toolName === 'learning_card' || toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'puzzle') return;

                            if (toolName === 'knowledge_basis_create' || toolName === 'add_basis' || toolName === 'addBasis') {
                                try {
                                    const args = JSON.parse(step.arguments);
                                    appendAddBasisView(div, args);
                                } catch (e) {}
                            }

                            const callId = allocateToolCallId(div, toolName, 'call', step.call_id || '', step.index);
                            rememberJsExecuteCanvasCall(div, toolName, callId, step.index, step.arguments || '');
                            finalizeToolCallBadge(div, toolName, callId, step.arguments || '', {
                                autoExpand: false,
                                toolIndex: step.index
                            });
                        } else if (step.type === 'function_result') {
                            const toolName = resolveToolNameFromEvent(step, step.name);

                            if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'puzzle') return;

                            if (toolName === 'learning_card') {
                                const cardPayload = extractLearningCardPayload(step.result);

                                if (cardPayload) {
                                    appendLearningCardStep(div, { type: 'learning_card', card: cardPayload });
                                }

                                return;
                            }

                            const callId = allocateToolCallId(div, toolName, 'result', step.call_id || '', step.index);
                            updateLastToolResult(div, toolName, step.result, callId, {
                                toolIndex: step.index,
                                modelVisibleResult: step.model_visible_result
                            });

                            if (toolName === 'longterm_plan' || toolName === 'longterm_update') {
                                applyLongtermPlanFromText(step.result, { source: 'history-tool-result', messageDiv: div });
                            }
                        } else if (step.type === 'context_compression_status') {
                            updateMessageDivTools(index, step, div);
                        } else if (step.type === 'error') {
                            appendErrorEvent(div, step.content || step.message || 'Unknown error', true);
                        } else if (step.type === 'content') {
                            collapseResolvedToolUsages(div);
                            const planInfo = applyLongtermPlanFromText(step.content, {
                                source: 'history-step',
                                messageDiv: div
                            });
                            const cleanedStepContent = String(planInfo && planInfo.text !== undefined ? planInfo.text : step.content || '');
                            const body = document.createElement('div');
                            body.className = 'content-body';
                            body.innerHTML = renderMarkdownWithNewTabLinks(cleanedStepContent, {
                                autoCloseCodeFence: true
                            });
                            bindSourceMarkdown(body, cleanedStepContent);
                            renderMathSafe(body);
                            highlightCode(body);
                            content.appendChild(body);
                        } else if (step.type === 'learning_card') {
                            appendLearningCardStep(div, step);
                        } else if (step.type === 'question') {
                            appendQuestionStep(div, step);
                        } else if (step.type === 'puzzle') {
                            appendPuzzleStep(div, step);
                        }
                    });
                }

                const hasContentStep = processSteps.some((step) => step && step.type === 'content');

                if (message.content && !hasContentStep) {
                    const standaloneErr = extractStandaloneSystemErrorMessage(message.content);

                    if (standaloneErr) {
                        appendErrorEvent(div, standaloneErr, true);
                    } else {
                        collapseResolvedToolUsages(div);
                        const planInfo = applyLongtermPlanFromText(message.content, {
                            source: 'history-main',
                            messageDiv: div
                        });
                        const cleanedMsgContent = String(planInfo && planInfo.text !== undefined ? planInfo.text : message.content || '');
                        const body = document.createElement('div');
                        body.className = 'content-body';
                        body.innerHTML = renderMarkdownWithNewTabLinks(cleanedMsgContent, {
                            autoCloseCodeFence: true
                        });
                        bindSourceMarkdown(body, cleanedMsgContent);
                        renderMathSafe(body);
                        highlightCode(body);
                        content.appendChild(body);
                    }
                }

                if (learningCards.length > 0) {
                    appendLearningCardsToContent(content, learningCards);
                }

                const pendingQuestions = (message.metadata && Array.isArray(message.metadata.pending_questions))
                    ? message.metadata.pending_questions
                    : [];

                if (pendingQuestions.length > 0) {
                    const hasQuestionStep = processSteps.some((step) => step && step.type === 'question');

                    if (!hasQuestionStep) {
                        pendingQuestions.forEach((question) => appendQuestionStep(div, { type: 'question', question }));
                    }
                }

                const pendingPuzzles = (message.metadata && Array.isArray(message.metadata.pending_puzzles))
                    ? message.metadata.pending_puzzles
                    : [];

                if (pendingPuzzles.length > 0) {
                    const hasPuzzleStep = processSteps.some((step) => step && step.type === 'puzzle');

                    if (!hasPuzzleStep) {
                        pendingPuzzles.forEach((puzzle) => appendPuzzleStep(div, { type: 'puzzle', puzzle }));
                    }
                }

                const modelName = (message.metadata && message.metadata.model_name) || message.model_name;

                if (modelName) {
                    const ioMeta = readMessageIoTokens(message.metadata || {}, false);
                    const memoryIoMeta = readMessageMemoryIoTokens(message.metadata || {});
                    updateMessageModelBadge(div, {
                        modelName,
                        searchFlag: (message.metadata && typeof message.metadata.search_enabled === 'boolean')
                            ? message.metadata.search_enabled
                            : 'unknown',
                        inputTokens: safeTokenInt(ioMeta.input),
                        outputTokens: safeTokenInt(ioMeta.output),
                        memoryInputTokens: safeTokenInt(memoryIoMeta.input),
                        memoryOutputTokens: safeTokenInt(memoryIoMeta.output),
                        memoryReady: !!memoryIoMeta.ready
                    });
                }

                const actions = document.createElement('div');
                actions.className = 'msg-actions';

                const nav = buildVersionNavigation(message);

                if (nav.total > 1) {
                    const totalVersions = nav.total;
                    const currentVerNum = nav.current;
                    const prevIdx = nav.prevIndex;
                    const nextIdx = nav.nextIndex;

                    actions.innerHTML += `
                <div class="version-switcher">
                    <button class="btn-ver" onclick="switchVersion(${index}, ${prevIdx === null ? 'null' : prevIdx})" title="上一版本" ${prevIdx === null ? 'disabled' : ''}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span>${currentVerNum} / ${totalVersions}</span>
                    <button class="btn-ver" onclick="switchVersion(${index}, ${nextIdx === null ? 'null' : nextIdx})" title="下一版本" ${nextIdx === null ? 'disabled' : ''}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
            `;
                }

                actions.innerHTML += `
            <button class="btn-action" onclick="copyGeneratedInfo(${index})" title="复制生成信息">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            <button class="btn-action" onclick="confirmRegenerate(${index})" title="重新回答">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"></path></svg>
            </button>
            ${message.pending ? '' : `
            <button class="btn-action" data-action="fork-conversation" type="button" title="从这里创建分支">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="6" cy="4" r="2"></circle>
                    <circle cx="18" cy="8" r="2"></circle>
                    <circle cx="6" cy="20" r="2"></circle>
                    <path d="M6 6v12"></path>
                    <path d="M8 10h4a6 6 0 0 0 6-6"></path>
                </svg>
            </button>
            `}
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;

                const forkButton = actions.querySelector('[data-action="fork-conversation"]');

                if (forkButton) {
                    forkButton.addEventListener('click', () => {
                        void forkConversationFromMessage(index);
                    });
                }

                content.appendChild(actions);
            }

            if (appendOptions.beforeNode && appendOptions.beforeNode.parentNode === container) {
                container.insertBefore(div, appendOptions.beforeNode);
            } else {
                container.appendChild(div);
            }

            clearLearningWelcomeState();

            const welcome = container.querySelector('.welcome-screen');

            if (welcome) {
                welcome.remove();
            }

            if (!getIsBatchRenderingMessages()) {
                refreshLastUserPromptEditButtons();
                rememberVisibleMessageInWindow(message, index);
            }

            if (!getIsBatchRenderingMessages()) {
                appendTurnIndicatorLine(message.role, message);
            }

            if (getShouldAutoScroll() && !getIsBatchRenderingMessages()) {
                scrollMessagesToBottomNow();
            }

            notifyLearningSidebarBridge();
            return div;
        }

        function getActiveRegenerateStreamRenderPlan(conversationId) {
            const cid = String(conversationId || getCurrentConversationId() || '').trim();
            if (!cid) return null;

            const state = getConversationStreamState(cid);
            if (!state || String(state.status || '') !== 'running') return null;
            if (!state.is_regenerate) return null;

            const assistantIndex = normalizeStreamMessageIndex(state.assistant_index)
                ?? normalizeStreamMessageIndex(state.regenerate_index);
            if (assistantIndex === null) return null;

            return {
                conversation_id: cid,
                assistant_index: assistantIndex,
                state
            };
        }

        function buildRegeneratePendingAssistantMessage(sourceMessage, state = {}) {
            const source = (sourceMessage && typeof sourceMessage === 'object') ? sourceMessage : {};
            const metadataSource = (source.metadata && typeof source.metadata === 'object') ? source.metadata : {};
            const modelName = String(
                state.model_name
                || source.model_name
                || metadataSource.model_name
                || ''
            ).trim();
            const metadata = {};

            if (modelName) {
                metadata.model_name = modelName;
            }

            return {
                __message_index: source.__message_index,
                role: 'assistant',
                content: '',
                pending: true,
                model_name: modelName,
                metadata
            };
        }

        function resolveMessagesForActiveStreamRender(messages) {
            const rows = Array.isArray(messages) ? messages : [];
            const plan = getActiveRegenerateStreamRenderPlan(getCurrentConversationId());
            if (!plan) return rows;

            const assistantIndex = Number(plan.assistant_index);
            const assistantPosition = rows.findIndex((row, index) => readMessageRenderIndex(row, index) === assistantIndex);

            if (assistantIndex < 0 || assistantPosition < 0) {
                console.warn('[RegenerateBranch] running stream target is outside snapshot', {
                    conversation_id: plan.conversation_id,
                    assistant_index: assistantIndex,
                    message_count: rows.length
                });
                return rows;
            }

            const visibleRows = rows.slice(0, assistantPosition + 1);
            visibleRows[assistantPosition] = buildRegeneratePendingAssistantMessage(
                rows[assistantPosition],
                plan.state
            );

            console.debug('[RegenerateBranch] render active branch window', {
                conversation_id: plan.conversation_id,
                assistant_index: assistantIndex,
                original_count: rows.length,
                visible_count: visibleRows.length
            });

            return visibleRows;
        }

        function resetAssistantMessageForLiveStream(messageDiv, options = {}) {
            if (!messageDiv) return null;

            const opts = (options && typeof options === 'object') ? options : {};
            const content = messageDiv.querySelector('.message-content');
            const root = content || messageDiv;
            root.querySelectorAll(
                '.content-body,.thinking-block,.tool-usage,.add-basis-view,.model-badge,.puzzle-tool-card,.question-tool-card'
            ).forEach((el) => el.remove());

            messageDiv.__citationUrlMap = {};
            messageDiv.__toolCallState = {
                seq: 0,
                pendingByName: {},
                callIdByIndex: {},
                pendingQueue: [],
                explicitIdByLocalId: {},
                activeAnonCallId: '',
                argsDeltaSeenByCallId: {}
            };
            messageDiv.__activeReasoningThinkingBlock = null;
            messageDiv.__reasoningSegmentOpen = false;
            messageDiv.__contentAfterGeneratedImage = false;
            messageDiv.__generatedImageResultAnchor = null;
            messageDiv.__generatedImageFollowupSpan = null;
            messageDiv.__generatedImageTextPrefix = '';
            messageDiv.classList.add('pending');
            messageDiv.dataset.localOnly = opts.localOnly === false ? '0' : '1';

            if (opts.modelBadgeState) {
                updateMessageModelBadge(messageDiv, opts.modelBadgeState);
            }

            return messageDiv;
        }

        function applyRegenerateStreamDomWindow(conversationId, assistantIndex, preferredMessageDiv = null) {
            const cid = String(conversationId || '').trim();
            const container = getMessagesContainer();

            if (!cid || !isCurrentConversation(cid) || !container) return preferredMessageDiv;

            const idx = normalizeStreamMessageIndex(assistantIndex);
            if (idx === null) return preferredMessageDiv;

            Array.from(container.querySelectorAll('.message')).forEach((row) => {
                const rowIndex = normalizeStreamMessageIndex(row && row.dataset ? row.dataset.index : null);
                if (rowIndex === null || rowIndex <= idx) return;

                row.remove();
            });

            hideTurnListPopup();
            markTurnIndicatorLayoutDirty();

            return preferredMessageDiv && preferredMessageDiv.isConnected
                ? preferredMessageDiv
                : getMessageElementByIndex(idx, 'assistant');
        }

        function renderMessages(messages, noScroll, options = {}) {
            resetUserPromptInlineEditor();

            const container = requireMessagesContainer();
            const opts = (options && typeof options === 'object') ? options : {};
            const indexedRows = buildIndexedMessageRows(messages, opts.indexOffset);
            const renderRows = resolveMessagesForActiveStreamRender(indexedRows);

            refreshConversationImageHistoryFlag(renderRows);

            if (!renderRows || renderRows.length === 0) {
                clearHoverProxyMessage();
                void renderWelcomeScreen();
                void syncLearningHeaderMode();
                return;
            }

            clearHoverProxyMessage();
            clearLearningWelcomeState();
            void syncLearningHeaderMode();

            const instant = !!opts.instant;
            const oldScrollTop = container.scrollTop;
            const oldScrollHeight = container.scrollHeight;
            const oldClientHeight = container.clientHeight;
            const wasNearBottom = (oldScrollHeight - oldScrollTop - oldClientHeight) <= 40;
            const scrollAnchor = opts.preserveScrollAnchor
                ? captureMessagesScrollAnchor(container)
                : null;
            const prevInlineScrollBehavior = container.style.scrollBehavior;

            if (instant) {
                container.style.scrollBehavior = 'auto';
            }

            setRenderLastUserMessageIndexHint(getLastUserMessageIndexFromMessages(renderRows));
            setIsBatchRenderingMessages(true);

            try {
                container.innerHTML = '';
                const renderStart = performance.now();
                renderRows.forEach((message, index) => appendMessage(message, readMessageRenderIndex(message, index)));
                const renderEnd = performance.now();
                renderMessagesLogger.debug(`[renderMessages] appendMessage count=${renderRows.length} time=${(renderEnd - renderStart).toFixed(1)}ms`);
            } finally {
                setIsBatchRenderingMessages(false);
                setRenderLastUserMessageIndexHint(-1);
            }

            let stepStart = performance.now();
            refreshLastUserPromptEditButtons();
            renderMessagesLogger.debug(`[renderMessages] refreshEditBtns = ${(performance.now() - stepStart).toFixed(1)}ms`);
            stepStart = performance.now();

            let shouldPinBottom = false;

            if (noScroll) {
                const anchorRestored = !wasNearBottom && !getShouldAutoScroll() && scrollAnchor
                    ? restoreMessagesScrollAnchor(scrollAnchor, container)
                    : false;

                if (anchorRestored) {
                    requestAnimationFrame(() => restoreMessagesScrollAnchor(scrollAnchor, container));
                } else if (wasNearBottom || getShouldAutoScroll()) {
                    scrollMessagesToBottomNow();
                    shouldPinBottom = true;
                } else {
                    container.scrollTop = oldScrollTop;
                    setMessagesLastObservedScrollTop(Number(container.scrollTop || 0));
                }
            } else if (getShouldAutoScroll() || wasNearBottom) {
                scrollMessagesToBottomNow();
                shouldPinBottom = true;
            }

            renderMessagesLogger.debug(`[renderMessages] scrollToBottom = ${(performance.now() - stepStart).toFixed(1)}ms`);
            stepStart = performance.now();

            if (shouldPinBottom) {
                pinMessagesToBottomFor(4200);
            }

            renderMessagesLogger.debug(`[renderMessages] pinBottom = ${(performance.now() - stepStart).toFixed(1)}ms`);

            if (instant) {
                // Instant render should stay `auto` while bottom-pin is active.
                if (shouldPinBottom && Date.now() <= getMessagesBottomPinUntilTs()) {
                    setMessagesBottomPinPendingRestoreBehavior(String(prevInlineScrollBehavior || ''));
                } else {
                    requestAnimationFrame(() => {
                        container.style.scrollBehavior = prevInlineScrollBehavior || '';
                    });
                }
            }

            notifyLearningSidebarBridge();

            renderMessagesLogger.debug('[renderMessages] all sync work done, scheduling turnIndicator in 200ms');
            setTimeout(() => {
                const turnIndicatorStart = performance.now();
                renderTurnIndicator(renderRows, { animate: false });
                renderTurnIndicatorLogger.debug(`[renderTurnIndicator] total = ${(performance.now() - turnIndicatorStart).toFixed(1)}ms`);
            }, 200);
        }

        function resolveContentBodyForFullTextUpdate(messageDiv, displayText) {
            collapseResolvedToolUsages(messageDiv);
            const contentRoot = messageDiv.querySelector('.message-content') || messageDiv;
            const generatedAnchor = (
                messageDiv.__generatedImageResultAnchor
                && messageDiv.__generatedImageResultAnchor.isConnected
            )
                ? messageDiv.__generatedImageResultAnchor
                : Array.from(contentRoot.querySelectorAll('.content-body.generated-image-result')).pop();

            if (generatedAnchor) {
                let body = (
                    messageDiv.__generatedImageFollowupSpan
                    && messageDiv.__generatedImageFollowupSpan.isConnected
                )
                    ? messageDiv.__generatedImageFollowupSpan
                    : contentRoot.querySelector('.content-body.generated-image-followup');

                if (!body) {
                    body = createContentSpan(messageDiv, { afterGeneratedImage: true });
                }

                const prefix = String(
                    messageDiv.__generatedImageTextPrefix
                    || collectContentMarkdownBeforeNode(contentRoot, generatedAnchor)
                    || ''
                );
                let nextText = String(displayText || '');

                if (prefix && nextText.startsWith(prefix)) {
                    nextText = nextText.slice(prefix.length);
                }

                messageDiv.__contentAfterGeneratedImage = false;
                messageDiv.__generatedImageFollowupSpan = body;

                return { body, text: nextText };
            }

            let body = Array.from(contentRoot.querySelectorAll('.content-body')).find((node) => {
                return !node.classList.contains('generated-image-result')
                    && !node.classList.contains('generated-image-followup')
                    && !node.classList.contains('generated-map-result');
            });

            if (!body) {
                body = document.createElement('div');
                body.className = 'content-body';
                contentRoot.appendChild(body);
            }

            return { body, text: String(displayText || '') };
        }

        return {
            createContentSpan,
            appendUserAttachments,
            appendMessage,
            getActiveRegenerateStreamRenderPlan,
            buildRegeneratePendingAssistantMessage,
            resolveMessagesForActiveStreamRender,
            resetAssistantMessageForLiveStream,
            applyRegenerateStreamDomWindow,
            renderMessages,
            resolveContentBodyForFullTextUpdate,
        };
    }

    function createUserPromptEditController(deps = {}) {
        const getMessagesContainer = requireMessagesDependency(deps, 'getMessagesContainer');
        const getCurrentConversationId = requireMessagesDependency(deps, 'getCurrentConversationId');
        const getChatInputDraftMaxLen = requireMessagesDependency(deps, 'getChatInputDraftMaxLen');
        const showToast = requireMessagesDependency(deps, 'showToast');
        const renderMarkdownWithNewTabLinks = requireMessagesDependency(deps, 'renderMarkdownWithNewTabLinks');
        const bindSourceMarkdown = requireMessagesDependency(deps, 'bindSourceMarkdown');
        const renderMathSafe = requireMessagesDependency(deps, 'renderMathSafe');
        const highlightCode = requireMessagesDependency(deps, 'highlightCode');
        const ensureConversationPanelReadyForMutation = requireMessagesDependency(deps, 'ensureConversationPanelReadyForMutation');
        const fetchConversationMessagesSnapshot = requireMessagesDependency(deps, 'fetchConversationMessagesSnapshot');
        const getLastUserMessageIndexFromMessages = requireMessagesDependency(deps, 'getLastUserMessageIndexFromMessages');
        const renderMessages = requireMessagesDependency(deps, 'renderMessages');
        const renderConversationSnapshotFromServer = requireMessagesDependency(deps, 'renderConversationSnapshotFromServer');
        const findAssistantIndexAfterUserMessageInMessages = requireMessagesDependency(deps, 'findAssistantIndexAfterUserMessageInMessages');
        const sendMessage = requireMessagesDependency(deps, 'sendMessage');
        const startRegenerate = requireMessagesDependency(deps, 'startRegenerate');
        const isChatMobileLayout = requireMessagesDependency(deps, 'isChatMobileLayout');

        let userPromptEditState = {
            index: null,
            messageDiv: null,
            bubbleEl: null,
            editorEl: null,
            hintEl: null,
            editBtn: null,
            originalText: '',
            saving: false
        };

        function getLastUserMessageIndexFromDom() {
            const container = getMessagesContainer();

            if (!container) return -1;

            let last = -1;
            const rows = Array.from(container.querySelectorAll('.message.user'));

            rows.forEach((row) => {
                const idx = Number(row.dataset.index);

                if (Number.isFinite(idx) && idx > last) last = idx;
            });

            return last;
        }

        function resetUserPromptInlineEditor(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const keepEditedContent = !!opts.keepEditedContent;
            const state = userPromptEditState || {};
            const bubble = state.bubbleEl;
            const editor = state.editorEl;
            const hint = state.hintEl;
            const btn = state.editBtn;

            if (editor && editor.parentNode) editor.remove();
            if (hint && hint.parentNode) hint.remove();

            if (bubble) {
                bubble.style.display = '';

                if (keepEditedContent && typeof opts.editedText === 'string') {
                    const text = String(opts.editedText || '').trim();

                    if (text) {
                        bubble.innerHTML = renderMarkdownWithNewTabLinks(text);
                        bindSourceMarkdown(bubble, text);
                        renderMathSafe(bubble);
                        highlightCode(bubble);
                    }
                }
            }

            if (btn) {
                btn.classList.remove('is-editing');
                btn.title = '编辑提示词';
                btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
        `;
            }

            userPromptEditState = {
                index: null,
                messageDiv: null,
                bubbleEl: null,
                editorEl: null,
                hintEl: null,
                editBtn: null,
                originalText: '',
                saving: false
            };
        }

        function refreshLastUserPromptEditButtons() {
            const container = getMessagesContainer();

            if (!container) return;

            const userRows = Array.from(container.querySelectorAll('.message.user'));

            if (!userRows.length) return;

            let lastRow = null;
            let lastIdx = -1;

            userRows.forEach((row) => {
                const idx = Number(row.dataset.index);

                if (Number.isFinite(idx) && idx >= lastIdx) {
                    lastIdx = idx;
                    lastRow = row;
                }
            });

            userRows.forEach((row) => {
                const editBtn = row.querySelector('.btn-action[data-action="edit-user-prompt"]');

                if (!editBtn) return;

                const isLast = row === lastRow;
                editBtn.style.display = isLast ? '' : 'none';
                editBtn.disabled = !isLast;

                if (!isLast && Number(userPromptEditState.index) === Number(row.dataset.index)) {
                    resetUserPromptInlineEditor();
                }
            });
        }

        async function saveEditedUserPrompt(index, options = {}) {
            const idx = Number(index);
            const opts = (options && typeof options === 'object') ? options : {};
            const regenerateAfterSave = !!opts.regenerateAfterSave;
            const state = userPromptEditState;

            if (!Number.isFinite(idx) || !state || Number(state.index) !== idx || !state.editorEl) return;
            if (state.saving) return;

            if (idx !== getLastUserMessageIndexFromDom()) {
                showToast('仅支持修改最后一条用户消息');
                resetUserPromptInlineEditor();
                return;
            }

            const nextText = String(state.editorEl.value || '').trim();

            if (!nextText) {
                showToast('提示词不能为空');
                state.editorEl.focus();
                return;
            }

            const maxLen = Number(getChatInputDraftMaxLen() || 0);

            if (maxLen > 0 && nextText.length > maxLen) {
                showToast(`提示词不能超过 ${maxLen} 字符`);
                state.editorEl.focus();
                return;
            }

            if (nextText === String(state.originalText || '').trim()) {
                resetUserPromptInlineEditor();
                return;
            }

            const currentConversationId = String(getCurrentConversationId() || '').trim();

            if (!currentConversationId) {
                showToast('当前会话无效');
                return;
            }

            const operationReady = await ensureConversationPanelReadyForMutation(currentConversationId, 'edit_user_prompt');

            if (!operationReady) return;

            state.saving = true;

            if (state.editBtn) state.editBtn.disabled = true;

            try {
                const beforeSaveSnapshot = await fetchConversationMessagesSnapshot(currentConversationId);
                const beforeSaveMessages = beforeSaveSnapshot ? beforeSaveSnapshot.messages : [];
                const serverLastUserIndex = getLastUserMessageIndexFromMessages(beforeSaveMessages);
                const serverTarget = (idx >= 0 && idx < beforeSaveMessages.length) ? beforeSaveMessages[idx] : null;
                const serverTargetRole = String((serverTarget && serverTarget.role) || '').trim().toLowerCase();

                if (!beforeSaveSnapshot || serverTargetRole !== 'user' || serverLastUserIndex !== idx) {
                    resetUserPromptInlineEditor();

                    if (beforeSaveSnapshot) {
                        renderMessages(beforeSaveMessages, true, { instant: true });
                    }

                    showToast('对话已同步，请重新编辑最后一条用户消息');
                    return;
                }

                const res = await fetch(`/api/conversations/${encodeURIComponent(String(currentConversationId))}/messages/${idx}/content`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: nextText })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    showToast((data && data.message) ? data.message : '保存失败');
                    return;
                }

                resetUserPromptInlineEditor({ keepEditedContent: true, editedText: nextText });

                // 编辑只改动最后一条用户消息的内容，消息结构（角色与顺序）不变，
                // 可直接复用保存前已拉取的快照，避免重新拉取并全量渲染整个会话。
                const updatedMessages = Array.isArray(beforeSaveMessages)
                    ? beforeSaveMessages.map((msg, msgIndex) => (msgIndex === idx ? { ...msg, content: nextText } : msg))
                    : [];
                const preloadedSnapshot = beforeSaveSnapshot
                    ? { ...beforeSaveSnapshot, messages: updatedMessages }
                    : null;

                if (!regenerateAfterSave) {
                    showToast('提示词已更新');
                    return;
                }

                const assistantIndex = updatedMessages.length
                    ? findAssistantIndexAfterUserMessageInMessages(updatedMessages, idx)
                    : -1;

                if (assistantIndex < 0) {
                    if (idx === updatedMessages.length - 1) {
                        showToast('提示词已更新，正在生成回答');
                        await sendMessage({
                            textOverride: nextText,
                            displayContentOverride: nextText,
                            useExistingUserMessage: true
                        });
                        return;
                    }

                    showToast('提示词已更新，但后端未找到可重答的模型回复');
                    return;
                }

                showToast('提示词已更新，正在重新回答');
                await startRegenerate(assistantIndex, { preloadedSnapshot });
            } catch (_) {
                showToast('保存失败');
            } finally {
                if (state.editBtn) state.editBtn.disabled = false;
                if (userPromptEditState) userPromptEditState.saving = false;
            }
        }

        async function toggleEditUserPrompt(index) {
            const idx = Number(index);

            if (!Number.isFinite(idx)) return;

            if (Number(userPromptEditState.index) === idx && userPromptEditState.editorEl) {
                await saveEditedUserPrompt(idx, { regenerateAfterSave: true });
                return;
            }

            const currentConversationId = String(getCurrentConversationId() || '').trim();
            const operationReady = await ensureConversationPanelReadyForMutation(currentConversationId, 'edit_user_prompt');

            if (!operationReady) return;

            const messageDiv = document.querySelector(`.message.user[data-index="${idx}"]`);

            if (!messageDiv) return;

            if (idx !== getLastUserMessageIndexFromDom()) {
                showToast('仅支持修改最后一条用户消息');
                return;
            }

            if (userPromptEditState.editorEl) {
                resetUserPromptInlineEditor();
            }

            const bubble = messageDiv.querySelector('.message-bubble');

            if (!bubble) {
                showToast('未找到可编辑内容');
                return;
            }

            const editBtn = messageDiv.querySelector('.btn-action[data-action="edit-user-prompt"]');

            if (!editBtn) return;

            const sourceText = String((typeof bubble.__sourceMarkdown === 'string') ? bubble.__sourceMarkdown : (bubble.innerText || '')).trim();
            const editor = document.createElement('textarea');
            editor.className = 'user-prompt-inline-editor';
            editor.value = sourceText;
            editor.setAttribute('aria-label', '编辑用户提示词');

            const hint = document.createElement('div');
            hint.className = 'user-prompt-inline-hint';
            hint.textContent = 'Enter 保存并重答，Shift+Enter 换行，Esc 取消';

            const bubbleRect = bubble.getBoundingClientRect();
            const targetWidth = Math.max(120, Math.round(bubbleRect.width || bubble.offsetWidth || 120));
            const targetHeight = Math.max(44, Math.round(bubbleRect.height || bubble.offsetHeight || 44));
            editor.style.width = `${targetWidth}px`;
            editor.style.height = `${targetHeight}px`;

            bubble.style.display = 'none';
            bubble.insertAdjacentElement('afterend', editor);
            editor.insertAdjacentElement('afterend', hint);

            editBtn.classList.add('is-editing');
            editBtn.title = '保存修改';
            editBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    `;

            userPromptEditState = {
                index: idx,
                messageDiv,
                bubbleEl: bubble,
                editorEl: editor,
                hintEl: hint,
                editBtn,
                originalText: sourceText,
                saving: false
            };

            editor.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    await saveEditedUserPrompt(idx, { regenerateAfterSave: true });
                    return;
                }

                if (e.key === 'Escape') {
                    e.preventDefault();
                    resetUserPromptInlineEditor();
                }
            });

            const focusEditorFromGesture = () => {
                if (!isChatMobileLayout()) return;

                try {
                    editor.focus({ preventScroll: true });
                } catch (_) {
                    editor.focus();
                }
            };

            editor.addEventListener('touchstart', focusEditorFromGesture, { passive: true });
            editor.addEventListener('pointerdown', (e) => {
                if (e.pointerType && e.pointerType !== 'touch') return;

                focusEditorFromGesture();
            }, { passive: true });

            requestAnimationFrame(() => {
                try {
                    editor.focus({ preventScroll: true });
                    editor.setSelectionRange(editor.value.length, editor.value.length);
                } catch (_) {
                    editor.focus();
                }
            });
        }

        return {
            getLastUserMessageIndexFromDom,
            resetUserPromptInlineEditor,
            refreshLastUserPromptEditButtons,
            saveEditedUserPrompt,
            toggleEditUserPrompt,
        };
    }

    function createMessageActionsController(deps = {}) {
        const getCurrentConversationId = requireMessagesDependency(deps, 'getCurrentConversationId');
        const getSelectedModelId = requireMessagesDependency(deps, 'getSelectedModelId');
        const getModelCatalog = requireMessagesDependency(deps, 'getModelCatalog');
        const getLearningModeEnabled = requireMessagesDependency(deps, 'getLearningModeEnabled');
        const getCurrentConversationMode = requireMessagesDependency(deps, 'getCurrentConversationMode');
        const getCurrentConversationLongtermState = requireMessagesDependency(deps, 'getCurrentConversationLongtermState');
        const getLearningReaderContextSnapshot = requireMessagesDependency(deps, 'getLearningReaderContextSnapshot');
        const getTokenBudgetState = requireMessagesDependency(deps, 'getTokenBudgetState');
        const getElements = requireMessagesDependency(deps, 'getElements');
        const getShouldAutoScroll = requireMessagesDependency(deps, 'getShouldAutoScroll');
        const setIsGenerating = requireMessagesDependency(deps, 'setIsGenerating');
        const setCurrentAbortController = requireMessagesDependency(deps, 'setCurrentAbortController');
        const setPendingRegenerateFilter = requireMessagesDependency(deps, 'setPendingRegenerateFilter');
        const showToast = requireMessagesDependency(deps, 'showToast');
        const showConfirm = requireMessagesDependency(deps, 'showConfirm');
        const copyTextToClipboardSafe = requireMessagesDependency(deps, 'copyTextToClipboardSafe');
        const ensureConversationPanelReadyForMutation = requireMessagesDependency(deps, 'ensureConversationPanelReadyForMutation');
        const syncConversationMessagesFromServer = requireMessagesDependency(deps, 'syncConversationMessagesFromServer');
        const loadConversations = requireMessagesDependency(deps, 'loadConversations');
        const loadKnowledge = requireMessagesDependency(deps, 'loadKnowledge');
        const loadModels = requireMessagesDependency(deps, 'loadModels');
        const syncGenerationStateForCurrentConversation = requireMessagesDependency(deps, 'syncGenerationStateForCurrentConversation');
        const isConversationStreamRunning = requireMessagesDependency(deps, 'isConversationStreamRunning');
        const fetchConversationMessagesSnapshot = requireMessagesDependency(deps, 'fetchConversationMessagesSnapshot');
        const renderMessages = requireMessagesDependency(deps, 'renderMessages');
        const buildLearningReaderContextBlocks = requireMessagesDependency(deps, 'buildLearningReaderContextBlocks');
        const getToolsMode = requireMessagesDependency(deps, 'getToolsMode');
        const isDebugConsoleEnabled = requireMessagesDependency(deps, 'isDebugConsoleEnabled');
        const appendDebugConsoleEntry = requireMessagesDependency(deps, 'appendDebugConsoleEntry');
        const consumeForceContextCompressionOnce = requireMessagesDependency(deps, 'consumeForceContextCompressionOnce');
        const maybeConfirmContextCompressionBeforeSend = requireMessagesDependency(deps, 'maybeConfirmContextCompressionBeforeSend');
        const getMessageElementByIndex = requireMessagesDependency(deps, 'getMessageElementByIndex');
        const buildAttachmentsPayloadFromMessage = requireMessagesDependency(deps, 'buildAttachmentsPayloadFromMessage');
        const updateSendButtonState = requireMessagesDependency(deps, 'updateSendButtonState');
        const clearActiveStreamResumeState = requireMessagesDependency(deps, 'clearActiveStreamResumeState');
        const setConversationStreamState = requireMessagesDependency(deps, 'setConversationStreamState');
        const isCurrentConversation = requireMessagesDependency(deps, 'isCurrentConversation');
        const beginTokenMiniStreaming = requireMessagesDependency(deps, 'beginTokenMiniStreaming');
        const applyRegenerateStreamDomWindow = requireMessagesDependency(deps, 'applyRegenerateStreamDomWindow');
        const resetAssistantMessageForLiveStream = requireMessagesDependency(deps, 'resetAssistantMessageForLiveStream');
        const readErrorMessageFromResponse = requireMessagesDependency(deps, 'readErrorMessageFromResponse');
        const saveActiveStreamResumeState = requireMessagesDependency(deps, 'saveActiveStreamResumeState');
        const markStreamControllerDetachOnly = requireMessagesDependency(deps, 'markStreamControllerDetachOnly');
        const isSseResponse = requireMessagesDependency(deps, 'isSseResponse');
        const isTerminalStreamSessionChunk = requireMessagesDependency(deps, 'isTerminalStreamSessionChunk');
        const markConversationStreamFinished = requireMessagesDependency(deps, 'markConversationStreamFinished');
        const patchActiveStreamResumeState = requireMessagesDependency(deps, 'patchActiveStreamResumeState');
        const jsonParseSafe = requireMessagesDependency(deps, 'jsonParseSafe');
        const applyPromptTokenProfileChunk = requireMessagesDependency(deps, 'applyPromptTokenProfileChunk');
        const appendDebugTraceChunk = requireMessagesDependency(deps, 'appendDebugTraceChunk');
        const stripHistoryTimeMarkerEchoForStream = requireMessagesDependency(deps, 'stripHistoryTimeMarkerEchoForStream');
        const createContentSpan = requireMessagesDependency(deps, 'createContentSpan');
        const renderStreamingContentSegment = requireMessagesDependency(deps, 'renderStreamingContentSegment');
        const pinMessagesToBottomFor = requireMessagesDependency(deps, 'pinMessagesToBottomFor');
        const updateMessageDivContent = requireMessagesDependency(deps, 'updateMessageDivContent');
        const updateMessageDivThinking = requireMessagesDependency(deps, 'updateMessageDivThinking');
        const updateMessageDivTools = requireMessagesDependency(deps, 'updateMessageDivTools');
        const yieldToolStreamPaintForChunk = requireMessagesDependency(deps, 'yieldToolStreamPaintForChunk');
        const onTokenStreamUsageChunk = requireMessagesDependency(deps, 'onTokenStreamUsageChunk');
        const applyUsageChunkToBadgeState = requireMessagesDependency(deps, 'applyUsageChunkToBadgeState');
        const updateMessageModelBadge = requireMessagesDependency(deps, 'updateMessageModelBadge');
        const appendErrorEvent = requireMessagesDependency(deps, 'appendErrorEvent');
        const scheduleLearningSidebarBridgeNotify = requireMessagesDependency(deps, 'scheduleLearningSidebarBridgeNotify');
        const isLikelyRetryableNetworkErrorText = requireMessagesDependency(deps, 'isLikelyRetryableNetworkErrorText');
        const finalizeMessageRenderForIndex = requireMessagesDependency(deps, 'finalizeMessageRenderForIndex');
        const resolveAssistantStreamMessageDiv = requireMessagesDependency(deps, 'resolveAssistantStreamMessageDiv');
        const renderAssistantTerminalErrorMessage = requireMessagesDependency(deps, 'renderAssistantTerminalErrorMessage');
        const removeConversationStreamState = requireMessagesDependency(deps, 'removeConversationStreamState');
        const getConversationStreamState = requireMessagesDependency(deps, 'getConversationStreamState');
        const shouldAutoAttachDetachedStream = requireMessagesDependency(deps, 'shouldAutoAttachDetachedStream');
        const attachDetachedStreamConsumer = requireMessagesDependency(deps, 'attachDetachedStreamConsumer');
        const finishTokenMiniStreaming = requireMessagesDependency(deps, 'finishTokenMiniStreaming');
        const refreshConversationImageHistoryFlag = requireMessagesDependency(deps, 'refreshConversationImageHistoryFlag');
        const applyTokenBudgetFromConversationMessages = requireMessagesDependency(deps, 'applyTokenBudgetFromConversationMessages');
        const refreshTokenMiniForConversation = requireMessagesDependency(deps, 'refreshTokenMiniForConversation');

        function getMessageRowByIndex(index) {
            const idx = Number(index);

            if (!Number.isFinite(idx)) return null;

            return document.querySelector(`.message[data-index="${idx}"]`);
        }

        function getDeleteRoundRangeFromDom(index) {
            const idx = Number(index);

            if (!Number.isFinite(idx)) return { start: -1, end: -1, role: '' };

            const row = getMessageRowByIndex(idx);

            if (!row) return { start: idx, end: idx, role: '' };

            const isUser = row.classList.contains('user');
            const isAssistant = row.classList.contains('assistant');
            let start = idx;
            let end = idx;

            if (isUser) {
                const next = getMessageRowByIndex(idx + 1);

                if (next && next.classList.contains('assistant')) end = idx + 1;

                return { start, end, role: 'user' };
            }

            if (isAssistant) {
                const prev = getMessageRowByIndex(idx - 1);

                if (prev && prev.classList.contains('user')) start = idx - 1;

                return { start, end, role: 'assistant' };
            }

            return { start, end, role: '' };
        }

        function optimisticHideDeleteRound(index) {
            const range = getDeleteRoundRangeFromDom(index);
            const hiddenRows = [];

            if (range.start < 0 || range.end < range.start) {
                return { ...range, hiddenRows };
            }

            for (let i = range.start; i <= range.end; i += 1) {
                const row = getMessageRowByIndex(i);

                if (!row) continue;

                row.dataset.optimisticHidden = '1';
                row.style.display = 'none';
                hiddenRows.push(row);
            }

            return { ...range, hiddenRows };
        }

        function rollbackOptimisticHide(state) {
            const rows = (state && Array.isArray(state.hiddenRows)) ? state.hiddenRows : [];

            rows.forEach((row) => {
                if (!row || !row.isConnected) return;

                if (row.dataset && row.dataset.optimisticHidden === '1') {
                    delete row.dataset.optimisticHidden;
                }

                row.style.display = '';
            });
        }

        async function copyGeneratedInfo(index) {
            try {
                const messageDiv = document.querySelector(`.message[data-index="${index}"]`);

                if (!messageDiv) return;

                const clone = messageDiv.cloneNode(true);
                clone.querySelectorAll('.msg-actions,.version-switcher,.thinking-block,.tool-usage,.model-badge,.add-basis-view').forEach((el) => el.remove());

                const contentRoot = clone.querySelector('.message-content') || clone;
                const bodyTexts = Array.from(contentRoot.querySelectorAll('.content-body'))
                    .map((el) => String(el.innerText || '').trim())
                    .filter(Boolean);
                const text = String(bodyTexts.length ? bodyTexts.join('\n\n') : (contentRoot.innerText || '')).trim();

                if (!text) {
                    showToast('没有可复制的生成信息');
                    return;
                }

                await copyTextToClipboardSafe(text);
                showToast('已复制生成信息');
            } catch (error) {
                console.error('copyGeneratedInfo failed', error);
                showToast('复制失败');
            }
        }

        async function copyUserMessage(index) {
            try {
                const messageDiv = document.querySelector(`.message.user[data-index="${index}"]`) || document.querySelector(`.message[data-index="${index}"]`);

                if (!messageDiv) {
                    showToast('未找到消息');
                    return;
                }

                const bubble = messageDiv.querySelector('.message-bubble');
                const markdown = bubble && typeof bubble.__sourceMarkdown === 'string' ? String(bubble.__sourceMarkdown || '') : '';
                const text = String(markdown || (bubble ? bubble.innerText : messageDiv.innerText) || '').trim();

                if (!text) {
                    showToast('没有可复制内容');
                    return;
                }

                await copyTextToClipboardSafe(text);
                showToast('已复制消息');
            } catch (error) {
                console.error('copyUserMessage failed', error);
                showToast('复制失败');
            }
        }

        async function deleteMessage(index) {
            const cid = String(getCurrentConversationId() || '').trim();
            const idx = Number(index);

            if (!cid || !Number.isFinite(idx) || idx < 0) {
                showToast('删除失败: 参数无效');
                return;
            }

            const operationReady = await ensureConversationPanelReadyForMutation(cid, 'delete');

            if (!operationReady) return;

            const clickedRow = getMessageRowByIndex(idx);
            const isLocalOnlyAssistant = !!(
                clickedRow
                && clickedRow.classList.contains('assistant')
                && String(clickedRow.dataset.localOnly || '') === '1'
            );
            const optimisticState = optimisticHideDeleteRound(idx);

            // 本地未落库 assistant：服务端按该轮 user 索引删除，避免 assistant 越界导致 failed。
            let requestIndex = idx;

            if (isLocalOnlyAssistant) {
                requestIndex = (Number.isFinite(Number(optimisticState.start)) && optimisticState.start < idx)
                    ? Number(optimisticState.start)
                    : -1;
            }

            // 本地残留且无法映射到服务端消息时，仅做本地删除。
            if (isLocalOnlyAssistant && requestIndex < 0) {
                showToast('已删除本地未保存消息');
                return;
            }

            try {
                const res = await fetch(`/api/conversations/${encodeURIComponent(String(cid))}/messages/${requestIndex}`, {
                    method: 'DELETE'
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    rollbackOptimisticHide(optimisticState);
                    const msg = String((data && (data.message || data.error)) || `HTTP ${res.status}`).trim() || '未知错误';
                    showToast(`删除失败: ${msg}`);
                    await syncConversationMessagesFromServer(cid, { instant: true, silent: true });
                    return;
                }

                showToast('已删除');
                await syncConversationMessagesFromServer(cid, { instant: true, silent: true });
                void loadConversations();
                void loadKnowledge(cid);
            } catch (error) {
                rollbackOptimisticHide(optimisticState);
                console.error(error);
                showToast('删除失败: 网络或服务异常');
                await syncConversationMessagesFromServer(cid, { instant: true, silent: true });
            }
        }

        function confirmDelete(index) {
            if (!getCurrentConversationId()) {
                return;
            }

            showConfirm('删除确认', '确定要删除这轮消息（本次提问和回答）吗？此操作不可撤销。', 'danger', async () => {
                await deleteMessage(index);
            });
        }

        function confirmRegenerate(index) {
            if (!getCurrentConversationId()) {
                showToast('此对话尚未保存，无法重新回答');
                return;
            }

            showConfirm('重新回答', '我们将保留当前回答并生成一个新版本，确定要重新生成吗？', 'primary', async () => {
                await startRegenerate(index);
            });
        }

        function resolveAssistantMessageModelName(message) {
            const msg = (message && typeof message === 'object') ? message : {};
            const metadata = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};

            return String(msg.model_name || metadata.model_name || '').trim();
        }

        async function resolveRegenerateModelName(index, messageDiv = null) {
            const idx = Number(index);

            if (!Number.isFinite(idx) || idx < 0) {
                return '';
            }

            const message = messageDiv && messageDiv.__messageData ? messageDiv.__messageData : null;
            const historyModelName = resolveAssistantMessageModelName(message);

            try {
                await loadModels();
            } catch (_) {
                showToast('模型配置读取失败，无法重答');
                return '';
            }

            const modelName = String(getSelectedModelId() || '').trim();

            if (!modelName) {
                console.warn('[Regenerate] selected model is empty', {
                    conversation_id: String(getCurrentConversationId() || ''),
                    message_index: idx,
                    history_model_name: historyModelName
                });
                showToast('请先选择用于重答的模型');
                return '';
            }

            const modelCatalog = getModelCatalog();
            const exists = Array.isArray(modelCatalog)
                && modelCatalog.some((item) => String(item && item.id || '').trim() === modelName);

            if (!exists) {
                showToast(`当前选择模型不可用：${modelName}`);
                return '';
            }

            if (historyModelName && historyModelName !== modelName) {
                console.info('[Regenerate] use selected model instead of history model', {
                    conversation_id: String(getCurrentConversationId() || ''),
                    message_index: idx,
                    selected_model_name: modelName,
                    history_model_name: historyModelName
                });
            }

            return modelName;
        }

        async function startRegenerate(index, options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};

            // 调用方（如保存编辑提示词后重答）已拉取并渲染最新快照时，可传入 preloadedSnapshot
            // 复用已获取的数据，避免重复全量拉取 conversation 导致进入发送状态延迟。
            const preloadedSnapshot = opts.preloadedSnapshot || null;

            syncGenerationStateForCurrentConversation();

            if (!preloadedSnapshot) {
                const operationReady = await ensureConversationPanelReadyForMutation(getCurrentConversationId(), 'regenerate');

                if (!operationReady) return;
            }

            const regenerateConversationId = String(getCurrentConversationId() || '').trim();
            syncGenerationStateForCurrentConversation();

            if (isConversationStreamRunning(regenerateConversationId)) return;

            const normalizedRegenerateIndex = Number(index);

            if (!Number.isInteger(normalizedRegenerateIndex) || normalizedRegenerateIndex < 0) {
                showToast('重答消息索引无效');
                return;
            }

            const targetSnapshot = preloadedSnapshot || await fetchConversationMessagesSnapshot(regenerateConversationId);
            const serverMessages = targetSnapshot && Array.isArray(targetSnapshot.messages) ? targetSnapshot.messages : [];
            const targetMessage = serverMessages[normalizedRegenerateIndex] || null;
            const sourceUserMessage = normalizedRegenerateIndex > 0 ? serverMessages[normalizedRegenerateIndex - 1] : null;
            const targetRole = String((targetMessage && targetMessage.role) || '').trim().toLowerCase();
            const sourceRole = String((sourceUserMessage && sourceUserMessage.role) || '').trim().toLowerCase();

            if (!targetSnapshot || targetRole !== 'assistant' || sourceRole !== 'user') {
                if (targetSnapshot) {
                    renderMessages(serverMessages, true, { instant: true });
                }

                console.warn('[Regenerate] server target validation failed', {
                    conversation_id: regenerateConversationId,
                    regenerate_index: normalizedRegenerateIndex,
                    target_role: targetRole,
                    source_role: sourceRole,
                    server_message_count: serverMessages.length
                });
                showToast('对话已同步，请重新选择要重答的消息');
                return;
            }

            const learningModeEnabled = getLearningModeEnabled();
            const currentConversationMode = getCurrentConversationMode();
            const currentConversationLongtermState = getCurrentConversationLongtermState();
            const learningReaderContextSnapshot = getLearningReaderContextSnapshot();
            const tokenBudgetState = getTokenBudgetState();
            const els = getElements();
            const regenLearningReaderContextBlocks = buildLearningReaderContextBlocks(
                (learningModeEnabled && currentConversationMode === 'learning') ? 'learning' : currentConversationMode
            );
            const toolsMode = getToolsMode();
            const enableTools = toolsMode !== 'off';
            let regenMessageDiv = document.querySelector(`.message.assistant[data-index="${normalizedRegenerateIndex}"]`);

            if (!regenMessageDiv && regenerateConversationId) {
                renderMessages(serverMessages, true, { instant: true });
                regenMessageDiv = document.querySelector(`.message.assistant[data-index="${normalizedRegenerateIndex}"]`);
            }

            if (!regenMessageDiv) {
                if (isDebugConsoleEnabled()) {
                    appendDebugConsoleEntry({
                        direction: 'client->local',
                        stage: 'regenerate_target_missing',
                        title: 'Regenerate Target Missing',
                        payload: {
                            conversation_id: regenerateConversationId,
                            regenerate_index: normalizedRegenerateIndex,
                            reason: 'assistant_dom_not_found_after_sync'
                        }
                    });
                }

                showToast('未找到可重答消息，请刷新后重试');
                return;
            }

            regenMessageDiv.__messageData = targetMessage;

            const modelName = await resolveRegenerateModelName(normalizedRegenerateIndex, regenMessageDiv);

            if (!modelName) return;

            const forceContextCompressionRequested = consumeForceContextCompressionOnce();
            const compressionDecision = await maybeConfirmContextCompressionBeforeSend(
                modelName,
                forceContextCompressionRequested
            );

            if (!compressionDecision.ok) return;

            const forceContextCompression = !!compressionDecision.forceCompression;
            const regenUserMessageIndex = normalizedRegenerateIndex - 1;
            const regenUserMessageDiv = getMessageElementByIndex(regenUserMessageIndex, 'user');
            const regenAttachmentPayload = buildAttachmentsPayloadFromMessage(
                regenUserMessageDiv && regenUserMessageDiv.__messageData ? regenUserMessageDiv.__messageData : null
            );
            const allowHistoryImages = true;
            let accumulatedContent = '';
            let currentSegmentContent = '';
            let currentContentSpan = null;
            let liveHistoryTimeMarkerBuffer = '';
            let hasRenderedContentDelta = false;
            let hasTimelineBoundary = false;
            let needsCanonicalTimelineSync = false;
            const modelBadgeState = {
                modelName: String(modelName || ''),
                searchFlag: 'unknown',
                inputTokens: 0,
                outputTokens: 0
            };
            const modelBadgeUsageState = {
                input: 0,
                output: 0,
                snapshotInput: 0,
                snapshotOutput: 0,
                snapshotInitialized: false
            };

            // 重答开始后立即写入运行态，停止按钮和会话切换都依赖这个状态。
            setIsGenerating(true);
            updateSendButtonState();

            const regenAbortController = new AbortController();
            setCurrentAbortController(regenAbortController);
            clearActiveStreamResumeState();
            setConversationStreamState(regenerateConversationId, {
                status: 'running',
                controller: regenAbortController,
                assistant_index: normalizedRegenerateIndex,
                is_regenerate: true,
                regenerate_index: normalizedRegenerateIndex,
                started_at: Date.now(),
                last_seq: 0,
                stopping: false
            });
            syncGenerationStateForCurrentConversation();

            if (isCurrentConversation(regenerateConversationId)) {
                beginTokenMiniStreaming(regenerateConversationId);
            }

            if (regenMessageDiv) {
                regenMessageDiv = applyRegenerateStreamDomWindow(
                    regenerateConversationId,
                    normalizedRegenerateIndex,
                    regenMessageDiv
                );
                resetAssistantMessageForLiveStream(regenMessageDiv, {
                    modelBadgeState,
                    localOnly: true
                });
            }

            let streamCompleted = false;
            let streamAbortedByUser = false;
            let streamDetachedByNavigation = false;
            let streamEndedWithError = false;
            let streamErrorRetryable = false;
            let streamErrorCode = '';
            let streamErrorMessage = '';

            try {
                const response = await fetch('/api/chat/stream', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        conversation_id: regenerateConversationId,
                        model_name: modelName,
                        is_regenerate: true,
                        regenerate_index: normalizedRegenerateIndex,
                        conversation_mode: (learningModeEnabled && currentConversationMode === 'learning') ? 'learning' : (currentConversationMode === 'longterm' ? 'longterm' : 'chat'),
                        conversation_mode_payload: currentConversationMode === 'longterm' ? {
                            task: String(currentConversationLongtermState.task || '').trim(),
                            plan: Array.isArray(currentConversationLongtermState.plan) ? currentConversationLongtermState.plan : [],
                            context: String(currentConversationLongtermState.context || '').trim(),
                            step: String(currentConversationLongtermState.step || '').trim(),
                            current_index: Number.isFinite(Number(currentConversationLongtermState.current_index)) ? Number(currentConversationLongtermState.current_index) : -1,
                            done_indices: Array.isArray(currentConversationLongtermState.done_indices) ? currentConversationLongtermState.done_indices : [],
                        } : ((learningModeEnabled && currentConversationMode === 'learning') ? {
                            learning: true,
                            lecture_id: String((learningReaderContextSnapshot && learningReaderContextSnapshot.lecture_id) || '').trim(),
                            system_prompt: '',
                            context_blocks: regenLearningReaderContextBlocks,
                            active_tool_skills: [],
                            meta: {
                                source: 'chatdbserver_learning_mode_regenerate'
                            },
                        } : {}),
                        enable_thinking: els.checkThinking.checked,
                        enable_web_search: els.checkSearch.checked,
                        enable_tools: enableTools,
                        tool_mode: (learningModeEnabled && currentConversationMode === 'learning') ? 'force' : (currentConversationMode === 'longterm' ? 'force' : toolsMode),
                        debug_mode: isDebugConsoleEnabled(),
                        show_token_usage: true,
                        file_ids: regenAttachmentPayload.file_ids,
                        sandbox_paths: regenAttachmentPayload.sandbox_paths,
                        user_attachments: regenAttachmentPayload.user_attachments,
                        allow_history_images: allowHistoryImages,
                        include_context: !!tokenBudgetState.includeContext,
                        force_context_compression: !!forceContextCompression
                    }),
                    signal: regenAbortController.signal
                });

                if (!response.ok) {
                    const errMsg = await readErrorMessageFromResponse(response, `HTTP ${response.status}`);
                    throw new Error(errMsg);
                }

                const headerStreamId = String(response.headers.get('X-Stream-Id') || '').trim();

                if (headerStreamId) {
                    if (regenMessageDiv) {
                        regenMessageDiv.dataset.streamId = headerStreamId;
                    }

                    saveActiveStreamResumeState({
                        stream_id: headerStreamId,
                        conversation_id: regenerateConversationId,
                        assistant_index: normalizedRegenerateIndex,
                        is_regenerate: true,
                        regenerate_index: normalizedRegenerateIndex,
                        started_at: Date.now(),
                        last_seq: 0
                    });
                    setConversationStreamState(regenerateConversationId, {
                        stream_id: headerStreamId,
                        status: 'running',
                        unread: false,
                        assistant_index: normalizedRegenerateIndex,
                        is_regenerate: true,
                        regenerate_index: normalizedRegenerateIndex,
                        last_seq: 0,
                        stopping: false
                    });

                    if (!isCurrentConversation(regenerateConversationId)) {
                        markStreamControllerDetachOnly(regenAbortController, {
                            conversation_id: regenerateConversationId,
                            stream_id: headerStreamId,
                            reason: 'regen_headers_after_navigation'
                        });
                    }
                }

                if (!isSseResponse(response)) {
                    const errMsg = await readErrorMessageFromResponse(response, '服务端未返回流式响应');
                    throw new Error(errMsg);
                }

                if (!response.body) throw new Error('stream body is empty');

                if (regenMessageDiv) {
                    resetAssistantMessageForLiveStream(regenMessageDiv, {
                        modelBadgeState,
                        localOnly: true
                    });
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const debugScopeKey = `regen:${regenerateConversationId || 'new'}:${normalizedRegenerateIndex}:${Date.now()}`;

                if (forceContextCompression && isDebugConsoleEnabled()) {
                    appendDebugConsoleEntry({
                        direction: 'client->local',
                        stage: 'force_context_compression_request',
                        title: 'Force Compression',
                        payload: {
                            applied: true,
                            conversation_id: regenerateConversationId,
                            model_name: String(modelName || '')
                        }
                    });
                }

                while (true) {
                    const { value, done } = await reader.read();

                    if (value) {
                        buffer += decoder.decode(value, { stream: !done });
                    }

                    if (done) {
                        buffer += decoder.decode();
                    }

                    const lines = buffer.split('\n');
                    buffer = done ? '' : (lines.pop() || '');

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;

                        try {
                            const dataText = line.substring(6);

                            if (dataText === '[DONE]') {
                                streamCompleted = true;
                                continue;
                            }

                            const data = jsonParseSafe(dataText);

                            if (!data) continue;

                            if (data.type === 'stream_session') {
                                const sid = String(data.stream_id || '').trim();

                                if (isTerminalStreamSessionChunk(data)) {
                                    streamCompleted = true;
                                    clearActiveStreamResumeState();
                                    markConversationStreamFinished(regenerateConversationId, {
                                        error: String(data.error || '').trim()
                                    });
                                    continue;
                                }

                                if (sid) {
                                    if (regenMessageDiv) {
                                        regenMessageDiv.dataset.streamId = sid;
                                    }

                                    saveActiveStreamResumeState({
                                        stream_id: sid,
                                        conversation_id: String(data.conversation_id || regenerateConversationId || '').trim(),
                                        assistant_index: normalizedRegenerateIndex,
                                        is_regenerate: true,
                                        regenerate_index: normalizedRegenerateIndex,
                                        started_at: Date.now()
                                    });
                                    setConversationStreamState(regenerateConversationId, {
                                        stream_id: sid,
                                        status: 'running',
                                        unread: false,
                                        assistant_index: normalizedRegenerateIndex,
                                        is_regenerate: true,
                                        regenerate_index: normalizedRegenerateIndex,
                                        stopping: false
                                    });

                                    if (!isCurrentConversation(regenerateConversationId)) {
                                        markStreamControllerDetachOnly(regenAbortController, {
                                            conversation_id: regenerateConversationId,
                                            stream_id: sid,
                                            reason: 'regen_session_after_navigation'
                                        });
                                    }
                                }
                            }

                            if (Number.isFinite(Number(data._stream_seq))) {
                                patchActiveStreamResumeState({ last_seq: Number(data._stream_seq) });
                            }

                            if (data.type === 'stream_cancel_requested') {
                                streamAbortedByUser = true;
                                setConversationStreamState(regenerateConversationId, {
                                    stopping: true,
                                    monitoring: false
                                });
                                syncGenerationStateForCurrentConversation();

                                try {
                                    regenAbortController.abort();
                                } catch (abortError) {
                                    console.error('[StreamCancel] regenerate abort after cancel event failed', abortError);
                                }

                                continue;
                            }

                            if (data.type === 'model_info') {
                                modelBadgeState.modelName = String(data.model_name || modelBadgeState.modelName || '');
                                modelBadgeState.searchFlag = (typeof data.search_enabled === 'boolean')
                                    ? data.search_enabled
                                    : modelBadgeState.searchFlag;
                                updateMessageModelBadge(regenMessageDiv, modelBadgeState);
                            } else if (data.type === 'prompt_token_profile') {
                                applyPromptTokenProfileChunk(data);
                            } else if (data.type === 'debug_trace') {
                                appendDebugTraceChunk(data, debugScopeKey);
                            } else if (data.type === 'content') {
                                let contentDelta = String(data.content || '');

                                if (!accumulatedContent && !currentSegmentContent) {
                                    const checked = stripHistoryTimeMarkerEchoForStream(`${liveHistoryTimeMarkerBuffer}${contentDelta}`);

                                    if (checked.pending) {
                                        liveHistoryTimeMarkerBuffer = `${liveHistoryTimeMarkerBuffer}${contentDelta}`;
                                        continue;
                                    }

                                    liveHistoryTimeMarkerBuffer = '';
                                    contentDelta = checked.text;

                                    if (checked.removed) {
                                        console.warn('[StreamSanitize] stripped echoed history time marker from regenerate stream chunk');
                                    }

                                    if (!contentDelta) {
                                        continue;
                                    }
                                }

                                accumulatedContent += contentDelta;

                                if (isDebugConsoleEnabled()) {
                                    appendDebugConsoleEntry({
                                        direction: 'model->server',
                                        stage: 'model_reply',
                                        title: 'Model Reply',
                                        payload: accumulatedContent,
                                        replaceKey: `${debugScopeKey}:reply`
                                    });
                                }

                                if (!currentContentSpan || !currentContentSpan.isConnected) {
                                    currentContentSpan = createContentSpan(regenMessageDiv);
                                    currentSegmentContent = '';
                                }

                                currentSegmentContent += contentDelta;
                                hasRenderedContentDelta = true;
                                renderStreamingContentSegment(regenMessageDiv, currentContentSpan, currentSegmentContent, 'regen-live-segment');

                                if (getShouldAutoScroll()) {
                                    pinMessagesToBottomFor(700);
                                }
                            } else if (data.type === 'done') {
                                const doneContent = String(data.content || '');

                                if (doneContent) {
                                    accumulatedContent = doneContent;

                                    if (!hasRenderedContentDelta && !hasTimelineBoundary) {
                                        updateMessageDivContent(normalizedRegenerateIndex, accumulatedContent, regenMessageDiv);
                                    } else if (!hasRenderedContentDelta && hasTimelineBoundary) {
                                        needsCanonicalTimelineSync = true;
                                    }
                                }
                            } else if (data.type === 'reasoning_content') {
                                updateMessageDivThinking(normalizedRegenerateIndex, data.content, regenMessageDiv);
                                hasTimelineBoundary = true;
                                currentContentSpan = null;
                                currentSegmentContent = '';
                            } else if (
                                data.type === 'web_search' ||
                                data.type === 'search_meta' ||
                                data.type === 'function_call_delta' ||
                                data.type === 'function_call' ||
                                data.type === 'function_call_running' ||
                                data.type === 'function_result' ||
                                data.type === 'context_compression_status' ||
                                data.type === 'learning_card' ||
                                data.type === 'question' ||
                                data.type === 'puzzle'
                            ) {
                                hasTimelineBoundary = true;
                                regenMessageDiv.__reasoningSegmentOpen = false;
                                currentContentSpan = null;
                                currentSegmentContent = '';
                                updateMessageDivTools(normalizedRegenerateIndex, data, regenMessageDiv);

                                if (
                                    data.type === 'function_call_delta' ||
                                    data.type === 'function_call' ||
                                    data.type === 'function_call_running'
                                ) {
                                    await yieldToolStreamPaintForChunk(
                                        regenMessageDiv,
                                        data,
                                        data.type !== 'function_call_delta'
                                    );
                                }
                            } else if (data.type === 'token_usage') {
                                onTokenStreamUsageChunk(data);
                                applyUsageChunkToBadgeState(modelBadgeUsageState, data);
                                modelBadgeState.inputTokens = modelBadgeUsageState.input;
                                modelBadgeState.outputTokens = modelBadgeUsageState.output;
                                updateMessageModelBadge(regenMessageDiv, modelBadgeState);
                            } else if (data.type === 'error') {
                                streamEndedWithError = true;
                                streamErrorRetryable = !!data.retryable;
                                streamErrorCode = String(data.error_code || '').trim().toLowerCase();
                                streamErrorMessage = String(data.content || '').trim() || '重新回答失败';
                                appendDebugConsoleEntry({
                                    direction: 'model->server',
                                    stage: 'error',
                                    title: 'Error',
                                    payload: {
                                        content: streamErrorMessage,
                                        error_code: streamErrorCode,
                                        retryable: streamErrorRetryable
                                    }
                                });

                                if (streamErrorRetryable || streamErrorCode === 'network_error') {
                                    appendErrorEvent(regenMessageDiv, streamErrorMessage);
                                    showToast('连接中断，可刷新页面后自动重连此条回复');
                                } else {
                                    showToast(streamErrorMessage);
                                }
                            }

                            scheduleLearningSidebarBridgeNotify();
                        } catch (error) { }
                    }

                    if (done) {
                        streamCompleted = true;
                        break;
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    if (regenAbortController && regenAbortController.__nexoraDetachOnly) {
                        streamDetachedByNavigation = true;
                    } else {
                        streamAbortedByUser = true;
                        console.log('Generation stopped.');
                    }
                } else {
                    console.error(error);

                    const errText = String((error && error.message) || error || 'unknown');
                    const isRetryableNetwork = isLikelyRetryableNetworkErrorText(errText);
                    streamEndedWithError = true;
                    streamErrorRetryable = !!isRetryableNetwork;
                    streamErrorCode = isRetryableNetwork ? 'network_error' : 'client_exception';
                    streamErrorMessage = errText;

                    const displayError = streamErrorRetryable
                        ? '连接中断，可刷新页面后自动重连此条回复'
                        : `重新回答失败: ${errText}`;

                    if (streamErrorRetryable) {
                        appendErrorEvent(regenMessageDiv, displayError);
                    }

                    showToast(displayError);
                }
            } finally {
                setIsGenerating(false);
                updateSendButtonState();

                const streamErroredRetryable = !!(streamEndedWithError && (streamErrorRetryable || streamErrorCode === 'network_error'));
                const streamEndedTerminally = !!(streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable));

                if (streamEndedTerminally && regenMessageDiv) regenMessageDiv.classList.remove('pending');

                if (streamCompleted) {
                    if (regenMessageDiv) regenMessageDiv.dataset.localOnly = '0';

                    finalizeMessageRenderForIndex(normalizedRegenerateIndex, regenMessageDiv);

                    const targetAfterStream = resolveAssistantStreamMessageDiv(normalizedRegenerateIndex, regenMessageDiv);
                    const hasRenderedContent = !!(targetAfterStream && (() => {
                        const body = targetAfterStream.querySelector('.content-body');

                        if (body) {
                            const source = String(
                                (typeof body.__sourceMarkdown === 'string')
                                    ? body.__sourceMarkdown
                                    : (body.textContent || '')
                            ).trim();

                            if (source) return true;
                        }

                        const tools = targetAfterStream.querySelector('.tool-usage, .add-basis-view');

                        if (tools) return true;

                        const thinking = targetAfterStream.querySelector('.thinking-content');

                        if (thinking && String(thinking.textContent || '').trim()) return true;

                        return false;
                    })());
                    const shouldSyncFromServer = (
                        !targetAfterStream
                        || !targetAfterStream.isConnected
                        || !hasRenderedContent
                        || needsCanonicalTimelineSync
                    );

                    if (shouldSyncFromServer && regenerateConversationId && isCurrentConversation(regenerateConversationId)) {
                        try {
                            const convRes = await fetch(`/api/conversations/${encodeURIComponent(regenerateConversationId)}`);
                            const convData = await convRes.json().catch(() => ({}));

                            if (convData && convData.success && convData.conversation && Array.isArray(convData.conversation.messages)) {
                                let syncMsgs = convData.conversation.messages;

                                if (normalizedRegenerateIndex >= 0 && normalizedRegenerateIndex < syncMsgs.length) {
                                    syncMsgs = syncMsgs.slice(0, normalizedRegenerateIndex + 1);
                                }

                                renderMessages(syncMsgs, true, { instant: true });
                            }
                        } catch (_) {
                            // ignore canonical timeline sync errors
                        }
                    }
                }

                if (streamAbortedByUser && !streamCompleted) {
                    if (regenMessageDiv) regenMessageDiv.dataset.localOnly = '1';

                    showToast('已中断，等待服务端同步结果');
                }

                if (streamEndedWithError && !streamErroredRetryable) {
                    const terminalText = renderAssistantTerminalErrorMessage(
                        regenMessageDiv,
                        normalizedRegenerateIndex,
                        accumulatedContent,
                        streamErrorMessage || '重新回答失败'
                    );
                    accumulatedContent = terminalText;

                    if (regenMessageDiv) regenMessageDiv.dataset.localOnly = '1';
                }

                if (streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable)) {
                    if (streamCompleted && normalizedRegenerateIndex >= 0) {
                        setPendingRegenerateFilter({
                            conversationId: regenerateConversationId,
                            index: normalizedRegenerateIndex
                        });
                    }

                    clearActiveStreamResumeState();
                    removeConversationStreamState(regenerateConversationId);
                } else if (streamDetachedByNavigation) {
                    const existingState = getConversationStreamState(regenerateConversationId);
                    const ownsController = !!(existingState && existingState.controller === regenAbortController);
                    const latestState = setConversationStreamState(regenerateConversationId, {
                        status: 'running',
                        ...(ownsController ? { controller: null, monitoring: false } : {})
                    });

                    if (shouldAutoAttachDetachedStream(regenAbortController)) {
                        attachDetachedStreamConsumer(regenerateConversationId, latestState);
                    }
                } else if (streamErroredRetryable) {
                    setConversationStreamState(regenerateConversationId, {
                        status: 'running',
                        controller: null,
                        monitoring: false,
                        error: streamErrorMessage || ''
                    });
                }

                if (streamEndedTerminally && regenerateConversationId && isCurrentConversation(regenerateConversationId)) {
                    await finishTokenMiniStreaming(regenerateConversationId);

                    try {
                        const convRes = await fetch(`/api/conversations/${encodeURIComponent(regenerateConversationId)}`);
                        const convData = await convRes.json().catch(() => ({}));

                        if (convData && convData.success && convData.conversation && Array.isArray(convData.conversation.messages)) {
                            let msgs = convData.conversation.messages;

                            if (streamEndedTerminally && normalizedRegenerateIndex >= 0 && normalizedRegenerateIndex < msgs.length) {
                                msgs = msgs.slice(0, normalizedRegenerateIndex + 1);
                            }

                            renderMessages(msgs, true, { instant: true });
                            refreshConversationImageHistoryFlag(msgs);
                            applyTokenBudgetFromConversationMessages(msgs);
                            await refreshTokenMiniForConversation(regenerateConversationId, { keepStreamPart: false });
                        }
                    } catch (_) {}
                }

                loadConversations();
                scheduleLearningSidebarBridgeNotify(0);
            }
        }

        async function switchVersion(msgIndex, verIndex) {
            if (verIndex === null || verIndex === undefined || Number.isNaN(Number(verIndex))) return;

            try {
                const res = await fetch('/api/switch_version', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id: getCurrentConversationId(),
                        message_index: msgIndex,
                        version_index: Number(verIndex)
                    })
                });
                const data = await res.json();

                if (data.success) {
                    const convRes = await fetch(`/api/conversations/${getCurrentConversationId()}`);
                    const convData = await convRes.json();

                    if (convData.success) {
                        const msgs = convData.conversation.messages || [];
                        renderMessages(msgs, true);
                        applyTokenBudgetFromConversationMessages(msgs);
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }

        return {
            getMessageRowByIndex,
            getDeleteRoundRangeFromDom,
            optimisticHideDeleteRound,
            rollbackOptimisticHide,
            copyGeneratedInfo,
            copyUserMessage,
            deleteMessage,
            confirmDelete,
            confirmRegenerate,
            resolveAssistantMessageModelName,
            resolveRegenerateModelName,
            startRegenerate,
            switchVersion,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createMessagesController,
        createUserPromptEditController,
        createMessageActionsController,
    });
})();
