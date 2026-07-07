(function () {
    'use strict';

    const MODULE_NAME = 'conversations';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Conversations 模块');
        }

        return shared;
    }

    function requireConversationDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_conversations 缺少依赖: ${name}`);
        }

        return value;
    }

    function getDirectConversationUrlTarget(params = null) {
        const source = params instanceof URLSearchParams
            ? params
            : new URLSearchParams(window.location.search || '');

        return String(
            source.get('cid')
            || source.get('id')
            || ''
        ).trim();
    }

    function hasConversationUrlTarget(params = null) {
        const source = params instanceof URLSearchParams
            ? params
            : new URLSearchParams(window.location.search || '');

        return !!(
            getDirectConversationUrlTarget(source)
            || String(source.get('shared_cid') || '').trim()
        );
    }

    function readConversationId(item) {
        const source = item && typeof item === 'object' ? item : {};

        return String(source.conversation_id || source.id || '').trim();
    }

    function readConversationTitle(item) {
        const source = item && typeof item === 'object' ? item : {};

        return String(source.title || source.preview || '').trim();
    }

    function readConversationUpdatedTimestamp(item) {
        const source = item && typeof item === 'object' ? item : {};
        const timestamp = Date.parse(String(source.updated_at || ''));

        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function sortConversationListForDisplay(conversations) {
        const orderedConversations = Array.isArray(conversations) ? [...conversations] : [];

        orderedConversations.sort((a, b) => {
            const aPin = !!(a && a.pin);
            const bPin = !!(b && b.pin);

            if (aPin !== bPin) {
                return aPin ? -1 : 1;
            }

            return readConversationUpdatedTimestamp(b) - readConversationUpdatedTimestamp(a);
        });

        return orderedConversations;
    }

    function createConversationNavigationController(deps = {}) {
        const getKnowledgeViewerElement = requireConversationDependency(deps, 'getKnowledgeViewerElement');
        const resetWorkspaceReadonlyConversationStateForConversationLoad = requireConversationDependency(deps, 'resetWorkspaceReadonlyConversationStateForConversationLoad');
        const closeLearningReaderFromHost = requireConversationDependency(deps, 'closeLearningReaderFromHost');
        const closeKnowledgeView = requireConversationDependency(deps, 'closeKnowledgeView');
        const exitLearningFeedComposeMode = requireConversationDependency(deps, 'exitLearningFeedComposeMode');
        const setCurrentConversationHasImageHistory = requireConversationDependency(deps, 'setCurrentConversationHasImageHistory');
        const getLearningSidebarMode = requireConversationDependency(deps, 'getLearningSidebarMode');
        const normalizeWorkspaceConversationHeaderContext = requireConversationDependency(deps, 'normalizeWorkspaceConversationHeaderContext');
        const renderWorkspaceConversationHierarchy = requireConversationDependency(deps, 'renderWorkspaceConversationHierarchy');
        const resolveNewConversationMode = requireConversationDependency(deps, 'resolveNewConversationMode');
        const shouldPreserveLearningMainPanelForNewConversation = requireConversationDependency(deps, 'shouldPreserveLearningMainPanelForNewConversation');
        const shouldKeepCurrentRunningConversationPanel = requireConversationDependency(deps, 'shouldKeepCurrentRunningConversationPanel');
        const resetCurrentConversationLongtermState = requireConversationDependency(deps, 'resetCurrentConversationLongtermState');
        const detachCurrentVisibleStreamForNavigation = requireConversationDependency(deps, 'detachCurrentVisibleStreamForNavigation');
        const setCurrentConversationId = requireConversationDependency(deps, 'setCurrentConversationId');
        const beginConversationNavigation = requireConversationDependency(deps, 'beginConversationNavigation');
        const resetKnowledgeNavigationForConversationLoad = requireConversationDependency(deps, 'resetKnowledgeNavigationForConversationLoad');
        const resetConversationMessageWindowState = requireConversationDependency(deps, 'resetConversationMessageWindowState');
        const syncBrowserCurrentConversation = requireConversationDependency(deps, 'syncBrowserCurrentConversation');
        const invalidateConversationListForStreamState = requireConversationDependency(deps, 'invalidateConversationListForStreamState');
        const syncGenerationStateForCurrentConversation = requireConversationDependency(deps, 'syncGenerationStateForCurrentConversation');
        const setLearningHeaderModeForConversationLoad = requireConversationDependency(deps, 'setLearningHeaderModeForConversationLoad');
        const clearLearningWelcomeState = requireConversationDependency(deps, 'clearLearningWelcomeState');
        const resetLearningStateForNewConversation = requireConversationDependency(deps, 'resetLearningStateForNewConversation');
        const syncNotesForConversation = requireConversationDependency(deps, 'syncNotesForConversation');
        const applyLearningSidebarMode = requireConversationDependency(deps, 'applyLearningSidebarMode');
        const clearWorkspaceHierarchySlot = requireConversationDependency(deps, 'clearWorkspaceHierarchySlot');
        const renderWelcomeScreen = requireConversationDependency(deps, 'renderWelcomeScreen');
        const getMessagesContainer = requireConversationDependency(deps, 'getMessagesContainer');
        const detachVisibleStreamReaderBeforeConversationRender = requireConversationDependency(deps, 'detachVisibleStreamReaderBeforeConversationRender');
        const resetTurnIndicatorForConversationLoad = requireConversationDependency(deps, 'resetTurnIndicatorForConversationLoad');
        const resetTokenUiForConversationLoad = requireConversationDependency(deps, 'resetTokenUiForConversationLoad');
        const pushConversationHistory = requireConversationDependency(deps, 'pushConversationHistory');
        const getConversationInitialMessageLimit = requireConversationDependency(deps, 'getConversationInitialMessageLimit');
        const isActiveConversationNavigation = requireConversationDependency(deps, 'isActiveConversationNavigation');
        const applyStreamSessionMetaRows = requireConversationDependency(deps, 'applyStreamSessionMetaRows');
        const getConversationStreamState = requireConversationDependency(deps, 'getConversationStreamState');
        const syncStoredConversationStreamStatus = requireConversationDependency(deps, 'syncStoredConversationStreamStatus');
        const getConversationTitleElement = requireConversationDependency(deps, 'getConversationTitleElement');
        const syncLearningHeaderMode = requireConversationDependency(deps, 'syncLearningHeaderMode');
        const resetTokenUiForNewConversation = requireConversationDependency(deps, 'resetTokenUiForNewConversation');
        const pushNewConversationHistory = requireConversationDependency(deps, 'pushNewConversationHistory');
        const loadConversations = requireConversationDependency(deps, 'loadConversations');
        const confirmModalAsync = requireConversationDependency(deps, 'confirmModalAsync');
        const removeConversationStreamState = requireConversationDependency(deps, 'removeConversationStreamState');
        const markConversationStreamRead = requireConversationDependency(deps, 'markConversationStreamRead');
        const attachRunningStreamToCurrentConversation = requireConversationDependency(deps, 'attachRunningStreamToCurrentConversation');
        const getCurrentConversationId = requireConversationDependency(deps, 'getCurrentConversationId');

        function closeVisibleKnowledgeView() {
            const viewer = getKnowledgeViewerElement();

            if (viewer && viewer.style && viewer.style.display !== 'none') {
                closeKnowledgeView();
            }
        }

        function syncWorkspaceHeaderForConversationLoad(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const workspaceHeaderContext = normalizeWorkspaceConversationHeaderContext(opts.workspaceContext);

            if (workspaceHeaderContext) {
                renderWorkspaceConversationHierarchy(workspaceHeaderContext);
                return;
            }

            clearWorkspaceHierarchySlot();
        }

        function prepareConversationLoad(id, options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const targetConversationId = String(id || '').trim();

            if (!targetConversationId) {
                return null;
            }

            resetWorkspaceReadonlyConversationStateForConversationLoad();
            closeLearningReaderFromHost('host_conversation_navigation', 'nexora');
            closeVisibleKnowledgeView();
            syncWorkspaceHeaderForConversationLoad(opts);

            const deferStreamAttach = !!opts.deferStreamAttach;

            if (!deferStreamAttach && shouldKeepCurrentRunningConversationPanel(targetConversationId, opts)) {
                markConversationStreamRead(targetConversationId);
                attachRunningStreamToCurrentConversation(targetConversationId);
                syncGenerationStateForCurrentConversation();
                loadConversations();

                return {
                    conversationId: targetConversationId,
                    deferStreamAttach,
                    navToken: null,
                    useCurrentRunningPanel: true
                };
            }

            const navToken = beginConversationNavigation(targetConversationId);
            detachCurrentVisibleStreamForNavigation(targetConversationId);
            resetKnowledgeNavigationForConversationLoad();
            resetConversationMessageWindowState(targetConversationId);
            setCurrentConversationId(targetConversationId);
            syncBrowserCurrentConversation();
            invalidateConversationListForStreamState();
            syncGenerationStateForCurrentConversation();
            setLearningHeaderModeForConversationLoad();
            void syncLearningHeaderMode();
            clearLearningWelcomeState();
            syncNotesForConversation(targetConversationId);

            const messagesContainer = getMessagesContainer();

            if (!messagesContainer) {
                throw new Error('chat_conversations 加载会话缺少消息容器');
            }

            messagesContainer.innerHTML = '';
            detachVisibleStreamReaderBeforeConversationRender(targetConversationId);
            resetTurnIndicatorForConversationLoad();
            resetTokenUiForConversationLoad(targetConversationId);

            if (opts.pushHistory !== false) {
                pushConversationHistory(targetConversationId);
            }

            return {
                conversationId: targetConversationId,
                deferStreamAttach,
                navToken,
                useCurrentRunningPanel: false
            };
        }

        function isRunningConversationStream(conversationId) {
            const streamState = getConversationStreamState(conversationId);

            return !!(streamState && String(streamState.status || '') === 'running');
        }

        async function refreshConversationLoadStreamStatus(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid || isRunningConversationStream(cid)) {
                return;
            }

            await syncStoredConversationStreamStatus({
                conversationIds: [cid],
                force: true
            });

            if (isRunningConversationStream(cid)) {
                return;
            }

            try {
                const statusRes = await fetch('/api/chat/stream/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversation_ids: [cid] })
                });
                const statusData = await statusRes.json().catch(() => ({}));

                if (statusData && Array.isArray(statusData.sessions)) {
                    applyStreamSessionMetaRows(statusData.sessions, cid);
                }
            } catch (error) {
                console.error('[ConversationNav] stream status refresh failed', error);
            }
        }

        async function loadConversationDetailWithStreamState(preparedLoad) {
            const loadState = preparedLoad && typeof preparedLoad === 'object' ? preparedLoad : {};
            const targetConversationId = String(loadState.conversationId || '').trim();
            const navToken = loadState.navToken;

            if (!targetConversationId || !navToken || !navToken.controller) {
                throw new Error('chat_conversations 加载会话详情缺少导航状态');
            }

            const conversationParams = new URLSearchParams();
            conversationParams.set('include_stream', '1');
            conversationParams.set('message_limit', String(getConversationInitialMessageLimit()));

            const res = await fetch(`/api/conversations/${encodeURIComponent(targetConversationId)}?${conversationParams.toString()}`, {
                signal: navToken.controller.signal
            });
            const data = await res.json();

            if (!isActiveConversationNavigation(navToken)) {
                return {
                    active: false,
                    data
                };
            }

            if (data && data.success && data.conversation) {
                applyStreamSessionMetaRows(data.stream_sessions, targetConversationId);
                markConversationStreamRead(targetConversationId);
                await refreshConversationLoadStreamStatus(targetConversationId);
                syncGenerationStateForCurrentConversation();
            }

            return {
                active: true,
                data
            };
        }

        async function createNewConversation(silent = false, targetMode = null, options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};

            closeVisibleKnowledgeView();
            exitLearningFeedComposeMode();
            setCurrentConversationHasImageHistory(false);

            const normalizedTargetMode = String(targetMode || '').trim().toLowerCase();
            const learningSidebarMode = String(getLearningSidebarMode() || '').trim().toLowerCase();
            const preferNexoraChat = normalizedTargetMode === 'chat' && learningSidebarMode === 'nexora';
            const resolvedMode = preferNexoraChat ? 'chat' : resolveNewConversationMode(targetMode);
            const preserveLearningMainPanel = shouldPreserveLearningMainPanelForNewConversation(resolvedMode);

            resetCurrentConversationLongtermState(resolvedMode);

            if (silent) {
                return;
            }

            detachCurrentVisibleStreamForNavigation('');
            setCurrentConversationId(null);
            resetConversationMessageWindowState('');
            syncGenerationStateForCurrentConversation();
            resetLearningStateForNewConversation(resolvedMode, preserveLearningMainPanel);
            syncNotesForConversation(null);
            applyLearningSidebarMode(resolvedMode === 'learning' ? 'learning' : 'nexora');
            clearWorkspaceHierarchySlot();
            await renderWelcomeScreen();

            const titleEl = getConversationTitleElement();

            if (!titleEl) {
                throw new Error('chat_conversations 新建会话缺少标题元素');
            }

            titleEl.textContent = resolvedMode === 'learning' ? 'New Learning' : 'New Chat';
            void syncLearningHeaderMode();
            resetTokenUiForNewConversation();

            if (opts.pushHistory !== false) {
                pushNewConversationHistory();
            }

            loadConversations();
        }

        async function deleteConversation(id) {
            const cid = String(id || '').trim();

            if (!cid) {
                return;
            }

            const ok = await confirmModalAsync('删除会话', '确定删除该会话吗？此操作不可撤销。', 'danger');

            if (!ok) {
                return;
            }

            removeConversationStreamState(cid);
            await fetch(`/api/conversations/${encodeURIComponent(cid)}`, { method: 'DELETE' });

            if (String(getCurrentConversationId() || '').trim() === cid) {
                await createNewConversation();
            }

            loadConversations();
        }

        return {
            prepareConversationLoad,
            loadConversationDetailWithStreamState,
            createNewConversation,
            deleteConversation
        };
    }

    function createConversationListController(deps = {}) {
        const getConversationListElement = requireConversationDependency(deps, 'getConversationListElement');
        const getCurrentConversationId = requireConversationDependency(deps, 'getCurrentConversationId');
        const getConversationStreamState = requireConversationDependency(deps, 'getConversationStreamState');
        const getConversationListCache = requireConversationDependency(deps, 'getConversationListCache');
        const setConversationListCache = requireConversationDependency(deps, 'setConversationListCache');
        const getConversationTitleElement = requireConversationDependency(deps, 'getConversationTitleElement');
        const getConversationRenameElements = requireConversationDependency(deps, 'getConversationRenameElements');
        const bindBackdropSafeClose = requireConversationDependency(deps, 'bindBackdropSafeClose');
        const showToast = requireConversationDependency(deps, 'showToast');
        const isChatMobileLayout = requireConversationDependency(deps, 'isChatMobileLayout');
        const showPinContextMenu = requireConversationDependency(deps, 'showPinContextMenu');
        const getCurrentViewingKnowledge = requireConversationDependency(deps, 'getCurrentViewingKnowledge');
        const closeKnowledgeView = requireConversationDependency(deps, 'closeKnowledgeView');
        const markConversationStreamRead = requireConversationDependency(deps, 'markConversationStreamRead');
        const loadConversation = requireConversationDependency(deps, 'loadConversation');
        const deleteConversation = requireConversationDependency(deps, 'deleteConversation');

        let requestSeq = 0;
        let renderSignature = '';
        let conversationRenameState = {
            conversationId: '',
            initialTitle: '',
            saving: false
        };

        async function loadConversations() {
            const currentRequestSeq = requestSeq + 1;
            requestSeq = currentRequestSeq;

            try {
                const res = await fetch('/api/conversations');
                const data = await res.json();

                if (currentRequestSeq !== requestSeq) {
                    return;
                }

                const list = Array.isArray(data) ? data : (data.conversations || []);
                const nextList = Array.isArray(list) ? [...list] : [];

                setConversationListCache(nextList);
                renderConversationList(nextList);
            } catch (error) {
                console.error('Failed to load conversations', error);
            }
        }

        async function setConversationPinned(conversationId, pin) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return false;
            }

            const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}/pin`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: !!pin })
            });
            const data = await res.json();

            return !!(data && data.success);
        }

        async function setConversationTitle(conversationId, title) {
            const cid = String(conversationId || '').trim();
            const safeTitle = String(title || '').trim();

            if (!cid || !safeTitle) {
                return false;
            }

            const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}/title`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: safeTitle })
            });
            const data = await res.json();

            return !!(data && data.success);
        }

        function getConversationListCacheSource() {
            const source = getConversationListCache();

            if (!Array.isArray(source)) {
                throw new Error('chat_conversations 会话列表缓存必须是数组');
            }

            return source;
        }

        function patchConversationListCache(conversationId, patcher) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return false;
            }

            let found = false;
            const source = getConversationListCacheSource();
            const nextList = source.map((item) => {
                const src = item && typeof item === 'object' ? item : {};
                const itemId = readConversationId(src);

                if (itemId !== cid) {
                    return src;
                }

                found = true;
                return patcher(src);
            });

            if (!found) {
                return false;
            }

            setConversationListCache(nextList);
            renderConversationList(nextList);

            return true;
        }

        function setConversationPinLocal(conversationId, pin) {
            return patchConversationListCache(conversationId, (src) => ({
                ...src,
                pin: !!pin
            }));
        }

        function getConversationTitleFromCache(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return '';
            }

            const source = getConversationListCacheSource();

            for (const item of source) {
                const itemId = readConversationId(item);

                if (itemId !== cid) {
                    continue;
                }

                return readConversationTitle(item);
            }

            return '';
        }

        function setConversationTitleLocal(conversationId, title) {
            const cid = String(conversationId || '').trim();
            const safeTitle = String(title || '').trim();

            if (!cid || !safeTitle) {
                return false;
            }

            const patched = patchConversationListCache(cid, (src) => ({
                ...src,
                title: safeTitle
            }));

            if (patched && String(getCurrentConversationId() || '').trim() === cid) {
                const titleEl = getConversationTitleElement();

                if (!titleEl) {
                    throw new Error('chat_conversations 缺少会话标题元素');
                }

                titleEl.textContent = safeTitle;
            }

            return patched;
        }

        function requireConversationRenameElements() {
            const elements = getConversationRenameElements();

            if (!elements || typeof elements !== 'object') {
                throw new Error('chat_conversations 缺少会话重命名弹窗元素集合');
            }

            const resolved = {
                modal: elements.modal,
                input: elements.input,
                closeBtn: elements.closeBtn,
                cancelBtn: elements.cancelBtn,
                saveBtn: elements.saveBtn
            };
            const missingNames = Object.keys(resolved).filter((name) => !resolved[name]);

            if (missingNames.length) {
                throw new Error(`chat_conversations 会话重命名弹窗缺少元素: ${missingNames.join(', ')}`);
            }

            return resolved;
        }

        function resetConversationRenameState() {
            conversationRenameState = {
                conversationId: '',
                initialTitle: '',
                saving: false
            };
        }

        function closeConversationRenameModal(force = false) {
            if (conversationRenameState.saving && !force) {
                return;
            }

            const { modal } = requireConversationRenameElements();
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            resetConversationRenameState();
        }

        function openConversationRenameModal(conversationId, title) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            const { modal, input } = requireConversationRenameElements();
            const safeTitle = String(title || getConversationTitleFromCache(cid) || '').trim();
            conversationRenameState = {
                conversationId: cid,
                initialTitle: safeTitle,
                saving: false
            };

            input.value = safeTitle;
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => {
                input.focus({ preventScroll: true });
                input.select();
            });
        }

        async function submitConversationRename() {
            if (conversationRenameState.saving) {
                return;
            }

            const cid = String(conversationRenameState.conversationId || '').trim();
            const oldTitle = String(conversationRenameState.initialTitle || '').trim();
            const { input, saveBtn } = requireConversationRenameElements();

            if (!cid) {
                throw new Error('chat_conversations 会话重命名状态缺少 conversationId');
            }

            const nextTitle = String(input.value || '').trim();

            if (!nextTitle) {
                showToast('标题不能为空');
                input.focus();
                return;
            }

            if (nextTitle.length > 120) {
                showToast('标题长度不能超过120');
                input.focus();
                return;
            }

            if (nextTitle === oldTitle) {
                closeConversationRenameModal(true);
                return;
            }

            const patched = setConversationTitleLocal(cid, nextTitle);
            conversationRenameState.saving = true;
            saveBtn.disabled = true;

            try {
                const ok = await setConversationTitle(cid, nextTitle);

                if (!ok) {
                    if (patched) {
                        setConversationTitleLocal(cid, oldTitle);
                    }

                    showToast('修改标题失败');
                    return;
                }

                await loadConversations();
                closeConversationRenameModal(true);
                showToast('标题已更新');
            } catch (_) {
                if (patched) {
                    setConversationTitleLocal(cid, oldTitle);
                }

                showToast('修改标题失败');
            } finally {
                conversationRenameState.saving = false;
                saveBtn.disabled = false;
            }
        }

        function bindConversationRenameModal() {
            const { modal, input, closeBtn, cancelBtn, saveBtn } = requireConversationRenameElements();

            if (modal.dataset.bindDone === '1') {
                return;
            }

            modal.dataset.bindDone = '1';
            bindBackdropSafeClose(modal, () => closeConversationRenameModal());

            closeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                closeConversationRenameModal();
            });

            cancelBtn.addEventListener('click', (event) => {
                event.preventDefault();
                closeConversationRenameModal();
            });

            saveBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                await submitConversationRename();
            });

            input.addEventListener('keydown', async (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    await submitConversationRename();
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeConversationRenameModal();
                }
            });
        }

        function buildConversationListSignature(conversations) {
            const currentId = String(getCurrentConversationId() || '').trim();
            const orderedConversations = sortConversationListForDisplay(conversations);

            return JSON.stringify({
                currentId,
                items: orderedConversations.map((item) => {
                    const src = (item && typeof item === 'object') ? item : {};
                    const cid = readConversationId(src);
                    const streamState = getConversationStreamState(cid);

                    return {
                        conversation_id: cid,
                        title: readConversationTitle(src),
                        updated_at: String(src.updated_at || ''),
                        pin: !!src.pin,
                        conversation_mode: String(src.conversation_mode || ''),
                        longterm_active: !!src.longterm_active,
                        longterm_task: String(src.longterm_task || ''),
                        longterm_step: String(src.longterm_step || ''),
                        message_count: Number(src.message_count || 0),
                        tags: Array.isArray(src.tags) ? src.tags.map((tag) => String(tag || '').trim().toLowerCase()) : [],
                        preview: String(src.preview || ''),
                        stream_status: String(streamState && streamState.status || ''),
                        stream_unread: !!(streamState && streamState.unread),
                    };
                }),
            });
        }

        function resetConversationListRenderSignature() {
            renderSignature = '';
        }

        function renderConversationList(conversations) {
            const listEl = getConversationListElement();

            if (!listEl) {
                return;
            }

            const normalized = Array.isArray(conversations) ? conversations : [];
            const signature = buildConversationListSignature(normalized);

            if (signature === renderSignature) {
                return;
            }

            renderSignature = signature;
            listEl.innerHTML = '';

            const orderedConversations = sortConversationListForDisplay(conversations);

            orderedConversations.forEach((conversation) => {
                listEl.appendChild(buildConversationListItem(conversation));
            });
        }

        function bindConversationItemMobileLongPress(itemEl, getPayload) {
            if (!itemEl || typeof getPayload !== 'function') {
                return;
            }

            let timer = null;
            let startX = 0;
            let startY = 0;
            let lastX = 0;
            let lastY = 0;
            let longPressed = false;
            const holdMs = 460;
            const moveTolerance = 12;

            const clearTimer = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            };

            itemEl.addEventListener('touchstart', (event) => {
                if (!isChatMobileLayout()) {
                    return;
                }

                if (!event.touches || event.touches.length !== 1) {
                    return;
                }

                if (event.target && event.target.closest && event.target.closest('.delete-chat')) {
                    return;
                }

                const touch = event.touches[0];
                startX = Number(touch.clientX || 0);
                startY = Number(touch.clientY || 0);
                lastX = startX;
                lastY = startY;
                longPressed = false;
                clearTimer();
                timer = setTimeout(() => {
                    longPressed = true;
                    itemEl.dataset.longPressOpen = '1';
                    showPinContextMenu(lastX, lastY, getPayload());
                }, holdMs);
            }, { passive: true });

            itemEl.addEventListener('touchmove', (event) => {
                if (!timer || !event.touches || !event.touches.length) {
                    return;
                }

                const touch = event.touches[0];
                lastX = Number(touch.clientX || 0);
                lastY = Number(touch.clientY || 0);
                const dx = Math.abs(lastX - startX);
                const dy = Math.abs(lastY - startY);

                if (dx > moveTolerance || dy > moveTolerance) {
                    clearTimer();
                }
            }, { passive: true });

            itemEl.addEventListener('touchend', (event) => {
                clearTimer();

                if (!longPressed) {
                    return;
                }

                longPressed = false;
                event.preventDefault();
                event.stopPropagation();
            });

            itemEl.addEventListener('touchcancel', () => {
                clearTimer();
                longPressed = false;
            }, { passive: true });
        }

        function buildConversationListItem(conversation) {
            const row = document.createElement('div');
            const source = conversation && typeof conversation === 'object' ? conversation : {};
            const cid = String(source.conversation_id || source.id || '').trim();
            const currentId = String(getCurrentConversationId() || '').trim();
            const streamState = getConversationStreamState(cid);
            const streamRunning = !!(streamState && String(streamState.status || '') === 'running');
            const streamUnread = !!(streamState && streamState.unread && String(streamState.status || '') === 'done');
            const isPinned = !!source.pin;
            const isLongterm = String(source.conversation_mode || '').trim() === 'longterm' || !!source.longterm_active;
            const isLongtermActive = !!source.longterm_active;
            const tags = Array.isArray(source.tags) ? source.tags.map((item) => String(item || '').trim().toLowerCase()) : [];
            const isLearningConversation = tags.includes('learning') || String(source.conversation_mode || '').trim() === 'learning';
            const conversationTitle = String(source.title || source.preview || `Conversation ${cid}`);

            row.className = `conversation-item ${cid === currentId ? 'active' : ''}${streamRunning ? ' is-streaming' : ''}${streamUnread ? ' has-stream-unread' : ''}`;
            row.dataset.conversationId = String(cid || '');
            row.dataset.pin = isPinned ? '1' : '0';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'title';

            if (isLearningConversation) {
                const learningIcon = document.createElement('i');
                learningIcon.className = 'fa-solid fa-book-open conversation-mode-icon';
                learningIcon.setAttribute('aria-hidden', 'true');
                learningIcon.title = 'Learning 对话';
                titleSpan.appendChild(learningIcon);
            }

            if (isLongterm) {
                const modeIcon = document.createElement('i');
                modeIcon.className = `fa-solid fa-diagram-project conversation-mode-icon${isLongtermActive ? ' active' : ''}`;
                modeIcon.setAttribute('aria-hidden', 'true');
                modeIcon.title = isLongtermActive ? 'Longterm 执行中' : 'Longterm 模式';
                titleSpan.appendChild(modeIcon);
            }

            if (isPinned) {
                const pinIcon = document.createElement('i');
                pinIcon.className = 'fa-solid fa-thumbtack conversation-pin-icon';
                pinIcon.setAttribute('aria-hidden', 'true');
                titleSpan.appendChild(pinIcon);
            }

            titleSpan.appendChild(document.createTextNode(conversationTitle));
            row.appendChild(titleSpan);

            const rightWrap = document.createElement('span');
            rightWrap.className = 'conversation-item-right';

            if (streamRunning || streamUnread) {
                const indicator = document.createElement('span');
                indicator.className = streamRunning ? 'conversation-stream-indicator is-loading' : 'conversation-stream-indicator is-unread';
                indicator.setAttribute('aria-hidden', 'true');
                indicator.title = streamRunning ? '模型正在回复' : '回复已完成';

                if (streamRunning) {
                    indicator.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                }

                rightWrap.appendChild(indicator);
            }

            row.onclick = () => {
                if (row.dataset.longPressOpen === '1') {
                    row.dataset.longPressOpen = '0';
                    return;
                }

                if (getCurrentViewingKnowledge()) {
                    closeKnowledgeView();
                }

                markConversationStreamRead(cid);
                loadConversation(cid);
            };

            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                showPinContextMenu(event.clientX, event.clientY, {
                    targetType: 'conversation',
                    conversationId: String(cid || ''),
                    conversationTitle,
                    pinned: isPinned
                });
            });

            bindConversationItemMobileLongPress(row, () => ({
                targetType: 'conversation',
                conversationId: String(cid || ''),
                conversationTitle,
                pinned: row.dataset.pin === '1'
            }));

            const deleteButton = document.createElement('button');
            deleteButton.className = 'btn-icon-small delete-chat';
            deleteButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            deleteButton.onclick = (event) => {
                event.stopPropagation();
                deleteConversation(cid);
            };

            rightWrap.appendChild(deleteButton);
            row.appendChild(rightWrap);

            return row;
        }

        return {
            loadConversations,
            buildConversationListSignature,
            renderConversationList,
            resetConversationListRenderSignature,
            setConversationPinned,
            setConversationPinLocal,
            getConversationTitleFromCache,
            setConversationTitleLocal,
            setConversationTitle,
            closeConversationRenameModal,
            openConversationRenameModal,
            submitConversationRename,
            bindConversationRenameModal,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createConversationListController,
        createConversationNavigationController,
        getDirectConversationUrlTarget,
        hasConversationUrlTarget,
    });
})();
