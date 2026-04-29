(function () {
  "use strict";

  const el = {
    dashboardView: document.getElementById("dashboardView"),
    materialsView: document.getElementById("materialsView"),
    uploadView: document.getElementById("uploadView"),
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
    backFromReaderBtn: document.getElementById("backFromReaderBtn"),
    readerTitle: document.getElementById("readerTitle"),
    readerSubTitle: document.getElementById("readerSubTitle"),
    readerContent: document.getElementById("readerContent"),
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
  };

  const PIE_COLORS = ["#111111", "#373737", "#585858", "#7a7a7a", "#9d9d9d", "#bbbbbb"];
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
    readerRequestToken: 0,
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    const payload = {
      source: "nexora-learning",
      type: "nexora:chat-input:visibility",
      hidden: !!hidden,
    };
    try {
      window.dispatchEvent(new CustomEvent("nexora:chat-input:visibility", { detail: payload }));
    } catch (_err) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (_err) {}
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

  function setView(name) {
    el.dashboardView.classList.toggle("is-active", name === "dashboard");
    el.materialsView.classList.toggle("is-active", name === "materials");
    el.uploadView.classList.toggle("is-active", name === "upload");
    notifyHostInputVisibility(true);
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
      el.progressList.innerHTML = '<div class="materials-empty">你还没有选择学习课程，请在课程页加入学习</div>';
      return;
    }
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
        <div class="user-profile-line">\u89d2\u8272\uff1a${escapeHtml(role)} · \u5168\u90e8\u8bfe\u7a0b\uff1a${state.allLectureRows.length} ·  \u6559\u6750\uff1a${booksCount}</div>
        <div class="user-profile-line">\u5b66\u4e60\u65f6\u957f\uff1a${totalHours > 0 ? `${totalHours.toFixed(1)}h` : "0h"} \u00b7 \u6a21\u578b\uff1a${connected ? `\u5df2\u8fde\u63a5(${modelsCount})` : "\u672a\u8fde\u63a5"}</div>
      </div>
    `;
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

  function openReader(title, subtitle, content) {
    state.isReaderOpen = true;
    state.readerRequestToken += 1;
    el.materialsLayout.hidden = true;
    el.readerPane.hidden = false;
    el.readerTitle.textContent = title || "教材阅读";
    el.readerSubTitle.textContent = subtitle || "";
    el.readerContent.innerHTML = `<pre class="materials-preview-text">${escapeHtml(content || "（暂无文本内容）")}</pre>`;
  }

  function closeReader() {
    state.isReaderOpen = false;
    state.readerRequestToken += 1;
    el.readerPane.hidden = true;
    el.materialsLayout.hidden = false;
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
        <pre class="materials-preview-text">${escapeHtml(clipped || "（空文件）")}</pre>
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
    const data = await fetchJson("/api/frontend/materials");
    state.allLectureRows = Array.isArray(data.lectures) ? data.lectures : [];
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
    el.backFromReaderBtn.addEventListener("click", () => closeReader());

    el.kickerCreateTabBtn.addEventListener("click", () => setUploadTab("create"));
    el.kickerUploadTabBtn.addEventListener("click", () => setUploadTab("upload"));

    el.profileAdminSettingsBtn.addEventListener("click", () => {
      window.location.href = "/status";
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

      const bookItem = target.closest(".book-item");
      if (!bookItem) return;
      const requestToken = state.readerRequestToken + 1;
      state.selectedBookId = String(bookItem.getAttribute("data-book-id") || "");
      renderLectureDetail();
      const row = getSelectedLectureRow();
      const lecture = row ? (row.lecture || {}) : {};
      const books = row && Array.isArray(row.books) ? row.books : [];
      const book = books.find((it) => String((it && it.id) || "") === state.selectedBookId) || {};
      renderReaderPlaceholder("正在加载教材全文...");
      openReader(
        String(book.title || "教材阅读"),
        `${getLectureTitle(lecture)} · ${vectorStatusLabel(book.vector_status, book.vector_provider)} / ${materialStatusLabel(book.status)}`,
        "正在加载..."
      );
      const fullText = await fetchBookTextFull();
      if (requestToken !== state.readerRequestToken || !state.isReaderOpen) {
        return;
      }
      openReader(
        String(book.title || "教材阅读"),
        `${getLectureTitle(lecture)} · ${vectorStatusLabel(book.vector_status, book.vector_provider)} / ${materialStatusLabel(book.status)}`,
        fullText || "（当前教材暂无可读取文本，可能仍在解析或向量化）"
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
    setView("dashboard");
    closeReader();
    setUploadTab("create");
    renderUploadPreviewEmpty("请选择教材文件后预览");
    setUploadTip("支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST", false);

    await loadFrontendContext();
    updateAdminVisibility();
    await refreshAll();
    bindEvents();
  }

  init().catch((err) => {
    showToast(`初始化失败：${err && err.message ? err.message : "未知错误"}`);
  });

  window.addEventListener("beforeunload", () => notifyHostInputVisibility(false));
})();
