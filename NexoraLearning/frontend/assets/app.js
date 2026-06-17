(function () {
// ─────── Constants & DOM References ───────────────────────────────────
  "use strict";

  const el = {
    learningPanel: document.getElementById("learningPanel"),
    dashboardView: document.getElementById("dashboardView"),
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
    learningFeedComposeBtn: document.getElementById("learningFeedComposeBtn"),
    feedLayout: document.getElementById("feedLayout"),
    feedChannelSidebar: document.getElementById("feedChannelSidebar"),
    feedChannelList: document.getElementById("feedChannelList"),
    feedContentArea: document.getElementById("feedContentArea"),
    dashboardProgressTabBtn: document.getElementById("dashboardProgressTabBtn"),
    dashboardProgressFeedTabBtn: document.getElementById("dashboardProgressFeedTabBtn"),
    dashboardPieTabBtn: document.getElementById("dashboardPieTabBtn"),
    dashboardProfileTabBtn: document.getElementById("dashboardProfileTabBtn"),
    userProfileDimensions: document.getElementById("userProfileDimensions"),
    userProfileCard: document.getElementById("userProfileCard"),
    profileAdminSettingsBtn: document.getElementById("profileAdminSettingsBtn"),
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
    courseHomeTab: "books",
    courseVideoCache: {},
    learningReportCache: {},
    learningPathSideTab: "outline",
    catalogContext: null,
    learningPathCache: {},
    learningPathOpenTarget: null,
    lpOutlineCollapsed: false,
    lpChapterAutoScroll: true,
    lpChapterScrollUnbind: null,
    lpChapterStreamKey: "",
    teacherEditContext: null,
    materialsSortBy: "updated_at",
    materialsSortOrder: "desc",
    settingsLogs: [],
    settingsLogSources: [],
    settingsLogCategory: "all",
    settingsLogSource: "",
    questionBankItems: [],
    learningFeeds: [],
    learningFeedChannels: [],
    selectedFeedChannelId: "public_all",
    dashboardSideTab: "progress",
    dashboardPieTab: "profile",
    userProfile: null,
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
    lpChapterGeneratingIndex: -1,
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
    readerBookDetailXml: "",
    readerGuidePromptedKey: "",
    dynamicPosting: false,
    confirmAction: null,
    readerSessionProgress: {},  // { "lectureId::bookId": { completedIndices: Set, currentChapterIndex: 0 } }
    readerSectionsData: {},     // { chapterName: { range, sessions: [{name, range, summary}] } }
    readerAnnotations: [],      // [{ chapterName, offset, length, type, content, anchorText }]
  };
  let readerContextSyncTimer = null;
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
    if (inputEl.id === "messageInput") return "dynamic-post";
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

// ─────── Toast, Confirm Modal & View Management ───────────────────────
  function showToast(msg) {
    let toast = document.querySelector(".toast-notification");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast-notification";
      document.body.appendChild(toast);
    }
    toast.textContent = String(msg || "");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function readLearningPathOutlineCollapsed() {
    try {
      return localStorage.getItem(LP_OUTLINE_COLLAPSED_STORAGE_KEY) === "1";
    } catch (_err) {
      return false;
    }
  }

  function setLearningPathOutlineCollapsed(collapsed, persist) {
    const next = !!collapsed;
    state.lpOutlineCollapsed = next;
    if (el.learningPathView) {
      el.learningPathView.classList.toggle("is-outline-collapsed", next);
    }
    if (el.learningPathOutlinePane) {
      el.learningPathOutlinePane.classList.toggle("is-collapsed", next);
    }
    if (el.learningPathOutlineToggle) {
      el.learningPathOutlineToggle.setAttribute("aria-expanded", next ? "false" : "true");
      el.learningPathOutlineToggle.setAttribute("aria-label", next ? "展开学习大纲" : "收起学习大纲");
      el.learningPathOutlineToggle.setAttribute("title", next ? "展开学习大纲" : "收起学习大纲");
    }
    if (persist) {
      try {
        localStorage.setItem(LP_OUTLINE_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch (_err) {}
    }
  }

  function normalizeLearningPathOpenTarget(options) {
    const opts = options && typeof options === "object" ? options : {};
    const outlineSectionId = String(opts.outlineSectionId || "").trim();
    const rawChapterIndex = Number(opts.chapterIndex);
    const chapterIndex = Number.isInteger(rawChapterIndex) && rawChapterIndex >= 0 ? rawChapterIndex : -1;

    if (!outlineSectionId && chapterIndex < 0) {
      return null;
    }

    return { outlineSectionId, chapterIndex };
  }

  function applyLearningPathOpenTarget(chapters) {
    const target = state.learningPathOpenTarget;

    if (!target || !Array.isArray(chapters) || !chapters.length) {
      return;
    }

    let nextChapterIndex = -1;

    if (target.outlineSectionId) {
      nextChapterIndex = chapters.findIndex((chapter) => {
        const outlineSectionId = String(chapter && chapter.outline_section_id || "").trim();
        return outlineSectionId === target.outlineSectionId;
      });
    }

    if (
      nextChapterIndex < 0 &&
      Number.isInteger(target.chapterIndex) &&
      target.chapterIndex >= 0 &&
      target.chapterIndex < chapters.length
    ) {
      nextChapterIndex = target.chapterIndex;
    }

    if (nextChapterIndex >= 0) {
      state.currentChapterIndex = nextChapterIndex;
    }

    state.learningPathOpenTarget = null;
  }

  function openLearningPathView(lectureId, options) {
    const resolvedLectureId = String(lectureId || "").trim();
    const target = normalizeLearningPathOpenTarget(options);
    state.selectedLectureId = resolvedLectureId;
    state.learningPathStage = "loading";
    state.learningPathData = null;
    state.currentChapterIndex = target && target.chapterIndex >= 0 ? target.chapterIndex : -1;
    state.learningPathOpenTarget = target;
    state.lpQuestions = null;
    state.lpQADraft = "";
    state.lpPathDraft = "";
    state.lpChapterDraft = "";
    state.lpChapterGeneratingIndex = -1;
    state.lpChapterStreamKey = "";
    setView("learningPath");
    renderLearningPathView(resolvedLectureId);
    autoLoadLearningPath(resolvedLectureId);
  }

  async function autoLoadLearningPath(lectureId) {
    try {
      const resp = await fetch("/api/frontend/personalized-learning/load-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lecture_id: lectureId }),
      });
      const data = await resp.json();
      if (data.success && data.cached) {
        state.learningPathStage = "path-ready";
        state.learningPathData = data;
        applyLearningPathOpenTarget(data.chapters);
        const generationRows = Array.isArray(data.chapter_generations)
          ? data.chapter_generations
          : (data.chapter_generation && typeof data.chapter_generation === "object" ? [data.chapter_generation] : []);
        const selectedChapterIndex = Number(state.currentChapterIndex);
        const chapterGeneration = generationRows.find((row) => {
          const idx = Number(row && row.chapter_index);
          return (
            row &&
            String(row.status || "").trim().toLowerCase() === "running" &&
            Number.isInteger(idx) &&
            idx === selectedChapterIndex
          );
        }) || (
          selectedChapterIndex < 0
            ? generationRows.find((row) => row && String(row.status || "").trim().toLowerCase() === "running")
            : null
        );
        const activeChapterIndex = Number(chapterGeneration && chapterGeneration.chapter_index);
        if (
          chapterGeneration &&
          String(chapterGeneration.status || "").trim().toLowerCase() === "running" &&
          Number.isInteger(activeChapterIndex) &&
          activeChapterIndex >= 0 &&
          Array.isArray(data.chapters) &&
          activeChapterIndex < data.chapters.length &&
          (selectedChapterIndex < 0 || selectedChapterIndex === activeChapterIndex)
        ) {
          state.currentChapterIndex = activeChapterIndex;
          state.lpChapterGeneratingIndex = activeChapterIndex;
          void generatePersonalizedChapterContent(lectureId, activeChapterIndex);
          return;
        }
        renderLearningPathView(lectureId);
      } else {
        state.learningPathStage = "ready";
        renderLearningPathView(lectureId);
      }
    } catch (e) {
      state.learningPathStage = "ready";
      renderLearningPathView(lectureId);
    }
  }

  function renderLearningPathView(lectureId) {
    const md = el.learningPathMarkdown;
    const outline = el.learningPathOutline;
    if (!md || !outline) return;

    clearLearningPathFloatingActions();

    const stage = state.learningPathStage || "loading";

    if (stage !== "path-ready") {
      renderLearningPathSidePanel(lectureId);
    }

    if (stage === "no-outline") {
      md.innerHTML = `
        <div class="learning-path-empty">
          <div class="learning-path-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 6h16M4 12h16M4 18h10"></path>
            </svg>
          </div>
          <div class="learning-path-empty-text">大纲尚未生成</div>
          <div class="learning-path-empty-hint">请等待管理员先在课程管理中生成课程大纲</div>
        </div>
      `;
      return;
    }

    if (stage === "ready" || stage === "qa" || stage === "qa-loading" || stage === "qa-ready") {
      renderLearningPathQA(md, lectureId);
      return;
    }

    if (stage === "generating") {
      md.innerHTML = renderLearningPathGeneratingPanel(
        "正在生成个性化学习路线",
        state.lpPathDraft
      );
      return;
    }

    if (stage === "generating-chapter") {
      renderLearningPathChapterStreamingView(md);
      return;
    }

    if (stage === "path-ready") {
      renderLearningPathChapterView(md, lectureId);
      return;
    }

    md.innerHTML = `
      <div class="learning-path-empty">
        <div class="learning-path-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v6l4 2"></path>
          </svg>
        </div>
        <div class="learning-path-empty-text">加载中</div>
        <div class="learning-path-empty-hint">正在检查学习路线...</div>
      </div>
    `;
  }

  function renderLearningPathEmptyOutline(container) {
    if (!container) return;

    container.innerHTML = `
      <div class="lp-outline-empty">
        <div class="lp-outline-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 6h16M4 12h16M4 18h10"></path>
          </svg>
        </div>
        <div class="lp-outline-empty-text">请开始个性化学习路线</div>
      </div>
    `;
  }

  function getLearningPathCurrentChapterReportOptions() {
    const pathData = state.learningPathData;
    const chapters = pathData && Array.isArray(pathData.chapters) ? pathData.chapters : [];
    const idx = Number(state.currentChapterIndex);

    if (!Number.isInteger(idx) || idx < 0 || idx >= chapters.length) {
      return {};
    }

    const chapter = chapters[idx] || {};
    const options = { chapterIndex: idx };
    const bookId = String(chapter.book_id || "").trim();

    if (bookId) {
      options.bookId = bookId;
    }

    return options;
  }

  function syncLearningPathSideTabs() {
    const activeTab = state.learningPathSideTab === "report" ? "report" : "outline";
    state.learningPathSideTab = activeTab;

    [el.learningPathOutlineTab, el.learningPathReportTab].forEach((tab) => {
      if (!tab) return;

      const isActive = String(tab.getAttribute("data-lp-side-tab") || "") === activeTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    if (el.learningPathOutlinePane) {
      el.learningPathOutlinePane.setAttribute("data-side-tab", activeTab);
    }
  }

  function renderLearningPathSidePanel(lectureId) {
    const container = el.learningPathOutline;
    if (!container) return;

    syncLearningPathSideTabs();

    if (state.learningPathSideTab === "report") {
      renderLearningPathReportPanel(container, lectureId);
      return;
    }

    const stage = state.learningPathStage || "loading";
    const pathData = state.learningPathData;
    const hasPathChapters = !!(
      pathData &&
      Array.isArray(pathData.chapters) &&
      pathData.chapters.length
    );

    if ((stage === "path-ready" || stage === "generating-chapter") && hasPathChapters) {
      renderLearningPathOutline(container, pathData.chapters, lectureId);
      return;
    }

    renderLearningPathEmptyOutline(container);
  }

  async function renderLearningPathReportPanel(container, lectureId) {
    if (!container) return;

    const resolvedLectureId = String(lectureId || state.selectedLectureId || "").trim();

    if (!resolvedLectureId) {
      container.innerHTML = '<div class="learning-report-empty-line">缺少课程 ID</div>';
      return;
    }

    const options = getLearningPathCurrentChapterReportOptions();
    const requestKey = getLearningReportCacheKey(resolvedLectureId, options);
    container.dataset.learningReportKey = requestKey;
    container.innerHTML = renderLearningReportLoading("正在加载学习报告...");

    try {
      const report = await fetchLearningReport(resolvedLectureId, options);

      if (container.dataset.learningReportKey !== requestKey || state.learningPathSideTab !== "report") {
        return;
      }

      container.innerHTML = renderLearningReportPanel(report, { compact: true });
    } catch (err) {
      if (container.dataset.learningReportKey !== requestKey || state.learningPathSideTab !== "report") {
        return;
      }

      container.innerHTML = `<div class="learning-report-error">${escapeHtml(err && err.message ? err.message : "学习报告加载失败")}</div>`;
    }
  }

  function isLearningPathChapterCompleted(chapter) {
    return !!(
      chapter &&
      (
        chapter.learning_completed === true ||
        String(chapter.status || "").trim().toLowerCase() === "completed"
      )
    );
  }

  function getLearningPathChapterStatus(chapter) {
    const completed = isLearningPathChapterCompleted(chapter);
    const generated = !!(chapter && chapter.content_generated);
    const rawStatus = String(chapter && chapter.status || "").trim().toLowerCase();

    if (completed) {
      return { className: "is-completed", label: "已完成", title: "学习已完成" };
    }

    if (generated) {
      return { className: "is-generated", label: "可学习", title: "学习素材已生成" };
    }

    if (rawStatus === "current") {
      return { className: "is-current", label: "当前待学", title: "当前待学" };
    }

    if (rawStatus === "recommended") {
      return { className: "is-recommended", label: "推荐", title: "推荐学习" };
    }

    return { className: "", label: "", title: "普通章节" };
  }

    // 渲染右侧学习大纲，收起动画由外层状态类驱动。
    function renderLearningPathOutline(container, chapters, lectureId) {
        let html = '<div class="lp-outline-list">';
        const generatingIndex = Number(state.lpChapterGeneratingIndex);
        const activeIndex = state.learningPathStage === "generating-chapter" &&
          Number.isInteger(generatingIndex) &&
          generatingIndex >= 0
            ? generatingIndex
            : state.currentChapterIndex;

        chapters.forEach((ch, idx) => {
            const isActive = activeIndex === idx;
            const completed = isLearningPathChapterCompleted(ch);
            const status = getLearningPathChapterStatus(ch);
            const activeAttr = isActive ? ' aria-current="step"' : "";

            html += `
                <button class="lp-outline-item ${isActive ? "is-active" : ""} ${status.className}" type="button" data-index="${idx}" title="${escapeHtml(status.title)}"${activeAttr}>
                  <span class="lp-outline-rail" aria-hidden="true"></span>
                  <span class="lp-outline-num">${idx + 1}</span>
                  <span class="lp-outline-copy">
                    <span class="lp-outline-text">${escapeHtml(ch.name || "")}</span>
                    ${status.label ? `<span class="lp-outline-status">${escapeHtml(status.label)}</span>` : ""}
                  </span>
                  ${completed ? '<span class="lp-outline-check" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg></span>' : ""}
                </button>
            `;
        });

        html += "</div>";
        container.innerHTML = html;

        container.querySelectorAll(".lp-outline-item").forEach((item) => {
            item.addEventListener("click", () => {
                const idx = parseInt(item.dataset.index, 10);
                if (
                  state.learningPathStage === "generating-chapter" &&
                  Number.isInteger(generatingIndex) &&
                  generatingIndex >= 0 &&
                  idx !== generatingIndex
                ) {
                  state.learningPathStage = "path-ready";
                  state.lpChapterGeneratingIndex = -1;
                  state.lpChapterStreamKey = "";
                }
                state.currentChapterIndex = idx;
                renderLearningPathView(lectureId);
            });
        });
    }

  function renderLearningPathChapterView(md, lectureId) {
    const pathData = state.learningPathData;
    if (!pathData || !pathData.chapters) return;

    const chapters = pathData.chapters;
    const idx = state.currentChapterIndex;

    if (idx < 0 || idx >= chapters.length) {
      state.currentChapterIndex = 0;
      renderLearningPathChapterView(md, lectureId);
      return;
    }

    const chapter = chapters[idx];
    renderLearningPathSidePanel(lectureId);

    if (chapter.content_generated) {
      loadLearningPathChapterContent(md, lectureId, idx, chapter);
    } else {
      showChapterGenerateView(md, lectureId, idx, chapter);
    }
  }

  async function loadLearningPathChapterContent(md, lectureId, chapterIndex, chapter) {
    md.innerHTML = `
      <div class="learning-path-empty">
        <div class="learning-path-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="spin-icon">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
        </div>
        <div class="learning-path-empty-text">加载章节内容</div>
      </div>
    `;

    try {
      const data = await fetchJson("/api/frontend/personalized-learning/load-chapter", {
        method: "POST",
        body: JSON.stringify({ lecture_id: lectureId, chapter_index: chapterIndex }),
      });
      if (data.success && data.cached) {
        renderChapterMarkdown(md, lectureId, chapterIndex, chapter, data.content);
      } else {
        showChapterGenerateView(md, lectureId, chapterIndex, chapter);
      }
    } catch (e) {
      showChapterGenerateView(md, lectureId, chapterIndex, chapter);
    }
  }

  function stripLearningPathContentMarker(content) {
    const text = String(content || "");
    const markerIndex = text.indexOf(LP_CHAPTER_CONTENT_MARKER);

    if (markerIndex < 0) {
      return text;
    }

    return text.slice(markerIndex + LP_CHAPTER_CONTENT_MARKER.length).trimStart();
  }

  function cleanupLearningPathChapterStreamingScroll() {
    if (typeof state.lpChapterScrollUnbind === "function") {
      state.lpChapterScrollUnbind();
      state.lpChapterScrollUnbind = null;
    }
  }

    function clearLearningPathFloatingActions() {
        if (!el.learningPathFloatingActions) return;

        el.learningPathFloatingActions.innerHTML = "";
        el.learningPathFloatingActions.hidden = true;
    }

    // 章节级操作按钮固定跟随返回按钮，避免正文标题区承担导航操作。
    function renderLearningPathFloatingActions(lectureId, chapterIndex, chapter, completed) {
        if (!el.learningPathFloatingActions) return;

        el.learningPathFloatingActions.hidden = false;
        el.learningPathFloatingActions.innerHTML = `
            <button class="learning-path-float-action" type="button" data-lp-action="complete" ${completed ? "disabled" : ""} aria-label="${completed ? "已完成" : "完成学习"}" title="${completed ? "已完成" : "完成学习"}">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 6 9 17l-5-5"></path>
              </svg>
            </button>
            <button class="learning-path-float-action" type="button" data-lp-action="quiz" aria-label="做题" title="做题">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 11h6"></path>
                <path d="M9 15h4"></path>
                <path d="M8 3h8l3 3v15H5V3h3z"></path>
                <path d="M16 3v4h4"></path>
              </svg>
            </button>
        `;

        bindLearningPathChapterActions(el.learningPathFloatingActions, lectureId, chapterIndex, chapter);
    }

  function renderChapterMarkdown(md, lectureId, chapterIndex, chapter, content) {
    cleanupLearningPathChapterStreamingScroll();

    const markdown = stripLearningPathContentMarker(content);
    const completed = isLearningPathChapterCompleted(chapter);
    const chapterName = String(chapter && chapter.name || "").trim();
    const bookTitle = String(chapter && chapter.book_title || "").trim();

    md.innerHTML = `
        <div class="lp-chapter-view">
          <div class="lp-chapter-header">
            <div class="lp-chapter-title">${escapeHtml(chapterName)}</div>
            <div class="lp-chapter-meta">${escapeHtml(bookTitle)}</div>
          </div>
          <div class="lp-chapter-content">${renderMarkdownSimple(markdown)}</div>
        </div>
    `;

    renderLearningPathFloatingActions(lectureId, chapterIndex, chapter, completed);
    emitLearningPathChapterOpenTelemetry(lectureId, chapterIndex, chapter);
  }

  function bindLearningPathChapterActions(md, lectureId, chapterIndex, chapter) {
    const completeBtn = md.querySelector('[data-lp-action="complete"]');
    if (completeBtn) {
      completeBtn.addEventListener("click", () => {
        markLearningPathChapterComplete(lectureId, chapterIndex, chapter);
      });
    }

    const quizBtn = md.querySelector('[data-lp-action="quiz"]');
    if (quizBtn) {
      quizBtn.addEventListener("click", () => {
        loadPersonalizedChapterQuiz(lectureId, chapterIndex, chapter);
      });
    }
  }

  function emitLearningPathChapterOpenTelemetry(lectureId, chapterIndex, chapter) {
    if (!chapter) return;
    emitTelemetry("reader_open", {
      lecture_id: String(lectureId || "").trim(),
      book_id: String(chapter.book_id || "").trim(),
      chapter_index: Number(chapterIndex) || 0,
      chapter_title: String(chapter.name || "").trim(),
      chapter_name: String(chapter.name || "").trim(),
      chapter_range: String(chapter.chapter_range || "").trim(),
      view_mode: "learning_path_article",
      trigger_source: "learning_path",
    });
  }

  function emitLearningPathScrollTelemetry() {
    const pathData = state.learningPathData || {};
    const chapters = Array.isArray(pathData.chapters) ? pathData.chapters : [];
    const idx = Number(state.currentChapterIndex);
    const chapter = Number.isInteger(idx) && idx >= 0 ? chapters[idx] : null;
    if (!chapter || !chapter.content_generated) return;

    const scrollPane = el.learningPathMarkdown ? el.learningPathMarkdown.closest(".learning-path-main-pane") : null;
    if (!scrollPane) return;

    const scrollHeight = Number(scrollPane.scrollHeight || 0);
    const clientHeight = Number(scrollPane.clientHeight || 0);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const scrollTop = Number(scrollPane.scrollTop || 0);
    const scrollPercent = maxScroll > 0 ? scrollTop / maxScroll : 0;

    emitTelemetry("reader_scroll", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(chapter.book_id || "").trim(),
      chapter_index: idx,
      chapter_title: String(chapter.name || "").trim(),
      chapter_name: String(chapter.name || "").trim(),
      chapter_range: String(chapter.chapter_range || "").trim(),
      view_mode: "learning_path_article",
      trigger_source: "learning_path",
      scroll_top: scrollTop,
      scroll_height: scrollHeight,
      client_height: clientHeight,
      scroll_percent: Number(scrollPercent.toFixed(4)),
    });
  }

  async function markLearningPathChapterComplete(lectureId, chapterIndex, chapter) {
    const resolvedLectureId = String(lectureId || "").trim();
    const idx = Number(chapterIndex) || 0;
    if (!resolvedLectureId || !chapter) return;

    const ok = await confirmModalAsync(`确认已完成「${String(chapter.name || "本章").trim()}」的学习？`);
    if (!ok) return;

    try {
      const result = await fetchJson("/api/frontend/personalized-learning/chapter-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: resolvedLectureId,
          chapter_index: idx,
        }),
      });

      if (Array.isArray(result.chapters)) {
        state.learningPathData = Object.assign({}, state.learningPathData || {}, {
          chapters: result.chapters,
        });
      } else if (state.learningPathData && Array.isArray(state.learningPathData.chapters)) {
        state.learningPathData.chapters[idx] = Object.assign({}, state.learningPathData.chapters[idx] || {}, {
          status: "completed",
          learning_completed: true,
          completed_at: Math.floor(Date.now() / 1000),
        });
      }

      emitTelemetry("reader_chapter_complete", {
        lecture_id: resolvedLectureId,
        book_id: String(chapter.book_id || "").trim(),
        chapter_index: idx,
        chapter_name: String(chapter.name || "").trim(),
        chapter_title: String(chapter.name || "").trim(),
        chapter_range: String(chapter.chapter_range || "").trim(),
        view_mode: "learning_path_article",
        trigger_source: "learning_path",
      });

      invalidateLearningReportCache(resolvedLectureId);
      state.learningPathStage = "path-ready";
      renderLearningPathView(resolvedLectureId);
      showToast(result.already_completed ? "此前已完成本章" : "已完成本章学习");
      await loadDashboardRows();
      renderProgressList();
      renderPie();
      renderLearningFeeds();
    } catch (err) {
      showToast(err && err.message ? err.message : "完成状态保存失败");
    }
  }

  async function loadPersonalizedChapterQuiz(lectureId, chapterIndex, chapter) {
    const resolvedLectureId = String(lectureId || "").trim();
    const idx = Number(chapterIndex) || 0;
    if (!resolvedLectureId || !chapter) return;

    const bookId = String(chapter.book_id || "").trim();
    const chapterName = String(chapter.name || "").trim();
    const chapterRange = String(chapter.chapter_range || "").trim();
    if (!bookId || !chapterName) {
      showToast("当前章节缺少教材信息，暂时不能做题");
      return;
    }

    const currentMeta = quizState.currentMeta || {};
    if (
      String(currentMeta.quizType || "") === "personalized_chapter" &&
      String(currentMeta.lectureId || "") === resolvedLectureId &&
      String(currentMeta.bookId || "") === bookId &&
      Number(currentMeta.chapterIndex) === idx &&
      Array.isArray(quizState.questions) &&
      quizState.questions.length
    ) {
      openFloatingPanel();
      setFloatingTab("quiz");
      renderQuizPanel();
      return;
    }

    quizState.loading = true;
    quizState.error = null;
    quizState.currentChapter = chapterName;
    quizState.currentSession = "学习素材练习";
    quizState.currentMeta = {
      quizType: "personalized_chapter",
      quizId: "",
      lectureId: resolvedLectureId,
      bookId,
      chapterIndex: idx,
      sessionIndex: 0,
      chapterName,
      sessionName: "学习素材练习",
      chapterRange,
    };
    quizState.questions = [];
    quizState.answers = {};
    renderQuizPanel();
    openFloatingPanel();
    setFloatingTab("quiz");

    try {
      const result = await fetchJson("/api/frontend/personalized-learning/chapter-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: resolvedLectureId,
          chapter_index: idx,
        }),
      });

      const quiz = result && result.quiz && typeof result.quiz === "object" ? result.quiz : {};
      const questions = Array.isArray(result.questions) ? result.questions : Array.isArray(quiz.questions) ? quiz.questions : [];
      const answers = result.answers && typeof result.answers === "object" ? result.answers : quiz.answers && typeof quiz.answers === "object" ? quiz.answers : {};
      const quizId = String(result.quiz_id || quiz.quiz_id || "").trim();

      if (!quizId || !questions.length) {
        throw new Error("本章练习没有返回有效题目");
      }

      quizState.questions = questions;
      quizState.answers = answers;
      quizState.currentMeta = {
        quizType: "personalized_chapter",
        quizId,
        lectureId: resolvedLectureId,
        bookId,
        chapterIndex: idx,
        sessionIndex: 0,
        chapterName,
        sessionName: "学习素材练习",
        chapterRange,
      };
      writeStoredQuiz(getCurrentQuizKey(), quizState.questions, quizState.answers, quizState.currentMeta);
      saveQuizState();
    } catch (err) {
      quizState.error = err && err.message ? err.message : "本章练习加载失败";
    } finally {
      quizState.loading = false;
      renderQuizPanel();
    }
  }

  function renderLearningPathChapterStreamingView(md) {
    const pathData = state.learningPathData || {};
    const chapters = Array.isArray(pathData.chapters) ? pathData.chapters : [];
    const generatingIndex = Number(state.lpChapterGeneratingIndex);
    const chapterIndex = Number.isInteger(generatingIndex) && generatingIndex >= 0
      ? generatingIndex
      : Math.max(0, Number(state.currentChapterIndex) || 0);
    const chapter = chapters[chapterIndex] || {};
    const draft = String(state.lpChapterDraft || "");
    const bodyHtml = draft.trim()
      ? renderMarkdownSimple(draft)
      : '<p class="lp-chapter-stream-placeholder">等待模型输出正文...</p>';

    md.innerHTML = `
      <div class="lp-chapter-view is-streaming">
        <div class="lp-chapter-header">
          <div class="lp-chapter-title">${escapeHtml(chapter.name || "章节内容")}</div>
          <div class="lp-chapter-meta">${escapeHtml(chapter.book_title || "")}</div>
        </div>
        <div class="lp-chapter-stream-status">
          <span class="quiz-loading-spinner"></span>
          <span>正在生成章节阅读</span>
        </div>
        <div class="lp-chapter-content" data-lp-chapter-stream-content>${bodyHtml}</div>
        <button class="lp-chapter-resume-scroll" type="button" data-lp-chapter-resume-scroll hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          <span>继续滚动</span>
        </button>
      </div>
    `;

    bindLearningPathChapterStreamingScroll();
  }

  function isLearningPathScrollNearBottom(scrollPane) {
    if (!scrollPane) return true;

    const distance = scrollPane.scrollHeight - scrollPane.scrollTop - scrollPane.clientHeight;

    return distance <= 48;
  }

  function updateLearningPathResumeScrollButton(scrollPane) {
    const button = document.querySelector("#learningPathMarkdown [data-lp-chapter-resume-scroll]");
    if (!button) return;

    const shouldShow = !state.lpChapterAutoScroll && !isLearningPathScrollNearBottom(scrollPane);
    button.hidden = !shouldShow;
  }

  function bindLearningPathChapterStreamingScroll() {
    const contentEl = document.querySelector("#learningPathMarkdown [data-lp-chapter-stream-content]");
    const scrollPane = contentEl ? contentEl.closest(".learning-path-main-pane") : null;
    const button = document.querySelector("#learningPathMarkdown [data-lp-chapter-resume-scroll]");

    if (!scrollPane || !button) return;

    if (typeof state.lpChapterScrollUnbind === "function") {
      state.lpChapterScrollUnbind();
      state.lpChapterScrollUnbind = null;
    }

    const handleScroll = () => {
      state.lpChapterAutoScroll = isLearningPathScrollNearBottom(scrollPane);
      updateLearningPathResumeScrollButton(scrollPane);
    };

    const resumeScroll = () => {
      state.lpChapterAutoScroll = true;
      scrollPane.scrollTop = scrollPane.scrollHeight;
      updateLearningPathResumeScrollButton(scrollPane);
    };

    scrollPane.addEventListener("scroll", handleScroll, { passive: true });
    button.addEventListener("click", resumeScroll);

    state.lpChapterScrollUnbind = () => {
      scrollPane.removeEventListener("scroll", handleScroll);
      button.removeEventListener("click", resumeScroll);
    };

    updateLearningPathResumeScrollButton(scrollPane);
  }

  function updateLearningPathChapterStreamingMarkdown(markdown) {
    const contentEl = document.querySelector("#learningPathMarkdown [data-lp-chapter-stream-content]");
    if (!contentEl) return;

    const text = String(markdown || "");
    contentEl.innerHTML = text.trim()
      ? renderMarkdownSimple(text)
      : '<p class="lp-chapter-stream-placeholder">等待模型输出正文...</p>';

    const scrollPane = contentEl.closest(".learning-path-main-pane");
    if (!scrollPane) return;

    if (state.lpChapterAutoScroll) {
      requestAnimationFrame(() => {
        scrollPane.scrollTop = scrollPane.scrollHeight;
        updateLearningPathResumeScrollButton(scrollPane);
      });
    } else {
      updateLearningPathResumeScrollButton(scrollPane);
    }
  }

  function showChapterGenerateView(md, lectureId, chapterIndex, chapter) {
    cleanupLearningPathChapterStreamingScroll();

    md.innerHTML = `
      <div class="learning-path-empty">
        <div class="learning-path-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        </div>
        <div class="learning-path-empty-text">${escapeHtml(chapter.name || "")}</div>
        <div class="learning-path-empty-hint">${escapeHtml(chapter.reason || "点击下方按钮生成章节内容")}</div>
        <button class="learning-path-start-btn-lg" id="lpGenChapterBtn" type="button">生成章节内容</button>
      </div>
    `;

    const genBtn = document.getElementById("lpGenChapterBtn");
    if (genBtn) {
      genBtn.addEventListener("click", () => {
        generatePersonalizedChapterContent(lectureId, chapterIndex);
      });
    }
  }

  async function fetchPersonalizedLearningStream(url, onDelta, onEvent) {
    const response = await fetch(resolveApiUrl(url), {
      method: "GET",
      credentials: "same-origin",
      headers: { "X-Nexora-Username": getRuntimeUsername() },
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = String((data && (data.error || data.message)) || message);
      } catch (_err) {}
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("流式响应体为空");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult = null;

    const handleBlock = (block) => {
      const parsed = parseReaderGuideSseBlock(block);
      if (!parsed) return;

      if (parsed.eventName === "delta") {
        const piece = String((parsed.data && parsed.data.content) || "");
        if (piece && typeof onDelta === "function") {
          onDelta(piece, parsed.data || {});
        }
      } else if (parsed.eventName === "status") {
        if (typeof onEvent === "function") {
          onEvent(parsed.eventName, parsed.data || {});
        }
        const message = String((parsed.data && parsed.data.message) || "").trim();
        if (message && typeof onDelta === "function") {
          onDelta(`[状态] ${message}\n`);
        }
      } else if (parsed.eventName === "done") {
        if (typeof onEvent === "function") {
          onEvent(parsed.eventName, parsed.data || {});
        }
        finalResult = parsed.data;
      } else if (parsed.eventName === "error") {
        if (typeof onEvent === "function") {
          onEvent(parsed.eventName, parsed.data || {});
        }
        throw new Error(String((parsed.data && parsed.data.error) || "流式生成失败"));
      }
    };

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      blocks.forEach(handleBlock);
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult || finalResult.success !== true) {
      throw new Error("流式结果不完整");
    }

    return finalResult;
  }

async function generatePersonalizedChapterContent(lectureId, chapterIndex) {
    const requestedChapterIndex = Number(chapterIndex);
    const streamKey = `${String(lectureId || "").trim()}::${requestedChapterIndex}::${Date.now()}`;
    state.learningPathStage = "generating-chapter";
    state.lpChapterDraft = "";
    state.lpChapterAutoScroll = true;
    state.currentChapterIndex = requestedChapterIndex;
    state.lpChapterGeneratingIndex = requestedChapterIndex;
    state.lpChapterStreamKey = streamKey;
    renderLearningPathView(lectureId);

    let streamingChapterIndex = requestedChapterIndex;
    let markerBuffer = "";
    let markdownDraft = "";
    let contentStarted = false;

    try {
      const result = await fetchPersonalizedLearningStream(
        `/api/frontend/personalized-learning/generate-chapter-stream?lecture_id=${encodeURIComponent(lectureId)}&chapter_index=${requestedChapterIndex}`,
        (delta, deltaData) => {
          if (state.lpChapterStreamKey !== streamKey) return;
          const deltaChapterIndex = Number(deltaData && deltaData.chapter_index);
          if (
            Number.isInteger(deltaChapterIndex) &&
            deltaChapterIndex >= 0 &&
            deltaChapterIndex !== requestedChapterIndex
          ) {
            return;
          }
          const piece = String(delta || "");

          if (!piece) return;

          if (!contentStarted) {
            markerBuffer = `${markerBuffer}${piece}`;
            const markerIndex = markerBuffer.indexOf(LP_CHAPTER_CONTENT_MARKER);

            if (markerIndex < 0) return;

            contentStarted = true;
            markdownDraft = markerBuffer.slice(markerIndex + LP_CHAPTER_CONTENT_MARKER.length).trimStart();
            markerBuffer = "";
          } else {
            markdownDraft = `${markdownDraft}${piece}`;
          }

          state.lpChapterDraft = markdownDraft;
          updateLearningPathChapterStreamingMarkdown(markdownDraft);
        }
        ,
        (eventName, eventData) => {
          if (eventName !== "status") return;
          if (state.lpChapterStreamKey !== streamKey) return;
          const activeIndex = Number(eventData && eventData.chapter_index);
          if (
            Number.isInteger(activeIndex) &&
            activeIndex >= 0 &&
            activeIndex === requestedChapterIndex &&
            activeIndex !== streamingChapterIndex
          ) {
            streamingChapterIndex = activeIndex;
            state.currentChapterIndex = activeIndex;
            state.lpChapterGeneratingIndex = activeIndex;
            state.lpChapterDraft = "";
            markerBuffer = "";
            markdownDraft = "";
            contentStarted = false;
            renderLearningPathView(lectureId);
          }
        }
      );

      const resultChapterIndex = Number.isInteger(Number(result && result.chapter_index))
        ? Number(result.chapter_index)
        : streamingChapterIndex;
      if (resultChapterIndex !== requestedChapterIndex) {
        throw new Error("章节生成结果与请求章节不一致，请重新打开该章节。");
      }

      if (
        state.learningPathData &&
        state.learningPathData.chapters &&
        state.learningPathData.chapters[resultChapterIndex]
      ) {
        state.learningPathData.chapters[resultChapterIndex].content_generated = true;
      }

      if (state.lpChapterStreamKey !== streamKey) {
        return;
      }

      state.learningPathStage = "path-ready";
      state.currentChapterIndex = resultChapterIndex;
      state.lpChapterGeneratingIndex = -1;
      state.lpChapterStreamKey = "";

      const renderedContent = String((result && result.content) || "").trim();
      if (!renderedContent) {
        throw new Error("章节生成完成但未返回 Markdown 正文");
      }

      const chapter = state.learningPathData && Array.isArray(state.learningPathData.chapters)
        ? state.learningPathData.chapters[resultChapterIndex]
        : null;
      if (chapter && el.learningPathMarkdown) {
        state.lpChapterDraft = "";
        renderLearningPathSidePanel(lectureId);
        renderChapterMarkdown(el.learningPathMarkdown, lectureId, resultChapterIndex, chapter, renderedContent);
      } else {
        throw new Error("章节生成完成，但章节视图状态异常");
      }
    } catch (err) {
      if (state.lpChapterStreamKey !== streamKey) {
        return;
      }
      state.learningPathStage = "path-ready";
      state.lpChapterGeneratingIndex = -1;
      state.lpChapterStreamKey = "";
      renderLearningPathView(lectureId);
      showToast(String(err && err.message ? err.message : "章节生成失败"));
    }
  }

  function renderMarkdownSimple(text) {
    const source = stripLearningPathContentMarker(text).replace(/\r\n?/g, "\n");
    if (!source.trim()) return "";

    const lines = source.split("\n");
    const html = [];
    let paragraphLines = [];
    let quoteLines = [];
    let listTag = "";
    let listItems = [];

    const renderInline = (value) => escapeHtml(value)
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+?)\*/g, "<em>$1</em>");

    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      html.push(`<p>${paragraphLines.map(renderInline).join("<br>")}</p>`);
      paragraphLines = [];
    };

    const flushQuote = () => {
      if (!quoteLines.length) return;
      html.push(`<blockquote><p>${quoteLines.map(renderInline).join("<br>")}</p></blockquote>`);
      quoteLines = [];
    };

    const flushList = () => {
      if (!listTag || !listItems.length) return;
      html.push(`<${listTag}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listTag}>`);
      listTag = "";
      listItems = [];
    };

    lines.forEach((line) => {
      const rawLine = String(line || "");
      const trimmed = rawLine.trim();

      if (!trimmed) {
        flushParagraph();
        flushQuote();
        flushList();
        return;
      }

      const quoteMatch = rawLine.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        quoteLines.push(quoteMatch[1]);
        return;
      }

      flushQuote();

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
        return;
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
      const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (unorderedMatch || orderedMatch) {
        flushParagraph();
        const nextTag = unorderedMatch ? "ul" : "ol";

        if (listTag && listTag !== nextTag) {
          flushList();
        }

        listTag = nextTag;
        listItems.push((unorderedMatch || orderedMatch)[1]);
        return;
      }

      flushList();
      paragraphLines.push(trimmed);
    });

    flushParagraph();
    flushQuote();
    flushList();

    return html.join("");
  }

  function renderLearningPathGeneratingPanel(title, draft) {
    const draftText = String(draft || "");
    return `
      <div class="reader-guide-loading lp-guide-loading">
        <div class="quiz-loading-spinner"></div>
        <div class="quiz-loading-text">${escapeHtml(title || "生成中")}</div>
        <div class="quiz-loading-hint">模型正在整理实时输出</div>
        <section class="reader-guide-stream lp-guide-stream">
          <div class="reader-guide-stream-label">实时输出</div>
          <pre class="reader-guide-draft">${escapeHtml(draftText || "等待模型开始输出...")}</pre>
        </section>
      </div>
    `;
  }

  function renderLearningPathQA(md, lectureId) {
    const draft = String(state.lpQADraft || "").trim();
    const questions = state.lpQuestions || null;

    // 流式生成中
    if (state.learningPathStage === "qa-loading") {
      md.innerHTML = `
        <div class="reader-guide-loading">
          <div class="quiz-loading-spinner"></div>
          <div class="quiz-loading-text">正在准备阅读前问答...</div>
          <div class="quiz-loading-hint">模型正在根据课程大纲生成问题</div>
          <section class="reader-guide-stream">
            <div class="reader-guide-stream-label">实时输出</div>
            <pre class="reader-guide-draft">${escapeHtml(draft || "等待模型开始输出...")}</pre>
          </section>
        </div>
      `;
      return;
    }

    // 问题已生成，显示表单
    if (state.learningPathStage === "qa-ready" && questions) {
      const questionHtml = questions.map((q) => {
        const optionsHtml = (q.options || []).map((opt) => `
          <label class="pre-qa-option">
            <input type="radio" name="lp_qa_${q.id}" value="${escapeHtml(opt.id)}" data-question-id="${escapeHtml(q.id)}" data-option-id="${escapeHtml(opt.id)}">
            <span class="pre-qa-option-text">${escapeHtml(opt.text)}</span>
          </label>
        `).join("");

        return `
          <div class="pre-qa-question" data-question-id="${escapeHtml(q.id)}">
            <div class="pre-qa-question-title">${escapeHtml(q.title)}</div>
            <div class="pre-qa-options">${optionsHtml}</div>
          </div>
        `;
      }).join("");

      md.innerHTML = `
        <section class="pre-qa-container">
          <div class="pre-qa-header">
            <div class="reader-guide-kicker">阅读前准备</div>
            <h3>个性化学习路线</h3>
            <p class="pre-qa-hint">回答以下问题，帮助系统为你生成更合适的学习路线</p>
          </div>
          <div class="pre-qa-questions">${questionHtml}</div>
          <div class="pre-qa-actions">
            <button type="button" class="reader-guide-primary" id="lpQASubmit">提交并生成路线</button>
            <button type="button" class="reader-guide-secondary" id="lpQASkip">跳过，直接生成</button>
          </div>
        </section>
      `;

      const submitBtn = document.getElementById("lpQASubmit");
      const skipBtn = document.getElementById("lpQASkip");

      if (submitBtn) {
        submitBtn.addEventListener("click", () => {
          submitLearningPathQA(lectureId);
        });
      }

      if (skipBtn) {
        skipBtn.addEventListener("click", () => {
          skipLearningPathQA(lectureId);
        });
      }
      return;
    }

    // 默认：开始按钮
    md.innerHTML = `
      <div class="learning-path-empty">
        <div class="learning-path-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        </div>
        <div class="learning-path-empty-text">准备开始学习</div>
        <div class="learning-path-empty-hint">点击下方按钮，系统将根据你的背景生成个性化学习路线</div>
        <button class="learning-path-start-btn-lg" id="lpStartBtn" type="button">开始个性化学习</button>
      </div>
    `;

    const startBtn = document.getElementById("lpStartBtn");
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        startLearningPathQA(lectureId);
      });
    }
  }

  async function startLearningPathQA(lectureId) {
    state.learningPathStage = "qa-loading";
    state.lpQADraft = "";
    state.lpQuestions = null;
    renderLearningPathView(lectureId);

    try {
      const result = await fetchLPQuestionsStream(lectureId, (delta) => {
        state.lpQADraft = `${String(state.lpQADraft || "")}${String(delta || "")}`;
        const draftEl = document.querySelector("#learningPathMarkdown .reader-guide-draft");
        if (draftEl) {
          draftEl.textContent = state.lpQADraft || "等待模型开始输出...";
          draftEl.scrollTop = draftEl.scrollHeight;
        }
      });

      if (!result || !result.success || !result.questions) {
        throw new Error((result && (result.error || result.message)) || "模型未返回问题");
      }

      state.learningPathStage = "qa-ready";
      state.lpQuestions = result.questions;
      state.lpQADraft = "";
    } catch (err) {
      state.learningPathStage = "ready";
      state.lpQuestions = null;
      state.lpQADraft = "";
      showToast(String(err && err.message ? err.message : "阅读前问答生成失败"));
    }

    renderLearningPathView(lectureId);
  }

  async function fetchLPQuestionsStream(lectureId, onDelta) {
    const response = await fetch(
      resolveApiUrl(`/api/frontend/personalized-learning/generate-qa-stream?lecture_id=${encodeURIComponent(lectureId)}`),
      {
        method: "GET",
        credentials: "same-origin",
        headers: { "X-Nexora-Username": getRuntimeUsername() },
      }
    );

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = String((data && (data.error || data.message)) || message);
      } catch (_err) {}
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("阅读前问答流没有返回响应体");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult = null;

    const handleBlock = (block) => {
      const parsed = parseReaderGuideSseBlock(block);
      if (!parsed) return;

      if (parsed.eventName === "delta") {
        const piece = String((parsed.data && parsed.data.content) || "");
        if (piece && typeof onDelta === "function") {
          onDelta(piece);
        }
      } else if (parsed.eventName === "status") {
        const message = String((parsed.data && parsed.data.message) || "").trim();
        if (message && typeof onDelta === "function") {
          onDelta(`[状态] ${message}\n`);
        }
      } else if (parsed.eventName === "done") {
        finalResult = parsed.data;
      } else if (parsed.eventName === "error") {
        throw new Error(String((parsed.data && parsed.data.error) || "阅读前问答生成失败"));
      }
    };

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      blocks.forEach(handleBlock);
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult || !finalResult.success || !finalResult.questions) {
      throw new Error("阅读前问答流没有返回完整问题");
    }

    return finalResult;
  }

  async function submitLearningPathQA(lectureId) {
    const questions = state.lpQuestions || [];
    const answers = {};

    questions.forEach((q) => {
      const selected = document.querySelector(`input[name="lp_qa_${q.id}"]:checked`);
      if (selected) {
        const optionId = selected.getAttribute("data-option-id");
        const option = (q.options || []).find((o) => o.id === optionId);
        answers[q.id] = {
          question_id: q.id,
          question_type: q.type,
          question_title: q.title,
          option_id: optionId,
          answer_text: option ? option.text : "",
        };
      }
    });

    try {
      await fetch("/api/frontend/personalized-learning/save-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecture_id: lectureId,
          questions: questions,
          answers: answers,
          skipped: false,
        }),
      });
    } catch (e) {}

    state.learningPathStage = "generating";
    renderLearningPathView(lectureId);
    void generatePersonalizedLearningPath(lectureId);
  }

  async function skipLearningPathQA(lectureId) {
    try {
      await fetch("/api/frontend/personalized-learning/save-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecture_id: lectureId,
          questions: state.lpQuestions || [],
          answers: {},
          skipped: true,
        }),
      });
    } catch (e) {}

    state.learningPathStage = "generating";
    renderLearningPathView(lectureId);
    void generatePersonalizedLearningPath(lectureId);
  }

  async function generatePersonalizedLearningPath(lectureId) {
    state.lpPathDraft = "";
    renderLearningPathView(lectureId);

    let draft = "";

    try {
      const result = await fetchPersonalizedLearningStream(
        `/api/frontend/personalized-learning/generate-path-stream?lecture_id=${encodeURIComponent(lectureId)}`,
        (delta) => {
          draft = `${draft}${String(delta || "")}`;
          state.lpPathDraft = draft;
          const draftEl = document.querySelector("#learningPathMarkdown .reader-guide-draft");
          if (draftEl) {
            draftEl.textContent = state.lpPathDraft || "等待模型开始输出...";
            draftEl.scrollTop = draftEl.scrollHeight;
          }
        }
      );

      state.learningPathStage = "path-ready";
      state.learningPathData = {
        advice: result.advice || "",
        chapters: result.chapters || [],
      };
      state.currentChapterIndex = 0;
      applyLearningPathOpenTarget(state.learningPathData.chapters);
      renderLearningPathView(lectureId);
    } catch (err) {
      state.learningPathStage = "ready";
      renderLearningPathView(lectureId);
      showToast(String(err && err.message ? err.message : "学习路线生成失败"));
    }
  }

  function closeConfirmModal() {
    if (!el.confirmBackdrop) return;
    el.confirmBackdrop.style.display = "none";
  }

  function showConfirmModal(message, onConfirm, onCancel) {
    if (!el.confirmBackdrop || !el.confirmBody || !el.confirmOkBtn || !el.confirmCancelBtn) {
      if (typeof onCancel === "function") onCancel();
      return;
    }
    el.confirmBody.textContent = String(message || "请确认是否继续。");
    el.confirmBackdrop.style.display = "flex";
    el.confirmOkBtn.onclick = () => {
      closeConfirmModal();
      if (typeof onConfirm === "function") onConfirm();
    };
    el.confirmCancelBtn.onclick = () => {
      closeConfirmModal();
      if (typeof onCancel === "function") onCancel();
    };
  }

  function confirmModalAsync(message) {
    return new Promise((resolve) => {
      showConfirmModal(
        message,
        () => resolve(true),
        () => resolve(false),
      );
    });
  }

  function confirmExitLearningAsync() {
    return new Promise((resolve) => {
      showConfirmModal(
        "是否退出学习",
        () => resolve(true),
        () => resolve(false),
      );
    });
  }

  function setView(name) {
    el.dashboardView.classList.toggle("is-active", name === "dashboard");
    el.materialsView.classList.toggle("is-active", name === "materials");
    el.uploadView.classList.toggle("is-active", name === "upload");
    el.settingsView.classList.toggle("is-active", name === "settings");
    el.learningPathView.classList.toggle("is-active", name === "learningPath");
    if (name !== "settings") {
      stopSettingsPolling();
    } else {
      startSettingsPolling();
    }
    notifyHostInputVisibility(true);
  }

  function notifyHostReaderState(opened) {
    emitHostPayload("nexora:reader:state", {
      opened: !!opened,
    });
  }

// ─────── Reader Telemetry Helpers ─────────────────────────────────────
  function getReaderHostPointer(x, y) {
    let baseX = 0;
    let baseY = 0;
    try {
      const frame = window.frameElement;
      if (frame && typeof frame.getBoundingClientRect === "function") {
        const rect = frame.getBoundingClientRect();
        baseX = Number(rect.left || 0);
        baseY = Number(rect.top || 0);
      }
    } catch (_err) {}
    return {
      x: Math.round(baseX + Number(x || 0)),
      y: Math.round(baseY + Number(y || 0)),
    };
  }

  function getReaderCurrentChapterMeta() {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(state.readerActiveChapterIndex) || 0));
    const chapter = chapters[idx] || null;
    return {
      chapterIndex: chapter ? idx : null,
      chapterTitle: chapter ? String(chapter.title || "").trim() : "",
    };
  }

  /**
   * 解析 session_range 绝对偏移范围，转换为章节内相对偏移。
   * 实际数据格式：session_range 与 chapter_range 均为 START:LENGTH（非 from:to），如：
   *   chapter_range=60475:11893，session_range=60475:1777 表示从绝对偏移 60475 开始长度 1777 的区间。
   */
// ─────── Reader Session Range Parsing ─────────────────────────────────
  function parseReaderSessionRange(chapter, rawRange) {
    if (!chapter || typeof rawRange !== "string") return null;
    const parts = String(rawRange || "").split(":");
    if (parts.length < 2) return null;
    const absStart = Number(parts[0]);
    const length   = Number(parts[1]);
    if (!Number.isFinite(absStart) || !Number.isFinite(length)) return null;
    const chapterStart = Number(chapter.start || 0);
    const chapterEnd   = Number(chapter.end || chapterStart);
    const chapterLength = Math.max(0, chapterEnd - chapterStart);
    const absEnd = absStart + Math.max(0, length);
    const startRelative = Math.max(0, Math.min(chapterLength, absStart - chapterStart));
    const endRelative   = Math.max(startRelative, Math.min(chapterLength, absEnd - chapterStart));
    return { startRelative, endRelative };
  }

  function getReaderScrollContainer() {
    return el.readerContent ? el.readerContent.querySelector(".materials-preview-text") : null;
  }

  // Resolve the current chapter-session from scroll position so telemetry can track duration without exact offsets.
  function getReaderCurrentSessionMeta(triggerSource) {
    if (!state.isReaderOpen || !Array.isArray(state.readerChapters) || !state.readerChapters.length) return null;
    const scrollContainer = getReaderScrollContainer();
    if (!scrollContainer) return null;

    const chapterMeta = getReaderCurrentChapterMeta();
    if (chapterMeta.chapterIndex === null || chapterMeta.chapterIndex === undefined) return null;

    const chapter = state.readerChapters[chapterMeta.chapterIndex];
    if (!chapter) return null;

    const chapterName = String(chapter.title || "").trim();
    const sectionData = state.readerSectionsData[chapterName];
    const sessions = sectionData && Array.isArray(sectionData.sessions) ? sectionData.sessions : [];
    if (!sessions.length) return null;

    const scrollTop = Number(scrollContainer.scrollTop || 0);
    const clientHeight = Number(scrollContainer.clientHeight || 0);
    const scrollHeight = Number(scrollContainer.scrollHeight || 0);
    const minScrollable = Math.max(1, scrollHeight - clientHeight);
    const atBottom = scrollTop >= minScrollable - 2;
    const chapterLength = Math.max(1, Number(chapter.end || 0) - Number(chapter.start || 0));
    const scrollPercent = atBottom ? 1.0 : (scrollTop / minScrollable);
    let currentRelativePos = Math.floor(chapterLength * scrollPercent);
    if (atBottom) currentRelativePos = chapterLength;

    let sessionIndex = sessions.length - 1;
    let foundRange = false;
    for (let i = 0; i < sessions.length; i += 1) {
      const parsedRange = parseReaderSessionRange(chapter, sessions[i].range);
      if (!parsedRange) continue;
      sessionIndex = i;
      foundRange = true;
      if (currentRelativePos < parsedRange.endRelative) break;
    }
    if (!foundRange) {
      sessionIndex = 0;
    }

    const session = sessions[sessionIndex];
    if (!session) return null;

    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    return {
      lecture_id: lectureId,
      book_id: bookId,
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      chapter_name: chapterName,
      session_index: sessionIndex,
      session_name: String(session.name || "").trim(),
      session_range: String(session.range || "").trim(),
      session_summary: String(session.summary || "").trim(),
      session_key: [lectureId, bookId, chapterMeta.chapterIndex, sessionIndex].join(":"),
      trigger_source: String(triggerSource || "scroll").trim() || "scroll",
    };
  }

  function syncReaderTelemetrySessionContext(triggerSource) {
    const telemetry = window.NXLTelemetry;
    if (!telemetry || typeof telemetry.setReaderSessionContext !== "function") return;
    const context = getReaderCurrentSessionMeta(triggerSource);
    if (!context) return;
    state.lastSessionMeta = context;
    telemetry.setReaderSessionContext(context);
  }

  function clearReaderTelemetrySessionContext(reason) {
    const telemetry = window.NXLTelemetry;
    if (!telemetry || typeof telemetry.clearReaderSessionContext !== "function") return;
    telemetry.clearReaderSessionContext(reason);
  }

// ─────── Reader Context & Layout Helpers ──────────────────────────────
  function collectReaderVisibleText(maxLen = 2800) {
    const root = el.readerContent ? el.readerContent.querySelector(".materials-preview-text") : null;
    if (!root) return "";
    const rootRect = root.getBoundingClientRect();
    const top = Math.max(0, rootRect.top);
    const bottom = Math.min(window.innerHeight || rootRect.bottom, rootRect.bottom);
    const nodes = Array.from(root.querySelectorAll(".chapter-header h2, .materials-preview-paragraph"));
    const parts = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!(node instanceof Element)) continue;
      const rect = node.getBoundingClientRect();
      const visible = rect.bottom > top && rect.top < bottom;
      if (!visible) continue;
      const text = normalizeReaderSelectionText(node.textContent || "", 600);
      if (!text) continue;
      parts.push(text);
      if (parts.join("\n\n").length >= maxLen) break;
    }
    if (!parts.length) {
      return normalizeReaderSelectionText(root.textContent || "", maxLen);
    }
    return normalizeReaderSelectionText(parts.join("\n\n"), maxLen);
  }

  function buildReaderContextPayload() {
    const windowText = collectReaderVisibleText(2800);
    if (!windowText) return null;
    const chapterMeta = getReaderCurrentChapterMeta();
    return {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      reader_title: String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      reader_subtitle: String(state.readerMeta && state.readerMeta.subtitle ? state.readerMeta.subtitle : "").trim(),
      window_text: windowText,
      captured_at: Date.now(),
    };
  }

  function notifyHostReaderContext() {
    const contextPayload = state.isReaderOpen ? buildReaderContextPayload() : null;
    emitHostPayload("nexora:reader:context", {
      context: contextPayload,
      opened: !!state.isReaderOpen,
    });
  }

// ─────── Dashboard Utilities & Rendering ──────────────────────────────
  function setUploadTab(tab) {
    state.uploadTab = tab === "upload" ? "upload" : "create";
    const isCreate = state.uploadTab === "create";
    el.createLectureBlock.hidden = !isCreate;
    el.uploadBookBlock.hidden = isCreate;
    el.kickerCreateTabBtn.classList.toggle("is-active", isCreate);
    el.kickerUploadTabBtn.classList.toggle("is-active", !isCreate);
    el.kickerCreateTabBtn.setAttribute("aria-selected", isCreate ? "true" : "false");
    el.kickerUploadTabBtn.setAttribute("aria-selected", isCreate ? "false" : "true");
  }

  function pickDashboardFocusCourse(courses) {
    const rows = Array.isArray(courses) ? courses : [];
    if (!rows.length) return null;

    const recent = rows
      .filter((course) => Number(course.lastActiveTs) > 0)
      .sort((a, b) => Number(b.lastActiveTs) - Number(a.lastActiveTs));
    if (recent.length) return recent[0];

    const active = rows
      .filter((course) => Number(course.progress) > 0 && Number(course.progress) < 100)
      .sort((a, b) => Number(b.progress) - Number(a.progress));
    if (active.length) return active[0];

    const notStarted = rows.find((course) => Number(course.progress) <= 0);
    if (notStarted) return notStarted;

    return rows[0];
  }

  function renderDashboardFocusPanel(courses) {
    if (!el.dashboardFocusPanel) return;

    const rows = Array.isArray(courses) ? courses : [];
    const focus = pickDashboardFocusCourse(rows);
    if (!focus) {
      el.dashboardFocusPanel.innerHTML = `
        <div class="dashboard-focus-empty">
          <span class="dashboard-focus-label">当前焦点</span>
          <span class="dashboard-focus-empty-text">加入课程后，这里会显示下一步学习入口。</span>
        </div>
      `;
      return;
    }

    const progress = Math.max(0, Math.min(100, Number(focus.progress) || 0));
    const hours = Number(focus.studyHours) > 0 ? `${Number(focus.studyHours).toFixed(1)}h` : "0h";
    const recent = Number(focus.lastActiveTs) > 0 ? formatFeedRelativeTime(focus.lastActiveTs) : "";
    const nextLabel = progress >= 100 ? "回顾课程" : (progress > 0 ? "继续学习" : "开始学习");

    el.dashboardFocusPanel.innerHTML = `
      <button class="dashboard-focus-card" type="button" data-dashboard-focus-lecture-id="${escapeHtml(focus.id)}">
        <span class="dashboard-focus-main">
          <span class="dashboard-focus-label">当前焦点</span>
          <span class="dashboard-focus-title">${escapeHtml(focus.title)}</span>
          <span class="dashboard-focus-subtitle">当前：${escapeHtml(focus.chapterCurrent || "待开始")}</span>
        </span>
        <span class="dashboard-focus-meta">
          <span class="dashboard-focus-stat"><strong>${progress}%</strong><span>进度</span></span>
          <span class="dashboard-focus-stat"><strong>${escapeHtml(recent || hours)}</strong><span>${recent ? "最近" : "时长"}</span></span>
          <span class="dashboard-focus-action">${escapeHtml(nextLabel)}</span>
        </span>
      </button>
    `;
  }

  function renderDashboardCourseCover(course) {
    const title = String((course && course.title) || "课程").trim();
    const coverPath = String((course && course.coverPath) || "").trim();
    if (coverPath) {
      return `
        <div class="nxl-course-cover">
          <img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="${escapeHtml(title)}" loading="lazy">
        </div>
      `;
    }

    const mark = title ? title.slice(0, 1) : "课";
    return `
      <div class="nxl-course-cover is-empty" aria-label="${escapeHtml(title)}">
        <span>${escapeHtml(mark)}</span>
      </div>
    `;
  }

  function renderProgressList() {
    const courses = buildDashboardCourses(state.dashboardRows);
    renderDashboardFocusPanel(courses);

    if (!courses.length) {
      el.progressList.classList.add("is-empty");
      el.progressList.innerHTML = `
        <div class="materials-empty progress-empty">
          <span class="progress-empty-line">你还没有选择学习课程</span>
          <span class="progress-empty-line">请在右上角课程页加入课程</span>
        </div>
      `;
      return;
    }
    el.progressList.classList.remove("is-empty");
    el.progressList.innerHTML = courses.map((course) => `
      <article class="nxl-course-item has-cover" data-progress-lecture-id="${escapeHtml(course.id)}">
        ${renderDashboardCourseCover(course)}
        <div class="nxl-course-body">
          <div class="nxl-course-top">
            <div class="nxl-course-title">${escapeHtml(course.title)}</div>
            <div class="nxl-course-percent">${course.progress}%</div>
          </div>
          <div class="nxl-course-current">当前：${escapeHtml(course.chapterCurrent)}</div>
          <div class="nxl-course-bar"><div class="nxl-course-bar-fill" style="width:${course.progress}%"></div></div>
        </div>
      </article>
    `).join("");
  }

  function isTeacherPanelMode() {
    const identity = String((state.user && (state.user.identity || state.user.role)) || "").trim().toLowerCase();
    return !!state.isAdmin || identity === "teacher";
  }

  function getCurrentTeacherKeys() {
    const user = state.user && typeof state.user === "object" ? state.user : {};
    const keys = [
      state.username,
      user.id,
      user.user_id,
      user.username,
      user.display_name,
      user.nickname,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(keys));
  }

  function lectureManagedByCurrentTeacher(lecture) {
    const teacherList = Array.isArray(lecture && lecture.teacher) ? lecture.teacher : [];
    if (!teacherList.length) return false;
    const teacherSet = new Set(teacherList.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    return getCurrentTeacherKeys().some((key) => teacherSet.has(key));
  }

  function getLectureTeacherEntries(lecture) {
    return Array.isArray(lecture && lecture.teacher) ? lecture.teacher : [];
  }

  function getLectureTeacherLabel(entry) {
    if (entry && typeof entry === "object") {
      return String(entry.display_name || entry.nickname || entry.name || entry.username || entry.user_id || entry.id || entry.uid || "").trim();
    }
    return String(entry || "").trim();
  }

  function getLectureTeacherUserId(entry) {
    if (entry && typeof entry === "object") {
      return String(entry.user_id || entry.username || entry.id || entry.uid || "").trim();
    }
    return String(entry || "").trim();
  }

  function getLectureCoverPath(lecture) {
    return String((lecture && lecture.cover_path) || "").trim();
  }

  function getBookCoverPath(book) {
    return String((book && book.cover_path) || "").trim();
  }

  function renderCourseDetailBookCover(book, title) {
    const resolvedTitle = String(title || "教材").trim();
    const coverPath = getBookCoverPath(book);

    if (coverPath) {
      return `
        <div class="learning-panel-book-cover">
          <img class="learning-panel-book-cover-image" src="${escapeHtml(resolveApiUrl(coverPath))}" alt="${escapeHtml(resolvedTitle)}" loading="lazy">
        </div>
      `;
    }

    const mark = resolvedTitle ? resolvedTitle.slice(0, 1) : "书";
    return `
      <div class="learning-panel-book-cover is-empty" aria-label="${escapeHtml(resolvedTitle)}">
        <span>${escapeHtml(mark)}</span>
      </div>
    `;
  }

  function getBookRowById(lectureId, bookId) {
    const row = getLectureRowById(lectureId);
    if (!row) return null;
    const books = Array.isArray(row.books) ? row.books : [];
    const resolvedBookId = String(bookId || "").trim();
    if (!resolvedBookId) return null;
    return books.find((item) => String((item && item.id) || "").trim() === resolvedBookId) || null;
  }

  function renderLearningPanelCover(coverPath, title, extraClass) {
    const classes = ["learning-panel-cover"];
    if (extraClass) classes.push(String(extraClass));

    const resolvedPath = String(coverPath || "").trim();
    const alt = escapeHtml(String(title || "封面"));

    if (resolvedPath) {
      const imageUrl = escapeHtml(resolveApiUrl(resolvedPath));
      return `
        <div class="${classes.join(" ")}">
          <img class="learning-panel-cover-image" src="${imageUrl}" alt="${alt}" loading="lazy">
        </div>
      `;
    }

    return `
      <div class="${classes.join(" ")}">
        <div class="learning-panel-cover-empty">未设置封面</div>
      </div>
    `;
  }

  function normalizeTeacherEditCoverSelection(ctx) {
    const items = Array.isArray(ctx && ctx.coverAssets) ? ctx.coverAssets : [];
    const current = String((ctx && ctx.selectedCoverPath) || "").trim();

    if (current && items.some((item) => String(item.cover_path || "").trim() === current)) {
      return current;
    }

    if (items.length) {
      return String(items[0].cover_path || "").trim();
    }

    return current;
  }

  function getTeacherEditPreviewTitle(ctx) {
    if (!ctx) return "封面";

    const lectureId = String(ctx.lectureId || "").trim();
    const isBookMode = String(ctx.mode || "").trim() === "book";

    if (isBookMode) {
      const book = getBookRowById(lectureId, String(ctx.bookId || "").trim()) || {};
      return String(book.title || ctx.bookId || "教材封面");
    }

    const row = getLectureRowById(lectureId);
    const lecture = row ? (row.lecture || {}) : {};
    return getLectureTitle(lecture);
  }

  function updateTeacherEditCoverSelectionUi(ctx) {
    if (!ctx || state.materialsDetailMode !== "teacher-edit") return;

    const coverStage = document.getElementById("teacherEditCoverStage");
    const coverList = document.getElementById("teacherEditCoverList");
    const selectedCoverPath = String(ctx.selectedCoverPath || "").trim();

    if (coverStage) {
      coverStage.innerHTML = renderLearningPanelCover(
        selectedCoverPath,
        getTeacherEditPreviewTitle(ctx),
        "teacher-edit-cover-preview"
      );
    }

    if (coverList) {
      coverList.querySelectorAll("[data-cover-path]").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const nodePath = String(node.getAttribute("data-cover-path") || "").trim();
        node.classList.toggle("is-active", nodePath === selectedCoverPath);
      });
    }
  }

  async function loadTeacherEditCoverAssets(ctx) {
    if (!ctx) return;

    const lectureId = String(ctx.lectureId || "").trim();
    const bookId = String(ctx.bookId || "").trim();

    if (!lectureId) {
      ctx.coverLoading = false;
      ctx.coverAssets = [];
      ctx.coverError = "课程 ID 缺失";
      renderLectureDetail();
      return;
    }

    const url = ctx.mode === "book" && bookId
      ? `/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/cover-assets`
      : `/api/lectures/${encodeURIComponent(lectureId)}/cover-assets`;

    try {
      const data = await fetchJson(url);
      if (state.teacherEditContext !== ctx) return;

      ctx.coverAssets = Array.isArray(data && data.items) ? data.items : [];
      ctx.coverLoading = false;
      ctx.coverError = "";
      ctx.selectedCoverPath = normalizeTeacherEditCoverSelection(ctx);
    } catch (err) {
      if (state.teacherEditContext !== ctx) return;

      ctx.coverAssets = [];
      ctx.coverLoading = false;
      ctx.coverError = err && err.message ? err.message : "图片资源加载失败";
    }

    renderLectureDetail();
  }

  function renderLectureTeacherTags(lecture) {
    const teacherEntries = getLectureTeacherEntries(lecture);
    const teacherInfo = Array.isArray(lecture && lecture.teacher_info) ? lecture.teacher_info : [];
    const validEntries = teacherEntries.filter((entry) => !!getLectureTeacherLabel(entry));
    if (!validEntries.length && !teacherInfo.length) {
      return '<div class="learning-panel-empty-note">暂无教师信息</div>';
    }

    const items = teacherInfo.length ? teacherInfo : validEntries;
    return items.map((entry, idx) => {
      const name = entry.display_name || entry.nickname || getLectureTeacherLabel(entry) || "";
      const avatarUrl = normalizeFeedAvatarUrl(String(entry.avatar_url || "").trim());
      const initials = (name || "?")[0] || "?";
      const hue = (name || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
      const bgColor = `hsl(${hue}, 45%, 72%)`;
      const avatarHtml = avatarUrl
        ? `<img class="learning-panel-teacher-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.style.display='none'">`
        : `<span class="learning-panel-teacher-avatar-placeholder" style="background:${bgColor}">${escapeHtml(initials)}</span>`;
      return `<div class="learning-panel-teacher-row">
        ${avatarHtml}
        <span class="learning-panel-teacher-name">${escapeHtml(name)}</span>
      </div>`;
    }).join("");
  }

  function getLectureRowById(lectureId) {
    const id = String(lectureId || "").trim();
    if (!id) return null;
    return state.allLectureRows.find((row) => String((row.lecture || {}).id || "") === id) || null;
  }

  function closeTeacherEditPanel() {
    const ctx = state.teacherEditContext;
    const returnMode = ctx && String(ctx.returnMode || "").trim() === "catalog" ? "catalog" : "lecture";
    state.materialsDetailMode = returnMode;
    state.teacherEditContext = null;
    renderLectureDetail();
  }

  function updateTeacherEditSearchResults() {
    const ctx = state.teacherEditContext;
    if (!ctx || state.materialsDetailMode !== "teacher-edit") return false;
    const container = document.getElementById("teacherEditSearchResults");
    if (!container) return false;
    if (ctx.searchLoading) {
      container.innerHTML = '<div class="teacher-edit-empty-note">搜索中...</div>';
      return true;
    }
    if (!ctx.searchResults.length) {
      container.innerHTML = '<div class="teacher-edit-empty-note">输入关键词搜索用户，留空显示最近用户</div>';
      return true;
    }
    const pending = Array.isArray(ctx.pendingTeachers) ? ctx.pendingTeachers : [];
    container.innerHTML = ctx.searchResults.map((user) => {
      const name = getUserOptionDisplayName(user) || getUserOptionHandle(user);
      const handle = getUserOptionHandle(user);
      const avatarUrl = getUserOptionAvatarUrl(user);
      const initial = getUserOptionInitial(user);
      const alreadyAdded = pending.some((t) => String(t.user_id || "") === String(user.user_id || ""));
      const hue = (name || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
      const bgColor = `hsl(${hue}, 45%, 72%)`;
      const avatarImg = avatarUrl
        ? `<img class="teacher-edit-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.style.display='none'">`
        : `<span class="teacher-edit-user-avatar-ph" style="background:${bgColor}">${escapeHtml(initial)}</span>`;
      return `<button class="teacher-edit-search-item${alreadyAdded ? " is-already-added" : ""}" type="button" data-add-user-id="${escapeHtml(String(user.user_id || ""))}" ${alreadyAdded ? "disabled" : ""}>
        ${avatarImg}
        <div class="teacher-edit-search-meta">
          <span class="teacher-edit-user-name">${escapeHtml(name)}</span>
          <span class="teacher-edit-user-handle">@${escapeHtml(handle)}</span>
        </div>
        ${alreadyAdded ? '<span class="teacher-edit-search-status">已添加</span>' : '<span class="teacher-edit-search-add">添加</span>'}
      </button>`;
    }).join("");
    return true;
  }

  function updateTeacherEditPendingList() {
    const ctx = state.teacherEditContext;
    if (!ctx || state.materialsDetailMode !== "teacher-edit") return;
    const container = document.getElementById("teacherEditPendingList");
    const countEl = document.getElementById("teacherEditPendingCount");
    const pending = Array.isArray(ctx.pendingTeachers) ? ctx.pendingTeachers : [];
    if (countEl) countEl.textContent = `(${pending.length})`;
    if (!container) return;
    if (!pending.length) {
      container.innerHTML = '<div class="teacher-edit-empty-note">暂无教师，请从右侧搜索添加</div>';
    } else {
      container.innerHTML = pending.map((t, idx) => {
        const name = t.display_name || t.nickname || t.username || t.user_id || "";
        const avatarUrl = normalizeFeedAvatarUrl(String(t.avatar_url || "").trim());
        const hue = (name || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
        const bgColor = `hsl(${hue}, 45%, 72%)`;
        const avatarHtml = avatarUrl
          ? `<img class="teacher-edit-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.style.display='none'">`
          : `<span class="teacher-edit-user-avatar-ph" style="background:${bgColor}">${escapeHtml((name || "?")[0] || "?")}</span>`;
        return `<div class="teacher-edit-user-item">
          ${avatarHtml}
          <span class="teacher-edit-user-name">${escapeHtml(name)}</span>
          <button class="teacher-edit-remove-btn" type="button" data-remove-teacher-index="${idx}" title="移除">✕</button>
        </div>`;
      }).join("");
    }
  }

  function openTeacherEditPanel(lectureId, options) {
    if (!state.isAdmin) {
      showToast("仅管理员可用");
      return;
    }

    const resolvedLectureId = String(lectureId || state.selectedLectureId || "").trim();
    const row = getLectureRowById(resolvedLectureId);
    if (!row) {
      showToast("课程不存在");
      return;
    }

    const opts = options && typeof options === "object" ? options : {};
    const previousMode = String(state.materialsDetailMode || "").trim();
    const requestedMode = String(opts.mode || "").trim() === "book" ? "book" : "lecture";
    const bookId = requestedMode === "book"
      ? String(opts.bookId || state.selectedBookId || "").trim()
      : "";

    if (requestedMode === "book" && !bookId) {
      showToast("请先进入教材目录");
      return;
    }

    const lecture = row.lecture || {};
    const book = requestedMode === "book" ? getBookRowById(resolvedLectureId, bookId) : null;
    const selectedCoverPath = requestedMode === "book"
      ? getBookCoverPath(book)
      : getLectureCoverPath(lecture);

    state.materialsDetailMode = "teacher-edit";
    state.teacherEditContext = {
      lectureId: resolvedLectureId,
      bookId,
      mode: requestedMode,
      returnMode: previousMode === "catalog" ? "catalog" : "lecture",
      selectedCoverPath,
      savedCoverPath: selectedCoverPath,
      coverAssets: [],
      coverLoading: true,
      coverError: "",
    };
    renderLectureDetail();
    loadTeacherEditCoverAssets(state.teacherEditContext).catch(() => {});
  }

  function getLectureProgressTrail(lecture, books) {
    const list = Array.isArray(books) ? books : [];
    const selectedBookId = String(state.selectedBookId || "").trim().toLowerCase();
    const book = list.find((item) => String((item && item.id) || "").trim().toLowerCase() === selectedBookId) || list[0] || {};
    const bookTitle = String(book && (book.title || book.name || book.id) || "").trim() || "暂无教材";
    const chapter = getChapterInfo(lecture, list);
    let sessionTitle = "";

    if (String(book.id || "").trim() && String(book.id || "").trim().toLowerCase() === selectedBookId) {
      const sessionMeta = getReaderCurrentSessionMeta("teacher_panel");
      if (sessionMeta && String(sessionMeta.book_id || "").trim().toLowerCase() === String(book.id || "").trim().toLowerCase()) {
        sessionTitle = String(sessionMeta.session_name || "").trim();
      }
    }

    if (!sessionTitle) {
      const chapterName = String(chapter.current || "").trim();
      const sectionData = chapterName ? state.readerSectionsData[chapterName] : null;
      const sessions = sectionData && Array.isArray(sectionData.sessions) ? sectionData.sessions : [];
      if (sessions.length) {
        sessionTitle = String(sessions[0].name || "").trim();
      }
    }

    if (!sessionTitle && state.lastSessionMeta) {
      const lsLecture = String(state.lastSessionMeta.lecture_id || "").trim().toLowerCase();
      const lsBook = String(state.lastSessionMeta.book_id || "").trim().toLowerCase();
      const curLecture = String(lecture && lecture.id || "").trim().toLowerCase();
      const curBook = String(book && book.id || "").trim().toLowerCase();
      if (lsLecture === curLecture && (!curBook || lsBook === curBook)) {
        sessionTitle = String(state.lastSessionMeta.session_name || "").trim();
      }
    }

    return {
      progress: getCourseProgress(lecture, list),
      bookTitle,
      chapterTitle: String(chapter.current || "").trim() || "未开始",
      sessionTitle: sessionTitle || "未进入 Session",
    };
  }

  // ── 教师 Panel：数据加载 ──
  async function loadTeacherOverview() {
    if (state.teacherLoadingOverview) return;
    state.teacherLoadingOverview = true;
    state.teacherSelectedUid = "";
    state.teacherStudentAnalysis = null;
    renderTeacherPanel();
    try {
      const qs = new URLSearchParams();
      if (state.teacherLectureId) qs.set("lecture_id", state.teacherLectureId);
      const data = await fetchJson(`/api/frontend/teacher/class-overview?${qs.toString()}`);
      state.teacherOverview = data && data.success ? data : null;
      if (state.teacherOverview && state.teacherOverview.lecture_id) {
        state.teacherLectureId = state.teacherOverview.lecture_id;
      }
    } catch (_e) {
      state.teacherOverview = null;
    } finally {
      state.teacherLoadingOverview = false;
    }
    renderTeacherPanel();
  }

  async function loadTeacherStudentAnalysis(uid) {
    if (!uid) return;
    if (state.teacherLoadingAnalysis) return;
    state.teacherLoadingAnalysis = true;
    state.teacherReturnView = String(state.teacherView || "home");
    state.teacherSelectedUid = uid;
    state.teacherStudentAnalysis = null;
    state._teacherEventFilter = null;
    renderTeacherPanel();
    try {
      const qs = new URLSearchParams();
      qs.set("user_id", uid);
      if (state.teacherLectureId) qs.set("lecture_id", state.teacherLectureId);
      const data = await fetchJson(`/api/frontend/teacher/student-analysis?${qs.toString()}`);
      state.teacherStudentAnalysis = data && data.success ? data.analysis : null;
    } catch (_e) {
      state.teacherStudentAnalysis = null;
    } finally {
      state.teacherLoadingAnalysis = false;
    }
    renderTeacherPanel();
  }

  function renderTeacherPanel() {
    renderTeacherHomePanel();
  }

  function renderTeacherHomePanel() {
    const lectureRows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const managedRows = lectureRows.filter((row) => lectureManagedByCurrentTeacher(row && row.lecture ? row.lecture : {}));
    const cardsHtml = managedRows.map((row) => {
      const lecture = row && row.lecture && typeof row.lecture === "object" ? row.lecture : {};
      const books = Array.isArray(row && row.books) ? row.books : [];
      const lectureId = String(lecture.id || "").trim();
      const trail = getLectureProgressTrail(lecture, books);
      const progress = Math.max(0, Math.min(100, Number(trail.progress) || 0));
      const bookCount = Number(row && row.books_count) || books.length || 0;
      return `
        <article class="nxl-course-item" data-lecture-id="${escapeHtml(lectureId)}">
          <div class="nxl-course-top">
            <div class="nxl-course-title">${escapeHtml(getLectureTitle(lecture))}</div>
            <div class="nxl-course-percent">${progress}%</div>
          </div>
          <div class="nxl-course-current">${escapeHtml(`${bookCount} 本教材 · ${trail.bookTitle} - ${trail.chapterTitle} - ${trail.sessionTitle}`)}</div>
          <div class="nxl-course-bar"><div class="nxl-course-bar-fill" style="width:${progress}%"></div></div>
        </article>
      `;
    }).join("");
    el.timePieChart.innerHTML = `
      ${managedRows.length ? `<div class="materials-list">${cardsHtml}</div>` : '<div class="materials-empty">暂无可管理课程</div>'}
    `;
  }

  function renderTeacherClassOverview() {
    const data = state.teacherOverview || {};
    const chapters = data.chapters || [];
    const students = data.students || [];

    if (!students.length) {
      el.timePieChart.innerHTML = '<div class="teacher-panel-empty"><div class="empty-msg">暂无学生数据</div></div>';
      return;
    }

    const lectureRows = Array.isArray(state.dashboardRows) ? state.dashboardRows : [];
    const lectureOptions = lectureRows.map((row) => {
      const lecture = row && row.lecture && typeof row.lecture === "object" ? row.lecture : {};
      const lectureId = String(lecture.id || "").trim();
      const lectureTitle = String(lecture.title || lecture.name || lectureId || "").trim();
      if (!lectureId) return null;
      return { id: lectureId, title: lectureTitle || lectureId };
    }).filter(Boolean);

    const inCourseRows = students.filter((s) => !!s.is_in_course);
    const totalCount = students.length;
    const inCourseCount = inCourseRows.length;
    const active24hCount = students.filter((s) => {
      const ts = Number(s.last_active_ts) || 0;
      if (!ts) return false;
      return (Math.floor(Date.now() / 1000) - ts) <= 86400;
    }).length;
    const avgProgress = inCourseCount
      ? Math.round(inCourseRows.reduce((sum, s) => sum + (Number(s.progress) || 0), 0) / inCourseCount)
      : 0;
    const avgHours = inCourseCount
      ? (inCourseRows.reduce((sum, s) => sum + (Number(s.study_hours) || 0), 0) / inCourseCount).toFixed(1)
      : "0.0";

    const scope = String(state.teacherScope || "in_course");
    let filteredRows = students.slice();
    if (scope === "in_course") filteredRows = filteredRows.filter((s) => !!s.is_in_course);
    if (scope === "not_started") filteredRows = filteredRows.filter((s) => !!s.is_in_course && (Number(s.progress) || 0) <= 0 && (Number(s.study_hours) || 0) <= 0);

    const sortKey = String(state.teacherSortKey || "progress_desc");
    filteredRows.sort((a, b) => {
      if (sortKey === "hours_desc") return (Number(b.study_hours) || 0) - (Number(a.study_hours) || 0);
      if (sortKey === "activity_desc") return (Number(b.last_active_ts) || 0) - (Number(a.last_active_ts) || 0);
      if (sortKey === "risk_desc") {
        const aRisk = ((100 - (Number(a.progress) || 0)) * 10) + ((Number(a.study_hours) || 0) <= 0 ? 100 : 0);
        const bRisk = ((100 - (Number(b.progress) || 0)) * 10) + ((Number(b.study_hours) || 0) <= 0 ? 100 : 0);
        return bRisk - aRisk;
      }
      return (Number(b.progress) || 0) - (Number(a.progress) || 0);
    });

    const riskRows = inCourseRows
      .filter((s) => (Number(s.progress) || 0) < 30 || (Number(s.study_hours) || 0) <= 0)
      .sort((a, b) => (Number(a.progress) || 0) - (Number(b.progress) || 0))
      .slice(0, 5);

    const compareRowsHtml = filteredRows.map((s, idx) => {
      const progress = Math.max(0, Math.min(100, Number(s.progress) || 0));
      const chaptersDone = Number(s.chapter_count) || 0;
      const chaptersTotal = Number(s.total_chapters) || 0;
      const hoursText = (Number(s.study_hours) || 0) > 0 ? `${Number(s.study_hours).toFixed(1)}h` : "0h";
      const activeText = s.last_active_ts ? formatFeedRelativeTime(s.last_active_ts) : "无记录";
      const statusClass = s.is_in_course ? "is-in-course" : "is-not-in-course";
      const statusText = s.is_in_course ? "已选课" : "未选课";
      const heatCells = (Array.isArray(s.chapter_status) && s.chapter_status.length)
        ? `<div class="teacher-heatmap">${s.chapter_status.map((done, i) => {
          const title = chapters[i] ? escapeHtml(chapters[i].name || "") : "";
          return `<span class="teacher-heatmap-cell" data-done="${done ? "true" : "false"}" title="${title}"></span>`;
        }).join("")}</div>`
        : '<div class="teacher-heatmap-none">暂无章节</div>';
      return `
        <article class="teacher-compare-row" data-teacher-student-uid="${escapeHtml(String(s.user_id || ""))}">
          <div class="teacher-compare-col teacher-compare-name">
            <div class="teacher-compare-rank">${idx + 1}</div>
            <div class="teacher-compare-ident">
              <div class="teacher-compare-display">${escapeHtml(String(s.display_name || s.username || s.user_id || ""))}</div>
              <div class="teacher-compare-handle">@${escapeHtml(String(s.username || s.user_id || ""))}</div>
            </div>
          </div>
          <div class="teacher-compare-col teacher-compare-progress">
            <div class="teacher-compare-progress-value">${progress}%</div>
            <div class="teacher-compare-progress-bar"><span style="width:${progress}%"></span></div>
          </div>
          <div class="teacher-compare-col teacher-compare-chapters">${chaptersDone}/${chaptersTotal || 0}章</div>
          <div class="teacher-compare-col teacher-compare-hours">${hoursText}</div>
          <div class="teacher-compare-col teacher-compare-active">${escapeHtml(String(activeText || ""))}</div>
          <div class="teacher-compare-col teacher-compare-status"><span class="teacher-status-badge ${statusClass}">${statusText}</span></div>
          <div class="teacher-compare-col teacher-compare-heat">${heatCells}</div>
        </article>
      `;
    }).join("");

    const riskHtml = riskRows.length
      ? riskRows.map((s) => `<div class="teacher-risk-item" data-teacher-student-uid="${escapeHtml(String(s.user_id || ""))}">
          <span class="teacher-risk-name">${escapeHtml(String(s.display_name || s.username || s.user_id || ""))}</span>
          <span class="teacher-risk-meta">${Math.max(0, Number(s.progress) || 0)}% · ${(Number(s.study_hours) || 0).toFixed(1)}h</span>
        </div>`).join("")
      : '<div class="teacher-risk-empty">当前无高风险学生</div>';

    const lectureSelectHtml = lectureOptions.length
      ? lectureOptions.map((row) => `<option value="${escapeHtml(String(row.id || ""))}" ${String(row.id) === String(data.lecture_id || state.teacherLectureId || "") ? "selected" : ""}>${escapeHtml(String(row.title || row.id || ""))}</option>`).join("")
      : '<option value="">当前无课程</option>';

    el.timePieChart.innerHTML = `
      <div class="teacher-panel-shell teacher-panel-overview">
        <div class="teacher-page-head">
          <div>
            <div class="teacher-page-title">班级概览</div>
            <div class="teacher-page-subtitle">查看班级整体状态，并进入学生详情。</div>
          </div>
          <button class="teacher-page-back" id="teacherBackHomeBtn" type="button">返回首页</button>
        </div>
        <div class="teacher-overview-toolbar">
          <div class="teacher-overview-toolbar-left">
            <select id="teacherLectureSelect" class="input-lite teacher-select">${lectureSelectHtml}</select>
            <select id="teacherScopeSelect" class="input-lite teacher-select">
              <option value="all" ${scope === "all" ? "selected" : ""}>全部用户</option>
              <option value="in_course" ${scope === "in_course" ? "selected" : ""}>仅已选课</option>
              <option value="not_started" ${scope === "not_started" ? "selected" : ""}>未开始学习</option>
            </select>
            <select id="teacherSortSelect" class="input-lite teacher-select">
              <option value="progress_desc" ${sortKey === "progress_desc" ? "selected" : ""}>按进度</option>
              <option value="hours_desc" ${sortKey === "hours_desc" ? "selected" : ""}>按时长</option>
              <option value="activity_desc" ${sortKey === "activity_desc" ? "selected" : ""}>按活跃</option>
              <option value="risk_desc" ${sortKey === "risk_desc" ? "selected" : ""}>按风险</option>
            </select>
          </div>
          <button id="teacherRefreshBtn" class="nxl-icon-btn" type="button" title="刷新" aria-label="刷新"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
        </div>

        <div class="teacher-kpi-grid">
          <article class="teacher-kpi-card"><div class="teacher-kpi-label">已选课人数</div><div class="teacher-kpi-value">${inCourseCount}/${totalCount}</div></article>
          <article class="teacher-kpi-card"><div class="teacher-kpi-label">近24h活跃</div><div class="teacher-kpi-value">${active24hCount}</div></article>
          <article class="teacher-kpi-card"><div class="teacher-kpi-label">平均进度</div><div class="teacher-kpi-value">${avgProgress}%</div></article>
          <article class="teacher-kpi-card"><div class="teacher-kpi-label">平均时长</div><div class="teacher-kpi-value">${avgHours}h</div></article>
        </div>

        <div class="teacher-panel-grid">
          <div class="teacher-panel-main">
            <div class="teacher-compare-panel">
              <header class="teacher-compare-head">
                <span>学生</span><span>进度</span><span>章节</span><span>时长</span><span>活跃</span><span>状态</span><span>章节分布</span>
              </header>
              <div class="teacher-compare-list" id="teacherCompareList">${compareRowsHtml || '<div class="teacher-panel-empty"><div class="empty-msg">暂无可比较数据</div></div>'}</div>
            </div>
          </div>
          <div class="teacher-panel-side">
            <div class="teacher-risk-panel">
              <div class="teacher-risk-title">重点关注</div>
              <div class="teacher-risk-list" id="teacherRiskList">${riskHtml}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const lectureSelectEl = document.getElementById("teacherLectureSelect");
    if (lectureSelectEl) {
      lectureSelectEl.addEventListener("change", () => {
        state.teacherLectureId = String(lectureSelectEl.value || "").trim();
        state.teacherSelectedUid = "";
        state.teacherStudentAnalysis = null;
        loadTeacherOverview().catch(() => {});
      });
    }

    const scopeEl = document.getElementById("teacherScopeSelect");
    if (scopeEl) {
      scopeEl.addEventListener("change", () => {
        state.teacherScope = String(scopeEl.value || "in_course");
        renderTeacherClassOverview();
      });
    }

    const sortEl = document.getElementById("teacherSortSelect");
    if (sortEl) {
      sortEl.addEventListener("change", () => {
        state.teacherSortKey = String(sortEl.value || "progress_desc");
        renderTeacherClassOverview();
      });
    }

    const refreshBtn = document.getElementById("teacherRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadTeacherOverview().catch(() => {});
      });
    }

    const backHomeBtn = document.getElementById("teacherBackHomeBtn");
    if (backHomeBtn) {
      backHomeBtn.addEventListener("click", () => {
        state.teacherView = "home";
        renderTeacherPanel();
      });
    }

    const openStudentDetail = (ev) => {
      const item = ev.target.closest("[data-teacher-student-uid]");
      if (!item) return;
      const uid = item.getAttribute("data-teacher-student-uid");
      if (!uid) return;
      loadTeacherStudentAnalysis(uid);
    };
    const compareList = document.getElementById("teacherCompareList");
    const riskList = document.getElementById("teacherRiskList");
    if (compareList) compareList.addEventListener("click", openStudentDetail);
    if (riskList) riskList.addEventListener("click", openStudentDetail);
  }

  function renderTeacherRiskPanel() {
    const data = state.teacherOverview || {};
    const students = Array.isArray(data.students) ? data.students : [];
    const riskRows = students
      .filter((s) => (Number(s.progress) || 0) < 30 || (Number(s.study_hours) || 0) <= 0 || (Number(s.last_active_ts) || 0) <= 0)
      .sort((a, b) => {
        const aScore = (Number(a.progress) || 0) + ((Number(a.study_hours) || 0) > 0 ? 30 : 0) + ((Number(a.last_active_ts) || 0) > 0 ? 10 : 0);
        const bScore = (Number(b.progress) || 0) + ((Number(b.study_hours) || 0) > 0 ? 30 : 0) + ((Number(b.last_active_ts) || 0) > 0 ? 10 : 0);
        return aScore - bScore;
      });

    const riskHtml = riskRows.length
      ? riskRows.map((s) => {
        const progress = Math.max(0, Math.min(100, Number(s.progress) || 0));
        const activeText = s.last_active_ts ? formatFeedRelativeTime(s.last_active_ts) : "无记录";
        const reasonParts = [];
        if (progress < 30) reasonParts.push("进度偏低");
        if ((Number(s.study_hours) || 0) <= 0) reasonParts.push("时长为零");
        if (!s.is_in_course) reasonParts.push("未选课");
        if ((Number(s.last_active_ts) || 0) <= 0) reasonParts.push("无活跃");
        return `
          <button class="teacher-risk-item" type="button" data-teacher-student-uid="${escapeHtml(String(s.user_id || ""))}">
            <span class="teacher-risk-name">${escapeHtml(String(s.display_name || s.username || s.user_id || ""))}</span>
            <span class="teacher-risk-meta">${escapeHtml(reasonParts.join(" · ") || "需要关注")} · ${progress}% · ${(Number(s.study_hours) || 0).toFixed(1)}h · ${escapeHtml(String(activeText || ""))}</span>
          </button>
        `;
      }).join("")
      : '<div class="teacher-risk-empty">当前没有明显需要关注的学生</div>';

    el.timePieChart.innerHTML = `
      <div class="teacher-panel-shell teacher-home-panel">
        <div class="teacher-page-head">
          <div>
            <div class="teacher-page-title">重点关注</div>
            <div class="teacher-page-subtitle">只保留需要干预的学生，减少噪音。</div>
          </div>
          <button class="teacher-page-back" id="teacherBackRiskBtn" type="button">返回首页</button>
        </div>
        <div class="teacher-risk-panel teacher-risk-panel-large">
          <div class="teacher-risk-list" id="teacherRiskList">${riskHtml}</div>
        </div>
      </div>
    `;

    const backRiskBtn = document.getElementById("teacherBackRiskBtn");
    if (backRiskBtn) {
      backRiskBtn.addEventListener("click", () => {
        state.teacherView = "home";
        renderTeacherPanel();
      });
    }

    const riskList = document.getElementById("teacherRiskList");
    if (riskList) {
      riskList.addEventListener("click", (ev) => {
        const item = ev.target.closest("[data-teacher-student-uid]");
        if (!item) return;
        const uid = item.getAttribute("data-teacher-student-uid");
        if (uid) loadTeacherStudentAnalysis(uid);
      });
    }
  }

  function renderTeacherStudentDetail() {
    const uid = state.teacherSelectedUid;
    const overview = state.teacherOverview || {};
    const students = overview.students || [];
    const student = students.find((s) => s.user_id === uid) || {};

    if (state.teacherLoadingAnalysis) {
      el.timePieChart.innerHTML = `<div class="teacher-loading">加载${escapeHtml(student.display_name || uid)}…</div>`;
      return;
    }

    const analysis = state.teacherStudentAnalysis || {};
    const reading = analysis.reading || {};
    const annotation = analysis.annotation || {};
    const question = analysis.question || {};
    const displayName = escapeHtml(student.display_name || uid);

    // 更新标题行：左侧 ← + 学生名
    if (el.dashboardSidePanelTitle) {
      el.dashboardSidePanelTitle.innerHTML =
        `<span class="teacher-back-btn" id="teacherBackBtn" title="返回学生列表" style="cursor:pointer;margin-right:6px;font-size:16px;vertical-align:middle;opacity:0.7;transition:opacity 0.15s">←</span>` +
        `<span style="vertical-align:middle">${displayName}</span>`;
    }

    // ── 统计卡片（4项，精简） ──
    const quizCorrect = question.correct || 0;
    const quizTotal = question.total_attempts || 0;
    const quizRate = quizTotal ? Math.round((quizCorrect / quizTotal) * 100) : 0;

    const statCards = [
      { value: student.study_hours > 0 ? `${student.study_hours}h` : "—", label: "选课学习时间" },
      { value: quizTotal > 0 ? `${quizRate}%` : "—", label: "答题正确率" },
      { value: annotation.ask_count || 0, label: "批注提问" },
      { value: quizTotal || 0, label: "答题总数" },
    ].map((s) => `
      <div class="teacher-stat-card">
        <div class="stat-value">${escapeHtml(String(s.value))}</div>
        <div class="stat-label">${escapeHtml(s.label)}</div>
      </div>
    `).join("");

    // ── 事件记录（核心） ──
    const sessions = reading.sessions || [];
    const allEvents = sessions.map((s) => ({
      ts: s.start_ts || 0,
      end_ts: s.end_ts || 0,
      dur: s.duration_sec || 0,
      bid: s.bid || "",
      ci: s.ci_raw || "",
      event: "reading",
    }));

    const idleGaps = reading.idle_gaps || [];
    for (const g of idleGaps) {
      allEvents.push({
        ts: g.start_ts || 0,
        end_ts: g.end_ts || 0,
        dur: g.idle_sec || 0,
        bid: "",
        ci: "",
        event: "idle",
      });
    }

    allEvents.sort((a, b) => b.ts - a.ts);

    const eventTypes = ["reading", "idle", "session_complete", "chapter_complete", "selection", "snapshot", "scroll", "focus_in", "focus_out"];
    const eventLabels = {
      reading: "阅读",
      idle: "空档",
      session_complete: "完成小节",
      chapter_complete: "完成章节",
      selection: "选中文本",
      snapshot: "心跳",
      scroll: "滚动",
      focus_in: "进入阅读",
      focus_out: "离开阅读",
    };

    const filterTags = eventTypes.map((et) => {
      const active = !state._teacherEventFilter || state._teacherEventFilter.has(et);
      const count = allEvents.filter((e) => e.event === et).length;
      if (!count) return "";
      return `<span class="teacher-filter-tag ${active ? "is-active" : ""}" data-filter-event="${et}">${eventLabels[et] || et}(${count})</span>`;
    }).filter(Boolean).join("");

    let filtered = allEvents;
    if (state._teacherEventFilter && state._teacherEventFilter.size > 0) {
      filtered = allEvents.filter((e) => state._teacherEventFilter.has(e.event));
    }

    const rows = filtered.slice(0, 200).map((e) => {
      const tsStr = e.ts ? formatTs(e.ts) : "";
      const durText = e.dur ? formatSecondsToHMS(e.dur) : "";
      const ciText = e.ci !== "" && e.ci !== "-1" ? `ch${Number(e.ci) + 1}` : "";
      return `<div class="teacher-event-row">
        <span class="teacher-event-time">${tsStr}</span>
        <span class="teacher-event-type" data-type="${escapeHtml(e.event)}">${eventLabels[e.event] || e.event}</span>
        <span class="teacher-event-info">${durText ? `${durText}` : ""}${ciText ? ` · ${ciText}` : ""}</span>
      </div>`;
    }).join("");

    const eventListHtml = `
      <div class="teacher-section-title">事件记录 · ${filtered.length}条</div>
      <div class="teacher-filter-bar">${filterTags}</div>
      <div class="teacher-event-list" id="teacherEventList">
        ${rows || '<div class="teacher-idle-item">暂无匹配事件</div>'}
      </div>
    `;

    // 答题详情（有数据时才展示）
    let quizDetailHtml = "";
    if (quizTotal > 0) {
      const byDiff = question.by_difficulty || {};
      const diffRows = Object.entries(byDiff).map(([diff, v]) => {
        const total = (v.correct || 0) + (v.incorrect || 0) + (v.unknown || 0);
        const rate = total > 0 ? Math.round(((v.correct || 0) / total) * 100) : 0;
        return `<div class="teacher-event-row">
          <span class="teacher-event-type" data-type="difficulty">${diff}</span>
          <span class="teacher-event-info">${v.correct || 0}对/${v.incorrect || 0}错 · ${rate}%</span>
        </div>`;
      }).join("");
      quizDetailHtml = `
        <div class="teacher-section-title">答题难度分布</div>
        <div class="teacher-event-list">${diffRows}</div>
      `;
    }

    el.timePieChart.innerHTML = `
      <div class="teacher-panel-shell">
        <div class="teacher-detail-panel">
          <div class="teacher-stat-grid">${statCards}</div>
          ${eventListHtml}
          ${quizDetailHtml}
        </div>
      </div>
    `;

    // ── 事件绑定 ──
    // 返回按钮
    const backBtnEl = document.getElementById("teacherBackBtn");
    if (backBtnEl) {
      backBtnEl.addEventListener("click", () => {
        state.teacherSelectedUid = "";
        state.teacherStudentAnalysis = null;
        state._teacherEventFilter = null;
        state.teacherView = String(state.teacherReturnView || "home");
        renderTeacherPanel();
        if (el.dashboardSidePanelTitle) {
          el.dashboardSidePanelTitle.textContent = "教师Panel";
        }
      });
      backBtnEl.addEventListener("mouseenter", () => { backBtnEl.style.opacity = "1"; });
      backBtnEl.addEventListener("mouseleave", () => { backBtnEl.style.opacity = "0.7"; });
    }

    // 事件类型筛选
    const filterBar = el.timePieChart.querySelector(".teacher-filter-bar");
    if (filterBar) {
      filterBar.addEventListener("click", (ev) => {
        const tag = ev.target.closest("[data-filter-event]");
        if (!tag) return;
        const eventType = tag.getAttribute("data-filter-event");
        if (!state._teacherEventFilter) state._teacherEventFilter = new Set();
        if (state._teacherEventFilter.has(eventType)) {
          state._teacherEventFilter.delete(eventType);
        } else {
          state._teacherEventFilter.add(eventType);
        }
        // 全选等于无筛选
        if (state._teacherEventFilter.size >= eventTypes.length) {
          state._teacherEventFilter.clear();
        }
        renderTeacherStudentDetail();
      });
    }
  }

  function formatSecondsToHMS(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem ? `${m}分${rem}秒` : `${m}分`;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return min ? `${h}时${min}分` : `${h}时`;
  }

  function focusLabel(focus) {
    const map = { reader: "阅读", blur: "离开", chat: "聊天" };
    return map[focus] || focus;
  }

  function renderPie() {
    if (el.timePieChart) {
      el.timePieChart.hidden = true;
      el.timePieChart.innerHTML = "";
    }
    state.dashboardPieTab = "profile";
    syncPieProfileTabs();
  }

// ─────── Feed Rendering & Compose ─────────────────────────────────────

  /**
   * 渲染左侧频道列表
   */
  function renderFeedChannelList() {
      if (!el.feedChannelList) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const selectedId = String(state.selectedFeedChannelId || "public_all");

      const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

      const seenChannelIds = new Set();
      const channelItems = [
          { id: "public_all", title: "所有动态", builtin: true },
          ...channels
      ].reduce((rows, row) => {
          const channelId = String((row && row.id) || "").trim();

          if (!channelId || seenChannelIds.has(channelId)) {
              return rows;
          }

          seenChannelIds.add(channelId);
          rows.push(Object.assign({}, row, {
              id: channelId,
              title: channelId === "public_all" ? "所有动态" : String((row && row.title) || channelId).trim(),
          }));
          return rows;
      }, []);

      el.feedChannelList.innerHTML = channelItems.map((row) => {
          const channelId = String((row && row.id) || "").trim();
          const channelTitle = String((row && row.title) || "").trim();
          const isActive = channelId === selectedId;
          const isBuiltin = !!(row && row.builtin);

          return `
              <div class="feed-channel-item${isActive ? " is-active" : ""}" data-channel-id="${escapeHtml(channelId)}">
                  <button class="feed-channel-select-btn" type="button" data-feed-channel-select data-channel-id="${escapeHtml(channelId)}" aria-current="${isActive ? "true" : "false"}">
                      <span class="feed-channel-item-name">${escapeHtml(channelTitle)}</span>
                  </button>
                  ${!isBuiltin ? `
                      <button class="feed-channel-action-btn" type="button" data-action="edit-channel" data-channel-id="${escapeHtml(channelId)}" title="编辑频道" aria-label="编辑频道 ${escapeHtml(channelTitle)}">${editIcon}</button>
                  ` : ""}
              </div>
          `;
      }).join("");
  }

  /**
   * 渲染动态内容列表
   */
  function renderLearningFeeds() {
      if (!el.learningFeedPanel) return;

      if (el.progressList) el.progressList.hidden = state.dashboardSideTab === "feed";
      if (el.feedLayout) el.feedLayout.hidden = state.dashboardSideTab !== "feed";
      if (el.learningFeedComposeBtn) el.learningFeedComposeBtn.hidden = state.dashboardSideTab !== "feed";

      if (state.dashboardSideTab !== "feed") return;

      renderFeedChannelList();

      const rows = Array.isArray(state.learningFeeds) ? state.learningFeeds : [];
      if (!rows.length) {
          el.learningFeedPanel.innerHTML = '<div class="materials-empty">暂无学习动态</div>';
          return;
      }

      el.learningFeedPanel.innerHTML = `
          <div class="feed-stream-list">
              ${rows.slice(0, 20).map((row) => {
                  const username = getFeedAuthorName(row);
                  const handle = getFeedAuthorHandle(row);
                  const avatar = getFeedAuthorInitial(row);
                  const avatarUrl = getFeedAuthorAvatarUrl(row);
                  const summary = String(row.summary || row.content || "").trim() || "暂无内容";
                  const summaryHtml = renderTextWithMentions(summary);
                  const liked = Array.isArray(row.liked_user_ids) && row.liked_user_ids.includes(state.username);
                  const likesCount = Math.max(0, Number(row.likes_count) || 0);
                  const commentsCount = Math.max(0, Number(row.comments_count) || 0);
                  const timeText = formatFeedRelativeTime(row.timestamp);
                  const feedId = String(row.id || "").trim();
                  const expanded = !!state.feedExpandedMap[feedId];
                  const comments = Array.isArray(row.comments) ? row.comments : [];
                  const draft = String(state.feedCommentDrafts[feedId] || "");
                  const isAdminAuthor = !!row.author_is_admin;
                  const canDeleteFeed = !!row.can_delete;
                  const mentionState = state.feedMentionState && state.feedMentionState.key === `comment:${feedId}` ? state.feedMentionState : null;
                  const likeIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M7 10h4l2-5c.2-.5.7-.8 1.2-.8.9 0 1.6.7 1.6 1.6v2.2h2.7c1.2 0 2.1 1.1 1.8 2.3l-1.4 7A2 2 0 0 1 17.7 19H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                          <path d="M4 10h3v9H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const commentIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 12.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const timeIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
                          <path d="M12 7.8v4.6l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const verifiedIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="12" r="9" fill="#2563eb"/>
                          <path d="M8 12.3l2.3 2.3 5-5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const trashIcon = renderTrashIcon();
                  const renderComments = expanded ? `
                      <div class="feed-comments">
                          <div class="feed-comment-compose">
                              <div class="feed-comment-compose-main">
                                  <input class="feed-comment-input" type="text" data-feed-comment-input="${escapeHtml(feedId)}" placeholder="发表评论..." value="${escapeHtml(draft)}" autocomplete="off">
                                  <div class="feed-mention-menu" data-feed-mention-menu="${escapeHtml(feedId)}" hidden style="display:none"></div>
                              </div>
                              <button class="feed-comment-send" type="button" data-feed-action="comment-send" data-feed-id="${escapeHtml(feedId)}" aria-label="发送评论" title="发送评论">
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                      <path d="M4 11.5L20 4l-4.6 16-3.1-5.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                                  </svg>
                              </button>
                          </div>
                          <div class="feed-comment-list">
                              ${comments.length ? comments.map((comment) => {
                                  const commentAuthor = getFeedAuthorName(comment);
                                  const commentHandle = getFeedAuthorHandle(comment);
                                  const commentAvatar = getFeedAuthorAvatarUrl(comment);
                                  const commentInitial = getFeedAuthorInitial(comment);
                                  const commentTime = formatFeedRelativeTime(comment.timestamp);
                                  const isAdminCommentAuthor = !!comment.author_is_admin;
                                  const canDeleteComment = !!comment.can_delete;
                                  const commentId = String(comment.id || "").trim();
                                  return `
                                      <div class="feed-comment-item">
                                          ${commentAvatar
                                              ? `<img class="feed-comment-avatar feed-comment-avatar-image" src="${escapeHtml(commentAvatar)}" alt="${escapeHtml(commentAuthor)}">`
                                              : `<div class="feed-comment-avatar">${escapeHtml(commentInitial)}</div>`}
                                          <div class="feed-comment-main">
                                              <div class="feed-comment-head">
                                                  <span class="feed-comment-author">${escapeHtml(commentAuthor)}</span>
                                                  ${isAdminCommentAuthor ? `<span class="feed-item-verified feed-comment-verified" title="管理员">${verifiedIcon}</span>` : ""}
                                                  ${commentHandle ? `<span class="feed-comment-handle">@${escapeHtml(commentHandle)}</span>` : ""}
                                                  ${commentTime ? `<span class="feed-comment-time">${escapeHtml(commentTime)}</span>` : ""}
                                                  ${canDeleteComment ? `<button class="feed-comment-delete" type="button" data-feed-action="comment-delete" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" aria-label="删除评论" title="删除评论">${trashIcon}</button>` : ""}
                                              </div>
                                              <div class="feed-comment-content">${renderTextWithMentions(String(comment.content || "").trim())}</div>
                                              <div class="feed-comment-actions">
                                                  <button class="feed-comment-action-btn ${Array.isArray(comment.liked_user_ids) && comment.liked_user_ids.includes(state.username) ? "is-active" : ""}" type="button" data-feed-action="comment-like" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" aria-label="点赞评论" title="点赞评论">
                                                      <span class="feed-action-icon">${likeIcon}</span>
                                                      <span class="feed-action-count">${Math.max(0, Number(comment.likes_count) || 0)}</span>
                                                  </button>
                                                  <button class="feed-comment-action-btn" type="button" data-feed-action="comment-reply" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" data-comment-username="${escapeHtml(commentHandle || String((comment && comment.author && comment.author.user_id) || ''))}" aria-label="回复评论" title="回复评论">
                                                      <span class="feed-action-icon">${renderReplyIcon()}</span>
                                                      <span class="feed-action-label">回复</span>
                                                  </button>
                                              </div>
                                          </div>
                                      </div>
                                  `;
                              }).join("") : '<div class="feed-comments-empty">暂无评论</div>'}
                          </div>
                      </div>
                  ` : "";

                  return `
                      <article class="feed-item">
                          ${avatarUrl
                              ? `<img class="feed-item-avatar feed-item-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">`
                              : `<div class="feed-item-avatar">${escapeHtml(avatar)}</div>`}
                          <div class="feed-item-body">
                              <div class="feed-item-head">
                                  <div class="feed-item-author-row">
                                      <span class="feed-item-author">${escapeHtml(username)}</span>
                                      ${isAdminAuthor ? `<span class="feed-item-verified" title="管理员">${verifiedIcon}</span>` : ""}
                                      ${handle ? `<span class="feed-item-handle">@${escapeHtml(handle)}</span>` : ""}
                                      ${timeText ? `<span class="feed-item-time"><span class="feed-time-icon">${timeIcon}</span><span>${escapeHtml(timeText)}</span></span>` : ""}
                                  </div>
                              </div>
                              <div class="feed-item-summary">${summaryHtml}</div>
                              <div class="feed-item-foot">
                                  <div class="feed-item-actions">
                                      <button class="feed-action-btn ${liked ? "is-active" : ""}" type="button" data-feed-action="like" data-feed-id="${escapeHtml(String(row.id || ""))}" aria-label="点赞" title="点赞">
                                          <span class="feed-action-icon">${likeIcon}</span>
                                          <span class="feed-action-count">${likesCount}</span>
                                      </button>
                                      <button class="feed-action-btn" type="button" data-feed-action="comment-toggle" data-feed-id="${escapeHtml(feedId)}" aria-label="评论" title="展开评论" aria-expanded="${expanded ? "true" : "false"}">
                                          <span class="feed-action-icon">${commentIcon}</span>
                                          <span class="feed-action-count">${commentsCount}</span>
                                      </button>
                                      ${canDeleteFeed ? `<button class="feed-action-btn feed-action-btn-danger" type="button" data-feed-action="feed-delete" data-feed-id="${escapeHtml(feedId)}" aria-label="删除动态" title="删除动态"><span class="feed-action-icon">${trashIcon}</span></button>` : ""}
                                  </div>
                              </div>
                              ${renderComments}
                              <div class="feed-item-divider" aria-hidden="true"></div>
                          </div>
                      </article>
                  `;
              }).join("")}
          </div>
      `;
  }

  function syncDashboardSideTabs() {
    const isProgress = state.dashboardSideTab !== "feed";
    state.dashboardSideTab = isProgress ? "progress" : "feed";
    if (el.dashboardProgressTabBtn) {
      el.dashboardProgressTabBtn.classList.toggle("is-active", isProgress);
      el.dashboardProgressTabBtn.setAttribute("aria-selected", isProgress ? "true" : "false");
    }
    if (el.dashboardProgressFeedTabBtn) {
      el.dashboardProgressFeedTabBtn.classList.toggle("is-active", !isProgress);
      el.dashboardProgressFeedTabBtn.setAttribute("aria-selected", !isProgress ? "true" : "false");
    }
    if (el.openMaterialsViewBtn) {
      el.openMaterialsViewBtn.hidden = !isProgress;
    }
    if (el.dashboardFocusPanel) {
      el.dashboardFocusPanel.hidden = !isProgress;
    }
    if (el.feedLayout) {
      el.feedLayout.hidden = isProgress;
    }
    renderPie();
    renderLearningFeeds();
  }

  function syncPieProfileTabs() {
    state.dashboardPieTab = "profile";
    if (el.dashboardPieTabBtn) {
      el.dashboardPieTabBtn.classList.remove("is-active");
      el.dashboardPieTabBtn.setAttribute("aria-selected", "false");
    }
    if (el.dashboardProfileTabBtn) {
      el.dashboardProfileTabBtn.classList.add("is-active");
      el.dashboardProfileTabBtn.setAttribute("aria-selected", "true");
    }
    if (el.timePieChart) {
      el.timePieChart.hidden = true;
    }
    if (el.userProfileDimensions) {
      el.userProfileDimensions.hidden = false;
    }
    renderDashboardNotifications();
  }

  async function loadUserProfile() {
    try {
      const resp = await fetch("/api/frontend/profile", { credentials: "same-origin" });
      const data = await resp.json();
      if (data && data.success) {
        state.userProfile = data;
      }
    } catch (_err) {
      state.userProfile = null;
    }
  }

  async function loadDashboardNotifications() {
    const data = await fetchJson("/api/frontend/notifications?limit=20");
    state.notifications = Array.isArray(data.items) ? data.items : [];
    state.adminPendingParse = data.admin_pending_parse && typeof data.admin_pending_parse === "object"
      ? data.admin_pending_parse
      : { count: 0, items: [] };
  }

  function renderNotificationTime(row) {
    const ts = Number(row && row.date);
    return Number.isFinite(ts) && ts > 0 ? formatTs(ts) : "";
  }

  function getNotificationId(row) {
    return String(row && (row.notification_id || row.id) || "").trim();
  }

  function isFeedNotification(row) {
    return String(row && row.source || "").trim().toLowerCase() === "feed";
  }

  function getNotificationActor(row) {
    return row && typeof row.actor === "object" ? row.actor : {};
  }

  function getNotificationActorName(row) {
    const actor = getNotificationActor(row);
    return String(
      actor.nickname
      || actor.display_name
      || actor.username
      || actor.user_id
      || row.actor_user_id
      || "用户"
    ).trim() || "用户";
  }

  function renderNotificationActorAvatar(row) {
    if (!isFeedNotification(row)) return "";

    const actorName = getNotificationActorName(row);
    const actor = getNotificationActor(row);
    const avatarUrl = normalizeFeedAvatarUrl(String(actor.avatar_url || actor.avatar || "").trim());
    const initial = (Array.from(actorName)[0] || "动").toUpperCase();

    return avatarUrl
      ? `<img class="dashboard-notice-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(actorName)}">`
      : `<div class="dashboard-notice-avatar dashboard-notice-avatar-fallback">${escapeHtml(initial)}</div>`;
  }

  function renderNotificationRemoveIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `;
  }

  async function removeDashboardNotification(notificationId) {
    const targetId = String(notificationId || "").trim();

    if (!targetId) return;

    await fetchJson(`/api/frontend/notifications/${encodeURIComponent(targetId)}/remove`, {
      method: "POST",
    });

    state.notifications = (Array.isArray(state.notifications) ? state.notifications : [])
      .filter((row) => getNotificationId(row) !== targetId);
    renderDashboardNotifications();
  }

  function renderDashboardNotifications() {
    if (!el.userProfileDimensions) return;
    const notifications = Array.isArray(state.notifications) ? state.notifications : [];
    const pending = state.adminPendingParse && typeof state.adminPendingParse === "object"
      ? state.adminPendingParse
      : { count: 0, items: [] };
    const pendingCount = Number(pending.count) || 0;
    const pendingItems = Array.isArray(pending.items) ? pending.items : [];
    const pendingHtml = state.isAdmin && pendingCount > 0 ? `
      <button class="dashboard-notice-admin-alert" type="button" data-view="settings" data-settings-tab="refinement">
        <div class="dashboard-notice-alert-title">待解析教材</div>
        <div class="dashboard-notice-alert-count">${pendingCount}</div>
        <div class="dashboard-notice-alert-sub">${escapeHtml(pendingItems.slice(0, 2).map((item) => String(item.book_title || "").trim()).filter(Boolean).join("、") || "有教材等待解析")}</div>
      </button>
    ` : "";

    const notificationHtml = notifications.length ? notifications.map((row) => {
      const title = String(row.title || "通知").trim();
      const content = String(row.content || "").trim();
      const timeText = renderNotificationTime(row);
      const jumpto = String(row.jumpto || "").trim();
      const notificationId = getNotificationId(row);
      const actorAvatarHtml = renderNotificationActorAvatar(row);
      const itemClass = actorAvatarHtml ? "dashboard-notice-item has-avatar" : "dashboard-notice-item";

      return `
        <article class="${itemClass}" ${jumpto ? `data-notice-jumpto="${escapeHtml(jumpto)}"` : ""} ${notificationId ? `data-notification-id="${escapeHtml(notificationId)}"` : ""}>
          ${actorAvatarHtml}
          <div class="dashboard-notice-main">
            <div class="dashboard-notice-title">${escapeHtml(title)}</div>
            ${content ? `<div class="dashboard-notice-content">${escapeHtml(content)}</div>` : ""}
            ${timeText ? `<div class="dashboard-notice-time">${escapeHtml(timeText)}</div>` : ""}
          </div>
          ${notificationId ? `
            <button class="dashboard-notice-remove" type="button" data-notice-remove-id="${escapeHtml(notificationId)}" aria-label="移除通知" title="移除通知">
              ${renderNotificationRemoveIcon()}
            </button>
          ` : ""}
        </article>
      `;
    }).join("") : '<div class="dashboard-notice-empty">暂无通知</div>';

    el.userProfileDimensions.innerHTML = `
      <section class="dashboard-notice-list">
        ${pendingHtml}
        ${notificationHtml}
      </section>
    `;
  }

  function renderReplyIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 7 4 12l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 12h7.5c4 0 6.5 2 8 5- .2-6.2-4-10-10.2-10H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function sendHostMessage(payload) {
    const data = Object.assign({ source: "nexora-learning" }, payload || {});
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(data, "*");
      }
    } catch (_err) {}
    try {
      window.dispatchEvent(new CustomEvent(String(data.type || "nexora:unknown"), { detail: data }));
    } catch (_err) {}
  }

  function enterFeedComposeMode() {
    state.dynamicPosting = true;
    sendHostMessage({ type: "nexora:feed-compose:toggle", active: true });
  }

  function exitFeedComposeMode() {
    state.dynamicPosting = false;
    sendHostMessage({ type: "nexora:feed-compose:toggle", active: false });
  }

  async function postLearningFeed(content) {
    const text = String(content || "").trim();
    if (!text) throw new Error("动态内容不能为空");
    const data = await fetchJson("/api/frontend/learning-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: text,
        content: text,
        channel_id: String(state.selectedFeedChannelId || "public_all"),
      }),
    });
    await loadLearningFeeds();
    exitFeedComposeMode();
    return data;
  }

  async function deleteLearningFeed(feedId) {
    const id = String(feedId || "").trim();
    if (!id) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await loadLearningFeeds();
    renderLearningFeeds();
  }

  async function deleteLearningFeedComment(feedId, commentId) {
    const fid = String(feedId || "").trim();
    const cid = String(commentId || "").trim();
    if (!fid || !cid) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(fid)}/comments/${encodeURIComponent(cid)}`, {
      method: "DELETE",
    });
    state.feedExpandedMap[fid] = true;
    await loadLearningFeeds();
    renderLearningFeeds();
  }

  window.addEventListener("message", async (event) => {
    const data = event && event.data;
    if (!data || typeof data !== "object") return;
    if (String(data.source || "").trim().toLowerCase() !== "nexora-learning") return;
    const msgType = String(data.type || "").trim().toLowerCase();
    const requestId = String(data.requestId || "").trim();
    if (msgType === "nexora:feed-compose:submit") {
      try {
        const result = await postLearningFeed(String(data.content || ""));
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-compose:result",
            requestId,
            success: true,
            item: result && result.item ? result.item : null,
          }, "*");
        }
      } catch (err) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-compose:result",
            requestId,
            success: false,
            error: String(err && err.message ? err.message : "发布动态失败"),
          }, "*");
        }
      }
      return;
    }
    if (msgType === "nexora:feed-users:search") {
      try {
        const query = String(data.q || "").trim();
        const limit = Math.max(1, Math.min(Number(data.limit) || 8, 20));
        const rows = await searchFeedUsers(query, limit);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-users:search:result",
            requestId,
            success: true,
            items: Array.isArray(rows) ? rows : [],
          }, "*");
        }
      } catch (err) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-users:search:result",
            requestId,
            success: false,
            error: String(err && err.message ? err.message : "搜索失败"),
            items: [],
          }, "*");
        }
      }
    }
  });

// ─────── User Profile ─────────────────────────────────────────────────
  function renderUserProfile() {
    const username = getCurrentUserDisplayName();
    const identity = String((state.user && (state.user.identity || state.user.role)) || "").trim().toLowerCase();
    const role = state.isAdmin ? "管理员" : (identity === "teacher" ? "教师" : "成员");
    const avatar = (Array.from(username.trim())[0] || "N").toUpperCase();
    const avatarUrl = getCurrentUserAvatarUrl();
    const booksCount = state.allLectureRows.reduce((sum, row) => sum + toNumber(row && row.books_count, 0), 0);
    const connected = !!(state.integration && state.integration.connected);
    const modelsCount = toNumber(state.integration && state.integration.models_count, 0);
    const totalHours = toNumber(state.totalStudyHours, 0);

    el.userProfileCard.innerHTML = `
      ${avatarUrl
        ? `<img class="user-profile-avatar user-profile-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">`
        : `<div class="user-profile-avatar">${escapeHtml(avatar)}</div>`}
      <div class="user-profile-meta">
        <div class="user-profile-name">${escapeHtml(username)}</div>
        <div class="user-profile-line">角色：${escapeHtml(role)} · 全部课程：${state.allLectureRows.length} · 教材：${booksCount}</div>
        <div class="user-profile-line">学习时长：${totalHours > 0 ? `${totalHours.toFixed(1)}h` : "0h"} · 模型：${connected ? `已连接(${modelsCount})` : "未连接"}</div>
      </div>
    `;
  }

// ─────── Refinement Helpers ───────────────────────────────────────────
  function refinementStatusText(item) {
    const progress = String(item && item.progress_text || "").trim();
    if (progress) return progress;
    const refine = normalizeStatusKey(item && item.refinement_status);
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const job = normalizeStatusKey(item && item.job_status);
    if (["running", "queued"].includes(job)) return job === "running" ? "精读执行中" : "精读排队中";
    if (["running", "queued"].includes(intensive)) return intensive === "running" ? "精读执行中" : "精读排队中";
    if (["done", "completed", "success"].includes(intensive)) return "精读完成";
    if (["error", "failed"].includes(refine) || ["error", "failed"].includes(coarse)) return "精读失败";
    if (["done", "completed", "success"].includes(coarse)) return "粗读完成，待精读";
    if (coarse === "outlined") return "粗读目录已生成，待继续补摘要";
    if (["extracting", "extracted", "queued", "uploaded"].includes(refine)) return `待精读（${refine}）`;
    return refine || coarse || "待精读";
  }

  function canStartRefinement(item) {
    const refine = normalizeStatusKey(item && item.refinement_status);
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const job = normalizeStatusKey(item && item.job_status);
    if (["running", "queued"].includes(job)) return false;
    if (["done", "completed"].includes(coarse)) return false;
    if (["running", "queued", "extracting"].includes(refine)) return false;
    return true;
  }

  function markRefinementItemCoarseQueued(lectureId, bookId) {
    const lectureKey = String(lectureId || "").trim();
    const bookKey = String(bookId || "").trim();
    const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];
    const row = rows.find((item) => (
      String(item && item.lecture_id || "").trim() === lectureKey &&
      String(item && item.book_id || "").trim() === bookKey
    ));

    if (!row) {
      return;
    }

    row.refinement_status = "queued";
    row.coarse_status = "queued";
    row.job_status = "queued";
    row.refinement_error = "";
    row.coarse_error = "";
    row.progress_text = "模型排队中...";
  }

  function canStartIntensive(item) {
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const job = normalizeStatusKey(item && item.job_status);
    if (!["done", "completed", "success"].includes(coarse)) return false;
    if (["running", "queued"].includes(job)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(intensive)) return false;
    return true;
  }

  function canStartQuestion(item) {
    return false;
  }

  function canStartSection(item) {
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const section = normalizeStatusKey(item && item.section_status);
    const job = normalizeStatusKey(item && item.job_status);
    const sectionJob = normalizeStatusKey(item && item.section_job_status);
    const intensiveReady = ["done", "completed", "success"].includes(intensive);

    if (!intensiveReady) return false;

    if (["running", "queued"].includes(job) || ["running", "queued"].includes(sectionJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(section)) return false;
    return true;
  }

  function canStartAnnotation(item) {
    const section = normalizeStatusKey(item && item.section_status);
    const annotation = normalizeStatusKey(item && item.annotation_status);
    const job = normalizeStatusKey(item && item.job_status);
    const annotationJob = normalizeStatusKey(item && item.annotation_job_status);
    const sectionReady = ["done", "completed", "success"].includes(section);
    if (!sectionReady) return false;
    if (["running", "queued"].includes(job) || ["running", "queued"].includes(annotationJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(annotation)) return false;
    return true;
  }

  function canStartVideo(item) {
    const summary = normalizeStatusKey(item && item.summary_status);
    const video = normalizeStatusKey(item && item.video_status);
    const videoJob = normalizeStatusKey(item && item.video_job_status);
    // 概述完成，或概述跳过（已有其他步骤完成），都可以搜视频
    const anyStepDone = ["coarse", "section", "intensive", "question", "annotation", "summary"].some(
      (k) => ["done", "completed", "success"].includes(normalizeStatusKey(item && item[`${k}_status`]))
    );
    if (!anyStepDone) return false;
    if (["running", "queued"].includes(videoJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(video)) return false;
    return true;
  }

  function canStartSummary(item) {
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const section = normalizeStatusKey(item && item.section_status);
    const summary = normalizeStatusKey(item && item.summary_status);
    const job = normalizeStatusKey(item && item.job_status);
    const summaryJob = normalizeStatusKey(item && item.summary_job_status);
    const coarseReady = ["done", "completed", "success"].includes(coarse);
    const sectionReady = ["done", "completed", "success"].includes(section);
    if (!coarseReady && !sectionReady) return false;
    if (["running", "queued"].includes(job) || ["running", "queued"].includes(summaryJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(summary)) return false;
    return true;
  }

  function canStartOutline(item) {
    const outline = normalizeStatusKey(item && item.outline_status);
    if (["running", "queued", "done", "completed", "success"].includes(outline)) return false;
    return true;
  }

  function isDoneStatus(value) {
    return ["done", "completed", "success"].includes(normalizeStatusKey(value));
  }

  function isRunningStatus(value) {
    return ["running", "queued"].includes(normalizeStatusKey(value));
  }

  function isErrorStatus(value) {
    return ["error", "failed"].includes(normalizeStatusKey(value));
  }

  // Agent 定义：按实际管线顺序排列
  const AGENT_PIPELINE = [
    { key: "coarse",     label: "概读", desc: "分析教材结构" },
    { key: "section",    label: "分节", desc: "拆分章节单元" },
    { key: "intensive",  label: "精读", desc: "深度分析内容" },
    { key: "question",   label: "出题", desc: "生成练习题目" },
    { key: "annotation", label: "批注", desc: "生成学习批注" },
    { key: "summary",    label: "概述", desc: "生成全书概述" },
    { key: "video",      label: "视频", desc: "搜索相关视频" },
  ];

  function getAgentStatus(item, agentKey) {
    const status = normalizeStatusKey(item && item[`${agentKey}_status`]);
    const done = isDoneStatus(status);
    const running = isRunningStatus(status);
    const error = isErrorStatus(status);
    const idle = !done && !running && !error && status !== "empty";
    const pending = idle && !_canAgentRun(item, agentKey);
    return { status, done, running, error, idle, pending };
  }

  function _canAgentRun(item, agentKey) {
    if (agentKey === "coarse") return canStartRefinement(item);
    if (agentKey === "section") return canStartSection(item);
    if (agentKey === "intensive") return canStartIntensive(item);
    if (agentKey === "question") return canStartQuestion(item);
    if (agentKey === "annotation") return canStartAnnotation(item);
    if (agentKey === "summary") return canStartSummary(item);
    if (agentKey === "video") return canStartVideo(item);
    return true;
  }

  function getCurrentAgentKey(item) {
    for (const agent of AGENT_PIPELINE) {
      const s = getAgentStatus(item, agent.key);
      if (s.running) return agent.key;
      if (!s.done && !s.error) return agent.key;
    }
    return "summary";
  }

  function buildRefineFlow(item) {
    const hasError = AGENT_PIPELINE.some((a) => isErrorStatus(normalizeStatusKey(item && item[`${a.key}_status`])));
    const steps = AGENT_PIPELINE.map((agent) => {
      const s = getAgentStatus(item, agent.key);
      return { key: agent.key, label: agent.label, icon: agent.icon, desc: agent.desc, done: s.done, running: s.running, error: s.error, pending: s.pending };
    });
    const doneCount = steps.filter((row) => row.done).length;
    const activeIndex = steps.findIndex((row) => row.running);
    let percent = (doneCount / steps.length) * 100;
    if (activeIndex >= 0 && doneCount < steps.length) {
      percent = Math.max(percent, ((activeIndex + 0.5) / steps.length) * 100);
    }
    percent = Math.max(0, Math.min(100, percent));
    return { steps, doneCount, activeIndex, percent, hasError };
  }

  function getRefinementActionMeta(item) {
    const coarseDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.coarse_status));
    const summaryDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.summary_status));
    const intensiveDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.intensive_status));
    const sectionDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.section_status));
    const annotationDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.annotation_status));
    if (!coarseDone) {
      return {
        action: "start-refinement",
        title: "开始粗读",
        text: "▶",
        enabled: canStartRefinement(item),
      };
    }

    if (!intensiveDone) {
      return {
        action: "start-intensive",
        title: "开始精读",
        text: "◎",
        enabled: canStartIntensive(item),
      };
    }

    if (!sectionDone) {
      return {
        action: "start-section",
        title: "开始分节",
        text: "§",
        enabled: canStartSection(item),
      };
    }
    if (!summaryDone) {
      return {
        action: "start-summary",
        title: "生成全书概述",
        text: "◆",
        enabled: canStartSummary(item),
      };
    }
    if (!annotationDone) {
      return {
        action: "start-annotation",
        title: "开始批注",
        text: "✎",
        enabled: canStartAnnotation(item),
      };
    }

    const videoDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.video_status));
    if (!videoDone) {
      return {
        action: "start-video",
        title: "搜索视频",
        text: "📺",
        enabled: canStartVideo(item),
      };
    }

    return {
      action: "",
      title: "全部完成",
      text: "✓",
      enabled: false,
    };
  }

// ─────── Settings: Rendering ──────────────────────────────────────────
  function renderSettingsNav() {
    const tabs = [
      { id: "refinement", title: "教材管理" },
      { id: "courses", title: "课程管理" },
      { id: "model", title: "模型配置" },
      { id: "channels", title: "频道与推送" },
      { id: "users", title: "用户管理" },
      { id: "logs", title: "系统日志" },
    ];
    el.settingsNavList.innerHTML = `<div class="settings-tab-bar">
      ${tabs.map((tab) => `<button class="settings-tab ${state.settingsTab === tab.id ? "is-active" : ""}" data-settings-tab="${tab.id}" type="button">${escapeHtml(tab.title)}</button>`).join("")}
    </div>`;
  }

  function getSettingsUserRoleLabel(role) {
    const value = String(role || "").trim().toLowerCase();
    if (value === "admin") return "管理员";
    if (value === "teacher") return "教师";
    if (value === "student") return "学生";
    if (value === "member") return "成员";
    return value ? value : "成员";
  }

  function getSettingsUserIdentityLabel(identity) {
    const value = String(identity || "").trim().toLowerCase();
    if (value === "admin") return "锁定";
    if (value === "teacher") return "教师";
    if (value === "student") return "学生";
    return "未设置";
  }

  function recalcSettingsUsersSummary(rows) {
    const items = Array.isArray(rows) ? rows : [];
    return {
      total: items.length,
      admins: items.filter((row) => String(row.role || "").trim().toLowerCase() === "admin").length,
      teachers: items.filter((row) => String(row.identity || "").trim().toLowerCase() === "teacher").length,
      students: items.filter((row) => String(row.identity || "").trim().toLowerCase() === "student").length,
    };
  }

  function patchSettingsUsersSummary(summary) {
    const source = summary && typeof summary === "object" ? summary : recalcSettingsUsersSummary(state.settingsUsers);
    const map = {
      total: source.total || 0,
      admins: source.admins || 0,
      teachers: source.teachers || 0,
      students: source.students || 0,
    };
    Object.keys(map).forEach((key) => {
      const node = el.settingsDetailPane.querySelector(`[data-settings-users-summary="${key}"]`);
      if (node) node.textContent = String(map[key] || 0);
    });
  }

  function patchSettingsUserCardIdentity(userId, user) {
    const resolvedUserId = String(userId || "").trim();
    if (!resolvedUserId) return;
    const escapedUserId = window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(resolvedUserId)
      : resolvedUserId.replace(/["\\]/g, "\\$&");
    const card = el.settingsDetailPane.querySelector(`.settings-user-card[data-user-id="${escapedUserId}"]`);
    if (!card) return;
    const identity = String((user && user.identity) || "").trim().toLowerCase() === "teacher" ? "teacher" : "student";
    const identityLabel = getSettingsUserIdentityLabel(identity);
    const select = card.querySelector("[data-user-identity-select]");
    if (select instanceof HTMLSelectElement) select.value = identity;
    const pill = card.querySelector(".settings-user-pill-identity");
    if (pill) pill.textContent = identityLabel;
    const saveBtn = card.querySelector("[data-action='save-user-identity']");
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.classList.remove("is-saving");
      saveBtn.disabled = !!saveBtn.dataset.locked;
      saveBtn.title = "保存身份";
    }
  }

  function renderSettingsUsers() {
    const safeIdentity = (v) => {
      const s = String(v || "").trim().toLowerCase();
      return s === "teacher" || s === "student" ? s : "student";
    };
    const rows = Array.isArray(state.settingsUsers) ? state.settingsUsers : [];
    const summary = state.settingsUsersSummary && typeof state.settingsUsersSummary === "object"
      ? state.settingsUsersSummary
      : { total: 0, admins: 0, teachers: 0, students: 0 };
    const loading = !!state.settingsUsersLoading;
    const error = String(state.settingsUsersError || "").trim();
    const emptyHtml = loading
      ? '<div class="materials-empty">用户列表加载中...</div>'
      : '<div class="materials-empty">暂无用户</div>';
    const listHtml = loading
      ? emptyHtml
      : (rows.length ? rows.map((row) => {
        const userId = String(row.user_id || "").trim();
        const username = String(row.username || userId || "").trim() || userId;
        const displayName = String(row.display_name || "").trim();
        const nickname = String(row.nickname || "").trim();
        const description = String(row.description || "").trim();
        const identity = safeIdentity(row.identity);
        const role = String(row.role || "member").trim().toLowerCase() || "member";
        const isAdmin = !!row.is_admin || role === "admin";
        const isSelf = userId === String(state.username || "").trim();
        const isLocked = isAdmin && !isSelf;
        const identityLabel = getSettingsUserIdentityLabel(identity);
        const avatarUrl = normalizeFeedAvatarUrl(String(row.avatar_url || "").trim());
        const avatarText = String((displayName || nickname || username || userId || "U").trim().slice(0, 1) || "U").toUpperCase();
        const identitySelectId = `settingsUserIdentity_${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const displayTitle = displayName || nickname || username || userId || "未命名用户";
        const roleLabel = getSettingsUserRoleLabel(role) + (nickname && nickname !== displayName ? `（${escapeHtml(nickname)}）` : "");
        return `
          <article class="settings-user-card" data-user-id="${escapeHtml(userId)}">
            <div class="settings-user-main">
              ${avatarUrl
                ? `<img class="settings-user-avatar settings-user-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayTitle)}">`
                : `<div class="settings-user-avatar">${escapeHtml(avatarText)}</div>`}
              <div class="settings-user-meta">
                <div class="settings-user-title">
                  <span>${escapeHtml(displayTitle)}</span>
                  <span class="settings-user-pill settings-user-pill-role">${escapeHtml(roleLabel)}</span>
                  <span class="settings-user-pill settings-user-pill-identity">${escapeHtml(identityLabel)}</span>
                </div>
                <div class="settings-user-sub">ID：${escapeHtml(userId)} · 账号：${escapeHtml(username || "—")}</div>
                ${description ? `<div class="settings-user-desc">${escapeHtml(description)}</div>` : ""}
              </div>
            </div>
            <div class="settings-user-actions">
              <label class="settings-user-ctl-label" for="${escapeHtml(identitySelectId)}">身份</label>
              <select id="${escapeHtml(identitySelectId)}" class="input-lite settings-identity-select" data-user-identity-select="${escapeHtml(userId)}" ${isLocked ? "disabled" : ""}>
                <option value="student" ${identity === "student" ? "selected" : ""}>学生</option>
                <option value="teacher" ${identity === "teacher" ? "selected" : ""}>教师</option>
              </select>
              <button class="settings-user-save-btn" type="button" data-action="save-user-identity" data-user-id="${escapeHtml(userId)}" ${isLocked ? "disabled data-locked=\"1\" title=\"不可修改其他管理员身份\"" : "title=\"保存身份\""} aria-label="保存身份">
                <svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                <svg class="spinner-icon" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
              </button>
            </div>
          </article>
        `;
      }).join("") : emptyHtml);

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-sub">查看用户信息，并把身份切换为学生或教师。管理员账号在这里保持锁定。</div>
          <div class="settings-users-summary-grid">
            <div class="settings-users-summary-item"><div class="settings-kv-label">用户总数</div><div class="settings-kv-value" data-settings-users-summary="total">${escapeHtml(String(summary.total || 0))}</div></div>
            <div class="settings-users-summary-item"><div class="settings-kv-label">管理员</div><div class="settings-kv-value" data-settings-users-summary="admins">${escapeHtml(String(summary.admins || 0))}</div></div>
            <div class="settings-users-summary-item"><div class="settings-kv-label">教师</div><div class="settings-kv-value" data-settings-users-summary="teachers">${escapeHtml(String(summary.teachers || 0))}</div></div>
            <div class="settings-users-summary-item"><div class="settings-kv-label">学生</div><div class="settings-kv-value" data-settings-users-summary="students">${escapeHtml(String(summary.students || 0))}</div></div>
          </div>
        </article>
        ${error ? `
          <article class="settings-card">
            <div class="settings-sub" style="color:#b91c1c;">${escapeHtml(error)}</div>
          </article>
        ` : ""}
        <section class="settings-user-list">
          ${listHtml}
        </section>
      </section>
    `;
  }

  function renderSettingsProfile() {
    const username = String(state.user.username || state.username || "访客");
    const identity = String((state.user && (state.user.identity || state.user.role)) || "").trim().toLowerCase();
    const role = state.isAdmin ? "管理员" : (identity === "teacher" ? "教师" : "成员");
    const connected = !!(state.integration && state.integration.connected);
    const modelsCount = toNumber(state.integration && state.integration.models_count, 0);
    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-grid">
            <div><div class="settings-kv-label">用户名</div><div class="settings-kv-value">${escapeHtml(username)}</div></div>
            <div><div class="settings-kv-label">角色</div><div class="settings-kv-value">${escapeHtml(role)}</div></div>
            <div><div class="settings-kv-label">全部课程</div><div class="settings-kv-value">${state.allLectureRows.length}</div></div>
            <div><div class="settings-kv-label">总学习时长</div><div class="settings-kv-value">${toNumber(state.totalStudyHours, 0).toFixed(1)}h</div></div>
          </div>
        </article>
        <article class="settings-card">
          <div class="settings-grid">
            <div><div class="settings-kv-label">连接状态</div><div class="settings-kv-value">${connected ? "已连接" : "未连接"}</div></div>
            <div><div class="settings-kv-label">模型数量</div><div class="settings-kv-value">${modelsCount}</div></div>
            <div><div class="settings-kv-label">Base URL</div><div class="settings-kv-value">${escapeHtml(String(state.integration.base_url || "—"))}</div></div>
            <div><div class="settings-kv-label">Endpoint</div><div class="settings-kv-value">${escapeHtml(String(state.integration.endpoint || "—"))}</div></div>
          </div>
        </article>
      </section>
    `;
  }

  function renderSettingsLogs() {
    const rows = Array.isArray(state.settingsLogs) ? state.settingsLogs : [];
    const sources = Array.isArray(state.settingsLogSources) ? state.settingsLogSources : [];

    // 按时间分组（间隔 < 5 分钟为同一会话）
    const groups = [];
    let currentGroup = null;
    const SESSION_GAP_MS = 5 * 60 * 1000;

    for (const row of rows) {
      const ts = String((row && row.timestamp) || "");
      const tsMs = ts ? new Date(ts).getTime() : 0;

      if (!currentGroup || (tsMs - currentGroup.endTimeMs > SESSION_GAP_MS)) {
        currentGroup = { startTime: ts, endTimeMs: tsMs, rows: [] };
        groups.push(currentGroup);
      }
      currentGroup.rows.push(row);
      if (tsMs > currentGroup.endTimeMs) {
        currentGroup.endTimeMs = tsMs;
      }
    }

    // 渲染日志条目
    const renderLogEntry = (row, idx) => {
      const kind = String((row && row.kind) || "");
      const source = String((row && row.source) || "unknown");
      const title = String((row && (row.title || row.event_type || row.tool_name)) || "");
      const ts = String((row && row.timestamp) || "—");
      const timeStr = ts ? ts.split(" ").pop() || ts : "—";
      const content = kind === "tool_flow"
        ? JSON.stringify({
          arguments: row.arguments || {},
          tool_output: row.tool_output || {},
          model_output: row.model_output || "",
        }, null, 2)
        : kind === "model_text"
          ? String(row.content || "")
          : JSON.stringify({
            payload: row.payload || {},
            content: row.content || "",
          }, null, 2);
      const badgeClass = kind === "model_text" ? "type-model" : kind === "tool_flow" ? "type-tool" : "";
      const badgeLabel = kind === "model_text" ? "模型" : kind === "tool_flow" ? "工具" : "事件";

      return `
        <div class="log-entry" data-log-index="${idx}">
          <div class="log-entry-header" onclick="this.parentElement.classList.toggle('is-expanded')">
            <span class="log-entry-type-badge ${badgeClass}">${badgeLabel}</span>
            <span class="log-entry-title">${escapeHtml(title || source || "日志记录")}</span>
            <span class="log-entry-time">${escapeHtml(timeStr)}</span>
            <svg class="log-entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="log-entry-body">
            <pre>${escapeHtml(content)}</pre>
          </div>
        </div>
      `;
    };

    // 渲染分组
    const groupsHtml = groups.length ? groups.map((group, gIdx) => {
      const startTime = group.startTime || "—";
      const timeStr = startTime ? startTime.split(" ").pop() || startTime : "—";
      const count = group.rows.length;
      const entriesHtml = group.rows.map((row, rIdx) => renderLogEntry(row, `${gIdx}_${rIdx}`)).join("");

      return `
        <div class="settings-log-group ${gIdx === 0 ? "is-expanded" : ""}" data-group-index="${gIdx}">
          <div class="settings-log-group-header" onclick="this.parentElement.classList.toggle('is-expanded')">
            <span class="settings-log-group-title">${escapeHtml(startTime.split(" ")[0] || "会话")} ${escapeHtml(timeStr)}</span>
            <span class="settings-log-group-count">${count} 条</span>
            <svg class="settings-log-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="settings-log-group-body">
            ${entriesHtml}
          </div>
        </div>
      `;
    }).join("") : '<div class="materials-empty">暂无模型日志</div>';

    // 过滤按钮
    const filterBtns = [
      { key: "all", label: "所有日志" },
      { key: "model", label: "模型日志" },
      { key: "error", label: "错误日志" },
    ].map((f) => `<button class="settings-filter-btn ${state.settingsLogCategory === f.key ? "is-active" : ""}" data-filter="${f.key}" type="button">${f.label}</button>`).join("");

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-sub">按时间分组展示最近的模型执行记录，点击展开查看详情。</div>
          <div class="settings-search-bar">
            <input class="settings-search-input" id="settingsLogSearchInput" type="text" placeholder="搜索日志标题或内容..." value="${escapeHtml(state.settingsLogSearch || "")}" />
            <button class="nxl-icon-btn" id="settingsLogRefreshBtn" type="button" title="刷新日志">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
          </div>
          <div class="settings-filter-group">
            ${filterBtns}
          </div>
        </article>
        <div id="settingsLogGroupsContainer">
          ${groupsHtml}
        </div>
      </section>
    `;

    // 绑定搜索
    const searchInput = document.getElementById("settingsLogSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.settingsLogSearch = searchInput.value;
        filterLogEntries();
      });
    }

    // 绑定过滤按钮
    el.settingsDetailPane.querySelectorAll(".settings-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settingsLogCategory = String(btn.getAttribute("data-filter") || "all");
        loadSettingsLogs().then(() => renderSettingsLogs());
      });
    });

    // 绑定刷新按钮
    const refreshBtn = document.getElementById("settingsLogRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadSettingsLogs().then(() => renderSettingsLogs());
      });
    }
  }

  function filterLogEntries() {
    const search = String(state.settingsLogSearch || "").trim().toLowerCase();
    const container = document.getElementById("settingsLogGroupsContainer");
    if (!container) return;

    container.querySelectorAll(".log-entry").forEach((entry) => {
      if (!search) {
        entry.style.display = "";
        return;
      }
      const title = String(entry.querySelector(".log-entry-title")?.textContent || "").toLowerCase();
      const body = String(entry.querySelector(".log-entry-body pre")?.textContent || "").toLowerCase();
      const matches = title.includes(search) || body.includes(search);
      entry.style.display = matches ? "" : "none";
    });

    // 隐藏空分组
    container.querySelectorAll(".settings-log-group").forEach((group) => {
      const visibleEntries = group.querySelectorAll(".log-entry:not([style*='display: none'])");
      group.style.display = visibleEntries.length ? "" : "none";
    });
  }

  function renderSettingsLectureOptions(selectedLectureId) {
    const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const selectedId = String(selectedLectureId || "").trim();
    return rows.map((row) => {
      const lecture = row.lecture || {};
      const lectureId = String(lecture.id || "").trim();
      const title = String(lecture.title || "未命名课程").trim();
      return `<option value="${escapeHtml(lectureId)}" ${lectureId === selectedId ? "selected" : ""}>${escapeHtml(title)}</option>`;
    }).join("");
  }

  function resolveSettingsBookUploadLectureId(selectedLectureId) {
    const uploadState = state.settingsBookUpload;
    const candidates = [
      uploadState.lectureId,
      selectedLectureId,
      state.settingsCourseEditId,
      state.selectedLectureId,
    ];

    for (const value of candidates) {
      const lectureId = String(value || "").trim();

      if (lectureId) {
        return lectureId;
      }
    }

    return "";
  }

  function ensureSettingsBookUploadLectureId(selectedLectureId) {
    const lectureId = resolveSettingsBookUploadLectureId(selectedLectureId);
    state.settingsBookUpload.lectureId = lectureId;
    return lectureId;
  }

  function getSettingsBookUploadTipText(file) {
    if (!file) {
      return "支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST";
    }

    return `已选择：${String(file.name || "").trim()}`;
  }

  function syncSettingsBookUploadTip(file) {
    const tip = document.getElementById("settingsUploadTip");

    if (tip) {
      tip.textContent = getSettingsBookUploadTipText(file);
    }
  }

  // 设置页上传表单会被轮询刷新触发渲染，文件对象必须由页面状态持有。
  function syncSettingsBookUploadControls() {
    const uploadState = state.settingsBookUpload;
    const lectureSelect = document.getElementById("settingsUploadLectureSelect");
    const titleInput = document.getElementById("settingsUploadBookTitleInput");
    const lectureId = ensureSettingsBookUploadLectureId();

    if (lectureSelect instanceof HTMLSelectElement && lectureId && lectureSelect.value !== lectureId) {
      lectureSelect.value = lectureId;
    }

    if (titleInput instanceof HTMLInputElement && titleInput.value !== uploadState.title) {
      titleInput.value = uploadState.title;
    }

    syncSettingsBookUploadTip(uploadState.file);
  }

  function syncSettingsBookUploadStateFromControls() {
    const uploadState = state.settingsBookUpload;
    const lectureSelect = document.getElementById("settingsUploadLectureSelect");
    const titleInput = document.getElementById("settingsUploadBookTitleInput");
    const fileInput = document.getElementById("settingsUploadFileInput");

    if (lectureSelect instanceof HTMLSelectElement) {
      uploadState.lectureId = String(lectureSelect.value || "").trim();
    }

    if (titleInput instanceof HTMLInputElement) {
      uploadState.title = String(titleInput.value || "");
    }

    if (fileInput instanceof HTMLInputElement && fileInput.files && fileInput.files.length) {
      uploadState.file = fileInput.files[0];
    }

    syncSettingsBookUploadTip(uploadState.file);
  }

  function rememberSettingsBookUploadFile(file) {
    if (!file) {
      syncSettingsBookUploadTip(state.settingsBookUpload.file);
      return;
    }

    const uploadState = state.settingsBookUpload;
    uploadState.file = file;

    if (!String(uploadState.title || "").trim()) {
      uploadState.title = deriveBookTitleFromFile(file);
    }

    syncSettingsBookUploadControls();
  }

  function rememberSettingsBookUploadInputFile(fileInput) {
    if (!(fileInput instanceof HTMLInputElement)) {
      return;
    }

    const file = fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
    rememberSettingsBookUploadFile(file);
  }

  function clearSettingsBookUploadState(lectureId) {
    const uploadState = state.settingsBookUpload;
    uploadState.lectureId = String(lectureId || uploadState.lectureId || "").trim();
    uploadState.title = "";
    uploadState.file = null;

    const fileInput = document.getElementById("settingsUploadFileInput");

    if (fileInput instanceof HTMLInputElement) {
      fileInput.value = "";
    }

    syncSettingsBookUploadControls();
  }

  function renderSettingsBookUploadEntry() {
    return `
      <div class="settings-refinement-upload-entry">
        <button class="channel-list-btn" type="button" data-action="show-settings-book-upload" aria-label="上传教材" title="上传教材">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
      </div>
    `;
  }

  function renderSettingsBookUploadPanel(selectedLectureId) {
    const defaultLectureId = ensureSettingsBookUploadLectureId(selectedLectureId);
    const uploadTitle = String(state.settingsBookUpload.title || "");
    const uploadTip = getSettingsBookUploadTipText(state.settingsBookUpload.file);
    const hasCourses = Array.isArray(state.allLectureRows) && state.allLectureRows.length > 0;
    return `
      <section class="settings-course-workbench settings-book-upload-workbench">
        <section class="settings-inline-card settings-book-upload-panel">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">上传教材</div>
              <div class="settings-inline-sub">先挂到课程，再进入教材解析、精读和视频流程。</div>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="show-settings-refinement-detail" aria-label="返回列表" title="返回列表">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
          <div class="settings-book-upload-summary">
            <div class="settings-book-upload-summary-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
            </div>
            <div class="settings-book-upload-summary-copy">
              <div class="settings-book-upload-summary-title">教材会自动接入课程链路</div>
              <div class="settings-book-upload-summary-text">上传完成后会回到教材管理，并进入教材解析、精读与视频处理流程。</div>
            </div>
          </div>
          <div class="settings-inline-form settings-book-upload-form">
            <label class="settings-field">
              <span>课程</span>
              <select id="settingsUploadLectureSelect" class="input-lite" ${hasCourses ? "" : "disabled"}>
                <option value="">选择课程</option>
                ${renderSettingsLectureOptions(defaultLectureId)}
              </select>
            </label>
            <label class="settings-field">
              <span>教材名</span>
              <input id="settingsUploadBookTitleInput" class="input-lite" placeholder="例如：课程讲义第 1 章" value="${escapeHtml(uploadTitle)}">
            </label>
            <div class="settings-book-upload-file-row settings-field-wide">
              <label class="settings-field">
                <span>文件</span>
                <input id="settingsUploadFileInput" class="input-lite input-file" type="file" accept=".epub,.pdf,.txt,.md,.docx,.doc,.c,.h,.py,.rst">
              </label>
              <button class="settings-course-action-btn settings-book-upload-submit" type="button" data-action="upload-settings-book" ${hasCourses ? "" : "disabled"} aria-label="确认上传" title="确认上传">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
              </button>
            </div>
          </div>
          <div id="settingsUploadTip" class="settings-inline-sub settings-book-upload-tip">${escapeHtml(uploadTip)}</div>
        </section>
      </section>
    `;
  }

  const SETTINGS_REFINEMENT_ICONS = {
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    cover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  function getSettingsRefinementBookKey(lectureId, bookId) {
    return `${String(lectureId || "").trim()}::${String(bookId || "").trim()}`;
  }

  function getSettingsRefinementBookRecord(item) {
    const lectureId = String((item && item.lecture_id) || "").trim();
    const bookId = String((item && item.book_id) || "").trim();

    if (!lectureId || !bookId) return null;
    return getBookRowById(lectureId, bookId);
  }

  function getSettingsRefinementBookTitle(item) {
    const book = getSettingsRefinementBookRecord(item);
    const bookId = String((item && item.book_id) || "").trim();
    return String((book && book.title) || (item && item.book_title) || bookId || "未命名教材").trim();
  }

  function getSettingsRefinementBookDescription(item) {
    const book = getSettingsRefinementBookRecord(item);
    return String((book && book.description) || (item && item.book_description) || "").trim();
  }

  function getSettingsRefinementBookCoverPath(item) {
    const book = getSettingsRefinementBookRecord(item);
    return String((book && (book.cover_path || book.cover)) || (item && (item.cover_path || item.cover)) || "").trim();
  }

  function renderSettingsRefinementCoverPreview(coverPath, title) {
    const resolvedPath = String(coverPath || "").trim();
    const resolvedTitle = String(title || "教材封面").trim();

    if (resolvedPath) {
      return `<img src="${escapeHtml(resolveApiUrl(resolvedPath))}" alt="${escapeHtml(resolvedTitle)}" loading="lazy">`;
    }

    return `
      <div class="settings-refinement-cover-empty">
        ${SETTINGS_REFINEMENT_ICONS.cover}
        <span>暂无封面</span>
      </div>
    `;
  }

  function renderSettingsRefinementBookPanel(item) {
    const lectureId = String((item && item.lecture_id) || "").trim();
    const bookId = String((item && item.book_id) || "").trim();
    const book = getSettingsRefinementBookRecord(item);
    const title = getSettingsRefinementBookTitle(item);
    const description = getSettingsRefinementBookDescription(item);
    const coverPath = getSettingsRefinementBookCoverPath(item);
    const lectureTitle = String((item && item.lecture_title) || "").trim();
    const sourceType = String((book && book.source_type) || (item && item.source_type) || "").trim();
    const statusText = String((book && (book.text_status || book.status)) || (item && item.status) || "未解析").trim();

    return `
      <section class="settings-refinement-book-panel" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}">
        <div class="settings-inline-head settings-refinement-book-head">
          <div>
            <div class="settings-inline-title">教材资料</div>
            <div class="settings-inline-sub">${escapeHtml(lectureTitle || "未绑定课程")} · ${escapeHtml(sourceType || "教材")} · ${escapeHtml(statusText)}</div>
          </div>
          <button class="settings-course-action-btn" type="button" data-action="save-refinement-book-info" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" aria-label="保存教材资料" title="保存教材资料">
            ${SETTINGS_REFINEMENT_ICONS.save}
          </button>
        </div>
        <div class="settings-refinement-book-body">
          <div class="settings-refinement-book-cover-area">
            <div class="settings-refinement-book-cover-preview" id="settingsRefinementBookCoverPreview">
              ${renderSettingsRefinementCoverPreview(coverPath, title)}
            </div>
            <input type="hidden" id="settingsRefinementBookCoverInput" value="${escapeHtml(coverPath)}">
            <div class="settings-refinement-cover-actions">
              <button class="settings-course-action-btn settings-refinement-cover-btn" type="button" data-action="open-refinement-book-cover-picker" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" aria-label="选择教材封面" title="选择教材封面">
                ${SETTINGS_REFINEMENT_ICONS.cover}
              </button>
              <button class="settings-course-action-btn settings-refinement-cover-btn" type="button" data-action="clear-refinement-book-cover" aria-label="清除教材封面" title="清除教材封面" ${coverPath ? "" : "disabled"}>
                ${SETTINGS_REFINEMENT_ICONS.trash}
              </button>
            </div>
          </div>
          <label class="settings-field">
            <span>教材名称</span>
            <input id="settingsRefinementBookTitleInput" class="input-lite" value="${escapeHtml(title)}" placeholder="教材名称">
          </label>
          <label class="settings-field">
            <span>教材简介</span>
            <textarea id="settingsRefinementBookDescInput" class="input-lite input-textarea" rows="5" placeholder="教材简介">${escapeHtml(description)}</textarea>
          </label>
          <div class="settings-refinement-book-id">ID：${escapeHtml(bookId || "未生成")}</div>
        </div>
      </section>
    `;
  }

  function renderSettingsRefinementCoverPicker() {
    return `
      <div id="refinementCoverPickerModal" class="settings-cover-picker-modal settings-refinement-cover-picker-modal" hidden>
        <div class="settings-refinement-cover-picker-backdrop" data-action="close-refinement-book-cover-picker"></div>
        <div class="settings-cover-picker-dialog">
          <div class="settings-cover-picker-header">
            <span class="settings-cover-picker-title">选择教材封面</span>
            <button class="settings-cover-picker-close" type="button" data-action="close-refinement-book-cover-picker" aria-label="关闭" title="关闭">
              ${SETTINGS_REFINEMENT_ICONS.close}
            </button>
          </div>
          <div class="settings-cover-picker-body" id="refinementCoverPickerBody">
            <div class="materials-empty">加载中...</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 教材管理工作区：资料编辑区和模型活动区分开，轮询只刷新模型活动区。
   */
  function renderSettingsRefinementWorkbench(item) {
    return `
      <section class="settings-refinement-workbench">
        ${renderSettingsRefinementBookPanel(item)}
        <section class="settings-refinement-flow-panel">
          <div class="settings-refinement-flow-body" id="agentFlowchartFlow"></div>
        </section>
      </section>
      ${renderSettingsRefinementCoverPicker()}
    `;
  }

  function closeRefinementBookCoverPicker() {
    const modal = document.getElementById("refinementCoverPickerModal");
    if (modal) modal.hidden = true;
  }

  function setRefinementBookCoverSelection(coverPath) {
    const resolvedPath = String(coverPath || "").trim();
    const coverInput = document.getElementById("settingsRefinementBookCoverInput");
    const coverPreview = document.getElementById("settingsRefinementBookCoverPreview");
    const titleInput = document.getElementById("settingsRefinementBookTitleInput");
    const clearBtn = document.querySelector("[data-action='clear-refinement-book-cover']");
    const title = titleInput instanceof HTMLInputElement ? String(titleInput.value || "").trim() : "教材封面";

    if (coverInput instanceof HTMLInputElement) {
      coverInput.value = resolvedPath;
    }

    if (coverPreview) {
      coverPreview.innerHTML = renderSettingsRefinementCoverPreview(resolvedPath, title);
    }

    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.disabled = !resolvedPath;
    }
  }

  async function openRefinementBookCoverPicker(lectureId, bookId) {
    const resolvedLectureId = String(lectureId || "").trim();
    const resolvedBookId = String(bookId || "").trim();

    if (!resolvedLectureId || !resolvedBookId) return;

    const modal = document.getElementById("refinementCoverPickerModal");
    const body = document.getElementById("refinementCoverPickerBody");

    if (modal) {
      modal.hidden = false;
    }

    if (!body) return;

    body.innerHTML = '<div class="materials-empty">加载中...</div>';

    try {
      const res = await fetchJson(`/api/lectures/${encodeURIComponent(resolvedLectureId)}/books/${encodeURIComponent(resolvedBookId)}/cover-assets`);
      const items = Array.isArray(res.items) ? res.items : [];

      if (!items.length) {
        body.innerHTML = '<div class="materials-empty">暂无可用图片，请先完成教材解析</div>';
        return;
      }

      const currentCover = String((document.getElementById("settingsRefinementBookCoverInput") || {}).value || "").trim();
      const html = `
        <div class="settings-cover-picker-grid">
          ${items.map((item) => {
            const coverPath = String(item.cover_path || "").trim();
            const imageUrl = String(item.image_url || coverPath).trim();
            const isSelected = coverPath === currentCover;
            return `
              <button class="settings-cover-picker-item${isSelected ? " is-selected" : ""}" type="button" data-action="select-refinement-book-cover" data-cover-path="${escapeHtml(coverPath)}" aria-label="${escapeHtml(String(item.name || item.alt || "选择封面"))}">
                <img src="${escapeHtml(resolveApiUrl(imageUrl))}" alt="" loading="lazy">
              </button>
            `;
          }).join("")}
        </div>
      `;
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<div class="materials-empty">加载失败：${escapeHtml(err.message || "未知错误")}</div>`;
    }
  }

  async function saveRefinementBookInfo(lectureId, bookId) {
    const resolvedLectureId = String(lectureId || "").trim();
    const resolvedBookId = String(bookId || "").trim();
    const titleInput = document.getElementById("settingsRefinementBookTitleInput");
    const descInput = document.getElementById("settingsRefinementBookDescInput");
    const coverInput = document.getElementById("settingsRefinementBookCoverInput");

    if (!resolvedLectureId || !resolvedBookId) return false;

    const title = titleInput instanceof HTMLInputElement ? String(titleInput.value || "").trim() : "";
    const description = descInput instanceof HTMLTextAreaElement ? String(descInput.value || "").trim() : "";
    const coverPath = coverInput instanceof HTMLInputElement ? String(coverInput.value || "").trim() : "";

    if (!title) {
      showToast("教材名称不能为空");

      if (titleInput instanceof HTMLInputElement) {
        titleInput.focus();
      }

      return false;
    }

    await fetchJson(`/api/lectures/${encodeURIComponent(resolvedLectureId)}/books/${encodeURIComponent(resolvedBookId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        cover_path: coverPath,
      }),
    });

    state.selectedAgentBookKey = getSettingsRefinementBookKey(resolvedLectureId, resolvedBookId);
    await loadMaterialsRows();
    await loadRefinementSettings();

    const main = document.getElementById("agentFlowchart");
    if (main) {
      main.removeAttribute("data-selected-book-key");
    }

    renderSettingsRefinement();
    return true;
  }

  function renderSettingsRefinement() {
    const queueSize = toNumber(state.refinementQueue.queue_size, 0);
    const runningCount = toNumber(state.refinementQueue.running_count, 0);
    const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];

    if (!state.refinementViewBootstrapped) {
      el.settingsDetailPane.innerHTML = `
        <div class="agent-panel-layout">
          <div class="agent-panel-sidebar">
            <div class="channel-list-header">
              <span class="channel-list-title">教材列表</span>
              <div id="settingsBookUploadHost"></div>
            </div>
            <div id="agentBookList"></div>
          </div>
          <div class="agent-panel-main" id="agentFlowchart"></div>
        </div>
      `;
      if (!state.selectedAgentBookKey && rows.length) {
        const first = rows[0];
        state.selectedAgentBookKey = getSettingsRefinementBookKey(first.lecture_id, first.book_id);
      }
      state.refinementViewBootstrapped = true;
    }

    const sidebar = document.getElementById("agentBookList");
    const main = document.getElementById("agentFlowchart");
    const uploadHost = document.getElementById("settingsBookUploadHost");
    if (!sidebar || !main) return;
    if (uploadHost) {
      uploadHost.innerHTML = renderSettingsBookUploadEntry();
    }

    const listHtml = rows.map((item) => {
      const key = getSettingsRefinementBookKey(item.lecture_id, item.book_id);
      const title = getSettingsRefinementBookTitle(item);
      const lecture = String(item.lecture_title || "");
      const flow = buildRefineFlow(item);
      const isSelected = key === state.selectedAgentBookKey && state.settingsRefinementView !== "upload";
      const lectureId = String(item.lecture_id || "");
      const bookId = String(item.book_id || "");
      const rowData = (state.allLectureRows || []).find((row) => String((row.lecture || {}).id || "") === lectureId);
      const book = rowData && Array.isArray(rowData.books)
        ? rowData.books.find((entry) => String(entry.id || "") === bookId)
        : null;
      const coverPath = String((book && (book.cover_path || book.cover)) || "").trim();
      return `
        <div class="agent-book-item${isSelected ? " is-selected" : ""}" data-book-key="${escapeHtml(key)}">
          ${coverPath
            ? `<div class="settings-course-list-cover"><img src="${escapeHtml(resolveApiUrl(coverPath))}" alt=""></div>`
            : '<div class="settings-course-list-cover settings-course-list-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/></svg></div>'}
          <div class="agent-book-info">
            <div class="agent-book-title">${escapeHtml(title)}</div>
            <div class="agent-book-meta">${escapeHtml(lecture)} · ${flow.doneCount}/${flow.steps.length}</div>
          </div>
          ${isSelected ? `<button class="agent-book-reset" data-action="stop-refinement" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" type="button" title="重置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>` : ""}
        </div>`;
    }).join("");

    sidebar.innerHTML = rows.length ? listHtml : '<div class="materials-empty">暂无教材</div>';

    // 绑定教材选择
    sidebar.querySelectorAll(".agent-book-item").forEach((el) => {
      el.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-action='stop-refinement']")) return;

        state.selectedAgentBookKey = String(el.getAttribute("data-book-key") || "");
        state.settingsRefinementView = "detail";
        renderSettingsRefinement();
      });
    });

    if (state.settingsRefinementView === "upload") {
      main.removeAttribute("data-selected-book-key");

      if (!main.querySelector(".settings-book-upload-panel")) {
        main.innerHTML = renderSettingsBookUploadPanel(state.selectedLectureId);
      }

      syncSettingsBookUploadControls();
      return;
    }

    if (!rows.length) {
      main.removeAttribute("data-selected-book-key");
      main.innerHTML = '<div class="materials-empty">暂无教材，点击左上角加号即可上传教材</div>';
      return;
    }

    // 右侧拆为教材资料区与模型活动区，轮询时只更新模型活动区，避免覆盖正在编辑的表单。
    const selected = rows.find((r) => getSettingsRefinementBookKey(r.lecture_id, r.book_id) === state.selectedAgentBookKey) || rows[0];
    if (!selected) {
      main.removeAttribute("data-selected-book-key");
      main.innerHTML = '<div class="materials-empty">请选择教材</div>';
      return;
    }

    const selectedKey = getSettingsRefinementBookKey(selected.lecture_id, selected.book_id);
    state.selectedAgentBookKey = selectedKey;

    const shouldRenderWorkbench = main.getAttribute("data-selected-book-key") !== selectedKey
      || !main.querySelector(".settings-refinement-workbench")
      || !main.querySelector("#agentFlowchartFlow");

    if (shouldRenderWorkbench) {
      main.setAttribute("data-selected-book-key", selectedKey);
      main.innerHTML = renderSettingsRefinementWorkbench(selected);
    }

    const flowHost = main.querySelector("#agentFlowchartFlow");
    if (flowHost) {
      renderAgentFlowchart(flowHost, selected);
    }
  }

  function renderAgentFlowchart(container, item) {
    const flow = buildRefineFlow(item);
    const lectureId = String(item.lecture_id || "");
    const bookId = String(item.book_id || "");
    const bookTitle = getSettingsRefinementBookTitle(item);
    const progressSteps = Array.isArray(item.progress_steps) ? item.progress_steps : [];

    const SVG_ICONS = {
      play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
      tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    };

    const AGENT_SVG = {
      coarse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      section: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v18M18 3v18M3 6h18M3 12h18M3 18h18"/></svg>',
      intensive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
      question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 5.12 2.13c0 2-3 2-3 4.87M12 17h.01"/></svg>',
      annotation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
      outline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
      video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    };

    // 增量更新：已有结构则只更新状态和日志，否则全量渲染
    const existingNodes = container.querySelectorAll(".flow-node[data-agent-key]");
    if (existingNodes.length === flow.steps.length) {
      _updateFlowchartIncremental(container, item, flow, progressSteps, SVG_ICONS, AGENT_SVG, lectureId, bookId);
      return;
    }

    // 全量渲染
    container.setAttribute("data-flow-book-key", getSettingsRefinementBookKey(lectureId, bookId));
    let html = `<div class="flow-title">${escapeHtml(bookTitle)}</div>`;
    html += '<div class="flow-nodes">';
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const isLast = i === flow.steps.length - 1;
      const status = step.running ? "running" : step.error ? "error" : step.done ? "done" : step.pending ? "pending" : "idle";
      const icon = AGENT_SVG[step.key] || AGENT_SVG.coarse;
      const { action, enabled } = _getAgentAction(item, step.key);
      const btnHtml = (enabled && !step.pending)
        ? `<button class="flow-node-btn" data-action="${action}" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" type="button" title="执行">${SVG_ICONS.play}</button>`
        : "";
      html += `<div class="flow-node is-${status}" data-agent-key="${step.key}">
          <div class="flow-node-icon">${icon}</div>
          <div class="flow-node-label">${escapeHtml(step.label)}</div>
          ${btnHtml}${!isLast ? '<div class="flow-connector"></div>' : ""}
        </div>`;
    }
    html += '</div>';
    html += '<div class="flow-log"><div class="flow-log-title">模型活动</div><div class="flow-log-body" id="flowLogBody"></div></div>';
    container.innerHTML = html;
    _appendLogLines(container, item, flow, progressSteps, SVG_ICONS);
  }

  function _getAgentAction(item, key) {
    if (key === "coarse") return { action: "start-refinement", enabled: canStartRefinement(item) };
    if (key === "video") return { action: "start-video", enabled: canStartVideo(item) };
    if (key === "intensive") return { action: "start-intensive", enabled: canStartIntensive(item) };
    if (key === "section") return { action: "start-section", enabled: canStartSection(item) };
    if (key === "question") return { action: "start-question", enabled: canStartQuestion(item) };
    if (key === "annotation") return { action: "start-annotation", enabled: canStartAnnotation(item) };
    if (key === "summary") return { action: "start-summary", enabled: canStartSummary(item) };
    return { action: "", enabled: false };
  }

  function _updateFlowchartIncremental(container, item, flow, progressSteps, SVG_ICONS, AGENT_SVG, lectureId, bookId) {
    container.setAttribute("data-flow-book-key", getSettingsRefinementBookKey(lectureId, bookId));

    const titleNode = container.querySelector(".flow-title");
    if (titleNode) {
      titleNode.textContent = getSettingsRefinementBookTitle(item);
    }

    // 只更新节点状态 class 和按钮
    for (const step of flow.steps) {
      const node = container.querySelector(`.flow-node[data-agent-key="${step.key}"]`);
      if (!node) continue;
      const status = step.running ? "running" : step.error ? "error" : step.done ? "done" : step.pending ? "pending" : "idle";
      node.className = `flow-node is-${status}`;
      // 更新按钮
      const { action, enabled } = _getAgentAction(item, step.key);
      let btn = node.querySelector(".flow-node-btn");
      if (enabled && !step.pending) {
        if (!btn) {
          btn = document.createElement("button");
          btn.className = "flow-node-btn";
          btn.type = "button";
          btn.title = "执行";
          btn.innerHTML = SVG_ICONS.play;
          node.appendChild(btn);
        }
        btn.setAttribute("data-action", action);
        btn.setAttribute("data-lecture-id", lectureId);
        btn.setAttribute("data-book-id", bookId);
      } else if (btn) {
        btn.remove();
      }
    }
    // 更新活动日志
    _appendLogLines(container, item, flow, progressSteps, SVG_ICONS);
  }

  function _appendLogLines(container, item, flow, progressSteps, SVG_ICONS) {
    const logBody = container.querySelector(".flow-log-body");
    if (!logBody) return;
    const logLines = [];
    for (const step of flow.steps) {
      const err = String(item[`${step.key}_error`] || "").trim();
      if (err) logLines.push({ type: "error", text: `${step.label}：${err}` });
    }
    for (const s of progressSteps.slice(-15).reverse()) {
      const stype = String(s && s.type || "").trim();
      const title = String(s && s.title || "");
      const preview = String(s && s.preview || "");
      if (stype === "model_text") logLines.push({ type: "model", text: preview });
      else if (stype) logLines.push({ type: "tool", text: title, detail: preview });
    }
    logBody.innerHTML = logLines.map((line) => {
      if (line.type === "error") return `<div class="flow-log-line is-error">${SVG_ICONS.warn}<span>${escapeHtml(line.text)}</span></div>`;
      if (line.type === "model") return `<div class="flow-log-line is-model"><pre>${escapeHtml(line.text)}</pre></div>`;
      if (line.type === "tool") return `<div class="flow-log-line is-tool">${SVG_ICONS.tool}<span>${escapeHtml(line.text)}</span>${line.detail ? `<span class="flow-log-detail">${escapeHtml(line.detail.slice(0, 50))}</span>` : ""}</div>`;
      return "";
    }).join("");
  }

  function renderSettingsModel() {
    const settings = state.modelSettings || {};
    const rough = settings.rough_reading || {};
    const intensive = settings.intensive_reading || {};
    const splitChapters = settings.split_chapters || {};
    const memory = settings.memory || {};
    const profileQuestion = settings.profile_question || {};
    const options = Array.isArray(state.modelOptions) ? state.modelOptions : [];
    const disabledAttr = state.isAdmin ? "" : "disabled";

    // 模型配置项定义
    const modelFields = [
      { id: "settingsDefaultModelSelect", label: "默认模型", value: settings.default_nexora_model || "" },
      { id: "settingsRoughModelSelect", label: "粗读模型", value: rough.model_name || "" },
      { id: "settingsIntensiveModelSelect", label: "精读模型", value: intensive.model_name || "" },
      { id: "settingsSplitChaptersModelSelect", label: "分节模型", value: splitChapters.model_name || "" },
      { id: "settingsMemoryModelSelect", label: "记忆模型", value: memory.model_name || "" },
      { id: "settingsProfileQuestionModelSelect", label: "画像出题模型", value: profileQuestion.model_name || "" },
    ];

    const formHtml = modelFields.map((field) => `
      <div class="materials-form-row settings-model-row">
        <label class="materials-form-label settings-model-label" for="${field.id}">${escapeHtml(field.label)}</label>
        <div class="nxl-custom-select" data-select-id="${field.id}" data-value="${escapeHtml(String(field.value))}">
          <button class="nxl-custom-select-trigger" type="button" ${disabledAttr}>
            <span class="nxl-custom-select-value">${escapeHtml(String(field.value) || "(空)")}</span>
            <svg class="nxl-custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="nxl-custom-select-dropdown">
            <div class="nxl-custom-select-option ${!field.value ? "is-selected" : ""}" data-value="">(空)</div>
            ${options.map((row) => `<div class="nxl-custom-select-option ${String(row.id) === String(field.value) ? "is-selected" : ""}" data-value="${escapeHtml(row.id)}">${escapeHtml(row.label || row.id)}</div>`).join("")}
          </div>
        </div>
      </div>
    `).join("");

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-sub">默认模型为空时，后端不会强制绑定默认模型。</div>
          <div class="settings-inline-form settings-model-form">
            ${formHtml}
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsMemoryIntervalInput">画像分析轮数</label>
              <input id="settingsMemoryIntervalInput" class="input-lite settings-model-select" type="number" min="1" step="1" value="${escapeHtml(String(memory.trigger_turn_interval || 10))}" ${disabledAttr} />
            </div>
          </div>
          <div class="settings-actions">
            <button id="saveModelSettingsBtn" class="nxl-icon-btn nxl-icon-btn-dark" type="button" ${disabledAttr} title="保存模型设置">✓</button>
            <span class="settings-sub">${state.isAdmin ? "管理员可保存设置" : "仅管理员可修改模型设置"}</span>
          </div>
        </article>
      </section>
    `;

    // 初始化自定义下拉栏
    document.querySelectorAll(".nxl-custom-select").forEach((selectEl) => {
      const trigger = selectEl.querySelector(".nxl-custom-select-trigger");
      const dropdown = selectEl.querySelector(".nxl-custom-select-dropdown");
      const valueEl = selectEl.querySelector(".nxl-custom-select-value");

      if (trigger) {
        trigger.addEventListener("click", (e) => {
          e.stopPropagation();
          // 关闭其他下拉栏
          document.querySelectorAll(".nxl-custom-select.is-open").forEach((el) => {
            if (el !== selectEl) el.classList.remove("is-open");
          });
          selectEl.classList.toggle("is-open");
        });
      }

      if (dropdown) {
        dropdown.querySelectorAll(".nxl-custom-select-option").forEach((opt) => {
          opt.addEventListener("click", () => {
            const value = String(opt.getAttribute("data-value") || "");
            selectEl.setAttribute("data-value", value);
            if (valueEl) valueEl.textContent = value || "(空)";
            dropdown.querySelectorAll(".nxl-custom-select-option").forEach((o) => o.classList.remove("is-selected"));
            opt.classList.add("is-selected");
            selectEl.classList.remove("is-open");
          });
        });
      }
    });

    // 点击外部关闭下拉栏
    document.addEventListener("click", () => {
      document.querySelectorAll(".nxl-custom-select.is-open").forEach((el) => {
        el.classList.remove("is-open");
      });
    });
  }

  function renderSettingsDetail() {
    if (state.settingsTab === "refinement") {
      renderSettingsRefinement();
      return;
    }
    if (state.settingsTab === "model") {
      state.refinementViewBootstrapped = false;
      renderSettingsModel();
      return;
    }
    if (state.settingsTab === "channels") {
      state.refinementViewBootstrapped = false;
      renderSettingsChannels();
      return;
    }
    if (state.settingsTab === "users") {
      state.refinementViewBootstrapped = false;
      renderSettingsUsers();
      return;
    }
    if (state.settingsTab === "courses") {
      state.refinementViewBootstrapped = false;
      renderSettingsCourses();
      return;
    }
    if (state.settingsTab === "logs") {
      state.refinementViewBootstrapped = false;
      renderSettingsLogs();
      return;
    }
    if (state.settingsTab === "profile") {
      state.refinementViewBootstrapped = false;
      renderSettingsProfile();
      return;
    }
    renderSettingsRefinement();
  }

  function renderSettingsView() {
    renderSettingsNav();
    renderSettingsDetail();
  }

// ─────── Settings: Polling & Data Refresh ─────────────────────────────
  function stopSettingsPolling() {
    if (state.settingsPollTimer) {
      clearInterval(state.settingsPollTimer);
      state.settingsPollTimer = null;
    }
  }

  function startSettingsPolling() {
    if (state.settingsPollTimer) return;
    state.settingsPollTimer = setInterval(() => {
      if (!el.settingsView.classList.contains("is-active")) return;
      if (state.settingsTab !== "refinement") return;
      loadRefinementSettings().catch(() => {});
    }, 3000);
  }

// ─────── Materials & Lecture Rendering ────────────────────────────────
  function getSelectedLectureRow() {
    return state.allLectureRows.find((row) => String((row.lecture || {}).id || "") === state.selectedLectureId) || null;
  }

  function syncMaterialsPageMode() {
    const shelfMode = state.materialsPageMode === "shelf";
    const catalogMode = state.materialsDetailMode === "catalog";
    if (el.materialsHeadKicker) {
      el.materialsHeadKicker.textContent = shelfMode ? "COURSES" : (catalogMode ? "CATALOG" : "COURSE");
    }
    if (el.materialsMainHeader) {
      el.materialsMainHeader.hidden = state.isReaderOpen || !shelfMode;
    }
    if (el.backToDashboardBtn) {
      const backText = shelfMode ? "返回首页" : (catalogMode ? "返回课程主页" : "返回首页");
      el.backToDashboardBtn.setAttribute("title", backText);
      el.backToDashboardBtn.setAttribute("aria-label", backText);
    }
    if (el.materialsLayout) {
      el.materialsLayout.hidden = !shelfMode;
      el.materialsLayout.classList.toggle("is-shelf-mode", shelfMode);
      el.materialsLayout.classList.toggle("is-lecture-mode", false);
      el.materialsLayout.classList.toggle("is-catalog-mode", catalogMode);
    }
    if (el.courseHomePane) {
      el.courseHomePane.hidden = shelfMode;
    }
    const teacherEditMode = state.materialsDetailMode === "teacher-edit";
    if (el.courseHomeHeader) {
      el.courseHomeHeader.hidden = shelfMode;
      const headerTitle = el.courseHomeHeader.querySelector(".reader-title");
      if (headerTitle) headerTitle.textContent = teacherEditMode ? "教材课程管理界面" : "课程主页";
    }
    if (el.backFromCourseHomeBtn) {
      const backText = teacherEditMode
        ? "返回课程主页"
        : (catalogMode ? "返回课程主页" : (state.courseHomeReturnTarget === "dashboard" ? "返回首页" : "返回课程书架"));
      el.backFromCourseHomeBtn.setAttribute("title", backText);
      el.backFromCourseHomeBtn.setAttribute("aria-label", backText);
    }
    if (el.courseHomeSubtitle) {
      const row = getSelectedLectureRow();
      const lecture = row ? (row.lecture || {}) : {};
      el.courseHomeSubtitle.textContent = shelfMode ? "Learning" : getLectureTitle(lecture);
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.hidden = true;
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.hidden = true;
    }
    if (el.lectureList && el.lectureList.parentElement) {
      el.lectureList.parentElement.hidden = true;
    }
  }

  function openMaterialsShelf() {
    state.materialsPageMode = "shelf";
    state.materialsDetailMode = "lecture";
    state.courseHomeReturnTarget = "shelf";
    state.catalogContext = null;
    state.selectedBookId = "";
    closeReader();
    syncMaterialsPageMode();
    renderLectureList();
    renderLectureDetail();
  }

  function openLectureHome(lectureId, options) {
    const opts = options && typeof options === "object" ? options : {};
    const returnTarget = String(opts.returnTarget || "shelf").trim();
    state.selectedLectureId = String(lectureId || "").trim();
    state.selectedBookId = "";
    state.materialsPageMode = "lecture";
    state.materialsDetailMode = "lecture";
    state.courseHomeReturnTarget = returnTarget === "dashboard" ? "dashboard" : "shelf";
    state.catalogContext = null;
    closeReader();
    syncMaterialsPageMode();
    renderLectureList();
    renderLectureDetail();
  }

  function returnFromCourseHome() {
    if (state.materialsDetailMode === "teacher-edit") {
      closeTeacherEditPanel();
      return;
    }

    if (state.materialsDetailMode === "catalog") {
      state.materialsDetailMode = "lecture";
      state.catalogContext = null;
      renderLectureDetail();
      return;
    }

    if (state.courseHomeReturnTarget === "dashboard") {
      state.materialsPageMode = "shelf";
      state.materialsDetailMode = "lecture";
      state.courseHomeReturnTarget = "shelf";
      state.catalogContext = null;
      state.selectedBookId = "";
      closeReader();
      syncMaterialsPageMode();
      setView("dashboard");
      return;
    }

    // 离开课程主页：中断思维导图流式、关闭抽屉
    if (window.NXKG && typeof window.NXKG.reset === "function") {
      window.NXKG.reset();
    }
    openMaterialsShelf();
  }

  function getLearningPathActionOptions(actionNode) {
    const outlineSectionId = String(actionNode.getAttribute("data-outline-section-id") || "").trim();
    const rawChapterIndex = Number(actionNode.getAttribute("data-chapter-index"));
    const options = {};

    if (outlineSectionId) {
      options.outlineSectionId = outlineSectionId;
    }

    if (Number.isInteger(rawChapterIndex) && rawChapterIndex >= 0) {
      options.chapterIndex = rawChapterIndex;
    }

    return options;
  }

  async function handleCourseHomeClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Tab 切换
    const tabBtn = target.closest(".course-home-tab");
    if (tabBtn) {
      const tabName = String(tabBtn.dataset.tab || "").trim();
      if (tabName) {
        const row = getSelectedLectureRow();
        const lid = row ? String((row.lecture || {}).id || "") : "";
        activateCourseHomeTab(tabName, lid);
      }
      return;
    }

    // 思维导图：生成按钮（mindmap tab 内）
    const generateMindmapBtn = target.closest("[data-action='generate-mindmap']");
    if (generateMindmapBtn) {
      const lectureId = String(generateMindmapBtn.getAttribute("data-lecture-id") || "").trim();
      if (!lectureId) return;
      if (!window.NXKG || typeof window.NXKG.generateCourseStream !== "function") {
        showToast("思维导图模块未加载");
        return;
      }
      generateMindmapBtn.disabled = true;
      generateMindmapBtn.textContent = "生成中...";
      window.NXKG.generateCourseStream(lectureId);
      return;
    }

    const lectureCard = target.closest("[data-lecture-home-id]");
    if (lectureCard) {
      openLectureHome(String(lectureCard.getAttribute("data-lecture-home-id") || ""));
      return;
    }

    const actionBtn = target.closest("[data-action='toggle-learning']");
    if (actionBtn) {
      const lectureId = String(actionBtn.getAttribute("data-lecture-id") || "");
      if (!lectureId) return;
      const selected = !state.selectedLearningLectureIds.includes(lectureId);
      if (!selected) {
        const ok = await confirmExitLearningAsync();
        if (!ok) return;
      }
      try {
        await toggleLearningSelection(lectureId, selected);
        await refreshAll();
        renderLectureList();
        renderLectureDetail();
        showToast(selected ? "已加入学习课程" : "已退出学习课程");
      } catch (err) {
        showToast(`操作失败：${err.message || "未知错误"}`);
      }
      return;
    }

    const startLearningPathBtn = target.closest("[data-action='start-learning-path']");
    if (startLearningPathBtn) {
      const lectureId = String(startLearningPathBtn.getAttribute("data-lecture-id") || "").trim();
      if (!lectureId) return;
      openLearningPathView(lectureId, getLearningPathActionOptions(startLearningPathBtn));
      return;
    }

    const editTeacherBtn = target.closest("[data-action='edit-teacher']");
    if (editTeacherBtn) {
      event.stopPropagation();
      openTeacherEditPanel(state.selectedLectureId, { mode: "lecture" });
      return;
    }

    const deleteBtn = target.closest("[data-action='delete-book']");
    if (deleteBtn) {
      event.stopPropagation();
      const lectureId = String(deleteBtn.getAttribute("data-lecture-id") || "");
      const bookId = String(deleteBtn.getAttribute("data-book-id") || "");
      if (!lectureId || !bookId) return;
      const ok = await confirmModalAsync("确认删除该教材？此操作不可撤销。");
      if (!ok) return;
      try {
        await deleteBook(lectureId, bookId);
        if (state.selectedBookId === bookId) state.selectedBookId = "";
        await refreshAll();
        renderLectureList();
        renderLectureDetail();
        showToast("教材已删除");
      } catch (err) {
        showToast(`删除失败：${err.message || "未知错误"}`);
      }
      return;
    }

    const bookItem = target.closest(".book-item");
    if (!bookItem) return;
    const requestToken = state.readerRequestToken + 1;
    state.readerRequestToken = requestToken;
    bookItem.classList.remove("book-item-enter");
    void bookItem.offsetWidth;
    bookItem.classList.add("book-item-enter");
    state.selectedBookId = String(bookItem.getAttribute("data-book-id") || "");
    renderLectureDetail();
    const row = getSelectedLectureRow();
    const lecture = row ? (row.lecture || {}) : {};
    const books = row && Array.isArray(row.books) ? row.books : [];
    const book = books.find((it) => String((it && it.id) || "") === state.selectedBookId) || {};
    state.materialsDetailMode = "catalog";
    state.catalogContext = {
      title: String(book.title || "教材目录"),
      subtitle: getLectureTitle(lecture),
      bookId: String(book.id || ""),
      coverPath: getBookCoverPath(book),
      chapters: [],
      summaryBrief: "",
      summaryDetail: "",
      loading: true,
    };
    renderLectureDetail();
    const [bookInfoXml, bookDetailXml, summaryData] = await Promise.all([
      fetchBookInfoXml(),
      fetchBookDetailXml(),
      fetchBookSummary(),
    ]);
    if (requestToken !== state.readerRequestToken) {
      return;
    }
    const chapters = parseBookInfoChapters(bookInfoXml, Number(book.text_chars) || 0);
    state.catalogContext = {
      title: String(book.title || "教材目录"),
      subtitle: getLectureTitle(lecture),
      bookId: String(book.id || ""),
      coverPath: getBookCoverPath(book),
      chapters,
      detailXml: String(bookDetailXml || ""),
      summaryBrief: String(summaryData.summary_brief || ""),
      summaryDetail: String(summaryData.summary_detail || ""),
      loading: false,
    };
    state.materialsDetailMode = "catalog";
    renderLectureDetail();
  }

  function handleCourseHomeKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionNode = target.closest("[data-action='start-learning-path'][role='button']");
    if (!actionNode || !el.courseHomePane || !el.courseHomePane.contains(actionNode)) {
      return;
    }

    event.preventDefault();
    actionNode.click();
  }

  async function handleCatalogClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const completedBadge = target.closest(".catalog-completed-badge");
    if (completedBadge) {
      const completedItem = completedBadge.closest("[data-material-catalog-index]");
      if (!completedItem || !state.catalogContext) return;
      event.preventDefault();
      event.stopPropagation();
      await confirmClearCatalogChapterProgress(Number(completedItem.getAttribute("data-material-catalog-index") || "0"));
      return;
    }

    // 学习路径生成按钮
    const pathBtn = target.closest("#generateLearningPathBtn");
    if (pathBtn) {
      const lectureId = String(pathBtn.getAttribute("data-lecture-id") || "");
      const bookId = String(pathBtn.getAttribute("data-book-id") || "");
      if (!lectureId || !bookId) return;
      const force = String(pathBtn.getAttribute("data-force") || "") === "1";
      await generateLearningPath(lectureId, bookId, force);
      return;
    }

    const item = target.closest("[data-material-catalog-index]");
    if (!item || !state.catalogContext) return;
    const idx = Number(item.getAttribute("data-material-catalog-index") || "0");
    const requestToken = state.readerRequestToken + 1;
    state.readerRequestToken = requestToken;
    state.readerChapters = Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters.slice() : [];
    state.readerBookDetailXml = String(state.catalogContext.detailXml || "");
    state.readerActiveChapterIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number.isFinite(idx) ? idx : 0));
    // 先打开Reader并显示加载状态
    openReader(
      state.catalogContext.title || "教材阅读",
      state.catalogContext.subtitle || "",
      "",
      { chapterIndex: state.readerActiveChapterIndex, loading: true }
    );
    // 按章节加载内容
    await loadChapterContent(state.readerActiveChapterIndex);
  }

  async function loadVideos(lectureId, bookId) {
    const container = document.getElementById("videoPanelContainer");
    if (!container) return;
    container.innerHTML = '<div class="lp-video-loading">正在加载视频...</div>';
    try {
      const data = await fetchJson(`/api/frontend/videos?lecture_id=${encodeURIComponent(lectureId)}&book_id=${encodeURIComponent(bookId)}`);
      if (!data.success || !Array.isArray(data.items) || !data.items.length) {
        container.innerHTML = '<div class="lp-video-empty">暂无相关视频</div>';
        return;
      }
      const cached = !!data.cached;
      renderVideoList(container, data.items, cached);
    } catch (_err) {
      container.innerHTML = '<div class="lp-video-empty">视频加载失败</div>';
    }
  }

  function isCourseHomeCompactLayout() {
    const bridge = window.NXCourseWorkspaceBridge;

    if (!bridge || typeof bridge.isSidebarAutoCollapseLayout !== "function") {
      return false;
    }

    return !!bridge.isSidebarAutoCollapseLayout();
  }

  function resolveCourseHomeTab(tabName) {
    const normalizedTab = String(tabName || "books").trim() || "books";

    if (!isCourseHomeCompactLayout() && normalizedTab === "videos") {
      return "books";
    }

    return normalizedTab;
  }

  function buildCourseHomeBooksPaneHtml(lectureId, books, options) {
    const opts = options && typeof options === "object" ? options : {};
    const includeVideos = !!opts.includeVideos;
    const booksHtml = books.length
      ? books.map(function (book) {
          var bookId = String(book.id || "");
          var bkActive = bookId === state.selectedBookId ? "is-active" : "";
          var bookTitle = String(book.title || bookId || "教材").trim();
          var bookState = bkActive ? '<div class="learning-panel-book-current">当前教材</div>' : "";
          return '<article class="book-item ' + bkActive + ' learning-panel-book-item" data-book-id="' + escapeHtml(bookId) + '" title="' + escapeHtml(bookTitle) + '">' +
            renderCourseDetailBookCover(book, bookTitle) +
            '<div class="learning-panel-book-head">' +
            '<div class="book-title learning-panel-book-title">' + escapeHtml(bookTitle) + '</div>' +
            bookState +
            '</div>' +
            '</article>';
        }).join("")
      : '<div class="materials-empty">暂无教材</div>';

    var html = '<div class="course-home-tab-pane is-active-pane" data-tab-pane="books">' +
      '<div class="learning-panel-split-grid">' +
      '<div class="learning-panel-books-column">' +
      '<div class="learning-panel-section-body">' +
      '<div class="book-list learning-panel-books-grid">' +
      booksHtml +
      '</div>' +
      '</div>';

    if (includeVideos) {
      html +=
        '<section class="learning-panel-course-video-block">' +
          '<header class="learning-panel-course-video-head">' +
            '<div class="learning-panel-section-title">推荐视频</div>' +
          '</header>' +
          '<div class="learning-panel-section-body">' +
            '<div class="lp-video-container" id="courseVideoPanelContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
              '<div class="lp-video-loading">正在加载已缓存视频...</div>' +
            '</div>' +
          '</div>' +
        '</section>';
    }

    html +=
      '</div>' +
      '</div>' +
      '</div>';

    return html;
  }

  /**
   * 渲染单个课程主页 Tab pane 的 HTML（不依赖 display:none）
   */
  function renderCourseHomePaneHtml(tabName, lectureId, books) {
    const compactLayout = isCourseHomeCompactLayout();
    const effectiveTab = resolveCourseHomeTab(tabName);

    if (effectiveTab === "books") {
      return buildCourseHomeBooksPaneHtml(lectureId, books, { includeVideos: !compactLayout });
    }

    if (effectiveTab === "videos") {
      return '<div class="course-home-tab-pane is-active-pane" data-tab-pane="videos">' +
        '<div class="learning-panel-split-grid">' +
        '<div class="learning-panel-books-column">' +
        '<div class="learning-panel-section-body">' +
        '<div class="lp-video-container" id="courseVideoPanelContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
        '<div class="lp-video-loading">正在加载已缓存视频...</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    if (effectiveTab === "mindmap") {
      return '<div class="course-home-tab-pane is-active-pane" data-tab-pane="mindmap">' +
        '<div class="learning-panel-split-grid">' +
        '<div class="learning-panel-books-column">' +
        '<div class="learning-panel-section-body">' +
        '<div class="outline-container" id="courseMindmapContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
        '<div class="lp-video-loading">正在加载思维导图...</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    if (effectiveTab === "report") {
      return '<div class="course-home-tab-pane is-active-pane" data-tab-pane="report">' +
        '<div class="learning-panel-section-body">' +
        '<div class="learning-report-shell" id="courseLearningReportContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
        renderLearningReportLoading("正在生成学习报告...") +
        '</div>' +
        '</div>' +
        '</div>';
    }

    // outline pane
    return '<div class="course-home-tab-pane is-active-pane" data-tab-pane="outline">' +
      '<div class="learning-panel-split-grid">' +
      '<div class="learning-panel-books-column">' +
      '<div class="learning-panel-section-body">' +
      '<div class="outline-container" id="courseOutlineContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
      '<div class="lp-video-loading">正在加载学习大纲...</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  /**
   * 激活课程主页的指定 Tab（innerHTML 替换 pane，无 display:none 残留）
   */
  function activateCourseHomeTab(tabName, lectureId) {
    const effectiveTabName = resolveCourseHomeTab(tabName);
    const compactLayout = isCourseHomeCompactLayout();
    state.courseHomeTab = effectiveTabName;
    var effectiveLectureId = lectureId || state.selectedLectureId || "";

    document.querySelectorAll(".course-home-tab").forEach(function (btn) {
      const rawTabName = String(btn.dataset.tab || "").trim();
      btn.hidden = !compactLayout && rawTabName === "videos";
      btn.classList.toggle("is-active", resolveCourseHomeTab(rawTabName) === effectiveTabName);
    });

    var tabContent = document.querySelector(".course-home-tab-content");
    if (tabContent) {
      var row = getSelectedLectureRow();
      var books = row && Array.isArray(row.books) ? row.books : [];
      tabContent.innerHTML = renderCourseHomePaneHtml(effectiveTabName, effectiveLectureId, books);
    }

    if (effectiveTabName === "videos" || (effectiveTabName === "books" && !compactLayout)) {
      loadCourseCachedVideos(effectiveLectureId);
    }

    if (effectiveTabName === "outline") {
      loadCourseOutline(effectiveLectureId);
    }

    if (effectiveTabName === "mindmap") {
      loadCourseMindmap(effectiveLectureId);
    }

    if (effectiveTabName === "report") {
      loadCourseLearningReport(effectiveLectureId);
    }
  }

  /**
   * 首字母大写
   */
  function capitalize(str) {
    return String(str || "").charAt(0).toUpperCase() + String(str || "").slice(1);
  }

  async function loadCourseCachedVideos(lectureId) {
    const container = document.getElementById("courseVideoPanelContainer");
    if (!container) return;

    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      container.innerHTML = '<div class="lp-video-empty">暂无已缓存视频</div>';
      return;
    }

    // 缓存命中：直接渲染，不重复请求
    const cacheKey = resolvedLectureId;
    if (state.courseVideoCache[cacheKey]) {
      renderVideoList(container, state.courseVideoCache[cacheKey].items, state.courseVideoCache[cacheKey].cached);
      return;
    }

    container.dataset.lectureId = resolvedLectureId;
    container.innerHTML = '<div class="lp-video-loading">正在加载已缓存视频...</div>';

    try {
      const data = await fetchJson(`/api/frontend/lecture-videos?lecture_id=${encodeURIComponent(resolvedLectureId)}`);
      if (String(container.dataset.lectureId || "") !== resolvedLectureId) return;

      if (!data.success || !Array.isArray(data.items) || !data.items.length) {
        container.innerHTML = '<div class="lp-video-empty">暂无已缓存视频</div>';
        return;
      }

      // 写入缓存
      state.courseVideoCache[cacheKey] = { items: data.items, cached: true };

      renderVideoList(container, data.items, true);
    } catch (_err) {
      container.innerHTML = '<div class="lp-video-empty">视频加载失败</div>';
    }
  }

  function renderVideoList(container, videos, cached) {
    let html = '';
    // 日志
    html += `<div class="lp-video-log">${cached ? `缓存 · ${videos.length} 个视频` : `搜索完成 · ${videos.length} 个视频`}</div>`;

    html += '<div class="lp-video-grid">';
    for (const v of videos) {
      const title = String(v.title || "").replace(/<[^>]*>/g, "").trim();
      if (!title) continue;
      const url = String(v.url || "").trim();
      const upName = String(v.up_name || "").trim();
      const playCount = String(v.play_count || "0").trim();
      const duration = String(v.duration || "").trim();
      const cover = String(v.cover || "").trim();
      html += `
        <a class="lp-video-card" href="${escapeHtml(url)}" target="_blank" rel="noopener">
          ${cover ? `<img class="lp-video-cover" src="${escapeHtml(cover)}" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ""}
          <div class="lp-video-body">
            <div class="lp-video-title">${escapeHtml(title)}</div>
            ${upName ? `<div class="lp-video-author">${escapeHtml(upName)}</div>` : ""}
            <div class="lp-video-stats">
              ${playCount && playCount !== "0" ? `<span>播放 ${escapeHtml(playCount)}</span>` : ""}
              ${duration ? `<span>${escapeHtml(duration)}</span>` : ""}
            </div>
          </div>
        </a>`;
    }
    html += '</div>';
    container.innerHTML = html;

    var grid = container.querySelector(".lp-video-grid");
    if (grid) {
        bindVideoWheelScroll(container, grid);
    }
  }

  /**
   * 桌面端鼠标滚轮只在横向视频列表可滚动时转换为横向滚动。
   * 课程主页的视频块使用纵向容器滚动，不能被横向列表事件拦截。
   */
  function bindVideoWheelScroll(container, grid) {
    if (!container || !grid) {
      return;
    }

    container.onwheel = function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        return;
      }

      const maxScrollLeft = Math.max(0, grid.scrollWidth - grid.clientWidth);
      const gridStyle = window.getComputedStyle(grid);
      const isHorizontalScroller = gridStyle.overflowX === "auto" || gridStyle.overflowX === "scroll";

      if (!isHorizontalScroller || maxScrollLeft <= 1) {
        return;
      }

      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, grid.scrollLeft + e.deltaY));

      if (nextScrollLeft === grid.scrollLeft) {
        return;
      }

      e.preventDefault();
      grid.scrollLeft = nextScrollLeft;
    };
  }

  function getLearningReportCacheKey(lectureId, options = {}) {
    const bookId = String(options.bookId || "").trim();
    const chapterIndex = Number.isInteger(Number(options.chapterIndex)) ? Number(options.chapterIndex) : -1;
    return [String(lectureId || "").trim(), bookId, String(chapterIndex)].join("::");
  }

  function invalidateLearningReportCache(lectureId) {
    const targetLectureId = String(lectureId || "").trim();
    if (!targetLectureId) {
      state.learningReportCache = {};
      return;
    }

    Object.keys(state.learningReportCache || {}).forEach((key) => {
      if (key.startsWith(`${targetLectureId}::`)) {
        delete state.learningReportCache[key];
      }
    });
  }

  function renderLearningReportLoading(text) {
    return `
      <div class="learning-report-loading">
        <span class="quiz-loading-spinner"></span>
        <span>${escapeHtml(String(text || "正在加载学习报告..."))}</span>
      </div>
    `;
  }

  function formatLearningReportPercent(value, emptyText = "—") {
    if (value === null || value === undefined || value === "") return emptyText;

    const num = Number(value);
    if (!Number.isFinite(num)) return emptyText;

    const percent = num <= 1 ? num * 100 : num;
    return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
  }

  function formatLearningReportNumber(value, suffix = "") {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";

    if (Math.abs(num) >= 10) {
      return `${Math.round(num)}${suffix}`;
    }

    return `${Number(num.toFixed(1))}${suffix}`;
  }

  function getLearningReportRecordLabel(type) {
    const key = String(type || "").trim();
    const labels = {
      chapter_completed: "章节完成",
      session_completed: "小节完成",
      lecture_selection: "课程选择",
      study_time: "学习时长",
      study_session: "学习会话",
      learning_time: "学习时长",
    };
    return labels[key] || key || "学习记录";
  }

  async function fetchLearningReport(lectureId, options = {}) {
    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      throw new Error("缺少课程 ID");
    }

    const requestOptions = options && typeof options === "object" ? options : {};
    const cacheKey = getLearningReportCacheKey(resolvedLectureId, requestOptions);
    if (!requestOptions.force && state.learningReportCache && state.learningReportCache[cacheKey]) {
      return state.learningReportCache[cacheKey];
    }

    const params = new URLSearchParams();
    params.set("lecture_id", resolvedLectureId);

    const bookId = String(requestOptions.bookId || "").trim();
    if (bookId) {
      params.set("book_id", bookId);
    }

    const chapterIndex = Number(requestOptions.chapterIndex);
    if (Number.isInteger(chapterIndex) && chapterIndex >= 0) {
      params.set("chapter_index", String(chapterIndex));
    }

    const data = await fetchJson(`/api/frontend/learning/report?${params.toString()}`);
    state.learningReportCache[cacheKey] = data;
    return data;
  }

  function renderLearningReportMetric(label, value, subText = "", tone = "") {
    const toneClass = tone ? ` is-${tone}` : "";

    return `
      <div class="learning-report-metric${toneClass}">
        <div class="learning-report-metric-label">${escapeHtml(label)}</div>
        <div class="learning-report-metric-value">${escapeHtml(value)}</div>
        ${subText ? `<div class="learning-report-metric-sub">${escapeHtml(subText)}</div>` : ""}
      </div>
    `;
  }

  function getLearningReportStatus(summary, progress, accuracyText) {
    const progressPercent = Math.max(0, Math.min(100, Number(summary.progress_percent || 0)));
    const completedSessions = Number(summary.completed_sessions || 0);
    const totalSessions = Number(summary.total_sessions || 0);
    const currentChapter = String(progress.current_chapter || "").trim();
    const nextChapter = String(progress.next_chapter || "").trim();

    if (progressPercent >= 100) {
      return {
        label: "课程已完成",
        detail: `已完成全部学习进度，建议围绕错题和薄弱点做复盘。测验正确率：${accuracyText}`,
      };
    }

    if (completedSessions > 0 && totalSessions > 0) {
      return {
        label: "学习推进中",
        detail: `已完成 ${completedSessions}/${totalSessions} 个小节，当前重点是${currentChapter || "继续推进当前章节"}。`,
      };
    }

    if (currentChapter || nextChapter) {
      return {
        label: "建议开始记录",
        detail: `可以先从${currentChapter || nextChapter}开始，完成小节后报告会自动更新学习轨迹。`,
      };
    }

    return {
      label: "等待学习数据",
      detail: "完成章节阅读、提交测验或补充画像后，这里会汇总学习状态。",
    };
  }

  function renderLearningReportEvidence(label, value, detail = "") {
    return `
      <div class="learning-report-evidence">
        <div class="learning-report-evidence-label">${escapeHtml(label)}</div>
        <div class="learning-report-evidence-value">${escapeHtml(value)}</div>
        ${detail ? `<div class="learning-report-evidence-detail">${escapeHtml(detail)}</div>` : ""}
      </div>
    `;
  }

  function renderLearningReportPills(rows, emptyText) {
    const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!items.length) {
      return `<div class="learning-report-empty-line">${escapeHtml(emptyText || "暂无数据")}</div>`;
    }

    return `
      <div class="learning-report-pill-list">
        ${items.map((item) => `<span class="learning-report-pill">${escapeHtml(String(item || ""))}</span>`).join("")}
      </div>
    `;
  }

  function renderLearningReportInsightList(rows, emptyText, kind = "") {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
      return `<div class="learning-report-empty-line">${escapeHtml(emptyText || "暂无数据")}</div>`;
    }

    const kindClass = kind ? ` is-${kind}` : "";

    return `
      <div class="learning-report-insight-list">
        ${items.map((row) => `
          <div class="learning-report-insight${kindClass}">
            <div class="learning-report-insight-title">${escapeHtml(String(row && row.title || ""))}</div>
            <div class="learning-report-insight-detail">${escapeHtml(String(row && row.detail || ""))}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderLearningReportRecords(rows) {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
      return '<div class="learning-report-empty-line">暂无学习记录</div>';
    }

    return `
      <div class="learning-report-record-list">
        ${items.map((row) => {
          const titleParts = [
            getLearningReportRecordLabel(row && row.type),
            String(row && row.chapter_name || "").trim(),
            String(row && row.session_name || "").trim(),
          ].filter(Boolean);
          return `
            <div class="learning-report-record">
              <div class="learning-report-record-title">${escapeHtml(titleParts.join(" / ") || "学习记录")}</div>
              <div class="learning-report-record-time">${escapeHtml(formatTs(Number(row && row.timestamp || 0)))}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderLearningReportPanel(report, options = {}) {
    const payload = report && typeof report === "object" ? report : {};
    const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
    const reading = payload.reading && typeof payload.reading === "object" ? payload.reading : {};
    const quiz = payload.quiz && typeof payload.quiz === "object" ? payload.quiz : {};
    const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};
    const progress = payload.progress && typeof payload.progress === "object" ? payload.progress : {};
    const compact = !!options.compact;
    const title = compact ? "学习报告" : `${String(payload.lecture_title || "课程").trim()} 学习报告`;
    const progressPercent = Math.max(0, Math.min(100, Number(summary.progress_percent || 0)));
    const accuracy = summary.accuracy === null || summary.accuracy === undefined
      ? "未判定"
      : formatLearningReportPercent(summary.accuracy);
    const reportStatus = getLearningReportStatus(summary, progress, accuracy);
    const dimensions = Array.isArray(profile.dimensions) ? profile.dimensions : [];
    const filledDimensions = dimensions.filter((row) => row && row.filled).map((row) => `${row.name}: ${row.brief || "已填写"}`).slice(0, compact ? 4 : 8);
    const difficultyRows = Object.entries(quiz.by_difficulty || {}).map(([name, count]) => `${name} ${count}`);
    const timeline = profile.timeline && typeof profile.timeline === "object" ? profile.timeline : {};
    const profileProgressRows = Array.isArray(timeline.progress) ? timeline.progress.slice(0, compact ? 2 : 4).map((row) => `${row.date} ${row.text}`) : [];
    const currentChapter = String(progress.current_chapter || "").trim();
    const nextChapter = String(progress.next_chapter || "").trim();
    const actionText = currentChapter
      ? `当前优先：${currentChapter}${nextChapter ? `，之后进入：${nextChapter}` : ""}`
      : "完成一次章节阅读后会生成下一步建议";

    return `
      <section class="learning-report${compact ? " is-compact" : ""}">
        <header class="learning-report-head">
          <div class="learning-report-title-wrap">
            <div class="learning-report-kicker">LEARNING REPORT</div>
            <h3 class="learning-report-title">${escapeHtml(title)}</h3>
            <div class="learning-report-subtitle">基于阅读、测验、画像和学习记录生成</div>
          </div>
          <div class="learning-report-generated">${escapeHtml(formatTs(Number(payload.generated_at || 0)))}</div>
        </header>

        <section class="learning-report-hero">
          <div class="learning-report-hero-main">
            <div class="learning-report-hero-label">${escapeHtml(reportStatus.label)}</div>
            <div class="learning-report-hero-detail">${escapeHtml(reportStatus.detail)}</div>
            <div class="learning-report-progress">
              <div class="learning-report-progress-top">
                <span>课程进度</span>
                <strong>${escapeHtml(String(progressPercent))}%</strong>
              </div>
              <div class="learning-report-progress-bar"><span style="width:${progressPercent}%"></span></div>
              <div class="learning-report-progress-next">${escapeHtml(actionText)}</div>
            </div>
          </div>

          <div class="learning-report-hero-side">
            ${renderLearningReportEvidence("章节", `${summary.completed_chapters || 0}/${summary.total_chapters || 0}`, "已完成")}
            ${renderLearningReportEvidence("小节", `${summary.completed_sessions || 0}/${summary.total_sessions || 0}`, "学习颗粒度")}
            ${renderLearningReportEvidence("正确率", accuracy, `${summary.reviewed_questions || 0} 题可判定`)}
          </div>
        </section>

        <section class="learning-report-metrics">
          ${renderLearningReportMetric("学习时长", formatLearningReportNumber(summary.study_hours || 0, "h"), "课程累计", "time")}
          ${renderLearningReportMetric("阅读深度", `${reading.deep_read_chapters || 0}`, "达到深读的章节", "reading")}
          ${renderLearningReportMetric("测验提交", String(summary.submitted_questions || 0), "已提交题目", "quiz")}
          ${renderLearningReportMetric("画像完整度", formatLearningReportPercent(summary.profile_completion_rate || 0), "维度完成", "profile")}
        </section>

        <section class="learning-report-grid learning-report-action-grid">
          <article class="learning-report-block learning-report-block-primary">
            <div class="learning-report-block-title">薄弱点</div>
            ${renderLearningReportInsightList(payload.weaknesses, "暂无显性薄弱点", "weak")}
          </article>

          <article class="learning-report-block learning-report-block-primary">
            <div class="learning-report-block-title">下一步建议</div>
            ${renderLearningReportInsightList(payload.recommendations, "暂无建议", "next")}
          </article>
        </section>

        <section class="learning-report-grid">
          <article class="learning-report-block">
            <div class="learning-report-block-title">学习行为证据</div>
            <div class="learning-report-evidence-grid">
              ${renderLearningReportEvidence("阅读事件", String(reading.total_events || 0), `累计 ${formatLearningReportNumber(reading.total_reading_minutes || 0, " 分钟")}`)}
              ${renderLearningReportEvidence("文本选择", String(reading.selection_count || 0), "可用于识别重点")}
              ${renderLearningReportEvidence("批注提问", String(reading.annotation_ask_count || 0), `查看 ${reading.annotation_view_count || 0} 次`)}
            </div>
          </article>

          <article class="learning-report-block">
            <div class="learning-report-block-title">题目状态</div>
            <div class="learning-report-line">提交 ${escapeHtml(String(quiz.submitted || 0))} 题 · 可判定 ${escapeHtml(String(quiz.reviewed || 0))} 题 · 正确 ${escapeHtml(String(quiz.correct || 0))} 题</div>
            ${renderLearningReportPills(difficultyRows, "暂无难度分布")}
          </article>
        </section>

        <section class="learning-report-grid learning-report-grid-bottom">
          <article class="learning-report-block">
            <div class="learning-report-block-title">画像依据</div>
            ${renderLearningReportPills(filledDimensions, "暂无已填写画像维度")}
          </article>

          <article class="learning-report-block">
            <div class="learning-report-block-title">画像变化</div>
            ${renderLearningReportPills(profileProgressRows, "暂无画像时间线")}
          </article>
        </section>

        <section class="learning-report-block learning-report-record-block">
          <div class="learning-report-block-title">最近学习记录</div>
          ${renderLearningReportRecords(payload.recent_records)}
        </section>
      </section>
    `;
  }

  async function loadCourseLearningReport(lectureId) {
    const container = document.getElementById("courseLearningReportContainer");
    if (!container) return;

    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      container.innerHTML = '<div class="learning-report-empty-line">缺少课程 ID</div>';
      return;
    }

    container.dataset.lectureId = resolvedLectureId;
    container.innerHTML = renderLearningReportLoading("正在生成学习报告...");

    try {
      const report = await fetchLearningReport(resolvedLectureId);
      if (String(container.dataset.lectureId || "") !== resolvedLectureId) return;

      container.innerHTML = renderLearningReportPanel(report);
    } catch (err) {
      container.innerHTML = `<div class="learning-report-error">${escapeHtml(err && err.message ? err.message : "学习报告加载失败")}</div>`;
    }
  }

  /**
   * 加载课程级思维导图：委托给 NXKG（knowledge_graph.js）。
   * 若尚未生成，NXKG 会显示"生成思维导图"按钮，由全局事件委托处理点击。
   */
  async function loadCourseMindmap(lectureId) {
    if (!window.NXKG || typeof window.NXKG.loadCourse !== "function") {
      const container = document.getElementById("courseMindmapContainer");
      if (container) container.innerHTML = '<div class="lp-video-loading">思维导图模块未加载</div>';
      return;
    }
    await window.NXKG.loadCourse(lectureId);
  }

  async function loadCourseOutline(lectureId) {
    const container = document.getElementById("courseOutlineContainer");
    if (!container) return;

    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      container.innerHTML = '<div class="outline-empty">暂无学习大纲</div>';
      return;
    }

    // 缓存命中
    if (state.courseOutline && state.courseOutline.lecture_id === resolvedLectureId) {
      renderOutline(container, state.courseOutline, resolvedLectureId);
      return;
    }

    container.dataset.lectureId = resolvedLectureId;
    container.innerHTML = '<div class="lp-video-loading">正在加载学习大纲...</div>';

    try {
      const data = await fetchJson(`/api/frontend/outline/${encodeURIComponent(resolvedLectureId)}`);
      if (String(container.dataset.lectureId || "") !== resolvedLectureId) return;

      if (!data.success || !data.outline) {
        container.innerHTML = '<div class="outline-empty">大纲尚未生成，请在课程管理中生成课程大纲</div>';
        return;
      }

      state.courseOutline = data.outline;
      renderOutline(container, data.outline, resolvedLectureId);
    } catch (_err) {
      container.innerHTML = '<div class="outline-empty">大纲尚未生成，请在课程管理中生成课程大纲</div>';
    }
  }

  function renderOutline(container, outline, lectureId) {
    const sections = Array.isArray(outline.sections) ? outline.sections : [];
    const totalSections = outline.total_sections || sections.length;
    const totalMinutes = outline.total_estimated_minutes || 0;
    const resolvedLectureId = String(lectureId || outline.lecture_id || container.dataset.lectureId || "").trim();
    const safeLectureId = escapeHtml(resolvedLectureId);

    if (!sections.length) {
      container.innerHTML = '<div class="outline-empty">大纲内容为空</div>';
      return;
    }

    let html = `
      <div class="outline-header">
        <h3 class="outline-title">${escapeHtml(outline.course_title || outline.lecture_title || "学习大纲")}</h3>
        <span class="outline-meta">共 ${totalSections} 个单元 · 预计 ${totalMinutes} 分钟</span>
      </div>
      <div class="outline-sections">
    `;

    sections.forEach((section, idx) => {
      const sectionId = escapeHtml(section.id || `sec_${idx}`);
      const title = escapeHtml(section.title || "");
      const summary = escapeHtml(section.summary || "");
      const difficulty = escapeHtml(section.difficulty || "");
      const minutes = section.estimated_minutes || 0;
      const readingOrder = section.reading_order || idx + 1;
      const objectives = Array.isArray(section.objectives) ? section.objectives : [];
      const keyConcepts = Array.isArray(section.key_concepts) ? section.key_concepts : [];
      const prerequisites = Array.isArray(section.prerequisites) ? section.prerequisites : [];
      const actionLabel = title ? `去学习：${title}` : "去学习";

      const difficultyClass = difficulty === "基础" ? "outline-difficulty-basic" :
        difficulty === "中等" ? "outline-difficulty-medium" :
        difficulty === "进阶" ? "outline-difficulty-advanced" : "";

      html += `
        <div class="outline-section-card" data-action="start-learning-path" data-lecture-id="${safeLectureId}" data-outline-section-id="${sectionId}" data-chapter-index="${idx}" data-section-id="${sectionId}" role="button" tabindex="0" aria-label="${actionLabel}" title="${actionLabel}">
          <div class="outline-section-order">${readingOrder}</div>
          <div class="outline-section-body">
            <div class="outline-section-head">
              <div class="outline-section-title">${title}</div>
              <span class="outline-section-action" aria-hidden="true">
                <span>去学习</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
              </span>
            </div>
            ${summary ? `<div class="outline-section-summary">${summary}</div>` : ""}
            <div class="outline-section-meta">
              ${difficulty ? `<span class="outline-difficulty ${difficultyClass}">${difficulty}</span>` : ""}
              ${minutes ? `<span class="outline-time">约 ${minutes} 分钟</span>` : ""}
            </div>
            ${keyConcepts.length ? `
              <div class="outline-concepts">
                ${keyConcepts.map((c) => `<span class="outline-concept-tag">${escapeHtml(c)}</span>`).join("")}
              </div>
            ` : ""}
            ${objectives.length ? `
              <div class="outline-objectives">
                <div class="outline-objectives-label">学习目标</div>
                <ul class="outline-objectives-list">
                  ${objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}
                </ul>
              </div>
            ` : ""}
            ${prerequisites.length ? `
              <div class="outline-prerequisites">
                <span class="outline-prerequisites-label">前置依赖：</span>
                ${prerequisites.map((p) => {
                  const prereqSection = sections.find((s) => s.id === p);
                  return `<span class="outline-prerequisite-tag">${escapeHtml(prereqSection ? prereqSection.title : p)}</span>`;
                }).join("")}
              </div>
            ` : ""}
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  async function generateLearningPath(lectureId, bookId, force) {
    const catalogList = document.querySelector(".learning-panel-catalog-list");
    if (!catalogList) return;

    const cacheKey = getLearningPathCacheKey(lectureId, bookId);
    if (!force && cacheKey && state.learningPathCache[cacheKey]) {
      renderLearningPath(catalogList, state.learningPathCache[cacheKey], lectureId, bookId);
      return;
    }

    setCatalogRecommendationStatus(force ? "推荐阅读生成中..." : "读取推荐阅读...");
    try {
      const data = await fetchJson("/api/frontend/learning-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: getRuntimeUsername(), lecture_id: lectureId, book_id: bookId, force: !!force }),
      });
      if (!data.success || !Array.isArray(data.path)) {
        setCatalogRecommendationStatus(data.error || "推荐阅读生成失败");
        return;
      }
      if (cacheKey) {
        state.learningPathCache[cacheKey] = data;
      }
      renderLearningPath(catalogList, data, lectureId, bookId);
    } catch (err) {
      setCatalogRecommendationStatus(`生成失败：${err.message || "未知错误"}`);
    }
  }

  function renderLearningPath(container, data, lectureId, bookId) {
    const pathItems = Array.isArray(data.path) ? data.path : [];
    if (!pathItems.length) {
      clearCatalogRecommendations(container);
      setCatalogRecommendationStatus("暂无推荐阅读");
      return;
    }

    const statusLabels = { completed: "已读完", current: "当前", recommended: "推荐", pending: "待学习" };
    const recommendationMap = new Map();

    pathItems.forEach((item) => {
      const key = normalizeCatalogRecommendationName(item && item.name);
      if (!key) return;
      recommendationMap.set(key, item);
    });

    let appliedCount = 0;
    let completedCount = 0;
    let scrollTarget = null;
    container.querySelectorAll(".materials-catalog-item").forEach((node) => {
      const slot = node.querySelector(".catalog-recommendation-inline");
      if (!slot) return;

      const key = String(node.getAttribute("data-catalog-title") || "").trim();
      const item = recommendationMap.get(key);
      const alreadyCompleted = resetCatalogItemMarker(node);

      if (alreadyCompleted) {
        completedCount += 1;
        return;
      }

      if (!item) return;

      const rawStatus = String(item.status || "").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(statusLabels, rawStatus)) return;

      const status = rawStatus;
      const label = statusLabels[status];
      const reason = String(item.reason || "").trim();
      node.classList.add("has-recommendation", `catalog-status-${status}`);
      if (status === "completed") {
        node.classList.add("is-catalog-completed");
      }
      slot.innerHTML = `
        <span class="catalog-recommendation-badge${status === "completed" ? " catalog-completed-badge" : ""}"${status === "completed" ? ' title="清空该章节阅读记录"' : ""}>${escapeHtml(label)}</span>
        ${reason ? `<span class="catalog-recommendation-reason">${escapeHtml(reason)}</span>` : ""}
      `;
      if (status === "current") {
        scrollTarget = node;
      } else if (status === "recommended" && !scrollTarget) {
        scrollTarget = node;
      }
      appliedCount += 1;
    });

    const statusText = appliedCount
      ? `已融合 ${appliedCount} 条推荐`
      : (completedCount ? `已读完 ${completedCount} 章` : "暂无匹配章节推荐");
    setCatalogRecommendationStatus(statusText);
    scrollCatalogRecommendationIntoView(scrollTarget);
  }

  function normalizeCatalogRecommendationName(value) {
    return String(value || "").trim().replace(/\s+/g, "");
  }

  function getLearningPathCacheKey(lectureId, bookId) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    if (!lid || !bid) return "";

    return `${lid}::${bid}`;
  }

  function clearCatalogRecommendations(container) {
    if (!container) return;

    container.querySelectorAll(".materials-catalog-item").forEach((node) => {
      resetCatalogItemMarker(node);
    });
  }

  function setCatalogRecommendationStatus(text) {
    const node = document.getElementById("catalogRecommendationStatus");
    if (node) node.textContent = String(text || "").trim();
  }

  function scrollCatalogRecommendationIntoView(node) {
    if (!node) return;

    const scroller = node.closest(".learning-panel-catalog-scroll");
    if (!scroller) return;

    requestAnimationFrame(() => {
      const scrollerRect = scroller.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const nextTop = scroller.scrollTop + nodeRect.top - scrollerRect.top - 28;
      scroller.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    });
  }

  function isCatalogChapterCompleted(lectureId, bookId, chapterIndex) {
    const key = `${String(lectureId || "").trim()}::${String(bookId || "").trim()}`;
    if (!key || key === "::") return false;

    const progress = state.readerSessionProgress[key];
    if (!progress || !(progress.completedIndices instanceof Set)) return false;

    return progress.completedIndices.has(Number(chapterIndex) || 0);
  }

  function renderCatalogCompletedBadge() {
    return '<span class="catalog-recommendation-badge catalog-completed-badge" title="清空该章节阅读记录">已读完</span>';
  }

  function resetCatalogItemMarker(node) {
    const slot = node ? node.querySelector(".catalog-recommendation-inline") : null;
    const completed = String(node && node.getAttribute("data-catalog-completed") || "") === "1";
    if (!node || !slot) return false;

    node.classList.remove("has-recommendation", "catalog-status-current", "catalog-status-recommended", "catalog-status-pending");

    if (completed) {
      node.classList.add("is-catalog-completed", "catalog-status-completed");
      slot.innerHTML = renderCatalogCompletedBadge();
      return true;
    }

    node.classList.remove("is-catalog-completed", "catalog-status-completed");
    slot.innerHTML = "";
    return false;
  }

  async function confirmClearCatalogChapterProgress(chapterIndex) {
    const idx = Number(chapterIndex) || 0;
    const chapters = state.catalogContext && Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters : [];
    const chapter = chapters[idx];
    const title = String((chapter && chapter.title) || `第 ${idx + 1} 章`).trim();
    const ok = await confirmModalAsync(`确认清空「${title}」的阅读记录？已生成的小测验文件会保留，但本章节将不再指向该小测，导读缓存也会清空。`);
    if (!ok) return;

    await clearCatalogChapterProgress(idx);
  }

  async function clearCatalogChapterProgress(chapterIndex) {
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.catalogContext && state.catalogContext.bookId || state.selectedBookId || "").trim();
    const idx = Number(chapterIndex) || 0;
    const chapters = state.catalogContext && Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters : [];
    const chapter = chapters[idx];
    const chapterName = String((chapter && chapter.title) || "").trim();
    if (!lectureId || !bookId) {
      showToast("当前课程或教材上下文不完整，不能清空记录");
      return;
    }
    if (!chapterName) {
      showToast("当前章节上下文不完整，不能清空记录");
      return;
    }

    try {
      await fetchJson("/api/frontend/learning/chapter-record/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: lectureId,
          book_id: bookId,
          chapter_name: chapterName,
          chapter_index: idx,
        }),
      });
    } catch (err) {
      console.warn("[NXL-Reader] clear chapter record failed", err);
      showToast(err && err.message ? err.message : "清空阅读记录失败");
      return;
    }

    const sessionKey = `${lectureId}::${bookId}`;
    const progress = state.readerSessionProgress[sessionKey];
    if (progress) {
      if (progress.completedIndices instanceof Set) {
        progress.completedIndices.delete(idx);
      }

      if (progress.completedSessions instanceof Set) {
        const sessionPrefix = `${idx}:`;
        Array.from(progress.completedSessions).forEach((item) => {
          if (String(item || "").startsWith(sessionPrefix)) {
            progress.completedSessions.delete(item);
          }
        });
      }

      clearChapterCompleteReportsForIndex(lectureId, bookId, idx);

      if (Number(progress.currentChapterIndex) === idx) {
        progress.currentChapterIndex = 0;
      }

      saveSessionProgress();
    }

    clearReaderGuideCacheForChapter(lectureId, bookId, idx);
    clearChapterQuizReference(lectureId, bookId, idx);
    clearLearningPathCompletedStatusForChapter(lectureId, bookId, idx);

    state.readerReportedChapterKey = "";
    state.readerReportingChapterKey = "";
    state.readerChapterQuizLoadingKey = "";

    const item = document.querySelector(`.materials-catalog-item[data-material-catalog-index="${idx}"]`);
    if (item) {
      item.setAttribute("data-catalog-completed", "0");
      resetCatalogItemMarker(item);
    }

    renderChapterList();
    showToast("已清空该章节阅读记录");
  }

  function clearLearningPathCompletedStatusForChapter(lectureId, bookId, chapterIndex) {
    const cacheKey = getLearningPathCacheKey(lectureId, bookId);
    const cache = cacheKey ? state.learningPathCache[cacheKey] : null;
    const path = cache && Array.isArray(cache.path) ? cache.path : [];
    const chapters = state.catalogContext && Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters : [];
    const chapter = chapters[Number(chapterIndex) || 0];
    const chapterKey = normalizeCatalogRecommendationName(chapter && chapter.title);
    if (!chapterKey) return;

    path.forEach((item) => {
      const itemKey = normalizeCatalogRecommendationName(item && item.name);
      if (itemKey === chapterKey && String(item.status || "").toLowerCase() === "completed") {
        item.status = "pending";
        item.reason = "";
      }
    });
  }

  function clearReaderGuideCacheForChapter(lectureId, bookId, chapterIndex) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    const idx = Number(chapterIndex) || 0;
    const cache = readReaderGuideCache();
    let changed = false;

    Object.keys(cache).forEach((key) => {
      const item = cache[key] && typeof cache[key] === "object" ? cache[key] : {};
      const target = item.target && typeof item.target === "object" ? item.target : {};
      const parts = String(key || "").split("::");
      const matchesTarget = String(target.lectureId || "").trim() === lid
        && String(target.bookId || "").trim() === bid
        && Number(target.chapterIndex) === idx;
      const matchesKey = parts.length >= 4
        && parts[0] === lid
        && parts[1] === bid
        && Number(parts[3]) === idx;

      if (matchesTarget || matchesKey) {
        delete cache[key];
        changed = true;
      }
    });

    if (changed) {
      writeReaderGuideCache(cache);
    }

    clearReaderGuideCardStateForChapter(lid, bid, idx);

    const activeTarget = readerGuideState.target || {};
    if (
      String(activeTarget.lectureId || "").trim() === lid &&
      String(activeTarget.bookId || "").trim() === bid &&
      Number(activeTarget.chapterIndex) === idx
    ) {
      state.readerGuidePromptedKey = "";
      readerGuideState = { status: "empty", target: null, guide: null, error: "", draft: "" };
      renderReaderGuidePanel();
    }
  }

  function clearReaderGuideCardStateForChapter(lectureId, bookId, chapterIndex) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    const idx = Number(chapterIndex) || 0;
    const stateMap = readReaderGuideCardState();
    let changed = false;

    Object.keys(stateMap).forEach((key) => {
      const parts = String(key || "").split("::");
      const matchesKey = parts.length >= 4
        && parts[0] === lid
        && parts[1] === bid
        && Number(parts[3]) === idx;

      if (matchesKey) {
        delete stateMap[key];
        changed = true;
      }
    });

    if (changed) {
      writeReaderGuideCardState(stateMap);
    }
  }

  function clearChapterQuizReference(lectureId, bookId, chapterIndex) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    const idx = Number(chapterIndex) || 0;
    const storedQuizzes = JSON.parse(localStorage.getItem("nxl_quiz_generated_v1") || "{}");
    let changed = false;

    Object.keys(storedQuizzes).forEach((key) => {
      const item = storedQuizzes[key] && typeof storedQuizzes[key] === "object" ? storedQuizzes[key] : {};
      const meta = item.meta && typeof item.meta === "object" ? item.meta : {};

      if (
        String(meta.quizType || "") === "chapter" &&
        String(meta.lectureId || "").trim() === lid &&
        String(meta.bookId || "").trim() === bid &&
        Number(meta.chapterIndex) === idx
      ) {
        delete storedQuizzes[key];
        changed = true;
      }
    });

    if (changed) {
      localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));
    }

    const meta = quizState.currentMeta || {};
    if (
      String(meta.quizType || "") === "chapter" &&
      String(meta.lectureId || "").trim() === lid &&
      String(meta.bookId || "").trim() === bid &&
      Number(meta.chapterIndex) === idx
    ) {
      quizState.loading = false;
      quizState.currentChapter = "";
      quizState.currentSession = "";
      quizState.currentMeta = null;
      quizState.questions = [];
      quizState.answers = {};
      quizState.error = null;
      saveQuizState();
      renderQuizPanel();
    }
  }

  function renderLectureList() {
    if (!state.allLectureRows.length) {
      el.lectureList.innerHTML = '<div class="materials-empty">暂无课程</div>';
      return;
    }
    if (!state.selectedLectureId) {
      state.selectedLectureId = String((state.allLectureRows[0].lecture || {}).id || "");
    }
    el.lectureList.innerHTML = state.allLectureRows.map((row) => {
      const lecture = row.lecture || {};
      const lectureId = String(lecture.id || "");
      const active = lectureId === state.selectedLectureId ? "is-active" : "";
      const selected = state.selectedLearningLectureIds.includes(lectureId);
      return `
      <article class="lecture-item ${active}" data-lecture-id="${escapeHtml(lectureId)}">
        <div class="lecture-title">${escapeHtml(getLectureTitle(lecture))}</div>
        <div class="lecture-meta">${escapeHtml(`${toNumber(row.books_count, 0)} 本教材 · ${getCourseProgress(lecture, row.books || [])}% 进度`)}</div>
        <div class="lecture-meta">${escapeHtml(`${lecture.category || "未分类"} · ${statusText(lecture.status)} · ${selected ? "已加入学习" : "未加入学习"}`)}</div>
      </article>`;
    }).join("");
  }

  function renderMaterialsShelf() {
    if (!state.allLectureRows.length) {
      el.lectureDetailPane.innerHTML = '<div class="materials-empty">暂无课程</div>';
      return;
    }

    const cardsHtml = state.allLectureRows.map((row) => {
      const lecture = row.lecture || {};
      const lectureId = String(lecture.id || "");
      const selected = state.selectedLearningLectureIds.includes(lectureId);
      const booksCount = toNumber(row.books_count, 0);
      const progress = getCourseProgress(lecture, row.books || []);
      const trail = getLectureProgressTrail(lecture, row.books || []);
      return `
        <article class="nxl-course-item nxl-course-shelf-card" data-lecture-home-id="${escapeHtml(lectureId)}">
          <div class="nxl-course-top">
            <div class="nxl-course-title">${escapeHtml(getLectureTitle(lecture))}</div>
            <span class="nxl-course-percent">${escapeHtml(String(progress))}%</span>
          </div>
          <div class="nxl-course-meta-row">
            <span class="nxl-course-meta-pill">${escapeHtml(lecture.category || "未分类")}</span>
            <span class="nxl-course-meta-pill">${escapeHtml(booksCount ? `${booksCount} 本教材` : "暂无教材")}</span>
          </div>
          <div class="nxl-course-current">${escapeHtml(selected ? "已加入学习" : "未加入学习")}${trail.bookTitle ? ` · ${trail.bookTitle}` : ""}</div>
          <div class="nxl-course-bar"><div class="nxl-course-bar-fill" style="width:${Math.max(0, Math.min(100, Number(progress) || 0))}%"></div></div>
        </article>
      `;
    }).join("");

    el.lectureDetailPane.innerHTML = `
      <section class="materials-detail-scroll">
        <section class="detail-section" style="padding-top:0;border-bottom:0;">
          <div class="materials-list">${cardsHtml}</div>
        </section>
      </section>
    `;
  }

  function renderLectureDetail() {
    syncMaterialsPageMode();

    if (state.materialsPageMode === "shelf") {
      renderMaterialsShelf();
      return;
    }

    const detailPane = el.courseHomeContent;
    if (!detailPane) {
      return;
    }

    if (state.materialsDetailMode === "teacher-edit" && state.teacherEditContext) {
      const editLectureId = String(state.teacherEditContext.lectureId || "");
      const editRow = getLectureRowById(editLectureId);
      const editLecture = editRow ? (editRow.lecture || {}) : {};
      const ctx = state.teacherEditContext;
      const isBookMode = String(ctx.mode || "").trim() === "book";
      const editBookId = String(ctx.bookId || "").trim();
      const editBook = isBookMode ? (getBookRowById(editLectureId, editBookId) || {}) : null;

      if (!isBookMode && !Array.isArray(ctx.pendingTeachers)) {
        const teacherInfo = Array.isArray(editLecture.teacher_info) && editLecture.teacher_info.length
          ? editLecture.teacher_info
          : getLectureTeacherEntries(editLecture).map((entry) => ({
              user_id: getLectureTeacherLabel(entry),
              display_name: getLectureTeacherLabel(entry),
            }));
        ctx.pendingTeachers = teacherInfo.slice();
      }
      if (!Array.isArray(ctx.searchResults)) ctx.searchResults = [];

      const pending = Array.isArray(ctx.pendingTeachers) ? ctx.pendingTeachers : [];
      const coverAssets = Array.isArray(ctx.coverAssets) ? ctx.coverAssets : [];
      const selectedCoverPath = String(ctx.selectedCoverPath || "").trim();

      const pendingHtml = pending.length
        ? pending.map((t, idx) => {
            const name = t.display_name || t.nickname || t.username || t.user_id || "";
            const avatarUrl = normalizeFeedAvatarUrl(String(t.avatar_url || "").trim());
            const hue = (name || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
            const bgColor = `hsl(${hue}, 45%, 72%)`;
            const avatarHtml = avatarUrl
              ? `<img class="teacher-edit-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" onerror="this.style.display='none'">`
              : `<span class="teacher-edit-user-avatar-ph" style="background:${bgColor}">${escapeHtml((name || "?")[0] || "?")}</span>`;
            return `<div class="teacher-edit-user-item">
              ${avatarHtml}
              <span class="teacher-edit-user-name">${escapeHtml(name)}</span>
              <button class="teacher-edit-remove-btn" type="button" data-remove-teacher-index="${idx}" title="移除">✕</button>
            </div>`;
          }).join("")
        : '<div class="teacher-edit-empty-note">暂无教师，请从右侧搜索添加</div>';

      const coverListHtml = ctx.coverLoading
        ? '<div class="teacher-edit-empty-note">图片资源加载中...</div>'
        : (ctx.coverError
            ? `<div class="teacher-edit-empty-note">${escapeHtml(ctx.coverError)}</div>`
            : (coverAssets.length
                ? coverAssets.map((item, idx) => {
                    const itemPath = String(item.cover_path || "").trim();
                    const active = itemPath === selectedCoverPath ? "is-active" : "";
                    const itemName = String(item.name || item.file_name || item.image_id || `图片 ${idx + 1}`).trim();
                    const itemImage = escapeHtml(resolveApiUrl(String(item.image_url || item.cover_path || "").trim()));
                    return `
                      <button class="teacher-edit-cover-item ${active}" type="button" data-cover-path="${escapeHtml(itemPath)}" title="${escapeHtml(itemName)}">
                        <img class="teacher-edit-cover-thumb" src="${itemImage}" alt="${escapeHtml(itemName)}" loading="lazy">
                      </button>
                    `;
                  }).join("")
                : '<div class="teacher-edit-empty-note">当前范围内暂无可用图片</div>'));

      const managerHint = isBookMode ? "保存后将更新当前教材封面" : "保存后将更新当前课程封面";
      const coverPreviewHtml = renderLearningPanelCover(
        selectedCoverPath,
        isBookMode ? String((editBook && editBook.title) || "教材封面") : getLectureTitle(editLecture),
        "teacher-edit-cover-preview"
      );

      detailPane.innerHTML = `
        <section class="materials-detail-scroll learning-panel-page">
          <div class="teacher-edit-panel">
            ${isBookMode ? "" : `
            <div class="teacher-edit-split teacher-edit-manage-split">
              <div class="teacher-edit-left">
                <div class="teacher-edit-section-title">当前教师 <span id="teacherEditPendingCount">(${pending.length})</span></div>
                <div class="teacher-edit-user-list" id="teacherEditPendingList">${pendingHtml}</div>
              </div>
              <div class="teacher-edit-right">
                <div class="teacher-edit-section-title">搜索用户</div>
                <input type="text" id="teacherEditSearchInput" class="teacher-edit-search-input" placeholder="输入名称或 UID 搜索..." value="${escapeHtml(String(ctx.searchQuery || ""))}" autocomplete="off" />
                <div class="teacher-edit-search-results" id="teacherEditSearchResults"><div class="teacher-edit-empty-note">输入关键词搜索用户，留空显示最近用户</div></div>
              </div>
            </div>
            `}
            <div class="teacher-edit-split teacher-edit-cover-split">
              <div class="teacher-edit-left teacher-edit-cover-left">
                <div class="teacher-edit-section-title">封面预览</div>
                <div class="teacher-edit-cover-stage" id="teacherEditCoverStage">${coverPreviewHtml}</div>
                <div class="teacher-edit-cover-hint">${managerHint}</div>
              </div>
              <div class="teacher-edit-right teacher-edit-cover-right">
                <div class="teacher-edit-section-title">图片资源列表</div>
                <div class="teacher-edit-cover-list" id="teacherEditCoverList">${coverListHtml}</div>
              </div>
            </div>
            <div class="teacher-edit-actions">
              <button class="btn btn-primary" id="teacherEditSaveBtn" type="button">保存</button>
              <button class="btn btn-secondary" id="teacherEditCancelBtn" type="button">取消</button>
            </div>
          </div>
        </section>
      `;

      const saveBtn = document.getElementById("teacherEditSaveBtn");
      const cancelBtn = document.getElementById("teacherEditCancelBtn");
      const searchInput = document.getElementById("teacherEditSearchInput");
      const pendingList = document.getElementById("teacherEditPendingList");
      const searchResults = document.getElementById("teacherEditSearchResults");
      const coverList = document.getElementById("teacherEditCoverList");

      if (cancelBtn) cancelBtn.addEventListener("click", () => closeTeacherEditPanel());

      if (!isBookMode && searchInput) {
        let _teacherSearchTimer = null;
        const doSearch = () => {
          const q = String(searchInput.value || "").trim();
          ctx.searchQuery = q;
          ctx.searchLoading = true;
          if (searchResults) {
            searchResults.innerHTML = '<div class="teacher-edit-empty-note">搜索中...</div>';
          }
          const url = `/api/frontend/users/search?q=${encodeURIComponent(q)}&limit=10`;
          fetchJson(url).then((data) => {
            ctx.searchResults = Array.isArray(data && data.items) ? data.items : [];
            ctx.searchLoading = false;
            updateTeacherEditSearchResults();
          }).catch(() => {
            ctx.searchResults = [];
            ctx.searchLoading = false;
            updateTeacherEditSearchResults();
          });
        };
        searchInput.addEventListener("input", () => {
          if (_teacherSearchTimer) clearTimeout(_teacherSearchTimer);
          _teacherSearchTimer = setTimeout(doSearch, 300);
        });
        if (!ctx.searchResults.length && !ctx.searchLoading) doSearch();
        else if (ctx.searchResults.length) updateTeacherEditSearchResults();
      }

      if (!isBookMode && pendingList) {
        pendingList.addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-remove-teacher-index]");
          if (!btn) return;
          const idx = Number(btn.getAttribute("data-remove-teacher-index"));
          if (idx >= 0 && idx < ctx.pendingTeachers.length) {
            ctx.pendingTeachers.splice(idx, 1);
            updateTeacherEditPendingList();
          }
        });
      }

      if (!isBookMode && searchResults) {
        searchResults.addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-add-user-id]");
          if (!btn || btn.disabled) return;
          const uid = String(btn.getAttribute("data-add-user-id") || "").trim();
          if (!uid) return;
          const user = ctx.searchResults.find((u) => String(u.user_id || "") === uid);
          if (!user) return;
          if (ctx.pendingTeachers.some((t) => String(t.user_id || "") === uid)) return;
          ctx.pendingTeachers.push({
            user_id: String(user.user_id || uid),
            username: String(user.username || "").trim(),
            display_name: String(user.display_name || "").trim(),
            nickname: String(user.nickname || "").trim(),
            avatar_url: String(user.avatar_url || "").trim(),
          });
          updateTeacherEditPendingList();
          updateTeacherEditSearchResults();
        });
      }

      if (coverList) {
        coverList.addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-cover-path]");
          if (!btn) return;
          const nextPath = String(btn.getAttribute("data-cover-path") || "").trim();
          if (!nextPath || nextPath === String(ctx.selectedCoverPath || "").trim()) return;
          ctx.selectedCoverPath = nextPath;
          updateTeacherEditCoverSelectionUi(ctx);
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
          const teacherList = pending
            .map((t) => String(t.user_id || t.username || "").trim())
            .filter(Boolean);
          const coverPath = String(ctx.selectedCoverPath || "").trim();
          saveBtn.disabled = true;
          try {
            if (isBookMode) {
              await fetchJson(`/api/lectures/${encodeURIComponent(editLectureId)}/books/${encodeURIComponent(editBookId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cover_path: coverPath }),
              });

              if (
                state.catalogContext
                && String(state.catalogContext.bookId || "").trim() === editBookId
              ) {
                state.catalogContext.coverPath = coverPath;
              }
            } else {
              await fetchJson(`/api/lectures/${encodeURIComponent(editLectureId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cover_path: coverPath }),
              });
              await fetchJson(`/api/lectures/${encodeURIComponent(editLectureId)}/teacher`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ teacher: teacherList }),
              });
            }
            await refreshAll();
            showToast(isBookMode ? "教材封面已更新" : "课程封面与教师信息已更新");
            closeTeacherEditPanel();
          } catch (err) {
            saveBtn.disabled = false;
            showToast(`保存失败：${err.message || "未知错误"}`);
          }
        });
      }
      return;
    }

    if (state.materialsDetailMode === "catalog" && state.catalogContext) {
      const ctx = state.catalogContext;
      const chapters = Array.isArray(ctx.chapters) ? ctx.chapters : [];
      const isLoading = !!ctx.loading;
      const summaryBrief = escapeHtml(ctx.summaryBrief || "");
      const summaryBriefHtml = summaryBrief.replace(/\n/g, "<br>");
      const catalogCoverHtml = renderLearningPanelCover(
        String(ctx.coverPath || "").trim(),
        String(ctx.title || "教材目录"),
        "learning-panel-cover-placeholder"
      );
      const completedCatalogCount = chapters.reduce((count, _item, idx) => (
        count + (isCatalogChapterCompleted(state.selectedLectureId || "", ctx.bookId || "", idx) ? 1 : 0)
      ), 0);
      const unreadCatalogCount = Math.max(0, chapters.length - completedCatalogCount);
      const nextCatalogItem = chapters.find((_item, idx) => !isCatalogChapterCompleted(state.selectedLectureId || "", ctx.bookId || "", idx));
      const catalogOverviewHtml = (!isLoading && chapters.length) ? `
        <div class="learning-panel-hero-metrics">
          <span><strong>${escapeHtml(String(chapters.length))}</strong>章节</span>
          <span><strong>${escapeHtml(String(completedCatalogCount))}</strong>已读</span>
          <span><strong>${escapeHtml(String(unreadCatalogCount))}</strong>待读</span>
          <span class="learning-panel-hero-next" title="${escapeHtml(nextCatalogItem ? nextCatalogItem.title || "" : "全部章节已读完")}">下一章：${escapeHtml(nextCatalogItem ? nextCatalogItem.title || "未命名章节" : "全部章节已读完")}</span>
        </div>
      ` : "";

      detailPane.innerHTML = `
        <section class="materials-detail-scroll materials-catalog-page learning-panel-page">
          <div class="learning-panel-hero-block">
            ${catalogCoverHtml}
            <div class="learning-panel-hero-info">
              <div class="learning-panel-hero-title">${escapeHtml(ctx.title || "教材目录")}</div>
              <div class="learning-panel-hero-subtitle">${escapeHtml(ctx.subtitle || "")}</div>
              ${summaryBrief ? `<div class="learning-panel-hero-brief">${summaryBriefHtml}</div>` : ""}
              ${catalogOverviewHtml}
            </div>
          </div>
          <div class="learning-panel-catalog-layout">
            <div class="learning-panel-catalog-main">
              <div class="learning-panel-catalog-panel-head">
                <div class="detail-title">目录</div>
                <div class="catalog-head-tools">
                  <span class="catalog-recommendation-status" id="catalogRecommendationStatus">推荐阅读加载中...</span>
                  <button class="catalog-recommendation-refresh" id="generateLearningPathBtn" type="button" data-force="1" data-lecture-id="${escapeHtml(state.selectedLectureId || "")}" data-book-id="${escapeHtml(ctx.bookId || "")}" title="刷新推荐阅读" aria-label="刷新推荐阅读"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
                </div>
              </div>

              <div class="learning-panel-catalog-scroll">
                <section class="learning-panel-catalog-group">
                  <div class="materials-catalog-list learning-panel-catalog-list">
                  ${isLoading ? '<div class="materials-loading">目录加载中...</div>' : (chapters.length ? chapters.map((item, idx) => {
                    const catalogCompleted = isCatalogChapterCompleted(state.selectedLectureId || "", ctx.bookId || "", idx);
                    const catalogCompletedClass = catalogCompleted ? " is-catalog-completed catalog-status-completed" : "";
                    const catalogCompletedMarker = catalogCompleted ? renderCatalogCompletedBadge() : "";
                    return `
                    <button class="materials-catalog-item${catalogCompletedClass}" type="button" data-material-catalog-index="${idx}" data-catalog-title="${escapeHtml(normalizeCatalogRecommendationName(item.title || `章节 ${idx + 1}`))}" data-catalog-completed="${catalogCompleted ? "1" : "0"}">
                      <span class="materials-catalog-index">${idx + 1}.</span>
                      <span class="materials-catalog-main">
                        <span class="materials-catalog-text">${escapeHtml(item.title || `章节 ${idx + 1}`)}</span>
                        <span class="catalog-recommendation-inline">${catalogCompletedMarker}</span>
                      </span>
                    </button>
                  `;
                  }).join("") : '<div class="materials-empty">暂无目录</div>')}
                  </div>
                </section>
              </div>
            </div>

            <aside class="learning-panel-catalog-media">
              <div class="learning-panel-catalog-panel-head">
                <div class="detail-title">推荐视频</div>
                <button class="lp-video-refresh" id="refreshVideosBtn" type="button" title="刷新视频" aria-label="刷新视频"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
              </div>
              <div class="lp-video-container" id="videoPanelContainer" data-lecture-id="${escapeHtml(state.selectedLectureId || "")}" data-book-id="${escapeHtml(ctx.bookId || "")}">
                <div class="materials-loading">加载视频...</div>
              </div>
            </aside>
          </div>
        </section>
      `;

      // 初始化视频面板
      const lid = state.selectedLectureId || "";
      const bid = ctx.bookId || "";
      loadVideos(lid, bid);
      const refreshBtn = document.getElementById("refreshVideosBtn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
          const vc = document.getElementById("videoPanelContainer");
          if (vc) vc.innerHTML = '<div class="lp-video-loading">正在搜索视频（模型分析中）...</div>';
          try {
            const data = await fetchJson("/api/frontend/videos/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lecture_id: lid, book_id: bid }),
            });
            if (data.success && Array.isArray(data.items)) {
              renderVideoList(document.getElementById("videoPanelContainer"), data.items, false);
            } else {
              vc.innerHTML = '<div class="lp-video-empty">暂无相关视频</div>';
            }
          } catch (_err) {
            vc.innerHTML = '<div class="lp-video-empty">刷新失败</div>';
          }
        });
      }

      // 初始化推荐阅读：接口返回后直接融合进目录条目。
      const catalogList = document.querySelector(".learning-panel-catalog-list");
      if (catalogList && chapters.length && !isLoading) {
        const learningPathCacheKey = getLearningPathCacheKey(lid, bid);
        if (learningPathCacheKey && state.learningPathCache[learningPathCacheKey]) {
          renderLearningPath(catalogList, state.learningPathCache[learningPathCacheKey], lid, bid);
        } else {
          void generateLearningPath(lid, bid, false);
        }
      } else {
        setCatalogRecommendationStatus(chapters.length ? "目录加载中" : "暂无目录");
      }
      return;
    }

    const row = getSelectedLectureRow();
    if (!row) {
      detailPane.innerHTML = '<div class="materials-empty">请选择课程</div>';
      return;
    }

    const lecture = row.lecture || {};
    const lectureId = String(lecture.id || "");
    const isLearning = state.selectedLearningLectureIds.includes(lectureId);
    const books = Array.isArray(row.books) ? row.books : [];
    const progressTrail = getLectureProgressTrail(lecture, books);

    if (!state.selectedBookId && books.length) {
      state.selectedBookId = String(books[0].id || "");
    }

    const toggleBtnClass = isLearning ? "btn btn-outline-danger btn-sm" : "btn btn-outline-secondary btn-sm";
    const toggleBtnTitle = isLearning ? "退课" : "主动学习";
    const toggleBtnText = toggleBtnTitle;
    const learningPillClass = isLearning ? "learning-state-pill is-on" : "learning-state-pill is-off";
    const learningPillText = isLearning ? "学习中" : "未加入";
    const progressPercent = Math.max(0, Math.min(100, Number(progressTrail.progress) || 0));
    const progressText = [progressTrail.bookTitle, progressTrail.chapterTitle, progressTrail.sessionTitle]
      .filter((part) => String(part || "").trim())
      .join(" · ");
    const lectureDescription = escapeHtml(String(lecture.description || "暂无描述"));
    const lectureTeachers = renderLectureTeacherTags(lecture);
    const lectureCoverHtml = renderLearningPanelCover(getLectureCoverPath(lecture), getLectureTitle(lecture));
    const lectureInfoRows = [
      ["课程分类", lecture.category || "未分类"],
      ["教材数量", `${books.length} 本`],
      ["学习状态", isLearning ? "学习中" : "未加入学习"],
    ];
    const lectureInfoPanelHtml = `
      <aside class="learning-panel-info-column learning-panel-hero-info-column">
        <div class="learning-panel-progress">
          <div class="learning-panel-progress-top">
            <div class="detail-description-label learning-panel-copy-label">当前推进</div>
            <div class="learning-panel-progress-percent">${escapeHtml(String(progressPercent))}%</div>
          </div>
          <div class="learning-panel-progress-text" title="${escapeHtml(progressText)}">${escapeHtml(progressText || "暂无推进信息")}</div>
          <div class="nxl-course-bar learning-panel-progress-bar"><div class="nxl-course-bar-fill" style="width:${progressPercent}%"></div></div>
        </div>

        <div class="learning-panel-info-card">
          <div class="detail-description-label learning-panel-copy-label">学习信息</div>
          <div class="learning-panel-info-list">
            ${lectureInfoRows.map(([label, value]) => `
              <div class="learning-panel-info-row">
                <span class="learning-panel-info-label">${escapeHtml(label)}</span>
                <span class="learning-panel-info-value">${escapeHtml(String(value || ""))}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="learning-panel-info-card">
          <div class="detail-description-label learning-panel-copy-label">课程操作</div>
          <div class="learning-panel-action-toolbar">
            <button class="${toggleBtnClass}" data-action="toggle-learning" data-lecture-id="${escapeHtml(lectureId)}" aria-label="${toggleBtnTitle}" title="${toggleBtnTitle}">${toggleBtnText}</button>
            ${isLearning ? `<button class="btn btn-outline-secondary btn-sm" data-action="start-learning-path" data-lecture-id="${escapeHtml(lectureId)}" aria-label="开始学习" title="开始学习">开始学习</button>` : ""}
          </div>
        </div>

        <!-- 教师信息（已隐藏，保留后端逻辑）
        <div class="learning-panel-info-card">
          <div class="detail-description-label learning-panel-copy-label">教师信息${state.isAdmin ? ` <button class="learning-panel-inline-edit-btn" type="button" data-action="edit-teacher" title="编辑教师" aria-label="编辑教师"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ""}</div>
          <div class="learning-panel-teacher-list learning-panel-teacher-list-compact">
            ${lectureTeachers}
          </div>
        </div>
        -->
      </aside>
    `;

    // Tab 状态
    const activeTab = resolveCourseHomeTab(state.courseHomeTab || "books");
    const compactLayout = isCourseHomeCompactLayout();
    const tabDefs = [
      { key: "books", label: "教材列表" },
      { key: "outline", label: "学习大纲" },
      { key: "mindmap", label: "思维导图" },
      { key: "report", label: "学习报告" },
    ];
    if (compactLayout) {
      tabDefs.splice(1, 0, { key: "videos", label: "推荐视频" });
    }
    const tabBarHtml = `<div class="course-home-tab-bar">
      ${tabDefs.map((t) => `<button class="course-home-tab${t.key === activeTab ? " is-active" : ""}" data-tab="${t.key}" type="button">${t.label}</button>`).join("")}
    </div>`;

    // 整体写入：Hero + Tab 栏 + 单个激活的 Tab pane（无 display:none 残留）
    detailPane.innerHTML = `
      <section class="materials-detail-scroll learning-panel-page">
        <section class="detail-section learning-panel-section learning-panel-hero">
          <div class="learning-panel-section-body">
            <div class="learning-panel-hero-body">
              ${lectureCoverHtml}
              <div class="learning-panel-hero-content">
                <div class="learning-panel-title-row">
                  <div class="detail-title learning-panel-hero-title">${escapeHtml(getLectureTitle(lecture))}</div>
                  <span class="${learningPillClass}">${learningPillText}</span>
                </div>

                <div class="learning-panel-summary-grid">
                  <div class="learning-panel-copy learning-panel-summary-copy">
                    <div class="detail-description-label learning-panel-copy-label">课程简介</div>
                    <div class="detail-description-text learning-panel-summary-text">${lectureDescription}</div>
                  </div>
                </div>
              </div>
              ${lectureInfoPanelHtml}
            </div>
          </div>
        </section>

        ${tabBarHtml}

        <div class="course-home-tab-content">
          ${renderCourseHomePaneHtml(activeTab, lectureId, books)}
        </div>
      </section>
    `;

    activateCourseHomeTab(activeTab, lectureId);
  }

  async function fetchBookTextFull() {


    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/text`);
      state.readerImages = Array.isArray(data.images) ? data.images.slice() : [];
      return String(data.content || "");
    } catch (_err) {
      state.readerImages = [];
      return "";
    }
  }

  async function fetchChapterText(chapterIndex) {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/chapter/${chapterIndex}`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function loadChapterContent(chapterIndex, scrollToOffset, guideOptions) {
    const requestToken = state.readerRequestToken;
    showChapterLoading(chapterIndex);
    const content = await fetchChapterText(chapterIndex);
    if (requestToken !== state.readerRequestToken) return;
    // 缓存章节内容
    if (!state.readerChapterCache) state.readerChapterCache = {};
    state.readerChapterCache[chapterIndex] = content;
    // 如果是第一次加载，设置完整文本（用于兼容旧逻辑）
    if (!state.readerFullTextRaw) {
      state.readerFullTextRaw = content;
    }
    renderChapterContent(chapterIndex, content, scrollToOffset, guideOptions);
  }

  function showChapterLoading(chapterIndex) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const chapter = chapters[chapterIndex];
    const title = chapter ? (chapter.title || `第 ${chapterIndex + 1} 章`) : "加载中";
    el.readerContent.innerHTML = `
      <div class="materials-preview-text">
        <div class="chapter-header text-center mb-4">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <div class="chapter-loading">
          <div class="chapter-loading-spinner"></div>
          <div class="chapter-loading-text">加载文本中...</div>
        </div>
      </div>
    `;
  }

  function renderChapterContent(chapterIndex, content, scrollToOffset, guideOptions) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const idx = Math.max(0, Math.min(chapters.length - 1, chapterIndex));
    state.readerActiveChapterIndex = idx;
    const chapter = chapters[idx];
    const prevDisabled = idx <= 0 ? "disabled" : "";
    const nextDisabled = idx >= chapters.length - 1 ? "disabled" : "";
    el.readerContent.innerHTML = `
      <div class="materials-preview-text">
        <div class="chapter-header text-center mb-4">
          <h2>${escapeHtml(chapter ? (chapter.title || `第 ${idx + 1} 章`) : "")}</h2>
        </div>
        <div class="chapter-body">${formatReaderText(content || "")}</div>
        <div class="chapter-navigation mt-5 d-flex justify-content-between">
          <button class="btn btn-outline-secondary btn-sm" data-reader-nav="prev" ${prevDisabled}>上一章</button>
          <button class="btn btn-outline-secondary btn-sm" data-reader-nav="next" ${nextDisabled}>下一章</button>
        </div>
      </div>
    `;
    markChapterVisited(idx);
    renderChapterList();
    syncReaderSettingsPanel();
    applyReaderTypography();
    syncReaderTelemetrySessionContext("chapter_render");
    scheduleHostReaderContextSync(0);
    renderChapterAnnotations(idx);
    applyReaderGuidePatches();
    scheduleReaderGuidePrompt(idx, content, guideOptions);
    // 滚动到指定偏移量（如果有）
    if (scrollToOffset !== undefined && scrollToOffset !== null) {
      const chapterStart = chapter ? chapter.start : 0;
      scrollToChapterOffset(chapterStart, scrollToOffset);
    }
  }

// ─────── Reader: Chapter Parsing & Text Layout ────────────────────────
  function renderReaderPlaceholder(msg) {
    el.readerContent.innerHTML = `<div class="materials-empty">${escapeHtml(msg || "阅读内容加载中")}</div>`;
  }

  async function fetchBookInfoXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/bookinfo`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchSectionsXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/sections`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchAnnotationsXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/annotations`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchBookSummary() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return { summary_brief: "", summary_detail: "" };
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return { summary_brief: "", summary_detail: "" };
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/summary`);
      return {
        summary_brief: String(data.summary_brief || ""),
        summary_detail: String(data.summary_detail || ""),
      };
    } catch (_err) {
      return { summary_brief: "", summary_detail: "" };
    }
  }

  function parseAnnotationsXml(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return [];
    const annotations = [];
    const reg = /<annotation>\s*([\s\S]*?)\s*<\/annotation>/gi;
    let match = null;
    while ((match = reg.exec(src)) !== null) {
      const block = String(match[1] || "");
      const chapterMatch = block.match(/<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>/i);
      const offsetMatch = block.match(/<offset>\s*([\s\S]*?)\s*<\/offset>/i);
      const lengthMatch = block.match(/<length>\s*([\s\S]*?)\s*<\/length>/i);
      const typeMatch = block.match(/<annotation_type>\s*([\s\S]*?)\s*<\/annotation_type>/i);
      const contentMatch = block.match(/<annotation_content>\s*([\s\S]*?)\s*<\/annotation_content>/i);
      const anchorMatch = block.match(/<anchor_text>\s*([\s\S]*?)\s*<\/anchor_text>/i);
      if (!chapterMatch || !offsetMatch) continue;
      annotations.push({
        chapterName: String(chapterMatch[1] || "").trim(),
        offset: Number(String(offsetMatch[1] || "0").trim()) || 0,
        length: lengthMatch ? (Number(String(lengthMatch[1] || "0").trim()) || 0) : 0,
        type: typeMatch ? String(typeMatch[1] || "思考点").trim() : "思考点",
        content: contentMatch ? String(contentMatch[1] || "").trim() : "",
        anchorText: anchorMatch ? String(anchorMatch[1] || "").trim() : "",
      });
    }
    return annotations;
  }

  function normalizeChapterNameForCompare(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[【】\[\]（）()《》<>「」『』"'“”‘’`~!@#$%^&*+=|\\/:;,.?！？、。·\-—_]/g, "");
  }

  function renderChapterAnnotations(chapterIndex) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    const chapterName = String(chapter.title || "").trim();
    const chapterStart = Number(chapter.start) || 0;
    const chapterEnd = Math.max(chapterStart, Number(chapter.end) || chapterStart);
    const chapterRawLength = Math.max(1, chapterEnd - chapterStart);
    const chapterNameNorm = normalizeChapterNameForCompare(chapterName);
    const chapterAnnotations = (state.readerAnnotations || []).filter(a => {
      const annName = String(a && a.chapterName || "").trim();
      if (!annName) return false;
      if (annName === chapterName) return true;
      return normalizeChapterNameForCompare(annName) === chapterNameNorm;
    });
    if (!chapterAnnotations.length) return;

    const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return;

    const paragraphs = chapterBody.querySelectorAll("p.materials-preview-paragraph");
    if (!paragraphs.length) return;

    const paragraphRows = Array.from(paragraphs).map((p) => ({
      el: p,
      text: String(p.textContent || ""),
      length: String(p.textContent || "").length + 1,
    }));
    const visibleTotalLength = Math.max(1, paragraphRows.reduce((sum, row) => sum + row.length, 0));

    const annotationToParagraph = new Map();
    let currentOffset = chapterStart;
    paragraphRows.forEach((row, paragraphIndex) => {
      const pLength = row.length;
      const pStart = currentOffset;
      const pEnd = currentOffset + pLength;

      // Strict offset match (absolute offset in same coordinate system)
      const pAnnotations = chapterAnnotations.filter((a) => {
        return a.offset >= pStart && a.offset < pEnd;
      });

      if (pAnnotations.length > 0) {
        row.el.classList.add("has-annotation");
        pAnnotations.forEach((annotation) => {
          annotationToParagraph.set(annotation, paragraphIndex);
          const marker = createAnnotationMarker(annotation);
          row.el.appendChild(marker);
        });
      }

      currentOffset = pEnd;
    });

    // Fallback path: when strict mapping misses, try anchor_text, then relative offset mapping.
    const unmatched = chapterAnnotations.filter((a) => !annotationToParagraph.has(a));
    if (unmatched.length > 0) {
      unmatched.forEach((annotation) => {
        let targetIndex = -1;
        const anchor = String(annotation.anchorText || "").trim();
        if (anchor) {
          const anchorNorm = anchor.replace(/\s+/g, "");
          targetIndex = paragraphRows.findIndex((row) => row.text.replace(/\s+/g, "").includes(anchorNorm));
        }
        if (targetIndex < 0) {
          const rel = (Number(annotation.offset) - chapterStart) / chapterRawLength;
          const safeRel = Math.max(0, Math.min(1, Number.isFinite(rel) ? rel : 0));
          const targetVisiblePos = safeRel * visibleTotalLength;
          let cursor = 0;
          for (let i = 0; i < paragraphRows.length; i += 1) {
            cursor += paragraphRows[i].length;
            if (cursor >= targetVisiblePos) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex < 0) targetIndex = paragraphRows.length - 1;
        }
        if (targetIndex < 0 || !paragraphRows[targetIndex]) return;
        const target = paragraphRows[targetIndex].el;
        target.classList.add("has-annotation");
        const marker = createAnnotationMarker(annotation);
        target.appendChild(marker);
        annotationToParagraph.set(annotation, targetIndex);
      });
    }

    try {
      console.log("[Reader] annotation render", {
        chapter: chapterName,
        chapterStart,
        chapterEnd,
        annotations: chapterAnnotations.length,
        strictMatched: chapterAnnotations.length - unmatched.length,
        fallbackMatched: unmatched.length,
      });
    } catch (_err) {}
  }

// ─────── Reader: Annotation Markers & Bubbles ─────────────────────────
  function createAnnotationMarker(annotation) {
    var marker = document.createElement("span");
    marker.className = "annotation-marker";
    marker.setAttribute("data-note-type", annotation.type);
    marker.setAttribute("data-anchor-text", annotation.anchorText || "");
    marker.setAttribute("data-offset", String(Number(annotation.offset) || 0));
    marker.setAttribute("data-length", String(Number(annotation.length) || 0));
    marker.addEventListener("mouseenter", _annotationMarkerEnter);
    marker.addEventListener("mouseleave", _annotationMarkerLeave);

    var dot = document.createElement("span");
    dot.className = "annotation-dot";

    var bubble = document.createElement("span");
    bubble.className = "annotation-bubble";

    var typeSpan = document.createElement("span");
    typeSpan.className = "annotation-bubble-type";
    typeSpan.textContent = annotation.type;

    var contentSpan = document.createElement("span");
    contentSpan.className = "annotation-bubble-content";
    contentSpan.textContent = annotation.content;

    var actionRow = document.createElement("span");
    actionRow.className = "annotation-bubble-action";

    var askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "annotation-ask-btn";
    askBtn.textContent = "💡 解释这段";
    askBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      _annotationAskClick(annotation.anchorText || "", annotation.content || "");
    });

    actionRow.appendChild(askBtn);
    bubble.appendChild(typeSpan);
    bubble.appendChild(contentSpan);
    bubble.appendChild(actionRow);
    bubble.addEventListener("mouseenter", _annotationBubbleEnter);
    bubble.addEventListener("mouseleave", _annotationBubbleLeave);
    marker.appendChild(dot);
    marker.appendChild(bubble);

    return marker;
  }

// ─────── Reader: Sections & Chapter Parsing ───────────────────────────
  function parseSectionsXml(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return {};
    const result = {};
    const chapterReg = /<chapter_sessions>\s*([\s\S]*?)\s*<\/chapter_sessions>/gi;
    let chapterMatch = null;
    while ((chapterMatch = chapterReg.exec(src)) !== null) {
      const chapterBlock = String(chapterMatch[1] || "");
      const chapterNameMatch = chapterBlock.match(/<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>/i);
      const chapterRangeMatch = chapterBlock.match(/<chapter_range>\s*([\s\S]*?)\s*<\/chapter_range>/i);
      if (!chapterNameMatch || !chapterRangeMatch) continue;
      const chapterName = String(chapterNameMatch[1] || "").trim();
      const chapterRange = String(chapterRangeMatch[1] || "").trim();
      const sessions = [];
      const sessionReg = /<session_item>\s*([\s\S]*?)\s*<\/session_item>/gi;
      let sessionMatch = null;
      while ((sessionMatch = sessionReg.exec(chapterBlock)) !== null) {
        const sessionBlock = String(sessionMatch[1] || "");
        const nameMatch = sessionBlock.match(/<session_name>\s*([\s\S]*?)\s*<\/session_name>/i);
        const rangeMatch = sessionBlock.match(/<session_range>\s*([\s\S]*?)\s*<\/session_range>/i);
        const summaryMatch = sessionBlock.match(/<session_summary>\s*([\s\S]*?)\s*<\/session_summary>/i);
        if (!nameMatch || !rangeMatch) continue;
        sessions.push({
          name: String(nameMatch[1] || "").trim(),
          range: String(rangeMatch[1] || "").trim(),
          summary: summaryMatch ? String(summaryMatch[1] || "").trim() : ""
        });
      }
      result[chapterName] = { range: chapterRange, sessions };
    }
    return result;
  }

  function notifyHostLayout(mode, extra) {
    const payload = Object.assign(
      {
        source: "nexora-learning",
        type: "nexora:layout:request",
        mode: String(mode || "default").trim().toLowerCase() === "immersive" ? "immersive" : "default",
      },
      (extra && typeof extra === "object") ? extra : {},
    );
    try {
      window.dispatchEvent(new CustomEvent("nexora:layout:request", { detail: payload }));
    } catch (_err) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (_err) {}
  }

  function parseBookInfoChapters(xmlText, fullTextLength) {
    const src = String(xmlText || "");
    if (!src.trim()) return [];
    const entries = [];
    const reg = /<chapter_name>([\s\S]*?)<\/chapter_name>[\s\S]*?<chapter_range>([\s\S]*?)<\/chapter_range>/gi;
    let m = null;
    while ((m = reg.exec(src)) !== null) {
      const name = String(m[1] || "").trim();
      const range = String(m[2] || "").trim();
      const nums = range.split(":").map((x) => Number(String(x || "").trim()));
      if (!name || nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) continue;
      const start = Math.max(0, Math.floor(nums[0]));
      // backend chapter_range uses START:LENGTH, not START:END
      const length = Math.max(0, Math.floor(nums[1]));
      const end = Math.min(fullTextLength, start + length);
      entries.push({ title: name, start, end: Math.max(start, end) });
    }
    entries.sort((a, b) => a.start - b.start);
    return entries;
  }

  function parseBookInfoRoughContent(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return "";
    const blocks = [];
    const reg = /<chapter_name>([\s\S]*?)<\/chapter_name>[\s\S]*?<chapter_summary>([\s\S]*?)<\/chapter_summary>/gi;
    let m = null;
    while ((m = reg.exec(src)) !== null) {
      const name = String(m[1] || "").trim();
      const summary = String(m[2] || "").trim();
      if (!name || !summary) continue;
      blocks.push(
        "<div class=\"learning-panel-rough-chapter\">" +
        "<div class=\"learning-panel-rough-chapter-title\">" + escapeHtml(name) + "</div>" +
        "<div class=\"learning-panel-rough-chapter-text\">" + escapeHtml(summary) + "</div>" +
        "</div>"
      );
    }
    return blocks.join("");
  }

  // Session 进度管理
  const SESSION_STORAGE_KEY = "nxl_reader_session_v1";

// ─────── Reader: Session Progress & Completion ────────────────────────
  function getSessionKey() {
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    if (!lectureId || !bookId) return "";
    return `${lectureId}::${bookId}`;
  }

  function loadSessionProgress() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach(key => {
          const entry = parsed[key];
          if (entry && Array.isArray(entry.completedIndices)) {
            state.readerSessionProgress[key] = {
              completedIndices: new Set(entry.completedIndices),
              completedSessions: new Set(entry.completedSessions || []),
              reportedChapterKeys: new Set(entry.reportedChapterKeys || []),
              currentChapterIndex: Number(entry.currentChapterIndex) || 0
            };
          }
        });
      }
    } catch (_) {}
  }

  function saveSessionProgress() {
    try {
      const toSave = {};
      Object.keys(state.readerSessionProgress).forEach(key => {
        const entry = state.readerSessionProgress[key];
        if (entry) {
          toSave[key] = {
            completedIndices: Array.from(entry.completedIndices || []),
            completedSessions: Array.from(entry.completedSessions || []),
            reportedChapterKeys: Array.from(entry.reportedChapterKeys || []),
            currentChapterIndex: entry.currentChapterIndex || 0
          };
        }
      });
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  function markChapterVisited(chapterIndex) {
    const key = getSessionKey();
    if (!key) return;
    if (!state.readerSessionProgress[key]) {
      state.readerSessionProgress[key] = {
        completedIndices: new Set(),
        completedSessions: new Set(),
        reportedChapterKeys: new Set(),
        currentChapterIndex: 0
      };
    }
    const session = state.readerSessionProgress[key];
    session.currentChapterIndex = chapterIndex;
    saveSessionProgress();
  }

  function ensureReaderSessionProgress() {
    const key = getSessionKey();
    if (!key) return null;
    if (!state.readerSessionProgress[key]) {
      state.readerSessionProgress[key] = {
        completedIndices: new Set(),
        completedSessions: new Set(),
        reportedChapterKeys: new Set(),
        currentChapterIndex: 0
      };
    }
    if (!(state.readerSessionProgress[key].reportedChapterKeys instanceof Set)) {
      state.readerSessionProgress[key].reportedChapterKeys = new Set();
    }
    return state.readerSessionProgress[key];
  }

  function getChapterCompleteReportKey(lectureId, bookId, chapterIndex, chapterName, chapterRange) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    const name = String(chapterName || "").trim();
    const range = String(chapterRange || "").trim();
    if (!lid || !bid || !name || !range) return "";
    return `${lid}::${bid}::${Number(chapterIndex) || 0}::${name}::${range}`;
  }

  function hasChapterCompleteReport(reportKey) {
    if (!reportKey) return false;
    const key = getSessionKey();
    if (!key) return false;
    const progress = state.readerSessionProgress[key];
    if (!progress || !(progress.reportedChapterKeys instanceof Set)) return false;
    return progress.reportedChapterKeys.has(reportKey);
  }

  function markChapterCompleteReport(reportKey, chapterIndex) {
    if (!reportKey) return;
    const progress = ensureReaderSessionProgress();
    if (!progress) return;
    if (!(progress.reportedChapterKeys instanceof Set)) {
      progress.reportedChapterKeys = new Set();
    }
    progress.reportedChapterKeys.add(reportKey);
    progress.completedIndices.add(Number(chapterIndex) || 0);
    progress.currentChapterIndex = Number(chapterIndex) || 0;
    saveSessionProgress();
  }

  function clearChapterCompleteReportsForIndex(lectureId, bookId, chapterIndex) {
    const key = `${String(lectureId || "").trim()}::${String(bookId || "").trim()}`;
    const progress = state.readerSessionProgress[key];
    if (!progress || !(progress.reportedChapterKeys instanceof Set)) return;

    const prefix = `${key}::${Number(chapterIndex) || 0}::`;
    Array.from(progress.reportedChapterKeys).forEach((item) => {
      if (String(item || "").startsWith(prefix)) {
        progress.reportedChapterKeys.delete(item);
      }
    });
  }

  function checkSessionProgressByScroll() {
    if (!state.isReaderOpen || !state.readerChapters.length) return;
    const chapterIndex = state.readerActiveChapterIndex;
    const chapters = state.readerChapters;
    const chapter = chapters[chapterIndex];
    if (!chapter) return;

    const chapterName = String(chapter.title || "").trim();
    const scrollContainer = getReaderScrollContainer();
    const chapterBody = scrollContainer ? scrollContainer.querySelector(".chapter-body") : null;
    if (!chapterBody) return;
    
    const scrollTop     = Number(scrollContainer.scrollTop || 0);
    const clientHeight  = Number(scrollContainer.clientHeight || 0);
    const scrollHeight  = Number(scrollContainer.scrollHeight || 0);
    const minScrollable = Math.max(1, scrollHeight - clientHeight);   // 至少为1，避免除零
    const atBottom      = scrollTop >= minScrollable - 2;              // 滚到底或内容不超出均视为底
    const chapterLength = Math.max(1, Number(chapter.end || 0) - Number(chapter.start || 0));

    if (atBottom) {
      reportReaderChapterComplete(chapterIndex).catch((err) => {
        console.warn("[NXL-Reader] chapter complete by scroll failed", err);
      });
    }

    const sectionData = state.readerSectionsData[chapterName];

    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions.length) {
      syncReaderTelemetrySessionContext("scroll");
      return;
    }

    //:
    // ・内容超出容器: scrollTop / minScrollable 映射到 0 → chapterLength
    // ・内容不超出：直接视作已读完整章（所有 session 立即标记完成）
    //:
    const scrollPercent     = atBottom ? 1.0 : (scrollTop / minScrollable);
    let currentRelativeEnd  = Math.floor(chapterLength * scrollPercent);
    if (atBottom) currentRelativeEnd = chapterLength;   // 兜底，确保浮点精度不上浮
    
    let changed = false;
    let lastCompletedSession = null;
    const progress = ensureReaderSessionProgress();
    if (!progress || !progress.completedSessions) return;
    
    sectionData.sessions.forEach((s, sIdx) => {
      const sessionKey = `${chapterIndex}:${sIdx}`;
      if (progress.completedSessions.has(sessionKey)) return;
      
      const parsedRange = parseReaderSessionRange(chapter, s.range);
      if (!parsedRange) return;
      
      if (currentRelativeEnd >= parsedRange.endRelative) {
        progress.completedSessions.add(sessionKey);
        reportSessionComplete(chapterIndex, sIdx).catch(() => {});
        changed = true;
        // 记录最新完成的session
        lastCompletedSession = { index: sIdx, ...s };
      }
    });
    
    if (changed) {
      saveSessionProgress();
      renderChapterList();
      // Auto-open floating panel and generate quiz when session completed by scroll
      if (lastCompletedSession && floatingPanelState.activeTab === "quiz" && typeof generateSessionQuiz === "function") {
        generateSessionQuiz(
          chapterIndex,
          lastCompletedSession.index,
          chapterName,
          lastCompletedSession.name || "",
          lastCompletedSession.range || ""
        );
      }
    }
    syncReaderTelemetrySessionContext("scroll");
  }

  function isChapterCompleted(chapterIndex) {
    const key = getSessionKey();
    if (!key) return false;
    const session = state.readerSessionProgress[key];
    if (!session) return false;
    return session.completedIndices.has(chapterIndex);
  }

  function getCurrentSessionChapterIndex() {
    const key = getSessionKey();
    if (!key) return 0;
    const session = state.readerSessionProgress[key];
    return session ? session.currentChapterIndex : 0;
  }

  // 初始化时加载 session
  loadSessionProgress();

// ─────── Reader: Chapter List Rendering ───────────────────────────────
  function renderChapterList() {
    if (!el.chapterListContent) return;
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) {
      el.chapterListContent.innerHTML = '<div class="materials-empty">暂无目录</div>';
      return;
    }
    el.chapterListContent.innerHTML = chapters.map((item, idx) => {
      const active = idx === state.readerActiveChapterIndex ? "current" : "";
      const completed = isChapterCompleted(idx);
      
      // 获取该章节的小节数据
      const chapterName = String(item.title || "").trim();
      const sectionData = state.readerSectionsData[chapterName];
      let sessionsHtml = "";
      if (sectionData && Array.isArray(sectionData.sessions) && sectionData.sessions.length > 0) {
        sessionsHtml = `<div class="chapter-sessions">${sectionData.sessions.map((session, sIdx) => {
          const sessionCompleted = isSessionCompleted(idx, sIdx);
          const sessionDotClass = sessionCompleted ? "session-dot completed" : "session-dot pending";
          const sessionDotTitle = sessionCompleted ? "已学习" : "未学习";
          return `<div class="session-item" data-chapter-index="${idx}" data-session-index="${sIdx}" data-session-range="${escapeHtml(session.range || '')}">
            <span class="session-item-name">${escapeHtml(session.name)}</span>
            <span class="${sessionDotClass}" title="${sessionDotTitle}"></span>
          </div>`;
        }).join("")}</div>`;
      }
      
      return `<div class="chapter-item-wrapper">
        <div class="chapter-item ${active}" data-reader-chapter-index="${idx}">
          <span class="chapter-item-title">${escapeHtml(item.title)}</span>
        </div>
        ${sessionsHtml}
      </div>`;
    }).join("");
  }

  function isSessionCompleted(chapterIndex, sessionIndex) {
    const key = getSessionKey();
    if (!key) return false;
    const session = state.readerSessionProgress[key];
    if (!session) return false;
    const sessionKey = `${chapterIndex}:${sessionIndex}`;
    return session.completedSessions && session.completedSessions.has(sessionKey);
  }

  function markSessionVisited(chapterIndex, sessionIndex) {
    const key = getSessionKey();
    if (!key) return;
    // 本函数只用于导航（点击目录跳到当前 session），不做“完成”标记。
    // scroll-based completion 会在滚动到达 session 末尾时自动触发完成。
  }

  async function reportSessionComplete(chapterIndex, sessionIndex) {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return;
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return;
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    const chapterName = String(chapter.title || "").trim();
    if (!chapterName) return;
    const sectionData = state.readerSectionsData[chapterName];
    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions[sessionIndex]) return;
    const s = sectionData.sessions[sessionIndex];
    const sessionName = String(s.name || "").trim();
    const sessionRange = String(s.range || "").trim();
    if (!sessionName) return;
    emitTelemetry("reader_session_complete", {
      lecture_id: lectureId,
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: Number(chapterIndex) || 0,
      chapter_title: chapterName,
      session_index: Number(sessionIndex) || 0,
      session_name: sessionName,
      session_range: sessionRange,
    });
    try {
      await fetchJson("/api/frontend/learning/session-complete", {
        method: "POST",
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: lectureId,
          book_id: String(state.selectedBookId),
          chapter_name: chapterName,
          chapter_index: Number(chapterIndex) || 0,
          session_name: sessionName,
          session_index: Number(sessionIndex) || 0,
          session_range: sessionRange,
        }),
      });
    } catch (_) {}
  }

// ─────── Reader: Context Menu & Selection ─────────────────────────────
  function scheduleHostReaderContextSync(delay = 120) {
    if (readerContextSyncTimer) {
      clearTimeout(readerContextSyncTimer);
      readerContextSyncTimer = null;
    }
    readerContextSyncTimer = setTimeout(() => {
      readerContextSyncTimer = null;
      notifyHostReaderContext();
    }, Math.max(0, Number(delay) || 0));
  }

  function buildReaderSelectionSourceMeta(textForAnchor = "") {
    const chapterMeta = getReaderCurrentChapterMeta();
    const sourceTitle = [
      String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      chapterMeta.chapterTitle || "",
    ].filter(Boolean).join(" / ");
    return {
      source: "Learning Reader",
      sourceTitle,
      reader_title: String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      chapter_title: chapterMeta.chapterTitle || "",
      chapter_index: chapterMeta.chapterIndex,
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      snippet: normalizeReaderSelectionText(textForAnchor, 280),
    };
  }

  function hideHostReaderSelectionContextMenu() {
    emitHostPayload("nexora:reader:selection-context-menu-hide", {});
  }

  function handleReaderContextMenu(event) {
    if (!state.isReaderOpen) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const text = normalizeReaderSelectionText(sel.toString(), 1600);
    if (!text) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const anchorNode = sel.anchorNode || sel.focusNode;
    const anchorElement = anchorNode && anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
    if (!anchorElement || !el.readerContent || !el.readerContent.contains(anchorElement)) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    event.preventDefault();
    const hostPoint = getReaderHostPointer(event.clientX, event.clientY);
    const chapterMeta = getReaderCurrentChapterMeta();
    emitTelemetry("reader_selection_contextmenu", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      text_length: text.length,
      pointer_x: hostPoint.x,
      pointer_y: hostPoint.y,
    });
    emitHostPayload("nexora:reader:selection-context-menu", {
      x: hostPoint.x,
      y: hostPoint.y,
      text,
      source_meta: buildReaderSelectionSourceMeta(text),
    });
  }

// ─────── Reader: Chapter Navigation ───────────────────────────────────
  function openReaderChapter(index, scrollToOffset, guideOptions) {
    resetReaderSelectionTelemetry();
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) {
      el.readerContent.innerHTML = `<div class="materials-preview-text">${formatReaderText(state.readerFullTextRaw || "")}</div>`;
      syncReaderSettingsPanel();
      applyReaderTypography();
      return;
    }
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    state.readerActiveChapterIndex = idx;

    // 检查缓存中是否有该章节内容
    if (state.readerChapterCache && state.readerChapterCache[idx]) {
      renderChapterContent(idx, state.readerChapterCache[idx], scrollToOffset, guideOptions);
    } else {
      // 按需加载章节内容
      loadChapterContent(idx, scrollToOffset, guideOptions);
    }
  }

  function scrollToChapterOffset(chapterStart, sessionAbsoluteOffset) {
    requestAnimationFrame(() => {
      const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
      if (!chapterBody) return;
      const paragraphs = chapterBody.querySelectorAll("p");
      if (!paragraphs.length) return;
      // 计算session在章节内的相对位置（session绝对偏移 - 章节起始偏移）
      const relativeOffset = Math.max(0, Number(sessionAbsoluteOffset) - Number(chapterStart));
      let accumulatedLength = 0;
      let targetParagraph = null;
      for (const p of paragraphs) {
        const pText = p.textContent || "";
        accumulatedLength += pText.length + 1; // +1 for newline
        if (accumulatedLength >= relativeOffset) {
          targetParagraph = p;
          break;
        }
      }
      if (!targetParagraph) targetParagraph = paragraphs[0];
      targetParagraph.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // 批注气泡定位与显示控制
  var _annotationHideTimer = null;
  var _activeAnnotationMarker = null;
  var _annotationDwellTimer = null;
  var _annotationDwellEnterAt = 0;
  var ANNOTATION_DWELL_THRESHOLD_MS = 3000;

// ─────── Reader: Annotation Bubble Logic ──────────────────────────────
  function _showAnnotationBubble(marker) {
    if (_annotationHideTimer) {
      clearTimeout(_annotationHideTimer);
      _annotationHideTimer = null;
    }
    if (_activeAnnotationMarker && _activeAnnotationMarker !== marker) {
      _activeAnnotationMarker.classList.remove("active");
    }
    var bubble = marker.querySelector(".annotation-bubble");
    if (!bubble) return;
    var rect = marker.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var tp = rect.bottom + 8;
    marker.style.setProperty("--ab-left", cx + "px");
    marker.style.setProperty("--ab-top", tp + "px");
    marker.classList.add("active");
    _activeAnnotationMarker = marker;
  }

  function _hideAnnotationBubble(marker, immediate) {
    if (_annotationHideTimer) {
      clearTimeout(_annotationHideTimer);
      _annotationHideTimer = null;
    }
    if (immediate) {
      marker.classList.remove("active");
      if (_activeAnnotationMarker === marker) _activeAnnotationMarker = null;
      return;
    }
    _annotationHideTimer = setTimeout(function () {
      _annotationHideTimer = null;
      marker.classList.remove("active");
      if (_activeAnnotationMarker === marker) _activeAnnotationMarker = null;
    }, 200);
  }

  function _annotationMarkerEnter() {
    emitKnowledgePointHoverTelemetry(this, "marker");
    _showAnnotationBubble(this);
    _startAnnotationDwellTimer(this);
  }

  function _annotationMarkerLeave(ev) {
    var marker = this;
    var relatedTarget = ev.relatedTarget;
    if (relatedTarget && (marker.contains(relatedTarget) || relatedTarget.closest(".annotation-bubble"))) {
      return;
    }
    _hideAnnotationBubble(marker);
    _clearAnnotationDwellTimer();
  }

  function _startAnnotationDwellTimer(marker) {
    _clearAnnotationDwellTimer();
    _annotationDwellEnterAt = Date.now();
    _annotationDwellTimer = setTimeout(function () {
      _annotationDwellTimer = null;
      emitAnnotationDwellTelemetry(marker, ANNOTATION_DWELL_THRESHOLD_MS);
    }, ANNOTATION_DWELL_THRESHOLD_MS);
  }

  function _clearAnnotationDwellTimer() {
    if (_annotationDwellTimer) {
      clearTimeout(_annotationDwellTimer);
      _annotationDwellTimer = null;
    }
    _annotationDwellEnterAt = 0;
  }

  function emitAnnotationDwellTelemetry(marker, durationMs) {
    if (!(marker instanceof Element) || !state.isReaderOpen) return;
    const chapterMeta = getReaderCurrentChapterMeta();
    const noteType = String(marker.getAttribute("data-note-type") || "").trim();
    const anchorText = String(marker.getAttribute("data-anchor-text") || "").trim();
    const offset = Number(marker.getAttribute("data-offset") || 0) || 0;
    const length = Number(marker.getAttribute("data-length") || 0) || 0;
    const bubbleContent = marker.querySelector(".annotation-bubble-content");
    const noteText = bubbleContent ? String(bubbleContent.textContent || "").trim() : "";
    emitTelemetry("annotation_dwell", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      note_type: noteType,
      anchor_text: anchorText,
      note_text: noteText,
      offset,
      length,
      duration_ms: durationMs,
    });
  }

  function _annotationBubbleEnter(ev) {
    var bubble = this;
    var marker = bubble.closest(".annotation-marker");
    if (marker) {
      emitKnowledgePointHoverTelemetry(marker, "bubble");
      _showAnnotationBubble(marker);
    }
  }

  function _annotationBubbleLeave(ev) {
    var bubble = this;
    var marker = bubble.closest(".annotation-marker");
    if (!marker) return;
    var relatedTarget = ev.relatedTarget;
    if (relatedTarget && marker.contains(relatedTarget)) {
      return;
    }
    _hideAnnotationBubble(marker);
  }

  function _annotationAskClick(anchorText, noteText) {
    var promptText = "解释「" + anchorText + "」：" + noteText;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "nexora-learning", type: "nexora:reader:ask-annotation", text: promptText }, "*");
    }

    // 发射 annotation_ask telemetry 事件
    const chapterMeta = getReaderCurrentChapterMeta();
    emitTelemetry("annotation_ask", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      anchor_text: anchorText,
      note_text: noteText,
    });
  }

  function injectDemoAnnotation() {
    var chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return;
    var firstP = chapterBody.querySelector("p.materials-preview-paragraph");
    if (!firstP || firstP.querySelector(".annotation-marker")) return;
    firstP.classList.add("has-annotation");
    var anchorText = (firstP.textContent || "").trim().slice(0, 30);
    var noteText = "这里作者提出了核心论点，注意与后文的论证逻辑对比阅读。";

    var marker = document.createElement("span");
    marker.className = "annotation-marker";
    marker.setAttribute("data-note-type", "思考点");
    marker.setAttribute("data-anchor-text", anchorText);
    marker.addEventListener("mouseenter", _annotationMarkerEnter);
    marker.addEventListener("mouseleave", _annotationMarkerLeave);

    var dot = document.createElement("span");
    dot.className = "annotation-dot";

    var bubble = document.createElement("span");
    bubble.className = "annotation-bubble";

    var typeSpan = document.createElement("span");
    typeSpan.className = "annotation-bubble-type";
    typeSpan.textContent = "思考点";

    var contentSpan = document.createElement("span");
    contentSpan.className = "annotation-bubble-content";
    contentSpan.textContent = noteText;

    var actionRow = document.createElement("span");
    actionRow.className = "annotation-bubble-action";

    var askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "annotation-ask-btn";
    askBtn.textContent = "💡 解释这段";
    askBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      _annotationAskClick(anchorText, noteText);
    });

    actionRow.appendChild(askBtn);
    bubble.appendChild(typeSpan);
    bubble.appendChild(contentSpan);
    bubble.appendChild(actionRow);
    bubble.addEventListener("mouseenter", _annotationBubbleEnter);
    bubble.addEventListener("mouseleave", _annotationBubbleLeave);
    marker.appendChild(dot);
    marker.appendChild(bubble);
    firstP.appendChild(marker);
  }

// ─────── Reader: Settings & UI Controls ───────────────────────────────
  function loadReaderSettings() {
    try {
      const raw = localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const fontSize = Number(parsed.fontSize);
      const paragraphSpacing = Number(parsed.paragraphSpacing);
      const legacyLineHeight = Number(parsed.lineHeight);
      const edgeClickWidth = Number(parsed.edgeClickWidth);
      if (Number.isFinite(fontSize)) {
        state.readerSettings.fontSize = Math.max(12, Math.min(36, Math.round(fontSize)));
      }
      if (Number.isFinite(paragraphSpacing)) {
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(paragraphSpacing.toFixed(1))));
      } else if (Number.isFinite(legacyLineHeight)) {
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(legacyLineHeight.toFixed(1))));
      }
      if (Number.isFinite(edgeClickWidth)) {
        state.readerSettings.edgeClickWidth = Math.max(30, Math.min(160, Math.round(edgeClickWidth)));
      }
      if (typeof parsed.theme === "string" && parsed.theme) {
        state.readerSettings.theme = parsed.theme;
      }
      if (typeof parsed.displayMode === "string" && parsed.displayMode) {
        state.readerSettings.displayMode = parsed.displayMode;
      }
      if (typeof parsed.enableKeyNavigation === "boolean") {
        state.readerSettings.enableKeyNavigation = parsed.enableKeyNavigation;
      }
      if (typeof parsed.preferredTranslator === "string" && parsed.preferredTranslator) {
        state.readerSettings.preferredTranslator = parsed.preferredTranslator;
      }
    } catch (_err) {
      // ignore invalid local storage
    }
  }

  function saveReaderSettings() {
    try {
      localStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(state.readerSettings));
    } catch (_err) {
      // ignore storage failure
    }
  }

  function syncReaderSettingsPanel() {
    if (el.fontSizeSlider) el.fontSizeSlider.value = String(state.readerSettings.fontSize);
    if (el.fontSizeValue) el.fontSizeValue.textContent = `${state.readerSettings.fontSize}px`;
    if (el.lineHeightSlider) el.lineHeightSlider.value = String(state.readerSettings.paragraphSpacing);
    if (el.lineHeightValue) el.lineHeightValue.textContent = String(state.readerSettings.paragraphSpacing);
    if (el.edgeClickWidthSlider) el.edgeClickWidthSlider.value = String(state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth);
    if (el.edgeClickWidthValue) el.edgeClickWidthValue.textContent = `${state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth}px`;
    const themeInput = document.querySelector(`input[name="readerTheme"][value="${state.readerSettings.theme}"]`);
    if (themeInput instanceof HTMLInputElement) themeInput.checked = true;
    const displayModeInput = document.querySelector(`input[name="readerDisplayMode"][value="${state.readerSettings.displayMode}"]`);
    if (displayModeInput instanceof HTMLInputElement) displayModeInput.checked = true;
    if (el.enableKeyNavigation) el.enableKeyNavigation.checked = !!state.readerSettings.enableKeyNavigation;
    if (el.translatorSelect) el.translatorSelect.value = String(state.readerSettings.preferredTranslator || "auto");
  }

  function applyReaderTypography() {
    const fs = Number(state.readerSettings.fontSize || DEFAULT_READER_SETTINGS.fontSize);
    const spacing = Number(state.readerSettings.paragraphSpacing || DEFAULT_READER_SETTINGS.paragraphSpacing);
    const edgeW = Math.max(30, Math.min(160, Number(state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth)));
    const viewportW = Math.max(320, Number(window.innerWidth || 390));
    const isMobileViewport = viewportW <= 768;
    const mobileEdgeCap = Math.max(18, Math.floor(viewportW * 0.14));
    const effectiveEdgeW = isMobileViewport ? Math.max(18, Math.min(edgeW, mobileEdgeCap)) : edgeW;
    const textRoot = el.readerContent ? el.readerContent.querySelector(".materials-preview-text") : null;
    if (textRoot instanceof HTMLElement) {
      textRoot.style.fontSize = `${fs}px`;
      textRoot.style.lineHeight = "1.8";
      textRoot.style.setProperty("--reader-paragraph-gap", `${spacing}em`);
    }
    if (el.readerPane) {
      el.readerPane.classList.remove("theme-light", "theme-dark", "theme-sepia");
      el.readerPane.classList.add(`theme-${state.readerSettings.theme || "light"}`);
      el.readerPane.style.setProperty("--reader-edge-width", `${edgeW}px`);
      el.readerPane.style.setProperty("--reader-edge-width-effective", `${effectiveEdgeW}px`);
      // Sync theme to body for floating panel
      document.body.classList.remove("reader-theme-light", "reader-theme-dark", "reader-theme-sepia");
      document.body.classList.add(`reader-theme-${state.readerSettings.theme || "light"}`);
    }
  }

  function isReaderSettingsOpen() {
    return !!(el.readerSettingsPanel && el.readerSettingsPanel.classList.contains("show"));
  }

  function setReaderSettingsPanelOpen(open) {
    if (!el.readerSettingsPanel) return;
    const shouldOpen = !!open;
    logReaderDebug("setReaderSettingsPanelOpen:before", { shouldOpen });
    state.readerUiToggleLockedUntil = Date.now() + 120;
    if (shouldOpen) {
      setChapterListPanelOpen(false);
      setReaderHeaderVisible(true);
    }
    el.readerSettingsPanel.classList.toggle("show", shouldOpen);
    document.body.classList.toggle("reader-settings-open", shouldOpen);
    requestAnimationFrame(() => {
      logReaderDebug("setReaderSettingsPanelOpen:afterRAF", { shouldOpen });
    });
  }

  function setChapterListPanelOpen(open) {
    if (!el.chapterListPanel) return;
    if (!state.isReaderFullscreen) {
      el.chapterListPanel.classList.remove("show");
      return;
    }
    const shouldOpen = !!open;
    el.chapterListPanel.classList.toggle("show", shouldOpen);
    if (!shouldOpen) {
      state.readerClosePanelsUntil = Date.now() + 180;
      return;
    }
    notifyHostReaderState(true);
    notifyHostLayout("immersive", { hideInputDock: true, reason: "chapter_list" });
    // 打开目录后自动把当前章节滚动到可见位置
    const activeChapter = el.chapterListContent
      ? el.chapterListContent.querySelector(".chapter-item.current")
      : null;
    if (activeChapter) {
      activeChapter.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }

  function setReaderHeaderVisible(visible) {
    if (!el.readerHeader) return;
    if (visible) {
      el.readerHeader.classList.remove("hidden", "header-hidden");
      el.readerHeader.classList.add("header-visible");
    } else {
      el.readerHeader.classList.add("hidden", "header-hidden");
      el.readerHeader.classList.remove("header-visible");
    }
  }

  function syncReaderModeUI() {
    const isReading = state.readerViewMode === "reading";
    if (el.readerChapterListBtn) el.readerChapterListBtn.hidden = !isReading;
    if (el.readerSettingsBtn) el.readerSettingsBtn.hidden = !isReading;
    if (!state.isReaderOpen) {
      syncMaterialsPageMode();
    } else if (el.materialsMainHeader) {
      el.materialsMainHeader.hidden = true;
    }
    if (el.readerHeader) el.readerHeader.hidden = !state.isReaderOpen;
  }

  function toggleReaderUI() {
    if (Date.now() < Number(state.readerUiToggleLockedUntil || 0)) {
      logReaderDebug("toggleReaderUI:blockedByLock", { lockedUntil: state.readerUiToggleLockedUntil });
      return;
    }
    if (Date.now() < Number(state.readerClosePanelsUntil || 0)) {
      logReaderDebug("toggleReaderUI:blockedAfterClosePanel", { lockedUntil: state.readerClosePanelsUntil });
      return;
    }
    if (isReaderSettingsOpen() || (el.chapterListPanel && el.chapterListPanel.classList.contains("show"))) {
      logReaderDebug("toggleReaderUI:blockedByPanel", {});
      return;
    }
    const hidden = el.readerHeader.classList.contains("header-hidden") || el.readerHeader.classList.contains("hidden");
    setReaderHeaderVisible(hidden);
    logReaderDebug("toggleReaderUI:headerToggled", { nextVisible: hidden });
  }

// ─────── Reader: Lifecycle (Open / Close / Fullscreen) ────────────────
  function openReader(title, subtitle, content, options) {
    const opts = (options && typeof options === "object") ? options : {};
    const mode = opts.mode === "catalog" ? "catalog" : "reading";
    state.isReaderOpen = true;
    state.readerRequestToken += 1;
    setReaderHeaderVisible(true);
    setReaderSettingsPanelOpen(false);
    setChapterListPanelOpen(false);
    el.materialsLayout.hidden = true;
    if (el.courseHomePane) {
      el.courseHomePane.hidden = true;
    }
    el.readerPane.hidden = false;
    state.readerViewMode = mode;
    state.readerMeta.title = String(title || "教材阅读");
    state.readerMeta.subtitle = String(subtitle || "");
    state.readerReportedChapterKey = "";
    el.readerTitle.textContent = state.readerMeta.title;
    el.readerSubTitle.textContent = state.readerMeta.subtitle;
    state.readerFullTextRaw = String(content || "");
    // 初始化章节缓存
    state.readerChapterCache = {};
    resetReaderSelectionTelemetry();
    syncFloatingBtnVisibility();
    if (Array.isArray(state.readerChapters) && state.readerChapters.length) {
      let requestedIndex;
      if (Number.isFinite(Number(opts.chapterIndex))) {
        requestedIndex = Number(opts.chapterIndex);
      } else {
        // 恢复 session 进度
        const sessionIndex = getCurrentSessionChapterIndex();
        requestedIndex = sessionIndex;
      }
      state.readerActiveChapterIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number(requestedIndex) || 0));
    } else {
      state.readerActiveChapterIndex = 0;
    }
    syncReaderModeUI();
    setReaderFullscreen(true);
    syncReaderSettingsPanel();
    applyReaderTypography();

    // 如果是加载模式，显示加载状态（章节内容由外部异步加载）
    if (!opts.loading) {
      openReaderChapter(state.readerActiveChapterIndex);
    }

    // 仅当 selectedBookId 已设置时才发射 telemetry，避免未选择书籍时产生噪声事件
    if (String(state.selectedBookId || "").trim()) {
      const lectureId = String(state.selectedLectureId || "").trim();
      const bookId = String(state.selectedBookId || "").trim();
      const chapterIndex = Number(state.readerActiveChapterIndex) || 0;
      const chapterTitle = String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim();

      emitTelemetry("reader_open", {
        lecture_id: lectureId,
        book_id: bookId,
        view_mode: mode,
        chapter_index: chapterIndex,
        chapter_title: chapterTitle,
      });

      // 设置基础 reader 信息，用于 visibility 事件
      const telemetry = window.NXLTelemetry;
      if (telemetry && typeof telemetry.setBasicReaderContext === "function") {
        telemetry.setBasicReaderContext({
          lecture_id: lectureId,
          book_id: bookId,
          chapter_index: chapterIndex,
          chapter_title: chapterTitle,
        });
      }
    }
    notifyHostReaderState(true);
    notifyHostReaderContext();
    // 异步加载 sections.xml
    loadSectionsData();
  }

  async function loadSectionsData() {
    try {
      const [sectionsXml, annotationsXml] = await Promise.all([
        fetchSectionsXml(),
        fetchAnnotationsXml()
      ]);
      state.readerSectionsData = parseSectionsXml(sectionsXml);
      state.readerAnnotations = parseAnnotationsXml(annotationsXml);
      renderChapterList();
      renderChapterAnnotations(state.readerActiveChapterIndex);
      syncReaderTelemetrySessionContext("sections_loaded");
    } catch (_) {}
  }

// ─────── Reader Floating Panel ────────────────────────────────────────
  const floatingPanelState = {
    open: false,
    activeTab: "guide",
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
    height: null,
  };

  const FLOATING_PANEL_LAYOUT_KEY = "nxl_floating_panel_layout_v1";

  function loadFloatingPanelPosition() {
    try {
      const raw = localStorage.getItem(FLOATING_PANEL_LAYOUT_KEY);
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

  function saveFloatingPanelPosition(left, top, width, height) {
    try {
      localStorage.setItem(FLOATING_PANEL_LAYOUT_KEY, JSON.stringify({
        left: Math.round(Number(left || 0)),
        top: Math.round(Number(top || 0)),
        width: Math.round(Number(width || 0)),
        height: Math.round(Number(height || 0)),
      }));
    } catch (_) {}
  }

  function applyFloatingPanelPosition(forceDefault) {
    const panel = document.getElementById("readerFloatingPanel");
    if (!panel) return;
    const saved = loadFloatingPanelPosition();
    if (!saved && !forceDefault) return;
    if (saved) {
      const minWidth = 280;
      const minHeight = 240;
      const maxWidth = Math.max(minWidth, window.innerWidth - 24);
      const maxHeight = Math.max(minHeight, window.innerHeight - 24);
      const width = Math.max(minWidth, Math.min(maxWidth, Number(saved.width || minWidth)));
      const height = Math.max(minHeight, Math.min(maxHeight, Number(saved.height || minHeight)));
      const maxLeft = Math.max(8, window.innerWidth - width - 8);
      const maxTop = Math.max(8, window.innerHeight - height - 8);
      floatingPanelState.left = Math.max(8, Math.min(maxLeft, Number(saved.left || 0)));
      floatingPanelState.top = Math.max(8, Math.min(maxTop, Number(saved.top || 0)));
      floatingPanelState.width = width;
      floatingPanelState.height = height;
      panel.style.left = `${floatingPanelState.left}px`;
      panel.style.top = `${floatingPanelState.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.width = `${floatingPanelState.width}px`;
      panel.style.height = `${floatingPanelState.height}px`;
      return;
    }
  }

  function bindFloatingPanelDrag() {
    if (floatingPanelState.bound) return;
    floatingPanelState.bound = true;
    const panel = document.getElementById("readerFloatingPanel");
    const head = document.getElementById("floatingPanelHead");
    const resizeHandle = document.getElementById("floatingResizeHandle");
    if (!panel || !head) return;

    const clampRect = (left, top, width, height) => {
      const minWidth = 280;
      const minHeight = 240;
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
        height: safeHeight,
      };
    };

    const stop = () => {
      if (!floatingPanelState.dragging && !floatingPanelState.resizing) return;
      floatingPanelState.dragging = false;
      floatingPanelState.resizing = false;
      floatingPanelState.pointerId = null;
      saveFloatingPanelPosition(
        floatingPanelState.left,
        floatingPanelState.top,
        floatingPanelState.width,
        floatingPanelState.height
      );
      panel.classList.remove("dragging");
      panel.classList.remove("resizing");
      try { panel.releasePointerCapture(floatingPanelState.pointerId); } catch (_) {}
    };

    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".floating-panel-close") || e.target.closest(".floating-tab")) return;
      const rect = panel.getBoundingClientRect();
      floatingPanelState.dragging = true;
      floatingPanelState.pointerId = e.pointerId;
      floatingPanelState.startClientX = e.clientX;
      floatingPanelState.startClientY = e.clientY;
      floatingPanelState.startLeft = rect.left;
      floatingPanelState.startTop = rect.top;
      floatingPanelState.startWidth = rect.width;
      floatingPanelState.startHeight = rect.height;
      panel.classList.add("dragging");
      try { panel.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });

    panel.addEventListener("pointermove", (e) => {
      if (floatingPanelState.dragging) {
        const dx = e.clientX - floatingPanelState.startClientX;
        const dy = e.clientY - floatingPanelState.startClientY;
        const clamped = clampRect(
          floatingPanelState.startLeft + dx,
          floatingPanelState.startTop + dy,
          floatingPanelState.startWidth,
          floatingPanelState.startHeight
        );
        floatingPanelState.left = clamped.left;
        floatingPanelState.top = clamped.top;
        panel.style.left = `${clamped.left}px`;
        panel.style.top = `${clamped.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      } else if (floatingPanelState.resizing) {
        const dx = e.clientX - floatingPanelState.startClientX;
        const dy = e.clientY - floatingPanelState.startClientY;
        const clamped = clampRect(
          floatingPanelState.startLeft,
          floatingPanelState.startTop,
          floatingPanelState.startWidth + dx,
          floatingPanelState.startHeight + dy
        );
        floatingPanelState.width = clamped.width;
        floatingPanelState.height = clamped.height;
        panel.style.width = `${clamped.width}px`;
        panel.style.height = `${clamped.height}px`;
      }
    });

    panel.addEventListener("pointerup", stop);
    panel.addEventListener("pointercancel", stop);

    if (resizeHandle) {
      resizeHandle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const rect = panel.getBoundingClientRect();
        floatingPanelState.resizing = true;
        floatingPanelState.pointerId = e.pointerId;
        floatingPanelState.startClientX = e.clientX;
        floatingPanelState.startClientY = e.clientY;
        floatingPanelState.startLeft = rect.left;
        floatingPanelState.startTop = rect.top;
        floatingPanelState.startWidth = rect.width;
        floatingPanelState.startHeight = rect.height;
        panel.classList.add("resizing");
        try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  function setFloatingTab(tabName) {
    const panel = document.getElementById("readerFloatingPanel");
    if (!panel) return;
    floatingPanelState.activeTab = tabName;
    const tabs = panel.querySelectorAll(".floating-tab");
    const contents = panel.querySelectorAll(".floating-tab-content");
    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === tabName);
    });
    contents.forEach((content) => {
      const isTarget = content.dataset.tab === tabName;
      content.hidden = !isTarget;
      content.classList.toggle("is-active", isTarget);
    });

    if (tabName === "quiz") {
      renderQuizPanel();
    }
  }

  function openFloatingPanel() {
    const panel = document.getElementById("readerFloatingPanel");
    const btn = document.getElementById("readerFloatingBtn");
    if (!panel) return;
    floatingPanelState.open = true;
    panel.classList.add("active");
    panel.setAttribute("aria-hidden", "false");
    if (btn) btn.hidden = true;
    bindFloatingPanelDrag();
    applyFloatingPanelPosition(false);
    setFloatingTab(floatingPanelState.activeTab);
  }

  function closeFloatingPanel() {
    const panel = document.getElementById("readerFloatingPanel");
    if (!panel) return;
    floatingPanelState.open = false;
    panel.classList.remove("active");
    panel.classList.remove("dragging");
    panel.classList.remove("resizing");
    panel.setAttribute("aria-hidden", "true");
    syncFloatingBtnVisibility();
  }

  function toggleFloatingPanel() {
    if (floatingPanelState.open) closeFloatingPanel();
    else openFloatingPanel();
  }

  function syncFloatingBtnVisibility() {
    const btn = document.getElementById("readerFloatingBtn");
    if (!btn) return;
    const isReadingView = !!(
      state.isReaderOpen
      && state.readerViewMode === "reading"
      && el.readerPane
      && !el.readerPane.hidden
    );
    btn.hidden = !isReadingView || floatingPanelState.open;
  }

  // Reader guide state management
  const READER_GUIDE_CACHE_KEY = "nxl_reader_guide_cache_v1";
  const READER_GUIDE_CARD_STATE_KEY = "nxl_reader_guide_card_state_v1";
  const PRE_READING_QA_CACHE_KEY = "nxl_pre_reading_qa_cache_v1";
  let readerGuideState = {
    status: "empty",
    target: null,
    guide: null,
    error: "",
    draft: "",
    preQuestions: null,
    preQuestionsDraft: "",
    preReadingAnswers: null,
    preReadingSkipped: false,
  };

  function readReaderGuideCache() {
    try {
      const raw = localStorage.getItem(READER_GUIDE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function writeReaderGuideCache(cache) {
    const input = cache && typeof cache === "object" ? cache : {};
    const rows = Object.entries(input)
      .filter(([, value]) => value && typeof value === "object")
      .sort((a, b) => Number((b[1] || {}).timestamp || 0) - Number((a[1] || {}).timestamp || 0))
      .slice(0, 80);
    const nextCache = {};

    rows.forEach(([key, value]) => {
      nextCache[key] = value;
    });

    localStorage.setItem(READER_GUIDE_CACHE_KEY, JSON.stringify(nextCache));
  }

  function readPreReadingQACache() {
    try {
      const raw = localStorage.getItem(PRE_READING_QA_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function writePreReadingQACache(cache) {
    const input = cache && typeof cache === "object" ? cache : {};
    const rows = Object.entries(input)
      .filter(([, value]) => value && typeof value === "object")
      .sort((a, b) => Number((b[1] || {}).timestamp || 0) - Number((a[1] || {}).timestamp || 0))
      .slice(0, 80);
    const nextCache = {};

    rows.forEach(([key, value]) => {
      nextCache[key] = value;
    });

    localStorage.setItem(PRE_READING_QA_CACHE_KEY, JSON.stringify(nextCache));
  }

  async function checkPreReadingQACache(target) {
    try {
      const result = await fetchJson("/api/frontend/reader-guide/pre-questions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecture_id: target.lectureId,
          book_id: target.bookId,
          chapter_index: target.chapterIndex,
        }),
      });
      return result && result.cached ? result.data : null;
    } catch (_err) {
      return null;
    }
  }

  async function savePreReadingQA(target, questions, answers, skipped) {
    try {
      await fetchJson("/api/frontend/reader-guide/pre-questions/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecture_id: target.lectureId,
          book_id: target.bookId,
          chapter_index: target.chapterIndex,
          questions,
          answers,
          skipped,
        }),
      });

      // 同时保存到 localStorage
      const cache = readPreReadingQACache();
      const key = getReaderGuideKey(target);
      cache[key] = { questions, answers, skipped, timestamp: Date.now() };
      writePreReadingQACache(cache);
    } catch (err) {
      console.warn("[NXL-PreQA] save failed", err);
    }
  }

  function readReaderGuideCardState() {
    try {
      const raw = localStorage.getItem(READER_GUIDE_CARD_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function writeReaderGuideCardState(stateMap) {
    const input = stateMap && typeof stateMap === "object" ? stateMap : {};
    localStorage.setItem(READER_GUIDE_CARD_STATE_KEY, JSON.stringify(input));
  }

  function getReaderGuideCardStateKey() {
    return getReaderGuideKey(readerGuideState.target);
  }

  function getReaderGuideCardState(index) {
    const key = getReaderGuideCardStateKey();
    const stateMap = readReaderGuideCardState();
    const guideState = key && stateMap[key] && typeof stateMap[key] === "object" ? stateMap[key] : {};
    const row = guideState[String(index)] && typeof guideState[String(index)] === "object" ? guideState[String(index)] : {};

    return {
      completed: !!row.completed,
      collapsed: !!row.collapsed,
    };
  }

  function setReaderGuideCardState(index, nextState) {
    const key = getReaderGuideCardStateKey();
    if (!key) return;

    const stateMap = readReaderGuideCardState();
    const guideState = stateMap[key] && typeof stateMap[key] === "object" ? stateMap[key] : {};
    guideState[String(index)] = {
      ...getReaderGuideCardState(index),
      ...(nextState && typeof nextState === "object" ? nextState : {}),
    };
    stateMap[key] = guideState;
    writeReaderGuideCardState(stateMap);
  }

  function hashReaderGuideText(text) {
    const value = String(text || "");
    let hash = 2166136261;

    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  }

  function getReaderGuideKey(target) {
    const row = target && typeof target === "object" ? target : {};
    const parts = [
      row.lectureId,
      row.bookId,
      row.targetType,
      row.chapterIndex,
      row.sessionIndex,
      row.sessionRange,
      row.contentHash,
    ].map((item) => String(item === undefined || item === null ? "" : item).trim());

    if (parts.some((item) => !item)) return "";

    return parts.join("::");
  }

  function getReaderGuideTargetTitle(target) {
    if (!target) return "本节导读";
    const chapterTitle = String(target.chapterName || "").trim();
    const sessionTitle = String(target.sessionName || "").trim();

    if (target.targetType === "session" && sessionTitle) {
      return `${chapterTitle} · ${sessionTitle}`;
    }

    return chapterTitle || "当前章节";
  }

  function buildReaderGuideTarget(chapterIndex, content, options) {
    const opts = options && typeof options === "object" ? options : {};
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(chapterIndex) || 0));
    const chapter = chapters[idx];
    const chapterContent = String(content || "").trim();

    if (!lectureId || !bookId || !chapter || !chapterContent) return null;

    const chapterName = String(chapter.title || `第 ${idx + 1} 章`).trim();
    const rawSessionIndex = Number(opts.sessionIndex);
    let targetType = "chapter";
    let sessionIndex = -1;
    let sessionName = "";
    let sessionRange = "chapter";
    let guideContext = chapterContent;

    if (Number.isInteger(rawSessionIndex) && rawSessionIndex >= 0) {
      const sectionData = state.readerSectionsData[chapterName];
      const sessions = sectionData && Array.isArray(sectionData.sessions) ? sectionData.sessions : [];
      const session = sessions[rawSessionIndex] || {};
      const selectedRange = String(session.range || opts.sessionRange || "").trim();

      if (!selectedRange) return null;

      const parsedRange = parseReaderSessionRange(chapter, selectedRange);
      if (!parsedRange) return null;

      const selectedContent = chapterContent.slice(parsedRange.startRelative, parsedRange.endRelative).trim();
      if (!selectedContent) return null;

      targetType = "session";
      sessionIndex = rawSessionIndex;
      sessionName = String(session.name || opts.sessionName || `小节 ${rawSessionIndex + 1}`).trim();
      sessionRange = selectedRange;
      guideContext = selectedContent;
    }

    const compactContext = guideContext.slice(0, 10000);
    return {
      lectureId,
      bookId,
      targetType,
      chapterIndex: idx,
      chapterName,
      sessionIndex,
      sessionName,
      sessionRange,
      contentHash: hashReaderGuideText(compactContext),
      guideContext: compactContext,
    };
  }

  function renderReaderGuidePanel() {
    const content = document.querySelector('.floating-tab-content[data-tab="guide"]');
    if (!content) return;

    const target = readerGuideState.target;
    const title = getReaderGuideTargetTitle(target);

    if (readerGuideState.status === "prompt") {
      content.innerHTML = `
        <section class="reader-guide-prompt">
          <div class="reader-guide-kicker">阅读导读</div>
          <h3>${escapeHtml(title)}</h3>
          <p>是否根据当前内容生成一组阅读引导？导读会保存在本地缓存，不写入左侧对话历史。</p>
          <div class="reader-guide-actions">
            <button type="button" class="reader-guide-primary" data-reader-guide-action="generate">生成导读</button>
            <button type="button" class="reader-guide-secondary" data-reader-guide-action="dismiss">稍后</button>
          </div>
        </section>
      `;
      return;
    }

    if (readerGuideState.status === "pre_questions_loading") {
      const draft = String(readerGuideState.preQuestionsDraft || "").trim();
      content.innerHTML = `
        <div class="reader-guide-loading">
          <div class="quiz-loading-spinner"></div>
          <div class="quiz-loading-text">正在准备阅读前问答...</div>
          <div class="quiz-loading-hint">模型正在根据章节内容生成问题</div>
          <section class="reader-guide-stream">
            <div class="reader-guide-stream-label">实时输出</div>
            <pre class="reader-guide-draft">${escapeHtml(draft || "等待模型开始输出...")}</pre>
          </section>
        </div>
      `;
      return;
    }

    if (readerGuideState.status === "pre_questions_ready" && readerGuideState.preQuestions) {
      const questions = readerGuideState.preQuestions || [];
      const questionHtml = questions.map((q, idx) => {
        const optionsHtml = (q.options || []).map((opt) => `
          <label class="pre-qa-option">
            <input type="radio" name="pre_qa_${q.id}" value="${escapeHtml(opt.id)}" data-question-id="${escapeHtml(q.id)}" data-option-id="${escapeHtml(opt.id)}">
            <span class="pre-qa-option-text">${escapeHtml(opt.text)}</span>
          </label>
        `).join("");

        return `
          <div class="pre-qa-question" data-question-id="${escapeHtml(q.id)}">
            <div class="pre-qa-question-title">${escapeHtml(q.title)}</div>
            <div class="pre-qa-options">${optionsHtml}</div>
          </div>
        `;
      }).join("");

      content.innerHTML = `
        <section class="pre-qa-container">
          <div class="pre-qa-header">
            <div class="reader-guide-kicker">阅读前准备</div>
            <h3>${escapeHtml(title)}</h3>
            <p class="pre-qa-hint">回答以下问题，帮助系统为你生成更个性化的导读</p>
          </div>
          <div class="pre-qa-questions">${questionHtml}</div>
          <div class="pre-qa-actions">
            <button type="button" class="reader-guide-primary" data-reader-guide-action="submit-pre-qa">提交并生成导读</button>
            <button type="button" class="reader-guide-secondary" data-reader-guide-action="skip-pre-qa">跳过，直接生成</button>
          </div>
        </section>
      `;
      return;
    }

    if (readerGuideState.status === "loading") {
      const draft = String(readerGuideState.draft || "").trim();
      content.innerHTML = `
        <div class="reader-guide-loading">
          <div class="quiz-loading-spinner"></div>
          <div class="quiz-loading-text">正在生成导读...</div>
          <div class="quiz-loading-hint">模型正在阅读当前小节内容</div>
          <section class="reader-guide-stream">
            <div class="reader-guide-stream-label">实时输出</div>
            <pre class="reader-guide-draft">${escapeHtml(draft || "等待模型开始输出...")}</pre>
          </section>
        </div>
      `;
      return;
    }

    if (readerGuideState.status === "error") {
      const draft = String(readerGuideState.draft || "").trim();
      content.innerHTML = `
        <div class="reader-guide-error">
          <div class="quiz-error-text">${escapeHtml(readerGuideState.error || "导读生成失败")}</div>
          ${draft ? `<pre class="reader-guide-error-draft">${escapeHtml(draft)}</pre>` : ""}
          <button class="quiz-retry-btn" type="button" data-reader-guide-action="generate-force">重试</button>
        </div>
      `;
      return;
    }

    if (readerGuideState.status === "ready" && readerGuideState.guide) {
      const guide = readerGuideState.guide || {};
      const focusPoints = Array.isArray(guide.focus_points) ? guide.focus_points : [];
      const questions = Array.isArray(guide.questions) ? guide.questions : [];
      const focusHtml = focusPoints.length ? `
        <div class="reader-guide-focus">
          ${focusPoints.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      ` : "";
      const questionHtml = questions.map((item, idx) => {
        const cardState = getReaderGuideCardState(idx);
        const collapsed = cardState.completed && cardState.collapsed;
        const completed = cardState.completed;

        return `
        <article class="reader-guide-card${completed ? " is-completed" : ""}${collapsed ? " is-collapsed" : ""}" data-reader-guide-card-index="${idx}">
          <div class="reader-guide-card-top">
            <span>${escapeHtml(item.stage || "导读")}</span>
            <label class="reader-guide-done">
              <input type="checkbox" data-reader-guide-action="toggle-complete" data-reader-guide-index="${idx}" ${completed ? "checked" : ""}>
              <span>完成</span>
            </label>
            ${completed ? `<button type="button" data-reader-guide-action="toggle-card" data-reader-guide-index="${idx}">${collapsed ? "展开" : "折叠"}</button>` : ""}
            ${item.question ? `<button type="button" data-reader-guide-action="ask" data-reader-guide-index="${idx}">追问</button>` : ""}
          </div>
          ${item.title ? `<div class="reader-guide-title">${escapeHtml(item.title)}</div>` : ""}
          <div class="reader-guide-card-body" ${collapsed ? "hidden" : ""}>
            ${item.guidance ? `<div class="reader-guide-guidance">${escapeHtml(item.guidance)}</div>` : ""}
            ${item.anchor ? `<div class="reader-guide-anchor">${escapeHtml(item.anchor)}</div>` : ""}
            ${item.question ? `<div class="reader-guide-question">${escapeHtml(item.question)}</div>` : ""}
            ${item.reason ? `<div class="reader-guide-reason">${escapeHtml(item.reason)}</div>` : ""}
          </div>
        </article>
      `;
      }).join("");

      content.innerHTML = `
        <section class="reader-guide-ready">
          <header class="reader-guide-head">
            <div>
              <div class="reader-guide-kicker">本节导读</div>
              <h3>${escapeHtml(title)}</h3>
            </div>
            <button class="reader-guide-refresh" type="button" data-reader-guide-action="generate-force" title="重新生成导读" aria-label="重新生成导读">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
          </header>
          ${guide.overview ? `<p class="reader-guide-overview">${escapeHtml(guide.overview)}</p>` : ""}
          ${guide.reading_strategy ? `<div class="reader-guide-strategy">${escapeHtml(guide.reading_strategy)}</div>` : ""}
          ${focusHtml}
          <div class="reader-guide-list">${questionHtml}</div>
        </section>
      `;
      applyReaderGuidePatches();
      return;
    }

    content.innerHTML = '<div class="floating-empty-hint">进入章节后生成本节导读</div>';
  }

  function openReaderGuideTarget(target) {
    const key = getReaderGuideKey(target);
    if (!key) return;

    state.readerGuidePromptedKey = key;
    const cache = readReaderGuideCache();
    const cached = cache[key];
    readerGuideState = {
      status: cached && cached.guide ? "ready" : "prompt",
      target,
      guide: cached && cached.guide ? cached.guide : null,
      error: "",
      draft: "",
    };
    renderReaderGuidePanel();
    openFloatingPanel();
    setFloatingTab("guide");
  }

  function scheduleReaderGuidePrompt(chapterIndex, content, options) {
    window.setTimeout(() => {
      if (!state.isReaderOpen) return;

      const target = buildReaderGuideTarget(chapterIndex, content, options);
      const key = getReaderGuideKey(target);

      if (!target || !key || state.readerGuidePromptedKey === key) return;

      openReaderGuideTarget(target);
    }, 80);
  }

  function buildReaderGuideRequestBody(target) {
    return {
      username: getRuntimeUsername(),
      lecture_id: target.lectureId,
      book_id: target.bookId,
      chapter_index: target.chapterIndex,
      session_index: target.sessionIndex,
      chapter_name: target.chapterName,
      session_name: target.sessionName,
      session_range: target.sessionRange,
      content_hash: target.contentHash,
      guide_context: target.guideContext,
    };
  }

  function updateReaderGuideDraftView(draftText) {
    const draftEl = document.querySelector('.floating-tab-content[data-tab="guide"] .reader-guide-draft');
    if (!draftEl) return;

    draftEl.textContent = String(draftText || "").trim() || "等待模型开始输出...";
    draftEl.scrollTop = draftEl.scrollHeight;
  }

  function parseReaderGuideSseBlock(block) {
    const raw = String(block || "").trim();

    if (!raw) return null;

    const lines = raw.split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];

    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (!dataLines.length) return null;

    return {
      eventName,
      data: JSON.parse(dataLines.join("\n")),
    };
  }

  async function fetchReaderGuideStream(target, onDelta, userProfile, preReadingAnswers, preReadingSkipped) {
    const requestBody = buildReaderGuideRequestBody(target);
    if (userProfile) {
      requestBody.user_profile = userProfile;
    }
    if (preReadingAnswers || preReadingSkipped) {
      requestBody.pre_reading_answers = {
        answers: preReadingAnswers || {},
        skipped: preReadingSkipped || false,
      };
    }

    const response = await fetch(resolveApiUrl("/api/frontend/reader-guide/stream"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Nexora-Username": getRuntimeUsername() },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;

      try {
        const data = await response.json();
        message = String((data && (data.error || data.message)) || message);
      } catch (_err) {}

      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("导读流没有返回响应体");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult = null;

    const handleBlock = (block) => {
      const parsed = parseReaderGuideSseBlock(block);

      if (!parsed) return;

      if (parsed.eventName === "delta") {
        const piece = String((parsed.data && parsed.data.content) || "");

        if (piece && typeof onDelta === "function") {
          onDelta(piece);
        }
      } else if (parsed.eventName === "status") {
        const message = String((parsed.data && parsed.data.message) || "").trim();

        if (message && typeof onDelta === "function") {
          onDelta(`[状态] ${message}\n`);
        }
      } else if (parsed.eventName === "done") {
        finalResult = parsed.data;
      } else if (parsed.eventName === "error") {
        throw new Error(String((parsed.data && parsed.data.error) || "导读生成失败"));
      }
    };

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      blocks.forEach(handleBlock);
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult || !finalResult.success || !finalResult.guide) {
      throw new Error("导读流没有返回完整导读");
    }

    return finalResult;
  }

  async function fetchPreReadingQuestionsStream(target, onDelta) {
    const response = await fetch(resolveApiUrl("/api/frontend/reader-guide/pre-questions"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Nexora-Username": getRuntimeUsername() },
      body: JSON.stringify({
        lecture_id: target.lectureId,
        book_id: target.bookId,
        chapter_name: target.chapterName,
        session_name: target.sessionName,
        guide_context: target.guideContext,
      }),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;

      try {
        const data = await response.json();
        message = String((data && (data.error || data.message)) || message);
      } catch (_err) {}

      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("阅读前问答回答流没有返回响应体");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult = null;

    const handleBlock = (block) => {
      const parsed = parseReaderGuideSseBlock(block);

      if (!parsed) return;

      if (parsed.eventName === "delta") {
        const piece = String((parsed.data && parsed.data.content) || "");

        if (piece && typeof onDelta === "function") {
          onDelta(piece);
        }
      } else if (parsed.eventName === "done") {
        finalResult = parsed.data;
      } else if (parsed.eventName === "error") {
        throw new Error(String((parsed.data && parsed.data.error) || "阅读前问答生成失败"));
      }
    };

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      blocks.forEach(handleBlock);
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult || !finalResult.success || !finalResult.questions) {
      throw new Error("阅读前问答回答流没有返回完整问题");
    }

    return finalResult;
  }

  async function generateReaderGuide(force) {
    const target = readerGuideState.target;
    const key = getReaderGuideKey(target);

    if (!target || !key) {
      readerGuideState = {
        status: "error",
        target,
        guide: null,
        error: "当前阅读上下文不完整，不能生成导读。",
        draft: "",
        preQuestions: null,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
      renderReaderGuidePanel();
      return;
    }

    const cache = readReaderGuideCache();
    if (!force && cache[key] && cache[key].guide) {
      readerGuideState = {
        status: "ready",
        target,
        guide: cache[key].guide,
        error: "",
        draft: "",
        preQuestions: null,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
      renderReaderGuidePanel();
      return;
    }

    // 检查阅读前问答缓存
    const qaCache = readPreReadingQACache();
    const cachedQA = qaCache[key];

    if (!force && cachedQA) {
      // 有缓存，直接使用缓存的答案生成导读
      readerGuideState.preReadingAnswers = cachedQA.answers || {};
      readerGuideState.preReadingSkipped = cachedQA.skipped || false;
    } else {
      // 没有缓存，先生成问题
      await generatePreReadingQuestions(target, key);
      return;
    }

    // 生成导读
    await fetchAndRenderGuide(target, key, cache, force);
  }

  async function generatePreReadingQuestions(target, key) {
    readerGuideState = {
      status: "pre_questions_loading",
      target,
      guide: null,
      error: "",
      draft: "",
      preQuestions: null,
      preQuestionsDraft: "",
      preReadingAnswers: null,
      preReadingSkipped: false,
    };
    renderReaderGuidePanel();
    openFloatingPanel();
    setFloatingTab("guide");

    try {
      const result = await fetchPreReadingQuestionsStream(target, (delta) => {
        readerGuideState.preQuestionsDraft = `${String(readerGuideState.preQuestionsDraft || "")}${String(delta || "")}`;
        const draftEl = document.querySelector('.floating-tab-content[data-tab="guide"] .reader-guide-draft');
        if (draftEl) {
          draftEl.textContent = readerGuideState.preQuestionsDraft || "等待模型开始输出...";
          draftEl.scrollTop = draftEl.scrollHeight;
        }
      });

      if (!result || !result.success || !result.questions) {
        throw new Error((result && (result.error || result.message)) || "模型未返回问题");
      }

      readerGuideState = {
        status: "pre_questions_ready",
        target,
        guide: null,
        error: "",
        draft: "",
        preQuestions: result.questions,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
    } catch (err) {
      readerGuideState = {
        status: "error",
        target,
        guide: null,
        error: String(err && err.message ? err.message : "阅读前问答生成失败"),
        draft: "",
        preQuestions: null,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
    }

    renderReaderGuidePanel();
  }

  async function submitPreReadingQA() {
    const target = readerGuideState.target;
    const key = getReaderGuideKey(target);
    const questions = readerGuideState.preQuestions || [];
    const answers = {};
    const startTime = Date.now();

    // 收集答案
    questions.forEach((q) => {
      const selected = document.querySelector(`input[name="pre_qa_${q.id}"]:checked`);
      if (selected) {
        const optionId = selected.getAttribute("data-option-id");
        const option = (q.options || []).find((o) => o.id === optionId);
        answers[q.id] = {
          question_id: q.id,
          question_type: q.type,
          question_title: q.title,
          option_id: optionId,
          answer_text: option ? option.text : "",
        };
      }
    });

    const durationMs = Date.now() - startTime;

    // 保存答案
    readerGuideState.preReadingAnswers = answers;
    readerGuideState.preReadingSkipped = false;
    await savePreReadingQA(target, questions, answers, false);

    // 发射遥测
    emitTelemetry("pre_reading_qa", {
      lecture_id: target.lectureId,
      book_id: target.bookId,
      chapter_index: target.chapterIndex,
      session_index: target.sessionIndex,
      answers: JSON.stringify(answers),
      skipped: false,
      duration_ms: durationMs,
    });

    // 生成导读
    const cache = readReaderGuideCache();
    await fetchAndRenderGuide(target, key, cache, false);
  }

  async function skipPreReadingQA() {
    const target = readerGuideState.target;
    const key = getReaderGuideKey(target);
    const questions = readerGuideState.preQuestions || [];

    // 保存跳过状态
    readerGuideState.preReadingAnswers = {};
    readerGuideState.preReadingSkipped = true;
    await savePreReadingQA(target, questions, {}, true);

    // 发射遥测
    emitTelemetry("pre_reading_qa", {
      lecture_id: target.lectureId,
      book_id: target.bookId,
      chapter_index: target.chapterIndex,
      session_index: target.sessionIndex,
      answers: "{}",
      skipped: true,
      duration_ms: 0,
    });

    // 生成导读
    const cache = readReaderGuideCache();
    await fetchAndRenderGuide(target, key, cache, false);
  }

  async function fetchAndRenderGuide(target, key, cache, force) {
    readerGuideState = {
      status: "loading",
      target,
      guide: null,
      error: "",
      draft: "",
      preQuestions: readerGuideState.preQuestions,
      preQuestionsDraft: "",
      preReadingAnswers: readerGuideState.preReadingAnswers,
      preReadingSkipped: readerGuideState.preReadingSkipped,
    };
    renderReaderGuidePanel();

    try {
      // 获取用户画像
      let userProfile = "";
      try {
        const profileResult = await fetchJson("/api/frontend/reader-guide/user-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        userProfile = profileResult && profileResult.profile ? profileResult.profile : "";
      } catch (_err) {
        // 忽略画像获取失败
      }

      const result = await fetchReaderGuideStream(target, (delta) => {
        readerGuideState.draft = `${String(readerGuideState.draft || "")}${String(delta || "")}`;
        updateReaderGuideDraftView(readerGuideState.draft);
      }, userProfile, readerGuideState.preReadingAnswers, readerGuideState.preReadingSkipped);

      if (!result || !result.success || !result.guide) {
        throw new Error((result && (result.error || result.message)) || "模型未返回导读");
      }

      cache[key] = {
        guide: result.guide,
        target: {
          lectureId: target.lectureId,
          bookId: target.bookId,
          targetType: target.targetType,
          chapterIndex: target.chapterIndex,
          chapterName: target.chapterName,
          sessionIndex: target.sessionIndex,
          sessionName: target.sessionName,
          sessionRange: target.sessionRange,
          contentHash: target.contentHash,
        },
        model_name: String(result.model_name || ""),
        timestamp: Date.now(),
      };
      writeReaderGuideCache(cache);

      readerGuideState = {
        status: "ready",
        target,
        guide: result.guide,
        error: "",
        draft: "",
        preQuestions: null,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
    } catch (err) {
      readerGuideState = {
        status: "error",
        target,
        guide: null,
        error: String(err && err.message ? err.message : "导读生成失败"),
        draft: String(readerGuideState.draft || ""),
        preQuestions: null,
        preQuestionsDraft: "",
        preReadingAnswers: null,
        preReadingSkipped: false,
      };
    }

    renderReaderGuidePanel();
  }

  function askReaderGuideQuestion(index) {
    const guide = readerGuideState.guide || {};
    const target = readerGuideState.target || {};
    const questions = Array.isArray(guide.questions) ? guide.questions : [];
    const item = questions[Number(index)];

    if (!item || !String(item.question || "").trim()) return;

    const text = [
      "我正在阅读 NexoraLearning 当前小节，请围绕下面这张导读卡继续带读。",
      "",
      `阅读位置：${getReaderGuideTargetTitle(target)}`,
      item.title ? `导读卡：${String(item.title || "").trim()}` : "",
      item.guidance ? `阅读引导：${String(item.guidance || "").trim()}` : "",
      item.anchor ? `原文线索：${String(item.anchor || "").trim()}` : "",
      `延伸追问：${String(item.question || "").trim()}`,
      item.reason ? `推荐理由：${String(item.reason || "").trim()}` : "",
    ].filter(Boolean).join("\n");

    sendHostMessage({
      type: "nexora:send-message",
      text,
      guide: true,
      reader_context: {
        lecture_id: String(target.lectureId || ""),
        book_id: String(target.bookId || ""),
        chapter_index: Number(target.chapterIndex) || 0,
        session_index: Number(target.sessionIndex),
        chapter_name: String(target.chapterName || ""),
        session_name: String(target.sessionName || ""),
      },
    });
    showToast("已发送到 Learning 对话");
  }

  function clearReaderGuidePatches() {
    const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return;

    chapterBody.querySelectorAll(".reader-guide-section-break").forEach((node) => node.remove());
    chapterBody.querySelectorAll(".reader-guide-highlight").forEach((node) => {
      const parent = node.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(node.textContent || ""), node);
      parent.normalize();
    });
    chapterBody.querySelectorAll(".reader-guide-patched-paragraph").forEach((node) => {
      node.classList.remove("reader-guide-patched-paragraph");
      node.removeAttribute("data-reader-guide-patch-index");
    });
  }

  function normalizeReaderGuidePatchPhrases(card) {
    const row = card && typeof card === "object" ? card : {};
    const patch = row.patch && typeof row.patch === "object" ? row.patch : {};
    const phrases = [];
    const paragraph = String(patch.paragraph || "").trim();
    const anchor = String(row.anchor || "").trim();
    const keywords = Array.isArray(patch.keywords) ? patch.keywords : [];

    if (paragraph) phrases.push(paragraph);
    keywords.forEach((item) => {
      const text = String(item || "").trim();
      if (text) phrases.push(text);
    });
    if (anchor) phrases.push(anchor);

    return Array.from(new Set(phrases)).filter((item) => item.length >= 2).slice(0, 5);
  }

  function findReaderGuidePatchParagraph(phrases) {
    const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return null;

    const paragraphs = Array.from(chapterBody.querySelectorAll(".materials-preview-paragraph"));

    for (const phrase of phrases) {
      const compactPhrase = String(phrase || "").replace(/\s+/g, "");
      if (!compactPhrase) continue;

      const exact = paragraphs.find((node) => String(node.textContent || "").includes(phrase));
      if (exact) return exact;

      const compact = paragraphs.find((node) => String(node.textContent || "").replace(/\s+/g, "").includes(compactPhrase));
      if (compact) return compact;
    }

    return null;
  }

  function highlightReaderGuidePhrase(paragraph, phrase, guideIndex) {
    const targetPhrase = String(phrase || "").trim();
    if (!paragraph || !targetPhrase) return false;

    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".annotation-marker") || parent.closest(".reader-guide-highlight")) return NodeFilter.FILTER_REJECT;
        return String(node.nodeValue || "").includes(targetPhrase) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const textNode = walker.nextNode();
    if (!textNode) return false;

    const text = String(textNode.nodeValue || "");
    const index = text.indexOf(targetPhrase);
    if (index < 0) return false;

    const before = text.slice(0, index);
    const matched = text.slice(index, index + targetPhrase.length);
    const after = text.slice(index + targetPhrase.length);
    const mark = document.createElement("mark");
    mark.className = "reader-guide-highlight";
    mark.setAttribute("data-reader-guide-patch-index", String(guideIndex));
    mark.textContent = matched;

    const parent = textNode.parentNode;
    if (!parent) return false;

    if (before) parent.insertBefore(document.createTextNode(before), textNode);
    parent.insertBefore(mark, textNode);
    if (after) parent.insertBefore(document.createTextNode(after), textNode);
    parent.removeChild(textNode);
    return true;
  }

  function applyReaderGuidePatches() {
    clearReaderGuidePatches();

    if (readerGuideState.status !== "ready" || !readerGuideState.guide) return;

    const cards = Array.isArray(readerGuideState.guide.guide_cards)
      ? readerGuideState.guide.guide_cards
      : Array.isArray(readerGuideState.guide.questions) ? readerGuideState.guide.questions : [];

    cards.forEach((card, index) => {
      const phrases = normalizeReaderGuidePatchPhrases(card);
      const paragraph = findReaderGuidePatchParagraph(phrases);
      if (!paragraph) return;

      paragraph.classList.add("reader-guide-patched-paragraph");
      paragraph.setAttribute("data-reader-guide-patch-index", String(index));

      const separator = document.createElement("hr");
      separator.className = "reader-guide-section-break";
      separator.setAttribute("data-reader-guide-patch-index", String(index));
      paragraph.parentNode.insertBefore(separator, paragraph);

      phrases.slice(1).forEach((phrase) => {
        highlightReaderGuidePhrase(paragraph, phrase, index);
      });

      if (!paragraph.querySelector(".reader-guide-highlight") && phrases[0]) {
        highlightReaderGuidePhrase(paragraph, phrases[0].slice(0, 24), index);
      }
    });
  }

  function jumpToReaderGuideCard(index) {
    openFloatingPanel();
    setFloatingTab("guide");
    requestAnimationFrame(() => {
      const card = document.querySelector(`.reader-guide-card[data-reader-guide-card-index="${Number(index) || 0}"]`);
      if (!card) return;

      card.scrollIntoView({ block: "center", behavior: "smooth" });
      card.classList.add("is-jump-target");
      setTimeout(() => card.classList.remove("is-jump-target"), 1200);
    });
  }

  // Quiz state management
  const QUIZ_STATE_KEY = "nxl_quiz_state_v1";
  let quizState = {
    loading: false,
    currentChapter: "",
    currentSession: "",
    currentMeta: null,
    questions: [],
    answers: {},
    error: null,
  };

  function loadQuizState() {
    try {
      const raw = localStorage.getItem(QUIZ_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          quizState.questions = Array.isArray(parsed.questions) ? parsed.questions : [];
          quizState.currentChapter = String(parsed.currentChapter || "");
          quizState.currentSession = String(parsed.currentSession || "");
          quizState.currentMeta = parsed.currentMeta && typeof parsed.currentMeta === "object" ? parsed.currentMeta : null;
          quizState.answers = parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {};
        }
      }
    } catch (_) {}
  }

  function saveQuizState() {
    try {
      localStorage.setItem(QUIZ_STATE_KEY, JSON.stringify({
        questions: quizState.questions,
        currentChapter: quizState.currentChapter,
        currentSession: quizState.currentSession,
        currentMeta: quizState.currentMeta,
        answers: quizState.answers,
      }));
    } catch (_) {}
  }

  function getCurrentQuizKey() {
    const meta = quizState.currentMeta || {};
    const quizId = String(meta.quizId || "").trim();
    const lectureId = String(meta.lectureId || "").trim();
    const bookId = String(meta.bookId || "").trim();
    const chapterIndex = Number(meta.chapterIndex);
    const sessionIndex = Number(meta.sessionIndex);

    if (quizId) {
      return `server::${quizId}`;
    }

    if (!lectureId || !bookId || !Number.isInteger(chapterIndex) || !Number.isInteger(sessionIndex)) {
      return "";
    }

    return `${lectureId}::${bookId}::${chapterIndex}::${sessionIndex}`;
  }

  function getFloatingTabContent(tabName) {
    return document.querySelector(`.floating-tab-content[data-tab="${String(tabName || floatingPanelState.activeTab || "").trim()}"]`);
  }

  function preserveFloatingScroll(tabName, renderFn) {
    const before = getFloatingTabContent(tabName);
    const top = before ? Number(before.scrollTop || 0) : 0;
    renderFn();
    requestAnimationFrame(() => {
      const after = getFloatingTabContent(tabName);

      if (after) {
        after.scrollTop = top;
      }
    });
  }

  function writeStoredQuiz(quizKey, questions, answers, meta) {
    if (!quizKey) return;

    const storedQuizzes = JSON.parse(localStorage.getItem("nxl_quiz_generated_v1") || "{}");
    storedQuizzes[quizKey] = {
      questions: Array.isArray(questions) ? questions : [],
      answers: answers && typeof answers === "object" ? answers : {},
      meta: meta && typeof meta === "object" ? meta : null,
      timestamp: Date.now(),
    };
    localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));
  }

  function persistCurrentQuizAnswer(idx, record) {
    const quizKey = getCurrentQuizKey();

    if (!quizKey) {
      throw new Error("当前测验缓存键缺失，不能保存本次作答");
    }

    const storedQuizzes = JSON.parse(localStorage.getItem("nxl_quiz_generated_v1") || "{}");
    const stored = storedQuizzes[quizKey] && typeof storedQuizzes[quizKey] === "object"
      ? storedQuizzes[quizKey]
      : {
        questions: quizState.questions || [],
        answers: {},
        meta: quizState.currentMeta || null,
        timestamp: Date.now(),
      };

    const answers = stored.answers && typeof stored.answers === "object" ? stored.answers : {};
    answers[String(idx)] = record;
    stored.answers = answers;
    storedQuizzes[quizKey] = stored;
    localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));
  }

  function getQuizQuestionOptions(question) {
    const raw = Array.isArray(question && question.options) ? question.options : [];
    return raw.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4);
  }

  function getQuizQuestionType(question) {
    const options = getQuizQuestionOptions(question);
    const type = String(question && (question.type || question.question_type) || "").trim().toLowerCase();

    if (["choice", "single_choice", "multiple_choice", "选择题", "单选题"].includes(type) && options.length >= 2) {
      return "choice";
    }

    if (options.length >= 2) {
      return "choice";
    }

    return "text";
  }

  function getQuizOptionLabel(index) {
    return String.fromCharCode(65 + Number(index || 0));
  }

  function renderQuizAnswerWorkspace(question, idx, submitted, savedAnswer) {
    const type = getQuizQuestionType(question);

    if (type === "choice") {
      const options = getQuizQuestionOptions(question);
      const name = `quizChoice${idx}`;
      const rows = options.map((option, optionIndex) => {
        const label = getQuizOptionLabel(optionIndex);
        const value = `${label}. ${option}`;
        const checked = savedAnswer === value || savedAnswer === option || savedAnswer.startsWith(`${label}.`);

        return `
          <label class="quiz-option${checked ? " is-selected" : ""}">
            <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""} ${submitted ? "disabled" : ""}>
            <span class="quiz-option-letter">${label}</span>
            <span class="quiz-option-text">${escapeHtml(option)}</span>
          </label>
        `;
      }).join("");

      return `
        <div class="quiz-answer-workspace quiz-choice-workspace" data-quiz-input="${idx}">
          <div class="quiz-options">${rows}</div>
          <div class="quiz-submit-state" id="quizSubmitState${idx}" ${submitted ? "" : "hidden"}>
            ${submitted ? "已提交" : ""}
          </div>
        </div>
      `;
    }

    return `
      <div class="quiz-answer-workspace" data-quiz-input="${idx}">
        <label class="quiz-answer-label" for="quizAnswerInput${idx}">你的作答</label>
        <textarea class="quiz-answer-input" id="quizAnswerInput${idx}" rows="3" ${submitted ? "disabled" : ""} placeholder="简短写下你的理解">${escapeHtml(savedAnswer)}</textarea>
        <div class="quiz-submit-state" id="quizSubmitState${idx}" ${submitted ? "" : "hidden"}>
          ${submitted ? "已提交" : ""}
        </div>
      </div>
    `;
  }

  function readQuizStudentAnswer(question, idx) {
    if (getQuizQuestionType(question) === "choice") {
      const checked = document.querySelector(`input[name="quizChoice${idx}"]:checked`);
      return checked ? String(checked.value || "").trim() : "";
    }

    const input = document.getElementById(`quizAnswerInput${idx}`);
    return input ? String(input.value || "").trim() : "";
  }

  function focusQuizInput(question, idx) {
    if (getQuizQuestionType(question) === "choice") {
      const first = document.querySelector(`input[name="quizChoice${idx}"]`);

      if (first) {
        first.focus();
      }

      return;
    }

    const input = document.getElementById(`quizAnswerInput${idx}`);

    if (input) {
      input.focus();
    }
  }

  function renderQuizPanel() {
    const content = document.querySelector('.floating-tab-content[data-tab="quiz"]');
    if (!content) return;

    if (quizState.loading) {
      content.innerHTML = `
        <div class="quiz-loading">
          <div class="quiz-loading-spinner"></div>
          <div class="quiz-loading-text">正在生成测验题目...</div>
          <div class="quiz-loading-hint">AI正在分析学习内容</div>
        </div>
      `;
      return;
    }

    if (quizState.error) {
      content.innerHTML = `
        <div class="quiz-error">
          <div class="quiz-error-icon">⚠</div>
          <div class="quiz-error-text">${escapeHtml(quizState.error)}</div>
          <button class="quiz-retry-btn" onclick="retryQuiz()">重试</button>
        </div>
      `;
      return;
    }

    if (!quizState.questions || quizState.questions.length === 0) {
      content.innerHTML = `
        <div class="floating-empty-hint">
          <div class="quiz-empty-icon">📝</div>
          <div>完成章节阅读后开启测验</div>
        </div>
      `;
      return;
    }

    const submittedCount = quizState.questions.reduce((total, _q, idx) => {
      return total + (quizState.answers && quizState.answers[String(idx)] ? 1 : 0);
    }, 0);
    const totalCount = quizState.questions.length;
    const allSubmitted = submittedCount >= totalCount;
    let html = '<div class="quiz-list">';
    quizState.questions.forEach((q, idx) => {
      const difficultyClass = q.difficulty === "简单" ? "easy" : q.difficulty === "中等" ? "medium" : "hard";
      const answerRecord = quizState.answers && quizState.answers[String(idx)] ? quizState.answers[String(idx)] : null;
      const submitted = !!answerRecord;
      const savedAnswer = submitted ? String(answerRecord.student_answer || "") : "";
      const title = String(q.title || q.content || "").trim();
      const contentText = String(q.content || "").trim();
      const contentHtml = contentText && contentText !== title
        ? `<div class="quiz-item-content">${escapeHtml(contentText)}</div>`
        : "";

      html += `
        <div class="quiz-item" data-index="${idx}">
          <div class="quiz-item-header">
            <span class="quiz-item-index">${idx + 1}</span>
            <span class="quiz-item-difficulty ${difficultyClass}">${escapeHtml(q.difficulty || "")}</span>
          </div>
          <div class="quiz-item-title">${escapeHtml(title)}</div>
          ${contentHtml}
          ${renderQuizAnswerWorkspace(q, idx, submitted, savedAnswer)}
        </div>
      `;
    });
    html += `
      <div class="quiz-submit-all-bar">
        <div class="quiz-submit-all-status" id="quizSubmitAllStatus">${submittedCount}/${totalCount} 已提交</div>
        <button class="quiz-submit-all-btn" id="quizSubmitAllBtn" type="button" onclick="submitQuizAll()" ${allSubmitted ? "disabled" : ""}>
          ${allSubmitted ? "已全部提交" : "提交全部"}
        </button>
      </div>
    </div>`;
    content.innerHTML = html;
  }

  function showQuizHint(idx) {
    const item = document.querySelector(`.quiz-item[data-index="${idx}"]`);
    if (!item) return;
    const hint = item.querySelector(".quiz-item-hint");
    if (hint) {
      hint.hidden = !hint.hidden;
    }
  }

  function showQuizAnswer(idx) {
    if (!quizState.answers || !quizState.answers[String(idx)]) {
      showToast("先提交你的答案，再查看参考答案");
      return;
    }

    const item = document.querySelector(`.quiz-item[data-index="${idx}"]`);
    if (!item) return;
    const answer = item.querySelector(".quiz-item-answer");
    if (answer) {
      answer.hidden = !answer.hidden;
    }
  }

  function buildQuizAnswerPayload(question, idx, studentAnswer) {
    const meta = quizState.currentMeta;

    if (!meta || !question) {
      throw new Error("当前测验上下文不完整，不能提交答案");
    }

    if (!getCurrentQuizKey()) {
      throw new Error("当前测验缓存键缺失，不能提交答案");
    }

    if (!studentAnswer) {
      throw new Error("student_answer is required.");
    }

    return {
      username: getRuntimeUsername(),
      lecture_id: meta.lectureId,
      book_id: meta.bookId,
      chapter_index: meta.chapterIndex,
      session_index: meta.sessionIndex,
      chapter_name: meta.chapterName,
      session_name: meta.sessionName,
      question_index: idx,
      question_title: question.title || "",
      question_content: question.content || "",
      question_difficulty: question.difficulty || "",
      question_type: getQuizQuestionType(question),
      question_options: getQuizQuestionOptions(question),
      question_hint: question.hint || "",
      reference_answer: question.answer || "",
      student_answer: studentAnswer,
      quiz_id: String(meta.quizId || ""),
      quiz_type: String(meta.quizType || ""),
    };
  }

  function clipLearningAssistantText(text, limit) {
    const value = String(text || "").trim();
    const max = Math.max(1, Number(limit) || 1);

    if (value.length <= max) {
      return value;
    }

    return `${value.slice(0, max)}\n\n...（内容过长，已截断）`;
  }

  function getCurrentLearningPathArticleText() {
    const article = el.learningPathMarkdown ? el.learningPathMarkdown.querySelector(".lp-chapter-content") : null;
    return article ? String(article.textContent || "").trim() : "";
  }

  function buildQuizLearningAnalysisPrompt(records) {
    const meta = quizState.currentMeta || {};
    const questions = Array.isArray(quizState.questions) ? quizState.questions : [];
    const answers = quizState.answers && typeof quizState.answers === "object" ? quizState.answers : {};
    const pathData = state.learningPathData && typeof state.learningPathData === "object" ? state.learningPathData : {};
    const chapters = Array.isArray(pathData.chapters) ? pathData.chapters : [];
    const chapterIndex = Number(meta.chapterIndex);
    const chapter = Number.isInteger(chapterIndex) && chapterIndex >= 0 ? chapters[chapterIndex] || {} : {};
    const submittedRecords = Array.isArray(records) ? records : [];
    const submittedIndexSet = new Set(submittedRecords.map((record) => Number(record && record.question_index)).filter((idx) => Number.isInteger(idx)));

    if (!questions.length || !meta.quizType) {
      return "";
    }

    const questionBlocks = questions.map((question, idx) => {
      const answerRecord = answers[String(idx)] || {};
      const submittedMark = submittedIndexSet.has(idx) ? "本次提交" : "此前已提交";
      const options = getQuizQuestionOptions(question);
      const optionText = options.length ? `\n选项：${options.map((item, optionIdx) => `${String.fromCharCode(65 + optionIdx)}. ${item}`).join("；")}` : "";

      return [
        `### 题目 ${idx + 1}（${submittedMark}）`,
        `题干：${String(question.title || question.content || "").trim()}`,
        optionText ? optionText.trim() : "",
        question.hint ? `提示：${String(question.hint || "").trim()}` : "",
        `我的作答：${String(answerRecord.student_answer || answerRecord.answer || "").trim() || "未记录"}`,
        `参考答案：${String(question.answer || answerRecord.reference_answer || "").trim() || "未提供"}`,
        answerRecord.is_correct !== undefined ? `判定：${answerRecord.is_correct ? "正确" : "需要复盘"}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const articleText = clipLearningAssistantText(getCurrentLearningPathArticleText(), 6000);
    const chapterContext = [
      `课程/讲座：${String(pathData.lecture_title || pathData.course_title || meta.lectureId || "").trim()}`,
      `教材：${String(chapter.book_title || meta.bookId || "").trim()}`,
      `章节：${String(chapter.name || meta.chapterName || "").trim()}`,
      `章节范围：${String(chapter.chapter_range || meta.chapterRange || "").trim()}`,
      `测验类型：${String(meta.quizType || "").trim()}`,
    ].filter((line) => !line.endsWith("：")).join("\n");

    return [
      "我刚在 NexoraLearning 完成了一组测验提交。请你作为学习教练，结合课程上下文、生成文章内容、题目和我的作答进行解析。",
      "",
      "请按以下结构输出：",
      "1. 先指出我已经掌握的知识点。",
      "2. 再逐题解析：题目考点、我的思路可能哪里对/哪里偏、参考答案为什么成立。",
      "3. 最后给出下一步复习建议和 3 个追问问题，帮助我继续学习。",
      "",
      "## 当前学习上下文",
      chapterContext || "当前学习上下文为空。",
      "",
      "## 生成的学习文章内容",
      articleText || "当前页面没有可读取的文章内容。",
      "",
      "## 测验与作答",
      questionBlocks,
    ].join("\n");
  }

  function sendQuizLearningAnalysisToSidebar(records) {
    const text = buildQuizLearningAnalysisPrompt(records);

    if (!text) {
      return;
    }

    const meta = quizState.currentMeta || {};
    sendHostMessage({
      type: "nexora:send-message",
      text,
      guide: true,
      reader_context: {
        lecture_id: String(meta.lectureId || ""),
        book_id: String(meta.bookId || ""),
        chapter_index: Number(meta.chapterIndex) || 0,
        session_index: Number(meta.sessionIndex) || 0,
        chapter_name: String(meta.chapterName || ""),
        session_name: String(meta.sessionName || ""),
        source: "quiz_submit_analysis",
      },
    });
    showToast("已发送测验解析到 Learning 对话");
  }

  async function submitQuizAll() {
    const statusEl = document.getElementById("quizSubmitAllStatus");
    const submitBtn = document.getElementById("quizSubmitAllBtn");
    const pendingPayloads = [];

    if (!Array.isArray(quizState.questions) || !quizState.questions.length) {
      showToast("当前没有可提交的测验题目");
      return;
    }

    for (let idx = 0; idx < quizState.questions.length; idx += 1) {
      if (quizState.answers && quizState.answers[String(idx)]) {
        continue;
      }

      const question = quizState.questions[idx];
      const studentAnswer = readQuizStudentAnswer(question, idx);

      if (!studentAnswer) {
        showToast(`第 ${idx + 1} 题还没有作答`);
        focusQuizInput(question, idx);
        return;
      }

      try {
        pendingPayloads.push(buildQuizAnswerPayload(question, idx, studentAnswer));
      } catch (err) {
        showToast(err.message || "当前测验上下文不完整，不能提交答案");
        return;
      }
    }

    if (!pendingPayloads.length) {
      showToast("全部题目已经提交");
      return;
    }

    if (statusEl) {
      statusEl.textContent = "正在提交全部作答...";
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const result = await fetchJson("/api/frontend/quiz/submit-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          answers: pendingPayloads,
        }),
      });
      const records = result && Array.isArray(result.records) ? result.records : [];

      if (records.length !== pendingPayloads.length) {
        throw new Error("后端返回的作答记录数量不正确");
      }

      const pendingPayloadByIndex = new Map();
      pendingPayloads.forEach((payload) => {
        pendingPayloadByIndex.set(Number(payload.question_index), payload);
      });

      records.forEach((record) => {
        const questionIndex = Number(record && record.question_index);

        if (!Number.isInteger(questionIndex) || questionIndex < 0) {
          throw new Error("后端返回了无效题号");
        }

        quizState.answers[String(questionIndex)] = record;
        persistCurrentQuizAnswer(questionIndex, record);

        // 发射 question telemetry 事件
        const pendingPayload = pendingPayloadByIndex.get(questionIndex);
        if (pendingPayload) {
          emitTelemetry("question_answer", {
            lecture_id: pendingPayload.lecture_id || "",
            book_id: pendingPayload.book_id || "",
            chapter_index: pendingPayload.chapter_index,
            session_index: pendingPayload.session_index,
            question_id: record.question_id || "",
            difficulty: pendingPayload.question_difficulty || "",
            answer: pendingPayload.student_answer || "",
            is_correct: record.is_correct !== undefined ? record.is_correct : "",
            duration_sec: record.duration_sec !== undefined ? record.duration_sec : "",
          });
        }
      });
      saveQuizState();
      {
        const meta = quizState.currentMeta || {};
        const reportLectureId = String(meta.lectureId || "").trim();

        if (reportLectureId) {
          invalidateLearningReportCache(reportLectureId);

          if (
            state.learningPathSideTab === "report" &&
            el.learningPathView &&
            el.learningPathView.classList.contains("is-active") &&
            String(state.selectedLectureId || "").trim() === reportLectureId
          ) {
            renderLearningPathSidePanel(reportLectureId);
          }
        }
      }
      preserveFloatingScroll("quiz", renderQuizPanel);
      sendQuizLearningAnalysisToSidebar(records);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = err.message || "提交失败";
      }

      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  function getReaderChapterRange(chapter) {
    const start = Math.max(0, Number(chapter && chapter.start) || 0);
    const end = Math.max(start, Number(chapter && chapter.end) || start);
    return `${start}:${Math.max(0, end - start)}`;
  }

  function getReaderChapterContext(index) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    const chapter = chapters[idx];
    const cached = state.readerChapterCache && state.readerChapterCache[idx] !== undefined
      ? String(state.readerChapterCache[idx] || "").trim()
      : "";

    if (cached) {
      return cached;
    }

    const fullText = String(state.readerFullTextRaw || "");

    if (!chapter || !fullText) {
      return "";
    }

    const rawStart = Number(chapter.start) || 0;
    const rawEnd = Number(chapter.end) || 0;

    if (rawStart < 0 || rawEnd <= rawStart || rawEnd > fullText.length) {
      return "";
    }

    return String(fullText.slice(rawStart, rawEnd).trim() || "");
  }

  async function loadChapterQuiz(chapterIndex, chapterName, chapterRange, chapterContext) {
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    const safeChapterIndex = Number(chapterIndex) || 0;
    const safeChapterName = String(chapterName || "").trim();
    const safeChapterRange = String(chapterRange || "").trim();
    const loadingKey = `${lectureId}::${bookId}::${safeChapterIndex}::${safeChapterName}::${safeChapterRange}`;

    if (!lectureId || !bookId || !safeChapterName || !state.isReaderOpen) return;

    if (state.readerChapterQuizLoadingKey === loadingKey) return;

    const currentMeta = quizState.currentMeta || {};
    if (
      String(currentMeta.quizType || "") === "chapter" &&
      String(currentMeta.lectureId || "") === lectureId &&
      String(currentMeta.bookId || "") === bookId &&
      Number(currentMeta.chapterIndex) === safeChapterIndex &&
      Array.isArray(quizState.questions) &&
      quizState.questions.length
    ) {
      openFloatingPanel();
      setFloatingTab("quiz");
      renderQuizPanel();
      return;
    }

    state.readerChapterQuizLoadingKey = loadingKey;
    quizState.loading = true;
    quizState.error = null;
    quizState.currentChapter = safeChapterName;
    quizState.currentSession = "章节小测";
    quizState.currentMeta = {
      quizType: "chapter",
      quizId: "",
      lectureId,
      bookId,
      chapterIndex: safeChapterIndex,
      sessionIndex: 0,
      chapterName: safeChapterName,
      sessionName: "章节小测",
      chapterRange: safeChapterRange,
    };
    quizState.questions = [];
    quizState.answers = {};
    renderQuizPanel();
    openFloatingPanel();
    setFloatingTab("quiz");

    try {
      const result = await fetchJson("/api/frontend/quiz/chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: lectureId,
          book_id: bookId,
          chapter_index: safeChapterIndex,
          chapter_name: safeChapterName,
          chapter_range: safeChapterRange,
          chapter_context: String(chapterContext || "").slice(0, 12000),
          chapter_detail_xml: String(state.readerBookDetailXml || ""),
        }),
      });
      const quiz = result && result.quiz && typeof result.quiz === "object" ? result.quiz : {};
      const questions = Array.isArray(result.questions) ? result.questions : Array.isArray(quiz.questions) ? quiz.questions : [];
      const answers = result.answers && typeof result.answers === "object" ? result.answers : quiz.answers && typeof quiz.answers === "object" ? quiz.answers : {};
      const quizId = String(result.quiz_id || quiz.quiz_id || "").trim();

      if (!quizId || !questions.length) {
        throw new Error("章节小测没有返回有效题目");
      }

      quizState.questions = questions;
      quizState.answers = answers;
      quizState.currentMeta = {
        quizType: "chapter",
        quizId,
        lectureId,
        bookId,
        chapterIndex: safeChapterIndex,
        sessionIndex: 0,
        chapterName: safeChapterName,
        sessionName: "章节小测",
        chapterRange: safeChapterRange,
      };
      writeStoredQuiz(getCurrentQuizKey(), quizState.questions, quizState.answers, quizState.currentMeta);
      saveQuizState();
    } catch (err) {
      quizState.error = err && err.message ? err.message : "章节小测加载失败";
    } finally {
      quizState.loading = false;

      if (state.readerChapterQuizLoadingKey === loadingKey) {
        state.readerChapterQuizLoadingKey = "";
      }

      renderQuizPanel();
    }
  }

  async function generateSessionQuiz(chapterIndex, sessionIndex, chapterName, sessionName, sessionRange) {
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    if (!lectureId || !bookId) return;

    // 检查是否已经为这个session出过题
    const quizKey = `${lectureId}::${bookId}::${chapterIndex}::${sessionIndex}`;
    const storedQuizzes = JSON.parse(localStorage.getItem("nxl_quiz_generated_v1") || "{}");
    if (storedQuizzes[quizKey]) {
      const stored = storedQuizzes[quizKey];
      quizState.questions = stored.questions || [];
      quizState.currentChapter = chapterName;
      quizState.currentSession = sessionName;
      quizState.currentMeta = stored.meta && typeof stored.meta === "object" ? stored.meta : {
        quizType: "session",
        lectureId,
        bookId,
        chapterIndex,
        sessionIndex,
        chapterName,
        sessionName,
      };
      quizState.answers = stored.answers && typeof stored.answers === "object" ? stored.answers : {};
      saveQuizState();
      renderQuizPanel();
      openFloatingPanel();
      setFloatingTab("quiz");
      return;
    }

    quizState.loading = true;
    quizState.error = null;
    quizState.currentChapter = chapterName;
    quizState.currentSession = sessionName;
    quizState.currentMeta = {
      quizType: "session",
      lectureId,
      bookId,
      chapterIndex,
      sessionIndex,
      chapterName,
      sessionName,
    };
    quizState.answers = {};
    renderQuizPanel();
    openFloatingPanel();
    setFloatingTab("quiz");

    try {
      const result = await fetchJson("/api/frontend/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: lectureId,
          book_id: bookId,
          chapter_index: chapterIndex,
          session_index: sessionIndex,
          chapter_name: chapterName,
          session_name: sessionName,
          session_range: sessionRange,
        }),
      });

      if (result && result.success && Array.isArray(result.questions)) {
        quizState.questions = result.questions;
        writeStoredQuiz(quizKey, result.questions, {}, quizState.currentMeta);
      } else {
        quizState.error = result.error || "生成题目失败";
      }
    } catch (err) {
      quizState.error = err.message || "网络错误";
    } finally {
      quizState.loading = false;
      renderQuizPanel();
    }
  }

  function retryQuiz() {
    const meta = quizState.currentMeta || {};

    if (String(meta.quizType || "") === "personalized_chapter") {
      const lectureId = String(meta.lectureId || state.selectedLectureId || "").trim();
      const chapterIndex = Number(meta.chapterIndex) || 0;
      const chapters = state.learningPathData && Array.isArray(state.learningPathData.chapters)
        ? state.learningPathData.chapters
        : [];
      const chapter = chapters[chapterIndex] || {
        book_id: meta.bookId,
        name: meta.chapterName,
        chapter_range: meta.chapterRange,
      };
      loadPersonalizedChapterQuiz(lectureId, chapterIndex, chapter);
      return;
    }

    if (String(meta.quizType || "") === "chapter") {
      const chapterIndex = Number(meta.chapterIndex) || state.readerActiveChapterIndex;
      const chapter = state.readerChapters[chapterIndex];
      const chapterName = String(meta.chapterName || (chapter && chapter.title) || "").trim();
      const chapterRange = String(meta.chapterRange || getReaderChapterRange(chapter)).trim();
      let chapterContext = "";

      if (chapter) {
        const start = Math.max(0, Math.min(state.readerFullTextRaw.length, Number(chapter.start) || 0));
        const end = Math.max(start, Math.min(state.readerFullTextRaw.length, Number(chapter.end) || 0));
        chapterContext = String(state.readerFullTextRaw.slice(start, end).trim() || "");
      }

      loadChapterQuiz(chapterIndex, chapterName, chapterRange, chapterContext);
      return;
    }

    // 获取当前session信息并重新生成
    const chapterIndex = state.readerActiveChapterIndex;
    const chapter = state.readerChapters[chapterIndex];
    if (!chapter) return;

    const chapterName = String(chapter.title || "").trim();
    const sectionData = state.readerSectionsData[chapterName];
    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions.length) return;

    // 找到最近完成的session
    const progress = ensureReaderSessionProgress();
    if (!progress || !progress.completedSessions) return;

    let lastCompletedSession = null;
    sectionData.sessions.forEach((s, sIdx) => {
      const sessionKey = `${chapterIndex}:${sIdx}`;
      if (progress.completedSessions.has(sessionKey)) {
        lastCompletedSession = { index: sIdx, ...s };
      }
    });

    if (lastCompletedSession) {
      // 清除缓存
      const lectureId = String(state.selectedLectureId || "").trim();
      const bookId = String(state.selectedBookId || "").trim();
      const quizKey = `${lectureId}::${bookId}::${chapterIndex}::${lastCompletedSession.index}`;
      const storedQuizzes = JSON.parse(localStorage.getItem("nxl_quiz_generated_v1") || "{}");
      delete storedQuizzes[quizKey];
      localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));

      generateSessionQuiz(
        chapterIndex,
        lastCompletedSession.index,
        chapterName,
        lastCompletedSession.name || "",
        lastCompletedSession.range || ""
      );
    }
  }

  // 暴露全局函数
  window.showQuizHint = showQuizHint;
  window.showQuizAnswer = showQuizAnswer;
  window.submitQuizAll = submitQuizAll;
  window.retryQuiz = retryQuiz;

  loadQuizState();

  function initFloatingPanel() {
    const btn = document.getElementById("readerFloatingBtn");
    const closeBtn = document.getElementById("closeFloatingPanelBtn");
    const panel = document.getElementById("readerFloatingPanel");

    if (btn) {
      btn.addEventListener("click", () => toggleFloatingPanel());
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", () => closeFloatingPanel());
    }

    if (panel) {
      const tabs = panel.querySelectorAll(".floating-tab");
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          setFloatingTab(tab.dataset.tab);
        });
      });
      panel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const guideBtn = target.closest("[data-reader-guide-action]");
        if (!guideBtn) return;

        const action = String(guideBtn.getAttribute("data-reader-guide-action") || "").trim();

        if (action === "generate") {
          generateReaderGuide(false);
          return;
        }

        if (action === "generate-force") {
          generateReaderGuide(true);
          return;
        }

        if (action === "dismiss") {
          closeFloatingPanel();
          return;
        }

        if (action === "toggle-complete") return;

        if (action === "toggle-card") {
          const index = Number(guideBtn.getAttribute("data-reader-guide-index") || "0");
          const cardState = getReaderGuideCardState(index);
          setReaderGuideCardState(index, { collapsed: !cardState.collapsed });
          renderReaderGuidePanel();
          return;
        }

        if (action === "ask") {
          askReaderGuideQuestion(Number(guideBtn.getAttribute("data-reader-guide-index") || "0"));
          return;
        }

        if (action === "submit-pre-qa") {
          submitPreReadingQA();
          return;
        }

        if (action === "skip-pre-qa") {
          skipPreReadingQA();
          return;
        }
      });
      panel.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;

        const action = String(target.getAttribute("data-reader-guide-action") || "").trim();
        if (action !== "toggle-complete") return;

        const index = Number(target.getAttribute("data-reader-guide-index") || "0");
        const checked = !!target.checked;
        setReaderGuideCardState(index, { completed: checked, collapsed: checked });
        renderReaderGuidePanel();
      });
    }
  }

  initFloatingPanel();

  function closeReader(isUnload) {
    resetReaderSelectionTelemetry();
    if (state.isReaderOpen && Array.isArray(state.readerChapters) && state.readerChapters.length) {
      reportReaderChapterComplete(state.readerActiveChapterIndex, isUnload).catch((err) => {
        console.warn("[NXL-Reader] chapter complete on close failed", err);
      });
    }
    clearReaderTelemetrySessionContext("close");
    const telemetry = window.NXLTelemetry;
    if (telemetry && typeof telemetry.clearBasicReaderContext === "function") {
      telemetry.clearBasicReaderContext();
    }
    closeFloatingPanel();
    // 仅当 selectedBookId 已设置时才发射 telemetry，避免未选择书籍时产生噪声事件
    if (String(state.selectedBookId || "").trim()) {
      emitTelemetry("reader_close", {
        lecture_id: String(state.selectedLectureId || "").trim(),
        book_id: String(state.selectedBookId || "").trim(),
        chapter_index: Number(state.readerActiveChapterIndex) || 0,
        chapter_title: String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim(),
      });
    }
    state.isReaderOpen = false;
    state.readerRequestToken += 1;
    setReaderFullscreen(false);
    setReaderSettingsPanelOpen(false);
    setChapterListPanelOpen(false);
    document.body.classList.remove("reader-settings-open");
    state.readerChapters = [];
    state.readerActiveChapterIndex = 0;
    state.readerFullTextRaw = "";
    state.readerImages = [];
    state.readerBookDetailXml = "";
    state.readerViewMode = "closed";
    state.readerMeta = { title: "", subtitle: "" };
    state.readerReportedChapterKey = "";
    state.readerReportingChapterKey = "";
    state.readerChapterQuizLoadingKey = "";
    state.readerSectionsData = {};
    state.readerAnnotations = [];
    state.readerChapterCache = {};
    state.readerGuidePromptedKey = "";
    readerGuideState = { status: "empty", target: null, guide: null, error: "", draft: "" };
    renderReaderGuidePanel();
    syncFloatingBtnVisibility();
    syncReaderModeUI();
    el.readerPane.hidden = true;
    syncMaterialsPageMode();
    notifyHostLayout("default", { hideInputDock: true });
    notifyHostReaderState(false);
    notifyHostReaderContext();
  }

  function setReaderFullscreen(active) {
    const fs = !!active;
    state.isReaderFullscreen = fs;
    document.body.classList.toggle("reader-fullscreen-active", fs);
    document.body.style.overflow = fs ? "hidden" : "";
    if (el.learningPanel) el.learningPanel.classList.toggle("reader-fill-active", fs);
    if (el.readerClickAreas) el.readerClickAreas.hidden = !fs;
    if (!fs) {
      setReaderHeaderVisible(true);
      if (el.readerSettingsPanel) el.readerSettingsPanel.classList.remove("show");
      if (el.chapterListPanel) el.chapterListPanel.classList.remove("show");
      document.body.classList.remove("reader-settings-open");
    }
    notifyHostLayout(fs ? "immersive" : "default", { hideInputDock: true });
    syncReaderModeUI();
    applyReaderTypography();
  }

// ─────── Upload & Materials Actions ───────────────────────────────────
  function setSelectedUploadLecture(lectureId) {
    const id = String(lectureId || "").trim();
    const row = state.allLectureRows.find((it) => String((it.lecture || {}).id || "") === id);
    if (!row) return;
    state.selectedLectureId = id;
    el.materialsLectureIdHidden.value = id;
    el.materialsLectureInput.value = getLectureTitle(row.lecture || {});
  }

  function renderUploadLectureInputDefault() {
    if (!state.allLectureRows.length) {
      el.materialsLectureInput.value = "";
      el.materialsLectureIdHidden.value = "";
      return;
    }
    if (!state.selectedLectureId) {
      state.selectedLectureId = String((state.allLectureRows[0].lecture || {}).id || "");
    }
    setSelectedUploadLecture(state.selectedLectureId);
  }

  function clearPreviewObjectUrl() {
    if (state.previewObjectUrl) {
      URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = "";
    }
  }

  function setUploadTip(msg, isError) {
    el.uploadTip.textContent = msg || "";
    el.uploadTip.style.color = isError ? "#b91c1c" : "";
  }

  function renderSelectedUploadFileState(file) {
    if (!el.materialsFileDropZone || !el.materialsFileDropTitle || !el.materialsFileDropSub) {
        return;
    }

    const selectedFile = file || state.selectedUploadFile;
    if (!selectedFile) {
        el.materialsFileDropZone.classList.remove("has-file");
        el.materialsFileDropTitle.textContent = "拖拽教材文件到这里";
        el.materialsFileDropSub.textContent = "或点击区域选择文件";
        return;
    }

    const name = String(selectedFile.name || "").trim();
    const sizeMB = selectedFile.size ? (selectedFile.size / (1024 * 1024)).toFixed(2) : "0.00";

    el.materialsFileDropZone.classList.add("has-file");
    el.materialsFileDropTitle.textContent = name || "已选择教材文件";
    el.materialsFileDropSub.textContent = `${sizeMB} MB · 点击或拖拽可替换`;
  }

  function renderUploadPreviewEmpty(msg) {
    state.uploadRightMode = "preview";
    el.materialsPreviewHead.textContent = "教材预览";
    clearPreviewObjectUrl();
    el.materialsPreviewPane.innerHTML = `<div class="materials-empty">${escapeHtml(msg || "暂无预览")}</div>`;
  }

  function renderCoursePicker(queryText) {
    state.uploadRightMode = "picker";
    el.materialsPreviewHead.textContent = "课程选择";
    const q = String(queryText || "").trim().toLowerCase();
    const list = state.allLectureRows.filter((row) => {
      const lecture = row.lecture || {};
      const title = getLectureTitle(lecture).toLowerCase();
      const category = String(lecture.category || "").toLowerCase();
      return !q || title.includes(q) || category.includes(q);
    });
    el.materialsPreviewPane.innerHTML = `
      <input id="coursePickerSearchInput" class="course-picker-search" placeholder="搜索课程名 / 分类" value="${escapeHtml(queryText || "")}">
      <div class="course-picker-list">
        ${list.length ? list.map((row) => {
          const lecture = row.lecture || {};
          const id = String(lecture.id || "");
          const active = id === String(el.materialsLectureIdHidden.value || "") ? "is-active" : "";
          return `
          <article class="lecture-item ${active}" data-course-picker-id="${escapeHtml(id)}">
            <div class="lecture-title">${escapeHtml(getLectureTitle(lecture))}</div>
            <div class="lecture-meta">${escapeHtml(`${lecture.category || "未分类"} · ${statusText(lecture.status)}`)}</div>
          </article>`;
        }).join("") : '<div class="materials-empty">无匹配课程</div>'}
      </div>
    `;
  }

  async function previewSelectedFile(file) {
    state.uploadRightMode = "preview";
    el.materialsPreviewHead.textContent = "教材预览";
    if (!file) {
      renderUploadPreviewEmpty("请选择教材文件后预览");
      return;
    }
    rememberSelectedUploadFile(file);
    clearPreviewObjectUrl();
    const name = String(file.name || "");
    const lower = name.toLowerCase();
    const type = String(file.type || "").toLowerCase();
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

    if (type === "application/pdf" || lower.endsWith(".pdf")) {
      const url = URL.createObjectURL(file);
      state.previewObjectUrl = url;
      el.materialsPreviewPane.innerHTML = `
        <iframe class="materials-preview-frame" src="${escapeHtml(url)}" title="PDF 预览"></iframe>
        <div class="materials-preview-foot">文件：${escapeHtml(name)} · 大小：${sizeMB} MB</div>
      `;
      return;
    }

    if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".c") || lower.endsWith(".h") || lower.endsWith(".py") || lower.endsWith(".rst")) {
      const text = await file.text();
      const clipped = text.length > 12000 ? `${text.slice(0, 12000)}\n\n...（预览已截断）` : text;
      el.materialsPreviewPane.innerHTML = `
        <div class="materials-preview-text">${formatReaderText(clipped || "（空文件）")}</div>
        <div class="materials-preview-foot">文件：${escapeHtml(name)} · 大小：${sizeMB} MB</div>
      `;
      return;
    }

    el.materialsPreviewPane.innerHTML = `
      <div class="materials-empty">该文件将上传后提取为纯文本，当前仅显示基础信息</div>
      <div class="materials-preview-foot">文件：${escapeHtml(name)} · 大小：${sizeMB} MB</div>
    `;
  }

  async function handleSelectedUploadFile(file) {
    if (!file) {
        if (state.selectedUploadFile) {
            renderSelectedUploadFileState(state.selectedUploadFile);
            return;
        }

        renderUploadPreviewEmpty("请选择教材文件后预览");
        renderSelectedUploadFileState(null);
        return;
    }

    rememberSelectedUploadFile(file);

    try {
        await previewSelectedFile(file);
        setUploadTip(`已选择：${String(file.name || "").trim()}`, false);
    } catch (err) {
        const name = String(file.name || "").trim();
        const sizeMB = file && file.size ? (file.size / (1024 * 1024)).toFixed(2) : "0.00";
        el.materialsPreviewPane.innerHTML = `
          <div class="materials-empty">文件已选择，但当前无法生成预览</div>
          <div class="materials-preview-foot">文件：${escapeHtml(name)} · 大小：${sizeMB} MB</div>
        `;
        setUploadTip(`已选择：${name}。预览失败：${err && err.message ? err.message : "未知错误"}`, true);
    }
  }

  async function fetchJson(url, init) {
    const options = init && typeof init === "object" ? { ...init } : {};
    const headers = new Headers(options.headers || {});
    const runtimeUsername = getRuntimeUsername();

    if (runtimeUsername && !headers.has("X-Nexora-Username")) {
      headers.set("X-Nexora-Username", runtimeUsername);
    }

    if (typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    options.headers = headers;

    if (!options.credentials) {
      options.credentials = "same-origin";
    }

    const resp = await fetch(resolveApiUrl(url), options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    return data;
  }

  async function loadFrontendContext() {
    const qs = state.username ? `?username=${encodeURIComponent(state.username)}` : "";
    try {
      const data = await fetchJson(`/api/frontend/context${qs}`, { credentials: "include" });
      state.user = data && typeof data.user === "object" ? data.user : {};
      state.integration = data && typeof data.integration === "object" ? data.integration : {};
      if (!state.username) state.username = String(data.username || "").trim();
      syncTelemetryUserId();
      const role = String(state.user.role || "").trim().toLowerCase();
      state.isAdmin = !!data.is_admin || role === "admin";
    } catch (err) {
      console.error("[NexoraLearning] frontend context failed", {
        username: getRuntimeUsername(),
        message: err && err.message ? String(err.message) : String(err || ""),
      });
      state.user = {};
      state.integration = {};
      state.isAdmin = false;
    }
  }

// ─────── Settings Channels ────────────────────────────────────────────

  /**
   * 渲染用户卡片（参考用户管理样式）
   */
  function renderUserCardHtml(user, isSelected, isEditing, channelId) {
      const userId = String(user.user_id || user.id || "").trim();
      const displayName = String(user.display_name || user.name || userId).trim();
      const nickname = String(user.nickname || "").trim();
      const handle = String(user.handle || user.user_id || "").trim();
      const avatarUrl = normalizeFeedAvatarUrl(String(user.avatar_url || "").trim());
      const avatarText = String((displayName || nickname || userId || "U").trim().slice(0, 1) || "U").toUpperCase();

      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      const MINUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      const addAction = isEditing ? "add-user-to-channel" : "add-user-to-selection";
      const removeAction = isEditing ? "remove-user-from-channel" : "remove-user-from-selection";
      const channelAttr = isEditing && channelId ? ` data-channel-id="${escapeHtml(channelId)}"` : "";

      return `
          <article class="settings-user-card channel-user-card" data-user-id="${escapeHtml(userId)}">
              <div class="settings-user-main">
                  ${avatarUrl
                      ? `<img class="settings-user-avatar settings-user-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                      : `<div class="settings-user-avatar">${escapeHtml(avatarText)}</div>`}
                  <div class="settings-user-meta">
                      <div class="settings-user-title">
                          <span>${escapeHtml(displayName)}</span>
                          ${nickname && nickname !== displayName ? `<span class="settings-user-pill">${escapeHtml(nickname)}</span>` : ""}
                      </div>
                      <div class="settings-user-sub">@${escapeHtml(handle || userId)}</div>
                  </div>
              </div>
              <div class="channel-user-action">
                  ${isSelected
                      ? `<button class="channel-action-btn channel-action-remove" type="button" data-action="${removeAction}" data-user-id="${escapeHtml(userId)}"${channelAttr} title="移出" aria-label="移出">${MINUS_ICON}</button>`
                      : `<button class="channel-action-btn channel-action-add" type="button" data-action="${addAction}" data-user-id="${escapeHtml(userId)}"${channelAttr} title="添加" aria-label="添加">${PLUS_ICON}</button>`}
              </div>
          </article>
      `;
  }

  /**
   * 渲染频道编辑面板（右侧内容）
   */
  function renderChannelEditPanelHtml(channel, allUsers) {
      const channelId = String(channel ? (channel.id || "") : "").trim();
      const isEditing = !!channel;
      const title = isEditing ? String(channel.title || "") : String(state.channelEditState.title || "");
      const isPublic = state.channelEditState.isAllPublic === true;
      const selectedUserIds = Array.isArray(state.channelEditState.selectedUserIds) ? state.channelEditState.selectedUserIds : [];
      const selectedSet = new Set(selectedUserIds);

      const selectedUsers = [];
      const otherUsers = [];

      if (isPublic) {
          // 全员公开时，显示 ALL 卡片，其他用户放在可选列表
          otherUsers.push(...allUsers);
      } else {
          for (const user of allUsers) {
              const userId = String(user.user_id || user.id || "").trim();
              if (selectedSet.has(userId)) {
                  selectedUsers.push(user);
              } else {
                  otherUsers.push(user);
              }
          }
      }

      const searchQuery = String(state.channelEditState.searchQuery || "").trim();

      let filteredOtherUsers = otherUsers;
      if (searchQuery) {
          const query = searchQuery.toLowerCase();
          filteredOtherUsers = otherUsers.filter((user) => {
              const userId = String(user.user_id || user.id || "").toLowerCase();
              const displayName = String(user.display_name || user.name || "").toLowerCase();
              const nickname = String(user.nickname || "").toLowerCase();
              return userId.includes(query) || displayName.includes(query) || nickname.includes(query);
          });
      }

      const ALL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      const MINUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

      return `
          <div class="channel-edit-form">
              <div class="materials-form-row">
                  <label class="materials-form-label" for="settingsChannelTitleInput">频道名</label>
                  <div class="channel-title-input-row">
                      <input id="settingsChannelTitleInput" class="input-lite" placeholder="例如：春物私有研读" value="${escapeHtml(title)}">
                      <button id="saveFeedChannelBtn" class="settings-course-action-btn" type="button" aria-label="保存频道" title="保存频道">${SAVE_ICON}</button>
                  </div>
              </div>
          </div>
          <div class="channel-users-layout">
              <div class="channel-users-column">
                  <div class="channel-users-header">
                      <span class="channel-users-title">已选用户 (${isPublic ? "全员" : selectedUsers.length})</span>
                  </div>
                   <div class="channel-users-list">
                      ${isPublic
                          ? `<article class="settings-user-card channel-user-card channel-all-card">
                                  <div class="settings-user-main">
                                      <div class="settings-user-avatar channel-all-avatar">${ALL_ICON}</div>
                                      <div class="settings-user-meta">
                                          <div class="settings-user-title"><span>全员公开</span></div>
                                          <div class="settings-user-sub">所有用户可见</div>
                                      </div>
                                  </div>
                                  <div class="channel-user-action">
                                      <button class="channel-action-btn channel-action-remove" type="button" data-action="toggle-all-public-off" title="取消全员公开" aria-label="取消全员公开">${MINUS_ICON}</button>
                                  </div>
                              </article>`
                          : selectedUsers.length
                              ? selectedUsers.map((user) => renderUserCardHtml(user, true, isEditing, channelId)).join("")
                              : '<div class="materials-empty">暂无用户</div>'}
                  </div>
              </div>
              <div class="channel-users-column">
                  <div class="channel-users-header">
                      <span class="channel-users-title">可选用户 (${filteredOtherUsers.length})</span>
                      <input class="input-lite channel-user-search" type="text" placeholder="搜索用户..." value="${escapeHtml(searchQuery)}" data-channel-user-search>
                  </div>
                  <div class="channel-users-list">
                      ${!isPublic ? `
                          <article class="settings-user-card channel-user-card channel-all-option" data-action="toggle-all-public-on">
                              <div class="settings-user-main">
                                  <div class="settings-user-avatar channel-all-avatar">${ALL_ICON}</div>
                                  <div class="settings-user-meta">
                                      <div class="settings-user-title"><span>全员公开</span></div>
                                      <div class="settings-user-sub">点击设为全员公开</div>
                                  </div>
                              </div>
                              <div class="channel-user-action">
                                  <button class="channel-action-btn channel-action-add" type="button" title="设为全员公开" aria-label="设为全员公开">${PLUS_ICON}</button>
                              </div>
                          </article>
                      ` : ""}
                      ${filteredOtherUsers.length
                          ? filteredOtherUsers.map((user) => renderUserCardHtml(user, false, isEditing, channelId)).join("")
                          : '<div class="materials-empty">暂无用户</div>'}
                  </div>
              </div>
          </div>
      `;
  }

  /**
   * 渲染课程管理设置页面
   */
  function renderSettingsCourses() {
    const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const firstLectureId = rows.length ? String((rows[0].lecture || {}).id || "").trim() : "";
    const selectedId = state.settingsCourseEditId || firstLectureId;
    if (selectedId && state.settingsCourseEditId !== selectedId) {
      state.settingsCourseEditId = selectedId;
    }

    const courseListHtml = rows.length
      ? rows.map((row) => {
          const lecture = row.lecture || {};
          const lid = String(lecture.id || "").trim();
          const title = String(lecture.title || "未命名课程").trim();
          const isActive = lid === selectedId && state.settingsCourseView !== "create";
          const bookCount = Array.isArray(row.books) ? row.books.length : 0;
          const category = String(lecture.category || "未分类").trim();
          const coverPath = String(lecture.cover_path || lecture.cover || "").trim();
          return `
            <div class="settings-course-list-item${isActive ? " is-active" : ""}" data-action="select-settings-course" data-lecture-id="${escapeHtml(lid)}">
              ${coverPath
                ? `<div class="settings-course-list-cover"><img src="${escapeHtml(resolveApiUrl(coverPath))}" alt=""></div>`
                : '<div class="settings-course-list-cover settings-course-list-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>'}
              <div class="settings-course-list-info">
                <span class="settings-course-list-title">${escapeHtml(title)}</span>
              <span class="settings-course-list-meta">${escapeHtml(category)} · ${bookCount} 本教材</span>
              </div>
            </div>
          `;
        }).join("")
      : '<div class="materials-empty">暂无课程</div>';

    const selectedRow = selectedId
      ? rows.find((row) => String((row.lecture || {}).id || "").trim() === selectedId)
      : null;
    const lecture = selectedRow ? (selectedRow.lecture || {}) : {};
    const books = selectedRow ? (Array.isArray(selectedRow.books) ? selectedRow.books : []) : [];
    const lectureTitle = String(lecture.title || "").trim();
    const lectureCategory = String(lecture.category || "").trim();
    const lectureDescription = String(lecture.description || "").trim();
    const coverPath = String(lecture.cover_path || lecture.cover || "").trim();
    const outlineState = getLectureOutlineState(selectedId);
    const outlineActivity = state.outlineActivity || {};
    const isOutlineRunning = Boolean(outlineActivity.running && outlineActivity.lectureId === selectedId);

    const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
    const COVER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    const OUTLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>';

    const createPanelHtml = `
      <section class="settings-course-workbench">
        <section class="settings-inline-card settings-course-create-page">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">新建课程</div>
              <div class="settings-inline-sub">课程是教材、大纲与个性化学习路线的归属单位。</div>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="show-settings-course-detail" aria-label="返回列表" title="返回列表">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
          <div class="settings-inline-form settings-course-create-form">
            <label class="settings-field">
              <span>课程名</span>
              <input id="settingsCreateLectureTitleInput" class="input-lite" placeholder="例如：机器学习导论">
            </label>
            <label class="settings-field">
              <span>分类</span>
              <input id="settingsCreateLectureCategoryInput" class="input-lite" placeholder="AI / 前端 / 语言">
            </label>
            <label class="settings-field">
              <span>状态</span>
              <select id="settingsCreateLectureStatusSelect" class="input-lite">
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="ready">已准备</option>
                <option value="archived">归档</option>
              </select>
            </label>
            <label class="settings-field settings-field-wide">
              <span>描述</span>
              <textarea id="settingsCreateLectureDescriptionInput" class="input-lite input-textarea" placeholder="课程简介、目标、学习范围"></textarea>
            </label>
            <button class="settings-course-action-btn" type="button" data-action="create-settings-course" aria-label="创建课程" title="创建课程">
              ${SAVE_ICON}
            </button>
          </div>
        </section>
      </section>
    `;

    const editPanelHtml = selectedId && selectedRow ? `
      <section class="settings-course-workbench">
        <div class="settings-course-two-column">
          <section class="settings-inline-card">
            <div class="settings-inline-head">
              <div>
                <div class="settings-inline-title">课程资料</div>
                <div class="settings-inline-sub">当前课程的基础信息和封面都在这里维护。</div>
              </div>
              <button class="settings-course-action-btn" type="button" data-action="save-settings-course" aria-label="保存课程" title="保存课程">${SAVE_ICON}</button>
            </div>
            <div class="settings-course-form-body">
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程名称</label>
                <input id="settingsCourseTitleInput" class="input-lite" value="${escapeHtml(lectureTitle)}" placeholder="课程名称">
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程分类</label>
                <input id="settingsCourseCategoryInput" class="input-lite" value="${escapeHtml(lectureCategory)}" placeholder="例如：AI / 前端 / 语言">
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程简介</label>
                <textarea id="settingsCourseDescInput" class="input-lite input-textarea" rows="3" placeholder="课程简介">${escapeHtml(lectureDescription)}</textarea>
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程封面</label>
                <div class="settings-course-cover-area">
                  <div class="settings-course-cover-preview" id="settingsCourseCoverPreview">
                    ${coverPath
                      ? `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="封面">`
                      : `<div class="settings-course-cover-empty">${COVER_ICON}<span>暂无封面</span></div>`}
                  </div>
                  <input type="hidden" id="settingsCourseCoverInput" value="${escapeHtml(coverPath)}">
                  <button class="settings-course-cover-btn" type="button" data-action="open-cover-picker" aria-label="选择封面" title="选择封面">${COVER_ICON}</button>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-inline-card settings-outline-card">
            <div class="settings-inline-head">
              <div>
                <div class="settings-inline-title">课程大纲</div>
                <div class="settings-inline-sub">大纲属于课程，不再混在教材解析流程里。</div>
              </div>
              <span class="settings-status-pill is-${escapeHtml(isOutlineRunning ? "running" : outlineState.tone)}">${escapeHtml(isOutlineRunning ? "生成中" : outlineState.label)}</span>
            </div>
            <div class="settings-outline-body">
              <div class="settings-outline-icon">${OUTLINE_ICON}</div>
              <div class="settings-outline-copy">
                <div class="settings-outline-title">${escapeHtml(lectureTitle || "未命名课程")}</div>
                <div class="settings-inline-sub">${escapeHtml(outlineActivity.error || outlineState.error || "从该课程已有教材汇总生成统一大纲，学习路径直接读取这里。")}</div>
              </div>
            </div>
            <div class="settings-outline-activity">
              <div class="settings-outline-activity-head">模型活动</div>
              <div class="settings-outline-activity-body">
                ${(isOutlineRunning ? (outlineActivity.lines || []) : [
                  outlineState.status ? `当前状态：${outlineState.label}` : "尚未生成课程大纲",
                  "点击“生成大纲”后，这里会实时显示模型活动。",
                ]).map((line) => `<div class=\"settings-outline-activity-line\">${escapeHtml(line)}</div>`).join("")}
              </div>
              <section class="reader-guide-stream settings-outline-stream">
                <div class="reader-guide-stream-label">实时输出</div>
                <pre class="reader-guide-draft settings-outline-draft">${escapeHtml(String(outlineActivity.draft || "").trim() || "等待模型开始输出...")}</pre>
              </section>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="start-course-outline" data-lecture-id="${escapeHtml(selectedId)}" ${(canStartOutline({ outline_status: outlineState.status }) && !isOutlineRunning) ? "" : "disabled"} aria-label="${escapeHtml(isOutlineRunning ? "生成中" : "生成大纲")}" title="${escapeHtml(isOutlineRunning ? "生成中" : "生成大纲")}">
              ${OUTLINE_ICON}
            </button>
          </section>
        </div>

        <section class="settings-inline-card">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">课程教材</div>
              <div class="settings-inline-sub">这里只看归属和状态，上传与解析统一回到教材管理。</div>
            </div>
          </div>
          <div class="settings-course-book-grid">
            ${books.length
              ? books.map((b) => {
                  const bookTitle = String(b.title || b.id || "").trim();
                  const bookCover = String(b.cover_path || "").trim();
                  const bookImages = b.images_count || 0;
                  const textStatus = String(b.text_status || b.status || "未解析").trim();
                  return `
                    <div class="settings-course-book-card">
                      ${bookCover
                        ? `<div class="settings-course-book-cover"><img src="${escapeHtml(resolveApiUrl(bookCover))}" alt=""></div>`
                        : '<div class="settings-course-book-cover settings-course-book-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/></svg></div>'}
                      <div class="settings-course-book-info">
                        <span class="settings-course-book-title">${escapeHtml(bookTitle)}</span>
                        <span class="settings-course-book-meta">${escapeHtml(textStatus)}${bookImages > 0 ? ` · ${bookImages} 张图` : ""}</span>
                      </div>
                    </div>
                  `;
                }).join("")
              : '<div class="materials-empty">暂无教材</div>'}
          </div>
        </section>
      </section>
    ` : `
      <section class="settings-course-workbench">
        <div class="materials-empty" style="padding:40px;">请从左侧选择课程</div>
      </section>
    `;

    el.settingsDetailPane.innerHTML = `
      <section class="channel-settings-layout settings-course-layout">
        <aside class="channel-list-pane settings-course-list-pane">
          <div class="channel-list-header">
            <span class="channel-list-title">课程列表 (${rows.length})</span>
            <button class="channel-list-btn" type="button" data-action="show-settings-course-create" aria-label="新建课程" title="新建课程">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
          <div class="channel-list-content">
            ${courseListHtml}
          </div>
        </aside>
        <main class="channel-edit-pane settings-course-edit-pane">
          ${state.settingsCourseView === "create" ? createPanelHtml : editPanelHtml}
        </main>
      </section>
      <div id="coverPickerModal" class="settings-cover-picker-modal" hidden>
        <div class="settings-cover-picker-backdrop"></div>
        <div class="settings-cover-picker-dialog">
          <div class="settings-cover-picker-header">
            <span class="settings-cover-picker-title">选择封面</span>
            <button class="settings-cover-picker-close" type="button" data-action="close-cover-picker">✕</button>
          </div>
          <div class="settings-cover-picker-body" id="coverPickerBody">
            <div class="materials-empty">加载中...</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 打开封面选择器，加载课程下所有教材的图片
   */
  async function openCoverPicker() {
      const lectureId = state.settingsCourseEditId;
      if (!lectureId) return;

      const modal = document.getElementById("coverPickerModal");
      if (modal) modal.hidden = false;

      const body = document.getElementById("coverPickerBody");
      if (!body) return;

      body.innerHTML = '<div class="materials-empty">加载中...</div>';

      try {
          const res = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/cover-assets`);
          const items = Array.isArray(res.items) ? res.items : [];

          if (!items.length) {
              body.innerHTML = '<div class="materials-empty">暂无可用图片，请先解析教材</div>';
              return;
          }

          const currentCover = String(
              (document.getElementById("settingsCourseCoverInput") || {}).value || ""
          ).trim();

          const grouped = {};
          for (const item of items) {
              const bookTitle = String(item.book_title || "未知教材").trim();
              if (!grouped[bookTitle]) grouped[bookTitle] = [];
              grouped[bookTitle].push(item);
          }

          let html = "";
          for (const [bookTitle, bookItems] of Object.entries(grouped)) {
              html += `<div class="settings-cover-picker-book-title">${escapeHtml(bookTitle)}</div>`;
              html += '<div class="settings-cover-picker-grid">';
              for (const item of bookItems) {
                  const coverPath = String(item.cover_path || "").trim();
                  const imageUrl = String(item.image_url || "").trim();
                  const isSelected = coverPath === currentCover;
                  html += `
                      <div class="settings-cover-picker-item${isSelected ? " is-selected" : ""}" data-action="select-cover-image" data-cover-path="${escapeHtml(coverPath)}">
                          <img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">
                      </div>
                  `;
              }
              html += "</div>";
          }

          body.innerHTML = html;
      } catch (err) {
          body.innerHTML = `<div class="materials-empty">加载失败：${escapeHtml(err.message || "未知错误")}</div>`;
      }
  }

  /**
   * 关闭封面选择器
   */
  function closeCoverPicker() {
      const modal = document.getElementById("coverPickerModal");
      if (modal) modal.hidden = true;
  }

  function getLectureOutlineState(lectureId) {
      const targetId = String(lectureId || "").trim();
      const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];
      const item = rows.find((row) => String(row.lecture_id || "").trim() === targetId) || {};
      const status = normalizeStatusKey(item.outline_status);
      const error = String(item.outline_error || "").trim();
      if (isDoneStatus(status)) return { status, label: "已生成", tone: "done", error };
      if (isRunningStatus(status)) return { status, label: "生成中", tone: "running", error };
      if (isErrorStatus(status)) return { status, label: "生成失败", tone: "error", error };
      return { status, label: "未生成", tone: "idle", error };
  }

  /**
   * 渲染频道设置页面主函数
   */
  function renderSettingsChannels() {
      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels.filter((row) => row && !row.builtin) : [];
      const allUsers = Array.isArray(state.settingsUsers) ? state.settingsUsers : [];
      const editState = state.channelEditState;
      const selectedChannelId = editState.channelId;
      const selectedChannel = selectedChannelId
          ? channels.find((row) => String((row && row.id) || "").trim() === selectedChannelId)
          : null;

      const channelListHtml = channels.length
          ? channels.map((row) => {
              const channelId = String(row.id || "").trim();
              const channelTitle = String(row.title || "").trim();
              const isActive = channelId === selectedChannelId;
              const memberCount = Array.isArray(row.member_user_ids) ? row.member_user_ids.length : 0;
              const isPublic = String(row.type || "").trim() === "public";

              return `
                  <div class="channel-list-item${isActive ? " is-active" : ""}" data-action="select-channel" data-channel-id="${escapeHtml(channelId)}">
                      <div class="channel-list-item-main">
                          <span class="channel-list-item-title">${escapeHtml(channelTitle)}</span>
                          <span class="channel-list-item-meta">${isPublic ? "全员公开" : `${memberCount} 人`}</span>
                      </div>
                      <button class="channel-list-item-delete" type="button" data-action="delete-feed-channel" data-channel-id="${escapeHtml(channelId)}" title="删除频道" aria-label="删除频道"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  </div>
              `;
          }).join("")
          : '<div class="materials-empty">暂无自定义频道</div>';

      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      el.settingsDetailPane.innerHTML = `
          <section class="channel-settings-layout">
              <aside class="channel-list-pane">
                  <div class="channel-list-header">
                      <span class="channel-list-title">现有频道列表</span>
                      <button id="createNewChannelBtn" class="channel-list-btn" type="button" aria-label="新建频道" title="新建频道">${PLUS_ICON}</button>
                  </div>
                  <div class="channel-list-content">
                      ${channelListHtml}
                  </div>
              </aside>
              <main class="channel-edit-pane">
                  ${renderChannelEditPanelHtml(selectedChannel, allUsers)}
              </main>
          </section>
      `;
  }

  /**
   * 打开频道编辑对话框
   */
  function openChannelEditDialog(channelId) {
      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);

      state.channelEditState = {
          channelId: channelId,
          title: channel ? String(channel.title || "") : "",
          selectedUserIds: channel && Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [],
          searchQuery: "",
          isAllPublic: channel ? String(channel.type || "").trim() === "public" : false,
      };

      if (!state.settingsUsers || !state.settingsUsers.length) {
          loadSettingsUsers().then(() => {
              renderSettingsChannels();
          });
      } else {
          renderSettingsChannels();
      }
  }

  /**
   * 重置频道编辑状态（返回新建频道模式）
   */
  function resetChannelEditState() {
      state.channelEditState = {
          channelId: "",
          title: "",
          selectedUserIds: [],
          searchQuery: "",
          isAllPublic: false,
      };
  }

  /**
   * 只重新渲染编辑面板（不重建整个页面）
   */
  function renderChannelEditPanel() {
      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels.filter((row) => row && !row.builtin) : [];
      const allUsers = Array.isArray(state.settingsUsers) ? state.settingsUsers : [];
      const editState = state.channelEditState;
      const selectedChannelId = editState.channelId;
      const selectedChannel = selectedChannelId
          ? channels.find((row) => String((row && row.id) || "").trim() === selectedChannelId)
          : null;

      const editPane = document.querySelector(".channel-edit-pane");
      if (editPane) {
          editPane.innerHTML = renderChannelEditPanelHtml(selectedChannel, allUsers);
      }
  }

  async function loadMaterialsRows() {
    const startedAt = performance.now();
    const qs = new URLSearchParams({
      sort_by: String(state.materialsSortBy || "updated_at"),
      order: String(state.materialsSortOrder || "desc"),
    });
    const data = await fetchJson(`/api/frontend/materials?${qs.toString()}`);
    state.allLectureRows = Array.isArray(data.lectures) ? data.lectures : [];
    state.materialsSortBy = String(data.sort_by || state.materialsSortBy || "updated_at");
    state.materialsSortOrder = String(data.order || state.materialsSortOrder || "desc");
    if (!state.selectedLectureId && state.allLectureRows.length) {
      state.selectedLectureId = String((state.allLectureRows[0].lecture || {}).id || "");
    }
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs >= 800) {
      console.warn("[NXL] materials load slow", {
        client_duration_ms: durationMs,
        server_duration_ms: Number(data.duration_ms || 0),
        lectures: state.allLectureRows.length,
      });
    }
  }

  async function loadDashboardRows() {
    try {
      const data = await fetchJson("/api/frontend/dashboard");
      state.dashboardRows = Array.isArray(data.lectures) ? data.lectures : [];
      state.selectedLearningLectureIds = Array.isArray(data.selected_lecture_ids)
        ? data.selected_lecture_ids.map((v) => String(v || ""))
        : [];
      state.totalStudyHours = toNumber(data.total_study_hours, 0);
    } catch (_err) {
      state.dashboardRows = [];
      state.selectedLearningLectureIds = [];
      state.totalStudyHours = 0;
    }
  }

  async function loadRefinementSettings() {
    const data = await fetchJson("/api/frontend/settings/refinement");
    state.refinementRows = Array.isArray(data.items) ? data.items : [];
    state.refinementQueue = data.queue && typeof data.queue === "object" ? data.queue : { queue_size: 0, running_count: 0 };
    if (el.settingsView.classList.contains("is-active") && (state.settingsTab === "refinement" || state.settingsTab === "courses")) renderSettingsDetail();
  }

  async function loadModelSettings() {
    const data = await fetchJson("/api/frontend/settings/models");
    state.modelOptions = Array.isArray(data.available_models) ? data.available_models : [];
    state.modelSettings = data.settings && typeof data.settings === "object"
      ? data.settings
      : {
        default_nexora_model: "",
        rough_reading: {},
        intensive_reading: {},
        split_chapters: {},
        memory: {},
        profile_question: {},
      };
    if (el.settingsView.classList.contains("is-active") && state.settingsTab === "model") {
      renderSettingsDetail();
    }
  }

// ─────── Settings Data Fetching & Actions ─────────────────────────────
  async function loadSettingsUsers(query) {
    const nextQuery = typeof query === "string" ? query : String(state.settingsUsersQuery || "");
    state.settingsUsersQuery = nextQuery;
    state.settingsUsersLoading = true;
    state.settingsUsersError = "";
    if (el.settingsView.classList.contains("is-active") && state.settingsTab === "users") {
      renderSettingsUsers();
    }
    try {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      params.set("limit", "200");
      const data = await fetchJson(`/api/frontend/settings/users?${params.toString()}`);
      state.settingsUsers = Array.isArray(data.items) ? data.items : [];
      state.settingsUsersSummary = data.summary && typeof data.summary === "object"
        ? data.summary
        : { total: state.settingsUsers.length, admins: 0, teachers: 0, students: 0 };
      state.settingsUsersQuery = String(data.query || nextQuery || "").trim();
    } catch (err) {
      state.settingsUsers = [];
      state.settingsUsersSummary = { total: 0, admins: 0, teachers: 0, students: 0 };
      state.settingsUsersError = err && err.message ? err.message : "加载用户列表失败";
    } finally {
      state.settingsUsersLoading = false;
      if (el.settingsView.classList.contains("is-active") && state.settingsTab === "users") {
        renderSettingsUsers();
      }
    }
  }

  async function updateSettingsUserIdentity(userId, identity) {
    const resolvedUserId = String(userId || "").trim();
    const resolvedIdentity = String(identity || "").trim().toLowerCase();
    if (!resolvedUserId) throw new Error("user_id is required");
    if (resolvedIdentity !== "student" && resolvedIdentity !== "teacher") {
      throw new Error("identity must be student or teacher");
    }
    const data = await fetchJson(`/api/frontend/settings/users/${encodeURIComponent(resolvedUserId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: resolvedIdentity }),
    });
    const updated = data && data.user && typeof data.user === "object" ? data.user : null;
    if (updated && state.settingsUsers.length) {
      state.settingsUsers = state.settingsUsers.map((row) => {
        const rowUserId = String(row.user_id || "").trim();
        const rowRemoteUserId = String(row.remote_user_id || "").trim();
        const rowUsername = String(row.username || "").trim();
        if (rowUserId !== resolvedUserId && rowRemoteUserId !== resolvedUserId && rowUsername !== resolvedUserId) return row;
        return Object.assign({}, row, updated);
      });
      state.settingsUsersSummary = recalcSettingsUsersSummary(state.settingsUsers);
      if (el.settingsView.classList.contains("is-active") && state.settingsTab === "users") patchSettingsUsersSummary(state.settingsUsersSummary);
    }
    return updated;
  }

  async function fetchBookDetailXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/bookdetail`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function reportReaderChapterComplete(index, isUnload) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) return;
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    const chapter = chapters[idx];
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    const chapterName = String((chapter && chapter.title) || "").trim();
    if (!lectureId || !bookId || !chapterName) return;
    const chapterRange = getReaderChapterRange(chapter);
    const reportKey = getChapterCompleteReportKey(lectureId, bookId, idx, chapterName, chapterRange);
    if (!reportKey) return;
    if (hasChapterCompleteReport(reportKey) || state.readerReportedChapterKey === reportKey || state.readerReportingChapterKey === reportKey) return;
    const chapterContext = getReaderChapterContext(idx);

    if (!chapterContext) {
      console.warn("[NXL-Reader] chapter complete skipped: empty chapter context", {
        lectureId,
        bookId,
        chapterIndex: idx,
        chapterName,
        chapterRange,
        cacheKeys: Object.keys(state.readerChapterCache || {}),
        fullTextLength: String(state.readerFullTextRaw || "").length,
      });
      return;
    }

    state.readerReportingChapterKey = reportKey;
    emitTelemetry("reader_chapter_complete", {
      lecture_id: lectureId,
      book_id: bookId,
      chapter_index: idx,
      chapter_name: chapterName,
      chapter_range: chapterRange,
    });

    const payload = JSON.stringify({
      username: getRuntimeUsername(),
      lecture_id: lectureId,
      book_id: bookId,
      chapter_name: chapterName,
      chapter_range: chapterRange,
      chapter_context: chapterContext.slice(0, 12000),
      chapter_detail_xml: String(state.readerBookDetailXml || ""),
    });

    // 页面卸载时使用 sendBeacon 确保数据发送成功
    if (isUnload && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/frontend/learning/chapter-complete", blob);
      markChapterCompleteReport(reportKey, idx);
      state.readerReportedChapterKey = reportKey;
      invalidateLearningReportCache(lectureId);
      return;
    }

    try {
      await fetchJson("/api/frontend/learning/chapter-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      markChapterCompleteReport(reportKey, idx);
      state.readerReportedChapterKey = reportKey;
      invalidateLearningReportCache(lectureId);

      if (state.isReaderOpen) {
        loadChapterQuiz(idx, chapterName, chapterRange, chapterContext).catch((err) => {
          quizState.loading = false;
          quizState.error = err && err.message ? err.message : "章节小测加载失败";
          console.warn("[NXL-Reader] chapter quiz load failed", err);
          renderQuizPanel();
        });
      }
    } catch (err) {
      console.warn("[NXL-Reader] chapter complete report failed", err);
      throw err;
    } finally {
      if (state.readerReportingChapterKey === reportKey) {
        state.readerReportingChapterKey = "";
      }
    }

    await loadDashboardRows();
    renderProgressList();
    renderPie();
    renderLearningFeeds();
  }

  async function loadSettingsLogs() {
    const params = new URLSearchParams();
    params.set("category", String(state.settingsLogCategory || "all"));
    if (state.settingsLogCategory === "model" && state.settingsLogSource) params.set("source", state.settingsLogSource);
    params.set("limit", "200");
    const data = await fetchJson(`/api/frontend/settings/logs?${params.toString()}`);
    state.settingsLogs = Array.isArray(data.rows) ? data.rows : [];
    state.settingsLogSources = Array.isArray(data.sources) ? data.sources : [];
    state.settingsLogs.sort((a, b) => String(b && b.timestamp || "").localeCompare(String(a && a.timestamp || "")));
    if (el.settingsView.classList.contains("is-active") && state.settingsTab === "logs") {
      renderSettingsDetail();
    }
  }

  async function loadLearningFeeds() {
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("channel_id", String(state.selectedFeedChannelId || "public_all"));
      const data = await fetchJson(`/api/frontend/learning-feeds?${params.toString()}`);
      state.learningFeeds = Array.isArray(data.items) ? data.items : [];
      state.learningFeedChannels = Array.isArray(data.channels) ? data.channels : [];
      state.selectedFeedChannelId = String(data.channel_id || state.selectedFeedChannelId || "public_all");
    } catch (_err) {
      state.learningFeeds = [];
      state.learningFeedChannels = [];
    }
    if (state.dashboardSideTab === "feed") {
      renderLearningFeeds();
    }
    syncFeedMentionMenus();
  }

  async function createLearningFeedChannel() {
      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }
      const title = state.channelEditState.title;
      const isPublic = state.channelEditState.isAllPublic === true;

      if (!title) throw new Error("频道名不能为空");

      // 全员公开时发送 ["ALL"]，否则发送选中的用户ID
      const member_user_ids = isPublic ? ["ALL"] : (state.channelEditState.selectedUserIds || []);

      await fetchJson("/api/frontend/settings/feed-channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, member_user_ids }),
      });

      resetChannelEditState();
      await loadLearningFeedChannels();
      await loadSettingsUsers();
  }

  async function updateLearningFeedChannel() {
      const channelId = String(state.channelEditState.channelId || "").trim();
      if (!channelId) throw new Error("频道ID不存在");

      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }
      const title = state.channelEditState.title;
      const isPublic = state.channelEditState.isAllPublic === true;

      if (!title) throw new Error("频道名不能为空");

      // 全员公开时发送 ["ALL"]，否则发送选中的用户ID
      const member_user_ids = isPublic ? ["ALL"] : (state.channelEditState.selectedUserIds || []);

      await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, member_user_ids }),
      });

      await loadLearningFeedChannels();
      await loadSettingsUsers();
      renderSettingsChannels();
  }

  /**
   * 获取当前频道内的用户ID列表（从DOM中读取）
   */
  function getChannelMemberUserIds() {
      const memberCards = document.querySelectorAll(".channel-users-column:first-child .channel-user-card");
      return Array.from(memberCards).map((card) => String(card.getAttribute("data-user-id") || "").trim()).filter(Boolean);
  }

  async function saveFeedChannel() {
      const editState = state.channelEditState;
      if (editState.channelId) {
          await updateLearningFeedChannel();
      } else {
          await createLearningFeedChannel();
      }
  }

  /**
   * 添加用户到频道（先更新本地状态，再异步请求）
   */
  async function addUserToChannel(channelId, userId) {
      if (!channelId || !userId) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);
      if (!channel) return;

      const currentMembers = Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [];
      if (currentMembers.includes(userId)) return;

      // 先更新本地状态
      currentMembers.push(userId);
      channel.member_user_ids = currentMembers;
      if (Array.isArray(state.channelEditState.selectedUserIds)) {
          state.channelEditState.selectedUserIds.push(userId);
      }
      renderChannelEditPanel();

      // 异步请求后端
      try {
          await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ member_user_ids: currentMembers }),
          });
      } catch (err) {
          showToast(`添加用户失败：${err.message || "未知错误"}`);
          // 回滚
          channel.member_user_ids = currentMembers.filter((id) => id !== userId);
          if (Array.isArray(state.channelEditState.selectedUserIds)) {
              state.channelEditState.selectedUserIds = state.channelEditState.selectedUserIds.filter((id) => id !== userId);
          }
          renderChannelEditPanel();
      }
  }

  /**
   * 从频道移除用户（先更新本地状态，再异步请求）
   */
  async function removeUserFromChannel(channelId, userId) {
      if (!channelId || !userId) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);
      if (!channel) return;

      const currentMembers = Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [];
      const newMembers = currentMembers.filter((id) => id !== userId);

      // 先更新本地状态
      channel.member_user_ids = newMembers;
      if (Array.isArray(state.channelEditState.selectedUserIds)) {
          state.channelEditState.selectedUserIds = state.channelEditState.selectedUserIds.filter((id) => id !== userId);
      }
      renderChannelEditPanel();

      // 异步请求后端
      try {
          await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ member_user_ids: newMembers }),
          });
      } catch (err) {
          showToast(`移除用户失败：${err.message || "未知错误"}`);
          // 回滚
          channel.member_user_ids = currentMembers;
          if (Array.isArray(state.channelEditState.selectedUserIds)) {
              state.channelEditState.selectedUserIds.push(userId);
          }
          renderChannelEditPanel();
      }
  }

  async function removeLearningFeedChannel(channelId) {
      const id = String(channelId || "").trim();
      if (!id) return;
      await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(id)}`, {
          method: "DELETE",
      });

      if (String(state.channelEditState.channelId || "").trim() === id) {
          resetChannelEditState();
      }

      await loadLearningFeedChannels();
  }

  async function loadLearningFeedChannels() {
    try {
      const data = await fetchJson("/api/frontend/learning-feeds/channels");
      state.learningFeedChannels = Array.isArray(data.items) ? data.items : [];
      const ids = new Set(state.learningFeedChannels.map((row) => String((row && row.id) || "").trim()).filter(Boolean));
      if (!ids.has(String(state.selectedFeedChannelId || "").trim())) {
        state.selectedFeedChannelId = "public_all";
      }
    } catch (_err) {
      state.learningFeedChannels = [];
      state.selectedFeedChannelId = "public_all";
    }
  }

  async function toggleLearningFeedLike(feedId) {
    const id = String(feedId || "").trim();
    if (!id) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(id)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await loadLearningFeeds();
  }

  async function toggleLearningFeedCommentLike(feedId, commentId) {
    const fid = String(feedId || "").trim();
    const cid = String(commentId || "").trim();
    if (!fid || !cid) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(fid)}/comments/${encodeURIComponent(cid)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    state.feedExpandedMap[fid] = true;
    await loadLearningFeeds();
  }

  async function submitLearningFeedComment(feedId) {
    const id = String(feedId || "").trim();
    if (!id) return;
    const content = String(state.feedCommentDrafts[id] || "").trim();
    if (!content) throw new Error("评论内容不能为空");
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
// ─────── Data Loading & Initial Fetch ─────────────────────────────────
    delete state.feedCommentDrafts[id];
    state.feedExpandedMap[id] = true;
    resetFeedMentionState();
    await loadLearningFeeds();
  }

  async function saveModelSettings() {
    if (!state.isAdmin) throw new Error("仅管理员可修改模型设置");

    function getCustomSelectValue(selectId) {
      const el = document.querySelector(`[data-select-id="${selectId}"]`);
      if (!el) return "";
      return String(el.getAttribute("data-value") || "").trim();
    }

    const memoryIntervalInput = document.getElementById("settingsMemoryIntervalInput");
    const payload = {
      default_nexora_model: getCustomSelectValue("settingsDefaultModelSelect"),
      rough_reading: {
        model_name: getCustomSelectValue("settingsRoughModelSelect"),
      },
      intensive_reading: {
        model_name: getCustomSelectValue("settingsIntensiveModelSelect"),
      },
      split_chapters: {
        model_name: getCustomSelectValue("settingsSplitChaptersModelSelect"),
      },
      memory: {
        model_name: getCustomSelectValue("settingsMemoryModelSelect"),
        trigger_turn_interval: Math.max(1, Number(memoryIntervalInput ? memoryIntervalInput.value : 10) || 10),
      },
      profile_question: {
        model_name: getCustomSelectValue("settingsProfileQuestionModelSelect"),
      },
    };
    await fetchJson("/api/frontend/settings/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await loadModelSettings();
  }

  async function startRefinement(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
        force: false,
      }),
    });
    await loadRefinementSettings();
  }

  async function stopRefinement(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
  }

  async function startIntensive(lectureId, bookId) {
// ─────── Refinement & Processing Actions ──────────────────────────────
    await fetchJson("/api/frontend/settings/refinement/intensive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
  }

  async function startSection(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
    await loadMaterialsRows();
  }

  async function startAnnotation(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/annotation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
    await loadMaterialsRows();
  }

  async function startSummary(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
  }

  async function startVideo(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
      }),
    });
    await loadRefinementSettings();
  }

  function startOutline(lectureId) {
    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      return Promise.reject(new Error("lecture_id 不能为空"));
    }

    state.outlineActivity = {
      lectureId: resolvedLectureId,
      running: true,
      lines: [
        "已开始课程大纲生成",
        "正在汇总课程下教材章节与精读信息",
      ],
      draft: "",
      startedAt: Date.now(),
      error: "",
    };
    renderSettingsCourses();

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(`/api/frontend/outline/${encodeURIComponent(resolvedLectureId)}/generate-stream`);

      eventSource.addEventListener("status", (e) => {
        try {
          const data = JSON.parse(e.data);
          const line = String(data.message || "").trim();
          if (line) {
            state.outlineActivity.lines = [...state.outlineActivity.lines, line].slice(-18);
            renderSettingsCourses();
          }
        } catch (_err) {}
      });

      eventSource.addEventListener("delta", (e) => {
        try {
          const data = JSON.parse(e.data);
          const piece = String((data && data.content) || "");
          if (!piece) return;
          state.outlineActivity.draft = `${String(state.outlineActivity.draft || "")}${piece}`;
          renderSettingsCourses();
        } catch (_err) {}
      });

      eventSource.addEventListener("done", async (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data.success) {
            throw new Error(data.error || "大纲生成失败");
          }
          state.outlineActivity.running = false;
          state.outlineActivity.lines = [...state.outlineActivity.lines, "课程大纲已生成完成"];
          await loadRefinementSettings();
          renderSettingsCourses();
          resolve(data);
        } catch (err) {
          state.outlineActivity.running = false;
          state.outlineActivity.error = String(err.message || "大纲生成失败");
          renderSettingsCourses();
          reject(err);
        }
        eventSource.close();
      });

      eventSource.addEventListener("error", (e) => {
        let message = "大纲生成失败";
        try {
          const data = JSON.parse(e.data);
          message = data.error || message;
        } catch (_err) {}
        state.outlineActivity.running = false;
        state.outlineActivity.error = message;
        state.outlineActivity.lines = [...state.outlineActivity.lines, `生成失败：${message}`];
        renderSettingsCourses();
        eventSource.close();
        reject(new Error(message));
      });

      eventSource.addEventListener("close", () => {
        eventSource.close();
      });
    });
  }

  async function deleteBook(lectureId, bookId) {
    await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}`, {
      method: "DELETE",
    });
  }

  async function openSettingsView(tab) {
    state.settingsTab = tab || state.settingsTab || "refinement";
    setView("settings");
    if (state.settingsTab === "model") {
      await loadModelSettings();
    } else if (state.settingsTab === "channels") {
      await loadLearningFeedChannels();
    } else if (state.settingsTab === "users") {
      await loadSettingsUsers();
    } else if (state.settingsTab === "logs") {
      await loadSettingsLogs();
    } else if (state.settingsTab === "refinement") {
      await loadRefinementSettings();
    } else if (state.settingsTab === "courses") {
      await Promise.all([loadMaterialsRows(), loadRefinementSettings()]);
    }
    renderSettingsView();
  }

  async function refreshAll() {
    await Promise.all([
      loadMaterialsRows(),
      loadDashboardRows(),
      loadLearningFeedChannels(),
      loadLearningFeeds(),
      loadDashboardNotifications(),
      loadUserProfile(),
    ]);
    renderDashboardNotifications();
    renderUserProfile();
    renderProgressList();
    renderPie();
    renderLearningFeeds();
    syncDashboardSideTabs();
    renderLectureList();
    renderLectureDetail();
    renderUploadLectureInputDefault();
  }

  async function createLectureWithPayload(payload) {
    const title = String(payload && payload.title || "").trim();
    const category = String(payload && payload.category || "").trim();
    const status = String(payload && payload.status || "draft").trim() || "draft";
    const description = String(payload && payload.description || "").trim();
    if (!title) throw new Error("请输入课程名");
    const response = await fetchJson("/api/lectures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, status, description }),
    });
    const lecture = response.lecture || {};
    state.selectedLectureId = String(lecture.id || "");
    state.settingsCourseEditId = String(lecture.id || "");
    return lecture;
  }

  async function createLecture() {
    const title = String(el.createLectureTitleInput.value || "").trim();
    const category = String(el.createLectureCategoryInput.value || "").trim();
    const status = String(el.createLectureStatusSelect.value || "draft").trim() || "draft";
    const description = String(el.createLectureDescriptionInput.value || "").trim();
    const lecture = await createLectureWithPayload({ title, category, status, description });
    el.createLectureTitleInput.value = "";
    el.createLectureCategoryInput.value = "";
    el.createLectureStatusSelect.value = "draft";
    el.createLectureDescriptionInput.value = "";
    return lecture;
  }

  async function createLectureFromSettings() {
    const titleInput = document.getElementById("settingsCreateLectureTitleInput");
    const categoryInput = document.getElementById("settingsCreateLectureCategoryInput");
    const statusSelect = document.getElementById("settingsCreateLectureStatusSelect");
    const descriptionInput = document.getElementById("settingsCreateLectureDescriptionInput");
    const lecture = await createLectureWithPayload({
      title: titleInput ? titleInput.value : "",
      category: categoryInput ? categoryInput.value : "",
      status: statusSelect ? statusSelect.value : "draft",
      description: descriptionInput ? descriptionInput.value : "",
    });
    if (titleInput) titleInput.value = "";
    if (categoryInput) categoryInput.value = "";
    if (statusSelect) statusSelect.value = "draft";
    if (descriptionInput) descriptionInput.value = "";
    return lecture;
  }

// ─────── Download & Raw API Actions ───────────────────────────────────

  async function toggleLearningSelection(lectureId, selected) {
    await fetchJson("/api/frontend/learning/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        selected: !!selected,
        actor: state.username || "",
      }),
    });
  }

  function deriveBookTitleFromFile(file) {
    const rawName = String(file && file.name || "").trim();
    if (!rawName) return "";

    const lastDot = rawName.lastIndexOf(".");
    if (lastDot <= 0) {
        return rawName;
    }

    return rawName.slice(0, lastDot).trim();
  }

  function resolveUploadBookTitle(title, file) {
    const normalizedTitle = String(title || "").trim();
    if (normalizedTitle) {
        return normalizedTitle;
    }

    return deriveBookTitleFromFile(file);
  }

  function rememberSelectedUploadFile(file) {
    state.selectedUploadFile = file || null;
    renderSelectedUploadFileState(file);

    if (!file) {
        return;
    }

    if (el.materialsBookTitleInput && !String(el.materialsBookTitleInput.value || "").trim()) {
        el.materialsBookTitleInput.value = deriveBookTitleFromFile(file);
    }
  }

  async function uploadBookByFilePayload(lectureId, title, file) {
    if (!state.isAdmin) throw new Error("当前账号不是管理员");
    const normalizedLectureId = String(lectureId || "").trim();
    const normalizedTitle = resolveUploadBookTitle(title, file);
    if (!normalizedLectureId) throw new Error("请选择课程");
    if (!normalizedTitle) throw new Error("请输入教材名");
    if (!file) throw new Error("请选择教材文件");

    const created = await fetchJson(`/api/lectures/${encodeURIComponent(normalizedLectureId)}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: normalizedTitle, source_type: "file" }),
    });
    const bookId = String((created.book || {}).id || "");
    if (!bookId) throw new Error("创建教材失败");

    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`/api/lectures/${encodeURIComponent(normalizedLectureId)}/books/${encodeURIComponent(bookId)}/file`, {
      method: "POST",
      body: form,
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `HTTP ${resp.status}`);
    }
    state.selectedLectureId = normalizedLectureId;
    state.settingsCourseEditId = normalizedLectureId;
    state.selectedBookId = bookId;
    return created.book || {};
  }

  async function uploadBookByFile() {
    const lectureId = String(el.materialsLectureIdHidden.value || "").trim();
    const title = String(el.materialsBookTitleInput.value || "").trim();
    const inputFile = el.materialsFileInput.files ? el.materialsFileInput.files[0] : null;
    const file = inputFile || state.selectedUploadFile;
    const book = await uploadBookByFilePayload(lectureId, title, file);
    el.materialsBookTitleInput.value = "";
    el.materialsFileInput.value = "";
    state.selectedUploadFile = null;
    renderSelectedUploadFileState(null);
    return book;
  }

  async function uploadBookFromSettings() {
    syncSettingsBookUploadStateFromControls();

    const uploadState = state.settingsBookUpload;
    const lectureId = uploadState.lectureId;
    const title = uploadState.title;
    const file = uploadState.file;
    const book = await uploadBookByFilePayload(lectureId, title, file);
    clearSettingsBookUploadState(lectureId);
    return book;
  }

// ─────── Event Bindings ───────────────────────────────────────────────
  function bindEvents() {
    el.openMaterialsViewBtn.addEventListener("click", () => {
      setView("materials");
      openMaterialsShelf();
    });
    if (el.dashboardProgressTabBtn) {
      el.dashboardProgressTabBtn.addEventListener("click", () => {
        state.dashboardSideTab = "progress";
        syncDashboardSideTabs();
      });
    }
    if (el.dashboardProgressFeedTabBtn) {
      el.dashboardProgressFeedTabBtn.addEventListener("click", () => {
        state.dashboardSideTab = "feed";
        syncDashboardSideTabs();
      });
    }
    if (el.feedChannelList) {
      el.feedChannelList.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const editBtn = target.closest("[data-action='edit-channel']");
        if (editBtn) {
          event.preventDefault();
          event.stopPropagation();
          const channelId = String(editBtn.getAttribute("data-channel-id") || "").trim();
          if (channelId) {
            openChannelEditDialog(channelId);
          }
          return;
        }

        const channelItem = target.closest("[data-feed-channel-select]");
        if (!channelItem) return;

        const channelId = String(channelItem.getAttribute("data-channel-id") || "").trim();
        if (!channelId || channelId === String(state.selectedFeedChannelId || "public_all")) return;

        state.selectedFeedChannelId = channelId;
        loadLearningFeeds().catch((err) => showToast(`加载动态失败：${err.message || "未知错误"}`));
      });
    }
    if (el.dashboardPieTabBtn) {
      el.dashboardPieTabBtn.addEventListener("click", () => {
        state.dashboardPieTab = "pie";
        syncPieProfileTabs();
      });
    }
    if (el.dashboardProfileTabBtn) {
      el.dashboardProfileTabBtn.addEventListener("click", () => {
        state.dashboardPieTab = "profile";
        syncPieProfileTabs();
      });
    }
    if (el.userProfileDimensions) {
      el.userProfileDimensions.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const removeBtn = target.closest("[data-notice-remove-id]");
        if (removeBtn) {
          event.preventDefault();
          event.stopPropagation();
          const notificationId = String(removeBtn.getAttribute("data-notice-remove-id") || "").trim();

          try {
            await removeDashboardNotification(notificationId);
          } catch (err) {
            showToast(`移除通知失败：${err.message || "未知错误"}`);
          }

          return;
        }

        const settingsBtn = target.closest("[data-view='settings'][data-settings-tab]");
        if (settingsBtn) {
          const tab = String(settingsBtn.getAttribute("data-settings-tab") || "refinement").trim();
          openSettingsView(tab || "refinement").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
          return;
        }

        const notice = target.closest("[data-notice-jumpto]");
        if (!notice) return;

        const jumpto = String(notice.getAttribute("data-notice-jumpto") || "").trim();
        if (jumpto) {
          emitHostPayload("nexora:notification:open", { jumpto });
        }
      });
    }
    if (el.learningFeedComposeBtn) {
      el.learningFeedComposeBtn.addEventListener("click", () => {
        enterFeedComposeMode();
      });
    }
    if (el.dashboardFocusPanel) {
      el.dashboardFocusPanel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const item = target.closest("[data-dashboard-focus-lecture-id]");
        if (!item) return;
        const lectureId = String(item.getAttribute("data-dashboard-focus-lecture-id") || "");
        if (!lectureId) return;
        setView("materials");
        openLectureHome(lectureId, { returnTarget: "dashboard" });
      });
    }

    el.progressList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-progress-lecture-id]");
      if (!item) return;
      const lectureId = String(item.getAttribute("data-progress-lecture-id") || "");
      if (!lectureId) return;
      setView("materials");
      openLectureHome(lectureId, { returnTarget: "dashboard" });
    });
    if (el.learningFeedPanel) {
      el.learningFeedPanel.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest("[data-feed-action]");
        if (!btn) return;
        event.preventDefault();
        const action = String(btn.getAttribute("data-feed-action") || "").trim();
        const feedId = String(btn.getAttribute("data-feed-id") || "").trim();
        if (!feedId) return;
        try {
          if (action === "like") {
            await toggleLearningFeedLike(feedId);
            return;
          }
          if (action === "comment-toggle") {
            state.feedExpandedMap[feedId] = !state.feedExpandedMap[feedId];
            renderLearningFeeds();
            return;
          }
          if (action === "comment-like") {
            const commentId = String(btn.getAttribute("data-comment-id") || "").trim();
            if (!commentId) return;
            await toggleLearningFeedCommentLike(feedId, commentId);
            return;
          }
          if (action === "comment-reply") {
            const handle = String(btn.getAttribute("data-comment-username") || "").trim();
            const targetInput = el.learningFeedPanel.querySelector(`[data-feed-comment-input="${CSS.escape(feedId)}"]`);
            if (!(targetInput instanceof HTMLInputElement) || !handle) return;
            const prefix = `@${handle} 回复：`;
            const current = String(targetInput.value || "");
            if (!current.startsWith(prefix)) {
              targetInput.value = `${prefix}${current.replace(/^\s+/, "")}`;
              state.feedCommentDrafts[feedId] = targetInput.value;
              targetInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
            targetInput.focus();
            try {
              const caret = targetInput.value.length;
              targetInput.setSelectionRange(caret, caret);
            } catch (_err) {}
            return;
          }
          if (action === "mention-pick") {
            const mentionIndex = Number(btn.getAttribute("data-mention-index") || 0);
            const mentionState = state.feedMentionState;
            if (!mentionState || !Array.isArray(mentionState.users)) return;
            const picked = mentionState.users[mentionIndex];
            const targetInput = el.learningFeedPanel.querySelector(`[data-feed-comment-input="${CSS.escape(feedId)}"]`);
            if (!(targetInput instanceof HTMLInputElement) || !picked) return;
            applyMentionSelectionToInput(targetInput, picked);
            targetInput.focus();
            return;
          }
          if (action === "comment-send") {
            await submitLearningFeedComment(feedId);
            return;
          }
          if (action === "feed-delete") {
            openConfirm("确认删除这条动态？", async () => {
              await deleteLearningFeed(feedId);
            });
            return;
          }
          if (action === "comment-delete") {
            const commentId = String(btn.getAttribute("data-comment-id") || "").trim();
            if (!commentId) return;
            openConfirm("确认删除这条评论？", async () => {
              await deleteLearningFeedComment(feedId, commentId);
            });
            return;
          }
        } catch (err) {
          showToast(String(err && err.message ? err.message : "动态操作失败"));
        }
      });
      el.learningFeedPanel.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        state.feedCommentDrafts[feedId] = String(target.value || "");
        if (target.dataset.composing === "true") {
          return;
        }
        updateFeedMentionCandidates(target).catch(() => {
          resetFeedMentionState();
          syncFeedMentionMenus();
        });
      });
      el.learningFeedPanel.addEventListener("compositionstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        target.dataset.composing = "true";
        state.feedCommentComposing[feedId] = true;
      });
      el.learningFeedPanel.addEventListener("compositionend", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        delete state.feedCommentComposing[feedId];
        delete target.dataset.composing;
        state.feedCommentDrafts[feedId] = String(target.value || "");
        updateFeedMentionCandidates(target).catch(() => {
          resetFeedMentionState();
          syncFeedMentionMenus();
        });
      });
      el.learningFeedPanel.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        if (target.dataset.composing === "true" || event.isComposing) {
          return;
        }
        const mentionState = state.feedMentionState;
        if (!mentionState || !mentionState.visible || mentionState.key !== `comment:${feedId}` || !Array.isArray(mentionState.users) || !mentionState.users.length) {
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          mentionState.activeIndex = (Number(mentionState.activeIndex || 0) + 1) % mentionState.users.length;
          syncFeedMentionMenus();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          mentionState.activeIndex = (Number(mentionState.activeIndex || 0) - 1 + mentionState.users.length) % mentionState.users.length;
          syncFeedMentionMenus();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          const picked = mentionState.users[Number(mentionState.activeIndex || 0)];
          if (!picked) return;
          event.preventDefault();
          applyMentionSelectionToInput(target, picked);
          return;
        }
        if (event.key === "Escape") {
          resetFeedMentionState();
          syncFeedMentionMenus();
        }
      });
    }
    if (el.confirmCancelBtn) {
      el.confirmCancelBtn.addEventListener("click", () => closeConfirm());
    }
    if (el.confirmBackdrop) {
      el.confirmBackdrop.addEventListener("click", (event) => {
        if (event.target === el.confirmBackdrop) {
          closeConfirm();
        }
      });
    }
    if (el.confirmOkBtn) {
      el.confirmOkBtn.addEventListener("click", async () => {
        const action = state.confirmAction;
        closeConfirm();
        if (typeof action !== "function") return;
        try {
          await action();
        } catch (err) {
          showToast(String(err && err.message ? err.message : "操作失败"));
        }
      });
    }

    el.backToDashboardBtn.addEventListener("click", async () => {
      if (state.materialsDetailMode === "catalog") {
        returnFromCourseHome();
        return;
      }
      if (state.materialsPageMode === "lecture") {
        returnFromCourseHome();
        return;
      }
      closeReader();
      setView("dashboard");
      await refreshAll();
    });
    if (el.backFromCourseHomeBtn) {
      el.backFromCourseHomeBtn.addEventListener("click", () => {
        returnFromCourseHome();
      });
    }
    if (el.openUploadViewBtn) {
      el.openUploadViewBtn.addEventListener("click", () => {
        closeReader();
        setView("upload");
        setUploadTab("upload");
      });
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.addEventListener("click", () => {
        closeReader();
        setView("upload");
        setUploadTab("upload");
      });
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.addEventListener("click", () => {
        if (state.materialsDetailMode === "catalog" && state.catalogContext) {
          openTeacherEditPanel(state.selectedLectureId, {
            mode: "book",
            bookId: state.catalogContext.bookId,
          });
          return;
        }
        openTeacherEditPanel(state.selectedLectureId, { mode: "lecture" });
      });
    }
    el.backToMaterialsBtn.addEventListener("click", () => {
      closeReader();
      setView("materials");
      syncMaterialsPageMode();
    });
    el.backFromSettingsBtn.addEventListener("click", () => {
      setView("dashboard");
    });
    el.backFromLearningPathBtn.addEventListener("click", () => {
      setView("materials");
      syncMaterialsPageMode();
    });
    setLearningPathOutlineCollapsed(readLearningPathOutlineCollapsed(), false);
    if (el.learningPathOutlineToggle) {
      el.learningPathOutlineToggle.addEventListener("click", () => {
        setLearningPathOutlineCollapsed(!state.lpOutlineCollapsed, true);
      });
    }
    if (el.learningPathOutlinePane) {
      el.learningPathOutlinePane.addEventListener("click", (event) => {
        const rawTarget = event.target;
        const target = rawTarget instanceof Element
          ? rawTarget
          : rawTarget && rawTarget.parentElement instanceof Element
            ? rawTarget.parentElement
            : null;
        const tab = target ? target.closest("[data-lp-side-tab]") : null;

        if (!tab || !el.learningPathOutlinePane.contains(tab)) {
          return;
        }

        const nextTab = String(tab.getAttribute("data-lp-side-tab") || "").trim();

        if (nextTab !== "outline" && nextTab !== "report") {
          return;
        }

        state.learningPathSideTab = nextTab;
        renderLearningPathSidePanel(state.selectedLectureId);
      });
    }
    {
      const lpScrollPane = el.learningPathMarkdown ? el.learningPathMarkdown.closest(".learning-path-main-pane") : null;
      if (lpScrollPane) {
        lpScrollPane.addEventListener("scroll", emitLearningPathScrollTelemetry, { passive: true });
      }
    }
    el.backFromReaderBtn.addEventListener("click", () => {
      if (!state.isReaderOpen) return;
      if (isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        return;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        return;
      }
      if (state.readerViewMode === "reading") {
        setReaderFullscreen(false);
        closeReader();
        return;
      }
      closeReader();
    });
    if (el.readerSettingsBtn) {
      el.readerSettingsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        logReaderDebug("readerSettingsBtn:click", {});
        setReaderSettingsPanelOpen(!isReaderSettingsOpen());
      });
    }
    if (el.readerSettingsPanel) {
      el.readerSettingsPanel.addEventListener("click", (event) => {
        event.stopPropagation();
        logReaderDebug("readerSettingsPanel:click", {});
      });
      el.readerSettingsPanel.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        logReaderDebug("readerSettingsPanel:pointerdown", {});
      });
      ["transitionstart", "transitionend", "animationstart", "animationend"].forEach((evtName) => {
        el.readerSettingsPanel.addEventListener(evtName, () => {
          logReaderDebug(`readerSettingsPanel:${evtName}`, {});
        });
      });
    }
    if (el.readerChapterListBtn) {
      el.readerChapterListBtn.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      el.readerChapterListBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setChapterListPanelOpen(!(el.chapterListPanel && el.chapterListPanel.classList.contains("show")));
        setReaderSettingsPanelOpen(false);
      });
    }
    if (el.chapterListContent) {
      el.chapterListContent.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        
        // 检查是否点击了小节
        const sessionItem = target.closest(".session-item");
        if (sessionItem) {
          const chapterIdx = Number(sessionItem.getAttribute("data-chapter-index") || "0");
          const sessionIdx = Number(sessionItem.getAttribute("data-session-index") || "0");
          const sessionRange = sessionItem.getAttribute("data-session-range") || "";
          markSessionVisited(chapterIdx, sessionIdx);
          renderChapterList();
          // 解析session range获取偏移量
          let scrollToOffset = null;
          if (sessionRange) {
            const parts = sessionRange.split(":");
            if (parts.length >= 1) {
              scrollToOffset = Number(parts[0]) || 0;
            }
          }
          // 打开对应章节并滚动到session位置
          openReaderChapter(chapterIdx, scrollToOffset, {
            sessionIndex: sessionIdx,
            sessionRange,
          });
          setChapterListPanelOpen(false);
          state.readerViewMode = "reading";
          syncFloatingBtnVisibility();
          syncReaderModeUI();
          setReaderFullscreen(true);
          return;
        }
        
        // 检查是否点击了章节
        const item = target.closest("[data-reader-chapter-index]");
        if (!item) return;
        const idx = Number(item.getAttribute("data-reader-chapter-index") || "0");
        if (idx !== state.readerActiveChapterIndex) {
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch((err) => {
            console.warn("[NXL-Reader] chapter complete before chapter switch failed", err);
          });
        }
        openReaderChapter(idx);
        setChapterListPanelOpen(false);
        state.readerViewMode = "reading";
        syncFloatingBtnVisibility();
        syncReaderModeUI();
        setReaderFullscreen(true);
      });
    }
    if (el.closeChapterList) {
      el.closeChapterList.addEventListener("click", () => setChapterListPanelOpen(false));
    }
    if (el.fontSizeSlider) {
      el.fontSizeSlider.addEventListener("input", () => {
        const v = Number(el.fontSizeSlider.value || DEFAULT_READER_SETTINGS.fontSize);
        state.readerSettings.fontSize = Math.max(12, Math.min(36, Math.round(v)));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    if (el.lineHeightSlider) {
      el.lineHeightSlider.addEventListener("input", () => {
        const v = Number(el.lineHeightSlider.value || DEFAULT_READER_SETTINGS.paragraphSpacing);
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(v.toFixed(1))));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    if (el.edgeClickWidthSlider) {
      el.edgeClickWidthSlider.addEventListener("input", () => {
        const v = Number(el.edgeClickWidthSlider.value || DEFAULT_READER_SETTINGS.edgeClickWidth);
        state.readerSettings.edgeClickWidth = Math.max(30, Math.min(160, Math.round(v)));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    document.querySelectorAll('input[name="readerTheme"]').forEach((node) => {
      node.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.readerSettings.theme = String(target.value || "light");
        applyReaderTypography();
        saveReaderSettings();
      });
    });
    document.querySelectorAll('input[name="readerDisplayMode"]').forEach((node) => {
      node.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.readerSettings.displayMode = String(target.value || "zh-ja");
        saveReaderSettings();
      });
    });
    if (el.enableKeyNavigation) {
      el.enableKeyNavigation.addEventListener("change", () => {
        state.readerSettings.enableKeyNavigation = !!el.enableKeyNavigation.checked;
        saveReaderSettings();
      });
    }
    if (el.translatorSelect) {
      el.translatorSelect.addEventListener("change", () => {
        state.readerSettings.preferredTranslator = String(el.translatorSelect.value || "auto");
        saveReaderSettings();
      });
    }
    if (el.resetReaderSettings) {
      el.resetReaderSettings.addEventListener("click", () => {
        state.readerSettings = {
          fontSize: DEFAULT_READER_SETTINGS.fontSize,
          paragraphSpacing: DEFAULT_READER_SETTINGS.paragraphSpacing,
          edgeClickWidth: DEFAULT_READER_SETTINGS.edgeClickWidth,
          theme: DEFAULT_READER_SETTINGS.theme,
          displayMode: DEFAULT_READER_SETTINGS.displayMode,
          enableKeyNavigation: DEFAULT_READER_SETTINGS.enableKeyNavigation,
          preferredTranslator: DEFAULT_READER_SETTINGS.preferredTranslator,
        };
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
        showToast("阅读设置已重置");
      });
    }
    if (el.exportReaderSettings) {
      el.exportReaderSettings.addEventListener("click", () => {
        try {
          const settingsJson = JSON.stringify(state.readerSettings, null, 2);
          const blob = new Blob([settingsJson], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "reader-settings.json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast("阅读设置已导出");
        } catch (_err) {
          showToast("导出设置失败");
        }
      });
    }
    el.readerContent.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const guidePatch = target ? target.closest(".reader-guide-highlight, .reader-guide-section-break") : null;

      if (guidePatch) {
        event.preventDefault();
        event.stopPropagation();
        jumpToReaderGuideCard(Number(guidePatch.getAttribute("data-reader-guide-patch-index") || "0"));
        return;
      }

      if (!state.isReaderFullscreen) return;
      if (target && target.closest(".annotation-marker")) return;
      const navBtn = target ? target.closest("[data-reader-nav]") : null;
      if (navBtn) {
        event.preventDefault();
        event.stopPropagation();
        const dir = String(navBtn.getAttribute("data-reader-nav") || "");
        const nextIndex = dir === "prev"
          ? state.readerActiveChapterIndex - 1
          : state.readerActiveChapterIndex + 1;
        if (dir === "next" && nextIndex > state.readerActiveChapterIndex) {
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch((err) => {
            console.warn("[NXL-Reader] chapter complete before next navigation failed", err);
          });
        }
        openReaderChapter(nextIndex);
        return;
      }
      if (isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
        return;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
        return;
      }
      event.stopPropagation();
      logReaderDebug("readerContent:clickToggle", {});
      toggleReaderUI();
    });
    el.readerContent.addEventListener("contextmenu", handleReaderContextMenu);
    el.readerContent.addEventListener("pointerdown", (event) => {
      hideHostReaderSelectionContextMenu();
      if (!state.isReaderOpen || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !el.readerContent || !el.readerContent.contains(target)) return;
      readerSelectionTelemetryState.pointerDownKey = getReaderSelectionSignature();
      readerSelectionTelemetryState.pointerActive = true;
    }, { capture: true });
    document.addEventListener("selectionchange", () => {
      if (!state.isReaderOpen || !readerSelectionTelemetryState.pointerActive) return;
      scheduleReaderSelectionTelemetry("selectionchange", false);
    }, { capture: true });
    document.addEventListener("pointerup", (event) => {
      if (!state.isReaderOpen || !readerSelectionTelemetryState.pointerActive) return;
      if (event.button !== 0) {
        resetReaderSelectionTelemetry();
        return;
      }
      scheduleReaderSelectionTelemetry("pointerup", true);
    }, { capture: true });
    document.addEventListener("pointercancel", () => {
      if (!readerSelectionTelemetryState.pointerActive) return;
      resetReaderSelectionTelemetry();
    }, { capture: true });
    el.readerContent.addEventListener("scroll", () => {
      if (!state.isReaderOpen) return;
      hideHostReaderSelectionContextMenu();
      const chapterMeta = getReaderCurrentChapterMeta();
      const scrollContainer = getReaderScrollContainer();
      if (!scrollContainer) return;
      const scrollHeight = Number(scrollContainer.scrollHeight || 0);
      const clientHeight = Number(scrollContainer.clientHeight || 0);
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      const scrollTop = Number(scrollContainer.scrollTop || 0);
      const scrollPercent = maxScroll > 0 ? (scrollTop / maxScroll) : 0;
      emitTelemetry("reader_scroll", {
        lecture_id: String(state.selectedLectureId || "").trim(),
        book_id: String(state.selectedBookId || "").trim(),
        chapter_index: chapterMeta.chapterIndex,
        chapter_title: chapterMeta.chapterTitle,
        scroll_top: scrollTop,
        scroll_height: scrollHeight,
        client_height: clientHeight,
        scroll_percent: Number(scrollPercent.toFixed(4)),
      });
      scheduleHostReaderContextSync(120);
      checkSessionProgressByScroll();
    }, { passive: true, capture: true });
    if (el.readerClickLeft) {
      el.readerClickLeft.addEventListener("click", (event) => {
        if (!state.isReaderFullscreen) return;
        if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
          setChapterListPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        if (isReaderSettingsOpen()) {
          setReaderSettingsPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        event.stopPropagation();
        logReaderDebug("readerClickLeft:toggle", {});
        toggleReaderUI();
      });
    }
    if (el.readerClickRight) {
      el.readerClickRight.addEventListener("click", (event) => {
        if (!state.isReaderFullscreen) return;
        if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
          setChapterListPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        if (isReaderSettingsOpen()) {
          setReaderSettingsPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        event.stopPropagation();
        logReaderDebug("readerClickRight:toggle", {});
        toggleReaderUI();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (state.isReaderOpen && state.readerSettings.enableKeyNavigation) {
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          setReaderSettingsPanelOpen(!isReaderSettingsOpen());
          return;
        }
      }
      if (event.key === "Escape" && isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        return;
      }
      if (event.key === "Escape" && el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        return;
      }
      if (event.key === "Escape" && state.isReaderFullscreen) {
        setReaderFullscreen(false);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!state.isReaderOpen || !state.isReaderFullscreen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const clickedSettingsPanel = !!target.closest("#readerSettingsPanel");
      const clickedChapterPanel = !!target.closest("#chapterListPanel");
      const clickedSettingsBtn = !!target.closest("#readerSettingsBtn");
      const clickedChapterBtn = !!target.closest("#readerChapterListBtn");
      if (isReaderSettingsOpen() && !clickedSettingsPanel && !clickedSettingsBtn) {
        setReaderSettingsPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show") && !clickedChapterPanel && !clickedChapterBtn) {
        setChapterListPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
      }
    });
    window.addEventListener("resize", () => {
      if (state.isReaderOpen) {
        applyReaderTypography();
        scheduleHostReaderContextSync(120);
      }
    });
    window.addEventListener("nexora:course-workspace:layout", () => {
      if (state.materialsPageMode !== "lecture" || state.materialsDetailMode !== "lecture") {
        return;
      }

      renderLectureDetail();
    });

    el.kickerCreateTabBtn.addEventListener("click", () => setUploadTab("create"));
    el.kickerUploadTabBtn.addEventListener("click", () => setUploadTab("upload"));

    el.profileAdminSettingsBtn.addEventListener("click", () => {
      openSettingsView("users").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
    });

    if (el.learningStatusBtn) {
      el.learningStatusBtn.addEventListener("click", () => {
        const opened = window.open("/api/frontend/status", "_blank", "noopener");
        if (opened) opened.opener = null;
      });
    }

    el.openCoursePickerBtn.addEventListener("click", () => {
      renderCoursePicker("");
    });
    el.materialsLectureInput.addEventListener("click", () => {
      renderCoursePicker("");
    });

    el.lectureList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest(".lecture-item");
      if (!item) return;
      openLectureHome(String(item.getAttribute("data-lecture-id") || ""));
    });

    el.lectureDetailPane.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const lectureCard = target.closest("[data-lecture-home-id]");
      if (lectureCard) {
        openLectureHome(String(lectureCard.getAttribute("data-lecture-home-id") || ""));
        return;
      }
    });

    if (el.courseHomePane) {
      el.courseHomePane.addEventListener("click", handleCourseHomeClick);
      el.courseHomePane.addEventListener("keydown", handleCourseHomeKeydown);
      el.courseHomeContent.addEventListener("click", handleCatalogClick);
    }

    el.materialsPreviewPane.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.id !== "coursePickerSearchInput") return;
      renderCoursePicker(target.value || "");
      const input = document.getElementById("coursePickerSearchInput");
      if (input) {
        input.focus();
        const end = String(target.value || "").length;
        input.setSelectionRange(end, end);
      }
    });

    el.materialsPreviewPane.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const courseItem = target.closest("[data-course-picker-id]");
      if (!courseItem) return;
      const lectureId = String(courseItem.getAttribute("data-course-picker-id") || "");
      if (!lectureId) return;
      setSelectedUploadLecture(lectureId);
      renderUploadPreviewEmpty("课程已选择，继续选择教材文件进行预览");
      showToast("课程选择成功");
    });

    el.settingsNavList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-settings-tab]");
      if (!item) return;
      state.settingsTab = String(item.getAttribute("data-settings-tab") || "refinement");
      if (state.settingsTab === "model") {
        loadModelSettings()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载模型设置失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "logs") {
        loadSettingsLogs()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "channels") {
        loadLearningFeedChannels()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载频道失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "users") {
        loadSettingsUsers()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载用户列表失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "refinement") {
        loadRefinementSettings()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载精读列表失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "courses") {
        Promise.all([loadMaterialsRows(), loadRefinementSettings()])
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载课程管理失败：${err.message || "未知错误"}`));
        return;
      }
      renderSettingsView();
    });

    el.settingsDetailPane.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const saveBtn = target.closest("#saveModelSettingsBtn");
      if (saveBtn) {
        saveModelSettings()
          .then(() => showToast("模型设置已保存"))
          .catch((err) => showToast(`保存失败：${err.message || "未知错误"}`));
        return;
      }
      const refreshUsersBtn = target.closest("#refreshSettingsUsersBtn");
      if (refreshUsersBtn) {
        loadSettingsUsers(state.settingsUsersQuery)
          .then(() => showToast("用户列表已刷新"))
          .catch((err) => showToast(`刷新用户列表失败：${err.message || "未知错误"}`));
        return;
      }
      const saveUserIdentityBtn = target.closest("[data-action='save-user-identity']");
      if (saveUserIdentityBtn) {
        if (saveUserIdentityBtn instanceof HTMLButtonElement && saveUserIdentityBtn.disabled) return;
        const userId = String(saveUserIdentityBtn.getAttribute("data-user-id") || "").trim();
        if (!userId) return;
        const card = saveUserIdentityBtn.closest(".settings-user-card");
        const select = card ? card.querySelector("[data-user-identity-select]") : null;
        let identity = select instanceof HTMLSelectElement ? String(select.value || "").trim().toLowerCase() : "";
        if (identity !== "student" && identity !== "teacher") identity = "student";
        if (saveUserIdentityBtn instanceof HTMLButtonElement) {
          saveUserIdentityBtn.disabled = true;
          saveUserIdentityBtn.classList.add("is-saving");
        }
        updateSettingsUserIdentity(userId, identity)
          .then((updated) => {
            if (updated) {
              patchSettingsUserCardIdentity(userId, updated);
              return;
            }
            return loadSettingsUsers(state.settingsUsersQuery);
          })
          .then(() => showToast("用户身份已更新"))
          .catch((err) => {
            if (saveUserIdentityBtn instanceof HTMLButtonElement) {
              saveUserIdentityBtn.disabled = false;
              saveUserIdentityBtn.classList.remove("is-saving");
            }
            showToast(`更新用户身份失败：${err.message || "未知错误"}`);
          });
        return;
      }
      const saveChannelBtn = target.closest("#saveFeedChannelBtn");
      if (saveChannelBtn) {
          saveFeedChannel()
              .then(() => {
                  showToast(state.channelEditState.channelId ? "频道已更新" : "频道创建成功");
                  renderSettingsChannels();
              })
              .catch((err) => showToast(`操作失败：${err.message || "未知错误"}`));
          return;
      }

      const cancelEditBtn = target.closest("#cancelEditChannelBtn");
      if (cancelEditBtn) {
          resetChannelEditState();
          renderSettingsChannels();
          return;
      }

      const createNewChannelBtn = target.closest("#createNewChannelBtn");
      if (createNewChannelBtn) {
          resetChannelEditState();
          renderSettingsChannels();
          return;
      }

      // 删除频道（必须在 select-channel 之前，因为按钮在 item 内部）
      const deleteChannelBtn = target.closest("[data-action='delete-feed-channel']");
      if (deleteChannelBtn) {
          const channelId = String(deleteChannelBtn.getAttribute("data-channel-id") || "");
          if (!channelId) return;
          confirmModalAsync("确认删除该频道？")
              .then((ok) => {
                  if (!ok) return null;
                  return removeLearningFeedChannel(channelId);
              })
              .then((result) => {
                  if (result === null) return;
                  showToast("频道已删除");
                  renderSettingsChannels();
              })
              .catch((err) => showToast(`删除频道失败：${err.message || "未知错误"}`));
          return;
      }

      const selectChannelBtn = target.closest("[data-action='select-channel']");
      if (selectChannelBtn) {
          const channelId = String(selectChannelBtn.getAttribute("data-channel-id") || "").trim();
          if (channelId) {
              openChannelEditDialog(channelId);
          }
          return;
      }

      const createSettingsCourseBtn = target.closest("[data-action='create-settings-course']");
      if (createSettingsCourseBtn) {
          try {
              await createLectureFromSettings();
              state.settingsCourseView = "detail";
              await loadMaterialsRows();
              await loadRefinementSettings();
              renderSettingsCourses();
              showToast("课程创建成功");
          } catch (err) {
              showToast(`创建失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const uploadSettingsBookBtn = target.closest("[data-action='upload-settings-book']");
      if (uploadSettingsBookBtn) {
          try {
              await uploadBookFromSettings();
              state.settingsRefinementView = "detail";
              await loadMaterialsRows();
              await loadRefinementSettings();
              renderSettingsView();
              showToast("教材上传成功，已进入教材管理流程");
          } catch (err) {
              showToast(`上传失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const saveRefinementBookBtn = target.closest("[data-action='save-refinement-book-info']");
      if (saveRefinementBookBtn) {
          if (saveRefinementBookBtn instanceof HTMLButtonElement && saveRefinementBookBtn.disabled) return;

          const lectureId = String(saveRefinementBookBtn.getAttribute("data-lecture-id") || "").trim();
          const bookId = String(saveRefinementBookBtn.getAttribute("data-book-id") || "").trim();

          if (!lectureId || !bookId) return;

          try {
              if (saveRefinementBookBtn instanceof HTMLButtonElement) {
                  saveRefinementBookBtn.disabled = true;
              }

              const saved = await saveRefinementBookInfo(lectureId, bookId);

              if (saved) {
                  showToast("教材资料已保存");
              }
          } catch (err) {
              showToast(`保存失败：${err.message || "未知错误"}`);
          } finally {
              if (saveRefinementBookBtn instanceof HTMLButtonElement && saveRefinementBookBtn.isConnected) {
                  saveRefinementBookBtn.disabled = false;
              }
          }

          return;
      }

      const openRefinementCoverPickerBtn = target.closest("[data-action='open-refinement-book-cover-picker']");
      if (openRefinementCoverPickerBtn) {
          const lectureId = String(openRefinementCoverPickerBtn.getAttribute("data-lecture-id") || "").trim();
          const bookId = String(openRefinementCoverPickerBtn.getAttribute("data-book-id") || "").trim();

          try {
              await openRefinementBookCoverPicker(lectureId, bookId);
          } catch (err) {
              showToast(`打开封面选择失败：${err.message || "未知错误"}`);
          }

          return;
      }

      const closeRefinementCoverPickerBtn = target.closest("[data-action='close-refinement-book-cover-picker']");
      if (closeRefinementCoverPickerBtn) {
          closeRefinementBookCoverPicker();
          return;
      }

      const selectRefinementCoverBtn = target.closest("[data-action='select-refinement-book-cover']");
      if (selectRefinementCoverBtn) {
          const coverPath = String(selectRefinementCoverBtn.getAttribute("data-cover-path") || "").trim();

          if (coverPath) {
              setRefinementBookCoverSelection(coverPath);
              closeRefinementBookCoverPicker();
          }

          return;
      }

      const clearRefinementCoverBtn = target.closest("[data-action='clear-refinement-book-cover']");
      if (clearRefinementCoverBtn) {
          setRefinementBookCoverSelection("");
          return;
      }

      const showSettingsCourseCreateBtn = target.closest("[data-action='show-settings-course-create']");
      if (showSettingsCourseCreateBtn) {
          state.settingsCourseView = "create";
          renderSettingsCourses();
          return;
      }

      const showSettingsCourseDetailBtn = target.closest("[data-action='show-settings-course-detail']");
      if (showSettingsCourseDetailBtn) {
          state.settingsCourseView = "detail";
          renderSettingsCourses();
          return;
      }

      const showSettingsBookUploadBtn = target.closest("[data-action='show-settings-book-upload']");
      if (showSettingsBookUploadBtn) {
          state.settingsRefinementView = "upload";
          renderSettingsRefinement();
          return;
      }

      const showSettingsRefinementDetailBtn = target.closest("[data-action='show-settings-refinement-detail']");
      if (showSettingsRefinementDetailBtn) {
          state.settingsRefinementView = "detail";
          renderSettingsRefinement();
          return;
      }

      const toggleSettingsBookUploadBtn = target.closest("[data-action='toggle-settings-book-upload']");
      if (toggleSettingsBookUploadBtn) {
          state.settingsRefinementView = "detail";
          renderSettingsView();
          return;
      }

      // 课程管理：选择课程
      const selectCourseBtn = target.closest("[data-action='select-settings-course']");
      if (selectCourseBtn) {
          const lectureId = String(selectCourseBtn.getAttribute("data-lecture-id") || "").trim();
          if (lectureId) {
              state.settingsCourseEditId = lectureId;
              state.settingsCourseView = "detail";
              renderSettingsCourses();
          }
          return;
      }

      // 课程管理：保存课程
      const saveCourseBtn = target.closest("[data-action='save-settings-course']");
      if (saveCourseBtn) {
          const lectureId = state.settingsCourseEditId;
          if (!lectureId) return;
          const titleInput = document.getElementById("settingsCourseTitleInput");
          const categoryInput = document.getElementById("settingsCourseCategoryInput");
          const descInput = document.getElementById("settingsCourseDescInput");
          const coverInput = document.getElementById("settingsCourseCoverInput");
          const updates = {};
          if (titleInput) updates.title = String(titleInput.value || "").trim();
          if (categoryInput) updates.category = String(categoryInput.value || "").trim();
          if (descInput) updates.description = String(descInput.value || "").trim();
          if (coverInput) updates.cover_path = String(coverInput.value || "").trim();
          try {
              await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(updates),
              });
              showToast("课程已更新");
              await loadMaterialsRows();
              renderSettingsCourses();
          } catch (err) {
              showToast(`保存失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const startCourseOutlineBtn = target.closest("[data-action='start-course-outline']");
      if (startCourseOutlineBtn) {
          const lectureId = String(startCourseOutlineBtn.getAttribute("data-lecture-id") || "").trim();
          if (!lectureId) return;
          try {
              await startOutline(lectureId);
              renderSettingsCourses();
              showToast("已开始课程大纲生成");
          } catch (err) {
              showToast(`大纲生成启动失败：${err.message || "未知错误"}`);
          }
          return;
      }

      // 课程管理：AI 生成简介
      const genDescBtn = target.closest("[data-action='generate-course-description']");
      if (genDescBtn) {
          showToast("AI 生成功能即将上线");
          return;
      }

      // 课程管理：打开封面选择器
      const openCoverPickerBtn = target.closest("[data-action='open-cover-picker']");
      if (openCoverPickerBtn) {
          openCoverPicker();
          return;
      }

      // 课程管理：关闭封面选择器
      const closeCoverPickerBtn = target.closest("[data-action='close-cover-picker']");
      if (closeCoverPickerBtn) {
          closeCoverPicker();
          return;
      }

      // 课程管理：封面选择器背景点击关闭
      const coverPickerBackdrop = target.closest(".settings-cover-picker-backdrop");
      if (coverPickerBackdrop) {
          closeCoverPicker();
          return;
      }

      // 课程管理：选择封面图片
      const coverPickerItem = target.closest("[data-action='select-cover-image']");
      if (coverPickerItem) {
          const coverPath = String(coverPickerItem.getAttribute("data-cover-path") || "").trim();
          if (coverPath) {
              const coverInput = document.getElementById("settingsCourseCoverInput");
              const coverPreview = document.getElementById("settingsCourseCoverPreview");
              if (coverInput) coverInput.value = coverPath;
              if (coverPreview) {
                  coverPreview.innerHTML = `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="封面">`;
              }
              closeCoverPicker();
          }
          return;
      }

      // 新建频道模式：添加用户到选择列表
      const addUserSelectionBtn = target.closest("[data-action='add-user-to-selection']");
      if (addUserSelectionBtn) {
          const userId = String(addUserSelectionBtn.getAttribute("data-user-id") || "").trim();
          if (userId) {
              state.channelEditState.selectedUserIds = [...(state.channelEditState.selectedUserIds || []), userId];
              renderChannelEditPanel();
          }
          return;
      }

      // 新建频道模式：从选择列表移除用户
      const removeUserSelectionBtn = target.closest("[data-action='remove-user-from-selection']");
      if (removeUserSelectionBtn) {
          const userId = String(removeUserSelectionBtn.getAttribute("data-user-id") || "").trim();
          if (userId) {
              state.channelEditState.selectedUserIds = (state.channelEditState.selectedUserIds || []).filter((id) => id !== userId);
              renderChannelEditPanel();
          }
          return;
      }

      // 设为全员公开
      const toggleAllPublicOnBtn = target.closest("[data-action='toggle-all-public-on']");
      if (toggleAllPublicOnBtn) {
          state.channelEditState.isAllPublic = true;
          state.channelEditState.selectedUserIds = ["ALL"];
          renderChannelEditPanel();
          return;
      }

      // 取消全员公开
      const toggleAllPublicOffBtn = target.closest("[data-action='toggle-all-public-off']");
      if (toggleAllPublicOffBtn) {
          state.channelEditState.isAllPublic = false;
          state.channelEditState.selectedUserIds = [];
          renderChannelEditPanel();
          return;
      }

      // 编辑频道模式：添加用户到频道（先更新本地状态，再异步请求）
      const addUserBtn = target.closest("[data-action='add-user-to-channel']");
      if (addUserBtn) {
          const channelId = String(addUserBtn.getAttribute("data-channel-id") || "").trim();
          const userId = String(addUserBtn.getAttribute("data-user-id") || "").trim();
          if (channelId && userId) {
              addUserToChannel(channelId, userId);
          }
          return;
      }

      // 编辑频道模式：从频道移除用户
      const removeUserBtn = target.closest("[data-action='remove-user-from-channel']");
      if (removeUserBtn) {
          const channelId = String(removeUserBtn.getAttribute("data-channel-id") || "").trim();
          const userId = String(removeUserBtn.getAttribute("data-user-id") || "").trim();
          if (channelId && userId) {
              removeUserFromChannel(channelId, userId);
          }
          return;
      }
      const startBtn = target.closest("[data-action='start-refinement']");
      if (startBtn) {
        const lectureId = String(startBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(startBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;

        if (startBtn instanceof HTMLButtonElement) {
          startBtn.disabled = true;
        }

        markRefinementItemCoarseQueued(lectureId, bookId);
        renderSettingsRefinement();

        try {
          await startRefinement(lectureId, bookId);
          showToast("已提交粗读任务");
          renderSettingsView();
        } catch (err) {
          try {
            await loadRefinementSettings();
          } catch (refreshErr) {
            renderSettingsView();
            showToast(`粗读启动失败：${err.message || "未知错误"}；状态刷新失败：${refreshErr.message || "未知错误"}`);
            return;
          }

          renderSettingsView();
          showToast("粗读启动失败：" + (err.message || "未知错误"));
        }

        return;
      }
      const stopBtn = target.closest("[data-action='stop-refinement']");
      if (stopBtn) {
        const lectureId = String(stopBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(stopBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        const ok = await confirmModalAsync("确认重置该教材状态？这会清空当前提炼进度。");
        if (!ok) return;
        stopRefinement(lectureId, bookId)
          .then(() => {
            showToast("已停止并重置教材状态");
          })
          .catch((err) => showToast("停止失败：" + (err.message || "未知错误")));
        return;
      }
      const toggleStepsBtn = target.closest("[data-action='toggle-refine-steps']");
      if (toggleStepsBtn) {
        const key = String(toggleStepsBtn.getAttribute("data-refine-key") || "");
        if (!key) return;
        state.refinementExpandedMap[key] = !state.refinementExpandedMap[key];
        renderSettingsRefinement();
        return;
      }
      const intensiveBtn = target.closest("[data-action='start-intensive']");
      if (intensiveBtn) {
        const lectureId = String(intensiveBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(intensiveBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startIntensive(lectureId, bookId)
          .then(() => {
            showToast("已开始精读");
          })
          .catch((err) => showToast("精读执行失败：" + (err.message || "未知错误")));
        return;
      }
      const sectionBtn = target.closest("[data-action='start-section']");
      if (sectionBtn) {
        const lectureId = String(sectionBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(sectionBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startSection(lectureId, bookId)
          .then(() => {
            showToast("已开始分节");
          })
          .catch((err) => showToast("分节执行失败：" + (err.message || "未知错误")));
        return;
      }
      const annotationBtn = target.closest("[data-action='start-annotation']");
      if (annotationBtn) {
        const lectureId = String(annotationBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(annotationBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startAnnotation(lectureId, bookId)
          .then(() => {
            showToast("已开始批注生成");
          })
          .catch((err) => showToast("批注执行失败：" + (err.message || "未知错误")));
        return;
      }
      const summaryBtn = target.closest("[data-action='start-summary']");
      if (summaryBtn) {
        const lectureId = String(summaryBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(summaryBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startSummary(lectureId, bookId)
          .then(() => {
            showToast("已开始全书概述生成");
          })
          .catch((err) => showToast("全书概述执行失败：" + (err.message || "未知错误")));
        return;
      }
      const videoBtn = target.closest("[data-action='start-video']");
      if (videoBtn) {
        const lectureId = String(videoBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(videoBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startVideo(lectureId, bookId)
          .then(() => {
            showToast("已开始视频搜索");
            renderSettingsView();
          })
          .catch((err) => showToast("视频搜索启动失败：" + (err.message || "未知错误")));
        return;
      }
    });

    el.settingsDetailPane.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target instanceof HTMLSelectElement) {
          if (target.id === "settingsUploadLectureSelect") {
              state.settingsBookUpload.lectureId = String(target.value || "").trim();
              return;
          }

          if (target.id === "settingsLogCategorySelect") {
              state.settingsLogCategory = String(target.value || "all");
              if (state.settingsLogCategory !== "model") {
                  state.settingsLogSource = "";
              }
              loadSettingsLogs().catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
              return;
          }
          if (target.id === "settingsLogSourceSelect") {
              state.settingsLogSource = String(target.value || "");
              loadSettingsLogs().catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
              return;
          }
      }

      if (target instanceof HTMLInputElement && target.id === "settingsUploadFileInput") {
          rememberSettingsBookUploadInputFile(target);
          return;
      }

      if (target.matches(".settings-user-select-item input[type='checkbox']")) {
          const userId = String(target.value || "").trim();
          if (!userId) return;

          const selectedIds = state.channelEditState.selectedUserIds || [];
          if (target.checked) {
              if (!selectedIds.includes(userId)) {
                  state.channelEditState.selectedUserIds = [...selectedIds, userId];
              }
          } else {
              state.channelEditState.selectedUserIds = selectedIds.filter((id) => id !== userId);
          }
          renderSettingsChannels();
          return;
      }
    });

    el.settingsDetailPane.addEventListener("input", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;

      if (target.matches("[data-channel-user-search]")) {
          state.channelEditState.searchQuery = String(target.value || "").trim();
          renderSettingsChannels();

          const newSearchInput = document.querySelector("[data-channel-user-search]");
          if (newSearchInput instanceof HTMLInputElement) {
              newSearchInput.focus();
              const len = newSearchInput.value.length;
              newSearchInput.setSelectionRange(len, len);
          }
          return;
      }

      if (target.id === "settingsChannelTitleInput") {
          state.channelEditState.title = String(target.value || "").trim();
          return;
      }

      if (target.id === "settingsUploadBookTitleInput") {
          state.settingsBookUpload.title = String(target.value || "");
          return;
      }

      if (target.id === "settingsUploadFileInput") {
          rememberSettingsBookUploadInputFile(target);
          return;
      }
    });

    if (el.confirmBackdrop) {
      el.confirmBackdrop.addEventListener("click", (event) => {
        if (event.target === el.confirmBackdrop) {
          closeConfirmModal();
        }
      });
    }

    el.materialsFileInput.addEventListener("change", async () => {
      const file = el.materialsFileInput.files ? el.materialsFileInput.files[0] : null;
      await handleSelectedUploadFile(file);
    });

    if (el.materialsFileDropZone) {
      ["dragenter", "dragover"].forEach((eventName) => {
        el.materialsFileDropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.materialsFileDropZone.classList.add("is-dragover");
        });
      });

      ["dragleave", "drop"].forEach((eventName) => {
        el.materialsFileDropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.materialsFileDropZone.classList.remove("is-dragover");
        });
      });

      el.materialsFileDropZone.addEventListener("drop", async (event) => {
        const files = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
        const file = files && files.length ? files[0] : null;
        await handleSelectedUploadFile(file);
      });
    }

    el.createLectureBtn.addEventListener("click", async () => {
      try {
        await createLecture();
        await refreshAll();
        setView("materials");
        closeReader();
        renderLectureList();
        renderLectureDetail();
        showToast("课程创建成功");
      } catch (err) {
        showToast(`创建失败：${err.message || "未知错误"}`);
      }
    });

    el.materialsUploadBookBtn.addEventListener("click", async () => {
      try {
        await uploadBookByFile();
        await refreshAll();
        setView("materials");
        closeReader();
        renderLectureList();
        renderLectureDetail();
        showToast("教材上传成功，已完成文本提取并提交向量化");
      } catch (err) {
        showToast(`上传失败：${err.message || "未知错误"}`);
      }
    });

  }

// ─────── Init & Bootstrap ─────────────────────────────────────────────
  function updateAdminVisibility() {
    el.profileAdminSettingsBtn.hidden = !state.isAdmin;
    if (el.openUploadViewBtn) {
      el.openUploadViewBtn.hidden = true;
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.hidden = true;
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.hidden = true;
    }
  }

  async function init() {
    state.username = getRuntimeUsername();
    syncTelemetryUserId();
    loadReaderSettings();
    setView("dashboard");
    syncReaderSettingsPanel();
    setUploadTab("create");
    renderUploadPreviewEmpty("请选择教材文件后预览");
    renderSelectedUploadFileState(null);
    setUploadTip("支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST", false);
    notifyHostReaderState(false);

    await loadFrontendContext();
    updateAdminVisibility();
    await refreshAll();
    bindEvents();
  }

  init().catch((err) => {
    showToast(`初始化失败：${err && err.message ? err.message : "未知错误"}`);
  });

  window.addEventListener("beforeunload", () => {
    stopSettingsPolling();
    notifyHostInputVisibility(false);
    closeReader(true);
    const telemetry = window.NXLTelemetry;
    if (telemetry && typeof telemetry.flush === "function") {
      telemetry.flush(true);
    }
  });
})();
