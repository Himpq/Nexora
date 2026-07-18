// ─────── Personal simulation exam experience ────────────────────────

  function ensureQuestionExamState() {
    if (!state.questionExam || typeof state.questionExam !== "object") {
      state.questionExam = {
        currentIndex: 0,
        questionIds: [],
        answers: {},
        submittedIds: {},
        reviewMode: false,
        startedAt: 0,
        timerId: null,
      };
    }

    if (!Array.isArray(state.questionExam.questionIds)) {
      state.questionExam.questionIds = [];
    }

    return state.questionExam;
  }

  function stopQuestionExamClock() {
    const exam = ensureQuestionExamState();

    if (exam.timerId) {
      window.clearInterval(exam.timerId);
      exam.timerId = null;
    }
  }

  function formatQuestionExamElapsed(startedAt) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Number(startedAt || Date.now())) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const parts = [minutes, seconds].map((value) => String(value).padStart(2, "0"));

    if (hours > 0) {
      parts.unshift(String(hours).padStart(2, "0"));
    }

    return parts.join(":");
  }

  function startQuestionExamClock() {
    const exam = ensureQuestionExamState();
    stopQuestionExamClock();

    if (exam.reviewMode || !exam.startedAt) return;

    const update = () => {
      if (!el.questionPracticeView || !el.questionPracticeView.classList.contains("is-active")) {
        stopQuestionExamClock();
        return;
      }

      const clock = document.getElementById("questionExamElapsed");

      if (clock) {
        clock.textContent = formatQuestionExamElapsed(exam.startedAt);
      }
    };

    update();
    exam.timerId = window.setInterval(update, 1000);
  }

  function resetQuestionExamSession(reviewMode) {
    stopQuestionExamClock();
    state.questionExam = {
      currentIndex: 0,
      questionIds: [],
      answers: {},
      submittedIds: {},
      reviewMode: !!reviewMode,
      startedAt: reviewMode ? 0 : Date.now(),
      timerId: null,
    };
  }

  function getQuestionExamRows(group) {
    const safeGroup = group || findQuestionBankGroup(state.questionBankSelectedGroupId);
    if (!safeGroup) return [];

    const exam = ensureQuestionExamState();
    const allRows = Array.isArray(safeGroup.items) ? safeGroup.items : [];

    if (exam.questionIds.length) {
      const rowMap = new Map(allRows.map((item) => [String(item && item.question_id || "").trim(), item]));
      return exam.questionIds.map((questionId) => rowMap.get(questionId)).filter(Boolean);
    }

    const filteredRows = getQuestionBankGroupFilteredItems(safeGroup);
    exam.questionIds = filteredRows.map((item) => String(item && item.question_id || "").trim()).filter(Boolean);
    return filteredRows;
  }

  function getQuestionExamDraft(questionId, item) {
    const exam = ensureQuestionExamState();
    const targetId = String(questionId || "").trim();

    if (Object.prototype.hasOwnProperty.call(exam.answers, targetId)) {
      return String(exam.answers[targetId] || "");
    }

    if (exam.reviewMode) {
      const latest = item && item.latest_completion && typeof item.latest_completion === "object"
        ? item.latest_completion
        : null;
      return latest ? String(latest.student_answer || "") : "";
    }

    return "";
  }

  function getQuestionExamAnsweredCount(rows) {
    const exam = ensureQuestionExamState();

    if (exam.reviewMode) {
      return rows.filter((item) => item && item.latest_completion).length;
    }

    return rows.filter((item) => {
      const questionId = String(item && item.question_id || "").trim();
      return !!String(exam.answers[questionId] || "").trim();
    }).length;
  }

  function renderQuestionExamAnswer(item, question, questionId) {
    const exam = ensureQuestionExamState();
    const draft = getQuestionExamDraft(questionId, item);
    const isLocked = !!exam.submittedIds[questionId] && !exam.reviewMode;
    const disabled = exam.reviewMode || isLocked ? " disabled" : "";

    if (question.options.length >= 2) {
      const multi = isQuestionBankMultipleChoice(question);

      return `
        ${isLocked ? '<div class="question-exam-partial-note">本题已提交，等待其余题目完成交卷</div>' : ""}
        <div class="question-exam-options">
          ${question.options.map((option, optionIndex) => {
            const label = option.label || String.fromCharCode(65 + optionIndex);
            const value = option.value || `${label}. ${option.text || ""}`;
            const selected = isQuestionBankOptionSelected(draft, option, label);
            const referenceSelected = exam.reviewMode && question.answer
              ? isQuestionBankOptionSelected(question.answer, option, label)
              : false;
            const optionClass = [
              "question-exam-option",
              selected ? "is-selected" : "",
              referenceSelected ? "is-reference" : "",
            ].filter(Boolean).join(" ");

            return `
              <label class="${optionClass}">
                <input type="${multi ? "checkbox" : "radio"}" name="questionExamAnswer_${escapeHtml(questionId)}" data-exam-answer value="${escapeHtml(value)}" ${selected ? "checked" : ""}${disabled}>
                <span class="question-exam-option-key">${escapeHtml(label)}</span>
                <strong>${escapeHtml(option.text || value)}</strong>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }

    return `
      ${isLocked ? '<div class="question-exam-partial-note">本题已提交，等待其余题目完成交卷</div>' : ""}
      <textarea class="question-exam-textarea" data-exam-answer rows="8" placeholder="在此作答"${disabled}>${escapeHtml(draft)}</textarea>
    `;
  }

  function renderQuestionExamReview(item, question) {
    const exam = ensureQuestionExamState();

    if (!exam.reviewMode) return "";

    const latest = item && item.latest_completion && typeof item.latest_completion === "object"
      ? item.latest_completion
      : null;
    const hasJudgement = !!(latest && Object.prototype.hasOwnProperty.call(latest, "is_correct"));
    const resultClass = !latest
      ? "is-unanswered"
      : hasJudgement && latest.is_correct === true
      ? "is-correct"
      : hasJudgement && latest.is_correct === false
        ? "is-incorrect"
        : "is-pending-review";
    const resultLabel = !latest
      ? "未作答"
      : hasJudgement && latest.is_correct === true
      ? "回答正确"
      : hasJudgement && latest.is_correct === false
        ? "需要复盘"
        : "等待人工评阅";

    return `
      <section class="question-exam-review ${resultClass}">
        <div class="question-exam-review-status">${escapeHtml(resultLabel)}</div>
        <div class="question-exam-review-row">
          <span>你的作答</span>
          <p>${escapeHtml(latest ? String(latest.student_answer || "未作答") : "未作答")}</p>
        </div>
        <div class="question-exam-review-row">
          <span>参考答案</span>
          <p>${escapeHtml(question.answer || "本题暂无参考答案")}</p>
        </div>
        ${question.hint ? `
          <div class="question-exam-review-row">
            <span>解析提示</span>
            <p>${escapeHtml(question.hint)}</p>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderQuestionExamNavigator(rows, currentIndex) {
    const exam = ensureQuestionExamState();

    return `
      <aside class="question-exam-navigator" aria-label="答题卡">
        <div class="question-exam-navigator-head">
          <span>答题卡</span>
          <strong>${getQuestionExamAnsweredCount(rows)}/${rows.length}</strong>
        </div>
        <div class="question-exam-number-grid">
          ${rows.map((item, index) => {
            const questionId = String(item && item.question_id || "").trim();
            const latest = item && item.latest_completion && typeof item.latest_completion === "object" ? item.latest_completion : null;
            const answered = exam.reviewMode ? !!latest : !!String(exam.answers[questionId] || "").trim();
            const needsReview = exam.reviewMode && latest && latest.is_correct === false;
            const className = [
              "question-exam-number",
              index === currentIndex ? "is-current" : "",
              answered ? "is-answered" : "",
              needsReview ? "is-incorrect" : "",
            ].filter(Boolean).join(" ");

            return `<button class="${className}" type="button" data-qb-action="exam-jump" data-exam-index="${index}" aria-label="第 ${index + 1} 题">${index + 1}</button>`;
          }).join("")}
        </div>
        <div class="question-exam-legend">
          <span><i class="is-current"></i>当前</span>
          <span><i class="is-answered"></i>已答</span>
          ${exam.reviewMode ? '<span><i class="is-incorrect"></i>待复盘</span>' : ""}
        </div>
      </aside>
    `;
  }

  function renderQuestionExamStage(item, index, total) {
    const exam = ensureQuestionExamState();
    const question = getQuestionBankQuestion(item);
    const questionId = String(item && item.question_id || `exam_${index}`).trim();
    const title = question.title || question.content || `第 ${index + 1} 题`;
    const content = question.content && question.content !== title ? question.content : "";
    const meta = [
      getQuestionBankTypeLabel(item),
      question.difficulty || "综合",
      String(item && item.chapter_name || "").trim(),
    ].filter(Boolean);

    return `
      <main class="question-exam-stage" data-exam-question-id="${escapeHtml(questionId)}">
        <header class="question-exam-question-head">
          <div>
            <div class="question-exam-position">第 ${index + 1} 题 / 共 ${total} 题</div>
            <div class="question-exam-meta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
          </div>
          <div class="question-exam-inline-actions">
            ${exam.reviewMode ? "" : '<button class="question-exam-text-btn" type="button" data-qb-action="paper-clear">清空本题</button>'}
            <button class="question-exam-nav-btn" type="button" data-qb-action="exam-prev" ${index <= 0 ? "disabled" : ""} aria-label="上一题" title="上一题">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
            </button>
            <button class="question-exam-nav-btn" type="button" data-qb-action="exam-next" ${index >= total - 1 ? "disabled" : ""} aria-label="下一题" title="下一题">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
          </div>
        </header>
        <section class="question-exam-question-body">
          <h3>${escapeHtml(title)}</h3>
          ${content ? `<div class="question-exam-question-content">${escapeHtml(content)}</div>` : ""}
          ${renderQuestionExamAnswer(item, question, questionId)}
          ${renderQuestionExamReview(item, question)}
        </section>
      </main>
    `;
  }

  function renderQuestionPracticePage() {
    if (!el.questionPracticeContent) return;

    const selectedGroup = findQuestionBankGroup(state.questionBankSelectedGroupId);

    if (state.questionBankGroupLoading && !selectedGroup) {
      if (el.questionPracticeTitle) el.questionPracticeTitle.textContent = "模拟考试";
      if (el.questionPracticeSubtitle) el.questionPracticeSubtitle.textContent = "正在加载试卷";
      if (el.questionPracticeHeaderMeta) el.questionPracticeHeaderMeta.innerHTML = "";
      el.questionPracticeContent.innerHTML = '<div class="materials-empty">试卷加载中...</div>';
      return;
    }

    if (state.questionBankGroupError) {
      if (el.questionPracticeTitle) el.questionPracticeTitle.textContent = "模拟考试";
      if (el.questionPracticeSubtitle) el.questionPracticeSubtitle.textContent = "试卷加载失败";
      if (el.questionPracticeHeaderMeta) el.questionPracticeHeaderMeta.innerHTML = "";
      el.questionPracticeContent.innerHTML = `<div class="materials-empty">${escapeHtml(state.questionBankGroupError)}</div>`;
      return;
    }

    if (!selectedGroup) {
      if (el.questionPracticeTitle) el.questionPracticeTitle.textContent = "模拟考试";
      if (el.questionPracticeSubtitle) el.questionPracticeSubtitle.textContent = "没有可用试卷";
      if (el.questionPracticeHeaderMeta) el.questionPracticeHeaderMeta.innerHTML = "";
      el.questionPracticeContent.innerHTML = '<div class="materials-empty">没有可用试卷</div>';
      return;
    }

    const rows = getQuestionExamRows(selectedGroup);

    if (!rows.length) {
      if (el.questionPracticeTitle) el.questionPracticeTitle.textContent = selectedGroup.title || "模拟考试";
      if (el.questionPracticeSubtitle) el.questionPracticeSubtitle.textContent = "当前范围内没有可练习题目";
      if (el.questionPracticeHeaderMeta) el.questionPracticeHeaderMeta.innerHTML = "";
      el.questionPracticeContent.innerHTML = '<div class="materials-empty">当前范围内没有可练习题目</div>';
      return;
    }

    const exam = ensureQuestionExamState();
    exam.currentIndex = Math.max(0, Math.min(rows.length - 1, Number(exam.currentIndex) || 0));
    const currentItem = rows[exam.currentIndex];
    const answeredCount = getQuestionExamAnsweredCount(rows);

    if (el.questionPracticeTitle) {
      el.questionPracticeTitle.textContent = selectedGroup.title || "模拟考试";
    }

    if (el.questionPracticeSubtitle) {
      el.questionPracticeSubtitle.textContent = exam.reviewMode
        ? `考试复盘 · ${rows.length} 题`
        : `模拟考试 · ${rows.length} 题`;
    }

    if (el.questionPracticeHeaderMeta) {
      el.questionPracticeHeaderMeta.innerHTML = `
        <div class="question-exam-header-progress">
          <strong>${answeredCount}/${rows.length}</strong>
          <div class="question-exam-progress-track"><i style="width:${Math.round((answeredCount / rows.length) * 100)}%"></i></div>
        </div>
        <div class="question-exam-clock">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
          <span id="questionExamElapsed">${exam.reviewMode ? "已交卷" : formatQuestionExamElapsed(exam.startedAt)}</span>
        </div>
        ${exam.reviewMode
          ? '<button class="question-exam-btn is-secondary" type="button" data-qb-action="exam-exit-review">返回练习中心</button>'
          : '<button class="question-exam-btn is-primary" type="button" data-qb-action="paper-submit">交卷</button>'}
      `;
    }

    el.questionPracticeContent.innerHTML = `
      <section class="question-exam-shell${exam.reviewMode ? " is-review-mode" : ""}">
        <div class="question-exam-workspace">
          ${renderQuestionExamNavigator(rows, exam.currentIndex)}
          ${renderQuestionExamStage(currentItem, exam.currentIndex, rows.length)}
        </div>
      </section>
    `;
    startQuestionExamClock();
  }

  async function openQuestionBankGroupPractice(groupId) {
    const targetGroupId = String(groupId || "").trim();

    if (!targetGroupId) return;

    state.questionPracticeReturnView = "dashboard";
    state.questionBankSelectedGroupId = targetGroupId;
    state.questionBankSelectedGroup = null;
    state.questionBankGroupAnswerFilter = state.questionBankFilter.answerState === "needs_review" ? "needs_review" : "all";
    state.questionBankGroupLoading = true;
    state.questionBankGroupError = "";
    resetQuestionExamSession(false);
    setView("questionPractice");
    renderQuestionPracticePage();
    await loadQuestionBankGroup(targetGroupId);
    renderQuestionPracticePage();
  }

  async function openQuestionBankGroupReview(groupId) {
    const targetGroupId = String(groupId || "").trim();

    if (!targetGroupId) return;

    state.questionPracticeReturnView = "dashboard";
    state.questionBankSelectedGroupId = targetGroupId;
    state.questionBankSelectedGroup = null;
    state.questionBankGroupAnswerFilter = "all";
    state.questionBankGroupLoading = true;
    state.questionBankGroupError = "";
    resetQuestionExamSession(true);
    setView("questionPractice");
    renderQuestionPracticePage();
    await loadQuestionBankGroup(targetGroupId);
    renderQuestionPracticePage();
  }

  function closeQuestionBankPracticePage() {
    stopQuestionExamClock();
    state.dashboardSideTab = "questionBank";
    state.questionBankGroupAnswerFilter = "all";
    syncDashboardSideTabs();
    setView("dashboard");
    renderQuestionBankCenter();
  }

  function setQuestionExamIndex(index) {
    const rows = getQuestionExamRows();
    const nextIndex = Number(index);

    if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= rows.length) return;

    ensureQuestionExamState().currentIndex = Math.floor(nextIndex);
    renderQuestionPracticePage();
  }

  function captureQuestionExamDraft(target) {
    if (!(target instanceof Element) || !target.matches("[data-exam-answer]")) return;

    const questionNode = target.closest("[data-exam-question-id]");

    if (!questionNode) return;

    const questionId = String(questionNode.getAttribute("data-exam-question-id") || "").trim();

    if (!questionId) return;

    const checkedRows = Array.from(questionNode.querySelectorAll("input[data-exam-answer]:checked"));
    const textarea = questionNode.querySelector("textarea[data-exam-answer]");
    const answer = checkedRows.length
      ? joinQuestionBankChoiceAnswers(checkedRows.map((node) => node.value))
      : textarea
        ? String(textarea.value || "").trim()
        : "";
    const exam = ensureQuestionExamState();

    if (answer) {
      exam.answers[questionId] = answer;
    } else {
      delete exam.answers[questionId];
    }

    const rows = getQuestionExamRows();
    const answeredCount = getQuestionExamAnsweredCount(rows);
    const progressValue = el.questionPracticeHeaderMeta
      ? el.questionPracticeHeaderMeta.querySelector(".question-exam-header-progress strong")
      : null;
    const progressBar = el.questionPracticeHeaderMeta
      ? el.questionPracticeHeaderMeta.querySelector(".question-exam-progress-track i")
      : null;
    const navigatorCount = el.questionPracticeContent.querySelector(".question-exam-navigator-head strong");
    const numberButton = el.questionPracticeContent.querySelector(`.question-exam-number[data-exam-index="${exam.currentIndex}"]`);

    if (progressValue) progressValue.textContent = `${answeredCount}/${rows.length}`;
    if (navigatorCount) navigatorCount.textContent = `${answeredCount}/${rows.length}`;
    if (progressBar) progressBar.style.width = `${Math.round((answeredCount / rows.length) * 100)}%`;
    if (numberButton) numberButton.classList.toggle("is-answered", !!answer);
  }

  function readQuestionBankPaperAnswers() {
    const exam = ensureQuestionExamState();
    const rows = getQuestionExamRows();

    return rows.map((item) => {
      const questionId = String(item && item.question_id || "").trim();
      return {
        questionId,
        studentAnswer: String(exam.answers[questionId] || "").trim(),
      };
    }).filter((row) => row.questionId && row.studentAnswer);
  }

  async function submitQuestionBankPaper(button) {
    const rows = getQuestionExamRows();
    const answers = readQuestionBankPaperAnswers();

    if (!answers.length) {
      showToast("请先完成作答");
      return;
    }

    const unansweredCount = Math.max(0, rows.length - answers.length);
    const confirmMessage = unansweredCount > 0
      ? `还有 ${unansweredCount} 道题未作答，确认交卷？`
      : "确认提交本次模拟考试？";
    const confirmed = await confirmModalAsync(confirmMessage);

    if (!confirmed) return;

    const exam = ensureQuestionExamState();
    const pendingAnswers = answers.filter((row) => !exam.submittedIds[row.questionId]);
    const submitBtn = button instanceof HTMLElement ? button : null;
    const originalText = submitBtn ? submitBtn.textContent : "";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "交卷中...";
    }

    let submitted = 0;

    try {
      for (const answer of pendingAnswers) {
        await fetchJson("/api/frontend/question-bank/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_id: answer.questionId,
            student_answer: answer.studentAnswer,
          }),
        });
        exam.submittedIds[answer.questionId] = true;
        submitted += 1;
      }

      await refreshQuestionBankAfterAnswer();
      exam.reviewMode = true;
      exam.currentIndex = 0;
      stopQuestionExamClock();
      renderQuestionPracticePage();
      showToast(`已提交 ${answers.length} 道题`);
    } catch (err) {
      await refreshQuestionBankAfterAnswer();
      renderQuestionPracticePage();
      showToast(`已提交 ${submitted} 道，后续题目提交失败：${err.message || "未知错误"}`);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || "交卷";
      }
    }
  }

  function clearQuestionBankPaperInputs() {
    const exam = ensureQuestionExamState();
    const rows = getQuestionExamRows();
    const item = rows[exam.currentIndex];
    const questionId = String(item && item.question_id || "").trim();

    if (!questionId) return;

    delete exam.answers[questionId];
    renderQuestionPracticePage();
  }

  function renderQuestionExamSetList(groups) {
    const rows = Array.isArray(groups) ? groups : [];

    if (!rows.length) {
      return '<div class="question-exam-empty">当前没有可用练习</div>';
    }

    return `
      <div class="question-exam-set-list">
        ${rows.map((group) => {
          const safeGroup = normalizeQuestionBankGroup(group);
          const groupId = String(safeGroup.group_id || "").trim();
          const total = Number(safeGroup.total_count || 0);
          const answered = Number(safeGroup.answered_count || 0);
          const needsReview = Number(safeGroup.needs_review_count || 0);
          const completion = total > 0 ? Math.max(0, Math.min(100, Math.round((answered / total) * 100))) : 0;
          const meta = [
            safeGroup.lecture_title || getQuestionBankLectureTitle(safeGroup.lecture_id),
            safeGroup.book_title,
          ].filter(Boolean);

          return `
            <article class="question-exam-set-card" data-qb-action="open-group" data-group-id="${escapeHtml(groupId)}" role="button" tabindex="0">
              <div class="question-exam-set-topline">
                <span>${escapeHtml(safeGroup.source || "课程练习")}</span>
                <strong>${completion}%</strong>
              </div>
              <div class="question-exam-set-main">
                <h3>${escapeHtml(safeGroup.title || "未命名练习")}</h3>
                <p>${meta.map((value) => escapeHtml(value)).join(" · ")}</p>
              </div>
              <div class="question-exam-set-progress" aria-label="已完成 ${answered} / ${total} 题">
                <i style="width:${completion}%"></i>
              </div>
              <footer class="question-exam-set-footer">
                <div class="question-exam-set-stats">
                  <span>${total} 题</span>
                  <span>${answered} 已完成</span>
                  ${needsReview > 0 ? `<span class="is-review">${needsReview} 待复盘</span>` : ""}
                </div>
                <span class="question-exam-set-open" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg>
                </span>
              </footer>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderQuestionBankCenter() {
    if (!el.questionBankPanel) return;

    const rows = Array.isArray(state.questionBankItems) ? state.questionBankItems : [];
    const groups = getQuestionBankGroups();
    const summary = state.questionBankSummary || {};

    if (!rows.length || !groups.length) {
      const isMistakeFilter = state.questionBankFilter && state.questionBankFilter.answerState === "needs_review";
      el.questionBankPanel.innerHTML = `
        <section class="question-exam-center-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6Z"></path><path d="M9 11h6M9 15h4"></path></svg>
          <h2>${isMistakeFilter ? "当前没有待复盘题目" : "暂无模拟练习"}</h2>
          <p>${isMistakeFilter ? "已完成的错题复盘会从这里移出。" : "课程章节生成小测后，会在这里形成模拟试卷。"}</p>
          ${isMistakeFilter ? '<button class="question-exam-btn is-secondary" type="button" data-qb-action="clear-mistakes">返回全部练习</button>' : ""}
        </section>
      `;
      return;
    }

    const recommended = groups.find((group) => Number(group.pending_count || 0) > 0) || groups[0];
    const recommendedId = String(recommended && (recommended.group_id || recommended.question_group_id) || "").trim();
    const recommendedTitle = String(recommended && recommended.title || "模拟练习").trim();
    const total = Number(summary.total || 0) || rows.length;
    const pending = Number(summary.pending || 0);
    const review = Number(summary.needs_review || 0);

    el.questionBankPanel.innerHTML = `
      <section class="question-exam-center">
        <header class="question-exam-launch">
          <div class="question-exam-launch-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6Z"></path></svg>
          </div>
          <div class="question-exam-launch-copy">
            <span>推荐试卷</span>
            <h2>${escapeHtml(recommendedTitle)}</h2>
            <div class="question-exam-launch-meta">
              <span>${Number(recommended.total_count || 0)} 题</span>
              <span>${escapeHtml(recommended.source || "课程练习")}</span>
              ${Number(recommended.pending_count || 0) > 0 ? `<span>${Number(recommended.pending_count || 0)} 题待完成</span>` : ""}
            </div>
          </div>
          <div class="question-exam-launch-actions">
            ${review > 0 ? '<button class="question-exam-review-entry" type="button" data-qb-action="open-mistakes">错题重练</button>' : ""}
            <button class="question-exam-btn is-primary is-large" type="button" data-qb-action="open-group" data-group-id="${escapeHtml(recommendedId)}">
              开始模拟
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
          </div>
        </header>

        <section class="question-exam-range">
          <header>
            <div>
              <h2>全部试卷</h2>
              <span>${pending} 题尚未作答${review > 0 ? ` · ${review} 题需要复盘` : ""}</span>
            </div>
            <strong>${groups.length} 套 · ${total} 题</strong>
          </header>
          ${renderQuestionExamSetList(groups)}
          ${renderQuestionBankPagination("bottom")}
        </section>
      </section>
    `;
  }
