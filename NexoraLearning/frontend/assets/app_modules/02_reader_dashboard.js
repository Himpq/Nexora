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

  function trimReaderContextText(value, maxLen) {
    const text = String(value || "").trim();
    const limit = Math.max(0, Number(maxLen) || 0);
    if (!text || !limit || text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}\n\n[content_truncated original_length=${text.length} limit=${limit}]`;
  }

  function buildReaderContextPayload() {
    const windowText = collectReaderVisibleText(2800);
    if (!windowText) return null;
    const row = getSelectedLectureRow();
    const lecture = row ? (row.lecture || {}) : {};
    const books = row && Array.isArray(row.books) ? row.books : [];
    const book = books.find((item) => String((item && item.id) || "") === String(state.selectedBookId || "")) || {};
    const chapterMeta = getReaderCurrentChapterMeta();
    return {
      lecture_id: String(state.selectedLectureId || "").trim(),
      lecture_title: getLectureTitle(lecture),
      book_id: String(state.selectedBookId || "").trim(),
      book_title: String(book.title || book.name || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      reader_title: String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      reader_subtitle: String(state.readerMeta && state.readerMeta.subtitle ? state.readerMeta.subtitle : "").trim(),
      book_info_xml: trimReaderContextText(state.readerBookInfoXml || (state.catalogContext && state.catalogContext.infoXml), 20000),
      book_detail_xml: trimReaderContextText(state.readerBookDetailXml || (state.catalogContext && state.catalogContext.detailXml), 24000),
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

  function getQuestionBankLectureTitle(lectureId) {
    const targetId = String(lectureId || "").trim();
    const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const row = rows.find((item) => String((item && item.lecture && item.lecture.id) || "").trim() === targetId);
    return row ? getLectureTitle(row.lecture || {}) : (targetId || "未关联课程");
  }

  function normalizeQuestionBankOptions(rawOptions) {
    const options = Array.isArray(rawOptions)
      ? rawOptions
      : String(rawOptions || "").split(/\r?\n/).filter(Boolean);
    return options.map((option, optionIndex) => {
      const fallbackLabel = String.fromCharCode(65 + optionIndex);
      let label = "";
      let text = "";
      if (option && typeof option === "object") {
        label = String(option.id || option.label || option.key || option.option_id || "").trim();
        text = String(option.text || option.content || option.value || option.title || "").trim();
      } else {
        text = String(option || "").trim();
      }
      const match = text.match(/^\s*([a-zA-Z])\s*[.、:：)]\s*(.+)$/);
      if (match) {
        if (!label) label = match[1];
        text = match[2].trim();
      }
      label = (label || fallbackLabel).slice(0, 3).toUpperCase();
      text = text || String(option || "").trim();
      return {
        label,
        text,
        value: text ? `${label}. ${text}` : label,
      };
    }).filter((option) => option.text || option.label);
  }

  function getQuestionBankQuestion(item) {
    const raw = item && typeof item === "object" ? item : {};
    const question = raw.question && typeof raw.question === "object" ? raw.question : {};
    const rawOptions = Array.isArray(question.options)
      ? question.options
      : Array.isArray(question.question_options)
        ? question.question_options
        : Array.isArray(raw.question_options)
          ? raw.question_options
          : Array.isArray(raw.options)
            ? raw.options
            : (question.question_options || raw.question_options || raw.options || []);
    return {
      title: String(question.question_title || question.title || question.question || raw.question_title || raw.title || "").trim(),
      content: String(question.question_content || question.content || raw.question_content || raw.content || "").trim(),
      answer: String(question.question_answer || question.answer || raw.reference_answer || "").trim(),
      hint: String(question.question_hint || question.hint || raw.question_hint || "").trim(),
      difficulty: String(question.question_difficulty || question.difficulty || raw.question_difficulty || "").trim(),
      type: String(question.question_type || question.type || raw.question_type || raw.type || "").trim(),
      options: normalizeQuestionBankOptions(rawOptions),
    };
  }

  function getQuestionBankTypeLabel(item) {
    const question = getQuestionBankQuestion(item);
    const type = question.type.toLowerCase();
    if (["choice", "single_choice", "选择题", "单选题"].includes(type)) return "选择题";
    if (["multiple_choice", "多选题"].includes(type)) return "多选题";
    if (["true_false", "判断题"].includes(type)) return "判断题";
    if (["code", "practice", "实践题", "代码题"].includes(type)) return "实践题";
    if (question.options.length >= 2) return "选择题";
    return "简答题";
  }

  function isQuestionBankMultipleChoice(question) {
    const type = String(question && question.type || "").trim().toLowerCase();
    return ["multiple_choice", "multi_choice", "多选题"].includes(type);
  }

  function isQuestionBankOptionSelected(savedAnswer, option, label) {
    const answer = String(savedAnswer || "").trim();
    if (!answer) return false;
    const optionLabel = String(label || option && option.label || "").trim();
    const optionText = String(option && option.text || "").trim();
    const optionValue = String(option && option.value || "").trim();
    if (answer === optionValue || answer === optionText || answer === optionLabel) return true;
    if (optionLabel && answer.startsWith(`${optionLabel}.`)) return true;
    if (optionLabel && new RegExp(`(^|[\\s,，、;；])${optionLabel}(?=\\s|[.,，、;；]|$)`, "i").test(answer)) return true;
    return !!(optionText && answer.includes(optionText));
  }

  function joinQuestionBankChoiceAnswers(values) {
    return values.map((value) => String(value || "").trim()).filter(Boolean).join("；");
  }

  function getQuestionBankAnswerState(item) {
    const stateValue = String(item && item.answer_state || "").trim();
    if (stateValue) return stateValue;
    return item && item.latest_completion ? "submitted" : "pending";
  }

  function getQuestionBankAnswerStateLabel(answerState) {
    const value = String(answerState || "").trim();
    if (value === "needs_review") return "待复盘";
    if (value === "submitted") return "已作答";
    return "未作答";
  }

  function getQuestionBankFilteredItems() {
    return Array.isArray(state.questionBankItems) ? state.questionBankItems : [];
  }

  function renderQuestionBankFilters() {
    const lectureRows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const lectureIds = Array.from(new Set(
      lectureRows
        .map((row) => String((row && row.lecture && row.lecture.id) || "").trim())
        .filter(Boolean)
    ));
    const typeLabels = ["选择题", "多选题", "判断题", "简答题", "实践题"];
    const lectureOptions = [
      `<option value="all">全部课程</option>`,
      ...lectureIds.map((lectureId) => `<option value="${escapeHtml(lectureId)}" ${state.questionBankFilter.lectureId === lectureId ? "selected" : ""}>${escapeHtml(getQuestionBankLectureTitle(lectureId))}</option>`),
    ].join("");
    const typeOptions = [
      `<option value="all">全部题型</option>`,
      ...typeLabels.map((typeLabel) => `<option value="${escapeHtml(typeLabel)}" ${state.questionBankFilter.questionType === typeLabel ? "selected" : ""}>${escapeHtml(typeLabel)}</option>`),
    ].join("");

    return `
      <div class="question-bank-filters">
        <select class="question-bank-select" data-qb-filter="lectureId" aria-label="按课程筛选">${lectureOptions}</select>
        <select class="question-bank-select" data-qb-filter="answerState" aria-label="按作答状态筛选">
          <option value="all">全部状态</option>
          <option value="pending" ${state.questionBankFilter.answerState === "pending" ? "selected" : ""}>未作答</option>
          <option value="submitted" ${state.questionBankFilter.answerState === "submitted" ? "selected" : ""}>已作答</option>
          <option value="needs_review" ${state.questionBankFilter.answerState === "needs_review" ? "selected" : ""}>待复盘</option>
        </select>
        <select class="question-bank-select" data-qb-filter="questionType" aria-label="按题型筛选">${typeOptions}</select>
      </div>
    `;
  }

  function findQuestionBankItem(questionId) {
    const targetId = String(questionId || "").trim();
    if (!targetId) return null;
    const selectedRows = Array.isArray(state.questionBankSelectedGroup && state.questionBankSelectedGroup.items)
      ? state.questionBankSelectedGroup.items
      : [];
    const selectedItem = selectedRows.find((item) => String((item && item.question_id) || "").trim() === targetId);
    if (selectedItem) return selectedItem;
    const rows = Array.isArray(state.questionBankItems) ? state.questionBankItems : [];
    return rows.find((item) => String((item && item.question_id) || "").trim() === targetId) || null;
  }

  function recomputeQuestionBankSummary() {
    const rows = Array.isArray(state.questionBankItems) ? state.questionBankItems : [];
    state.questionBankSummary = {
      total: rows.length,
      pending: rows.filter((item) => getQuestionBankAnswerState(item) === "pending").length,
      submitted: rows.filter((item) => getQuestionBankAnswerState(item) === "submitted").length,
      needs_review: rows.filter((item) => getQuestionBankAnswerState(item) === "needs_review").length,
    };
  }

  function closeQuestionBankPracticeModal() {
    const modal = document.getElementById("questionBankPracticeModal");
    if (modal) {
      modal.remove();
    }
  }

  function renderQuestionBankPracticeInput(item) {
    const question = getQuestionBankQuestion(item);
    const questionId = String((item && item.question_id) || "").trim();
    const latest = item && item.latest_completion && typeof item.latest_completion === "object" ? item.latest_completion : null;
    const savedAnswer = latest ? String(latest.student_answer || "") : "";
    if (question.options.length >= 2) {
      const multi = isQuestionBankMultipleChoice(question);
      return `
        <div class="question-bank-practice-options">
          ${question.options.map((option, optionIndex) => {
            const label = option.label || String.fromCharCode(65 + optionIndex);
            const value = option.value || `${label}. ${option.text || ""}`;
            const checked = isQuestionBankOptionSelected(savedAnswer, option, label);
            return `
              <label class="question-bank-practice-option">
                <input type="${multi ? "checkbox" : "radio"}" name="questionBankPracticeAnswer" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
                <span class="question-bank-practice-option-letter">${label}</span>
                <span class="question-bank-practice-option-text">${escapeHtml(option.text || value)}</span>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }

    return `
      <textarea
        id="questionBankPracticeAnswerInput"
        class="question-bank-practice-textarea"
        rows="6"
        data-question-id="${escapeHtml(questionId)}"
        placeholder="在这里写下你的作答">${escapeHtml(savedAnswer)}</textarea>
    `;
  }

  function renderQuestionBankPracticeModal(item, result) {
    const question = getQuestionBankQuestion(item);
    const questionId = String((item && item.question_id) || "").trim();
    const title = question.title || question.content || "题库练习";
    const content = question.content && question.content !== title ? question.content : "";
    const typeLabel = getQuestionBankTypeLabel(item);
    const latest = result && typeof result === "object"
      ? result
      : item && item.latest_completion && typeof item.latest_completion === "object"
        ? item.latest_completion
        : null;
    const studentAnswer = latest ? String(latest.student_answer || "") : "";
    const isCorrect = latest && Object.prototype.hasOwnProperty.call(latest, "is_correct") ? latest.is_correct : null;
    const resultLabel = isCorrect === true ? "自动判定正确" : (isCorrect === false ? "需要复盘" : (latest ? "已提交" : ""));
    const resultClass = isCorrect === true ? "is-correct" : (isCorrect === false ? "is-review" : "is-submitted");
    const meta = [
      typeLabel,
      question.difficulty || "综合",
      getQuestionBankLectureTitle(item && item.lecture_id),
      String((item && item.chapter_name) || "").trim(),
    ].filter(Boolean).join(" · ");

    const existing = document.getElementById("questionBankPracticeModal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "questionBankPracticeModal";
    modal.className = "question-bank-practice-modal";
    modal.innerHTML = `
      <div class="question-bank-practice-backdrop" data-qb-practice-action="close"></div>
      <section class="question-bank-practice-dialog" role="dialog" aria-modal="true" aria-label="题库作答">
        <header class="question-bank-practice-head">
          <div>
            <div class="question-bank-kicker">Question Practice</div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="question-bank-practice-close" type="button" data-qb-practice-action="close" aria-label="关闭">×</button>
        </header>
        <div class="question-bank-practice-body">
          <div class="question-bank-meta question-bank-practice-meta">
            ${meta ? meta.split(" · ").map((itemText) => `<span>${escapeHtml(itemText)}</span>`).join("") : ""}
          </div>
          ${content ? `<div class="question-bank-practice-content">${escapeHtml(content)}</div>` : ""}
          ${question.hint ? `<div class="question-bank-practice-hint">提示：${escapeHtml(question.hint)}</div>` : ""}
          ${renderQuestionBankPracticeInput(item)}
          ${latest ? `
            <section class="question-bank-practice-result ${resultClass}">
              <div class="question-bank-practice-result-label">${escapeHtml(resultLabel)}</div>
              <div class="question-bank-practice-result-row"><strong>你的作答</strong><span>${escapeHtml(studentAnswer || "未记录")}</span></div>
              ${question.answer ? `<div class="question-bank-practice-result-row"><strong>参考答案</strong><span>${escapeHtml(question.answer)}</span></div>` : ""}
            </section>
          ` : question.answer ? `
            <section class="question-bank-practice-reference" hidden>
              <strong>参考答案</strong>
              <span>${escapeHtml(question.answer)}</span>
            </section>
          ` : ""}
        </div>
        <footer class="question-bank-practice-foot">
          ${question.answer && !latest ? `<button class="question-bank-practice-secondary" type="button" data-qb-practice-action="toggle-reference">查看参考答案</button>` : ""}
          <button class="question-bank-practice-secondary" type="button" data-qb-practice-action="close">关闭</button>
          <button class="question-bank-practice-primary" type="button" data-qb-practice-action="submit" data-question-id="${escapeHtml(questionId)}">
            ${latest ? "重新提交" : "提交作答"}
          </button>
        </footer>
      </section>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector("#questionBankPracticeAnswerInput") || modal.querySelector("input[name='questionBankPracticeAnswer']");
    if (input) {
      setTimeout(() => input.focus(), 0);
    }
  }

  function openQuestionBankPractice(questionId) {
    const item = findQuestionBankItem(questionId);
    if (!item) {
      showToast("没有找到这道题");
      return;
    }
    renderQuestionBankPracticeModal(item);
  }

  function readQuestionBankPracticeAnswer(modal) {
    const checkedRows = Array.from(modal.querySelectorAll("input[name='questionBankPracticeAnswer']:checked"));
    if (checkedRows.length) return joinQuestionBankChoiceAnswers(checkedRows.map((item) => item.value));
    const input = modal.querySelector("#questionBankPracticeAnswerInput");
    return input ? String(input.value || "").trim() : "";
  }

  async function submitQuestionBankPractice(questionId) {
    const modal = document.getElementById("questionBankPracticeModal");
    const item = findQuestionBankItem(questionId);
    if (!modal || !item) return;
    const submitBtn = modal.querySelector("[data-qb-practice-action='submit']");
    const studentAnswer = readQuestionBankPracticeAnswer(modal);
    if (!studentAnswer) {
      showToast("请先完成作答");
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "提交中...";
    }
    try {
      const result = await fetchJson("/api/frontend/question-bank/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          student_answer: studentAnswer,
        }),
      });
      item.latest_completion = result && result.record && typeof result.record === "object" ? result.record : {
        student_answer: studentAnswer,
      };
      item.answer_state = String(result && result.answer_state || "submitted");
      await refreshQuestionBankAfterAnswer();
      renderQuestionBankActiveSurface();
      const updatedItem = findQuestionBankItem(questionId) || item;
      renderQuestionBankPracticeModal(updatedItem, updatedItem.latest_completion || item.latest_completion);
      showToast("作答已提交");
    } catch (err) {
      showToast(`提交失败：${err.message || "未知错误"}`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "提交作答";
      }
    }
  }

  function getQuestionBankGroupKey(item) {
    const row = item && typeof item === "object" ? item : {};
    const explicit = String(row.question_group_id || row.group_id || "").trim();
    if (explicit) return explicit;
    return [
      String(row.lecture_id || "").trim(),
      String(row.book_id || "").trim(),
      String(row.chapter_name || "").trim(),
      String(row.chapter_range || "").trim(),
      String(row.generation_mode || row.reason || row.type || "").trim(),
    ].join("|");
  }

  function getQuestionBankGroupTitle(item) {
    const row = item && typeof item === "object" ? item : {};
    const chapterName = String(row.chapter_name || "").trim();
    const bookTitle = String(row.book_title || "").trim();
    if (chapterName) return chapterName;
    if (bookTitle) return bookTitle;
    return "未命名题组";
  }

  function getQuestionBankGroupSubtitle(item, count) {
    const row = item && typeof item === "object" ? item : {};
    const mode = String(row.generation_mode || "").trim();
    const reason = String(row.reason || "").trim();
    const lectureTitle = getQuestionBankLectureTitle(row.lecture_id);
    const source = mode === "profile_adaptive"
      ? "画像出题"
      : mode === "chapter_quiz_sync"
        ? "章节小测"
        : reason === "chapter_quiz_empty_bank"
          ? "章节小测"
          : "题库沉淀";
    return [source, lectureTitle, `${count} 题`].filter(Boolean).join(" · ");
  }

  function groupQuestionBankItems(rows) {
    const groups = [];
    const groupMap = new Map();
    (Array.isArray(rows) ? rows : []).forEach((item) => {
      const key = getQuestionBankGroupKey(item);
      if (!groupMap.has(key)) {
        const group = {
          key,
          title: getQuestionBankGroupTitle(item),
          firstItem: item,
          items: [],
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).items.push(item);
    });
    groups.forEach((group) => {
      group.subtitle = getQuestionBankGroupSubtitle(group.firstItem, group.items.length);
    });
    return groups;
  }

  function getQuestionBankGroups() {
    const groups = Array.isArray(state.questionBankGroups) && state.questionBankGroups.length
      ? state.questionBankGroups
      : groupQuestionBankItems(state.questionBankItems);
    return groups.map((group) => {
      const items = Array.isArray(group.items) ? group.items : [];
      const totalCount = Number(group.total_count || items.length) || items.length;
      const answeredCount = Number(group.answered_count || items.filter((item) => getQuestionBankAnswerState(item) !== "pending").length) || 0;
      return Object.assign({}, group, {
        group_id: String(group.group_id || group.question_group_id || group.key || getQuestionBankGroupKey(items[0] || {})).trim(),
        title: String(group.title || getQuestionBankGroupTitle(items[0] || {})).trim(),
        source: String(group.source || "").trim(),
        items,
        total_count: totalCount,
        answered_count: answeredCount,
        correct_count: Number(group.correct_count || 0) || 0,
        pending_count: Number(group.pending_count || Math.max(0, totalCount - answeredCount)) || 0,
        needs_review_count: Number(group.needs_review_count || items.filter((item) => getQuestionBankAnswerState(item) === "needs_review").length) || 0,
        latest_timestamp: Number(group.latest_timestamp || 0) || 0,
        created_timestamp: Number(group.created_timestamp || 0) || 0,
      });
    });
  }

  function normalizeQuestionBankGroup(group) {
    const source = group && typeof group === "object" ? group : {};
    const items = Array.isArray(source.items) ? source.items : [];
    const fallback = items[0] || {};
    const totalCount = Number(source.total_count || items.length) || items.length;
    const answeredCount = Number(source.answered_count || items.filter((item) => getQuestionBankAnswerState(item) !== "pending").length) || 0;
    return Object.assign({}, source, {
      group_id: String(source.group_id || source.question_group_id || getQuestionBankGroupKey(fallback)).trim(),
      question_group_id: String(source.question_group_id || source.group_id || getQuestionBankGroupKey(fallback)).trim(),
      title: String(source.title || getQuestionBankGroupTitle(fallback)).trim(),
      source: String(source.source || getQuestionBankGroupSubtitle(fallback, totalCount).split(" 路 ")[0] || "").trim(),
      lecture_id: String(source.lecture_id || fallback.lecture_id || "").trim(),
      lecture_title: String(source.lecture_title || fallback.lecture_title || "").trim(),
      book_id: String(source.book_id || fallback.book_id || "").trim(),
      book_title: String(source.book_title || fallback.book_title || "").trim(),
      chapter_name: String(source.chapter_name || fallback.chapter_name || "").trim(),
      items,
      total_count: totalCount,
      answered_count: answeredCount,
      correct_count: Number(source.correct_count || items.filter((item) => {
        const latest = item && item.latest_completion && typeof item.latest_completion === "object" ? item.latest_completion : null;
        return latest && latest.is_correct === true;
      }).length) || 0,
      pending_count: Number(source.pending_count || items.filter((item) => getQuestionBankAnswerState(item) === "pending").length) || 0,
      needs_review_count: Number(source.needs_review_count || items.filter((item) => getQuestionBankAnswerState(item) === "needs_review").length) || 0,
      latest_timestamp: Number(source.latest_timestamp || 0) || 0,
      created_timestamp: Number(source.created_timestamp || 0) || 0,
    });
  }

  function findQuestionBankGroup(groupId) {
    const targetId = String(groupId || "").trim();
    if (!targetId) return null;
    if (state.questionBankSelectedGroup && String(state.questionBankSelectedGroup.group_id || "").trim() === targetId) {
      return normalizeQuestionBankGroup(state.questionBankSelectedGroup);
    }
    const group = getQuestionBankGroups().find((item) => String(item.group_id || "").trim() === targetId) || null;
    return group ? normalizeQuestionBankGroup(group) : null;
  }

  function getQuestionBankGroupFilteredItems(group) {
    const rows = Array.isArray(group && group.items) ? group.items : [];
    const filter = String(state.questionBankGroupAnswerFilter || "all").trim();
    if (!filter || filter === "all") return rows;
    return rows.filter((item) => getQuestionBankAnswerState(item) === filter);
  }

  function renderQuestionBankGroupProgress(group) {
    const total = Math.max(0, Number(group && group.total_count || 0));
    const answered = Math.max(0, Number(group && group.answered_count || 0));
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((answered / total) * 100))) : 0;
    return `
      <div class="question-bank-group-progress" aria-label="题组作答进度">
        <div class="question-bank-group-progress-label">
          <strong>已完成 ${answered}/${total}</strong>
          <span>${percent}%</span>
        </div>
        <div class="question-bank-group-progress-track">
          <i style="width:${percent}%"></i>
        </div>
      </div>
    `;
  }

  function renderQuestionBankGroupCover(group) {
    const safeGroup = normalizeQuestionBankGroup(group);
    const latest = Number(safeGroup.latest_timestamp || safeGroup.created_timestamp || 0);
    const meta = [
      safeGroup.source,
      safeGroup.lecture_title || getQuestionBankLectureTitle(safeGroup.lecture_id),
      safeGroup.book_title,
    ].filter(Boolean);
    const stats = [
      ["题量", safeGroup.total_count],
      ["已作答", safeGroup.answered_count],
      ["正确", safeGroup.correct_count],
      ["待复盘", safeGroup.needs_review_count],
      ["最近生成", latest ? formatTs(latest) : "暂无"],
    ];
    return `
      <section class="question-bank-group-cover">
        <div class="question-bank-group-cover-main">
          <div class="question-bank-kicker">${escapeHtml(safeGroup.source || "Question Set")}</div>
          <h3>${escapeHtml(safeGroup.title || "题组作答")}</h3>
          <p>${meta.map((item) => escapeHtml(item)).join(" · ")}</p>
        </div>
        <div class="question-bank-group-cover-stats">
          ${stats.map(([label, value]) => `
            <div>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(String(value))}</strong>
            </div>
          `).join("")}
        </div>
        ${renderQuestionBankGroupProgress(safeGroup)}
      </section>
    `;
  }

  function renderQuestionBankGroupAnswerFilters(group) {
    const safeGroup = normalizeQuestionBankGroup(group);
    const options = [
      ["all", "全部", safeGroup.total_count],
      ["pending", "未作答", safeGroup.pending_count],
      ["submitted", "已作答", Math.max(0, safeGroup.answered_count - safeGroup.needs_review_count)],
      ["needs_review", "待复盘", safeGroup.needs_review_count],
    ];
    const active = String(state.questionBankGroupAnswerFilter || "all").trim();
    return `
      <div class="question-bank-group-filterbar" role="tablist" aria-label="题组内筛选">
        ${options.map(([value, label, count]) => `
          <button class="question-bank-group-filter${active === value ? " is-active" : ""}" type="button" data-qb-group-filter="${escapeHtml(value)}" aria-pressed="${active === value ? "true" : "false"}">
            ${escapeHtml(label)} <span>${Number(count || 0)}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderQuestionBankMistakePanel(summary) {
    const data = summary && typeof summary === "object" ? summary : {};
    const reviewCount = Number(data.needs_review || 0) || 0;
    return `
      <section class="question-bank-mistakes-panel">
        <div>
          <div class="question-bank-kicker">Mistake Review</div>
          <h3>错题本</h3>
          <p>集中复盘自动判定错误或需要再看的题目。</p>
        </div>
        <div class="question-bank-mistakes-count">
          <strong>${reviewCount}</strong>
          <span>待复盘</span>
        </div>
        <button class="question-bank-action question-bank-action-soft" type="button" data-qb-action="open-mistakes">
          进入错题本
        </button>
      </section>
    `;
  }

  function renderQuestionPracticePage() {
    if (!el.questionPracticeContent) return;
    const selectedGroup = findQuestionBankGroup(state.questionBankSelectedGroupId);
    if (state.questionBankGroupLoading && !selectedGroup) {
      el.questionPracticeContent.innerHTML = '<div class="materials-empty">题组加载中...</div>';
      return;
    }
    if (state.questionBankGroupError) {
      el.questionPracticeContent.innerHTML = `<div class="materials-empty">${escapeHtml(state.questionBankGroupError)}</div>`;
      return;
    }
    if (!selectedGroup) {
      el.questionPracticeContent.innerHTML = '<div class="materials-empty">请选择一个题组开始作答</div>';
      return;
    }
    const pageRows = getQuestionBankGroupFilteredItems(selectedGroup);
    if (el.questionPracticeTitle) {
      el.questionPracticeTitle.textContent = selectedGroup.title || "题组作答";
    }
    if (el.questionPracticeSubtitle) {
      el.questionPracticeSubtitle.textContent = [selectedGroup.source, selectedGroup.book_title].filter(Boolean).join(" · ") || "Question Practice";
    }
    el.questionPracticeContent.innerHTML = `
      ${renderQuestionBankGroupAnswerFilters(selectedGroup)}
      ${renderQuestionBankPaper(pageRows, { practiceMode: true })}
    `;
  }

  function renderQuestionBankActiveSurface() {
    if (el.questionPracticeView && el.questionPracticeView.classList.contains("is-active")) {
      renderQuestionPracticePage();
    } else {
      renderQuestionBankCenter();
    }
  }

  function renderQuestionBankGroupList(groups) {
    const rows = Array.isArray(groups) ? groups : [];
    if (!rows.length) {
      return '<div class="materials-empty">当前筛选条件下暂无题组</div>';
    }
    return `
      <div class="question-bank-group-list">
        ${rows.map((group) => {
          const groupId = String(group.group_id || "").trim();
          const total = Number(group.total_count || (group.items || []).length) || 0;
          const answered = Number(group.answered_count || 0) || 0;
          const pending = Number(group.pending_count || 0) || 0;
          const review = Number(group.needs_review_count || 0) || 0;
          const correct = Number(group.correct_count || 0) || 0;
          const latest = Number(group.latest_timestamp || group.created_timestamp || 0) || 0;
          const source = String(group.source || "题库沉淀").trim();
          const bookTitle = String(group.book_title || "").trim();
          const meta = [source, bookTitle].filter(Boolean).join(" · ");
          return `
            <article class="question-bank-group-card" data-qb-group-id="${escapeHtml(groupId)}">
              <div class="question-bank-group-card-main">
                <div class="question-bank-kicker">${escapeHtml(source)}</div>
                <h4>${escapeHtml(group.title || "未命名题组")}</h4>
                ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
              </div>
              <div class="question-bank-group-card-stats">
                <span>${answered}/${total} 已作答</span>
                ${correct ? `<span>${correct} 正确</span>` : ""}
                ${pending ? `<span>${pending} 未作答</span>` : ""}
                ${review ? `<span>${review} 待复盘</span>` : ""}
                ${latest ? `<span>${escapeHtml(formatTs(latest))}</span>` : ""}
              </div>
              <button class="question-bank-action question-bank-action-primary" type="button" data-qb-action="open-group" data-group-id="${escapeHtml(groupId)}">
                ${answered > 0 && answered < total ? "继续作答" : answered >= total && total > 0 ? "复盘题组" : "开始作答"}
              </button>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderQuestionBankPaperQuestion(item, index) {
    const question = getQuestionBankQuestion(item);
    const questionId = String((item && item.question_id) || `qb_${index}`).trim();
    const title = question.title || question.content || `练习题 ${index + 1}`;
    const content = question.content && question.content !== title ? question.content : "";
    const answerState = getQuestionBankAnswerState(item);
    const latest = item && item.latest_completion && typeof item.latest_completion === "object" ? item.latest_completion : null;
    const savedAnswer = latest ? String(latest.student_answer || "") : "";
    const statusLabel = getQuestionBankAnswerStateLabel(answerState);
    const meta = [
      getQuestionBankTypeLabel(item),
      question.difficulty || "综合",
      String((item && item.chapter_name) || "").trim(),
    ].filter(Boolean).join(" · ");
    const answerHtml = question.options.length >= 2
      ? `<div class="question-bank-paper-options">
          ${question.options.map((option, optionIndex) => {
            const label = option.label || String.fromCharCode(65 + optionIndex);
            const value = option.value || `${label}. ${option.text || ""}`;
            const checked = isQuestionBankOptionSelected(savedAnswer, option, label);
            const multi = isQuestionBankMultipleChoice(question);
            return `
              <label class="question-bank-paper-option">
                <input type="${multi ? "checkbox" : "radio"}" name="qbPaperAnswer_${escapeHtml(questionId)}" data-qb-paper-answer value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(option.text || value)}</strong>
              </label>
            `;
          }).join("")}
        </div>`
      : `<textarea class="question-bank-paper-textarea" data-qb-paper-answer rows="4" placeholder="写下你的作答">${escapeHtml(savedAnswer)}</textarea>`;

    return `
      <article class="question-bank-paper-question ${answerState === "needs_review" ? "is-review" : answerState === "submitted" ? "is-done" : ""}" data-qb-paper-question="${escapeHtml(questionId)}">
        <div class="question-bank-paper-index">${index + 1}</div>
        <div class="question-bank-paper-main">
          <div class="question-bank-paper-top">
            <div>
              <h4>${escapeHtml(title)}</h4>
              ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
            </div>
            <span>${escapeHtml(statusLabel)}</span>
          </div>
          ${content ? `<div class="question-bank-paper-content">${escapeHtml(content)}</div>` : ""}
          ${question.hint ? `<div class="question-bank-practice-hint">提示：${escapeHtml(question.hint)}</div>` : ""}
          ${answerHtml}
        </div>
      </article>
    `;
  }

  function renderQuestionBankPaper(rows, options) {
    const opts = options && typeof options === "object" ? options : {};
    const practiceMode = !!opts.practiceMode;
    const pageRows = Array.isArray(rows) ? rows : [];
    if (!pageRows.length) {
      return '<div class="materials-empty">当前筛选条件下暂无题目</div>';
    }
    const answeredCount = pageRows.filter((item) => getQuestionBankAnswerState(item) !== "pending").length;
    const groups = groupQuestionBankItems(pageRows);
    return `
      <section class="question-bank-paper${practiceMode ? " is-practice-mode" : ""}">
        ${practiceMode ? "" : `<div class="question-bank-paper-head">
          <div>
            <div class="question-bank-kicker">Question Sets</div>
            <h3>题组作答</h3>
          </div>
          <span>${groups.length} 组 · ${answeredCount}/${pageRows.length} 已作答</span>
        </div>`}
        <div class="question-bank-paper-list">
          ${groups.map((group) => practiceMode ? `
            ${group.items.map((item, index) => renderQuestionBankPaperQuestion(item, index)).join("")}
          ` : `
            <section class="question-bank-paper-group">
              <div class="question-bank-paper-group-head">
                <div>
                  <h4>${escapeHtml(group.title)}</h4>
                  <p>${escapeHtml(group.subtitle || "")}</p>
                </div>
              </div>
              ${group.items.map((item, index) => renderQuestionBankPaperQuestion(item, index)).join("")}
            </section>
          `).join("")}
        </div>
        <div class="question-bank-paper-foot">
          <button class="question-bank-action question-bank-action-secondary" type="button" data-qb-action="paper-clear">清空当前填写</button>
          <button class="question-bank-action question-bank-action-primary" type="button" data-qb-action="paper-submit">${practiceMode ? "提交作答" : "提交当前题组"}</button>
        </div>
      </section>
    `;
  }

  function readQuestionBankPaperAnswers() {
    const panel = (el.questionPracticeView && el.questionPracticeView.classList.contains("is-active"))
      ? el.questionPracticeContent
      : el.questionBankPanel;
    if (!panel) return [];
    const answers = [];
    panel.querySelectorAll("[data-qb-paper-question]").forEach((node) => {
      const questionId = String(node.getAttribute("data-qb-paper-question") || "").trim();
      if (!questionId) return;
      const checkedRows = Array.from(node.querySelectorAll("input[data-qb-paper-answer]:checked"));
      const textarea = node.querySelector("textarea[data-qb-paper-answer]");
      const studentAnswer = checkedRows.length
        ? joinQuestionBankChoiceAnswers(checkedRows.map((item) => item.value))
        : textarea
          ? String(textarea.value || "").trim()
          : "";
      if (studentAnswer) {
        answers.push({ questionId, studentAnswer });
      }
    });
    return answers;
  }

  async function submitQuestionBankPaper(button) {
    const answers = readQuestionBankPaperAnswers();
    if (!answers.length) {
      showToast("请先填写至少一道题");
      return;
    }
    const submitBtn = button instanceof HTMLElement ? button : null;
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "提交中...";
    }
    let submitted = 0;
    try {
      for (const answer of answers) {
        await fetchJson("/api/frontend/question-bank/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_id: answer.questionId,
            student_answer: answer.studentAnswer,
          }),
        });
        submitted += 1;
      }
      await refreshQuestionBankAfterAnswer();
      renderQuestionBankActiveSurface();
      showToast(`已提交 ${submitted} 道题`);
    } catch (err) {
      showToast(`提交失败：${err.message || "未知错误"}`);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || "提交当前题组";
      }
    }
  }

  function clearQuestionBankPaperInputs() {
    const panel = (el.questionPracticeView && el.questionPracticeView.classList.contains("is-active"))
      ? el.questionPracticeContent
      : el.questionBankPanel;
    if (!panel) return;
    panel.querySelectorAll("[data-qb-paper-answer]").forEach((node) => {
      if (node instanceof HTMLInputElement && node.type === "radio") {
        node.checked = false;
      } else if (node instanceof HTMLTextAreaElement) {
        node.value = "";
      }
    });
  }

  function renderQuestionBankItem(item, index, variant) {
    const question = getQuestionBankQuestion(item);
    const title = question.title || question.content || `练习题 ${index + 1}`;
    const content = question.content && question.content !== title ? question.content : "";
    const answerState = getQuestionBankAnswerState(item);
    const stateLabel = getQuestionBankAnswerStateLabel(answerState);
    const lectureId = String((item && item.lecture_id) || "").trim();
    const bookTitle = String((item && item.book_title) || "").trim();
    const chapterName = String((item && item.chapter_name) || "").trim();
    const typeLabel = getQuestionBankTypeLabel(item);
    const difficulty = question.difficulty || "综合";
    const questionId = String((item && item.question_id) || `qb_${index}`).trim();
    const meta = [
      getQuestionBankLectureTitle(lectureId),
      bookTitle,
      chapterName,
    ].filter(Boolean).join(" · ");
    const optionsHtml = question.options.length
      ? `<div class="question-bank-options">${question.options.map((option, optionIndex) => {
        const label = option.label || String.fromCharCode(65 + optionIndex);
        return `<span>${escapeHtml(label)}. ${escapeHtml(option.text || "")}</span>`;
      }).join("")}</div>`
      : "";
    const stateClass = answerState === "needs_review" ? "is-review" : (answerState === "submitted" ? "is-done" : "is-pending");

    return `
      <article class="question-bank-item ${stateClass}${variant === "compact" ? " is-compact" : ""}" data-qb-question-id="${escapeHtml(questionId)}">
        <div class="question-bank-item-head">
          <div class="question-bank-item-title">${escapeHtml(title)}</div>
          <span class="question-bank-state">${escapeHtml(stateLabel)}</span>
        </div>
        ${content ? `<div class="question-bank-item-content">${escapeHtml(content)}</div>` : ""}
        ${optionsHtml}
        <div class="question-bank-meta">
          <span>${escapeHtml(typeLabel)}</span>
          <span>${escapeHtml(difficulty)}</span>
          ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
        </div>
        <div class="question-bank-actions">
          <button class="question-bank-action question-bank-action-primary" type="button" data-qb-action="answer" data-question-id="${escapeHtml(questionId)}">${answerState === "pending" ? "开始作答" : "重新作答"}</button>
          ${lectureId ? `<button class="question-bank-action question-bank-action-secondary" type="button" data-qb-action="open-lecture" data-lecture-id="${escapeHtml(lectureId)}">查看来源</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderQuestionBankPagination(position) {
    const pagination = state.questionBankPagination || {};
    const page = Math.max(1, Number(pagination.page || 1));
    const totalPages = Math.max(1, Number(pagination.total_pages || 1));
    const total = Math.max(0, Number(pagination.total || 0));
    const totalItems = Math.max(0, Number(pagination.total_items || 0));
    if (totalPages <= 1) {
      return `<div class="question-bank-pagination is-single" data-qb-pagination-position="${escapeHtml(position || "")}">共 ${total} 组${totalItems ? ` · ${totalItems} 题` : ""}</div>`;
    }

    const pages = [];
    const addPage = (value) => {
      if (value < 1 || value > totalPages || pages.includes(value)) return;
      pages.push(value);
    };
    addPage(1);
    for (let idx = page - 2; idx <= page + 2; idx += 1) {
      addPage(idx);
    }
    addPage(totalPages);
    pages.sort((a, b) => a - b);

    let last = 0;
    const pageButtons = pages.map((value) => {
      const gap = value - last > 1 ? `<span class="question-bank-page-gap">...</span>` : "";
      last = value;
      return `${gap}<button class="question-bank-page-btn${value === page ? " is-active" : ""}" type="button" data-qb-page="${value}" ${value === page ? 'aria-current="page"' : ""}>${value}</button>`;
    }).join("");

    return `
      <nav class="question-bank-pagination" data-qb-pagination-position="${escapeHtml(position || "")}" aria-label="题库分页">
        <button class="question-bank-page-btn" type="button" data-qb-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <div class="question-bank-page-numbers">${pageButtons}</div>
        <button class="question-bank-page-btn" type="button" data-qb-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
        <span class="question-bank-page-total">第 ${page}/${totalPages} 页 · 共 ${total} 组${totalItems ? ` · ${totalItems} 题` : ""}</span>
      </nav>
    `;
  }

  function renderQuestionBankCenter() {
    if (!el.questionBankPanel) return;
    const rows = Array.isArray(state.questionBankItems) ? state.questionBankItems : [];
    const summary = state.questionBankSummary || {};

    if (!rows.length) {
      const isMistakeFilter = state.questionBankFilter && state.questionBankFilter.answerState === "needs_review";
      el.questionBankPanel.innerHTML = `
        <div class="question-bank-empty">
          <div class="question-bank-empty-title">${isMistakeFilter ? "错题本暂无待复盘题目" : "题库还没有题目"}</div>
          <div class="question-bank-empty-text">${isMistakeFilter ? "当前没有需要复盘的错题，可以返回全部题库继续练习。" : "进入课程章节生成小测后，题目会自动沉淀到这里。"}</div>
          ${isMistakeFilter ? '<button class="question-bank-action question-bank-action-secondary" type="button" data-qb-action="clear-mistakes">返回全部题库</button>' : ""}
        </div>
      `;
      return;
    }

    const groups = getQuestionBankGroups();
    const pending = rows.filter((item) => getQuestionBankAnswerState(item) === "pending");
    const review = rows.filter((item) => getQuestionBankAnswerState(item) === "needs_review");
    const recommended = (review.length ? review : pending.length ? pending : rows).slice(-3).reverse();
    const pagination = state.questionBankPagination || {};
    const total = Number(summary.total || pagination.total_items || rows.length) || 0;

    el.questionBankPanel.innerHTML = `
      <section class="question-bank-hero">
        <div>
          <div class="question-bank-kicker">Practice Center</div>
          <h2>题库中心</h2>
          <p>在这里直接完成练习、提交作答和复盘错题；课程只作为题目来源与回看入口。</p>
        </div>
        <div class="question-bank-stats">
          <div><strong>${total}</strong><span>题目</span></div>
          <div><strong>${Number(summary.pending || pending.length) || 0}</strong><span>未作答</span></div>
          <div><strong>${Number(summary.needs_review || review.length) || 0}</strong><span>待复盘</span></div>
        </div>
      </section>
      ${renderQuestionBankMistakePanel(summary)}
      <section class="question-bank-section is-recommend">
        <div class="question-bank-section-head">
          <h3>今日推荐练习</h3>
          <span>${recommended.length} 题</span>
        </div>
        <div class="question-bank-recommend-list">
          ${recommended.map((item, index) => renderQuestionBankItem(item, index, "compact")).join("")}
        </div>
      </section>
      <section class="question-bank-section" data-qb-all-section>
        <div class="question-bank-section-head">
          <h3>题组列表</h3>
          <span>每页 ${Number(state.questionBankPageSize || 5)} 组</span>
        </div>
        ${renderQuestionBankFilters()}
        ${renderQuestionBankPagination("top")}
        ${renderQuestionBankGroupList(groups)}
        ${renderQuestionBankPagination("bottom")}
      </section>
    `;
  }

  function scrollQuestionBankToAllSection() {
    if (!el.questionBankPanel) return;
    const target = el.questionBankPanel.querySelector("[data-qb-all-section]");
    if (!target) {
      el.questionBankPanel.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const panelRect = el.questionBankPanel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, el.questionBankPanel.scrollTop + targetRect.top - panelRect.top - 8);
    el.questionBankPanel.scrollTo({ top: nextTop, behavior: "smooth" });
  }

  function getLearningPushContext() {
    return {
      state,
      el,
      escapeHtml,
      fetchJson,
      getLectureTitle,
      loadQuestionBank,
      normalizeStatusKey,
      openLearningResourceStudio,
      openLearningVideoStudio,
      openLearningResourceReview,
      closeLearningResourceReview,
      openLearningResourceReader,
      closeLearningResourceReader,
      openLearningPathView,
      openLectureHome,
      setView,
      confirmModalAsync,
      showToast,
      syncDashboardSideTabs,
    };
  }

  function renderLearningResourceStudio() {
    if (window.NXLLearningResourceStudio && typeof window.NXLLearningResourceStudio.render === "function") {
      window.NXLLearningResourceStudio.render(getLearningPushContext());
    }
  }

  function bindLearningResourceStudioEvents() {
    if (window.NXLLearningResourceStudio && typeof window.NXLLearningResourceStudio.bind === "function") {
      window.NXLLearningResourceStudio.bind(getLearningPushContext());
    }
  }

  function openLearningResourceStudio() {
    setView("resourceStudio");
    renderLearningResourceStudio();
    bindLearningResourceStudioEvents();
  }

  function renderLearningVideoStudio() {
    if (window.NXLLearningVideoStudio && typeof window.NXLLearningVideoStudio.render === "function") {
      window.NXLLearningVideoStudio.render(getLearningPushContext());
    }
  }

  function bindLearningVideoStudioEvents() {
    if (window.NXLLearningVideoStudio && typeof window.NXLLearningVideoStudio.bind === "function") {
      window.NXLLearningVideoStudio.bind(getLearningPushContext());
    }
  }

  function openLearningVideoStudio() {
    setView("videoStudio");
    if (window.NXLLearningVideoStudio && typeof window.NXLLearningVideoStudio.open === "function") {
      window.NXLLearningVideoStudio.open(getLearningPushContext());
      return;
    }
    renderLearningVideoStudio();
    bindLearningVideoStudioEvents();
  }

  function renderLearningResourceReview() {
    if (window.NXLLearningResourceStudio && typeof window.NXLLearningResourceStudio.renderReview === "function") {
      window.NXLLearningResourceStudio.renderReview(getLearningPushContext(), state.learningResourceReviewItem);
    }
  }

  function openLearningResourceReview(item) {
    state.learningResourceReviewItem = item && typeof item === "object" ? item : null;
    setView("resourceReview");
    renderLearningResourceReview();
    bindLearningResourceStudioEvents();
  }

  function closeLearningResourceReview() {
    setView("resourceStudio");
    renderLearningResourceStudio();
  }

  function renderLearningResourceReader() {
    if (window.NXLLearningPush && typeof window.NXLLearningPush.renderReader === "function") {
      window.NXLLearningPush.renderReader(getLearningPushContext(), state.learningResourceReaderItem);
    }
  }

  function openLearningResourceReader(item) {
    state.learningResourceReaderItem = item && typeof item === "object" ? item : null;
    setView("resourceReader");
    renderLearningResourceReader();
    bindLearningPushEvents();
  }

  function closeLearningResourceReader() {
    state.dashboardSideTab = "push";
    setView("dashboard");
    syncDashboardSideTabs();
  }

  function renderLearningPushCenter() {
    if (window.NXLLearningPush && typeof window.NXLLearningPush.render === "function") {
      window.NXLLearningPush.render(getLearningPushContext());
    }
  }

  function bindLearningPushEvents() {
    if (window.NXLLearningPush && typeof window.NXLLearningPush.bind === "function") {
      window.NXLLearningPush.bind(getLearningPushContext());
    }
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

