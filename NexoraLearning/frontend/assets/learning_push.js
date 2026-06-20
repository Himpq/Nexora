(function () {
  "use strict";

  const resourceState = {
    items: [],
    loaded: false,
    loading: false,
    videoErrors: [],
    stats: { total: 0, article: 0, video: 0 },
  };

  function canManageResources(ctx) {
    const state = ctx.state || {};
    const user = state.user && typeof state.user === "object" ? state.user : {};
    const identity = String(user.identity || user.role || "").trim().toLowerCase();
    return !!state.isAdmin || identity === "teacher" || identity === "admin";
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

  function isOpenableVideoUrl(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (text.startsWith("/") && !text.startsWith("//")) return true;

    try {
      const url = new URL(text, window.location.origin);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_err) {
      return false;
    }
  }

  async function loadPushItems(ctx, refresh) {
    if (resourceState.loading) return;
    resourceState.loading = true;
    resourceState.videoErrors = [];

    try {
      const query = refresh ? "?refresh=1" : "";
      const data = await resourceApi(ctx, `/api/frontend/learning-resource-pushes${query}`);
      resourceState.items = Array.isArray(data.items) ? data.items : [];
      resourceState.stats = data.stats && typeof data.stats === "object"
        ? data.stats
        : { total: resourceState.items.length, article: 0, video: 0 };
      resourceState.videoErrors = Array.isArray(data.errors) ? data.errors : [];
      resourceState.loaded = true;
    } finally {
      resourceState.loading = false;
    }
  }

  async function refreshResources(ctx) {
    resourceState.loaded = false;
    await loadPushItems(ctx, true);
    render(ctx);
  }

  function buildItems(ctx) {
    return Array.isArray(resourceState.items) ? resourceState.items : [];
  }

  function findResourceItem(ctx, resourceId) {
    const targetId = String(resourceId || "").trim();
    if (!targetId) return null;
    return buildItems(ctx).find((item) => String(item && item.id || "").trim() === targetId) || null;
  }

  function renderInlineMarkdown(ctx, value) {
    const escapeHtml = ctx.escapeHtml || ((text) => String(text || ""));
    let text = escapeHtml(String(value || ""));
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return text;
  }

  function renderMarkdown(ctx, markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let list = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${renderInlineMarkdown(ctx, paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list.length) return;
      html.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(ctx, item)}</li>`).join("")}</ul>`);
      list = [];
    };
    lines.forEach((line) => {
      const raw = String(line || "");
      const trimmed = raw.trim();
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
        html.push(`<h${level}>${renderInlineMarkdown(ctx, heading[2])}</h${level}>`);
        return;
      }
      const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        list.push(bullet[1]);
        return;
      }
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        list.push(ordered[1]);
        return;
      }
      if (trimmed.startsWith(">")) {
        flushParagraph();
        flushList();
        html.push(`<blockquote>${renderInlineMarkdown(ctx, trimmed.replace(/^>\s*/, ""))}</blockquote>`);
        return;
      }
      flushList();
      paragraph.push(trimmed);
    });
    flushParagraph();
    flushList();
    return html.join("") || "<p></p>";
  }

  function renderBlocks(ctx, blocks, itemId) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const rows = Array.isArray(blocks) ? blocks : [];
    if (!rows.length) return "";
    return `
      <div class="learning-push-blocks">
        ${rows.map((block, index) => {
          const type = String(block && block.type || "markdown").trim();
          if (type === "code") {
            const language = String(block.language || "text").trim() || "text";
            const code = String(block.content || "");
            return `
              <div class="learning-push-code" data-push-code-block="${escapeHtml(itemId)}:${index}">
                <div class="learning-push-code-head">
                  <span>${escapeHtml(language)}</span>
                  ${block.runnable ? '<button class="learning-push-run-btn" type="button" data-push-action="run-code">运行</button>' : ""}
                </div>
                <pre><code>${escapeHtml(code)}</code></pre>
                <div class="learning-push-code-output" hidden>浏览器 Python 运行环境已预留，后续可接入 Skulpt 或 Pyodide。</div>
              </div>
            `;
          }
          return `<div class="learning-push-markdown">${renderMarkdown(ctx, String(block && block.content || ""))}</div>`;
        }).join("")}
      </div>
    `;
  }

  function renderCard(ctx, item) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const itemId = String(item && item.id || "").trim();
    const action = String(item && item.action || "").trim();
    const lectureId = String(item && item.lectureId || "").trim();
    const externalUrl = String(item && item.externalUrl || "").trim();
    const coverUrl = String(item && item.coverUrl || "").trim();
    const videoPreviewUrl = String(item && item.videoPreviewUrl || "").trim();
    const secondaryLabel = String(item && item.type || "").trim() === "video" ? "详情" : "阅读";
    return `
      <article class="learning-push-card is-${escapeHtml(String(item && item.type || "article"))}" data-push-resource-id="${escapeHtml(itemId)}">
        ${renderCardMedia(ctx, coverUrl, videoPreviewUrl, item)}
        <div class="learning-push-card-head">
          <span class="learning-push-badge">${escapeHtml(String(item && item.badge || "学习资源"))}</span>
          ${item && item.subtitle ? `<span class="learning-push-subtitle">${escapeHtml(item.subtitle)}</span>` : ""}
        </div>
        <h3>${escapeHtml(String(item && item.title || "学习资源"))}</h3>
        <p class="learning-push-card-summary">${escapeHtml(String(item && item.description || ""))}</p>
        <div class="learning-push-card-foot">
          ${item && item.reason ? `<span class="learning-push-reason is-compact">${escapeHtml(item.reason)}</span>` : "<span></span>"}
          <div class="learning-push-actions">
            <button class="question-bank-action question-bank-action-secondary" type="button" data-push-action="open-resource-reader" data-resource-id="${escapeHtml(itemId)}">${escapeHtml(secondaryLabel)}</button>
            ${action ? `
            <button class="question-bank-action question-bank-action-primary" type="button" data-push-action="${escapeHtml(action)}" data-lecture-id="${escapeHtml(lectureId)}" data-external-url="${escapeHtml(externalUrl)}">
              ${escapeHtml(String(item.actionLabel || "打开"))}
            </button>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function renderCardMedia(ctx, coverUrl, videoPreviewUrl, item) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const title = String(item && item.title || "学习资源").trim();

    if (isOpenableVideoUrl(videoPreviewUrl)) {
      return `
        <div class="learning-push-media">
          <video src="${escapeHtml(videoPreviewUrl)}" preload="metadata" muted playsinline></video>
        </div>
      `;
    }

    if (isOpenableVideoUrl(coverUrl)) {
      return `
        <div class="learning-push-media">
          <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(title)}" referrerpolicy="no-referrer">
        </div>
      `;
    }

    return "";
  }

  function renderResourceStudioEntry(ctx) {
    if (!canManageResources(ctx)) return "";
    return `
      <section class="learning-resource-admin-entry">
        <div>
          <div class="question-bank-kicker">Resource Studio</div>
          <h3>生成工作台</h3>
          <p>组织资源文章、审核发布和伪视频项目；学习资源页只保留阅读、练习和观看入口。</p>
        </div>
        <div class="learning-resource-admin-actions">
          <button class="question-bank-action question-bank-action-soft" type="button" data-push-action="open-resource-studio">
            资源工作台
          </button>
          <button class="question-bank-action question-bank-action-soft" type="button" data-push-action="open-video-studio">
            视频工作台
          </button>
        </div>
      </section>
    `;
  }

  function renderResourceSection(ctx, title, items) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return "";
    return `
      <section class="learning-resource-section">
        <div class="learning-resource-section-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <span>${rows.length} 项</span>
          </div>
          <button class="learning-push-refresh-btn" type="button" data-push-action="refresh-feed">刷新</button>
        </div>
        <div class="learning-push-list">
          ${rows.map((item) => renderCard(ctx, item)).join("")}
        </div>
      </section>
    `;
  }

  function renderReaderAction(ctx, item) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const action = String(item && item.action || "").trim();
    if (!action) return "";
    const lectureId = String(item && item.lectureId || "").trim();
    const externalUrl = String(item && item.externalUrl || "").trim();
    return `
      <div class="resource-reader-actions">
        <button class="question-bank-action question-bank-action-primary" type="button" data-push-action="${escapeHtml(action)}" data-lecture-id="${escapeHtml(lectureId)}" data-external-url="${escapeHtml(externalUrl)}">
          ${escapeHtml(String(item.actionLabel || "打开"))}
        </button>
      </div>
    `;
  }

  function renderResourceComponents(ctx, components) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const data = components && typeof components === "object" ? components : {};
    const quickSummary = String(data.quick_summary || "").trim();
    const conceptCards = Array.isArray(data.concept_cards) ? data.concept_cards : [];
    const reviewQuestions = Array.isArray(data.review_questions) ? data.review_questions : [];
    const practiceBlocks = Array.isArray(data.practice_blocks) ? data.practice_blocks : [];
    if (!quickSummary && !conceptCards.length && !reviewQuestions.length && !practiceBlocks.length) return "";
    return `
      <section class="resource-components">
        ${quickSummary ? `
          <div class="resource-component-block">
            <h2>速读摘要</h2>
            <p>${renderInlineMarkdown(ctx, quickSummary)}</p>
          </div>
        ` : ""}
        ${conceptCards.length ? `
          <div class="resource-component-block">
            <h2>关键概念</h2>
            <div class="resource-concept-grid">
              ${conceptCards.map((card) => `
                <article class="resource-concept-card">
                  <strong>${escapeHtml(String(card && (card.title || card.name) || "概念"))}</strong>
                  <p>${renderInlineMarkdown(ctx, String(card && (card.content || card.description) || ""))}</p>
                </article>
              `).join("")}
            </div>
          </div>
        ` : ""}
        ${reviewQuestions.length ? `
          <div class="resource-component-block">
            <h2>复盘问题</h2>
            <ol class="resource-review-list">
              ${reviewQuestions.map((row) => `
                <li>
                  <strong>${renderInlineMarkdown(ctx, String(row && (row.question || row.title) || ""))}</strong>
                  ${row && row.answer ? `<span>${renderInlineMarkdown(ctx, String(row.answer || ""))}</span>` : ""}
                </li>
              `).join("")}
            </ol>
          </div>
        ` : ""}
        ${practiceBlocks.length ? `
          <div class="resource-component-block">
            <h2>实操代码</h2>
            ${renderBlocks(ctx, practiceBlocks.map((block) => ({
              type: "code",
              language: String(block && (block.language || block.lang) || "text"),
              content: String(block && (block.content || block.code) || ""),
              runnable: !!(block && block.runnable),
            })), "components")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderReader(ctx, item) {
    const el = ctx.el || {};
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const resource = item && typeof item === "object" ? item : null;
    if (!el.learningResourceReaderContent) return;
    if (!resource) {
      if (el.learningResourceReaderTitle) el.learningResourceReaderTitle.textContent = "学习资源";
      if (el.learningResourceReaderSubtitle) el.learningResourceReaderSubtitle.textContent = "Learning Resource";
      el.learningResourceReaderContent.innerHTML = '<div class="materials-empty">没有找到这条学习资源</div>';
      return;
    }
    const itemId = String(resource.id || "").trim();
    const blocks = Array.isArray(resource.blocks) ? resource.blocks : [];
    const components = resource.components && typeof resource.components === "object" ? resource.components : {};
    const bodyBlocks = blocks.length
      ? renderBlocks(ctx, blocks, itemId)
      : `<div class="resource-reader-paragraph">${renderMarkdown(ctx, String(resource.content || resource.description || ""))}</div>`;
    if (el.learningResourceReaderTitle) {
      el.learningResourceReaderTitle.textContent = String(resource.title || "学习资源");
    }
    if (el.learningResourceReaderSubtitle) {
      el.learningResourceReaderSubtitle.textContent = [resource.badge, resource.subtitle].filter(Boolean).join(" · ") || "Learning Resource";
    }
    el.learningResourceReaderContent.innerHTML = `
      <article class="resource-reader-article">
        <header class="resource-reader-hero">
          <div class="learning-push-card-head">
            <span class="learning-push-badge">${escapeHtml(String(resource.badge || "学习资源"))}</span>
            ${resource.subtitle ? `<span class="learning-push-subtitle">${escapeHtml(resource.subtitle)}</span>` : ""}
          </div>
          <h1>${escapeHtml(String(resource.title || "学习资源"))}</h1>
          ${resource.description ? `<p>${escapeHtml(String(resource.description || ""))}</p>` : ""}
          ${resource.reason ? `<div class="learning-push-reason">${escapeHtml(String(resource.reason || ""))}</div>` : ""}
          ${renderReaderAction(ctx, resource)}
        </header>
        <section class="resource-reader-body">
          ${renderResourceComponents(ctx, components)}
          ${bodyBlocks}
        </section>
      </article>
    `;
  }

  function render(ctx) {
    const el = ctx.el || {};
    if (!el.learningPushPanel) return;
    if (!resourceState.loaded && !resourceState.loading) {
      loadPushItems(ctx, false).then(() => render(ctx)).catch((err) => {
        resourceState.videoErrors = [err.message || "视频推送读取失败"];
        resourceState.loaded = true;
        render(ctx);
      });
    }
    const feedItems = buildItems(ctx);
    const total = Number(resourceState.stats.total || feedItems.length) || feedItems.length;
    const articleCount = Number(resourceState.stats.article || 0) || feedItems.filter((item) => item.type !== "video").length;
    const videoCount = Number(resourceState.stats.video || 0) || feedItems.filter((item) => item.type === "video").length;
    el.learningPushPanel.innerHTML = `
      <section class="learning-push-hero">
        <div>
          <div class="question-bank-kicker">AI Resource Feed</div>
          <h2>学习资源</h2>
          <p>从已选课程范围内随机抽取缓存视频、资源文章和已生成视频，保持资源中心专注而不过载。</p>
        </div>
        <div class="learning-push-stats">
          <div><strong>${total}</strong><span>本轮展示</span></div>
          <div><strong>${articleCount}</strong><span>文章</span></div>
          <div><strong>${videoCount}</strong><span>视频</span></div>
        </div>
      </section>
      ${renderVideoStatus(ctx)}
      ${renderResourceStudioEntry(ctx)}
      ${renderResourceSection(ctx, "推荐资源流", feedItems)}
    `;
  }

  function renderVideoStatus(ctx) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const errors = Array.isArray(resourceState.videoErrors) ? resourceState.videoErrors.filter(Boolean) : [];
    if (resourceState.loading) {
      return '<div class="learning-push-status-line">正在读取资源推送...</div>';
    }
    if (!errors.length) return "";
    return `<div class="learning-push-status-line is-error">${errors.map((item) => escapeHtml(item)).join("；")}</div>`;
  }

  async function handlePushAction(ctx, actionNode) {
    if (!actionNode) return false;
    const action = String(actionNode.getAttribute("data-push-action") || "").trim();

    if (action === "run-code") {
      const block = actionNode.closest(".learning-push-code");
      const output = block ? block.querySelector(".learning-push-code-output") : null;
      if (output) output.hidden = false;
      if (typeof ctx.showToast === "function") {
        ctx.showToast("运行环境占位已展示，后续可接入浏览器 Python");
      }
      return true;
    }

    if (action === "refresh-feed") {
      actionNode.disabled = true;

      try {
        await refreshResources(ctx);
        if (typeof ctx.showToast === "function") ctx.showToast("学习资源已刷新");
      } catch (err) {
        if (typeof ctx.showToast === "function") ctx.showToast(`刷新失败：${err.message || "未知错误"}`);
      } finally {
        actionNode.disabled = false;
      }

      return true;
    }

    if (action === "open-resource-reader") {
      const resourceId = String(actionNode.getAttribute("data-resource-id") || "").trim();
      const item = findResourceItem(ctx, resourceId);

      if (item && typeof ctx.openLearningResourceReader === "function") {
        ctx.openLearningResourceReader(item);
      }

      return true;
    }

    if (action === "open-resource-studio") {

      if (typeof ctx.openLearningResourceStudio === "function") {
        ctx.openLearningResourceStudio();
      }

      return true;
    }

    if (action === "open-video-studio") {

      if (typeof ctx.openLearningVideoStudio === "function") {
        ctx.openLearningVideoStudio();
      }

      return true;
    }

    if (action === "open-question-bank") {
      if (ctx.state) ctx.state.dashboardSideTab = "questionBank";
      if (typeof ctx.loadQuestionBank === "function") await ctx.loadQuestionBank();
      if (typeof ctx.syncDashboardSideTabs === "function") ctx.syncDashboardSideTabs();
      return true;
    }

    if (action === "open-external-video") {
      const externalUrl = String(actionNode.getAttribute("data-external-url") || "").trim();

      if (!isOpenableVideoUrl(externalUrl)) {
        if (typeof ctx.showToast === "function") ctx.showToast("视频链接无效，无法打开");
        return true;
      }

      window.open(externalUrl, "_blank", "noopener,noreferrer");
      return true;
    }

    const lectureId = String(actionNode.getAttribute("data-lecture-id") || "").trim();

    if (action === "open-learning-path" && lectureId && typeof ctx.openLearningPathView === "function") {
      ctx.openLearningPathView(lectureId);
      return true;
    }

    if (action === "open-course" && lectureId) {
      if (typeof ctx.setView === "function") ctx.setView("materials");

      if (typeof ctx.openLectureHome === "function") {
        ctx.openLectureHome(lectureId, { returnTarget: "dashboard" });
      }

      return true;
    }

    return false;
  }

  function bindPanel(ctx, panel, flagName) {
    if (!panel || panel.dataset[flagName] === "1") return;
    panel.dataset[flagName] = "1";
    panel.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionNode = target.closest("[data-push-action]");
      if (actionNode && panel.contains(actionNode)) {
        await handlePushAction(ctx, actionNode);
        return;
      }
      const card = target.closest("[data-push-resource-id]");
      if (!card || !panel.contains(card)) return;
      const item = findResourceItem(ctx, card.getAttribute("data-push-resource-id"));
      if (item && typeof ctx.openLearningResourceReader === "function") {
        ctx.openLearningResourceReader(item);
      }
    });
  }

  function bind(ctx) {
    const el = ctx.el || {};
    bindPanel(ctx, el.learningPushPanel, "learningPushBound");
    bindPanel(ctx, el.learningResourceReaderContent, "learningResourceReaderBound");
  }

  function invalidate() {
    resourceState.loaded = false;
  }

  window.NXLLearningPush = {
    bind,
    invalidate,
    render,
    renderReader,
  };
})();
