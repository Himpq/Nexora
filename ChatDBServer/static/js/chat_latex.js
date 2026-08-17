(function () {
    'use strict';

    function requireShared() {
        if (!window.NexoraChatShared || typeof window.NexoraChatShared.registerModule !== 'function') {
            throw new Error('NexoraChatShared must load before chat_latex.js');
        }

        return window.NexoraChatShared;
    }

    function stripUnbalancedInlineDollarsByLine(text) {
        const src = String(text || '');

        if (!src) return src;

        const lines = src.split('\n');
        const cleaned = lines.map((line) => {
            const raw = String(line || '');

            if (!raw) return raw;
            if (raw.includes('$$') || raw.includes('\\[') || raw.includes('\\]')) return raw;

            const positions = findUnescapedSingleDollarPositions(raw);

            if (positions.length % 2 === 0) return raw;

            if (positions.length === 1) {
                const p = positions[0];
                const left = raw.slice(0, p);
                const right = raw.slice(p + 1);

                if (looksLikeMathText(right)) return `${left}$${right}$`;
                if (looksLikeMathText(left)) return `$${left}$${right}`;
            }

            const lastPos = positions[positions.length - 1];
            return raw.slice(0, lastPos) + raw.slice(lastPos + 1);
        });

        return cleaned.join('\n');
    }

    function countUnescapedSingleDollars(line) {
        const src = String(line || '');

        if (!src) return 0;

        let count = 0;

        for (let i = 0; i < src.length; i += 1) {
            if (src[i] !== '$') continue;
            if (i > 0 && src[i - 1] === '\\') continue;
            if ((i > 0 && src[i - 1] === '$') || (i + 1 < src.length && src[i + 1] === '$')) continue;

            count += 1;
        }

        return count;
    }

    function findUnescapedSingleDollarPositions(line) {
        const src = String(line || '');
        const pos = [];

        for (let i = 0; i < src.length; i += 1) {
            if (src[i] !== '$') continue;
            if (i > 0 && src[i - 1] === '\\') continue;
            if ((i > 0 && src[i - 1] === '$') || (i + 1 < src.length && src[i + 1] === '$')) continue;

            pos.push(i);
        }

        return pos;
    }

    function looksLikeMathText(value) {
        const src = String(value || '').trim();

        if (!src) return false;

        return /[=+\-*/^_{}\\]|\\[a-zA-Z]+|[A-Za-z]\s*\(|\d+\s*[A-Za-z]/.test(src);
    }

    function normalizeTableLineMathNoise(text) {
        const src = String(text || '');

        if (!src) return src;

        const lines = src.split('\n');
        const cleaned = lines.map((line) => {
            let row = String(line || '');
            const pipeCount = (row.match(/\|/g) || []).length;

            if (pipeCount < 2) return row;

            row = row.replace(/\$+\s*\|/g, '|');
            row = row.replace(/\|\s*\$+/g, '|');
            return row;
        });

        return cleaned.join('\n');
    }

    function escapeCurrencyDollarsInLine(line) {
        const src = String(line || '');

        if (!src.includes('$')) return src;

        const isEscaped = (index) => {
            let count = 0;

            for (let i = index - 1; i >= 0 && src[i] === '\\'; i -= 1) {
                count += 1;
            }

            return count % 2 === 1;
        };

        const readBacktickRun = (index) => {
            let end = index;

            while (end < src.length && src[end] === '`') {
                end += 1;
            }

            return end - index;
        };

        let out = '';
        let i = 0;

        while (i < src.length) {
            if (src[i] === '`') {
                const run = readBacktickRun(i);
                const end = src.indexOf('`'.repeat(run), i + run);

                if (end >= 0) {
                    const next = end + run;
                    out += src.slice(i, next);
                    i = next;
                    continue;
                }
            }

            if (src[i] === '$' && !isEscaped(i)) {
                const nextChar = src[i + 1] || '';
                const signNext = src[i + 2] || '';

                if (/[+-]?\d/.test(nextChar + ((nextChar === '+' || nextChar === '-') ? signNext : ''))) {
                    out += '\\$';
                    i += 1;
                    continue;
                }
            }

            out += src[i];
            i += 1;
        }

        return out;
    }

    function escapeLikelyCurrencyDollars(text) {
        const src = String(text || '');

        if (!src) return src;

        // 金额规则：$ 后紧跟数字（可带 +/-）即视为货币符号，转义为 \$，
        // 避免触发 LaTeX 分隔符；围栏代码块与行内代码内的 $ 属于代码内容，一律不转义。
        const lines = src.split('\n');
        const out = [];
        let activeFence = null;

        for (const line of lines) {
            const fence = String(line || '').match(/^\s*(`{3,}|~{3,})/);

            if (activeFence) {
                out.push(line);

                if (fence && fence[1][0] === activeFence.char && fence[1].length >= activeFence.length) {
                    activeFence = null;
                }
                continue;
            }

            if (fence) {
                activeFence = {
                    char: fence[1][0],
                    length: fence[1].length
                };
                out.push(line);
                continue;
            }

            out.push(escapeCurrencyDollarsInLine(line));
        }

        return out.join('\n');
    }

    function isLikelyPureMathSpan(body) {
        const src = String(body || '').trim();

        if (!src) return false;

        const cjkCount = (src.match(/[㐀-鿿]/g) || []).length;
        const mathTokenCount = (src.match(/[=+\-*/^_{}\\]|\\[a-zA-Z]+|\d/g) || []).length;

        if (!/\\[a-zA-Z]+|[=+\-*/^_{}]/.test(src)) return false;
        if (cjkCount > 0 && cjkCount * 2 > mathTokenCount) return false;

        return true;
    }

    function normalizeMathBlockLineBreaks(text) {
        const src = String(text || '');

        if (!src) return src;

        const fixRows = (body) => String(body || '').replace(/(^|[^\\])\\\s*\n/g, '$1\\\\\n');
        let out = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => `$$${fixRows(body)}$$`);

        out = out.replace(/\\begin\{(align\*?|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g, (_, env, body) => {
            return `\\begin{${env}}${fixRows(body)}\\end{${env}}`;
        });

        return out;
    }

    function collapseDisplayMathForMarkdown(text) {
        const src = String(text || '');

        if (!src) return src;

        const normalizeBody = (body) => String(body || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .trim()
            .replace(/\n+/g, ' ');

        let out = src.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => `$$${normalizeBody(body)}$$`);
        out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `\\[${normalizeBody(body)}\\]`);

        return out;
    }

    function normalizeFencedLatexBlocks(text) {
        let src = String(text || '');

        if (!src) return src;

        src = src.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, langRaw, body) => {
            const lang = String(langRaw || '').trim().toLowerCase();
            const content = String(body || '').replace(/\r\n/g, '\n').trim();

            if (!content) return '';

            if (/(^|[\s,])(latex|tex|math)([\s,]|$)/.test(lang)) {
                return content;
            }

            if (lang) {
                return `\`\`\`${langRaw}\n${body}\`\`\``;
            }

            const hasMath = /\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD|center)\}|\\\[|\\\(|\$\$|\$(?:\\.|[^$\n\\])+\$/.test(content);
            const hasProgrammingSignals = /\b(function|const|let|var|class|if|return|import|export|from|public|private|def)\b|=>|<\/?[a-z][^>]*>|^\s*[{}[\];]+\s*$/m.test(content);

            if (hasMath && !hasProgrammingSignals) {
                return content;
            }

            return `\`\`\`${langRaw}\n${body}\`\`\``;
        });

        return src;
    }

    function normalizeCenterLikeMathBlocks(text) {
        let src = String(text || '');

        if (!src) return src;

        const hasDisplayDelimiters = (body) => {
            const textValue = String(body || '').trim();

            if (!textValue) return false;
            if (/^\\\[[\s\S]*\\\]$/.test(textValue)) return true;
            if (/^\$\$[\s\S]*\$\$$/.test(textValue)) return true;
            if (/^\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}[\s\S]*\\end\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}$/.test(textValue)) return true;

            return false;
        };

        const normalizeBody = (body) => String(body || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .trim();

        src = src.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (_, body) => {
            const inner = normalizeBody(body);

            if (!inner) return '';
            if (hasDisplayDelimiters(inner)) return inner;
            if (!isLikelyPureMathSpan(inner)) return inner;

            return `\\[${inner.replace(/\n+/g, ' ')}\\]`;
        });

        src = src.replace(/(^|\n)\s*\\centering\b\s*(?=\n|$)/g, '$1');

        return src;
    }

    function splitMathAwareSegments(text) {
        const src = String(text || '');

        if (!src) return [];

        const segments = [];
        const pattern = /(\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}[\s\S]*?\\end\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$(?:\\.|[^$\n\\])+\$)/g;
        let last = 0;
        let match;

        while ((match = pattern.exec(src)) !== null) {
            const idx = match.index;

            if (idx > last) {
                segments.push({ isMath: false, text: src.slice(last, idx) });
            }

            segments.push({ isMath: true, text: String(match[0] || '') });
            last = idx + match[0].length;
        }

        if (last < src.length) {
            segments.push({ isMath: false, text: src.slice(last) });
        }

        return segments;
    }

    function protectMathSegmentsForMarkdown(text) {
        const segments = splitMathAwareSegments(text);

        if (!segments.length) {
            return { text: String(text || ''), map: [] };
        }

        const map = [];
        let out = '';
        let index = 0;

        for (const segment of segments) {
            if (!segment.isMath) {
                out += segment.text;
                continue;
            }

            const token = `@@NX_MSEG_${index}@@`;
            map.push({ token, math: segment.text });
            out += token;
            index += 1;
        }

        return { text: out, map };
    }

    function restoreMathSegmentsFromHtml(html, map) {
        let out = String(html || '');
        const items = Array.isArray(map) ? map : [];

        for (const item of items) {
            if (!item || !item.token) continue;

            out = out.split(String(item.token)).join(String(item.math || ''));
        }

        return out;
    }

    const mathRenderTimerMap = new WeakMap();
    const mathRenderRetryMap = new WeakMap();
    const mathLazyStateMap = new WeakMap();
    let mathLazyObserver = null;

    function looksLikeLatexRenderableCodeBlock(text, className = '') {
        const src = String(text || '').trim();

        if (!src) return false;

        const lang = String(className || '').toLowerCase();

        if (/\blanguage-(latex|tex|math)\b|\blatex\b|\btex\b/.test(lang)) return true;

        const hasMath = /\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}|\\\[|\\\(|\$\$|\$(?:\\.|[^$\n\\])+\$/.test(src);

        if (!hasMath) return false;

        const hasProgrammingSignals = /\b(function|const|let|var|class|if|return|import|export|from|public|private|def)\b|=>|<\/?[a-z][^>]*>|^\s*[{}[\];]+\s*$/m.test(src);

        if (hasProgrammingSignals) return false;

        return true;
    }

    function requireRenderDependency(deps, name) {
        const fn = deps && deps[name];

        if (typeof fn !== 'function') {
            throw new Error(`chat_latex.js missing render dependency: ${name}`);
        }

        return fn;
    }

    function promoteLatexCodeBlocks(root, deps = {}) {
        if (!root || typeof root.querySelectorAll !== 'function') return;

        const codeNodes = Array.from(root.querySelectorAll('pre > code'));

        codeNodes.forEach((codeEl) => {
            const preEl = codeEl && codeEl.parentElement;

            if (!preEl || preEl.dataset.latexPromoted === '1') return;

            const raw = String(codeEl.textContent || '');
            const cls = String(codeEl.className || '');

            if (!looksLikeLatexRenderableCodeBlock(raw, cls)) return;

            const renderMarkdown = requireRenderDependency(deps, 'renderMarkdownWithNewTabLinks');
            const bindSource = requireRenderDependency(deps, 'bindSourceMarkdown');
            const holder = document.createElement('div');

            holder.className = 'latex-code-render';
            holder.innerHTML = renderMarkdown(raw, { breaks: false });
            bindSource(holder, raw);
            preEl.dataset.latexPromoted = '1';
            preEl.replaceWith(holder);
        });
    }

    function isLiveStreamMathRenderRoot(root) {
        if (!root) return false;
        if (root.classList && root.classList.contains('stream-live-tail')) return true;
        if (root.dataset && String(root.dataset.streamLive || '') === '1') return true;
        if (typeof root.closest === 'function') {
            if (root.closest('.stream-live-tail')) return true;
            if (root.closest('[data-stream-live="1"]')) return true;
        }

        return false;
    }

    function isMathRenderRootVisible(root) {
        if (!root || !root.isConnected) return false;
        if (typeof root.getBoundingClientRect !== 'function') return false;

        const style = window.getComputedStyle ? window.getComputedStyle(root) : null;

        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

        const rect = root.getBoundingClientRect();

        if (!rect || rect.width <= 0 || rect.height <= 0) return false;

        const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
        const vh = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
        const margin = 80;

        return (
            rect.bottom >= -margin
            && rect.right >= -margin
            && rect.top <= (vh + margin)
            && rect.left <= (vw + margin)
        );
    }

    function getMathRenderSourceText(root) {
        if (!root) return '';

        return String(root.__sourceMarkdown || root.dataset.sourceMarkdown || root.textContent || '').trim();
    }

    function hasVisibleMathMarkers(text) {
        const src = String(text || '');

        if (!src.trim()) return false;

        return /\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}|\\\[|\\\]|\$\$|\$(?:\\.|[^$\n\\])+\$|\\\(|\\\)/.test(src);
    }

    function estimateMathPlaceholderHeight(root) {
        const src = getMathRenderSourceText(root);

        if (!hasVisibleMathMarkers(src)) return 0;

        const lines = Math.max(1, src.split('\n').length);
        const blockCount = (src.match(/\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}|\\\[|\$\$/g) || []).length;
        const inlineCount = (src.match(/\$(?:\\.|[^$\n\\])+\$|\\\(|\\\)/g) || []).length;
        const lengthScore = Math.min(1200, Math.floor(src.length * 0.08));
        const lineScore = Math.min(900, lines * 18);
        const blockScore = blockCount * 140;
        const inlineScore = inlineCount * 18;

        return Math.max(120, Math.min(2400, lengthScore + lineScore + blockScore + inlineScore));
    }

    function applyMathLazyPlaceholder(root) {
        if (!root || !root.classList) return;

        const height = estimateMathPlaceholderHeight(root);

        if (height > 0) {
            if (typeof root.classList.add === 'function') {
                root.classList.add('math-lazy-pending');
            }
            root.style.minHeight = `${height}px`;
            root.dataset.mathLazyPlaceholder = String(height);
        }
    }

    function clearMathLazyPlaceholder(root) {
        if (!root || !root.classList) return;

        if (typeof root.classList.remove === 'function') {
            root.classList.remove('math-lazy-pending');
        }

        if (root.dataset && root.dataset.mathLazyPlaceholder) {
            delete root.dataset.mathLazyPlaceholder;
            root.style.minHeight = '';
        }
    }

    function ensureMathLazyObserver() {
        if (mathLazyObserver) return mathLazyObserver;
        if (typeof IntersectionObserver !== 'function') return null;

        mathLazyObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const target = entry && entry.target;

                if (!target) return;
                if (!entry.isIntersecting) return;

                const state = mathLazyStateMap.get(target);

                if (!state || !state.pending) return;

                state.pending = false;

                if (typeof mathLazyObserver.unobserve === 'function') {
                    try { mathLazyObserver.unobserve(target); } catch (_) {}
                }

                renderMathSafe(target, { force: true }, state.deps || {});
            });
        }, {
            root: null,
            rootMargin: '180px 0px',
            threshold: 0.01,
        });

        return mathLazyObserver;
    }

    function scheduleLazyMathRender(root, deps = {}) {
        if (!root) return;

        const observer = ensureMathLazyObserver();
        const state = mathLazyStateMap.get(root) || {};

        state.pending = true;
        state.observed = true;
        state.deps = deps;
        mathLazyStateMap.set(root, state);
        applyMathLazyPlaceholder(root);

        if (!observer) {
            const timer = setTimeout(() => renderMathSafe(root, { force: true }, deps), 120);
            mathRenderTimerMap.set(root, timer);
            return;
        }

        try {
            observer.observe(root);
        } catch (_) {
            const timer = setTimeout(() => renderMathSafe(root, { force: true }, deps), 160);
            mathRenderTimerMap.set(root, timer);
        }
    }

    function getRenderMathInElement(deps = {}) {
        return typeof deps.renderMathInElement === 'function'
            ? deps.renderMathInElement
            : window.renderMathInElement;
    }

    function buildKatexRenderOptions() {
        return {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\begin{equation}', right: '\\end{equation}', display: true },
                { left: '\\begin{equation*}', right: '\\end{equation*}', display: true },
                { left: '\\begin{align}', right: '\\end{align}', display: true },
                { left: '\\begin{align*}', right: '\\end{align*}', display: true },
                { left: '\\begin{alignat}', right: '\\end{alignat}', display: true },
                { left: '\\begin{alignat*}', right: '\\end{alignat*}', display: true },
                { left: '\\begin{gather}', right: '\\end{gather}', display: true },
                { left: '\\begin{gather*}', right: '\\end{gather*}', display: true },
                { left: '\\begin{CD}', right: '\\end{CD}', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
            throwOnError: false,
            strict: (errorCode) => {
                if (errorCode === 'unicodeTextInMathMode') {
                    return 'ignore';
                }

                return 'warn';
            },
        };
    }

    function renderMathInElementSync(root, deps = {}) {
        if (!root) return false;

        const renderMath = getRenderMathInElement(deps);

        if (typeof renderMath !== 'function') return false;

        try {
            promoteLatexCodeBlocks(root, deps);
            renderMath(root, buildKatexRenderOptions());
            return true;
        } catch (_) {
            return false;
        }
    }

    function renderMathSafe(root, options = {}, deps = {}) {
        if (!root) return;

        const opts = (options && typeof options === 'object') ? options : {};
        const force = !!opts.force;
        const prevTimer = mathRenderTimerMap.get(root);

        if (prevTimer) clearTimeout(prevTimer);

        const immediateForStream = isLiveStreamMathRenderRoot(root);

        if (!force && !isMathRenderRootVisible(root)) {
            if (hasVisibleMathMarkers(getMathRenderSourceText(root))) {
                scheduleLazyMathRender(root, deps);
            }

            return;
        }

        const runRender = () => {
            try {
                clearMathLazyPlaceholder(root);

                const renderMath = getRenderMathInElement(deps);

                if (typeof renderMath !== 'function') {
                    const retries = (mathRenderRetryMap.get(root) || 0) + 1;

                    mathRenderRetryMap.set(root, retries);

                    if (retries <= 20) {
                        const retryDelay = immediateForStream ? 26 : 80;
                        const retryTimer = setTimeout(() => renderMathSafe(root, { force: true }, deps), retryDelay);

                        mathRenderTimerMap.set(root, retryTimer);
                    }

                    return;
                }

                mathRenderRetryMap.set(root, 0);

                if (String(root.innerHTML || '').includes('nx-mseg-placeholder')) {
                    console.warn('LaTeX placeholder leaked into render root', root);
                }

                promoteLatexCodeBlocks(root, deps);
                renderMath(root, buildKatexRenderOptions());

                if (typeof deps.onMathRendered === 'function') {
                    deps.onMathRendered(root);
                }

                const state = mathLazyStateMap.get(root);

                if (state) {
                    state.pending = false;
                    mathLazyStateMap.set(root, state);
                }
            } catch (e) {
                console.warn('LaTeX render failed:', e);
                clearMathLazyPlaceholder(root);
            }
        };

        if (immediateForStream) {
            mathRenderTimerMap.set(root, null);
            runRender();
            return;
        }

        const timer = setTimeout(runRender, 80);
        mathRenderTimerMap.set(root, timer);
    }

    requireShared().registerModule('latex', {
        stripUnbalancedInlineDollarsByLine,
        countUnescapedSingleDollars,
        findUnescapedSingleDollarPositions,
        looksLikeMathText,
        normalizeTableLineMathNoise,
        escapeLikelyCurrencyDollars,
        isLikelyPureMathSpan,
        normalizeMathBlockLineBreaks,
        collapseDisplayMathForMarkdown,
        normalizeFencedLatexBlocks,
        normalizeCenterLikeMathBlocks,
        splitMathAwareSegments,
        protectMathSegmentsForMarkdown,
        restoreMathSegmentsFromHtml,
        looksLikeLatexRenderableCodeBlock,
        promoteLatexCodeBlocks,
        renderMathInElementSync,
        renderMathSafe,
    });
})();
