/** Provider template picker and model discovery for the NexoraCode settings page. */
(function () {
    "use strict";

    var $ = function (id) {
        return document.getElementById(id);
    };

    var customTemplate = {
        id: "custom",
        name: "Custom（自定义）",
        base_url: "",
        model_list_supported: true,
        model_list_hint: "可直接输入模型 ID，也可尝试读取 OpenAI 兼容的 /models 接口。"
    };
    var templates = [customTemplate];
    var selectedTemplateId = "custom";
    var templatesLoaded = false;
    var pendingTemplateSelection = null;
    var bridge = null;
    var modelRows = [];
    var toastTimer = null;
    var requestId = 0;
    var modelFetchIdleText;

    function setModelFetchPending(pending) {
        var button = $("pf-model-fetch");
        button.disabled = pending;
        button.textContent = pending ? "获取中…" : modelFetchIdleText;
    }

    function invalidateModelRequest() {
        // Model results belong to the current form, endpoint and key only.
        requestId += 1;
        setModelFetchPending(false);
    }

    function closeTemplateMenu() {
        $("pf-template-menu").classList.add("hidden");
        $("pf-template-trigger").setAttribute("aria-expanded", "false");
    }

    function renderTemplateMenu() {
        var menu = $("pf-template-menu");
        menu.replaceChildren();

        templates.forEach(function (template) {
            var option = document.createElement("button");
            var title = document.createElement("span");

            option.type = "button";
            option.className = "pf-template-option";
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", String(template.id === selectedTemplateId));
            option.dataset.templateId = template.id;
            title.textContent = template.name;
            option.append(title);
            menu.appendChild(option);
        });
    }

    function selectTemplate(templateId, values) {
        closeModelDialog();

        var template = templates.find(function (item) {
            return item.id === templateId;
        });
        var customValues = values || {};

        if (!template && !templatesLoaded) {
            selectedTemplateId = templateId;
            pendingTemplateSelection = { id: templateId, values: customValues };
            return;
        }

        if (!template) {
            template = customTemplate;
        }

        selectedTemplateId = template.id;
        $("pf-template-id").value = template.id;
        $("pf-template-label").textContent = template.name;
        $("pf-template-menu").querySelectorAll("[data-template-id]").forEach(function (option) {
            option.setAttribute("aria-selected", String(option.dataset.templateId === template.id));
        });

        var isCustom = template.id === "custom";
        $("pf-name-field").classList.toggle("hidden", !isCustom);
        $("pf-base-url-field").classList.toggle("hidden", !isCustom);
        $("pf-name").value = isCustom ? String(customValues.name || "") : template.name;
        $("pf-base-url").value = isCustom ? String(customValues.base_url || "") : template.base_url;
        $("pf-template-hint").textContent = isCustom
            ? "自定义兼容 OpenAI Chat Completions 的服务商。"
            : "将使用 " + template.name + " 的 Chat Completions 接口。";
        $("pf-model-hint").textContent = template.model_list_hint || "可直接输入模型 ID，也可从平台列表中选择。";
        closeTemplateMenu();
    }

    async function loadTemplates() {
        try {
            var result = await window.NexoraSettingsApi.request("/api/local/provider-templates", "GET");

            if (!(result.ok && result.data && result.data.success && Array.isArray(result.data.templates))) {
                throw new Error((result.data && result.data.message) || "无法加载 Provider 模板");
            }

            templates = [customTemplate].concat(result.data.templates);
            templatesLoaded = true;
            renderTemplateMenu();
            var selection = pendingTemplateSelection || {
                id: selectedTemplateId,
                values: {
                    name: $("pf-name").value,
                    base_url: $("pf-base-url").value
                }
            };
            pendingTemplateSelection = null;
            selectTemplate(selection.id, selection.values);
        } catch (error) {
            showToast(String((error && error.message) || "无法加载 Provider 模板"), false);
        }
    }

    function showToast(message, success) {
        var toast = $("pf-provider-toast");

        if (toastTimer) {
            window.clearTimeout(toastTimer);
        }

        toast.textContent = String(message || "");
        toast.classList.toggle("is-error", !success);
        toast.classList.toggle("is-success", Boolean(success));
        toast.classList.add("is-visible");
        toastTimer = window.setTimeout(function () {
            toast.classList.remove("is-visible");
        }, 3600);
    }

    function renderModelRows(searchText) {
        var list = $("pf-model-options");
        var query = String(searchText || "").trim().toLocaleLowerCase();
        var filtered = modelRows.filter(function (model) {
            return !query
                || model.id.toLocaleLowerCase().includes(query)
                || model.name.toLocaleLowerCase().includes(query);
        });

        list.replaceChildren();

        if (!filtered.length) {
            var empty = document.createElement("div");
            empty.className = "pf-model-empty";
            empty.textContent = modelRows.length ? "没有匹配的模型。" : "平台没有返回模型。";
            list.appendChild(empty);
            return;
        }

        filtered.forEach(function (model) {
            var option = document.createElement("button");
            var name = document.createElement("span");
            var id = document.createElement("span");

            option.type = "button";
            option.className = "pf-model-option";
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");
            option.title = model.id;
            name.className = "pf-model-name";
            id.className = "pf-model-id";
            name.textContent = model.name || model.id;
            id.textContent = model.id;
            option.append(name);

            if (model.name && model.name !== model.id) {
                option.append(id);
            }

            option.addEventListener("click", function () {
                bridge.setModel(model.id);
                closeModelDialog();
                showToast("已填入模型：" + model.id, true);
            });

            list.appendChild(option);
        });
    }

    function openModelDialog(models) {
        modelRows = models;
        $("pf-model-search").value = "";
        renderModelRows("");
        $("pf-model-dialog").classList.remove("hidden");
        $("pf-model-search").focus();
    }

    function closeModelDialog() {
        invalidateModelRequest();

        var dialog = $("pf-model-dialog");
        var wasOpen = !dialog.classList.contains("hidden");
        dialog.classList.add("hidden");

        if (wasOpen) {
            $("pf-model-fetch").focus();
        }
    }

    async function fetchModels() {
        if (!templatesLoaded) {
            showToast("Provider 模板仍在加载，请稍后重试", false);
            return;
        }

        var currentRequestId = ++requestId;
        var context = bridge.getContext();
        var body = {
            template_id: selectedTemplateId,
            provider_id: context.providerId,
            key_source_id: context.keySourceId,
            api_key: $("pf-api-key").value.trim(),
            base_url: $("pf-base-url").value.trim()
        };

        setModelFetchPending(true);

        try {
            var result = await window.NexoraSettingsApi.request("/api/local/provider-models", "POST", body);

            if (currentRequestId !== requestId) {
                return;
            }

            if (!(result.ok && result.data && result.data.success && Array.isArray(result.data.models))) {
                showToast((result.data && result.data.message) || "获取模型列表失败", false);
                return;
            }

            openModelDialog(result.data.models);
        } catch (error) {
            if (currentRequestId !== requestId) {
                return;
            }

            showToast(String((error && error.message) || "获取模型列表失败"), false);
        } finally {
            if (currentRequestId === requestId) {
                setModelFetchPending(false);
            }
        }
    }

    function bindEvents() {
        var trigger = $("pf-template-trigger");
        var menu = $("pf-template-menu");
        var dialog = $("pf-model-dialog");

        trigger.addEventListener("click", function () {
            var open = trigger.getAttribute("aria-expanded") === "true";
            menu.classList.toggle("hidden", open);
            trigger.setAttribute("aria-expanded", String(!open));

            if (!open) {
                var firstOption = menu.querySelector("[role='option']");

                if (firstOption) {
                    firstOption.focus();
                }
            }
        });

        trigger.addEventListener("keydown", function (event) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                menu.classList.remove("hidden");
                trigger.setAttribute("aria-expanded", "true");
                var firstOption = menu.querySelector("[role='option']");

                if (firstOption) {
                    firstOption.focus();
                }
            }
        });

        menu.addEventListener("click", function (event) {
            var option = event.target instanceof Element
                ? event.target.closest("[data-template-id]")
                : null;

            if (option && menu.contains(option)) {
                selectTemplate(option.dataset.templateId, {
                    name: $("pf-name").value,
                    base_url: $("pf-base-url").value
                });
                trigger.focus();
            }
        });

        menu.addEventListener("keydown", function (event) {
            var options = Array.from(menu.querySelectorAll("[data-template-id]"));
            var currentIndex = options.indexOf(document.activeElement);
            var nextIndex = currentIndex;

            if (event.key === "ArrowDown") {
                nextIndex = Math.min(options.length - 1, currentIndex + 1);
            } else if (event.key === "ArrowUp") {
                nextIndex = Math.max(0, currentIndex - 1);
            } else if (event.key === "Home") {
                nextIndex = 0;
            } else if (event.key === "End") {
                nextIndex = options.length - 1;
            } else if (event.key === "Escape") {
                closeTemplateMenu();
                trigger.focus();
                return;
            } else {
                return;
            }

            event.preventDefault();

            if (options[nextIndex]) {
                options[nextIndex].focus();
            }
        });

        document.addEventListener("click", function (event) {
            if (!(event.target instanceof Element) || !event.target.closest(".pf-template-picker")) {
                closeTemplateMenu();
            }
        });

        $("pf-model-fetch").addEventListener("click", fetchModels);

        [$("pf-base-url"), $("pf-api-key")].forEach(function (field) {
            field.addEventListener("input", closeModelDialog);
        });

        $("pf-model-search").addEventListener("input", function () {
            renderModelRows($("pf-model-search").value);
        });
        $("pf-model-dialog-close").addEventListener("click", closeModelDialog);
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) {
                closeModelDialog();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeTemplateMenu();

                if (!dialog.classList.contains("hidden")) {
                    closeModelDialog();
                }
            }
        });
    }

    window.NexoraProviderSettings = {
        init: function (settingsBridge) {
            bridge = settingsBridge;
            modelFetchIdleText = $("pf-model-fetch").textContent;
            renderTemplateMenu();
            selectTemplate("custom");
            bindEvents();
            loadTemplates();
        },
        getSelectedId: function () {
            return selectedTemplateId;
        },
        areTemplatesLoaded: function () {
            return templatesLoaded;
        },
        selectTemplate: selectTemplate,
        closeModelDialog: closeModelDialog
    };
})();
