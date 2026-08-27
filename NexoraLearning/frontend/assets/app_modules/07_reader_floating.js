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
    requestKey: "",
    streamDraft: "",
    streamStatus: "",
    streamRenderFrame: 0,
    currentChapter: "",
    currentSession: "",
    currentMeta: null,
    questions: [],
    answers: {},
    error: null,
  };

  function normalizeQuizQuestionOptions(value) {
    const rawItems = Array.isArray(value)
      ? value
      : String(value || "").split(/\r?\n/);

    return rawItems.map((item) => {
      const text = item && typeof item === "object"
        ? String(item.text || item.content || item.value || item.title || "").trim()
        : String(item || "").trim();

      return text.replace(/^[A-Da-d][.、)\s]+/, "").trim();
    }).filter(Boolean).slice(0, 4);
  }

  function getQuizRawOptions(question) {
    if (!question || typeof question !== "object") return [];

    if (Array.isArray(question.options) && question.options.length) return question.options;

    if (!Array.isArray(question.options) && String(question.options || "").trim()) return question.options;

    return question.question_options || [];
  }

  function normalizeQuizQuestion(rawQuestion) {
    if (!rawQuestion || typeof rawQuestion !== "object") return null;

    const title = String(rawQuestion.title || rawQuestion.question_title || rawQuestion.question || "").trim();
    const content = String(rawQuestion.content || rawQuestion.question_content || "").trim();
    const answer = String(rawQuestion.answer || rawQuestion.question_answer || rawQuestion.reference_answer || "").trim();
    const options = normalizeQuizQuestionOptions(getQuizRawOptions(rawQuestion));
    const rawType = String(rawQuestion.type || rawQuestion.question_type || "").trim().toLowerCase();
    const type = (["choice", "single_choice", "multiple_choice", "选择题", "单选题"].includes(rawType) && options.length >= 2) || options.length >= 2
      ? "choice"
      : "text";
    const normalizedTitle = title || content;
    const normalizedContent = content || title;

    if (!normalizedTitle || !normalizedContent || !answer) return null;

    return {
      title: normalizedTitle,
      difficulty: String(rawQuestion.difficulty || rawQuestion.question_difficulty || "").trim(),
      type,
      options: type === "choice" ? options : [],
      content: normalizedContent,
      hint: String(rawQuestion.hint || rawQuestion.question_hint || rawQuestion.question_reason || "").trim(),
      answer,
      source: String(rawQuestion.source || "").trim(),
      source_id: String(rawQuestion.source_id || rawQuestion.question_id || "").trim(),
    };
  }

  function normalizeQuizQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return [];

    return rawQuestions.map((question) => normalizeQuizQuestion(question)).filter(Boolean);
  }

  function setQuizQuestions(rawQuestions) {
    quizState.questions = normalizeQuizQuestions(rawQuestions);
    return quizState.questions;
  }

  function loadQuizState() {
    try {
      const raw = localStorage.getItem(QUIZ_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setQuizQuestions(parsed.questions);
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
        questions: normalizeQuizQuestions(quizState.questions),
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

  function getQuizRenderContainer() {
    const meta = quizState.currentMeta || {};

    if (String(meta.quizType || "") === "personalized_chapter") {
      return document.getElementById("learningPathChapterQuizBody");
    }

    return document.querySelector('.floating-tab-content[data-tab="quiz"]');
  }

  function getFloatingTabContent(tabName) {
    const resolvedTabName = String(tabName || floatingPanelState.activeTab || "").trim();

    if (resolvedTabName === "quiz") {
      return getQuizRenderContainer();
    }

    return document.querySelector(`.floating-tab-content[data-tab="${resolvedTabName}"]`);
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
      questions: normalizeQuizQuestions(questions),
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
    return normalizeQuizQuestionOptions(getQuizRawOptions(question));
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

  function readQuizStreamField(block, tagName) {
    const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)(?:</${tagName}>|$)`, "i");
    const match = pattern.exec(String(block || ""));

    return match ? String(match[1] || "").trim() : "";
  }

  function renderPersonalizedQuizStreamProgress() {
    const draft = String(quizState.streamDraft || "");
    const status = String(quizState.streamStatus || "正在准备本章测验").trim();
    const blocks = draft.split(/<QUESTION>/i).slice(1, 7);
    const previewHtml = blocks.map((block, index) => {
      const title = readQuizStreamField(block, "question_title");
      const content = readQuizStreamField(block, "question_content");
      const questionType = readQuizStreamField(block, "question_type").toLowerCase();
      const options = normalizeQuizQuestionOptions(readQuizStreamField(block, "question_options"));
      const typeLabel = questionType === "choice" ? "选择题" : questionType === "text" ? "文本题" : "生成中";
      const optionHtml = options.length
        ? `<div class="quiz-stream-options">${options.map((option) => `<span>${escapeHtml(option)}</span>`).join("")}</div>`
        : "";

      return `
        <article class="quiz-stream-question">
          <div class="quiz-stream-question-head">
            <span>题目 ${index + 1}</span>
            <span>${escapeHtml(typeLabel)}</span>
          </div>
          <strong>${escapeHtml(title || `正在生成第 ${index + 1} 题`)}</strong>
          ${content && content !== title ? `<p>${escapeHtml(content)}</p>` : ""}
          ${optionHtml}
        </article>
      `;
    }).join("");

    return `
      <div class="quiz-stream-progress" aria-live="polite">
        <div class="quiz-stream-status">
          <span class="quiz-loading-spinner"></span>
          <div>
            <strong>${escapeHtml(status)}</strong>
            <span>${blocks.length ? `已接收 ${blocks.length}/6 道题` : "等待模型开始输出题目"}</span>
          </div>
        </div>
        <div class="quiz-stream-questions">
          ${previewHtml || '<div class="quiz-stream-placeholder">模型输出将在这里实时展开</div>'}
        </div>
      </div>
    `;
  }

  function renderQuizPanel() {
    const content = getQuizRenderContainer();
    if (!content) return;

    if (quizState.loading) {
      const meta = quizState.currentMeta || {};

      if (String(meta.quizType || "") === "personalized_chapter") {
        content.innerHTML = renderPersonalizedQuizStreamProgress();
        return;
      }

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
          <div class="quiz-error-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 17h.01"></path></svg>
          </div>
          <div class="quiz-error-text">${escapeHtml(quizState.error)}</div>
          <button class="quiz-retry-btn" onclick="retryQuiz()">重试</button>
        </div>
      `;
      return;
    }

    setQuizQuestions(quizState.questions);

    if (!quizState.questions || quizState.questions.length === 0) {
      content.innerHTML = `
        <div class="floating-empty-hint">
          <div class="quiz-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M9 11h6M9 15h4M8 3h8l3 3v15H5V3h3M16 3v4h4"></path></svg>
          </div>
          <div>本章暂时没有可用的测验题目</div>
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
      normalizeQuizQuestions(quizState.questions).length
    ) {
      setQuizQuestions(quizState.questions);
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

      const normalizedQuestions = normalizeQuizQuestions(questions);

      if (!quizId || !normalizedQuestions.length) {
        throw new Error("章节小测没有返回有效题目");
      }

      setQuizQuestions(normalizedQuestions);
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
      const storedQuestions = normalizeQuizQuestions(stored.questions);

      if (!storedQuestions.length) {
        delete storedQuizzes[quizKey];
        localStorage.setItem("nxl_quiz_generated_v1", JSON.stringify(storedQuizzes));
      } else {
        setQuizQuestions(storedQuestions);
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
        const resultQuestions = normalizeQuizQuestions(result.questions);

        if (!resultQuestions.length) {
          quizState.error = "生成题目返回了无效结构";
        } else {
          setQuizQuestions(resultQuestions);
          writeStoredQuiz(quizKey, quizState.questions, {}, quizState.currentMeta);
        }
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
      // 走统一的取文helper：优先用已缓存的章节正文，再回退到全书纯文本，
      // 避免直接对 readerFullTextRaw 切片（该字段在按章加载时可能尚未填充）。
      const chapterContext = getReaderChapterContext(chapterIndex);
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

  function closeReader(isUnload, options) {
    const closeOptions = (options && typeof options === "object") ? options : {};
    const readerStateMeta = {};
    const closeReason = String(closeOptions.closeReason || closeOptions.reason || "").trim();
    const closeTarget = String(closeOptions.closeTarget || closeOptions.target || "").trim();

    if (closeReason) {
      readerStateMeta.close_reason = closeReason;
    }

    if (closeTarget) {
      readerStateMeta.close_target = closeTarget;
    }

    resetReaderSelectionTelemetry();
    flushReaderPosition();
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
    state.readerBookInfoXml = "";
    state.readerBookDetailXml = "";
    state.readerViewMode = "closed";
    state.readerMeta = { title: "", subtitle: "" };
    state.readerReportedChapterKey = "";
    state.readerReportingChapterKey = "";
    state.readerChapterQuizLoadingKey = "";
    state.readerSectionsData = {};
    state.readerAnnotations = [];
    state.readerChapterCache = {};
    state.readerChapterPayloads = {};
    state.readerBookIndex = null;
    state.readerCoordinateSpace = "plain";
    state.readerGuidePromptedKey = "";
    state.readerPendingRestorePosition = null;
    readerGuideState = { status: "empty", target: null, guide: null, error: "", draft: "" };
    renderReaderGuidePanel();
    syncFloatingBtnVisibility();
    syncReaderModeUI();
    el.readerPane.hidden = true;
    syncMaterialsPageMode();
    notifyHostLayout("default", { hideInputDock: true });
    notifyHostReaderState(false, readerStateMeta);
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

