/**
 * chat_app.js — 应用引导与初始化编排
 *
 * 职责：独占 DOMContentLoaded 主入口，按固定顺序编排应用初始化：
 *       认证守卫 → 加载偏好 → initUI → 加载模型 → 会话恢复 → 流恢复。
 *
 * 对外 window 桥接清单：
 *   - 无（编排入口不对外桥接）
 *
 * 依赖 store 子域：
 *   - store.conversation / store.user / store.model / store.stream
 *
 * 设计形态：函数式（编排为一次性流程，无实例状态）
 */
import { store } from './store/index.js';
import {
    MESSAGES_AUTO_SCROLL_BREAK_UP_PX,
    NOTES_COMPANION_MODE,
    SETTINGS_COMPANION_MODE,
    __messagesBottomPinUntilTs,
    __messagesLastObservedScrollTop,
    __messagesUserScrollIntentUntilTs,
    _isJumping,
    adminSettingsEventsController,
    applyAvatarCropAndPreview,
    applyComposerPrefsFromStorage,
    applyLearningFeedMentionSelection,
    applyLearningMode,
    applyLearningSidebarMode,
    applyNotesMobilePanelPosition,
    applyTokenMiniDisplay,
    bindBackdropSafeClose,
    bindDebugConsoleUi,
    bindGeneratedImageViewportLimit,
    bindImageViewerEvents,
    bindInputCollapseBtn,
    bindInputFileDropUpload,
    bindMobileHeaderMenu,
    bindPinContextMenu,
    bindStructuredCopyForSelectableArea,
    bindToolsModeDropdown,
    bindTrashModal,
    breakMessagesAutoScroll,
    bulkVectorizeAllBasis,
    cancelCurrentFileUpload,
    captureActiveSelectionForMobileScrollLock,
    captureChatHeaderBaseState,
    checkUserRole,
    clearAllStreamAttachRetries,
    clearHoverProxyMessage,
    clearMailViewUrl,
    closeAddUserModal,
    closeAvatarCropModal,
    closeCloudFilePanel,
    closeKnowledgePanel,
    closeMobileHeaderMenu,
    closeMobileSidebar,
    closeSettingsModal,
    closeSkillEditorModal,
    collapseDesktopSidebarByOutsideInteraction,
    createBlankBasisKnowledge,
    createNewConversation,
    els,
    ensureAdminPublicApiLayout,
    ensureAuthenticatedSession,
    ensureMessageInputFocus,
    extractFilesFromClipboardEvent,
    flushDeferredMailEvents,
    flushNotesCloudSync,
    focusMessageInputFromGesture,
    getDirectConversationUrlTarget,
    getLearningSidebarView,
    handleCloudFilePanelUploadChange,
    handleFileUpload,
    handleFileUploadFiles,
    handleKnowledgeSearch,
    hasConversationUrlTarget,
    hydrateConversationStreamStatesFromStorage,
    initMailUiState,
    initNotesUi,
    installAuthFetchGuard,
    isChatMobileLayout,
    isEditableScrollIntentTarget,
    isHoverProxySuppressedBySelection,
    isMailMobileLayout,
    isMailViewUrl,
    isMessagesNearBottom,
    isMobileKeyboardLikelyOpen,
    isSidebarOverlayLayout,
    keepSelectionStableOnMobileScroll,
    lastMessageInputGestureTs,
    learningFeedComposeMode,
    learningFeedMentionState,
    learningModeEnabled,
    learningSidebarMode,
    loadActiveStreamResumeState,
    loadCloudFiles,
    loadConversation,
    loadConversations,
    loadCurrentUserPreferences,
    loadKnowledge,
    loadMessageDraftFromStorage,
    loadModels,
    markMessagesUserScrollIntent,
    maybeLoadPreviousConversationMessagesFromScroll,
    mobileSelectionScrollGuard,
    notesCloudSyncPendingStore,
    notesCloudSyncTimer,
    notesState,
    openAddUserModal,
    openAvatarCropModal,
    openLearningDashboardSurface,
    openLearningStudioSurface,
    openMailPlaceholderView,
    openSettingsModal,
    openTokenModal,
    openTrashModal,
    positionMobileHeaderMenuPanel,
    rebindHeaderActionButtons,
    refreshMailEntryVisibility,
    renderLearningFeedMentionMenu,
    renderTokenBudgetUi,
    requestLogoutAndRedirect,
    resetAvatarCropPosition,
    resetLearningFeedMentionState,
    resetTokenBudgetBreakdown,
    resizeMessageInput,
    resumeActiveStreamAfterReload,
    returnToLearningConversationList,
    saveComposerPrefsToStorage,
    saveDefaultOpenViewPreference,
    saveLearningModePreference,
    saveMessageDraftToStorage,
    saveSkillEditorModal,
    saveUserProfile,
    scheduleTurnIndicatorActiveUpdate,
    sendMessage,
    setActiveNexoraCodeProject,
    setLearningPracticeMenuOpen,
    setLearningResourceStudioMenuOpen,
    setMailDetailOpen,
    setMessagesLastObservedScrollTop,
    setShouldAutoScroll,
    shouldAutoScroll,
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
    updateHoverProxyFromClientY,
    updateLearningFeedMentionCandidates,
    updateMobileMessageInputViewportBaseline,
    updateMobileSelectionQuickAdd,
} from './chat.js?v=20260819_toast_unify_01';

// 设置弹窗 Esc 关闭处理器是否已绑定：唯一读写方为本模块，状态收敛于此。
let settingsModalEscapeHandlerBound = false;

// 输入法组合输入中标记：唯一读写方为本模块，状态收敛于此。
let isMessageInputComposing = false;

async function bootstrap() {
    installAuthFetchGuard();
    // 认证检查 + 偏好加载并行
    const [authed, prefs] = await Promise.all([
        ensureAuthenticatedSession(),
        loadCurrentUserPreferences().catch(() => null),
    ]);
    if (!authed) return;
    initUI();
    if (NOTES_COMPANION_MODE) {
        return;
    }
    if (SETTINGS_COMPANION_MODE) {
        return;
    }
    loadModels({
        contextRefresh: 'cache',
        refreshContextAfterLoad: true
    });
    hydrateConversationStreamStatesFromStorage();
    const urlParams = new URLSearchParams(window.location.search || '');
    const hasConversationTargetInUrl = hasConversationUrlTarget(urlParams);

    // 流恢复目标与 URL cid 同属"待导航会话"：默认打开视图必须让位给它们，
    // 否则默认视图先展示 learning 侧栏，会话导航随后切回 nexora，加载时一闪而过。
    const resumeState = loadActiveStreamResumeState();
    const resumeCid = resumeState ? String(resumeState.conversation_id || '').trim() : '';

    // applyLearningMode 内部同步部分会立即设置 learningModeEnabled 等状态，
    // 异步部分（资产加载）在后台进行，不阻塞对话加载。
    const learningPromise = applyLearningMode(!!(prefs && prefs.learning_mode), {
        suppressAutoLearningOpen: hasConversationTargetInUrl || !!resumeCid
    })
        .catch(err => console.error('初始化学习模式失败:', err));

    // Check URL param for conversation ID
    let cid = getDirectConversationUrlTarget(urlParams);
    const mailEntryCanOpen = await refreshMailEntryVisibility();
    const shouldRestoreMailView = isMailViewUrl() && mailEntryCanOpen;
    if (isMailViewUrl() && !mailEntryCanOpen) {
        clearMailViewUrl();
    }

    if (shouldRestoreMailView) {
        loadConversations();
        setTimeout(() => openMailPlaceholderView(), 0);
    } else {
        if (!cid && resumeCid && !isGenerating) {
            // Forward to resumed conversation to prevent double loading the UI
            cid = resumeCid;
            if (window.history.replaceState) window.history.replaceState({}, '', `/chat?cid=${cid}`);
        }

        if (cid) {
            await loadConversation(cid, {
                deferStreamAttach: !!(resumeCid && cid === resumeCid)
            });
        } else {
            await learningPromise;

            loadConversations();
            applyTokenMiniDisplay(0, 0);
            tokenBudgetState.roundInput = 0;
            resetTokenBudgetBreakdown();
            renderTokenBudgetUi();
            // Init load knowledge even without conversation
            await loadKnowledge(null);
        }
    }
    await learningPromise;
    await resumeActiveStreamAfterReload();
    startStoredStreamSessionMonitors({
        skipConversationId: String(currentConversationId || '').trim()
    });
    startConversationStreamStatusSync();
    syncGenerationStateForCurrentConversation();
}

function initUI() {
    captureChatHeaderBaseState();
    ensureAdminPublicApiLayout();
    bindGeneratedImageViewportLimit();
    bindImageViewerEvents();
    bindToolsModeDropdown();
    bindInputCollapseBtn();
    applyComposerPrefsFromStorage();
    bindMobileHeaderMenu();
    bindDebugConsoleUi();
    initNotesUi();
    bindStructuredCopyForSelectableArea();
    renderTokenBudgetUi();
    if (NOTES_COMPANION_MODE) {
        return;
    }
    bindPinContextMenu();
    initMailUiState();
    void refreshMailEntryVisibility();
    
    setTimeout(async () => {
        if (await refreshMailEntryVisibility()) {
            startMailRealtimeSync();
        }
        startClientToolPolling();
        startAgentStatusPolling(); // Agent WSS
        startAgentStatusHttpFallback(); // WSS 不可用时的 HTTP 兜底
    }, 1500);

    window.addEventListener('beforeunload', () => {
        stopMailRealtimeSync();
        stopClientToolPolling();
        stopBrowserSyncSocket();
        stopConversationStreamStatusSync();
        clearAllStreamAttachRetries();
        if (notesCloudSyncTimer) {
            clearTimeout(notesCloudSyncTimer);
            notesCloudSyncTimer = null;
        }
        if (notesCloudSyncPendingStore) {
            // 页面关闭前尽量触发一次异步提交；浏览器可能中断请求，后续仍会以云端为准。
            void flushNotesCloudSync();
        }
    });
    window.addEventListener('pageshow', async (e) => {
        if (e && e.persisted) {
            await ensureAuthenticatedSession();
        }
        flushDeferredMailEvents();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            flushDeferredMailEvents();
            syncBrowserOllamaStatus();
        }
    });
    window.addEventListener('resize', () => {
        if (!isChatMobileLayout()) {
            closeMobileHeaderMenu();
        } else {
            positionMobileHeaderMenuPanel();
        }
        if (notesState.open) {
            applyNotesMobilePanelPosition();
        } else if (!isChatMobileLayout()) {
            const panel = els.notesPanel || document.getElementById('notesPanel');
            if (panel) {
                panel.style.left = '';
                panel.style.top = '';
                panel.style.right = '';
                panel.style.bottom = '';
            }
        }
        updateMobileSelectionQuickAdd();
        if (!isMailMobileLayout()) {
            setMailDetailOpen(false);
        }
    });
    // Event Listeners
    if(els.sendBtn) els.sendBtn.addEventListener('click', sendMessage);
    if (els.sidebarBrandNexoraTab) {
        els.sidebarBrandNexoraTab.addEventListener('click', () => {
            void switchToNexoraSidebar();
        });
    }
    if (els.sidebarBrandLearningTab) {
        els.sidebarBrandLearningTab.addEventListener('click', () => {
            if (!learningModeEnabled) return;
            void switchToLearningSidebar();
        });
    }
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const learningActionBtn = target.closest('[data-learning-action="new-learning"]');
        if (learningActionBtn) {
            void startNewLearningConversation();
            return;
        }
        const modeBtn = target.closest('[data-learning-mode]');
        if (modeBtn) {
            const mode = String(modeBtn.getAttribute('data-learning-mode') || '').trim().toLowerCase();
            void saveLearningModePreference(mode === 'on');
            return;
        }
        const defaultOpenBtn = target.closest('[data-default-open-view]');
        if (defaultOpenBtn) {
            const view = String(defaultOpenBtn.getAttribute('data-default-open-view') || '').trim().toLowerCase();
            void saveDefaultOpenViewPreference(view);
            return;
        }
    });
    if (els.longtermPlanToggle) {
        els.longtermPlanToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const panel = els.longtermPlanPanel;
            if (!panel) return;
            const collapsed = panel.dataset.collapsed === '1';
            panel.dataset.collapsed = collapsed ? '0' : '1';
            panel.classList.toggle('collapsed', !collapsed);
        });
    }
    if (els.checkThinking) {
        els.checkThinking.addEventListener('change', () => saveComposerPrefsToStorage());
    }
    if (els.checkSearch) {
        els.checkSearch.addEventListener('change', () => saveComposerPrefsToStorage());
    }
    if (els.tokenBudgetContextToggle) {
        els.tokenBudgetContextToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleContextIncludeMode();
        });
    }
    
    // File Input
    if(els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    if (els.cancelFileUploadBtn) {
        els.cancelFileUploadBtn.addEventListener('click', () => {
            cancelCurrentFileUpload();
        });
    }
    bindInputFileDropUpload();
    
    if(els.messageInput) {
        const restoredDraft = loadMessageDraftFromStorage();
        if (restoredDraft) {
            els.messageInput.value = restoredDraft;
            resizeMessageInput();
        } else {
            resizeMessageInput();
        }
        updateMobileMessageInputViewportBaseline();
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateMobileMessageInputViewportBaseline, { passive: true });
        } else {
            window.addEventListener('resize', updateMobileMessageInputViewportBaseline, { passive: true });
        }

        els.messageInput.addEventListener('compositionstart', () => {
            isMessageInputComposing = true;
        });
        els.messageInput.addEventListener('compositionend', () => {
            isMessageInputComposing = false;
        });
        els.messageInput.addEventListener('paste', async (e) => {
            const pastedFiles = extractFilesFromClipboardEvent(e);
            if (!pastedFiles.length) return;
            e.preventDefault();
            await handleFileUploadFiles(pastedFiles, { source: 'paste', clearInput: false });
        });

        const recoverFocusFromGesture = () => {
            if (!isChatMobileLayout()) return;
            lastMessageInputGestureTs = Date.now();
            const ghostFocused = document.activeElement === els.messageInput && !isMobileKeyboardLikelyOpen();
            focusMessageInputFromGesture({ preserveSelection: true, forceReset: ghostFocused });
        };

        els.messageInput.addEventListener('touchstart', recoverFocusFromGesture, { passive: true });
        els.messageInput.addEventListener('pointerdown', (e) => {
            if (e.pointerType && e.pointerType !== 'touch') return;
            recoverFocusFromGesture();
        }, { passive: true });

        // Last-resort mobile recovery: if browser left textarea in a ghost-focused state,
        // re-arm focus only when keyboard still did not open after the tap.
        els.messageInput.addEventListener('touchend', () => {
            if (!isChatMobileLayout()) return;
            setTimeout(() => {
                const justTapped = (Date.now() - lastMessageInputGestureTs) < 600;
                const ghostFocused = document.activeElement === els.messageInput && !isMobileKeyboardLikelyOpen();
                if (ghostFocused && justTapped) {
                    focusMessageInputFromGesture({ preserveSelection: true, forceReset: true });
                    return;
                }
                ensureMessageInputFocus({ onlyIfBlurred: true, preserveSelection: true });
            }, 40);
        }, { passive: true });

        els.messageInput.addEventListener('keydown', (e) => {
            if (learningFeedComposeMode) {
                const mentionState = learningFeedMentionState;
                const hasMention = !!(mentionState && mentionState.visible && Array.isArray(mentionState.users) && mentionState.users.length);
                if (hasMention) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        mentionState.activeIndex = (Number(mentionState.activeIndex || 0) + 1) % mentionState.users.length;
                        renderLearningFeedMentionMenu();
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        mentionState.activeIndex = (Number(mentionState.activeIndex || 0) - 1 + mentionState.users.length) % mentionState.users.length;
                        renderLearningFeedMentionMenu();
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        resetLearningFeedMentionState();
                        return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        const picked = mentionState.users[Number(mentionState.activeIndex || 0)];
                        if (picked) {
                            e.preventDefault();
                            applyLearningFeedMentionSelection(picked);
                            renderLearningFeedMentionMenu();
                            return;
                        }
                    }
                }
            }
            if ((e.isComposing || isMessageInputComposing) && e.key === 'Enter') {
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        // Auto-resize textarea
        els.messageInput.addEventListener('input', function() {
            resizeMessageInput(this);
            saveMessageDraftToStorage(this.value);
            if (learningFeedComposeMode) {
                updateLearningFeedMentionCandidates();
            } else {
                resetLearningFeedMentionState();
            }
        });

        const inputContainer = document.querySelector('#inputWrapper .input-container');
        if (inputContainer && inputContainer.dataset.mobileFocusBound !== '1') {
            inputContainer.dataset.mobileFocusBound = '1';
            inputContainer.addEventListener('touchstart', (e) => {
                if (!isChatMobileLayout()) return;
                const target = e.target;
                if (target && target.closest && target.closest('button, a, input[type=\"checkbox\"], input[type=\"file\"], select, label')) return;
                recoverFocusFromGesture();
            }, { passive: true });
        }
    }

    if (els.knowledgeSearchInput) {
        els.knowledgeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleKnowledgeSearch();
            }
        });
    }
    if (els.knowledgeSearchBtn) {
        els.knowledgeSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleKnowledgeSearch();
        });
    }
    if (els.cloudFileSearchInput) {
        els.cloudFileSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loadCloudFiles();
            }
        });
    }
    if (els.cloudFileSearchBtn) {
        els.cloudFileSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadCloudFiles();
        });
    }

    const bulkBtn = document.getElementById('bulkVectorizeBtn');
    if (bulkBtn) {
        bulkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            bulkVectorizeAllBasis();
        });
    }

    if (els.createBlankBasisBtn) {
        els.createBlankBasisBtn.addEventListener('click', (e) => {
            e.preventDefault();
            void createBlankBasisKnowledge();
        });
    }

    // Auto-scroll logic
    if (els.messagesContainer) {
        els.messagesContainer.addEventListener('wheel', (e) => {
            if (e.deltaY < 0) {
                markMessagesUserScrollIntent();
                breakMessagesAutoScroll();
            }
        }, { passive: true });

        document.addEventListener('wheel', (e) => {
            if (e.deltaY < 0 && shouldAutoScroll) {
                markMessagesUserScrollIntent();
                breakMessagesAutoScroll();
            }
        }, { passive: true, capture: true });

        document.addEventListener('keydown', (e) => {
            if (!shouldAutoScroll) return;
            if (isEditableScrollIntentTarget(e.target)) return;

            const key = String(e.key || '');
            if (key === 'ArrowUp' || key === 'PageUp' || key === 'Home') {
                markMessagesUserScrollIntent();
                breakMessagesAutoScroll();
            }
        }, true);

        els.messagesContainer.addEventListener('pointerdown', () => {
            markMessagesUserScrollIntent();
        }, { passive: true });

        els.messagesContainer.addEventListener('touchstart', (e) => {
            if (!isChatMobileLayout()) return;
            const touch = (e.touches && e.touches[0]) ? e.touches[0] : null;
            stopMobileSelectionScrollTracking();
            mobileSelectionScrollGuard.tracking = !!touch;
            mobileSelectionScrollGuard.startX = touch ? Number(touch.clientX || 0) : 0;
            mobileSelectionScrollGuard.startY = touch ? Number(touch.clientY || 0) : 0;
            captureActiveSelectionForMobileScrollLock();
        }, { passive: true });

        els.messagesContainer.addEventListener('touchmove', (e) => {
            markMessagesUserScrollIntent();
            breakMessagesAutoScroll();
            if (!isChatMobileLayout()) return;
            const touch = (e.touches && e.touches[0]) ? e.touches[0] : null;
            keepSelectionStableOnMobileScroll(touch);
        }, { passive: true });

        const stopMobileSelectionScrollGuard = () => stopMobileSelectionScrollTracking();
        els.messagesContainer.addEventListener('touchend', stopMobileSelectionScrollGuard, { passive: true });
        els.messagesContainer.addEventListener('touchcancel', stopMobileSelectionScrollGuard, { passive: true });

        els.messagesContainer.addEventListener('scroll', () => {
            const currentScrollTop = Number(els.messagesContainer.scrollTop || 0);
            const userScrolledUp = currentScrollTop < (__messagesLastObservedScrollTop - MESSAGES_AUTO_SCROLL_BREAK_UP_PX);
            const hasUserScrollIntent = Date.now() <= __messagesUserScrollIntentUntilTs;

            maybeLoadPreviousConversationMessagesFromScroll();

            if (Date.now() <= __messagesBottomPinUntilTs) {
                if (hasUserScrollIntent && userScrolledUp) {
                    breakMessagesAutoScroll();
                    setMessagesLastObservedScrollTop(currentScrollTop);
                    scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
                    return;
                }

                setShouldAutoScroll(true);
                    setMessagesLastObservedScrollTop(currentScrollTop);
                    return;
            }

            if (_isJumping) return; // Skip during jump

            if (hasUserScrollIntent && userScrolledUp) {
                setShouldAutoScroll(false);
                setMessagesLastObservedScrollTop(currentScrollTop);
                scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
                return;
            }
            
            if (isMessagesNearBottom(els.messagesContainer)) {
                setShouldAutoScroll(true);
            } else {
                setShouldAutoScroll(false);
            }
            setMessagesLastObservedScrollTop(currentScrollTop);

            // Turn indicator 跟随滚动只更新激活态，不再每次强制滚动面板内部，避免额外重排。
            scheduleTurnIndicatorActiveUpdate({ animate: false, forceScroll: false });
        });

        // Hover proxy: 鼠标在容器内时，按纵向位置匹配最近消息，显示该条操作栏
        els.messagesContainer.addEventListener('mousemove', (e) => {
            updateHoverProxyFromClientY(e.clientY, e.clientX);
        });
        els.messagesContainer.addEventListener('mouseenter', (e) => {
            updateHoverProxyFromClientY(e.clientY, e.clientX);
        });
        els.messagesContainer.addEventListener('mouseleave', () => {
            clearHoverProxyMessage();
        });
        document.addEventListener('selectionchange', () => {
            if (isHoverProxySuppressedBySelection()) {
                clearHoverProxyMessage();
            }
        });
    }

    // Sidebar Toggles (desktop/mobile header buttons are bound in rebindHeaderActionButtons)
    const mobileToggle = document.getElementById('toggleSidebarMobile');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            toggleMobileSidebar();
        });
    }

    // Knowledge Panel
    const toggleKP = () => toggleKnowledgePanel();
    if (els.btnTogglePanel) els.btnTogglePanel.addEventListener('click', closeKnowledgePanel);
    if(els.btnToggleFilePanel) els.btnToggleFilePanel.addEventListener('click', (e) => {
        e.preventDefault();
        closeCloudFilePanel();
    });

    if(els.refreshKnowledgeBtn) {
        els.refreshKnowledgeBtn.addEventListener('click', () => loadKnowledge(currentConversationId));
    }
    if (els.refreshCloudFilesBtn) {
        els.refreshCloudFilesBtn.addEventListener('click', () => loadCloudFiles());
    }
    if (els.uploadCloudFilesBtn && els.cloudFileUploadInput) {
        els.uploadCloudFilesBtn.addEventListener('click', () => {
            els.cloudFileUploadInput.click();
        });
        els.cloudFileUploadInput.addEventListener('change', () => {
            void handleCloudFilePanelUploadChange(els.cloudFileUploadInput);
        });
    }

    // New Chat
    if (els.newChatBtn) {
        els.newChatBtn.addEventListener('click', () => {
            const inLearningSidebar = String(learningSidebarMode || '').trim().toLowerCase() === 'learning';

            if (inLearningSidebar && getLearningSidebarView() === 'conversation') {
                returnToLearningConversationList();
                return;
            }

            const targetMode = (learningModeEnabled && inLearningSidebar) ? 'learning' : 'chat';
            if (targetMode === 'learning') {
                void startNewLearningConversation();
                return;
            }
            setActiveNexoraCodeProject('');
            createNewConversation(false, targetMode);
        });
    }

    if (els.workspacesBtn) {
        els.workspacesBtn.addEventListener('click', () => {
            window.openWorkspacesFrameView();
        });
    }

    if (els.fileCenterBtn) {
        els.fileCenterBtn.addEventListener('click', () => {
            window.openFilesFrameView();
        });
    }

    const learningNavBindings = [
        [els.learningProgressBtn, 'progress'],
        [els.learningResourcesBtn, 'push'],
        [els.learningPracticeBtn, 'questionBank'],
        [els.learningProfileBtn, 'profileCenter'],
        [els.learningFeedBtn, 'feed'],
        [els.learningCoursesBtn, 'materials'],
    ];

    learningNavBindings.forEach(([btn, tab]) => {
        if (!btn) return;

        btn.addEventListener('click', () => {
            if (btn === els.learningResourcesBtn) {
                setLearningResourceStudioMenuOpen(true);
            }

            if (btn === els.learningPracticeBtn) {
                setLearningPracticeMenuOpen(true);
            }

            void openLearningDashboardSurface(tab);
        });
    });

    if (els.learningResourcesToggleBtn) {
        els.learningResourcesToggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const open = els.learningResourcesGroup.classList.contains('is-collapsed');
            setLearningResourceStudioMenuOpen(open);
        });
    }

    if (els.learningResourcesStudioMenu) {
        els.learningResourcesStudioMenu.addEventListener('click', (event) => {
            const target = event.target;

            if (!(target instanceof Element)) return;

            const item = target.closest('[data-learning-studio]');

            if (!item) return;

            event.preventDefault();
            event.stopPropagation();
            void openLearningStudioSurface(item.getAttribute('data-learning-studio'));
        });
    }

    if (els.learningPracticeToggleBtn) {
        els.learningPracticeToggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const open = els.learningPracticeGroup.classList.contains('is-collapsed');
            setLearningPracticeMenuOpen(open);
        });
    }

    if (els.learningPracticeMenu) {
        els.learningPracticeMenu.addEventListener('click', (event) => {
            const target = event.target;

            if (!(target instanceof Element)) return;

            const item = target.closest('[data-learning-practice]');

            if (!item) return;

            event.preventDefault();
            event.stopPropagation();
            void openLearningDashboardSurface('questionBankMistakes');
        });
    }

    document.addEventListener('click', (event) => {
        const target = event.target;

        if (!(target instanceof Element)) return;

        if (els.learningResourcesGroup && !els.learningResourcesGroup.contains(target)) {
            setLearningResourceStudioMenuOpen(false);
        }

        if (els.learningPracticeGroup && !els.learningPracticeGroup.contains(target)) {
            setLearningPracticeMenuOpen(false);
        }
    });

    window.addEventListener('popstate', () => {
        const params = new URLSearchParams(window.location.search || '');
        const cid = getDirectConversationUrlTarget(params);

        if (cid) {
            void loadConversation(cid, { pushHistory: false });
            return;
        }

        if (hasConversationUrlTarget(params)) {
            applyLearningSidebarMode('nexora');
            void syncLearningHeaderMode();
            return;
        }

        const inLearningSidebar = String(learningSidebarMode || '').trim().toLowerCase() === 'learning';

        if (learningModeEnabled && inLearningSidebar) {
            returnToLearningConversationList();
            loadConversations();
            return;
        }

        const targetMode = (learningModeEnabled && inLearningSidebar) ? 'learning' : 'chat';
        void createNewConversation(false, targetMode, { pushHistory: false });
    });

// 说明
    if(els.tokenDisplay) els.tokenDisplay.addEventListener('click', openTokenModal);
    if(els.closeModalBtn) els.closeModalBtn.addEventListener('click', () => els.tokenModal.classList.remove('active'));
    if (els.tokenModal) bindBackdropSafeClose(els.tokenModal, () => els.tokenModal.classList.remove('active'));

    // User Menu & Admin
    if (els.usernameBtn) {
        els.usernameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            els.userMenu.classList.toggle('active');
            if (els.userMenu.classList.contains('active')) {
                checkUserRole(); // 说明
            }
        });
    }

    // Prevent menu from closing when clicking inside it
    if (els.userMenu) {
        els.userMenu.addEventListener('click', (e) => {
// 说明
        });
        
        // 点击菜单项后臊关闭
        els.userMenu.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                els.userMenu.classList.remove('active');
            });
        });
    }

    document.addEventListener('click', (e) => {
        if(els.userMenu) els.userMenu.classList.remove('active');
        const mobileHeaderMenu = document.getElementById('mobileHeaderMenu') || els.mobileHeaderMenu;
        if (mobileHeaderMenu && !mobileHeaderMenu.contains(e.target)) {
            closeMobileHeaderMenu();
        }
        const target = e.target;
        const clickInModal = !!(target && target.closest && target.closest('.modal-backdrop'));

        if (!clickInModal && els.knowledgePanel && els.knowledgePanel.classList.contains('visible')) {
            const clickInPanel = !!(target && els.knowledgePanel.contains(target));
            const clickOnToggle = !!(
                target &&
                (
                    (els.toggleKnowledgePanel && els.toggleKnowledgePanel.contains(target)) ||
                    (els.btnTogglePanel && els.btnTogglePanel.contains(target))
                )
            );
            if (!clickInPanel && !clickOnToggle) {
                closeKnowledgePanel();
            }
        }

        // Mobile: tap blank area to close sidebar / knowledge panel
        if (isChatMobileLayout()) {
            if (clickInModal) {
                return;
            }
            const mobileToggleBtn = document.getElementById('toggleSidebarMobile');

            if (els.sidebar && els.sidebar.classList.contains('mobile-open')) {
                const clickInSidebar = els.sidebar.contains(target);
                const clickOnToggle = (els.toggleSidebar && els.toggleSidebar.contains(target)) ||
                    (mobileToggleBtn && mobileToggleBtn.contains(target));
                if (!clickInSidebar && !clickOnToggle) {
                    closeMobileSidebar();
                }
            }

            if (els.filePanel && els.filePanel.classList.contains('visible')) {
                const clickInPanel = els.filePanel.contains(target);
                const clickOnToggle = (els.toggleFilePanel && els.toggleFilePanel.contains(target)) ||
                    (els.btnToggleFilePanel && els.btnToggleFilePanel.contains(target));
                if (!clickInPanel && !clickOnToggle) {
                    closeCloudFilePanel();
                }
            }
        } else {
            if (clickInModal) {
                return;
            }

            if (!(target instanceof Element)) {
                return;
            }

            if (els.sidebar && !els.sidebar.classList.contains('collapsed') && isSidebarOverlayLayout()) {
                const clickInSidebar = els.sidebar.contains(target);
                const clickOnToggle = (els.toggleSidebar && els.toggleSidebar.contains(target));

                if (!clickInSidebar && !clickOnToggle) {
                    els.sidebar.classList.add('collapsed');
                }
            }

        }
    });

    window.addEventListener('nexora:learning-frame-pointerdown', () => {
        collapseDesktopSidebarByOutsideInteraction();
    });

    // Check user role and show admin menu if needed
    checkUserRole();
    bindTrashModal();
    rebindHeaderActionButtons();

    // Settings button click
    if (!settingsModalEscapeHandlerBound) {
        document.addEventListener('keydown', (e) => {
            if (!e || e.key !== 'Escape') return;
            const settingsModal = document.getElementById('settingsModal');
            if (!settingsModal || !settingsModal.classList.contains('active')) return;
            const blockerIds = [
                'confirmBackdrop',
                'addUserModal',
                'modelPermModal',
                'avatarCropModal',
                'adminTextConfirmModal',
                'adminConfigModal',
                'skillEditorModal',
                'adminPublicApiKeyModal',
                'papiKeyConfirmModal',
                'userPapiKeyModal'
            ];
            for (const bid of blockerIds) {
                const node = document.getElementById(bid);
                if (node && node.classList && node.classList.contains('active')) return;
            }
            e.preventDefault();
            closeSettingsModal();
        });
        settingsModalEscapeHandlerBound = true;
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (els.userMenu) els.userMenu.classList.remove('active');
            openSettingsModal();
        });
    }
    const trashMenuBtn = els.trashMenuBtn || document.getElementById('trashMenuBtn');
    if (trashMenuBtn) {
        trashMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (els.userMenu) els.userMenu.classList.remove('active');
            openTrashModal();
        });
    }

    const logoutLink = els.logoutLink || document.getElementById('logoutLink');
    if (logoutLink) {
        logoutLink.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (els.userMenu) els.userMenu.classList.remove('active');
            await requestLogoutAndRedirect();
        });
    }

    // 添加用户 Modal 相馆
    const openAddUserBtn = document.getElementById('openAddUserForm'); 
    if (openAddUserBtn) {
        openAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openAddUserModal();
        });
    }

    const cancelAddUserBtn = document.getElementById('cancelAddUser');
    if (cancelAddUserBtn) {
        cancelAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAddUserModal();
        });
    }
    
// 说明
    const addUserModal = document.getElementById('addUserModal');
    if (addUserModal) {
        bindBackdropSafeClose(addUserModal, closeAddUserModal);
    }
    
// 说明
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (els.tokenModal) els.tokenModal.classList.remove('active');
        });
    }

    // Admin modal removed; admin features are merged into settings tabs.

    const submitAddUserBtn = document.getElementById('addUserBtn');
    if (submitAddUserBtn) {
        submitAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            submitAddUser();
        });
    }

    const saveProfileBtn = document.getElementById('saveProfileBtn');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => saveUserProfile());
    }

    const avatarUploadBtn = document.getElementById('settingsAvatarUploadBtn');
    const avatarFileInput = document.getElementById('settingsAvatarFileInput');
    if (avatarUploadBtn && avatarFileInput) {
        avatarUploadBtn.addEventListener('click', () => avatarFileInput.click());
        avatarFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) openAvatarCropModal(file);
            e.target.value = '';
        });
    }

    const closeAvatarCropBtn = document.getElementById('closeAvatarCropBtn');
    if (closeAvatarCropBtn) {
        closeAvatarCropBtn.addEventListener('click', closeAvatarCropModal);
    }
    const cancelAvatarCropBtn = document.getElementById('cancelAvatarCropBtn');
    if (cancelAvatarCropBtn) {
        cancelAvatarCropBtn.addEventListener('click', closeAvatarCropModal);
    }
    const applyAvatarCropBtn = document.getElementById('applyAvatarCropBtn');
    if (applyAvatarCropBtn) {
        applyAvatarCropBtn.addEventListener('click', applyAvatarCropAndPreview);
    }
    const avatarCropResetBtn = document.getElementById('avatarCropResetBtn');
    if (avatarCropResetBtn) {
        avatarCropResetBtn.addEventListener('click', resetAvatarCropPosition);
    }
    const avatarCropModal = document.getElementById('avatarCropModal');
    if (avatarCropModal) {
        bindBackdropSafeClose(avatarCropModal, closeAvatarCropModal);
    }

    adminSettingsEventsController.bindAdminSettingsEvents();

    if (els.closeSkillEditorBtn) {
        els.closeSkillEditorBtn.addEventListener('click', closeSkillEditorModal);
    }
    if (els.cancelSkillEditorBtn) {
        els.cancelSkillEditorBtn.addEventListener('click', closeSkillEditorModal);
    }
    if (els.saveSkillEditorBtn) {
        els.saveSkillEditorBtn.addEventListener('click', () => {
            void saveSkillEditorModal();
        });
    }
    if (els.skillEditorModal) {
        bindBackdropSafeClose(els.skillEditorModal, closeSkillEditorModal);
    }
}

export {
    initUI,
};

document.addEventListener('DOMContentLoaded', () => bootstrap());
