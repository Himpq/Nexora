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
    progressList: document.getElementById("progressList"),
    timePieChart: document.getElementById("timePieChart"),
    dashboardSidePanelTitle: document.getElementById("dashboardSidePanelTitle"),
    learningFeedPanel: document.getElementById("learningFeedPanel"),
    learningFeedComposeBtn: document.getElementById("learningFeedComposeBtn"),
    feedChannelSelect: document.getElementById("feedChannelSelect"),
    dashboardProgressTabBtn: document.getElementById("dashboardProgressTabBtn"),
    dashboardProgressFeedTabBtn: document.getElementById("dashboardProgressFeedTabBtn"),
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
    materialsFileInput: document.getElementById("materialsFileInput"),
    materialsUploadBookBtn: document.getElementById("materialsUploadBookBtn"),
    uploadTip: document.getElementById("uploadTip"),
    materialsPreviewHead: document.getElementById("materialsPreviewHead"),
    materialsPreviewPane: document.getElementById("materialsPreviewPane"),
    backFromSettingsBtn: document.getElementById("backFromSettingsBtn"),
    settingsNavList: document.getElementById("settingsNavList"),
    settingsDetailPane: document.getElementById("settingsDetailPane"),
    confirmBackdrop: document.getElementById("confirmBackdrop"),
    confirmBody: document.getElementById("confirmBody"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  };

  const READER_SETTINGS_STORAGE_KEY = "nxl_reader_settings_v1";
  const DEFAULT_READER_SETTINGS = Object.freeze({
    fontSize: 18,
    paragraphSpacing: 1.7,
    edgeClickWidth: 60,
    theme: "light",
    displayMode: "zh-ja",
    enableKeyNavigation: true,
    preferredTranslator: "auto",
  });

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
    catalogContext: null,
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
    readerBookDetailXml: "",
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
    return String(q.get("username") || window.NEXORA_USERNAME || window.nexoraUsername || "").trim();
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

  function renderProgressList() {
    const courses = buildDashboardCourses(state.dashboardRows);
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
      <article class="nxl-course-item" data-progress-lecture-id="${escapeHtml(course.id)}">
        <div class="nxl-course-top">
          <div class="nxl-course-title">${escapeHtml(course.title)}</div>
          <div class="nxl-course-percent">${course.progress}%</div>
        </div>
        <div class="nxl-course-current">当前：${escapeHtml(course.chapterCurrent)}</div>
        <div class="nxl-course-bar"><div class="nxl-course-bar-fill" style="width:${course.progress}%"></div></div>
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
          <button id="teacherRefreshBtn" class="nxl-icon-btn" type="button" title="刷新">↻</button>
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
    if (el.timePieChart) el.timePieChart.hidden = false;
    const teacherMode = isTeacherPanelMode();
    if (el.dashboardSidePanelTitle) {
      el.dashboardSidePanelTitle.textContent = teacherMode ? "教师Panel" : "学习时长数据";
    }
    if (el.timePieChart) {
      el.timePieChart.setAttribute("aria-label", teacherMode ? "教师课程列表" : "学习时间占比");
    }
    if (teacherMode) {
      renderTeacherPanel();
      return;
    }
    const courses = buildDashboardCourses(state.dashboardRows).slice(0, 6);
    const totalByRows = courses.reduce((sum, item) => sum + toNumber(item.studyHours, 0), 0);
    const total = totalByRows;
    if (!courses.length || total <= 0) {
      el.timePieChart.innerHTML = '<div class="materials-empty">暂无学习时长数据</div>';
      return;
    }

    const safeTotal = total;
    const cx = 192;
    const cy = 148;
    const outer = 94;
    const inner = 50;
    let currentAngle = 0;

    const segments = courses.map((course) => {
      const value = toNumber(course.studyHours, 0);
      const angle = (value / safeTotal) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      const mid = startAngle + angle / 2;
      currentAngle = endAngle;
      const anchor = polarToCartesian(cx, cy, outer + 14, mid);
      const bend = polarToCartesian(cx, cy, outer + 34, mid);
      const isRight = bend.x >= cx;
      const labelX = isRight ? 332 : 48;
      const textAnchor = isRight ? "start" : "end";
      const ratio = Math.round((value / safeTotal) * 100);
      return {
        ...course,
        id: `seg-${course.id}`,
        path: donutPath(cx, cy, outer, inner, startAngle, endAngle),
        line: `${anchor.x},${anchor.y} ${bend.x},${bend.y} ${labelX},${bend.y}`,
        labelLine: {
          x1: anchor.x,
          y1: anchor.y,
          x2: bend.x,
          y2: bend.y,
          x3: labelX,
          y3: bend.y,
        },
        labelX,
        labelY: bend.y - 6,
        subY: bend.y + 12,
        ratio,
        textAnchor,
        offsetX: Math.cos(((mid - 90) * Math.PI) / 180) * 8,
        offsetY: Math.sin(((mid - 90) * Math.PI) / 180) * 8,
      };
    });

    el.timePieChart.innerHTML = `
      <svg class="nxl-pie-svg" viewBox="0 0 380 300" role="img" aria-label="学习时间占比">
        ${segments
          .map(
            (seg) => `
              <g class="nxl-pie-segment" data-segment-id="${escapeHtml(seg.id)}">
                <path d="${seg.path}" fill="${seg.color}" fill-rule="evenodd"></path>
              </g>
            `
          )
          .join("")}
        <circle cx="${cx}" cy="${cy}" r="${inner - 1}" fill="#ffffff"></circle>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="nxl-pie-center-label">总学习时长</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="nxl-pie-center-value">${escapeHtml(total.toFixed(1))}h</text>
        ${segments
          .map(
            (seg) => `
              <g class="nxl-pie-callout" data-segment-id="${escapeHtml(seg.id)}">
                <polyline points="${seg.labelLine.x1},${seg.labelLine.y1} ${seg.labelLine.x2},${seg.labelLine.y2} ${seg.labelLine.x3},${seg.labelLine.y3}"></polyline>
                <text x="${seg.labelX}" y="${seg.labelY}" text-anchor="${seg.textAnchor}">${escapeHtml(seg.title)}</text>
                <text x="${seg.labelX}" y="${seg.subY}" text-anchor="${seg.textAnchor}" class="nxl-pie-callout-sub">${escapeHtml(`${seg.ratio}% · 进度 ${seg.progress}%`)}</text>
              </g>
            `
          )
          .join("")}
      </svg>
    `;

    const segmentEls = Array.from(el.timePieChart.querySelectorAll(".nxl-pie-segment"));
    const calloutEls = Array.from(el.timePieChart.querySelectorAll(".nxl-pie-callout"));
    function setActive(segmentId) {
      segmentEls.forEach((node) => {
        const active = node.getAttribute("data-segment-id") === segmentId;
        node.classList.toggle("is-active", active);
        const path = node.querySelector("path");
        if (!path) return;
        const segment = segments.find((item) => item.id === node.getAttribute("data-segment-id"));
        if (!segment) return;
        path.style.transform = active ? `translate(${segment.offsetX}px, ${segment.offsetY}px) scale(1.035)` : "";
      });
      calloutEls.forEach((node) => {
        node.classList.toggle("is-active", node.getAttribute("data-segment-id") === segmentId);
      });
    }
    function clearActive() {
      segmentEls.forEach((node) => {
        node.classList.remove("is-active");
        const path = node.querySelector("path");
        if (path) path.style.transform = "";
      });
      calloutEls.forEach((node) => node.classList.remove("is-active"));
    }
    segmentEls.forEach((node) => {
      node.addEventListener("mouseenter", () => setActive(node.getAttribute("data-segment-id") || ""));
      node.addEventListener("mouseleave", clearActive);
    });
    calloutEls.forEach((node) => {
      node.addEventListener("mouseenter", () => setActive(node.getAttribute("data-segment-id") || ""));
      node.addEventListener("mouseleave", clearActive);
    });
  }

// ─────── Feed Rendering & Compose ─────────────────────────────────────
  function renderLearningFeeds() {
    if (!el.learningFeedPanel) return;
    if (el.progressList) el.progressList.hidden = state.dashboardSideTab === "feed";
    el.learningFeedPanel.hidden = state.dashboardSideTab !== "feed";
    if (el.learningFeedComposeBtn) el.learningFeedComposeBtn.hidden = state.dashboardSideTab !== "feed";
    if (el.feedChannelSelect) {
      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      el.feedChannelSelect.hidden = state.dashboardSideTab !== "feed";
      el.feedChannelSelect.innerHTML = channels.length
        ? channels.map((row) => `<option value="${escapeHtml(String((row && row.id) || ""))}">${escapeHtml(String((row && row.title) || ""))}</option>`).join("")
        : '<option value="public_all">所有用户</option>';
      el.feedChannelSelect.value = String(state.selectedFeedChannelId || "public_all");
    }
    if (state.dashboardSideTab !== "feed") return;
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
    if (el.feedChannelSelect) {
      el.feedChannelSelect.hidden = isProgress;
      el.feedChannelSelect.value = String(state.selectedFeedChannelId || "public_all");
    }
    renderPie();
    renderLearningFeeds();
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
    const resp = await fetch(resolveApiUrl("/api/frontend/learning-feeds"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: text,
        content: text,
        channel_id: String(state.selectedFeedChannelId || "public_all"),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    await loadLearningFeeds();
    exitFeedComposeMode();
    return data;
  }

  async function deleteLearningFeed(feedId) {
    const id = String(feedId || "").trim();
    if (!id) return;
    const resp = await fetch(resolveApiUrl(`/api/frontend/learning-feeds/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    await loadLearningFeeds();
    renderLearningFeeds();
  }

  async function deleteLearningFeedComment(feedId, commentId) {
    const fid = String(feedId || "").trim();
    const cid = String(commentId || "").trim();
    if (!fid || !cid) return;
    const resp = await fetch(resolveApiUrl(`/api/frontend/learning-feeds/${encodeURIComponent(fid)}/comments/${encodeURIComponent(cid)}`), {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
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

  function isDoneStatus(value) {
    return ["done", "completed", "success"].includes(normalizeStatusKey(value));
  }

  function isRunningStatus(value) {
    return ["running", "queued"].includes(normalizeStatusKey(value));
  }

  function isErrorStatus(value) {
    return ["error", "failed"].includes(normalizeStatusKey(value));
  }

  function buildRefineFlow(item) {
    const coarseStatus = normalizeStatusKey(item && item.coarse_status);
    const intensiveStatus = normalizeStatusKey(item && item.intensive_status);
    const sectionStatus = normalizeStatusKey(item && item.section_status);
    const annotationStatus = normalizeStatusKey(item && item.annotation_status);
    const summaryStatus = normalizeStatusKey(item && item.summary_status);
    const hasError = isErrorStatus(coarseStatus)
      || isErrorStatus(intensiveStatus)
      || isErrorStatus(sectionStatus)
      || isErrorStatus(annotationStatus)
      || isErrorStatus(summaryStatus);
    const steps = [
      { key: "coarse", label: "粗读", done: isDoneStatus(coarseStatus), running: isRunningStatus(coarseStatus) },
      { key: "intensive", label: "精读", done: isDoneStatus(intensiveStatus), running: isRunningStatus(intensiveStatus) },
      { key: "section", label: "分节", done: isDoneStatus(sectionStatus), running: isRunningStatus(sectionStatus) },
      { key: "summary", label: "概述", done: isDoneStatus(summaryStatus), running: isRunningStatus(summaryStatus) },
      { key: "annotation", label: "批注", done: isDoneStatus(annotationStatus), running: isRunningStatus(annotationStatus) },
    ];
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
    return {
      action: "start-annotation",
      title: "全部完成",
      text: "✓",
      enabled: false,
    };
  }

// ─────── Settings: Rendering ──────────────────────────────────────────
  function renderSettingsNav() {
    const tabs = [
      { id: "refinement", title: "待精读列表", sub: "选择教材并触发精读" },
      { id: "model", title: "模型设置", sub: "设置默认模型与任务模型" },
      { id: "channels", title: "频道管理", sub: "创建和筛选动态频道" },
      { id: "users", title: "用户管理", sub: "查看用户信息并设置身份" },
      { id: "logs", title: "模型日志", sub: "查看模型调用、工具链与输出" },
      { id: "profile", title: "用户信息", sub: "当前用户与连接状态" },
    ];
    el.settingsNavList.innerHTML = tabs.map((tab) => `
      <button class="settings-nav-item ${state.settingsTab === tab.id ? "is-active" : ""}" data-settings-tab="${tab.id}" type="button">
        <div class="settings-nav-title">${escapeHtml(tab.title)}</div>
        <div class="settings-nav-sub">${escapeHtml(tab.sub)}</div>
      </button>
    `).join("");
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
      saveBtn.textContent = "✓";
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
              <select id="${escapeHtml(identitySelectId)}" class="input-lite settings-user-select" data-user-identity-select="${escapeHtml(userId)}" ${isLocked ? "disabled" : ""}>
                <option value="student" ${identity === "student" ? "selected" : ""}>学生</option>
                <option value="teacher" ${identity === "teacher" ? "selected" : ""}>教师</option>
              </select>
              <button class="nxl-icon-btn nxl-icon-btn-dark settings-user-save-btn" type="button" data-action="save-user-identity" data-user-id="${escapeHtml(userId)}" ${isLocked ? "disabled data-locked=\"1\" title=\"不可修改其他管理员身份\"" : "title=\"保存身份\""} aria-label="保存身份">✓</button>
            </div>
          </article>
        `;
      }).join("") : emptyHtml);

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-title">用户管理</div>
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
            <div class="settings-title" style="color:#b91c1c;">加载失败</div>
            <div class="settings-sub">${escapeHtml(error)}</div>
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
          <div class="settings-title">用户信息</div>
          <div class="settings-grid">
            <div><div class="settings-kv-label">用户名</div><div class="settings-kv-value">${escapeHtml(username)}</div></div>
            <div><div class="settings-kv-label">角色</div><div class="settings-kv-value">${escapeHtml(role)}</div></div>
            <div><div class="settings-kv-label">全部课程</div><div class="settings-kv-value">${state.allLectureRows.length}</div></div>
            <div><div class="settings-kv-label">总学习时长</div><div class="settings-kv-value">${toNumber(state.totalStudyHours, 0).toFixed(1)}h</div></div>
          </div>
        </article>
        <article class="settings-card">
          <div class="settings-title">Nexora 连接</div>
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
    const sourceOptions = ['<option value="">全部模型</option>']
      .concat(sources.map((row) => `<option value="${escapeHtml(row)}">${escapeHtml(row)}</option>`))
      .join("");
    const categoryOptions = [
      ["所有日志", "all"],
      ["模型日志", "model"],
      ["错误日志", "error"],
    ].map(([label, value]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
    const rowHtml = rows.length ? rows.map((row) => {
      const kind = String((row && row.kind) || "");
      const source = String((row && row.source) || "unknown");
      const title = String((row && (row.title || row.event_type || row.tool_name)) || "");
      const ts = String((row && row.timestamp) || "—");
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
      return `
        <article class="settings-log-item">
          <div class="settings-log-head">
            <div>
              <div class="settings-log-title">${escapeHtml(title || "日志记录")}</div>
              <div class="settings-log-meta">${escapeHtml(ts)} · ${escapeHtml(source)} · ${escapeHtml(kind || "event")}</div>
            </div>
          </div>
          <pre class="settings-log-body">${escapeHtml(content)}</pre>
        </article>
      `;
    }).join("") : '<div class="materials-empty">暂无模型日志</div>';
    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-title">模型日志</div>
          <div class="settings-sub">按来源与类型筛选最近的模型执行记录。</div>
          <div class="settings-inline-form settings-model-form">
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsLogCategorySelect">日志分类</label>
              <select id="settingsLogCategorySelect" class="input-lite settings-model-select">${categoryOptions}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsLogSourceSelect">模型来源</label>
              <select id="settingsLogSourceSelect" class="input-lite settings-model-select" ${state.settingsLogCategory === "model" ? "" : "disabled"}>${sourceOptions}</select>
            </div>
          </div>
        </article>
        ${rowHtml}
      </section>
    `;
    const categorySelect = document.getElementById("settingsLogCategorySelect");
    const sourceSelect = document.getElementById("settingsLogSourceSelect");
    if (categorySelect) categorySelect.value = String(state.settingsLogCategory || "all");
    if (sourceSelect) sourceSelect.value = String(state.settingsLogSource || "");
  }

  function renderSettingsRefinement() {
    const queueSize = toNumber(state.refinementQueue.queue_size, 0);
    const runningCount = toNumber(state.refinementQueue.running_count, 0);
    const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];

    let container = document.getElementById("refineItemsContainer");
    if (state.refinementViewBootstrapped && !container) {
      state.refinementViewBootstrapped = false;
    }

    if (!state.refinementViewBootstrapped) {
      el.settingsDetailPane.innerHTML = `
        <section class="settings-detail-scroll">
          <article class="settings-card">
            <div class="settings-title">精读队列状态</div>
            <div class="settings-grid">
              <div><div class="settings-kv-label">排队数量</div><div class="settings-kv-value" id="refineQueueCountValue">0</div></div>
              <div><div class="settings-kv-label">执行中</div><div class="settings-kv-value" id="refineRunningCountValue">0</div></div>
            </div>
            <div class="settings-sub">状态会自动刷新</div>
          </article>
          <section id="refineItemsContainer"></section>
        </section>
      `;
      const scrollEl0 = el.settingsDetailPane.querySelector(".settings-detail-scroll");
      if (scrollEl0) {
        scrollEl0.addEventListener("scroll", () => {
          state.refinementScrollTop = scrollEl0.scrollTop;
        }, { passive: true });
      }
      state.refinementViewBootstrapped = true;
      container = document.getElementById("refineItemsContainer");
    }

    const queueEl = document.getElementById("refineQueueCountValue");
    const runningEl = document.getElementById("refineRunningCountValue");
    if (queueEl) queueEl.textContent = String(queueSize);
    if (runningEl) runningEl.textContent = String(runningCount);

    container = document.getElementById("refineItemsContainer");
    if (!container) return;

    const desiredKeys = new Set(rows.map((item) => `${String(item.lecture_id || "")}::${String(item.book_id || "")}`));
    Array.from(container.querySelectorAll("[data-refine-key]")).forEach((node) => {
      const key = String(node.getAttribute("data-refine-key") || "");
      if (!desiredKeys.has(key)) node.remove();
    });

    if (!rows.length) {
      container.innerHTML = '<div class="materials-empty">暂无待精读教材</div>';
      return;
    }

    rows.forEach((item) => {
      const lectureId = String(item.lecture_id || "");
      const bookId = String(item.book_id || "");
      const key = `${lectureId}::${bookId}`;
      const title = `${String(item.book_title || item.book_id || "未命名教材")} - ${String(item.lecture_title || item.lecture_id || "未命名课程")}`;
      const progress = refinementStatusText(item);
      const flow = buildRefineFlow(item);
      const actionMeta = getRefinementActionMeta(item);
      const btnAction = actionMeta.action;
      const btnTitle = actionMeta.title;
      const btnText = actionMeta.text;
      const btnEnabled = actionMeta.enabled;
      const steps = Array.isArray(item.progress_steps) ? item.progress_steps : [];
      const expanded = !!state.refinementExpandedMap[key];
      const flowStepsHtml = flow.steps.map((step, idx) => {
        let cls = "pending";
        if (step.done) {
          cls = "done";
        } else if (step.running || idx === flow.activeIndex) {
          cls = "active";
        } else if (flow.hasError && idx === Math.max(flow.doneCount, 0)) {
          cls = "error";
        }
        return `<span class="refine-flow-step is-${cls}">${escapeHtml(step.label)}</span>`;
      }).join("");
      const stepHtml = steps.slice(-12).map((step) => {
        const sTitle = String(step && step.title || "步骤");
        const sPreview = String(step && step.preview || "");
        return `<div class="refine-step-row">
          <div class="refine-step-title">- ${escapeHtml(sTitle)}</div>
          ${sPreview ? `<div class="refine-step-preview">${escapeHtml(sPreview)}</div>` : ""}
        </div>`;
      }).join("");

      let card = container.querySelector(`[data-refine-key="${CSS.escape(key)}"]`);
      if (!card) {
        card = document.createElement("article");
        card.className = "refine-item";
        card.setAttribute("data-refine-key", key);
        container.appendChild(card);
      }
      card.innerHTML = `
        <div class="refine-item-head">
          <div>
            <div class="refine-item-title">${escapeHtml(title)}</div>
            <div class="refine-item-date">${escapeHtml(formatTs(item.updated_at))}</div>
          </div>
          <div class="refine-item-actions">
            <button
              class="nxl-icon-btn ${btnEnabled ? "nxl-icon-btn-dark" : ""}"
              data-action="${btnAction}"
              data-lecture-id="${escapeHtml(lectureId)}"
              data-book-id="${escapeHtml(bookId)}"
              ${btnEnabled ? "" : "disabled"}
              type="button"
              title="${escapeHtml(btnTitle)}"
            >${btnText}</button>
            <button
              class="nxl-icon-btn nxl-icon-btn-danger"
              data-action="stop-refinement"
              data-lecture-id="${escapeHtml(lectureId)}"
              data-book-id="${escapeHtml(bookId)}"
              type="button"
              title="重置状态"
            >■</button>
          </div>
        </div>
        <div class="refine-progress-box ${expanded ? "is-expanded" : ""}" data-action="toggle-refine-steps" data-refine-key="${escapeHtml(key)}" title="点击展开/收起模型工具链">
          <span class="refine-thinking-dot"></span>
          <span class="refine-progress-text">${escapeHtml(progress)}</span>
        </div>
        <div class="refine-flow-wrap">
          <div class="refine-flow-bar">
            <span class="refine-flow-fill ${flow.hasError ? "is-error" : ""}" style="width:${flow.percent.toFixed(2)}%"></span>
          </div>
          <div class="refine-flow-steps">${flowStepsHtml}</div>
        </div>
        <div class="refine-steps ${expanded ? "is-open" : ""}">
          ${stepHtml || '<div class="refine-step-preview">暂无工具链步骤</div>'}
        </div>
        ${item.question_error || item.intensive_error || item.coarse_error || item.section_error || item.annotation_error || item.summary_error || item.refinement_error ? `<div class="refine-item-meta" style="color:#b91c1c;">错误：${escapeHtml(item.question_error || item.intensive_error || item.coarse_error || item.section_error || item.annotation_error || item.summary_error || item.refinement_error)}</div>` : ""}
      `;
    });
  }

  function renderSettingsModel() {
    const settings = state.modelSettings || {};
    const rough = settings.rough_reading || {};
    const intensive = settings.intensive_reading || {};
    const splitChapters = settings.split_chapters || {};
    const memory = settings.memory || {};
    const profileQuestion = settings.profile_question || {};
    const options = Array.isArray(state.modelOptions) ? state.modelOptions : [];
    const optionHtml = ['<option value="">(空) 手动指定后才启用</option>']
      .concat(options.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label || row.id)}</option>`))
      .join("");
    const disabledAttr = state.isAdmin ? "" : "disabled";
    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-title">模型设置</div>
          <div class="settings-sub">默认模型为空时，后端不会强制绑定默认模型。</div>
          <div class="settings-inline-form settings-model-form">
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsDefaultModelSelect">默认模型</label>
              <select id="settingsDefaultModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsRoughModelSelect">精读模型</label>
              <select id="settingsRoughModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsIntensiveModelSelect">IntensiveReadingModel</label>
              <select id="settingsIntensiveModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsSplitChaptersModelSelect">SplitChaptersModel</label>
              <select id="settingsSplitChaptersModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsMemoryModelSelect">MemoryProfileModel</label>
              <select id="settingsMemoryModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsProfileQuestionModelSelect">ProfileQuestionModel</label>
              <select id="settingsProfileQuestionModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
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
    const defaultSelect = document.getElementById("settingsDefaultModelSelect");
    const roughSelect = document.getElementById("settingsRoughModelSelect");
    const intensiveSelect = document.getElementById("settingsIntensiveModelSelect");
    const splitSelect = document.getElementById("settingsSplitChaptersModelSelect");
    const memorySelect = document.getElementById("settingsMemoryModelSelect");
    const profileQuestionSelect = document.getElementById("settingsProfileQuestionModelSelect");
    if (defaultSelect) defaultSelect.value = String(settings.default_nexora_model || "");
    if (roughSelect) roughSelect.value = String(rough.model_name || "");
    if (intensiveSelect) intensiveSelect.value = String(intensive.model_name || "");
    if (splitSelect) splitSelect.value = String(splitChapters.model_name || "");
    if (memorySelect) memorySelect.value = String(memory.model_name || "");
    if (profileQuestionSelect) profileQuestionSelect.value = String(profileQuestion.model_name || "");
  }

  function renderSettingsDetail() {
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
    if (el.courseHomeSubtitle) {
      const row = getSelectedLectureRow();
      const lecture = row ? (row.lecture || {}) : {};
      el.courseHomeSubtitle.textContent = shelfMode ? "Learning" : getLectureTitle(lecture);
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.hidden = !state.isAdmin || shelfMode || teacherEditMode;
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.hidden = !state.isAdmin || shelfMode || teacherEditMode;
    }
    if (el.lectureList && el.lectureList.parentElement) {
      el.lectureList.parentElement.hidden = true;
    }
  }

  function openMaterialsShelf() {
    state.materialsPageMode = "shelf";
    state.materialsDetailMode = "lecture";
    state.catalogContext = null;
    state.selectedBookId = "";
    closeReader();
    syncMaterialsPageMode();
    renderLectureList();
    renderLectureDetail();
  }

  function openLectureHome(lectureId) {
    state.selectedLectureId = String(lectureId || "").trim();
    state.selectedBookId = "";
    state.materialsPageMode = "lecture";
    state.materialsDetailMode = "lecture";
    state.catalogContext = null;
    closeReader();
    syncMaterialsPageMode();
    renderLectureList();
    renderLectureDetail();
  }

  async function handleCourseHomeClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

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

  async function handleCatalogClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
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
      const summaryBriefHtml = (ctx.summaryBrief || "").replace(/\n/g, "<br>");
      const catalogCoverHtml = renderLearningPanelCover(
        String(ctx.coverPath || "").trim(),
        String(ctx.title || "教材目录"),
        "learning-panel-cover-placeholder"
      );

      detailPane.innerHTML = `
        <section class="materials-detail-scroll materials-catalog-page learning-panel-page">
          <div class="learning-panel-hero-block">
            ${catalogCoverHtml}
            <div class="learning-panel-hero-info">
              <div class="learning-panel-hero-title">${escapeHtml(ctx.title || "教材目录")}</div>
              <div class="learning-panel-hero-subtitle">${escapeHtml(ctx.subtitle || "")}</div>
            </div>
          </div>
          <div class="learning-panel-catalog-layout">
            <div class="learning-panel-catalog-left">
              <div class="learning-panel-section-head">
                <div class="detail-title">书籍简介</div>
              </div>
              <div class="learning-panel-section-body">
                ${isLoading ? '<div class="materials-loading">加载中...</div>' : (summaryBrief ? `<div class="learning-panel-intro-content">${summaryBriefHtml}</div>` : '<div class="materials-empty">暂无简介内容</div>')}
              </div>
            </div>
            <div class="learning-panel-catalog-right">
              <div class="learning-panel-section-head">
                <div class="detail-title">目录</div>
              </div>
              <div class="learning-panel-section-body">
                <div class="materials-catalog-list learning-panel-catalog-list">
                ${isLoading ? '<div class="materials-loading">目录加载中...</div>' : (chapters.length ? chapters.map((item, idx) => `
                  <button class="materials-catalog-item" type="button" data-material-catalog-index="${idx}">
                    <span class="materials-catalog-index">${idx + 1}.</span>
                    <span class="materials-catalog-text">${escapeHtml(item.title || `章节 ${idx + 1}`)}</span>
                  </button>
                `).join("") : '<div class="materials-empty">暂无目录</div>')}
                </div>
              </div>
            </div>
          </div>
        </section>
      `;
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
                  <aside class="learning-panel-teacher-card">
                    <div class="detail-description-label learning-panel-copy-label">教师列表</div>
                    <div class="learning-panel-teacher-list">
                      ${lectureTeachers}
                    </div>
                  </aside>
                </div>
                <div class="learning-panel-copy-actions learning-panel-action-row">
                  <button class="${toggleBtnClass}" data-action="toggle-learning" data-lecture-id="${escapeHtml(lectureId)}" aria-label="${toggleBtnTitle}" title="${toggleBtnTitle}">${toggleBtnText}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="detail-section learning-panel-section">
          <div class="learning-panel-split-grid">
            <div class="learning-panel-books-column">
              <div class="learning-panel-section-head">
                <div class="detail-title learning-panel-section-title">教材列表</div>
              </div>
              <div class="learning-panel-section-body">
                <div class="book-list learning-panel-books-grid">
                ${books.length ? books.map((book) => {
              const bookId = String(book.id || "");
              const active = bookId === state.selectedBookId ? "is-active" : "";
              const bookMeta = [
                vectorStatusLabel(book.vector_status, book.vector_provider),
                materialStatusLabel(book.status),
              ].filter(Boolean).join(" · ");
              const bookHint = active ? "当前教材" : "点击进入阅读";
              return `
                  <article class="book-item ${active} learning-panel-book-item" data-book-id="${escapeHtml(bookId)}">
                    <div class="book-item-head learning-panel-book-head">
                      <div class="learning-panel-book-head-main">
                        <div class="book-title learning-panel-book-title">${escapeHtml(book.title || bookId)}</div>
                        <div class="book-meta learning-panel-book-meta">${escapeHtml(bookMeta || bookHint)}</div>
                      </div>
                      <span class="learning-panel-book-state">${escapeHtml(bookHint)}</span>
                    </div>
                  </article>
              `;
            }).join("") : '<div class="materials-empty">暂无教材</div>'}
                </div>
              </div>
            </div>
            <aside class="learning-panel-info-column">
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
                <div class="detail-description-label learning-panel-copy-label">教师信息${state.isAdmin ? ` <button class="learning-panel-inline-edit-btn" type="button" data-action="edit-teacher" title="编辑教师">✎</button>` : ""}</div>
                <div class="learning-panel-teacher-list learning-panel-teacher-list-compact">
                  ${lectureTeachers}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </section>
    `;
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

  async function loadChapterContent(chapterIndex, scrollToOffset) {
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
    renderChapterContent(chapterIndex, content, scrollToOffset);
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

  function renderChapterContent(chapterIndex, content, scrollToOffset) {
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
        currentChapterIndex: 0
      };
    }
    const session = state.readerSessionProgress[key];
    session.completedIndices.add(chapterIndex);
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
        currentChapterIndex: 0
      };
    }
    return state.readerSessionProgress[key];
  }

  function checkSessionProgressByScroll() {
    if (!state.isReaderOpen || !state.readerChapters.length) return;
    const chapterIndex = state.readerActiveChapterIndex;
    const chapters = state.readerChapters;
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    
    const chapterName = String(chapter.title || "").trim();
    const sectionData = state.readerSectionsData[chapterName];
    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions.length) return;
    
    const scrollContainer = getReaderScrollContainer();
    const chapterBody = scrollContainer ? scrollContainer.querySelector(".chapter-body") : null;
    if (!chapterBody) return;
    
    const scrollTop     = Number(scrollContainer.scrollTop || 0);
    const clientHeight  = Number(scrollContainer.clientHeight || 0);
    const scrollHeight  = Number(scrollContainer.scrollHeight || 0);
    const minScrollable = Math.max(1, scrollHeight - clientHeight);   // 至少为1，避免除零
    const atBottom      = scrollTop >= minScrollable - 2;              // 滚到底或内容不超出均视为底
    const chapterLength = Math.max(1, Number(chapter.end || 0) - Number(chapter.start || 0));
    
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
      if (lastCompletedSession && typeof generateSessionQuiz === "function") {
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
  function openReaderChapter(index, scrollToOffset) {
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
      renderChapterContent(idx, state.readerChapterCache[idx], scrollToOffset);
    } else {
      // 按需加载章节内容
      loadChapterContent(idx, scrollToOffset);
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
  }

  function _annotationMarkerLeave(ev) {
    var marker = this;
    var relatedTarget = ev.relatedTarget;
    if (relatedTarget && (marker.contains(relatedTarget) || relatedTarget.closest(".annotation-bubble"))) {
      return;
    }
    _hideAnnotationBubble(marker);
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
      emitTelemetry("reader_open", {
        lecture_id: String(state.selectedLectureId || "").trim(),
        book_id: String(state.selectedBookId || "").trim(),
        view_mode: mode,
        chapter_index: Number(state.readerActiveChapterIndex) || 0,
        chapter_title: String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim(),
      });
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
    activeTab: "quiz",
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
    const btn = document.getElementById("readerFloatingBtn");
    if (!panel) return;
    floatingPanelState.open = false;
    panel.classList.remove("active");
    panel.classList.remove("dragging");
    panel.classList.remove("resizing");
    panel.setAttribute("aria-hidden", "true");
    if (btn && state.isReaderOpen) btn.hidden = false;
  }

  function toggleFloatingPanel() {
    if (floatingPanelState.open) closeFloatingPanel();
    else openFloatingPanel();
  }

  function syncFloatingBtnVisibility() {
    const btn = document.getElementById("readerFloatingBtn");
    if (!btn) return;
    btn.hidden = !state.isReaderOpen || floatingPanelState.open;
  }

  // Quiz state management
  const QUIZ_STATE_KEY = "nxl_quiz_state_v1";
  let quizState = {
    loading: false,
    currentChapter: "",
    currentSession: "",
    questions: [],
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
      }));
    } catch (_) {}
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

    let html = '<div class="quiz-list">';
    quizState.questions.forEach((q, idx) => {
      const difficultyClass = q.difficulty === "简单" ? "easy" : q.difficulty === "中等" ? "medium" : "hard";
      html += `
        <div class="quiz-item" data-index="${idx}">
          <div class="quiz-item-header">
            <span class="quiz-item-index">${idx + 1}</span>
            <span class="quiz-item-difficulty ${difficultyClass}">${escapeHtml(q.difficulty || "")}</span>
          </div>
          <div class="quiz-item-title">${escapeHtml(q.title || q.content || "")}</div>
          <div class="quiz-item-content" hidden>${escapeHtml(q.content || "")}</div>
          <div class="quiz-item-hint" hidden>${escapeHtml(q.hint || "")}</div>
          <div class="quiz-item-answer" hidden>${escapeHtml(q.answer || "")}</div>
          <div class="quiz-item-actions">
            <button class="quiz-show-hint-btn" onclick="showQuizHint(${idx})">提示</button>
            <button class="quiz-show-answer-btn" onclick="showQuizAnswer(${idx})">查看答案</button>
          </div>
        </div>
      `;
    });
    html += "</div>";
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
    const item = document.querySelector(`.quiz-item[data-index="${idx}"]`);
    if (!item) return;
    const answer = item.querySelector(".quiz-item-answer");
    if (answer) {
      answer.hidden = !answer.hidden;
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
      quizState.questions = storedQuizzes[quizKey].questions || [];
      quizState.currentChapter = chapterName;
      quizState.currentSession = sessionName;
      renderQuizPanel();
      return;
    }

    quizState.loading = true;
    quizState.error = null;
    quizState.currentChapter = chapterName;
    quizState.currentSession = sessionName;
    renderQuizPanel();
    openFloatingPanel();
    setFloatingTab("quiz");

    try {
      const result = await fetchJson("/api/frontend/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        // 保存到localStorage
        storedQuizzes[quizKey] = {
          questions: result.questions,
          timestamp: Date.now(),
        };
        localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));
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
    }
  }

  initFloatingPanel();

  function closeReader() {
    resetReaderSelectionTelemetry();
    if (state.isReaderOpen && Array.isArray(state.readerChapters) && state.readerChapters.length) {
      reportReaderChapterComplete(state.readerActiveChapterIndex).catch(() => {});
    }
    clearReaderTelemetrySessionContext("close");
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
    state.readerSectionsData = {};
    state.readerAnnotations = [];
    state.readerChapterCache = {};
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

  async function fetchJson(url, init) {
    const resp = await fetch(resolveApiUrl(url), init);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    return data;
  }

  async function loadSessionUserFallback() {
    try {
      const data = await fetchJson("/api/user/info", { credentials: "include" });
      const user = data && typeof data.user === "object" ? data.user : {};
      if (user && Object.keys(user).length) {
        state.user = { ...state.user, ...user };
        if (!state.username) {
          state.username = String(user.id || user.username || "").trim();
        }
        syncTelemetryUserId();
        state.isAdmin = String(user.role || "").trim().toLowerCase() === "admin";
      }
    } catch (_err) {}
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
    } catch (_err) {
      state.user = {};
      state.integration = {};
      state.isAdmin = false;
    }
    if (!state.user || !state.user.role) await loadSessionUserFallback();
  }

// ─────── Settings Channels ────────────────────────────────────────────
  function renderSettingsChannels() {
    const rows = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels.filter((row) => row && !row.builtin) : [];
    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-title">新建频道</div>
          <div class="settings-sub">使用 <code>@用户名</code> 添加可见用户。输入 <code>@ALL</code> 后将变为全员公开频道。</div>
          <div class="settings-inline-form">
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsChannelTitleInput">频道名</label>
              <input id="settingsChannelTitleInput" class="input-lite settings-model-select" placeholder="例如：春物私有研读">
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsChannelUsersInput">可见用户</label>
              <input id="settingsChannelUsersInput" class="input-lite settings-model-select" placeholder="@mujica,@alice 或 @ALL">
            </div>
            <div class="materials-form-actions materials-form-actions-right">
              <button id="createFeedChannelBtn" class="nxl-icon-btn nxl-icon-btn-dark" type="button" aria-label="新建频道" title="新建频道">+</button>
            </div>
          </div>
        </article>
        <article class="settings-card">
          <div class="settings-title">现有频道</div>
          <div class="settings-log-list">
            ${rows.length ? rows.map((row) => `
              <div class="settings-log-item">
                <div class="settings-log-head">
                  <strong>${escapeHtml(String(row.title || ""))}</strong>
                  <button class="nxl-icon-btn nxl-icon-btn-danger" type="button" data-action="delete-feed-channel" data-channel-id="${escapeHtml(String(row.id || ""))}" title="删除频道" aria-label="删除频道">×</button>
                </div>
                <div class="settings-log-meta">${escapeHtml(String(row.type || ""))}</div>
                <pre class="settings-log-content">${escapeHtml(Array.isArray(row.member_user_ids) && row.member_user_ids.length ? row.member_user_ids.map((userId) => `@${userId}`).join(", ") : "全员可见")}</pre>
              </div>
            `).join("") : '<div class="materials-empty">暂无自定义频道</div>'}
          </div>
        </article>
      </section>
    `;
  }

  async function loadMaterialsRows() {
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
    if (el.settingsView.classList.contains("is-active") && state.settingsTab === "refinement") renderSettingsDetail();
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

  async function reportReaderChapterComplete(index) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) return;
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    const chapter = chapters[idx];
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    const chapterName = String((chapter && chapter.title) || "").trim();
    if (!lectureId || !bookId || !chapterName) return;
    const chapterRange = `${Math.max(0, Number(chapter.start) || 0)}:${Math.max(0, (Number(chapter.end) || 0) - (Number(chapter.start) || 0))}`;
    const reportKey = `${lectureId}::${bookId}::${chapterName}::${chapterRange}`;
    if (state.readerReportedChapterKey === reportKey) return;
    const start = Math.max(0, Math.min(state.readerFullTextRaw.length, Number(chapter.start) || 0));
    const end = Math.max(start, Math.min(state.readerFullTextRaw.length, Number(chapter.end) || 0));
    const chapterContext = String(state.readerFullTextRaw.slice(start, end).trim() || "");
    if (!chapterContext) return;
    emitTelemetry("reader_chapter_complete", {
      lecture_id: lectureId,
      book_id: bookId,
      chapter_index: idx,
      chapter_name: chapterName,
      chapter_range: chapterRange,
    });
    await fetchJson("/api/frontend/learning/chapter-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        chapter_name: chapterName,
        chapter_range: chapterRange,
        chapter_context: chapterContext.slice(0, 12000),
        chapter_detail_xml: String(state.readerBookDetailXml || ""),
      }),
    });
    state.readerReportedChapterKey = reportKey;
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
      const resp = await fetch(resolveApiUrl(`/api/frontend/learning-feeds?${params.toString()}`), { credentials: "same-origin" });
      const data = await resp.json().catch(() => ({}));
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
    const titleInput = document.getElementById("settingsChannelTitleInput");
    const usersInput = document.getElementById("settingsChannelUsersInput");
    const title = String(titleInput && titleInput.value || "").trim();
    const rawUsers = String(usersInput && usersInput.value || "").trim();
    if (!title) throw new Error("频道名不能为空");
    const member_user_ids = rawUsers
      ? rawUsers.split(",").map((item) => String(item || "").trim()).filter(Boolean).map((item) => item.startsWith("@") ? item.slice(1).trim() : item)
      : [];
    await fetchJson("/api/frontend/settings/feed-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, member_user_ids }),
    });
    await loadLearningFeedChannels();
  }

  async function removeLearningFeedChannel(channelId) {
    const id = String(channelId || "").trim();
    if (!id) return;
    await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
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
    const defaultSelect = document.getElementById("settingsDefaultModelSelect");
    const roughSelect = document.getElementById("settingsRoughModelSelect");
    const intensiveSelect = document.getElementById("settingsIntensiveModelSelect");
    const splitSelect = document.getElementById("settingsSplitChaptersModelSelect");
    const memorySelect = document.getElementById("settingsMemoryModelSelect");
    const profileQuestionSelect = document.getElementById("settingsProfileQuestionModelSelect");
    const memoryIntervalInput = document.getElementById("settingsMemoryIntervalInput");
    const payload = {
      default_nexora_model: defaultSelect ? String(defaultSelect.value || "").trim() : "",
      rough_reading: {
        model_name: roughSelect ? String(roughSelect.value || "").trim() : "",
      },
      intensive_reading: {
        model_name: intensiveSelect ? String(intensiveSelect.value || "").trim() : "",
      },
      split_chapters: {
        model_name: splitSelect ? String(splitSelect.value || "").trim() : "",
      },
      memory: {
        model_name: memorySelect ? String(memorySelect.value || "").trim() : "",
        trigger_turn_interval: Math.max(1, Number(memoryIntervalInput ? memoryIntervalInput.value : 10) || 10),
      },
      profile_question: {
        model_name: profileQuestionSelect ? String(profileQuestionSelect.value || "").trim() : "",
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
    await loadMaterialsRows();
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
    }
    renderSettingsView();
  }

  async function refreshAll() {
    await Promise.all([
      loadMaterialsRows(),
      loadDashboardRows(),
      loadLearningFeedChannels(),
      loadLearningFeeds(),
    ]);
    renderUserProfile();
    renderProgressList();
    renderPie();
    renderLearningFeeds();
    syncDashboardSideTabs();
    renderLectureList();
    renderLectureDetail();
    renderUploadLectureInputDefault();
  }

  async function createLecture() {
    const title = String(el.createLectureTitleInput.value || "").trim();
    const category = String(el.createLectureCategoryInput.value || "").trim();
    const status = String(el.createLectureStatusSelect.value || "draft").trim() || "draft";
    const description = String(el.createLectureDescriptionInput.value || "").trim();
    if (!title) throw new Error("请输入课程名");
    const payload = await fetchJson("/api/lectures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, status, description }),
    });
    const lecture = payload.lecture || {};
// ─────── Download & Raw API Actions ───────────────────────────────────
    state.selectedLectureId = String(lecture.id || "");
    el.createLectureTitleInput.value = "";
    el.createLectureCategoryInput.value = "";
    el.createLectureStatusSelect.value = "draft";
    el.createLectureDescriptionInput.value = "";
  }

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

  async function uploadBookByFile() {
    if (!state.isAdmin) throw new Error("当前账号不是管理员");
    const lectureId = String(el.materialsLectureIdHidden.value || "").trim();
    const title = String(el.materialsBookTitleInput.value || "").trim();
    const file = el.materialsFileInput.files ? el.materialsFileInput.files[0] : null;
    if (!lectureId) throw new Error("请选择课程");
    if (!title) throw new Error("请输入教材名");
    if (!file) throw new Error("请选择教材文件");

    const created = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, source_type: "file" }),
    });
    const bookId = String((created.book || {}).id || "");
    if (!bookId) throw new Error("创建教材失败");

    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(bookId)}/file`, {
      method: "POST",
      body: form,
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `HTTP ${resp.status}`);
    }
    state.selectedLectureId = lectureId;
    state.selectedBookId = bookId;
    el.materialsBookTitleInput.value = "";
    el.materialsFileInput.value = "";
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
    if (el.feedChannelSelect) {
      el.feedChannelSelect.addEventListener("change", () => {
        state.selectedFeedChannelId = String(el.feedChannelSelect.value || "public_all");
        loadLearningFeeds().catch((err) => showToast(`加载动态失败：${err.message || "未知错误"}`));
      });
    }
    if (el.learningFeedComposeBtn) {
      el.learningFeedComposeBtn.addEventListener("click", () => {
        enterFeedComposeMode();
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
      openLectureHome(lectureId);
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
        state.materialsDetailMode = "lecture";
        state.catalogContext = null;
        renderLectureDetail();
        return;
      }
      if (state.materialsPageMode === "lecture") {
        openMaterialsShelf();
        return;
      }
      closeReader();
      setView("dashboard");
      await refreshAll();
    });
    if (el.backFromCourseHomeBtn) {
      el.backFromCourseHomeBtn.addEventListener("click", () => {
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
        openMaterialsShelf();
      });
    }
    el.openUploadViewBtn.addEventListener("click", () => {
      closeReader();
      setView("upload");
      setUploadTab("upload");
    });
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
      el.readerChapterListBtn.addEventListener("click", (event) => {
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
          openReaderChapter(chapterIdx, scrollToOffset);
          setChapterListPanelOpen(false);
          state.readerViewMode = "reading";
          syncReaderModeUI();
          setReaderFullscreen(true);
          return;
        }
        
        // 检查是否点击了章节
        const item = target.closest("[data-reader-chapter-index]");
        if (!item) return;
        const idx = Number(item.getAttribute("data-reader-chapter-index") || "0");
        if (idx !== state.readerActiveChapterIndex) {
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch(() => {});
        }
        openReaderChapter(idx);
        setChapterListPanelOpen(false);
        state.readerViewMode = "reading";
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
      if (!state.isReaderFullscreen) return;
      const target = event.target instanceof Element ? event.target : null;
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
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch(() => {});
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

    el.kickerCreateTabBtn.addEventListener("click", () => setUploadTab("create"));
    el.kickerUploadTabBtn.addEventListener("click", () => setUploadTab("upload"));

    el.profileAdminSettingsBtn.addEventListener("click", () => {
      openSettingsView("users").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
    });

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

    if (el.courseHomeContent) {
      el.courseHomeContent.addEventListener("click", handleCourseHomeClick);
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
        const previousText = saveUserIdentityBtn.textContent;
        if (saveUserIdentityBtn instanceof HTMLButtonElement) {
          saveUserIdentityBtn.disabled = true;
          saveUserIdentityBtn.classList.add("is-saving");
          saveUserIdentityBtn.textContent = "…";
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
              saveUserIdentityBtn.textContent = previousText || "✓";
            }
            showToast(`更新用户身份失败：${err.message || "未知错误"}`);
          });
        return;
      }
      const createChannelBtn = target.closest("#createFeedChannelBtn");
      if (createChannelBtn) {
        createLearningFeedChannel()
          .then(() => {
            showToast("频道创建成功");
            renderSettingsView();
          })
          .catch((err) => showToast(`创建频道失败：${err.message || "未知错误"}`));
        return;
      }
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
            renderSettingsView();
          })
          .catch((err) => showToast(`删除频道失败：${err.message || "未知错误"}`));
        return;
      }
      const startBtn = target.closest("[data-action='start-refinement']");
      if (startBtn) {
        const lectureId = String(startBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(startBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startRefinement(lectureId, bookId)
          .then(() => {
            showToast("已提交粗读任务");
            renderSettingsView();
          })
          .catch((err) => showToast("粗读启动失败：" + (err.message || "未知错误")));
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
    });

    el.settingsDetailPane.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
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
// ─────── Admin Utilities ──────────────────────────────────────────────
        loadSettingsLogs().catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
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
      await previewSelectedFile(file);
    });

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
    el.openUploadViewBtn.hidden = !state.isAdmin;
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.hidden = !state.isAdmin || state.materialsPageMode === "shelf";
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.hidden = !state.isAdmin || state.materialsPageMode === "shelf";
    }
  }

  async function init() {
    state.username = getRuntimeUsername();
    syncTelemetryUserId();
    loadReaderSettings();
    setView("dashboard");
    closeReader();
    syncReaderSettingsPanel();
    setUploadTab("create");
    renderUploadPreviewEmpty("请选择教材文件后预览");
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
  });
})();
