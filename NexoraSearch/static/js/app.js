const page = document.body;
const authRequired = page.dataset.authRequired === "1";
const apiBaseUrl = String(page.dataset.apiBaseUrl || "").trim();
const serviceName = String(page.dataset.serviceName || "NexoraSearch").trim();

const storageKey = "nexora.search.token";

const els = {
    authToken: document.getElementById("authToken"),
    tokenHint: document.getElementById("tokenHint"),
    searchQuery: document.getElementById("searchQuery"),
    searchMaxResults: document.getElementById("searchMaxResults"),
    searchFetchContent: document.getElementById("searchFetchContent"),
    renderUrl: document.getElementById("renderUrl"),
    renderTimeout: document.getElementById("renderTimeout"),
    renderSogouFix: document.getElementById("renderSogouFix"),
    parseModel: document.getElementById("parseModel"),
    parseInstructions: document.getElementById("parseInstructions"),
    resultView: document.getElementById("resultView"),
    resultTypeTag: document.getElementById("resultTypeTag"),
    logList: document.getElementById("logList"),
    requestChip: document.getElementById("requestChip"),
    baseUrlChip: document.getElementById("baseUrlChip"),
    btnSaveToken: document.getElementById("btnSaveToken"),
    btnClearToken: document.getElementById("btnClearToken"),
    btnSearchDdg: document.getElementById("btnSearchDdg"),
    btnSearchRender: document.getElementById("btnSearchRender"),
    btnRenderWebview: document.getElementById("btnRenderWebview"),
    btnAgentParse: document.getElementById("btnAgentParse"),
    btnClearLog: document.getElementById("btnClearLog"),
    btnLoadExample: document.getElementById("btnLoadExample"),
    searchResultTemplate: document.getElementById("searchResultTemplate"),
    navButtons: document.querySelectorAll(".nav-btn"),
};

function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
}

function buildRequestUrl(path) {
    const requestPath = path.startsWith("/") ? path : `/${path}`;
    const root = normalizeBaseUrl(apiBaseUrl);
    return root ? `${root}${requestPath}` : requestPath;
}

function loadSavedToken() {
    try {
        return localStorage.getItem(storageKey) || "";
    } catch (_) {
        return "";
    }
}

function saveToken(token) {
    try {
        localStorage.setItem(storageKey, token);
        return true;
    } catch (_) {
        return false;
    }
}

function clearToken() {
    try {
        localStorage.removeItem(storageKey);
        return true;
    } catch (_) {
        return false;
    }
}

function setRequestState(state, text) {
    if (!els.requestChip) return;

    els.requestChip.className = "chip";
    if (state === "busy") {
        els.requestChip.classList.add("status-warn");
    } else if (state === "ok") {
        els.requestChip.classList.add("status-ok");
    } else if (state === "fail") {
        els.requestChip.classList.add("status-fail");
    }

    els.requestChip.textContent = text;
}

function setResultTitle(text) {
    if (els.resultTypeTag) {
        els.resultTypeTag.textContent = text;
    }
}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function prettyJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch (_) {
        return String(value ?? "");
    }
}

function renderEmptyState(title, description) {
    if (!els.resultView) return;

    els.resultView.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                    <path d="M5 7h14M5 12h14M5 17h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
                </svg>
            </div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
        </div>
    `;
}

function renderKvGrid(pairs) {
    return `
        <div class="kv-grid">
            ${pairs.map((item) => `
                <div class="kv">
                    <div class="k">${escapeHtml(item.key)}</div>
                    <div class="v">${escapeHtml(item.value)}</div>
                </div>
            `).join("")}
        </div>
    `;
}

function renderJsonResult(title, payload, subtitle = "") {
    if (!els.resultView) return;

    setResultTitle(title);
    els.resultView.innerHTML = `
        ${renderKvGrid([
            { key: "Service", value: serviceName },
            { key: "Endpoint", value: subtitle || "API Result" },
        ])}
        <div class="json-block">${escapeHtml(prettyJson(payload))}</div>
    `;
}

function renderSearchCard(item, index) {
    const template = els.searchResultTemplate.content.cloneNode(true);
    const root = template.querySelector(".search-result");
    const titleEl = template.querySelector(".result-title");
    const indexEl = template.querySelector(".result-index");
    const urlEl = template.querySelector(".result-url");
    const snippetEl = template.querySelector(".result-snippet");
    const contentEl = template.querySelector(".result-content");

    const title = String(item?.title || item?.name || `Result ${index + 1}`);
    const url = String(item?.url || item?.href || "");
    const snippet = String(item?.snippet || item?.body || item?.content || "");
    const content = String(item?.content || "");

    titleEl.textContent = title;
    if (url) {
        titleEl.href = url;
        urlEl.textContent = url;
    } else {
        titleEl.removeAttribute("href");
        urlEl.textContent = "no url";
    }

    indexEl.textContent = `#${index + 1}`;
    snippetEl.textContent = snippet || "（无摘要）";
    contentEl.textContent = content ? content.slice(0, 1500) : "（无正文）";

    root.dataset.index = String(index + 1);
    return template;
}

function renderSearchResults(payload, endpointLabel) {
    if (!els.resultView) return;

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const groupedResults = payload?.results && !Array.isArray(payload.results) && typeof payload.results === "object"
        ? payload.results
        : null;
    const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};

    if (results.length) {
        setResultTitle(`${endpointLabel} · ${results.length} 条`);
        els.resultView.innerHTML = "";
        const section = document.createElement("section");
        section.className = "result-section";
        section.innerHTML = `
            <div class="result-section-head">
                <div class="result-section-title">${escapeHtml(endpointLabel)}</div>
                <div class="result-section-meta">${escapeHtml(String(results.length))} items</div>
            </div>
        `;

        const list = document.createElement("div");
        list.className = "result-card-list";
        results.forEach((item, index) => {
            list.appendChild(renderSearchCard(item, index));
        });
        section.appendChild(list);
        els.resultView.appendChild(section);
        return;
    }

    if (groupedResults) {
        const engineNames = Object.keys(groupedResults);
        if (!engineNames.length) {
            setResultTitle(`${endpointLabel} · 0 条`);
            renderEmptyState("没有结果", "本次渲染式搜索没有返回可显示的条目。");
            return;
        }

        const total = Number(meta.total_results || 0) || engineNames.reduce((sum, engine) => {
            const items = Array.isArray(groupedResults[engine]) ? groupedResults[engine] : [];
            return sum + items.length;
        }, 0);

        setResultTitle(`${endpointLabel} · ${total} 条`);
        els.resultView.innerHTML = "";

        const root = document.createElement("div");
        root.className = "result-group-stack";

        engineNames.forEach((engine) => {
            const items = Array.isArray(groupedResults[engine]) ? groupedResults[engine] : [];
            const engineMeta = meta.engines && meta.engines[engine] ? meta.engines[engine] : {};
            const section = document.createElement("section");
            section.className = "result-section";
            section.innerHTML = `
                <div class="result-section-head">
                    <div class="result-section-title">${escapeHtml(engine)}</div>
                    <div class="result-section-meta">${escapeHtml(String(items.length))} items</div>
                </div>
                <div class="result-section-note">${escapeHtml(engineMeta.url || "")}</div>
            `;

            const list = document.createElement("div");
            list.className = "result-card-list";
            if (!items.length) {
                const empty = document.createElement("div");
                empty.className = "result-empty-row";
                empty.textContent = "No items";
                list.appendChild(empty);
            } else {
                items.forEach((item, index) => {
                    list.appendChild(renderSearchCard(item, index));
                });
            }

            section.appendChild(list);
            root.appendChild(section);
        });

        els.resultView.appendChild(root);
        return;
    }

    setResultTitle(`${endpointLabel} · 0 条`);
    renderEmptyState("没有结果", "本次请求没有拿到可展示的条目。");
}

function addLog(status, title, meta = "") {
    if (!els.logList) return;

    const item = document.createElement("article");
    item.className = "log-item";

    const now = new Date();
    const statusClass = status === "ok" ? "status-ok" : status === "fail" ? "status-fail" : "status-warn";
    item.innerHTML = `
        <div class="log-head">
            <span class="${statusClass}">${escapeHtml(status.toUpperCase())}</span>
            <span>${escapeHtml(now.toLocaleTimeString())}</span>
        </div>
        <div class="log-title">${escapeHtml(title)}</div>
        <div class="log-meta">${escapeHtml(meta)}</div>
    `;

    els.logList.prepend(item);
}

function setBusy(isBusy) {
    document.querySelectorAll("button[id^='btn']").forEach((button) => {
        button.disabled = isBusy;
    });

    if (isBusy) {
        setRequestState("busy", "Working...");
    }
}

function getToken() {
    const inputToken = String(els.authToken?.value || "").trim();
    return inputToken || loadSavedToken();
}

function buildHeaders() {
    const headers = {
        "Content-Type": "application/json",
    };

    const token = getToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

async function callApi(path, options = {}) {
    const response = await fetch(buildRequestUrl(path), {
        ...options,
        headers: {
            ...buildHeaders(),
            ...(options.headers || {}),
        },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
        const message = String(payload?.error || payload?.message || `HTTP ${response.status}`).trim();
        throw new Error(message || "Request failed");
    }

    return payload;
}

function syncTokenHint() {
    const token = String(els.authToken?.value || "").trim();
    if (!els.tokenHint) return;

    if (authRequired && !token) {
        els.tokenHint.textContent = "当前站点需要 token，先保存本地 token 再操作。";
        return;
    }

    if (authRequired) {
        els.tokenHint.textContent = "Token 已就绪，可以直接发起请求。";
        return;
    }

    els.tokenHint.textContent = "当前站点不强制 token，但保存后会自动随请求携带。";
}

async function runSearch() {
    const query = String(els.searchQuery?.value || "").trim();
    const maxResults = Math.max(1, Math.min(20, Number(els.searchMaxResults?.value || 5)));
    const fetchContent = !!els.searchFetchContent?.checked;

    if (!query) {
        renderEmptyState("缺少查询词", "先输入搜索词再执行搜索。");
        return;
    }

    setBusy(true);
    try {
        const data = await callApi(`/api/search/ddg?query=${encodeURIComponent(query)}&max_results=${maxResults}&fetch_content=${fetchContent ? "true" : "false"}`);
        renderSearchResults(data, "DuckDuckGo");
        addLog("ok", `DDG 搜索: ${query}`, `results=${Array.isArray(data?.results) ? data.results.length : 0}`);
        setRequestState("ok", "Search OK");
    } catch (error) {
        renderEmptyState("搜索失败", String(error?.message || error));
        addLog("fail", `DDG 搜索失败: ${query}`, String(error?.message || error));
        setRequestState("fail", "Search Failed");
    } finally {
        setBusy(false);
    }
}

async function runRenderSearch() {
    const query = String(els.searchQuery?.value || "").trim();

    if (!query) {
        renderEmptyState("缺少查询词", "先输入搜索词再执行渲染式搜索。");
        return;
    }

    setBusy(true);
    try {
        const data = await callApi(`/api/search/render?query=${encodeURIComponent(query)}`);
        renderSearchResults(data, "Render Search");
        const total = Number(data?.meta?.total_results || 0) || 0;
        addLog("ok", `渲染式搜索: ${query}`, `results=${total}`);
        setRequestState("ok", "Render Search OK");
    } catch (error) {
        renderEmptyState("渲染式搜索失败", String(error?.message || error));
        addLog("fail", `渲染式搜索失败: ${query}`, String(error?.message || error));
        setRequestState("fail", "Render Search Failed");
    } finally {
        setBusy(false);
    }
}

async function runWebviewRender() {
    const url = String(els.renderUrl?.value || "").trim();
    const timeout = Math.max(1000, Number(els.renderTimeout?.value || 15000));
    const useSogouFix = !!els.renderSogouFix?.checked;

    if (!url) {
        renderEmptyState("缺少 URL", "先输入网页地址再抓取。");
        return;
    }

    setBusy(true);
    try {
        const data = await callApi(`/api/render/webview?url=${encodeURIComponent(url)}&timeout=${timeout}&use_sogou_fix=${useSogouFix ? "true" : "false"}`);
        setResultTitle("WebView 渲染");
        if (!els.resultView) return;

        els.resultView.innerHTML = `
            ${renderKvGrid([
                { key: "Title", value: data.title || "-" },
                { key: "Mode", value: data.mode || data.warning || "unknown" },
                { key: "URL", value: data.url || url },
                { key: "Length", value: String((data.content || "").length) },
            ])}
            <div class="json-block">${escapeHtml(String(data.content || ""))}</div>
        `;

        addLog("ok", `WebView: ${url}`, `mode=${data.mode || data.warning || "unknown"}`);
        setRequestState("ok", "Render OK");
    } catch (error) {
        renderEmptyState("网页抓取失败", String(error?.message || error));
        addLog("fail", `WebView 失败: ${url}`, String(error?.message || error));
        setRequestState("fail", "Render Failed");
    } finally {
        setBusy(false);
    }
}

async function runAgentParse() {
    const url = String(els.renderUrl?.value || "").trim();
    const instructions = String(els.parseInstructions?.value || "").trim();
    const model = String(els.parseModel?.value || "").trim();

    if (!url) {
        renderEmptyState("缺少 URL", "页面解析需要先指定一个网页地址。");
        return;
    }

    setBusy(true);
    try {
        const data = await callApi("/api/agent/parse", {
            method: "POST",
            body: JSON.stringify({
                url,
                instructions,
                model,
            }),
        });
        renderJsonResult("页面解析", data, "/api/agent/parse");
        addLog("ok", `页面解析: ${url}`, `model=${data.model || model || "default"}`);
        setRequestState("ok", "Parse OK");
    } catch (error) {
        renderEmptyState("页面解析失败", String(error?.message || error));
        addLog("fail", `页面解析失败: ${url}`, String(error?.message || error));
        setRequestState("fail", "Parse Failed");
    } finally {
        setBusy(false);
    }
}

function fillExample() {
    if (els.searchQuery) els.searchQuery.value = "NexoraSearch";
    if (els.searchMaxResults) els.searchMaxResults.value = "5";
    if (els.searchFetchContent) els.searchFetchContent.checked = false;
    if (els.renderUrl) els.renderUrl.value = "https://example.com";
    if (els.renderTimeout) els.renderTimeout.value = "15000";
    if (els.renderSogouFix) els.renderSogouFix.checked = true;
    if (els.parseInstructions) els.parseInstructions.value = "只输出严格 JSON，包含 title、summary、keywords、source_url。";
    if (els.parseModel) els.parseModel.value = "";

    addLog("warn", "已填充示例", "可以直接点击搜索、渲染或解析按钮。");
}

function bindNav() {
    els.navButtons.forEach((button) => {
        button.addEventListener("click", () => {
            els.navButtons.forEach((item) => item.classList.remove("active"));
            button.classList.add("active");

            const targetId = String(button.dataset.target || "").trim();
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    });
}

function bindEvents() {
    els.btnSaveToken?.addEventListener("click", () => {
        const token = String(els.authToken?.value || "").trim();
        if (!token) {
            syncTokenHint();
            addLog("warn", "Token 未保存", "输入框为空。");
            return;
        }

        saveToken(token);
        syncTokenHint();
        addLog("ok", "Token 已保存", "已写入浏览器本地存储。");
    });

    els.btnClearToken?.addEventListener("click", () => {
        if (els.authToken) els.authToken.value = "";
        clearToken();
        syncTokenHint();
        addLog("warn", "Token 已清空", "本地保存记录已移除。");
    });

    els.btnSearchDdg?.addEventListener("click", runSearch);
    els.btnSearchRender?.addEventListener("click", runRenderSearch);
    els.btnRenderWebview?.addEventListener("click", runWebviewRender);
    els.btnAgentParse?.addEventListener("click", runAgentParse);

    els.btnClearLog?.addEventListener("click", () => {
        if (els.logList) els.logList.innerHTML = "";
        setRequestState("idle", "Idle");
    });

    els.btnLoadExample?.addEventListener("click", fillExample);

    els.authToken?.addEventListener("input", syncTokenHint);
    els.searchQuery?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            runSearch();
        }
    });
    els.renderUrl?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            runWebviewRender();
        }
    });
}

function init() {
    if (els.authToken) {
        els.authToken.value = loadSavedToken();
    }

    if (els.baseUrlChip) {
        els.baseUrlChip.textContent = `Base: ${normalizeBaseUrl(apiBaseUrl) || "same-origin"}`;
    }

    syncTokenHint();
    bindNav();
    bindEvents();
    setRequestState("idle", "Idle");
    renderEmptyState("准备就绪", "先填 token，然后开始搜索、渲染或解析。结果会显示在这里。");
}

init();
