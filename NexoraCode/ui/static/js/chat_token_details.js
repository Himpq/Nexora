(function initTokenUsageDetails() {
    "use strict";

    class TokenUsageDetailsController {
        constructor() {
            this.modal = document.getElementById("tokenUsageDetailModal");
            this.closeButton = document.getElementById("closeTokenUsageDetailBtn");
            this.title = document.getElementById("tokenUsageDetailTitle");
            this.meta = document.getElementById("tokenUsageDetailMeta");
            this.body = document.getElementById("tokenUsageDetailBody");
            this.ioGrid = document.getElementById("tokenUsageIoGrid");
            this.userContent = document.getElementById("tokenUsageUserContent");
            this.responseContent = document.getElementById("tokenUsageResponseContent");
            this.requestController = null;
            this.triggerElement = null;
            this.bindEvents();
        }

        bindEvents() {
            if (!this.modal || !this.closeButton) {
                return;
            }

            this.closeButton.addEventListener("click", () => this.close());
            this.modal.addEventListener("click", (event) => {
                if (event.target === this.modal) {
                    this.close();
                }
            });
            document.addEventListener("keydown", (event) => {
                if (event.key !== "Escape" || !this.modal.classList.contains("active")) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                this.close();
            }, true);
        }

        renderHistory(tableBody, logs) {
            if (!tableBody) {
                return;
            }

            tableBody.replaceChildren();
            const history = Array.isArray(logs) ? logs : [];

            if (!history.length) {
                const row = document.createElement("tr");
                const cell = document.createElement("td");
                cell.colSpan = 5;
                cell.className = "token-log-empty";
                cell.textContent = "暂无 Token 记录";
                row.appendChild(cell);
                tableBody.appendChild(row);

                return;
            }

            const fragment = document.createDocumentFragment();

            history.forEach((log) => fragment.appendChild(this.createHistoryRow(log || {})));
            tableBody.appendChild(fragment);
        }

        createHistoryRow(log) {
            const row = document.createElement("tr");
            const detailRef = String(log.detail_ref || "").trim();
            const action = String(log.action || "chat").trim().toLowerCase() || "chat";
            const rawInput = this.toNumber(log.raw_input_tokens);
            const cachedInput = this.toNumber(log.cached_input_tokens);
            const outputTokens = this.toNumber(log.output_tokens);
            const recordedTotal = this.toNumber(log.total_tokens);
            const totalTokens = recordedTotal > 0 ? recordedTotal : rawInput + outputTokens;
            const timestamp = String(log.timestamp || "").trim();
            const timeParts = timestamp.split(" ");

            row.className = "token-log-row";
            row.tabIndex = 0;
            row.setAttribute("role", "button");
            row.setAttribute("aria-label", `查看 ${action.toUpperCase()} Token 调用详情`);

            const timeCell = document.createElement("td");
            timeCell.title = timestamp;
            timeCell.appendChild(this.createTextBlock(timeParts[0] || "-", "token-log-time-date"));
            timeCell.appendChild(this.createTextBlock(timeParts[1] || timestamp || "-", "token-log-time-clock"));

            const titleCell = document.createElement("td");
            titleCell.className = "title-cell";
            titleCell.title = String(log.conversation_title || "");
            titleCell.appendChild(this.createTextBlock(log.conversation_title || "Chat Operation", "text-truncate"));

            const actionCell = document.createElement("td");
            const actionBadge = document.createElement("span");
            const actionClass = ["chat", "tool", "search", "memory"].includes(action) ? action : "chat";
            actionBadge.className = `action-badge ${actionClass}`;
            actionBadge.textContent = action.toUpperCase();
            actionCell.appendChild(actionBadge);

            // 缓存命中列：上游原始输入中被缓存命中的部分，未上报命中量时显示为 0 而不是留空。
            const cacheCell = document.createElement("td");
            cacheCell.className = "num";
            const hitRate = this.toRate(log.cache_hit_rate, rawInput, cachedInput);
            cacheCell.title = rawInput > 0
                ? `缓存命中 ${cachedInput.toLocaleString()} / 原始输入 ${rawInput.toLocaleString()}`
                : "该次调用没有原始输入统计";
            cacheCell.appendChild(this.createTextBlock(`${(hitRate * 100).toFixed(1)}%`, "token-log-cache-rate"));
            cacheCell.appendChild(this.createTextBlock(`${cachedInput.toLocaleString()} 命中`, "token-log-split"));

            const totalCell = document.createElement("td");
            totalCell.className = "num";
            totalCell.title = "合计 = 原始输入 + 输出，不因缓存命中扣减";
            totalCell.appendChild(this.createTextBlock(`I ${rawInput.toLocaleString()} + O ${outputTokens.toLocaleString()}`, "token-log-split"));
            totalCell.appendChild(this.createTextBlock(totalTokens.toLocaleString(), "token-log-total"));

            row.append(timeCell, titleCell, actionCell, cacheCell, totalCell);

            const openDetail = () => this.open(detailRef, row);
            row.addEventListener("click", openDetail);
            row.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }

                event.preventDefault();
                openDetail();
            });

            return row;
        }

        async open(detailRef, triggerElement) {
            if (!this.modal || !detailRef) {
                return;
            }

            if (this.requestController) {
                this.requestController.abort();
            }

            this.triggerElement = triggerElement || null;
            this.requestController = new AbortController();
            this.modal.classList.add("active");
            this.modal.setAttribute("aria-hidden", "false");
            this.title.textContent = "Token 调用详情";
            this.meta.replaceChildren();
            this.setState("正在读取 Token 调用详情...");
            this.closeButton.focus({preventScroll: true});

            try {
                const response = await fetch(`/api/tokens/detail?ref=${encodeURIComponent(detailRef)}`, {
                    signal: this.requestController.signal,
                });
                const payload = await response.json();

                if (!response.ok || !payload.success || !payload.detail) {
                    throw new Error(payload.message || "Token 详情读取失败");
                }

                this.renderDetail(payload.detail);
            } catch (error) {
                if (error && error.name === "AbortError") {
                    return;
                }

                console.error("[TOKEN_DETAIL] load failed", error);
                this.setState(error instanceof Error ? error.message : "Token 详情读取失败", true);
            }
        }

        close() {
            if (!this.modal) {
                return;
            }

            if (this.requestController) {
                this.requestController.abort();
                this.requestController = null;
            }

            this.modal.classList.remove("active");
            this.modal.setAttribute("aria-hidden", "true");

            if (this.triggerElement && document.contains(this.triggerElement)) {
                this.triggerElement.focus({preventScroll: true});
            }

            this.triggerElement = null;
        }

        renderDetail(detail) {
            if (!this.body || !this.title || !this.meta) {
                return;
            }

            this.title.textContent = String(detail.title || "Token 调用详情");
            this.renderMeta(detail);
            this.renderIoGrid(detail);
            this.body.classList.remove("token-usage-detail-state", "error");
            this.body.replaceChildren(
                this.createDetailSection("tokenUsageIoTitle", "用量明细", this.ioGrid),
                this.createDetailSection("tokenUsageUserTitle", "用户提问", this.userContent),
                this.createDetailSection("tokenUsageResponseTitle", "模型响应", this.responseContent),
            );
            this.renderMarkdown(this.userContent, detail.user_markdown || "该消息没有文本内容。");
            this.renderMarkdown(this.responseContent, detail.response_markdown || "该消息没有文本内容。");
        }

        /** 用量明细：原始输入拆成缓存命中与实际计费输入，合计口径与后端一致。 */
        renderIoGrid(detail) {
            if (!this.ioGrid) {
                return;
            }

            this.ioGrid.replaceChildren();

            const rawInput = this.toNumber(detail.raw_input_tokens);
            const cached = this.toNumber(detail.cached_tokens ?? detail.cached_input_tokens);
            const effective = this.toNumber(detail.effective_input_tokens);
            const hitRate = this.toRate(detail.cache_hit_rate, rawInput, cached);
            const cumulativeRaw = this.toNumber(detail.cumulative_raw_input_tokens);
            const items = [
                {label: "原始输入", value: rawInput.toLocaleString(), hint: "上游返回的完整上下文"},
                {
                    label: "缓存命中",
                    value: cached.toLocaleString(),
                    hint: `${(hitRate * 100).toFixed(1)}%${detail.cached_tokens_source ? ` · 来源 ${detail.cached_tokens_source}` : ""}`,
                    tone: cached > 0 ? "cache" : "",
                },
                {label: "计费输入", value: effective.toLocaleString(), hint: "原始输入扣除缓存命中"},
                {label: "输出", value: this.toNumber(detail.output_tokens).toLocaleString(), hint: ""},
                {
                    label: "推理 Token",
                    value: this.toNumber(detail.reasoning_tokens).toLocaleString(),
                    hint: "",
                },
                {label: "合计", value: this.toNumber(detail.total_tokens).toLocaleString(), hint: "原始输入 + 输出"},
            ];

            if (cumulativeRaw > 0) {
                items.push({
                    label: "本次请求累计",
                    value: cumulativeRaw.toLocaleString(),
                    hint: `跨全部工具轮次的原始输入累计，输出 ${this.toNumber(detail.cumulative_output_tokens).toLocaleString()}`,
                });
            }

            const roundIndex = this.toNumber(detail.round_index);

            if (roundIndex > 0) {
                items.push({label: "轮次", value: `第 ${roundIndex} 轮`, hint: "同一次请求内的模型调用序号"});
            }

            items.forEach((item) => this.ioGrid.appendChild(this.createIoItem(item)));
        }

        createIoItem(item) {
            const block = document.createElement("div");
            block.className = `token-usage-io-item${item.tone ? ` ${item.tone}` : ""}`;

            const label = document.createElement("span");
            label.className = "label";
            label.textContent = item.label;

            const value = document.createElement("span");
            value.className = "value mono";
            value.textContent = item.value;

            block.append(label, value);

            if (item.hint) {
                const hint = document.createElement("span");
                hint.className = "hint";
                hint.textContent = item.hint;
                block.appendChild(hint);
            }

            return block;
        }

        createDetailSection(titleId, label, contentElement) {
            const section = document.createElement("section");
            const heading = document.createElement("h4");
            section.className = "token-usage-detail-section";
            section.setAttribute("aria-labelledby", titleId);
            heading.id = titleId;
            heading.textContent = label;
            section.append(heading, contentElement);

            return section;
        }

        renderMeta(detail) {
            this.meta.replaceChildren();
            const values = [
                detail.timestamp,
                detail.action ? String(detail.action).toUpperCase() : "",
                detail.model,
                `I ${this.toNumber(detail.raw_input_tokens).toLocaleString()} / O ${this.toNumber(detail.output_tokens).toLocaleString()}`,
            ].filter(Boolean);

            values.forEach((value) => {
                const item = document.createElement("span");
                item.textContent = String(value);
                this.meta.appendChild(item);
            });
        }

        renderMarkdown(element, markdown) {
            if (!element) {
                return;
            }

            const source = String(markdown || "");

            if (typeof renderMarkdownWithNewTabLinks !== "function") {
                element.textContent = source;

                return;
            }

            // 详情包含原始用户输入，先禁用 Markdown 内嵌 HTML，再交给现有 Markdown Present 管线。
            const safeSource = source.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
            element.innerHTML = renderMarkdownWithNewTabLinks(safeSource, {breaks: true});

            if (typeof bindSourceMarkdown === "function") {
                bindSourceMarkdown(element, source);
            }

            if (typeof renderMathSafe === "function") {
                renderMathSafe(element);
            }

            if (typeof highlightCode === "function") {
                highlightCode(element);
            }
        }

        setState(message, isError = false) {
            if (!this.body) {
                return;
            }

            this.body.replaceChildren();
            this.body.className = `modal-body token-usage-detail-body token-usage-detail-state${isError ? " error" : ""}`;
            this.body.textContent = String(message || "");
        }

        createTextBlock(value, className) {
            const element = document.createElement("div");
            element.className = className;
            element.textContent = String(value ?? "");

            return element;
        }

        toNumber(value) {
            const numeric = Number(value || 0);

            return Number.isFinite(numeric) ? numeric : 0;
        }

        /** 命中率优先用后端给出的值，缺失时按命中量与原始输入现算。 */
        toRate(value, rawInput, cachedInput) {
            const reported = Number(value);

            if (Number.isFinite(reported) && reported > 0) {
                return Math.min(1, reported);
            }

            if (!(rawInput > 0)) {
                return 0;
            }

            return Math.min(1, Math.max(0, cachedInput / rawInput));
        }
    }

    window.NexoraTokenUsageDetails = new TokenUsageDetailsController();
})();
