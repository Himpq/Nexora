(function () {
    'use strict';

    function requireShared() {
        if (!window.NexoraChatShared || typeof window.NexoraChatShared.registerModule !== 'function') {
            throw new Error('NexoraChatShared must load before chat_markdown.js');
        }

        return window.NexoraChatShared;
    }

    function normalizeIndentedGfmTables(text) {
        const src = String(text || '');

        if (!src) return src;

        const lines = src.split('\n');
        const out = [];

        const hasEscapedCharBefore = (line, index) => {
            let count = 0;

            for (let i = index - 1; i >= 0 && line[i] === '\\'; i -= 1) {
                count += 1;
            }

            return count % 2 === 1;
        };

        const readBacktickRun = (line, index) => {
            let end = index;

            while (end < line.length && line[end] === '`') {
                end += 1;
            }

            return end - index;
        };

        const splitMarkdownTableCells = (line) => {
            let body = String(line || '').replace(/\r$/, '').trim();

            if (!body) return [];

            if (body.startsWith('|')) {
                body = body.slice(1);
            }

            if (body.endsWith('|') && !hasEscapedCharBefore(body, body.length - 1)) {
                body = body.slice(0, -1);
            }

            const cells = [];
            let current = '';
            let codeSpanFence = 0;

            for (let i = 0; i < body.length; i += 1) {
                const ch = body[i];

                if (ch === '`') {
                    const run = readBacktickRun(body, i);

                    if (codeSpanFence === 0) {
                        codeSpanFence = run;
                    } else if (run === codeSpanFence) {
                        codeSpanFence = 0;
                    }

                    current += body.slice(i, i + run);
                    i += run - 1;
                    continue;
                }

                if (ch === '|' && codeSpanFence === 0 && !hasEscapedCharBefore(body, i)) {
                    cells.push(current.trim());
                    current = '';
                    continue;
                }

                current += ch;
            }

            cells.push(current.trim());
            return cells;
        };

        const isMarkdownTableSeparatorCells = (cells) => {
            if (!Array.isArray(cells) || cells.length < 2) return false;

            return cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || '').replace(/\s+/g, '')));
        };

        const getMarkdownTableRow = (line) => {
            const raw = String(line || '');
            const trimmed = raw.trim();

            if (!trimmed || !trimmed.includes('|')) return null;
            if (/^(#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>)/.test(trimmed)) return null;

            const cells = splitMarkdownTableCells(raw);

            if (cells.length < 2) return null;
            if (!cells.some((cell) => String(cell || '').trim())) return null;

            return {
                cells,
                isSeparator: isMarkdownTableSeparatorCells(cells),
            };
        };

        const normalizeMarkdownTableSeparatorCells = (cells) => {
            if (!Array.isArray(cells) || cells.length < 2) return [];

            return cells.map((cell) => {
                const compact = String(cell || '').replace(/\s+/g, '');
                const left = compact.startsWith(':');
                const right = compact.endsWith(':');

                return `${left ? ':' : ''}---${right ? ':' : ''}`;
            });
        };

        const escapeMarkdownTableCellPipes = (cell) => {
            const value = String(cell || '').trim();
            let outText = '';

            for (let i = 0; i < value.length; i += 1) {
                const ch = value[i];

                if (ch === '|' && !hasEscapedCharBefore(value, i)) {
                    outText += '\\|';
                    continue;
                }

                outText += ch;
            }

            return outText;
        };

        const formatMarkdownTableRow = (cells) => {
            return `| ${cells.map((cell) => escapeMarkdownTableCellPipes(cell)).join(' | ')} |`;
        };

        const collectMarkdownTableBlock = (start) => {
            const header = getMarkdownTableRow(lines[start]);

            if (!header || header.isSeparator) return null;

            let nextIndex = start + 1;

            if (
                nextIndex < lines.length
                && String(lines[nextIndex] || '').trim() === ''
                && getMarkdownTableRow(lines[nextIndex + 1])
            ) {
                nextIndex += 1;
            }

            const next = getMarkdownTableRow(lines[nextIndex]);

            if (!next || next.cells.length !== header.cells.length) return null;

            if (next.isSeparator) {
                const rows = [];
                let endIndex = nextIndex;

                for (let i = nextIndex + 1; i < lines.length; i += 1) {
                    const row = getMarkdownTableRow(lines[i]);

                    if (!row || row.isSeparator || row.cells.length !== header.cells.length) break;

                    rows.push(row);
                    endIndex = i;
                }

                return {
                    endIndex,
                    header,
                    separatorCells: normalizeMarkdownTableSeparatorCells(next.cells),
                    rows,
                };
            }

            const rows = [next];
            let endIndex = nextIndex;

            for (let i = nextIndex + 1; i < lines.length; i += 1) {
                const row = getMarkdownTableRow(lines[i]);

                if (!row || row.isSeparator || row.cells.length !== header.cells.length) break;

                rows.push(row);
                endIndex = i;
            }

            const beforeIsBoundary = start === 0 || String(lines[start - 1] || '').trim() === '';
            const afterIsBoundary = endIndex + 1 >= lines.length || String(lines[endIndex + 1] || '').trim() === '';
            const hasEnoughRows = rows.length >= 2;

            if (!hasEnoughRows && !(beforeIsBoundary && afterIsBoundary)) return null;

            return {
                endIndex,
                header,
                separatorCells: Array.from({ length: header.cells.length }, () => '---'),
                rows,
            };
        };

        const readFenceMarker = (line) => {
            const match = String(line || '').match(/^\s*(`{3,}|~{3,})/);

            if (!match) return null;

            return {
                char: match[1][0],
                length: match[1].length,
            };
        };

        let activeFence = null;

        for (let i = 0; i < lines.length; i += 1) {
            const line = String(lines[i] || '');
            const fence = readFenceMarker(line);

            if (fence) {
                if (!activeFence) {
                    activeFence = fence;
                } else if (fence.char === activeFence.char && fence.length >= activeFence.length) {
                    activeFence = null;
                }

                out.push(line);
                continue;
            }

            if (activeFence) {
                out.push(line);
                continue;
            }

            const block = collectMarkdownTableBlock(i);

            if (!block) {
                out.push(line);
                continue;
            }

            if (out.length > 0 && String(out[out.length - 1] || '').trim() !== '') {
                out.push('');
            }

            out.push(formatMarkdownTableRow(block.header.cells));
            out.push(formatMarkdownTableRow(block.separatorCells));
            block.rows.forEach((row) => {
                out.push(formatMarkdownTableRow(row.cells));
            });
            i = block.endIndex;
        }

        return out.join('\n');
    }

    function requireRenderDependency(deps, name) {
        const value = deps && deps[name];

        if (typeof value !== 'function') {
            throw new Error(`chat_markdown.js missing render dependency: ${name}`);
        }

        return value;
    }

    function getMarkedParser(deps) {
        const parser = deps && deps.marked;

        if (!parser || typeof parser.parse !== 'function') {
            throw new Error('chat_markdown.js missing marked parser');
        }

        return parser;
    }

    function renderMarkdownWithNewTabLinks(text, options = {}, deps = {}) {
        let raw = String(text || '');
        const opts = (options && typeof options === 'object') ? options : {};
        const normalizeStrongPunctuationBoundaries = requireRenderDependency(deps, 'normalizeStrongPunctuationBoundaries');
        const normalizeLatexSyntax = requireRenderDependency(deps, 'normalizeLatexSyntax');
        const needsAggressiveLatexRecovery = requireRenderDependency(deps, 'needsAggressiveLatexRecovery');
        const wrapBareLatexFragmentsOutsideMath = requireRenderDependency(deps, 'wrapBareLatexFragmentsOutsideMath');
        const protectKnowledgeReferencesInMarkdown = requireRenderDependency(deps, 'protectKnowledgeReferencesInMarkdown');
        const protectFileReferencesInMarkdown = requireRenderDependency(deps, 'protectFileReferencesInMarkdown');
        const protectMathSegmentsForMarkdown = requireRenderDependency(deps, 'protectMathSegmentsForMarkdown');
        const restoreMathSegmentsFromHtml = requireRenderDependency(deps, 'restoreMathSegmentsFromHtml');
        const restoreFileReferencesInHtml = requireRenderDependency(deps, 'restoreFileReferencesInHtml');
        const restoreKnowledgeReferencesInHtml = requireRenderDependency(deps, 'restoreKnowledgeReferencesInHtml');
        const rewriteHtmlFragmentLinksToNewTab = requireRenderDependency(deps, 'rewriteHtmlFragmentLinksToNewTab');
        const captureLatexRenderDebug = requireRenderDependency(deps, 'captureLatexRenderDebug');
        const markedParser = getMarkedParser(deps);

        if (opts.streamingMathProvisional) {
            const streamMathFindOpenTailInfo = requireRenderDependency(deps, 'streamMathFindOpenTailInfo');
            const streamMathBuildProvisionalClosedTail = requireRenderDependency(deps, 'streamMathBuildProvisionalClosedTail');
            const openInfo = streamMathFindOpenTailInfo(raw);

            if (openInfo && Number(openInfo.index) >= 0) {
                const index = Number(openInfo.index);
                const stable = raw.slice(0, index);
                const tail = raw.slice(index);

                raw = `${stable}${streamMathBuildProvisionalClosedTail(tail, openInfo.type)}`;
            }
        }

        const normalizedText = normalizeStrongPunctuationBoundaries(normalizeLatexSyntax(raw));
        const withBareLatexWrapped = needsAggressiveLatexRecovery(raw)
            ? wrapBareLatexFragmentsOutsideMath(normalizedText)
            : normalizedText;
        const protectedKnowledgeReferences = protectKnowledgeReferencesInMarkdown(withBareLatexWrapped);
        const protectedFileReferences = protectFileReferencesInMarkdown(protectedKnowledgeReferences.text);
        const shielded = protectMathSegmentsForMarkdown(protectedFileReferences.text);
        const html = markedParser.parse(String(shielded.text || ''), {
            gfm: true,
            breaks: opts.breaks !== false,
        });
        const restoredHtml = restoreMathSegmentsFromHtml(html, shielded.map);
        const restoredFileHtml = restoreFileReferencesInHtml(restoredHtml, protectedFileReferences.refs);
        const restoredKnowledgeHtml = restoreKnowledgeReferencesInHtml(restoredFileHtml, protectedKnowledgeReferences.refs);

        captureLatexRenderDebug('chat_markdown', raw, withBareLatexWrapped, restoredKnowledgeHtml);

        return rewriteHtmlFragmentLinksToNewTab(restoredKnowledgeHtml);
    }

    function shouldUseStreamingMarkdownBreaks(root) {
        if (!root) return true;
        if (root.classList && root.classList.contains('thinking-content')) return true;
        if (root.classList && root.classList.contains('tool-output')) return false;
        if (typeof root.closest === 'function') {
            if (root.closest('.thinking-block')) return true;
            if (root.closest('.tool-usage')) return false;
        }

        return true;
    }

    function renderStreamingMarkdownWithNewTabLinks(text, options = {}, deps = {}) {
        const opts = (options && typeof options === 'object') ? options : {};

        return renderMarkdownWithNewTabLinks(text, {
            ...opts,
            breaks: opts.breaks !== false,
        }, deps);
    }

    function renderStreamBlockMarkdown(root, text, options = {}, deps = {}) {
        const opts = (options && typeof options === 'object') ? { ...options } : {};

        if (!Object.prototype.hasOwnProperty.call(opts, 'breaks')) {
            opts.breaks = shouldUseStreamingMarkdownBreaks(root);
        }

        return renderMarkdownWithNewTabLinks(text, opts, deps);
    }

    function renderMarkdownForNotes(text, deps = {}) {
        const raw = String(text || '');
        const normalizeStrongPunctuationBoundaries = requireRenderDependency(deps, 'normalizeStrongPunctuationBoundaries');
        const normalizeLatexSyntax = requireRenderDependency(deps, 'normalizeLatexSyntax');
        const needsAggressiveLatexRecovery = requireRenderDependency(deps, 'needsAggressiveLatexRecovery');
        const wrapBareLatexFragmentsOutsideMath = requireRenderDependency(deps, 'wrapBareLatexFragmentsOutsideMath');
        const protectMathSegmentsForMarkdown = requireRenderDependency(deps, 'protectMathSegmentsForMarkdown');
        const restoreMathSegmentsFromHtml = requireRenderDependency(deps, 'restoreMathSegmentsFromHtml');
        const rewriteHtmlFragmentLinksToNewTab = requireRenderDependency(deps, 'rewriteHtmlFragmentLinksToNewTab');
        const captureLatexRenderDebug = requireRenderDependency(deps, 'captureLatexRenderDebug');
        const markedParser = getMarkedParser(deps);
        const normalizedText = normalizeStrongPunctuationBoundaries(normalizeLatexSyntax(raw));
        const withBareLatexWrapped = needsAggressiveLatexRecovery(raw)
            ? wrapBareLatexFragmentsOutsideMath(normalizedText)
            : normalizedText;
        const shielded = protectMathSegmentsForMarkdown(withBareLatexWrapped);
        const html = markedParser.parse(String(shielded.text || ''), {
            gfm: true,
            breaks: false,
        });
        const restoredHtml = restoreMathSegmentsFromHtml(html, shielded.map);

        captureLatexRenderDebug('notes_markdown', raw, withBareLatexWrapped, restoredHtml);

        return rewriteHtmlFragmentLinksToNewTab(restoredHtml);
    }

    requireShared().registerModule('markdown', {
        normalizeIndentedGfmTables,
        renderMarkdownWithNewTabLinks,
        shouldUseStreamingMarkdownBreaks,
        renderStreamingMarkdownWithNewTabLinks,
        renderStreamBlockMarkdown,
        renderMarkdownForNotes,
    });
})();
