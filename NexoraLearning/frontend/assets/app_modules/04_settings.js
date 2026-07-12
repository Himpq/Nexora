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
    if (coarse === "outlined") return "粗读目录已生成，待继续补摘要";
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

  function markRefinementItemCoarseQueued(lectureId, bookId) {
    const lectureKey = String(lectureId || "").trim();
    const bookKey = String(bookId || "").trim();
    const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];
    const row = rows.find((item) => (
      String(item && item.lecture_id || "").trim() === lectureKey &&
      String(item && item.book_id || "").trim() === bookKey
    ));

    if (!row) {
      return;
    }

    row.refinement_status = "queued";
    row.coarse_status = "queued";
    row.job_status = "queued";
    row.refinement_error = "";
    row.coarse_error = "";
    row.progress_text = "模型排队中...";
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
    const intensive = normalizeStatusKey(item && item.intensive_status);
    const section = normalizeStatusKey(item && item.section_status);
    const job = normalizeStatusKey(item && item.job_status);
    const sectionJob = normalizeStatusKey(item && item.section_job_status);
    const intensiveReady = ["done", "completed", "success"].includes(intensive);

    if (!intensiveReady) return false;

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

  function canStartVideo(item) {
    const summary = normalizeStatusKey(item && item.summary_status);
    const video = normalizeStatusKey(item && item.video_status);
    const videoJob = normalizeStatusKey(item && item.video_job_status);
    // 概述完成，或概述跳过（已有其他步骤完成），都可以搜视频
    const anyStepDone = ["coarse", "section", "intensive", "question", "annotation", "summary"].some(
      (k) => ["done", "completed", "success"].includes(normalizeStatusKey(item && item[`${k}_status`]))
    );
    if (!anyStepDone) return false;
    if (["running", "queued"].includes(videoJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(video)) return false;
    return true;
  }

  function canStartSummary(item) {
    const coarse = normalizeStatusKey(item && item.coarse_status);
    const section = normalizeStatusKey(item && item.section_status);
    const summary = normalizeStatusKey(item && item.summary_status);
    const job = normalizeStatusKey(item && item.job_status);
    const summaryJob = normalizeStatusKey(item && item.summary_job_status);
    const coarseReady = ["done", "completed", "success"].includes(coarse);
    const sectionReady = ["done", "completed", "success"].includes(section);
    if (!coarseReady && !sectionReady) return false;
    if (["running", "queued"].includes(job) || ["running", "queued"].includes(summaryJob)) return false;
    if (["running", "queued", "done", "completed", "success"].includes(summary)) return false;
    return true;
  }

  function canStartOutline(item) {
    const outline = normalizeStatusKey(item && item.outline_status);
    if (["running", "queued", "done", "completed", "success"].includes(outline)) return false;
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

  // Agent 定义：按实际管线顺序排列
  const AGENT_PIPELINE = [
    { key: "coarse",     label: "概读", desc: "分析教材结构" },
    { key: "section",    label: "分节", desc: "拆分章节单元" },
    { key: "intensive",  label: "精读", desc: "深度分析内容" },
    { key: "question",   label: "出题", desc: "生成练习题目" },
    { key: "annotation", label: "批注", desc: "生成学习批注" },
    { key: "summary",    label: "概述", desc: "生成全书概述" },
    { key: "video",      label: "视频", desc: "搜索相关视频" },
  ];

  function getAgentStatus(item, agentKey) {
    const status = normalizeStatusKey(item && item[`${agentKey}_status`]);
    const done = isDoneStatus(status);
    const running = isRunningStatus(status);
    const error = isErrorStatus(status);
    const idle = !done && !running && !error && status !== "empty";
    const pending = idle && !_canAgentRun(item, agentKey);
    return { status, done, running, error, idle, pending };
  }

  function _canAgentRun(item, agentKey) {
    if (agentKey === "coarse") return canStartRefinement(item);
    if (agentKey === "section") return canStartSection(item);
    if (agentKey === "intensive") return canStartIntensive(item);
    if (agentKey === "question") return canStartQuestion(item);
    if (agentKey === "annotation") return canStartAnnotation(item);
    if (agentKey === "summary") return canStartSummary(item);
    if (agentKey === "video") return canStartVideo(item);
    return true;
  }

  function getCurrentAgentKey(item) {
    for (const agent of AGENT_PIPELINE) {
      const s = getAgentStatus(item, agent.key);
      if (s.running) return agent.key;
      if (!s.done && !s.error) return agent.key;
    }
    return "summary";
  }

  function buildRefineFlow(item) {
    const hasError = AGENT_PIPELINE.some((a) => isErrorStatus(normalizeStatusKey(item && item[`${a.key}_status`])));
    const steps = AGENT_PIPELINE.map((agent) => {
      const s = getAgentStatus(item, agent.key);
      return { key: agent.key, label: agent.label, icon: agent.icon, desc: agent.desc, done: s.done, running: s.running, error: s.error, pending: s.pending };
    });
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
    const summaryDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.summary_status));
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
        text: "◎",
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
    if (!summaryDone) {
      return {
        action: "start-summary",
        title: "生成全书概述",
        text: "◆",
        enabled: canStartSummary(item),
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

    const videoDone = ["done", "completed", "success"].includes(normalizeStatusKey(item && item.video_status));
    if (!videoDone) {
      return {
        action: "start-video",
        title: "搜索视频",
        text: "📺",
        enabled: canStartVideo(item),
      };
    }

    return {
      action: "",
      title: "全部完成",
      text: "✓",
      enabled: false,
    };
  }

// ─────── Settings: Rendering ──────────────────────────────────────────
  function renderSettingsNav() {
    const tabs = [
      { id: "refinement", title: "教材管理" },
      { id: "courses", title: "课程管理" },
      { id: "model", title: "模型配置" },
      { id: "channels", title: "频道与推送" },
      { id: "users", title: "用户管理" },
      { id: "logs", title: "系统日志" },
      { id: "agents", title: "执行面板" },
    ];
    el.settingsNavList.innerHTML = `<div class="settings-tab-bar">
      ${tabs.map((tab) => `<button class="settings-tab ${state.settingsTab === tab.id ? "is-active" : ""}" data-settings-tab="${tab.id}" type="button">${escapeHtml(tab.title)}</button>`).join("")}
    </div>`;
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
    if (select instanceof HTMLSelectElement) select.value = identity;
    const pill = card.querySelector(".settings-user-pill-identity");
    if (pill) pill.textContent = identityLabel;
    const saveBtn = card.querySelector("[data-action='save-user-identity']");
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.classList.remove("is-saving");
      saveBtn.disabled = !!saveBtn.dataset.locked;
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
              <select id="${escapeHtml(identitySelectId)}" class="input-lite settings-identity-select" data-user-identity-select="${escapeHtml(userId)}" ${isLocked ? "disabled" : ""}>
                <option value="student" ${identity === "student" ? "selected" : ""}>学生</option>
                <option value="teacher" ${identity === "teacher" ? "selected" : ""}>教师</option>
              </select>
              <button class="settings-user-save-btn" type="button" data-action="save-user-identity" data-user-id="${escapeHtml(userId)}" ${isLocked ? "disabled data-locked=\"1\" title=\"不可修改其他管理员身份\"" : "title=\"保存身份\""} aria-label="保存身份">
                <svg class="save-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                <svg class="spinner-icon" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
              </button>
            </div>
          </article>
        `;
      }).join("") : emptyHtml);

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
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
            <div class="settings-sub" style="color:#b91c1c;">${escapeHtml(error)}</div>
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
          <div class="settings-grid">
            <div><div class="settings-kv-label">用户名</div><div class="settings-kv-value">${escapeHtml(username)}</div></div>
            <div><div class="settings-kv-label">角色</div><div class="settings-kv-value">${escapeHtml(role)}</div></div>
            <div><div class="settings-kv-label">全部课程</div><div class="settings-kv-value">${state.allLectureRows.length}</div></div>
            <div><div class="settings-kv-label">总学习时长</div><div class="settings-kv-value">${toNumber(state.totalStudyHours, 0).toFixed(1)}h</div></div>
          </div>
        </article>
        <article class="settings-card">
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

    // 按时间分组（间隔 < 5 分钟为同一会话）
    const groups = [];
    let currentGroup = null;
    const SESSION_GAP_MS = 5 * 60 * 1000;

    for (const row of rows) {
      const ts = String((row && row.timestamp) || "");
      const tsMs = ts ? new Date(ts).getTime() : 0;

      if (!currentGroup || (tsMs - currentGroup.endTimeMs > SESSION_GAP_MS)) {
        currentGroup = { startTime: ts, endTimeMs: tsMs, rows: [] };
        groups.push(currentGroup);
      }
      currentGroup.rows.push(row);
      if (tsMs > currentGroup.endTimeMs) {
        currentGroup.endTimeMs = tsMs;
      }
    }

    // 渲染日志条目
    const renderLogEntry = (row, idx) => {
      const kind = String((row && row.kind) || "");
      const source = String((row && row.source) || "unknown");
      const title = String((row && (row.title || row.event_type || row.tool_name)) || "");
      const ts = String((row && row.timestamp) || "—");
      const timeStr = ts ? ts.split(" ").pop() || ts : "—";
      const isPerformance = source === "performance" || String((row && row.event_type) || "").startsWith("request_performance");
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
      const badgeClass = isPerformance ? "type-performance" : kind === "model_text" ? "type-model" : kind === "tool_flow" ? "type-tool" : "";
      const badgeLabel = isPerformance ? "性能" : kind === "model_text" ? "模型" : kind === "tool_flow" ? "工具" : "事件";

      return `
        <div class="log-entry" data-log-index="${idx}">
          <div class="log-entry-header" onclick="this.parentElement.classList.toggle('is-expanded')">
            <span class="log-entry-type-badge ${badgeClass}">${badgeLabel}</span>
            <span class="log-entry-title">${escapeHtml(title || source || "日志记录")}</span>
            <span class="log-entry-time">${escapeHtml(timeStr)}</span>
            <svg class="log-entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="log-entry-body">
            <pre>${escapeHtml(content)}</pre>
          </div>
        </div>
      `;
    };

    // 渲染分组
    const groupsHtml = groups.length ? groups.map((group, gIdx) => {
      const startTime = group.startTime || "—";
      const timeStr = startTime ? startTime.split(" ").pop() || startTime : "—";
      const count = group.rows.length;
      const entriesHtml = group.rows.map((row, rIdx) => renderLogEntry(row, `${gIdx}_${rIdx}`)).join("");

      return `
        <div class="settings-log-group ${gIdx === 0 ? "is-expanded" : ""}" data-group-index="${gIdx}">
          <div class="settings-log-group-header" onclick="this.parentElement.classList.toggle('is-expanded')">
            <span class="settings-log-group-title">${escapeHtml(startTime.split(" ")[0] || "会话")} ${escapeHtml(timeStr)}</span>
            <span class="settings-log-group-count">${count} 条</span>
            <svg class="settings-log-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="settings-log-group-body">
            ${entriesHtml}
          </div>
        </div>
      `;
    }).join("") : '<div class="materials-empty">暂无模型日志</div>';

    // 过滤按钮
    const filterBtns = [
      { key: "all", label: "所有日志" },
      { key: "model", label: "模型日志" },
      { key: "performance", label: "性能日志" },
      { key: "error", label: "错误日志" },
    ].map((f) => `<button class="settings-filter-btn ${state.settingsLogCategory === f.key ? "is-active" : ""}" data-filter="${f.key}" type="button">${f.label}</button>`).join("");

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-sub">按时间分组展示最近的模型执行记录，点击展开查看详情。</div>
          <div class="settings-search-bar">
            <input class="settings-search-input" id="settingsLogSearchInput" type="text" placeholder="搜索日志标题或内容..." value="${escapeHtml(state.settingsLogSearch || "")}" />
            <button class="nxl-icon-btn" id="settingsLogRefreshBtn" type="button" title="刷新日志">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
          </div>
          <div class="settings-filter-group">
            ${filterBtns}
          </div>
        </article>
        <div id="settingsLogGroupsContainer">
          ${groupsHtml}
        </div>
      </section>
    `;

    // 绑定搜索
    const searchInput = document.getElementById("settingsLogSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.settingsLogSearch = searchInput.value;
        filterLogEntries();
      });
    }

    // 绑定过滤按钮
    el.settingsDetailPane.querySelectorAll(".settings-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settingsLogCategory = String(btn.getAttribute("data-filter") || "all");
        loadSettingsLogs().then(() => renderSettingsLogs());
      });
    });

    // 绑定刷新按钮
    const refreshBtn = document.getElementById("settingsLogRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadSettingsLogs().then(() => renderSettingsLogs());
      });
    }
  }

  function filterLogEntries() {
    const search = String(state.settingsLogSearch || "").trim().toLowerCase();
    const container = document.getElementById("settingsLogGroupsContainer");
    if (!container) return;

    container.querySelectorAll(".log-entry").forEach((entry) => {
      if (!search) {
        entry.style.display = "";
        return;
      }
      const title = String(entry.querySelector(".log-entry-title")?.textContent || "").toLowerCase();
      const body = String(entry.querySelector(".log-entry-body pre")?.textContent || "").toLowerCase();
      const matches = title.includes(search) || body.includes(search);
      entry.style.display = matches ? "" : "none";
    });

    // 隐藏空分组
    container.querySelectorAll(".settings-log-group").forEach((group) => {
      const visibleEntries = group.querySelectorAll(".log-entry:not([style*='display: none'])");
      group.style.display = visibleEntries.length ? "" : "none";
    });
  }

  function renderSettingsAgents() {
    state.refinementViewBootstrapped = false;

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll settings-agents-scroll">
        <article class="settings-card settings-agents-toolbar">
          <div class="settings-agents-title">
            <div class="settings-kv-label">RUNLOG</div>
            <div class="settings-kv-value">多智能体执行面板</div>
          </div>
          <a class="settings-agents-open-btn" href="/api/sample/agents" target="_blank" rel="noopener" title="新窗口打开">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
              <path d="M15 3h6v6"></path>
              <path d="M10 14 21 3"></path>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            </svg>
            <span>新窗口打开</span>
          </a>
        </article>
        <section class="settings-agents-frame-shell" aria-label="多智能体执行面板">
          <iframe class="settings-agents-frame" src="/api/sample/agents" title="多智能体执行面板"></iframe>
        </section>
      </section>
    `;
  }

  function renderSettingsLectureOptions(selectedLectureId) {
    const rows = Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const selectedId = String(selectedLectureId || "").trim();
    return rows.map((row) => {
      const lecture = row.lecture || {};
      const lectureId = String(lecture.id || "").trim();
      const title = String(lecture.title || "未命名课程").trim();
      return `<option value="${escapeHtml(lectureId)}" ${lectureId === selectedId ? "selected" : ""}>${escapeHtml(title)}</option>`;
    }).join("");
  }

  function resolveSettingsBookUploadLectureId(selectedLectureId) {
    const uploadState = state.settingsBookUpload;
    const candidates = [
      uploadState.lectureId,
      selectedLectureId,
      state.settingsCourseEditId,
      state.selectedLectureId,
    ];

    for (const value of candidates) {
      const lectureId = String(value || "").trim();

      if (lectureId) {
        return lectureId;
      }
    }

    return "";
  }

  function ensureSettingsBookUploadLectureId(selectedLectureId) {
    const lectureId = resolveSettingsBookUploadLectureId(selectedLectureId);
    state.settingsBookUpload.lectureId = lectureId;
    return lectureId;
  }

  function getSettingsBookUploadTipText(file) {
    if (!file) {
      return "支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST";
    }

    return `已选择：${String(file.name || "").trim()}`;
  }

  function syncSettingsBookUploadTip(file) {
    const tip = document.getElementById("settingsUploadTip");

    if (tip) {
      tip.textContent = getSettingsBookUploadTipText(file);
    }
  }

  // 设置页上传表单会被轮询刷新触发渲染，文件对象必须由页面状态持有。
  function syncSettingsBookUploadControls() {
    const uploadState = state.settingsBookUpload;
    const lectureSelect = document.getElementById("settingsUploadLectureSelect");
    const titleInput = document.getElementById("settingsUploadBookTitleInput");
    const lectureId = ensureSettingsBookUploadLectureId();

    if (lectureSelect instanceof HTMLSelectElement && lectureId && lectureSelect.value !== lectureId) {
      lectureSelect.value = lectureId;
    }

    if (titleInput instanceof HTMLInputElement && titleInput.value !== uploadState.title) {
      titleInput.value = uploadState.title;
    }

    syncSettingsBookUploadTip(uploadState.file);
  }

  function syncSettingsBookUploadStateFromControls() {
    const uploadState = state.settingsBookUpload;
    const lectureSelect = document.getElementById("settingsUploadLectureSelect");
    const titleInput = document.getElementById("settingsUploadBookTitleInput");
    const fileInput = document.getElementById("settingsUploadFileInput");

    if (lectureSelect instanceof HTMLSelectElement) {
      uploadState.lectureId = String(lectureSelect.value || "").trim();
    }

    if (titleInput instanceof HTMLInputElement) {
      uploadState.title = String(titleInput.value || "");
    }

    if (fileInput instanceof HTMLInputElement && fileInput.files && fileInput.files.length) {
      uploadState.file = fileInput.files[0];
    }

    syncSettingsBookUploadTip(uploadState.file);
  }

  function rememberSettingsBookUploadFile(file) {
    if (!file) {
      syncSettingsBookUploadTip(state.settingsBookUpload.file);
      return;
    }

    const uploadState = state.settingsBookUpload;
    uploadState.file = file;

    if (!String(uploadState.title || "").trim()) {
      uploadState.title = deriveBookTitleFromFile(file);
    }

    syncSettingsBookUploadControls();
  }

  function rememberSettingsBookUploadInputFile(fileInput) {
    if (!(fileInput instanceof HTMLInputElement)) {
      return;
    }

    const file = fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
    rememberSettingsBookUploadFile(file);
  }

  function clearSettingsBookUploadState(lectureId) {
    const uploadState = state.settingsBookUpload;
    uploadState.lectureId = String(lectureId || uploadState.lectureId || "").trim();
    uploadState.title = "";
    uploadState.file = null;

    const fileInput = document.getElementById("settingsUploadFileInput");

    if (fileInput instanceof HTMLInputElement) {
      fileInput.value = "";
    }

    syncSettingsBookUploadControls();
  }

  function renderSettingsBookUploadEntry() {
    return `
      <div class="settings-refinement-upload-entry">
        <button class="channel-list-btn" type="button" data-action="show-settings-book-upload" aria-label="上传教材" title="上传教材">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
      </div>
    `;
  }

  function renderSettingsBookUploadPanel(selectedLectureId) {
    const defaultLectureId = ensureSettingsBookUploadLectureId(selectedLectureId);
    const uploadTitle = String(state.settingsBookUpload.title || "");
    const uploadTip = getSettingsBookUploadTipText(state.settingsBookUpload.file);
    const hasCourses = Array.isArray(state.allLectureRows) && state.allLectureRows.length > 0;
    return `
      <section class="settings-course-workbench settings-book-upload-workbench">
        <section class="settings-inline-card settings-book-upload-panel">
          <div class="settings-inline-head">
            <div>
              <div class="settings-inline-title">上传教材</div>
              <div class="settings-inline-sub">先挂到课程，再进入教材解析、精读和视频流程。</div>
            </div>
            <button class="settings-course-action-btn" type="button" data-action="show-settings-refinement-detail" aria-label="返回列表" title="返回列表">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
          <div class="settings-book-upload-summary">
            <div class="settings-book-upload-summary-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
            </div>
            <div class="settings-book-upload-summary-copy">
              <div class="settings-book-upload-summary-title">教材会自动接入课程链路</div>
              <div class="settings-book-upload-summary-text">上传完成后会回到教材管理，并进入教材解析、精读与视频处理流程。</div>
            </div>
          </div>
          <div class="settings-inline-form settings-book-upload-form">
            <label class="settings-field">
              <span>课程</span>
              <select id="settingsUploadLectureSelect" class="input-lite" ${hasCourses ? "" : "disabled"}>
                <option value="">选择课程</option>
                ${renderSettingsLectureOptions(defaultLectureId)}
              </select>
            </label>
            <label class="settings-field">
              <span>教材名</span>
              <input id="settingsUploadBookTitleInput" class="input-lite" placeholder="例如：课程讲义第 1 章" value="${escapeHtml(uploadTitle)}">
            </label>
            <div class="settings-book-upload-file-row settings-field-wide">
              <label class="settings-field">
                <span>文件</span>
                <input id="settingsUploadFileInput" class="input-lite input-file" type="file" accept=".epub,.pdf,.txt,.md,.docx,.doc,.c,.h,.py,.rst">
              </label>
              <button class="settings-course-action-btn settings-book-upload-submit" type="button" data-action="upload-settings-book" ${hasCourses ? "" : "disabled"} aria-label="确认上传" title="确认上传">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
              </button>
            </div>
          </div>
          <div id="settingsUploadTip" class="settings-inline-sub settings-book-upload-tip">${escapeHtml(uploadTip)}</div>
        </section>
      </section>
    `;
  }

  const SETTINGS_REFINEMENT_ICONS = {
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    cover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  function getSettingsRefinementBookKey(lectureId, bookId) {
    return `${String(lectureId || "").trim()}::${String(bookId || "").trim()}`;
  }

  function getSettingsRefinementBookRecord(item) {
    const lectureId = String((item && item.lecture_id) || "").trim();
    const bookId = String((item && item.book_id) || "").trim();

    if (!lectureId || !bookId) return null;
    return getBookRowById(lectureId, bookId);
  }

  function getSettingsRefinementBookTitle(item) {
    const book = getSettingsRefinementBookRecord(item);
    const bookId = String((item && item.book_id) || "").trim();
    return String((book && book.title) || (item && item.book_title) || bookId || "未命名教材").trim();
  }

  function getSettingsRefinementBookDescription(item) {
    const book = getSettingsRefinementBookRecord(item);
    return String((book && book.description) || (item && item.book_description) || "").trim();
  }

  function getSettingsRefinementBookCoverPath(item) {
    const book = getSettingsRefinementBookRecord(item);
    return String((book && (book.cover_path || book.cover)) || (item && (item.cover_path || item.cover)) || "").trim();
  }

  function renderSettingsRefinementCoverPreview(coverPath, title) {
    const resolvedPath = String(coverPath || "").trim();
    const resolvedTitle = String(title || "教材封面").trim();

    if (resolvedPath) {
      return `<img src="${escapeHtml(resolveApiUrl(resolvedPath))}" alt="${escapeHtml(resolvedTitle)}" loading="lazy">`;
    }

    return `
      <div class="settings-refinement-cover-empty">
        ${SETTINGS_REFINEMENT_ICONS.cover}
        <span>暂无封面</span>
      </div>
    `;
  }

  function renderSettingsRefinementBookPanel(item) {
    const lectureId = String((item && item.lecture_id) || "").trim();
    const bookId = String((item && item.book_id) || "").trim();
    const book = getSettingsRefinementBookRecord(item);
    const title = getSettingsRefinementBookTitle(item);
    const description = getSettingsRefinementBookDescription(item);
    const coverPath = getSettingsRefinementBookCoverPath(item);
    const lectureTitle = String((item && item.lecture_title) || "").trim();
    const sourceType = String((book && book.source_type) || (item && item.source_type) || "").trim();
    const statusText = String((book && (book.text_status || book.status)) || (item && item.status) || "未解析").trim();

    return `
      <section class="settings-refinement-book-panel" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}">
        <div class="settings-inline-head settings-refinement-book-head">
          <div>
            <div class="settings-inline-title">教材资料</div>
            <div class="settings-inline-sub">${escapeHtml(lectureTitle || "未绑定课程")} · ${escapeHtml(sourceType || "教材")} · ${escapeHtml(statusText)}</div>
          </div>
          <button class="settings-course-action-btn" type="button" data-action="save-refinement-book-info" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" aria-label="保存教材资料" title="保存教材资料">
            ${SETTINGS_REFINEMENT_ICONS.save}
          </button>
        </div>
        <div class="settings-refinement-book-body">
          <div class="settings-refinement-book-cover-area">
            <div class="settings-refinement-book-cover-preview" id="settingsRefinementBookCoverPreview">
              ${renderSettingsRefinementCoverPreview(coverPath, title)}
            </div>
            <input type="hidden" id="settingsRefinementBookCoverInput" value="${escapeHtml(coverPath)}">
            <div class="settings-refinement-cover-actions">
              <button class="settings-course-action-btn settings-refinement-cover-btn" type="button" data-action="open-refinement-book-cover-picker" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" aria-label="选择教材封面" title="选择教材封面">
                ${SETTINGS_REFINEMENT_ICONS.cover}
              </button>
              <button class="settings-course-action-btn settings-refinement-cover-btn" type="button" data-action="clear-refinement-book-cover" aria-label="清除教材封面" title="清除教材封面" ${coverPath ? "" : "disabled"}>
                ${SETTINGS_REFINEMENT_ICONS.trash}
              </button>
            </div>
          </div>
          <label class="settings-field">
            <span>教材名称</span>
            <input id="settingsRefinementBookTitleInput" class="input-lite" value="${escapeHtml(title)}" placeholder="教材名称">
          </label>
          <label class="settings-field">
            <span>教材简介</span>
            <textarea id="settingsRefinementBookDescInput" class="input-lite input-textarea" rows="5" placeholder="教材简介">${escapeHtml(description)}</textarea>
          </label>
          <div class="settings-refinement-book-id">ID：${escapeHtml(bookId || "未生成")}</div>
        </div>
      </section>
    `;
  }

  function renderSettingsRefinementCoverPicker() {
    return `
      <div id="refinementCoverPickerModal" class="settings-cover-picker-modal settings-refinement-cover-picker-modal" hidden>
        <div class="settings-refinement-cover-picker-backdrop" data-action="close-refinement-book-cover-picker"></div>
        <div class="settings-cover-picker-dialog">
          <div class="settings-cover-picker-header">
            <span class="settings-cover-picker-title">选择教材封面</span>
            <button class="settings-cover-picker-close" type="button" data-action="close-refinement-book-cover-picker" aria-label="关闭" title="关闭">
              ${SETTINGS_REFINEMENT_ICONS.close}
            </button>
          </div>
          <div class="settings-cover-picker-body" id="refinementCoverPickerBody">
            <div class="materials-empty">加载中...</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 教材管理工作区：资料编辑区和模型活动区分开，轮询只刷新模型活动区。
   */
  function renderSettingsRefinementWorkbench(item) {
    return `
      <section class="settings-refinement-workbench">
        ${renderSettingsRefinementBookPanel(item)}
        <section class="settings-refinement-flow-panel">
          <div class="settings-refinement-flow-body" id="agentFlowchartFlow"></div>
        </section>
      </section>
      ${renderSettingsRefinementCoverPicker()}
    `;
  }

  function closeRefinementBookCoverPicker() {
    const modal = document.getElementById("refinementCoverPickerModal");
    if (modal) modal.hidden = true;
  }

  function setRefinementBookCoverSelection(coverPath) {
    const resolvedPath = String(coverPath || "").trim();
    const coverInput = document.getElementById("settingsRefinementBookCoverInput");
    const coverPreview = document.getElementById("settingsRefinementBookCoverPreview");
    const titleInput = document.getElementById("settingsRefinementBookTitleInput");
    const clearBtn = document.querySelector("[data-action='clear-refinement-book-cover']");
    const title = titleInput instanceof HTMLInputElement ? String(titleInput.value || "").trim() : "教材封面";

    if (coverInput instanceof HTMLInputElement) {
      coverInput.value = resolvedPath;
    }

    if (coverPreview) {
      coverPreview.innerHTML = renderSettingsRefinementCoverPreview(resolvedPath, title);
    }

    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.disabled = !resolvedPath;
    }
  }

  async function openRefinementBookCoverPicker(lectureId, bookId) {
    const resolvedLectureId = String(lectureId || "").trim();
    const resolvedBookId = String(bookId || "").trim();

    if (!resolvedLectureId || !resolvedBookId) return;

    const modal = document.getElementById("refinementCoverPickerModal");
    const body = document.getElementById("refinementCoverPickerBody");

    if (modal) {
      modal.hidden = false;
    }

    if (!body) return;

    body.innerHTML = '<div class="materials-empty">加载中...</div>';

    try {
      const res = await fetchJson(`/api/lectures/${encodeURIComponent(resolvedLectureId)}/books/${encodeURIComponent(resolvedBookId)}/cover-assets`);
      const items = Array.isArray(res.items) ? res.items : [];

      if (!items.length) {
        body.innerHTML = '<div class="materials-empty">暂无可用图片，请先完成教材解析</div>';
        return;
      }

      const currentCover = String((document.getElementById("settingsRefinementBookCoverInput") || {}).value || "").trim();
      const html = `
        <div class="settings-cover-picker-grid">
          ${items.map((item) => {
            const coverPath = String(item.cover_path || "").trim();
            const imageUrl = String(item.image_url || coverPath).trim();
            const isSelected = coverPath === currentCover;
            return `
              <button class="settings-cover-picker-item${isSelected ? " is-selected" : ""}" type="button" data-action="select-refinement-book-cover" data-cover-path="${escapeHtml(coverPath)}" aria-label="${escapeHtml(String(item.name || item.alt || "选择封面"))}">
                <img src="${escapeHtml(resolveApiUrl(imageUrl))}" alt="" loading="lazy">
              </button>
            `;
          }).join("")}
        </div>
      `;
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<div class="materials-empty">加载失败：${escapeHtml(err.message || "未知错误")}</div>`;
    }
  }

  async function saveRefinementBookInfo(lectureId, bookId) {
    const resolvedLectureId = String(lectureId || "").trim();
    const resolvedBookId = String(bookId || "").trim();
    const titleInput = document.getElementById("settingsRefinementBookTitleInput");
    const descInput = document.getElementById("settingsRefinementBookDescInput");
    const coverInput = document.getElementById("settingsRefinementBookCoverInput");

    if (!resolvedLectureId || !resolvedBookId) return false;

    const title = titleInput instanceof HTMLInputElement ? String(titleInput.value || "").trim() : "";
    const description = descInput instanceof HTMLTextAreaElement ? String(descInput.value || "").trim() : "";
    const coverPath = coverInput instanceof HTMLInputElement ? String(coverInput.value || "").trim() : "";

    if (!title) {
      showToast("教材名称不能为空");

      if (titleInput instanceof HTMLInputElement) {
        titleInput.focus();
      }

      return false;
    }

    await fetchJson(`/api/lectures/${encodeURIComponent(resolvedLectureId)}/books/${encodeURIComponent(resolvedBookId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        cover_path: coverPath,
      }),
    });

    state.selectedAgentBookKey = getSettingsRefinementBookKey(resolvedLectureId, resolvedBookId);
    await loadMaterialsRows();
    await loadRefinementSettings();

    const main = document.getElementById("agentFlowchart");
    if (main) {
      main.removeAttribute("data-selected-book-key");
    }

    renderSettingsRefinement();
    return true;
  }

  function renderSettingsRefinement() {
    const queueSize = toNumber(state.refinementQueue.queue_size, 0);
    const runningCount = toNumber(state.refinementQueue.running_count, 0);
    const rows = Array.isArray(state.refinementRows) ? state.refinementRows : [];

    if (!state.refinementViewBootstrapped) {
      el.settingsDetailPane.innerHTML = `
        <div class="agent-panel-layout">
          <div class="agent-panel-sidebar">
            <div class="channel-list-header">
              <span class="channel-list-title">教材列表</span>
              <div id="settingsBookUploadHost"></div>
            </div>
            <div id="agentBookList"></div>
          </div>
          <div class="agent-panel-main" id="agentFlowchart"></div>
        </div>
      `;
      if (!state.selectedAgentBookKey && rows.length) {
        const first = rows[0];
        state.selectedAgentBookKey = getSettingsRefinementBookKey(first.lecture_id, first.book_id);
      }
      state.refinementViewBootstrapped = true;
    }

    const sidebar = document.getElementById("agentBookList");
    const main = document.getElementById("agentFlowchart");
    const uploadHost = document.getElementById("settingsBookUploadHost");
    if (!sidebar || !main) return;
    if (uploadHost) {
      uploadHost.innerHTML = renderSettingsBookUploadEntry();
    }

    const listHtml = rows.map((item) => {
      const key = getSettingsRefinementBookKey(item.lecture_id, item.book_id);
      const title = getSettingsRefinementBookTitle(item);
      const lecture = String(item.lecture_title || "");
      const flow = buildRefineFlow(item);
      const isSelected = key === state.selectedAgentBookKey && state.settingsRefinementView !== "upload";
      const lectureId = String(item.lecture_id || "");
      const bookId = String(item.book_id || "");
      const rowData = (state.allLectureRows || []).find((row) => String((row.lecture || {}).id || "") === lectureId);
      const book = rowData && Array.isArray(rowData.books)
        ? rowData.books.find((entry) => String(entry.id || "") === bookId)
        : null;
      const coverPath = String((book && (book.cover_path || book.cover)) || "").trim();
      return `
        <div class="agent-book-item${isSelected ? " is-selected" : ""}" data-book-key="${escapeHtml(key)}">
          ${coverPath
            ? `<div class="settings-course-list-cover"><img src="${escapeHtml(resolveApiUrl(coverPath))}" alt=""></div>`
            : '<div class="settings-course-list-cover settings-course-list-cover-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M20 22V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/></svg></div>'}
          <div class="agent-book-info">
            <div class="agent-book-title">${escapeHtml(title)}</div>
            <div class="agent-book-meta">${escapeHtml(lecture)} · ${flow.doneCount}/${flow.steps.length}</div>
          </div>
          ${isSelected ? `<button class="agent-book-reset" data-action="stop-refinement" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" type="button" title="重置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>` : ""}
        </div>`;
    }).join("");

    sidebar.innerHTML = rows.length ? listHtml : '<div class="materials-empty">暂无教材</div>';

    // 绑定教材选择
    sidebar.querySelectorAll(".agent-book-item").forEach((el) => {
      el.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-action='stop-refinement']")) return;

        state.selectedAgentBookKey = String(el.getAttribute("data-book-key") || "");
        state.settingsRefinementView = "detail";
        renderSettingsRefinement();
      });
    });

    if (state.settingsRefinementView === "upload") {
      main.removeAttribute("data-selected-book-key");

      if (!main.querySelector(".settings-book-upload-panel")) {
        main.innerHTML = renderSettingsBookUploadPanel(state.selectedLectureId);
      }

      syncSettingsBookUploadControls();
      return;
    }

    if (!rows.length) {
      main.removeAttribute("data-selected-book-key");
      main.innerHTML = '<div class="materials-empty">暂无教材，点击左上角加号即可上传教材</div>';
      return;
    }

    // 右侧拆为教材资料区与模型活动区，轮询时只更新模型活动区，避免覆盖正在编辑的表单。
    const selected = rows.find((r) => getSettingsRefinementBookKey(r.lecture_id, r.book_id) === state.selectedAgentBookKey) || rows[0];
    if (!selected) {
      main.removeAttribute("data-selected-book-key");
      main.innerHTML = '<div class="materials-empty">请选择教材</div>';
      return;
    }

    const selectedKey = getSettingsRefinementBookKey(selected.lecture_id, selected.book_id);
    state.selectedAgentBookKey = selectedKey;

    const shouldRenderWorkbench = main.getAttribute("data-selected-book-key") !== selectedKey
      || !main.querySelector(".settings-refinement-workbench")
      || !main.querySelector("#agentFlowchartFlow");

    if (shouldRenderWorkbench) {
      main.setAttribute("data-selected-book-key", selectedKey);
      main.innerHTML = renderSettingsRefinementWorkbench(selected);
    }

    const flowHost = main.querySelector("#agentFlowchartFlow");
    if (flowHost) {
      renderAgentFlowchart(flowHost, selected);
    }
  }

  function renderAgentFlowchart(container, item) {
    const flow = buildRefineFlow(item);
    const lectureId = String(item.lecture_id || "");
    const bookId = String(item.book_id || "");
    const bookTitle = getSettingsRefinementBookTitle(item);
    const progressSteps = Array.isArray(item.progress_steps) ? item.progress_steps : [];

    const SVG_ICONS = {
      play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
      tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    };

    const AGENT_SVG = {
      coarse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      section: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v18M18 3v18M3 6h18M3 12h18M3 18h18"/></svg>',
      intensive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
      question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 5.12 2.13c0 2-3 2-3 4.87M12 17h.01"/></svg>',
      annotation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
      outline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
      video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    };

    // 增量更新：已有结构则只更新状态和日志，否则全量渲染
    const existingNodes = container.querySelectorAll(".flow-node[data-agent-key]");
    if (existingNodes.length === flow.steps.length) {
      _updateFlowchartIncremental(container, item, flow, progressSteps, SVG_ICONS, AGENT_SVG, lectureId, bookId);
      return;
    }

    // 全量渲染
    container.setAttribute("data-flow-book-key", getSettingsRefinementBookKey(lectureId, bookId));
    let html = `<div class="flow-title">${escapeHtml(bookTitle)}</div>`;
    html += '<div class="flow-nodes">';
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const isLast = i === flow.steps.length - 1;
      const status = step.running ? "running" : step.error ? "error" : step.done ? "done" : step.pending ? "pending" : "idle";
      const icon = AGENT_SVG[step.key] || AGENT_SVG.coarse;
      const { action, enabled } = _getAgentAction(item, step.key);
      const btnHtml = (enabled && !step.pending)
        ? `<button class="flow-node-btn" data-action="${action}" data-lecture-id="${escapeHtml(lectureId)}" data-book-id="${escapeHtml(bookId)}" type="button" title="执行">${SVG_ICONS.play}</button>`
        : "";
      html += `<div class="flow-node is-${status}" data-agent-key="${step.key}">
          <div class="flow-node-icon">${icon}</div>
          <div class="flow-node-label">${escapeHtml(step.label)}</div>
          ${btnHtml}${!isLast ? '<div class="flow-connector"></div>' : ""}
        </div>`;
    }
    html += '</div>';
    html += '<div class="flow-log"><div class="flow-log-title">模型活动</div><div class="flow-log-body" id="flowLogBody"></div></div>';
    container.innerHTML = html;
    _appendLogLines(container, item, flow, progressSteps, SVG_ICONS);
  }

  function _getAgentAction(item, key) {
    if (key === "coarse") return { action: "start-refinement", enabled: canStartRefinement(item) };
    if (key === "video") return { action: "start-video", enabled: canStartVideo(item) };
    if (key === "intensive") return { action: "start-intensive", enabled: canStartIntensive(item) };
    if (key === "section") return { action: "start-section", enabled: canStartSection(item) };
    if (key === "question") return { action: "start-question", enabled: canStartQuestion(item) };
    if (key === "annotation") return { action: "start-annotation", enabled: canStartAnnotation(item) };
    if (key === "summary") return { action: "start-summary", enabled: canStartSummary(item) };
    return { action: "", enabled: false };
  }

  function _updateFlowchartIncremental(container, item, flow, progressSteps, SVG_ICONS, AGENT_SVG, lectureId, bookId) {
    container.setAttribute("data-flow-book-key", getSettingsRefinementBookKey(lectureId, bookId));

    const titleNode = container.querySelector(".flow-title");
    if (titleNode) {
      titleNode.textContent = getSettingsRefinementBookTitle(item);
    }

    // 只更新节点状态 class 和按钮
    for (const step of flow.steps) {
      const node = container.querySelector(`.flow-node[data-agent-key="${step.key}"]`);
      if (!node) continue;
      const status = step.running ? "running" : step.error ? "error" : step.done ? "done" : step.pending ? "pending" : "idle";
      node.className = `flow-node is-${status}`;
      // 更新按钮
      const { action, enabled } = _getAgentAction(item, step.key);
      let btn = node.querySelector(".flow-node-btn");
      if (enabled && !step.pending) {
        if (!btn) {
          btn = document.createElement("button");
          btn.className = "flow-node-btn";
          btn.type = "button";
          btn.title = "执行";
          btn.innerHTML = SVG_ICONS.play;
          node.appendChild(btn);
        }
        btn.setAttribute("data-action", action);
        btn.setAttribute("data-lecture-id", lectureId);
        btn.setAttribute("data-book-id", bookId);
      } else if (btn) {
        btn.remove();
      }
    }
    // 更新活动日志
    _appendLogLines(container, item, flow, progressSteps, SVG_ICONS);
  }

  function _appendLogLines(container, item, flow, progressSteps, SVG_ICONS) {
    const logBody = container.querySelector(".flow-log-body");
    if (!logBody) return;
    const logLines = [];
    for (const step of flow.steps) {
      const err = String(item[`${step.key}_error`] || "").trim();
      if (err) logLines.push({ type: "error", text: `${step.label}：${err}` });
    }
    for (const s of progressSteps.slice(-15).reverse()) {
      const stype = String(s && s.type || "").trim();
      const title = String(s && s.title || "");
      const preview = String(s && s.preview || "");
      if (stype === "model_text") logLines.push({ type: "model", text: preview });
      else if (stype) logLines.push({ type: "tool", text: title, detail: preview });
    }
    logBody.innerHTML = logLines.map((line) => {
      if (line.type === "error") return `<div class="flow-log-line is-error">${SVG_ICONS.warn}<span>${escapeHtml(line.text)}</span></div>`;
      if (line.type === "model") return `<div class="flow-log-line is-model"><pre>${escapeHtml(line.text)}</pre></div>`;
      if (line.type === "tool") return `<div class="flow-log-line is-tool">${SVG_ICONS.tool}<span>${escapeHtml(line.text)}</span>${line.detail ? `<span class="flow-log-detail">${escapeHtml(line.detail.slice(0, 50))}</span>` : ""}</div>`;
      return "";
    }).join("");
  }

  const SETTINGS_MODEL_PROVIDER_LABELS = Object.freeze({
    aliyun: "阿里云",
    baidu: "百度智能云",
    dashscope: "通义千问",
    deepseek: "DeepSeek",
    github: "GitHub",
    hunyuan: "腾讯混元",
    minimax: "MiniMax",
    moonshot: "月之暗面",
    ollama: "Ollama",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    siliconflow: "SiliconFlow",
    stepfun: "阶跃星辰",
    tencent_cloud: "腾讯云",
    tongyi: "通义千问",
    volcengine: "火山引擎",
    xunfei_spark: "讯飞星火",
    zhipu: "智谱清言",
  });

  function normalizeSettingsModelOption(row) {
    if (!row || typeof row !== "object") return null;

    const id = String(row.id || row.model || row.name || "").trim();

    if (!id) return null;

    return {
      id,
      label: String(row.label || row.name || id).trim() || id,
      provider: String(row.provider || row.owned_by || row.provider_key || row.vendor || "").trim(),
      status: String(row.status || row.state || "").trim(),
    };
  }

  function normalizeSettingsModelOptions(rows) {
    const out = [];
    const seen = new Set();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const option = normalizeSettingsModelOption(row);

      if (!option || seen.has(option.id)) return;

      seen.add(option.id);
      out.push(option);
    });

    return out;
  }

  function getSettingsModelProviderLabel(provider) {
    const raw = String(provider || "").trim();

    if (!raw) return "未标注 Provider";

    const key = raw.toLowerCase();

    return SETTINGS_MODEL_PROVIDER_LABELS[key] || raw;
  }

  function getSettingsModelDisplayOption(value, optionsById) {
    const id = String(value || "").trim();

    if (!id) {
      return {
        id: "",
        label: "(空)",
        provider: "",
        status: "",
      };
    }

    if (optionsById.has(id)) return optionsById.get(id);

    return {
      id,
      label: id,
      provider: "",
      status: "missing",
    };
  }

  function renderSettingsModelSelectedHtml(option) {
    const data = option || {};

    if (!data.id) {
      return `<span class="settings-model-selected settings-model-selected-empty"><span class="settings-model-selected-name">(空)</span></span>`;
    }

    const providerLabel = getSettingsModelProviderLabel(data.provider);
    const missingClass = data.status === "missing" || !data.provider ? " is-missing" : "";
    const missingText = data.status === "missing" ? `<span class="settings-model-state-badge">未在可用列表</span>` : "";

    return `
      <span class="settings-model-selected">
        <span class="settings-model-selected-name">${escapeHtml(data.label || data.id)}</span>
        <span class="settings-model-provider-badge${missingClass}">${escapeHtml(providerLabel)}</span>
        ${missingText}
      </span>
    `;
  }

  function renderSettingsModelOptionHtml(option, selectedValue) {
    const providerLabel = getSettingsModelProviderLabel(option.provider);
    const selectedClass = String(option.id) === String(selectedValue) ? " is-selected" : "";
    const idMeta = option.label && option.label !== option.id
      ? `<span class="settings-model-option-id">${escapeHtml(option.id)}</span>`
      : "";

    return `
      <div class="nxl-custom-select-option settings-model-option${selectedClass}" data-value="${escapeHtml(option.id)}">
        <span class="settings-model-option-main">
          <span class="settings-model-option-name">${escapeHtml(option.label || option.id)}</span>
          ${idMeta}
        </span>
        <span class="settings-model-provider-badge">${escapeHtml(providerLabel)}</span>
      </div>
    `;
  }

  function renderSettingsModelOptionGroups(options, selectedValue) {
    const groups = new Map();

    options.forEach((option) => {
      const providerKey = String(option.provider || "").trim().toLowerCase();
      const key = providerKey || "__missing_provider__";

      if (!groups.has(key)) {
        groups.set(key, {
          provider: option.provider,
          rows: [],
        });
      }

      groups.get(key).rows.push(option);
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      const aLabel = getSettingsModelProviderLabel(a.provider);
      const bLabel = getSettingsModelProviderLabel(b.provider);

      return aLabel.localeCompare(bLabel, "zh-CN");
    });

    return sortedGroups.map((group) => {
      const providerLabel = getSettingsModelProviderLabel(group.provider);

      return `
        <div class="settings-model-provider-group">
          <div class="settings-model-provider-title">
            <span>${escapeHtml(providerLabel)}</span>
            <span class="settings-model-provider-count">${group.rows.length}</span>
          </div>
          ${group.rows.map((row) => renderSettingsModelOptionHtml(row, selectedValue)).join("")}
        </div>
      `;
    }).join("");
  }

  function renderSettingsModel() {
    const settings = state.modelSettings || {};
    const rough = settings.rough_reading || {};
    const intensive = settings.intensive_reading || {};
    const splitChapters = settings.split_chapters || {};
    const memory = settings.memory || {};
    const profileQuestion = settings.profile_question || {};
    const options = normalizeSettingsModelOptions(state.modelOptions);
    const optionsById = new Map(options.map((row) => [row.id, row]));
    const disabledAttr = state.isAdmin ? "" : "disabled";

    // 模型配置项定义
    const modelFields = [
      { id: "settingsDefaultModelSelect", label: "默认模型", value: settings.default_nexora_model || "" },
      { id: "settingsRoughModelSelect", label: "粗读模型", value: rough.model_name || "" },
      { id: "settingsIntensiveModelSelect", label: "精读模型", value: intensive.model_name || "" },
      { id: "settingsSplitChaptersModelSelect", label: "分节模型", value: splitChapters.model_name || "" },
      { id: "settingsMemoryModelSelect", label: "记忆模型", value: memory.model_name || "" },
      { id: "settingsProfileQuestionModelSelect", label: "画像出题模型", value: profileQuestion.model_name || "" },
    ];

    const formHtml = modelFields.map((field) => `
      <div class="materials-form-row settings-model-row">
        <label class="materials-form-label settings-model-label" for="${field.id}">${escapeHtml(field.label)}</label>
        <div class="nxl-custom-select" data-select-id="${field.id}" data-value="${escapeHtml(String(field.value))}">
          <button class="nxl-custom-select-trigger" type="button" ${disabledAttr}>
            <span class="nxl-custom-select-value">${renderSettingsModelSelectedHtml(getSettingsModelDisplayOption(field.value, optionsById))}</span>
            <svg class="nxl-custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="nxl-custom-select-dropdown">
            <div class="nxl-custom-select-option settings-model-option settings-model-option-empty ${!field.value ? "is-selected" : ""}" data-value="">
              <span class="settings-model-option-main">
                <span class="settings-model-option-name">(空)</span>
              </span>
            </div>
            ${renderSettingsModelOptionGroups(options, field.value)}
          </div>
        </div>
      </div>
    `).join("");

    el.settingsDetailPane.innerHTML = `
      <section class="settings-detail-scroll">
        <article class="settings-card">
          <div class="settings-sub">默认模型为空时，后端不会强制绑定默认模型。</div>
          <div class="settings-inline-form settings-model-form">
            ${formHtml}
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

    // 初始化自定义下拉栏
    document.querySelectorAll(".nxl-custom-select").forEach((selectEl) => {
      const trigger = selectEl.querySelector(".nxl-custom-select-trigger");
      const dropdown = selectEl.querySelector(".nxl-custom-select-dropdown");
      const valueEl = selectEl.querySelector(".nxl-custom-select-value");

      if (trigger) {
        trigger.addEventListener("click", (e) => {
          e.stopPropagation();
          // 关闭其他下拉栏
          document.querySelectorAll(".nxl-custom-select.is-open").forEach((el) => {
            if (el !== selectEl) el.classList.remove("is-open");
          });
          selectEl.classList.toggle("is-open");
        });
      }

      if (dropdown) {
        dropdown.querySelectorAll(".nxl-custom-select-option").forEach((opt) => {
          opt.addEventListener("click", () => {
            const value = String(opt.getAttribute("data-value") || "");
            const selectedOption = getSettingsModelDisplayOption(value, optionsById);

            selectEl.setAttribute("data-value", value);

            if (valueEl) valueEl.innerHTML = renderSettingsModelSelectedHtml(selectedOption);

            dropdown.querySelectorAll(".nxl-custom-select-option").forEach((o) => o.classList.remove("is-selected"));
            opt.classList.add("is-selected");
            selectEl.classList.remove("is-open");
          });
        });
      }
    });

    // 点击外部关闭下拉栏
    document.addEventListener("click", () => {
      document.querySelectorAll(".nxl-custom-select.is-open").forEach((el) => {
        el.classList.remove("is-open");
      });
    });
  }

  function renderSettingsDetail() {
    if (state.settingsTab === "refinement") {
      renderSettingsRefinement();
      return;
    }
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
    if (state.settingsTab === "courses") {
      state.refinementViewBootstrapped = false;
      renderSettingsCourses();
      return;
    }
    if (state.settingsTab === "logs") {
      state.refinementViewBootstrapped = false;
      renderSettingsLogs();
      return;
    }
    if (state.settingsTab === "agents") {
      renderSettingsAgents();
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

