(function () {
    "use strict";

    function getEscapeHtml() {
        const utils = window.NXLU;

        if (!utils || typeof utils.escapeHtml !== "function") {
            throw new Error("NXL Markdown renderer requires NXLU.escapeHtml.");
        }

        return utils.escapeHtml;
    }

    function normalizeMarkdownSource(markdown) {
        const text = String(markdown || "").replace(/\r\n?/g, "\n").trim();
        const lines = text.split("\n");

        if (
            lines.length >= 2
            && /^```(?:markdown|md)\s*$/i.test(lines[0].trim())
            && /^```\s*$/.test(lines[lines.length - 1].trim())
        ) {
            return lines.slice(1, -1).join("\n").trim();
        }

        return text;
    }

    function renderInline(value) {
        const escapeHtml = getEscapeHtml();
        const codeTokens = [];
        let html = escapeHtml(String(value || ""));

        html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
            const token = `@@NXL_INLINE_CODE_${codeTokens.length}@@`;
            codeTokens.push(`<code>${code}</code>`);
            return token;
        });
        html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
        html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
        html = html.replace(
            /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        );
        codeTokens.forEach((replacement, index) => {
            html = html.replace(`@@NXL_INLINE_CODE_${index}@@`, replacement);
        });
        return html;
    }

    function splitTableRow(line) {
        return String(line || "")
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim());
    }

    function parseTableAlignment(cell) {
        const value = String(cell || "").trim();

        if (!/^:?-{3,}:?$/.test(value)) {
            return null;
        }

        if (value.startsWith(":") && value.endsWith(":")) return "center";
        if (value.endsWith(":")) return "right";
        return "left";
    }

    function tryRenderTable(lines, startIndex) {
        if (startIndex + 1 >= lines.length || !String(lines[startIndex] || "").includes("|")) {
            return null;
        }

        const headers = splitTableRow(lines[startIndex]);
        const divider = splitTableRow(lines[startIndex + 1]);

        if (!headers.length || divider.length !== headers.length) {
            return null;
        }

        const alignments = divider.map(parseTableAlignment);

        if (alignments.some((alignment) => alignment === null)) {
            return null;
        }

        const bodyRows = [];
        let nextIndex = startIndex + 2;

        while (nextIndex < lines.length) {
            const raw = String(lines[nextIndex] || "");

            if (!raw.trim() || !raw.includes("|")) break;

            const cells = splitTableRow(raw);

            if (cells.length !== headers.length) break;

            bodyRows.push(cells);
            nextIndex += 1;
        }

        const headerHtml = headers.map((cell, index) => (
            `<th style="text-align:${alignments[index]}">${renderInline(cell)}</th>`
        )).join("");
        const bodyHtml = bodyRows.map((cells) => (
            `<tr>${cells.map((cell, index) => (
                `<td style="text-align:${alignments[index]}">${renderInline(cell)}</td>`
            )).join("")}</tr>`
        )).join("");

        return {
            html: `<div class="nxl-markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
            nextIndex,
        };
    }

    function render(markdown) {
        const escapeHtml = getEscapeHtml();
        const source = normalizeMarkdownSource(markdown);
        const lines = source.split("\n");
        const html = [];
        let paragraphLines = [];
        let quoteLines = [];
        let listTag = "";
        let listItems = [];
        let codeFenceOpen = false;
        let codeFenceLanguage = "";
        let codeFenceLines = [];

        const flushParagraph = () => {
            if (!paragraphLines.length) return;

            html.push(`<p>${paragraphLines.map(renderInline).join("<br>")}</p>`);
            paragraphLines = [];
        };
        const flushQuote = () => {
            if (!quoteLines.length) return;

            html.push(`<blockquote><p>${quoteLines.map(renderInline).join("<br>")}</p></blockquote>`);
            quoteLines = [];
        };
        const flushList = () => {
            if (!listTag || !listItems.length) return;

            html.push(`<${listTag}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listTag}>`);
            listTag = "";
            listItems = [];
        };
        const flushCodeFence = () => {
            const language = String(codeFenceLanguage || "").trim().toLowerCase();
            const languageLabel = language ? `<span>${escapeHtml(language)}</span>` : "";
            html.push(
                `<pre class="nxl-markdown-code" data-language="${escapeHtml(language)}">${languageLabel}<code>${escapeHtml(codeFenceLines.join("\n"))}</code></pre>`,
            );
            codeFenceOpen = false;
            codeFenceLanguage = "";
            codeFenceLines = [];
        };
        const flushFlowBlocks = () => {
            flushParagraph();
            flushQuote();
            flushList();
        };

        let index = 0;

        while (index < lines.length) {
            const rawLine = String(lines[index] || "");
            const trimmed = rawLine.trim();
            const fenceMatch = trimmed.match(/^```([A-Za-z0-9_+-]+)?\s*$/);

            if (codeFenceOpen) {
                if (fenceMatch && !fenceMatch[1]) {
                    flushCodeFence();
                } else {
                    codeFenceLines.push(rawLine);
                }

                index += 1;
                continue;
            }

            if (fenceMatch) {
                flushFlowBlocks();
                codeFenceOpen = true;
                codeFenceLanguage = String(fenceMatch[1] || "");
                index += 1;
                continue;
            }

            if (!trimmed) {
                flushFlowBlocks();
                index += 1;
                continue;
            }

            const table = tryRenderTable(lines, index);

            if (table) {
                flushFlowBlocks();
                html.push(table.html);
                index = table.nextIndex;
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);

            if (heading) {
                flushFlowBlocks();
                const level = Math.min(6, heading[1].length + 1);
                html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
                index += 1;
                continue;
            }

            if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushFlowBlocks();
                html.push("<hr>");
                index += 1;
                continue;
            }

            const quote = trimmed.match(/^>\s?(.*)$/);

            if (quote) {
                flushParagraph();
                flushList();
                quoteLines.push(quote[1]);
                index += 1;
                continue;
            }

            const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
            const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);

            if (unordered || ordered) {
                flushParagraph();
                flushQuote();
                const nextListTag = ordered ? "ol" : "ul";

                if (listTag && listTag !== nextListTag) {
                    flushList();
                }

                listTag = nextListTag;
                listItems.push((ordered || unordered)[1]);
                index += 1;
                continue;
            }

            flushQuote();
            flushList();
            paragraphLines.push(trimmed);
            index += 1;
        }

        if (codeFenceOpen) {
            flushCodeFence();
        }

        flushFlowBlocks();
        return html.join("") || "<p></p>";
    }

    window.NXLMarkdown = Object.freeze({
        render,
        renderInline,
    });
})();
