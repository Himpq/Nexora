(function initTokenUsageDetails() {
    "use strict";

    class TokenUsageDetailsController {
        constructor() {
            this.modal = document.getElementById("tokenUsageDetailModal");
            this.closeButton = document.getElementById("closeTokenUsageDetailBtn");
            this.title = document.getElementById("tokenUsageDetailTitle");
            this.meta = document.getElementById("tokenUsageDetailMeta");
            this.body = document.getElementById("tokenUsageDetailBody");
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
                cell.colSpan = 4;
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
            const inputTokens = this.toNumber(log.input_tokens);
            const outputTokens = this.toNumber(log.output_tokens);
            const recordedTotal = this.toNumber(log.total_tokens);
            const totalTokens = recordedTotal > 0 ? recordedTotal : inputTokens + outputTokens;
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

            const totalCell = document.createElement("td");
            totalCell.className = "num";
            totalCell.appendChild(this.createTextBlock(`${inputTokens}+${outputTokens}`, "token-log-split"));
            totalCell.appendChild(this.createTextBlock(totalTokens.toLocaleString(), "token-log-total"));

            row.append(timeCell, titleCell, actionCell, totalCell);

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
            this.body.classList.remove("token-usage-detail-state", "error");
            this.body.replaceChildren(
                this.createDetailSection("tokenUsageUserTitle", "用户提问", this.userContent),
                this.createDetailSection("tokenUsageResponseTitle", "模型响应", this.responseContent),
            );
            this.renderMarkdown(this.userContent, detail.user_markdown || "该消息没有文本内容。");
            this.renderMarkdown(this.responseContent, detail.response_markdown || "该消息没有文本内容。");
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
                `I ${this.toNumber(detail.input_tokens).toLocaleString()} / O ${this.toNumber(detail.output_tokens).toLocaleString()}`,
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
    }

    window.NexoraTokenUsageDetails = new TokenUsageDetailsController();
})();
