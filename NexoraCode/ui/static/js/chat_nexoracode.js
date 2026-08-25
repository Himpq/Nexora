/**
 * chat_nexoracode.js — NexoraCode 本地项目列表/选择/隐藏/代理在线状态
 *
 * 职责：NexoraCode 本地项目列表/选择/隐藏/代理在线状态；从 chat.js 批量迁移。
 * 共享可变状态通过 window.xxx live-binding 读写（exposeLiveState 桥接）。
 *
 * 项目列表以对话数据为唯一事实来源：对话 metadata.nexoracode_project 中携带项目，
 * 欢迎页与侧边栏 Projects 面板均从对话列表缓存提取，无需独立持久化。
 */
import { store } from './store/index.js';
import {
    BROWSER_MODEL_CONFIG_SYNC_MS,
    BROWSER_SYNC_PING_MS,
    BROWSER_SYNC_RECONNECT_MS,
    adminOllamaModelStatusCache,
    chatModelConfigSyncState,
    createNewConversation,
    currentUsername,
    enqueueClientToolWssRequest,
    getChatProviderApiType,
    getMessageElementByIndex,
    handleBrowserMailChangedEvent,
    knowledgeEditorController,
    lastAgentOnline,
    loadKnowledge,
    loadModels,
    ollamaChatProviderStatusCache,
    providerCatalogByKey,
    readMessageMemoryIoTokens,
    refreshChatOllamaStatusIndicators,
    renderAdminModelConfig,
    renderConversationList,
    renderWelcomeScreen,
    resetConversationListRenderSignature,
    setDesktopAgentIndicatorState,
    showToast,
    updateMessageModelBadge,
} from './chat.js?v=20260731_profile_center_01';
import {
    BROWSER_SYNC_RECONNECT_MAX_MS,
    browserSyncReconnectAttempts,
    startAgentStatusPolling,
} from './chat_wss_sync.js?v=20260810_chatjs_split_01';

// ===== NexoraCode 本地项目状态 =====
function getNexoraCodeProjectStorageKey() {
    const uid = String(currentUsername || '').trim();
    if (!uid) return '';
    return `nexoracode_projects:${encodeURIComponent(uid)}`;
}

function getNexoraCodeHiddenProjectStorageKey() {
    const key = getNexoraCodeProjectStorageKey();
    return key ? `${key}:hidden` : '';
}

function isNexoraCodeProjectSidebarEnabled() {
    return !!lastAgentOnline;
}

function normalizeNexoraCodeProjectRecord(project) {
    const source = (project && typeof project === 'object') ? project : {};
    const path = String(source.path || source.root || '').trim();
    const name = String(source.name || source.title || '').trim()
        || readNexoraCodeProjectNameFromPath(path);
    const projectId = String(source.project_id || source.id || path || name || '').trim();

    if (!projectId) return null;

    return {
        project_id: projectId,
        name: name || 'NexoraCode Project',
        path,
        subtitle: String(source.subtitle || path || '本地项目').trim(),
        tree_scanned_at: String(source.tree_scanned_at || '').trim()
    };
}

function readNexoraCodeProjectNameFromPath(path) {
    const text = String(path || '').trim();
    if (!text) return '';
    const parts = text.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : text;
}

// 从对话列表缓存中提取项目（与侧边栏 Projects 面板同源：对话 metadata.nexoracode_project）
function collectNexoraCodeProjectsFromConversations() {
    const cache = (typeof window !== 'undefined' && Array.isArray(window.conversationListCache))
        ? window.conversationListCache
        : [];
    const byId = new Map();

    cache.forEach((item) => {
        const source = (item && typeof item === 'object') ? item : {};
        const project = (source.nexoracode_project && typeof source.nexoracode_project === 'object')
            ? source.nexoracode_project
            : ((source.metadata && source.metadata.nexoracode_project && typeof source.metadata.nexoracode_project === 'object')
                ? source.metadata.nexoracode_project
                : null);

        if (!project) return;

        const path = String(project.path || '').trim();
        const name = String(project.name || '').trim() || readNexoraCodeProjectNameFromPath(path);
        const projectId = String(project.project_id || project.id || path || name || '').trim();

        if (!projectId) return;

        byId.set(projectId, {
            project_id: projectId,
            name: name || 'NexoraCode Project',
            path,
            subtitle: String(project.subtitle || path || '本地项目').trim(),
            tree_scanned_at: String(project.tree_scanned_at || '').trim()
        });
    });

    return Array.from(byId.values());
}

function getNexoraCodeProjects(options = {}) {
    // 项目 = 本会话显式添加 + 对话列表携带的项目（跨会话稳定存在）
    const explicit = Array.isArray(window.nexoraCodeProjectRecords) ? window.nexoraCodeProjectRecords.slice() : [];
    const conversationProjects = collectNexoraCodeProjectsFromConversations();
    const merged = new Map();

    explicit.forEach((project) => {
        if (project && project.project_id) merged.set(project.project_id, project);
    });

    conversationProjects.forEach((project) => {
        if (project && project.project_id && !merged.has(project.project_id)) {
            merged.set(project.project_id, project);
        }
    });

    const records = Array.from(merged.values());

    if (options && options.includeHidden === true) {
        return records;
    }

    return records.filter((project) => !window.nexoraCodeHiddenProjectIds.has(project.project_id));
}

function getNexoraCodeHiddenProjectIds() {
    return new Set(window.nexoraCodeHiddenProjectIds);
}

function getActiveNexoraCodeProject() {
    const activeId = String(window.activeNexoraCodeProjectId || '').trim();
    if (!activeId) return null;
    return getNexoraCodeProjects().find((project) => project.project_id === activeId) || null;
}

function setActiveNexoraCodeProject(projectId) {
    window.activeNexoraCodeProjectId = String(projectId || '').trim();
}

// 项目列表以对话数据为唯一事实来源，不单独持久化；以下兼容旧函数名，保持内存语义。
function loadNexoraCodeProjectsFromStorage() {
    return Promise.resolve(Array.isArray(window.nexoraCodeProjectRecords) ? window.nexoraCodeProjectRecords.slice() : []);
}

function persistNexoraCodeProjects() {
    // 显式项目仅存内存；对话创建时会写入 conversation metadata，跨会话自动恢复
}

function persistNexoraCodeHiddenProjectIds() {
    // 隐藏状态仅存内存
}

function ensureNexoraCodeProjectsLoaded() {
    // 无异步加载需求；项目由对话列表数据驱动
}

function upsertNexoraCodeProject(project) {
    const normalized = normalizeNexoraCodeProjectRecord(project);
    if (!normalized) return null;

    ensureNexoraCodeProjectsLoaded();
    const index = window.nexoraCodeProjectRecords.findIndex((item) => item.project_id === normalized.project_id);

    if (index >= 0) {
        window.nexoraCodeProjectRecords[index] = { ...nexoraCodeProjectRecords[index], ...normalized };
    } else {
        window.nexoraCodeProjectRecords.push(normalized);
    }

    if (window.nexoraCodeHiddenProjectIds.delete(normalized.project_id)) {
        persistNexoraCodeHiddenProjectIds();
    }

    persistNexoraCodeProjects();
    return normalized;
}

function hideNexoraCodeProject(projectId) {
    const key = String(projectId || '').trim();

    if (!key) {
        return false;
    }

    ensureNexoraCodeProjectsLoaded();
    window.nexoraCodeHiddenProjectIds.add(key);

    if (window.activeNexoraCodeProjectId === key) {
        window.activeNexoraCodeProjectId = '';
    }

    persistNexoraCodeHiddenProjectIds();
    refreshNexoraCodeProjectUi();
    return true;
}

function refreshNexoraCodeProjectUi() {
    if (typeof resetConversationListRenderSignature === 'function') {
        resetConversationListRenderSignature();
    }

    if (typeof renderConversationList === 'function') {
        renderConversationList(conversationListCache);
    }

    // 欢迎页仍在展示时同步刷新项目选择区
    if (!String(currentConversationId || '').trim()) {
        void renderWelcomeScreen();
    }
}

async function requestNexoraCodeProjectCreate() {
    ensureNexoraCodeProjectsLoaded();

    if (!isNexoraCodeProjectSidebarEnabled()) {
        showToast('NexoraCode 本地计算节点未在线');
        return null;
    }

    const path = await promptNexoraCodeProjectPath();
    if (!path) return null;

    const record = upsertNexoraCodeProject({ path });

    if (!record) {
        showToast('项目路径无效');
        return null;
    }

    showToast(`已添加项目：${record.name}（待 NexoraCode 授权扫描）`);
    setActiveNexoraCodeProject(record.project_id);
    refreshNexoraCodeProjectUi();
    return record;
}

// 统一解析桥/HTTP 端点返回的文件夹选择结果
function parseNexoraCodeFolderResult(result) {
    if (result && result.success && result.path) {
        return { path: String(result.path).trim() };
    }
    if (result && result.cancelled) {
        return { cancelled: true };
    }
    return { error: String((result && result.message) || '文件夹选择失败') };
}

// 定位 pywebview 桥：顶层 shell 直接注入；持久外壳模式下 /chat 位于同源 iframe，
// 桥挂在顶层 shell 上，可经 parent/top 访问（同源才不会抛跨源异常）
function resolveNexoraCodeDesktopBridge() {
    try {
        if (window.pywebview && window.pywebview.api) return window.pywebview.api;
    } catch (_) { /* ignore */ }

    const frameContexts = [];
    try {
        if (window.parent && window.parent !== window) frameContexts.push(window.parent);
    } catch (_) { /* 跨源 parent 访问会抛异常 */ }
    try {
        if (window.top && window.top !== window && window.top !== window.parent) frameContexts.push(window.top);
    } catch (_) { /* 跨源 top 访问会抛异常 */ }

    for (const ctx of frameContexts) {
        try {
            if (ctx.pywebview && ctx.pywebview.api) return ctx.pywebview.api;
        } catch (_) { /* 跨源桥不可读，继续尝试下一个 */ }
    }
    return null;
}

async function promptNexoraCodeProjectPath() {
    // 1) 优先 pywebview 桥（顶层 shell 或同源 iframe 的父级桥）
    const bridgeApi = resolveNexoraCodeDesktopBridge();

    if (bridgeApi && typeof bridgeApi.select_project_folder === 'function') {
        try {
            console.log('[NexoraCode] 通过 pywebview 桥打开原生文件夹选择框');
            const parsed = parseNexoraCodeFolderResult(await bridgeApi.select_project_folder());

            if (parsed.path) return parsed.path;
            if (parsed.cancelled) return '';

            console.warn('[NexoraCode] pywebview 桥返回未成功:', parsed.error);
            showToast(parsed.error);
            return '';
        } catch (err) {
            // 桥调用异常（注入不完整等）时不直接失败，转 HTTP 兜底
            console.warn('[NexoraCode] pywebview 桥调用失败，改用同源 HTTP 兜底端点', err);
        }
    } else {
        console.log('[NexoraCode] 未检测到 pywebview 桥（iframe 内属正常），改用同源 HTTP 兜底端点');
    }

    // 2) 同源 HTTP 兜底：桌面壳本地代理提供 /nc/api/select-folder，不依赖桥注入时机
    try {
        const res = await fetch('/nc/api/select-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });
        const contentType = String(res.headers.get('content-type') || '').toLowerCase();

        // 线上服务器无此路由，会返回 HTML/404；据此判定当前非本地桌面壳环境
        if (!res.ok || !contentType.includes('application/json')) {
            console.warn('[NexoraCode] HTTP 兜底端点不可用', 'status=' + res.status, 'type=' + contentType);
            showToast('请在 NexoraCode 桌面端窗口内选择项目文件夹');
            return '';
        }

        console.log('[NexoraCode] 通过同源 HTTP 端点打开原生文件夹选择框');
        const parsed = parseNexoraCodeFolderResult(await res.json());

        if (parsed.path) return parsed.path;
        if (parsed.cancelled) return '';

        console.warn('[NexoraCode] HTTP 兜底返回未成功:', parsed.error);
        showToast(parsed.error);
        return '';
    } catch (err) {
        console.warn('[NexoraCode] HTTP 兜底端点调用失败', err);
        showToast('文件夹选择失败，请确认 NexoraCode 桌面端正在运行');
        return '';
    }
}

async function requestNexoraCodeConversationCreate(project) {
    const normalized = normalizeNexoraCodeProjectRecord(project);

    if (!normalized) {
        showToast('项目信息无效');
        return;
    }

    upsertNexoraCodeProject(normalized);
    setActiveNexoraCodeProject(normalized.project_id);
    await createNewConversation(false, 'chat');
}

function getBrowserSyncWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/browser`;
}

function syncBrowserCurrentConversation() {
    if (!window.browserSyncSocket || window.browserSyncSocket.readyState !== WebSocket.OPEN) return;

    window.browserSyncSocket.send(JSON.stringify({
        type: 'subscribe_conversation',
        conversation_id: String(currentConversationId || '').trim()
    }));
}

function getBrowserModelConfigVersion(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return String(source.models_config_version || source.version || '').trim();
}

function updateBrowserModelConfigVersion(payload) {
    const version = getBrowserModelConfigVersion(payload);

    if (version) {
        chatModelConfigSyncState.version = version;
    }
}

function requestBrowserModelConfigSync() {
    if (!window.browserSyncSocket || window.browserSyncSocket.readyState !== WebSocket.OPEN) return;

    window.browserSyncSocket.send(JSON.stringify({
        type: 'sync_model_config',
        version: chatModelConfigSyncState.version || '',
        ts: Date.now()
    }));
}

function startBrowserModelConfigSyncTimer() {
    if (window.browserModelConfigSyncTimer) {
        clearInterval(window.browserModelConfigSyncTimer);
        window.browserModelConfigSyncTimer = null;
    }

    requestBrowserModelConfigSync();
    window.browserModelConfigSyncTimer = setInterval(requestBrowserModelConfigSync, BROWSER_MODEL_CONFIG_SYNC_MS);
}

function normalizeBrowserOllamaProviderKeys(providerKeys = []) {
    const rawItems = Array.isArray(providerKeys) ? providerKeys : [providerKeys];
    const seen = new Set();
    const keys = [];

    rawItems.forEach((item) => {
        const key = String(item || '').trim();

        if (!key || seen.has(key)) return;

        seen.add(key);
        keys.push(key);
    });

    return keys;
}

function getBrowserOllamaProviderKeys() {
    return Object.keys(providerCatalogByKey || {}).filter((providerKey) => {
        return getChatProviderApiType(providerKey) === 'ollama';
    });
}

function sendBrowserOllamaStatusMessage(messageType, providerKeys = [], options = {}) {
    if (!window.browserSyncSocket || window.browserSyncSocket.readyState !== WebSocket.OPEN) return;

    const providers = normalizeBrowserOllamaProviderKeys(providerKeys);

    if (!providers.length && messageType !== 'subscribe_ollama_status') return;

    window.browserSyncSocket.send(JSON.stringify({
        type: messageType,
        providers,
        force: !!(options && options.force),
        ts: Date.now()
    }));
}

function subscribeBrowserOllamaStatus(providerKeys = [], options = {}) {
    window.browserOllamaStatusProviders = normalizeBrowserOllamaProviderKeys(providerKeys);
    sendBrowserOllamaStatusMessage('subscribe_ollama_status', window.browserOllamaStatusProviders, options);
}

function syncBrowserOllamaStatus(options = {}) {
    const providers = normalizeBrowserOllamaProviderKeys(
        (options && options.providers) || window.browserOllamaStatusProviders || getBrowserOllamaProviderKeys()
    );

    sendBrowserOllamaStatusMessage('sync_ollama_status', providers, options);
}

function buildBrowserOllamaProviderStatusEntry(payload = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const byModelId = {};
    const rows = Array.isArray(data.models) ? data.models : [];

    rows.forEach((row) => {
        const modelKey = String((row && (row.id || row.model || row.name)) || '').trim().toLowerCase();

        if (!modelKey) return;

        byModelId[modelKey] = {
            ...row,
            installed: row && row.installed !== undefined ? !!row.installed : true,
            running: !!(row && row.running),
            status: String((row && row.status) || '').trim().toLowerCase() || (row && row.running ? 'running' : 'offline'),
            status_label: String((row && row.status_label) || (row && row.running ? '在线' : '不在线')),
            status_level: String((row && row.status_level) || (row && row.running ? 'success' : 'warning'))
        };
    });

    return {
        byModelId,
        raw: data,
        error: data && data.success === false ? (data.message || data.error || '加载失败') : '',
        loaded: !(data && data.success === false),
        loadedAt: Date.now(),
        revision: Number(data.revision || 0)
    };
}

function applyBrowserOllamaStatusPayload(payload = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const providerKey = String(data.provider || data.provider_key || '').trim();

    if (!providerKey) return;

    const statusEntry = buildBrowserOllamaProviderStatusEntry(data);
    ollamaChatProviderStatusCache.set(providerKey, statusEntry);

    if (typeof adminOllamaModelStatusCache !== 'undefined') {
        adminOllamaModelStatusCache[providerKey] = statusEntry;
    }
}

function handleBrowserOllamaStatusEvent(payload = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const statuses = Array.isArray(data.statuses) ? data.statuses : [data];

    statuses.forEach((item) => applyBrowserOllamaStatusPayload(item));
    refreshChatOllamaStatusIndicators();

    if (typeof renderAdminModelConfig === 'function') {
        renderAdminModelConfig();
    }
}

async function syncChatModelsFromBrowserEvent(payload = {}) {
    if (chatModelConfigSyncState.inFlight) {
        chatModelConfigSyncState.pending = true;
        return;
    }

    chatModelConfigSyncState.inFlight = true;

    try {
        const loaded = await loadModels({ forceOllamaStatus: true });

        if (loaded !== false) {
            updateBrowserModelConfigVersion(payload);
        }
    } finally {
        chatModelConfigSyncState.inFlight = false;

        if (chatModelConfigSyncState.pending) {
            chatModelConfigSyncState.pending = false;
            void syncChatModelsFromBrowserEvent({ force: true });
        }
    }
}

function handleBrowserSyncMessage(payload) {
    const msgType = String(payload && payload.type ? payload.type : '').trim();

    if (msgType === 'browser_ready') {
        if (knowledgeEditorController && typeof knowledgeEditorController.syncCurrentKnowledgeFromServer === 'function') {
            void knowledgeEditorController.syncCurrentKnowledgeFromServer('browser-ready');
        }
        return;
    }

    if (msgType === 'agent_status') {
        window.lastAgentStatusWsReceivedAt = Date.now();
        setDesktopAgentIndicatorState(!!payload.online);
        return;
    }

    if (msgType === 'mail_changed') {
        void handleBrowserMailChangedEvent(payload);
        return;
    }

    if (msgType === 'model_config_state') {
        updateBrowserModelConfigVersion(payload);
        return;
    }

    if (msgType === 'model_config_changed') {
        void syncChatModelsFromBrowserEvent(payload);
        return;
    }

    if (msgType === 'model_config_sync_error') {
        console.warn('Model config sync failed', payload && payload.message ? payload.message : payload);
        return;
    }

    if (msgType === 'ollama_status_state' || msgType === 'ollama_status_changed') {
        handleBrowserOllamaStatusEvent(payload);
        return;
    }

    if (msgType === 'knowledge_changed') {
        if (knowledgeEditorController && typeof knowledgeEditorController.handleKnowledgeChangedEvent === 'function') {
            void knowledgeEditorController.handleKnowledgeChangedEvent(payload);
        } else {
            void loadKnowledge(currentConversationId);
        }
        return;
    }

    if (msgType === 'client_tool_request') {
        enqueueClientToolWssRequest(payload.request, payload.conversation_id);
        return;
    }

    if (msgType === 'memory_analysis_completed') {
        const eventConversationId = String(payload.conversation_id || '').trim();
        const assistantIndex = Number(payload.assistant_index);

        if (
            eventConversationId
            && eventConversationId === String(currentConversationId || '').trim()
            && Number.isFinite(assistantIndex)
        ) {
            const messageDiv = getMessageElementByIndex(assistantIndex, 'assistant');
            const memoryIo = readMessageMemoryIoTokens({
                memory_io_tokens: payload.memory_io_tokens
            });

            if (messageDiv) {
                const currentState = (
                    messageDiv.__modelBadgeState
                    && typeof messageDiv.__modelBadgeState === 'object'
                ) ? messageDiv.__modelBadgeState : {};
                updateMessageModelBadge(messageDiv, {
                    ...currentState,
                    memoryInputTokens: memoryIo.input,
                    memoryOutputTokens: memoryIo.output,
                    memoryReady: memoryIo.ready
                });
            }
        }

        return;
    }

    if (msgType === 'notification_created' || msgType === 'notification_read' || msgType === 'notification_removed') {
        window.dispatchEvent(new CustomEvent('nexora:notification:wss', {
            detail: payload
        }));
    }
}

function clearBrowserSyncTimers() {
    if (window.browserSyncReconnectTimer) {
        clearTimeout(window.browserSyncReconnectTimer);
        window.browserSyncReconnectTimer = null;
    }

    if (window.browserSyncPingTimer) {
        clearInterval(window.browserSyncPingTimer);
        window.browserSyncPingTimer = null;
    }

    if (window.browserModelConfigSyncTimer) {
        clearInterval(window.browserModelConfigSyncTimer);
        window.browserModelConfigSyncTimer = null;
    }
}

function scheduleBrowserSyncReconnect() {
    if (window.browserSyncManuallyClosed || window.browserSyncReconnectTimer) return;

    // 连接持续失败（如本地代理不支持 WSS）时指数退避，避免重连风暴刷屏
    const attempts = Math.min(browserSyncReconnectAttempts, 5);
    const delay = Math.min(BROWSER_SYNC_RECONNECT_MS * Math.pow(2, attempts), BROWSER_SYNC_RECONNECT_MAX_MS);
    browserSyncReconnectAttempts += 1;

    window.browserSyncReconnectTimer = setTimeout(() => {
        window.browserSyncReconnectTimer = null;
        startAgentStatusPolling();
    }, delay);
}

function startBrowserSyncPing() {
    if (window.browserSyncPingTimer) clearInterval(window.browserSyncPingTimer);

    window.browserSyncPingTimer = setInterval(() => {
        if (!window.browserSyncSocket || window.browserSyncSocket.readyState !== WebSocket.OPEN) return;

        window.browserSyncSocket.send(JSON.stringify({
            type: 'ping',
            ts: Date.now()
        }));
    }, BROWSER_SYNC_PING_MS);
}

// ─── 命名导出（供 chat.js 过渡期 import） ───
export {
    applyBrowserOllamaStatusPayload,
    buildBrowserOllamaProviderStatusEntry,
    clearBrowserSyncTimers,
    ensureNexoraCodeProjectsLoaded,
    getActiveNexoraCodeProject,
    getBrowserModelConfigVersion,
    getBrowserOllamaProviderKeys,
    getBrowserSyncWsUrl,
    getNexoraCodeHiddenProjectIds,
    getNexoraCodeHiddenProjectStorageKey,
    getNexoraCodeProjectStorageKey,
    getNexoraCodeProjects,
    handleBrowserOllamaStatusEvent,
    handleBrowserSyncMessage,
    hideNexoraCodeProject,
    isNexoraCodeProjectSidebarEnabled,
    loadNexoraCodeProjectsFromStorage,
    normalizeBrowserOllamaProviderKeys,
    normalizeNexoraCodeProjectRecord,
    parseNexoraCodeFolderResult,
    persistNexoraCodeHiddenProjectIds,
    persistNexoraCodeProjects,
    promptNexoraCodeProjectPath,
    readNexoraCodeProjectNameFromPath,
    refreshNexoraCodeProjectUi,
    requestBrowserModelConfigSync,
    requestNexoraCodeConversationCreate,
    requestNexoraCodeProjectCreate,
    resolveNexoraCodeDesktopBridge,
    scheduleBrowserSyncReconnect,
    sendBrowserOllamaStatusMessage,
    setActiveNexoraCodeProject,
    startBrowserModelConfigSyncTimer,
    startBrowserSyncPing,
    subscribeBrowserOllamaStatus,
    syncBrowserCurrentConversation,
    syncBrowserOllamaStatus,
    syncChatModelsFromBrowserEvent,
    updateBrowserModelConfigVersion,
    upsertNexoraCodeProject,
};
