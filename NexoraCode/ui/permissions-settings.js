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
        loaded: false
    };

    async function request(method, body) {
        var options = {
            method: method,
            credentials: "include",
            headers: {}
        };

        if (body !== undefined) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        var response = await fetch("/api/local/permissions", options);
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
        var container = $("tool-permission-model-list");
        var panel = $("tool-permission-approval");
        var enabled = state.mode === "auto";

        if (!container || !panel) {
            return;
        }

        panel.classList.toggle("is-disabled", !enabled);
        container.setAttribute("aria-disabled", enabled ? "false" : "true");

        if (!state.models.length) {
            container.innerHTML = "<div class=\"permission-model-empty\">还没有可用模型。请先在“模型 Provider”中配置模型。</div>";
            return;
        }

        container.innerHTML = state.models.map(function (model) {
            var id = String(model.id || "");
            var pressed = state.approvalModelId === id ? "true" : "false";

            return "<button type=\"button\" class=\"permission-model-option\" data-model-id=\"" + escapeHtml(id) + "\" aria-pressed=\"" + pressed + "\">" +
                "<span class=\"permission-model-name\">" + escapeHtml(model.name || id) + "</span>" +
                "<span class=\"permission-model-provider\">" + escapeHtml(model.provider || "") + "</span>" +
                "</button>";
        }).join("");
    }

    function render() {
        renderModes();
        renderModels();
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
        var modelList = $("tool-permission-model-list");

        if (modeList) {
            modeList.addEventListener("change", function (event) {
                if (event.target && event.target.name === "tool-permission-mode") {
                    state.mode = String(event.target.value || "");
                    renderModels();
                }
            });
        }

        if (modelList) {
            modelList.addEventListener("click", function (event) {
                var button = event.target && event.target.closest ? event.target.closest("[data-model-id]") : null;

                if (!button) {
                    return;
                }

                state.approvalModelId = String(button.dataset.modelId || "");
                renderModels();
            });
        }
    }

    document.addEventListener("DOMContentLoaded", bind);

    window.NexoraToolPermissions = {
        reload: reload,
        refreshModels: refreshModels,
        save: save,
        isReady: function () {
            return state.loaded;
        }
    };
})();
