(function () {
  "use strict";

  const DEFAULT_PUZZLE = {
    title: "拼接式解题",
    prompt: "已知 x**2 = 4，请把正确零件拖入并连成一条严谨链路。",
    correctPath: ["p1", "p2", "p3"],
    pieces: [
      { id: "p1", text: "x**2 = 4", kind: "correct", hint: "起点" },
      { id: "p2", text: "由 x**2 = 4 可得 x = ±2", kind: "correct", hint: "关键推导" },
      { id: "p3", text: "所以解为 x = 2 或 x = -2", kind: "correct", hint: "结论" },
      { id: "d1", text: "√(x**2) = √4 = 2，因此 x = 2", kind: "wrong", hint: "遗漏负根" },
      { id: "d2", text: "(-2)**2 = 4", kind: "misleading", hint: "只是验证" },
      { id: "d3", text: "2**2 = 4", kind: "misleading", hint: "只是验证" },
      { id: "d4", text: "x = 2/-2", kind: "wrong", hint: "表达错误" },
      { id: "d5", text: "因为 4 > 0，所以 x > 0", kind: "wrong", hint: "无关推断" },
      { id: "d6", text: "把 4 写成 2 × 2", kind: "misleading", hint: "不构成关键步骤" },
      { id: "d7", text: "两边同时开根号后直接去掉 ±", kind: "wrong", hint: "不严谨" }
    ]
  };
  const STORAGE_KEY_PREFIX = "nexora_learning_puzzle_state_v1:";

  const el = {
    canvas: document.getElementById("puzzleCanvas"),
    submitBtn: document.getElementById("puzzleSubmitBtn"),
    resetViewBtn: document.getElementById("puzzleResetViewBtn"),
    resetPuzzleBtn: document.getElementById("puzzleResetPuzzleBtn"),
    feedback: document.getElementById("puzzleFeedback")
  };

  const state = {
    runtimeMode: "standalone",
    definition: cloneDefinition(DEFAULT_PUZZLE),
    nodes: [],
    edges: [],
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
    drag: null,
    connectFrom: null,
    hoverPort: null,
    hoverEdgeIndex: -1,
    pointer: { x: 0, y: 0, down: false },
    dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    embeddedReady: false,
    debug: /(?:\?|&)debug=1(?:&|$)/.test(window.location.search),
    resizeObserver: null,
    storageKey: "",
    persistTimer: null,
    longPressTimer: null,
    longPressMeta: null,
    locked: false,
    submissionSnapshot: null,
    puzzleId: "",
    lastInitFingerprint: ""
  };

  const layout = {
    nodeWidth: 150,
    nodeHeight: 54,
    portRadius: 7,
    portHitRadius: 16,
    nodeHitPadding: 16,
    workspacePadding: 18,
    headerHeight: 92,
    bankWidth: 336,
    bankGap: 10
  };

  const workspaceTitleWorld = {
    x: layout.workspacePadding,
    kickerY: 24,
    titleY: 48,
    promptY: 80
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cloneDefinition(raw) {
    try {
      return JSON.parse(JSON.stringify(raw || {}));
    } catch (_) {
      return {
        title: "",
        prompt: "",
        correctPath: [],
        pieces: []
      };
    }
  }

  function normalizeStepTexts(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }
    return rawSteps.map(function (item) {
      return String(item || "").trim();
    }).filter(Boolean);
  }

  function buildEmbeddedDefinition(payload) {
    const puzzleId = String(payload && payload.puzzle_id || "").trim();
    const title = String(payload && payload.title || "").trim() || "拼接式解题";
    const steps = normalizeStepTexts(payload && payload.steps);
    const pieces = steps.map(function (text, index) {
      return {
        id: `step_${index + 1}`,
        text: text,
        kind: "step",
        hint: `步骤 ${index + 1}`
      };
    });
    return {
      puzzle_id: puzzleId,
      title: title,
      prompt: "请把步骤拖入工作区并连成你认为合理的解题链路，然后提交当前思路。",
      correctPath: pieces.map(function (piece) { return piece.id; }),
      pieces: pieces
    };
  }

  function getDefinitionSignature(definition) {
    const def = definition || {};
    const title = String(def.title || "").trim();
    const pieces = Array.isArray(def.pieces) ? def.pieces : [];
    const joined = pieces.map(function (piece, index) {
      const id = String(piece && piece.id || `p${index + 1}`).trim();
      const text = String(piece && piece.text || "").trim();
      return `${id}:${text}`;
    }).join("|");
    return `${title}::${joined}`;
  }

  function hashText(input) {
    let h = 2166136261;
    const text = String(input || "");
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return String(h >>> 0);
  }

  function buildStorageKeyForCurrentPuzzle() {
    const runtime = String(state.runtimeMode || "standalone");
    const pid = String((state.definition && state.definition.puzzle_id) || state.puzzleId || "").trim();
    if (pid) {
      return `${STORAGE_KEY_PREFIX}${runtime}:id:${pid}`;
    }
    const signature = getDefinitionSignature(state.definition);
    return `${STORAGE_KEY_PREFIX}${runtime}:${hashText(signature)}`;
  }

  function updateStorageKey() {
    state.storageKey = buildStorageKeyForCurrentPuzzle();
  }

  function clearPersistTimer() {
    if (state.persistTimer) {
      clearTimeout(state.persistTimer);
      state.persistTimer = null;
    }
  }

  function readPersistedState() {
    if (!state.storageKey) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(state.storageKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writePersistedStateNow() {
    clearPersistTimer();
    if (!state.storageKey) {
      return;
    }
    try {
      const payload = {
        version: 1,
        saved_at: Date.now(),
        runtime_mode: String(state.runtimeMode || ""),
        signature: getDefinitionSignature(state.definition),
        zoom: Number(state.zoom || 1),
        viewportX: Number(state.viewportX || 0),
        viewportY: Number(state.viewportY || 0),
        locked: !!state.locked,
        submission: state.submissionSnapshot && typeof state.submissionSnapshot === "object"
          ? state.submissionSnapshot
          : null,
        nodes: (Array.isArray(state.nodes) ? state.nodes : []).map(function (node) {
          return {
            id: String(node && node.id || ""),
            pieceId: String(node && node.pieceId || ""),
            x: Number(node && node.x || 0),
            y: Number(node && node.y || 0)
          };
        }),
        edges: (Array.isArray(state.edges) ? state.edges : []).map(function (edge) {
          return {
            from: String(edge && edge.from || ""),
            fromSide: String(edge && edge.fromSide || ""),
            to: String(edge && edge.to || ""),
            toSide: String(edge && edge.toSide || "")
          };
        })
      };
      window.localStorage.setItem(state.storageKey, JSON.stringify(payload));
    } catch (err) {
      try {
        console.warn("[Puzzle] persist write failed", {
          key: state.storageKey,
          message: err && err.message ? String(err.message) : String(err || "")
        });
      } catch (_) {}
    }
  }

  function schedulePersistState(delayMs) {
    const wait = Number(delayMs) > 0 ? Number(delayMs) : 180;
    clearPersistTimer();
    state.persistTimer = setTimeout(function () {
      writePersistedStateNow();
    }, wait);
  }

  function clearPersistedState() {
    clearPersistTimer();
    if (!state.storageKey) {
      return;
    }
    try {
      window.localStorage.removeItem(state.storageKey);
    } catch (_) {}
  }

  function setLockedState(locked, submission) {
    function compactSubmission(input) {
      const src = input && typeof input === "object" ? input : null;
      if (!src) return null;
      const ordered = Array.isArray(src.ordered_steps)
        ? src.ordered_steps.map(function (item) { return String(item || "").trim(); }).filter(Boolean)
        : [];
      const graph = src.graph && typeof src.graph === "object" ? src.graph : {};
      const connections = Array.isArray(graph.connections)
        ? graph.connections.slice(0, 64).map(function (edge) {
            return {
              from_text: String(edge && edge.from_text || "").trim(),
              to_text: String(edge && edge.to_text || "").trim()
            };
          }).filter(function (edge) { return edge.from_text && edge.to_text; })
        : [];
      return {
        ordered_steps: ordered,
        graph: {
          node_count: Number(graph.node_count || 0),
          edge_count: Number(graph.edge_count || 0),
          branch_count: Number(graph.branch_count || 0),
          has_cycle: !!graph.has_cycle,
          component_count: Number(graph.component_count || 0),
          connections: connections
        }
      };
    }

    state.locked = !!locked;
    if (state.locked) {
      state.submissionSnapshot = compactSubmission(submission) || state.submissionSnapshot;
    } else {
      state.submissionSnapshot = null;
    }
    if (el.submitBtn) {
      el.submitBtn.disabled = !!state.locked;
      el.submitBtn.textContent = state.locked ? "已提交" : (state.runtimeMode === "embedded" ? "提交" : "检查");
    }
    if (el.resetPuzzleBtn) {
      el.resetPuzzleBtn.disabled = !!state.locked;
    }
    if (el.resetViewBtn) {
      el.resetViewBtn.disabled = false;
    }
    if (state.locked) {
      setFeedback("success", "该拼图已提交，已锁定编辑。");
    }
  }

  function getCtx() {
    return el.canvas ? el.canvas.getContext("2d") : null;
  }

  function resizeCanvas() {
    if (!el.canvas) {
      return;
    }
    const rect = el.canvas.getBoundingClientRect();
    el.canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
    el.canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
    const ctx = getCtx();
    if (!ctx) {
      return;
    }
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    draw();
  }

  function setFeedback(mode, text) {
    if (!el.feedback) {
      return;
    }
    el.feedback.classList.remove("is-success", "is-warning");
    if (mode === "success") {
      el.feedback.classList.add("is-success");
    } else if (mode === "warning") {
      el.feedback.classList.add("is-warning");
    }
    el.feedback.textContent = text;
  }

  function shuffle(arr) {
    const rows = arr.slice();
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rows[i];
      rows[i] = rows[j];
      rows[j] = tmp;
    }
    return rows;
  }

  function resetPuzzle(options) {
    const opts = options && typeof options === "object" ? options : {};
    const clearCache = opts.clearCache === true;
    state.nodes = createInitialNodes();
    state.edges = [];
    state.zoom = 1;
    state.viewportX = 0;
    state.viewportY = 0;
    state.drag = null;
    state.connectFrom = null;
    state.hoverPort = null;
    state.hoverEdgeIndex = -1;
    setLockedState(false, null);
    if (clearCache) {
      clearPersistedState();
    } else {
      writePersistedStateNow();
    }
    draw();
    if (state.runtimeMode === "embedded") {
      setFeedback("default", "操作提示：把步骤拖入右侧工作区，拖动端点连线后提交当前拼接顺序。");
    } else {
      setFeedback("default", "操作提示：左侧组件可直接拖入右侧。工作区空白处可拖动画布，节点两端均可开始或结束连线。");
    }
  }

  function colorForKind(kind) {
    if (kind === "correct") return { fill: "#eef9f1", line: "#17643d", text: "#17643d", label: "正确" };
    if (kind === "wrong") return { fill: "#fff1f0", line: "#b42318", text: "#b42318", label: "错误" };
    if (kind === "step") return { fill: "#f8fafc", line: "#475569", text: "#111111", label: "步骤" };
    return { fill: "#fff5eb", line: "#9f4b08", text: "#9f4b08", label: "干扰" };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || "").split("");
    const lines = [];
    let current = "";
    for (const ch of chars) {
      const next = current + ch;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) {
      lines.push(current);
    }
    return lines;
  }

  function nodePortPos(node, side) {
    return {
      x: side === "left" ? node.x + 1 : node.x + layout.nodeWidth - 1,
      y: node.y + layout.nodeHeight / 2
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - state.viewportX) / state.zoom,
      y: (point.y - state.viewportY) / state.zoom
    };
  }

  function worldToScreen(point) {
    return {
      x: point.x * state.zoom + state.viewportX,
      y: point.y * state.zoom + state.viewportY
    };
  }

  function drawBackground(ctx, width, height) {
    const titleScreenX = worldToScreen({ x: workspaceTitleWorld.x, y: 0 }).x;
    const kickerScreenY = worldToScreen({ x: 0, y: workspaceTitleWorld.kickerY }).y;
    const titleScreenY = worldToScreen({ x: 0, y: workspaceTitleWorld.titleY }).y;
    const promptScreenY = worldToScreen({ x: 0, y: workspaceTitleWorld.promptY }).y;
    const visibleWorldWidth = width / state.zoom;
    const maxTextWidth = Math.max(80, (visibleWorldWidth - workspaceTitleWorld.x - layout.workspacePadding - 8) * state.zoom);
    const titleLines = wrapText(ctx, String(state.definition.title || "拼接式解题"), maxTextWidth).slice(0, 2);
    const promptLines = wrapText(ctx, String(state.definition.prompt || ""), maxTextWidth).slice(0, 2);
    const lineStep = 20 * state.zoom;
    const promptStep = 16 * state.zoom;
    const promptY = promptScreenY + Math.max(0, titleLines.length - 1) * lineStep;

    ctx.fillStyle = "#666666";
    ctx.font = `700 ${11 * state.zoom}px Segoe UI`;
    ctx.fillText("PUZZLE WORKSPACE", titleScreenX, kickerScreenY);

    ctx.fillStyle = "#111111";
    ctx.font = `700 ${16 * state.zoom}px Segoe UI`;
    titleLines.forEach(function (line, index) {
      ctx.fillText(line, titleScreenX, titleScreenY + index * lineStep);
    });

    ctx.fillStyle = "#666666";
    ctx.font = `${12 * state.zoom}px Segoe UI`;
    promptLines.forEach(function (line, index) {
      ctx.fillText(line, titleScreenX, promptY + index * promptStep);
    });
  }

  function drawGrid(ctx, width, height) {
    const grid = 28;
    const topLeft = screenToWorld({ x: 0, y: 0 });
    const bottomRight = screenToWorld({ x: width, y: height });
    const startX = Math.floor(topLeft.x / grid) * grid - grid;
    const endX = Math.ceil(bottomRight.x / grid) * grid + grid;
    const startY = Math.floor(topLeft.y / grid) * grid - grid;
    const endY = Math.ceil(bottomRight.y / grid) * grid + grid;
    ctx.strokeStyle = "rgba(17,17,17,0.035)";
    ctx.lineWidth = 1;

    for (let x = startX; x <= endX; x += grid) {
      const sx = worldToScreen({ x: x, y: 0 }).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y += grid) {
      const sy = worldToScreen({ x: 0, y: y }).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const nt = 1 - t;
    const nt2 = nt * nt;
    const nt3 = nt2 * nt;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: nt3 * p0.x + 3 * nt2 * t * p1.x + 3 * nt * t2 * p2.x + t3 * p3.x,
      y: nt3 * p0.y + 3 * nt2 * t * p1.y + 3 * nt * t2 * p2.y + t3 * p3.y
    };
  }

  function distancePointToSegment(point, segA, segB) {
    const vx = segB.x - segA.x;
    const vy = segB.y - segA.y;
    const wx = point.x - segA.x;
    const wy = point.y - segA.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) {
      return Math.hypot(point.x - segA.x, point.y - segA.y);
    }
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
      return Math.hypot(point.x - segB.x, point.y - segB.y);
    }
    const b = c1 / c2;
    const proj = { x: segA.x + b * vx, y: segA.y + b * vy };
    return Math.hypot(point.x - proj.x, point.y - proj.y);
  }

  function getEdgeCurvePoints(edge) {
    const fromNode = state.nodes.find(function (row) { return row.id === edge.from; });
    const toNode = state.nodes.find(function (row) { return row.id === edge.to; });
    if (!fromNode || !toNode) {
      return null;
    }
    const from = worldToScreen(nodePortPos(fromNode, edge.fromSide));
    const to = worldToScreen(nodePortPos(toNode, edge.toSide));
    const dx = Math.max(36, Math.abs(to.x - from.x) * 0.45);
    return {
      from: from,
      cp1: { x: from.x + dx, y: from.y },
      cp2: { x: to.x - dx, y: to.y },
      to: to
    };
  }

  function findEdgeAt(screenX, screenY) {
    const probe = { x: screenX, y: screenY };
    const threshold = 8;
    for (let i = state.edges.length - 1; i >= 0; i -= 1) {
      const curve = getEdgeCurvePoints(state.edges[i]);
      if (!curve) {
        continue;
      }
      let prev = curve.from;
      const segments = 28;
      for (let s = 1; s <= segments; s += 1) {
        const t = s / segments;
        const current = cubicPoint(curve.from, curve.cp1, curve.cp2, curve.to, t);
        if (distancePointToSegment(probe, prev, current) <= threshold) {
          return i;
        }
        prev = current;
      }
    }
    return -1;
  }

  function removeEdgeAt(index) {
    if (!(index >= 0 && index < state.edges.length)) {
      return false;
    }
    state.edges.splice(index, 1);
    state.hoverEdgeIndex = -1;
    writePersistedStateNow();
    draw();
    return true;
  }

  function drawEdges(ctx) {
    for (let i = 0; i < state.edges.length; i += 1) {
      const edge = state.edges[i];
      const curve = getEdgeCurvePoints(edge);
      if (!curve) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(curve.from.x, curve.from.y);
      ctx.bezierCurveTo(curve.cp1.x, curve.cp1.y, curve.cp2.x, curve.cp2.y, curve.to.x, curve.to.y);
      const highlighted = i === state.hoverEdgeIndex;
      ctx.strokeStyle = highlighted ? "#2563eb" : "#111111";
      ctx.lineWidth = highlighted ? 2.4 : 2;
      ctx.stroke();
    }

    if (state.connectFrom && state.pointer) {
      const node = state.nodes.find(function (row) { return row.id === state.connectFrom.nodeId; });
      if (node) {
        const from = worldToScreen(nodePortPos(node, state.connectFrom.side));
        const to = { x: state.pointer.x, y: state.pointer.y };
        const dx = Math.max(36, Math.abs(to.x - from.x) * 0.45);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.bezierCurveTo(from.x + dx, from.y, to.x - dx, to.y, to.x, to.y);
        ctx.strokeStyle = "rgba(17,17,17,0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawNode(ctx, node) {
    const style = colorForKind(node.piece.kind);
    const screen = worldToScreen({ x: node.x, y: node.y });
    const nodeWidth = layout.nodeWidth * state.zoom;
    const nodeHeight = layout.nodeHeight * state.zoom;
    const borderRadius = 7;
    const labelFont = Math.max(8, 8.5 * state.zoom);
    const contentFont = Math.max(8, 9 * state.zoom);
    const paddingX = 8 * state.zoom;
    const titleY = 14 * state.zoom;
    const textY = 28 * state.zoom;
    const lineGap = 11.5 * state.zoom;
    const portRadius = 4.75;

    roundRect(ctx, screen.x, screen.y, nodeWidth, nodeHeight, borderRadius);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(17,17,17,0.34)";
    ctx.stroke();

    ctx.fillStyle = "rgba(17,17,17,0.58)";
    ctx.font = `600 ${labelFont}px Segoe UI`;
    ctx.fillText(style.label, screen.x + paddingX, screen.y + titleY);

    ctx.fillStyle = "#111111";
    ctx.font = `500 ${contentFont}px Segoe UI`;
    const lines = wrapText(ctx, node.piece.text, Math.max(80, nodeWidth - paddingX * 2));
    lines.slice(0, 2).forEach(function (line, index) {
      ctx.fillText(line, screen.x + paddingX, screen.y + textY + index * lineGap);
    });

    for (const side of ["left", "right"]) {
      const port = worldToScreen(nodePortPos(node, side));
      const active = !!(
        state.hoverPort
        && state.hoverPort.nodeId === node.id
        && state.hoverPort.side === side
      );
      ctx.beginPath();
      ctx.arc(port.x, port.y, portRadius, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#111111" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = active ? 2 : 1.25;
      ctx.strokeStyle = active ? "#111111" : "rgba(17,17,17,0.68)";
      ctx.stroke();
    }
  }

  function drawWorkspace(ctx, width, height) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    drawBackground(ctx, width, height);
    drawGrid(ctx, width, height);
    drawEdges(ctx);
    state.nodes.forEach(function (node) {
      drawNode(ctx, node);
    });
  }

  function draw() {
    const ctx = getCtx();
    if (!ctx || !el.canvas) {
      return;
    }
    const width = el.canvas.width / state.dpr;
    const height = el.canvas.height / state.dpr;
    ctx.clearRect(0, 0, width, height);
    drawWorkspace(ctx, width, height);
    if (state.debug) {
      drawDebugOverlay(ctx, width, height);
    }
  }

  function toCanvasPoint(event) {
    const rect = el.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function handleCanvasWheel(event) {
    if (!el.canvas) {
      return;
    }
    if (state.locked) {
      return;
    }
    event.preventDefault();
    const point = toCanvasPoint(event);
    const before = screenToWorld(point);
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    state.zoom = clamp(state.zoom * factor, 0.7, 1.6);
    state.viewportX = point.x - before.x * state.zoom;
    state.viewportY = point.y - before.y * state.zoom;
    schedulePersistState(220);
    draw();
  }

  function handleCanvasContextMenu(event) {
    event.preventDefault();
    if (state.locked) {
      return;
    }
    const point = toCanvasPoint(event);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    const edgeIndex = findEdgeAt(point.x, point.y);
    state.hoverEdgeIndex = edgeIndex;
    if (edgeIndex >= 0 && removeEdgeAt(edgeIndex)) {
      setFeedback("default", "已断开该连线。");
      return;
    }
    draw();
  }

  function findNodeAt(screenX, screenY) {
    for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
      const node = state.nodes[i];
      const screen = worldToScreen({ x: node.x, y: node.y });
      const width = layout.nodeWidth * state.zoom;
      const height = layout.nodeHeight * state.zoom;
      const pad = layout.nodeHitPadding;
      if (
        screenX >= screen.x - pad &&
        screenX <= screen.x + width + pad &&
        screenY >= screen.y - pad &&
        screenY <= screen.y + height + pad
      ) {
        return node;
      }
    }
    return null;
  }

  function findPortAt(screenX, screenY) {
    for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
      const node = state.nodes[i];
      const side = hitPort(node, screenX, screenY);
      if (side) {
        return { node: node, side: side };
      }
    }
    return null;
  }

  function isSameHoverPort(a, b) {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return a.nodeId === b.nodeId && a.side === b.side;
  }

  function hitPort(node, screenX, screenY) {
    const worldRadius = layout.portHitRadius;
    for (const side of ["left", "right"]) {
      const pos = worldToScreen(nodePortPos(node, side));
      const dx = screenX - pos.x;
      const dy = screenY - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= worldRadius) {
        return side;
      }
    }
    return "";
  }

  function createNodeFromPiece(pieceId, worldX, worldY) {
    const piece = (state.definition.pieces || []).find(function (row) { return row.id === pieceId; });
    if (!piece) {
      return null;
    }
    return {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      piece: piece,
      pieceId: piece.id,
      x: worldX,
      y: worldY
    };
  }

  function createInitialNodes() {
    const pieces = shuffle(state.definition.pieces || []);
    const rows = [];
    const columns = 2;
    const startX = layout.workspacePadding + 8;
    const startY = layout.headerHeight + 14;
    const columnWidth = layout.nodeWidth + 18;
    const rowHeight = layout.nodeHeight + layout.bankGap + 2;
    pieces.forEach(function (piece, index) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      rows.push({
        id: `node_${piece.id}`,
        piece: piece,
        pieceId: piece.id,
        x: startX + column * columnWidth,
        y: startY + row * rowHeight
      });
    });
    return rows;
  }

  function applyPersistedState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }
    const pieceMap = new Map((state.definition.pieces || []).map(function (piece) {
      return [String(piece.id || ""), piece];
    }));
    const persistedNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const restoredNodes = [];
    for (const row of persistedNodes) {
      const pieceId = String(row && row.pieceId || "").trim();
      const piece = pieceMap.get(pieceId);
      if (!piece) {
        continue;
      }
      restoredNodes.push({
        id: String(row && row.id || `node_${pieceId}`),
        piece: piece,
        pieceId: pieceId,
        x: Number(row && row.x || 0),
        y: Number(row && row.y || 0)
      });
    }
    if (!restoredNodes.length) {
      return false;
    }
    const seenPieceIds = new Set(restoredNodes.map(function (node) { return node.pieceId; }));
    const fallbackNodes = createInitialNodes();
    for (const fallback of fallbackNodes) {
      if (!seenPieceIds.has(fallback.pieceId)) {
        restoredNodes.push(fallback);
      }
    }
    const validNodeIds = new Set(restoredNodes.map(function (node) { return node.id; }));
    const restoredEdges = (Array.isArray(snapshot.edges) ? snapshot.edges : []).map(function (edge) {
      return {
        from: String(edge && edge.from || "").trim(),
        fromSide: String(edge && edge.fromSide || "").trim(),
        to: String(edge && edge.to || "").trim(),
        toSide: String(edge && edge.toSide || "").trim()
      };
    }).filter(function (edge) {
      if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to)) {
        return false;
      }
      if (!(edge.fromSide === "left" || edge.fromSide === "right")) {
        return false;
      }
      if (!(edge.toSide === "left" || edge.toSide === "right")) {
        return false;
      }
      return edge.from !== edge.to;
    });
    state.nodes = restoredNodes;
    state.edges = restoredEdges;
    state.zoom = clamp(Number(snapshot.zoom || 1), 0.7, 1.6);
    state.viewportX = Number(snapshot.viewportX || 0);
    state.viewportY = Number(snapshot.viewportY || 0);
    state.drag = null;
    state.connectFrom = null;
    state.hoverPort = null;
    state.hoverEdgeIndex = -1;
    setLockedState(!!snapshot.locked, snapshot.submission && typeof snapshot.submission === "object" ? snapshot.submission : null);
    return true;
  }

  function bringNodeToFront(nodeId) {
    const index = state.nodes.findIndex(function (row) { return row.id === nodeId; });
    if (index < 0) {
      return;
    }
    const node = state.nodes.splice(index, 1)[0];
    state.nodes.push(node);
  }

  function ensureEdge(fromId, fromSide, toId, toSide) {
    if (!fromId || !toId || fromId === toId) {
      return;
    }
    state.edges = state.edges.filter(function (edge) {
      return !(
        (edge.from === fromId && edge.fromSide === fromSide && edge.to === toId && edge.toSide === toSide)
        || (edge.from === toId && edge.fromSide === toSide && edge.to === fromId && edge.toSide === fromSide)
      );
    });
    state.edges.push({ from: fromId, fromSide: fromSide, to: toId, toSide: toSide });
  }

  function deriveChain() {
    const byId = new Map(state.nodes.map(function (node) { return [node.id, node]; }));
    if (!state.edges.length) {
      return [];
    }
    const normalizedDirected = [];
    for (const edge of state.edges) {
      const rawFrom = byId.get(String(edge.from || ""));
      const rawTo = byId.get(String(edge.to || ""));
      if (!rawFrom || !rawTo || rawFrom.id === rawTo.id) {
        continue;
      }
      let from = rawFrom;
      let to = rawTo;
      if (from.x > to.x || (Math.abs(from.x - to.x) < 1 && from.y > to.y)) {
        from = rawTo;
        to = rawFrom;
      }
      normalizedDirected.push({ from: from.id, to: to.id });
    }
    if (!normalizedDirected.length) {
      return [];
    }
    const outgoing = new Map();
    const incomingCount = new Map();
    const graphNodeIds = new Set();
    for (const item of normalizedDirected) {
      if (!outgoing.has(item.from)) {
        outgoing.set(item.from, []);
      }
      outgoing.get(item.from).push(item.to);
      incomingCount.set(item.to, Number(incomingCount.get(item.to) || 0) + 1);
      if (!incomingCount.has(item.from)) {
        incomingCount.set(item.from, Number(incomingCount.get(item.from) || 0));
      }
      graphNodeIds.add(item.from);
      graphNodeIds.add(item.to);
    }
    const graphNodes = Array.from(graphNodeIds).map(function (id) { return byId.get(id); }).filter(Boolean);
    if (!graphNodes.length) {
      return [];
    }
    const sortByWorldPosition = function (a, b) {
      if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
      if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
      return String(a.id).localeCompare(String(b.id));
    };
    const starts = graphNodes.filter(function (node) {
      return Number(incomingCount.get(node.id) || 0) === 0;
    }).sort(sortByWorldPosition);
    let current = starts.length ? starts[0] : graphNodes.slice().sort(sortByWorldPosition)[0];
    const chain = [];
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current.pieceId);
      const nextIds = (outgoing.get(current.id) || []).filter(function (id) { return !seen.has(id); });
      if (!nextIds.length) {
        break;
      }
      const nextNodes = nextIds.map(function (id) { return byId.get(id); }).filter(Boolean).sort(sortByWorldPosition);
      current = nextNodes.length ? nextNodes[0] : null;
    }
    return chain;
  }

  function orderedStepsFromChain() {
    const actual = deriveChain();
    if (actual.length) {
      return actual.map(function (pieceId) {
        const piece = (state.definition.pieces || []).find(function (row) { return row.id === pieceId; });
        return piece ? String(piece.text || "").trim() : "";
      }).filter(Boolean);
    }
    if (!state.edges.length) {
      return [];
    }
    const involved = new Set();
    state.edges.forEach(function (edge) {
      involved.add(String(edge.from || ""));
      involved.add(String(edge.to || ""));
    });
    const fallbackNodes = state.nodes.filter(function (node) { return involved.has(String(node.id || "")); })
      .slice()
      .sort(function (a, b) {
        if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
        if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
        return String(a.id).localeCompare(String(b.id));
      });
    return fallbackNodes.map(function (node) {
      const piece = (state.definition.pieces || []).find(function (row) { return row.id === node.pieceId; });
      return piece ? String(piece.text || "").trim() : "";
    }).filter(Boolean);
  }

  function normalizeDirectedEdgeList() {
    const byId = new Map(state.nodes.map(function (node) { return [node.id, node]; }));
    const list = [];
    for (const edge of state.edges) {
      const rawFrom = byId.get(String(edge.from || ""));
      const rawTo = byId.get(String(edge.to || ""));
      if (!rawFrom || !rawTo || rawFrom.id === rawTo.id) {
        continue;
      }
      let from = rawFrom;
      let to = rawTo;
      if (from.x > to.x || (Math.abs(from.x - to.x) < 1 && from.y > to.y)) {
        from = rawTo;
        to = rawFrom;
      }
      list.push({
        from: from.id,
        to: to.id,
        from_side: from.id === edge.from ? edge.fromSide : edge.toSide,
        to_side: to.id === edge.to ? edge.toSide : edge.fromSide
      });
    }
    return list;
  }

  function buildSubmissionPayload() {
    const nodeMap = new Map(state.nodes.map(function (node) { return [node.id, node]; }));
    const directedEdges = normalizeDirectedEdgeList();
    const outgoing = new Map();
    const incoming = new Map();
    const indegree = new Map();
    const nodeIds = new Set();
    directedEdges.forEach(function (edge) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push(edge.to);
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge.from);
      indegree.set(edge.to, Number(indegree.get(edge.to) || 0) + 1);
      if (!indegree.has(edge.from)) indegree.set(edge.from, Number(indegree.get(edge.from) || 0));
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    });
    const involvedNodes = Array.from(nodeIds)
      .map(function (id) { return nodeMap.get(id); })
      .filter(Boolean)
      .sort(function (a, b) {
        if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
        if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
        return String(a.id).localeCompare(String(b.id));
      });
    const queue = involvedNodes
      .filter(function (node) { return Number(indegree.get(node.id) || 0) === 0; })
      .map(function (node) { return node.id; });
    const topoNodeIds = [];
    const visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      topoNodeIds.push(id);
      const nextRows = (outgoing.get(id) || []).slice().sort(function (aId, bId) {
        const a = nodeMap.get(aId);
        const b = nodeMap.get(bId);
        if (!a || !b) return String(aId).localeCompare(String(bId));
        if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
        if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
        return String(a.id).localeCompare(String(b.id));
      });
      for (const nextId of nextRows) {
        indegree.set(nextId, Number(indegree.get(nextId) || 0) - 1);
        if (Number(indegree.get(nextId) || 0) <= 0) {
          queue.push(nextId);
        }
      }
    }
    const hasCycle = topoNodeIds.length < involvedNodes.length;
    const mainOrderedIds = topoNodeIds.length
      ? topoNodeIds
      : involvedNodes.map(function (node) { return node.id; });
    const orderedSteps = mainOrderedIds
      .map(function (nodeId) {
        const node = nodeMap.get(nodeId);
        return node ? String((node.piece && node.piece.text) || "").trim() : "";
      })
      .filter(Boolean);
    const branchCount = involvedNodes.reduce(function (count, node) {
      const outCount = (outgoing.get(node.id) || []).length;
      return outCount > 1 ? count + (outCount - 1) : count;
    }, 0);
    const roots = involvedNodes.filter(function (node) {
      return (incoming.get(node.id) || []).length === 0;
    });
    const leaves = involvedNodes.filter(function (node) {
      return (outgoing.get(node.id) || []).length === 0;
    });
    const undirected = new Map();
    involvedNodes.forEach(function (node) {
      undirected.set(node.id, new Set());
    });
    directedEdges.forEach(function (edge) {
      if (undirected.has(edge.from)) undirected.get(edge.from).add(edge.to);
      if (undirected.has(edge.to)) undirected.get(edge.to).add(edge.from);
    });
    const visitedUndirected = new Set();
    let componentCount = 0;
    for (const node of involvedNodes) {
      if (visitedUndirected.has(node.id)) continue;
      componentCount += 1;
      const stack = [node.id];
      while (stack.length) {
        const currentId = stack.pop();
        if (visitedUndirected.has(currentId)) continue;
        visitedUndirected.add(currentId);
        const nextSet = undirected.get(currentId) || new Set();
        nextSet.forEach(function (nextId) {
          if (!visitedUndirected.has(nextId)) stack.push(nextId);
        });
      }
    }
    const submission = {
      ordered_steps: orderedSteps,
      graph: {
        node_count: involvedNodes.length,
        edge_count: directedEdges.length,
        branch_count: branchCount,
        has_cycle: hasCycle,
        component_count: componentCount,
        roots: roots.map(function (node) { return String((node.piece && node.piece.text) || "").trim(); }).filter(Boolean),
        leaves: leaves.map(function (node) { return String((node.piece && node.piece.text) || "").trim(); }).filter(Boolean),
        adjacency: involvedNodes.map(function (node) {
          const outs = (outgoing.get(node.id) || []).map(function (nextId) {
            const nextNode = nodeMap.get(nextId);
            return String((nextNode && nextNode.piece && nextNode.piece.text) || "").trim();
          }).filter(Boolean);
          return {
            node_text: String((node.piece && node.piece.text) || "").trim(),
            next: outs
          };
        }),
        nodes: involvedNodes.map(function (node) {
          return {
            node_id: String(node.id || ""),
            piece_id: String(node.pieceId || ""),
            text: String((node.piece && node.piece.text) || "").trim(),
            x: Number(node.x || 0),
            y: Number(node.y || 0)
          };
        }),
        connections: directedEdges.map(function (edge) {
          const fromNode = nodeMap.get(edge.from);
          const toNode = nodeMap.get(edge.to);
          return {
            from_node_id: edge.from,
            to_node_id: edge.to,
            from_side: String(edge.from_side || ""),
            to_side: String(edge.to_side || ""),
            from_text: String((fromNode && fromNode.piece && fromNode.piece.text) || "").trim(),
            to_text: String((toNode && toNode.piece && toNode.piece.text) || "").trim()
          };
        })
      }
    };
    return submission;
  }

  function submitPuzzle() {
    const submission = buildSubmissionPayload();
    const orderedSteps = Array.isArray(submission.ordered_steps) ? submission.ordered_steps : [];
    try {
      console.log("[Puzzle] submit", {
        runtimeMode: state.runtimeMode,
        edges: Array.isArray(state.edges) ? state.edges.length : 0,
        orderedSteps: orderedSteps,
        graph: submission.graph
      });
    } catch (_) {}
    if (!orderedSteps.length) {
      setFeedback("warning", "当前还没有形成可提交的链路。请先把步骤拖入工作区，并通过端点连成一条主链。");
      return;
    }
    setLockedState(true, submission);
    writePersistedStateNow();
    setFeedback("success", `已提交当前拼接结果，共 ${orderedSteps.length} 步。`);
    window.parent.postMessage(
      {
        type: "nexora:puzzle:submit",
        ordered_steps: orderedSteps,
        submission: submission
      },
      "*"
    );
  }

  function checkPuzzle() {
    const actual = deriveChain();
    const expected = (state.definition.correctPath || []).slice();
    if (!actual.length) {
      setFeedback("warning", "当前还没有形成完整链路。先把节点拖入右侧，再通过节点两端把它们连起来。");
      return;
    }
    if (actual.length !== expected.length) {
      setFeedback("warning", `当前链路有 ${actual.length} 个节点，但这题的核心链路应为 ${expected.length} 步。请去掉干扰步骤，或补全缺失步骤。`);
      return;
    }
    for (let i = 0; i < expected.length; i += 1) {
      if (actual[i] !== expected[i]) {
        const current = (state.definition.pieces || []).find(function (row) { return row.id === actual[i]; });
        const shouldBe = (state.definition.pieces || []).find(function (row) { return row.id === expected[i]; });
        setFeedback("warning", `第 ${i + 1} 步当前是“${current ? current.text : "未知步骤"}”，这里更合理的应是“${shouldBe ? shouldBe.text : "正确步骤"}”。`);
        return;
      }
    }
    setFeedback("success", "拼接成功。当前链路已经完整表达了从题设、推导到结论的解题过程。");
  }

  function resetView() {
    state.zoom = 1;
    state.viewportX = 0;
    state.viewportY = 0;
    state.drag = null;
    state.connectFrom = null;
    state.hoverPort = null;
    state.hoverEdgeIndex = -1;
    writePersistedStateNow();
    draw();
  }

  function handlePrimaryAction() {
    if (state.locked) {
      return;
    }
    if (state.runtimeMode === "embedded") {
      submitPuzzle();
      return;
    }
    checkPuzzle();
  }

  function clearLongPressTimer() {
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
    state.longPressMeta = null;
  }

  function startLongPressEdgeDelete(edgeIndex, point, pointerId) {
    clearLongPressTimer();
    if (edgeIndex < 0) {
      return;
    }
    state.longPressMeta = {
      edgeIndex: edgeIndex,
      pointerId: pointerId,
      startX: point.x,
      startY: point.y
    };
    state.longPressTimer = setTimeout(function () {
      const meta = state.longPressMeta;
      clearLongPressTimer();
      if (!meta) {
        return;
      }
      if (removeEdgeAt(meta.edgeIndex)) {
        setFeedback("default", "已移除该连线。");
      }
    }, 560);
  }

  function handlePointerDown(event) {
    event.preventDefault();
    if (state.locked) {
      return;
    }
    const point = toCanvasPoint(event);
    state.pointer = { x: point.x, y: point.y, down: true };
    const world = screenToWorld(point);
    state.hoverEdgeIndex = findEdgeAt(point.x, point.y);
    if (String(event.pointerType || "").toLowerCase() !== "mouse") {
      startLongPressEdgeDelete(state.hoverEdgeIndex, point, event.pointerId);
    }

    const portHit = findPortAt(point.x, point.y);
    if (portHit) {
      clearLongPressTimer();
      bringNodeToFront(portHit.node.id);
      state.connectFrom = { nodeId: portHit.node.id, side: portHit.side };
      state.drag = { type: "connect" };
      if (el.canvas.setPointerCapture) {
        try {
          el.canvas.setPointerCapture(event.pointerId);
        } catch (_) {}
      }
      draw();
      return;
    }

    const node = findNodeAt(point.x, point.y);
    if (node) {
      clearLongPressTimer();
      bringNodeToFront(node.id);
      state.drag = {
        type: "move-node",
        nodeId: node.id,
        offsetX: world.x - node.x,
        offsetY: world.y - node.y
      };
      if (el.canvas.setPointerCapture) {
        try {
          el.canvas.setPointerCapture(event.pointerId);
        } catch (_) {}
      }
      draw();
      return;
    }

    state.connectFrom = null;
    state.drag = {
      type: "pan-pending",
      startX: point.x,
      startY: point.y,
      baseX: state.viewportX,
      baseY: state.viewportY
    };
    if (el.canvas.setPointerCapture) {
      try {
        el.canvas.setPointerCapture(event.pointerId);
      } catch (_) {}
    }
    draw();
  }

  function handlePointerMove(event) {
    if (state.locked) {
      return;
    }
    const point = toCanvasPoint(event);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    const world = screenToWorld(point);

    const prevHover = state.hoverPort ? { nodeId: state.hoverPort.nodeId, side: state.hoverPort.side } : null;
    const hoverPort = findPortAt(point.x, point.y);
    state.hoverPort = hoverPort ? { nodeId: hoverPort.node.id, side: hoverPort.side } : null;
    const prevEdgeIndex = state.hoverEdgeIndex;
    state.hoverEdgeIndex = findEdgeAt(point.x, point.y);

    if (!state.drag) {
      if (state.connectFrom || !isSameHoverPort(prevHover, state.hoverPort) || prevEdgeIndex !== state.hoverEdgeIndex) {
        draw();
      }
      return;
    }

    if (state.drag.type === "pan-pending") {
      const moveDx = point.x - state.drag.startX;
      const moveDy = point.y - state.drag.startY;
      if (state.longPressMeta && Math.hypot(moveDx, moveDy) >= 8) {
        clearLongPressTimer();
      }
      if (Math.hypot(moveDx, moveDy) >= 6) {
        state.drag.type = "pan";
      } else {
        draw();
        return;
      }
    }

    if (state.drag.type === "pan") {
      state.viewportX = state.drag.baseX + (point.x - state.drag.startX);
      state.viewportY = state.drag.baseY + (point.y - state.drag.startY);
      schedulePersistState(220);
    } else if (state.drag.type === "move-node") {
      const node = state.nodes.find(function (row) { return row.id === state.drag.nodeId; });
      if (node) {
        node.x = world.x - state.drag.offsetX;
        node.y = world.y - state.drag.offsetY;
        schedulePersistState(180);
      }
    }
    if (state.drag.type !== "connect") {
      state.hoverPort = null;
    }
    draw();
  }

  function handlePointerUp(event) {
    if (state.locked) {
      return;
    }
    const point = toCanvasPoint(event);
    const world = screenToWorld(point);
    if (state.drag && state.drag.type === "connect" && state.connectFrom) {
      const target = findPortAt(point.x, point.y);
      const targetNode = target ? target.node : null;
      const targetSide = target ? target.side : "";
      if (targetNode && targetSide && !(state.connectFrom.nodeId === targetNode.id && state.connectFrom.side === targetSide)) {
        ensureEdge(state.connectFrom.nodeId, state.connectFrom.side, targetNode.id, targetSide);
        writePersistedStateNow();
      }
      state.connectFrom = null;
    }
    clearLongPressTimer();
    state.drag = null;
    state.pointer.down = false;
    state.hoverPort = null;
    state.hoverEdgeIndex = findEdgeAt(point.x, point.y);
    if (el.canvas.releasePointerCapture) {
      try {
        el.canvas.releasePointerCapture(event.pointerId);
      } catch (_) {}
    }
    writePersistedStateNow();
    draw();
  }

  function handlePointerCancel() {
    if (state.locked) {
      return;
    }
    clearLongPressTimer();
    state.drag = null;
    state.connectFrom = null;
    state.pointer.down = false;
    state.hoverPort = null;
    state.hoverEdgeIndex = -1;
    draw();
  }

  function handlePointerLeave() {
    if (state.locked) {
      return;
    }
    clearLongPressTimer();
    if (state.hoverPort || state.connectFrom || state.hoverEdgeIndex >= 0) {
      state.hoverPort = null;
      if (!state.pointer.down) {
        state.connectFrom = null;
      }
      state.hoverEdgeIndex = -1;
      draw();
    }
  }

  function drawDebugOverlay(ctx, width, height) {
    const pointer = state.pointer || { x: -999, y: -999 };
    const hitNode = findNodeAt(pointer.x, pointer.y);
    const hitPort = hitNode ? hitPortAtNode(hitNode, pointer.x, pointer.y) : null;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(8, 8, 360, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Consolas";
    const world = screenToWorld(pointer);
    ctx.fillText(`screen=(${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)})`, 14, 30);
    ctx.fillText(`world=(${world.x.toFixed(1)}, ${world.y.toFixed(1)}) zoom=${state.zoom.toFixed(3)}`, 14, 48);
    ctx.fillText(`node=${hitNode ? hitNode.id : "-"} port=${hitPort || "-"}`, 14, 64);
    ctx.restore();

    if (hitNode) {
      const screen = worldToScreen({ x: hitNode.x, y: hitNode.y });
      const w = layout.nodeWidth * state.zoom;
      const h = layout.nodeHeight * state.zoom;
      const pad = layout.nodeHitPadding;
      ctx.save();
      ctx.strokeStyle = "rgba(255,0,0,0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(screen.x - pad, screen.y - pad, w + pad * 2, h + pad * 2);

      const r = layout.portHitRadius;
      for (const side of ["left", "right"]) {
        const p = worldToScreen(nodePortPos(hitNode, side));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = side === "left" ? "rgba(0,150,255,0.9)" : "rgba(255,200,0,0.9)";
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function hitPortAtNode(node, screenX, screenY) {
    return hitPort(node, screenX, screenY) || "";
  }

  function applyEmbeddedPayload(payload) {
    const normalized = buildEmbeddedDefinition(payload || {});
    if (!normalized.pieces.length) {
      return;
    }
    const incomingPuzzleId = String(normalized.puzzle_id || "").trim();
    const incomingFingerprint = `${incomingPuzzleId || "-"}::${getDefinitionSignature(normalized)}`;
    if (state.runtimeMode === "embedded" && state.lastInitFingerprint === incomingFingerprint) {
      resizeCanvas();
      draw();
      return;
    }
    state.runtimeMode = "embedded";
    if (document.body) {
      document.body.classList.add("puzzle-embedded");
    }
    if (document.documentElement) {
      document.documentElement.classList.add("puzzle-embedded");
    }
    state.puzzleId = incomingPuzzleId;
    state.lastInitFingerprint = incomingFingerprint;
    state.definition = normalized;
    updateStorageKey();
    if (el.submitBtn) {
      el.submitBtn.textContent = "提交";
    }
    const syncLayoutAndRestore = function () {
      resizeCanvas();
      const restored = applyPersistedState(readPersistedState());
      if (!restored) {
        setLockedState(false, null);
        resetPuzzle({ clearCache: false });
      } else {
        draw();
        if (state.locked) {
          setFeedback("success", "已恢复已提交拼图。");
        } else {
          setFeedback("default", "已恢复上次未完成拼图。");
        }
      }
    };
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () {
        requestAnimationFrame(syncLayoutAndRestore);
      });
    } else {
      syncLayoutAndRestore();
    }
  }

  function bindRuntimeMessages() {
    window.addEventListener("message", function (event) {
      const data = event && event.data;
      if (!data || typeof data !== "object") {
        return;
      }
      const msgType = String(data.type || "").trim();
      if (msgType === "nexora:puzzle:lock") {
        setLockedState(true, data.submission && typeof data.submission === "object" ? data.submission : null);
        writePersistedStateNow();
        draw();
        return;
      }
      if (msgType === "nexora:puzzle:unlock") {
        setLockedState(false, null);
        writePersistedStateNow();
        draw();
        return;
      }
      if (msgType !== "nexora:puzzle:init") {
        return;
      }
      applyEmbeddedPayload(data);
    });
  }

  function bind() {
    if (!el.canvas) {
      return;
    }
    el.canvas.addEventListener("pointerdown", handlePointerDown);
    el.canvas.addEventListener("pointerleave", handlePointerLeave);
    el.canvas.addEventListener("contextmenu", handleCanvasContextMenu);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    el.canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    window.addEventListener("resize", resizeCanvas);
    if (window.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(function () {
        resizeCanvas();
      });
      try {
        state.resizeObserver.observe(el.canvas);
      } catch (_) {}
    }
    if (el.submitBtn) {
      el.submitBtn.addEventListener("click", handlePrimaryAction);
    }
    if (el.resetViewBtn) {
      el.resetViewBtn.addEventListener("click", resetView);
    }
    if (el.resetPuzzleBtn) {
      el.resetPuzzleBtn.addEventListener("click", function () {
        resetPuzzle({ clearCache: true });
      });
    }
    bindRuntimeMessages();
  }

  function init() {
    updateStorageKey();
    const restored = applyPersistedState(readPersistedState());
    if (!restored) {
      resetPuzzle({ clearCache: false });
    }
    bind();
    resizeCanvas();
    if (restored) {
      draw();
      setFeedback("default", "已恢复上次未完成拼图。");
    }
  }

  init();
})();
