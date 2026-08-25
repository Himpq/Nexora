/**
 * chat_wss_sync.js — 浏览器 WSS 连接/重连/HTTP 轮询兜底
 *
 * 职责：浏览器 WSS 连接/重连/HTTP 轮询兜底；从 chat.js 批量迁移。
 * 共享可变状态通过 window.xxx live-binding 读写（exposeLiveState 桥接）。
 *
 * 对外 window 桥接清单：
 *   - 无
 *
 * 依赖 store 子域：
 *   - store.stream
 *
 * 设计形态：class BrowserSyncController（有状态域）
 */
import { store } from './store/index.js';
import {
    _syncTurnIndicatorVisibility,

    els,
    isLearningReaderHostActive,
    learningEmbedLayoutMode,
    learningNavigationState,
    loadCloudFiles,
    loadKnowledge,
    setDesktopAgentIndicatorState,
} from './chat.js?v=20260819_toast_unify_01';
import {
    clearBrowserSyncTimers,
    getBrowserOllamaProviderKeys,
    getBrowserSyncWsUrl,
    handleBrowserSyncMessage,
    scheduleBrowserSyncReconnect,
    startBrowserModelConfigSyncTimer,
    startBrowserSyncPing,
    subscribeBrowserOllamaStatus,
    syncBrowserCurrentConversation,
} from './chat_nexoracode.js?v=20260810_chatjs_split_01';

// === Browser WSS Sync ===
let agentStatusPollTimer = null;
let agentStatusHttpFallbackTimer = null;
let lastAgentStatusHttpOnlineAt = 0;
let browserSyncReconnectAttempts = 0;
const AGENT_STATUS_HTTP_POLL_MS = 20000;
const AGENT_STATUS_WS_FRESH_MS = 90000;
const BROWSER_SYNC_RECONNECT_MAX_MS = 60000;

// HTTP 轮询兜底：本地代理（NexoraCode iframe）无法升级 /ws/browser 到 WebSocket，
// 状态通道恒失败，此处用普通 GET /api/agent/status 同步本地节点在线状态
function startAgentStatusHttpFallback() {
    if (agentStatusHttpFallbackTimer) return;

    const poll = async () => {
        const wsOpen = !!(window.browserSyncSocket && window.browserSyncSocket.readyState === WebSocket.OPEN);
        const wsFresh = (Date.now() - window.lastAgentStatusWsReceivedAt) < AGENT_STATUS_WS_FRESH_MS;

        // WSS 正常推送时以 WSS 为准，不重复请求
        if (wsOpen && wsFresh) return;

        try {
            const res = await fetch('/api/agent/status', { credentials: 'include' });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data && typeof data.online === 'boolean') {
                if (data.online) {
                    lastAgentStatusHttpOnlineAt = Date.now();
                }

                setDesktopAgentIndicatorState(!!data.online, wsOpen ? '' : ' (HTTP)');
            }
        } catch (_) {
            // 网络失败时保持现状，等待下一轮
        }
    };

    void poll();
    agentStatusHttpFallbackTimer = setInterval(() => { void poll(); }, AGENT_STATUS_HTTP_POLL_MS);
}

function stopAgentStatusHttpFallback() {
    if (agentStatusHttpFallbackTimer) {
        clearInterval(agentStatusHttpFallbackTimer);
        agentStatusHttpFallbackTimer = null;
    }
}

function startAgentStatusPolling() {
    if (window.browserSyncSocket && (
        window.browserSyncSocket.readyState === WebSocket.CONNECTING ||
        window.browserSyncSocket.readyState === WebSocket.OPEN
    )) return;

    window.browserSyncManuallyClosed = false;
    clearBrowserSyncTimers();

    const socketSerial = ++window.browserSyncSocketSerial;
    let socket = null;

    try {
        socket = new WebSocket(getBrowserSyncWsUrl());
        window.browserSyncSocket = socket;
    } catch (e) {
        setDesktopAgentIndicatorState(false, ' (状态通道启动失败)');
        scheduleBrowserSyncReconnect();
        return;
    }

    socket.addEventListener('open', () => {
        if (socket !== window.browserSyncSocket || socketSerial !== window.browserSyncSocketSerial) return;

        browserSyncReconnectAttempts = 0;
        syncBrowserCurrentConversation();
        startBrowserSyncPing();
        startBrowserModelConfigSyncTimer();
        subscribeBrowserOllamaStatus(window.browserOllamaStatusProviders.length ? window.browserOllamaStatusProviders : getBrowserOllamaProviderKeys());
    });

    socket.addEventListener('message', (event) => {
        if (socket !== window.browserSyncSocket || socketSerial !== window.browserSyncSocketSerial) return;

        try {
            handleBrowserSyncMessage(JSON.parse(event.data || '{}'));
        } catch (e) {
            console.warn('[Browser WSS] message handling failed', e);
        }
    });

    socket.addEventListener('close', () => {
        if (socket !== window.browserSyncSocket || socketSerial !== window.browserSyncSocketSerial) return;

        window.browserSyncSocket = null;
        clearBrowserSyncTimers();
        // 本地代理环境无法建立 WSS，此处不强制置离线，
        // 若 HTTP 兜底近期已确认在线则保留在线状态，避免指示点与项目 UI 闪烁
        if ((Date.now() - lastAgentStatusHttpOnlineAt) >= AGENT_STATUS_WS_FRESH_MS) {
            setDesktopAgentIndicatorState(false, ' (状态通道断开)');
        }
        scheduleBrowserSyncReconnect();
    });

    socket.addEventListener('error', () => {
        if (socket !== window.browserSyncSocket || socketSerial !== window.browserSyncSocketSerial) return;

        if ((Date.now() - lastAgentStatusHttpOnlineAt) >= AGENT_STATUS_WS_FRESH_MS) {
            setDesktopAgentIndicatorState(false, ' (状态通道异常)');
        }
    });
}

function stopBrowserSyncSocket() {
    window.browserSyncManuallyClosed = true;
    clearBrowserSyncTimers();
    stopAgentStatusHttpFallback();

    if (agentStatusPollTimer) {
        clearInterval(agentStatusPollTimer);
        agentStatusPollTimer = null;
    }

    if (window.browserSyncSocket) {
        window.browserSyncSocket.close();
        window.browserSyncSocket = null;
    }

    window.browserSyncSocketSerial += 1;
}

let rightSidebarLastInteractionTarget = null;

document.addEventListener('pointerdown', (event) => {
    rightSidebarLastInteractionTarget = event && event.target ? event.target : null;
}, true);

document.addEventListener('click', (event) => {
    rightSidebarLastInteractionTarget = event && event.target ? event.target : rightSidebarLastInteractionTarget;
}, true);

function describeRightSidebarDebugTarget(target = null) {
    const node = target || rightSidebarLastInteractionTarget;
    if (!node || !(node instanceof Element)) return '';
    const id = node.id ? `#${node.id}` : '';
    const cls = String(node.className || '').trim().replace(/\s+/g, '.');
    const classText = cls ? `.${cls}` : '';
    return `${String(node.tagName || '').toLowerCase()}${id}${classText}`;
}

function logRightSidebarPanelDebug(action, details = {}) {
    try {
        const err = new Error();
        console.warn('[RightSidebar]', action, {
            ...details,
            learningReaderOpened: learningNavigationState.isReaderOpened(),
            learningReaderSuspended: learningNavigationState.isReaderSuspended(),
            learningEmbedLayoutMode: String(learningEmbedLayoutMode || ''),
            bodyClass: document.body ? String(document.body.className || '') : '',
            target: describeRightSidebarDebugTarget(),
            stack: err && err.stack ? String(err.stack) : '',
        });
    } catch (_err) {}
}

// Reader 沉浸态必须立即清空宿主右侧栏，避免目录面板打开时抢占宿主布局。
function hideRightSidebarPanelImmediately(panel) {
    const p = panel || null;

    if (!p) return;

    if (p.__panelAnimTimer) {
        clearTimeout(p.__panelAnimTimer);
        p.__panelAnimTimer = null;
    }

    p.__panelVisibleTarget = false;
    p.classList.remove('visible');
    p.classList.remove('panel-animating');
}

function setRightSidebarPanelVisible(panel, visible) {
    const p = panel || null;

    if (!p) return;

    const show = !!visible && !isLearningReaderRightSidebarLocked();

    if (visible && !show) {
        logRightSidebarPanelDebug('blocked-show', {
            panelId: p.id || '',
            reason: 'learning_reader_or_immersive',
        });
        hideRightSidebarPanelImmediately(p);
        return;
    }

    if (!show && isLearningReaderRightSidebarLocked()) {
        hideRightSidebarPanelImmediately(p);
        return;
    }

    if (p.__panelAnimTimer) {
        clearTimeout(p.__panelAnimTimer);
        p.__panelAnimTimer = null;
    }
    p.__panelVisibleTarget = show;
    p.classList.add('panel-animating');
    requestAnimationFrame(() => {
        if (p.__panelVisibleTarget !== show) return;
        if (show) {
            logRightSidebarPanelDebug('show', {
                panelId: p.id || '',
            });
            p.classList.add('visible');
        } else {
            p.classList.remove('visible');
        }
    });
    p.__panelAnimTimer = setTimeout(() => {
        p.classList.remove('panel-animating');
        p.__panelAnimTimer = null;
    }, 280);
}

function closeKnowledgePanel(options = {}) {
    const immediate = !!(options && options.immediate);

    if (!els.knowledgePanel) return;

    if (immediate) {
        hideRightSidebarPanelImmediately(els.knowledgePanel);
        _syncTurnIndicatorVisibility();
        return;
    }

    setRightSidebarPanelVisible(els.knowledgePanel, false);
    _syncTurnIndicatorVisibility();
}

function isLearningReaderClassActive() {
    return !!(
        document.body
        && document.body.classList.contains('learning-reader-active')
    );
}

function isLearningReaderRightSidebarLocked() {
    // Learning 主面板也会使用 immersive 承载布局，右侧栏只在真实阅读器状态下锁定。
    return !!(
        isLearningReaderHostActive()
        || isLearningReaderClassActive()
    );
}

function closeReaderBlockedRightSidebars() {
    closeKnowledgePanel({ immediate: true });
    closeCloudFilePanel({ immediate: true });
}

function openKnowledgePanel() {
    if (!els.knowledgePanel) return;
    if (isLearningReaderRightSidebarLocked()) {
        logRightSidebarPanelDebug('blocked-open-knowledge', {
            reason: 'learning_reader_or_immersive',
        });
        closeKnowledgePanel();
        return;
    }
    if (els.filePanel) setRightSidebarPanelVisible(els.filePanel, false);
    setRightSidebarPanelVisible(els.knowledgePanel, true);
    _syncTurnIndicatorVisibility();
    void loadKnowledge(currentConversationId);
}

function toggleKnowledgePanel() {
    if (!els.knowledgePanel) return;
    if (isLearningReaderRightSidebarLocked()) {
        logRightSidebarPanelDebug('blocked-toggle-knowledge', {
            reason: 'learning_reader_or_immersive',
        });
        closeKnowledgePanel();
        return;
    }
    const nextVisible = !els.knowledgePanel.classList.contains('visible');
    if (nextVisible) openKnowledgePanel();
    else closeKnowledgePanel();
}

function isKnowledgeViewerOpen() {
    const viewer = document.getElementById('knowledgeViewer');
    if (!viewer) return false;

    // knowledgeViewer 的显示开关由 style.display 驱动，直接读取源状态，避免布局属性误判。
    return String(viewer.style.display || '').trim().toLowerCase() !== 'none';
}

function isKnowledgePanelOpen() {
    const panel = document.getElementById('knowledgePanel');

    if (!panel) return false;

    // 知识库侧栏占用右侧空间时，关闭 turnIndicator，避免覆盖知识库内容。
    if (typeof panel.__panelVisibleTarget === 'boolean') {
        return panel.__panelVisibleTarget;
    }

    return panel.classList.contains('visible');
}

function closeCloudFilePanel(options = {}) {
    const immediate = !!(options && options.immediate);

    if (!els.filePanel) return;

    if (immediate) {
        hideRightSidebarPanelImmediately(els.filePanel);
        return;
    }

    setRightSidebarPanelVisible(els.filePanel, false);
}

function openCloudFilePanel() {
    if (!els.filePanel) return;
    if (isLearningReaderRightSidebarLocked()) {
        logRightSidebarPanelDebug('blocked-open-file', {
            reason: 'learning_reader_or_immersive',
        });
        closeCloudFilePanel();
        return;
    }
    if (els.knowledgePanel) setRightSidebarPanelVisible(els.knowledgePanel, false);
    setRightSidebarPanelVisible(els.filePanel, true);
    loadCloudFiles();
}

function toggleCloudFilePanel() {
    if (!els.filePanel) return;
    if (isLearningReaderRightSidebarLocked()) {
        logRightSidebarPanelDebug('blocked-toggle-file', {
            reason: 'learning_reader_or_immersive',
        });
        closeCloudFilePanel();
        return;
    }
    const nextVisible = !els.filePanel.classList.contains('visible');
    if (nextVisible) openCloudFilePanel();
    else closeCloudFilePanel();
}

// ─── 命名导出（供 chat.js 过渡期 import） ───
export {
    AGENT_STATUS_HTTP_POLL_MS,
    AGENT_STATUS_WS_FRESH_MS,
    BROWSER_SYNC_RECONNECT_MAX_MS,
    agentStatusHttpFallbackTimer,
    agentStatusPollTimer,
    browserSyncReconnectAttempts,
    closeCloudFilePanel,
    closeKnowledgePanel,
    closeReaderBlockedRightSidebars,
    describeRightSidebarDebugTarget,
    hideRightSidebarPanelImmediately,
    isKnowledgePanelOpen,
    isKnowledgeViewerOpen,
    isLearningReaderClassActive,
    isLearningReaderRightSidebarLocked,
    lastAgentStatusHttpOnlineAt,
    logRightSidebarPanelDebug,
    openCloudFilePanel,
    openKnowledgePanel,
    rightSidebarLastInteractionTarget,
    setRightSidebarPanelVisible,
    startAgentStatusHttpFallback,
    startAgentStatusPolling,
    stopAgentStatusHttpFallback,
    stopBrowserSyncSocket,
    toggleCloudFilePanel,
    toggleKnowledgePanel,
};
