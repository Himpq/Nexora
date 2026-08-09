(function () {
    'use strict';

    const MODULE_NAME = 'mails';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Mails 模块');
        }

        return shared;
    }

    let adminUsersRuntime = null;
    let mailUiRuntime = null;

    function requireRuntimeFunctions(controller, required, label) {
        if (!controller || typeof controller !== 'object') {
            throw new Error(`${label} 缺少运行态 controller`);
        }

        for (const key of required) {

            if (typeof controller[key] !== 'function') {
                throw new Error(`${label} 运行态 controller 缺少函数: ${key}`);
            }
        }
    }

    function setMailUiRuntime(controller) {
        requireRuntimeFunctions(controller, [
            'closeKnowledgePanel',
            'closeCloudFilePanel',
            'exitLearningFeedComposeMode',
            'restoreWorkspaceDetailInputContainer',
            'getOriginalHeaderState',
            'setOriginalHeaderState',
            'resetKnowledgeViewRuntimeState',
            'getElements',
            'applyDesktopHeaderTools',
            'syncTurnIndicatorVisibility',
        ], 'Chat Mails UI');

        mailUiRuntime = controller;
    }

    function getMailUiRuntime() {

        if (!mailUiRuntime) {
            throw new Error('Chat Mails 尚未绑定 UI 运行态 controller');
        }

        return mailUiRuntime;
    }

    function setAdminUsersRuntime(controller) {
        requireRuntimeFunctions(controller, [
            'ensureAdminUsersCache',
            'getUsersCache',
            'loadAdminUsersList',
        ], 'Chat Mails Admin Users');

        adminUsersRuntime = controller;
    }

    function getAdminUsersRuntime() {

        if (!adminUsersRuntime) {
            throw new Error('Chat Mails 尚未绑定 Admin Users 运行态 controller');
        }

        return adminUsersRuntime;
    }

let adminMailUsersCache = [];
let adminSelectedMailUser = null;
let adminMailUserFilterKeyword = '';
let adminMailGroup = 'default';

let mailViewState = {
    status: null,
    mails: [],
    selectedId: '',
    selectedIds: [],
    query: '',
    restorePositionOnce: false,
    mode: 'inbox',
    currentMail: null,
    folder: 'all',
    isSending: false,
    inboxTotal: 0,
    unreadTotal: 0,
    sentTotal: 0,
    inboxRequestId: 0,
    detailRequestId: 0
};
let mailEntryAvailable = false;
let mailEntryVisibilityPromise = null;
const MAIL_SELECTED_ID_KEY = 'nexora_mail_selected_id';
const MAIL_LIST_SCROLL_KEY = 'nexora_mail_list_scroll';
const MAIL_LAST_OPEN_TS_KEY = 'nexora_mail_last_open_ts';

let mailRefreshInFlight = false;
let mailDeferredEventState = null;

let mailNotifyState = {
    lastOpenTs: 0,
    newCount: 0,
    initialized: false
};

function getCurrentUrlParams() {
    return new URLSearchParams(window.location.search || '');
}

function isMailViewUrl() {
    const p = getCurrentUrlParams();
    return p.get('view') === 'mail';
}

function getMailIdFromUrl() {
    const p = getCurrentUrlParams();
    return (p.get('mail_id') || '').trim();
}

function setMailViewUrl(mailId) {
    try {
        const p = getCurrentUrlParams();
        p.set('view', 'mail');
        if (mailId) p.set('mail_id', String(mailId));
        else p.delete('mail_id');
        const q = p.toString();
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', `/chat${q ? `?${q}` : ''}`);
        }
    } catch (e) {
        // ignore
    }
}

function clearMailViewUrl() {
    try {
        const p = getCurrentUrlParams();
        p.delete('view');
        p.delete('mail_id');
        const q = p.toString();
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', `/chat${q ? `?${q}` : ''}`);
        }
    } catch (e) {
        // ignore
    }
}

function isMailViewActiveInDom() {
    const viewer = document.getElementById('knowledgeViewer');
    if (!viewer) return false;
    const display = (viewer.style.display || '').toLowerCase();
    if (display === 'none') return false;
    return !!viewer.querySelector('.mail-workspace');
}

function isMailMobileLayout() {
    try {
        return window.matchMedia('(max-width: 980px)').matches;
    } catch (e) {
        return window.innerWidth <= 980;
    }
}


function setMailDetailOpen(showDetail) {
    const workspace = document.getElementById('mailWorkspace');
    if (!workspace) return;
    workspace.classList.toggle('mail-detail-open', !!showDetail);
}

function loadMailLastOpenTs() {
    try {
        const raw = Number(localStorage.getItem(MAIL_LAST_OPEN_TS_KEY) || 0);
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    } catch (e) {
        return 0;
    }
}

function saveMailLastOpenTs(ts) {
    try {
        const v = Number(ts || 0);
        localStorage.setItem(MAIL_LAST_OPEN_TS_KEY, String(Number.isFinite(v) && v > 0 ? Math.floor(v) : 0));
    } catch (e) {
        // ignore
    }
}

function getMailToggleButton() {
    return document.getElementById('toggleMailView');
}

function setMailEntryVisible(visible) {
    const shouldShow = !!visible;
    mailEntryAvailable = shouldShow;

    const btn = getMailToggleButton();
    if (!btn) return;

    btn.hidden = !shouldShow;
    btn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

    if (!shouldShow) {
        mailNotifyState.newCount = 0;
        const badge = btn.querySelector('.mail-notify-badge');
        if (badge) badge.classList.remove('visible');
        stopMailRealtimeSync();
        return;
    }

    renderMailNotifyBadge();
}

async function refreshMailEntryVisibility(options = {}) {
    const force = !!(options && options.force);
    const btn = getMailToggleButton();
    if (!btn) {
        mailEntryAvailable = false;
        return false;
    }

    if (mailEntryVisibilityPromise && !force) {
        return mailEntryVisibilityPromise;
    }

    mailEntryVisibilityPromise = (async () => {
        try {
            const res = await fetch('/api/mail/me/status', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await res.json().catch(() => ({}));
            mailViewState.status = data;

            const visible = !!(res.ok && data && data.success && data.enabled && data.linked);
            setMailEntryVisible(visible);
            return visible;
        } catch (_) {
            mailViewState.status = {
                success: false,
                enabled: false,
                linked: false,
                message: '无法获取邮件状态'
            };
            setMailEntryVisible(false);
            return false;
        } finally {
            mailEntryVisibilityPromise = null;
        }
    })();

    return mailEntryVisibilityPromise;
}

function ensureMailNotifyBadge() {
    const btn = getMailToggleButton();
    if (!btn || btn.hidden || !mailEntryAvailable) return null;
    btn.classList.add('mail-toggle-with-notify');
    let badge = btn.querySelector('.mail-notify-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mail-notify-badge';
        badge.textContent = '0';
        btn.appendChild(badge);
    }
    return badge;
}

function renderMailNotifyBadge() {
    const badge = ensureMailNotifyBadge();
    if (!badge) return;
    const count = Math.max(0, Number(mailNotifyState.newCount || 0));
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.add('visible');
    } else {
        badge.textContent = '0';
        badge.classList.remove('visible');
    }
}

function getMailMaxTimestamp(mails) {
    const arr = Array.isArray(mails) ? mails : [];
    let maxTs = 0;
    for (const m of arr) {
        const ts = Number(m && m.timestamp ? m.timestamp : 0);
        if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    return maxTs;
}

function updateMailNotifyFromMails(mails, options = {}) {
    const markChecked = !!(options && options.markChecked);
    const arr = Array.isArray(mails) ? mails : [];
    const maxTs = getMailMaxTimestamp(arr);

    if (markChecked) {
        const markTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000);
        mailNotifyState.lastOpenTs = markTs;
        mailNotifyState.initialized = true;
        mailNotifyState.newCount = 0;
        saveMailLastOpenTs(mailNotifyState.lastOpenTs);
        renderMailNotifyBadge();
        return;
    }

    if (!mailNotifyState.initialized || mailNotifyState.lastOpenTs <= 0) {
        const initTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000);
        mailNotifyState.lastOpenTs = initTs;
        mailNotifyState.initialized = true;
        mailNotifyState.newCount = 0;
        saveMailLastOpenTs(mailNotifyState.lastOpenTs);
        renderMailNotifyBadge();
        return;
    }

    const baseline = Number(mailNotifyState.lastOpenTs || 0);
    const newCount = arr.filter((m) => {
        const ts = Number(m && m.timestamp ? m.timestamp : 0);
        return Number.isFinite(ts) && ts > baseline;
    }).length;
    mailNotifyState.newCount = newCount;
    renderMailNotifyBadge();
}

async function refreshMailNotifyBadgeFromServer() {
    if (!mailEntryAvailable) return;

    try {
        const res = await fetch('/api/mail/me/inbox?cache_mode=refresh&limit=20');
        const data = await res.json();
        if (!data || !data.success) return;
        const mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        updateMailNotifyFromMails(mails, { markChecked: false });
    } catch (e) {
        // ignore refresh errors
    }
}


function createMailEventState(payload = null) {
    const state = {
        pending: false,
        inboxChanged: false,
        sentChanged: false,
        count: 0,
        latestPayload: null
    };

    if (payload) {
        appendMailEventToState(state, payload);
    }

    return state;
}

function normalizeBrowserMailEventFolder(payload) {
    const folder = String(payload && payload.folder ? payload.folder : '').trim().toLowerCase();

    if (folder === 'sent') return 'sent';
    if (folder === 'inbox') return 'inbox';

    return '';
}

function appendMailEventToState(state, payload) {
    if (!state) return;

    const eventPayload = (payload && typeof payload === 'object') ? payload : {};
    const folder = normalizeBrowserMailEventFolder(eventPayload);

    state.pending = true;
    state.count += 1;
    state.latestPayload = eventPayload;

    if (folder === 'sent') {
        state.sentChanged = true;
        return;
    }

    if (folder === 'inbox') {
        state.inboxChanged = true;
        return;
    }

    state.inboxChanged = true;
    state.sentChanged = true;
}

function mergeMailEventState(targetState, sourceState) {
    if (!targetState || !sourceState || !sourceState.pending) return;

    if (sourceState.inboxChanged) targetState.inboxChanged = true;
    if (sourceState.sentChanged) targetState.sentChanged = true;

    targetState.pending = true;
    targetState.count += Math.max(1, Number(sourceState.count || 1));
    targetState.latestPayload = sourceState.latestPayload;
}

function takeDeferredMailEventState() {
    const state = mailDeferredEventState;
    mailDeferredEventState = null;
    return state;
}

function getMailCurrentFolderKey() {
    return String(mailViewState.folder || '').trim().toLowerCase() === 'sent' ? 'sent' : 'inbox';
}

async function refreshMailByBrowserEventState(eventState) {
    const state = eventState && eventState.pending ? eventState : createMailEventState({});
    const mailViewActive = isMailViewActiveInDom();
    const currentFolder = getMailCurrentFolderKey();
    const shouldRefreshCurrentFolder = mailViewActive && (
        (currentFolder === 'inbox' && state.inboxChanged)
        || (currentFolder === 'sent' && state.sentChanged)
        || (!state.inboxChanged && !state.sentChanged)
    );

    if (shouldRefreshCurrentFolder) {
        await loadMailCurrentFolder(mailViewState.query || '', {
            silent: true,
            refreshDetail: false,
            forceNetwork: true
        });
    }

    if (state.inboxChanged && !(shouldRefreshCurrentFolder && currentFolder === 'inbox')) {
        await refreshMailNotifyBadgeFromServer();
    }
}

function flushDeferredMailEvents() {
    if (!mailDeferredEventState || document.hidden) return;

    const state = takeDeferredMailEventState();
    void handleBrowserMailChangedEvent(state);
}

async function handleBrowserMailChangedEvent(eventPayload) {
    const eventState = eventPayload && eventPayload.pending
        ? eventPayload
        : createMailEventState(eventPayload);

    if (document.hidden) {
        mergeMailEventState(
            mailDeferredEventState || (mailDeferredEventState = createMailEventState()),
            eventState
        );
        return;
    }

    if (mailRefreshInFlight) {
        mergeMailEventState(
            mailDeferredEventState || (mailDeferredEventState = createMailEventState()),
            eventState
        );
        return;
    }

    mailRefreshInFlight = true;

    try {
        await refreshMailByBrowserEventState(eventState);
    } finally {
        mailRefreshInFlight = false;
        flushDeferredMailEvents();
    }
}


function stopMailRealtimeSync() {
    mailRefreshInFlight = false;
}

function startMailRealtimeSync() {
    if (!getMailToggleButton() || !mailEntryAvailable) return;
    stopMailRealtimeSync();
    void handleBrowserMailChangedEvent({ action: 'initial_sync' });
}

function loadMailSelectedId() {
    try {
        return (localStorage.getItem(MAIL_SELECTED_ID_KEY) || '').trim();
    } catch (e) {
        return '';
    }
}

function saveMailSelectedId(id) {
    try {
        localStorage.setItem(MAIL_SELECTED_ID_KEY, String(id || ''));
    } catch (e) {
        // ignore
    }
}

function loadMailListScroll() {
    try {
        const v = Number(localStorage.getItem(MAIL_LIST_SCROLL_KEY) || 0);
        return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch (e) {
        return 0;
    }
}

function saveMailListScroll(scrollTop) {
    try {
        localStorage.setItem(MAIL_LIST_SCROLL_KEY, String(Math.max(0, Number(scrollTop || 0))));
    } catch (e) {
        // ignore
    }
}


async function openMailPlaceholderView() {
    if (!(await refreshMailEntryVisibility())) {
        clearMailViewUrl();
        return;
    }

    const runtime = getMailUiRuntime();

    runtime.closeKnowledgePanel();
    runtime.closeCloudFilePanel();
    runtime.exitLearningFeedComposeMode({ clear: false });
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight) return;

    runtime.restoreWorkspaceDetailInputContainer();

    if (!runtime.getOriginalHeaderState()) {
        runtime.setOriginalHeaderState({
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        });
    }

    runtime.resetKnowledgeViewRuntimeState();
    setMailViewUrl(getMailIdFromUrl() || '');
    if (mailViewState.folder === 'sent') {
        refreshMailNotifyBadgeFromServer();
    } else {
        updateMailNotifyFromMails(mailViewState.mails, { markChecked: true });
    }

    msgs.style.display = 'none';
    const elements = runtime.getElements();
    if (elements && elements.learningMainPanel) elements.learningMainPanel.style.display = 'none';
    const inputDock = document.querySelector('.input-dock');
    if (inputDock) inputDock.style.display = 'none';
    if (inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = '邮件';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    runtime.applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <div class="mail-workspace" id="mailWorkspace">
            <section class="mail-list-panel">
                <div class="mail-list-toolbar">
                    <div class="mail-list-toolbar-row">
                        <button class="btn-primary mail-compose-btn" type="button" title="写邮件" data-mail-action="compose">
                            <i class="fa-solid fa-pen-to-square"></i>
                            <span>写邮件</span>
                        </button>
                        <div class="mail-folder-tabs" role="tablist">
                            <button class="mail-folder-item ${mailViewState.folder === 'all' ? 'active' : ''}" type="button" id="mailFolderInboxBtn" data-mail-action="set-folder" data-mail-folder="all">
                                <i class="fa-solid fa-inbox"></i>
                                <span>收件箱</span>
                                <span class="mail-folder-badge" id="mailInboxCountBadge">0</span>
                            </button>
                            <button class="mail-folder-item ${mailViewState.folder === 'unread' ? 'active' : ''}" type="button" id="mailFolderUnreadBtn" data-mail-action="set-folder" data-mail-folder="unread">
                                <i class="fa-regular fa-envelope"></i>
                                <span>未读</span>
                                <span class="mail-folder-badge alert" id="mailUnreadCountBadge">0</span>
                            </button>
                            <button class="mail-folder-item ${mailViewState.folder === 'sent' ? 'active' : ''}" type="button" id="mailFolderSentBtn" data-mail-action="set-folder" data-mail-folder="sent">
                                <i class="fa-regular fa-paper-plane"></i>
                                <span>发件箱</span>
                                <span class="mail-folder-badge" id="mailSentCountBadge">0</span>
                            </button>
                        </div>
                        <div class="mail-list-search">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input id="mailSearchInput" type="text" placeholder="搜索邮件主题 / 发件人">
                        </div>
                    </div>
                    <div class="mail-batch-toolbar" id="mailBatchToolbar">
                        <span class="mail-batch-count" id="mailBatchCount">已选 0 封</span>
                        <button class="mail-icon-btn" type="button" title="标记已读" data-mail-action="batch-mark-read" disabled>
                            <i class="fa-regular fa-envelope-open"></i>
                        </button>
                        <button class="mail-icon-btn danger" type="button" title="删除选中" data-mail-action="batch-delete" disabled>
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div class="mail-list-body" id="mailListBody"></div>
            </section>
            <section class="mail-detail-panel">
                <div class="mail-detail-head">
                    <div class="mail-detail-head-row">
                        <div class="mail-detail-head-left">
                            <button class="mail-back-btn" type="button" title="返回邮件列表" data-mail-action="back-mobile">
                                <i class="fa-solid fa-arrow-left"></i>
                            </button>
                            <h3 id="mailDetailTitle">邮件详情</h3>
                        </div>
                        <div class="mail-icon-actions">
                            <button class="mail-icon-btn" type="button" title="刷新" data-mail-action="refresh-folder"><i class="fa-solid fa-rotate-right"></i></button>
                            <button class="mail-icon-btn" type="button" title="回复" data-mail-action="reply"><i class="fa-solid fa-reply"></i></button>
                            <button class="mail-icon-btn" type="button" title="转发" data-mail-action="forward"><i class="fa-solid fa-share"></i></button>
                            <button class="mail-icon-btn danger" type="button" title="删除" data-mail-action="delete-current"><i class="fa-regular fa-trash-can"></i></button>
                        </div>
                    </div>
                    <div class="mail-detail-meta" id="mailDetailMeta"></div>
                </div>
                <div class="mail-detail-content" id="mailDetailContent"></div>
            </section>
        </div>
    `;
    setMailDetailOpen(false);
    initMailWorkspace();
    runtime.syncTurnIndicatorVisibility();
};


function formatMailTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    const d = new Date(n * 1000);
    return d.toLocaleString();
}

function formatMailListTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    const d = new Date(n * 1000);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
    if (sameDay) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
}

function parseRawMail(raw) {
    const src = String(raw || '');
    const splitMatch = src.match(/\r?\n\r?\n/);
    let headText = '';
    let body = src;
    if (splitMatch) {
        const idx = splitMatch.index || 0;
        headText = src.slice(0, idx);
        body = src.slice(idx + splitMatch[0].length);
    }

    const headers = {};
    if (headText) {
        const lines = headText.split(/\r?\n/);
        let currentKey = '';
        for (const line of lines) {
            if (!line) continue;
            if ((line.startsWith(' ') || line.startsWith('\t')) && currentKey) {
                headers[currentKey] = `${headers[currentKey] || ''} ${line.trim()}`.trim();
                continue;
            }
            const p = line.indexOf(':');
            if (p <= 0) continue;
            const k = line.slice(0, p).trim().toLowerCase();
            const v = line.slice(p + 1).trim();
            headers[k] = v;
            currentKey = k;
        }
    }

    const ct = String(headers['content-type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html') || /<html[\s>]|<body[\s>]|<div[\s>]|<table[\s>]/i.test(body);
    body = decodeUnicodeEscapes(body);
    return { headers, body, isHtml };
}

function decodeUnicodeEscapes(text) {
    const src = String(text || '');
    const slash = String.fromCharCode(92);
    const lowerUnicodePrefix = `${slash}u`;
    const upperUnicodePrefix = `${slash}U`;
    const bytePrefix = `${slash}x`;

    if (!src || (src.indexOf(lowerUnicodePrefix) < 0 && src.indexOf(upperUnicodePrefix) < 0 && src.indexOf(bytePrefix) < 0)) return src;

    return src
        .replace(new RegExp(`${slash}${slash}U([0-9a-fA-F]{8})`, 'g'), (_, h) => {
            try {
                return String.fromCodePoint(parseInt(h, 16));
            } catch (e) {
                return `${upperUnicodePrefix}${h}`;
            }
        })
        .replace(new RegExp(`${slash}${slash}u([0-9a-fA-F]{4})`, 'g'), (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(new RegExp(`${slash}${slash}x([0-9a-fA-F]{2})`, 'g'), (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function getMailPlainTextForQuote(mail) {
    const m = mail || {};
    const text = decodeUnicodeEscapes(String(m.content_text || '')).trim();
    if (text) return text;

    const html = decodeUnicodeEscapes(String(m.content_html || '')).trim();
    if (html) return htmlToText(html);

    const raw = decodeUnicodeEscapes(String(m.content || '')).trim();
    if (raw) {
        const parsed = parseRawMail(raw);
        const body = String(parsed.body || '').trim();
        if (!body) return '';
        return parsed.isHtml ? htmlToText(body) : decodeUnicodeEscapes(body);
    }

    return decodeUnicodeEscapes(String(m.preview_text || '')).trim();
}

function getMailHtmlForForward(mail) {
    const m = mail || {};
    const html = decodeUnicodeEscapes(String(m.content_html || '')).trim();
    if (html) return html;

    const raw = decodeUnicodeEscapes(String(m.content || '')).trim();
    if (!raw) return '';
    const parsed = parseRawMail(raw);
    if (parsed.isHtml) {
        return String(parsed.body || '').trim();
    }
    return '';
}

function parseMailReadState(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

function normalizeMailItem(item) {
    const m = (item && typeof item === 'object') ? item : {};
    return {
        ...m,
        id: String(m.id || ''),
        is_read: parseMailReadState(m.is_read)
    };
}

function getVisibleMailsByFolder() {
    const all = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    if (mailViewState.folder === 'sent') {
        return all;
    }
    if (mailViewState.folder === 'unread') {
        return all.filter((m) => !parseMailReadState(m.is_read));
    }
    return all;
}

function updateMailFolderUiState() {
    const inboxBtn = document.getElementById('mailFolderInboxBtn');
    const unreadBtn = document.getElementById('mailFolderUnreadBtn');
    const sentBtn = document.getElementById('mailFolderSentBtn');
    if (inboxBtn) inboxBtn.classList.toggle('active', mailViewState.folder === 'all');
    if (unreadBtn) unreadBtn.classList.toggle('active', mailViewState.folder === 'unread');
    if (sentBtn) sentBtn.classList.toggle('active', mailViewState.folder === 'sent');
}

function updateMailItemInState(item) {
    const normalized = normalizeMailItem(item);
    const id = String(normalized.id || '');
    if (!id) return;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const idx = list.findIndex((m) => String(m.id || '') === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...normalized };
    } else {
        list.unshift(normalized);
    }
    mailViewState.mails = list;
}

function setMailReadStateLocal(mailId, isRead) {
    const id = String(mailId || '');
    if (!id) return;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const idx = list.findIndex((m) => String(m.id || '') === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], is_read: !!isRead };
        mailViewState.mails = list;
    }
    if (mailViewState.currentMail && String(mailViewState.currentMail.id || '') === id) {
        mailViewState.currentMail = { ...mailViewState.currentMail, is_read: !!isRead };
    }
}

async function markMailRead(mailId, isRead = true) {
    const id = String(mailId || '');
    if (!id) return false;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const target = list.find((m) => String(m.id || '') === id);
    const oldValue = target ? !!target.is_read : false;
    if (oldValue === !!isRead) return true;

    // optimistic update for immediate UX: unread item moves to read section on open
    setMailReadStateLocal(id, !!isRead);
    renderMailList();

    try {
        const res = await fetch(`/api/mail/me/inbox/${encodeURIComponent(id)}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: !!isRead })
        });
        const data = await res.json();
        if (!data.success) {
            setMailReadStateLocal(id, oldValue);
            renderMailList();
            return false;
        }
        if (data.mail && typeof data.mail === 'object') {
            updateMailItemInState(data.mail);
        } else {
            setMailReadStateLocal(id, !!data.is_read);
        }
        renderMailList();
        return true;
    } catch (err) {
        setMailReadStateLocal(id, oldValue);
        renderMailList();
        return false;
    }
}

function renderMailDetailEmpty(text) {
    mailViewState.mode = (mailViewState.folder === 'sent') ? 'sent' : 'inbox';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    renderMailInboxActions();
    if (titleEl) titleEl.textContent = '邮件详情';
    if (metaEl) metaEl.innerHTML = '';
    if (contentEl) {
        contentEl.innerHTML = `<div class="mail-empty-state">${escapeHtml(text || '暂无邮件')}</div>`;
    }
}

function renderMailInboxActions() {
    const actionsEl = document.querySelector('.mail-icon-actions');
    if (!actionsEl) return;
    if (mailViewState.folder === 'sent') {
        actionsEl.innerHTML = `
            <button class="mail-icon-btn" type="button" title="刷新" data-mail-action="refresh-folder"><i class="fa-solid fa-rotate-right"></i></button>
            <button class="mail-icon-btn" type="button" title="转发" data-mail-action="forward"><i class="fa-solid fa-share"></i></button>
            <button class="mail-icon-btn danger" type="button" title="删除" data-mail-action="delete-current"><i class="fa-regular fa-trash-can"></i></button>
        `;
        return;
    }
    actionsEl.innerHTML = `
        <button class="mail-icon-btn" type="button" title="刷新" data-mail-action="refresh-folder"><i class="fa-solid fa-rotate-right"></i></button>
        <button class="mail-icon-btn" type="button" title="回复" data-mail-action="reply"><i class="fa-solid fa-reply"></i></button>
        <button class="mail-icon-btn" type="button" title="转发" data-mail-action="forward"><i class="fa-solid fa-share"></i></button>
        <button class="mail-icon-btn danger" type="button" title="删除" data-mail-action="delete-current"><i class="fa-regular fa-trash-can"></i></button>
    `;
}

function renderMailComposeForm(preset = {}) {
    mailViewState.mode = 'compose';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    const actionsEl = document.querySelector('.mail-icon-actions');
    if (!contentEl) return;

    const localMail = ((mailViewState.status || {}).local_mail || {});
    const sender = (mailViewState.status || {}).sender_address || localMail.address || localMail.username || '-';
    const toValue = String(preset.recipient || '').trim();
    const subjectValue = String(preset.subject || '').trim();
    const bodyValue = String(preset.content || '');
    const isHtml = !!preset.is_html;

    if (titleEl) titleEl.textContent = '写邮件';
    if (metaEl) {
        metaEl.innerHTML = `<span><i class="fa-regular fa-user"></i> 发件人: ${escapeHtml(sender)}</span>`;
    }
    if (actionsEl) {
        actionsEl.innerHTML = `
            <button class="mail-icon-btn" type="button" title="返回邮件列表" data-mail-action="return-inbox"><i class="fa-solid fa-inbox"></i></button>
            <button class="mail-icon-btn" type="button" title="发送" data-mail-action="send-compose"><i class="fa-solid fa-paper-plane"></i></button>
        `;
    }

    contentEl.innerHTML = `
        <div class="mail-compose-form">
            <div class="form-group">
                <label>收件人</label>
                <input id="mailComposeTo" class="input-modern" type="text" placeholder="例如: user@example.com" value="${escapeHtml(toValue)}">
            </div>
            <div class="form-group">
                <label>主题</label>
                <input id="mailComposeSubject" class="input-modern" type="text" placeholder="邮件主题" value="${escapeHtml(subjectValue)}">
            </div>
            <div class="form-group">
                <label>内容</label>
                <textarea id="mailComposeContent" class="input-modern" style="min-height: 300px; resize: vertical;" placeholder="输入邮件内容...">${escapeHtml(bodyValue)}</textarea>
            </div>
            <div class="mail-compose-actions">
                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#64748b;">
                    <input id="mailComposeIsHtml" type="checkbox" ${isHtml ? 'checked' : ''}>
                    以 HTML 发送
                </label>
                <div class="mail-compose-btn-row">
                    <button class="btn-primary-outline btn-compact mail-compose-cancel-btn" type="button" data-mail-action="return-inbox">取消</button>
                    <button class="btn-primary btn-compact mail-compose-send-btn" type="button" data-mail-action="send-compose">发送</button>
                </div>
            </div>
        </div>
    `;
}

function renderMailListMessage(text) {
    const listEl = document.getElementById('mailListBody');
    if (!listEl) return;
    listEl.innerHTML = `<div class="mail-empty-state">${escapeHtml(text || '')}</div>`;
}

function renderMailList() {
    const listEl = document.getElementById('mailListBody');
    const inboxBadgeEl = document.getElementById('mailInboxCountBadge');
    const unreadBadgeEl = document.getElementById('mailUnreadCountBadge');
    const sentBadgeEl = document.getElementById('mailSentCountBadge');
    if (!listEl) return;
    const prevScrollTop = listEl.scrollTop;
    const mails = (Array.isArray(mailViewState.mails) ? mailViewState.mails : []).map(normalizeMailItem);
    if (mailViewState.folder === 'sent') {
        mailViewState.sentTotal = mails.length;
    } else {
        mailViewState.inboxTotal = mails.length;
        mailViewState.unreadTotal = mails.filter((m) => !m.is_read).length;
    }
    const inboxCount = Math.max(0, Number(mailViewState.inboxTotal || 0));
    const unreadCount = Math.max(0, Number(mailViewState.unreadTotal || 0));
    const sentCount = Math.max(0, Number(mailViewState.sentTotal || 0));
    if (inboxBadgeEl) inboxBadgeEl.textContent = inboxCount > 99 ? '99+' : String(inboxCount);
    if (unreadBadgeEl) {
        unreadBadgeEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        unreadBadgeEl.classList.toggle('muted', unreadCount === 0);
    }
    if (sentBadgeEl) sentBadgeEl.textContent = sentCount > 99 ? '99+' : String(sentCount);

    updateMailFolderUiState();

    const visibleMails = getVisibleMailsByFolder().map(normalizeMailItem);
    if (visibleMails.length === 0) {
        const emptyText = mailViewState.folder === 'unread'
            ? '暂无未读邮件'
            : (mailViewState.folder === 'sent' ? '暂无发件记录' : '暂无邮件');
        listEl.innerHTML = `<div class="mail-empty-state">${emptyText}</div>`;
        saveMailListScroll(0);
        updateMailBatchToolbar();
        return;
    }

    const renderItem = (m) => {
        const id = String(m.id || '');
        const eid = encodeURIComponent(id);
        const active = id === mailViewState.selectedId ? 'active' : '';
        const checked = mailViewState.selectedIds.includes(id) ? 'checked' : '';
        const sender = m.sender || '-';
        const recipient = m.recipient || '-';
        const roleValue = mailViewState.folder === 'sent' ? recipient : sender;
        const subject = m.subject || '(No Subject)';
        const unreadDot = (mailViewState.folder === 'sent' || m.is_read) ? '' : '<span class="mail-unread-dot" title="未读"></span>';
        return `
            <div class="mail-list-item ${active}" data-mail-action="select-mail" data-mail-eid="${eid}">
                <span class="mail-checkbox-wrap">
                    <input class="mail-checkbox" type="checkbox" data-mail-action="toggle-select" data-mail-eid="${eid}" ${checked}>
                </span>
                <span class="mail-list-sender">${escapeHtml(roleValue)}</span>
                <span class="mail-subject-row">${unreadDot}<span class="mail-subject">${escapeHtml(subject)}</span></span>
                <span class="mail-time">${escapeHtml(formatMailListTime(m.timestamp))}</span>
            </div>
        `;
    };

    listEl.innerHTML = visibleMails.map(renderItem).join('');

    updateMailBatchToolbar();

    if (mailViewState.restorePositionOnce) {
        const savedId = String(mailViewState.selectedId || '');
        const savedEid = encodeURIComponent(savedId);
        const activeEl = savedId ? listEl.querySelector(`.mail-list-item[data-mail-eid="${savedEid}"]`) : null;
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'center' });
        } else {
            listEl.scrollTop = loadMailListScroll();
        }
        mailViewState.restorePositionOnce = false;
    } else {
        listEl.scrollTop = prevScrollTop;
    }
}

async function loadMailCurrentFolder(query = '', options = {}) {
    if (mailViewState.folder === 'sent') {
        return loadMailSent(query, options);
    }
    return loadMailInbox(query, options);
}

async function loadMailInbox(query = '', options = {}) {
    const silent = !!(options && options.silent);
    const refreshDetail = !options || options.refreshDetail !== false;
    const forceNetwork = !!(options && options.forceNetwork);
    const requestId = ++mailViewState.inboxRequestId;
    const listEl = document.getElementById('mailListBody');
    if (!silent && listEl) listEl.innerHTML = `<div class="mail-empty-state">正在加载收件箱...</div>`;
    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const q = params.toString();
        const res = await fetch(`/api/mail/me/inbox${q ? `?${q}` : ''}`);
        const data = await res.json();
        if (requestId !== mailViewState.inboxRequestId) return;
        if (!data.success) {
            mailViewState.mails = [];
            mailViewState.selectedId = '';
            mailViewState.inboxTotal = 0;
            mailViewState.unreadTotal = 0;
            renderMailList();
            if (mailViewState.mode !== 'compose') {
                renderMailDetailEmpty(data.message || '收件箱加载失败');
            }
            return;
        }
        mailViewState.mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        mailViewState.inboxTotal = Number(data.total || mailViewState.mails.length || 0);
        mailViewState.unreadTotal = Number(data.unread_total || mailViewState.mails.filter((m) => !m.is_read).length || 0);
        updateMailNotifyFromMails(mailViewState.mails, { markChecked: isMailViewActiveInDom() });
        const visible = getVisibleMailsByFolder();
        if (!mailViewState.selectedId || !visible.some((m) => String(m.id || '') === mailViewState.selectedId)) {
            mailViewState.selectedId = visible[0] ? String(visible[0].id || '') : '';
        }
        saveMailSelectedId(mailViewState.selectedId);
        renderMailList();
        const openDetailAllowed = !!getMailIdFromUrl() || !!options.forceDetail;
        if (openDetailAllowed && isMailViewActiveInDom()) {
            setMailViewUrl(mailViewState.selectedId || '');
        }
        if (refreshDetail && openDetailAllowed && mailViewState.selectedId && mailViewState.mode !== 'compose') {
            await loadMailDetail(mailViewState.selectedId, { markAsRead: false });
        } else if (refreshDetail && mailViewState.mode !== 'compose') {
            setMailDetailOpen(false);
        }
    } catch (err) {
        if (requestId !== mailViewState.inboxRequestId) return;
        mailViewState.mails = [];
        mailViewState.selectedId = '';
        mailViewState.inboxTotal = 0;
        mailViewState.unreadTotal = 0;
        renderMailList();
        if (mailViewState.mode !== 'compose') {
            renderMailDetailEmpty('邮件服务连接失败');
        }
    }
}

async function loadMailSent(query = '', options = {}) {
    const silent = !!(options && options.silent);
    const refreshDetail = !options || options.refreshDetail !== false;
    const forceNetwork = !!(options && options.forceNetwork);
    const requestId = ++mailViewState.inboxRequestId;
    const listEl = document.getElementById('mailListBody');
    if (!silent && listEl) listEl.innerHTML = `<div class="mail-empty-state">正在加载发件箱...</div>`;
    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const q = params.toString();
        const res = await fetch(`/api/mail/me/sent${q ? `?${q}` : ''}`);
        const data = await res.json();
        if (requestId !== mailViewState.inboxRequestId) return;
        if (!data.success) {
            mailViewState.mails = [];
            mailViewState.selectedId = '';
            mailViewState.sentTotal = 0;
            renderMailList();
            if (mailViewState.mode !== 'compose') {
                renderMailDetailEmpty(data.message || '发件箱加载失败');
            }
            return;
        }
        mailViewState.mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        mailViewState.sentTotal = Number(data.total || mailViewState.mails.length || 0);
        const visible = getVisibleMailsByFolder();
        if (!mailViewState.selectedId || !visible.some((m) => String(m.id || '') === mailViewState.selectedId)) {
            mailViewState.selectedId = visible[0] ? String(visible[0].id || '') : '';
        }
        saveMailSelectedId(mailViewState.selectedId);
        renderMailList();
        const openDetailAllowed = !!getMailIdFromUrl() || !!options.forceDetail;
        if (openDetailAllowed && isMailViewActiveInDom()) {
            setMailViewUrl(mailViewState.selectedId || '');
        }
        if (refreshDetail && openDetailAllowed && mailViewState.selectedId && mailViewState.mode !== 'compose') {
            await loadMailDetail(mailViewState.selectedId, { markAsRead: false });
        } else if (refreshDetail && mailViewState.mode !== 'compose') {
            setMailDetailOpen(false);
        }
    } catch (err) {
        if (requestId !== mailViewState.inboxRequestId) return;
        mailViewState.mails = [];
        mailViewState.selectedId = '';
        mailViewState.sentTotal = 0;
        renderMailList();
        if (mailViewState.mode !== 'compose') {
            renderMailDetailEmpty('邮件服务连接失败');
        }
    }
}

async function loadMailDetail(mailId, options = {}) {
    if (!mailId) {
        renderMailDetailEmpty('请选择一封邮件');
        return;
    }
    const requestId = ++mailViewState.detailRequestId;
    const markAsRead = !!options.markAsRead;
    const forceNetwork = !!options.forceNetwork;
    const viewingSent = mailViewState.folder === 'sent';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    renderMailInboxActions();
    if (titleEl) titleEl.textContent = '正在加载...';
    if (metaEl) metaEl.innerHTML = '';
    if (contentEl) contentEl.innerHTML = `<div class="mail-empty-state">正在加载邮件详情...</div>`;
    try {
        const basePath = viewingSent ? '/api/mail/me/sent' : '/api/mail/me/inbox';
        const params = new URLSearchParams();
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const res = await fetch(`${basePath}/${encodeURIComponent(mailId)}?${params.toString()}`);
        const data = await res.json();
        if (requestId !== mailViewState.detailRequestId) return;
        if (mailViewState.mode === 'compose') return;
        if (!data.success || !data.mail) {
            renderMailDetailEmpty(data.message || (viewingSent ? '读取发件失败' : '读取邮件失败'));
            return;
        }
        const mail = normalizeMailItem(data.mail);
        updateMailItemInState(mail);
        mailViewState.currentMail = mail;
        mailViewState.mode = viewingSent ? 'sent' : 'inbox';
        setMailDetailOpen(true);
        const parsed = parseRawMail(mail.content || '');
        const senderLine = mail.sender || parsed.headers['from'] || '-';
        const recipientLine = mail.recipient || parsed.headers['to'] || '-';
        const dateLine = mail.date || parsed.headers['date'] || formatMailTime(mail.timestamp);
        if (titleEl) titleEl.textContent = mail.subject || parsed.headers['subject'] || '(No Subject)';
        if (metaEl) {
            if (viewingSent) {
                metaEl.innerHTML = `
                    <span><i class="fa-regular fa-paper-plane"></i> 发件人: ${escapeHtml(senderLine)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(dateLine)}</span>
                    <span><i class="fa-regular fa-envelope"></i> 收件人: ${escapeHtml(recipientLine)}</span>
                `;
            } else {
                metaEl.innerHTML = `
                    <span><i class="fa-regular fa-user"></i> ${escapeHtml(senderLine)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(dateLine)}</span>
                    <span><i class="fa-regular fa-envelope"></i> ${escapeHtml(recipientLine)}</span>
                `;
            }
        }
        if (contentEl) {
            const htmlBody = decodeUnicodeEscapes(String(mail.content_html || '').trim());
            const textBody = decodeUnicodeEscapes(String(mail.content_text || '').trim());
            const rawBody = String(parsed.body || '').trim();
            if (!htmlBody && !textBody && !rawBody) {
                contentEl.innerHTML = `<div class="mail-empty-state">邮件内容为空</div>`;
            } else if (htmlBody) {
                contentEl.innerHTML = `<iframe class="mail-html-frame" title="mail-html" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`;
                const frame = contentEl.querySelector('.mail-html-frame');
                if (frame) {
                    frame.srcdoc = rewriteHtmlDocumentLinksToNewTab(htmlBody);
                }
            } else if (textBody) {
                contentEl.innerHTML = `<pre class="mail-raw-content">${escapeHtml(textBody)}</pre>`;
            } else if (parsed.isHtml) {
                contentEl.innerHTML = `<iframe class="mail-html-frame" title="mail-html" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`;
                const frame = contentEl.querySelector('.mail-html-frame');
                if (frame) frame.srcdoc = rewriteHtmlDocumentLinksToNewTab(rawBody);
            } else {
                contentEl.innerHTML = `<pre class="mail-raw-content">${escapeHtml(rawBody)}</pre>`;
            }
        }
        if (!viewingSent && markAsRead && !mail.is_read) {
            await markMailRead(mailId, true);
        }
    } catch (err) {
        if (requestId !== mailViewState.detailRequestId) return;
        if (mailViewState.mode === 'compose') return;
        renderMailDetailEmpty(viewingSent ? '读取发件失败' : '读取邮件失败');
    }
}

async function handleMailWorkspaceAction(actionEl) {
    const action = String(actionEl && actionEl.dataset.mailAction || '').trim();

    if (action === 'toggle-select') {
        toggleMailSelect(actionEl.dataset.mailEid || '');
        return;
    }

    if (action === 'batch-mark-read') {
        await batchMarkSelectedRead();
        return;
    }

    if (action === 'batch-delete') {
        await batchDeleteSelected();
        return;
    }

    if (action === 'compose') {
        openMailComposeView();
        return;
    }

    if (action === 'set-folder') {
        await setMailFolder(actionEl.dataset.mailFolder || 'all');
        return;
    }

    if (action === 'back-mobile') {
        backToMailListMobile();
        return;
    }

    if (action === 'refresh-folder') {
        await refreshMailFolder();
        return;
    }

    if (action === 'reply') {
        openMailComposeReply();
        return;
    }

    if (action === 'forward') {
        openMailComposeForward();
        return;
    }

    if (action === 'delete-current') {
        await deleteCurrentMail();
        return;
    }

    if (action === 'return-inbox') {
        await returnToInboxView();
        return;
    }

    if (action === 'send-compose') {
        await submitMailCompose();
        return;
    }

    if (action === 'select-mail') {
        await selectMailItemById(actionEl.dataset.mailEid || '');
    }
}

function bindMailWorkspaceDelegatedEvents() {
    const workspace = document.getElementById('mailWorkspace');

    if (!workspace || workspace.dataset.mailDelegateBound === '1') {
        return;
    }

    workspace.dataset.mailDelegateBound = '1';
    workspace.addEventListener('click', (event) => {
        const actionEl = event.target && event.target.closest
            ? event.target.closest('[data-mail-action]')
            : null;

        if (!actionEl || !workspace.contains(actionEl)) {
            return;
        }

        event.preventDefault();
        void handleMailWorkspaceAction(actionEl).catch((err) => {
            console.error('[MailWorkspace] action failed', err);
        });
    });
}

async function initMailWorkspace() {
    setMailDetailOpen(false);
    mailViewState.selectedIds = [];
    mailViewState.selectedId = getMailIdFromUrl() || loadMailSelectedId() || mailViewState.selectedId || '';
    mailViewState.restorePositionOnce = true;
    bindMailWorkspaceDelegatedEvents();

    const listEl = document.getElementById('mailListBody');
    if (listEl && listEl.dataset.scrollBind !== '1') {
        listEl.dataset.scrollBind = '1';
        listEl.addEventListener('scroll', () => saveMailListScroll(listEl.scrollTop));
    }

    const searchEl = document.getElementById('mailSearchInput');
    if (searchEl) {
        searchEl.value = mailViewState.query || '';
        searchEl.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                mailViewState.query = (searchEl.value || '').trim();
                await loadMailCurrentFolder(mailViewState.query);
            }
        });
    }

    try {
        const statusRes = await fetch('/api/mail/me/status');
        const statusData = await statusRes.json();
        mailViewState.status = statusData;
        if (!statusData.success || !statusData.enabled) {
            renderMailList();
            renderMailListMessage(statusData.message || '邮件系统未启用');
            return;
        }
        if (!statusData.linked) {
            renderMailList();
            renderMailListMessage('当前用户未绑定邮箱账号，请联系管理员在设置中绑定');
            return;
        }
    } catch (err) {
        renderMailList();
        renderMailListMessage('无法获取邮件状态');
        return;
    }
    await loadMailCurrentFolder(mailViewState.query || '');
}

async function selectMailItemById(encodedMailId) {
    const mailId = decodeURIComponent(encodedMailId || '');
    if (!mailId) return;
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    mailViewState.selectedId = mailId;
    mailViewState.selectedIds = [];
    saveMailSelectedId(mailId);
    if (isMailViewActiveInDom()) {
        setMailViewUrl(mailId);
    }
    renderMailList();
    await loadMailDetail(mailId, { markAsRead: mailViewState.folder !== 'sent' });
    setMailDetailOpen(true);
}

async function refreshMailInbox() {
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    await loadMailCurrentFolder(mailViewState.query || '', { forceNetwork: true });
}

const refreshMailFolder = refreshMailInbox;

async function setMailFolder(folder) {
    const f = String(folder || '').toLowerCase();
    if (f === 'sent') mailViewState.folder = 'sent';
    else if (f === 'unread') mailViewState.folder = 'unread';
    else mailViewState.folder = 'all';
    mailViewState.selectedId = '';
    mailViewState.selectedIds = [];
    saveMailSelectedId('');
    setMailDetailOpen(false);
    if (isMailViewActiveInDom()) {
        setMailViewUrl('');
    }
    renderMailList();
    renderMailDetailEmpty(mailViewState.folder === 'sent' ? '正在加载发件箱...' : '正在加载收件箱...');
    await loadMailCurrentFolder(mailViewState.query || '');
}

function toggleMailSelect(encodedMailId) {
    const id = decodeURIComponent(encodedMailId || '');
    if (!id) return;
    const idx = mailViewState.selectedIds.indexOf(id);
    if (idx >= 0) {
        mailViewState.selectedIds.splice(idx, 1);
    } else {
        mailViewState.selectedIds.push(id);
    }
    updateMailBatchToolbar();
    renderMailList();
}

function updateMailBatchToolbar() {
    const countEl = document.getElementById('mailBatchCount');
    const count = mailViewState.selectedIds.length;
    const isSentFolder = mailViewState.folder === 'sent';
    if (countEl) countEl.textContent = `已选 ${count} 封`;
    const markBtn = document.querySelector('[data-mail-action="batch-mark-read"]');
    const deleteBtn = document.querySelector('[data-mail-action="batch-delete"]');
    if (markBtn) markBtn.disabled = count === 0 || isSentFolder;
    if (deleteBtn) deleteBtn.disabled = count === 0;
}

async function batchMarkSelectedRead() {
    const ids = Array.from(mailViewState.selectedIds || []);
    if (!ids.length) return;
    let updated = 0;
    for (const id of ids) {
        const ok = await markMailRead(id, true);
        if (ok) updated += 1;
    }
    mailViewState.selectedIds = [];
    updateMailBatchToolbar();
    renderMailList();
    showToast(updated > 0 ? `已标记 ${updated} 封为已读` : '无需标记');
}

async function batchDeleteSelected() {
    const ids = Array.from(mailViewState.selectedIds || []);
    if (!ids.length) return;
    const confirmed = await confirmModalAsync(
        '删除选中邮件',
        `确定删除选中的 ${ids.length} 封邮件吗？此操作不可撤销。`,
        'danger'
    );
    if (!confirmed) return;
    let deleted = 0;
    for (const id of ids) {
        try {
            const basePath = mailViewState.folder === 'sent' ? '/api/mail/me/sent' : '/api/mail/me/inbox';
            const res = await fetch(`${basePath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data && data.success) deleted += 1;
        } catch (err) {
            // 单封失败不中断批量
        }
    }
    mailViewState.selectedIds = [];
    mailViewState.selectedId = '';
    saveMailSelectedId('');
    updateMailBatchToolbar();
    showToast(`已删除 ${deleted} 封邮件`);
    await loadMailCurrentFolder(mailViewState.query || '');
}

async function deleteCurrentMail() {
    if (mailViewState.mode === 'compose') {
        showToast('写邮件模式下无法删除');
        return;
    }
    const id = String(mailViewState.selectedId || '');
    if (!id) {
        showToast('请选择要删除的邮件');
        return;
    }
    try {
        const basePath = mailViewState.folder === 'sent' ? '/api/mail/me/sent' : '/api/mail/me/inbox';
        const res = await fetch(`${basePath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '删除失败');
            return;
        }
        showToast(mailViewState.folder === 'sent' ? '发件记录已删除' : '邮件已删除');
        mailViewState.selectedId = '';
        saveMailSelectedId('');
        await loadMailCurrentFolder(mailViewState.query || '');
    } catch (err) {
        showToast('删除失败');
    }
}

async function returnToInboxView() {
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    mailViewState.selectedId = '';
    mailViewState.selectedIds = [];
    saveMailSelectedId('');
    setMailDetailOpen(false);
    if (isMailViewActiveInDom()) {
        setMailViewUrl('');
    }
    renderMailList();
    updateMailBatchToolbar();
}

function openMailComposeView(preset = {}) {
    setMailViewUrl('');
    setMailDetailOpen(true);
    renderMailComposeForm(preset);
}

function backToMailListMobile() {
    mailViewState.selectedId = '';
    mailViewState.selectedIds = [];
    saveMailSelectedId('');
    setMailDetailOpen(false);
    if (isMailViewActiveInDom()) {
        setMailViewUrl('');
    }
}

function openMailComposeReply() {
    const m = mailViewState.currentMail || null;
    if (!m) {
        showToast('请先选择一封邮件');
        return;
    }
    const recipient = String(m.sender || '').replace(/[<>]/g, '').trim();
    const subject = String(m.subject || '').startsWith('Re:') ? String(m.subject || '') : `Re: ${m.subject || ''}`;
    const bodyText = getMailPlainTextForQuote(m);
    const quote = bodyText ? `\n\n\n----- 原邮件 -----\n${bodyText}` : '';
    openMailComposeView({ recipient, subject, content: quote, is_html: false });
}

function openMailComposeForward() {
    const m = mailViewState.currentMail || null;
    if (!m) {
        showToast('请先选择一封邮件');
        return;
    }
    const subject = String(m.subject || '').startsWith('Fwd:') ? String(m.subject || '') : `Fwd: ${m.subject || ''}`;
    const htmlBody = getMailHtmlForForward(m);
    if (htmlBody) {
        const quoteHtml = `
<div style="margin-top: 18px; padding-top: 12px; border-top: 1px solid #dbe3ef; color: #475569; font-size: 12px;">
  ----- 转发内容 -----
</div>
${htmlBody}
        `.trim();
        openMailComposeView({ recipient: '', subject, content: quoteHtml, is_html: true });
        return;
    }

    const bodyText = getMailPlainTextForQuote(m);
    const quote = bodyText ? `\n\n\n----- 转发内容 -----\n${bodyText}` : '';
    openMailComposeView({ recipient: '', subject, content: quote, is_html: false });
}

async function submitMailCompose() {
    if (mailViewState.isSending) {
        showToast('邮件正在发送，请稍候...');
        return;
    }
    const toEl = document.getElementById('mailComposeTo');
    const subjectEl = document.getElementById('mailComposeSubject');
    const bodyEl = document.getElementById('mailComposeContent');
    const htmlEl = document.getElementById('mailComposeIsHtml');
    if (!toEl || !subjectEl || !bodyEl) return;

    const recipient = (toEl.value || '').trim();
    const subject = (subjectEl.value || '').trim();
    const content = bodyEl.value || '';
    const is_html = !!(htmlEl && htmlEl.checked);
    if (!recipient) {
        showToast('请输入收件人');
        return;
    }
    if (!content.trim()) {
        showToast('请输入邮件内容');
        return;
    }
    const payload = { recipient, subject, content, is_html };

    mailViewState.isSending = true;
    mailViewState.mode = 'inbox';
    renderMailDetailEmpty('邮件发送中，请稍候...');
    showToast('已提交发送请求');

    (async () => {
        try {
            const res = await fetch('/api/mail/me/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || '发送失败');
                return;
            }
            showToast('邮件已发送');
            if (mailViewState.folder !== 'sent') {
                mailViewState.sentTotal = Math.max(0, Number(mailViewState.sentTotal || 0) + 1);
                renderMailList();
            }
            await loadMailCurrentFolder(mailViewState.query || '');
        } catch (err) {
            showToast('发送失败');
        } finally {
            mailViewState.isSending = false;
        }
    })();
}

async function loadAdminMailGroups() {
    const groupSelect = document.getElementById('adminMailGroupSelect');
    if (!groupSelect) return;
    try {
        const res = await fetch('/api/admin/nexora-mail/groups');
        const data = await res.json();
        if (!data.success) {
            groupSelect.innerHTML = `<option value="default">default</option>`;
            groupSelect.value = 'default';
            adminMailGroup = 'default';
            return;
        }
        const groups = Array.isArray(data.groups) ? data.groups : [];
        const names = groups.map(g => String(g.group || '').trim()).filter(Boolean);
        if (!names.includes('default')) names.unshift('default');
        groupSelect.innerHTML = names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        if (!names.includes(adminMailGroup)) adminMailGroup = names[0] || 'default';
        groupSelect.value = adminMailGroup;
    } catch (err) {
        groupSelect.innerHTML = `<option value="default">default</option>`;
        groupSelect.value = 'default';
        adminMailGroup = 'default';
    }
}

async function loadAdminMailUsersList() {
    const listEl = document.getElementById('adminMailUsersList');
    if (listEl) listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">加载中...</div>';

    let data = null;

    try {
        await loadAdminMailGroups();
        const res = await fetch(`/api/admin/nexora-mail/users?group=${encodeURIComponent(adminMailGroup)}`);
        data = await res.json();
    } catch (err) {
        console.error('[NexoraMail Admin] 邮箱用户请求失败', {
            group: adminMailGroup,
            error: err,
        });
        adminMailUsersCache = [];
        adminSelectedMailUser = null;
        renderAdminMailUsersList();
        renderAdminMailDetailError('邮箱服务连接失败');
        return;
    }

    if (!data.success) {
        adminMailUsersCache = [];
        adminSelectedMailUser = null;
        renderAdminMailUsersList();
        renderAdminMailDetailError(data.message || '读取邮箱用户失败');
        return;
    }

    adminMailUsersCache = Array.isArray(data.users) ? data.users : [];

    try {
        await ensureAdminUsersCacheForBinding();

        if (!adminSelectedMailUser || !adminMailUsersCache.some(u => (u.username || '') === adminSelectedMailUser)) {
            adminSelectedMailUser = adminMailUsersCache[0] ? adminMailUsersCache[0].username : null;
        }

        renderAdminMailUsersList();
        renderAdminMailUserDetail();
    } catch (err) {
        console.error('[NexoraMail Admin] 邮箱用户渲染失败', {
            group: adminMailGroup,
            usersCount: adminMailUsersCache.length,
            selectedUser: adminSelectedMailUser,
            error: err,
        });
        renderAdminMailDetailError('邮箱用户渲染失败，请查看控制台错误');
    }
}

async function ensureAdminUsersCacheForBinding() {
    await getAdminUsersRuntime().ensureAdminUsersCache();
}

function renderAdminMailUsersList() {
    const listEl = document.getElementById('adminMailUsersList');
    if (!listEl) return;
    const kw = adminMailUserFilterKeyword;
    const filtered = adminMailUsersCache.filter((item) => {
        if (!kw) return true;
        const perms = Array.isArray(item.permissions) ? item.permissions.join(' ') : '';
        const txt = `${item.username || ''} ${item.path || ''} ${perms}`.toLowerCase();
        return txt.includes(kw);
    });
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">没有匹配的邮箱用户</div>';
        return;
    }
    listEl.innerHTML = filtered.map((item) => {
        const uname = String(item.username || '');
        const active = uname === adminSelectedMailUser ? 'active' : '';
        const safe = encodeURIComponent(uname);
        const avatar = getDefaultAvatarDataUrl(uname || 'M');
        return `
            <div class="admin-user-item ${active}" data-admin-mail-action="select-user" data-admin-mail-user="${escapeHtml(safe)}">
                <img class="admin-user-avatar" src="${avatar}" alt="avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">group: ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminMailDetailError(msg) {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    detail.innerHTML = `<div class="admin-user-detail-empty">${escapeHtml(msg || '加载失败')}</div>`;
}

function renderAdminMailCreateForm() {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    detail.innerHTML = `
        <div class="admin-user-detail-head">
            <div>
                <div class="admin-user-name" style="font-size:16px;">新建邮箱用户</div>
                <div class="admin-user-meta">当前组: ${escapeHtml(adminMailGroup)}</div>
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>邮箱用户名</label>
                <input id="adminMailCreateUsername" class="input-modern" placeholder="例如: alice">
            </div>
            <div class="form-group">
                <label>初始密码</label>
                <input id="adminMailCreatePassword" class="input-modern" type="text" placeholder="输入密码">
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>权限(可选，逗号分隔)</label>
                <input id="adminMailCreatePermissions" class="input-modern" placeholder="mailbox.read, mailbox.write">
            </div>
        </div>
        <div class="admin-user-actions">
            <button class="btn-primary-outline btn-compact" type="button" data-admin-mail-action="create-user">创建邮箱用户</button>
        </div>
    `;
}

function renderAdminMailUserDetail() {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    const selected = adminMailUsersCache.find((u) => (u.username || '') === adminSelectedMailUser);
    if (!selected) {
        detail.innerHTML = '<div class="admin-user-detail-empty">请选择左侧邮箱用户查看详情</div>';
        return;
    }
    const uname = String(selected.username || '');
    const perms = Array.isArray(selected.permissions) ? selected.permissions : [];
    const permsText = perms.length ? perms.join(', ') : '-';
    const encoded = encodeURIComponent(uname);
    const avatar = getDefaultAvatarDataUrl(uname || 'M');
    const boundNexoraUser = (getAdminUsersRuntime().getUsersCache() || []).find((u) => {
        const lm = u && typeof u === 'object' ? (u.local_mail || {}) : {};
        return (lm.username || '') === uname && (lm.group || 'default') === adminMailGroup;
    }) || null;
    const boundPairHtml = boundNexoraUser ? `
        <div class="admin-bind-pair">
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${avatar}" alt="mail-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">Mail User · ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
            <div class="admin-bind-arrow" aria-hidden="true">↔</div>
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${boundNexoraUser.avatar_url || getDefaultAvatarDataUrl(boundNexoraUser.username || boundNexoraUser.user_id || 'U')}" alt="nexora-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(boundNexoraUser.username || boundNexoraUser.user_id || '')}</div>
                    <div class="admin-user-meta">UserID: ${escapeHtml(boundNexoraUser.user_id || '')}</div>
                </div>
            </div>
        </div>
    ` : `
        <div class="admin-bind-pair" style="grid-template-columns: minmax(0, 1fr);">
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${avatar}" alt="mail-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">Mail User · ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
        </div>
    `;
    detail.innerHTML = `
        ${boundPairHtml}
        <div class="form-group" style="margin-bottom: 8px;">
            <div style="display:flex; gap:8px;">
                <input id="adminMailBindNexoraUserInput" class="input-modern" type="text" placeholder="输入 Nexora 用户ID，例如 mujica">
                <button class="btn-primary-outline btn-compact" type="button" data-admin-mail-action="bind-nexora-user" data-admin-mail-user="${escapeHtml(encoded)}">确认</button>
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>邮箱用户名</label>
                <div class="admin-info-text">${escapeHtml(uname)}</div>
            </div>
            <div class="form-group">
                <label>权限</label>
                <div class="admin-info-text">${escapeHtml(permsText)}</div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>存储路径</label>
                <div class="admin-info-text mono">${escapeHtml(selected.path || '-')}</div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>重置密码</label>
                <div style="display:flex; gap:8px;">
                    <input id="adminMailPasswordInput" class="input-modern" type="text" placeholder="输入新密码">
                    <button class="btn-primary-outline btn-compact" type="button" data-admin-mail-action="reset-password" data-admin-mail-user="${escapeHtml(encoded)}">重置</button>
                </div>
            </div>
        </div>
        <div class="admin-user-actions">
            <button class="btn-danger-small btn-compact" type="button" data-admin-mail-action="delete-user" data-admin-mail-user="${escapeHtml(encoded)}">删除邮箱用户</button>
        </div>
    `;
}

function selectAdminMailUser(encodedUser) {
    adminSelectedMailUser = decodeURIComponent(encodedUser || '');
    renderAdminMailUsersList();
    renderAdminMailUserDetail();
}

async function submitAdminMailCreateUser() {
    const unameEl = document.getElementById('adminMailCreateUsername');
    const pwdEl = document.getElementById('adminMailCreatePassword');
    const permsEl = document.getElementById('adminMailCreatePermissions');
    const username = (unameEl && unameEl.value ? unameEl.value : '').trim();
    const password = (pwdEl && pwdEl.value ? pwdEl.value : '').trim();
    const permsRaw = (permsEl && permsEl.value ? permsEl.value : '').trim();
    if (!username || !password) {
        showToast('请填写邮箱用户名和密码');
        return;
    }
    const permissions = permsRaw ? permsRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
    try {
        const res = await fetch('/api/admin/nexora-mail/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group: adminMailGroup,
                mail_username: username,
                password,
                permissions
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '创建失败');
            return;
        }
        showToast('邮箱用户创建成功');
        adminSelectedMailUser = username;
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('创建失败');
    }
}

async function adminResetMailPassword(encodedUser) {
    const username = decodeURIComponent(encodedUser || '');
    const pwdEl = document.getElementById('adminMailPasswordInput');
    const password = (pwdEl && pwdEl.value ? pwdEl.value : '').trim();
    if (!password) {
        showToast('请输入新密码');
        return;
    }
    try {
        const res = await fetch(`/api/admin/nexora-mail/groups/${encodeURIComponent(adminMailGroup)}/users/${encodeURIComponent(username)}/password`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '重置失败');
            return;
        }
        showToast('邮箱密码已重置');
        pwdEl.value = '';
    } catch (err) {
        showToast('重置失败');
    }
}

async function adminBindMailForUser(encodedUserId) {
    const userId = decodeURIComponent(encodedUserId || '');
    const input = document.getElementById('adminDetailMailUsernameInput');
    const mailUsername = (input && input.value ? input.value : '').trim();
    if (!userId || !mailUsername) {
        showToast('请输入要绑定的邮箱用户名');
        return;
    }
    try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/local-mail`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mail_username: mailUsername
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '绑定失败');
            return;
        }
        showToast('邮箱绑定成功');
        await getAdminUsersRuntime().loadAdminUsersList();
        if (document.getElementById('settings-admin-mail-tab')?.classList.contains('active')) {
            await loadAdminMailUsersList();
        }
    } catch (err) {
        showToast('绑定失败');
    }
}

async function adminBindNexoraUserForMail(encodedMailUser) {
    const mailUsername = decodeURIComponent(encodedMailUser || '');
    const input = document.getElementById('adminMailBindNexoraUserInput');
    const nexoraUserId = (input && input.value ? input.value : '').trim();
    if (!mailUsername || !nexoraUserId) {
        showToast('请输入目标 Nexora 用户ID');
        return;
    }
    try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(nexoraUserId)}/local-mail`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group: adminMailGroup,
                mail_username: mailUsername
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '绑定失败');
            return;
        }
        showToast('绑定已更新');
        await getAdminUsersRuntime().loadAdminUsersList();
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('绑定失败');
    }
}

async function adminDeleteMailUser(encodedUser) {
    const username = decodeURIComponent(encodedUser || '');
    if (!username) return;
    const ok = await confirmModalAsync('删除邮箱用户', `确认删除邮箱用户「${username}」吗？`, 'danger');
    if (!ok) return;
    try {
        const res = await fetch(`/api/admin/nexora-mail/groups/${encodeURIComponent(adminMailGroup)}/users/${encodeURIComponent(username)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '删除失败');
            return;
        }
        showToast('邮箱用户已删除');
        if (adminSelectedMailUser === username) adminSelectedMailUser = null;
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('删除失败');
    }
}

function bindAdminMailManagementEvents() {
    if (document.documentElement.dataset.adminMailEventsBound === '1') return;

    document.documentElement.dataset.adminMailEventsBound = '1';

    document.addEventListener('click', (event) => {
        const target = event.target && event.target.closest
            ? event.target.closest('[data-admin-mail-action]')
            : null;

        if (!target) return;

        const action = String(target.dataset.adminMailAction || '').trim();
        const encodedMailUser = target.dataset.adminMailUser || '';
        const encodedUserId = target.dataset.adminUserId || '';

        if (!action) return;

        event.preventDefault();

        if (action === 'select-user') {
            selectAdminMailUser(encodedMailUser);
            return;
        }

        if (action === 'create-user') {
            void submitAdminMailCreateUser();
            return;
        }

        if (action === 'bind-nexora-user') {
            void adminBindNexoraUserForMail(encodedMailUser);
            return;
        }

        if (action === 'reset-password') {
            void adminResetMailPassword(encodedMailUser);
            return;
        }

        if (action === 'delete-user') {
            void adminDeleteMailUser(encodedMailUser);
            return;
        }

        if (action === 'bind-mail-for-user') {
            void adminBindMailForUser(encodedUserId);
        }
    });
}


    function initMailUiState() {
        mailNotifyState.lastOpenTs = loadMailLastOpenTs();
        mailNotifyState.initialized = mailNotifyState.lastOpenTs > 0;
        mailNotifyState.newCount = 0;
        renderMailNotifyBadge();
    }

    function setAdminMailUserFilterKeyword(value) {
        adminMailUserFilterKeyword = String(value || '').trim().toLowerCase();
    }

    function resetAdminMailUserFilterKeyword() {
        adminMailUserFilterKeyword = '';
    }

    function setAdminMailGroup(value) {
        adminMailGroup = String(value || 'default').trim() || 'default';
    }

    function bindWindowMailGlobals() {
        window.openMailPlaceholderView = openMailPlaceholderView;
    }

    bindWindowMailGlobals();
    bindAdminMailManagementEvents();

    getShared().registerModule(MODULE_NAME, {
        state: mailViewState,
        initMailUiState,
        isMailViewUrl,
        getMailIdFromUrl,
        setMailViewUrl,
        clearMailViewUrl,
        isMailViewActiveInDom,
        isMailMobileLayout,
        setMailDetailOpen,
        loadMailLastOpenTs,
        saveMailLastOpenTs,
        getMailToggleButton,
        setMailEntryVisible,
        refreshMailEntryVisibility,
        ensureMailNotifyBadge,
        renderMailNotifyBadge,
        updateMailNotifyFromMails,
        refreshMailNotifyBadgeFromServer,
        handleBrowserMailChangedEvent,
        flushDeferredMailEvents,
        stopMailRealtimeSync,
        startMailRealtimeSync,
        loadMailSelectedId,
        saveMailSelectedId,
        loadMailListScroll,
        saveMailListScroll,
        openMailPlaceholderView,
        formatMailTime,
        normalizeMailItem,
        renderMailList,
        loadMailCurrentFolder,
        loadMailInbox,
        loadMailSent,
        loadMailDetail,
        initMailWorkspace,
        setMailUiRuntime,
        setAdminUsersRuntime,
        loadAdminMailGroups,
        loadAdminMailUsersList,
        renderAdminMailUsersList,
        renderAdminMailCreateForm,
        renderAdminMailUserDetail,
        bindAdminMailManagementEvents,
        setAdminMailUserFilterKeyword,
        resetAdminMailUserFilterKeyword,
        setAdminMailGroup,
    });
})();
