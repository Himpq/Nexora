/**
 * settings.js — 本地设置页逻辑
 *
 * 状态模型：state 是唯一数据源（providers / defaultId / editingId）。
 * 统一同步机制：
 *   1) 表单写入 state（applyForm）
 *   2) POST 持久化（persist）
 *   3) 从服务端刷新 state（reload）
 *   4) 同步主窗口模型下拉（syncMainWindow）
 * 两个保存按钮都走同一入口，可复用于后续新增配置项。
 */
(function () {
    "use strict";

    var $ = function (id) {
        return document.getElementById(id);
    };

    var state = {
        providers: [],
        defaultId: "",
        editingId: "",
        keySourceId: "",
        theme: "system"
    };

    // ===== API =====

    async function api(url, method, body) {
        var opts = { method: method, credentials: "include", headers: {} };

        if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }

        var resp = await fetch(url, opts);
        var data = null;

        try {
            data = await resp.json();
        } catch (_) {
            data = null;
        }

        return { ok: resp.ok, data: data };
    }

    window.NexoraSettingsApi = { request: api };

    // ===== 标题栏 =====

    function bindTitlebar() {
        var bar = document.getElementById("nc-titlebar");

        if (!bar) {
            return;
        }

        bar.querySelectorAll(".tb-btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var act = String(btn.dataset.act || "");
                var bridge = window.pywebview && window.pywebview.api;

                if (!bridge) {
                    return;
                }

                if (act === "min") {
                    bridge.minimize_settings_window();
                } else if (act === "max") {
                    bridge.maximize_settings_window();
                } else if (act === "close") {
                    bridge.close_settings_window();
                }
            });
        });

        bar.addEventListener("mousedown", function (e) {
            if (e.button !== 0) {
                return;
            }

            if (e.target && e.target.closest && e.target.closest(".tb-btns")) {
                return;
            }

            var bridge = window.pywebview && window.pywebview.api;

            if (bridge && bridge.start_settings_window_drag) {
                bridge.start_settings_window_drag();
            }
        });
    }

    /** Keep the sidebar selection in sync with the shared scroll page. */
    function bindNav() {
        var content = document.querySelector(".content");
        var sections = Array.from(content.querySelectorAll(":scope > .view"));
        var navItems = Array.from(document.querySelectorAll(".nav-item[data-view], .nav-subitem[data-view]"));
        var currentView = "";

        function expandStatisticsGroup() {
            var statisticsGroup = $("statistics-nav-group");
            var statisticsToggle = $("statistics-nav-toggle");

            statisticsGroup.classList.remove("is-collapsed");
            statisticsToggle.setAttribute("aria-expanded", "true");
        }

        function setActiveNav(view) {
            navItems.forEach(function (item) {
                var active = String(item.dataset.view || "") === view;

                item.classList.toggle("active", active);

                if (active) {
                    item.setAttribute("aria-current", "location");
                } else {
                    item.removeAttribute("aria-current");
                }
            });
        }

        function scrollToView(view) {
            var target = $("view-" + view);

            if (view === "statistics") {
                expandStatisticsGroup();
            }

            target.scrollIntoView({ behavior: "smooth", block: "start" });
            setActiveNav(view);
            currentView = view;
        }

        navItems.forEach(function (item) {
            item.addEventListener("click", function () {
                scrollToView(String(item.dataset.view || ""));
            });
        });

        document.querySelectorAll(".nav-group-toggle").forEach(function (trigger) {
            trigger.addEventListener("click", function () {
                var expanded = trigger.getAttribute("aria-expanded") === "true";

                trigger.setAttribute("aria-expanded", expanded ? "false" : "true");
                trigger.closest(".nav-group").classList.toggle("is-collapsed", expanded);
            });
        });

        function updateActiveSection() {
            var marker = content.getBoundingClientRect().top + 40;
            var current = sections[0];

            if (content.scrollTop + content.clientHeight >= content.scrollHeight - 1) {
                current = sections[sections.length - 1];
            } else {
                sections.forEach(function (section) {
                    if (section.getBoundingClientRect().top <= marker) {
                        current = section;
                    }
                });
            }

            var view = current.id.slice("view-".length);

            if (view === "statistics" && currentView !== "statistics") {
                expandStatisticsGroup();
            }

            setActiveNav(view);
            currentView = view;
        }

        content.addEventListener("scroll", updateActiveSection, { passive: true });
        window.addEventListener("resize", updateActiveSection);
        updateActiveSection();
    }

    // ===== 工具 =====

    function esc(text) {
        var div = document.createElement("div");
        div.textContent = String(text == null ? "" : text);
        return div.innerHTML;
    }

    function setStatus(text, ok) {
        var el = $("save-status");
        el.textContent = text;
        el.className = "status " + (ok ? "ok" : "err");
    }

    // ===== Provider 表单 =====

    function setThinkingProtocol(protocol) {
        var container = $("pf-thinking-protocol");
        var options = container.querySelectorAll("[data-protocol]");
        var hasProtocol = Array.prototype.some.call(options, function (option) {
            return option.dataset.protocol === protocol;
        });

        options.forEach(function (option) {
            option.setAttribute("aria-pressed", String(hasProtocol && option.dataset.protocol === protocol));
        });
    }

    function getThinkingProtocol() {
        var selected = $("pf-thinking-protocol").querySelector('[aria-pressed="true"]');

        return selected ? String(selected.dataset.protocol || "") : "";
    }

    function collapseAdvancedProviderFields() {
        $("provider-advanced-fields").open = false;
    }

    function openCreate() {
        state.editingId = "";
        state.keySourceId = "";
        $("pf-title").textContent = "新增 Provider";
        $("pf-api-key").value = "";
        $("pf-api-key").placeholder = "API Key";
        $("pf-key-hint").textContent = "";
        $("pf-model").value = "";
        $("pf-temperature").value = 0.7;
        $("pf-max-tokens").value = 4096;
        $("pf-context-window").value = 128000;
        setThinkingProtocol("none");
        window.NexoraProviderSettings.selectTemplate("custom", { name: "", base_url: "" });
        collapseAdvancedProviderFields();

        $("provider-form").classList.remove("hidden");
        $("pf-name").focus();
    }

    function openEdit(providerId) {
        var provider = state.providers.find(function (p) {
            return p.id === providerId;
        });

        if (!provider) {
            return;
        }

        state.editingId = providerId;
        state.keySourceId = providerId;
        $("pf-title").textContent = "编辑 Provider";
        $("pf-api-key").value = "";
        $("pf-api-key").placeholder = provider.has_api_key ? "留空保留已保存的 Key" : "API Key";
        $("pf-key-hint").textContent = provider.has_api_key
            ? "API Key 已保存；留空表示保持不变，填写新 Key 可替换。"
            : "未配置 API Key。";
        $("pf-model").value = provider.model || "";
        $("pf-temperature").value = provider.temperature != null ? provider.temperature : 0.7;
        $("pf-max-tokens").value = provider.max_tokens || 4096;
        $("pf-context-window").value = provider.context_window || 0;
        setThinkingProtocol(provider.thinking_protocol || "none");
        window.NexoraProviderSettings.selectTemplate(provider.template_id || "custom", {
            name: provider.name || "",
            base_url: provider.base_url || ""
        });
        collapseAdvancedProviderFields();
        $("provider-form").classList.remove("hidden");
        $("pf-model").focus();
    }

    function closeForm() {
        $("provider-form").classList.add("hidden");
        state.editingId = "";
        state.keySourceId = "";
        window.NexoraProviderSettings.closeModelDialog();
    }

    /** 基于指定 Provider 复用接入信息添加新模型（只需改 Model 名）。 */
    function openCreateFromProvider(providerId) {
        var provider = state.providers.find(function (p) {
            return p.id === providerId;
        });

        if (!provider) {
            return;
        }

        state.editingId = "";
        state.keySourceId = (provider.has_api_key || provider.api_key) ? providerId : "";
        $("pf-title").textContent = "新增模型";
        $("pf-api-key").value = "";
        $("pf-api-key").placeholder = state.keySourceId ? "留空沿用该 Provider 的 Key" : "API Key";
        $("pf-key-hint").textContent = state.keySourceId
            ? "将由本机安全复用已保存的 Key。"
            : "源 Provider 未保存 Key，请填写 API Key。";
        $("pf-model").value = "";
        $("pf-temperature").value = provider.temperature != null ? provider.temperature : 0.7;
        $("pf-max-tokens").value = provider.max_tokens || 4096;
        $("pf-context-window").value = provider.context_window || 128000;
        setThinkingProtocol(provider.thinking_protocol || "none");
        window.NexoraProviderSettings.selectTemplate(provider.template_id || "custom", {
            name: provider.name || "",
            base_url: provider.base_url || ""
        });
        collapseAdvancedProviderFields();
        $("provider-form").classList.remove("hidden");
        $("pf-model").focus();
    }

    /** 从表单读取字段（id 使用 editingId，新增时生成临时 id）。 */
    function collectForm() {
        var id = state.editingId;

        if (!id) {
            id = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }

        return {
            id: id,
            name: $("pf-name").value.trim(),
            base_url: $("pf-base-url").value.trim(),
            api_key: $("pf-api-key").value.trim(),
            model: $("pf-model").value.trim(),
            template_id: window.NexoraProviderSettings.getSelectedId(),
            key_source_id: state.keySourceId,
            temperature: parseFloat($("pf-temperature").value) || 0.7,
            max_tokens: parseInt($("pf-max-tokens").value, 10) || 4096,
            context_window: parseInt($("pf-context-window").value, 10) || 0,
            thinking_protocol: getThinkingProtocol()
        };
    }

    /** 把表单写回 state：仅当表单打开（正在编辑/新增）时执行，避免隐藏表单残留被误写。 */
    function applyForm() {
        if ($("provider-form").classList.contains("hidden")) {
            return;
        }

        var edited = collectForm();

        if (state.editingId) {
            var index = state.providers.findIndex(function (p) {
                return p.id === state.editingId;
            });

            if (index >= 0) {
                var old = state.providers[index];
                state.providers[index] = Object.assign({}, old, {
                    name: edited.name,
                    base_url: edited.base_url,
                    model: edited.model,
                    template_id: edited.template_id,
                    key_source_id: edited.key_source_id,
                    temperature: edited.temperature,
                    max_tokens: edited.max_tokens,
                    context_window: edited.context_window,
                    thinking_protocol: edited.thinking_protocol
                });

                if (edited.api_key) {
                    state.providers[index].api_key = edited.api_key;
                    state.providers[index].has_api_key = true;
                }
            }
        } else {
            edited.has_api_key = Boolean(edited.api_key || edited.key_source_id);
            state.providers.push(edited);

            if (!state.defaultId) {
                state.defaultId = edited.id;
            }
        }
    }

    // ===== Provider 列表 =====

    function renderProviderList() {
        var listEl = $("provider-list");
        listEl.innerHTML = "";

        if (!state.providers.length) {
            listEl.innerHTML = '<div class="provider-empty">尚未配置 Provider，点击下方按钮新增。</div>';
            return;
        }

        state.providers.forEach(function (provider) {
            var item = document.createElement("div");
            item.className = "provider-item" + (provider.id === state.defaultId ? " default" : "");
            item.innerHTML =
                '<div class="pi-main">' +
                '  <div class="pi-heading">' +
                '    <span class="pi-name">' + esc(provider.name || provider.id) + "</span>" +
                (provider.id === state.defaultId ? ' <span class="pi-default">默认</span>' : "") +
                "  </div>" +
                '  <div class="pi-details">' +
                '    <span class="pi-model">' + esc(provider.model || "") + "</span>" +
                '    <span class="pi-url">' + esc(provider.base_url || "") + "</span>" +
                "  </div>" +
                "</div>" +
                '<div class="pi-actions">' +
                (provider.id !== state.defaultId
                    ? '<button type="button" class="pi-btn" data-act="default" data-id="' + esc(provider.id) + '" aria-label="设为默认" title="设为默认"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.75 1.95 3.96 4.37.64-3.16 3.08.75 4.35L8 11.73l-3.91 2.05.75-4.35-3.16-3.08 4.37-.64L8 1.75Z"/></svg></button>'
                    : "") +
                '<button type="button" class="pi-btn" data-act="add-model" data-id="' + esc(provider.id) + '" aria-label="添加模型" title="添加模型"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v9.5M3.25 8h9.5"/></svg></button>' +
                '<button type="button" class="pi-btn" data-act="edit" data-id="' + esc(provider.id) + '" aria-label="编辑" title="编辑"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 11.2-.5 2.3 2.3-.5 7.5-7.5a1.27 1.27 0 0 0-1.8-1.8L3 11.2Z"/><path d="m9.5 4.5 2 2"/></svg></button>' +
                '<button type="button" class="pi-btn danger" data-act="remove" data-id="' + esc(provider.id) + '" aria-label="删除" title="删除"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6 4.5V3h4v1.5m1.5 0-.6 8.5h-5.8l-.6-8.5M6.5 7v4m3-4v4"/></svg></button>' +

            "</div>";

            item.querySelectorAll(".pi-btn").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    var act = String(btn.dataset.act || "");
                    var id = String(btn.dataset.id || "");

                    if (act === "default") {
                        state.defaultId = id;
                        renderProviderList();
                    } else if (act === "edit") {
                        openEdit(id);
                    } else if (act === "remove") {
                        removeProvider(id);
                    } else if (act === "add-model") {
                        openCreateFromProvider(id);
                    }
                });
            });
            listEl.appendChild(item);
        });
    }

    function removeProvider(id) {
        closeForm();
        state.providers = state.providers.filter(function (p) {
            return p.id !== id;
        });

        if (state.defaultId === id) {
            state.defaultId = state.providers.length ? state.providers[0].id : "";
        }

        renderProviderList();
    }

    // ===== 持久化 + 同步（统一机制，可复用） =====

    var CUSTOM_PROMPT_LIMIT = 8000;

    var THEME_PREFERENCES = ["light", "dark", "system"];

    /** 主题档位守卫：非法值一律回落到 system。 */
    function normalizeTheme(value) {
        var text = String(value || "").trim().toLowerCase();

        return THEME_PREFERENCES.indexOf(text) >= 0 ? text : "system";
    }

    /** 把偏好解析成实际主题（system 走系统外观探测）。 */
    function resolveTheme(preference) {
        if (preference !== "system") {
            return preference;
        }

        try {
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        } catch (_) {
            return "light";
        }
    }

    /**
     * 把主题落到设置页自身：设置页与主窗口共用一套偏好，
     * 用户在这里选深色时页面应立即变暗，否则无法判断效果。
     */
    function applyThemeToDocument(preference) {
        var resolved = resolveTheme(normalizeTheme(preference));

        if (resolved === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
    }

    /** 渲染主题三选的选中态。 */
    function renderThemeOptions() {
        var group = $("g-theme");

        if (!group) {
            return;
        }

        group.querySelectorAll("[data-theme]").forEach(function (button) {
            var active = String(button.dataset.theme || "") === state.theme;

            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    /** 点击主题选项：只改 state，落库仍由「保存设置」统一提交。 */
    function bindThemeOptions() {
        var group = $("g-theme");

        if (!group) {
            return;
        }

        group.addEventListener("click", function (event) {
            var target = event.target;
            var button = target instanceof Element ? target.closest("[data-theme]") : null;

            if (!button || !group.contains(button)) {
                return;
            }

            state.theme = normalizeTheme(button.dataset.theme);
            renderThemeOptions();
            // 即时预览：设置页自身跟随选择切换，便于确认效果
            applyThemeToDocument(state.theme);
        });

        // system 档位下跟随系统外观变化实时刷新设置页
        try {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
                if (state.theme === "system") {
                    applyThemeToDocument(state.theme);
                }
            });
        } catch (_) {}
    }

    /** 刷新自定义提示词字符计数（nowLen / 8000）。 */
    function updateCustomPromptCount() {
        var field = $("g-custom-prompt");
        var counter = $("g-custom-prompt-count");

        if (!field || !counter) {
            return;
        }

        counter.textContent = String(field.value.length);
        counter.parentElement.classList.toggle("is-over-limit", field.value.length > CUSTOM_PROMPT_LIMIT);
    }

    function persistPayload() {
        return {
            provider: {
                providers: state.providers,
                default_id: state.defaultId
            },
            general: {
                username: $("g-username").value.trim(),
                custom_system_prompt: $("g-custom-prompt").value,
                read_agents_md: $("g-read-agents-md").checked,
                tool_auto_expand: $("g-tool-auto-expand").checked,
                telemetry_enabled: $("g-telemetry-enabled").checked,
                theme: state.theme,
                auto_retry_count: Number($("g-auto-retry-count").value),
                empty_response_retry_count: Number($("g-empty-response-retry-count").value)
            }
        };
    }

    function syncMainWindow() {
        var bridge = window.pywebview && window.pywebview.api;

        if (bridge && bridge.refresh_main_window) {
            bridge.refresh_main_window();
        }
    }

    function forgetProviderApiKeys() {
        state.providers.forEach(function (provider) {
            if (provider.api_key) {
                provider.has_api_key = true;
                delete provider.api_key;
            }
        });
    }

    async function persist() {
        var res = await api("/api/local/settings", "POST", persistPayload());

        if (!(res.ok && res.data && res.data.success)) {
            setStatus((res.data && res.data.message) || "保存失败", false);
            return false;
        }

        return true;
    }

    /** 从服务端刷新 state 并渲染。 */
    async function reload() {
        var res = await api("/api/local/settings", "GET");

        if (!(res.ok && res.data && res.data.success)) {
            return;
        }

        var provider = res.data.provider || {};
        state.providers = provider.providers || [];
        state.defaultId = provider.default_id || "";
        var general = res.data.general || {};
        $("g-username").value = general.username || "local";
        $("g-custom-prompt").value = general.custom_system_prompt || "";
        updateCustomPromptCount();
        $("g-read-agents-md").checked = general.read_agents_md !== false;
        $("g-tool-auto-expand").checked = general.tool_auto_expand !== false;
        $("g-telemetry-enabled").checked = general.telemetry_enabled !== false;
        state.theme = normalizeTheme(general.theme);
        renderThemeOptions();
        applyThemeToDocument(state.theme);
        $("g-auto-retry-count").value = general.auto_retry_count != null ? general.auto_retry_count : 5;
        $("g-empty-response-retry-count").value = general.empty_response_retry_count != null
            ? general.empty_response_retry_count
            : 2;
        renderProviderList();
    }

    /** 统一保存入口：写回 state → 持久化 → 刷新 → 同步主窗口。 */
    async function save() {
        var btn = $("btn-save");

        if (
            !$("provider-form").classList.contains("hidden")
            && window.NexoraProviderSettings.getSelectedId() !== "custom"
            && !window.NexoraProviderSettings.areTemplatesLoaded()
        ) {
            setStatus("Provider 模板仍在加载，完成后再保存模型设置", false);
            return;
        }

        if (!window.NexoraToolPermissions.isReady()) {
            setStatus("工具权限设置仍在加载，请稍后保存", false);
            return;
        }

        var invalidRetryField = [
            $("g-auto-retry-count"),
            $("g-empty-response-retry-count")
        ].find(function (field) {
            return !field.checkValidity();
        });

        if (invalidRetryField) {
            setStatus("重试次数需要是 0 到 10 之间的整数", false);
            invalidRetryField.focus();
            return;
        }

        btn.disabled = true;
        setStatus("保存中…", true);

        applyForm();
        closeForm();
        renderProviderList();

        var ok = await persist();

        if (ok) {
            forgetProviderApiKeys();

            try {
                await window.NexoraToolPermissions.refreshModels();
                await window.NexoraToolPermissions.save();
                await reload();
                await window.NexoraToolPermissions.reload();
                setStatus("已保存 ✓", true);
                $("pf-api-key").value = "";
                syncMainWindow();
            } catch (error) {
                setStatus(String((error && error.message) || error || "设置保存失败"), false);
            }
        }

        btn.disabled = false;
    }

    // ===== 初始化 =====

    function init() {
        bindTitlebar();
        bindNav();
        window.NexoraProviderSettings.init({
            getContext: function () {
                return {
                    providerId: state.editingId,
                    keySourceId: state.keySourceId
                };
            },
            setModel: function (model) {
                $("pf-model").value = String(model || "");
            }
        });

        $("btn-save").addEventListener("click", save);
        $("btn-add-provider").addEventListener("click", openCreate);
        $("pf-cancel").addEventListener("click", closeForm);
        $("pf-save").addEventListener("click", save);
        $("pf-thinking-protocol").addEventListener("click", function (event) {
            var target = event.target;
            var button = target instanceof Element ? target.closest("[data-protocol]") : null;

            if (button && $("pf-thinking-protocol").contains(button)) {
                setThinkingProtocol(button.dataset.protocol || "");
            }
        });

        $("g-custom-prompt").addEventListener("input", updateCustomPromptCount);
        bindThemeOptions();

        reload();
        window.NexoraToolPermissions.reload().catch(function (error) {
            setStatus(String((error && error.message) || error || "无法读取工具权限设置"), false);
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
