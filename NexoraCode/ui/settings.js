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
        editingId: ""
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

    function bindNav() {
        document.querySelectorAll(".nav-item").forEach(function (item) {
            item.addEventListener("click", function () {
                var view = String(item.dataset.view || "");

                document.querySelectorAll(".nav-item").forEach(function (n) {
                    n.classList.toggle("active", n === item);
                });

                document.querySelectorAll(".view").forEach(function (v) {
                    v.classList.toggle("active", v.id === "view-" + view);
                });
            });
        });
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

    function openCreate() {
        state.editingId = "";
        $("pf-title").textContent = "新增 Provider";
        $("pf-name").value = "";
        $("pf-base-url").value = "";
        $("pf-api-key").value = "";
        $("pf-api-key").placeholder = "API Key";
        $("pf-key-hint").textContent = "";
        $("pf-model").value = "";
        $("pf-temperature").value = 0.7;
        $("pf-max-tokens").value = 4096;
        $("pf-context-window").value = 128000;
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
        $("pf-title").textContent = "编辑 Provider";
        $("pf-name").value = provider.name || "";
        $("pf-base-url").value = provider.base_url || "";
        $("pf-api-key").value = "";
        $("pf-api-key").placeholder = "留空保持不变";
        $("pf-key-hint").textContent = provider.has_api_key ? "已配置，留空保持不变" : "未配置";
        $("pf-model").value = provider.model || "";
        $("pf-temperature").value = provider.temperature != null ? provider.temperature : 0.7;
        $("pf-max-tokens").value = provider.max_tokens || 4096;
        $("pf-context-window").value = provider.context_window || 0;
        $("provider-form").classList.remove("hidden");
        $("pf-name").focus();
    }

    function closeForm() {
        $("provider-form").classList.add("hidden");
        state.editingId = "";
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
            temperature: parseFloat($("pf-temperature").value) || 0.7,
            max_tokens: parseInt($("pf-max-tokens").value, 10) || 4096,
            context_window: parseInt($("pf-context-window").value, 10) || 0
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
                    temperature: edited.temperature,
                    max_tokens: edited.max_tokens,
                    context_window: edited.context_window
                });

                if (edited.api_key) {
                    state.providers[index].api_key = edited.api_key;
                }
            }
        } else {
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
                '  <div class="pi-name">' + esc(provider.name || provider.id) + (provider.id === state.defaultId ? ' <span class="pi-default">默认</span>' : "") + "</div>" +
                '  <div class="pi-model">' + esc(provider.model || "") + "</div>" +
                '  <div class="pi-url">' + esc(provider.base_url || "") + "</div>" +
                "</div>" +
                '<div class="pi-actions">' +
                (provider.id !== state.defaultId ? '<button type="button" class="pi-btn" data-act="default" data-id="' + esc(provider.id) + '">设为默认</button>' : "") +
                '<button type="button" class="pi-btn" data-act="edit" data-id="' + esc(provider.id) + '">编辑</button>' +
                '<button type="button" class="pi-btn danger" data-act="remove" data-id="' + esc(provider.id) + '">删除</button>' +
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

    function persistPayload() {
        return {
            provider: {
                providers: state.providers,
                default_id: state.defaultId
            },
            general: {
                username: $("g-username").value.trim()
            }
        };
    }

    function syncMainWindow() {
        var bridge = window.pywebview && window.pywebview.api;

        if (bridge && bridge.refresh_main_window) {
            bridge.refresh_main_window();
        }
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
        $("g-username").value = (res.data.general || {}).username || "local";
        renderProviderList();
    }

    /** 统一保存入口：写回 state → 持久化 → 刷新 → 同步主窗口。 */
    async function save() {
        var btn = $("btn-save");
        btn.disabled = true;
        setStatus("保存中…", true);

        applyForm();
        closeForm();
        renderProviderList();

        var ok = await persist();

        if (ok) {
            await reload();
            setStatus("已保存 ✓", true);
            $("pf-api-key").value = "";
            syncMainWindow();
        }

        btn.disabled = false;
    }

    // ===== 初始化 =====

    function init() {
        bindTitlebar();
        bindNav();

        $("btn-save").addEventListener("click", save);
        $("btn-add-provider").addEventListener("click", openCreate);
        $("pf-cancel").addEventListener("click", closeForm);
        $("pf-save").addEventListener("click", save);

        reload();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
