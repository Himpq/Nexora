// ─────── Upload & Materials Actions ───────────────────────────────────
  const MANUAL_OUTLINE_CONFIRM_MESSAGE = "确认手动生成课程结构？此操作会调用模型并覆盖现有结构；新教材处理完成后系统会自动更新。";
  const MATERIAL_PIPELINE_RERUN_CONFIRM_MESSAGE = "确认重新执行教材处理？已完成阶段会重新调用模型并覆盖现有解析结果。";

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

  function renderSelectedUploadFileState(file) {
    if (!el.materialsFileDropZone || !el.materialsFileDropTitle || !el.materialsFileDropSub) {
        return;
    }

    const selectedFile = file || state.selectedUploadFile;
    if (!selectedFile) {
        el.materialsFileDropZone.classList.remove("has-file");
        el.materialsFileDropTitle.textContent = "拖拽教材文件到这里";
        el.materialsFileDropSub.textContent = "或点击区域选择文件";
        return;
    }

    const name = String(selectedFile.name || "").trim();
    const sizeMB = selectedFile.size ? (selectedFile.size / (1024 * 1024)).toFixed(2) : "0.00";

    el.materialsFileDropZone.classList.add("has-file");
    el.materialsFileDropTitle.textContent = name || "已选择教材文件";
    el.materialsFileDropSub.textContent = `${sizeMB} MB · 点击或拖拽可替换`;
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
    rememberSelectedUploadFile(file);
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

  async function handleSelectedUploadFile(file) {
    if (!file) {
        if (state.selectedUploadFile) {
            renderSelectedUploadFileState(state.selectedUploadFile);
            return;
        }

        renderUploadPreviewEmpty("请选择教材文件后预览");
        renderSelectedUploadFileState(null);
        return;
    }

    rememberSelectedUploadFile(file);

    try {
        await previewSelectedFile(file);
        setUploadTip(`已选择：${String(file.name || "").trim()}`, false);
    } catch (err) {
        const name = String(file.name || "").trim();
        const sizeMB = file && file.size ? (file.size / (1024 * 1024)).toFixed(2) : "0.00";
        el.materialsPreviewPane.innerHTML = `
          <div class="materials-empty">文件已选择，但当前无法生成预览</div>
          <div class="materials-preview-foot">文件：${escapeHtml(name)} · 大小：${sizeMB} MB</div>
        `;
        setUploadTip(`已选择：${name}。预览失败：${err && err.message ? err.message : "未知错误"}`, true);
    }
  }

  async function fetchJson(url, init) {
    const options = init && typeof init === "object" ? { ...init } : {};
    const headers = new Headers(options.headers || {});
    const runtimeUsername = getRuntimeUsername();

    if (runtimeUsername && !headers.has("X-Nexora-Username")) {
      headers.set("X-Nexora-Username", runtimeUsername);
    }

    const requestPath = String(url || "").split("?")[0];
    if (!runtimeUsername && requestPath.includes("/api/frontend/") && !requestPath.includes("/api/frontend/context")) {
      console.warn("[NexoraLearning] frontend request missing runtime username", { path: requestPath });
    }

    if (typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    options.headers = headers;

    if (!options.credentials) {
      options.credentials = "same-origin";
    }

    const resp = await fetch(resolveApiUrl(url), options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${resp.status}`);
    }
    return data;
  }

  async function loadFrontendContext() {
    const qs = state.username ? `?username=${encodeURIComponent(state.username)}` : "";
    try {
      const data = await fetchJson(`/api/frontend/context${qs}`, { credentials: "include" });
      state.user = data && typeof data.user === "object" ? data.user : {};
      state.integration = data && typeof data.integration === "object" ? data.integration : {};
      const resolvedUsername = String(data.username || "").trim();
      if (resolvedUsername) {
        state.username = resolvedUsername;
      }
      if (!state.username) {
        throw new Error("无法解析当前登录用户");
      }
      syncTelemetryUserId();
      const role = String(state.user.role || "").trim().toLowerCase();
      state.isAdmin = !!data.is_admin || role === "admin";
    } catch (err) {
      console.error("[NexoraLearning] frontend context failed", {
        username: getRuntimeUsername(),
        message: err && err.message ? String(err.message) : String(err || ""),
      });
      state.user = {};
      state.integration = {};
      state.isAdmin = false;
      throw err;
    }
  }

// ─────── Settings Channels ────────────────────────────────────────────

  /**
   * 渲染用户卡片（参考用户管理样式）
   */
  function renderUserCardHtml(user, isSelected, isEditing, channelId) {
      const userId = String(user.user_id || user.id || "").trim();
      const displayName = String(user.display_name || user.name || userId).trim();
      const nickname = String(user.nickname || "").trim();
      const handle = String(user.handle || user.user_id || "").trim();
      const avatarUrl = normalizeFeedAvatarUrl(String(user.avatar_url || "").trim());
      const avatarText = String((displayName || nickname || userId || "U").trim().slice(0, 1) || "U").toUpperCase();

      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      const MINUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      const addAction = isEditing ? "add-user-to-channel" : "add-user-to-selection";
      const removeAction = isEditing ? "remove-user-from-channel" : "remove-user-from-selection";
      const channelAttr = isEditing && channelId ? ` data-channel-id="${escapeHtml(channelId)}"` : "";

      return `
          <article class="settings-user-card channel-user-card" data-user-id="${escapeHtml(userId)}">
              <div class="settings-user-main">
                  ${avatarUrl
                      ? `<img class="settings-user-avatar settings-user-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                      : `<div class="settings-user-avatar">${escapeHtml(avatarText)}</div>`}
                  <div class="settings-user-meta">
                      <div class="settings-user-title">
                          <span>${escapeHtml(displayName)}</span>
                          ${nickname && nickname !== displayName ? `<span class="settings-user-pill">${escapeHtml(nickname)}</span>` : ""}
                      </div>
                      <div class="settings-user-sub">@${escapeHtml(handle || userId)}</div>
                  </div>
              </div>
              <div class="channel-user-action">
                  ${isSelected
                      ? `<button class="channel-action-btn channel-action-remove" type="button" data-action="${removeAction}" data-user-id="${escapeHtml(userId)}"${channelAttr} title="移出" aria-label="移出">${MINUS_ICON}</button>`
                      : `<button class="channel-action-btn channel-action-add" type="button" data-action="${addAction}" data-user-id="${escapeHtml(userId)}"${channelAttr} title="添加" aria-label="添加">${PLUS_ICON}</button>`}
              </div>
          </article>
      `;
  }

  /**
   * 渲染频道编辑面板（右侧内容）
   */
  function renderChannelEditPanelHtml(channel, allUsers) {
      const channelId = String(channel ? (channel.id || "") : "").trim();
      const isEditing = !!channel;
      const title = isEditing ? String(channel.title || "") : String(state.channelEditState.title || "");
      const isPublic = state.channelEditState.isAllPublic === true;
      const selectedUserIds = Array.isArray(state.channelEditState.selectedUserIds) ? state.channelEditState.selectedUserIds : [];
      const selectedSet = new Set(selectedUserIds);

      const selectedUsers = [];
      const otherUsers = [];

      if (isPublic) {
          // 全员公开时，显示 ALL 卡片，其他用户放在可选列表
          otherUsers.push(...allUsers);
      } else {
          for (const user of allUsers) {
              const userId = String(user.user_id || user.id || "").trim();
              if (selectedSet.has(userId)) {
                  selectedUsers.push(user);
              } else {
                  otherUsers.push(user);
              }
          }
      }

      const searchQuery = String(state.channelEditState.searchQuery || "").trim();

      let filteredOtherUsers = otherUsers;
      if (searchQuery) {
          const query = searchQuery.toLowerCase();
          filteredOtherUsers = otherUsers.filter((user) => {
              const userId = String(user.user_id || user.id || "").toLowerCase();
              const displayName = String(user.display_name || user.name || "").toLowerCase();
              const nickname = String(user.nickname || "").toLowerCase();
              return userId.includes(query) || displayName.includes(query) || nickname.includes(query);
          });
      }

      const ALL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      const MINUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

      return `
          <div class="channel-edit-form">
              <div class="materials-form-row">
                  <label class="materials-form-label" for="settingsChannelTitleInput">频道名</label>
                  <div class="channel-title-input-row">
                      <input id="settingsChannelTitleInput" class="input-lite" placeholder="例如：春物私有研读" value="${escapeHtml(title)}">
                      <button id="saveFeedChannelBtn" class="settings-course-action-btn" type="button" aria-label="保存频道" title="保存频道">${SAVE_ICON}</button>
                  </div>
              </div>
          </div>
          <div class="channel-users-layout">
              <div class="channel-users-column">
                  <div class="channel-users-header">
                      <span class="channel-users-title">已选用户 (${isPublic ? "全员" : selectedUsers.length})</span>
                  </div>
                   <div class="channel-users-list">
                      ${isPublic
                          ? `<article class="settings-user-card channel-user-card channel-all-card">
                                  <div class="settings-user-main">
                                      <div class="settings-user-avatar channel-all-avatar">${ALL_ICON}</div>
                                      <div class="settings-user-meta">
                                          <div class="settings-user-title"><span>全员公开</span></div>
                                          <div class="settings-user-sub">所有用户可见</div>
                                      </div>
                                  </div>
                                  <div class="channel-user-action">
                                      <button class="channel-action-btn channel-action-remove" type="button" data-action="toggle-all-public-off" title="取消全员公开" aria-label="取消全员公开">${MINUS_ICON}</button>
                                  </div>
                              </article>`
                          : selectedUsers.length
                              ? selectedUsers.map((user) => renderUserCardHtml(user, true, isEditing, channelId)).join("")
                              : '<div class="materials-empty">暂无用户</div>'}
                  </div>
              </div>
              <div class="channel-users-column">
                  <div class="channel-users-header">
                      <span class="channel-users-title">可选用户 (${filteredOtherUsers.length})</span>
                      <input class="input-lite channel-user-search" type="text" placeholder="搜索用户..." value="${escapeHtml(searchQuery)}" data-channel-user-search>
                  </div>
                  <div class="channel-users-list">
                      ${!isPublic ? `
                          <article class="settings-user-card channel-user-card channel-all-option" data-action="toggle-all-public-on">
                              <div class="settings-user-main">
                                  <div class="settings-user-avatar channel-all-avatar">${ALL_ICON}</div>
                                  <div class="settings-user-meta">
                                      <div class="settings-user-title"><span>全员公开</span></div>
                                      <div class="settings-user-sub">点击设为全员公开</div>
                                  </div>
                              </div>
                              <div class="channel-user-action">
                                  <button class="channel-action-btn channel-action-add" type="button" title="设为全员公开" aria-label="设为全员公开">${PLUS_ICON}</button>
                              </div>
                          </article>
                      ` : ""}
                      ${filteredOtherUsers.length
                          ? filteredOtherUsers.map((user) => renderUserCardHtml(user, false, isEditing, channelId)).join("")
                          : '<div class="materials-empty">暂无用户</div>'}
                  </div>
              </div>
          </div>
      `;
  }

  /**
   * 渲染课程管理设置页面
   */
  function renderSettingsCourses() {
    const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const firstLectureId = rows.length ? String((rows[0].lecture || {}).id || "").trim() : "";
    const selectedId = state.settingsCourseEditId || firstLectureId;
    if (selectedId && state.settingsCourseEditId !== selectedId) {
      state.settingsCourseEditId = selectedId;
    }

    const courseListHtml = rows.length
      ? rows.map((row) => {
          const lecture = row.lecture || {};
          const lid = String(lecture.id || "").trim();
          const title = String(lecture.title || "未命名课程").trim();
          const isActive = lid === selectedId && state.settingsCourseView !== "create";
          const bookCount = Array.isArray(row.books) ? row.books.length : 0;
          const category = String(lecture.category || "未分类").trim();
          const coverPath = String(lecture.cover_path || lecture.cover || "").trim();
          return `
            <div class="settings-course-list-item${isActive ? " is-active" : ""}" data-action="select-settings-course" data-lecture-id="${escapeHtml(lid)}">
              ${coverPath
                ? `<div class="settings-course-list-cover"><img src="${escapeHtml(resolveApiUrl(coverPath))}" alt=""></div>`
                : '<div class="settings-course-list-cover settings-course-list-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>'}
              <div class="settings-course-list-info">
                <span class="settings-course-list-title">${escapeHtml(title)}</span>
              <span class="settings-course-list-meta">${escapeHtml(category)} · ${bookCount} 本教材</span>
              </div>
            </div>
          `;
        }).join("")
      : '<div class="materials-empty">暂无课程</div>';

    const selectedRow = selectedId
      ? rows.find((row) => String((row.lecture || {}).id || "").trim() === selectedId)
      : null;
    const lecture = selectedRow ? (selectedRow.lecture || {}) : {};
    const books = selectedRow ? (Array.isArray(selectedRow.books) ? selectedRow.books : []) : [];
    const lectureTitle = String(lecture.title || "").trim();
    const lectureCategory = String(lecture.category || "").trim();
    const lectureDescription = String(lecture.description || "").trim();
    const coverPath = String(lecture.cover_path || lecture.cover || "").trim();
    const outlineState = getLectureOutlineState(selectedId);
    const outlineActivity = state.outlineActivity || {};
    const isOutlineRunning = Boolean(outlineActivity.running && outlineActivity.lectureId === selectedId);

    const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
    const COVER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    const OUTLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>';

    const createPanelHtml = `
      <section class="settings-course-workbench">
        <section class="settings-inline-card settings-course-create-page">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">新建课程</div>
              <div class="settings-inline-sub">课程是教材、大纲与个性化学习路线的归属单位。</div>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="show-settings-course-detail" aria-label="返回列表" title="返回列表">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
          <div class="settings-inline-form settings-course-create-form">
            <label class="settings-field">
              <span>课程名</span>
              <input id="settingsCreateLectureTitleInput" class="input-lite" placeholder="例如：机器学习导论">
            </label>
            <label class="settings-field">
              <span>分类</span>
              <input id="settingsCreateLectureCategoryInput" class="input-lite" placeholder="AI / 前端 / 语言">
            </label>
            <label class="settings-field">
              <span>状态</span>
              <select id="settingsCreateLectureStatusSelect" class="input-lite">
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="ready">已准备</option>
                <option value="archived">归档</option>
              </select>
            </label>
            <label class="settings-field settings-field-wide">
              <span>描述</span>
              <textarea id="settingsCreateLectureDescriptionInput" class="input-lite input-textarea" placeholder="课程简介、目标、学习范围"></textarea>
            </label>
            <button class="settings-course-action-btn" type="button" data-action="create-settings-course" aria-label="创建课程" title="创建课程">
              ${SAVE_ICON}
            </button>
          </div>
        </section>
      </section>
    `;

    const editPanelHtml = selectedId && selectedRow ? `
      <section class="settings-course-workbench">
        <div class="settings-course-two-column">
          <section class="settings-inline-card">
            <div class="settings-inline-head">
              <div>
                <div class="settings-inline-title">课程资料</div>
                <div class="settings-inline-sub">当前课程的基础信息和封面都在这里维护。</div>
              </div>
              <button class="settings-course-action-btn" type="button" data-action="save-settings-course" aria-label="保存课程" title="保存课程">${SAVE_ICON}</button>
            </div>
            <div class="settings-course-form-body">
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程名称</label>
                <input id="settingsCourseTitleInput" class="input-lite" value="${escapeHtml(lectureTitle)}" placeholder="课程名称">
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程分类</label>
                <input id="settingsCourseCategoryInput" class="input-lite" value="${escapeHtml(lectureCategory)}" placeholder="例如：AI / 前端 / 语言">
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程简介</label>
                <textarea id="settingsCourseDescInput" class="input-lite input-textarea" rows="3" placeholder="课程简介">${escapeHtml(lectureDescription)}</textarea>
              </div>
              <div class="settings-course-form-grid">
                <label class="settings-course-label">课程封面</label>
                <div class="settings-course-cover-area">
                  <div class="settings-course-cover-preview" id="settingsCourseCoverPreview">
                    ${coverPath
                      ? `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="封面">`
                      : `<div class="settings-course-cover-empty">${COVER_ICON}<span>暂无封面</span></div>`}
                  </div>
                  <input type="hidden" id="settingsCourseCoverInput" value="${escapeHtml(coverPath)}">
                  <button class="settings-course-cover-btn" type="button" data-action="open-cover-picker" aria-label="选择封面" title="选择封面">${COVER_ICON}</button>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-inline-card settings-outline-card">
            <div class="settings-inline-head">
              <div>
                <div class="settings-inline-title">课程大纲</div>
                <div class="settings-inline-sub">大纲属于课程，不再混在教材解析流程里。</div>
              </div>
              <span class="settings-status-pill is-${escapeHtml(isOutlineRunning ? "running" : outlineState.tone)}">${escapeHtml(isOutlineRunning ? "生成中" : outlineState.label)}</span>
            </div>
            <div class="settings-outline-body">
              <div class="settings-outline-icon">${OUTLINE_ICON}</div>
              <div class="settings-outline-copy">
                <div class="settings-outline-title">${escapeHtml(lectureTitle || "未命名课程")}</div>
                <div class="settings-inline-sub">${escapeHtml(outlineActivity.error || outlineState.error || "从该课程已有教材汇总生成统一大纲，学习路径直接读取这里。")}</div>
              </div>
            </div>
            <div class="settings-outline-activity">
              <div class="settings-outline-activity-head">模型活动</div>
              <div class="settings-outline-activity-body">
                ${(isOutlineRunning ? (outlineActivity.lines || []) : [
                  outlineState.status ? `当前状态：${outlineState.label}` : "尚未生成课程大纲",
                  "点击“生成大纲”后，这里会实时显示模型活动。",
                ]).map((line) => `<div class=\"settings-outline-activity-line\">${escapeHtml(line)}</div>`).join("")}
              </div>
              <section class="reader-guide-stream settings-outline-stream">
                <div class="reader-guide-stream-label">实时输出</div>
                <pre class="reader-guide-draft settings-outline-draft">${escapeHtml(String(outlineActivity.draft || "").trim() || "等待模型开始输出...")}</pre>
              </section>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="start-course-outline" data-lecture-id="${escapeHtml(selectedId)}" ${(canStartOutline({ outline_status: outlineState.status }) && !isOutlineRunning) ? "" : "disabled"} aria-label="${escapeHtml(isOutlineRunning ? "生成中" : "生成大纲")}" title="${escapeHtml(isOutlineRunning ? "生成中" : "生成大纲")}">
              ${OUTLINE_ICON}
            </button>
          </section>
        </div>

        <section class="settings-inline-card">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">课程教材</div>
              <div class="settings-inline-sub">这里只看归属和状态，上传与解析统一回到教材管理。</div>
            </div>
          </div>
          <div class="settings-course-book-grid">
            ${books.length
              ? books.map((b) => {
                  const bookTitle = String(b.title || b.id || "").trim();
                  const bookCover = String(b.cover_path || "").trim();
                  const bookImages = b.images_count || 0;
                  const textStatus = String(b.text_status || b.status || "未解析").trim();
                  return `
                    <div class="settings-course-book-card">
                      ${bookCover
                        ? `<div class="settings-course-book-cover"><img src="${escapeHtml(resolveApiUrl(bookCover))}" alt=""></div>`
                        : '<div class="settings-course-book-cover settings-course-book-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/></svg></div>'}
                      <div class="settings-course-book-info">
                        <span class="settings-course-book-title">${escapeHtml(bookTitle)}</span>
                        <span class="settings-course-book-meta">${escapeHtml(textStatus)}${bookImages > 0 ? ` · ${bookImages} 张图` : ""}</span>
                      </div>
                    </div>
                  `;
                }).join("")
              : '<div class="materials-empty">暂无教材</div>'}
          </div>
        </section>
      </section>
    ` : `
      <section class="settings-course-workbench">
        <div class="materials-empty" style="padding:40px;">请从左侧选择课程</div>
      </section>
    `;

    el.settingsDetailPane.innerHTML = `
      <section class="channel-settings-layout settings-course-layout">
        <aside class="channel-list-pane settings-course-list-pane">
          <div class="channel-list-header">
            <span class="channel-list-title">课程列表 (${rows.length})</span>
            <button class="channel-list-btn" type="button" data-action="show-settings-course-create" aria-label="新建课程" title="新建课程">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
          <div class="channel-list-content">
            ${courseListHtml}
          </div>
        </aside>
        <main class="channel-edit-pane settings-course-edit-pane">
          ${state.settingsCourseView === "create" ? createPanelHtml : editPanelHtml}
        </main>
      </section>
      <div id="coverPickerModal" class="settings-cover-picker-modal" hidden>
        <div class="settings-cover-picker-backdrop"></div>
        <div class="settings-cover-picker-dialog">
          <div class="settings-cover-picker-header">
            <span class="settings-cover-picker-title">选择封面</span>
            <button class="settings-cover-picker-close" type="button" data-action="close-cover-picker">✕</button>
          </div>
          <div class="settings-cover-picker-body" id="coverPickerBody">
            <div class="materials-empty">加载中...</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 打开封面选择器，加载课程下所有教材的图片
   */
  async function openCoverPicker() {
      const lectureId = state.settingsCourseEditId;
      if (!lectureId) return;

      const modal = document.getElementById("coverPickerModal");
      if (modal) modal.hidden = false;

      const body = document.getElementById("coverPickerBody");
      if (!body) return;

      body.innerHTML = '<div class="materials-empty">加载中...</div>';

      try {
          const res = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/cover-assets`);
          const items = Array.isArray(res.items) ? res.items : [];

          if (!items.length) {
              body.innerHTML = '<div class="materials-empty">暂无可用图片，请先解析教材</div>';
              return;
          }

          const currentCover = String(
              (document.getElementById("settingsCourseCoverInput") || {}).value || ""
          ).trim();

          const grouped = {};
          for (const item of items) {
              const bookTitle = String(item.book_title || "未知教材").trim();
              if (!grouped[bookTitle]) grouped[bookTitle] = [];
              grouped[bookTitle].push(item);
          }

          let html = "";
          for (const [bookTitle, bookItems] of Object.entries(grouped)) {
              html += `<div class="settings-cover-picker-book-title">${escapeHtml(bookTitle)}</div>`;
              html += '<div class="settings-cover-picker-grid">';
              for (const item of bookItems) {
                  const coverPath = String(item.cover_path || "").trim();
                  const imageUrl = String(item.image_url || "").trim();
                  const isSelected = coverPath === currentCover;
                  html += `
                      <div class="settings-cover-picker-item${isSelected ? " is-selected" : ""}" data-action="select-cover-image" data-cover-path="${escapeHtml(coverPath)}">
                          <img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">
                      </div>
                  `;
              }
              html += "</div>";
          }

          body.innerHTML = html;
      } catch (err) {
          body.innerHTML = `<div class="materials-empty">加载失败：${escapeHtml(err.message || "未知错误")}</div>`;
      }
  }

  /**
   * 关闭封面选择器
   */
  function closeCoverPicker() {
      const modal = document.getElementById("coverPickerModal");
      if (modal) modal.hidden = true;
  }

  function getLectureOutlineState(lectureId) {
      const targetId = String(lectureId || "").trim();
      const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];
      const item = rows.find((row) => String(row.lecture_id || "").trim() === targetId) || {};
      const status = normalizeStatusKey(item.outline_status);
      const error = String(item.outline_error || "").trim();
      if (isDoneStatus(status)) return { status, label: "已生成", tone: "done", error };
      if (isRunningStatus(status)) return { status, label: "生成中", tone: "running", error };
      if (isErrorStatus(status)) return { status, label: "生成失败", tone: "error", error };
      return { status, label: "未生成", tone: "idle", error };
  }

  /**
   * 渲染频道设置页面主函数
   */
  function renderSettingsChannels() {
      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels.filter((row) => row && !row.builtin) : [];
      const allUsers = Array.isArray(state.settingsUsers) ? state.settingsUsers : [];
      const editState = state.channelEditState;
      const selectedChannelId = editState.channelId;
      const selectedChannel = selectedChannelId
          ? channels.find((row) => String((row && row.id) || "").trim() === selectedChannelId)
          : null;

      const channelListHtml = channels.length
          ? channels.map((row) => {
              const channelId = String(row.id || "").trim();
              const channelTitle = String(row.title || "").trim();
              const isActive = channelId === selectedChannelId;
              const memberCount = Array.isArray(row.member_user_ids) ? row.member_user_ids.length : 0;
              const isPublic = String(row.type || "").trim() === "public";

              return `
                  <div class="channel-list-item${isActive ? " is-active" : ""}" data-action="select-channel" data-channel-id="${escapeHtml(channelId)}">
                      <div class="channel-list-item-main">
                          <span class="channel-list-item-title">${escapeHtml(channelTitle)}</span>
                          <span class="channel-list-item-meta">${isPublic ? "全员公开" : `${memberCount} 人`}</span>
                      </div>
                      <button class="channel-list-item-delete" type="button" data-action="delete-feed-channel" data-channel-id="${escapeHtml(channelId)}" title="删除频道" aria-label="删除频道"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  </div>
              `;
          }).join("")
          : '<div class="materials-empty">暂无自定义频道</div>';

      const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      el.settingsDetailPane.innerHTML = `
          <section class="channel-settings-layout">
              <aside class="channel-list-pane">
                  <div class="channel-list-header">
                      <span class="channel-list-title">现有频道列表</span>
                      <button id="createNewChannelBtn" class="channel-list-btn" type="button" aria-label="新建频道" title="新建频道">${PLUS_ICON}</button>
                  </div>
                  <div class="channel-list-content">
                      ${channelListHtml}
                  </div>
              </aside>
              <main class="channel-edit-pane">
                  ${renderChannelEditPanelHtml(selectedChannel, allUsers)}
              </main>
          </section>
      `;
  }

  /**
   * 打开频道编辑对话框
   */
  function openChannelEditDialog(channelId) {
      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);

      state.channelEditState = {
          channelId: channelId,
          title: channel ? String(channel.title || "") : "",
          selectedUserIds: channel && Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [],
          searchQuery: "",
          isAllPublic: channel ? String(channel.type || "").trim() === "public" : false,
      };

      if (!state.settingsUsers || !state.settingsUsers.length) {
          loadSettingsUsers().then(() => {
              renderSettingsChannels();
          });
      } else {
          renderSettingsChannels();
      }
  }

  /**
   * 重置频道编辑状态（返回新建频道模式）
   */
  function resetChannelEditState() {
      state.channelEditState = {
          channelId: "",
          title: "",
          selectedUserIds: [],
          searchQuery: "",
          isAllPublic: false,
      };
  }

  /**
   * 只重新渲染编辑面板（不重建整个页面）
   */
  function renderChannelEditPanel() {
      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels.filter((row) => row && !row.builtin) : [];
      const allUsers = Array.isArray(state.settingsUsers) ? state.settingsUsers : [];
      const editState = state.channelEditState;
      const selectedChannelId = editState.channelId;
      const selectedChannel = selectedChannelId
          ? channels.find((row) => String((row && row.id) || "").trim() === selectedChannelId)
          : null;

      const editPane = document.querySelector(".channel-edit-pane");
      if (editPane) {
          editPane.innerHTML = renderChannelEditPanelHtml(selectedChannel, allUsers);
      }
  }

  async function loadMaterialsRows() {
    const startedAt = performance.now();
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
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs >= 800) {
      console.warn("[NXL] materials load slow", {
        client_duration_ms: durationMs,
        server_duration_ms: Number(data.duration_ms || 0),
        lectures: state.allLectureRows.length,
      });
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
    if (el.settingsView.classList.contains("is-active") && (state.settingsTab === "refinement" || state.settingsTab === "courses")) renderSettingsDetail();
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

  async function reportReaderChapterComplete(index, isUnload) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) return;
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    const chapter = chapters[idx];
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    const chapterName = String((chapter && chapter.title) || "").trim();
    if (!lectureId || !bookId || !chapterName) return;
    const chapterRange = getReaderChapterRange(chapter);
    const reportKey = getChapterCompleteReportKey(lectureId, bookId, idx, chapterName, chapterRange);
    if (!reportKey) return;
    if (hasChapterCompleteReport(reportKey) || state.readerReportedChapterKey === reportKey || state.readerReportingChapterKey === reportKey) return;
    const chapterContext = getReaderChapterContext(idx);

    if (!chapterContext) {
      console.warn("[NXL-Reader] chapter complete skipped: empty chapter context", {
        lectureId,
        bookId,
        chapterIndex: idx,
        chapterName,
        chapterRange,
        cacheKeys: Object.keys(state.readerChapterCache || {}),
        fullTextLength: String(state.readerFullTextRaw || "").length,
      });
      return;
    }

    state.readerReportingChapterKey = reportKey;
    emitTelemetry("reader_chapter_complete", {
      lecture_id: lectureId,
      book_id: bookId,
      chapter_index: idx,
      chapter_name: chapterName,
      chapter_range: chapterRange,
    });

    const payload = JSON.stringify({
      username: getRuntimeUsername(),
      lecture_id: lectureId,
      book_id: bookId,
      chapter_name: chapterName,
      chapter_range: chapterRange,
      chapter_context: chapterContext.slice(0, 12000),
      chapter_detail_xml: String(state.readerBookDetailXml || ""),
    });

    // 页面卸载时使用 sendBeacon 确保数据发送成功
    if (isUnload && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/frontend/learning/chapter-complete", blob);
      markChapterCompleteReport(reportKey, idx);
      state.readerReportedChapterKey = reportKey;
      invalidateLearningReportCache(lectureId);
      return;
    }

    try {
      await fetchJson("/api/frontend/learning/chapter-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      markChapterCompleteReport(reportKey, idx);
      state.readerReportedChapterKey = reportKey;
      invalidateLearningReportCache(lectureId);

    } catch (err) {
      console.warn("[NXL-Reader] chapter complete report failed", err);
      throw err;
    } finally {
      if (state.readerReportingChapterKey === reportKey) {
        state.readerReportingChapterKey = "";
      }
    }

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
      const data = await fetchJson(`/api/frontend/learning-feeds?${params.toString()}`);
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
      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }
      const title = state.channelEditState.title;
      const isPublic = state.channelEditState.isAllPublic === true;

      if (!title) throw new Error("频道名不能为空");

      // 全员公开时发送 ["ALL"]，否则发送选中的用户ID
      const member_user_ids = isPublic ? ["ALL"] : (state.channelEditState.selectedUserIds || []);

      await fetchJson("/api/frontend/settings/feed-channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, member_user_ids }),
      });

      resetChannelEditState();
      await loadLearningFeedChannels();
      await loadSettingsUsers();
  }

  async function updateLearningFeedChannel() {
      const channelId = String(state.channelEditState.channelId || "").trim();
      if (!channelId) throw new Error("频道ID不存在");

      // 先保存当前输入框的值
      const titleInput = document.getElementById("settingsChannelTitleInput");
      if (titleInput) {
          state.channelEditState.title = String(titleInput.value || "").trim();
      }
      const title = state.channelEditState.title;
      const isPublic = state.channelEditState.isAllPublic === true;

      if (!title) throw new Error("频道名不能为空");

      // 全员公开时发送 ["ALL"]，否则发送选中的用户ID
      const member_user_ids = isPublic ? ["ALL"] : (state.channelEditState.selectedUserIds || []);

      await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, member_user_ids }),
      });

      await loadLearningFeedChannels();
      await loadSettingsUsers();
      renderSettingsChannels();
  }

  /**
   * 获取当前频道内的用户ID列表（从DOM中读取）
   */
  function getChannelMemberUserIds() {
      const memberCards = document.querySelectorAll(".channel-users-column:first-child .channel-user-card");
      return Array.from(memberCards).map((card) => String(card.getAttribute("data-user-id") || "").trim()).filter(Boolean);
  }

  async function saveFeedChannel() {
      const editState = state.channelEditState;
      if (editState.channelId) {
          await updateLearningFeedChannel();
      } else {
          await createLearningFeedChannel();
      }
  }

  /**
   * 添加用户到频道（先更新本地状态，再异步请求）
   */
  async function addUserToChannel(channelId, userId) {
      if (!channelId || !userId) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);
      if (!channel) return;

      const currentMembers = Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [];
      if (currentMembers.includes(userId)) return;

      // 先更新本地状态
      currentMembers.push(userId);
      channel.member_user_ids = currentMembers;
      if (Array.isArray(state.channelEditState.selectedUserIds)) {
          state.channelEditState.selectedUserIds.push(userId);
      }
      renderChannelEditPanel();

      // 异步请求后端
      try {
          await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ member_user_ids: currentMembers }),
          });
      } catch (err) {
          showToast(`添加用户失败：${err.message || "未知错误"}`);
          // 回滚
          channel.member_user_ids = currentMembers.filter((id) => id !== userId);
          if (Array.isArray(state.channelEditState.selectedUserIds)) {
              state.channelEditState.selectedUserIds = state.channelEditState.selectedUserIds.filter((id) => id !== userId);
          }
          renderChannelEditPanel();
      }
  }

  /**
   * 从频道移除用户（先更新本地状态，再异步请求）
   */
  async function removeUserFromChannel(channelId, userId) {
      if (!channelId || !userId) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const channel = channels.find((row) => String((row && row.id) || "").trim() === channelId);
      if (!channel) return;

      const currentMembers = Array.isArray(channel.member_user_ids) ? [...channel.member_user_ids] : [];
      const newMembers = currentMembers.filter((id) => id !== userId);

      // 先更新本地状态
      channel.member_user_ids = newMembers;
      if (Array.isArray(state.channelEditState.selectedUserIds)) {
          state.channelEditState.selectedUserIds = state.channelEditState.selectedUserIds.filter((id) => id !== userId);
      }
      renderChannelEditPanel();

      // 异步请求后端
      try {
          await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(channelId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ member_user_ids: newMembers }),
          });
      } catch (err) {
          showToast(`移除用户失败：${err.message || "未知错误"}`);
          // 回滚
          channel.member_user_ids = currentMembers;
          if (Array.isArray(state.channelEditState.selectedUserIds)) {
              state.channelEditState.selectedUserIds.push(userId);
          }
          renderChannelEditPanel();
      }
  }

  async function removeLearningFeedChannel(channelId) {
      const id = String(channelId || "").trim();
      if (!id) return;
      await fetchJson(`/api/frontend/settings/feed-channels/${encodeURIComponent(id)}`, {
          method: "DELETE",
      });

      if (String(state.channelEditState.channelId || "").trim() === id) {
          resetChannelEditState();
      }

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

    function getCustomSelectValue(selectId) {
      const el = document.querySelector(`[data-select-id="${selectId}"]`);
      if (!el) return "";
      return String(el.getAttribute("data-value") || "").trim();
    }

    const memoryIntervalInput = document.getElementById("settingsMemoryIntervalInput");
    const payload = {
      default_nexora_model: getCustomSelectValue("settingsDefaultModelSelect"),
      rough_reading: {
        model_name: getCustomSelectValue("settingsRoughModelSelect"),
      },
      intensive_reading: {
        model_name: getCustomSelectValue("settingsIntensiveModelSelect"),
      },
      split_chapters: {
        model_name: getCustomSelectValue("settingsSplitChaptersModelSelect"),
      },
      memory: {
        model_name: getCustomSelectValue("settingsMemoryModelSelect"),
        trigger_turn_interval: Math.max(1, Number(memoryIntervalInput ? memoryIntervalInput.value : 10) || 10),
      },
      profile_question: {
        model_name: getCustomSelectValue("settingsProfileQuestionModelSelect"),
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

  async function startMaterialPipeline(lectureId, bookId, force = false) {
    await fetchJson("/api/frontend/settings/refinement/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lecture_id: lectureId,
        book_id: bookId,
        actor: state.username || "",
        force: Boolean(force),
      }),
    });
    await loadRefinementSettings();
    await loadMaterialsRows();
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
  }

  async function startVideo(lectureId, bookId) {
    await fetchJson("/api/frontend/settings/refinement/video", {
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

  function startOutline(lectureId) {
    const resolvedLectureId = String(lectureId || "").trim();
    if (!resolvedLectureId) {
      return Promise.reject(new Error("lecture_id 不能为空"));
    }

    state.outlineActivity = {
      lectureId: resolvedLectureId,
      running: true,
      lines: [
        "已开始课程大纲生成",
        "正在汇总课程下教材章节与精读信息",
      ],
      draft: "",
      startedAt: Date.now(),
      error: "",
    };
    renderAdminCourseManagement();

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(`/api/frontend/outline/${encodeURIComponent(resolvedLectureId)}/generate-stream`);
      let settled = false;

      const finishWithError = (message) => {
        if (settled) return;

        settled = true;
        eventSource.close();
        const errorMessage = String(message || "大纲生成失败");
        state.outlineActivity.running = false;
        state.outlineActivity.error = errorMessage;
        state.outlineActivity.lines = [...state.outlineActivity.lines, `生成失败：${errorMessage}`];
        renderAdminCourseManagement();
        reject(new Error(errorMessage));
      };

      eventSource.addEventListener("status", (e) => {
        try {
          const data = JSON.parse(e.data);
          const line = String(data.message || "").trim();
          if (line) {
            state.outlineActivity.lines = [...state.outlineActivity.lines, line].slice(-18);
            renderAdminCourseManagement();
          }
        } catch (_err) {}
      });

      eventSource.addEventListener("delta", (e) => {
        try {
          const data = JSON.parse(e.data);
          const piece = String((data && data.content) || "");
          if (!piece) return;
          state.outlineActivity.draft = `${String(state.outlineActivity.draft || "")}${piece}`;
          renderAdminCourseManagement();
        } catch (_err) {}
      });

      eventSource.addEventListener("done", async (e) => {
        if (settled) return;

        let data;

        try {
          data = JSON.parse(e.data);
        } catch (_err) {
          finishWithError("大纲生成完成事件格式错误");
          return;
        }

        if (!data.success) {
          finishWithError(data.error || "大纲生成失败");
          return;
        }

        settled = true;
        eventSource.close();
        state.outlineActivity.running = false;
        state.outlineActivity.error = "";
        state.outlineActivity.lines = [...state.outlineActivity.lines, "课程大纲已生成完成"];
        renderAdminCourseManagement();

        try {
          await loadRefinementSettings();
        } catch (refreshError) {
          const refreshMessage = String(refreshError && refreshError.message || "未知错误");
          state.outlineActivity.lines = [
            ...state.outlineActivity.lines,
            `课程结构已生成，但状态刷新失败：${refreshMessage}`,
          ];
        }

        renderAdminCourseManagement();
        resolve(data);
      });

      eventSource.addEventListener("error", (e) => {
        if (settled) return;

        let message = "大纲生成失败";
        try {
          const data = JSON.parse(e.data);
          message = data.error || message;
        } catch (_err) {}

        finishWithError(message);
      });

      eventSource.addEventListener("close", () => {
        eventSource.close();
      });
    });
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
    } else if (state.settingsTab === "courses") {
      await Promise.all([loadMaterialsRows(), loadRefinementSettings()]);
    }
    renderSettingsView();
  }

  async function refreshAll() {
    await Promise.all([
      loadMaterialsRows(),
      loadDashboardRows(),
      loadLearningFeedChannels(),
      loadLearningFeeds(),
      loadDashboardNotifications(),
      loadQuestionBank(),
      loadUserProfile(),
    ]);
    renderDashboardNotifications();
    renderUserProfile();
    renderProgressList();
    renderLearningPushCenter();
    renderQuestionBankCenter();
    renderPie();
    renderLearningFeeds();
    syncDashboardSideTabs();
    renderLectureList();
    renderLectureDetail();
    renderUploadLectureInputDefault();
  }

  async function createLectureWithPayload(payload) {
    const title = String(payload && payload.title || "").trim();
    const category = String(payload && payload.category || "").trim();
    const status = String(payload && payload.status || "draft").trim() || "draft";
    const description = String(payload && payload.description || "").trim();
    if (!title) throw new Error("请输入课程名");
    const response = await fetchJson("/api/lectures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, status, description }),
    });
    const lecture = response.lecture || {};
    state.selectedLectureId = String(lecture.id || "");
    state.settingsCourseEditId = String(lecture.id || "");
    return lecture;
  }

  async function createLecture() {
    const title = String(el.createLectureTitleInput.value || "").trim();
    const category = String(el.createLectureCategoryInput.value || "").trim();
    const status = String(el.createLectureStatusSelect.value || "draft").trim() || "draft";
    const description = String(el.createLectureDescriptionInput.value || "").trim();
    const lecture = await createLectureWithPayload({ title, category, status, description });
    el.createLectureTitleInput.value = "";
    el.createLectureCategoryInput.value = "";
    el.createLectureStatusSelect.value = "draft";
    el.createLectureDescriptionInput.value = "";
    return lecture;
  }

  async function createLectureFromSettings() {
    const titleInput = document.getElementById("settingsCreateLectureTitleInput");
    const categoryInput = document.getElementById("settingsCreateLectureCategoryInput");
    const statusSelect = document.getElementById("settingsCreateLectureStatusSelect");
    const descriptionInput = document.getElementById("settingsCreateLectureDescriptionInput");
    const lecture = await createLectureWithPayload({
      title: titleInput ? titleInput.value : "",
      category: categoryInput ? categoryInput.value : "",
      status: statusSelect ? statusSelect.value : "draft",
      description: descriptionInput ? descriptionInput.value : "",
    });
    if (titleInput) titleInput.value = "";
    if (categoryInput) categoryInput.value = "";
    if (statusSelect) statusSelect.value = "draft";
    if (descriptionInput) descriptionInput.value = "";
    return lecture;
  }

// ─────── Download & Raw API Actions ───────────────────────────────────

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

  function deriveBookTitleFromFile(file) {
    const rawName = String(file && file.name || "").trim();
    if (!rawName) return "";

    const lastDot = rawName.lastIndexOf(".");
    if (lastDot <= 0) {
        return rawName;
    }

    return rawName.slice(0, lastDot).trim();
  }

  function resolveUploadBookTitle(title, file) {
    const normalizedTitle = String(title || "").trim();
    if (normalizedTitle) {
        return normalizedTitle;
    }

    return deriveBookTitleFromFile(file);
  }

  function rememberSelectedUploadFile(file) {
    state.selectedUploadFile = file || null;
    renderSelectedUploadFileState(file);

    if (!file) {
        return;
    }

    if (el.materialsBookTitleInput && !String(el.materialsBookTitleInput.value || "").trim()) {
        el.materialsBookTitleInput.value = deriveBookTitleFromFile(file);
    }
  }

  async function uploadBookByFilePayload(lectureId, title, file) {
    if (!state.isAdmin) throw new Error("当前账号不是管理员");
    const normalizedLectureId = String(lectureId || "").trim();
    const normalizedTitle = resolveUploadBookTitle(title, file);
    if (!normalizedLectureId) throw new Error("请选择课程");
    if (!normalizedTitle) throw new Error("请输入教材名");
    if (!file) throw new Error("请选择教材文件");

    const created = await fetchJson(`/api/lectures/${encodeURIComponent(normalizedLectureId)}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: normalizedTitle, source_type: "file" }),
    });
    const bookId = String((created.book || {}).id || "");
    if (!bookId) throw new Error("创建教材失败");

    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`/api/lectures/${encodeURIComponent(normalizedLectureId)}/books/${encodeURIComponent(bookId)}/file`, {
      method: "POST",
      body: form,
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `HTTP ${resp.status}`);
    }
    state.selectedLectureId = normalizedLectureId;
    state.settingsCourseEditId = normalizedLectureId;
    state.selectedBookId = bookId;
    return created.book || {};
  }

  async function uploadBookByFile() {
    const lectureId = String(el.materialsLectureIdHidden.value || "").trim();
    const title = String(el.materialsBookTitleInput.value || "").trim();
    const inputFile = el.materialsFileInput.files ? el.materialsFileInput.files[0] : null;
    const file = inputFile || state.selectedUploadFile;
    const book = await uploadBookByFilePayload(lectureId, title, file);
    el.materialsBookTitleInput.value = "";
    el.materialsFileInput.value = "";
    state.selectedUploadFile = null;
    renderSelectedUploadFileState(null);
    return book;
  }

  async function uploadBookFromSettings() {
    syncSettingsBookUploadStateFromControls();

    const uploadState = state.settingsBookUpload;
    const lectureId = uploadState.lectureId;
    const title = uploadState.title;
    const file = uploadState.file;
    const book = await uploadBookByFilePayload(lectureId, title, file);
    clearSettingsBookUploadState(lectureId);
    return book;
  }

