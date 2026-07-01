// Workspace project UI and interactions. Loaded after chat.js so it can reuse shared chat globals.

function workspaceHasMarkedConversation(workspace, conversationId) {
    const cid = String(conversationId || '').trim();

    if (!cid || !workspace) {
        return false;
    }

    const ids = Array.isArray(workspace.conversation_ids) ? workspace.conversation_ids : [];

    if (ids.some((item) => String(item || '').trim() === cid)) {
        return true;
    }

    const conversations = Array.isArray(workspace.conversations) ? workspace.conversations : [];
    return conversations.some((item) => {
        if (!item || typeof item !== 'object') {
            return false;
        }

        return String(item.conversation_id || '').trim() === cid;
    });
}

function workspaceHasMarkedKnowledge(workspace, title) {
    const safeTitle = String(title || '').trim();

    if (!safeTitle || !workspace) {
        return false;
    }

    const documents = Array.isArray(workspace.knowledge_documents) ? workspace.knowledge_documents : [];

    return documents.some((item) => {
        if (typeof item === 'string') {
            return String(item || '').trim() === safeTitle;
        }

        if (!item || typeof item !== 'object') {
            return false;
        }

        return String(item.title || item.name || '').trim() === safeTitle;
    });
}

function getWorkspaceFileRef(item) {
    return String(
        (item && typeof item === 'object')
            ? (item.file_ref || item.sandbox_path || item.path || item.alias || '')
            : item || '',
    ).trim();
}

function workspaceHasMarkedFile(workspace, fileRef) {
    const safeRef = String(fileRef || '').trim();

    if (!safeRef || !workspace) {
        return false;
    }

    const files = Array.isArray(workspace.workspace_files) ? workspace.workspace_files : [];

    return files.some((item) => getWorkspaceFileRef(item) === safeRef);
}

function isWorkspaceMarkedForPinTarget(workspace, state) {
    const targetType = String((state && state.targetType) || '').trim();

    if (targetType === 'conversation') {
        return workspaceHasMarkedConversation(workspace, state.conversationId);
    }

    if (targetType === 'knowledge_basis') {
        return workspaceHasMarkedKnowledge(workspace, state.title);
    }

    return false;
}

function renderPinContextWorkspaceItems(workspaces, state = null) {
    const list = els.pinContextMenuWorkspaceList || document.getElementById('pinContextMenuWorkspaceList');

    if (!list) {
        return;
    }

    const items = Array.isArray(workspaces) ? workspaces : [];

    if (!items.length) {
        list.innerHTML = '<div class="pin-context-submenu-empty">暂无工作区</div>';
        return;
    }

    list.innerHTML = items.map((workspace) => {
        const workspaceId = escapeHtml(String((workspace || {}).workspace_id || '').trim());
        const title = escapeHtml(getWorkspaceProjectTitle(workspace));
        const marked = isWorkspaceMarkedForPinTarget(workspace, state);
        const markedClass = marked ? ' is-marked' : '';
        const markedHtml = marked
            ? '<span class="pin-context-workspace-state"><i class="fa-solid fa-check" aria-hidden="true"></i><span>已标记</span></span>'
            : '';

        return `
            <button class="pin-context-workspace-item${markedClass}" type="button" data-workspace-id="${workspaceId}" data-marked="${marked ? '1' : '0'}" aria-pressed="${marked ? 'true' : 'false'}">
                <i class="fa-regular fa-folder" aria-hidden="true"></i>
                <span class="pin-context-workspace-title">${title}</span>
                ${markedHtml}
            </button>
        `;
    }).join('');
}

async function loadPinContextWorkspaceItems(state) {
    const list = els.pinContextMenuWorkspaceList || document.getElementById('pinContextMenuWorkspaceList');
    const targetType = String((state && state.targetType) || '').trim();
    const supportsWorkspaceMark = targetType === 'conversation' || targetType === 'knowledge_basis';

    if (!list || !supportsWorkspaceMark) {
        return;
    }

    list.innerHTML = '<div class="pin-context-submenu-empty">加载中...</div>';

    try {
        const res = await fetch('/api/workspace/list?include_marks=1');
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error((data && data.message) || '工作区加载失败');
        }

        renderPinContextWorkspaceItems(data.workspaces, state);
        positionPinContextSubmenu(
            els.pinContextMenu || document.getElementById('pinContextMenu'),
            parseFloat(String((els.pinContextMenu || document.getElementById('pinContextMenu'))?.style?.left || '0')) || 0,
        );
    } catch (error) {
        console.error('loadPinContextWorkspaceItems failed', error);
        list.innerHTML = '<div class="pin-context-submenu-empty">加载失败</div>';
    }
}

function positionPinContextSubmenu(menu, x) {
    const workspaceList = els.pinContextMenuWorkspaceList || document.getElementById('pinContextMenuWorkspaceList');

    if (!menu || !workspaceList) {
        return;
    }

    const menuWidth = menu.offsetWidth || 180;
    const submenuWidth = workspaceList.offsetWidth || workspaceList.scrollWidth || 180;
    const shouldOpenLeft = Number(x || 0) + menuWidth + submenuWidth + 24 > window.innerWidth;
    menu.classList.toggle('submenu-left', shouldOpenLeft);
}

// Workspaces 是顶层工作台入口，进入前需要断开当前对话选中态，避免侧栏继续高亮旧 Conversation。
function clearCurrentConversationSelectionForWorkspaceNavigation() {
    const activeConversationId = String(currentConversationId || '').trim();
    const urlParams = new URLSearchParams(window.location.search || '');
    const hasConversationUrl = urlParams.has('cid') || urlParams.has('id');

    resetWorkspaceReadonlyConversationState();

    if (activeConversationId) {
        detachCurrentVisibleStreamForNavigation('');
    }

    currentConversationId = null;
    syncBrowserCurrentConversation();
    syncGenerationStateForCurrentConversation();
    syncNotesForConversation(null);
    conversationListRenderSignature = '';
    renderConversationList(conversationListCache);
    clearWorkspaceHierarchySlot();
    resetComposerConversationContextUsage();

    if (activeConversationId || hasConversationUrl) {
        window.history.replaceState({}, '', '/chat');
    }
}

let workspaceProjectsState = {
    items: [],
    filter: 'all',
    query: '',
    selectedWorkspace: null,
    activeDetailTab: 'chat',
};

let workspaceResourceContextMenuState = null;

let workspaceReadonlyConversationState = {
    active: false,
    workspaceId: '',
    conversationId: '',
    ownerUsername: '',
};

let activeWorkspaceConversationContext = null;

function resetWorkspaceReadonlyConversationState() {
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const inputDock = document.querySelector('.input-dock');

    workspaceReadonlyConversationState = {
        active: false,
        workspaceId: '',
        conversationId: '',
        ownerUsername: '',
    };

    restoreWorkspaceDetailInputContainer();

    if (msgs) {
        msgs.classList.remove('workspace-shared-conversation-readonly');
        delete msgs.dataset.workspaceReadonly;
        delete msgs.dataset.workspaceId;
        delete msgs.dataset.ownerUsername;
    }

    if (inputDock) {
        inputDock.style.display = '';
    }

    if (inputWrapper) {
        inputWrapper.style.display = '';
    }
}

let workspaceShareUserSelectorState = {
    users: [],
    filteredUsers: [],
    activeIndex: 0,
    visible: false,
    loading: false,
    error: '',
    requestId: 0,
    userDetailsById: new Map(),
};

const workspaceDetailInputMountState = {
    homeParent: null,
    homeNextSibling: null,
    mounted: false,
};

// Workspace 详情页只移动原始输入框节点，保证 input-container 结构和既有事件绑定完全不变。
function captureWorkspaceDetailInputHome() {
    const inputWrapper = document.getElementById('inputWrapper');

    if (!inputWrapper || !inputWrapper.parentNode || workspaceDetailInputMountState.homeParent) {
        return;
    }

    workspaceDetailInputMountState.homeParent = inputWrapper.parentNode;
    workspaceDetailInputMountState.homeNextSibling = inputWrapper.nextSibling;
}

function restoreWorkspaceDetailInputContainer() {
    if (!workspaceDetailInputMountState.mounted) {
        return;
    }

    const inputWrapper = document.getElementById('inputWrapper');
    const homeParent = workspaceDetailInputMountState.homeParent;

    if (!inputWrapper || !homeParent) {
        console.error('[WorkspaceDetailInput] 原始输入框归位失败：缺少 inputWrapper 或原始父节点');
        return;
    }

    const homeNextSibling = workspaceDetailInputMountState.homeNextSibling;

    if (homeNextSibling && homeNextSibling.parentNode !== homeParent) {
        console.error('[WorkspaceDetailInput] 原始输入框归位失败：原始相邻节点已离开父节点');
        return;
    }

    homeParent.insertBefore(inputWrapper, homeNextSibling);
    inputWrapper.style.display = '';
    workspaceDetailInputMountState.mounted = false;
}

function mountWorkspaceDetailInputContainer() {
    const slot = document.getElementById('workspaceDetailInputSlot');
    const inputWrapper = document.getElementById('inputWrapper');
    const inputContainer = inputWrapper ? inputWrapper.querySelector('.input-container') : null;

    if (!slot || !inputWrapper || !inputContainer) {
        console.error('[WorkspaceDetailInput] 原始输入框挂载失败：缺少详情停靠点或 input-container');
        return;
    }

    captureWorkspaceDetailInputHome();
    setInputContainerCollapsed(inputContainer, false);
    inputWrapper.style.display = 'block';
    slot.appendChild(inputWrapper);
    workspaceDetailInputMountState.mounted = true;

    requestAnimationFrame(() => {
        resizeMessageInput();
    });
}

function getActiveWorkspaceDetailComposeWorkspaceId() {
    const slot = document.getElementById('workspaceDetailInputSlot');
    const inputWrapper = document.getElementById('inputWrapper');

    if (!slot || !inputWrapper || !slot.contains(inputWrapper)) {
        return '';
    }

    return getWorkspaceProjectId(workspaceProjectsState.selectedWorkspace);
}

async function resetWorkspaceDetailComposerSelection(workspaceId) {
    const wid = String(workspaceId || '').trim();

    if (!wid) {
        throw new Error('Workspace 不存在，无法创建 Workspace 对话');
    }

    // 这里只把输入面切到无选中 Conversation 状态；真实 Conversation 仍由 sendMessage 现有流程创建。
    await createNewConversation(false, 'chat', {
        pushHistory: false,
    });
}

async function registerWorkspaceDetailConversation(workspaceId, conversationId) {
    try {
        const workspace = await addConversationToWorkspace(workspaceId, conversationId, {
            refreshList: false,
            syncSelectedWorkspace: true,
        });

        if (workspace) {
            workspaceProjectsState.selectedWorkspace = workspace;
        }

        showToast('新对话已归入 Workspace');
        return true;
    } catch (error) {
        console.error('registerWorkspaceDetailConversation failed', error);
        showToast(String((error && error.message) || 'Workspace 对话登记失败'));
        return false;
    }
}

function formatWorkspaceDate(value) {
    const raw = String(value || '').trim();

    if (!raw) {
        return '-';
    }

    const numeric = Number(raw);
    const date = Number.isFinite(numeric) && numeric > 0
        ? new Date(numeric > 100000000000 ? numeric : numeric * 1000)
        : new Date(raw);

    if (Number.isNaN(date.getTime())) {
        return raw;
    }

    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function renderWorkspaceVisibilitySwitch(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const resourceType = String(opts.resourceType || '').trim();
    const visibility = normalizeWorkspaceVisibility(opts.visibility);
    const isShare = visibility === 'share';
    const disabled = opts.disabled === true;
    const nextLabel = getWorkspaceVisibilityLabel(isShare ? 'private' : 'share');
    const title = disabled ? '仅资源添加者可修改共享状态' : `切换为 ${nextLabel}`;
    const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
    const conversationAttr = resourceType === 'conversation'
        ? ` data-conversation-id="${escapeHtml(opts.conversationId || '')}"`
        : '';
    const knowledgeAttr = resourceType === 'knowledge'
        ? ` data-knowledge-title="${escapeHtml(opts.knowledgeTitle || '')}" data-knowledge-type="${escapeHtml(opts.knowledgeType || 'basis')}" data-knowledge-added-by="${escapeHtml(opts.addedBy || '')}"`
        : '';
    const fileAttr = resourceType === 'file'
        ? ` data-file-ref="${escapeHtml(opts.fileRef || '')}" data-file-added-by="${escapeHtml(opts.addedBy || '')}"`
        : '';

    return `
        <button class="workspace-detail-visibility-switch${isShare ? ' is-share' : ''}" type="button" data-workspace-visibility-toggle data-resource-type="${escapeHtml(resourceType)}" data-visibility="${visibility}" aria-pressed="${isShare ? 'true' : 'false'}" title="${escapeHtml(title)}"${conversationAttr}${knowledgeAttr}${fileAttr}${disabledAttr}>
            <span class="workspace-detail-visibility-track" aria-hidden="true">
                <span class="workspace-detail-visibility-thumb"></span>
            </span>
            <span class="workspace-detail-visibility-text">${getWorkspaceVisibilityLabel(visibility)}</span>
        </button>
    `;
}

function setWorkspaceVisibilitySwitchState(toggle, visibility, disabled) {
    if (!toggle) {
        return;
    }

    const nextVisibility = normalizeWorkspaceVisibility(visibility);
    const isShare = nextVisibility === 'share';
    const nextLabel = getWorkspaceVisibilityLabel(isShare ? 'private' : 'share');
    const label = toggle.querySelector('.workspace-detail-visibility-text');

    toggle.dataset.visibility = nextVisibility;
    toggle.classList.toggle('is-share', isShare);
    toggle.setAttribute('aria-pressed', isShare ? 'true' : 'false');
    toggle.title = disabled ? '仅资源添加者可修改共享状态' : `切换为 ${nextLabel}`;
    toggle.disabled = !!disabled;

    if (disabled) {
        toggle.setAttribute('aria-disabled', 'true');
    } else {
        toggle.removeAttribute('aria-disabled');
    }

    if (label) {
        label.textContent = getWorkspaceVisibilityLabel(nextVisibility);
    }
}

function isWorkspaceOwnedByCurrentUser(workspace) {
    return String((workspace || {}).owner_username || '').trim() === String(currentUsername || '').trim();
}

function isWorkspaceResourceOwnedByCurrentUser(workspace, item) {
    const ownerUsername = String((workspace || {}).owner_username || '').trim();
    const addedBy = String((item || {}).added_by || ownerUsername || '').trim();

    return addedBy === String(currentUsername || '').trim();
}

function getWorkspaceProjectId(workspace) {
    return String((workspace || {}).workspace_id || '').trim();
}

function getWorkspaceProjectTitle(workspace) {
    return String((workspace || {}).title || 'Untitled Workspace').trim();
}

function normalizeWorkspaceDetailTab(value) {
    const name = String(value || '').trim();

    if (name === 'knowledge' || name === 'files' || name === 'memory') {
        return name;
    }

    return 'chat';
}

function isWorkspaceResourcePinned(item) {
    return !!(item && typeof item === 'object' && item.pin === true);
}

function sortWorkspacePinnedItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const aPinned = isWorkspaceResourcePinned(a.item);
            const bPinned = isWorkspaceResourcePinned(b.item);

            if (aPinned !== bPinned) {
                return aPinned ? -1 : 1;
            }

            return a.index - b.index;
        })
        .map((row) => row.item);
}

function normalizeWorkspaceConversationHeaderContext(context) {
    if (!context || typeof context !== 'object') {
        return null;
    }

    const workspaceId = String(context.workspaceId || context.workspace_id || '').trim();
    const workspaceTitle = String(context.workspaceTitle || context.title || '').trim();

    if (!workspaceId && !workspaceTitle) {
        return null;
    }

    return {
        workspaceId,
        workspaceTitle,
    };
}

function setActiveWorkspaceConversationContext(context) {
    activeWorkspaceConversationContext = normalizeWorkspaceConversationHeaderContext(context);
}

function getActiveWorkspaceConversationContext() {
    return activeWorkspaceConversationContext
        ? { ...activeWorkspaceConversationContext }
        : null;
}

function clearWorkspaceHierarchySlot() {
    const slot = document.getElementById('workspaceHierarchySlot');
    setActiveWorkspaceConversationContext(null);

    if (!slot) {
        return;
    }

    slot.innerHTML = '';
}

function renderWorkspaceConversationHierarchy(context) {
    const slot = document.getElementById('workspaceHierarchySlot');
    const normalized = normalizeWorkspaceConversationHeaderContext(context);

    if (!slot || !normalized) {
        return;
    }

    setActiveWorkspaceConversationContext(normalized);

    const workspaceId = normalized.workspaceId;
    const workspaceTitle = normalized.workspaceTitle || 'Workspace';
    const ariaLabel = workspaceId
        ? `返回 Workspace：${workspaceTitle}`
        : `返回 Workspaces`;

    slot.innerHTML = `
        <button class="workspace-hierarchy-project" type="button" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(workspaceTitle)}">
            <span class="workspace-hierarchy-icon" aria-hidden="true"><i class="fa-regular fa-folder"></i></span>
        </button>
        <span class="workspace-hierarchy-separator" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>
    `;

    const projectButton = slot.querySelector('.workspace-hierarchy-project');

    if (projectButton) {
        projectButton.addEventListener('click', () => {
            if (workspaceId) {
                void selectWorkspaceProject(workspaceId);
                return;
            }

            window.openWorkspacesFrameView();
        });
    }
}

function ensureWorkspaceViewerBaseHeaderState(headerTitle, headerLeft, headerRight) {
    if (originalHeaderState) {
        return;
    }

    if (chatHeaderBaseState) {
        originalHeaderState = {
            title: chatHeaderBaseState.title,
            leftHTML: chatHeaderBaseState.leftHTML,
            rightHTML: chatHeaderBaseState.rightHTML,
        };
        return;
    }

    originalHeaderState = {
        title: headerTitle ? headerTitle.textContent : 'Untitled Conversation',
        leftHTML: headerLeft ? headerLeft.innerHTML : '',
        rightHTML: headerRight ? headerRight.innerHTML : '',
    };
}

function getWorkspaceProjectConversations(workspace) {
    const conversations = (workspace && Array.isArray(workspace.conversations)) ? workspace.conversations : [];
    return conversations.filter((item) => item && typeof item === 'object');
}

function getFilteredWorkspaceProjects() {
    const query = String(workspaceProjectsState.query || '').trim().toLowerCase();

    return workspaceProjectsState.items.filter((workspace) => {
        const title = String(workspace.title || '').toLowerCase();
        const owner = String(workspace.owner_username || '').toLowerCase();
        const matchesQuery = !query || title.includes(query) || owner.includes(query);

        if (!matchesQuery) {
            return false;
        }

        if (workspaceProjectsState.filter === 'owned') {
            return isWorkspaceOwnedByCurrentUser(workspace);
        }

        if (workspaceProjectsState.filter === 'shared') {
            return !isWorkspaceOwnedByCurrentUser(workspace);
        }

        return true;
    });
}

function renderWorkspaceProjectsList() {
    const list = document.getElementById('workspaceProjectsList');

    if (!list) {
        return;
    }

    const workspaces = getFilteredWorkspaceProjects();

    if (!workspaces.length) {
        list.innerHTML = '<div class="workspace-projects-empty">暂无 Workspaces</div>';
        return;
    }

    list.innerHTML = workspaces.map((workspace) => {
        const workspaceId = String(workspace.workspace_id || '').trim();
        const selected = workspaceProjectsState.selectedWorkspace
            && String(workspaceProjectsState.selectedWorkspace.workspace_id || '').trim() === workspaceId;
        const title = escapeHtml(workspace.title || 'Untitled Workspace');
        const date = escapeHtml(formatWorkspaceDate(workspace.updated_at || workspace.created_at));

        return `
            <button class="workspace-projects-row workspace-projects-item ${selected ? 'active' : ''}" type="button" role="row" data-workspace-id="${escapeHtml(workspaceId)}">
                <span class="workspace-projects-name" role="cell">
                    <span class="workspace-projects-folder">
                        <i class="fa-regular fa-folder" aria-hidden="true"></i>
                    </span>
                    <span>${title}</span>
                </span>
                <span class="workspace-projects-date" role="cell">${date}</span>
            </button>
        `;
    }).join('');
}

function ensureWorkspaceCreateModal() {
    let modal = document.getElementById('workspaceCreateModal');

    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'workspaceCreateModal';
    modal.className = 'modal-backdrop workspace-create-modal-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal workspace-create-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceCreateModalTitle">
            <div class="modal-head">
                <h3 id="workspaceCreateModalTitle">新建 Workspace</h3>
                <button id="workspaceCreateModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <div class="modal-body workspace-create-modal-body">
                <label class="workspace-create-field" for="workspaceCreateTitleInput">
                    <span>名称</span>
                    <input id="workspaceCreateTitleInput" class="input-modern" type="text" maxlength="120" placeholder="例如：日本之旅">
                </label>
            </div>
            <div class="modal-footer workspace-create-modal-footer">
                <button id="workspaceCreateModalCancelBtn" class="btn-cancel" type="button">取消</button>
                <button id="workspaceCreateModalConfirmBtn" class="btn-confirm" type="button">创建</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    registerModalBackdropStacking(modal);
    bindBackdropSafeClose(modal, closeWorkspaceCreateModal);

    modal.querySelector('#workspaceCreateModalCloseBtn')?.addEventListener('click', closeWorkspaceCreateModal);
    modal.querySelector('#workspaceCreateModalCancelBtn')?.addEventListener('click', closeWorkspaceCreateModal);
    modal.querySelector('#workspaceCreateModalConfirmBtn')?.addEventListener('click', () => {
        void submitWorkspaceCreateModal();
    });

    modal.querySelector('#workspaceCreateTitleInput')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void submitWorkspaceCreateModal();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeWorkspaceCreateModal();
        }
    });

    return modal;
}

function openWorkspaceCreateModal() {
    const modal = ensureWorkspaceCreateModal();
    const input = modal.querySelector('#workspaceCreateTitleInput');
    const confirmBtn = modal.querySelector('#workspaceCreateModalConfirmBtn');

    if (input) {
        input.value = '';
    }

    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建';
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    handleBackdropStackingChange(modal);

    setTimeout(() => {
        if (input) {
            input.focus();
        }
    }, 0);
}

function closeWorkspaceCreateModal() {
    const modal = document.getElementById('workspaceCreateModal');

    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    handleBackdropStackingChange(modal);
}

function getWorkspaceSharedUsers(workspace) {
    const settings = workspace && workspace.settings && typeof workspace.settings === 'object' ? workspace.settings : {};
    const users = Array.isArray(settings.shared_users) ? settings.shared_users : [];

    return users
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function ensureWorkspaceShareModal() {
    let modal = document.getElementById('workspaceShareModal');

    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'workspaceShareModal';
    modal.className = 'modal-backdrop workspace-share-modal-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal workspace-share-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceShareModalTitle">
            <div class="modal-head">
                <h3 id="workspaceShareModalTitle">分享 Workspace</h3>
                <button id="workspaceShareModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <div class="modal-body workspace-share-modal-body">
                <label class="workspace-share-field" for="workspaceShareUserInput">
                    <span>用户</span>
                    <div class="workspace-share-input-row">
                        <div class="workspace-share-user-selector" id="workspaceShareUserSelector">
                            <input id="workspaceShareUserInput" class="input-modern" type="text" maxlength="128" placeholder="输入用户名搜索" autocomplete="off" aria-haspopup="listbox" aria-expanded="false">
                            <div id="workspaceShareUserMenu" class="learning-feed-mention-menu admin-user-token-menu workspace-share-user-menu" role="listbox" hidden></div>
                        </div>
                        <button id="workspaceShareAddUserBtn" class="workspace-share-add-btn" type="button">添加</button>
                    </div>
                </label>
                <div id="workspaceShareSelectedUsers" class="workspace-share-selected-users" aria-label="已共享用户"></div>
            </div>
            <div class="modal-footer workspace-share-modal-footer">
                <button id="workspaceShareModalCancelBtn" class="btn-cancel" type="button">取消</button>
                <button id="workspaceShareModalConfirmBtn" class="btn-confirm" type="button">保存</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    registerModalBackdropStacking(modal);
    bindBackdropSafeClose(modal, closeWorkspaceShareModal);

    modal.querySelector('#workspaceShareModalCloseBtn')?.addEventListener('click', closeWorkspaceShareModal);
    modal.querySelector('#workspaceShareModalCancelBtn')?.addEventListener('click', closeWorkspaceShareModal);
    modal.querySelector('#workspaceShareModalConfirmBtn')?.addEventListener('click', () => {
        void submitWorkspaceShareModal();
    });
    modal.querySelector('#workspaceShareAddUserBtn')?.addEventListener('click', () => {
        addWorkspaceShareUserFromInput();
    });

    const selectorEl = modal.querySelector('#workspaceShareUserSelector');
    const inputEl = modal.querySelector('#workspaceShareUserInput');
    const menuEl = modal.querySelector('#workspaceShareUserMenu');

    inputEl?.addEventListener('focus', () => {
        showWorkspaceShareUserMenu();
        void loadWorkspaceShareUserOptions(inputEl.value);
    });

    inputEl?.addEventListener('input', (event) => {
        showWorkspaceShareUserMenu();
        void loadWorkspaceShareUserOptions(event.target.value);
    });

    inputEl?.addEventListener('keydown', (event) => {
        const hasMenuRows = workspaceShareUserSelectorState.visible
            && workspaceShareUserSelectorState.filteredUsers.length > 0;

        if (hasMenuRows && event.key === 'ArrowDown') {
            event.preventDefault();
            workspaceShareUserSelectorState.activeIndex = (workspaceShareUserSelectorState.activeIndex + 1)
                % workspaceShareUserSelectorState.filteredUsers.length;
            renderWorkspaceShareUserMenu();
            return;
        }

        if (hasMenuRows && event.key === 'ArrowUp') {
            event.preventDefault();
            workspaceShareUserSelectorState.activeIndex = (workspaceShareUserSelectorState.activeIndex - 1 + workspaceShareUserSelectorState.filteredUsers.length)
                % workspaceShareUserSelectorState.filteredUsers.length;
            renderWorkspaceShareUserMenu();
            return;
        }

        if (workspaceShareUserSelectorState.visible && event.key === 'Escape') {
            event.preventDefault();
            hideWorkspaceShareUserMenu();
            return;
        }

        if (hasMenuRows && event.key === 'Enter') {
            const selected = workspaceShareUserSelectorState.filteredUsers[workspaceShareUserSelectorState.activeIndex];

            if (selected) {
                event.preventDefault();
                selectWorkspaceShareUser(selected);
                return;
            }
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            hideWorkspaceShareUserMenu();
            addWorkspaceShareUserFromInput();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeWorkspaceShareModal();
        }
    });

    menuEl?.addEventListener('mousedown', (event) => {
        const target = event.target;

        if (!(target instanceof Element)) return;

        const item = target.closest('[data-workspace-share-user-index]');

        if (!item) return;

        event.preventDefault();
        event.stopPropagation();
        const index = Number(item.getAttribute('data-workspace-share-user-index') || 0);
        const user = workspaceShareUserSelectorState.filteredUsers[index];

        if (user) {
            selectWorkspaceShareUser(user);
        }
    });

    document.addEventListener('mousedown', (event) => {
        const target = event.target;

        if (!(target instanceof Node)) return;

        if (selectorEl && !selectorEl.contains(target)) {
            hideWorkspaceShareUserMenu();
        }
    });

    modal.querySelector('#workspaceShareSelectedUsers')?.addEventListener('click', (event) => {
        const target = event.target;
        const removeBtn = target && target.closest ? target.closest('[data-workspace-share-remove]') : null;

        if (!removeBtn) {
            return;
        }

        const userId = String(removeBtn.getAttribute('data-workspace-share-remove') || '').trim();
        setWorkspaceShareSelectedUsers(
            getWorkspaceShareSelectedUsers().filter((item) => item !== userId),
        );
    });

    return modal;
}

function getWorkspaceShareSelectedUsers() {
    const modal = ensureWorkspaceShareModal();
    const rawValue = String(modal.getAttribute('data-shared-users') || '').trim();

    if (!rawValue) {
        return [];
    }

    return rawValue.split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function rememberWorkspaceShareUsers(users) {
    const rows = Array.isArray(users) ? users : [];

    rows.forEach((user) => {
        const userId = getWorkspaceShareUserId(user);

        if (!userId) {
            return;
        }

        workspaceShareUserSelectorState.userDetailsById.set(userId, {
            ...(workspaceShareUserSelectorState.userDetailsById.get(userId) || {}),
            ...(user || {}),
            user_id: userId,
        });
    });
}

function getWorkspaceShareCachedUser(userId) {
    const safeUserId = String(userId || '').trim();

    if (!safeUserId) {
        return null;
    }

    return workspaceShareUserSelectorState.userDetailsById.get(safeUserId) || {
        user_id: safeUserId,
        username: safeUserId,
        display_name: safeUserId,
    };
}

function renderWorkspaceShareAvatar(user, className) {
    const userId = getWorkspaceShareUserId(user);
    const displayName = getWorkspaceShareDisplayName(user) || userId || 'User';
    const avatarUrl = getWorkspaceShareUserAvatarUrl(user);
    const initial = (displayName || userId || 'U').charAt(0).toUpperCase();

    if (avatarUrl) {
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`;
    }

    return `<span class="${escapeHtml(className)}">${escapeHtml(initial)}</span>`;
}

// 共享用户使用列表行展示，避免用标签式 chip 承载用户身份信息。
function renderWorkspaceShareSelectedUserRow(userId) {
    const user = getWorkspaceShareCachedUser(userId);
    const displayName = getWorkspaceShareDisplayName(user) || userId;
    const role = String((user || {}).role || '').trim();
    const userMeta = role ? `@${userId} · ${role}` : `@${userId}`;
    const avatarHtml = renderWorkspaceShareAvatar(user, 'workspace-share-selected-avatar');

    return `
        <div class="workspace-share-selected-row" data-workspace-share-user="${escapeHtml(userId)}">
            ${avatarHtml}
            <span class="workspace-share-selected-meta">
                <span class="workspace-share-selected-name">${escapeHtml(displayName)}</span>
                <span class="workspace-share-selected-handle">${escapeHtml(userMeta)}</span>
            </span>
            <button class="workspace-share-selected-remove" type="button" data-workspace-share-remove="${escapeHtml(userId)}" title="移除 ${escapeHtml(displayName)}" aria-label="移除 ${escapeHtml(displayName)}">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
        </div>
    `;
}

function setWorkspaceShareSelectedUsers(users) {
    const modal = ensureWorkspaceShareModal();
    const selected = Array.from(new Set(
        (Array.isArray(users) ? users : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean),
    )).filter((item) => item !== String(currentUsername || '').trim());
    const host = modal.querySelector('#workspaceShareSelectedUsers');

    modal.setAttribute('data-shared-users', selected.join(','));

    if (!host) {
        return;
    }

    if (!selected.length) {
        host.innerHTML = '<div class="workspace-share-empty">还没有共享用户</div>';
        showWorkspaceShareUserMenuIfVisible();
        return;
    }

    host.innerHTML = `
        <div class="workspace-share-selected-list">
            ${selected.map(renderWorkspaceShareSelectedUserRow).join('')}
        </div>
    `;
    showWorkspaceShareUserMenuIfVisible();
}

function getWorkspaceShareUserId(user) {
    return String((user || {}).user_id || (user || {}).username || '').trim();
}

function getWorkspaceShareDisplayName(user) {
    return String((user || {}).display_name || (user || {}).username || getWorkspaceShareUserId(user)).trim();
}

function getWorkspaceShareUserAvatarUrl(user) {
    return String((user || {}).avatar_url || (user || {}).avatar || '').trim();
}

function getWorkspaceShareUserSearchText(user) {
    return [
        getWorkspaceShareUserId(user),
        getWorkspaceShareDisplayName(user),
        String((user || {}).role || '').trim(),
    ].join(' ').toLowerCase();
}

function getWorkspaceShareFilteredUsers() {
    const modal = ensureWorkspaceShareModal();
    const input = modal.querySelector('#workspaceShareUserInput');
    const query = String((input && input.value) || '').trim().toLowerCase();
    const currentUserId = String(currentUsername || '').trim();
    const selected = new Set(getWorkspaceShareSelectedUsers());

    const users = workspaceShareUserSelectorState.users.filter((item) => {
        const userId = getWorkspaceShareUserId(item);

        if (!userId || userId === currentUserId || selected.has(userId)) {
            return false;
        }

        if (!query) {
            return true;
        }

        return getWorkspaceShareUserSearchText(item).includes(query);
    });

    return users.slice(0, 8);
}

function showWorkspaceShareUserMenuIfVisible() {
    if (workspaceShareUserSelectorState.visible) {
        showWorkspaceShareUserMenu();
    }
}

function showWorkspaceShareUserMenu() {
    workspaceShareUserSelectorState.filteredUsers = getWorkspaceShareFilteredUsers();
    workspaceShareUserSelectorState.activeIndex = 0;
    workspaceShareUserSelectorState.visible = true;
    renderWorkspaceShareUserMenu();
}

function hideWorkspaceShareUserMenu() {
    workspaceShareUserSelectorState.visible = false;
    renderWorkspaceShareUserMenu();
}

function selectWorkspaceShareUser(user) {
    const userId = getWorkspaceShareUserId(user);

    if (!userId) {
        return;
    }

    rememberWorkspaceShareUsers([user]);
    addWorkspaceShareUserFromInput(userId, {
        keepMenuClosed: true,
        skipReload: true,
    });
    hideWorkspaceShareUserMenu();
}

function renderWorkspaceShareUserMenu() {
    const modal = ensureWorkspaceShareModal();
    const input = modal.querySelector('#workspaceShareUserInput');
    const menu = modal.querySelector('#workspaceShareUserMenu');

    if (!input || !menu) {
        return;
    }

    if (!workspaceShareUserSelectorState.visible) {
        input.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
        menu.style.display = 'none';
        menu.innerHTML = '';
        return;
    }

    input.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.style.display = 'grid';

    if (workspaceShareUserSelectorState.error) {
        menu.innerHTML = `<div class="admin-user-token-empty">${escapeHtml(workspaceShareUserSelectorState.error)}</div>`;
        return;
    }

    if (workspaceShareUserSelectorState.loading) {
        menu.innerHTML = '<div class="admin-user-token-empty">正在加载用户...</div>';
        return;
    }

    const rows = workspaceShareUserSelectorState.filteredUsers;

    if (!rows.length) {
        menu.innerHTML = '<div class="admin-user-token-empty">没有匹配的用户</div>';
        return;
    }

    menu.innerHTML = rows.map((user, index) => {
        const userId = getWorkspaceShareUserId(user);
        const displayName = getWorkspaceShareDisplayName(user) || userId;
        const role = String((user || {}).role || '').trim();
        const userMeta = role ? `@${userId} · ${role}` : `@${userId}`;
        const active = index === workspaceShareUserSelectorState.activeIndex ? ' is-active' : '';
        const avatarHtml = renderWorkspaceShareAvatar(
            user,
            'learning-feed-mention-avatar admin-user-token-avatar workspace-share-user-avatar',
        );

        return `
            <button type="button" class="learning-feed-mention-item admin-user-token-item workspace-share-user-item${active}" role="option" aria-selected="${active ? 'true' : 'false'}" data-workspace-share-user-index="${index}">
                ${avatarHtml}
                <span class="learning-feed-mention-meta admin-user-token-meta workspace-share-user-meta">
                    <span class="learning-feed-mention-name">${escapeHtml(displayName)}</span>
                    <span class="learning-feed-mention-handle">${escapeHtml(userMeta)}</span>
                </span>
            </button>
        `;
    }).join('');
}

async function loadWorkspaceShareUserOptions(query = '') {
    const modal = ensureWorkspaceShareModal();
    const input = modal.querySelector('#workspaceShareUserInput');
    const safeQuery = String(query || '').trim();
    const requestId = workspaceShareUserSelectorState.requestId + 1;

    workspaceShareUserSelectorState.requestId = requestId;
    workspaceShareUserSelectorState.loading = true;
    workspaceShareUserSelectorState.error = '';
    renderWorkspaceShareUserMenu();

    try {
        const res = await fetch(`/api/user/search?q=${encodeURIComponent(safeQuery)}&limit=20`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error((data && data.message) || '用户列表加载失败');
        }

        if (workspaceShareUserSelectorState.requestId !== requestId) {
            return;
        }

        if (!Array.isArray(data.items)) {
            throw new Error('用户列表格式错误');
        }

        workspaceShareUserSelectorState.loading = false;
        rememberWorkspaceShareUsers(data.items);
        workspaceShareUserSelectorState.users = data.items;
        setWorkspaceShareSelectedUsers(getWorkspaceShareSelectedUsers());

        if (workspaceShareUserSelectorState.visible || document.activeElement === input) {
            showWorkspaceShareUserMenu();
        } else {
            renderWorkspaceShareUserMenu();
        }
    } catch (error) {
        console.error('loadWorkspaceShareUserOptions failed', error);

        if (workspaceShareUserSelectorState.requestId !== requestId) {
            return;
        }

        workspaceShareUserSelectorState.users = [];
        workspaceShareUserSelectorState.filteredUsers = [];
        workspaceShareUserSelectorState.loading = false;
        workspaceShareUserSelectorState.error = String((error && error.message) || '用户列表加载失败');
        workspaceShareUserSelectorState.visible = true;
        renderWorkspaceShareUserMenu();
    }
}

async function loadWorkspaceShareSelectedUserDetails(userIds) {
    const ids = Array.from(new Set(
        (Array.isArray(userIds) ? userIds : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean),
    )).filter((userId) => !workspaceShareUserSelectorState.userDetailsById.has(userId));

    if (!ids.length) {
        return;
    }

    try {
        const results = await Promise.all(ids.map(async (userId) => {
            const res = await fetch(`/api/user/search?q=${encodeURIComponent(userId)}&limit=20`);
            const data = await res.json();

            if (!res.ok || !data.success || !Array.isArray(data.items)) {
                throw new Error((data && data.message) || `用户详情加载失败：${userId}`);
            }

            const matched = data.items.find((item) => getWorkspaceShareUserId(item) === userId);

            if (!matched) {
                console.warn('[WorkspaceShare] selected user not found in search result', userId);
                return null;
            }

            return matched;
        }));

        rememberWorkspaceShareUsers(results.filter(Boolean));
        setWorkspaceShareSelectedUsers(getWorkspaceShareSelectedUsers());
    } catch (error) {
        console.error('loadWorkspaceShareSelectedUserDetails failed', error);
    }
}

function addWorkspaceShareUserFromInput(explicitUserId = '', options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const modal = ensureWorkspaceShareModal();
    const input = modal.querySelector('#workspaceShareUserInput');
    const userId = String(explicitUserId || (input && input.value) || '').trim();

    if (!userId) {
        showToast('请输入要分享的用户');
        return;
    }

    if (userId === String(currentUsername || '').trim()) {
        showToast('不能分享给自己');
        return;
    }

    setWorkspaceShareSelectedUsers([...getWorkspaceShareSelectedUsers(), userId]);

    if (input) {
        input.value = '';
        input.blur();
    }

    hideWorkspaceShareUserMenu();

    if (!opts.skipReload) {
        void loadWorkspaceShareUserOptions('');
    }

    if (!workspaceShareUserSelectorState.userDetailsById.has(userId)) {
        void loadWorkspaceShareSelectedUserDetails([userId]);
    }
}

function openWorkspaceShareModal() {
    const workspace = workspaceProjectsState.selectedWorkspace || null;

    if (!workspace || !isWorkspaceOwnedByCurrentUser(workspace)) {
        showToast('只有 Workspace 创建者可以分享');
        return;
    }

    const modal = ensureWorkspaceShareModal();
    const input = modal.querySelector('#workspaceShareUserInput');
    const confirmBtn = modal.querySelector('#workspaceShareModalConfirmBtn');

    modal.setAttribute('data-workspace-id', getWorkspaceProjectId(workspace));
    const sharedUsers = getWorkspaceSharedUsers(workspace);
    setWorkspaceShareSelectedUsers(sharedUsers);
    workspaceShareUserSelectorState.users = [];
    workspaceShareUserSelectorState.filteredUsers = [];
    workspaceShareUserSelectorState.activeIndex = 0;
    workspaceShareUserSelectorState.visible = false;
    workspaceShareUserSelectorState.loading = false;
    workspaceShareUserSelectorState.error = '';

    if (input) {
        input.value = '';
    }

    renderWorkspaceShareUserMenu();

    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '保存';
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    handleBackdropStackingChange(modal);
    void loadWorkspaceShareUserOptions('');
    void loadWorkspaceShareSelectedUserDetails(sharedUsers);
}

function closeWorkspaceShareModal() {
    const modal = document.getElementById('workspaceShareModal');

    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    hideWorkspaceShareUserMenu();
    handleBackdropStackingChange(modal);
}

async function submitWorkspaceShareModal() {
    const modal = ensureWorkspaceShareModal();
    const workspaceId = String(modal.getAttribute('data-workspace-id') || '').trim();
    const confirmBtn = modal.querySelector('#workspaceShareModalConfirmBtn');
    const sharedUsers = getWorkspaceShareSelectedUsers();

    if (!workspaceId) {
        showToast('Workspace 不存在');
        return;
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '保存中...';
    }

    try {
        const workspace = await updateWorkspaceSharedUsers(workspaceId, sharedUsers);
        workspaceProjectsState.selectedWorkspace = workspace || workspaceProjectsState.selectedWorkspace;
        renderWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
        closeWorkspaceShareModal();
        showToast('Workspace 分享设置已保存');
    } catch (error) {
        console.error('submitWorkspaceShareModal failed', error);
        showToast(String((error && error.message) || 'Workspace 分享设置保存失败'));
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '保存';
        }
    }
}

async function submitWorkspaceCreateModal() {
    const modal = ensureWorkspaceCreateModal();
    const input = modal.querySelector('#workspaceCreateTitleInput');
    const confirmBtn = modal.querySelector('#workspaceCreateModalConfirmBtn');
    const title = String((input && input.value) || '').trim();

    if (!title) {
        showToast('请输入 Workspace 名称');

        if (input) {
            input.focus();
        }

        return;
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '创建中...';
    }

    const created = await createWorkspaceProject(title);

    if (created) {
        closeWorkspaceCreateModal();
    }

    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建';
    }
}

async function loadWorkspaceProjects(selectWorkspaceId = '') {
    const list = document.getElementById('workspaceProjectsList');

    if (list) {
        list.innerHTML = '<div class="workspace-projects-empty">正在加载 Workspaces...</div>';
    }

    try {
        const res = await fetch('/api/workspace/list');
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message || 'Workspaces 加载失败');
        }

        workspaceProjectsState.items = Array.isArray(data.workspaces) ? data.workspaces : [];
        renderWorkspaceProjectsList();

        if (selectWorkspaceId) {
            await selectWorkspaceProject(selectWorkspaceId);
        }
    } catch (error) {
        console.error('loadWorkspaceProjects failed', error);

        if (list) {
            list.innerHTML = '<div class="workspace-projects-empty">Workspaces 加载失败</div>';
        }

        showToast('Workspaces 加载失败');
    }
}

async function createWorkspaceProject(title) {
    const workspaceTitle = String(title || '').trim();

    if (!workspaceTitle) {
        showToast('请输入 Workspace 名称');
        return false;
    }

    try {
        const res = await fetch('/api/workspace/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: workspaceTitle,
                shared_users: [],
            }),
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message || 'Workspace 创建失败');
        }

        const workspaceId = String((data.workspace || {}).workspace_id || '').trim();
        showToast('Workspace 已创建');
        await loadWorkspaceProjects(workspaceId);
        return true;
    } catch (error) {
        console.error('createWorkspaceProject failed', error);
        showToast(String((error && error.message) || 'Workspace 创建失败'));
        return false;
    }
}

async function deleteWorkspaceProject(workspaceId) {
    const wid = String(workspaceId || '').trim();

    if (!wid) {
        throw new Error('Workspace 不存在');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}`, {
        method: 'DELETE',
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || 'Workspace 删除失败');
    }

    workspaceProjectsState.items = workspaceProjectsState.items.filter((item) => {
        return String((item || {}).workspace_id || '').trim() !== wid;
    });

    if (getWorkspaceProjectId(workspaceProjectsState.selectedWorkspace) === wid) {
        workspaceProjectsState.selectedWorkspace = null;
        workspaceProjectsState.activeDetailTab = 'chat';
    }

    renderWorkspaceProjectsList();
    return data;
}

async function confirmDeleteSelectedWorkspaceProject() {
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const title = getWorkspaceProjectTitle(workspace);

    if (!workspaceId) {
        showToast('Workspace 不存在');
        return;
    }

    if (!isWorkspaceOwnedByCurrentUser(workspace)) {
        showToast('只有创建者可以删除 Workspace');
        return;
    }

    const confirmed = await confirmModalAsync(
        '删除 Workspace',
        `确认删除 Workspace「${title}」吗？此操作只会删除 Workspace，不会删除其中的对话、知识库或文件。`,
        'danger',
    );

    if (!confirmed) {
        return;
    }

    try {
        await deleteWorkspaceProject(workspaceId);
        showToast('Workspace 已删除，关联资源已保留');
        window.openWorkspacesFrameView();
    } catch (error) {
        console.error('deleteWorkspaceProject failed', error);
        showToast(String((error && error.message) || 'Workspace 删除失败'));
    }
}

async function selectWorkspaceProject(workspaceId) {
    const id = String(workspaceId || '').trim();

    if (!id) {
        return;
    }

    try {
        const previousWorkspaceId = getWorkspaceProjectId(workspaceProjectsState.selectedWorkspace);

        if (previousWorkspaceId && previousWorkspaceId !== id) {
            workspaceProjectsState.activeDetailTab = 'chat';
        }

        const res = await fetch(`/api/workspace/${encodeURIComponent(id)}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message || 'Workspace 加载失败');
        }

        workspaceProjectsState.selectedWorkspace = data.workspace || null;
        renderWorkspaceProjectsList();
        openWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
    } catch (error) {
        console.error('selectWorkspaceProject failed', error);
        showToast(String((error && error.message) || 'Workspace 加载失败'));
    }
}

async function addConversationToWorkspace(workspaceId, conversationId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const wid = String(workspaceId || '').trim();
    const cid = String(conversationId || '').trim();

    if (!wid || !cid) {
        throw new Error('workspace_id 和 conversation_id 不能为空');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/conversations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            conversation_id: cid,
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || '对话归入 Workspace 失败');
    }

    if (opts.syncSelectedWorkspace !== false) {
        workspaceProjectsState.selectedWorkspace = data.workspace || null;
    }

    if (opts.refreshList !== false) {
        await loadWorkspaceProjects();
    }

    return data.workspace || null;
}

async function addKnowledgeToWorkspace(workspaceId, title, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const wid = String(workspaceId || '').trim();
    const safeTitle = String(title || '').trim();

    if (!wid || !safeTitle) {
        throw new Error('workspace_id 和知识标题不能为空');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/knowledge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: safeTitle,
            knowledge_type: 'basis',
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || '知识归入 Workspace 失败');
    }

    if (opts.syncSelectedWorkspace !== false) {
        workspaceProjectsState.selectedWorkspace = data.workspace || null;
    }

    if (opts.refreshList !== false) {
        await loadWorkspaceProjects();
    }

    return data.workspace || null;
}

async function addFileToWorkspace(workspaceId, fileRef, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const wid = String(workspaceId || '').trim();
    const safeFileRef = String(fileRef || '').trim();

    if (!wid || !safeFileRef) {
        throw new Error('workspace_id 和文件路径不能为空');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/files`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            file_ref: safeFileRef,
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || '文件归入 Workspace 失败');
    }

    if (opts.syncSelectedWorkspace !== false) {
        workspaceProjectsState.selectedWorkspace = data.workspace || null;
    }

    if (opts.refreshList !== false) {
        await loadWorkspaceProjects();
    }

    return data.workspace || null;
}

async function createBlankKnowledgeInWorkspace(workspaceId, titlePrefix) {
    const wid = String(workspaceId || '').trim();
    const safeTitlePrefix = String(titlePrefix || '').trim();

    if (!wid) {
        throw new Error('Workspace 不存在，无法创建知识库');
    }

    if (!safeTitlePrefix) {
        throw new Error('知识库标题不能为空');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/knowledge/blank`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title_prefix: safeTitlePrefix,
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || '空白知识库创建失败');
    }

    workspaceProjectsState.selectedWorkspace = data.workspace || workspaceProjectsState.selectedWorkspace;
    syncWorkspaceProjectAfterDetailUpdate(data.workspace);

    return {
        title: String(data.title || '').trim(),
        workspace: data.workspace || null,
    };
}

function normalizeWorkspaceVisibility(value) {
    const visibility = String(value || 'private').trim().toLowerCase();

    if (visibility === 'share') {
        return 'share';
    }

    return 'private';
}

function getWorkspaceVisibilityLabel(visibility) {
    return normalizeWorkspaceVisibility(visibility) === 'share' ? 'Shared' : 'Private';
}

function syncWorkspaceProjectAfterDetailUpdate(workspace) {
    if (!workspace) {
        return;
    }

    const workspaceId = getWorkspaceProjectId(workspace);
    workspaceProjectsState.selectedWorkspace = workspace;
    workspaceProjectsState.items = workspaceProjectsState.items.map((item) => {
        const itemId = String((item || {}).workspace_id || '').trim();

        if (itemId !== workspaceId) {
            return item;
        }

        return {
            ...item,
            title: workspace.title,
            updated_at: workspace.updated_at,
            shared_users: getWorkspaceSharedUsers(workspace),
            conversation_count: workspace.conversation_count,
            knowledge_document_count: workspace.knowledge_document_count,
            workspace_file_count: workspace.workspace_file_count,
            temp_file_count: workspace.temp_file_count,
        };
    });

    renderWorkspaceProjectsList();
}

async function postWorkspaceVisibilityUpdate(url, payload, errorMessage) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || errorMessage);
    }

    const workspace = data.workspace || null;
    syncWorkspaceProjectAfterDetailUpdate(workspace);
    return workspace;
}

async function updateWorkspaceConversationVisibility(workspaceId, conversationId, visibility) {
    const wid = String(workspaceId || '').trim();
    const cid = String(conversationId || '').trim();
    const nextVisibility = normalizeWorkspaceVisibility(visibility);

    if (!wid || !cid) {
        throw new Error('workspace_id 和 conversation_id 不能为空');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/conversations/${encodeURIComponent(cid)}/visibility`,
        {
            visibility: nextVisibility,
        },
        '对话共享状态保存失败',
    );
}

async function updateWorkspaceKnowledgeVisibility(workspaceId, title, visibility, knowledgeType = 'basis') {
    const wid = String(workspaceId || '').trim();
    const safeTitle = String(title || '').trim();
    const safeType = String(knowledgeType || 'basis').trim() || 'basis';
    const nextVisibility = normalizeWorkspaceVisibility(visibility);

    if (!wid || !safeTitle) {
        throw new Error('workspace_id 和知识标题不能为空');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/knowledge/visibility`,
        {
            title: safeTitle,
            knowledge_type: safeType,
            visibility: nextVisibility,
        },
        '知识库共享状态保存失败',
    );
}

async function updateWorkspaceFileVisibility(workspaceId, fileRef, visibility) {
    const wid = String(workspaceId || '').trim();
    const safeFileRef = String(fileRef || '').trim();
    const nextVisibility = normalizeWorkspaceVisibility(visibility);

    if (!wid || !safeFileRef) {
        throw new Error('workspace_id 和文件路径不能为空');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/files/visibility`,
        {
            file_ref: safeFileRef,
            visibility: nextVisibility,
        },
        '文件共享状态保存失败',
    );
}

async function updateWorkspaceConversationPin(workspaceId, conversationId, pin) {
    const wid = String(workspaceId || '').trim();
    const cid = String(conversationId || '').trim();

    if (!wid || !cid) {
        throw new Error('Workspace 对话不存在');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/conversations/${encodeURIComponent(cid)}/pin`,
        {
            pin: !!pin,
        },
        'Workspace 对话置顶保存失败',
    );
}

async function updateWorkspaceKnowledgePin(workspaceId, title, pin, knowledgeType = 'basis', addedBy = '') {
    const wid = String(workspaceId || '').trim();
    const safeTitle = String(title || '').trim();

    if (!wid || !safeTitle) {
        throw new Error('Workspace 知识库不存在');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/knowledge/pin`,
        {
            title: safeTitle,
            knowledge_type: String(knowledgeType || 'basis').trim() || 'basis',
            added_by: String(addedBy || '').trim(),
            pin: !!pin,
        },
        'Workspace 知识库置顶保存失败',
    );
}

async function updateWorkspaceFilePin(workspaceId, fileRef, pin, addedBy = '') {
    const wid = String(workspaceId || '').trim();
    const safeFileRef = String(fileRef || '').trim();

    if (!wid || !safeFileRef) {
        throw new Error('Workspace 文件不存在');
    }

    return postWorkspaceVisibilityUpdate(
        `/api/workspace/${encodeURIComponent(wid)}/files/pin`,
        {
            file_ref: safeFileRef,
            added_by: String(addedBy || '').trim(),
            pin: !!pin,
        },
        'Workspace 文件置顶保存失败',
    );
}

async function updateWorkspaceProjectTitle(workspaceId, title) {
    const wid = String(workspaceId || '').trim();
    const safeTitle = String(title || '').trim();

    if (!wid || !safeTitle) {
        throw new Error('Workspace 名称不能为空');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/settings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: safeTitle,
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || 'Workspace 名称保存失败');
    }

    const workspace = data.workspace || null;

    if (workspace) {
        workspaceProjectsState.selectedWorkspace = workspace;
        workspaceProjectsState.items = workspaceProjectsState.items.map((item) => {
            const itemId = String((item || {}).workspace_id || '').trim();

            if (itemId !== wid) {
                return item;
            }

            return {
                ...item,
                title: workspace.title,
                updated_at: workspace.updated_at,
            };
        });
    }

    return workspace;
}

async function updateWorkspaceSharedUsers(workspaceId, sharedUsers) {
    const wid = String(workspaceId || '').trim();
    const users = Array.isArray(sharedUsers)
        ? sharedUsers.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    if (!wid) {
        throw new Error('Workspace 不存在');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/settings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            shared_users: users,
        }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || 'Workspace 分享设置保存失败');
    }

    const workspace = data.workspace || null;

    if (workspace) {
        workspaceProjectsState.selectedWorkspace = workspace;
        workspaceProjectsState.items = workspaceProjectsState.items.map((item) => {
            const itemId = String((item || {}).workspace_id || '').trim();

            if (itemId !== wid) {
                return item;
            }

            return {
                ...item,
                title: workspace.title,
                updated_at: workspace.updated_at,
                shared_users: getWorkspaceSharedUsers(workspace),
            };
        });
        renderWorkspaceProjectsList();
    }

    return workspace;
}

function ensureWorkspaceResourceContextMenu() {
    let menu = document.getElementById('workspaceResourceContextMenu');

    if (menu) {
        return menu;
    }

    menu = document.createElement('div');
    menu.id = 'workspaceResourceContextMenu';
    menu.className = 'workspace-resource-context-menu';
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
        <button type="button" data-workspace-resource-pin>
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
            <span>置顶</span>
        </button>
    `;
    document.body.appendChild(menu);

    menu.querySelector('[data-workspace-resource-pin]')?.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await submitWorkspaceResourcePin();
    });

    document.addEventListener('click', (event) => {
        if (!menu.classList.contains('active')) {
            return;
        }

        if (event.target instanceof Element && menu.contains(event.target)) {
            return;
        }

        hideWorkspaceResourceContextMenu();
    });

    document.addEventListener('scroll', () => {
        hideWorkspaceResourceContextMenu();
    }, true);
    window.addEventListener('resize', hideWorkspaceResourceContextMenu);

    return menu;
}

function hideWorkspaceResourceContextMenu() {
    const menu = document.getElementById('workspaceResourceContextMenu');

    if (!menu) {
        return;
    }

    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    workspaceResourceContextMenuState = null;
}

function showWorkspaceResourceContextMenu(x, y, state) {
    const menu = ensureWorkspaceResourceContextMenu();
    const nextState = (state && typeof state === 'object') ? state : null;

    if (!nextState || !nextState.resourceType) {
        return;
    }

    if (typeof hidePinContextMenu === 'function') {
        hidePinContextMenu();
    }

    if (typeof hideNotesContextMenu === 'function') {
        hideNotesContextMenu();
    }

    workspaceResourceContextMenuState = { ...nextState };
    const pinButton = menu.querySelector('[data-workspace-resource-pin]');
    const label = pinButton ? pinButton.querySelector('span') : null;
    const pinned = !!workspaceResourceContextMenuState.pinned;

    if (label) {
        label.textContent = pinned ? '取消置顶' : '置顶';
    }

    if (pinButton) {
        pinButton.title = pinned ? '取消置顶' : '置顶';
        pinButton.disabled = false;
    }

    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');

    const menuWidth = menu.offsetWidth || 136;
    const menuHeight = menu.offsetHeight || 48;
    const left = Math.min(Math.max(8, Number(x || 0)), Math.max(8, window.innerWidth - menuWidth - 12));
    const top = Math.min(Math.max(8, Number(y || 0)), Math.max(8, window.innerHeight - menuHeight - 12));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

async function submitWorkspaceResourcePin() {
    const state = workspaceResourceContextMenuState ? { ...workspaceResourceContextMenuState } : null;
    const menu = document.getElementById('workspaceResourceContextMenu');
    const pinButton = menu ? menu.querySelector('[data-workspace-resource-pin]') : null;

    if (!state) {
        hideWorkspaceResourceContextMenu();
        return;
    }

    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const nextPin = !state.pinned;

    if (!workspaceId) {
        showToast('Workspace 不存在');
        hideWorkspaceResourceContextMenu();
        return;
    }

    if (pinButton) {
        pinButton.disabled = true;
    }

    try {
        if (state.resourceType === 'conversation') {
            await updateWorkspaceConversationPin(workspaceId, state.conversationId, nextPin);
            showToast(nextPin ? 'Workspace 对话已置顶' : 'Workspace 对话已取消置顶');
        } else if (state.resourceType === 'knowledge') {
            await updateWorkspaceKnowledgePin(
                workspaceId,
                state.title,
                nextPin,
                state.knowledgeType,
                state.addedBy,
            );
            showToast(nextPin ? 'Workspace 知识库已置顶' : 'Workspace 知识库已取消置顶');
        } else if (state.resourceType === 'file') {
            await updateWorkspaceFilePin(
                workspaceId,
                state.fileRef,
                nextPin,
                state.addedBy,
            );
            showToast(nextPin ? 'Workspace 文件已置顶' : 'Workspace 文件已取消置顶');
        } else {
            throw new Error('Workspace 资源类型无效');
        }

        hideWorkspaceResourceContextMenu();
        renderWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
    } catch (error) {
        console.error('submitWorkspaceResourcePin failed', error);
        showToast(String((error && error.message) || 'Workspace 置顶失败'));

        if (pinButton) {
            pinButton.disabled = false;
        }
    }
}

function bindWorkspaceResourceContextMenu(list, rowSelector, buildState) {
    if (!list || typeof buildState !== 'function') {
        return;
    }

    list.addEventListener('contextmenu', (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        if (target.closest('[data-workspace-visibility-toggle]')) {
            return;
        }

        const row = target.closest(rowSelector);

        if (!row || !list.contains(row)) {
            return;
        }

        const state = buildState(row);

        if (!state) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showWorkspaceResourceContextMenu(event.clientX, event.clientY, state);
    });
}

function renderWorkspaceProjectConversationRows(workspace) {
    const conversations = sortWorkspacePinnedItems(getWorkspaceProjectConversations(workspace));

    if (!conversations.length) {
        return '<div class="workspace-detail-empty">暂无已加入的对话</div>';
    }

    return conversations.map((item) => {
        const conversationId = String(item.conversation_id || '').trim();
        const rawTitle = String(item.title || conversationId || 'Untitled Conversation').trim();
        const title = escapeHtml(rawTitle);
        const rawLastUserQuestion = String(item.last_user_question || '暂无用户提问').trim();
        const date = escapeHtml(formatWorkspaceDate(item.updated_at || item.added_at || item.created_at));
        const visibility = normalizeWorkspaceVisibility(item.visibility);
        const addedBy = String((item && item.added_by) || '').trim();
        const ownerText = addedBy ? `@${addedBy}` : '未知用户';
        const detailText = escapeHtml(`${ownerText} · ${rawLastUserQuestion}`);
        const canEditVisibility = isWorkspaceResourceOwnedByCurrentUser(workspace, item);
        const canOpenConversation = canEditVisibility || visibility === 'share';
        const pinned = isWorkspaceResourcePinned(item);
        const pinHtml = pinned ? '<i class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>' : '';
        const rowClass = canOpenConversation
            ? `workspace-detail-conversation is-clickable${canEditVisibility ? '' : ' is-readonly'}`
            : 'workspace-detail-conversation is-readonly';
        const openAttrs = canOpenConversation
            ? `role="button" tabindex="0" data-workspace-openable="true" aria-label="${escapeHtml(canEditVisibility ? `打开对话：${rawTitle}` : `只读打开共享对话：${rawTitle}`)}"`
            : `role="listitem" tabindex="-1" data-workspace-openable="false" aria-label="共享对话：${escapeHtml(rawTitle)}" aria-disabled="true"`;

        return `
            <div class="${rowClass}${pinned ? ' is-pinned' : ''}" ${openAttrs} data-conversation-id="${escapeHtml(conversationId)}" data-conversation-added-by="${escapeHtml(addedBy)}" data-workspace-pinned="${pinned ? '1' : '0'}">
                <span class="workspace-detail-conversation-main">
                    <strong>${pinHtml}${title}</strong>
                    <small>${detailText}</small>
                </span>
                <span class="workspace-detail-row-side">
                    <span class="workspace-detail-row-date">${date}</span>
                    ${renderWorkspaceVisibilitySwitch({
                        resourceType: 'conversation',
                        conversationId,
                        visibility,
                        disabled: !canEditVisibility,
                    })}
                </span>
            </div>
        `;
    }).join('');
}

async function openWorkspaceDetailConversation(conversationId, addedBy = '') {
    const cid = String(conversationId || '').trim();
    const owner = String(addedBy || '').trim();
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const conversation = findWorkspaceConversationItem(workspace, cid);

    if (!cid) {
        showToast('对话不存在');
        return;
    }

    if (!conversation) {
        return;
    }

    if (!isWorkspaceResourceOwnedByCurrentUser(workspace, conversation)) {
        await openWorkspaceSharedConversation(cid, owner || String(conversation.added_by || '').trim());
        return;
    }

    await loadConversation(cid, {
        workspaceContext: {
            workspaceId,
            workspaceTitle: getWorkspaceProjectTitle(workspace),
        },
    });
}

function removeWorkspaceReadonlyMutationActions(container) {
    if (!container) {
        return;
    }

    const mutationButtons = container.querySelectorAll(
        [
            '.btn-action[data-action="edit-user-prompt"]',
            '.btn-action.btn-del',
            '.btn-action[onclick^="confirmRegenerate"]',
            '.btn-action[onclick^="toggleEditUserPrompt"]',
        ].join(','),
    );

    mutationButtons.forEach((button) => {
        button.remove();
    });

    container.querySelectorAll('.version-switcher').forEach((node) => {
        node.remove();
    });

    container.querySelectorAll('.msg-actions').forEach((actions) => {
        if (!actions.textContent.trim() && !actions.querySelector('button, a, input, select, textarea')) {
            actions.remove();
        }
    });
}

async function fetchWorkspaceSharedConversation(workspaceId, conversationId) {
    const wid = String(workspaceId || '').trim();
    const cid = String(conversationId || '').trim();

    if (!wid || !cid) {
        throw new Error('共享对话不存在');
    }

    const res = await fetch(`/api/workspace/${encodeURIComponent(wid)}/conversations/${encodeURIComponent(cid)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
        throw new Error((data && data.message) || '共享对话读取失败');
    }

    return data;
}

function renderWorkspaceReadonlyHeader(workspaceId, workspaceTitle, conversationTitle, ownerUsername) {
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!headerTitle || !headerLeft || !headerRight) {
        return;
    }

    ensureWorkspaceViewerBaseHeaderState(headerTitle, headerLeft, headerRight);
    headerTitle.textContent = conversationTitle || '共享对话';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="selectWorkspaceProject('${escapeHtml(workspaceId)}')" title="返回 Workspace" aria-label="返回 Workspace">
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);
    renderWorkspaceConversationHierarchy({
        workspaceId,
        workspaceTitle,
    });

    if (ownerUsername) {
        headerTitle.title = `只读共享 · @${ownerUsername}`;
    }
}

function prepareWorkspaceReadonlyConversationView(payload) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const inputDock = document.querySelector('.input-dock');
    const conversation = (payload && payload.conversation) || {};
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const workspaceId = String((payload && payload.workspace_id) || '').trim();
    const ownerUsername = String((payload && payload.owner_username) || '').trim();

    if (!msgs) {
        throw new Error('消息容器不存在');
    }

    closeKnowledgePanel();
    closeCloudFilePanel();
    exitLearningFeedComposeMode({ clear: false });
    restoreWorkspaceDetailInputContainer();
    resetComposerConversationContextUsage();
    detachCurrentVisibleStreamForNavigation('');
    currentConversationId = null;
    syncBrowserCurrentConversation();
    syncGenerationStateForCurrentConversation();
    syncNotesForConversation(null);
    conversationListRenderSignature = '';
    renderConversationList(conversationListCache);
    currentViewingKnowledge = null;
    pendingHighlightData = null;
    navigationStack = [];

    if (viewer) {
        viewer.style.display = 'none';
    }

    if (els.learningMainPanel) {
        els.learningMainPanel.style.display = 'none';
    }

    if (inputDock) {
        inputDock.style.display = 'none';
    }

    if (inputWrapper) {
        inputWrapper.style.display = 'none';
    }

    msgs.style.display = '';
    msgs.classList.add('workspace-shared-conversation-readonly');
    msgs.dataset.workspaceReadonly = '1';
    msgs.dataset.workspaceId = workspaceId;
    msgs.dataset.ownerUsername = ownerUsername;

    workspaceReadonlyConversationState = {
        active: true,
        workspaceId,
        conversationId: String((conversation && conversation.conversation_id) || '').trim(),
        ownerUsername,
    };

    if (!messages.length) {
        msgs.innerHTML = '<div class="workspace-readonly-empty">这个共享对话还没有消息</div>';
        return;
    }

    shouldAutoScroll = true;
    renderMessages(messages, false, { instant: true });
    removeWorkspaceReadonlyMutationActions(msgs);
}

async function openWorkspaceSharedConversation(conversationId, addedBy = '') {
    const cid = String(conversationId || '').trim();
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const ownerUsername = String(addedBy || '').trim();

    if (!cid || !workspaceId) {
        showToast('共享对话不存在');
        return;
    }

    try {
        const payload = await fetchWorkspaceSharedConversation(workspaceId, cid);
        const conversation = (payload && payload.conversation) || {};
        const marker = (payload && payload.marker) || {};
        const title = String(conversation.title || marker.title || cid).trim();
        const resolvedOwner = String(payload.owner_username || ownerUsername).trim();
        const workspaceTitle = String(payload.workspace_title || getWorkspaceProjectTitle(workspace)).trim();

        renderWorkspaceReadonlyHeader(workspaceId, workspaceTitle, title, resolvedOwner);
        prepareWorkspaceReadonlyConversationView(payload);

        if (window.history && window.history.pushState) {
            window.history.pushState({}, '', `/chat?workspace=${encodeURIComponent(workspaceId)}&shared_cid=${encodeURIComponent(cid)}`);
        }
    } catch (error) {
        console.error('openWorkspaceSharedConversation failed', error);
        showToast(String((error && error.message) || '共享对话读取失败'));
    }
}

async function openWorkspaceDetailKnowledge(title, knowledgeType = 'basis', addedBy = '') {
    const safeTitle = String(title || '').trim();
    const safeType = String(knowledgeType || 'basis').trim() || 'basis';
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const resourceUser = String(addedBy || currentUsername || '').trim();

    if (!safeTitle) {
        showToast('知识库不存在');
        return;
    }

    if (!workspaceId) {
        showToast('Workspace 不存在');
        return;
    }

    if (!resourceUser) {
        showToast('知识库归属用户不存在');
        return;
    }

    await viewKnowledge(safeTitle, {
        workspaceContext: {
            workspaceId,
            workspaceTitle: getWorkspaceProjectTitle(workspace),
            knowledgeType: safeType,
            user: resourceUser,
        },
    });
}

function getWorkspaceProjectKnowledgeDocuments(workspace) {
    const documents = workspace && Array.isArray(workspace.knowledge_documents)
        ? workspace.knowledge_documents
        : [];

    return documents.filter((item) => item);
}

function getWorkspaceProjectFiles(workspace) {
    if (workspace && Array.isArray(workspace.workspace_files)) {
        return workspace.workspace_files.filter((item) => item);
    }

    const netdisk = workspace && workspace.temp_netdisk && typeof workspace.temp_netdisk === 'object'
        ? workspace.temp_netdisk
        : {};
    const files = Array.isArray(netdisk.files) ? netdisk.files : [];

    return files.filter((item) => item);
}

function getWorkspaceMemoryContent(workspace) {
    const memory = workspace && workspace.workspace_memory && typeof workspace.workspace_memory === 'object'
        ? workspace.workspace_memory
        : {};

    if (memory.enabled === false) {
        return '';
    }

    return String(memory.content || '').trim();
}

function renderWorkspaceMemoryPanel(workspace) {
    const content = getWorkspaceMemoryContent(workspace);

    if (!content) {
        return '<div class="workspace-detail-empty">暂无 Workspace 记忆</div>';
    }

    return `
        <div class="workspace-detail-memory-markdown">
            ${renderMarkdownWithNewTabLinks(content, { breaks: false })}
        </div>
    `;
}

function getWorkspaceResourceText(item, defaultText) {
    if (item && typeof item === 'object') {
        return String(
            item.title
            || item.name
            || item.filename
            || item.document_id
            || item.file_id
            || item.path
            || defaultText
        ).trim();
    }

    return String(item || defaultText).trim();
}

function renderWorkspaceProjectResourceRows(items, emptyText, iconClass, defaultText) {
    if (!items.length) {
        return `<div class="workspace-detail-empty">${escapeHtml(emptyText)}</div>`;
    }

    return items.map((item) => {
        const title = escapeHtml(getWorkspaceResourceText(item, defaultText));

        return `
            <div class="workspace-detail-resource">
                <span class="workspace-detail-resource-icon">
                    <i class="${escapeHtml(iconClass)}" aria-hidden="true"></i>
                </span>
                <span class="workspace-detail-resource-title">${title}</span>
            </div>
        `;
    }).join('');
}

function getWorkspaceFileTitle(item) {
    return String(
        (item && typeof item === 'object')
            ? (item.title || item.original_name || item.alias || item.file_ref || '文件')
            : item || '文件',
    ).trim();
}

function getWorkspaceFileTypeText(item) {
    const ext = String((item && item.source_ext) || '').trim().replace(/^\./, '');

    if (ext) {
        return ext.toUpperCase();
    }

    const title = getWorkspaceFileTitle(item);
    const match = title.match(/\.([^.]+)$/);

    return match ? match[1].toUpperCase() : 'FILE';
}

function renderWorkspaceProjectFileRows(workspace, items) {
    const sortedItems = sortWorkspacePinnedItems(items);

    if (!sortedItems.length) {
        return '<div class="workspace-detail-empty">暂无文件</div>';
    }

    return sortedItems.map((item) => {
        const fileRef = getWorkspaceFileRef(item);
        const rawTitle = getWorkspaceFileTitle(item);
        const title = escapeHtml(rawTitle);
        const date = escapeHtml(formatWorkspaceDate((item && item.updated_at) || (item && item.added_at) || (item && item.created_at)));
        const visibility = normalizeWorkspaceVisibility(item && item.visibility);
        const addedBy = String((item && item.added_by) || '').trim();
        const canEditVisibility = isWorkspaceResourceOwnedByCurrentUser(workspace, item);
        const pinned = isWorkspaceResourcePinned(item);
        const pinHtml = pinned ? '<i class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>' : '';
        const sizeText = formatFileSize((item && item.size) || 0);
        const typeText = getWorkspaceFileTypeText(item);
        const metaParts = [
            addedBy ? `@${addedBy}` : '未知用户',
            sizeText,
            typeText,
        ].filter(Boolean);

        return `
            <div class="workspace-detail-resource workspace-detail-file is-clickable${pinned ? ' is-pinned' : ''}" role="button" tabindex="0" data-file-ref="${escapeHtml(fileRef)}" data-file-added-by="${escapeHtml(addedBy)}" data-workspace-pinned="${pinned ? '1' : '0'}" aria-label="打开文件：${escapeHtml(rawTitle)}">
                <span class="workspace-detail-resource-icon">
                    <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
                </span>
                <span class="workspace-detail-resource-main">
                    <span class="workspace-detail-resource-title">${pinHtml}${title}</span>
                    <span class="workspace-detail-resource-meta">${escapeHtml(metaParts.join(' · '))}</span>
                </span>
                <span class="workspace-detail-row-side">
                    <span class="workspace-detail-row-date">${date}</span>
                    ${renderWorkspaceVisibilitySwitch({
                        resourceType: 'file',
                        fileRef,
                        addedBy,
                        visibility,
                        disabled: !canEditVisibility,
                    })}
                </span>
            </div>
        `;
    }).join('');
}

function workspaceFileRequestUrl(workspaceId, action, fileRef, addedBy = '') {
    const wid = encodeURIComponent(String(workspaceId || '').trim());
    const query = new URLSearchParams();

    query.set('file_ref', String(fileRef || '').trim());

    if (addedBy) {
        query.set('added_by', String(addedBy || '').trim());
    }

    return `/api/workspace/${wid}/files/${action}?${query.toString()}`;
}

function downloadWorkspaceFile(workspaceId, fileRef, addedBy = '') {
    const wid = String(workspaceId || '').trim();
    const ref = String(fileRef || '').trim();

    if (!wid || !ref) {
        showToast('文件不存在');
        return;
    }

    window.open(workspaceFileRequestUrl(wid, 'download', ref, addedBy), '_blank');
}

function closeWorkspaceFilePreviewModal() {
    const modal = document.getElementById('workspaceFilePreviewModal');

    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    handleBackdropStackingChange(modal);
}

function ensureWorkspaceFilePreviewModal() {
    let modal = document.getElementById('workspaceFilePreviewModal');

    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'workspaceFilePreviewModal';
    modal.className = 'modal-backdrop workspace-file-preview-modal-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal workspace-file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceFilePreviewModalTitle">
            <div class="modal-head">
                <h3 id="workspaceFilePreviewModalTitle">文件预览</h3>
                <button id="workspaceFilePreviewModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <div class="modal-body workspace-file-preview-modal-body">
                <div class="workspace-file-preview-meta" id="workspaceFilePreviewMeta"></div>
                <pre class="workspace-file-preview-content" id="workspaceFilePreviewContent"></pre>
            </div>
            <div class="modal-footer workspace-file-preview-modal-footer">
                <button id="workspaceFilePreviewCancelBtn" class="btn-cancel" type="button">关闭</button>
                <button id="workspaceFilePreviewDownloadBtn" class="btn-confirm" type="button">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                    <span>下载</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    registerModalBackdropStacking(modal);
    bindBackdropSafeClose(modal, closeWorkspaceFilePreviewModal);

    modal.querySelector('#workspaceFilePreviewModalCloseBtn')?.addEventListener('click', closeWorkspaceFilePreviewModal);
    modal.querySelector('#workspaceFilePreviewCancelBtn')?.addEventListener('click', closeWorkspaceFilePreviewModal);
    modal.querySelector('#workspaceFilePreviewDownloadBtn')?.addEventListener('click', () => {
        downloadWorkspaceFile(
            modal.getAttribute('data-workspace-id'),
            modal.getAttribute('data-file-ref'),
            modal.getAttribute('data-file-added-by'),
        );
    });

    return modal;
}

async function openWorkspaceDetailFile(fileRef, addedBy = '') {
    const ref = String(fileRef || '').trim();
    const owner = String(addedBy || '').trim();
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);

    if (!workspaceId || !ref) {
        showToast('文件不存在');
        return;
    }

    const modal = ensureWorkspaceFilePreviewModal();
    const titleEl = modal.querySelector('#workspaceFilePreviewModalTitle');
    const metaEl = modal.querySelector('#workspaceFilePreviewMeta');
    const contentEl = modal.querySelector('#workspaceFilePreviewContent');

    modal.setAttribute('data-workspace-id', workspaceId);
    modal.setAttribute('data-file-ref', ref);
    modal.setAttribute('data-file-added-by', owner);

    if (titleEl) {
        titleEl.textContent = '文件预览';
    }

    if (metaEl) {
        metaEl.textContent = '读取中...';
    }

    if (contentEl) {
        contentEl.textContent = '';
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    handleBackdropStackingChange(modal);

    try {
        const res = await fetch(workspaceFileRequestUrl(workspaceId, 'read', ref, owner), {
            cache: 'no-store',
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error((data && data.message) || '文件读取失败');
        }

        const marker = (data && data.marker) || {};
        const file = (data && data.file) || {};
        const displayName = String(marker.title || file.original_name || file.alias || ref).trim();
        const sizeText = formatFileSize(file.size || marker.size || 0);
        const typeText = getWorkspaceFileTypeText(marker);
        const ownerText = String(data.owner_username || owner || '').trim();

        if (titleEl) {
            titleEl.textContent = displayName || '文件预览';
        }

        if (metaEl) {
            metaEl.textContent = [
                ownerText ? `@${ownerText}` : '',
                sizeText,
                typeText,
                data.truncated ? '已截断' : '',
            ].filter(Boolean).join(' · ');
        }

        if (contentEl) {
            contentEl.textContent = String(data.content || '');
        }
    } catch (error) {
        console.error('openWorkspaceDetailFile failed', error);

        if (metaEl) {
            metaEl.textContent = String((error && error.message) || '文件读取失败');
        }

        if (contentEl) {
            contentEl.textContent = '';
        }
    }
}

function closeWorkspaceFilePickerModal() {
    const modal = document.getElementById('workspaceFilePickerModal');

    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    handleBackdropStackingChange(modal);
}

function ensureWorkspaceFilePickerModal() {
    let modal = document.getElementById('workspaceFilePickerModal');

    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'workspaceFilePickerModal';
    modal.className = 'modal-backdrop workspace-file-picker-modal-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal workspace-file-picker-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceFilePickerModalTitle">
            <div class="modal-head">
                <h3 id="workspaceFilePickerModalTitle">添加文件</h3>
                <button id="workspaceFilePickerModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <div class="modal-body workspace-file-picker-modal-body">
                <div class="workspace-file-picker-search">
                    <input id="workspaceFilePickerSearchInput" class="input-modern" placeholder="搜索文件..." autocomplete="off">
                    <button id="workspaceFilePickerSearchBtn" class="workspace-file-picker-search-btn" type="button" title="搜索" aria-label="搜索">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="workspace-file-picker-list" id="workspaceFilePickerList"></div>
            </div>
            <div class="modal-footer workspace-file-picker-modal-footer">
                <button id="workspaceFilePickerCancelBtn" class="btn-cancel" type="button">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    registerModalBackdropStacking(modal);
    bindBackdropSafeClose(modal, closeWorkspaceFilePickerModal);

    modal.querySelector('#workspaceFilePickerModalCloseBtn')?.addEventListener('click', closeWorkspaceFilePickerModal);
    modal.querySelector('#workspaceFilePickerCancelBtn')?.addEventListener('click', closeWorkspaceFilePickerModal);
    modal.querySelector('#workspaceFilePickerSearchBtn')?.addEventListener('click', () => {
        const input = modal.querySelector('#workspaceFilePickerSearchInput');
        void loadWorkspaceFilePickerItems(String((input && input.value) || '').trim());
    });
    modal.querySelector('#workspaceFilePickerSearchInput')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void loadWorkspaceFilePickerItems(String(event.currentTarget.value || '').trim());
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeWorkspaceFilePickerModal();
        }
    });
    modal.querySelector('#workspaceFilePickerList')?.addEventListener('click', async (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const item = target.closest('.workspace-file-picker-item[data-file-ref]');

        if (!item || item.getAttribute('aria-disabled') === 'true') {
            return;
        }

        const workspace = workspaceProjectsState.selectedWorkspace || {};
        const workspaceId = getWorkspaceProjectId(workspace);
        const fileRef = String(item.getAttribute('data-file-ref') || '').trim();

        if (!workspaceId || !fileRef) {
            showToast('文件不存在');
            return;
        }

        item.setAttribute('aria-disabled', 'true');
        item.classList.add('is-saving');

        try {
            const nextWorkspace = await addFileToWorkspace(workspaceId, fileRef, {
                refreshList: false,
                syncSelectedWorkspace: true,
            });

            if (nextWorkspace) {
                syncWorkspaceProjectAfterDetailUpdate(nextWorkspace);
            }

            showToast('文件已加入 Workspace');
            closeWorkspaceFilePickerModal();
            renderWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
        } catch (error) {
            console.error('addWorkspaceFileFromPicker failed', error);
            item.setAttribute('aria-disabled', 'false');
            item.classList.remove('is-saving');
            showToast(String((error && error.message) || '文件归入 Workspace 失败'));
        }
    });

    return modal;
}

function renderWorkspaceFilePickerItems(files) {
    const modal = ensureWorkspaceFilePickerModal();
    const list = modal.querySelector('#workspaceFilePickerList');
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const items = Array.isArray(files) ? files : [];

    if (!list) {
        return;
    }

    if (!items.length) {
        list.innerHTML = '<div class="workspace-file-picker-empty">暂无文件</div>';
        return;
    }

    list.innerHTML = items.map((file) => {
        const fileRef = String((file && (file.sandbox_path || file.alias)) || '').trim();
        const alias = String((file && file.alias) || fileRef || '文件').trim();
        const originalName = String((file && file.original_name) || '').trim();
        const marked = workspaceHasMarkedFile(workspace, fileRef);
        const meta = [
            formatFileSize((file && file.size) || 0),
            formatWorkspaceDate((file && file.updated_at) || 0),
            originalName && originalName !== alias ? originalName : '',
        ].filter(Boolean).join(' · ');

        return `
            <button class="workspace-file-picker-item${marked ? ' is-marked' : ''}" type="button" data-file-ref="${escapeHtml(fileRef)}" aria-disabled="${marked ? 'true' : 'false'}">
                <span class="workspace-file-picker-icon">
                    <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
                </span>
                <span class="workspace-file-picker-main">
                    <span class="workspace-file-picker-title">${escapeHtml(alias)}</span>
                    <span class="workspace-file-picker-meta">${escapeHtml(meta)}</span>
                </span>
                <span class="workspace-file-picker-state">${marked ? '已加入' : '添加'}</span>
            </button>
        `;
    }).join('');
}

async function loadWorkspaceFilePickerItems(query = '') {
    const modal = ensureWorkspaceFilePickerModal();
    const list = modal.querySelector('#workspaceFilePickerList');
    const q = String(query || '').trim();

    if (list) {
        list.innerHTML = '<div class="workspace-file-picker-empty">加载中...</div>';
    }

    try {
        const url = `/api/files/list${q ? `?q=${encodeURIComponent(q)}` : ''}`;
        const res = await fetch(url, {
            cache: 'no-store',
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error((data && data.message) || '文件列表读取失败');
        }

        renderWorkspaceFilePickerItems(data.files || []);
    } catch (error) {
        console.error('loadWorkspaceFilePickerItems failed', error);

        if (list) {
            list.innerHTML = `<div class="workspace-file-picker-empty">${escapeHtml(String((error && error.message) || '文件列表读取失败'))}</div>`;
        }
    }
}

function openWorkspaceFilePickerModal() {
    const modal = ensureWorkspaceFilePickerModal();
    const input = modal.querySelector('#workspaceFilePickerSearchInput');
    const list = modal.querySelector('#workspaceFilePickerList');

    if (input) {
        input.value = '';
    }

    if (list) {
        list.innerHTML = '<div class="workspace-file-picker-empty">加载中...</div>';
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    handleBackdropStackingChange(modal);
    requestAnimationFrame(() => {
        if (input) {
            input.focus();
        }
    });
    void loadWorkspaceFilePickerItems('');
}

async function uploadWorkspaceFilesToCurrentWorkspace(fileList, inputEl = null) {
    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const files = Array.from(fileList || []).filter((file) => file);

    if (!workspaceId) {
        showToast('Workspace 不存在');
        return;
    }

    if (!files.length) {
        return;
    }

    if (isUploadingFiles) {
        showToast('已有文件上传任务，请先等待完成或中断');
        return;
    }

    isUploadingFiles = true;
    uploadCancelledByUser = false;
    updateSendButtonState();

    let addedCount = 0;

    try {
        for (let i = 0; i < files.length; i++) {
            if (uploadCancelledByUser) {
                break;
            }

            const file = files[i];

            try {
                if (isImageLikeFile(file)) {
                    showToast(`Workspace 文件暂不接收图片: ${file.name}`);
                    continue;
                }

                const data = await uploadSingleFileWithProgress(file, i, files.length);
                const sandboxPath = String((data && data.sandbox_path) || '').trim();

                if (!sandboxPath || data.type !== 'sandbox_file') {
                    throw new Error('上传结果缺少文件路径');
                }

                const nextWorkspace = await addFileToWorkspace(workspaceId, sandboxPath, {
                    refreshList: false,
                    syncSelectedWorkspace: true,
                });

                if (nextWorkspace) {
                    syncWorkspaceProjectAfterDetailUpdate(nextWorkspace);
                }

                addedCount += 1;

                if (data.vectorized === false && data.vector_message) {
                    showToast(`文件已上传，向量化失败: ${data.vector_message}`);
                }

                setFileUploadProgress({
                    visible: true,
                    stage: 'ready',
                    text: `完成 ${i + 1}/${files.length}: ${file.name}`,
                });
                await new Promise((resolve) => setTimeout(resolve, 180));
            } catch (error) {
                if (error && (error.code === 'upload_aborted' || error.code === 'upload_cancelled')) {
                    showToast('文件上传已中断');
                    break;
                }

                showToast(`上传失败: ${String((error && error.message) || '上传失败')}`);
                setFileUploadProgress({
                    visible: true,
                    stage: 'error',
                    text: `失败 ${i + 1}/${files.length}: ${file.name}`,
                });
                await new Promise((resolve) => setTimeout(resolve, 360));
            }
        }
    } finally {
        if (inputEl) {
            inputEl.value = '';
        }

        isUploadingFiles = false;
        currentUploadXhr = null;
        currentUploadTaskId = null;
        updateSendButtonState();

        if (els.filePanel && els.filePanel.classList.contains('visible')) {
            loadCloudFiles();
        }

        if (addedCount > 0) {
            showToast(`已加入 ${addedCount} 个文件`);
            renderWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
        }

        setTimeout(() => setFileUploadProgress({ visible: false }), 900);
        uploadCancelledByUser = false;
    }
}

function renderWorkspaceProjectKnowledgeRows(workspace, items) {
    const sortedItems = sortWorkspacePinnedItems(items);

    if (!sortedItems.length) {
        return '<div class="workspace-detail-empty">暂无知识库内容</div>';
    }

    return sortedItems.map((item) => {
        const rawTitle = getWorkspaceResourceText(item, '知识库文档');
        const knowledgeType = String((item && item.knowledge_type) || 'basis').trim() || 'basis';
        const title = escapeHtml(rawTitle);
        const date = escapeHtml(formatWorkspaceDate((item && item.updated_at) || (item && item.added_at) || (item && item.created_at)));
        const visibility = normalizeWorkspaceVisibility(item && item.visibility);
        const addedBy = String((item && item.added_by) || '').trim();
        const canEditVisibility = isWorkspaceResourceOwnedByCurrentUser(workspace, item);
        const pinned = isWorkspaceResourcePinned(item);
        const pinHtml = pinned ? '<i class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>' : '';

        return `
            <div class="workspace-detail-resource workspace-detail-knowledge is-clickable${pinned ? ' is-pinned' : ''}" role="button" tabindex="0" data-knowledge-title="${escapeHtml(rawTitle)}" data-knowledge-type="${escapeHtml(knowledgeType)}" data-knowledge-added-by="${escapeHtml(addedBy)}" data-workspace-pinned="${pinned ? '1' : '0'}" aria-label="打开知识库：${escapeHtml(rawTitle)}">
                <span class="workspace-detail-resource-icon">
                    <i class="fa-solid fa-database" aria-hidden="true"></i>
                </span>
                <span class="workspace-detail-resource-main">
                    <span class="workspace-detail-resource-title">${pinHtml}${title}</span>
                    <span class="workspace-detail-resource-meta">${escapeHtml(addedBy ? `@${addedBy}` : '未知用户')}</span>
                </span>
                <span class="workspace-detail-row-side">
                    <span class="workspace-detail-row-date">${date}</span>
                    ${renderWorkspaceVisibilitySwitch({
                        resourceType: 'knowledge',
                        knowledgeTitle: rawTitle,
                        knowledgeType,
                        addedBy,
                        visibility,
                        disabled: !canEditVisibility,
                    })}
                </span>
            </div>
        `;
    }).join('');
}

function renderWorkspaceProjectDetailView(workspace) {
    const host = document.getElementById('workspaceProjectDetailHost');

    if (!host || !workspace) {
        return;
    }

    restoreWorkspaceDetailInputContainer();

    const title = getWorkspaceProjectTitle(workspace);
    const workspaceId = getWorkspaceProjectId(workspace);
    const conversations = getWorkspaceProjectConversations(workspace);
    const knowledgeDocuments = getWorkspaceProjectKnowledgeDocuments(workspace);
    const files = getWorkspaceProjectFiles(workspace);
    const canShareWorkspace = isWorkspaceOwnedByCurrentUser(workspace);
    const sharedUsers = getWorkspaceSharedUsers(workspace);
    const activeTab = normalizeWorkspaceDetailTab(workspaceProjectsState.activeDetailTab);
    const shareTitle = canShareWorkspace
        ? (sharedUsers.length ? `分享 Workspace，已共享 ${sharedUsers.length} 位用户` : '分享 Workspace')
        : '只有创建者可以分享 Workspace';
    const shareDisabled = canShareWorkspace ? '' : ' disabled aria-disabled="true"';
    const deleteTitle = canShareWorkspace
        ? '删除 Workspace'
        : '只有创建者可以删除 Workspace';
    const deleteDisabled = canShareWorkspace ? '' : ' disabled aria-disabled="true"';

    host.innerHTML = `
        <div class="workspace-detail-header">
            <div class="workspace-detail-title-row">
                <span class="workspace-detail-title-icon">
                    <i class="fa-regular fa-folder" aria-hidden="true"></i>
                </span>
                <span class="workspace-detail-title-editor" data-workspace-title-editor data-workspace-id="${escapeHtml(workspaceId)}">
                    <h1 class="workspace-detail-title-text" data-workspace-title-text>${escapeHtml(title)}</h1>
                    <input class="workspace-detail-title-input" data-workspace-title-input value="${escapeHtml(title)}" aria-label="Workspace 名称" hidden>
                </span>
                <button class="workspace-detail-title-edit-btn" type="button" data-workspace-title-edit-btn title="修改 Workspace 名称" aria-label="修改 Workspace 名称">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                </button>
            </div>
            <div class="workspace-detail-actions" aria-label="Workspace 操作">
                <button class="workspace-detail-share-btn" type="button" data-workspace-share-btn title="${escapeHtml(shareTitle)}" aria-label="分享 Workspace"${shareDisabled}>
                    <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
                </button>
                <button class="workspace-detail-delete-btn" type="button" data-workspace-delete-btn title="${escapeHtml(deleteTitle)}" aria-label="删除 Workspace"${deleteDisabled}>
                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        <div class="workspace-detail-input-slot" id="workspaceDetailInputSlot"></div>

        <div class="workspace-detail-tabs" role="tablist" aria-label="Workspace 内容">
            <button class="workspace-detail-tab${activeTab === 'chat' ? ' active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'chat' ? 'true' : 'false'}" data-workspace-detail-tab="chat">
                <span>聊天</span>
            </button>
            <button class="workspace-detail-tab${activeTab === 'knowledge' ? ' active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'knowledge' ? 'true' : 'false'}" data-workspace-detail-tab="knowledge">
                <span>知识库</span>
            </button>
            <button class="workspace-detail-tab${activeTab === 'files' ? ' active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'files' ? 'true' : 'false'}" data-workspace-detail-tab="files">
                <span>文件</span>
            </button>
            <button class="workspace-detail-tab${activeTab === 'memory' ? ' active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'memory' ? 'true' : 'false'}" data-workspace-detail-tab="memory">
                <span>记忆</span>
            </button>
            <button class="workspace-detail-create-knowledge" type="button" data-workspace-create-knowledge title="新建空白知识库" aria-label="新建空白知识库"${activeTab === 'knowledge' ? '' : ' hidden'}>
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                <span>新建</span>
            </button>
            <span class="workspace-detail-file-actions" data-workspace-file-actions${activeTab === 'files' ? '' : ' hidden'}>
                <button class="workspace-detail-file-action" type="button" data-workspace-add-file title="添加已有云端文件" aria-label="添加已有云端文件">
                    <i class="fa-solid fa-link" aria-hidden="true"></i>
                    <span>添加</span>
                </button>
                <button class="workspace-detail-file-action" type="button" data-workspace-upload-file title="上传文件到 Workspace" aria-label="上传文件到 Workspace">
                    <i class="fa-solid fa-upload" aria-hidden="true"></i>
                    <span>上传</span>
                </button>
                <input type="file" data-workspace-upload-input multiple hidden>
            </span>
        </div>

        <div class="workspace-detail-panels">
            <section class="workspace-detail-panel${activeTab === 'chat' ? ' active' : ''}" data-workspace-detail-panel="chat"${activeTab === 'chat' ? '' : ' hidden'}>
                <div class="workspace-detail-panel-list workspace-detail-conversations" id="workspaceProjectConversations" data-workspace-id="${escapeHtml(workspaceId)}">
                    ${renderWorkspaceProjectConversationRows(workspace)}
                </div>
            </section>

            <section class="workspace-detail-panel${activeTab === 'knowledge' ? ' active' : ''}" data-workspace-detail-panel="knowledge"${activeTab === 'knowledge' ? '' : ' hidden'}>
                <div class="workspace-detail-panel-list" id="workspaceProjectKnowledgeDocuments">
                    ${renderWorkspaceProjectKnowledgeRows(workspace, knowledgeDocuments)}
                </div>
            </section>

            <section class="workspace-detail-panel${activeTab === 'files' ? ' active' : ''}" data-workspace-detail-panel="files"${activeTab === 'files' ? '' : ' hidden'}>
                <div class="workspace-detail-panel-list" id="workspaceProjectFiles">
                    ${renderWorkspaceProjectFileRows(workspace, files)}
                </div>
            </section>

            <section class="workspace-detail-panel${activeTab === 'memory' ? ' active' : ''}" data-workspace-detail-panel="memory"${activeTab === 'memory' ? '' : ' hidden'}>
                <div class="workspace-detail-panel-list workspace-detail-memory">
                    ${renderWorkspaceMemoryPanel(workspace)}
                </div>
            </section>
        </div>
    `;

    mountWorkspaceDetailInputContainer();
    bindWorkspaceProjectDetailView();
}

function openWorkspaceProjectDetailView(workspace) {
    hideWorkspaceResourceContextMenu();
    closeKnowledgePanel();
    closeCloudFilePanel();
    exitLearningFeedComposeMode({ clear: false });
    clearCurrentConversationSelectionForWorkspaceNavigation();

    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight || !workspace) {
        return;
    }

    ensureWorkspaceViewerBaseHeaderState(headerTitle, headerLeft, headerRight);
    captureWorkspaceDetailInputHome();
    restoreWorkspaceDetailInputContainer();
    resetComposerConversationContextUsage();
    currentViewingKnowledge = null;
    pendingHighlightData = null;
    navigationStack = [];

    msgs.style.display = 'none';

    if (els.learningMainPanel) {
        els.learningMainPanel.style.display = 'none';
    }

    const inputDock = document.querySelector('.input-dock');

    if (inputDock) {
        inputDock.style.display = 'none';
    }

    if (inputWrapper) {
        inputWrapper.style.display = 'none';
    }

    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = 'Workspace';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="openWorkspacesFrameView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <section class="workspace-detail-view" aria-label="Workspace Detail">
            <div class="workspace-detail-shell" id="workspaceProjectDetailHost"></div>
        </section>
    `;

    renderWorkspaceProjectDetailView(workspace);
    _syncTurnIndicatorVisibility();
}

function findWorkspaceConversationItem(workspace, conversationId) {
    const cid = String(conversationId || '').trim();
    const conversations = getWorkspaceProjectConversations(workspace);

    return conversations.find((item) => String((item || {}).conversation_id || '').trim() === cid) || null;
}

function findWorkspaceKnowledgeItem(workspace, title, knowledgeType = 'basis', addedBy = '') {
    const safeTitle = String(title || '').trim();
    const safeType = String(knowledgeType || 'basis').trim() || 'basis';
    const safeAddedBy = String(addedBy || '').trim();
    const documents = getWorkspaceProjectKnowledgeDocuments(workspace);

    return documents.find((item) => {
        const itemTitle = getWorkspaceResourceText(item, '');
        const itemType = String((item && item.knowledge_type) || 'basis').trim() || 'basis';
        const itemAddedBy = String((item && item.added_by) || '').trim();

        if (itemTitle !== safeTitle || itemType !== safeType) {
            return false;
        }

        if (!safeAddedBy) {
            return true;
        }

        return itemAddedBy === safeAddedBy;
    }) || null;
}

function findWorkspaceFileItem(workspace, fileRef, addedBy = '') {
    const safeFileRef = String(fileRef || '').trim();
    const safeAddedBy = String(addedBy || '').trim();
    const files = getWorkspaceProjectFiles(workspace);

    return files.find((item) => {
        const itemRef = getWorkspaceFileRef(item);
        const itemAddedBy = String((item && item.added_by) || '').trim();

        if (itemRef !== safeFileRef) {
            return false;
        }

        if (!safeAddedBy) {
            return true;
        }

        return itemAddedBy === safeAddedBy;
    }) || null;
}

function findWorkspaceVisibilityItem(toggle, workspace) {
    const resourceType = String(toggle.getAttribute('data-resource-type') || '').trim();

    if (resourceType === 'conversation') {
        return findWorkspaceConversationItem(workspace, toggle.getAttribute('data-conversation-id'));
    }

    if (resourceType === 'knowledge') {
        return findWorkspaceKnowledgeItem(
            workspace,
            toggle.getAttribute('data-knowledge-title'),
            toggle.getAttribute('data-knowledge-type') || 'basis',
            toggle.getAttribute('data-knowledge-added-by') || '',
        );
    }

    if (resourceType === 'file') {
        return findWorkspaceFileItem(
            workspace,
            toggle.getAttribute('data-file-ref'),
            toggle.getAttribute('data-file-added-by') || '',
        );
    }

    return null;
}

function refreshWorkspaceDetailRowState(toggle, workspace) {
    const resourceType = String(toggle.getAttribute('data-resource-type') || '').trim();
    const rowSelector = resourceType === 'knowledge'
        ? '.workspace-detail-knowledge'
        : (resourceType === 'file' ? '.workspace-detail-file' : '.workspace-detail-conversation');
    const row = toggle.closest(rowSelector);
    const dateEl = row ? row.querySelector('.workspace-detail-row-date') : null;
    const item = findWorkspaceVisibilityItem(toggle, workspace);

    if (!item) {
        return;
    }

    setWorkspaceVisibilitySwitchState(
        toggle,
        item.visibility,
        !isWorkspaceResourceOwnedByCurrentUser(workspace, item),
    );

    if (dateEl) {
        dateEl.textContent = formatWorkspaceDate(item.updated_at || item.added_at || item.created_at);
    }
}

async function toggleWorkspaceResourceVisibility(toggle) {
    if (!toggle || toggle.disabled) {
        return;
    }

    const workspace = workspaceProjectsState.selectedWorkspace || {};
    const workspaceId = getWorkspaceProjectId(workspace);
    const resourceType = String(toggle.getAttribute('data-resource-type') || '').trim();
    const currentVisibility = normalizeWorkspaceVisibility(toggle.getAttribute('data-visibility'));
    const nextVisibility = currentVisibility === 'share' ? 'private' : 'share';

    toggle.disabled = true;
    toggle.classList.add('is-saving');

    try {
        let updatedWorkspace = null;

        if (resourceType === 'conversation') {
            updatedWorkspace = await updateWorkspaceConversationVisibility(
                workspaceId,
                toggle.getAttribute('data-conversation-id'),
                nextVisibility,
            );
        }

        if (resourceType === 'knowledge') {
            updatedWorkspace = await updateWorkspaceKnowledgeVisibility(
                workspaceId,
                toggle.getAttribute('data-knowledge-title'),
                nextVisibility,
                toggle.getAttribute('data-knowledge-type') || 'basis',
            );
        }

        if (resourceType === 'file') {
            updatedWorkspace = await updateWorkspaceFileVisibility(
                workspaceId,
                toggle.getAttribute('data-file-ref'),
                nextVisibility,
            );
        }

        if (!updatedWorkspace) {
            throw new Error('Workspace 共享状态保存失败');
        }

        refreshWorkspaceDetailRowState(toggle, updatedWorkspace);
        showToast(`已标记为 ${getWorkspaceVisibilityLabel(nextVisibility)}`);
    } catch (error) {
        console.error('toggleWorkspaceResourceVisibility failed', error);
        const latestWorkspace = workspaceProjectsState.selectedWorkspace || {};
        const latestItem = findWorkspaceVisibilityItem(toggle, latestWorkspace);
        setWorkspaceVisibilitySwitchState(
            toggle,
            currentVisibility,
            !latestItem || !isWorkspaceResourceOwnedByCurrentUser(latestWorkspace, latestItem),
        );
        showToast(String((error && error.message) || '共享状态保存失败'));
    } finally {
        toggle.classList.remove('is-saving');
        const latestWorkspace = workspaceProjectsState.selectedWorkspace || {};
        const latestItem = findWorkspaceVisibilityItem(toggle, latestWorkspace);

        if (latestItem && isWorkspaceResourceOwnedByCurrentUser(latestWorkspace, latestItem)) {
            toggle.disabled = false;
            toggle.removeAttribute('aria-disabled');
        }
    }
}

function isWorkspaceDetailActivationKey(event) {
    return event.key === 'Enter' || event.key === ' ';
}

function bindWorkspaceDetailRowList(list, rowSelector, openRow) {
    if (!list || typeof openRow !== 'function') {
        return;
    }

    list.addEventListener('click', (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const toggle = target.closest('[data-workspace-visibility-toggle]');

        if (toggle) {
            event.preventDefault();
            event.stopPropagation();
            void toggleWorkspaceResourceVisibility(toggle);
            return;
        }

        const item = target.closest(rowSelector);

        if (!item || !list.contains(item)) {
            return;
        }

        openRow(item);
    });

    list.addEventListener('keydown', (event) => {
        if (!isWorkspaceDetailActivationKey(event)) {
            return;
        }

        const target = event.target;

        if (!(target instanceof Element) || target.closest('[data-workspace-visibility-toggle]')) {
            return;
        }

        const item = target.closest(rowSelector);

        if (!item || !list.contains(item)) {
            return;
        }

        event.preventDefault();
        openRow(item);
    });
}

function bindWorkspaceProjectTitleEditor() {
    const editor = document.querySelector('[data-workspace-title-editor]');
    const editBtn = document.querySelector('[data-workspace-title-edit-btn]');

    if (!editor || !editBtn) {
        return;
    }

    const textEl = editor.querySelector('[data-workspace-title-text]');
    const input = editor.querySelector('[data-workspace-title-input]');
    const workspaceId = String(editor.getAttribute('data-workspace-id') || '').trim();

    if (!textEl || !input || !workspaceId) {
        return;
    }

    let originalTitle = String(textEl.textContent || '').trim();
    let saving = false;

    const exitEditMode = (title) => {
        const nextTitle = String(title || '').trim();
        textEl.textContent = nextTitle;
        input.value = nextTitle;
        input.hidden = true;
        input.disabled = false;
        textEl.hidden = false;
        editBtn.hidden = false;
        editBtn.disabled = false;
        editor.classList.remove('is-editing');
        editor.classList.remove('is-saving');
    };

    const enterEditMode = () => {
        if (saving) {
            return;
        }

        originalTitle = String(textEl.textContent || '').trim();
        input.value = originalTitle;
        textEl.hidden = true;
        input.hidden = false;
        editBtn.hidden = true;
        editor.classList.add('is-editing');
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    };

    const commitEdit = async (options = {}) => {
        if (saving || !editor.classList.contains('is-editing')) {
            return;
        }

        if (options.revert === true) {
            exitEditMode(originalTitle);
            return;
        }

        const nextTitle = String(input.value || '').trim();

        if (!nextTitle) {
            exitEditMode(originalTitle);
            showToast('Workspace 名称不能为空');
            return;
        }

        if (nextTitle === originalTitle) {
            exitEditMode(originalTitle);
            return;
        }

        saving = true;
        input.disabled = true;
        editBtn.disabled = true;
        editor.classList.add('is-saving');

        try {
            const workspace = await updateWorkspaceProjectTitle(workspaceId, nextTitle);
            const savedTitle = getWorkspaceProjectTitle(workspace || { title: nextTitle });
            exitEditMode(savedTitle);
            showToast('Workspace 名称已保存');
        } catch (error) {
            console.error('updateWorkspaceProjectTitle failed', error);
            exitEditMode(originalTitle);
            showToast(String((error && error.message) || 'Workspace 名称保存失败'));
        } finally {
            saving = false;
        }
    };

    editBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        enterEditMode();
    });

    input.addEventListener('blur', () => {
        void commitEdit();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            void commitEdit({ revert: true });
        }
    });
}

function bindWorkspaceProjectDetailView() {
    const tabs = Array.from(document.querySelectorAll('.workspace-detail-tab[data-workspace-detail-tab]'));
    const panels = Array.from(document.querySelectorAll('.workspace-detail-panel[data-workspace-detail-panel]'));
    const conversationList = document.getElementById('workspaceProjectConversations');
    const knowledgeList = document.getElementById('workspaceProjectKnowledgeDocuments');
    const fileList = document.getElementById('workspaceProjectFiles');
    const shareBtn = document.querySelector('[data-workspace-share-btn]');
    const deleteBtn = document.querySelector('[data-workspace-delete-btn]');
    const createKnowledgeBtn = document.querySelector('[data-workspace-create-knowledge]');
    const fileActions = document.querySelector('[data-workspace-file-actions]');
    const addFileBtn = document.querySelector('[data-workspace-add-file]');
    const uploadFileBtn = document.querySelector('[data-workspace-upload-file]');
    const uploadFileInput = document.querySelector('[data-workspace-upload-input]');

    bindWorkspaceProjectTitleEditor();

    const syncWorkspaceDetailActionButtons = (activeDetailTab) => {
        const tabName = normalizeWorkspaceDetailTab(activeDetailTab);

        if (createKnowledgeBtn) {
            createKnowledgeBtn.hidden = tabName !== 'knowledge';
        }

        if (fileActions) {
            fileActions.hidden = tabName !== 'files';
        }
    };

    syncWorkspaceDetailActionButtons(workspaceProjectsState.activeDetailTab);

    if (shareBtn) {
        shareBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openWorkspaceShareModal();
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (deleteBtn.disabled) {
                return;
            }

            void confirmDeleteSelectedWorkspaceProject();
        });
    }

    if (createKnowledgeBtn) {
        createKnowledgeBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (createKnowledgeBtn.disabled) {
                return;
            }

            const workspace = workspaceProjectsState.selectedWorkspace || {};
            const workspaceId = getWorkspaceProjectId(workspace);

            if (!workspaceId) {
                showToast('Workspace 不存在');
                return;
            }

            const titlePrefix = await openBlankKnowledgeTitleModal({
                modalTitle: '新建 Workspace 知识库',
            });

            if (!titlePrefix) {
                return;
            }

            createKnowledgeBtn.disabled = true;
            createKnowledgeBtn.classList.add('is-loading');

            try {
                const result = await createBlankKnowledgeInWorkspace(workspaceId, titlePrefix);

                if (!result.title) {
                    throw new Error('空白知识库标题为空');
                }

                showToast('空白知识库已创建');
                renderWorkspaceProjectDetailView(workspaceProjectsState.selectedWorkspace);
                await openWorkspaceDetailKnowledge(result.title, 'basis', currentUsername);
            } catch (error) {
                console.error('createBlankKnowledgeInWorkspace failed', error);
                showToast(String((error && error.message) || '空白知识库创建失败'));
            } finally {
                createKnowledgeBtn.disabled = false;
                createKnowledgeBtn.classList.remove('is-loading');
            }
        });
    }

    if (addFileBtn) {
        addFileBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openWorkspaceFilePickerModal();
        });
    }

    if (uploadFileBtn && uploadFileInput) {
        uploadFileBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            uploadFileInput.click();
        });
        uploadFileInput.addEventListener('change', () => {
            void uploadWorkspaceFilesToCurrentWorkspace(uploadFileInput.files, uploadFileInput);
        });
    }

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const targetName = String(tab.getAttribute('data-workspace-detail-tab') || '').trim();
            const activeDetailTab = normalizeWorkspaceDetailTab(targetName);
            workspaceProjectsState.activeDetailTab = activeDetailTab;

            tabs.forEach((item) => {
                const active = item === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            panels.forEach((panel) => {
                const active = String(panel.getAttribute('data-workspace-detail-panel') || '').trim() === activeDetailTab;
                panel.hidden = !active;
                panel.classList.toggle('active', active);
            });

            syncWorkspaceDetailActionButtons(activeDetailTab);
        });
    });

    bindWorkspaceDetailRowList(
        conversationList,
        '.workspace-detail-conversation.is-clickable[data-conversation-id]',
        (item) => {
            void openWorkspaceDetailConversation(
                item.getAttribute('data-conversation-id'),
                item.getAttribute('data-conversation-added-by'),
            );
        },
    );
    bindWorkspaceResourceContextMenu(
        conversationList,
        '.workspace-detail-conversation[data-conversation-id]',
        (item) => ({
            resourceType: 'conversation',
            conversationId: String(item.getAttribute('data-conversation-id') || '').trim(),
            pinned: String(item.getAttribute('data-workspace-pinned') || '') === '1',
        }),
    );

    bindWorkspaceDetailRowList(
        knowledgeList,
        '.workspace-detail-knowledge.is-clickable[data-knowledge-title]',
        (item) => {
            const title = String(item.getAttribute('data-knowledge-title') || '').trim();
            const knowledgeType = String(item.getAttribute('data-knowledge-type') || 'basis').trim() || 'basis';
            const addedBy = String(item.getAttribute('data-knowledge-added-by') || '').trim();

            if (title) {
                void openWorkspaceDetailKnowledge(title, knowledgeType, addedBy);
            }
        },
    );
    bindWorkspaceResourceContextMenu(
        knowledgeList,
        '.workspace-detail-knowledge[data-knowledge-title]',
        (item) => ({
            resourceType: 'knowledge',
            title: String(item.getAttribute('data-knowledge-title') || '').trim(),
            knowledgeType: String(item.getAttribute('data-knowledge-type') || 'basis').trim() || 'basis',
            addedBy: String(item.getAttribute('data-knowledge-added-by') || '').trim(),
            pinned: String(item.getAttribute('data-workspace-pinned') || '') === '1',
        }),
    );

    bindWorkspaceDetailRowList(
        fileList,
        '.workspace-detail-file.is-clickable[data-file-ref]',
        (item) => {
            const fileRef = String(item.getAttribute('data-file-ref') || '').trim();
            const addedBy = String(item.getAttribute('data-file-added-by') || '').trim();

            if (fileRef) {
                void openWorkspaceDetailFile(fileRef, addedBy);
            }
        },
    );
    bindWorkspaceResourceContextMenu(
        fileList,
        '.workspace-detail-file[data-file-ref]',
        (item) => ({
            resourceType: 'file',
            fileRef: String(item.getAttribute('data-file-ref') || '').trim(),
            addedBy: String(item.getAttribute('data-file-added-by') || '').trim(),
            pinned: String(item.getAttribute('data-workspace-pinned') || '') === '1',
        }),
    );
}

function bindWorkspaceProjectsView() {
    const search = document.getElementById('workspaceProjectsSearch');
    const createBtn = document.getElementById('workspaceProjectsCreateBtn');
    const tabs = Array.from(document.querySelectorAll('.workspace-projects-tab[data-filter]'));
    const list = document.getElementById('workspaceProjectsList');

    if (search) {
        search.addEventListener('input', () => {
            workspaceProjectsState.query = search.value;
            renderWorkspaceProjectsList();
        });
    }

    if (createBtn) {
        createBtn.addEventListener('click', () => {
            openWorkspaceCreateModal();
        });
    }

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            workspaceProjectsState.filter = String(tab.getAttribute('data-filter') || 'all');
            tabs.forEach((item) => {
                const active = item === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            renderWorkspaceProjectsList();
        });
    });

    if (list) {
        list.addEventListener('click', (event) => {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const item = target.closest('.workspace-projects-item[data-workspace-id]');

            if (!item) {
                return;
            }

            void selectWorkspaceProject(item.getAttribute('data-workspace-id'));
        });
    }
}

window.openWorkspacesFrameView = function() {
    closeKnowledgePanel();
    closeCloudFilePanel();
    exitLearningFeedComposeMode({ clear: false });
    clearCurrentConversationSelectionForWorkspaceNavigation();
    captureWorkspaceDetailInputHome();
    restoreWorkspaceDetailInputContainer();

    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight) return;

    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }

    currentViewingKnowledge = null;
    pendingHighlightData = null;
    navigationStack = [];

    msgs.style.display = 'none';

    if (els.learningMainPanel) {
        els.learningMainPanel.style.display = 'none';
    }

    const inputDock = document.querySelector('.input-dock');

    if (inputDock) {
        inputDock.style.display = 'none';
    }

    if (inputWrapper) {
        inputWrapper.style.display = 'none';
    }

    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = 'Workspaces';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <section class="workspace-projects-view" aria-label="Workspaces">
            <div class="workspace-projects-shell">
                <div class="workspace-projects-head">
                    <h1>Workspaces</h1>
                    <div class="workspace-projects-actions">
                        <label class="workspace-projects-search">
                            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                            <input id="workspaceProjectsSearch" type="search" placeholder="搜索 Workspaces" aria-label="搜索 Workspaces">
                        </label>
                        <button class="workspace-projects-create" id="workspaceProjectsCreateBtn" type="button">新建</button>
                    </div>
                </div>

                <div class="workspace-projects-tabs" role="tablist" aria-label="Workspaces 筛选">
                    <button class="workspace-projects-tab active" type="button" role="tab" aria-selected="true" data-filter="all">全部</button>
                    <button class="workspace-projects-tab" type="button" role="tab" aria-selected="false" data-filter="owned">由你创建</button>
                    <button class="workspace-projects-tab" type="button" role="tab" aria-selected="false" data-filter="shared">与你共享</button>
                </div>

                <div class="workspace-projects-table" role="table" aria-label="Workspaces 列表">
                    <div class="workspace-projects-row workspace-projects-row-head" role="row">
                        <div role="columnheader">名称</div>
                        <div role="columnheader">修改时间</div>
                    </div>

                    <div id="workspaceProjectsList"></div>
                </div>
            </div>
        </section>
    `;

    workspaceProjectsState = {
        items: [],
        filter: 'all',
        query: '',
        selectedWorkspace: null,
        activeDetailTab: 'chat',
    };
    bindWorkspaceProjectsView();
    void loadWorkspaceProjects();
    _syncTurnIndicatorVisibility();
};
