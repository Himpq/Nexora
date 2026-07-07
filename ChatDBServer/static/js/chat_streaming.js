(function() {
    'use strict';

    const MODULE_NAME = 'streaming';
    const MATH_ENV_NAMES = ['equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'CD'];

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Streaming 模块');
        }

        return shared;
    }

    function requireStreamingDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_streaming 缺少依赖: ${name}`);
        }

        return value;
    }

    function requireStreamingObjectDependency(deps, name, validator) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;
        const isValid = typeof validator === 'function' ? validator(value) : !!value;

        if (!isValid) {
            throw new Error(`chat_streaming 缺少依赖: ${name}`);
        }

        return value;
    }

    function hasLikelyMathForThinkingStream(text) {
        return hasLikelyMathDelimiter(text);
    }

    function hasLikelyMathDelimiter(text) {
        return /(\$\$|\\\(|\\\[|\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?|CD)\}|(^|[^\\])\$[^$\s])/m.test(String(text || ''));
    }

    function countUnescapedInlineToken(text, token) {
        const src = String(text || '');
        const target = String(token || '');

        if (!src || !target) {
            return 0;
        }

        let count = 0;

        for (let i = 0; i <= src.length - target.length; i += 1) {
            if (src.slice(i, i + target.length) !== target) {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            count += 1;
            i += target.length - 1;
        }

        return count;
    }

    function countUnescapedInlineChar(text, ch) {
        const src = String(text || '');
        const target = String(ch || '');

        if (!src || !target) {
            return 0;
        }

        let count = 0;

        for (let i = 0; i < src.length; i += 1) {
            if (src[i] !== target) {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            count += 1;
        }

        return count;
    }

    function hasLikelyUnbalancedMarkdownInline(text) {
        const src = String(text || '');

        if (!src) {
            return false;
        }

        if (countUnescapedInlineChar(src, '`') % 2 !== 0) {
            return true;
        }

        if (countUnescapedInlineToken(src, '**') % 2 !== 0) {
            return true;
        }

        if (countUnescapedInlineToken(src, '__') % 2 !== 0) {
            return true;
        }

        if (countUnescapedInlineToken(src, '~~') % 2 !== 0) {
            return true;
        }

        return false;
    }

    function countUnescapedSingleDollars(text) {
        const src = String(text || '');

        if (!src) {
            return 0;
        }

        let count = 0;

        for (let i = 0; i < src.length; i += 1) {
            if (src[i] !== '$') {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            if ((i > 0 && src[i - 1] === '$') || (i + 1 < src.length && src[i + 1] === '$')) {
                continue;
            }

            count += 1;
        }

        return count;
    }

    function countUnescapedDoubleDollar(text) {
        const src = String(text || '');

        if (!src) {
            return 0;
        }

        let count = 0;

        for (let i = 0; i < src.length - 1; i += 1) {
            if (src[i] !== '$' || src[i + 1] !== '$') {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            count += 1;
            i += 1;
        }

        return count;
    }

    function streamMathIsEscapedAt(text, index) {
        const src = String(text || '');
        let slashCount = 0;

        for (let i = Number(index) - 1; i >= 0 && src[i] === '\\'; i -= 1) {
            slashCount += 1;
        }

        return slashCount % 2 === 1;
    }

    function countEscapedMathDelimiter(text, delimiter) {
        const src = String(text || '');
        const target = String(delimiter || '');

        if (!src || !target) {
            return 0;
        }

        let count = 0;

        for (let i = 0; i <= src.length - target.length; i += 1) {
            if (src.slice(i, i + target.length) !== target) {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            count += 1;
            i += target.length - 1;
        }

        return count;
    }

    function countLatexEnvironmentBoundary(text, envName, kind = 'begin') {
        const src = String(text || '');
        const env = String(envName || '').trim();

        if (!src || !env) {
            return 0;
        }

        const token = kind === 'end' ? `\\end{${env}}` : `\\begin{${env}}`;
        let count = 0;

        for (let i = 0; i <= src.length - token.length; i += 1) {
            if (src.slice(i, i + token.length) !== token) {
                continue;
            }

            if (streamMathIsEscapedAt(src, i)) {
                continue;
            }

            count += 1;
            i += token.length - 1;
        }

        return count;
    }

    function hasOpenMathDelimiters(text) {
        const src = String(text || '');

        if (!src) {
            return false;
        }

        if (countUnescapedDoubleDollar(src) % 2 !== 0) {
            return true;
        }

        if (countEscapedMathDelimiter(src, '\\[') !== countEscapedMathDelimiter(src, '\\]')) {
            return true;
        }

        if (countEscapedMathDelimiter(src, '\\(') !== countEscapedMathDelimiter(src, '\\)')) {
            return true;
        }

        for (const envName of MATH_ENV_NAMES) {
            if (countLatexEnvironmentBoundary(src, envName, 'begin') !== countLatexEnvironmentBoundary(src, envName, 'end')) {
                return true;
            }
        }

        return countUnescapedSingleDollars(src) % 2 !== 0;
    }

    function streamMathFindOpenTailInfo(text) {
        const src = String(text || '');

        if (!src) {
            return { index: -1, type: '' };
        }

        let activeType = '';
        let activeIndex = -1;

        for (let i = 0; i < src.length; i += 1) {
            if (!activeType) {
                let openedEnv = '';

                for (const envName of MATH_ENV_NAMES) {
                    const token = `\\begin{${envName}}`;

                    if (src.slice(i, i + token.length) === token && !streamMathIsEscapedAt(src, i)) {
                        openedEnv = envName;
                        break;
                    }
                }

                if (openedEnv) {
                    activeType = `env:${openedEnv}`;
                    activeIndex = i;
                    i += (`\\begin{${openedEnv}}`.length - 1);
                    continue;
                }

                if (src.slice(i, i + 2) === '$$' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '$$';
                    activeIndex = i;
                    i += 1;
                    continue;
                }

                if (src.slice(i, i + 2) === '\\[' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '\\[';
                    activeIndex = i;
                    i += 1;
                    continue;
                }

                if (src.slice(i, i + 2) === '\\(' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '\\(';
                    activeIndex = i;
                    i += 1;
                    continue;
                }

                if (
                    src[i] === '$' &&
                    !streamMathIsEscapedAt(src, i) &&
                    src[i - 1] !== '$' &&
                    src[i + 1] !== '$'
                ) {
                    activeType = '$';
                    activeIndex = i;
                }

                continue;
            }

            if (activeType.startsWith('env:')) {
                const envName = activeType.slice(4);
                const closeToken = `\\end{${envName}}`;

                if (src.slice(i, i + closeToken.length) === closeToken && !streamMathIsEscapedAt(src, i)) {
                    activeType = '';
                    activeIndex = -1;
                    i += closeToken.length - 1;
                }

                continue;
            }

            if (activeType === '$$') {
                if (src.slice(i, i + 2) === '$$' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '';
                    activeIndex = -1;
                    i += 1;
                }

                continue;
            }

            if (activeType === '\\[') {
                if (src.slice(i, i + 2) === '\\]' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '';
                    activeIndex = -1;
                    i += 1;
                }

                continue;
            }

            if (activeType === '\\(') {
                if (src.slice(i, i + 2) === '\\)' && !streamMathIsEscapedAt(src, i)) {
                    activeType = '';
                    activeIndex = -1;
                    i += 1;
                }

                continue;
            }

            if (
                activeType === '$' &&
                src[i] === '$' &&
                !streamMathIsEscapedAt(src, i) &&
                src[i - 1] !== '$' &&
                src[i + 1] !== '$'
            ) {
                activeType = '';
                activeIndex = -1;
            }
        }

        return activeType ? { index: activeIndex, type: activeType } : { index: -1, type: '' };
    }

    function streamMathFindOpenTailStart(text) {
        return streamMathFindOpenTailInfo(text).index;
    }

    function streamMathBuildProvisionalClosedTail(rawTail, openType) {
        const tail = String(rawTail || '');
        const type = String(openType || '');

        if (!tail || !type) {
            return tail;
        }

        if (type.startsWith('env:')) {
            const envName = type.slice(4).trim();

            if (!envName) {
                return tail;
            }

            return `${tail}\\end{${envName}}`;
        }

        if (type === '$$') {
            return `${tail}$$`;
        }

        if (type === '\\[') {
            return `${tail}\\]`;
        }

        if (type === '\\(') {
            return `${tail}\\)`;
        }

        if (type === '$') {
            return `${tail}$`;
        }

        return tail;
    }

    function isStreamRenderDebugEnabled() {
        try {
            if (window.__nexoraStreamRenderDebug === true) {
                return true;
            }

            return localStorage.getItem('nexora_stream_render_debug_v1') === '1';
        } catch (_) {
            return window.__nexoraStreamRenderDebug === true;
        }
    }

    function setupStreamRenderDebugGlobals() {
        try {
            if (typeof window.__nexoraSetStreamRenderDebug !== 'function') {
                window.__nexoraSetStreamRenderDebug = function(enabled) {
                    const on = !!enabled;
                    window.__nexoraStreamRenderDebug = on;

                    try {
                        localStorage.setItem('nexora_stream_render_debug_v1', on ? '1' : '0');
                    } catch (_) {
                        // ignore
                    }

                    return on;
                };
            }

            if (typeof window.__nexoraIsStreamRenderDebugEnabled !== 'function') {
                window.__nexoraIsStreamRenderDebugEnabled = function() {
                    return isStreamRenderDebugEnabled();
                };
            }
        } catch (_) {
            // ignore global helper setup errors
        }
    }

    function toStreamRenderDebugSnippet(text, limit = 120) {
        const src = String(text || '').replace(/\r\n/g, '\n').replace(/\n/g, '↩');

        if (src.length <= limit) {
            return src;
        }

        return `${src.slice(0, limit)}...`;
    }

    function pushStreamRenderDebug(stage, state, payload = {}, context = {}) {
        if (!isStreamRenderDebugEnabled()) {
            return;
        }

        try {
            const extra = (payload && typeof payload === 'object') ? payload : {};
            const ctx = (context && typeof context === 'object') ? context : {};
            const entry = {
                ts: Date.now(),
                stage: String(stage || 'trace'),
                conversationId: String(ctx.conversationId || ''),
                msgId: String(ctx.msgId || ''),
                blockId: String((state && state.debugId) || (extra && extra.blockId) || ''),
                ...extra
            };
            const store = Array.isArray(window.__nexoraStreamRenderDebugLog) ? window.__nexoraStreamRenderDebugLog : [];

            store.push(entry);

            while (store.length > 600) {
                store.shift();
            }

            window.__nexoraStreamRenderDebugLog = store;
            window.__nexoraStreamRenderDebugLast = entry;

            if (typeof window.__nexoraDumpStreamRenderDebug !== 'function') {
                window.__nexoraDumpStreamRenderDebug = function() {
                    try {
                        const arr = Array.isArray(window.__nexoraStreamRenderDebugLog) ? window.__nexoraStreamRenderDebugLog : [];
                        console.log('[NexoraStreamRenderDump]', arr);
                        return arr;
                    } catch (_) {
                        return [];
                    }
                };
            }
        } catch (_) {
            // ignore debug log errors
        }
    }

    function createStreamRenderController(deps = {}) {
        const ownerDocument = requireStreamingObjectDependency(deps, 'document', (value) => {
            return value && typeof value.createElement === 'function';
        });
        const requestAnimationFrameFn = requireStreamingDependency(deps, 'requestAnimationFrame');
        const cancelAnimationFrameFn = requireStreamingDependency(deps, 'cancelAnimationFrame');
        const setTimeoutFn = requireStreamingDependency(deps, 'setTimeout');
        const clearTimeoutFn = requireStreamingDependency(deps, 'clearTimeout');
        const renderStreamBlockMarkdown = requireStreamingDependency(deps, 'renderStreamBlockMarkdown');
        const renderMarkdownWithNewTabLinks = requireStreamingDependency(deps, 'renderMarkdownWithNewTabLinks');
        const renderMathInElementSync = requireStreamingDependency(deps, 'renderMathInElementSync');
        const renderMathSafe = requireStreamingDependency(deps, 'renderMathSafe');
        const renderCompletedStreamMath = requireStreamingDependency(deps, 'renderCompletedStreamMath');
        const bindSourceMarkdown = requireStreamingDependency(deps, 'bindSourceMarkdown');
        const rewriteCitationRefsMarkdown = requireStreamingDependency(deps, 'rewriteCitationRefsMarkdown');
        const highlightCode = requireStreamingDependency(deps, 'highlightCode');
        const finishReasoningThinkingBlock = requireStreamingDependency(deps, 'finishReasoningThinkingBlock');
        const placeInteractiveCardsBelowToolChain = requireStreamingDependency(deps, 'placeInteractiveCardsBelowToolChain');
        const toDebugSnippet = requireStreamingDependency(deps, 'toStreamRenderDebugSnippet');
        const pushDebug = requireStreamingDependency(deps, 'pushStreamRenderDebug');

        const stateByBlock = new WeakMap();
        let debugSeq = 0;
        let streamRenderFinalized = false;

        function ensureStreamBlockState(block) {
            if (!block) {
                return null;
            }

            let state = stateByBlock.get(block);

            if (!state || typeof state !== 'object') {
                const renderedEl = ownerDocument.createElement('div');
                renderedEl.className = 'stream-rendered';

                const liveEl = ownerDocument.createElement('div');
                liveEl.className = 'stream-live-tail';

                block.innerHTML = '';
                block.appendChild(renderedEl);
                block.appendChild(liveEl);

                state = {
                    renderedEl,
                    liveEl,
                    liveRaw: '',
                    mathRenderRaf: null,
                    mathRenderTimer: null,
                    mathRenderPending: null,
                    lastRenderedSource: '',
                    lastRenderedMode: '',
                    lastStablePrefix: '',
                    liveRawTailEl: null,
                    lastMathRenderTs: 0,
                    debugId: ''
                };

                debugSeq += 1;
                state.debugId = `sr_${Date.now().toString(36)}_${debugSeq}`;

                if (block.dataset) {
                    block.dataset.streamDebugId = state.debugId;
                }

                stateByBlock.set(block, state);
                pushDebug('state_init', state, {
                    blockTag: String((block && block.tagName) || '').toLowerCase()
                });
            }

            return state;
        }

        function clearLiveMathRenderSchedule(state) {
            if (!state || typeof state !== 'object') {
                return;
            }

            if (state.mathRenderRaf) {
                cancelAnimationFrameFn(state.mathRenderRaf);
                state.mathRenderRaf = null;
            }

            if (state.mathRenderTimer) {
                clearTimeoutFn(state.mathRenderTimer);
                state.mathRenderTimer = null;
            }

            state.mathRenderPending = null;
        }

        function applyScratchIntoLiveEl(liveEl, scratch) {
            if (!liveEl || !scratch) {
                return;
            }

            liveEl.innerHTML = '';

            while (scratch.firstChild) {
                liveEl.appendChild(scratch.firstChild);
            }
        }

        function scheduleLiveMathRender(state, payload) {
            if (!state || !state.liveEl || !payload) {
                return;
            }

            state.mathRenderPending = payload;

            if (state.mathRenderRaf || state.mathRenderTimer) {
                return;
            }

            const now = Date.now();
            const mode = String(payload.mode || '');
            const minGapMs = mode === 'math_closed' ? 80 : (mode === 'math_open' ? 50 : 34);
            const waitMs = Math.max(0, minGapMs - (now - Number(state.lastMathRenderTs || 0)));

            pushDebug('math_schedule', state, {
                mode,
                waitMs,
                srcLen: String(payload.sourceText || '').length,
                hasOpenMath: !!payload.hasOpenMath
            });

            state.mathRenderTimer = setTimeoutFn(() => {
                state.mathRenderTimer = null;
                state.mathRenderRaf = requestAnimationFrameFn(() => {
                    state.mathRenderRaf = null;

                    const job = state.mathRenderPending;
                    state.mathRenderPending = null;

                    if (!job || !state.liveEl) {
                        return;
                    }

                    const sourceText = String(job.sourceText || '');
                    const scratch = ownerDocument.createElement('div');
                    scratch.className = 'stream-live-tail';

                    if (job.hasOpenMath) {
                        const stablePrefix = String(job.stablePrefix || '');
                        const provisionalTail = String(job.provisionalTail || '');
                        const composed = `${stablePrefix}${provisionalTail}`;
                        let rendered = false;

                        if (composed.trim()) {
                            scratch.innerHTML = renderStreamBlockMarkdown(state.liveEl, composed);
                            rendered = renderMathInElementSync(scratch);
                        }

                        if (!rendered) {
                            const hasPreviousRenderedView = !!(state.liveEl && state.liveEl.childNodes && state.liveEl.childNodes.length > 0);
                            const prevMode = String(state.lastRenderedMode || '');
                            const canHoldPrevRendered = hasPreviousRenderedView && prevMode !== 'raw' && prevMode !== 'raw_open_head';

                            if (canHoldPrevRendered) {
                                bindSourceMarkdown(state.liveEl, sourceText);
                                state.lastRenderedSource = sourceText;
                                state.lastRenderedMode = 'hold_math_open_render_fail';
                                state.lastStablePrefix = stablePrefix;
                                state.liveRawTailEl = null;
                                state.lastMathRenderTs = Date.now();
                                pushDebug('math_open_hold_prev', state, {
                                    prevMode,
                                    stableLen: stablePrefix.length,
                                    tailLen: String(job.unstableTail || '').length
                                });
                                return;
                            }

                            scratch.innerHTML = renderStreamBlockMarkdown(state.liveEl, stablePrefix);

                            if (hasLikelyMathDelimiter(stablePrefix) && !hasOpenMathDelimiters(stablePrefix)) {
                                renderMathInElementSync(scratch);
                            }

                            const rawTailEl = ownerDocument.createElement('span');
                            rawTailEl.className = 'stream-live-tail-raw-segment';
                            rawTailEl.textContent = String(job.unstableTail || '');
                            scratch.appendChild(rawTailEl);
                            pushDebug('math_open_raw_tail', state, {
                                stableLen: stablePrefix.length,
                                tailLen: String(job.unstableTail || '').length
                            });
                        }
                    } else {
                        scratch.innerHTML = renderStreamBlockMarkdown(state.liveEl, sourceText);

                        if (job.hasMath) {
                            renderMathInElementSync(scratch);
                        }
                    }

                    bindSourceMarkdown(state.liveEl, sourceText);
                    state.liveEl.classList.remove('stream-live-raw');
                    applyScratchIntoLiveEl(state.liveEl, scratch);
                    state.lastRenderedSource = sourceText;
                    state.lastRenderedMode = String(job.mode || '');
                    state.lastStablePrefix = job.hasOpenMath ? String(job.stablePrefix || '') : '';
                    state.liveRawTailEl = job.hasOpenMath ? state.liveEl.querySelector('.stream-live-tail-raw-segment') : null;
                    state.lastMathRenderTs = Date.now();
                    pushDebug('math_applied', state, {
                        mode: state.lastRenderedMode,
                        srcLen: sourceText.length,
                        katexCount: state.liveEl.querySelectorAll ? state.liveEl.querySelectorAll('.katex').length : 0,
                        hasRawTailNode: !!state.liveRawTailEl
                    });
                });
            }, waitMs);
        }

        function renderStreamFragment(rawText, citationMap, root = null) {
            const sourceText = rewriteCitationRefsMarkdown(String(rawText || ''), citationMap || {});
            const frag = ownerDocument.createElement('div');
            frag.className = 'stream-fragment';
            frag.innerHTML = renderStreamBlockMarkdown(root, sourceText);
            bindSourceMarkdown(frag, sourceText);
            highlightCode(frag);
            return frag;
        }

        function renderLiveStreamTail(block, citationMap) {
            const state = ensureStreamBlockState(block);

            if (!state) {
                return;
            }

            const raw = String(state.liveRaw || '');

            if (!raw) {
                clearLiveMathRenderSchedule(state);
                state.liveEl.innerHTML = '';
                state.liveEl.classList.remove('stream-live-raw');
                state.lastRenderedSource = '';
                state.lastRenderedMode = '';
                state.lastStablePrefix = '';
                state.liveRawTailEl = null;
                pushDebug('tail_empty', state);
                return;
            }

            const sourceText = rewriteCitationRefsMarkdown(raw, citationMap || {});
            const hasUnbalancedInlineMd = hasLikelyUnbalancedMarkdownInline(sourceText);
            const hasMath = hasLikelyMathDelimiter(sourceText);
            const openTailInfo = hasMath ? streamMathFindOpenTailInfo(sourceText) : { index: -1, type: '' };
            const openTailStart = Number(openTailInfo.index);
            const hasOpenMath = openTailStart >= 0;
            const canHoldRenderedView = () => {
                const mode = String(state.lastRenderedMode || '');

                if (!mode) {
                    return false;
                }

                return mode !== 'raw' && mode !== 'raw_open_head';
            };

            block.__streamSourceMarkdown = rewriteCitationRefsMarkdown(String(block.dataset.streamRaw || ''), citationMap || {});

            if (hasUnbalancedInlineMd) {
                clearLiveMathRenderSchedule(state);

                if (canHoldRenderedView()) {
                    // Keep last rendered DOM to avoid raw/render flicker when markdown tokens are mid-stream.
                    state.liveEl.classList.remove('stream-live-raw');
                    bindSourceMarkdown(state.liveEl, sourceText);
                    state.lastRenderedSource = sourceText;
                    state.lastRenderedMode = 'hold_unbalanced_md';
                    pushDebug('tail_hold_unbalanced_md', state, {
                        srcLen: sourceText.length,
                        srcHead: toDebugSnippet(sourceText)
                    });
                    return;
                }

                state.liveEl.classList.remove('stream-live-raw');
                state.liveEl.innerHTML = renderStreamBlockMarkdown(state.liveEl, sourceText);
                bindSourceMarkdown(state.liveEl, sourceText);
                state.lastRenderedSource = sourceText;
                state.lastRenderedMode = 'markdown_unbalanced';
                state.lastStablePrefix = '';
                state.liveRawTailEl = null;
                pushDebug('tail_raw_unbalanced_md', state, {
                    srcLen: sourceText.length,
                    srcHead: toDebugSnippet(sourceText)
                });
                return;
            }

            if (hasOpenMath) {
                const stablePrefix = sourceText.slice(0, openTailStart);
                const unstableTail = sourceText.slice(openTailStart);

                if (!stablePrefix.trim()) {
                    clearLiveMathRenderSchedule(state);

                    if (canHoldRenderedView()) {
                        // Avoid flashing back to raw text when formula head is still incomplete.
                        state.liveEl.classList.remove('stream-live-raw');
                        bindSourceMarkdown(state.liveEl, sourceText);
                        state.lastRenderedSource = sourceText;
                        state.lastRenderedMode = 'hold_math_open_head';
                        state.liveRawTailEl = null;
                        pushDebug('tail_hold_math_open_head', state, {
                            openType: String(openTailInfo.type || ''),
                            tailLen: unstableTail.length
                        });
                        return;
                    }

                    state.liveEl.classList.remove('stream-live-raw');
                    state.liveEl.innerHTML = renderStreamBlockMarkdown(state.liveEl, sourceText);
                    bindSourceMarkdown(state.liveEl, sourceText);
                    state.lastRenderedSource = sourceText;
                    state.lastRenderedMode = 'markdown_open_head';
                    state.lastStablePrefix = '';
                    state.liveRawTailEl = null;
                    pushDebug('tail_raw_math_open_head', state, {
                        openType: String(openTailInfo.type || ''),
                        tailLen: unstableTail.length
                    });
                    return;
                }

                if (
                    state.lastRenderedMode === 'math_open' &&
                    state.lastStablePrefix === stablePrefix &&
                    state.liveRawTailEl &&
                    state.liveRawTailEl.isConnected
                ) {
                    clearLiveMathRenderSchedule(state);
                    state.liveRawTailEl.textContent = unstableTail;
                    bindSourceMarkdown(state.liveEl, sourceText);
                    state.lastRenderedSource = sourceText;
                    pushDebug('tail_update_raw_tail_only', state, {
                        stableLen: stablePrefix.length,
                        tailLen: unstableTail.length
                    });
                    return;
                }

                const mode = 'math_open';

                if (state.lastRenderedSource === sourceText && state.lastRenderedMode === mode) {
                    return;
                }

                scheduleLiveMathRender(state, {
                    mode,
                    sourceText,
                    hasMath: true,
                    hasOpenMath: true,
                    stablePrefix,
                    unstableTail,
                    openMathType: String(openTailInfo.type || ''),
                    provisionalTail: streamMathBuildProvisionalClosedTail(unstableTail, openTailInfo.type)
                });
                pushDebug('tail_schedule_math_open', state, {
                    stableLen: stablePrefix.length,
                    tailLen: unstableTail.length,
                    openType: String(openTailInfo.type || '')
                });
                return;
            }

            if (hasMath) {
                const mode = 'math_closed';

                if (state.lastRenderedSource === sourceText && state.lastRenderedMode === mode) {
                    return;
                }

                scheduleLiveMathRender(state, {
                    mode,
                    sourceText,
                    hasMath: true,
                    hasOpenMath: false,
                    stablePrefix: '',
                    unstableTail: ''
                });
                pushDebug('tail_schedule_math_closed', state, {
                    srcLen: sourceText.length,
                    srcHead: toDebugSnippet(sourceText)
                });
                return;
            }

            clearLiveMathRenderSchedule(state);
            state.liveEl.classList.remove('stream-live-raw');
            state.liveEl.innerHTML = renderStreamBlockMarkdown(state.liveEl, sourceText);
            bindSourceMarkdown(state.liveEl, sourceText);
            highlightCode(state.liveEl);
            state.lastRenderedSource = sourceText;
            state.lastRenderedMode = 'plain';
            state.lastStablePrefix = '';
            state.liveRawTailEl = null;
            pushDebug('tail_plain', state, {
                srcLen: sourceText.length,
                srcHead: toDebugSnippet(sourceText)
            });
        }

        function flushStableStreamTail(block, citationMap, force = false) {
            const state = ensureStreamBlockState(block);

            if (!state) {
                return;
            }

            const raw = String(state.liveRaw || '');
            pushDebug('flush_enter', state, {
                force: !!force,
                rawLen: raw.length,
                hasMath: hasLikelyMathDelimiter(raw),
                hasOpenMath: hasOpenMathDelimiters(raw)
            });

            if (!raw) {
                renderLiveStreamTail(block, citationMap);
                return;
            }

            const hasUnbalancedInlineMd = hasLikelyUnbalancedMarkdownInline(raw);

            if (!force && hasUnbalancedInlineMd) {
                renderLiveStreamTail(block, citationMap);
                return;
            }

            const hasMath = hasLikelyMathDelimiter(raw);

            if (!force && hasMath && hasOpenMathDelimiters(raw)) {
                renderLiveStreamTail(block, citationMap);
                return;
            }

            if (!force) {
                renderLiveStreamTail(block, citationMap);
                return;
            }

            // force=true is used when closing current stream block, such as when a tool row is inserted.
            const fragment = renderStreamFragment(raw, citationMap, block);

            if (hasLikelyMathDelimiter(raw)) {
                const syncOk = renderMathInElementSync(fragment);
                pushDebug('flush_force_math_sync', state, {
                    rawLen: raw.length,
                    syncOk
                });

                if (!syncOk) {
                    try {
                        renderMathSafe(fragment);
                    } catch (_) {
                        // keep the committed fragment visible; math safe render errors are already non-terminal here
                    }
                }
            }

            state.renderedEl.appendChild(fragment);
            state.liveRaw = '';
            renderLiveStreamTail(block, citationMap);
        }

        function finalizeStreamingContentRender(aiMsgDiv) {
            if (streamRenderFinalized) {
                return;
            }

            streamRenderFinalized = true;

            try {
                const citationMap = (aiMsgDiv && aiMsgDiv.__citationUrlMap) || {};
                const blocks = aiMsgDiv.querySelectorAll('.content-body[data-stream-live="1"]');

                blocks.forEach((block) => {
                    const state = ensureStreamBlockState(block);
                    clearLiveMathRenderSchedule(state);

                    const raw = String(block.dataset.streamRaw || '');
                    const sourceText = rewriteCitationRefsMarkdown(raw, citationMap);
                    block.dataset.streamLive = '0';
                    block.innerHTML = renderMarkdownWithNewTabLinks(sourceText);
                    bindSourceMarkdown(block, sourceText);
                    renderCompletedStreamMath(block);
                    highlightCode(block);
                });

                const thinkingBlocks = aiMsgDiv.querySelectorAll('.thinking-block.reasoning-thinking-block[data-stream-live="1"] .thinking-content');

                thinkingBlocks.forEach((contentDiv) => {
                    const state = ensureStreamBlockState(contentDiv);
                    clearLiveMathRenderSchedule(state);

                    const raw = String(contentDiv.dataset.streamRaw || '');
                    const host = contentDiv.closest('.thinking-block.reasoning-thinking-block');

                    if (host) {
                        finishReasoningThinkingBlock(host, raw);
                    } else {
                        contentDiv.dataset.streamLive = '0';
                    }

                    if (raw) {
                        const sourceText = rewriteCitationRefsMarkdown(raw, citationMap);
                        contentDiv.innerHTML = renderMarkdownWithNewTabLinks(sourceText, { breaks: true });
                        bindSourceMarkdown(contentDiv, sourceText);
                        renderCompletedStreamMath(contentDiv);
                        highlightCode(contentDiv);
                    } else {
                        renderCompletedStreamMath(contentDiv);
                    }
                });

                const longtermBlocks = aiMsgDiv.querySelectorAll('.thinking-block.longterm-hook-block[data-longterm-plan="1"]');

                longtermBlocks.forEach((block) => {
                    block.dataset.streamLive = '0';
                });

                placeInteractiveCardsBelowToolChain(aiMsgDiv);
            } catch (_) {
                // keep finalization non-terminal to match the original stream close behavior
            }
        }

        return {
            ensureStreamBlockState,
            clearLiveMathRenderSchedule,
            scheduleLiveMathRender,
            renderStreamFragment,
            renderLiveStreamTail,
            flushStableStreamTail,
            finalizeStreamingContentRender,
        };
    }

    function renderCompletedStreamMath(root, deps = {}) {
        if (!root) {
            return;
        }

        const renderMathInElementSync = requireStreamingDependency(deps, 'renderMathInElementSync');
        const renderMathSafe = requireStreamingDependency(deps, 'renderMathSafe');

        // 流式结束时必须立即完成最终 KaTeX 渲染，否则用户会看到原始 LaTeX 直到刷新历史记录。
        const syncRendered = renderMathInElementSync(root);

        if (!syncRendered) {
            renderMathSafe(root, { force: true });
        }
    }

    function createStreamMessageDomController(deps = {}) {
        const resolveAssistantStreamMessageDiv = requireStreamingDependency(deps, 'resolveAssistantStreamMessageDiv');
        const resolveContentBodyForFullTextUpdate = requireStreamingDependency(deps, 'resolveContentBodyForFullTextUpdate');
        const applyLongtermPlanFromText = requireStreamingDependency(deps, 'applyLongtermPlanFromText');
        const renderStreamingMarkdownWithNewTabLinks = requireStreamingDependency(deps, 'renderStreamingMarkdownWithNewTabLinks');
        const renderMarkdownWithNewTabLinks = requireStreamingDependency(deps, 'renderMarkdownWithNewTabLinks');
        const bindSourceMarkdown = requireStreamingDependency(deps, 'bindSourceMarkdown');
        const highlightCode = requireStreamingDependency(deps, 'highlightCode');
        const resolveReasoningThinkingBlockForAppend = requireStreamingDependency(deps, 'resolveReasoningThinkingBlockForAppend');
        const markReasoningThinkingBlockLive = requireStreamingDependency(deps, 'markReasoningThinkingBlockLive');
        const readReasoningContentRaw = requireStreamingDependency(deps, 'readReasoningContentRaw');
        const buildReasoningAppendText = requireStreamingDependency(deps, 'buildReasoningAppendText');
        const updateThinkingBlockSummary = requireStreamingDependency(deps, 'updateThinkingBlockSummary');
        const finishReasoningThinkingBlock = requireStreamingDependency(deps, 'finishReasoningThinkingBlock');
        const renderCompletedStreamMath = requireStreamingDependency(deps, 'renderCompletedStreamMath');
        const pinMessagesToBottomFor = requireStreamingDependency(deps, 'pinMessagesToBottomFor');
        const scheduleLearningSidebarBridgeNotify = requireStreamingDependency(deps, 'scheduleLearningSidebarBridgeNotify');
        const getShouldAutoScroll = requireStreamingDependency(deps, 'getShouldAutoScroll');

        function renderStreamingContentSegment(messageDiv, body, rawText, source = 'stream-segment') {
            if (!messageDiv || !body) {
                return;
            }

            const planInfo = applyLongtermPlanFromText(rawText, { source, messageDiv });
            const bodyText = String(planInfo && planInfo.text !== undefined ? planInfo.text : rawText || '');

            body.dataset.streamLive = '1';
            body.dataset.streamRaw = bodyText;
            body.innerHTML = renderStreamingMarkdownWithNewTabLinks(bodyText, {
                streamingMathProvisional: true
            });
            bindSourceMarkdown(body, bodyText);
            highlightCode(body);
        }

        function updateMessageDivContent(index, fullText, preferredMessageDiv = null) {
            const messageDiv = resolveAssistantStreamMessageDiv(index, preferredMessageDiv);

            if (!messageDiv) {
                return;
            }

            const planInfo = applyLongtermPlanFromText(fullText, { source: 'stream', messageDiv });
            const displayText = String(planInfo && planInfo.text !== undefined ? planInfo.text : fullText || '');
            const resolved = resolveContentBodyForFullTextUpdate(messageDiv, displayText);
            const body = resolved.body;
            const bodyText = resolved.text;

            body.dataset.streamLive = '1';
            body.innerHTML = renderStreamingMarkdownWithNewTabLinks(bodyText, {
                streamingMathProvisional: true
            });
            bindSourceMarkdown(body, bodyText);
            highlightCode(body);

            if (getShouldAutoScroll()) {
                pinMessagesToBottomFor(700);
            }

            scheduleLearningSidebarBridgeNotify();
        }

        function updateMessageDivThinking(index, delta, preferredMessageDiv = null) {
            const messageDiv = resolveAssistantStreamMessageDiv(index, preferredMessageDiv);

            if (!messageDiv) {
                return;
            }

            const content = messageDiv.querySelector('.message-content') || messageDiv;
            const wasReasoningSegmentOpen = !!messageDiv.__reasoningSegmentOpen;
            const thinkingBlock = resolveReasoningThinkingBlockForAppend(messageDiv, content);

            if (!thinkingBlock) {
                return;
            }

            markReasoningThinkingBlockLive(thinkingBlock);

            const textTarget = thinkingBlock.querySelector('.thinking-content');
            const currentRaw = readReasoningContentRaw(textTarget);
            const appendText = buildReasoningAppendText(
                currentRaw,
                delta,
                !wasReasoningSegmentOpen
            );
            const raw = `${currentRaw}${appendText}`;

            textTarget.dataset.rawText = raw;
            textTarget.dataset.streamRaw = raw;
            textTarget.innerHTML = renderMarkdownWithNewTabLinks(raw, {
                breaks: true,
                streamingMathProvisional: true
            });
            bindSourceMarkdown(textTarget, raw);
            highlightCode(textTarget);
            updateThinkingBlockSummary(thinkingBlock, raw);

            if (getShouldAutoScroll()) {
                pinMessagesToBottomFor(700);
            }

            scheduleLearningSidebarBridgeNotify();
        }

        function finalizeMessageRenderForIndex(index, preferredMessageDiv = null) {
            const messageDiv = resolveAssistantStreamMessageDiv(index, preferredMessageDiv);

            if (!messageDiv) {
                return;
            }

            const bodies = Array.from(messageDiv.querySelectorAll('.content-body'));

            bodies.forEach((body) => {
                const isLive = String(body.dataset.streamLive || '') === '1';

                if (!isLive) {
                    return;
                }

                const sourceText = String(
                    (typeof body.__sourceMarkdown === 'string')
                        ? body.__sourceMarkdown
                        : (body.dataset.streamRaw || body.textContent || '')
                );

                body.dataset.streamLive = '0';
                body.innerHTML = renderMarkdownWithNewTabLinks(sourceText);
                bindSourceMarkdown(body, sourceText);
                renderCompletedStreamMath(body);
                highlightCode(body);
            });

            const thinkingBlocks = Array.from(messageDiv.querySelectorAll('.thinking-block.reasoning-thinking-block'));

            thinkingBlocks.forEach((block) => {
                const contentDiv = block.querySelector('.thinking-content');

                if (!contentDiv) {
                    return;
                }

                const isLive = String(contentDiv.dataset.streamLive || '') === '1'
                    || String(block.dataset.streamLive || '') === '1';

                if (!isLive) {
                    return;
                }

                const sourceText = String(
                    (typeof contentDiv.__sourceMarkdown === 'string')
                        ? contentDiv.__sourceMarkdown
                        : (contentDiv.dataset.rawText || contentDiv.dataset.streamRaw || contentDiv.textContent || '')
                );

                finishReasoningThinkingBlock(block, sourceText);
                contentDiv.innerHTML = renderMarkdownWithNewTabLinks(sourceText, { breaks: true });
                bindSourceMarkdown(contentDiv, sourceText);
                renderCompletedStreamMath(contentDiv);
                highlightCode(contentDiv);
            });

            if (getShouldAutoScroll()) {
                pinMessagesToBottomFor(900);
            }
        }

        return {
            renderStreamingContentSegment,
            updateMessageDivContent,
            updateMessageDivThinking,
            finalizeMessageRenderForIndex,
        };
    }

    function createStreamPrefillReplayController(deps = {}) {
        const stripHistoryTimeMarkerEchoForStream = requireStreamingDependency(deps, 'stripHistoryTimeMarkerEchoForStream');
        const createContentSpan = requireStreamingDependency(deps, 'createContentSpan');
        const renderStreamingMarkdownWithNewTabLinks = requireStreamingDependency(deps, 'renderStreamingMarkdownWithNewTabLinks');
        const renderMarkdownWithNewTabLinks = requireStreamingDependency(deps, 'renderMarkdownWithNewTabLinks');
        const bindSourceMarkdown = requireStreamingDependency(deps, 'bindSourceMarkdown');
        const highlightCode = requireStreamingDependency(deps, 'highlightCode');
        const resolveReasoningThinkingBlockForAppend = requireStreamingDependency(deps, 'resolveReasoningThinkingBlockForAppend');
        const markReasoningThinkingBlockLive = requireStreamingDependency(deps, 'markReasoningThinkingBlockLive');
        const readReasoningContentRaw = requireStreamingDependency(deps, 'readReasoningContentRaw');
        const buildReasoningAppendText = requireStreamingDependency(deps, 'buildReasoningAppendText');
        const updateThinkingBlockSummary = requireStreamingDependency(deps, 'updateThinkingBlockSummary');
        const updateMessageModelBadge = requireStreamingDependency(deps, 'updateMessageModelBadge');
        const getStreamingModelBadgeName = requireStreamingDependency(deps, 'getStreamingModelBadgeName');
        const safeTokenInt = requireStreamingDependency(deps, 'safeTokenInt');
        const getTokenMiniStreamOutput = requireStreamingDependency(deps, 'getTokenMiniStreamOutput');
        const getTokenMiniEstimatedStreamOutput = requireStreamingDependency(deps, 'getTokenMiniEstimatedStreamOutput');
        const updateMessageDivTools = requireStreamingDependency(deps, 'updateMessageDivTools');

        const renderChunkTypes = new Set([
            'content',
            'reasoning_content',
            'web_search',
            'search_meta',
            'context_compression_status',
            'function_call_delta',
            'function_call',
            'function_call_running',
            'function_result',
            'learning_card',
            'question',
            'puzzle',
            'model_info',
            'token_usage'
        ]);

        function getStreamPrefillChunkSeq(chunk) {
            const seq = Number(chunk && chunk._stream_seq);

            return Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
        }

        function renderStreamPrefillContentChunk(assistantDiv, prefillState, chunk) {
            let contentText = String(chunk && chunk.content || '');

            if (!contentText) {
                return false;
            }

            if (!prefillState.currentSegmentContent && !prefillState.seenVisibleContent) {
                const checked = stripHistoryTimeMarkerEchoForStream(`${String(prefillState.pendingHistoryTimeMarker || '')}${contentText}`);

                if (checked.pending) {
                    prefillState.pendingHistoryTimeMarker = `${String(prefillState.pendingHistoryTimeMarker || '')}${contentText}`;
                    return false;
                }

                prefillState.pendingHistoryTimeMarker = '';
                contentText = checked.text;

                if (checked.removed) {
                    console.warn('[StreamSanitize] stripped echoed history time marker from cached stream chunk');
                }

                if (!contentText) {
                    return false;
                }
            }

            assistantDiv.__reasoningSegmentOpen = false;

            if (assistantDiv.__contentAfterGeneratedImage) {
                prefillState.currentContentSpan = createContentSpan(assistantDiv, { afterGeneratedImage: true });
                prefillState.currentSegmentContent = '';
                assistantDiv.__contentAfterGeneratedImage = false;
            } else if (!prefillState.currentContentSpan || !prefillState.currentContentSpan.isConnected) {
                prefillState.currentContentSpan = createContentSpan(assistantDiv);
                prefillState.currentSegmentContent = '';
            }

            prefillState.currentSegmentContent += contentText;

            const contentSpan = prefillState.currentContentSpan;
            contentSpan.dataset.streamRaw = prefillState.currentSegmentContent;
            contentSpan.dataset.streamLive = '1';
            contentSpan.innerHTML = renderStreamingMarkdownWithNewTabLinks(prefillState.currentSegmentContent, {
                streamingMathProvisional: true
            });
            bindSourceMarkdown(contentSpan, prefillState.currentSegmentContent);
            highlightCode(contentSpan);
            prefillState.seenVisibleContent = true;

            return true;
        }

        function renderStreamPrefillReasoningChunk(assistantDiv, chunk) {
            const reasoningText = String(chunk && chunk.content || '');

            if (!reasoningText) {
                return false;
            }

            const msgContentContainer = assistantDiv.querySelector('.message-content') || assistantDiv;
            const wasReasoningSegmentOpen = !!assistantDiv.__reasoningSegmentOpen;
            const thinkingBlock = resolveReasoningThinkingBlockForAppend(assistantDiv, msgContentContainer);
            const thinkingContent = thinkingBlock.querySelector('.thinking-content');
            const currentRaw = readReasoningContentRaw(thinkingContent);
            const appendText = buildReasoningAppendText(
                currentRaw,
                reasoningText,
                !wasReasoningSegmentOpen
            );
            const nextRaw = `${currentRaw}${appendText}`;

            markReasoningThinkingBlockLive(thinkingBlock);
            thinkingContent.dataset.streamRaw = nextRaw;
            thinkingContent.innerHTML = renderMarkdownWithNewTabLinks(nextRaw, {
                breaks: true,
                streamingMathProvisional: true
            });
            bindSourceMarkdown(thinkingContent, nextRaw);
            highlightCode(thinkingContent);
            updateThinkingBlockSummary(thinkingBlock, nextRaw);

            return true;
        }

        function buildStreamingModelBadgeOutputTokens(chunkOutputTokens = 0) {
            return Math.max(
                safeTokenInt(chunkOutputTokens),
                safeTokenInt(getTokenMiniStreamOutput()),
                safeTokenInt(getTokenMiniEstimatedStreamOutput())
            );
        }

        function renderStreamPrefillProcessChunk(assistantDiv, assistantIndex, prefillState, chunk) {
            const chunkType = String(chunk && chunk.type || '').trim();

            if (!renderChunkTypes.has(chunkType)) {
                return false;
            }

            if (chunkType === 'content') {
                return renderStreamPrefillContentChunk(assistantDiv, prefillState, chunk);
            }

            if (chunkType === 'reasoning_content') {
                return renderStreamPrefillReasoningChunk(assistantDiv, chunk);
            }

            if (chunkType === 'model_info') {
                updateMessageModelBadge(assistantDiv, {
                    modelName: String(chunk.model_name || getStreamingModelBadgeName()),
                    searchFlag: (typeof chunk.search_enabled === 'boolean') ? chunk.search_enabled : 'unknown',
                    inputTokens: 0,
                    outputTokens: buildStreamingModelBadgeOutputTokens()
                });

                return false;
            }

            if (chunkType === 'token_usage') {
                updateMessageModelBadge(assistantDiv, {
                    modelName: getStreamingModelBadgeName(),
                    searchFlag: 'unknown',
                    inputTokens: safeTokenInt(chunk.input_tokens),
                    outputTokens: buildStreamingModelBadgeOutputTokens(chunk.output_tokens)
                });

                return false;
            }

            assistantDiv.__reasoningSegmentOpen = false;
            prefillState.currentContentSpan = null;
            prefillState.currentSegmentContent = '';
            updateMessageDivTools(assistantIndex, chunk, assistantDiv);

            return true;
        }

        function replayStreamPrefillChunks(assistantDiv, chunks, assistantIndex) {
            const rows = Array.isArray(chunks) ? chunks : [];
            const prefillState = {
                currentContentSpan: null,
                currentSegmentContent: '',
                pendingHistoryTimeMarker: '',
                seenVisibleContent: false
            };
            let rendered = false;
            let lastSeq = 0;
            let lastRenderedType = '';

            rows.forEach((chunk) => {
                if (!chunk || typeof chunk !== 'object') {
                    return;
                }

                const seq = getStreamPrefillChunkSeq(chunk);

                if (seq > 0) {
                    lastSeq = Math.max(lastSeq, seq);
                }

                if (renderStreamPrefillProcessChunk(assistantDiv, assistantIndex, prefillState, chunk)) {
                    rendered = true;
                    lastRenderedType = String(chunk.type || '').trim();
                }
            });

            return {
                rendered,
                lastSeq,
                endedWithContent: lastRenderedType === 'content'
            };
        }

        return {
            getStreamPrefillChunkSeq,
            renderStreamPrefillContentChunk,
            renderStreamPrefillReasoningChunk,
            renderStreamPrefillProcessChunk,
            replayStreamPrefillChunks,
        };
    }

    function createStreamSessionMonitorController(deps = {}) {
        const normalizeConversationStreamState = requireStreamingDependency(deps, 'normalizeConversationStreamState');
        const setConversationStreamState = requireStreamingDependency(deps, 'setConversationStreamState');
        const markConversationStreamFinished = requireStreamingDependency(deps, 'markConversationStreamFinished');
        const moveConversationStreamState = requireStreamingDependency(deps, 'moveConversationStreamState');
        const getConversationStreamState = requireStreamingDependency(deps, 'getConversationStreamState');
        const readStreamRegenerateFlag = requireStreamingDependency(deps, 'readStreamRegenerateFlag');
        const readStreamAssistantIndexFromMeta = requireStreamingDependency(deps, 'readStreamAssistantIndexFromMeta');
        const readStreamRegenerateIndexFromMeta = requireStreamingDependency(deps, 'readStreamRegenerateIndexFromMeta');
        const isTerminalStreamSessionChunk = requireStreamingDependency(deps, 'isTerminalStreamSessionChunk');
        const loadConversations = requireStreamingDependency(deps, 'loadConversations');
        const isCurrentConversation = requireStreamingDependency(deps, 'isCurrentConversation');
        const renderConversationSnapshotFromServer = requireStreamingDependency(deps, 'renderConversationSnapshotFromServer');
        const monitorStreamIds = new Set();

        function attachStreamSessionMonitor(state) {
            const normalized = normalizeConversationStreamState(state);

            if (!normalized || !normalized.stream_id) {
                return;
            }

            const streamId = String(normalized.stream_id || '').trim();

            if (!streamId || monitorStreamIds.has(streamId)) {
                return;
            }

            monitorStreamIds.add(streamId);
            void consumeStreamSessionMonitor(normalized).finally(() => {
                monitorStreamIds.delete(streamId);
            });
        }

        async function consumeStreamSessionMonitor(state) {
            const streamId = String(state.stream_id || '').trim();
            let monitorConversationId = String(state.conversation_id || '').trim();
            const fromSeq = Number.isFinite(Number(state.last_seq)) ? Number(state.last_seq) : 0;
            const controller = new AbortController();
            let monitorCompleted = false;

            if (monitorConversationId) {
                setConversationStreamState(monitorConversationId, {
                    controller,
                    monitoring: true,
                    status: 'running'
                });
            }

            try {
                const response = await fetch('/api/chat/stream/reconnect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        stream_id: streamId,
                        from_seq: fromSeq
                    }),
                    signal: controller.signal
                });

                if (!response.ok || !response.body) {
                    throw new Error(`stream monitor reconnect failed: HTTP ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { value, done } = await reader.read();

                    if (value) {
                        buffer += decoder.decode(value, { stream: !done });
                    }

                    if (done) {
                        buffer += decoder.decode();
                    }

                    const lines = buffer.split('\n');
                    buffer = done ? '' : (lines.pop() || '');

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) {
                            continue;
                        }

                        const payloadText = line.slice(6);

                        if (payloadText === '[DONE]') {
                            monitorCompleted = true;

                            if (monitorConversationId) {
                                markConversationStreamFinished(monitorConversationId);
                            }

                            continue;
                        }

                        let chunk = null;

                        try {
                            chunk = JSON.parse(payloadText);
                        } catch (parseError) {
                            console.error('[StreamMonitor] invalid SSE payload', parseError, payloadText);
                            continue;
                        }

                        if (!chunk || typeof chunk !== 'object') {
                            continue;
                        }

                        const incomingCid = String(chunk.conversation_id || '').trim();

                        if (incomingCid && incomingCid !== monitorConversationId) {
                            moveConversationStreamState(monitorConversationId, incomingCid);
                            monitorConversationId = incomingCid;
                        } else if (incomingCid) {
                            monitorConversationId = incomingCid;
                        }

                        if (Number.isFinite(Number(chunk._stream_seq)) && monitorConversationId) {
                            setConversationStreamState(monitorConversationId, {
                                last_seq: Number(chunk._stream_seq)
                            });
                        }

                        if (chunk.type === 'stream_cancel_requested') {
                            if (monitorConversationId) {
                                setConversationStreamState(monitorConversationId, {
                                    stopping: true,
                                    monitoring: true
                                });
                            }

                            continue;
                        }

                        if (chunk.type === 'stream_session') {
                            const sid = String(chunk.stream_id || streamId || '').trim();
                            const sessionCid = String(chunk.conversation_id || monitorConversationId || '').trim();

                            if (sessionCid && sessionCid !== monitorConversationId) {
                                moveConversationStreamState(monitorConversationId, sessionCid);
                                monitorConversationId = sessionCid;
                            } else if (sessionCid) {
                                monitorConversationId = sessionCid;
                            }

                            if (monitorConversationId) {
                                const previousState = getConversationStreamState(monitorConversationId) || {};
                                const sameStream = String(previousState.stream_id || '').trim() === sid;
                                const sessionIsRegenerate = readStreamRegenerateFlag(chunk, sameStream ? !!previousState.is_regenerate : false);
                                const sessionAssistantIndex = readStreamAssistantIndexFromMeta(
                                    chunk,
                                    sameStream ? previousState.assistant_index : null
                                );
                                const sessionRegenerateIndex = sessionIsRegenerate
                                    ? readStreamRegenerateIndexFromMeta(chunk, sameStream ? previousState.regenerate_index : sessionAssistantIndex)
                                    : null;

                                setConversationStreamState(monitorConversationId, {
                                    stream_id: sid,
                                    status: 'running',
                                    is_regenerate: sessionIsRegenerate,
                                    assistant_index: sessionAssistantIndex,
                                    regenerate_index: sessionRegenerateIndex,
                                    controller,
                                    monitoring: true,
                                    stopping: !!chunk.cancel_requested
                                });
                            }

                            if (isTerminalStreamSessionChunk(chunk)) {
                                monitorCompleted = true;

                                if (monitorConversationId) {
                                    markConversationStreamFinished(monitorConversationId, {
                                        error: String(chunk.error || '').trim()
                                    });
                                }
                            }
                        }
                    }

                    if (done) {
                        break;
                    }
                }
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }

                console.error('[StreamMonitor] SSE monitor failed', {
                    stream_id: streamId,
                    conversation_id: monitorConversationId,
                    error: String((error && error.message) || error || '')
                });

                if (monitorConversationId) {
                    setConversationStreamState(monitorConversationId, {
                        controller: null,
                        monitoring: false,
                        error: String((error && error.message) || error || 'stream monitor failed')
                    });
                }
            } finally {
                if (monitorConversationId) {
                    const latest = getConversationStreamState(monitorConversationId);

                    if (latest && latest.controller === controller) {
                        setConversationStreamState(monitorConversationId, {
                            controller: null,
                            monitoring: false
                        });
                    }
                }

                loadConversations();

                if (monitorCompleted && monitorConversationId && isCurrentConversation(monitorConversationId)) {
                    await renderConversationSnapshotFromServer(monitorConversationId, {
                        instant: true,
                        silent: true
                    });
                }
            }
        }

        return {
            attachStreamSessionMonitor,
            consumeStreamSessionMonitor,
        };
    }

    function createStreamStatusSyncController(deps = {}) {
        const getConversationStreamIdsForStatusSync = requireStreamingDependency(deps, 'getConversationStreamIdsForStatusSync');
        const forEachConversationStreamState = requireStreamingDependency(deps, 'forEachConversationStreamState');
        const setConversationStreamState = requireStreamingDependency(deps, 'setConversationStreamState');
        const markConversationStreamFinished = requireStreamingDependency(deps, 'markConversationStreamFinished');
        const isCurrentConversation = requireStreamingDependency(deps, 'isCurrentConversation');
        const moveConversationStreamState = requireStreamingDependency(deps, 'moveConversationStreamState');
        const applyStreamSessionMetaRows = requireStreamingDependency(deps, 'applyStreamSessionMetaRows');
        const renderConversationSnapshotFromServer = requireStreamingDependency(deps, 'renderConversationSnapshotFromServer');
        const getStoredRunningStreamStates = requireStreamingDependency(deps, 'getStoredRunningStreamStates');
        const attachStreamSessionMonitor = requireStreamingDependency(deps, 'attachStreamSessionMonitor');
        const getCurrentConversationId = requireStreamingDependency(deps, 'getCurrentConversationId');
        const statusSyncIntervalMs = Number(deps.statusSyncIntervalMs);

        if (!Number.isFinite(statusSyncIntervalMs) || statusSyncIntervalMs <= 0) {
            throw new Error('chat_streaming 缺少有效依赖: statusSyncIntervalMs');
        }

        let backgroundStreamStatusSyncInFlight = false;
        let streamStatusSyncTimer = null;

        async function syncStoredConversationStreamStatus(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const streamIds = getConversationStreamIdsForStatusSync();
            const conversationIds = Array.isArray(opts.conversationIds)
                ? opts.conversationIds.map((item) => String(item || '').trim()).filter(Boolean)
                : [];

            if (!streamIds.length && !conversationIds.length) {
                return;
            }

            if (backgroundStreamStatusSyncInFlight && !opts.force) {
                return;
            }

            backgroundStreamStatusSyncInFlight = true;
            const finishedVisibleConversationIds = [];

            try {
                const res = await fetch('/api/chat/stream/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        stream_ids: streamIds,
                        conversation_ids: conversationIds
                    })
                });
                const data = await res.json();

                if (!res.ok || !data || data.success === false) {
                    return;
                }

                const rows = Array.isArray(data.sessions) ? data.sessions : [];
                const metaById = new Map(rows.map((row) => [String(row && row.stream_id || '').trim(), row]));
                const metaByCid = new Map(rows.filter((row) => row && row.conversation_id).map((row) => [String(row.conversation_id || '').trim(), row]));

                forEachConversationStreamState((state, cid) => {
                    if (!state || String(state.status || '') !== 'running') {
                        return;
                    }

                    if (state.controller) {
                        return;
                    }

                    const sid = String(state.stream_id || '').trim();
                    let meta = sid ? metaById.get(sid) : null;

                    if (!meta && !sid) {
                        // 本地无 stream_id 时，通过 conversation_id 从服务端状态中找回 stream_id。
                        const discovered = metaByCid.get(cid) || null;

                        const discoveredStatus = String(discovered && discovered.status || '').trim().toLowerCase();

                        if (discovered && (discoveredStatus === 'running' || discoveredStatus === 'cancelling')) {
                            const discoveredSid = String(discovered.stream_id || '').trim();

                            if (discoveredSid) {
                                setConversationStreamState(cid, { stream_id: discoveredSid });
                                meta = discovered;
                            }
                        }
                    }

                    if (!meta) {
                        markConversationStreamFinished(cid, { error: 'stream session not found' });
                        return;
                    }

                    const status = String(meta.status || '').trim().toLowerCase();

                    if (status !== 'running' && status !== 'cancelling') {
                        markConversationStreamFinished(cid, { error: String(meta.error || '') });

                        if (isCurrentConversation(cid)) {
                            finishedVisibleConversationIds.push(cid);
                        }

                        return;
                    }

                    const metaCid = String(meta.conversation_id || cid).trim() || cid;

                    if (metaCid !== cid) {
                        moveConversationStreamState(cid, metaCid);
                    }

                    setConversationStreamState(metaCid, {
                        conversation_id: metaCid,
                        status: 'running',
                        stopping: status === 'cancelling' || !!meta.cancel_requested
                    });
                });
                applyStreamSessionMetaRows(rows);

                for (const cid of finishedVisibleConversationIds) {
                    await renderConversationSnapshotFromServer(cid, {
                        instant: true,
                        silent: true
                    });
                }
            } catch (error) {
                console.error('[StreamStatusSync] status sync failed', {
                    error: String((error && error.message) || error || '')
                });
            } finally {
                backgroundStreamStatusSyncInFlight = false;
            }
        }

        function startStoredStreamSessionMonitors(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const skipConversationId = String(opts.skipConversationId || '').trim();

            getStoredRunningStreamStates().forEach((state) => {
                const cid = String(state.conversation_id || '').trim();

                if (skipConversationId && cid === skipConversationId) {
                    return;
                }

                if (state.controller) {
                    return;
                }

                attachStreamSessionMonitor(state);
            });
        }

        async function tickConversationStreamStatusSync() {
            const runningStates = getStoredRunningStreamStates();

            if (!runningStates.length) {
                return;
            }

            startStoredStreamSessionMonitors({
                skipConversationId: String(getCurrentConversationId() || '').trim()
            });
            await syncStoredConversationStreamStatus();
        }

        function startConversationStreamStatusSync() {
            if (streamStatusSyncTimer) {
                return;
            }

            streamStatusSyncTimer = setInterval(() => {
                void tickConversationStreamStatusSync();
            }, statusSyncIntervalMs);
        }

        function stopConversationStreamStatusSync() {
            if (!streamStatusSyncTimer) {
                return;
            }

            clearInterval(streamStatusSyncTimer);
            streamStatusSyncTimer = null;
        }

        return {
            syncStoredConversationStreamStatus,
            startStoredStreamSessionMonitors,
            tickConversationStreamStatusSync,
            startConversationStreamStatusSync,
            stopConversationStreamStatusSync,
        };
    }

    function createStreamStateController(deps = {}) {
        const storage = requireStreamingObjectDependency(deps, 'localStorage', (value) => {
            return value && typeof value.getItem === 'function' && typeof value.setItem === 'function';
        });
        const getCurrentConversationId = requireStreamingDependency(deps, 'getCurrentConversationId');
        const onSyncGenerationState = requireStreamingDependency(deps, 'onSyncGenerationState');
        const onInvalidateConversationList = requireStreamingDependency(deps, 'onInvalidateConversationList');
        const clearStreamAttachRetry = requireStreamingDependency(deps, 'clearStreamAttachRetry');

        const activeStateKey = 'nexora_stream_resume_v1';
        const stateMapKey = 'nexora_stream_resume_map_v1';
        let conversationStreamStates = new Map();

        function normalizeStreamMessageIndex(value) {
            const n = Number(value);

            if (!Number.isFinite(n) || n < 0) {
                return null;
            }

            return Math.floor(n);
        }

        function readStreamRegenerateFlag(source, defaultValue = false) {
            const src = (source && typeof source === 'object') ? source : {};

            if (Object.prototype.hasOwnProperty.call(src, 'is_regenerate')) {
                return !!src.is_regenerate;
            }

            if (Object.prototype.hasOwnProperty.call(src, 'isRegenerate')) {
                return !!src.isRegenerate;
            }

            return !!defaultValue;
        }

        function readStreamAssistantIndexFromMeta(source, defaultIndex = null) {
            const src = (source && typeof source === 'object') ? source : {};

            return normalizeStreamMessageIndex(src.assistant_index)
                ?? normalizeStreamMessageIndex(src.assistantIndex)
                ?? normalizeStreamMessageIndex(defaultIndex);
        }

        function readStreamRegenerateIndexFromMeta(source, defaultIndex = null) {
            const src = (source && typeof source === 'object') ? source : {};

            return normalizeStreamMessageIndex(src.regenerate_index)
                ?? normalizeStreamMessageIndex(src.regenerateIndex)
                ?? normalizeStreamMessageIndex(defaultIndex);
        }

        function stripHistoryTimeMarkerEchoForStream(text) {
            const value = String(text || '');

            if (!value) {
                return { text: '', removed: false, pending: false };
            }

            const timeMatch = value.match(/^\[TIME\]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*(?:\r?\n)?/);

            if (timeMatch) {
                return { text: value.slice(timeMatch[0].length), removed: true, pending: false };
            }

            const oldMatch = value.match(/^\[\{TIME:\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\}?\]?\s*(?:\r?\n)?/);

            if (oldMatch) {
                return { text: value.slice(oldMatch[0].length), removed: true, pending: false };
            }

            const newMatch = value.match(/^\[历史消息时间:\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]\s*(?:\([^)\n]*不要在回答中复述[^)\n]*\)\s*)?(?:\r?\n)?/);

            if (newMatch) {
                return { text: value.slice(newMatch[0].length), removed: true, pending: false };
            }

            const waitPrefixes = ['[TIME]', '[{TIME:', '[历史消息时间:'];

            if (waitPrefixes.some((prefix) => prefix.startsWith(value))) {
                return { text: '', removed: false, pending: true };
            }

            if (value.startsWith('[{TIME:') && !value.includes('\n') && value.length < 64) {
                return { text: '', removed: false, pending: true };
            }

            if (value.startsWith('[TIME]') && !value.includes('\n') && value.length < 64) {
                return { text: '', removed: false, pending: true };
            }

            if (value.startsWith('[历史消息时间:') && !value.includes('\n') && value.length < 96) {
                return { text: '', removed: false, pending: true };
            }

            return { text: value, removed: false, pending: false };
        }

        function normalizeConversationStreamState(raw) {
            const src = (raw && typeof raw === 'object') ? raw : {};
            const conversationId = String(src.conversation_id || src.conversationId || '').trim();
            const streamId = String(src.stream_id || src.streamId || '').trim();
            const status = String(src.status || (streamId ? 'running' : '')).trim().toLowerCase();

            if (!conversationId) {
                return null;
            }

            const assistantIndex = normalizeStreamMessageIndex(src.assistant_index);
            const isRegenerate = readStreamRegenerateFlag(src, false);
            const regenerateIndex = isRegenerate
                ? (normalizeStreamMessageIndex(src.regenerate_index) ?? assistantIndex)
                : null;

            return {
                conversation_id: conversationId,
                stream_id: streamId,
                status: status === 'done' ? 'done' : 'running',
                unread: !!src.unread,
                assistant_index: assistantIndex,
                is_regenerate: isRegenerate,
                regenerate_index: regenerateIndex,
                started_at: Number.isFinite(Number(src.started_at)) ? Number(src.started_at) : Date.now(),
                updated_at: Number.isFinite(Number(src.updated_at)) ? Number(src.updated_at) : Date.now(),
                last_seq: Number.isFinite(Number(src.last_seq)) ? Number(src.last_seq) : 0,
                error: String(src.error || '').trim(),
                controller: src.controller || null,
                monitoring: !!src.monitoring,
                stopping: !!src.stopping
            };
        }

        function serializeConversationStreamState(state) {
            const normalized = normalizeConversationStreamState(state);

            if (!normalized) {
                return null;
            }

            return {
                conversation_id: normalized.conversation_id,
                stream_id: normalized.stream_id,
                status: normalized.status,
                unread: !!normalized.unread,
                assistant_index: normalized.assistant_index,
                is_regenerate: !!normalized.is_regenerate,
                regenerate_index: normalized.regenerate_index,
                started_at: normalized.started_at,
                updated_at: normalized.updated_at,
                last_seq: normalized.last_seq,
                error: normalized.error,
                stopping: !!normalized.stopping
            };
        }

        function persistConversationStreamStates() {
            try {
                const payload = {};

                conversationStreamStates.forEach((state, cid) => {
                    const serialized = serializeConversationStreamState(state);

                    if (serialized) {
                        payload[cid] = serialized;
                    }
                });

                storage.setItem(stateMapKey, JSON.stringify(payload));
            } catch (_) {
                // ignore localStorage quota / privacy mode errors
            }
        }

        function hydrateConversationStreamStatesFromStorage() {
            conversationStreamStates = new Map();

            try {
                const raw = storage.getItem(stateMapKey);
                const parsed = raw ? JSON.parse(raw) : {};
                const rows = Array.isArray(parsed)
                    ? parsed
                    : Object.keys(parsed || {}).map((key) => ({
                        ...(parsed[key] || {}),
                        conversation_id: parsed[key] && parsed[key].conversation_id ? parsed[key].conversation_id : key
                    }));

                rows.forEach((row) => {
                    const normalized = normalizeConversationStreamState(row);

                    if (!normalized) {
                        return;
                    }

                    if (normalized.status === 'running' && !normalized.stream_id) {
                        return;
                    }

                    conversationStreamStates.set(normalized.conversation_id, normalized);
                });
            } catch (_) {
                conversationStreamStates = new Map();
            }
        }

        function loadActiveStreamResumeState() {
            try {
                const raw = storage.getItem(activeStateKey);

                if (!raw) {
                    return null;
                }

                const parsed = JSON.parse(raw);

                if (!parsed || typeof parsed !== 'object') {
                    return null;
                }

                const streamId = String(parsed.stream_id || '').trim();

                if (!streamId) {
                    return null;
                }

                const assistantIndex = normalizeStreamMessageIndex(parsed.assistant_index);
                const isRegenerate = readStreamRegenerateFlag(parsed, false);
                const regenerateIndex = isRegenerate
                    ? (normalizeStreamMessageIndex(parsed.regenerate_index) ?? assistantIndex)
                    : null;

                return {
                    stream_id: streamId,
                    conversation_id: String(parsed.conversation_id || '').trim(),
                    assistant_index: assistantIndex,
                    is_regenerate: isRegenerate,
                    regenerate_index: regenerateIndex,
                    started_at: Number.isFinite(Number(parsed.started_at)) ? Number(parsed.started_at) : Date.now(),
                    updated_at: Number.isFinite(Number(parsed.updated_at)) ? Number(parsed.updated_at) : Date.now(),
                    last_seq: Number.isFinite(Number(parsed.last_seq)) ? Number(parsed.last_seq) : 0
                };
            } catch (_) {
                return null;
            }
        }

        function getConversationStreamState(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return null;
            }

            return conversationStreamStates.get(cid) || null;
        }

        function buildConversationStreamListStateSignature(state) {
            const normalized = normalizeConversationStreamState(state);

            if (!normalized) {
                return '';
            }

            return [
                normalized.status,
                normalized.unread ? '1' : '0',
                normalized.stream_id ? '1' : '0',
                normalized.error ? '1' : '0'
            ].join('|');
        }

        function setConversationStreamState(conversationId, patch = {}) {
            const cid = String(conversationId || (patch && patch.conversation_id) || '').trim();

            if (!cid) {
                return null;
            }

            const existing = getConversationStreamState(cid);
            const prev = existing || { conversation_id: cid };
            const prevListSignature = existing ? buildConversationStreamListStateSignature(existing) : '';
            const merged = normalizeConversationStreamState({
                ...prev,
                ...(patch || {}),
                conversation_id: cid,
                updated_at: Date.now()
            });

            if (!merged) {
                return null;
            }

            if (prev && prev.controller && !(patch && Object.prototype.hasOwnProperty.call(patch, 'controller'))) {
                merged.controller = prev.controller;
            }

            conversationStreamStates.set(cid, merged);
            persistConversationStreamStates();
            onSyncGenerationState({ render: false });

            if (buildConversationStreamListStateSignature(merged) !== prevListSignature) {
                onInvalidateConversationList();
            }

            return merged;
        }

        function saveActiveStreamResumeState(nextState) {
            const incoming = (nextState && typeof nextState === 'object') ? nextState : {};
            const streamId = String(incoming.stream_id || '').trim();

            if (!streamId) {
                return;
            }

            const now = Date.now();
            const previous = loadActiveStreamResumeState() || {};
            const assistantIndex = normalizeStreamMessageIndex(incoming.assistant_index) ?? normalizeStreamMessageIndex(previous.assistant_index);
            const isRegenerate = readStreamRegenerateFlag(incoming, !!previous.is_regenerate);
            const regenerateIndex = isRegenerate
                ? (normalizeStreamMessageIndex(incoming.regenerate_index) ?? normalizeStreamMessageIndex(previous.regenerate_index) ?? assistantIndex)
                : null;
            const payload = {
                stream_id: streamId,
                conversation_id: String(incoming.conversation_id || getCurrentConversationId() || '').trim(),
                assistant_index: assistantIndex,
                is_regenerate: isRegenerate,
                regenerate_index: regenerateIndex,
                started_at: Number.isFinite(Number(incoming.started_at)) ? Number(incoming.started_at) : now,
                updated_at: now,
                last_seq: Number.isFinite(Number(incoming.last_seq)) ? Number(incoming.last_seq) : 0
            };

            try {
                storage.setItem(activeStateKey, JSON.stringify(payload));
            } catch (_) {
                // ignore localStorage quota / privacy mode errors
            }

            if (payload.conversation_id) {
                setConversationStreamState(payload.conversation_id, {
                    ...payload,
                    status: 'running',
                    unread: false,
                    stopping: false
                });
            }
        }

        function patchActiveStreamResumeState(patch) {
            const extra = (patch && typeof patch === 'object') ? patch : {};
            const prev = loadActiveStreamResumeState() || {};
            const merged = { ...prev, ...extra };
            saveActiveStreamResumeState(merged);
        }

        function clearActiveStreamResumeState() {
            try {
                storage.removeItem(activeStateKey);
            } catch (_) {
                // ignore
            }
        }

        function removeConversationStreamState(conversationId) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            clearStreamAttachRetry(cid);
            conversationStreamStates.delete(cid);
            persistConversationStreamStates();
            onSyncGenerationState({ render: false });
            onInvalidateConversationList();
        }

        function moveConversationStreamState(fromConversationId, toConversationId) {
            const fromCid = String(fromConversationId || '').trim();
            const toCid = String(toConversationId || '').trim();

            if (!toCid) {
                return null;
            }

            if (!fromCid || fromCid === toCid) {
                return setConversationStreamState(toCid, { conversation_id: toCid });
            }

            const fromState = getConversationStreamState(fromCid);

            if (!fromState) {
                return setConversationStreamState(toCid, { conversation_id: toCid });
            }

            const toState = getConversationStreamState(toCid) || {};
            const merged = normalizeConversationStreamState({
                ...fromState,
                ...toState,
                conversation_id: toCid,
                stream_id: toState.stream_id || fromState.stream_id,
                status: toState.status || fromState.status,
                unread: !!(toState.unread || fromState.unread),
                controller: fromState.controller || toState.controller || null,
                monitoring: !!(fromState.monitoring || toState.monitoring),
                updated_at: Date.now()
            });

            if (!merged) {
                return null;
            }

            conversationStreamStates.delete(fromCid);
            conversationStreamStates.set(toCid, merged);
            persistConversationStreamStates();
            onSyncGenerationState({ render: false });
            onInvalidateConversationList();
            return merged;
        }

        function markConversationStreamFinished(conversationId, options = {}) {
            const cid = String(conversationId || '').trim();

            if (!cid) {
                return;
            }

            clearStreamAttachRetry(cid);
            const opts = (options && typeof options === 'object') ? options : {};
            const activeCid = String(getCurrentConversationId() || '').trim();

            if (cid && activeCid === cid && !opts.forceUnread) {
                removeConversationStreamState(cid);
                return;
            }

            setConversationStreamState(cid, {
                status: 'done',
                unread: true,
                controller: null,
                monitoring: false,
                stopping: false,
                error: String(opts.error || '').trim()
            });
        }

        function isTerminalStreamSessionChunk(chunk) {
            if (!chunk || typeof chunk !== 'object') {
                return false;
            }

            if (String(chunk.type || '').trim() !== 'stream_session') {
                return false;
            }

            const status = String(chunk.status || '').trim().toLowerCase();
            return status === 'done' || chunk.done === true;
        }

        function markConversationStreamRead(conversationId) {
            const state = getConversationStreamState(conversationId);

            if (!state) {
                return;
            }

            if (String(state.status || '') === 'done') {
                removeConversationStreamState(conversationId);
            } else {
                setConversationStreamState(conversationId, { unread: false });
            }
        }

        function isConversationStreamRunning(conversationId) {
            const state = getConversationStreamState(conversationId);
            return !!(state && String(state.status || '') === 'running');
        }

        function getConversationStreamIdsForStatusSync() {
            const ids = [];

            conversationStreamStates.forEach((state) => {
                const sid = String(state && state.stream_id || '').trim();

                if (sid) {
                    ids.push(sid);
                }
            });

            return ids;
        }

        function applyStreamSessionMetaRows(rows, sourceConversationId = '') {
            const sessions = Array.isArray(rows) ? rows : [];

            sessions.forEach((meta) => {
                if (!meta || typeof meta !== 'object') {
                    return;
                }

                const cid = String(meta.conversation_id || sourceConversationId || '').trim();
                const sid = String(meta.stream_id || '').trim();
                const status = String(meta.status || '').trim().toLowerCase();

                if (!cid || !sid) {
                    return;
                }

                const existing = getConversationStreamState(cid) || {};
                const sameStream = String(existing.stream_id || '').trim() === sid;

                if (status === 'running' || status === 'cancelling') {
                    const metaIsRegenerate = readStreamRegenerateFlag(meta, sameStream ? !!existing.is_regenerate : false);
                    const metaAssistantIndex = readStreamAssistantIndexFromMeta(
                        meta,
                        sameStream ? existing.assistant_index : null
                    );
                    const metaRegenerateIndex = metaIsRegenerate
                        ? readStreamRegenerateIndexFromMeta(meta, sameStream ? existing.regenerate_index : metaAssistantIndex)
                        : null;

                    setConversationStreamState(cid, {
                        conversation_id: cid,
                        stream_id: sid,
                        status: 'running',
                        unread: !!existing.unread,
                        is_regenerate: metaIsRegenerate,
                        assistant_index: metaAssistantIndex,
                        regenerate_index: metaRegenerateIndex,
                        last_seq: Number.isFinite(Number(meta.last_seq)) ? Number(meta.last_seq) : Number(existing.last_seq || 0),
                        stopping: status === 'cancelling' || !!meta.cancel_requested || !!existing.stopping,
                        error: String(meta.error || existing.error || '').trim()
                    });
                    return;
                }

                if (sameStream) {
                    markConversationStreamFinished(cid, {
                        error: String(meta.error || '').trim()
                    });
                }
            });
        }

        function getStoredRunningStreamStates() {
            const rows = [];

            conversationStreamStates.forEach((state) => {
                const normalized = normalizeConversationStreamState(state);

                if (!normalized) {
                    return;
                }

                if (String(normalized.status || '') !== 'running') {
                    return;
                }

                rows.push(normalized);
            });

            return rows;
        }

        function forEachConversationStreamState(callback) {
            if (typeof callback !== 'function') {
                return;
            }

            conversationStreamStates.forEach((state, cid) => {
                callback(state, cid);
            });
        }

        return {
            loadActiveStreamResumeState,
            saveActiveStreamResumeState,
            patchActiveStreamResumeState,
            clearActiveStreamResumeState,
            normalizeStreamMessageIndex,
            readStreamRegenerateFlag,
            readStreamAssistantIndexFromMeta,
            readStreamRegenerateIndexFromMeta,
            stripHistoryTimeMarkerEchoForStream,
            normalizeConversationStreamState,
            serializeConversationStreamState,
            hydrateConversationStreamStatesFromStorage,
            persistConversationStreamStates,
            getConversationStreamState,
            buildConversationStreamListStateSignature,
            isConversationStreamRunning,
            setConversationStreamState,
            removeConversationStreamState,
            moveConversationStreamState,
            markConversationStreamFinished,
            isTerminalStreamSessionChunk,
            markConversationStreamRead,
            getConversationStreamIdsForStatusSync,
            applyStreamSessionMetaRows,
            getStoredRunningStreamStates,
            forEachConversationStreamState,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        hasLikelyMathDelimiter,
        hasLikelyMathForThinkingStream,
        hasLikelyUnbalancedMarkdownInline,
        streamMathIsEscapedAt,
        countEscapedMathDelimiter,
        countLatexEnvironmentBoundary,
        hasOpenMathDelimiters,
        streamMathFindOpenTailInfo,
        streamMathFindOpenTailStart,
        streamMathBuildProvisionalClosedTail,
        isStreamRenderDebugEnabled,
        setupStreamRenderDebugGlobals,
        toStreamRenderDebugSnippet,
        pushStreamRenderDebug,
        createStreamRenderController,
        renderCompletedStreamMath,
        createStreamMessageDomController,
        createStreamPrefillReplayController,
        createStreamSessionMonitorController,
        createStreamStatusSyncController,
        createStreamStateController,
    });
})();
