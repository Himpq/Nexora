(function () {
  "use strict";

  const API_BASE = "/api/frontend/video-generator";
  const STAGES = [
    "outline",
    "script",
    "storyboard",
    "images",
    "vision_description",
    "canvas",
    "audio",
    "clips",
    "timeline",
    "export",
  ];
  const STAGE_LABELS = {
    outline: "大纲",
    script: "脚本",
    storyboard: "分镜",
    images: "生图",
    vision_description: "视觉复核",
    canvas: "画布",
    audio: "配音",
    clips: "分段视频",
    timeline: "时间线",
    export: "导出",
  };
  const STATUS_LABELS = {
    pending: "等待",
    running: "运行中",
    done: "完成",
    failed: "失败",
  };

  const videoState = {
    lectureId: "",
    title: "",
    duration: "90",
    style: "ppt",
    ratio: "16:9",
    projects: [],
    serviceStatus: null,
    loading: false,
    creating: false,
    runningKey: "",
    loaded: false,
    error: "",
    refreshTimer: 0,
  };

  function canManage(ctx) {
    const state = ctx.state || {};
    const user = state.user && typeof state.user === "object" ? state.user : {};
    const identity = String(user.identity || user.role || "").trim().toLowerCase();
    return !!state.isAdmin || identity === "teacher" || identity === "admin";
  }

  function getLectures(ctx) {
    const state = ctx.state || {};
    const rows = Array.isArray(state.dashboardRows) && state.dashboardRows.length
      ? state.dashboardRows
      : Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const getTitle = ctx.getLectureTitle || ((lecture) => String(lecture && lecture.title || "当前课程"));
    const seen = new Set();
    return rows.map((row) => {
      const lecture = row && row.lecture && typeof row.lecture === "object" ? row.lecture : {};
      const lectureId = String(lecture.id || "").trim();

      if (!lectureId || seen.has(lectureId)) return null;

      seen.add(lectureId);
      return { lectureId, title: getTitle(lecture) };
    }).filter(Boolean);
  }

  function getSelectedLectureTitle(ctx) {
    const selected = getLectures(ctx).find((item) => item.lectureId === videoState.lectureId);
    return selected ? selected.title : "";
  }

  function render(ctx) {
    const el = ctx.el || {};
    const panel = el.learningVideoStudioPanel;
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));

    if (!panel) return;

    if (!canManage(ctx)) {
      panel.innerHTML = '<div class="materials-empty">当前账号没有视频工作台权限</div>';
      return;
    }

    const lectures = getLectures(ctx);

    if (!videoState.lectureId && lectures.length) {
      videoState.lectureId = lectures[0].lectureId;
    }

    const projectStats = buildProjectStats();
    const lectureOptions = [
      '<option value="">选择课程</option>',
      ...lectures.map((item) => (
        `<option value="${escapeHtml(item.lectureId)}" ${videoState.lectureId === item.lectureId ? "selected" : ""}>${escapeHtml(item.title)}</option>`
      )),
    ].join("");

    panel.innerHTML = `
      <section class="resource-studio-overview video-studio-overview">
        <div>
          <div class="question-bank-kicker">Video Studio</div>
          <h2>视频生成工作台</h2>
          <p>${escapeHtml(renderStatusText())}</p>
        </div>
        <div class="resource-studio-stats">
          <div><strong>${projectStats.total}</strong><span>任务</span></div>
          <div><strong>${projectStats.running}</strong><span>生成中</span></div>
          <div><strong>${projectStats.done}</strong><span>已完成</span></div>
        </div>
      </section>

      <div class="video-studio-grid">
        <section class="learning-resource-tool video-studio-planner">
          <div class="learning-resource-tool-head">
            <div>
              <div class="question-bank-kicker">Project</div>
              <h3>新建视频项目</h3>
              <p>${escapeHtml(getSelectedLectureTitle(ctx) || "从课程资料创建生成项目")}</p>
            </div>
          </div>
          <div class="learning-resource-form">
            <label>
              <span>课程</span>
              <select data-video-studio-field="lectureId">${lectureOptions}</select>
            </label>
            <label class="learning-resource-title-field">
              <span>视频标题</span>
              <input type="text" data-video-studio-field="title" value="${escapeHtml(videoState.title)}" placeholder="例如：用三分钟讲清本章核心概念">
            </label>
            <label>
              <span>目标时长</span>
              <select data-video-studio-field="duration">
                <option value="60" ${videoState.duration === "60" ? "selected" : ""}>约 1 分钟</option>
                <option value="90" ${videoState.duration === "90" ? "selected" : ""}>约 1.5 分钟</option>
                <option value="180" ${videoState.duration === "180" ? "selected" : ""}>约 3 分钟</option>
              </select>
            </label>
            <label>
              <span>呈现方式</span>
              <select data-video-studio-field="style">
                <option value="ppt" ${videoState.style === "ppt" ? "selected" : ""}>PPT-like 讲解</option>
                <option value="storyboard" ${videoState.style === "storyboard" ? "selected" : ""}>分镜科普</option>
                <option value="case" ${videoState.style === "case" ? "selected" : ""}>案例推演</option>
              </select>
            </label>
            <label>
              <span>画面比例</span>
              <select data-video-studio-field="ratio">
                <option value="16:9" ${videoState.ratio === "16:9" ? "selected" : ""}>16:9 横屏</option>
                <option value="9:16" ${videoState.ratio === "9:16" ? "selected" : ""}>9:16 竖屏</option>
                <option value="1:1" ${videoState.ratio === "1:1" ? "selected" : ""}>1:1 方形</option>
              </select>
            </label>
          </div>
          <div class="learning-resource-tool-actions">
            <button class="question-bank-action question-bank-action-soft" type="button" data-video-studio-action="refresh" ${videoState.loading ? "disabled" : ""}>
              刷新任务
            </button>
            <button class="question-bank-action question-bank-action-primary" type="button" data-video-studio-action="create" ${videoState.creating ? "disabled" : ""}>
              ${videoState.creating ? "创建中..." : "创建任务"}
            </button>
          </div>
        </section>

        <section class="learning-resource-section video-studio-pipeline">
          <div class="learning-resource-section-head">
            <h3>生成流程</h3>
            <span>${escapeHtml(currentRunningText())}</span>
          </div>
          <div class="video-pipeline-list">
            ${STAGES.map((stage, index) => `
              <div class="video-pipeline-step">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(STAGE_LABELS[stage] || stage)}</strong>
              </div>
            `).join("")}
          </div>
        </section>
      </div>

      <section class="learning-resource-section video-studio-task-section">
        <div class="learning-resource-section-head">
          <h3>视频任务</h3>
          <span>${videoState.loading ? "加载中" : `${projectStats.total} 项`}</span>
        </div>
        ${renderError(escapeHtml)}
        ${renderProjectList(escapeHtml)}
      </section>
    `;
  }

  function renderStatusText() {
    if (videoState.error) return videoState.error;

    if (videoState.serviceStatus && videoState.serviceStatus.service) {
      return `${videoState.serviceStatus.service} 已连接`;
    }

    if (videoState.loaded) return "已连接视频生成项目列表";

    return "正在连接视频生成服务";
  }

  function currentRunningText() {
    if (!videoState.runningKey) return "就绪";
    const parts = videoState.runningKey.split(":");
    return `${STAGE_LABELS[parts[1]] || "阶段"}续跑中`;
  }

  function renderError(escapeHtml) {
    if (!videoState.error) return "";
    return `<div class="video-studio-error">${escapeHtml(videoState.error)}</div>`;
  }

  function renderProjectList(escapeHtml) {
    if (videoState.loading && !videoState.projects.length) {
      return '<div class="resource-studio-preview-empty">正在加载视频任务...</div>';
    }

    if (!videoState.projects.length) {
      return '<div class="resource-studio-preview-empty">暂无视频任务</div>';
    }

    return `
      <div class="video-task-list">
        ${videoState.projects.map((project) => renderProjectCard(project, escapeHtml)).join("")}
      </div>
    `;
  }

  function renderProjectCard(project, escapeHtml) {
    const projectId = String(project.id || "").trim();
    const title = String(project.title || projectId || "未命名视频项目").trim();
    const status = String(project.status || "").trim();
    const stages = project.stages && typeof project.stages === "object" ? project.stages : {};
    const exportReady = stages.export === "done";

    return `
      <article class="video-task-card">
        <div class="video-task-main">
          <div>
            <div class="video-task-title">${escapeHtml(title)}</div>
            <div class="video-task-meta">${escapeHtml(projectId)} · ${escapeHtml(status || "created")}</div>
          </div>
          ${exportReady ? `<a class="question-bank-action question-bank-action-soft" href="${API_BASE}/projects/${encodeURIComponent(projectId)}/files/exports/video.mp4" target="_blank" rel="noreferrer">查看成片</a>` : ""}
        </div>
        <div class="video-task-stage-grid">
          ${STAGES.map((stage) => renderStageButton(projectId, stage, stages[stage], escapeHtml)).join("")}
        </div>
      </article>
    `;
  }

  function renderStageButton(projectId, stage, status, escapeHtml) {
    const safeStatus = String(status || "pending").trim();
    const running = videoState.runningKey === `${projectId}:${stage}`;
    const canResume = safeStatus === "failed" && !videoState.runningKey;
    const disabled = !canResume || running;
    const label = running ? "续跑中" : canResume ? "续跑" : STATUS_LABELS[safeStatus] || safeStatus;

    return `
      <button class="video-stage-button video-stage-${escapeHtml(safeStatus)}" type="button" data-video-studio-action="run-stage" data-project-id="${escapeHtml(projectId)}" data-stage="${escapeHtml(stage)}" ${disabled ? "disabled" : ""} title="${canResume ? "从此阶段继续执行后续流程" : "后台会按顺序自动执行"}">
        <span>${escapeHtml(STAGE_LABELS[stage] || stage)}</span>
        <strong>${escapeHtml(label)}</strong>
      </button>
    `;
  }

  function buildProjectStats() {
    const total = videoState.projects.length;
    let running = 0;
    let done = 0;

    videoState.projects.forEach((project) => {
      const status = String(project && project.status || "").trim();
      const stages = project && project.stages && typeof project.stages === "object" ? project.stages : {};

      if (status.includes("running") || Object.values(stages).includes("running")) {
        running += 1;
      }

      if (stages.export === "done") {
        done += 1;
      }
    });

    return { total, running, done };
  }

  function bind(ctx) {
    const el = ctx.el || {};
    const panel = el.learningVideoStudioPanel;

    if (!panel || panel.dataset.videoStudioBound === "1") return;

    panel.dataset.videoStudioBound = "1";
    panel.addEventListener("input", (event) => updateFieldFromEvent(ctx, event, false));
    panel.addEventListener("change", (event) => updateFieldFromEvent(ctx, event, true));
    panel.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const actionNode = target.closest("[data-video-studio-action]");

      if (!actionNode) return;

      const action = String(actionNode.getAttribute("data-video-studio-action") || "").trim();

      if (action === "refresh") {
        refreshProjects(ctx);
        return;
      }

      if (action === "create") {
        createProject(ctx);
        return;
      }

      if (action === "run-stage") {
        const projectId = String(actionNode.getAttribute("data-project-id") || "").trim();
        const stage = String(actionNode.getAttribute("data-stage") || "").trim();
        runProjectStage(ctx, projectId, stage);
      }
    });
    refreshProjects(ctx);
  }

  function updateFieldFromEvent(ctx, event, shouldRender) {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const field = target.closest("[data-video-studio-field]");

    if (!field) return;

    const key = String(field.getAttribute("data-video-studio-field") || "").trim();

    if (Object.prototype.hasOwnProperty.call(videoState, key)) {
      videoState[key] = String(field.value || "");

      if (shouldRender) render(ctx);
    }
  }

  async function refreshProjects(ctx) {
    clearAutoRefresh();
    videoState.loading = true;
    videoState.error = "";
    render(ctx);

    try {
      const statusPayload = await requestJson(`${API_BASE}/status`, { method: "GET" });
      videoState.serviceStatus = statusPayload.status && typeof statusPayload.status === "object" ? statusPayload.status : null;
      const projectsPayload = await requestJson(`${API_BASE}/projects?limit=50`, { method: "GET" });
      videoState.projects = Array.isArray(projectsPayload.projects) ? projectsPayload.projects : [];
      videoState.loaded = true;
    } catch (error) {
      videoState.error = error.message || "视频任务加载失败";
    } finally {
      videoState.loading = false;
      render(ctx);
      scheduleAutoRefresh(ctx);
    }
  }

  async function createProject(ctx) {
    const title = String(videoState.title || "").trim();
    const lectureId = String(videoState.lectureId || "").trim();

    if (!lectureId) {
      showToast(ctx, "请选择课程");
      return;
    }

    if (!title) {
      showToast(ctx, "请输入视频标题");
      return;
    }

    videoState.creating = true;
    videoState.error = "";
    render(ctx);

    try {
      await requestJson(`${API_BASE}/projects`, {
        method: "POST",
        body: JSON.stringify({
          lecture_id: lectureId,
          title,
          duration: videoState.duration,
          style: videoState.style,
          ratio: videoState.ratio,
        }),
      });
      showToast(ctx, "视频任务已创建，后台开始顺序生成");
      videoState.title = "";
      await refreshProjects(ctx);
      scheduleAutoRefresh(ctx, true);
    } catch (error) {
      videoState.error = error.message || "视频任务创建失败";
      render(ctx);
    } finally {
      videoState.creating = false;
      render(ctx);
    }
  }

  async function runProjectStage(ctx, projectId, stage) {
    if (!projectId || !stage) return;

    videoState.runningKey = `${projectId}:${stage}`;
    videoState.error = "";
    render(ctx);

    try {
      await requestJson(`${API_BASE}/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stage)}`, {
        method: "POST",
        body: "{}",
      });
      showToast(ctx, `已从${STAGE_LABELS[stage] || stage}继续后台生成`);
      await refreshProjects(ctx);
      scheduleAutoRefresh(ctx, true);
    } catch (error) {
      videoState.error = error.message || "阶段执行失败";
      render(ctx);
    } finally {
      videoState.runningKey = "";
      render(ctx);
    }
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.success === false) {
      throw new Error(String(payload.error || payload.message || `HTTP ${response.status}`));
    }

    return payload;
  }

  function showToast(ctx, message) {
    if (typeof ctx.showToast === "function") {
      ctx.showToast(message);
    }
  }

  function scheduleAutoRefresh(ctx, force) {
    if (!force && !hasRunningProject()) return;

    videoState.refreshTimer = window.setTimeout(() => {
      videoState.refreshTimer = 0;
      refreshProjects(ctx);
    }, 3000);
  }

  function clearAutoRefresh() {
    if (!videoState.refreshTimer) return;

    window.clearTimeout(videoState.refreshTimer);
    videoState.refreshTimer = 0;
  }

  function hasRunningProject() {
    return videoState.projects.some((project) => {
      const status = String(project && project.status || "").trim();
      const stages = project && project.stages && typeof project.stages === "object" ? project.stages : {};
      return status.includes("running") || Object.values(stages).includes("running");
    });
  }

  window.NXLLearningVideoStudio = {
    bind,
    render,
  };
})();
