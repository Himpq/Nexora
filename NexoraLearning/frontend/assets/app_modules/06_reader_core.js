// ─────── Reader: Chapter Parsing & Text Layout ────────────────────────
  function renderReaderPlaceholder(msg) {
    el.readerContent.innerHTML = `<div class="materials-empty">${escapeHtml(msg || "阅读内容加载中")}</div>`;
  }

  async function fetchBookInfoXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/bookinfo`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchSectionsXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/sections`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchAnnotationsXml() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return "";
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return "";
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/annotations`);
      return String(data.content || "");
    } catch (_err) {
      return "";
    }
  }

  async function fetchBookSummary() {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return { summary_brief: "", summary_detail: "" };
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return { summary_brief: "", summary_detail: "" };
    try {
      const data = await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}/books/${encodeURIComponent(state.selectedBookId)}/summary`);
      return {
        summary_brief: String(data.summary_brief || ""),
        summary_detail: String(data.summary_detail || ""),
      };
    } catch (_err) {
      return { summary_brief: "", summary_detail: "" };
    }
  }

  function parseAnnotationsXml(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return [];
    const annotations = [];
    const reg = /<annotation>\s*([\s\S]*?)\s*<\/annotation>/gi;
    let match = null;
    while ((match = reg.exec(src)) !== null) {
      const block = String(match[1] || "");
      const chapterMatch = block.match(/<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>/i);
      const offsetMatch = block.match(/<offset>\s*([\s\S]*?)\s*<\/offset>/i);
      const lengthMatch = block.match(/<length>\s*([\s\S]*?)\s*<\/length>/i);
      const typeMatch = block.match(/<annotation_type>\s*([\s\S]*?)\s*<\/annotation_type>/i);
      const contentMatch = block.match(/<annotation_content>\s*([\s\S]*?)\s*<\/annotation_content>/i);
      const anchorMatch = block.match(/<anchor_text>\s*([\s\S]*?)\s*<\/anchor_text>/i);
      if (!chapterMatch || !offsetMatch) continue;
      annotations.push({
        chapterName: String(chapterMatch[1] || "").trim(),
        offset: Number(String(offsetMatch[1] || "0").trim()) || 0,
        length: lengthMatch ? (Number(String(lengthMatch[1] || "0").trim()) || 0) : 0,
        type: typeMatch ? String(typeMatch[1] || "思考点").trim() : "思考点",
        content: contentMatch ? String(contentMatch[1] || "").trim() : "",
        anchorText: anchorMatch ? String(anchorMatch[1] || "").trim() : "",
      });
    }
    return annotations;
  }

  function normalizeChapterNameForCompare(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[【】\[\]（）()《》<>「」『』"'“”‘’`~!@#$%^&*+=|\\/:;,.?！？、。·\-—_]/g, "");
  }

  function renderChapterAnnotations(chapterIndex) {
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    const chapterName = String(chapter.title || "").trim();
    const chapterStart = Number(chapter.start) || 0;
    const chapterEnd = Math.max(chapterStart, Number(chapter.end) || chapterStart);
    const chapterRawLength = Math.max(1, chapterEnd - chapterStart);
    const chapterNameNorm = normalizeChapterNameForCompare(chapterName);
    const chapterAnnotations = (state.readerAnnotations || []).filter(a => {
      const annName = String(a && a.chapterName || "").trim();
      if (!annName) return false;
      if (annName === chapterName) return true;
      return normalizeChapterNameForCompare(annName) === chapterNameNorm;
    });
    if (!chapterAnnotations.length) return;

    const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return;

    const paragraphs = chapterBody.querySelectorAll("p.materials-preview-paragraph");
    if (!paragraphs.length) return;

    const paragraphRows = Array.from(paragraphs).map((p) => ({
      el: p,
      text: String(p.textContent || ""),
      length: String(p.textContent || "").length + 1,
    }));
    const visibleTotalLength = Math.max(1, paragraphRows.reduce((sum, row) => sum + row.length, 0));

    const annotationToParagraph = new Map();
    let currentOffset = chapterStart;
    paragraphRows.forEach((row, paragraphIndex) => {
      const pLength = row.length;
      const pStart = currentOffset;
      const pEnd = currentOffset + pLength;

      // Strict offset match (absolute offset in same coordinate system)
      const pAnnotations = chapterAnnotations.filter((a) => {
        return a.offset >= pStart && a.offset < pEnd;
      });

      if (pAnnotations.length > 0) {
        row.el.classList.add("has-annotation");
        pAnnotations.forEach((annotation) => {
          annotationToParagraph.set(annotation, paragraphIndex);
          const marker = createAnnotationMarker(annotation);
          row.el.appendChild(marker);
        });
      }

      currentOffset = pEnd;
    });

    // Fallback path: when strict mapping misses, try anchor_text, then relative offset mapping.
    const unmatched = chapterAnnotations.filter((a) => !annotationToParagraph.has(a));
    if (unmatched.length > 0) {
      unmatched.forEach((annotation) => {
        let targetIndex = -1;
        const anchor = String(annotation.anchorText || "").trim();
        if (anchor) {
          const anchorNorm = anchor.replace(/\s+/g, "");
          targetIndex = paragraphRows.findIndex((row) => row.text.replace(/\s+/g, "").includes(anchorNorm));
        }
        if (targetIndex < 0) {
          const rel = (Number(annotation.offset) - chapterStart) / chapterRawLength;
          const safeRel = Math.max(0, Math.min(1, Number.isFinite(rel) ? rel : 0));
          const targetVisiblePos = safeRel * visibleTotalLength;
          let cursor = 0;
          for (let i = 0; i < paragraphRows.length; i += 1) {
            cursor += paragraphRows[i].length;
            if (cursor >= targetVisiblePos) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex < 0) targetIndex = paragraphRows.length - 1;
        }
        if (targetIndex < 0 || !paragraphRows[targetIndex]) return;
        const target = paragraphRows[targetIndex].el;
        target.classList.add("has-annotation");
        const marker = createAnnotationMarker(annotation);
        target.appendChild(marker);
        annotationToParagraph.set(annotation, targetIndex);
      });
    }

    try {
      console.log("[Reader] annotation render", {
        chapter: chapterName,
        chapterStart,
        chapterEnd,
        annotations: chapterAnnotations.length,
        strictMatched: chapterAnnotations.length - unmatched.length,
        fallbackMatched: unmatched.length,
      });
    } catch (_err) {}
  }

// ─────── Reader: Annotation Markers & Bubbles ─────────────────────────
  function createAnnotationMarker(annotation) {
    var marker = document.createElement("span");
    marker.className = "annotation-marker";
    marker.setAttribute("data-note-type", annotation.type);
    marker.setAttribute("data-anchor-text", annotation.anchorText || "");
    marker.setAttribute("data-offset", String(Number(annotation.offset) || 0));
    marker.setAttribute("data-length", String(Number(annotation.length) || 0));
    marker.addEventListener("mouseenter", _annotationMarkerEnter);
    marker.addEventListener("mouseleave", _annotationMarkerLeave);

    var dot = document.createElement("span");
    dot.className = "annotation-dot";

    var bubble = document.createElement("span");
    bubble.className = "annotation-bubble";

    var typeSpan = document.createElement("span");
    typeSpan.className = "annotation-bubble-type";
    typeSpan.textContent = annotation.type;

    var contentSpan = document.createElement("span");
    contentSpan.className = "annotation-bubble-content";
    contentSpan.textContent = annotation.content;

    var actionRow = document.createElement("span");
    actionRow.className = "annotation-bubble-action";

    var askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "annotation-ask-btn";
    askBtn.textContent = "💡 解释这段";
    askBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      _annotationAskClick(annotation.anchorText || "", annotation.content || "");
    });

    actionRow.appendChild(askBtn);
    bubble.appendChild(typeSpan);
    bubble.appendChild(contentSpan);
    bubble.appendChild(actionRow);
    bubble.addEventListener("mouseenter", _annotationBubbleEnter);
    bubble.addEventListener("mouseleave", _annotationBubbleLeave);
    marker.appendChild(dot);
    marker.appendChild(bubble);

    return marker;
  }

// ─────── Reader: Sections & Chapter Parsing ───────────────────────────
  function parseSectionsXml(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return {};
    const result = {};
    const chapterReg = /<chapter_sessions>\s*([\s\S]*?)\s*<\/chapter_sessions>/gi;
    let chapterMatch = null;
    while ((chapterMatch = chapterReg.exec(src)) !== null) {
      const chapterBlock = String(chapterMatch[1] || "");
      const chapterNameMatch = chapterBlock.match(/<chapter_name>\s*([\s\S]*?)\s*<\/chapter_name>/i);
      const chapterRangeMatch = chapterBlock.match(/<chapter_range>\s*([\s\S]*?)\s*<\/chapter_range>/i);
      if (!chapterNameMatch || !chapterRangeMatch) continue;
      const chapterName = String(chapterNameMatch[1] || "").trim();
      const chapterRange = String(chapterRangeMatch[1] || "").trim();
      const sessions = [];
      const sessionReg = /<session_item>\s*([\s\S]*?)\s*<\/session_item>/gi;
      let sessionMatch = null;
      while ((sessionMatch = sessionReg.exec(chapterBlock)) !== null) {
        const sessionBlock = String(sessionMatch[1] || "");
        const nameMatch = sessionBlock.match(/<session_name>\s*([\s\S]*?)\s*<\/session_name>/i);
        const rangeMatch = sessionBlock.match(/<session_range>\s*([\s\S]*?)\s*<\/session_range>/i);
        const summaryMatch = sessionBlock.match(/<session_summary>\s*([\s\S]*?)\s*<\/session_summary>/i);
        if (!nameMatch || !rangeMatch) continue;
        sessions.push({
          name: String(nameMatch[1] || "").trim(),
          range: String(rangeMatch[1] || "").trim(),
          summary: summaryMatch ? String(summaryMatch[1] || "").trim() : ""
        });
      }
      result[chapterName] = { range: chapterRange, sessions };
    }
    return result;
  }

  function notifyHostLayout(mode, extra) {
    const payload = Object.assign(
      {
        source: "nexora-learning",
        type: "nexora:layout:request",
        mode: String(mode || "default").trim().toLowerCase() === "immersive" ? "immersive" : "default",
      },
      (extra && typeof extra === "object") ? extra : {},
    );
    try {
      window.dispatchEvent(new CustomEvent("nexora:layout:request", { detail: payload }));
    } catch (_err) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (_err) {}
  }

  function parseBookInfoChapters(xmlText, fullTextLength) {
    const src = String(xmlText || "");
    if (!src.trim()) return [];
    const entries = [];
    const reg = /<chapter_name>([\s\S]*?)<\/chapter_name>[\s\S]*?<chapter_range>([\s\S]*?)<\/chapter_range>/gi;
    let m = null;
    while ((m = reg.exec(src)) !== null) {
      const name = String(m[1] || "").trim();
      const range = String(m[2] || "").trim();
      const nums = range.split(":").map((x) => Number(String(x || "").trim()));
      if (!name || nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) continue;
      const start = Math.max(0, Math.floor(nums[0]));
      // backend chapter_range uses START:LENGTH, not START:END
      const length = Math.max(0, Math.floor(nums[1]));
      const end = Math.min(fullTextLength, start + length);
      entries.push({ title: name, start, end: Math.max(start, end) });
    }
    entries.sort((a, b) => a.start - b.start);
    return entries;
  }

  function parseBookInfoRoughContent(xmlText) {
    const src = String(xmlText || "");
    if (!src.trim()) return "";
    const blocks = [];
    const reg = /<chapter_name>([\s\S]*?)<\/chapter_name>[\s\S]*?<chapter_summary>([\s\S]*?)<\/chapter_summary>/gi;
    let m = null;
    while ((m = reg.exec(src)) !== null) {
      const name = String(m[1] || "").trim();
      const summary = String(m[2] || "").trim();
      if (!name || !summary) continue;
      blocks.push(
        "<div class=\"learning-panel-rough-chapter\">" +
        "<div class=\"learning-panel-rough-chapter-title\">" + escapeHtml(name) + "</div>" +
        "<div class=\"learning-panel-rough-chapter-text\">" + escapeHtml(summary) + "</div>" +
        "</div>"
      );
    }
    return blocks.join("");
  }

  // Session 进度管理
  const SESSION_STORAGE_KEY = "nxl_reader_session_v1";

// ─────── Reader: Session Progress & Completion ────────────────────────
  function getSessionKey() {
    const lectureId = String(state.selectedLectureId || "").trim();
    const bookId = String(state.selectedBookId || "").trim();
    if (!lectureId || !bookId) return "";
    return `${lectureId}::${bookId}`;
  }

  function normalizeReaderPositionSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    const chapterIndex = Number(raw.chapterIndex);
    const scrollTop = Number(raw.scrollTop);
    const scrollPercent = Number(raw.scrollPercent);
    if (!Number.isFinite(chapterIndex) || chapterIndex < 0) return null;
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return null;
    return {
      chapterIndex: Math.max(0, Math.floor(chapterIndex)),
      scrollTop: Math.max(0, scrollTop),
      scrollPercent: Number.isFinite(scrollPercent) ? Math.max(0, Math.min(1, scrollPercent)) : 0,
      scrollHeight: Math.max(0, Number(raw.scrollHeight) || 0),
      clientHeight: Math.max(0, Number(raw.clientHeight) || 0),
      updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
    };
  }

  function loadSessionProgress() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach(key => {
          const entry = parsed[key];
          if (entry && Array.isArray(entry.completedIndices)) {
            state.readerSessionProgress[key] = {
              completedIndices: new Set(entry.completedIndices),
              completedSessions: new Set(entry.completedSessions || []),
              reportedChapterKeys: new Set(entry.reportedChapterKeys || []),
              currentChapterIndex: Number(entry.currentChapterIndex) || 0,
              readerPosition: normalizeReaderPositionSnapshot(entry.readerPosition)
            };
          }
        });
      }
    } catch (_) {}
  }

  function saveSessionProgress() {
    try {
      const toSave = {};
      Object.keys(state.readerSessionProgress).forEach(key => {
        const entry = state.readerSessionProgress[key];
        if (entry) {
          toSave[key] = {
            completedIndices: Array.from(entry.completedIndices || []),
            completedSessions: Array.from(entry.completedSessions || []),
            reportedChapterKeys: Array.from(entry.reportedChapterKeys || []),
            currentChapterIndex: entry.currentChapterIndex || 0,
            readerPosition: normalizeReaderPositionSnapshot(entry.readerPosition)
          };
        }
      });
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  function markChapterVisited(chapterIndex) {
    const key = getSessionKey();
    if (!key) return;
    if (!state.readerSessionProgress[key]) {
      state.readerSessionProgress[key] = {
        completedIndices: new Set(),
        completedSessions: new Set(),
        reportedChapterKeys: new Set(),
        currentChapterIndex: 0,
        readerPosition: null
      };
    }
    const session = state.readerSessionProgress[key];
    session.currentChapterIndex = chapterIndex;
    saveSessionProgress();
  }

  function ensureReaderSessionProgress() {
    const key = getSessionKey();
    if (!key) return null;
    if (!state.readerSessionProgress[key]) {
      state.readerSessionProgress[key] = {
        completedIndices: new Set(),
        completedSessions: new Set(),
        reportedChapterKeys: new Set(),
        currentChapterIndex: 0,
        readerPosition: null
      };
    }
    if (!(state.readerSessionProgress[key].reportedChapterKeys instanceof Set)) {
      state.readerSessionProgress[key].reportedChapterKeys = new Set();
    }
    return state.readerSessionProgress[key];
  }

  function getSavedReaderPosition() {
    const key = getSessionKey();
    if (!key) return null;
    const progress = state.readerSessionProgress[key];
    if (!progress) return null;
    const position = normalizeReaderPositionSnapshot(progress.readerPosition);
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!position || !chapters.length) return null;
    if (position.chapterIndex >= chapters.length) return null;
    return position;
  }

  function updateReaderPositionSnapshot(scrollContainer) {
    if (!state.isReaderOpen) return false;
    const container = scrollContainer || getReaderScrollContainer();
    if (!container) return false;
    const progress = ensureReaderSessionProgress();
    if (!progress) return false;
    const chapterMeta = getReaderCurrentChapterMeta();
    if (chapterMeta.chapterIndex === null || chapterMeta.chapterIndex === undefined) return false;

    const scrollHeight = Number(container.scrollHeight || 0);
    const clientHeight = Number(container.clientHeight || 0);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const scrollTop = Math.max(0, Number(container.scrollTop || 0));
    const scrollPercent = maxScroll > 0 ? Math.max(0, Math.min(1, scrollTop / maxScroll)) : 0;

    progress.currentChapterIndex = Number(chapterMeta.chapterIndex) || 0;
    progress.readerPosition = {
      chapterIndex: Number(chapterMeta.chapterIndex) || 0,
      scrollTop,
      scrollPercent: Number(scrollPercent.toFixed(6)),
      scrollHeight,
      clientHeight,
      updatedAt: Date.now(),
    };
    return true;
  }

  function flushReaderPosition() {
    if (readerPositionSaveTimer) {
      clearTimeout(readerPositionSaveTimer);
      readerPositionSaveTimer = null;
    }
    if (updateReaderPositionSnapshot()) {
      saveSessionProgress();
    }
  }

  function scheduleReaderPositionSave(scrollContainer) {
    if (!updateReaderPositionSnapshot(scrollContainer)) return;
    if (readerPositionSaveTimer) return;
    readerPositionSaveTimer = setTimeout(() => {
      readerPositionSaveTimer = null;
      saveSessionProgress();
    }, 600);
  }

  function restoreReaderPositionAfterRender(chapterIndex) {
    const position = normalizeReaderPositionSnapshot(state.readerPendingRestorePosition);
    if (!position || position.chapterIndex !== chapterIndex) return;
    state.readerPendingRestorePosition = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = getReaderScrollContainer();
        if (!container) return;
        const scrollHeight = Number(container.scrollHeight || 0);
        const clientHeight = Number(container.clientHeight || 0);
        const maxScroll = Math.max(0, scrollHeight - clientHeight);
        const percentTop = maxScroll > 0 ? maxScroll * position.scrollPercent : 0;
        const targetTop = Math.max(0, Math.min(maxScroll, percentTop || position.scrollTop));
        container.scrollTop = targetTop;
        updateReaderPositionSnapshot(container);
        saveSessionProgress();
        scheduleHostReaderContextSync(0);
      });
    });
  }

  function getChapterCompleteReportKey(lectureId, bookId, chapterIndex, chapterName, chapterRange) {
    const lid = String(lectureId || "").trim();
    const bid = String(bookId || "").trim();
    const name = String(chapterName || "").trim();
    const range = String(chapterRange || "").trim();
    if (!lid || !bid || !name || !range) return "";
    return `${lid}::${bid}::${Number(chapterIndex) || 0}::${name}::${range}`;
  }

  function hasChapterCompleteReport(reportKey) {
    if (!reportKey) return false;
    const key = getSessionKey();
    if (!key) return false;
    const progress = state.readerSessionProgress[key];
    if (!progress || !(progress.reportedChapterKeys instanceof Set)) return false;
    return progress.reportedChapterKeys.has(reportKey);
  }

  function markChapterCompleteReport(reportKey, chapterIndex) {
    if (!reportKey) return;
    const progress = ensureReaderSessionProgress();
    if (!progress) return;
    if (!(progress.reportedChapterKeys instanceof Set)) {
      progress.reportedChapterKeys = new Set();
    }
    progress.reportedChapterKeys.add(reportKey);
    progress.completedIndices.add(Number(chapterIndex) || 0);
    progress.currentChapterIndex = Number(chapterIndex) || 0;
    saveSessionProgress();
  }

  function clearChapterCompleteReportsForIndex(lectureId, bookId, chapterIndex) {
    const key = `${String(lectureId || "").trim()}::${String(bookId || "").trim()}`;
    const progress = state.readerSessionProgress[key];
    if (!progress || !(progress.reportedChapterKeys instanceof Set)) return;

    const prefix = `${key}::${Number(chapterIndex) || 0}::`;
    Array.from(progress.reportedChapterKeys).forEach((item) => {
      if (String(item || "").startsWith(prefix)) {
        progress.reportedChapterKeys.delete(item);
      }
    });
  }

  function checkSessionProgressByScroll() {
    if (!state.isReaderOpen || !state.readerChapters.length) return;
    const chapterIndex = state.readerActiveChapterIndex;
    const chapters = state.readerChapters;
    const chapter = chapters[chapterIndex];
    if (!chapter) return;

    const chapterName = String(chapter.title || "").trim();
    const scrollContainer = getReaderScrollContainer();
    const chapterBody = scrollContainer ? scrollContainer.querySelector(".chapter-body") : null;
    if (!chapterBody) return;
    
    const scrollTop     = Number(scrollContainer.scrollTop || 0);
    const clientHeight  = Number(scrollContainer.clientHeight || 0);
    const scrollHeight  = Number(scrollContainer.scrollHeight || 0);
    const minScrollable = Math.max(1, scrollHeight - clientHeight);   // 至少为1，避免除零
    const atBottom      = scrollTop >= minScrollable - 2;              // 滚到底或内容不超出均视为底
    const chapterLength = Math.max(1, Number(chapter.end || 0) - Number(chapter.start || 0));

    if (atBottom) {
      reportReaderChapterComplete(chapterIndex).catch((err) => {
        console.warn("[NXL-Reader] chapter complete by scroll failed", err);
      });
    }

    const sectionData = state.readerSectionsData[chapterName];

    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions.length) {
      syncReaderTelemetrySessionContext("scroll");
      return;
    }

    //:
    // ・内容超出容器: scrollTop / minScrollable 映射到 0 → chapterLength
    // ・内容不超出：直接视作已读完整章（所有 session 立即标记完成）
    //:
    const scrollPercent     = atBottom ? 1.0 : (scrollTop / minScrollable);
    let currentRelativeEnd  = Math.floor(chapterLength * scrollPercent);
    if (atBottom) currentRelativeEnd = chapterLength;   // 兜底，确保浮点精度不上浮
    
    let changed = false;
    const progress = ensureReaderSessionProgress();
    if (!progress || !progress.completedSessions) return;
    
    sectionData.sessions.forEach((s, sIdx) => {
      const sessionKey = `${chapterIndex}:${sIdx}`;
      if (progress.completedSessions.has(sessionKey)) return;
      
      const parsedRange = parseReaderSessionRange(chapter, s.range);
      if (!parsedRange) return;
      
      if (currentRelativeEnd >= parsedRange.endRelative) {
        progress.completedSessions.add(sessionKey);
        reportSessionComplete(chapterIndex, sIdx).catch(() => {});
        changed = true;
      }
    });
    
    if (changed) {
      saveSessionProgress();
      renderChapterList();
    }
    syncReaderTelemetrySessionContext("scroll");
  }

  function isChapterCompleted(chapterIndex) {
    const key = getSessionKey();
    if (!key) return false;
    const session = state.readerSessionProgress[key];
    if (!session) return false;
    return session.completedIndices.has(chapterIndex);
  }

  function getCurrentSessionChapterIndex() {
    const key = getSessionKey();
    if (!key) return 0;
    const session = state.readerSessionProgress[key];
    return session ? session.currentChapterIndex : 0;
  }

  // 初始化时加载 session
  loadSessionProgress();

// ─────── Reader: Chapter List Rendering ───────────────────────────────
  function renderChapterList() {
    if (!el.chapterListContent) return;
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) {
      el.chapterListContent.innerHTML = '<div class="materials-empty">暂无目录</div>';
      return;
    }
    el.chapterListContent.innerHTML = chapters.map((item, idx) => {
      const active = idx === state.readerActiveChapterIndex ? "current" : "";
      const completed = isChapterCompleted(idx);
      
      // 获取该章节的小节数据
      const chapterName = String(item.title || "").trim();
      const sectionData = state.readerSectionsData[chapterName];
      let sessionsHtml = "";
      if (sectionData && Array.isArray(sectionData.sessions) && sectionData.sessions.length > 0) {
        sessionsHtml = `<div class="chapter-sessions">${sectionData.sessions.map((session, sIdx) => {
          const sessionCompleted = isSessionCompleted(idx, sIdx);
          const sessionDotClass = sessionCompleted ? "session-dot completed" : "session-dot pending";
          const sessionDotTitle = sessionCompleted ? "已学习" : "未学习";
          return `<div class="session-item" data-chapter-index="${idx}" data-session-index="${sIdx}" data-session-range="${escapeHtml(session.range || '')}">
            <span class="session-item-name">${escapeHtml(session.name)}</span>
            <span class="${sessionDotClass}" title="${sessionDotTitle}"></span>
          </div>`;
        }).join("")}</div>`;
      }
      
      return `<div class="chapter-item-wrapper">
        <div class="chapter-item ${active}" data-reader-chapter-index="${idx}">
          <span class="chapter-item-title">${escapeHtml(item.title)}</span>
        </div>
        ${sessionsHtml}
      </div>`;
    }).join("");
  }

  function isSessionCompleted(chapterIndex, sessionIndex) {
    const key = getSessionKey();
    if (!key) return false;
    const session = state.readerSessionProgress[key];
    if (!session) return false;
    const sessionKey = `${chapterIndex}:${sessionIndex}`;
    return session.completedSessions && session.completedSessions.has(sessionKey);
  }

  function markSessionVisited(chapterIndex, sessionIndex) {
    const key = getSessionKey();
    if (!key) return;
    // 本函数只用于导航（点击目录跳到当前 session），不做“完成”标记。
    // scroll-based completion 会在滚动到达 session 末尾时自动触发完成。
  }

  async function reportSessionComplete(chapterIndex, sessionIndex) {
    const row = getSelectedLectureRow();
    if (!row || !state.selectedBookId) return;
    const lectureId = String((row.lecture || {}).id || "");
    if (!lectureId) return;
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    const chapter = chapters[chapterIndex];
    if (!chapter) return;
    const chapterName = String(chapter.title || "").trim();
    if (!chapterName) return;
    const sectionData = state.readerSectionsData[chapterName];
    if (!sectionData || !Array.isArray(sectionData.sessions) || !sectionData.sessions[sessionIndex]) return;
    const s = sectionData.sessions[sessionIndex];
    const sessionName = String(s.name || "").trim();
    const sessionRange = String(s.range || "").trim();
    if (!sessionName) return;
    emitTelemetry("reader_session_complete", {
      lecture_id: lectureId,
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: Number(chapterIndex) || 0,
      chapter_title: chapterName,
      session_index: Number(sessionIndex) || 0,
      session_name: sessionName,
      session_range: sessionRange,
    });
    try {
      await fetchJson("/api/frontend/learning/session-complete", {
        method: "POST",
        body: JSON.stringify({
          username: getRuntimeUsername(),
          lecture_id: lectureId,
          book_id: String(state.selectedBookId),
          chapter_name: chapterName,
          chapter_index: Number(chapterIndex) || 0,
          session_name: sessionName,
          session_index: Number(sessionIndex) || 0,
          session_range: sessionRange,
        }),
      });
    } catch (_) {}
  }

// ─────── Reader: Context Menu & Selection ─────────────────────────────
  function scheduleHostReaderContextSync(delay = 120) {
    if (readerContextSyncTimer) {
      clearTimeout(readerContextSyncTimer);
      readerContextSyncTimer = null;
    }
    readerContextSyncTimer = setTimeout(() => {
      readerContextSyncTimer = null;
      notifyHostReaderContext();
    }, Math.max(0, Number(delay) || 0));
  }

  function buildReaderSelectionSourceMeta(textForAnchor = "") {
    const chapterMeta = getReaderCurrentChapterMeta();
    const sourceTitle = [
      String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      chapterMeta.chapterTitle || "",
    ].filter(Boolean).join(" / ");
    return {
      source: "Learning Reader",
      sourceTitle,
      reader_title: String(state.readerMeta && state.readerMeta.title ? state.readerMeta.title : "").trim(),
      chapter_title: chapterMeta.chapterTitle || "",
      chapter_index: chapterMeta.chapterIndex,
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      snippet: normalizeReaderSelectionText(textForAnchor, 280),
    };
  }

  function hideHostReaderSelectionContextMenu() {
    emitHostPayload("nexora:reader:selection-context-menu-hide", {});
  }

  function handleReaderContextMenu(event) {
    if (!state.isReaderOpen) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount <= 0 || sel.isCollapsed) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const text = normalizeReaderSelectionText(sel.toString(), 1600);
    if (!text) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    const anchorNode = sel.anchorNode || sel.focusNode;
    const anchorElement = anchorNode && anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
    if (!anchorElement || !el.readerContent || !el.readerContent.contains(anchorElement)) {
      hideHostReaderSelectionContextMenu();
      return;
    }
    event.preventDefault();
    const hostPoint = getReaderHostPointer(event.clientX, event.clientY);
    const chapterMeta = getReaderCurrentChapterMeta();
    emitTelemetry("reader_selection_contextmenu", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      text_length: text.length,
      pointer_x: hostPoint.x,
      pointer_y: hostPoint.y,
    });
    emitHostPayload("nexora:reader:selection-context-menu", {
      x: hostPoint.x,
      y: hostPoint.y,
      text,
      source_meta: buildReaderSelectionSourceMeta(text),
    });
  }

// ─────── Reader: Chapter Navigation ───────────────────────────────────
  function openReaderChapter(index, scrollToOffset, guideOptions) {
    // 每次章节切换都使之前的异步请求失效，防止旧章节响应覆盖当前目标。
    state.readerRequestToken += 1;
    flushReaderPosition();
    resetReaderSelectionTelemetry();
    const chapters = Array.isArray(state.readerChapters) ? state.readerChapters : [];
    if (!chapters.length) {
      el.readerContent.innerHTML = `<div class="materials-preview-text">${formatReaderText(state.readerFullTextRaw || "")}</div>`;
      syncReaderSettingsPanel();
      applyReaderTypography();
      return;
    }
    const idx = Math.max(0, Math.min(chapters.length - 1, Number(index) || 0));
    state.readerActiveChapterIndex = idx;
    logReaderDebug("readerChapter:navigate", {
      requestedChapterIndex: index,
      openedChapterIndex: idx,
      requestToken: state.readerRequestToken,
    });

    // 检查缓存中是否有该章节内容
    if (state.readerChapterCache && state.readerChapterCache[idx]) {
      renderChapterContent(idx, state.readerChapterCache[idx], scrollToOffset, guideOptions);
    } else {
      // 按需加载章节内容
      loadChapterContent(idx, scrollToOffset, guideOptions);
    }
  }

  function scrollToChapterOffset(chapterStart, sessionAbsoluteOffset) {
    requestAnimationFrame(() => {
      const chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
      if (!chapterBody) return;
      const paragraphs = chapterBody.querySelectorAll("p");
      if (!paragraphs.length) return;
      // 计算session在章节内的相对位置（session绝对偏移 - 章节起始偏移）
      const relativeOffset = Math.max(0, Number(sessionAbsoluteOffset) - Number(chapterStart));
      let accumulatedLength = 0;
      let targetParagraph = null;
      for (const p of paragraphs) {
        const pText = p.textContent || "";
        accumulatedLength += pText.length + 1; // +1 for newline
        if (accumulatedLength >= relativeOffset) {
          targetParagraph = p;
          break;
        }
      }
      if (!targetParagraph) targetParagraph = paragraphs[0];
      targetParagraph.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // 批注气泡定位与显示控制
  var _annotationHideTimer = null;
  var _activeAnnotationMarker = null;
  var _annotationDwellTimer = null;
  var _annotationDwellEnterAt = 0;
  var ANNOTATION_DWELL_THRESHOLD_MS = 3000;

// ─────── Reader: Annotation Bubble Logic ──────────────────────────────
  function _showAnnotationBubble(marker) {
    if (_annotationHideTimer) {
      clearTimeout(_annotationHideTimer);
      _annotationHideTimer = null;
    }
    if (_activeAnnotationMarker && _activeAnnotationMarker !== marker) {
      _activeAnnotationMarker.classList.remove("active");
    }
    var bubble = marker.querySelector(".annotation-bubble");
    if (!bubble) return;
    var rect = marker.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var tp = rect.bottom + 8;
    marker.style.setProperty("--ab-left", cx + "px");
    marker.style.setProperty("--ab-top", tp + "px");
    marker.classList.add("active");
    _activeAnnotationMarker = marker;
  }

  function _hideAnnotationBubble(marker, immediate) {
    if (_annotationHideTimer) {
      clearTimeout(_annotationHideTimer);
      _annotationHideTimer = null;
    }
    if (immediate) {
      marker.classList.remove("active");
      if (_activeAnnotationMarker === marker) _activeAnnotationMarker = null;
      return;
    }
    _annotationHideTimer = setTimeout(function () {
      _annotationHideTimer = null;
      marker.classList.remove("active");
      if (_activeAnnotationMarker === marker) _activeAnnotationMarker = null;
    }, 200);
  }

  function _annotationMarkerEnter() {
    emitKnowledgePointHoverTelemetry(this, "marker");
    _showAnnotationBubble(this);
    _startAnnotationDwellTimer(this);
  }

  function _annotationMarkerLeave(ev) {
    var marker = this;
    var relatedTarget = ev.relatedTarget;
    if (relatedTarget && (marker.contains(relatedTarget) || relatedTarget.closest(".annotation-bubble"))) {
      return;
    }
    _hideAnnotationBubble(marker);
    _clearAnnotationDwellTimer();
  }

  function _startAnnotationDwellTimer(marker) {
    _clearAnnotationDwellTimer();
    _annotationDwellEnterAt = Date.now();
    _annotationDwellTimer = setTimeout(function () {
      _annotationDwellTimer = null;
      emitAnnotationDwellTelemetry(marker, ANNOTATION_DWELL_THRESHOLD_MS);
    }, ANNOTATION_DWELL_THRESHOLD_MS);
  }

  function _clearAnnotationDwellTimer() {
    if (_annotationDwellTimer) {
      clearTimeout(_annotationDwellTimer);
      _annotationDwellTimer = null;
    }
    _annotationDwellEnterAt = 0;
  }

  function emitAnnotationDwellTelemetry(marker, durationMs) {
    if (!(marker instanceof Element) || !state.isReaderOpen) return;
    const chapterMeta = getReaderCurrentChapterMeta();
    const noteType = String(marker.getAttribute("data-note-type") || "").trim();
    const anchorText = String(marker.getAttribute("data-anchor-text") || "").trim();
    const offset = Number(marker.getAttribute("data-offset") || 0) || 0;
    const length = Number(marker.getAttribute("data-length") || 0) || 0;
    const bubbleContent = marker.querySelector(".annotation-bubble-content");
    const noteText = bubbleContent ? String(bubbleContent.textContent || "").trim() : "";
    emitTelemetry("annotation_dwell", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      note_type: noteType,
      anchor_text: anchorText,
      note_text: noteText,
      offset,
      length,
      duration_ms: durationMs,
    });
  }

  function _annotationBubbleEnter(ev) {
    var bubble = this;
    var marker = bubble.closest(".annotation-marker");
    if (marker) {
      emitKnowledgePointHoverTelemetry(marker, "bubble");
      _showAnnotationBubble(marker);
    }
  }

  function _annotationBubbleLeave(ev) {
    var bubble = this;
    var marker = bubble.closest(".annotation-marker");
    if (!marker) return;
    var relatedTarget = ev.relatedTarget;
    if (relatedTarget && marker.contains(relatedTarget)) {
      return;
    }
    _hideAnnotationBubble(marker);
  }

  function _annotationAskClick(anchorText, noteText) {
    var promptText = "解释「" + anchorText + "」：" + noteText;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "nexora-learning", type: "nexora:reader:ask-annotation", text: promptText }, "*");
    }

    // 发射 annotation_ask telemetry 事件
    const chapterMeta = getReaderCurrentChapterMeta();
    emitTelemetry("annotation_ask", {
      lecture_id: String(state.selectedLectureId || "").trim(),
      book_id: String(state.selectedBookId || "").trim(),
      chapter_index: chapterMeta.chapterIndex,
      chapter_title: chapterMeta.chapterTitle,
      anchor_text: anchorText,
      note_text: noteText,
    });
  }

  function injectDemoAnnotation() {
    var chapterBody = el.readerContent ? el.readerContent.querySelector(".chapter-body") : null;
    if (!chapterBody) return;
    var firstP = chapterBody.querySelector("p.materials-preview-paragraph");
    if (!firstP || firstP.querySelector(".annotation-marker")) return;
    firstP.classList.add("has-annotation");
    var anchorText = (firstP.textContent || "").trim().slice(0, 30);
    var noteText = "这里作者提出了核心论点，注意与后文的论证逻辑对比阅读。";

    var marker = document.createElement("span");
    marker.className = "annotation-marker";
    marker.setAttribute("data-note-type", "思考点");
    marker.setAttribute("data-anchor-text", anchorText);
    marker.addEventListener("mouseenter", _annotationMarkerEnter);
    marker.addEventListener("mouseleave", _annotationMarkerLeave);

    var dot = document.createElement("span");
    dot.className = "annotation-dot";

    var bubble = document.createElement("span");
    bubble.className = "annotation-bubble";

    var typeSpan = document.createElement("span");
    typeSpan.className = "annotation-bubble-type";
    typeSpan.textContent = "思考点";

    var contentSpan = document.createElement("span");
    contentSpan.className = "annotation-bubble-content";
    contentSpan.textContent = noteText;

    var actionRow = document.createElement("span");
    actionRow.className = "annotation-bubble-action";

    var askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "annotation-ask-btn";
    askBtn.textContent = "💡 解释这段";
    askBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      _annotationAskClick(anchorText, noteText);
    });

    actionRow.appendChild(askBtn);
    bubble.appendChild(typeSpan);
    bubble.appendChild(contentSpan);
    bubble.appendChild(actionRow);
    bubble.addEventListener("mouseenter", _annotationBubbleEnter);
    bubble.addEventListener("mouseleave", _annotationBubbleLeave);
    marker.appendChild(dot);
    marker.appendChild(bubble);
    firstP.appendChild(marker);
  }

// ─────── Reader: Settings & UI Controls ───────────────────────────────
  function loadReaderSettings() {
    try {
      const raw = localStorage.getItem(READER_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const fontSize = Number(parsed.fontSize);
      const paragraphSpacing = Number(parsed.paragraphSpacing);
      const legacyLineHeight = Number(parsed.lineHeight);
      const edgeClickWidth = Number(parsed.edgeClickWidth);
      if (Number.isFinite(fontSize)) {
        state.readerSettings.fontSize = Math.max(12, Math.min(36, Math.round(fontSize)));
      }
      if (Number.isFinite(paragraphSpacing)) {
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(paragraphSpacing.toFixed(1))));
      } else if (Number.isFinite(legacyLineHeight)) {
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(legacyLineHeight.toFixed(1))));
      }
      if (Number.isFinite(edgeClickWidth)) {
        state.readerSettings.edgeClickWidth = Math.max(30, Math.min(160, Math.round(edgeClickWidth)));
      }
      if (typeof parsed.theme === "string" && parsed.theme) {
        state.readerSettings.theme = parsed.theme;
      }
      if (typeof parsed.displayMode === "string" && parsed.displayMode) {
        state.readerSettings.displayMode = parsed.displayMode;
      }
      if (typeof parsed.enableKeyNavigation === "boolean") {
        state.readerSettings.enableKeyNavigation = parsed.enableKeyNavigation;
      }
      if (typeof parsed.preferredTranslator === "string" && parsed.preferredTranslator) {
        state.readerSettings.preferredTranslator = parsed.preferredTranslator;
      }
    } catch (_err) {
      // ignore invalid local storage
    }
  }

  function saveReaderSettings() {
    try {
      localStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(state.readerSettings));
    } catch (_err) {
      // ignore storage failure
    }
  }

  function syncReaderSettingsPanel() {
    if (el.fontSizeSlider) el.fontSizeSlider.value = String(state.readerSettings.fontSize);
    if (el.fontSizeValue) el.fontSizeValue.textContent = `${state.readerSettings.fontSize}px`;
    if (el.lineHeightSlider) el.lineHeightSlider.value = String(state.readerSettings.paragraphSpacing);
    if (el.lineHeightValue) el.lineHeightValue.textContent = String(state.readerSettings.paragraphSpacing);
    if (el.edgeClickWidthSlider) el.edgeClickWidthSlider.value = String(state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth);
    if (el.edgeClickWidthValue) el.edgeClickWidthValue.textContent = `${state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth}px`;
    const themeInput = document.querySelector(`input[name="readerTheme"][value="${state.readerSettings.theme}"]`);
    if (themeInput instanceof HTMLInputElement) themeInput.checked = true;
    const displayModeInput = document.querySelector(`input[name="readerDisplayMode"][value="${state.readerSettings.displayMode}"]`);
    if (displayModeInput instanceof HTMLInputElement) displayModeInput.checked = true;
    if (el.enableKeyNavigation) el.enableKeyNavigation.checked = !!state.readerSettings.enableKeyNavigation;
    if (el.translatorSelect) el.translatorSelect.value = String(state.readerSettings.preferredTranslator || "auto");
  }

  function applyReaderTypography() {
    const fs = Number(state.readerSettings.fontSize || DEFAULT_READER_SETTINGS.fontSize);
    const spacing = Number(state.readerSettings.paragraphSpacing || DEFAULT_READER_SETTINGS.paragraphSpacing);
    const edgeW = Math.max(30, Math.min(160, Number(state.readerSettings.edgeClickWidth || DEFAULT_READER_SETTINGS.edgeClickWidth)));
    const viewportW = Math.max(320, Number(window.innerWidth || 390));
    const isMobileViewport = viewportW <= 768;
    const mobileEdgeCap = Math.max(18, Math.floor(viewportW * 0.14));
    const effectiveEdgeW = isMobileViewport ? Math.max(18, Math.min(edgeW, mobileEdgeCap)) : edgeW;
    const textRoot = el.readerContent ? el.readerContent.querySelector(".materials-preview-text") : null;
    if (textRoot instanceof HTMLElement) {
      textRoot.style.fontSize = `${fs}px`;
      textRoot.style.lineHeight = "1.8";
      textRoot.style.setProperty("--reader-paragraph-gap", `${spacing}em`);
    }
    if (el.readerPane) {
      el.readerPane.classList.remove("theme-light", "theme-dark", "theme-sepia");
      el.readerPane.classList.add(`theme-${state.readerSettings.theme || "light"}`);
      el.readerPane.style.setProperty("--reader-edge-width", `${edgeW}px`);
      el.readerPane.style.setProperty("--reader-edge-width-effective", `${effectiveEdgeW}px`);
      // Sync theme to body for floating panel
      document.body.classList.remove("reader-theme-light", "reader-theme-dark", "reader-theme-sepia");
      document.body.classList.add(`reader-theme-${state.readerSettings.theme || "light"}`);
    }
  }

  function isReaderSettingsOpen() {
    return !!(el.readerSettingsPanel && el.readerSettingsPanel.classList.contains("show"));
  }

  function setReaderSettingsPanelOpen(open) {
    if (!el.readerSettingsPanel) return;
    const shouldOpen = !!open;
    logReaderDebug("setReaderSettingsPanelOpen:before", { shouldOpen });
    state.readerUiToggleLockedUntil = Date.now() + 120;
    if (shouldOpen) {
      setChapterListPanelOpen(false);
      setReaderHeaderVisible(true);
    }
    el.readerSettingsPanel.classList.toggle("show", shouldOpen);
    document.body.classList.toggle("reader-settings-open", shouldOpen);
    requestAnimationFrame(() => {
      logReaderDebug("setReaderSettingsPanelOpen:afterRAF", { shouldOpen });
    });
  }

  function setChapterListPanelOpen(open) {
    if (!el.chapterListPanel) return;
    if (!state.isReaderFullscreen) {
      el.chapterListPanel.classList.remove("show");
      return;
    }
    const shouldOpen = !!open;
    el.chapterListPanel.classList.toggle("show", shouldOpen);
    if (!shouldOpen) {
      state.readerClosePanelsUntil = Date.now() + 180;
      return;
    }
    notifyHostReaderState(true);
    notifyHostLayout("immersive", { hideInputDock: true, reason: "chapter_list" });
    // 打开目录后自动把当前章节滚动到可见位置
    const activeChapter = el.chapterListContent
      ? el.chapterListContent.querySelector(".chapter-item.current")
      : null;
    if (activeChapter) {
      activeChapter.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }

  function setReaderHeaderVisible(visible) {
    if (!el.readerHeader) return;
    if (visible) {
      el.readerHeader.classList.remove("hidden", "header-hidden");
      el.readerHeader.classList.add("header-visible");
    } else {
      el.readerHeader.classList.add("hidden", "header-hidden");
      el.readerHeader.classList.remove("header-visible");
    }
  }

  function syncReaderModeUI() {
    const isReading = state.readerViewMode === "reading";
    if (el.readerChapterListBtn) el.readerChapterListBtn.hidden = !isReading;
    if (el.readerSettingsBtn) el.readerSettingsBtn.hidden = !isReading;
    if (!state.isReaderOpen) {
      syncMaterialsPageMode();
    } else if (el.materialsMainHeader) {
      el.materialsMainHeader.hidden = true;
    }
    if (el.readerHeader) el.readerHeader.hidden = !state.isReaderOpen;
  }

  function toggleReaderUI() {
    if (Date.now() < Number(state.readerUiToggleLockedUntil || 0)) {
      logReaderDebug("toggleReaderUI:blockedByLock", { lockedUntil: state.readerUiToggleLockedUntil });
      return;
    }
    if (Date.now() < Number(state.readerClosePanelsUntil || 0)) {
      logReaderDebug("toggleReaderUI:blockedAfterClosePanel", { lockedUntil: state.readerClosePanelsUntil });
      return;
    }
    if (isReaderSettingsOpen() || (el.chapterListPanel && el.chapterListPanel.classList.contains("show"))) {
      logReaderDebug("toggleReaderUI:blockedByPanel", {});
      return;
    }
    const hidden = el.readerHeader.classList.contains("header-hidden") || el.readerHeader.classList.contains("hidden");
    setReaderHeaderVisible(hidden);
    logReaderDebug("toggleReaderUI:headerToggled", { nextVisible: hidden });
  }

// ─────── Reader: Lifecycle (Open / Close / Fullscreen) ────────────────
  function openReader(title, subtitle, content, options) {
    const opts = (options && typeof options === "object") ? options : {};
    const mode = opts.mode === "catalog" ? "catalog" : "reading";
    state.isReaderOpen = true;
    state.readerRequestToken += 1;
    setReaderHeaderVisible(true);
    setReaderSettingsPanelOpen(false);
    setChapterListPanelOpen(false);
    el.materialsLayout.hidden = true;
    if (el.courseHomePane) {
      el.courseHomePane.hidden = true;
    }
    el.readerPane.hidden = false;
    state.readerViewMode = mode;
    state.readerMeta.title = String(title || "教材阅读");
    state.readerMeta.subtitle = String(subtitle || "");
    state.readerReportedChapterKey = "";
    state.readerPendingRestorePosition = normalizeReaderPositionSnapshot(opts.restorePosition);
    el.readerTitle.textContent = state.readerMeta.title;
    el.readerSubTitle.textContent = state.readerMeta.subtitle;
    state.readerFullTextRaw = String(content || "");
    // 初始化章节缓存
    state.readerChapterCache = {};
    resetReaderSelectionTelemetry();
    syncFloatingBtnVisibility();
    if (Array.isArray(state.readerChapters) && state.readerChapters.length) {
      let requestedIndex;
      if (Number.isFinite(Number(opts.chapterIndex))) {
        requestedIndex = Number(opts.chapterIndex);
      } else {
        // 恢复 session 进度
        const sessionIndex = getCurrentSessionChapterIndex();
        requestedIndex = sessionIndex;
      }
      state.readerActiveChapterIndex = Math.max(0, Math.min(state.readerChapters.length - 1, Number(requestedIndex) || 0));
    } else {
      state.readerActiveChapterIndex = 0;
    }
    syncReaderModeUI();
    setReaderFullscreen(true);
    syncReaderSettingsPanel();
    applyReaderTypography();

    // 如果是加载模式，显示加载状态（章节内容由外部异步加载）
    if (!opts.loading) {
      openReaderChapter(state.readerActiveChapterIndex);
    }

    // 仅当 selectedBookId 已设置时才发射 telemetry，避免未选择书籍时产生噪声事件
    if (String(state.selectedBookId || "").trim()) {
      const lectureId = String(state.selectedLectureId || "").trim();
      const bookId = String(state.selectedBookId || "").trim();
      const chapterIndex = Number(state.readerActiveChapterIndex) || 0;
      const chapterTitle = String((state.readerChapters[state.readerActiveChapterIndex] || {}).title || "").trim();

      emitTelemetry("reader_open", {
        lecture_id: lectureId,
        book_id: bookId,
        view_mode: mode,
        chapter_index: chapterIndex,
        chapter_title: chapterTitle,
      });

      // 设置基础 reader 信息，用于 visibility 事件
      const telemetry = window.NXLTelemetry;
      if (telemetry && typeof telemetry.setBasicReaderContext === "function") {
        telemetry.setBasicReaderContext({
          lecture_id: lectureId,
          book_id: bookId,
          chapter_index: chapterIndex,
          chapter_title: chapterTitle,
        });
      }
    }
    notifyHostReaderState(true);
    notifyHostReaderContext();
    // 异步加载 sections.xml
    loadSectionsData();
  }

  async function loadSectionsData() {
    try {
      const [sectionsXml, annotationsXml] = await Promise.all([
        fetchSectionsXml(),
        fetchAnnotationsXml()
      ]);
      state.readerSectionsData = parseSectionsXml(sectionsXml);
      state.readerAnnotations = parseAnnotationsXml(annotationsXml);
      renderChapterList();
      renderChapterAnnotations(state.readerActiveChapterIndex);
      syncReaderTelemetrySessionContext("sections_loaded");
    } catch (_) {}
  }

