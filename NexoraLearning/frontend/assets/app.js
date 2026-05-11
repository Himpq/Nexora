(function () {
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

  const PIE_COLORS = ["#111111", "#373737", "#585858", "#7a7a7a", "#9d9d9d", "#bbbbbb"];
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
  const STATUS_LABELS = {
    draft: "草稿",
    active: "开放学习",
    ready: "已准备",
    archived: "归档",
    paused: "暂停",
  };

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
    modelOptions: [],
    modelSettings: {
      default_nexora_model: "",
      rough_reading: {},
      intensive_reading: {},
      question_generation: {},
      split_chapters: {},
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
    readerViewMode: "closed",
    readerMeta: { title: "", subtitle: "" },
    readerUiToggleLockedUntil: 0,
    readerClosePanelsUntil: 0,
    materialsDetailMode: "lecture",
    catalogContext: null,
    materialsSortBy: "updated_at",
    materialsSortOrder: "desc",
  };
  let readerContextSyncTimer = null;

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

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function decodeBasicHtmlEntities(src) {
    return String(src || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&#(\d+);/g, (_m, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCharCode(code) : "";
      });
  }

  function formatReaderText(text) {
    const raw = String(text || "").replace(/\r\n?/g, "\n");
    const noScripts = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    const structural = noScripts
      .replace(/<\/(p|div|h[1-6]|section|article|blockquote|tr|table)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ");
    const noTags = structural.replace(/<[^>]+>/g, " ");
    const readable = decodeBasicHtmlEntities(noTags)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!readable) {
      return `<p class="materials-preview-paragraph">（暂无文本内容）</p>`;
    }

    return readable
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (!lines.length) return "";
        return `<p class="materials-preview-paragraph">${lines.map(escapeHtml).join("<br>")}</p>`;
      })
      .filter(Boolean)
      .join("");
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function statusText(status) {
    const key = String(status || "").trim().toLowerCase();
    return STATUS_LABELS[key] || key || "未知状态";
  }

  function normalizeStatusKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function vectorStatusLabel(value, provider) {
    const key = normalizeStatusKey(value);
    const providerKey = normalizeStatusKey(provider);
    if (key === "done" && providerKey.includes("placeholder")) return "占位完成(未入库)";
    if (["done", "success", "indexed", "ready"].includes(key)) return "已向量化";
    if (["running", "processing", "pending", "queued"].includes(key)) return "向量化中";
    if (["failed", "error"].includes(key)) return "向量化失败";
    return key || "未开始";
  }

  function materialStatusLabel(value) {
    const key = normalizeStatusKey(value);
    if (["active", "ready", "published"].includes(key)) return "可用";
    if (["draft", "new"].includes(key)) return "草稿";
    if (["archived"].includes(key)) return "归档";
    return key || "未知";
  }

  function statusBadgeClass(value, provider) {
    const key = normalizeStatusKey(value);
    const providerKey = normalizeStatusKey(provider);
    if (key === "done" && providerKey.includes("placeholder")) return "is-placeholder";
    if (["done", "success", "indexed", "ready", "active", "published"].includes(key)) return "is-ready";
    if (["running", "processing", "pending", "queued"].includes(key)) return "is-processing";
    if (["failed", "error"].includes(key)) return "is-error";
    return "is-idle";
  }

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

  function normalizeReaderSelectionText(raw, maxLen = 1600) {
    return String(raw || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, Math.max(0, Number(maxLen) || 0));
  }

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

  function getLectureTitle(lecture) {
    if (!lecture || typeof lecture !== "object") return "未命名课程";
    return String(lecture.title || lecture.name || lecture.id || "未命名课程");
  }

  function getCourseProgress(lecture, books) {
    const list = Array.isArray(books) ? books : [];
    const direct = toNumber((lecture && (lecture.progress ?? lecture.study_progress ?? lecture.learning_progress)) ?? NaN, NaN);
    const currentChapter = String((lecture && lecture.current_chapter) || "").trim();
    const nextChapter = String((lecture && lecture.next_chapter) || "").trim();
    if (!list.length && !currentChapter && !nextChapter) return 0;
    if (Number.isFinite(direct)) {
      if (direct >= 100 && !currentChapter && !nextChapter) {
        const hasReadyBook = list.some((book) => ["done", "success", "indexed", "ready"].includes(normalizeStatusKey(book && book.vector_status)));
        if (!hasReadyBook) return 0;
      }
      return clamp(Math.round(direct), 0, 100);
    }
    if (!list.length) return 0;
    let ready = 0;
    list.forEach((book) => {
      const status = String((book && book.vector_status) || "").trim().toLowerCase();
      if (["done", "success", "indexed", "ready"].includes(status)) ready += 1;
    });
    return clamp(Math.round((ready / list.length) * 100), 0, 100);
  }

  function getStudyHours(lecture) {
    const hours = toNumber(lecture && lecture.study_hours, NaN);
    if (Number.isFinite(hours) && hours > 0) return hours;
    return 0;
  }

  function getChapterInfo(lecture, books) {
    const lectureCurrent = String((lecture && lecture.current_chapter) || "").trim();
    const lectureNext = String((lecture && lecture.next_chapter) || "").trim();
    if (lectureCurrent || lectureNext) {
      return { current: lectureCurrent || "待开始", next: lectureNext || "待规划" };
    }
    const list = Array.isArray(books) ? books : [];
    const first = list.find((book) => String(book.current_chapter || "").trim() || String(book.next_chapter || "").trim());
    if (first) {
      return {
        current: String(first.current_chapter || "").trim() || "待开始",
        next: String(first.next_chapter || "").trim() || "待规划",
      };
    }
    return { current: "待开始", next: "待规划" };
  }

  function buildDashboardCourses(rows) {
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
      const lecture = row && typeof row === "object" ? (row.lecture || {}) : {};
      const books = Array.isArray(row && row.books) ? row.books : [];
      const chapter = getChapterInfo(lecture, books);
      return {
        id: String(lecture.id || `lecture-${index + 1}`),
        title: getLectureTitle(lecture),
        progress: getCourseProgress(lecture, books),
        studyHours: getStudyHours(lecture),
        chapterCurrent: chapter.current,
        chapterNext: chapter.next,
        color: PIE_COLORS[index % PIE_COLORS.length],
      };
    });
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

  function polarToCartesian(cx, cy, radius, angleDeg) {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
  }

  function donutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
      "Z",
    ].join(" ");
  }

  
  function renderPie() {
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

  function renderUserProfile() {
    const username = String(state.user.username || state.username || "访客");
    const role = state.isAdmin ? "管理员" : "成员";
    const avatar = (Array.from(username.trim())[0] || "N").toUpperCase();
    const booksCount = state.allLectureRows.reduce((sum, row) => sum + toNumber(row && row.books_count, 0), 0);
    const connected = !!(state.integration && state.integration.connected);
    const modelsCount = toNumber(state.integration && state.integration.models_count, 0);
    const totalHours = toNumber(state.totalStudyHours, 0);

    el.userProfileCard.innerHTML = `
      <div class="user-profile-avatar">${escapeHtml(avatar)}</div>
      <div class="user-profile-meta">
        <div class="user-profile-name">${escapeHtml(username)}</div>
        <div class="user-profile-line">角色：${escapeHtml(role)} · 全部课程：${state.allLectureRows.length} · 教材：${booksCount}</div>
        <div class="user-profile-line">学习时长：${totalHours > 0 ? `${totalHours.toFixed(1)}h` : "0h"} · 模型：${connected ? `已连接(${modelsCount})` : "未连接"}</div>
      </div>
    `;
  }

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
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const question = normalizeStatusKey(item && item.question_status);
    const job = normalizeStatusKey(item && item.job_status);
    if (!["done", "completed", "success"].includes(intensive)) return false;
    if (["running", "queued"].includes(job)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(question)) return false;
    return true;
  }

  function canStartSection(item) {
    const question = normalizeStatusKey(item && item.question_status);
    const section = normalizeStatusKey(item && item.section_status);
    const job = normalizeStatusKey(item && item.job_status);
    const sectionJob = normalizeStatusKey(item && item.section_job_status);
    if (!["done", "completed", "success"].includes(question)) return false;
    if (["running", "queued"].includes(job) || ["running", "queued"].includes(sectionJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(section)) return false;
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
    const questionStatus = normalizeStatusKey(item && item.question_status);
    const hasError = isErrorStatus(coarseStatus)
      || isErrorStatus(intensiveStatus)
      || isErrorStatus(questionStatus);
    const steps = [
      { key: "coarse", label: "粗读", done: isDoneStatus(coarseStatus), running: isRunningStatus(coarseStatus) },
      { key: "intensive", label: "精读", done: isDoneStatus(intensiveStatus), running: isRunningStatus(intensiveStatus) },
      { key: "question", label: "出题", done: isDoneStatus(questionStatus), running: isRunningStatus(questionStatus) },
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
    const questionDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.question_status));
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
    if (!questionDone) {
      return {
        action: "start-question",
        title: "开始出题",
        text: "?",
        enabled: canStartQuestion(item),
      };
    }
    const sectionDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.section_status));
    if (!sectionDone) {
      return {
        action: "start-section",
        title: "开始分节",
        text: "§",
        enabled: canStartSection(item),
      };
    }
    return {
      action: "start-section",
      title: "分节已完成",
      text: "✓",
      enabled: false,
    };
  }

  function formatTs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "—";
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  }

  function renderSettingsNav() {
    const tabs = [
      { id: "refinement", title: "待精读列表", sub: "选择教材并触发精读" },
      { id: "model", title: "模型设置", sub: "设置默认模型与精读模型" },
      { id: "profile", title: "用户信息", sub: "当前用户与连接状态" },
    ];
    el.settingsNavList.innerHTML = tabs.map((tab) => `
      <button class="settings-nav-item ${state.settingsTab === tab.id ? "is-active" : ""}" data-settings-tab="${tab.id}" type="button">
        <div class="settings-nav-title">${escapeHtml(tab.title)}</div>
        <div class="settings-nav-sub">${escapeHtml(tab.sub)}</div>
      </button>
    `).join("");
  }

  function renderSettingsProfile() {
    const username = String(state.user.username || state.username || "访客");
    const role = state.isAdmin ? "管理员" : "成员";
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
    const question = settings.question_generation || {};
    const splitChapters = settings.split_chapters || {};
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
              <label class="materials-form-label settings-model-label" for="settingsQuestionModelSelect">QuestionGenerationModel</label>
              <select id="settingsQuestionModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
            </div>
            <div class="materials-form-row settings-model-row">
              <label class="materials-form-label settings-model-label" for="settingsSplitChaptersModelSelect">SplitChaptersModel</label>
              <select id="settingsSplitChaptersModelSelect" class="input-lite settings-model-select" ${disabledAttr}>${optionHtml}</select>
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
    const questionSelect = document.getElementById("settingsQuestionModelSelect");
    const splitSelect = document.getElementById("settingsSplitChaptersModelSelect");
    if (defaultSelect) defaultSelect.value = String(settings.default_nexora_model || "");
    if (roughSelect) roughSelect.value = String(rough.model_name || "");
    if (intensiveSelect) intensiveSelect.value = String(intensive.model_name || "");
    if (questionSelect) questionSelect.value = String(question.model_name || "");
    if (splitSelect) splitSelect.value = String(splitChapters.model_name || "");
  }

  function renderSettingsDetail() {
    if (state.settingsTab === "model") {
      state.refinementViewBootstrapped = false;
      renderSettingsModel();
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
                    <span class="book-badge ${statusBadgeClass(book.question_status)}">出题：${escapeHtml(normalizeStatusKey(book.question_status) || "idle")}</span>
                    <span class="book-badge ${statusBadgeClass(book.section_status)}">分节：${escapeHtml(normalizeStatusKey(book.section_status) || "idle")}</span>
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
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

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

  function renderChapterList() {
    if (!el.chapterListContent) return;
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) {
      el.chapterListContent.innerHTML = '<div class="materials-empty">暂无目录</div>';
      return;
    }
    el.chapterListContent.innerHTML = chapters.map((item, idx) => {
      const active = idx === state.readerActiveChapterIndex ? "current" : "";
      return `<div class="chapter-item ${active}" data-reader-chapter-index="${idx}" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>`;
    }).join("");
  }

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
    emitHostPayload("nexora:reader:selection-context-menu", {
      x: hostPoint.x,
      y: hostPoint.y,
      text,
      source_meta: buildReaderSelectionSourceMeta(text),
    });
  }

  function openReaderChapter(index) {
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
    renderChapterList();
    syncReaderSettingsPanel();
    applyReaderTypography();
    scheduleHostReaderContextSync(0);
  }

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

  function openReader(title, subtitle, content, options) {
    const opts = (options && typeof options === "object") ? options : {};
    const mode = opts.mode === "catalog" ? "catalog" : "reading";
    state.isReaderOpen = true;
    state.readerRequestToken += 1;
    setReaderFullscreen(false);
    setReaderHeaderVisible(true);
    setReaderSettingsPanelOpen(false);
    setChapterListPanelOpen(false);
    el.materialsLayout.hidden = true;
    el.readerPane.hidden = false;
    state.readerViewMode = mode;
    state.readerMeta.title = String(title || "教材阅读");
    state.readerMeta.subtitle = String(subtitle || "");
    el.readerTitle.textContent = state.readerMeta.title;
    el.readerSubTitle.textContent = state.readerMeta.subtitle;
    state.readerFullTextRaw = String(content || "");
    if (Array.isArray(state.readerChapters) && state.readerChapters.length) {
      const requestedIndex = Number.isFinite(Number(opts.chapterIndex)) ? Number(opts.chapterIndex) : state.readerActiveChapterIndex;
      state.readerActiveChapterIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number(requestedIndex) || 0));
    } else {
      state.readerActiveChapterIndex = 0;
    }
    syncReaderModeUI();
    openReaderChapter(state.readerActiveChapterIndex);
    setReaderFullscreen(true);
    syncReaderSettingsPanel();
    applyReaderTypography();
    notifyHostReaderState(true);
    notifyHostReaderContext();
  }

  function closeReader() {
    state.isReaderOpen = false;
    state.readerRequestToken += 1;
    setReaderFullscreen(false);
    setReaderSettingsPanelOpen(false);
    setChapterListPanelOpen(false);
    document.body.classList.remove("reader-settings-open");
    state.readerChapters = [];
    state.readerActiveChapterIndex = 0;
    state.readerFullTextRaw = "";
    state.readerViewMode = "closed";
    state.readerMeta = { title: "", subtitle: "" };
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
    const resp = await fetch(url, init);
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
      const role = String(state.user.role || "").trim().toLowerCase();
      state.isAdmin = !!data.is_admin || role === "admin";
    } catch (_err) {
      state.user = {};
      state.integration = {};
      state.isAdmin = false;
    }
    if (!state.isAdmin || !state.user.role) await loadSessionUserFallback();
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
        question_generation: {},
        split_chapters: {},
      };
    if (el.settingsView.classList.contains("is-active") && state.settingsTab === "model") {
      renderSettingsDetail();
    }
  }

  async function saveModelSettings() {
    if (!state.isAdmin) throw new Error("仅管理员可修改模型设置");
    const defaultSelect = document.getElementById("settingsDefaultModelSelect");
    const roughSelect = document.getElementById("settingsRoughModelSelect");
    const intensiveSelect = document.getElementById("settingsIntensiveModelSelect");
    const questionSelect = document.getElementById("settingsQuestionModelSelect");
    const splitSelect = document.getElementById("settingsSplitChaptersModelSelect");
    const payload = {
      default_nexora_model: defaultSelect ? String(defaultSelect.value || "").trim() : "",
      rough_reading: {
        model_name: roughSelect ? String(roughSelect.value || "").trim() : "",
      },
      intensive_reading: {
        model_name: intensiveSelect ? String(intensiveSelect.value || "").trim() : "",
      },
      question_generation: {
        model_name: questionSelect ? String(questionSelect.value || "").trim() : "",
      },
      split_chapters: {
        model_name: splitSelect ? String(splitSelect.value || "").trim() : "",
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

  async function startQuestion(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/question", {
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
    } else if (state.settingsTab === "refinement") {
      await loadRefinementSettings();
    }
    renderSettingsView();
  }

  async function refreshAll() {
    await loadMaterialsRows();
    await loadDashboardRows();
    renderUserProfile();
    renderProgressList();
    renderPie();
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

  function bindEvents() {
    el.openMaterialsViewBtn.addEventListener("click", () => {
      setView("materials");
      renderLectureList();
      closeReader();
      renderLectureDetail();
    });

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

    el.backToDashboardBtn.addEventListener("click", () => {
      if (state.materialsDetailMode === "catalog") {
        state.materialsDetailMode = "lecture";
        state.catalogContext = null;
        renderLectureDetail();
        return;
      }
      closeReader();
      setView("dashboard");
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
        const item = target.closest("[data-reader-chapter-index]");
        if (!item) return;
        const idx = Number(item.getAttribute("data-reader-chapter-index") || "0");
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
      const navBtn = target ? target.closest("[data-reader-nav]") : null;
      if (navBtn) {
        event.preventDefault();
        event.stopPropagation();
        const dir = String(navBtn.getAttribute("data-reader-nav") || "");
        const nextIndex = dir === "prev"
          ? state.readerActiveChapterIndex - 1
          : state.readerActiveChapterIndex + 1;
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
    el.readerContent.addEventListener("pointerdown", () => {
      hideHostReaderSelectionContextMenu();
    }, { capture: true });
    el.readerContent.addEventListener("scroll", () => {
      if (!state.isReaderOpen) return;
      hideHostReaderSelectionContextMenu();
      scheduleHostReaderContextSync(120);
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
      openSettingsView("model").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
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
      if (requestToken !== state.readerRequestToken) {
        return;
      }
      const chapters = parseBookInfoChapters(bookInfoXml, String(fullText || "").length);
      state.catalogContext = {
        title: String(book.title || "教材目录"),
        subtitle: `${getLectureTitle(lecture)} · ${vectorStatusLabel(book.vector_status, book.vector_provider)} / ${materialStatusLabel(book.status)}`,
        chapters,
        fullTextRaw: String(fullText || "（当前教材暂无可读取文本，可能仍在解析或向量化）"),
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
      const questionBtn = target.closest("[data-action='start-question']");
      if (questionBtn) {
        const lectureId = String(questionBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(questionBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startQuestion(lectureId, bookId)
          .then(() => {
            showToast("已开始生成题目");
          })
          .catch((err) => showToast("出题执行失败：" + (err.message || "未知错误")));
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

  function updateAdminVisibility() {
    el.profileAdminSettingsBtn.hidden = !state.isAdmin;
    el.openUploadViewBtn.hidden = !state.isAdmin;
  }

  async function init() {
    state.username = getRuntimeUsername();
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

