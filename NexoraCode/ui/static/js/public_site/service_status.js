(function () {
    "use strict";

    const SAMPLE_COUNT = 60;
    const STATUS_LABELS = {
        operational: "正常运行",
        degraded: "性能下降",
        outage: "服务中断",
        unknown: "等待数据"
    };

    function byId(id) {
        return document.getElementById(id);
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

    function normalizeStatus(value) {
        const status = String(value || "unknown").toLowerCase();
        return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : "unknown";
    }

    function formatPercentage(value) {
        const percentage = Number(value);
        return Number.isFinite(percentage) ? `${percentage.toFixed(2)}%` : "--";
    }

    function formatLatency(value) {
        const latency = Number(value);
        return Number.isFinite(latency) ? `${Math.round(latency)} ms` : "-- ms";
    }

    function normalizeService(rawService) {
        const source = rawService && typeof rawService === "object" ? rawService : {};
        return {
            name: String(source.name || "未命名服务"),
            status: normalizeStatus(source.status),
            uptime24h: source.uptime24h,
            latencyMs: source.latencyMs,
            lastOperationalAt: String(source.lastOperationalAt || ""),
            samples: Array.isArray(source.recentSamples) ? source.recentSamples.slice(-SAMPLE_COUNT) : []
        };
    }

    function normalizePayload(payload) {
        const source = payload && typeof payload === "object" ? payload : {};
        return {
            snapshotAt: String(source.snapshotAt || ""),
            services: Array.isArray(source.services) ? source.services.map(normalizeService) : []
        };
    }

    function renderOverallStatus(data) {
        const root = byId("overallStatus");
        const title = byId("overallStatusTitle");
        const description = byId("overallStatusDescription");
        const snapshotAt = byId("snapshotAt");

        if (!root || !title || !description || !snapshotAt) {
            return;
        }

        if (!data.services.length) {
            root.className = "overall-status is-unknown";
            title.textContent = "监控数据未接入";
            description.textContent = "正在等待服务端返回第一份状态快照。";
            snapshotAt.textContent = "等待服务端监控快照";
            return;
        }

        const hasOutage = data.services.some((service) => service.status === "outage");
        const hasDegraded = data.services.some((service) => service.status === "degraded");
        const overallStatus = hasOutage ? "outage" : hasDegraded ? "degraded" : "operational";
        root.className = `overall-status is-${overallStatus}`;
        title.textContent = overallStatus === "operational" ? "所有启用服务运行正常" : "部分服务需要关注";
        description.textContent = overallStatus === "operational"
            ? "当前未发现影响服务可用性的事件。"
            : "请查看下方服务的最近检查记录。";
        snapshotAt.textContent = `最后更新：${data.snapshotAt || "--"}`;
    }

    function createBars(samples) {
        const root = createElement("div", "availability-bars");
        const normalizedSamples = samples.map(normalizeStatus);
        const emptyCount = Math.max(0, SAMPLE_COUNT - normalizedSamples.length);

        for (let index = 0; index < emptyCount; index += 1) {
            root.appendChild(createElement("span", "availability-bar is-unknown"));
        }

        normalizedSamples.forEach((status) => {
            const bar = createElement("span", `availability-bar is-${status}`);
            bar.title = STATUS_LABELS[status];
            root.appendChild(bar);
        });

        return root;
    }

    function createTimeline(uptime) {
        const timeline = createElement("div", "availability-timeline");
        timeline.appendChild(createElement("span", "", "24 小时前"));
        timeline.appendChild(createElement("i", "availability-line"));
        timeline.appendChild(createElement("strong", "", `${formatPercentage(uptime)} 可用性`));
        timeline.appendChild(createElement("i", "availability-line"));
        timeline.appendChild(createElement("span", "", "当前"));
        return timeline;
    }

    function renderServiceList(data) {
        const root = byId("serviceList");

        if (!root) {
            return;
        }

        root.replaceChildren();

        if (!data.services.length) {
            root.appendChild(createElement("div", "empty-state", "尚无服务状态记录。"));
            return;
        }

        data.services.forEach((service) => {
            const row = createElement("article", "status-service-row");
            const header = createElement("div", "service-row-header");
            header.appendChild(createElement("h2", "", service.name));
            const metrics = createElement("div", "service-row-metrics");
            metrics.appendChild(createElement("span", "service-latency", formatLatency(service.latencyMs)));
            metrics.appendChild(createElement("span", `service-state is-${service.status}`, STATUS_LABELS[service.status]));
            header.appendChild(metrics);
            row.appendChild(header);

            if (service.status === "degraded" || service.status === "outage") {
                const lastOperationalText = service.lastOperationalAt
                    ? `最后正常检查：${service.lastOperationalAt}`
                    : "尚无正常检查记录";
                row.appendChild(createElement("p", "service-last-operational", lastOperationalText));
            }

            row.appendChild(createBars(service.samples));
            row.appendChild(createTimeline(service.uptime24h));
            root.appendChild(row);
        });
    }

    function render(payload) {
        const data = normalizePayload(payload);
        renderOverallStatus(data);
        renderServiceList(data);
    }

    function renderLoadFailure() {
        const overall = byId("overallStatus");
        const title = byId("overallStatusTitle");
        const description = byId("overallStatusDescription");
        const snapshotAt = byId("snapshotAt");
        const serviceList = byId("serviceList");

        if (overall) {
            overall.className = "overall-status is-unknown";
        }

        if (title) {
            title.textContent = "状态数据暂不可用";
        }

        if (description) {
            description.textContent = "服务端监控快照读取失败，请稍后重试。";
        }

        if (snapshotAt) {
            snapshotAt.textContent = "无法读取最近状态";
        }

        if (serviceList) {
            serviceList.replaceChildren(createElement("div", "empty-state", "服务状态数据读取失败。"));
        }
    }

    async function refresh() {
        try {
            const response = await fetch("/api/status/overview", { credentials: "include" });
            const payload = await response.json();

            if (!response.ok || !payload || payload.success !== true) {
                throw new Error("服务状态数据读取失败");
            }

            render(payload.status);
        } catch (error) {
            console.error("[ServiceStatus] load failed", error);
            renderLoadFailure();
        }
    }

    window.NexoraServiceStatus = { render };
    render(null);
    void refresh();
    window.setInterval(refresh, 60000);
}());
