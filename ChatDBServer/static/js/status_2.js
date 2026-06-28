(function () {
    "use strict";

    let statusData = createEmptyStatusData();

    function createEmptyStatusData() {
        return {
            snapshotAt: "-",
            loadErrorMessage: "",
            source: "ChatDBServer/data/users/*/{token_usage,tool_usage,conversations} + ChatDBServer/data/papi/*/{token_log,image_log}.jsonl",
            totals: {
                tokens: 0,
                modelCalls: 0,
                toolCalls: 0,
                toolFailures: 0
            },
            imageStats: {
                requests: 0,
                successes: 0,
                failures: 0,
                images: 0,
                recent24hRequests: 0,
                recent24hImages: 0
            },
            complexity: {
                simple: 0,
                medium: 0,
                complex: 0
            },
            models: [],
            speedModels: [],
            speedWindowDays: 30,
            speedMinSamples: 3,
            toolFailures: [],
            recent24h: [],
            recent24hWindowHours: 24
        };
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function clearNode(node) {
        if (!node) {
            return;
        }

        node.replaceChildren();
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);

        if (className) {
            element.className = className;
        }

        if (text !== undefined) {
            element.textContent = String(text);
        }

        return element;
    }

    function positiveNumber(value) {
        const numberValue = Number(value || 0);

        if (!Number.isFinite(numberValue)) {
            return 0;
        }

        return Math.max(0, numberValue);
    }

    function normalizeComplexityLoad(raw) {
        const source = raw && typeof raw === "object" ? raw : {};

        return {
            simple: positiveNumber(source.simple),
            medium: positiveNumber(source.medium),
            complex: positiveNumber(source.complex)
        };
    }

    function normalizeImageStats(raw) {
        const source = raw && typeof raw === "object" ? raw : {};

        return {
            requests: positiveNumber(source.requests),
            successes: positiveNumber(source.successes),
            failures: positiveNumber(source.failures),
            images: positiveNumber(source.images),
            recent24hRequests: positiveNumber(source.recent24hRequests),
            recent24hImages: positiveNumber(source.recent24hImages)
        };
    }

    function complexityLoadTotal(load) {
        const normalized = normalizeComplexityLoad(load);

        return normalized.simple + normalized.medium + normalized.complex;
    }

    function deriveComplexityLoadFromToolCalls(rawToolCalls) {
        const calls = positiveNumber(rawToolCalls);

        if (calls <= 0) {
            return { simple: 0, medium: 0, complex: 0 };
        }

        if (calls <= 2) {
            return { simple: 1, medium: 0, complex: 0 };
        }

        if (calls <= 7) {
            return { simple: 0, medium: 1, complex: 0 };
        }

        return { simple: 0, medium: 0, complex: 1 };
    }

    function normalizeModelRow(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const load = normalizeComplexityLoad(source.complexityLoad);

        return {
            id: String(source.id || source.name || "unknown"),
            name: String(source.name || source.id || "unknown"),
            provider: String(source.provider || "unknown"),
            icon: String(source.icon || ""),
            score: positiveNumber(source.score),
            callCount: positiveNumber(source.callCount),
            toolCalls: positiveNumber(source.toolCalls),
            totalTokens: positiveNumber(source.totalTokens),
            successRate: positiveNumber(source.successRate),
            tokenCoverage: positiveNumber(source.tokenCoverage),
            complexityLoad: load
        };
    }

    function normalizeRecentRow(raw) {
        const source = raw && typeof raw === "object" ? raw : {};

        return {
            id: String(source.id || source.name || "unknown"),
            name: String(source.name || source.id || "unknown"),
            provider: String(source.provider || "unknown"),
            icon: String(source.icon || ""),
            score: positiveNumber(source.score),
            recentCalls: positiveNumber(source.recentCalls),
            recentTokens: positiveNumber(source.recentTokens)
        };
    }

    function normalizeSpeedRow(raw) {
        const source = raw && typeof raw === "object" ? raw : {};

        return {
            id: String(source.id || source.name || "unknown"),
            name: String(source.name || source.id || "unknown"),
            provider: String(source.provider || "unknown"),
            icon: String(source.icon || ""),
            score: positiveNumber(source.score),
            avgTTFTMs: positiveNumber(source.avgTTFTMs),
            avgOutputTPS: positiveNumber(source.avgOutputTPS),
            samples: positiveNumber(source.samples)
        };
    }

    function normalizeToolFailureRow(raw) {
        const source = raw && typeof raw === "object" ? raw : {};

        return {
            name: String(source.name || "unknown"),
            note: String(source.note || ""),
            count: positiveNumber(source.count)
        };
    }

    function normalizeStatusData(raw) {
        const source = raw && typeof raw === "object" ? raw : {};
        const models = Array.isArray(source.models) ? source.models.map(normalizeModelRow) : [];
        const complexity = normalizeComplexityLoad(source.complexity);

        if (complexityLoadTotal(complexity) <= 0 && models.length > 0) {
            models.forEach((item) => {
                let load = normalizeComplexityLoad(item.complexityLoad);

                if (complexityLoadTotal(load) <= 0) {
                    load = deriveComplexityLoadFromToolCalls(item.toolCalls);
                    item.complexityLoad = load;
                }

                complexity.simple += load.simple;
                complexity.medium += load.medium;
                complexity.complex += load.complex;
            });
        }

        return {
            snapshotAt: String(source.snapshotAt || "-"),
            loadErrorMessage: "",
            source: String(source.source || "ChatDBServer/data/users/*/{token_usage,tool_usage,conversations} + ChatDBServer/data/papi/*/{token_log,image_log}.jsonl"),
            totals: {
                tokens: positiveNumber(source.totals && source.totals.tokens),
                modelCalls: positiveNumber(source.totals && source.totals.modelCalls),
                toolCalls: positiveNumber(source.totals && source.totals.toolCalls),
                toolFailures: positiveNumber(source.totals && source.totals.toolFailures)
            },
            imageStats: normalizeImageStats(source.imageStats),
            complexity,
            models,
            speedModels: Array.isArray(source.speedModels) ? source.speedModels.map(normalizeSpeedRow) : [],
            speedWindowDays: positiveNumber(source.speedWindowDays) || 30,
            speedMinSamples: positiveNumber(source.speedMinSamples) || 3,
            toolFailures: Array.isArray(source.toolFailures) ? source.toolFailures.map(normalizeToolFailureRow) : [],
            recent24h: Array.isArray(source.recent24h) ? source.recent24h.map(normalizeRecentRow) : [],
            recent24hWindowHours: positiveNumber(source.recent24hWindowHours) || 24
        };
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("en-US");
    }

    function formatCompactNumber(value) {
        const numberValue = positiveNumber(value);

        if (numberValue >= 1000000) {
            return `${formatDecimal(numberValue / 1000000, 1)}M`;
        }

        if (numberValue >= 10000) {
            return `${formatDecimal(numberValue / 1000, 1)}K`;
        }

        return formatNumber(numberValue);
    }

    function formatDecimal(value, digits) {
        return positiveNumber(value).toLocaleString("en-US", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    function formatPercent(value) {
        return `${formatDecimal(value, 1)}%`;
    }

    function clampPercent(value) {
        const numberValue = Number(value);

        if (!Number.isFinite(numberValue)) {
            return 0;
        }

        return Math.max(0, Math.min(100, numberValue));
    }

    function setProgressWidth(element, value) {
        element.style.width = `${clampPercent(value)}%`;
    }

    function isSafeImageUrl(source) {
        const value = String(source || "").trim();
        const secure = window.NexoraSecureRender || {};

        if (!value) {
            return false;
        }

        if (typeof secure.isSafeUrl === "function") {
            return secure.isSafeUrl(value, true);
        }

        try {
            const url = new URL(value, window.location.origin);
            return ["http:", "https:"].includes(url.protocol) || value.startsWith("/");
        } catch (error) {
            return false;
        }
    }

    function createProviderIcon(item) {
        const icon = String(item && item.icon ? item.icon : "").trim();

        if (!isSafeImageUrl(icon)) {
            return null;
        }

        const image = createElement("img", "provider-icon");
        image.src = icon;
        image.alt = String(item.provider || "provider");
        image.loading = "lazy";
        image.decoding = "async";

        return image;
    }

    function appendModelName(parent, item, className) {
        const wrapper = createElement("div", className);
        const icon = createProviderIcon(item);
        const name = createElement("span", "", item.name);

        if (icon) {
            wrapper.appendChild(icon);
        }

        wrapper.appendChild(name);
        parent.appendChild(wrapper);

        return wrapper;
    }

    function appendEmptyState(root, message) {
        clearNode(root);
        root.appendChild(createElement("div", "empty-hint", message));
    }

    function updateHero() {
        const heroText = byId("heroStatusText");

        if (!heroText) {
            return;
        }

        if (statusData.loadErrorMessage) {
            heroText.textContent = statusData.loadErrorMessage;
            return;
        }

        heroText.textContent = "按模型调用、Token 消耗、工具表现、速度样本和任务复杂度整理当前模型状态。";
    }

    function renderSummary() {
        const root = byId("summaryGrid");

        if (!root) {
            return;
        }

        const totals = statusData.totals;
        const imageStats = statusData.imageStats;
        const imageHint = `${formatNumber(imageStats.requests)} 次请求 · ${formatNumber(imageStats.failures)} 次失败`;
        const cards = [
            ["总 Token", formatNumber(totals.tokens), formatCompactNumber(totals.tokens), "样本内累计输入与输出"],
            ["模型调用", formatNumber(totals.modelCalls), formatCompactNumber(totals.modelCalls), "按模型响应计数"],
            ["工具调用", formatNumber(totals.toolCalls), formatCompactNumber(totals.toolCalls), "真实任务执行强度"],
            ["生图统计", formatNumber(imageStats.images), formatCompactNumber(imageStats.images), imageHint]
        ];

        clearNode(root);

        cards.forEach(([label, fullValue, compactValue, hint]) => {
            const card = createElement("div", "metric-tile");
            const metricValue = createElement("strong");

            metricValue.title = fullValue;
            metricValue.appendChild(createElement("span", "metric-value-full", fullValue));
            metricValue.appendChild(createElement("span", "metric-value-compact", compactValue));
            card.appendChild(createElement("span", "", label));
            card.appendChild(metricValue);
            card.appendChild(createElement("small", "", hint));
            root.appendChild(card);
        });
    }

    function renderLeaderCard() {
        const root = byId("leaderCard");

        if (!root) {
            return;
        }

        clearNode(root);

        if (!statusData.models.length) {
            root.appendChild(createElement("div", "empty-hint", "暂无可用的模型榜首数据。"));
            return;
        }

        const leader = statusData.models[0];
        const rank = createElement("div", "leader-rank");
        rank.appendChild(createElement("span", "", "综合榜首"));
        rank.appendChild(createElement("strong", "leader-score", formatNumber(leader.score)));

        const main = createElement("div", "leader-main");
        appendModelName(main, leader, "leader-name");
        main.appendChild(createElement("p", "model-meta", `${leader.provider} · ${formatNumber(leader.callCount)} 次调用 · ${formatNumber(leader.totalTokens)} tokens`));

        const stats = createElement("div", "leader-stats");
        const statItems = [
            ["成功率", formatPercent(leader.successRate)],
            ["工具调用", formatNumber(leader.toolCalls)],
            ["Token 覆盖", formatPercent(leader.tokenCoverage)]
        ];

        statItems.forEach(([label, value]) => {
            const item = createElement("div", "leader-stat");
            item.appendChild(createElement("span", "", label));
            item.appendChild(createElement("strong", "", value));
            stats.appendChild(item);
        });

        root.appendChild(rank);
        root.appendChild(main);
        root.appendChild(stats);
    }

    function renderRankList() {
        const root = byId("rankList");
        const rows = Array.isArray(statusData.models) ? statusData.models : [];

        if (!root) {
            return;
        }

        if (!rows.length) {
            appendEmptyState(root, "暂无模型排名数据。");
            return;
        }

        const maxScore = Math.max(...rows.map((item) => positiveNumber(item.score)), 1);
        clearNode(root);

        rows.forEach((item, index) => {
            const card = createElement("div", "rank-card");
            const body = createElement("div");
            const score = createElement("div", "score-pill", formatNumber(item.score));
            const track = createElement("div", "progress-track");
            const bar = createElement("span");

            setProgressWidth(bar, positiveNumber(item.score) / maxScore * 100);
            track.appendChild(bar);

            card.appendChild(createElement("div", "rank-index", `#${index + 1}`));
            appendModelName(body, item, "model-name");
            body.appendChild(track);
            body.appendChild(createElement("div", "row-meta", `${item.provider} · ${formatNumber(item.callCount)} calls · ${formatNumber(item.totalTokens)} tokens`));
            card.appendChild(body);
            card.appendChild(score);
            root.appendChild(card);
        });
    }

    function createDataRow(options) {
        const row = createElement("div", options.className || "data-row");
        const body = createElement("div");
        const value = createElement("div", "row-value", options.value);
        const track = createElement("div", "progress-track");
        const bar = createElement("span");

        row.appendChild(createElement("div", "row-index", options.indexText));
        appendModelName(body, options.item, "row-name");
        setProgressWidth(bar, options.width);
        track.appendChild(bar);
        body.appendChild(track);
        body.appendChild(createElement("div", "row-meta", options.meta));
        row.appendChild(body);
        row.appendChild(value);

        return row;
    }

    function renderRecent24h() {
        const root = byId("recent24hList");
        const rows = Array.isArray(statusData.recent24h) ? statusData.recent24h : [];

        if (!root) {
            return;
        }

        if (!rows.length) {
            appendEmptyState(root, "近 24 小时暂无调用数据。");
            return;
        }

        const maxScore = Math.max(...rows.map((item) => positiveNumber(item.score)), 1);
        clearNode(root);

        rows.forEach((item, index) => {
            root.appendChild(createDataRow({
                indexText: `#${index + 1}`,
                item,
                value: formatNumber(item.score),
                width: positiveNumber(item.score) / maxScore * 100,
                meta: `${item.provider} · ${formatNumber(item.recentCalls)} calls · ${formatNumber(item.recentTokens)} tokens`
            }));
        });
    }

    function renderTokenChart() {
        const root = byId("tokenChart");
        const rows = [...statusData.models].sort((a, b) => positiveNumber(b.totalTokens) - positiveNumber(a.totalTokens));

        if (!root) {
            return;
        }

        if (!rows.length) {
            appendEmptyState(root, "暂无 Token 统计数据。");
            return;
        }

        const maxToken = Math.max(...rows.map((item) => positiveNumber(item.totalTokens)), 1);
        clearNode(root);

        rows.forEach((item, index) => {
            root.appendChild(createDataRow({
                indexText: `#${index + 1}`,
                item,
                value: formatNumber(item.totalTokens),
                width: positiveNumber(item.totalTokens) / maxToken * 100,
                meta: `${item.provider} · ${formatNumber(item.callCount)} calls · 覆盖 ${formatPercent(item.tokenCoverage)}`
            }));
        });
    }

    function renderSpeedRankList() {
        const root = byId("speedRankList");
        const rows = statusData.speedModels
            .filter((item) => positiveNumber(item.avgTTFTMs) > 0 || positiveNumber(item.avgOutputTPS) > 0);

        if (!root) {
            return;
        }

        if (!rows.length) {
            appendEmptyState(root, "暂无速度样本，需要包含 duration / ttft 的 token 日志。");
            return;
        }

        const maxScore = Math.max(...rows.map((item) => positiveNumber(item.score)), 1);
        clearNode(root);

        rows.forEach((item, index) => {
            root.appendChild(createDataRow({
                indexText: `#${index + 1}`,
                item,
                value: formatDecimal(item.score, 1),
                width: positiveNumber(item.score) / maxScore * 100,
                meta: `${item.provider} · TTFT ${formatDecimal(item.avgTTFTMs, 1)} ms · TPS ${formatDecimal(item.avgOutputTPS, 2)} · ${formatNumber(item.samples)} samples`
            }));
        });
    }

    function renderComplexitySummary() {
        const root = byId("complexitySummary");
        const complexity = statusData.complexity;
        const cards = [
            ["简单任务", complexity.simple, "0-2 tools"],
            ["中等任务", complexity.medium, "3-7 tools"],
            ["复杂任务", complexity.complex, "8+ tools"]
        ];

        if (!root) {
            return;
        }

        clearNode(root);

        cards.forEach(([label, value, hint]) => {
            const card = createElement("div", "complexity-card");
            card.appendChild(createElement("span", "", label));
            card.appendChild(createElement("strong", "", formatNumber(value)));
            card.appendChild(createElement("p", "", hint));
            root.appendChild(card);
        });
    }

    function createComplexityTrack(load, total, maxTotal) {
        const track = createElement("div", "complexity-track");
        const scale = maxTotal > 0 ? total / maxTotal : 0;
        const totalWidth = scale * 100;
        const segments = [
            ["simple", total > 0 ? totalWidth * (load.simple / total) : 0],
            ["medium", total > 0 ? totalWidth * (load.medium / total) : 0],
            ["complex", total > 0 ? totalWidth * (load.complex / total) : 0]
        ];

        segments.forEach(([className, width]) => {
            const segment = createElement("span", `complexity-seg ${className}`);
            setProgressWidth(segment, width);
            track.appendChild(segment);
        });

        return track;
    }

    function renderComplexityList() {
        const root = byId("complexityList");
        const rows = [...statusData.models]
            .map((item) => {
                let load = normalizeComplexityLoad(item.complexityLoad);

                if (complexityLoadTotal(load) <= 0) {
                    load = deriveComplexityLoadFromToolCalls(item.toolCalls);
                }

                return {
                    item,
                    load,
                    total: complexityLoadTotal(load)
                };
            })
            .sort((a, b) => b.total - a.total);

        if (!root) {
            return;
        }

        if (!rows.length) {
            appendEmptyState(root, "暂无复杂度分布数据。");
            return;
        }

        const maxTotal = Math.max(...rows.map((row) => positiveNumber(row.total)), 1);
        clearNode(root);

        rows.forEach((row, index) => {
            const item = createElement("div", "data-row complexity-row");
            const nameWrap = createElement("div");
            const value = createElement("div", "row-value", formatNumber(row.total));

            appendModelName(nameWrap, row.item, "row-name");
            nameWrap.appendChild(createElement("div", "row-meta", `#${index + 1} · ${row.item.provider}`));

            item.appendChild(nameWrap);
            item.appendChild(createComplexityTrack(row.load, row.total, maxTotal));
            item.appendChild(value);
            root.appendChild(item);
        });
    }

    function renderToolFailures() {
        const root = byId("toolFailList");
        const rows = Array.isArray(statusData.toolFailures) ? statusData.toolFailures : [];
        const footnote = byId("statusFootnote");

        if (root) {
            if (!rows.length) {
                appendEmptyState(root, "暂无工具失败记录。");
            } else {
                clearNode(root);

                rows.forEach((item) => {
                    const row = createElement("div", "failure-item");
                    const body = createElement("div");

                    body.appendChild(createElement("div", "failure-name", item.name));
                    body.appendChild(createElement("div", "failure-meta", item.note || "未记录错误详情"));
                    row.appendChild(body);
                    row.appendChild(createElement("div", "failure-count", formatNumber(item.count)));
                    root.appendChild(row);
                });
            }
        }

        if (footnote) {
            footnote.textContent = `说明：当前页面使用后端聚合数据。样本来源为 ${statusData.source}。当前口径：会话消息统计模型调用，token 日志统计 Token，总工具日志统计工具表现；近 ${statusData.recent24hWindowHours}h 榜单融合调用次数与 Token。`;
        }
    }

    function renderAll() {
        updateHero();
        renderSummary();
        renderLeaderCard();
        renderRankList();
        renderRecent24h();
        renderTokenChart();
        renderSpeedRankList();
        renderComplexitySummary();
        renderComplexityList();
        renderToolFailures();
    }

    async function loadStatusData() {
        try {
            const response = await fetch("/api/status/overview", { credentials: "include" });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload.success || !payload.status) {
                throw new Error(payload.message || `HTTP ${response.status}`);
            }

            statusData = normalizeStatusData(payload.status);
        } catch (error) {
            statusData = createEmptyStatusData();
            statusData.loadErrorMessage = `状态数据加载失败：${String(error && error.message ? error.message : error || "unknown error")}`;
        }

        renderAll();
    }

    document.addEventListener("DOMContentLoaded", loadStatusData);
})();
