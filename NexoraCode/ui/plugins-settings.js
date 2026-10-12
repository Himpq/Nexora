(function () {
    "use strict";

    var root = document.getElementById("plugin-list");
    if (!root) return;

    function node(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text != null) element.textContent = String(text);
        return element;
    }

    async function request(url, method, body) {
        var options = { method: method, credentials: "include", headers: {} };
        if (body !== undefined) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }
        var response = await fetch(url, options);
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload.success) {
            throw new Error(payload.message || "插件请求失败");
        }
        return payload;
    }

    function appendField(form, key, rule, value, secretsSet) {
        var label = node("label", "plugin-settings-field");
        var title = node("span", "", rule.title || key);
        if (Array.isArray(rule.enum) && rule.enum.length) {
            var select = node("select");
            rule.enum.forEach(function (optionValue, index) {
                var option = node("option", "", optionValue);
                option.value = String(index);
                option.dataset.settingValue = JSON.stringify(optionValue);
                option.selected = JSON.stringify(value) === JSON.stringify(optionValue);
                select.appendChild(option);
            });
            select.dataset.settingKey = key;
            label.append(title, select);
        } else if (rule.type === "boolean") {
            var toggle = node("input");
            toggle.type = "checkbox";
            toggle.checked = value === true;
            toggle.dataset.settingKey = key;
            label.append(title, toggle);
        } else {
            var input = node("input");
            var isSecret = rule.secret === true || rule.type === "password";
            input.type = isSecret ? "password" : (rule.type === "integer" || rule.type === "number" ? "number" : "text");
            input.value = isSecret ? "" : (value == null ? "" : String(value));
            input.dataset.settingKey = key;
            if (input.type === "number") {
                if (rule.minimum != null) input.min = String(rule.minimum);
                if (rule.maximum != null) input.max = String(rule.maximum);
                if (rule.type === "integer") input.step = "1";
            }
            if (isSecret && secretsSet.indexOf(key) >= 0) input.placeholder = "已配置；留空则保留原值";
            else if (rule.placeholder) input.placeholder = String(rule.placeholder);
            label.append(title, input);
        }
        if (rule.description) label.appendChild(node("small", "", rule.description));
        form.appendChild(label);
    }

    async function renderPlugin(plugin) {
        var card = node("article", "plugin-card");
        var header = node("div", "plugin-card-header");
        var titleGroup = node("div", "plugin-card-title-row");
        var title = node("h2", "plugin-card-title", plugin.name);
        var meta = node("span", "plugin-card-meta", "v" + (plugin.version || "?"));
        titleGroup.append(title, meta);

        var toggleLabel = node("label", "plugin-enabled-toggle");
        var toggle = node("input");
        toggle.type = "checkbox";
        toggle.checked = plugin.enabled === true;
        toggle.disabled = Boolean(plugin.error) && plugin.enabled !== true;
        toggleLabel.append(toggle, node("span", "", "启用"));
        header.append(titleGroup, toggleLabel);

        var description = node("p", "plugin-card-description", plugin.description || "");
        var status = node("p", "plugin-card-status", plugin.error || (plugin.active ? "已加载" : (plugin.enabled ? "重启后加载" : "已安装，当前停用")));
        if (plugin.error) status.classList.add("is-error");
        card.append(header, description, status);

        var tags = node("div", "plugin-card-tags");
        var surfaces = Array.isArray(plugin.surfaces) ? plugin.surfaces : ["local"];
        if (surfaces.indexOf("local") >= 0) tags.appendChild(node("span", "plugin-tag", "本地 Agent"));
        if (surfaces.indexOf("remote") >= 0) tags.appendChild(node("span", "plugin-tag", "远程范围已声明 · 仅只读工具可调用"));
        (Array.isArray(plugin.capabilities) ? plugin.capabilities : []).forEach(function (capability) {
            var labels = { network: "网络能力", command: "命令能力" };
            tags.appendChild(node("span", "plugin-tag plugin-tag-capability", labels[capability] || String(capability)));
        });
        if (tags.childElementCount) card.appendChild(tags);

        toggle.addEventListener("change", async function () {
            toggle.disabled = true;
            try {
                var result = await request("/api/local/plugins/" + encodeURIComponent(plugin.id) + "/enabled", "POST", { enabled: toggle.checked });
                status.textContent = result.message || "状态已保存，重启后生效";
                plugin.enabled = toggle.checked;
            } catch (error) {
                toggle.checked = !toggle.checked;
                status.textContent = error.message || "插件状态保存失败";
                status.classList.add("is-error");
            } finally {
                toggle.disabled = Boolean(plugin.error) && plugin.enabled !== true;
            }
        });

        try {
            var settings = await request("/api/local/plugins/" + encodeURIComponent(plugin.id) + "/settings", "GET");
            var schema = settings.schema || {};
            var properties = schema.properties || {};
            var keys = Object.keys(properties);
            if (!keys.length) {
                card.appendChild(node("p", "plugin-settings-status", "此插件没有可配置项。"));
                return card;
            }
            var form = node("form", "plugin-settings-form");
            var values = settings.values || {};
            var secretsSet = settings.secrets_set || [];
            keys.forEach(function (key) { appendField(form, key, properties[key] || {}, values[key], secretsSet); });
            var actions = node("div", "plugin-settings-actions");
            var save = node("button", "primary", "保存插件设置");
            save.type = "submit";
            var formStatus = node("p", "plugin-settings-status", "");
            actions.appendChild(save);
            form.append(actions, formStatus);
            form.addEventListener("submit", async function (event) {
                event.preventDefault();
                save.disabled = true;
                var nextValues = {};
                form.querySelectorAll("[data-setting-key]").forEach(function (field) {
                    var key = field.dataset.settingKey;
                    if (field.type === "checkbox") nextValues[key] = field.checked;
                    else if (field.tagName === "SELECT") nextValues[key] = JSON.parse(field.selectedOptions[0].dataset.settingValue);
                    else if (field.type === "number" && field.value !== "") nextValues[key] = Number(field.value);
                    else nextValues[key] = field.value;
                });
                try {
                    await request("/api/local/plugins/" + encodeURIComponent(plugin.id) + "/settings", "PUT", { settings: nextValues });
                    formStatus.textContent = "插件设置已保存。";
                    formStatus.classList.remove("is-error");
                } catch (error) {
                    formStatus.textContent = error.message || "插件设置保存失败";
                    formStatus.classList.add("is-error");
                } finally {
                    save.disabled = false;
                }
            });
            card.appendChild(form);
        } catch (error) {
            var settingsError = node("p", "plugin-settings-status is-error", "设置读取失败：" + (error.message || "unknown"));
            card.appendChild(settingsError);
        }
        return card;
    }

    async function load() {
        root.textContent = "正在读取插件…";
        try {
            var result = await request("/api/local/plugins", "GET");
            root.replaceChildren();
            if (!result.plugins || !result.plugins.length) {
                root.appendChild(node("div", "plugin-empty-state", "还没有安装插件。把插件目录放入 NexoraCode/plugins/<plugin-id>/，并在其中提供 manifest.json。"));
                return;
            }
            for (var i = 0; i < result.plugins.length; i += 1) {
                root.appendChild(await renderPlugin(result.plugins[i]));
            }
        } catch (error) {
            root.textContent = "插件列表读取失败：" + (error.message || "unknown");
        }
    }

    load();
})();
