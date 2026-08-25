(function () {
    'use strict';

    const MODULE_NAME = 'streamLifecycle';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Stream Lifecycle 模块');
        }

        return shared;
    }

    function requireLifecycleDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_stream_lifecycle 缺少依赖: ${name}`);
        }

        return value;
    }

    function requireLifecycleNumberDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = Number(source ? source[name] : NaN);

        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`chat_stream_lifecycle 缺少有效数值依赖: ${name}`);
        }

        return value;
    }

    function isAbortControllerAborted(controller) {
        return !!(controller && controller.signal && controller.signal.aborted);
    }

    function markStreamControllerDetachOnly(controller, context = {}) {
        if (!controller) {
            return false;
        }

        if (isAbortControllerAborted(controller)) {
            return false;
        }

        try {
            controller.__nexoraDetachOnly = true;
            controller.__nexoraSuppressDetachAutoAttach = !!context.suppressAutoAttach;
            controller.abort();
            console.debug('[StreamDetach] detached visible stream reader', {
                conversation_id: String(context.conversation_id || ''),
                stream_id: String(context.stream_id || ''),
                reason: String(context.reason || 'navigation'),
                suppress_auto_attach: !!context.suppressAutoAttach
            });
            return true;
        } catch (abortError) {
            console.error('[StreamDetach] abort visible stream reader failed', {
                conversation_id: String(context.conversation_id || ''),
                stream_id: String(context.stream_id || ''),
                error: abortError
            });
            return false;
        }
    }

    function shouldAutoAttachDetachedStream(controller) {
        return !(controller && controller.__nexoraSuppressDetachAutoAttach);
    }

    function createStreamLifecycleController(deps = {}) {
        const attachRetryDelayMs = requireLifecycleNumberDependency(deps, 'attachRetryDelayMs');
        const attachRetryMax = requireLifecycleNumberDependency(deps, 'attachRetryMax');
        const isCurrentConversation = requireLifecycleDependency(deps, 'isCurrentConversation');
        const getCurrentConversationId = requireLifecycleDependency(deps, 'getCurrentConversationId');
        const getConversationStreamState = requireLifecycleDependency(deps, 'getConversationStreamState');
        const setConversationStreamState = requireLifecycleDependency(deps, 'setConversationStreamState');
        const normalizeConversationStreamState = requireLifecycleDependency(deps, 'normalizeConversationStreamState');
        const normalizeStreamMessageIndex = requireLifecycleDependency(deps, 'normalizeStreamMessageIndex');
        const syncGenerationStateForCurrentConversation = requireLifecycleDependency(deps, 'syncGenerationStateForCurrentConversation');
        const syncStoredConversationStreamStatus = requireLifecycleDependency(deps, 'syncStoredConversationStreamStatus');
        const resumeActiveStreamAfterReload = requireLifecycleDependency(deps, 'resumeActiveStreamAfterReload');
        const attachStreamSessionMonitor = requireLifecycleDependency(deps, 'attachStreamSessionMonitor');
        const getVisibleMessageCount = requireLifecycleDependency(deps, 'getVisibleMessageCount');

        const streamAttachRetryTimers = new Map();

        function clearStreamAttachRetry(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            const timer = streamAttachRetryTimers.get(cid);

            if (timer) {
                clearTimeout(timer);
            }

            streamAttachRetryTimers.delete(cid);
        }

        function clearAllStreamAttachRetries() {
            streamAttachRetryTimers.forEach((timer) => {
                if (timer) {
                    clearTimeout(timer);
                }
            });
            streamAttachRetryTimers.clear();
        }

        function scheduleStreamAttachRetry(conversationId, reason = 'pending_stream_id', attempt = 1) {
            const cid = String(conversationId || '').trim();

            if (!cid || !isCurrentConversation(cid)) {
                return;
            }

            if (streamAttachRetryTimers.has(cid)) {
                return;
            }

            const safeAttempt = Math.max(1, Number(attempt) || 1);
            const delayMs = Math.min(1200, attachRetryDelayMs * safeAttempt);
            const timer = setTimeout(async () => {
                streamAttachRetryTimers.delete(cid);

                if (!isCurrentConversation(cid)) {
                    return;
                }

                await syncStoredConversationStreamStatus({ conversationIds: [cid] });

                const latestState = getConversationStreamState(cid);
                const latestStatus = String(latestState && latestState.status || '').trim();
                const latestStreamId = String(latestState && latestState.stream_id || '').trim();

                if (latestStatus === 'running' && latestStreamId) {
                    attachRunningStreamToCurrentConversation(cid);
                    return;
                }

                if (latestStatus === 'running' && safeAttempt < attachRetryMax) {
                    scheduleStreamAttachRetry(cid, reason, safeAttempt + 1);
                    return;
                }

                console.error('[StreamAttach] stream id still unresolved for running conversation', {
                    conversation_id: cid,
                    reason: String(reason || ''),
                    attempt: safeAttempt,
                    status: latestStatus || 'none',
                    has_state: !!latestState
                });
                syncGenerationStateForCurrentConversation();
            }, delayMs);

            streamAttachRetryTimers.set(cid, timer);
        }

        function attachRunningStreamToCurrentConversation(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid || !isCurrentConversation(cid)) {
                return;
            }

            const state = getConversationStreamState(cid);

            if (!state || String(state.status || '') !== 'running') {
                console.debug('[StreamAttach] no running stream to attach', {
                    conversation_id: cid,
                    has_state: !!state,
                    status: state ? String(state.status || '') : '',
                    stream_id: state ? String(state.stream_id || '') : ''
                });
                syncGenerationStateForCurrentConversation();
                return;
            }

            if (!String(state.stream_id || '').trim()) {
                console.warn('[StreamAttach] running conversation has no stream id yet', {
                    conversation_id: cid,
                    has_controller: !!state.controller,
                    controller_aborted: isAbortControllerAborted(state.controller),
                    monitoring: !!state.monitoring
                });
                scheduleStreamAttachRetry(cid, 'missing_stream_id');
                syncGenerationStateForCurrentConversation();
                return;
            }

            clearStreamAttachRetry(cid);

            if (!Number.isFinite(Number(state.assistant_index)) || Number(state.assistant_index) < 0) {
                const regenerateIndex = state.is_regenerate
                    ? normalizeStreamMessageIndex(state.regenerate_index)
                    : null;
                const nextAssistantIndex = regenerateIndex !== null
                    ? regenerateIndex
                    : getVisibleMessageCount();

                setConversationStreamState(cid, {
                    assistant_index: nextAssistantIndex
                });
                console.debug('[StreamAttach] inferred assistant index for running stream', {
                    conversation_id: cid,
                    stream_id: String(state.stream_id || ''),
                    assistant_index: nextAssistantIndex
                });
            }

            const latestState = getConversationStreamState(cid) || state;

            if (latestState.controller && !latestState.monitoring && !isAbortControllerAborted(latestState.controller)) {
                console.debug('[StreamAttach] active stream reader is already bound', {
                    conversation_id: cid,
                    stream_id: String(latestState.stream_id || '')
                });
                syncGenerationStateForCurrentConversation();
                return;
            }

            void resumeActiveStreamAfterReload({
                force: true,
                state: latestState,
                conversationId: cid,
                allowSwitch: false,
                showToast: false
            });
        }

        function detachCurrentVisibleStreamForNavigation(nextConversationId = '') {
            const activeCid = String(getCurrentConversationId() || '').trim();
            const nextCid = String(nextConversationId || '').trim();

            if (!activeCid || (nextCid && activeCid === nextCid)) {
                return;
            }

            const state = getConversationStreamState(activeCid);

            if (!state || String(state.status || '') !== 'running') {
                return;
            }

            const streamId = String(state.stream_id || '').trim();
            const controller = state.controller || null;
            const patch = {
                status: 'running',
                monitoring: false
            };

            if (streamId && controller) {
                markStreamControllerDetachOnly(controller, {
                    conversation_id: activeCid,
                    stream_id: streamId,
                    reason: 'conversation_navigation'
                });
                patch.controller = null;
            } else if (controller && !isAbortControllerAborted(controller)) {
                try {
                    controller.abort();
                } catch (abortError) {
                    console.error('[StreamDetach] abort stream reader during navigation failed', {
                        conversation_id: activeCid,
                        stream_id: streamId,
                        error: abortError
                    });
                }
                patch.controller = null;
            }

            const latestState = setConversationStreamState(activeCid, patch) || state;

            if (streamId) {
                attachStreamSessionMonitor({
                    ...latestState,
                    conversation_id: activeCid,
                    stream_id: streamId,
                    controller: null,
                    monitoring: false
                });
            }
        }

        function detachVisibleStreamReaderBeforeConversationRender(conversationId = '') {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            const state = getConversationStreamState(cid);

            if (!state || String(state.status || '') !== 'running') {
                return;
            }

            const controller = state.controller || null;

            if (!controller || isAbortControllerAborted(controller)) {
                return;
            }

            const streamId = String(state.stream_id || '').trim();
            const patch = {
                status: 'running',
                controller: null,
                monitoring: false
            };

            if (streamId && !state.monitoring) {
                markStreamControllerDetachOnly(controller, {
                    conversation_id: cid,
                    stream_id: streamId,
                    reason: 'conversation_panel_reload',
                    suppressAutoAttach: true
                });
                setConversationStreamState(cid, patch);
                return;
            }

            try {
                controller.abort();
            } catch (abortError) {
                console.error('[StreamDetach] abort stale stream reader before conversation render failed', {
                    conversation_id: cid,
                    stream_id: streamId,
                    monitoring: !!state.monitoring,
                    error: abortError
                });
            }

            setConversationStreamState(cid, patch);
        }

        function attachDetachedStreamConsumer(conversationId, state = null) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            const latestState = normalizeConversationStreamState(state || getConversationStreamState(cid));

            if (!latestState || !String(latestState.stream_id || '').trim()) {
                return;
            }

            const detachedState = {
                ...latestState,
                conversation_id: cid,
                controller: null,
                monitoring: false
            };

            if (isCurrentConversation(cid)) {
                const existingState = getConversationStreamState(cid);

                if (
                    existingState
                    && existingState.monitoring
                    && existingState.controller
                    && !isAbortControllerAborted(existingState.controller)
                ) {
                    try {
                        existingState.controller.abort();
                    } catch (abortError) {
                        console.error('[StreamAttach] abort background monitor for foreground takeover failed', {
                            conversation_id: cid,
                            stream_id: String(existingState.stream_id || ''),
                            error: abortError
                        });
                    }
                }

                void resumeActiveStreamAfterReload({
                    force: true,
                    state: detachedState,
                    conversationId: cid,
                    allowSwitch: false,
                    showToast: false
                });
                return;
            }

            attachStreamSessionMonitor(detachedState);
        }

        return {
            attachRunningStreamToCurrentConversation,
            clearStreamAttachRetry,
            clearAllStreamAttachRetries,
            scheduleStreamAttachRetry,
            isAbortControllerAborted,
            markStreamControllerDetachOnly,
            shouldAutoAttachDetachedStream,
            detachCurrentVisibleStreamForNavigation,
            detachVisibleStreamReaderBeforeConversationRender,
            attachDetachedStreamConsumer,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createStreamLifecycleController,
        isAbortControllerAborted,
        markStreamControllerDetachOnly,
        shouldAutoAttachDetachedStream,
    });
})();
