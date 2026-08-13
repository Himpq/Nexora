/**
 * markdown.js — 消息渲染
 *
 * 依赖 vendor 全局：marked / hljs / katex / renderMathInElement。
 * 渲染工具结果：纯文本使用 <pre>，尝试 JSON 展示为可读文本。
 */
(function () {
    "use strict";

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = String(text == null ? "" : text);
        return div.innerHTML;
    }

    function highlight(code, lang) {
        try {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
        } catch (_) {}
        try {
            return hljs.highlightAuto(code).value;
        } catch (_) {}
        return escapeHtml(code);
    }

    /**
     * 渲染 markdown 文本为 HTML。流式期间传入 pending=true 使用轻量渲染避免卡顿。
     */
    function renderMarkdown(text, pending) {
        const raw = String(text || "");
        if (!raw.trim()) {
            return "";
        }
        let html = "";
        try {
            const cfg = {
                breaks: true,
                gfm: true
            };
            html = marked.parse(raw, cfg);
        } catch (_) {
            html = escapeHtml(raw);
        }

        const container = document.createElement("div");

        if (pending) {
            // 流式未完成：临时容器解析，但保留纯文本尾部，避免代码块闪烁。
            container.innerHTML = html;
            try {
                if (window.renderMathInElement) {
                    renderMathInElement(container, { throwOnError: false, delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }] });
                }
            } catch (_) {}
            return container.innerHTML;
        }

        container.innerHTML = html;

        try {
            if (window.renderMathInElement) {
                renderMathInElement(container, { throwOnError: false, delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }] });
            }
        } catch (_) {}

        container.querySelectorAll("pre code").forEach(function (block) {
            const langMatch = (block.className || "").match(/language-(\w+)/);
            const lang = langMatch ? langMatch[1] : "";
            block.innerHTML = highlight(block.textContent || "", lang);
        });

        container.querySelectorAll("a").forEach(function (a) {
            a.target = "_blank";
            a.rel = "noopener noreferrer";
        });

        return container.innerHTML;
    }

    /**
     * 工具结果展示：尽力转成易读文本。
     */
    function renderToolResult(value) {
        if (typeof value === "string") {
            return value;
        }
        try {
            return JSON.stringify(value, null, 2);
        } catch (_) {
            return String(value);
        }
    }

    function textPreview(value, limit) {
        const limitN = limit || 120;
        let text = "";
        if (typeof value === "string") {
            text = value;
        } else {
            try {
                text = JSON.stringify(value);
            } catch (_) {
                text = String(value);
            }
        }
        if (text.length > limitN) {
            text = text.slice(0, limitN) + "…";
        }
        return text;
    }

    window.NexoraMarkdown = {
        renderMarkdown: renderMarkdown,
        renderToolResult: renderToolResult,
        textPreview: textPreview
    };
})();
