(function () {
// ─────── Constants & DOM References ───────────────────────────────────
  "use strict";

  const el = {
    learningPanel: document.getElementById("learningPanel"),
    dashboardView: document.getElementById("dashboardView"),
    profileCenterView: document.getElementById("profileCenterView"),
    profileCenterCompletion: document.getElementById("profileCenterCompletion"),
    profileCenterGuideBtn: document.getElementById("profileCenterGuideBtn"),
    profileCenterUpdatedAt: document.getElementById("profileCenterUpdatedAt"),
    profileCenterRadar: document.getElementById("profileCenterRadar"),
    profileCenterRadarEmpty: document.getElementById("profileCenterRadarEmpty"),
    profileCenterScores: document.getElementById("profileCenterScores"),
    profileCenterFacts: document.getElementById("profileCenterFacts"),
    questionPracticeView: document.getElementById("questionPracticeView"),
    questionPracticeContent: document.getElementById("questionPracticeContent"),
    questionPracticeTitle: document.getElementById("questionPracticeTitle"),
    questionPracticeSubtitle: document.getElementById("questionPracticeSubtitle"),
    questionPracticeHeaderMeta: document.getElementById("questionPracticeHeaderMeta"),
    backFromQuestionPracticeBtn: document.getElementById("backFromQuestionPracticeBtn"),
    learningResourceStudioView: document.getElementById("learningResourceStudioView"),
    learningResourceStudioPanel: document.getElementById("learningResourceStudioPanel"),
    backFromResourceStudioBtn: document.getElementById("backFromResourceStudioBtn"),
    learningVideoStudioView: document.getElementById("learningVideoStudioView"),
    learningVideoStudioPanel: document.getElementById("learningVideoStudioPanel"),
    backFromVideoStudioBtn: document.getElementById("backFromVideoStudioBtn"),
    learningResourceReviewView: document.getElementById("learningResourceReviewView"),
    learningResourceReviewPanel: document.getElementById("learningResourceReviewPanel"),
    learningResourceReviewTitle: document.getElementById("learningResourceReviewTitle"),
    learningResourceReviewSubtitle: document.getElementById("learningResourceReviewSubtitle"),
    backFromResourceReviewBtn: document.getElementById("backFromResourceReviewBtn"),
    learningResourceReaderView: document.getElementById("learningResourceReaderView"),
    learningResourceReaderTitle: document.getElementById("learningResourceReaderTitle"),
    learningResourceReaderSubtitle: document.getElementById("learningResourceReaderSubtitle"),
    learningResourceReaderContent: document.getElementById("learningResourceReaderContent"),
    backFromResourceReaderBtn: document.getElementById("backFromResourceReaderBtn"),
    materialsView: document.getElementById("materialsView"),
    uploadView: document.getElementById("uploadView"),
    settingsView: document.getElementById("settingsView"),
    materialsMainHeader: document.getElementById("materialsMainHeader"),
    openMaterialsViewBtn: document.getElementById("openMaterialsViewBtn"),
    backToDashboardBtn: document.getElementById("backToDashboardBtn"),
    openUploadViewBtn: document.getElementById("openUploadViewBtn"),
    backToMaterialsBtn: document.getElementById("backToMaterialsBtn"),
    kickerCreateTabBtn: document.getElementById("kickerCreateTabBtn"),
    kickerUploadTabBtn: document.getElementById("kickerUploadTabBtn"),
    createLectureBlock: document.getElementById("createLectureBlock"),
    uploadBookBlock: document.getElementById("uploadBookBlock"),
    dashboardFocusPanel: document.getElementById("dashboardFocusPanel"),
    progressList: document.getElementById("progressList"),
    timePieChart: document.getElementById("timePieChart"),
    dashboardSidePanelTitle: document.getElementById("dashboardSidePanelTitle"),
    learningFeedPanel: document.getElementById("learningFeedPanel"),
    learningFeedComposeShell: document.getElementById("learningFeedComposeShell"),
    learningFeedComposer: document.getElementById("learningFeedComposer"),
    learningFeedComposeBtn: document.getElementById("learningFeedComposeBtn"),
    learningFeedPostInput: document.getElementById("learningFeedPostInput"),
    learningFeedPostMentionMenu: document.getElementById("learningFeedPostMentionMenu"),
    learningFeedComposeChannel: document.getElementById("learningFeedComposeChannel"),
    learningFeedPostSubmitBtn: document.getElementById("learningFeedPostSubmitBtn"),
    feedLayout: document.getElementById("feedLayout"),
    feedChannelSidebar: document.getElementById("feedChannelSidebar"),
    feedChannelList: document.getElementById("feedChannelList"),
    feedContentArea: document.getElementById("feedContentArea"),
    dashboardProgressTabBtn: document.getElementById("dashboardProgressTabBtn"),
    dashboardPushTabBtn: document.getElementById("dashboardPushTabBtn"),
    dashboardQuestionBankTabBtn: document.getElementById("dashboardQuestionBankTabBtn"),
    dashboardProgressFeedTabBtn: document.getElementById("dashboardProgressFeedTabBtn"),
    learningPushPanel: document.getElementById("learningPushPanel"),
    questionBankPanel: document.getElementById("questionBankPanel"),
    dashboardPieTabBtn: document.getElementById("dashboardPieTabBtn"),
    dashboardProfileTabBtn: document.getElementById("dashboardProfileTabBtn"),
    userProfileDimensions: document.getElementById("userProfileDimensions"),
    userProfileCard: document.getElementById("userProfileCard"),
    profileAdminSettingsBtn: document.getElementById("profileAdminSettingsBtn"),
    profileAgentsBtn: document.getElementById("profileAgentsBtn"),
    materialsHeadKicker: document.querySelector("#materialsMainHeader .panel-kicker"),
    materialsLayout: document.getElementById("materialsLayout"),
    lectureList: document.getElementById("lectureList"),
    lectureDetailPane: document.getElementById("lectureDetailPane"),
    courseHomePane: document.getElementById("courseHomePane"),
    courseHomeHeader: document.getElementById("courseHomeHeader"),
    courseHomeContent: document.getElementById("courseHomeContent"),
    backFromCourseHomeBtn: document.getElementById("backFromCourseHomeBtn"),
    courseHomeSubtitle: document.getElementById("courseHomeSubtitle"),
    courseHomeUploadBtn: document.getElementById("courseHomeUploadBtn"),
    courseHomeSettingsBtn: document.getElementById("courseHomeSettingsBtn"),
    readerPane: document.getElementById("readerPane"),
    readerHeader: document.getElementById("readerHeader"),
    backFromReaderBtn: document.getElementById("backFromReaderBtn"),
    readerTitle: document.getElementById("readerTitle"),
    readerSubTitle: document.getElementById("readerSubTitle"),
    readerChapterListBtn: document.getElementById("readerChapterListBtn"),
    chapterListPanel: document.getElementById("chapterListPanel"),
    chapterListContent: document.getElementById("chapterListContent"),
    closeChapterList: document.getElementById("closeChapterList"),
    readerContent: document.getElementById("readerContent"),
    readerSettingsBtn: document.getElementById("readerSettingsBtn"),
    readerSettingsPanel: document.getElementById("readerSettingsPanel"),
    fontSizeSlider: document.getElementById("fontSizeSlider"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightSlider: document.getElementById("lineHeightSlider"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    edgeClickWidthSlider: document.getElementById("edgeClickWidthSlider"),
    edgeClickWidthValue: document.getElementById("edgeClickWidthValue"),
    enableKeyNavigation: document.getElementById("enableKeyNavigation"),
    translatorSelect: document.getElementById("translatorSelect"),
    resetReaderSettings: document.getElementById("resetReaderSettings"),
    exportReaderSettings: document.getElementById("exportReaderSettings"),
    readerClickAreas: document.getElementById("readerClickAreas"),
    readerClickLeft: document.getElementById("readerClickLeft"),
    readerClickRight: document.getElementById("readerClickRight"),
    createLectureTitleInput: document.getElementById("createLectureTitleInput"),
    createLectureCategoryInput: document.getElementById("createLectureCategoryInput"),
    createLectureStatusSelect: document.getElementById("createLectureStatusSelect"),
    createLectureDescriptionInput: document.getElementById("createLectureDescriptionInput"),
    createLectureBtn: document.getElementById("createLectureBtn"),
    materialsLectureInput: document.getElementById("materialsLectureInput"),
    materialsLectureIdHidden: document.getElementById("materialsLectureIdHidden"),
    openCoursePickerBtn: document.getElementById("openCoursePickerBtn"),
    materialsBookTitleInput: document.getElementById("materialsBookTitleInput"),
    materialsFileDropZone: document.getElementById("materialsFileDropZone"),
    materialsFileDropTitle: document.getElementById("materialsFileDropTitle"),
    materialsFileDropSub: document.getElementById("materialsFileDropSub"),
    materialsFileInput: document.getElementById("materialsFileInput"),
    materialsUploadBookBtn: document.getElementById("materialsUploadBookBtn"),
    uploadTip: document.getElementById("uploadTip"),
    materialsPreviewHead: document.getElementById("materialsPreviewHead"),
    materialsPreviewPane: document.getElementById("materialsPreviewPane"),
    backFromSettingsBtn: document.getElementById("backFromSettingsBtn"),
    settingsNavList: document.getElementById("settingsNavList"),
    settingsDetailPane: document.getElementById("settingsDetailPane"),
    learningPathView: document.getElementById("learningPathView"),
    learningPathHeader: document.getElementById("learningPathHeader"),
    learningPathMarkdown: document.getElementById("learningPathMarkdown"),
    learningPathOutline: document.getElementById("learningPathOutline"),
    learningPathOutlinePane: document.querySelector(".learning-path-outline-pane"),
    learningPathOutlineToggle: document.getElementById("learningPathOutlineToggle"),
    learningPathOutlineTab: document.getElementById("learningPathOutlineTab"),
    learningPathReportTab: document.getElementById("learningPathReportTab"),
    learningPathFloatingActions: document.getElementById("learningPathFloatingActions"),
    backFromLearningPathBtn: document.getElementById("backFromLearningPathBtn"),
    confirmBackdrop: document.getElementById("confirmBackdrop"),
    confirmBody: document.getElementById("confirmBody"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    learningStatusBtn: document.getElementById("learningStatusBtn"),
  };

  const READER_SETTINGS_STORAGE_KEY = "nxl_reader_settings_v1";
  const LP_OUTLINE_COLLAPSED_STORAGE_KEY = "nxl_learning_path_outline_collapsed_v1";
  const DEFAULT_READER_SETTINGS = Object.freeze({
    fontSize: 18,
    paragraphSpacing: 1.7,
    edgeClickWidth: 60,
    theme: "light",
    displayMode: "zh-ja",
    enableKeyNavigation: true,
    preferredTranslator: "auto",
  });
  const LP_CHAPTER_CONTENT_MARKER = "<!-- NEXORA_CONTENT_START -->";

// ─────── NXLU Utils Destructuring ─────────────────────────────────────
  const {
    escapeHtml, decodeBasicHtmlEntities, toNumber, clamp, renderTextWithMentions,
    formatTs, normalizeReaderSelectionText, resolveApiUrl, formatReaderText,
    normalizeStatusKey, statusText, vectorStatusLabel, materialStatusLabel, statusBadgeClass,
    getLectureTitle, getCourseProgress, getStudyHours, getChapterInfo, buildDashboardCourses,
    polarToCartesian, donutPath, formatFeedRelativeTime,
    STATUS_LABELS, PIE_COLORS,
  } = window.NXLU || {};

// ─────── App State ────────────────────────────────────────────────────
  const state = {
    username: "",
    user: {},
    integration: {},
    isAdmin: false,
    allLectureRows: [],
    dashboardRows: [],
    selectedLearningLectureIds: [],
    selectedLectureId: "",
    selectedBookId: "",
    uploadTab: "create",
    uploadRightMode: "preview",
    previewObjectUrl: "",
    selectedUploadFile: null,
    totalStudyHours: 0,
    isReaderOpen: false,
    isReaderFullscreen: false,
    readerRequestToken: 0,
    lastSessionMeta: null,
    settingsTab: "refinement",
    refinementRows: [],
    refinementQueue: { queue_size: 0, running_count: 0 },
    settingsUsers: [],
    settingsUsersSummary: { total: 0, admins: 0, teachers: 0, students: 0 },
    settingsUsersQuery: "",
    settingsUsersLoading: false,
    settingsUsersError: "",
    modelOptions: [],
    modelSettings: {
      default_nexora_model: "",
      rough_reading: {},
      intensive_reading: {},
      split_chapters: {},
      memory: {},
      profile_question: {},
    },
    settingsPollTimer: null,
    refinementScrollTop: 0,
    refinementExpandedMap: {},
    refinementViewBootstrapped: false,
    readerSettings: {
      fontSize: DEFAULT_READER_SETTINGS.fontSize,
      paragraphSpacing: DEFAULT_READER_SETTINGS.paragraphSpacing,
      edgeClickWidth: DEFAULT_READER_SETTINGS.edgeClickWidth,
      theme: DEFAULT_READER_SETTINGS.theme,
      displayMode: DEFAULT_READER_SETTINGS.displayMode,
      enableKeyNavigation: DEFAULT_READER_SETTINGS.enableKeyNavigation,
      preferredTranslator: DEFAULT_READER_SETTINGS.preferredTranslator,
    },
    readerChapters: [],
    readerActiveChapterIndex: 0,
    readerFullTextRaw: "",
    readerImages: [],
    readerViewMode: "closed",
    readerMeta: { title: "", subtitle: "" },
    readerUiToggleLockedUntil: 0,
    readerClosePanelsUntil: 0,
    materialsPageMode: "shelf",
    materialsDetailMode: "lecture",
    courseHomeReturnTarget: "shelf",
    courseHomeTab: "content",
    courseHomeScrollTop: 0,
    courseVideoCache: {},
    learningReportCache: {},
    cognitionOverviewCache: {},
    cognitionTwinFilters: {},
    learningPathSideTab: "outline",
    catalogContext: null,
    learningPathCache: {},
    learningPathOpenTarget: null,
    lpOutlineCollapsed: false,
    lpChapterAutoScroll: true,
    lpChapterScrollUnbind: null,
    lpChapterStreamKey: "",
    teacherEditContext: null,
    questionPracticeReturnView: "dashboard",
    learningResourceReaderItem: null,
    learningResourceReviewItem: null,
    materialsSortBy: "updated_at",
    materialsSortOrder: "desc",
    settingsLogs: [],
    settingsLogSources: [],
    settingsLogCategory: "all",
    settingsLogSource: "",
    questionBankItems: [],
    questionBankGroups: [],
    questionBankSelectedGroupId: "",
    questionBankSelectedGroup: null,
    questionBankGroupLoading: false,
    questionBankGroupError: "",
    questionBankGroupAnswerFilter: "all",
    questionBankSummary: { total: 0, pending: 0, submitted: 0, needs_review: 0 },
    questionBankFilter: { lectureId: "all", answerState: "all", questionType: "all" },
    questionBankPage: 1,
    questionBankPageSize: 5,
    questionBankPagination: { page: 1, page_size: 5, total: 0, total_pages: 1, has_prev: false, has_next: false },
    learningFeeds: [],
    learningFeedChannels: [],
    selectedFeedChannelId: "public_all",
    dashboardSideTab: "progress",
    dashboardPieTab: "profile",
    userProfile: null,
    profileCenter: null,
    profileCenterLoading: false,
    notifications: [],
    adminPendingParse: { count: 0, items: [] },
    // ── 教师 Panel 状态 ──
    teacherOverview: null,
    teacherLoadingOverview: false,
    teacherView: "home",
    teacherReturnView: "home",
    teacherSelectedUid: "",
    teacherStudentAnalysis: null,
    teacherLoadingAnalysis: false,
    teacherLectureId: "",
    teacherSortKey: "progress_desc",
    teacherScope: "in_course",
    _teacherEventFilter: null,  // Set 实例，null 表示无筛选（显示全部）
    feedExpandedMap: {},
    feedCommentDrafts: {},
    feedCommentComposing: {},
    channelEditState: {
      channelId: "",
      title: "",
      selectedUserIds: [],
      searchQuery: "",
      searchResults: [],
      isAllPublic: false,
    },
    settingsCourseEditId: "",
    settingsCourseView: "detail",
    settingsRefinementView: "detail",
    settingsBookUpload: {
      lectureId: "",
      title: "",
      file: null,
    },
    outlineActivity: {
      lectureId: "",
      running: false,
      lines: [],
      draft: "",
      startedAt: 0,
      error: "",
    },
    lpPathDraft: "",
    lpChapterDraft: "",
    lpChapterError: "",
    lpChapterGeneratingIndex: -1,
    lpLabCleanups: [],
    feedMentionState: {
      key: "",
      query: "",
      users: [],
      activeIndex: 0,
      visible: false,
      anchor: null,
      context: "",
    },
    readerReportedChapterKey: "",
    readerReportingChapterKey: "",
    readerChapterQuizLoadingKey: "",
    readerBookInfoXml: "",
    readerBookDetailXml: "",
    readerGuidePromptedKey: "",
    dynamicPosting: false,
    feedPostDraft: "",
    feedPostSubmitting: false,
    confirmAction: null,
    readerSessionProgress: {},  // { "lectureId::bookId": { completedIndices: Set, currentChapterIndex: 0 } }
    readerSectionsData: {},     // { chapterName: { range, sessions: [{name, range, summary}] } }
    readerAnnotations: [],      // [{ chapterName, offset, length, type, content, anchorText }]
    readerPendingRestorePosition: null,
  };
  let readerContextSyncTimer = null;
  let readerPositionSaveTimer = null;
  const readerSelectionTelemetryState = {
    pointerActive: false,
    pointerDownKey: "",
    timer: null,
    lastKey: "",
    lastAt: 0,
  };

// ─────── Telemetry Integration ────────────────────────────────────────
  function logReaderDebug(eventName, extra) {
    try {
      const payload = {
        event: String(eventName || ""),
        time: Date.now(),
        isReaderOpen: !!state.isReaderOpen,
        isReaderFullscreen: !!state.isReaderFullscreen,
        settingsOpen: !!(el.readerSettingsPanel && el.readerSettingsPanel.classList.contains("show")),
        chapterOpen: !!(el.chapterListPanel && el.chapterListPanel.classList.contains("show")),
        headerHidden: !!(el.readerHeader && (el.readerHeader.classList.contains("hidden") || el.readerHeader.classList.contains("header-hidden"))),
        extra: extra || {},
      };
      if (el.readerSettingsPanel) {
        const cs = window.getComputedStyle(el.readerSettingsPanel);
        const rect = el.readerSettingsPanel.getBoundingClientRect();
        const parent = el.readerSettingsPanel.parentElement;
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        payload.settingsStyle = {
          position: cs.position,
          top: cs.top,
          bottom: cs.bottom,
          left: cs.left,
          right: cs.right,
          transform: cs.transform,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          zIndex: cs.zIndex,
          rectTop: Number(rect.top.toFixed(2)),
          rectBottom: Number(rect.bottom.toFixed(2)),
          rectHeight: Number(rect.height.toFixed(2)),
          winH: Number((window.innerHeight || 0).toFixed(2)),
          parentTag: parent ? parent.tagName : "",
          parentClass: parent ? String(parent.className || "") : "",
          parentRectTop: parentRect ? Number(parentRect.top.toFixed(2)) : null,
          parentRectBottom: parentRect ? Number(parentRect.bottom.toFixed(2)) : null,
          parentRectHeight: parentRect ? Number(parentRect.height.toFixed(2)) : null,
        };
      }
      console.info("[NXL-ReaderDebug]", payload);
    } catch (_err) {
      // ignore debug errors
    }
  }

  function emitTelemetry(eventName, payload) {
    const telemetry = window.NXLTelemetry;
    if (!telemetry || typeof telemetry.emit !== "function") return;
    telemetry.emit(eventName, payload || {});
  }

  function emitKnowledgePointHoverTelemetry(marker, triggerSource) {
    if (!(marker instanceof Element) || !state.isReaderOpen) return;
    const chapterMeta = getReaderCurrentChapterMeta();
    const noteType = String(marker.getAttribute("data-note-type") || "").trim();
    const anchorText = String(marker.getAttribute("data-anchor-text") || "").trim();
    const offset = Number(marker.getAttribute("data-offset") || 0) || 0;
    const length = Number(marker.getAttribute("data-length") || 0) || 0;
    const bubbleContent = marker.querySelector(".annotation-bubble-content");
    const noteText = bubbleContent ? String(bubbleContent.textContent || "").trim() : "";
    const rect = marker.getBoundingClientRect();
    emitTelemetry("reader_knowledge_point_hover", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      note_type: noteType,
      anchor_text: anchorText,
      note_text: noteText,
      offset,
      length,
      trigger_source: String(triggerSource || "marker").trim() || "marker",
      hover_rect: {
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      },
      telemetry_key: [
        String(state.selectedLectureId || "").trim(),
        String(state.selectedBookId || "").trim(),
        chapterMeta.chapterIndex,
        chapterMeta.chapterTitle,
        noteType,
        anchorText,
        offset,
        length,
      ].join("::"),
    });
  }

  function resetReaderSelectionTelemetry() {
    readerSelectionTelemetryState.pointerActive = false;
    readerSelectionTelemetryState.pointerDownKey = "";
    if (readerSelectionTelemetryState.timer) {
      clearTimeout(readerSelectionTelemetryState.timer);
      readerSelectionTelemetryState.timer = null;
    }
  }

  function getReaderSelectionSignature() {
    if (!state.isReaderOpen || !el.readerContent) return "";
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0) return "";
    const text = normalizeReaderSelectionText(sel.toString(), 1600);
    if (!text) return "";
    const range = sel.getRangeAt(0);
    const anchorOffset = Number(sel.anchorOffset || 0);
    const focusOffset = Number(sel.focusOffset || 0);
    let startOffset = 0;
    let endOffset = 0;
    try {
      startOffset = Number(range.startOffset || 0);
      endOffset = Number(range.endOffset || 0);
    } catch (_err) {}
    return [text, anchorOffset, focusOffset, startOffset, endOffset].join("::");
  }

  function buildReaderSelectionTelemetryPayload(trigger) {
    if (!state.isReaderOpen || !el.readerContent) return null;
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) return null;
    const text = normalizeReaderSelectionText(sel.toString(), 1600);
    if (!text) return null;
    const anchorNode = sel.anchorNode || sel.focusNode;
    const anchorElement = anchorNode && anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
    if (!anchorElement || !el.readerContent.contains(anchorElement)) return null;
    const chapterMeta = getReaderCurrentChapterMeta();
    let selectionRect = null;
    try {
      const range = sel.getRangeAt(0);
      const rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      if (rect) {
        selectionRect = {
          left: Number(rect.left.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        };
      }
    } catch (_err) {}
    return {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      text,
      text_length: text.length,
      trigger: String(trigger || "").trim() || "pointerup",
      selection_rect: selectionRect,
      source_meta: buildReaderSelectionSourceMeta(text),
    };
  }

  function scheduleReaderSelectionTelemetry(trigger, allowEmit) {
    if (!readerSelectionTelemetryState.pointerActive) return;
    if (readerSelectionTelemetryState.timer) {
      clearTimeout(readerSelectionTelemetryState.timer);
      readerSelectionTelemetryState.timer = null;
    }
    readerSelectionTelemetryState.timer = window.setTimeout(() => {
      readerSelectionTelemetryState.timer = null;
      if (!allowEmit) return;
      const payload = buildReaderSelectionTelemetryPayload(trigger);
      readerSelectionTelemetryState.pointerActive = false;
      if (!payload) return;
      const finalSignature = getReaderSelectionSignature();
      if (!finalSignature) return;
      if (readerSelectionTelemetryState.pointerDownKey && finalSignature === readerSelectionTelemetryState.pointerDownKey) {
        return;
      }
      const key = [
        payload.lecture_id,
        payload.book_id,
        payload.chapter_index,
        payload.chapter_title,
        payload.text,
      ].join("::");
      const now = Date.now();
      if (key === readerSelectionTelemetryState.lastKey && (now - readerSelectionTelemetryState.lastAt) < 250) {
        return;
      }
      readerSelectionTelemetryState.lastKey = key;
      readerSelectionTelemetryState.lastAt = now;
      emitTelemetry("reader_text_selection", payload);
    }, 120);
  }

// ─────── HTML & Formatting Utilities ──────────────────────────────────
// ─────── Feed Mention System ──────────────────────────────────────────
  function captureFeedInputSnapshot(inputEl) {
    if (!(inputEl instanceof HTMLInputElement)) return null;
    const feedId = String(inputEl.getAttribute("data-feed-comment-input") || "").trim();
    if (!feedId) return null;
    return {
      feedId,
      selectionStart: Number(inputEl.selectionStart || 0),
      selectionEnd: Number(inputEl.selectionEnd || 0),
    };
  }

  function restoreFeedInputSnapshot(snapshot) {
    if (!snapshot || !el.learningFeedPanel) return;
    window.requestAnimationFrame(() => {
      const target = el.learningFeedPanel.querySelector(`[data-feed-comment-input="${CSS.escape(String(snapshot.feedId || ""))}"]`);
      if (!(target instanceof HTMLInputElement)) return;
      target.focus({ preventScroll: true });
      try {
        target.setSelectionRange(Number(snapshot.selectionStart || 0), Number(snapshot.selectionEnd || 0));
      } catch (_err) {}
    });
  }

  function renderLearningFeedsPreservingInput(inputEl) {
    const snapshot = captureFeedInputSnapshot(inputEl);
    renderLearningFeeds();
    restoreFeedInputSnapshot(snapshot);
  }

  function getFeedMentionMenuElement(feedId) {
    if (!el.learningFeedPanel) return null;
    const key = String(feedId || "").trim();
    if (!key) return null;
    return el.learningFeedPanel.querySelector(`[data-feed-mention-menu="${CSS.escape(key)}"]`);
  }

  function buildFeedMentionMenuHtml(feedId, mentionState) {
    const key = String(feedId || "").trim();
    if (!key || !mentionState || !Array.isArray(mentionState.users) || !mentionState.users.length) return "";
    return mentionState.users.map((userRow, index) => {
      const displayName = getUserOptionDisplayName(userRow) || getUserOptionHandle(userRow);
      const handle = getUserOptionHandle(userRow);
      const avatarUrl = getUserOptionAvatarUrl(userRow);
      const initial = getUserOptionInitial(userRow);
      return `
        <button class="feed-mention-item${index === Number(mentionState.activeIndex || 0) ? " is-active" : ""}" type="button" data-feed-action="mention-pick" data-feed-id="${escapeHtml(key)}" data-mention-index="${index}">
          ${avatarUrl
            ? `<img class="feed-mention-avatar feed-mention-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
            : `<div class="feed-mention-avatar">${escapeHtml(initial)}</div>`}
          <span class="feed-mention-meta">
            <span class="feed-mention-name">${escapeHtml(displayName)}</span>
            <span class="feed-mention-handle">@${escapeHtml(handle)}</span>
          </span>
        </button>
      `;
    }).join("");
  }

  function syncFeedMentionMenus() {
    if (!el.learningFeedPanel) return;
    const mentionState = state.feedMentionState;
    const activeFeedId = mentionState && mentionState.key && String(mentionState.key).startsWith("comment:")
      ? String(mentionState.key).slice("comment:".length)
      : "";
    const menus = el.learningFeedPanel.querySelectorAll("[data-feed-mention-menu]");
    menus.forEach((menuEl) => {
      if (!(menuEl instanceof HTMLElement)) return;
      const feedId = String(menuEl.getAttribute("data-feed-mention-menu") || "").trim();
      const isActive = !!(
        activeFeedId &&
        feedId === activeFeedId &&
        mentionState &&
        mentionState.visible &&
        Array.isArray(mentionState.users) &&
        mentionState.users.length
      );
      if (!isActive) {
        menuEl.innerHTML = "";
        syncFeedMentionMenuVisibility(menuEl, false);
        return;
      }
      menuEl.innerHTML = buildFeedMentionMenuHtml(feedId, mentionState);
      syncFeedMentionMenuVisibility(menuEl, true);
    });
    syncLearningFeedPostMentionMenu();
  }

  function syncFeedMentionMenuVisibility(menuEl, visible) {
    if (!(menuEl instanceof HTMLElement)) return;
    menuEl.hidden = !visible;
    menuEl.style.display = visible ? "grid" : "none";
  }

// ─────── Feed Author & Avatar Helpers ─────────────────────────────────
  function getCurrentUserDisplayName() {
    return String(
      state.user.nickname
      || state.user.display_name
      || state.user.username
      || state.user.id
      || state.user.user_id
      || state.username
      || "用户"
    ).trim() || "用户";
  }

  function getCurrentUserAvatarUrl() {
    return normalizeFeedAvatarUrl(String(state.user.avatar_url || state.user.avatar || state.user.avatarUrl || "").trim());
  }

  function getFeedAuthorName(row) {
    const author = row && typeof row.author === "object" ? row.author : {};
    return String(
      author.nickname
      || author.display_name
      || author.username
      || author.user_id
      || row.username
      || row.user_id
      || "用户"
    ).trim() || "用户";
  }

  function getFeedAuthorAvatarUrl(row) {
    const author = row && typeof row.author === "object" ? row.author : {};
    const avatarUrl = normalizeFeedAvatarUrl(String(author.avatar_url || "").trim());
    if (avatarUrl) return avatarUrl;
    const handle = getFeedAuthorHandle(row);
    if (handle && handle === String(state.username || "").trim()) {
      return getCurrentUserAvatarUrl();
    }
    return "";
  }

  function normalizeFeedAvatarUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    try {
      return new URL(value).toString();
    } catch (_err) {}
    const baseUrl = String((state.integration && state.integration.base_url) || "").trim().replace(/\/+$/, "");
    let safeBaseUrl = "";
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        const host = String(parsed.hostname || "").trim().toLowerCase();
        if (host && !["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(host)) {
          safeBaseUrl = parsed.toString().replace(/\/+$/, "");
        }
      } catch (_err) {}
    }
    if (value.startsWith("/") && safeBaseUrl) {
      return `${safeBaseUrl}${value}`;
    }
    return value;
  }

  function getFeedAuthorInitial(row) {
    const name = getFeedAuthorName(row);
    return (Array.from(name)[0] || "学").toUpperCase();
  }

  function getUserOptionDisplayName(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.nickname || row.display_name || row.username || row.user_id || "").trim();
  }

  function getUserOptionHandle(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.username || row.user_id || "").trim();
  }

  function getUserOptionAvatarUrl(row) {
    if (!row || typeof row !== "object") return "";
    return normalizeFeedAvatarUrl(String(row.avatar_url || row.avatar || "").trim());
  }

  function getUserOptionInitial(row) {
    const name = getUserOptionDisplayName(row);
    return (Array.from(name)[0] || "@" || "用").toUpperCase();
  }

  function getFeedAuthorHandle(row) {
    const author = row && typeof row.author === "object" ? row.author : {};
    return String(author.user_id || row.username || row.user_id || "").trim();
  }

  async function searchFeedUsers(query, limit = 8) {
    const params = new URLSearchParams();
    params.set("q", String(query || ""));
    params.set("limit", String(Math.max(1, Math.min(Number(limit) || 8, 20))));
    const data = await fetchJson(`/api/frontend/learning-feeds/users/search?${params.toString()}`, {
      credentials: "same-origin",
    });
    return Array.isArray(data.items) ? data.items : [];
  }

  function resetFeedMentionState() {
    state.feedMentionState = {
      key: "",
      query: "",
      users: [],
      activeIndex: 0,
      visible: false,
      anchor: null,
      context: "",
    };
  }

  function resolveFeedMentionContext(inputEl) {
    if (!(inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement)) {
      return null;
    }
    const value = String(inputEl.value || "");
    const caret = Number(inputEl.selectionStart || 0);
    const before = value.slice(0, caret);
    const atIndex = before.lastIndexOf("@");
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

  function buildMentionStateKey(inputEl) {
    if (!(inputEl instanceof Element)) return "";
    const feedId = String(inputEl.getAttribute("data-feed-comment-input") || "").trim();
    if (feedId) return `comment:${feedId}`;
    if (inputEl.id === "learningFeedPostInput") return "dynamic-post";
    return "";
  }

  function applyMentionSelectionToInput(inputEl, userRow) {
    const context = resolveFeedMentionContext(inputEl);
    if (!context) return false;
    const handle = getUserOptionHandle(userRow);
    if (!handle) return false;
    const nextValue = `${context.before.slice(0, context.start)}@${handle} ${context.after}`;
    inputEl.value = nextValue;
    const caret = context.before.slice(0, context.start).length + handle.length + 2;
    try {
      inputEl.setSelectionRange(caret, caret);
    } catch (_err) {}
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    resetFeedMentionState();
    syncFeedMentionMenus();
    return true;
  }

  async function updateFeedMentionCandidates(inputEl) {
    const context = resolveFeedMentionContext(inputEl);
    const stateKey = buildMentionStateKey(inputEl);
    if (!context || !stateKey) {
      resetFeedMentionState();
      syncFeedMentionMenus();
      return;
    }
    const query = String(context.query || "");
    const users = await searchFeedUsers(query, 8);
    const nextContext = resolveFeedMentionContext(inputEl);
    const nextStateKey = buildMentionStateKey(inputEl);
    if (!nextContext || nextStateKey !== stateKey || String(nextContext.query || "") !== query) {
      return;
    }
    let visible = users.length > 0;
    if (visible && query) {
      const exactHandle = users.find((row) => getUserOptionHandle(row).toLowerCase() === query.toLowerCase());
      const queryLower = query.toLowerCase();
      const uniquePrefixRows = users.filter((row) => {
        const handle = getUserOptionHandle(row).toLowerCase();
        return handle.startsWith(queryLower);
      });
      if (exactHandle) {
        visible = true;
      } else if (uniquePrefixRows.length === 1) {
        const onlyHandle = getUserOptionHandle(uniquePrefixRows[0]).toLowerCase();
        // If input has already surpassed the only valid handle, hide mention menu.
        // Example: "@teshello" while only "tes" exists.
        if (queryLower.length > onlyHandle.length || !onlyHandle.startsWith(queryLower)) {
          visible = false;
        }
      } else if (!uniquePrefixRows.length) {
        visible = false;
      }
    }
    state.feedMentionState = {
      key: stateKey,
      query,
      users,
      activeIndex: 0,
      visible,
      anchor: {
        feedId: stateKey.startsWith("comment:") ? stateKey.slice("comment:".length) : "",
      },
      context: nextContext,
    };
    syncFeedMentionMenus();
  }

// ─────── UI Confirm & Toast ───────────────────────────────────────────
  function renderTrashIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 4.8h6M5.8 7.2h12.4M8.3 7.2l.8 11c.1.7.6 1.2 1.3 1.2h3.2c.7 0 1.2-.5 1.3-1.2l.8-11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10.2 10.1v5.7M13.8 10.1v5.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    `;
  }

  function openConfirm(message, onConfirm) {
    if (!el.confirmBackdrop || !el.confirmBody || !el.confirmOkBtn || !el.confirmCancelBtn) return;
    state.confirmAction = typeof onConfirm === "function" ? onConfirm : null;
    el.confirmBody.textContent = String(message || "确认执行此操作？");
    el.confirmBackdrop.hidden = false;
    el.confirmBackdrop.style.display = "flex";
  }

  function closeConfirm() {
    if (!el.confirmBackdrop) return;
    el.confirmBackdrop.hidden = true;
    el.confirmBackdrop.style.display = "none";
    state.confirmAction = null;
  }

// ─────── API & Text Parsing Utilities ─────────────────────────────────

// ─────── Host / Parent-Window Bridge ──────────────────────────────────
  function notifyHostInputVisibility(hidden) {
    emitHostPayload("nexora:chat-input:visibility", {
      hidden: !!hidden,
    });
  }

  function emitHostPayload(type, extra = {}) {
    const payload = {
      source: "nexora-learning",
      type: String(type || "").trim(),
      ...(extra && typeof extra === "object" ? extra : {}),
    };
    try {
      window.dispatchEvent(new CustomEvent(payload.type, { detail: payload }));
    } catch (_err) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (_err) {}
    return payload;
  }

  function notifyHostPointerDown() {
    emitHostPayload("nexora:learning:pointerdown");
  }

  document.addEventListener("pointerdown", notifyHostPointerDown, {
    capture: true,
    passive: true,
  });

  function getRuntimeUsername() {
    const q = new URLSearchParams(window.location.search);
    const stateUser = state && state.user && typeof state.user === "object" ? state.user : {};
    return String(
      state.username ||
      stateUser.id ||
      stateUser.username ||
      q.get("username") ||
      window.NEXORA_USERNAME ||
      window.nexoraUsername ||
      ""
    ).trim();
  }

  function syncTelemetryUserId() {
    const username = String(state.username || "").trim();
    window.NEXORA_USERNAME = username;
    window.nexoraUsername = username;
    const telemetry = window.NXLTelemetry;
    if (telemetry && typeof telemetry.setUserId === "function") {
      telemetry.setUserId(username);
    }
  }

