(function () {
  "use strict";

  const resourceState = {
    items: [],
    loaded: false,
    loading: false,
    videoErrors: [],
    stats: { total: 0, article: 0, video: 0 },
    filter: "all",
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

  function isDirectVideoUrl(value) {
    const text = String(value || "").trim();
    if (!isOpenableVideoUrl(text)) return false;

    try {
      const url = new URL(text, window.location.origin);
      const path = String(url.pathname || "").toLowerCase();
      return /\.(mp4|webm|ogg|mov)$/.test(path);
    } catch (_err) {
      return /\.(mp4|webm|ogg|mov)(?:$|[?#])/.test(text.toLowerCase());
    }
  }

  function getVideoPlayerUrl(item) {
    const resource = item && typeof item === "object" ? item : {};
    const previewUrl = String(resource.videoPreviewUrl || "").trim();
    const externalUrl = String(resource.externalUrl || "").trim();

    if (isDirectVideoUrl(previewUrl)) {
      return previewUrl;
    }

    if (isDirectVideoUrl(externalUrl)) {
      return externalUrl;
    }

    return "";
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

  function compactResourceDescription(title, description) {
    const titleText = String(title || "").trim();
    let summary = String(description || "").trim();

    if (!summary || !titleText) return summary;

    if (summary === titleText) return "";

    if (summary.startsWith(titleText)) {
      summary = summary.slice(titleText.length).replace(/^[\s:：|—-]+/, "").trim();
    }

    return summary;
  }

  function renderCard(ctx, item, index) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const itemId = String(item && item.id || "").trim();
    const coverUrl = String(item && item.coverUrl || "").trim();
    const videoPreviewUrl = String(item && item.videoPreviewUrl || "").trim();
    const title = String(item && item.title || "学习资源").trim();
    const contextLabel = String(item && (item.subtitle || item.badge) || "").trim();
    const itemType = String(item && item.type || "article").trim() === "video" ? "video" : "article";
    const summary = itemType === "video"
      ? ""
      : compactResourceDescription(title, item && item.description);

    const cardClass = [
      "learning-stream-item",
      `is-${itemType}`,
      index === 0 ? "is-featured" : "",
    ].filter(Boolean).join(" ");

    return `
      <article class="${cardClass}" data-push-resource-id="${escapeHtml(itemId)}" data-resource-id="${escapeHtml(itemId)}" data-push-action="open-resource-reader" role="button" tabindex="0">
        ${renderCardMedia(ctx, coverUrl, videoPreviewUrl, item)}
        <div class="learning-stream-body">
          <div class="learning-stream-meta">
            <span class="learning-stream-type">${escapeHtml(itemType === "video" ? "视频" : "文章")}</span>
            ${contextLabel ? `<span>${escapeHtml(contextLabel)}</span>` : ""}
          </div>
          <h3>${escapeHtml(title)}</h3>
          ${summary ? `<p class="learning-stream-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="learning-stream-open-hint" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg>
          </div>
        </div>
      </article>
    `;
  }

  function renderCardMedia(ctx, coverUrl, videoPreviewUrl, item) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const title = String(item && item.title || "学习资源").trim();
    const isVideo = String(item && item.type || "").trim() === "video";
    const playerUrl = getVideoPlayerUrl(item);

    if (playerUrl) {
      return `
        <div class="learning-push-media is-video-preview">
          <video src="${escapeHtml(playerUrl)}" preload="metadata" muted playsinline></video>
          <span class="learning-push-play-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M8 5v14l11-7z"></path>
            </svg>
          </span>
        </div>
      `;
    }

    if (isOpenableVideoUrl(coverUrl)) {
      return `
        <div class="learning-push-media${isVideo ? " is-video-cover" : ""}">
          <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(title)}" referrerpolicy="no-referrer">
          ${isVideo ? `
          <span class="learning-push-play-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M8 5v14l11-7z"></path>
            </svg>
          </span>
          ` : ""}
        </div>
      `;
    }

    return "";
  }

  function renderResourceStudioEntry(ctx) {
    if (!canManageResources(ctx)) return "";
    return `
      <div class="learning-stream-admin-actions" aria-label="内容管理">
        <button class="learning-stream-tool-btn" type="button" data-push-action="open-resource-studio" aria-label="资源工作台" title="资源工作台">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6l2 2h8v12H4Z"></path><path d="M8 12h8M8 15h5"></path></svg>
        </button>
        <button class="learning-stream-tool-btn" type="button" data-push-action="open-video-studio" aria-label="视频工作台" title="视频工作台">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="1"></rect><path d="m17 10 4-2v8l-4-2Z"></path></svg>
        </button>
      </div>
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

  function renderVideoReader(ctx, resource) {
    const el = ctx.el || {};
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const playerUrl = getVideoPlayerUrl(resource);
    const coverUrl = String(resource && resource.coverUrl || "").trim();
    const externalUrl = String(resource && resource.externalUrl || "").trim();
    const metaItems = [
      String(resource && resource.badge || "").trim(),
      String(resource && resource.subtitle || "").trim(),
      String(resource && resource.description || "").trim(),
    ].filter(Boolean);

    if (el.learningResourceReaderTitle) {
      el.learningResourceReaderTitle.textContent = String(resource && resource.title || "课程视频");
    }

    if (el.learningResourceReaderSubtitle) {
      el.learningResourceReaderSubtitle.textContent = [resource && resource.badge, resource && resource.subtitle].filter(Boolean).join(" · ") || "Learning Video";
    }

    el.learningResourceReaderContent.innerHTML = `
      <article class="learning-video-reader">
        <section class="learning-video-stage">
          ${playerUrl ? `
          <video class="learning-video-player" src="${escapeHtml(playerUrl)}" controls preload="metadata" playsinline poster="${escapeHtml(coverUrl)}"></video>
          ` : `
          <a class="learning-video-poster-link" href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">
            ${isOpenableVideoUrl(coverUrl) ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(String(resource && resource.title || "课程视频"))}" referrerpolicy="no-referrer">` : ""}
            <span class="learning-video-poster-action">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M8 5v14l11-7z"></path>
              </svg>
              <strong>打开原视频</strong>
            </span>
          </a>
          `}
        </section>
        <aside class="learning-video-side">
          <div class="learning-video-side-head">
            <span class="learning-push-badge">${escapeHtml(String(resource && resource.badge || "课程视频"))}</span>
            ${resource && resource.subtitle ? `<span class="learning-push-subtitle">${escapeHtml(resource.subtitle)}</span>` : ""}
          </div>
          <h2>${escapeHtml(String(resource && resource.title || "课程视频"))}</h2>
          ${metaItems.length ? `<ul>${metaItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
          ${resource && resource.reason ? `<div class="learning-push-reason">${escapeHtml(String(resource.reason || ""))}</div>` : ""}
          ${renderReaderAction(ctx, resource)}
        </aside>
      </article>
    `;
  }

  function buildResourceReaderToc(components, hasBodyBlocks) {
    const data = components && typeof components === "object" ? components : {};
    const rows = [];
    if (String(data.quick_summary || "").trim()) {
      rows.push({ id: "reader-summary", label: "速读摘要" });
    }
    if (Array.isArray(data.concept_cards) && data.concept_cards.length) {
      rows.push({ id: "reader-concepts", label: "关键概念" });
    }
    if (hasBodyBlocks) {
      rows.push({ id: "reader-body", label: "正文" });
    }
    if (Array.isArray(data.review_questions) && data.review_questions.length) {
      rows.push({ id: "reader-review", label: "复盘问题" });
    }
    if (Array.isArray(data.practice_blocks) && data.practice_blocks.length) {
      rows.push({ id: "reader-practice", label: "实操代码" });
    }
    return rows;
  }

  function renderResourceReaderToc(ctx, rows) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const items = Array.isArray(rows) ? rows : [];
    if (items.length < 2) return "";
    return `
      <nav class="resource-reader-toc" aria-label="文章目录">
        <div class="resource-reader-toc-title">目录</div>
        ${items.map((item) => `
          <a href="#${escapeHtml(item.id)}" data-reader-toc-link="${escapeHtml(item.id)}">${escapeHtml(item.label)}</a>
        `).join("")}
      </nav>
    `;
  }

  function syncResourceReaderToc(panel) {
    if (!panel) return;

    const links = Array.from(panel.querySelectorAll("[data-reader-toc-link]"));
    if (!links.length) return;

    const panelRect = panel.getBoundingClientRect();
    const threshold = Math.max(72, Math.min(140, panelRect.height * 0.18));
    let activeId = String(links[0].getAttribute("data-reader-toc-link") || "").trim();

    links.forEach((link) => {
      const targetId = String(link.getAttribute("data-reader-toc-link") || "").trim();
      const section = targetId ? panel.querySelector(`#${targetId}`) : null;
      if (!section) return;

      const sectionTop = section.getBoundingClientRect().top - panelRect.top;
      if (sectionTop <= threshold) {
        activeId = targetId;
      }
    });

    links.forEach((link) => {
      const isActive = String(link.getAttribute("data-reader-toc-link") || "").trim() === activeId;
      link.classList.toggle("is-active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function bindResourceReaderToc(panel) {
    if (!panel || panel.dataset.resourceReaderTocBound === "1") return;

    panel.dataset.resourceReaderTocBound = "1";
    panel.addEventListener("scroll", () => syncResourceReaderToc(panel), { passive: true });
    panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("[data-reader-toc-link]");
      if (!link || !panel.contains(link)) return;

      window.setTimeout(() => syncResourceReaderToc(panel), 80);
    });
    window.addEventListener("resize", () => syncResourceReaderToc(panel));
  }

  function renderResourceComponentGroup(parts, modifier) {
    const visibleParts = Array.isArray(parts) ? parts.filter(Boolean) : [];
    if (!visibleParts.length) return "";

    const modifierClass = modifier ? ` ${modifier}` : "";
    return `
      <section class="resource-components${modifierClass}">
        ${visibleParts.join("")}
      </section>
    `;
  }

  function renderResourceSummaryBlock(ctx, quickSummary) {
    const summary = String(quickSummary || "").trim();
    if (!summary) return "";

    return `
      <section class="resource-component-block resource-summary-block" id="reader-summary">
        <h2>速读摘要</h2>
        <p>${renderInlineMarkdown(ctx, summary)}</p>
      </section>
    `;
  }

  function renderResourceConceptCards(ctx, conceptCards) {
    const escapeHtml = ctx.escapeHtml || ((value) => String(value || ""));
    const cards = Array.isArray(conceptCards) ? conceptCards : [];
    if (!cards.length) return "";

    return `
      <section class="resource-component-block" id="reader-concepts">
        <h2>关键概念</h2>
        <div class="resource-concept-list">
          ${cards.map((card, index) => `
            <details class="resource-concept-card" ${index === 0 ? "open" : ""}>
              <summary>
                <strong>${escapeHtml(String(card && (card.title || card.name) || "概念"))}</strong>
              </summary>
              <p>${renderInlineMarkdown(ctx, String(card && (card.content || card.description) || ""))}</p>
            </details>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderResourceReviewQuestions(ctx, reviewQuestions) {
    const rows = Array.isArray(reviewQuestions) ? reviewQuestions : [];
    if (!rows.length) return "";

    return `
      <section class="resource-component-block" id="reader-review">
        <h2>复盘问题</h2>
        <ol class="resource-review-list">
          ${rows.map((row) => `
            <li>
              <strong>${renderInlineMarkdown(ctx, String(row && (row.question || row.title) || ""))}</strong>
              ${row && row.answer ? `<span>${renderInlineMarkdown(ctx, String(row.answer || ""))}</span>` : ""}
            </li>
          `).join("")}
        </ol>
      </section>
    `;
  }

  function renderResourcePracticeBlocks(ctx, practiceBlocks) {
    const blocks = Array.isArray(practiceBlocks) ? practiceBlocks : [];
    if (!blocks.length) return "";

    return `
      <section class="resource-component-block" id="reader-practice">
        <h2>实操代码</h2>
        ${renderBlocks(ctx, blocks.map((block) => ({
          type: "code",
          language: String(block && (block.language || block.lang) || "text"),
          content: String(block && (block.content || block.code) || ""),
          runnable: !!(block && block.runnable),
        })), "components")}
      </section>
    `;
  }

  function renderResourceComponents(ctx, components, placement) {
    const data = components && typeof components === "object" ? components : {};
    const quickSummary = String(data.quick_summary || "").trim();
    const conceptCards = Array.isArray(data.concept_cards) ? data.concept_cards : [];
    const reviewQuestions = Array.isArray(data.review_questions) ? data.review_questions : [];
    const practiceBlocks = Array.isArray(data.practice_blocks) ? data.practice_blocks : [];
    if (!quickSummary && !conceptCards.length && !reviewQuestions.length && !practiceBlocks.length) return "";

    if (placement === "before-body") {
      return renderResourceComponentGroup([
        renderResourceSummaryBlock(ctx, quickSummary),
        renderResourceConceptCards(ctx, conceptCards),
      ], "is-before-body");
    }

    if (placement === "after-body") {
      return renderResourceComponentGroup([
        renderResourceReviewQuestions(ctx, reviewQuestions),
        renderResourcePracticeBlocks(ctx, practiceBlocks),
      ], "is-after-body");
    }

    return renderResourceComponentGroup([
      renderResourceSummaryBlock(ctx, quickSummary),
      renderResourceConceptCards(ctx, conceptCards),
      renderResourceReviewQuestions(ctx, reviewQuestions),
      renderResourcePracticeBlocks(ctx, practiceBlocks),
    ], "");
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

    if (String(resource.type || "").trim() === "video") {
      renderVideoReader(ctx, resource);
      return;
    }

    const itemId = String(resource.id || "").trim();
    const blocks = Array.isArray(resource.blocks) ? resource.blocks : [];
    const components = resource.components && typeof resource.components === "object" ? resource.components : {};
    const bodyBlocks = blocks.length
      ? renderBlocks(ctx, blocks, itemId)
      : `<div class="resource-reader-paragraph">${renderMarkdown(ctx, String(resource.content || resource.description || ""))}</div>`;
    const hasBodyBlocks = !!String(bodyBlocks || "").trim();
    const tocRows = buildResourceReaderToc(components, hasBodyBlocks);
    const componentsBeforeBody = renderResourceComponents(ctx, components, "before-body");
    const componentsAfterBody = renderResourceComponents(ctx, components, "after-body");
    const hasStructuredComponents = !!String(`${componentsBeforeBody}${componentsAfterBody}`).trim();
    const articleTitle = String(resource.title || "学习资源");
    if (el.learningResourceReaderTitle) {
      el.learningResourceReaderTitle.textContent = articleTitle;
    }
    if (el.learningResourceReaderSubtitle) {
      el.learningResourceReaderSubtitle.textContent = [resource.badge, resource.subtitle].filter(Boolean).join(" · ") || "Learning Resource";
    }
    el.learningResourceReaderContent.innerHTML = `
      <article class="resource-reader-article">
        <div class="resource-reader-main">
          <header class="resource-reader-overview">
            <div class="resource-reader-meta">
              <span class="learning-push-badge">${escapeHtml(String(resource.badge || "学习资源"))}</span>
              ${resource.subtitle ? `<span class="learning-push-subtitle">${escapeHtml(resource.subtitle)}</span>` : ""}
            </div>
            <h1 class="resource-reader-heading">${escapeHtml(articleTitle)}</h1>
            ${resource.description ? `<p class="resource-reader-lead">${escapeHtml(String(resource.description || ""))}</p>` : ""}
            ${resource.reason ? `<div class="learning-push-reason resource-reader-reason">${escapeHtml(String(resource.reason || ""))}</div>` : ""}
            ${renderReaderAction(ctx, resource)}
          </header>
          <section class="resource-reader-body">
            ${componentsBeforeBody}
            ${hasBodyBlocks ? `
              <section class="resource-article-section${hasStructuredComponents ? "" : " is-plain"}" id="reader-body">
                ${hasStructuredComponents ? '<div class="resource-section-label">正文</div>' : ""}
                ${bodyBlocks}
              </section>
            ` : ""}
            ${componentsAfterBody}
          </section>
        </div>
        ${renderResourceReaderToc(ctx, tocRows)}
      </article>
    `;
    bindResourceReaderToc(el.learningResourceReaderContent);
    window.requestAnimationFrame(() => syncResourceReaderToc(el.learningResourceReaderContent));
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
    const activeFilter = ["all", "video", "article"].includes(resourceState.filter) ? resourceState.filter : "all";
    const filteredItems = feedItems.filter((item) => {
      const itemType = String(item && item.type || "article").trim() === "video" ? "video" : "article";
      return activeFilter === "all" || itemType === activeFilter;
    });
    el.learningPushPanel.innerHTML = `
      <section class="learning-stream-shell">
        <header class="learning-stream-toolbar">
          <div class="learning-stream-filters" role="tablist" aria-label="资源类型">
            ${[
              ["all", "全部", total],
              ["video", "视频", videoCount],
              ["article", "文章", articleCount],
            ].map(([value, label, count]) => `
              <button class="learning-stream-filter${activeFilter === value ? " is-active" : ""}" type="button" data-push-action="filter-feed" data-filter="${value}" aria-selected="${activeFilter === value ? "true" : "false"}">
                ${label}<span>${count}</span>
              </button>
            `).join("")}
          </div>
          <div class="learning-stream-toolbar-actions">
            ${renderResourceStudioEntry(ctx)}
            <button class="learning-stream-refresh" type="button" data-push-action="refresh-feed" aria-label="刷新推荐" title="刷新推荐">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M4 17v-5h5"></path><path d="M6.1 9A7 7 0 0 1 18 6l2 1M17.9 15A7 7 0 0 1 6 18l-2-1"></path></svg>
            </button>
          </div>
        </header>
        ${renderVideoStatus(ctx)}
        <div class="learning-stream-list">
          ${filteredItems.length
            ? filteredItems.map((item, index) => renderCard(ctx, item, index)).join("")
            : '<div class="learning-stream-empty">当前类型暂无推荐资源</div>'}
        </div>
      </section>
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

    if (action === "filter-feed") {
      const filter = String(actionNode.getAttribute("data-filter") || "").trim();

      if (["all", "video", "article"].includes(filter)) {
        resourceState.filter = filter;
        render(ctx);
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
    panel.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const card = target.closest(".learning-stream-item[data-push-action]");
      if (!card || !panel.contains(card)) return;

      event.preventDefault();
      await handlePushAction(ctx, card);
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
