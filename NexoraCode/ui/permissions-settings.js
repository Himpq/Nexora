/** NexoraCode 工具权限设置。 */
(function () {
    "use strict";

    var $ = function (id) {
        return document.getElementById(id);
    };

    var modes = [
        {
            id: "read_only",
            name: "只读",
            description: "允许读文件、搜索、查看或滚动页面和查看工具状态；文件写入、命令、网页点击/输入/脚本执行和关闭页面会被拒绝。"
        },
        {
            id: "confirm",
            name: "写入 / 命令确认",
            description: "读取和滚动页面无需确认；写文件、命令、管理进程、点击/输入/脚本执行和关闭页面前逐次询问。"
        },
        {
            id: "auto",
            name: "自动审批",
            description: "把写入、命令、进程管理和网页状态变更交给下方模型逐次审批，通过后执行一次。"
        },
        {
            id: "full",
            name: "完全访问",
            description: "关闭 NexoraCode 工具权限限制，包括项目路径限制；操作仍受当前 Windows 账户权限约束。"
        }
    ];

    var state = {
        mode: "confirm",
        approvalModelId: "",
        models: [],
        approvalEvents: [],
        eventsLoading: true,
        eventsError: "",
        modelMenuOpen: false,
        loaded: false
    };

    async function request(method, body, endpoint) {
        var options = {
            method: method,
            credentials: "include",
            headers: {}
        };

        if (body !== undefined) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        var response = await fetch(endpoint || "/api/local/permissions", options);
        var data = await response.json().catch(function () {
            return null;
        });

        return { ok: response.ok, data: data };
    }

    function escapeHtml(value) {
        var node = document.createElement("span");
        node.textContent = String(value == null ? "" : value);
        return node.innerHTML;
    }

    function selectedMode() {
        var selected = document.querySelector('input[name="tool-permission-mode"]:checked');
        return selected ? String(selected.value || "") : "";
    }

    function renderModes() {
        var container = $("tool-permission-mode-list");

        if (!container) {
            return;
        }

        container.innerHTML = modes.map(function (mode) {
            var checked = state.mode === mode.id ? " checked" : "";

            return "<label class=\"permission-mode-option\">" +
                "<input type=\"radio\" name=\"tool-permission-mode\" value=\"" + mode.id + "\"" + checked + ">" +
                "<span class=\"permission-mode-copy\"><strong>" + escapeHtml(mode.name) + "</strong>" +
                "<small>" + escapeHtml(mode.description) + "</small></span></label>";
        }).join("");
    }

    function renderModels() {
        var picker = $("tool-permission-model-select");
        var trigger = $("tool-permission-model-trigger");
        var label = $("tool-permission-model-name");
        var providerLabel = $("tool-permission-model-provider");
        var menu = $("tool-permission-model-menu");
        var empty = $("tool-permission-model-empty");
        var panel = $("tool-permission-approval");
        var enabled = state.mode === "auto";

        if (!picker || !trigger || !label || !providerLabel || !menu || !empty || !panel) {
            return;
        }

        panel.classList.toggle("is-disabled", !enabled);
        trigger.disabled = state.models.length === 0;
        empty.hidden = state.models.length > 0;
        menu.replaceChildren();

        if (!state.models.length) {
            label.textContent = "暂无可用模型";
            providerLabel.textContent = "";
            empty.textContent = "请先在“模型 Provider”中配置模型。";
            closeModelMenu();
            return;
        }

        var selected = state.models.find(function (model) {
            return String(model.id || "") === state.approvalModelId;
        });

        label.textContent = selected ? String(selected.name || selected.id || "") : "请选择审批模型";
        providerLabel.textContent = selected ? String(selected.provider || "") : "";
        trigger.title = selected ? String(selected.id || "") : "请选择自动审批模型";

        groupModels().forEach(function (group) {
            var section = document.createElement("section");
            section.className = "permission-model-group";
            section.setAttribute("role", "group");
            section.setAttribute("aria-label", group.provider);

            var heading = document.createElement("div");
            heading.className = "permission-model-group-label";
            heading.textContent = group.provider;
            section.appendChild(heading);

            group.models.forEach(function (model) {
                var id = String(model.id || "");
                var option = document.createElement("button");
                option.type = "button";
                option.className = "permission-model-option";
                option.dataset.modelId = id;
                option.setAttribute("role", "option");
                option.setAttribute("aria-selected", state.approvalModelId === id ? "true" : "false");
                option.tabIndex = 0;

                var name = document.createElement("span");
                name.className = "permission-model-option-name";
                name.textContent = String(model.name || id);

                var provider = document.createElement("span");
                provider.className = "permission-model-option-provider";
                provider.textContent = String(model.provider || "");

                var check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                check.classList.add("permission-model-option-check");
                check.setAttribute("viewBox", "0 0 20 20");
                check.setAttribute("fill", "none");
                check.setAttribute("aria-hidden", "true");

                var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", "m4 10 4 4 8-8");
                path.setAttribute("stroke", "currentColor");
                path.setAttribute("stroke-width", "2");
                path.setAttribute("stroke-linecap", "round");
                path.setAttribute("stroke-linejoin", "round");
                check.appendChild(path);

                option.append(name, provider, check);
                section.appendChild(option);
            });

            menu.appendChild(section);
        });

        trigger.setAttribute("aria-expanded", state.modelMenuOpen ? "true" : "false");
        trigger.classList.toggle("is-open", state.modelMenuOpen);
        menu.hidden = !state.modelMenuOpen;
    }

    function groupModels() {
        var groups = [];
        var groupByProvider = Object.create(null);

        state.models.forEach(function (model) {
            var provider = String(model.provider || "其他").trim() || "其他";
            var key = provider.toLocaleLowerCase();
            var group = groupByProvider[key];

            if (!group) {
                group = { provider: provider, models: [] };
                groupByProvider[key] = group;
                groups.push(group);
            }

            group.models.push(model);
        });

        return groups;
    }

    function positionModelMenu() {
        if (!state.modelMenuOpen) {
            return;
        }

        var trigger = $("tool-permission-model-trigger");
        var menu = $("tool-permission-model-menu");

        if (!trigger || !menu) {
            return;
        }

        var rect = trigger.getBoundingClientRect();
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        var width = Math.min(rect.width, viewportWidth - 24);
        var maxHeight = Math.min(360, viewportHeight - 24);
        var menuHeight = Math.min(menu.scrollHeight, maxHeight);
        var spaceBelow = viewportHeight - rect.bottom - 6;
        var spaceAbove = rect.top - 6;
        var openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
        var top = openAbove ? rect.top - menuHeight - 6 : rect.bottom + 6;
        var left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));

        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(Math.max(12, Math.min(top, viewportHeight - menuHeight - 12))) + "px";
        menu.style.width = Math.round(width) + "px";
        menu.style.maxHeight = Math.round(maxHeight) + "px";
    }

    function openModelMenu() {
        if (!state.models.length) {
            return;
        }

        state.modelMenuOpen = true;
        renderModels();
        positionModelMenu();

        var selected = $("tool-permission-model-menu").querySelector('[aria-selected="true"]');

        if (selected) {
            selected.scrollIntoView({ block: "nearest" });
        }
    }

    function closeModelMenu() {
        state.modelMenuOpen = false;

        var trigger = $("tool-permission-model-trigger");
        var menu = $("tool-permission-model-menu");

        if (trigger) {
            trigger.setAttribute("aria-expanded", "false");
            trigger.classList.remove("is-open");
        }

        if (menu) {
            menu.hidden = true;
        }
    }

    function renderApprovalEvents() {
        var container = $("tool-permission-auto-events");

        if (!container) {
            return;
        }

        container.replaceChildren();
        container.classList.remove("permission-events-state", "is-error");

        if (state.eventsLoading) {
            container.textContent = "正在读取自动审批记录…";
            container.classList.add("permission-events-state");
            return;
        }

        if (state.eventsError) {
            container.textContent = state.eventsError;
            container.classList.add("permission-events-state", "is-error");
            return;
        }

        if (!state.approvalEvents.length) {
            container.textContent = "暂无自动审批记录。";
            container.classList.add("permission-events-state");
            return;
        }

        state.approvalEvents.forEach(function (event) {
            var item = document.createElement("article");
            item.className = "permission-event-item";

            var heading = document.createElement("div");
            heading.className = "permission-event-heading";

            var decision = document.createElement("span");
            decision.className = "permission-event-decision" + (event.decision === "allow" ? " is-approved" : " is-denied");
            decision.textContent = event.decision === "allow" ? "自动批准" : "自动拒绝";

            var operation = document.createElement("strong");
            operation.className = "permission-event-operation";
            operation.textContent = (event.operation === "command" ? "命令" : "写入") + " · " + String(event.tool || "未知工具");

            var timestamp = document.createElement("time");
            timestamp.className = "permission-event-time";
            timestamp.textContent = String(event.timestamp || "");

            heading.append(decision, operation, timestamp);

            var reason = document.createElement("p");
            reason.className = "permission-event-reason";
            reason.textContent = String(event.reason || (event.error_type ? "审批失败：" + event.error_type : "未返回审批理由"));

            var metadata = document.createElement("div");
            metadata.className = "permission-event-meta";
            var details = [];
            var tokenUsage = event.token_usage;

            if (tokenUsage && typeof tokenUsage === "object") {
                var inputTokens = Number(tokenUsage.input_tokens) || 0;
                var outputTokens = Number(tokenUsage.output_tokens) || 0;
                var totalTokens = Number(tokenUsage.total_tokens) || inputTokens + outputTokens;
                var tokenSummary = "Token " + totalTokens.toLocaleString() +
                    "（输入 " + inputTokens.toLocaleString() + " / 输出 " + outputTokens.toLocaleString() + "）";

                details.push(tokenSummary);

                if (tokenUsage.cached_input_tokens != null) {
                    details.push("缓存命中 " + (Number(tokenUsage.cached_input_tokens) || 0).toLocaleString());
                }
            } else {
                details.push("Token 用量未记录");
            }

            if (event.approval_model_id) {
                details.push("模型 " + String(event.approval_model_id));
            }

            if (event.duration_ms != null) {
                details.push("耗时 " + Number(event.duration_ms).toLocaleString() + " ms");
            }

            if (event.error_type && event.reason) {
                details.push("错误 " + String(event.error_type));
            }

            metadata.textContent = details.join(" · ");
            item.append(heading, reason, metadata);
            container.appendChild(item);
        });
    }

    function render() {
        renderModes();
        renderModels();
        renderApprovalEvents();
    }

    // 没有有效的已保存审批模型时，默认选用聊天页面当前模型。
    function defaultApprovalModelId() {
        var currentModelId = String(localStorage.getItem("selectedModel") || "").trim();

        return state.models.some(function (model) {
            return String(model.id || "") === currentModelId;
        }) ? currentModelId : "";
    }

    function reconcileApprovalModelId() {
        var hasSavedModel = state.models.some(function (model) {
            return String(model.id || "") === state.approvalModelId;
        });

        if (!hasSavedModel) {
            state.approvalModelId = defaultApprovalModelId();
        }
    }

    async function reload() {
        var eventsRequest = refreshApprovalEvents();
        var result = await request("GET");

        if (!(result.ok && result.data && result.data.success)) {
            throw new Error((result.data && result.data.message) || "无法读取工具权限设置");
        }

        state.mode = String(result.data.mode || "");
        state.approvalModelId = String(result.data.approval_model_id || "");
        state.models = Array.isArray(result.data.models) ? result.data.models : [];
        state.loaded = true;
        reconcileApprovalModelId();

        render();
        await eventsRequest;
    }

    async function refreshApprovalEvents() {
        state.eventsLoading = true;
        state.eventsError = "";
        renderApprovalEvents();

        try {
            var result = await request("GET", undefined, "/api/local/permissions/auto-approval-events");

            if (!(result.ok && result.data && result.data.success)) {
                throw new Error((result.data && result.data.message) || "无法读取自动审批记录");
            }

            state.approvalEvents = Array.isArray(result.data.events) ? result.data.events : [];
        } catch (error) {
            state.eventsError = String((error && error.message) || error || "无法读取自动审批记录");
        }

        state.eventsLoading = false;
        renderApprovalEvents();
    }

    async function refreshModels() {
        var result = await request("GET");

        if (!(result.ok && result.data && result.data.success)) {
            throw new Error((result.data && result.data.message) || "无法读取可用审批模型");
        }

        state.models = Array.isArray(result.data.models) ? result.data.models : [];
        reconcileApprovalModelId();

        renderModels();
    }

    async function save() {
        if (!state.loaded) {
            throw new Error("工具权限设置尚未加载完成");
        }

        var mode = selectedMode();

        if (!mode) {
            throw new Error("请选择工具权限模式");
        }

        if (mode === "auto" && !state.approvalModelId) {
            throw new Error("自动审批模式必须选择一个已配置模型");
        }

        var result = await request("POST", {
            mode: mode,
            approval_model_id: state.approvalModelId
        });

        if (!(result.ok && result.data && result.data.success)) {
            throw new Error((result.data && result.data.message) || "工具权限设置保存失败");
        }

        state.mode = mode;
        render();
        return true;
    }

    function bind() {
        var modeList = $("tool-permission-mode-list");
        var modelPicker = $("tool-permission-model-select");
        var modelTrigger = $("tool-permission-model-trigger");
        var modelMenu = $("tool-permission-model-menu");
        var eventsRefresh = $("tool-permission-events-refresh");

        if (modeList) {
            modeList.addEventListener("change", function (event) {
                if (event.target && event.target.name === "tool-permission-mode") {
                    state.mode = String(event.target.value || "");
                    renderModels();
                }
            });
        }

        if (modelPicker && modelTrigger && modelMenu) {
            modelTrigger.addEventListener("click", function () {
                if (state.modelMenuOpen) {
                    closeModelMenu();
                } else {
                    openModelMenu();
                }
            });

            modelMenu.addEventListener("click", function (event) {
                var button = event.target && event.target.closest ? event.target.closest("[data-model-id]") : null;

                if (!button) {
                    return;
                }

                state.approvalModelId = String(button.dataset.modelId || "");
                renderModels();
                closeModelMenu();
                modelTrigger.focus();
            });

            document.addEventListener("pointerdown", function (event) {
                if (state.modelMenuOpen && !modelPicker.contains(event.target)) {
                    closeModelMenu();
                }
            });

            document.addEventListener("keydown", function (event) {
                if (!state.modelMenuOpen) {
                    return;
                }

                if (event.key === "Escape") {
                    closeModelMenu();
                    modelTrigger.focus();
                    event.preventDefault();
                    return;
                }

                if (event.key === "Tab") {
                    closeModelMenu();
                    return;
                }

                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                    return;
                }

                if (document.activeElement !== modelTrigger && !modelMenu.contains(document.activeElement)) {
                    return;
                }

                var options = Array.from(modelMenu.querySelectorAll('[role="option"]'));

                if (!options.length) {
                    return;
                }

                var currentIndex = options.indexOf(document.activeElement);
                var nextIndex = currentIndex < 0
                    ? (event.key === "ArrowDown" ? 0 : options.length - 1)
                    : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;

                options[nextIndex].focus();
                event.preventDefault();
            });

            window.addEventListener("resize", positionModelMenu);
            window.addEventListener("scroll", positionModelMenu, true);
        }

        if (eventsRefresh) {
            eventsRefresh.addEventListener("click", refreshApprovalEvents);
        }
    }

    document.addEventListener("DOMContentLoaded", bind);

    window.NexoraToolPermissions = {
        reload: reload,
        refreshModels: refreshModels,
        refreshApprovalEvents: refreshApprovalEvents,
        save: save,
        isReady: function () {
            return state.loaded;
        }
    };
})();
