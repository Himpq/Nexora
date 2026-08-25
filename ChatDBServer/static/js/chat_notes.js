/**
 * chat_notes.js — 笔记/时间线/上下文菜单/选区提取
 *
 * 职责：笔记 CRUD + 云同步 + 笔记本管理 + 时间线面板 + 右键上下文菜单 +
 *   选区文本提取(Markdown/KaTeX) + Pin/Trash/Conversation-Rename 上下文菜单动作 +
 *   Auth fetch guard + Debug trace；从 chat.js 批量迁移。
 *
 * 对外 window 桥接清单：
 *   - toggleNotesPanel / toggleTimelinePanel / __nexoraJumpToNoteAnchor /
 *     __nexoraGetNotesSnapshotHtml / __nexoraAuthFetchGuardInstalled / fetch
 *
 * 依赖 store 子域：
 *   - store（conversation/user）
 *
 * 设计形态：函数式（状态收敛于模块内 notesState/timelineState 等对象）
 */
import { store } from './store/index.js';
import { copyTextToClipboardSafe } from './chat_workflow.js?v=20260810_chatjs_split_01';
import {
    SETTINGS_COMPANION_MODE,
    appendDebugConsoleEntry,
    authRedirectInProgress,
    bindBackdropSafeClose,
    bindFloatingPanelFront,
    bringFloatingPanelToFront,
    clearActiveStreamResumeState,
    confirmModalAsync,
    conversationListController,
    currentUsername,
    downloadCloudFile,
    els,
    ensureConversationMessageIndexLoaded,
    ensureMessageInputFocus,
    escapeHtml,
    hideNexoraCodeProject,
    highlightCode,
    isChatMobileLayout,
    knowledgeController,
    knowledgeEditorController,
    knowledgeSidebarController,
    learningSidebarDraftValue,
    loadConversation,
    loadConversations,
    loadCurrentUserIdentity,
    loadKnowledge,
    logoutRequestInFlight,
    normalizeFileReferencePath,
    notifyLearningSidebarBridge,
    openSettingsModal,
    pinContextMenuBusy,
    pinContextMenuState,
    renderMarkdownForNotes,
    renderMathInElementSyncPreferred,
    renderMathSafe,
    resizeMessageInput,
    showToast,
    trashViewState,
} from './chat.js?v=20260819_toast_unify_01';
import {
    removeInvisibleTextChars,
} from './chat_input.js?v=20260810_chatjs_split_01';


/**
 * 读取当前会话 ID（当前会话状态已迁移至 store.conversation，live-binding 于 window）。
 *
 * @returns {string} 当前会话 ID
 */
function readCurrentConversationId() {
    return String(store.conversation.get('currentId') || '');
}

const NOTE_SELECTION_PARAGRAPH_MARKER = String.fromCharCode(0xE001);
const NOTES_DEFAULT_NOTEBOOK_ID = 'nb_default';
const NOTES_SYNC_STORE_KEY = 'nc_sync_notes_data_payload';
const NOTES_SYNC_TS_KEY = 'nc_sync_notes_ts';
const NOTES_HTML_SNAPSHOT_KEY = 'nc_notes_html_snapshot';
const NOTES_HTML_TS_KEY = 'nc_notes_html_ts';
const NOTES_MOBILE_PANEL_POS_KEY = 'nexora_notes_mobile_panel_pos_v1';
const NOTES_PANEL_LAYOUT_KEY = 'nexora_notes_panel_layout_v2';
const NOTES_CLOUD_SYNC_DEBOUNCE_MS = 240;
const TIMELINE_PANEL_LAYOUT_KEY = 'nexora_timeline_panel_layout_v1';
const TIMELINE_REFRESH_INTERVAL_MS = 12000;
let notesState = {
    open: false,
    notebooks: [],
    activeNotebookId: NOTES_DEFAULT_NOTEBOOK_ID,
    items: [],
    storeUpdatedAt: 0,
    pendingSelectionText: '',
    pendingSelectionSource: null
};
let notesMobilePanelState = {
    bound: false,
    dragging: false,
    resizing: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0,
    left: null,
    top: null,
    width: null,
    height: null
};
let notesCloudSyncTimer = null;
let notesCloudSyncPendingStore = null;
let notesCloudSyncInFlight = false;
let notesMutationSeq = 0;
let timelineState = {
    open: false,
    items: [],
    loading: false,
    bound: false,
    dragging: false,
    resizing: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0,
    left: null,
    top: null,
    width: null,
    height: null
};
let timelineRefreshTimer = null;
let timelineRefreshInFlight = false;
let mobileSelectionScrollGuard = {
    tracking: false,
    startX: 0,
    startY: 0,
    locked: false,
    stabilizeStart: false,
    snapshotRange: null,
    restoreRaf: 0,
    sourceContainer: null
};
const NOTES_COMPANION_MODE = (() => {
    try {
        const p = new URLSearchParams(window.location.search || '');
        const raw = String(p.get('notes_companion') || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'yes';
    } catch (_) {
        return false;
    }
})();

function createDefaultNotebook() {
    return {
        id: NOTES_DEFAULT_NOTEBOOK_ID,
        name: '默认笔记本',
        ts: Math.floor(Date.now() / 1000)
    };
}

function createDefaultNotesStore() {
    return {
        activeNotebookId: NOTES_DEFAULT_NOTEBOOK_ID,
        notebooks: [createDefaultNotebook()],
        notes: [],
        updatedAt: 0
    };
}

function normalizeNotesStorageUserId(userId) {
    return String(userId || '').trim();
}

function getNotesStorageUserId() {
    return normalizeNotesStorageUserId(currentUsername);
}

function getNotesScopedStorageKey(baseKey, userId = getNotesStorageUserId()) {
    const uid = normalizeNotesStorageUserId(userId);
    if (!uid) return '';
    return `${baseKey}:${encodeURIComponent(uid)}`;
}

function clearUnscopedNotesTransientCache() {
    try {
        localStorage.removeItem(NOTES_SYNC_STORE_KEY);
        localStorage.removeItem(NOTES_SYNC_TS_KEY);
        localStorage.removeItem(NOTES_HTML_SNAPSHOT_KEY);
        localStorage.removeItem(NOTES_HTML_TS_KEY);
    } catch (_) {
        // ignore storage cleanup errors
    }
}

async function ensureNotesStorageUserId() {
    const existing = getNotesStorageUserId();
    if (existing) return existing;

    try {
        const identity = await loadCurrentUserIdentity();
        const userId = normalizeNotesStorageUserId(identity && identity.id);

        if (!userId) {
            return '';
        }

        return userId;
    } catch (_) {
        return '';
    }
}

function getNotesStoreUpdatedAt(store) {
    const src = (store && typeof store === 'object') ? store : {};
    const value = Number(src.updatedAt || src.storeUpdatedAt || 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function notesStoreHasUserData(store) {
    const src = (store && typeof store === 'object') ? store : {};
    const notes = Array.isArray(src.notes) ? src.notes : (Array.isArray(src.items) ? src.items : []);
    if (notes.length > 0) return true;
    const notebooks = Array.isArray(src.notebooks) ? src.notebooks : [];
    return notebooks.some((item) => {
        const notebookId = String((item && item.id) || '').trim();
        const notebookName = String((item && item.name) || '').trim();
        return notebookId !== NOTES_DEFAULT_NOTEBOOK_ID || notebookName !== '默认笔记本';
    });
}

function shouldApplyNotesStoreUpdate(currentStore, incomingStore) {
    const currentUpdatedAt = getNotesStoreUpdatedAt(currentStore);
    const incomingUpdatedAt = getNotesStoreUpdatedAt(incomingStore);
    if (incomingUpdatedAt > 0) {
        if (currentUpdatedAt > 0 && incomingUpdatedAt <= currentUpdatedAt) {
            return false;
        }
        return true;
    }
    if (currentUpdatedAt > 0) {
        return false;
    }
    const currentHasUserData = notesStoreHasUserData(currentStore);
    const incomingHasUserData = notesStoreHasUserData(incomingStore);
    if (!incomingHasUserData) return false;
    return !currentHasUserData;
}

function normalizeNotebookItem(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const id = String(src.id || '').trim() || `nb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const name = String(src.name || '').trim() || '未命名笔记本';
    const ts = Number(src.ts || Math.floor(Date.now() / 1000));
    return {
        id,
        name,
        ts: Number.isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000)
    };
}

function normalizeNoteAnchor(raw) {
    const src = (raw && typeof raw === 'object') ? raw : null;
    if (!src) return null;
    const type = String(src.type || '').trim();
    if (type === 'chat') {
        const conversationId = String(src.conversationId || '').trim();
        const messageIndexNum = Number(src.messageIndex);
        const messageIndex = Number.isFinite(messageIndexNum) ? Math.max(0, Math.floor(messageIndexNum)) : null;
        const messageRole = String(src.messageRole || '').trim();
        const snippet = String(src.snippet || '').trim().slice(0, 600);
        const plainSnippet = String(src.plainSnippet || '').trim().slice(0, 600);
        return {
            type: 'chat',
            conversationId,
            messageIndex,
            messageRole: (messageRole === 'assistant' || messageRole === 'user') ? messageRole : '',
            snippet,
            plainSnippet
        };
    }
    if (type === 'knowledge') {
        const title = String(src.title || '').trim().slice(0, 200);
        const snippet = String(src.snippet || '').trim().slice(0, 600);
        const plainSnippet = String(src.plainSnippet || '').trim().slice(0, 600);
        return {
            type: 'knowledge',
            title,
            snippet,
            plainSnippet
        };
    }
    return null;
}

function normalizeNoteItem(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const text = String(src.text || '').trim();
    if (!text) return null;
    const notebookId = String(src.notebookId || NOTES_DEFAULT_NOTEBOOK_ID).trim() || NOTES_DEFAULT_NOTEBOOK_ID;
    const ts = Number(src.ts || Math.floor(Date.now() / 1000));
    return {
        id: String(src.id || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
        notebookId,
        text,
        source: String(src.source || '聊天'),
        sourceTitle: String(src.sourceTitle || ''),
        anchor: normalizeNoteAnchor(src.anchor),
        ts: Number.isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000)
    };
}

function loadNotesStore(userId = getNotesStorageUserId()) {
    // 笔记本地缓存必须绑定账号；旧无账号缓存不再作为数据源，避免跨账号串笔记。
    const fallback = createDefaultNotesStore();
    const scopedStoreKey = getNotesScopedStorageKey(NOTES_SYNC_STORE_KEY, userId);
    if (!scopedStoreKey) return fallback;

    try {
        const syncedRaw = localStorage.getItem(scopedStoreKey);
        if (syncedRaw) {
            const syncedParsed = JSON.parse(syncedRaw);
            if (syncedParsed && typeof syncedParsed === 'object') return syncedParsed;
        }
    } catch (_) {
        // ignore
    }

    return fallback;
}

function applyNotesStoreToState(store) {
    const src = (store && typeof store === 'object') ? store : createDefaultNotesStore();
    const notebooksRaw = Array.isArray(src.notebooks) ? src.notebooks : [];
    const notesRaw = Array.isArray(src.notes) ? src.notes : [];
    const notebooks = notebooksRaw.map(normalizeNotebookItem).filter(Boolean);
    if (!notebooks.length) notebooks.push(createDefaultNotebook());
    const notebookSet = new Set(notebooks.map((n) => n.id));
    const notes = notesRaw
        .map(normalizeNoteItem)
        .filter(Boolean)
        .map((n) => {
            if (!notebookSet.has(n.notebookId)) n.notebookId = notebooks[0].id;
            return n;
        });
    let activeNotebookId = String(src.activeNotebookId || '').trim();
    if (!activeNotebookId || !notebookSet.has(activeNotebookId)) {
        activeNotebookId = notebooks[0].id;
    }

    notesState.notebooks = notebooks;
    notesState.items = notes;
    notesState.activeNotebookId = activeNotebookId;
    notesState.storeUpdatedAt = getNotesStoreUpdatedAt(src);
}

function buildNotesStorePayload() {
    return {
        activeNotebookId: String(notesState.activeNotebookId || NOTES_DEFAULT_NOTEBOOK_ID),
        notebooks: Array.isArray(notesState.notebooks) ? notesState.notebooks : [createDefaultNotebook()],
        notes: Array.isArray(notesState.items) ? notesState.items : [],
        updatedAt: Number(notesState.storeUpdatedAt || 0)
    };
}

function getNotesStoreSignature(store) {
    const src = (store && typeof store === 'object') ? store : {};
    try {
        return JSON.stringify(src);
    } catch (_) {
        return '';
    }
}

async function fetchNotesStoreFromCloud() {
    try {
        const res = await fetch('/api/notes/store');
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.success || !data.store || typeof data.store !== 'object') return null;
        return data.store;
    } catch (_) {
        return null;
    }
}

async function saveNotesStoreToCloud(store) {
    try {
        const res = await fetch('/api/notes/store', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store })
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.success || !data.store || typeof data.store !== 'object') return null;
        return data.store;
    } catch (_) {
        return null;
    }
}

async function flushNotesCloudSync() {
    if (notesCloudSyncInFlight) return;
    const payload = notesCloudSyncPendingStore || buildNotesStorePayload();
    notesCloudSyncPendingStore = null;
    notesCloudSyncInFlight = true;
    try {
        const saved = await saveNotesStoreToCloud(payload);
        if (saved) {
            applyNotesStoreToState(saved);
        }
    } finally {
        notesCloudSyncInFlight = false;
        if (notesCloudSyncPendingStore) {
            if (notesCloudSyncTimer) {
                clearTimeout(notesCloudSyncTimer);
                notesCloudSyncTimer = null;
            }
            void flushNotesCloudSync();
        }
    }
}

function hasPendingLocalNotesChanges() {
    return !!notesCloudSyncPendingStore || !!notesCloudSyncTimer || !!notesCloudSyncInFlight;
}

function saveNotesToStorage(options = {}) {
    const immediate = !!(options && options.immediate);
    const nowTs = Date.now();
    notesMutationSeq += 1;
    notesState.storeUpdatedAt = nowTs;
    notesCloudSyncPendingStore = buildNotesStorePayload();

    const notesUserId = getNotesStorageUserId();
    try {
        if (notesUserId) {
            localStorage.setItem(
                getNotesScopedStorageKey(NOTES_SYNC_STORE_KEY, notesUserId),
                JSON.stringify(notesCloudSyncPendingStore)
            );
            localStorage.setItem(getNotesScopedStorageKey(NOTES_SYNC_TS_KEY, notesUserId), String(nowTs));
            clearUnscopedNotesTransientCache();
        }
        if (notesUserId && notesSyncChannel) {
            notesSyncChannel.postMessage({
                type: 'SYNC',
                userId: notesUserId,
                payload: notesCloudSyncPendingStore
            });
        }
    } catch (_) {}
    if (notesCloudSyncTimer) {
        clearTimeout(notesCloudSyncTimer);
        notesCloudSyncTimer = null;
    }
    if (immediate) {
        void flushNotesCloudSync();
        return;
    }
    notesCloudSyncTimer = setTimeout(() => {
        notesCloudSyncTimer = null;
        void flushNotesCloudSync();
    }, NOTES_CLOUD_SYNC_DEBOUNCE_MS);
}

const notesSyncChannel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('nc_notes_sync')
    : null;

if (notesSyncChannel) {
    notesSyncChannel.onmessage = (e) => {
        const data = e && e.data ? e.data : {};
        if (data.type !== 'SYNC') return;
        if (normalizeNotesStorageUserId(data.userId) !== getNotesStorageUserId()) return;
        if (data.payload && typeof data.payload === 'object') {
            applyNotesStoreToState(data.payload);
            notesMutationSeq += 1;
            renderNotesList();
        }
    };
}

window.addEventListener('storage', (e) => {
    const notesUserId = getNotesStorageUserId();
    const scopedTsKey = getNotesScopedStorageKey(NOTES_SYNC_TS_KEY, notesUserId);
    if (scopedTsKey && e.key === scopedTsKey) {
        try {
            const raw = localStorage.getItem(getNotesScopedStorageKey(NOTES_SYNC_STORE_KEY, notesUserId));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    applyNotesStoreToState(parsed);
                    notesMutationSeq += 1;
                    renderNotesList();
                }
            }
        } catch (_) {}
    }
});

async function hydrateNotesState() {
    const notesUserId = await ensureNotesStorageUserId();
    clearUnscopedNotesTransientCache();

    const localStore = loadNotesStore(notesUserId);
    applyNotesStoreToState(localStore);
    const requestSeq = notesMutationSeq;
    const cloudStore = await fetchNotesStoreFromCloud();
    if (cloudStore) {
        if (requestSeq !== notesMutationSeq) {
            renderNotesList();
            return;
        }
        if (hasPendingLocalNotesChanges()) {
            applyNotesStoreToState(notesCloudSyncPendingStore || localStore);
            renderNotesList();
            return;
        }
        const cloudHasUserData = notesStoreHasUserData(cloudStore);
        const cloudUpdatedAt = getNotesStoreUpdatedAt(cloudStore);
        const currentUpdatedAt = getNotesStoreUpdatedAt(notesState);
        const currentHasUserData = notesStoreHasUserData(notesState);

        const localHasUserData = notesStoreHasUserData(localStore);

        if (!cloudHasUserData) {
            if (cloudUpdatedAt > 0) {
                if (currentUpdatedAt > 0 && cloudUpdatedAt <= currentUpdatedAt) {
                    renderNotesList();
                    return;
                }
                applyNotesStoreToState(cloudStore);
                renderNotesList();
                return;
            }
            if (currentHasUserData) {
                saveNotesToStorage({ immediate: true });
                renderNotesList();
                return;
            }
            if (localHasUserData) {
                applyNotesStoreToState(localStore);
                saveNotesToStorage({ immediate: true });
                renderNotesList();
                return;
            }
        }

        if (!shouldApplyNotesStoreUpdate(notesState, cloudStore)) {
            renderNotesList();
            return;
        }
        applyNotesStoreToState(cloudStore);
    } else {
        // 云端不可用时，保留当前状态并尝试回写。
        saveNotesToStorage({ immediate: true });
    }
    renderNotesList();
}

function getNotesForActiveNotebook() {
    const activeId = String(notesState.activeNotebookId || '').trim();
    const arr = Array.isArray(notesState.items) ? notesState.items : [];
    return arr.filter((n) => String(n.notebookId || '') === activeId);
}

function renderNotebookSelector() {
    const select = els.notesNotebookSelect || document.getElementById('notesNotebookSelect');
    if (!select) return;
    const notebooks = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    select.innerHTML = notebooks.map((b) => (
        `<option value="${escapeHtml(String(b.id || ''))}">${escapeHtml(String(b.name || '未命名笔记本'))}</option>`
    )).join('');
    const activeId = String(notesState.activeNotebookId || '').trim();
    if (activeId) {
        select.value = activeId;
        if (select.value !== activeId && notebooks[0]) {
            notesState.activeNotebookId = String(notebooks[0].id || '');
            select.value = notesState.activeNotebookId;
        }
    }
}

function getActiveNotebookName() {
    const id = String(notesState.activeNotebookId || '').trim();
    const arr = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    const target = arr.find((b) => String(b.id || '') === id);
    return target ? String(target.name || '未命名笔记本') : '默认笔记本';
}

function createNotebook() {
    const raw = prompt('输入新笔记本名称');
    if (raw === null) return;
    const name = String(raw || '').trim();
    if (!name) {
        showToast('笔记本名称不能为空');
        return;
    }
    const exists = (Array.isArray(notesState.notebooks) ? notesState.notebooks : [])
        .some((b) => String(b.name || '').trim() === name);
    if (exists) {
        showToast('笔记本名称已存在');
        return;
    }
    const notebook = {
        id: `nb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        name: name.slice(0, 36),
        ts: Math.floor(Date.now() / 1000)
    };
    notesState.notebooks = [notebook, ...(Array.isArray(notesState.notebooks) ? notesState.notebooks : [])];
    notesState.activeNotebookId = notebook.id;
    saveNotesToStorage();
    renderNotesList();
}

async function clearActiveNotebook() {
    const arr = getNotesForActiveNotebook();
    if (!arr.length) return;
    const ok = await confirmModalAsync('清空笔记本', `确定清空笔记本「${getActiveNotebookName()}」吗？`, 'danger');
    if (!ok) return;
    const activeId = String(notesState.activeNotebookId || '').trim();
    notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
        .filter((n) => String(n.notebookId || '') !== activeId);
    saveNotesToStorage();
    renderNotesList();
    showToast('已清空当前笔记本');
}

async function deleteActiveNotebook() {
    const notebooks = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    if (notebooks.length <= 1) {
        showToast('至少保留一个笔记本');
        return;
    }
    const activeId = String(notesState.activeNotebookId || '').trim();
    const activeName = getActiveNotebookName();
    const ok = await confirmModalAsync('删除笔记本', `确定删除笔记本「${activeName}」吗？其内笔记将一并删除。`, 'danger');
    if (!ok) return;
    notesState.notebooks = notebooks.filter((n) => String(n.id || '') !== activeId);
    notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
        .filter((n) => String(n.notebookId || '') !== activeId);
    notesState.activeNotebookId = String((notesState.notebooks[0] && notesState.notebooks[0].id) || NOTES_DEFAULT_NOTEBOOK_ID);
    saveNotesToStorage();
    renderNotesList();
    showToast('已删除笔记本');
}

function sanitizeNotebookFilename(name) {
    const n = String(name || 'notes').trim();
    return (n || 'notes').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 48) || 'notes';
}

function downloadActiveNotebook() {
    const notes = getNotesForActiveNotebook();
    const notebookName = getActiveNotebookName();
    if (!notes.length) {
        showToast('当前笔记本为空');
        return;
    }
    const header = `# ${notebookName}\n\n导出时间：${new Date().toLocaleString()}\n\n---\n`;
    const body = notes.map((n, idx) => {
        const source = `${String(n.source || '聊天')}${n.sourceTitle ? ` · ${String(n.sourceTitle)}` : ''}`;
        const time = formatNoteTime(n.ts);
        return `\n## 笔记 ${idx + 1}\n\n> 来源：${source}\n> 时间：${time}\n\n${String(n.text || '')}\n`;
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `${sanitizeNotebookFilename(notebookName)}_${ts}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('已下载当前笔记本');
}

function formatNoteTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    try {
        return new Date(n * 1000).toLocaleString();
    } catch (e) {
        return '-';
    }
}

function normalizeNoteSearchText(raw) {
    return String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeNoteSearchTextLoose(raw) {
    return normalizeNoteSearchText(String(raw || '').replace(/[*_`#[\]()>|~\-]/g, ' '));
}

function buildNoteAnchorSnippet(raw, limit = 220) {
    const n = normalizeSelectionTextForNotes(raw);
    if (!n) return '';
    return n.slice(0, Math.max(48, Math.min(1000, Number(limit) || 220)));
}

function messageElementMatchesAnchor(messageEl, anchor) {
    if (!messageEl || !anchor || typeof anchor !== 'object') return false;
    const expectedRole = String(anchor.messageRole || '').trim();
    if (expectedRole && !messageEl.classList.contains(expectedRole)) return false;

    const plainNeedle = normalizeNoteSearchText(anchor.plainSnippet || '');
    if (plainNeedle) {
        const plainHaystack = normalizeNoteSearchText(messageEl.textContent || '');
        if (plainHaystack && plainHaystack.includes(plainNeedle)) return true;
    }

    const rawNeedle = normalizeNoteSearchText(anchor.snippet || '');
    if (rawNeedle) {
        const sourceNodes = Array.from(messageEl.querySelectorAll('.content-body, .message-bubble'));
        for (const node of sourceNodes) {
            if (!node || typeof node.__sourceMarkdown !== 'string') continue;
            const rawHaystack = normalizeNoteSearchText(node.__sourceMarkdown || '');
            if (rawHaystack && rawHaystack.includes(rawNeedle)) return true;
        }
        const looseNeedle = normalizeNoteSearchTextLoose(anchor.snippet || '');
        if (looseNeedle) {
            const plainHaystackLoose = normalizeNoteSearchTextLoose(messageEl.textContent || '');
            if (plainHaystackLoose && plainHaystackLoose.includes(looseNeedle)) return true;
        }
        return false;
    }

    return true;
}

let notesJumpHighlightTimer = null;
function highlightMessageForNoteJump(messageEl) {
    if (!messageEl) return;
    try {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (_) {
        // ignore
    }
    if (notesJumpHighlightTimer) {
        clearTimeout(notesJumpHighlightTimer);
        notesJumpHighlightTimer = null;
    }
    messageEl.classList.add('note-source-highlight');
    notesJumpHighlightTimer = setTimeout(() => {
        messageEl.classList.remove('note-source-highlight');
        notesJumpHighlightTimer = null;
    }, 2200);
}

async function jumpToChatSource(anchor) {
    const targetConversationId = String((anchor && anchor.conversationId) || readCurrentConversationId()).trim();
    if (!targetConversationId) {
        showToast('来源对话不存在或已删除');
        return false;
    }

    if (String(readCurrentConversationId()).trim() !== targetConversationId) {
        await loadConversation(targetConversationId);
    }

    const idx = Number(anchor && anchor.messageIndex);
    if (Number.isFinite(idx) && idx >= 0) {
        await ensureConversationMessageIndexLoaded(idx);
    }

    const root = els.messagesContainer || document.getElementById('messagesContainer');
    if (!root) {
        showToast('来源对话不存在或已删除');
        return false;
    }
    const rows = Array.from(root.querySelectorAll('.message'));
    if (!rows.length) {
        showToast('来源对话不存在或已删除');
        return false;
    }

    let targetEl = null;
    if (Number.isFinite(idx) && idx >= 0) {
        const byIndex = root.querySelector(`.message[data-index="${Math.floor(idx)}"]`);
        if (byIndex && messageElementMatchesAnchor(byIndex, anchor)) {
            targetEl = byIndex;
        }
    }
    if (!targetEl) {
        targetEl = rows.find((row) => messageElementMatchesAnchor(row, anchor)) || null;
    }
    if (!targetEl && Number.isFinite(idx) && idx >= 0) {
        const fallbackByIndex = root.querySelector(`.message[data-index="${Math.floor(idx)}"]`);
        if (fallbackByIndex) targetEl = fallbackByIndex;
    }
    if (!targetEl) {
        showToast('来源内容已变更或找不到');
        return false;
    }

    highlightMessageForNoteJump(targetEl);
    return true;
}

function contentContainsSnippetLoose(content, snippet) {
    const hay = normalizeNoteSearchTextLoose(content || '');
    const needle = normalizeNoteSearchTextLoose(snippet || '');
    if (!needle) return true;
    return hay.includes(needle);
}

function normalizeKnowledgeTitleKey(...args) {
    return knowledgeController.normalizeKnowledgeTitleKey(...args);
}

async function fetchKnowledgeByTitle(...args) {
    return knowledgeController.fetchKnowledgeByTitle(...args);
}

async function resolveKnowledgeSourceForJump(...args) {
    return knowledgeController.resolveKnowledgeSourceForJump(...args);
}

async function jumpToKnowledgeSource(...args) {
    return knowledgeController.jumpToKnowledgeSource(...args);
}

async function jumpToNoteAnchorPayload(anchor, fallbackTitle = '') {
    const a = normalizeNoteAnchor(anchor);
    if (!a || !a.type) {
        showToast('该笔记缺少来源定位信息');
        return false;
    }
    if (a.type === 'chat') {
        return await jumpToChatSource(a);
    }
    if (a.type === 'knowledge') {
        return await jumpToKnowledgeSource(a, String(fallbackTitle || '').trim());
    }
    showToast('该笔记缺少来源定位信息');
    return false;
}

window.__nexoraJumpToNoteAnchor = async function(payload = {}) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const anchor = normalizeNoteAnchor(p.anchor) || null;
    const sourceTitle = String(p.sourceTitle || '').trim();
    return await jumpToNoteAnchorPayload(anchor, sourceTitle);
};

document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const fileDownload = target.closest('.file-reference-download');
    if (fileDownload) {
        event.preventDefault();
        event.stopPropagation();

        const fileRef = normalizeFileReferencePath(fileDownload.getAttribute('data-file-ref') || '');

        if (fileRef) {
            downloadCloudFile(fileRef);
        }

        return;
    }

    const ref = target.closest('.kb-reference');
    if (!ref) return;

    event.preventDefault();
    event.stopPropagation();

    const source = String(ref.getAttribute('data-kb-source') || '').trim();
    const snippet = String(ref.getAttribute('data-kb-snippet') || '').trim();
    if (!source) return;

    await jumpToKnowledgeSource({
        type: 'knowledge',
        title: source,
        basis_id: source,
        snippet,
        plainSnippet: snippet
    }, source);
});

function buildFallbackAnchorFromNote(note) {
    const n = (note && typeof note === 'object') ? note : {};
    const source = String(n.source || '').trim();
    const sourceTitle = String(n.sourceTitle || '').trim();
    const plainSnippet = buildNoteAnchorSnippet(String(n.text || ''), 220);
    if (source.includes('知识')) {
        return {
            type: 'knowledge',
            title: sourceTitle,
            plainSnippet,
            snippet: plainSnippet
        };
    }
    return {
        type: 'chat',
        conversationId: String(readCurrentConversationId() || '').trim(),
        messageIndex: null,
        messageRole: '',
        plainSnippet,
        snippet: plainSnippet
    };
}

let noteSourceJumpInFlight = false;
async function jumpToNoteSource(noteId) {
    if (noteSourceJumpInFlight) return;
    const id = String(noteId || '').trim();
    if (!id) return;
    const notes = Array.isArray(notesState.items) ? notesState.items : [];
    const note = notes.find((n) => String((n && n.id) || '') === id);
    if (!note) {
        showToast('笔记不存在');
        return;
    }
    const anchor = normalizeNoteAnchor(note.anchor) || buildFallbackAnchorFromNote(note);
    if (!anchor || !anchor.type) {
        showToast('该笔记缺少来源定位信息');
        return;
    }

    if (
        NOTES_COMPANION_MODE
        && getNotesCompanionApiInfo().api
        && typeof getNotesCompanionApiInfo().api.jump_note_source_external === 'function'
    ) {
        try {
            const notesApiInfo = getNotesCompanionApiInfo();
            const companionApi = notesApiInfo && notesApiInfo.api;
            const res = await companionApi.jump_note_source_external({
                anchor,
                sourceTitle: String(note.sourceTitle || '')
            });
            if (res && res.success) return;
        } catch (_) {
            // fallback to local jump
        }
    }

    noteSourceJumpInFlight = true;
    try {
        await jumpToNoteAnchorPayload(anchor, String(note.sourceTitle || ''));
    } finally {
        noteSourceJumpInFlight = false;
    }
}

function reorderNotesWithinActiveNotebook(draggedId, targetId, insertBefore = true) {
    const dragId = String(draggedId || '').trim();
    const overId = String(targetId || '').trim();
    if (!dragId || !overId || dragId === overId) return false;
    const activeId = String(notesState.activeNotebookId || '').trim();
    const all = Array.isArray(notesState.items) ? notesState.items : [];
    const active = all.filter((n) => String((n && n.notebookId) || '') === activeId);
    const others = all.filter((n) => String((n && n.notebookId) || '') !== activeId);
    if (active.length < 2) return false;

    const order = active.map((n) => String((n && n.id) || ''));
    const from = order.indexOf(dragId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0) return false;
    const nextOrder = order.slice();
    const [moved] = nextOrder.splice(from, 1);
    let insertAt = nextOrder.indexOf(overId);
    if (insertAt < 0) insertAt = nextOrder.length;
    if (!insertBefore) insertAt += 1;
    insertAt = Math.max(0, Math.min(nextOrder.length, insertAt));
    nextOrder.splice(insertAt, 0, moved);

    if (nextOrder.join('|') === order.join('|')) return false;
    const byId = new Map(active.map((n) => [String((n && n.id) || ''), n]));
    const reorderedActive = nextOrder.map((id) => byId.get(id)).filter(Boolean);
    notesState.items = [...reorderedActive, ...others];
    return true;
}

function renderNotesBadge() {
    const btn = document.getElementById('toggleNotesPanel') || els.toggleNotesPanel;
    if (btn) {
        btn.classList.remove('has-notes');
    }
}

function cacheNotesPanelSnapshot(panel) {
    const notesUserId = getNotesStorageUserId();
    if (!panel || !notesUserId) return;

    const snapshot = String(panel.outerHTML);
    localStorage.setItem(getNotesScopedStorageKey(NOTES_HTML_SNAPSHOT_KEY, notesUserId), snapshot);
    localStorage.setItem(getNotesScopedStorageKey(NOTES_HTML_TS_KEY, notesUserId), String(Date.now()));
    clearUnscopedNotesTransientCache();

    if (window.parent && window.parent !== window) {
        try {
            window.parent.postMessage({
                type: 'NC_SYNC_NOTES_HTML',
                userId: notesUserId,
                snapshot
            }, '*');
        } catch (_) {}
    }
}

function findConversationTitleById(conversationId) {
    const cid = String(conversationId || '').trim();
    if (!cid || !els.conversationList) return '';
    const rows = Array.from(els.conversationList.querySelectorAll('.conversation-item'));
    for (const row of rows) {
        if (String(row.dataset.conversationId || '').trim() !== cid) continue;
        const titleEl = row.querySelector('.title');
        const txt = titleEl ? String(titleEl.textContent || '').trim() : '';
        if (txt) return txt;
    }
    return '';
}

function resolveLiveNoteSourceTitle(note) {
    const n = (note && typeof note === 'object') ? note : {};
    const anchor = normalizeNoteAnchor(n.anchor);
    if (anchor && anchor.type === 'chat') {
        const latestTitle = findConversationTitleById(anchor.conversationId || '');
        if (latestTitle) return latestTitle;
    }
    if (anchor && anchor.type === 'knowledge') {
        const title = String(anchor.title || '').trim();
        if (title) return title;
    }
    return String(n.sourceTitle || '').trim();
}

function renderNotesList() {
    const listEl = els.notesList || document.getElementById('notesList');
    if (!listEl) return;
    renderNotebookSelector();
    const arr = getNotesForActiveNotebook();
    if (!arr.length) {
        listEl.innerHTML = '<div class="notes-empty">暂无笔记。选中文本后右键可添加。</div>';
        listEl.ondragover = null;
        listEl.ondrop = null;
        renderNotesBadge();
        setTimeout(() => {
            try {
                const panel = document.getElementById('notesPanel');
                cacheNotesPanelSnapshot(panel);
            } catch (_) {}
        }, 50);
        return;
    }
    listEl.innerHTML = '';
    let hasLiveTitleUpdate = false;
    arr.forEach((n) => {
        const card = document.createElement('article');
        card.className = 'note-item';
        card.dataset.noteId = String(n.id || '');
        card.draggable = true;

        const delBtn = document.createElement('button');
        delBtn.className = 'note-del-btn';
        delBtn.type = 'button';
        delBtn.title = '删除';
        delBtn.dataset.action = 'delete-note';
        delBtn.draggable = false;
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        const textDiv = document.createElement('div');
        textDiv.className = 'note-text';
        textDiv.innerHTML = renderMarkdownForNotes(String(n.text || ''));
        const syncRendered = renderMathInElementSyncPreferred(textDiv);
        if (!syncRendered) renderMathSafe(textDiv);
        highlightCode(textDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'note-meta';
        const sourceSpan = document.createElement('button');
        sourceSpan.type = 'button';
        sourceSpan.className = 'note-source note-source-link';
        sourceSpan.dataset.action = 'jump-note-source';
        sourceSpan.dataset.noteId = String(n.id || '');
        sourceSpan.draggable = false;
        sourceSpan.title = '跳转到来源';
        const liveSourceTitle = resolveLiveNoteSourceTitle(n);
        if (liveSourceTitle !== String(n.sourceTitle || '').trim()) {
            n.sourceTitle = liveSourceTitle;
            hasLiveTitleUpdate = true;
        }
        sourceSpan.textContent = `${String(n.source || '聊天')}${liveSourceTitle ? ` · ${String(liveSourceTitle)}` : ''}`;
        const timeSpan = document.createElement('span');
        timeSpan.className = 'note-time';
        timeSpan.textContent = formatNoteTime(n.ts);
        metaDiv.appendChild(sourceSpan);
        metaDiv.appendChild(timeSpan);

        card.appendChild(delBtn);
        card.appendChild(textDiv);
        card.appendChild(metaDiv);
        listEl.appendChild(card);
    });

    listEl.querySelectorAll('[data-action="delete-note"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const card = e.currentTarget.closest('.note-item');
            if (!card) return;
            const noteId = String(card.dataset.noteId || '').trim();
            if (!noteId) return;
            const ok = await confirmModalAsync('删除笔记', '确定删除这条笔记吗？', 'danger');
            if (!ok) return;
            notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
                .filter((n) => String(n.id || '') !== noteId);
            saveNotesToStorage();
            renderNotesList();
        });
    });

    listEl.querySelectorAll('[data-action="jump-note-source"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const noteId = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.noteId) || '').trim();
            if (!noteId) return;
            await jumpToNoteSource(noteId);
        });
    });

    let draggingNoteId = '';
    const clearDragClasses = () => {
        listEl.querySelectorAll('.note-item').forEach((el) => {
            el.classList.remove('dragging');
            el.classList.remove('drag-over-top');
            el.classList.remove('drag-over-bottom');
        });
    };

    listEl.querySelectorAll('.note-item').forEach((card) => {
        card.addEventListener('dragstart', (e) => {
            const noteId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!noteId) return;
            draggingNoteId = noteId;
            card.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try {
                    e.dataTransfer.setData('text/plain', noteId);
                } catch (_) {
                    // ignore
                }
            }
        });
        card.addEventListener('dragend', () => {
            draggingNoteId = '';
            clearDragClasses();
        });
        card.addEventListener('dragover', (e) => {
            if (!draggingNoteId) return;
            const overId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!overId || overId === draggingNoteId) return;
            e.preventDefault();
            clearDragClasses();
            const rect = card.getBoundingClientRect();
            const before = Number(e.clientY || 0) < (rect.top + rect.height / 2);
            card.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
        });
        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over-top');
            card.classList.remove('drag-over-bottom');
        });
        card.addEventListener('drop', (e) => {
            if (!draggingNoteId) return;
            e.preventDefault();
            const overId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!overId || overId === draggingNoteId) {
                clearDragClasses();
                return;
            }
            const rect = card.getBoundingClientRect();
            const before = Number(e.clientY || 0) < (rect.top + rect.height / 2);
            const changed = reorderNotesWithinActiveNotebook(draggingNoteId, overId, before);
            clearDragClasses();
            if (!changed) return;
            saveNotesToStorage();
            renderNotesList();
        });
    });

    listEl.ondragover = (e) => {
        if (!draggingNoteId) return;
        e.preventDefault();
    };
    listEl.ondrop = (e) => {
        if (!draggingNoteId) return;
        const overCard = e.target && e.target.closest ? e.target.closest('.note-item') : null;
        if (overCard) return;
        e.preventDefault();
        const activeNotes = getNotesForActiveNotebook();
        if (!activeNotes.length) return;
        const last = activeNotes[activeNotes.length - 1];
        const lastId = String((last && last.id) || '').trim();
        if (!lastId || lastId === draggingNoteId) return;
        const changed = reorderNotesWithinActiveNotebook(draggingNoteId, lastId, false);
        clearDragClasses();
        if (!changed) return;
        saveNotesToStorage();
        renderNotesList();
    };

    if (hasLiveTitleUpdate) {
        saveNotesToStorage();
    }
    renderNotesBadge();
    
    setTimeout(() => {
        try {
            const panel = document.getElementById('notesPanel');
            cacheNotesPanelSnapshot(panel);
        } catch (_) {}
    }, 50);
}

window.__nexoraGetNotesSnapshotHtml = function() {
    try {
        let payload = null;
        try {
            const scopedStoreKey = getNotesScopedStorageKey(NOTES_SYNC_STORE_KEY);
            const raw = scopedStoreKey ? localStorage.getItem(scopedStoreKey) : '';
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    payload = parsed;
                }
            }
        } catch (_) {}

        if (payload) {
            applyNotesStoreToState(payload);
        } else if (!Array.isArray(notesState.notebooks) || notesState.notebooks.length === 0) {
            applyNotesStoreToState(createDefaultNotesStore());
        }

        renderNotesList();

        const panel = document.querySelector('#notesPanel, .notes-panel, aside.notes-panel, div.notes-panel');
        if (!panel) {
            return {
                success: false,
                html: '',
                message: 'notes panel not found in helper'
            };
        }

        const cloned = panel.cloneNode(true);
        if (cloned && cloned.classList) {
            cloned.classList.add('active');
            cloned.classList.remove('closed');
            cloned.classList.remove('collapsed');
        }
        if (cloned && cloned.setAttribute) {
            cloned.setAttribute('aria-hidden', 'false');
        }
        const list = cloned && cloned.querySelector ? cloned.querySelector('#notesList, .notes-list') : null;
        const itemsCount = list && list.children ? Number(list.children.length || 0) : -1;
        const activeNotebookId = String(notesState.activeNotebookId || '').trim();
        const noteIndex = {};
        (Array.isArray(notesState.items) ? notesState.items : []).forEach((note) => {
            const item = (note && typeof note === 'object') ? note : null;
            if (!item) return;
            if (String(item.notebookId || '').trim() !== activeNotebookId) return;
            const noteId = String(item.id || '').trim();
            if (!noteId) return;
            noteIndex[noteId] = {
                sourceTitle: String(item.sourceTitle || '').trim(),
                anchor: normalizeNoteAnchor(item.anchor) || buildFallbackAnchorFromNote(item)
            };
        });
        const htmlOut = String((cloned && cloned.outerHTML) || panel.outerHTML || '');
        return {
            success: true,
            html: htmlOut,
            items_count: itemsCount,
            note_index: noteIndex,
            ts: Date.now()
        };
    } catch (e) {
        return {
            success: false,
            html: '',
            message: String(e || 'notes snapshot helper error')
        };
    }
};

function syncNotesForConversation(_conversationId = readCurrentConversationId()) {
    // 兼容旧调用：当前改为全局笔记本模型，不再按会话分仓。
    if (!Array.isArray(notesState.notebooks) || notesState.notebooks.length === 0) {
        void hydrateNotesState();
    }
    renderNotesList();
}

function openNotesPanel() {
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    notesState.open = true;
    panel.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    bringFloatingPanelToFront(panel);
    bindNotesPanelMobileDrag();
    requestAnimationFrame(() => applyNotesMobilePanelPosition());
    renderNotesList();
    const localSigBeforeFetch = getNotesStoreSignature(buildNotesStorePayload());
    const requestSeq = notesMutationSeq;
    void fetchNotesStoreFromCloud().then((store) => {
        if (!store) return;
        if (requestSeq !== notesMutationSeq) return;
        if (hasPendingLocalNotesChanges()) return;
        const cloudHasUserData = notesStoreHasUserData(store);
        const cloudUpdatedAt = getNotesStoreUpdatedAt(store);
        const currentUpdatedAt = getNotesStoreUpdatedAt(notesState);
        const currentHasUserData = notesStoreHasUserData(notesState);
        if (!cloudHasUserData) {
            if (cloudUpdatedAt > 0) {
                if (currentUpdatedAt > 0 && cloudUpdatedAt <= currentUpdatedAt) return;
                applyNotesStoreToState(store);
                notesMutationSeq += 1;
                renderNotesList();
                return;
            }
            if (currentHasUserData) {
                saveNotesToStorage({ immediate: true });
                renderNotesList();
            }
            return;
        }
        if (!shouldApplyNotesStoreUpdate(notesState, store)) return;
        const cloudSig = getNotesStoreSignature(store);
        if (cloudSig && cloudSig === localSigBeforeFetch) return;
        applyNotesStoreToState(store);
        notesMutationSeq += 1;
        renderNotesList();
    });
}

function closeNotesPanel() {
    if (NOTES_COMPANION_MODE) return;
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    notesState.open = false;
    panel.classList.remove('active');
    panel.classList.remove('dragging');
    panel.classList.remove('resizing');
    panel.setAttribute('aria-hidden', 'true');
}

function loadTimelinePanelPosition() {
    try {
        const raw = localStorage.getItem(TIMELINE_PANEL_LAYOUT_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        const left = Number(obj && obj.left);
        const top = Number(obj && obj.top);
        const width = Number(obj && obj.width);
        const height = Number(obj && obj.height);
        if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)) {
            return { left, top, width, height };
        }
    } catch (_) {}
    return null;
}

function saveTimelinePanelPosition(left, top, width, height) {
    try {
        localStorage.setItem(TIMELINE_PANEL_LAYOUT_KEY, JSON.stringify({
            left: Math.round(Number(left || 0)),
            top: Math.round(Number(top || 0)),
            width: Math.round(Number(width || 0)),
            height: Math.round(Number(height || 0))
        }));
    } catch (_) {}
}

function applyTimelinePanelPosition(forceDefault = false) {
    const panel = els.timelinePanel || document.getElementById('timelinePanel');
    if (!panel) return;
    const saved = loadTimelinePanelPosition();
    if (!saved && !forceDefault) return;
    if (saved) {
        const minWidth = Math.min(320, Math.max(260, window.innerWidth - 24));
        const minHeight = 180;
        const maxWidth = Math.max(minWidth, window.innerWidth - 24);
        const maxHeight = Math.max(minHeight, window.innerHeight - 24);
        const width = Math.max(minWidth, Math.min(maxWidth, Number(saved.width || minWidth)));
        const height = Math.max(minHeight, Math.min(maxHeight, Number(saved.height || minHeight)));
        const maxLeft = Math.max(8, window.innerWidth - width - 8);
        const maxTop = Math.max(8, window.innerHeight - height - 8);
        timelineState.left = Math.max(8, Math.min(maxLeft, Number(saved.left || 0)));
        timelineState.top = Math.max(8, Math.min(maxTop, Number(saved.top || 0)));
        timelineState.width = width;
        timelineState.height = height;
        panel.style.left = `${timelineState.left}px`;
        panel.style.top = `${timelineState.top}px`;
        panel.style.right = 'auto';
        panel.style.width = `${timelineState.width}px`;
        panel.style.height = `${timelineState.height}px`;
        return;
    }
    const rect = panel.getBoundingClientRect();
    timelineState.left = Number(rect.left || 0);
    timelineState.top = Number(rect.top || 0);
    timelineState.width = Number(rect.width || 0);
    timelineState.height = Number(rect.height || 0);
}

function bindTimelinePanelDrag() {
    if (timelineState.bound) return;
    timelineState.bound = true;
    const panel = els.timelinePanel || document.getElementById('timelinePanel');
    const head = els.timelinePanelHead || document.querySelector('#timelinePanel .timeline-panel-head');
    const resizeHandle = els.timelineResizeHandle || document.getElementById('timelineResizeHandle');
    if (!panel || !head) return;
    bindFloatingPanelFront(panel);

    const clampRect = (left, top, width, height) => {
        const minWidth = Math.min(320, Math.max(260, window.innerWidth - 24));
        const minHeight = 180;
        const maxWidth = Math.max(minWidth, window.innerWidth - 24);
        const maxHeight = Math.max(minHeight, window.innerHeight - 24);
        const safeWidth = Math.max(minWidth, Math.min(maxWidth, Number(width || minWidth)));
        const safeHeight = Math.max(minHeight, Math.min(maxHeight, Number(height || minHeight)));
        const maxLeft = Math.max(8, window.innerWidth - safeWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - safeHeight - 8);
        return {
            left: Math.max(8, Math.min(maxLeft, Number(left || 0))),
            top: Math.max(8, Math.min(maxTop, Number(top || 0))),
            width: safeWidth,
            height: safeHeight
        };
    };

    const stop = () => {
        if (!timelineState.dragging && !timelineState.resizing) return;
        timelineState.dragging = false;
        timelineState.resizing = false;
        timelineState.pointerId = null;
        saveTimelinePanelPosition(
            timelineState.left,
            timelineState.top,
            timelineState.width,
            timelineState.height
        );
        panel.classList.remove('dragging');
        panel.classList.remove('resizing');
    };

    const move = (e) => {
        if (!timelineState.dragging && !timelineState.resizing) return;
        if (timelineState.pointerId != null && e.pointerId !== timelineState.pointerId) return;
        const dx = Number(e.clientX || 0) - timelineState.startClientX;
        const dy = Number(e.clientY || 0) - timelineState.startClientY;
        e.preventDefault();
        if (timelineState.dragging) {
            const next = clampRect(
                timelineState.startLeft + dx,
                timelineState.startTop + dy,
                timelineState.width,
                timelineState.height
            );
            timelineState.left = next.left;
            timelineState.top = next.top;
            timelineState.width = next.width;
            timelineState.height = next.height;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.right = 'auto';
            panel.style.width = `${next.width}px`;
            panel.style.height = `${next.height}px`;
        } else if (timelineState.resizing) {
            const next = clampRect(
                timelineState.left,
                timelineState.top,
                timelineState.startWidth + dx,
                timelineState.startHeight + dy
            );
            timelineState.left = next.left;
            timelineState.top = next.top;
            timelineState.width = next.width;
            timelineState.height = next.height;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.right = 'auto';
            panel.style.width = `${next.width}px`;
            panel.style.height = `${next.height}px`;
        }
    };

    head.addEventListener('pointerdown', (e) => {
        if (!timelineState.open) return;
        if (e.button !== 0) return;
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('button, a, input, textarea, select')) return;
        bringFloatingPanelToFront(panel);
        const rect = panel.getBoundingClientRect();
        timelineState.dragging = true;
        timelineState.resizing = false;
        timelineState.pointerId = e.pointerId;
        timelineState.startClientX = Number(e.clientX || 0);
        timelineState.startClientY = Number(e.clientY || 0);
        timelineState.startLeft = Number(rect.left || 0);
        timelineState.startTop = Number(rect.top || 0);
        timelineState.left = Number(rect.left || 0);
        timelineState.top = Number(rect.top || 0);
        timelineState.width = Number(rect.width || 0);
        timelineState.height = Number(rect.height || 0);
        panel.classList.add('dragging');
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
    });

    if (resizeHandle) {
        resizeHandle.addEventListener('pointerdown', (e) => {
            if (!timelineState.open) return;
            if (e.button !== 0) return;
            const rect = panel.getBoundingClientRect();
            timelineState.dragging = false;
            timelineState.resizing = true;
            timelineState.pointerId = e.pointerId;
            timelineState.startClientX = Number(e.clientX || 0);
            timelineState.startClientY = Number(e.clientY || 0);
            timelineState.startWidth = Number(rect.width || 0);
            timelineState.startHeight = Number(rect.height || 0);
            timelineState.left = Number(rect.left || 0);
            timelineState.top = Number(rect.top || 0);
            timelineState.width = Number(rect.width || 0);
            timelineState.height = Number(rect.height || 0);
            panel.classList.add('resizing');
            try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            e.stopPropagation();
        });
    }

    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
    window.addEventListener('resize', () => {
        if (!timelineState.open) return;
        applyTimelinePanelPosition(false);
    });
}

function formatTimelineDateParts(ts) {
    const n = Number(ts || 0);
    if (!n) {
        return { date: '-', time: '--:--' };
    }

    try {
        const d = new Date(n * 1000);

        return {
            date: d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
            time: d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        };
    } catch (_) {
        return { date: '-', time: '--:--' };
    }
}

function timelineEntryIconClass(entry) {
    const kind = String((entry && (entry.kind || entry.type)) || '').toLowerCase();
    if (kind === 'note') return 'fa-solid fa-note-sticky';
    if (kind === 'notebook') return 'fa-solid fa-book-bookmark';
    if (kind === 'knowledge') return 'fa-solid fa-book-open';
    return 'fa-solid fa-clock';
}

function timelineEntryKindLabel(entry) {
    const kind = String((entry && (entry.kind || entry.type)) || '').toLowerCase();

    if (kind === 'note') {
        return '笔记';
    }

    if (kind === 'notebook') {
        return '笔记本';
    }

    if (kind === 'knowledge') {
        return '知识库';
    }

    return '记录';
}

function timelineEntryActionLabel(entry) {
    const rawTitle = String((entry && entry.title) || '').trim();

    if (/^新增\s/.test(rawTitle)) {
        return '新增';
    }

    if (/^删除\s/.test(rawTitle)) {
        return '删除';
    }

    return '修改';
}

function timelineEntrySubject(entry) {
    const rawTitle = String((entry && entry.title) || '记录').trim();
    return rawTitle.replace(/^(新增|删除|修改)\s+/, '').trim() || '记录';
}

async function fetchTimelineEntries() {
    try {
        const res = await fetch('/api/timeline?limit=120');
        const data = await res.json();
        if (data && data.success && Array.isArray(data.items)) {
            return data.items;
        }
    } catch (_) {}
    return [];
}

function renderTimelineList() {
    const listEl = els.timelineList || document.getElementById('timelineList');
    if (!listEl) return;
    const items = Array.isArray(timelineState.items) ? timelineState.items : [];

    if (!items.length) {
        listEl.innerHTML = '<div class="timeline-empty">暂无时间线记录</div>';
        return;
    }

    listEl.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'timeline-track';
    let lastDateLabel = '';

    items.forEach((entry) => {
        const item = document.createElement('article');
        item.className = 'timeline-item';
        const parts = formatTimelineDateParts(entry.ts);
        item.title = `${String(parts.date || '').trim()} ${String(parts.time || '').trim()}`.trim();
        item.dataset.ts = String(entry.ts || '');

        const rail = document.createElement('div');
        rail.className = 'timeline-rail';

        const dateMain = document.createElement('div');
        dateMain.className = 'timeline-date-main';
        const currentDate = String(parts.date || '').trim();
        dateMain.textContent = currentDate === lastDateLabel ? '' : currentDate;

        if (currentDate) {
            lastDateLabel = currentDate;
        }

        const dateTime = document.createElement('div');
        dateTime.className = 'timeline-date-time';
        dateTime.textContent = String(parts.time || '').trim();

        rail.appendChild(dateMain);
        rail.appendChild(dateTime);

        const node = document.createElement('div');
        node.className = 'timeline-node';
        rail.appendChild(node);

        const content = document.createElement('div');
        content.className = 'timeline-content';

        const top = document.createElement('div');
        top.className = 'timeline-top';
        const icon = document.createElement('span');
        icon.className = 'timeline-type-icon';
        icon.innerHTML = `<i class="${timelineEntryIconClass(entry)}"></i>`;

        const title = document.createElement('div');
        title.className = 'timeline-title';
        title.textContent = String(entry.title || '未命名').trim() || '未命名';

        const kindLabel = document.createElement('span');
        kindLabel.className = 'timeline-kind-label';
        kindLabel.textContent = timelineEntryKindLabel(entry);

        top.appendChild(icon);
        top.appendChild(title);
        top.appendChild(kindLabel);

        const updateBy = document.createElement('div');
        updateBy.className = 'timeline-update-by';
        updateBy.innerHTML = '<i class="fa-regular fa-user"></i>';
        const updateByText = document.createElement('span');
        updateByText.textContent = String(entry.update_by || '用户').trim() || '用户';
        updateBy.appendChild(updateByText);

        const diffText = String(entry.difference || '').trim() || '无变更';
        const diff = document.createElement('div');
        diff.className = 'timeline-diff';
        const diffSign = diffText.startsWith('+') ? '+' : (diffText.startsWith('-') ? '-' : (diffText.startsWith('±') ? '±' : ''));

        if (diffSign) {
            diff.classList.add(diffSign === '+' ? 'positive' : (diffSign === '-' ? 'negative' : 'modified'));

            const body = document.createElement('span');
            body.className = 'timeline-diff-body';
            body.textContent = diffText.slice(1).trim() || '无变更';

            const sign = document.createElement('span');
            sign.className = 'timeline-diff-sign';
            sign.textContent = diffSign === '+' ? '新增' : (diffSign === '-' ? '删除' : '修改');

            diff.appendChild(sign);
            diff.appendChild(body);
            diff.title = diffText;
        } else {
            diff.classList.add('neutral');

            const summary = document.createElement('span');
            summary.className = 'timeline-diff-summary';
            summary.textContent = `${timelineEntryActionLabel(entry)} ${timelineEntrySubject(entry)}`;

            diff.appendChild(summary);
            diff.title = summary.textContent;
        }

        content.appendChild(top);
        content.appendChild(updateBy);
        content.appendChild(diff);

        item.appendChild(rail);
        item.appendChild(content);
        track.appendChild(item);
    });
    listEl.appendChild(track);
}

async function refreshTimelinePanel() {
    if (timelineRefreshInFlight) return;
    timelineRefreshInFlight = true;
    try {
        const items = await fetchTimelineEntries();
        timelineState.items = Array.isArray(items) ? items : [];
        renderTimelineList();
    } finally {
        timelineRefreshInFlight = false;
    }
}

function startTimelinePolling() {
    if (timelineRefreshTimer) return;
    timelineRefreshTimer = setTimeout(async function tick() {
        timelineRefreshTimer = null;
        if (!timelineState.open) return;
        await refreshTimelinePanel();
        if (timelineState.open) {
            startTimelinePolling();
        }
    }, TIMELINE_REFRESH_INTERVAL_MS);
}

function stopTimelinePolling() {
    if (timelineRefreshTimer) {
        clearTimeout(timelineRefreshTimer);
        timelineRefreshTimer = null;
    }
}

function openTimelinePanel() {
    const panel = els.timelinePanel || document.getElementById('timelinePanel');
    if (!panel) return;
    timelineState.open = true;
    panel.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    bringFloatingPanelToFront(panel);
    bindTimelinePanelDrag();
    applyTimelinePanelPosition(false);
    void refreshTimelinePanel();
    startTimelinePolling();
}

function closeTimelinePanel() {
    const panel = els.timelinePanel || document.getElementById('timelinePanel');
    if (!panel) return;
    timelineState.open = false;
    panel.classList.remove('active');
    panel.classList.remove('dragging');
    panel.classList.remove('resizing');
    panel.setAttribute('aria-hidden', 'true');
    stopTimelinePolling();
}

window.toggleTimelinePanel = function() {
    const panel = els.timelinePanel || document.getElementById('timelinePanel');
    if (!panel) return;
    if (timelineState.open) closeTimelinePanel();
    else openTimelinePanel();
};

function logNotesBridge(message) {
    const msg = String(message || '').trim();
    if (!msg) return;
    try {
        const info = getNotesCompanionApiInfo();
        const api = info.api;
        if (api && typeof api.log_notes_bridge_event === 'function') {
            api.log_notes_bridge_event(msg);
        }
    } catch (_) {}
    try { console.log('[NexoraNotesBridge] ' + msg); } catch (_) {}
}

window.toggleNotesPanel = function() {
    if (!NOTES_COMPANION_MODE) {
        // Prefer external notes companion when bridge is available.
        // Fallback to in-page panel if companion open fails.
        Promise.resolve().then(async () => {
            const apiInfo = getNotesCompanionApiInfo();
            logNotesBridge('toggleNotesPanel companion_mode=0 source=' + String(apiInfo.source || 'none') + ' hasApi=' + String(!!apiInfo.api));
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (ok) return;
            }
            logNotesBridge('toggleNotesPanel fallback=open-inline-notes-panel');
            if (notesState.open) closeNotesPanel();
            else openNotesPanel();
        });
        return;
    }
    if (notesState.open) closeNotesPanel();
    else openNotesPanel();
};

function canOpenNotesCompanionWindow() {
    if (NOTES_COMPANION_MODE) return false;
    const info = getNotesCompanionApiInfo();
    const isDesktop = document.documentElement.classList.contains('nc-desktop-mode');
    return !!(info && info.api && typeof info.api.open_notes_companion === 'function') || isDesktop;
}

function getNotesCompanionApiInfo() {
    try {
        if (window.pywebview && window.pywebview.api) {
            return { api: window.pywebview.api, source: 'self' };
        }
    } catch (_) {}
    try {
        if (window.parent && window.parent !== window && window.parent.pywebview && window.parent.pywebview.api) {
            return { api: window.parent.pywebview.api, source: 'parent' };
        }
    } catch (_) {}
    try {
        if (window.top && window.top !== window && window.top.pywebview && window.top.pywebview.api) {
            return { api: window.top.pywebview.api, source: 'top' };
        }
    } catch (_) {}
    return { api: null, source: 'none' };
}

function getNotesCompanionApi() {
    return getNotesCompanionApiInfo().api;
}

async function openNotesCompanionWindow() {
    const info = getNotesCompanionApiInfo();
    const api = info && info.api;
    if (NOTES_COMPANION_MODE) {
        return false;
    }
    if (!api || typeof api.open_notes_companion !== 'function') {
        const isDesktop = document.documentElement.classList.contains('nc-desktop-mode');
        if (isDesktop) {
            logNotesBridge('openNotesCompanionWindow postMessage fallback');
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'NC_OPEN_NOTES_COMPANION' }, '*');
                return true;
            }
        }
        return false;
    }
    try {
        logNotesBridge('openNotesCompanionWindow call source=' + String(info.source || 'unknown'));
        const res = await api.open_notes_companion();
        logNotesBridge('openNotesCompanionWindow result=' + JSON.stringify(res || {}));
        const ok = !!(res && res.success);
        if (ok && notesState.open) {
            closeNotesPanel();
        }
        return ok;
    } catch (e) {
        logNotesBridge('openNotesCompanionWindow error=' + String(e || 'unknown'));
        return false;
    }
}

function isEditableTarget(target) {
    if (!target) return false;
    const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return true;
    return !!el.closest('[contenteditable=""], [contenteditable="true"]');
}

function isTargetInsideSelectableArea(target) {
    if (!target) return false;
    const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el) return false;
    const msgRoot = els.messagesContainer || document.getElementById('messagesContainer');
    const viewerRoot = document.getElementById('knowledgeViewer');
    if (msgRoot && msgRoot.contains(el)) return true;
    if (viewerRoot && viewerRoot.style.display !== 'none' && viewerRoot.contains(el)) return true;
    return false;
}

function getSelectionPlainTextForNotes(sel) {
    const selection = sel || (window.getSelection ? window.getSelection() : null);
    if (!selection) return '';
    return normalizeSelectionTextForNotes(String(selection.toString() || '').trim());
}

function buildSelectionAnchorFromChatTarget(target, markdownText = '', plainText = '') {
    const t = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    const messageEl = t && t.closest ? t.closest('.message') : null;
    const messageIndexRaw = messageEl ? Number(messageEl.dataset.index) : NaN;
    const messageIndex = Number.isFinite(messageIndexRaw) ? Math.max(0, Math.floor(messageIndexRaw)) : null;
    const conversationId = String(readCurrentConversationId() || '').trim();
    let messageRole = '';
    if (messageEl) {
        if (messageEl.classList.contains('assistant')) messageRole = 'assistant';
        else if (messageEl.classList.contains('user')) messageRole = 'user';
    }
    return {
        type: 'chat',
        conversationId,
        messageIndex,
        messageRole,
        snippet: buildNoteAnchorSnippet(markdownText, 280),
        plainSnippet: buildNoteAnchorSnippet(plainText || markdownText, 280)
    };
}

function buildSelectionAnchorFromKnowledgeTarget(markdownText = '', plainText = '') {
    return {
        type: 'knowledge',
        title: String(knowledgeEditorController.getCurrentTitle() || '').trim(),
        snippet: buildNoteAnchorSnippet(markdownText, 280),
        plainSnippet: buildNoteAnchorSnippet(plainText || markdownText, 280)
    };
}

function resolveSelectionSource(target, selectionText = '', plainText = '') {
    const t = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    const viewer = document.getElementById('knowledgeViewer');
    if (viewer && viewer.style.display !== 'none' && t && viewer.contains(t)) {
        const knowledgeTitle = String(knowledgeEditorController.getCurrentTitle() || '').trim();
        const sourceTitle = knowledgeTitle || (els.conversationTitle ? String(els.conversationTitle.textContent || '').trim() : '');
        return {
            source: '知识库',
            sourceTitle,
            anchor: knowledgeTitle ? buildSelectionAnchorFromKnowledgeTarget(selectionText, plainText) : null
        };
    }
    return {
        source: '聊天',
        sourceTitle: els.conversationTitle ? String(els.conversationTitle.textContent || '').trim() : '',
        anchor: buildSelectionAnchorFromChatTarget(t, selectionText, plainText)
    };
}

// 强制压缩一次开关状态：所有权归属本模块（读写一致），chat.js 经 import 只读消费。
let forceContextCompressionOnce = false;

function setForceContextCompressionOnce(enabled) {
    forceContextCompressionOnce = !!enabled;
    const btn = els.forceContextCompressionBtn || document.getElementById('forceContextCompressionBtn');
    if (!btn) return;
    btn.classList.toggle('armed', !!forceContextCompressionOnce);
    btn.setAttribute('aria-pressed', forceContextCompressionOnce ? 'true' : 'false');
}

function consumeForceContextCompressionOnce() {
    const armed = !!forceContextCompressionOnce;
    if (armed) setForceContextCompressionOnce(false);
    return armed;
}

function getDebugTraceTitle(stage, fallbackTitle = '') {
    const s = String(stage || '').trim();
    if (fallbackTitle) return String(fallbackTitle);
    if (s === 'context_compression_trigger') return 'Compression Trigger';
    if (s === 'system_prompt') return 'System Prompt';
    if (s === 'tool_injection') return 'Tool Injection';
    if (s === 'current_context') return 'Current Context';
    if (s === 'context_compression_source') return 'Compression Source';
    if (s === 'context_compression_prompt') return 'Compression Prompt';
    if (s === 'context_compression_model_reply_stream') return 'Compression Model Reply Stream';
    if (s === 'context_compression_model_reply_stream_error') return 'Compression Stream Error';
    if (s === 'context_compression_model_reply') return 'Compression Model Reply';
    if (s === 'context_compression_summary') return 'Compression Summary';
    if (s === 'round_token_usage') return 'Round Token Usage';
    if (s === 'context_compression_compare') return 'Compression Compare';
    return s || 'trace';
}

function appendDebugTraceChunk(chunk, debugScopeKey = '') {
    const c = (chunk && typeof chunk === 'object') ? chunk : {};
    const stage = String(c.stage || '').trim();
    if (!stage) return;
    let replaceKey = String(c.replaceKey || '').trim();
    if (!replaceKey) {
        if (stage === 'system_prompt') replaceKey = `${debugScopeKey}:system`;
        else if (stage === 'tool_injection') replaceKey = `${debugScopeKey}:tools`;
        else if (stage === 'current_context') replaceKey = `${debugScopeKey}:context`;
        else if (stage === 'context_compression_trigger') replaceKey = `${debugScopeKey}:compression_trigger`;
        else if (stage === 'context_compression_model_reply_stream') {
            const round = Number.isFinite(Number(c.round)) ? Number(c.round) : 0;
            replaceKey = `${debugScopeKey}:compression_reply_stream:${round}`;
        } else if (stage === 'context_compression_model_reply_stream_error') {
            const round = Number.isFinite(Number(c.round)) ? Number(c.round) : 0;
            replaceKey = `${debugScopeKey}:compression_reply_stream_error:${round}`;
        }
    }
    appendDebugConsoleEntry({
        ...c,
        title: getDebugTraceTitle(stage, c.title),
        replaceKey
    });
}

function fillMessageInputWithExplainText(rawText) {
    const input = els.messageInput;
    if (!input) return false;
    const text = normalizeSelectionTextForNotes(rawText);
    if (!text) return false;
    const prompt = `解释 ${text}`;
    input.value = prompt;
    learningSidebarDraftValue = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
        resizeMessageInput(input);
    });
    try {
        const n = prompt.length;
        input.setSelectionRange(n, n, 'none');
    } catch (_) {
        // ignore selection API failures
    }
    ensureMessageInputFocus({ onlyIfBlurred: false, preserveSelection: true });
    notifyLearningSidebarBridge();
    return true;
}

function hideNotesContextMenu() {
    const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
    if (!menu) return;
    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    notesState.pendingSelectionText = '';
    notesState.pendingSelectionSource = null;
}

function showNotesContextMenu(x, y, selectionText, sourceMeta) {
    const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
    if (!menu) return;
    hidePinContextMenu();
    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 44;
    menu.style.left = `${Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 12))}px`;
    menu.style.top = `${Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 12))}px`;
    notesState.pendingSelectionText = normalizeSelectionTextForNotes(selectionText);
    notesState.pendingSelectionSource = sourceMeta && typeof sourceMeta === 'object' ? sourceMeta : null;
}

function clearPinContextMenuFocus(menu) {
    const active = document.activeElement;

    if (!menu || !active || typeof active.blur !== 'function') {
        return;
    }

    if (menu.contains(active)) {
        active.blur();
    }
}

function hidePinContextMenu() {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    if (!menu) return;
    clearPinContextMenuFocus(menu);
    menu.classList.remove('active');
    menu.classList.remove('submenu-left');
    menu.setAttribute('aria-hidden', 'true');
    pinContextMenuState = null;
    pinContextMenuBusy = false;
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    const renameBtn = els.pinContextMenuRename || document.getElementById('pinContextMenuRename');
    const branchBtn = els.pinContextMenuBranch || document.getElementById('pinContextMenuBranch');
    const projectDeleteBtn = els.pinContextMenuProjectDelete || document.getElementById('pinContextMenuProjectDelete');
    const workspaceList = els.pinContextMenuWorkspaceList || document.getElementById('pinContextMenuWorkspaceList');
    if (actionBtn) actionBtn.disabled = false;
    if (renameBtn) renameBtn.disabled = false;
    if (branchBtn) {
        branchBtn.disabled = false;
        branchBtn.style.display = 'none';
    }
    if (projectDeleteBtn) projectDeleteBtn.disabled = false;
    if (workspaceList) workspaceList.innerHTML = '';
}

function updatePinContextMenuAction(state) {
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    const renameBtn = els.pinContextMenuRename || document.getElementById('pinContextMenuRename');
    const branchBtn = els.pinContextMenuBranch || document.getElementById('pinContextMenuBranch');
    const projectDeleteBtn = els.pinContextMenuProjectDelete || document.getElementById('pinContextMenuProjectDelete');
    const workspaceWrap = els.pinContextMenuWorkspaceWrap || document.getElementById('pinContextMenuWorkspaceWrap');
    if (!actionBtn) return;
    const targetType = String((state && state.targetType) || '').trim();
    const isProject = targetType === 'nexoracode_project';
    const pinned = !!(state && state.pinned);
    const label = pinned ? '解除置顶' : '置顶';
    actionBtn.title = label;
    const span = actionBtn.querySelector('span');
    if (span) span.textContent = label;
    const icon = actionBtn.querySelector('i');
    if (icon) icon.className = 'fa-solid fa-thumbtack';
    actionBtn.style.display = isProject ? 'none' : '';
    if (renameBtn) {
        renameBtn.style.display = !isProject && targetType === 'conversation' ? '' : 'none';
    }
    if (branchBtn) {
        branchBtn.style.display = targetType === 'conversation' && !!(state && state.branch) ? '' : 'none';
    }
    if (projectDeleteBtn) {
        projectDeleteBtn.style.display = isProject ? '' : 'none';
    }
    if (workspaceWrap) {
        const supportsWorkspaceMark = state.allowWorkspaceMark !== false
            && (targetType === 'conversation' || targetType === 'knowledge_basis');
        workspaceWrap.style.display = supportsWorkspaceMark ? '' : 'none';
    }
}

async function viewConversationBranchSourceFromContextMenu() {
    const state = { ...(pinContextMenuState || {}) };
    const branch = state.branch && typeof state.branch === 'object' ? state.branch : null;
    const parentConversationId = String(branch && branch.parent_conversation_id || '').trim();
    const parentMessageIndex = Number(branch && branch.parent_message_index);
    hidePinContextMenu();

    if (String(state.targetType || '').trim() !== 'conversation' || !branch || !parentConversationId) {
        return;
    }

    try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(parentConversationId)}?message_limit=1`, {
            method: 'GET',
            cache: 'no-store'
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data || !data.success || !data.conversation) {
            showToast('父分支不存在或已删除');
            return;
        }
    } catch (error) {
        console.error('view conversation branch source failed', error);
        showToast('父分支不存在或已删除');
        return;
    }

    await jumpToChatSource({
        conversationId: parentConversationId,
        messageIndex: parentMessageIndex,
    });
}

function buildSafeNextPathForAuthRedirect() {
    const path = String(window.location.pathname || '/').trim() || '/';
    const search = String(window.location.search || '');
    let next = `${path}${search}`;
    if (!next.startsWith('/')) next = '/chat';
    if (next.startsWith('//')) next = '/chat';
    return next;
}

function redirectToLogin(reason = 'expired') {
    if (authRedirectInProgress) return;
    authRedirectInProgress = true;
    const next = encodeURIComponent(buildSafeNextPathForAuthRedirect());
    const why = encodeURIComponent(String(reason || 'expired'));
    window.location.replace(`/login?next=${next}&reason=${why}&t=${Date.now()}`);
}

function getFetchTargetPath(input) {
    try {
        if (input instanceof Request) {
            const u = new URL(String(input.url || ''), window.location.origin);
            if (u.origin !== window.location.origin) return '';
            return String(u.pathname || '').trim();
        }
        const u = new URL(String(input || ''), window.location.origin);
        if (u.origin !== window.location.origin) return '';
        return String(u.pathname || '').trim();
    } catch (_) {
        return '';
    }
}

function shouldRedirectOnUnauthorized(input) {
    const path = getFetchTargetPath(input);
    if (!path) return false;
    return path.startsWith('/api/') || path === '/chat' || path === '/knowledge';
}

function installAuthFetchGuard() {
    if (window.__nexoraAuthFetchGuardInstalled) return;
    if (typeof window.fetch !== 'function') return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const res = await nativeFetch(...args);
        try {
            const target = args && args.length ? args[0] : '';
            if (res && res.status === 401 && shouldRedirectOnUnauthorized(target)) {
                redirectToLogin('expired');
            }
        } catch (_) {
            // ignore guard errors
        }
        return res;
    };
    window.__nexoraAuthFetchGuardInstalled = true;
}

async function ensureAuthenticatedSession() {
    try {
        const res = await fetch('/api/user/info?lite=1', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
        });
        if (res.status === 401) {
            redirectToLogin('expired');
            return false;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            const msg = String((data && data.message) || '').trim();
            if (res.status === 401 || /未登录|请先登录|unauthorized/i.test(msg)) {
                redirectToLogin('expired');
                return false;
            }
        }
        return true;
    } catch (_) {
        // Network errors should not force-logout.
        return true;
    }
}

async function requestLogoutAndRedirect() {
    if (logoutRequestInFlight) return;
    logoutRequestInFlight = true;
    try {
        await fetch('/logout', {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
    } catch (_) {
        // ignore and continue redirect flow
    } finally {
        try { clearActiveStreamResumeState(); } catch (_) {}
        redirectToLogin('logout');
    }
}

function showPinContextMenu(x, y, payload) {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    if (!menu) return;
    const state = (payload && typeof payload === 'object') ? payload : null;
    if (!state || !state.targetType) return;
    hideNotesContextMenu();
    clearPinContextMenuFocus(menu);
    pinContextMenuState = { ...state };
    updatePinContextMenuAction(pinContextMenuState);
    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');
    const menuWidth = menu.offsetWidth || 136;
    const menuHeight = menu.offsetHeight || 76;
    const left = Math.min(Math.max(8, Number(x || 0)), Math.max(8, window.innerWidth - menuWidth - 12));
    const top = Math.min(Math.max(8, Number(y || 0)), Math.max(8, window.innerHeight - menuHeight - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    positionPinContextSubmenu(menu, left);
    void loadPinContextWorkspaceItems(pinContextMenuState);
}

async function setConversationPinned(conversationId, pin) {
    return conversationListController.setConversationPinned(conversationId, pin);
}

async function setBasisKnowledgePinned(title, pin) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) return false;
    const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(safeTitle)}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: !!pin })
    });
    const data = await res.json();
    return !!(data && data.success);
}

function setConversationPinLocal(conversationId, pin) {
    return conversationListController.setConversationPinLocal(conversationId, pin);
}

function getConversationTitleFromCache(conversationId) {
    return conversationListController.getConversationTitleFromCache(conversationId);
}

function setConversationTitleLocal(conversationId, title) {
    return conversationListController.setConversationTitleLocal(conversationId, title);
}

async function setConversationTitle(conversationId, title) {
    return conversationListController.setConversationTitle(conversationId, title);
}

function closeConversationRenameModal(force = false) {
    return conversationListController.closeConversationRenameModal(force);
}

function openConversationRenameModal(conversationId, title) {
    return conversationListController.openConversationRenameModal(conversationId, title);
}

async function submitConversationRename() {
    return conversationListController.submitConversationRename();
}

function bindConversationRenameModal() {
    return conversationListController.bindConversationRenameModal();
}

function formatTrashTypeLabel(type) {
    const t = String(type || '').trim();
    if (t === 'conversation') return '对话';
    if (t === 'knowledge_basis') return '知识库';
    return t || '未知';
}

function formatTrashDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    try {
        return new Date(raw).toLocaleString();
    } catch (_) {
        return raw;
    }
}

function renderTrashList(items) {
    const listEl = els.trashList || document.getElementById('trashList');
    if (!listEl) return;
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
        listEl.innerHTML = '<div class="trash-empty">暂无回收站内容</div>';
        return;
    }
    listEl.innerHTML = arr.map((item) => {
        const src = (item && typeof item === 'object') ? item : {};
        const typeLabel = formatTrashTypeLabel(src.type);
        const title = String(src.title || '').trim() || '(无标题)';
        const preview = String(src.preview || '').trim() || '（无预览）';
        const changedAt = formatTrashDate(src.changed_at || src.deleted_at || '');
        const deletedAt = formatTrashDate(src.deleted_at || '');
        const rowId = String(src.id || '').trim();
        return `
            <article class="trash-item">
                <div class="trash-item-head">
                    <span class="trash-item-type">${escapeHtml(typeLabel)}</span>
                    <span class="trash-item-time">删除时间：${escapeHtml(deletedAt)}</span>
                </div>
                <div class="trash-item-title">${escapeHtml(title)}</div>
                <div class="trash-item-preview">${escapeHtml(preview)}</div>
                <div class="trash-item-meta">删改日期：${escapeHtml(changedAt)}</div>
                <div class="trash-item-actions">
                    <button class="trash-action-btn" type="button" data-action="restore-trash" data-trash-id="${escapeHtml(rowId)}">恢复</button>
                </div>
            </article>
        `;
    }).join('');

    listEl.querySelectorAll('[data-action="restore-trash"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.trashId) || '').trim();
            if (!id) return;
            await restoreTrashItem(id);
        });
    });
}

async function loadTrashList() {
    const listEl = els.trashList || document.getElementById('trashList');
    if (!listEl || trashViewState.loading) return;
    trashViewState.loading = true;
    listEl.innerHTML = '<div class="trash-empty">加载中...</div>';
    try {
        const res = await fetch('/api/trash/list?limit=200');
        const data = await res.json();
        if (!res.ok || !data || !data.success) {
            const msg = (data && data.message) ? data.message : '读取回收站失败';
            listEl.innerHTML = `<div class="trash-empty">${escapeHtml(msg)}</div>`;
            trashViewState.items = [];
            return;
        }
        trashViewState.items = Array.isArray(data.items) ? data.items : [];
        renderTrashList(trashViewState.items);
    } catch (_) {
        listEl.innerHTML = '<div class="trash-empty">读取回收站失败</div>';
        trashViewState.items = [];
    } finally {
        trashViewState.loading = false;
    }
}

async function restoreTrashItem(trashId) {
    const id = String(trashId || '').trim();
    if (!id) return;
    if (trashViewState.loading) return;
    try {
        const res = await fetch(`/api/trash/${encodeURIComponent(id)}/restore`, {
            method: 'POST'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showToast((data && data.message) ? data.message : '恢复失败');
            return;
        }
        showToast('已恢复');
        await loadTrashList();
        await loadConversations();
        await loadKnowledge(readCurrentConversationId());
    } catch (_) {
        showToast('恢复失败');
    }
}

async function clearTrashItemsWithConfirm() {
    const ok = await confirmModalAsync('清空回收站', '确定清空回收站吗？该操作不可撤销。', 'danger');
    if (!ok) return;
    if (trashViewState.loading) return;
    try {
        const res = await fetch('/api/trash', {
            method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showToast((data && data.message) ? data.message : '清空失败');
            return;
        }
        showToast(`已清空 ${Number(data.removed || 0)} 项`);
        await loadTrashList();
    } catch (_) {
        showToast('清空失败');
    }
}

function closeTrashModal() {
    const modal = els.trashModal || document.getElementById('trashModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

function openTrashModal() {
    const modal = els.trashModal || document.getElementById('trashModal');
    if (!modal) {
        showToast('回收站窗口未加载');
        return;
    }
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    void loadTrashList();
}

function bindTrashModal() {
    const modal = els.trashModal || document.getElementById('trashModal');
    if (!modal || modal.dataset.bindDone === '1') return;
    modal.dataset.bindDone = '1';
    bindBackdropSafeClose(modal, closeTrashModal);

    const closeBtn = els.closeTrashModalBtn || document.getElementById('closeTrashModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeTrashModal();
        });
    }
    const refreshBtn = els.refreshTrashBtn || document.getElementById('refreshTrashBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            void loadTrashList();
        });
    }
    const clearBtn = els.clearTrashBtn || document.getElementById('clearTrashBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            void clearTrashItemsWithConfirm();
        });
    }
}

function setBasisPinLocal(title, pin) {
    return knowledgeSidebarController.setBasisPinLocal(title, pin);
}

async function applyPinContextMenuAction() {
    if (!pinContextMenuState || pinContextMenuBusy) return;
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    const state = { ...pinContextMenuState };
    hidePinContextMenu();
    pinContextMenuBusy = true;
    if (actionBtn) actionBtn.disabled = true;
    try {
        const targetType = String(state.targetType || '').trim();
        const nextPin = !state.pinned;
        let ok = false;
        let patched = false;
        if (targetType === 'conversation') {
            patched = setConversationPinLocal(state.conversationId, nextPin);
            ok = await setConversationPinned(state.conversationId, nextPin);
            if (ok) {
                await loadConversations();
                showToast(nextPin ? '对话已置顶' : '已取消置顶');
            } else if (patched) {
                setConversationPinLocal(state.conversationId, state.pinned);
            }
        } else if (targetType === 'knowledge_basis') {
            patched = setBasisPinLocal(state.title, nextPin);
            ok = await setBasisKnowledgePinned(state.title, nextPin);
            if (ok) {
                await loadKnowledge(readCurrentConversationId());
                showToast(nextPin ? '知识已置顶' : '已取消置顶');
            } else if (patched) {
                setBasisPinLocal(state.title, state.pinned);
            }
        }
        if (!ok) {
            if (targetType === 'conversation') {
                await loadConversations();
            } else if (targetType === 'knowledge_basis') {
                await loadKnowledge(readCurrentConversationId());
            }
            showToast('置顶操作失败');
        }
    } catch (_) {
        const targetType = String(state.targetType || '').trim();
        if (targetType === 'conversation') {
            setConversationPinLocal(state.conversationId, state.pinned);
            await loadConversations();
        } else if (targetType === 'knowledge_basis') {
            setBasisPinLocal(state.title, state.pinned);
            await loadKnowledge(readCurrentConversationId());
        }
        showToast('置顶操作失败');
    } finally {
        pinContextMenuBusy = false;
        if (actionBtn) actionBtn.disabled = false;
    }
}

async function deleteNexoraCodeProjectFromContextMenu() {
    const state = { ...(pinContextMenuState || {}) };
    const projectId = String(state.projectId || '').trim();
    const projectTitle = String(state.projectTitle || '该项目').trim() || '该项目';
    hidePinContextMenu();

    if (String(state.targetType || '').trim() !== 'nexoracode_project' || !projectId) {
        return;
    }

    const confirmed = await confirmModalAsync(
        '移除项目',
        `确定从项目列表移除“${projectTitle}”吗？项目内对话会保留，重新添加同一路径后会自动恢复归组。`,
        'danger'
    );

    if (!confirmed) {
        return;
    }

    if (!hideNexoraCodeProject(projectId)) {
        showToast('项目移除失败');
        return;
    }

    showToast(`已移除项目：${projectTitle}`);
}

function bindPinContextMenu() {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    const renameBtn = els.pinContextMenuRename || document.getElementById('pinContextMenuRename');
    const branchBtn = els.pinContextMenuBranch || document.getElementById('pinContextMenuBranch');
    const projectDeleteBtn = els.pinContextMenuProjectDelete || document.getElementById('pinContextMenuProjectDelete');
    const workspaceList = els.pinContextMenuWorkspaceList || document.getElementById('pinContextMenuWorkspaceList');
    if (!menu || !actionBtn) return;
    if (menu.dataset.bindDone === '1') return;
    menu.dataset.bindDone = '1';
    bindConversationRenameModal();

    actionBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await applyPinContextMenuAction();
    });
    if (renameBtn) {
        renameBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const state = { ...(pinContextMenuState || {}) };
            hidePinContextMenu();
            if (String(state.targetType || '').trim() !== 'conversation') return;
            const cid = String(state.conversationId || '').trim();
            if (!cid) return;
            const title = String(state.conversationTitle || getConversationTitleFromCache(cid) || '').trim();
            openConversationRenameModal(cid, title);
        });
    }
    if (branchBtn) {
        branchBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            branchBtn.disabled = true;
            await viewConversationBranchSourceFromContextMenu();
            branchBtn.disabled = false;
        });
    }
    if (projectDeleteBtn) {
        projectDeleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            projectDeleteBtn.disabled = true;
            await deleteNexoraCodeProjectFromContextMenu();
            projectDeleteBtn.disabled = false;
        });
    }
    if (workspaceList) {
        workspaceList.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target;

            if (!(target instanceof Element)) {
                return;
            }

            const item = target.closest('.pin-context-workspace-item[data-workspace-id]');

            if (!item) {
                return;
            }

            const state = { ...(pinContextMenuState || {}) };
            const workspaceId = String(item.getAttribute('data-workspace-id') || '').trim();
            const conversationId = String(state.conversationId || '').trim();
            const knowledgeTitle = String(state.title || '').trim();
            const targetType = String(state.targetType || '').trim();
            const alreadyMarked = String(item.getAttribute('data-marked') || '') === '1';
            hidePinContextMenu();

            if (alreadyMarked) {
                showToast(targetType === 'knowledge_basis' ? '该知识已在工作区' : '该对话已在工作区');
                return;
            }

            if (targetType === 'conversation' && workspaceId && conversationId) {
                try {
                    await addConversationToWorkspace(workspaceId, conversationId, {
                        refreshList: false,
                        syncSelectedWorkspace: false,
                    });
                    showToast('已归入工作区');
                } catch (error) {
                    console.error('pin context addConversationToWorkspace failed', error);
                    showToast(String((error && error.message) || '归入工作区失败'));
                }
                return;
            }

            if (targetType === 'knowledge_basis' && workspaceId && knowledgeTitle) {
                try {
                    await addKnowledgeToWorkspace(workspaceId, knowledgeTitle, {
                        refreshList: false,
                        syncSelectedWorkspace: false,
                    });
                    showToast('知识已归入工作区');
                } catch (error) {
                    console.error('pin context addKnowledgeToWorkspace failed', error);
                    showToast(String((error && error.message) || '知识归入工作区失败'));
                }
                return;
            }

            if (!workspaceId) {
                showToast('无法归入工作区');
                return;
            }

            showToast('无法归入工作区');
        });
    }

    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('active')) return;
        if (menu.contains(e.target)) return;
        hidePinContextMenu();
    }, true);

    document.addEventListener('scroll', (e) => {
        if (!menu.classList.contains('active')) return;
        if (menu.contains(e.target)) return;
        hidePinContextMenu();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('active')) {
            hidePinContextMenu();
        }
    });
}

function normalizeSelectionTextForNotes(raw) {
    let text = String(raw || '');
    if (!text) return '';
    text = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    text = removeInvisibleTextChars(text);

    const lines = text.split('\n');
    const tableLineCount = lines.filter((l) => /\|/.test(String(l || ''))).length;
    const looksLikeMarkdownTable = tableLineCount >= 2 || /^\s*\|[\s:\-|]+\|\s*$/m.test(text);
    const nonEmptyLines = lines.filter((l) => String(l || '').trim().length > 0);
    const shortLineCount = nonEmptyLines.filter((l) => String(l || '').trim().length <= 2).length;
    const shortRatio = nonEmptyLines.length > 0 ? (shortLineCount / nonEmptyLines.length) : 0;

    // 处理“每个字一行”的选区污染（常见于 KaTeX/复杂 DOM 文本复制）
    if (!looksLikeMarkdownTable && nonEmptyLines.length >= 8 && shortRatio >= 0.62) {
        text = text
            .replace(/\n{2,}/g, NOTE_SELECTION_PARAGRAPH_MARKER)
            .replace(/\n/g, ' ')
            .replaceAll(NOTE_SELECTION_PARAGRAPH_MARKER, '\n\n')
            .replace(/[ \t]{2,}/g, ' ');
    }

    return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
}

function bindSourceMarkdown(el, rawText) {
    if (!el) return;
    try {
        el.__sourceMarkdown = String(rawText || '');
        el.dataset.sourceKind = 'markdown';
    } catch (_) {
        // ignore
    }
}

function getKatexAnnotationTex(el) {
    if (!el || !el.querySelector) return '';
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    return ann ? String(ann.textContent || '').trim() : '';
}

function normalizeExtractedKatexTex(rawTex, displayMode = false) {
    let src = normalizeSelectionTextForNotes(String(rawTex || ''));
    if (!src) return '';

    const stripWrapped = (text, left, right) => {
        const s = String(text || '').trim();
        if (!s.startsWith(left) || !s.endsWith(right)) return s;
        return s.slice(left.length, s.length - right.length).trim();
    };

    for (let i = 0; i < 3; i += 1) {
        const prev = src;
        if (displayMode) {
            src = stripWrapped(src, '$$', '$$');
            src = stripWrapped(src, '\\[', '\\]');
            src = stripWrapped(src, '\\(', '\\)');
            src = stripWrapped(src, '$', '$');
        } else {
            src = stripWrapped(src, '\\(', '\\)');
            src = stripWrapped(src, '$', '$');
            src = stripWrapped(src, '\\[', '\\]');
            src = stripWrapped(src, '$$', '$$');
        }
        if (src === prev) break;
    }

    return src;
}

function escapeMarkdownTableCell(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n+/g, '<br>')
        .replace(/\|/g, '\\|')
        .trim();
}

function extractMarkdownTableCell(cell, inPre = false) {
    if (!cell) return '';
    const chunks = [];
    Array.from(cell.childNodes || []).forEach((child) => {
        chunks.push(extractSelectionTextFromNode(child, inPre));
    });
    const merged = normalizeSelectionTextForNotes(chunks.join(' ').trim());
    return escapeMarkdownTableCell(merged);
}

function tableRowToMarkdown(row, inPre = false, expectedCols = 0) {
    if (!row || typeof row.querySelectorAll !== 'function') return '';
    const rawCells = Array.from(row.querySelectorAll('th,td'));
    const cells = rawCells.map((cell) => extractMarkdownTableCell(cell, inPre));
    while (expectedCols > 0 && cells.length < expectedCols) cells.push('');
    if (!cells.length) return '';
    return `| ${cells.join(' | ')} |`;
}

function tableElementToMarkdown(tableEl, inPre = false) {
    if (!tableEl || typeof tableEl.querySelectorAll !== 'function') return '';
    const rows = Array.from(tableEl.querySelectorAll('tr')).filter((row) => row && row.querySelector('th,td'));
    if (!rows.length) return '';
    const colCount = rows.reduce((maxCols, row) => {
        const n = row.querySelectorAll('th,td').length;
        return Math.max(maxCols, n);
    }, 0);
    if (!colCount) return '';

    const mdRows = rows.map((row) => tableRowToMarkdown(row, inPre, colCount)).filter(Boolean);
    if (!mdRows.length) return '';
    const sep = `| ${new Array(colCount).fill('---').join(' | ')} |`;
    const out = [mdRows[0], sep, ...mdRows.slice(1)];
    return `\n${out.join('\n')}\n`;
}

function extractSelectionTextFromNode(node, inPre = false) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return '';
    }
    const el = node.nodeType === Node.ELEMENT_NODE ? node : null;
    const tag = el ? String(el.tagName || '').toUpperCase() : '';
    const childText = (nextInPre = inPre) => {
        const children = Array.from(node.childNodes || []);
        let out = '';
        for (const child of children) out += extractSelectionTextFromNode(child, nextInPre);
        return out;
    };

    if (el) {
        if (tag === 'SCRIPT' || tag === 'STYLE') return '';
        if (tag === 'BR') return '\n';
        const cls = el.classList;
        if (
            cls && (
                cls.contains('avatar') ||
                cls.contains('model-badge') ||
                cls.contains('msg-actions') ||
                cls.contains('thinking-header') ||
                cls.contains('tool-usage') ||
                cls.contains('add-basis-view')
            )
        ) {
            return '';
        }

        if (el.classList && el.classList.contains('katex-display')) {
            const tex = normalizeExtractedKatexTex(getKatexAnnotationTex(el), true);
            return tex ? `\n$$${tex}$$\n` : '';
        }
        if (el.classList && el.classList.contains('katex')) {
            if (el.closest('.katex-display')) return '';
            const tex = normalizeExtractedKatexTex(getKatexAnnotationTex(el), false);
            return tex ? `$${tex}$` : '';
        }
        if (el.classList && (el.classList.contains('katex-html') || el.classList.contains('katex-mathml'))) {
            return '';
        }
        if (tag === 'ANNOTATION' || tag === 'MATH' || tag === 'SEMANTICS') return '';
    }

    if (tag === 'STRONG' || tag === 'B') {
        const inner = childText(inPre).trim();
        return inner ? `**${inner}**` : '';
    }
    if (tag === 'EM' || tag === 'I') {
        const inner = childText(inPre).trim();
        return inner ? `*${inner}*` : '';
    }
    if (tag === 'S' || tag === 'DEL') {
        const inner = childText(inPre).trim();
        return inner ? `~~${inner}~~` : '';
    }
    if (tag === 'CODE' && !inPre) {
        const inner = childText(true).replace(/\n+/g, ' ').trim();
        return inner ? `\`${inner}\`` : '';
    }
    if (tag === 'PRE') {
        const inner = childText(true).replace(/\n+$/, '');
        return inner ? `\n\`\`\`\n${inner}\n\`\`\`\n` : '';
    }
    if (tag === 'A') {
        const label = childText(inPre).trim();
        const href = String((el && el.getAttribute && el.getAttribute('href')) || '').trim();
        if (label && href) return `[${label}](${href})`;
        return label;
    }
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
        const level = Number(tag.slice(1)) || 1;
        const inner = childText(inPre).trim();
        return inner ? `\n${'#'.repeat(level)} ${inner}\n` : '';
    }
    if (tag === 'BLOCKQUOTE') {
        const inner = childText(inPre).trim();
        if (!inner) return '';
        return `${inner.split('\n').map((line) => `> ${line}`).join('\n')}\n`;
    }
    if (tag === 'LI') {
        const inner = childText(inPre).trim();
        return inner ? `- ${inner}\n` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
        const inner = childText(inPre).trimEnd();
        return inner ? `${inner}\n` : '';
    }
    if (tag === 'P') {
        const inner = childText(inPre).trim();
        return inner ? `${inner}\n\n` : '';
    }
    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
        const inner = childText(inPre);
        return inner ? `${inner}\n` : '';
    }
    if (tag === 'TH' || tag === 'TD') {
        return extractMarkdownTableCell(el, inPre);
    }
    if (tag === 'TR') {
        const row = tableRowToMarkdown(el, inPre);
        return row ? `${row}\n` : '';
    }
    if (tag === 'TABLE') {
        const tableMd = tableElementToMarkdown(el, inPre);
        return tableMd || '';
    }
    if (tag === 'THEAD' || tag === 'TBODY') {
        const pseudoTable = document.createElement('table');
        pseudoTable.appendChild(el.cloneNode(true));
        const tableMd = tableElementToMarkdown(pseudoTable, inPre);
        return tableMd || '';
    }

    return childText(inPre);
}

function getSelectionTextForNotes(sel) {
    const selection = sel || (window.getSelection ? window.getSelection() : null);
    if (!selection || selection.rangeCount === 0) return '';
    const parts = [];
    for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        if (!range || range.collapsed) continue;
        const frag = range.cloneContents();
        const fragmentText = extractSelectionTextFromNode(frag, false);
        if (fragmentText && fragmentText.trim()) {
            parts.push(fragmentText);
            continue;
        }
        const plain = String(range.toString() || '').trim();
        if (plain) parts.push(plain);
    }
    return normalizeSelectionTextForNotes(parts.join('\n').trim());
}

function addNoteItemFromSelection(selectionText, sourceMeta = {}) {
    const text = normalizeSelectionTextForNotes(selectionText);
    if (!text) return;
    const source = sourceMeta && sourceMeta.source ? String(sourceMeta.source) : '聊天';
    const sourceTitle = sourceMeta && sourceMeta.sourceTitle ? String(sourceMeta.sourceTitle) : '';
    const anchor = normalizeNoteAnchor(sourceMeta && sourceMeta.anchor ? sourceMeta.anchor : null);
    const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        notebookId: String(notesState.activeNotebookId || NOTES_DEFAULT_NOTEBOOK_ID),
        text,
        source,
        sourceTitle,
        anchor,
        ts: Math.floor(Date.now() / 1000)
    };
    notesState.items = [item, ...(Array.isArray(notesState.items) ? notesState.items : [])];
    saveNotesToStorage({ immediate: true });
    renderNotesList();
    showToast('已添加到笔记');
}

function getCurrentSelectionForNotes() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return { text: '', sourceMeta: null };
    const text = getSelectionTextForNotes(sel);
    if (!text) return { text: '', sourceMeta: null };
    const plainText = getSelectionPlainTextForNotes(sel);
    const node = sel.anchorNode || sel.focusNode;
    if (!isTargetInsideSelectableArea(node)) return { text: '', sourceMeta: null };
    return {
        text,
        sourceMeta: resolveSelectionSource(node, text, plainText)
    };
}

function bindStructuredCopyForSelectableArea() {
    if (!document.body || document.body.dataset.structuredCopyBound === '1') return;
    document.body.dataset.structuredCopyBound = '1';

    document.addEventListener('copy', (e) => {
        const clipboard = e && e.clipboardData;
        if (!clipboard) return;
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        const anchor = sel.anchorNode || sel.focusNode;
        if (!isTargetInsideSelectableArea(anchor) || isEditableTarget(anchor)) return;

        const text = getSelectionTextForNotes(sel);
        if (!text) return;

        e.preventDefault();
        clipboard.setData('text/plain', text);
    }, true);
}

function loadNotesMobilePanelPosition() {
    try {
        const raw = localStorage.getItem(NOTES_PANEL_LAYOUT_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            const left = Number(obj && obj.left);
            const top = Number(obj && obj.top);
            const width = Number(obj && obj.width);
            const height = Number(obj && obj.height);
            if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)) {
                return { left, top, width, height };
            }
        }
    } catch (_) {
        // ignore
    }
    try {
        const rawLegacy = localStorage.getItem(NOTES_MOBILE_PANEL_POS_KEY);
        if (!rawLegacy) return null;
        const obj = JSON.parse(rawLegacy);
        const left = Number(obj && obj.left);
        const top = Number(obj && obj.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        return { left, top, width: null, height: null };
    } catch (_) {
        return null;
    }
}

function saveNotesMobilePanelPosition(left, top, width, height) {
    try {
        localStorage.setItem(NOTES_PANEL_LAYOUT_KEY, JSON.stringify({
            left: Math.round(Number(left || 0)),
            top: Math.round(Number(top || 0)),
            width: Math.round(Number(width || 0)),
            height: Math.round(Number(height || 0))
        }));
    } catch (_) {
        // ignore
    }
}

function getNotesPanelDefaultLayout(panel) {
    const p = panel || (els.notesPanel || document.getElementById('notesPanel'));
    const vw = Math.max(320, Number(window.innerWidth || 0));
    const vh = Math.max(320, Number(window.innerHeight || 0));
    const isMobile = isChatMobileLayout();
    const width = isMobile ? Math.min(380, Math.round(vw * 0.92)) : 360;
    const height = isMobile ? Math.min(520, Math.round(vh * 0.56)) : Math.min(560, Math.round(vh * 0.62));
    const top = isMobile ? Math.max(8, 62 + (window.visualViewport ? Math.max(0, window.visualViewport.offsetTop || 0) : 0)) : 78;
    const left = Math.max(8, vw - width - (isMobile ? 8 : 20));
    return {
        left,
        top,
        width: width || (p ? p.offsetWidth : 320) || 320,
        height: height || (p ? p.offsetHeight : 420) || 420
    };
}

function clampNotesMobilePanelPosition(left, top, panel, widthOverride, heightOverride) {
    const p = panel || (els.notesPanel || document.getElementById('notesPanel'));
    const d = getNotesPanelDefaultLayout(p);
    const vw = Math.max(320, Number(window.innerWidth || 0));
    const vh = Math.max(320, Number(window.innerHeight || 0));
    const margin = 8;
    const minWidth = isChatMobileLayout() ? 240 : 280;
    const minHeight = 220;
    const maxWidth = Math.max(minWidth, vw - margin * 2);
    const maxHeight = Math.max(minHeight, vh - margin * 2);

    const widthRaw = Number(widthOverride != null ? widthOverride : (notesMobilePanelState.width != null ? notesMobilePanelState.width : d.width));
    const heightRaw = Number(heightOverride != null ? heightOverride : (notesMobilePanelState.height != null ? notesMobilePanelState.height : d.height));
    const width = Math.max(minWidth, Math.min(maxWidth, Number.isFinite(widthRaw) ? widthRaw : d.width));
    const height = Math.max(minHeight, Math.min(maxHeight, Number.isFinite(heightRaw) ? heightRaw : d.height));

    const maxLeft = Math.max(margin, vw - width - margin);
    const maxTop = Math.max(margin, vh - height - margin);
    const safeLeft = Math.max(margin, Math.min(maxLeft, Number.isFinite(Number(left)) ? Number(left) : d.left));
    const safeTop = Math.max(margin, Math.min(maxTop, Number.isFinite(Number(top)) ? Number(top) : d.top));
    return { left: safeLeft, top: safeTop, width, height };
}

function applyNotesMobilePanelPosition(options = {}) {
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    const forceDefault = !!(options && options.forceDefault);
    if (forceDefault || notesMobilePanelState.left == null || notesMobilePanelState.top == null || notesMobilePanelState.width == null || notesMobilePanelState.height == null) {
        const saved = !forceDefault ? loadNotesMobilePanelPosition() : null;
        if (saved) {
            notesMobilePanelState.left = Number(saved.left);
            notesMobilePanelState.top = Number(saved.top);
            notesMobilePanelState.width = Number(saved.width);
            notesMobilePanelState.height = Number(saved.height);
        } else {
            const d = getNotesPanelDefaultLayout(panel);
            notesMobilePanelState.left = d.left;
            notesMobilePanelState.top = d.top;
            notesMobilePanelState.width = d.width;
            notesMobilePanelState.height = d.height;
        }
    }

    const rect = clampNotesMobilePanelPosition(
        notesMobilePanelState.left,
        notesMobilePanelState.top,
        panel,
        notesMobilePanelState.width,
        notesMobilePanelState.height
    );
    notesMobilePanelState.left = rect.left;
    notesMobilePanelState.top = rect.top;
    notesMobilePanelState.width = rect.width;
    notesMobilePanelState.height = rect.height;

    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}

function bindNotesPanelMobileDrag() {
    if (notesMobilePanelState.bound) return;
    notesMobilePanelState.bound = true;
    const panel = els.notesPanel || document.getElementById('notesPanel');
    const head = (els.notesPanelHead || document.querySelector('#notesPanel .notes-panel-head'));
    const resizeHandle = els.notesResizeHandle || document.getElementById('notesResizeHandle');
    if (!panel || !head) return;
    bindFloatingPanelFront(panel);

    const stopInteract = () => {
        if (!notesMobilePanelState.dragging && !notesMobilePanelState.resizing) return;
        notesMobilePanelState.dragging = false;
        notesMobilePanelState.resizing = false;
        notesMobilePanelState.pointerId = null;
        saveNotesMobilePanelPosition(
            notesMobilePanelState.left,
            notesMobilePanelState.top,
            notesMobilePanelState.width,
            notesMobilePanelState.height
        );
        panel.classList.remove('dragging');
        panel.classList.remove('resizing');
    };

    const onMove = (e) => {
        if (!notesMobilePanelState.dragging && !notesMobilePanelState.resizing) return;
        if (notesMobilePanelState.pointerId != null && e.pointerId !== notesMobilePanelState.pointerId) return;
        const dx = Number(e.clientX || 0) - notesMobilePanelState.startClientX;
        const dy = Number(e.clientY || 0) - notesMobilePanelState.startClientY;

        if (notesMobilePanelState.dragging) {
            const next = clampNotesMobilePanelPosition(
                notesMobilePanelState.startLeft + dx,
                notesMobilePanelState.startTop + dy,
                panel,
                notesMobilePanelState.width,
                notesMobilePanelState.height
            );
            notesMobilePanelState.left = next.left;
            notesMobilePanelState.top = next.top;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            return;
        }

        if (notesMobilePanelState.resizing) {
            const next = clampNotesMobilePanelPosition(
                notesMobilePanelState.left,
                notesMobilePanelState.top,
                panel,
                notesMobilePanelState.startWidth + dx,
                notesMobilePanelState.startHeight + dy
            );
            notesMobilePanelState.width = next.width;
            notesMobilePanelState.height = next.height;
            notesMobilePanelState.left = next.left;
            notesMobilePanelState.top = next.top;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.width = `${next.width}px`;
            panel.style.height = `${next.height}px`;
        }
    };

    head.addEventListener('pointerdown', (e) => {
        const t = e.target;
        if (t && t.closest('button, a, input, select, textarea, label')) return;
        if (!notesState.open) return;
        bringFloatingPanelToFront(panel);
        notesMobilePanelState.dragging = true;
        notesMobilePanelState.resizing = false;
        notesMobilePanelState.pointerId = e.pointerId;
        notesMobilePanelState.startClientX = Number(e.clientX || 0);
        notesMobilePanelState.startClientY = Number(e.clientY || 0);
        const rect = panel.getBoundingClientRect();
        notesMobilePanelState.startLeft = Number(rect.left || 0);
        notesMobilePanelState.startTop = Number(rect.top || 0);
        panel.classList.add('dragging');
        e.preventDefault();
    });

    if (resizeHandle) {
        resizeHandle.addEventListener('pointerdown', (e) => {
            if (!notesState.open) return;
            notesMobilePanelState.dragging = false;
            notesMobilePanelState.resizing = true;
            notesMobilePanelState.pointerId = e.pointerId;
            notesMobilePanelState.startClientX = Number(e.clientX || 0);
            notesMobilePanelState.startClientY = Number(e.clientY || 0);
            const rect = panel.getBoundingClientRect();
            notesMobilePanelState.startWidth = Number(rect.width || 0);
            notesMobilePanelState.startHeight = Number(rect.height || 0);
            notesMobilePanelState.left = Number(rect.left || 0);
            notesMobilePanelState.top = Number(rect.top || 0);
            panel.classList.add('resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', stopInteract);
    window.addEventListener('pointercancel', stopInteract);
}

function setMobileSelectionAddVisible(visible) {
    const bar = els.mobileSelectionActionsBar || document.getElementById('mobileSelectionActionsBar');
    const addBtn = els.mobileSelectionAddBtn || document.getElementById('mobileSelectionAddBtn');
    const target = bar || addBtn;
    if (!target) return;
    if (isChatMobileLayout() && visible) {
        target.classList.add('active');
        target.setAttribute('aria-hidden', 'false');
    } else {
        target.classList.remove('active');
        target.setAttribute('aria-hidden', 'true');
    }
}

function resetMobileSelectionScrollGuard() {
    if (mobileSelectionScrollGuard.restoreRaf) {
        cancelAnimationFrame(mobileSelectionScrollGuard.restoreRaf);
    }
    mobileSelectionScrollGuard.tracking = false;
    mobileSelectionScrollGuard.startX = 0;
    mobileSelectionScrollGuard.startY = 0;
    mobileSelectionScrollGuard.locked = false;
    mobileSelectionScrollGuard.stabilizeStart = false;
    mobileSelectionScrollGuard.snapshotRange = null;
    mobileSelectionScrollGuard.restoreRaf = 0;
    mobileSelectionScrollGuard.sourceContainer = null;
}

function stopMobileSelectionScrollTracking() {
    if (mobileSelectionScrollGuard.restoreRaf) {
        cancelAnimationFrame(mobileSelectionScrollGuard.restoreRaf);
    }
    mobileSelectionScrollGuard.tracking = false;
    mobileSelectionScrollGuard.startX = 0;
    mobileSelectionScrollGuard.startY = 0;
    mobileSelectionScrollGuard.restoreRaf = 0;
    mobileSelectionScrollGuard.stabilizeStart = false;
    if (!isChatMobileLayout()) return;
    const hasSelection = captureActiveSelectionForMobileScrollLock();
    if (!hasSelection) {
        mobileSelectionScrollGuard.locked = false;
        mobileSelectionScrollGuard.snapshotRange = null;
        mobileSelectionScrollGuard.sourceContainer = null;
    }
}

function isSelectionNodeInsideContainer(node, container) {
    if (!node || !container) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!(el && typeof container.contains === 'function' && container.contains(el));
}

function captureActiveSelectionForMobileScrollLock() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) return false;
    try {
        const range = sel.getRangeAt(0);
        if (!range || range.collapsed) return false;
        const startNode = range.startContainer || sel.anchorNode || sel.focusNode;
        const endNode = range.endContainer || sel.focusNode || sel.anchorNode;
        const insideStart = isTargetInsideSelectableArea(startNode);
        const insideEnd = isTargetInsideSelectableArea(endNode);
        if (!insideStart && !insideEnd) return false;
        if (isEditableTarget(startNode) || isEditableTarget(endNode)) return false;
        mobileSelectionScrollGuard.snapshotRange = range.cloneRange();
        const startEl = startNode && startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode;
        const endEl = endNode && endNode.nodeType === Node.TEXT_NODE ? endNode.parentElement : endNode;
        const startContainer = startEl && startEl.closest ? startEl.closest('#messagesContainer, #knowledgeViewer') : null;
        const endContainer = endEl && endEl.closest ? endEl.closest('#messagesContainer, #knowledgeViewer') : null;
        mobileSelectionScrollGuard.sourceContainer = startContainer || endContainer || null;
        mobileSelectionScrollGuard.locked = true;
        return true;
    } catch (_) {
        mobileSelectionScrollGuard.snapshotRange = null;
        mobileSelectionScrollGuard.sourceContainer = null;
        mobileSelectionScrollGuard.locked = false;
        return false;
    }
}

function clampSelectionStartToLockedRange() {
    // 根据需求：不再使用 JS 对选区进行纠偏，避免和系统原生选区行为冲突。
    return false;
}

function keepSelectionStableOnMobileScroll(touch) {
    // 根据需求：不再使用 JS 干预选区。
    void touch;
}

function updateMobileSelectionQuickAdd() {
    if (!isChatMobileLayout()) {
        setMobileSelectionAddVisible(false);
        return;
    }

    // Fast path: on scroll we call this very frequently.
    // Avoid cloning selection DOM unless there is an expanded selection
    // inside chat/knowledge area.
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) {
        setMobileSelectionAddVisible(false);
        return;
    }
    const anchor = sel.anchorNode || sel.focusNode;
    if (!isTargetInsideSelectableArea(anchor) || isEditableTarget(anchor)) {
        setMobileSelectionAddVisible(false);
        return;
    }

    const text = getSelectionTextForNotes(sel);
    if (text) {
        const plainText = getSelectionPlainTextForNotes(sel);
        notesState.pendingSelectionText = text;
        notesState.pendingSelectionSource = resolveSelectionSource(anchor, text, plainText);
        setMobileSelectionAddVisible(true);
        return;
    }
    setMobileSelectionAddVisible(false);
}

function bindNotesContextCapture() {
    if (document.body && document.body.dataset.notesCtxBind === '1') return;
    if (document.body) document.body.dataset.notesCtxBind = '1';

    document.addEventListener('contextmenu', (e) => {
        if (isChatMobileLayout()) {
            hideNotesContextMenu();
            return;
        }
        const target = e.target;
        if (!isTargetInsideSelectableArea(target) || isEditableTarget(target)) {
            hideNotesContextMenu();
            return;
        }
        const sel = window.getSelection ? window.getSelection() : null;
        const text = getSelectionTextForNotes(sel);
        if (!text) {
            hideNotesContextMenu();
            return;
        }
        e.preventDefault();
        const plainText = getSelectionPlainTextForNotes(sel);
        const sourceMeta = resolveSelectionSource(target, text, plainText);
        showNotesContextMenu(Number(e.clientX || 0), Number(e.clientY || 0), text, sourceMeta);
    });

    document.addEventListener('click', (e) => {
        const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
        if (!menu) return;
        if (menu.contains(e.target)) return;
        hideNotesContextMenu();
        updateMobileSelectionQuickAdd();
    }, true);

    let notesCtxScrollRaf = null;
    document.addEventListener('scroll', () => {
        const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
        const needsMenuClose = !!(menu && menu.classList && menu.classList.contains('active'));
        const needsMobileQuickAddUpdate = isChatMobileLayout();
        const needsMobileSelectionClamp = !!(needsMobileQuickAddUpdate && mobileSelectionScrollGuard.locked);
        if (!needsMenuClose && !needsMobileQuickAddUpdate && !needsMobileSelectionClamp) return;
        if (notesCtxScrollRaf) return;
        notesCtxScrollRaf = requestAnimationFrame(() => {
            notesCtxScrollRaf = null;
            if (needsMenuClose) hideNotesContextMenu();
            if (needsMobileSelectionClamp) clampSelectionStartToLockedRange();
            if (needsMobileQuickAddUpdate) updateMobileSelectionQuickAdd();
        });
    }, true);
    document.addEventListener('selectionchange', () => {
        const cur = getCurrentSelectionForNotes();
        if (cur.text) {
            notesState.pendingSelectionText = cur.text;
            notesState.pendingSelectionSource = cur.sourceMeta;
            if (isChatMobileLayout() && !mobileSelectionScrollGuard.tracking) {
                captureActiveSelectionForMobileScrollLock();
            }
            if (isChatMobileLayout() && mobileSelectionScrollGuard.stabilizeStart) {
                clampSelectionStartToLockedRange();
            }
        } else if (isChatMobileLayout() && !mobileSelectionScrollGuard.tracking) {
            mobileSelectionScrollGuard.locked = false;
            mobileSelectionScrollGuard.stabilizeStart = false;
            mobileSelectionScrollGuard.snapshotRange = null;
            mobileSelectionScrollGuard.sourceContainer = null;
        }
        updateMobileSelectionQuickAdd();
    });
    document.addEventListener('touchstart', (e) => {
        if (!isChatMobileLayout()) return;
        const touch = (e.touches && e.touches[0]) ? e.touches[0] : null;
        if (!touch) return;
        const hasSelection = captureActiveSelectionForMobileScrollLock();
        if (!hasSelection) {
            resetMobileSelectionScrollGuard();
            return;
        }
        mobileSelectionScrollGuard.tracking = true;
        mobileSelectionScrollGuard.startX = Number(touch.clientX || 0);
        mobileSelectionScrollGuard.startY = Number(touch.clientY || 0);
    }, true);
    document.addEventListener('touchmove', (e) => {
        if (!isChatMobileLayout()) return;
        const touch = (e.touches && e.touches[0]) ? e.touches[0] : null;
        keepSelectionStableOnMobileScroll(touch);
    }, true);
    document.addEventListener('touchend', () => {
        if (!isChatMobileLayout()) return;
        setTimeout(() => updateMobileSelectionQuickAdd(), 60);
        stopMobileSelectionScrollTracking();
    }, true);
    document.addEventListener('touchcancel', () => {
        if (!isChatMobileLayout()) return;
        stopMobileSelectionScrollTracking();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideNotesContextMenu();
            if (!NOTES_COMPANION_MODE && notesState.open) closeNotesPanel();
            if (timelineState.open) closeTimelinePanel();
        }
    });
}

function initNotesUi() {
    void hydrateNotesState();
    bindNotesPanelMobileDrag();
    if (els.closeNotesPanelBtn) {
        els.closeNotesPanelBtn.addEventListener('click', () => closeNotesPanel());
    }
    if (els.closeTimelinePanelBtn) {
        els.closeTimelinePanelBtn.addEventListener('click', () => closeTimelinePanel());
    }
    if (els.openNotesCompanionBtn) {
        if (NOTES_COMPANION_MODE) {
            els.openNotesCompanionBtn.style.display = 'none';
        } else {
            els.openNotesCompanionBtn.style.display = '';
            els.openNotesCompanionBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const ok = await openNotesCompanionWindow();
                if (!ok) {
                    showToast('独立笔记窗口暂不可用，已切换到页面内笔记');
                    openNotesPanel();
                }
            });
        }
    }
    if (els.notesNotebookSelect) {
        els.notesNotebookSelect.addEventListener('change', (e) => {
            const nextId = String(e.target.value || '').trim();
            if (!nextId) return;
            notesState.activeNotebookId = nextId;
            saveNotesToStorage();
            renderNotesList();
        });
    }
    if (els.createNotebookBtn) {
        els.createNotebookBtn.addEventListener('click', () => createNotebook());
    }
    if (els.clearNotebookBtn) {
        els.clearNotebookBtn.addEventListener('click', () => clearActiveNotebook());
    }
    if (els.deleteNotebookBtn) {
        els.deleteNotebookBtn.addEventListener('click', () => deleteActiveNotebook());
    }
    if (els.downloadNotebookBtn) {
        els.downloadNotebookBtn.addEventListener('click', () => downloadActiveNotebook());
    }
    if (els.notesAddSelectionBtn) {
        els.notesAddSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const text = notesState.pendingSelectionText || '';
            const sourceMeta = notesState.pendingSelectionSource || {};
            hideNotesContextMenu();
            if (!text) return;
            addNoteItemFromSelection(text, sourceMeta);
            if (!notesState.open) {
                if (canOpenNotesCompanionWindow()) {
                    void openNotesCompanionWindow();
                } else {
                    openNotesPanel();
                }
            }
        });
    }
    if (els.notesCopySelectionBtn) {
        els.notesCopySelectionBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const text = notesState.pendingSelectionText || '';
            hideNotesContextMenu();
            if (!text) {
                showToast('请先选中文本');
                return;
            }
            try {
                await copyTextToClipboardSafe(text);
                showToast('已复制选中文本');
            } catch (_) {
                showToast('复制失败');
            }
        });
    }
    if (els.notesExplainSelectionBtn) {
        els.notesExplainSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const text = notesState.pendingSelectionText || '';
            hideNotesContextMenu();
            if (!text) {
                showToast('请先选中文本');
                return;
            }
            const ok = fillMessageInputWithExplainText(text);
            showToast(ok ? '已填入解释指令' : '输入框不可用');
        });
    }
    const resolveMobileSelectionPayload = () => {
        const cur = getCurrentSelectionForNotes();
        return {
            text: cur.text || notesState.pendingSelectionText || '',
            sourceMeta: cur.sourceMeta || notesState.pendingSelectionSource || {}
        };
    };
    if (els.mobileSelectionAddBtn) {
        els.mobileSelectionAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const { text, sourceMeta } = resolveMobileSelectionPayload();
            if (!text) {
                showToast('请先选中文本');
                setMobileSelectionAddVisible(false);
                return;
            }
            addNoteItemFromSelection(text, sourceMeta);
            setMobileSelectionAddVisible(false);
        });
    }
    if (els.mobileSelectionCopyBtn) {
        els.mobileSelectionCopyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const { text } = resolveMobileSelectionPayload();
            if (!text) {
                showToast('请先选中文本');
                setMobileSelectionAddVisible(false);
                return;
            }
            try {
                await copyTextToClipboardSafe(text);
                showToast('已复制选中文本');
            } catch (_) {
                showToast('复制失败');
            }
            setMobileSelectionAddVisible(false);
        });
    }
    if (els.mobileSelectionExplainBtn) {
        els.mobileSelectionExplainBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const { text } = resolveMobileSelectionPayload();
            if (!text) {
                showToast('请先选中文本');
                setMobileSelectionAddVisible(false);
                return;
            }
            const ok = fillMessageInputWithExplainText(text);
            showToast(ok ? '已填入解释指令' : '输入框不可用');
            setMobileSelectionAddVisible(false);
        });
    }
    bindNotesContextCapture();
    updateMobileSelectionQuickAdd();
    renderNotesList();
    if (NOTES_COMPANION_MODE) {
        if (document.body) document.body.classList.add('notes-companion-mode');
        if (els.closeNotesPanelBtn) els.closeNotesPanelBtn.style.display = 'none';
        openNotesPanel();
    }
    if (SETTINGS_COMPANION_MODE) {
        if (document.body) document.body.classList.add('settings-companion-mode');
        void openSettingsModal();
        const syncBounds = () => {
            try {
                const api = window.pywebview && window.pywebview.api;
                if (!api || !api.set_settings_window_bounds) return;
                const w = Number(window.outerWidth || window.innerWidth || 0);
                const h = Number(window.outerHeight || window.innerHeight || 0);
                api.set_settings_window_bounds(w, h);
            } catch (_) {
                // ignore
            }
        };
        let settingsBoundsTimer = null;
        window.addEventListener('resize', () => {
            if (settingsBoundsTimer) clearTimeout(settingsBoundsTimer);
            settingsBoundsTimer = setTimeout(() => {
                settingsBoundsTimer = null;
                syncBounds();
            }, 180);
        });
        syncBounds();
    }
}

export {
    NOTES_COMPANION_MODE,
    appendDebugTraceChunk,
    applyNotesMobilePanelPosition,
    bindConversationRenameModal,
    bindPinContextMenu,
    bindSourceMarkdown,
    bindStructuredCopyForSelectableArea,
    bindTrashModal,
    buildNoteAnchorSnippet,
    canOpenNotesCompanionWindow,
    captureActiveSelectionForMobileScrollLock,
    closeConversationRenameModal,
    consumeForceContextCompressionOnce,
    contentContainsSnippetLoose,
    ensureAuthenticatedSession,
    fetchKnowledgeByTitle,
    fillMessageInputWithExplainText,
    flushNotesCloudSync,
    forceContextCompressionOnce,
    getConversationTitleFromCache,
    hideNotesContextMenu,
    hidePinContextMenu,
    highlightMessageForNoteJump,
    initNotesUi,
    installAuthFetchGuard,
    jumpToChatSource,
    jumpToKnowledgeSource,
    keepSelectionStableOnMobileScroll,
    mobileSelectionScrollGuard,
    normalizeKnowledgeTitleKey,
    normalizeSelectionTextForNotes,
    notesCloudSyncPendingStore,
    notesCloudSyncTimer,
    notesJumpHighlightTimer,
    notesState,
    openConversationRenameModal,
    openNotesCompanionWindow,
    openTrashModal,
    renderNotesBadge,
    requestLogoutAndRedirect,
    resolveKnowledgeSourceForJump,
    setBasisPinLocal,
    setConversationPinLocal,
    setConversationPinned,
    setConversationTitle,
    setConversationTitleLocal,
    setForceContextCompressionOnce,
    showNotesContextMenu,
    showPinContextMenu,
    stopMobileSelectionScrollTracking,
    submitConversationRename,
    syncNotesForConversation,
    updateMobileSelectionQuickAdd,
};
