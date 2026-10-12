(function () {
    "use strict";

    if (window.__NEXORA_PLUGIN_HOST_READY__) return;
    window.__NEXORA_PLUGIN_HOST_READY__ = true;

    var plugins = [];
    var pages = new Map();
    var navRefreshScheduled = false;
    var mountSelectors = {
        "chat.sidebar.toolbar": ".sidebar-toolbar",
        "chat.sidebar.footer": ".sidebar-footer",
        "chat.main": "#app"
    };

    function encodePath(path) {
        return String(path || "").split("/").map(encodeURIComponent).join("/");
    }

    function assetUrl(pluginId, path) {
        return "/nc/plugins/" + encodeURIComponent(pluginId) + "/" + encodePath(path);
    }

    function openPage(pluginId, page) {
        var key = pluginId + ":" + page.id;
        var old = document.getElementById("nexora-plugin-page-overlay");
        if (old) old.remove();

        var overlay = document.createElement("section");
        overlay.id = "nexora-plugin-page-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#101114;color:#f5f5f5;display:flex;flex-direction:column;";

        var bar = document.createElement("header");
        bar.style.cssText = "height:42px;flex:0 0 42px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.12);font:14px sans-serif;";
        var title = document.createElement("span");
        title.textContent = page.title || page.id;
        var close = document.createElement("button");
        close.type = "button";
        close.textContent = "关闭";
        close.setAttribute("aria-label", "关闭插件页面");
        close.style.cssText = "border:0;border-radius:6px;padding:6px 12px;background:rgba(255,255,255,.12);color:inherit;cursor:pointer;";
        close.addEventListener("click", function () { overlay.remove(); });
        bar.append(title, close);

        var frame = document.createElement("iframe");
        frame.title = page.title || page.id;
        frame.src = assetUrl(pluginId, page.entry);
        frame.style.cssText = "border:0;flex:1;width:100%;background:#fff;";
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads");
        overlay.append(bar, frame);
        document.body.appendChild(overlay);
        document.dispatchEvent(new CustomEvent("nexora:plugin-page-open", { detail: { pluginId: pluginId, pageId: key } }));
    }

    function addPage(pluginId, page) {
        if (!page || !page.id || !page.entry) return;
        var normalized = {
            id: String(page.id),
            title: String(page.title || page.id),
            entry: String(page.entry),
            icon: String(page.icon || "")
        };
        var key = pluginId + ":" + normalized.id;
        pages.set(key, { pluginId: pluginId, page: normalized });
        attachNavigationItem(key);
    }

    function attachNavigationItem(key) {
        var record = pages.get(key);
        if (!record) return;
        var container = document.querySelector(mountSelectors["chat.sidebar.toolbar"]);
        if (!container) container = document.querySelector("#sidebar");
        if (!container || container.querySelector('[data-nc-plugin-page="' + CSS.escape(key) + '"]')) return;

        var button = document.createElement("button");
        button.type = "button";
        button.className = "toolbar-item nc-plugin-toolbar-item";
        button.dataset.ncPluginPage = key;
        button.title = record.page.title;
        if (record.page.icon) {
            var icon = document.createElement("i");
            icon.className = record.page.icon;
            icon.setAttribute("aria-hidden", "true");
            button.appendChild(icon);
        }
        var label = document.createElement("span");
        label.textContent = record.page.title;
        button.appendChild(label);
        button.addEventListener("click", function () {
            openPage(record.pluginId, record.page);
        });
        container.appendChild(button);
    }

    function refreshPageNavigation() {
        if (navRefreshScheduled) return;
        navRefreshScheduled = true;
        window.requestAnimationFrame(function () {
            navRefreshScheduled = false;
            pages.forEach(function (_, key) { attachNavigationItem(key); });
        });
    }

    var navObserver = new MutationObserver(refreshPageNavigation);
    navObserver.observe(document.documentElement, { childList: true, subtree: true });

    function mount(slot, renderer, pluginId) {
        var selector = mountSelectors[String(slot || "")];
        if (!selector || typeof renderer !== "function") return function () {};
        var cancelled = false;
        var mountedNode = null;

        function attempt() {
            if (cancelled || mountedNode) return;
            var target = document.querySelector(selector);
            if (!target) return;
            try {
                var output = renderer({ pluginId: pluginId, host: target });
                if (output instanceof Node) {
                    mountedNode = output;
                    if (mountedNode instanceof Element) {
                        mountedNode.dataset.ncPluginOwner = pluginId;
                    }
                    target.appendChild(mountedNode);
                }
            } catch (error) {
                console.error("[NexoraPlugin] mount failed", pluginId, slot, error);
            }
        }

        attempt();
        var observer = new MutationObserver(attempt);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        return function () {
            cancelled = true;
            observer.disconnect();
            if (mountedNode) mountedNode.remove();
        };
    }

    var host = {
        mount: mount,
        addPage: addPage,
        openPage: function (pluginId, pageId) {
            var record = pages.get(String(pluginId) + ":" + String(pageId));
            if (record) openPage(record.pluginId, record.page);
        },
        request: function (path, options) {
            return fetch(path, Object.assign({ credentials: "include" }, options || {}));
        },
        assetUrl: assetUrl,
        getPlugins: function () { return plugins.slice(); }
    };
    window.NexoraPluginHost = host;

    function loadPlugin(plugin) {
        (plugin.styles || []).forEach(function (stylePath) {
            var link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = assetUrl(plugin.id, stylePath);
            link.dataset.ncPluginOwner = plugin.id;
            document.head.appendChild(link);
        });
        (plugin.pages || []).forEach(function (page) { addPage(plugin.id, page); });
        (plugin.scripts || []).forEach(function (scriptPath) {
            var source = assetUrl(plugin.id, scriptPath);
            var pluginApi = Object.assign({}, host, {
                pluginId: plugin.id,
                plugin: plugin,
                mount: function (slot, renderer) { return host.mount(slot, renderer, plugin.id); },
                addPage: function (page) { return host.addPage(plugin.id, page); },
                openPage: function (pageId) { return host.openPage(plugin.id, pageId); },
                assetUrl: function (path) { return assetUrl(plugin.id, path); }
            });
            import(source).then(function (module) {
                var register = module.register || module.default;
                if (typeof register === "function") {
                    return register(pluginApi);
                }
            }).catch(function (error) {
                console.error("[NexoraPlugin] load failed", plugin.id, scriptPath, error);
            });
        });
    }

    function start() {
        host.request("/api/local/plugins/ui")
            .then(function (response) { return response.json(); })
            .then(function (payload) {
                plugins = payload && Array.isArray(payload.plugins) ? payload.plugins : [];
                plugins.forEach(loadPlugin);
            })
            .catch(function (error) { console.warn("[NexoraPlugin] plugin list unavailable", error); });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
