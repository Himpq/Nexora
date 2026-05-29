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
    materialsLayout: document.getElementById("materialsLayout"),
    lectureList: document.getElementById("lectureList"),
    lectureDetailPane: document.getElementById("lectureDetailPane"),
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
    materialsDetailMode: "lecture",
    catalogContext: null,
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

  function renderTeacherPanel() {
    el.timePieChart.innerHTML = `
      <div class="teacher-panel-shell">
        <div class="teacher-panel-hero">
          <div class="teacher-panel-subtitle">内容占位</div>
        </div>
      </div>
    `;
  }

  function renderPie() {
    if (el.timePieChart) el.timePieChart.hidden = false;
    const teacherMode = isTeacherPanelMode();
    if (el.dashboardSidePanelTitle) {
      el.dashboardSidePanelTitle.textContent = teacherMode ? "教师Panel" : "学习时长数据";
    }
    if (el.timePieChart) {
      el.timePieChart.setAttribute("aria-label", teacherMode ? "教师工作台" : "学习时间占比");
    }
    if (teacherMode) {
      renderTeacherPanel();
      return;
    }
    const courses = buildDashboardCourses(state.dashboardRows).slice(0, 6);
    const totalByRows = courses.reduce((sum, item) => sum + toNumber(item.studyHours, 0), 0);
    const total = toNumber(state.totalStudyHours, 0) > 0 ? toNumber(state.totalStudyHours, 0) : totalByRows;
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
        path: donutPath(cx, cy, outer, inner, startAngle, endAngle),
        line: `${anchor.x},${anchor.y} ${bend.x},${bend.y} ${labelX},${bend.y}`,
        labelX,
        labelY: bend.y - 6,
        subY: bend.y + 12,
        ratio,
        textAnchor,
      };
    });

    el.timePieChart.innerHTML = `
      <svg class="nxl-pie-svg" viewBox="0 0 380 300" role="img" aria-label="学习时间占比">
        ${segments.map((seg) => `<g class="nxl-pie-segment"><path d="${seg.path}" fill="${seg.color}"></path></g>`).join("")}
        <circle cx="${cx}" cy="${cy}" r="${inner - 1}" fill="#ffffff"></circle>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" style="font-size:10px;fill:#666;">总学习时长</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" style="font-size:24px;font-weight:700;fill:#111;">${escapeHtml(total.toFixed(1))}h</text>
        ${segments.map((seg) => `
          <g>
            <polyline points="${seg.line}" stroke="#c6c6c6" stroke-width="1.5" fill="none"></polyline>
            <text x="${seg.labelX}" y="${seg.labelY}" text-anchor="${seg.textAnchor}" style="font-size:12px;fill:#3a3a3a;">${escapeHtml(seg.title)}</text>
            <text x="${seg.labelX}" y="${seg.subY}" text-anchor="${seg.textAnchor}" style="font-size:10px;fill:#777;">${escapeHtml(`${seg.ratio}% · 进度 ${seg.progress}%`)}</text>
          </g>
        `).join("")}
      </svg>
    `;
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
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const section = normalizeStatusKey(item && item.section_status);
    const job = normalizeStatusKey(item && item.job_status);
    const sectionJob = normalizeStatusKey(item && item.section_job_status);
    const coarseReady = ["done", "completed", "success"].includes(coarse);
    const intensiveReady = ["done", "completed", "success"].includes(intensive);
    if (!coarseReady && !intensiveReady) return false;
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
    const hasError = isErrorStatus(coarseStatus)
      || isErrorStatus(intensiveStatus)
      || isErrorStatus(sectionStatus)
      || isErrorStatus(annotationStatus);
    const steps = [
      { key: "coarse", label: "粗读", done: isDoneStatus(coarseStatus), running: isRunningStatus(coarseStatus) },
      { key: "intensive", label: "精读", done: isDoneStatus(intensiveStatus), running: isRunningStatus(intensiveStatus) },
      { key: "section", label: "分节", done: isDoneStatus(sectionStatus), running: isRunningStatus(sectionStatus) },
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
        text: "●",
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
    if (select instanceof HTMLSelectElement) {
      select.value = identity;
      select.dataset.currentIdentity = identity;
    }
    const pill = card.querySelector(".settings-user-pill-identity");
    if (pill) pill.textContent = identityLabel;
    const saveBtn = card.querySelector("[data-action='save-user-identity']");
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.classList.remove("is-saving");
      saveBtn.disabled = !!saveBtn.dataset.locked;
      saveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
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
              <select id="${escapeHtml(identitySelectId)}" class="input-lite settings-user-select" data-user-identity-select="${escapeHtml(userId)}" data-current-identity="${escapeHtml(identity)}" ${isLocked ? "disabled" : ""}>
                <option value="student" ${identity === "student" ? "selected" : ""}>学生</option>
                <option value="teacher" ${identity === "teacher" ? "selected" : ""}>教师</option>
              </select>
              <button class="nxl-icon-btn settings-user-save-btn" type="button" data-action="save-user-identity" data-user-id="${escapeHtml(userId)}" ${isLocked ? "disabled data-locked=\"1\" title=\"不可修改其他管理员身份\"" : "title=\"保存身份\""} aria-label="保存身份"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg></button>
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
        ${item.question_error || item.intensive_error || item.coarse_error || item.section_error || item.refinement_error ? `<div class="refine-item-meta" style="color:#b91c1c;">错误：${escapeHtml(item.question_error || item.intensive_error || item.coarse_error || item.section_error || item.refinement_error)}</div>` : ""}
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

  function renderLectureDetail() {
    if (state.materialsDetailMode === "catalog" && state.catalogContext) {
      const ctx = state.catalogContext;
      const chapters = Array.isArray(ctx.chapters) ? ctx.chapters : [];
      const isLoading = !!ctx.loading;
      el.lectureDetailPane.innerHTML = `
        <section class="materials-detail-scroll materials-catalog-page">
          <section class="detail-section">
            <div class="detail-title">${escapeHtml(ctx.title || "教材目录")}</div>
            <p class="detail-line">${escapeHtml(ctx.subtitle || "")}</p>
          </section>
          <section class="detail-section">
            <div class="detail-title">目录</div>
            <div class="materials-catalog-list">
              ${isLoading ? '<div class="materials-loading">目录加载中...</div>' : (chapters.length ? chapters.map((item, idx) => `
                <button class="materials-catalog-item" type="button" data-material-catalog-index="${idx}">
                  <span class="materials-catalog-index">${idx + 1}.</span>
                  <span class="materials-catalog-text">${escapeHtml(item.title || `章节 ${idx + 1}`)}</span>
                </button>
              `).join("") : '<div class="materials-empty">暂无目录</div>')}
            </div>
          </section>
        </section>
      `;
      return;
    }
    const row = getSelectedLectureRow();
    if (!row) {
      el.lectureDetailPane.innerHTML = '<div class="materials-empty">请选择课程</div>';
      return;
    }
    const lecture = row.lecture || {};
    const lectureId = String(lecture.id || "");
    const isLearning = state.selectedLearningLectureIds.includes(lectureId);
    const books = Array.isArray(row.books) ? row.books : [];
    const chapter = getChapterInfo(lecture, books);
    if (!state.selectedBookId && books.length) {
      state.selectedBookId = String(books[0].id || "");
    }
    const toggleBtnClass = isLearning ? "nxl-icon-btn nxl-icon-btn-danger" : "nxl-icon-btn nxl-icon-btn-dark";
    const toggleBtnTitle = isLearning ? "退出学习" : "加入学习";
    const toggleBtnText = isLearning ? "−" : "+";
    const learningPillClass = isLearning ? "learning-state-pill is-on" : "learning-state-pill is-off";
    const learningPillText = isLearning ? "学习中" : "未加入";

    el.lectureDetailPane.innerHTML = `
      <section class="materials-detail-scroll">
        <section class="detail-section">
          <div class="detail-header">
            <div class="detail-title">${escapeHtml(getLectureTitle(lecture))}</div>
            <div class="learning-action-group">
              <span class="${learningPillClass}">${learningPillText}</span>
              <button class="${toggleBtnClass}" data-action="toggle-learning" data-lecture-id="${escapeHtml(lectureId)}" aria-label="${toggleBtnTitle}" title="${toggleBtnTitle}">${toggleBtnText}</button>
            </div>
          </div>
          <div class="detail-kv-list">
            <div class="detail-kv-row"><div class="detail-kv-label">分类</div><div class="detail-kv-value">${escapeHtml(String(lecture.category || "暂无分类"))}</div></div>
            <div class="detail-kv-row"><div class="detail-kv-label">状态</div><div class="detail-kv-value">${escapeHtml(statusText(lecture.status))}</div></div>
            <div class="detail-kv-row"><div class="detail-kv-label">当前章节</div><div class="detail-kv-value">${escapeHtml(chapter.current)}</div></div>
            <div class="detail-kv-row"><div class="detail-kv-label">下一章节</div><div class="detail-kv-value">${escapeHtml(chapter.next)}</div></div>
            <div class="detail-kv-row"><div class="detail-kv-label">教材数量</div><div class="detail-kv-value">${books.length}</div></div>
            <div class="detail-kv-row"><div class="detail-kv-label">课程进度</div><div class="detail-kv-value">${getCourseProgress(lecture, books)}%</div></div>
          </div>
          <div class="detail-description">
            <div class="detail-description-label">课程描述</div>
            <div class="detail-description-text">${escapeHtml(String(lecture.description || "暂无描述"))}</div>
          </div>
        </section>
        <section class="detail-section">
          <div class="detail-title">教材列表</div>
          <div class="book-list">
            ${books.length ? books.map((book) => {
              const bookId = String(book.id || "");
              const active = bookId === state.selectedBookId ? "is-active" : "";
              return `
                <article class="book-item ${active}" data-book-id="${escapeHtml(bookId)}">
                  <div class="book-title">${escapeHtml(book.title || bookId)}</div>
                  <div class="book-badges">
                    <span class="book-badge ${statusBadgeClass(book.vector_status, book.vector_provider)}">向量：${escapeHtml(vectorStatusLabel(book.vector_status, book.vector_provider))}</span>
                    <span class="book-badge ${statusBadgeClass(book.status)}">教材：${escapeHtml(materialStatusLabel(book.status))}</span>
                    <span class="book-badge ${statusBadgeClass(book.section_status)}">分节：${escapeHtml(normalizeStatusKey(book.section_status) || "idle")}</span>
                    <span class="book-badge ${statusBadgeClass(book.annotation_status)}">批注：${escapeHtml(normalizeStatusKey(book.annotation_status) || "idle")}</span>
                  </div>
                </article>
              `;
            }).join("") : '<div class="materials-empty">暂无教材</div>'}
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
      }
    });
    
    if (changed) {
      saveSessionProgress();
      renderChapterList();
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
    const chapter = chapters[idx];
    const start = Math.max(0, Math.min(state.readerFullTextRaw.length, chapter.start));
    const end = Math.max(start, Math.min(state.readerFullTextRaw.length, chapter.end));
    const part = state.readerFullTextRaw.slice(start, end).trim() || state.readerFullTextRaw;
    const prevDisabled = idx <= 0 ? "disabled" : "";
    const nextDisabled = idx >= chapters.length - 1 ? "disabled" : "";
    el.readerContent.innerHTML = `
      <div class="materials-preview-text">
        <div class="chapter-header text-center mb-4">
          <h2>${escapeHtml(chapter.title || `第 ${idx + 1} 章`)}</h2>
        </div>
        <div class="chapter-body">${formatReaderText(part || "")}</div>
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
    // 渲染批注
    renderChapterAnnotations(idx);
    // 滚动到指定偏移量（如果有）
    if (scrollToOffset !== undefined && scrollToOffset !== null) {
      scrollToChapterOffset(start, scrollToOffset);
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
    if (el.materialsMainHeader) el.materialsMainHeader.hidden = state.isReaderOpen;
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
    el.readerPane.hidden = false;
    state.readerViewMode = mode;
    state.readerMeta.title = String(title || "教材阅读");
    state.readerMeta.subtitle = String(subtitle || "");
    state.readerReportedChapterKey = "";
    el.readerTitle.textContent = state.readerMeta.title;
    el.readerSubTitle.textContent = state.readerMeta.subtitle;
    state.readerFullTextRaw = String(content || "");
    resetReaderSelectionTelemetry();
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
    openReaderChapter(state.readerActiveChapterIndex);
    setReaderFullscreen(true);
    syncReaderSettingsPanel();
    applyReaderTypography();
    emitTelemetry("reader_open", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      view_mode: mode,
      chapter_index: Number(state.readerActiveChapterIndex) || 0,
      chapter_title: String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim(),
    });
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

  function closeReader() {
    resetReaderSelectionTelemetry();
    if (state.isReaderOpen && Array.isArray(state.readerChapters) && state.readerChapters.length) {
      reportReaderChapterComplete(state.readerActiveChapterIndex).catch(() => {});
    }
    clearReaderTelemetrySessionContext("close");
    emitTelemetry("reader_close", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: Number(state.readerActiveChapterIndex) || 0,
      chapter_title: String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim(),
    });
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
    syncReaderModeUI();
    el.readerPane.hidden = true;
    el.materialsLayout.hidden = false;
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
    const options = init ? { ...init } : {};
    const headers = new Headers(options.headers || {});
    const body = options.body;
    if (body != null && !headers.has("Content-Type")) {
      if (!(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams)) {
        headers.set("Content-Type", "application/json");
      }
    }
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    options.headers = headers;
    const resp = await fetch(resolveApiUrl(url), options);
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
    await loadMaterialsRows();
    await loadDashboardRows();
    await loadLearningFeedChannels();
    await loadLearningFeeds();
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
      renderLectureList();
      closeReader();
      renderLectureDetail();
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
      state.selectedLectureId = lectureId;
      state.selectedBookId = "";
      closeReader();
      setView("materials");
      renderLectureList();
      renderLectureDetail();
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
      closeReader();
      setView("dashboard");
      await refreshAll();
    });
    el.openUploadViewBtn.addEventListener("click", () => {
      closeReader();
      setView("upload");
      setUploadTab("upload");
    });
    el.backToMaterialsBtn.addEventListener("click", () => {
      closeReader();
      setView("materials");
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
      state.selectedLectureId = String(item.getAttribute("data-lecture-id") || "");
      state.selectedBookId = "";
      state.materialsDetailMode = "lecture";
      state.catalogContext = null;
      closeReader();
      renderLectureList();
      renderLectureDetail();
    });

    el.lectureDetailPane.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

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
        subtitle: `${getLectureTitle(lecture)} · ${vectorStatusLabel(book.vector_status, book.vector_provider)} / ${materialStatusLabel(book.status)}`,
        chapters: [],
        fullTextRaw: "",
        loading: true,
      };
      renderLectureDetail();
      const fullText = await fetchBookTextFull();
      const bookInfoXml = await fetchBookInfoXml();
      const bookDetailXml = await fetchBookDetailXml();
      if (requestToken !== state.readerRequestToken) {
        return;
      }
      const chapters = parseBookInfoChapters(bookInfoXml, String(fullText || "").length);
      state.catalogContext = {
        title: String(book.title || "教材目录"),
        subtitle: `${getLectureTitle(lecture)} · ${vectorStatusLabel(book.vector_status, book.vector_provider)} / ${materialStatusLabel(book.status)}`,
        chapters,
        fullTextRaw: String(fullText || "（当前教材暂无可读取文本，可能仍在解析或向量化）"),
        detailXml: String(bookDetailXml || ""),
        loading: false,
      };
      state.materialsDetailMode = "catalog";
      renderLectureDetail();
    });

    el.lectureDetailPane.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-material-catalog-index]");
      if (!item || !state.catalogContext) return;
      const idx = Number(item.getAttribute("data-material-catalog-index") || "0");
      state.readerChapters = Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters.slice() : [];
      state.readerFullTextRaw = String(state.catalogContext.fullTextRaw || "");
      state.readerBookDetailXml = String(state.catalogContext.detailXml || "");
      state.readerActiveChapterIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number.isFinite(idx) ? idx : 0));
      openReader(
        state.catalogContext.title || "教材阅读",
        state.catalogContext.subtitle || "",
        state.readerFullTextRaw,
        { chapterIndex: state.readerActiveChapterIndex }
      );
    });

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
        // 在点击瞬间同步当前选中值到 dataset，确保后续读取时不会因异步事件错位而回退
        if (select instanceof HTMLSelectElement) {
          const localIdentity = String(select.value || "").trim().toLowerCase();
          if (localIdentity === "student" || localIdentity === "teacher") {
            select.dataset.currentIdentity = localIdentity;
          }
        }
        let identity = select instanceof HTMLSelectElement
          ? String(select.dataset.currentIdentity || select.value || "").trim().toLowerCase()
          : "";
        if (identity !== "student" && identity !== "teacher") identity = "student";
        const previousinnerHTML = saveUserIdentityBtn.innerHTML;
        if (saveUserIdentityBtn instanceof HTMLButtonElement) {
          saveUserIdentityBtn.disabled = true;
          saveUserIdentityBtn.classList.add("is-saving");
          saveUserIdentityBtn.innerHTML = ""; /* CSS border spinner via ::before/::after */
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
              saveUserIdentityBtn.innerHTML = previousinnerHTML;
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
    });

    el.settingsDetailPane.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.matches("[data-user-identity-select]")) {
        target.dataset.currentIdentity = String(target.value || "").trim().toLowerCase();
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
