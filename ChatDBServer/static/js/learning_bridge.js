/* ──────────────────────────────────────────────────────────────────────
   learning_bridge.js
   Nexora ↔ NexoraLearning iframe 通信桥 + 父页面遮罩管理
   ────────────────────────────────────────────────────────────────────── */
(function () {
    "use strict";

    // ─── 遮罩 DOM ────────────────────────────────────────────────────
    var backdropEl = null;
    var backdropVisible = false;

    function ensureBackdrop() {
        if (backdropEl && backdropEl.isConnected) return backdropEl;
        backdropEl = document.createElement("div");
        backdropEl.className = "learning-embed-backdrop";
        backdropEl.style.cssText =
            "display:none;position:fixed;inset:0;background:rgba(15,23,42,0.38);z-index:9990;pointer-events:none;";
        document.body.appendChild(backdropEl);
        return backdropEl;
    }

    function toggleBackdrop(show) {
        var el = ensureBackdrop();
        backdropVisible = !!show;
        el.style.display = backdropVisible ? "block" : "none";
    }

    // ─── 消息处理 ─────────────────────────────────────────────────────
    function isLearningPayload(payload) {
        if (!payload || typeof payload !== "object") return false;
        return String(payload.source || "").trim().toLowerCase() === "nexora-learning";
    }

    function handleMessage(payload) {
        if (!isLearningPayload(payload)) return false;
        var msg = String(payload.type || "").trim().toLowerCase();
        if (msg === "nexora:backdrop") {
            toggleBackdrop(!!payload.visible);
            return true;
        }
        return false;
    }

    // 侦听 iframe postMessage
    window.addEventListener("message", function (event) {
        handleMessage(event && event.data);
    });

    // 侦听同页面 CustomEvent（同域兜底）
    window.addEventListener("nexora:backdrop", function (event) {
        handleMessage(event && event.detail);
    });
})();
