(function () {
    "use strict";

    var status = null;
    var collectionStarted = false;
    var bufferedSeconds = 0;
    var lastInteraction = Date.now();
    var lastTick = Date.now();
    var foreground = false;
    var notice = null;

    function postJson(url, body, keepalive) {
        return fetch(url, {
            method: "POST",
            credentials: "same-origin",
            keepalive: Boolean(keepalive),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    }

    function showNotice() {
        notice = document.createElement("div");
        notice.className = "nc-telemetry-backdrop";
        notice.setAttribute("role", "dialog");
        notice.setAttribute("aria-modal", "true");
        notice.setAttribute("aria-labelledby", "nc-telemetry-title");
        notice.innerHTML = [
            '<section class="nc-telemetry-dialog">',
            '  <h2 id="nc-telemetry-title">NexoraCode 使用统计</h2>',
            '  <p id="nc-telemetry-state"></p>',
            '  <p>仅在主窗口位于前台且最近有鼠标、键盘或触控操作时计时。活跃时长和随机匿名安装 ID 会发送到 chat.himpqblog.cn，服务端按 UTC 日期汇总。Provider / 工具报错只发送错误类别和有限错误类型，不发送报错文本、对话内容、文件路径或 API Key。</p>',
            '  <p>项目哈希只在本机用于关联活跃统计，不会上传。统计请求不含 IP，但网络服务可以看到连接来源 IP。</p>',
            '  <button type="button" class="nc-telemetry-ack">我知道了，继续使用</button>',
            '</section>'
        ].join("");
        document.body.appendChild(notice);
        notice.querySelector("#nc-telemetry-state").textContent = status.enabled
            ? "使用统计默认开启；确认此提示后开始计时，用于改进 Provider 和工具功能。你可以在设置的“通用”页面关闭。"
            : "使用统计当前已关闭。你可以在设置的“通用”页面重新开启。";
        notice.querySelector(".nc-telemetry-ack").addEventListener("click", acknowledgeNotice);
        notice.querySelector(".nc-telemetry-ack").focus();
    }

    async function acknowledgeNotice() {
        var button = notice && notice.querySelector(".nc-telemetry-ack");

        if (button) {
            button.disabled = true;
        }

        try {
            var response = await postJson("/api/local/telemetry/notice", {});

            if (!response.ok) {
                if (button) {
                    button.disabled = false;
                }

                return;
            }

            if (notice) {
                notice.remove();
                notice = null;
            }

            status.notice_seen = true;
            startCollection();
        } catch (_) {
            if (button) {
                button.disabled = false;
            }
        }
    }

    function sendActivity(seconds, keepalive) {
        if (!status || !status.enabled || !status.notice_seen || !seconds) {
            return;
        }

        var payload = JSON.stringify({ active_seconds: seconds });

        if (keepalive && navigator.sendBeacon) {
            navigator.sendBeacon(
                "/api/local/telemetry/activity",
                new Blob([payload], { type: "application/json" })
            );
            return;
        }

        postJson("/api/local/telemetry/activity", { active_seconds: seconds }, true).catch(function () {});
    }

    function flushActivity(keepalive) {
        var seconds = Math.min(60, Math.floor(bufferedSeconds));

        if (seconds < 1) {
            return;
        }

        sendActivity(seconds, keepalive);
        bufferedSeconds -= seconds;
    }

    function isForeground() {
        return document.visibilityState === "visible"
            && document.hasFocus();
    }

    // Settle the previous foreground interval before changing focus or interaction state.
    function recordElapsed(now) {
        if (!status || !status.enabled || !status.notice_seen) {
            bufferedSeconds = 0;
        } else if (foreground) {
            var activeEnd = Math.min(now, lastInteraction + 60000);
            bufferedSeconds += Math.max(0, activeEnd - lastTick) / 1000;
        }

        lastTick = now;
    }

    function recordWindowState() {
        recordElapsed(Date.now());
        foreground = isForeground();
    }

    function recordInteraction() {
        var now = Date.now();
        recordElapsed(now);
        lastInteraction = now;
    }

    function recordPointerMovement() {
        var now = Date.now();

        if (now - lastInteraction >= 1000) {
            recordInteraction();
        }
    }

    function startCollection() {
        if (collectionStarted || !status || !status.enabled || !status.notice_seen) {
            return;
        }

        collectionStarted = true;
        lastTick = Date.now();
        lastInteraction = lastTick;
        foreground = isForeground();
        ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (eventName) {
            document.addEventListener(eventName, recordInteraction, { passive: true });
        });
        document.addEventListener("pointermove", recordPointerMovement, { passive: true });
        document.addEventListener("visibilitychange", recordWindowState);
        window.addEventListener("focus", recordWindowState);
        window.addEventListener("blur", recordWindowState);
        window.addEventListener("pageshow", recordWindowState);

        window.setInterval(function () {
            recordElapsed(Date.now());

            if (bufferedSeconds >= 60) {
                flushActivity(false);
            }
        }, 15000);

        window.addEventListener("pagehide", function () {
            recordElapsed(Date.now());
            foreground = false;
            flushActivity(true);
        });
    }

    async function refreshStatus() {
        try {
            var response = await fetch("/api/local/telemetry/status", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (!response.ok) {
                return;
            }

            var data = await response.json();

            if (!data || data.success !== true) {
                return;
            }

            if (collectionStarted) {
                recordElapsed(Date.now());
            }

            status = data;

            if (!status.enabled || !status.notice_seen) {
                bufferedSeconds = 0;
            }

            if (!status.notice_seen) {
                if (!notice) {
                    showNotice();
                }

                return;
            }

            if (notice) {
                notice.remove();
                notice = null;
            }

            startCollection();
        } catch (_) {
            return;
        }
    }

    refreshStatus();
    window.setInterval(refreshStatus, 30000);
}());
