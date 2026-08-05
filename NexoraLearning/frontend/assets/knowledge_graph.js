/*
 * 课程知识图谱（AntV G6 v5 章节扇区关系图）。
 *
 * 数据来源：/api/frontend/mindmap/<lecture_id> 返回扁平 nodes/edges 结构，
 * 附带 section_difficulty（大纲各章节的难度标注）。
 *
 * 视觉结构：课程名作为中心大节点，章节（课程蓝）与知识点按难度着色
 * （基础=入门绿 / 中等=进阶橙 / 进阶=高级红），由章节扇区向外分层展开；
 * 语义关系（前置/关联/延伸）以彩色弧线叠加在层级辐条之上。
 */
(function () {
    "use strict";

    var CENTER_NODE_ID = "nxkg_center";
    var ZOOM_MIN = 0.2;
    var ZOOM_MAX = 2.6;
    var WHEEL_ZOOM_SENSITIVITY = 0.0008;
    var VIEWPORT_ANIMATION = { duration: 320, easing: "ease-out" };
    var FIT_VIEW_ANIMATION = { duration: 520, easing: "ease-in-out" };

    // 各类节点的外观规格，size 为直径（px）
    var NODE_SPECS = {
        center: { size: 110, color: "#2f54eb", labelFill: "#ffffff", fontSize: 14, maxChars: 10, weight: 600 },
        chapter: { size: 56, color: "#1890ff", labelFill: "#25304a", fontSize: 12, maxChars: 10, weight: 600 },
        concept: { size: 36, color: "#52c41a", labelFill: "#3c465e", fontSize: 11, maxChars: 7, weight: 500 },
        sub: { size: 28, color: "#52c41a", labelFill: "#3c465e", fontSize: 11, maxChars: 8, weight: 500 },
    };

    // 大纲 difficulty 取值 → 节点颜色与图例文案
    var DIFFICULTY_META = {
        "基础": { color: "#52c41a", label: "入门" },
        "中等": { color: "#fa8c16", label: "进阶" },
        "进阶": { color: "#f5222d", label: "高级" },
    };
    var DIFFICULTY_ORDER = ["基础", "中等", "进阶"];
    var UNLABELED_META = { color: "#9aa7b6", label: "未标注" };
    var CHAPTER_META = { color: "#1890ff", label: "课程" };

    // 语义关系（与关系浏览器时期保持一致的配色）
    var RELATIONS = {
        prerequisite: { label: "前置", color: "#1971c2" },
        related: { label: "关联", color: "#7048e8" },
        extends: { label: "延伸", color: "#0f9f6e" },
    };
    var HIERARCHY_EDGE_COLOR = "#c2cfdc";

    var state = {
        graph: null,
        lectureId: "",
        sectionDifficulty: {},
        eventSource: null,
        focusedNodeId: "",
        searchMatchIds: null,
        g6Graph: null,
        keydownHandler: null,
        wheelHandler: null,
        wheelAnimationFrame: null,
        wheelZoomTarget: null,
        wheelZoomOrigin: null,
    };

    function escapeHtml(value) {
        var element = document.createElement("div");
        element.appendChild(document.createTextNode(String(value || "")));
        return element.innerHTML;
    }

    async function nxlFetch(url, init) {
        var options = init && typeof init === "object" ? Object.assign({}, init) : {};
        var headers = new Headers(options.headers || {});
        var username = "";

        try {
            username = (window.state && window.state.username) || "";
        } catch (_) {}

        if (username && !headers.has("X-Nexora-Username")) {
            headers.set("X-Nexora-Username", username);
        }

        options.headers = headers;
        options.credentials = options.credentials || "same-origin";

        var response = await fetch(url, options);
        var text = await response.text();

        if (!response.ok) {
            throw new Error(text || response.statusText);
        }

        return JSON.parse(text);
    }

    function createIcon(name) {
        var paths = {
            close: ["M6 6l12 12", "M18 6L6 18"],
            reset: ["M4 8V4h4", "M4 4l4 4", "M5 15a7 7 0 1 0 2-9"],
            plus: ["M12 5v14", "M5 12h14"],
            minus: ["M5 12h14"],
        };
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");

        (paths[name] || []).forEach(function (path) {
            var element = document.createElementNS("http://www.w3.org/2000/svg", "path");

            element.setAttribute("d", path);
            svg.appendChild(element);
        });

        return svg.outerHTML;
    }

    function getNodeMap(nodes) {
        var nodeMap = {};

        nodes.forEach(function (node) {
            if (node && node.id) {
                nodeMap[node.id] = node;
            }
        });

        return nodeMap;
    }

    /**
     * 旧版树形 chapters 结构迁移为扁平 nodes/edges，
     * 保证历史数据与新版 mindmap.json 走同一条渲染链路。
     */
    function migrateLegacyGraph(mindmap) {
        if (Array.isArray(mindmap.nodes)) {
            return mindmap;
        }

        var nodes = [];
        var edges = [];

        (mindmap.chapters || []).forEach(function (chapter, chapterIndex) {
            var chapterId = chapter.section_id || ("chapter_" + chapterIndex);

            nodes.push({
                id: chapterId,
                label: chapter.name || "未命名章节",
                type: "chapter",
                detail: chapter.summary || "",
                parent: "",
            });

            (chapter.concepts || []).forEach(function (concept, conceptIndex) {
                var conceptId = chapterId + "_concept_" + conceptIndex;

                nodes.push({
                    id: conceptId,
                    label: concept.name || "未命名知识点",
                    type: "concept",
                    detail: concept.detail || "",
                    parent: chapterId,
                });
                edges.push({ source: chapterId, target: conceptId, type: "hierarchy", label: "" });

                (concept.children || []).forEach(function (child, childIndex) {
                    var childId = conceptId + "_child_" + childIndex;

                    nodes.push({
                        id: childId,
                        label: child.name || "未命名知识点",
                        type: "sub",
                        detail: child.detail || "",
                        parent: conceptId,
                    });
                    edges.push({ source: conceptId, target: childId, type: "hierarchy", label: "" });
                });
            });
        });

        return {
            course_title: mindmap.course_title || "课程知识图谱",
            nodes: nodes,
            edges: edges,
        };
    }

    function normalizeGraph(mindmap) {
        var graph = migrateLegacyGraph(mindmap || {});
        var nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(function (node) {
            return node && node.id;
        }) : [];
        var nodeMap = getNodeMap(nodes);
        var edges = Array.isArray(graph.edges) ? graph.edges.filter(function (edge) {
            return edge && edge.source && edge.target && nodeMap[edge.source] && nodeMap[edge.target];
        }) : [];

        return {
            course_title: graph.course_title || graph.lecture_title || "课程知识图谱",
            nodes: nodes,
            edges: edges,
        };
    }

    function nodeKindOf(node) {
        if (node.type === "chapter") {
            return "chapter";
        }

        return node.type === "sub" ? "sub" : "concept";
    }

    function getChapterForNode(node, nodeMap) {
        var current = node;

        while (current && current.parent) {
            current = nodeMap[current.parent];
        }

        return current && current.type === "chapter" ? current : null;
    }

    function getNodeDepth(node, nodeMap) {
        var depth = 1;
        var current = node;
        var visited = {};

        while (current && current.parent && !visited[current.parent]) {
            visited[current.parent] = true;
            current = nodeMap[current.parent];
            depth += 1;
        }

        return depth;
    }

    function resolveDifficultyMeta(rawDifficulty) {
        var meta = DIFFICULTY_META[String(rawDifficulty || "").trim()];

        return meta || UNLABELED_META;
    }

    function truncateLabel(label, maxChars) {
        var text = String(label || "未命名知识点");

        return text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
    }

    function getContainer() {
        return document.getElementById("courseMindmapContainer");
    }

    /**
     * 把扁平 mindmap 转换为 G6 v5 数据：
     * 补充虚拟课程中心节点与 中心→章节 辐条，其余层级/语义边原样保留。
     */
    function buildG6Data(graph, sectionDifficulty) {
        var nodeMap = getNodeMap(graph.nodes);
        var nodes = [{
            id: CENTER_NODE_ID,
            data: {
                kind: "center",
                label: graph.course_title,
                detail: "",
                difficulty: "",
                depth: 0,
                chapterId: "",
                parentId: "",
            },
        }];
        var hierarchyEdges = [];
        var semanticEdges = [];
        var seenEdgeKeys = {};
        var edgeIndex = 0;

        graph.nodes.forEach(function (node) {
            var kind = nodeKindOf(node);
            var chapter = kind === "chapter" ? node : getChapterForNode(node, nodeMap);

            nodes.push({
                id: node.id,
                data: {
                    kind: kind,
                    label: node.label,
                    detail: node.detail,
                    difficulty: chapter ? String(sectionDifficulty[chapter.id] || "") : "",
                    depth: getNodeDepth(node, nodeMap),
                    chapterId: chapter ? chapter.id : "",
                    parentId: node.parent || "",
                },
            });

            if (kind === "chapter") {
                hierarchyEdges.push({
                    id: "nxkg_center_edge_" + edgeIndex,
                    source: CENTER_NODE_ID,
                    target: node.id,
                    data: { kind: "hierarchy" },
                });
                edgeIndex += 1;
            }
        });

        graph.edges.forEach(function (edge) {
            var edgeKind = edge.type || "hierarchy";
            var key = edge.source + ">" + edge.target + ">" + edgeKind;

            if (seenEdgeKeys[key]) {
                return;
            }

            seenEdgeKeys[key] = true;
            var targetEdges = edgeKind === "hierarchy" ? hierarchyEdges : semanticEdges;

            targetEdges.push({
                id: "nxkg_edge_" + edgeIndex,
                source: edge.source,
                target: edge.target,
                data: { kind: edgeKind, label: edge.label },
            });
            edgeIndex += 1;
        });

        return {
            nodes: nodes,
            hierarchyEdges: hierarchyEdges,
            semanticEdges: semanticEdges,
        };
    }

    function getNodeSpec(datum) {
        return NODE_SPECS[datum.data.kind] || NODE_SPECS.concept;
    }

    function getNodeColor(datum) {
        var kind = datum.data.kind;

        if (kind === "center") {
            return NODE_SPECS.center.color;
        }

        if (kind === "chapter") {
            return CHAPTER_META.color;
        }

        return resolveDifficultyMeta(datum.data.difficulty).color;
    }

    function getEdgeColor(kind) {
        var relation = RELATIONS[kind];

        return relation ? relation.color : HIERARCHY_EDGE_COLOR;
    }

    function buildTooltipHtml(items) {
        var item = items && items[0];

        if (!item || !item.data) {
            return "";
        }

        // 边数据带 source/target，节点数据没有
        if (item.source !== undefined) {
            var relation = RELATIONS[item.data.kind];

            if (!relation) {
                return "";
            }

            return '<div class="nxkg-tooltip"><div class="nxkg-tooltip-title">' +
                escapeHtml(relation.label) + "关系</div></div>";
        }

        var detail = String(item.data.detail || "").trim();

        return '<div class="nxkg-tooltip">' +
            '<div class="nxkg-tooltip-title">' + escapeHtml(item.data.label || "知识点") + "</div>" +
            (detail ? '<div class="nxkg-tooltip-detail">' + escapeHtml(detail) + "</div>" : "") +
            "</div>";
    }

    async function createG6Graph(g6Data) {
        var mount = getContainer().querySelector("[data-nxkg-canvas]");
        var positionedNodes = window.NXKnowledgeGraphLayout.createChapterSectorLayout(g6Data.nodes);

        var g6Graph = new G6.Graph({
            container: mount,
            data: {
                nodes: positionedNodes,
                edges: g6Data.hierarchyEdges,
            },
            transforms: [{ type: "process-parallel-edges", offset: 18 }],
            node: {
                type: "circle",
                style: {
                    size: function (datum) { return getNodeSpec(datum).size; },
                    fill: function (datum) { return getNodeColor(datum); },
                    stroke: "#ffffff",
                    lineWidth: function (datum) { return datum.data.kind === "center" ? 3 : 2; },
                    shadowColor: "rgba(15, 31, 61, 0.16)",
                    shadowBlur: 10,
                    shadowOffsetY: 3,
                    cursor: "pointer",
                    labelText: function (datum) {
                        return truncateLabel(datum.data.label, getNodeSpec(datum).maxChars);
                    },
                    labelPlacement: function (datum) {
                        return datum.data.labelPlacement;
                    },
                    labelFill: function (datum) { return getNodeSpec(datum).labelFill; },
                    labelFontSize: function (datum) { return getNodeSpec(datum).fontSize; },
                    labelFontWeight: function (datum) { return getNodeSpec(datum).weight; },
                    labelBackground: true,
                    labelBackgroundFill: function (datum) {
                        return datum.data.kind === "center" ? "transparent" : "rgba(255, 255, 255, 0.86)";
                    },
                    labelBackgroundRadius: 3,
                    labelPadding: [1, 4, 1, 4],
                },
                state: {
                    selected: {
                        stroke: "#10234f",
                        lineWidth: 4,
                        labelFontWeight: 700,
                        halo: true,
                        haloFill: "#2f54eb",
                        haloOpacity: 0.18,
                        haloLineWidth: 10,
                    },
                    highlight: {
                        stroke: "#10234f",
                        lineWidth: 3,
                        halo: true,
                        haloFill: "#5b8ff9",
                        haloOpacity: 0.1,
                        haloLineWidth: 7,
                    },
                },
                animation: {
                    enter: [{
                        fields: ["opacity"],
                        from: { opacity: 0 },
                        to: { opacity: 1 },
                        duration: 420,
                        easing: "ease-out",
                    }],
                    update: [{
                        fields: ["stroke", "lineWidth", "haloOpacity"],
                        duration: 180,
                        easing: "ease-out",
                    }],
                },
            },
            edge: {
                type: function (datum) {
                    return datum.data.kind === "hierarchy" ? "line" : "quadratic";
                },
                style: {
                    stroke: function (datum) { return getEdgeColor(datum.data.kind); },
                    lineWidth: function (datum) { return datum.data.kind === "hierarchy" ? 1.3 : 1.8; },
                    opacity: function (datum) { return datum.data.kind === "hierarchy" ? 0.85 : 0.62; },
                    lineDash: function (datum) { return datum.data.kind === "related" ? [5, 5] : undefined; },
                    endArrow: function (datum) {
                        return datum.data.kind === "prerequisite" || datum.data.kind === "extends";
                    },
                    endArrowSize: 6,
                    endArrowFill: function (datum) { return getEdgeColor(datum.data.kind); },
                },
                state: {
                    highlight: { opacity: 1, lineWidth: 2.6 },
                },
                animation: {
                    enter: [{
                        fields: ["opacity"],
                        from: { opacity: 0 },
                        duration: 360,
                        easing: "ease-out",
                    }],
                    update: [{
                        fields: ["opacity", "lineWidth"],
                        duration: 180,
                        easing: "ease-out",
                    }],
                },
            },
            behaviors: [
                "drag-canvas",
                {
                    type: "zoom-canvas",
                    trigger: ["pinch"],
                    sensitivity: 0.45,
                    animation: VIEWPORT_ANIMATION,
                },
                "drag-element",
            ],
            plugins: [
                {
                    type: "tooltip",
                    trigger: "hover",
                    getContent: buildTooltipHtml,
                },
            ],
        });

        g6Graph.on("node:click", function (event) {
            focusNode(event.target.id);
        });

        g6Graph.on("canvas:click", function () {
            clearFocus();
        });

        state.g6Graph = g6Graph;
        bindSmoothWheelZoom(mount, g6Graph);
        await g6Graph.render();

        if (state.g6Graph !== g6Graph) {
            return;
        }

        if (g6Data.semanticEdges.length) {
            g6Graph.addEdgeData(g6Data.semanticEdges);
            await g6Graph.draw();
        }

        if (state.g6Graph === g6Graph) {
            await fitView(g6Graph);
        }
    }

    function destroyG6Graph() {
        unbindSmoothWheelZoom();

        if (!state.g6Graph) {
            return;
        }

        state.g6Graph.destroy();
        state.g6Graph = null;
    }

    function clampZoom(zoom) {
        return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    }

    function unbindSmoothWheelZoom() {
        var mount = getContainer() && getContainer().querySelector("[data-nxkg-canvas]");

        if (mount && state.wheelHandler) {
            mount.removeEventListener("wheel", state.wheelHandler);
        }

        if (state.wheelAnimationFrame) {
            window.cancelAnimationFrame(state.wheelAnimationFrame);
        }

        state.wheelHandler = null;
        state.wheelAnimationFrame = null;
        state.wheelZoomTarget = null;
        state.wheelZoomOrigin = null;
    }

    /**
     * G6 默认滚轮每次直接应用完整 delta，触控板与鼠标滚轮都会出现跳变。
     * 这里把 delta 归一化、限制单帧跨度，并通过视口动画平滑缩放到指针位置。
     */
    function bindSmoothWheelZoom(mount, g6Graph) {
        state.wheelHandler = function (event) {
            event.preventDefault();

            var delta = event.deltaY;

            if (event.deltaMode === 1) {
                delta *= 16;
            } else if (event.deltaMode === 2) {
                delta *= mount.clientHeight;
            }

            delta = Math.max(-120, Math.min(120, delta));
            var currentTarget = state.wheelZoomTarget === null
                ? g6Graph.getZoom()
                : state.wheelZoomTarget;
            var bounds = mount.getBoundingClientRect();

            state.wheelZoomTarget = clampZoom(
                currentTarget * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)
            );
            state.wheelZoomOrigin = [event.clientX - bounds.left, event.clientY - bounds.top];

            if (state.wheelAnimationFrame) {
                return;
            }

            state.wheelAnimationFrame = window.requestAnimationFrame(function () {
                var targetZoom = state.wheelZoomTarget;
                var origin = state.wheelZoomOrigin;

                state.wheelAnimationFrame = null;

                if (state.g6Graph === g6Graph) {
                    g6Graph.zoomTo(targetZoom, { duration: 160, easing: "ease-out" }, origin);
                }
            });
        };

        mount.addEventListener("wheel", state.wheelHandler, { passive: false });
    }

    function zoomByFactor(factor) {
        if (!state.g6Graph) {
            return;
        }

        var targetZoom = clampZoom(state.g6Graph.getZoom() * factor);

        state.wheelZoomTarget = targetZoom;
        state.g6Graph.zoomTo(targetZoom, VIEWPORT_ANIMATION);
    }

    async function fitView(graph) {
        var targetGraph = graph || state.g6Graph;

        if (!targetGraph || state.g6Graph !== targetGraph) {
            return;
        }

        state.wheelZoomTarget = null;
        await targetGraph.fitView({
            padding: 72,
            duration: FIT_VIEW_ANIMATION.duration,
            easing: FIT_VIEW_ANIMATION.easing,
        });
    }

    function getNeighborIds(nodeId) {
        var neighbors = {};

        if (nodeId === CENTER_NODE_ID) {
            state.graph.nodes.forEach(function (node) {
                if (node.type === "chapter") {
                    neighbors[node.id] = true;
                }
            });

            return neighbors;
        }

        state.graph.edges.forEach(function (edge) {
            if (edge.source === nodeId) {
                neighbors[edge.target] = true;
            }

            if (edge.target === nodeId) {
                neighbors[edge.source] = true;
            }
        });

        var node = getNodeMap(state.graph.nodes)[nodeId];

        // 章节与课程中心之间存在虚拟辐条边（不在原始 edges 里）
        if (node && node.type === "chapter") {
            neighbors[CENTER_NODE_ID] = true;
        }

        return neighbors;
    }

    /**
     * 图上高亮的唯一入口：根据当前焦点与搜索命中集合统一计算
     * 每个节点/边的状态，避免多处改写状态造成漂移。
     */
    function applyGraphStates() {
        var g6Graph = state.g6Graph;

        if (!g6Graph) {
            return;
        }

        var focusId = state.focusedNodeId;
        var matches = state.searchMatchIds;
        var emphasizedIds = {};

        if (matches) {
            Object.keys(matches).forEach(function (id) {
                emphasizedIds[id] = true;
            });
        } else if (focusId) {
            emphasizedIds[focusId] = true;

            var neighbors = getNeighborIds(focusId);

            Object.keys(neighbors).forEach(function (id) {
                emphasizedIds[id] = true;
            });
        }

        var hasEmphasis = Object.keys(emphasizedIds).length > 0;

        g6Graph.getNodeData().forEach(function (datum) {
            var id = datum.id;
            var nextState = "";

            if (hasEmphasis) {
                if (focusId && id === focusId) {
                    nextState = "selected";
                } else if (emphasizedIds[id]) {
                    nextState = "highlight";
                }
            }

            g6Graph.setElementState(id, nextState ? [nextState] : []);
        });

        g6Graph.getEdgeData().forEach(function (datum) {
            var nextState = "";

            if (hasEmphasis) {
                var touchesFocus = focusId && (datum.source === focusId || datum.target === focusId);
                var bothEndsEmphasized = emphasizedIds[datum.source] && emphasizedIds[datum.target];

                if (touchesFocus) {
                    nextState = "highlight";
                } else if (matches && bothEndsEmphasized) {
                    nextState = "highlight";
                }
            }

            g6Graph.setElementState(datum.id, nextState ? [nextState] : []);
        });
    }

    function getRelations(nodeId) {
        var nodeMap = getNodeMap(state.graph.nodes);
        var relations = [];

        state.graph.edges.forEach(function (edge) {
            var otherId = edge.source === nodeId ? edge.target : (edge.target === nodeId ? edge.source : "");

            if (!otherId || !nodeMap[otherId]) {
                return;
            }

            relations.push({ node: nodeMap[otherId], edge: edge });
        });

        var node = nodeMap[nodeId];

        if (nodeId === CENTER_NODE_ID) {
            state.graph.nodes.forEach(function (chapter) {
                if (chapter.type === "chapter") {
                    relations.push({ node: chapter, edge: { type: "hierarchy" } });
                }
            });
        } else if (node && node.type === "chapter") {
            relations.push({
                node: { id: CENTER_NODE_ID, label: state.graph.course_title, type: "center" },
                edge: { type: "hierarchy" },
            });
        }

        return relations;
    }

    function relationMeta(item) {
        var relation = RELATIONS[item.edge.type];

        if (relation) {
            return { label: relation.label, cssClass: item.edge.type };
        }

        if (item.node.type === "center") {
            return { label: "所属课程", cssClass: "hierarchy" };
        }

        if (item.node.type === "chapter") {
            return { label: "所属章节", cssClass: "hierarchy" };
        }

        return { label: "知识点", cssClass: "hierarchy" };
    }

    function buildInspectorBadge(node) {
        var typeLabel = "知识点";

        if (node.type === "center") {
            typeLabel = "课程";
        } else if (node.type === "chapter") {
            typeLabel = "章节";
        }

        var badge = '<span class="nxkg-inspector-type">' + typeLabel + "</span>";

        if (node.type !== "center") {
            var chapter = node.type === "chapter"
                ? node
                : getChapterForNode(node, getNodeMap(state.graph.nodes));
            var rawDifficulty = chapter ? String(state.sectionDifficulty[chapter.id] || "") : "";

            if (rawDifficulty) {
                var meta = resolveDifficultyMeta(rawDifficulty);

                badge += '<span class="nxkg-difficulty-chip" style="background:' + meta.color + '">' +
                    meta.label + "</span>";
            }
        }

        return '<div class="nxkg-inspector-badges">' + badge + "</div>";
    }

    function renderInspector() {
        var container = getContainer();
        var card = container && container.querySelector("[data-nxkg-inspector]");

        if (!card) {
            return;
        }

        if (!state.focusedNodeId) {
            card.hidden = true;
            card.innerHTML = "";
            return;
        }

        var node = state.focusedNodeId === CENTER_NODE_ID
            ? { id: CENTER_NODE_ID, label: state.graph.course_title, detail: "", type: "center" }
            : getNodeMap(state.graph.nodes)[state.focusedNodeId];

        if (!node) {
            card.hidden = true;
            card.innerHTML = "";
            return;
        }

        var relations = getRelations(node.id);
        var relationsMarkup = relations.length ? relations.map(function (item) {
            var meta = relationMeta(item);

            return '<button class="nxkg-relation-item" type="button" data-node-focus="' +
                escapeHtml(item.node.id) + '">' +
                '<span class="nxkg-relation-type nxkg-relation-type-' + escapeHtml(meta.cssClass) + '">' +
                escapeHtml(meta.label) + "</span>" +
                '<span class="nxkg-relation-name">' + escapeHtml(item.node.label || "知识点") + "</span>" +
                (item.edge.label ? '<span class="nxkg-relation-note">' + escapeHtml(item.edge.label) + "</span>" : "") +
                "</button>";
        }).join("") : '<div class="nxkg-relations-empty">暂无直接关联</div>';

        var detail = String(node.detail || "").trim();

        card.innerHTML = '<div class="nxkg-inspector-content">' +
            '<div class="nxkg-inspector-heading">' +
            buildInspectorBadge(node) +
            '<button class="nxkg-inspector-close" type="button" data-action="clear-focus" title="关闭详情" aria-label="关闭详情">' +
            createIcon("close") + "</button>" +
            "</div>" +
            '<h3 class="nxkg-inspector-title">' + escapeHtml(node.label || "知识点") + "</h3>" +
            (detail ? '<p class="nxkg-inspector-detail">' + escapeHtml(detail) + "</p>" : "") +
            '<div class="nxkg-relations">' +
            '<div class="nxkg-relations-title">直接关联</div>' +
            relationsMarkup +
            "</div>" +
            "</div>";
        card.hidden = false;
    }

    function focusNode(nodeId) {
        if (!state.g6Graph) {
            return;
        }

        resetSearchState();
        state.focusedNodeId = nodeId;
        applyGraphStates();
        renderInspector();
        state.g6Graph.focusElement(nodeId, VIEWPORT_ANIMATION);
    }

    function clearFocus() {
        if (!state.focusedNodeId) {
            return;
        }

        state.focusedNodeId = "";
        applyGraphStates();
        renderInspector();
    }

    function performSearch() {
        var container = getContainer();
        var input = container && container.querySelector("[data-search-input]");
        var hint = container && container.querySelector("[data-search-hint]");
        var keyword = input ? input.value.trim().toLowerCase() : "";

        if (!keyword) {
            clearSearch();
            return;
        }

        var matches = {};
        var matchCount = 0;

        state.graph.nodes.forEach(function (node) {
            if (String(node.label || "").toLowerCase().indexOf(keyword) !== -1) {
                matches[node.id] = true;
                matchCount += 1;
            }
        });

        state.searchMatchIds = matches;

        // 唯一命中时直接聚焦并平移到该节点
        if (matchCount === 1) {
            var matchId = Object.keys(matches)[0];

            state.focusedNodeId = matchId;
            state.g6Graph.focusElement(matchId, VIEWPORT_ANIMATION);
        }

        applyGraphStates();
        renderInspector();

        if (hint) {
            hint.textContent = matchCount ? matchCount + " 个匹配" : "无匹配结果";
            hint.classList.toggle("nxkg-search-hint-empty", !matchCount);
        }
    }

    function resetSearchState() {
        var container = getContainer();
        var input = container && container.querySelector("[data-search-input]");
        var hint = container && container.querySelector("[data-search-hint]");

        state.searchMatchIds = null;

        if (input) {
            input.value = "";
        }

        if (hint) {
            hint.textContent = "";
            hint.classList.remove("nxkg-search-hint-empty");
        }
    }

    function clearSearch() {
        // 清空搜索即"恢复全图"：搜索建立的焦点一并清除
        resetSearchState();
        state.focusedNodeId = "";

        applyGraphStates();
        renderInspector();
    }

    function renderLegend() {
        var container = getContainer();
        var legend = container && container.querySelector("[data-nxkg-legend]");

        if (!legend) {
            return;
        }

        var nodeMap = getNodeMap(state.graph.nodes);
        var hasUnlabeled = false;

        state.graph.nodes.forEach(function (node) {
            if (nodeKindOf(node) === "chapter") {
                return;
            }

            var chapter = getChapterForNode(node, nodeMap);
            var rawDifficulty = chapter ? String(state.sectionDifficulty[chapter.id] || "") : "";

            if (resolveDifficultyMeta(rawDifficulty) === UNLABELED_META) {
                hasUnlabeled = true;
            }
        });

        function legendItem(color, label) {
            return '<div class="nxkg-legend-item">' +
                '<span class="nxkg-legend-dot" style="background:' + color + '"></span>' +
                label + "</div>";
        }

        var html = legendItem(CHAPTER_META.color, CHAPTER_META.label);

        DIFFICULTY_ORDER.forEach(function (key) {
            html += legendItem(DIFFICULTY_META[key].color, DIFFICULTY_META[key].label);
        });

        if (hasUnlabeled) {
            html += legendItem(UNLABELED_META.color, UNLABELED_META.label);
        }

        legend.innerHTML = html;
    }

    /**
     * 课程下拉列表：允许在图谱面板内直接切换课程，
     * 列表加载失败时隐藏下拉，不影响图谱主体。
     */
    async function loadCourseOptions(currentLectureId) {
        var select = getContainer() && getContainer().querySelector("[data-course-select]");

        if (!select) {
            return;
        }

        try {
            var data = await nxlFetch("/api/lectures");
            var lectures = data && Array.isArray(data.lectures) ? data.lectures : [];
            var liveSelect = getContainer() && getContainer().querySelector("[data-course-select]");

            if (!liveSelect) {
                return;
            }

            liveSelect.innerHTML = lectures.map(function (lecture) {
                var id = String(lecture.id || "");
                var title = String(lecture.title || "未命名课程");

                return '<option value="' + escapeHtml(id) + '"' +
                    (id === currentLectureId ? " selected" : "") + ">" +
                    escapeHtml(title) + "</option>";
            }).join("");
        } catch (_) {
            select.hidden = true;
        }
    }

    function renderBoardShell() {
        var graph = state.graph;
        var container = getContainer();
        var conceptCount = graph.nodes.length;
        var relationCount = graph.edges.filter(function (edge) {
            return edge.type !== "hierarchy";
        }).length;

        container.innerHTML = '<section class="nxkg-board nxkg-board-fullscreen">' +
            '<header class="nxkg-board-head">' +
            '<div class="nxkg-board-title-wrap">' +
            '<div class="nxkg-board-kicker">知识图谱</div>' +
            '<h2 class="nxkg-board-title">' + escapeHtml(graph.course_title) + "</h2>" +
            "</div>" +
            '<div class="nxkg-board-tools">' +
            '<select class="nxkg-course-select" data-course-select="true" aria-label="切换课程"></select>' +
            '<div class="nxkg-search-wrap">' +
            '<input class="nxkg-search-input" data-search-input="true" type="search" placeholder="搜索知识点..." aria-label="搜索知识点">' +
            '<button class="nxkg-search-btn" type="button" data-action="search">搜索</button>' +
            "</div>" +
            '<span class="nxkg-search-hint" data-search-hint="true"></span>' +
            "</div>" +
            '<div class="nxkg-board-stats"><span>' + conceptCount + " 个知识点</span><span>" +
            relationCount + " 条关系</span></div>" +
            '<div class="nxkg-board-controls">' +
            '<button class="nxkg-toolbar-btn" type="button" data-action="fit-view" title="重置视图" aria-label="重置视图">' + createIcon("reset") + "</button>" +
            '<button class="nxkg-toolbar-btn" type="button" data-action="zoom-out" title="缩小" aria-label="缩小">' + createIcon("minus") + "</button>" +
            '<button class="nxkg-toolbar-btn" type="button" data-action="zoom-in" title="放大" aria-label="放大">' + createIcon("plus") + "</button>" +
            '<button class="nxkg-toolbar-btn" type="button" data-action="close-graph" title="关闭" aria-label="关闭">' + createIcon("close") + "</button>" +
            "</div>" +
            "</header>" +
            '<div class="nxkg-workspace">' +
            '<div class="nxkg-canvas">' +
            '<div class="nxkg-g6-mount" data-nxkg-canvas="true" aria-label="课程知识图谱"></div>' +
            '<div class="nxkg-legend" data-nxkg-legend="true"></div>' +
            '<aside class="nxkg-inspector-card" data-nxkg-inspector="true" hidden></aside>' +
            "</div>" +
            "</div>" +
            "</section>";

        bindBoardControls(container);
    }

    function bindBoardControls(container) {
        container.addEventListener("click", function (event) {
            var button = event.target.closest("[data-action], [data-node-focus]");

            if (!button) {
                return;
            }

            var focusId = button.getAttribute("data-node-focus");

            if (focusId) {
                focusNode(focusId);
                return;
            }

            var action = button.getAttribute("data-action");

            if (action === "zoom-in") {
                zoomByFactor(1.12);
            } else if (action === "zoom-out") {
                zoomByFactor(0.9);
            } else if (action === "fit-view") {
                fitView();
            } else if (action === "clear-focus") {
                clearFocus();
            } else if (action === "close-graph") {
                closeGraph();
            } else if (action === "search") {
                performSearch();
            } else if (action === "generate-mindmap") {
                var lectureId = button.getAttribute("data-lecture-id");

                if (lectureId) {
                    NXKG.generateCourseStream(lectureId);
                }
            }
        });

        var courseSelect = container.querySelector("[data-course-select]");

        if (courseSelect) {
            courseSelect.addEventListener("change", function () {
                if (courseSelect.value) {
                    NXKG.loadCourse(courseSelect.value);
                }
            });
        }

        var searchInput = container.querySelector("[data-search-input]");

        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    performSearch();
                }
            });

            // 清空输入框立即恢复全图显示
            searchInput.addEventListener("input", function () {
                if (!searchInput.value.trim()) {
                    clearSearch();
                }
            });
        }
    }

    function closeGraph() {
        var container = getContainer();

        NXKG.reset();

        if (container) {
            container.classList.remove("nxkg-container");
            container.innerHTML = "";
        }
    }

    function renderGraph(mindmap, lectureId, sectionDifficulty) {
        state.graph = normalizeGraph(mindmap);
        state.lectureId = lectureId || "";
        state.sectionDifficulty = sectionDifficulty || {};
        state.focusedNodeId = "";
        state.searchMatchIds = null;

        if (!state.graph.nodes.length) {
            showGenerateEntry(lectureId);
            return;
        }

        destroyG6Graph();
        renderBoardShell();
        void createG6Graph(buildG6Data(state.graph, state.sectionDifficulty));
        renderLegend();
        loadCourseOptions(state.lectureId);
    }

    function showGenerateEntry(lectureId) {
        var container = getContainer();

        container.innerHTML = '<div class="nxkg-empty">' +
            '<div class="nxkg-empty-text">尚未生成课程知识图谱</div>' +
            '<button class="nxkg-generate-btn" type="button" data-action="generate-mindmap" data-lecture-id="' +
            escapeHtml(lectureId) + '">生成知识图谱</button>' +
            "</div>";
        bindBoardControls(container);
    }

    function showGeneratingState() {
        var container = getContainer();

        container.innerHTML = '<div class="nxkg-generating">' +
            '<section class="nxkg-generating-panel">' +
            '<div class="nxkg-generating-head">正在生成知识图谱...</div>' +
            '<div class="nxkg-generating-lines" aria-live="polite"></div>' +
            "</section>" +
            '<section class="nxkg-generating-preview">' +
            '<div class="nxkg-generating-preview-head">流式草稿</div>' +
            '<pre class="nxkg-generating-draft"></pre>' +
            "</section>" +
            "</div>";
    }

    function installEscapeHandler() {
        if (state.keydownHandler) {
            document.removeEventListener("keydown", state.keydownHandler);
        }

        state.keydownHandler = function (event) {
            if (event.key !== "Escape") {
                return;
            }

            clearSearch();
            clearFocus();
        };
        document.addEventListener("keydown", state.keydownHandler);
    }

    var NXKG = {};

    NXKG.loadCourse = async function (lectureId) {
        var container = getContainer();

        if (!container) {
            return;
        }

        NXKG.abortStream();
        container.classList.add("nxkg-container");

        var safeLectureId = String(lectureId || "").trim();

        if (!safeLectureId) {
            container.innerHTML = '<div class="nxkg-empty">暂无课程</div>';
            return;
        }

        container.innerHTML = '<div class="nxkg-loading">正在加载知识图谱...</div>';

        try {
            var data = await nxlFetch("/api/frontend/mindmap/" + encodeURIComponent(safeLectureId));

            if (data && data.success && data.mindmap) {
                renderGraph(data.mindmap, safeLectureId, data.section_difficulty);
                installEscapeHandler();
            } else {
                showGenerateEntry(safeLectureId);
            }
        } catch (_) {
            showGenerateEntry(safeLectureId);
        }
    };

    NXKG.generateCourseStream = function (lectureId, onDone, onError) {
        var container = getContainer();
        var safeLectureId = String(lectureId || "").trim();

        if (!container || !safeLectureId || state.eventSource) {
            return;
        }

        showGeneratingState();

        var lines = [];
        var draft = "";
        var linesElement = container.querySelector(".nxkg-generating-lines");
        var draftElement = container.querySelector(".nxkg-generating-draft");
        var eventSource = new EventSource(
            "/api/frontend/mindmap/" + encodeURIComponent(safeLectureId) + "/generate-stream"
        );

        state.eventSource = eventSource;

        function pushLine(message) {
            lines.push(message);

            if (lines.length > 20) {
                lines.shift();
            }

            if (linesElement) {
                linesElement.innerHTML = lines.map(function (line) {
                    return '<div class="nxkg-generating-line">' + escapeHtml(line) + "</div>";
                }).join("");
            }
        }

        function fail(message) {
            NXKG.abortStream();
            container.innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml(message) + "</div>";

            if (typeof onError === "function") {
                onError(message);
            }
        }

        eventSource.addEventListener("status", function (event) {
            try {
                var payload = JSON.parse(event.data || "{}");

                if (payload.message) {
                    pushLine(payload.message);
                }
            } catch (_) {}
        });

        eventSource.addEventListener("ping", function (event) {
            try {
                var payload = JSON.parse(event.data || "{}");

                if (payload.message) {
                    pushLine(payload.message);
                }
            } catch (_) {}
        });

        eventSource.addEventListener("delta", function (event) {
            try {
                var payload = JSON.parse(event.data || "{}");

                if (!payload.content) {
                    return;
                }

                draft += payload.content;

                if (draftElement) {
                    draftElement.textContent = draft.slice(-4000);
                }
            } catch (_) {}
        });

        eventSource.addEventListener("done", function (event) {
            try {
                var payload = JSON.parse(event.data || "{}");

                if (!payload.success || !payload.mindmap) {
                    throw new Error(payload.error || "知识图谱生成失败");
                }

                NXKG.abortStream();
                renderGraph(payload.mindmap, safeLectureId, payload.section_difficulty);
                installEscapeHandler();

                if (typeof onDone === "function") {
                    onDone(payload.mindmap);
                }
            } catch (error) {
                fail(error.message);
            }
        });

        eventSource.addEventListener("error", function (event) {
            if (eventSource.readyState === EventSource.CLOSED) {
                return;
            }

            var message = "生成连接中断";

            try {
                var payload = JSON.parse((event && event.data) || "{}");

                message = String(payload.error || message);
            } catch (_) {}

            fail(message);
        });

        pushLine("已建立生成连接，等待模型输出...");
    };

    NXKG.abortStream = function () {
        if (!state.eventSource) {
            return;
        }

        state.eventSource.close();
        state.eventSource = null;
    };

    NXKG.reset = function () {
        NXKG.abortStream();
        destroyG6Graph();

        if (state.keydownHandler) {
            document.removeEventListener("keydown", state.keydownHandler);
        }

        state.graph = null;
        state.lectureId = "";
        state.sectionDifficulty = {};
        state.focusedNodeId = "";
        state.searchMatchIds = null;
        state.keydownHandler = null;
    };

    window.NXKG = NXKG;
    window.NexoraKnowledgeGraph = NXKG;
}());
