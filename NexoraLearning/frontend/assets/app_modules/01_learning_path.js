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
    state.lpChapterError = "";
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

    if (isLearningPathChapterGenerationStage(stage)) {
      renderLearningPathChapterStreamingView(md, lectureId);
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

    if ((stage === "path-ready" || isLearningPathChapterGenerationStage(stage)) && hasPathChapters) {
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
    const generating = !!(chapter && (
      chapter.content_generating === true ||
      String(chapter.generation_status || "").trim().toLowerCase() === "running"
    ));
    const rawStatus = String(chapter && chapter.status || "").trim().toLowerCase();

    if (completed) {
      return { className: "is-completed", label: "已完成", title: "学习已完成" };
    }

    if (generating) {
      return { className: "is-current", label: "生成中", title: "章节内容正在生成" };
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

  function isLearningPathChapterGenerationStage(stage) {
    return stage === "generating-chapter" || stage === "chapter-generation-error";
  }

    // 渲染右侧学习大纲，收起动画由外层状态类驱动。
    function renderLearningPathOutline(container, chapters, lectureId) {
        let html = '<div class="lp-outline-list">';
        const generatingIndex = Number(state.lpChapterGeneratingIndex);
        const activeIndex = isLearningPathChapterGenerationStage(state.learningPathStage) &&
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
                  isLearningPathChapterGenerationStage(state.learningPathStage) &&
                  Number.isInteger(generatingIndex) &&
                  generatingIndex >= 0 &&
                  idx !== generatingIndex
                ) {
                  state.learningPathStage = "path-ready";
                }
                state.currentChapterIndex = idx;
                renderLearningPathView(lectureId);
            });
        });
    }

  function isLearningPathChapterStreaming(lectureId, chapterIndex, chapter) {
    const idx = Number(chapterIndex);
    if (!Number.isInteger(idx) || idx < 0) return false;

    const streamLectureId = String(lectureId || "").trim();
    const keyLectureId = String(state.selectedLectureId || "").trim();
    const sameClientStream = !!(
      state.lpChapterStreamKey &&
      Number(state.lpChapterGeneratingIndex) === idx &&
      (!keyLectureId || keyLectureId === streamLectureId)
    );
    const serverRunning = !!(chapter && (
      chapter.content_generating === true ||
      String(chapter.generation_status || "").trim().toLowerCase() === "running"
    ));

    return sameClientStream || serverRunning;
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
    } else if (isLearningPathChapterStreaming(lectureId, idx, chapter)) {
      const hasClientStream = !!(
        state.lpChapterStreamKey &&
        Number(state.lpChapterGeneratingIndex) === idx
      );
      state.learningPathStage = "generating-chapter";
      state.lpChapterGeneratingIndex = idx;
      renderLearningPathSidePanel(lectureId);
      renderLearningPathChapterStreamingView(md, lectureId);

      if (!hasClientStream) {
        void generatePersonalizedChapterContent(lectureId, idx, { resume: true });
      }
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

  function cleanupLearningArticleLabs() {
    const cleanups = Array.isArray(state.lpLabCleanups) ? state.lpLabCleanups : [];

    cleanups.forEach((cleanup) => {
        if (typeof cleanup === "function") {
            cleanup();
        }
    });

    state.lpLabCleanups = [];
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
    cleanupLearningArticleLabs();

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

    bindLearningArticleExperiments(md);
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
      normalizeQuizQuestions(quizState.questions).length
    ) {
      setQuizQuestions(quizState.questions);
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

      const normalizedQuestions = normalizeQuizQuestions(questions);

      if (!quizId || !normalizedQuestions.length) {
        throw new Error("本章练习没有返回有效题目");
      }

      setQuizQuestions(normalizedQuestions);
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

  function renderLearningPathChapterStreamingView(md, lectureId) {
    const pathData = state.learningPathData || {};
    const chapters = Array.isArray(pathData.chapters) ? pathData.chapters : [];
    const generatingIndex = Number(state.lpChapterGeneratingIndex);
    const chapterIndex = Number.isInteger(generatingIndex) && generatingIndex >= 0
      ? generatingIndex
      : Math.max(0, Number(state.currentChapterIndex) || 0);
    const chapter = chapters[chapterIndex] || {};
    const draft = String(state.lpChapterDraft || "");
    const isError = state.learningPathStage === "chapter-generation-error";
    const errorMessage = String(state.lpChapterError || "章节生成结果未通过保存校验");
    const bodyHtml = draft.trim()
      ? renderMarkdownSimple(draft, { labState: isError ? "invalid" : "validating" })
      : `<p class="lp-chapter-stream-placeholder">${isError ? "本次生成没有可保留的正文。" : "等待模型输出正文..."}</p>`;
    const statusHtml = isError
      ? `
          <div class="lp-chapter-stream-status is-error" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 7v6M12 17h.01"></path>
            </svg>
            <span><strong>生成结果未保存</strong>${escapeHtml(errorMessage)}</span>
            <button type="button" data-lp-chapter-retry>重新生成</button>
          </div>
        `
      : `
          <div class="lp-chapter-stream-status" role="status">
            <span class="quiz-loading-spinner"></span>
            <span>正在生成并校验章节阅读</span>
          </div>
        `;

    md.innerHTML = `
      <div class="lp-chapter-view is-streaming ${isError ? "has-generation-error" : ""}">
        <div class="lp-chapter-header">
          <div class="lp-chapter-title">${escapeHtml(chapter.name || "章节内容")}</div>
          <div class="lp-chapter-meta">${escapeHtml(chapter.book_title || "")}</div>
        </div>
        ${statusHtml}
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

    const retryButton = md.querySelector("[data-lp-chapter-retry]");
    if (retryButton) {
      retryButton.addEventListener("click", () => {
        void generatePersonalizedChapterContent(lectureId, chapterIndex);
      });
    }
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
      ? renderMarkdownSimple(text, { labState: "validating" })
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

async function generatePersonalizedChapterContent(lectureId, chapterIndex, options) {
    const opts = options && typeof options === "object" ? options : {};
    const requestedChapterIndex = Number(chapterIndex);
    const streamKey = `${String(lectureId || "").trim()}::${requestedChapterIndex}::${Date.now()}`;
    state.learningPathStage = "generating-chapter";
    state.lpChapterDraft = "";
    state.lpChapterError = "";
    state.lpChapterAutoScroll = true;
    state.currentChapterIndex = requestedChapterIndex;
    state.lpChapterGeneratingIndex = requestedChapterIndex;
    state.lpChapterStreamKey = streamKey;
    if (
      state.learningPathData &&
      Array.isArray(state.learningPathData.chapters) &&
      state.learningPathData.chapters[requestedChapterIndex]
    ) {
      state.learningPathData.chapters[requestedChapterIndex].content_generating = true;
      state.learningPathData.chapters[requestedChapterIndex].generation_status = "running";
    }
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
          if (
            state.learningPathStage === "generating-chapter" &&
            Number(state.currentChapterIndex) === requestedChapterIndex
          ) {
            updateLearningPathChapterStreamingMarkdown(markdownDraft);
          }
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

      if (state.lpChapterStreamKey !== streamKey) {
        return;
      }

      const shouldRenderResult = !!(
        Number(state.currentChapterIndex) === resultChapterIndex &&
        state.learningPathStage === "generating-chapter"
      );

      const renderedContent = String((result && result.content) || "").trim();
      if (!renderedContent) {
        throw new Error("章节生成完成但未返回 Markdown 正文");
      }

      if (
        state.learningPathData &&
        state.learningPathData.chapters &&
        state.learningPathData.chapters[resultChapterIndex]
      ) {
        state.learningPathData.chapters[resultChapterIndex].content_generated = true;
        state.learningPathData.chapters[resultChapterIndex].content_generating = false;
        state.learningPathData.chapters[resultChapterIndex].generation_status = "done";
      }

      state.learningPathStage = "path-ready";
      state.lpChapterGeneratingIndex = -1;
      state.lpChapterStreamKey = "";
      state.lpChapterError = "";

      const chapter = state.learningPathData && Array.isArray(state.learningPathData.chapters)
        ? state.learningPathData.chapters[resultChapterIndex]
        : null;
      if (chapter && el.learningPathMarkdown && shouldRenderResult) {
        state.currentChapterIndex = resultChapterIndex;
        state.lpChapterDraft = "";
        renderLearningPathSidePanel(lectureId);
        renderChapterMarkdown(el.learningPathMarkdown, lectureId, resultChapterIndex, chapter, renderedContent);
      } else if (chapter) {
        state.lpChapterDraft = "";
        renderLearningPathSidePanel(lectureId);
      } else {
        throw new Error("章节生成完成，但章节视图状态异常");
      }
    } catch (err) {
      if (state.lpChapterStreamKey !== streamKey) {
        return;
      }
      const shouldRenderError = !!(
        Number(state.currentChapterIndex) === requestedChapterIndex &&
        state.learningPathStage === "generating-chapter"
      );
      if (
        state.learningPathData &&
        Array.isArray(state.learningPathData.chapters) &&
        state.learningPathData.chapters[requestedChapterIndex]
      ) {
        state.learningPathData.chapters[requestedChapterIndex].content_generating = false;
        state.learningPathData.chapters[requestedChapterIndex].generation_status = "error";
      }
      const errorMessage = String(err && err.message ? err.message : "章节生成失败");
      state.lpChapterStreamKey = "";
      if (shouldRenderError) {
        state.learningPathStage = "chapter-generation-error";
        state.lpChapterGeneratingIndex = requestedChapterIndex;
        state.lpChapterError = errorMessage;
        renderLearningPathView(lectureId);
        showToast(errorMessage);
      } else {
        state.learningPathStage = "path-ready";
        state.lpChapterGeneratingIndex = -1;
        state.lpChapterError = errorMessage;
        renderLearningPathSidePanel(lectureId);
        if (!opts.silent) {
          showToast(errorMessage);
        }
      }
    }
  }

  function renderLearningLabError(title, detail) {
    return `
      <section class="lp-lab lp-lab-error">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">Interactive Lab</div>
            <h3>${escapeHtml(title || "实验组件配置无效")}</h3>
          </div>
        </div>
        <p>${escapeHtml(detail || "请检查 nxl-lab JSON 配置。")}</p>
      </section>
    `;
  }

  // 互动实验只解析 nxl-lab JSON 配置，不执行模型生成的 HTML 或脚本。
  function renderLearningLabBlock(rawConfig, blockIndex) {
    let config = null;

    try {
        config = JSON.parse(String(rawConfig || ""));
    } catch (err) {
        return renderLearningLabError("实验组件 JSON 无法解析", String(err && err.message || "JSON parse error"));
    }

    if (!config || typeof config !== "object") {
        return renderLearningLabError("实验组件配置必须是对象", "nxl-lab 内容需要是一个 JSON object。");
    }

    const type = String(config.type || "").trim();

    if (type === "formula_simulation") {
        return renderFormulaSimulationLab(config, blockIndex);
    }

    if (type === "canvas_scene") {
        return renderCanvasSceneLab(config, blockIndex);
    }

    if (type === "step_flow") {
        return renderStepFlowLab(config, blockIndex);
    }

    if (type === "chart_experiment") {
        return renderChartExperimentLab(config, blockIndex);
    }

    if (type === "code_trace") {
        return renderCodeTraceLab(config, blockIndex);
    }

    if (type === "sandbox_component") {
        return renderSandboxComponentLab(config, blockIndex);
    }

    return renderLearningLabError("未知实验组件类型", `当前类型：${type || "未填写"}`);
  }

  function renderLearningLabControls(parameters, emptyText, resultText) {
    const rows = parameters.length ? parameters.map((param) => {
        const key = String(param && param.key || "").trim();
        const label = String(param && param.label || key || "参数").trim();
        const min = Number(param && param.min);
        const max = Number(param && param.max);
        const step = Number(param && param.step) || 1;
        const value = Number(param && param.value);
        const unit = String(param && param.unit || "").trim();

        if (!key || !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(value)) {
            return "";
        }

        return `
          <label class="lp-lab-control">
            <span>
              <strong>${escapeHtml(label)}</strong>
              <em data-lab-value="${escapeHtml(key)}">${escapeHtml(String(value))}${unit ? ` ${escapeHtml(unit)}` : ""}</em>
            </span>
            <input type="range" min="${escapeHtml(String(min))}" max="${escapeHtml(String(max))}" step="${escapeHtml(String(step))}" value="${escapeHtml(String(value))}" data-lab-param="${escapeHtml(key)}">
          </label>
        `;
    }).join("") : `<div class="lp-lab-scene-note">${escapeHtml(emptyText || "该实验没有可调参数。")}</div>`;

    return `
      <div class="lp-lab-controls">
        ${rows}
        <div class="lp-lab-result" data-lab-result>${escapeHtml(resultText || "等待参数变化")}</div>
      </div>
    `;
  }

  // 公式实验第一版先支持理想气体模型，后续可按 formula_key 扩展更多受控渲染器。
  function renderFormulaSimulationLab(config, blockIndex) {
    const title = String(config.title || "公式实验").trim();
    const description = String(config.description || "").trim();
    const formula = String(config.formula || "").trim();
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));

    if (!parameters.length) {
        return renderLearningLabError("公式实验缺少参数", "parameters 至少需要 1 个可拖动参数。");
    }

    return `
      <section class="lp-lab lp-lab-formula" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">Formula Playground</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
          ${formula ? `<div class="lp-lab-formula-badge">${escapeHtml(formula)}</div>` : ""}
        </div>
        <div class="lp-lab-formula-grid">
          ${renderLearningLabControls(parameters, "公式实验缺少可调参数。", "等待参数变化")}
          <div class="lp-lab-stage">
            <canvas class="lp-lab-canvas" data-lab-canvas></canvas>
          </div>
        </div>
      </section>
    `;
  }

  function labExpressionUsesName(expression, name) {
    const names = String(expression || "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    return names.includes(String(name || ""));
  }

  function findCanvasScenePlotConfigError(config) {
    const scene = config && typeof config.scene === "object" ? config.scene : null;
    const elements = scene && Array.isArray(scene.elements) ? scene.elements : [];

    for (const element of elements) {
      if (!element || String(element.type || "") !== "plot") {
        continue;
      }

      const curves = Array.isArray(element.curves) ? element.curves : [];
      const hasAxisCurve = curves.some((curve) => labExpressionUsesName(curve && curve.expression, "x"));

      if (!hasAxisCurve) {
        return "plot 曲线至少需要 1 条表达式使用 x 作为横轴变量。";
      }
    }

    return "";
  }

  function findCanvasSceneDynamicStyleError(config) {
    const scene = config && typeof config.scene === "object" ? config.scene : null;
    const elements = scene && Array.isArray(scene.elements) ? scene.elements : [];
    const staticFields = new Set(["fill", "stroke", "color", "text_color"]);

    const visit = (value, path) => {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const error = visit(value[index], `${path}[${index}]`);

          if (error) return error;
        }

        return "";
      }

      if (!value || typeof value !== "object") {
        return "";
      }

      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;

        if (staticFields.has(key) && typeof child === "string" && child.trim().startsWith("=")) {
          return `${childPath} 使用了动态样式表达式。流程状态请使用 step_flow。`;
        }

        if (key === "text" && typeof child === "string" && child.trim().startsWith("=")) {
          return `${childPath} 使用了条件文本表达式。流程状态请使用 step_flow。`;
        }

        const error = visit(child, childPath);

        if (error) return error;
      }

      return "";
    };

    return visit(elements, "scene.elements");
  }

  // 通用 canvas_scene 由模型组合基础图元，前端只执行受控绘制指令。
  function renderCanvasSceneLab(config, blockIndex) {
    const title = String(config.title || "Canvas 实验").trim();
    const description = String(config.description || "").trim();
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));
    const plotConfigError = findCanvasScenePlotConfigError(config);
    const dynamicStyleError = findCanvasSceneDynamicStyleError(config);

    if (plotConfigError || dynamicStyleError) {
      return renderLearningLabError("实验组件配置无效", plotConfigError || dynamicStyleError);
    }

    return `
      <section class="lp-lab lp-lab-canvas-scene" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">Canvas Scene</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
        </div>
        <div class="lp-lab-formula-grid">
          ${renderLearningLabControls(parameters, "该场景没有可调参数。", "拖动参数观察画布变化")}
          <div class="lp-lab-stage">
            <canvas class="lp-lab-canvas" data-lab-canvas></canvas>
          </div>
        </div>
      </section>
    `;
  }

  // 流程实验使用统一组件呈现步骤、状态和详情，模型只负责提供教学数据。
  function renderStepFlowLab(config, blockIndex) {
    const title = String(config.title || "流程实验").trim();
    const description = String(config.description || "").trim();
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const steps = Array.isArray(config.steps) ? config.steps : [];
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));

    if (!parameters.length || steps.length < 2) {
      return renderLearningLabError("流程实验配置不完整", "parameters 和 steps 都必须提供。");
    }

    return `
      <section class="lp-lab lp-lab-step-flow" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">交互流程</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
        </div>
        <div class="lp-step-flow-controls">
          ${renderLearningLabControls(parameters, "流程实验缺少进度参数。", "选择阶段查看学习重点")}
        </div>
        <div class="lp-step-flow-overview">
          <div class="lp-step-flow-progress" aria-hidden="true">
            <span data-step-flow-progress-bar></span>
          </div>
          <div class="lp-step-flow-progress-meta">
            <strong data-step-flow-progress-label>0 / ${steps.length}</strong>
            <span>点击步骤可直接查看对应阶段</span>
          </div>
        </div>
        <div class="lp-step-flow-layout">
          <div class="lp-step-flow-list" role="list">
            ${steps.map((step, index) => `
              <button class="lp-step-flow-item" type="button" role="listitem" data-step-flow-index="${index}" aria-pressed="false">
                <span class="lp-step-flow-index">${String(index + 1).padStart(2, "0")}</span>
                <span class="lp-step-flow-copy">
                  <strong>${escapeHtml(String(step && step.title || `阶段 ${index + 1}`))}</strong>
                  <small>${escapeHtml(String(step && step.summary || ""))}</small>
                </span>
                <span class="lp-step-flow-state" data-step-flow-state>待开始</span>
              </button>
            `).join("")}
          </div>
          <aside class="lp-step-flow-detail" aria-live="polite">
            <span class="lp-step-flow-detail-tag" data-step-flow-detail-tag>当前阶段</span>
            <h4 data-step-flow-detail-title></h4>
            <p data-step-flow-detail-text></p>
          </aside>
        </div>
      </section>
    `;
  }

  // 沙箱组件允许模型生成小型交互实验，但只运行在无同源权限的 iframe 内。
  function renderSandboxComponentLab(config, blockIndex) {
    const title = String(config.title || "沙箱实验").trim();
    const description = String(config.description || "").trim();
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const component = config.component && typeof config.component === "object" ? config.component : null;
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));

    if (!component || !String(component.html || "").trim() || !String(component.js || "").trim()) {
      return renderLearningLabError("沙箱实验缺少组件代码", "component.html 和 component.js 都需要由模型生成。");
    }

    return `
      <section class="lp-lab lp-lab-sandbox" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">Sandbox Lab</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
        </div>
        <div class="lp-lab-formula-grid lp-lab-sandbox-grid">
          ${renderLearningLabControls(parameters, "该沙箱实验没有可调参数。", "沙箱等待加载")}
          <div class="lp-lab-stage lp-lab-sandbox-stage">
            <iframe class="lp-lab-sandbox-frame" data-sandbox-frame sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escapeHtml(title)}"></iframe>
          </div>
        </div>
      </section>
    `;
  }

  // 代码执行图解由模型提交逐步 trace，前端只负责播放指针、变量和输出变化。
  function renderCodeTraceLab(config, blockIndex) {
    const title = String(config.title || "代码执行图解").trim();
    const description = String(config.description || "").trim();
    const codeLines = Array.isArray(config.code) ? config.code.map((line) => String(line || "")) : [];
    const steps = Array.isArray(config.steps) ? config.steps : [];
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));

    if (!codeLines.length || !steps.length) {
        return renderLearningLabError("代码执行图解缺少代码或步骤", "code 和 steps 都需要由模型生成。");
    }

    return `
      <section class="lp-lab lp-lab-code-trace" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">Execution Trace</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
          <div class="lp-lab-trace-actions">
            <button type="button" data-trace-action="run">运行</button>
            <button type="button" data-trace-action="reset">重置</button>
          </div>
        </div>
        <div class="lp-lab-trace-grid">
          <div class="lp-lab-code-lines">
            ${codeLines.map((line, idx) => `
              <div class="lp-lab-code-line" data-trace-line="${idx}">
                <span>${idx + 1}</span>
                <code>${escapeHtml(line)}</code>
              </div>
            `).join("")}
          </div>
          <div class="lp-lab-trace-side">
            <div class="lp-lab-vars" data-trace-vars>变量将在运行时显示</div>
            <pre class="lp-lab-output" data-trace-output></pre>
          </div>
        </div>
      </section>
    `;
  }

  function decodeLearningLabConfig(node) {
    const raw = String(node && node.getAttribute("data-lab-config") || "");

    if (!raw) {
        throw new Error("缺少 data-lab-config");
    }

    return JSON.parse(decodeURIComponent(raw));
  }

  function findLearningLabDataNode(root, attrName, value) {
    const expected = String(value || "");
    const nodes = root ? Array.from(root.querySelectorAll(`[${attrName}]`)) : [];

    return nodes.find((node) => String(node.getAttribute(attrName) || "") === expected) || null;
  }

  function getFormulaLabValues(node, config) {
    const values = {};
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];

    parameters.forEach((param) => {
        const key = String(param && param.key || "").trim();
        if (!key) return;

        const input = findLearningLabDataNode(node, "data-lab-param", key);
        const rawValue = input instanceof HTMLInputElement ? input.value : param.value;
        const value = Number(rawValue);

        if (Number.isFinite(value)) {
            values[key] = value;
        }
    });

    return values;
  }

  function calculateFormulaLabResult(config, values) {
    const formulaKey = String(config.formula_key || "").trim();

    if (formulaKey === "ideal_gas") {
        const n = Number(values.n);
        const r = Number(values.R || values.r || 8.314);
        const t = Number(values.T);
        const v = Number(values.V);

        if (![n, r, t, v].every(Number.isFinite) || v <= 0) {
            throw new Error("理想气体实验需要 n、T、V，并且 V 必须大于 0。");
        }

        return {
            label: "P",
            value: (n * r * t) / v,
            unit: String(config.result_unit || "kPa"),
        };
    }

    throw new Error(`未注册公式实验：${formulaKey || "未填写 formula_key"}`);
  }

  function syncFormulaLabLabels(node, config, values) {
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];

    parameters.forEach((param) => {
        const key = String(param && param.key || "").trim();
        const label = findLearningLabDataNode(node, "data-lab-value", key);
        const unit = String(param && param.unit || "").trim();

        if (label && Object.prototype.hasOwnProperty.call(values, key)) {
            label.textContent = `${values[key]}${unit ? ` ${unit}` : ""}`;
        }
    });
  }

  function encodeLearningLabPayload(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const chunkSize = 8192;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.slice(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return window.btoa(binary);
  }

  function buildSandboxComponentSrcdoc(config, values) {
    const component = config.component && typeof config.component === "object" ? config.component : {};
    const payload = {
      title: String(config.title || "Sandbox Lab"),
      html: String(component.html || ""),
      css: String(component.css || ""),
      js: String(component.js || ""),
      params: values && typeof values === "object" ? values : {},
    };
    const encodedPayload = encodeLearningLabPayload(JSON.stringify(payload));

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Sandbox Lab</title>
  <style>
    html,
    body {
      min-height: 100%;
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    #nxlRoot {
      min-height: 100vh;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <main id="nxlRoot"></main>
  <script>
    (function () {
      "use strict";

      var SOURCE = "nxl-sandbox-component";
      var PARENT_SOURCE = "nxl-sandbox-parent";
      var payloadBytes = Uint8Array.from(window.atob("${encodedPayload}"), function (char) {
        return char.charCodeAt(0);
      });
      var payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      var root = document.getElementById("nxlRoot");
      var params = Object.assign({}, payload.params || {});
      var cleanup = null;
      var mounted = false;

      function post(type, detail) {
        window.parent.postMessage({
          source: SOURCE,
          type: type,
          detail: detail || {},
        }, "*");
      }

      function getContext() {
        return {
          root: root,
          params: params,
          width: window.innerWidth || root.clientWidth || 640,
          height: window.innerHeight || root.clientHeight || 360,
          setStatus: function (text) {
            post("status", { text: String(text || "") });
          },
          postEvent: function (eventType, detail) {
            post("event", {
              eventType: String(eventType || ""),
              detail: detail || {},
            });
          },
        };
      }

      function reportError(error) {
        post("error", {
          message: String(error && error.message ? error.message : error || "sandbox error"),
        });
      }

      function runMount() {
        if (typeof cleanup === "function") {
          cleanup();
          cleanup = null;
        }

        if (typeof window.mount !== "function") {
          throw new Error("sandbox_component.js 必须定义 function mount(ctx)");
        }

        cleanup = window.mount(getContext());
        mounted = true;
        post("ready", {});
      }

      function runUpdate() {
        if (!mounted) {
          runMount();
          return;
        }

        if (typeof window.update === "function") {
          window.update(getContext());
        }
      }

      window.addEventListener("error", function (event) {
        reportError(event.error || event.message);
      });

      window.addEventListener("unhandledrejection", function (event) {
        reportError(event.reason);
      });

      window.addEventListener("message", function (event) {
        var data = event && event.data ? event.data : {};

        if (!data || data.source !== PARENT_SOURCE) {
          return;
        }

        if (data.type === "params") {
          params = Object.assign({}, params, data.params || {});

          try {
            runUpdate();
          } catch (error) {
            reportError(error);
          }
        }
      });

      try {
        var style = document.createElement("style");
        style.textContent = String(payload.css || "");
        document.head.appendChild(style);
        root.innerHTML = String(payload.html || "");

        var script = document.createElement("script");
        script.textContent = String(payload.js || "") + "\\n//# sourceURL=nxl-sandbox-component.js";
        document.body.appendChild(script);
        runMount();

        var observer = new ResizeObserver(function () {
          var height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 320);
          post("height", { height: height });
        });
        observer.observe(document.documentElement);
      } catch (error) {
        reportError(error);
      }
    }());
  </script>
</body>
</html>`;
  }

  function resizeLabCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(320, Math.floor(rect.width || 320));
    const height = Math.max(220, Math.floor(rect.height || 220));

    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
    }

    return { width, height, ratio };
  }

  function pingPongUnit(value) {
    const wrapped = ((Number(value || 0) % 2) + 2) % 2;

    return wrapped <= 1 ? wrapped : 2 - wrapped;
  }

  function buildLabExpressionScope(values, extraValues) {
    return Object.assign({}, values || {}, extraValues || {}, {
      abs: Math.abs,
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      exp: Math.exp,
      log: Math.log,
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      pi: Math.PI,
      clamp: (value, min, max) => Math.max(Number(min), Math.min(Number(max), Number(value))),
    });
  }

  function evaluateLabExpression(expression, values, extraValues) {
    const source = String(expression || "").trim();

    if (!source) {
      return 0;
    }

    if (!/^[0-9A-Za-z_+\-*/%^().,\s]+$/.test(source)) {
      throw new Error("表达式包含未允许的字符");
    }

    const scope = buildLabExpressionScope(values, extraValues);
    const allowedNames = new Set(Object.keys(scope));
    const names = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];

    names.forEach((name) => {
      if (!allowedNames.has(name)) {
        throw new Error(`表达式使用了未注册变量：${name}`);
      }
    });

    const argNames = Object.keys(scope);
    const argValues = argNames.map((name) => scope[name]);
    const normalized = source.replace(/\^/g, "**");
    const value = Function(...argNames, `"use strict"; return (${normalized});`)(...argValues);
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
      throw new Error("表达式结果不是有效数字");
    }

    return numberValue;
  }

  function resolveLabNumber(value, values, extraValues, defaultValue) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const text = String(value ?? "").trim();

    if (!text) {
      return Number(defaultValue || 0);
    }

    if (text.startsWith("=")) {
      return evaluateLabExpression(text.slice(1), values, extraValues);
    }

    const numberValue = Number(text);

    return Number.isFinite(numberValue) ? numberValue : Number(defaultValue || 0);
  }

  function resolveLabText(value, values, extraValues) {
    const text = String(value ?? "");

    return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, key) => {
      const scope = buildLabExpressionScope(values, extraValues);
      const current = scope[key];

      return typeof current === "number" ? String(Number(current.toFixed(2))) : String(current ?? "");
    });
  }

  function getCanvasSceneSize(config) {
    const scene = config && config.scene && typeof config.scene === "object" ? config.scene : {};

    return {
      width: Math.max(200, Number(scene.width || 640) || 640),
      height: Math.max(160, Number(scene.height || 360) || 360),
      scene,
    };
  }

  function drawCanvasArrowHead(ctx, x1, y1, x2, y2, color, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(4, Number(size || 10));

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function clampCanvasGraphCoordinate(value, extent, limit) {
    const safeLimit = Math.max(1, Number(limit || 0));
    const safeExtent = Math.max(1, Number(extent || 0));

    if (safeLimit <= safeExtent * 2 + 8) {
      return safeLimit / 2;
    }

    return Math.min(safeLimit - safeExtent - 4, Math.max(safeExtent + 4, value));
  }

  function getCanvasGraphConnectionPoint(node, target) {
    const dx = target.x - node.x;
    const dy = target.y - node.y;
    const distance = Math.hypot(dx, dy);

    if (!distance) {
      return { x: node.x, y: node.y };
    }

    if (node.shape === "rect") {
      const halfWidth = Math.max(1, node.width / 2);
      const halfHeight = Math.max(1, node.height / 2);
      const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);

      return {
        x: node.x + dx * scale,
        y: node.y + dy * scale,
      };
    }

    const scale = Math.max(1, node.radius) / distance;

    return {
      x: node.x + dx * scale,
      y: node.y + dy * scale,
    };
  }

  function fitCanvasTextWithEllipsis(ctx, text, maxWidth) {
    const characters = Array.from(String(text || ""));
    let result = characters.join("");

    while (characters.length && ctx.measureText(`${result}...`).width > maxWidth) {
      characters.pop();
      result = characters.join("");
    }

    return characters.length ? `${result}...` : "...";
  }

  function drawCanvasWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const characters = Array.from(String(text || ""));
    const lines = [];
    const lineLimit = Math.max(1, Number(maxLines || 3));
    let currentLine = "";
    let truncated = false;

    for (const character of characters) {
      if (character === "\n") {
        lines.push(currentLine);
        currentLine = "";

        if (lines.length >= lineLimit) {
          truncated = true;
          break;
        }

        continue;
      }

      const candidate = `${currentLine}${character}`;

      if (currentLine && ctx.measureText(candidate).width > maxWidth) {
        lines.push(currentLine);
        currentLine = character;

        if (lines.length >= lineLimit) {
          truncated = true;
          break;
        }
      } else {
        currentLine = candidate;
      }
    }

    if (lines.length < lineLimit && currentLine) {
      lines.push(currentLine);
    } else if (currentLine) {
      truncated = true;
    }

    if (!lines.length) {
      lines.push("");
    }

    if (truncated) {
      const lastIndex = lines.length - 1;
      lines[lastIndex] = fitCanvasTextWithEllipsis(ctx, lines[lastIndex], maxWidth);
    }

    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, x, startY + index * lineHeight);
    });
  }

  function drawCanvasSceneGraph(ctx, element, values, extraValues) {
    const nodes = Array.isArray(element.nodes) ? element.nodes : [];
    const edges = Array.isArray(element.edges) ? element.edges : [];
    const nodeMap = {};

    nodes.forEach((node) => {
      const id = String(node && node.id || "").trim();
      if (!id) return;

      const shape = String(node.shape || "circle").trim();
      const radius = Math.max(1, resolveLabNumber(node.radius, values, extraValues, 18));
      const width = Math.max(1, resolveLabNumber(node.width, values, extraValues, 78));
      const height = Math.max(1, resolveLabNumber(node.height, values, extraValues, 36));
      const extentX = shape === "rect" ? width / 2 : radius;
      const extentY = shape === "rect" ? height / 2 : radius;

      nodeMap[id] = {
        source: node,
        shape,
        x: clampCanvasGraphCoordinate(resolveLabNumber(node.x, values, extraValues, 0), extentX, extraValues.W),
        y: clampCanvasGraphCoordinate(resolveLabNumber(node.y, values, extraValues, 0), extentY, extraValues.H),
        radius,
        width,
        height,
      };
    });

    edges.forEach((edge) => {
      const from = nodeMap[String(edge && edge.from || "").trim()];
      const to = nodeMap[String(edge && edge.to || "").trim()];
      if (!from || !to) return;

      const color = String(edge.color || element.edge_color || "#64748b");
      const lineWidth = resolveLabNumber(edge.line_width, values, extraValues, 2);
      const start = getCanvasGraphConnectionPoint(from, to);
      const end = getCanvasGraphConnectionPoint(to, from);
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      if (edge.arrow !== false) {
        drawCanvasArrowHead(ctx, start.x, start.y, end.x, end.y, color, resolveLabNumber(edge.head_size, values, extraValues, 9));
      }

      if (edge.label) {
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        ctx.fillStyle = String(edge.label_color || "#475467");
        ctx.font = "700 12px \"Segoe UI\", \"Microsoft YaHei\", sans-serif";
        ctx.fillText(resolveLabText(edge.label, values, extraValues), midX + 6, midY - 6);
      }
    });

    Object.keys(nodeMap).forEach((id) => {
      const node = nodeMap[id];
      const source = node.source || {};
      const fill = String(source.fill || element.node_fill || "#ffffff");
      const stroke = String(source.stroke || element.node_stroke || "#111827");
      const label = resolveLabText(source.label || id, values, extraValues);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = resolveLabNumber(source.line_width, values, extraValues, 2);

      if (node.shape === "rect") {
        const x = node.x - node.width / 2;
        const y = node.y - node.height / 2;
        ctx.fillRect(x, y, node.width, node.height);
        ctx.strokeRect(x, y, node.width, node.height);
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(1, node.radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = String(source.text_color || "#111827");
      ctx.font = `${String(source.weight || "800")} ${resolveLabNumber(source.size, values, extraValues, 12)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontSize = Math.max(8, resolveLabNumber(source.size, values, extraValues, 12));
      const textWidth = node.shape === "rect"
        ? Math.max(24, node.width - 14)
        : Math.max(24, node.radius * 1.55);
      drawCanvasWrappedText(ctx, label, node.x, node.y, textWidth, fontSize * 1.22, 3);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    });
  }

  function drawCanvasScenePlot(ctx, element, values, extraValues) {
    const x = resolveLabNumber(element.x, values, extraValues, 40);
    const y = resolveLabNumber(element.y, values, extraValues, 40);
    const width = resolveLabNumber(element.width, values, extraValues, 300);
    const height = resolveLabNumber(element.height, values, extraValues, 180);
    const xMin = resolveLabNumber(element.x_min, values, extraValues, -1);
    const xMax = resolveLabNumber(element.x_max, values, extraValues, 1);
    const yMin = resolveLabNumber(element.y_min, values, extraValues, -1);
    const yMax = resolveLabNumber(element.y_max, values, extraValues, 1);
    const curves = Array.isArray(element.curves) ? element.curves : [];
    const samples = Math.max(8, Math.min(240, Math.round(resolveLabNumber(element.samples, values, extraValues, 80))));
    const toCanvasX = (value) => x + ((value - xMin) / Math.max(0.000001, xMax - xMin)) * width;
    const toCanvasY = (value) => y + height - ((value - yMin) / Math.max(0.000001, yMax - yMin)) * height;

    ctx.fillStyle = String(element.fill || "#ffffff");
    ctx.strokeStyle = String(element.stroke || "#d0d5dd");
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);

    ctx.strokeStyle = "#e5e7eb";
    ctx.beginPath();
    for (let i = 1; i < 4; i += 1) {
      const gx = x + (width / 4) * i;
      const gy = y + (height / 4) * i;
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + height);
      ctx.moveTo(x, gy);
      ctx.lineTo(x + width, gy);
    }
    ctx.stroke();

    if (xMin < 0 && xMax > 0) {
      const axisX = toCanvasX(0);
      ctx.strokeStyle = "#98a2b3";
      ctx.beginPath();
      ctx.moveTo(axisX, y);
      ctx.lineTo(axisX, y + height);
      ctx.stroke();
    }

    if (yMin < 0 && yMax > 0) {
      const axisY = toCanvasY(0);
      ctx.strokeStyle = "#98a2b3";
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x + width, axisY);
      ctx.stroke();
    }

    curves.forEach((curve) => {
      const expression = String(curve && curve.expression || "").trim();
      if (!expression) return;

      ctx.beginPath();
      ctx.strokeStyle = String(curve.color || "#2563eb");
      ctx.lineWidth = resolveLabNumber(curve.line_width, values, extraValues, 2);

      for (let i = 0; i <= samples; i += 1) {
        const currentX = xMin + ((xMax - xMin) * i) / samples;
        const currentY = evaluateLabExpression(expression, values, Object.assign({}, extraValues, { x: currentX }));
        const px = toCanvasX(currentX);
        const py = toCanvasY(currentY);

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }

      ctx.stroke();
    });

    if (element.label) {
      ctx.fillStyle = "#475467";
      ctx.font = "700 12px \"Segoe UI\", \"Microsoft YaHei\", sans-serif";
      ctx.fillText(resolveLabText(element.label, values, extraValues), x, y - 8);
    }
  }

  function drawCanvasSceneElement(ctx, element, values, extraValues, sceneIndex, canvas) {
    if (!element || typeof element !== "object") return;

    const type = String(element.type || "").trim();
    const fill = String(element.fill || element.color || "#2563eb");
    const stroke = String(element.stroke || "#111827");
    const lineWidth = resolveLabNumber(element.line_width, values, extraValues, 2);
    ctx.lineWidth = lineWidth;

    if (type === "rect") {
      const x = resolveLabNumber(element.x, values, extraValues, 0);
      const y = resolveLabNumber(element.y, values, extraValues, 0);
      const width = resolveLabNumber(element.width, values, extraValues, 80);
      const height = resolveLabNumber(element.height, values, extraValues, 60);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;

      if (element.fill !== false) {
        ctx.fillRect(x, y, width, height);
      }

      if (element.stroke !== false) {
        ctx.strokeRect(x, y, width, height);
      }
      return;
    }

    if (type === "circle") {
      const x = resolveLabNumber(element.x, values, extraValues, 0);
      const y = resolveLabNumber(element.y, values, extraValues, 0);
      const radius = resolveLabNumber(element.radius, values, extraValues, 12);
      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);

      if (element.fill !== false) {
        ctx.fill();
      }

      if (element.stroke) {
        ctx.stroke();
      }
      return;
    }

    if (type === "line" || type === "arrow") {
      const x1 = resolveLabNumber(element.x1, values, extraValues, 0);
      const y1 = resolveLabNumber(element.y1, values, extraValues, 0);
      const x2 = resolveLabNumber(element.x2, values, extraValues, 100);
      const y2 = resolveLabNumber(element.y2, values, extraValues, 100);
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (type === "arrow") {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = resolveLabNumber(element.head_size, values, extraValues, 10);
        ctx.beginPath();
        ctx.fillStyle = stroke;
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    if (type === "text") {
      const x = resolveLabNumber(element.x, values, extraValues, 0);
      const y = resolveLabNumber(element.y, values, extraValues, 0);
      const size = resolveLabNumber(element.size, values, extraValues, 14);
      const weight = String(element.weight || "700");
      ctx.fillStyle = fill;
      ctx.font = `${weight} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillText(resolveLabText(element.text || "", values, extraValues), x, y);
      return;
    }

    if (type === "graph") {
      drawCanvasSceneGraph(ctx, element, values, extraValues);
      return;
    }

    if (type === "plot") {
      drawCanvasScenePlot(ctx, element, values, extraValues);
      return;
    }

    if (type === "particle_field") {
      const bounds = element.bounds && typeof element.bounds === "object" ? element.bounds : {};
      const x = resolveLabNumber(bounds.x, values, extraValues, 0);
      const y = resolveLabNumber(bounds.y, values, extraValues, 0);
      const width = resolveLabNumber(bounds.width, values, extraValues, 100);
      const height = resolveLabNumber(bounds.height, values, extraValues, 100);
      const radius = resolveLabNumber(element.radius, values, extraValues, 3);
      const count = Math.max(1, Math.min(140, Math.round(resolveLabNumber(element.count, values, extraValues, 24))));
      const speed = Math.max(0, resolveLabNumber(element.speed, values, extraValues, 0.2));
      const key = `scene_${sceneIndex}_${count}`;

      if (!canvas._nxlSceneParticleMap) {
        canvas._nxlSceneParticleMap = {};
      }

      if (!canvas._nxlSceneParticleMap[key]) {
        canvas._nxlSceneParticleMap[key] = Array.from({ length: count }, (_item, idx) => {
            const seed = (idx + 1) * 6151;
            return {
              x: ((seed * 17) % 1000) / 1000,
              y: ((seed * 31) % 1000) / 1000,
              vx: (((seed * 43) % 200) - 100) / 100,
              vy: (((seed * 59) % 200) - 100) / 100,
            };
          });
      }

      ctx.fillStyle = fill;
      canvas._nxlSceneParticleMap[key].forEach((particle) => {
        const px = x + radius + pingPongUnit(particle.x + particle.vx * speed * extraValues.t) * Math.max(1, width - radius * 2);
        const py = y + radius + pingPongUnit(particle.y + particle.vy * speed * extraValues.t) * Math.max(1, height - radius * 2);
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawCanvasSceneLab(canvas, config, values, timeMs) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = resizeLabCanvas(canvas);
    const sceneData = getCanvasSceneSize(config);
    const sceneWidth = sceneData.width;
    const sceneHeight = sceneData.height;
    const scaleX = size.width / sceneWidth;
    const scaleY = size.height / sceneHeight;
    const scene = sceneData.scene;
    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const extraValues = {
      t: Number(timeMs || 0) / 1000,
      W: sceneWidth,
      H: sceneHeight,
    };

    ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = String(scene.background || "#f8fafc");
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.scale(scaleX, scaleY);

    elements.forEach((element, index) => {
      drawCanvasSceneElement(ctx, element, values, extraValues, index, canvas);
    });

    ctx.restore();
  }

  function drawIdealGasLab(canvas, config, values, timeMs) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = resizeLabCanvas(canvas);
    ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const volumeParam = parameters.find((param) => String(param && param.key || "") === "V") || {};
    const minV = Number(volumeParam.min);
    const maxV = Number(volumeParam.max);
    const currentV = Number(values.V);
    const volumeRatio = Number.isFinite(minV) && Number.isFinite(maxV) && maxV > minV
        ? Math.max(0, Math.min(1, (currentV - minV) / (maxV - minV)))
        : 0.5;
    const boxScale = 0.42 + Math.sqrt(volumeRatio) * 0.48;
    const boxWidth = Math.floor(size.width * boxScale);
    const boxHeight = Math.floor(size.height * boxScale);
    const boxX = Math.floor((size.width - boxWidth) / 2);
    const boxY = Math.floor((size.height - boxHeight) / 2);
    const moleculeCount = Math.max(12, Math.min(90, Math.round((Number(values.n) || 1) * 20)));
    const temperature = Math.max(1, Number(values.T) || 273);
    const speed = 0.00018 * Math.sqrt(temperature);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    if (!Array.isArray(canvas._nxlLabParticles) || canvas._nxlLabParticles.length !== moleculeCount) {
        canvas._nxlLabParticles = Array.from({ length: moleculeCount }, (_item, idx) => {
            const seed = (idx + 1) * 9301;
            return {
                x: ((seed * 17) % 1000) / 1000,
                y: ((seed * 31) % 1000) / 1000,
                vx: (((seed * 43) % 200) - 100) / 100,
                vy: (((seed * 59) % 200) - 100) / 100,
            };
        });
    }

    canvas._nxlLabParticles.forEach((particle, idx) => {
        const drift = timeMs * speed;
        const radius = 3.2;
        const x = boxX + radius + pingPongUnit(particle.x + particle.vx * drift) * Math.max(1, boxWidth - radius * 2);
        const y = boxY + radius + pingPongUnit(particle.y + particle.vy * drift) * Math.max(1, boxHeight - radius * 2);
        ctx.beginPath();
        ctx.fillStyle = idx % 3 === 0 ? "#ef4444" : "#2563eb";
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    });
  }

  function bindFormulaSimulationLab(node) {
    const config = decodeLearningLabConfig(node);
    const canvas = node.querySelector("[data-lab-canvas]");
    const resultNode = node.querySelector("[data-lab-result]");
    let values = getFormulaLabValues(node, config);
    let stopped = false;
    let frameId = 0;

    const render = () => {
        values = getFormulaLabValues(node, config);
        syncFormulaLabLabels(node, config, values);

        try {
            const result = calculateFormulaLabResult(config, values);
            if (resultNode) {
                const valueText = Number(result.value).toFixed(2).replace(/\.00$/, "");
                resultNode.textContent = `${result.label} = ${valueText}${result.unit ? ` ${result.unit}` : ""}`;
            }
        } catch (err) {
            if (resultNode) {
                resultNode.textContent = String(err && err.message || "实验计算失败");
            }
        }
    };

    const animate = (timeMs) => {
        if (stopped) return;
        if (canvas instanceof HTMLCanvasElement) {
            drawIdealGasLab(canvas, config, values, timeMs);
        }
        frameId = window.requestAnimationFrame(animate);
    };

    node.querySelectorAll("[data-lab-param]").forEach((input) => {
        input.addEventListener("input", render);
    });

    render();
    frameId = window.requestAnimationFrame(animate);
    state.lpLabCleanups.push(() => {
        stopped = true;
        if (frameId) {
            window.cancelAnimationFrame(frameId);
        }
    });
  }

  function bindCanvasSceneLab(node) {
    const config = decodeLearningLabConfig(node);
    const canvas = node.querySelector("[data-lab-canvas]");
    const resultNode = node.querySelector("[data-lab-result]");
    let values = getFormulaLabValues(node, config);
    let stopped = false;
    let frameId = 0;

    const render = () => {
      values = getFormulaLabValues(node, config);
      syncFormulaLabLabels(node, config, values);

      if (resultNode) {
        const resultTemplate = String(config.result_template || "").trim();
        const summary = Array.isArray(config.parameters)
          ? config.parameters.map((param) => {
              const key = String(param && param.key || "").trim();
              const unit = String(param && param.unit || "").trim();
              return key && Object.prototype.hasOwnProperty.call(values, key)
                ? `${key}=${values[key]}${unit ? unit : ""}`
                : "";
            }).filter(Boolean).join(" · ")
          : "";
        resultNode.textContent = resultTemplate
          ? resolveLabText(resultTemplate, values, {})
          : (summary || "场景已渲染");
      }
    };

    const animate = (timeMs) => {
      if (stopped) return;

      if (canvas instanceof HTMLCanvasElement) {
        drawCanvasSceneLab(canvas, config, values, timeMs);
      }

      frameId = window.requestAnimationFrame(animate);
    };

    node.querySelectorAll("[data-lab-param]").forEach((input) => {
      input.addEventListener("input", render);
    });

    render();
    frameId = window.requestAnimationFrame(animate);
    state.lpLabCleanups.push(() => {
      stopped = true;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    });
  }

  function bindStepFlowLab(node) {
    const config = decodeLearningLabConfig(node);
    const steps = Array.isArray(config.steps) ? config.steps : [];
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const activeKey = String(config.active_parameter || "").trim();
    const parameter = parameters.find((item) => String(item && item.key || "").trim() === activeKey) || {};
    const input = findLearningLabDataNode(node, "data-lab-param", activeKey);
    const resultNode = node.querySelector("[data-lab-result]");
    const progressBar = node.querySelector("[data-step-flow-progress-bar]");
    const progressLabel = node.querySelector("[data-step-flow-progress-label]");
    const detailTag = node.querySelector("[data-step-flow-detail-tag]");
    const detailTitle = node.querySelector("[data-step-flow-detail-title]");
    const detailText = node.querySelector("[data-step-flow-detail-text]");
    const stepNodes = Array.from(node.querySelectorAll("[data-step-flow-index]"));
    const minimum = Number(parameter.min);
    const maximum = Number(parameter.max);
    const stepSize = Number(parameter.step);

    const getCompletedCount = (value) => {
      const range = Math.max(0.000001, maximum - minimum);
      const ratio = Math.max(0, Math.min(1, (value - minimum) / range));

      return Math.max(0, Math.min(steps.length, Math.round(ratio * steps.length)));
    };

    const render = () => {
      const values = getFormulaLabValues(node, config);
      const currentValue = Number(values[activeKey]);
      const completedCount = getCompletedCount(Number.isFinite(currentValue) ? currentValue : minimum);
      const allCompleted = completedCount >= steps.length;
      const focusIndex = Math.max(0, Math.min(steps.length - 1, allCompleted ? steps.length - 1 : completedCount));
      const focusStep = steps[focusIndex] || {};
      const percent = steps.length ? (completedCount / steps.length) * 100 : 0;

      syncFormulaLabLabels(node, config, values);

      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      }

      if (progressLabel) {
        progressLabel.textContent = `${completedCount} / ${steps.length} 已完成`;
      }

      stepNodes.forEach((stepNode, index) => {
        const completed = index < completedCount || allCompleted;
        const current = !allCompleted && index === focusIndex;
        const stateNode = stepNode.querySelector("[data-step-flow-state]");
        stepNode.classList.toggle("is-completed", completed);
        stepNode.classList.toggle("is-current", current);
        stepNode.classList.toggle("is-upcoming", !completed && !current);
        stepNode.setAttribute("aria-pressed", index === focusIndex ? "true" : "false");

        if (stateNode) {
          stateNode.textContent = completed ? "已完成" : (current ? "当前" : "待开始");
        }
      });

      if (detailTag) {
        detailTag.textContent = allCompleted
          ? "流程完成"
          : String(focusStep.tag || `阶段 ${focusIndex + 1}`);
      }

      if (detailTitle) {
        detailTitle.textContent = String(focusStep.title || "当前阶段");
      }

      if (detailText) {
        detailText.textContent = String(focusStep.detail || focusStep.summary || "");
      }

      if (resultNode) {
        const resultTemplate = String(config.result_template || "").trim();
        resultNode.textContent = resultTemplate
          ? resolveLabText(resultTemplate, values, {})
          : (allCompleted ? "全部阶段已完成" : `当前查看：${String(focusStep.title || "当前阶段")}`);
      }
    };

    if (input instanceof HTMLInputElement) {
      input.addEventListener("input", render);
    }

    stepNodes.forEach((stepNode, index) => {
      stepNode.addEventListener("click", () => {
        if (!(input instanceof HTMLInputElement)) return;

        const range = Math.max(0, maximum - minimum);
        const target = minimum + (range * index) / Math.max(1, steps.length);
        const snapped = Number.isFinite(stepSize) && stepSize > 0
          ? minimum + Math.round((target - minimum) / stepSize) * stepSize
          : target;
        input.value = String(Math.max(minimum, Math.min(maximum, snapped)));
        render();
      });
    });

    render();
  }

  function bindSandboxComponentLab(node) {
    const config = decodeLearningLabConfig(node);
    const frame = node.querySelector("[data-sandbox-frame]");
    const resultNode = node.querySelector("[data-lab-result]");

    if (!(frame instanceof HTMLIFrameElement)) {
      return;
    }

    let values = getFormulaLabValues(node, config);

    const setResult = (text) => {
      if (resultNode) {
        resultNode.textContent = String(text || "");
      }
    };

    const postParams = () => {
      if (!frame.contentWindow) {
        return;
      }

      frame.contentWindow.postMessage({
        source: "nxl-sandbox-parent",
        type: "params",
        params: values,
      }, "*");
    };

    const sync = () => {
      values = getFormulaLabValues(node, config);
      syncFormulaLabLabels(node, config, values);
      postParams();
    };

    const handleMessage = (event) => {
      if (event.source !== frame.contentWindow) {
        return;
      }

      const data = event && event.data ? event.data : {};

      if (!data || data.source !== "nxl-sandbox-component") {
        return;
      }

      const detail = data.detail && typeof data.detail === "object" ? data.detail : {};

      if (data.type === "ready") {
        setResult("沙箱组件已渲染");
        postParams();
        return;
      }

      if (data.type === "status") {
        setResult(detail.text || "沙箱组件已更新");
        return;
      }

      if (data.type === "height") {
        const height = Math.max(260, Math.min(720, Number(detail.height) || 320));
        frame.style.height = `${height}px`;
        return;
      }

      if (data.type === "error") {
        setResult(`沙箱组件错误：${detail.message || "未知错误"}`);
      }
    };

    window.addEventListener("message", handleMessage);
    frame.addEventListener("load", postParams);
    node.querySelectorAll("[data-lab-param]").forEach((input) => {
      input.addEventListener("input", sync);
    });

    syncFormulaLabLabels(node, config, values);
    setResult("沙箱组件加载中");
    frame.srcdoc = buildSandboxComponentSrcdoc(config, values);

    state.lpLabCleanups.push(() => {
      window.removeEventListener("message", handleMessage);
      frame.removeEventListener("load", postParams);
      frame.removeAttribute("srcdoc");
    });
  }

  function renderTraceStep(node, config, index) {
    const steps = Array.isArray(config.steps) ? config.steps : [];
    const step = steps[Math.max(0, Math.min(index, steps.length - 1))] || {};
    const lineIndex = Number(step.line_index || 0);
    const varsNode = node.querySelector("[data-trace-vars]");
    const outputNode = node.querySelector("[data-trace-output]");

    node.querySelectorAll("[data-trace-line]").forEach((lineNode) => {
        const current = Number(lineNode.getAttribute("data-trace-line")) === lineIndex;
        lineNode.classList.toggle("is-active", current);
    });

    if (varsNode) {
        const variables = step.variables && typeof step.variables === "object" ? step.variables : {};
        const rows = Object.keys(variables).map((key) => `<span><strong>${escapeHtml(key)}</strong>${escapeHtml(String(variables[key]))}</span>`);
        varsNode.innerHTML = rows.length ? rows.join("") : "当前步骤没有变量变化";
    }

    if (outputNode) {
        const outputLines = [];

        steps.slice(0, index + 1).forEach((row) => {
            const output = String(row && row.output || "").trimEnd();
            if (output) {
                outputLines.push(output);
            }
        });

        outputNode.textContent = outputLines.join("\n");
    }
  }

  function bindCodeTraceLab(node) {
    const config = decodeLearningLabConfig(node);
    const steps = Array.isArray(config.steps) ? config.steps : [];
    let index = 0;
    let timer = 0;
    let running = false;
    const runBtn = node.querySelector('[data-trace-action="run"]');
    const resetBtn = node.querySelector('[data-trace-action="reset"]');

    const stop = () => {
        running = false;
        if (timer) {
            window.clearInterval(timer);
            timer = 0;
        }
        if (runBtn) {
            runBtn.textContent = "运行";
        }
    };

    const tick = () => {
        renderTraceStep(node, config, index);
        index += 1;

        if (index >= steps.length) {
            stop();
        }
    };

    if (runBtn) {
        runBtn.addEventListener("click", () => {
            if (running) {
                stop();
                return;
            }

            running = true;
            runBtn.textContent = "暂停";
            tick();
            timer = window.setInterval(tick, 700);
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            stop();
            index = 0;
            renderTraceStep(node, config, index);
        });
    }

    renderTraceStep(node, config, index);
    state.lpLabCleanups.push(stop);
  }

  // 章节正文渲染完成后统一绑定实验组件，便于切换章节时清理动画和定时器。
  function bindLearningArticleExperiments(root) {
    if (!root) return;

    root.querySelectorAll(".lp-lab-formula").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindFormulaSimulationLab(node);
    });

    root.querySelectorAll(".lp-lab-canvas-scene").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindCanvasSceneLab(node);
    });

    root.querySelectorAll(".lp-lab-step-flow").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindStepFlowLab(node);
    });

    root.querySelectorAll(".lp-lab-chart-experiment").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindChartExperimentLab(node);
    });

    root.querySelectorAll(".lp-lab-code-trace").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindCodeTraceLab(node);
    });

    root.querySelectorAll(".lp-lab-sandbox").forEach((node) => {
        if (node.dataset.labBound === "1") return;
        node.dataset.labBound = "1";
        bindSandboxComponentLab(node);
    });
  }

  function renderLearningLabPending(stateName) {
    const isInvalid = stateName === "invalid";
    const title = isInvalid ? "互动实验未启用" : "互动实验正在校验";
    const description = isInvalid
      ? "本次生成结果未保存，实验配置不会执行。重新生成并通过校验后即可使用。"
      : "画布和交互会在文章通过校验并保存后启用。";

    return `
      <section class="lp-lab lp-lab-pending ${isInvalid ? "is-invalid" : ""}">
        <div class="lp-lab-pending-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5M12 16h.01"></path>
          </svg>
        </div>
        <div>
          <h3>${title}</h3>
          <p>${description}</p>
        </div>
      </section>
    `;
  }

  function renderMarkdownSimple(text, options) {
    const opts = options && typeof options === "object" ? options : {};
    const labState = String(opts.labState || "").trim();
    const source = stripLearningPathContentMarker(text).replace(/\r\n?/g, "\n");
    if (!source.trim()) return "";

    const lines = source.split("\n");
    const html = [];
    let paragraphLines = [];
    let quoteLines = [];
    let listTag = "";
    let listItems = [];
    let codeFenceOpen = false;
    let codeFenceLang = "";
    let codeFenceLines = [];
    let labBlockIndex = 0;

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

    const flushCodeFence = () => {
      if (!codeFenceLang && !codeFenceLines.length) return;

      const lang = String(codeFenceLang || "").trim().toLowerCase();
      const body = codeFenceLines.join("\n");

      if (lang === "nxl-lab") {
        html.push(labState
          ? renderLearningLabPending(labState)
          : renderLearningLabBlock(body, labBlockIndex));
        labBlockIndex += 1;
      } else {
        const langLabel = lang ? `<span>${escapeHtml(lang)}</span>` : "";
        html.push(`<pre class="lp-markdown-code">${langLabel}<code>${escapeHtml(body)}</code></pre>`);
      }

      codeFenceOpen = false;
      codeFenceLang = "";
      codeFenceLines = [];
    };

    lines.forEach((line) => {
      const rawLine = String(line || "");
      const trimmed = rawLine.trim();
      const fenceMatch = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);

      if (codeFenceOpen) {
        if (fenceMatch) {
          flushCodeFence();
          return;
        }

        codeFenceLines.push(rawLine);
        return;
      }

      if (fenceMatch) {
        flushParagraph();
        flushQuote();
        flushList();
        codeFenceOpen = true;
        codeFenceLang = String(fenceMatch[1] || "");
        codeFenceLines = [];
        return;
      }

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
    flushCodeFence();

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
    if (el.questionPracticeView) {
      el.questionPracticeView.classList.toggle("is-active", name === "questionPractice");
    }
    if (el.learningResourceStudioView) {
      el.learningResourceStudioView.classList.toggle("is-active", name === "resourceStudio");
    }
    if (el.learningVideoStudioView) {
      el.learningVideoStudioView.classList.toggle("is-active", name === "videoStudio");
    }
    if (el.learningResourceReviewView) {
      el.learningResourceReviewView.classList.toggle("is-active", name === "resourceReview");
    }
    if (el.learningResourceReaderView) {
      el.learningResourceReaderView.classList.toggle("is-active", name === "resourceReader");
    }
    el.materialsView.classList.toggle("is-active", name === "materials");
    el.uploadView.classList.toggle("is-active", name === "upload");
    el.settingsView.classList.toggle("is-active", name === "settings");
    el.learningPathView.classList.toggle("is-active", name === "learningPath");
    if (name !== "settings") {
      stopSettingsPolling();
    } else {
      startSettingsPolling();
    }
    const resourceReaderActive = name === "resourceReader";
    if (resourceReaderActive) {
      notifyHostLayout("immersive", { hideInputDock: true });
      notifyHostReaderState(true);
    } else if (!state.isReaderOpen) {
      notifyHostLayout("default", { hideInputDock: true });
      notifyHostReaderState(false);
    }
    notifyHostInputVisibility(true);
  }

  function notifyHostReaderState(opened, extra) {
    emitHostPayload("nexora:reader:state", {
      opened: !!opened,
      ...(extra && typeof extra === "object" ? extra : {}),
    });
  }

