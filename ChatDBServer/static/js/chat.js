import { store } from './store/index.js';

import {
    appendExecutionFlowCount,
    appendReasoningThinkingBlock,
    applyToolExecutionFlowKind,
    basenameForExecutionFlow,
    buildChineseToolAction,
    buildFileToolRunningDisplay,
    buildReasoningAppendText,
    buildToolResultSummaryFromMarkdown,
    cleanExecutionFlowMarkdownValue,
    clipExecutionFlowText,
    createThinkingBlock,
    extractMarkdownField,
    extractMarkdownTitle,
    finishReasoningThinkingBlock,
    getExecutionFlowArgs,
    getExecutionFlowPhaseText,
    getLatestReasoningThinkingBlock,
    getPrimaryReasoningThinkingBlock,
    getToolExecutionFlowKind,
    hasReasoningThinkingBlockContent,
    hostForExecutionFlow,
    insertReasoningThinkingBlock,
    markReasoningThinkingBlockLive,
    normalizeExecutionFlowCount,
    parseExecutionFlowJson,
    parseExecutionFlowPartialJson,
    parseExecutionFlowPayload,
    readExecutionFlowArg,
    readExecutionFlowJsonStringToken,
    readExecutionFlowMarkdownCount,
    readExecutionFlowPayloadCount,
    readExecutionFlowPayloadPath,
    readExecutionFlowResultCount,
    readExecutionFlowResultText,
    readReasoningContentRaw,
    resolveReasoningThinkingBlockForAppend,
    setToolUsagePrimaryText,
    toggleThinkingBlockCollapsed,
    unescapeExecutionFlowJsonFragment,
    unwrapExecutionFlowPayload,
    updateThinkingBlockSummary,
    updateToolUsageResultSummary,
} from './chat_render.js?v=20260810_chatjs_split_01';

import {
    applyAvatarCropAndPreview,
    avatarCropState,
    bindAvatarCropCanvasEvents,
    clampAvatarCropOffset,
    closeAvatarCropModal,
    drawAvatarCropCanvas,
    drawAvatarPreviewCanvas,
    getAvatarCircleSourceRect,
    initializeAvatarCropCanvasSize,
    openAvatarCropModal,
    resetAvatarCropPosition,
} from './chat_avatar.js?v=20260810_chatjs_split_01';

import {
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
} from './chat_nexoracode.js?v=20260810_chatjs_split_01';
import {
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
} from './chat_wss_sync.js?v=20260810_chatjs_split_01';
import {
    bindWorkflowCanvasInteractions,
    copyGeneratedInfo,
    copyTextToClipboardSafe,
    copyUserMessage,
    openWorkflowDesigner,
    openWorkflowFeed,
    openWorkflowPlaceholderView,
    toggleWorkflowListGroup,
    toggleWorkflowSidebar,
} from './chat_workflow.js?v=20260810_chatjs_split_01';

import {
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
} from './chat_notes.js?v=20260810_chatjs_split_01';

import {
    DIRTY_NOT_EQUAL_PLACEHOLDER,
    INVISIBLE_TEXT_CHARS,
    INVISIBLE_TEXT_PATTERN,
    PRIVATE_USE_AREA_PATTERN,
    isBasicChineseChar,
    normalizeProviderIconFallbackSource,
    removeInvisibleTextChars,
} from './chat_input.js?v=20260810_chatjs_split_01';
import {
    bindImageViewerEvents,
    closeImageViewer,
    openImageViewer,
    resetImageViewerTransform,
    zoomImageViewer,
} from './chat_image_viewer.js?v=20260810_chatjs_split_01';

const rebuildLayoutLogger = window.NexoraLog.logger('rebuildLayout');
const turnPopupLogger = window.NexoraLog.logger('TurnPopup');
const longTaskLogger = window.NexoraLog.logger('LongTask');
const nexoraLatencyLogger = window.NexoraLog.logger('NexoraLatency');



function isLearningConversationView() {
    if (!learningModeEnabled) return false;
    return String(currentConversationMode || '').trim().toLowerCase() === 'learning'
        || String(learningHeaderMode || '').trim().toLowerCase() === 'learning';
}

function resolveNewConversationMode(targetMode = null) {
    const normalizedTarget = String(targetMode || '').trim().toLowerCase();
    if (normalizedTarget === 'learning') return learningModeEnabled ? 'learning' : 'chat';
    if (normalizedTarget === 'chat') return 'chat';
    return isLearningConversationView() ? 'learning' : 'chat';
}

// Global State
// ─── 会话核心状态已迁移至 store.conversation（单一数据源）───
// 通过 exposeLiveState 桥接为 window 访问器，文件内全部裸引用自动读写 store，
// 无需逐处改动；跨模块引用（nexora_map_renderer.js 等）同样经 window 生效
exposeLiveState('currentConversationId', () => store.conversation.get('currentId'), (v) => store.conversation.set('currentId', v));
exposeLiveState('currentAbortController', () => store.conversation.get('abortController'), (v) => store.conversation.set('abortController', v));
exposeLiveState('isGenerating', () => store.conversation.get('isGenerating'), (v) => store.conversation.set('isGenerating', v));
let lastAgentOnline = false;
// NexoraCode 本地项目（仅本地计算节点在线时可见）
let nexoraCodeProjectRecords = [];
let activeNexoraCodeProjectId = '';
let nexoraCodeProjectsLoadedForUser = null;
let nexoraCodeHiddenProjectIds = new Set();
const chatMessageWindowApi = getNexoraChatMessageWindow();
const chatMessageVersionsApi = getNexoraChatMessageVersions();
const conversationMessageWindowState = chatMessageWindowApi.state;

let shouldAutoScroll = true; // Auto-scroll control
let _isJumping = false; // Temporarily block scroll listener during jump
const MESSAGES_AUTO_SCROLL_NEAR_BOTTOM_PX = 50;
const MESSAGES_AUTO_SCROLL_BREAK_UP_PX = 0;
const CONVERSATION_INITIAL_MESSAGE_LIMIT = chatMessageWindowApi.CONVERSATION_INITIAL_MESSAGE_LIMIT;
const CONVERSATION_PREVIOUS_MESSAGE_LIMIT = chatMessageWindowApi.CONVERSATION_PREVIOUS_MESSAGE_LIMIT;
const CONVERSATION_HISTORY_LOAD_TOP_PX = 80;
let uploadedFileIds = []; // Uploaded files {id, name}
let isUploadingFiles = false;
let currentUsername = null;
let currentUserRole = 'member';
let currentUserAvatarUrl = '';
let currentUserIdentityRequest = null;
let currentUserPreferences = null;
let learningModeEnabled = false;
let learningRuntimeEnabled = true;
let learningSidebarMode = 'nexora';
const learningNavigationStateApi = window.NexoraLearningNavigationState;

if (!learningNavigationStateApi || typeof learningNavigationStateApi.create !== 'function') {
    throw new Error('NexoraLearningNavigationState 未初始化，无法启动 Learning 导航');
}

const learningNavigationState = learningNavigationStateApi.create();
exposeLiveState('currentConversationSidebarScope', () => store.conversation.get('sidebarScope'), (v) => store.conversation.set('sidebarScope', v));
let learningHeaderMode = 'chat';
let learningWelcomeMounted = false;
let learningMainMounted = false;
let learningModeAssetsPromise = null;
let learningEmbedLayoutMode = 'default';
let pendingLearningModeValue = false;
let learningModePreferenceSaving = false;
let defaultOpenViewPreferenceSaving = false;
let pendingAvatarDataUrl = '';
let adminUserTokenSelectorState = {
    users: [],
    filteredUsers: [],
    activeIndex: 0,
    visible: false,
};
let adminSystemSettingsState = null;
const ADMIN_SYSTEM_HEALTH_TIMEOUT_MS = 30000;
let adminSystemSelectedModule = 'runtime';
let adminGenImageApisCache = [];
let adminSelectedGenImageApiId = '';
let adminGenImageApiFilterKeyword = '';
let adminGenImageApiEditorState = { originalApiId: '' };
let adminPublicApiAuthState = null;
let adminPublicApiActionMode = 'generate';
let adminSelectedPublicApiKeyId = '';
let adminPublicApiModalCompleted = false;
let adminPublicApiDialogController = null;
const ADMIN_QUOTA_UNIT_STORAGE_KEY = 'chatdb.admin.quota_display_unit';
const ADMIN_QUOTA_ADJUST_MODE_STORAGE_KEY = 'chatdb.admin.quota_adjust_mode';
let adminModelConfigCache = { models: {}, providers: {} };
let adminSelectedProvider = '';
let adminModelSearchKeyword = '';
let adminQuotaDefaultOverageAction = 'disable_model';
let adminProviderOverageActionMap = {};
let adminQuotaDisplayUnit = loadAdminQuotaDisplayUnitPreference();
let adminServerQuotaProvidersCache = [];
let adminQuotaOverageNoticeChecked = false;
let adminTextConfirmHandler = null;
let adminPanelScrollState = { providers: 0, models: 0 };
let adminConfigState = { mode: '', originalKey: '' };
let adminOllamaModelStatusCache = {};
let adminOllamaStatusPending = new Map();
let adminOllamaStatusModalState = { provider: '', model: '', status: null, loading: false };
const CHAT_COMPOSER_PREFS_KEY = 'nexora_chat_composer_prefs_v1';
const CHAT_INPUT_DRAFT_KEY = 'nexora_chat_input_draft_v1';
const CHAT_INPUT_DRAFT_MAX_LEN = 12000;
let NEXORA_LEARNING_FRONTEND_URL = `${window.location.protocol}//${window.location.hostname}:5001/api/frontend/`;
const NEXORA_LEARNING_CSS_URL = '/static/css/learning_mode.css?v=20260731_profile_center_01';
const NEXORA_LEARNING_JS_URL = '/static/js/learning_mode.js?v=20260731_profile_center_01';
const AGENT_STATUS_POLL_VISIBLE_MS = 5000;
const BROWSER_SYNC_RECONNECT_MS = 3000;
const BROWSER_SYNC_PING_MS = 20000;
const BROWSER_MODEL_CONFIG_SYNC_MS = 25000;
let browserSyncSocket = null;
let browserSyncReconnectTimer = null;
let browserSyncPingTimer = null;
let browserModelConfigSyncTimer = null;
let browserOllamaStatusProviders = [];
let browserSyncManuallyClosed = false;
let browserSyncSocketSerial = 0;
let originalHeaderState = null;
let navigationStack = [];
exposeLiveState('currentSearchQuery', () => store.conversation.get('searchQuery'), (v) => store.conversation.set('searchQuery', v)); // 保存搜索关键词，以便返回时重新显示
let chatHeaderBaseState = null;
let chatModelConfigSyncState = {
    version: '',
    inFlight: false,
    pending: false
};
let tokenMiniState = {
    conversationId: null,
    baseInput: 0,
    baseOutput: 0,
    streamInput: 0,
    streamOutput: 0,
    estimatedStreamOutput: 0,
    usageSnapshotInput: 0,
    usageSnapshotOutput: 0,
    usageSnapshotInitialized: false,
    requestSeq: 0,
    streaming: false
};
exposeLiveState('conversationNavigationSeq', () => store.conversation.get('navigationSeq'), (v) => store.conversation.set('navigationSeq', v));
exposeLiveState('activeConversationLoadController', () => store.conversation.get('loadController'), (v) => store.conversation.set('loadController', v));
const TOKEN_BUDGET_DEFAULT_LIMIT = 0;
let tokenBudgetState = {
    contextWindow: TOKEN_BUDGET_DEFAULT_LIMIT,
    estimated: true,
    missingContextWindow: true,
    roundInput: 0,
    includeContext: true,
    latestInputTokens: 0,
    latestRawInputTokens: 0,
    latestCachedInputTokens: 0,
    cumulativeInputTokens: 0,
    cumulativeRawInputTokens: 0,
    cumulativeCachedInputTokens: 0,
    toolInputEstimate: 0,
    toolInputTokens: 0,
    systemPromptTokens: 0,
    tokenBreakdownExact: false
};
let tokenBudgetTooltipState = {
    visible: false,
    target: null,
    lastText: ''
};
const MODEL_CONTEXT_REFRESH_DELAY_MS = 1200;
const MODEL_CONTEXT_RELOAD_DELAY_MS = 12000;
const LOCAL_PROVIDER_ICON_MAP = {
    github: '',
    alibabacloud: '/static/img/Index/static/icons/aliyun.png',
    aliyun: '/static/img/icons/tongyi_single_icon.png',
    bytedance: '/static/img/icons/volcengine_single_icon.svg',
    volcengine: '/static/img/icons/volcengine_single_icon.svg',
    qq: '/static/img/icons/tencent_cloud_single_icon.svg',
    wechat: '/static/img/icons/tencent_cloud_single_icon.svg',
    tencent: '/static/img/icons/tencent_cloud_single_icon.svg',
    deepseek: '/static/img/icons/deepseek_single_icon.svg',
    openai: '/static/img/icons/openai_single_icon.svg',
    stepfun: '/static/img/icons/stepfun_single_icon.png',
    moonshot: '/static/img/icons/kimi_single_icon.png',
    kimi: '/static/img/icons/kimi_single_icon.png',
    minimax: '/static/img/icons/minimax_single_icon.png',
    siliconflow: '/static/img/icons/siliconflow_single_icon.svg',
    openrouter: '/static/img/icons/openrouter_single_icon.svg',
    xunfei: '/static/img/icons/xunfei_spark_single_icon.svg',
    spark: '/static/img/icons/xunfei_spark_single_icon.svg',
    hunyuan: '/static/img/icons/hunyuan_single_icon.png',
    ollama: '/static/img/icons/ollama_single_icon.svg',
    nvidia: '/static/img/icons/nvidia.svg',
    zhipu: '/static/img/icons/zhipu_single_icon.svg',
    zhipuai: '/static/img/icons/zhipu_single_icon.svg',
    zai: '/static/img/icons/zhipu_single_icon.svg',
    bigmodel: '/static/img/icons/zhipu_single_icon.svg'
};
const MODEL_PROVIDER_LABEL_MAP = {
    volcengine: '火山引擎',
    aliyun: '阿里云',
    dashscope: '阿里云',
    stepfun: '阶跃星辰',
    github: 'GitHub',
    suanli: '算力猫',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    siliconflow: '硅基流动',
    moonshot: '月之暗面',
    zhipu: '智谱',
    hunyuan: '腾讯混元',
    minimax: 'MiniMax',
    nvidia: 'NVIDIA',
};
const MODEL_PROVIDER_ORDER_MAP = {
    volcengine: 10,
    aliyun: 20,
    dashscope: 20,
    stepfun: 30,
    github: 40,
    suanli: 50,
    openai: 60,
    deepseek: 70,
    ollama: 80,
    openrouter: 90,
    siliconflow: 100,
    moonshot: 110,
    zhipu: 120,
    hunyuan: 130,
    minimax: 140,
    nvidia: 150,
};
let modelOptionsDockState = null;
let modelSelectListenersBound = false;
let modelContextRefreshScheduled = false;
let isBatchRenderingMessages = false;
let renderLastUserMessageIndexHint = -1;
const STREAM_STATUS_SYNC_INTERVAL_MS = 2500;
const STREAM_ATTACH_RETRY_DELAY_MS = 350;
const STREAM_ATTACH_RETRY_MAX = 12;
let hoverProxyMessageEl = null;

const streamStateController = getNexoraChatStreaming().createStreamStateController({
    localStorage,
    getCurrentConversationId: () => currentConversationId,
    onSyncGenerationState: (options = {}) => syncGenerationStateForCurrentConversation(options),
    onInvalidateConversationList: () => invalidateConversationListForStreamState(),
    clearStreamAttachRetry: (conversationId) => clearStreamAttachRetry(conversationId)
});
const streamSessionMonitorController = getNexoraChatStreaming().createStreamSessionMonitorController({
    normalizeConversationStreamState,
    setConversationStreamState,
    markConversationStreamFinished,
    moveConversationStreamState,
    getConversationStreamState,
    readStreamRegenerateFlag,
    readStreamAssistantIndexFromMeta,
    readStreamRegenerateIndexFromMeta,
    isTerminalStreamSessionChunk,
    loadConversations,
    isCurrentConversation,
    renderConversationSnapshotFromServer
});
const streamStatusSyncController = getNexoraChatStreaming().createStreamStatusSyncController({
    statusSyncIntervalMs: STREAM_STATUS_SYNC_INTERVAL_MS,
    getConversationStreamIdsForStatusSync,
    forEachConversationStreamState: streamStateController.forEachConversationStreamState,
    setConversationStreamState,
    markConversationStreamFinished,
    isCurrentConversation,
    moveConversationStreamState,
    applyStreamSessionMetaRows,
    renderConversationSnapshotFromServer,
    getStoredRunningStreamStates,
    attachStreamSessionMonitor,
    getCurrentConversationId: () => currentConversationId
});
const userPromptEditController = getNexoraChatMessages().createUserPromptEditController({
    getMessagesContainer: () => els.messagesContainer,
    getCurrentConversationId: () => currentConversationId,
    getChatInputDraftMaxLen: () => CHAT_INPUT_DRAFT_MAX_LEN,
    showToast,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    renderMathSafe,
    highlightCode,
    ensureConversationPanelReadyForMutation,
    fetchConversationMessagesSnapshot,
    getLastUserMessageIndexFromMessages,
    renderMessages,
    renderConversationSnapshotFromServer,
    findAssistantIndexAfterUserMessageInMessages,
    sendMessage,
    startRegenerate,
    isChatMobileLayout,
});
// --- Knowledge View Logic ---
let knowledgeMetaCache = {};
let knowledgeVectorizationEnabled = false;
let bulkVectorizeRunning = false;
const KNOWLEDGE_IMAGE_PLACEHOLDER_SCHEME = 'nexora-upload://';
const KNOWLEDGE_IMAGE_PENDING_ALT = '上传中...';
const KNOWLEDGE_IMAGE_FAILED_ALT = '上传失败';
const knowledgeImageUploadRuntime = {
    pending: new Map()
};
const knowledgeEditorController = getNexoraChatKnowledge().createKnowledgeEditorController({
    getPreviewEl: () => getKnowledgeEditorPreviewEl(),
    getScrollerEl: () => getKnowledgeEditorScrollerEl(),
    getProseMirrorEl: () => getToastProseMirrorEl(),
    getViewerEl: () => document.getElementById('knowledgeViewer'),
    logDebug: (...args) => logKnowledgeEditorDebug(...args),
    collectLayoutSnapshot: () => collectKnowledgeEditorLayoutSnapshot(),
    summarizeNode: (...args) => summarizeKnowledgeEditorNode(...args),
    getPendingImageUploadCount: () => knowledgeImageUploadRuntime.pending.size,
    getWorkspaceKnowledgeRequestFields,
    appendWorkspaceKnowledgeQuery,
    getActiveWorkspaceKnowledgeContext,
    getKnowledgeMetaCache: () => knowledgeMetaCache,
    getCurrentConversationId: () => currentConversationId,
    getCurrentUsername: () => currentUsername,
    loadKnowledge,
    showToast,
    renderMarkdownForNotes,
    bindSourceMarkdown,
    renderMathSafe,
    isDebugEnabled: () => isKnowledgeEditorDebugEnabled(),
    escapeRegexPattern,
    normalizeUploadFile,
    normalizeKnowledgeImageFileName,
    allocateKnowledgeImageSlot,
    uploadKnowledgeImageByFile,
    buildKnowledgeImagePlaceholderToken,
    buildKnowledgeImagePlaceholderMarkdown,
    normalizeKnowledgeImageAltText,
    trackPendingImageUpload: (imageId, payload) => knowledgeImageUploadRuntime.pending.set(imageId, payload),
    releasePendingImageUpload: (imageId) => knowledgeImageUploadRuntime.pending.delete(imageId),
    extractFilesFromClipboardEvent,
    knowledgeImagePendingAlt: KNOWLEDGE_IMAGE_PENDING_ALT,
    knowledgeImageFailedAlt: KNOWLEDGE_IMAGE_FAILED_ALT,
    normalizeWorkspaceConversationHeaderContext: normalizeWorkspaceConversationHeaderContextForConversationLoad,
    restoreWorkspaceDetailInputContainer: restoreWorkspaceDetailInputContainerForConversationLoad,
    getOriginalHeaderState: () => originalHeaderState,
    setOriginalHeaderState: (nextState) => {
        originalHeaderState = nextState;
    },
    getNavigationStack: () => navigationStack,
    setNavigationStack: (nextStack) => {
        navigationStack = nextStack;
    },
    saveCurrentViewerState,
    getElements: () => els,
    syncTurnIndicatorVisibility: () => _syncTurnIndicatorVisibility(),
    applyDesktopHeaderTools,
    hideFileCenterContextMenu,
    closeFileCenterSortDropdown,
    exitLearningFeedComposeMode,
    getCurrentSearchQuery: () => currentSearchQuery,
    setLastKnowledgeSearchResults: (results) => {
        lastKnowledgeSearchResults = results;
    },
    renderSearchResultsFromCache,
    escapeHtml,
    selectWorkspaceProject: selectWorkspaceProjectForConversationLoad,
    resizeMessageInput,
    restoreHeaderState,
    getChatHeaderBaseState: () => chatHeaderBaseState,
    clearMailViewUrl,
    syncLearningHeaderMode,
});


const knowledgeController = getNexoraChatKnowledge().createKnowledgeController({
    escapeHtml,
    showToast,
    buildNoteAnchorSnippet,
    contentContainsSnippetLoose,
    openKnowledgeAtChunk,
    viewKnowledge,
});
const knowledgeSidebarController = getNexoraChatKnowledge().createKnowledgeSidebarController({
    getElements: () => els,
    getCurrentConversationId: () => currentConversationId,
    getUploadedFileIds: () => uploadedFileIds,
    getCurrentViewingKnowledge: () => knowledgeEditorController.getCurrentTitle(),
    getKnowledgeMetaCache: () => knowledgeMetaCache,
    setKnowledgeMetaCache: (value) => {
        knowledgeMetaCache = (value && typeof value === 'object') ? value : {};
    },
    getBasisKnowledgeListCache: () => basisKnowledgeListCache,
    setBasisKnowledgeListCache: (items) => {
        basisKnowledgeListCache = Array.isArray(items) ? items : [];
    },
    isKnowledgeVectorizationEnabled: () => knowledgeVectorizationEnabled,
    setKnowledgeVectorizationEnabled: (enabled) => {
        knowledgeVectorizationEnabled = !!enabled;
    },
    isBulkVectorizeRunning: () => bulkVectorizeRunning,
    showToast,
    viewKnowledge,
    closeKnowledgeView,
    updateFilePreview,
    showPinContextMenu,
    vectorizeKnowledgeTitle,
    getVectorizeTasks: () => knowledgeVectorController.getVectorizeTasks(),
    registerModalBackdropStacking,
    bindBackdropSafeClose,
    handleBackdropStackingChange,
    showConfirm: (...args) => window.showConfirm(...args),
});
const knowledgeVectorController = getNexoraChatKnowledge().createKnowledgeVectorController({
    getElements: () => els,
    getCurrentConversationId: () => currentConversationId,
    getCurrentViewingKnowledge: () => knowledgeEditorController.getCurrentTitle(),
    getKnowledgeMetaCache: () => knowledgeMetaCache,
    isKnowledgeVectorizationEnabled: () => knowledgeVectorizationEnabled,
    setKnowledgeVectorizationEnabled: (enabled) => {
        knowledgeVectorizationEnabled = !!enabled;
    },
    setBulkVectorizeRunning: (running) => {
        bulkVectorizeRunning = !!running;
    },
    showToast,
    confirmModalAsync,
    syncBulkVectorizeButtonVisibility,
    loadKnowledge,
    escapeCssSelector,
    createKnowledgeVectorizeTask,
    pollKnowledgeVectorTask,
});
const knowledgeWorkspaceController = getNexoraChatKnowledge().createKnowledgeWorkspaceController({
    getKnowledgeWorkspaceReturnContext: () => knowledgeEditorController.getWorkspaceReturnContext(),
    getCurrentUsername: () => currentUsername,
});
const knowledgeSettingsController = getNexoraChatKnowledge().createKnowledgeSettingsController({
    getCurrentViewingKnowledge: () => knowledgeEditorController.getCurrentTitle(),
    getCurrentUsername: () => currentUsername,
    ensureCurrentUser: checkUserRole,
    getActiveWorkspaceKnowledgeContext,
    getWorkspaceKnowledgeRequestFields,
    appendWorkspaceKnowledgeQuery,
    getKnowledgeMetaCache: () => knowledgeMetaCache,
    getCurrentConversationId: () => currentConversationId,
    showToast,
    viewKnowledge,
    loadKnowledge,
    loadVectorChunks,
    resetVectorProgressUI,
    setVectorStatus,
    getVectorizeTitle: () => knowledgeVectorController.getVectorizeTitle(),
    setVectorizeTitle: (title) => knowledgeVectorController.setVectorizeTitle(title),
    startOwnerKnowledgeCollab: (...args) => knowledgeEditorController.startOwnerKnowledgeCollab(...args),
    stopKnowledgeCollab: () => knowledgeEditorController.stopKnowledgeCollab(),
});
const clientToolController = getNexoraChatToolCanvas().createClientToolController({
    getCurrentConversationId: () => currentConversationId,
});
const fileUploadController = getNexoraChatFiles().createFileUploadController({
    getElements: () => els,
    showToast,
    normalizeUploadFile,
    isImageLikeFile,
    readImageAsDataUrl,
    updateFilePreview,
    updateSendButtonState,
    loadCloudFiles,
    getUploadedFileIds: () => uploadedFileIds,
    setIsUploadingFiles: (value) => {
        isUploadingFiles = !!value;
    },
});
const fileCenterUploadController = getNexoraChatFiles().createFileCenterUploadController({
    escapeHtml,
    showToast,
    copyTextToClipboardSafe,
    handleFileUploadFiles: (...args) => fileUploadController.handleFileUploadFiles(...args),
    loadFileCenterFiles,
    normalizeFileCenterPath,
    getFileCenterCurrentPath: () => fileCenterState.currentPath,
});
const toolEventController = getNexoraChatTools().createToolEventController({
    escapeHtml,
    placeCanvasCardsBelowToolChain,
    syncInteractiveCardsBelowToolChain,
});
const toolResultController = getNexoraChatTools().createToolResultController({
    getCurrentConversationId: () => currentConversationId,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    renderMathSafe,
    highlightCode,
    syncGeneratedImageViewportLimit,
    appendToolEvent: (...args) => toolEventController.appendToolEvent(...args),
    renameToolUsageRow: (...args) => toolEventController.renameToolUsageRow(...args),
    setToolUsageStatus: (...args) => toolEventController.setToolUsageStatus(...args),
    scrollToolOutputToBottom: (...args) => toolEventController.scrollToolOutputToBottom(...args),
    scrollToolOutputToTop: (...args) => toolEventController.scrollToolOutputToTop(...args),
    maybeRenderCanvasFromJsExecuteResult,
});
const conversationBranchController = getNexoraChatConversationBranches().createConversationBranchController({
    getCurrentConversationId: () => currentConversationId,
    isConversationStreamRunning,
    getActiveWorkspaceConversationContext: () => {
        if (typeof window.getActiveWorkspaceConversationContext !== 'function') {
            throw new Error('Workspace 会话上下文接口未初始化');
        }

        return window.getActiveWorkspaceConversationContext();
    },
    loadConversation,
    loadConversations,
    showToast,
});
const messagesController = getNexoraChatMessages().createMessagesController({
    getMessagesContainer: () => els.messagesContainer,
    getCurrentConversationId: () => currentConversationId,
    getConversationStreamState,
    normalizeStreamMessageIndex,
    readMessageRenderIndex,
    buildIndexedMessageRows,
    getNextVisibleMessageIndex,
    getRenderLastUserMessageIndexHint: () => renderLastUserMessageIndexHint,
    getIsBatchRenderingMessages: () => isBatchRenderingMessages,
    getLastUserMessageIndexFromMessages,
    setRenderLastUserMessageIndexHint: (index) => {
        renderLastUserMessageIndexHint = index;
    },
    setIsBatchRenderingMessages: (value) => {
        isBatchRenderingMessages = !!value;
    },
    refreshConversationImageHistoryFlag,
    clearHoverProxyMessage,
    renderWelcomeScreen,
    syncLearningHeaderMode,
    clearLearningWelcomeState,
    captureMessagesScrollAnchor,
    restoreMessagesScrollAnchor,
    refreshLastUserPromptEditButtons,
    getShouldAutoScroll: () => shouldAutoScroll,
    scrollMessagesToBottomNow,
    setMessagesLastObservedScrollTop,
    pinMessagesToBottomFor,
    getMessagesBottomPinUntilTs: () => __messagesBottomPinUntilTs,
    setMessagesBottomPinPendingRestoreBehavior: (value) => {
        __messagesBottomPinPendingRestoreBehavior = value;
    },
    notifyLearningSidebarBridge,
    renderTurnIndicator,
    updateMessageModelBadge,
    isCurrentConversation,
    hideTurnListPopup,
    markTurnIndicatorLayoutDirty,
    getMessageElementByIndex,
    openImageViewer,
    formatFileSize,
    escapeHtml,
    collectContentMarkdownBeforeNode,
    resetUserPromptInlineEditor,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    renderMathSafe,
    renderLongtermHookBlock,
    appendReasoningThinkingBlock,
    updateWebSearchStatus,
    appendSearchMeta,
    resolveToolNameFromEvent,
    appendAddBasisView,
    collapseResolvedToolUsages: (...args) => getNexoraChatTools().collapseResolvedToolUsages(...args),
    allocateToolCallId,
    rememberJsExecuteCanvasCall,
    finalizeToolCallBadge,
    extractLearningCardPayload,
    appendLearningCardStep,
    updateLastToolResult,
    applyLongtermPlanFromText,
    updateMessageDivTools,
    appendErrorEvent,
    extractStandaloneSystemErrorMessage,
    highlightCode,
    appendLearningCardsToContent,
    appendQuestionStep,
    appendPuzzleStep,
    readMessageIoTokens,
    readMessageMemoryIoTokens,
    safeTokenInt,
    buildVersionNavigation,
    rememberVisibleMessageInWindow,
    appendTurnIndicatorLine,
    forkConversationFromMessage: (...args) => conversationBranchController.forkFromMessage(...args),
});
const messageActionsController = getNexoraChatMessages().createMessageActionsController({
    getCurrentConversationId: () => currentConversationId,
    getSelectedModelId: () => selectedModelId,
    getModelCatalog: () => modelCatalog,
    getLearningModeEnabled: () => learningModeEnabled,
    getCurrentConversationMode: () => currentConversationMode,
    getCurrentConversationLongtermState: () => currentConversationLongtermState,
    getLearningReaderContextSnapshot: () => learningReaderContextSnapshot,
    getTokenBudgetState: () => tokenBudgetState,
    getElements: () => els,
    getShouldAutoScroll: () => shouldAutoScroll,
    setIsGenerating: (value) => {
        isGenerating = !!value;
    },
    setCurrentAbortController: (controller) => {
        currentAbortController = controller;
    },
    setPendingRegenerateFilter: (value) => {
        pendingRegenerateFilter = value;
    },
    showToast,
    showConfirm: (...args) => {
        if (typeof window.showConfirm !== 'function') {
            throw new Error('showConfirm 未初始化');
        }

        return window.showConfirm(...args);
    },
    copyTextToClipboardSafe,
    ensureConversationPanelReadyForMutation,
    syncConversationMessagesFromServer,
    loadConversations,
    loadKnowledge,
    loadModels,
    syncGenerationStateForCurrentConversation,
    isConversationStreamRunning,
    fetchConversationMessagesSnapshot,
    renderMessages,
    buildLearningReaderContextBlocks,
    getToolsMode,
    isDebugConsoleEnabled,
    appendDebugConsoleEntry,
    consumeForceContextCompressionOnce,
    maybeConfirmContextCompressionBeforeSend,
    getMessageElementByIndex,
    buildAttachmentsPayloadFromMessage,
    updateSendButtonState,
    clearActiveStreamResumeState,
    setConversationStreamState,
    isCurrentConversation,
    beginTokenMiniStreaming,
    applyRegenerateStreamDomWindow,
    resetAssistantMessageForLiveStream,
    readErrorMessageFromResponse,
    saveActiveStreamResumeState,
    markStreamControllerDetachOnly,
    isSseResponse,
    isTerminalStreamSessionChunk,
    markConversationStreamFinished,
    patchActiveStreamResumeState,
    jsonParseSafe,
    applyPromptTokenProfileChunk,
    appendDebugTraceChunk,
    stripHistoryTimeMarkerEchoForStream,
    createContentSpan,
    renderStreamingContentSegment,
    pinMessagesToBottomFor,
    updateMessageDivContent,
    updateMessageDivThinking,
    updateMessageDivTools,
    yieldToolStreamPaintForChunk,
    onTokenStreamUsageChunk,
    applyUsageChunkToBadgeState,
    updateMessageModelBadge,
    appendErrorEvent,
    scheduleLearningSidebarBridgeNotify,
    isLikelyRetryableNetworkErrorText,
    finalizeMessageRenderForIndex,
    resolveAssistantStreamMessageDiv,
    renderAssistantTerminalErrorMessage,
    removeConversationStreamState,
    getConversationStreamState,
    shouldAutoAttachDetachedStream,
    attachDetachedStreamConsumer,
    finishTokenMiniStreaming,
    refreshConversationImageHistoryFlag,
    applyTokenBudgetFromConversationMessages,
    refreshTokenMiniForConversation,
});
const streamReconnectController = getNexoraChatStreamReconnect().createStreamReconnectController({
    getMessagesContainer: () => els.messagesContainer,
    getConversationTitleElement: () => els.conversationTitle,
    getCurrentConversationId: () => currentConversationId,
    setCurrentConversationId: (conversationId) => {
        currentConversationId = conversationId;
    },
    getIsGenerating: () => isGenerating,
    getCurrentAbortController: () => currentAbortController,
    setCurrentAbortController: (controller) => {
        currentAbortController = controller;
    },
    getCurrentConversationMode: () => currentConversationMode,
    getCurrentConversationLongtermState: () => currentConversationLongtermState,
    setCurrentConversationLongtermState: (state) => {
        currentConversationLongtermState = state;
    },
    getShouldAutoScroll: () => shouldAutoScroll,
    getTokenMiniStreamOutput: () => tokenMiniState.streamOutput,
    getTokenMiniEstimatedStreamOutput: () => tokenMiniState.estimatedStreamOutput,
    loadActiveStreamResumeState,
    patchActiveStreamResumeState,
    clearActiveStreamResumeState,
    normalizeStreamMessageIndex,
    readStreamRegenerateFlag,
    readStreamAssistantIndexFromMeta,
    readStreamRegenerateIndexFromMeta,
    stripHistoryTimeMarkerEchoForStream,
    getConversationStreamState,
    setConversationStreamState,
    moveConversationStreamState,
    markConversationStreamFinished,
    isTerminalStreamSessionChunk,
    shouldAutoAttachDetachedStream,
    attachDetachedStreamConsumer,
    loadConversation,
    loadConversations,
    loadKnowledge,
    syncNotesForConversation,
    noteTokenMiniConversationId,
    syncGenerationStateForCurrentConversation,
    syncLocalConversationModeFlags,
    beginTokenMiniStreaming,
    finishTokenMiniStreaming,
    applyRegenerateStreamDomWindow,
    appendMessage,
    resetAssistantMessageForLiveStream,
    createContentSpan,
    createThinkingBlock,
    resolveReasoningThinkingBlockForAppend,
    markReasoningThinkingBlockLive,
    readReasoningContentRaw,
    buildReasoningAppendText,
    updateThinkingBlockSummary,
    renderStreamingMarkdownWithNewTabLinks,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    highlightCode,
    replayStreamPrefillChunks,
    updateMessageDivTools,
    appendLearningCardStep,
    appendQuestionStep,
    appendPuzzleStep,
    rememberToolArgsDeltaSeen,
    hasToolArgsDeltaSeen,
    yieldToolStreamPaintForChunk,
    appendDebugTraceChunk,
    appendErrorEvent,
    renderAssistantTerminalErrorMessage,
    renderConversationSnapshotFromServer,
    getStreamingModelBadgeName,
    updateMessageModelBadge,
    syncStreamingModelBadgeEstimate,
    finalizeMessageRenderForIndex,
    collapseReasoningBlocksForMessage,
    applyLongtermPlanFromText,
    normalizeLongtermState,
    renderLongtermPlanPanel,
    applyPromptTokenProfileChunk,
    onTokenStreamTextChunk,
    onTokenStreamReasoningChunk,
    onTokenStreamToolArgsChunk,
    onTokenStreamUsageChunk,
    safeTokenInt,
    pinMessagesToBottomFor,
    scheduleLearningSidebarBridgeNotify,
    showToast,
    isLikelyRetryableNetworkErrorText,
    waitForStreamServerFinalized,
});
const streamLifecycleController = getNexoraChatStreamLifecycle().createStreamLifecycleController({
    attachRetryDelayMs: STREAM_ATTACH_RETRY_DELAY_MS,
    attachRetryMax: STREAM_ATTACH_RETRY_MAX,
    isCurrentConversation,
    getCurrentConversationId: () => currentConversationId,
    getConversationStreamState,
    setConversationStreamState,
    normalizeConversationStreamState,
    normalizeStreamMessageIndex,
    syncGenerationStateForCurrentConversation,
    syncStoredConversationStreamStatus,
    resumeActiveStreamAfterReload,
    attachStreamSessionMonitor,
    getVisibleMessageCount: () => (
        els.messagesContainer
            ? els.messagesContainer.querySelectorAll('.message').length
            : 0
    )
});
const conversationListController = getNexoraChatConversations().createConversationListController({
    getConversationListElement: () => els.conversationList,
    getCurrentConversationId: () => currentConversationId,
    getConversationStreamState,
    getConversationListCache: () => conversationListCache,
    setConversationListCache: (items) => {
        conversationListCache = Array.isArray(items) ? items : [];
    },
    getConversationTitleElement: () => els.conversationTitle,
    getConversationRenameElements: () => ({
        modal: els.conversationRenameModal,
        input: els.conversationRenameInput,
        closeBtn: els.closeConversationRenameModalBtn,
        cancelBtn: els.cancelConversationRenameBtn,
        saveBtn: els.confirmConversationRenameBtn
    }),
    bindBackdropSafeClose,
    showToast,
    isChatMobileLayout,
    showPinContextMenu,
    getCurrentViewingKnowledge: () => knowledgeEditorController.getCurrentTitle(),
    closeKnowledgeView,
    markConversationStreamRead,
    loadConversation,
    deleteConversation,
    notifyLearningSidebar: () => scheduleLearningSidebarBridgeNotify(0),
    isNexoraCodeProjectSidebarEnabled,
    getNexoraCodeProjects,
    getNexoraCodeHiddenProjectIds,
    requestNexoraCodeProjectCreate,
    requestNexoraCodeConversationCreate
});
const conversationNavigationController = getNexoraChatConversations().createConversationNavigationController({
    getKnowledgeViewerElement: () => document.getElementById('knowledgeViewer'),
    resetWorkspaceReadonlyConversationStateForConversationLoad,
    closeKnowledgeView,
    exitLearningFeedComposeMode,
    setCurrentConversationHasImageHistory: (value) => {
        currentConversationHasImageHistory = !!value;
    },
    getLearningSidebarMode: () => learningSidebarMode,
    normalizeWorkspaceConversationHeaderContext: normalizeWorkspaceConversationHeaderContextForConversationLoad,
    renderWorkspaceConversationHierarchy: renderWorkspaceConversationHierarchyForConversationLoad,
    resolveNewConversationMode,
    shouldPreserveLearningMainPanelForNewConversation,
    shouldKeepCurrentRunningConversationPanel,
    resetCurrentConversationLongtermState: resetCurrentConversationLongtermStateForNewConversation,
    detachCurrentVisibleStreamForNavigation,
    setCurrentConversationId: (conversationId) => {
        currentConversationId = conversationId;
    },
    beginConversationNavigation,
    resetKnowledgeNavigationForConversationLoad,
    resetConversationMessageWindowState,
    syncBrowserCurrentConversation,
    invalidateConversationListForStreamState,
    syncGenerationStateForCurrentConversation,
    setLearningHeaderModeForConversationLoad,
    clearLearningWelcomeState,
    resetLearningStateForNewConversation,
    syncNotesForConversation,
    applyLearningSidebarMode,
    clearWorkspaceHierarchySlot: clearWorkspaceHierarchySlotForConversationLoad,
    renderWelcomeScreen,
    getMessagesContainer: () => els.messagesContainer,
    detachVisibleStreamReaderBeforeConversationRender,
    resetTurnIndicatorForConversationLoad,
    resetTokenUiForConversationLoad,
    pushConversationHistory,
    getConversationInitialMessageLimit: () => CONVERSATION_INITIAL_MESSAGE_LIMIT,
    isActiveConversationNavigation,
    applyStreamSessionMetaRows,
    getConversationStreamState,
    syncStoredConversationStreamStatus,
    getConversationTitleElement: () => els.conversationTitle,
    syncLearningHeaderMode,
    resetTokenUiForNewConversation,
    pushNewConversationHistory,
    loadConversations,
    confirmModalAsync,
    removeConversationStreamState,
    markConversationStreamRead,
    attachRunningStreamToCurrentConversation,
    getCurrentConversationId: () => currentConversationId
});
const adminSystemControlsController = getNexoraChatAdminSystem().createAdminSystemControlsController({
    normalizeModelProviderKey,
    compareModelProviderKeys,
    getModelProviderLabel,
    renderProviderIconHtml
});
const adminUsersController = getNexoraChatAdminUsers().createAdminUsersController({
    escapeHtml,
    showToast,
    getCurrentUsername: () => currentUsername,
    getDefaultAvatarDataUrl,
    isNexoraMailEnabled,
    confirmModalAsync,
    loadAdminStats,
    readAdminJsonResponse,
    closeAddUserModal,
});
const mailsModuleForRuntime = getNexoraChatMailsIfEnabled();

if (mailsModuleForRuntime) {
    mailsModuleForRuntime.setMailUiRuntime({
        closeKnowledgePanel,
        closeCloudFilePanel,
        exitLearningFeedComposeMode,
        restoreWorkspaceDetailInputContainer: restoreWorkspaceDetailInputContainerForConversationLoad,
        getOriginalHeaderState: () => originalHeaderState,
        setOriginalHeaderState: (nextState) => {
            originalHeaderState = nextState;
        },
        resetKnowledgeViewRuntimeState: () => {
            knowledgeEditorController.clearCurrentTitle();
            knowledgeEditorController.clearWorkspaceReturnContext();
            knowledgeEditorController.clearPendingHighlightData();
            navigationStack = [];
        },
        getElements: () => els,
        applyDesktopHeaderTools,
        syncTurnIndicatorVisibility: () => _syncTurnIndicatorVisibility(),
    });
    mailsModuleForRuntime.setAdminUsersRuntime(adminUsersController);
}

const settingsManagementController = getNexoraSettingsManagement();

const adminSettingsTabsController = getNexoraChatAdmin().createAdminSettingsTabsController({
    closeQuotaAdjustPopover: () => _closeQuotaAdjustPopover(),
    getSettingsModal: () => document.getElementById('settingsModal'),
    syncSettingsManagementPanel: (tabName) => settingsManagementController.activate(tabName),
    resetAdminUserFilter: () => {
        resetAdminUserFilterKeyword();
        const filterInput = document.getElementById('adminUserFilterInput');

        if (filterInput) filterInput.value = '';
    },
    loadAdminUsersList,
    loadAdminStats,
    loadAdminSystemSettings,
    resetAdminMailFilter: () => {
        resetAdminMailUserFilterKeyword();
        const filterInput = document.getElementById('adminMailUserFilterInput');

        if (filterInput) filterInput.value = '';
    },
    loadAdminMailUsersList,
    loadServerQuotaSettings,
    loadAdminModelConfig,
    resetAdminGenImageApiFilter: () => {
        adminGenImageApiFilterKeyword = '';
        const filterInput = document.getElementById('adminGenImageApiSearchInput');

        if (filterInput) filterInput.value = '';
    },
    loadAdminGenImageApis,
    loadAdminPublicApiAuth,
    loadAdminChromaStats,
    loadSkillSettings,
});
const adminSettingsEventsController = getNexoraChatAdmin().createAdminSettingsEventsController({
    setAdminUserFilterKeyword(value) {
        setAdminUserFilterKeyword(value);
    },
    renderAdminUsersList,
    renderAdminMailCreateForm,
    setAdminMailUserFilterKeyword,
    renderAdminMailUsersList,
    setAdminMailGroup,
    loadAdminMailUsersList,
    openProviderEditor,
    openModelEditor,
    setAdminModelSearchKeyword(value) {
        adminModelSearchKeyword = String(value || '').trim();
    },
    renderAdminModelConfig,
    openAdminGenImageApiEditor,
    setAdminGenImageApiFilterKeyword(value) {
        adminGenImageApiFilterKeyword = String(value || '').trim().toLowerCase();
    },
    renderAdminGenImageApis,
    loadAdminQuotaDisplayUnitPreference,
    setAdminQuotaDisplayUnit(value) {
        adminQuotaDisplayUnit = value;
    },
    normalizeAdminQuotaDisplayUnit,
    saveAdminQuotaDisplayUnitPreference,
    hasAdminServerQuotaProviders() {
        return Array.isArray(adminServerQuotaProvidersCache) && adminServerQuotaProvidersCache.length > 0;
    },
    isCurrentUserAdmin() {
        return currentUserRole === 'admin';
    },
    loadServerQuotaSettings,
    openAdminPublicApiKeyModal(mode) {
        return window.openAdminPublicApiKeyModal(mode);
    },
    initAdminPublicApiModal,
    revokeAdminPublicApiKey,
    saveAdminPublicApiSettings,
    saveAdminPublicApiGlobalSettings,
    initAdminUserTokenStatsControls,
    bindBackdropSafeClose,
    closeAdminPublicApiKeyModal() {
        return window.closeAdminPublicApiKeyModal();
    },
    copyAdminPublicApiModalKey,
    submitAdminPublicApiKeyAction,
    closeAdminTextConfirmModal() {
        return window.closeAdminTextConfirmModal();
    },
    closeAdminConfigModal() {
        return window.closeAdminConfigModal();
    },
    syncAdminProviderApiTypeFields,
    saveAdminConfigModal,
    closeAdminOllamaModelStatusModal,
    refreshAdminOllamaModelStatus() {
        const state = adminOllamaStatusModalState || {};

        if (state.provider && state.model) {
            return loadAdminOllamaModelStatus(state.provider, state.model);
        }

        return undefined;
    },
    toggleAdminOllamaModelStatus,
});
let selectedModelId = null;
let modelCatalog = [];
let providerCatalogByKey = {};
let ollamaChatProviderStatusCache = new Map();
let ollamaChatProviderStatusPending = new Map();
exposeLiveState('currentConversationHasImageHistory', () => store.conversation.get('hasImageHistory'), (v) => store.conversation.set('hasImageHistory', v));
exposeLiveState('currentConversationMode', () => store.conversation.get('mode'), (v) => store.conversation.set('mode', v));
let currentConversationLongtermState = {
    active: false,
    task: '',
    plan: [],
    context: '',
    hook: {}
};
let currentConversationLongtermAutoContinueKind = '';
let currentConversationLongtermConfirmationInFlight = false;
const modelMetaById = new Map();
let fileDragDepth = 0;
let fileDropHighlightTarget = null;
const DEBUG_CONSOLE_ENABLED_KEY = 'nexora_debug_console_enabled_v1';
let debugConsoleState = {
    enabled: false,
    open: false,
    activeTab: 'prompt',
    entries: [],
    maxEntries: 400,
    toolCatalog: [],
    toolCatalogLoaded: false,
    toolCatalogModelName: '',
    toolCatalogConversationId: '',
    selectedToolName: '',
    toolResultText: '尚未执行工具',
    bound: false,
    dragging: false,
    resizing: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0
};
let floatingPanelZIndexSeed = 5608;

function bringFloatingPanelToFront(panel) {
    if (!panel) return;
    const current = Number.parseInt(String(panel.style && panel.style.zIndex ? panel.style.zIndex : ''), 10);
    const next = Math.max(
        floatingPanelZIndexSeed + 1,
        Number.isFinite(current) ? current + 1 : 0,
        5600
    );
    floatingPanelZIndexSeed = next;
    panel.style.zIndex = String(next);
}

function bindFloatingPanelFront(panel) {
    if (!panel || panel.dataset.frontBindDone === '1') return;
    panel.dataset.frontBindDone = '1';
    const lift = () => bringFloatingPanelToFront(panel);
    panel.addEventListener('pointerdown', lift, true);
    panel.addEventListener('mousedown', lift, true);
}
let mobileMessageInputViewportBaseline = 0;
let lastMessageInputGestureTs = 0;
const SETTINGS_COMPANION_MODE = (() => {
    try {
        const p = new URLSearchParams(window.location.search || '');
        const raw = String(p.get('settings_companion') || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'yes';
    } catch (_) {
        return false;
    }
})();

function getDirectConversationUrlTarget(params = null) {
    return getNexoraChatConversations().getDirectConversationUrlTarget(params);
}

function hasConversationUrlTarget(params = null) {
    return getNexoraChatConversations().hasConversationUrlTarget(params);
}

let pinContextMenuState = null;
let pinContextMenuBusy = false;
exposeLiveState('pendingRegenerateFilter', () => store.conversation.get('pendingRegenerateFilter'), (v) => store.conversation.set('pendingRegenerateFilter', v));
exposeLiveState('conversationListCache', () => store.conversation.get('listCache'), (v) => store.conversation.set('listCache', v));
let basisKnowledgeListCache = [];
let trashViewState = {
    loading: false,
    items: []
};
let authRedirectInProgress = false;
let logoutRequestInFlight = false;
let skillSettingsState = {
    skillModes: {},
    skills: [],
    activeSkills: [],
    loaded: false,
    loading: false
};
let skillEditorState = {
    skillId: '',
    saving: false
};
let skillModeFloatingMenuEl = null;
let skillModeFloatingAnchorEl = null;
let skillModeFloatingDocHandler = null;
let skillModeFloatingViewportHandler = null;

function normalizeSkillModeValue(raw) {
    const token = String(raw || '').trim().toLowerCase();
    if (token === 'force') return 'force';
    if (token === 'auto' || token === 'auto_tools' || token === 'auto(tools)') return 'auto';
    return 'off';
}

function setHoverProxyMessage(target) {
    if (hoverProxyMessageEl === target) return;
    if (hoverProxyMessageEl && hoverProxyMessageEl.classList) {
        hoverProxyMessageEl.classList.remove('message-hover-proxy');
    }
    hoverProxyMessageEl = target || null;
    if (hoverProxyMessageEl && hoverProxyMessageEl.classList) {
        hoverProxyMessageEl.classList.add('message-hover-proxy');
    }
}

function clearHoverProxyMessage() {
    setHoverProxyMessage(null);
    if (els.messagesContainer) {
        els.messagesContainer.classList.remove('has-proxy-hover');
    }
}

let learningSidebarListeners = [];
let learningReaderContextSnapshot = null;
let learningSidebarNotifyTimer = null;
let learningSidebarSendInFlight = false;
let learningSidebarDraftValue = '';
let learningFeedComposeMode = false;
let learningFeedPostInFlight = false;
let learningFeedCancelBtn = null;
let learningFeedMentionState = {
    query: '',
    users: [],
    activeIndex: 0,
    visible: false,
    context: null,
};
let learningFeedMentionMenuEl = null;
const learningInteractionLocks = {
    questions: new Map(),
    puzzles: new Map(),
};
const QUESTION_LOCK_STORAGE_KEY = 'nexora_question_locks_v1';
let cachedPuzzleStates = {};

function getLearningInteractionLockKey(conversationIdOverride = null) {
    const raw = conversationIdOverride !== null && conversationIdOverride !== undefined
        ? conversationIdOverride
        : currentConversationId;
    const key = String(raw || '').trim();
    return key || '__draft__';
}

function rememberLockedQuestion(questionId, answerText = '') {
    const qid = String(questionId || '').trim();
    if (!qid) return;
    const answer = String(answerText || '').trim();
    const key = getLearningInteractionLockKey();
    if (!learningInteractionLocks.questions.has(key)) {
        learningInteractionLocks.questions.set(key, new Map());
    }
    learningInteractionLocks.questions.get(key).set(qid, answer);
    writeStoredQuestionLock(key, qid, answer);
}

function getLockedQuestionAnswer(questionId) {
    const qid = String(questionId || '').trim();
    if (!qid) return '';
    const key = getLearningInteractionLockKey();
    const bucket = learningInteractionLocks.questions.get(key);
    const memoryAnswer = bucket ? String(bucket.get(qid) || '').trim() : '';
    if (memoryAnswer) return memoryAnswer;
    return readStoredQuestionLock(key, qid);
}

function readQuestionLockStore() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_LOCK_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.warn('[QuestionTool] failed to read stored question locks', err);
        return {};
    }
}

function writeStoredQuestionLock(conversationKey, questionId, answerText) {
    const qid = String(questionId || '').trim();
    const answer = String(answerText || '').trim();
    if (!qid || !answer) return;
    try {
        const store = readQuestionLockStore();
        const scopedKey = `${String(conversationKey || '__draft__')}::${qid}`;
        store[scopedKey] = answer;
        localStorage.setItem(QUESTION_LOCK_STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
        console.warn('[QuestionTool] failed to persist question lock', err);
    }
}

function readStoredQuestionLock(conversationKey, questionId) {
    const qid = String(questionId || '').trim();
    if (!qid) return '';
    const store = readQuestionLockStore();
    const scopedKey = `${String(conversationKey || '__draft__')}::${qid}`;
    return String(store[scopedKey] || '').trim();
}

function rememberLockedPuzzle(puzzleId, submission = null) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.rememberLockedPuzzle === 'function') {
        api.rememberLockedPuzzle(puzzleId, submission);
    }
}

function getLockedPuzzleSubmission(puzzleId) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.getLockedPuzzleSubmission === 'function') {
        return api.getLockedPuzzleSubmission(puzzleId);
    }
    return null;
}

function resetLearningFeedMentionState() {
    learningFeedMentionState = {
        query: '',
        users: [],
        activeIndex: 0,
        visible: false,
        context: null,
    };
    renderLearningFeedMentionMenu();
}

function getLearningFeedMentionContext(inputEl) {
    if (!(inputEl instanceof HTMLTextAreaElement || inputEl instanceof HTMLInputElement)) return null;
    const value = String(inputEl.value || '');
    const caret = Number(inputEl.selectionStart || 0);
    const before = value.slice(0, caret);
    const atIndex = before.lastIndexOf('@');
    if (atIndex < 0) return null;
    const prefix = before.slice(0, atIndex);
    if (prefix && !/\s|^/.test(prefix.slice(-1))) return null;
    const token = before.slice(atIndex + 1);
    if (/\s/.test(token)) return null;
    return {
        start: atIndex,
        end: caret,
        query: token,
        before,
        after: value.slice(caret),
    };
}

function getFeedUserHandleForMention(row) {
    if (!row || typeof row !== 'object') return '';
    return String(row.username || row.user_id || '').trim();
}

function getFeedUserDisplayNameForMention(row) {
    if (!row || typeof row !== 'object') return '';
    return String(row.nickname || row.display_name || row.username || row.user_id || '').trim();
}

function getFeedUserAvatarForMention(row) {
    if (!row || typeof row !== 'object') return '';
    return String(row.avatar_url || row.avatar || '').trim();
}

async function updateLearningFeedMentionCandidates() {
    if (!learningFeedComposeMode || !els.messageInput) {
        resetLearningFeedMentionState();
        return;
    }
    const context = getLearningFeedMentionContext(els.messageInput);
    if (!context) {
        resetLearningFeedMentionState();
        return;
    }
    try {
        const api = await ensureLearningModeAssets();
        if (!api || typeof api.searchFeedUsersViaIframe !== 'function') {
            resetLearningFeedMentionState();
            return;
        }
        const query = String(context.query || '');
        const rows = await api.searchFeedUsersViaIframe(query, 8);
        const users = Array.isArray(rows) ? rows : [];
        let visible = users.length > 0;
        if (visible && query) {
            const q = query.toLowerCase();
            const exact = users.find((row) => getFeedUserHandleForMention(row).toLowerCase() === q);
            const prefixRows = users.filter((row) => getFeedUserHandleForMention(row).toLowerCase().startsWith(q));
            if (!exact && prefixRows.length === 1) {
                const onlyHandle = getFeedUserHandleForMention(prefixRows[0]).toLowerCase();
                if (q.length > onlyHandle.length || !onlyHandle.startsWith(q)) {
                    visible = false;
                }
            }
        }
        learningFeedMentionState = {
            query,
            users,
            activeIndex: 0,
            visible,
            context,
        };
        renderLearningFeedMentionMenu();
    } catch (_) {
        resetLearningFeedMentionState();
    }
}

function applyLearningFeedMentionSelection(row) {
    if (!els.messageInput || !learningFeedMentionState || !learningFeedMentionState.context) return false;
    const handle = getFeedUserHandleForMention(row);
    if (!handle) return false;
    const ctx = learningFeedMentionState.context;
    const nextValue = `${ctx.before.slice(0, ctx.start)}@${handle} ${ctx.after}`;
    els.messageInput.value = nextValue;
    try {
        const caret = ctx.before.slice(0, ctx.start).length + handle.length + 2;
        els.messageInput.setSelectionRange(caret, caret);
    } catch (_) {}
    saveMessageDraftToStorage(els.messageInput.value);
    resetLearningFeedMentionState();
    return true;
}

function ensureLearningFeedMentionMenu() {
    if (!els.messageInput || !els.messageInput.parentElement) return null;
    if (learningFeedMentionMenuEl && learningFeedMentionMenuEl.isConnected) return learningFeedMentionMenuEl;
    const menu = document.createElement('div');
    menu.id = 'learningFeedMentionMenu';
    menu.className = 'learning-feed-mention-menu';
    menu.hidden = true;
    menu.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest('[data-feed-mention-index]');
        if (!btn) return;
        event.preventDefault();
        const index = Number(btn.getAttribute('data-feed-mention-index') || 0);
        const row = Array.isArray(learningFeedMentionState.users) ? learningFeedMentionState.users[index] : null;
        if (!row) return;
        applyLearningFeedMentionSelection(row);
        renderLearningFeedMentionMenu();
        ensureMessageInputFocus({ onlyIfBlurred: true, preserveSelection: true });
    });
    els.messageInput.parentElement.appendChild(menu);
    learningFeedMentionMenuEl = menu;
    return menu;
}

function renderLearningFeedMentionMenu() {
    const menu = ensureLearningFeedMentionMenu();
    if (!menu) return;
    const state = learningFeedMentionState;
    if (!learningFeedComposeMode || !state || !state.visible || !Array.isArray(state.users) || !state.users.length) {
        menu.hidden = true;
        menu.style.display = 'none';
        menu.innerHTML = '';
        return;
    }
    menu.hidden = false;
    menu.style.display = 'grid';
    menu.innerHTML = state.users.map((row, index) => {
        const handle = getFeedUserHandleForMention(row);
        const name = getFeedUserDisplayNameForMention(row) || handle || 'User';
        const avatarUrl = getFeedUserAvatarForMention(row);
        const initial = (Array.from(String(name || '').trim())[0] || '@').toUpperCase();
        return `
            <button type="button" class="learning-feed-mention-item${index === Number(state.activeIndex || 0) ? ' is-active' : ''}" data-feed-mention-index="${index}">
                ${avatarUrl
                    ? `<img class="learning-feed-mention-avatar learning-feed-mention-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}">`
                    : `<div class="learning-feed-mention-avatar">${escapeHtml(initial)}</div>`}
                <span class="learning-feed-mention-meta">
                    <span class="learning-feed-mention-name">${escapeHtml(name)}</span>
                    <span class="learning-feed-mention-handle">@${escapeHtml(handle)}</span>
                </span>
            </button>
        `;
    }).join('');
}

function notifyLearningSidebarBridge() {
    try {
        learningSidebarListeners.forEach((listener) => {
            try { listener(); } catch (_) {}
        });
    } catch (_) {}
}

function scheduleLearningSidebarBridgeNotify(delayMs = 80) {
    if (learningSidebarNotifyTimer) return;
    const delay = Math.max(0, Number(delayMs) || 0);
    learningSidebarNotifyTimer = setTimeout(() => {
        learningSidebarNotifyTimer = null;
        notifyLearningSidebarBridge();
    }, delay);
}

function releaseLearningSidebarPendingSend(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const shouldNotify = opts.notify !== false;
    if (!learningSidebarSendInFlight) return;
    learningSidebarSendInFlight = false;
    if (shouldNotify) scheduleLearningSidebarBridgeNotify(0);
}

function getLearningSidebarMessages() {
    const rows = [];
    if (!els.messagesContainer) return rows;
    const nodes = Array.from(els.messagesContainer.querySelectorAll('.message'));
    nodes.forEach((node) => {
        const role = node.classList.contains('user')
            ? 'user'
            : (node.classList.contains('assistant') ? 'assistant' : 'system');
        const body = node.querySelector('.message-content') || node.querySelector('.message-body') || node;
        const parts = [];
        if (body) {
            const consumed = new Set();
            const markConsumed = (el) => {
                if (!el) return;
                consumed.add(el);
            };
            const isInsideConsumed = (el) => {
                let cur = el;
                while (cur && cur !== body) {
                    if (consumed.has(cur)) return true;
                    cur = cur.parentElement;
                }
                return false;
            };
            const orderedNodes = Array.from(body.querySelectorAll('.thinking-block.reasoning-thinking-block, .content-body, .tool-usage, .add-basis-view, .question-tool-card, .puzzle-tool-card'));
            orderedNodes.forEach((item) => {
                if (!(item instanceof Element) || isInsideConsumed(item)) return;
                if (item.classList.contains('thinking-block') && item.classList.contains('reasoning-thinking-block')) {
                    const contentEl = item.querySelector('.thinking-content');
                    const pending = String(contentEl && contentEl.dataset.streamLive || '') === '1'
                        || String(item.dataset.streamLive || '') === '1';
                    const raw = String(
                        contentEl && (
                            (typeof contentEl.__sourceMarkdown === 'string')
                                ? contentEl.__sourceMarkdown
                                : (contentEl.dataset.rawText || contentEl.dataset.streamRaw || contentEl.textContent || '')
                        )
                    ).trim();
                    if (!raw) return;
                    markConsumed(item);
                    parts.push({
                        kind: 'thinking',
                        format: 'markdown',
                        pending,
                        content: raw
                    });
                    return;
                }
                if (item.classList.contains('content-body')) {
                    const raw = String(
                        (typeof item.__sourceMarkdown === 'string')
                            ? item.__sourceMarkdown
                            : (item.dataset.streamRaw || item.textContent || '')
                    ).trim();
                    if (!raw) return;
                    markConsumed(item);
                    parts.push({
                        kind: 'content',
                        format: 'markdown',
                        content: raw
                    });
                    return;
                }
                if (item.classList.contains('tool-usage') || item.classList.contains('add-basis-view')) {
                    const toolName = String(item.dataset.toolName || '').trim();
                    const toolPhase = String(item.dataset.phase || '').trim().toLowerCase();
                    const toolPending = String(item.dataset.pending || '').trim().toLowerCase() === 'true';
                    const toolResolved = String(item.dataset.resolved || '').trim().toLowerCase() === 'true';
                    const statusEl = item.querySelector('.tool-status');
                    const outputEl = item.querySelector('.tool-output');
                    const statusText = String(statusEl ? (statusEl.textContent || '') : '').trim();
                    const outputText = String(outputEl ? (outputEl.textContent || '') : '').trim();
                    const fallbackText = String(item.innerText || item.textContent || '').trim();
                    const bodyText = outputText || fallbackText;
                    if (!statusText && !bodyText && !toolName) return;
                    markConsumed(item);
                    parts.push({
                        kind: 'tool',
                        format: 'tool',
                        title: toolName,
                        content: bodyText,
                        status: statusText,
                        phase: toolPhase,
                        pending: toolPending,
                        resolved: toolResolved,
                        call_id: String(item.dataset.callId || '').trim(),
                        tool_index: String(item.dataset.toolIndex || '').trim()
                    });
                    return;
                }
                if (item.classList.contains('question-tool-card')) {
                    const questionBody = item.querySelector('.question-card-body');
                    const questionCardId = String(
                        (questionBody && questionBody.dataset && questionBody.dataset.questionCardId)
                        || item.dataset.questionCardId
                        || ''
                    ).trim();
                    const questionId = String(
                        (questionBody && questionBody.dataset && questionBody.dataset.questionId)
                        || item.dataset.questionId
                        || ''
                    ).trim();
                    const questionTitle = String((item.querySelector('.question-card-title') || {}).textContent || '').trim();
                    const questionContent = String((item.querySelector('.question-card-content') || {}).textContent || '').trim();
                    const choices = Array.from(item.querySelectorAll('.question-choice-btn'))
                        .map((btn) => String((btn.dataset && btn.dataset.choiceValue) || btn.textContent || '').trim())
                        .filter(Boolean);
                    const allowOther = !!item.querySelector('.question-other-input');
                    const permissionRequest = getQuestionCardPermissionRequest(item);
                    const resolved = (
                        String(item.dataset.resolved || '').trim().toLowerCase() === 'true'
                        || !!(questionBody && questionBody.classList.contains('answered'))
                    );
                    const answerNode = item.querySelector('.question-card-answer');
                    let answerText = String(
                        (answerNode && answerNode.dataset && answerNode.dataset.answer)
                        || (answerNode ? answerNode.textContent : '')
                        || ''
                    ).trim();
                    answerText = answerText.replace(/^your answer:\s*/i, '').replace(/^已回答[：:]\s*/i, '').trim();
                    markConsumed(item);
                    parts.push({
                        kind: 'question',
                        format: 'question',
                        question: {
                            question_card_id: questionCardId,
                            question_id: questionId,
                            question_title: questionTitle,
                            question_content: questionContent,
                            choices,
                            allow_other: allowOther,
                            permission_request: permissionRequest || undefined,
                            resolved,
                            answer: answerText
                        }
                    });
                    return;
                }
                if (item.classList.contains('puzzle-tool-card')) {
                    const puzzleBody = item.querySelector('.puzzle-card-body');
                    const puzzleId = String(
                        (puzzleBody && puzzleBody.dataset && puzzleBody.dataset.puzzleCardId)
                        || item.dataset.puzzleId
                        || ''
                    ).trim();
                    const puzzleTitle = String((item.querySelector('.question-card-title') || {}).textContent || '').trim();
                    const resolved = String(item.dataset.resolved || '').trim().toLowerCase() === 'true';
                    const answerItems = Array.from(item.querySelectorAll('.puzzle-card-answer li'))
                        .map((li) => String(li.textContent || '').trim())
                        .filter(Boolean);
                    markConsumed(item);
                    parts.push({
                        kind: 'puzzle',
                        format: 'puzzle',
                        puzzle: {
                            puzzle_id: puzzleId,
                            title: puzzleTitle,
                            resolved,
                            ordered_steps: answerItems
                        }
                    });
                    return;
                }
            });
        }
        const fallbackText = String(body && body.innerText ? body.innerText : '').trim();
        if (!parts.length && !fallbackText) return;
        rows.push({
            role,
            content: fallbackText,
            parts: parts.length ? parts : [{
                kind: 'content',
                format: 'text',
                content: fallbackText
            }]
        });
    });
    return rows.slice(-24);
}

function normalizeLearningReaderContextPayload(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const windowTextRaw = String(src.window_text || src.visible_text || src.text || '').replace(/\r\n?/g, '\n');
    const windowText = normalizeSelectionTextForNotes(windowTextRaw).slice(0, 4000);
    if (!windowText) return null;
    const lectureId = String(src.lecture_id || '').trim();
    const lectureTitle = String(src.lecture_title || src.course_title || '').trim();
    const bookId = String(src.book_id || '').trim();
    const bookTitle = String(src.book_title || src.textbook_title || '').trim();
    const chapterTitle = String(src.chapter_title || '').trim();
    const chapterIndexNum = Number(src.chapter_index);
    const chapterIndex = Number.isFinite(chapterIndexNum) ? Math.max(0, Math.floor(chapterIndexNum)) : null;
    const title = String(src.reader_title || src.title || '').trim();
    const subTitle = String(src.reader_subtitle || src.subtitle || '').trim();
    const bookInfoXml = normalizeLearningReaderLongContext(src.book_info_xml || src.coarse_content || src.bookinfo_xml, 22000);
    const bookDetailXml = normalizeLearningReaderLongContext(src.book_detail_xml || src.intensive_content || src.bookdetail_xml, 26000);
    const capturedAtNum = Number(src.captured_at || src.ts || Date.now());
    const capturedAt = Number.isFinite(capturedAtNum) ? Math.floor(capturedAtNum) : Date.now();
    return {
        lecture_id: lectureId,
        lecture_title: lectureTitle,
        book_id: bookId,
        book_title: bookTitle,
        chapter_title: chapterTitle,
        chapter_index: chapterIndex,
        reader_title: title,
        reader_subtitle: subTitle,
        book_info_xml: bookInfoXml,
        book_detail_xml: bookDetailXml,
        window_text: windowText,
        captured_at: capturedAt
    };
}

function getActiveLearningCourseContext() {
    const courseWorkspace = window.NexoraLearningCourseWorkspace;

    if (courseWorkspace
        && typeof courseWorkspace.isAvailable === 'function'
        && courseWorkspace.isAvailable()) {
        if (typeof courseWorkspace.getLectureId !== 'function'
            || typeof courseWorkspace.getCourseTitle !== 'function') {
            throw new Error('课程 Workspace 缺少课程上下文接口');
        }

        return {
            lectureId: String(courseWorkspace.getLectureId() || '').trim(),
            courseTitle: String(courseWorkspace.getCourseTitle() || '').trim(),
        };
    }

    return {
        lectureId: String(
            learningReaderContextSnapshot
            && learningReaderContextSnapshot.lecture_id
            || ''
        ).trim(),
        courseTitle: String(
            learningReaderContextSnapshot
            && learningReaderContextSnapshot.lecture_title
            || ''
        ).trim(),
    };
}

function getActiveLearningCourseId() {
    return getActiveLearningCourseContext().lectureId;
}

function normalizeLearningReaderLongContext(value, maxLen) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim();
    const limit = Math.max(0, Number(maxLen) || 0);
    if (!text || !limit || text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}\n\n[content_truncated original_length=${text.length} limit=${limit}]`;
}

function buildLearningReaderContextBlocks(mode) {
    if (String(mode || '').trim().toLowerCase() !== 'learning') return [];
    const ctx = normalizeLearningReaderContextPayload(learningReaderContextSnapshot);
    if (!ctx || !ctx.window_text) return [];
    const lines = [];
    if (ctx.reader_title) lines.push(`阅读器标题: ${ctx.reader_title}`);
    if (ctx.reader_subtitle) lines.push(`阅读器副标题: ${ctx.reader_subtitle}`);
    if (ctx.lecture_title) lines.push(`课程名称: ${ctx.lecture_title}`);
    if (ctx.book_title) lines.push(`教材名称: ${ctx.book_title}`);
    if (ctx.chapter_title) lines.push(`章节: ${ctx.chapter_title}${Number.isFinite(ctx.chapter_index) ? ` (#${ctx.chapter_index + 1})` : ''}`);
    if (ctx.lecture_id) lines.push(`lecture_id: ${ctx.lecture_id}`);
    if (ctx.book_id) lines.push(`book_id: ${ctx.book_id}`);
    lines.push(`captured_at: ${new Date(Number(ctx.captured_at || Date.now())).toISOString()}`);
    lines.push('');
    lines.push('当前阅读窗口可见文本:');
    lines.push(ctx.window_text);
    const blocks = [{
        type: 'learning_reader_window',
        title: 'Web Reader 当前窗口文本',
        content: lines.join('\n')
    }];
    if (ctx.book_info_xml) {
        blocks.push({
            type: 'learning_reader_bookinfo',
            title: 'Web Reader 教材粗读内容',
            content: [
                ctx.book_title ? `教材名称: ${ctx.book_title}` : '',
                ctx.lecture_title ? `课程名称: ${ctx.lecture_title}` : '',
                ctx.book_info_xml
            ].filter(Boolean).join('\n')
        });
    }
    if (ctx.book_detail_xml) {
        blocks.push({
            type: 'learning_reader_bookdetail',
            title: 'Web Reader 教材精读内容',
            content: [
                ctx.book_title ? `教材名称: ${ctx.book_title}` : '',
                ctx.lecture_title ? `课程名称: ${ctx.lecture_title}` : '',
                ctx.book_detail_xml
            ].filter(Boolean).join('\n')
        });
    }
    return blocks;
}

function buildLearningReaderSelectionSourceMeta(rawSourceMeta, selectionText, plainText = '') {
    const src = (rawSourceMeta && typeof rawSourceMeta === 'object') ? rawSourceMeta : {};
    const source = String(src.source || '学习阅读器').trim() || '学习阅读器';
    const sourceTitle = String(src.sourceTitle || src.reader_title || src.chapter_title || '').trim();
    const anchor = {
        type: 'knowledge',
        title: sourceTitle.slice(0, 200),
        snippet: buildNoteAnchorSnippet(selectionText, 280),
        plainSnippet: buildNoteAnchorSnippet(plainText || selectionText, 280)
    };
    return { source, sourceTitle, anchor };
}

function escapeCssSelectorLiteral(raw) {
    const text = String(raw || '');
    if (!text) return '';
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
        return CSS.escape(text);
    }
    return text.replace(/["\\]/g, '\\$&');
}

function findQuestionCardById(questionId) {
    const safeId = String(questionId || '').trim();
    if (!safeId || !els.messagesContainer) return null;
    const selectorId = escapeCssSelectorLiteral(safeId);
    if (!selectorId) return null;
    const body = els.messagesContainer.querySelector(`.question-card-body[data-question-card-id="${selectorId}"]`);
    const card = body ? body.closest('.question-tool-card') : null;
    return card || null;
}

function findFirstPendingQuestionCard() {
    if (!els.messagesContainer) return null;
    const cards = Array.from(els.messagesContainer.querySelectorAll('.question-tool-card'));
    for (let i = cards.length - 1; i >= 0; i -= 1) {
        const card = cards[i];
        if (!(card instanceof Element)) continue;
        const resolved = String(card.dataset.resolved || '').trim().toLowerCase() === 'true';
        const pending = String(card.dataset.pending || '').trim().toLowerCase() === 'true';
        if (!resolved && pending) return card;
    }
    return null;
}

async function handlePuzzleIframeSubmit(detail) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.handlePuzzleIframeSubmit === 'function') {
        return api.handlePuzzleIframeSubmit(detail);
    }
    return false;
}

async function submitQuestionAnswerFromSidebar(answerText, questionId = '') {
    const finalAnswer = String(answerText || '').trim();
    if (!finalAnswer) return false;
    const questionCard = findQuestionCardById(questionId) || findFirstPendingQuestionCard();
    if (questionCard) {
        await submitQuestionAnswer(finalAnswer, questionCard);
        return true;
    }
    if (learningSidebarSendInFlight || isGenerating || !els.messageInput) return false;
    learningSidebarSendInFlight = true;
    learningSidebarDraftValue = '';
    scheduleLearningSidebarBridgeNotify(0);
    try {
        await sendMessage({
            textOverride: finalAnswer,
            displayContentOverride: finalAnswer
        });
        return true;
    } finally {
        releaseLearningSidebarPendingSend();
    }
}

window.NexoraLearningSidebarBridge = {
    getConversations: () => (Array.isArray(conversationListCache) ? conversationListCache : []),
    getCurrentConversationId: () => String(currentConversationId || '').trim(),
    getSidebarView: () => getLearningSidebarView(),
    setSidebarView: (view) => {
        const normalizedView = normalizeLearningSidebarView(view);
        const nextView = normalizedView === 'conversation'
            ? enterLearningSidebarConversationView()
            : setLearningSidebarView(normalizedView);

        if (learningSidebarMode === 'learning') {
            applyLearningSidebarMode('learning');
        }

        return nextView;
    },
    getConversationStreamState,
    loadConversation,
    deleteConversation,
    markConversationStreamRead,
    showPinContextMenu,
    isLearningConversation: (item) => getNexoraChatConversations().isLearningConversation(item),
    getMessages: () => getLearningSidebarMessages(),
    getInputValue: () => String(learningSidebarDraftValue || ''),
    setInputValue: (value) => {
        learningSidebarDraftValue = String(value || '');
    },
    send: async (text) => {
        if (learningSidebarSendInFlight || isGenerating) return;
        const next = String(text || '').trim();
        if (!next) return;
        learningSidebarSendInFlight = true;
        learningSidebarDraftValue = '';
        scheduleLearningSidebarBridgeNotify(0);
        try {
            await sendMessage({
                textOverride: next,
                displayContentOverride: next
            });
        } finally {
            releaseLearningSidebarPendingSend();
        }
    },
    subscribe: (listener) => {
        if (typeof listener !== 'function') return () => {};
        learningSidebarListeners.push(listener);
        return () => {
            learningSidebarListeners = learningSidebarListeners.filter((item) => item !== listener);
        };
    },
    submitQuestionAnswer: async (answerText, questionId = '') => submitQuestionAnswerFromSidebar(answerText, questionId),
    stop: async () => {
        if (learningSidebarSendInFlight) {
            releaseLearningSidebarPendingSend({ notify: false });
        }
        if (!isGenerating) {
            scheduleLearningSidebarBridgeNotify(0);
            return false;
        }
        stopGeneration();
        scheduleLearningSidebarBridgeNotify(0);
        return true;
    },
    isGenerating: () => !!isGenerating,
    isPendingSend: () => !!learningSidebarSendInFlight,
    isBusy: () => !!(isGenerating || learningSidebarSendInFlight),
};

function isHoverProxySuppressedBySelection() {
    if (isChatMobileLayout()) return true;
    try {
        const sel = (typeof window.getSelection === 'function') ? window.getSelection() : null;
        if (!sel) return false;
        if (sel.isCollapsed) return false;
        return String(sel.toString() || '').trim().length > 0;
    } catch (_) {
        return false;
    }
}

function pointDistanceToRect(clientX, clientY, rect) {
    const x = Number(clientX);
    const y = Number(clientY);
    const dx = (x < rect.left) ? (rect.left - x) : ((x > rect.right) ? (x - rect.right) : 0);
    const dy = (y < rect.top) ? (rect.top - y) : ((y > rect.bottom) ? (y - rect.bottom) : 0);
    return Math.hypot(dx, dy);
}

function updateHoverProxyFromClientY(clientY, clientX = Number.NaN) {
    const container = els.messagesContainer;
    if (!container) return;
    const y = Number(clientY);
    if (!Number.isFinite(y)) {
        clearHoverProxyMessage();
        return;
    }
    if (isHoverProxySuppressedBySelection()) {
        clearHoverProxyMessage();
        return;
    }
    const containerRect = container.getBoundingClientRect();
    const x = Number.isFinite(Number(clientX))
        ? Number(clientX)
        : Math.round((containerRect.left + containerRect.right) / 2);
    const outsideMargin = 16;
    if (
        x < (containerRect.left - outsideMargin)
        || x > (containerRect.right + outsideMargin)
        || y < (containerRect.top - outsideMargin)
        || y > (containerRect.bottom + outsideMargin)
    ) {
        clearHoverProxyMessage();
        return;
    }

    const rows = Array.from(container.querySelectorAll('.message'));
    if (!rows.length) {
        clearHoverProxyMessage();
        return;
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const dist = pointDistanceToRect(x, y, rect);
        if (dist < bestDistance) {
            bestDistance = dist;
            best = row;
            if (dist === 0) break;
        }
    }

    const maxDistance = 42;
    if (best && bestDistance <= maxDistance) {
        container.classList.add('has-proxy-hover');
        setHoverProxyMessage(best);
    } else {
        clearHoverProxyMessage();
    }
}

function enforceLinksOpenInNewTab(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('a[href]').forEach((a) => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
    });
}

function rewriteHtmlFragmentLinksToNewTab(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    enforceLinksOpenInNewTab(div);
    return div.innerHTML;
}

function rewriteHtmlDocumentLinksToNewTab(html) {
    const src = String(html || '');
    if (!src.trim()) return '';
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(src, 'text/html');
        enforceLinksOpenInNewTab(doc);
        const isFullDoc = /<html[\s>]/i.test(src) || /<!doctype/i.test(src);
        if (isFullDoc) {
            return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
        }
        return doc.body ? doc.body.innerHTML : src;
    } catch (e) {
        return src;
    }
}

function hasOddBackslashBefore(text, index) {
    const src = String(text || '');
    let count = 0;

    for (let i = Number(index || 0) - 1; i >= 0 && src[i] === '\\'; i -= 1) {
        count += 1;
    }

    return count % 2 === 1;
}

function isStrongFence(text, index) {
    const src = String(text || '');
    const i = Number(index || 0);

    if (src.slice(i, i + 2) !== '**') {
        return false;
    }

    if (hasOddBackslashBefore(src, i)) {
        return false;
    }

    return src[i - 1] !== '*' && src[i + 2] !== '*';
}

function readBacktickFenceLength(text, index) {
    const src = String(text || '');
    let end = Number(index || 0);

    while (end < src.length && src[end] === '`') {
        end += 1;
    }

    return end - Number(index || 0);
}

function findInlineBacktickFenceEnd(text, start, length) {
    const src = String(text || '');
    const fence = '`'.repeat(Number(length || 0));

    if (!fence) {
        return -1;
    }

    return src.indexOf(fence, Number(start || 0) + fence.length);
}

function findStrongFenceEnd(text, start) {
    const src = String(text || '');
    let i = Number(start || 0) + 2;

    while (i < src.length) {
        const next = src.indexOf('**', i);

        if (next < 0) {
            return -1;
        }

        if (isStrongFence(src, next)) {
            return next;
        }

        i = next + 2;
    }

    return -1;
}

function isStrongPunctuationBoundaryAdjacentChar(value) {
    const char = String(value || '');

    if (!char) {
        return false;
    }

    return /[\p{L}\p{N}_\p{P}\p{S}]/u.test(char);
}

function hasStrongPunctuationEdge(body) {
    const src = String(body || '');

    if (!src || /^\s|\s$/.test(src)) {
        return false;
    }

    const chars = Array.from(src);
    const firstChar = chars.length ? chars[0] : '';
    const lastChar = chars.length ? chars[chars.length - 1] : '';

    return /\p{P}/u.test(firstChar) || /\p{P}/u.test(lastChar);
}

/**
 * 修正 marked 对中文正文相邻全角标点粗体的边界误判。
 */
function shouldNormalizeStrongPunctuationBoundary(body, previousChar, nextChar) {
    if (!hasStrongPunctuationEdge(body)) {
        return false;
    }

    if (!previousChar && !nextChar) {
        return true;
    }

    return isStrongPunctuationBoundaryAdjacentChar(previousChar)
        || isStrongPunctuationBoundaryAdjacentChar(nextChar);
}

function normalizeStrongPunctuationBoundariesInLine(line) {
    const src = String(line || '');

    if (!src.includes('**')) {
        return src;
    }

    let out = '';
    let i = 0;

    while (i < src.length) {
        if (src[i] === '`') {
            const fenceLength = readBacktickFenceLength(src, i);
            const end = findInlineBacktickFenceEnd(src, i, fenceLength);

            if (end >= 0) {
                const next = end + fenceLength;
                out += src.slice(i, next);
                i = next;
                continue;
            }
        }

        if (isStrongFence(src, i)) {
            const end = findStrongFenceEnd(src, i);

            if (end > i) {
                const body = src.slice(i + 2, end);
                const previous = src[i - 1] || '';
                const next = src[end + 2] || '';

                if (shouldNormalizeStrongPunctuationBoundary(body, previous, next)) {
                    out += `<strong>${escapeHtml(body)}</strong>`;
                    i = end + 2;
                    continue;
                }
            }
        }

        out += src[i];
        i += 1;
    }

    return out;
}

function normalizeStrongPunctuationBoundaries(text) {
    const src = String(text || '');

    if (!src.includes('**')) {
        return src;
    }

    const lines = src.split('\n');
    const out = [];
    let activeFence = null;

    for (const line of lines) {
        const fence = String(line || '').match(/^\s*(`{3,}|~{3,})/);

        if (activeFence) {
            out.push(line);

            if (fence && fence[1][0] === activeFence.char && fence[1].length >= activeFence.length) {
                activeFence = null;
            }

            continue;
        }

        if (fence) {
            activeFence = {
                char: fence[1][0],
                length: fence[1].length
            };
            out.push(line);
            continue;
        }

        out.push(normalizeStrongPunctuationBoundariesInLine(line));
    }

    return out.join('\n');
}

function getNexoraChatSharedModule(name) {
    const shared = window.NexoraChatShared;

    if (!shared || typeof shared.getModule !== 'function') {
        throw new Error('NexoraChatShared 未初始化，无法读取 Chat 功能模块');
    }

    return shared.getModule(name);
}

function getNexoraChatLatex() {
    return getNexoraChatSharedModule('latex');
}

function getNexoraChatMarkdown() {
    return getNexoraChatSharedModule('markdown');
}

function getNexoraChatStreaming() {
    return getNexoraChatSharedModule('streaming');
}

function getNexoraChatStreamReconnect() {
    return getNexoraChatSharedModule('streamReconnect');
}

function getNexoraChatStreamLifecycle() {
    return getNexoraChatSharedModule('streamLifecycle');
}

function getNexoraChatConversations() {
    return getNexoraChatSharedModule('conversations');
}

function getNexoraChatConversationBranches() {
    return getNexoraChatSharedModule('conversationBranches');
}

function getNexoraChatAdmin() {
    return getNexoraChatSharedModule('admin');
}

function getNexoraSettingsManagement() {
    const module = window.NexoraSettingsManagement;

    if (!module || typeof module.init !== 'function' || typeof module.activate !== 'function') {
        throw new Error('NexoraSettingsManagement 模块未初始化');
    }

    return module;
}

function getNexoraChatAdminUsers() {
    return getNexoraChatSharedModule('adminUsers');
}

function getNexoraChatAdminSystem() {
    return getNexoraChatSharedModule('adminSystem');
}

function getNexoraChatMessageWindow() {
    return getNexoraChatSharedModule('messageWindow');
}

function getNexoraChatMessageVersions() {
    return getNexoraChatSharedModule('messageVersions');
}

function getNexoraChatMessages() {
    return getNexoraChatSharedModule('messages');
}

function getNexoraChatTools() {
    return getNexoraChatSharedModule('tools');
}

function getNexoraChatToolCanvas() {
    return getNexoraChatSharedModule('toolCanvas');
}

function getNexoraChatKnowledge() {
    return getNexoraChatSharedModule('knowledge');
}

function getNexoraChatMemorySettings() {
    return getNexoraChatSharedModule('memorySettings');
}

function getNexoraChatModelSelect() {
    return getNexoraChatSharedModule('modelSelect');
}

function getNexoraChatFiles() {
    return getNexoraChatSharedModule('files');
}

function getChatStreamingRenderDeps() {
    return {
        renderMathInElementSync: renderMathInElementSyncPreferred,
        renderMathSafe,
    };
}

function getChatMarkdownRenderDeps() {
    return {
        marked,
        normalizeStrongPunctuationBoundaries,
        normalizeLatexSyntax,
        needsAggressiveLatexRecovery,
        wrapBareLatexFragmentsOutsideMath,
        protectKnowledgeReferencesInMarkdown,
        protectFileReferencesInMarkdown,
        restoreKnowledgeReferencesInHtml,
        restoreFileReferencesInHtml,
        rewriteHtmlFragmentLinksToNewTab,
        captureLatexRenderDebug,
        streamMathFindOpenTailInfo,
        streamMathBuildProvisionalClosedTail,
        streamMarkdownFindOpenFence: (...args) => getNexoraChatStreaming().streamMarkdownFindOpenFence(...args),
        streamMarkdownBuildProvisionalClosedFence: (...args) => getNexoraChatStreaming().streamMarkdownBuildProvisionalClosedFence(...args),
        protectMathSegmentsForMarkdown,
        restoreMathSegmentsFromHtml,
    };
}

function getChatLatexRenderDeps() {
    return {
        renderMarkdownWithNewTabLinks,
        bindSourceMarkdown,
        renderMathInElement: window.renderMathInElement,
        onMathRendered: () => {
            if (Date.now() <= __messagesBottomPinUntilTs && shouldAutoScroll) {
                pinMessagesToBottomFor(900);
            }
        },
    };
}

function stripUnbalancedInlineDollarsByLine(text) {
    return getNexoraChatLatex().stripUnbalancedInlineDollarsByLine(text);
}

function countUnescapedSingleDollars(line) {
    return getNexoraChatLatex().countUnescapedSingleDollars(line);
}

function findUnescapedSingleDollarPositions(line) {
    return getNexoraChatLatex().findUnescapedSingleDollarPositions(line);
}

function looksLikeMathText(s) {
    return getNexoraChatLatex().looksLikeMathText(s);
}

function normalizeTableLineMathNoise(text) {
    return getNexoraChatLatex().normalizeTableLineMathNoise(text);
}

function escapeLikelyCurrencyDollars(text) {
    return getNexoraChatLatex().escapeLikelyCurrencyDollars(text);
}

function isLikelyPureMathSpan(body) {
    return getNexoraChatLatex().isLikelyPureMathSpan(body);
}

function normalizeMathBlockLineBreaks(text) {
    return getNexoraChatLatex().normalizeMathBlockLineBreaks(text);
}

function collapseDisplayMathForMarkdown(text) {
    return getNexoraChatLatex().collapseDisplayMathForMarkdown(text);
}

function normalizeFencedLatexBlocks(text) {
    return getNexoraChatLatex().normalizeFencedLatexBlocks(text);
}

function normalizeCenterLikeMathBlocks(text) {
    return getNexoraChatLatex().normalizeCenterLikeMathBlocks(text);
}

function normalizeIndentedGfmTables(text) {
    return getNexoraChatMarkdown().normalizeIndentedGfmTables(text);
}

function needsAggressiveLatexRecovery(text) {
    const src = String(text || '');
    if (!src) return false;
    if (/@@NEXORA_MATH_SEG_\d+@@|NEXORAMATHSEGTOKEN\d+X/.test(src)) return true;
    if (/[\\]0|[\\]1/.test(src)) return true;
    if (/\${3,}/.test(src)) return true;
    if (/\\boldsymbol\{\\vec\{[^{}]+\}\}\s*\{\\text\{[^{}]+\}\}/.test(src)) return true;
    if (/\\vec\{[^{}]+\}\s*\{\\text\{[^{}]+\}\}/.test(src)) return true;
    if (countUnescapedSingleDollars(src) % 2 !== 0) return true;
    return false;
}

function countUnescapedDoubleDollar(text) {
    const src = String(text || '');
    if (!src) return 0;
    let count = 0;
    for (let i = 0; i < src.length - 1; i += 1) {
        if (src[i] !== '$' || src[i + 1] !== '$') continue;
        if (i > 0 && src[i - 1] === '\\') continue;
        count += 1;
        i += 1;
    }
    return count;
}

function normalizeMixedDollarDelimiters(text) {
    let src = String(text || '');
    if (!src) return src;

    // `$$x$` / `$x$$` -> `$x$`
    src = src.replace(/\$\$([^\n$]{1,160})\$/g, '$$$1$');
    src = src.replace(/\$([^\n$]{1,160})\$\$/g, '$$$1$');

    // `$$` 分隔符数量为奇数时，优先补齐闭合符，尽量保留公式显示。
    if (countUnescapedDoubleDollar(src) % 2 !== 0) {
        src = `${src}$$`;
    }

    return src;
}

function normalizeBrokenDisplayDelimiters(text) {
    let src = String(text || '');
    if (!src) return src;
    const normalizeBody = (body) => String(body || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .trim()
        .replace(/\n+/g, ' ');

    // `$$\[ ... \]$$` => `$$ ... $$`
    src = src.replace(/\$\$\s*\\\[([\s\S]*?)\\\]\s*\$\$/g, (_, body) => {
        return `$$${normalizeBody(body)}$$`;
    });
    // `$\[ ... \]$` => `$$ ... $$`
    src = src.replace(/\$\s*\\\[([\s\S]*?)\\\]\s*\$/g, (_, body) => {
        return `$$${normalizeBody(body)}$$`;
    });
    // `$$\[ ... $$ ]` => `$$ ... $$` (common broken copy)
    src = src.replace(/\$\$\s*\\\[([\s\S]*?)\$\$\s*\]/g, (_, body) => {
        return `$$${normalizeBody(body)}$$`;
    });
    // `$\[ ... $ ```]` => `$$ ... $$` (broken mixed delimiters from copied content)
    src = src.replace(/\$\s*\\\[([\s\S]*?)\$\s*`{3}\s*\]?/g, (_, body) => {
        return `$$${normalizeBody(body)}$$`;
    });
    return src;
}

function normalizeVectorTextSuffixes(text) {
    let src = String(text || '');
    if (!src) return src;
    src = src.replace(/\\boldsymbol\{\s*\\vec\{([^{}]+)\}\s*\}\s*\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\boldsymbol{\\vec{$1}}_{\\text{$2}}');
    src = src.replace(/\\boldsymbol\{\s*\\vec\{([^{}]+)\}\s*\}\s*\{\s*\\mathrm\{([^{}]+)\}\s*\}/g, '\\boldsymbol{\\vec{$1}}_{\\mathrm{$2}}');
    src = src.replace(/\\vec\{\s*([^{}]+)\s*\}\s*\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\vec{$1}_{\\text{$2}}');
    src = src.replace(/\\vec\{\s*([^{}]+)\s*\}\s*\{\s*\\mathrm\{([^{}]+)\}\s*\}/g, '\\vec{$1}_{\\mathrm{$2}}');
    return src;
}

function normalizeLatexSyntax(text) {
    let src = String(text || '');
    if (!src) return src;

    // 清理历史版本渲染时泄漏到文本中的占位符。
    src = src
        .replace(/@@NEXORA_MATH_SEG_\d+@@/g, '')
        .replace(/NEXORAMATHSEGTOKEN\d+X/g, '');

    // Assistant often returns fenced latex blocks; unwrap first so markdown won't lock them in <pre><code>.
    src = normalizeFencedLatexBlocks(src);

    // 连续美元符常见于模型输出抖动（如 $$$ / $$$$），先归一化。
    src = src.replace(/\${3,}/g, '$$');
    src = normalizeMixedDollarDelimiters(src);
    src = normalizeBrokenDisplayDelimiters(src);

    // 清理零宽字符、软换行等不可见符，避免污染数学解析。
    src = removeInvisibleTextChars(src).replace(PRIVATE_USE_AREA_PATTERN, ''); // Private Use Area（常见于复制后的脏符号）

    // 先处理金额符号，防止 `$1,000` 触发 LaTeX 分隔符并吞掉后续 Markdown。
    src = escapeLikelyCurrencyDollars(src);

    // 先做 markdown 层表格规范化，避免合法表格因缩进丢失渲染。
    src = normalizeIndentedGfmTables(src);

    // 这两类是安全修复：不依赖脏数据判定，始终执行。
    src = normalizeVectorTextSuffixes(src);
    src = normalizeMathBlockLineBreaks(src);
    src = normalizeCenterLikeMathBlocks(src);
    src = collapseDisplayMathForMarkdown(src);

    // 正常输出不做激进修复，避免误改合法 markdown/LaTeX。
    if (!needsAggressiveLatexRecovery(src)) {
        return src;
    }

    // 常见脏字符（PUA）里出现的“不等于”占位，替换为正常字符。
    src = src.replaceAll(DIRTY_NOT_EQUAL_PLACEHOLDER, '≠');

    // OCR/复制常见矩阵换行误写：\0、\1 通常应为 \\（行分隔）。
    src = src.replace(/(^|[^\\])\\0/g, '$1\\\\');
    src = src.replace(/(^|[^\\])\\1/g, '$1\\\\');

    // 修正常见错误数学转义：\ c、\ +、\ - 等，本意通常是矩阵换行。
    // 只处理“单反斜杠 + 空白/符号”，不会破坏 \det、\begin 等正常命令。
    src = src.replace(/(^|[^\\])\\(?=(?:\s|[+\-−]))/g, '$1\\\\');

    // 公式中常见“误插入 $”修复：
    // 例如：$\boldsymbol{\vec{v}}_{\text{绝对}} = $\boldsymbol{\vec{v}}_{\text{相对}}
    // 这里第二个 $ 是脏分隔符，应移除。
    src = src.replace(/([=+\-*/(（\s])\$(\s*\\(?:boldsymbol|vec|frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|alpha|beta|gamma|omega|theta|neq|leq|geq|times|cdot))/g, '$1$2');

    // 修复 `\ $\text{kg}` 这类在公式内部被拆开的写法。
    src = src.replace(/\\\s*\$\s*\\text\{/g, '\\ \\text{');

    // 单美元符跨多行时，仅对“纯数学内容”提升为块公式；混排文本则去掉外层美元符，避免整段渲染失败。
    src = src.replace(/\$([^$\n]*\n[\s\S]*?)\$/g, (_, body) => {
        const b = String(body || '');
        if (isLikelyPureMathSpan(b)) return `$$${b.trim()}$$`;
        return b;
    });
    // 行内公式美元符不成对时，先去掉孤立 `$`，后续再走裸公式兜底包裹。
    src = stripUnbalancedInlineDollarsByLine(src);
    // markdown 表格行常被误插入 `$`，额外清洗一次。
    src = normalizeTableLineMathNoise(src);

    return src;
}

function wrapBareLatexFragments(text) {
    const src = String(text || '');
    if (!src) return src;

    // 把裸露的常见 LaTeX 片段包成行内公式。
    // 示例：\boldsymbol{\vec{a}}'=0 -> $\boldsymbol{\vec{a}}'=0$
    const pattern = /(^|[\s(（:：，,])((?:\\(?:boldsymbol|vec|frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|alpha|beta|gamma|omega|theta|neq|leq|geq|times|cdot|begin|end|det)\b(?:[^\n|$`@，。；：、<>()（）])*))/g;
    return src.replace(pattern, (_, pre, frag) => `${pre}$${frag}$`);
}

function splitMathAwareSegments(text) {
    return getNexoraChatLatex().splitMathAwareSegments(text);
}

function shouldCaptureLatexRenderDebug(text) {
    const src = String(text || '');
    if (!src) return false;
    return /\\begin\{|\\\(|\\\[|\$\$|\$(?:\\.|[^$\n\\])+\$|nx-mseg-placeholder|NX_MSEG|NEXORAMATHSEG/i.test(src);
}

function captureLatexRenderDebug(stage, raw, normalized, html) {
    const source = String(raw || '');
    if (!shouldCaptureLatexRenderDebug(source)) return;
    try {
        const entry = {
            stage: String(stage || 'render'),
            ts: Date.now(),
            raw: source,
            normalized: String(normalized || ''),
            html: String(html || '')
        };
        const store = Array.isArray(window.__nexoraLatexDebug) ? window.__nexoraLatexDebug : [];
        store.push(entry);
        while (store.length > 24) store.shift();
        window.__nexoraLatexDebug = store;
        window.__nexoraLatexDebugLast = entry;
        window.__nexoraDumpLatexDebug = function() {
            try {
                const arr = Array.isArray(window.__nexoraLatexDebug) ? window.__nexoraLatexDebug : [];
                console.log('[NexoraLaTeXDump]', arr);
                return arr;
            } catch (_) {
                return [];
            }
        };
    } catch (_) {
        // ignore debug failures
    }
}

function protectMathSegmentsForMarkdown(text) {
    return getNexoraChatLatex().protectMathSegmentsForMarkdown(text);
}

function restoreMathSegmentsFromHtml(html, map) {
    return getNexoraChatLatex().restoreMathSegmentsFromHtml(html, map);
}

function looksLikeLatexRenderableCodeBlock(text, className = '') {
    return getNexoraChatLatex().looksLikeLatexRenderableCodeBlock(text, className);
}

function promoteLatexCodeBlocks(root) {
    return getNexoraChatLatex().promoteLatexCodeBlocks(root, getChatLatexRenderDeps());
}

function wrapBareLatexFragmentsOutsideMath(text) {
    const segs = splitMathAwareSegments(text);
    if (!segs.length) return String(text || '');
    return segs.map((seg) => {
        if (seg.isMath) return seg.text;
        return wrapBareLatexFragments(seg.text);
    }).join('');
}

function splitKnowledgeReferencePayload(...args) {
    return knowledgeController.splitKnowledgeReferencePayload(...args);
}

function clipKnowledgeReferenceLabel(...args) {
    return knowledgeController.clipKnowledgeReferenceLabel(...args);
}

function renderKnowledgeReferenceTag(...args) {
    return knowledgeController.renderKnowledgeReferenceTag(...args);
}

function normalizeFileReferencePath(fileRef) {
    const raw = String(fileRef || '').trim().replace(/\\/g, '/');

    if (/^\/[^/]+\/files\/.+/.test(raw)) {
        return raw.slice(1);
    }

    return raw;
}

function clipFileReferenceLabel(text, limit = 28) {
    const raw = String(text || '').replace(/\\/g, '/').trim();
    const filename = raw.split('/').filter(Boolean).pop() || raw;
    const value = filename.replace(/\s+/g, ' ').trim();

    if (value.length <= limit) {
        return value;
    }

    return `${value.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function readFileReferenceExtension(fileRef) {
    const extMatch = String(fileRef || '').trim().toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
    return extMatch ? extMatch[1] : '';
}

function resolveFileReferenceIconClass(fileRef) {
    const key = readFileReferenceExtension(fileRef);

    if (/^(md|markdown|txt|text|log|json|yaml|yml|xml|csv)$/i.test(key)) {
        return 'fa-regular fa-file-lines';
    }

    if (/^(doc|docx|word)$/i.test(key)) {
        return 'fa-regular fa-file-word';
    }

    if (/^(pdf)$/i.test(key)) {
        return 'fa-regular fa-file-pdf';
    }

    if (/^(sql|db|sqlite)$/i.test(key)) {
        return 'fa-solid fa-database';
    }

    return 'fa-regular fa-file';
}

function renderFileReferenceTag(payload) {
    const fileRef = normalizeFileReferencePath(payload);

    if (!fileRef) {
        return escapeHtml(`[file]${String(payload || '')}[/file]`);
    }

    const label = clipFileReferenceLabel(fileRef);
    const iconClass = resolveFileReferenceIconClass(fileRef);

    return [
        '<span class="file-reference" data-file-ref="',
        escapeHtml(fileRef),
        '" title="',
        escapeHtml(`文件：${fileRef}`),
        '"><span class="file-reference-main"><span class="file-reference-icon"><i class="',
        escapeHtml(iconClass),
        '" aria-hidden="true"></i></span><span class="file-reference-text"><span class="file-reference-name">',
        escapeHtml(label),
        '</span><span class="file-reference-meta">',
        escapeHtml('读取中'),
        '</span></span><button type="button" class="file-reference-download" title="下载文件" data-file-ref="',
        escapeHtml(fileRef),
        '"><i class="fa-solid fa-download" aria-hidden="true"></i></button></span>',
        '<span class="file-reference-summary" hidden></span>',
        '</span>'
    ].join('');
}

function protectKnowledgeReferencesInMarkdown(...args) {
    return knowledgeController.protectKnowledgeReferencesInMarkdown(...args);
}

function protectFileReferencesInMarkdown(text) {
    const refs = [];
    const protectedText = String(text || '').replace(/\[file\]([\s\S]*?)\[\/file\]/g, (_match, payload) => {
        const index = refs.length;
        refs.push(renderFileReferenceTag(payload));
        return `@@NEXORA_FILE_REF_${index}@@`;
    });

    return {
        text: protectedText,
        refs
    };
}

function restoreKnowledgeReferencesInHtml(...args) {
    return knowledgeController.restoreKnowledgeReferencesInHtml(...args);
}

function restoreFileReferencesInHtml(html, refs = []) {
    let output = String(html || '');

    refs.forEach((refHtml, index) => {
        output = output.split(`@@NEXORA_FILE_REF_${index}@@`).join(refHtml);
    });

    return output;
}

function renderMarkdownWithNewTabLinks(text, options = {}) {
    return getNexoraChatMarkdown().renderMarkdownWithNewTabLinks(text, options, getChatMarkdownRenderDeps());
}

function shouldUseStreamingMarkdownBreaks(root) {
    return getNexoraChatMarkdown().shouldUseStreamingMarkdownBreaks(root);
}

function renderStreamingMarkdownWithNewTabLinks(text, options = {}) {
    return getNexoraChatMarkdown().renderStreamingMarkdownWithNewTabLinks(text, options, getChatMarkdownRenderDeps());
}

function renderStreamBlockMarkdown(root, text, options = {}) {
    return getNexoraChatMarkdown().renderStreamBlockMarkdown(root, text, options, getChatMarkdownRenderDeps());
}



function renderMarkdownForNotes(text) {
    return getNexoraChatMarkdown().renderMarkdownForNotes(text, getChatMarkdownRenderDeps());
}

function renderMathSafe(root, options = {}) {
    return getNexoraChatLatex().renderMathSafe(root, options, getChatLatexRenderDeps());
}

function rewriteCitationRefsMarkdown(text, citationMap) {
    const src = String(text || '');
    if (!src) return src;
    const map = (citationMap && typeof citationMap === 'object') ? citationMap : {};
    return src.replace(/\[ref_(\d+)\]/g, (_, n) => {
        const idx = Number(n || 0);
        const url = map[idx] || map[String(idx)] || '';
        if (url) return `[ref_${idx}](${url})`;
        return '';
    });
}

function normalizeClientJsTimeoutMs(...args) {
    return getNexoraChatToolCanvas().normalizeClientJsTimeoutMs(...args);
}

function normalizeClientJsCode(...args) {
    return getNexoraChatToolCanvas().normalizeClientJsCode(...args);
}

function parseJsonObjectMaybe(...args) {
    return getNexoraChatToolCanvas().parseJsonObjectMaybe(...args);
}

function detectThreeUsageInJsCode(...args) {
    return getNexoraChatToolCanvas().detectThreeUsageInJsCode(...args);
}

function detectPlot3DUsageInJsCode(...args) {
    return getNexoraChatToolCanvas().detectPlot3DUsageInJsCode(...args);
}

function extractRequestedJsLibs(...args) {
    return getNexoraChatToolCanvas().extractRequestedJsLibs(...args);
}

function needsThreeJsForCanvas(...args) {
    return getNexoraChatToolCanvas().needsThreeJsForCanvas(...args);
}

function needsPlot3DHelper(...args) {
    return getNexoraChatToolCanvas().needsPlot3DHelper(...args);
}

function loadScriptByUrl(...args) {
    return getNexoraChatToolCanvas().loadScriptByUrl(...args);
}

async function ensureClientJsThreeLoaded(...args) {
    return getNexoraChatToolCanvas().ensureClientJsThreeLoaded(...args);
}

function createPlot3DHelper(...args) {
    return getNexoraChatToolCanvas().createPlot3DHelper(...args);
}

function enforceCanvasDisplayAspect(...args) {
    return getNexoraChatToolCanvas().enforceCanvasDisplayAspect(...args);
}

function clampNumber(...args) {
    return getNexoraChatToolCanvas().clampNumber(...args);
}

function normalizeThreeTargetVector(...args) {
    return getNexoraChatToolCanvas().normalizeThreeTargetVector(...args);
}

function createThreeOrbitController(...args) {
    return getNexoraChatToolCanvas().createThreeOrbitController(...args);
}

function detectCanvasUsageInJsCode(...args) {
    return getNexoraChatToolCanvas().detectCanvasUsageInJsCode(...args);
}

function detect2DContextUsageInJsCode(...args) {
    return getNexoraChatToolCanvas().detect2DContextUsageInJsCode(...args);
}

function normalizeCanvasDimension(...args) {
    return getNexoraChatToolCanvas().normalizeCanvasDimension(...args);
}

function extractCanvasMetaFromJsPayload(...args) {
    return getNexoraChatToolCanvas().extractCanvasMetaFromJsPayload(...args);
}

function rememberClientJsCanvasMeta(...args) {
    return getNexoraChatToolCanvas().rememberClientJsCanvasMeta(...args);
}

function findClientJsCanvasMetaFromResultPayload(...args) {
    return getNexoraChatToolCanvas().findClientJsCanvasMetaFromResultPayload(...args);
}

function parseJsExecuteArgumentsMeta(...args) {
    return getNexoraChatToolCanvas().parseJsExecuteArgumentsMeta(...args);
}

function ensureMessageCanvasState(...args) {
    return getNexoraChatToolCanvas().ensureMessageCanvasState(...args);
}

function placeCanvasCardsBelowToolChain(...args) {
    return getNexoraChatToolCanvas().placeCanvasCardsBelowToolChain(...args);
}

function buildCanvasLookupKeys(...args) {
    return getNexoraChatToolCanvas().buildCanvasLookupKeys(...args);
}

function isClientJsExecToolName(...args) {
    return getNexoraChatToolCanvas().isClientJsExecToolName(...args);
}

function rememberJsExecuteCanvasCall(...args) {
    return getNexoraChatToolCanvas().rememberJsExecuteCanvasCall(...args);
}

function createToolCanvasCard(...args) {
    return getNexoraChatToolCanvas().createToolCanvasCard(...args);
}

async function runCanvasCodeInCard(...args) {
    return getNexoraChatToolCanvas().runCanvasCodeInCard(...args);
}

function maybeRenderCanvasFromJsExecuteResult(...args) {
    return getNexoraChatToolCanvas().maybeRenderCanvasFromJsExecuteResult(...args);
}

function rememberClientToolRequestId(requestId) {
    return clientToolController.rememberClientToolRequestId(requestId);
}

function buildClientJsWorkerSource(...args) {
    return getNexoraChatToolCanvas().buildClientJsWorkerSource(...args);
}

async function executeClientJsInWorker(...args) {
    return getNexoraChatToolCanvas().executeClientJsInWorker(...args);
}

async function submitClientToolResult(conversationId, requestId, execRes) {
    return clientToolController.submitClientToolResult(conversationId, requestId, execRes);
}

async function handleClientToolRequest(req, expectedConversationId = '') {
    return clientToolController.handleClientToolRequest(req, expectedConversationId);
}

async function drainClientToolWssQueue() {
    return clientToolController.drainClientToolWssQueue();
}

function enqueueClientToolWssRequest(req, conversationId) {
    return clientToolController.enqueueClientToolWssRequest(req, conversationId);
}

async function pollClientToolRequests() {
    return clientToolController.pollClientToolRequests();
}

function calcNextClientToolPollDelay(outcome) {
    return clientToolController.calcNextClientToolPollDelay(outcome);
}

function scheduleNextClientToolPoll(immediate = false) {
    return clientToolController.scheduleNextClientToolPoll(immediate);
}

function stopClientToolPolling() {
    return clientToolController.stopClientToolPolling();
}

function startClientToolPolling() {
    return clientToolController.startClientToolPolling();
}

function isNexoraMailEnabled() {
    return window.NEXORA_MAIL_ENABLED === true;
}

function getNexoraChatMails() {
    return getNexoraChatSharedModule('mails');
}

function getNexoraChatMailsIfEnabled() {
    if (!isNexoraMailEnabled()) {
        return null;
    }

    return getNexoraChatMails();
}

function getCurrentUrlParams() {
    return new URLSearchParams(window.location.search || '');
}

function isMailViewUrl() {
    const p = getCurrentUrlParams();
    return p.get('view') === 'mail';
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

async function refreshMailEntryVisibility(options = {}) {
    const api = getNexoraChatMailsIfEnabled();
    return api ? await api.refreshMailEntryVisibility(options) : false;
}

function initMailUiState() {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.initMailUiState();
}

function renderMailNotifyBadge() {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.renderMailNotifyBadge();
}

function startMailRealtimeSync() {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.startMailRealtimeSync();
}

function stopMailRealtimeSync() {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.stopMailRealtimeSync();
}

function flushDeferredMailEvents() {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.flushDeferredMailEvents();
}

function handleBrowserMailChangedEvent(payload) {
    const api = getNexoraChatMailsIfEnabled();
    if (api) void api.handleBrowserMailChangedEvent(payload);
}

function isMailMobileLayout() {
    const api = getNexoraChatMailsIfEnabled();
    return api ? api.isMailMobileLayout() : false;
}

function setMailDetailOpen(showDetail) {
    const api = getNexoraChatMailsIfEnabled();
    if (api) api.setMailDetailOpen(showDetail);
}

async function openMailPlaceholderView() {
    return await getNexoraChatMails().openMailPlaceholderView();
}

function renderAdminMailCreateForm() {
    return getNexoraChatMails().renderAdminMailCreateForm();
}

function renderAdminMailUsersList() {
    return getNexoraChatMails().renderAdminMailUsersList();
}

async function loadAdminMailUsersList() {
    return await getNexoraChatMails().loadAdminMailUsersList();
}

function setAdminMailUserFilterKeyword(value) {
    return getNexoraChatMails().setAdminMailUserFilterKeyword(value);
}

function resetAdminMailUserFilterKeyword() {
    return getNexoraChatMails().resetAdminMailUserFilterKeyword();
}

function setAdminMailGroup(value) {
    return getNexoraChatMails().setAdminMailGroup(value);
}

function isChatMobileLayout() {
    try {
        return window.matchMedia('(max-width: 980px)').matches;
    } catch (e) {
        return window.innerWidth <= 980;
    }
}

function isSidebarOverlayLayout() {
    const sidebar = (els && els.sidebar) ? els.sidebar : document.getElementById('sidebar');

    if (!sidebar) {
        return false;
    }

    const styles = window.getComputedStyle(sidebar);
    const position = String(styles.position || '').trim().toLowerCase();

    return position === 'fixed' || position === 'absolute';
}

function closeMobileHeaderMenu() {
    const menu = document.getElementById('mobileHeaderMenu') || els.mobileHeaderMenu;
    const panel = document.getElementById('mobileHeaderMenuPanel') || els.mobileHeaderMenuPanel;
    if (menu) menu.classList.remove('open');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    const trigger = document.getElementById('mobileHeaderMenuTrigger') || els.mobileHeaderMenuTrigger;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function positionMobileHeaderMenuPanel() {
    const trigger = document.getElementById('mobileHeaderMenuTrigger') || els.mobileHeaderMenuTrigger;
    const panel = document.getElementById('mobileHeaderMenuPanel') || els.mobileHeaderMenuPanel;
    if (!trigger || !panel) return;
    if (!isChatMobileLayout()) {
        panel.style.top = '';
        panel.style.left = '';
        panel.style.right = '';
        return;
    }
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const panelWidth = panel.offsetWidth || 142;
    const top = Math.max(6, Math.round(rect.bottom + gap));
    let left = Math.round(rect.right - panelWidth);
    left = Math.max(8, Math.min(left, Math.max(8, vw - panelWidth - 8)));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
}

function getModalStackManager() {
    const manager = window.NexoraSettingsDialog;

    if (
        !manager
        || typeof manager.registerModalBackdrop !== 'function'
        || typeof manager.handleModalBackdropStackingChange !== 'function'
        || typeof manager.getModalLayerStep !== 'function'
    ) {
        throw new Error('NexoraSettingsDialog 统一弹窗栈未初始化');
    }

    return manager;
}

function handleBackdropStackingChange(backdrop) {
    getModalStackManager().handleModalBackdropStackingChange(backdrop);
}

function registerModalBackdropStacking(backdrop) {
    getModalStackManager().registerModalBackdrop(backdrop);
}

function bindBackdropSafeClose(backdrop, onClose) {
    const modal = backdrop;
    if (!modal || typeof onClose !== 'function') return;
    if (modal.dataset.safeCloseBound === '1') return;
    modal.dataset.safeCloseBound = '1';

    let pressedOnBackdrop = false;

    const onStart = (e) => {
        pressedOnBackdrop = (e.target === modal);
    };
    const onEnd = (e) => {
        const shouldClose = pressedOnBackdrop && (e.target === modal);
        pressedOnBackdrop = false;
        if (!shouldClose) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
    };
    const onCancel = () => {
        pressedOnBackdrop = false;
    };
    const swallowBackdropClick = (e) => {
        if (e.target !== modal) return;
        // Avoid legacy click close paths when selection drag ends outside the dialog.
        e.preventDefault();
        e.stopPropagation();
    };

    modal.addEventListener('mousedown', onStart);
    modal.addEventListener('mouseup', onEnd);
    modal.addEventListener('mouseleave', onCancel);
    modal.addEventListener('touchstart', onStart, { passive: true });
    modal.addEventListener('touchend', onEnd);
    modal.addEventListener('touchcancel', onCancel);
    modal.addEventListener('click', swallowBackdropClick, true);
}

function loadDebugConsoleEnabled() {
    try {
        return localStorage.getItem(DEBUG_CONSOLE_ENABLED_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function saveDebugConsoleEnabled(enabled) {
    try {
        localStorage.setItem(DEBUG_CONSOLE_ENABLED_KEY, enabled ? '1' : '0');
    } catch (_) {}
}

function isDebugConsoleEnabled() {
    return !!debugConsoleState.enabled;
}

function isDebugConsoleNearBottom() {
    const body = els.debugConsoleBody;
    if (!body) return true;
    return (body.scrollHeight - body.scrollTop - body.clientHeight) < 40;
}

function formatDebugConsoleTime(ts) {
    try {
        const d = (ts instanceof Date) ? ts : new Date(ts || Date.now());
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        return `${hh}:${mm}:${ss}.${ms}`;
    } catch (_) {
        return '--:--:--.---';
    }
}

function formatDebugConsolePayload(payload) {
    if (payload === null || payload === undefined) return '';
    if (isDebugContextManagerPayload(payload)) return formatDebugContextManagerPayloadText(payload);
    if (typeof payload === 'string') return payload;

    try {
        return JSON.stringify(payload, null, 2);
    } catch (_) {
        return String(payload);
    }
}

function isDebugContextManagerPayload(payload) {
    return !!(
        payload &&
        typeof payload === 'object' &&
        String(payload.format || '') === 'context_manager' &&
        Array.isArray(payload.blocks)
    );
}

function normalizeDebugContextKindClass(kind) {
    const value = String(kind || '').trim().toLowerCase();

    if (value === 'system_prompt') return 'system-prompt';
    if (value === 'system_context') return 'system-context';
    if (value === 'tool_call') return 'tool-call';
    if (value === 'tool_result') return 'tool-result';
    if (value === 'compressed') return 'compressed';

    return 'context';
}

function formatDebugContextMetaText(meta) {
    if (!meta || typeof meta !== 'object') return '';

    try {
        return JSON.stringify(meta, null, 2);
    } catch (_) {
        return String(meta);
    }
}

function formatDebugContextManagerPayloadText(payload) {
    const blocks = Array.isArray(payload && payload.blocks) ? payload.blocks : [];

    return blocks.map((block) => {
        const label = String((block && block.label) || 'Ctx').trim();
        const role = String((block && block.role) || 'message').trim();
        const kind = String((block && block.kind) || 'context').trim();
        const content = String((block && block.content) || '').trim();
        const meta = formatDebugContextMetaText(block && block.meta).trim();
        const body = [content, meta].filter(Boolean).join('\n\n');

        return `[${label}] ${role} · ${kind}${body ? `\n${body}` : ''}`;
    }).join('\n\n');
}

function appendDebugContextPre(parent, text, className = '') {
    const value = String(text || '');

    if (!value.trim()) return;

    const pre = document.createElement('pre');
    pre.className = `debug-context-block-content${className ? ` ${className}` : ''}`;
    pre.textContent = value;
    parent.appendChild(pre);
}

function parseDebugContextJsonPayload(text) {
    const raw = String(text || '').trim();

    if (!raw || raw[0] !== '{') return null;

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function appendDebugContextRenderedFunctionOutput(parent, text) {
    const payload = parseDebugContextJsonPayload(text);

    if (!payload || String(payload.type || '').trim() !== 'function_call_output') {
        appendDebugContextPre(parent, text);
        return;
    }

    const output = String(payload.output || '').trim();

    if (!output) {
        appendDebugContextPre(parent, text);
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'debug-context-tool-output';

    const head = document.createElement('div');
    head.className = 'debug-context-tool-output-head';

    const typeEl = document.createElement('span');
    typeEl.textContent = 'function_call_output';
    head.appendChild(typeEl);

    const callId = String(payload.call_id || '').trim();

    if (callId) {
        const callEl = document.createElement('span');
        callEl.textContent = callId;
        head.appendChild(callEl);
    }

    wrap.appendChild(head);

    const rendered = document.createElement('div');
    rendered.className = 'debug-context-tool-output-rendered';
    rendered.innerHTML = renderMarkdownWithNewTabLinks(output);
    renderMathSafe(rendered);
    highlightCode(rendered);
    wrap.appendChild(rendered);

    appendDebugContextPre(wrap, text, 'raw-json');
    parent.appendChild(wrap);
}

function buildDebugContextManagerPayloadElement(payload) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-context-flow';
    const blocks = Array.isArray(payload && payload.blocks) ? payload.blocks : [];

    blocks.forEach((rawBlock) => {
        const block = rawBlock && typeof rawBlock === 'object' ? rawBlock : {};
        const kind = String(block.kind || 'context').trim();
        const role = String(block.role || 'message').trim();
        const label = String(block.label || 'Ctx').trim();
        const content = String(block.content || '');
        const metaText = formatDebugContextMetaText(block.meta);
        const card = document.createElement('div');
        card.className = `debug-context-block ${normalizeDebugContextKindClass(kind)}`;

        const head = document.createElement('div');
        head.className = 'debug-context-block-head';

        const labelEl = document.createElement('span');
        labelEl.className = 'debug-context-block-label';
        labelEl.textContent = label || 'Ctx';
        head.appendChild(labelEl);

        const roleEl = document.createElement('span');
        roleEl.className = 'debug-context-block-role';
        roleEl.textContent = role || 'message';
        head.appendChild(roleEl);

        const kindEl = document.createElement('span');
        kindEl.className = 'debug-context-block-kind';
        kindEl.textContent = kind || 'context';
        head.appendChild(kindEl);

        card.appendChild(head);
        appendDebugContextRenderedFunctionOutput(card, content);
        appendDebugContextPre(card, metaText, 'meta');
        wrapper.appendChild(card);
    });

    if (blocks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'debug-context-empty';
        empty.textContent = 'No context blocks';
        wrapper.appendChild(empty);
    }

    return wrapper;
}

function renderDebugConsolePayload(container, payload) {
    if (!container) return;

    container.innerHTML = '';

    if (isDebugContextManagerPayload(payload)) {
        container.appendChild(buildDebugContextManagerPayloadElement(payload));
        return;
    }

    const pre = document.createElement('pre');
    pre.className = 'debug-console-plain-payload';
    pre.textContent = formatDebugConsolePayload(payload);
    container.appendChild(pre);
}

function getDebugDirectionLabel(direction) {
    const value = String(direction || '').trim();
    if (value === 'server->model') return 'S->M';
    if (value === 'model->server') return 'M->S';
    if (value === 'client->local') return 'LOCAL';
    return value || 'TRACE';
}

function getDebugDirectionClass(direction) {
    const value = String(direction || '').trim();
    if (value === 'server->model') return 'server-model';
    if (value === 'model->server') return 'model-server';
    return 'client-local';
}

function updateDebugConsoleStatus() {
    const panel = els.debugConsolePanel;
    const status = els.debugConsoleStatus;
    if (!panel || !status) return;
    panel.classList.toggle('active', !!debugConsoleState.open);
    panel.setAttribute('aria-hidden', debugConsoleState.open ? 'false' : 'true');
    if (!debugConsoleState.enabled) {
        status.textContent = 'OFF';
    } else if (debugConsoleState.activeTab === 'function') {
        status.textContent = `FUNC ${debugConsoleState.toolCatalog.length}`;
    } else {
        status.textContent = `ON ${debugConsoleState.entries.length}`;
    }
}

function ensureDebugConsoleEmptyState() {
    const body = els.debugConsoleBody;
    if (!body) return;
    if (debugConsoleState.entries.length > 0) {
        const empty = body.querySelector('.debug-console-empty');
        if (empty) empty.remove();
        return;
    }
    body.innerHTML = '<div class="debug-console-empty">按 Ctrl+D 开启模型调试</div>';
}

function buildDebugConsoleEntryElement(entry) {
    const item = document.createElement('div');
    const stageText = String((entry && entry.stage) || '').trim();
    const isCompressionTrace = stageText.startsWith('context_compression');
    item.className = `debug-console-entry ${getDebugDirectionClass(entry.direction)}${isCompressionTrace ? ' compression-trace' : ''}`;
    item.dataset.entryId = String(entry.id || '');
    item.innerHTML = `
        <div class="debug-console-entry-head">
            <div class="debug-console-entry-meta">
                <span class="debug-console-entry-dir">${escapeHtml(getDebugDirectionLabel(entry.direction))}</span>
                <span class="debug-console-entry-title">${escapeHtml(entry.title || entry.stage || 'trace')}</span>
            </div>
            <span class="debug-console-entry-stage">${escapeHtml(formatDebugConsoleTime(entry.ts))} · ${escapeHtml(entry.stage || '-')}</span>
        </div>
        <div class="debug-console-entry-payload"></div>
    `;
    renderDebugConsolePayload(item.querySelector('.debug-console-entry-payload'), entry.payload);
    return item;
}

function updateDebugConsoleEntryElement(entry) {
    const body = els.debugConsoleBody;
    if (!body) return;
    const item = body.querySelector(`.debug-console-entry[data-entry-id="${String(entry.id || '')}"]`);
    if (!item) return;
    renderDebugConsolePayload(item.querySelector('.debug-console-entry-payload'), entry.payload);
    const stage = item.querySelector('.debug-console-entry-stage');
    if (stage) stage.textContent = `${formatDebugConsoleTime(entry.ts)} · ${entry.stage || '-'}`;
}

function getDebugConsoleMergeKey(entry) {
    return '';
}

function appendDebugConsoleEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const body = els.debugConsoleBody;
    if (!body) return;
    const entry = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        ts: Date.now(),
        direction: String(rawEntry.direction || 'client->local'),
        stage: String(rawEntry.stage || 'trace'),
        title: String(rawEntry.title || rawEntry.stage || 'trace'),
        payload: rawEntry.payload,
        round: Number.isFinite(Number(rawEntry.round)) ? Number(rawEntry.round) : null,
        replaceKey: String(rawEntry.replaceKey || '').trim()
    };
    const mergeKey = getDebugConsoleMergeKey(entry);
    const nearBottom = isDebugConsoleNearBottom();
    if (entry.replaceKey) {
        const existing = debugConsoleState.entries.find((item) => item && item.replaceKey === entry.replaceKey);
        if (existing) {
            existing.ts = entry.ts;
            existing.direction = entry.direction;
            existing.stage = entry.stage;
            existing.title = entry.title;
            existing.payload = entry.payload;
            updateDebugConsoleEntryElement(existing);
            updateDebugConsoleStatus();
            if (nearBottom) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
            return;
        }
    }
    const last = debugConsoleState.entries[debugConsoleState.entries.length - 1];
    if (mergeKey && last && last.__mergeKey === mergeKey) {
        const lastPayload = (last.payload && typeof last.payload === 'object') ? last.payload : {};
        const nextPayload = (entry.payload && typeof entry.payload === 'object') ? entry.payload : {};
        if (entry.stage === 'model_content_delta') {
            lastPayload.delta = String(lastPayload.delta || '') + String(nextPayload.delta || '');
        } else if (entry.stage === 'model_reasoning_delta') {
            lastPayload.delta = String(lastPayload.delta || '') + String(nextPayload.delta || '');
        } else if (entry.stage === 'model_function_call_delta') {
            lastPayload.arguments_delta = String(lastPayload.arguments_delta || '') + String(nextPayload.arguments_delta || '');
        } else {
            return;
        }
        last.payload = lastPayload;
        last.ts = entry.ts;
        updateDebugConsoleEntryElement(last);
        updateDebugConsoleStatus();
        if (nearBottom) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
        return;
    }

    entry.__mergeKey = mergeKey;
    debugConsoleState.entries.push(entry);
    while (debugConsoleState.entries.length > debugConsoleState.maxEntries) {
        const removed = debugConsoleState.entries.shift();
        if (removed && removed.id) {
            const oldEl = body.querySelector(`.debug-console-entry[data-entry-id="${String(removed.id)}"]`);
            if (oldEl) oldEl.remove();
        }
    }
    ensureDebugConsoleEmptyState();
    body.appendChild(buildDebugConsoleEntryElement(entry));
    updateDebugConsoleStatus();
    if (nearBottom) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

function clearDebugConsoleEntries() {
    debugConsoleState.entries = [];
    if (els.debugConsoleBody) {
        els.debugConsoleBody.innerHTML = '';
    }
    ensureDebugConsoleEmptyState();
    updateDebugConsoleStatus();
}

function getDebugConsoleActivePageText() {
    if (debugConsoleState.activeTab === 'function') {
        const tool = String(els.debugToolSelect?.value || debugConsoleState.selectedToolName || '').trim();
        const args = String(els.debugToolArgsInput?.value || '').trim();
        const result = String(els.debugToolResult?.textContent || '').trim();
        return [
            `[Function Call] ${tool || '(未选择工具)'}`,
            args ? `Args:\n${args}` : '',
            result ? `Result:\n${result}` : ''
        ].filter(Boolean).join('\n\n');
    }
    return debugConsoleState.entries.map((entry) => {
        const header = `[${formatDebugConsoleTime(entry.ts)}] ${getDebugDirectionLabel(entry.direction)} ${entry.title || entry.stage || 'trace'} (${entry.stage || '-'})`;
        const payload = formatDebugConsolePayload(entry.payload);
        return `${header}\n${payload}`;
    }).join('\n\n');
}

async function copyDebugConsoleEntries() {
    const text = getDebugConsoleActivePageText();
    if (!text.trim()) {
        showToast('没有可复制的调试日志');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast('调试日志已复制');
    } catch (_) {
        showToast('复制失败');
    }
}

function openDebugConsole() {
    debugConsoleState.enabled = true;
    debugConsoleState.open = true;
    saveDebugConsoleEnabled(true);
    bringFloatingPanelToFront(els.debugConsolePanel || document.getElementById('debugConsolePanel'));
    ensureDebugConsoleEmptyState();
    updateDebugConsoleTabUi();
    updateDebugConsoleStatus();
}

function closeDebugConsole() {
    debugConsoleState.enabled = false;
    debugConsoleState.open = false;
    saveDebugConsoleEnabled(false);
    updateDebugConsoleStatus();
}

function toggleDebugConsole() {
    if (debugConsoleState.open) {
        closeDebugConsole();
    } else {
        openDebugConsole();
    }
}

function normalizeDebugSchemaMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    if (Array.isArray(meta.anyOf) && meta.anyOf.length) return normalizeDebugSchemaMeta(meta.anyOf[0]);
    if (Array.isArray(meta.oneOf) && meta.oneOf.length) return normalizeDebugSchemaMeta(meta.oneOf[0]);
    if (Array.isArray(meta.allOf) && meta.allOf.length) {
        return Object.assign({}, ...meta.allOf.map((item) => normalizeDebugSchemaMeta(item)));
    }
    return meta;
}

function getDebugSchemaType(meta) {
    const schema = normalizeDebugSchemaMeta(meta);
    const rawType = schema.type;
    if (Array.isArray(rawType)) {
        const picked = rawType.find((item) => item && item !== 'null');
        if (picked) return String(picked).trim().toLowerCase();
    }
    if (typeof rawType === 'string' && rawType.trim()) {
        return rawType.trim().toLowerCase();
    }
    if (schema.properties && typeof schema.properties === 'object') return 'object';
    if (schema.items) return 'array';
    if (Array.isArray(schema.enum) && schema.enum.length) return typeof schema.enum[0];
    return 'string';
}

function buildDebugToolDefaultValue(meta) {
    const schema = normalizeDebugSchemaMeta(meta);
    if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
        return schema.default;
    }
    if (Array.isArray(schema.enum) && schema.enum.length) {
        return schema.enum[0];
    }
    const type = getDebugSchemaType(schema);
    if (type === 'object') {
        const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : {};
        const out = {};
        Object.keys(props).forEach((key) => {
            out[key] = buildDebugToolDefaultValue(props[key]);
        });
        return out;
    }
    if (type === 'array') {
        return [];
    }
    if (type === 'integer' || type === 'number') {
        return 0;
    }
    if (type === 'boolean') {
        return false;
    }
    return '';
}

function buildDebugToolArgsTemplate(tool) {
    const params = (tool && tool.parameters && typeof tool.parameters === 'object') ? tool.parameters : {};
    const props = (params.properties && typeof params.properties === 'object') ? params.properties : {};
    const out = {};
    Object.keys(props).forEach((key) => {
        out[key] = buildDebugToolDefaultValue(props[key]);
    });
    return JSON.stringify(out, null, 2);
}

function findDebugToolByName(name) {
    const target = String(name || '').trim();
    if (!target) return null;
    return debugConsoleState.toolCatalog.find((item) => item && String(item.name || '').trim() === target) || null;
}

function renderDebugToolArgsInput(tool) {
    const inputEl = els.debugToolArgsInput;
    if (!inputEl) return;
    if (!tool) {
        inputEl.value = '';
        inputEl.placeholder = '选择工具后自动生成参数模板';
        return;
    }
    inputEl.value = buildDebugToolArgsTemplate(tool);
    inputEl.placeholder = '请输入 JSON 参数';
}

function collectDebugToolArgsFromInput() {
    const raw = String(els.debugToolArgsInput?.value || '').trim();
    return raw ? JSON.parse(raw) : {};
}

function updateDebugToolMeta() {
    const metaEl = els.debugToolMeta;
    if (!metaEl) return;
    const tool = findDebugToolByName(debugConsoleState.selectedToolName);
    if (!tool) {
        metaEl.textContent = debugConsoleState.toolCatalogLoaded ? '当前没有可用工具' : '载入工具中...';
        renderDebugToolArgsInput(null);
        return;
    }
    const desc = String(tool.description || '').trim() || '无描述';
    const canonicalName = String(tool.canonical_name || tool.name || '').trim();
    const legacyAlias = String(tool.legacy_alias || '').trim();
    metaEl.textContent = [
        `canonical_name: ${canonicalName || '-'}`,
        legacyAlias ? `legacy_alias: ${legacyAlias}` : '',
        desc
    ].filter(Boolean).join('\n');
    renderDebugToolArgsInput(tool);
}

function syncDebugToolSelect() {
    const select = els.debugToolSelect;
    if (!select) return;
    const tools = Array.isArray(debugConsoleState.toolCatalog) ? debugConsoleState.toolCatalog : [];
    const current = String(debugConsoleState.selectedToolName || '').trim();
    select.innerHTML = '';
    if (!tools.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '无可用工具';
        select.appendChild(opt);
        debugConsoleState.selectedToolName = '';
        updateDebugToolMeta();
        return;
    }
    tools.forEach((tool) => {
        const opt = document.createElement('option');
        opt.value = String(tool.name || '');
        opt.textContent = String(tool.name || '');
        select.appendChild(opt);
    });
    let next = current;
    if (!findDebugToolByName(next)) {
        next = String(tools[0].name || '');
    }
    debugConsoleState.selectedToolName = next;
    select.value = next;
    updateDebugToolMeta();
}

function updateDebugConsoleTabUi() {
    const active = debugConsoleState.activeTab === 'function' ? 'function' : 'prompt';
    const promptTab = els.debugConsolePromptTab;
    const functionTab = els.debugConsoleFunctionTab;
    const promptPage = els.debugConsolePromptPage;
    const functionPage = els.debugConsoleFunctionPage;
    if (promptTab) promptTab.classList.toggle('active', active === 'prompt');
    if (functionTab) functionTab.classList.toggle('active', active === 'function');
    if (promptPage) promptPage.classList.toggle('active', active === 'prompt');
    if (functionPage) functionPage.classList.toggle('active', active === 'function');
    if (active === 'function') {
        void loadDebugToolCatalog();
    }
    updateDebugConsoleStatus();
}

async function loadDebugToolCatalog(force = false) {
    if (!els.debugToolSelect || !els.debugToolMeta) return;
    const currentModelName = String(selectedModelId || '');
    const currentConvId = String(currentConversationId || '');
    const sameContext = debugConsoleState.toolCatalogLoaded
        && debugConsoleState.toolCatalogModelName === currentModelName
        && debugConsoleState.toolCatalogConversationId === currentConvId;
    if (sameContext && !force) {
        syncDebugToolSelect();
        return;
    }
    els.debugToolMeta.textContent = '载入工具中...';
    try {
        const params = new URLSearchParams();
        if (currentConversationId) params.set('conversation_id', String(currentConversationId));
        if (selectedModelId) params.set('model_name', String(selectedModelId));
        const res = await fetch(`/api/debug/tools/catalog${params.toString() ? `?${params.toString()}` : ''}`, {
            credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        debugConsoleState.toolCatalog = Array.isArray(data.tools) ? data.tools : [];
        debugConsoleState.toolCatalogLoaded = true;
        debugConsoleState.toolCatalogModelName = currentModelName;
        debugConsoleState.toolCatalogConversationId = currentConvId;
        syncDebugToolSelect();
    } catch (err) {
        debugConsoleState.toolCatalog = [];
        debugConsoleState.toolCatalogLoaded = false;
        debugConsoleState.toolCatalogModelName = '';
        debugConsoleState.toolCatalogConversationId = '';
        if (els.debugToolSelect) {
            els.debugToolSelect.innerHTML = '<option value="">加载失败</option>';
        }
        if (els.debugToolMeta) {
            els.debugToolMeta.textContent = `工具列表加载失败: ${String(err && err.message ? err.message : err || 'unknown')}`;
        }
        renderDebugToolArgsInput(null);
    }
}

async function executeDebugToolCall() {
    const toolName = String(els.debugToolSelect?.value || debugConsoleState.selectedToolName || '').trim();
    if (!toolName) {
        showToast('请先选择工具');
        return;
    }
    let args = {};
    try {
        args = collectDebugToolArgsFromInput();
    } catch (err) {
        showToast('参数 JSON 格式错误');
        return;
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        showToast('args 必须是 JSON object');
        return;
    }
    if (els.executeDebugToolBtn) els.executeDebugToolBtn.disabled = true;
    if (els.debugToolResult) els.debugToolResult.textContent = '执行中...';
    try {
        const res = await fetch('/api/debug/tools/execute', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: currentConversationId || '',
                model_name: selectedModelId || '',
                tool_name: toolName,
                args
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        const payload = (data.parsed_result !== undefined && data.parsed_result !== null) ? data.parsed_result : data.result;
        debugConsoleState.toolResultText = formatDebugConsolePayload(payload);
        if (els.debugToolResult) els.debugToolResult.textContent = debugConsoleState.toolResultText;
        showToast(`工具 ${String(data.canonical_name || toolName)} 执行完成`);
    } catch (err) {
        const msg = `执行失败: ${String(err && err.message ? err.message : err || 'unknown')}`;
        debugConsoleState.toolResultText = msg;
        if (els.debugToolResult) els.debugToolResult.textContent = msg;
        showToast('工具执行失败');
    } finally {
        if (els.executeDebugToolBtn) els.executeDebugToolBtn.disabled = false;
    }
}

function clearDebugToolResult() {
    debugConsoleState.toolResultText = '尚未执行工具';
    if (els.debugToolResult) els.debugToolResult.textContent = debugConsoleState.toolResultText;
}

function bindDebugConsoleDrag() {
    if (debugConsoleState.bound) return;
    const panel = els.debugConsolePanel;
    const head = els.debugConsoleHead || document.querySelector('#debugConsolePanel .debug-console-head');
    const resizeHandle = els.debugConsoleResizeHandle;
    if (!panel || !head) return;
    debugConsoleState.bound = true;
    bindFloatingPanelFront(panel);

    const stopDrag = () => {
        if (!debugConsoleState.dragging && !debugConsoleState.resizing) return;
        debugConsoleState.dragging = false;
        debugConsoleState.resizing = false;
        debugConsoleState.pointerId = null;
        panel.classList.remove('dragging');
        panel.classList.remove('resizing');
    };

    const onMove = (e) => {
        if (!debugConsoleState.dragging && !debugConsoleState.resizing) return;
        if (debugConsoleState.pointerId != null && e.pointerId !== debugConsoleState.pointerId) return;
        const dx = Number(e.clientX || 0) - debugConsoleState.startClientX;
        const dy = Number(e.clientY || 0) - debugConsoleState.startClientY;
        const margin = 8;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        if (debugConsoleState.dragging) {
            const width = Math.max(320, Number(panel.offsetWidth || panel.getBoundingClientRect().width || 460));
            const height = Math.max(260, Number(panel.offsetHeight || panel.getBoundingClientRect().height || 320));
            const maxLeft = Math.max(margin, viewportWidth - width - margin);
            const maxTop = Math.max(margin, viewportHeight - height - margin);
            const nextLeft = Math.max(margin, Math.min(maxLeft, debugConsoleState.startLeft + dx));
            const nextTop = Math.max(margin, Math.min(maxTop, debugConsoleState.startTop + dy));
            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
            panel.style.right = 'auto';
            return;
        }
        if (debugConsoleState.resizing) {
            const minWidth = 360;
            const minHeight = 280;
            const maxWidth = Math.max(minWidth, viewportWidth - debugConsoleState.startLeft - margin);
            const maxHeight = Math.max(minHeight, viewportHeight - debugConsoleState.startTop - margin);
            const nextWidth = Math.max(minWidth, Math.min(maxWidth, debugConsoleState.startWidth + dx));
            const nextHeight = Math.max(minHeight, Math.min(maxHeight, debugConsoleState.startHeight + dy));
            panel.style.width = `${nextWidth}px`;
            panel.style.height = `${nextHeight}px`;
            panel.style.maxWidth = `${Math.max(minWidth, viewportWidth - margin * 2)}px`;
        }
    };

    head.addEventListener('pointerdown', (e) => {
        const target = e.target;
        if (target && target.closest('button, a, input, select, textarea, label')) return;
        if (!debugConsoleState.open) return;
        bringFloatingPanelToFront(panel);
        const rect = panel.getBoundingClientRect();
        debugConsoleState.dragging = true;
        debugConsoleState.pointerId = e.pointerId;
        debugConsoleState.startClientX = Number(e.clientX || 0);
        debugConsoleState.startClientY = Number(e.clientY || 0);
        debugConsoleState.startLeft = Number(rect.left || 0);
        debugConsoleState.startTop = Number(rect.top || 0);
        panel.classList.add('dragging');
        e.preventDefault();
    });

    if (resizeHandle) {
        resizeHandle.addEventListener('pointerdown', (e) => {
            if (!debugConsoleState.open) return;
            const rect = panel.getBoundingClientRect();
            debugConsoleState.resizing = true;
            debugConsoleState.pointerId = e.pointerId;
            debugConsoleState.startClientX = Number(e.clientX || 0);
            debugConsoleState.startClientY = Number(e.clientY || 0);
            debugConsoleState.startLeft = Number(rect.left || 0);
            debugConsoleState.startTop = Number(rect.top || 0);
            debugConsoleState.startWidth = Number(rect.width || panel.offsetWidth || 460);
            debugConsoleState.startHeight = Number(rect.height || panel.offsetHeight || 320);
            panel.style.left = `${debugConsoleState.startLeft}px`;
            panel.style.top = `${debugConsoleState.startTop}px`;
            panel.style.right = 'auto';
            panel.classList.add('resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
}

function bindDebugConsoleUi() {
    if (els.debugConsolePanel && els.debugConsolePanel.dataset.bindDone === '1') return;
    if (!els.debugConsolePanel) return;
    els.debugConsolePanel.dataset.bindDone = '1';
    debugConsoleState.enabled = loadDebugConsoleEnabled();
    debugConsoleState.open = debugConsoleState.enabled;
    debugConsoleState.activeTab = 'prompt';
    setForceContextCompressionOnce(false);
    updateDebugConsoleStatus();
    ensureDebugConsoleEmptyState();
    updateDebugConsoleTabUi();

    if (els.copyDebugConsoleBtn) {
        els.copyDebugConsoleBtn.addEventListener('click', () => {
            void copyDebugConsoleEntries();
        });
    }
    if (els.clearDebugConsoleBtn) {
        els.clearDebugConsoleBtn.addEventListener('click', () => {
            if (debugConsoleState.activeTab === 'function') clearDebugToolResult();
            else clearDebugConsoleEntries();
        });
    }
    if (els.closeDebugConsoleBtn) {
        els.closeDebugConsoleBtn.addEventListener('click', () => {
            closeDebugConsole();
        });
    }
    if (els.forceContextCompressionBtn) {
        els.forceContextCompressionBtn.addEventListener('click', () => {
            const next = !forceContextCompressionOnce;
            setForceContextCompressionOnce(next);
            showToast(next ? '已启用：下次请求强制触发上下文压缩' : '已取消强制压缩');
            if (next) {
                appendDebugConsoleEntry({
                    direction: 'client->local',
                    stage: 'force_context_compression_armed',
                    title: 'Force Compression',
                    payload: { armed: true, applies_to_next_request_only: true }
                });
            }
        });
    }

    bindDebugConsoleDrag();

    if (els.debugConsolePromptTab) {
        els.debugConsolePromptTab.addEventListener('click', () => {
            debugConsoleState.activeTab = 'prompt';
            updateDebugConsoleTabUi();
        });
    }
    if (els.debugConsoleFunctionTab) {
        els.debugConsoleFunctionTab.addEventListener('click', () => {
            debugConsoleState.activeTab = 'function';
            updateDebugConsoleTabUi();
        });
    }
    if (els.refreshDebugToolsBtn) {
        els.refreshDebugToolsBtn.addEventListener('click', () => {
            void loadDebugToolCatalog(true);
        });
    }
    if (els.debugToolSelect) {
        els.debugToolSelect.addEventListener('change', () => {
            debugConsoleState.selectedToolName = String(els.debugToolSelect.value || '').trim();
            updateDebugToolMeta();
        });
    }
    if (els.executeDebugToolBtn) {
        els.executeDebugToolBtn.addEventListener('click', () => {
            void executeDebugToolCall();
        });
    }

    document.addEventListener('keydown', (e) => {
        const key = String(e.key || '').toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'd') {
            e.preventDefault();
            e.stopPropagation();
            toggleDebugConsole();
        }
    });
}

function bindMobileHeaderMenu() {
    els.mobileHeaderMenu = document.getElementById('mobileHeaderMenu');
    els.mobileHeaderMenuTrigger = document.getElementById('mobileHeaderMenuTrigger');
    els.mobileHeaderMenuPanel = document.getElementById('mobileHeaderMenuPanel');
    els.mobileWorkflowMenuItem = document.getElementById('mobileWorkflowMenuItem');
    els.mobileNotesMenuItem = document.getElementById('mobileNotesMenuItem');
    els.mobileTimelineMenuItem = document.getElementById('mobileTimelineMenuItem');

    const menu = els.mobileHeaderMenu;
    const trigger = els.mobileHeaderMenuTrigger;
    const panel = els.mobileHeaderMenuPanel;
    if (!menu || !trigger || !panel) return;

    trigger.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !menu.classList.contains('open');
        if (willOpen) {
            menu.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            trigger.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => positionMobileHeaderMenuPanel());
        } else {
            closeMobileHeaderMenu();
        }
    };

    const workflowItem = els.mobileWorkflowMenuItem;
    if (workflowItem) {
        workflowItem.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileHeaderMenu();
            openWorkflowPlaceholderView();
        };
    }

    const notesItem = els.mobileNotesMenuItem;
    if (notesItem) {
        notesItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileHeaderMenu();
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (!ok) showToast('打开独立笔记窗口失败');
                return;
            }
            toggleNotesPanel();
        };
    }

    const timelineItem = els.mobileTimelineMenuItem;
    if (timelineItem) {
        timelineItem.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileHeaderMenu();
            toggleTimelinePanel();
        };
    }

    if (!isChatMobileLayout()) {
        closeMobileHeaderMenu();
    } else if (menu.classList.contains('open')) {
        requestAnimationFrame(() => positionMobileHeaderMenuPanel());
    }
}

function ensureMessageInputFocus(options = {}) {
    if (!els.messageInput) return;
    const input = els.messageInput;
    const opts = (options && typeof options === 'object') ? options : {};
    const onlyIfBlurred = !!opts.onlyIfBlurred;
    const preserveSelection = opts.preserveSelection !== false;
    if (onlyIfBlurred && document.activeElement === input) return;
    const prevStart = preserveSelection ? input.selectionStart : null;
    const prevEnd = preserveSelection ? input.selectionEnd : null;
    const prevDirection = preserveSelection ? input.selectionDirection : null;

    const focusNow = () => {
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
        if (!preserveSelection) return;
        if (document.activeElement !== input) return;
        if (!Number.isInteger(prevStart) || !Number.isInteger(prevEnd)) return;
        try {
            input.setSelectionRange(prevStart, prevEnd, prevDirection || 'none');
        } catch (_) {
            // ignore for unsupported browsers
        }
    };
    requestAnimationFrame(() => setTimeout(focusNow, 0));
}

function updateMobileMessageInputViewportBaseline() {
    if (!isChatMobileLayout()) return;
    const vv = window.visualViewport;
    const height = Number(vv && vv.height ? vv.height : (window.innerHeight || document.documentElement.clientHeight || 0));
    if (!Number.isFinite(height) || height <= 0) return;
    if (height > mobileMessageInputViewportBaseline) {
        mobileMessageInputViewportBaseline = height;
    }
}

function isMobileKeyboardLikelyOpen() {
    if (!isChatMobileLayout()) return false;
    updateMobileMessageInputViewportBaseline();
    const vv = window.visualViewport;
    const current = Number(vv && vv.height ? vv.height : (window.innerHeight || document.documentElement.clientHeight || 0));
    if (!Number.isFinite(current) || current <= 0) return false;
    const baseline = Number(mobileMessageInputViewportBaseline || current);
    return (baseline - current) > 110;
}

function focusMessageInputFromGesture(options = {}) {
    if (!els.messageInput) return;
    const input = els.messageInput;
    const opts = (options && typeof options === 'object') ? options : {};
    const preserveSelection = opts.preserveSelection !== false;
    const forceReset = !!opts.forceReset;
    const prevStart = preserveSelection ? input.selectionStart : null;
    const prevEnd = preserveSelection ? input.selectionEnd : null;
    const prevDirection = preserveSelection ? input.selectionDirection : null;
    if (forceReset) {
        try {
            input.blur();
        } catch (_) {
            // ignore
        }
    }
    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        input.focus();
    }
    if (!preserveSelection) return;
    if (document.activeElement !== input) return;
    if (!Number.isInteger(prevStart) || !Number.isInteger(prevEnd)) return;
    try {
        input.setSelectionRange(prevStart, prevEnd, prevDirection || 'none');
    } catch (_) {
        // ignore
    }
}

function setDesktopAgentIndicatorState(online, titleSuffix = '') {
    const previousOnline = !!lastAgentOnline;
    lastAgentOnline = !!online;
    const indicator = document.getElementById('desktopAgentIndicator');

    if (indicator) {
        if (online) {
            indicator.style.backgroundColor = '#4caf50';
            indicator.title = `NexoraCode (本地计算节点) - 在线${titleSuffix}`;
        } else {
            indicator.style.backgroundColor = '#9e9e9e';
            indicator.title = `NexoraCode (本地计算节点) - 离线${titleSuffix}`;
        }
    }

    if (previousOnline !== lastAgentOnline) {
        // 本地计算节点上/下线会改变项目侧边栏与欢迎页项目区的可见性；
        // 项目 UI 刷新失败不允许影响指示点本身
        try {
            if (lastAgentOnline) {
                loadNexoraCodeProjectsFromStorage();
            }
            refreshNexoraCodeProjectUi();
        } catch (err) {
            console.warn('[NexoraCode] 项目 UI 刷新失败', err);
        }
    }
}

let lastAgentStatusWsReceivedAt = 0;
window.toggleCloudFilePanel = toggleCloudFilePanel;
window.toggleKnowledgePanel = toggleKnowledgePanel;

function openMobileSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove('collapsed');
    requestAnimationFrame(() => {
        els.sidebar.classList.add('mobile-open');
    });
}

function closeMobileSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove('mobile-open');
}

function collapseDesktopSidebarByOutsideInteraction() {
    if (!els.sidebar || !isSidebarOverlayLayout()) return;
    if (els.sidebar.classList.contains('collapsed')) return;
    els.sidebar.classList.add('collapsed');
}

function toggleMobileSidebar() {
    if (!els.sidebar) return;
    if (els.sidebar.classList.contains('mobile-open')) closeMobileSidebar();
    else openMobileSidebar();
}

let fileCenterState = {
    files: [],
    query: '',
    currentPath: '',
    selectedFileRef: '',
    sortBy: 'created_desc',
    searchTimer: 0,
    view: 'home',
    detailFileRef: '',
    detailRequestSeq: 0,
    detailFileItem: null,
    detailReadUrl: '',
    detailInlineUrl: '',
    detailDownloadUrl: '',
    contextFileRef: '',
    detailReturnTarget: '',
    listScrollTop: 0
};

function createFileCenterUploadDialogState(...args) {
    return getNexoraChatFiles().createFileCenterUploadDialogState(...args);
}

function getCloudFileAlias(file) {
    const src = (file && typeof file === 'object') ? file : {};
    return String(src.alias || '').trim();
}

function getCloudFileSandboxPath(file) {
    const src = (file && typeof file === 'object') ? file : {};
    return String(src.sandbox_path || src.file_ref || src.path || '').trim();
}

function getCloudFileOriginalName(file) {
    const src = (file && typeof file === 'object') ? file : {};
    return String(src.original_name || src.filename || src.name || '').trim();
}

function getCloudFileSize(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const size = Number(src.size || src.file_size || 0);

    return Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
}

function getCloudFileUpdatedAt(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const updatedAt = Number(src.updated_at || src.modified_at || src.created_at || 0);

    return Number.isFinite(updatedAt) ? updatedAt : 0;
}

function getCloudFileCreatedAt(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const createdAt = Number(src.created_at || 0);

    return Number.isFinite(createdAt) ? createdAt : 0;
}

function getCloudFileRef(file) {
    return getCloudFileSandboxPath(file) || getCloudFileAlias(file);
}

function getCloudFileBasename(value) {
    const raw = String(value || '').trim();

    if (!raw) return '';

    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
    return String(parts[parts.length - 1] || raw).trim();
}

function getCloudFileExtension(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const sourceExt = String(src.source_ext || '').trim().replace(/^\./, '').toLowerCase();

    if (sourceExt) {
        return sourceExt;
    }

    const candidates = [
        getCloudFileAlias(file),
        getCloudFileOriginalName(file),
        getCloudFileSandboxPath(file),
        getCloudFileDisplayName(file),
    ];

    for (const item of candidates) {
        const name = String(item || '').trim().toLowerCase();
        const match = name.match(/\.([a-z0-9]+)$/);

        if (match) {
            return match[1];
        }
    }

    return '';
}

function isCloudFileImage(file) {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(getCloudFileExtension(file));
}

function renderCloudFileCardMedia(file, imageUrl = '') {
    const displayName = getCloudFileDisplayName(file);
    const safeImageUrl = String(imageUrl || '').trim();

    if (isCloudFileImage(file) && safeImageUrl) {
        return `
            <span class="file-center-thumb-wrap">
                <img class="file-center-thumb" src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(displayName)}" loading="lazy">
            </span>
        `;
    }

    return `
        <span class="file-center-file-icon ${escapeHtml(getCloudFileToneClass(file))}">
            <i class="${escapeHtml(getCloudFileIconClass(file))}" aria-hidden="true"></i>
        </span>
    `;
}

function getCloudFileDisplayName(file) {
    const alias = getCloudFileAlias(file);

    return getCloudFileBasename(alias)
        || getCloudFileOriginalName(file)
        || getCloudFileBasename(getCloudFileSandboxPath(file))
        || '文件';
}

function normalizeFileCenterPath(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('/');
}

function getFileCenterParentPathFromFileRef(fileRef) {
    const ref = normalizeFileCenterPath(fileRef);
    const marker = '/files/';
    const markerIndex = ref.indexOf(marker);
    const aliasPath = markerIndex >= 0
        ? normalizeFileCenterPath(ref.slice(markerIndex + marker.length))
        : ref;
    const parts = aliasPath.split('/').filter(Boolean);

    if (parts.length <= 1) {
        return '';
    }

    parts.pop();
    return parts.join('/');
}

function getFileCenterItemAliasPath(file) {
    const alias = normalizeFileCenterPath(getCloudFileAlias(file));

    if (alias) {
        return alias;
    }

    const sandboxPath = normalizeFileCenterPath(getCloudFileSandboxPath(file));
    const marker = '/files/';
    const markerIndex = sandboxPath.indexOf(marker);

    if (markerIndex >= 0) {
        return normalizeFileCenterPath(sandboxPath.slice(markerIndex + marker.length));
    }

    return normalizeFileCenterPath(getCloudFileBasename(sandboxPath));
}

function fileCenterFileMatchesQuery(file, query) {
    const keyword = String(query || '').trim().toLowerCase();

    if (!keyword) {
        return true;
    }

    const haystack = [
        getCloudFileAlias(file),
        getCloudFileOriginalName(file),
        getCloudFileSandboxPath(file),
    ].join(' ').toLowerCase();

    return haystack.includes(keyword);
}

function buildFileCenterListUrl(query, currentPath = '') {
    const params = new URLSearchParams();
    const path = normalizeFileCenterPath(currentPath);
    const keyword = String(query || '').trim();
    const requestQuery = path || keyword;

    if (requestQuery) {
        params.set('q', requestQuery);
    }

    params.set('limit', '1000');

    return `/api/files/list?${params.toString()}`;
}

function normalizeFileCenterDetailFileItem(file, fileRef) {
    if (!file || typeof file !== 'object') {
        return null;
    }

    const normalized = { ...file };
    const ref = String(
        fileRef
        || normalized.file_ref
        || normalized.sandbox_path
        || normalized.path
        || normalized.alias
        || '',
    ).trim();

    if (!ref) {
        return null;
    }

    normalized.file_ref = ref;
    normalized.sandbox_path = ref;

    if (!String(normalized.alias || '').trim()) {
        normalized.alias = getCloudFileBasename(ref);
    }

    return normalized;
}

function getCloudFileIconClass(file) {
    return getUploadPreviewIconClass({
        type: 'sandbox_file',
        name: getCloudFileDisplayName(file)
    });
}

function getCloudFileToneClass(file) {
    const ext = getCloudFileExtension(file);

    if (['pdf'].includes(ext)) return 'tone-pdf';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'tone-image';
    if (['doc', 'docx'].includes(ext)) return 'tone-doc';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'tone-sheet';
    if (['ppt', 'pptx'].includes(ext)) return 'tone-slide';
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'cs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'c', 'h', 'hpp', 'cpp', 'cc', 'cxx'].includes(ext)) return 'tone-code';
    if (['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'html', 'css', 'sql'].includes(ext)) return 'tone-config';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'tone-archive';
    if (['md', 'txt', 'log'].includes(ext)) return 'tone-text';

    return 'tone-file';
}

function getCloudFileInlineUrl(fileRef, inlineUrl = '') {
    const ref = String(fileRef || '').trim();
    const explicitInlineUrl = String(inlineUrl || '').trim();

    if (!ref) {
        return '';
    }

    if (explicitInlineUrl) {
        return explicitInlineUrl;
    }

    return `/api/files/download?file_ref=${encodeURIComponent(ref)}&inline=1`;
}

function getFileCenterDetailUrl(fileRef, stateKey) {
    const ref = String(fileRef || '').trim();
    const detailRef = String(fileCenterState.detailFileRef || '').trim();

    if (!ref || ref !== detailRef) {
        return '';
    }

    return String(fileCenterState[stateKey] || '').trim();
}

function getFileCenterReadUrl(fileRef) {
    const ref = String(fileRef || '').trim();
    const detailReadUrl = getFileCenterDetailUrl(ref, 'detailReadUrl');

    if (detailReadUrl) {
        return detailReadUrl;
    }

    return `/api/files/read?file_ref=${encodeURIComponent(ref)}`;
}

function findFileCenterItem(fileRef) {
    const ref = String(fileRef || '').trim();

    if (!ref) return null;

    const items = Array.isArray(fileCenterState.files) ? fileCenterState.files : [];
    const file = items.find((item) => getCloudFileRef(item) === ref);

    if (file) {
        return file;
    }

    const detailFileItem = fileCenterState.detailFileItem;

    if (detailFileItem && getCloudFileRef(detailFileItem) === ref) {
        return detailFileItem;
    }

    return null;
}

function formatFileSize(...args) {
    return getNexoraChatFiles().formatFileSize(...args);
}

function formatByteRate(...args) {
    return getNexoraChatFiles().formatByteRate(...args);
}

function formatFileUpdatedAt(ts) {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    try {
        return new Date(n * 1000).toLocaleString();
    } catch (_) {
        return '-';
    }
}

function downloadCloudFile(fileRef) {
    const ref = String(fileRef || '').trim();
    if (!ref) return;
    const url = `/api/files/download?file_ref=${encodeURIComponent(ref)}`;
    window.open(url, '_blank');
}

async function removeCloudFile(fileRef) {
    const ref = String(fileRef || '').trim();
    if (!ref) return false;
    const ok = await confirmModalAsync('删除文件', `确定删除文件「${ref}」吗？`, 'danger');
    if (!ok) return false;
    try {
        const res = await fetch(`/api/files/remove?file_ref=${encodeURIComponent(ref)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!data || !data.success) {
            showToast((data && data.message) ? data.message : '删除失败');
            return false;
        }
        showToast('文件已删除');
        await loadCloudFiles();
        return true;
    } catch (e) {
        showToast('删除失败');
        return false;
    }
}

async function loadCloudFilePreview(fileRef, previewEl) {
    const ref = String(fileRef || '').trim();
    if (!ref || !previewEl) return;
    previewEl.textContent = '加载中...';
    try {
        const res = await fetch(`/api/files/read?file_ref=${encodeURIComponent(ref)}`);
        const data = await res.json();
        if (!data || !data.success) {
            previewEl.textContent = (data && data.message) ? data.message : '读取失败';
            return;
        }
        previewEl.textContent = String(data.content || '');
    } catch (e) {
        previewEl.textContent = '读取失败';
    }
}

const fileReferenceMetaCache = new Map();
let fileReferenceHydratorInstalled = false;
let fileReferenceHydratorObserver = null;

function isTextFileReference(fileRef) {
    const ext = readFileReferenceExtension(fileRef);
    return /^(txt|md|markdown|py|js|ts|tsx|jsx|java|go|rs|cs|php|rb|swift|kt|kts|scala|sh|bash|zsh|bat|ps1|json|yaml|yml|toml|ini|cfg|xml|html|css|sql|csv|log)$/i.test(ext);
}

function summarizeFileReferenceText(content, limit = 96) {
    const text = String(content || '').replace(/\s+/g, ' ').trim();

    if (!text) {
        return '';
    }

    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function chooseCloudFileReferenceEntry(fileRef, files) {
    const ref = normalizeFileReferencePath(fileRef);
    const normalizedRef = ref.toLowerCase();
    const arr = Array.isArray(files) ? files : [];

    for (const item of arr) {
        const alias = String(item && item.alias ? item.alias : '').trim();
        const sandboxPath = normalizeFileReferencePath(item && item.sandbox_path ? item.sandbox_path : '');
        const originalName = String(item && item.original_name ? item.original_name : '').trim();

        if (
            alias.toLowerCase() === normalizedRef
            || sandboxPath.toLowerCase() === normalizedRef
            || originalName.toLowerCase() === normalizedRef
        ) {
            return item;
        }
    }

    return null;
}

async function resolveFileReferenceMeta(fileRef) {
    const ref = normalizeFileReferencePath(fileRef);

    if (!ref) {
        throw new Error('file_ref is empty');
    }

    if (fileReferenceMetaCache.has(ref)) {
        return fileReferenceMetaCache.get(ref);
    }

    const promise = (async () => {
        const listUrl = `/api/files/list?q=${encodeURIComponent(ref)}&limit=20`;
        const listRes = await fetch(listUrl, { cache: 'no-store' });
        const listData = await listRes.json();

        if (!listData || !listData.success) {
            throw new Error((listData && listData.message) ? listData.message : '文件信息读取失败');
        }

        const entry = chooseCloudFileReferenceEntry(ref, listData.files || []);

        if (!entry) {
            throw new Error('文件不存在');
        }

        const sandboxPath = normalizeFileReferencePath(entry.sandbox_path || ref);
        const alias = String(entry.alias || '').trim();
        const originalName = String(entry.original_name || '').trim();
        const displayName = alias || originalName || clipFileReferenceLabel(sandboxPath);
        const sizeBytes = Number(entry.size || 0);
        const ext = readFileReferenceExtension(displayName || sandboxPath);
        let summary = '';

        if (isTextFileReference(displayName || sandboxPath)) {
            const readRes = await fetch(`/api/files/read?file_ref=${encodeURIComponent(sandboxPath || ref)}`, { cache: 'no-store' });
            const readData = await readRes.json();

            if (readData && readData.success) {
                summary = summarizeFileReferenceText(readData.content || '');
            }
        }

        return {
            fileRef: sandboxPath || ref,
            displayName,
            sizeText: formatFileSize(sizeBytes),
            typeText: ext ? ext.toUpperCase() : 'FILE',
            summary
        };
    })();

    fileReferenceMetaCache.set(ref, promise);
    return promise;
}

function applyFileReferenceMeta(node, meta) {
    if (!node || !meta) return;

    const fileRef = normalizeFileReferencePath(meta.fileRef || node.dataset.fileRef || '');
    const nameEl = node.querySelector('.file-reference-name');
    const metaEl = node.querySelector('.file-reference-meta');
    const summaryEl = node.querySelector('.file-reference-summary');
    const downloadEl = node.querySelector('.file-reference-download');

    node.dataset.fileRef = fileRef;
    node.title = [
        `文件：${fileRef}`,
        `大小：${meta.sizeText || '未知'}`,
        meta.summary ? `摘要：${meta.summary}` : ''
    ].filter(Boolean).join('\n');

    if (nameEl) {
        nameEl.textContent = meta.displayName || clipFileReferenceLabel(fileRef);
    }

    if (metaEl) {
        metaEl.textContent = [meta.sizeText, meta.typeText].filter(Boolean).join(' · ');
    }

    if (downloadEl) {
        downloadEl.dataset.fileRef = fileRef;
    }

    if (summaryEl) {
        summaryEl.textContent = meta.summary || '';
        summaryEl.hidden = !meta.summary;
    }

    node.dataset.hydrated = '1';
}

function applyFileReferenceError(node, error) {
    if (!node) return;

    const metaEl = node.querySelector('.file-reference-meta');

    if (metaEl) {
        metaEl.textContent = error && error.message ? error.message : '文件信息读取失败';
    }

    node.dataset.hydrated = 'error';
}

function hydrateFileReferences(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const nodes = Array.from(scope.querySelectorAll('.file-reference[data-file-ref]'));

    nodes.forEach((node) => {
        if (!node || node.dataset.hydrated === '1' || node.dataset.hydrated === 'loading') {
            return;
        }

        const fileRef = normalizeFileReferencePath(node.dataset.fileRef || '');

        if (!fileRef) {
            applyFileReferenceError(node, new Error('文件路径为空'));
            return;
        }

        node.dataset.hydrated = 'loading';
        resolveFileReferenceMeta(fileRef)
            .then((meta) => applyFileReferenceMeta(node, meta))
            .catch((error) => applyFileReferenceError(node, error));
    });
}

function installFileReferenceHydrator() {
    if (fileReferenceHydratorInstalled) {
        return;
    }

    const start = () => {
        if (!document.body || fileReferenceHydratorInstalled) {
            return;
        }

        fileReferenceHydratorInstalled = true;
        hydrateFileReferences(document);
        fileReferenceHydratorObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof Element)) {
                        return;
                    }

                    if (node.matches && node.matches('.file-reference[data-file-ref]')) {
                        hydrateFileReferences(node.parentElement || document);
                        return;
                    }

                    hydrateFileReferences(node);
                });
            });
        });
        fileReferenceHydratorObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}

installFileReferenceHydrator();

function attachCloudFileAsAttachment(fileRef, sandboxPath, aliasName = '', sizeBytes = 0) {
    const ref = String(fileRef || '').trim();
    const sandbox = String(sandboxPath || '').trim();
    const name = String(aliasName || ref || '').trim();
    if (!sandbox) {
        showToast('文件路径无效，无法附加');
        return false;
    }
    const exists = uploadedFileIds.some((f) => (
        f && String(f.type || '') === 'sandbox_file' &&
        String(f.sandbox_path || '').trim() === sandbox
    ));
    if (exists) {
        showToast('该文件已附加');
        return false;
    }
    uploadedFileIds.push({
        type: 'sandbox_file',
        name: name || sandbox.split('/').pop() || 'cloud-file',
        original_name: name || '',
        sandbox_path: sandbox,
        stored_path: ref || sandbox,
        size: Number(sizeBytes || 0)
    });
    updateFilePreview();
    if (els.messageInput) {
        els.messageInput.focus();
    }
    showToast('已附加到输入框');
    return true;
}

function renderCloudFileList(files) {
    if (!els.cloudFileList) return;
    const arr = Array.isArray(files) ? files : [];
    if (els.cloudFileCount) els.cloudFileCount.textContent = String(arr.length);
    if (arr.length === 0) {
        els.cloudFileList.innerHTML = '<div class="cloud-file-empty">暂无文件</div>';
        return;
    }

    els.cloudFileList.innerHTML = arr.map((f) => {
        const fileRefRaw = getCloudFileRef(f);
        const sandboxPathRaw = getCloudFileSandboxPath(f);
        const displayNameRaw = getCloudFileDisplayName(f);
        const alias = escapeHtml(displayNameRaw);
        const sizeText = escapeHtml(formatFileSize(getCloudFileSize(f)));
        const updatedText = escapeHtml(formatFileUpdatedAt(getCloudFileUpdatedAt(f)));
        return `
            <div class="cloud-file-item" data-file-ref="${escapeHtml(fileRefRaw)}" data-file-path="${escapeHtml(sandboxPathRaw)}" data-file-name="${escapeHtml(displayNameRaw)}" data-file-size="${getCloudFileSize(f)}" title="点击展开预览">
                <div class="cloud-file-main">
                    <div class="cloud-file-head">
                        <div class="cloud-file-name">${alias}</div>
                        <div class="cloud-file-actions">
                            <button class="cloud-file-btn cloud-file-attach" data-action="attach" title="附加到输入框">
                                <i class="fa-solid fa-circle-plus"></i>
                            </button>
                            <button class="cloud-file-btn cloud-file-download" data-action="download" title="下载">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="cloud-file-btn cloud-file-delete" data-action="delete" title="删除">
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                    <div class="cloud-file-meta">
                        <span class="cloud-file-size">${sizeText}</span>
                        <span class="cloud-file-time">${updatedText}</span>
                    </div>
                </div>
                <div class="cloud-file-preview-wrap">
                    <div class="cloud-file-preview cloud-file-preview-empty">点击展开预览</div>
                </div>
            </div>
        `;
    }).join('');

    els.cloudFileList.querySelectorAll('.cloud-file-item').forEach((el) => {
        const fileRef = (el.dataset.fileRef || '').trim();
        const filePath = (el.dataset.filePath || '').trim();
        const fileName = (el.dataset.fileName || '').trim();
        const fileSize = Number(el.dataset.fileSize || 0);
        const previewEl = el.querySelector('.cloud-file-preview');
        const previewWrap = el.querySelector('.cloud-file-preview-wrap');
        const mainRow = el.querySelector('.cloud-file-main');
        const btnAttach = el.querySelector('.cloud-file-attach');
        const btnDownload = el.querySelector('.cloud-file-download');
        const btnDelete = el.querySelector('.cloud-file-delete');

        if (mainRow) {
            mainRow.addEventListener('click', async (e) => {
                if (e.target && e.target.closest('.cloud-file-btn')) return;
                const willExpand = !el.classList.contains('expanded');
                els.cloudFileList.querySelectorAll('.cloud-file-item.expanded').forEach((other) => {
                    if (other !== el) other.classList.remove('expanded');
                });
                if (!willExpand) {
                    el.classList.remove('expanded');
                    return;
                }
                el.classList.add('expanded');
                if (!previewWrap || !previewEl) return;
                if (previewWrap.dataset.loaded === '1') return;
                await loadCloudFilePreview(fileRef, previewEl);
                previewWrap.dataset.loaded = '1';
            });
        }

        el.addEventListener('click', (e) => {
            // clicking blank preview area should not trigger re-open logic from container
            if (e.target && e.target.closest('.cloud-file-main')) return;
            const willExpand = !el.classList.contains('expanded');
            if (!willExpand) el.classList.remove('expanded');
        });

        if (btnAttach) {
            btnAttach.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const attached = attachCloudFileAsAttachment(fileRef, filePath, fileName || fileRef, fileSize);
                if (attached) {
                    btnAttach.classList.add('attached');
                    btnAttach.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(() => {
                        btnAttach.classList.remove('attached');
                        btnAttach.innerHTML = '<i class="fa-solid fa-circle-plus"></i>';
                    }, 1200);
                }
            });
        }
        if (btnDownload) {
            btnDownload.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadCloudFile(fileRef);
            });
        }
        if (btnDelete) {
            btnDelete.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await removeCloudFile(fileRef);
            });
        }
    });
}

async function loadCloudFiles() {
    if (!els.cloudFileList) return;
    const q = (els.cloudFileSearchInput && els.cloudFileSearchInput.value ? els.cloudFileSearchInput.value : '').trim();
    els.cloudFileList.innerHTML = '<div class="cloud-file-empty">加载中...</div>';
    try {
        const url = `/api/files/list${q ? `?q=${encodeURIComponent(q)}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data || !data.success) {
            const msg = data && data.message ? data.message : '读取失败';
            els.cloudFileList.innerHTML = `<div class="cloud-file-empty">${escapeHtml(msg)}</div>`;
            if (els.cloudFileCount) els.cloudFileCount.textContent = '0';
            return;
        }
        renderCloudFileList(data.files || []);
    } catch (e) {
        els.cloudFileList.innerHTML = '<div class="cloud-file-empty">读取失败</div>';
        if (els.cloudFileCount) els.cloudFileCount.textContent = '0';
    }
}

async function handleFileCenterFileAction(action, fileRef) {
    const file = findFileCenterItem(fileRef);

    if (!file) return;

    const ref = getCloudFileRef(file);
    const sandboxPath = getCloudFileSandboxPath(file);
    const displayName = getCloudFileDisplayName(file);
    const size = getCloudFileSize(file);

    if (action === 'attach') {
        attachCloudFileAsAttachment(ref, sandboxPath, displayName, size);
        return;
    }

    if (action === 'download') {
        downloadCloudFile(ref);
        return;
    }

    if (action === 'delete') {
        captureFileCenterListScrollPosition();

        const removed = await removeCloudFile(ref);

        if (removed) {
            await loadFileCenterFiles({ keepSelection: true });
            restoreFileCenterListScrollPosition();
        }
    }
}

function clearFileCenterSearchTimer() {
    if (!fileCenterState.searchTimer) return;

    window.clearTimeout(fileCenterState.searchTimer);
    fileCenterState.searchTimer = 0;
}

function queueFileCenterSearch() {
    clearFileCenterSearchTimer();
    fileCenterState.searchTimer = window.setTimeout(() => {
        fileCenterState.searchTimer = 0;
        void loadFileCenterFiles({ keepSelection: false });
    }, 260);
}

function getFileCenterMetaParts(file) {
    const createdText = formatFileUpdatedAt(getCloudFileCreatedAt(file));
    const updatedText = formatFileUpdatedAt(getCloudFileUpdatedAt(file));
    const parts = [
        `大小：${formatFileSize(getCloudFileSize(file))}`
    ];

    if (createdText && createdText !== '-') {
        parts.unshift(`上传：${createdText}`);
    }

    if (updatedText && updatedText !== '-') {
        parts.push(`更新：${updatedText}`);
    }

    return parts;
}

function sortFileCenterItems(items) {
    const arr = Array.isArray(items) ? [...items] : [];

    if (fileCenterState.sortBy === 'name_asc') {
        arr.sort((a, b) => {
            const nameCompare = getCloudFileDisplayName(a).localeCompare(getCloudFileDisplayName(b), undefined, {
                numeric: true,
                sensitivity: 'base'
            });

            if (nameCompare !== 0) return nameCompare;

            return getCloudFileCreatedAt(b) - getCloudFileCreatedAt(a);
        });
        return arr;
    }

    arr.sort((a, b) => {
        const createdCompare = getCloudFileCreatedAt(b) - getCloudFileCreatedAt(a);

        if (createdCompare !== 0) return createdCompare;

        return getCloudFileDisplayName(a).localeCompare(getCloudFileDisplayName(b), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });
    return arr;
}

function buildFileCenterDirectoryEntries(files, currentPath = '', query = '') {
    const sourceFiles = Array.isArray(files) ? files : [];
    const folderMap = new Map();
    const directFiles = [];
    const path = normalizeFileCenterPath(currentPath);
    const hasQuery = !!String(query || '').trim();

    sourceFiles.forEach((file) => {
        const aliasPath = getFileCenterItemAliasPath(file);

        if (!aliasPath) {
            directFiles.push({ kind: 'file', file });
            return;
        }

        const prefix = path ? `${path}/` : '';

        if (path && aliasPath !== path && !aliasPath.startsWith(prefix)) {
            return;
        }

        if (hasQuery) {
            directFiles.push({ kind: 'file', file });
            return;
        }

        const remainder = path ? aliasPath.slice(prefix.length) : aliasPath;

        if (!remainder) {
            return;
        }

        const parts = remainder.split('/').filter(Boolean);

        if (parts.length <= 1) {
            directFiles.push({ kind: 'file', file });
            return;
        }

        const folderName = parts[0];
        const folderPath = path ? `${path}/${folderName}` : folderName;
        const prev = folderMap.get(folderPath) || {
            kind: 'folder',
            name: folderName,
            path: folderPath,
            count: 0,
            updatedAt: 0,
        };

        prev.count += 1;
        prev.updatedAt = Math.max(prev.updatedAt, getCloudFileUpdatedAt(file), getCloudFileCreatedAt(file));
        folderMap.set(folderPath, prev);
    });

    return [
        ...Array.from(folderMap.values()),
        ...directFiles,
    ];
}

function sortFileCenterDirectoryEntries(entries) {
    const arr = Array.isArray(entries) ? [...entries] : [];

    arr.sort((a, b) => {
        const folderCompare = (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1);

        if (folderCompare !== 0) {
            return folderCompare;
        }

        if (a.kind === 'folder' && b.kind === 'folder') {
            if (fileCenterState.sortBy === 'created_desc') {
                const updatedCompare = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);

                if (updatedCompare !== 0) {
                    return updatedCompare;
                }
            }

            return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        }

        return sortFileCenterItems([a.file, b.file])[0] === a.file ? -1 : 1;
    });

    return arr;
}

function openFileCenterFolder(path) {
    const nextPath = normalizeFileCenterPath(path);

    if (!nextPath) {
        return;
    }

    fileCenterState.currentPath = nextPath;
    fileCenterState.selectedFileRef = '';
    resetFileCenterListScrollPosition();
    hideFileCenterContextMenu();
    renderFileCenterHomeView({ loading: true });
    void loadFileCenterFiles({ keepSelection: false });
}

function openFileCenterParentFolder() {
    const path = normalizeFileCenterPath(fileCenterState.currentPath);

    if (!path) {
        return;
    }

    const parts = path.split('/').filter(Boolean);
    parts.pop();
    fileCenterState.currentPath = parts.join('/');
    fileCenterState.selectedFileRef = '';
    resetFileCenterListScrollPosition();
    hideFileCenterContextMenu();
    renderFileCenterHomeView({ loading: true });
    void loadFileCenterFiles({ keepSelection: false });
}

function getFileCenterSortLabel(sortBy = fileCenterState.sortBy) {
    return sortBy === 'name_asc' ? '文件名称' : '上传时间';
}

function closeFileCenterSortDropdown() {
    const dropdown = document.getElementById('fileCenterSortDropdown');
    const trigger = document.getElementById('fileCenterSortTrigger');

    if (!dropdown) return;

    dropdown.classList.remove('open');

    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
    }
}

function setFileCenterSort(sortBy) {
    const nextSort = String(sortBy || '').trim();

    if (nextSort !== 'created_desc' && nextSort !== 'name_asc') return;

    fileCenterState.sortBy = nextSort;
    resetFileCenterListScrollPosition();

    const label = document.getElementById('fileCenterSortLabel');

    if (label) {
        label.textContent = getFileCenterSortLabel(nextSort);
    }

    document.querySelectorAll('[data-file-center-sort]').forEach((button) => {
        const active = String(button.getAttribute('data-file-center-sort') || '').trim() === nextSort;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    renderFileCenterList(fileCenterState.files);
}

function installFileCenterSortDropdownCloseHandlers() {
    if (window.__fileCenterSortDropdownCloseBound === true) return;

    window.__fileCenterSortDropdownCloseBound = true;
    document.addEventListener('click', (event) => {
        const dropdown = document.getElementById('fileCenterSortDropdown');

        if (!dropdown || !dropdown.classList.contains('open')) return;
        if (event.target instanceof Element && dropdown.contains(event.target)) return;

        closeFileCenterSortDropdown();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFileCenterSortDropdown();
        }
    });
    document.addEventListener('scroll', () => {
        closeFileCenterSortDropdown();
    }, true);
    window.addEventListener('resize', closeFileCenterSortDropdown);
}

function syncFileCenterActiveCard() {
    const list = document.getElementById('fileCenterList');

    if (!list) return;

    const selectedRef = String(fileCenterState.selectedFileRef || '').trim();
    list.querySelectorAll('.file-center-card[data-file-ref]').forEach((row) => {
        const active = String(row.getAttribute('data-file-ref') || '').trim() === selectedRef;
        row.classList.toggle('active', active);
        row.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function clearFileCenterSelection() {
    if (!String(fileCenterState.selectedFileRef || '').trim()) return;

    fileCenterState.selectedFileRef = '';
    syncFileCenterActiveCard();
}

function installFileCenterSelectionClearHandler() {
    if (window.__fileCenterSelectionClearBound === true) return;

    window.__fileCenterSelectionClearBound = true;
    document.addEventListener('click', (event) => {
        if (!fileCenterState || fileCenterState.view !== 'home') return;
        if (!String(fileCenterState.selectedFileRef || '').trim()) return;

        const target = event.target;

        if (target instanceof Element) {
            if (target.closest('.file-center-card[data-file-ref]')) return;
            if (target.closest('#fileCenterContextMenu')) return;
        }

        clearFileCenterSelection();
    });
}

function selectFileCenterFile(fileRef) {
    const ref = String(fileRef || '').trim();

    if (!ref) return;

    fileCenterState.selectedFileRef = ref;
    syncFileCenterActiveCard();
}

function ensureFileCenterContextMenu() {
    let menu = document.getElementById('fileCenterContextMenu');

    if (menu) {
        return menu;
    }

    menu = document.createElement('div');
    menu.id = 'fileCenterContextMenu';
    menu.className = 'pin-context-menu file-center-context-menu';
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
        <button type="button" data-file-center-menu-action="open">
            <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
            <span>打开</span>
        </button>
        <button type="button" data-file-center-menu-action="attach">
            <i class="fa-solid fa-circle-plus" aria-hidden="true"></i>
            <span>加入上下文</span>
        </button>
        <button type="button" data-file-center-menu-action="download">
            <i class="fa-solid fa-download" aria-hidden="true"></i>
            <span>下载</span>
        </button>
        <button class="danger" type="button" data-file-center-menu-action="delete">
            <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
            <span>删除</span>
        </button>
    `;
    document.body.appendChild(menu);

    menu.querySelectorAll('[data-file-center-menu-action]').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const action = String(button.getAttribute('data-file-center-menu-action') || '').trim();
            const fileRef = String(fileCenterState.contextFileRef || '').trim();
            hideFileCenterContextMenu();

            if (!action || !fileRef) return;

            if (action === 'open') {
                openFileCenterFileDetail(fileRef);
                return;
            }

            await handleFileCenterFileAction(action, fileRef);
        });
    });

    document.addEventListener('click', (event) => {
        if (!menu.classList.contains('active')) return;
        if (event.target instanceof Element && menu.contains(event.target)) return;

        hideFileCenterContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideFileCenterContextMenu();
        }
    });
    document.addEventListener('scroll', () => {
        hideFileCenterContextMenu();
    }, true);
    window.addEventListener('resize', hideFileCenterContextMenu);

    return menu;
}

async function closeFileCenterOrReturn(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }

    if (fileCenterState && fileCenterState.view === 'detail') {
        const detailRef = String(fileCenterState.detailFileRef || '').trim();
        const detailReturnTarget = String(fileCenterState.detailReturnTarget || '').trim();

        if (detailReturnTarget === 'workspace-files' && typeof window.returnToWorkspaceFilesFromFileDetail === 'function') {
            fileCenterState.detailReturnTarget = '';
            window.returnToWorkspaceFilesFromFileDetail();
            return;
        }

        if (detailRef) {
            fileCenterState.selectedFileRef = detailRef;
        }

        renderFileCenterHomeView({ restoreScroll: true });
        return;
    }

    await closeFileCenterUploadDialog({ notifyTransferClosed: true });
    closeKnowledgeView();
}

window.closeFileCenterOrReturn = closeFileCenterOrReturn;

function hideFileCenterContextMenu() {
    const menu = document.getElementById('fileCenterContextMenu');

    if (!menu) return;

    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    fileCenterState.contextFileRef = '';
}

function showFileCenterContextMenu(x, y, fileRef) {
    const ref = String(fileRef || '').trim();

    if (!findFileCenterItem(ref)) return;

    if (typeof hidePinContextMenu === 'function') {
        hidePinContextMenu();
    }

    if (typeof hideNotesContextMenu === 'function') {
        hideNotesContextMenu();
    }

    const menu = ensureFileCenterContextMenu();
    fileCenterState.contextFileRef = ref;
    selectFileCenterFile(ref);

    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');

    const menuWidth = menu.offsetWidth || 164;
    const menuHeight = menu.offsetHeight || 152;
    const left = Math.min(Math.max(8, Number(x || 0)), Math.max(8, window.innerWidth - menuWidth - 12));
    const top = Math.min(Math.max(8, Number(y || 0)), Math.max(8, window.innerHeight - menuHeight - 12));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function getFileCenterShell() {
    return document.getElementById('fileCenterShell');
}

function captureFileCenterListScrollPosition() {
    getNexoraChatFiles().captureFileCenterScrollPosition(fileCenterState);
}

function resetFileCenterListScrollPosition() {
    getNexoraChatFiles().resetFileCenterScrollPosition(fileCenterState);
}

// Files 列表会在详情切换时整体重绘，返回时必须把滚动位置写回真实滚动容器。
function restoreFileCenterListScrollPosition() {
    getNexoraChatFiles().restoreFileCenterScrollPosition(fileCenterState);
}

function renderFileCenterDetailContentLoading() {
    const content = document.getElementById('fileCenterDetailContent');

    if (!content) return;

    content.innerHTML = '<div class="file-center-detail-empty">加载中...</div>';
}

async function loadFileCenterDetailContent(fileRef) {
    const ref = String(fileRef || '').trim();
    const content = document.getElementById('fileCenterDetailContent');
    const file = findFileCenterItem(ref);

    if (!ref || !content) return;

    const requestSeq = fileCenterState.detailRequestSeq + 1;
    fileCenterState.detailRequestSeq = requestSeq;
    renderFileCenterDetailContentLoading();

    if (file && isCloudFileImage(file)) {
        const imageUrl = getCloudFileInlineUrl(ref, getFileCenterDetailUrl(ref, 'detailInlineUrl'));
        content.innerHTML = `
            <div class="file-center-detail-image-wrap">
                <img class="file-center-detail-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(getCloudFileDisplayName(file))}">
            </div>
        `;
        return;
    }

    try {
        const res = await fetch(getFileCenterReadUrl(ref), { cache: 'no-store' });
        const data = await res.json();

        if (requestSeq !== fileCenterState.detailRequestSeq) return;

        if (!data || !data.success) {
            const message = String((data && data.message) || '文件内容读取失败');
            content.innerHTML = `<div class="file-center-detail-empty">${escapeHtml(message)}</div>`;
            return;
        }

        const text = String(data.content || '');

        if (!text) {
            content.innerHTML = '<div class="file-center-detail-empty">文件内容为空</div>';
            return;
        }

        content.innerHTML = `<pre class="file-center-detail-pre">${escapeHtml(text)}</pre>`;
    } catch (error) {
        console.error('loadFileCenterDetailContent failed', error);

        if (requestSeq !== fileCenterState.detailRequestSeq) return;

        content.innerHTML = '<div class="file-center-detail-empty">文件内容读取失败</div>';
    }
}

function renderFileCenterHomeView(options = {}) {
    const shell = getFileCenterShell();

    if (!shell) return;

    const currentPath = normalizeFileCenterPath(fileCenterState.currentPath);
    fileCenterState.currentPath = currentPath;
    fileCenterState.view = 'home';
    fileCenterState.detailFileRef = '';
    fileCenterState.detailRequestSeq += 1;
    hideFileCenterContextMenu();
    closeFileCenterSortDropdown();

    shell.innerHTML = `
        <div class="file-center-head">
            <div>
                <h1>Files</h1>
                <div class="file-center-count-line">
                    <span id="fileCenterCount">0</span>
                    <span>项</span>
                </div>
                <div class="file-center-breadcrumb" id="fileCenterBreadcrumb">${escapeHtml(currentPath || '全部文件')}</div>
            </div>
            <div class="file-center-actions">
                <button class="file-center-tool-btn" id="fileCenterBackBtn" type="button" title="返回上一级" aria-label="返回上一级"${currentPath ? '' : ' disabled'}>
                    <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                </button>
                <label class="file-center-search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input id="fileCenterSearchInput" type="search" placeholder="搜索文件" aria-label="搜索文件" value="${escapeHtml(fileCenterState.query)}">
                </label>
                <div class="tool-mode-dropdown file-center-sort-dropdown" id="fileCenterSortDropdown">
                    <button class="tool-mode-trigger file-center-sort-trigger" id="fileCenterSortTrigger" type="button" aria-haspopup="listbox" aria-expanded="false" title="排序方式">
                        <i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>
                        <span id="fileCenterSortLabel">${escapeHtml(getFileCenterSortLabel())}</span>
                        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                    </button>
                    <div class="tool-mode-menu file-center-sort-menu" id="fileCenterSortMenu" role="listbox" aria-label="排序方式">
                        <button class="tool-mode-item${fileCenterState.sortBy === 'created_desc' ? ' active' : ''}" type="button" role="option" aria-selected="${fileCenterState.sortBy === 'created_desc' ? 'true' : 'false'}" data-file-center-sort="created_desc">上传时间</button>
                        <button class="tool-mode-item${fileCenterState.sortBy === 'name_asc' ? ' active' : ''}" type="button" role="option" aria-selected="${fileCenterState.sortBy === 'name_asc' ? 'true' : 'false'}" data-file-center-sort="name_asc">文件名称</button>
                    </div>
                </div>
                <button class="file-center-tool-btn" id="fileCenterRefreshBtn" type="button" title="刷新" aria-label="刷新">
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                </button>
                <button class="file-center-upload-btn" id="fileCenterUploadBtn" type="button">
                    <i class="fa-solid fa-upload" aria-hidden="true"></i>
                    <span>上传</span>
                </button>
                <input id="fileCenterUploadInput" type="file" multiple hidden>
            </div>
        </div>

        <div class="file-center-layout">
            <div class="file-center-list" id="fileCenterList" role="listbox" aria-label="文件列表"></div>
        </div>
    `;

    bindFileCenterView();

    if (options && options.loading === true) {
        const list = document.getElementById('fileCenterList');

        if (list) {
            list.innerHTML = '<div class="file-center-empty">加载中...</div>';
        }

        return;
    }

    renderFileCenterList(fileCenterState.files);

    if (options && options.restoreScroll === true) {
        restoreFileCenterListScrollPosition();
    }
}

function openFileCenterFileDetail(fileRef) {
    const ref = String(fileRef || '').trim();
    const file = findFileCenterItem(ref);
    const shell = getFileCenterShell();

    if (!file || !shell) return;

    if (fileCenterState.view === 'home') {
        captureFileCenterListScrollPosition();
    }

    const displayName = getCloudFileDisplayName(file);
    const meta = getFileCenterMetaParts(file).join(' · ');

    fileCenterState.view = 'detail';
    fileCenterState.detailFileRef = ref;
    fileCenterState.selectedFileRef = ref;
    hideFileCenterContextMenu();
    closeFileCenterSortDropdown();

    shell.innerHTML = `
        <div class="file-center-detail">
            <div class="file-center-detail-head">
                <span class="file-center-file-icon ${escapeHtml(getCloudFileToneClass(file))}" aria-hidden="true">
                    <i class="${escapeHtml(getCloudFileIconClass(file))}"></i>
                </span>
                <div class="file-center-detail-title">
                    <h1 title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</h1>
                    <div class="file-center-detail-meta">${escapeHtml(meta)}</div>
                </div>
            </div>
            <div class="file-center-detail-content" id="fileCenterDetailContent"></div>
        </div>
    `;

    void loadFileCenterDetailContent(ref);
}

function renderFileCenterList(files) {
    const list = document.getElementById('fileCenterList');
    const count = document.getElementById('fileCenterCount');

    if (!list) return;

    const query = String(fileCenterState.query || '').trim();
    const visibleFiles = (Array.isArray(files) ? files : []).filter((file) => fileCenterFileMatchesQuery(file, query));
    const entries = buildFileCenterDirectoryEntries(visibleFiles, fileCenterState.currentPath, query);
    const items = sortFileCenterDirectoryEntries(entries);

    if (count) {
        count.textContent = String(items.length);
    }

    if (!items.length) {
        fileCenterState.selectedFileRef = '';
        list.innerHTML = '<div class="file-center-empty">暂无文件</div>';
        return;
    }

    const currentRef = String(fileCenterState.selectedFileRef || '').trim();
    const currentExists = currentRef && items.some((item) => item.kind === 'file' && getCloudFileRef(item.file) === currentRef);
    const activeRef = currentExists ? currentRef : '';
    fileCenterState.selectedFileRef = activeRef;

    list.innerHTML = `
        ${items.map((entry) => {
            if (entry.kind === 'folder') {
                const title = `${entry.path}\n${entry.count} 个项目`;

                return `
                    <div class="file-center-card file-center-folder-card" role="option" tabindex="0" aria-selected="false" data-folder-path="${escapeHtml(entry.path)}" title="${escapeHtml(title)}">
                        <div class="file-center-card-icon-wrap">
                            <span class="file-center-file-icon tone-folder">
                                <i class="fa-regular fa-folder" aria-hidden="true"></i>
                            </span>
                        </div>
                        <div class="file-center-card-name">${escapeHtml(entry.name)}</div>
                    </div>
                `;
            }

            const file = entry.file;
            const fileRef = getCloudFileRef(file);
            const displayName = getCloudFileDisplayName(file);
            const originalName = getCloudFileOriginalName(file);
            const updatedText = formatFileUpdatedAt(getCloudFileUpdatedAt(file));
            const titleLines = [
                displayName,
                originalName && originalName !== displayName ? originalName : '',
                `大小：${formatFileSize(getCloudFileSize(file))}`,
                updatedText && updatedText !== '-' ? `更新：${updatedText}` : ''
            ].filter(Boolean);
            const title = titleLines.join('\n');
            const activeClass = fileRef === activeRef ? ' active' : '';

            return `
                <div class="file-center-card${activeClass}" role="option" tabindex="0" aria-selected="${fileRef === activeRef ? 'true' : 'false'}" data-file-ref="${escapeHtml(fileRef)}" title="${escapeHtml(title)}">
                    <div class="file-center-card-icon-wrap">
                        ${renderCloudFileCardMedia(file, getCloudFileInlineUrl(fileRef))}
                    </div>
                    <div class="file-center-card-name">${escapeHtml(displayName)}</div>
                </div>
            `;
        }).join('')}
    `;

    list.querySelectorAll('.file-center-folder-card[data-folder-path]').forEach((row) => {
        const readPath = () => normalizeFileCenterPath(row.getAttribute('data-folder-path'));

        row.addEventListener('click', () => {
            openFileCenterFolder(readPath());
        });
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                openFileCenterFolder(readPath());
            }
        });
    });

    list.querySelectorAll('.file-center-card[data-file-ref]').forEach((row) => {
        const readRef = () => String(row.getAttribute('data-file-ref') || '').trim();

        row.addEventListener('click', () => {
            selectFileCenterFile(readRef());
        });
        row.addEventListener('dblclick', () => {
            openFileCenterFileDetail(readRef());
        });
        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showFileCenterContextMenu(event.clientX, event.clientY, readRef());
        });
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                openFileCenterFileDetail(readRef());
                return;
            }

            if (event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                selectFileCenterFile(readRef());
                return;
            }

            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                const rect = row.getBoundingClientRect();

                event.preventDefault();
                showFileCenterContextMenu(rect.left + 16, rect.top + 16, readRef());
            }
        });
    });
}

async function loadFileCenterFiles(options = {}) {
    const list = document.getElementById('fileCenterList');
    const count = document.getElementById('fileCenterCount');
    const searchInput = document.getElementById('fileCenterSearchInput');
    const keepSelection = options && options.keepSelection === true;

    if (!list) return false;

    const query = String(searchInput ? searchInput.value : fileCenterState.query || '').trim();
    fileCenterState.query = query;

    if (!keepSelection) {
        fileCenterState.selectedFileRef = '';
        resetFileCenterListScrollPosition();
    }

    list.innerHTML = '<div class="file-center-empty">加载中...</div>';

    if (count) {
        count.textContent = '0';
    }

    try {
        const url = buildFileCenterListUrl(query, fileCenterState.currentPath);
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();

        if (!data || !data.success) {
            const message = String((data && data.message) || '文件列表读取失败');
            list.innerHTML = `<div class="file-center-empty">${escapeHtml(message)}</div>`;
            return false;
        }

        fileCenterState.files = Array.isArray(data.files) ? data.files : [];
        renderFileCenterList(fileCenterState.files);
        return true;
    } catch (error) {
        list.innerHTML = '<div class="file-center-empty">文件列表读取失败</div>';
        return false;
    }
}

async function handleFileCenterUploadChange(input) {
    const files = Array.from((input && input.files) ? input.files : []);

    if (!files.length) return;

    setFileCenterUploadDialogFiles(files);
}

async function uploadFileCenterFiles(...args) {
    return fileCenterUploadController.uploadFileCenterFiles(...args);
}

function ensureFileCenterUploadDialog(...args) {
    return fileCenterUploadController.ensureFileCenterUploadDialog(...args);
}

function bindFileCenterUploadDialog(...args) {
    return fileCenterUploadController.bindFileCenterUploadDialog(...args);
}

function openFileCenterUploadDialog(...args) {
    return fileCenterUploadController.openFileCenterUploadDialog(...args);
}

async function closeFileCenterUploadDialog(...args) {
    return fileCenterUploadController.closeFileCenterUploadDialog(...args);
}

function setFileCenterUploadDialogFiles(...args) {
    return fileCenterUploadController.setFileCenterUploadDialogFiles(...args);
}

function renderFileCenterUploadDialog(...args) {
    return fileCenterUploadController.renderFileCenterUploadDialog(...args);
}

function renderFileCenterLiveTransferProgress(...args) {
    return fileCenterUploadController.renderFileCenterLiveTransferProgress(...args);
}

async function directUploadFromFileCenterDialog(...args) {
    return fileCenterUploadController.directUploadFromFileCenterDialog(...args);
}

async function createLiveTransferFromFileCenterDialog(...args) {
    return fileCenterUploadController.createLiveTransferFromFileCenterDialog(...args);
}

function updateFileCenterLiveTransferStatus(...args) {
    return fileCenterUploadController.updateFileCenterLiveTransferStatus(...args);
}

function assertFileCenterLiveTransferActive(...args) {
    return fileCenterUploadController.assertFileCenterLiveTransferActive(...args);
}

async function readFileCenterLiveTransferJson(...args) {
    return fileCenterUploadController.readFileCenterLiveTransferJson(...args);
}

function updateFileCenterLiveTransferUploadProgress(...args) {
    return fileCenterUploadController.updateFileCenterLiveTransferUploadProgress(...args);
}

async function sendFileCenterLiveTransferChunk(...args) {
    return fileCenterUploadController.sendFileCenterLiveTransferChunk(...args);
}

async function finishFileCenterLiveTransferUpload(...args) {
    return fileCenterUploadController.finishFileCenterLiveTransferUpload(...args);
}

async function startFileCenterLiveTransferUpload(...args) {
    return fileCenterUploadController.startFileCenterLiveTransferUpload(...args);
}

function startFileCenterLiveTransferTimers(...args) {
    return fileCenterUploadController.startFileCenterLiveTransferTimers(...args);
}

function renderFileCenterLiveTransferEvents(...args) {
    return fileCenterUploadController.renderFileCenterLiveTransferEvents(...args);
}

function stopFileCenterLiveTransferTimers(...args) {
    return fileCenterUploadController.stopFileCenterLiveTransferTimers(...args);
}

async function revokeActiveFileCenterLiveTransfer(...args) {
    return fileCenterUploadController.revokeActiveFileCenterLiveTransfer(...args);
}

async function handleCloudFilePanelUploadChange(input) {
    const files = Array.from((input && input.files) ? input.files : []);

    if (!files.length) return;

    await handleFileUploadFiles(files, {
        source: 'cloud-file-panel',
        attachToInput: false,
        uploadImagesAsFiles: true,
        clearInput: () => {
            input.value = '';
        }
    });
    input.value = '';
    await loadCloudFiles();
}

// --- Files 视图拖拽上传：拖入文件松手后自动打开上传小窗并填入待上传列表 ---
let fileCenterDragDepth = 0;
let fileCenterDragResetBound = false;

function setFileCenterDropHighlight(visible) {
    const view = document.querySelector('.file-center-view');

    if (!view) return;

    view.classList.toggle('file-drop-active', !!visible);
}

function resetFileCenterDragState() {
    fileCenterDragDepth = 0;
    setFileCenterDropHighlight(false);
}

function bindFileCenterDragUpload() {
    const view = document.querySelector('.file-center-view');

    if (!view || view.dataset.fileCenterDropBound === '1') return;

    view.dataset.fileCenterDropBound = '1';

    view.addEventListener('dragenter', (event) => {

        if (!dragEventHasFiles(event)) return;

        event.preventDefault();
        fileCenterDragDepth += 1;
        setFileCenterDropHighlight(true);
    });

    view.addEventListener('dragover', (event) => {

        if (!dragEventHasFiles(event)) return;

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }

        setFileCenterDropHighlight(true);
    });

    view.addEventListener('dragleave', (event) => {

        if (!view.classList.contains('file-drop-active')) return;

        if (dragEventHasFiles(event)) {
            event.preventDefault();
        }

        // 深度计数器：dragleave 会在进入子元素时误触发，归零才真正离开视图
        fileCenterDragDepth = Math.max(0, fileCenterDragDepth - 1);

        if (fileCenterDragDepth === 0) {
            setFileCenterDropHighlight(false);
        }
    });

    view.addEventListener('drop', (event) => {

        if (!dragEventHasFiles(event)) return;

        event.preventDefault();

        const files = Array.from((event.dataTransfer && event.dataTransfer.files) ? event.dataTransfer.files : []);
        resetFileCenterDragState();

        if (!files.length) return;

        // 先打开上传小窗，再把拖入的文件填入待上传列表
        openFileCenterUploadDialog();
        setFileCenterUploadDialogFiles(files);
    });

    // 失焦/切走页面时重置，避免拖拽中断后高亮残留
    if (!fileCenterDragResetBound) {
        fileCenterDragResetBound = true;

        window.addEventListener('blur', () => resetFileCenterDragState());
        document.addEventListener('visibilitychange', () => {

            if (document.hidden) {
                resetFileCenterDragState();
            }
        });
    }
}

function bindFileCenterView() {
    installFileCenterSortDropdownCloseHandlers();
    installFileCenterSelectionClearHandler();

    const list = document.getElementById('fileCenterList');
    const searchInput = document.getElementById('fileCenterSearchInput');
    const sortDropdown = document.getElementById('fileCenterSortDropdown');
    const sortTrigger = document.getElementById('fileCenterSortTrigger');
    const sortMenu = document.getElementById('fileCenterSortMenu');
    const refreshBtn = document.getElementById('fileCenterRefreshBtn');
    const backBtn = document.getElementById('fileCenterBackBtn');
    const uploadBtn = document.getElementById('fileCenterUploadBtn');
    const uploadInput = document.getElementById('fileCenterUploadInput');

    if (list) {
        list.addEventListener('scroll', () => {
            if (fileCenterState.view !== 'home') return;

            captureFileCenterListScrollPosition();
        }, { passive: true });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            queueFileCenterSearch();
        });
        searchInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;

            event.preventDefault();
            clearFileCenterSearchTimer();
            void loadFileCenterFiles({ keepSelection: false });
        });
    }

    if (sortDropdown && sortTrigger && sortMenu) {
        sortTrigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearFileCenterSelection();

            const willOpen = !sortDropdown.classList.contains('open');
            hideFileCenterContextMenu();
            closeFileCenterSortDropdown();
            sortDropdown.classList.toggle('open', willOpen);
            sortTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });

        sortMenu.querySelectorAll('[data-file-center-sort]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                setFileCenterSort(String(button.getAttribute('data-file-center-sort') || '').trim());
                closeFileCenterSortDropdown();
            });
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            clearFileCenterSearchTimer();
            void loadFileCenterFiles({ keepSelection: true });
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            openFileCenterParentFolder();
        });
    }

    if (uploadBtn && uploadInput) {
        uploadBtn.addEventListener('click', () => {
            openFileCenterUploadDialog();
        });
        uploadInput.addEventListener('change', () => {
            void handleFileCenterUploadChange(uploadInput);
        });
    }

    bindFileCenterDragUpload();
}

// 文件中心是主内容区入口，保留右侧 Cloud Files 抽屉作为聊天中的快捷工具。
window.openFilesFrameView = function(options = {}) {
    const detailFileRef = String((options && options.detailFileRef) || '').trim();
    const detailReturnTarget = String((options && options.detailReturnTarget) || '').trim();
    const detailFileItem = normalizeFileCenterDetailFileItem(
        options && options.detailFileItem,
        detailFileRef,
    );
    const detailReadUrl = String((options && options.detailReadUrl) || '').trim();
    const detailInlineUrl = String((options && options.detailInlineUrl) || '').trim();
    const detailDownloadUrl = String((options && options.detailDownloadUrl) || '').trim();
    const initialPath = normalizeFileCenterPath(
        (options && options.currentPath) || getFileCenterParentPathFromFileRef(detailFileRef),
    );

    closeKnowledgePanel();
    closeCloudFilePanel();
    exitLearningFeedComposeMode({ clear: false });
    clearCurrentConversationSelectionForWorkspaceNavigation();
    captureWorkspaceDetailInputHomeForConversationLoad();
    restoreWorkspaceDetailInputContainerForConversationLoad();

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

    knowledgeEditorController.clearCurrentTitle();
    knowledgeEditorController.clearPendingHighlightData();
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

    headerTitle.textContent = 'Files';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeFileCenterOrReturn(event)" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    clearFileCenterSearchTimer();
    hideFileCenterContextMenu();
    fileCenterState = {
        files: detailFileItem ? [detailFileItem] : [],
        query: '',
        currentPath: initialPath,
        selectedFileRef: detailFileRef,
        sortBy: 'created_desc',
        searchTimer: 0,
        view: 'home',
        detailFileRef: detailFileRef,
        detailRequestSeq: 0,
        detailFileItem: detailFileItem,
        detailReadUrl: detailReadUrl,
        detailInlineUrl: detailInlineUrl,
        detailDownloadUrl: detailDownloadUrl,
        contextFileRef: '',
        detailReturnTarget: detailReturnTarget,
        listScrollTop: 0
    };

    viewer.innerHTML = `
        <section class="file-center-view" aria-label="Files">
            <div class="file-center-shell" id="fileCenterShell"></div>
        </section>
    `;

    renderFileCenterHomeView({ loading: true });

    if (detailFileRef && detailFileItem) {
        openFileCenterFileDetail(detailFileRef);
        _syncTurnIndicatorVisibility();
        return;
    }

    void loadFileCenterFiles({ keepSelection: !!detailFileRef }).then((loaded) => {
        if (!detailFileRef) {
            return;
        }

        if (!loaded) {
            return;
        }

        if (!findFileCenterItem(detailFileRef)) {
            showToast('Files 页面中未找到该文件');
            return;
        }

        openFileCenterFileDetail(detailFileRef);
    });
    _syncTurnIndicatorVisibility();
};

// DOM Elements
const els = {
    sidebar: document.getElementById('sidebar'),
    mainContent: document.querySelector('.main-content'),
    inputDock: document.querySelector('.input-dock'),
    messagesContainer: document.getElementById('messagesContainer'),
    learningMainPanel: document.getElementById('learningMainPanel'),
    turnIndicatorLines: document.getElementById('turnIndicatorLines'),
    messageInput: document.getElementById('messageInput'),
    longtermPlanPanel: document.getElementById('longtermPlanPanel'),
    longtermPlanToggle: document.getElementById('longtermPlanToggle'),
    longtermPlanStatus: document.getElementById('longtermPlanStatus'),
    longtermPlanTask: document.getElementById('longtermPlanTask'),
    longtermPlanBody: document.getElementById('longtermPlanBody'),
    fileInput: document.getElementById('fileInput'),
    filePreviewArea: document.getElementById('filePreviewArea'),
    fileUploadProgressWrap: document.getElementById('fileUploadProgressWrap'),
    fileUploadProgressFill: document.getElementById('fileUploadProgressFill'),
    fileUploadProgressText: document.getElementById('fileUploadProgressText'),
    cancelFileUploadBtn: document.getElementById('cancelFileUploadBtn'),
    sendBtn: document.getElementById('sendBtn'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    // New Model Selector
    modelSelectContainer: document.getElementById('modelSelectContainer'),
    currentModelDisplay: document.getElementById('currentModelDisplay'),
    modelOptions: document.getElementById('modelOptions'),
    // ...
    conversationList: document.getElementById('conversationList'),
    learningSidebarPanel: document.getElementById('learningSidebarPanel'),
    sidebarBrandNexoraTab: document.getElementById('sidebarBrandNexoraTab'),
    sidebarBrandLearningTab: document.getElementById('sidebarBrandLearningTab'),
    newChatBtn: document.getElementById('newChatBtn'),
    workspacesBtn: document.getElementById('workspacesBtn'),
    fileCenterBtn: document.getElementById('fileCenterBtn'),
    learningProgressBtn: document.getElementById('learningProgressBtn'),
    learningResourcesGroup: document.getElementById('learningResourcesGroup'),
    learningResourcesBtn: document.getElementById('learningResourcesBtn'),
    learningResourcesToggleBtn: document.getElementById('learningResourcesToggleBtn'),
    learningResourcesStudioMenu: document.getElementById('learningResourcesStudioMenu'),
    learningPracticeGroup: document.getElementById('learningPracticeGroup'),
    learningPracticeBtn: document.getElementById('learningPracticeBtn'),
    learningPracticeToggleBtn: document.getElementById('learningPracticeToggleBtn'),
    learningPracticeMenu: document.getElementById('learningPracticeMenu'),
    learningProfileBtn: document.getElementById('learningProfileBtn'),
    learningFeedBtn: document.getElementById('learningFeedBtn'),
    learningCoursesBtn: document.getElementById('learningCoursesBtn'),
    conversationTitle: document.getElementById('conversationTitle'),
    knowledgePanel: document.getElementById('knowledgePanel'),
    filePanel: document.getElementById('filePanel'),
    toggleWorkflowView: document.getElementById('toggleWorkflowView'),
    toggleNotesPanel: document.getElementById('toggleNotesPanel'),
    mobileHeaderMenu: document.getElementById('mobileHeaderMenu'),
    mobileHeaderMenuTrigger: document.getElementById('mobileHeaderMenuTrigger'),
    mobileHeaderMenuPanel: document.getElementById('mobileHeaderMenuPanel'),
    mobileWorkflowMenuItem: document.getElementById('mobileWorkflowMenuItem'),
    mobileNotesMenuItem: document.getElementById('mobileNotesMenuItem'),
    toggleMailView: document.getElementById('toggleMailView'),
    toggleFilePanel: document.getElementById('toggleFilePanel'),
    toggleKnowledgePanel: document.getElementById('toggleKnowledgePanel'),
    btnTogglePanel: document.getElementById('btnTogglePanel'), // Close button inside panel
    btnToggleFilePanel: document.getElementById('btnToggleFilePanel'),
    refreshKnowledgeBtn: document.getElementById('refreshKnowledgeBtn'),
    refreshCloudFilesBtn: document.getElementById('refreshCloudFilesBtn'),
    uploadCloudFilesBtn: document.getElementById('uploadCloudFilesBtn'),
    cloudFileUploadInput: document.getElementById('cloudFileUploadInput'),
    createBlankBasisBtn: document.getElementById('createBlankBasisBtn'),
    bulkVectorizeBtn: document.getElementById('bulkVectorizeBtn'),
    panelBasisList: document.getElementById('panelBasisKnowledgeList'),
    panelBasisCount: document.getElementById('panelBasisCount'),
    cloudFileSearchInput: document.getElementById('cloudFileSearchInput'),
    cloudFileSearchBtn: document.getElementById('cloudFileSearchBtn'),
    cloudFileCount: document.getElementById('cloudFileCount'),
    cloudFileList: document.getElementById('cloudFileList'),
    tokenBudgetMini: document.getElementById('tokenBudgetMini'),
    tokenBudgetRing: document.getElementById('tokenBudgetRing'),
    tokenBudgetContextToggle: document.getElementById('tokenBudgetContextToggle'),
    tokenBudgetUsage: document.getElementById('tokenBudgetUsage'),
    tokenDisplay: document.getElementById('tokenDisplay'),
    modalTotalTokens: document.getElementById('modalTotalTokens'),
    modalTodayTokens: document.getElementById('modalTodayTokens'),
    tokenModal: document.getElementById('tokenModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    imageViewerBackdrop: document.getElementById('imageViewerBackdrop'),
    imageViewerViewport: document.getElementById('imageViewerViewport'),
    imageViewerImage: document.getElementById('imageViewerImage'),
    imageViewerClose: document.getElementById('imageViewerClose'),
    imageViewerZoomIn: document.getElementById('imageViewerZoomIn'),
    imageViewerZoomOut: document.getElementById('imageViewerZoomOut'),
    imageViewerReset: document.getElementById('imageViewerReset'),
    imageViewerScaleLabel: document.getElementById('imageViewerScaleLabel'),
    notesPanel: document.getElementById('notesPanel'),
    notesPanelHead: document.querySelector('#notesPanel .notes-panel-head'),
    closeNotesPanelBtn: document.getElementById('closeNotesPanelBtn'),
    openNotesCompanionBtn: document.getElementById('openNotesCompanionBtn'),
    notesNotebookSelect: document.getElementById('notesNotebookSelect'),
    createNotebookBtn: document.getElementById('createNotebookBtn'),
    clearNotebookBtn: document.getElementById('clearNotebookBtn'),
    deleteNotebookBtn: document.getElementById('deleteNotebookBtn'),
    downloadNotebookBtn: document.getElementById('downloadNotebookBtn'),
    notesResizeHandle: document.getElementById('notesResizeHandle'),
    notesList: document.getElementById('notesList'),
    timelineMenuBtn: document.getElementById('timelineMenuBtn'),
    mobileTimelineMenuItem: document.getElementById('mobileTimelineMenuItem'),
    timelinePanel: document.getElementById('timelinePanel'),
    timelinePanelHead: document.querySelector('#timelinePanel .timeline-panel-head'),
    closeTimelinePanelBtn: document.getElementById('closeTimelinePanelBtn'),
    timelineResizeHandle: document.getElementById('timelineResizeHandle'),
    timelineList: document.getElementById('timelineList'),
    debugConsolePanel: document.getElementById('debugConsolePanel'),
    debugConsoleHead: document.querySelector('#debugConsolePanel .debug-console-head'),
    debugConsolePromptTab: document.getElementById('debugConsolePromptTab'),
    debugConsoleFunctionTab: document.getElementById('debugConsoleFunctionTab'),
    debugConsolePromptPage: document.getElementById('debugConsolePromptPage'),
    debugConsoleFunctionPage: document.getElementById('debugConsoleFunctionPage'),
    debugConsoleBody: document.getElementById('debugConsoleBody'),
    debugConsoleStatus: document.getElementById('debugConsoleStatus'),
    forceContextCompressionBtn: document.getElementById('forceContextCompressionBtn'),
    copyDebugConsoleBtn: document.getElementById('copyDebugConsoleBtn'),
    clearDebugConsoleBtn: document.getElementById('clearDebugConsoleBtn'),
    closeDebugConsoleBtn: document.getElementById('closeDebugConsoleBtn'),
    refreshDebugToolsBtn: document.getElementById('refreshDebugToolsBtn'),
    debugToolSelect: document.getElementById('debugToolSelect'),
    debugToolMeta: document.getElementById('debugToolMeta'),
    debugToolArgsInput: document.getElementById('debugToolArgsInput'),
    executeDebugToolBtn: document.getElementById('executeDebugToolBtn'),
    debugToolResult: document.getElementById('debugToolResult'),
    debugConsoleResizeHandle: document.getElementById('debugConsoleResizeHandle'),
    notesContextMenu: document.getElementById('notesContextMenu'),
    notesAddSelectionBtn: document.getElementById('notesAddSelectionBtn'),
    notesCopySelectionBtn: document.getElementById('notesCopySelectionBtn'),
    notesExplainSelectionBtn: document.getElementById('notesExplainSelectionBtn'),
    pinContextMenu: document.getElementById('pinContextMenu'),
    pinContextMenuAction: document.getElementById('pinContextMenuAction'),
    pinContextMenuRename: document.getElementById('pinContextMenuRename'),
    pinContextMenuBranch: document.getElementById('pinContextMenuBranch'),
    pinContextMenuProjectDelete: document.getElementById('pinContextMenuProjectDelete'),
    pinContextMenuWorkspaceWrap: document.getElementById('pinContextMenuWorkspaceWrap'),
    pinContextMenuWorkspaceList: document.getElementById('pinContextMenuWorkspaceList'),
    conversationRenameModal: document.getElementById('conversationRenameModal'),
    conversationRenameInput: document.getElementById('conversationRenameInput'),
    closeConversationRenameModalBtn: document.getElementById('closeConversationRenameModalBtn'),
    cancelConversationRenameBtn: document.getElementById('cancelConversationRenameBtn'),
    confirmConversationRenameBtn: document.getElementById('confirmConversationRenameBtn'),
    mobileSelectionActionsBar: document.getElementById('mobileSelectionActionsBar'),
    mobileSelectionAddBtn: document.getElementById('mobileSelectionAddBtn'),
    mobileSelectionCopyBtn: document.getElementById('mobileSelectionCopyBtn'),
    mobileSelectionExplainBtn: document.getElementById('mobileSelectionExplainBtn'),
    totalInputTokens: document.getElementById('totalInputTokens'),
    totalOutputTokens: document.getElementById('totalOutputTokens'),
    // Options
    checkThinking: document.getElementById('enableThinking'),
    checkSearch: document.getElementById('enableWebSearch'),
    toolsMode: document.getElementById('toolsMode'),
    toolsModeDropdown: document.getElementById('toolsModeDropdown'),
    toolsModeTrigger: document.getElementById('toolsModeTrigger'),
    toolsModeMenu: document.getElementById('toolsModeMenu'),
    toolsModeLabel: document.getElementById('toolsModeLabel'),
    inputCollapseBtn: document.getElementById('inputCollapseBtn'),
    // Admin & User Menu
    userMenu: document.getElementById('userMenu'),
    usernameBtn: document.getElementById('usernameBtn'),
    trashMenuBtn: document.getElementById('trashMenuBtn'),
    trashModal: document.getElementById('trashModal'),
    closeTrashModalBtn: document.getElementById('closeTrashModalBtn'),
    refreshTrashBtn: document.getElementById('refreshTrashBtn'),
    clearTrashBtn: document.getElementById('clearTrashBtn'),
    trashList: document.getElementById('trashList'),
    logoutLink: document.getElementById('logoutLink'),
    adminLink: document.getElementById('adminBackendBtn'),
    settingsSkillList: document.getElementById('settingsSkillList'),
    skillEditorModal: document.getElementById('skillEditorModal'),
    skillEditorTitle: document.getElementById('skillEditorTitle'),
    skillEditorTools: document.getElementById('skillEditorTools'),
    skillEditorContent: document.getElementById('skillEditorContent'),
    closeSkillEditorBtn: document.getElementById('closeSkillEditorBtn'),
    cancelSkillEditorBtn: document.getElementById('cancelSkillEditorBtn'),
    saveSkillEditorBtn: document.getElementById('saveSkillEditorBtn'),
    adminModal: document.getElementById('adminModal'),
    closeAdminBtn: document.getElementById('closeAdminBtn'),
    userTableBody: document.getElementById('userTableBody'),
    userCount: document.getElementById('userCount'),
    knowledgeSearchInput: document.getElementById('knowledgeSearchInput'),
    knowledgeSearchBtn: document.getElementById('knowledgeSearchBtn')
};

function resetKnowledgeViewRuntimeState() {
    knowledgeEditorController.clearCurrentTitle();
    knowledgeEditorController.clearWorkspaceReturnContext();
    knowledgeEditorController.clearPendingHighlightData();
    navigationStack = [];
}

function ensureExternalViewerBaseHeaderState(headerTitle, headerLeft, headerRight) {
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

function closePrimaryPanelsForExternalView() {
    closeKnowledgePanel();
    closeCloudFilePanel();
    exitLearningFeedComposeMode({ clear: false });
}

function clearConversationSelectionForExternalView(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const activeConversationId = String(currentConversationId || '').trim();

    if (activeConversationId || opts.detachStream === true) {
        detachCurrentVisibleStreamForNavigation('');
    }

    currentConversationId = null;
    syncBrowserCurrentConversation();
    syncGenerationStateForCurrentConversation();
    syncNotesForConversation(null);
    resetConversationListRenderSignature();
    renderConversationList(conversationListCache);
    resetComposerConversationContextUsage();

    if (opts.resetKnowledgeView === true) {
        resetKnowledgeViewRuntimeState();
    }

    return {
        activeConversationId,
    };
}

function installNexoraChatBridge() {
    window.NexoraChat = {
        get currentConversationId() {
            return currentConversationId;
        },

        set currentConversationId(value) {
            currentConversationId = value ? String(value).trim() : null;
        },

        get currentUsername() {
            return currentUsername;
        },

        get elements() {
            return els;
        },

        get messagesContainer() {
            return els.messagesContainer;
        },

        get messageInput() {
            return els.messageInput;
        },

        getElement(name) {
            return els[String(name || '').trim()] || null;
        },

        setElement(name, element) {
            const key = String(name || '').trim();

            if (!key) {
                throw new Error('NexoraChat.setElement 需要明确的元素名称');
            }

            els[key] = element || null;
            return els[key];
        },

        clearConversationSelection: clearConversationSelectionForExternalView,
        closePrimaryPanelsForExternalView,
        ensureExternalViewerBaseHeaderState,
        resetKnowledgeViewRuntimeState,
        resetComposerConversationContextUsage,
        resizeMessageInput,
        loadModels,
        closeAllSelects,
        createNewConversation,
        loadConversation,
        sendMessage,
        showToast,
        loadKnowledge,
        openKnowledgeAtChunk,
        renderMarkdownWithNewTabLinks,
        bindSourceMarkdown,
        renderMathSafe,
        placeInteractiveCardsBelowToolChain,

        openFilesFrameView(options = {}) {
            return window.openFilesFrameView(options);
        },
    };
}

installNexoraChatBridge();

function parseCssPx(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getMessageInputCollapsedHeight(input = null) {
    const target = input || els.messageInput;
    if (!target) return 0;
    const styles = window.getComputedStyle ? window.getComputedStyle(target) : null;
    if (!styles) return 0;

    const fontSize = parseCssPx(styles.fontSize, 15);
    const lineHeight = parseCssPx(styles.lineHeight, fontSize * 1.45);
    const rows = Math.max(1, Number.parseInt(target.getAttribute('rows') || '1', 10) || 1);
    const padding = parseCssPx(styles.paddingTop) + parseCssPx(styles.paddingBottom);
    const border = parseCssPx(styles.borderTopWidth) + parseCssPx(styles.borderBottomWidth);
    const cssMinHeight = parseCssPx(styles.minHeight);
    const naturalMinHeight = Math.ceil((lineHeight * rows) + padding + border);

    return Math.max(naturalMinHeight, cssMinHeight);
}

function resizeMessageInput(input = null) {
    const target = input || els.messageInput;
    if (!target) return;

    const styles = window.getComputedStyle ? window.getComputedStyle(target) : null;
    const minHeight = getMessageInputCollapsedHeight(target);
    const maxHeight = styles ? parseCssPx(styles.maxHeight, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

    target.style.height = 'auto';
    const wantedHeight = Math.max(minHeight, Number(target.scrollHeight || 0));
    const nextHeight = Math.min(wantedHeight, maxHeight);
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = wantedHeight > maxHeight ? 'auto' : 'hidden';
}

let generatedImageSizeObserver = null;

function syncGeneratedImageViewportLimit() {
    const container = els.messagesContainer || document.getElementById('messagesContainer');

    if (!container) {
        return;
    }

    const height = Math.max(160, Math.floor(Number(container.clientHeight || 0) * 0.8));
    container.style.setProperty('--generated-image-max-height', `${height}px`);
}

function bindGeneratedImageViewportLimit() {
    const container = els.messagesContainer || document.getElementById('messagesContainer');

    if (!container || container.dataset.generatedImageLimitBound === '1') {
        return;
    }

    container.dataset.generatedImageLimitBound = '1';
    syncGeneratedImageViewportLimit();
    window.addEventListener('resize', syncGeneratedImageViewportLimit, { passive: true });

    if (typeof ResizeObserver === 'function') {
        generatedImageSizeObserver = new ResizeObserver(() => syncGeneratedImageViewportLimit());
        generatedImageSizeObserver.observe(container);
    }
}

function ensureLearningFeedComposerControls() {
    if (!els.sendBtn || !els.sendBtn.parentElement) return null;
    if (learningFeedCancelBtn && learningFeedCancelBtn.isConnected) return learningFeedCancelBtn;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'learningFeedCancelBtn';
    btn.className = 'btn-send btn-send-cancel learning-feed-cancel-btn';
    btn.title = '退出动态发布';
    btn.setAttribute('aria-label', '退出动态发布');
    btn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
    btn.addEventListener('click', () => {
        exitLearningFeedComposeMode();
    });
    els.sendBtn.parentElement.insertBefore(btn, els.sendBtn);
    learningFeedCancelBtn = btn;
    return btn;
}

function syncLearningFeedComposerUi() {
    const inputWrapper = document.getElementById('inputWrapper');
    const inputContainer = inputWrapper ? inputWrapper.querySelector('.input-container') : null;
    const inputOptions = inputWrapper ? inputWrapper.querySelector('.input-options') : null;
    const tokenFooterLeft = inputWrapper ? inputWrapper.querySelector('.token-footer-left') : null;
    const cancelBtn = ensureLearningFeedComposerControls();
    if (inputWrapper) inputWrapper.classList.toggle('learning-feed-compose-mode', !!learningFeedComposeMode);
    if (inputContainer) inputContainer.classList.toggle('learning-feed-compose-mode', !!learningFeedComposeMode);
    if (inputOptions) inputOptions.classList.toggle('is-hidden-for-feed', !!learningFeedComposeMode);
    if (tokenFooterLeft) tokenFooterLeft.classList.toggle('is-hidden-for-feed', !!learningFeedComposeMode);
    if (cancelBtn) {
        cancelBtn.style.display = learningFeedComposeMode ? '' : 'none';
        cancelBtn.disabled = !!learningFeedPostInFlight;
    }
    if (els.messageInput) {
        els.messageInput.placeholder = learningFeedComposeMode ? '写一条学习动态...' : 'Type a message...';
    }
    if (!learningFeedComposeMode) {
        resetLearningFeedMentionState();
    } else {
        renderLearningFeedMentionMenu();
    }
}

function enterLearningFeedComposeMode() {
    learningFeedComposeMode = true;
    syncLearningFeedComposerUi();
    updateSendButtonState();
    if (els.messageInput) {
        els.messageInput.focus();
    }
}

function exitLearningFeedComposeMode(options = {}) {
    const shouldClear = !options || options.clear !== false;
    learningFeedComposeMode = false;
    learningFeedPostInFlight = false;
    if (shouldClear && els.messageInput) {
        els.messageInput.value = '';
        resizeMessageInput();
        saveMessageDraftToStorage('');
    }
    resetLearningFeedMentionState();
    syncLearningFeedComposerUi();
    updateSendButtonState();
}

async function submitLearningFeedPost(text) {
    const content = String(text || '').trim();
    if (!content || learningFeedPostInFlight) return;
    learningFeedPostInFlight = true;
    syncLearningFeedComposerUi();
    updateSendButtonState();
    try {
        const api = await ensureLearningModeAssets();
        if (!api || typeof api.postFeedViaIframe !== 'function') {
            throw new Error('Learning 动态发布桥未就绪。');
        }
        await api.postFeedViaIframe(content);
        showToast('动态已发布');
        exitLearningFeedComposeMode();
    } catch (err) {
        learningFeedPostInFlight = false;
        syncLearningFeedComposerUi();
        updateSendButtonState();
        showToast(`发布动态失败：${String((err && err.message) || err || '未知错误')}`);
    }
}

function normalizeAssetHref(href) {
    try {
        return new URL(String(href || ''), window.location.href).href;
    } catch (_err) {
        return String(href || '');
    }
}

function ensureStylesheetAsset(id, href) {
    let link = document.getElementById(id);
    const expectedHref = normalizeAssetHref(href);
    if (link) {
        const currentHref = normalizeAssetHref(link.getAttribute('href') || link.href || '');
        if (currentHref === expectedHref) return Promise.resolve(link);
        link.href = href;
        return new Promise((resolve, reject) => {
            link.addEventListener('load', () => resolve(link), { once: true });
            link.addEventListener('error', () => reject(new Error(`failed to load stylesheet: ${href}`)), { once: true });
        });
    }
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return new Promise((resolve, reject) => {
        link.addEventListener('load', () => resolve(link), { once: true });
        link.addEventListener('error', () => reject(new Error(`failed to load stylesheet: ${href}`)), { once: true });
    });
}

function ensureScriptAsset(id, src) {
    const existing = document.getElementById(id);
    if (existing) {
        if (existing.dataset.loaded === '1') return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', () => resolve(existing), { once: true });
            existing.addEventListener('error', () => reject(new Error(`failed to load script: ${src}`)), { once: true });
        });
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
    return new Promise((resolve, reject) => {
        script.addEventListener('load', () => {
            script.dataset.loaded = '1';
            resolve(script);
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`failed to load script: ${src}`)), { once: true });
    });
}

async function ensureLearningModeAssets() {
    if (learningModeAssetsPromise) return learningModeAssetsPromise;
    learningModeAssetsPromise = Promise.all([
        ensureStylesheetAsset('nexoraLearningModeCss', NEXORA_LEARNING_CSS_URL),
        ensureScriptAsset('nexoraLearningModeJs', NEXORA_LEARNING_JS_URL),
    ]).then(() => window.NexoraLearningMode || null);
    return learningModeAssetsPromise;
}

function registerLearningModeChatBridge() {
    const api = window.NexoraLearningMode;
    if (!api || typeof api.registerChatBridge !== 'function') return;
    const chatBridge = window.NexoraChat;

    if (!chatBridge) {
        throw new Error('NexoraChat bridge 未初始化，无法注册 NexoraLearningMode');
    }

    api.registerChatBridge({
        sendMessage: chatBridge.sendMessage,
        getCachedPuzzleStates: () => cachedPuzzleStates,
        ensureLearningModeAssets,
        placeInteractiveCardsBelowToolChain: chatBridge.placeInteractiveCardsBelowToolChain,
        learningInteractionLocks,
        getLearningInteractionLockKey,
        renderMarkdownWithNewTabLinks: chatBridge.renderMarkdownWithNewTabLinks,
        bindSourceMarkdown: chatBridge.bindSourceMarkdown,
        renderMathSafe: chatBridge.renderMathSafe,
        get currentConversationId() { return chatBridge.currentConversationId; },
        get messagesContainer() { return chatBridge.messagesContainer; },
        get messageInput() { return chatBridge.messageInput; },
        get frontendUrl() { return NEXORA_LEARNING_FRONTEND_URL; },
        get username() { return currentUsername; },
    });
}

function shouldForceLearningSidebarMode() {
    return !!(learningModeEnabled && isLearningReaderHostActive());
}

function resolveLearningSidebarModeForConversation(modeHint = null) {
    if (shouldForceLearningSidebarMode()) return 'learning';
    if (!learningModeEnabled) return 'nexora';
    if (String(modeHint || '').trim().toLowerCase() === 'learning') return 'learning';
    return 'nexora';
}

function isLearningWorkspaceActive() {
    return !!(learningModeEnabled && String(learningSidebarMode || '').trim().toLowerCase() === 'learning');
}

function normalizeLearningSidebarView(view) {
    return String(view || '').trim().toLowerCase() === 'conversation' ? 'conversation' : 'list';
}

function getLearningSidebarView() {
    return learningNavigationState.getSidebarView();
}

function setLearningSidebarView(view) {
    return learningNavigationState.setSidebarView(normalizeLearningSidebarView(view));
}

function captureLearningSidebarListScrollPosition() {
    if (!els.learningSidebarPanel || getLearningSidebarView() !== 'list') {
        return learningNavigationState.getLearningListScroll();
    }

    return learningNavigationState.captureLearningListScroll(els.learningSidebarPanel.scrollTop);
}

function enterLearningSidebarConversationView() {
    captureLearningSidebarListScrollPosition();
    const nextView = setLearningSidebarView('conversation');

    if (learningSidebarMode === 'learning') {
        syncLearningSidebarNavigationVisibility(true);
    }

    return nextView;
}

function restoreLearningSidebarListScrollPosition() {
    queueLearningSidebarListScrollRestore(learningNavigationState.getLearningListScroll());
}

// 返回列表是一次明确导航，不能继续保留“下次重进最后会话”的意图。
function returnToLearningConversationList() {
    learningNavigationState.clearRememberedConversation('learning');
    setLearningSidebarView('list');
    applyLearningSidebarMode('learning');
    restoreLearningSidebarListScrollPosition();
    logLearningNavigationTransition('return-to-list');
}

function rememberSidebarConversationSelection(mode, conversationId) {
    learningNavigationState.rememberConversation(mode, conversationId);
}

// Learning Sidebar 的返回视图只能由 Learning 会话加载修改，Nexora 加载不得跨域覆盖。
function syncLearningSidebarViewForLoadedConversation(scope) {
    if (String(scope || '').trim().toLowerCase() !== 'learning') {
        return getLearningSidebarView();
    }

    return enterLearningSidebarConversationView();
}

function resolveConversationSidebarScope(conversation) {
    return learningModeEnabled && getNexoraChatConversations().isLearningConversation(conversation)
        ? 'learning'
        : 'nexora';
}

function findCachedConversationById(conversationId) {
    const normalizedId = String(conversationId || '').trim();

    if (!normalizedId || !Array.isArray(conversationListCache)) return null;

    return conversationListCache.find((item) => {
        const source = item && typeof item === 'object' ? item : {};
        return String(source.conversation_id || source.id || '').trim() === normalizedId;
    }) || null;
}

function isNexoraConversationSelection(conversationId) {
    const conversation = findCachedConversationById(conversationId);
    return !!conversation && !getNexoraChatConversations().isLearningConversation(conversation);
}

function isLearningConversationSelection(conversationId) {
    const conversation = findCachedConversationById(conversationId);
    return !!conversation && getNexoraChatConversations().isLearningConversation(conversation);
}

function isLearningReaderHostActive() {
    return learningNavigationState.isReaderHostActive();
}

function logLearningNavigationTransition(action, details = {}) {
    console.info('[LearningNavigation]', String(action || '').trim(), {
        sidebarMode: String(learningSidebarMode || ''),
        sidebarView: getLearningSidebarView(),
        conversationId: String(currentConversationId || ''),
        conversationScope: String(currentConversationSidebarScope || ''),
        readerOpened: learningNavigationState.isReaderOpened(),
        readerSuspended: learningNavigationState.isReaderSuspended(),
        listScrollTop: learningNavigationState.getLearningListScroll(),
        ...details,
    });
}

function suspendLearningReaderForNexora() {
    const suspended = learningNavigationState.suspendReader();

    if (suspended) {
        logLearningNavigationTransition('suspend-reader');
    }

    return suspended;
}

function resumeLearningReaderForSidebar() {
    const resumed = learningNavigationState.resumeReader();

    if (resumed) {
        logLearningNavigationTransition('resume-reader');
    }

    return resumed;
}

function prepareLearningReaderForConversationNavigation(conversationId) {
    if (!learningNavigationState.isReaderOpened()) return;

    if (isLearningConversationSelection(conversationId)) {
        resumeLearningReaderForSidebar();
        return;
    }

    suspendLearningReaderForNexora();
}

function syncLearningReaderForConversationScope(scope) {
    if (!learningNavigationState.isReaderOpened()) return;

    if (String(scope || '').trim().toLowerCase() === 'learning') {
        resumeLearningReaderForSidebar();
        return;
    }

    suspendLearningReaderForNexora();
}

function replaceConversationHistory(conversationId = '') {
    if (!window.history.replaceState) return;

    const normalizedId = String(conversationId || '').trim();
    const url = normalizedId ? `/chat?cid=${encodeURIComponent(normalizedId)}` : '/chat';
    window.history.replaceState({}, '', url);
}

function queueLearningSidebarListScrollRestore(scrollTop) {
    const targetScrollTop = Math.max(0, Number(scrollTop || 0));

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!els.learningSidebarPanel || getLearningSidebarView() !== 'list') return;
            els.learningSidebarPanel.scrollTop = targetScrollTop;
        });
    });
}

async function switchToNexoraSidebar() {
    captureLearningSidebarListScrollPosition();
    suspendLearningReaderForNexora();
    learningHeaderMode = 'chat';

    const leavingLearningConversation = currentConversationSidebarScope === 'learning';

    if (!leavingLearningConversation) {
        applyLearningSidebarMode('nexora');
        await syncLearningHeaderMode();
        return;
    }

    const rememberedNexoraConversationId = learningNavigationState.getRememberedConversation('nexora');
    const restoreConversationId = isNexoraConversationSelection(rememberedNexoraConversationId)
        ? rememberedNexoraConversationId
        : '';

    if (!restoreConversationId) {
        learningNavigationState.clearRememberedConversation('nexora');
    }

    // 两套 sidebar 不共享当前 cid：先解除 Learning 会话，再恢复 Nexora 原选择。
    await createNewConversation(false, 'chat', { pushHistory: false });
    replaceConversationHistory();

    if (!restoreConversationId) {
        return;
    }

    await loadConversation(restoreConversationId, { pushHistory: false });

    if (String(currentConversationId || '').trim() === restoreConversationId
        && currentConversationSidebarScope === 'nexora') {
        replaceConversationHistory(restoreConversationId);
    }
}

function activateLearningSidebarView(view) {
    const normalizedView = String(view || '').trim().toLowerCase() === 'conversation'
        ? 'conversation'
        : 'list';

    setLearningSidebarView(normalizedView);
    learningHeaderMode = 'learning';
    applyLearningSidebarMode('learning');

    return normalizedView;
}

// Learning 会话 → Learning 主页：先同步接管侧栏，再异步解除当前会话占用。
// "重点 Learning tab（无恢复会话）"与"侧栏功能区入口"共用同一返回序列。
async function returnToLearningHomeView() {
    activateLearningSidebarView('list');
    await conversationNavigationController.createNewConversation(false, 'learning', { pushHistory: false });
    replaceConversationHistory();
    await syncLearningHeaderMode();
}

async function switchToLearningSidebar() {
    const courseWorkspace = window.NexoraLearningCourseWorkspace;
    let workspaceRestoreState = null;

    // Learning 点击必须无条件请求课程控制器退出，不能用 isActive/isAvailable 作为门。
    // 两个状态来自 iframe 消息，可能落后于已经呈现的 Workspace DOM。
    if (courseWorkspace && typeof courseWorkspace.exitToLearning === 'function') {
        const exitResult = courseWorkspace.exitToLearning();
        const normalizedExitResult = exitResult && typeof exitResult === 'object' ? exitResult : {};
        workspaceRestoreState = normalizedExitResult.restoreState || null;
    } else {
        console.error('[LearningNavigation] course workspace controller is unavailable');
    }

    closeKnowledgeViewBeforeLearningSwitch();
    resumeLearningReaderForSidebar();

    if (workspaceRestoreState) {
        const restoreView = String(workspaceRestoreState.view || '').trim().toLowerCase() === 'conversation'
            ? 'conversation'
            : 'list';
        const restoreConversationId = String(workspaceRestoreState.conversationId || '').trim();

        if (restoreView === 'list') {
            learningNavigationState.clearRememberedConversation('learning');

            // 先同步接管侧栏（与 conversation 分支一致），避免 createNewConversation
            // 让出控制权期间侧栏停留在课程 Workspace 或出现空窗。
            activateLearningSidebarView('list');

            if (currentConversationSidebarScope !== 'learning') {
                await conversationNavigationController.createNewConversation(false, 'learning', { pushHistory: false });
                replaceConversationHistory();
            }

            await syncLearningHeaderMode();
            learningNavigationState.captureLearningListScroll(workspaceRestoreState.scrollTop);
            queueLearningSidebarListScrollRestore(workspaceRestoreState.scrollTop);
            return;
        }

        if (isLearningConversationSelection(restoreConversationId)) {
            // 先同步切换侧栏：loadConversation 的侧栏切换在 fetch 之后且会被多道门短路，
            // Workspace 面板已经同步清空，若不立即接管侧栏会出现首次点击无内容、需点第二次的窗口。
            activateLearningSidebarView('conversation');

            if (String(currentConversationId || '').trim() !== restoreConversationId
                || currentConversationSidebarScope !== 'learning') {
                await loadConversation(restoreConversationId, { pushHistory: false });
                replaceConversationHistory(restoreConversationId);
            } else {
                await syncLearningHeaderMode();
            }

            return;
        }

        learningNavigationState.clearRememberedConversation('learning');
        activateLearningSidebarView('list');
        await syncLearningHeaderMode();
        learningNavigationState.captureLearningListScroll(workspaceRestoreState.scrollTop);
        queueLearningSidebarListScrollRestore(workspaceRestoreState.scrollTop);
        return;
    }

    if (currentConversationSidebarScope === 'learning') {
        activateLearningSidebarView(getLearningSidebarView());
        await syncLearningHeaderMode();

        if (getLearningSidebarView() === 'list') {
            restoreLearningSidebarListScrollPosition();
        }

        return;
    }

    rememberSidebarConversationSelection('nexora', currentConversationId);

    const rememberedLearningConversationId = learningNavigationState.getRememberedConversation('learning');
    const shouldRestoreConversation = getLearningSidebarView() === 'conversation';
    const restoreConversationId = shouldRestoreConversation
        && isLearningConversationSelection(rememberedLearningConversationId)
        ? rememberedLearningConversationId
        : '';

    if (!restoreConversationId) {
        learningNavigationState.clearRememberedConversation('learning');
        // 仅清理 conversation 上下文，保留 NexoraLearning iframe 当前课程详情。
        await returnToLearningHomeView();
        restoreLearningSidebarListScrollPosition();
        return;
    }

    activateLearningSidebarView('conversation');
    await loadConversation(restoreConversationId, { pushHistory: false });

    if (String(currentConversationId || '').trim() === restoreConversationId
        && currentConversationSidebarScope === 'learning') {
        replaceConversationHistory(restoreConversationId);
    }
}

async function startNewLearningConversation() {
    learningNavigationState.clearRememberedConversation('learning');
    enterLearningSidebarConversationView();

    // New Learning 只重置 Learning conversation，不触碰当前课程主页和 Workspace 上下文。
    await conversationNavigationController.createNewConversation(false, 'learning');
}

// 画像中心快速评估：新建 Learning 会话并发送开场指令，模型随后用 question 选项卡逐维提问。
async function startLearningProfileInterview(text, display) {
    learningNavigationState.clearRememberedConversation('learning');
    enterLearningSidebarConversationView();
    await conversationNavigationController.createNewConversation(false, 'learning');
    await sendMessage({
        textOverride: text,
        displayContentOverride: display || text
    });
}

function updateLearningSidebarPrimaryAction() {
    if (!els || !els.newChatBtn) return;

    const inLearningConversation = learningSidebarMode === 'learning'
        && getLearningSidebarView() === 'conversation';

    els.newChatBtn.innerHTML = inLearningConversation
        ? '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回上一级</span>'
        : (learningSidebarMode === 'learning'
            ? '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>New Learning</span>'
            : '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>New Chat</span>');
    els.newChatBtn.dataset.learningPrimaryAction = inLearningConversation ? 'back' : 'new';
}

// Learning 模式四个功能区入口与 Nexora 的 Workspaces/Files 对位：
// learning 态显示、nexora 态隐藏；隐藏时同步清除激活态，避免再进入时残留旧高亮。
function setLearningNavButtonsVisible(visible) {
    const navEntries = [
        { container: els.learningProgressBtn, button: els.learningProgressBtn },
        { container: els.learningCoursesBtn, button: els.learningCoursesBtn },
        { container: els.learningResourcesGroup, button: els.learningResourcesBtn },
        { container: els.learningPracticeGroup, button: els.learningPracticeBtn },
        { container: els.learningProfileBtn, button: els.learningProfileBtn },
        { container: els.learningFeedBtn, button: els.learningFeedBtn },
    ];

    navEntries.forEach((entry) => {
        const container = entry.container;
        const button = entry.button;

        if (!container || !button) return;

        container.hidden = !visible;
        container.style.display = visible ? '' : 'none';

        if (!visible) {
            button.classList.remove('is-active');
            button.setAttribute('aria-pressed', 'false');
        }
    });

    if (!visible) {
        setLearningResourceStudioMenuOpen(false);
        setLearningPracticeMenuOpen(false);
    }
}

/**
 * Learning 下拉导航始终在 sidebar 正常文档流中展开。
 */
function setLearningSidebarMenuOpen(elements, open, label) {
    const expanded = !!open;
    const group = elements.group;
    const menu = elements.menu;
    const toggle = elements.toggle;
    const main = elements.main;

    if (!group || !menu || !toggle || !main) return;

    group.classList.toggle('is-collapsed', !expanded);
    menu.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${label}`);
    toggle.setAttribute('title', `${expanded ? '收起' : '展开'}${label}`);
    main.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function setLearningResourceStudioMenuOpen(open) {
    setLearningSidebarMenuOpen({
        group: els.learningResourcesGroup,
        menu: els.learningResourcesStudioMenu,
        toggle: els.learningResourcesToggleBtn,
        main: els.learningResourcesBtn,
    }, open, '学习资源工作台');
}

function setLearningPracticeMenuOpen(open) {
    setLearningSidebarMenuOpen({
        group: els.learningPracticeGroup,
        menu: els.learningPracticeMenu,
        toggle: els.learningPracticeToggleBtn,
        main: els.learningPracticeBtn,
    }, open, '模拟练习');
}

// 宿主侧栏功能区按钮可见时，iframe 自身顶部 kicker tab 由宿主接管（桌面嵌入）；
// 不可见（nexora 态 / 移动端 overlay）时 iframe 保留自己的 tab。
function syncLearningDashboardNavLayout(visible) {
    const api = window.NexoraLearningMode;
    if (!api || typeof api.syncDashboardNavLayout !== 'function') return;

    api.syncDashboardNavLayout(visible);
}

/**
 * Learning 功能入口只属于列表主页。进入侧栏会话后必须整体隐藏，
 * 避免课程导航与当前会话操作同时争夺侧栏顶部空间。
 */
function syncLearningSidebarNavigationVisibility(learningVisible) {
    const navVisible = !!learningVisible && getLearningSidebarView() === 'list';

    setLearningNavButtonsVisible(navVisible);
    syncLearningDashboardNavLayout(navVisible);
}

// 侧栏功能区入口（课程进度/学习资源/模拟练习/动态中心）：
// 主面板是 NexoraLearning iframe 的 dashboard，会话还开着时先解除会话占用
// 回到 Learning 主页（主面板切回 iframe），再通知 iframe 切换功能区。
async function openLearningDashboardSurface(tab) {
    if (String(learningSidebarMode || '').trim().toLowerCase() === 'learning'
        && String(currentConversationId || '').trim()) {
        rememberSidebarConversationSelection('learning', currentConversationId);
        await returnToLearningHomeView();
    }

    const api = window.NexoraLearningMode;
    if (!api || typeof api.openDashboardTab !== 'function') return;

    api.openDashboardTab(tab);
}

/**
 * 从学习资源条目的下拉菜单打开独立工作台；若正在 Learning 对话，先恢复主页 iframe。
 */
async function openLearningStudioSurface(studio) {
    const normalizedStudio = String(studio || '').trim().toLowerCase();

    if (!['resource', 'video'].includes(normalizedStudio)) return;

    if (String(learningSidebarMode || '').trim().toLowerCase() === 'learning'
        && String(currentConversationId || '').trim()) {
        rememberSidebarConversationSelection('learning', currentConversationId);
        await returnToLearningHomeView();
    }

    const api = window.NexoraLearningMode;

    if (!api || typeof api.openLearningStudio !== 'function') return;

    api.openLearningStudio(normalizedStudio);
}

// 学习模式偏好异步加载完成后，按当前会话状态恢复侧栏，避免覆盖 cid 导航结果。
// 会话状态必须优先于 suppressAutoLearningOpen：URL 指向 Learning 会话时，cid 导航
// 已经把侧栏切到 learning，此处若先因 suppress 回落 nexora，会把下划线与侧栏列表
// 整体打回 nexora，而主面板仍停留在 Learning 内容（切换到了 learning、下划线却在 nexora）。
function resolveLearningSidebarModeAfterPreferenceLoad(options = {}) {
    if (!learningModeEnabled) return 'nexora';

    const hasConversation = !!String(currentConversationId || '').trim();

    if (hasConversation) {
        return resolveLearningSidebarModeForConversation(currentConversationMode);
    }

    if (options && options.suppressAutoLearningOpen) {
        return 'nexora';
    }

    return resolveDefaultOpenView();
}

function syncLearningWorkspaceLayout() {
    return window.NexoraLearningWorkspaceLayout.sync({
        enabled: learningModeEnabled,
        sidebarMode: learningSidebarMode,
        readerOpened: isLearningReaderHostActive(),
        layoutMode: learningEmbedLayoutMode,
        sidebarView: getLearningSidebarView(),
        elements: {
            sidebar: els.sidebar,
            mainContent: els.mainContent,
            inputDock: els.inputDock,
            learningSidebarPanel: els.learningSidebarPanel,
            learningMainPanel: els.learningMainPanel,
        },
    });
}

function closeLearningCourseWorkspaceForReader() {
    const workspaceApi = window.NexoraLearningCourseWorkspace;
    if (!workspaceApi || typeof workspaceApi.close !== 'function') return;

    // Reader 是独立的沉浸学习主视图，打开时必须退出课程 Workspace，避免侧栏出现双选和分层。
    workspaceApi.close();
}

function normalizeLearningReaderHostTarget(target) {
    return String(target || '').trim().toLowerCase() === 'learning' ? 'learning' : 'nexora';
}

function syncSidebarBrandLearningState(active) {
    const pendingState = window.__nexoraSidebarBrandPendingState;
    const nextState = {
        enabled: learningModeEnabled,
        active: !!active,
    };
    const pending = pendingState && typeof pendingState === 'object' ? pendingState : {};
    pending.learning = nextState;
    window.__nexoraSidebarBrandPendingState = pending;

    // chat.js 是 Learning 主视图切换的最终执行点。控制器尚未加载时仍要同步可见选中态。
    const tabs = document.getElementById('sidebarBrandTabs');
    if (tabs) {
        tabs.dataset.sidebarBrandMode = active ? 'learning' : 'nexora';
    }

    const brandNavigation = window.NexoraSidebarBrand;
    if (!brandNavigation || typeof brandNavigation.setLearningState !== 'function') return;

    brandNavigation.setLearningState(nextState);
}

function applyLearningSidebarMode(mode) {
    const normalized = (learningModeEnabled && String(mode || 'nexora').trim().toLowerCase() === 'learning') ? 'learning' : 'nexora';
    learningSidebarMode = normalized;
    const visible = normalized === 'learning';

    if (!visible && !String(currentConversationId || '').trim() && currentConversationMode === 'learning') {
        currentConversationMode = 'chat';
        learningHeaderMode = 'chat';
        learningWelcomeMounted = false;
    }
    const renderSidebarPanel = () => {
        if (!visible) return;
        if (!window.NexoraLearningMode || typeof window.NexoraLearningMode.renderSidebarPanel !== 'function') return;
        window.NexoraLearningMode.renderSidebarPanel(els.learningSidebarPanel, {
            username: currentUsername,
            role: currentUserRole,
            enabled: learningModeEnabled,
            sidebarMode: normalized,
            sidebarView: getLearningSidebarView(),
            conversationMode: currentConversationMode,
        });
    };
    syncSidebarBrandLearningState(visible);
    if (els.conversationList) {
        els.conversationList.style.display = visible ? 'none' : '';
    }
    if (els.newChatBtn) {
        els.newChatBtn.style.display = '';
        updateLearningSidebarPrimaryAction();
    }

    if (els.workspacesBtn) {
        els.workspacesBtn.hidden = visible;
        els.workspacesBtn.style.display = visible ? 'none' : '';
    }

    if (els.fileCenterBtn) {
        els.fileCenterBtn.hidden = visible;
        els.fileCenterBtn.style.display = visible ? 'none' : '';
    }

    syncLearningSidebarNavigationVisibility(visible);

    if (els.learningSidebarPanel) {
        els.learningSidebarPanel.style.display = visible ? '' : 'none';
        if (visible) {
            if (window.NexoraLearningMode && typeof window.NexoraLearningMode.renderSidebarPanel === 'function') {
                renderSidebarPanel();
            } else {
                els.learningSidebarPanel.innerHTML = '<div class="learning-mode-welcome-loading">正在载入 NexoraLearning...</div>';
                void ensureLearningModeAssets()
                    .then(() => {
                        if (learningSidebarMode !== 'learning') return;
                        renderSidebarPanel();
                    })
                    .catch((err) => {
                        console.error('加载学习侧栏资源失败:', err);
                    });
            }
        } else if (window.NexoraLearningMode && typeof window.NexoraLearningMode.destroySidebarPanel === 'function') {
            window.NexoraLearningMode.destroySidebarPanel();
        }
    }
    syncLearningWorkspaceLayout();
    _syncTurnIndicatorVisibility();
}

function shouldPreserveLearningReaderImmersiveLayout() {
    const mode = String(currentConversationMode || '').trim().toLowerCase();
    return !!(learningModeEnabled && isLearningReaderHostActive() && mode === 'learning');
}

function isLearningMainPanelRendered() {
    return !!(els.learningMainPanel && els.learningMainPanel.querySelector('.learning-mode-frame'));
}

function shouldPreserveLearningMainPanelForNewConversation(_resolvedMode) {
    // 对话上下文与 NexoraLearning iframe 生命周期彼此独立，Sidebar 切换只能隐藏已挂载 iframe。
    return !!(learningModeEnabled && isLearningMainPanelRendered());
}

function clearLearningWelcomeState(options = {}) {
    const force = !!(options && options.force);
    if (!force && shouldPreserveLearningReaderImmersiveLayout()) {
        return;
    }
    if (learningEmbedLayoutMode !== 'default') {
        setLearningEmbedLayoutMode('default');
    }
    const layoutState = syncLearningWorkspaceLayout();
    if (!layoutState.active && els.inputDock) {
        els.inputDock.classList.remove('learning-mode-hidden');
    }
}

// Learning iframe 只能在当前 Learning 视图内接管输入区布局，普通对话保持聊天输入区所有权。
function shouldHonorLearningHostLayoutRequest() {
    if (!learningModeEnabled) return false;

    if (isLearningReaderHostActive() || isLearningWorkspaceActive()) {
        return true;
    }

    const hasConversation = !!String(currentConversationId || '').trim();

    if (!hasConversation) {
        return String(learningHeaderMode || '').trim().toLowerCase() === 'learning';
    }

    return String(currentConversationMode || '').trim().toLowerCase() === 'learning';
}

function setLearningEmbedLayoutMode(mode, options = {}) {
    const normalized = String(mode || 'default').trim().toLowerCase() === 'immersive' ? 'immersive' : 'default';
    learningEmbedLayoutMode = normalized;
    const active = normalized === 'immersive';
    document.body.classList.toggle('learning-embed-immersive', active);
    if (els.mainContent) {
        els.mainContent.classList.toggle('learning-embed-immersive', active);
    }
    const layoutState = syncLearningWorkspaceLayout();
    if (els.inputDock) {
        if (layoutState.active) {
            els.inputDock.classList.add('learning-mode-hidden');
        } else if (active) {
            // immersive 模式下，inputDock 由 CSS body.learning-embed-immersive .input-dock 控制
            els.inputDock.classList.remove('learning-mode-hidden');
        } else if (options && options.hasOwnProperty('hideInputDock')) {
            const shouldHide = !!options.hideInputDock;
            els.inputDock.classList.toggle('learning-mode-hidden', shouldHide);
        } else {
            els.inputDock.classList.remove('learning-mode-hidden');
        }
    }
}

function handleLearningHostMessage(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (String(payload.source || '').trim().toLowerCase() !== 'nexora-learning') return false;
    const msgType = String(payload.type || '').trim().toLowerCase();
    if (msgType === 'nexora:chat-input:visibility') {
        if (!shouldHonorLearningHostLayoutRequest()) {
            if (els.inputDock) {
                els.inputDock.classList.remove('learning-mode-hidden');
            }
            return true;
        }

        const layoutState = syncLearningWorkspaceLayout();
        if (!layoutState.active && els.inputDock) {
            els.inputDock.classList.toggle('learning-mode-hidden', !!payload.hidden);
        }
        return true;
    }
    if (msgType === 'nexora:layout:request') {
        if (!shouldHonorLearningHostLayoutRequest()) {
            if (els.inputDock) {
                els.inputDock.classList.remove('learning-mode-hidden');
            }
            return true;
        }

        if (String(payload.mode || '').trim().toLowerCase() === 'immersive') {
            closeReaderBlockedRightSidebars();
        }
        setLearningEmbedLayoutMode(payload.mode, payload);
        return true;
    }
    if (msgType === 'nexora:inject-prompt') {
        const text = String(payload.text || '').trim();
        if (text && els.messageInput) {
            els.messageInput.value = text;
            els.messageInput.focus();
            els.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
    }
    if (msgType === 'nexora:send-message') {
        const text = String(payload.text || '').trim();
        if (text) {
            if (payload.interview) window.__nexoraInterviewPending = true;
            sendMessage({ textOverride: text, displayContentOverride: text });
        }
        return true;
    }
    if (msgType === 'nexora:profile-interview:start') {
        const text = String(payload.text || '').trim();
        const display = String(payload.display || '').trim();
        if (text) {
            void startLearningProfileInterview(text, display);
        }
        return true;
    }
    if (msgType === 'nexora:feed-compose:toggle') {
        if (payload.active) enterLearningFeedComposeMode();
        else exitLearningFeedComposeMode({ clear: false });
        return true;
    }
    if (msgType === 'nexora:reader:state') {
        if (payload.opened && !shouldHonorLearningHostLayoutRequest()) {
            if (els.inputDock) {
                els.inputDock.classList.remove('learning-mode-hidden');
            }
            return true;
        }

        const wasReaderOpened = learningNavigationState.isReaderOpened();
        const wasReaderSuspended = learningNavigationState.isReaderSuspended();
        learningNavigationState.setReaderOpened(!!payload.opened);

        if (learningNavigationState.isReaderOpened()) {
            if (learningNavigationState.isReaderSuspended()) {
                logLearningNavigationTransition('reader-opened-while-suspended');
                return true;
            }

            closeReaderBlockedRightSidebars();
            closeLearningCourseWorkspaceForReader();
            learningHeaderMode = 'learning';
            applyLearningSidebarMode('learning');
            void syncLearningHeaderMode();
            return true;
        }
        if (wasReaderOpened) {
            learningReaderContextSnapshot = null;

            if (wasReaderSuspended) {
                learningHeaderMode = 'chat';
                logLearningNavigationTransition('reader-closed-while-suspended');
                return true;
            }

            const closeReason = String(payload.close_reason || payload.reason || '').trim().toLowerCase();
            const closeTarget = String(payload.close_target || payload.target || '').trim().toLowerCase();
            const restoredSidebarMode = closeTarget
                ? normalizeLearningReaderHostTarget(closeTarget)
                : (closeReason.indexOf('host_') === 0 ? 'nexora' : 'learning');
            learningHeaderMode = restoredSidebarMode === 'learning' ? 'learning' : 'chat';
            applyLearningSidebarMode(restoredSidebarMode);
            void syncLearningHeaderMode();
        }
        return true;
    }
    if (msgType === 'nexora:reader:context') {
        learningReaderContextSnapshot = normalizeLearningReaderContextPayload(payload.context || payload);
        return true;
    }
    if (msgType === 'nexora:reader:selection-context-menu') {
        const text = normalizeSelectionTextForNotes(String(payload.text || payload.selection_text || ''));
        if (!text) {
            hideNotesContextMenu();
            return true;
        }
        const sourceMeta = buildLearningReaderSelectionSourceMeta(payload.source_meta, text, text);
        const xNum = Number(payload.x);
        const yNum = Number(payload.y);
        const safeX = Number.isFinite(xNum) ? xNum : Math.floor(window.innerWidth / 2);
        const safeY = Number.isFinite(yNum) ? yNum : Math.floor(window.innerHeight / 2);
        showNotesContextMenu(safeX, safeY, text, sourceMeta);
        return true;
    }
    if (msgType === 'nexora:reader:selection-context-menu-hide') {
        hideNotesContextMenu();
        return true;
    }
    if (msgType === 'nexora:reader:ask-annotation') {
        const askText = String(payload.text || '').trim();
        if (askText) {
            fillMessageInputWithExplainText(askText);
        }
        return true;
    }
    if (msgType === 'nexora:learning-frame:pointerdown') {
        collapseDesktopSidebarByOutsideInteraction();
        return true;
    }
    return false;
}

window.addEventListener('message', (event) => {
    const data = event && event.data;
    handleLearningHostMessage(data);
});

window.addEventListener('nexora:learning-puzzle-submit', (event) => {
    const payload = event && event.detail;
    void handlePuzzleIframeSubmit(payload);
});

window.addEventListener('nexora:chat-input:visibility', (event) => {
    const payload = event && event.detail;
    handleLearningHostMessage(payload);
});

window.addEventListener('nexora:layout:request', (event) => {
    const payload = event && event.detail;
    handleLearningHostMessage(payload);
});

async function ensureCurrentUsernameForLearning() {
    if (!String(currentUsername || '').trim()) {
        await checkUserRole();
    }

    const username = String(currentUsername || '').trim();

    if (!username) {
        throw new Error('NexoraLearning requires authenticated username before iframe render.');
    }

    return username;
}

async function renderLearningMainPanel() {
    if (!els.learningMainPanel) return false;
    try {
        const username = await ensureCurrentUsernameForLearning();
        const api = await ensureLearningModeAssets();
        if (learningMainMounted) return true;
        els.learningMainPanel.innerHTML = '<div class="learning-mode-welcome-loading">正在载入 NexoraLearning...</div>';
        if (api && typeof api.renderMainPanel === 'function') {
            api.renderMainPanel(els.learningMainPanel, {
                frontendUrl: NEXORA_LEARNING_FRONTEND_URL,
                username,
            });
            learningMainMounted = true;
            return true;
        } else if (api && typeof api.renderWelcome === 'function') {
            api.renderWelcome(els.learningMainPanel, {
                frontendUrl: NEXORA_LEARNING_FRONTEND_URL,
                username,
            });
            learningMainMounted = true;
            return true;
        }
    } catch (err) {
        console.error('加载学习主面板失败:', err);
        learningMainMounted = false;
        els.learningMainPanel.innerHTML = '';
        els.learningMainPanel.style.display = 'none';
    }

    return false;
}

async function syncLearningHeaderMode() {
    const hasConversation = !!String(currentConversationId || '').trim();
    const showLearning = isLearningConversationView();
    const knowledgeViewerOpen = isKnowledgeViewerOpen();
    const viewerOpen = knowledgeViewerOpen;
    const workspaceActive = isLearningWorkspaceActive();
    const showLearningMain = !!(
        learningModeEnabled
        && !viewerOpen
        && (
            workspaceActive
            ||
            (String(learningHeaderMode || '').trim().toLowerCase() === 'learning' && !hasConversation)
            || isLearningReaderHostActive()
        )
    );
    let showChatMain = !showLearningMain && !viewerOpen;

    if (!showLearningMain) {
        setLearningEmbedLayoutMode('default');
        if (els.inputDock) {
            els.inputDock.classList.remove('learning-mode-hidden');
        }
    } else {
        setLearningEmbedLayoutMode('immersive', { hideInputDock: true });
    }
    if (els.messagesContainer) {
        if (showLearningMain && !hasConversation) {
            const welcomeShell = els.messagesContainer.querySelector('.welcome-screen.learning-mode-welcome-shell');
            if (welcomeShell) {
                els.messagesContainer.innerHTML = '';
                learningWelcomeMounted = false;
            }
        }
        els.messagesContainer.style.display = showChatMain ? '' : 'none';
    }
    if (els.learningMainPanel) {
        if (showLearningMain) {
            els.learningMainPanel.style.display = 'none';
            const rendered = await renderLearningMainPanel();

            if (rendered) {
                els.learningMainPanel.style.display = '';
            } else {
                showChatMain = !viewerOpen;

                if (els.messagesContainer) {
                    els.messagesContainer.style.display = showChatMain ? '' : 'none';
                }

                if (showChatMain && !hasConversation) {
                    await renderWelcomeScreen();
                }
            }
        } else {
            els.learningMainPanel.style.display = 'none';
        }
    }
    if (showChatMain && !hasConversation && !showLearning) {
        await renderWelcomeScreen();
    }
    if (els.conversationTitle) {
        const effectiveShowLearning = isLearningConversationView();
        els.conversationTitle.textContent = hasConversation ? (els.conversationTitle.textContent || 'Untitled Conversation') : (effectiveShowLearning ? 'Learning' : 'Nexora');
    }
    if (!showLearningMain && els.messageInput && els.messageInput.value) {
        requestAnimationFrame(() => {
            resizeMessageInput();
        });
    }
}

async function renderWelcomeScreen() {
    if (!els.messagesContainer) return;
    // Hide turn indicator when no conversation
    const turnPanel = document.getElementById('turnIndicatorPanel');
    if (turnPanel) turnPanel.classList.remove('visible');
    if (
        learningModeEnabled
        && !String(currentConversationId || '').trim()
        && String(learningHeaderMode || '').trim().toLowerCase() === 'learning'
    ) {
        learningWelcomeMounted = false;
        els.messagesContainer.innerHTML = '';
        return;
    }
    if (!isLearningConversationView()) {
        clearLearningWelcomeState();
        learningWelcomeMounted = false;

        // NexoraCode 本地节点在线时，欢迎页替换为项目选择视图
        if (isNexoraCodeProjectSidebarEnabled()) {
            els.messagesContainer.innerHTML = `
                <div class="welcome-screen nexoracode-welcome">
                    <h1 class="nexoracode-welcome-heading">选择一个项目开始编码</h1>
                    <p class="nexoracode-welcome-sub">项目会话会自动注入目录结构与本地工具上下文；选择 None 则进行普通对话。</p>
                </div>
            `;
            renderNexoraCodeWelcomeProjectSelector(els.messagesContainer.querySelector('.welcome-screen'));
            return;
        }

        els.messagesContainer.innerHTML = `
            <div class="welcome-screen">
                <h1>Hello.</h1>
                <p>Start a new conversation.</p>
            </div>
        `;
        return;
    }
    try {
        const username = await ensureCurrentUsernameForLearning();
        const api = await ensureLearningModeAssets();
        let host = els.messagesContainer.querySelector('.welcome-screen.learning-mode-welcome-shell');
        if (!host) {
            els.messagesContainer.innerHTML = `
                <div class="welcome-screen learning-mode-welcome-shell">
                    <div class="learning-mode-welcome-loading">正在载入 NexoraLearning...</div>
                </div>
            `;
            host = els.messagesContainer.querySelector('.welcome-screen.learning-mode-welcome-shell');
        }
        if (!host || currentConversationId) return;
        if (learningWelcomeMounted) return;
        if (api && typeof api.renderWelcome === 'function') {
            api.renderWelcome(host, {
                frontendUrl: NEXORA_LEARNING_FRONTEND_URL,
                username,
            });
            learningWelcomeMounted = true;
        }
    } catch (err) {
        console.error('加载学习模式资源失败:', err);
        learningWelcomeMounted = false;
        currentConversationMode = 'chat';
        learningHeaderMode = 'chat';
        applyLearningSidebarMode('nexora');
        els.messagesContainer.innerHTML = `
            <div class="welcome-screen">
                <h1>Hello.</h1>
                <p>Start a new conversation.</p>
            </div>
        `;
    }
}

// 仅 NexoraCode 本地节点在线时，在欢迎页展示项目选择区
function renderNexoraCodeWelcomeProjectSelector(welcomeEl) {
    if (!welcomeEl || !isNexoraCodeProjectSidebarEnabled()) return;

    ensureNexoraCodeProjectsLoaded();

    const projects = getNexoraCodeProjects();
    const activeProject = getActiveNexoraCodeProject();

    const panel = document.createElement('div');
    panel.className = 'nexoracode-welcome-project';

    // 平铺卡片列表：无下拉浮层，点击即选中
    const list = document.createElement('div');
    list.className = 'nexoracode-welcome-project-list';

    const buildOption = ({ title, subtitle, icon, onClick, active, extraClass }) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `nexoracode-welcome-project-option${active ? ' is-active' : ''}${extraClass ? ` ${extraClass}` : ''}`;
        option.innerHTML = `
            <i class="fa-solid ${icon || 'fa-folder'} nexoracode-welcome-project-option-icon" aria-hidden="true"></i>
            <span class="nexoracode-welcome-project-option-main">
                <span class="nexoracode-welcome-project-option-title">${escapeHtml(title)}</span>
                ${subtitle ? `<span class="nexoracode-welcome-project-option-sub">${escapeHtml(subtitle)}</span>` : ''}
            </span>
            ${active ? '<i class="fa-solid fa-check nexoracode-welcome-project-option-check" aria-hidden="true"></i>' : ''}
        `;
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });
        return option;
    };

    // “添加新项目”固定第一位
    list.appendChild(buildOption({
        title: '添加新项目',
        subtitle: '浏览并选择本地文件夹',
        icon: 'fa-plus',
        active: false,
        extraClass: 'nexoracode-welcome-project-add',
        onClick: () => { void requestNexoraCodeProjectCreate(); }
    }));

    projects.forEach((project) => {
        list.appendChild(buildOption({
            title: project.name,
            subtitle: project.subtitle || project.path,
            icon: 'fa-folder',
            active: !!activeProject && activeProject.project_id === project.project_id,
            onClick: () => {
                setActiveNexoraCodeProject(project.project_id);
                renderWelcomeProjectSelectorUpdate();
            }
        }));
    });

    list.appendChild(buildOption({
        title: 'None',
        subtitle: '无项目上下文，普通对话',
        icon: 'fa-comment',
        active: !activeProject,
        onClick: () => {
            setActiveNexoraCodeProject('');
            renderWelcomeProjectSelectorUpdate();
        }
    }));

    panel.appendChild(list);
    welcomeEl.appendChild(panel);
}

function renderWelcomeProjectSelectorUpdate() {
    if (String(currentConversationId || '').trim()) return;
    const welcomeEl = els.messagesContainer
        ? els.messagesContainer.querySelector('.welcome-screen')
        : null;
    if (!welcomeEl) return;

    const existing = welcomeEl.querySelector('.nexoracode-welcome-project');
    if (existing) existing.remove();
    renderNexoraCodeWelcomeProjectSelector(welcomeEl);
}

async function applyLearningMode(enabled, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const suppressAutoLearningOpen = !!opts.suppressAutoLearningOpen;

    if (enabled && !learningRuntimeEnabled) {
        enabled = false;
    }

    learningModeEnabled = !!enabled;
    // 偏好已读取即可恢复全局入口；学习资源加载失败也不能让 Nexora 中的 Learning tab 消失。
    syncSidebarBrandLearningState(learningSidebarMode === 'learning');
    if (!learningModeEnabled) {
        learningNavigationState.setReaderOpened(false);
    }
    document.body.classList.toggle('learning-mode-enabled', learningModeEnabled);
    if (learningModeEnabled) {
        try {
            await ensureLearningModeAssets();
            registerLearningModeChatBridge();
        } catch (err) {
            console.error('预加载学习模式资源失败:', err);
        }
    } else {
        clearLearningWelcomeState();
    }
    learningSidebarMode = resolveLearningSidebarModeAfterPreferenceLoad({
        suppressAutoLearningOpen
    });
    if (!learningModeEnabled) {
        if (currentConversationMode === 'learning') currentConversationMode = 'chat';
        if (learningHeaderMode === 'learning') learningHeaderMode = 'chat';
    }
    if (learningModeEnabled && !String(currentConversationId || '').trim() && !suppressAutoLearningOpen) {
        // 默认打开视图同时决定左侧列表与右侧主面板，避免两套状态在初始化时分叉。
        setLearningSidebarView('list');
        currentConversationMode = 'chat';
        learningHeaderMode = learningSidebarMode === 'learning' ? 'learning' : 'chat';
    } else if (suppressAutoLearningOpen && !String(currentConversationId || '').trim()) {
        currentConversationMode = 'chat';
        learningHeaderMode = 'chat';
    }

    applyLearningSidebarMode(learningSidebarMode);
    await syncLearningHeaderMode();

    if (!currentConversationId && !isLearningWorkspaceActive()) {
        await renderWelcomeScreen();
    }
    _syncTurnIndicatorVisibility();
}

async function loadCurrentUserPreferences() {
    const prefsRes = await fetch('/api/user/preferences');
    const prefsData = await prefsRes.json();
    if (!prefsData.success) {
        throw new Error(prefsData.message || '获取偏好设置失败');
    }
    currentUserPreferences = (prefsData && typeof prefsData.preferences === 'object' && prefsData.preferences)
        ? prefsData.preferences
        : {};
    const learningRuntime = (prefsData && typeof prefsData.learning_runtime === 'object' && prefsData.learning_runtime)
        ? prefsData.learning_runtime
        : {};
    learningRuntimeEnabled = learningRuntime.enabled !== false;
    const frontendUrl = String(learningRuntime.frontend_url || '').trim();
    if (frontendUrl) {
        NEXORA_LEARNING_FRONTEND_URL = frontendUrl.endsWith('/') ? frontendUrl : `${frontendUrl}/`;
    }

    if (!learningRuntimeEnabled) {
        currentUserPreferences.learning_mode = false;
    }

    return currentUserPreferences;
}

function getLearningModeOffBtn() {
    return document.getElementById('set-learning-mode-off');
}

function getLearningModeOnBtn() {
    return document.getElementById('set-learning-mode-on');
}

function setLearningModeToggleUi(enabled) {
    if (!learningRuntimeEnabled) {
        enabled = false;
    }

    pendingLearningModeValue = !!enabled;
    const offBtn = getLearningModeOffBtn();
    const onBtn = getLearningModeOnBtn();
    if (offBtn) {
        offBtn.classList.toggle('active', !pendingLearningModeValue);
        offBtn.setAttribute('aria-pressed', !pendingLearningModeValue ? 'true' : 'false');
        offBtn.disabled = learningModePreferenceSaving;
    }
    if (onBtn) {
        onBtn.classList.toggle('active', pendingLearningModeValue);
        onBtn.setAttribute('aria-pressed', pendingLearningModeValue ? 'true' : 'false');
        onBtn.disabled = learningModePreferenceSaving || !learningRuntimeEnabled;
    }
}

async function saveLearningModePreference(enabled) {
    const nextEnabled = !!enabled;

    if (nextEnabled && !learningRuntimeEnabled) {
        setLearningModeToggleUi(false);
        showToast('NexoraLearning 未启用');
        return;
    }

    if (learningModePreferenceSaving) {
        return;
    }

    const previousEnabled = !!(currentUserPreferences && currentUserPreferences.learning_mode);
    learningModePreferenceSaving = true;
    setLearningModeToggleUi(nextEnabled);

    try {
        const res = await fetch('/api/user/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ learning_mode: nextEnabled }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }

        currentUserPreferences = data.preferences || currentUserPreferences || {};
        setLearningModeToggleUi(!!currentUserPreferences.learning_mode);
        await applyLearningMode(!!currentUserPreferences.learning_mode);

        if (!(nextEnabled && !learningModeEnabled)) {
            showToast(nextEnabled ? '学习模式已开启' : '学习模式已关闭');
        }
    } catch (err) {
        console.error('保存学习模式失败:', err);
        setLearningModeToggleUi(previousEnabled);
        showToast(`保存学习模式失败: ${String((err && err.message) || 'unknown')}`);
    } finally {
        learningModePreferenceSaving = false;
        setLearningModeToggleUi(!!(currentUserPreferences && currentUserPreferences.learning_mode));
    }
}

function getDefaultOpenViewNexoraBtn() {
    return document.getElementById('set-default-open-nexora');
}

function getDefaultOpenViewLearningBtn() {
    return document.getElementById('set-default-open-learning');
}

function getDefaultOpenViewCard() {
    return document.getElementById('defaultOpenViewCard');
}

// 解析"默认打开"偏好值，非法值回落到 learning（与后端默认一致）
function resolveDefaultOpenView() {
    const view = String((currentUserPreferences && currentUserPreferences.default_open_view) || '').trim().toLowerCase();
    return view === 'nexora' ? 'nexora' : 'learning';
}

// 同步"默认打开"开关 UI；卡片仅在 NexoraLearning 功能启用时显示
function setDefaultOpenViewToggleUi(value) {
    const card = getDefaultOpenViewCard();
    if (card) {
        card.style.display = learningRuntimeEnabled ? '' : 'none';
    }

    const safeValue = value === 'nexora' ? 'nexora' : 'learning';
    const nexoraBtn = getDefaultOpenViewNexoraBtn();
    const learningBtn = getDefaultOpenViewLearningBtn();
    if (nexoraBtn) {
        nexoraBtn.classList.toggle('active', safeValue === 'nexora');
        nexoraBtn.setAttribute('aria-pressed', safeValue === 'nexora' ? 'true' : 'false');
    }
    if (learningBtn) {
        learningBtn.classList.toggle('active', safeValue === 'learning');
        learningBtn.setAttribute('aria-pressed', safeValue === 'learning' ? 'true' : 'false');
    }
}

async function saveDefaultOpenViewPreference(value) {
    const nextValue = value === 'nexora' ? 'nexora' : 'learning';

    if (!learningRuntimeEnabled) {
        setDefaultOpenViewToggleUi(resolveDefaultOpenView());
        showToast('NexoraLearning 未启用');
        return;
    }

    if (defaultOpenViewPreferenceSaving) {
        return;
    }

    const previousValue = resolveDefaultOpenView();
    defaultOpenViewPreferenceSaving = true;
    setDefaultOpenViewToggleUi(nextValue);

    try {
        const res = await fetch('/api/user/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_open_view: nextValue }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }

        currentUserPreferences = data.preferences || currentUserPreferences || {};
        setDefaultOpenViewToggleUi(resolveDefaultOpenView());
        showToast(nextValue === 'nexora' ? '默认打开 Nexora' : '默认打开 NexoraLearning');
    } catch (err) {
        console.error('保存默认打开设置失败:', err);
        setDefaultOpenViewToggleUi(previousValue);
        showToast(`保存默认打开设置失败: ${String((err && err.message) || 'unknown')}`);
    } finally {
        defaultOpenViewPreferenceSaving = false;
        setDefaultOpenViewToggleUi(resolveDefaultOpenView());
    }
}



// --- Initialization ---
// ── Long Task observer (temporary perf debugging) ──────────────────────────
try {
    if (typeof PerformanceObserver !== 'undefined') {
        const _ltObs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTaskLogger.debug(`[LongTask] duration=${entry.duration.toFixed(1)}ms start=${entry.startTime.toFixed(1)}ms name=${entry.name} attribution=${JSON.stringify(entry.attribution?.map(a => a.name) || [])}`);
            }
        });
        _ltObs.observe({ type: 'longtask', buffered: true });
    }
} catch (_) {}


function safeTokenInt(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}

function normalizeContextWindow(v) {
    const n = safeTokenInt(v);
    if (n < 1024) return 0;
    return Math.min(4000000, n);
}

function inferContextWindowByModelName(meta = {}) {
    return 0;
}

function resolveContextWindowForModel(modelId) {
    const meta = getModelMeta(modelId) || {};
    const explicit = normalizeContextWindow(
        meta.contextWindow != null ? meta.contextWindow
            : (meta.context_window != null ? meta.context_window : 0)
    );
    if (explicit > 0) {
        return { limit: explicit, estimated: false };
    }
    const inferred = inferContextWindowByModelName(meta);
    return { limit: inferred, estimated: true, missing: inferred <= 0 };
}

function estimateTokenCountFromCharCount(chars) {
    const n = safeTokenInt(chars);
    if (n <= 0) return 0;
    return Math.max(1, Math.ceil(n / 4));
}

function normalizeIoTokensPayload(ioObj) {
    const io = (ioObj && typeof ioObj === 'object') ? ioObj : {};
    const input = safeTokenInt(io.input);
    const rawInput = safeTokenInt(io.raw_input != null ? io.raw_input : io.input);
    const cachedInput = safeTokenInt(io.cached_input);
    const output = safeTokenInt(io.output);
    return {
        input,
        rawInput: Math.max(input, rawInput),
        cachedInput: Math.max(0, cachedInput),
        output
    };
}

function hasNonZeroIoTokens(tokens) {
    const t = (tokens && typeof tokens === 'object') ? tokens : {};
    return safeTokenInt(t.input) > 0
        || safeTokenInt(t.rawInput) > 0
        || safeTokenInt(t.cachedInput) > 0
        || safeTokenInt(t.output) > 0;
}

function readMessageIoTokens(metadata, preferWindow = true) {
    const md = (metadata && typeof metadata === 'object') ? metadata : {};
    const cumulative = normalizeIoTokensPayload(md.io_tokens_cumulative || md.io_tokens);
    const windowTokens = normalizeIoTokensPayload(md.io_tokens_window);
    const sanitizeWindowTokens = (tokens) => {
        const t = (tokens && typeof tokens === 'object') ? tokens : { input: 0, rawInput: 0, cachedInput: 0, output: 0 };
        const debug = (md.request_debug && typeof md.request_debug === 'object') ? md.request_debug : {};
        const limit = safeTokenInt(debug.context_window_limit);
        if (limit <= 0) return t;
        const compressed = !!debug.context_compression_triggered;
        const raw = safeTokenInt(t.rawInput);
        const inp = safeTokenInt(t.input);
        const overflow = Math.max(raw, inp) > limit;
        if (!overflow || compressed) return t;

        // 旧脏数据/口径漂移保护：未触发压缩却出现超窗，优先回退到累计口径（若其更小且非零）。
        if (hasNonZeroIoTokens(cumulative)) {
            const cumRaw = safeTokenInt(cumulative.rawInput);
            const cumIn = safeTokenInt(cumulative.input);
            const cumMax = Math.max(cumRaw, cumIn);
            if (cumMax > 0 && cumMax < Math.max(raw, inp)) {
                return cumulative;
            }
        }

        // 再退一步：用请求首轮 payload 字符数做上限近似，避免 UI/预判被异常大值卡住。
        const firstRoundChars = safeTokenInt(debug.first_round_input_chars);
        const sysTok = safeTokenInt(
            (debug.first_round_system_tokens != null) ? debug.first_round_system_tokens : debug.first_round_system_tokens_est
        );
        const toolsTok = safeTokenInt(
            (debug.first_round_tools_tokens != null) ? debug.first_round_tools_tokens : debug.first_round_tools_tokens_est
        );
        if (firstRoundChars > 0) {
            const cap = Math.max(1, Math.min(Math.max(1, limit - 64), firstRoundChars + sysTok + toolsTok));
            const nextInput = Math.min(safeTokenInt(t.input), cap);
            const nextRaw = Math.min(safeTokenInt(t.rawInput), cap);
            const nextCached = Math.max(0, Math.min(safeTokenInt(t.cachedInput), nextRaw));
            return {
                ...t,
                input: nextInput,
                rawInput: nextRaw,
                cachedInput: nextCached
            };
        }
        return t;
    };
    if (preferWindow) {
        if (hasNonZeroIoTokens(windowTokens)) {
            return sanitizeWindowTokens(windowTokens);
        }
        // 旧数据通常只有 io_tokens，优先直接使用真实 usage，避免被 chars 估算低估。
        if (hasNonZeroIoTokens(cumulative)) {
            return sanitizeWindowTokens(cumulative);
        }
        const debug = (md.request_debug && typeof md.request_debug === 'object') ? md.request_debug : {};
        const debugRawInput = safeTokenInt(debug.context_compression_post_raw_input);
        if (debugRawInput > 0) {
            return sanitizeWindowTokens({
                input: debugRawInput,
                rawInput: debugRawInput,
                cachedInput: 0,
                output: safeTokenInt(cumulative.output)
            });
        }
        const debugFirstRoundChars = safeTokenInt(debug.first_round_input_chars);
        if (debugFirstRoundChars > 0) {
            const est = estimateTokenCountFromCharCount(debugFirstRoundChars);
            return sanitizeWindowTokens({
                input: est,
                rawInput: est,
                cachedInput: 0,
                output: safeTokenInt(cumulative.output)
            });
        }
    }
    return cumulative;
}

function readMessageMemoryIoTokens(metadata) {
    const md = (metadata && typeof metadata === 'object') ? metadata : {};
    const source = (
        md.memory_io_tokens
        && typeof md.memory_io_tokens === 'object'
    ) ? md.memory_io_tokens : null;

    return {
        ready: !!source,
        input: safeTokenInt(source && source.input),
        output: safeTokenInt(source && source.output)
    };
}

function applyTokenBudgetPromptBreakdownFromConversationMessages(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    let latestInput = 0;
    let latestRawInput = 0;
    let latestCachedInput = 0;
    let cumulativeInput = 0;
    let cumulativeRawInput = 0;
    let cumulativeCachedInput = 0;
    let systemTokens = 0;
    let toolTokens = 0;
    let tokenBreakdownExact = false;
    let toolChars = 0;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        const msg = arr[i];
        if (!msg || typeof msg !== 'object') continue;
        if (String(msg.role || '').trim() !== 'assistant') continue;
        const md = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
        const ioWindow = readMessageIoTokens(md, true);
        const ioCumulative = readMessageIoTokens(md, false);
        const debug = (md.request_debug && typeof md.request_debug === 'object') ? md.request_debug : {};
        // 上下文窗口只看最后一轮请求口径，累计计费输入单独展示，避免工具多轮累计值污染窗口占用。
        latestInput = safeTokenInt(ioWindow.input);
        latestRawInput = safeTokenInt(ioWindow.rawInput);
        latestCachedInput = safeTokenInt(ioWindow.cachedInput);
        if (latestCachedInput <= 0 && latestRawInput >= latestInput) {
            latestCachedInput = Math.max(0, latestRawInput - latestInput);
        }
        cumulativeInput = safeTokenInt(ioCumulative.input);
        cumulativeRawInput = safeTokenInt(ioCumulative.rawInput);
        cumulativeCachedInput = safeTokenInt(ioCumulative.cachedInput);
        if (cumulativeCachedInput <= 0 && cumulativeRawInput >= cumulativeInput) {
            cumulativeCachedInput = Math.max(0, cumulativeRawInput - cumulativeInput);
        }
        systemTokens = safeTokenInt(debug.first_round_system_tokens);
        toolTokens = safeTokenInt(debug.first_round_tools_tokens);
        tokenBreakdownExact = !!debug.first_round_tokenization_exact;
        toolChars = safeTokenInt(debug.first_round_tools_chars);
        break;
    }
    tokenBudgetState.latestInputTokens = latestInput;
    tokenBudgetState.latestRawInputTokens = Math.max(latestInput, latestRawInput);
    tokenBudgetState.latestCachedInputTokens = Math.max(0, latestCachedInput);
    tokenBudgetState.cumulativeInputTokens = cumulativeInput;
    tokenBudgetState.cumulativeRawInputTokens = Math.max(cumulativeInput, cumulativeRawInput);
    tokenBudgetState.cumulativeCachedInputTokens = Math.max(0, cumulativeCachedInput);
    tokenBudgetState.systemPromptTokens = Math.max(0, systemTokens);
    tokenBudgetState.toolInputTokens = Math.max(0, toolTokens);
    tokenBudgetState.tokenBreakdownExact = tokenBreakdownExact && (systemTokens > 0 || toolTokens > 0);
    tokenBudgetState.toolInputEstimate = estimateTokenCountFromCharCount(toolChars);
}

function applyPromptTokenProfileChunk(chunk) {
    const c = (chunk && typeof chunk === 'object') ? chunk : {};
    const systemExact = safeTokenInt(c.system_tokens);
    const systemEst = safeTokenInt(c.system_tokens_est);
    const toolsExact = safeTokenInt(c.tools_tokens);
    const toolsEst = safeTokenInt(c.tools_tokens_est);
    const exact = !!c.tokenization_exact;
    tokenBudgetState.systemPromptTokens = systemExact > 0 ? systemExact : systemEst;
    tokenBudgetState.toolInputTokens = toolsExact;
    tokenBudgetState.toolInputEstimate = toolsExact > 0 ? toolsExact : toolsEst;
    tokenBudgetState.tokenBreakdownExact = exact && (systemExact > 0 || toolsExact > 0);
    renderTokenBudgetUi();
}

function setContextIncludeEnabled(enabled, options = {}) {
    const next = !!enabled;
    tokenBudgetState.includeContext = next;
    renderTokenBudgetUi();
    if (!options || options.persist !== false) {
        saveComposerPrefsToStorage();
    }
}

function toggleContextIncludeMode() {
    setContextIncludeEnabled(!tokenBudgetState.includeContext);
    showToast(tokenBudgetState.includeContext ? '已开启历史上下文传入' : '已关闭历史上下文传入');
}

function buildTokenBudgetHoverText(limit, used, ratioRaw, remain) {
    const contextOn = !!tokenBudgetState.includeContext;
    const hasContextWindow = normalizeContextWindow(limit) > 0;
    const totalInput = safeTokenInt(tokenBudgetState.latestInputTokens);
    const rawInput = Math.max(
        totalInput,
        safeTokenInt(tokenBudgetState.latestRawInputTokens),
        safeTokenInt(used)
    );
    const cachedInput = Math.max(
        0,
        safeTokenInt(tokenBudgetState.latestCachedInputTokens),
        Math.max(0, rawInput - totalInput)
    );
    const cumulativeInput = safeTokenInt(tokenBudgetState.cumulativeInputTokens);
    const systemTokens = safeTokenInt(tokenBudgetState.systemPromptTokens);
    const toolExact = safeTokenInt(tokenBudgetState.toolInputTokens);
    const toolEstimate = safeTokenInt(tokenBudgetState.toolInputEstimate);
    const toolTokens = toolExact > 0 ? toolExact : toolEstimate;
    const contextForPrompt = contextOn ? Math.max(0, rawInput - systemTokens - toolTokens) : 0;
    const exactBreakdown = !!tokenBudgetState.tokenBreakdownExact;

    const rows = [
        `上下文传入: ${contextOn ? '开启' : '关闭'}`,
        hasContextWindow
            ? `CTX 占用: ${used.toLocaleString()} / ${limit.toLocaleString()} (${Math.round(ratioRaw * 100)}%)`
            : `CTX 占用: ${used > 0 ? used.toLocaleString() : '--'} / 未配置`,
        `本轮原始输入: ${rawInput.toLocaleString()}`,
        `缓存命中: ${cachedInput.toLocaleString()}`,
        `系统/工具/上下文: ${systemTokens.toLocaleString()} / ${toolTokens.toLocaleString()} / ${contextForPrompt.toLocaleString()}${exactBreakdown ? '' : '（近似）'}`,
        `计费输入(本轮/累计): ${totalInput.toLocaleString()} / ${cumulativeInput.toLocaleString()}`,
        hasContextWindow
            ? `剩余窗口: ${remain.toLocaleString()}${tokenBudgetState.estimated ? '（上限估算）' : ''}`
            : '剩余窗口: 未配置'
    ];
    return rows.join('\n');
}

function buildTokenBudgetTooltipModel(limit, used, ratioRaw, remain) {
    const contextOn = !!tokenBudgetState.includeContext;
    const hasContextWindow = normalizeContextWindow(limit) > 0;
    const totalInput = safeTokenInt(tokenBudgetState.latestInputTokens);
    const rawInput = Math.max(
        totalInput,
        safeTokenInt(tokenBudgetState.latestRawInputTokens),
        safeTokenInt(used)
    );
    const cumulativeInput = safeTokenInt(tokenBudgetState.cumulativeInputTokens);
    const cachedInput = Math.max(
        0,
        safeTokenInt(tokenBudgetState.latestCachedInputTokens),
        Math.max(0, rawInput - totalInput)
    );
    const systemTokens = safeTokenInt(tokenBudgetState.systemPromptTokens);
    const toolExact = safeTokenInt(tokenBudgetState.toolInputTokens);
    const toolEstimate = safeTokenInt(tokenBudgetState.toolInputEstimate);
    const toolTokens = toolExact > 0 ? toolExact : toolEstimate;
    const contextTokens = contextOn ? Math.max(0, rawInput - systemTokens - toolTokens) : 0;
    const reserveTokens = hasContextWindow ? Math.max(0, limit - used) : 0;
    const pct = (n) => hasContextWindow
        ? `${Math.max(0, Math.min(100, Math.round((Math.max(0, n) / Math.max(1, limit)) * 1000) / 10)).toFixed(1)}%`
        : '未配置';
    return {
        limit,
        hasContextWindow,
        used,
        remain,
        ratioRaw,
        contextOn,
        rawInput,
        totalInput,
        cumulativeInput,
        cachedInput,
        systemTokens,
        toolTokens,
        contextTokens,
        reserveTokens,
        pct
    };
}

function ensureTokenBudgetTooltipEl() {
    let el = document.getElementById('tokenBudgetTooltip');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tokenBudgetTooltip';
    el.className = 'token-budget-tooltip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
}

function positionTokenBudgetTooltipFromPoint(clientX, clientY) {
    const el = ensureTokenBudgetTooltipEl();
    if (!el) return;
    const pad = 12;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const w = el.offsetWidth || 220;
    const h = el.offsetHeight || 80;
    let left = Math.round(Number(clientX || 0) + 12);
    let top = Math.round(Number(clientY || 0) + 14);
    if (left + w + pad > vw) left = Math.max(pad, vw - w - pad);
    if (top + h + pad > vh) top = Math.max(pad, Number(clientY || 0) - h - 14);
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function positionTokenBudgetTooltipByElement(target) {
    const el = ensureTokenBudgetTooltipEl();
    if (!el || !target || typeof target.getBoundingClientRect !== 'function') return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + (rect.width / 2);
    const cy = rect.top + rect.height;
    positionTokenBudgetTooltipFromPoint(cx, cy);
}

function hideTokenBudgetTooltip() {
    const el = ensureTokenBudgetTooltipEl();
    if (!el) return;
    tokenBudgetTooltipState.visible = false;
    tokenBudgetTooltipState.target = null;
    el.classList.remove('visible');
    el.setAttribute('aria-hidden', 'true');
}

function renderTokenBudgetTooltipContent(el, model) {
    if (!el || !model) return;
    const hasContextWindow = !!model.hasContextWindow;
    const pctValue = hasContextWindow ? Math.max(0, Math.min(100, Math.round(model.ratioRaw * 1000) / 10)) : 0;
    el.innerHTML = `
        <div class="token-budget-tip-head">
            <div class="token-budget-tip-title">上下文窗口</div>
            <div class="token-budget-tip-pct">${hasContextWindow ? `${pctValue.toFixed(1)}%` : '未配置'}</div>
        </div>
        <div class="token-budget-tip-sub">${hasContextWindow ? `${model.used.toLocaleString()}/${model.limit.toLocaleString()} 个令牌` : '当前模型未配置上下文窗口'}</div>
        <div class="token-budget-tip-bar"><span style="width:${pctValue.toFixed(1)}%"></span></div>
        <div class="token-budget-tip-grid">
            <div class="token-budget-tip-row"><span>System Instructions</span><em>${model.systemTokens.toLocaleString()} (${model.pct(model.systemTokens)})</em></div>
            <div class="token-budget-tip-row"><span>Tool Definitions</span><em>${model.toolTokens.toLocaleString()} (${model.pct(model.toolTokens)})</em></div>
            <div class="token-budget-tip-row"><span>User Messages</span><em>${model.contextTokens.toLocaleString()} (${model.pct(model.contextTokens)})</em></div>
            <div class="token-budget-tip-row"><span>Cache Hits</span><em>${model.cachedInput.toLocaleString()}</em></div>
            <div class="token-budget-tip-row"><span>Billable Input</span><em>${model.totalInput.toLocaleString()} / ${model.cumulativeInput.toLocaleString()}</em></div>
            <div class="token-budget-tip-row"><span>Remaining</span><em>${hasContextWindow ? `${model.remain.toLocaleString()}${tokenBudgetState.estimated ? ' (估算上限)' : ''}` : '未配置'}</em></div>
        </div>
    `;
}

function showTokenBudgetTooltip(target, text, clientX = null, clientY = null) {
    const el = ensureTokenBudgetTooltipEl();
    const nextText = String(text || '').trim();
    if (!el || !nextText) return;
    const limit = normalizeContextWindow(tokenBudgetState.contextWindow);
    const used = computeContextWindowUsedTokens();
    const remain = limit > 0 ? Math.max(0, limit - used) : 0;
    const ratioRaw = limit > 0 ? (used / limit) : 0;
    const tipModel = buildTokenBudgetTooltipModel(limit, used, ratioRaw, remain);
    renderTokenBudgetTooltipContent(el, tipModel);
    tokenBudgetTooltipState.visible = true;
    tokenBudgetTooltipState.target = target || null;
    tokenBudgetTooltipState.lastText = nextText;
    el.classList.add('visible');
    el.setAttribute('aria-hidden', 'false');
    if (clientX !== null && clientY !== null) {
        positionTokenBudgetTooltipFromPoint(clientX, clientY);
    } else {
        positionTokenBudgetTooltipByElement(target || els.tokenBudgetMini || els.tokenBudgetUsage);
    }
}

function bindTokenBudgetTooltipTriggers() {
    const mini = els.tokenBudgetMini || document.getElementById('tokenBudgetMini');
    const usage = els.tokenBudgetUsage || document.getElementById('tokenBudgetUsage');
    const ring = els.tokenBudgetRing || document.getElementById('tokenBudgetRing');
    const targets = [usage].filter(Boolean);
    if (!targets.length) return;
    targets.forEach((t) => {
        if (!t || t.dataset.tokenBudgetTooltipBound === '1') return;
        t.dataset.tokenBudgetTooltipBound = '1';
        t.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tip = String((t.dataset.tokenBudgetTip || '')).trim();
            if (!tip) return;
            if (tokenBudgetTooltipState.visible) {
                hideTokenBudgetTooltip();
                return;
            }
            showTokenBudgetTooltip(t, tip);
        });
    });
    if (mini && mini.dataset.tokenBudgetMiniBound !== '1') {
        mini.dataset.tokenBudgetMiniBound = '1';
        mini.addEventListener('click', (e) => e.stopPropagation());
    }
    if (ring && ring.dataset.tokenBudgetRingBound !== '1') {
        ring.dataset.tokenBudgetRingBound = '1';
        ring.addEventListener('click', (e) => e.stopPropagation());
    }
    if (!window.__tokenBudgetTooltipDocBound) {
        window.__tokenBudgetTooltipDocBound = true;
        document.addEventListener('scroll', () => {
            if (!tokenBudgetTooltipState.visible) return;
            if (!tokenBudgetTooltipState.target) {
                hideTokenBudgetTooltip();
                return;
            }
            positionTokenBudgetTooltipByElement(tokenBudgetTooltipState.target);
        }, true);
        document.addEventListener('click', (e) => {
            if (!tokenBudgetTooltipState.visible) return;
            const tipEl = document.getElementById('tokenBudgetTooltip');
            if (tipEl && tipEl.contains(e.target)) return;
            const usageEl = els.tokenBudgetUsage || document.getElementById('tokenBudgetUsage');
            if (usageEl && usageEl.contains(e.target)) return;
            hideTokenBudgetTooltip();
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && tokenBudgetTooltipState.visible) {
                hideTokenBudgetTooltip();
            }
        }, true);
    }
}

/**
 * 计算本轮实际传给模型的 input token（上下文窗口真实占用）。
 *
 * responses 续接类 provider（如 volcengine previous_response_id）的 usage 是增量口径，
 * 只包含新增消息部分；完整请求的 input 物理上不可能小于 system+tools 固定部分，
 * 检测到这种口径时补全固定部分，否则直接使用 usage 上报值。
 */
function computeContextWindowUsedTokens() {
    const round = safeTokenInt(tokenBudgetState.roundInput);
    const systemTokens = safeTokenInt(tokenBudgetState.systemPromptTokens);
    const toolExact = safeTokenInt(tokenBudgetState.toolInputTokens);
    const toolTokens = toolExact > 0 ? toolExact : safeTokenInt(tokenBudgetState.toolInputEstimate);
    const fixedTokens = systemTokens + toolTokens;

    if (round > 0 && fixedTokens > 0 && round < fixedTokens) {
        return round + fixedTokens;
    }

    return round;
}

function renderTokenBudgetUi() {
    const ring = els.tokenBudgetRing || document.getElementById('tokenBudgetRing');
    const usage = els.tokenBudgetUsage || document.getElementById('tokenBudgetUsage');
    const mini = els.tokenBudgetMini || document.getElementById('tokenBudgetMini');
    const toggle = els.tokenBudgetContextToggle || document.getElementById('tokenBudgetContextToggle');
    if (!ring || !usage || !mini) return;

    const configuredLimit = normalizeContextWindow(tokenBudgetState.contextWindow);
    const hasContextWindow = configuredLimit > 0;
    const limit = hasContextWindow ? configuredLimit : 0;
    const used = computeContextWindowUsedTokens();
    const ratioRaw = hasContextWindow ? (used / limit) : 0;
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    const angle = Math.round(ratio * 360);

    let color = '#22c55e';
    if (!hasContextWindow) color = '#64748b';
    else if (ratioRaw >= 0.8) color = '#ef4444';
    else if (ratioRaw >= 0.6) color = '#f59e0b';

    mini.style.setProperty('--tb-color', color);
    mini.style.setProperty('--tb-angle', `${angle}deg`);
    mini.classList.toggle('context-enabled', !!tokenBudgetState.includeContext);
    mini.classList.toggle('context-disabled', !tokenBudgetState.includeContext);
    usage.style.color = color;
    if (toggle) {
        toggle.setAttribute('aria-pressed', tokenBudgetState.includeContext ? 'true' : 'false');
        toggle.setAttribute('aria-label', tokenBudgetState.includeContext ? '关闭历史上下文传入' : '开启历史上下文传入');
    }

    const remain = hasContextWindow ? Math.max(0, limit - used) : 0;
    const prefix = tokenBudgetState.estimated ? '~' : '';
    const systemTokens = safeTokenInt(tokenBudgetState.systemPromptTokens);
    const toolExact = safeTokenInt(tokenBudgetState.toolInputTokens);
    const toolEstimate = safeTokenInt(tokenBudgetState.toolInputEstimate);
    const toolTokens = toolExact > 0 ? toolExact : toolEstimate;
    const rawForBreakdown = Math.max(safeTokenInt(tokenBudgetState.latestRawInputTokens), safeTokenInt(used));
    const contextTokens = tokenBudgetState.includeContext
        ? Math.max(0, rawForBreakdown - systemTokens - toolTokens)
        : 0;
    usage.textContent = hasContextWindow
        ? `CTX ${prefix}${used.toLocaleString()}/${limit.toLocaleString()}`
        : `CTX ${used > 0 ? used.toLocaleString() : '--'}/未配置`;
    const hoverText = buildTokenBudgetHoverText(limit, used, ratioRaw, remain);
    mini.dataset.tokenBudgetTip = hoverText;
    usage.dataset.tokenBudgetTip = hoverText;
    ring.dataset.tokenBudgetTip = hoverText;
    bindTokenBudgetTooltipTriggers();
    if (tokenBudgetTooltipState.visible && tokenBudgetTooltipState.target) {
        showTokenBudgetTooltip(tokenBudgetTooltipState.target, hoverText);
    }
}

function updateTokenBudgetContextFromSelectedModel() {
    const ctx = resolveContextWindowForModel(selectedModelId);
    tokenBudgetState.contextWindow = ctx.limit;
    tokenBudgetState.estimated = !!ctx.estimated;
    tokenBudgetState.missingContextWindow = !!ctx.missing || normalizeContextWindow(ctx.limit) <= 0;
    renderTokenBudgetUi();
}

function updateTokenBudgetRoundInput(rawInputTokens, effectiveInputTokens = null, cachedInputTokens = null, options = {}) {
    const rawN = safeTokenInt(rawInputTokens);
    const effectiveN = safeTokenInt(effectiveInputTokens);
    const cachedN = safeTokenInt(cachedInputTokens);
    const forceReplace = !!(options && options.forceReplace);
    let changed = false;
    if (rawN > 0 && (forceReplace || rawN > tokenBudgetState.roundInput)) {
        tokenBudgetState.roundInput = rawN;
        changed = true;
    }
    if (effectiveN > 0) {
        tokenBudgetState.latestInputTokens = effectiveN;
    }
    if (rawN > 0) {
        tokenBudgetState.latestRawInputTokens = rawN;
    }
    if (cachedN > 0) {
        tokenBudgetState.latestCachedInputTokens = cachedN;
    } else if (rawN > 0 && effectiveN >= 0) {
        tokenBudgetState.latestCachedInputTokens = Math.max(0, rawN - effectiveN);
    }
    if (changed) renderTokenBudgetUi();
}

function resetTokenBudgetBreakdown() {
    tokenBudgetState.latestInputTokens = 0;
    tokenBudgetState.latestRawInputTokens = 0;
    tokenBudgetState.latestCachedInputTokens = 0;
    tokenBudgetState.cumulativeInputTokens = 0;
    tokenBudgetState.cumulativeRawInputTokens = 0;
    tokenBudgetState.cumulativeCachedInputTokens = 0;
    tokenBudgetState.toolInputEstimate = 0;
    tokenBudgetState.toolInputTokens = 0;
    tokenBudgetState.systemPromptTokens = 0;
    tokenBudgetState.tokenBreakdownExact = false;
}

function resetComposerConversationContextUsage() {
    // Workspace 详情复用主输入框，但它不是已加载 Conversation，必须清空旧对话的 CTX 使用量。
    tokenMiniState.conversationId = null;
    tokenMiniState.streaming = false;
    tokenMiniState.baseInput = 0;
    tokenMiniState.baseOutput = 0;
    tokenBudgetState.roundInput = 0;
    resetTokenMiniStreamPart();
    resetTokenBudgetBreakdown();
    applyTokenMiniDisplay(0, 0);
    renderTokenBudgetUi();
    hideTokenBudgetTooltip();
}

function estimateTokenBudgetUsedFromConversationMessages(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    if (!arr.length) return 0;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        const msg = arr[i];
        if (!msg || typeof msg !== 'object') continue;
        if (String(msg.role || '').trim() !== 'assistant') continue;
        const md = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
        const ioWindow = readMessageIoTokens(md, true);
        const inTok = safeTokenInt(ioWindow.input);
        const rawTok = safeTokenInt(ioWindow.rawInput);
        if (rawTok > 0) return rawTok;
        if (inTok > 0) return inTok;
    }
    return 0;
}

function applyTokenBudgetFromConversationMessages(messages) {
    const est = estimateTokenBudgetUsedFromConversationMessages(messages);
    tokenBudgetState.roundInput = est;
    applyTokenBudgetPromptBreakdownFromConversationMessages(messages);
    renderTokenBudgetUi();
}

function buildModelBadgeText(
    modelName,
    searchFlag,
    inputTokens,
    outputTokens,
    memoryInputTokens,
    memoryOutputTokens,
    memoryReady
) {
    const model = String(modelName || '-').trim() || '-';
    const search = (typeof searchFlag === 'boolean') ? String(searchFlag) : String(searchFlag || 'unknown');
    const input = safeTokenInt(inputTokens).toLocaleString();
    const output = safeTokenInt(outputTokens).toLocaleString();
    const memoryText = memoryReady
        ? ` - mem I/O: ${safeTokenInt(memoryInputTokens).toLocaleString()}/${safeTokenInt(memoryOutputTokens).toLocaleString()}`
        : '';
    return `${model} - search: ${search} - I/O: ${input}/${output}${memoryText}`;
}

function ensureMessageModelBadge(messageDiv) {
    if (!messageDiv) return null;
    const content = messageDiv.querySelector('.message-content');
    if (!content) return null;
    let badge = content.querySelector('.model-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'model-badge';
        badge.dataset.expanded = '1';
        content.appendChild(badge);
    }
    if (badge.dataset.boundToggle !== '1') {
        badge.dataset.boundToggle = '1';
        badge.addEventListener('click', () => {
            const expanded = badge.dataset.expanded === '1';
            badge.dataset.expanded = expanded ? '0' : '1';
            renderMessageModelBadgeText(messageDiv);
        });
    }
    return badge;
}

function renderMessageModelBadgeText(messageDiv) {
    if (!messageDiv) return;
    const badge = ensureMessageModelBadge(messageDiv);
    if (!badge) return;
    const state = (messageDiv.__modelBadgeState && typeof messageDiv.__modelBadgeState === 'object')
        ? messageDiv.__modelBadgeState
        : {
            modelName: '',
            searchFlag: 'unknown',
            inputTokens: 0,
            outputTokens: 0,
            memoryInputTokens: 0,
            memoryOutputTokens: 0,
            memoryReady: false
        };
    const expanded = badge.dataset.expanded === '1';
    const compactText = String(state.modelName || '-').trim() || '-';
    const fullText = buildModelBadgeText(
        state.modelName,
        state.searchFlag,
        state.inputTokens,
        state.outputTokens,
        state.memoryInputTokens,
        state.memoryOutputTokens,
        state.memoryReady
    );
    badge.textContent = expanded ? fullText : compactText;
    badge.title = expanded ? '点击折叠模型信息' : fullText;
    badge.classList.toggle('collapsed', !expanded);
}

function getStreamingModelBadgeName(fallbackName = '') {
    const direct = String(fallbackName || '').trim();
    if (direct) return direct;
    const meta = typeof getSelectedModelMeta === 'function' ? getSelectedModelMeta() : null;
    return String((meta && (meta.name || meta.id)) || selectedModelId || '').trim();
}

function syncStreamingModelBadgeEstimate(messageDiv, state = {}, fallbackName = '') {
    if (!messageDiv) return;
    const nextState = {
        modelName: String((state && state.modelName) || getStreamingModelBadgeName(fallbackName)),
        searchFlag: (state && Object.prototype.hasOwnProperty.call(state, 'searchFlag')) ? state.searchFlag : 'unknown',
        inputTokens: safeTokenInt(state && state.inputTokens),
        memoryInputTokens: safeTokenInt(state && state.memoryInputTokens),
        memoryOutputTokens: safeTokenInt(state && state.memoryOutputTokens),
        memoryReady: !!(state && state.memoryReady),
        outputTokens: Math.max(
            safeTokenInt(state && state.outputTokens),
            safeTokenInt(tokenMiniState.streamOutput),
            safeTokenInt(tokenMiniState.estimatedStreamOutput)
        )
    };
    updateMessageModelBadge(messageDiv, nextState);
}

function updateMessageModelBadge(messageDiv, state = {}) {
    if (!messageDiv) return;
    if (!ensureMessageModelBadge(messageDiv)) return;
    const nextState = {
        modelName: String((state && state.modelName) || ''),
        searchFlag: (state && Object.prototype.hasOwnProperty.call(state, 'searchFlag')) ? state.searchFlag : 'unknown',
        inputTokens: safeTokenInt(state && state.inputTokens),
        outputTokens: safeTokenInt(state && state.outputTokens),
        memoryInputTokens: safeTokenInt(state && state.memoryInputTokens),
        memoryOutputTokens: safeTokenInt(state && state.memoryOutputTokens),
        memoryReady: !!(state && state.memoryReady)
    };
    messageDiv.__modelBadgeState = nextState;
    renderMessageModelBadgeText(messageDiv);
}

function applyUsageChunkToBadgeState(usageState, chunk) {
    if (!usageState || typeof usageState !== 'object') return;
    const inTokens = safeTokenInt(chunk && chunk.input_tokens);
    const outTokens = safeTokenInt(chunk && chunk.output_tokens);
    if (!usageState.snapshotInitialized) {
        usageState.input += inTokens;
        usageState.output += outTokens;
        usageState.snapshotInput = inTokens;
        usageState.snapshotOutput = outTokens;
        usageState.snapshotInitialized = true;
        return;
    }
    // 输入与输出快照独立处理，避免某一项回退导致另一项被错误整段重加。
    if (inTokens >= usageState.snapshotInput) {
        usageState.input += (inTokens - usageState.snapshotInput);
    } else {
        usageState.input += inTokens;
    }
    if (outTokens >= usageState.snapshotOutput) {
        usageState.output += (outTokens - usageState.snapshotOutput);
    } else {
        usageState.output += outTokens;
    }
    usageState.snapshotInput = inTokens;
    usageState.snapshotOutput = outTokens;
}

function estimateStreamTokensByText(text) {
    const s = String(text || '');
    if (!s) return 0;
    const nonAscii = (s.match(/[^\x00-\x7F]/g) || []).length;
    const ascii = s.length - nonAscii;
    return Math.max(1, Math.ceil(nonAscii / 1.25 + ascii / 4));
}

function applyTokenMiniDisplay(inputTokens, outputTokens) {
    if (els.totalInputTokens) els.totalInputTokens.textContent = safeTokenInt(inputTokens).toLocaleString();
    if (els.totalOutputTokens) els.totalOutputTokens.textContent = safeTokenInt(outputTokens).toLocaleString();
}

function renderTokenMiniFromState() {
    const inputNow = tokenMiniState.baseInput + tokenMiniState.streamInput;
    const outputStream = Math.max(tokenMiniState.streamOutput, tokenMiniState.estimatedStreamOutput);
    const outputNow = tokenMiniState.baseOutput + outputStream;
    applyTokenMiniDisplay(inputNow, outputNow);
    renderTokenBudgetUi();
}

function resetTokenMiniStreamPart() {
    tokenMiniState.streamInput = 0;
    tokenMiniState.streamOutput = 0;
    tokenMiniState.estimatedStreamOutput = 0;
    tokenMiniState.usageSnapshotInput = 0;
    tokenMiniState.usageSnapshotOutput = 0;
    tokenMiniState.usageSnapshotInitialized = false;
}

function beginTokenMiniStreaming(conversationId = currentConversationId) {
    const cid = conversationId ? String(conversationId).trim() : '';
    tokenMiniState.streaming = true;
    tokenMiniState.conversationId = cid || null;
    resetTokenMiniStreamPart();
    // 保留上一轮 CTX 展示，直到本轮返回 usage 再覆盖，避免“发送即清零”的跳变。
    renderTokenMiniFromState();
}

function noteTokenMiniConversationId(conversationId) {
    const cid = conversationId ? String(conversationId) : null;
    if (!cid) return;
    if (!tokenMiniState.conversationId) {
        tokenMiniState.conversationId = cid;
    }
}

function onTokenStreamTextChunk(content) {
    if (!tokenMiniState.streaming) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(content);
    renderTokenMiniFromState();
}

function onTokenStreamReasoningChunk(content) {
    if (!tokenMiniState.streaming) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(content);
    renderTokenMiniFromState();
}

function onTokenStreamToolArgsChunk(content) {
    if (!tokenMiniState.streaming) return;
    const s = String(content || '');
    if (!s) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(s);
    renderTokenMiniFromState();
}

function onTokenStreamUsageChunk(chunk) {
    if (!tokenMiniState.streaming) return;
    const inTokens = safeTokenInt(chunk && chunk.input_tokens);
    const outTokens = safeTokenInt(chunk && chunk.output_tokens);
    const rawInTokens = safeTokenInt(chunk && chunk.raw_input_tokens);
    const cachedInTokens = safeTokenInt(chunk && chunk.cached_input_tokens);
    const normalizedRawInput = rawInTokens > 0 ? rawInTokens : (inTokens + Math.max(0, cachedInTokens));
    const forceReplaceRoundInput = !tokenMiniState.usageSnapshotInitialized;
    updateTokenBudgetRoundInput(normalizedRawInput, inTokens, cachedInTokens, {
        forceReplace: forceReplaceRoundInput
    });
    renderTokenBudgetUi();

    if (!tokenMiniState.usageSnapshotInitialized) {
        tokenMiniState.streamInput += inTokens;
        tokenMiniState.streamOutput += outTokens;
        tokenMiniState.usageSnapshotInput = inTokens;
        tokenMiniState.usageSnapshotOutput = outTokens;
        tokenMiniState.usageSnapshotInitialized = true;
        renderTokenMiniFromState();
        return;
    }

    // 输入与输出快照独立处理，避免 output 回退时把 input 也误当成整段增量。
    if (inTokens >= tokenMiniState.usageSnapshotInput) {
        tokenMiniState.streamInput += (inTokens - tokenMiniState.usageSnapshotInput);
    } else {
        tokenMiniState.streamInput += inTokens;
    }
    if (outTokens >= tokenMiniState.usageSnapshotOutput) {
        tokenMiniState.streamOutput += (outTokens - tokenMiniState.usageSnapshotOutput);
    } else {
        tokenMiniState.streamOutput += outTokens;
    }

    tokenMiniState.usageSnapshotInput = inTokens;
    tokenMiniState.usageSnapshotOutput = outTokens;
    renderTokenMiniFromState();
}

async function refreshTokenMiniForConversation(conversationId, options = {}) {
    const { keepStreamPart = false, allowInactive = false } = options;
    const cid = conversationId ? String(conversationId) : '';

    if (!allowInactive && cid && String(currentConversationId || '').trim() !== cid) {
        return;
    }

    tokenMiniState.conversationId = cid || null;
    if (!keepStreamPart) resetTokenMiniStreamPart();

    if (!cid) {
        tokenMiniState.baseInput = 0;
        tokenMiniState.baseOutput = 0;
        if (!keepStreamPart) {
            tokenBudgetState.roundInput = 0;
            resetTokenBudgetBreakdown();
        }
        renderTokenMiniFromState();
        return;
    }

    const reqId = ++tokenMiniState.requestSeq;
    try {
        const res = await fetch(`/api/tokens/stats?conversation_id=${encodeURIComponent(cid)}`);
        const data = await res.json();
        if (reqId !== tokenMiniState.requestSeq) return;
        if (!data || !data.success) return;
        tokenMiniState.baseInput = safeTokenInt(data.today_input ?? data.input_today ?? data.input_total);
        tokenMiniState.baseOutput = safeTokenInt(data.today_output ?? data.output_today ?? data.output_total);
        renderTokenMiniFromState();
    } catch (e) {
        console.error('Error loading conversation token stats', e);
    }
}

async function finishTokenMiniStreaming(conversationId = null) {
    const requestedCid = conversationId ? String(conversationId).trim() : '';
    if (requestedCid && String(tokenMiniState.conversationId || '').trim() !== requestedCid) {
        return;
    }

    tokenMiniState.streaming = false;
    const cid = requestedCid || currentConversationId || tokenMiniState.conversationId;
    await refreshTokenMiniForConversation(cid, { keepStreamPart: false });
}

async function openTokenModal() {
    if(!els.tokenModal) return;
    els.tokenModal.classList.add('active');
    
    try {
        const res = await fetch('/api/tokens/stats');
        const data = await res.json();
        if(data.success) {
            if(els.modalTotalTokens) els.modalTotalTokens.textContent = data.total.toLocaleString();
            if(els.modalTodayTokens) els.modalTodayTokens.textContent = (data.today || 0).toLocaleString();
            
            // 渲染历史日志
            const logsTableBody = document.getElementById('tokenLogsTableBody');
            if (logsTableBody && data.history) {
                window.NexoraTokenUsageDetails.renderHistory(logsTableBody, data.history);
            }
        }
    } catch(e) { console.error("Error loading token stats", e); }
}

// --- Conversations ---
function beginConversationNavigation(conversationId) {
    const cid = String(conversationId || '').trim();
    conversationNavigationSeq += 1;

    if (activeConversationLoadController) {
        try {
            activeConversationLoadController.abort();
        } catch (abortError) {
            console.error('[ConversationNav] abort previous load failed', abortError);
        }
    }

    activeConversationLoadController = new AbortController();

    return {
        conversationId: cid,
        seq: conversationNavigationSeq,
        controller: activeConversationLoadController
    };
}

function isActiveConversationNavigation(token) {
    const nav = (token && typeof token === 'object') ? token : {};
    const cid = String(nav.conversationId || '').trim();

    return !!(
        cid
        && Number(nav.seq) === Number(conversationNavigationSeq)
        && String(currentConversationId || '').trim() === cid
    );
}

function getVisibleMessagesConversationId() {
    if (!els.messagesContainer) return '';

    const ids = Array.from(els.messagesContainer.querySelectorAll('.message'))
        .map((row) => String(row && row.dataset ? row.dataset.conversationId || '' : '').trim())
        .filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length > 1) {
        console.error('[ConversationNav] visible message list contains mixed conversation ids', {
            conversation_ids: uniqueIds,
            current_conversation_id: String(currentConversationId || '')
        });
        return '';
    }

    return uniqueIds[0] || '';
}

function hasVisibleLiveStreamPanel(conversationId) {
    const cid = String(conversationId || '').trim();
    if (!cid || !els.messagesContainer) return false;

    const state = getConversationStreamState(cid);
    if (!state || String(state.status || '') !== 'running') return false;

    const assistantIndex = normalizeStreamMessageIndex(state.assistant_index)
        ?? (state.is_regenerate ? normalizeStreamMessageIndex(state.regenerate_index) : null);
    const rows = Array.from(els.messagesContainer.querySelectorAll('.message.assistant'))
        .filter((row) => String(row && row.dataset ? row.dataset.conversationId || '' : '').trim() === cid);
    const targetRows = assistantIndex === null
        ? rows
        : rows.filter((row) => normalizeStreamMessageIndex(row && row.dataset ? row.dataset.index : null) === assistantIndex);

    return targetRows.some((row) => {
        if (!row) return false;
        if (row.querySelector('[data-stream-live="1"]')) return true;

        const isPendingLocal = row.classList.contains('pending') && String(row.dataset.localOnly || '') === '1';
        const hasStoredContent = !!row.querySelector('.content-body:not([data-stream-live="1"])');

        return isPendingLocal && !hasStoredContent;
    });
}

function shouldKeepCurrentRunningConversationPanel(targetConversationId, options = {}) {
    const cid = String(targetConversationId || '').trim();
    if (!cid || options.forceReload === true) return false;
    if (String(currentConversationId || '').trim() !== cid) return false;
    if (!isConversationStreamRunning(cid)) return false;

    const visibleConversationId = getVisibleMessagesConversationId();
    if (visibleConversationId && visibleConversationId !== cid) {
        console.error('[ConversationNav] current conversation id and visible panel are out of sync', {
            target_conversation_id: cid,
            visible_conversation_id: visibleConversationId
        });
        return false;
    }

    if (!hasVisibleLiveStreamPanel(cid)) {
        console.warn('[ConversationNav] current running conversation panel is not live stream DOM, reloading stream panel', {
            target_conversation_id: cid
        });
        return false;
    }

    return true;
}

async function loadConversations() {
    return conversationListController.loadConversations();
}

function buildConversationListSignature(conversations) {
    return conversationListController.buildConversationListSignature(conversations);
}

function renderConversationList(conversations) {
    return conversationListController.renderConversationList(conversations);
}

function resetConversationListRenderSignature() {
    return conversationListController.resetConversationListRenderSignature();
}

function normalizeLongtermState(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const plan = Array.isArray(src.plan) ? src.plan.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const hook = (src.hook && typeof src.hook === 'object') ? src.hook : {};
    const doneIndices = coerceLongtermIndexList(src.done_indices || src.doneIndices || []);
    const currentIndex = coerceLongtermIndex(src.current_index != null ? src.current_index : src.currentIndex, -1);
    const state = {
        active: !!src.active,
        task: String(src.task || '').trim(),
        plan,
        context: String(src.context || src.context_text || '').trim(),
        step: String(src.step || src.step_title || src.current_step || src.currentStep || '').trim(),
        current_index: currentIndex,
        done_indices: doneIndices,
        hook
    };
    return state;
}

function coerceLongtermIndex(value, fallback = -1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(-1, Math.floor(parsed)) : fallback;
}

function coerceLongtermIndexList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .filter((item, index, self) => self.indexOf(item) === index);
}

function normalizeLongtermPlanItemText(item) {
    if (item && typeof item === 'object') {
        return String(item.text || item.title || item.label || item.content || item.step || '').trim();
    }
    return String(item || '').trim();
}

function normalizeLongtermPlanStatus(itemText, state = {}) {
    const text = String(itemText || '').trim();
    const currentIndex = coerceLongtermIndex(state.current_index != null ? state.current_index : state.currentIndex, -1);
    const doneIndices = coerceLongtermIndexList(state.done_indices || state.doneIndices || []);
    const index = Number.isFinite(Number(state.__index)) ? Number(state.__index) : -1;

    const doneText = /^(?:\[[xX]\]|[✓✔☑]|done\b|completed\b)/i.test(text);
    const activeText = /^(?:\[>\]|[▶➤➜]|active\b|current\b|doing\b|running\b|in progress\b)/i.test(text);

    if (doneIndices.includes(index)) return 'done';
    if (currentIndex >= 0 && index === currentIndex) return 'active';
    if (doneText) return 'done';
    if (activeText) return 'active';
    return 'pending';
}

function getNextPendingLongtermStepIndex(plan, doneIndices, startIndex = 0) {
    const arr = Array.isArray(plan) ? plan : [];
    const doneSet = new Set(coerceLongtermIndexList(doneIndices || []));
    const begin = Math.max(0, Number(startIndex) || 0);
    for (let index = begin; index < arr.length; index += 1) {
        if (!doneSet.has(index)) return index;
    }
    return -1;
}

function sanitizeLongtermPlanText(itemText) {
    return String(itemText || '')
        .replace(/^\s*(?:[-*+]|\d+[.)]|[>▶➤➜])\s*/u, '')
        .replace(/^\s*\[[xX\s]\]\s*/u, '')
        .trim();
}

function renderLongtermPlanItemStatusIcon(status) {
    if (status === 'done') {
        return '<i class="fa-solid fa-circle-check longterm-plan-item-icon"></i>';
    }
    if (status === 'active') {
        return '<i class="fa-solid fa-circle-dot longterm-plan-item-icon"></i>';
    }
    return '<i class="fa-regular fa-circle longterm-plan-item-icon"></i>';
}

function extractLongtermPlanFromText(rawText) {
    const src = rawText && typeof rawText === 'object' ? rawText : jsonParseSafe(String(rawText || ''));
    if (!src || typeof src !== 'object') {
        return { found: false, kind: '', text: String(rawText || ''), plan: [], task: '', context: '', summary: '', done: false, step_index: -1, step_no: -1, step_id: '', step_title: '', step_status: '', raw: rawText };
    }
    const kind = String(src.kind || src.type || '').trim().toLowerCase();
    const planSource = Array.isArray(src.plan)
        ? src.plan
        : Array.isArray(src.steps)
            ? src.steps
            : [];
    const plan = planSource.map((item) => normalizeLongtermPlanItemText(item)).filter(Boolean);
    const context = String(src.context || src.context_text || '').trim();
    const summary = String(src.summary || src.text || src.message || '').trim();
    const task = String(src.task || src.task_text || '').trim();
    const stepIndexRaw = src.step_index != null ? src.step_index : src.stepIndex;
    const stepNoRaw = src.step_no != null ? src.step_no : src.stepNo;
    const stepIndex = Number.isFinite(Number(stepIndexRaw)) ? Math.max(-1, Math.floor(Number(stepIndexRaw))) : -1;
    const stepNo = Number.isFinite(Number(stepNoRaw)) ? Math.max(-1, Math.floor(Number(stepNoRaw))) : -1;
    const resolvedStepIndex = stepIndex >= 0 ? stepIndex : (stepNo > 0 ? stepNo - 1 : -1);
    const stepId = String(src.step_id || src.stepId || '').trim();
    const stepTitle = String(src.step_title || src.stepTitle || '').trim();
    const stepStatus = String(src.step_status || src.stepStatus || '').trim().toLowerCase();
    const done = kind === 'longterm_update' ? (src.done !== false) : (kind === 'longterm_plan' ? false : !!src.done);
    return {
        found: !!kind || plan.length > 0 || !!context || !!summary,
        kind,
        plan,
        task,
        context,
        summary,
        done,
        step_index: resolvedStepIndex,
        step_no: stepNo,
        step_id: stepId,
        step_title: stepTitle,
        step_status: stepStatus,
        raw: src
    };
}

function applyLongtermPlanFromText(rawText, source = {}) {
    const parsed = extractLongtermPlanFromText(rawText);
    if (!parsed.found) {
        return parsed;
    }
    const nextState = normalizeLongtermState(currentConversationLongtermState);
    const plan = Array.isArray(parsed.plan) ? parsed.plan.map((item) => normalizeLongtermPlanItemText(item)).filter(Boolean) : [];
    if (plan.length) {
        nextState.plan = plan;
    }
    if (parsed.task) {
        nextState.task = parsed.task;
    }
    if (parsed.context) {
        nextState.context = String(parsed.context || '').trim();
    }
    if (parsed.summary) {
        nextState.context = [nextState.context, String(parsed.summary || '').trim()].filter(Boolean).join('\n\n').trim();
    }
    const hasStepIndex = Number.isFinite(Number(parsed.step_index)) && Number(parsed.step_index) >= 0;
    const stepIndex = hasStepIndex ? Math.floor(Number(parsed.step_index)) : -1;
    if (parsed.step_title) {
        nextState.step = parsed.step_title;
    } else if (parsed.step_id) {
        nextState.step = parsed.step_id;
    }
    if (parsed.kind === 'longterm_update' && hasStepIndex) {
        const doneIndices = coerceLongtermIndexList(nextState.done_indices || []);
        const status = String(parsed.step_status || '').toLowerCase() || 'done';
        if (status === 'done' || parsed.done) {
            if (!doneIndices.includes(stepIndex)) doneIndices.push(stepIndex);
            nextState.done_indices = doneIndices;
            nextState.current_index = parsed.done
                ? -1
                : getNextPendingLongtermStepIndex(nextState.plan, doneIndices, stepIndex + 1);
        } else if (status === 'active') {
            nextState.current_index = stepIndex;
        } else if (status === 'pending') {
            nextState.current_index = stepIndex;
        }
        const visibleIndex = Number.isFinite(Number(nextState.current_index)) && Number(nextState.current_index) >= 0
            ? Math.floor(Number(nextState.current_index))
            : stepIndex;
        const visibleStep = String(nextState.plan[visibleIndex] || nextState.plan[stepIndex] || '').trim();
        if (visibleStep) {
            nextState.step = visibleStep;
        }
    }
    if (!nextState.step && hasStepIndex) {
        nextState.step = String(nextState.plan[stepIndex] || '').trim();
    }
    if (!nextState.step && Number.isFinite(Number(nextState.current_index)) && nextState.current_index >= 0) {
        nextState.step = String(nextState.plan[Math.floor(Number(nextState.current_index))] || '').trim();
    }
    if (parsed.done) {
        nextState.active = false;
        if (hasStepIndex) {
            const doneIndices = coerceLongtermIndexList(nextState.done_indices || []);
            if (!doneIndices.includes(stepIndex)) doneIndices.push(stepIndex);
            nextState.done_indices = doneIndices;
        }
    } else {
        nextState.active = currentConversationMode === 'longterm' || nextState.active;
    }
    currentConversationLongtermAutoContinueKind = '';
    currentConversationLongtermState = normalizeLongtermState(nextState);
    renderLongtermPlanPanel();
    if (currentConversationId) {
        syncLocalConversationModeFlags(currentConversationId, {
            conversation_mode: 'longterm',
            longterm_active: currentConversationLongtermState.active,
            longterm_current_index: currentConversationLongtermState.current_index,
            longterm_done_indices: currentConversationLongtermState.done_indices,
            longterm: currentConversationLongtermState
        });
    }
    const messageDiv = source && source.messageDiv && source.messageDiv.isConnected ? source.messageDiv : null;
    if (messageDiv) {
        upsertLongtermPlanHookBlock(messageDiv, parsed, source);
    }
    return parsed;
}

function syncConversationModeFromConversation(conversation) {
    const conv = (conversation && typeof conversation === 'object') ? conversation : {};
    const mode = String(conv.conversation_mode || 'chat').trim().toLowerCase();
    currentConversationSidebarScope = resolveConversationSidebarScope(conv);
    currentConversationMode = mode === 'longterm'
        ? 'longterm'
        : (currentConversationSidebarScope === 'learning' ? 'learning' : 'chat');
    currentConversationLongtermState = normalizeLongtermState(conv.longterm);
    currentConversationLongtermAutoContinueKind = '';
    currentConversationLongtermConfirmationInFlight = false;
    if (currentConversationMode !== 'longterm') {
        currentConversationLongtermState.active = false;
    } else if (els.longtermPlanPanel) {
        els.longtermPlanPanel.dataset.collapsed = '1';
        els.longtermPlanPanel.classList.add('collapsed');
    }
    renderLongtermPlanPanel();
    return currentConversationMode;
}

function syncLocalConversationModeFlags(conversationId, fields = {}) {
    const cid = String(conversationId || '').trim();
    if (!cid || !Array.isArray(conversationListCache)) return;
    const mode = String(fields.conversation_mode || '').trim().toLowerCase();
    const longterm = normalizeLongtermState(fields.longterm);
    conversationListCache = conversationListCache.map((item) => {
        const src = (item && typeof item === 'object') ? item : {};
        const itemId = String(src.conversation_id || src.id || '').trim();
        if (itemId !== cid) return src;
        const next = { ...src };
        if (mode) next.conversation_mode = mode;
        if (Object.keys(fields).includes('longterm_active')) {
            next.longterm_active = !!fields.longterm_active;
        }
        if (longterm.task) next.longterm_task = longterm.task;
        if (longterm.step) next.longterm_step = longterm.step;
        if (Object.keys(fields).includes('longterm_done_indices')) next.longterm_done_indices = longterm.done_indices;
        if (Object.keys(fields).includes('longterm_current_index')) next.longterm_current_index = longterm.current_index;
        return next;
    });
    renderConversationList(conversationListCache);
}

function formatLongtermPlanList(plan, state = {}) {
    const arr = Array.isArray(plan) ? plan : [];
    if (!arr.length) return '<div class="longterm-plan-empty">暂无计划，等待模型生成。</div>';
    const items = arr.map((item, index) => {
        const text = sanitizeLongtermPlanText(item);
        const status = normalizeLongtermPlanStatus(item, { ...state, __index: index });
        return `<li class="longterm-plan-item longterm-plan-item-${status}" data-status="${status}"><span class="longterm-plan-item-status longterm-plan-item-status-${status}">${renderLongtermPlanItemStatusIcon(status)}</span><span class="longterm-plan-item-text">${escapeHtml(text)}</span></li>`;
    }).join('');
    return `<ul class="longterm-plan-list">${items}</ul>`;
}

function formatLongtermPlanSummary(plan, maxItems = 3) {
    const arr = Array.isArray(plan) ? plan.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (!arr.length) return '<span class="longterm-plan-summary-empty">等待规划点</span>';
    const shown = arr.slice(0, Math.max(1, Number(maxItems) || 3));
    const chips = shown.map((item) => `<span class="longterm-plan-summary-chip">${escapeHtml(item)}</span>`).join('');
    const more = arr.length > shown.length ? `<span class="longterm-plan-summary-more">+${arr.length - shown.length}</span>` : '';
    return `<div class="longterm-plan-summary-row">${chips}${more}</div>`;
}

function upsertLongtermPlanHookBlock(messageDiv, parsed, source = {}) {
    const target = messageDiv && messageDiv.isConnected ? messageDiv : null;
    if (!target) return null;
    const content = target.querySelector('.message-content');
    if (!content) return null;
    const sourceTag = String(source && source.source ? source.source : 'stream').trim().toLowerCase();
    const isLiveSource = /(^|[-_])(live|stream)([-_]|$)/.test(sourceTag) || sourceTag === 'stream';

    const planItems = Array.isArray(parsed && parsed.plan)
        ? parsed.plan.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const title = String((parsed && parsed.kind) === 'longterm_update' ? '模型已完成 longterm 任务' : '模型已生成 longterm 计划').trim();
    const hookPayload = {
        mode: 'longterm',
        title,
        kind: String(parsed && parsed.kind ? parsed.kind : 'longterm_plan').trim(),
        step_index: Number.isFinite(Number(parsed && parsed.step_index)) ? Number(parsed.step_index) : -1,
        step_no: Number.isFinite(Number(parsed && parsed.step_no)) ? Number(parsed.step_no) : -1,
        step_id: String(parsed && parsed.step_id ? parsed.step_id : '').trim(),
        step_title: String(parsed && parsed.step_title ? parsed.step_title : '').trim(),
        step_status: String(parsed && parsed.step_status ? parsed.step_status : '').trim(),
        prompt: {
            plan: planItems,
            text: String((parsed && parsed.summary) || (parsed && parsed.context) || '')
        },
        details: {
            plan: planItems,
            task: String(parsed && parsed.task ? parsed.task : '').trim(),
            context: String(parsed && parsed.context ? parsed.context : '').trim(),
            step_index: Number.isFinite(Number(parsed && parsed.step_index)) ? Number(parsed.step_index) : -1,
            step_no: Number.isFinite(Number(parsed && parsed.step_no)) ? Number(parsed.step_no) : -1,
            step_id: String(parsed && parsed.step_id ? parsed.step_id : '').trim(),
            step_title: String(parsed && parsed.step_title ? parsed.step_title : '').trim(),
            step_status: String(parsed && parsed.step_status ? parsed.step_status : '').trim(),
            source: String(source && source.source ? source.source : 'stream')
        }
    };

    const freshBlock = renderLongtermHookBlock(hookPayload);
    freshBlock.dataset.longtermPlan = '1';
    freshBlock.dataset.longtermPlanSource = String(source && source.source ? source.source : 'stream');
    freshBlock.dataset.streamLive = isLiveSource ? '1' : '0';

    const existing = target.__longtermPlanHookBlock || target.querySelector('.longterm-hook-block[data-longterm-plan="1"]');
    if (existing && existing.isConnected) {
        existing.replaceWith(freshBlock);
    } else {
        const body = content.querySelector('.content-body');
        if (body && body.parentNode === content) {
            if (body.nextSibling) content.insertBefore(freshBlock, body.nextSibling);
            else body.insertAdjacentElement('afterend', freshBlock);
        } else {
            content.appendChild(freshBlock);
        }
    }
    target.__longtermPlanHookBlock = freshBlock;

    if (isLiveSource && parsed) {
        const cleanedText = String((parsed.summary || parsed.context || parsed.task || '') || '');
        const liveBodies = content.querySelectorAll('.content-body[data-stream-live="1"]');
        liveBodies.forEach((body) => {
            body.innerHTML = renderStreamingMarkdownWithNewTabLinks(cleanedText, {
                streamingMathProvisional: true
            });
            bindSourceMarkdown(body, cleanedText);
            highlightCode(body);
            body.dataset.streamLive = '1';
            body.dataset.streamRaw = cleanedText;
        });
    }

    return freshBlock;
}

function renderLongtermPlanPanel() {
    const panel = els.longtermPlanPanel;
    if (!panel) return;
    const state = normalizeLongtermState(currentConversationLongtermState);
    const completedAll = Array.isArray(state.plan) && state.plan.length > 0 && coerceLongtermIndexList(state.done_indices || []).length >= state.plan.length;
    const hasLongtermState = currentConversationMode === 'longterm'
        || state.active
        || !!state.task
        || (Array.isArray(state.plan) && state.plan.length > 0)
        || !!(state.hook && Object.keys(state.hook).length);
    panel.classList.toggle('visible', hasLongtermState);
    panel.style.display = hasLongtermState ? '' : 'none';
    panel.dataset.mode = hasLongtermState ? 'longterm' : 'chat';
    panel.dataset.active = state.active ? '1' : '0';
    panel.dataset.tempExpanded = '0';
    panel.classList.toggle('collapsed', panel.dataset.collapsed === '1' ? true : false);
    const statusEl = els.longtermPlanStatus;
    const taskEl = els.longtermPlanTask;
    const bodyEl = els.longtermPlanBody;
    if (statusEl) {
        statusEl.textContent = completedAll ? '已完成' : (state.active ? '执行中' : '已启用');
    }
    if (taskEl) {
        const taskText = state.task || '等待任务说明';
        const collapsedSummary = formatLongtermPlanSummary(state.plan);
        if (panel.classList.contains('collapsed')) {
            taskEl.innerHTML = collapsedSummary;
            taskEl.title = state.plan.length ? state.plan.join(' · ') : taskText;
        } else {
            taskEl.textContent = taskText;
            taskEl.title = taskText;
        }
    }
    if (bodyEl) {
        const planHtml = formatLongtermPlanList(state.plan, state);
        const hookJson = state.hook && Object.keys(state.hook).length ? JSON.stringify(state.hook, null, 2) : '';
        const contextHtml = state.context
            ? `<div class="longterm-plan-context"><div class="longterm-panel-section-title">Context</div><div class="longterm-plan-context-text">${escapeHtml(state.context)}</div></div>`
            : '';
        bodyEl.innerHTML = `
            ${planHtml}
            ${state.step ? `<div class="longterm-plan-current"><span class="longterm-plan-current-label">当前步骤</span><span class="longterm-plan-current-text">${escapeHtml(state.step)}</span></div>` : ''}
            ${contextHtml}
            <div class="longterm-panel-section">
                <div class="longterm-panel-section-title">Hook</div>
                <div class="longterm-hook-summary">${escapeHtml((state.hook && state.hook.title) || '模型等待生成计划')}</div>
                ${hookJson ? `<pre class="longterm-hook-json">${escapeHtml(hookJson)}</pre>` : '<div class="longterm-plan-empty">暂无 Hook 记录。</div>'}
            </div>
        `;
    }
}

function setLongtermMode(active, state = {}) {
    currentConversationMode = active ? 'longterm' : 'chat';
    currentConversationLongtermState = normalizeLongtermState({
        ...currentConversationLongtermState,
        ...(state || {}),
        active: !!active
    });
    if (!active) {
        currentConversationLongtermAutoContinueKind = '';
        currentConversationLongtermConfirmationInFlight = false;
    }
    if (active && els.longtermPlanPanel) {
        els.longtermPlanPanel.dataset.collapsed = '1';
        els.longtermPlanPanel.classList.add('collapsed');
    }
    renderLongtermPlanPanel();
}

function resetCurrentConversationLongtermStateForNewConversation(resolvedMode) {
    currentConversationMode = String(resolvedMode || 'chat').trim() || 'chat';
    currentConversationLongtermState = {
        active: false,
        task: '',
        plan: [],
        context: '',
        hook: {}
    };
    currentConversationLongtermAutoContinueKind = '';
    currentConversationLongtermConfirmationInFlight = false;
    renderLongtermPlanPanel();
}

function resetLearningStateForNewConversation(resolvedMode, preserveLearningMainPanel) {
    const normalizedMode = String(resolvedMode || '').trim().toLowerCase();
    currentConversationSidebarScope = normalizedMode === 'learning' ? 'learning' : 'nexora';
    learningHeaderMode = normalizedMode === 'learning' ? 'learning' : 'chat';
    learningWelcomeMounted = false;

    if (!preserveLearningMainPanel) {
        learningMainMounted = false;
    }
}

function resetTokenUiForNewConversation() {
    tokenMiniState.baseInput = 0;
    tokenMiniState.baseOutput = 0;
    resetTokenMiniStreamPart();
    tokenBudgetState.roundInput = 0;
    resetTokenBudgetBreakdown();
    applyTokenMiniDisplay(0, 0);
    renderTokenBudgetUi();
}

function pushNewConversationHistory() {
    if (window.history.pushState) {
        window.history.pushState({}, '', '/chat');
    }
}

function getWorkspaceFunctionForConversationLoad(name) {
    const functionName = String(name || '').trim();
    const fn = functionName ? window[functionName] : null;

    if (typeof fn !== 'function') {
        throw new Error(`workspace.js 未初始化，缺少 ${functionName}`);
    }

    return fn;
}

function resetWorkspaceReadonlyConversationStateForConversationLoad() {
    return getWorkspaceFunctionForConversationLoad('resetWorkspaceReadonlyConversationState')();
}

function captureWorkspaceDetailInputHomeForConversationLoad() {
    return getWorkspaceFunctionForConversationLoad('captureWorkspaceDetailInputHome')();
}

function restoreWorkspaceDetailInputContainerForConversationLoad() {
    return getWorkspaceFunctionForConversationLoad('restoreWorkspaceDetailInputContainer')();
}

function normalizeWorkspaceConversationHeaderContextForConversationLoad(context) {
    return getWorkspaceFunctionForConversationLoad('normalizeWorkspaceConversationHeaderContext')(context);
}

function renderWorkspaceConversationHierarchyForConversationLoad(context) {
    return getWorkspaceFunctionForConversationLoad('renderWorkspaceConversationHierarchy')(context);
}

function selectWorkspaceProjectForConversationLoad(workspaceId, options = {}) {
    return getWorkspaceFunctionForConversationLoad('selectWorkspaceProject')(workspaceId, options);
}

function clearWorkspaceHierarchySlotForConversationLoad() {
    return getWorkspaceFunctionForConversationLoad('clearWorkspaceHierarchySlot')();
}

function resetKnowledgeNavigationForConversationLoad() {
    navigationStack = [];
    currentSearchQuery = '';
    knowledgeEditorController.clearCurrentTitle();
    knowledgeEditorController.clearWorkspaceReturnContext();
    knowledgeEditorController.clearPendingHighlightData();
    originalHeaderState = null;
    cachedPuzzleStates = {};
}

function setLearningHeaderModeForConversationLoad() {
    learningHeaderMode = isLearningReaderHostActive() ? 'learning' : 'chat';
}

function resetTurnIndicatorForConversationLoad() {
    const turnIndicatorLines = document.getElementById('turnIndicatorLines');

    if (turnIndicatorLines) {
        turnIndicatorLines.innerHTML = '';
        turnIndicatorLines._turnsData = null;
    }

    turnIndicatorState.userMessages = [];
    turnIndicatorState.fullConversationId = '';
    turnIndicatorState.hasFullTurnList = false;
    turnIndicatorState.turnLoadToken += 1;
    hideTurnListPopup();
}

function resetTokenUiForConversationLoad(conversationId) {
    tokenMiniState.conversationId = String(conversationId || '').trim();
    tokenMiniState.baseInput = 0;
    tokenMiniState.baseOutput = 0;
    resetTokenMiniStreamPart();
    tokenBudgetState.roundInput = 0;
    resetTokenBudgetBreakdown();
    renderTokenMiniFromState();
}

function pushConversationHistory(conversationId) {
    const cid = String(conversationId || '').trim();

    if (!cid) {
        return;
    }

    if (window.history.pushState) {
        window.history.pushState({}, '', `/chat?cid=${cid}`);
    }
}

async function createNewConversation(silent = false, targetMode = null, options = {}) {
    const normalizedTargetMode = String(targetMode || '').trim().toLowerCase();

    if (!silent && (normalizedTargetMode === 'learning'
        || (!normalizedTargetMode && learningSidebarMode === 'learning'))) {
        enterLearningSidebarConversationView();
    }

    return conversationNavigationController.createNewConversation(silent, targetMode, options);
}

async function loadConversation(id, options = {}) {
    prepareLearningReaderForConversationNavigation(id);
    const preparedLoad = conversationNavigationController.prepareConversationLoad(id, options);

    if (!preparedLoad || preparedLoad.useCurrentRunningPanel) {
        return;
    }

    const targetConversationId = preparedLoad.conversationId;
    const deferStreamAttach = !!preparedLoad.deferStreamAttach;
    const navToken = preparedLoad.navToken;

    try {
        const loadedConversation = await conversationNavigationController.loadConversationDetailWithStreamState(preparedLoad);

        if (!loadedConversation || !loadedConversation.active) return;

        const data = loadedConversation.data;
        
        if (data.success && data.conversation) {
            // 缓存服务端 puzzle 状态
            cachedPuzzleStates = (data.conversation.puzzle_states && typeof data.conversation.puzzle_states === 'object')
                ? data.conversation.puzzle_states : {};
            refreshConversationImageHistoryFlag(data.conversation.messages || []);
            const loadedConversationMode = syncConversationModeFromConversation(data.conversation);
            syncLearningReaderForConversationScope(currentConversationSidebarScope);
            rememberSidebarConversationSelection(currentConversationSidebarScope, targetConversationId);
            const loadedSidebarMode = currentConversationSidebarScope === 'learning'
                ? 'learning'
                : resolveLearningSidebarModeForConversation(loadedConversationMode);
            syncLearningSidebarViewForLoadedConversation(currentConversationSidebarScope);
            applyLearningSidebarMode(loadedSidebarMode);
            learningHeaderMode = loadedSidebarMode === 'learning' ? 'learning' : 'chat';
            void syncLearningHeaderMode();
            // Render
            let renderMsgs = Array.isArray(data.conversation.messages) ? data.conversation.messages : [];
            const messageWindow = (data.message_window && typeof data.message_window === 'object')
                ? data.message_window
                : {};
            const renderStartIndexRaw = Number(messageWindow.start_index);
            const renderStartIndex = Number.isFinite(renderStartIndexRaw) && renderStartIndexRaw >= 0
                ? Math.floor(renderStartIndexRaw)
                : 0;
            if (pendingRegenerateFilter.index >= 0
                && pendingRegenerateFilter.conversationId === targetConversationId
                && pendingRegenerateFilter.index >= renderStartIndex
                && pendingRegenerateFilter.index < renderStartIndex + renderMsgs.length) {
                renderMsgs = renderMsgs.slice(0, pendingRegenerateFilter.index - renderStartIndex + 1);
                pendingRegenerateFilter = { conversationId: '', index: -1 };
            }
            const indexedRenderMsgs = setConversationMessageWindowFromPayload(
                targetConversationId,
                renderMsgs,
                {
                    ...messageWindow,
                    start_index: renderStartIndex,
                    end_index: renderStartIndex + renderMsgs.length - 1
                }
            );
            renderMessages(indexedRenderMsgs, false, { instant: true });
            void loadConversationTurnIndicatorList(targetConversationId, navToken);
            applyTokenBudgetFromConversationMessages(data.conversation.messages || []);
            if(els.conversationTitle) els.conversationTitle.textContent = data.conversation.title || "Conversation " + targetConversationId;
            if (!deferStreamAttach) {
                attachRunningStreamToCurrentConversation(targetConversationId);
            }
            void refreshTokenMiniForConversation(targetConversationId);
        } else {
            if (!isActiveConversationNavigation(navToken)) return;
            currentConversationHasImageHistory = false;
            currentConversationMode = 'chat';
            currentConversationLongtermState = {
                active: false,
                task: '',
                plan: [],
                context: '',
                hook: {}
            };
            currentConversationLongtermAutoContinueKind = '';
            currentConversationLongtermConfirmationInFlight = false;
            renderLongtermPlanPanel();
            console.error("Failed to load conversation:", data.message);
            syncLearningReaderForConversationScope('nexora');
            applyLearningSidebarMode('nexora');
            void syncLearningHeaderMode();
            await refreshTokenMiniForConversation(null);
        }
        
        // Update Token Counts (if available in stored data, otherwise calc)
        
        // Load Knowledge
        if (isActiveConversationNavigation(navToken)) {
            loadKnowledge(targetConversationId);
        }
        
        // Highlight in sidebar
        if (isActiveConversationNavigation(navToken)) {
            loadConversations();
        }
        
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (!isActiveConversationNavigation(navToken)) return;
        currentConversationHasImageHistory = false;
        currentConversationMode = 'chat';
        currentConversationLongtermState = {
            active: false,
            task: '',
            plan: [],
            context: '',
            hook: {}
        };
        currentConversationLongtermAutoContinueKind = '';
        currentConversationLongtermConfirmationInFlight = false;
        renderLongtermPlanPanel();
        console.error("Error loading chat", e);
        syncLearningReaderForConversationScope('nexora');
        applyLearningSidebarMode('nexora');
        void syncLearningHeaderMode();
        await refreshTokenMiniForConversation(null);
    }
}

async function deleteConversation(id) {
    return conversationNavigationController.deleteConversation(id);
}

// --- Messaging ---
const sendIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const stopIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>`;

function updateSendButtonState() {
    if (!els.sendBtn) return;
    if (isGenerating) {
        const activeStreamState = getConversationStreamState(currentConversationId);
        const stopping = !!(activeStreamState && activeStreamState.stopping);
        els.sendBtn.disabled = stopping;
        els.sendBtn.classList.add('stop-mode');
        els.sendBtn.classList.remove('feed-mode');
        els.sendBtn.innerHTML = stopIcon;
        els.sendBtn.title = stopping ? "正在终止" : "Stop Generation";
    } else if (isUploadingFiles) {
        els.sendBtn.disabled = true;
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.classList.remove('feed-mode');
        els.sendBtn.innerHTML = sendIcon;
        els.sendBtn.title = "文件上传/向量化进行中";
    } else if (learningFeedComposeMode) {
        els.sendBtn.disabled = !!learningFeedPostInFlight;
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.classList.add('feed-mode');
        els.sendBtn.innerHTML = learningFeedPostInFlight
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-dasharray="42 16" transform="rotate(-90 12 12)"></circle></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        els.sendBtn.title = learningFeedPostInFlight ? "动态发送中" : "发送动态";
    } else {
        els.sendBtn.disabled = false;
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.classList.remove('feed-mode');
        els.sendBtn.innerHTML = sendIcon;
        els.sendBtn.title = "Send Message";
    }
    syncLearningFeedComposerUi();
    scheduleLearningSidebarBridgeNotify(0);
}

const NEXORA_LATENCY_LOG_THRESHOLD_MS = 700;

function createNexoraLatencyProbe(scope, meta = {}) {
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let last = start;
    const marks = [];

    const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    return {
        mark(name, detail = {}) {
            const now = nowMs();
            marks.push({
                name: String(name || '').trim() || 'mark',
                total_ms: Number((now - start).toFixed(1)),
                delta_ms: Number((now - last).toFixed(1)),
                detail: (detail && typeof detail === 'object') ? detail : {}
            });
            last = now;
        },
        flush(reason = 'done', options = {}) {
            const total = nowMs() - start;
            const threshold = Number(options.thresholdMs || NEXORA_LATENCY_LOG_THRESHOLD_MS);
            const force = !!options.force;

            if (!force && total < threshold) {
                return;
            }

            try {
                nexoraLatencyLogger.debug(`[NexoraLatency] ${scope} ${total.toFixed(1)}ms`, {
                    reason,
                    total_ms: Number(total.toFixed(1)),
                    meta,
                    marks
                });
            } catch (_) {}
        }
    };
}

function messageHasImageAttachments(msg) {
    if (!msg || typeof msg !== 'object') return false;
    const metadata = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : null;
    const attachments = metadata && Array.isArray(metadata.attachments) ? metadata.attachments : [];
    if (!attachments.length) return false;
    return attachments.some((att) => {
        if (!att || typeof att !== 'object') return false;
        const type = String(att.type || '').toLowerCase();
        if (type && type !== 'image') return false;
        const assetId = String(att.asset_id || '').trim();
        const assetUrl = String(att.asset_url || '').trim();
        const url = String(att.url || '').trim();
        if (assetId || assetUrl) return true;
        if (!url) return false;
        if (url.startsWith('data:image/')) return true;
        if (/^https?:\/\//i.test(url)) return true;
        if (/\/api\/conversations\/[^/]+\/assets\/[^/?#]+/i.test(url)) return true;
        return false;
    });
}

function conversationHasImageHistory(messages) {
    if (!Array.isArray(messages) || !messages.length) return false;
    return messages.some((msg) => messageHasImageAttachments(msg));
}

function getMessageElementByIndex(index, role = '') {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return null;
    const safeRole = String(role || '').trim();
    const roleSelector = safeRole ? `.${safeRole}` : '';
    return document.querySelector(`.message${roleSelector}[data-index="${Math.floor(idx)}"]`);
}

function buildAttachmentsPayloadFromMessage(msg) {
    const result = {
        file_ids: [],
        sandbox_paths: [],
        user_attachments: [],
        has_image: false
    };
    const metadata = (msg && msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : null;
    const attachments = metadata && Array.isArray(metadata.attachments) ? metadata.attachments : [];
    const seenFileUrls = new Set();
    const seenSandboxPaths = new Set();

    for (const att of attachments) {
        if (!att || typeof att !== 'object') continue;
        const type = String(att.type || '').trim().toLowerCase();
        const name = String(att.name || 'attachment').trim();
        const size = Number(att.size || 0);
        const mime = String(att.mime || '').trim();

        if (type === 'image' || type === 'image_url') {
            const url = String(att.asset_url || att.url || '').trim();
            if (!url) continue;
            const key = `${name}|${mime}|${url}`;
            if (!seenFileUrls.has(key)) {
                seenFileUrls.add(key);
                result.file_ids.push({
                    type: 'image_url',
                    url,
                    name,
                    mime
                });
            }
            result.has_image = true;
            continue;
        }

        if (type === 'sandbox_file') {
            const sandboxPath = String(att.sandbox_path || '').trim();
            if (sandboxPath && !seenSandboxPaths.has(sandboxPath)) {
                seenSandboxPaths.add(sandboxPath);
                result.sandbox_paths.push(sandboxPath);
            }
            result.user_attachments.push({
                type: 'sandbox_file',
                name,
                sandbox_path: sandboxPath,
                size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0
            });
            continue;
        }

        if (type === 'text') {
            result.user_attachments.push({
                type: 'text',
                name,
                size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0
            });
            continue;
        }

        const storedPath = String(att.stored_path || '').trim();
        const sandboxPath = String(att.sandbox_path || '').trim();
        const nextItem = {
            type: type || 'file',
            name,
            size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0
        };
        if (sandboxPath) nextItem.sandbox_path = sandboxPath;
        if (storedPath) nextItem.stored_path = storedPath;
        result.user_attachments.push(nextItem);
    }

    return result;
}

function refreshConversationImageHistoryFlag(messages) {
    currentConversationHasImageHistory = conversationHasImageHistory(messages);
}

async function ensureSelectedModelReady() {
    const current = String(selectedModelId || '').trim();
    if (current) return current;
    try {
        await loadModels();
    } catch (_) {
        // ignore and use best effort below
    }
    const next = String(selectedModelId || '').trim();
    if (next) return next;
    const fallbackModel = Array.isArray(modelCatalog)
        ? modelCatalog.find((m) => m && String(m.id || '').trim())
        : null;
    if (fallbackModel) {
        const fallbackId = String(fallbackModel.id || '').trim();
        if (fallbackId) {
            selectedModelId = fallbackId;
            try { localStorage.setItem('selectedModel', fallbackId); } catch (_) {}
            if (els.currentModelDisplay) {
                els.currentModelDisplay.innerHTML = renderCurrentModelDisplayHtml(fallbackModel);
            }
            return fallbackId;
        }
    }
    return '';
}

async function readErrorMessageFromResponse(response, fallback = '') {
    let errMsg = String(fallback || `HTTP ${response ? response.status : ''}`).trim() || '请求失败';
    if (!response) return errMsg;
    try {
        const data = await response.clone().json();
        if (data && typeof data === 'object') {
            const m = String(data.message || data.error || '').trim();
            if (m) return m;
        }
    } catch (_) {}
    try {
        const text = String(await response.clone().text() || '').trim();
        if (text) {
            errMsg = text.length > 180 ? `${text.slice(0, 180)}...` : text;
        }
    } catch (_) {}
    return errMsg;
}

function isLikelyRetryableNetworkErrorText(message) {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return (
        text.includes('failed to fetch')
        || text.includes('network')
        || text.includes('timeout')
        || text.includes('connection')
        || text.includes('err_connection')
        || text.includes('err_socket')
        || text.includes('incomplete chunked read')
        || text.includes('stream body is empty')
    );
}

function isSseResponse(response) {
    const contentType = String((response && response.headers && response.headers.get('content-type')) || '').toLowerCase();
    return contentType.includes('text/event-stream');
}

function createLearningCardNode(card) {
    const payload = (card && typeof card === 'object') ? card : {};
    const html = String(payload.html || '').trim();
    if (!html) return null;
    const wrap = document.createElement('div');
    wrap.className = 'learning-chat-card-wrap';
    wrap.innerHTML = html;
    return wrap;
}

function buildQuestionIdentityHash(sourceText) {
    const src = String(sourceText || '');
    let hash = 2166136261;

    for (let i = 0; i < src.length; i += 1) {
        hash ^= src.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function buildQuestionCardId(payload, options = {}) {
    const explicitCardId = String((options && options.cardId) || '').trim();

    if (explicitCardId) {
        return explicitCardId;
    }

    const requestCardId = String((payload && payload.question_card_id) || '').trim();

    if (requestCardId) {
        return requestCardId;
    }

    const persistentQuestionId = String((payload && payload.question_id) || '').trim();

    if (persistentQuestionId) {
        return persistentQuestionId;
    }

    const choices = Array.isArray(payload && payload.choices)
        ? payload.choices.map((choice) => String(choice || '').trim()).filter(Boolean)
        : [];
    const identityParts = [
        String((payload && payload.question_title) || '').trim(),
        String((payload && payload.question_content) || '').trim(),
        choices.join('\n'),
        String((payload && payload.allow_other) !== false)
    ];

    // 一次性 question 没有后端 question_id，需要用内容生成稳定 ID，避免刷新后重新开放作答。
    return `question_${buildQuestionIdentityHash(identityParts.join('\n---\n'))}`;
}

function normalizeQuestionPermissionRequest(value) {
    if (!value || typeof value !== 'object') return null;

    const path = String(value.path || '').trim();
    const operation = String(value.operation || value.access || '').trim().toLowerCase();
    const scope = String(value.scope || '').trim().toLowerCase();
    const reason = String(value.reason || '').trim();

    if (!path || !reason) return null;
    if (!['read', 'write', 'read_write'].includes(operation)) return null;
    if (!['file', 'dir'].includes(scope)) return null;

    return {
        path,
        operation,
        scope,
        reason,
        sensitive: !!value.sensitive
    };
}

const MAX_PENDING_PERMISSION_CARDS = 1;

function buildPermissionRequestIdentity(permissionRequest) {
    const request = normalizeQuestionPermissionRequest(permissionRequest);
    if (!request) return '';

    const rawPath = String(request.path || '').trim();
    let normalizedPath = rawPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (/^[a-z]:\//i.test(normalizedPath) || rawPath.startsWith('\\\\')) {
        normalizedPath = normalizedPath.toLocaleLowerCase('en-US');
    }

    const identity = [normalizedPath, request.operation, request.scope].join('\n');
    return `permission_${buildQuestionIdentityHash(identity)}`;
}

function readQuestionCardGroupKey(questionCard) {
    if (!questionCard) return '';

    const stored = String((questionCard.dataset && questionCard.dataset.questionGroupKey) || '').trim();
    if (stored) return stored;

    const body = questionCard.querySelector('.question-card-body');
    const cardId = String((body && body.dataset && body.dataset.questionCardId) || '').trim();
    return cardId ? `question_${cardId}` : '';
}

function findQuestionCardsByGroupKey(groupKey) {
    const key = String(groupKey || '').trim();
    if (!key || !els.messagesContainer) return [];

    return Array.from(els.messagesContainer.querySelectorAll('.question-tool-card')).filter((card) => (
        readQuestionCardGroupKey(card) === key
    ));
}

function setQuestionCardGroupSubmitting(questionCard, submitting) {
    const groupKey = readQuestionCardGroupKey(questionCard);
    const cards = groupKey ? findQuestionCardsByGroupKey(groupKey) : [questionCard].filter(Boolean);

    cards.forEach((card) => {
        const resolved = String(card.dataset.resolved || '').trim().toLowerCase() === 'true';
        card.dataset.submitting = submitting ? 'true' : 'false';
        card.querySelectorAll('button, input, textarea').forEach((control) => {
            control.disabled = !!submitting || resolved;
        });

        const pill = card.querySelector('.question-card-pill');
        if (pill && !resolved) {
            const isPermissionCard = String(card.dataset.toolName || '') === 'ask_for_permission';
            pill.textContent = submitting
                ? 'Submitting...'
                : (isPermissionCard ? 'Awaiting permission' : 'Awaiting answer');
        }
    });
}

function removeOtherPendingPermissionCards(activeGroupKey) {
    if (!els.messagesContainer) return;

    const pendingCards = Array.from(els.messagesContainer.querySelectorAll('.question-tool-card')).filter((card) => {
        const isPermissionCard = String(card.dataset.toolName || '') === 'ask_for_permission';
        const isPending = String(card.dataset.pending || '').trim().toLowerCase() === 'true';
        const isResolved = String(card.dataset.resolved || '').trim().toLowerCase() === 'true';
        return isPermissionCard && isPending && !isResolved;
    });
    const keepCount = Math.max(0, MAX_PENDING_PERMISSION_CARDS - 1);
    const removable = pendingCards.filter((card) => readQuestionCardGroupKey(card) !== activeGroupKey);

    removable.slice(0, Math.max(0, removable.length - keepCount)).forEach((card) => {
        console.warn('[QuestionTool] removing stale pending permission card', {
            removed_group_key: readQuestionCardGroupKey(card),
            active_group_key: activeGroupKey,
        });
        card.remove();
    });
}

function getQuestionCardPermissionRequest(questionCard) {
    if (!questionCard) return null;

    const raw = String((questionCard.dataset && questionCard.dataset.permissionRequest) || '').trim();
    if (!raw) return null;

    try {
        return normalizeQuestionPermissionRequest(JSON.parse(raw));
    } catch (err) {
        console.warn('[QuestionTool] invalid permission request payload', err);
        return null;
    }
}

function isPermissionDenyAnswer(answerText) {
    const text = String(answerText || '').trim();
    return text.includes('拒绝') || /^deny\b/i.test(text);
}

function isPermissionAllowAnswer(answerText) {
    const text = String(answerText || '').trim();
    return text.includes('允许') || text.includes('同意') || /^allow\b/i.test(text);
}

async function resolvePermissionQuestionSubmission(questionCard, answerText) {
    const permissionRequest = getQuestionCardPermissionRequest(questionCard);

    if (!permissionRequest) {
        return { success: true, answer: String(answerText || '').trim() };
    }

    if (isPermissionDenyAnswer(answerText)) {
        return { success: true, answer: '已拒绝本次访问权限' };
    }

    if (!isPermissionAllowAnswer(answerText)) {
        return { success: false, message: '请选择允许或拒绝访问' };
    }

    const conversationId = String(currentConversationId || '').trim();

    if (!conversationId) {
        return { success: false, message: '当前对话 ID 为空，无法写入临时授权' };
    }

    try {
        const res = await fetch('/api/agent/permission/grant', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: conversationId,
                permission_request: permissionRequest
            })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data || data.success === false) {
            return {
                success: false,
                message: String((data && data.message) || '写入临时授权失败').trim()
            };
        }

        if (typeof showToast === 'function') {
            showToast(String(data.message || '已允许本次对话临时访问该路径'));
        }

        return {
            success: true,
            answer: `已允许本次对话临时访问：${permissionRequest.path}`
        };
    } catch (err) {
        return {
            success: false,
            message: String((err && err.message) || err || '写入临时授权失败')
        };
    }
}

function createQuestionCardNode(question, options = {}) {
    const payload = (question && typeof question === 'object') ? question : {};
    const wrap = document.createElement('div');
    wrap.className = 'question-tool-card';
    wrap.dataset.pending = 'true';
    wrap.dataset.resolved = 'false';
    const permissionRequest = normalizeQuestionPermissionRequest(payload.permission_request);
    const isPermissionCard = !!permissionRequest;
    wrap.dataset.toolName = isPermissionCard ? 'ask_for_permission' : 'question';
    if (permissionRequest) {
        wrap.dataset.permissionRequest = JSON.stringify(permissionRequest);
    }
    const title = escapeHtml(String(payload.question_title || 'Question').trim());
    const content = escapeHtml(String(payload.question_content || '').trim());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const allowOther = payload.allow_other !== false;
    const persistentQuestionId = String(payload.question_id || '').trim();
    const cardId = buildQuestionCardId(payload, options);
    const questionGroupKey = `question_${cardId}`;
    const permissionIdentity = buildPermissionRequestIdentity(permissionRequest);
    const cardIdAttr = escapeHtml(cardId);
    const persistentQuestionAttr = persistentQuestionId ? ` data-question-id="${escapeHtml(persistentQuestionId)}"` : '';
    wrap.dataset.questionCardId = cardId;
    wrap.dataset.questionGroupKey = questionGroupKey;
    if (permissionIdentity) {
        wrap.dataset.permissionIdentity = permissionIdentity;
    }
    if (persistentQuestionId) {
        wrap.dataset.questionId = persistentQuestionId;
    }
    const choicesHtml = choices.map((choice, index) => {
        const safeChoice = String(choice || '').trim();
        return `<button class="question-choice-btn" data-question-card-id="${cardIdAttr}" data-choice-index="${index}" data-choice-value="${escapeHtml(safeChoice)}">${escapeHtml(safeChoice)}</button>`;
    }).join('');
    wrap.innerHTML = `
        <div class="question-card-body" data-question-card-id="${cardIdAttr}"${persistentQuestionAttr}>
            <div class="question-card-topline">
                <div class="question-card-kicker">${isPermissionCard ? 'PERMISSION' : 'QUESTION'}</div>
                <div class="question-card-pill">${isPermissionCard ? 'Awaiting permission' : 'Awaiting answer'}</div>
            </div>
            <div class="question-card-title">${title}</div>
            <div class="question-card-content">${content}</div>
            ${choices.length ? `<div class="question-card-choices">${choicesHtml}</div>` : ''}
            ${allowOther ? `
            <div class="question-card-other">
                <input class="question-other-input" type="text" placeholder="其他" data-question-card-id="${cardIdAttr}">
                <button class="question-other-submit" data-question-card-id="${cardIdAttr}">提交</button>
            </div>` : ''}
        </div>
    `;
    wrap.querySelectorAll('.question-choice-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            await submitQuestionAnswer(btn.dataset.choiceValue || btn.textContent || '', wrap);
        });
    });
    const submit = wrap.querySelector('.question-other-submit');
    const input = wrap.querySelector('.question-other-input');
    if (submit && input) {
        submit.addEventListener('click', async () => {
            await submitQuestionAnswer(input.value || '', wrap);
        });
        input.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                await submitQuestionAnswer(input.value || '', wrap);
            }
        });
    }
    return wrap;
}

function createPuzzleCardNode(puzzle, options = {}) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.createPuzzleCardNode === 'function') {
        return api.createPuzzleCardNode(puzzle, {
            ...options,
            frontendUrl: NEXORA_LEARNING_FRONTEND_URL,
            username: currentUsername,
        });
    }
    return null;
}

function resolvePuzzleCardId(payload, step, messageDiv) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.resolvePuzzleCardId === 'function') {
        return api.resolvePuzzleCardId(payload, step, messageDiv);
    }
    return `puzzle_fallback_${Date.now()}`;
}

function applyQuestionAnswer(questionCard, answerText) {
    if (!questionCard) return;
    const body = questionCard.querySelector('.question-card-body');
    const finalAnswer = String(answerText || '').trim();
    if (body) {
        body.classList.add('answered');
        const controls = body.querySelectorAll('button, input, textarea');
        controls.forEach((el) => {
            el.disabled = true;
        });
        let answer = body.querySelector('.question-card-answer');
        if (!answer) {
            answer = document.createElement('div');
            answer.className = 'question-card-answer';
            body.appendChild(answer);
        }
        answer.dataset.answer = finalAnswer;
        answer.textContent = `Your answer: ${finalAnswer}`;
        const pill = body.querySelector('.question-card-pill');
        if (pill) pill.textContent = 'Answered';
    }
    questionCard.dataset.pending = 'false';
    questionCard.dataset.resolved = 'true';
}

function applyPuzzleAnswer(puzzleCard, orderedSteps) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.applyPuzzleAnswer === 'function') {
        return api.applyPuzzleAnswer(puzzleCard, orderedSteps);
    }
}

async function submitQuestionAnswer(answerText, questionCard = null) {
    const finalAnswer = String(answerText || '').trim();
    if (!finalAnswer) return;
    if (questionCard) {
        const groupKey = readQuestionCardGroupKey(questionCard);
        const groupCards = groupKey ? findQuestionCardsByGroupKey(groupKey) : [questionCard];
        const groupBusy = groupCards.some((card) => {
            const cardState = String(card.dataset.resolved || '').trim().toLowerCase();
            const submitState = String(card.dataset.submitting || '').trim().toLowerCase();
            const answered = !!card.querySelector('.question-card-body.answered');
            return cardState === 'true' || submitState === 'true' || answered;
        });
        if (groupBusy) return;
        setQuestionCardGroupSubmitting(questionCard, true);
    }
    const body = questionCard ? questionCard.querySelector('.question-card-body') : null;
    const questionCardId = String((body && body.dataset && body.dataset.questionCardId) || '').trim();
    const persistentQuestionId = String((body && body.dataset && body.dataset.questionId) || '').trim();
    const payload = questionCard ? {
        question_card_id: questionCardId,
        question_id: persistentQuestionId,
        question_title: String((questionCard.querySelector('.question-card-title') || {}).textContent || '').trim(),
        question_content: String((questionCard.querySelector('.question-card-content') || {}).textContent || '').trim(),
        choices: Array.from(questionCard.querySelectorAll('.question-choice-btn'))
            .map((btn) => String((btn.dataset && btn.dataset.choiceValue) || btn.textContent || '').trim())
            .filter(Boolean),
    } : {};
    const streamReady = await waitForQuestionResponseStreamIdle(currentConversationId);

    if (!streamReady) {
        if (questionCard) setQuestionCardGroupSubmitting(questionCard, false);
        if (typeof showToast === 'function') {
            showToast('上一条回复仍在收尾，请稍后重试');
        }
        return;
    }

    const permissionSubmission = await resolvePermissionQuestionSubmission(questionCard, finalAnswer);

    if (!permissionSubmission.success) {
        if (questionCard) setQuestionCardGroupSubmitting(questionCard, false);

        if (typeof showToast === 'function') {
            showToast(permissionSubmission.message || '权限授权失败');
        }

        return;
    }

    const answerForMessage = String(permissionSubmission.answer || finalAnswer).trim();
    if (payload.question_card_id) {
        rememberLockedQuestion(payload.question_card_id, answerForMessage);
    }
    if (questionCard) {
        const groupKey = readQuestionCardGroupKey(questionCard);
        const groupCards = groupKey ? findQuestionCardsByGroupKey(groupKey) : [questionCard];
        groupCards.forEach((card) => applyQuestionAnswer(card, answerForMessage));
    }
    if (els.messageInput) {
        els.messageInput.value = answerForMessage;
        resizeMessageInput();
    }
    await sendMessage({
        displayContentOverride: answerForMessage,
        textOverride: answerForMessage,
        questionResponse: true,
    });
}

async function submitPuzzleAnswer(orderedSteps, puzzleCard = null, submission = null, puzzleIdHint = '') {
    const api = window.NexoraLearningMode;
    if (api && typeof api.submitPuzzleAnswer === 'function') {
        return api.submitPuzzleAnswer(orderedSteps, puzzleCard, submission, puzzleIdHint);
    }
}

function appendQuestionStep(messageDiv, step) {
    if (!messageDiv || !step || typeof step !== 'object') return;
    const content = messageDiv.querySelector('.message-content');
    if (!content) return;
    const payload = (step.question && typeof step.question === 'object') ? step.question : step;
    const stepCardId = String(step.call_id || step.callId || payload.question_card_id || '').trim();
    const node = createQuestionCardNode(payload, { cardId: stepCardId });
    if (!node) return;
    const body = node.querySelector('.question-card-body');
    const questionCardId = String((body && body.dataset && body.dataset.questionCardId) || payload.question_id || '').trim();
    const questionGroupKey = readQuestionCardGroupKey(node);
    const payloadAnswer = String(payload.answer || '').trim();
    const rememberedAnswer = payloadAnswer || getLockedQuestionAnswer(questionCardId);
    const existingCards = questionGroupKey ? findQuestionCardsByGroupKey(questionGroupKey) : [];

    if (existingCards.length) {
        if (rememberedAnswer) {
            existingCards.forEach((card) => applyQuestionAnswer(card, rememberedAnswer));
        }
        console.info('[QuestionTool] merged duplicate question card', {
            question_group_key: questionGroupKey,
            question_id: String(payload.question_id || ''),
        });
        placeInteractiveCardsBelowToolChain(messageDiv);
        return;
    }

    if (String(node.dataset.toolName || '') === 'ask_for_permission') {
        removeOtherPendingPermissionCards(questionGroupKey);
    }

    if (rememberedAnswer) {
        applyQuestionAnswer(node, rememberedAnswer);
    }
    content.appendChild(node);
    placeInteractiveCardsBelowToolChain(messageDiv);
}

function appendPuzzleStep(messageDiv, step) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.appendPuzzleStep === 'function') {
        return api.appendPuzzleStep(messageDiv, step);
    }
}

function appendLearningCardsToContent(contentEl, cards) {
    if (!contentEl || !Array.isArray(cards) || cards.length === 0) return;
    cards.forEach((card) => {
        const node = createLearningCardNode(card);
        if (node) contentEl.appendChild(node);
    });
}

function appendLearningCardStep(messageDiv, step) {
    if (!messageDiv || !step || typeof step !== 'object') return;
    const content = messageDiv.querySelector('.message-content');
    if (!content) return;
    const node = createLearningCardNode(step.card || step);
    if (node) {
        content.appendChild(node);
        placeInteractiveCardsBelowToolChain(messageDiv);
    }
}

function placeInteractiveCardsBelowToolChain(messageDiv) {
    const parent = (messageDiv && (messageDiv.querySelector('.message-content') || messageDiv)) || null;
    if (!parent) return;
    const cards = Array.from(parent.querySelectorAll('.learning-chat-card-wrap, .question-tool-card, .puzzle-tool-card'));
    if (!cards.length) return;

    let anchorNode = null;
    Array.from(parent.children || []).forEach((node) => {
        if (!node || !node.classList) return;
        if (
            node.classList.contains('tool-usage')
            || node.classList.contains('add-basis-view')
            || node.classList.contains('content-body')
        ) {
            anchorNode = node;
        }
    });

    cards.forEach((card) => {
        if (card && card.parentNode === parent) {
            card.remove();
        }
    });

    if (anchorNode && anchorNode.parentNode === parent) {
        const ref = anchorNode.nextSibling;
        cards.forEach((card) => {
            if (ref) parent.insertBefore(card, ref);
            else parent.appendChild(card);
        });
        return;
    }

    cards.forEach((card) => parent.appendChild(card));
}

function syncInteractiveCardsBelowToolChain(messageDiv) {
    placeInteractiveCardsBelowToolChain(messageDiv);
}

function extractLearningCardPayload(rawResult) {
    if (!rawResult) return null;
    if (typeof rawResult === 'object') {
        if (rawResult.card && typeof rawResult.card === 'object') return rawResult.card;
        if (rawResult.html) return rawResult;
        return null;
    }
    const text = String(rawResult || '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.card && typeof parsed.card === 'object') return parsed.card;
        if (parsed.html) return parsed;
    } catch (_) {
        return null;
    }
    return null;
}

function extractQuestionPayload(rawResult) {
    if (!rawResult) return null;
    if (typeof rawResult === 'object') {
        if (rawResult.question && typeof rawResult.question === 'object') return rawResult.question;
        if (rawResult.question_title || rawResult.question_content) return rawResult;
        return null;
    }
    const text = String(rawResult || '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            if (parsed.question && typeof parsed.question === 'object') return parsed.question;
            if (parsed.question_title || parsed.question_content) return parsed;
        }
    } catch (_) {}
    return null;
}

function extractPuzzlePayload(rawResult) {
    const api = window.NexoraLearningMode;
    if (api && typeof api.extractPuzzlePayload === 'function') {
        return api.extractPuzzlePayload(rawResult);
    }
    return null;
}

async function ensureConversationExistsForStreaming(seedText = '', conversationMode = null) {
    const existing = String(currentConversationId || '').trim();
    if (existing) return existing;
    const titleSeed = String(seedText || '').replace(/\s+/g, ' ').trim();
    const title = titleSeed ? titleSeed.slice(0, 48) : '新对话';
    const normalizedConversationMode = String(conversationMode || '').trim().toLowerCase();
    const learningConversation = learningModeEnabled && normalizedConversationMode === 'learning';
    const boundProject = (!learningConversation && isNexoraCodeProjectSidebarEnabled())
        ? getActiveNexoraCodeProject()
        : null;
    let conversationMetadata = {};
    if (learningConversation) {
        const learningCourseContext = getActiveLearningCourseContext();
        conversationMetadata = {
            learning: true,
        };

        if (learningCourseContext.lectureId) {
            conversationMetadata.lecture_id = learningCourseContext.lectureId;
        }

        if (learningCourseContext.courseTitle) {
            conversationMetadata.lecture_title = learningCourseContext.courseTitle;
        }
    } else if (boundProject) {
        conversationMetadata = {
            nexoracode_project: {
                project_id: boundProject.project_id,
                name: boundProject.name,
                path: boundProject.path,
                subtitle: boundProject.subtitle || boundProject.path || '本地项目',
                tree_scanned_at: boundProject.tree_scanned_at || ''
            }
        };
    }
    try {
        const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                conversation_mode: learningConversation ? 'learning' : 'chat',
                tags: learningConversation ? ['learning'] : [],
                metadata: conversationMetadata
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !(data && data.success)) return '';
        const convId = String(data.conversation_id || '').trim();
        if (!convId) return '';
        currentConversationId = convId;
        syncBrowserCurrentConversation();
        if (learningConversation) {
            currentConversationMode = 'learning';
        }
        if (boundProject) {
            // 绑定完成后清空欢迎页待选项目，保证下一个新对话默认 None
            setActiveNexoraCodeProject('');
        }
        syncNotesForConversation(convId);
        noteTokenMiniConversationId(convId);
        try {
            const next = new URL(window.location.href);
            next.searchParams.set('id', convId);
            window.history.replaceState({}, '', next.toString());
        } catch (_) {}
        try { await loadConversations(); } catch (_) {}
        return convId;
    } catch (_) {
        return '';
    }
}

async function syncConversationMessagesFromServer(conversationId, options = {}) {
    const { instant = true, silent = true } = options;
    const cid = String(conversationId || currentConversationId || '').trim();
    if (!cid) return false;
    try {
        const convRes = await fetch(`/api/conversations/${encodeURIComponent(cid)}`);
        const convData = await convRes.json().catch(() => ({}));
        if (!(convData && convData.success && convData.conversation && Array.isArray(convData.conversation.messages))) {
            return false;
        }
        const msgs = convData.conversation.messages || [];
        const indexedMsgs = setConversationMessageWindowFromPayload(cid, msgs, {
            start_index: 0,
            end_index: msgs.length - 1,
            total: msgs.length,
            has_more_before: false
        });
        renderMessages(indexedMsgs, !!silent, {
            instant: !!instant,
            preserveScrollAnchor: true
        });
        refreshConversationImageHistoryFlag(msgs);
        applyTokenBudgetFromConversationMessages(msgs);
        await refreshTokenMiniForConversation(cid, { keepStreamPart: false });
        return true;
    } catch (_) {
        return false;
    }
}

async function fetchConversationMessagesSnapshot(conversationId) {
    const cid = String(conversationId || currentConversationId || '').trim();
    if (!cid) return null;

    try {
        const convRes = await fetch(`/api/conversations/${encodeURIComponent(cid)}?include_stream=1`);
        const convData = await convRes.json().catch(() => ({}));
        if (!(convData && convData.success && convData.conversation && Array.isArray(convData.conversation.messages))) {
            console.warn('[ConversationPanel] invalid conversation snapshot', {
                conversation_id: cid,
                status: convRes.status
            });
            return null;
        }

        return {
            conversation: convData.conversation,
            messages: convData.conversation.messages || [],
            stream_sessions: Array.isArray(convData.stream_sessions) ? convData.stream_sessions : []
        };
    } catch (error) {
        console.warn('[ConversationPanel] failed to fetch conversation snapshot', {
            conversation_id: cid,
            error: String((error && error.message) || error || '')
        });
        return null;
    }
}

async function renderConversationSnapshotFromServer(conversationId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const snapshot = await fetchConversationMessagesSnapshot(conversationId);
    if (!snapshot) return null;

    const instant = opts.instant !== false;
    const silent = opts.silent !== false;
    const shouldRender = opts.render !== false;
    const cid = String(conversationId || currentConversationId || '').trim();

    if (shouldRender) {
        const indexedMessages = setConversationMessageWindowFromPayload(cid, snapshot.messages, {
            start_index: 0,
            end_index: snapshot.messages.length - 1,
            total: snapshot.messages.length,
            has_more_before: false
        });
        renderMessages(indexedMessages, !!silent, {
            instant: !!instant,
            preserveScrollAnchor: opts.preserveScrollAnchor !== false
        });
    } else {
        syncConversationMessageWindowFromSnapshot(cid, snapshot.messages);
    }

    refreshConversationImageHistoryFlag(snapshot.messages);
    applyTokenBudgetFromConversationMessages(snapshot.messages);

    if (cid) {
        applyStreamSessionMetaRows(snapshot.stream_sessions, cid);
        await refreshTokenMiniForConversation(cid, { keepStreamPart: false });
    }

    return snapshot;
}

async function ensureConversationPanelReadyForMutation(conversationId, operationName = 'operation') {
    const cid = String(conversationId || currentConversationId || '').trim();
    if (!cid) {
        showToast('当前会话无效');
        return false;
    }

    await syncStoredConversationStreamStatus();
    syncGenerationStateForCurrentConversation();

    const activeState = getConversationStreamState(cid);
    if (activeState && String(activeState.status || '') === 'running') {
        const stopping = !!activeState.stopping;
        showToast(stopping ? '正在整理中断结果，请稍候' : '模型回复仍在生成，请先停止后再操作');
        return false;
    }

    const resumeState = loadActiveStreamResumeState();
    const resumeCid = String((resumeState && resumeState.conversation_id) || '').trim();
    if (resumeCid && resumeCid === cid) {
        clearActiveStreamResumeState();
    }

    const shouldRenderSnapshot = !(operationName === 'edit_user_prompt');
    if (!shouldRenderSnapshot) {
        console.debug('[ConversationPanel] mutation gate passed without render', {
            conversation_id: cid,
            operation: String(operationName || 'operation')
        });
        return true;
    }

    const snapshot = await renderConversationSnapshotFromServer(cid, { instant: true, silent: true });
    if (!snapshot) {
        showToast('对话同步失败，请稍后再操作');
        return false;
    }

    console.debug('[ConversationPanel] mutation gate passed', {
        conversation_id: cid,
        operation: String(operationName || 'operation'),
        message_count: snapshot.messages.length
    });
    return true;
}

function getMessageRowByIndex(index) {
    return messageActionsController.getMessageRowByIndex(index);
}

function getDeleteRoundRangeFromDom(index) {
    return messageActionsController.getDeleteRoundRangeFromDom(index);
}

function optimisticHideDeleteRound(index) {
    return messageActionsController.optimisticHideDeleteRound(index);
}

function rollbackOptimisticHide(state) {
    return messageActionsController.rollbackOptimisticHide(state);
}

async function requestServerCancelForActiveStream() {
    const activeCid = String(currentConversationId || '').trim();
    const state = getConversationStreamState(activeCid);
    if (!activeCid) return false;
    const streamId = String((state && state.stream_id) || '').trim();
    try {
        const res = await fetch('/api/chat/stream/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(streamId
                ? { stream_id: streamId, conversation_id: activeCid }
                : { conversation_id: activeCid })
        });
        const data = await res.json().catch(() => ({}));
        return !!(res.ok && data && data.success);
    } catch (_) {
        return false;
    }
}

function findStreamStatusSession(rows, streamId, conversationId) {
    const sid = String(streamId || '').trim();
    const cid = String(conversationId || '').trim();
    const list = Array.isArray(rows) ? rows : [];

    if (sid) {
        const byStreamId = list.find((row) => String(row && row.stream_id || '').trim() === sid);
        if (byStreamId) return byStreamId;
    }

    if (cid) {
        return list.find((row) => String(row && row.conversation_id || '').trim() === cid) || null;
    }

    return null;
}

async function waitForStreamServerFinalized(streamId, conversationId, options = {}) {
    const sid = String(streamId || '').trim();
    const cid = String(conversationId || '').trim();
    if (!sid && !cid) return true;

    const opts = (options && typeof options === 'object') ? options : {};
    const maxWaitMs = Number.isFinite(Number(opts.maxWaitMs)) ? Math.max(0, Number(opts.maxWaitMs)) : 8000;
    const intervalMs = Number.isFinite(Number(opts.intervalMs)) ? Math.max(120, Number(opts.intervalMs)) : 250;
    const startedAt = Date.now();

    while ((Date.now() - startedAt) <= maxWaitMs) {
        try {
            const res = await fetch('/api/chat/stream/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stream_ids: sid ? [sid] : [],
                    conversation_ids: cid ? [cid] : []
                })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data && data.success !== false) {
                const sessionRow = findStreamStatusSession(data.sessions, sid, cid);
                if (!sessionRow) return true;

                const status = String(sessionRow.status || '').trim().toLowerCase();
                if (status && status !== 'running' && status !== 'cancelling') return true;
            } else {
                console.error('[StreamCancel] stream status sync failed', {
                    status: res.status,
                    stream_id: sid,
                    conversation_id: cid,
                    message: String((data && data.message) || '')
                });
            }
        } catch (err) {
            console.error('[StreamCancel] stream status sync exception', {
                stream_id: sid,
                conversation_id: cid,
                error: String((err && err.message) || err || '')
            });
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    console.error('[StreamCancel] stream server finalization wait timeout', {
        stream_id: sid,
        conversation_id: cid,
        max_wait_ms: maxWaitMs
    });
    return false;
}

async function waitForQuestionResponseStreamIdle(conversationId, options = {}) {
    const cid = String(conversationId || '').trim();
    if (!cid || !isConversationStreamRunning(cid)) return true;

    const opts = (options && typeof options === 'object') ? options : {};
    const maxWaitMs = Number.isFinite(Number(opts.maxWaitMs)) ? Math.max(0, Number(opts.maxWaitMs)) : 8000;
    const intervalMs = Number.isFinite(Number(opts.intervalMs)) ? Math.max(100, Number(opts.intervalMs)) : 150;
    const startedAt = Date.now();

    while ((Date.now() - startedAt) <= maxWaitMs) {
        await syncStoredConversationStreamStatus({ conversationIds: [cid] });

        if (!isConversationStreamRunning(cid)) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const state = getConversationStreamState(cid);
    console.error('[QuestionTool] previous stream did not finish before answer submission', {
        conversation_id: cid,
        stream_id: String((state && state.stream_id) || ''),
        max_wait_ms: maxWaitMs,
    });
    return false;
}

function buildTerminalErrorMessage(baseContent, errorMessage) {
    const errMsg = String(errorMessage || '').trim() || '请求失败';
    const marker = `[系统错误] ${errMsg}`;
    const base = String(baseContent || '').trim();
    if (!base) return marker;
    if (base.includes(marker)) return base;
    return `${base}\n\n${marker}`;
}

function extractStandaloneSystemErrorMessage(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const m = raw.match(/^\[系统错误\]\s*(.+)$/s);
    if (!m) return '';
    const msg = String(m[1] || '').trim();
    return msg || '请求失败';
}

function renderAssistantTerminalErrorMessage(messageDiv, messageIndex, baseContent, errorMessage) {
    const finalText = buildTerminalErrorMessage(baseContent, errorMessage);
    const chipText = String(errorMessage || '').trim() || extractStandaloneSystemErrorMessage(finalText) || '请求失败';
    if (messageDiv) {
        appendErrorEvent(messageDiv, chipText, false);
        const idx = Number(messageIndex);
        if (Number.isFinite(idx) && idx >= 0) {
            try { finalizeMessageRenderForIndex(idx, messageDiv); } catch (_) {}
        }
        return finalText;
    }
    const idx = Number(messageIndex);
    if (Number.isFinite(idx) && idx >= 0) {
        const row = getMessageRowByIndex(idx);
        if (row) appendErrorEvent(row, chipText, false);
    }
    return finalText;
}

function stopGeneration() {
    const activeCid = String(currentConversationId || '').trim();
    const state = getConversationStreamState(activeCid);
    const controller = (state && state.controller) || currentAbortController;
    if (activeCid && (state || controller)) {
        if (activeCid) {
            setConversationStreamState(activeCid, {
                status: 'running',
                monitoring: true,
                stopping: true
            });
        }
        syncGenerationStateForCurrentConversation();
        updateSendButtonState();
        void (async () => {
            const ok = await requestServerCancelForActiveStream();
            if (!ok) {
                console.error('[StreamCancel] cancel request was not accepted', {
                    conversation_id: activeCid,
                    stream_id: String((state && state.stream_id) || '')
                });
            }

            // 检查流状态是否仍存在（可能已被 markConversationStreamFinished 清除）
            const currentState = getConversationStreamState(activeCid);
            if (currentState && String(currentState.status || '') === 'running') {
                setConversationStreamState(activeCid, {
                    monitoring: false,
                    stopping: true
                });
            }
            if (controller) {
                try {
                    controller.abort();
                } catch (abortError) {
                    console.error('[StreamCancel] local stream abort failed', abortError);
                }
            } else if (currentState && String(currentState.status || '') === 'running' && !ok) {
                // 无活跃 reader 且服务端取消未接受的残留 running 状态：
                // 属于 provider 不可用等网络错误残留，无 abort 目标可终止，
                // 直接终结状态并清除恢复记录，避免动画小球停滞与刷新后重连死循环。
                markConversationStreamFinished(activeCid);
                clearActiveStreamResumeState();
            }
            syncGenerationStateForCurrentConversation();
        })();
    } else if (controller) {
        try {
            controller.abort();
        } catch (abortError) {
            console.error('[StreamCancel] local stream abort failed before stream id', abortError);
        }
    }
    releaseLearningSidebarPendingSend();
}

function loadActiveStreamResumeState() {
    return streamStateController.loadActiveStreamResumeState();
}

function saveActiveStreamResumeState(nextState) {
    return streamStateController.saveActiveStreamResumeState(nextState);
}

function attachRunningStreamToCurrentConversation(conversationId) {
    return streamLifecycleController.attachRunningStreamToCurrentConversation(conversationId);
}

function patchActiveStreamResumeState(patch) {
    return streamStateController.patchActiveStreamResumeState(patch);
}

function clearStreamAttachRetry(conversationId) {
    return streamLifecycleController.clearStreamAttachRetry(conversationId);
}

function clearAllStreamAttachRetries() {
    return streamLifecycleController.clearAllStreamAttachRetries();
}

function scheduleStreamAttachRetry(conversationId, reason = 'pending_stream_id', attempt = 1) {
    return streamLifecycleController.scheduleStreamAttachRetry(conversationId, reason, attempt);
}

function clearActiveStreamResumeState() {
    return streamStateController.clearActiveStreamResumeState();
}

function normalizeStreamMessageIndex(value) {
    return streamStateController.normalizeStreamMessageIndex(value);
}

function readStreamRegenerateFlag(source, defaultValue = false) {
    return streamStateController.readStreamRegenerateFlag(source, defaultValue);
}

function readStreamAssistantIndexFromMeta(source, defaultIndex = null) {
    return streamStateController.readStreamAssistantIndexFromMeta(source, defaultIndex);
}

function readStreamRegenerateIndexFromMeta(source, defaultIndex = null) {
    return streamStateController.readStreamRegenerateIndexFromMeta(source, defaultIndex);
}

function stripHistoryTimeMarkerEchoForStream(text) {
    return streamStateController.stripHistoryTimeMarkerEchoForStream(text);
}

function isAbortControllerAborted(controller) {
    return streamLifecycleController.isAbortControllerAborted(controller);
}

function markStreamControllerDetachOnly(controller, context = {}) {
    return streamLifecycleController.markStreamControllerDetachOnly(controller, context);
}

function shouldAutoAttachDetachedStream(controller) {
    return streamLifecycleController.shouldAutoAttachDetachedStream(controller);
}

function detachCurrentVisibleStreamForNavigation(nextConversationId = '') {
    return streamLifecycleController.detachCurrentVisibleStreamForNavigation(nextConversationId);
}

function detachVisibleStreamReaderBeforeConversationRender(conversationId = '') {
    return streamLifecycleController.detachVisibleStreamReaderBeforeConversationRender(conversationId);
}

function attachDetachedStreamConsumer(conversationId, state = null) {
    return streamLifecycleController.attachDetachedStreamConsumer(conversationId, state);
}

function normalizeConversationStreamState(raw) {
    return streamStateController.normalizeConversationStreamState(raw);
}

function serializeConversationStreamState(state) {
    return streamStateController.serializeConversationStreamState(state);
}

function hydrateConversationStreamStatesFromStorage() {
    return streamStateController.hydrateConversationStreamStatesFromStorage();
}

function persistConversationStreamStates() {
    return streamStateController.persistConversationStreamStates();
}

function invalidateConversationListForStreamState() {
    resetConversationListRenderSignature();
    if (Array.isArray(conversationListCache) && conversationListCache.length) {
        renderConversationList(conversationListCache);
    }
}

function getConversationStreamState(conversationId) {
    return streamStateController.getConversationStreamState(conversationId);
}

function buildConversationStreamListStateSignature(state) {
    return streamStateController.buildConversationStreamListStateSignature(state);
}

function isConversationStreamRunning(conversationId) {
    return streamStateController.isConversationStreamRunning(conversationId);
}

function setConversationStreamState(conversationId, patch = {}) {
    return streamStateController.setConversationStreamState(conversationId, patch);
}

function removeConversationStreamState(conversationId) {
    return streamStateController.removeConversationStreamState(conversationId);
}

function moveConversationStreamState(fromConversationId, toConversationId) {
    return streamStateController.moveConversationStreamState(fromConversationId, toConversationId);
}

function isCurrentConversation(conversationId) {
    return String(currentConversationId || '').trim() === String(conversationId || '').trim();
}

function markConversationStreamFinished(conversationId, options = {}) {
    return streamStateController.markConversationStreamFinished(conversationId, options);
}

function isTerminalStreamSessionChunk(chunk) {
    return streamStateController.isTerminalStreamSessionChunk(chunk);
}

function markConversationStreamRead(conversationId) {
    return streamStateController.markConversationStreamRead(conversationId);
}

function syncGenerationStateForCurrentConversation(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const state = getConversationStreamState(currentConversationId);
    const running = !!(state && String(state.status || '') === 'running');
    isGenerating = running;
    currentAbortController = running && state && state.controller ? state.controller : null;
    if (opts.render !== false) {
        updateSendButtonState();
    }
    return running;
}

function getConversationStreamIdsForStatusSync() {
    return streamStateController.getConversationStreamIdsForStatusSync();
}

function applyStreamSessionMetaRows(rows, sourceConversationId = '') {
    return streamStateController.applyStreamSessionMetaRows(rows, sourceConversationId);
}

async function syncStoredConversationStreamStatus(options = {}) {
    return streamStatusSyncController.syncStoredConversationStreamStatus(options);
}

function getStoredRunningStreamStates() {
    return streamStateController.getStoredRunningStreamStates();
}

function startStoredStreamSessionMonitors(options = {}) {
    return streamStatusSyncController.startStoredStreamSessionMonitors(options);
}

async function tickConversationStreamStatusSync() {
    return streamStatusSyncController.tickConversationStreamStatusSync();
}

function startConversationStreamStatusSync() {
    return streamStatusSyncController.startConversationStreamStatusSync();
}

function stopConversationStreamStatusSync() {
    return streamStatusSyncController.stopConversationStreamStatusSync();
}

function attachStreamSessionMonitor(state) {
    return streamSessionMonitorController.attachStreamSessionMonitor(state);
}

async function consumeStreamSessionMonitor(state) {
    return streamSessionMonitorController.consumeStreamSessionMonitor(state);
}

function findAssistantIndexAfterUserMessage(userIndex) {
    const idx = Number(userIndex);
    if (!Number.isFinite(idx)) return -1;
    const direct = document.querySelector(`.message.assistant[data-index="${idx + 1}"]`);
    if (direct) return idx + 1;
    if (!els.messagesContainer) return -1;
    const rows = Array.from(els.messagesContainer.querySelectorAll('.message.assistant'));
    let best = Number.POSITIVE_INFINITY;
    rows.forEach((row) => {
        const n = Number(row.dataset.index);
        if (!Number.isFinite(n) || n <= idx) return;
        if (n < best) best = n;
    });
    return Number.isFinite(best) ? best : -1;
}

function findAssistantIndexAfterUserMessageInMessages(messages, userIndex) {
    const rows = Array.isArray(messages) ? messages : [];
    const idx = Number(userIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= rows.length) return -1;

    for (let i = idx + 1; i < rows.length; i += 1) {
        const role = String((rows[i] && rows[i].role) || '').trim().toLowerCase();
        if (role === 'assistant') return i;
        if (role === 'user') break;
    }

    return -1;
}

async function findAssistantIndexAfterUserMessageFromServer(conversationId, userIndex) {
    const cid = String(conversationId || '').trim();
    const idx = Number(userIndex);
    if (!cid || !Number.isFinite(idx) || idx < 0) return { index: -1, messages: [] };
    try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}`);
        const data = await res.json().catch(() => ({}));
        const messages = (data && data.success && data.conversation && Array.isArray(data.conversation.messages))
            ? data.conversation.messages
            : [];
        if (!messages.length) return { index: -1, messages };
        for (let i = Math.max(0, idx + 1); i < messages.length; i += 1) {
            const role = String((messages[i] && messages[i].role) || '').trim().toLowerCase();
            if (role === 'assistant') {
                return { index: i, messages };
            }
        }
        return { index: -1, messages };
    } catch (_) {
        return { index: -1, messages: [] };
    }
}

async function findAssistantIndexAfterEditedUserFromServer(conversationId, preferredUserIndex, editedText) {
    const cid = String(conversationId || '').trim();
    const idx = Number(preferredUserIndex);
    const target = String(editedText || '').trim();
    if (!cid) return { index: -1, userIndex: -1, reason: 'invalid_conversation', messages: [] };
    try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}`);
        const data = await res.json().catch(() => ({}));
        const messages = (data && data.success && data.conversation && Array.isArray(data.conversation.messages))
            ? data.conversation.messages
            : [];
        if (!messages.length) return { index: -1, userIndex: -1, reason: 'empty_messages', messages };

        let userPos = -1;
        if (Number.isFinite(idx) && idx >= 0 && idx < messages.length) {
            const m = messages[idx] || {};
            if (String(m.role || '').trim().toLowerCase() === 'user') {
                userPos = idx;
            }
        }
        if (userPos < 0 && target) {
            for (let i = messages.length - 1; i >= 0; i -= 1) {
                const m = messages[i] || {};
                if (String(m.role || '').trim().toLowerCase() !== 'user') continue;
                if (String(m.content || '').trim() === target) {
                    userPos = i;
                    break;
                }
            }
        }
        if (userPos < 0) {
            return { index: -1, userIndex: -1, reason: 'user_turn_not_found', messages };
        }
        for (let i = userPos + 1; i < messages.length; i += 1) {
            const role = String((messages[i] && messages[i].role) || '').trim().toLowerCase();
            if (role === 'assistant') {
                return { index: i, userIndex: userPos, reason: 'ok', messages };
            }
        }
        return { index: -1, userIndex: userPos, reason: 'no_assistant_after_user', messages };
    } catch (_) {
        return { index: -1, userIndex: -1, reason: 'fetch_failed', messages: [] };
    }
}
function normalizeToolsMode(raw) {
    const m = String(raw || '').trim().toLowerCase();
    if (m === 'off' || m === 'force') return m;
    if (m === 'auto' || m === 'auto_select' || m === 'auto-select' || m === 'autoselect') return 'auto_off';
    if (m === 'auto_off' || m === 'auto-off' || m === 'autooff') return 'auto_off';
    return 'auto_off';
}

function formatToolsModeLabel(mode) {
    const m = normalizeToolsMode(mode);
    if (m === 'off') return 'Off';
    if (m === 'force') return 'Force';
    return 'Auto(OFF)';
}

function hasLikelyMathForThinkingStream(text) {
    return getNexoraChatStreaming().hasLikelyMathForThinkingStream(text);
}

function streamMathIsEscapedAt(text, index) {
    return getNexoraChatStreaming().streamMathIsEscapedAt(text, index);
}

function streamMathFindOpenTailInfo(text) {
    return getNexoraChatStreaming().streamMathFindOpenTailInfo(text);
}

function streamMathBuildProvisionalClosedTail(rawTail, openType) {
    return getNexoraChatStreaming().streamMathBuildProvisionalClosedTail(rawTail, openType);
}

function renderMathInElementSyncPreferred(root) {
    return getNexoraChatLatex().renderMathInElementSync(root, getChatLatexRenderDeps());
}

function renderCompletedStreamMath(root) {
    return getNexoraChatStreaming().renderCompletedStreamMath(root, getChatStreamingRenderDeps());
}

function saveComposerPrefsToStorage() {
    try {
        const payload = {
            thinking: !!(els.checkThinking && els.checkThinking.checked),
            search: !!(els.checkSearch && els.checkSearch.checked),
            toolsMode: getToolsMode(),
            includeContext: !!tokenBudgetState.includeContext
        };
        localStorage.setItem(CHAT_COMPOSER_PREFS_KEY, JSON.stringify(payload));
    } catch (_) {
        // ignore
    }
}

function loadComposerPrefsFromStorage() {
    try {
        const raw = localStorage.getItem(CHAT_COMPOSER_PREFS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (_) {
        return null;
    }
}

function applyComposerPrefsFromStorage() {
    const prefs = loadComposerPrefsFromStorage();
    if (!prefs) return;
    if (els.checkThinking && typeof prefs.thinking === 'boolean') {
        els.checkThinking.checked = prefs.thinking;
    }
    if (els.checkSearch && typeof prefs.search === 'boolean') {
        els.checkSearch.checked = prefs.search;
    }
    if (prefs.toolsMode !== undefined && prefs.toolsMode !== null) {
        setToolsMode(String(prefs.toolsMode || 'auto_off'), { persist: false });
    }
    if (typeof prefs.includeContext === 'boolean') {
        tokenBudgetState.includeContext = !!prefs.includeContext;
        renderTokenBudgetUi();
    }
}

function saveMessageDraftToStorage(text) {
    try {
        const raw = String(text || '');
        const next = raw.slice(0, CHAT_INPUT_DRAFT_MAX_LEN);
        if (!next) {
            localStorage.removeItem(CHAT_INPUT_DRAFT_KEY);
            return;
        }
        localStorage.setItem(CHAT_INPUT_DRAFT_KEY, next);
    } catch (_) {
        // ignore
    }
}

function loadMessageDraftFromStorage() {
    try {
        return String(localStorage.getItem(CHAT_INPUT_DRAFT_KEY) || '');
    } catch (_) {
        return '';
    }
}

function setToolsModeMenuClipState(open) {
    const dropdown = els.toolsModeDropdown;
    if (!dropdown) return;

    const container = dropdown.closest('.input-container');
    const toolsInner = dropdown.closest('.input-options-tools-inner');

    if (container) {
        container.classList.toggle('tools-mode-menu-open', !!open);
    }

    if (toolsInner) {
        toolsInner.classList.toggle('tools-mode-menu-open', !!open);
    }
}

function closeToolsModeDropdown() {
    if (!els.toolsModeDropdown) return;
    els.toolsModeDropdown.classList.remove('open');
    setToolsModeMenuClipState(false);
    if (els.toolsModeTrigger) els.toolsModeTrigger.setAttribute('aria-expanded', 'false');
    if (els.toolsModeMenu) {
        els.toolsModeMenu.style.position = '';
        els.toolsModeMenu.style.left = '';
        els.toolsModeMenu.style.top = '';
        els.toolsModeMenu.style.right = '';
        els.toolsModeMenu.style.bottom = '';
        els.toolsModeMenu.style.zIndex = '';
    }
}

function positionToolsModeMenuForMobile() {
    if (!els.toolsModeMenu || !els.toolsModeTrigger || !els.toolsModeDropdown) return;
    if (!isChatMobileLayout()) {
        els.toolsModeMenu.style.position = '';
        els.toolsModeMenu.style.left = '';
        els.toolsModeMenu.style.top = '';
        els.toolsModeMenu.style.right = '';
        els.toolsModeMenu.style.bottom = '';
        els.toolsModeMenu.style.zIndex = '';
        return;
    }
    const menu = els.toolsModeMenu;
    menu.style.position = 'absolute';
    menu.style.left = 'auto';
    menu.style.right = '0';
    menu.style.top = 'auto';
    menu.style.bottom = 'calc(100% + 8px)';
    menu.style.zIndex = '9200';
}

function setToolsMode(mode, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const normalized = normalizeToolsMode(mode);
    if (els.toolsMode) els.toolsMode.value = normalized;
    if (els.toolsModeLabel) els.toolsModeLabel.textContent = formatToolsModeLabel(normalized);
    if (els.toolsModeMenu) {
        els.toolsModeMenu.querySelectorAll('.tool-mode-item').forEach((btn) => {
            const active = String(btn.dataset.mode || '').trim().toLowerCase() === normalized;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }
    if (opts.persist !== false) {
        saveComposerPrefsToStorage();
    }
}

const INPUT_COLLAPSE_ANIMATION_MS = 280;

function setInputContainerCollapsed(container, collapsed) {
    const messagesContainer = els.messagesContainer || document.getElementById('messagesContainer');
    const wrapper = container.closest('#inputWrapper');
    const dock = container.closest('.input-dock');

    if (container.__inputCollapseTimer) {
        window.clearTimeout(container.__inputCollapseTimer);
        container.__inputCollapseTimer = 0;
    }

    if (collapsed) {
        if (dock) {
            dock.classList.add('input-dock-collapsing');
            dock.classList.remove('input-dock-collapsed');
        }

        if (wrapper) {
            wrapper.classList.remove('input-wrapper-collapsed');
        }

        if (messagesContainer) {
            messagesContainer.classList.remove('messages-input-collapsed');
        }

        container.classList.add('input-collapsed');

        container.__inputCollapseTimer = window.setTimeout(() => {
            container.__inputCollapseTimer = 0;

            if (dock) {
                dock.classList.remove('input-dock-collapsing');
                dock.classList.add('input-dock-collapsed');
            }

            if (wrapper) {
                wrapper.classList.add('input-wrapper-collapsed');
            }

            if (messagesContainer) {
                messagesContainer.classList.add('messages-input-collapsed');
            }
        }, INPUT_COLLAPSE_ANIMATION_MS);
    } else {
        if (dock) {
            dock.classList.remove('input-dock-collapsed', 'input-dock-collapsing');
        }

        if (wrapper) {
            wrapper.classList.remove('input-wrapper-collapsed');
        }

        if (messagesContainer) {
            messagesContainer.classList.remove('messages-input-collapsed');
        }

        window.requestAnimationFrame(() => {
            container.classList.remove('input-collapsed');
        });
    }

    els.inputCollapseBtn.classList.toggle('collapsed', collapsed);
    els.inputCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    els.inputCollapseBtn.setAttribute('aria-label', collapsed ? '展开输入框' : '折叠输入框');
    els.inputCollapseBtn.title = collapsed ? '展开输入框' : '折叠输入框';
}

// 输入区折叠按钮：点击收起整个 input-container，仅保留按钮用于再次展开
function bindInputCollapseBtn() {
    if (!els.inputCollapseBtn) return;
    if (els.inputCollapseBtn.dataset.bindDone === '1') return;
    els.inputCollapseBtn.dataset.bindDone = '1';

    const container = els.inputCollapseBtn.closest('.input-container');
    setInputContainerCollapsed(container, container.classList.contains('input-collapsed'));

    els.inputCollapseBtn.addEventListener('click', () => {
        const collapsed = !container.classList.contains('input-collapsed');
        setInputContainerCollapsed(container, collapsed);
    });
}

function bindToolsModeDropdown() {
    if (!els.toolsModeDropdown || !els.toolsModeTrigger || !els.toolsModeMenu) return;
    if (els.toolsModeDropdown.dataset.bindDone === '1') return;
    els.toolsModeDropdown.dataset.bindDone = '1';
    setToolsMode(els.toolsMode ? els.toolsMode.value : 'auto_off', { persist: false });

    els.toolsModeTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !els.toolsModeDropdown.classList.contains('open');
        closeToolsModeDropdown();
        if (willOpen) {
            els.toolsModeDropdown.classList.add('open');
            setToolsModeMenuClipState(true);
            els.toolsModeTrigger.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => positionToolsModeMenuForMobile());
        }
    });

    els.toolsModeMenu.querySelectorAll('.tool-mode-item').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setToolsMode(btn.dataset.mode || 'auto_off');
            closeToolsModeDropdown();
        });
    });

    document.addEventListener('click', (e) => {
        if (!els.toolsModeDropdown || !els.toolsModeDropdown.contains(e.target)) {
            closeToolsModeDropdown();
        }
    });
    window.addEventListener('resize', () => {
        if (!els.toolsModeDropdown || !els.toolsModeDropdown.classList.contains('open')) return;
        positionToolsModeMenuForMobile();
    });
    window.addEventListener('scroll', () => {
        if (!els.toolsModeDropdown || !els.toolsModeDropdown.classList.contains('open')) return;
        positionToolsModeMenuForMobile();
    }, true);
}

function getToolsMode() {
    return normalizeToolsMode(els.toolsMode ? els.toolsMode.value : 'auto_off');
}

function buildContextCompressionPreflightInfo(modelId, forceRequested = false) {
    const ctx = resolveContextWindowForModel(modelId);
    const contextWindow = normalizeContextWindow(ctx.limit);
    const rawInput = Math.max(
        0,
        computeContextWindowUsedTokens(),
        safeTokenInt(tokenBudgetState.latestRawInputTokens),
        safeTokenInt(tokenBudgetState.latestInputTokens)
    );
    const threshold = contextWindow > 0 ? Math.max(1, Math.floor(contextWindow * 0.9)) : 0;
    const overload = contextWindow > 0 && rawInput > 0 && rawInput >= threshold;
    const reliableWindow = contextWindow > 0 && !ctx.estimated;
    const triggerMode = forceRequested ? 'force' : (overload ? 'overload' : '');
    const needConfirm = !!forceRequested || (!!tokenBudgetState.includeContext && reliableWindow && overload);
    return {
        needConfirm,
        triggerMode,
        rawInput,
        threshold,
        contextWindow,
        contextWindowEstimated: !!ctx.estimated
    };
}

async function maybeConfirmContextCompressionBeforeSend(modelId, forceRequested = false) {
    const info = buildContextCompressionPreflightInfo(modelId, forceRequested);
    if (!info.needConfirm) {
        return { ok: true, forceCompression: !!forceRequested };
    }

    const title = '上下文压缩提示';
    const reasonText = (info.triggerMode === 'force')
        ? '触发原因：强制触发'
        : `触发原因：上下文过载（${info.rawInput.toLocaleString()} / ${info.contextWindow.toLocaleString()}，阈值 ${info.threshold.toLocaleString()}）`;
    const body = `${reasonText}\n\n继续：立即发送并执行上下文压缩。\n取消：不发送，你可以先切换模型后再试。`;
    const confirmed = await confirmModalAsync(title, body, 'primary');
    if (!confirmed) {
        if (forceRequested) setForceContextCompressionOnce(true);
        showToast('已取消发送，请切换模型后重试');
        return { ok: false, forceCompression: false };
    }

    return { ok: true, forceCompression: true };
}

async function sendMessage(options = {}) {
    const isAutoContinue = !!(options && options.autoContinue);
    const isQuestionResponse = !!(options && options.questionResponse);
    const useExistingUserMessage = !!(options && options.useExistingUserMessage);
    const autoContinueKind = String(options && options.autoContinueKind ? options.autoContinueKind : '').trim();
    const isConfirmationAutoContinue = autoContinueKind === 'confirm';
    const overrideDisplayContent = String(options && options.displayContentOverride ? options.displayContentOverride : '').trim();
    const overrideText = String(options && options.textOverride ? options.textOverride : '').trim();
    const rawText = isAutoContinue ? '' : (overrideText || els.messageInput.value.trim());
    const workspaceComposeWorkspaceId = (!isAutoContinue && !useExistingUserMessage)
        ? getActiveWorkspaceDetailComposeWorkspaceId()
        : '';
    const workspaceConversationContext = getActiveWorkspaceConversationContext();
    const workspaceConversationWorkspaceId = workspaceConversationContext
        ? String(workspaceConversationContext.workspaceId || '').trim()
        : '';
    const workspaceRequestWorkspaceId = workspaceComposeWorkspaceId || workspaceConversationWorkspaceId;
    syncGenerationStateForCurrentConversation();
    const latencyProbe = createNexoraLatencyProbe('sendMessage', {
        agent_online: !!lastAgentOnline,
        current_conversation_id: String(currentConversationId || ''),
        auto_continue: isAutoContinue,
        conversation_mode: String(currentConversationMode || ''),
        workspace_id: workspaceRequestWorkspaceId
    });
    latencyProbe.mark('start', {
        text_chars: String(rawText || '').length,
        upload_count: Array.isArray(uploadedFileIds) ? uploadedFileIds.length : 0
    });

    if (learningFeedComposeMode && !isAutoContinue && !isGenerating) {
        await submitLearningFeedPost(rawText);
        latencyProbe.mark('learning_feed_submit');
        latencyProbe.flush('learning_feed_submit');
        return;
    }
    const longtermTriggered = !isAutoContinue && /^\s*\/longterm(?:\s+|$)/i.test(rawText);
    let text = rawText;
    let nextConversationMode = (currentConversationMode === 'longterm' || isAutoContinue)
        ? 'longterm'
        : ((learningModeEnabled && isLearningWorkspaceActive()) ? 'learning' : 'chat');
    if (learningModeEnabled && isLearningReaderHostActive() && nextConversationMode !== 'longterm') {
        nextConversationMode = 'learning';
        currentConversationMode = 'learning';
        learningHeaderMode = 'learning';
    }

    if (nextConversationMode === 'learning') {
        currentConversationMode = 'learning';
        learningHeaderMode = 'learning';
    } else if (nextConversationMode === 'chat') {
        currentConversationMode = 'chat';
        if (!isLearningReaderHostActive()) learningHeaderMode = 'chat';
    }
    let longtermTaskText = '';
    if (isAutoContinue && !text) {
        text = isConfirmationAutoContinue
            ? '请确认上一轮输出对应的步骤是否已经完成。如果已经完成，请明确输出<done></done>，并补充<context>...</context>。如果尚未完成，请继续完成当前步骤，不要进入下一步。'
            : '继续执行下一步';
    }
    if (longtermTriggered) {
        text = rawText.replace(/^\s*\/longterm(?:\s+)?/i, '').trim();
        nextConversationMode = 'longterm';
        longtermTaskText = text;
        currentConversationMode = 'longterm';
        if (!text && uploadedFileIds.length === 0 && !isGenerating) {
            currentConversationLongtermState = normalizeLongtermState({
                ...currentConversationLongtermState,
                active: false,
                task: '',
                plan: currentConversationLongtermState.plan || []
            });
            renderLongtermPlanPanel();
            showToast('Longterm 模式已启用');
            return;
        }
    }
    if (!text && !isGenerating && uploadedFileIds.length === 0 && !isAutoContinue && !(options && options.puzzle_submission)) return;
    if (isUploadingFiles && !isGenerating) {
        showToast('文件上传或向量化处理中，请稍候或手动中断后再发送');
        return;
    }
    
// 说明
    syncGenerationStateForCurrentConversation();
    if (isQuestionResponse && isConversationStreamRunning(currentConversationId)) {
        showToast('上一条回复仍在收尾，请稍后重试');
        latencyProbe.flush('question_response_blocked_by_generation', { force: true });
        return;
    }

    if (workspaceRequestWorkspaceId && isGenerating) {
        showToast('当前仍有回复生成中，请稍候');
        latencyProbe.flush('workspace_send_blocked_by_generation', { force: true });
        return;
    }

    if (!workspaceRequestWorkspaceId && isConversationStreamRunning(currentConversationId)) {
        stopGeneration();
        return;
    }

    // Configs
    const model = await ensureSelectedModelReady();
    latencyProbe.mark('ensure_selected_model', { model });
    if (!model) {
        showToast('当前账号无可用模型，请联系管理员');
        latencyProbe.flush('no_model', { force: true });
        return;
    }
    const enableThinking = els.checkThinking ? els.checkThinking.checked : true;
    const enableSearch = els.checkSearch ? els.checkSearch.checked : true;
    const toolsMode = getToolsMode();
    const enableTools = toolsMode !== 'off';
    const allowHistoryImages = true;
    latencyProbe.mark('history_image_vision_check', {
        has_history_images: !!currentConversationHasImageHistory,
        allow_history_images: !!allowHistoryImages
    });
    const forceContextCompressionRequested = consumeForceContextCompressionOnce();
    const compressionDecision = await maybeConfirmContextCompressionBeforeSend(
        model,
        forceContextCompressionRequested
    );
    latencyProbe.mark('context_compression_preflight', {
        ok: !!(compressionDecision && compressionDecision.ok),
        force: !!(compressionDecision && compressionDecision.forceCompression)
    });
    if (!compressionDecision.ok) return;
    const forceContextCompression = !!compressionDecision.forceCompression;

    if (workspaceComposeWorkspaceId) {
        try {
            await resetWorkspaceDetailComposerSelection(workspaceComposeWorkspaceId);
            latencyProbe.mark('workspace_reset_conversation_selection', {
                workspace_id: workspaceComposeWorkspaceId
            });
        } catch (error) {
            console.error('resetWorkspaceDetailComposerSelection failed', error);
            showToast(String((error && error.message) || 'Workspace 对话创建失败'));
            latencyProbe.flush('workspace_reset_selection_failed', { force: true });
            return;
        }
    }

    const hadConversationBeforeEnsure = !!String(currentConversationId || '').trim();
    const ensuredConversationId = await ensureConversationExistsForStreaming(text, nextConversationMode);
    latencyProbe.mark('ensure_conversation', {
        ensured_conversation_id: String(ensuredConversationId || ''),
        had_conversation_before_send: hadConversationBeforeEnsure
    });
    if (ensuredConversationId) {
        currentConversationId = ensuredConversationId;
        if (nextConversationMode === 'learning') {
            learningHeaderMode = 'learning';
            applyLearningSidebarMode('learning');
            await syncLearningHeaderMode();
            latencyProbe.mark('sync_learning_header_mode');
        }
    }

    if (workspaceComposeWorkspaceId && ensuredConversationId) {
        const registered = await registerWorkspaceDetailConversation(workspaceComposeWorkspaceId, ensuredConversationId);
        latencyProbe.mark('workspace_register_conversation', {
            workspace_id: workspaceComposeWorkspaceId,
            conversation_id: String(ensuredConversationId || ''),
            ok: registered
        });

        if (!registered) {
            latencyProbe.flush('workspace_register_failed', { force: true });
            return;
        }
    }

    let streamConversationId = String(currentConversationId || '').trim();
    const isStreamVisible = () => isCurrentConversation(streamConversationId);
    // UI Updates
    els.messageInput.value = '';
    resizeMessageInput();
    saveMessageDraftToStorage('');

    // Prepare display content
    let displayContent = overrideDisplayContent || text;
    const pendingUserAttachments = [];
    if (uploadedFileIds.length > 0) {
        uploadedFileIds.forEach((f) => {
            if (!f) return;
            if (f.type === 'image') {
                if (f.url) {
                    pendingUserAttachments.push({
                        type: 'image',
                        url: f.url,
                        name: f.name || '',
                        mime: f.mime || '',
                        size: Number(f.size || 0)
                    });
                }
                return;
            }
            if (f.type === 'sandbox_file') {
                pendingUserAttachments.push({
                    type: 'sandbox_file',
                    name: f.name || '',
                    sandbox_path: f.sandbox_path || '',
                    size: Number(f.size || 0)
                });
                return;
            }
            if (f.type === 'text') {
                const textSize = Number(f.size || new Blob([String(f.content || '')]).size || 0);
                pendingUserAttachments.push({
                    type: 'text',
                    name: f.name || 'text',
                    size: textSize
                });
                return;
            }
            pendingUserAttachments.push({
                type: 'file',
                name: f.name || '',
                size: Number(f.size || 0)
            });
        });
    }

    // Add User Message to UI
    if (!isAutoContinue && !useExistingUserMessage) {
        appendMessage({
            role: 'user',
            content: displayContent,
            metadata: pendingUserAttachments.length > 0 ? { attachments: pendingUserAttachments } : {}
        });
        notifyLearningSidebarBridge();
        if (messageHasImageAttachments({ metadata: { attachments: pendingUserAttachments } })) {
            currentConversationHasImageHistory = true;
        }
    }
    
    // Reset auto-scroll
    shouldAutoScroll = true;

    // Separate text files from provider payloads
    let finalMessage = text;
    const fileInputs = [];
    const sandboxPaths = [];
    
    uploadedFileIds.forEach(f => {
        if (f.type === 'text') {
            finalMessage += `\n\n--- Start of File: ${f.name} ---\n${f.content}\n--- End of File: ${f.name} ---\n`;
        } else if (f.type === 'sandbox_file') {
            if (f.sandbox_path) sandboxPaths.push(f.sandbox_path);
        } else if (f.type === 'image') {
            if (f.url) {
                fileInputs.push({
                    type: 'image_url',
                    url: f.url,
                    name: f.name || '',
                    mime: f.mime || ''
                });
            }
        } else {
            if (f.id) fileInputs.push(String(f.id));
        }
    });

    // Prepare API Payload
    const longtermPlanList = Array.isArray(currentConversationLongtermState.plan)
        ? currentConversationLongtermState.plan.map((item) => normalizeLongtermPlanItemText(item)).filter(Boolean)
        : [];
    const longtermContextText = String(currentConversationLongtermState.context || '').trim();
    const learningReaderContextBlocks = buildLearningReaderContextBlocks(nextConversationMode);
    const learningCourseContext = nextConversationMode === 'learning'
        ? getActiveLearningCourseContext()
        : { lectureId: '', courseTitle: '' };
    const payload = {
        message: finalMessage,
        model_name: model,
        conversation_id: currentConversationId,
        workspace_id: workspaceRequestWorkspaceId,
        conversation_mode: nextConversationMode,
        conversation_mode_payload: nextConversationMode === 'longterm' ? {
            task: longtermTaskText || currentConversationLongtermState.task || rawText,
            plan: longtermTriggered && text ? [] : longtermPlanList,
            context: longtermContextText,
            step: String(currentConversationLongtermState.step || '').trim(),
            current_index: Number.isFinite(Number(currentConversationLongtermState.current_index)) ? Number(currentConversationLongtermState.current_index) : -1,
            done_indices: Array.isArray(currentConversationLongtermState.done_indices) ? currentConversationLongtermState.done_indices : [],
        } : (nextConversationMode === 'learning' ? {
            learning: true,
            lecture_id: learningCourseContext.lectureId,
            lecture_title: learningCourseContext.courseTitle,
            interview: !!window.__nexoraInterviewPending,
            system_prompt: '',
            context_blocks: learningReaderContextBlocks,
            active_tool_skills: [],
            meta: {
                source: 'chatdbserver_learning_mode'
            },
        } : {}),
        enable_thinking: enableThinking,
        enable_web_search: enableSearch,
        enable_tools: enableTools,
        tool_mode: nextConversationMode === 'longterm' ? 'force' : (nextConversationMode === 'learning' ? 'force' : toolsMode),
        debug_mode: isDebugConsoleEnabled(),
        file_ids: fileInputs,
        sandbox_paths: sandboxPaths,
        user_attachments: pendingUserAttachments,
        allow_history_images: allowHistoryImages,
        include_context: !!tokenBudgetState.includeContext,
        skip_user_message: isAutoContinue || useExistingUserMessage
    };
    window.__nexoraInterviewPending = false;
    if (options && options.puzzle_submission) {
        payload.puzzle_submission = options.puzzle_submission;
    }
    if (forceContextCompression) {
        payload.force_context_compression = true;
    }

    if (nextConversationMode === 'longterm') {
        currentConversationLongtermState = normalizeLongtermState({
            ...currentConversationLongtermState,
            active: true,
            task: longtermTaskText || currentConversationLongtermState.task || rawText,
            plan: longtermTriggered && text ? [] : longtermPlanList,
            context: longtermContextText,
            step: String(currentConversationLongtermState.step || '').trim(),
        });
        renderLongtermPlanPanel();
        syncLocalConversationModeFlags(currentConversationId, {
            conversation_mode: 'longterm',
            longterm_active: true,
            longterm_current_index: currentConversationLongtermState.current_index,
            longterm_done_indices: currentConversationLongtermState.done_indices,
            longterm: currentConversationLongtermState
        });
    }
    currentConversationLongtermConfirmationInFlight = false;
    
    // Reset files
    uploadedFileIds = [];
    updateFilePreview();

    latencyProbe.mark('server_persists_user_message', {
        reason: 'stream_worker_persists_user_message',
        conversation_id: String(currentConversationId || '')
    });
    payload.skip_user_message = !!(isAutoContinue || useExistingUserMessage);

    latencyProbe.mark('ready_for_stream_fetch', {
        conversation_id: String(currentConversationId || ''),
        skip_user_message: !!payload.skip_user_message,
        agent_online: !!lastAgentOnline,
        tools_mode: toolsMode,
        enable_tools: !!enableTools
    });
    latencyProbe.flush('before_stream_fetch');

    setConversationStreamState(streamConversationId, {
        status: 'running',
        unread: false,
        assistant_index: null,
        is_regenerate: false,
        regenerate_index: null,
        started_at: Date.now(),
        last_seq: 0,
        stopping: false
    });
    releaseLearningSidebarPendingSend({ notify: false });
    syncGenerationStateForCurrentConversation();
    if (isStreamVisible()) {
        beginTokenMiniStreaming(streamConversationId);
    }
    
    // Create Placeholder for AI Response
    const aiMsgId = Date.now().toString(); // Temporary ID
    let aiMsgDiv = appendMessage({ role: 'assistant', content: '', id: aiMsgId, pending: true });
    notifyLearningSidebarBridge();
    const aiMsgIndex = Number(aiMsgDiv && aiMsgDiv.dataset ? aiMsgDiv.dataset.index : NaN);
    setConversationStreamState(streamConversationId, {
        assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null
    });
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
    const toolArgsDeltaSeenByCallId = new Set();
    const debugScopeKey = `chat:${aiMsgId}`;
    let debugReplyText = '';
    if (forceContextCompression && isDebugConsoleEnabled()) {
        appendDebugConsoleEntry({
            direction: 'client->local',
            stage: 'force_context_compression_request',
            title: 'Force Compression',
            payload: {
                applied: true,
                conversation_id: String(currentConversationId || ''),
                model_name: String(model || '')
            }
        });
    }
    const modelBadgeState = {
        modelName: String(model || ''),
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
    syncStreamingModelBadgeEstimate(aiMsgDiv, modelBadgeState, model);
    const streamRenderController = getNexoraChatStreaming().createStreamRenderController({
        document,
        requestAnimationFrame,
        cancelAnimationFrame,
        setTimeout,
        clearTimeout,
        renderStreamBlockMarkdown,
        renderMarkdownWithNewTabLinks,
        renderMathInElementSync: renderMathInElementSyncSafe,
        renderMathSafe,
        renderCompletedStreamMath,
        bindSourceMarkdown,
        rewriteCitationRefsMarkdown,
        highlightCode,
        finishReasoningThinkingBlock,
        placeInteractiveCardsBelowToolChain,
        toStreamRenderDebugSnippet,
        pushStreamRenderDebug
    });
    getNexoraChatStreaming().setupStreamRenderDebugGlobals();

    function toStreamRenderDebugSnippet(text, limit = 120) {
        return getNexoraChatStreaming().toStreamRenderDebugSnippet(text, limit);
    }

    function pushStreamRenderDebug(stage, state, payload = {}) {
        getNexoraChatStreaming().pushStreamRenderDebug(stage, state, payload, {
            conversationId: currentConversationId,
            msgId: aiMsgId
        });
    }

    function ensureStreamBlockState(block) {
        return streamRenderController.ensureStreamBlockState(block);
    }

    function clearLiveMathRenderSchedule(state) {
        return streamRenderController.clearLiveMathRenderSchedule(state);
    }

    function renderMathInElementSyncSafe(root) {
        return getNexoraChatLatex().renderMathInElementSync(root, getChatLatexRenderDeps());
    }

    function renderStreamFragment(rawText, citationMap, root = null) {
        return streamRenderController.renderStreamFragment(rawText, citationMap, root);
    }

    function renderLiveStreamTail(block, citationMap) {
        return streamRenderController.renderLiveStreamTail(block, citationMap);
    }

    function flushStableStreamTail(block, citationMap, force = false) {
        return streamRenderController.flushStableStreamTail(block, citationMap, force);
    }

    function finalizeStreamingContentRender() {
        return streamRenderController.finalizeStreamingContentRender(aiMsgDiv);
    }

    function ensureVisibleAssistantStreamBinding() {
        if (!isStreamVisible()) return aiMsgDiv;
        if (aiMsgDiv && aiMsgDiv.isConnected) return aiMsgDiv;

        let visibleDiv = Number.isFinite(aiMsgIndex)
            ? document.querySelector(`.message.assistant[data-index="${aiMsgIndex}"]`)
            : null;

        if (!visibleDiv) {
            visibleDiv = appendMessage(
                { role: 'assistant', content: '', id: aiMsgId, pending: true },
                Number.isFinite(aiMsgIndex) ? aiMsgIndex : undefined
            );
        }

        if (!visibleDiv) return aiMsgDiv;

        aiMsgDiv = visibleDiv;
        aiMsgDiv.classList.add('pending');
        aiMsgDiv.dataset.localOnly = '1';
        aiMsgDiv.dataset.streamId = String((getConversationStreamState(streamConversationId) || {}).stream_id || '');

        if (!aiMsgDiv.__citationUrlMap) {
            aiMsgDiv.__citationUrlMap = {};
        }

        aiMsgDiv.__toolCallState = {
            seq: 0,
            pendingByName: {},
            callIdByIndex: {},
            pendingQueue: [],
            explicitIdByLocalId: {},
            activeAnonCallId: '',
            argsDeltaSeenByCallId: {}
        };
        updateMessageModelBadge(aiMsgDiv, modelBadgeState);

        currentContentSpan = null;
        currentSegmentContent = String(currentFullContent || '');

        if (currentSegmentContent) {
            currentContentSpan = createContentSpan(aiMsgDiv);
            currentContentSpan.dataset.streamRaw = currentSegmentContent;
            currentContentSpan.dataset.streamLive = '1';
            const streamState = ensureStreamBlockState(currentContentSpan);

            if (streamState) {
                streamState.liveRaw = currentSegmentContent;
                flushStableStreamTail(currentContentSpan, aiMsgDiv.__citationUrlMap || {}, false);
            } else {
                renderStreamingContentSegment(aiMsgDiv, currentContentSpan, currentSegmentContent, 'rebind-live-segment');
            }
        }

        console.debug('[StreamAttach] rebound visible assistant node', {
            conversation_id: streamConversationId,
            stream_id: String((getConversationStreamState(streamConversationId) || {}).stream_id || ''),
            assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null,
            content_chars: currentSegmentContent.length
        });

        return aiMsgDiv;
    }
    
    // Create new abort controller
    const streamAbortController = new AbortController();
    setConversationStreamState(streamConversationId, { controller: streamAbortController });
    syncGenerationStateForCurrentConversation();
    clearActiveStreamResumeState();

    try {
        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            credentials: 'include',
            body: JSON.stringify(payload),
            signal: streamAbortController.signal
        });
        latencyProbe.mark('stream_fetch_headers', {
            status: Number(res.status || 0),
            content_type: String(res.headers.get('content-type') || '')
        });
        latencyProbe.flush('stream_fetch_headers');

        const headerStreamId = String(res.headers.get('X-Stream-Id') || '').trim();
        if (headerStreamId) {
            if (aiMsgDiv) {
                aiMsgDiv.dataset.streamId = headerStreamId;
            }
            saveActiveStreamResumeState({
                stream_id: headerStreamId,
                conversation_id: streamConversationId,
                assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null,
                is_regenerate: false,
                regenerate_index: null,
                started_at: Date.now(),
                last_seq: 0
            });
            setConversationStreamState(streamConversationId, {
                stream_id: headerStreamId,
                status: 'running',
                unread: false,
                assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null,
                is_regenerate: false,
                regenerate_index: null,
                last_seq: 0,
                stopping: false
            });

            if (!isStreamVisible()) {
                markStreamControllerDetachOnly(streamAbortController, {
                    conversation_id: streamConversationId,
                    stream_id: headerStreamId,
                    reason: 'headers_after_navigation'
                });
            }
        }

        if (!res.ok) {
            const errMsg = await readErrorMessageFromResponse(res, `HTTP ${res.status}`);
            throw new Error(errMsg);
        }
        if (!isSseResponse(res)) {
            const errMsg = await readErrorMessageFromResponse(res, '服务端未返回流式响应');
            throw new Error(errMsg);
        }
        if (!res.body) {
            throw new Error('stream body is empty');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (value) {
                buffer += decoder.decode(value, { stream: !done });
            }
            if (done) {
                // Flush decoder internal buffer, then parse tail buffer as complete lines.
                buffer += decoder.decode();
            }
            const lines = buffer.split('\n');
            buffer = done ? '' : (lines.pop() || ''); // Keep last incomplete line only while streaming

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') {
                        streamCompleted = true;
                        markConversationStreamFinished(streamConversationId);
                        syncGenerationStateForCurrentConversation();
                        continue;
                    }
                    try {
                        const chunk = JSON.parse(jsonStr);
                        
                        if (chunk.type === 'stream_session') {
                            const sid = String(chunk.stream_id || '').trim();
                            if (isTerminalStreamSessionChunk(chunk)) {
                                const finalCid = String(chunk.conversation_id || streamConversationId || currentConversationId || '').trim();
                                if (finalCid && finalCid !== streamConversationId) {
                                    moveConversationStreamState(streamConversationId, finalCid);
                                    streamConversationId = finalCid;
                                } else if (finalCid) {
                                    streamConversationId = finalCid;
                                }
                                streamCompleted = true;
                                clearActiveStreamResumeState();
                                markConversationStreamFinished(streamConversationId, {
                                    error: String(chunk.error || '').trim()
                                });
                                continue;
                            }
                            if (sid) {
                                if (aiMsgDiv) {
                                    aiMsgDiv.dataset.streamId = sid;
                                }
                                const sessionCid = String(chunk.conversation_id || streamConversationId || currentConversationId || '').trim();
                                if (sessionCid && sessionCid !== streamConversationId) {
                                    moveConversationStreamState(streamConversationId, sessionCid);
                                    streamConversationId = sessionCid;
                                } else if (sessionCid) {
                                    streamConversationId = sessionCid;
                                }
                                saveActiveStreamResumeState({
                                    stream_id: sid,
                                    conversation_id: String(chunk.conversation_id || streamConversationId || currentConversationId || '').trim(),
                                    assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null,
                                    is_regenerate: false,
                                    regenerate_index: null,
                                    started_at: Date.now(),
                                    last_seq: 0
                                });
                                setConversationStreamState(streamConversationId, {
                                    stream_id: sid,
                                    status: 'running',
                                    unread: false,
                                    assistant_index: Number.isFinite(aiMsgIndex) ? aiMsgIndex : null,
                                    is_regenerate: false,
                                    regenerate_index: null,
                                    last_seq: 0,
                                    stopping: false
                                });

                                if (!isStreamVisible()) {
                                    markStreamControllerDetachOnly(streamAbortController, {
                                        conversation_id: streamConversationId,
                                        stream_id: sid,
                                        reason: 'session_after_navigation'
                                    });
                                }
                            }
                        }

                        if (Number.isFinite(Number(chunk._stream_seq))) {
                            patchActiveStreamResumeState({
                                last_seq: Number(chunk._stream_seq)
                            });
                            setConversationStreamState(streamConversationId, {
                                last_seq: Number(chunk._stream_seq)
                            });
                        }

                        if (chunk.type === 'stream_cancel_requested') {
                            streamAbortedByUser = true;
                            setConversationStreamState(streamConversationId, {
                                stopping: true,
                                monitoring: false
                            });
                            syncGenerationStateForCurrentConversation();
                            try {
                                streamAbortController.abort();
                            } catch (abortError) {
                                console.error('[StreamCancel] abort after cancel event failed', abortError);
                            }
                            continue;
                        }

                        if (chunk.conversation_id) {
                            const incomingCid = String(chunk.conversation_id || '').trim();
                            const previousStreamCid = String(streamConversationId || '').trim();
                            if (incomingCid && incomingCid !== previousStreamCid) {
                                moveConversationStreamState(previousStreamCid, incomingCid);
                                streamConversationId = incomingCid;
                            } else if (incomingCid) {
                                streamConversationId = incomingCid;
                            }
                            patchActiveStreamResumeState({
                                conversation_id: incomingCid
                            });
                            setConversationStreamState(streamConversationId, {
                                conversation_id: streamConversationId
                            });
                            const activeCid = String(currentConversationId || '').trim();
                            const streamWasCurrent = !activeCid || activeCid === previousStreamCid || activeCid === incomingCid;
                            if (incomingCid && streamWasCurrent) {
                                const oldCid = activeCid;
                                currentConversationId = incomingCid;
                                if (incomingCid !== oldCid) {
                                    syncNotesForConversation(incomingCid);
                                }
                                noteTokenMiniConversationId(chunk.conversation_id);
                            }
                        }

                        ensureVisibleAssistantStreamBinding();

                        if (chunk.type === 'model_info') {
                            modelBadgeState.modelName = String(chunk.model_name || modelBadgeState.modelName || '');
                            modelBadgeState.searchFlag = (typeof chunk.search_enabled === 'boolean') ? chunk.search_enabled : modelBadgeState.searchFlag;
                            updateMessageModelBadge(aiMsgDiv, modelBadgeState);
                        }
                        else if (chunk.type === 'prompt_token_profile') {
                            if (isStreamVisible()) {
                                applyPromptTokenProfileChunk(chunk);
                            }
                        }
                        else if (chunk.type === 'debug_trace') {
                            appendDebugTraceChunk(chunk, debugScopeKey);
                        }
                        
                        else if (chunk.type === 'content') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
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
                                    console.warn('[StreamSanitize] stripped echoed history time marker from live stream chunk');
                                }

                                if (!chunkContent) {
                                    continue;
                                }
                            }

                            currentFullContent += chunkContent;
                            if (isStreamVisible()) {
                                onTokenStreamTextChunk(chunkContent);
                            }
                            const planInfo = applyLongtermPlanFromText(currentFullContent, { source: 'live-stream', messageDiv: aiMsgDiv });
                            const displayFullContent = String(planInfo && planInfo.text !== undefined ? planInfo.text : currentFullContent || '');
                            if (displayFullContent !== currentFullContent) {
                                currentFullContent = displayFullContent;
                            }
                            if (isDebugConsoleEnabled()) {
                                debugReplyText = currentFullContent;
                                appendDebugConsoleEntry({
                                    direction: 'model->server',
                                    stage: 'model_reply',
                                    title: 'Model Reply',
                                    payload: debugReplyText,
                                    replaceKey: `${debugScopeKey}:reply`
                                });
                            }
                            
                            if (aiMsgDiv.__contentAfterGeneratedImage) {
                                currentContentSpan = createContentSpan(aiMsgDiv, { afterGeneratedImage: true });
                                currentSegmentContent = '';
                                aiMsgDiv.__contentAfterGeneratedImage = false;
                            } else if (!currentContentSpan || !currentContentSpan.isConnected) {
                                currentContentSpan = createContentSpan(aiMsgDiv);
                            }

                            currentSegmentContent += chunkContent;
                            const segmentPlanInfo = applyLongtermPlanFromText(currentSegmentContent, { source: 'live-segment', messageDiv: aiMsgDiv });
                            const displaySegmentContent = String(segmentPlanInfo && segmentPlanInfo.text !== undefined ? segmentPlanInfo.text : currentSegmentContent || '');
                            currentContentSpan.dataset.streamRaw = displaySegmentContent;
                            currentContentSpan.dataset.streamLive = '1';
                            const streamState = ensureStreamBlockState(currentContentSpan);
                            if (streamState) {
                                streamState.liveRaw = displaySegmentContent;
                                flushStableStreamTail(currentContentSpan, aiMsgDiv.__citationUrlMap || {}, false);
                            }
                            syncStreamingModelBadgeEstimate(aiMsgDiv, modelBadgeState, model);
                        } 
                        else if (chunk.type === 'reasoning_content') { 
                           if (isStreamVisible()) {
                               onTokenStreamReasoningChunk(chunk.content);
                           }
                           const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                           const wasReasoningSegmentOpen = !!aiMsgDiv.__reasoningSegmentOpen;
                           const thinkingBlock = resolveReasoningThinkingBlockForAppend(aiMsgDiv, msgContentContainer);
                            const contentDiv = thinkingBlock.querySelector('.thinking-content');
                            const currentRaw = readReasoningContentRaw(contentDiv);
                            const appendText = buildReasoningAppendText(
                                currentRaw,
                                chunk.content || '',
                                !wasReasoningSegmentOpen
                            );
                            const nextRaw = `${currentRaw}${appendText}`;
                            contentDiv.dataset.streamRaw = nextRaw;
                            const streamState = ensureStreamBlockState(contentDiv);
                            if (streamState) {
                                streamState.liveRaw += appendText;
                                flushStableStreamTail(contentDiv, aiMsgDiv.__citationUrlMap || {}, false);
                            } else {
                                contentDiv.textContent = nextRaw;
                             }
                             markReasoningThinkingBlockLive(thinkingBlock);
                             updateThinkingBlockSummary(thinkingBlock, nextRaw);
                               syncStreamingModelBadgeEstimate(aiMsgDiv, modelBadgeState, model);
                        }
                        else if (chunk.type === 'context_compression_status') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            updateMessageDivTools(aiMsgIndex, chunk, aiMsgDiv);
                        }
                        // --- New Chunk Types Support ---
                        else if (chunk.type === 'web_search') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            updateWebSearchStatus(aiMsgDiv, chunk.status, chunk.query, chunk.content);
                        }
                        else if (chunk.type === 'search_meta') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            appendSearchMeta(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'function_call_delta') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            const toolName = resolveToolNameFromEvent(chunk);
                            if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'learning_card' || toolName === 'puzzle') {
                                continue;
                            }
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'delta', rawCallId, toolIndex);
                            if (rawCallId) {
                                toolArgsDeltaSeenByCallId.add(rawCallId);
                                rememberToolArgsDeltaSeen(aiMsgDiv, rawCallId);
                            }
                            if (isStreamVisible()) {
                                onTokenStreamToolArgsChunk(chunk.arguments_delta || chunk.delta || '');
                            }
                            appendToolCallDelta(aiMsgDiv, {
                                ...chunk,
                                name: toolName || chunk.name,
                                call_id: callId,
                                __raw_call_id: rawCallId,
                                __tool_index: toolIndex
                            });
                            await yieldToolStreamPaintForChunk(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'function_call') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            const toolName = resolveToolNameFromEvent(chunk, chunk.name);
                            if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'learning_card' || toolName === 'puzzle') {
                                continue;
                            }
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'call', rawCallId, toolIndex);
                            rememberJsExecuteCanvasCall(aiMsgDiv, toolName, callId, toolIndex, chunk.arguments || '');
                            // 某些 provider 不发 delta，只在 done 里给完整 arguments；这种情况也要计入估算
                            if (!rawCallId || (!toolArgsDeltaSeenByCallId.has(rawCallId) && !hasToolArgsDeltaSeen(aiMsgDiv, rawCallId))) {
                                if (isStreamVisible()) {
                                    onTokenStreamToolArgsChunk(chunk.arguments || '');
                                }
                            }
                            // Special handling for addBasis to show content
                            if (toolName === 'knowledge_basis_create' || toolName === 'add_basis' || toolName === 'addBasis') {
                                try {
                                    const args = JSON.parse(chunk.arguments);
                                    appendAddBasisView(aiMsgDiv, args);
                                } catch(e) { console.error("Error parsing addBasis args", e); }
                            }
                            finalizeToolCallBadge(aiMsgDiv, toolName, callId, chunk.arguments, { toolIndex });
                            syncStreamingModelBadgeEstimate(aiMsgDiv, modelBadgeState, model);
                            await yieldToolStreamPaintForChunk(aiMsgDiv, chunk, true);
                        }
                        else if (chunk.type === 'function_call_running') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            updateMessageDivTools(aiMsgIndex, chunk, aiMsgDiv);
                            syncStreamingModelBadgeEstimate(aiMsgDiv, modelBadgeState, model);
                            await yieldToolStreamPaintForChunk(aiMsgDiv, chunk, true);
                        }
                        else if (chunk.type === 'function_result') {
                            aiMsgDiv.__reasoningSegmentOpen = false;
                            currentContentSpan = null; currentSegmentContent = '';
                            const toolName = resolveToolNameFromEvent(chunk, chunk.name);
                            if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'learning_card' || toolName === 'puzzle') {
                                continue;
                            }
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'result', rawCallId, toolIndex);
                            updateLastToolResult(aiMsgDiv, toolName, chunk.result, callId, {
                                toolIndex,
                                modelVisibleResult: chunk.model_visible_result
                            });
                            if (toolName === 'longterm_plan' || toolName === 'longterm_update') {
                                applyLongtermPlanFromText(chunk.result, { source: 'function_result', messageDiv: aiMsgDiv });
                            }
                        }
                        else if (chunk.type === 'learning_card') {
                            appendLearningCardStep(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'question') {
                            appendQuestionStep(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'puzzle') {
                            appendPuzzleStep(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'token_usage') {
                            if (isStreamVisible()) {
                                onTokenStreamUsageChunk(chunk);
                            }
                            applyUsageChunkToBadgeState(modelBadgeUsageState, chunk);
                            modelBadgeState.inputTokens = modelBadgeUsageState.input;
                            modelBadgeState.outputTokens = modelBadgeUsageState.output;
                            updateMessageModelBadge(aiMsgDiv, modelBadgeState);
                        }
                        else if (chunk.type === 'title') {
                            if(String(currentConversationId || '').trim() === String(streamConversationId || '').trim() && els.conversationTitle) {
                                els.conversationTitle.textContent = chunk.title;
                            }
                        }
                        else if (chunk.type === 'error') {
                            streamEndedWithError = true;
                            streamErrorRetryable = !!chunk.retryable;
                            streamErrorCode = String(chunk.error_code || '').trim().toLowerCase();
                            streamErrorMessage = String(chunk.content || 'Unknown error').trim() || 'Unknown error';
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
                                appendErrorEvent(aiMsgDiv, streamErrorMessage);
                                if (isStreamVisible()) {
                                    showToast('连接中断，可刷新页面后自动重连此条回复');
                                }
                            } else {
                                if (isStreamVisible()) {
                                    showToast(streamErrorMessage);
                                }
                            }
                        }
                        scheduleLearningSidebarBridgeNotify();
                    } catch (e) { console.error("Parse error", e); }
                }
            }
             // Auto-scroll
             if (shouldAutoScroll && isStreamVisible()) {
                // 流式内容和 Markdown/LaTeX 二次渲染会继续改变高度，这里用可中断短 pin 保持贴底。
                pinMessagesToBottomFor(700);
             }

             if (done) {
                            const finalPlanInfo = applyLongtermPlanFromText(currentFullContent, { source: 'done', messageDiv: aiMsgDiv });
                            const finalDisplayContent = String(finalPlanInfo && finalPlanInfo.text !== undefined ? finalPlanInfo.text : currentFullContent || '');
                            if (finalDisplayContent !== currentFullContent) {
                                currentFullContent = finalDisplayContent;
                                if (currentContentSpan) {
                                    currentContentSpan.dataset.streamRaw = finalDisplayContent;
                                }
                            }
                streamCompleted = true;
                aiMsgDiv.dataset.localOnly = '0';
                finalizeStreamingContentRender();
                getNexoraChatTools().collapseResolvedToolUsages(aiMsgDiv);
                setTimeout(() => collapseReasoningBlocksForMessage(aiMsgDiv), 420);
                break;
             }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            if (streamAbortController.__nexoraDetachOnly) {
                streamDetachedByNavigation = true;
            } else {
                streamAbortedByUser = true;
                appendDebugConsoleEntry({
                    direction: 'client->local',
                    stage: 'abort',
                    title: 'Generation Aborted',
                    payload: { content: '[Generation Terminated by User]' }
                });
            }
        } else {
            const errText = String((e && e.message) || e || 'Unknown error');
            const isRetryableNetwork = isLikelyRetryableNetworkErrorText(errText);
            streamEndedWithError = true;
            streamErrorRetryable = !!isRetryableNetwork;
            streamErrorCode = isRetryableNetwork ? 'network_error' : 'client_exception';
            streamErrorMessage = errText;
            if (e && typeof e === 'object') {
                try { e.message = isRetryableNetwork ? '连接中断，可刷新页面后自动重连此条回复' : errText; } catch (_) {}
            }
            appendDebugConsoleEntry({
                direction: 'client->local',
                stage: 'exception',
                title: 'Client Exception',
                payload: { message: e.message || 'Unknown error' }
            });
            if (isRetryableNetwork) {
                appendErrorEvent(aiMsgDiv, e.message || 'Unknown error');
            }
            if (isStreamVisible()) {
                showToast(String((e && e.message) || '发送失败'));
            }
        }
        syncGenerationStateForCurrentConversation();
    } finally {
        finalizeStreamingContentRender();
        const streamErroredRetryable = !!(streamEndedWithError && (streamErrorRetryable || streamErrorCode === 'network_error'));
        const streamEndedTerminally = !!(streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable));
        let streamServerFinalized = true;
        if (streamEndedTerminally) {
            markConversationStreamFinished(streamConversationId, {
                error: streamEndedWithError ? (streamErrorMessage || 'stream_error') : ''
            });
        } else if (streamDetachedByNavigation) {
            const existingState = getConversationStreamState(streamConversationId);
            const ownsController = !!(existingState && existingState.controller === streamAbortController);
            const latestState = setConversationStreamState(streamConversationId, {
                status: 'running',
                ...(ownsController ? { controller: null, monitoring: false } : {})
            });

            if (shouldAutoAttachDetachedStream(streamAbortController)) {
                attachDetachedStreamConsumer(streamConversationId, latestState);
            }
        } else if (streamErroredRetryable) {
            setConversationStreamState(streamConversationId, {
                status: 'running',
                controller: null,
                monitoring: false,
                error: streamErrorMessage || ''
            });
        }
        syncGenerationStateForCurrentConversation();
        if (streamAbortedByUser && !streamCompleted) {
            aiMsgDiv.dataset.localOnly = '1';
            showToast('已中断，正在保存已输出内容');
            const activeStreamId = String(
                (aiMsgDiv && aiMsgDiv.dataset && aiMsgDiv.dataset.streamId)
                || ''
            ).trim();
            streamServerFinalized = await waitForStreamServerFinalized(activeStreamId, streamConversationId);

            if (!streamServerFinalized && isStreamVisible()) {
                showToast('已中断，服务端仍在保存已输出内容');
            }
        }
        if (streamEndedWithError && !streamErroredRetryable) {
            const terminalText = renderAssistantTerminalErrorMessage(
                aiMsgDiv,
                aiMsgIndex,
                currentFullContent,
                streamErrorMessage || '请求失败'
            );
            currentFullContent = terminalText;
            aiMsgDiv.dataset.localOnly = '1';
        }
        if (streamCompleted || streamAbortedByUser || (streamEndedWithError && !streamErroredRetryable)) {
            clearActiveStreamResumeState();
        }
        if (streamEndedTerminally) {
            aiMsgDiv.classList.remove('pending');
        }
        if (nextConversationMode === 'longterm' && String(currentConversationId || '').trim() === String(streamConversationId || '').trim()) {
            currentConversationLongtermState = normalizeLongtermState({
                ...currentConversationLongtermState,
                active: streamErroredRetryable ? true : false,
                task: longtermTaskText || currentConversationLongtermState.task || rawText,
                plan: currentConversationLongtermState.plan || []
            });
            renderLongtermPlanPanel();
            syncLocalConversationModeFlags(streamConversationId, {
                conversation_mode: 'longterm',
                longterm_active: streamErroredRetryable ? true : false,
                longterm: currentConversationLongtermState
            });
        }
        currentConversationLongtermAutoContinueKind = '';
        if (isStreamVisible()) {
            await finishTokenMiniStreaming(streamConversationId);
        }
        if (streamEndedTerminally && isStreamVisible() && (!streamAbortedByUser || streamServerFinalized)) {
            await renderConversationSnapshotFromServer(streamConversationId, {
                instant: true,
                silent: true,
                render: !(streamCompleted && !streamAbortedByUser && !streamEndedWithError),
                preserveScrollAnchor: true
            });
        }
        loadConversations(); // Update list preview
        if (String(currentConversationId || '').trim() === String(streamConversationId || '').trim()) {
            loadKnowledge(streamConversationId); // Refresh knowledge
        }
        currentConversationLongtermConfirmationInFlight = false;
        scheduleLearningSidebarBridgeNotify(0);
    }
}

function updateWebSearchStatus(aiMsgDiv, status, query, fullContent, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const safeQuery = String(query || '').trim();
    // In history mode, we don't look for existing badges to update; we just append.
    let badge = null;
    if (!isHistory) {
        const rows = parent.querySelectorAll('.tool-usage[data-tool-name="Web Search"]');
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.dataset.pending !== 'true') continue;
            if (!safeQuery || !row.dataset.query || row.dataset.query === safeQuery) {
                badge = row;
                break;
            }
        }
    }
    
    // Construct display text
    let displayText = status || fullContent;
    
    if (!badge) {
        // Create new
        const div = document.createElement('div');
        div.className = 'tool-usage execution-flow-item';
        div.dataset.toolName = 'Web Search';
        applyToolExecutionFlowKind(div, 'Web Search');
        div.dataset.query = query || ''; // Store query
        div.dataset.pending = 'true';
        div.dataset.resolved = 'false';
        
        const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        
        div.innerHTML = `
            <div class="tool-badge execution-flow-header">
                <span class="execution-flow-node" aria-hidden="true">${iconSvg}</span>
                <span class="execution-flow-main">
                    <span class="tool-name execution-flow-title" title="Web Search">搜索网页</span>
                </span>
                <span class="tool-status execution-flow-summary"></span>
                <span class="tool-toggle" aria-hidden="true">▸</span>
            </div>
            <div class="tool-output"></div>
        `;
        
        // 始终追加到末尾以保持时间线次序
        parent.appendChild(div);
        bindToolUsageToggle(div);
        placeCanvasCardsBelowToolChain(aiMsgDiv);
        
        badge = div;
    }
    
    // Update Logic
    // If we have a new query, update stored
    if (query) badge.dataset.query = query;
    const currentQuery = badge.dataset.query;
    
    if (currentQuery) {
        displayText = `${status}: ${currentQuery}`;
    }
    
    setToolUsageStatus(badge, displayText);

    // 完成态后关闭复用；下一次搜索必须 append 新行
    const doneText = String(status || '').toLowerCase();
    const isDone = doneText.includes('完成') || doneText.includes('completed') || doneText.includes('done');
    if (isDone) {
        badge.dataset.pending = 'false';
        badge.dataset.resolved = 'true';
    }
}

function appendSearchMeta(aiMsgDiv, meta, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const toolName = 'Web Search Meta';
    let row = null;
    if (!isHistory) {
        const rows = parent.querySelectorAll('.tool-usage[data-tool-name="Web Search Meta"]');
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].dataset.pending === 'true') {
                row = rows[i];
                break;
            }
        }
    }
    if (!row) {
        row = appendToolEvent(aiMsgDiv, toolName, '来源已捕获', false, {
            reuseIfExists: false,
            pending: true
        });
    }
    if (!row) return;

    const searchResults = Array.isArray(meta && meta.search_results) ? meta.search_results : [];
    const citations = Array.isArray(meta && meta.citations) ? meta.citations : [];
    const usage = (meta && typeof meta.usage === 'object' && meta.usage) ? meta.usage : {};
    const plugins = (usage && typeof usage.plugins === 'object' && usage.plugins) ? usage.plugins : {};
    const requestId = String((meta && meta.request_id) || '').trim();

    const statusEl = row.querySelector('.tool-status');
    if (statusEl) statusEl.textContent = `sources=${searchResults.length}, citations=${citations.length}`;

    // Save citation map for stream-time markdown rewrite
    const citationMap = {};
    citations.forEach((c) => {
        const idx = Number(c && c.index ? c.index : 0);
        const url = String((c && c.url) || '').trim();
        if (idx > 0 && url) citationMap[idx] = url;
    });
    aiMsgDiv.__citationUrlMap = citationMap;

    const lines = [];
    if (requestId) lines.push(`request_id: ${requestId}`);
    if (plugins && Object.keys(plugins).length > 0) lines.push(`plugins: ${JSON.stringify(plugins)}`);
    if (citations.length > 0) {
        lines.push('');
        lines.push('Citations:');
        citations.forEach((c) => {
            const idx = Number(c && c.index ? c.index : 0);
            const title = String((c && c.title) || '').trim();
            const url = String((c && c.url) || '').trim();
            lines.push(`- [${idx || '?'}] ${title || '(no title)'}${url ? ` | ${url}` : ''}`);
        });
    }
    if (searchResults.length > 0) {
        lines.push('');
        lines.push('Search Results:');
        searchResults.slice(0, 12).forEach((r) => {
            const idx = Number(r && r.index ? r.index : 0);
            const title = String((r && r.title) || '').trim();
            const site = String((r && r.site_name) || '').trim();
            const url = String((r && r.url) || '').trim();
            lines.push(`- [${idx || '?'}] ${site ? `${site} · ` : ''}${title || '(no title)'}${url ? ` | ${url}` : ''}`);
        });
        if (searchResults.length > 12) {
            lines.push(`... (${searchResults.length - 12} more)`);
        }
    }

    const outDiv = row.querySelector('.tool-output');
    if (outDiv) {
        outDiv.textContent = lines.join('\n').trim() || 'No search metadata';
        if (outDiv.textContent.trim()) {
            row.classList.add('has-output');

            if (row.dataset.userToggled !== 'true') {
                row.classList.add('expanded');
                scrollToolOutputToTop(outDiv);
            }
        }
    }
    row.dataset.pending = 'false';
    row.dataset.resolved = 'true';
}

function appendErrorEvent(aiMsgDiv, message, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'tool-usage tool-error execution-flow-item';
    div.dataset.toolName = 'Error';
    applyToolExecutionFlowKind(div, 'Error');
    const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    div.innerHTML = `
        <div class="tool-badge execution-flow-header">
            <span class="execution-flow-node" aria-hidden="true">${iconSvg}</span>
            <span class="execution-flow-main">
                <span class="tool-name execution-flow-title" title="Error">发生错误</span>
            </span>
            <span class="tool-status execution-flow-summary">${escapeHtml(clipExecutionFlowText(message || '', 112))}</span>
            <span class="tool-toggle" aria-hidden="true">▸</span>
        </div>
        <div class="tool-output"></div>
    `;
    parent.appendChild(div);
    bindToolUsageToggle(div);
    placeCanvasCardsBelowToolChain(aiMsgDiv);
}

function appendAddBasisView(aiMsgDiv, args) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'add-basis-view';
    div.innerHTML = `
        <div class="add-basis-header">
            <span>ADDED KNOWLEDGE: ${args.title || 'Untitled'}</span>
            <span style="font-weight:normal; color:#999;">${(args.context || '').length} chars</span>
        </div>
        <div class="add-basis-content">${args.context || ''}</div>
    `;
    parent.appendChild(div);
    placeCanvasCardsBelowToolChain(aiMsgDiv);
}

function appendToolEvent(aiMsgDiv, name, details, isFunction = false, options = {}) {
    return toolEventController.appendToolEvent(aiMsgDiv, name, details, isFunction, options);
}

function bindToolUsageToggle(toolEl) {
    return toolEventController.bindToolUsageToggle(toolEl);
}

function findToolUsage(...args) {
    return getNexoraChatTools().findToolUsage(...args);
}

function findToolUsageByPhase(...args) {
    return getNexoraChatTools().findToolUsageByPhase(...args);
}

function getToolCallState(...args) {
    return getNexoraChatTools().getToolCallState(...args);
}

function rememberToolArgsDeltaSeen(...args) {
    return getNexoraChatTools().rememberToolArgsDeltaSeen(...args);
}

function hasToolArgsDeltaSeen(...args) {
    return getNexoraChatTools().hasToolArgsDeltaSeen(...args);
}

function removePendingToolCallId(...args) {
    return getNexoraChatTools().removePendingToolCallId(...args);
}

function rememberPendingToolCallId(...args) {
    return getNexoraChatTools().rememberPendingToolCallId(...args);
}

function migratePendingToolCallId(...args) {
    return getNexoraChatTools().migratePendingToolCallId(...args);
}

function allocateToolCallId(...args) {
    return getNexoraChatTools().allocateToolCallId(...args);
}

function formatToolArgsForOutput(argsRaw) {
    return toolEventController.formatToolArgsForOutput(argsRaw);
}

function isCompleteJsonText(raw) {
    return toolEventController.isCompleteJsonText(raw);
}

function shouldSplitToolArgsStream(existingRaw, incomingDelta) {
    return toolEventController.shouldSplitToolArgsStream(existingRaw, incomingDelta);
}

function beginNewAnonymousToolCall(aiMsgDiv, name) {
    return toolEventController.beginNewAnonymousToolCall(aiMsgDiv, name);
}

function formatToolDeltaStatus(argsRaw) {
    return toolEventController.formatToolDeltaStatus(argsRaw);
}

function normalizeToolDisplayName(...args) {
    return getNexoraChatTools().normalizeToolDisplayName(...args);
}

function resolveToolNameFromEvent(...args) {
    return getNexoraChatTools().resolveToolNameFromEvent(...args);
}

function renameToolUsageRow(row, name) {
    return toolEventController.renameToolUsageRow(row, name);
}

function setToolUsageStatus(row, statusText) {
    return toolEventController.setToolUsageStatus(row, statusText);
}

function yieldToolStreamPaint() {
    return toolEventController.yieldToolStreamPaint();
}

function getToolStreamPaintDebt(data) {
    return toolEventController.getToolStreamPaintDebt(data);
}

function shouldYieldToolStreamPaintForChunk(data) {
    return toolEventController.shouldYieldToolStreamPaintForChunk(data);
}

async function yieldToolStreamPaintForChunk(messageDiv, data, force = false) {
    return await toolEventController.yieldToolStreamPaintForChunk(messageDiv, data, force);
}

function scrollToolOutputToBottom(outputEl) {
    return toolEventController.scrollToolOutputToBottom(outputEl);
}

function scrollToolOutputToTop(outputEl) {
    return toolEventController.scrollToolOutputToTop(outputEl);
}

function findPendingToolUsageFallback(...args) {
    return getNexoraChatTools().findPendingToolUsageFallback(...args);
}

function ensureToolUsageForDelta(aiMsgDiv, name, callId, toolIndex = null) {
    return toolEventController.ensureToolUsageForDelta(aiMsgDiv, name, callId, toolIndex);
}

function appendToolCallDelta(aiMsgDiv, data) {
    return toolEventController.appendToolCallDelta(aiMsgDiv, data);
}

function finalizeToolCallBadge(aiMsgDiv, name, callId, argumentsText = '', options = {}) {
    return toolEventController.finalizeToolCallBadge(aiMsgDiv, name, callId, argumentsText, options);
}

function findToolUsageForRunning(...args) {
    return getNexoraChatTools().findToolUsageForRunning(...args);
}

function resolveToolCallIdForRunning(...args) {
    return getNexoraChatTools().resolveToolCallIdForRunning(...args);
}

function updateToolCallRunning(aiMsgDiv, data) {
    return toolEventController.updateToolCallRunning(aiMsgDiv, data);
}

function isGenerateImageToolName(name) {
    return toolResultController.isGenerateImageToolName(name);
}

function parseToolResultPayload(result) {
    return toolResultController.parseToolResultPayload(result);
}

function isMapToolName(name) {
    return toolResultController.isMapToolName(name);
}

function readMapResultId(payload) {
    return toolResultController.readMapResultId(payload);
}

function readMapResultConversationId(payload) {
    return toolResultController.readMapResultConversationId(payload);
}

function buildMapResultMarkdown(payload) {
    return toolResultController.buildMapResultMarkdown(payload);
}

function stripMapSceneSection(markdownText) {
    return toolResultController.stripMapSceneSection(markdownText);
}

function readContentBodySourceText(node) {
    return toolResultController.readContentBodySourceText(node);
}

function collectContentMarkdownBeforeNode(parent, stopNode) {
    return toolResultController.collectContentMarkdownBeforeNode(parent, stopNode);
}

function normalizeGenerateImageProgress(payload) {
    return toolResultController.normalizeGenerateImageProgress(payload);
}

function appendGenerateImageProgress(root, progressLogs) {
    return toolResultController.appendGenerateImageProgress(root, progressLogs);
}

function renderGenerateImageToolOutput(outDiv, toolName, result) {
    return toolResultController.renderGenerateImageToolOutput(outDiv, toolName, result);
}

function renderGenerateImageResultInMessage(aiMsgDiv, result, callId, anchorEl) {
    return toolResultController.renderGenerateImageResultInMessage(aiMsgDiv, result, callId, anchorEl);
}

function renderMapResultInMessage(aiMsgDiv, toolName, result, callId, anchorEl) {
    return toolResultController.renderMapResultInMessage(aiMsgDiv, toolName, result, callId, anchorEl);
}

function resolveToolResultDisplayMarkdown(result, options = {}) {
    return toolResultController.resolveToolResultDisplayMarkdown(result, options);
}

function setToolResultMarkdownSource(outDiv, markdownText) {
    return toolResultController.setToolResultMarkdownSource(outDiv, markdownText);
}

function updateLastToolResult(aiMsgDiv, name, result, callId = '', options = {}) {
    return toolResultController.updateLastToolResult(aiMsgDiv, name, result, callId, options);
}

function createContentSpan(parentMsgDiv, options = {}) {
    return messagesController.createContentSpan(parentMsgDiv, options);
}

function appendUserAttachments(contentEl, msg) {
    return messagesController.appendUserAttachments(contentEl, msg);
}

function readMessageRenderIndex(message, defaultIndex = 0) {
    return chatMessageWindowApi.readMessageRenderIndex(message, defaultIndex);
}

function buildIndexedMessageRows(messages, indexOffset = 0) {
    return chatMessageWindowApi.buildIndexedMessageRows(messages, indexOffset);
}

function resetConversationMessageWindowState(conversationId = '') {
    return chatMessageWindowApi.resetConversationMessageWindowState(conversationId);
}

function mergeIndexedMessageRows(firstRows, secondRows) {
    return chatMessageWindowApi.mergeIndexedMessageRows(firstRows, secondRows);
}

function setConversationMessageWindowFromPayload(conversationId, messages, messageWindow) {
    return chatMessageWindowApi.setConversationMessageWindowFromPayload(conversationId, messages, messageWindow);
}

function refreshConversationMessageWindowRange() {
    return chatMessageWindowApi.refreshConversationMessageWindowRange();
}

function syncConversationMessageWindowFromSnapshot(conversationId, messages) {
    return chatMessageWindowApi.syncConversationMessageWindowFromSnapshot(conversationId, messages);
}

function rememberVisibleMessageInWindow(message, messageIndex) {
    return chatMessageWindowApi.rememberVisibleMessageInWindow(currentConversationId, message, messageIndex);
}

function prependConversationMessageRows(indexedRows, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const container = els.messagesContainer;
    const rows = Array.isArray(indexedRows) ? indexedRows : [];

    if (!container || !rows.length) {
        return 0;
    }

    const existingIndices = new Set(
        Array.from(container.querySelectorAll('.message[data-index]'))
            .map((row) => Number(row && row.dataset ? row.dataset.index : NaN))
            .filter((value) => Number.isFinite(value) && value >= 0)
            .map((value) => Math.floor(value))
    );
    const rowsToRender = rows
        .filter((row, position) => {
            const messageIndex = readMessageRenderIndex(row, position);
            return !existingIndices.has(messageIndex);
        })
        .sort((a, b) => readMessageRenderIndex(a, 0) - readMessageRenderIndex(b, 0));

    if (!rowsToRender.length) {
        return 0;
    }

    const anchor = opts.anchor || captureMessagesScrollAnchor(container);
    const firstExistingMessage = container.querySelector('.message');
    const previousBatchState = isBatchRenderingMessages;
    const previousLastUserHint = renderLastUserMessageIndexHint;
    renderLastUserMessageIndexHint = getLastUserMessageIndexFromMessages(conversationMessageWindowState.messages || []);
    isBatchRenderingMessages = true;

    try {
        rowsToRender.forEach((row, position) => {
            appendMessage(row, readMessageRenderIndex(row, position), {
                beforeNode: firstExistingMessage
            });
        });
    } finally {
        isBatchRenderingMessages = previousBatchState;
        renderLastUserMessageIndexHint = previousLastUserHint;
    }

    refreshLastUserPromptEditButtons();
    bindTurnIndicatorDomElements(turnIndicatorState.userMessages || []);
    markTurnIndicatorLayoutDirty();
    scheduleTurnIndicatorLayoutRefresh({ animate: false, forceScroll: false });
    scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
    notifyLearningSidebarBridge();

    if (opts.preserveScroll !== false && anchor) {
        restoreMessagesScrollAnchor(anchor);
        requestAnimationFrame(() => restoreMessagesScrollAnchor(anchor));
        setTimeout(() => restoreMessagesScrollAnchor(anchor), 120);
    }

    return rowsToRender.length;
}

async function loadPreviousConversationMessages(reason = 'scroll', options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const cid = String(currentConversationId || '').trim();
    const state = conversationMessageWindowState;

    if (!cid || state.conversationId !== cid || !state.hasMoreBefore || state.loadingBefore) {
        return false;
    }

    const targetIndexRaw = Number(opts.targetIndex);
    const targetIndex = Number.isFinite(targetIndexRaw) && targetIndexRaw >= 0
        ? Math.floor(targetIndexRaw)
        : null;
    const beforeIndex = Math.max(0, Number(state.loadedStartIndex || 0));
    const targetStartIndex = Math.max(
        0,
        targetIndex !== null && targetIndex < beforeIndex
            ? targetIndex
            : beforeIndex - CONVERSATION_PREVIOUS_MESSAGE_LIMIT
    );
    const requestLimit = Math.max(
        CONVERSATION_PREVIOUS_MESSAGE_LIMIT,
        Math.min(200, beforeIndex - targetStartIndex)
    );

    if (beforeIndex <= 0) {
        state.hasMoreBefore = false;
        return false;
    }

    const container = els.messagesContainer;
    const preserveScroll = opts.preserveScroll !== false;
    const scrollAnchor = preserveScroll ? captureMessagesScrollAnchor(container) : null;
    breakMessagesAutoScroll();
    state.loadingBefore = true;

    try {
        const params = new URLSearchParams();
        params.set('before', String(beforeIndex));
        params.set('limit', String(requestLimit));

        const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}/messages?${params.toString()}`);
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data || !data.success) {
            showToast(String((data && data.message) || '加载更早消息失败'));
            return false;
        }

        const rows = Array.isArray(data.messages) ? data.messages : [];
        const startIndexRaw = Number(data.start_index);
        const startIndex = Number.isFinite(startIndexRaw) && startIndexRaw >= 0
            ? Math.floor(startIndexRaw)
            : Math.max(0, beforeIndex - rows.length);
        const indexedRows = buildIndexedMessageRows(rows, startIndex);

        if (!indexedRows.length) {
            state.hasMoreBefore = false;
            return false;
        }

        state.messages = mergeIndexedMessageRows(state.messages, indexedRows);
        state.total = Math.max(Number(state.total || 0), Number(data.total || 0), state.messages.length);
        state.hasMoreBefore = !!data.has_more_before;
        refreshConversationMessageWindowRange();

        prependConversationMessageRows(indexedRows, {
            preserveScroll,
            anchor: scrollAnchor
        });
        _syncTurnIndicatorVisibility();

        return true;
    } catch (error) {
        showToast(String((error && error.message) || '加载更早消息失败'));
        return false;
    } finally {
        state.loadingBefore = false;
    }
}

function maybeLoadPreviousConversationMessagesFromScroll() {
    const container = els.messagesContainer;

    if (!container || _isJumping) {
        return;
    }

    if (Date.now() > __messagesUserScrollIntentUntilTs) {
        return;
    }

    if (Number(container.scrollTop || 0) > CONVERSATION_HISTORY_LOAD_TOP_PX) {
        return;
    }

    void loadPreviousConversationMessages('scroll');
}

async function ensureConversationMessageIndexLoaded(messageIndex) {
    const targetIndex = Number(messageIndex);

    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
    }

    if (getMessageElementByIndex(targetIndex)) {
        return true;
    }

    let guard = 0;

    while (
        guard < 80
        && conversationMessageWindowState.conversationId === String(currentConversationId || '').trim()
        && conversationMessageWindowState.hasMoreBefore
        && targetIndex < Number(conversationMessageWindowState.loadedStartIndex || 0)
    ) {
        guard += 1;
        const loaded = await loadPreviousConversationMessages('jump', {
            preserveScroll: false,
            targetIndex
        });

        if (!loaded || getMessageElementByIndex(targetIndex)) {
            break;
        }
    }

    return !!getMessageElementByIndex(targetIndex);
}

function getLastUserMessageIndexFromMessages(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    for (let i = arr.length - 1; i >= 0; i -= 1) {
        const role = String((arr[i] && arr[i].role) || '').trim();
        if (role === 'user') return readMessageRenderIndex(arr[i], i);
    }
    return -1;
}

function getLastUserMessageIndexFromDom() {
    return userPromptEditController.getLastUserMessageIndexFromDom();
}

function getNextVisibleMessageIndex() {
    if (!els.messagesContainer) return 0;
    let maxIndex = -1;
    Array.from(els.messagesContainer.querySelectorAll('.message')).forEach((row) => {
        const rowIndex = Number(row && row.dataset ? row.dataset.index : NaN);

        if (Number.isFinite(rowIndex) && rowIndex > maxIndex) {
            maxIndex = Math.floor(rowIndex);
        }
    });

    return maxIndex >= 0 ? maxIndex + 1 : els.messagesContainer.querySelectorAll('.message').length;
}

function resetUserPromptInlineEditor(options = {}) {
    return userPromptEditController.resetUserPromptInlineEditor(options);
}

function refreshLastUserPromptEditButtons() {
    return userPromptEditController.refreshLastUserPromptEditButtons();
}

async function saveEditedUserPrompt(index, options = {}) {
    return userPromptEditController.saveEditedUserPrompt(index, options);
}

window.toggleEditUserPrompt = async function(index) {
    return userPromptEditController.toggleEditUserPrompt(index);
};

function appendMessage(msg, index, options = {}) {
    return messagesController.appendMessage(msg, index, options);
}

function normalizeVariantTimestamp(v) {
    return chatMessageVersionsApi.normalizeVariantTimestamp(v);
}

let __messagesBottomPinRaf = null;
let __messagesBottomPinUntilTs = 0;
let __messagesBottomPinPrevInlineBehavior = null;
let __messagesBottomPinPendingRestoreBehavior = null;
let __messagesBottomResizeObs = null;
let __messagesBottomMutationObs = null;
let __messagesUserScrollIntentUntilTs = 0;
let __messagesLastObservedScrollTop = 0;

function readMessagesBottomDistance(container = els.messagesContainer) {
    if (!container) return 0;

    return Number(container.scrollHeight || 0)
        - Number(container.scrollTop || 0)
        - Number(container.clientHeight || 0);
}

function isMessagesNearBottom(container = els.messagesContainer, tolerancePx = MESSAGES_AUTO_SCROLL_NEAR_BOTTOM_PX) {
    return readMessagesBottomDistance(container) <= tolerancePx;
}

function isEditableScrollIntentTarget(target) {
    if (!(target instanceof Element)) return false;

    return !!target.closest('input, textarea, select, [contenteditable="true"], .CodeMirror, .toastui-editor');
}

function restoreMessagesBottomPinBehavior() {
    const container = els.messagesContainer;
    const restoreBehavior = __messagesBottomPinPendingRestoreBehavior !== null
        ? __messagesBottomPinPendingRestoreBehavior
        : __messagesBottomPinPrevInlineBehavior;

    if (restoreBehavior !== null && container) {
        container.style.scrollBehavior = String(restoreBehavior || '');
    }

    __messagesBottomPinPrevInlineBehavior = null;
    __messagesBottomPinPendingRestoreBehavior = null;
}

function stopMessagesBottomPin() {
    __messagesBottomPinUntilTs = 0;

    if (__messagesBottomPinRaf) {
        cancelAnimationFrame(__messagesBottomPinRaf);
        __messagesBottomPinRaf = null;
    }

    if (__messagesBottomResizeObs) {
        try { __messagesBottomResizeObs.disconnect(); } catch (_) {}
    }

    if (__messagesBottomMutationObs) {
        try { __messagesBottomMutationObs.disconnect(); } catch (_) {}
    }

    restoreMessagesBottomPinBehavior();
}

/**
 * 设置自动滚动开关（供拆分模块写入，避免直接赋值 ESM import 绑定）。
 *
 * @param {boolean} value - 是否自动滚动
 */
function setShouldAutoScroll(value) {
    shouldAutoScroll = !!value;
}

/**
 * 记录最近一次观察到的滚动位置（供拆分模块写入，避免直接赋值 ESM import 绑定）。
 *
 * @param {number} value - 滚动位置
 */
function setMessagesLastObservedScrollTop(value) {
    __messagesLastObservedScrollTop = Number(value || 0);
}

function breakMessagesAutoScroll() {
    shouldAutoScroll = false;
    stopMessagesBottomPin();
}

function markMessagesUserScrollIntent(durationMs = 1200) {
    __messagesUserScrollIntentUntilTs = Date.now() + Math.max(120, Number(durationMs) || 1200);
}

function scrollMessagesToBottomNow() {
    const container = els.messagesContainer;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
    __messagesLastObservedScrollTop = Number(container.scrollTop || 0);
}

function captureMessagesScrollAnchor(container = els.messagesContainer) {
    if (!container) return null;

    const viewportTop = Number(container.scrollTop || 0);
    const rows = Array.from(container.querySelectorAll('.message[data-index]'));

    for (const row of rows) {
        const messageIndex = Number(row && row.dataset ? row.dataset.index : NaN);

        if (!Number.isFinite(messageIndex) || messageIndex < 0) {
            continue;
        }

        const rowTop = Number(row.offsetTop || 0);
        const rowBottom = rowTop + Number(row.offsetHeight || 0);

        if (rowBottom < viewportTop) {
            continue;
        }

        return {
            messageIndex: Math.floor(messageIndex),
            topOffset: rowTop - viewportTop
        };
    }

    return null;
}

function restoreMessagesScrollAnchor(anchor, container = els.messagesContainer) {
    if (!container || !anchor || typeof anchor !== 'object') {
        return false;
    }

    const messageIndex = Number(anchor.messageIndex);

    if (!Number.isFinite(messageIndex) || messageIndex < 0) {
        return false;
    }

    const row = getMessageElementByIndex(messageIndex);

    if (!row) {
        return false;
    }

    container.scrollTop = Math.max(0, Number(row.offsetTop || 0) - Number(anchor.topOffset || 0));
    __messagesLastObservedScrollTop = Number(container.scrollTop || 0);

    return true;
}

function queueMessagesBottomPinScroll() {
    if (__messagesBottomPinRaf) return;

    __messagesBottomPinRaf = requestAnimationFrame(() => {
        __messagesBottomPinRaf = null;

        if (!shouldAutoScroll || Date.now() > __messagesBottomPinUntilTs) {
            stopMessagesBottomPin();
            return;
        }

        scrollMessagesToBottomNow();
    });
}

function pinMessagesToBottomFor(durationMs = 900) {
    const container = els.messagesContainer;
    if (!container) return;

    shouldAutoScroll = true;
    const now = Date.now();
    const dur = Math.max(120, Math.min(5000, Number(durationMs) || 900));
    __messagesBottomPinUntilTs = Math.max(__messagesBottomPinUntilTs, now + dur);

    if (__messagesBottomPinPrevInlineBehavior === null) {
        __messagesBottomPinPrevInlineBehavior = String(container.style.scrollBehavior || '');
    }

    container.style.scrollBehavior = 'auto';
    scrollMessagesToBottomNow();

    // 监听内容变化，而不是只监听容器尺寸。Markdown/LaTeX/工具卡片会在 chunk 后继续撑高内容。
    if (!__messagesBottomResizeObs) {
        __messagesBottomResizeObs = new ResizeObserver(() => {
            if (!shouldAutoScroll || Date.now() > __messagesBottomPinUntilTs) {
                stopMessagesBottomPin();
                return;
            }

            queueMessagesBottomPinScroll();
        });
    }

    if (!__messagesBottomMutationObs) {
        __messagesBottomMutationObs = new MutationObserver(() => {
            if (!shouldAutoScroll || Date.now() > __messagesBottomPinUntilTs) {
                stopMessagesBottomPin();
                return;
            }

            queueMessagesBottomPinScroll();
        });
    }

    try { __messagesBottomResizeObs.disconnect(); } catch (_) {}
    try { __messagesBottomResizeObs.observe(container); } catch (_) {}
    if (container.lastElementChild) {
        try { __messagesBottomResizeObs.observe(container.lastElementChild); } catch (_) {}
    }

    try { __messagesBottomMutationObs.disconnect(); } catch (_) {}
    try {
        __messagesBottomMutationObs.observe(container, {
            childList: true,
            subtree: true,
            characterData: true
        });
    } catch (_) {}

    queueMessagesBottomPinScroll();
}

function variantSignature(v) {
    return chatMessageVersionsApi.variantSignature(v);
}

function isMeaningfulVersionVariant(v) {
    return chatMessageVersionsApi.isMeaningfulVersionVariant(v);
}

function buildVersionNavigation(msg) {
    return chatMessageVersionsApi.buildVersionNavigation(msg);
}

function renderLongtermHookBlock(hook) {
    const src = (hook && typeof hook === 'object') ? hook : {};
    const step = String(src.step || src.title || 'Longterm').trim();
    const title = String(src.title || `模型已完成 ${step || '规划'}`).trim();
    const prompt = (src.prompt && typeof src.prompt === 'object')
        ? src.prompt
        : ((src.details && typeof src.details === 'object')
            ? src.details
            : ((src.payload && typeof src.payload === 'object')
                ? src.payload
                : ((Array.isArray(src.plan) || typeof src.plan === 'string')
                    ? { steps: src.plan }
                    : {})));
    if (prompt && typeof prompt === 'object') {
        if (prompt.raw) delete prompt.raw;
        if (prompt.raw_plan) delete prompt.raw_plan;
        if (prompt.plan && typeof prompt.plan === 'object') {
            if (prompt.plan.raw) delete prompt.plan.raw;
            if (prompt.plan.raw_plan) delete prompt.plan.raw_plan;
        }
    }
    const pretty = (() => {
        try {
            return JSON.stringify(prompt, null, 2);
        } catch (_) {
            return String(prompt || '');
        }
    })();
    const block = document.createElement('div');
    block.className = 'thinking-block longterm-hook-block collapsed';
    block.dataset.streamLive = String(src.streamLive || src.dataStreamLive || '0');
    block.innerHTML = `
        <div class="thinking-header">
            <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19h16"></path>
                <path d="M6 4h12l-1 11H7z"></path>
            </svg>
            <span class="thinking-title">${escapeHtml(title)}</span>
            <span class="longterm-hook-step">${escapeHtml(step ? `已完成 ${step}` : 'Longterm Hook')}</span>
            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>
        <div class="longterm-hook-content">
            <div class="longterm-hook-summary">${escapeHtml(String(title || 'Longterm Hook'))}</div>
            <pre class="longterm-hook-json"></pre>
        </div>
    `;
    const header = block.querySelector('.thinking-header');
    if (header) {
        header.addEventListener('click', () => {
            block.classList.toggle('collapsed');
        });
    }
    const jsonEl = block.querySelector('.longterm-hook-json');
    if (jsonEl) {
        jsonEl.textContent = pretty;
    }
    return block;
}

function getActiveRegenerateStreamRenderPlan(conversationId) {
    return messagesController.getActiveRegenerateStreamRenderPlan(conversationId);
}

function buildRegeneratePendingAssistantMessage(sourceMessage, state = {}) {
    return messagesController.buildRegeneratePendingAssistantMessage(sourceMessage, state);
}

function resolveMessagesForActiveStreamRender(messages) {
    return messagesController.resolveMessagesForActiveStreamRender(messages);
}

function resetAssistantMessageForLiveStream(messageDiv, options = {}) {
    return messagesController.resetAssistantMessageForLiveStream(messageDiv, options);
}

function applyRegenerateStreamDomWindow(conversationId, assistantIndex, preferredMessageDiv = null) {
    return messagesController.applyRegenerateStreamDomWindow(conversationId, assistantIndex, preferredMessageDiv);
}

function renderMessages(messages, noScroll, options = {}) {
    return messagesController.renderMessages(messages, noScroll, options);
}

// Turn Indicator State
const turnIndicatorState = {
    popupHideTimer: null,
    userMessages: [],
    fullConversationId: '',
    hasFullTurnList: false,
    turnLoadToken: 0,
    activeTurnIndex: -1,
    visibleTurnCount: 7,
    activeLineEl: null,
    activeUpdateRaf: null,
    layoutDirty: true,
    layoutBuildToken: 0,
    layoutRefreshRaf: null,
    layoutRefreshInProgress: false,
    layoutRefreshIndex: 0,
    layoutRefreshOptions: {
        animate: false,
        forceScroll: false,
    },
    messageCenters: [],
};

function markTurnIndicatorLayoutDirty() {
    turnIndicatorState.layoutDirty = true;
    turnIndicatorState.layoutBuildToken += 1;
    turnIndicatorState.layoutRefreshIndex = 0;

    if (turnIndicatorState.layoutRefreshRaf) {
        cancelAnimationFrame(turnIndicatorState.layoutRefreshRaf);
        turnIndicatorState.layoutRefreshRaf = null;
    }

    turnIndicatorState.layoutRefreshInProgress = false;
}

function scheduleTurnIndicatorLayoutRefresh(options = {}) {
    turnIndicatorState.layoutRefreshOptions = {
        animate: !!options.animate,
        forceScroll: !!options.forceScroll,
    };

    if (turnIndicatorState.layoutRefreshRaf || turnIndicatorState.layoutRefreshInProgress) {
        return;
    }

    const buildToken = turnIndicatorState.layoutBuildToken;
    turnIndicatorState.layoutRefreshRaf = requestAnimationFrame(() => {
        turnIndicatorState.layoutRefreshRaf = null;
        turnIndicatorState.layoutRefreshInProgress = true;
        rebuildTurnIndicatorLayoutCacheChunked(buildToken, 0);
    });
}

function rebuildTurnIndicatorLayoutCacheChunked(buildToken, startIndex) {
    const _tRebuild0 = performance.now();
    const messagesContainer = els.messagesContainer;
    const userMsgs = turnIndicatorState.userMessages || [];

    if (buildToken !== turnIndicatorState.layoutBuildToken) {
        turnIndicatorState.layoutRefreshInProgress = false;
        if (turnIndicatorState.layoutDirty) {
            scheduleTurnIndicatorLayoutRefresh(turnIndicatorState.layoutRefreshOptions || {});
        }
        return;
    }

    if (!messagesContainer || !userMsgs.length) {
        turnIndicatorState.messageCenters = [];
        turnIndicatorState.layoutDirty = false;
        turnIndicatorState.layoutRefreshInProgress = false;
        updateTurnIndicatorActive(turnIndicatorState.layoutRefreshOptions || {});
        return;
    }

    const centers = Array.isArray(turnIndicatorState.messageCenters) && turnIndicatorState.messageCenters.length === userMsgs.length
        ? turnIndicatorState.messageCenters.slice()
        : new Array(userMsgs.length);

    // Batch-read all offsetTop/offsetHeight in one synchronous pass to trigger
    // exactly one reflow instead of one-per-chunk.  Typical conversations have
    // well under a few hundred user messages; a single pass is faster than
    // splitting across multiple rAF frames where each frame forces its own
    // full-page reflow.
    for (let index = 0; index < userMsgs.length; index++) {
        if (buildToken !== turnIndicatorState.layoutBuildToken) {
            turnIndicatorState.layoutRefreshInProgress = false;
            if (turnIndicatorState.layoutDirty) {
                scheduleTurnIndicatorLayoutRefresh(turnIndicatorState.layoutRefreshOptions || {});
            }
            return;
        }

        let msgEl = userMsgs[index].domElement;

        if (!msgEl || !msgEl.isConnected) {
            const messageIndex = Number(userMsgs[index].messageIndex);
            msgEl = Number.isFinite(messageIndex) && messageIndex >= 0
                ? messagesContainer.querySelector(`.message[data-index="${Math.floor(messageIndex)}"]`)
                : null;
        }

        if (msgEl) {
            userMsgs[index].domElement = msgEl;
            centers[index] = msgEl.offsetTop + (msgEl.offsetHeight / 2);
        } else {
            centers[index] = null;
        }
    }

    turnIndicatorState.messageCenters = centers;
    turnIndicatorState.layoutDirty = false;
    turnIndicatorState.layoutRefreshInProgress = false;
    turnIndicatorState.layoutRefreshIndex = 0;
    const _tRebuild1 = performance.now();
    rebuildLayoutLogger.debug(`[rebuildLayout] msgs=${userMsgs.length} readOffsetTop=${(_tRebuild1-_tRebuild0).toFixed(1)}ms`);
    updateTurnIndicatorActive(turnIndicatorState.layoutRefreshOptions || {});
}

function rebuildTurnIndicatorLayoutCache() {
    scheduleTurnIndicatorLayoutRefresh(turnIndicatorState.layoutRefreshOptions || {});
}

function findActiveTurnIndexByViewportMiddle(viewportMiddle) {
    const centers = turnIndicatorState.messageCenters || [];
    if (!centers.length) return -1;

    let firstLoadedIndex = -1;
    let activeIndex = -1;

    for (let index = 0; index < centers.length; index++) {
        const center = Number(centers[index]);

        if (!Number.isFinite(center)) {
            continue;
        }

        if (firstLoadedIndex < 0) {
            firstLoadedIndex = index;
        }

        if (center <= viewportMiddle) {
            activeIndex = index;
            continue;
        }

        break;
    }

    return activeIndex >= 0 ? activeIndex : firstLoadedIndex;
}

function _shouldShowTurnIndicator() {
    if (!String(currentConversationId || '').trim()) return false;
    if (typeof isKnowledgeViewerOpen === 'function' && isKnowledgeViewerOpen()) return false;
    if (typeof isKnowledgePanelOpen === 'function' && isKnowledgePanelOpen()) return false;
    if (typeof isLearningWorkspaceActive === 'function' && isLearningWorkspaceActive()) return false;
    return true;
}

function _syncTurnIndicatorVisibility() {
    const panel = document.getElementById('turnIndicatorPanel');
    const container = document.getElementById('turnIndicatorLines');
    if (!panel) return;
    if (!_shouldShowTurnIndicator()) {
        panel.classList.remove('visible');
        hideTurnListPopup();
        return;
    }

    if (container && container.children.length) {
        panel.classList.add('visible');
        scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
        return;
    }

    panel.classList.remove('visible');
    hideTurnListPopup();
}

function collectTurnIndicatorUserMessages(messages) {
    const rows = Array.isArray(messages) ? messages : [];
    const userMsgs = [];

    for (let index = 0; index < rows.length; index++) {
        const msg = rows[index];

        if (String((msg && msg.role) || '').toLowerCase() !== 'user') {
            continue;
        }

        userMsgs.push({
            msg: msg,
            messageIndex: readMessageRenderIndex(msg, index),
            domElement: null
        });
    }

    return userMsgs;
}

function normalizeServerTurnIndicatorRows(turns) {
    const rows = Array.isArray(turns) ? turns : [];
    const userMsgs = [];

    for (const row of rows) {
        const messageIndex = Number(row && row.message_index);

        if (!Number.isFinite(messageIndex) || messageIndex < 0) {
            continue;
        }

        const safeIndex = Math.floor(messageIndex);
        userMsgs.push({
            msg: {
                id: row && row.id ? row.id : '',
                role: 'user',
                content: row ? row.content : '',
                timestamp: row && row.timestamp ? row.timestamp : '',
                __message_index: safeIndex
            },
            messageIndex: safeIndex,
            domElement: null
        });
    }

    return userMsgs;
}

function bindTurnIndicatorDomElements(userMsgs) {
    const messagesContainer = els.messagesContainer;
    const rows = Array.isArray(userMsgs) ? userMsgs : [];

    rows.forEach((item) => {
        item.domElement = null;
    });

    if (!messagesContainer || !rows.length) {
        return rows;
    }

    const messageElsByIndex = new Map();
    Array.from(messagesContainer.querySelectorAll('.message.user')).forEach((row) => {
        const rowIndex = Number(row && row.dataset ? row.dataset.index : NaN);

        if (Number.isFinite(rowIndex) && rowIndex >= 0) {
            messageElsByIndex.set(Math.floor(rowIndex), row);
        }
    });

    for (const item of rows) {
        const messageIndex = Number(item && item.messageIndex);

        if (Number.isFinite(messageIndex) && messageIndex >= 0) {
            item.domElement = messageElsByIndex.get(Math.floor(messageIndex)) || null;
        }
    }

    return rows;
}

async function loadConversationTurnIndicatorList(conversationId, navToken = null) {
    const cid = String(conversationId || '').trim();

    if (!cid) {
        return false;
    }

    const loadToken = turnIndicatorState.turnLoadToken + 1;
    turnIndicatorState.turnLoadToken = loadToken;

    try {
        const fetchOptions = {};

        if (navToken && navToken.controller && navToken.controller.signal) {
            fetchOptions.signal = navToken.controller.signal;
        }

        const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}/turns`, fetchOptions);
        const data = await res.json().catch(() => ({}));

        if (navToken && !isActiveConversationNavigation(navToken)) {
            return false;
        }

        if (loadToken !== turnIndicatorState.turnLoadToken || cid !== String(currentConversationId || '').trim()) {
            return false;
        }

        if (!res.ok || !data || !data.success) {
            showToast(String((data && data.message) || '加载完整轮次失败'));
            return false;
        }

        const userMsgs = normalizeServerTurnIndicatorRows(data.turns);
        turnIndicatorState.fullConversationId = cid;
        turnIndicatorState.hasFullTurnList = true;
        renderTurnIndicatorUserMessages(userMsgs, { animate: false, forceScroll: true });
        return true;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            return false;
        }

        showToast(String((error && error.message) || '加载完整轮次失败'));
        return false;
    }
}

function renderTurnIndicatorUserMessages(userMsgs, options = {}) {
    const container = document.getElementById('turnIndicatorLines');
    const panel = document.getElementById('turnIndicatorPanel');
    if (!container) return;

    container.innerHTML = '';
    container.scrollTop = 0;
    turnIndicatorState.activeTurnIndex = -1;
    turnIndicatorState.activeLineEl = null;

    if (!Array.isArray(userMsgs) || !userMsgs.length || !_shouldShowTurnIndicator()) {
        if (panel) panel.classList.remove('visible');
        turnIndicatorState.userMessages = [];
        turnIndicatorState.messageCenters = [];
        return;
    }

    const boundUserMsgs = bindTurnIndicatorDomElements(userMsgs);
    turnIndicatorState.userMessages = boundUserMsgs;

    // Use DocumentFragment for batch DOM insert
    const frag = document.createDocumentFragment();
    for (let i = 0; i < boundUserMsgs.length; i++) {
        const line = document.createElement('div');
        line.className = 'turn-indicator-line';
        line.dataset.turnIndex = i;
        frag.appendChild(line);
    }
    container.appendChild(frag);

    // Show panel
    if (panel) panel.classList.add('visible');

    // Bind panel hover events for popup (only once)
    if (panel && !panel._hoverBound) {
        panel._hoverBound = true;
        panel.addEventListener('mouseenter', () => {
            if (turnIndicatorState.popupHideTimer) {
                clearTimeout(turnIndicatorState.popupHideTimer);
                turnIndicatorState.popupHideTimer = null;
            }
            showTurnListPopup();
        });
        panel.addEventListener('mouseleave', () => {
            scheduleHideTurnListPopup();
        });
    }

    markTurnIndicatorLayoutDirty();
    scheduleTurnIndicatorLayoutRefresh({
        animate: !!options.animate,
        forceScroll: options.forceScroll !== false
    });
}

function renderTurnIndicator(messages, options = {}) {
    const cid = String(currentConversationId || '').trim();
    const hasFullList = turnIndicatorState.hasFullTurnList
        && turnIndicatorState.fullConversationId === cid;
    const userMsgs = hasFullList
        ? turnIndicatorState.userMessages
        : collectTurnIndicatorUserMessages(messages);

    renderTurnIndicatorUserMessages(userMsgs, options);
}

function appendTurnIndicatorLine(role, msg) {
    const container = document.getElementById('turnIndicatorLines');
    if (!container) return;
    if (!_shouldShowTurnIndicator()) {
        _syncTurnIndicatorVisibility();
        return;
    }

    const roleLower = String(role || '').toLowerCase();

    if (roleLower === 'user') {
        const panel = document.getElementById('turnIndicatorPanel');
        const lastMessageRow = els.messagesContainer ? els.messagesContainer.lastElementChild : null;
        const lastMessageIndex = Number(lastMessageRow && lastMessageRow.dataset ? lastMessageRow.dataset.index : NaN);
        turnIndicatorState.userMessages.push({
            msg: msg,
            messageIndex: Number.isFinite(lastMessageIndex) && lastMessageIndex >= 0
                ? Math.floor(lastMessageIndex)
                : Math.max(0, els.messagesContainer ? (els.messagesContainer.children.length - 1) : 0),
            domElement: null
        });
        markTurnIndicatorLayoutDirty();

        const line = document.createElement('div');
        line.className = 'turn-indicator-line';
        line.dataset.turnIndex = container.children.length;
        container.appendChild(line);

        if (panel) panel.classList.add('visible');

        // Keep the latest user turn centered inside the 7-line window.
        setActiveTurnLine(container.children.length - 1, { animate: false, forceScroll: true });
        scheduleTurnIndicatorLayoutRefresh({ animate: false, forceScroll: true });
    } else {
        // Assistant turns may change the visible context after streaming finishes.
        scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
    }
}

function setActiveTurnLine(index, options = {}) {
    const container = document.getElementById('turnIndicatorLines');
    if (!container) return;

    const nextIndex = Number.isFinite(Number(index)) ? Number(index) : -1;
    const nextLine = nextIndex >= 0 ? container.children[nextIndex] : null;

    if (turnIndicatorState.activeLineEl && turnIndicatorState.activeLineEl !== nextLine) {
        turnIndicatorState.activeLineEl.classList.remove('active');
    }

    if (nextLine && nextLine !== turnIndicatorState.activeLineEl) {
        nextLine.classList.add('active');
    }

    turnIndicatorState.activeTurnIndex = nextIndex;
    turnIndicatorState.activeLineEl = nextLine || null;

    if (options.forceScroll) {
        scrollActiveTurnIndicatorIntoView(nextIndex, !!options.animate);
    }
}

function scrollActiveTurnIndicatorIntoView(index, animate = false) {
    const container = document.getElementById('turnIndicatorLines');
    if (!container) return;

    // Use children[index] instead of querySelector for better performance
    const activeLine = container.children[index];
    if (!activeLine) return;

    requestAnimationFrame(() => {
        const targetTop = Math.max(
            0,
            activeLine.offsetTop - ((container.clientHeight - activeLine.offsetHeight) / 2)
        );

        if (Math.abs(container.scrollTop - targetTop) < 1) {
            return;
        }

        container.scrollTo({
            top: targetTop,
            behavior: animate ? 'smooth' : 'auto'
        });
    });
}

function showTurnListPopup() {
    const _t0 = performance.now();
    let popup = document.getElementById('turnIndicatorPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'turnIndicatorPopup';
        popup.className = 'turn-indicator-popup';
        document.body.appendChild(popup);

        popup.addEventListener('mouseenter', () => {
            if (turnIndicatorState.popupHideTimer) {
                clearTimeout(turnIndicatorState.popupHideTimer);
                turnIndicatorState.popupHideTimer = null;
            }
        });
        popup.addEventListener('mouseleave', () => {
            scheduleHideTurnListPopup();
        });
    }

    popup.innerHTML = '';
    const userMsgs = turnIndicatorState.userMessages || [];
    const _t1 = performance.now();

    // Use cached activeTurnIndex instead of querying DOM
    const activeIdx = turnIndicatorState.activeTurnIndex >= 0
        ? turnIndicatorState.activeTurnIndex
        : userMsgs.length - 1;

    // Use DocumentFragment for batch insert
    const frag = document.createDocumentFragment();
    let activeItem = null;

    for (let idx = 0; idx < userMsgs.length; idx++) {
        const item = userMsgs[idx];
        const text = extractMessageText(item.msg);
        const displayText = text || '(空消息)';
        const div = document.createElement('div');
        div.className = 'turn-indicator-popup-item';
        if (idx === activeIdx) {
            div.classList.add('active');
            activeItem = div;
        }
        div.textContent = displayText;
        div.title = displayText;

        div.addEventListener('click', () => {
            void jumpToUserMessage(idx);
            hideTurnListPopup();
        });

        frag.appendChild(div);
    }
    const _t2 = performance.now();
    popup.appendChild(frag);

    popup.classList.add('visible');
    const _t3 = performance.now();

    // Center active item in popup without reading layout properties.
    if (activeItem && activeIdx >= 0) {
        const ITEM_H = 34;
        const PAD = 8;
        const itemTop = PAD + activeIdx * ITEM_H;
        const popupHeight = 360;
        popup.scrollTop = itemTop - (popupHeight / 2) + (ITEM_H / 2);
    }
    const _t4 = performance.now();
    turnPopupLogger.debug(`[TurnPopup] msgs=${userMsgs.length} clear=${(_t1-_t0).toFixed(1)}ms build=${(_t2-_t1).toFixed(1)}ms append+visible=${(_t3-_t2).toFixed(1)}ms scroll=${(_t4-_t3).toFixed(1)}ms total=${(_t4-_t0).toFixed(1)}ms`);
}

function hideTurnListPopup() {
    const popup = document.getElementById('turnIndicatorPopup');
    if (popup) {
        popup.classList.remove('visible');
    }
}

function scheduleHideTurnListPopup() {
    if (turnIndicatorState.popupHideTimer) {
        clearTimeout(turnIndicatorState.popupHideTimer);
    }
    turnIndicatorState.popupHideTimer = setTimeout(() => {
        hideTurnListPopup();
        turnIndicatorState.popupHideTimer = null;
    }, 300);
}

async function jumpToUserMessage(turnIndex) {
    const userMsgs = turnIndicatorState.userMessages || [];
    const item = userMsgs[turnIndex];
    if (!item) return;

    const root = els.messagesContainer;
    if (!root) return;

    // Immediately update the active turn indicator before scrolling,
    // so the user gets instant visual feedback.
    setActiveTurnLine(turnIndex, { animate: false, forceScroll: true });

    // Try cached DOM element first
    let targetEl = item.domElement;
    if (targetEl && targetEl.isConnected && targetEl.classList.contains('user')) {
        scrollToAndHighlight(targetEl);
        return;
    }

    const messageIndex = Number(item.messageIndex);
    if (Number.isFinite(messageIndex) && messageIndex >= 0) {
        const candidate = root.querySelector(`.message.user[data-index="${Math.floor(messageIndex)}"]`);

        if (candidate) {
            item.domElement = candidate;
            scrollToAndHighlight(candidate);
            return;
        }

        const loaded = await ensureConversationMessageIndexLoaded(messageIndex);
        const loadedCandidate = loaded
            ? root.querySelector(`.message.user[data-index="${Math.floor(messageIndex)}"]`)
            : null;

        if (loadedCandidate) {
            item.domElement = loadedCandidate;
            scrollToAndHighlight(loadedCandidate);
            markTurnIndicatorLayoutDirty();
            scheduleTurnIndicatorLayoutRefresh({ animate: false, forceScroll: true });
            return;
        }
    }

    showToast('目标轮次尚未加载完成');
}

function scrollToAndHighlight(messageEl) {
    if (!messageEl) return;
    const container = els.messagesContainer;
    if (!container) return;

    const messageOffsetTop = messageEl.offsetTop;
    const containerHeight = container.clientHeight;
    const targetTop = Math.max(0, messageOffsetTop - (containerHeight / 2) + (messageEl.offsetHeight / 2));

    // Cancel pin-to-bottom RAF loop
    if (__messagesBottomPinRaf) {
        cancelAnimationFrame(__messagesBottomPinRaf);
        __messagesBottomPinRaf = null;
    }
    if (__messagesBottomResizeObs) {
        try { __messagesBottomResizeObs.disconnect(); } catch (_) {}
    }
    __messagesBottomPinUntilTs = 0;
    shouldAutoScroll = false;

    // Block scroll listener from interfering during jump
    _isJumping = true;
    container.scrollTo({
        top: targetTop,
        behavior: 'smooth'
    });
    // Unblock after scroll completes
    setTimeout(() => { _isJumping = false; }, 500);

    // Highlight（统一走 chat_notes.js 的封装，状态由其持有）
    highlightMessageForNoteJump(messageEl);
}

function extractMessageText(msg) {
    if (!msg) return '';
    const content = msg.content || '';
    // If content is a string, return it directly
    if (typeof content === 'string') {
        return content.trim().substring(0, 200);
    }
    // If content is an array (multi-modal), extract text parts
    if (Array.isArray(content)) {
        return content
            .filter(part => part.type === 'text')
            .map(part => part.text || '')
            .join(' ')
            .trim()
            .substring(0, 200);
    }
    return '';
}

function scheduleTurnIndicatorActiveUpdate(options = {}) {
    const nextOptions = {
        animate: !!options.animate,
        forceScroll: !!options.forceScroll,
    };

    if (turnIndicatorState.activeUpdateRaf) {
        cancelAnimationFrame(turnIndicatorState.activeUpdateRaf);
    }

    turnIndicatorState.activeUpdateRaf = requestAnimationFrame(() => {
        turnIndicatorState.activeUpdateRaf = null;
        updateTurnIndicatorActive(nextOptions);
    });
}

function updateTurnIndicatorActive(options = {}) {
    const container = document.getElementById('turnIndicatorLines');
    const messagesContainer = els.messagesContainer;
    if (!container || !messagesContainer) return;
    if (!_shouldShowTurnIndicator()) {
        _syncTurnIndicatorVisibility();
        return;
    }

    if (!container.children.length) return;

    // Use cached user messages instead of querying DOM
    const userMsgs = turnIndicatorState.userMessages || [];
    if (!userMsgs.length) return;

    if (turnIndicatorState.layoutDirty || turnIndicatorState.layoutRefreshInProgress || turnIndicatorState.layoutRefreshRaf) {
        turnPopupLogger.debug(`[updateActive] layout dirty scheduling rebuild (dirty=${turnIndicatorState.layoutDirty} inProgress=${turnIndicatorState.layoutRefreshInProgress})`);
        scheduleTurnIndicatorLayoutRefresh({
            animate: !!options.animate,
            forceScroll: !!options.forceScroll,
        });
        return;
    }

    const scrollTop = messagesContainer.scrollTop;
    const viewportHeight = messagesContainer.clientHeight;
    // Use the bottom edge of the viewport to determine the active turn,
    // so the indicator reflects the message area the user is currently reading.
    const viewportBottom = scrollTop + viewportHeight;

    const activeTurnIndex = findActiveTurnIndexByViewportMiddle(viewportBottom);

    // Keep the active line centered in the 7-line window.
    if (activeTurnIndex !== turnIndicatorState.activeTurnIndex || !turnIndicatorState.activeLineEl) {
        setActiveTurnLine(activeTurnIndex, {
            animate: !!options.animate,
            forceScroll: !!options.forceScroll,
        });
        return;
    }
}

// Global modal functions
window.confirmDelete = function(index) {
    return messageActionsController.confirmDelete(index);
};

function deleteMessage(index) {
    return messageActionsController.deleteMessage(index);
};
window.deleteMessage = deleteMessage;

window.confirmRegenerate = function(index) {
    return messageActionsController.confirmRegenerate(index);
};

function resolveAssistantMessageModelName(message) {
    return messageActionsController.resolveAssistantMessageModelName(message);
}

async function resolveRegenerateModelName(index, messageDiv = null) {
    return messageActionsController.resolveRegenerateModelName(index, messageDiv);
}

async function startRegenerate(index) {
    return messageActionsController.startRegenerate(index);
}

function jsonParseSafe(str) {
    try { return JSON.parse(str); } catch(e) { return null; }
}

function resolveAssistantStreamMessageDiv(index, preferredMessageDiv = null) {
    const preferred = preferredMessageDiv || null;
    if (preferred) {
        if (!preferred.isConnected || !preferred.classList || !preferred.classList.contains('assistant')) {
            return null;
        }
        return preferred;
    }
    return document.querySelector(`.message.assistant[data-index="${index}"]`);
}

function resolveContentBodyForFullTextUpdate(messageDiv, displayText) {
    return messagesController.resolveContentBodyForFullTextUpdate(messageDiv, displayText);
}

const streamMessageDomController = getNexoraChatStreaming().createStreamMessageDomController({
    resolveAssistantStreamMessageDiv,
    resolveContentBodyForFullTextUpdate,
    applyLongtermPlanFromText,
    renderStreamingMarkdownWithNewTabLinks,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    highlightCode,
    resolveReasoningThinkingBlockForAppend,
    markReasoningThinkingBlockLive,
    readReasoningContentRaw,
    buildReasoningAppendText,
    updateThinkingBlockSummary,
    finishReasoningThinkingBlock,
    renderCompletedStreamMath,
    collapseResolvedToolUsages: (...args) => getNexoraChatTools().collapseResolvedToolUsages(...args),
    pinMessagesToBottomFor,
    scheduleLearningSidebarBridgeNotify,
    getShouldAutoScroll: () => shouldAutoScroll
});

function renderStreamingContentSegment(messageDiv, body, rawText, source = 'stream-segment') {
    return streamMessageDomController.renderStreamingContentSegment(messageDiv, body, rawText, source);
}

function updateMessageDivContent(index, fullText, preferredMessageDiv = null) {
    return streamMessageDomController.updateMessageDivContent(index, fullText, preferredMessageDiv);
}

function updateMessageDivThinking(index, delta, preferredMessageDiv = null) {
    return streamMessageDomController.updateMessageDivThinking(index, delta, preferredMessageDiv);
}

function finalizeMessageRenderForIndex(index, preferredMessageDiv = null) {
    return streamMessageDomController.finalizeMessageRenderForIndex(index, preferredMessageDiv);
}

function collapseReasoningBlocksForMessage(messageDiv) {
    if (!messageDiv) return;
    const blocks = messageDiv.querySelectorAll('.thinking-block.reasoning-thinking-block');
    blocks.forEach((thinkingBlock) => {
        if (thinkingBlock.dataset.userToggled === 'true') return;
        finishReasoningThinkingBlock(thinkingBlock);
    });
}

function buildContextCompressionTriggerHint(status = 'start', meta = {}) {
    const s = String(status || '').trim().toLowerCase();
    const m = (meta && typeof meta === 'object') ? meta : {};
    const mode = String(m.trigger_mode || '').trim().toLowerCase();
    const maskedImg = Number(m.masked_image_data_urls || 0);
    let hint = '';
    if (mode === 'force') {
        hint = '触发原因：强制触发';
    } else if (mode === 'overload') {
        const raw = Number(m.raw_input_tokens || 0);
        const win = Number(m.context_window || 0);
        const threshold = Number(m.compression_threshold || 0);
        if (raw > 0 && win > 0) {
            hint = `触发原因：上下文过载（${raw.toLocaleString()} / ${win.toLocaleString()}）`;
            if (threshold > 0) hint += `，阈值 ${threshold.toLocaleString()}`;
        }
        else hint = '触发原因：上下文过载';
    } else if (s === 'skipped') {
        hint = '触发原因：条件不满足';
    }
    if (hint && maskedImg > 0) {
        hint += ` · 图片脱敏 ${Math.max(0, Math.floor(maskedImg))} 张`;
    }
    return hint;
}

function buildContextCompressionOutputText(status = 'start', meta = {}) {
    const s = String(status || '').trim().toLowerCase();
    const m = (meta && typeof meta === 'object') ? meta : {};
    const lines = [];
    const hint = buildContextCompressionTriggerHint(s, m);
    if (hint) lines.push(hint);
    const raw = safeTokenInt(m.raw_input_tokens);
    const post = safeTokenInt(m.post_raw_input_tokens);
    const saved = safeTokenInt(m.saved_tokens);
    const ratio = Number(m.saved_ratio || 0);
    const windowN = safeTokenInt(m.context_window);
    const threshold = safeTokenInt(m.compression_threshold);
    const cutIdx = Number.isFinite(Number(m.history_cut_index)) ? Math.floor(Number(m.history_cut_index)) : -1;
    const chars = safeTokenInt(m.summary_chars);
    const summary = String(m.summary_text || '').trim();
    if (raw > 0) lines.push(`压缩前输入: ${raw.toLocaleString()} tokens`);
    if (windowN > 0) lines.push(`上下文窗口: ${windowN.toLocaleString()}`);
    if (threshold > 0) lines.push(`触发阈值: ${threshold.toLocaleString()}`);
    if (post > 0) lines.push(`压缩后输入: ${post.toLocaleString()} tokens`);
    if (saved > 0) lines.push(`节省: ${saved.toLocaleString()} tokens (${Math.round(Math.max(0, ratio) * 100)}%)`);
    if (cutIdx >= 0) lines.push(`历史截断索引: ${cutIdx}`);
    if (chars > 0) lines.push(`摘要长度: ${chars} 字符`);
    if (summary) {
        lines.push('');
        lines.push('压缩摘要:');
        lines.push(summary);
    } else if (s === 'start') {
        lines.push('');
        lines.push('压缩任务已开始，等待模型生成摘要...');
    }
    return lines.join('\n').trim();
}

function upsertContextCompressionCard(messageDiv, status = 'start', text = '上下文压缩中', meta = {}) {
    if (!messageDiv) return;
    const parent = messageDiv.querySelector('.message-content') || messageDiv;
    if (!parent) return;
    let row = null;
    const rows = parent.querySelectorAll('.tool-usage.context-compression-card');
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        const node = rows[i];
        if (String(node.dataset.pending || '') === 'true') {
            row = node;
            break;
        }
    }
    if (!row) {
        row = appendToolEvent(messageDiv, 'Context Compression', text || '上下文压缩中', false, {
            reuseIfExists: false,
            pending: true
        });
        if (!row) return;
        row.classList.add('context-compression-card');
    } else {
        row.classList.add('context-compression-card');
        setToolUsageStatus(row, String(text || '').trim() || '上下文压缩中');
    }

    const outDiv = row.querySelector('.tool-output');
    if (!outDiv) return;
    const body = buildContextCompressionOutputText(status, meta);
    outDiv.textContent = body || '压缩信息暂无';
    row.classList.add('has-output');

    const s = String(status || '').trim().toLowerCase();
    if (s === 'start') {
        row.dataset.pending = 'true';
        row.dataset.resolved = 'false';
        row.classList.remove('done');
    } else {
        row.dataset.pending = 'false';
        row.dataset.resolved = 'true';
        row.classList.add('done');
        row.classList.remove('expanded');
    }
}

function updateMessageDivTools(index, data, preferredMessageDiv = null) {
    const messageDiv = resolveAssistantStreamMessageDiv(index, preferredMessageDiv);
    if (!messageDiv) return;
    
    if (data.type === 'web_search') {
        updateWebSearchStatus(messageDiv, data.status, data.query, data.content);
    } else if (data.type === 'search_meta') {
        appendSearchMeta(messageDiv, data);
    } else if (data.type === 'function_call_delta') {
        const toolName = resolveToolNameFromEvent(data);
        if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'learning_card' || toolName === 'puzzle') return;
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'delta', rawCallId, toolIndex);
        appendToolCallDelta(messageDiv, {
            ...data,
            name: toolName || data.name,
            call_id: callId,
            __raw_call_id: rawCallId,
            __tool_index: toolIndex
        });
    } else if (data.type === 'function_call') {
        const toolName = resolveToolNameFromEvent(data, data.name);
        if (toolName === 'ask_for_permission' || toolName === 'learning_card' || toolName === 'puzzle') return;
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'call', rawCallId, toolIndex);
        rememberJsExecuteCanvasCall(messageDiv, toolName, callId, toolIndex, data.arguments || '');
        finalizeToolCallBadge(messageDiv, toolName, callId, data.arguments || '', { toolIndex });
    } else if (data.type === 'function_call_running') {
        updateToolCallRunning(messageDiv, data);
    } else if (data.type === 'function_result') {
        const toolName = resolveToolNameFromEvent(data, data.name);
        if (toolName === 'question' || toolName === 'ask_for_permission' || toolName === 'puzzle') return;
        if (toolName === 'learning_card') {
            const cardPayload = extractLearningCardPayload(data.result);
            if (cardPayload) {
                appendLearningCardStep(messageDiv, { type: 'learning_card', card: cardPayload });
            }
            return;
        }
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'result', rawCallId, toolIndex);
        updateLastToolResult(messageDiv, toolName, data.result, callId, {
            toolIndex,
            modelVisibleResult: data.model_visible_result
        });
        if (toolName === 'longterm_plan' || toolName === 'longterm_update') {
            applyLongtermPlanFromText(data.result, { source: 'tool-update', messageDiv });
        }
    } else if (data.type === 'context_compression_status') {
        upsertContextCompressionCard(
            messageDiv,
            String(data.status || 'start'),
            String(data.content || '上下文压缩中'),
            data
        );
    } else if (data.type === 'learning_card') {
        appendLearningCardStep(messageDiv, data);
    } else if (data.type === 'question') {
        appendQuestionStep(messageDiv, data);
    } else if (data.type === 'puzzle') {
        appendPuzzleStep(messageDiv, data);
    }
    scheduleLearningSidebarBridgeNotify();
}

const streamPrefillReplayController = getNexoraChatStreaming().createStreamPrefillReplayController({
    stripHistoryTimeMarkerEchoForStream,
    createContentSpan,
    renderStreamingMarkdownWithNewTabLinks,
    renderMarkdownWithNewTabLinks,
    bindSourceMarkdown,
    highlightCode,
    resolveReasoningThinkingBlockForAppend,
    markReasoningThinkingBlockLive,
    readReasoningContentRaw,
    buildReasoningAppendText,
    updateThinkingBlockSummary,
    updateMessageModelBadge,
    getStreamingModelBadgeName,
    safeTokenInt,
    getTokenMiniStreamOutput: () => tokenMiniState.streamOutput,
    getTokenMiniEstimatedStreamOutput: () => tokenMiniState.estimatedStreamOutput,
    updateMessageDivTools
});

function getStreamPrefillChunkSeq(chunk) {
    return streamPrefillReplayController.getStreamPrefillChunkSeq(chunk);
}

function renderStreamPrefillContentChunk(assistantDiv, prefillState, chunk) {
    return streamPrefillReplayController.renderStreamPrefillContentChunk(assistantDiv, prefillState, chunk);
}

function renderStreamPrefillReasoningChunk(assistantDiv, chunk) {
    return streamPrefillReplayController.renderStreamPrefillReasoningChunk(assistantDiv, chunk);
}

function renderStreamPrefillProcessChunk(assistantDiv, assistantIndex, prefillState, chunk) {
    return streamPrefillReplayController.renderStreamPrefillProcessChunk(assistantDiv, assistantIndex, prefillState, chunk);
}

function replayStreamPrefillChunks(assistantDiv, chunks, assistantIndex) {
    return streamPrefillReplayController.replayStreamPrefillChunks(assistantDiv, chunks, assistantIndex);
}

async function resumeActiveStreamAfterReload(options = {}) {
    return streamReconnectController.resumeActiveStreamAfterReload(options);
}
// Logic for Modal
function showConfirm(title, message, type, onOk, onCancel) {
    const backdrop = document.getElementById('confirmBackdrop');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    
    if (!backdrop || !okBtn) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    
    // Cleanup old event listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    // Explicitly set text and style to ensure visibility
    if(type === 'danger') {
// 说明
        newOkBtn.className = "btn-confirm btn-confirm-del";
    } else {
// 说明
        newOkBtn.className = "btn-confirm";
    }
    backdrop.__confirmOnCancel = (typeof onCancel === 'function') ? onCancel : null;
    bindBackdropSafeClose(backdrop, () => window.closeConfirmModal());
    
    backdrop.classList.add('active');
    
    newOkBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        backdrop.classList.remove('active');
        const done = typeof onOk === 'function' ? onOk : null;
        backdrop.__confirmOnCancel = null;
        if (done) done();
    });
};
window.showConfirm = showConfirm;

window.closeConfirmModal = function() {
    const backdrop = document.getElementById('confirmBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('active');
    const onCancel = backdrop.__confirmOnCancel;
    backdrop.__confirmOnCancel = null;
    if (typeof onCancel === 'function') onCancel();
};

function confirmModalAsync(title, message, type = 'danger') {
    const settingsDialog = window.NexoraSettingsDialog;

    if (!settingsDialog || typeof settingsDialog.confirm !== 'function') {
        throw new Error('NexoraSettingsDialog.confirm 未初始化');
    }

    if (type !== 'danger' && type !== 'primary') {
        throw new Error(`不支持的确认窗类型: ${type}`);
    }

    return settingsDialog.confirm({
        dialogId: 'sharedConfirmDialog',
        title: String(title || '').trim(),
        message: String(message || '').trim(),
        confirmLabel: '确认',
        tone: type,
    });
}

function ensureBlankKnowledgeTitleModal() {
    return knowledgeSidebarController.ensureBlankKnowledgeTitleModal();
}

function closeBlankKnowledgeTitleModal() {
    return knowledgeSidebarController.closeBlankKnowledgeTitleModal();
}

function submitBlankKnowledgeTitleModal() {
    return knowledgeSidebarController.submitBlankKnowledgeTitleModal();
}

function openBlankKnowledgeTitleModal(options = {}) {
    return knowledgeSidebarController.openBlankKnowledgeTitleModal(options);
}

window.openBlankKnowledgeTitleModal = openBlankKnowledgeTitleModal;

window.switchVersion = async function(msgIndex, verIndex) {
    return messageActionsController.switchVersion(msgIndex, verIndex);
};


// --- Knowledge ---
function syncBulkVectorizeButtonVisibility() {
    return knowledgeSidebarController.syncBulkVectorizeButtonVisibility();
}

async function loadKnowledge(cid) {
    return knowledgeSidebarController.loadKnowledge(cid);
}

async function createBlankBasisKnowledge() {
    return knowledgeSidebarController.createBlankBasisKnowledge();
}

async function attachKnowledgeToComposer(title, type = 'basis', shortContent = '') {
    return knowledgeSidebarController.attachKnowledgeToComposer(title, type, shortContent);
}

function renderKnowledgeList(container, items, type) {
    return knowledgeSidebarController.renderKnowledgeList(container, items, type);
}

function confirmDeleteKnowledge(title, type = 'basis') {
    return knowledgeSidebarController.confirmDeleteKnowledge(title, type);
}

async function deleteKnowledge(title, type = 'basis') {
    return knowledgeSidebarController.deleteKnowledge(title, type);
}

function createToastUiKnowledgeEditor(...args) {
    return knowledgeEditorController.createToastUiKnowledgeEditor(...args);
}

async function viewKnowledge(...args) {
    return knowledgeEditorController.viewKnowledge(...args);
}

function closeKnowledgeView(...args) {
    return knowledgeEditorController.closeKnowledgeView(...args);
}

async function saveKnowledge(...args) {
    return knowledgeEditorController.saveKnowledge(...args);
}

function getActiveWorkspaceKnowledgeContext() {
    return knowledgeWorkspaceController.getActiveWorkspaceKnowledgeContext();
}

function getWorkspaceKnowledgeRequestFields() {
    return knowledgeWorkspaceController.getWorkspaceKnowledgeRequestFields();
}

function appendWorkspaceKnowledgeQuery(url, title = '') {
    return knowledgeWorkspaceController.appendWorkspaceKnowledgeQuery(url, title);
}

function getActiveKnowledgeShareUsername() {
    return knowledgeWorkspaceController.getActiveKnowledgeShareUsername();
}

function escapeRegexPattern(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKnowledgeImagePlaceholderToken(imageId) {
    const safeId = String(imageId || '').trim().toLowerCase();
    if (!safeId) return '';
    return `${KNOWLEDGE_IMAGE_PLACEHOLDER_SCHEME}${safeId}`;
}

function buildKnowledgeImagePlaceholderMarkdown(token, fileName = '') {
    const label = String(fileName || '').trim() || KNOWLEDGE_IMAGE_PENDING_ALT;
    return `![${label}](${token})`;
}

function normalizeKnowledgeImageAltText(rawName = '') {
    const text = String(rawName || '').trim();
    if (!text) return '图片';
    let normalized = text.replace(/[\r\n\[\]]+/g, ' ').trim();
    normalized = normalized.replace(/^上传中(?:\.{3}|…)?\s*/u, '').trim();
    normalized = normalized.replace(/^上传失败\s*/u, '').trim();
    return normalized || '图片';
}

function normalizeKnowledgeImageFileName(file, fallback = '') {
    if (file && typeof file.name === 'string' && file.name.trim()) return file.name.trim();
    const mime = String((file && file.type) || '').toLowerCase();
    const ext = mime.includes('png') ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
        : mime.includes('gif') ? 'gif'
        : mime.includes('webp') ? 'webp'
        : mime.includes('bmp') ? 'bmp'
        : mime.includes('tiff') ? 'tiff'
        : 'png';
    return `${String(fallback || 'image').trim() || 'image'}.${ext}`;
}

async function allocateKnowledgeImageSlot(fileName = '', basisTitle = '') {
    const res = await fetch('/api/knowledge/image/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            file_name: String(fileName || '').trim(),
            basis_title: String(basisTitle || '').trim()
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.success) {
        throw new Error(String((data && data.message) || `allocate failed (${res.status})`));
    }
    return data;
}

async function uploadKnowledgeImageByFile({ imageId, file, fileName = '', basisTitle = '' }) {
    const form = new FormData();
    form.append('image_id', String(imageId || '').trim());
    form.append('basis_title', String(basisTitle || '').trim());
    if (fileName) form.append('file_name', String(fileName || '').trim());
    form.append('file', file);
    const res = await fetch('/api/knowledge/image/upload', {
        method: 'POST',
        body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.success) {
        throw new Error(String((data && data.message) || `upload failed (${res.status})`));
    }
    return data;
}

function destroyKnowledgeMarkdownEditor() {
    return knowledgeEditorController.destroyEditor();
}

function getKnowledgePreviewContentEl() {
    return knowledgeEditorController.getPreviewContentEl();
}

function captureChatHeaderBaseState() {
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    if (!headerTitle || !headerLeft || !headerRight) return;
    if (!chatHeaderBaseState) {
        chatHeaderBaseState = {
            title: headerTitle.textContent || 'Untitled Conversation',
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
}

function getDesktopHeaderToolsHtml() {
    if (isChatMobileLayout()) return '';
    if (chatHeaderBaseState && String(chatHeaderBaseState.rightHTML || '').trim()) {
        return chatHeaderBaseState.rightHTML;
    }
    const headerRight = document.querySelector('.header-right');
    return headerRight ? String(headerRight.innerHTML || '') : '';
}

function applyDesktopHeaderTools(headerRightEl) {
    const target = headerRightEl || document.querySelector('.header-right');
    if (!target) return;
    target.innerHTML = getDesktopHeaderToolsHtml();
    rebindHeaderActionButtons();
}

function restoreHeaderState(state) {
    if (!state) return;
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    if (!headerTitle || !headerLeft || !headerRight) return;
    headerTitle.textContent = state.title || 'Untitled Conversation';
    headerLeft.innerHTML = state.leftHTML || '';
    headerRight.innerHTML = state.rightHTML || '';

    els.modelSelectContainer = document.getElementById('modelSelectContainer');
    els.currentModelDisplay = document.getElementById('currentModelDisplay');
    els.modelOptions = document.getElementById('modelOptions');
    try {
        loadModels();
    } catch (e) {
        console.error('restoreHeaderState: loadModels failed', e);
    }
    rebindHeaderActionButtons();
}

function rebindHeaderActionButtons() {
    els.toggleSidebar = document.getElementById('toggleSidebar');
    els.toggleWorkflowView = document.getElementById('toggleWorkflowView');
    els.toggleNotesPanel = document.getElementById('toggleNotesPanel');
    els.timelineMenuBtn = document.getElementById('timelineMenuBtn');
    els.mobileHeaderMenu = document.getElementById('mobileHeaderMenu');
    els.mobileHeaderMenuTrigger = document.getElementById('mobileHeaderMenuTrigger');
    els.mobileHeaderMenuPanel = document.getElementById('mobileHeaderMenuPanel');
    els.mobileWorkflowMenuItem = document.getElementById('mobileWorkflowMenuItem');
    els.mobileNotesMenuItem = document.getElementById('mobileNotesMenuItem');
    els.mobileTimelineMenuItem = document.getElementById('mobileTimelineMenuItem');
    els.toggleKnowledgePanel = document.getElementById('toggleKnowledgePanel');
    els.toggleFilePanel = document.getElementById('toggleFilePanel');
    els.toggleMailView = document.getElementById('toggleMailView');

    const toggleSidebar = els.toggleSidebar;
    if (toggleSidebar) {
        toggleSidebar.onclick = () => {
            if (isChatMobileLayout()) toggleMobileSidebar();
            else els.sidebar.classList.toggle('collapsed');
        };
    }
    const toggleKP = els.toggleKnowledgePanel;
    if (toggleKP) {
        toggleKP.onclick = () => toggleKnowledgePanel();
    }
    const toggleFile = els.toggleFilePanel;
    if (toggleFile) {
        toggleFile.onclick = () => toggleCloudFilePanel();
    }
    const toggleWorkflow = els.toggleWorkflowView;
    if (toggleWorkflow) {
        toggleWorkflow.onclick = () => openWorkflowPlaceholderView();
    }
    const toggleNotes = els.toggleNotesPanel;
    if (toggleNotes) {
        toggleNotes.onclick = async () => {
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (!ok) showToast('打开独立笔记窗口失败');
                return;
            }
            toggleNotesPanel();
        };
        renderNotesBadge();
    }
    const timelineBtn = els.timelineMenuBtn;
    if (timelineBtn) {
        timelineBtn.onclick = (e) => {
            e.preventDefault();
            toggleTimelinePanel();
        };
    }
    const toggleMail = els.toggleMailView;
    if (toggleMail) {
        toggleMail.onclick = async () => {
            if (await refreshMailEntryVisibility({ force: true })) {
                await openMailPlaceholderView();
            }
        };
        void refreshMailEntryVisibility();
    }
    bindMobileHeaderMenu();
}

// 保存当前状态
function saveCurrentViewerState(extra = {}) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    return {
        viewerDisplay: viewer.style.display,
        viewerHTML: viewer.innerHTML,
        msgsDisplay: msgs.style.display,
        inputDisplay: inputWrapper ? inputWrapper.style.display : 'block',
        headerTitle: headerTitle.textContent,
        headerLeft: headerLeft.innerHTML,
        headerRight: headerRight.innerHTML,
        extra,
        extra
    };
}

// 恢复状态
function restoreViewerState(state) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    restoreWorkspaceDetailInputContainerForConversationLoad();
    
    viewer.style.display = state.viewerDisplay;
    viewer.innerHTML = state.viewerHTML;
    msgs.style.display = state.msgsDisplay;
    if (inputWrapper) inputWrapper.style.display = state.inputDisplay;
    headerTitle.textContent = state.headerTitle;
    headerLeft.innerHTML = state.headerLeft;
    headerRight.innerHTML = state.headerRight;
    if (state.extra && state.extra.searchQuery) {
        currentSearchQuery = state.extra.searchQuery;
    }
}

function parseKnowledgeWordFilename(disposition) {
    const header = String(disposition || '').trim();
    if (!header) return '';

    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
        try {
            return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
        } catch (_) {
            return utf8Match[1].trim().replace(/^"|"$/g, '');
        }
    }

    const filenameMatch = header.match(/filename="?([^";]+)"?/i);
    return filenameMatch && filenameMatch[1] ? filenameMatch[1].trim() : '';
}

function buildKnowledgeWordFilename(title) {
    const safeTitle = String(title || '知识库导出').trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || '知识库导出';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `${safeTitle}_${ts}.docx`;
}

function downloadKnowledgeWordBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportKnowledgeToWord(title) {
    const resolvedTitle = String(title || knowledgeEditorController.getCurrentTitle() || '').trim();
    if (!resolvedTitle) {
        showToast('未找到知识标题');
        return;
    }

    try {
        showToast('正在导出 Word');
        const res = await fetch(`/api/knowledge/export/word?title=${encodeURIComponent(resolvedTitle)}`);
        if (!res.ok) {
            let message = '导出失败';
            const contentType = String(res.headers.get('Content-Type') || '').toLowerCase();

            if (contentType.includes('application/json')) {
                const data = await res.json();
                message = String((data && (data.message || data.error)) || message);
            } else {
                const text = await res.text();
                if (text.trim()) {
                    message = text.trim().slice(0, 160);
                }
            }

            showToast(message);
            return;
        }

        const blob = await res.blob();
        if (!blob || blob.size <= 0) {
            showToast('导出文件为空');
            return;
        }

        const filename = parseKnowledgeWordFilename(res.headers.get('Content-Disposition')) || buildKnowledgeWordFilename(resolvedTitle);
        downloadKnowledgeWordBlob(blob, filename);
        showToast('Word 已导出');
    } catch (e) {
        showToast('导出失败: ' + String((e && e.message) || e || '未知错误'));
    }
}

function highlightTextInPreview(text, meta = {}) {
    return knowledgeEditorController.highlightTextInPreview(text, meta);
}

function closeWorkspaceKnowledgeView() {
    closeKnowledgeView({
        restoreWorkspaceContext: true,
    });
}

function closeKnowledgeViewBeforeLearningSwitch() {
    if (!isKnowledgeViewerOpen()) {
        return;
    }

    // Learning 主面板和 knowledgeViewer 同属 main-content 一级视图，进入 Learning 前必须先结束文档视图。
    closeKnowledgeView({
        useNavigationStack: false,
        syncLearningHeader: false
    });
}

const WORKFLOW_GRAPH_BASE_WIDTH = 1520;
const WORKFLOW_GRAPH_BASE_HEIGHT = 820;

function updateWorkflowCanvasScale() {
    const wrap = document.getElementById('workflowCanvasWrap');
    const fit = document.getElementById('workflowCanvasFit');
    const canvas = document.getElementById('workflowCanvas');
    if (!wrap || !fit || !canvas) return;

    const cs = window.getComputedStyle(wrap);
    const padY = (parseFloat(cs.paddingTop || '0') || 0) + (parseFloat(cs.paddingBottom || '0') || 0);
    const availableHeight = Math.max(120, wrap.clientHeight - padY);
    const scale = Math.min(1, availableHeight / WORKFLOW_GRAPH_BASE_HEIGHT);
    const clamped = Number.isFinite(scale) && scale > 0 ? scale : 1;

    canvas.style.transform = `scale(${clamped})`;
    fit.style.width = `${Math.round(WORKFLOW_GRAPH_BASE_WIDTH * clamped)}px`;
    fit.style.height = `${Math.round(WORKFLOW_GRAPH_BASE_HEIGHT * clamped)}px`;
}

function setWorkflowMainMode(mode) {
    const feed = document.getElementById('workflowMainFeed');
    const designer = document.getElementById('workflowMainDesigner');
    if (!feed || !designer) return;
    const safeMode = String(mode || '').trim().toLowerCase();
    const showDesigner = safeMode === 'designer';
    feed.style.display = showDesigner ? 'none' : 'grid';
    designer.style.display = showDesigner ? 'flex' : 'none';
    if (showDesigner) {
        requestAnimationFrame(() => updateWorkflowCanvasScale());
    }
}

function refreshWorkflowSidebarToggleState() {
    const ws = document.getElementById('workflowSidebar');
    if (!ws) return;
    const btn = ws.querySelector('.workflow-sidebar-toggle');
    if (!btn) return;
    btn.innerHTML = ws.classList.contains('collapsed')
        ? '<i class="fa-solid fa-angles-right"></i>'
        : '<i class="fa-solid fa-angles-left"></i>';
    btn.title = ws.classList.contains('collapsed') ? '展开侧栏' : '折叠侧栏';
}

function setWorkflowSidebarActiveWorkflow(workflowId) {
    const id = String(workflowId || '').trim();
    if (!id) return;
    document.querySelectorAll('.workflow-list-items li[data-workflow-id]').forEach((el) => {
        el.classList.toggle('active', String(el.dataset.workflowId || '') === id);
    });
}

function setWorkflowDesignerTitle(title, subtitle = '') {
    const t = document.getElementById('workflowDesignerTitle');
    const s = document.getElementById('workflowDesignerSub');
    if (t) t.textContent = String(title || '流程画布');
    if (s) s.textContent = String(subtitle || '可视化节点编排（占位）');
}

function selectWorkflowNode(nodeKey) {
    const key = String(nodeKey || '').trim();
    if (!key) return;
    document.querySelectorAll('.workflow-graph-node[data-node-key]').forEach((el) => {
        el.classList.toggle('active', String(el.dataset.nodeKey || '') === key);
    });
}


// --- Knowledge Search ---
let lastKnowledgeSearchResults = [];

async function handleKnowledgeSearch() {
    const input = els.knowledgeSearchInput;
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;
    await searchKnowledgeVectors(query);
}

async function searchKnowledgeVectors(query) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    restoreWorkspaceDetailInputContainerForConversationLoad();
    
    // 关闭任何可能打开的知识库详情视图
    if (knowledgeEditorController.getCurrentTitle()) {
        closeKnowledgeView();
    }
    
    // 导航栈管理：如果还没有搜索项在栈上，保存聊天页面状态
    if (navigationStack.length === 0) {
        // 第一次进入搜索，保存初始的聊天页面状态
        navigationStack.push({
            type: 'chat',
            state: {
                title: headerTitle.textContent,
                leftHTML: headerLeft.innerHTML,
                rightHTML: headerRight.innerHTML
            }
        });
    }
    
    // 保存原始状态（兼容旧代码）
    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
    
    // 显示搜索结果视图
    msgs.style.display = 'none';
    const inputDock = document.querySelector('.input-dock');
    if (inputDock) inputDock.style.display = 'none';
    if(inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';
    _syncTurnIndicatorVisibility();
    
    // 更新Header
    headerTitle.textContent = '向量库搜索';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeSearchResultView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);
    
    // 更新viewer为搜索结果显示区
    viewer.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
            <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <div style="font-size: 14px; color: #64748b;">搜索: <strong style="color: #0f172a;">${escapeHtml(query)}</strong></div>
            </div>
            <div id="knowledgeSearchResultsList" style="flex: 1; overflow-y: auto; padding: 0;"></div>
        </div>
    `;
    
    const resultsList = document.getElementById('knowledgeSearchResultsList');
    resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">搜索中...</div>';
    
    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 8 })
        });
        const data = await res.json();
        if (!data.success) {
            resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">${data.message || '搜索失败'}</div>`;
            return;
        }
        const docs = (data.result && data.result.documents && data.result.documents[0]) ? data.result.documents[0] : [];
        const metas = (data.result && data.result.metadatas && data.result.metadatas[0]) ? data.result.metadatas[0] : [];
        const dists = (data.result && data.result.distances && data.result.distances[0]) ? data.result.distances[0] : [];
        if (docs.length === 0) {
            resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">没有结果</div>';
            return;
        }
        lastKnowledgeSearchResults = docs.map((doc, i) => ({
            doc,
            meta: metas[i] || {},
            dist: dists[i]
        }));

        resultsList.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
            const title = item.meta.title || 'Untitled';
            const preview = (item.doc || '').slice(0, 200);
            const score = item.dist != null ? (1 - item.dist) : 0;
            return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
                <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
                <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
            </div>`;
        }).join('');

        // 添加搜索结果的点击处理
        bindSearchResultHandlers();
        
        // 搜索结果加载完成后，保存搜索页面状态到栈
        currentSearchQuery = query;
        navigationStack.push({
            type: 'search',
            query: query,
            // 不保存 HTML，而是保存查询信息，返回时重新渲染
            resultsCache: lastKnowledgeSearchResults
        });
    } catch (e) {
        resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">搜索失败: ${e.message}</div>`;
    }
}

function bindSearchResultHandlers() {
    setTimeout(() => {
        document.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(el.getAttribute('data-idx'));
                const title = el.getAttribute('data-title');
                const item = lastKnowledgeSearchResults[idx];
                const chunkText = (item && item.doc) ? item.doc : '';
                if (title && chunkText) {
                    openKnowledgeAtChunk(title, chunkText, (item && item.meta) ? item.meta : {}, true);
                }
            };
        });
    }, 100);
}

function renderSearchResultsFromCache() {
    const list = document.getElementById('knowledgeSearchResultsList');
    if (!list) return;
    if (!lastKnowledgeSearchResults || lastKnowledgeSearchResults.length === 0) {
        list.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">无结果</div>';
        return;
    }
    list.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
        const title = item.meta.title || 'Untitled';
        const preview = (item.doc || '').slice(0, 200);
        const score = item.dist != null ? (1 - item.dist) : 0;
        return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
            <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
        </div>`;
    }).join('');
    bindSearchResultHandlers();
}

function closeKnowledgeSearchResultView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    restoreWorkspaceDetailInputContainerForConversationLoad();
    viewer.style.display = 'none';
    viewer.innerHTML = '<textarea id="knowledgeEditor"></textarea>';
    msgs.style.display = 'flex';
    const inputDock = document.querySelector('.input-dock');
    if (inputDock) inputDock.style.display = 'block';
    if(inputWrapper) inputWrapper.style.display = 'block';
    if (els.messageInput && els.messageInput.value) {
        requestAnimationFrame(() => {
            resizeMessageInput();
        });
    }

    // 清除导航栈和搜索状态
    navigationStack = [];
    currentSearchQuery = '';

    if (originalHeaderState) {
        headerTitle.textContent = originalHeaderState.title;
        headerLeft.innerHTML = originalHeaderState.leftHTML;
        headerRight.innerHTML = originalHeaderState.rightHTML;
        els.modelSelectContainer = document.getElementById('modelSelectContainer');
        els.currentModelDisplay = document.getElementById('currentModelDisplay');
        els.modelOptions = document.getElementById('modelOptions');
        loadModels(); 
        
        const toggleSidebar = document.getElementById('toggleSidebar');
        if(toggleSidebar) toggleSidebar.onclick = () => {
            if (isChatMobileLayout()) toggleMobileSidebar();
            else els.sidebar.classList.toggle('collapsed');
        };
        const toggleKP = document.getElementById('toggleKnowledgePanel');
        if (toggleKP) toggleKP.onclick = () => toggleKnowledgePanel();
        const toggleFile = document.getElementById('toggleFilePanel');
        if(toggleFile) toggleFile.onclick = () => toggleCloudFilePanel();
        const toggleMail = document.getElementById('toggleMailView');
        if(toggleMail) {
            toggleMail.onclick = async () => {
                if (await refreshMailEntryVisibility({ force: true })) {
                    await openMailPlaceholderView();
                }
            };
            void refreshMailEntryVisibility();
        }
    }
    originalHeaderState = null;
    _syncTurnIndicatorVisibility();
}

function closeKnowledgeSearchModal() {
    // 兼容性函数，调用新的搜索结果视图关闭函数
    closeKnowledgeSearchResultView();
}

async function openKnowledgeAtChunk(title, chunkText, meta = {}, fromSearch = false) {
    // 如果不是来自搜索，清除导航栈（直接跳转）
    if (!fromSearch) {
        navigationStack = [{
            type: 'chat',
            state: {
                title: document.getElementById('conversationTitle').textContent,
                leftHTML: document.querySelector('.header-left').innerHTML,
                rightHTML: document.querySelector('.header-right').innerHTML
            }
        }];
    }
    
    // 直接在预览模式下打开，带有高亮信息
    await viewKnowledge(title, { 
        forceEditMode: false,
        highlightData: { text: chunkText, meta },
        fromSearch
    });
}

function indexToPos(text, index) {
    const before = text.slice(0, index);
    const lines = before.split('\n');
    const line = lines.length - 1;
    const ch = lines[lines.length - 1].length;
    return { line, ch };
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getKnowledgeEditorState(title = knowledgeEditorController.getCurrentTitle() || '') {
    return knowledgeEditorController.getTitleState(title);
}

function readScrollableProgress(el) {
    return knowledgeEditorController.readScrollableProgress(el);
}

function readCodeMirrorProgress() {
    return knowledgeEditorController.readCodeMirrorProgress();
}

function applyScrollableProgress(el, preferredTop = 0, preferredRatio = 0) {
    knowledgeEditorController.applyScrollableProgress(el, preferredTop, preferredRatio);
}

function applyCodeMirrorProgress(preferredTop = 0, preferredRatio = 0) {
    knowledgeEditorController.applyCodeMirrorProgress(preferredTop, preferredRatio);
}

function isKnowledgeEditorDebugEnabled() {
    return !!window.__NEXORA_KNOWLEDGE_EDITOR_DEBUG;
}

function logKnowledgeEditorDebug(message, details = null) {
    if (!isKnowledgeEditorDebugEnabled()) return;

    try {
        if (details != null) {
            console.debug('[KnowledgeEditor]', message, details);
        } else {
            console.debug('[KnowledgeEditor]', message);
        }
    } catch (_) {}
}

function summarizeKnowledgeEditorNode(node) {
    if (!node) return null;
    let rect = null;
    try {
        const r = node.getBoundingClientRect();
        rect = {
            top: Number(r.top || 0),
            left: Number(r.left || 0),
            width: Number(r.width || 0),
            height: Number(r.height || 0)
        };
    } catch (_) {}
    let computed = null;
    try {
        const cs = window.getComputedStyle(node);
        computed = {
            display: String(cs.display || ''),
            position: String(cs.position || ''),
            flexDirection: String(cs.flexDirection || ''),
            gridTemplateColumns: String(cs.gridTemplateColumns || ''),
            gridColumn: String(cs.gridColumn || ''),
            overflowY: String(cs.overflowY || ''),
            overflowX: String(cs.overflowX || ''),
            visibility: String(cs.visibility || ''),
            opacity: String(cs.opacity || '')
        };
    } catch (_) {}
    return {
        tag: String(node.tagName || '').toLowerCase(),
        id: String(node.id || ''),
        className: String(node.className || ''),
        scrollTop: Number(node.scrollTop || 0),
        scrollHeight: Number(node.scrollHeight || 0),
        clientHeight: Number(node.clientHeight || 0),
        rect,
        computed
    };
}

function collectKnowledgeEditorLayoutSnapshot() {
    const viewer = document.getElementById('knowledgeViewer');
    const host = document.getElementById('knowledgeEditor');
    const mdContainer = viewer ? viewer.querySelector('.toastui-editor-md-container') : null;
    const vertical = viewer ? viewer.querySelector('.toastui-editor-md-vertical-style') : null;
    const editPane = viewer ? viewer.querySelector('.toastui-editor') : null;
    const builtInPreview = viewer ? viewer.querySelector('.toastui-editor-md-preview') : null;
    const builtInSplitter = viewer ? viewer.querySelector('.toastui-editor-md-splitter') : null;
    const customPreview = viewer ? viewer.querySelector('.nexora-toast-preview') : null;
    const customSplitter = viewer ? viewer.querySelector('.nexora-toast-splitter') : null;
    const previewContent = viewer ? viewer.querySelector('.nexora-toast-preview .toastui-editor-contents') : null;
    const scroller = getKnowledgeEditorScrollerEl ? getKnowledgeEditorScrollerEl() : null;
    const previewEl = getKnowledgeEditorPreviewEl ? getKnowledgeEditorPreviewEl() : null;
    return {
        currentTitle: String(knowledgeEditorController.getCurrentTitle() || ''),
        activeTitle: knowledgeEditorController.getActiveScrollTitle(),
        isPreviewActive: typeof isKnowledgeEditorPreviewActive === 'function' ? !!isKnowledgeEditorPreviewActive() : null,
        isSideBySideActive: typeof isKnowledgeEditorSideBySideActive === 'function' ? !!isKnowledgeEditorSideBySideActive() : null,
        isFullscreenActive: typeof isKnowledgeEditorFullscreenActive === 'function' ? !!isKnowledgeEditorFullscreenActive() : null,
        host: summarizeKnowledgeEditorNode(host),
        viewer: summarizeKnowledgeEditorNode(viewer),
        mdContainer: summarizeKnowledgeEditorNode(mdContainer),
        vertical: summarizeKnowledgeEditorNode(vertical),
        editPane: summarizeKnowledgeEditorNode(editPane),
        builtInPreview: summarizeKnowledgeEditorNode(builtInPreview),
        builtInSplitter: summarizeKnowledgeEditorNode(builtInSplitter),
        customPreview: summarizeKnowledgeEditorNode(customPreview),
        customSplitter: summarizeKnowledgeEditorNode(customSplitter),
        previewContent: summarizeKnowledgeEditorNode(previewContent),
        scroller: summarizeKnowledgeEditorNode(scroller),
        previewEl: summarizeKnowledgeEditorNode(previewEl)
    };
}

window.__nexoraDumpKnowledgeEditorLayout = function() {
    const snapshot = collectKnowledgeEditorLayoutSnapshot();
    try {
        console.log('[KnowledgeEditor][Dump]', snapshot);
    } catch (_) {}
    return snapshot;
};

function getKnowledgeEditorScrollMetrics() {
    return knowledgeEditorController.getScrollMetrics();
}

function captureKnowledgeEditorToggleSnapshot(forcePreviewSource = null) {
    return knowledgeEditorController.captureToggleSnapshot(forcePreviewSource);
}

function isKnowledgeEditorAlignDebugEnabled() {
    return !!window.__NEXORA_ALIGN_DEBUG;
}

function normalizeKnowledgePreviewHeadingTags(root) {
    return knowledgeEditorController.normalizePreviewHeadingTags(root);
}

function getKnowledgeEditorPreviewEl() {
    return document.querySelector('#knowledgeViewer .nexora-toast-preview')
        || document.querySelector('#knowledgeViewer .toastui-editor-md-preview')
        || document.querySelector('#knowledgeViewer .toastui-editor-md-preview .toastui-editor-contents')
        || document.querySelector('#knowledgeViewer .editor-preview-side.editor-preview-active-side')
        || document.querySelector('#knowledgeViewer .editor-preview-active')
        || document.querySelector('#knowledgeViewer .editor-preview')
        || document.querySelector('#knowledgeViewer .editor-preview-side');
}

function getKnowledgeEditorScrollerEl() {
    if (knowledgeEditorController.getEditorCodeMirror() && typeof knowledgeEditorController.getEditorCodeMirror().getScrollerElement === 'function') {
        const scroller = knowledgeEditorController.getEditorCodeMirror().getScrollerElement();
        if (scroller) return scroller;
    }
    return document.querySelector('#knowledgeViewer .toastui-editor-md-container .CodeMirror-scroll')
        || document.querySelector('#knowledgeViewer .CodeMirror-scroll');
}

function getToastProseMirrorEl() {
    return document.querySelector('#knowledgeViewer .toastui-editor .ProseMirror')
        || document.querySelector('#knowledgeViewer .ProseMirror');
}

function bindKnowledgeEditorScrollTracking() {
    knowledgeEditorController.bindScrollTracking();
}

function bindKnowledgeEditorToolbarHooks() {
    knowledgeEditorController.bindToolbarHooks();
}

function restoreKnowledgeEditorScrollPosition(forcePreview = null, preferredSnapshot = null) {
    knowledgeEditorController.restoreScrollPosition(forcePreview, preferredSnapshot);
}

function storeKnowledgeEditorScrollPosition(forcePreview = null) {
    knowledgeEditorController.storeScrollPosition(forcePreview);
}

function installKnowledgeEditorPreviewHooks() {
    knowledgeEditorController.installPreviewHooks();
}

// --- Knowledge Settings ---
function buildKnowledgeShareUrl(shareId) {
    return knowledgeSettingsController.buildKnowledgeShareUrl(shareId);
}

function applyKnowledgeSettingsMetadata(title, metadata = {}) {
    return knowledgeSettingsController.applyKnowledgeSettingsMetadata(title, metadata);
}

function resetKnowledgeSettingsVectorPanel() {
    return knowledgeSettingsController.resetKnowledgeSettingsVectorPanel();
}

function ensureKnowledgeSettingsVectorLoaded() {
    return knowledgeSettingsController.ensureKnowledgeSettingsVectorLoaded();
}

async function refreshKnowledgeSettingsMetadata(title) {
    return knowledgeSettingsController.refreshKnowledgeSettingsMetadata(title);
}

function openKnowledgeSettingsModal() {
    return knowledgeSettingsController.openKnowledgeSettingsModal();
}

function closeKnowledgeSettingsModal() {
    return knowledgeSettingsController.closeKnowledgeSettingsModal();
}

function initKnowledgeSettingsTabs() {
    return knowledgeSettingsController.initKnowledgeSettingsTabs();
}

function setShareLinkDisplay(shareUrl, isPublic) {
    return knowledgeSettingsController.setShareLinkDisplay(shareUrl, isPublic);
}

async function applyKnowledgeSettings() {
    return knowledgeSettingsController.applyKnowledgeSettings();
}

function copyShareUrl() {
    return knowledgeSettingsController.copyShareUrl();
}

function showToast(msg) {
    let toast = document.querySelector('.toast-notification');
    if(!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function resolveProviderSimpleIconSlug(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (!p) return '';
    const exactMap = {
        github: 'github',
        aliyun: 'alibabacloud',
        alibabacloud: 'alibabacloud',
        volcengine: 'bytedance',
        bytedance: 'bytedance',
        tencent: 'qq',
        tencentcloud: 'qq',
        qq: 'qq',
        wechat: 'wechat',
        deepseek: 'deepseek',
        openai: 'openai',
        stepfun: 'stepfun',
        moonshot: 'moonshot',
        kimi: 'kimi',
        minimax: 'minimax',
        siliconflow: 'siliconflow',
        openrouter: 'openrouter',
        xunfei: 'xunfei',
        spark: 'spark',
        hunyuan: 'hunyuan',
        ollama: 'ollama',
        nvidia: 'nvidia',
        zhipu: 'zhipu',
        zhipuai: 'zhipu',
        zai: 'zhipu',
        bigmodel: 'zhipu'
    };
    if (exactMap[p]) return exactMap[p];
    if (p.includes('aliyun') || p.includes('alibaba')) return 'alibabacloud';
    if (p.includes('volc') || p.includes('byte')) return 'bytedance';
    if (p.includes('tencent')) return 'qq';
    if (p.includes('github')) return 'github';
    if (p.includes('openai')) return 'openai';
    if (p.includes('deepseek')) return 'deepseek';
    if (p.includes('moonshot') || p.includes('kimi')) return 'kimi';
    if (p.includes('step')) return 'stepfun';
    if (p.includes('minimax')) return 'minimax';
    if (p.includes('silicon')) return 'siliconflow';
    if (p.includes('openrouter')) return 'openrouter';
    if (p.includes('xunfei') || p.includes('spark')) return 'xunfei';
    if (p.includes('hunyuan')) return 'hunyuan';
    if (p.includes('ollama')) return 'ollama';
    if (p.includes('nvidia')) return 'nvidia';
    if (p.includes('zhipu') || p.includes('bigmodel')) return 'zhipu';
    return '';
}

function providerIconFallbackText(text) {
    const src = String(text || '').trim();
    if (!src) return '?';
    const cleaned = normalizeProviderIconFallbackSource(src);
    if (!cleaned) return src.slice(0, 1).toUpperCase();
    const first = cleaned.slice(0, 1);
    return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

function renderProviderIconHtml(provider, options = {}) {
    const cls = String(options.className || 'provider-logo').trim() || 'provider-logo';
    const label = String(options.label || provider || 'Provider').trim() || 'Provider';
    const fallback = providerIconFallbackText(label);
    const fallbackHtml = `<span class="provider-logo-fallback">${escapeHtml(fallback)}</span>`;
    const slug = resolveProviderSimpleIconSlug(provider);
    const iconSrc = slug ? (LOCAL_PROVIDER_ICON_MAP[slug] || '') : '';
    if (!slug || !iconSrc) {
        return `<span class="${cls} icon-fallback" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${fallbackHtml}</span>`;
    }
    return `
        <span class="${cls}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
            <img src="${iconSrc}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer"
                 onerror="this.parentElement.classList.add('icon-fallback'); this.remove();">
            ${fallbackHtml}
        </span>
    `;
}

function renderProviderInlineHtml(provider, labelText = '') {
    const label = String(labelText || provider || '-').trim() || '-';
    return `
        <span class="provider-inline">
            ${renderProviderIconHtml(provider, { className: 'provider-logo provider-logo-sm', label })}
            <span class="provider-inline-label">${escapeHtml(label)}</span>
        </span>
    `;
}

function normalizeModelProviderKey(provider) {
    return String(provider || 'other').trim().toLowerCase() || 'other';
}

function getModelProviderLabel(provider) {
    const key = normalizeModelProviderKey(provider);

    return MODEL_PROVIDER_LABEL_MAP[key] || (provider ? String(provider) : '其他');
}

function compareModelProviderKeys(a, b) {
    const left = normalizeModelProviderKey(a);
    const right = normalizeModelProviderKey(b);
    const leftOrder = MODEL_PROVIDER_ORDER_MAP[left] || 999;
    const rightOrder = MODEL_PROVIDER_ORDER_MAP[right] || 999;

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return getModelProviderLabel(left).localeCompare(getModelProviderLabel(right), 'zh-CN');
}

function getChatProviderApiType(providerKey) {
    const key = String(providerKey || '').trim();
    const providerInfo = key ? (providerCatalogByKey[key] || providerCatalogByKey[key.toLowerCase()] || {}) : {};
    return String(providerInfo && providerInfo.api_type ? providerInfo.api_type : '').trim().toLowerCase();
}

function getChatOllamaStatusEntry(providerKey) {
    const key = String(providerKey || '').trim();
    return key ? (ollamaChatProviderStatusCache.get(key) || null) : null;
}

function getChatOllamaModelStatus(providerKey, modelId) {
    const providerEntry = getChatOllamaStatusEntry(providerKey);
    const modelKey = String(modelId || '').trim().toLowerCase();
    if (!providerEntry || !providerEntry.byModelId || !modelKey) return null;
    return providerEntry.byModelId[modelKey] || null;
}

async function loadChatOllamaProviderStatus(providerKey) {
    const key = String(providerKey || '').trim();
    if (!key) return null;
    if (ollamaChatProviderStatusCache.has(key)) {
        return ollamaChatProviderStatusCache.get(key);
    }
    if (ollamaChatProviderStatusPending.has(key)) {
        return ollamaChatProviderStatusPending.get(key);
    }

    const pending = (async () => {
        try {
            const res = await fetch(`/api/provider/ollama/list?provider=${encodeURIComponent(key)}&timeout=8`, { credentials: 'include' });
            const data = await res.json();
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
            const payload = {
                byModelId,
                raw: data,
                error: data && data.success === false ? (data.message || '加载失败') : '',
                loaded: !(data && data.success === false),
                loadedAt: Date.now()
            };
            ollamaChatProviderStatusCache.set(key, payload);
            return payload;
        } catch (err) {
            const payload = {
                byModelId: {},
                raw: null,
                error: err && err.message ? err.message : '加载失败',
                loaded: false,
                loadedAt: Date.now()
            };
            ollamaChatProviderStatusCache.set(key, payload);
            return payload;
        } finally {
            ollamaChatProviderStatusPending.delete(key);
        }
    })();

    ollamaChatProviderStatusPending.set(key, pending);
    return pending;
}

function getChatModelOllamaCircleClass(model, providerKey) {
    const modelId = String(model && model.id ? model.id : '').trim();
    const modelStatus = String(model && model.status ? model.status : '').trim().toLowerCase();
    const providerEntry = getChatOllamaStatusEntry(providerKey);

    if (!providerEntry) {
        return 'status-loading';
    }

    if (providerEntry.error) {
        return 'status-danger';
    }

    const statusEntry = getChatOllamaModelStatus(providerKey, modelId);

    if (!statusEntry) {
        return providerEntry.loaded ? 'status-danger' : 'status-loading';
    }

    const status = String(statusEntry.status || modelStatus || '').trim().toLowerCase();

    if (statusEntry.running || status === 'running' || status === 'online' || status === 'ok') return 'status-success';

    if (statusEntry.installed === false || status === 'missing' || status === 'uninstalled') return 'status-danger';

    return 'status-warn';
}

function getModelSourceLabel(model) {
    const currentModel = model && typeof model === 'object' ? model : null;

    if (!currentModel) {
        return '';
    }

    return String(currentModel.name || currentModel.id || '').trim();
}

// 模型配置可能带 provider/model 前缀，展示层只显示最后一级模型名。
function getModelDisplayLabel(modelName) {
    const rawName = String(modelName || '').trim();
    const slashIndex = rawName.lastIndexOf('/');

    if (slashIndex < 0) {
        return rawName;
    }

    return rawName.slice(slashIndex + 1).trim();
}

function renderCurrentModelDisplayHtml(model) {
    const currentModel = model && typeof model === 'object' ? model : null;
    const rawLabel = getModelSourceLabel(currentModel);

    if (!rawLabel) {
        return '';
    }

    const label = getModelDisplayLabel(rawLabel);

    const providerKey = String(currentModel && currentModel.provider ? currentModel.provider : '').trim();
    const providerApiType = getChatProviderApiType(providerKey);

    if (providerApiType !== 'ollama') {
        return `<span class="current-model-content"><span class="current-model-label" title="${escapeHtml(rawLabel)}">${escapeHtml(label)}</span></span>`;
    }

    const circleClass = getChatModelOllamaCircleClass(currentModel, providerKey);
    const statusText = circleClass === 'status-success' ? '在线' : (circleClass === 'status-danger' ? '未安装' : (circleClass === 'status-loading' ? '加载中' : '不在线'));

    return `
        <span class="current-model-content">
            <span class="current-model-label" title="${escapeHtml(rawLabel)}">${escapeHtml(label)}</span>
            <span class="current-model-ollama-dot ${circleClass}" title="${escapeHtml(statusText)}" aria-label="${escapeHtml(statusText)}"></span>
        </span>
    `;
}

function refreshChatOllamaStatusIndicators() {
    const selectedModel = modelCatalog.find((m) => m && String(m.id || '') === String(selectedModelId || ''));

    if (els.currentModelDisplay && selectedModel) {
        els.currentModelDisplay.innerHTML = renderCurrentModelDisplayHtml(selectedModel);
    }

    if (!els.modelOptions) return;

    els.modelOptions.querySelectorAll('.model-chip').forEach((chip) => {
        const modelId = String(chip.dataset.modelId || '').trim();
        const model = modelCatalog.find((item) => item && String(item.id || '') === modelId);
        const providerKey = String(model && model.provider ? model.provider : '').trim();

        if (getChatProviderApiType(providerKey) !== 'ollama') return;

        const statusDot = chip.querySelector('.model-chip-ollama-dot');
        if (!statusDot) return;

        const circleClass = getChatModelOllamaCircleClass(model, providerKey);
        const statusText = circleClass === 'status-success'
            ? '在线'
            : (circleClass === 'status-danger'
                ? '未安装'
                : (circleClass === 'status-loading' ? '加载中' : '不在线'));

        statusDot.className = `model-chip-ollama-dot ${circleClass}`;
        statusDot.title = statusText;
        statusDot.setAttribute('aria-label', statusText);
    });
}

function setKnowledgeSettingsActiveTab(target) {
    return knowledgeSettingsController.setKnowledgeSettingsActiveTab(target);
}

async function refreshChatOllamaProviderStatuses(providerKeys = [], options = {}) {
    const keys = Array.from(new Set((providerKeys || []).map((item) => String(item || '').trim()).filter(Boolean)));

    if (!keys.length) return;

    if (options && options.force) {
        keys.forEach((providerKey) => {
            ollamaChatProviderStatusCache.delete(providerKey);
            ollamaChatProviderStatusPending.delete(providerKey);
        });
    }

    subscribeBrowserOllamaStatus(keys, {
        force: !!(options && options.force)
    });
    syncBrowserOllamaStatus({
        providers: keys,
        force: !!(options && options.force)
    });
    refreshChatOllamaStatusIndicators();
}

function normalizeModelContextRefreshMode(raw) {
    const token = String(raw || '').trim().toLowerCase();

    if (['0', 'false', 'off', 'no', 'none', 'cache', 'cached'].includes(token)) {
        return 'cache';
    }

    if (['force', 'remote', 'live'].includes(token)) {
        return 'force';
    }

    return 'async';
}

function buildModelConfigUrl(contextRefresh) {
    const params = new URLSearchParams();
    params.set('context_refresh', normalizeModelContextRefreshMode(contextRefresh));

    return `/api/config?${params.toString()}`;
}

function scheduleModelContextRefreshAfterLoad() {
    if (modelContextRefreshScheduled) {
        return;
    }

    modelContextRefreshScheduled = true;

    window.setTimeout(() => {
        loadModels({
            contextRefresh: 'async',
            refreshContextAfterLoad: false,
            forceOllamaStatus: false,
        })
            .then((ok) => {
                if (!ok) {
                    return;
                }

                window.setTimeout(() => {
                    loadModels({
                        contextRefresh: 'cache',
                        refreshContextAfterLoad: false,
                        forceOllamaStatus: false,
                    });
                }, MODEL_CONTEXT_RELOAD_DELAY_MS);
            })
            .catch((err) => {
                console.error('Error refreshing model context windows', err);
            });
    }, MODEL_CONTEXT_REFRESH_DELAY_MS);
}

async function loadModels(options = {}) {
    const loadOptions = options && typeof options === 'object' ? options : {};
    const contextRefresh = normalizeModelContextRefreshMode(loadOptions.contextRefresh || 'async');

    try {
        const res = await fetch(buildModelConfigUrl(contextRefresh));
        const data = await res.json();
        if(data.models) {
            updateBrowserModelConfigVersion(data);
            providerCatalogByKey = (data.providers && typeof data.providers === 'object') ? data.providers : {};
            modelCatalog = Array.isArray(data.models) ? data.models : [];
            modelMetaById.clear();
            modelCatalog.forEach((m) => {
                if (!m || !m.id) return;
                modelMetaById.set(String(m.id), {
                    id: String(m.id),
                    name: String(m.name || m.id),
                    provider: String(m.provider || ''),
                    contextWindow: normalizeContextWindow(
                        m.context_window != null ? m.context_window
                            : (m.context_length != null ? m.context_length
                                : (m.max_context_tokens != null ? m.max_context_tokens
                                    : (m.max_input_tokens != null ? m.max_input_tokens : 0)))
                    )
                });
            });
            const ollamaProviderKeys = Object.keys(providerCatalogByKey || {}).filter((providerKey) => getChatProviderApiType(providerKey) === 'ollama');
            renderCustomModelSelect(modelCatalog, data.default_model);
            updateTokenBudgetContextFromSelectedModel();

            if (ollamaProviderKeys.length) {
                void refreshChatOllamaProviderStatuses(ollamaProviderKeys, {
                    force: !!loadOptions.forceOllamaStatus
                });
            } else {
                subscribeBrowserOllamaStatus([]);
            }

            if (loadOptions.refreshContextAfterLoad) {
                scheduleModelContextRefreshAfterLoad();
            }

            return true;
        }

        return false;
    } catch(e) {
        console.error("Error loading models", e);
        return false;
    }
}

function renderCustomModelSelect(models, defaultModel) {
    if(!els.modelOptions) return;
    
    // Clear
    els.modelOptions.innerHTML = '';
    
    if (models.length === 0) {
        selectedModelId = null;
        if(els.currentModelName) els.currentModelName.textContent = '无可用的模型';
        return;
    }
    
    // Setup initial
    const stored = localStorage.getItem('selectedModel');
    const isValidStored = models.find(m => m.id === stored);
    const isValidDefault = models.find(m => m.id === defaultModel);
    
    selectedModelId = (isValidStored ? stored : (isValidDefault ? defaultModel : models[0].id));

    getNexoraChatModelSelect().render({
        root: els.modelOptions,
        models,
        selectedModelId,
        normalizeProvider: normalizeModelProviderKey,
        compareProviders: compareModelProviderKeys,
        getModelLabel: (model) => getModelDisplayLabel(getModelSourceLabel(model)),
        getModelTitle: getModelSourceLabel,
        getModelStatus: (model) => String((model && model.status) || 'normal').toLowerCase(),
        renderProviderTitle: (target, providerKey) => {
            const providerText = getModelProviderLabel(providerKey);
            target.innerHTML = `
                ${renderProviderIconHtml(providerKey, { className: 'provider-logo provider-logo-sm', label: providerText })}
                <span class="label">${escapeHtml(providerText)}</span>
            `;
        },
        decorateChip: (chip, model, providerKey) => {
            if (getChatProviderApiType(providerKey) !== 'ollama') {
                return;
            }

            const statusDot = document.createElement('span');
            const circleClass = getChatModelOllamaCircleClass(model, providerKey);
            const statusText = circleClass === 'status-success'
                ? '在线'
                : (circleClass === 'status-danger'
                    ? '未安装'
                    : (circleClass === 'status-loading' ? '加载中' : '不在线'));
            statusDot.className = `model-chip-ollama-dot ${circleClass}`;
            statusDot.title = statusText;
            statusDot.setAttribute('aria-label', statusText);
            chip.appendChild(statusDot);
        },
        onSelect: (modelId, model) => {
            void selectModel(modelId, model && model.name);
        }
    });
    
    // Set initial display
    const currentList = models.find(m => m.id === selectedModelId);
    if(currentList) els.currentModelDisplay.innerHTML = renderCurrentModelDisplayHtml(currentList);

    // Toggle logic
    els.currentModelDisplay.onclick = (e) => {
        e.stopPropagation();
        const isClosed = els.modelOptions.classList.contains('select-hide');
        closeAllSelects(); // Close any potential others or self cleanup
        
        if (isClosed) {
            if (isMobileViewport()) {
                dockModelOptionsForMobile();
                positionMobileModelOptions();
            }
            els.modelOptions.classList.remove('select-hide');
            els.currentModelDisplay.classList.add('select-arrow-active');
        }
    };

    if (!modelSelectListenersBound) {
        document.addEventListener('click', closeAllSelects);
        window.addEventListener('nexora:learning-frame-pointerdown', closeModelSelectFromLearningFrame);
        window.addEventListener('resize', () => {
            if (!els.modelOptions || els.modelOptions.classList.contains('select-hide')) return;
            if (isMobileViewport()) {
                dockModelOptionsForMobile();
                positionMobileModelOptions();
            } else {
                undockModelOptionsForMobile();
            }
        });
        modelSelectListenersBound = true;
    }
}

function getModelMeta(modelId) {
    const key = String(modelId || '').trim();
    if (!key) return null;
    return modelMetaById.get(key) || null;
}

function getSelectedModelMeta() {
    return getModelMeta(selectedModelId);
}

function isImageLikeFile(file) {
    if (!file) return false;
    const mime = String(file.type || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(file.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].some((ext) => name.endsWith(ext));
}

function readImageAsDataUrl(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.onabort = () => reject(new Error('图片读取已中断'));
        reader.onprogress = (evt) => {
            if (!evt || !evt.lengthComputable || typeof onProgress !== 'function') return;
            const percent = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
            onProgress(percent);
        };
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

async function selectModel(id, name) {
    selectedModelId = id;
    localStorage.setItem('selectedModel', id);
    const selectedModel = modelCatalog.find((m) => m && String(m.id || '') === String(id || '')) || { id, name };
    els.currentModelDisplay.innerHTML = renderCurrentModelDisplayHtml(selectedModel);
    
    // Visual update
    els.modelOptions.querySelectorAll('.model-chip').forEach((chip) => {
        if (chip.dataset.modelId === id) chip.classList.add('same-as-selected');
        else chip.classList.remove('same-as-selected');
    });
    
    els.modelOptions.classList.add('select-hide');
    els.currentModelDisplay.classList.remove('select-arrow-active');
    undockModelOptionsForMobile();
    updateTokenBudgetContextFromSelectedModel();
}

function closeModelSelectFromLearningFrame() {
    closeAllSelects();
}

function closeAllSelects(e) {
    if(els.modelOptions && !els.modelOptions.classList.contains('select-hide')) {
        const clickedInsideContainer = !!(els.modelSelectContainer && e && els.modelSelectContainer.contains(e.target));
        const clickedInsideOptions = !!(els.modelOptions && e && els.modelOptions.contains(e.target));
        const clickedInside = clickedInsideContainer || clickedInsideOptions;
        if (!clickedInside) {
            els.modelOptions.classList.add('select-hide');
            els.currentModelDisplay.classList.remove('select-arrow-active');
            undockModelOptionsForMobile();
        }
    }
}

function isMobileViewport() {
    return window.innerWidth <= 980;
}

function dockModelOptionsForMobile() {
    if (!els.modelOptions || !els.modelSelectContainer || !isMobileViewport()) return;
    if (els.modelOptions.parentElement === document.body) return;
    modelOptionsDockState = {
        parent: els.modelSelectContainer,
        nextSibling: els.modelOptions.nextSibling
    };
    document.body.appendChild(els.modelOptions);
    els.modelOptions.dataset.mobileDocked = '1';
}

function undockModelOptionsForMobile() {
    if (!els.modelOptions || els.modelOptions.parentElement !== document.body || !modelOptionsDockState) return;
    try {
        const parent = modelOptionsDockState.parent;
        const next = modelOptionsDockState.nextSibling;
        if (parent && next && next.parentNode === parent) {
            parent.insertBefore(els.modelOptions, next);
        } else if (parent) {
            parent.appendChild(els.modelOptions);
        }
    } catch (err) {
        if (els.modelSelectContainer) {
            els.modelSelectContainer.appendChild(els.modelOptions);
        }
    }
    delete els.modelOptions.dataset.mobileDocked;
    els.modelOptions.style.position = '';
    els.modelOptions.style.left = '';
    els.modelOptions.style.top = '';
    els.modelOptions.style.width = '';
    els.modelOptions.style.maxWidth = '';
    els.modelOptions.style.maxHeight = '';
    els.modelOptions.style.zIndex = '';
    modelOptionsDockState = null;
}

function positionMobileModelOptions() {
    if (!els.modelOptions || !els.currentModelDisplay || !isMobileViewport()) return;
    const rect = els.currentModelDisplay.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    const width = Math.min(Math.max(260, Math.floor(vw * 0.92)), 380);
    const left = Math.max(6, Math.min(rect.left, vw - width - 6));
    const top = Math.min(Math.floor(rect.bottom + 8), Math.max(70, vh - 140));

    els.modelOptions.style.position = 'fixed';
    els.modelOptions.style.left = `${left}px`;
    els.modelOptions.style.top = `${top}px`;
    els.modelOptions.style.width = `${width}px`;
    els.modelOptions.style.maxWidth = `${Math.max(220, vw - 12)}px`;
    els.modelOptions.style.maxHeight = `${Math.floor(vh * 0.62)}px`;
    els.modelOptions.style.zIndex = '5200';
}

const MERMAID_SCRIPT_CANDIDATES = [
    '/static/vendor/mermaid/mermaid.min.js',
    'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
    'https://unpkg.com/mermaid@11/dist/mermaid.min.js'
];
let __mermaidLoadPromise = null;
let __mermaidInitialized = false;

function looksLikeMermaidDefinition(text) {
    const src = String(text || '').trim();
    if (!src) return false;
    return /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram)\b/m.test(src);
}

function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
        const existing = Array.from(document.querySelectorAll('script[src]'))
            .find((s) => String(s.src || '').includes(String(url)));
        if (existing) {
            if (existing.dataset.loaded === '1') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`load failed: ${url}`)), { once: true });
            return;
        }

        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.dataset.mermaidLoader = '1';
        s.addEventListener('load', () => {
            s.dataset.loaded = '1';
            resolve();
        }, { once: true });
        s.addEventListener('error', () => reject(new Error(`load failed: ${url}`)), { once: true });
        document.head.appendChild(s);
    });
}

async function ensureMermaidReady() {
    if (window.mermaid) {
        if (!__mermaidInitialized && typeof window.mermaid.initialize === 'function') {
            window.mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'loose',
                theme: 'default'
            });
            __mermaidInitialized = true;
        }
        return true;
    }
    if (__mermaidLoadPromise) return __mermaidLoadPromise;

    __mermaidLoadPromise = (async () => {
        for (const url of MERMAID_SCRIPT_CANDIDATES) {
            try {
                await loadScriptOnce(url);
                if (window.mermaid) break;
            } catch (_) {
                // try next source
            }
        }
        if (!window.mermaid) return false;
        if (!__mermaidInitialized && typeof window.mermaid.initialize === 'function') {
            window.mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'loose',
                theme: 'default'
            });
            __mermaidInitialized = true;
        }
        return true;
    })();
    return __mermaidLoadPromise;
}

function promoteMermaidCodeBlocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const nodes = Array.from(root.querySelectorAll('pre > code'));
    nodes.forEach((codeEl) => {
        const preEl = codeEl && codeEl.parentElement;
        if (!preEl || preEl.dataset.mermaidPromoted === '1') return;
        const raw = String(codeEl.textContent || '').trim();
        if (!raw) return;
        const cls = String(codeEl.className || '').toLowerCase();
        const markedAsMermaid = /\blanguage-mermaid\b|\bmermaid\b/.test(cls);
        if (!markedAsMermaid && !looksLikeMermaidDefinition(raw)) return;
        const holder = document.createElement('div');
        holder.className = 'mermaid';
        holder.textContent = raw;
        holder.dataset.mermaidSource = '1';
        preEl.dataset.mermaidPromoted = '1';
        preEl.replaceWith(holder);
    });
}

async function renderMermaidSafe(root) {
    if (!root) return;
    promoteMermaidCodeBlocks(root);
    const targets = Array.from(root.querySelectorAll('.mermaid'))
        .filter((el) => String(el.dataset.mermaidDone || '') !== '1');
    if (!targets.length) return;

    const ready = await ensureMermaidReady();
    if (!ready || !window.mermaid) return;

    try {
        if (typeof window.mermaid.run === 'function') {
            await window.mermaid.run({ nodes: targets });
        } else if (typeof window.mermaid.init === 'function') {
            window.mermaid.init(undefined, targets);
        }
        targets.forEach((el) => {
            el.dataset.mermaidDone = '1';
        });
    } catch (e) {
        console.warn('Mermaid render failed:', e);
    }
}


// --- Utils ---
function detectCodeLanguageFromBlock(block) {
    if (!block) return '';
    const cls = String(block.className || '');
    const m = cls.match(/\blanguage-([a-z0-9_+-]+)\b/i);
    if (m && m[1]) return String(m[1]).toLowerCase();
    const m2 = cls.match(/\blang(?:uage)?-([a-z0-9_+-]+)\b/i);
    if (m2 && m2[1]) return String(m2[1]).toLowerCase();
    return '';
}

function normalizeCodeLanguageLabel(lang) {
    const raw = String(lang || '').trim().toLowerCase();
    if (!raw) return 'TEXT';
    if (raw === 'js') return 'JavaScript';
    if (raw === 'ts') return 'TypeScript';
    if (raw === 'py') return 'Python';
    if (raw === 'sh' || raw === 'bash' || raw === 'zsh' || raw === 'shell') return 'Shell';
    if (raw === 'yml') return 'YAML';
    if (raw === 'md') return 'Markdown';
    if (raw === 'plaintext' || raw === 'text') return 'TEXT';
    return raw.toUpperCase();
}

function decorateCodeBlock(pre, block) {
    if (!pre || !block) return;
    if (pre.classList.contains('nc-code-block')) return;

    // Keep note cards compact; decorate chat/thinking/editor only.
    if (!pre.closest('.content-body, .thinking-content, .editor-preview, .toastui-editor-contents')) return;

    const langRaw = detectCodeLanguageFromBlock(block);
    const langLabel = normalizeCodeLanguageLabel(langRaw);

    pre.classList.add('nc-code-block');
    pre.dataset.codeLang = langRaw || 'text';

    const toolbar = document.createElement('div');
    toolbar.className = 'nc-code-toolbar';
    toolbar.innerHTML = `
        <span class="nc-code-lang">${escapeHtml(langLabel)}</span>
        <button type="button" class="nc-code-copy-btn" title="复制代码">复制</button>
    `;

    const btn = toolbar.querySelector('.nc-code-copy-btn');
    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const text = String(block.textContent || '').replace(/\n+$/, '');
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                showToast('代码已复制');
            } catch (_) {
                showToast('复制失败');
            }
        });
    }

    pre.insertBefore(toolbar, pre.firstChild);
}

function highlightCode(element) {
    void renderMermaidSafe(element);
    if(window.hljs) {
        element.querySelectorAll('pre code').forEach((block) => {
            const cls = String(block.className || '').toLowerCase();
            if (/\bmermaid\b/.test(cls)) return;
            hljs.highlightElement(block);
            const pre = block.parentElement;
            decorateCodeBlock(pre, block);
        });
        return;
    }
    element.querySelectorAll('pre code').forEach((block) => {
        const cls = String(block.className || '').toLowerCase();
        if (/\bmermaid\b/.test(cls)) return;
        const pre = block.parentElement;
        decorateCodeBlock(pre, block);
    });
}


// --- File Upload ---
function setInputFileDropHighlight(dropTarget, visible) {
    const target = dropTarget || fileDropHighlightTarget;

    if (!target) {
        return;
    }

    fileDropHighlightTarget = target;
    target.classList.toggle('file-drop-active', !!visible);

    if (!visible) {
        fileDropHighlightTarget = null;
    }
}

function resetInputFileDropState() {
    fileDragDepth = 0;
    setInputFileDropHighlight(null, false);
}

function dragEventHasFiles(e) {
    const dt = e && e.dataTransfer;
    if (!dt) return false;
    if (dt.items && dt.items.length > 0) {
        return Array.from(dt.items).some((item) => item && item.kind === 'file');
    }
    const types = dt.types ? Array.from(dt.types) : [];
    return types.includes('Files');
}

// 拖拽上传只允许输入框容器触发，避免页面其他区域拖拽文件或图片时误上传。
function resolveInputFileDropTarget() {
    const inputContainer = document.querySelector('#inputWrapper .input-container');

    if (inputContainer instanceof HTMLElement) {
        return inputContainer;
    }

    console.warn('[NexoraFileDrop] input container missing; drag upload binding skipped.');
    return null;
}

function bindInputFileDropUpload() {
    const dropTarget = resolveInputFileDropTarget();

    if (!dropTarget) {
        return;
    }

    if (dropTarget.dataset.fileDropBound === '1') {
        return;
    }

    dropTarget.dataset.fileDropBound = '1';

    const onDragEnter = (e) => {

        if (!dragEventHasFiles(e)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        fileDragDepth += 1;
        setInputFileDropHighlight(dropTarget, true);
    };

    const onDragOver = (e) => {

        if (!dragEventHasFiles(e)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }

        if (!dropTarget.classList.contains('file-drop-active')) {
            setInputFileDropHighlight(dropTarget, true);
        }
    };

    const onDragLeave = (e) => {

        if (!dropTarget.classList.contains('file-drop-active')) {
            return;
        }

        if (dragEventHasFiles(e)) {
            e.preventDefault();
            e.stopPropagation();
        }

        fileDragDepth = Math.max(0, fileDragDepth - 1);

        if (fileDragDepth === 0) {
            setInputFileDropHighlight(dropTarget, false);
        }
    };

    const onDrop = async (e) => {

        if (!dragEventHasFiles(e)) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : []);
        resetInputFileDropState();

        if (!files.length) {
            return;
        }

        await handleFileUploadFiles(files, { source: 'drop', clearInput: false });
    };

    dropTarget.addEventListener('dragenter', onDragEnter);
    dropTarget.addEventListener('dragover', onDragOver);
    dropTarget.addEventListener('dragleave', onDragLeave);
    dropTarget.addEventListener('drop', onDrop);
    window.addEventListener('blur', () => resetInputFileDropState());
    document.addEventListener('visibilitychange', () => {

        if (document.hidden) {
            resetInputFileDropState();
        }
    });
}

function normalizeUploadFile(file, index = 0) {
    if (!file) return null;
    const asBlob = (file instanceof Blob) ? file : null;
    if (!asBlob) return null;
    const rawName = typeof file.name === 'string' ? file.name.trim() : '';
    if (rawName) return file;
    const mime = String(file.type || '').toLowerCase();
    const ext = mime.includes('png') ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
        : mime.includes('gif') ? 'gif'
        : mime.includes('webp') ? 'webp'
        : mime.includes('pdf') ? 'pdf'
        : mime.includes('json') ? 'json'
        : mime.includes('markdown') ? 'md'
        : mime.includes('text') ? 'txt'
        : 'bin';
    const prefix = mime.startsWith('image/') ? 'pasted-image' : 'pasted-file';
    const name = `${prefix}-${Date.now()}-${index + 1}.${ext}`;
    return new File([asBlob], name, {
        type: file.type || 'application/octet-stream',
        lastModified: Date.now()
    });
}

function extractFilesFromClipboardEvent(e) {
    const dt = e && e.clipboardData ? e.clipboardData : null;
    if (!dt) return [];
    const out = [];
    if (dt.items && dt.items.length > 0) {
        Array.from(dt.items).forEach((item, idx) => {
            if (!item || item.kind !== 'file') return;
            const f = item.getAsFile ? item.getAsFile() : null;
            const normalized = normalizeUploadFile(f, idx);
            if (normalized) out.push(normalized);
        });
        return out;
    }
    if (dt.files && dt.files.length > 0) {
        return Array.from(dt.files).map((f, idx) => normalizeUploadFile(f, idx)).filter(Boolean);
    }
    return out;
}

function setFileUploadProgress(...args) {
    return fileUploadController.setFileUploadProgress(...args);
}

function cancelCurrentFileUpload(...args) {
    return fileUploadController.cancelCurrentFileUpload(...args);
}

async function pollUploadTask(...args) {
    return fileUploadController.pollUploadTask(...args);
}

function uploadSingleFileWithProgress(...args) {
    return fileUploadController.uploadSingleFileWithProgress(...args);
}

function showUploadVectorMessage(...args) {
    return fileUploadController.showUploadVectorMessage(...args);
}

function appendUploadedFileEntry(...args) {
    return fileUploadController.appendUploadedFileEntry(...args);
}

async function appendUploadedImageEntry(...args) {
    return fileUploadController.appendUploadedImageEntry(...args);
}

async function handleFileUploadFiles(...args) {
    return fileUploadController.handleFileUploadFiles(...args);
}

async function handleFileUpload(e) {
    const files = Array.from((e && e.target && e.target.files) ? e.target.files : []);
    await handleFileUploadFiles(files, {
        source: 'picker',
        clearInput: () => {
            if (e && e.target) e.target.value = '';
            else if (els.fileInput) els.fileInput.value = '';
        }
    });
}

function getUploadPreviewDisplayName(file) {
    const rawName = String(
        (file && (file.name || file.original_name || file.filename || file.sandbox_path)) || ''
    ).trim();

    if (!rawName) return '未命名';

    const pathParts = rawName.split(/[\\/]/).filter(Boolean);
    return String(pathParts[pathParts.length - 1] || rawName).trim() || '未命名';
}

function getUploadPreviewIconClass(file) {
    const type = String((file && file.type) || '').toLowerCase();
    const name = getUploadPreviewDisplayName(file).toLowerCase();
    if ((file && file.type) === 'image') return 'fa-regular fa-image';
    if (type === 'text' || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) return 'fa-regular fa-file-lines';
    if (name.endsWith('.pdf')) return 'fa-regular fa-file-pdf';
    if (name.endsWith('.doc') || name.endsWith('.docx')) return 'fa-regular fa-file-word';
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'fa-regular fa-file-excel';
    if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'fa-regular fa-file-powerpoint';
    if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) return 'fa-regular fa-file-zipper';
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.xml')) return 'fa-regular fa-file-code';
    return 'fa-regular fa-file';
}

function getUploadPreviewMeta(file) {
    const name = getUploadPreviewDisplayName(file);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const size = Number(file && file.size ? file.size : 0);
    if (file && file.type === 'image') {
        return `image${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    if (file && file.type === 'text') {
        const textSize = size > 0 ? size : Number(new Blob([String(file.content || '')]).size || 0);
        return `${ext || 'txt'}${textSize > 0 ? ` · ${formatFileSize(textSize)}` : ''}`;
    }
    if (file && file.type === 'sandbox_file') {
        return `${ext || 'file'}${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    if (file && file.type === 'file') {
        return `${ext || 'file'}${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    return ext || 'file';
}

function updateFilePreview() {
    if(!els.filePreviewArea) return;
    els.filePreviewArea.innerHTML = '';
    
    if (uploadedFileIds.length === 0) {
        els.filePreviewArea.style.display = 'none';
        els.filePreviewArea.classList.remove('has-items');
        return;
    }
    
    els.filePreviewArea.style.display = 'flex';
    els.filePreviewArea.classList.add('has-items');
    
    uploadedFileIds.forEach((file, index) => {
        const card = document.createElement('div');
        const isImage = file && file.type === 'image' && String(file.url || '').trim();
        card.className = `upload-preview-card ${isImage ? 'is-image' : 'is-file'}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'upload-preview-remove';
        removeBtn.title = '移除';
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.addEventListener('click', () => window.removeUploadedFile(index));
        card.appendChild(removeBtn);

        const media = document.createElement('div');
        media.className = 'upload-preview-media';
        if (isImage) {
            const img = document.createElement('img');
            img.src = String(file.url || '');
            img.alt = String(file.name || 'image');
            img.loading = 'lazy';
            media.appendChild(img);
        } else {
            const icon = document.createElement('i');
            icon.className = getUploadPreviewIconClass(file);
            media.appendChild(icon);
        }
        card.appendChild(media);

        const body = document.createElement('div');
        body.className = 'upload-preview-body';

        const title = document.createElement('div');
        title.className = 'upload-preview-title';
        title.textContent = getUploadPreviewDisplayName(file);
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'upload-preview-meta';
        meta.textContent = getUploadPreviewMeta(file);
        body.appendChild(meta);

        card.appendChild(body);
        els.filePreviewArea.appendChild(card);
    });
}

window.removeUploadedFile = function(index) {
    uploadedFileIds.splice(index, 1);
    updateFilePreview();
}

function updateSidebarUserProfile(displayName, avatarUrl) {
    const avatarEl = document.getElementById('sidebar-avatar');
    if (avatarEl) {
        const nameChar = (displayName || 'U').charAt(0).toUpperCase();
        const hasAvatar = typeof avatarUrl === 'string' && avatarUrl.trim() !== '';
        if (hasAvatar) {
            avatarEl.classList.add('has-image');
            avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
            avatarEl.textContent = '';
            avatarEl.setAttribute('aria-label', displayName || 'avatar');
        } else {
            avatarEl.classList.remove('has-image');
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = nameChar;
        }
    }

    let profileName = document.getElementById('profileUserName');
    if (!profileName) {
        profileName = document.querySelector('.profile-name');
    }
    if (profileName && displayName) {
        profileName.textContent = displayName;
    }
}

function applyCurrentUserIdentity(user) {
    if (!user || typeof user !== 'object') {
        throw new Error('用户身份接口返回为空');
    }

    const userId = String(user.id || '').trim();

    if (!userId) {
        throw new Error('用户身份接口缺少用户ID');
    }

    const displayName = String(user.username || userId).trim() || userId;

    currentUsername = userId;
    currentUserRole = user.role || 'member';
    currentUserAvatarUrl = user.avatar_url || '';
    updateSidebarUserProfile(displayName, currentUserAvatarUrl);

    return {
        id: userId,
        username: displayName,
        role: currentUserRole,
        avatar_url: currentUserAvatarUrl
    };
}

async function loadCurrentUserIdentity() {
    if (currentUserIdentityRequest) {
        return currentUserIdentityRequest;
    }

    const request = (async () => {
        const res = await fetch('/api/user/info?lite=1', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await res.json();

        if (!res.ok || !data || !data.success || !data.user) {
            throw new Error((data && data.message) ? data.message : `用户身份读取失败 HTTP ${res.status}`);
        }

        return applyCurrentUserIdentity(data.user);
    })();

    currentUserIdentityRequest = request;

    try {
        return await request;
    } finally {
        if (currentUserIdentityRequest === request) {
            currentUserIdentityRequest = null;
        }
    }
}

// --- Admin Functions ---
// 查用户色并显示管理菜单
async function checkUserRole() {
    try {
        await loadCurrentUserIdentity();

        // 处理管理员入口显示（迁移到设置页面）
        const settingsAdminGap = document.getElementById('settingsAdminGap');
        const settingsAdminBtns = document.querySelectorAll('#settingsModal .settings-admin-entry');

        if (currentUserRole === 'admin') {
            document.body.classList.add('is-admin');
            if (settingsAdminGap) settingsAdminGap.style.display = '';
            settingsAdminBtns.forEach((btn) => { btn.style.display = ''; });
            console.log('[ADMIN] User is admin, showing settings admin entry');
            void checkAdminQuotaOverageAlertOnRefresh();
        } else {
            document.body.classList.remove('is-admin');
            if (settingsAdminGap) settingsAdminGap.style.display = 'none';
            settingsAdminBtns.forEach((btn) => { btn.style.display = 'none'; });
            console.log('[ADMIN] User is not admin, hiding settings admin entry');
            adminQuotaOverageNoticeChecked = false;
        }
    } catch (err) {
        console.log('Failed to check user role', err);
    }
}

// 打开管理后台
async function openAdminDashboard(defaultTab = 'users') {
    // Kept for compatibility, now routes into settings modal.
    await openSettingsModal();
    const tabMap = {
        system: 'admin-system',
        users: 'admin-users',
        mail: 'admin-mail',
        stats: 'admin-stats',
        models: 'admin-models',
        gen_image: 'admin-gen-image',
        genImage: 'admin-gen-image',
        auth: 'admin-auth',
        chroma: 'admin-chroma'
    };
    switchSettingsTab(tabMap[defaultTab] || 'admin-users');
}

function initAdminSystemSettingsControls() {
    initAdminSystemCustomControls();
    renderAdminSystemModuleSelection();

    document.querySelectorAll('#settingsModal [data-admin-system-module]').forEach((item) => {

        if (item.dataset.bound === '1') return;

        item.dataset.bound = '1';
        item.addEventListener('click', () => {
            selectAdminSystemModule(item.dataset.adminSystemModule || '');
        });
    });

    const saveBtn = document.getElementById('adminSystemSaveBtn');

    if (saveBtn && saveBtn.dataset.bound !== '1') {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', () => {
            void saveAdminSystemSettings();
        });
    }

    document.querySelectorAll('#settingsModal [data-admin-system-save]').forEach((button) => {

        if (button.dataset.bound === '1') return;

        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            void saveAdminSystemSettingsSection(button.dataset.adminSystemSave || '', button);
        });
    });

    bindAdminSystemHealthTestButtons();

    const reloadBtn = document.getElementById('adminSystemReloadBtn');

    if (reloadBtn && reloadBtn.dataset.bound !== '1') {
        reloadBtn.dataset.bound = '1';
        reloadBtn.addEventListener('click', () => {
            void loadAdminSystemSettings(true);
        });
    }
}

function getAdminSystemModuleNames() {
    return [
        'runtime',
        'default_models',
        'rag_database',
        'nexora_search',
        'nexora_learning',
        'nexora_mail',
    ];
}

function normalizeAdminSystemModuleName(moduleName) {
    const name = String(moduleName || '').trim();

    return getAdminSystemModuleNames().includes(name) ? name : 'runtime';
}

function renderAdminSystemModuleSelection() {
    const selected = normalizeAdminSystemModuleName(adminSystemSelectedModule);

    adminSystemSelectedModule = selected;

    document.querySelectorAll('#settingsModal [data-admin-system-module]').forEach((item) => {
        const active = String(item.dataset.adminSystemModule || '') === selected;

        item.classList.toggle('active', active);
    });

    document.querySelectorAll('#settingsModal [data-admin-system-section]').forEach((section) => {
        const active = String(section.dataset.adminSystemSection || '') === selected;

        section.classList.toggle('active', active);
    });
}

function selectAdminSystemModule(moduleName) {
    adminSystemSelectedModule = normalizeAdminSystemModuleName(moduleName);
    renderAdminSystemModuleSelection();
    closeAdminSystemSelects();
}

function getAdminSystemHealthTestButtons() {
    return Array.from(document.querySelectorAll('#settingsModal [data-admin-system-health-test]'));
}

function getAdminSystemHealthTestLabel(button) {
    const section = button ? String(button.dataset.adminSystemHealthTest || '').trim() : '';

    return getAdminSystemSettingsSectionLabel(section);
}

function setAdminSystemHealthTestButtonState(button, state) {
    if (!button) return;

    const icon = button.querySelector('i');
    const text = button.querySelector('span');
    const label = getAdminSystemHealthTestLabel(button);
    const currentState = String(state || 'idle').trim();
    const states = ['is-testing', 'is-success', 'is-error'];

    states.forEach((className) => button.classList.remove(className));
    button.disabled = currentState === 'testing';

    if (currentState === 'testing') {
        button.classList.add('is-testing');
        button.setAttribute('aria-label', `${label} 测试中`);

        if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
        if (text) text.textContent = '测试中';

        return;
    }

    if (currentState === 'success') {
        button.classList.add('is-success');
        button.setAttribute('aria-label', `${label} 服务正常`);

        if (icon) icon.className = 'fa-solid fa-circle-check';
        if (text) text.textContent = '正常';

        return;
    }

    if (currentState === 'error') {
        button.classList.add('is-error');
        button.setAttribute('aria-label', `${label} 服务异常`);

        if (icon) icon.className = 'fa-solid fa-triangle-exclamation';
        if (text) text.textContent = '异常';

        return;
    }

    button.setAttribute('aria-label', `${label} 测试`);

    if (icon) icon.className = 'fa-solid fa-plug';
    if (text) text.textContent = '测试';
}

function resetAdminSystemHealthTestButton(button) {
    setAdminSystemHealthTestButtonState(button, 'idle');
}

function resetAdminSystemHealthTestButtons() {
    getAdminSystemHealthTestButtons().forEach(resetAdminSystemHealthTestButton);
}

function resetAdminSystemHealthTestButtonsByInput(inputId) {
    const id = String(inputId || '').trim();

    if (!id) return;

    getAdminSystemHealthTestButtons().forEach((button) => {
        const buttonInputId = String(button.dataset.adminSystemUrlInput || '').trim();

        if (buttonInputId === id) resetAdminSystemHealthTestButton(button);
    });
}

function getAdminSystemHealthServiceApiName(sectionName) {
    const serviceNames = {
        rag_database: 'NexoraDB',
        nexora_search: 'NexoraSearch',
        nexora_learning: 'NexoraLearning',
        nexora_mail: 'NexoraMail',
    };

    const section = String(sectionName || '').trim();
    const serviceName = serviceNames[section];

    if (!serviceName) throw new Error('未知服务测试类型');

    return serviceName;
}

function getAdminSystemHealthServicePayload(sectionName) {
    const section = String(sectionName || '').trim();
    const payload = getAdminSystemSettingsSectionPayload(section);
    const services = payload && payload.services && typeof payload.services === 'object' ? payload.services : {};
    const serviceConfig = services[section] && typeof services[section] === 'object' ? services[section] : {};
    const serviceUrl = String(serviceConfig.service_url || serviceConfig.frontend_url || '').trim();
    const timeout = serviceConfig.timeout || serviceConfig.request_timeout || '';

    return {
        service_url: serviceUrl,
        timeout,
    };
}

function buildAdminSystemHealthTestPayload(button) {
    const section = button ? String(button.dataset.adminSystemHealthTest || '').trim() : '';
    const healthPath = button ? String(button.dataset.adminSystemHealthPath || '').trim() : '';
    const serviceName = getAdminSystemHealthServiceApiName(section);
    const payload = getAdminSystemHealthServicePayload(section);

    if (!healthPath || healthPath.charAt(0) !== '/') {
        throw new Error('Health Path 未配置');
    }

    payload.health_path = healthPath;

    return {
        serviceName,
        payload,
    };
}

async function parseAdminSystemHealthTestResponse(response) {
    const text = await response.text();

    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error('服务端测试接口返回非 JSON 响应');
    }
}

function formatAdminSystemHealthFailureMessage(data, defaultMessage) {
    const payload = data && typeof data === 'object' ? data : {};
    const message = String(payload.message || defaultMessage || '测试失败').trim();
    const status = payload.upstream_status ? `HTTP ${payload.upstream_status}` : '';
    const errorType = payload.error_type ? String(payload.error_type) : '';
    const detail = [status, errorType].filter(Boolean).join('，');

    return detail ? `${message}（${detail}）` : message;
}

async function testAdminSystemServiceHealth(button) {
    if (currentUserRole !== 'admin') {
        showToast('只有管理员可以测试系统服务状态');
        return;
    }

    const label = getAdminSystemHealthTestLabel(button);
    let requestInfo = null;

    try {
        requestInfo = buildAdminSystemHealthTestPayload(button);
    } catch (err) {
        const message = String((err && err.message) || '服务测试配置错误');

        setAdminSystemHealthTestButtonState(button, 'error');
        setAdminSystemStatus(`${label} 测试失败：${message}`, 'error');
        showToast(`${label} 测试失败：${message}`);
        console.error('[AdminSystemHealthTest] invalid config', { label, error: err });
        return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
        controller.abort();
    }, ADMIN_SYSTEM_HEALTH_TIMEOUT_MS);

    setAdminSystemHealthTestButtonState(button, 'testing');
    setAdminSystemStatus(`${label} 正在测试...`);

    try {
        const response = await fetch(`/api/test/${encodeURIComponent(requestInfo.serviceName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
            body: JSON.stringify(requestInfo.payload),
        });
        const data = await parseAdminSystemHealthTestResponse(response);

        if (!response.ok || !data || !data.success) {
            throw new Error(formatAdminSystemHealthFailureMessage(data, `HTTP ${response.status}`));
        }

        setAdminSystemHealthTestButtonState(button, 'success');
        setAdminSystemStatus(`${label} 服务正常`, 'ok');
        showToast(`${label} 服务正常`);
    } catch (err) {
        const message = err && err.name === 'AbortError' ? '测试超时' : String((err && err.message) || '测试失败');

        setAdminSystemHealthTestButtonState(button, 'error');
        setAdminSystemStatus(`${label} 服务异常：${message}`, 'error');
        showToast(`${label} 服务异常：${message}`);
        console.error('[AdminSystemHealthTest] failed', { label, requestInfo, error: err });
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function bindAdminSystemHealthTestButtons() {
    getAdminSystemHealthTestButtons().forEach((button) => {

        if (button.dataset.healthBound !== '1') {
            button.dataset.healthBound = '1';
            resetAdminSystemHealthTestButton(button);
            button.addEventListener('click', () => {
                void testAdminSystemServiceHealth(button);
            });
        }

        const inputId = String(button.dataset.adminSystemUrlInput || '').trim();
        const input = inputId ? document.getElementById(inputId) : null;

        if (input && input.dataset.adminSystemHealthBound !== '1') {
            input.dataset.adminSystemHealthBound = '1';
            input.addEventListener('input', () => {
                resetAdminSystemHealthTestButtonsByInput(input.id);
            });
        }
    });
}

function getAdminSystemSelectRoot(valueId) {
    return adminSystemControlsController.getAdminSystemSelectRoot(valueId);
}

function getAdminSystemSelectRoots() {
    return adminSystemControlsController.getAdminSystemSelectRoots();
}

function getAdminSystemSelectValueId(root) {
    return adminSystemControlsController.getAdminSystemSelectValueId(root);
}

function getAdminSystemSelectMenu(root) {
    return adminSystemControlsController.getAdminSystemSelectMenu(root);
}

function getAdminSystemSelectRootFromMenu(menu) {
    return adminSystemControlsController.getAdminSystemSelectRootFromMenu(menu);
}

function dockAdminSystemSelectMenu(root) {
    return adminSystemControlsController.dockAdminSystemSelectMenu(root);
}

function undockAdminSystemSelectMenu(root) {
    return adminSystemControlsController.undockAdminSystemSelectMenu(root);
}

function resetAdminSystemSelectMenuPosition(root) {
    return adminSystemControlsController.resetAdminSystemSelectMenuPosition(root);
}

function positionAdminSystemSelectMenu(root) {
    return adminSystemControlsController.positionAdminSystemSelectMenu(root);
}

function repositionOpenAdminSystemSelect() {
    return adminSystemControlsController.repositionOpenAdminSystemSelect();
}

function closeAdminSystemSelects(exceptRoot = null) {
    return adminSystemControlsController.closeAdminSystemSelects(exceptRoot);
}

function setAdminSystemSelectOpen(root, open) {
    return adminSystemControlsController.setAdminSystemSelectOpen(root, open);
}

function syncAdminSystemSelectDisplay(valueId) {
    return adminSystemControlsController.syncAdminSystemSelectDisplay(valueId);
}

function setAdminSystemCustomSelectValue(valueId, value) {
    return adminSystemControlsController.setAdminSystemCustomSelectValue(valueId, value);
}

function buildAdminSystemSelectOption(item, currentValue) {
    return adminSystemControlsController.buildAdminSystemSelectOption(item, currentValue);
}

function buildAdminSystemModelSelectChip(item, currentValue) {
    return adminSystemControlsController.buildAdminSystemModelSelectChip(item, currentValue);
}

function appendAdminSystemModelSelectGroups(menu, optionItems, currentValue) {
    return adminSystemControlsController.appendAdminSystemModelSelectGroups(menu, optionItems, currentValue);
}

function setAdminSystemSelectOptions(valueId, optionItems, selectedValue, options = {}) {
    return adminSystemControlsController.setAdminSystemSelectOptions(valueId, optionItems, selectedValue, options);
}

function setAdminSystemSwitchState(button, value) {
    return adminSystemControlsController.setAdminSystemSwitchState(button, value);
}

function initAdminSystemCustomControls() {
    return adminSystemControlsController.initAdminSystemCustomControls();
}

function setAdminSystemStatus(text, tone = '') {
    const statusEl = document.getElementById('adminSystemStatus');
    if (!statusEl) return;
    statusEl.textContent = String(text || '-');
    statusEl.style.color = tone === 'error' ? '#dc2626' : (tone === 'ok' ? '#166534' : '#334155');
}

function setAdminSystemValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? '' : String(value);

    if (el.hasAttribute('data-admin-system-value')) syncAdminSystemSelectDisplay(id);
}

function getAdminSystemValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function setAdminSystemChecked(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.hasAttribute('data-admin-system-switch')) {
        setAdminSystemSwitchState(el, value);
        return;
    }

    el.checked = !!value;
}

function getAdminSystemChecked(id) {
    const el = document.getElementById(id);

    if (el && el.hasAttribute('data-admin-system-switch')) {
        if (el instanceof HTMLInputElement && el.type === 'checkbox') return !!el.checked;

        return el.dataset.checked === '1';
    }

    return !!(el && el.checked);
}

function populateAdminSystemModelSelect(selectId, selectedValue, modelOptions) {
    const currentValue = String(selectedValue || '').trim();
    const options = Array.isArray(modelOptions) ? modelOptions : [];
    const items = [{ value: '', label: '不指定', provider: '' }];
    let currentValueExists = !currentValue;

    options.forEach((item) => {
        const modelId = String(item && item.id ? item.id : '').trim();

        if (!modelId) return;

        const name = String(item.name || modelId).trim();
        const provider = String(item.provider || '').trim();
        const registered = item.registered !== false;
        const label = name || modelId;
        const metaParts = [];

        if (!registered) metaParts.push('未登记');

        if (modelId === currentValue) currentValueExists = true;

        items.push({
            value: modelId,
            label,
            provider,
            meta: metaParts.join(' · '),
        });
    });

    if (currentValue && !currentValueExists) {
        items.push({
            value: currentValue,
            label: currentValue,
            provider: '',
            meta: '当前配置',
            stale: true,
        });
    }

    setAdminSystemSelectOptions(selectId, items, currentValue, { modelMenu: true });
}

function fillAdminSystemSettingsForm(settings) {
    const payload = settings && typeof settings === 'object' ? settings : {};
    const runtime = payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {};
    const defaultModels = payload.default_models && typeof payload.default_models === 'object' ? payload.default_models : {};
    const services = payload.services && typeof payload.services === 'object' ? payload.services : {};
    const modelOptions = Array.isArray(payload.model_options) ? payload.model_options : [];

    setAdminSystemValue('adminSystemPublicBaseUrlInput', runtime.public_base_url || '');
    populateAdminSystemModelSelect('adminSystemDefaultModelSelect', defaultModels.default_model, modelOptions);
    populateAdminSystemModelSelect('adminSystemConclusionModelSelect', defaultModels.conclusion_model, modelOptions);
    populateAdminSystemModelSelect('adminSystemOrganizationModelSelect', defaultModels.organization_model, modelOptions);
    populateAdminSystemModelSelect('adminSystemWebsearchModelSelect', defaultModels.websearch_model, modelOptions);

    const rag = services.rag_database && typeof services.rag_database === 'object' ? services.rag_database : {};
    setAdminSystemChecked('adminSystemRagEnabledInput', rag.enabled);
    setAdminSystemValue('adminSystemRagModeInput', rag.mode || 'service');
    setAdminSystemValue('adminSystemRagHostInput', rag.host || '');
    setAdminSystemValue('adminSystemRagPortInput', rag.port || '');
    setAdminSystemValue('adminSystemRagServiceUrlInput', rag.service_url || '');
    setAdminSystemValue('adminSystemRagApiKeyInput', rag.api_key || '');

    const search = services.nexora_search && typeof services.nexora_search === 'object' ? services.nexora_search : {};
    setAdminSystemChecked('adminSystemSearchEnabledInput', search.enabled);
    setAdminSystemValue('adminSystemSearchHostInput', search.host || '');
    setAdminSystemValue('adminSystemSearchPortInput', search.port || '');
    setAdminSystemValue('adminSystemSearchServiceUrlInput', search.service_url || '');
    setAdminSystemValue('adminSystemSearchApiKeyInput', search.api_key || '');
    setAdminSystemValue('adminSystemSearchTimeoutInput', search.timeout || '');

    const learning = services.nexora_learning && typeof services.nexora_learning === 'object' ? services.nexora_learning : {};
    setAdminSystemChecked('adminSystemLearningEnabledInput', learning.enabled);
    setAdminSystemValue('adminSystemLearningHostInput', learning.host || '');
    setAdminSystemValue('adminSystemLearningPortInput', learning.port || '');
    setAdminSystemValue('adminSystemLearningFrontendUrlInput', learning.frontend_url || '');
    setAdminSystemValue('adminSystemLearningApiKeyInput', learning.api_key || '');
    setAdminSystemValue('adminSystemLearningTimeoutInput', learning.request_timeout || '');

    const mail = services.nexora_mail && typeof services.nexora_mail === 'object' ? services.nexora_mail : {};
    setAdminSystemChecked('adminSystemMailEnabledInput', mail.enabled);
    setAdminSystemValue('adminSystemMailHostInput', mail.host || '');
    setAdminSystemValue('adminSystemMailPortInput', mail.port || '');
    setAdminSystemValue('adminSystemMailServiceUrlInput', mail.service_url || '');
    setAdminSystemValue('adminSystemMailApiKeyInput', mail.api_key || '');
    setAdminSystemValue('adminSystemMailTimeoutInput', mail.timeout || '');
    setAdminSystemValue('adminSystemMailSendTimeoutInput', mail.send_timeout || '');
    setAdminSystemValue('adminSystemMailDefaultGroupInput', mail.default_group || 'default');
    resetAdminSystemHealthTestButtons();
}

async function loadAdminSystemSettings(force = false) {
    if (currentUserRole !== 'admin') return;

    initAdminSystemSettingsControls();

    if (adminSystemSettingsState && !force) {
        fillAdminSystemSettingsForm(adminSystemSettingsState);
        return;
    }

    setAdminSystemStatus('加载中...');

    try {
        const res = await fetch('/api/admin/system/settings');
        const data = await res.json();

        if (!res.ok || !data || !data.success) {
            throw new Error((data && data.message) ? data.message : '加载系统设置失败');
        }

        adminSystemSettingsState = data.settings || {};
        fillAdminSystemSettingsForm(adminSystemSettingsState);
        setAdminSystemStatus('配置已加载', 'ok');
    } catch (err) {
        const message = String((err && err.message) || '加载系统设置失败');
        setAdminSystemStatus(message, 'error');
        showToast(message);
    }
}

// 系统设置分块保存：每个入口只提交自己管理的配置分支。
function mergeAdminSystemSettingsPayload(target, source) {
    const base = target && typeof target === 'object' ? target : {};
    const patch = source && typeof source === 'object' ? source : {};

    Object.keys(patch).forEach((key) => {
        const value = patch[key];

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            base[key] = mergeAdminSystemSettingsPayload(base[key], value);
            return;
        }

        base[key] = value;
    });

    return base;
}

function collectAdminSystemRuntimePayload() {
    return {
        runtime: {
            public_base_url: getAdminSystemValue('adminSystemPublicBaseUrlInput'),
        },
    };
}

function collectAdminSystemDefaultModelsPayload() {
    return {
        default_models: {
            default_model: getAdminSystemValue('adminSystemDefaultModelSelect'),
            conclusion_model: getAdminSystemValue('adminSystemConclusionModelSelect'),
            organization_model: getAdminSystemValue('adminSystemOrganizationModelSelect'),
            websearch_model: getAdminSystemValue('adminSystemWebsearchModelSelect'),
        },
    };
}

function collectAdminSystemRagPayload() {
    return {
        services: {
            rag_database: {
                enabled: getAdminSystemChecked('adminSystemRagEnabledInput'),
                mode: getAdminSystemValue('adminSystemRagModeInput'),
                host: getAdminSystemValue('adminSystemRagHostInput'),
                port: getAdminSystemValue('adminSystemRagPortInput'),
                api_key: getAdminSystemValue('adminSystemRagApiKeyInput'),
                service_url: getAdminSystemValue('adminSystemRagServiceUrlInput'),
            },
        },
    };
}

function collectAdminSystemSearchPayload() {
    return {
        services: {
            nexora_search: {
                enabled: getAdminSystemChecked('adminSystemSearchEnabledInput'),
                host: getAdminSystemValue('adminSystemSearchHostInput'),
                port: getAdminSystemValue('adminSystemSearchPortInput'),
                api_key: getAdminSystemValue('adminSystemSearchApiKeyInput'),
                service_url: getAdminSystemValue('adminSystemSearchServiceUrlInput'),
                timeout: getAdminSystemValue('adminSystemSearchTimeoutInput'),
            },
        },
    };
}

function collectAdminSystemLearningPayload() {
    return {
        services: {
            nexora_learning: {
                enabled: getAdminSystemChecked('adminSystemLearningEnabledInput'),
                host: getAdminSystemValue('adminSystemLearningHostInput'),
                port: getAdminSystemValue('adminSystemLearningPortInput'),
                api_key: getAdminSystemValue('adminSystemLearningApiKeyInput'),
                frontend_url: getAdminSystemValue('adminSystemLearningFrontendUrlInput'),
                request_timeout: getAdminSystemValue('adminSystemLearningTimeoutInput'),
            },
        },
    };
}

function collectAdminSystemMailPayload() {
    return {
        services: {
            nexora_mail: {
                enabled: getAdminSystemChecked('adminSystemMailEnabledInput'),
                host: getAdminSystemValue('adminSystemMailHostInput'),
                port: getAdminSystemValue('adminSystemMailPortInput'),
                api_key: getAdminSystemValue('adminSystemMailApiKeyInput'),
                service_url: getAdminSystemValue('adminSystemMailServiceUrlInput'),
                timeout: getAdminSystemValue('adminSystemMailTimeoutInput'),
                send_timeout: getAdminSystemValue('adminSystemMailSendTimeoutInput'),
                default_group: getAdminSystemValue('adminSystemMailDefaultGroupInput'),
            },
        },
    };
}

function collectAdminSystemSettingsPayload() {
    return [
        collectAdminSystemRuntimePayload(),
        collectAdminSystemDefaultModelsPayload(),
        collectAdminSystemRagPayload(),
        collectAdminSystemSearchPayload(),
        collectAdminSystemLearningPayload(),
        collectAdminSystemMailPayload(),
    ].reduce((payload, part) => mergeAdminSystemSettingsPayload(payload, part), {});
}

function getAdminSystemSettingsSectionPayload(sectionName) {
    const section = String(sectionName || '').trim();

    if (section === 'runtime') return collectAdminSystemRuntimePayload();
    if (section === 'default_models') return collectAdminSystemDefaultModelsPayload();
    if (section === 'rag_database') return collectAdminSystemRagPayload();
    if (section === 'nexora_search') return collectAdminSystemSearchPayload();
    if (section === 'nexora_learning') return collectAdminSystemLearningPayload();
    if (section === 'nexora_mail') return collectAdminSystemMailPayload();
    if (section === 'all') return collectAdminSystemSettingsPayload();

    throw new Error('未知系统设置分块');
}

function getAdminSystemSettingsSectionLabel(sectionName) {
    const labels = {
        runtime: '基础运行',
        default_models: '默认模型',
        rag_database: 'RAG 向量库',
        nexora_search: 'NexoraSearch',
        nexora_learning: 'NexoraLearning',
        nexora_mail: 'NexoraMail',
        all: '系统设置',
    };

    return labels[String(sectionName || '').trim()] || '系统设置';
}

function formatAdminSystemRuntimeSyncMessage(label, data) {
    const sync = data && data.runtime_sync ? data.runtime_sync : {};
    const actions = Array.isArray(sync.actions) ? sync.actions.filter(Boolean) : [];

    if (actions.length > 0) {
        return `${label} 已保存，已同步：${actions.join('、')}`;
    }

    return `${label} 已保存，进程配置已同步`;
}

async function submitAdminSystemSettingsPayload(payload, options = {}) {
    if (currentUserRole !== 'admin') {
        showToast('只有管理员可以保存系统设置');
        return;
    }

    const button = options && options.button ? options.button : null;
    const label = getAdminSystemSettingsSectionLabel(options && options.section ? options.section : 'all');
    const originalHtml = button ? button.innerHTML : '';

    try {
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>保存中</span>';
        }

        setAdminSystemStatus(`${label} 保存中...`);
        const res = await fetch('/api/admin/system/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok || !data || !data.success) {
            throw new Error((data && data.message) ? data.message : '保存系统设置失败');
        }

        adminSystemSettingsState = data.settings || {};
        fillAdminSystemSettingsForm(adminSystemSettingsState);
        const syncMessage = formatAdminSystemRuntimeSyncMessage(label, data);
        setAdminSystemStatus(syncMessage, 'ok');
        showToast(`${label} 已保存，进程配置已同步`);
        await loadCurrentUserPreferences();
    } catch (err) {
        const message = String((err && err.message) || '保存系统设置失败');
        setAdminSystemStatus(message, 'error');
        showToast(message);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalHtml || '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>保存</span>';
        }
    }
}

async function saveAdminSystemSettingsSection(sectionName, button = null) {
    const section = String(sectionName || '').trim();
    const payload = getAdminSystemSettingsSectionPayload(section);

    await submitAdminSystemSettingsPayload(payload, { section, button });
}

async function saveAdminSystemSettings() {
    const saveBtn = document.getElementById('adminSystemSaveBtn');

    await submitAdminSystemSettingsPayload(collectAdminSystemSettingsPayload(), {
        section: 'all',
        button: saveBtn,
    });
}

async function loadAdminUsersList() {
    return await adminUsersController.loadAdminUsersList();
}

function renderAdminUsersList() {
    return adminUsersController.renderAdminUsersList();
}

function renderAdminUserDetail() {
    return adminUsersController.renderAdminUserDetail();
}

function setAdminUserFilterKeyword(value) {
    return adminUsersController.setAdminUserFilterKeyword(value);
}

function resetAdminUserFilterKeyword() {
    return adminUsersController.resetAdminUserFilterKeyword();
}

window.selectAdminUser = function(encodedUserId) {
    return adminUsersController.selectAdminUser(encodedUserId);
};

function getDefaultAvatarDataUrl(name) {
    const ch = (name || 'U').charAt(0).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' rx='64' fill='#e2e8f0'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' font-size='56' fill='#334155' font-family='Arial'>${ch}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// --- 模型权限管理 ---
async function readAdminJsonResponse(res, fallbackMessage) {
    const rawText = await res.text();
    let data = {};

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
        const plainText = rawText
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
        const statusText = `${res.status || ''} ${res.statusText || ''}`.trim();
        throw new Error(`${fallbackMessage || '请求失败'}${statusText ? ` (${statusText})` : ''}${plainText ? `：${plainText}` : ''}`);
    }

    if (!res.ok) {
        throw new Error(data.message || data.error || `${fallbackMessage || '请求失败'} (${res.status})`);
    }

    return data;
}

window.openUserModelPerm = async function(username) {
    return await adminUsersController.openUserModelPerm(username);
};

window.saveUserModelPermissions = async function() {
    return await adminUsersController.saveUserModelPermissions();
};

window.closeModelPermModal = function() {
    return adminUsersController.closeModelPermModal();
};

function encodeAdminInlineArg(value) {
    return encodeURIComponent(String(value || '')).replace(/[!'()*]/g, (char) => {
        return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
    });
}

function maskSecret(secret) {
    const s = String(secret || '');
    if (!s) return '(empty)';
    if (s.length <= 8) return '*'.repeat(s.length);
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function normalizeAdminApiType(apiType) {
    const value = String(apiType || '').trim().toLowerCase();
    if (!value || value === 'openaiapi') return 'openai';
    if (value === 'openai-compatible' || value === 'openai compatible') return 'openai_compatible';
    return value;
}

function normalizeAdminProviderKey(provider) {
    return String(provider || '').trim();
}

function getAdminProviderApiType(providerInfo) {
    return normalizeAdminApiType(providerInfo && providerInfo.api_type ? providerInfo.api_type : 'openai');
}

function getAdminProviderKeepAlive(providerInfo) {
    const settings = providerInfo && typeof providerInfo.settings === 'object' && providerInfo.settings ? providerInfo.settings : {};
    const keepAlive = String(settings.keep_alive || '').trim();
    return keepAlive || '5m';
}

function isAdminOllamaProvider(providerInfo) {
    return getAdminProviderApiType(providerInfo) === 'ollama';
}

function getAdminModelContextWindow(modelInfo) {
    const info = modelInfo && typeof modelInfo === 'object' ? modelInfo : {};
    const raw = info.context_window != null ? info.context_window
        : (info.context_length != null ? info.context_length
            : (info.max_context_tokens != null ? info.max_context_tokens
                : info.max_input_tokens));
    const value = parseInt(raw || 0, 10);
    return Number.isFinite(value) && value >= 1024 ? value : 0;
}

function formatAdminContextWindow(value) {
    const n = parseInt(value || 0, 10);
    if (!Number.isFinite(n) || n <= 0) return '-';
    return `${n.toLocaleString('en-US')} tokens`;
}

function resolveAdminProviderIconProvider(providerKey, providerInfo = null) {
    const key = String(providerKey || '').trim();
    if (resolveProviderSimpleIconSlug(key)) return key;

    const info = providerInfo && typeof providerInfo === 'object' ? providerInfo : {};
    const apiType = normalizeAdminApiType(info.api_type || '');
    if (resolveProviderSimpleIconSlug(apiType)) return apiType;

    const baseUrl = String(info.base_url || info.api_base || '').trim().toLowerCase();
    if (baseUrl.includes('dashscope') || baseUrl.includes('aliyuncs') || baseUrl.includes('alibabacloud')) return 'aliyun';
    if (baseUrl.includes('github')) return 'github';
    if (baseUrl.includes('openai')) return 'openai';
    if (baseUrl.includes('deepseek')) return 'deepseek';
    if (baseUrl.includes('volc') || baseUrl.includes('volces') || baseUrl.includes('bytedance')) return 'volcengine';
    if (baseUrl.includes('qq.com') || baseUrl.includes('tencent')) return 'tencent';
    if (baseUrl.includes('ollama')) return 'ollama';

    return key || apiType || 'openai';
}

function normalizeAdminModelIconKey(rawModel) {
    let src = String(rawModel || '').trim().toLowerCase();
    if (!src) return 'unknown';
    src = src.split('?', 1)[0].trim();
    if (src.includes('/') && !src.startsWith('http')) {
        src = src.split('/', 2)[1].trim();
    }
    if (src.includes(':')) {
        const parts = src.split(':');
        const tail = String(parts[parts.length - 1] || '').trim();
        if (tail === 'free' || tail === 'beta' || tail === 'alpha' || tail === 'preview' || tail === 'latest') {
            parts.pop();
            src = parts.join(':').trim();
        }
    }
    src = src.replace(/（/g, '(').replace(/）/g, ')');
    src = src.replace(/[\[\]{}()]+/g, '-');
    src = src.replace(/[_.\s/]+/g, '-');
    src = src.replace(/^(qwen|gpt|gemini|claude|mistral|deepseek|kimi|glm|chatglm|step|doubao|seed)(?=\d)/, '$1-');
    src = src.replace(/-(?:\d{6}|\d{8})$/, '');
    src = src.replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (src.startsWith('bytedance-seed-')) {
        src = `doubao-seed-${src.slice('bytedance-seed-'.length)}`;
    } else if (src.startsWith('seed-')) {
        src = `doubao-seed-${src.slice('seed-'.length)}`;
    }
    return src || 'unknown';
}

function resolveAdminModelIconProvider(modelId, fallbackProvider = '', providerInfo = null) {
    const fallback = resolveAdminProviderIconProvider(fallbackProvider, providerInfo);
    const raw = String(modelId || '').trim().toLowerCase();
    if (!raw) return fallback;

    const vendor = raw.includes('/') ? String(raw.split('/', 1)[0] || '').trim() : '';
    const vendorAliasMap = {
        'bytedance-seed': 'volcengine',
        byte: 'volcengine',
        azure: 'openai',
        zhipuai: 'zhipu',
        zai: 'zhipu',
        bigmodel: 'zhipu'
    };
    const normalizedVendor = vendorAliasMap[vendor] || vendor;
    if (normalizedVendor && resolveProviderSimpleIconSlug(normalizedVendor)) {
        return normalizedVendor;
    }

    const key = normalizeAdminModelIconKey(raw);
    if (!key || key === 'unknown') return fallback;
    if (key.startsWith('glm') || key.startsWith('chatglm')) return 'zhipu';
    if (key.startsWith('gpt') || key.startsWith('chatgpt') || key.startsWith('o1') || key.startsWith('o3') || key.startsWith('o4')) return 'openai';
    if (key.startsWith('deepseek')) return 'deepseek';
    if (key.startsWith('doubao-seed') || key.startsWith('seed')) return 'volcengine';
    if (key.startsWith('qwen')) return 'aliyun';
    if (key.startsWith('kimi') || key.startsWith('moonshot')) return 'kimi';
    if (key.startsWith('step')) return 'stepfun';
    return fallback;
}

function normalizeAdminQuotaOnExhaustedAction(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'stop_model') return 'disable_model';
    if (value === 'none' || value === 'noop' || value === 'no-op') return 'no_op';
    if (value === 'no_op' || value === 'disable_model' || value === 'notify_admin' || value === 'disable_and_notify') {
        return value;
    }
    return 'disable_model';
}

function getAdminQuotaOnExhaustedActionLabel(actionRaw) {
    const action = normalizeAdminQuotaOnExhaustedAction(actionRaw);
    if (action === 'no_op') return '无操作';
    if (action === 'notify_admin') return '发送通知';
    if (action === 'disable_and_notify') return '停用并发送通知';
    return '停用模型';
}

function normalizeAdminProviderOverageActionMap(rawMap) {
    const out = {};
    if (!rawMap || typeof rawMap !== 'object') return out;
    Object.entries(rawMap).forEach(([providerName, action]) => {
        const provider = normalizeAdminProviderKey(providerName);
        if (!provider) return;
        out[provider] = normalizeAdminQuotaOnExhaustedAction(action);
    });
    return out;
}

function resolveAdminProviderOverageAction(providerName, fallbackAction = '') {
    const provider = normalizeAdminProviderKey(providerName);
    const localMap = adminProviderOverageActionMap && typeof adminProviderOverageActionMap === 'object'
        ? adminProviderOverageActionMap
        : {};
    const fallback = normalizeAdminQuotaOnExhaustedAction(fallbackAction || adminQuotaDefaultOverageAction);
    if (!provider) return fallback;
    return normalizeAdminQuotaOnExhaustedAction(localMap[provider] || fallback);
}

function syncAdminQuotaActionFromPayload(quotaPayload) {
    const quota = quotaPayload && typeof quotaPayload === 'object' ? quotaPayload : {};
    adminQuotaDefaultOverageAction = normalizeAdminQuotaOnExhaustedAction(quota.on_exhausted || adminQuotaDefaultOverageAction);
    adminProviderOverageActionMap = normalizeAdminProviderOverageActionMap(quota.provider_overage_actions || {});

    if (Array.isArray(quota.providers)) {
        quota.providers.forEach((providerRow) => {
            if (!providerRow || typeof providerRow !== 'object') return;
            const providerName = normalizeAdminProviderKey(providerRow.name || '');
            providerRow.on_exhausted = resolveAdminProviderOverageAction(providerName, providerRow.on_exhausted || adminQuotaDefaultOverageAction);
        });
    }
}

function _formatAdminOveragePopupMessage(models) {
    const rows = Array.isArray(models) ? models : [];
    if (!rows.length) return '暂无超额模型。';
    const details = rows.slice(0, 12).map((item, idx) => {
        const provider = String(item && item.provider ? item.provider : 'unknown').trim() || 'unknown';
        const model = String(item && item.model ? item.model : 'unknown').trim() || 'unknown';
        const overage = Math.max(0, parseInt(item && item.overage_tokens ? item.overage_tokens : 0, 10) || 0);
        const used = Math.max(0, parseInt(item && item.used_tokens ? item.used_tokens : 0, 10) || 0);
        const total = Math.max(0, parseInt(item && item.quota_total_tokens ? item.quota_total_tokens : 0, 10) || 0);
        return `${idx + 1}. ${provider}/${model}（负${overage.toLocaleString()}，用${used.toLocaleString()}，共${total.toLocaleString()}）`;
    });
    if (rows.length > 12) {
        details.push(`... 另有 ${rows.length - 12} 个超额模型`);
    }
    return `检测到 ${rows.length} 个模型超额：${details.join('；')}`;
}

async function checkAdminQuotaOverageAlertOnRefresh() {
    if (currentUserRole !== 'admin') return;
    if (adminQuotaOverageNoticeChecked) return;
    adminQuotaOverageNoticeChecked = true;
    try {
        const res = await fetch('/api/admin/quota/overage-alert');
        const data = await res.json();
        if (!res.ok || !data || !data.success) return;
        if (!data.should_popup) return;
        const rows = Array.isArray(data.models) ? data.models : [];
        if (!rows.length) return;
        const message = _formatAdminOveragePopupMessage(rows);
        window.showConfirm('模型超额通知', message, 'danger', () => {}, () => {});
    } catch (_) {
        // ignore notify fetch errors to keep startup path stable
    }
}

async function saveAdminProviderOverageActionSetting(providerName, nextRawValue) {
    const provider = normalizeAdminProviderKey(providerName);
    if (!provider) {
        return { ok: false, action: normalizeAdminQuotaOnExhaustedAction(nextRawValue) };
    }

    const nextAction = normalizeAdminQuotaOnExhaustedAction(nextRawValue);
    const hadPrevious = Object.prototype.hasOwnProperty.call(adminProviderOverageActionMap || {}, provider);
    const previousAction = hadPrevious ? adminProviderOverageActionMap[provider] : adminQuotaDefaultOverageAction;

    adminProviderOverageActionMap[provider] = nextAction;
    if (Array.isArray(adminServerQuotaProvidersCache)) {
        const providerEntry = adminServerQuotaProvidersCache.find((row) => {
            return normalizeAdminProviderKey(row && row.name) === provider;
        });
        if (providerEntry && typeof providerEntry === 'object') {
            providerEntry.on_exhausted = nextAction;
        }
    }

    try {
        const res = await fetch('/api/admin/quota', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, on_exhausted: nextAction }),
        });
        const data = await res.json();
        if (!res.ok || !data || !data.success) {
            throw new Error((data && data.message) ? data.message : '保存失败');
        }

        const quota = data && data.quota && typeof data.quota === 'object' ? data.quota : {};
        syncAdminQuotaActionFromPayload(quota);
        if (Array.isArray(quota.providers)) {
            adminServerQuotaProvidersCache = quota.providers;
        }

        const finalAction = resolveAdminProviderOverageAction(provider, nextAction);
        showToast(`修改 ${provider} 的超额策略为 ${getAdminQuotaOnExhaustedActionLabel(finalAction)}`);
        return { ok: true, action: finalAction };
    } catch (err) {
        if (hadPrevious) {
            adminProviderOverageActionMap[provider] = normalizeAdminQuotaOnExhaustedAction(previousAction);
        } else {
            delete adminProviderOverageActionMap[provider];
        }
        if (Array.isArray(adminServerQuotaProvidersCache)) {
            const providerEntry = adminServerQuotaProvidersCache.find((row) => {
                return normalizeAdminProviderKey(row && row.name) === provider;
            });
            if (providerEntry && typeof providerEntry === 'object') {
                providerEntry.on_exhausted = resolveAdminProviderOverageAction(provider, adminQuotaDefaultOverageAction);
            }
        }
        showToast(`修改 ${provider} 的超额策略失败: ${String((err && err.message) || '未知错误')}`);
        return { ok: false, action: resolveAdminProviderOverageAction(provider, previousAction) };
    }
}

function getAdminOllamaProviderStatusEntry(providerKey) {
    const key = normalizeAdminProviderKey(providerKey);
    return adminOllamaModelStatusCache[key] || null;
}

function getAdminOllamaModelStatus(providerKey, modelId) {
    const providerEntry = getAdminOllamaProviderStatusEntry(providerKey);
    const modelKey = String(modelId || '').trim().toLowerCase();
    if (!providerEntry || !providerEntry.byModelId || !modelKey) return null;
    return providerEntry.byModelId[modelKey] || null;
}

function getAdminOllamaStatusButtonClass(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'running' || value === 'online' || value === 'ok') return 'model-status-btn-success';
    if (value === 'offline' || value === 'idle' || value === 'warning') return 'model-status-btn-warn';
    if (value === 'missing' || value === 'error' || value === 'failed') return 'model-status-btn-danger';
    return 'model-status-btn-loading';
}

function renderAdminOllamaStatusButton(providerKey, modelId, providerInfo) {
    const key = normalizeAdminProviderKey(providerKey);
    const modelKey = String(modelId || '').trim();
    if (!key || !modelKey || !isAdminOllamaProvider(providerInfo)) return '';
    const providerEntry = getAdminOllamaProviderStatusEntry(key);
    const statusEntry = getAdminOllamaModelStatus(key, modelKey);
    const providerLoaded = !!(providerEntry && providerEntry.loaded);
    const status = String((statusEntry && statusEntry.status) || (providerEntry && providerEntry.error ? 'error' : providerLoaded ? 'missing' : '')).trim().toLowerCase() || 'loading';
    const statusLabel = String((statusEntry && statusEntry.status_label) || (providerEntry && providerEntry.error ? '错误' : providerLoaded ? '不在线' : '加载中') || '状态').trim();
    const statusClass = getAdminOllamaStatusButtonClass(status);
    const title = `${key} / ${modelKey} · ${statusLabel}`;
    return `
        <button class="model-icon-btn model-status-btn ${statusClass}" title="${escapeHtml(title)}" onclick="event.stopPropagation(); openAdminOllamaModelStatusByEncoded('${encodeAdminInlineArg(key)}', '${encodeAdminInlineArg(modelKey)}')">
            <i class="fa-solid fa-circle"></i>
        </button>
    `;
}

async function loadAdminOllamaStatusForProvider(providerKey) {
    const key = normalizeAdminProviderKey(providerKey);
    if (!key) return null;
    if (adminOllamaStatusPending.has(key)) {
        return adminOllamaStatusPending.get(key);
    }

    const pending = (async () => {
        try {
            const res = await fetch(`/api/provider/ollama/list?provider=${encodeURIComponent(key)}&timeout=8`, { credentials: 'include' });
            const data = await res.json();
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
            adminOllamaModelStatusCache[key] = {
                byModelId,
                raw: data,
                error: data && data.success === false ? (data.message || '加载失败') : '',
                loaded: !(data && data.success === false),
                loadedAt: Date.now()
            };
            return adminOllamaModelStatusCache[key];
        } catch (err) {
            adminOllamaModelStatusCache[key] = {
                byModelId: {},
                raw: null,
                error: err && err.message ? err.message : '加载失败',
                loaded: false,
                loadedAt: Date.now()
            };
            return adminOllamaModelStatusCache[key];
        } finally {
            adminOllamaStatusPending.delete(key);
        }
    })();

    adminOllamaStatusPending.set(key, pending);
    return pending;
}

async function refreshAdminOllamaStatusCache(providerKeys = []) {
    const keys = Array.from(new Set((providerKeys || []).map((item) => normalizeAdminProviderKey(item)).filter(Boolean)));
    if (!keys.length) return;
    subscribeBrowserOllamaStatus(keys);
    syncBrowserOllamaStatus({
        providers: keys
    });
    const listEl = document.getElementById('adminModelConfigList');
    if (listEl) {
        renderAdminModelConfig();
    }
}

function formatAdminOllamaStatusLabel(statusEntry) {
    if (!statusEntry) return '加载中';
    const status = String(statusEntry.status || '').trim().toLowerCase();
    if (status === 'running') return '在线';
    if (status === 'offline') return '不在线';
    if (status === 'missing' || status === 'uninstalled') return '未安装';
    if (status === 'error') return '错误';
    return statusEntry.status_label || '状态未知';
}

function formatAdminOllamaStatusLevel(statusEntry) {
    if (!statusEntry) return 'info';
    const status = String(statusEntry.status || '').trim().toLowerCase();
    if (status === 'running') return 'success';
    if (status === 'offline') return 'warning';
    if (status === 'missing' || status === 'error') return 'danger';
    return statusEntry.status_level || 'info';
}

function renderAdminOllamaStatusDetail(statusEntry) {
    if (!statusEntry) {
        return '<div class="ollama-status-empty">暂无状态信息</div>';
    }
    const tagName = String((statusEntry.tag && (statusEntry.tag.name || statusEntry.tag.model || statusEntry.tag.id)) || statusEntry.model || '').trim();
    const psName = String((statusEntry.ps && (statusEntry.ps.name || statusEntry.ps.model || statusEntry.ps.id)) || '').trim();
    return `
        <div class="ollama-status-grid">
            <div class="ollama-status-row"><span>状态</span><strong>${escapeHtml(formatAdminOllamaStatusLabel(statusEntry))}</strong></div>
            <div class="ollama-status-row"><span>运行中</span><strong>${escapeHtml(statusEntry.running ? '是' : '否')}</strong></div>
            <div class="ollama-status-row"><span>已安装</span><strong>${escapeHtml(statusEntry.installed ? '是' : '否')}</strong></div>
            <div class="ollama-status-row"><span>keep_alive</span><strong>${escapeHtml(String(statusEntry.keep_alive || '5m'))}</strong></div>
            <div class="ollama-status-row"><span>tags</span><strong>${escapeHtml(tagName || '-')}</strong></div>
            <div class="ollama-status-row"><span>ps</span><strong>${escapeHtml(psName || '-')}</strong></div>
        </div>
        <div class="ollama-status-message ${escapeHtml(`level-${formatAdminOllamaStatusLevel(statusEntry)}`)}">${escapeHtml(statusEntry.message || '')}</div>
    `;
}

window.closeAdminTextConfirmModal = function() {
    const modal = document.getElementById('adminTextConfirmModal');
    const input = document.getElementById('adminTextConfirmInput');
    if (input) input.value = '';
    if (modal) modal.classList.remove('active');
    adminTextConfirmHandler = null;
};

function showAdminTextConfirmModal(onConfirm) {
    const modal = document.getElementById('adminTextConfirmModal');
    const input = document.getElementById('adminTextConfirmInput');
    const okBtn = document.getElementById('adminTextConfirmOkBtn');
    if (!modal || !input || !okBtn) return;

    adminTextConfirmHandler = onConfirm;
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 40);

    okBtn.onclick = async () => {
        const text = input.value.trim();
        if (text !== '确认修改') {
            showToast('请输入“确认修改”');
            return;
        }
        if (typeof adminTextConfirmHandler === 'function') {
            await adminTextConfirmHandler(text);
        }
        closeAdminTextConfirmModal();
    };
}

function normalizeAdminPublicApiPermissions(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    return {
        model_inference: !!src.model_inference,
        image_generation: !!src.image_generation,
        knowledge_read: !!src.knowledge_read,
        conversations_read: !!src.conversations_read,
        conversations_write: !!src.conversations_write,
        token_stats_read: !!src.token_stats_read,
        user_read: !!src.user_read
    };
}

function collectAdminPublicApiPermissionsFromUi() {
    const readPermissionToggle = (id) => document.getElementById(id)?.getAttribute('aria-checked') === 'true';
    return normalizeAdminPublicApiPermissions({
        model_inference: readPermissionToggle('adminPublicApiPermModel'),
        image_generation: readPermissionToggle('adminPublicApiPermImage'),
        knowledge_read: readPermissionToggle('adminPublicApiPermKnowledge'),
        conversations_read: readPermissionToggle('adminPublicApiPermConversation'),
        conversations_write: readPermissionToggle('adminPublicApiPermConversationWrite'),
        token_stats_read: readPermissionToggle('adminPublicApiPermToken'),
        user_read: readPermissionToggle('adminPublicApiPermUserRead')
    });
}

function applyAdminPublicApiPermissionsToUi(perms) {
    const p = normalizeAdminPublicApiPermissions(perms);
    const writePermissionToggle = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-checked', value ? 'true' : 'false');
    };
    writePermissionToggle('adminPublicApiPermModel', p.model_inference);
    writePermissionToggle('adminPublicApiPermImage', p.image_generation);
    writePermissionToggle('adminPublicApiPermKnowledge', p.knowledge_read);
    writePermissionToggle('adminPublicApiPermConversation', p.conversations_read);
    writePermissionToggle('adminPublicApiPermConversationWrite', p.conversations_write);
    writePermissionToggle('adminPublicApiPermToken', p.token_stats_read);
    writePermissionToggle('adminPublicApiPermUserRead', p.user_read);
}

function formatAdminPublicApiRemaining(key) {
    if (!key) return '-';
    if (key.is_expired) return '已过期';
    if (key.expires_in_seconds === null || key.expires_in_seconds === undefined) return '永久';
    const sec = Number(key.expires_in_seconds);
    if (!Number.isFinite(sec)) return '永久';
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${mins}分钟`;
    return `${Math.max(0, mins)}分钟`;
}

function formatAdminPublicApiDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const dt = new Date(raw);
    if (!Number.isFinite(dt.getTime())) return raw;
    const pad2 = (n) => String(n).padStart(2, '0');
    const yyyy = dt.getFullYear();
    const mm = pad2(dt.getMonth() + 1);
    const dd = pad2(dt.getDate());
    const hh = pad2(dt.getHours());
    const mi = pad2(dt.getMinutes());
    const ss = pad2(dt.getSeconds());
    return `${yyyy}年${mm}月${dd}日 ${hh}:${mi}:${ss}`;
}

function getAdminPapiScopeModule() {
    const module = window.NexoraAdminPapiScope;

    if (!module || typeof module.init !== 'function') {
        throw new Error('NexoraAdminPapiScope 模块未初始化');
    }

    return module;
}

function ensureAdminPublicApiLayout() {
    const tab = document.getElementById('settings-admin-auth-tab');
    if (!tab) return;
    const layout = tab.querySelector('.admin-users-layout');
    if (layout) layout.classList.add('admin-public-api-layout');
    const detail = layout ? layout.querySelector('.admin-user-detail') : null;
    if (detail) detail.classList.add('admin-public-api-detail');

    const globalToggle = document.getElementById('adminPublicApiEnabledToggle');
    if (globalToggle) {
        const toggleWrap = globalToggle.closest('label');
        if (toggleWrap) toggleWrap.style.display = 'none';
    }
    const saveGlobalBtn = document.getElementById('adminPublicApiSaveGlobalBtn');
    if (saveGlobalBtn) saveGlobalBtn.style.display = 'none';
    const statusGroup = document.getElementById('adminPublicApiStatus')?.closest('.form-group');
    if (statusGroup) statusGroup.style.display = 'none';
    if (detail) {
        const keyPreviewEl = document.getElementById('adminPublicApiKeyPreview');
        const createdEl = document.getElementById('adminPublicApiCreatedAt');
        const expiresEl = document.getElementById('adminPublicApiExpiresAt');
        const remainingEl = document.getElementById('adminPublicApiRemaining');
        [keyPreviewEl, createdEl, expiresEl, remainingEl].forEach((el) => {
            if (!el) return;
            el.classList.remove('settings-field');
            el.classList.add('admin-info-text');
        });
        const nameGroup = document.getElementById('adminPublicApiNameInput')?.closest('.form-group');
        const keyPreviewGroup = document.getElementById('adminPublicApiKeyPreview')?.closest('.form-group');
        const scopeGroup = document.getElementById('adminPublicApiScopeSegment')?.closest('.form-group');
        const ownerGroup = document.getElementById('adminPublicApiOwnerInput')?.closest('.form-group');
        const createdGroup = document.getElementById('adminPublicApiCreatedAt')?.closest('.form-group');
        const expiresGroup = document.getElementById('adminPublicApiExpiresAt')?.closest('.form-group');
        const remainingGroup = document.getElementById('adminPublicApiRemaining')?.closest('.form-group');
        let createdByEl = document.getElementById('adminPublicApiCreatedBy');
        let createdByGroup = createdByEl ? createdByEl.closest('.form-group') : null;
        if (!createdByGroup) {
            createdByGroup = document.createElement('div');
            createdByGroup.className = 'form-group';
            createdByGroup.innerHTML = '<label>生成者</label><div id="adminPublicApiCreatedBy" class="admin-info-text">-</div>';
            createdByEl = createdByGroup.querySelector('#adminPublicApiCreatedBy');
        }

        let infoGrid = detail.querySelector('#adminPublicApiInfoGrid');
        if (!infoGrid) {
            infoGrid = document.createElement('div');
            infoGrid.id = 'adminPublicApiInfoGrid';
            infoGrid.className = 'admin-user-detail-grid admin-public-api-grid';
            const permGroup = document.getElementById('adminPublicApiPermModel')?.closest('.form-group');
            if (permGroup) detail.insertBefore(infoGrid, permGroup);
            else detail.insertBefore(infoGrid, detail.firstChild);
        }
        [nameGroup, keyPreviewGroup, scopeGroup, ownerGroup, createdGroup, expiresGroup, remainingGroup, createdByGroup].forEach((group) => {
            if (group && group.parentElement !== infoGrid) infoGrid.appendChild(group);
        });
        if (createdByEl) createdByEl.id = 'adminPublicApiCreatedBy';
    }

    const permGroup = document.getElementById('adminPublicApiPermModel')?.closest('.form-group');
    if (permGroup) {
        permGroup.classList.add('admin-public-api-perm-wrap');
        const heading = permGroup.querySelector('label');
        if (heading) heading.textContent = '权限';
        let permGrid = permGroup.querySelector('.admin-public-api-perm-grid');
        if (!permGrid) {
            permGrid = document.createElement('div');
            permGrid.className = 'admin-public-api-perm-grid';
            permGroup.appendChild(permGrid);
        }
        const permItems = [
            ['adminPublicApiPermModel', '模型调用'],
            ['adminPublicApiPermImage', '生图 API 调用'],
            ['adminPublicApiPermKnowledge', '知识库读取'],
            ['adminPublicApiPermConversation', '会话读取'],
            ['adminPublicApiPermConversationWrite', '会话写入'],
            ['adminPublicApiPermToken', 'Token 统计读取'],
            ['adminPublicApiPermUserRead', '用户信息读取'],
        ];
        permItems.forEach(([id, labelText]) => {
            let control = permGrid.querySelector(`.papi-permission-toggle[data-key="${id}"]`);
            let enabled = true;

            if (control) {
                // 已转换为按钮：保留按钮上当前的权限状态
                enabled = control.getAttribute('aria-checked') === 'true';
            } else {
                // 首次转换：模板提供的是 checkbox，把其勾选状态迁移到按钮后移除
                const templateInput = document.getElementById(id);
                if (templateInput && templateInput.tagName === 'INPUT') {
                    enabled = !!templateInput.checked;
                    const oldWrap = templateInput.closest('label');
                    templateInput.remove();
                    if (oldWrap && oldWrap.parentElement) oldWrap.remove();
                }
                control = document.createElement('button');
                control.type = 'button';
                control.id = id;
                control.dataset.key = id;
                control.setAttribute('role', 'switch');
                control.addEventListener('click', () => {
                    const next = control.getAttribute('aria-checked') !== 'true';
                    control.setAttribute('aria-checked', next ? 'true' : 'false');
                });
                permGrid.appendChild(control);
            }

            control.className = 'papi-permission-toggle';
            control.setAttribute('aria-checked', enabled ? 'true' : 'false');

            const label = document.createElement('span');
            label.className = 'papi-permission-toggle-label';
            label.textContent = labelText;
            const track = document.createElement('span');
            track.className = 'papi-permission-toggle-track';
            track.setAttribute('aria-hidden', 'true');
            const thumb = document.createElement('span');
            thumb.className = 'papi-permission-toggle-thumb';
            track.appendChild(thumb);
            control.replaceChildren(label, track);
        });
    }

    const saveBtn = document.getElementById('adminPublicApiSaveSettingsBtn');
    const regenerateBtn = document.getElementById('adminPublicApiRegenerateBtn');
    const deleteBtn = document.getElementById('adminPublicApiRevokeBtn');
    const saveGroup = saveBtn ? saveBtn.closest('.form-group') : null;
    if (saveGroup && saveBtn && regenerateBtn && deleteBtn) {
        saveGroup.classList.remove('admin-public-api-save-row');
        saveGroup.classList.add('admin-public-api-action-row');
        if (saveBtn.parentElement !== saveGroup) saveGroup.appendChild(saveBtn);
        const dangerRow = saveGroup.parentElement?.querySelector('.admin-public-api-danger-row');
        if (regenerateBtn.parentElement !== saveGroup) saveGroup.appendChild(regenerateBtn);
        if (deleteBtn.parentElement !== saveGroup) saveGroup.appendChild(deleteBtn);
        if (dangerRow && dangerRow.parentElement) dangerRow.remove();
        regenerateBtn.classList.remove('btn-primary');
        regenerateBtn.classList.remove('btn-warning');
        saveBtn.classList.add('admin-public-api-action-btn');
        regenerateBtn.classList.add('admin-public-api-action-btn');
        deleteBtn.classList.add('admin-public-api-action-btn');
        deleteBtn.classList.remove('btn-cancel');
        deleteBtn.classList.remove('btn-danger-solid');
        deleteBtn.classList.add('btn-danger-small');
    }

    getAdminPapiScopeModule().init({
        onFilterChanged() {
            const payload = adminPublicApiAuthState && typeof adminPublicApiAuthState === 'object'
                ? adminPublicApiAuthState
                : { keys: [] };
            const visibleKeys = getAdminPapiScopeModule().filterKeys(payload.keys);
            adminSelectedPublicApiKeyId = String(visibleKeys[0]?.id || '');
            renderAdminPublicApiAuth(payload, { keepLatest: true });
        },
    });
}

function getSelectedAdminPublicApiKey(auth = adminPublicApiAuthState, options = {}) {
    const payload = (auth && typeof auth === 'object') ? auth : {};
    const keys = Array.isArray(payload.keys) ? payload.keys : [];
    if (!keys.length) return null;
    const allowFallback = !!options.allowFallback;
    const usePayloadDefault = !!options.usePayloadDefault;
    const wantedId = String(
        adminSelectedPublicApiKeyId || (usePayloadDefault ? payload.selected_key_id : '') || ''
    ).trim();
    const selected = wantedId ? keys.find((item) => String(item?.id || '') === wantedId) : null;
    if (selected) return selected;
    if (allowFallback) {
        const fallback = keys.find((item) => String(item?.status || '').toLowerCase() === 'active' && !item?.is_expired) || keys[0];
        return fallback || null;
    }
    return null;
}

function renderAdminPublicApiKeyList(payload) {
    const listEl = document.getElementById('adminPublicApiKeyList');
    if (!listEl) return;
    const allKeys = Array.isArray(payload?.keys) ? payload.keys : [];
    const keys = getAdminPapiScopeModule().filterKeys(allKeys);
    if (!keys.length) {
        listEl.innerHTML = `<div class="admin-user-detail-empty" style="padding:12px;">${allKeys.length ? '当前筛选没有匹配的 Key。' : '暂无 Key，点击上方“生成 Public API Key”。'}</div>`;
        return;
    }
    const selected = keys.find((item) => String(item?.id || '') === adminSelectedPublicApiKeyId) || null;
    const selectedId = String(selected?.id || '');
    listEl.innerHTML = keys.map((item) => {
        const id = String(item?.id || '');
        const name = escapeHtml(String(item?.name || id || 'Unnamed Key'));
        const isExpired = !!item?.is_expired;
        const statusRaw = String(item?.status || 'active').toLowerCase();
        const statusText = statusRaw === 'revoked' ? 'revoked' : (isExpired ? 'expired' : 'active');
        const activeCls = id === selectedId ? ' active' : '';
        return `
            <div class="admin-user-item${activeCls}" data-papi-key-id="${escapeHtml(id)}">
                <div class="admin-user-avatar admin-public-api-key-icon">
                    <i class="fa-solid fa-key" aria-hidden="true"></i>
                </div>
                <div>
                    <div class="admin-user-name">${name}</div>
                    <div class="admin-user-meta">${escapeHtml(statusText)}</div>
                    <div class="papi-key-meta-row">${getAdminPapiScopeModule().describeKey(item)}</div>
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.admin-user-item[data-papi-key-id]').forEach((node) => {
        node.addEventListener('click', () => {
            const keyId = String(node.getAttribute('data-papi-key-id') || '').trim();
            if (!keyId) return;
            adminSelectedPublicApiKeyId = keyId;
            renderAdminPublicApiAuth(adminPublicApiAuthState, { keepLatest: true });
        });
    });
}

function renderAdminPublicApiAuth(auth, options = {}) {
    const payload = (auth && typeof auth === 'object') ? auth : {};
    adminPublicApiAuthState = payload;
    ensureAdminPublicApiLayout();
    const keys = Array.isArray(payload.keys) ? payload.keys : [];
    getAdminPapiScopeModule().setKeys(keys);
    if (!keys.length) adminSelectedPublicApiKeyId = '';
    if (options.selectedKeyId) {
        adminSelectedPublicApiKeyId = String(options.selectedKeyId || '').trim();
    }

    const selected = getSelectedAdminPublicApiKey(payload);
    if (selected && selected.id) adminSelectedPublicApiKeyId = String(selected.id);
    const keyPreviewEl = document.getElementById('adminPublicApiKeyPreview');
    const createdEl = document.getElementById('adminPublicApiCreatedAt');
    const expiresEl = document.getElementById('adminPublicApiExpiresAt');
    const remainingEl = document.getElementById('adminPublicApiRemaining');
    const createdByEl = document.getElementById('adminPublicApiCreatedBy');
    const nameInput = document.getElementById('adminPublicApiNameInput');
    const detailPane = document.querySelector('#settings-admin-auth-tab .admin-user-detail');

    if (detailPane) {
        let emptyEl = detailPane.querySelector('.admin-public-api-empty');
        if (!emptyEl) {
            emptyEl = document.createElement('div');
            emptyEl.className = 'admin-public-api-empty admin-user-detail-empty';
            emptyEl.textContent = '请先在左侧选择一个 API Key。';
            detailPane.insertBefore(emptyEl, detailPane.firstChild);
        }
        const detailBlocks = Array.from(detailPane.children).filter((node) => node !== emptyEl);
        const hasSelection = !!selected;
        emptyEl.style.display = hasSelection ? 'none' : 'block';
        detailBlocks.forEach((node) => {
            // 详情区按钮行使用了强制 grid 样式，必须用类名统一控制无选中状态。
            node.classList.toggle('admin-public-api-hidden', !hasSelection);
            node.style.display = hasSelection ? '' : 'none';
        });
    }

    if (nameInput) nameInput.value = selected ? String(selected.name || '') : '';
    if (keyPreviewEl) keyPreviewEl.textContent = selected ? (selected.key_preview || '-') : '-';
    if (createdEl) createdEl.textContent = selected ? formatAdminPublicApiDateTime(selected.created_at || '') : '-';
    if (expiresEl) expiresEl.textContent = selected ? formatAdminPublicApiDateTime(selected.expires_at || '') : '-';
    if (remainingEl) remainingEl.textContent = formatAdminPublicApiRemaining(selected);
    if (createdByEl) createdByEl.textContent = selected ? (String(selected.created_by || '').trim() || '-') : '-';
    getAdminPapiScopeModule().renderSelection(selected);
    applyAdminPublicApiPermissionsToUi(selected?.permissions || {});
    renderAdminPublicApiKeyList(payload);
}

async function loadAdminPublicApiAuth(options = {}) {
    ensureAdminPublicApiLayout();
    try {
        const res = await fetch('/api/admin/auth/public-api');
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '加载失败');
        }
        renderAdminPublicApiAuth(data.auth || {}, { keepLatest: !!options.keepLatest });
    } catch (err) {
        showToast(err.message || '加载认证状态失败');
    }
}

async function saveAdminPublicApiSettings() {
    const selected = getSelectedAdminPublicApiKey();
    if (!selected) {
        showToast('请先在左侧选择一个 Key');
        return;
    }
    try {
        const permissions = collectAdminPublicApiPermissionsFromUi();
        const keyName = String(document.getElementById('adminPublicApiNameInput')?.value || '').trim();
        const scopeSettings = getAdminPapiScopeModule().collectSettings();
        const res = await fetch('/api/admin/auth/public-api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key_id: String(selected.id || ''),
                permissions,
                name: keyName,
                ...scopeSettings,
            })
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '保存失败');
        }
        renderAdminPublicApiAuth(data.auth || {}, { keepLatest: true, selectedKeyId: String(selected.id || '') });
        showToast('当前 Key 设置已保存');
    } catch (err) {
        showToast(err.message || '保存认证设置失败');
    }
}

async function saveAdminPublicApiGlobalSettings() {
    try {
        const enabled = !!document.getElementById('adminPublicApiEnabledToggle')?.checked;
        const res = await fetch('/api/admin/auth/public-api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_api_enabled: enabled })
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '保存失败');
        }
        renderAdminPublicApiAuth(data.auth || {}, { keepLatest: true });
        showToast('Public API 总开关已保存');
    } catch (err) {
        showToast(err.message || '保存总开关失败');
    }
}

function getPapiModalModule() {
    const module = window.NexoraSettingsDialog;

    if (
        !module
        || typeof module.confirm !== 'function'
        || typeof module.copyText !== 'function'
        || typeof module.createDialogController !== 'function'
        || typeof module.getExpiryValue !== 'function'
        || typeof module.localizePublicApiExpiryOptions !== 'function'
        || typeof module.renderExpirySlider !== 'function'
        || typeof module.setExpiryDisabled !== 'function'
    ) {
        throw new Error('NexoraSettingsDialog 模块未初始化');
    }

    return module;
}

function getAdminPublicApiExpireOptions() {
    const options = adminPublicApiAuthState?.expire_options;

    if (!Array.isArray(options)) {
        throw new Error('认证管理未返回有效期选项');
    }

    return options;
}

function resetAdminPublicApiKeyModal() {
    const form = document.getElementById('adminPublicApiKeyModalForm');
    const latestKeyGroup = document.getElementById('adminPublicApiModalLatestKeyGroup');
    const latestKeyEl = document.getElementById('adminPublicApiModalLatestKey');
    const confirmBtn = document.getElementById('adminPublicApiKeyModalConfirmBtn');
    const cancelBtn = document.getElementById('adminPublicApiKeyModalCancelBtn');
    const keyNameInput = document.getElementById('adminPublicApiKeyNameInput');
    adminPublicApiModalCompleted = false;
    if (form) form.hidden = false;
    if (latestKeyGroup) latestKeyGroup.hidden = true;
    if (latestKeyEl) latestKeyEl.textContent = '';
    if (confirmBtn) confirmBtn.textContent = '确认';
    if (cancelBtn) cancelBtn.hidden = false;
    if (keyNameInput) keyNameInput.disabled = false;
    getPapiModalModule().setExpiryDisabled(
        document.getElementById('adminPublicApiExpireModalSlider'),
        false,
    );
}

function ensureAdminPublicApiDialogController() {
    if (adminPublicApiDialogController) {
        return adminPublicApiDialogController;
    }

    adminPublicApiDialogController = getPapiModalModule().createDialogController({
        dialogId: 'adminPublicApiKeyModal',
        onClose: resetAdminPublicApiKeyModal,
    });

    return adminPublicApiDialogController;
}

function initAdminPublicApiModal() {
    ensureAdminPublicApiDialogController();
}

window.closeAdminPublicApiKeyModal = function() {
    ensureAdminPublicApiDialogController().close('action');
};

window.openAdminPublicApiKeyModal = function(mode = 'generate') {
    if (mode !== 'generate' && mode !== 'regenerate') {
        throw new Error(`不支持的 API Key 操作：${mode}`);
    }

    adminPublicApiActionMode = mode;
    adminPublicApiModalCompleted = false;
    const selected = getSelectedAdminPublicApiKey();
    if (adminPublicApiActionMode === 'regenerate' && !selected) {
        showToast('请先在左侧选择一个 Key');
        return;
    }
    const title = document.getElementById('adminPublicApiKeyModalTitle');
    const desc = document.getElementById('adminPublicApiKeyModalDesc');
    const form = document.getElementById('adminPublicApiKeyModalForm');
    const keyNameInput = document.getElementById('adminPublicApiKeyNameInput');
    const confirmBtn = document.getElementById('adminPublicApiKeyModalConfirmBtn');
    const cancelBtn = document.getElementById('adminPublicApiKeyModalCancelBtn');
    const latestKeyGroup = document.getElementById('adminPublicApiModalLatestKeyGroup');
    const latestKeyEl = document.getElementById('adminPublicApiModalLatestKey');
    if (title) title.textContent = adminPublicApiActionMode === 'regenerate' ? '重新生成 Public API Key' : '生成 Public API Key';
    if (desc) desc.textContent = adminPublicApiActionMode === 'regenerate'
        ? '将为当前选中的 Key 重新生成明文 key，旧 key 会立即失效。'
        : '创建新的 Public API Key（明文仅展示一次）。';
    if (keyNameInput) keyNameInput.value = selected ? String(selected.name || '') : '';
    try {
        const preset = adminPublicApiActionMode === 'regenerate'
            ? String(selected.expire_option || '').trim()
            : '7d';
        getPapiModalModule().renderExpirySlider(
            document.getElementById('adminPublicApiExpireModalSlider'),
            getPapiModalModule().localizePublicApiExpiryOptions(getAdminPublicApiExpireOptions()),
            preset,
        );
        if (keyNameInput) keyNameInput.disabled = false;
        getPapiModalModule().setExpiryDisabled(
            document.getElementById('adminPublicApiExpireModalSlider'),
            false,
        );
        if (confirmBtn) confirmBtn.textContent = '确认';
        if (cancelBtn) cancelBtn.hidden = false;
        if (form) form.hidden = false;
        if (latestKeyGroup) latestKeyGroup.hidden = true;
        if (latestKeyEl) latestKeyEl.textContent = '';
        getAdminPapiScopeModule().prepareModal(
            adminPublicApiActionMode,
            adminPublicApiActionMode === 'regenerate' ? selected : null,
        );
        ensureAdminPublicApiDialogController().open({ initialFocus: keyNameInput });
    } catch (err) {
        console.error('[Admin PAPI Modal] 打开弹窗失败', err);
        showToast(err.message || '打开 API Key 弹窗失败');
    }
};

async function submitAdminPublicApiKeyAction() {
    if (adminPublicApiModalCompleted) {
        closeAdminPublicApiKeyModal();
        return;
    }
    const selected = getSelectedAdminPublicApiKey();
    const keyNameInput = document.getElementById('adminPublicApiKeyNameInput');
    const latestKeyGroup = document.getElementById('adminPublicApiModalLatestKeyGroup');
    const latestKeyEl = document.getElementById('adminPublicApiModalLatestKey');
    const confirmBtn = document.getElementById('adminPublicApiKeyModalConfirmBtn');
    const cancelBtn = document.getElementById('adminPublicApiKeyModalCancelBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        if (adminPublicApiActionMode !== 'generate' && adminPublicApiActionMode !== 'regenerate') {
            throw new Error(`不支持的 API Key 操作：${adminPublicApiActionMode}`);
        }

        const expire = getPapiModalModule().getExpiryValue(
            document.getElementById('adminPublicApiExpireModalSlider'),
        );
        const keyName = String(keyNameInput?.value || '').trim();
        const permissions = collectAdminPublicApiPermissionsFromUi();
        const action = adminPublicApiActionMode;
        const body = {
            expire,
            permissions,
            name: keyName
        };
        if (action === 'regenerate') {
            if (!selected || !selected.id) {
                throw new Error('请先选择要重新生成的 Key');
            }
            body.key_id = String(selected.id);
        } else {
            Object.assign(body, getAdminPapiScopeModule().collectCreateFields());
        }
        const res = await fetch(`/api/admin/auth/public-api/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '操作失败');
        }
        const plainKey = String(data.public_api_key || '').trim();
        if (!plainKey) {
            throw new Error('接口未返回新 API Key');
        }
        renderAdminPublicApiAuth(data.auth || {}, {
            keepLatest: true,
            selectedKeyId: action === 'regenerate'
                ? String(selected?.id || '')
                : String((data.auth || {}).selected_key_id || '')
        });
        if (latestKeyEl) latestKeyEl.textContent = plainKey;
        if (latestKeyGroup) latestKeyGroup.hidden = false;
        const form = document.getElementById('adminPublicApiKeyModalForm');
        if (form) form.hidden = true;
        if (keyNameInput) keyNameInput.disabled = true;
        getPapiModalModule().setExpiryDisabled(
            document.getElementById('adminPublicApiExpireModalSlider'),
            true,
        );
        adminPublicApiModalCompleted = true;
        if (confirmBtn) confirmBtn.textContent = '关闭';
        if (cancelBtn) cancelBtn.hidden = true;
        showToast(action === 'regenerate' ? '当前 Key 已重新生成，旧 key 已失效' : 'Public API key 已生成');
    } catch (err) {
        showToast(err.message || '操作失败');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function copyAdminPublicApiModalKey() {
    const plainKey = String(document.getElementById('adminPublicApiModalLatestKey')?.textContent || '').trim();

    if (!plainKey) {
        showToast('当前没有可复制的 Key');
        return;
    }

    try {
        await getPapiModalModule().copyText(plainKey);
        showToast('API Key 已复制');
    } catch (err) {
        showToast(`复制失败: ${err.message || err}`);
    }
}

async function revokeAdminPublicApiKey() {
    const selected = getSelectedAdminPublicApiKey();
    if (!selected || !selected.id) {
        showToast('请先在左侧选择一个 Key');
        return;
    }

    const keyName = String(selected.name || selected.id);
    const confirmed = await getPapiModalModule().confirm({
        confirmLabel: '删除',
        message: `确认删除“${keyName}”吗？此操作不可撤销。`,
        dialogId: 'papiKeyConfirmModal',
        title: '删除 API Key',
        tone: 'danger',
    });

    if (!confirmed) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/auth/public-api/keys/${encodeURIComponent(String(selected.id))}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '删除失败');
        }
        adminSelectedPublicApiKeyId = '';
        renderAdminPublicApiAuth(data.auth || {}, { keepLatest: false });
        showToast('Key 已删除');
    } catch (err) {
        showToast(err.message || '删除失败');
    }
}

function applyAdminGenImageApiPayload(data) {
    adminGenImageApisCache = Array.isArray(data && data.apis) ? data.apis : [];
    const currentExists = adminSelectedGenImageApiId
        && adminGenImageApisCache.some((item) => String((item && item.api_id) || '') === adminSelectedGenImageApiId);

    if (!currentExists) {
        const enabled = adminGenImageApisCache.find((item) => item && item.enabled);
        const first = adminGenImageApisCache[0];
        adminSelectedGenImageApiId = String((enabled && enabled.api_id) || (first && first.api_id) || '');
    }
}

async function loadAdminGenImageApis() {
    const listEl = document.getElementById('adminGenImageApiList');
    const detailEl = document.getElementById('adminGenImageApiDetail');

    if (!listEl || !detailEl) return;

    listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">Loading...</div>';
    detailEl.innerHTML = '<div class="admin-user-detail-empty">Loading...</div>';

    try {
        const res = await fetch('/api/admin/gen-image/apis');
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message || '加载失败');
        }

        applyAdminGenImageApiPayload(data);
        renderAdminGenImageApis();
    } catch (err) {
        const msg = escapeHtml(err && err.message ? err.message : '加载失败');
        listEl.innerHTML = `<div class="admin-user-detail-empty" style="padding:12px; color:#dc2626;">${msg}</div>`;
        detailEl.innerHTML = `<div class="admin-user-detail-empty" style="color:#dc2626;">${msg}</div>`;
    }
}

function renderAdminGenImageApis() {
    renderAdminGenImageApiList();
    renderAdminGenImageApiDetail();
}

function getSelectedAdminGenImageApi() {
    return (adminGenImageApisCache || []).find((item) => {
        return String((item && item.api_id) || '') === String(adminSelectedGenImageApiId || '');
    }) || null;
}

function createAdminGenImageApiFormModel(item) {
    const source = item && typeof item === 'object' ? item : {};

    return {
        api_id: String(source.api_id || '').trim(),
        name: String(source.name || '').trim(),
        api_type: String(source.api_type || 'openai').trim() || 'openai',
        api_key: String(source.api_key || '').trim(),
        base_url: String(source.base_url || 'https://api.openai.com/v1').trim(),
        model: String(source.model || 'gpt-image-1').trim(),
        size: String(source.size || '1024x1024').trim(),
        quality: String(source.quality || 'auto').trim(),
        response_format: String(source.response_format || 'b64_json').trim(),
        timeout: String(source.timeout || 120).trim(),
        enabled: !!source.enabled,
        created_at: source.created_at,
        updated_at: source.updated_at,
    };
}

function readAdminGenImageApiControl(id) {
    const control = document.getElementById(id);

    if (!control) {
        throw new Error(`缺少生图接口表单字段: ${id}`);
    }

    return control;
}

function readAdminGenImageApiText(id) {
    return String(readAdminGenImageApiControl(id).value || '').trim();
}

function readAdminGenImageApiChecked(id) {
    return !!readAdminGenImageApiControl(id).checked;
}

function validateAdminGenImageApiPayload(payload) {
    if (!payload.api_id) {
        return '接口标识不能为空';
    }

    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(payload.api_id)) {
        return '接口标识只能包含字母、数字、下划线、横线和点';
    }

    if (!payload.model) {
        return '模型 ID 不能为空';
    }

    if (!/^\d{2,5}x\d{2,5}$/i.test(payload.size)) {
        return '图片尺寸格式必须是 1024x1024 这样的 宽x高';
    }

    if (!payload.quality) {
        return '质量不能为空';
    }

    if (!payload.response_format) {
        return '返回格式不能为空';
    }

    if (!Number.isInteger(payload.timeout) || payload.timeout < 10 || payload.timeout > 600) {
        return '超时秒数必须是 10 到 600 之间的整数';
    }

    if (payload.enabled && !payload.api_key) {
        return '启用生图接口前必须填写 API Key';
    }

    if (payload.enabled && !payload.base_url) {
        return '启用生图接口前必须填写 Base URL';
    }

    return '';
}

function renderAdminGenImageApiList() {
    const listEl = document.getElementById('adminGenImageApiList');

    if (!listEl) return;

    const keyword = String(adminGenImageApiFilterKeyword || '').trim().toLowerCase();
    const rows = (adminGenImageApisCache || []).filter((item) => {

        if (!keyword) return true;

        const text = [
            item.api_id || '',
            item.name || '',
            item.base_url || '',
            item.model || '',
            item.enabled ? 'enabled 启用' : 'disabled 关闭',
        ].join(' ').toLowerCase();
        return text.includes(keyword);
    });

    if (!rows.length) {
        listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">暂无生图接口</div>';
        return;
    }

    listEl.innerHTML = rows.map((item) => {
        const apiId = String(item.api_id || '').trim();
        const active = apiId === adminSelectedGenImageApiId ? 'active' : '';
        const enabledBadge = item.enabled
            ? '<span class="model-status-pill ok">启用</span>'
            : '<span class="model-status-pill muted">关闭</span>';
        return `
            <div class="admin-user-item ${active}" onclick="adminSelectGenImageApi('${encodeURIComponent(apiId)}')">
                <div class="model-admin-model-icon admin-gen-image-icon" style="width:32px; height:32px;">
                    <i class="fa-regular fa-image" aria-hidden="true"></i>
                </div>
                <div>
                    <div class="admin-user-name">${escapeHtml(item.name || apiId)}</div>
                    <div class="admin-user-meta">${escapeHtml(apiId)} · ${escapeHtml(item.model || '-')}</div>
                    <div class="admin-user-meta">${enabledBadge}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminGenImageApiDetail() {
    const detailEl = document.getElementById('adminGenImageApiDetail');

    if (!detailEl) return;

    const item = getSelectedAdminGenImageApi();
    const formModel = createAdminGenImageApiFormModel(item);
    const isExisting = !!item;
    const apiId = String(formModel.api_id || '').trim();
    const createdAt = formModel.created_at ? new Date(Number(formModel.created_at) * 1000).toLocaleString() : '-';
    const updatedAt = formModel.updated_at ? new Date(Number(formModel.updated_at) * 1000).toLocaleString() : '-';
    const openaiSelected = formModel.api_type === 'openai_compatible' ? '' : 'selected';
    const compatibleSelected = formModel.api_type === 'openai_compatible' ? 'selected' : '';
    const enabledAction = !isExisting
        ? ''
        : formModel.enabled
            ? `<button class="btn-primary-outline btn-compact" type="button" onclick="adminDisableGenImageApi()"><i class="fa-solid fa-power-off" aria-hidden="true"></i><span>关闭接口</span></button>`
            : `<button class="btn-primary-outline btn-compact" type="button" onclick="adminEnableGenImageApi('${encodeURIComponent(apiId)}')"><i class="fa-solid fa-check" aria-hidden="true"></i><span>启用接口</span></button>`;
    const deleteAction = isExisting
        ? `<button class="btn-danger-small btn-compact" type="button" onclick="adminDeleteGenImageApi('${encodeURIComponent(apiId)}')"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>删除</span></button>`
        : '';
    const resetAction = isExisting
        ? `<button class="btn-primary-outline btn-compact" type="button" onclick="openAdminGenImageApiEditor('${encodeURIComponent(apiId)}')"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>重置</span></button>`
        : '';

    adminGenImageApiEditorState = { originalApiId: isExisting ? apiId : '' };

    detailEl.innerHTML = `
        <div class="admin-user-detail-head admin-gen-image-detail-head">
            <div class="admin-gen-image-head-main">
                <div class="model-admin-model-icon admin-gen-image-icon" style="width:40px; height:40px;">
                    <i class="fa-regular fa-image" aria-hidden="true"></i>
                </div>
                <div>
                    <div class="admin-user-name" style="font-size:16px;">${escapeHtml(isExisting ? (formModel.name || apiId) : '新增生图接口')}</div>
                    <div class="admin-user-meta">${escapeHtml(isExisting ? `ID: ${apiId}` : '填写接口数据后保存')}</div>
                </div>
            </div>
            <div class="admin-user-actions admin-gen-image-actions">
                <button class="btn-primary-outline btn-compact" type="button" onclick="saveAdminGenImageApiDetail()"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>保存</span></button>
                ${resetAction}
                ${enabledAction}
                ${deleteAction}
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>接口标识</label>
                <input id="adminGenImageApiIdInput" class="input-modern" value="${escapeHtml(formModel.api_id)}" placeholder="openai_image">
            </div>
            <div class="form-group">
                <label>接口名称</label>
                <input id="adminGenImageNameInput" class="input-modern" value="${escapeHtml(formModel.name)}" placeholder="OpenAI Image">
            </div>
            <div class="form-group">
                <label>API Type</label>
                <select id="adminGenImageApiTypeInput" class="input-modern">
                    <option value="openai" ${openaiSelected}>openai</option>
                    <option value="openai_compatible" ${compatibleSelected}>openai_compatible</option>
                </select>
            </div>
            <div class="form-group">
                <label>API Key</label>
                <input id="adminGenImageApiKeyInput" class="input-modern" value="${escapeHtml(formModel.api_key)}" placeholder="api key">
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>Base URL</label>
                <input id="adminGenImageBaseUrlInput" class="input-modern" value="${escapeHtml(formModel.base_url)}" placeholder="https://api.openai.com/v1">
            </div>
            <div class="form-group">
                <label>模型 ID</label>
                <input id="adminGenImageModelInput" class="input-modern" value="${escapeHtml(formModel.model)}" placeholder="gpt-image-1">
            </div>
            <div class="form-group">
                <label>尺寸</label>
                <input id="adminGenImageSizeInput" class="input-modern" value="${escapeHtml(formModel.size)}" placeholder="1024x1024">
            </div>
            <div class="form-group">
                <label>质量</label>
                <input id="adminGenImageQualityInput" class="input-modern" value="${escapeHtml(formModel.quality)}" placeholder="auto">
            </div>
            <div class="form-group">
                <label>返回格式</label>
                <input id="adminGenImageResponseFormatInput" class="input-modern" value="${escapeHtml(formModel.response_format)}" placeholder="b64_json">
            </div>
            <div class="form-group">
                <label>超时秒数</label>
                <input id="adminGenImageTimeoutInput" class="input-modern" type="number" min="10" max="600" value="${escapeHtml(formModel.timeout)}" placeholder="120">
            </div>
            <div class="form-group">
                <label>状态</label>
                <label style="display:flex; align-items:center; gap:8px; min-height: 38px; color:#334155;">
                    <input id="adminGenImageEnabledInput" type="checkbox" ${formModel.enabled ? 'checked' : ''}>
                    保存后作为当前启用接口
                </label>
            </div>
            <div class="form-group">
                <label>创建时间</label>
                <div class="admin-info-text">${escapeHtml(createdAt)}</div>
            </div>
            <div class="form-group">
                <label>更新时间</label>
                <div class="admin-info-text">${escapeHtml(updatedAt)}</div>
            </div>
        </div>
    `;
}

function openAdminGenImageApiEditor(apiId = '') {
    const normalizedApiId = String(apiId || '').trim();
    adminSelectedGenImageApiId = normalizedApiId;
    adminGenImageApiEditorState = { originalApiId: normalizedApiId };
    renderAdminGenImageApis();

    window.setTimeout(() => {
        const firstInput = document.getElementById('adminGenImageApiIdInput');

        if (firstInput) firstInput.focus();
    }, 0);
}

async function saveAdminGenImageApiDetail() {
    let payload = null;

    try {
        const timeoutText = readAdminGenImageApiText('adminGenImageTimeoutInput');
        const timeoutValue = /^\d+$/.test(timeoutText) ? Number.parseInt(timeoutText, 10) : NaN;
        const apiId = readAdminGenImageApiText('adminGenImageApiIdInput');

        payload = {
            original_api_id: String(adminGenImageApiEditorState.originalApiId || '').trim(),
            api_id: apiId,
            name: readAdminGenImageApiText('adminGenImageNameInput') || apiId,
            api_type: readAdminGenImageApiText('adminGenImageApiTypeInput'),
            api_key: readAdminGenImageApiText('adminGenImageApiKeyInput'),
            base_url: readAdminGenImageApiText('adminGenImageBaseUrlInput'),
            model: readAdminGenImageApiText('adminGenImageModelInput'),
            size: readAdminGenImageApiText('adminGenImageSizeInput'),
            quality: readAdminGenImageApiText('adminGenImageQualityInput'),
            response_format: readAdminGenImageApiText('adminGenImageResponseFormatInput'),
            timeout: timeoutValue,
            enabled: readAdminGenImageApiChecked('adminGenImageEnabledInput'),
        };

        const validationMessage = validateAdminGenImageApiPayload(payload);

        if (validationMessage) {
            showToast(validationMessage);
            return;
        }
    } catch (err) {
        showToast(err && err.message ? err.message : '生图接口表单读取失败');
        return;
    }

    try {
        const originalApiId = String(adminGenImageApiEditorState.originalApiId || '').trim();
        const endpoint = originalApiId
            ? `/api/admin/gen-image/apis/${encodeURIComponent(originalApiId)}`
            : '/api/admin/gen-image/apis';
        const res = await fetch(endpoint, {
            method: originalApiId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || '保存失败');
            return;
        }

        adminSelectedGenImageApiId = payload.api_id;
        adminGenImageApiEditorState = { originalApiId: payload.api_id };
        applyAdminGenImageApiPayload(data);
        renderAdminGenImageApis();
        showToast('生图接口已保存');
    } catch (err) {
        showToast('保存失败: ' + (err && err.message ? err.message : '未知错误'));
    }
}

window.adminSelectGenImageApi = function(encodedApiId) {
    adminSelectedGenImageApiId = decodeURIComponent(encodedApiId || '');
    renderAdminGenImageApis();
};

window.adminEditGenImageApi = function(encodedApiId) {
    openAdminGenImageApiEditor(decodeURIComponent(encodedApiId || ''));
};

window.openAdminGenImageApiEditor = openAdminGenImageApiEditor;
window.saveAdminGenImageApiDetail = saveAdminGenImageApiDetail;

window.adminEnableGenImageApi = async function(encodedApiId) {
    const apiId = decodeURIComponent(encodedApiId || '');

    if (!apiId) return;

    try {
        const res = await fetch(`/api/admin/gen-image/apis/${encodeURIComponent(apiId)}/enabled`, {
            method: 'PUT',
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || '启用失败');
            return;
        }

        applyAdminGenImageApiPayload(data);
        adminSelectedGenImageApiId = apiId;
        renderAdminGenImageApis();
        showToast('生图接口已启用');
    } catch (err) {
        showToast('启用失败: ' + (err && err.message ? err.message : '未知错误'));
    }
};

window.adminDisableGenImageApi = async function() {
    try {
        const res = await fetch('/api/admin/gen-image/enabled-api', {
            method: 'DELETE',
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || '关闭失败');
            return;
        }

        applyAdminGenImageApiPayload(data);
        renderAdminGenImageApis();
        showToast('生图接口已关闭');
    } catch (err) {
        showToast('关闭失败: ' + (err && err.message ? err.message : '未知错误'));
    }
};

window.adminDeleteGenImageApi = async function(encodedApiId) {
    const apiId = decodeURIComponent(encodedApiId || '');

    if (!apiId) return;

    const ok = await confirmModalAsync('删除生图接口', `确定要删除接口「${apiId}」吗？`, 'danger');

    if (!ok) return;

    try {
        const res = await fetch(`/api/admin/gen-image/apis/${encodeURIComponent(apiId)}`, {
            method: 'DELETE',
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.message || '删除失败');
            return;
        }

        if (adminSelectedGenImageApiId === apiId) {
            adminSelectedGenImageApiId = '';
        }

        applyAdminGenImageApiPayload(data);
        renderAdminGenImageApis();
        showToast('生图接口已删除');
    } catch (err) {
        showToast('删除失败: ' + (err && err.message ? err.message : '未知错误'));
    }
};

async function loadAdminModelConfig() {
    const providerPaneEl = document.getElementById('adminModelProviderList');
    const modelPaneEl = document.getElementById('adminModelConfigList');
    if (!providerPaneEl || !modelPaneEl) return;
    const searchInput = document.getElementById('adminModelSearchInput');
    if (searchInput && searchInput.value !== adminModelSearchKeyword) {
        searchInput.value = adminModelSearchKeyword;
    }
    providerPaneEl.innerHTML = '<div class="admin-user-detail-empty">Loading...</div>';
    modelPaneEl.innerHTML = '<div class="admin-user-detail-empty">Loading...</div>';
    try {
        const res = await fetch('/api/admin/models/config');
        const data = await res.json();
        if (!data.success) {
            const err = `<div class="admin-user-detail-empty" style="color:#dc2626;">${escapeHtml(data.message || '加载失败')}</div>`;
            providerPaneEl.innerHTML = err;
            modelPaneEl.innerHTML = err;
            return;
        }
        adminModelConfigCache = {
            models: data.models || {},
            providers: data.providers || {}
        };
        adminOllamaModelStatusCache = {};
        adminOllamaStatusPending = new Map();
        const providerKeys = Object.keys(adminModelConfigCache.providers || {}).sort((a, b) => a.localeCompare(b));
        if (!adminSelectedProvider || !adminModelConfigCache.providers[adminSelectedProvider]) {
            adminSelectedProvider = providerKeys[0] || '';
        }
        renderAdminModelConfig();
        const ollamaProviderKeys = providerKeys.filter((providerKey) => isAdminOllamaProvider(adminModelConfigCache.providers[providerKey] || {}));
        if (ollamaProviderKeys.length) {
            void refreshAdminOllamaStatusCache(ollamaProviderKeys);
        }
    } catch (err) {
        const errHtml = `<div class="admin-user-detail-empty" style="color:#dc2626;">${escapeHtml(err.message || '加载失败')}</div>`;
        providerPaneEl.innerHTML = errHtml;
        modelPaneEl.innerHTML = errHtml;
    }
}

function renderAdminModelConfig(options = {}) {
    const resetModelsScroll = !!options.resetModelsScroll;
    const preserveProviderList = !!options.preserveProviderList;
    const providerPaneEl = document.getElementById('adminModelProviderList');
    const modelPaneEl = document.getElementById('adminModelConfigList');
    if (!providerPaneEl || !modelPaneEl) return;

    const oldProviderList = providerPaneEl.querySelector('.model-admin-pane-list[data-col="providers"]');
    const oldModelList = modelPaneEl.querySelector('.model-admin-pane-list[data-col="models"]');
    const providerScroll = Number(providerPaneEl.scrollTop || 0);
    const modelScroll = resetModelsScroll ? 0 : Number(modelPaneEl.scrollTop || 0);
    adminPanelScrollState.providers = providerScroll;
    adminPanelScrollState.models = modelScroll;

    const providers = adminModelConfigCache.providers || {};
    const models = adminModelConfigCache.models || {};
    const providerModelCountMap = {};
    Object.values(models).forEach((modelInfo) => {
        const providerKey = String((modelInfo && modelInfo.provider) || '').trim();
        if (!providerKey) return;
        providerModelCountMap[providerKey] = (providerModelCountMap[providerKey] || 0) + 1;
    });
    const allProviderEntries = Object.entries(providers).sort((a, b) => {
        const countDiff = (providerModelCountMap[b[0]] || 0) - (providerModelCountMap[a[0]] || 0);
        if (countDiff !== 0) return countDiff;
        return a[0].localeCompare(b[0]);
    });
    const query = String(adminModelSearchKeyword || '').trim().toLowerCase();

    const providerMatches = (providerKey, providerInfo) => {
        if (!query) return true;
        const baseUrl = (providerInfo && providerInfo.base_url) ? String(providerInfo.base_url) : '';
        const apiType = normalizeAdminApiType(providerInfo && providerInfo.api_type ? providerInfo.api_type : 'openai');
        return providerKey.toLowerCase().includes(query) || baseUrl.toLowerCase().includes(query) || apiType.includes(query);
    };
    const modelMatches = (modelId, modelInfo) => {
        if (!query) return true;
        const provider = (modelInfo && modelInfo.provider) ? String(modelInfo.provider) : '';
        const name = (modelInfo && modelInfo.name) ? String(modelInfo.name) : '';
        const status = (modelInfo && modelInfo.status) ? String(modelInfo.status) : '';
        return (
            modelId.toLowerCase().includes(query) ||
            name.toLowerCase().includes(query) ||
            status.toLowerCase().includes(query) ||
            provider.toLowerCase().includes(query)
        );
    };

    const providerEntries = allProviderEntries.filter(([providerKey, providerInfo]) => {
        if (providerMatches(providerKey, providerInfo)) return true;
        return Object.entries(models).some(([modelId, modelInfo]) => {
            const provider = (modelInfo && modelInfo.provider) ? String(modelInfo.provider) : '';
            return provider === providerKey && modelMatches(modelId, modelInfo);
        });
    });

    if (!providerEntries.some(([providerKey]) => providerKey === adminSelectedProvider)) {
        adminSelectedProvider = providerEntries[0] ? providerEntries[0][0] : '';
    }

    const selectedProviderInfo = providers[adminSelectedProvider] || {};
    const selectedProviderMatch = providerMatches(adminSelectedProvider, selectedProviderInfo);
    const modelEntries = Object.entries(models)
        .filter(([, info]) => !adminSelectedProvider || ((info && info.provider) || '') === adminSelectedProvider)
        .filter(([modelId, modelInfo]) => {
            if (!query) return true;
            if (selectedProviderMatch) return true;
            return modelMatches(modelId, modelInfo);
        })
        .sort((a, b) => a[0].localeCompare(b[0]));

    const providerQuotaActionOptionsHtml = (providerName, fallbackAction = 'disable_model') => {
        const resolved = resolveAdminProviderOverageAction(providerName, fallbackAction);
        return [
            ['no_op', '无操作'],
            ['disable_model', '停用模型'],
            ['notify_admin', '发送通知'],
            ['disable_and_notify', '停用并发送通知'],
        ].map(([value, label]) => {
            const selected = resolved === value ? ' selected' : '';
            return `<option value="${value}"${selected}>${label}</option>`;
        }).join('');
    };

    const providersHtml = providerEntries.length ? providerEntries.map(([key, info]) => {
        const iconProvider = resolveAdminProviderIconProvider(key, info);
        const providerActionSelect = providerQuotaActionOptionsHtml(key, (info && info.on_exhausted) || adminQuotaDefaultOverageAction);
        return `
        <div class="admin-user-item model-provider-item ${key === adminSelectedProvider ? 'active' : ''}" data-role="model-provider-item" data-provider-key="${escapeHtml(key)}" onclick="adminSelectProviderByEncoded('${encodeAdminInlineArg(key)}')">
            ${renderProviderIconHtml(iconProvider, { className: 'model-provider-avatar', label: key })}
            <div>
                <div class="admin-user-name">${escapeHtml(key)}</div>
                <div class="admin-user-meta">api_type: ${escapeHtml(normalizeAdminApiType(info && info.api_type ? info.api_type : 'openai'))}</div>
                <div class="model-provider-quota-row" onclick="event.stopPropagation();">
                    <label class="model-provider-quota-label">超额策略</label>
                    <select class="input-modern model-provider-overage-select" data-provider="${escapeHtml(key)}">
                        ${providerActionSelect}
                    </select>
                </div>
            </div>
            <div class="model-admin-item-actions model-provider-item-actions">
                <button class="model-icon-btn" title="编辑供应商" onclick="event.stopPropagation(); adminEditProviderByEncoded('${encodeAdminInlineArg(key)}')"><i class="fa-solid fa-pen"></i></button>
                <button class="model-icon-btn model-icon-btn-danger" title="删除供应商" onclick="event.stopPropagation(); adminDeleteProviderByEncoded('${encodeAdminInlineArg(key)}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `;
    }).join('') : '<div class="admin-user-detail-empty">无供应商</div>';

    const modelQuotaMap = (() => {
        const out = {};
        const rows = Array.isArray(adminServerQuotaProvidersCache) ? adminServerQuotaProvidersCache : [];
        rows.forEach((providerRow) => {
            const providerName = String((providerRow && providerRow.name) || '').trim();
            const modelsArr = Array.isArray(providerRow && providerRow.models) ? providerRow.models : [];
            modelsArr.forEach((m) => {
                const modelName = String((m && m.name) || '').trim();
                if (!providerName || !modelName) return;
                out[`${providerName}::${modelName}`.toLowerCase()] = m;
            });
        });
        return out;
    })();

    const bindModelQuotaEditButtons = (scopeEl) => {
        if (!scopeEl || typeof scopeEl.querySelectorAll !== 'function') return;
        scopeEl.querySelectorAll('.model-admin-item-meter-wrap').forEach((wrapEl) => {
            wrapEl.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const popover = document.getElementById('quotaAdjustPopover');
                const isOpen = !!popover && popover.style.display !== 'none';
                if (isOpen && _quotaAdjustPopoverAnchorEl === wrapEl) {
                    _closeQuotaAdjustPopover();
                    return;
                }
                const provider = String(wrapEl.dataset.provider || '').trim();
                const model = String(wrapEl.dataset.model || '').trim();
                const total = Math.max(0, parseInt(wrapEl.dataset.totalTokens || 0, 10) || 0);
                const used = Math.max(0, parseInt(wrapEl.dataset.usedTokens || 0, 10) || 0);
                if (!provider || !model) return;
                _openQuotaAdjustPopover(wrapEl, provider, model, total, used);
            });
        });
    };

    const modelsHtml = modelEntries.length ? modelEntries.map(([id, info]) => {
        const providerKey = (info && info.provider) || '';
        const providerInfo = providers[providerKey] || {};
        const iconProvider = resolveAdminModelIconProvider(id, providerKey, providerInfo);
        const quotaRow = modelQuotaMap[`${providerKey}::${id}`.toLowerCase()] || null;
        const modelUsedTokens = Math.max(0, parseInt((quotaRow && quotaRow.tokens) || 0, 10) || 0);
        const modelTotalTokens = Math.max(0, parseInt((quotaRow && quotaRow.quota_total_tokens) || 0, 10) || 0);
        const modelOverageTokens = Math.max(0, parseInt((quotaRow && quotaRow.overage_tokens) || 0, 10) || 0);
        const meterHtml = _buildQuotaReverseOverflowMeterHtml(modelUsedTokens, modelTotalTokens, modelOverageTokens, Math.max(0, modelOverageTokens));
        const contextWindow = getAdminModelContextWindow(info);
        const contextWindowHtml = contextWindow > 0
            ? `<div class="admin-user-meta">上下文 ${escapeHtml(formatAdminContextWindow(contextWindow))}</div>`
            : '';
        return `
        <div class="model-admin-item">
            <div class="model-admin-model-icon-cell">
                ${renderProviderIconHtml(iconProvider, { className: 'model-admin-model-icon', label: (info && info.name) || id })}
            </div>
            <div class="model-admin-item-main">
                <div class="model-admin-item-name-row">
                    <div class="model-admin-item-name-main">
                        ${renderAdminOllamaStatusButton(providerKey, id, providerInfo)}
                        <div class="model-admin-item-name">${escapeHtml(id)} (${escapeHtml((info && info.name) || id)})</div>
                    </div>
                    <div class="model-admin-item-actions">
                        <button class="model-icon-btn" title="修改模型" onclick="adminEditModelByEncoded('${encodeAdminInlineArg(id)}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="model-icon-btn model-icon-btn-danger" title="Delete Model" onclick="adminDeleteModelByEncoded('${encodeAdminInlineArg(id)}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                ${contextWindowHtml}
                <div class="model-admin-item-meter-wrap" data-provider="${escapeHtml(providerKey)}" data-model="${escapeHtml(id)}" data-total-tokens="${modelTotalTokens}" data-used-tokens="${modelUsedTokens}" title="点击编辑额度">
                    <div class="model-admin-item-meter">${meterHtml}</div>
                </div>
            </div>
        </div>
    `;
    }).join('') : `<div class="admin-user-detail-empty">${adminSelectedProvider ? '该供应商无模型' : '无模型'}</div>`;

    const existingProviderList = providerPaneEl.querySelector('.model-admin-pane-list[data-col="providers"]');
    const existingModelList = modelPaneEl.querySelector('.model-admin-pane-list[data-col="models"]');

    if (preserveProviderList && existingProviderList && existingModelList) {
        existingProviderList.querySelectorAll('[data-role="model-provider-item"]').forEach((item) => {
            const key = String(item.dataset.providerKey || '');
            const isActive = key === adminSelectedProvider;
            item.classList.toggle('active', isActive);
        });
        existingModelList.innerHTML = modelsHtml;
        bindModelQuotaEditButtons(existingModelList);
        _layoutQuotaMeterLabels(existingModelList);
        requestAnimationFrame(() => {
            modelPaneEl.scrollTop = modelScroll;
        });
        return;
    }

    providerPaneEl.innerHTML = `
        <div class="model-admin-pane-list model-admin-provider-pane-list" data-col="providers">
            ${providersHtml}
        </div>
    `;

    modelPaneEl.innerHTML = `
        <div class="model-admin-pane-list" data-col="models">
            ${modelsHtml}
        </div>
    `;

    providerPaneEl.querySelectorAll('.model-provider-overage-select').forEach((selectEl) => {
        selectEl.addEventListener('click', (ev) => ev.stopPropagation());
        selectEl.addEventListener('change', async (e) => {
            const target = e && e.target ? e.target : selectEl;
            const provider = normalizeAdminProviderKey(target && target.dataset ? target.dataset.provider : '');
            if (!provider) return;
            const requested = normalizeAdminQuotaOnExhaustedAction(target.value || 'disable_model');
            target.disabled = true;
            try {
                const result = await saveAdminProviderOverageActionSetting(provider, requested);
                target.value = normalizeAdminQuotaOnExhaustedAction((result && result.action) || requested);
            } finally {
                target.disabled = false;
            }
        });
    });

    bindModelQuotaEditButtons(modelPaneEl);
    _layoutQuotaMeterLabels(modelPaneEl);

    requestAnimationFrame(() => {
        providerPaneEl.scrollTop = providerScroll;
        modelPaneEl.scrollTop = modelScroll;
    });
}

window.adminSelectProviderByEncoded = function(encoded) {
    const next = decodeURIComponent(encoded || '');
    if (next === adminSelectedProvider) return;
    adminSelectedProvider = next;
    renderAdminModelConfig({ resetModelsScroll: true, preserveProviderList: true });
};

function openAdminConfigModal(mode, payload = {}) {
    const modal = document.getElementById('adminConfigModal');
    const title = document.getElementById('adminConfigModalTitle');
    const providerFields = document.getElementById('adminConfigProviderFields');
    const modelFields = document.getElementById('adminConfigModelFields');
    if (!modal || !title || !providerFields || !modelFields) return;

    initAdminSystemCustomControls();

    const modalTitle = mode === 'provider'
        ? (payload.provider || payload.originalKey || '新建供应商')
        : (payload.name || payload.model_id || payload.originalKey || '新建模型');

    adminConfigState = {
        mode,
        originalKey: payload.originalKey || ''
    };

    if (mode === 'provider') {
        title.textContent = String(modalTitle).trim() || '未命名';
        providerFields.style.display = '';
        modelFields.style.display = 'none';
        document.getElementById('adminProviderNameInput').value = payload.provider || '';
        document.getElementById('adminProviderApiKeyInput').value = payload.api_key || '';
        document.getElementById('adminProviderBaseUrlInput').value = payload.base_url || '';
        setAdminSystemCustomSelectValue('adminProviderApiTypeInput', normalizeAdminApiType(payload.api_type || 'openai'));
        document.getElementById('adminProviderUserAgentInput').value = payload.user_agent || '';
        document.getElementById('adminProviderKeepAliveInput').value = payload.keep_alive || '5m';
        syncAdminProviderApiTypeFields();
    } else {
        title.textContent = String(modalTitle).trim() || '未命名';
        providerFields.style.display = 'none';
        modelFields.style.display = '';
        document.getElementById('adminModelIdInput').value = payload.model_id || '';
        document.getElementById('adminModelNameInput').value = payload.name || '';
        document.getElementById('adminModelContextWindowInput').value = getAdminModelContextWindow(payload) || '';
        document.getElementById('adminModelStatusInput').value = payload.status || 'normal';

        const providerSelect = document.getElementById('adminModelProviderInput');
        const providers = Object.keys(adminModelConfigCache.providers || {}).sort((a, b) => a.localeCompare(b));
        providerSelect.innerHTML = providers.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
        providerSelect.value = payload.provider || adminSelectedProvider || providers[0] || '';
    }

    modal.classList.add('active');
}

function syncAdminProviderApiTypeFields() {
    const apiTypeInput = document.getElementById('adminProviderApiTypeInput');
    const ollamaSettings = document.getElementById('adminProviderOllamaSettings');
    if (!apiTypeInput || !ollamaSettings) return;
    const apiType = normalizeAdminApiType(apiTypeInput.value || 'openai');
    ollamaSettings.style.display = apiType === 'ollama' ? '' : 'none';
}

window.closeAdminConfigModal = function() {
    const modal = document.getElementById('adminConfigModal');
    closeAdminSystemSelects();
    if (modal) modal.classList.remove('active');
    adminConfigState = { mode: '', originalKey: '' };
};

async function saveAdminConfigModal() {
    try {
        if (adminConfigState.mode === 'provider') {
            const provider = (document.getElementById('adminProviderNameInput').value || '').trim();
            const apiKey = document.getElementById('adminProviderApiKeyInput').value || '';
            const baseUrl = document.getElementById('adminProviderBaseUrlInput').value || '';
            const apiType = normalizeAdminApiType(document.getElementById('adminProviderApiTypeInput').value || 'openai');
            const userAgent = (document.getElementById('adminProviderUserAgentInput').value || '').trim();
            const keepAlive = (document.getElementById('adminProviderKeepAliveInput').value || '').trim() || '5m';
            if (!provider) {
                showToast('供应商名称是必填项');
                return;
            }
            const originalProvider = (adminConfigState.originalKey || '').trim();
            const providerEndpoint = originalProvider
                ? `/api/admin/models/providers/${encodeURIComponent(originalProvider)}`
                : '/api/admin/models/providers';
            const res = await fetch(providerEndpoint, {
                method: originalProvider ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_provider: originalProvider,
                    provider,
                    api_key: apiKey,
                    base_url: baseUrl,
                    api_type: apiType,
                    user_agent: userAgent,
                    settings: apiType === 'ollama' ? { keep_alive: keepAlive } : {}
                })
            });
            const data = await res.json();
            if (!data.success) {
                showToast('Save failed: ' + (data.message || 'Unknown error'));
                return;
            }
            adminSelectedProvider = provider;
            closeAdminConfigModal();
            await loadAdminModelConfig();
            return;
        }

        if (adminConfigState.mode === 'model') {
            const modelId = (document.getElementById('adminModelIdInput').value || '').trim();
            const modelName = (document.getElementById('adminModelNameInput').value || '').trim();
            const provider = (document.getElementById('adminModelProviderInput').value || '').trim();
            const contextWindow = (document.getElementById('adminModelContextWindowInput').value || '').trim();
            const status = (document.getElementById('adminModelStatusInput').value || 'normal').trim();
            if (!modelId || !provider) {
                showToast('模型ID和供应商是必填项');
                return;
            }
            const originalModelId = (adminConfigState.originalKey || '').trim();
            const modelEndpoint = originalModelId ? '/api/admin/models/model/upsert' : '/api/admin/models';
            const res = await fetch(modelEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_model_id: originalModelId,
                    model_id: modelId,
                    name: modelName || modelId,
                    provider,
                    context_window: contextWindow,
                    status: status || 'normal'
                })
            });
            const data = await readAdminJsonResponse(res, '模型保存失败');
            if (!data.success) {
                showToast('保存失败: ' + (data.message || '未知错误'));
                return;
            }
            adminSelectedProvider = provider;
            closeAdminConfigModal();
            await loadAdminModelConfig();
        }
    } catch (err) {
        showToast('保存失败: ' + (err.message || '未知错误'));
    }
}

function closeAdminOllamaModelStatusModal() {
    const modal = document.getElementById('ollamaModelStatusModal');
    if (modal) modal.classList.remove('active');
    adminOllamaStatusModalState = { provider: '', model: '', status: null, loading: false };
}

function renderAdminOllamaStatusModal(statusData) {
    const providerEl = document.getElementById('ollamaModelStatusProvider');
    const modelEl = document.getElementById('ollamaModelStatusModel');
    const statusEl = document.getElementById('ollamaModelStatusState');
    const detailEl = document.getElementById('ollamaModelStatusDetail');
    const actionBtn = document.getElementById('ollamaModelStatusActionBtn');
    const refreshBtn = document.getElementById('ollamaModelStatusRefreshBtn');
    if (!providerEl || !modelEl || !statusEl || !detailEl || !actionBtn || !refreshBtn) return;

    adminOllamaStatusModalState.status = statusData || null;
    const provider = adminOllamaStatusModalState.provider || '-';
    const model = adminOllamaStatusModalState.model || '-';
    providerEl.textContent = provider;
    modelEl.textContent = model;

    if (!statusData) {
        statusEl.textContent = '加载中';
        detailEl.innerHTML = '<div class="ollama-status-empty">正在加载状态...</div>';
        actionBtn.disabled = true;
        actionBtn.textContent = '处理中';
        refreshBtn.disabled = true;
        return;
    }

    const status = String(statusData.status || '').trim().toLowerCase();
    const label = formatAdminOllamaStatusLabel(statusData);
    statusEl.textContent = label;
    detailEl.innerHTML = renderAdminOllamaStatusDetail(statusData);

    const canToggle = status !== 'missing' && status !== 'error';
    actionBtn.disabled = !canToggle || !!adminOllamaStatusModalState.loading;
    actionBtn.textContent = statusData.running ? 'Unload' : 'Load';
    actionBtn.dataset.action = statusData.running ? 'unload' : 'load';
    refreshBtn.disabled = !!adminOllamaStatusModalState.loading;
}

async function loadAdminOllamaModelStatus(providerKey, modelId) {
    const key = normalizeAdminProviderKey(providerKey);
    const modelKey = String(modelId || '').trim();
    if (!key || !modelKey) return null;
    adminOllamaStatusModalState = { provider: key, model: modelKey, status: null, loading: true };
    renderAdminOllamaStatusModal(null);
    try {
        const providerCache = await loadAdminOllamaStatusForProvider(key);
        if (providerCache && providerCache.error && !providerCache.loaded) {
            throw new Error(providerCache.error);
        }
        const current = getAdminOllamaModelStatus(key, modelKey) || {
            ok: true,
            provider: key,
            api_type: 'ollama',
            model: modelKey,
            installed: false,
            running: false,
            status: 'missing',
            status_label: '未安装',
            status_level: 'danger',
            keep_alive: getAdminProviderKeepAlive(adminModelConfigCache.providers[key] || {}),
            message: '模型未安装或未出现在 Ollama 列表中',
            ps: null,
            tag: null
        };
        adminOllamaStatusModalState.loading = false;
        renderAdminOllamaStatusModal(current);
        return current;
    } catch (err) {
        const errorData = {
            success: false,
            provider: key,
            model: modelKey,
            status: 'error',
            status_label: '错误',
            status_level: 'danger',
            message: err && err.message ? err.message : '加载失败',
            installed: false,
            running: false,
            keep_alive: '5m'
        };
        const providerCache = adminOllamaModelStatusCache[key] || { byModelId: {}, raw: null, error: '' };
        providerCache.error = errorData.message;
        adminOllamaModelStatusCache[key] = providerCache;
        adminOllamaStatusModalState.loading = false;
        renderAdminOllamaStatusModal(errorData);
        return errorData;
    }
}

async function toggleAdminOllamaModelStatus() {
    const state = adminOllamaStatusModalState || {};
    if (!state.provider || !state.model) return;
    const actionBtn = document.getElementById('ollamaModelStatusActionBtn');
    if (actionBtn) actionBtn.disabled = true;
    adminOllamaStatusModalState.loading = true;
    renderAdminOllamaStatusModal(state.status || null);
    try {
        const current = state.status || {};
        const action = String(actionBtn && actionBtn.dataset && actionBtn.dataset.action ? actionBtn.dataset.action : (current.running ? 'unload' : 'load')).trim().toLowerCase() || 'toggle';
        const keepAlive = current.keep_alive || '5m';
        const res = await fetch('/api/admin/models/ollama/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: state.provider,
                model_id: state.model,
                action,
                keep_alive: keepAlive
            })
        });
        const data = await res.json();
        if (!data.success && !data.status) {
            throw new Error(data.message || '切换失败');
        }
        const providerCache = adminOllamaModelStatusCache[state.provider] || { byModelId: {}, raw: null, error: '' };
        providerCache.byModelId = providerCache.byModelId || {};
        providerCache.byModelId[String(state.model || '').trim().toLowerCase()] = data;
        providerCache.raw = providerCache.raw || data;
        providerCache.error = '';
        providerCache.loaded = true;
        providerCache.loadedAt = Date.now();
        adminOllamaModelStatusCache[state.provider] = providerCache;
        adminOllamaStatusModalState.loading = false;
        renderAdminOllamaStatusModal(data);
        await loadAdminModelConfig();
    } catch (err) {
        adminOllamaStatusModalState.loading = false;
        showToast('操作失败: ' + (err.message || '未知错误'));
        await loadAdminOllamaModelStatus(state.provider, state.model);
    }
}

window.openAdminOllamaModelStatusByEncoded = async function(encodedProvider, encodedModel) {
    const provider = decodeURIComponent(encodedProvider || '');
    const model = decodeURIComponent(encodedModel || '');
    const modal = document.getElementById('ollamaModelStatusModal');
    if (!modal) return;
    modal.classList.add('active');
    await loadAdminOllamaModelStatus(provider, model);
};

window.closeAdminOllamaModelStatusModal = closeAdminOllamaModelStatusModal;

async function openProviderEditor(providerName = '') {
    const providers = adminModelConfigCache.providers || {};
    const current = providerName ? (providers[providerName] || {}) : {};
    openAdminConfigModal('provider', {
        originalKey: providerName || '',
        provider: providerName || '',
        api_key: current.api_key || '',
        base_url: current.base_url || '',
        api_type: current.api_type || 'openai',
        user_agent: current.user_agent || '',
        keep_alive: getAdminProviderKeepAlive(current)
    });
}

async function openModelEditor(modelId = '') {
    const models = adminModelConfigCache.models || {};
    const current = modelId ? (models[modelId] || {}) : {};
    openAdminConfigModal('model', {
        originalKey: modelId || '',
        model_id: modelId || '',
        name: current.name || '',
        provider: current.provider || adminSelectedProvider || '',
        context_window: getAdminModelContextWindow(current) || '',
        status: current.status || 'normal'
    });
}

window.adminEditProvider = function(provider) {
    openProviderEditor(provider);
};

window.adminEditModel = function(modelId) {
    openModelEditor(modelId);
};

window.adminEditProviderByEncoded = function(encoded) {
    openProviderEditor(decodeURIComponent(encoded || ''));
};

window.adminDeleteProviderByEncoded = function(encoded) {
    window.adminDeleteProvider(decodeURIComponent(encoded || ''));
};

window.adminEditModelByEncoded = function(encoded) {
    openModelEditor(decodeURIComponent(encoded || ''));
};

window.adminDeleteModelByEncoded = function(encoded) {
    window.adminDeleteModel(decodeURIComponent(encoded || ''));
};

window.adminDeleteProvider = function(provider) {
    showAdminTextConfirmModal(async (confirmText) => {
        const res = await fetch(`/api/admin/models/providers/${encodeURIComponent(provider)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm_text: confirmText })
        });
        const data = await res.json();
        if (!data.success) {
            showToast('删除失败: ' + (data.message || '未知错误'));
            return;
        }
        showToast('供应商已删除');
        await loadAdminModelConfig();
    });
};

window.adminDeleteModel = function(modelId) {
    showAdminTextConfirmModal(async (confirmText) => {
        const res = await fetch('/api/admin/models/model/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_id: modelId,
                confirm_text: confirmText
            })
        });
        const data = await readAdminJsonResponse(res, '模型删除失败');
        if (!data.success) {
            showToast('删除失败: ' + (data.message || '未知错误'));
            return;
        }
        showToast('模型已删除');
        await loadAdminModelConfig();
    });
};

// 加载统计信息

// ChromaDB stats
async function loadAdminChromaStats() {
    try {
        const res = await fetch('/api/admin/chroma/stats');
        const data = await res.json();
        const statusEl = document.getElementById('statChromaStatus');
        const totalEl = document.getElementById('statChromaTotal');
        const listEl = document.getElementById('adminChromaList');

        if (!statusEl || !totalEl || !listEl) return;

        if (!data.success) {
            statusEl.textContent = 'error';
            totalEl.textContent = '-';
            listEl.innerHTML = `<tr><td colspan="2">${data.message || 'Failed to load'}</td></tr>`;
            return;
        }

        if (!data.enabled) {
            statusEl.textContent = 'disabled';
            totalEl.textContent = '0';
            listEl.innerHTML = `<tr><td colspan="2">ChromaDB disabled</td></tr>`;
            return;
        }

        statusEl.textContent = data.mode || 'service';
        totalEl.textContent = (data.total_vectors || 0).toLocaleString();

        const rows = (data.collections || []).map(c => {
            return `<tr><td>${c.name}</td><td class="mono">${(c.count || 0).toLocaleString()}</td></tr>`;
        }).join('');
        listEl.innerHTML = rows || '<tr><td colspan="2">无联系</td></tr>';
    } catch (err) {
        console.error('Failed to load chroma stats:', err);
    }
}

function initAdminUserTokenStatsControls() {
    const queryBtn = document.getElementById('adminUserTokenStatsQueryBtn');
    const usernameInput = document.getElementById('adminUserTokenStatsUsernameInput');
    const rangeSelect = document.getElementById('adminUserTokenStatsRangeSelect');
    const selectorEl = document.getElementById('adminUserTokenStatsUserSelector');
    const menuEl = document.getElementById('adminUserTokenStatsUserMenu');

    if (queryBtn && queryBtn.dataset.bound !== '1') {
        queryBtn.dataset.bound = '1';
        queryBtn.addEventListener('click', () => {
            hideAdminUserTokenUserMenu();
            void queryAdminUserTokenStats();
        });
    }

    if (usernameInput && usernameInput.dataset.bound !== '1') {
        usernameInput.dataset.bound = '1';
        usernameInput.addEventListener('focus', () => {
            showAdminUserTokenUserMenuOnFocus();
        });
        usernameInput.addEventListener('input', () => {
            showAdminUserTokenUserMenu();
        });
        usernameInput.addEventListener('keydown', (event) => {
            const hasMenuRows = adminUserTokenSelectorState.visible && adminUserTokenSelectorState.filteredUsers.length > 0;

            if (hasMenuRows && event.key === 'ArrowDown') {
                event.preventDefault();
                adminUserTokenSelectorState.activeIndex = (adminUserTokenSelectorState.activeIndex + 1) % adminUserTokenSelectorState.filteredUsers.length;
                renderAdminUserTokenUserMenu();
                scrollAdminUserTokenActiveItemIntoView();
                return;
            }

            if (hasMenuRows && event.key === 'ArrowUp') {
                event.preventDefault();
                adminUserTokenSelectorState.activeIndex = (adminUserTokenSelectorState.activeIndex - 1 + adminUserTokenSelectorState.filteredUsers.length) % adminUserTokenSelectorState.filteredUsers.length;
                renderAdminUserTokenUserMenu();
                scrollAdminUserTokenActiveItemIntoView();
                return;
            }

            if (adminUserTokenSelectorState.visible && event.key === 'Escape') {
                event.preventDefault();
                hideAdminUserTokenUserMenu();
                return;
            }

            if (hasMenuRows && event.key === 'Enter') {
                const selected = adminUserTokenSelectorState.filteredUsers[adminUserTokenSelectorState.activeIndex];

                if (selected) {
                    event.preventDefault();
                    selectAdminUserTokenUser(selected);
                    return;
                }
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                hideAdminUserTokenUserMenu();
                void queryAdminUserTokenStats();
            }
        });
    }

    const clearBtn = document.getElementById('adminUserTokenStatsClearBtn');
    if (clearBtn && clearBtn.dataset.bound !== '1') {
        clearBtn.dataset.bound = '1';
        // mousedown 阻止默认行为，避免输入框失焦
        clearBtn.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });
        clearBtn.addEventListener('click', () => {
            if (usernameInput) usernameInput.value = '';
            adminUserTokenSelectorState.activeIndex = 0;
            hideAdminUserTokenUserMenu();
        });
    }

    if (menuEl && menuEl.dataset.bound !== '1') {
        menuEl.dataset.bound = '1';
        menuEl.addEventListener('mousedown', (event) => {
            const target = event.target;

            if (!(target instanceof Element)) return;

            const item = target.closest('[data-admin-user-token-index]');

            if (!item) return;

            event.preventDefault();
            const index = Number(item.getAttribute('data-admin-user-token-index') || 0);
            const user = adminUserTokenSelectorState.filteredUsers[index];

            if (user) {
                selectAdminUserTokenUser(user);
            }
        });
    }

    if (selectorEl && selectorEl.dataset.documentBound !== '1') {
        selectorEl.dataset.documentBound = '1';
        document.addEventListener('mousedown', (event) => {
            const target = event.target;

            if (!(target instanceof Node)) return;

            if (!selectorEl.contains(target)) {
                hideAdminUserTokenUserMenu();
            }
        });
    }

    if (rangeSelect && rangeSelect.dataset.bound !== '1') {
        rangeSelect.dataset.bound = '1';
        rangeSelect.addEventListener('change', () => {
            const username = String(usernameInput?.value || '').trim();

            if (username) {
                void queryAdminUserTokenStats();
            }
        });
    }
}

function getAdminUserTokenUserId(user) {
    if (!user || typeof user !== 'object') return '';

    return String(user.user_id || user.username || '').trim();
}

function getAdminUserTokenDisplayName(user) {
    if (!user || typeof user !== 'object') return '';

    return String(user.username || user.display_name || user.nickname || getAdminUserTokenUserId(user)).trim();
}

function getAdminUserTokenAvatarUrl(user) {
    const userId = getAdminUserTokenUserId(user);
    const displayName = getAdminUserTokenDisplayName(user);

    return String(user?.avatar_url || '').trim() || getDefaultAvatarDataUrl(displayName || userId || 'U');
}

function getAdminUserTokenSearchText(user) {
    return [
        getAdminUserTokenUserId(user),
        getAdminUserTokenDisplayName(user),
        String(user?.role || '').trim(),
    ].join(' ').toLowerCase();
}

function updateAdminUserTokenUserSelector(users) {
    const seen = new Set();
    const nextUsers = [];

    if (Array.isArray(users)) {
        users.forEach((user) => {
            const userId = getAdminUserTokenUserId(user);

            if (!userId || seen.has(userId)) return;

            seen.add(userId);
            nextUsers.push(user);
        });
    }

    adminUserTokenSelectorState.users = nextUsers;

    if (adminUserTokenSelectorState.visible) {
        showAdminUserTokenUserMenu();
    }
}

function getAdminUserTokenFilteredUsers() {
    const inputEl = document.getElementById('adminUserTokenStatsUsernameInput');
    const query = String(inputEl?.value || '').trim().toLowerCase();
    const users = adminUserTokenSelectorState.users;

    if (!query) return users.slice(0, 8);

    return users.filter((user) => getAdminUserTokenSearchText(user).includes(query)).slice(0, 8);
}

function showAdminUserTokenUserMenu() {
    adminUserTokenSelectorState.filteredUsers = getAdminUserTokenFilteredUsers();
    adminUserTokenSelectorState.activeIndex = 0;
    adminUserTokenSelectorState.visible = true;
    renderAdminUserTokenUserMenu();
}

// 聚焦时的菜单展示：若输入框已填入某个已选用户，则不按该值筛选，
// 而是展示全部用户并滚动定位到该用户，方便直接换选其他用户（无需先清空）
function showAdminUserTokenUserMenuOnFocus() {
    const inputEl = document.getElementById('adminUserTokenStatsUsernameInput');
    const query = String(inputEl?.value || '').trim().toLowerCase();
    const users = adminUserTokenSelectorState.users;
    const selectedIndex = users.findIndex((user) => getAdminUserTokenUserId(user).toLowerCase() === query);

    if (selectedIndex >= 0) {
        adminUserTokenSelectorState.filteredUsers = users;
        adminUserTokenSelectorState.activeIndex = selectedIndex;
        adminUserTokenSelectorState.visible = true;
        renderAdminUserTokenUserMenu();
        scrollAdminUserTokenActiveItemIntoView();
        return;
    }

    showAdminUserTokenUserMenu();
}

function scrollAdminUserTokenActiveItemIntoView() {
    const menuEl = document.getElementById('adminUserTokenStatsUserMenu');

    if (!menuEl) return;

    const activeItem = menuEl.querySelector('.admin-user-token-item.is-active');

    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
        activeItem.scrollIntoView({ block: 'nearest' });
    }
}

function hideAdminUserTokenUserMenu() {
    adminUserTokenSelectorState.visible = false;
    renderAdminUserTokenUserMenu();
}

function selectAdminUserTokenUser(user) {
    const inputEl = document.getElementById('adminUserTokenStatsUsernameInput');
    const userId = getAdminUserTokenUserId(user);

    if (!inputEl || !userId) return;

    inputEl.value = userId;
    hideAdminUserTokenUserMenu();
    inputEl.focus();
}

function renderAdminUserTokenUserMenu() {
    const inputEl = document.getElementById('adminUserTokenStatsUsernameInput');
    const menuEl = document.getElementById('adminUserTokenStatsUserMenu');

    if (!inputEl || !menuEl) return;

    const rows = adminUserTokenSelectorState.filteredUsers;

    if (!adminUserTokenSelectorState.visible) {
        inputEl.setAttribute('aria-expanded', 'false');
        menuEl.hidden = true;
        menuEl.style.display = 'none';
        menuEl.innerHTML = '';
        return;
    }

    inputEl.setAttribute('aria-expanded', 'true');
    menuEl.hidden = false;
    menuEl.style.display = 'grid';

    if (!rows.length) {
        menuEl.innerHTML = '<div class="admin-user-token-empty">没有匹配的用户</div>';
        return;
    }

    menuEl.innerHTML = rows.map((user, index) => {
        const userId = getAdminUserTokenUserId(user);
        const displayName = getAdminUserTokenDisplayName(user) || userId || 'User';
        const avatarUrl = getAdminUserTokenAvatarUrl(user);
        const role = String(user?.role || 'member').trim();
        const active = index === adminUserTokenSelectorState.activeIndex ? ' is-active' : '';

        return `
            <button type="button" class="learning-feed-mention-item admin-user-token-item${active}" role="option" aria-selected="${active ? 'true' : 'false'}" data-admin-user-token-index="${index}">
                <img class="learning-feed-mention-avatar learning-feed-mention-avatar-image admin-user-token-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">
                <span class="learning-feed-mention-meta admin-user-token-meta">
                    <span class="learning-feed-mention-name">${escapeHtml(displayName)}</span>
                    <span class="learning-feed-mention-handle">@${escapeHtml(userId)} · ${escapeHtml(role)}</span>
                </span>
            </button>
        `;
    }).join('');
}

function resetAdminUserTokenStatsResult(message = '暂无查询结果') {
    const meta = document.getElementById('adminUserTokenStatsMeta');
    const requestsEl = document.getElementById('adminUserTokenRequests');
    const inputEl = document.getElementById('adminUserTokenInput');
    const outputEl = document.getElementById('adminUserTokenOutput');
    const totalEl = document.getElementById('adminUserTokenTotal');
    const topEl = document.getElementById('adminUserTokenStatsTop');
    const recentEl = document.getElementById('adminUserTokenRecentRows');

    if (meta) meta.textContent = message;
    if (requestsEl) requestsEl.textContent = '-';
    if (inputEl) inputEl.textContent = '-';
    if (outputEl) outputEl.textContent = '-';
    if (totalEl) totalEl.textContent = '-';
    if (topEl) topEl.innerHTML = '';
    if (recentEl) recentEl.innerHTML = `<tr><td colspan="4">${escapeHtml(message)}</td></tr>`;
}

function renderAdminUserTokenStats(data) {
    const meta = document.getElementById('adminUserTokenStatsMeta');
    const requestsEl = document.getElementById('adminUserTokenRequests');
    const inputEl = document.getElementById('adminUserTokenInput');
    const outputEl = document.getElementById('adminUserTokenOutput');
    const totalEl = document.getElementById('adminUserTokenTotal');
    const topEl = document.getElementById('adminUserTokenStatsTop');
    const recentEl = document.getElementById('adminUserTokenRecentRows');
    const summary = data?.summary || {};
    const displayName = String(data?.display_name || data?.username || '').trim();
    const range = String(data?.range || '').trim();

    if (meta) {
        meta.textContent = `${displayName || '-'} · ${range || '30d'} · 命中 ${Number(data?.matched_logs || 0).toLocaleString()} / ${Number(data?.total_logs || 0).toLocaleString()}`;
    }

    if (requestsEl) requestsEl.textContent = Number(summary.papi_total_tokens || 0).toLocaleString();
    if (inputEl) inputEl.textContent = Number(summary.input_tokens || 0).toLocaleString();
    if (outputEl) outputEl.textContent = Number(summary.output_tokens || 0).toLocaleString();
    if (totalEl) totalEl.textContent = Number(summary.total_tokens || 0).toLocaleString();

    if (topEl) {
        const providers = Array.isArray(data?.top_providers) ? data.top_providers.slice(0, 5) : [];
        const models = Array.isArray(data?.top_models) ? data.top_models.slice(0, 5) : [];

        topEl.innerHTML = `
            <div class="trend-block">
                <div class="trend-title">Top Providers</div>
                ${(providers.length ? providers : [{name:'-', tokens:0, requests:0}]).map((row) => `
                    <div class="trend-item"><span>${escapeHtml(String(row.name || '-'))}</span><span class="mono">${Number(row.tokens || 0).toLocaleString()}</span></div>
                `).join('')}
            </div>
            <div class="trend-block">
                <div class="trend-title">Top Models</div>
                ${(models.length ? models : [{name:'-', tokens:0, requests:0}]).map((row) => `
                    <div class="trend-item"><span>${escapeHtml(String(row.name || '-'))}</span><span class="mono">${Number(row.tokens || 0).toLocaleString()}</span></div>
                `).join('')}
            </div>
        `;
    }

    if (recentEl) {
        const rows = Array.isArray(data?.recent) ? data.recent : [];

        if (!rows.length) {
            recentEl.innerHTML = '<tr><td colspan="4">该范围内暂无记录</td></tr>';
            return;
        }

        recentEl.innerHTML = rows.map((row) => {
            const model = `${String(row.provider || 'unknown')} / ${String(row.model || 'unknown')}`;
            const tokenText = `${Number(row.total_tokens || 0).toLocaleString()} (${Number(row.input_tokens || 0).toLocaleString()} / ${Number(row.output_tokens || 0).toLocaleString()})`;

            return `
                <tr>
                    <td class="mono">${escapeHtml(String(row.timestamp || '-'))}</td>
                    <td>${escapeHtml(String(row.source || '-'))}</td>
                    <td>${escapeHtml(model)}</td>
                    <td class="mono">${escapeHtml(tokenText)}</td>
                </tr>
            `;
        }).join('');
    }
}

async function queryAdminUserTokenStats() {
    const usernameInput = document.getElementById('adminUserTokenStatsUsernameInput');
    const rangeSelect = document.getElementById('adminUserTokenStatsRangeSelect');
    const queryBtn = document.getElementById('adminUserTokenStatsQueryBtn');
    const username = String(usernameInput?.value || '').trim();
    const range = String(rangeSelect?.value || '30d').trim() || '30d';

    if (!username) {
        resetAdminUserTokenStatsResult('请输入用户 ID');
        showToast('请输入用户 ID');
        return;
    }

    if (queryBtn) queryBtn.disabled = true;
    resetAdminUserTokenStatsResult('查询中...');

    try {
        const params = new URLSearchParams({ username, range });
        const res = await fetch(`/api/admin/tokens/stats/user?${params.toString()}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message || '查询失败');
        }

        renderAdminUserTokenStats(data);
    } catch (err) {
        const message = err && err.message ? err.message : '查询失败';
        resetAdminUserTokenStatsResult(message);
        showToast(message);
    } finally {
        if (queryBtn) queryBtn.disabled = false;
    }
}

async function loadAdminStats() {
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
            const totalUsers = data.users.length;
            const adminCount = data.users.filter(u => u.role === 'admin').length;
            updateAdminUserTokenUserSelector(data.users);
            
            document.getElementById('statTotalUsers').textContent = totalUsers;
            document.getElementById('statAdminCount').textContent = adminCount;
            
            // Get token stats
            const tokenRes = await fetch('/api/admin/tokens/stats');
            const tokenData = await tokenRes.json();
            if (tokenData.success) {
                document.getElementById('statTotalTokens').textContent = (tokenData.total || 0).toLocaleString();
            }

            const trendRes = await fetch('/api/admin/tokens/timeseries?days=30');
            const trendData = await trendRes.json();
            if (trendData.success) {
                renderAdminTokenTrend(trendData);
            }

            const toolRes = await fetch('/api/admin/tools/stats?days=30');
            const toolData = await toolRes.json();
            if (toolData.success) {
                renderAdminToolTrend(toolData);
            }
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

function renderAdminTokenTrend(data) {
    const chartWrap = document.getElementById('adminTokenTrendChart');
    const meta = document.getElementById('adminTokenTrendMeta');
    const top = document.getElementById('adminTokenTrendTop');
    if (!chartWrap || !meta || !top) return;

    const labels = Array.isArray(data.labels) ? data.labels : [];
    const totalSeries = (data.series && Array.isArray(data.series.total_tokens)) ? data.series.total_tokens : [];
    const reqSeries = (data.series && Array.isArray(data.series.requests)) ? data.series.requests : [];

    if (!labels.length || !totalSeries.length) {
        chartWrap.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:12px;">暂无趋势数据</div>';
        meta.textContent = '-';
        top.innerHTML = '';
        return;
    }

    const totalSum = totalSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    const reqSum = reqSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    meta.textContent = `总请求 ${reqSum.toLocaleString()} · 总Token ${totalSum.toLocaleString()}`;

    const width = Math.max((chartWrap.clientWidth || 720) - 24, 360);
    const height = 220;
    const padL = 44;
    const padR = 14;
    const padT = 12;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(...totalSeries, 1);

    const points = totalSeries.map((v, i) => {
        const x = padL + (plotW * i / Math.max(totalSeries.length - 1, 1));
        const y = padT + plotH - ((Number(v) || 0) / maxVal) * plotH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const y = padT + plotH - (plotH * r);
        const val = Math.round(maxVal * r).toLocaleString();
        return `
            <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
        `;
    }).join('');

    const firstLabel = labels[0] || '';
    const midLabel = labels[Math.floor(labels.length / 2)] || '';
    const lastLabel = labels[labels.length - 1] || '';

    chartWrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${yTicks}
            <polyline fill="none" stroke="#2563eb" stroke-width="2.2" points="${points}" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="${padL}" y="${height - 8}" font-size="10" fill="#94a3b8">${firstLabel}</text>
            <text x="${padL + plotW / 2}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="middle">${midLabel}</text>
            <text x="${width - padR}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="end">${lastLabel}</text>
        </svg>
    `;

    const providers = Array.isArray(data.top_providers) ? data.top_providers.slice(0, 4) : [];
    const models = Array.isArray(data.top_models) ? data.top_models.slice(0, 4) : [];
    top.innerHTML = `
        <div class="trend-block">
            <div class="trend-title">Top Providers</div>
            ${(providers.length ? providers : [{name:'-', tokens:0}]).map(p => `
                <div class="trend-item"><span>${escapeHtml(String(p.name || '-'))}</span><span class="mono">${Number(p.tokens || 0).toLocaleString()}</span></div>
            `).join('')}
        </div>
        <div class="trend-block">
            <div class="trend-title">Top Models</div>
            ${(models.length ? models : [{name:'-', tokens:0}]).map(m => `
                <div class="trend-item"><span>${escapeHtml(String(m.name || '-'))}</span><span class="mono">${Number(m.tokens || 0).toLocaleString()}</span></div>
            `).join('')}
        </div>
    `;
}

function renderAdminToolTrend(data) {
    const chartWrap = document.getElementById('adminToolTrendChart');
    const meta = document.getElementById('adminToolTrendMeta');
    const top = document.getElementById('adminToolTrendTop');
    const totalCallsEl = document.getElementById('toolStatTotalCalls');
    const errorRateEl = document.getElementById('toolStatErrorRate');
    const avgLatencyEl = document.getElementById('toolStatAvgLatency');
    const failed24hEl = document.getElementById('toolStatFailed24h');
    if (!chartWrap || !meta || !top || !totalCallsEl || !errorRateEl || !avgLatencyEl || !failed24hEl) return;

    const summary = data.summary || {};
    totalCallsEl.textContent = Number(summary.total_calls || 0).toLocaleString();
    errorRateEl.textContent = `${Number(summary.error_rate || 0).toFixed(2)}%`;
    avgLatencyEl.textContent = Number(summary.avg_latency_ms || 0).toFixed(2);
    failed24hEl.textContent = Number((data.top_failed_tools_24h || []).length || 0).toLocaleString();

    const labels = Array.isArray(data.labels) ? data.labels : [];
    const callSeries = (data.series && Array.isArray(data.series.calls)) ? data.series.calls : [];
    const errSeries = (data.series && Array.isArray(data.series.errors)) ? data.series.errors : [];
    if (!labels.length || !callSeries.length) {
        meta.textContent = '-';
        chartWrap.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:12px;">暂无工具统计数据</div>';
        top.innerHTML = '';
        return;
    }

    const totalCalls = callSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    const totalErrs = errSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    meta.textContent = `调用 ${totalCalls.toLocaleString()} · 错误 ${totalErrs.toLocaleString()}`;

    const width = Math.max((chartWrap.clientWidth || 720) - 24, 360);
    const height = 220;
    const padL = 44;
    const padR = 14;
    const padT = 12;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(...callSeries, ...errSeries, 1);

    const makePoints = (series) => series.map((v, i) => {
        const x = padL + (plotW * i / Math.max(series.length - 1, 1));
        const y = padT + plotH - ((Number(v) || 0) / maxVal) * plotH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const callPoints = makePoints(callSeries);
    const errPoints = makePoints(errSeries);

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const y = padT + plotH - (plotH * r);
        const val = Math.round(maxVal * r).toLocaleString();
        return `
            <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
        `;
    }).join('');

    const firstLabel = labels[0] || '';
    const midLabel = labels[Math.floor(labels.length / 2)] || '';
    const lastLabel = labels[labels.length - 1] || '';

    chartWrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${yTicks}
            <polyline fill="none" stroke="#0f172a" stroke-width="2.2" points="${callPoints}" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline fill="none" stroke="#dc2626" stroke-width="2.2" points="${errPoints}" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="${padL}" y="${height - 8}" font-size="10" fill="#94a3b8">${firstLabel}</text>
            <text x="${padL + plotW / 2}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="middle">${midLabel}</text>
            <text x="${width - padR}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="end">${lastLabel}</text>
        </svg>
    `;

    const topTools = Array.isArray(data.top_tools) ? data.top_tools.slice(0, 5) : [];
    const failedTools = Array.isArray(data.top_failed_tools_24h) ? data.top_failed_tools_24h.slice(0, 5) : [];
    top.innerHTML = `
        <div class="trend-block">
            <div class="trend-title">Top Tools</div>
            ${(topTools.length ? topTools : [{name:'-', calls:0, error_rate:0, avg_latency_ms:0}]).map(t => `
                <div class="trend-item">
                    <span>${escapeHtml(String(t.name || '-'))}</span>
                    <span class="mono">${Number(t.calls || 0).toLocaleString()} / ${Number(t.error_rate || 0).toFixed(1)}%</span>
                </div>
            `).join('')}
        </div>
        <div class="trend-block">
            <div class="trend-title">Top Failed (24h)</div>
            ${(failedTools.length ? failedTools : [{name:'-', errors:0}]).map(t => `
                <div class="trend-item">
                    <span>${escapeHtml(String(t.name || '-'))}</span>
                    <span class="mono">${Number(t.errors || 0).toLocaleString()}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// 说明
function switchAdminTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('#adminModal .admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Deactivate all buttons
    document.querySelectorAll('#adminModal .admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Activate selected button
    const selectedBtn = document.querySelector(`#adminModal [data-tab="${tabName}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');
    if (tabName === 'chroma') {
        loadAdminChromaStats();
    }
    if (tabName === 'models') {
        loadAdminModelConfig();
    }

}

// 切换添加用户
function openAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.add('active');
// 说明
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'none';
    }
}

function closeAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.remove('active');
// 说明
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'auto';
    }
}

// 添加用户
async function submitAddUser() {
    return await adminUsersController.submitAddUser();
}

// 删除用户
async function deleteAdminUser(username) {
    return await adminUsersController.deleteAdminUser(username);
}

// 改变用户角色
async function changeUserRole(username, newRole) {
    return await adminUsersController.changeUserRole(username, newRole);
}

window.saveAdminUserProfile = async function(encodedUserId) {
    return await adminUsersController.saveAdminUserProfile(encodedUserId);
};

window.adminResetPassword = async function(encodedUserId) {
    return await adminUsersController.adminResetPassword(encodedUserId);
};



async function updateVectorInSettings() {
    if (!knowledgeEditorController.getCurrentTitle()) {
        showToast('请先选择知识点');
        return;
    }
    const vectorizeTasks = knowledgeVectorController.getVectorizeTasks();
    if (vectorizeTasks[knowledgeEditorController.getCurrentTitle()] && vectorizeTasks[knowledgeEditorController.getCurrentTitle()].running) {
        showToast('该知识点正在向量化');
        return;
    }
    showToast('正在更新到向量库，可先关闭窗口');
    setVectorStatus('更新中...');
    knowledgeVectorController.setVectorizeTitle(knowledgeEditorController.getCurrentTitle());
    const runId = knowledgeVectorController.nextVectorizeRunId();
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : knowledgeEditorController.getCurrentTitle();
        if (runId !== knowledgeVectorController.getVectorizeRunId()) return;

        const metaRes = await fetch('/api/knowledge/list');
        const metaData = await metaRes.json();
        knowledgeVectorizationEnabled = !!(metaData && metaData.vectorization_enabled);
        if (!knowledgeVectorizationEnabled) {
            showToast('知识向量化未启用或未配置，无法更新向量');
            setVectorStatus('向量化不可用');
            return;
        }

        const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
        const meta = basisMeta[liveTitle] || {};
        const updatedAt = Number(meta.updated_at || 0);
        const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
        if (updatedAt > 0 && vectorUpdatedAt >= updatedAt) {
            const chunksRes = await fetch('/api/knowledge/vector/chunks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: liveTitle })
            });
            const chunksData = await chunksRes.json();
            const chunkCount = (chunksData && chunksData.chunks ? chunksData.chunks : []).length;
            if (chunkCount > 0) {
                showToast('内容未变化，已跳过');
                setVectorStatus('无需更新');
                return;
            }
        }

        if (knowledgeVectorController.getVectorizeTitle() === knowledgeEditorController.getCurrentTitle()) startVectorProgress(100);
        const vectorizeData = await vectorizeKnowledgeTitle(liveTitle, {
            silent: true,
            onProgress: (pct, msg) => {
                if (knowledgeVectorController.getVectorizeTitle() !== knowledgeEditorController.getCurrentTitle()) return;
                updateVectorProgress(Math.max(0, Math.min(100, Number(pct) || 0)), 100, msg);
            }
        });
        if (!vectorizeData.success) {
            setVectorStatus('向量化失败');
            if (knowledgeVectorController.getVectorizeTitle() === knowledgeEditorController.getCurrentTitle()) {
                stopVectorProgress('向量化失败', true);
            }
            showToast('向量化失败: ' + (vectorizeData.message || '未知错误'));
            return;
        }
        const storedCount = Number(vectorizeData.stored_count || 0);
        if (knowledgeVectorController.getVectorizeTitle() === knowledgeEditorController.getCurrentTitle()) updateVectorProgress(100, 100, `完成 ${storedCount} 块`);

        showToast('已更新到向量库');
        setVectorStatus(`已更新，${storedCount} 块`);
        if (knowledgeVectorController.getVectorizeTitle() === knowledgeEditorController.getCurrentTitle()) {
            stopVectorProgress(`完成 ${storedCount} 块`);
        }
        loadVectorChunks(liveTitle);
    } catch (e) {
        showToast('向量化失败: ' + e.message);
        setVectorStatus('向量化失败');
        if (knowledgeVectorController.getVectorizeTitle() === knowledgeEditorController.getCurrentTitle()) {
            stopVectorProgress('向量化失败', true);
        }
    }
}

async function deleteVectorInSettings() {
    if (!knowledgeEditorController.getCurrentTitle()) {
        showToast('请先选择知识点');
        return;
    }
    const ok = await confirmModalAsync('删除向量数据', '确定删除该知识点在向量库中的所有内容吗？', 'danger');
    if (!ok) return;
    setVectorStatus('删除中...');
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : knowledgeEditorController.getCurrentTitle();
        const res = await fetch(`/api/knowledge/vector/titles/${encodeURIComponent(liveTitle)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast('向量已删除');
            setVectorStatus('已删除');
            if (knowledgeMetaCache[liveTitle]) {
                knowledgeMetaCache[liveTitle].vector_exists = false;
                knowledgeMetaCache[liveTitle].vector_updated_at = 0;
                knowledgeMetaCache[liveTitle].needs_vector_refresh = knowledgeVectorizationEnabled;
            }
            loadVectorChunks(liveTitle);
            loadKnowledge(currentConversationId);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'));
            setVectorStatus('删除失败');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message);
        setVectorStatus('删除失败');
    }
}

async function searchChroma() {
    const input = document.getElementById('chromaSearchInput');
    const results = document.getElementById('chromaSearchResults');
    if (!input || !results) return;
    const query = input.value.trim();
    if (!query) {
        results.style.display = 'block';
        results.textContent = '请输入查询内容';
        return;
    }

    results.style.display = 'block';
    results.textContent = '搜索中...';

    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 5 })
        });
        const data = await res.json();
        if (!data.success) {
            results.textContent = data.message || '搜索失败';
            return;
        }
        const result = data.result || {};
        const docs = result.documents && result.documents[0] ? result.documents[0] : [];
        const metas = result.metadatas && result.metadatas[0] ? result.metadatas[0] : [];
        const dists = result.distances && result.distances[0] ? result.distances[0] : [];
        if (docs.length === 0) {
            results.textContent = '没有结果';
            return;
        }
        const items = docs.map((doc, i) => ({
            doc,
            meta: metas[i],
            dist: dists[i],
            score: dists[i] != null ? (1 - dists[i]) : 0
        })).sort((a, b) => (b.score || 0) - (a.score || 0));

        results.innerHTML = items.map((item) => {
            const doc = item.doc || '';
            const meta = item.meta || {};
            const title = meta.title || 'Untitled';
            const scoreText = item.score != null ? item.score.toFixed(4) : '-';
            const preview = doc.length > 120 ? doc.slice(0, 120) + '...' : doc;
            return `<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0;">
                <div style="font-weight:600;">${title} <span style="color:#64748b; font-size:11px;">(score ${scoreText})</span></div>
                <div style="color:#64748b; font-size:12px;">${preview}</div>
            </div>`;
        }).join('');
    } catch (e) {
        results.textContent = '搜索失败: ' + e.message;
    }
}

async function loadVectorChunks(title) {
    return knowledgeVectorController.loadVectorChunks(title);
}

function setVectorStatus(text) {
    return knowledgeVectorController.setVectorStatus(text);
}

function setKnowledgeItemProgress(title, percent, active = true, stage = 'vectorizing') {
    return knowledgeVectorController.setKnowledgeItemProgress(title, percent, active, stage);
}

function escapeCssSelector(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return String(value || '').replace(/"/g, '\\"');
}

async function createKnowledgeVectorizeTask(title, library = 'knowledge') {
    return getNexoraChatKnowledge().createKnowledgeVectorizeTask(title, library);
}

async function pollKnowledgeVectorTask(taskId, onProgress) {
    return getNexoraChatKnowledge().pollKnowledgeVectorTask(taskId, onProgress);
}

async function bulkVectorizeAllBasis() {
    if (bulkVectorizeRunning) {
        showToast('正在批量向量化，请稍候');
        return;
    }

    return knowledgeVectorController.bulkVectorizeAllBasis();
}

async function vectorizeKnowledgeTitle(title, options = {}) {
    return knowledgeVectorController.vectorizeKnowledgeTitle(title, options);
}

function startVectorProgress(total) {
    return knowledgeVectorController.startVectorProgress(total);
}

function updateVectorProgress(done, total, message) {
    return knowledgeVectorController.updateVectorProgress(done, total, message);
}

function stopVectorProgress(message, isError = false) {
    return knowledgeVectorController.stopVectorProgress(message, isError);
}

function cancelVectorizeProgress() {
    return knowledgeVectorController.cancelVectorizeProgress();
}

function resetVectorProgressUI() {
    return knowledgeVectorController.resetVectorProgressUI();
}

async function deleteVectorChunk(vectorId, title) {
    return knowledgeVectorController.deleteVectorChunk(vectorId, title);
}

function setKnowledgeItemVectorButtonState(item, mode = 'idle') {
    return knowledgeVectorController.setKnowledgeItemVectorButtonState(item, mode);
}

function setKnowledgeItemVectorState(title, state) {
    return knowledgeVectorController.setKnowledgeItemVectorState(title, state);
}

// 设置模态框相关函数
async function openSettingsModal() {
    try {
        const settingsModal = document.getElementById('settingsModal');
        if (!settingsModal) {
            console.error('settingsModal not found in DOM');
            showToast('设置界面未加载');
            return;
        }
        if (document.body) document.body.classList.add('settings-modal-open');
        if (els.userMenu) els.userMenu.classList.remove('active');
        settingsModal.classList.add('active');
        settingsModal.classList.add('perf-mode');
        // 确保有用户名
        if (!currentUsername) await checkUserRole();

        // 初始化标签页事件
        initSettingsTabs();

        // 初始化 Skill 市场子标签
        if (window.NexoraSkillMarket) {
            window.NexoraSkillMarket.initSkillMarketModule();
        }

        // 默认切换到个人资料
        switchSettingsTab('profile');
        pendingAvatarDataUrl = '';

        // 加载用户数据
        await loadUserSettings();
        await loadSkillSettings(true);
    } catch (e) {
        console.error('打开设置模态框失败:', e);
        showToast('加载设置失败');
        if (document.body) document.body.classList.remove('settings-modal-open');
    }
}

function closeSettingsModal() {
    if (document.body) document.body.classList.remove('settings-modal-open');
    closeSkillModeDropdowns();
    if (SETTINGS_COMPANION_MODE) {
        try {
            const api = window.pywebview && window.pywebview.api;
            if (api && api.close_settings_window) {
                void api.close_settings_window();
                return;
            }
        } catch (_) {
            // ignore
        }
    }
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        settingsModal.classList.remove('active');
        settingsModal.classList.remove('perf-mode');
    }
    closeSkillEditorModal();
}

function initSettingsTabs() {
    settingsManagementController.init();
    adminSettingsTabsController.initSettingsTabs();
}

function switchSettingsTab(tabName) {
    adminSettingsTabsController.switchSettingsTab(tabName);
}

function getSettingsSkillListEl() {
    return els.settingsSkillList || document.getElementById('settingsSkillList');
}

function getSkillModeMapFromState() {
    const src = (skillSettingsState && typeof skillSettingsState.skillModes === 'object')
        ? skillSettingsState.skillModes
        : {};
    const out = {};
    Object.keys(src).forEach((key) => {
        const sid = String(key || '').trim();
        if (!sid) return;
        out[sid] = normalizeSkillModeValue(src[key]);
    });
    return out;
}

function buildSkillPreviewText(raw, limit = 180) {
    const src = String(raw || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    if (!src) return '（暂无内容）';
    if (src.length <= limit) return src;
    return `${src.slice(0, limit)}...`;
}

function formatSkillModeShortLabel(mode) {
    const normalized = normalizeSkillModeValue(mode);
    if (normalized === 'force') return 'Force';
    if (normalized === 'auto') return 'Auto';
    return 'Off';
}

function resolveSkillCardIcon(item) {
    const title = String(item && item.title ? item.title : '').toLowerCase();
    const tools = Array.isArray(item && item.required_tools)
        ? item.required_tools.map((x) => String(x || '').toLowerCase())
        : [];
    const merged = `${title} ${tools.join(' ')}`;
    if (/mail|email|smtp|imap/.test(merged)) return '✉️';
    if (/web|search|crawl|browser/.test(merged)) return '🔎';
    if (/file|upload|sandbox|document/.test(merged)) return '🧩';
    if (/code|python|js|tool/.test(merged)) return '🛠️';
    return '✨';
}

function closeSkillModeDropdowns(targetList = null) {
    const listEl = targetList || getSettingsSkillListEl();
    if (listEl) {
        listEl.querySelectorAll('.settings-skill-mode-dropdown.open').forEach((node) => {
            node.classList.remove('open');
            const trigger = node.querySelector('.settings-skill-mode-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    }
    if (skillModeFloatingDocHandler) {
        document.removeEventListener('pointerdown', skillModeFloatingDocHandler, true);
        skillModeFloatingDocHandler = null;
    }
    if (skillModeFloatingViewportHandler) {
        window.removeEventListener('resize', skillModeFloatingViewportHandler);
        window.removeEventListener('scroll', skillModeFloatingViewportHandler, true);
        skillModeFloatingViewportHandler = null;
    }
    if (skillModeFloatingMenuEl && skillModeFloatingMenuEl.parentNode) {
        skillModeFloatingMenuEl.parentNode.removeChild(skillModeFloatingMenuEl);
    }
    skillModeFloatingMenuEl = null;
    skillModeFloatingAnchorEl = null;
}

// Skill Mode 菜单挂在 body 下，需要跟随当前设置弹窗层级，避免被 modal-backdrop 覆盖。
function resolveSkillModeFloatingZIndex() {
    const settingsModal = document.getElementById('settingsModal');
    const rawZIndex = settingsModal ? window.getComputedStyle(settingsModal).zIndex : '';
    const modalZIndex = Number.parseInt(String(rawZIndex || ''), 10);

    if (!Number.isFinite(modalZIndex)) {
        throw new Error('无法计算设置面板的 Skill 菜单层级');
    }

    return modalZIndex + 1;
}

function positionSkillModeFloatingMenu(triggerEl, menuEl) {
    if (!triggerEl || !menuEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const vh = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
    const menuW = Math.max(120, Number(menuEl.offsetWidth || 120));
    const menuH = Math.max(110, Number(menuEl.offsetHeight || 110));

    const minLeft = 8;
    const maxLeft = Math.max(8, vw - menuW - 8);
    let left = Math.round(rect.right - menuW);
    left = Math.max(minLeft, Math.min(left, maxLeft));

    const minTop = 8;
    const maxTop = Math.max(8, vh - menuH - 8);
    const preferredTop = Math.round(rect.bottom + 8);
    let top = preferredTop;
    if (top > maxTop) {
        const aboveTop = Math.round(rect.top - menuH - 8);
        const canPlaceAboveNearTrigger = aboveTop >= minTop && rect.top > (menuH + 18);
        top = canPlaceAboveNearTrigger ? aboveTop : maxTop;
    }
    top = Math.max(minTop, Math.min(top, maxTop));

    menuEl.style.setProperty('left', `${left}px`, 'important');
    menuEl.style.setProperty('top', `${top}px`, 'important');
    menuEl.style.setProperty('right', 'auto', 'important');
    menuEl.style.setProperty('bottom', 'auto', 'important');
    menuEl.style.setProperty('z-index', String(resolveSkillModeFloatingZIndex()), 'important');
}

function openSkillModeFloatingMenu(skillId, triggerEl, listEl) {
    const sid = String(skillId || '').trim();
    if (!sid || !triggerEl) return;
    const modeMap = getSkillModeMapFromState();
    const mode = normalizeSkillModeValue(modeMap[sid] || 'off');

    const shouldToggleOff = skillModeFloatingAnchorEl === triggerEl && !!skillModeFloatingMenuEl;
    closeSkillModeDropdowns(listEl);
    if (shouldToggleOff) return;

    const dropdown = triggerEl.closest('.settings-skill-mode-dropdown');
    if (dropdown) dropdown.classList.add('open');
    triggerEl.setAttribute('aria-expanded', 'true');

    const menu = document.createElement('div');
    menu.className = 'tool-mode-menu settings-skill-mode-floating';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Skill mode');
    menu.innerHTML = `
        <button type="button" class="tool-mode-item settings-skill-mode-item ${mode === 'force' ? 'active' : ''}" data-mode="force" role="option" aria-selected="${mode === 'force' ? 'true' : 'false'}">Force</button>
        <button type="button" class="tool-mode-item settings-skill-mode-item ${mode === 'auto' ? 'active' : ''}" data-mode="auto" role="option" aria-selected="${mode === 'auto' ? 'true' : 'false'}">Auto</button>
        <button type="button" class="tool-mode-item settings-skill-mode-item ${mode === 'off' ? 'active' : ''}" data-mode="off" role="option" aria-selected="${mode === 'off' ? 'true' : 'false'}">Off</button>
    `;
    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('right', 'auto', 'important');
    menu.style.setProperty('bottom', 'auto', 'important');
    menu.style.setProperty('z-index', String(resolveSkillModeFloatingZIndex()), 'important');
    menu.style.display = 'grid';
    menu.style.gap = '6px';
    document.body.appendChild(menu);
    positionSkillModeFloatingMenu(triggerEl, menu);

    menu.querySelectorAll('.settings-skill-mode-item').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextMode = normalizeSkillModeValue(btn.dataset.mode || 'off');
            const nextMap = getSkillModeMapFromState();
            nextMap[sid] = nextMode;
            await saveSkillModesState(nextMap);
            closeSkillModeDropdowns(listEl);
        });
    });

    skillModeFloatingMenuEl = menu;
    skillModeFloatingAnchorEl = triggerEl;

    skillModeFloatingDocHandler = (evt) => {
        const t = evt && evt.target;
        if (t && (menu.contains(t) || triggerEl.contains(t))) return;
        closeSkillModeDropdowns(listEl);
    };
    document.addEventListener('pointerdown', skillModeFloatingDocHandler, true);

    skillModeFloatingViewportHandler = () => {
        if (!skillModeFloatingMenuEl || !skillModeFloatingAnchorEl) return;
        positionSkillModeFloatingMenu(skillModeFloatingAnchorEl, skillModeFloatingMenuEl);
    };
    window.addEventListener('resize', skillModeFloatingViewportHandler);
    window.addEventListener('scroll', skillModeFloatingViewportHandler, true);
}

function findSkillById(skillId) {
    const sid = String(skillId || '').trim();
    if (!sid) return null;
    const arr = Array.isArray(skillSettingsState.skills) ? skillSettingsState.skills : [];
    return arr.find((item) => String(item && item.id ? item.id : '').trim() === sid) || null;
}

// 暴露给 Skill 市场模块使用
window.getSkillById = findSkillById;

function closeSkillEditorModal() {
    const modal = els.skillEditorModal || document.getElementById('skillEditorModal');
    if (modal) modal.classList.remove('active');
    skillEditorState.skillId = '';
    skillEditorState.saving = false;
    if (els.saveSkillEditorBtn) {
        els.saveSkillEditorBtn.disabled = false;
        els.saveSkillEditorBtn.style.display = '';
    }
}

function openSkillEditorModal(skillId) {
    const sid = String(skillId || '').trim();
    if (!sid) return;
    const skill = findSkillById(sid);
    if (!skill) {
        showToast('Skill 不存在');
        return;
    }
    const modal = els.skillEditorModal || document.getElementById('skillEditorModal');
    if (!modal) return;
    const titleEl = els.skillEditorTitle || document.getElementById('skillEditorTitle');
    const toolsEl = els.skillEditorTools || document.getElementById('skillEditorTools');
    const contentEl = els.skillEditorContent || document.getElementById('skillEditorContent');
    const saveBtn = els.saveSkillEditorBtn || document.getElementById('saveSkillEditorBtn');
    const canEditCatalog = String(currentUserRole || 'member').toLowerCase() === 'admin';
    if (titleEl) {
        titleEl.textContent = `${canEditCatalog ? '编辑' : '查看'} Skill · ${String(skill.title || sid)}`;
    }
    if (toolsEl) {
        const tools = Array.isArray(skill.required_tools)
            ? skill.required_tools.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        toolsEl.textContent = tools.length ? tools.join(', ') : '-';
    }
    if (contentEl) {
        contentEl.value = String(skill.main_content || '');
        contentEl.readOnly = !canEditCatalog;
        contentEl.placeholder = canEditCatalog ? '输入 Skill 内容' : '仅管理员可编辑 Skill 内容';
    }
    skillEditorState.skillId = sid;
    skillEditorState.saving = false;
    if (saveBtn) {
        saveBtn.disabled = !canEditCatalog;
        saveBtn.style.display = canEditCatalog ? '' : 'none';
    }
    modal.classList.add('active');
}

async function saveSkillEditorModal() {
    if (skillEditorState.saving) return;
    const canEditCatalog = String(currentUserRole || 'member').toLowerCase() === 'admin';
    if (!canEditCatalog) {
        showToast('仅管理员可编辑 Skill 内容');
        return;
    }
    const sid = String(skillEditorState.skillId || '').trim();
    if (!sid) return;
    const contentEl = els.skillEditorContent || document.getElementById('skillEditorContent');
    const content = String(contentEl && contentEl.value ? contentEl.value : '');
    skillEditorState.saving = true;
    if (els.saveSkillEditorBtn) els.saveSkillEditorBtn.disabled = true;
    try {
        await saveSkillContentById(sid, content, null);
        closeSkillEditorModal();
    } finally {
        skillEditorState.saving = false;
        if (els.saveSkillEditorBtn) els.saveSkillEditorBtn.disabled = false;
    }
}

function renderSkillList() {
    const listEl = getSettingsSkillListEl();
    if (!listEl) return;
    closeSkillModeDropdowns(listEl);
    const skills = Array.isArray(skillSettingsState.skills) ? skillSettingsState.skills : [];
    if (!skills.length) {
        listEl.innerHTML = '<div class="settings-skill-empty">暂无 Skill</div>';
        return;
    }
    const canEditCatalog = String(currentUserRole || 'member').toLowerCase() === 'admin';
    const modeMap = getSkillModeMapFromState();

    listEl.innerHTML = skills.map((item) => {
        const sid = String(item && item.id ? item.id : '').trim();
        const title = String(item && item.title ? item.title : sid).trim();
        const preview = buildSkillPreviewText(item && item.main_content ? item.main_content : '');
        const mode = normalizeSkillModeValue(modeMap[sid] || item.mode || 'off');
        const icon = resolveSkillCardIcon(item);
        const origin = String(item && item.origin ? item.origin : 'global').trim();
        const isPersonal = (origin === 'self' || origin === 'market');
        const requiredTools = Array.isArray(item && item.required_tools)
            ? item.required_tools.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        const badgeText = requiredTools.length
            ? (requiredTools.length > 1 ? `${requiredTools[0]} +${requiredTools.length - 1}` : requiredTools[0])
            : '无工具约束';
        const modeText = formatSkillModeShortLabel(mode);

        // 来源标记
        const originLabel = origin === 'market' ? '市场' : (origin === 'self' ? '自建' : '全局');
        const originBadge = `<span class="settings-skill-origin" data-origin="${escapeHtml(origin)}">${escapeHtml(originLabel)}</span>`;

        // 操作按钮：个人 Skill 显示编辑/删除，全局 Skill 仅管理员可编辑
        let actionsHtml = '';
        if (isPersonal) {
            actionsHtml = `
                <div class="settings-skill-actions">
                    <button type="button" class="btn-skill-small" data-action="edit-personal-skill" data-skill-id="${escapeHtml(sid)}">编辑</button>
                    <button type="button" class="btn-skill-small danger" data-action="delete-personal-skill" data-skill-id="${escapeHtml(sid)}">删除</button>
                </div>`;
        } else if (canEditCatalog) {
            actionsHtml = `<button type="button" class="settings-skill-edit-dot" data-action="open-skill-editor" data-skill-id="${escapeHtml(sid)}" title="编辑 Skill">⋯</button>`;
        }

        return `
            <div class="settings-skill-card" data-skill-id="${escapeHtml(sid)}">
                <div class="settings-skill-top">
                    <div class="settings-skill-icon" aria-hidden="true">${escapeHtml(icon)}</div>
                    <div class="settings-skill-main" data-action="${isPersonal ? 'edit-personal-skill' : 'open-skill-editor'}" data-skill-id="${escapeHtml(sid)}" role="button" tabindex="0">
                        <div class="settings-skill-title">${escapeHtml(title)} ${originBadge}</div>
                        <div class="settings-skill-preview">${escapeHtml(preview)}</div>
                    </div>
                    <div class="settings-skill-controls">
                        <span class="settings-skill-mode-label">Mode</span>
                        <div class="tool-mode-dropdown settings-skill-mode-dropdown" data-skill-id="${escapeHtml(sid)}">
                            <button
                                type="button"
                                class="tool-mode-trigger settings-skill-mode-trigger"
                                data-action="toggle-skill-mode-menu"
                                data-skill-id="${escapeHtml(sid)}"
                                aria-haspopup="listbox"
                                aria-expanded="false"
                            >
                                <span class="settings-skill-mode-text">${escapeHtml(modeText)}</span>
                                <i class="fa-solid fa-chevron-up"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="settings-skill-divider"></div>
                <div class="settings-skill-footer">
                    <span class="settings-skill-badge" title="${escapeHtml(requiredTools.join(', '))}">${escapeHtml(badgeText)}</span>
                    ${actionsHtml}
                </div>
            </div>
        `;
    }).join('');

    // Mode 下拉菜单
    listEl.querySelectorAll('[data-action="toggle-skill-mode-menu"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            openSkillModeFloatingMenu(sid, btn, listEl);
        });
    });

    // 全局 Skill 编辑器（管理员）
    listEl.querySelectorAll('[data-action="open-skill-editor"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            openSkillEditorModal(sid);
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            openSkillEditorModal(sid);
        });
    });

    // 个人 Skill 编辑
    listEl.querySelectorAll('[data-action="edit-personal-skill"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            if (window.NexoraSkillMarket) {
                window.NexoraSkillMarket.openPersonalSkillEditor(sid);
            }
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            if (window.NexoraSkillMarket) {
                window.NexoraSkillMarket.openPersonalSkillEditor(sid);
            }
        });
    });

    // 个人 Skill 删除
    listEl.querySelectorAll('[data-action="delete-personal-skill"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const sid = String(btn.dataset.skillId || '').trim();
            if (!sid) return;
            if (window.NexoraSkillMarket) {
                window.NexoraSkillMarket.deletePersonalSkill(sid);
            }
        });
    });

    if (listEl.dataset.skillModeDocBound !== '1') {
        listEl.dataset.skillModeDocBound = '1';
        document.addEventListener('click', (e) => {
            if (!listEl.contains(e.target)) {
                closeSkillModeDropdowns(listEl);
            }
        });
    }
}

function applySkillSettingsPayload(data) {
    const payload = (data && typeof data === 'object') ? data : {};
    skillSettingsState.skills = Array.isArray(payload.skills) ? payload.skills : [];
    skillSettingsState.activeSkills = Array.isArray(payload.active_skills) ? payload.active_skills : [];
    const nextModes = {};
    const rawMap = (payload.skill_modes && typeof payload.skill_modes === 'object') ? payload.skill_modes : {};
    Object.keys(rawMap).forEach((key) => {
        const sid = String(key || '').trim();
        if (!sid) return;
        nextModes[sid] = normalizeSkillModeValue(rawMap[key]);
    });
    if (!Object.keys(nextModes).length) {
        skillSettingsState.skills.forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const sid = String(item.id || '').trim();
            if (!sid) return;
            nextModes[sid] = normalizeSkillModeValue(item.mode || 'off');
        });
    }
    skillSettingsState.skillModes = nextModes;
    skillSettingsState.loaded = true;
    renderSkillList();
}

async function loadSkillSettings(force = false) {
    if (skillSettingsState.loading && !force) return;
    skillSettingsState.loading = true;
    try {
        const res = await fetch('/api/skills/list', { credentials: 'include', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        applySkillSettingsPayload(data);
    } catch (e) {
        const listEl = getSettingsSkillListEl();
        if (listEl) {
            listEl.innerHTML = `<div class="settings-skill-empty">加载失败：${escapeHtml(String((e && e.message) || e || 'unknown'))}</div>`;
        }
    } finally {
        skillSettingsState.loading = false;
    }
}

async function saveSkillModesState(skillModes) {
    const src = (skillModes && typeof skillModes === 'object') ? skillModes : {};
    const map = {};
    Object.keys(src).forEach((key) => {
        const sid = String(key || '').trim();
        if (!sid) return;
        map[sid] = normalizeSkillModeValue(src[key]);
    });
    try {
        const res = await fetch('/api/skills/settings', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                skill_modes: map
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        applySkillSettingsPayload(data);
        showToast('Skill Mode 已更新');
    } catch (e) {
        showToast(`Skill Mode 保存失败: ${String((e && e.message) || e || 'unknown')}`);
        await loadSkillSettings(true);
    }
}

async function saveSkillContentById(skillId, content, actionBtn = null) {
    const sid = String(skillId || '').trim();
    if (!sid) return;
    const btn = actionBtn || null;
    if (btn) btn.disabled = true;
    try {
        const skill = (Array.isArray(skillSettingsState.skills) ? skillSettingsState.skills : [])
            .find((item) => String(item && item.id ? item.id : '').trim() === sid);
        if (!skill) {
            showToast('Skill 不存在');
            return;
        }
        const payload = {
            id: sid,
            title: String(skill.title || '').trim(),
            required_tools: Array.isArray(skill.required_tools) ? skill.required_tools : [],
            mode: normalizeSkillModeValue((getSkillModeMapFromState()[sid]) || skill.mode || 'off'),
            author: String(skill.author || '').trim(),
            release_date: String(skill.release_date || '').trim(),
            version: String(skill.version || '').trim(),
            update_date: String(skill.update_date || '').trim(),
            main_content: String(content || '')
        };
        const res = await fetch('/api/skills/upsert', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill: payload })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        showToast('Skill 内容已保存');
        await loadSkillSettings(true);
    } catch (e) {
        showToast(`Skill 保存失败: ${String((e && e.message) || e || 'unknown')}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function loadUserSettings() {
    try {
        // 获取用户信息
        const userRes = await fetch('/api/user/info');
        const userData = await userRes.json();
        let stats = {};

        if (userData.success) {
            const user = userData.user;
            // 填充个人资料
            const usernameInput = document.getElementById('set-username-input');
            if (usernameInput) usernameInput.value = user.username || '';
            const userIdEl = document.getElementById('set-userid');
            if (userIdEl) userIdEl.textContent = `UserID: ${user.id || '-'}`;
            document.getElementById('set-created').textContent =
                user.created_at ? new Date(user.created_at * 1000).toLocaleString() : '2026-02-10（默认）';
            document.getElementById('set-lastlogin').textContent =
                user.last_login ? new Date(user.last_login * 1000).toLocaleString() : new Date().toLocaleString();
            currentUserAvatarUrl = user.avatar_url || '';
            const avatarImg = document.getElementById('settingsAvatarImg');
            if (avatarImg) {
                avatarImg.src = currentUserAvatarUrl || getDefaultAvatarDataUrl(user.username || user.id);
            }
            updateSidebarUserProfile(user.username || user.id, currentUserAvatarUrl);

            // 填充统计信息
            stats = user.stats || {};
            document.getElementById('set-stat-convs').textContent = stats.total_conversations || 0;
            document.getElementById('set-stat-tokens').textContent = (stats.total_tokens || 0).toLocaleString();
            document.getElementById('set-stat-knowledge').textContent = stats.total_knowledge || 0;

            // 填充模型使用统计
            const modelStatsDiv = document.getElementById('modelUsageStats');
            if (stats.model_usage && Object.keys(stats.model_usage).length > 0) {
                const modelStatsHtml = Object.entries(stats.model_usage)
                    .sort(([, a], [, b]) => b - a)
                    .map(([model, count]) => `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 4px;">
                            <span style="color: #475569; font-weight: 500;">${model}</span>
                            <span style="color: #0f172a; font-weight: 600;">${count} 次调用</span>
                        </div>
                    `)
                    .join('');
                modelStatsDiv.innerHTML = modelStatsHtml;
            } else {
                modelStatsDiv.innerHTML = '<div style="color:#94a3b8;">暂无数据</div>';
            }
        }

        // 获取用户偏好设置
        const prefsRes = await fetch('/api/user/preferences');
        const prefsData = await prefsRes.json();

        if (prefsData.success) {
            const prefs = prefsData.preferences;
            currentUserPreferences = prefs || currentUserPreferences || {};
            // 填充偏好设置
            const themeField = document.getElementById('set-theme');

            if (themeField) {
                themeField.textContent = '亮色主题';
            }

            setLearningModeToggleUi(!!prefs.learning_mode);
            setDefaultOpenViewToggleUi(String(prefs.default_open_view || 'learning'));
        }

        const memorySettings = getNexoraChatMemorySettings();
        memorySettings.bind();
        await Promise.all([
            memorySettings.loadProfile(),
            memorySettings.loadModelSelector(currentUserPreferences || {})
        ]);
    } catch (e) {
        console.error('加载用户设置失败:', e);
    }
}

async function saveUserProfile() {
    const usernameInput = document.getElementById('set-username-input');
    const displayName = (usernameInput && usernameInput.value ? usernameInput.value : '').trim();
    if (!displayName) {
        showToast('用户名不能为空');
        return;
    }
    try {
        const res = await fetch('/api/user/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                display_name: displayName,
                avatar_base64: pendingAvatarDataUrl || null
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '保存失败');
            return;
        }
        pendingAvatarDataUrl = '';
        showToast('资料已保存');
        await loadUserSettings();
        await checkUserRole();
    } catch (e) {
        showToast('保存失败');
    }
}

function normalizeAdminQuotaDisplayUnit(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'auto' || value === 'k' || value === 'w' || value === 'm' || value === 'token') {
        return value;
    }
    return 'auto';
}

function loadAdminQuotaDisplayUnitPreference() {
    try {
        return normalizeAdminQuotaDisplayUnit(localStorage.getItem(ADMIN_QUOTA_UNIT_STORAGE_KEY));
    } catch (_) {
        return 'auto';
    }
}

function saveAdminQuotaDisplayUnitPreference(raw) {
    const value = normalizeAdminQuotaDisplayUnit(raw);
    try {
        localStorage.setItem(ADMIN_QUOTA_UNIT_STORAGE_KEY, value);
    } catch (_) {
        // ignore storage failures (private mode / quota exceeded)
    }
    return value;
}

function normalizeAdminQuotaAdjustMode(raw) {
    const value = String(raw || '').trim().toLowerCase();
    return value === 'remaining' ? 'remaining' : 'total';
}

function loadAdminQuotaAdjustModePreference() {
    try {
        return normalizeAdminQuotaAdjustMode(localStorage.getItem(ADMIN_QUOTA_ADJUST_MODE_STORAGE_KEY));
    } catch (_) {
        return 'total';
    }
}

function saveAdminQuotaAdjustModePreference(raw) {
    const value = normalizeAdminQuotaAdjustMode(raw);
    try {
        localStorage.setItem(ADMIN_QUOTA_ADJUST_MODE_STORAGE_KEY, value);
    } catch (_) {
        // ignore storage failures
    }
    return value;
}

function _pickQuotaDisplayUnit(value, mode) {
    const normalizedMode = normalizeAdminQuotaDisplayUnit(mode || adminQuotaDisplayUnit);
    if (normalizedMode !== 'auto') return normalizedMode;
    const numeric = Math.max(0, parseInt(value || 0, 10) || 0);
    if (numeric >= 1000000) return 'm';
    if (numeric >= 10000) return 'w';
    if (numeric >= 1000) return 'k';
    return 'token';
}

function _formatQuotaScaledNumber(value, divisor) {
    const numeric = Math.max(0, Number(value || 0));
    const scaled = divisor > 0 ? (numeric / divisor) : numeric;
    const absScaled = Math.abs(scaled);
    let digits = 0;
    if (absScaled < 10) digits = 2;
    else if (absScaled < 100) digits = 1;
    const text = scaled.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });
    return text;
}

function _formatQuotaTokens(value, options = {}) {
    const numeric = Math.max(0, parseInt(value || 0, 10) || 0);
    const unitMode = normalizeAdminQuotaDisplayUnit(options && options.unitMode ? options.unitMode : adminQuotaDisplayUnit);
    const unit = _pickQuotaDisplayUnit(numeric, unitMode);

    if (unit === 'token') {
        return numeric.toLocaleString();
    }

    if (unit === 'k') {
        return `${_formatQuotaScaledNumber(numeric, 1000)}K`;
    }
    if (unit === 'w') {
        return `${_formatQuotaScaledNumber(numeric, 10000)}w`;
    }
    if (unit === 'm') {
        return `${_formatQuotaScaledNumber(numeric, 1000000)}M`;
    }
    return numeric.toLocaleString();
}

function _roundQuotaDebtScale(valueTokens) {
    const raw = Math.max(0, parseInt(valueTokens || 0, 10) || 0);
    if (raw <= 0) return 0;
    const step = 500000;
    return Math.ceil(raw / step) * step;
}

function _layoutSingleQuotaMeterLabelRow(rowEl) {
    if (!rowEl) return;
    const debtEl = rowEl.querySelector('[data-role="quota-meter-label-debt"]');
    const remainEl = rowEl.querySelector('[data-role="quota-meter-label-remaining"]');
    const totalEl = rowEl.querySelector('[data-role="quota-meter-label-total"]');
    const usedEl = rowEl.querySelector('[data-role="quota-meter-label-used"]');
    if (!debtEl || !remainEl || !totalEl) return;

    const rowWidth = Math.max(0, rowEl.clientWidth || 0);
    if (rowWidth <= 0) return;

    const gap = 8;
    const rightReserve = Math.max(0, parseInt(rowEl.dataset.rightReserve || 0, 10) || 0);
    const debtVisible = String(debtEl.dataset.visible || '1') !== '0' && debtEl.style.display !== 'none';
    const remainVisible = String(remainEl.dataset.visible || '1') !== '0' && remainEl.style.display !== 'none';
    const usedVisible = !!usedEl && String(usedEl.dataset.visible || '1') !== '0' && usedEl.style.display !== 'none';
    const debtWidth = debtVisible ? Math.ceil(debtEl.getBoundingClientRect().width || 0) : 0;
    const remainWidth = remainVisible ? Math.ceil(remainEl.getBoundingClientRect().width || 0) : 0;
    const totalWidth = Math.ceil(totalEl.getBoundingClientRect().width || 0);
    const usedWidth = usedVisible ? Math.ceil(usedEl.getBoundingClientRect().width || 0) : 0;

    const rightBlocked = rightReserve + (usedVisible ? (usedWidth + gap) : 0);
    const layoutWidth = Math.max(0, rowWidth - rightBlocked);
    if (layoutWidth <= 0) return;

    const debtAnchorPct = Math.max(0, Math.min(100, parseFloat(debtEl.dataset.anchor || '0') || 0));
    const remainAnchorPct = Math.max(0, Math.min(100, parseFloat(remainEl.dataset.anchor || '0') || 0));

    const debtAnchorPx = (debtAnchorPct / 100) * layoutWidth;
    const remainAnchorPx = (remainAnchorPct / 100) * layoutWidth;

    let totalRight = layoutWidth;
    let remainRight = remainVisible ? Math.max(remainWidth, Math.min(layoutWidth, remainAnchorPx)) : 0;
    let debtRight = debtVisible ? Math.max(debtWidth, Math.min(layoutWidth, debtAnchorPx)) : 0;

    const maxRemainRight = remainVisible ? Math.max(remainWidth, totalRight - totalWidth - gap) : 0;
    if (remainVisible && remainRight > maxRemainRight) {
        remainRight = maxRemainRight;
    }

    const minRemainRight = remainVisible ? (debtVisible ? (debtRight + remainWidth + gap) : remainWidth) : 0;
    if (remainVisible && remainRight < minRemainRight) {
        remainRight = Math.min(maxRemainRight, minRemainRight);
    }

    if (debtVisible && remainVisible) {
        const maxDebtRight = remainRight - remainWidth - gap;
        if (debtRight > maxDebtRight) {
            debtRight = Math.max(debtWidth, maxDebtRight);
        }
    } else if (debtVisible) {
        const maxDebtRight = totalRight - totalWidth - gap;
        if (debtRight > maxDebtRight) {
            debtRight = Math.max(debtWidth, maxDebtRight);
        }
    }

    const debtLeft = Math.max(0, Math.min(layoutWidth - debtWidth, debtRight - debtWidth));
    const remainLeft = Math.max(0, Math.min(layoutWidth - remainWidth, remainRight - remainWidth));
    const totalLeft = Math.max(0, Math.min(layoutWidth - totalWidth, totalRight - totalWidth));

    debtEl.style.left = `${Math.round(debtLeft)}px`;
    if (remainVisible) {
        remainEl.style.left = `${Math.round(remainLeft)}px`;
    }
    totalEl.style.left = `${Math.round(totalLeft)}px`;
    if (usedVisible) {
        const usedLeft = Math.max(0, Math.min(rowWidth - usedWidth, rowWidth - rightReserve - usedWidth));
        usedEl.style.left = `${Math.round(usedLeft)}px`;
    }
}

function _layoutQuotaMeterLabels(rootEl) {
    const scope = rootEl && rootEl.querySelectorAll ? rootEl : document;
    scope.querySelectorAll('[data-role="quota-meter-label-row"]').forEach((rowEl) => {
        _layoutSingleQuotaMeterLabelRow(rowEl);
    });
}

let _quotaMeterLayoutEventsBound = false;

function _ensureQuotaMeterLayoutEvents() {
    if (_quotaMeterLayoutEventsBound) return;
    _quotaMeterLayoutEventsBound = true;
    window.addEventListener('resize', () => {
        const quotaContainer = document.getElementById('quotaProviderList');
        if (quotaContainer) _layoutQuotaMeterLabels(quotaContainer);
        const modelContainer = document.getElementById('adminModelConfigList');
        if (modelContainer) _layoutQuotaMeterLabels(modelContainer);
    });
}

function _buildQuotaReverseOverflowMeterHtml(usedTokens, totalTokens, overageTokens, providerDebtScaleTokens, labelRightReservePx = 0) {
    const used = Math.max(0, parseInt(usedTokens || 0, 10) || 0);
    const total = Math.max(0, parseInt(totalTokens || 0, 10) || 0);
    const overage = Math.max(0, parseInt(overageTokens || 0, 10) || 0);
    const debtScale = Math.max(0, parseInt(providerDebtScaleTokens || 0, 10) || 0);
    const remaining = total > used ? (total - used) : 0;

    const hasDebt = overage > 0;
    const showUsedBar = !hasDebt && used > 0 && total > 0;
    const showRemainingLabel = remaining > 0;
    const usedRight = showUsedBar
        ? Math.max(0, Math.min((used / total) * 50, 50))
        : 0;
    const remainingRight = (!hasDebt && total > 0)
        ? Math.max(0, Math.min((remaining / total) * 50, 50))
        : 0;
    const overflowLeft = (hasDebt && debtScale > 0)
        ? Math.max(0, Math.min((overage / debtScale) * 50, 50))
        : 0;
    const debtAnchor = overflowLeft > 0
        ? Math.max(2, Math.min(50, 50 - overflowLeft))
        : 50;
    const remainAnchor = (!hasDebt && total > 0)
        ? Math.max(50, Math.min(98, 50 + remainingRight))
        : 50;

    const debtLabel = hasDebt ? `负${_formatQuotaTokens(overage)}` : '';
    const remainLabel = showRemainingLabel ? `剩${_formatQuotaTokens(remaining)}` : '';
    const totalLabel = `共${_formatQuotaTokens(total)}`;
    const usedLabel = `已用${_formatQuotaTokens(used)}`;
    const showUsedLabel = usedRight > 0;
    const rightReserve = Math.max(0, parseInt(labelRightReservePx || 0, 10) || 0);

    return `
        <div class="quota-meter-shell" style="position:relative;">
            <div class="quota-meter-track" style="position:relative; height:12px; border-radius:999px; background: rgba(148, 163, 184, 0.18); overflow:hidden;">
            ${remainingRight > 0 ? `<div class="quota-meter-seg quota-meter-seg-remaining" style="position:absolute; left:50%; top:0; bottom:0; width:${remainingRight}%; background:#16a34a;"></div>` : ''}
            ${usedRight > 0 ? `<div class="quota-meter-seg quota-meter-seg-used" style="position:absolute; left:${50 + remainingRight}%; top:0; bottom:0; width:${usedRight}%; background:#f7f072;"></div>` : ''}
            ${overflowLeft > 0 ? `<div class="quota-meter-seg quota-meter-seg-overage" style="position:absolute; right:50%; top:0; bottom:0; width:${overflowLeft}%; background:#dc2626;"></div>` : ''}
            <div class="quota-meter-midline" style="position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; background:#334155; opacity:0.9;"></div>
            </div>
            <div data-role="quota-meter-label-row" class="quota-meter-label-row" data-right-reserve="${rightReserve}" style="position:relative; height:18px; margin-top:4px; font-size:11px; line-height:18px;">
                <div data-role="quota-meter-label-debt" data-visible="${hasDebt ? '1' : '0'}" data-anchor="${debtAnchor}" style="position:absolute; top:0; color:#b91c1c; white-space:nowrap; ${hasDebt ? '' : 'display:none;'}">${debtLabel}</div>
                <div data-role="quota-meter-label-remaining" data-visible="${showRemainingLabel ? '1' : '0'}" data-anchor="${remainAnchor}" style="position:absolute; top:0; color:#166534; white-space:nowrap; ${showRemainingLabel ? '' : 'display:none;'}">${remainLabel}</div>
                <div data-role="quota-meter-label-total" style="position:absolute; top:0; color:#0f172a; white-space:nowrap;">${totalLabel}</div>
                <div data-role="quota-meter-label-used" data-visible="${showUsedLabel ? '1' : '0'}" style="position:absolute; top:0; color:#a16207; white-space:nowrap; ${showUsedLabel ? '' : 'display:none;'}">${usedLabel}</div>
            </div>
        </div>
    `;
}

let _quotaAdjustPopoverAnchorEl = null;
let _activeQuotaMeterWrapEl = null;
let _quotaAdjustPopoverFollowRaf = 0;

function _setActiveQuotaMeterWrap(nextEl) {
    if (_activeQuotaMeterWrapEl && _activeQuotaMeterWrapEl.classList) {
        _activeQuotaMeterWrapEl.classList.remove('quota-meter-active');
    }
    _activeQuotaMeterWrapEl = nextEl || null;
    if (_activeQuotaMeterWrapEl && _activeQuotaMeterWrapEl.classList) {
        _activeQuotaMeterWrapEl.classList.add('quota-meter-active');
    }
}

function _getQuotaAdjustPopover() {
    let popover = document.getElementById('quotaAdjustPopover');
    if (popover) return popover;

    popover = document.createElement('div');
    popover.id = 'quotaAdjustPopover';
    popover.style.position = 'fixed';
    popover.style.display = 'none';
    popover.style.zIndex = '12020';
    popover.style.minWidth = '340px';
    popover.style.padding = '12px';
    popover.style.border = '1px solid var(--border-color)';
    popover.style.borderRadius = '10px';
    popover.style.background = '#ffffff';
    popover.style.boxShadow = '0 14px 34px rgba(2, 6, 23, 0.18)';
    popover.innerHTML = `
        <div data-role="quota-target" style="font-size:13px; color:#0f172a; font-weight:700;">-</div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:10px;">
            <div data-role="quota-used" style="font-size:12px; color:#334155; white-space:nowrap;">用 0 /</div>
            <select data-role="quota-adjust-mode" class="input-modern" style="width:72px; min-width:72px; height:30px; padding:4px 8px; font-size:12px;">
                <option value="total">共</option>
                <option value="remaining">剩</option>
            </select>
            <input data-role="quota-adjust-input" type="number" min="0" step="1" style="flex:1; border:1px solid #64748b; border-radius:8px; padding:6px 8px; font-size:12px; background:#ffffff; box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);">
            <button type="button" data-act="save" title="保存额度" style="width:30px; height:30px; border:1px solid #cbd5e1; border-radius:8px; background:#ffffff; color:#0f172a; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                <i class="fa-solid fa-floppy-disk" style="font-size:12px;"></i>
            </button>
        </div>
        <div data-role="quota-adjust-hint" style="margin-top:8px; font-size:11px; color:#64748b; line-height:1.4;">-</div>
    `;

    const _closeByOutside = (ev) => {
        if (!popover || popover.style.display === 'none') return;
        const target = ev && ev.target;
        if (!target) return;
        if (popover.contains(target)) return;
        if (target.closest && target.closest('.quota-total-icon-btn')) return;
        if (target.closest && target.closest('.model-admin-item-meter-wrap')) return;
        _closeQuotaAdjustPopover();
    };

    const _followAnchor = () => {
        if (!popover || popover.style.display === 'none') return;
        if (!_quotaAdjustPopoverAnchorEl || !_quotaAdjustPopoverAnchorEl.isConnected) {
            _closeQuotaAdjustPopover();
            return;
        }
        _positionQuotaAdjustPopover(popover, _quotaAdjustPopoverAnchorEl);
    };

    const _queueFollowAnchor = () => {
        if (_quotaAdjustPopoverFollowRaf) return;
        _quotaAdjustPopoverFollowRaf = requestAnimationFrame(() => {
            _quotaAdjustPopoverFollowRaf = 0;
            _followAnchor();
        });
    };

    document.addEventListener('pointerdown', _closeByOutside, true);
    window.addEventListener('resize', _queueFollowAnchor);
    window.addEventListener('scroll', _queueFollowAnchor, true);

    const _savePopoverValue = async () => {
        if (popover.dataset.busy === '1') return;
        const provider = String(popover.dataset.provider || '').trim();
        const model = String(popover.dataset.model || '').trim();
        if (!provider || !model) return;

        const modeEl = popover.querySelector('[data-role="quota-adjust-mode"]');
        const inputEl = popover.querySelector('[data-role="quota-adjust-input"]');
        const mode = modeEl ? normalizeAdminQuotaAdjustMode(modeEl.value || 'total') : 'total';
        saveAdminQuotaAdjustModePreference(mode);
        const inputRaw = inputEl ? parseInt(inputEl.value || 0, 10) : 0;
        const inputValue = Math.max(0, Number.isFinite(inputRaw) ? inputRaw : 0);
        const currentTotal = Math.max(0, parseInt(popover.dataset.totalTokens || 0, 10) || 0);
        const usedTokens = Math.max(0, parseInt(popover.dataset.usedTokens || 0, 10) || 0);

        let nextTotal = inputValue;
        let modeText = '总量模式';
        let deltaText = '';
        if (mode === 'remaining') {
            nextTotal = Math.max(0, usedTokens + inputValue);
            const delta = nextTotal - currentTotal;
            modeText = '剩余额度模式';
            if (delta > 0) {
                deltaText = `，自动增加 ${_formatQuotaTokens(delta, { unitMode: 'token' })}`;
            } else if (delta < 0) {
                deltaText = `，自动减少 ${_formatQuotaTokens(Math.abs(delta), { unitMode: 'token' })}`;
            } else {
                deltaText = '，总量不变';
            }
        }

        await _submitModelQuotaUpdate('set', provider, model, nextTotal, {
            successMessage: `模型额度已更新（${modeText}${deltaText}）`
        });
    };

    popover.addEventListener('click', async (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn) return;
        if (!btn.dataset || btn.dataset.act !== 'save') return;
        await _savePopoverValue();
    });

    popover.addEventListener('keydown', async (ev) => {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            _closeQuotaAdjustPopover();
            return;
        }
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        await _savePopoverValue();
    });

    document.addEventListener('keydown', (ev) => {
        if (!ev || ev.key !== 'Escape') return;
        if (!popover || popover.style.display === 'none') return;
        ev.preventDefault();
        ev.stopPropagation();
        _closeQuotaAdjustPopover();
    }, true);

    popover.addEventListener('change', (ev) => {
        const target = ev && ev.target;
        if (!target) return;
        if (target.matches('[data-role="quota-adjust-mode"]')) {
            const inputEl = popover.querySelector('[data-role="quota-adjust-input"]');
            if (inputEl) {
                const mode = saveAdminQuotaAdjustModePreference(target.value || 'total');
                target.value = mode;
                const total = Math.max(0, parseInt(popover.dataset.totalTokens || 0, 10) || 0);
                const used = Math.max(0, parseInt(popover.dataset.usedTokens || 0, 10) || 0);
                const remaining = total > used ? (total - used) : 0;
                inputEl.value = mode === 'remaining' ? String(remaining) : String(total);
                inputEl.focus();
                inputEl.select();
            }
            _refreshQuotaAdjustPopoverHint(popover);
        }
    });

    popover.addEventListener('input', (ev) => {
        const target = ev && ev.target;
        if (!target) return;
        if (target.matches('[data-role="quota-adjust-input"]')) {
            _refreshQuotaAdjustPopoverHint(popover);
        }
    });

    document.body.appendChild(popover);
    return popover;
}

function _closeQuotaAdjustPopover() {
    const popover = document.getElementById('quotaAdjustPopover');
    if (!popover) return;
    if (_quotaAdjustPopoverFollowRaf) {
        cancelAnimationFrame(_quotaAdjustPopoverFollowRaf);
        _quotaAdjustPopoverFollowRaf = 0;
    }
    _quotaAdjustPopoverAnchorEl = null;
    _setActiveQuotaMeterWrap(null);
    popover.style.display = 'none';
    popover.dataset.provider = '';
    popover.dataset.model = '';
    popover.dataset.totalTokens = '';
    popover.dataset.usedTokens = '';
    popover.dataset.busy = '0';

    const modeEl = popover.querySelector('[data-role="quota-adjust-mode"]');
    if (modeEl) modeEl.value = loadAdminQuotaAdjustModePreference();
}

function _positionQuotaAdjustPopover(popover, anchorEl) {
    if (!popover || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    popover.style.left = '-9999px';
    popover.style.top = '-9999px';
    popover.style.display = 'block';

    const popRect = popover.getBoundingClientRect();
    const gap = 10;
    let left = rect.left + (rect.width / 2) - (popRect.width / 2);
    let top = rect.bottom + gap;

    if (left < 12) left = 12;
    if (left + popRect.width > window.innerWidth - 12) {
        left = window.innerWidth - popRect.width - 12;
    }
    if (top + popRect.height > window.innerHeight - 12) {
        top = rect.top - popRect.height - gap;
    }
    if (top < 12) top = 12;

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

function _refreshQuotaAdjustPopoverHint(popover) {
    const panel = popover || document.getElementById('quotaAdjustPopover');
    if (!panel) return;

    const hintEl = panel.querySelector('[data-role="quota-adjust-hint"]');
    const modeEl = panel.querySelector('[data-role="quota-adjust-mode"]');
    const inputEl = panel.querySelector('[data-role="quota-adjust-input"]');
    if (!hintEl || !modeEl || !inputEl) return;

    const mode = normalizeAdminQuotaAdjustMode(modeEl.value || 'total');
    const currentTotal = Math.max(0, parseInt(panel.dataset.totalTokens || 0, 10) || 0);
    const usedTokens = Math.max(0, parseInt(panel.dataset.usedTokens || 0, 10) || 0);
    const inputRaw = parseInt(inputEl.value || 0, 10);
    const inputValue = Math.max(0, Number.isFinite(inputRaw) ? inputRaw : 0);

    if (mode === 'remaining') {
        const nextTotal = Math.max(0, usedTokens + inputValue);
        const delta = nextTotal - currentTotal;
        const deltaText = delta > 0
            ? `增加 ${_formatQuotaTokens(delta, { unitMode: 'token' })}`
            : (delta < 0 ? `减少 ${_formatQuotaTokens(Math.abs(delta), { unitMode: 'token' })}` : '不变');
        hintEl.textContent = `剩余 ${_formatQuotaTokens(inputValue, { unitMode: 'token' })} => 总量 ${_formatQuotaTokens(nextTotal, { unitMode: 'token' })}（较当前${deltaText}）`;
        return;
    }

    const delta = inputValue - currentTotal;
    const deltaText = delta > 0
        ? `增加 ${_formatQuotaTokens(delta, { unitMode: 'token' })}`
        : (delta < 0 ? `减少 ${_formatQuotaTokens(Math.abs(delta), { unitMode: 'token' })}` : '不变');
    hintEl.textContent = `总量设为 ${_formatQuotaTokens(inputValue, { unitMode: 'token' })}（较当前${deltaText}）`;
}

function _mergeQuotaProvidersFromServerSnapshot(quotaPayload) {
    const quota = quotaPayload && typeof quotaPayload === 'object' ? quotaPayload : {};
    syncAdminQuotaActionFromPayload(quota);
    if (!Array.isArray(quota.providers)) return false;
    adminServerQuotaProvidersCache = quota.providers;
    return true;
}

function _applyLocalQuotaModelTotal(providerName, modelName, nextTotalTokens) {
    const providers = Array.isArray(adminServerQuotaProvidersCache) ? adminServerQuotaProvidersCache : [];
    if (!providers.length) return false;

    const providerNeedle = String(providerName || '').trim().toLowerCase();
    const modelNeedle = String(modelName || '').trim().toLowerCase();
    if (!providerNeedle || !modelNeedle) return false;

    const providerEntry = providers.find((row) => String((row && row.name) || '').trim().toLowerCase() === providerNeedle);
    if (!providerEntry || !Array.isArray(providerEntry.models)) return false;

    const modelEntry = providerEntry.models.find((row) => {
        const nameLower = String((row && row.name) || '').trim().toLowerCase();
        if (nameLower === modelNeedle) return true;
        const rawModel = String((row && row.model) || '').trim().toLowerCase();
        if (rawModel === modelNeedle) return true;
        const key = String((row && row.key) || '').trim().toLowerCase();
        return !!key && key.endsWith(`::${modelNeedle}`);
    });
    if (!modelEntry) return false;

    const nextTotal = Math.max(0, parseInt(nextTotalTokens || 0, 10) || 0);
    const used = Math.max(0, parseInt(modelEntry.tokens || 0, 10) || 0);
    modelEntry.quota_total_tokens = nextTotal;
    modelEntry.overage_tokens = used > nextTotal ? (used - nextTotal) : 0;
    return true;
}

async function _submitModelQuotaUpdate(op, provider, model, valueTokens, options = {}) {
    if (currentUserRole !== 'admin') {
        showToast('只有管理员可以管理模型额度');
        return;
    }

    const popover = _getQuotaAdjustPopover();
    if (popover.dataset.busy === '1') return;
    popover.dataset.busy = '1';

    try {
        const payload = {
            op,
            provider,
            model,
        };
        if (op === 'set') payload.total_tokens = Math.max(0, parseInt(valueTokens || 0, 10) || 0);
        else payload.delta_tokens = parseInt(valueTokens || 0, 10) || 0;

        const res = await fetch('/api/admin/quota/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '模型额度更新失败');
            return;
        }

        const nextTotal = Math.max(0, parseInt((data && data.change && data.change.after_total_tokens) != null ? data.change.after_total_tokens : valueTokens, 10) || 0);
        const merged = _mergeQuotaProvidersFromServerSnapshot(data && data.quota ? data.quota : null);
        const patched = merged ? true : _applyLocalQuotaModelTotal(provider, model, nextTotal);

        const successMessage = options && options.successMessage ? String(options.successMessage) : '模型额度已更新';
        showToast(successMessage);
        _closeQuotaAdjustPopover();
        if (patched && Array.isArray(adminServerQuotaProvidersCache)) {
            _renderServerQuotaProviderList(adminServerQuotaProvidersCache);
            renderAdminModelConfig({ preserveProviderList: true });
        } else {
            await loadServerQuotaSettings();
        }
    } catch (e) {
        showToast('模型额度更新失败');
    } finally {
        popover.dataset.busy = '0';
    }
}

function _openQuotaAdjustPopover(anchorEl, provider, model, totalTokens, usedTokens) {
    const popover = _getQuotaAdjustPopover();
    _setActiveQuotaMeterWrap(anchorEl || null);
    _quotaAdjustPopoverAnchorEl = anchorEl || null;
    popover.dataset.provider = String(provider || '').trim();
    popover.dataset.model = String(model || '').trim();
    const total = Math.max(0, parseInt(totalTokens || 0, 10) || 0);
    const used = Math.max(0, parseInt(usedTokens || 0, 10) || 0);
    const remaining = total > used ? (total - used) : 0;
    popover.dataset.totalTokens = String(total);
    popover.dataset.usedTokens = String(used);

    const targetEl = popover.querySelector('[data-role="quota-target"]');
    if (targetEl) targetEl.textContent = `${String(provider || '')}/${String(model || '')}`;

    const usedEl = popover.querySelector('[data-role="quota-used"]');
    if (usedEl) usedEl.textContent = `用 ${_formatQuotaTokens(used)} /`;

    const modeEl = popover.querySelector('[data-role="quota-adjust-mode"]');
    const mode = loadAdminQuotaAdjustModePreference();
    if (modeEl) modeEl.value = mode;

    const inputEl = popover.querySelector('[data-role="quota-adjust-input"]');
    if (inputEl) {
        inputEl.value = mode === 'remaining' ? String(remaining) : String(total);
        inputEl.focus();
        inputEl.select();
    }

    const hintEl = popover.querySelector('[data-role="quota-adjust-hint"]');
    if (hintEl) {
        hintEl.textContent = `当前剩余 ${_formatQuotaTokens(remaining)}，当前总量 ${_formatQuotaTokens(total)}`;
    }

    _refreshQuotaAdjustPopoverHint(popover);
    _positionQuotaAdjustPopover(popover, anchorEl);
}

function _bindQuotaTotalButtons() {
    const container = document.getElementById('quotaProviderList');
    if (!container) return;
    container.querySelectorAll('.quota-total-icon-btn').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const provider = String(btn.dataset.provider || '').trim();
            const model = String(btn.dataset.model || '').trim();
            const total = Math.max(0, parseInt(btn.dataset.totalTokens || 0, 10) || 0);
            const used = Math.max(0, parseInt(btn.dataset.usedTokens || 0, 10) || 0);
            if (!provider || !model) return;
            _openQuotaAdjustPopover(btn, provider, model, total, used);
        });
    });
}

function _bindQuotaProviderOverageSelects() {
    const container = document.getElementById('quotaProviderList');
    if (!container) return;

    container.querySelectorAll('.quota-provider-overage-select').forEach((selectEl) => {
        selectEl.addEventListener('change', async (e) => {
            const target = e && e.target ? e.target : selectEl;
            if (!target) return;
            const provider = normalizeAdminProviderKey(target.dataset.provider || '');
            if (!provider) return;
            const requested = normalizeAdminQuotaOnExhaustedAction(target.value || 'disable_model');
            target.disabled = true;
            try {
                const result = await saveAdminProviderOverageActionSetting(provider, requested);
                target.value = normalizeAdminQuotaOnExhaustedAction((result && result.action) || requested);
            } finally {
                target.disabled = false;
            }
        });
    });
}

function _renderServerQuotaProviderList(providerList) {
    const container = document.getElementById('quotaProviderList');
    if (!container) return;
    const providers = (Array.isArray(providerList) ? providerList : []).filter((provider) => {
        const providerName = String((provider && provider.name) || '').trim().toLowerCase();
        return !!providerName && providerName !== 'unknown';
    });

    if (!providers.length) {
        container.innerHTML = '<div class="settings-field" style="padding: 12px 14px;">暂无 token 使用记录</div>';
        return;
    }

    container.innerHTML = providers.map((provider) => {
        const providerName = String(provider.name || 'unknown');
        const providerIconProvider = resolveAdminProviderIconProvider(providerName);
        const providerTokens = Math.max(0, parseInt(provider.tokens || 0, 10) || 0);
        const providerAction = resolveAdminProviderOverageAction(providerName, provider && provider.on_exhausted ? provider.on_exhausted : adminQuotaDefaultOverageAction);
        const providerActionOptions = [
            ['no_op', '无操作'],
            ['disable_model', '停用模型'],
            ['notify_admin', '发送通知'],
            ['disable_and_notify', '停用并发送通知'],
        ].map(([value, label]) => {
            const selected = providerAction === value ? ' selected' : '';
            return `<option value="${value}"${selected}>${label}</option>`;
        }).join('');
        const providerRows = (Array.isArray(provider.models) ? provider.models : []).filter((model) => {
            const modelName = String((model && model.name) || '').trim().toLowerCase();
            return !!modelName && modelName !== 'unknown';
        });
        const maxOverageRaw = Math.max(0, ...providerRows.map((row) => {
            const rowTokens = Math.max(0, parseInt((row && row.tokens) || 0, 10) || 0);
            const rowTotal = Math.max(0, parseInt((row && row.quota_total_tokens) || 0, 10) || 0);
            const rowOverage = Math.max(0, parseInt((row && row.overage_tokens) || 0, 10) || 0);
            if (rowOverage > 0) return rowOverage;
            if (rowTotal <= 0 && rowTokens > 0) return rowTokens;
            return 0;
        }));
        const providerDebtScale = _roundQuotaDebtScale(maxOverageRaw);

        const modelsHtml = providerRows.length
            ? providerRows.map((model) => {
                const modelName = String(model.name || 'unknown');
                const modelIconProvider = resolveAdminModelIconProvider(modelName, providerName);
                const modelTokens = Math.max(0, parseInt(model.tokens || 0, 10) || 0);
                const modelTotal = Math.max(0, parseInt(model.quota_total_tokens || 0, 10) || 0);
                const modelOverageRaw = Math.max(0, parseInt(model.overage_tokens || 0, 10) || 0);
                const modelOverage = modelOverageRaw > 0
                    ? modelOverageRaw
                    : (modelTotal <= 0 && modelTokens > 0 ? modelTokens : 0);
                return `
                    <div class="quota-model-row">
                        <div class="quota-model-head">
                            <div class="quota-model-head-main">
                                <div class="quota-model-icon-cell">
                                    ${renderProviderIconHtml(modelIconProvider, { className: 'quota-model-icon', label: modelName })}
                                </div>
                                <div class="quota-model-name">${escapeHtml(modelName)}</div>
                            </div>
                            <button
                                type="button"
                                class="quota-total-icon-btn"
                                data-provider="${escapeHtml(providerName)}"
                                data-model="${escapeHtml(modelName)}"
                                data-total-tokens="${modelTotal}"
                                data-used-tokens="${modelTokens}"
                                title="设置额度"
                                style="width:30px; height:30px; border:1px solid #cbd5e1; border-radius:8px; background:#ffffff; color:#0f172a; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;"
                            >
                                <i class="fa-solid fa-pen-to-square" style="font-size:12px;"></i>
                            </button>
                        </div>
                        <div style="margin-top: 8px;">${_buildQuotaReverseOverflowMeterHtml(modelTokens, modelTotal, modelOverage, providerDebtScale)}</div>
                    </div>
                `;
            }).join('')
            : '<div class="settings-field" style="padding: 10px 12px;">该 Provider 暂无模型记录</div>';

        return `
            <div class="quota-provider-card">
                <div class="quota-provider-head">
                    <div class="quota-provider-head-main">
                        <div class="quota-provider-icon-cell">
                            ${renderProviderIconHtml(providerIconProvider, { className: 'quota-provider-icon', label: providerName })}
                        </div>
                        <div class="quota-provider-title">${escapeHtml(providerName)}</div>
                    </div>
                    <div class="quota-provider-head-right">
                        <div class="quota-provider-stats">用 ${_formatQuotaTokens(providerTokens)} · 负债满刻度 ${_formatQuotaTokens(providerDebtScale)}</div>
                        <div class="quota-provider-overage-action-inline">
                            <label>超额策略</label>
                            <select class="input-modern quota-provider-overage-select" data-provider="${escapeHtml(providerName)}" title="设置 ${escapeHtml(providerName)} 的超额策略">
                                ${providerActionOptions}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="quota-model-list">
                    ${modelsHtml}
                </div>
            </div>
        `;
    }).join('');

    _bindQuotaProviderOverageSelects();
    _bindQuotaTotalButtons();
    _ensureQuotaMeterLayoutEvents();
    _layoutQuotaMeterLabels(container);
}

async function loadServerQuotaSettings() {
    if (currentUserRole !== 'admin') return;
    const providerList = document.getElementById('quotaProviderList');

    const unitSelect = document.getElementById('adminQuotaUnitSelect');
    if (unitSelect) {
        unitSelect.value = adminQuotaDisplayUnit;
    }

    if (providerList) {
        providerList.innerHTML = '<div class="settings-field" style="padding: 12px 14px;">加载中...</div>';
    }

    try {
        const res = await fetch('/api/admin/quota');
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.message || '加载服务器额度失败');
        }

        const quota = data.quota || {};
        syncAdminQuotaActionFromPayload(quota);
        adminServerQuotaProvidersCache = Array.isArray(quota.providers) ? quota.providers : [];
        _closeQuotaAdjustPopover();
        _renderServerQuotaProviderList(adminServerQuotaProvidersCache);
        renderAdminModelConfig({ preserveProviderList: true });
    } catch (e) {
        adminServerQuotaProvidersCache = [];
        if (providerList) {
            providerList.innerHTML = `<div class="settings-field" style="padding: 12px 14px; color: #ef4444;">${escapeHtml(e && e.message ? e.message : '加载服务器额度失败')}</div>`;
        }
        _closeQuotaAdjustPopover();
        renderAdminModelConfig({ preserveProviderList: true });
    }
}


// ─── ESM 兼容：跨模块裸引用的状态变量必须 live-binding ───
// 经典 script 时代顶层 let 处于全局词法作用域，其他文件可裸引用实时读写；
// 模块化后为模块作用域，window.X = X 只会固化当时的值，必须用 getter/setter 桥接
function exposeLiveState(prop, get, set) {
    Object.defineProperty(window, prop, { get, set, configurable: true });
}
// currentConversationId 已在声明处桥接到 store.conversation，此处不再重复绑定
exposeLiveState('currentUsername', () => currentUsername, (v) => { currentUsername = v; });
exposeLiveState('shouldAutoScroll', () => shouldAutoScroll, (v) => { shouldAutoScroll = v; });
exposeLiveState('isUploadingFiles', () => isUploadingFiles, (v) => { isUploadingFiles = v; });

exposeLiveState('activeNexoraCodeProjectId', () => activeNexoraCodeProjectId, (v) => { activeNexoraCodeProjectId = v; });
exposeLiveState('browserModelConfigSyncTimer', () => browserModelConfigSyncTimer, (v) => { browserModelConfigSyncTimer = v; });
exposeLiveState('browserOllamaStatusProviders', () => browserOllamaStatusProviders, (v) => { browserOllamaStatusProviders = v; });
exposeLiveState('browserSyncManuallyClosed', () => browserSyncManuallyClosed, (v) => { browserSyncManuallyClosed = v; });
exposeLiveState('browserSyncPingTimer', () => browserSyncPingTimer, (v) => { browserSyncPingTimer = v; });
exposeLiveState('browserSyncReconnectTimer', () => browserSyncReconnectTimer, (v) => { browserSyncReconnectTimer = v; });
exposeLiveState('browserSyncSocket', () => browserSyncSocket, (v) => { browserSyncSocket = v; });
exposeLiveState('lastAgentStatusWsReceivedAt', () => lastAgentStatusWsReceivedAt, (v) => { lastAgentStatusWsReceivedAt = v; });
exposeLiveState('navigationStack', () => navigationStack, (v) => { navigationStack = v; });
exposeLiveState('nexoraCodeHiddenProjectIds', () => nexoraCodeHiddenProjectIds, (v) => { nexoraCodeHiddenProjectIds = v; });
exposeLiveState('nexoraCodeProjectRecords', () => nexoraCodeProjectRecords, (v) => { nexoraCodeProjectRecords = v; });
exposeLiveState('nexoraCodeProjectsLoadedForUser', () => nexoraCodeProjectsLoadedForUser, (v) => { nexoraCodeProjectsLoadedForUser = v; });
exposeLiveState('originalHeaderState', () => originalHeaderState, (v) => { originalHeaderState = v; });
exposeLiveState('browserSyncSocketSerial', () => browserSyncSocketSerial, (v) => { browserSyncSocketSerial = v; });
exposeLiveState('pendingAvatarDataUrl', () => pendingAvatarDataUrl, (v) => { pendingAvatarDataUrl = v; });

// ─── P1: 供 chat_lifecycle.js import 的函数引用 ───
export {
    __messagesBottomPinUntilTs,
    __messagesLastObservedScrollTop,
    __messagesUserScrollIntentUntilTs,
    _isJumping,
    _syncTurnIndicatorVisibility,
    adminOllamaModelStatusCache,
    adminSettingsEventsController,
    appendDebugConsoleEntry,
    applyAvatarCropAndPreview,
    applyComposerPrefsFromStorage,
    applyDesktopHeaderTools,
    applyKnowledgeSettings,
    applyLearningFeedMentionSelection,
    applyLearningMode,
    applyLearningSidebarMode,
    applyNotesMobilePanelPosition,
    applyTokenMiniDisplay,
    authRedirectInProgress,
    bindBackdropSafeClose,
    bindDebugConsoleUi,
    bindFloatingPanelFront,
    bindGeneratedImageViewportLimit,
    bindImageViewerEvents,
    bindInputCollapseBtn,
    bindInputFileDropUpload,
    bindMobileHeaderMenu,
    bindPinContextMenu,
    bindSourceMarkdown,
    bindStructuredCopyForSelectableArea,
    bindToolsModeDropdown,
    bindTrashModal,
    breakMessagesAutoScroll,
    bringFloatingPanelToFront,
    BROWSER_MODEL_CONFIG_SYNC_MS,
    BROWSER_SYNC_PING_MS,
    BROWSER_SYNC_RECONNECT_MS,
    browserSyncSocketSerial,
    bulkVectorizeAllBasis,
    cancelCurrentFileUpload,
    captureActiveSelectionForMobileScrollLock,
    captureChatHeaderBaseState,
    chatModelConfigSyncState,
    checkUserRole,
    clearActiveStreamResumeState,
    clearAllStreamAttachRetries,
    clearHoverProxyMessage,
    clearMailViewUrl,
    closeAddUserModal,
    closeAvatarCropModal,
    closeCloudFilePanel,
    closeKnowledgePanel,
    closeKnowledgeSearchModal,
    closeKnowledgeSearchResultView,
    closeKnowledgeSettingsModal,
    closeKnowledgeView,
    closeMobileHeaderMenu,
    closeMobileSidebar,
    closeSettingsModal,
    closeSkillEditorModal,
    closeWorkspaceKnowledgeView,
    collapseDesktopSidebarByOutsideInteraction,
    confirmDeleteKnowledge,
    confirmModalAsync,
    conversationListController,
    copyShareUrl,
    createBlankBasisKnowledge,
    createNewConversation,
    currentUsername,
    deleteConversation,
    deleteMessage,
    deleteVectorInSettings,
    downloadCloudFile,
    els,
    enqueueClientToolWssRequest,
    ensureAdminPublicApiLayout,
    ensureAuthenticatedSession,
    ensureConversationMessageIndexLoaded,
    ensureMessageInputFocus,
    escapeHtml,
    exportKnowledgeToWord,
    extractFilesFromClipboardEvent,
    flushDeferredMailEvents,
    flushNotesCloudSync,
    focusMessageInputFromGesture,
    forceContextCompressionOnce,
    formatFileSize,
    getActiveKnowledgeShareUsername,
    getChatProviderApiType,
    getCloudFileDisplayName,
    getCloudFileExtension,
    getDefaultAvatarDataUrl,
    getDirectConversationUrlTarget,
    getLearningSidebarView,
    getMessageElementByIndex,
    getNexoraChatTools,
    handleBackdropStackingChange,
    handleBrowserMailChangedEvent,
    handleCloudFilePanelUploadChange,
    handleFileUpload,
    handleFileUploadFiles,
    handleKnowledgeSearch,
    hasConversationUrlTarget,
    hideNexoraCodeProject,
    hideNotesContextMenu,
    hidePinContextMenu,
    highlightCode,
    hydrateConversationStreamStatesFromStorage,
    initMailUiState,
    initNotesUi,
    installAuthFetchGuard,
    isChatMobileLayout,
    isCloudFileImage,
    isEditableScrollIntentTarget,
    isHoverProxySuppressedBySelection,
    isLearningReaderHostActive,
    isMailMobileLayout,
    isMailViewUrl,
    isMessagesNearBottom,
    isMobileKeyboardLikelyOpen,
    isSidebarOverlayLayout,
    jumpToChatSource,
    keepSelectionStableOnMobileScroll,
    knowledgeController,
    knowledgeEditorController,
    knowledgeSidebarController,
    lastAgentOnline,
    lastMessageInputGestureTs,
    learningEmbedLayoutMode,
    learningFeedComposeMode,
    learningFeedMentionState,
    learningModeEnabled,
    learningNavigationState,
    learningSidebarDraftValue,
    learningSidebarMode,
    loadActiveStreamResumeState,
    loadCloudFiles,
    loadConversation,
    loadConversations,
    loadCurrentUserIdentity,
    loadCurrentUserPreferences,
    loadFileCenterFiles,
    loadKnowledge,
    loadMessageDraftFromStorage,
    loadModels,
    loadSkillSettings,
    logoutRequestInFlight,
    markMessagesUserScrollIntent,
    maybeLoadPreviousConversationMessagesFromScroll,
    messageActionsController,
    MESSAGES_AUTO_SCROLL_BREAK_UP_PX,
    mobileSelectionScrollGuard,
    normalizeFileReferencePath,
    NOTES_COMPANION_MODE,
    notesCloudSyncPendingStore,
    notesCloudSyncTimer,
    notesState,
    notifyLearningSidebarBridge,
    ollamaChatProviderStatusCache,
    openAddUserModal,
    openAvatarCropModal,
    openFileCenterFileDetail,
    openKnowledgeSettingsModal,
    openLearningDashboardSurface,
    openLearningStudioSurface,
    openMailPlaceholderView,
    openSettingsModal,
    openTokenModal,
    openTrashModal,
    pinContextMenuBusy,
    pinContextMenuState,
    positionMobileHeaderMenuPanel,
    providerCatalogByKey,
    readMessageMemoryIoTokens,
    rebindHeaderActionButtons,
    refreshChatOllamaStatusIndicators,
    refreshMailEntryVisibility,
    refreshWorkflowSidebarToggleState,
    registerModalBackdropStacking,
    renderAdminModelConfig,
    renderCloudFileCardMedia,
    renderConversationList,
    renderLearningFeedMentionMenu,
    renderLearningMainPanel,
    renderMarkdownForNotes,
    renderMarkdownWithNewTabLinks,
    renderMathInElementSyncPreferred,
    renderMathSafe,
    renderMessages,
    renderTokenBudgetUi,
    renderWelcomeScreen,
    requestLogoutAndRedirect,
    resetAvatarCropPosition,
    resetConversationListRenderSignature,
    resetLearningFeedMentionState,
    resetTokenBudgetBreakdown,
    resizeMessageInput,
    restoreWorkspaceDetailInputContainerForConversationLoad,
    resumeActiveStreamAfterReload,
    returnToLearningConversationList,
    rewriteHtmlDocumentLinksToNewTab,
    saveComposerPrefsToStorage,
    saveDefaultOpenViewPreference,
    saveKnowledge,
    saveLearningModePreference,
    saveMessageDraftToStorage,
    saveSkillEditorModal,
    saveUserProfile,
    scheduleTurnIndicatorActiveUpdate,
    searchChroma,
    selectWorkflowNode,
    sendMessage,
    setActiveNexoraCodeProject,
    setDesktopAgentIndicatorState,
    setFileUploadProgress,
    setInputContainerCollapsed,
    setLearningPracticeMenuOpen,
    setLearningResourceStudioMenuOpen,
    setMailDetailOpen,
    setMessagesLastObservedScrollTop,
    setShouldAutoScroll,
    SETTINGS_COMPANION_MODE,
    setWorkflowDesignerTitle,
    setWorkflowMainMode,
    setWorkflowSidebarActiveWorkflow,
    shouldAutoScroll,
    showConfirm,
    showToast,
    startAgentStatusHttpFallback,
    startAgentStatusPolling,
    startClientToolPolling,
    startConversationStreamStatusSync,
    startMailRealtimeSync,
    startNewLearningConversation,
    startStoredStreamSessionMonitors,
    stopBrowserSyncSocket,
    stopClientToolPolling,
    stopConversationStreamStatusSync,
    stopGeneration,
    stopMailRealtimeSync,
    stopMobileSelectionScrollTracking,
    submitAddUser,
    switchToLearningSidebar,
    switchToNexoraSidebar,
    syncBrowserOllamaStatus,
    syncGenerationStateForCurrentConversation,
    syncLearningHeaderMode,
    toggleContextIncludeMode,
    toggleKnowledgePanel,
    toggleMobileSidebar,
    tokenBudgetState,
    trashViewState,
    updateHoverProxyFromClientY,
    updateLearningFeedMentionCandidates,
    updateMessageModelBadge,
    updateMobileMessageInputViewportBaseline,
    updateMobileSelectionQuickAdd,
    updateSendButtonState,
    updateVectorInSettings,
    updateWorkflowCanvasScale,
    uploadSingleFileWithProgress,
    viewKnowledge,
};
