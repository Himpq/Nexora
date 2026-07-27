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
    state.readerBookInfoXml = "";
    state.readerBookDetailXml = "";
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
      infoXml: "",
      detailXml: "",
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
    state.readerBookInfoXml = String(bookInfoXml || "");
    state.readerBookDetailXml = String(bookDetailXml || "");
    state.catalogContext = {
      title: String(book.title || "教材目录"),
      subtitle: getLectureTitle(lecture),
      bookId: String(book.id || ""),
      coverPath: getBookCoverPath(book),
      chapters,
      infoXml: String(bookInfoXml || ""),
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
    flushReaderPosition();
    state.readerChapters = Array.isArray(state.catalogContext.chapters) ? state.catalogContext.chapters.slice() : [];
    state.readerBookInfoXml = String(state.catalogContext.infoXml || "");
    state.readerBookDetailXml = String(state.catalogContext.detailXml || "");
    const savedPosition = getSavedReaderPosition();
    const openIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number.isFinite(idx) ? idx : 0));
    const restorePosition = savedPosition && savedPosition.chapterIndex === openIndex ? savedPosition : null;
    state.readerActiveChapterIndex = openIndex;
    logReaderDebug("catalogChapter:click", {
      requestedChapterIndex: idx,
      openedChapterIndex: openIndex,
      restoredChapterIndex: restorePosition ? restorePosition.chapterIndex : null,
    });
    // 先打开Reader并显示加载状态
    openReader(
      state.catalogContext.title || "教材阅读",
      state.catalogContext.subtitle || "",
      "",
      { chapterIndex: openIndex, loading: true, restorePosition }
    );
    // 按章节加载内容
    await loadChapterContent(openIndex);
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

    if (effectiveTab === "cognition") {
      return '<div class="course-home-tab-pane is-active-pane" data-tab-pane="cognition">' +
        '<div class="learning-panel-section-body">' +
        '<div class="cognition-twin-shell" id="courseCognitionTwinContainer" data-lecture-id="' + escapeHtml(lectureId) + '">' +
        '<div class="cognition-twin-loading">正在读取认知状态...</div>' +
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

    if (effectiveTabName === "cognition") {
      loadCourseCognitionTwin(effectiveLectureId);
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

  function renderLearningReportMetric(label, value, tone = "") {
    const toneClass = tone ? ` is-${tone}` : "";

    return `
      <div class="learning-report-metric${toneClass}">
        <div class="learning-report-metric-label">${escapeHtml(label)}</div>
        <div class="learning-report-metric-value">${escapeHtml(value)}</div>
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

  function renderLearningReportEvidence(label, value) {
    return `
      <div class="learning-report-evidence">
        <div class="learning-report-evidence-label">${escapeHtml(label)}</div>
        <div class="learning-report-evidence-value">${escapeHtml(value)}</div>
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
        <div class="learning-report-updated">更新于 ${escapeHtml(formatTs(Number(payload.generated_at || 0)))}</div>

        <section class="learning-report-section learning-report-overview-section">
          <header class="learning-report-section-head">
            <div>
              <span>整体进展</span>
              <h3>${escapeHtml(reportStatus.label)}</h3>
            </div>
            <strong>${escapeHtml(String(progressPercent))}%</strong>
          </header>
          <div class="learning-report-hero-main">
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
          <div class="learning-report-hero-side" aria-label="进展证据">
            ${renderLearningReportEvidence("章节", `${summary.completed_chapters || 0}/${summary.total_chapters || 0}`)}
            ${renderLearningReportEvidence("小节", `${summary.completed_sessions || 0}/${summary.total_sessions || 0}`)}
            ${renderLearningReportEvidence("正确率", accuracy)}
          </div>
        </section>

        <section class="learning-report-section">
          <header class="learning-report-section-head"><h2>学习概览</h2></header>
          <div class="learning-report-metrics">
          ${renderLearningReportMetric("学习时长", formatLearningReportNumber(summary.study_hours || 0, "h"), "time")}
          ${renderLearningReportMetric("阅读深度", `${reading.deep_read_chapters || 0}`, "reading")}
          ${renderLearningReportMetric("测验提交", String(summary.submitted_questions || 0), "quiz")}
          ${renderLearningReportMetric("画像完整度", formatLearningReportPercent(summary.profile_completion_rate || 0), "profile")}
          </div>
        </section>

        <section class="learning-report-section">
          <header class="learning-report-section-head"><h2>需要巩固</h2></header>
          <div class="learning-report-grid learning-report-action-grid">
          <article class="learning-report-block learning-report-block-primary">
            <div class="learning-report-block-title">薄弱点</div>
            ${renderLearningReportInsightList(payload.weaknesses, "暂无显性薄弱点", "weak")}
          </article>

          <article class="learning-report-block learning-report-block-primary">
            <div class="learning-report-block-title">下一步建议</div>
            ${renderLearningReportInsightList(payload.recommendations, "暂无建议", "next")}
          </article>
          </div>
        </section>

        <section class="learning-report-section">
          <header class="learning-report-section-head"><h2>学习证据</h2></header>
          <div class="learning-report-grid">
          <article class="learning-report-block">
            <div class="learning-report-block-title">学习行为</div>
            <div class="learning-report-evidence-grid">
              ${renderLearningReportEvidence("阅读事件", String(reading.total_events || 0))}
              ${renderLearningReportEvidence("文本选择", String(reading.selection_count || 0))}
              ${renderLearningReportEvidence("批注提问", String(reading.annotation_ask_count || 0))}
            </div>
          </article>

          <article class="learning-report-block">
            <div class="learning-report-block-title">题目状态</div>
            <div class="learning-report-line">提交 ${escapeHtml(String(quiz.submitted || 0))} 题 · 可判定 ${escapeHtml(String(quiz.reviewed || 0))} 题 · 正确 ${escapeHtml(String(quiz.correct || 0))} 题</div>
            ${renderLearningReportPills(difficultyRows, "暂无难度分布")}
          </article>
          </div>
        </section>

        <section class="learning-report-section">
          <header class="learning-report-section-head"><h2>画像变化</h2></header>
          <div class="learning-report-grid learning-report-grid-bottom">
          <article class="learning-report-block">
            <div class="learning-report-block-title">画像依据</div>
            ${renderLearningReportPills(filledDimensions, "暂无已填写画像维度")}
          </article>

          <article class="learning-report-block">
            <div class="learning-report-block-title">画像变化</div>
            ${renderLearningReportPills(profileProgressRows, "暂无画像时间线")}
          </article>
          </div>
        </section>

        <section class="learning-report-section learning-report-record-section">
          <header class="learning-report-section-head"><h2>最近学习记录</h2></header>
          <div class="learning-report-record-block">
            ${renderLearningReportRecords(payload.recent_records)}
          </div>
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
      { key: "cognition", label: "认知孪生" },
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
    } else {
      restoreReaderPositionAfterRender(idx);
    }
  }

