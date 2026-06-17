/**
 * 思维导图（知识图谱）前端渲染层。
 *
 * 对接后端思维导图 Agent（core/booksproc/mindmap.py）：
 *   - GET  /api/frontend/mindmap/{lectureId}              读取课程级导图
 *   - GET  /api/frontend/mindmap/{lectureId}/generate-stream  SSE 流式生成课程级导图
 *   - POST /api/frontend/mindmap/{lectureId}/section      生成 section 级详细子树
 *
 * 数据结构（与后端 mindmap.py 一致）：
 *   { course_title, chapters: [{ section_id, name, summary, concepts: [{ name, detail, children }] }] }
 *
 * 渲染采用 mermaid flowchart（而非 mindmap 语法），因为 flowchart 支持单节点着色、
 * 点击事件和右键菜单，更适合"知识点树 + 交互探索"场景。
 *
 * 交互：
 *   - 章节节点（type=chapter）点击 → 调 section API，右侧抽屉展示 section 级详细子树
 *   - 知识点节点（type=concept）点击 → 详情弹窗显示 detail
 *   - 任意节点右键 → 查看详情 / 让模型解释（postMessage 到父窗口）
 */
(function () {
    "use strict";

    var NXKG = {};

    // 当前课程级导图数据
    var currentGraph = null;
    // 当前激活的 EventSource（用于中断旧的流式请求）
    var currentEventSource = null;
    var contextMenu = null;
    var mermaidReady = false;
    var GRAPH_MIN_SCALE = 0.08;
    var GRAPH_MAX_SCALE = 2.6;

    // ==================== 工具函数 ====================

    async function nxlFetch(url, init) {
        var options = init && typeof init === "object" ? Object.assign({}, init) : {};
        var headers = new Headers(options.headers || {});
        var username = "";
        try { username = (window.state && window.state.username) || ""; } catch (_) {}
        if (username && !headers.has("X-Nexora-Username")) headers.set("X-Nexora-Username", username);
        if (typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        options.headers = headers;
        if (!options.credentials) options.credentials = "same-origin";
        var resp = await fetch(url, options);
        var text = await resp.text();
        if (!resp.ok) throw new Error(text || resp.statusText);
        return JSON.parse(text);
    }

    function escapeHtml(text) {
        var d = document.createElement("div");
        d.appendChild(document.createTextNode(String(text || "")));
        return d.innerHTML;
    }

    function normalizeLabelText(text, maxLength) {
        var raw = String(text || "")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();

        if (raw.length > maxLength) {
            return raw.slice(0, Math.max(0, maxLength - 3)) + "...";
        }

        return raw;
    }

    function formatMermLabel(text, maxLength, lineLength) {
        var label = normalizeLabelText(text, maxLength);
        var lines = [];

        for (var i = 0; i < label.length; i += lineLength) {
            lines.push(escapeHtml(label.slice(i, i + lineLength)).replace(/"/g, "'").replace(/[\[\]]/g, ""));
        }

        return lines.join("<br/>");
    }

    function collectGraphStats(graphData) {
        var chapters = Array.isArray(graphData.chapters) ? graphData.chapters : [];
        var conceptCount = 0;
        var childCount = 0;

        chapters.forEach(function (chapter) {
            var concepts = Array.isArray(chapter.concepts) ? chapter.concepts : [];
            conceptCount += concepts.length;

            concepts.forEach(function (concept) {
                var children = Array.isArray(concept.children) ? concept.children : [];
                childCount += children.length;
            });
        });

        return {
            chapters: chapters.length,
            concepts: conceptCount,
            children: childCount,
        };
    }

    function clampNumber(value, min, max) {
        var num = Number(value);
        if (!Number.isFinite(num)) return min;

        return Math.max(min, Math.min(max, num));
    }

    // ==================== Mermaid 定义构建 ====================

    /**
     * 把思维导图 JSON 树构建为 mermaid flowchart 定义 + 节点映射表。
     * 章节节点用 id CH{ci}，知识点用 CH{ci}K{ki}，子知识点用 CH{ci}K{ki}C{xi}。
     */
    function buildMermaidDef(graphData) {
        var chapters = graphData.chapters || [];
        if (!chapters.length) return null;

        var rootTitle = graphData.course_title || graphData.section_title || graphData.lecture_title || "知识导图";
        var lines = ["flowchart LR"];
        var nodeMap = {};
        var classLines = [
            "    classDef nxkgRoot fill:#eaf3ff,color:#102a43,stroke:#2f80ed,stroke-width:2px",
            "    classDef nxkgChapter fill:#fff7e6,color:#4a2c00,stroke:#d97706,stroke-width:1.8px",
            "    classDef nxkgConcept fill:#f1f5f9,color:#172033,stroke:#64748b,stroke-width:1.4px",
            "    classDef nxkgSub fill:#ecfdf5,color:#064e3b,stroke:#10b981,stroke-width:1.2px",
        ];

        nodeMap.ROOT = {
            label: rootTitle,
            detail: graphData.summary || graphData.description || "",
            type: "root",
            sectionId: "",
        };
        lines.push('    ROOT(["' + formatMermLabel(rootTitle, 42, 14) + '"])');
        classLines.push("    class ROOT nxkgRoot");

        for (var ci = 0; ci < chapters.length; ci++) {
            var ch = chapters[ci];
            var chId = "CH" + ci;
            nodeMap[chId] = {
                label: ch.name,
                detail: ch.summary || "",
                type: "chapter",
                sectionId: ch.section_id || "",
            };
            lines.push("    ROOT --> " + chId);
            lines.push("    " + chId + '(["' + formatMermLabel(ch.name, 52, 13) + '"])');
            classLines.push("    class " + chId + " nxkgChapter");

            var concepts = ch.concepts || [];
            for (var ki = 0; ki < concepts.length; ki++) {
                var kpId = chId + "K" + ki;
                nodeMap[kpId] = {
                    label: concepts[ki].name,
                    detail: concepts[ki].detail || "",
                    type: "concept",
                };
                lines.push("    " + chId + " --> " + kpId);
                lines.push("    " + kpId + '["' + formatMermLabel(concepts[ki].name, 46, 12) + '"]');
                classLines.push("    class " + kpId + " nxkgConcept");

                var children = concepts[ki].children || [];
                for (var xi = 0; xi < children.length; xi++) {
                    var cId = kpId + "C" + xi;
                    nodeMap[cId] = {
                        label: children[xi].name,
                        detail: children[xi].detail || "",
                        type: "concept",
                    };
                    lines.push("    " + kpId + " --> " + cId);
                    lines.push("    " + cId + '["' + formatMermLabel(children[xi].name, 42, 12) + '"]');
                    classLines.push("    class " + cId + " nxkgSub");
                }
            }
        }

        return { definition: lines.concat(classLines).join("\n"), nodeMap: nodeMap };
    }

    // ==================== 交互：详情弹窗 / 右键菜单 ====================

    function showDetailModal(name, detail) {
        var backdrop = document.getElementById("confirmBackdrop");
        var title = document.getElementById("confirmTitle");
        var body = document.getElementById("confirmBody");
        var okBtn = document.getElementById("confirmOkBtn");
        var cancelBtn = document.getElementById("confirmCancelBtn");
        if (!backdrop || !body) return;

        title.textContent = name;
        body.innerHTML = '<div class="nxkg-detail-content">' + escapeHtml(detail || "暂无详细说明") + '</div>';
        okBtn.textContent = "关闭";
        okBtn.onclick = function () {
            backdrop.style.display = "none";
            okBtn.textContent = "是";
            if (cancelBtn) cancelBtn.style.display = "";
        };
        if (cancelBtn) cancelBtn.style.display = "none";
        backdrop.style.display = "flex";
    }

    function explainConcept(name) {
        var promptText = "请解释这个概念：" + name;
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                source: "nexora-learning",
                type: "nexora:reader:ask-annotation",
                text: promptText
            }, "*");
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(promptText).then(function () {
                if (typeof window.showToast === "function") window.showToast("提示词已复制到剪贴板");
            });
        }
    }

    function showContextMenu(name, detail, x, y) {
        hideContextMenu();
        contextMenu = document.createElement("div");
        contextMenu.className = "nxkg-context-menu";
        contextMenu.style.left = x + "px";
        contextMenu.style.top = y + "px";

        if (detail) {
            var detailBtn = document.createElement("button");
            detailBtn.className = "nxkg-context-menu-item";
            detailBtn.textContent = "查看详情";
            detailBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                hideContextMenu();
                showDetailModal(name, detail);
            });
            contextMenu.appendChild(detailBtn);
        }

        var explainBtn = document.createElement("button");
        explainBtn.className = "nxkg-context-menu-item";
        explainBtn.textContent = "让模型解释";
        explainBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            hideContextMenu();
            explainConcept(name);
        });
        contextMenu.appendChild(explainBtn);

        document.body.appendChild(contextMenu);

        var rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + "px";
        if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + "px";
    }

    function hideContextMenu() {
        if (contextMenu && contextMenu.parentNode) contextMenu.parentNode.removeChild(contextMenu);
        contextMenu = null;
    }

    // ==================== SVG 节点事件绑定 ====================

    function bindSvgEvents(container, nodeMap, lectureId) {
        var svg = container.querySelector("svg");
        if (!svg) return;

        svg.addEventListener("click", function (e) {
            if (consumeGraphDragClick(container)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            var nodeEl = e.target.closest(".node");
            if (!nodeEl) return;
            var nodeId = extractNodeId(nodeEl, nodeMap);
            if (!nodeId || !nodeMap[nodeId]) return;
            var data = nodeMap[nodeId];

            // 章节节点：展开 section 级详细子树
            if (data.type === "chapter" && data.sectionId) {
                openSectionDrawer(lectureId, data.sectionId, data.label);
                return;
            }

            // 知识点节点：显示详情
            showDetailModal(data.label, data.detail);
        });

        svg.addEventListener("contextmenu", function (e) {
            var nodeEl = e.target.closest(".node");
            if (!nodeEl) return;
            var nodeId = extractNodeId(nodeEl, nodeMap);
            if (!nodeId || !nodeMap[nodeId]) return;
            e.preventDefault();
            var data = nodeMap[nodeId];
            showContextMenu(data.label, data.detail || "", e.clientX, e.clientY);
        });
    }

    function extractNodeId(nodeEl, nodeMap) {
        var svgId = nodeEl.id || "";
        var match = svgId.match(/^flowchart-(.+?)-\d+$/);
        if (match) return match[1];

        // Mermaid 版本差异导致 id 解析失败时，通过 label 文本反查。
        var labelEl = nodeEl.querySelector(".nodeLabel");
        if (labelEl) {
            var text = labelEl.textContent.trim();
            for (var key in nodeMap) {
                if (nodeMap.hasOwnProperty(key) && nodeMap[key].label === text) return key;
            }
        }
        return null;
    }

    function consumeGraphDragClick(container) {
        var board = container.querySelector(".nxkg-board");
        var viewport = board && board._nxkgViewport;

        if (!viewport || !viewport.dragMoved) {
            return false;
        }

        viewport.dragMoved = false;
        return true;
    }

    function parseSvgSize(svg) {
        if (!svg) {
            return { width: 1, height: 1 };
        }

        var viewBox = svg.viewBox && svg.viewBox.baseVal;
        if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
            return { width: viewBox.width, height: viewBox.height };
        }

        var width = Number.parseFloat(String(svg.getAttribute("width") || ""));
        var height = Number.parseFloat(String(svg.getAttribute("height") || ""));
        if (width > 0 && height > 0) {
            return { width: width, height: height };
        }

        try {
            var box = svg.getBBox();
            if (box && box.width > 0 && box.height > 0) {
                return { width: box.width, height: box.height };
            }
        } catch (_err) {}

        return { width: 1, height: 1 };
    }

    function getGraphViewport(container) {
        var board = container.querySelector(".nxkg-board");
        var canvas = container.querySelector("[data-nxkg-canvas]");
        var stage = container.querySelector("[data-nxkg-graph-stage]");
        var svg = stage ? stage.querySelector("svg") : null;

        if (!board || !canvas || !stage || !svg) {
            return null;
        }

        if (!board._nxkgViewport) {
            board._nxkgViewport = {
                scale: 1,
                x: 0,
                y: 0,
                dragging: false,
                dragMoved: false,
                startX: 0,
                startY: 0,
                startOffsetX: 0,
                startOffsetY: 0,
            };
        }

        return {
            board: board,
            canvas: canvas,
            stage: stage,
            svg: svg,
            state: board._nxkgViewport,
        };
    }

    function updateGraphToolbar(container) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        var valueEl = viewport.board.querySelector("[data-nxkg-zoom-value]");
        if (valueEl) {
            valueEl.textContent = Math.round(viewport.state.scale * 100) + "%";
        }

        var expandBtn = viewport.board.querySelector('[data-nxkg-view-action="toggle-fullscreen"]');
        if (expandBtn) {
            var expanded = viewport.board.classList.contains("is-expanded");
            expandBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
            expandBtn.setAttribute("title", expanded ? "退出全屏" : "全屏查看");
        }
    }

    function applyGraphTransform(container) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        viewport.stage.style.transform = "translate(" + viewport.state.x + "px, " + viewport.state.y + "px) scale(" + viewport.state.scale + ")";
        updateGraphToolbar(container);
    }

    function fitGraphViewport(container) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        var graphSize = parseSvgSize(viewport.svg);
        var rect = viewport.canvas.getBoundingClientRect();
        var canvasWidth = Math.max(1, rect.width);
        var canvasHeight = Math.max(1, rect.height);
        var padding = viewport.board.classList.contains("nxkg-board-compact") ? 28 : 40;
        var fitScale = Math.min(
            (canvasWidth - padding * 2) / graphSize.width,
            (canvasHeight - padding * 2) / graphSize.height
        );

        viewport.state.scale = clampNumber(fitScale, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
        viewport.state.x = Math.round((canvasWidth - graphSize.width * viewport.state.scale) / 2);
        viewport.state.y = Math.round((canvasHeight - graphSize.height * viewport.state.scale) / 2);
        applyGraphTransform(container);
    }

    function resetGraphViewport(container) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        var graphSize = parseSvgSize(viewport.svg);
        var rect = viewport.canvas.getBoundingClientRect();
        viewport.state.scale = 1;
        viewport.state.x = Math.round((Math.max(1, rect.width) - graphSize.width) / 2);
        viewport.state.y = Math.round((Math.max(1, rect.height) - graphSize.height) / 2);
        applyGraphTransform(container);
    }

    function zoomGraphViewport(container, factor, clientX, clientY) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        var oldScale = viewport.state.scale;
        var nextScale = clampNumber(oldScale * factor, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
        if (nextScale === oldScale) return;

        var rect = viewport.canvas.getBoundingClientRect();
        var originX = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
        var originY = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
        var graphX = (originX - viewport.state.x) / oldScale;
        var graphY = (originY - viewport.state.y) / oldScale;

        viewport.state.scale = nextScale;
        viewport.state.x = Math.round(originX - graphX * nextScale);
        viewport.state.y = Math.round(originY - graphY * nextScale);
        applyGraphTransform(container);
    }

    function bindGraphViewport(container) {
        var viewport = getGraphViewport(container);
        if (!viewport) return;

        viewport.board.addEventListener("click", function (event) {
            var target = event.target instanceof Element ? event.target : null;
            var actionBtn = target ? target.closest("[data-nxkg-view-action]") : null;

            if (!actionBtn || !viewport.board.contains(actionBtn)) {
                return;
            }

            var action = String(actionBtn.getAttribute("data-nxkg-view-action") || "").trim();
            event.preventDefault();
            event.stopPropagation();

            if (action === "zoom-in") {
                zoomGraphViewport(container, 1.18);
            } else if (action === "zoom-out") {
                zoomGraphViewport(container, 1 / 1.18);
            } else if (action === "fit") {
                fitGraphViewport(container);
            } else if (action === "actual") {
                resetGraphViewport(container);
            } else if (action === "toggle-fullscreen") {
                viewport.board.classList.toggle("is-expanded");
                document.body.classList.toggle("nxkg-board-expanded", viewport.board.classList.contains("is-expanded"));
                window.setTimeout(function () {
                    fitGraphViewport(container);
                }, 40);
            }
        });

        viewport.canvas.addEventListener("wheel", function (event) {
            event.preventDefault();
            zoomGraphViewport(container, event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
        }, { passive: false });

        viewport.canvas.addEventListener("pointerdown", function (event) {
            if (event.button !== 0) return;

            var target = event.target instanceof Element ? event.target : null;
            if (target && target.closest("[data-nxkg-view-action]")) return;

            viewport.state.dragging = true;
            viewport.state.dragMoved = false;
            viewport.state.startX = event.clientX;
            viewport.state.startY = event.clientY;
            viewport.state.startOffsetX = viewport.state.x;
            viewport.state.startOffsetY = viewport.state.y;
            viewport.canvas.classList.add("is-panning");
            viewport.canvas.setPointerCapture(event.pointerId);
        });

        viewport.canvas.addEventListener("pointermove", function (event) {
            if (!viewport.state.dragging) return;

            var dx = event.clientX - viewport.state.startX;
            var dy = event.clientY - viewport.state.startY;

            if (Math.abs(dx) + Math.abs(dy) > 3) {
                viewport.state.dragMoved = true;
            }

            viewport.state.x = Math.round(viewport.state.startOffsetX + dx);
            viewport.state.y = Math.round(viewport.state.startOffsetY + dy);
            applyGraphTransform(container);
            event.preventDefault();
        });

        function stopDrag(event) {
            if (!viewport.state.dragging) return;

            viewport.state.dragging = false;
            viewport.canvas.classList.remove("is-panning");
            try {
                viewport.canvas.releasePointerCapture(event.pointerId);
            } catch (_err) {}
        }

        viewport.canvas.addEventListener("pointerup", stopDrag);
        viewport.canvas.addEventListener("pointercancel", stopDrag);

        window.setTimeout(function () {
            fitGraphViewport(container);
        }, 30);
    }

    // ==================== Section 级抽屉 ====================

    /**
     * 打开右侧抽屉，调用 section API 生成该章节的详细思维导图子树。
     */
    async function openSectionDrawer(lectureId, sectionId, sectionName) {
        var drawer = ensureSectionDrawer();
        showSectionDrawerLoading(drawer, sectionName);

        try {
            var data = await nxlFetch("/api/frontend/mindmap/" + encodeURIComponent(lectureId) + "/section", {
                method: "POST",
                body: JSON.stringify({ section_id: sectionId }),
            });

            if (data && data.success && data.mindmap) {
                renderSectionDrawer(drawer, lectureId, sectionName, data.mindmap);
            } else {
                showSectionDrawerError(drawer, sectionName, (data && data.error) || "生成失败");
            }
        } catch (err) {
            showSectionDrawerError(drawer, sectionName, err.message || "请求失败");
        }
    }

    function ensureSectionDrawer() {
        var drawer = document.getElementById("nxkgSectionDrawer");
        if (drawer) return drawer;

        drawer = document.createElement("aside");
        drawer.id = "nxkgSectionDrawer";
        drawer.className = "nxkg-section-drawer";
        drawer.innerHTML =
            '<div class="nxkg-section-drawer-head">' +
            '<div class="nxkg-section-drawer-title"></div>' +
            '<button class="nxkg-section-drawer-close" type="button" aria-label="关闭">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
            '</button>' +
            '</div>' +
            '<div class="nxkg-section-drawer-body"></div>';
        document.body.appendChild(drawer);

        drawer.querySelector(".nxkg-section-drawer-close").addEventListener("click", function () {
            drawer.classList.remove("is-open");
        });

        return drawer;
    }

    function showSectionDrawerLoading(drawer, sectionName) {
        drawer.querySelector(".nxkg-section-drawer-title").textContent = sectionName;
        drawer.querySelector(".nxkg-section-drawer-body").innerHTML = '<div class="nxkg-loading">正在生成「' + escapeHtml(sectionName) + '」的详细知识点...</div>';
        drawer.classList.add("is-open");
    }

    function showSectionDrawerError(drawer, sectionName, message) {
        drawer.querySelector(".nxkg-section-drawer-title").textContent = sectionName;
        drawer.querySelector(".nxkg-section-drawer-body").innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml(message) + '</div>';
        drawer.classList.add("is-open");
    }

    async function renderSectionDrawer(drawer, lectureId, sectionName, mindmapData) {
        drawer.querySelector(".nxkg-section-drawer-title").textContent = sectionName;
        var body = drawer.querySelector(".nxkg-section-drawer-body");
        body.innerHTML = '<div class="nxkg-loading">渲染中...</div>';
        drawer.classList.add("is-open");

        var innerContainer = document.createElement("div");
        innerContainer.className = "nxkg-section-graph";
        body.innerHTML = "";
        body.appendChild(innerContainer);

        await renderGraph(innerContainer, mindmapData, lectureId);
    }

    // ==================== 渲染主流程 ====================

    function renderLegend() {
        return '<div class="nxkg-legend">' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-root"></span>课程主题</div>' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-chapter"></span>章节（点击展开）</div>' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-concept"></span>核心知识点</div>' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-sub"></span>子知识点</div>' +
            '<div class="nxkg-legend-hint">点击章节展开 · 点击知识点看详情 · 右键可操作</div>' +
            '</div>';
    }

    function renderGraphHeader(graphData, isSectionGraph) {
        var stats = collectGraphStats(graphData);
        var title = graphData.course_title || graphData.section_title || graphData.lecture_title || "知识导图";
        var subtitle = isSectionGraph ? "章节知识点展开" : "课程知识结构";

        return '<div class="nxkg-board-head">' +
            '<div class="nxkg-board-title-wrap">' +
            '<div class="nxkg-board-kicker">' + escapeHtml(subtitle) + '</div>' +
            '<h3 class="nxkg-board-title">' + escapeHtml(title) + '</h3>' +
            '</div>' +
            '<div class="nxkg-board-stats">' +
            '<span>章节 ' + stats.chapters + '</span>' +
            '<span>知识点 ' + stats.concepts + '</span>' +
            '<span>子知识点 ' + stats.children + '</span>' +
            '</div>' +
            '</div>';
    }

    function renderGraphToolbar() {
        return '<div class="nxkg-toolbar" aria-label="思维导图视图控制">' +
            '<button class="nxkg-toolbar-btn" type="button" data-nxkg-view-action="zoom-out" title="缩小" aria-label="缩小">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>' +
            '</button>' +
            '<span class="nxkg-zoom-value" data-nxkg-zoom-value>100%</span>' +
            '<button class="nxkg-toolbar-btn" type="button" data-nxkg-view-action="zoom-in" title="放大" aria-label="放大">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>' +
            '</button>' +
            '<button class="nxkg-toolbar-btn" type="button" data-nxkg-view-action="fit" title="适配视图" aria-label="适配视图">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>' +
            '</button>' +
            '<button class="nxkg-toolbar-btn" type="button" data-nxkg-view-action="actual" title="100% 居中" aria-label="100% 居中">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M2 12h4"></path><path d="M18 12h4"></path></svg>' +
            '</button>' +
            '<button class="nxkg-toolbar-btn" type="button" data-nxkg-view-action="toggle-fullscreen" title="全屏查看" aria-label="全屏查看" aria-pressed="false">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M8 21H3v-5"></path><path d="M16 21h5v-5"></path></svg>' +
            '</button>' +
            '</div>';
    }

    async function renderGraph(container, graphData, lectureId) {
        if (typeof mermaid === "undefined") {
            container.innerHTML = '<div class="nxkg-error">Mermaid 库未加载</div>';
            return;
        }

        if (!mermaidReady) {
            mermaid.initialize({
                startOnLoad: false,
                theme: "base",
                themeVariables: {
                    primaryColor: "#f8fafc",
                    primaryTextColor: "#172033",
                    primaryBorderColor: "#cbd5e1",
                    lineColor: "#b7c4d4",
                    fontSize: "13px",
                    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                },
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: "monotoneX",
                    rankSpacing: 76,
                    nodeSpacing: 34,
                },
            });
            mermaidReady = true;
        }

        container.classList.add("nxkg-container");

        var result = buildMermaidDef(graphData);
        if (!result || !result.definition) {
            container.innerHTML = '<div class="nxkg-empty-hint">暂无知识点数据</div>';
            return;
        }

        var graphId = "nxkg_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        try {
            var renderResult = await mermaid.render(graphId, result.definition);
            var isSectionGraph = container.classList.contains("nxkg-section-graph");
            container.innerHTML =
                '<section class="nxkg-board' + (isSectionGraph ? ' nxkg-board-compact' : '') + '">' +
                renderGraphHeader(graphData, isSectionGraph) +
                renderGraphToolbar() +
                '<div class="nxkg-canvas" data-nxkg-canvas>' +
                '<div class="nxkg-graph-wrapper">' +
                '<div class="nxkg-graph-stage" data-nxkg-graph-stage>' + renderResult.svg + '</div>' +
                '</div>' +
                '</div>' +
                renderLegend() +
                '</section>';
            bindSvgEvents(container, result.nodeMap, lectureId);
            bindGraphViewport(container);
        } catch (err) {
            console.error("Mermaid render error:", err);
            container.innerHTML = '<div class="nxkg-error">图谱渲染失败：' + escapeHtml(err.message || "未知错误") + '</div>';
        }
    }

    // ==================== 对外 API ====================

    /**
     * 加载课程级思维导图：先读已有，无则显示"生成"按钮。
     */
    NXKG.loadCourse = async function (lectureId) {
        var container = document.getElementById("courseMindmapContainer");
        if (!container) return;
        container.classList.add("nxkg-container");
        document.body.classList.remove("nxkg-board-expanded");

        // 中断可能进行中的流式请求
        NXKG.abortStream();

        var safeLectureId = String(lectureId || "").trim();
        if (!safeLectureId) {
            container.innerHTML = '<div class="nxkg-empty">暂无课程</div>';
            return;
        }

        container.innerHTML = '<div class="nxkg-loading">正在加载思维导图...</div>';

        try {
            var data = await nxlFetch("/api/frontend/mindmap/" + encodeURIComponent(safeLectureId));
            if (data && data.success && data.mindmap) {
                currentGraph = data.mindmap;
                container.innerHTML = "";
                await renderGraph(container, data.mindmap, safeLectureId);
            } else {
                showGenerateEntry(container, safeLectureId);
            }
        } catch (err) {
            // 404 表示尚未生成
            showGenerateEntry(container, safeLectureId);
        }
    };

    function showGenerateEntry(container, lectureId) {
        container.innerHTML =
            '<div class="nxkg-empty">' +
            '<div class="nxkg-empty-text">尚未生成课程思维导图</div>' +
            '<div class="nxkg-empty-sub">基于课程大纲自动梳理知识脉络，点击下方按钮生成</div>' +
            '<button class="nxkg-generate-btn" data-action="generate-mindmap" data-lecture-id="' + escapeHtml(lectureId) + '" type="button">生成思维导图</button>' +
            '</div>';
    }

    /**
     * 通过 SSE 流式生成课程级思维导图，实时显示模型活动。
     */
    NXKG.generateCourseStream = function (lectureId, onDone, onError) {
        var container = document.getElementById("courseMindmapContainer");
        if (!container) return;
        container.classList.add("nxkg-container");
        document.body.classList.remove("nxkg-board-expanded");

        var safeLectureId = String(lectureId || "").trim();
        if (!safeLectureId) return;

        // 中断旧的流式请求
        NXKG.abortStream();

        var lines = [];
        var draft = "";

        container.innerHTML =
            '<div class="nxkg-generating">' +
            '<section class="nxkg-generating-panel">' +
            '<div class="nxkg-generating-head">正在生成思维导图...</div>' +
            '<div class="nxkg-generating-sub">模型正在梳理课程大纲、章节关系和知识点层级</div>' +
            '<div class="nxkg-generating-lines" aria-live="polite"></div>' +
            '</section>' +
            '<section class="nxkg-generating-preview">' +
            '<div class="nxkg-generating-preview-head">' +
            '<span>流式草稿</span>' +
            '<span>实时更新</span>' +
            '</div>' +
            '<pre class="nxkg-generating-draft"></pre>' +
            '</section>' +
            '</div>';

        var linesEl = container.querySelector(".nxkg-generating-lines");
        var draftEl = container.querySelector(".nxkg-generating-draft");

        var url = "/api/frontend/mindmap/" + encodeURIComponent(safeLectureId) + "/generate-stream";
        var es = new EventSource(url);
        currentEventSource = es;

        function pushLine(text) {
            lines.push(text);
            if (lines.length > 20) lines.shift();
            if (linesEl) {
                linesEl.innerHTML = lines.map(function (l) {
                    return '<div class="nxkg-generating-line">' + escapeHtml(l) + '</div>';
                }).join("");
            }
        }

        function appendDraft(text) {
            draft += text;
            if (draftEl) {
                draftEl.textContent = draft.slice(-4000);
            }
        }

        es.addEventListener("status", function (e) {
            try {
                var p = JSON.parse(e.data || "{}");
                if (p && p.message) pushLine(p.message);
            } catch (_) {}
        });

        es.addEventListener("delta", function (e) {
            try {
                var p = JSON.parse(e.data || "{}");
                if (p && p.content) appendDraft(p.content);
            } catch (_) {}
        });

        es.addEventListener("done", function (e) {
            NXKG.abortStream();
            try {
                var p = JSON.parse(e.data || "{}");
                if (p && p.success && p.mindmap) {
                    currentGraph = p.mindmap;
                    container.innerHTML = "";
                    renderGraph(container, p.mindmap, safeLectureId);
                    if (typeof onDone === "function") onDone(p.mindmap);
                } else {
                    container.innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml((p && p.error) || "未知错误") + '</div>';
                    if (typeof onError === "function") onError((p && p.error) || "未知错误");
                }
            } catch (err) {
                container.innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml(err.message) + '</div>';
                if (typeof onError === "function") onError(err.message);
            }
        });

        es.addEventListener("error", function (e) {
            // EventSource 在连接关闭时也会触发 error，只在还有数据流时当作真错误
            if (es.readyState === EventSource.CLOSED) return;
            NXKG.abortStream();
            container.innerHTML = '<div class="nxkg-error">生成连接中断</div>';
            if (typeof onError === "function") onError("连接中断");
        });

        pushLine("已建立生成连接，等待模型输出...");
    };

    NXKG.abortStream = function () {
        if (currentEventSource) {
            try { currentEventSource.close(); } catch (_) {}
            currentEventSource = null;
        }
    };

    NXKG.reset = function () {
        currentGraph = null;
        NXKG.abortStream();
        hideContextMenu();
        var drawer = document.getElementById("nxkgSectionDrawer");
        if (drawer) drawer.classList.remove("is-open");
    };

    document.addEventListener("click", function () {
        hideContextMenu();
    });

    window.NXKG = NXKG;
})();
