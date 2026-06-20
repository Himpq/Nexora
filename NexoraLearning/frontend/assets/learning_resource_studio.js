(function () {
  "use strict";

  const RESOURCE_TYPES = [
    { value: "explainer", label: "科普解释" },
    { value: "concept", label: "概念辨析" },
    { value: "practice", label: "实操案例" },
    { value: "review", label: "复习清单" },
  ];

  const studioState = {
    lectureId: "",
    resourceType: "explainer",
    mode: "manual",
    title: "",
    suggestions: [],
    selected: new Set(),
    logs: [],
    resources: [],
    selectedResourceId: "",
    loaded: false,
    loading: false,
    busyAction: "",
    pollTimer: 0,
    reviewSyncingId: "",
    reviewSyncedAt: {},
    reviewStreamResourceId: "",
    reviewStreamText: "",
    reviewAbortController: null,
  };

  function canManageResources(ctx) {
    const state = ctx.state || {};
    const user = state.user && typeof state.user === "object" ? state.user : {};
    const identity = String(user.identity || user.role || "").trim().toLowerCase();
    return !!state.isAdmin || identity === "teacher" || identity === "admin";
  }

  function getDashboardLectures(ctx) {
    const state = ctx.state || {};
    const rows = Array.isArray(state.dashboardRows) && state.dashboardRows.length
      ? state.dashboardRows
      : Array.isArray(state.allLectureRows) ? state.allLectureRows : [];
    const getLectureTitle = ctx.getLectureTitle || ((lecture) => String(lecture && lecture.title || "当前课程"));
    const seen = new Set();
    return rows.map((row) => {
      const lecture = row && row.lecture && typeof row.lecture === "object" ? row.lecture : {};
      const lectureId = String(lecture.id || "").trim();
      if (!lectureId || seen.has(lectureId)) return null;
      seen.add(lectureId);
      return { lectureId, title: getLectureTitle(lecture), lecture };
    }).filter(Boolean);
  }

  function getResourceTypeLabel(value) {
    const target = String(value || "").trim();
    const row = RESOURCE_TYPES.find((item) => item.value === target);
    return row ? row.label : "资源文章";
  }

  async function resourceApi(ctx, path, options) {
    if (ctx && typeof ctx.fetchJson === "function") {
      return ctx.fetchJson(path, options);
    }
    const response = await fetch(path, options || {});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    return payload;
  }

  function normalizeTaskLog(task) {
    const row = task && typeof task === "object" ? task : {};
    const statusMap = {
      topics_ready: "选题完成",
      draft_queued: "已排队",
      draft_generating: "生成中",
      draft_pending_generation: "草稿待生成",
      draft_ready: "草稿完成",
      failed: "失败",
    };
    return {
      id: String(row.id || "").trim(),
      status: statusMap[String(row.status || "").trim()] || String(row.status || "记录").trim(),
      title: String(row.title || "未命名资源任务").trim(),
      type: getResourceTypeLabel(row.resource_type),
      lectureTitle: String(row.lecture_title || "").trim(),
      updatedAt: Number(row.updated_at || row.created_at || 0) || 0,
      kind: "task",
    };
  }

  function normalizeResource(row) {
    const item = row && typeof row === "object" ? row : {};
    const status = String(item.status || "draft").trim();
    const statusMap = {
      queued: "已排队",
      generating: "生成中",
      draft: "草稿",
      draft_ready: "草稿完成",
      published: "已发布",
      failed: "失败",
    };
    return {
      id: String(item.id || "").trim(),
      status,
      statusLabel: statusMap[status] || status,
      title: String(item.title || "未命名资源").trim(),
      summary: String(item.summary || item.description || "").trim(),
      content: String(item.content || "").trim(),
      reason: String(item.reason || "").trim(),
      type: getResourceTypeLabel(item.resource_type),
      lectureTitle: String(item.lecture_title || "").trim(),
      updatedAt: Number(item.updated_at || item.created_at || 0) || 0,
      blockCount: Array.isArray(item.blocks) ? item.blocks.length : 0,
      blocks: Array.isArray(item.blocks) ? item.blocks : [],
      components: item.components && typeof item.components === "object" ? item.components : {},
      reviewScan: item.review_scan && typeof item.review_scan === "object" && String(item.review_scan.status || "").trim() ? item.review_scan : null,
      generationActivity: Array.isArray(item.generation_activity) ? item.generation_activity : [],
      currentVersionId: String(item.current_version_id || "").trim(),
      versionCount: Number(item.version_count || (Array.isArray(item.versions) ? item.versions.length : 1)) || 1,
      currentVersion: item.current_version && typeof item.current_version === "object" ? item.current_version : null,
      versions: Array.isArray(item.versions) ? item.versions : [],
      kind: "resource",
    };
  }

  function getReviewScanMeta(resource) {
    const scan = resource && resource.reviewScan && typeof resource.reviewScan === "object" ? resource.reviewScan : null;
    const status = scan ? String(scan.status || "").trim() : "";
    if (status === "passed") {
      return { status, label: "模型已 review", className: "is-passed" };
    }
    if (status === "rejected") {
      return { status, label: "scan 拒绝", className: "is-rejected" };
    }
    if (status === "running") {
      return { status, label: "复核中", className: "is-running" };
    }
    return { status: "", label: "待复核", className: "is-pending" };
  }

  function renderInlineMarkdown(ctx, value) {
    const escapeHtml = ctx.escapeHtml || ((text) => String(text || ""));
    let text = escapeHtml(String(value || ""));
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return text;
  }

  function renderMarkdown(ctx, markdown) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const text = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    const rows = [];
    let paragraph = [];
    let list = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      rows.push(`<p>${renderInlineMarkdown(ctx, paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list.length) return;
      rows.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(ctx, item)}</li>`).join("")}</ul>`);
      list = [];
    };
    lines.forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(4, heading[1].length + 1);
        rows.push(`<h${level}>${renderInlineMarkdown(ctx, heading[2])}</h${level}>`);
        return;
      }
      const bullet = trimmed.match(/^[-*+]\s+(.+)$/) || trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        list.push(bullet[1]);
        return;
      }
      paragraph.push(trimmed);
    });
    flushParagraph();
    flushList();
    return rows.join("") || `<p>${escapeHtml(text)}</p>`;
  }

  function formatDate(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return "暂无时间";
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) return "暂无时间";
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function loadStudioData(ctx, force) {
    if (studioState.loading) return;
    if (studioState.loaded && !force) return;
    studioState.loading = true;
    try {
      const [tasks, resources] = await Promise.all([
        resourceApi(ctx, "/api/frontend/learning-resources/tasks?limit=20"),
        resourceApi(ctx, "/api/frontend/learning-resources?limit=30&include_drafts=1"),
      ]);
      studioState.logs = (Array.isArray(tasks.items) ? tasks.items : []).map(normalizeTaskLog);
      studioState.resources = (Array.isArray(resources.items) ? resources.items : []).map(normalizeResource);
      if (studioState.selectedResourceId && !studioState.resources.some((item) => item.id === studioState.selectedResourceId)) {
        studioState.selectedResourceId = "";
      }
      studioState.loaded = true;
    } catch (_err) {
      studioState.loaded = true;
    } finally {
      studioState.loading = false;
    }
  }

  async function loadResourceDetail(ctx, resourceId) {
    const targetId = String(resourceId || "").trim();
    if (!targetId || studioState.reviewSyncingId === targetId) return null;
    studioState.reviewSyncingId = targetId;
    try {
      const data = await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(targetId)}`);
      const resource = data.resource && typeof data.resource === "object" ? normalizeResource(data.resource) : null;
      if (resource) {
        const index = studioState.resources.findIndex((item) => item.id === resource.id);
        if (index >= 0) studioState.resources.splice(index, 1, resource);
        else studioState.resources.unshift(resource);
        studioState.reviewSyncedAt[resource.id] = Date.now();
        if (ctx.state) ctx.state.learningResourceReviewItem = resource;
      }
      return resource;
    } catch (_err) {
      return null;
    } finally {
      studioState.reviewSyncingId = "";
    }
  }

  function syncResourceRecord(ctx, rawResource) {
    if (!rawResource || typeof rawResource !== "object") return null;

    const resourceId = String(rawResource.id || "").trim();
    const existing = studioState.resources.find((item) => item.id === resourceId) || null;
    const merged = existing
      ? {
          ...existing,
          ...rawResource,
          title: String(rawResource.title || existing.title || "").trim(),
          summary: String(rawResource.summary || rawResource.description || existing.summary || "").trim(),
          content: String(rawResource.content || existing.content || "").trim(),
          lecture_title: String(rawResource.lecture_title || existing.lectureTitle || "").trim(),
        }
      : rawResource;
    const resource = normalizeResource(merged);

    if (!resource) return null;

    const index = studioState.resources.findIndex((item) => item.id === resource.id);

    if (index >= 0) studioState.resources.splice(index, 1, resource);
    else studioState.resources.unshift(resource);

    if (ctx.state) ctx.state.learningResourceReviewItem = resource;

    return resource;
  }

  function reviewActionIcon(name) {
    const icons = {
      scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/><path d="M7 12h10"/><path d="M12 7v10"/></svg>',
      approve: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
      delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
    };

    return `<span class="resource-review-action-icon">${icons[name] || ""}</span>`;
  }

  function renderOptions(ctx, lectures) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const lectureOptions = [
      '<option value="">不限定课程</option>',
      ...lectures.map((item) => (
        `<option value="${escapeHtml(item.lectureId)}" ${studioState.lectureId === item.lectureId ? "selected" : ""}>${escapeHtml(item.title)}</option>`
      )),
    ].join("");
    const typeOptions = RESOURCE_TYPES.map((item) => (
      `<option value="${escapeHtml(item.value)}" ${studioState.resourceType === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`
    )).join("");
    return { lectureOptions, typeOptions };
  }

  function renderTopicPicker(ctx) {
    if (studioState.mode === "manual") return "";
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const suggestions = studioState.suggestions || [];
    if (!suggestions.length) {
      return `
        <div class="resource-studio-topic-empty">
          点击“生成选题”后，这里会列出 10 个可勾选标题；也可以直接填写标题创建草稿。
        </div>
      `;
    }
    return `
      <div class="learning-resource-topics">
        ${suggestions.map((item) => {
          const checked = studioState.selected.has(item.id);
          return `
            <label class="learning-resource-topic${checked ? " is-selected" : ""}">
              <input type="checkbox" data-resource-studio-topic-id="${escapeHtml(item.id)}" ${checked ? "checked" : ""}>
              <span>
                <strong>${escapeHtml(item.title)}</strong>
                ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ""}
              </span>
            </label>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderTaskRows(ctx) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const resources = (Array.isArray(studioState.resources) ? studioState.resources : [])
      .filter((item) => String(item && item.status || "").trim() !== "published");
    const combined = resources
      .map((item) => ({ ...item, label: item.statusLabel || item.status || "草稿" }))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    if (!combined.length) {
      return '<p>暂无待处理草稿。已发布资源会进入学习资源流，不再停留在这里。</p>';
    }
    return combined.slice(0, 14).map((item) => `
      <button class="resource-studio-row${studioState.selectedResourceId === item.id ? " is-active" : ""}" type="button" data-resource-studio-action="open-resource" data-resource-id="${escapeHtml(item.id)}">
        <span class="resource-studio-row-status">${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <em>${escapeHtml([item.type, item.lectureTitle, formatDate(item.updatedAt)].filter(Boolean).join(" · "))}</em>
        ${["draft_ready", "draft", "published"].includes(item.status) ? `<span class="resource-studio-scan-pill ${escapeHtml(getReviewScanMeta(item).className)}">${escapeHtml(getReviewScanMeta(item).label)}</span>` : ""}
        ${item.summary ? `<small>${escapeHtml(item.summary)}</small>` : ""}
      </button>
    `).join("");
  }

  function renderActivityRows(ctx, resource) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const rows = Array.isArray(resource && resource.generationActivity) ? resource.generationActivity : [];
    if (!rows.length) {
      return '<p>暂无模型活动。生成中的草稿会在这里显示调用状态和输出进度。</p>';
    }
    return rows.slice(-12).map((row) => {
      const timestamp = Number(row && row.time || 0) || 0;
      return `
        <div class="resource-studio-activity-row">
          <span>${escapeHtml(timestamp ? formatDate(timestamp) : "刚刚")}</span>
          <strong>${escapeHtml(String(row && row.message || "状态更新"))}</strong>
        </div>
      `;
    }).join("");
  }

  function renderResourcePreview(ctx, resource) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    if (!resource) {
      return `
        <section class="learning-resource-section resource-studio-detail">
          <div class="learning-resource-section-head">
            <h3>草稿详情</h3>
            <span>未选择</span>
          </div>
          <div class="resource-studio-preview-empty">点击右侧草稿，可以查看模型活动和已生成正文。</div>
        </section>
      `;
    }
    const isWorking = ["queued", "generating"].includes(resource.status);
    const content = resource.content || resource.summary || "暂无正文内容。";
    return `
      <section class="learning-resource-section resource-studio-detail${isWorking ? " is-working" : ""}">
        <div class="learning-resource-section-head">
          <div>
            <h3>${escapeHtml(resource.title || "草稿详情")}</h3>
            <p>${escapeHtml([resource.type, resource.lectureTitle].filter(Boolean).join(" · "))}</p>
          </div>
          <span>${escapeHtml(resource.statusLabel || resource.status || "草稿")}</span>
        </div>
        <div class="resource-studio-detail-grid">
          <div class="resource-studio-activity">
            <strong>模型活动</strong>
            ${renderActivityRows(ctx, resource)}
          </div>
          <div class="resource-studio-preview">
            <div class="resource-studio-preview-head">
              <strong>正文预览</strong>
              <span>${isWorking ? "生成中自动刷新" : `${resource.blockCount || 0} 块`}</span>
            </div>
            <pre>${escapeHtml(content)}</pre>
          </div>
        </div>
      </section>
    `;
  }

  function syncResourceStudioPolling(ctx) {
    if (studioState.pollTimer) {
      window.clearTimeout(studioState.pollTimer);
      studioState.pollTimer = 0;
    }
    const selected = studioState.resources.find((item) => item.id === studioState.selectedResourceId);
    if (!selected || !["queued", "generating"].includes(selected.status)) return;
    studioState.pollTimer = window.setTimeout(() => {
      loadStudioData(ctx, true).then(() => {
        render(ctx);
      }).catch(() => {});
    }, 1800);
  }

  function renderComponentSummary(ctx, resource) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const components = resource && resource.components && typeof resource.components === "object" ? resource.components : {};
    const conceptCards = Array.isArray(components.concept_cards) ? components.concept_cards : [];
    const reviewQuestions = Array.isArray(components.review_questions) ? components.review_questions : [];
    const practiceBlocks = Array.isArray(components.practice_blocks) ? components.practice_blocks : [];
    if (!components.quick_summary && !conceptCards.length && !reviewQuestions.length && !practiceBlocks.length) {
      return '<div class="resource-studio-preview-empty">暂无结构化组件，可能是旧草稿或回退 Markdown 生成。</div>';
    }
    return `
      <div class="resource-review-components">
        ${components.quick_summary ? `
          <section>
            <h4>速读摘要</h4>
            <p>${renderInlineMarkdown(ctx, components.quick_summary)}</p>
          </section>
        ` : ""}
        ${conceptCards.length ? `
          <section>
            <h4>关键概念</h4>
            <div class="resource-review-chip-grid">
              ${conceptCards.map((card) => `<span>${escapeHtml(String(card && (card.title || card.name) || "概念"))}</span>`).join("")}
            </div>
          </section>
        ` : ""}
        ${reviewQuestions.length ? `
          <section>
            <h4>复盘问题</h4>
            <ol>${reviewQuestions.map((row) => `<li>${renderInlineMarkdown(ctx, String(row && (row.question || row.title) || ""))}</li>`).join("")}</ol>
          </section>
        ` : ""}
        ${practiceBlocks.length ? `
          <section>
            <h4>实操代码</h4>
            <p>${practiceBlocks.length} 个代码块</p>
          </section>
        ` : ""}
      </div>
    `;
  }

  function renderReviewScan(ctx, resource, scanBusy, options) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const scan = resource && resource.reviewScan && typeof resource.reviewScan === "object" ? resource.reviewScan : null;
    const resourceStatus = String(resource && resource.status || "").trim();
    const canRegenerate = !!(options && options.canRegenerate);
    const regenerateLabel = resourceStatus === "failed" ? "重新生成" : "根据 scan 重新生成";
    const regenerateAction = canRegenerate
      ? `<button class="question-bank-action question-bank-action-soft resource-review-scan-regenerate" type="button" data-resource-review-action="regenerate">${escapeHtml(regenerateLabel)}</button>`
      : "";

    if (scanBusy) {
      return `
        <section class="resource-review-scan is-running">
          <strong>模型复核中</strong>
          <span>正在检查课程相关性、事实可靠性、结构可读性和发布风险。</span>
        </section>
      `;
    }
    if (!scan) {
      if (resourceStatus === "failed") {
        return `
          <section class="resource-review-scan is-rejected">
            <strong>生成失败</strong>
            <span>${escapeHtml(resource.reason || "生成过程失败，可以重新生成一个新版本。")}</span>
            ${regenerateAction}
          </section>
        `;
      }

      return `
        <section class="resource-review-scan is-pending">
          <strong>Article Scan</strong>
          <span>发布前需要先运行模型复核。</span>
        </section>
      `;
    }
    const status = String(scan.status || "").trim();
    const issues = Array.isArray(scan.issues) ? scan.issues : [];
    const checked = Array.isArray(scan.checked) ? scan.checked : [];
    if (status === "running") {
      return `
        <section class="resource-review-scan is-running">
          <strong>${escapeHtml(scan.label || "模型复核中")}</strong>
          ${scan.summary ? `<span>${escapeHtml(scan.summary)}</span>` : ""}
        </section>
      `;
    }
    return `
      <section class="resource-review-scan ${status === "passed" ? "is-passed" : "is-rejected"}">
        <strong>${escapeHtml(scan.label || (status === "passed" ? "模型已 review" : "scan 拒绝"))}</strong>
        ${scan.summary ? `<span>${escapeHtml(scan.summary)}</span>` : ""}
        ${checked.length ? `
          <div class="resource-review-checked">
            ${checked.map((item) => `<span>${escapeHtml(String(item || ""))}</span>`).join("")}
          </div>
        ` : ""}
        ${issues.length ? `
          <div class="resource-review-scan-issues">
            ${issues.map((issue) => `
              <div>
                <em>${escapeHtml(String(issue && issue.severity || "medium"))}</em>
                <b>${escapeHtml(String(issue && issue.title || "复核问题"))}</b>
                ${issue && issue.detail ? `<p>${escapeHtml(String(issue.detail || ""))}</p>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${status === "rejected" ? regenerateAction : ""}
      </section>
    `;
  }

  function renderVersionHistory(ctx, resource) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const versions = Array.isArray(resource && resource.versions) ? resource.versions : [];
    if (!versions.length || versions.length <= 1) return "";
    const currentId = String(resource.currentVersionId || "").trim();
    return `
      <section class="resource-version-panel">
        <div class="resource-version-head">
          <strong>版本记录</strong>
          <span>${versions.length} 版</span>
        </div>
        <div class="resource-version-list">
          ${versions.slice().reverse().map((version) => {
            const versionId = String(version && (version.id || version.version_id) || "").trim();
            const scan = version && version.review_scan && typeof version.review_scan === "object" ? version.review_scan : {};
            const scanStatus = String(scan.status || "").trim();
            const isCurrent = versionId === currentId;
            return `
              <button class="resource-version-row${isCurrent ? " is-current" : ""}" type="button" data-resource-review-action="switch-version" data-version-id="${escapeHtml(versionId)}" ${isCurrent ? "disabled" : ""}>
                <span>v${escapeHtml(String(version && version.number || versionId.replace(/^v/, "") || "?"))}</span>
                <strong>${escapeHtml(isCurrent ? "当前版本" : "切换到此版本")}</strong>
                <em>${escapeHtml(scanStatus || String(version && version.status || "draft"))}</em>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderReviewStreamOutput(ctx, resource, scanBusy) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const resourceId = String(resource && resource.id || "").trim();
    const streamText = studioState.reviewStreamResourceId === resourceId ? String(studioState.reviewStreamText || "") : "";

    if (!scanBusy && !streamText) return "";

    return `
      <section class="resource-review-stream-panel">
        <div class="resource-version-head">
          <strong>Review Streaming Output</strong>
          <span>${scanBusy ? "输出中" : "已完成"}</span>
        </div>
        <textarea class="resource-review-stream-output" readonly>${escapeHtml(streamText)}</textarea>
      </section>
    `;
  }

  function renderReviewActions(ctx, resource, options) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const status = String(resource && resource.status || "").trim();
    const isPublished = status === "published";
    const isWorking = !!(options && options.isWorking);
    const scanBusy = !!(options && options.scanBusy);
    const scanRunning = !!(options && options.scanRunning);
    const scanRejected = !!(options && options.scanRejected);
    const canApprove = !!(options && options.canApprove);
    const publishTitle = String(options && options.publishTitle || "需要模型复核通过后发布");
    const scanLabel = scanBusy ? "复核中..." : scanRunning ? "重新复核" : scanRejected ? "重新复核" : "模型复核";

    if (isPublished) {
      return `
        <div class="resource-review-actions">
          <button class="question-bank-action question-bank-action-secondary resource-review-icon-action" type="button" data-resource-review-action="scan" disabled>${reviewActionIcon("scan")}<span>复核</span></button>
          <button class="question-bank-action question-bank-action-primary resource-review-icon-action" type="button" data-resource-review-action="publish" disabled>${reviewActionIcon("approve")}<span>已通过</span></button>
          <button class="question-bank-action resource-review-delete-action resource-review-icon-action" type="button" data-resource-review-action="delete">${reviewActionIcon("delete")}<span>删除</span></button>
        </div>
      `;
    }

    if (isWorking && status !== "failed") {
      return `
        <div class="resource-review-actions">
          <button class="question-bank-action question-bank-action-secondary resource-review-icon-action" type="button" data-resource-review-action="scan" disabled>${reviewActionIcon("scan")}<span>复核</span></button>
          <button class="question-bank-action question-bank-action-primary resource-review-icon-action" type="button" data-resource-review-action="publish" disabled>${reviewActionIcon("approve")}<span>通过</span></button>
          <button class="question-bank-action resource-review-delete-action resource-review-icon-action" type="button" data-resource-review-action="delete">${reviewActionIcon("delete")}<span>删除</span></button>
        </div>
      `;
    }

    return `
      <div class="resource-review-actions">
        <button class="question-bank-action question-bank-action-secondary resource-review-icon-action" type="button" data-resource-review-action="scan" ${scanBusy ? "disabled" : ""}>${reviewActionIcon("scan")}<span>${scanLabel}</span></button>
        <button class="question-bank-action question-bank-action-primary resource-review-icon-action" type="button" data-resource-review-action="publish" title="${escapeHtml(publishTitle)}" ${canApprove ? "" : "disabled"}>${reviewActionIcon("approve")}<span>通过</span></button>
        <button class="question-bank-action resource-review-delete-action resource-review-icon-action" type="button" data-resource-review-action="delete">${reviewActionIcon("delete")}<span>删除</span></button>
      </div>
    `;
  }

  function renderReview(ctx, resourceArg) {
    const el = ctx.el || {};
    const panel = el.learningResourceReviewPanel;
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    if (!panel) return;
    if (!canManageResources(ctx)) {
      panel.innerHTML = '<div class="materials-empty">当前账号没有资源审核权限</div>';
      return;
    }
    const resourceId = String(resourceArg && resourceArg.id || studioState.selectedResourceId || "").trim();
    const resource = studioState.resources.find((item) => item.id === resourceId) || (resourceArg && typeof resourceArg === "object" ? resourceArg : null);
    if (!resource) {
      panel.innerHTML = '<div class="materials-empty">没有找到这条资源</div>';
      return;
    }
    studioState.selectedResourceId = resource.id;
    const lastSyncAt = Number(studioState.reviewSyncedAt[resource.id] || 0);
    if (Date.now() - lastSyncAt > 1800 && studioState.reviewSyncingId !== resource.id) {
      loadResourceDetail(ctx, resource.id).then((latest) => {
        if (latest && String(studioState.selectedResourceId || "") === latest.id) {
          renderReview(ctx, latest);
        }
      }).catch(() => {});
    }
    if (el.learningResourceReviewTitle) el.learningResourceReviewTitle.textContent = resource.title || "资源审核";
    if (el.learningResourceReviewSubtitle) {
      el.learningResourceReviewSubtitle.textContent = [resource.statusLabel || resource.status, resource.type, resource.lectureTitle].filter(Boolean).join(" · ") || "Review Resource";
    }
    const isWorking = ["queued", "generating"].includes(resource.status);
    const scanStatus = resource.reviewScan && typeof resource.reviewScan === "object" ? String(resource.reviewScan.status || "").trim() : "";
    const scanRejected = scanStatus === "rejected";
    const scanRunning = scanStatus === "running";
    const scanBusy = studioState.busyAction === "scan-resource";
    const canApprove = ["draft_ready", "draft"].includes(resource.status) && String(resource.content || "").trim();
    const canRegenerate = resource.status === "failed" || (["draft_ready", "draft"].includes(resource.status) && (scanRejected || scanRunning));
    const publishTitle = canApprove ? "审批通过并发布" : "草稿正文生成完成后才能审批通过";
    const content = resource.content || resource.summary || "暂无正文内容。";
    const diagnosticHtml = isWorking ? `
      <div class="resource-studio-activity">
        <strong>模型活动</strong>
        ${renderActivityRows(ctx, resource)}
      </div>
      <div class="resource-studio-activity">
        <strong>特殊结构</strong>
        ${renderComponentSummary(ctx, resource)}
      </div>
    ` : "";
    panel.innerHTML = `
      <section class="resource-review-overview">
        <div>
          <div class="question-bank-kicker">Review</div>
          <h2>${escapeHtml(resource.title || "资源审核")}</h2>
          <p>${escapeHtml([resource.type, resource.lectureTitle, `v${resource.currentVersion && resource.currentVersion.number || resource.versionCount || 1}`, formatDate(resource.updatedAt)].filter(Boolean).join(" · "))}</p>
        </div>
        ${renderReviewActions(ctx, resource, { isWorking, scanBusy, scanRunning, canApprove, publishTitle, scanRejected })}
      </section>
      <div class="resource-review-layout">
        <main class="resource-review-main">
          <section class="learning-resource-section resource-review-article${isWorking ? " is-working" : ""}">
            <div class="learning-resource-section-head">
              <div>
                <h3>正文审核</h3>
                <span>${isWorking ? "生成中自动刷新" : `${resource.blockCount || 0} 块`}</span>
              </div>
            </div>
            <article class="resource-review-markdown">${renderMarkdown(ctx, content)}</article>
          </section>
        </main>
        <aside class="resource-review-side">
          <div class="resource-review-side-sticky">
            <div class="resource-review-scan-float">
              ${renderReviewScan(ctx, resource, scanBusy, { canRegenerate })}
            </div>
            ${renderReviewStreamOutput(ctx, resource, scanBusy)}
            ${renderVersionHistory(ctx, resource)}
          </div>
          ${diagnosticHtml}
        </aside>
      </div>
    `;
    if (studioState.pollTimer) {
      window.clearTimeout(studioState.pollTimer);
      studioState.pollTimer = 0;
    }
    if (isWorking || scanRunning) {
      studioState.pollTimer = window.setTimeout(() => {
        loadResourceDetail(ctx, resource.id).then((fresh) => {
          const latest = fresh || studioState.resources.find((item) => item.id === resource.id) || resource;
          if (ctx.state) ctx.state.learningResourceReviewItem = latest;
          renderReview(ctx, latest);
        }).catch(() => {});
      }, 1800);
    }
  }

  async function cancelActiveReviewScan(ctx, resourceId) {
    const targetId = String(resourceId || studioState.selectedResourceId || "").trim();

    if (!targetId) return;

    if (studioState.reviewAbortController) {
      studioState.reviewAbortController.abort();
      studioState.reviewAbortController = null;
    }

    if (studioState.busyAction === "scan-resource") {
      studioState.busyAction = "";
    }

    await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(targetId)}/scan-cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
  }

  async function updateReviewStatus(ctx, status, reason, options) {
    const resourceId = String(studioState.selectedResourceId || "").trim();
    if (!resourceId) return;
    const body = { status, reason: reason || "" };

    if (options && options.confirmed === true) {
      body.confirmed = true;
    }

    const data = await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(resourceId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resource = data.resource && typeof data.resource === "object" ? normalizeResource(data.resource) : null;
    if (resource) {
      const index = studioState.resources.findIndex((item) => item.id === resource.id);
      if (index >= 0) studioState.resources.splice(index, 1, resource);
      else studioState.resources.unshift(resource);
      if (ctx.state) ctx.state.learningResourceReviewItem = resource;
    }
    if (window.NXLLearningPush && typeof window.NXLLearningPush.invalidate === "function") {
      window.NXLLearningPush.invalidate();
    }
    renderReview(ctx, resource || (ctx.state && ctx.state.learningResourceReviewItem));
  }

  function parseSseEventBlock(block) {
    const event = { name: "message", payload: {} };
    const dataRows = [];

    String(block || "").split(/\r?\n/).forEach((line) => {
      if (line.startsWith("event:")) {
        event.name = line.slice(6).trim() || "message";
        return;
      }

      if (line.startsWith("data:")) {
        dataRows.push(line.slice(5).trimStart());
      }
    });

    const dataText = dataRows.join("\n").trim();

    if (dataText) {
      try {
        event.payload = JSON.parse(dataText);
      } catch (_err) {
        event.payload = { content: dataText };
      }
    }

    return event;
  }

  async function runReviewScanStream(ctx, resourceId) {
    const targetId = String(resourceId || "").trim();

    if (!targetId) return null;

    studioState.busyAction = "scan-resource";
    studioState.reviewStreamResourceId = targetId;
    studioState.reviewStreamText = "";
    studioState.reviewAbortController = new AbortController();
    renderReview(ctx, studioState.resources.find((item) => item.id === targetId) || (ctx.state && ctx.state.learningResourceReviewItem));

    const response = await fetch(`/api/frontend/learning-resources/${encodeURIComponent(targetId)}/scan-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: studioState.reviewAbortController.signal,
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let latestResource = null;
    let lastRenderAt = 0;

    const renderStreamingState = () => {
      const now = Date.now();

      if (now - lastRenderAt < 180) return;

      lastRenderAt = now;
      renderReview(ctx, latestResource || studioState.resources.find((item) => item.id === targetId) || (ctx.state && ctx.state.learningResourceReviewItem));
    };

    const handleEvent = (event) => {
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};

      if (event.name === "review_output") {
        studioState.reviewStreamText = String(payload.content || "");
        renderStreamingState();
        return;
      }

      if (event.name === "done") {
        latestResource = syncResourceRecord(ctx, payload.resource);
        studioState.reviewStreamText = studioState.reviewStreamText || JSON.stringify(payload.scan || {}, null, 2);
        return;
      }

      if (event.name === "error") {
        throw new Error(payload.error || payload.message || "模型复核失败");
      }

      if (event.name === "cancelled") {
        throw new DOMException(payload.message || "模型复核已取消", "AbortError");
      }
    };

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() || "";

      blocks.forEach((block) => {
        if (String(block || "").trim()) {
          handleEvent(parseSseEventBlock(block));
        }
      });
    }

    if (buffer.trim()) {
      handleEvent(parseSseEventBlock(buffer));
    }

    studioState.reviewAbortController = null;
    return latestResource;
  }

  function render(ctx) {
    const el = ctx.el || {};
    const panel = el.learningResourceStudioPanel;
    if (!panel) return;
    const listScrollNode = panel.querySelector(".resource-studio-log");
    const previousListScroll = listScrollNode ? Number(listScrollNode.scrollTop || 0) : 0;

    if (!canManageResources(ctx)) {
      panel.innerHTML = '<div class="materials-empty">当前账号没有资源工作台权限</div>';
      return;
    }

    if (!studioState.loaded && !studioState.loading) {
      loadStudioData(ctx).then(() => render(ctx)).catch(() => {});
    }

    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const lectures = getDashboardLectures(ctx);
    if (!studioState.lectureId && lectures.length) {
      studioState.lectureId = lectures[0].lectureId;
    }
    const { lectureOptions, typeOptions } = renderOptions(ctx, lectures);
    const isSuggesting = studioState.busyAction === "suggest-topics";
    const isCreating = studioState.busyAction === "create-draft";
    const isManual = studioState.mode === "manual";
    const canSuggestTopics = !!String(studioState.lectureId || "").trim();
    const selectedCount = studioState.selected.size;
    const draftCount = studioState.resources.filter((item) => item.status !== "published").length;
    const publishedCount = studioState.resources.filter((item) => item.status === "published").length;
    const taskListCount = studioState.resources.filter((item) => item.status !== "published").length;

    panel.innerHTML = `
      <section class="resource-studio-overview">
        <div>
          <div class="question-bank-kicker">Resource Studio</div>
          <h2>资源工作台</h2>
          <p>管理员在这里组织课程资源的选题、草稿和发布前记录；学习资源页只负责给普通用户展示可读内容和练习入口。</p>
        </div>
        <div class="resource-studio-stats">
          <div><strong>${draftCount}</strong><span>草稿</span></div>
          <div><strong>${publishedCount}</strong><span>已发布</span></div>
          <div><strong>${studioState.resources.filter((item) => ["queued", "generating"].includes(item.status)).length}</strong><span>生成中</span></div>
        </div>
      </section>

      <div class="resource-studio-grid">
        <section class="learning-resource-tool resource-studio-generator">
          <div class="learning-resource-tool-head">
            <div>
              <div class="question-bank-kicker">Generate</div>
              <h3>生成资源</h3>
              <p>自拟标题会直接创建草稿并在后台生成正文；模型选题模式会先给出候选标题，再用勾选结果生成草稿。</p>
            </div>
            <button class="question-bank-action question-bank-action-soft" type="button" data-resource-studio-action="refresh" ${studioState.loading ? "disabled" : ""}>刷新</button>
          </div>

          <div class="learning-resource-form">
            <label>
              <span>课程</span>
              <select data-resource-studio-field="lectureId">${lectureOptions}</select>
            </label>
            <label ${isManual ? 'hidden' : ""}>
              <span>资源类型</span>
              <select data-resource-studio-field="resourceType">${typeOptions}</select>
            </label>
            <label>
              <span>生成方式</span>
              <select data-resource-studio-field="mode">
                <option value="manual" ${studioState.mode === "manual" ? "selected" : ""}>自拟标题</option>
                <option value="topics" ${studioState.mode === "topics" ? "selected" : ""}>模型给 10 个选题</option>
              </select>
            </label>
            <label class="learning-resource-title-field">
              <span>标题</span>
              <input type="text" data-resource-studio-field="title" value="${escapeHtml(studioState.title)}" placeholder="例如：用一个案例讲清本章核心概念">
            </label>
          </div>

          <div class="learning-resource-tool-actions">
            <button class="question-bank-action question-bank-action-soft" type="button" data-resource-studio-action="suggest-topics" ${isManual ? "hidden" : ""} ${isSuggesting || isCreating || !canSuggestTopics ? "disabled" : ""}>
              ${isSuggesting ? "生成中..." : canSuggestTopics ? "生成选题" : "先选择课程"}
            </button>
            <button class="question-bank-action question-bank-action-primary" type="button" data-resource-studio-action="create-draft" ${isSuggesting || isCreating ? "disabled" : ""}>
              ${isCreating ? "创建中..." : selectedCount ? `用 ${selectedCount} 个选题生成草稿` : "生成资源草稿"}
            </button>
          </div>

          ${renderTopicPicker(ctx)}
        </section>

        <section class="learning-resource-section resource-studio-list-section">
          <div class="learning-resource-section-head">
            <h3>草稿 / 任务列表</h3>
            <span>${studioState.loading ? "读取中" : `${taskListCount} 项`}</span>
          </div>
          <div class="learning-resource-log resource-studio-log">
            ${renderTaskRows(ctx)}
          </div>
        </section>
      </div>
    `;
    const nextListScrollNode = panel.querySelector(".resource-studio-log");
    if (nextListScrollNode) {
      nextListScrollNode.scrollTop = previousListScroll;
    }
    syncResourceStudioPolling(ctx);
  }

  function bind(ctx) {
    const el = ctx.el || {};
    const panel = el.learningResourceStudioPanel;
    if (panel && panel.dataset.resourceStudioBound !== "1") {
      panel.dataset.resourceStudioBound = "1";

      panel.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const field = target.closest("[data-resource-studio-field]");
      if (!field) return;
      const key = String(field.getAttribute("data-resource-studio-field") || "").trim();
      if (key === "title") {
        studioState.title = String(field.value || "");
      }
    });

      panel.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const field = target.closest("[data-resource-studio-field]");
      if (field) {
        const key = String(field.getAttribute("data-resource-studio-field") || "").trim();
        if (Object.prototype.hasOwnProperty.call(studioState, key)) {
          studioState[key] = String(field.value || "");
          if (key === "mode" && studioState.mode === "manual") {
            studioState.selected.clear();
          }
          render(ctx);
        }
        return;
      }
      const topicNode = target.closest("[data-resource-studio-topic-id]");
      if (topicNode) {
        const topicId = String(topicNode.getAttribute("data-resource-studio-topic-id") || "").trim();
        if (topicId) {
          if (topicNode.checked) studioState.selected.add(topicId);
          else studioState.selected.delete(topicId);
          render(ctx);
        }
      }
    });

      panel.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionNode = target.closest("[data-resource-studio-action]");
      if (!actionNode) return;
      const action = String(actionNode.getAttribute("data-resource-studio-action") || "").trim();

      if (action === "refresh") {
        await loadStudioData(ctx, true);
        render(ctx);
        return;
      }

      if (action === "open-resource") {
        const resourceId = String(actionNode.getAttribute("data-resource-id") || "").trim();
        studioState.selectedResourceId = resourceId;
        const resource = studioState.resources.find((item) => item.id === resourceId) || null;
        if (resource && typeof ctx.openLearningResourceReview === "function") {
          ctx.openLearningResourceReview(resource);
        } else {
          render(ctx);
        }
        return;
      }

      if (action === "suggest-topics") {
        if (!String(studioState.lectureId || "").trim()) {
          if (typeof ctx.showToast === "function") ctx.showToast("请先选择课程后再生成选题");
          return;
        }

        studioState.busyAction = action;
        render(ctx);
        try {
          const data = await resourceApi(ctx, "/api/frontend/learning-resources/topics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lecture_id: studioState.lectureId,
              resource_type: studioState.resourceType,
            }),
          });
          const topics = Array.isArray(data.topics) ? data.topics : [];
          studioState.mode = "topics";
          studioState.suggestions = topics;
          const task = data.task && typeof data.task === "object" ? data.task : null;
          const selected = task && Array.isArray(task.selected_topic_ids)
            ? task.selected_topic_ids
            : topics.slice(0, 3).map((item) => item.id);
          studioState.selected = new Set(selected);
          if (task) studioState.logs.unshift(normalizeTaskLog(task));
          if (typeof ctx.showToast === "function") ctx.showToast("已生成资源选题");
        } catch (err) {
          if (typeof ctx.showToast === "function") ctx.showToast(`生成选题失败：${err.message || "未知错误"}`);
        } finally {
          studioState.busyAction = "";
          render(ctx);
        }
        return;
      }

      if (action === "create-draft") {
        const selectedTopics = studioState.suggestions.filter((item) => studioState.selected.has(item.id));
        const manualTitle = String(studioState.title || "").trim();
        const title = selectedTopics.length === 1
          ? selectedTopics[0].title
          : manualTitle || "未命名资源草稿";
        const confirmText = selectedTopics.length > 1
          ? `确认并行生成 ${selectedTopics.length} 个资源草稿？每个选题会独立调用模型并在后台继续运行。`
          : `确认开始生成资源草稿「${title}」？生成会调用模型并在后台继续运行。`;
        let ok = true;
        if (typeof ctx.confirmModalAsync === "function") {
          ok = await ctx.confirmModalAsync(confirmText);
        } else if (typeof window.confirm === "function") {
          ok = window.confirm(confirmText);
        }
        if (!ok) return;
        studioState.busyAction = action;
        render(ctx);
        try {
          const data = await resourceApi(ctx, "/api/frontend/learning-resources/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lecture_id: studioState.lectureId,
              resource_type: studioState.resourceType,
              title,
              topics: selectedTopics,
              selected_topic_ids: selectedTopics.map((item) => item.id),
            }),
          });
          const tasks = Array.isArray(data.tasks)
            ? data.tasks
            : data.task && typeof data.task === "object" ? [data.task] : [];
          const resources = Array.isArray(data.resources)
            ? data.resources
            : data.resource && typeof data.resource === "object" ? [data.resource] : [];
          tasks.slice().reverse().forEach((task) => {
            if (task && typeof task === "object") studioState.logs.unshift(normalizeTaskLog(task));
          });

          const normalizedResources = resources
            .filter((resource) => resource && typeof resource === "object")
            .map((resource) => normalizeResource(resource));
          normalizedResources.slice().reverse().forEach((normalized) => {
            studioState.resources.unshift(normalized);
          });

          const openedResource = normalizedResources[0] || null;
          if (openedResource) {
            studioState.selectedResourceId = openedResource.id;
            if (typeof ctx.openLearningResourceReview === "function") {
              ctx.openLearningResourceReview(openedResource);
            }
          }
          if (window.NXLLearningPush && typeof window.NXLLearningPush.invalidate === "function") {
            window.NXLLearningPush.invalidate();
          }
          if (typeof ctx.showToast === "function") {
            const createdCount = normalizedResources.length || Number(data.total || 0) || 1;
            ctx.showToast(createdCount > 1 ? `已创建 ${createdCount} 个资源草稿` : "资源草稿已创建");
          }
          window.setTimeout(() => {
            loadStudioData(ctx, true).then(() => render(ctx)).catch(() => {});
          }, 3500);
        } catch (err) {
          if (typeof ctx.showToast === "function") ctx.showToast(`创建草稿失败：${err.message || "未知错误"}`);
        } finally {
          studioState.busyAction = "";
          render(ctx);
        }
      }
      });
    }

    const reviewPanel = el.learningResourceReviewPanel;
    if (reviewPanel && reviewPanel.dataset.resourceReviewBound !== "1") {
      reviewPanel.dataset.resourceReviewBound = "1";
      reviewPanel.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const actionNode = target.closest("[data-resource-review-action]");
        if (!actionNode) return;
        const action = String(actionNode.getAttribute("data-resource-review-action") || "").trim();
        try {
          if (action === "refresh") {
            await loadStudioData(ctx, true);
            const resource = studioState.resources.find((item) => item.id === studioState.selectedResourceId) || null;
            if (ctx.state) ctx.state.learningResourceReviewItem = resource;
            renderReview(ctx, resource);
            return;
          }
          if (action === "delete") {
            const resourceId = String(studioState.selectedResourceId || "").trim();
            const current = studioState.resources.find((item) => item.id === resourceId) || (ctx.state && ctx.state.learningResourceReviewItem) || null;
            const title = String(current && current.title || "当前资源").trim();

            if (!resourceId) return;

            let ok = true;
            const message = `确认删除资源「${title}」？删除后不会继续显示在草稿、审核或学习资源列表中。`;

            if (typeof ctx.confirmModalAsync === "function") {
              ok = await ctx.confirmModalAsync(message);
            } else if (typeof window.confirm === "function") {
              ok = window.confirm(message);
            }

            if (!ok) return;

            await cancelActiveReviewScan(ctx, resourceId);

            await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(resourceId)}`, {
              method: "DELETE",
            });

            studioState.resources = studioState.resources.filter((item) => item.id !== resourceId);
            studioState.selectedResourceId = "";

            if (ctx.state) ctx.state.learningResourceReviewItem = null;

            if (window.NXLLearningPush && typeof window.NXLLearningPush.invalidate === "function") {
              window.NXLLearningPush.invalidate();
            }

            if (typeof ctx.showToast === "function") ctx.showToast("资源已删除");

            await loadStudioData(ctx, true);

            if (typeof ctx.closeLearningResourceReview === "function") {
              ctx.closeLearningResourceReview();
            } else {
              render(ctx);
            }

            return;
          }
          if (action === "publish") {
            const resourceId = String(studioState.selectedResourceId || "").trim();
            const current = studioState.resources.find((item) => item.id === resourceId) || (ctx.state && ctx.state.learningResourceReviewItem) || null;
            const title = String(current && current.title || "当前资源").trim();

            if (!resourceId) return;

            let ok = true;
            const message = `确认审批通过并发布「${title}」？发布后会立即出现在学习资源中。`;

            if (typeof ctx.confirmModalAsync === "function") {
              ok = await ctx.confirmModalAsync(message);
            } else if (typeof window.confirm === "function") {
              ok = window.confirm(message);
            }

            if (!ok) return;

            await cancelActiveReviewScan(ctx, resourceId);
            await updateReviewStatus(ctx, "published", "管理员确认审批通过。", { confirmed: true });
            if (typeof ctx.showToast === "function") ctx.showToast("资源已发布");
            return;
          }
          if (action === "scan") {
            const resourceId = String(studioState.selectedResourceId || "").trim();
            if (!resourceId) return;
            const resource = await runReviewScanStream(ctx, resourceId);
            studioState.busyAction = "";
            renderReview(ctx, resource || (ctx.state && ctx.state.learningResourceReviewItem));
            if (typeof ctx.showToast === "function") {
              const scan = resource && resource.reviewScan ? resource.reviewScan : null;
              ctx.showToast(scan && scan.status === "passed" ? "模型复核通过" : "scan 拒绝");
            }
            return;
          }
          if (action === "switch-version") {
            const resourceId = String(studioState.selectedResourceId || "").trim();
            const versionId = String(actionNode.getAttribute("data-version-id") || "").trim();

            if (!resourceId || !versionId) return;

            await cancelActiveReviewScan(ctx, resourceId);

            const data = await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(resourceId)}/versions/${encodeURIComponent(versionId)}/select`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const resource = syncResourceRecord(ctx, data.resource);

            renderReview(ctx, resource || (ctx.state && ctx.state.learningResourceReviewItem));

            if (typeof ctx.showToast === "function") ctx.showToast("已切换历史版本");

            return;
          }
          if (action === "regenerate") {
            const resourceId = String(studioState.selectedResourceId || "").trim();
            if (!resourceId) return;
            const current = studioState.resources.find((item) => item.id === resourceId) || (ctx.state && ctx.state.learningResourceReviewItem) || null;
            let ok = true;
            const message = current && current.status === "failed"
              ? "确认重新生成这条失败草稿？会创建新版本并保留旧版本记录。"
              : "确认根据当前复核状态重新生成一个新版本？旧版本和 scan 结果会保留。";
            if (typeof ctx.confirmModalAsync === "function") {
              ok = await ctx.confirmModalAsync(message);
            } else if (typeof window.confirm === "function") {
              ok = window.confirm(message);
            }
            if (!ok) return;
            await cancelActiveReviewScan(ctx, resourceId);
            studioState.busyAction = "regenerate-resource";
            renderReview(ctx, studioState.resources.find((item) => item.id === resourceId) || (ctx.state && ctx.state.learningResourceReviewItem));
            const data = await resourceApi(ctx, `/api/frontend/learning-resources/${encodeURIComponent(resourceId)}/regenerate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const resource = syncResourceRecord(ctx, data.resource);
            studioState.busyAction = "";
            renderReview(ctx, resource || (ctx.state && ctx.state.learningResourceReviewItem));
            if (typeof ctx.showToast === "function") ctx.showToast("已创建新版本并开始重新生成");
            return;
          }
          if (action === "return-draft") {
            await updateReviewStatus(ctx, "draft_ready", "管理员退回草稿，等待继续修改。");
            if (typeof ctx.showToast === "function") ctx.showToast("已退回草稿");
          }
        } catch (err) {
          studioState.busyAction = "";
          studioState.reviewAbortController = null;
          renderReview(ctx, ctx.state && ctx.state.learningResourceReviewItem);
          if (err && (err.name === "AbortError" || String(err.message || "").includes("复核已取消"))) {
            return;
          }
          if (typeof ctx.showToast === "function") ctx.showToast(`审核操作失败：${err.message || "未知错误"}`);
        }
      });
    }
  }

  window.NXLLearningResourceStudio = {
    bind,
    render,
    renderReview,
  };
})();
