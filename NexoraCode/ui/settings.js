/**
 * settings.js — 本地设置页逻辑
 * 通过本地 server API 读写 Provider 列表与对话配置；自绘标题栏控制窗口。
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
                '  <div class="pi-meta">' + esc(provider.base_url || "") + " · " + esc(provider.model || "") + "</div>" +
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
                        state.providers = state.providers.filter(function (p) {
                            return p.id !== id;
                        });

                        if (state.defaultId === id) {
                            state.defaultId = "";
                        }

                        renderProviderList();
                    }
                });
            });
            listEl.appendChild(item);
        });
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
        $("provider-form").classList.remove("hidden");
    }

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
        $("provider-form").classList.remove("hidden");
    }

    function closeForm() {
        $("provider-form").classList.add("hidden");
        state.editingId = "";
    }

    function collectProviderForm() {
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
            max_tokens: parseInt($("pf-max-tokens").value, 10) || 4096
        };
    }

    // ===== 通用 =====

    function renderSettings(data) {
        if (!data || !data.success) {
            return;
        }

        var provider = data.provider || {};
        state.providers = provider.providers || [];
        state.defaultId = provider.default_id || "";

        var general = data.general || {};
        $("g-username").value = general.username || "local";

        renderProviderList();
    }

    function setStatus(text, ok) {
        var el = $("save-status");
        el.textContent = text;
        el.className = "status " + (ok ? "ok" : "err");
    }

    async function save() {
        var provider = state.providers.find(function (p) {
            return p.id === state.editingId;
        });

        if (state.editingId && provider) {
            var edited = collectProviderForm();
            var idx = state.providers.indexOf(provider);
            state.providers[idx] = Object.assign({}, provider, {
                name: edited.name,
                base_url: edited.base_url,
                model: edited.model,
                temperature: edited.temperature,
                max_tokens: edited.max_tokens,
                api_key: edited.api_key
            });
        }

        closeForm();

        var btn = $("btn-save");
        btn.disabled = true;
        setStatus("保存中…", true);

        var payload = {
            provider: {
                providers: state.providers,
                default_id: state.defaultId
            },
            general: {
                username: $("g-username").value.trim()
            }
        };

        var res = await api("/api/local/settings", "POST", payload);
        btn.disabled = false;

        if (res.ok && res.data && res.data.success) {
            setStatus("已保存 ✓", true);
            await load();
        } else {
            setStatus((res.data && res.data.message) || "保存失败", false);
        }
    }

    async function load() {
        var res = await api("/api/local/settings", "GET");
        renderSettings(res.data);
    }

    function esc(text) {
        var div = document.createElement("div");
        div.textContent = String(text == null ? "" : text);
        return div.innerHTML;
    }

    function init() {
        bindTitlebar();
        bindNav();

        $("btn-save").addEventListener("click", save);
        $("btn-add-provider").addEventListener("click", openCreate);
        $("pf-cancel").addEventListener("click", closeForm);
        $("pf-save").addEventListener("click", function () {
            var provider = state.providers.find(function (p) {
                return p.id === state.editingId;
            });

            if (!state.editingId || !provider) {
                var created = collectProviderForm();
                state.providers.push(created);

                if (!state.defaultId) {
                    state.defaultId = created.id;
                }

                renderProviderList();
            }

            save();
        });

        load();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
