"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../ui/provider-settings.js"), "utf8");
const idleText = "获取模型列表";
const templates = [{
    id: "openai",
    name: "OpenAI",
    base_url: "https://provider.example.invalid/v1"
}];

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise(function (resolvePromise, rejectPromise) {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

class FakeElement {
    constructor(document) {
        this.document = document;
        this.value = "";
        this.textContent = "";
        this.disabled = false;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        const classes = new Set();
        this.classList = {
            add: function (name) {
                classes.add(name);
            },
            remove: function (name) {
                classes.delete(name);
            },
            contains: function (name) {
                return classes.has(name);
            },
            toggle: function (name, enabled) {
                const active = enabled === undefined ? !classes.has(name) : enabled;

                if (active) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }

                return active;
            }
        };
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }

    getAttribute(name) {
        return this.attributes.get(name);
    }

    addEventListener(name, listener) {
        this.listeners.set(name, listener);
    }

    dispatch(name) {
        return this.listeners.get(name)({ target: this });
    }

    querySelectorAll(selector) {
        assert.equal(selector, "[data-template-id]");
        return this.children.filter(function (child) {
            return child.dataset.templateId !== undefined;
        });
    }

    replaceChildren() {
        this.children = [];
    }

    append(child) {
        this.children.push(child);
    }

    appendChild(child) {
        this.children.push(child);
    }

    focus() {
        this.document.activeElement = this;
    }
}

/** Run the real settings module with controlled responses and no browser or network. */
async function createHarness(options = {}) {
    const elements = new Map();
    const requests = [];
    const templateRequest = deferred();
    const document = {
        activeElement: null,
        getElementById: function (id) {
            if (!elements.has(id)) {
                elements.set(id, new FakeElement(document));
            }

            return elements.get(id);
        },
        createElement: function () {
            return new FakeElement(document);
        },
        addEventListener: function () {}
    };
    const element = document.getElementById;
    element("pf-model-fetch").textContent = idleText;
    element("pf-model-dialog").classList.add("hidden");
    element("pf-template-menu").classList.add("hidden");
    let context = { providerId: "first-provider", keySourceId: "" };
    const window = {
        setTimeout: function () {
            return 1;
        },
        clearTimeout: function () {},
        NexoraSettingsApi: {
            request: function (url, method, body) {
                if (url === "/api/local/provider-templates") {
                    assert.equal(method, "GET");
                    return templateRequest.promise;
                }

                assert.equal(url, "/api/local/provider-models");
                assert.equal(method, "POST");
                const pending = deferred();
                requests.push({ body, ...pending });
                return pending.promise;
            }
        }
    };
    vm.runInNewContext(source, { window, document, Element: FakeElement });
    const settings = window.NexoraProviderSettings;
    settings.init({
        getContext: function () {
            return context;
        },
        setModel: function (model) {
            element("pf-model").value = model;
        }
    });

    async function loadTemplates() {
        templateRequest.resolve({ ok: true, data: { success: true, templates } });
        await new Promise(setImmediate);
    }

    if (!options.deferTemplates) {
        await loadTemplates();
    }

    return {
        element,
        requests,
        settings,
        loadTemplates,
        fetchModels: function () {
            return element("pf-model-fetch").dispatch("click");
        },
        changeProvider: function () {
            context = { providerId: "second-provider", keySourceId: "" };
            settings.selectTemplate("custom", {
                name: "Second provider",
                base_url: "https://second.example.invalid/v1"
            });
        }
    };
}

const contextChanges = [
    ["template change", function (harness) {
        harness.settings.selectTemplate("openai");
    }],
    ["form close", function (harness) {
        harness.settings.closeModelDialog();
    }],
    ["another provider with the same template", function (harness) {
        harness.changeProvider();
    }],
    ["Base URL edit", function (harness) {
        harness.element("pf-base-url").value = "https://changed.example.invalid/v1";
        harness.element("pf-base-url").dispatch("input");
    }],
    ["API Key edit", function (harness) {
        harness.element("pf-api-key").value = "synthetic-test-value";
        harness.element("pf-api-key").dispatch("input");
    }]
];

for (const [name, changeContext] of contextChanges) {
    for (const outcome of ["success", "network error"]) {
        test(name + " discards stale " + outcome + " without disturbing a newer request", async function () {
            const harness = await createHarness();
            const previous = harness.fetchModels();
            assert.equal(harness.element("pf-model-fetch").disabled, true);
            changeContext(harness);
            assert.equal(harness.element("pf-model-fetch").disabled, false);
            assert.equal(harness.element("pf-model-fetch").textContent, idleText);
            const current = harness.fetchModels();

            if (outcome === "success") {
                harness.requests[0].resolve({
                    ok: true,
                    data: { success: true, models: [{ id: "stale-model", name: "Stale model" }] }
                });
            } else {
                harness.requests[0].reject(new Error("Stale request failed"));
            }

            await previous;
            assert.equal(harness.element("pf-model-dialog").classList.contains("hidden"), true);
            assert.equal(harness.element("pf-provider-toast").classList.contains("is-visible"), false);
            assert.equal(harness.element("pf-model-fetch").disabled, true);
            assert.equal(harness.element("pf-model-fetch").textContent, "获取中…");
            harness.requests[1].resolve({
                ok: true,
                data: { success: true, models: [{ id: "current-model", name: "Current model" }] }
            });
            await current;
            assert.equal(harness.element("pf-model-dialog").classList.contains("hidden"), false);
            assert.equal(harness.element("pf-model-fetch").disabled, false);
            assert.equal(harness.element("pf-model-fetch").textContent, idleText);
            const rows = harness.element("pf-model-options").children;
            assert.equal(rows.length, 1);
            assert.equal(rows[0].title, "current-model");
            rows[0].dispatch("click");
            assert.equal(harness.element("pf-model").value, "current-model");
            assert.equal(harness.element("pf-model-dialog").classList.contains("hidden"), true);
        });
    }
}

test("a selection made before templates load keeps its platform and endpoint", async function () {
    const harness = await createHarness({ deferTemplates: true });
    harness.settings.selectTemplate("openai");
    assert.equal(harness.settings.getSelectedId(), "openai");
    await harness.loadTemplates();
    assert.equal(harness.settings.getSelectedId(), "openai");
    assert.equal(harness.element("pf-base-url").value, templates[0].base_url);
    assert.equal(harness.element("pf-name-field").classList.contains("hidden"), true);
    const pending = harness.fetchModels();
    assert.equal(harness.requests[0].body.template_id, "openai");
    harness.requests[0].resolve({ ok: true, data: { success: true, models: [] } });
    await pending;
    assert.equal(harness.element("pf-model-fetch").disabled, false);
});

for (const outcome of ["API error", "network error"]) {
    test("the current " + outcome + " is shown and allows retry", async function () {
        const harness = await createHarness();
        const pending = harness.fetchModels();

        if (outcome === "API error") {
            harness.requests[0].resolve({ ok: false, data: { success: false, message: "Current request failed" } });
        } else {
            harness.requests[0].reject(new Error("Current request failed"));
        }

        await pending;
        assert.equal(harness.element("pf-provider-toast").textContent, "Current request failed");
        assert.equal(harness.element("pf-provider-toast").classList.contains("is-visible"), true);
        assert.equal(harness.element("pf-model-fetch").disabled, false);
        assert.equal(harness.element("pf-model-fetch").textContent, idleText);
    });
}
