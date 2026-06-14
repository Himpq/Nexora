(function () {
    "use strict";

    var NXKG = {};
    var currentGraph = null;
    var contextMenu = null;
    var mermaidReady = false;

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

    function escMerm(text) {
        return String(text || "").replace(/"/g, "'").replace(/[\[\]]/g, "").replace(/\n/g, " ").substring(0, 60);
    }

    function getStatus(name) {
        if (!currentGraph || !currentGraph.user_profile) return "unseen";
        var p = currentGraph.user_profile;
        if (Array.isArray(p.mastered) && p.mastered.indexOf(name) >= 0) return "mastered";
        if (Array.isArray(p.weak) && p.weak.indexOf(name) >= 0) return "weak";
        return "unseen";
    }

    function statusFill(status) {
        switch (status) {
            case "mastered": return "fill:#16a34a,color:#fff,stroke:#15803d";
            case "weak": return "fill:#ea580c,color:#fff,stroke:#c2410c";
            default: return "fill:#9ca3af,color:#fff,stroke:#6b7280";
        }
    }

    function buildMermaidDef(graphData) {
        var chapters = graphData.chapters || [];
        if (!chapters.length) return "";

        var lines = ["flowchart TD"];
        var nodeMap = {};

        for (var ci = 0; ci < chapters.length; ci++) {
            var ch = chapters[ci];
            var chId = "CH" + ci;
            nodeMap[chId] = { label: ch.name, type: "chapter" };
            lines.push("    " + chId + '["' + escMerm(ch.name) + '"]');
            lines.push("    style " + chId + " fill:#111,color:#fff,stroke:#111");

            var concepts = ch.concepts || [];
            for (var ki = 0; ki < concepts.length; ki++) {
                var kpId = chId + "K" + ki;
                nodeMap[kpId] = { label: concepts[ki].name, detail: concepts[ki].detail || "", type: "concept" };
                lines.push("    " + chId + " --> " + kpId);
                lines.push("    " + kpId + '["' + escMerm(concepts[ki].name) + '"]');

                var st = getStatus(concepts[ki].name);
                lines.push("    style " + kpId + " " + statusFill(st));

                var children = concepts[ki].children || [];
                for (var xi = 0; xi < children.length; xi++) {
                    var cId = kpId + "C" + xi;
                    nodeMap[cId] = { label: children[xi].name, detail: children[xi].detail || "", type: "concept" };
                    lines.push("    " + kpId + " --> " + cId);
                    lines.push("    " + cId + '["' + escMerm(children[xi].name) + '"]');
                    var cst = getStatus(children[xi].name);
                    lines.push("    style " + cId + " " + statusFill(cst));
                }
            }
        }

        return { definition: lines.join("\n"), nodeMap: nodeMap };
    }

    function showDetailModal(name, detail) {
        var backdrop = document.getElementById("confirmBackdrop");
        var title = document.getElementById("confirmTitle");
        var body = document.getElementById("confirmBody");
        var okBtn = document.getElementById("confirmOkBtn");
        var cancelBtn = document.getElementById("confirmCancelBtn");
        if (!backdrop || !body) return;

        title.textContent = name;
        body.innerHTML = '<div class="nxkg-detail-content">' + escapeHtml(detail).replace(/\n/g, "<br>") + '</div>';
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

    function bindSvgEvents(container, nodeMap) {
        var svg = container.querySelector("svg");
        if (!svg) return;

        svg.addEventListener("click", function (e) {
            var nodeEl = e.target.closest(".node");
            if (!nodeEl) return;
            var nodeId = extractNodeId(nodeEl);
            if (!nodeId || !nodeMap[nodeId]) return;
            var data = nodeMap[nodeId];
            if (data.detail) showDetailModal(data.label, data.detail);
        });

        svg.addEventListener("contextmenu", function (e) {
            var nodeEl = e.target.closest(".node");
            if (!nodeEl) return;
            var nodeId = extractNodeId(nodeEl);
            if (!nodeId || !nodeMap[nodeId]) return;
            e.preventDefault();
            var data = nodeMap[nodeId];
            showContextMenu(data.label, data.detail || "", e.clientX, e.clientY);
        });
    }

    function extractNodeId(nodeEl) {
        var svgId = nodeEl.id || "";
        var match = svgId.match(/^flowchart-(.+?)-\d+$/);
        if (match) return match[1];

        var labelEl = nodeEl.querySelector(".nodeLabel");
        if (labelEl && currentGraph) {
            var text = labelEl.textContent.trim();
            var chapters = currentGraph.chapters || [];
            for (var ci = 0; ci < chapters.length; ci++) {
                if (chapters[ci].name === text) return "CH" + ci;
                var concepts = chapters[ci].concepts || [];
                for (var ki = 0; ki < concepts.length; ki++) {
                    if (concepts[ki].name === text) return "CH" + ci + "K" + ki;
                    var children = concepts[ki].children || [];
                    for (var xi = 0; xi < children.length; xi++) {
                        if (children[xi].name === text) return "CH" + ci + "K" + ki + "C" + xi;
                    }
                }
            }
        }
        return null;
    }

    function renderLegend() {
        return '<div class="nxkg-legend">' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-mastered"></span>已掌握</div>' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-weak"></span>薄弱</div>' +
            '<div class="nxkg-legend-item"><span class="nxkg-dot nxkg-unseen"></span>未学习</div>' +
            '<div class="nxkg-legend-hint">点击节点查看详情 · 右键可操作</div>' +
            '</div>';
    }

    async function renderGraph(container, graphData) {
        if (typeof mermaid === "undefined") {
            container.innerHTML = '<div class="nxkg-error">Mermaid 库未加载</div>';
            return;
        }

        if (!mermaidReady) {
            mermaid.initialize({
                startOnLoad: false,
                theme: "base",
                themeVariables: {
                    primaryColor: "#111",
                    primaryTextColor: "#fff",
                    primaryBorderColor: "#111",
                    lineColor: "#c0c0c0",
                    fontSize: "13px",
                },
                flowchart: {
                    useMaxWidth: false,
                    htmlLabels: true,
                    curve: "basis",
                    rankdir: "TB",
                },
            });
            mermaidReady = true;
        }

        var result = buildMermaidDef(graphData);
        if (!result || !result.definition) {
            container.innerHTML = '<div class="nxkg-empty-hint">暂无知识点数据</div>';
            return;
        }

        var graphId = "nxkg_" + Date.now();
        try {
            var renderResult = await mermaid.render(graphId, result.definition);
            container.innerHTML = '<div class="nxkg-graph-wrapper">' + renderResult.svg + '</div>';
            container.insertAdjacentHTML("beforeend", renderLegend());
            bindSvgEvents(container, result.nodeMap);
        } catch (err) {
            console.error("Mermaid render error:", err);
            container.innerHTML = '<div class="nxkg-error">图谱渲染失败：' + escapeHtml(err.message || "未知错误") + '</div>';
        }
    }

    NXKG.load = async function (lectureId, bookId) {
        var container = document.getElementById("courseHomeGraphContainer");
        if (!container) return;

        container.innerHTML = '<div class="nxkg-loading">正在加载知识图谱...</div>';

        try {
            var data = await nxlFetch(
                "/api/frontend/knowledge-graph?lecture_id=" + encodeURIComponent(lectureId) +
                "&book_id=" + encodeURIComponent(bookId)
            );

            if (data && data.success && data.graph) {
                currentGraph = data.graph;
                await renderGraph(container, data.graph);
            } else {
                container.innerHTML =
                    '<div class="nxkg-empty">' +
                    '<div class="nxkg-empty-text">暂无知识图谱</div>' +
                    '<button class="nxkg-generate-btn" data-lecture-id="' + escapeHtml(lectureId) +
                    '" data-book-id="' + escapeHtml(bookId) + '">生成知识图谱</button>' +
                    '</div>';
                bindGenerateButton(container, lectureId, bookId);
            }
        } catch (err) {
            container.innerHTML = '<div class="nxkg-error">加载失败：' + escapeHtml(err.message || "未知错误") + '</div>';
        }
    };

    function bindGenerateButton(container, lectureId, bookId) {
        var btn = container.querySelector(".nxkg-generate-btn");
        if (!btn) return;
        btn.addEventListener("click", async function () {
            btn.disabled = true;
            btn.textContent = "正在生成...";
            try {
                var data = await nxlFetch("/api/frontend/knowledge-graph/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lecture_id: lectureId, book_id: bookId }),
                });
                if (data && data.success && data.graph) {
                    currentGraph = data.graph;
                    await renderGraph(container, data.graph);
                } else {
                    container.innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml(data.error || "未知错误") + '</div>';
                }
            } catch (err) {
                container.innerHTML = '<div class="nxkg-error">生成失败：' + escapeHtml(err.message || "未知错误") + '</div>';
            }
        });
    }

    NXKG.reset = function () {
        currentGraph = null;
        hideContextMenu();
    };

    document.addEventListener("click", function () {
        hideContextMenu();
    });

    window.NXKG = NXKG;
})();
