/**
 * NexoraLearning 前端工具函数集（app.js 提取）
 *
 * 所有函数通过 window.NXLU 命名空间暴露，供 telemetry.js / app.js 共用。
 * 加载顺序: utils.js → telemetry.js → app.js
 */
(function () {
  "use strict";

  /* ───────────────────────────
     常量
  ─────────────────────────── */

  const STATUS_LABELS = {
    draft: "草稿",
    active: "开放学习",
    ready: "已准备",
    archived: "归档",
    paused: "暂停",
  };

  const PIE_COLORS = ["#111111", "#373737", "#585858", "#7a7a7a", "#9d9d9d", "#bbbbbb"];

  /* ───────────────────────────
     HTML & 字符串工具
  ─────────────────────────── */

  /** 将用户/动态态内容转义为安全 HTML */
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /** 解码常见 HTML 实体（用于富文本预处理） */
  function decodeBasicHtmlEntities(src) {
    return String(src || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&#(\d+);/g, (_m, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCharCode(code) : "";
      });
  }

  /** 安全数字转换，非法时返回 fallback */
  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 将 value 限制在 [min, max] 区间 */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /** unix 秒时间戳 → "YYYY-MM-DD HH:mm:ss" */
  function formatTs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "—";
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  }

  /** 将 feed 正文中的 @handle 转为可点击 HTML */
  function renderTextWithMentions(str) {
    const raw = String(str || "");
    const pattern = /@([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})/g;
    let html = "";
    let lastIndex = 0;
    let match = pattern.exec(raw);
    while (match) {
      const start = Number(match.index || 0);
      const whole = String(match[0] || "");
      const handle = String(match[1] || "").trim();
      html += escapeHtml(raw.slice(lastIndex, start)).replace(/\n/g, "<br>");
      html += '<span class="feed-inline-mention" data-mention-handle="' + escapeHtml(handle) + '"> @' + escapeHtml(handle) + ' </span>';
      lastIndex = start + whole.length;
      match = pattern.exec(raw);
    }
    html += escapeHtml(raw.slice(lastIndex)).replace(/\n/g, "<br>");
    return html;
  }

  /** 规范化阅读器选中文本（去多余空白、截断） */
  function normalizeReaderSelectionText(raw, maxLen = 1600) {
    return String(raw || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, Math.max(0, Number(maxLen) || 0));
  }

  /* ───────────────────────────
     API / 路径工具
  ─────────────────────────── */

  /** 将相对 API 路径解析为完整 URL（兼容子路径部署） */
  function resolveApiUrl(path) {
    const rawPath = String(path || "").trim();
    if (!rawPath) return rawPath;
    try {
      const direct = new URL(rawPath);
      return direct.toString();
    } catch (_err) { /* continue */ }
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    try {
      const current = new URL(window.location.href);
      return new URL(normalizedPath, `${current.protocol}//${current.host}`).toString();
    } catch (_err) {
      return normalizedPath;
    }
  }

  /**
   * 将原始文本转换为阅读器 HTML（段落、图片占位、去脚本标签）。
   * 依赖 escapeHtml、resolveApiUrl、decodeBasicHtmlEntities。
   */
  function formatReaderText(text) {
    const raw = String(text || "").replace(/\r\n?/g, "\n");
    const withImages = raw.replace(
      /\{\{nxl_image:([A-Za-z0-9_\-]+):([A-Za-z0-9_\-]+):([A-Za-z0-9._\-]+)(?::([^}]*))?\}\}/g,
      (_m, lectureId, bookId, imageId, altText) => {
        const safeLectureId = encodeURIComponent(String(lectureId || "").trim());
        const safeBookId = encodeURIComponent(String(bookId || "").trim());
        const safeImageId = encodeURIComponent(String(imageId || "").trim());
        const alt = escapeHtml(String(altText || imageId || "图片"));
        if (!safeLectureId || !safeBookId || !safeImageId) return "";
        const src = resolveApiUrl(`/api/lectures/${safeLectureId}/books/${safeBookId}/images/${safeImageId}`);
        return `\n\n<figure class="materials-preview-figure"><img class="materials-preview-image" src="${src}" alt="${alt}" loading="lazy"></figure>\n\n`;
      },
    );

    const noScripts = withImages
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");

    const structural = noScripts
      .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (m) => `\n\n${m}\n\n`)
      .replace(/<\/(p|div|h[1-6]|section|article|blockquote|tr|table)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ");

    const imageBlocks = [];
    const masked = structural.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (m) => {
      const token = `@@NXL_FIGURE_${imageBlocks.length}@@`;
      imageBlocks.push(m);
      return `\n\n${token}\n\n`;
    });

    const noTags = masked.replace(/<[^>]+>/g, " ");
    const readable = decodeBasicHtmlEntities(noTags)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!readable) {
      return '<p class="materials-preview-paragraph">（暂无文本内容）</p>';
    }

    return readable
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (!lines.length) return "";
        if (lines.length === 1) {
          const figureMatch = lines[0].match(/^@@NXL_FIGURE_(\d+)@@$/);
          if (figureMatch) {
            const figureIdx = Number(figureMatch[1]);
            return imageBlocks[figureIdx] || "";
          }
        }
        return `<p class="materials-preview-paragraph">${lines.map(escapeHtml).join("<br>")}</p>`;
      })
      .filter(Boolean)
      .join("");
  }

  /* ───────────────────────────
     状态 / 标签工具
  ─────────────────────────── */

  function normalizeStatusKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function statusText(status) {
    const key = normalizeStatusKey(status);
    return STATUS_LABELS[key] || key || "未知状态";
  }

  function vectorStatusLabel(value, provider) {
    const key = normalizeStatusKey(value);
    const providerKey = normalizeStatusKey(provider);
    if (key === "done" && providerKey.includes("placeholder")) return "占位完成(未入库)";
    if (["done", "success", "indexed", "ready"].includes(key)) return "已向量化";
    if (["running", "processing", "pending", "queued"].includes(key)) return "向量化中";
    if (["failed", "error"].includes(key)) return "向量化失败";
    return key || "未开始";
  }

  function materialStatusLabel(value) {
    const key = normalizeStatusKey(value);
    if (["active", "ready", "published"].includes(key)) return "可用";
    if (["draft", "new"].includes(key)) return "草稿";
    if (["archived"].includes(key)) return "归档";
    return key || "未知";
  }

  function statusBadgeClass(value, provider) {
    const key = normalizeStatusKey(value);
    const providerKey = normalizeStatusKey(provider);
    if (key === "done" && providerKey.includes("placeholder")) return "is-placeholder";
    if (["done", "success", "indexed", "ready", "active", "published"].includes(key)) return "is-ready";
    if (["running", "processing", "pending", "queued"].includes(key)) return "is-processing";
    if (["failed", "error"].includes(key)) return "is-error";
    return "is-idle";
  }

  /* ───────────────────────────
     课程 / 数据映射工具
  ─────────────────────────── */

  /** 获取课程显示名 */
  function getLectureTitle(lecture) {
    if (!lecture || typeof lecture !== "object") return "未命名课程";
    return String(lecture.title || lecture.name || lecture.id || "未命名课程");
  }

  /** 计算课程进度百分比（0-100） */
  function getCourseProgress(lecture, books) {
    const list = Array.isArray(books) ? books : [];
    const direct = toNumber(
      (lecture && (lecture.progress ?? lecture.study_progress ?? lecture.learning_progress)) ?? NaN,
      NaN,
    );
    const currentChapter = String((lecture && lecture.current_chapter) || "").trim();
    const nextChapter = String((lecture && lecture.next_chapter) || "").trim();
    if (!list.length && !currentChapter && !nextChapter) return 0;
    if (Number.isFinite(direct)) {
      if (direct >= 100 && !currentChapter && !nextChapter) {
        const hasReadyBook = list.some((b) => ["done", "success", "indexed", "ready"].includes(normalizeStatusKey(b && b.vector_status)));
        if (!hasReadyBook) return 0;
      }
      return clamp(Math.round(direct), 0, 100);
    }
    if (!list.length) return 0;
    let ready = 0;
    list.forEach((book) => {
      const status = String((book && book.vector_status) || "").trim().toLowerCase();
      if (["done", "success", "indexed", "ready"].includes(status)) ready += 1;
    });
    return clamp(Math.round((ready / list.length) * 100), 0, 100);
  }

  /** 获取学习时长（小时） */
  function getStudyHours(lecture) {
    const hours = toNumber(lecture && lecture.study_hours, NaN);
    if (Number.isFinite(hours) && hours > 0) return hours;
    return 0;
  }

  /** 获取章节当前/下一章节描述 */
  function getChapterInfo(lecture, books) {
    const lectureCurrent = String((lecture && lecture.current_chapter) || "").trim();
    const lectureNext = String((lecture && lecture.next_chapter) || "").trim();
    if (lectureCurrent || lectureNext) {
      return { current: lectureCurrent || "待开始", next: lectureNext || "待规划" };
    }
    const list = Array.isArray(books) ? books : [];
    const first = list.find((b) => String(b.current_chapter || "").trim() || String(b.next_chapter || "").trim());
    if (first) {
      return {
        current: String(first.current_chapter || "").trim() || "待开始",
        next: String(first.next_chapter || "").trim() || "待规划",
      };
    }
    return { current: "待开始", next: "待规划" };
  }

  /** 将 rows 映射为仪表板课程结构体 */
  function buildDashboardCourses(rows) {
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
      const lecture = row && typeof row === "object" ? (row.lecture || {}) : {};
      const books = Array.isArray(row && row.books) ? row.books : [];
      const chapter = getChapterInfo(lecture, books);
      return {
        id: String(lecture.id || `lecture-${index + 1}`),
        title: getLectureTitle(lecture),
        progress: getCourseProgress(lecture, books),
        studyHours: getStudyHours(lecture),
        chapterCurrent: chapter.current,
        chapterNext: chapter.next,
        color: PIE_COLORS[index % PIE_COLORS.length],
      };
    });
  }

  /* ───────────────────────────
     SVG / 甜甜圈图工具
  ─────────────────────────── */

  /** 极坐标转直角坐标 */
  function polarToCartesian(cx, cy, radius, angleDeg) {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
  }

  /** 生成甜甜圈图扇区 SVG path（用于学习时长统计） */
  function donutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const sweep = endAngle - startAngle;
    const normalizedSweep = Math.abs(sweep % 360);
    if (normalizedSweep < 0.0001 && Math.abs(sweep) > 0.0001) {
      const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
      const outerMid = polarToCartesian(cx, cy, outerR, startAngle + 180);
      const innerStart = polarToCartesian(cx, cy, innerR, startAngle + 180);
      const innerMid = polarToCartesian(cx, cy, innerR, startAngle);
      return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerR} ${outerR} 0 1 1 ${outerMid.x} ${outerMid.y}`,
        `A ${outerR} ${outerR} 0 1 1 ${outerStart.x} ${outerStart.y}`,
        "Z",
        `M ${innerStart.x} ${innerStart.y}`,
        `A ${innerR} ${innerR} 0 1 0 ${innerMid.x} ${innerMid.y}`,
        `A ${innerR} ${innerR} 0 1 0 ${innerStart.x} ${innerStart.y}`,
        "Z",
      ].join(" ");
    }
    const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
      "Z",
    ].join(" ");
  }

  /* ───────────────────────────
     Feed 时间格式化
  ─────────────────────────── */

  /** unix 秒时间戳 → 简短相对时间（12s / 3m / 2h / 5/29 14:06） */
  function formatFeedRelativeTime(ts) {
    const value = Number(ts) || 0;
    if (!Number.isFinite(value) || value <= 0) return "";
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - value);
    if (diff < 60) return `${diff || 1}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff <= 86400) return `${Math.floor(diff / 3600)}h`;
    const d = new Date(value * 1000);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hour}:${minute}`;
  }

  /* ───────────────────────────
     暴露到 window.NXLU
  ─────────────────────────── */

  window.NXLU = Object.freeze({
    // constants
    STATUS_LABELS,
    PIE_COLORS,
    // html / string
    renderTextWithMentions,
    escapeHtml,
    decodeBasicHtmlEntities,
    toNumber,
    clamp,
    formatTs,
    normalizeReaderSelectionText,
    // api / path
    resolveApiUrl,
    formatReaderText,
    // status / labels
    normalizeStatusKey,
    statusText,
    vectorStatusLabel,
    materialStatusLabel,
    statusBadgeClass,
    // course / data mapping
    getLectureTitle,
    getCourseProgress,
    getStudyHours,
    getChapterInfo,
    buildDashboardCourses,
    // chart helpers
    polarToCartesian,
    donutPath,
    // time
    formatFeedRelativeTime,
  });
})();
