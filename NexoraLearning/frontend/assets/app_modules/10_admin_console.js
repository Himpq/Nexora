  const ADMIN_CONSOLE_ICONS = {
      add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
      edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/></svg>',
      outline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
      arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  const ADMIN_MATERIAL_STAGE_KEYS = ["coarse", "intensive", "section", "summary", "annotation", "video"];

  function normalizeAdminStatus(value) {
      return String(value || "").trim().toLowerCase();
  }

  function isAdminDone(value) {
      return ["done", "completed", "success"].includes(normalizeAdminStatus(value));
  }

  function isAdminRunning(value) {
      return ["queued", "running", "extracting"].includes(normalizeAdminStatus(value));
  }

  function isAdminError(value) {
      return ["error", "failed"].includes(normalizeAdminStatus(value));
  }

  function getAdminLectureRefinementRows(lectureId) {
      const resolvedLectureId = String(lectureId || "").trim();

      return (Array.isArray(state.refinementRows) ? state.refinementRows : []).filter((row) => (
          String(row && row.lecture_id || "").trim() === resolvedLectureId
      ));
  }

  function getAdminBookProcessingState(refinementRow) {
      if (!refinementRow) {
          return { tone: "idle", label: "等待处理" };
      }

      const pipelineStatus = normalizeAdminStatus(refinementRow.pipeline_status || refinementRow.pipeline_job_status);
      if (isAdminError(pipelineStatus)) {
          return { tone: "error", label: "自动处理失败" };
      }

      if (isAdminRunning(pipelineStatus)) {
          return { tone: "running", label: "自动处理中" };
      }

      if (isAdminDone(pipelineStatus)) {
          return { tone: "done", label: "自动处理完成" };
      }

      const statuses = ADMIN_MATERIAL_STAGE_KEYS.map((key) => normalizeAdminStatus(refinementRow[`${key}_status`]));

      if (statuses.some(isAdminError)) {
          return { tone: "error", label: "处理失败" };
      }

      if (statuses.some(isAdminRunning)) {
          return { tone: "running", label: "处理中" };
      }

      if (statuses.every(isAdminDone)) {
          return { tone: "done", label: "处理完成" };
      }

      const doneCount = statuses.filter(isAdminDone).length;

      return doneCount
          ? { tone: "idle", label: `${doneCount}/${statuses.length} 已完成` }
          : { tone: "idle", label: "等待处理" };
  }

  function getAdminLectureProcessingState(lectureId, books) {
      const refinementRows = getAdminLectureRefinementRows(lectureId);
      const refinementByBook = new Map(refinementRows.map((row) => [String(row.book_id || ""), row]));
      const bookRows = (Array.isArray(books) ? books : []).map((book) => (
          getAdminBookProcessingState(refinementByBook.get(String(book.id || "")))
      ));

      if (!bookRows.length) {
          return { tone: "idle", label: "暂无教材", detail: "0 本教材" };
      }

      const errorCount = bookRows.filter((row) => row.tone === "error").length;
      const runningCount = bookRows.filter((row) => row.tone === "running").length;
      const doneCount = bookRows.filter((row) => row.tone === "done").length;

      if (errorCount) {
          return { tone: "error", label: "存在失败", detail: `${errorCount} 本失败` };
      }

      if (runningCount) {
          return { tone: "running", label: "处理中", detail: `${runningCount} 本处理中` };
      }

      if (doneCount === bookRows.length) {
          return { tone: "done", label: "全部完成", detail: `${doneCount} 本已完成` };
      }

      return { tone: "idle", label: "等待处理", detail: `${doneCount}/${bookRows.length} 本已完成` };
  }

  function getAdminLectureStatusLabel(status) {
      const value = normalizeAdminStatus(status);
      const labels = {
          draft: "草稿",
          active: "进行中",
          ready: "已准备",
          archived: "已归档",
      };

      return labels[value] || (value ? value : "未设置");
  }

  function renderAdminCourseListItem(courseRow, selectedId) {
      const lecture = courseRow && courseRow.lecture || {};
      const lectureId = String(lecture.id || "").trim();
      const title = String(lecture.title || "未命名课程").trim();
      const category = String(lecture.category || "未分类").trim();
      const books = Array.isArray(courseRow && courseRow.books) ? courseRow.books : [];
      const coverPath = String(lecture.cover_path || lecture.cover || "").trim();

      return `
          <button class="admin-course-list-item${lectureId === selectedId ? " is-active" : ""}" type="button" data-admin-action="select-course" data-lecture-id="${escapeHtml(lectureId)}">
              <span class="admin-course-list-icon">
                  ${coverPath
                      ? `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="">`
                      : ADMIN_CONSOLE_ICONS.book}
              </span>
              <span class="admin-course-list-copy">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(category)} · ${books.length} 本教材</span>
              </span>
          </button>
      `;
  }

  function renderAdminCourseBookRow(book, refinementRow, lectureId) {
      const resolvedLectureId = String(lectureId || refinementRow && refinementRow.lecture_id || "").trim();
      const bookId = String(book && book.id || refinementRow && refinementRow.book_id || "").trim();
      const title = String(book && (book.title || book.id) || "未命名教材").trim();
      const description = String(book && book.description || "").trim();
      const coverPath = String(book && (book.cover_path || book.cover) || refinementRow && (refinementRow.cover_path || refinementRow.cover) || "").trim();
      const processing = getAdminBookProcessingState(refinementRow);

      return `
          <button class="admin-course-book-row" type="button" data-admin-action="open-material" data-lecture-id="${escapeHtml(resolvedLectureId)}" data-book-id="${escapeHtml(bookId)}">
              <span class="admin-course-book-icon">
                  ${coverPath
                      ? `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="" loading="lazy">`
                      : ADMIN_CONSOLE_ICONS.book}
              </span>
              <div class="admin-course-book-copy">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(description || String(book && (book.text_status || book.status) || "教材已加入课程"))}</span>
              </div>
              <span class="admin-status is-${escapeHtml(processing.tone)}">${escapeHtml(processing.label)}</span>
          </button>
      `;
  }

  function renderAdminCourseDialog(courseRow) {
      const mode = String(state.adminCourseDialog || "").trim();

      if (!mode) {
          return "";
      }

      const lecture = courseRow && courseRow.lecture || {};
      const isCreate = mode === "create";
      const submitAction = isCreate ? "create-settings-course" : "save-settings-course";

      return `
          <div class="admin-dialog-layer" role="presentation">
              <button class="admin-dialog-backdrop" type="button" data-admin-action="close-dialog" aria-label="关闭对话框"></button>
              <section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="adminCourseDialogTitle">
                  <header class="admin-dialog-head">
                      <h2 id="adminCourseDialogTitle">${isCreate ? "新建课程" : "编辑课程"}</h2>
                      <button class="admin-icon-button" type="button" data-admin-action="close-dialog" aria-label="关闭" title="关闭">${ADMIN_CONSOLE_ICONS.close}</button>
                  </header>
                  <div class="admin-dialog-body">
                      <label class="admin-field">
                          <span>课程名称</span>
                          <input id="${isCreate ? "settingsCreateLectureTitleInput" : "settingsCourseTitleInput"}" class="input-lite" value="${escapeHtml(isCreate ? "" : String(lecture.title || ""))}" placeholder="输入课程名称">
                      </label>
                      <label class="admin-field">
                          <span>课程分类</span>
                          <input id="${isCreate ? "settingsCreateLectureCategoryInput" : "settingsCourseCategoryInput"}" class="input-lite" value="${escapeHtml(isCreate ? "" : String(lecture.category || ""))}" placeholder="输入课程分类">
                      </label>
                      ${isCreate ? `
                          <fieldset class="admin-field admin-status-field">
                              <legend>课程状态</legend>
                              <input id="settingsCreateLectureStatusSelect" type="hidden" value="draft">
                              <div class="admin-status-options" role="group" aria-label="课程状态">
                                  <button class="is-active" type="button" data-admin-action="select-create-status" data-status="draft">草稿</button>
                                  <button type="button" data-admin-action="select-create-status" data-status="active">进行中</button>
                                  <button type="button" data-admin-action="select-create-status" data-status="ready">已准备</button>
                                  <button type="button" data-admin-action="select-create-status" data-status="archived">归档</button>
                              </div>
                          </fieldset>
                      ` : ""}
                      <label class="admin-field admin-field-wide">
                          <span>课程简介</span>
                          <textarea id="${isCreate ? "settingsCreateLectureDescriptionInput" : "settingsCourseDescInput"}" class="input-lite input-textarea" rows="5" placeholder="输入课程目标和内容范围">${escapeHtml(isCreate ? "" : String(lecture.description || ""))}</textarea>
                      </label>
                      ${isCreate ? "" : `<input id="settingsCourseCoverInput" type="hidden" value="${escapeHtml(String(lecture.cover_path || lecture.cover || ""))}">`}
                  </div>
                  <footer class="admin-dialog-foot">
                      <button class="admin-button" type="button" data-admin-action="close-dialog">取消</button>
                      <button class="admin-button-primary" type="button" data-action="${submitAction}">${isCreate ? "创建课程" : "保存修改"}</button>
                  </footer>
              </section>
          </div>
      `;
  }

  function renderAdminCourseMain(courseRow) {
      const lecture = courseRow && courseRow.lecture || {};
      const lectureId = String(lecture.id || "").trim();
      const title = String(lecture.title || "未命名课程").trim();
      const category = String(lecture.category || "未分类").trim();
      const description = String(lecture.description || "").trim();
      const books = Array.isArray(courseRow && courseRow.books) ? courseRow.books : [];
      const refinementRows = getAdminLectureRefinementRows(lectureId);
      const refinementByBook = new Map(refinementRows.map((row) => [String(row.book_id || ""), row]));
      const processing = getAdminLectureProcessingState(lectureId, books);
      const outline = getLectureOutlineState(lectureId);
      const outlineActivity = state.outlineActivity || {};
      const isOutlineRunning = Boolean(outlineActivity.running && outlineActivity.lectureId === lectureId);
      const outlineDescription = outlineActivity.error || outline.error || (
          isOutlineRunning
              ? "正在根据已完成处理的教材生成课程结构。"
              : outline.tone === "done"
                  ? "课程结构已生成，可供个人学习路径使用。"
                  : "从已完成处理的教材生成课程级结构，供个人学习路径使用。"
      );
      const showOutlineActivity = outlineActivity.lectureId === lectureId && (
          outlineActivity.running || outlineActivity.error || outlineActivity.draft
      );

      return `
          <div class="admin-course-main-inner">
              <header class="admin-course-header">
                  <div>
                      <h2>${escapeHtml(title)}</h2>
                      <div class="admin-course-meta">${escapeHtml(category)}${description ? ` · ${escapeHtml(description)}` : ""}</div>
                  </div>
                  <div class="admin-course-header-actions">
                      <button class="admin-button" type="button" data-admin-action="edit-course" data-lecture-id="${escapeHtml(lectureId)}">${ADMIN_CONSOLE_ICONS.edit}<span>编辑课程</span></button>
                  </div>
              </header>

              <div class="admin-course-summary">
                  <div class="admin-course-summary-item">
                      <span>课程状态</span>
                      <strong>${escapeHtml(getAdminLectureStatusLabel(lecture.status))}</strong>
                  </div>
                  <div class="admin-course-summary-item">
                      <span>课程教材</span>
                      <strong>${books.length} 本</strong>
                  </div>
                  <div class="admin-course-summary-item">
                      <span>课程结构</span>
                      <strong>${escapeHtml(isOutlineRunning ? "生成中" : (outline.tone === "done" ? "已就绪" : "未生成"))}</strong>
                  </div>
              </div>

              <section class="admin-course-section">
                  <div class="admin-course-section-head">
                      <div>
                          <h3>课程结构</h3>
                          <div class="admin-course-meta">${escapeHtml(outlineDescription)}</div>
                      </div>
                      <div class="admin-course-section-actions">
                          <span class="admin-status is-${escapeHtml(isOutlineRunning ? "running" : outline.tone)}">${escapeHtml(isOutlineRunning ? "生成中" : outline.label)}</span>
                          <button class="admin-button-primary admin-course-outline-action" type="button" data-admin-action="generate-outline" data-lecture-id="${escapeHtml(lectureId)}" ${isOutlineRunning ? "disabled" : ""}>${ADMIN_CONSOLE_ICONS.outline}<span>${outline.tone === "done" ? "更新课程结构" : "生成课程结构"}</span></button>
                      </div>
                  </div>
                  ${showOutlineActivity ? `
                      <div class="admin-outline-activity">
                          <div class="admin-outline-events">
                              ${(outlineActivity.lines || []).map((line) => `<div>${escapeHtml(line)}</div>`).join("") || "<div>等待模型活动</div>"}
                          </div>
                          <pre class="admin-outline-draft">${escapeHtml(String(outlineActivity.draft || outlineActivity.error || "等待模型输出"))}</pre>
                      </div>
                  ` : ""}
              </section>

              <section class="admin-course-section">
                  <div class="admin-course-section-head">
                      <div>
                          <h3>课程教材</h3>
                          <div class="admin-course-meta">${escapeHtml(processing.detail)}</div>
                      </div>
                  </div>
                  <div class="admin-course-book-list">
                      ${books.length
                          ? books.map((book) => renderAdminCourseBookRow(book, refinementByBook.get(String(book.id || "")), lectureId)).join("")
                          : '<div class="admin-empty">当前课程还没有教材</div>'}
                  </div>
              </section>
          </div>
      `;
  }

  function renderAdminCourseManagement() {
      const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
      const firstLectureId = rows.length ? String((rows[0].lecture || {}).id || "").trim() : "";
      const selectedId = String(state.settingsCourseEditId || state.adminCourseSelectedId || firstLectureId).trim();
      const selectedRow = rows.find((row) => String((row.lecture || {}).id || "").trim() === selectedId) || rows[0] || null;
      const resolvedSelectedId = selectedRow ? String((selectedRow.lecture || {}).id || "").trim() : "";

      state.adminCourseSelectedId = resolvedSelectedId;
      state.settingsCourseEditId = resolvedSelectedId;
      state.refinementViewBootstrapped = false;

      el.settingsDetailPane.innerHTML = `
          <section class="admin-course-page">
              <aside class="admin-course-list-pane">
                  <header class="admin-course-list-head">
                      <h2>课程</h2>
                      <button class="admin-icon-button" type="button" data-admin-action="create-course" aria-label="新建课程" title="新建课程">${ADMIN_CONSOLE_ICONS.add}</button>
                  </header>
                  <label class="admin-course-search">
                      ${ADMIN_CONSOLE_ICONS.search}
                      <input id="adminCourseSearchInput" type="search" placeholder="搜索课程" autocomplete="off">
                  </label>
                  <div class="admin-course-list" id="adminCourseList">
                      ${rows.length
                          ? rows.map((row) => renderAdminCourseListItem(row, resolvedSelectedId)).join("")
                          : '<div class="admin-empty">暂无课程</div>'}
                  </div>
              </aside>
              <main class="admin-course-main">
                  ${selectedRow ? renderAdminCourseMain(selectedRow) : '<div class="admin-empty">请先创建课程</div>'}
              </main>
          </section>
          ${renderAdminCourseDialog(selectedRow)}
      `;

      initAdminConsoleCourseEvents();
  }

  function filterAdminCourseList(query) {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      const list = document.getElementById("adminCourseList");

      if (!list) {
          return;
      }

      list.querySelectorAll(".admin-course-list-item").forEach((item) => {
          const text = String(item.textContent || "").toLowerCase();
          item.hidden = Boolean(normalizedQuery && !text.includes(normalizedQuery));
      });
  }

  function initAdminConsoleCourseEvents() {
      if (state.adminConsoleCourseEventsBound) {
          return;
      }

      state.adminConsoleCourseEventsBound = true;

      el.settingsDetailPane.addEventListener("input", (event) => {
          const target = event.target;

          if (target instanceof HTMLInputElement && target.id === "adminCourseSearchInput") {
              filterAdminCourseList(target.value);
          }
      });

      el.settingsDetailPane.addEventListener("click", async (event) => {
          const target = event.target;

          if (!(target instanceof Element)) {
              return;
          }

          const actionElement = target.closest("[data-admin-action]");

          if (!actionElement) {
              return;
          }

          const action = String(actionElement.getAttribute("data-admin-action") || "").trim();
          const lectureId = String(actionElement.getAttribute("data-lecture-id") || "").trim();

          if (action === "select-course") {
              state.adminCourseSelectedId = lectureId;
              state.settingsCourseEditId = lectureId;
              state.adminCourseDialog = "";
              renderAdminCourseManagement();
              return;
          }

          if (action === "create-course") {
              state.adminCourseDialog = "create";
              renderAdminCourseManagement();
              return;
          }

          if (action === "edit-course") {
              state.adminCourseDialog = "edit";
              renderAdminCourseManagement();
              return;
          }

          if (action === "close-dialog") {
              state.adminCourseDialog = "";
              renderAdminCourseManagement();
              return;
          }

          if (action === "select-create-status") {
              const status = String(actionElement.getAttribute("data-status") || "draft").trim();
              const input = document.getElementById("settingsCreateLectureStatusSelect");

              if (input instanceof HTMLInputElement) {
                  input.value = status;
              }

              el.settingsDetailPane.querySelectorAll("[data-admin-action='select-create-status']").forEach((button) => {
                  button.classList.toggle("is-active", button === actionElement);
              });

              return;
          }

          if (action === "open-materials") {
              if (lectureId) {
                  state.selectedLectureId = lectureId;
                  const firstBook = getAdminLectureRefinementRows(lectureId)[0];
                  if (firstBook) {
                      state.selectedAgentBookKey = getSettingsRefinementBookKey(firstBook.lecture_id, firstBook.book_id);
                  }
              }
              await openSettingsView("refinement");
              return;
          }

          if (action === "open-material") {
              const bookId = String(actionElement.getAttribute("data-book-id") || "").trim();
              if (lectureId) {
                  state.selectedLectureId = lectureId;
              }
              if (lectureId && bookId) {
                  state.selectedAgentBookKey = getSettingsRefinementBookKey(lectureId, bookId);
              }
              await openSettingsView("refinement");
              return;
          }

          if (action === "generate-outline") {
              const confirmed = await confirmModalAsync(MANUAL_OUTLINE_CONFIRM_MESSAGE);

              if (!confirmed) {
                  return;
              }

              actionElement.setAttribute("disabled", "disabled");

              try {
                  await startOutline(lectureId);
                  showToast("课程大纲生成完成");
              } catch (error) {
                  showToast(`课程大纲生成失败：${error.message || "未知错误"}`);
              } finally {
                  renderAdminCourseManagement();
              }
          }
      });
  }
