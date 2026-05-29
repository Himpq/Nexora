(function () {
  "use strict";

  const PREFIX = "[NXL-Telemetry]";
  const BACKEND_INGEST_URL = "/api/telemetry/ingest";
  // Scroll sampling uses a trailing cooldown so continuous scrolling only records one sample per window.
  const SCROLL_SAMPLE_COOLDOWN_MS = 5000;
  // Chapter-session snapshots are sampled on a fixed cadence without recording scroll position.
  const READER_SESSION_HEARTBEAT_MS = 10000;
  const KNOWLEDGE_POINT_HOVER_COOLDOWN_MS = 1000;
  const BACKEND_FLUSH_DELAY_MS = 0;

  const state = {
    userId: "",
    scroll: {
      lastEmitAt: 0,
      timer: null,
      pendingRecord: null,
    },
    hover: {
      lastKey: "",
      lastAt: 0,
    },
    reader: {
      currentContext: null,
      currentKey: "",
      enteredAt: 0,
      heartbeatTimer: null,
    },
    backend: {
      pendingRecords: [],
      flushTimer: null,
      sending: false,
    },
  };

  function normalizeUserId(value) {
    return String(value || "").trim();
  }

  function getResolvedUserId() {
    if (state.userId) return state.userId;
    const queryUsername = new URLSearchParams(window.location.search || "").get("username") || "";
    return normalizeUserId(
      queryUsername
      || window.NEXORA_USERNAME
      || window.nexoraUsername
    );
  }

  function setUserId(userId) {
    state.userId = normalizeUserId(userId);
    if (state.userId) {
      scheduleBackendFlush();
    }
    return state.userId;
  }

  function emit(eventName, payload) {
    const record = buildRecord(eventName, payload);
    if (!record.event) return record;
    if (record.event === "reader_scroll") {
      return emitCooldownedScroll(record);
    }
    if (record.event === "reader_knowledge_point_hover") {
      return emitDedupedKnowledgePointHover(record);
    }
    console.info(PREFIX, record);
    enqueueBackendRecord(record);
    return record;
  }

  function buildRecord(eventName, payload) {
    return {
      event: String(eventName || "").trim(),
      ts: Date.now(),
      payload: payload && typeof payload === "object" ? payload : {},
    };
  }

  function emitCooldownedScroll(record) {
    const now = Date.now();
    const elapsed = now - state.scroll.lastEmitAt;
    if (elapsed >= SCROLL_SAMPLE_COOLDOWN_MS) {
      state.scroll.lastEmitAt = now;
      console.info(PREFIX, record);
      enqueueBackendRecord(record);
      return record;
    }
    state.scroll.pendingRecord = record;
    if (state.scroll.timer) return record;
    state.scroll.timer = window.setTimeout(() => {
      state.scroll.timer = null;
      const pending = state.scroll.pendingRecord;
      state.scroll.pendingRecord = null;
      if (!pending) return;
      state.scroll.lastEmitAt = Date.now();
      console.info(PREFIX, pending);
      enqueueBackendRecord(pending);
    }, Math.max(1, SCROLL_SAMPLE_COOLDOWN_MS - elapsed));
    return record;
  }

  function emitDedupedKnowledgePointHover(record) {
    const payload = record.payload || {};
    const key = String(payload.telemetry_key || "").trim() || [
      payload.lecture_id,
      payload.book_id,
      payload.chapter_index,
      payload.chapter_title,
      payload.note_type,
      payload.anchor_text,
      payload.offset,
      payload.length,
    ].join("::");
    const now = Date.now();
    if (key && key === state.hover.lastKey && (now - state.hover.lastAt) < KNOWLEDGE_POINT_HOVER_COOLDOWN_MS) {
      return record;
    }
    state.hover.lastKey = key;
    state.hover.lastAt = now;
    console.info(PREFIX, record);
    enqueueBackendRecord(record);
    return record;
  }

  function normalizeReaderSessionContext(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const lectureId = normalizeUserId(source.lecture_id);
    const bookId = normalizeUserId(source.book_id);
    const chapterIndex = Number.isFinite(Number(source.chapter_index)) ? Number(source.chapter_index) : null;
    const sessionIndex = Number.isFinite(Number(source.session_index)) ? Number(source.session_index) : null;
    if (!lectureId || !bookId || chapterIndex === null || sessionIndex === null) return null;
    return {
      lecture_id: lectureId,
      book_id: bookId,
      chapter_index: chapterIndex,
      chapter_title: normalizeUserId(source.chapter_title),
      chapter_name: normalizeUserId(source.chapter_name),
      session_index: sessionIndex,
      session_name: normalizeUserId(source.session_name),
      session_range: normalizeUserId(source.session_range),
      session_summary: normalizeUserId(source.session_summary),
      session_key: normalizeUserId(source.session_key) || [lectureId, bookId, chapterIndex, sessionIndex].join(":"),
      trigger_source: normalizeUserId(source.trigger_source) || "scroll",
    };
  }

  function emitReaderSessionEnter(context) {
    return emit("reader_session_enter", Object.assign({}, context, {
      entered_at: Date.now(),
    }));
  }

  function emitReaderSessionLeave(context, reason, durationMs) {
    return emit("reader_session_leave", Object.assign({}, context, {
      transition_reason: normalizeUserId(reason),
      duration_ms: Math.max(0, Number(durationMs) || 0),
      left_at: Date.now(),
    }));
  }

  function emitReaderSessionSnapshot(context) {
    const activeDurationMs = Math.max(0, Date.now() - state.reader.enteredAt);
    return emit("reader_session_snapshot", Object.assign({}, context, {
      active_duration_ms: activeDurationMs,
      duration_ms: activeDurationMs,
      trigger_source: "heartbeat",
      snapshot_at: Date.now(),
    }));
  }

  function startReaderHeartbeat() {
    if (state.reader.heartbeatTimer || !state.reader.currentContext) return;
    state.reader.heartbeatTimer = window.setInterval(() => {
      if (!state.reader.currentContext) return;
      emitReaderSessionSnapshot(state.reader.currentContext);
    }, READER_SESSION_HEARTBEAT_MS);
  }

  function stopReaderHeartbeat() {
    if (!state.reader.heartbeatTimer) return;
    window.clearInterval(state.reader.heartbeatTimer);
    state.reader.heartbeatTimer = null;
  }

  function setReaderSessionContext(payload) {
    const nextContext = normalizeReaderSessionContext(payload);
    if (!nextContext) {
      return clearReaderSessionContext("missing-context");
    }

    const currentContext = state.reader.currentContext;
    const nextKey = nextContext.session_key;
    if (currentContext && state.reader.currentKey === nextKey) {
      state.reader.currentContext = nextContext;
      if (!state.reader.heartbeatTimer) {
        startReaderHeartbeat();
      }
      return nextContext;
    }

    const now = Date.now();
    if (currentContext) {
      emitReaderSessionLeave(currentContext, nextContext.trigger_source, now - state.reader.enteredAt);
    }

    state.reader.currentContext = nextContext;
    state.reader.currentKey = nextKey;
    state.reader.enteredAt = now;
    emitReaderSessionEnter(nextContext);
    startReaderHeartbeat();
    return nextContext;
  }

  function clearReaderSessionContext(reason) {
    const currentContext = state.reader.currentContext;
    if (currentContext) {
      emitReaderSessionLeave(currentContext, reason || "close", Date.now() - state.reader.enteredAt);
    }
    state.reader.currentContext = null;
    state.reader.currentKey = "";
    state.reader.enteredAt = 0;
    stopReaderHeartbeat();
    return currentContext;
  }

  function enqueueBackendRecord(record) {
    state.backend.pendingRecords.push(record);
    scheduleBackendFlush();
  }

  function scheduleBackendFlush() {
    if (state.backend.sending || state.backend.flushTimer) return;
    if (!getResolvedUserId()) return;
    state.backend.flushTimer = window.setTimeout(() => {
      state.backend.flushTimer = null;
      flushBackendQueue();
    }, BACKEND_FLUSH_DELAY_MS);
  }

  async function flushBackendQueue() {
    const userId = getResolvedUserId();
    if (!userId || !state.backend.pendingRecords.length || state.backend.sending) return;
    const batch = state.backend.pendingRecords.splice(0);
    const events = batch.map((record) => mapRecordToBackendEvent(record, userId)).filter(Boolean);
    if (!events.length) return;
    state.backend.sending = true;
    try {
      const response = await fetch(BACKEND_INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          user_id: userId,
          events,
        }),
      });
      if (!response.ok) {
        throw new Error(`telemetry ingest failed: ${response.status}`);
      }
    } catch (_err) {
      state.backend.pendingRecords = batch.concat(state.backend.pendingRecords);
    } finally {
      state.backend.sending = false;
      if (state.backend.pendingRecords.length) {
        scheduleBackendFlush();
      }
    }
  }

  function mapRecordToBackendEvent(record, userId) {
    const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};
    if (!userId) return null;
    const lectureId = normalizeUserId(payload.lecture_id);
    const bookId = normalizeUserId(payload.book_id);
    const chapterIndex = Number.isFinite(Number(payload.chapter_index)) ? Number(payload.chapter_index) : "";
    const sessionIndex = Number.isFinite(Number(payload.session_index)) ? Number(payload.session_index) : "";
    const extra = {
      frontend_event: record.event,
      trigger_source: payload.trigger_source || "",
      transition_reason: payload.transition_reason || "",
      chapter_title: payload.chapter_title || "",
      chapter_name: payload.chapter_name || "",
      session_name: payload.session_name || "",
      session_range: payload.session_range || "",
      session_summary: payload.session_summary || "",
      session_key: payload.session_key || "",
      active_duration_ms: Number.isFinite(Number(payload.active_duration_ms)) ? Number(payload.active_duration_ms) : "",
      duration_ms: Number.isFinite(Number(payload.duration_ms)) ? Number(payload.duration_ms) : "",
      entered_at: Number.isFinite(Number(payload.entered_at)) ? Number(payload.entered_at) : "",
      left_at: Number.isFinite(Number(payload.left_at)) ? Number(payload.left_at) : "",
      note_type: payload.note_type || "",
      anchor_text: payload.anchor_text || "",
      note_text: payload.note_text || "",
      selection_rect: payload.selection_rect || null,
      hover_rect: payload.hover_rect || null,
      view_mode: payload.view_mode || "",
      telemetry_key: payload.telemetry_key || "",
      text_length: payload.text_length || "",
      session_index: payload.session_index,
      chapter_index: payload.chapter_index,
      recorded_at: record.ts,
      original_payload: payload,
    };

    switch (record.event) {
      case "reader_open":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "focus_in",
          scroll: "",
          focus: "reader",
          sel_text: "",
          extra,
        };
      case "reader_close":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "focus_out",
          scroll: "",
          focus: "blur",
          sel_text: "",
          extra,
        };
      case "reader_session_enter":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "focus_in",
          scroll: "",
          focus: "reader",
          sel_text: "",
          extra,
        };
      case "reader_session_leave":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "focus_out",
          scroll: "",
          focus: "blur",
          sel_text: "",
          duration_ms: Number.isFinite(Number(payload.duration_ms)) ? Number(payload.duration_ms) : "",
          extra,
        };
      case "reader_session_snapshot":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "snapshot",
          scroll: "",
          focus: "reader",
          sel_text: "",
          duration_ms: Number.isFinite(Number(payload.duration_ms)) ? Number(payload.duration_ms) : "",
          extra,
        };
      case "reader_scroll":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "scroll",
          scroll: Number.isFinite(Number(payload.scroll_percent)) ? Number(payload.scroll_percent) : "",
          focus: "reader",
          sel_text: "",
          extra,
        };
      case "reader_text_selection":
      case "reader_selection_contextmenu":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "selection",
          scroll: "",
          focus: "reader",
          sel_text: String(payload.text || "").trim(),
          extra,
        };
      case "reader_session_complete":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "session_complete",
          scroll: "",
          focus: "reader",
          sel_text: "",
          extra,
        };
      case "reader_chapter_complete":
        return {
          stream: "reading",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "chapter_complete",
          scroll: "",
          focus: "reader",
          sel_text: "",
          extra,
        };
      case "reader_knowledge_point_hover":
        return {
          stream: "annotation",
          ts: record.ts,
          uid: userId,
          bid: bookId,
          ci: chapterIndex,
          si: sessionIndex,
          event: "view",
          ann_type: String(payload.note_type || "知识点").trim() || "知识点",
          offset: Number.isFinite(Number(payload.offset)) ? Number(payload.offset) : "",
          duration_ms: 0,
          extra,
        };
      default:
        return null;
    }
  }

  window.NXLTelemetry = Object.freeze({
    emit,
    setUserId,
    setReaderSessionContext,
    clearReaderSessionContext,
  });

  window.addEventListener("pagehide", () => {
    clearReaderSessionContext("pagehide");
    if (state.backend.pendingRecords.length) {
      flushBackendQueue();
    }
  });
})();