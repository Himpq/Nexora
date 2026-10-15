"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../ui/static/js/telemetry.js"), "utf8");

// Run the actual browser script against a fake clock and in-memory transport.
async function createHarness() {
    let now = 0;
    let focused = true;
    const documentEvents = new Map();
    const windowEvents = new Map();
    const intervals = new Map();
    const activity = [];
    const document = {
        visibilityState: "visible",
        hasFocus: () => focused,
        addEventListener: (name, callback) => documentEvents.set(name, callback),
    };
    const context = {
        Date: { now: () => now },
        document,
        window: {
            addEventListener: (name, callback) => windowEvents.set(name, callback),
            setInterval: (callback, delay) => intervals.set(delay, callback),
        },
        Blob: class {
            constructor(parts) {
                this.text = parts.join("");
            }
        },
        navigator: {
            sendBeacon: (url, blob) => {
                assert.equal(url, "/api/local/telemetry/activity");
                activity.push(JSON.parse(blob.text).active_seconds);
                return true;
            },
        },
        fetch: async (url, options = {}) => {
            if (url === "/api/local/telemetry/activity") {
                activity.push(JSON.parse(options.body).active_seconds);
            } else {
                assert.equal(url, "/api/local/telemetry/status");
            }

            return {
                ok: true,
                json: async () => ({ success: true, enabled: true, notice_seen: true }),
            };
        },
    };
    vm.runInNewContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(intervals.has(15000), "Activity collection should have started");

    return {
        activity,
        advance: milliseconds => { now += milliseconds; },
        tick: () => intervals.get(15000)(),
        interact: () => documentEvents.get("keydown")(),
        focus: value => {
            focused = value;
            windowEvents.get(value ? "focus" : "blur")();
        },
        visible: value => {
            document.visibilityState = value ? "visible" : "hidden";
            documentEvents.get("visibilitychange")();
        },
        pagehide: () => windowEvents.get("pagehide")(),
    };
}

test("restoring a hidden window cannot count the previous hidden interval", async () => {
    const browser = await createHarness();
    browser.advance(3000);
    browser.focus(false);
    browser.visible(false);
    browser.advance(11000);
    browser.visible(true);
    browser.focus(true);
    browser.interact();
    browser.advance(1000);
    browser.tick();
    browser.pagehide();
    assert.deepEqual(browser.activity, [4]);
});

test("an unfocused visible window is excluded and fractional intervals survive", async () => {
    const browser = await createHarness();
    browser.advance(2500);
    browser.focus(false);
    browser.advance(20000);
    browser.focus(true);
    browser.advance(2500);
    browser.tick();
    browser.pagehide();
    assert.deepEqual(browser.activity, [5]);
});

test("a delayed timer counts only the first minute after the last interaction", async () => {
    const browser = await createHarness();
    browser.advance(75000);
    browser.tick();
    browser.pagehide();
    assert.deepEqual(browser.activity, [60]);
});

test("input after inactivity cannot turn past idle time into active time", async () => {
    const browser = await createHarness();
    browser.advance(90000);
    browser.interact();
    browser.advance(1000);
    browser.tick();
    browser.pagehide();
    assert.deepEqual(browser.activity, [60, 1]);
});

test("closing before the first timer tick keeps the final active seconds", async () => {
    const browser = await createHarness();
    browser.advance(7000);
    browser.pagehide();
    assert.deepEqual(browser.activity, [7]);
});
