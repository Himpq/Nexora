/**
 * chat_lifecycle.js — 全局副作用与 window 桥接集中注册
 *
 * 职责：集中注册跨模块 window 桥接（live-binding 状态 + 函数引用），
 *       收编 chat.js:29627-29696 桥接注册区；提供 exposeLiveState 工具。
 *
 * 对外 window 桥接清单：
 *   - P1 迁入：chat.js:29640-29696 函数引用桥接 55 处
 *   - 待 P3-P11 迁入：live-binding 状态 3 处（currentUsername/shouldAutoScroll/isUploadingFiles）
 *   - 待 P12-P17 迁入：其余散落桥接
 *
 * 依赖 store 子域：
 *   - 无（桥接仅透传各域模块的 getter/setter 与函数引用）
 *
 * 设计形态：函数式（桥接注册为一次性副作用，无实例状态）
 */
import {
    confirmModalAsync,
    escapeHtml,
    getDefaultAvatarDataUrl,
    rewriteHtmlDocumentLinksToNewTab,
    showToast,
    closeKnowledgeView,
    bindSourceMarkdown,
    highlightCode,
    renderMarkdownWithNewTabLinks,
    renderMathSafe,
    createNewConversation,
    jumpToChatSource,
    loadConversation,
    loadFileCenterFiles,
    openFileCenterFileDetail,
    viewKnowledge,
    _syncTurnIndicatorVisibility,
    applyDesktopHeaderTools,
    bindBackdropSafeClose,
    formatFileSize,
    getCloudFileDisplayName,
    getCloudFileExtension,
    handleBackdropStackingChange,
    hideNotesContextMenu,
    hidePinContextMenu,
    isCloudFileImage,
    loadCloudFiles,
    registerModalBackdropStacking,
    renderCloudFileCardMedia,
    renderMessages,
    setFileUploadProgress,
    setInputContainerCollapsed,
    updateSendButtonState,
    uploadSingleFileWithProgress,
    closeKnowledgeSearchResultView,
    confirmDeleteKnowledge,
    exportKnowledgeToWord,
    openKnowledgeSettingsModal,
    saveKnowledge,
    getActiveKnowledgeShareUsername,
    closeWorkspaceKnowledgeView,
    isSidebarOverlayLayout,
    closeMobileHeaderMenu,
    loadSkillSettings,
    renderLearningMainPanel,
    closeKnowledgeSearchModal,
    closeKnowledgeSettingsModal,
    applyKnowledgeSettings,
    copyShareUrl,
    updateVectorInSettings,
    deleteVectorInSettings,
    searchChroma,
    closeSettingsModal,
    closeSkillEditorModal,
    saveSkillEditorModal,
} from './chat.js?v=20260819_toast_unify_01';


/**
 * 将模块作用域内的状态变量以 getter/setter 形式 live-binding 到 window。
 *
 * 经典 script 时代顶层 let 处于全局词法作用域，其他文件可裸引用实时读写；
 * 模块化后为模块作用域，window.X = X 只会固化当时的值，必须用 getter/setter 桥接。
 *
 * @param {string} prop - window 上的属性名
 * @param {() => any} get - 读取闭包变量的 getter
 * @param {(v: any) => void} set - 写入闭包变量的 setter
 */
export function exposeLiveState(prop, get, set) {

    Object.defineProperty(window, prop, { get, set, configurable: true });
}


/**
 * 批量注册函数引用桥接到 window。
 *
 * @param {Record<string, Function>} bridges - 桥接名 → 函数 的映射
 */
export function registerBridges(bridges) {

    for (const [name, fn] of Object.entries(bridges)) {

        window[name] = fn;
    }
}


/**
 * 注册全局副作用（如全局事件监听、一次性补丁）。
 * 待 P2 阶段填充实现。
 */
export function registerGlobalSideEffects() {

    // 待 P2 填充
}


// ─── ESM 兼容：函数引用桥接（P1 阶段从 chat.js:29640-29696 迁入） ───
// 被 chat_mails.js / workspace.js / global_search.js / chat_token_details.js / chat_knowledge.js 裸调用
window.confirmModalAsync = confirmModalAsync;
window.escapeHtml = escapeHtml;
window.getDefaultAvatarDataUrl = getDefaultAvatarDataUrl;
window.rewriteHtmlDocumentLinksToNewTab = rewriteHtmlDocumentLinksToNewTab;
window.showToast = showToast;
window.closeKnowledgeView = closeKnowledgeView;
window.bindSourceMarkdown = bindSourceMarkdown;
window.highlightCode = highlightCode;
window.renderMarkdownWithNewTabLinks = renderMarkdownWithNewTabLinks;
window.renderMathSafe = renderMathSafe;
window.createNewConversation = createNewConversation;
window.jumpToChatSource = jumpToChatSource;
window.loadConversation = loadConversation;
window.loadFileCenterFiles = loadFileCenterFiles;
window.openFileCenterFileDetail = openFileCenterFileDetail;
window.viewKnowledge = viewKnowledge;
window._syncTurnIndicatorVisibility = _syncTurnIndicatorVisibility;
window.applyDesktopHeaderTools = applyDesktopHeaderTools;
window.bindBackdropSafeClose = bindBackdropSafeClose;
window.formatFileSize = formatFileSize;
window.getCloudFileDisplayName = getCloudFileDisplayName;
window.getCloudFileExtension = getCloudFileExtension;
window.handleBackdropStackingChange = handleBackdropStackingChange;
window.hideNotesContextMenu = hideNotesContextMenu;
window.hidePinContextMenu = hidePinContextMenu;
window.isCloudFileImage = isCloudFileImage;
window.loadCloudFiles = loadCloudFiles;
window.registerModalBackdropStacking = registerModalBackdropStacking;
window.renderCloudFileCardMedia = renderCloudFileCardMedia;
window.renderMessages = renderMessages;
window.setFileUploadProgress = setFileUploadProgress;
window.setInputContainerCollapsed = setInputContainerCollapsed;
window.updateSendButtonState = updateSendButtonState;
window.uploadSingleFileWithProgress = uploadSingleFileWithProgress;
window.closeKnowledgeSearchResultView = closeKnowledgeSearchResultView;
window.confirmDeleteKnowledge = confirmDeleteKnowledge;
window.exportKnowledgeToWord = exportKnowledgeToWord;
window.openKnowledgeSettingsModal = openKnowledgeSettingsModal;
window.saveKnowledge = saveKnowledge;
window.getActiveKnowledgeShareUsername = getActiveKnowledgeShareUsername;
window.closeWorkspaceKnowledgeView = closeWorkspaceKnowledgeView;
// 被其他模块通过 window.xxx + typeof 守卫调用（此前静默失效）
window.isSidebarOverlayLayout = isSidebarOverlayLayout;
window.closeMobileHeaderMenu = closeMobileHeaderMenu;
window.loadSkillSettings = loadSkillSettings;
window.renderLearningMainPanel = renderLearningMainPanel;
// 内联 onclick 引用
window.closeKnowledgeSearchModal = closeKnowledgeSearchModal;
window.closeKnowledgeSettingsModal = closeKnowledgeSettingsModal;
window.applyKnowledgeSettings = applyKnowledgeSettings;
window.copyShareUrl = copyShareUrl;
window.updateVectorInSettings = updateVectorInSettings;
window.deleteVectorInSettings = deleteVectorInSettings;
window.searchChroma = searchChroma;
window.closeSettingsModal = closeSettingsModal;
window.closeSkillEditorModal = closeSkillEditorModal;
window.saveSkillEditorModal = saveSkillEditorModal;
