// Global State
let currentConversationId = null;
let currentAbortController = null;
let isGenerating = false;
let shouldAutoScroll = true; // Auto-scroll control
let uploadedFileIds = []; // Uploaded files {id, name}
let isUploadingFiles = false;
let currentUploadXhr = null;
let currentUploadTaskId = null;
let uploadCancelledByUser = false;
let currentUsername = null;
let currentUserRole = 'member';
let currentUserAvatarUrl = '';
let pendingAvatarDataUrl = '';
let adminUsersCache = [];
let adminSelectedUserId = null;
let adminUserFilterKeyword = '';
let adminMailUsersCache = [];
let adminSelectedMailUser = null;
let adminMailUserFilterKeyword = '';
let adminMailGroup = 'default';
let mailViewState = {
    status: null,
    mails: [],
    selectedId: '',
    query: '',
    sidebarCollapsed: false,
    restorePositionOnce: false,
    mode: 'inbox',
    currentMail: null,
    folder: 'all',
    isSending: false,
    inboxTotal: 0,
    unreadTotal: 0,
    sentTotal: 0,
    inboxRequestId: 0,
    detailRequestId: 0
};
const MAIL_SIDEBAR_COLLAPSED_KEY = 'nexora_mail_sidebar_collapsed';
const MAIL_SELECTED_ID_KEY = 'nexora_mail_selected_id';
const MAIL_LIST_SCROLL_KEY = 'nexora_mail_list_scroll';
const MAIL_LAST_OPEN_TS_KEY = 'nexora_mail_last_open_ts';
const MAIL_POLL_INTERVAL_MS = 5000;
let mailPollTimer = null;
let mailPollInFlight = false;
let mailNotifyState = {
    lastOpenTs: 0,
    newCount: 0,
    initialized: false
};
let tokenMiniState = {
    conversationId: null,
    baseInput: 0,
    baseOutput: 0,
    streamInput: 0,
    streamOutput: 0,
    estimatedStreamOutput: 0,
    usageSnapshotInput: 0,
    usageSnapshotOutput: 0,
    usageSnapshotInitialized: false,
    requestSeq: 0,
    streaming: false
};
const TOKEN_BUDGET_DEFAULT_LIMIT = 32768;
let tokenBudgetState = {
    contextWindow: TOKEN_BUDGET_DEFAULT_LIMIT,
    estimated: true,
    roundInput: 0
};
let clientToolPollTimer = null;
let clientToolPollInFlight = false;
const clientToolHandledRequestIds = new Set();
const clientJsCanvasRequestMap = new Map();
const CLIENT_TOOL_POLL_MIN_MS = 700;
const CLIENT_TOOL_POLL_MAX_MS = 6000;
const CLIENT_TOOL_POLL_NO_CONV_MS = 5000;
const CLIENT_TOOL_POLL_ERROR_MS = 3500;
const CLIENT_TOOL_POLL_HIT_MS = 220;
const CLIENT_TOOL_PULL_WAIT_MS = 12000;
let clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;
let modelOptionsDockState = null;
let modelSelectListenersBound = false;
let isBatchRenderingMessages = false;
let hoverProxyMessageEl = null;
let isMessageInputComposing = false;
let selectedModelId = null;
let modelCatalog = [];
let currentConversationHasImageHistory = false;
const modelMetaById = new Map();
const providerVisionModelSetCache = new Map();
const providerVisionPendingFetch = new Map();
const imageViewerState = {
    active: false,
    scale: 1,
    minScale: 0.2,
    maxScale: 6,
    tx: 0,
    ty: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0
};
let fileDragDepth = 0;
let isFileDropOverlayVisible = false;
const NOTES_DEFAULT_NOTEBOOK_ID = 'nb_default';
const NOTES_LEGACY_STORE_KEY = 'nexora_notes_store_v2';
const NOTES_LEGACY_PREFIX = 'nexora_notes_conv_';
const NOTES_MOBILE_PANEL_POS_KEY = 'nexora_notes_mobile_panel_pos_v1';
const NOTES_PANEL_LAYOUT_KEY = 'nexora_notes_panel_layout_v2';
const NOTES_CLOUD_SYNC_DEBOUNCE_MS = 240;
let notesState = {
    open: false,
    notebooks: [],
    activeNotebookId: NOTES_DEFAULT_NOTEBOOK_ID,
    items: [],
    pendingSelectionText: '',
    pendingSelectionSource: null
};
let notesMobilePanelState = {
    bound: false,
    dragging: false,
    resizing: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
    startWidth: 0,
    startHeight: 0,
    left: null,
    top: null,
    width: null,
    height: null
};
let notesCloudSyncTimer = null;
let notesCloudSyncPendingStore = null;
let notesCloudSyncInFlight = false;
const NOTES_COMPANION_MODE = (() => {
    try {
        const p = new URLSearchParams(window.location.search || '');
        const raw = String(p.get('notes_companion') || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'yes';
    } catch (_) {
        return false;
    }
})();
const SETTINGS_COMPANION_MODE = (() => {
    try {
        const p = new URLSearchParams(window.location.search || '');
        const raw = String(p.get('settings_companion') || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'yes';
    } catch (_) {
        return false;
    }
})();
let pinContextMenuState = null;
let pinContextMenuBusy = false;
let conversationListCache = [];
let basisKnowledgeListCache = [];

function setHoverProxyMessage(target) {
    if (hoverProxyMessageEl === target) return;
    if (hoverProxyMessageEl && hoverProxyMessageEl.classList) {
        hoverProxyMessageEl.classList.remove('message-hover-proxy');
    }
    hoverProxyMessageEl = target || null;
    if (hoverProxyMessageEl && hoverProxyMessageEl.classList) {
        hoverProxyMessageEl.classList.add('message-hover-proxy');
    }
}

function clearHoverProxyMessage() {
    setHoverProxyMessage(null);
    if (els.messagesContainer) {
        els.messagesContainer.classList.remove('has-proxy-hover');
    }
}

function updateHoverProxyFromClientY(clientY) {
    const container = els.messagesContainer;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll('.message'));
    if (!rows.length) {
        clearHoverProxyMessage();
        return;
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        let dist = 0;
        if (clientY < rect.top) dist = rect.top - clientY;
        else if (clientY > rect.bottom) dist = clientY - rect.bottom;
        else dist = 0; // inside row

        if (dist < bestDistance) {
            bestDistance = dist;
            best = row;
            if (dist === 0) break;
        }
    }

    if (best) {
        container.classList.add('has-proxy-hover');
        setHoverProxyMessage(best);
    } else {
        clearHoverProxyMessage();
    }
}

function enforceLinksOpenInNewTab(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('a[href]').forEach((a) => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
    });
}

function rewriteHtmlFragmentLinksToNewTab(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    enforceLinksOpenInNewTab(div);
    return div.innerHTML;
}

function rewriteHtmlDocumentLinksToNewTab(html) {
    const src = String(html || '');
    if (!src.trim()) return '';
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(src, 'text/html');
        enforceLinksOpenInNewTab(doc);
        const isFullDoc = /<html[\s>]/i.test(src) || /<!doctype/i.test(src);
        if (isFullDoc) {
            return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
        }
        return doc.body ? doc.body.innerHTML : src;
    } catch (e) {
        return src;
    }
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

function looksLikeMathText(s) {
    const src = String(s || '').trim();
    if (!src) return false;
    return /[=+\-*/^_{}\\]|\\[a-zA-Z]+|[A-Za-z]\s*\(|\d+\s*[A-Za-z]/.test(src);
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

        // 仍不平衡时，删除最后一个孤立 `$`，尽量保留前面已成对片段。
        const lastPos = positions[positions.length - 1];
        return raw.slice(0, lastPos) + raw.slice(lastPos + 1);
    });
    return cleaned.join('\n');
}

function normalizeTableLineMathNoise(text) {
    const src = String(text || '');
    if (!src) return src;
    const lines = src.split('\n');
    const cleaned = lines.map((line) => {
        let row = String(line || '');
        const pipeCount = (row.match(/\|/g) || []).length;
        if (pipeCount < 2) return row;
        // 去掉表格分隔符附近误插入的美元符，避免整行被当作数学块。
        row = row.replace(/\$+\s*\|/g, '|');
        row = row.replace(/\|\s*\$+/g, '|');
        return row;
    });
    return cleaned.join('\n');
}

function isLikelyPureMathSpan(body) {
    const src = String(body || '').trim();
    if (!src) return false;
    const cjkCount = (src.match(/[\u3400-\u9fff]/g) || []).length;
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

function normalizeIndentedGfmTables(text) {
    const src = String(text || '');
    if (!src) return src;
    const lines = src.split('\n');
    const out = [];

    const isLikelyTableRow = (line) => /^\s*\|.+\|\s*$/.test(line || '');
    const isLikelyTableSep = (line) => /^\s*\|[\s:\-|]+\|\s*$/.test(line || '');
    const leadingSpaces = (line) => {
        const m = String(line || '').match(/^(\s*)/);
        return m ? m[1].length : 0;
    };

    for (let i = 0; i < lines.length; i += 1) {
        const line = String(lines[i] || '');
        if (!isLikelyTableRow(line) || i + 1 >= lines.length || !isLikelyTableSep(lines[i + 1])) {
            out.push(line);
            continue;
        }

        const indent = leadingSpaces(line);
        if (indent <= 0) {
            out.push(line);
            continue;
        }

        // 确保表格前有空行，提升 marked 对 GFM table 的识别稳定性。
        if (out.length > 0 && String(out[out.length - 1] || '').trim() !== '') {
            out.push('');
        }

        // 拉平当前整段缩进表格。
        while (i < lines.length) {
            const row = String(lines[i] || '');
            if (!row.trim()) break;
            if (!isLikelyTableRow(row) && !isLikelyTableSep(row)) break;
            if (leadingSpaces(row) < indent) break;
            out.push(row.slice(indent));
            i += 1;
        }
        i -= 1;
    }

    return out.join('\n');
}

function needsAggressiveLatexRecovery(text) {
    const src = String(text || '');
    if (!src) return false;
    if (/@@NEXORA_MATH_SEG_\d+@@|NEXORAMATHSEGTOKEN\d+X/.test(src)) return true;
    if (/[\\]0|[\\]1/.test(src)) return true;
    if (/\${3,}/.test(src)) return true;
    if (/\\boldsymbol\{\\vec\{[^{}]+\}\}\s*\{\\text\{[^{}]+\}\}/.test(src)) return true;
    if (/\\vec\{[^{}]+\}\s*\{\\text\{[^{}]+\}\}/.test(src)) return true;
    if (countUnescapedSingleDollars(src) % 2 !== 0) return true;
    return false;
}

function countUnescapedDoubleDollar(text) {
    const src = String(text || '');
    if (!src) return 0;
    let count = 0;
    for (let i = 0; i < src.length - 1; i += 1) {
        if (src[i] !== '$' || src[i + 1] !== '$') continue;
        if (i > 0 && src[i - 1] === '\\') continue;
        count += 1;
        i += 1;
    }
    return count;
}

function normalizeMixedDollarDelimiters(text) {
    let src = String(text || '');
    if (!src) return src;

    // `$$x$` / `$x$$` -> `$x$`
    src = src.replace(/\$\$([^\n$]{1,160})\$/g, '$$$1$');
    src = src.replace(/\$([^\n$]{1,160})\$\$/g, '$$$1$');

    // 短 inline 内容误用了 display math，降级成行内，减少大段误吞。
    src = src.replace(/\$\$([^\n$]{1,120})\$\$/g, '$$$1$');

    // `$$` 分隔符数量为奇数时，优先补齐闭合符，尽量保留公式显示。
    if (countUnescapedDoubleDollar(src) % 2 !== 0) {
        src = `${src}$$`;
    }

    return src;
}

function normalizeVectorTextSuffixes(text) {
    let src = String(text || '');
    if (!src) return src;
    src = src.replace(/\\boldsymbol\{\s*\\vec\{([^{}]+)\}\s*\}\s*\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\boldsymbol{\\vec{$1}}_{\\text{$2}}');
    src = src.replace(/\\boldsymbol\{\s*\\vec\{([^{}]+)\}\s*\}\s*\{\s*\\mathrm\{([^{}]+)\}\s*\}/g, '\\boldsymbol{\\vec{$1}}_{\\mathrm{$2}}');
    src = src.replace(/\\vec\{\s*([^{}]+)\s*\}\s*\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\vec{$1}_{\\text{$2}}');
    src = src.replace(/\\vec\{\s*([^{}]+)\s*\}\s*\{\s*\\mathrm\{([^{}]+)\}\s*\}/g, '\\vec{$1}_{\\mathrm{$2}}');
    return src;
}

function normalizeLatexSyntax(text) {
    let src = String(text || '');
    if (!src) return src;

    // 清理历史版本渲染时泄漏到文本中的占位符。
    src = src
        .replace(/@@NEXORA_MATH_SEG_\d+@@/g, '')
        .replace(/NEXORAMATHSEGTOKEN\d+X/g, '');

    // 连续美元符常见于模型输出抖动（如 $$$ / $$$$），先归一化。
    src = src.replace(/\${3,}/g, '$$');
    src = normalizeMixedDollarDelimiters(src);

    // 清理零宽字符、软换行等不可见符，避免污染数学解析。
    src = src
        .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '')
        .replace(/[\uE000-\uF8FF]/g, ''); // Private Use Area（常见于复制后的脏符号）

    // 先做 markdown 层表格规范化，避免合法表格因缩进丢失渲染。
    src = normalizeIndentedGfmTables(src);

    // 这两类是安全修复：不依赖脏数据判定，始终执行。
    src = normalizeVectorTextSuffixes(src);
    src = normalizeMathBlockLineBreaks(src);
    src = collapseDisplayMathForMarkdown(src);

    // 正常输出不做激进修复，避免误改合法 markdown/LaTeX。
    if (!needsAggressiveLatexRecovery(src)) {
        return src;
    }

    // 常见脏字符（PUA）里出现的“不等于”占位，替换为正常字符。
    src = src.replace(/\uE020/g, '≠');

    // OCR/复制常见矩阵换行误写：\0、\1 通常应为 \\（行分隔）。
    src = src.replace(/(^|[^\\])\\0/g, '$1\\\\');
    src = src.replace(/(^|[^\\])\\1/g, '$1\\\\');

    // 修正常见错误数学转义：\ c、\ +、\ - 等，本意通常是矩阵换行。
    // 只处理“单反斜杠 + 空白/符号”，不会破坏 \det、\begin 等正常命令。
    src = src.replace(/(^|[^\\])\\(?=(?:\s|[+\-−]))/g, '$1\\\\');

    // 公式中常见“误插入 $”修复：
    // 例如：$\boldsymbol{\vec{v}}_{\text{绝对}} = $\boldsymbol{\vec{v}}_{\text{相对}}
    // 这里第二个 $ 是脏分隔符，应移除。
    src = src.replace(/([=+\-*/(（\s])\$(\s*\\(?:boldsymbol|vec|frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|alpha|beta|gamma|omega|theta|neq|leq|geq|times|cdot))/g, '$1$2');

    // 修复 `\ $\text{kg}` 这类在公式内部被拆开的写法。
    src = src.replace(/\\\s*\$\s*\\text\{/g, '\\ \\text{');

    // 单美元符跨多行时，仅对“纯数学内容”提升为块公式；混排文本则去掉外层美元符，避免整段渲染失败。
    src = src.replace(/\$([^$\n]*\n[\s\S]*?)\$/g, (_, body) => {
        const b = String(body || '');
        if (isLikelyPureMathSpan(b)) return `$$${b.trim()}$$`;
        return b;
    });
    // 行内公式美元符不成对时，先去掉孤立 `$`，后续再走裸公式兜底包裹。
    src = stripUnbalancedInlineDollarsByLine(src);
    // markdown 表格行常被误插入 `$`，额外清洗一次。
    src = normalizeTableLineMathNoise(src);

    return src;
}

function wrapBareLatexFragments(text) {
    const src = String(text || '');
    if (!src) return src;

    // 把裸露的常见 LaTeX 片段包成行内公式。
    // 示例：\boldsymbol{\vec{a}}'=0 -> $\boldsymbol{\vec{a}}'=0$
    const pattern = /(^|[\s(（:：，,])((?:\\(?:boldsymbol|vec|frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|alpha|beta|gamma|omega|theta|neq|leq|geq|times|cdot|begin|end|det)\b(?:[^\n|$`@，。；：、<>()（）])*))/g;
    return src.replace(pattern, (_, pre, frag) => `${pre}$${frag}$`);
}

function splitMathAwareSegments(text) {
    const src = String(text || '');
    if (!src) return [];

    const segments = [];
    const pattern = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$(?:\\.|[^$\n\\])+\$)/g;
    let last = 0;
    let m;
    while ((m = pattern.exec(src)) !== null) {
        const idx = m.index;
        if (idx > last) {
            segments.push({ isMath: false, text: src.slice(last, idx) });
        }
        segments.push({ isMath: true, text: String(m[0] || '') });
        last = idx + m[0].length;
    }
    if (last < src.length) {
        segments.push({ isMath: false, text: src.slice(last) });
    }
    return segments;
}

function protectMathSegmentsForMarkdown(text) {
    const segs = splitMathAwareSegments(text);
    if (!segs.length) return { text: String(text || ''), map: [] };
    const map = [];
    let out = '';
    let idx = 0;
    for (const seg of segs) {
        if (!seg.isMath) {
            out += seg.text;
            continue;
        }
        const token = `@@NX_MSEG_${idx}@@`;
        map.push({ token, math: seg.text });
        out += token;
        idx += 1;
    }
    return { text: out, map };
}

function restoreMathSegmentsFromHtml(html, map) {
    let out = String(html || '');
    const arr = Array.isArray(map) ? map : [];
    for (const item of arr) {
        if (!item || !item.token) continue;
        const token = String(item.token);
        const math = String(item.math || '');
        out = out.split(token).join(math);
    }
    return out;
}

function wrapBareLatexFragmentsOutsideMath(text) {
    const segs = splitMathAwareSegments(text);
    if (!segs.length) return String(text || '');
    return segs.map((seg) => {
        if (seg.isMath) return seg.text;
        return wrapBareLatexFragments(seg.text);
    }).join('');
}

function renderMarkdownWithNewTabLinks(text) {
    const raw = String(text || '');
    const normalizedText = normalizeLatexSyntax(raw);
    const withBareLatexWrapped = needsAggressiveLatexRecovery(raw)
        ? wrapBareLatexFragmentsOutsideMath(normalizedText)
        : normalizedText;
    const shielded = protectMathSegmentsForMarkdown(withBareLatexWrapped);
    const html = marked.parse(String(shielded.text || ''), { gfm: true, breaks: true });
    const restoredHtml = restoreMathSegmentsFromHtml(html, shielded.map);
    return rewriteHtmlFragmentLinksToNewTab(restoredHtml);
}

function renderMarkdownForNotes(text) {
    const raw = String(text || '');
    const normalizedText = normalizeLatexSyntax(raw);
    const withBareLatexWrapped = needsAggressiveLatexRecovery(raw)
        ? wrapBareLatexFragmentsOutsideMath(normalizedText)
        : normalizedText;
    const shielded = protectMathSegmentsForMarkdown(withBareLatexWrapped);
    // Notes 专用：不把单换行渲染成 <br>，避免选中 LaTeX 文本时出现逐字换行。
    const html = marked.parse(String(shielded.text || ''), { gfm: true, breaks: false });
    const restoredHtml = restoreMathSegmentsFromHtml(html, shielded.map);
    return rewriteHtmlFragmentLinksToNewTab(restoredHtml);
}

const __mathRenderTimerMap = new WeakMap();
const __mathRenderRetryMap = new WeakMap();

function renderMathSafe(root) {
    if (!root) return;

    const prevTimer = __mathRenderTimerMap.get(root);
    if (prevTimer) clearTimeout(prevTimer);

    const timer = setTimeout(() => {
        try {
            if (typeof renderMathInElement !== 'function') {
                const retries = (__mathRenderRetryMap.get(root) || 0) + 1;
                __mathRenderRetryMap.set(root, retries);
                if (retries <= 20) {
                    renderMathSafe(root);
                }
                return;
            }

            __mathRenderRetryMap.set(root, 0);
            renderMathInElement(root, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false }
                ],
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
                throwOnError: false
            });
        } catch (e) {
            console.warn('LaTeX render failed:', e);
        }
    }, 80);

    __mathRenderTimerMap.set(root, timer);
}

function rewriteCitationRefsMarkdown(text, citationMap) {
    const src = String(text || '');
    if (!src) return src;
    const map = (citationMap && typeof citationMap === 'object') ? citationMap : {};
    return src.replace(/\[ref_(\d+)\]/g, (_, n) => {
        const idx = Number(n || 0);
        const url = map[idx] || map[String(idx)] || '';
        if (url) return `[ref_${idx}](${url})`;
        return '';
    });
}

function normalizeClientJsTimeoutMs(v, fallback = 8000) {
    const raw = Number(v);
    const n = Number.isFinite(raw) ? Math.floor(raw) : Math.floor(fallback);
    return Math.max(500, Math.min(30000, n));
}

function normalizeClientJsCode(rawCode) {
    let code = String(rawCode || '');
    if (!code) return '';
    code = code.replace(/^\uFEFF/, '').replace(/\u2028|\u2029/g, '\n');
    const trimmed = code.trim();

    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string') {
            code = parsed;
        } else if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') {
            code = parsed.code;
        }
    } catch (_) {
        // keep raw string as-is
    }

    code = String(code || '').replace(/^\uFEFF/, '').replace(/\u2028|\u2029/g, '\n');
    const fenced = code.trim().match(/^```(?:javascript|js|jsx|typescript|ts)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
        code = fenced[1];
    }

    // normalize common LLM typography that breaks JS parser
    code = code
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\u3000/g, ' ')
        .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

    return code.trim();
}

function parseJsonObjectMaybe(raw) {
    if (raw && typeof raw === 'object') return raw;
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (_) {
        return null;
    }
}

function detectCanvasUsageInJsCode(code) {
    const src = String(code || '');
    if (!src.trim()) return false;
    if (/getContext\s*\(\s*['"`]2d['"`]\s*\)/i.test(src)) return true;
    if (/createElement\s*\(\s*['"`]canvas['"`]\s*\)/i.test(src)) return true;
    if (/querySelector\s*\(\s*['"`][^'"`]*canvas/i.test(src)) return true;
    if (/getElementById\s*\(\s*['"`][^'"`]*canvas/i.test(src)) return true;
    if (/\bcanvas\s*\./i.test(src)) return true;
    if (/\bctx\s*\./i.test(src)) return true;
    return false;
}

function normalizeCanvasDimension(value, fallback, min = 120, max = 2400) {
    const raw = Number(value);
    const n = Number.isFinite(raw) ? Math.floor(raw) : Math.floor(fallback);
    return Math.max(min, Math.min(max, n));
}

function extractCanvasMetaFromJsPayload(payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const rawCode = String(p.code || '');
    const code = normalizeClientJsCode(rawCode);
    const context = (p.context && typeof p.context === 'object') ? p.context : {};
    const timeoutMs = normalizeClientJsTimeoutMs(p.timeout_ms, 8000);
    const width = normalizeCanvasDimension(
        context.canvas_width != null ? context.canvas_width : context.width,
        640
    );
    const height = normalizeCanvasDimension(
        context.canvas_height != null ? context.canvas_height : context.height,
        360
    );
    return {
        usedCanvas: detectCanvasUsageInJsCode(code),
        code,
        rawCode,
        codeNormalized: code !== rawCode,
        context,
        timeoutMs,
        width,
        height
    };
}

function rememberClientJsCanvasMeta(requestId, meta) {
    const rid = String(requestId || '').trim();
    if (!rid || !meta || typeof meta !== 'object') return;
    clientJsCanvasRequestMap.set(rid, { ...meta, ts: Date.now() });
    if (clientJsCanvasRequestMap.size <= 400) return;
    const keys = Array.from(clientJsCanvasRequestMap.keys());
    for (let i = 0; i < 120; i += 1) {
        const k = keys[i];
        if (!k) break;
        clientJsCanvasRequestMap.delete(k);
    }
}

function findClientJsCanvasMetaFromResultPayload(resultPayload) {
    const payload = (resultPayload && typeof resultPayload === 'object') ? resultPayload : null;
    if (!payload) return null;
    const rid = String(payload.request_id || '').trim();
    if (!rid) return null;
    return clientJsCanvasRequestMap.get(rid) || null;
}

function parseJsExecuteArgumentsMeta(argumentsText) {
    const parsed = parseJsonObjectMaybe(argumentsText);
    if (!parsed) return null;
    const rawCode = String(parsed.code || '');
    const code = normalizeClientJsCode(rawCode);
    if (!code) return null;
    const context = (parsed.context && typeof parsed.context === 'object') ? parsed.context : {};
    const timeoutMs = normalizeClientJsTimeoutMs(parsed.timeout_ms, 8000);
    return {
        code,
        rawCode,
        codeNormalized: code !== rawCode,
        usedCanvas: detectCanvasUsageInJsCode(code),
        context,
        timeoutMs,
        width: normalizeCanvasDimension(context.canvas_width != null ? context.canvas_width : context.width, 640),
        height: normalizeCanvasDimension(context.canvas_height != null ? context.canvas_height : context.height, 360)
    };
}

function ensureMessageCanvasState(messageDiv) {
    if (!messageDiv) return null;
    if (!messageDiv.__canvasRenderState || typeof messageDiv.__canvasRenderState !== 'object') {
        messageDiv.__canvasRenderState = {
            callInfoByKey: {},
            renderedByKey: {},
            nextSeq: 1
        };
    }
    return messageDiv.__canvasRenderState;
}

function placeCanvasCardsBelowToolChain(messageDiv) {
    const parent = (messageDiv && (messageDiv.querySelector('.message-content') || messageDiv)) || null;
    if (!parent) return;
    const cards = Array.from(parent.querySelectorAll('.tool-canvas-card'));
    if (!cards.length) return;

    let lastToolNode = null;
    Array.from(parent.children || []).forEach((node) => {
        if (!node || !node.classList) return;
        if (node.classList.contains('tool-usage') || node.classList.contains('add-basis-view')) {
            lastToolNode = node;
        }
    });

    cards.forEach((card) => {
        if (card && card.parentNode === parent) {
            card.remove();
        }
    });

    if (lastToolNode && lastToolNode.parentNode === parent) {
        const ref = lastToolNode.nextSibling;
        cards.forEach((card) => {
            if (ref) parent.insertBefore(card, ref);
            else parent.appendChild(card);
        });
        return;
    }

    cards.forEach((card) => parent.appendChild(card));
}

function buildCanvasLookupKeys(callId, toolIndex) {
    const keys = [];
    const cid = String(callId || '').trim();
    if (cid) keys.push(`call:${cid}`);
    if (toolIndex !== undefined && toolIndex !== null && Number.isFinite(Number(toolIndex))) {
        keys.push(`idx:${Math.floor(Number(toolIndex))}`);
    }
    return keys;
}

function rememberJsExecuteCanvasCall(messageDiv, toolName, callId, toolIndex, argumentsText) {
    if (!messageDiv) return;
    if (String(toolName || '').trim() !== 'js_execute') return;
    const meta = parseJsExecuteArgumentsMeta(argumentsText);
    if (!meta || !meta.usedCanvas) return;
    const state = ensureMessageCanvasState(messageDiv);
    if (!state) return;
    const keys = buildCanvasLookupKeys(callId, toolIndex);
    if (!keys.length) {
        keys.push(`anon:${state.nextSeq++}`);
    }
    keys.forEach((k) => {
        state.callInfoByKey[k] = meta;
    });
}

function createToolCanvasCard(messageDiv, renderKey, width, height) {
    const parent = (messageDiv && (messageDiv.querySelector('.message-content') || messageDiv)) || null;
    if (!parent) return null;
    let card = null;
    const key = String(renderKey || '');
    parent.querySelectorAll('.tool-canvas-card').forEach((node) => {
        if (card) return;
        if (String(node.dataset.canvasKey || '') === key) {
            card = node;
        }
    });
    if (card) return card;

    card = document.createElement('div');
    card.className = 'tool-canvas-card';
    card.dataset.canvasKey = key;
    card.innerHTML = `
        <div class="tool-canvas-head">Canvas 绘图</div>
        <div class="tool-canvas-wrap">
            <canvas class="tool-canvas"></canvas>
        </div>
        <div class="tool-canvas-status">准备绘制...</div>
    `;

    parent.appendChild(card);

    const canvas = card.querySelector('.tool-canvas');
    if (canvas) {
        canvas.width = normalizeCanvasDimension(width, 640);
        canvas.height = normalizeCanvasDimension(height, 360);
    }
    placeCanvasCardsBelowToolChain(messageDiv);
    return card;
}

async function runCanvasCodeInCard(card, code, context = {}, timeoutMs = 5000) {
    if (!card) return;
    const canvas = card.querySelector('.tool-canvas');
    const statusEl = card.querySelector('.tool-canvas-status');
    if (!canvas || typeof canvas.getContext !== 'function') {
        if (statusEl) statusEl.textContent = 'Canvas 不可用';
        card.classList.add('error');
        return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        if (statusEl) statusEl.textContent = '无法获取 2D 上下文';
        card.classList.add('error');
        return;
    }
    const runtimeCode = normalizeClientJsCode(code);
    if (!runtimeCode) {
        if (statusEl) statusEl.textContent = '空绘图代码';
        card.classList.add('error');
        return;
    }

    const logs = [];
    const pushLog = (level, args) => {
        const line = `[${level}] ${Array.from(args || []).map((x) => String(x)).join(' ')}`.slice(0, 420);
        logs.push(line);
        if (logs.length > 80) logs.splice(0, logs.length - 80);
    };
    const consoleProxy = {
        log: (...args) => pushLog('log', args),
        info: (...args) => pushLog('info', args),
        warn: (...args) => pushLog('warn', args),
        error: (...args) => pushLog('error', args)
    };

    const localContext = (context && typeof context === 'object') ? { ...context } : {};
    localContext.canvas = canvas;
    localContext.ctx = ctx;
    localContext.width = canvas.width;
    localContext.height = canvas.height;

    const safeDocument = {
        getElementById: () => canvas,
        querySelector: () => canvas,
        querySelectorAll: () => [canvas],
        createElement: (tag) => {
            if (String(tag || '').toLowerCase() === 'canvas') return document.createElement('canvas');
            return document.createElement(String(tag || 'div'));
        }
    };
    const safeWindow = {
        devicePixelRatio: Number(window.devicePixelRatio || 1) || 1,
        innerWidth: canvas.width,
        innerHeight: canvas.height
    };
    const raf = (fn) => setTimeout(() => fn(Date.now()), 16);
    const caf = (id) => clearTimeout(id);
    localContext.document = safeDocument;
    localContext.window = safeWindow;
    localContext.requestAnimationFrame = raf;
    localContext.cancelAnimationFrame = caf;

    card.classList.remove('error');
    if (statusEl) statusEl.textContent = '绘制中...';

    try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const prelude = [
            '"use strict";',
            'const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, EventSource = undefined;',
            'const alert = undefined, prompt = undefined, confirm = undefined;'
        ].join('\n');

        const executePromise = (async () => {
            let handledByExpr = false;
            const maybeExpr = String(runtimeCode || '').trim();
            if (maybeExpr && !/\breturn\b/.test(maybeExpr) && !/[;\n]/.test(maybeExpr)) {
                try {
                    const exprFn = new AsyncFunction(
                        'context', 'console',
                        `${prelude}\nreturn (${maybeExpr});`
                    );
                    await exprFn(localContext, consoleProxy);
                    handledByExpr = true;
                } catch (_) {
                    handledByExpr = false;
                }
            }
            if (!handledByExpr) {
                const fn = new AsyncFunction(
                    'context', 'console',
                    `${prelude}\n${runtimeCode}`
                );
                await fn(localContext, consoleProxy);
            }
        })();

        const timeout = normalizeClientJsTimeoutMs(timeoutMs, 5000);
        await Promise.race([
            executePromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`canvas execution timeout after ${timeout}ms`)), timeout))
        ]);

        if (statusEl) statusEl.textContent = logs.length ? `绘制完成 · ${logs.length} 条日志` : '绘制完成';
    } catch (err) {
        const msg = String((err && err.message) || err || 'canvas execute failed');
        if (statusEl) statusEl.textContent = msg;
        card.classList.add('error');
    }
}

function maybeRenderCanvasFromJsExecuteResult(messageDiv, toolName, result, callId, toolIndex) {
    if (!messageDiv) return;
    if (String(toolName || '').trim() !== 'js_execute') return;
    const state = ensureMessageCanvasState(messageDiv);
    if (!state) return;

    const parsedResult = parseJsonObjectMaybe(result);
    if (parsedResult && parsedResult.success === false) {
        return;
    }
    if (!parsedResult) {
        const resultText = String(result || '');
        if (/(^|\b)(error|failed|timeout|错误|失败)(\b|$)/i.test(resultText)) {
            return;
        }
    }

    let canvasMeta = null;
    const keys = buildCanvasLookupKeys(callId, toolIndex);
    for (const k of keys) {
        if (state.callInfoByKey[k]) {
            canvasMeta = state.callInfoByKey[k];
            break;
        }
    }
    if (!canvasMeta && parsedResult) {
        canvasMeta = findClientJsCanvasMetaFromResultPayload(parsedResult);
    }
    if (!canvasMeta || !canvasMeta.usedCanvas || !canvasMeta.code) {
        return;
    }

    let renderKey = keys[0] || '';
    if (!renderKey) {
        const reqId = parsedResult ? String(parsedResult.request_id || '').trim() : '';
        renderKey = reqId ? `req:${reqId}` : `anon_render:${state.nextSeq++}`;
    }
    if (state.renderedByKey[renderKey]) {
        return;
    }
    state.renderedByKey[renderKey] = true;

    const card = createToolCanvasCard(
        messageDiv,
        renderKey,
        canvasMeta.width,
        canvasMeta.height
    );
    if (!card) return;
    runCanvasCodeInCard(
        card,
        canvasMeta.code,
        canvasMeta.context || {},
        canvasMeta.timeoutMs
    );
    placeCanvasCardsBelowToolChain(messageDiv);
}

function rememberClientToolRequestId(requestId) {
    const rid = String(requestId || '').trim();
    if (!rid) return;
    clientToolHandledRequestIds.add(rid);
    if (clientToolHandledRequestIds.size <= 600) return;
    const it = clientToolHandledRequestIds.values();
    for (let i = 0; i < 200; i += 1) {
        const next = it.next();
        if (next.done) break;
        clientToolHandledRequestIds.delete(next.value);
    }
}

function buildClientJsWorkerSource() {
    return `
const MAX_LOG_LINES = 120;
const MAX_LOG_LEN = 480;

function toText(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function clip(s) {
  const t = String(s || '');
  if (t.length <= MAX_LOG_LEN) return t;
  return t.slice(0, MAX_LOG_LEN) + '...';
}

function toJsonSafe(value) {
  try { JSON.stringify(value); return value; } catch (_) { return toText(value); }
}

self.addEventListener('message', async (ev) => {
  const data = (ev && ev.data && typeof ev.data === 'object') ? ev.data : {};
  const code = String(data.code || '');
  const context = (data.context && typeof data.context === 'object') ? data.context : {};
  const logs = [];

  const pushLog = (level, args) => {
    const line = '[' + level + '] ' + clip(Array.from(args || []).map((x) => toText(x)).join(' '));
    logs.push(line);
    if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
  };

  const consoleProxy = {
    log: (...args) => pushLog('log', args),
    info: (...args) => pushLog('info', args),
    warn: (...args) => pushLog('warn', args),
    error: (...args) => pushLog('error', args),
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const prelude = [
      '"use strict";',
      'const window = undefined, document = undefined, selfRef = undefined;',
      'const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, EventSource = undefined, importScripts = undefined;'
    ].join('\\n');

    let ret;
    let handledByExpr = false;
    const maybeExpr = String(code || '').trim();
    if (maybeExpr && !/\\breturn\\b/.test(maybeExpr) && !/[;\\n]/.test(maybeExpr)) {
      try {
        const exprFn = new AsyncFunction('context', 'console', prelude + '\\nreturn (' + maybeExpr + ');');
        ret = await exprFn(context, consoleProxy);
        handledByExpr = true;
      } catch (_) {
        handledByExpr = false;
      }
    }

    if (!handledByExpr) {
      const wrappedCode = [prelude, code].join('\\n');
      const fn = new AsyncFunction('context', 'console', wrappedCode);
      ret = await fn(context, consoleProxy);
    }

    self.postMessage({ success: true, result: toJsonSafe(ret), logs });
  } catch (err) {
    const msg = (err && err.stack) ? String(err.stack) : String(err || 'unknown error');
    if (/syntaxerror/i.test(msg)) {
      const preview = clip(String(code || '').replace(/\\s+/g, ' ').slice(0, 220));
      logs.push('[code_preview] ' + preview);
    }
    self.postMessage({ success: false, error: clip(msg), logs });
  }
});
`.trim();
}

async function executeClientJsInWorker(payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const rawCode = String(p.code || '');
    const code = normalizeClientJsCode(rawCode);
    const codeNormalized = code !== rawCode;
    const context = (p.context && typeof p.context === 'object') ? p.context : {};
    const timeoutMs = normalizeClientJsTimeoutMs(p.timeout_ms, 8000);
    if (!code.trim()) {
        return { success: false, error: 'missing code', logs: [], meta: { timeout_ms: timeoutMs } };
    }

    let worker = null;
    let objectUrl = '';
    const startedAt = Date.now();
    try {
        const blob = new Blob([buildClientJsWorkerSource()], { type: 'text/javascript' });
        objectUrl = URL.createObjectURL(blob);
        worker = new Worker(objectUrl);
    } catch (e) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return {
            success: false,
            error: `worker init failed: ${String((e && e.message) || e || '')}`,
            logs: [],
            meta: { timeout_ms: timeoutMs, code_normalized: codeNormalized }
        };
    }

    return await new Promise((resolve) => {
        let finished = false;
        const finish = (res) => {
            if (finished) return;
            finished = true;
            try { worker.terminate(); } catch (_) { /* ignore */ }
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            const elapsed = Date.now() - startedAt;
            const out = (res && typeof res === 'object') ? res : {};
            out.meta = {
                ...(out.meta || {}),
                timeout_ms: timeoutMs,
                duration_ms: elapsed,
                code_normalized: codeNormalized
            };
            resolve(out);
        };

        const timer = setTimeout(() => {
            finish({
                success: false,
                error: `execution timeout after ${timeoutMs}ms`,
                logs: []
            });
        }, timeoutMs);

        worker.addEventListener('message', (ev) => {
            clearTimeout(timer);
            const msg = (ev && ev.data && typeof ev.data === 'object') ? ev.data : {};
            finish({
                success: !!msg.success,
                result: msg.result,
                error: String(msg.error || ''),
                logs: Array.isArray(msg.logs) ? msg.logs : []
            });
        });
        worker.addEventListener('error', (ev) => {
            clearTimeout(timer);
            finish({
                success: false,
                error: String((ev && ev.message) || 'worker runtime error'),
                logs: []
            });
        });

        try {
            worker.postMessage({ code, context });
        } catch (e) {
            clearTimeout(timer);
            finish({
                success: false,
                error: `worker postMessage failed: ${String((e && e.message) || e || '')}`,
                logs: []
            });
        }
    });
}

async function submitClientToolResult(conversationId, requestId, execRes) {
    const payload = {
        conversation_id: String(conversationId || '').trim(),
        request_id: String(requestId || '').trim(),
        exec_success: !!(execRes && execRes.success),
        result: execRes ? execRes.result : null,
        error: execRes ? String(execRes.error || '') : '',
        logs: (execRes && Array.isArray(execRes.logs)) ? execRes.logs : [],
        meta: (execRes && execRes.meta && typeof execRes.meta === 'object') ? execRes.meta : {}
    };
    const res = await fetch('/api/client-tools/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    return !!(data && data.success);
}

async function pollClientToolRequests() {
    if (clientToolPollInFlight) return 'in_flight';
    const conversationId = String(currentConversationId || '').trim();
    if (!conversationId) return 'no_conversation';
    clientToolPollInFlight = true;
    try {
        const res = await fetch('/api/client-tools/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: conversationId,
                wait_ms: CLIENT_TOOL_PULL_WAIT_MS
            })
        });
        const data = await res.json();
        if (!data || !data.success || !data.request) return 'idle';
        const req = data.request;
        if (String(req.type || '').trim() !== 'js_execute') return 'idle';
        const requestId = String(req.request_id || '').trim();
        if (!requestId) return 'idle';
        if (clientToolHandledRequestIds.has(requestId)) return 'idle';

        const reqPayload = (req.payload && typeof req.payload === 'object') ? req.payload : {};
        const canvasMeta = extractCanvasMetaFromJsPayload(reqPayload);
        let execRes = null;
        if (canvasMeta.usedCanvas) {
            rememberClientJsCanvasMeta(requestId, canvasMeta);
            execRes = {
                success: true,
                result: {
                    accepted: true,
                    mode: 'canvas',
                    message: 'canvas draw code received'
                },
                error: '',
                logs: [],
                meta: {
                    execution_mode: 'canvas',
                    canvas_used: true,
                    canvas_width: canvasMeta.width,
                    canvas_height: canvasMeta.height,
                    code_normalized: !!canvasMeta.codeNormalized
                }
            };
        } else {
            execRes = await executeClientJsInWorker(reqPayload);
        }
        const submitted = await submitClientToolResult(conversationId, requestId, execRes);
        if (submitted) {
            rememberClientToolRequestId(requestId);
            return 'handled';
        }
        return 'idle';
    } catch (e) {
        // keep silent to avoid noisy console in long-running polling
        return 'error';
    } finally {
        clientToolPollInFlight = false;
    }
}

function calcNextClientToolPollDelay(outcome) {
    const state = String(outcome || '').trim();
    if (state === 'handled') return CLIENT_TOOL_POLL_HIT_MS;
    if (state === 'no_conversation') return CLIENT_TOOL_POLL_NO_CONV_MS;
    if (state === 'error') return CLIENT_TOOL_POLL_ERROR_MS;
    if (state === 'in_flight') return Math.min(CLIENT_TOOL_POLL_MAX_MS, Math.max(CLIENT_TOOL_POLL_MIN_MS, clientToolPollDelayMs));
    if (state === 'idle') {
        const grown = Math.floor((Number(clientToolPollDelayMs || CLIENT_TOOL_POLL_MIN_MS) * 1.45));
        return Math.min(CLIENT_TOOL_POLL_MAX_MS, Math.max(CLIENT_TOOL_POLL_MIN_MS, grown));
    }
    return CLIENT_TOOL_POLL_MIN_MS;
}

function scheduleNextClientToolPoll(immediate = false) {
    if (clientToolPollTimer) {
        clearTimeout(clientToolPollTimer);
        clientToolPollTimer = null;
    }
    const waitMs = immediate ? 0 : Math.max(0, Number(clientToolPollDelayMs || CLIENT_TOOL_POLL_MIN_MS));
    clientToolPollTimer = setTimeout(async () => {
        const outcome = await pollClientToolRequests();
        clientToolPollDelayMs = calcNextClientToolPollDelay(outcome);
        scheduleNextClientToolPoll(false);
    }, waitMs);
}

function stopClientToolPolling() {
    if (clientToolPollTimer) {
        clearTimeout(clientToolPollTimer);
        clientToolPollTimer = null;
    }
    clientToolPollInFlight = false;
    clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;
}

function startClientToolPolling() {
    stopClientToolPolling();
    clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;
    scheduleNextClientToolPoll(true);
}

function loadMailSidebarCollapsedState() {
    try {
        const v = localStorage.getItem(MAIL_SIDEBAR_COLLAPSED_KEY);
        if (v === '1' || v === 'true') return true;
        if (v === '0' || v === 'false') return false;
    } catch (e) {
        // ignore
    }
    return false;
}

function saveMailSidebarCollapsedState(collapsed) {
    try {
        localStorage.setItem(MAIL_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) {
        // ignore
    }
}

function getCurrentUrlParams() {
    return new URLSearchParams(window.location.search || '');
}

function isMailViewUrl() {
    const p = getCurrentUrlParams();
    return p.get('view') === 'mail';
}

function getMailIdFromUrl() {
    const p = getCurrentUrlParams();
    return (p.get('mail_id') || '').trim();
}

function setMailViewUrl(mailId) {
    try {
        const p = getCurrentUrlParams();
        p.set('view', 'mail');
        if (mailId) p.set('mail_id', String(mailId));
        else p.delete('mail_id');
        const q = p.toString();
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', `/chat${q ? `?${q}` : ''}`);
        }
    } catch (e) {
        // ignore
    }
}

function clearMailViewUrl() {
    try {
        const p = getCurrentUrlParams();
        p.delete('view');
        p.delete('mail_id');
        const q = p.toString();
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', `/chat${q ? `?${q}` : ''}`);
        }
    } catch (e) {
        // ignore
    }
}

function isMailViewActiveInDom() {
    const viewer = document.getElementById('knowledgeViewer');
    if (!viewer) return false;
    const display = (viewer.style.display || '').toLowerCase();
    if (display === 'none') return false;
    return !!viewer.querySelector('.mail-workspace');
}

function isMailMobileLayout() {
    try {
        return window.matchMedia('(max-width: 980px)').matches;
    } catch (e) {
        return window.innerWidth <= 980;
    }
}

function isChatMobileLayout() {
    try {
        return window.matchMedia('(max-width: 980px)').matches;
    } catch (e) {
        return window.innerWidth <= 980;
    }
}

function closeMobileHeaderMenu() {
    const menu = document.getElementById('mobileHeaderMenu') || els.mobileHeaderMenu;
    const panel = document.getElementById('mobileHeaderMenuPanel') || els.mobileHeaderMenuPanel;
    if (menu) menu.classList.remove('open');
    if (panel) panel.setAttribute('aria-hidden', 'true');
    const trigger = document.getElementById('mobileHeaderMenuTrigger') || els.mobileHeaderMenuTrigger;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function positionMobileHeaderMenuPanel() {
    const trigger = document.getElementById('mobileHeaderMenuTrigger') || els.mobileHeaderMenuTrigger;
    const panel = document.getElementById('mobileHeaderMenuPanel') || els.mobileHeaderMenuPanel;
    if (!trigger || !panel) return;
    if (!isChatMobileLayout()) {
        panel.style.top = '';
        panel.style.left = '';
        panel.style.right = '';
        return;
    }
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const vw = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const panelWidth = panel.offsetWidth || 142;
    const top = Math.max(6, Math.round(rect.bottom + gap));
    let left = Math.round(rect.right - panelWidth);
    left = Math.max(8, Math.min(left, Math.max(8, vw - panelWidth - 8)));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
}

function bindBackdropSafeClose(backdrop, onClose) {
    const modal = backdrop;
    if (!modal || typeof onClose !== 'function') return;
    if (modal.dataset.safeCloseBound === '1') return;
    modal.dataset.safeCloseBound = '1';

    let pressedOnBackdrop = false;

    const onStart = (e) => {
        pressedOnBackdrop = (e.target === modal);
    };
    const onEnd = (e) => {
        const shouldClose = pressedOnBackdrop && (e.target === modal);
        pressedOnBackdrop = false;
        if (!shouldClose) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
    };
    const onCancel = () => {
        pressedOnBackdrop = false;
    };
    const swallowBackdropClick = (e) => {
        if (e.target !== modal) return;
        // Avoid legacy click close paths when selection drag ends outside the dialog.
        e.preventDefault();
        e.stopPropagation();
    };

    modal.addEventListener('mousedown', onStart);
    modal.addEventListener('mouseup', onEnd);
    modal.addEventListener('mouseleave', onCancel);
    modal.addEventListener('touchstart', onStart, { passive: true });
    modal.addEventListener('touchend', onEnd);
    modal.addEventListener('touchcancel', onCancel);
    modal.addEventListener('click', swallowBackdropClick, true);
}

function bindMobileHeaderMenu() {
    els.mobileHeaderMenu = document.getElementById('mobileHeaderMenu');
    els.mobileHeaderMenuTrigger = document.getElementById('mobileHeaderMenuTrigger');
    els.mobileHeaderMenuPanel = document.getElementById('mobileHeaderMenuPanel');
    els.mobileWorkflowMenuItem = document.getElementById('mobileWorkflowMenuItem');
    els.mobileNotesMenuItem = document.getElementById('mobileNotesMenuItem');

    const menu = els.mobileHeaderMenu;
    const trigger = els.mobileHeaderMenuTrigger;
    const panel = els.mobileHeaderMenuPanel;
    if (!menu || !trigger || !panel) return;

    trigger.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !menu.classList.contains('open');
        if (willOpen) {
            menu.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            trigger.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => positionMobileHeaderMenuPanel());
        } else {
            closeMobileHeaderMenu();
        }
    };

    const workflowItem = els.mobileWorkflowMenuItem;
    if (workflowItem) {
        workflowItem.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileHeaderMenu();
            openWorkflowPlaceholderView();
        };
    }

    const notesItem = els.mobileNotesMenuItem;
    if (notesItem) {
        notesItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMobileHeaderMenu();
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (!ok) showToast('打开独立笔记窗口失败');
                return;
            }
            toggleNotesPanel();
        };
    }

    if (!isChatMobileLayout()) {
        closeMobileHeaderMenu();
    } else if (menu.classList.contains('open')) {
        requestAnimationFrame(() => positionMobileHeaderMenuPanel());
    }
}

function ensureMessageInputFocus(options = {}) {
    if (!els.messageInput) return;
    const input = els.messageInput;
    const opts = (options && typeof options === 'object') ? options : {};
    const onlyIfBlurred = !!opts.onlyIfBlurred;
    const preserveSelection = opts.preserveSelection !== false;
    if (onlyIfBlurred && document.activeElement === input) return;
    const prevStart = preserveSelection ? input.selectionStart : null;
    const prevEnd = preserveSelection ? input.selectionEnd : null;
    const prevDirection = preserveSelection ? input.selectionDirection : null;

    const focusNow = () => {
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
        if (!preserveSelection) return;
        if (document.activeElement !== input) return;
        if (!Number.isInteger(prevStart) || !Number.isInteger(prevEnd)) return;
        try {
            input.setSelectionRange(prevStart, prevEnd, prevDirection || 'none');
        } catch (_) {
            // ignore for unsupported browsers
        }
    };
    requestAnimationFrame(() => setTimeout(focusNow, 0));
}

function setMailMobileDetailMode(showDetail) {
    const workspace = document.getElementById('mailWorkspace');
    if (!workspace) return;
    if (isMailMobileLayout() && !!showDetail) workspace.classList.add('mail-mobile-detail');
    else workspace.classList.remove('mail-mobile-detail');
}

function loadMailLastOpenTs() {
    try {
        const raw = Number(localStorage.getItem(MAIL_LAST_OPEN_TS_KEY) || 0);
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    } catch (e) {
        return 0;
    }
}

function saveMailLastOpenTs(ts) {
    try {
        const v = Number(ts || 0);
        localStorage.setItem(MAIL_LAST_OPEN_TS_KEY, String(Number.isFinite(v) && v > 0 ? Math.floor(v) : 0));
    } catch (e) {
        // ignore
    }
}

function ensureMailNotifyBadge() {
    const btn = document.getElementById('toggleMailView');
    if (!btn) return null;
    btn.classList.add('mail-toggle-with-notify');
    let badge = btn.querySelector('.mail-notify-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mail-notify-badge';
        badge.textContent = '0';
        btn.appendChild(badge);
    }
    return badge;
}

function renderMailNotifyBadge() {
    const badge = ensureMailNotifyBadge();
    if (!badge) return;
    const count = Math.max(0, Number(mailNotifyState.newCount || 0));
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.add('visible');
    } else {
        badge.textContent = '0';
        badge.classList.remove('visible');
    }
}

function getMailMaxTimestamp(mails) {
    const arr = Array.isArray(mails) ? mails : [];
    let maxTs = 0;
    for (const m of arr) {
        const ts = Number(m && m.timestamp ? m.timestamp : 0);
        if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    return maxTs;
}

function updateMailNotifyFromMails(mails, options = {}) {
    const markChecked = !!(options && options.markChecked);
    const arr = Array.isArray(mails) ? mails : [];
    const maxTs = getMailMaxTimestamp(arr);

    if (markChecked) {
        const markTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000);
        mailNotifyState.lastOpenTs = markTs;
        mailNotifyState.initialized = true;
        mailNotifyState.newCount = 0;
        saveMailLastOpenTs(mailNotifyState.lastOpenTs);
        renderMailNotifyBadge();
        return;
    }

    if (!mailNotifyState.initialized || mailNotifyState.lastOpenTs <= 0) {
        const initTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000);
        mailNotifyState.lastOpenTs = initTs;
        mailNotifyState.initialized = true;
        mailNotifyState.newCount = 0;
        saveMailLastOpenTs(mailNotifyState.lastOpenTs);
        renderMailNotifyBadge();
        return;
    }

    const baseline = Number(mailNotifyState.lastOpenTs || 0);
    const newCount = arr.filter((m) => {
        const ts = Number(m && m.timestamp ? m.timestamp : 0);
        return Number.isFinite(ts) && ts > baseline;
    }).length;
    mailNotifyState.newCount = newCount;
    renderMailNotifyBadge();
}

async function pollMailNotifyOnly() {
    try {
        const res = await fetch('/api/mail/me/inbox?cache_mode=refresh&limit=20');
        const data = await res.json();
        if (!data || !data.success) return;
        const mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        updateMailNotifyFromMails(mails, { markChecked: false });
    } catch (e) {
        // ignore polling errors
    }
}

// === Agent Status Polling ===
let agentStatusPollTimer = null;
function startAgentStatusPolling() {
    if (agentStatusPollTimer) clearInterval(agentStatusPollTimer);
    
    const checkStatus = () => {
        fetch('/api/agent/status')
            .then(res => res.json())
            .then(data => {
                const indicator = document.getElementById('desktopAgentIndicator');
                if (indicator) {
                    if (data.online) {
                        indicator.style.backgroundColor = '#4caf50'; // green
                        indicator.title = 'NexoraCode (本地计算节点) - 在线';
                    } else {
                        indicator.style.backgroundColor = '#9e9e9e'; // grey
                        indicator.title = 'NexoraCode (本地计算节点) - 离线';
                    }
                }
            }).catch(() => {
                const indicator = document.getElementById('desktopAgentIndicator');
                if (indicator) {
                    indicator.style.backgroundColor = '#9e9e9e';
                    indicator.title = 'NexoraCode (本地计算节点) - 离线 (拉取失败)';
                }
            });
    };
    
    checkStatus(); // Initial fetch
    agentStatusPollTimer = setInterval(checkStatus, 5000); // 5s interval
}

function stopMailPolling() {
    if (mailPollTimer) {
        clearInterval(mailPollTimer);
        mailPollTimer = null;
    }
    mailPollInFlight = false;
}

function startMailPolling() {
    if (!document.getElementById('toggleMailView')) return;
    stopMailPolling();
    const tick = async () => {
        if (mailPollInFlight) return;
        mailPollInFlight = true;
        try {
            if (isMailViewActiveInDom()) {
                await loadMailCurrentFolder(mailViewState.query || '', { silent: true, refreshDetail: false });
                if (mailViewState.folder === 'sent') {
                    await pollMailNotifyOnly();
                }
            } else {
                await pollMailNotifyOnly();
            }
        } catch (e) {
            // ignore polling errors to keep UI stable
        } finally {
            mailPollInFlight = false;
        }
    };
    tick();
    mailPollTimer = setInterval(tick, MAIL_POLL_INTERVAL_MS);
}

function loadMailSelectedId() {
    try {
        return (localStorage.getItem(MAIL_SELECTED_ID_KEY) || '').trim();
    } catch (e) {
        return '';
    }
}

function saveMailSelectedId(id) {
    try {
        localStorage.setItem(MAIL_SELECTED_ID_KEY, String(id || ''));
    } catch (e) {
        // ignore
    }
}

function loadMailListScroll() {
    try {
        const v = Number(localStorage.getItem(MAIL_LIST_SCROLL_KEY) || 0);
        return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch (e) {
        return 0;
    }
}

function saveMailListScroll(scrollTop) {
    try {
        localStorage.setItem(MAIL_LIST_SCROLL_KEY, String(Math.max(0, Number(scrollTop || 0))));
    } catch (e) {
        // ignore
    }
}

function setRightSidebarPanelVisible(panel, visible) {
    const p = panel || null;
    if (!p) return;
    const show = !!visible;
    if (p.__panelAnimTimer) {
        clearTimeout(p.__panelAnimTimer);
        p.__panelAnimTimer = null;
    }
    p.classList.add('panel-animating');
    requestAnimationFrame(() => {
        if (show) p.classList.add('visible');
        else p.classList.remove('visible');
    });
    p.__panelAnimTimer = setTimeout(() => {
        p.classList.remove('panel-animating');
        p.__panelAnimTimer = null;
    }, 280);
}

function closeKnowledgePanel() {
    if (els.knowledgePanel) setRightSidebarPanelVisible(els.knowledgePanel, false);
}

function openKnowledgePanel() {
    if (!els.knowledgePanel) return;
    if (els.filePanel) setRightSidebarPanelVisible(els.filePanel, false);
    setRightSidebarPanelVisible(els.knowledgePanel, true);
}

function toggleKnowledgePanel() {
    if (!els.knowledgePanel) return;
    const nextVisible = !els.knowledgePanel.classList.contains('visible');
    if (nextVisible) openKnowledgePanel();
    else closeKnowledgePanel();
}

function closeCloudFilePanel() {
    if (els.filePanel) setRightSidebarPanelVisible(els.filePanel, false);
}

function openCloudFilePanel() {
    if (!els.filePanel) return;
    if (els.knowledgePanel) setRightSidebarPanelVisible(els.knowledgePanel, false);
    setRightSidebarPanelVisible(els.filePanel, true);
    loadCloudFiles();
}

function toggleCloudFilePanel() {
    if (!els.filePanel) return;
    const nextVisible = !els.filePanel.classList.contains('visible');
    if (nextVisible) openCloudFilePanel();
    else closeCloudFilePanel();
}

window.toggleCloudFilePanel = toggleCloudFilePanel;
window.toggleKnowledgePanel = toggleKnowledgePanel;

function openMobileSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove('collapsed');
    requestAnimationFrame(() => {
        els.sidebar.classList.add('mobile-open');
    });
}

function closeMobileSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove('mobile-open');
}

function toggleMobileSidebar() {
    if (!els.sidebar) return;
    if (els.sidebar.classList.contains('mobile-open')) closeMobileSidebar();
    else openMobileSidebar();
}

function formatFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = n;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
        val /= 1024;
        idx += 1;
    }
    return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

function formatFileUpdatedAt(ts) {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    try {
        return new Date(n * 1000).toLocaleString();
    } catch (_) {
        return '-';
    }
}

function downloadCloudFile(fileRef) {
    const ref = String(fileRef || '').trim();
    if (!ref) return;
    const url = `/api/files/download?file_ref=${encodeURIComponent(ref)}`;
    window.open(url, '_blank');
}

async function removeCloudFile(fileRef) {
    const ref = String(fileRef || '').trim();
    if (!ref) return;
    const ok = await confirmModalAsync('删除文件', `确定删除文件「${ref}」吗？`, 'danger');
    if (!ok) return;
    try {
        const res = await fetch(`/api/files/remove?file_ref=${encodeURIComponent(ref)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!data || !data.success) {
            showToast((data && data.message) ? data.message : '删除失败');
            return;
        }
        showToast('文件已删除');
        await loadCloudFiles();
    } catch (e) {
        showToast('删除失败');
    }
}

async function loadCloudFilePreview(fileRef, previewEl) {
    const ref = String(fileRef || '').trim();
    if (!ref || !previewEl) return;
    previewEl.textContent = '加载中...';
    try {
        const res = await fetch(`/api/files/read?file_ref=${encodeURIComponent(ref)}`);
        const data = await res.json();
        if (!data || !data.success) {
            previewEl.textContent = (data && data.message) ? data.message : '读取失败';
            return;
        }
        previewEl.textContent = String(data.content || '');
    } catch (e) {
        previewEl.textContent = '读取失败';
    }
}

function attachCloudFileAsAttachment(fileRef, sandboxPath, aliasName = '', sizeBytes = 0) {
    const ref = String(fileRef || '').trim();
    const sandbox = String(sandboxPath || '').trim();
    const name = String(aliasName || ref || '').trim();
    if (!sandbox) {
        showToast('文件路径无效，无法附加');
        return false;
    }
    const exists = uploadedFileIds.some((f) => (
        f && String(f.type || '') === 'sandbox_file' &&
        String(f.sandbox_path || '').trim() === sandbox
    ));
    if (exists) {
        showToast('该文件已附加');
        return false;
    }
    uploadedFileIds.push({
        type: 'sandbox_file',
        name: name || sandbox.split('/').pop() || 'cloud-file',
        original_name: name || '',
        sandbox_path: sandbox,
        stored_path: ref || sandbox,
        size: Number(sizeBytes || 0)
    });
    updateFilePreview();
    if (els.messageInput) {
        els.messageInput.focus();
    }
    showToast('已附加到输入框');
    return true;
}

function renderCloudFileList(files) {
    if (!els.cloudFileList) return;
    const arr = Array.isArray(files) ? files : [];
    if (els.cloudFileCount) els.cloudFileCount.textContent = String(arr.length);
    if (arr.length === 0) {
        els.cloudFileList.innerHTML = '<div class="cloud-file-empty">暂无文件</div>';
        return;
    }

    els.cloudFileList.innerHTML = arr.map((f) => {
        const aliasRaw = String((f && f.alias) ? f.alias : '-');
        const sandboxPathRaw = String((f && f.sandbox_path) ? f.sandbox_path : '');
        const alias = escapeHtml(aliasRaw);
        const sizeText = escapeHtml(formatFileSize(f && f.size ? f.size : 0));
        const updatedText = escapeHtml(formatFileUpdatedAt(f && f.updated_at ? f.updated_at : 0));
        return `
            <div class="cloud-file-item" data-file-ref="${escapeHtml(aliasRaw)}" data-file-path="${escapeHtml(sandboxPathRaw)}" data-file-size="${Number(f && f.size ? f.size : 0)}" title="点击展开预览">
                <div class="cloud-file-main">
                    <div class="cloud-file-head">
                        <div class="cloud-file-name">${alias}</div>
                        <div class="cloud-file-actions">
                            <button class="cloud-file-btn cloud-file-attach" data-action="attach" title="附加到输入框">
                                <i class="fa-solid fa-circle-plus"></i>
                            </button>
                            <button class="cloud-file-btn cloud-file-download" data-action="download" title="下载">
                                <i class="fa-solid fa-download"></i>
                            </button>
                            <button class="cloud-file-btn cloud-file-delete" data-action="delete" title="删除">
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                    <div class="cloud-file-meta">
                        <span class="cloud-file-size">${sizeText}</span>
                        <span class="cloud-file-time">${updatedText}</span>
                    </div>
                </div>
                <div class="cloud-file-preview-wrap">
                    <div class="cloud-file-preview cloud-file-preview-empty">点击展开预览</div>
                </div>
            </div>
        `;
    }).join('');

    els.cloudFileList.querySelectorAll('.cloud-file-item').forEach((el) => {
        const fileRef = (el.dataset.fileRef || '').trim();
        const filePath = (el.dataset.filePath || '').trim();
        const fileSize = Number(el.dataset.fileSize || 0);
        const previewEl = el.querySelector('.cloud-file-preview');
        const previewWrap = el.querySelector('.cloud-file-preview-wrap');
        const mainRow = el.querySelector('.cloud-file-main');
        const btnAttach = el.querySelector('.cloud-file-attach');
        const btnDownload = el.querySelector('.cloud-file-download');
        const btnDelete = el.querySelector('.cloud-file-delete');

        if (mainRow) {
            mainRow.addEventListener('click', async (e) => {
                if (e.target && e.target.closest('.cloud-file-btn')) return;
                const willExpand = !el.classList.contains('expanded');
                els.cloudFileList.querySelectorAll('.cloud-file-item.expanded').forEach((other) => {
                    if (other !== el) other.classList.remove('expanded');
                });
                if (!willExpand) {
                    el.classList.remove('expanded');
                    return;
                }
                el.classList.add('expanded');
                if (!previewWrap || !previewEl) return;
                if (previewWrap.dataset.loaded === '1') return;
                await loadCloudFilePreview(fileRef, previewEl);
                previewWrap.dataset.loaded = '1';
            });
        }

        el.addEventListener('click', (e) => {
            // clicking blank preview area should not trigger re-open logic from container
            if (e.target && e.target.closest('.cloud-file-main')) return;
            const willExpand = !el.classList.contains('expanded');
            if (!willExpand) el.classList.remove('expanded');
        });

        if (btnAttach) {
            btnAttach.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const attached = attachCloudFileAsAttachment(fileRef, filePath, fileRef, fileSize);
                if (attached) {
                    btnAttach.classList.add('attached');
                    btnAttach.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(() => {
                        btnAttach.classList.remove('attached');
                        btnAttach.innerHTML = '<i class="fa-solid fa-circle-plus"></i>';
                    }, 1200);
                }
            });
        }
        if (btnDownload) {
            btnDownload.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadCloudFile(fileRef);
            });
        }
        if (btnDelete) {
            btnDelete.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await removeCloudFile(fileRef);
            });
        }
    });
}

async function loadCloudFiles() {
    if (!els.cloudFileList) return;
    const q = (els.cloudFileSearchInput && els.cloudFileSearchInput.value ? els.cloudFileSearchInput.value : '').trim();
    els.cloudFileList.innerHTML = '<div class="cloud-file-empty">加载中...</div>';
    try {
        const url = `/api/files/list${q ? `?q=${encodeURIComponent(q)}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data || !data.success) {
            const msg = data && data.message ? data.message : '读取失败';
            els.cloudFileList.innerHTML = `<div class="cloud-file-empty">${escapeHtml(msg)}</div>`;
            if (els.cloudFileCount) els.cloudFileCount.textContent = '0';
            return;
        }
        renderCloudFileList(data.files || []);
    } catch (e) {
        els.cloudFileList.innerHTML = '<div class="cloud-file-empty">读取失败</div>';
        if (els.cloudFileCount) els.cloudFileCount.textContent = '0';
    }
}

// DOM Elements
const els = {
    sidebar: document.getElementById('sidebar'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    fileInput: document.getElementById('fileInput'),
    filePreviewArea: document.getElementById('filePreviewArea'),
    fileUploadProgressWrap: document.getElementById('fileUploadProgressWrap'),
    fileUploadProgressFill: document.getElementById('fileUploadProgressFill'),
    fileUploadProgressText: document.getElementById('fileUploadProgressText'),
    fileDropOverlay: document.getElementById('fileDropOverlay'),
    cancelFileUploadBtn: document.getElementById('cancelFileUploadBtn'),
    sendBtn: document.getElementById('sendBtn'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    // New Model Selector
    modelSelectContainer: document.getElementById('modelSelectContainer'),
    currentModelDisplay: document.getElementById('currentModelDisplay'),
    modelOptions: document.getElementById('modelOptions'),
    // ...
    conversationList: document.getElementById('conversationList'),
    newChatBtn: document.getElementById('newChatBtn'),
    conversationTitle: document.getElementById('conversationTitle'),
    knowledgePanel: document.getElementById('knowledgePanel'),
    filePanel: document.getElementById('filePanel'),
    toggleWorkflowView: document.getElementById('toggleWorkflowView'),
    toggleNotesPanel: document.getElementById('toggleNotesPanel'),
    mobileHeaderMenu: document.getElementById('mobileHeaderMenu'),
    mobileHeaderMenuTrigger: document.getElementById('mobileHeaderMenuTrigger'),
    mobileHeaderMenuPanel: document.getElementById('mobileHeaderMenuPanel'),
    mobileWorkflowMenuItem: document.getElementById('mobileWorkflowMenuItem'),
    mobileNotesMenuItem: document.getElementById('mobileNotesMenuItem'),
    toggleMailView: document.getElementById('toggleMailView'),
    toggleFilePanel: document.getElementById('toggleFilePanel'),
    toggleKnowledgePanel: document.getElementById('toggleKnowledgePanel'),
    btnTogglePanel: document.getElementById('btnTogglePanel'), // Close button inside panel
    btnToggleFilePanel: document.getElementById('btnToggleFilePanel'),
    refreshKnowledgeBtn: document.getElementById('refreshKnowledgeBtn'),
    refreshCloudFilesBtn: document.getElementById('refreshCloudFilesBtn'),
    panelBasisList: document.getElementById('panelBasisKnowledgeList'),
    panelShortList: document.getElementById('panelShortMemoryList'),
    panelBasisCount: document.getElementById('panelBasisCount'),
    panelShortCount: document.getElementById('panelShortCount'),
    cloudFileSearchInput: document.getElementById('cloudFileSearchInput'),
    cloudFileSearchBtn: document.getElementById('cloudFileSearchBtn'),
    cloudFileCount: document.getElementById('cloudFileCount'),
    cloudFileList: document.getElementById('cloudFileList'),
    tokenBudgetMini: document.getElementById('tokenBudgetMini'),
    tokenBudgetRing: document.getElementById('tokenBudgetRing'),
    tokenBudgetUsage: document.getElementById('tokenBudgetUsage'),
    tokenDisplay: document.getElementById('tokenDisplay'),
    modalTotalTokens: document.getElementById('modalTotalTokens'),
    modalTodayTokens: document.getElementById('modalTodayTokens'),
    tokenModal: document.getElementById('tokenModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    imageViewerBackdrop: document.getElementById('imageViewerBackdrop'),
    imageViewerViewport: document.getElementById('imageViewerViewport'),
    imageViewerImage: document.getElementById('imageViewerImage'),
    imageViewerClose: document.getElementById('imageViewerClose'),
    imageViewerZoomIn: document.getElementById('imageViewerZoomIn'),
    imageViewerZoomOut: document.getElementById('imageViewerZoomOut'),
    imageViewerReset: document.getElementById('imageViewerReset'),
    imageViewerScaleLabel: document.getElementById('imageViewerScaleLabel'),
    notesPanel: document.getElementById('notesPanel'),
    notesPanelHead: document.querySelector('#notesPanel .notes-panel-head'),
    closeNotesPanelBtn: document.getElementById('closeNotesPanelBtn'),
    openNotesCompanionBtn: document.getElementById('openNotesCompanionBtn'),
    notesNotebookSelect: document.getElementById('notesNotebookSelect'),
    createNotebookBtn: document.getElementById('createNotebookBtn'),
    clearNotebookBtn: document.getElementById('clearNotebookBtn'),
    deleteNotebookBtn: document.getElementById('deleteNotebookBtn'),
    downloadNotebookBtn: document.getElementById('downloadNotebookBtn'),
    notesResizeHandle: document.getElementById('notesResizeHandle'),
    notesList: document.getElementById('notesList'),
    notesCountBadge: document.getElementById('notesCountBadge'),
    notesContextMenu: document.getElementById('notesContextMenu'),
    notesAddSelectionBtn: document.getElementById('notesAddSelectionBtn'),
    pinContextMenu: document.getElementById('pinContextMenu'),
    pinContextMenuAction: document.getElementById('pinContextMenuAction'),
    mobileSelectionAddBtn: document.getElementById('mobileSelectionAddBtn'),
    totalInputTokens: document.getElementById('totalInputTokens'),
    totalOutputTokens: document.getElementById('totalOutputTokens'),
    // Options
    checkThinking: document.getElementById('enableThinking'),
    checkSearch: document.getElementById('enableWebSearch'),
    toolsMode: document.getElementById('toolsMode'),
    toolsModeDropdown: document.getElementById('toolsModeDropdown'),
    toolsModeTrigger: document.getElementById('toolsModeTrigger'),
    toolsModeMenu: document.getElementById('toolsModeMenu'),
    toolsModeLabel: document.getElementById('toolsModeLabel'),
    // Admin & User Menu
    userMenu: document.getElementById('userMenu'),
    usernameBtn: document.getElementById('usernameBtn'),
    adminLink: document.getElementById('adminBackendBtn'),
    adminModal: document.getElementById('adminModal'),
    closeAdminBtn: document.getElementById('closeAdminBtn'),
    userTableBody: document.getElementById('userTableBody'),
    userCount: document.getElementById('userCount'),
    knowledgeSearchInput: document.getElementById('knowledgeSearchInput'),
    knowledgeSearchBtn: document.getElementById('knowledgeSearchBtn')
};

function createDefaultNotebook() {
    return {
        id: NOTES_DEFAULT_NOTEBOOK_ID,
        name: '默认笔记本',
        ts: Math.floor(Date.now() / 1000)
    };
}

function createDefaultNotesStore() {
    return {
        activeNotebookId: NOTES_DEFAULT_NOTEBOOK_ID,
        notebooks: [createDefaultNotebook()],
        notes: []
    };
}

function normalizeNotebookItem(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const id = String(src.id || '').trim() || `nb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const name = String(src.name || '').trim() || '未命名笔记本';
    const ts = Number(src.ts || Math.floor(Date.now() / 1000));
    return {
        id,
        name,
        ts: Number.isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000)
    };
}

function normalizeNoteAnchor(raw) {
    const src = (raw && typeof raw === 'object') ? raw : null;
    if (!src) return null;
    const type = String(src.type || '').trim();
    if (type === 'chat') {
        const conversationId = String(src.conversationId || '').trim();
        const messageIndexNum = Number(src.messageIndex);
        const messageIndex = Number.isFinite(messageIndexNum) ? Math.max(0, Math.floor(messageIndexNum)) : null;
        const messageRole = String(src.messageRole || '').trim();
        const snippet = String(src.snippet || '').trim().slice(0, 600);
        const plainSnippet = String(src.plainSnippet || '').trim().slice(0, 600);
        return {
            type: 'chat',
            conversationId,
            messageIndex,
            messageRole: (messageRole === 'assistant' || messageRole === 'user') ? messageRole : '',
            snippet,
            plainSnippet
        };
    }
    if (type === 'knowledge') {
        const title = String(src.title || '').trim().slice(0, 200);
        const snippet = String(src.snippet || '').trim().slice(0, 600);
        const plainSnippet = String(src.plainSnippet || '').trim().slice(0, 600);
        return {
            type: 'knowledge',
            title,
            snippet,
            plainSnippet
        };
    }
    return null;
}

function normalizeNoteItem(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const text = String(src.text || '').trim();
    if (!text) return null;
    const notebookId = String(src.notebookId || NOTES_DEFAULT_NOTEBOOK_ID).trim() || NOTES_DEFAULT_NOTEBOOK_ID;
    const ts = Number(src.ts || Math.floor(Date.now() / 1000));
    return {
        id: String(src.id || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
        notebookId,
        text,
        source: String(src.source || '聊天'),
        sourceTitle: String(src.sourceTitle || ''),
        anchor: normalizeNoteAnchor(src.anchor),
        ts: Number.isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000)
    };
}

function loadNotesStore() {
    // 云端为主；这里仅作为兼容旧版本的本地迁移来源。
    const fallback = createDefaultNotesStore();
    try {
        const raw = localStorage.getItem(NOTES_LEGACY_STORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (_) {
        // ignore
    }

    // 兼容最早按会话散列存储的老格式
    try {
        const merged = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = String(localStorage.key(i) || '');
            if (!k.startsWith(NOTES_LEGACY_PREFIX)) continue;
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) continue;
            arr.forEach((n) => {
                const normalized = normalizeNoteItem({
                    ...n,
                    notebookId: NOTES_DEFAULT_NOTEBOOK_ID
                });
                if (normalized) merged.push(normalized);
            });
        }
        if (merged.length) {
            fallback.notes = merged
                .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
                .slice(0, 6000);
        }
    } catch (_) {
        // ignore
    }
    return fallback;
}

function applyNotesStoreToState(store) {
    const src = (store && typeof store === 'object') ? store : createDefaultNotesStore();
    const notebooksRaw = Array.isArray(src.notebooks) ? src.notebooks : [];
    const notesRaw = Array.isArray(src.notes) ? src.notes : [];
    const notebooks = notebooksRaw.map(normalizeNotebookItem).filter(Boolean);
    if (!notebooks.length) notebooks.push(createDefaultNotebook());
    const notebookSet = new Set(notebooks.map((n) => n.id));
    const notes = notesRaw
        .map(normalizeNoteItem)
        .filter(Boolean)
        .map((n) => {
            if (!notebookSet.has(n.notebookId)) n.notebookId = notebooks[0].id;
            return n;
        });
    let activeNotebookId = String(src.activeNotebookId || '').trim();
    if (!activeNotebookId || !notebookSet.has(activeNotebookId)) {
        activeNotebookId = notebooks[0].id;
    }

    notesState.notebooks = notebooks;
    notesState.items = notes;
    notesState.activeNotebookId = activeNotebookId;
}

function buildNotesStorePayload() {
    return {
        activeNotebookId: String(notesState.activeNotebookId || NOTES_DEFAULT_NOTEBOOK_ID),
        notebooks: Array.isArray(notesState.notebooks) ? notesState.notebooks : [createDefaultNotebook()],
        notes: Array.isArray(notesState.items) ? notesState.items : []
    };
}

async function fetchNotesStoreFromCloud() {
    try {
        const res = await fetch('/api/notes/store');
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.success || !data.store || typeof data.store !== 'object') return null;
        return data.store;
    } catch (_) {
        return null;
    }
}

async function saveNotesStoreToCloud(store) {
    try {
        const res = await fetch('/api/notes/store', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store })
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.success || !data.store || typeof data.store !== 'object') return null;
        return data.store;
    } catch (_) {
        return null;
    }
}

async function flushNotesCloudSync() {
    if (notesCloudSyncInFlight) return;
    const payload = notesCloudSyncPendingStore || buildNotesStorePayload();
    notesCloudSyncPendingStore = null;
    notesCloudSyncInFlight = true;
    try {
        const saved = await saveNotesStoreToCloud(payload);
        if (saved) {
            applyNotesStoreToState(saved);
        }
    } finally {
        notesCloudSyncInFlight = false;
        if (notesCloudSyncPendingStore) {
            if (notesCloudSyncTimer) {
                clearTimeout(notesCloudSyncTimer);
                notesCloudSyncTimer = null;
            }
            void flushNotesCloudSync();
        }
    }
}

function saveNotesToStorage(options = {}) {
    const immediate = !!(options && options.immediate);
    notesCloudSyncPendingStore = buildNotesStorePayload();
    try {
        localStorage.setItem('nc_sync_notes_data_payload', JSON.stringify(notesCloudSyncPendingStore));
        localStorage.setItem('nc_sync_notes_ts', String(Date.now()));
          if (typeof notesSyncChannel !== 'undefined') notesSyncChannel.postMessage({ type: 'SYNC', payload: notesCloudSyncPendingStore });
    } catch (_) {}
    if (notesCloudSyncTimer) {
        clearTimeout(notesCloudSyncTimer);
        notesCloudSyncTimer = null;
    }
    if (immediate) {
        void flushNotesCloudSync();
        return;
    }
    notesCloudSyncTimer = setTimeout(() => {
        notesCloudSyncTimer = null;
        void flushNotesCloudSync();
    }, NOTES_CLOUD_SYNC_DEBOUNCE_MS);
}

const notesSyncChannel = new BroadcastChannel('nc_notes_sync');
  notesSyncChannel.onmessage = (e) => {
      if (e.data && e.data.type === 'SYNC') {
          if (e.data.payload && typeof e.data.payload === 'object') {
              applyNotesStoreToState(e.data.payload);
              renderNotesList();
          }
      }
  };

  window.addEventListener('storage', (e) => {
    if (e.key === 'nc_sync_notes_ts') {
        try {
            const raw = localStorage.getItem('nc_sync_notes_data_payload');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    applyNotesStoreToState(parsed);
                    renderNotesList();
                }
            }
        } catch (_) {}
    }
});

async function hydrateNotesState() {
    const localStore = loadNotesStore();
    applyNotesStoreToState(localStore);
    const cloudStore = await fetchNotesStoreFromCloud();
    if (cloudStore) {
        const cloudNotes = Array.isArray(cloudStore.notes) ? cloudStore.notes : [];
        const cloudBooks = Array.isArray(cloudStore.notebooks) ? cloudStore.notebooks : [];
        const cloudHasUserData = cloudNotes.length > 0 || cloudBooks.some((b) => String((b && b.id) || '') !== NOTES_DEFAULT_NOTEBOOK_ID);

        const localNotes = Array.isArray(localStore.notes) ? localStore.notes : [];
        const localBooks = Array.isArray(localStore.notebooks) ? localStore.notebooks : [];
        const localHasUserData = localNotes.length > 0 || localBooks.some((b) => String((b && b.id) || '') !== NOTES_DEFAULT_NOTEBOOK_ID);

        if (!cloudHasUserData && localHasUserData) {
            applyNotesStoreToState(localStore);
            saveNotesToStorage({ immediate: true });
        } else {
            applyNotesStoreToState(cloudStore);
        }
    } else {
        // 云端不可用时，保留当前状态并尝试回写。
        saveNotesToStorage({ immediate: true });
    }
    renderNotesList();
}

function getNotesForActiveNotebook() {
    const activeId = String(notesState.activeNotebookId || '').trim();
    const arr = Array.isArray(notesState.items) ? notesState.items : [];
    return arr.filter((n) => String(n.notebookId || '') === activeId);
}

function renderNotebookSelector() {
    const select = els.notesNotebookSelect || document.getElementById('notesNotebookSelect');
    if (!select) return;
    const notebooks = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    select.innerHTML = notebooks.map((b) => (
        `<option value="${escapeHtml(String(b.id || ''))}">${escapeHtml(String(b.name || '未命名笔记本'))}</option>`
    )).join('');
    const activeId = String(notesState.activeNotebookId || '').trim();
    if (activeId) {
        select.value = activeId;
        if (select.value !== activeId && notebooks[0]) {
            notesState.activeNotebookId = String(notebooks[0].id || '');
            select.value = notesState.activeNotebookId;
        }
    }
}

function getActiveNotebookName() {
    const id = String(notesState.activeNotebookId || '').trim();
    const arr = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    const target = arr.find((b) => String(b.id || '') === id);
    return target ? String(target.name || '未命名笔记本') : '默认笔记本';
}

function createNotebook() {
    const raw = prompt('输入新笔记本名称');
    if (raw === null) return;
    const name = String(raw || '').trim();
    if (!name) {
        showToast('笔记本名称不能为空');
        return;
    }
    const exists = (Array.isArray(notesState.notebooks) ? notesState.notebooks : [])
        .some((b) => String(b.name || '').trim() === name);
    if (exists) {
        showToast('笔记本名称已存在');
        return;
    }
    const notebook = {
        id: `nb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        name: name.slice(0, 36),
        ts: Math.floor(Date.now() / 1000)
    };
    notesState.notebooks = [notebook, ...(Array.isArray(notesState.notebooks) ? notesState.notebooks : [])];
    notesState.activeNotebookId = notebook.id;
    saveNotesToStorage();
    renderNotesList();
}

async function clearActiveNotebook() {
    const arr = getNotesForActiveNotebook();
    if (!arr.length) return;
    const ok = await confirmModalAsync('清空笔记本', `确定清空笔记本「${getActiveNotebookName()}」吗？`, 'danger');
    if (!ok) return;
    const activeId = String(notesState.activeNotebookId || '').trim();
    notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
        .filter((n) => String(n.notebookId || '') !== activeId);
    saveNotesToStorage();
    renderNotesList();
    showToast('已清空当前笔记本');
}

async function deleteActiveNotebook() {
    const notebooks = Array.isArray(notesState.notebooks) ? notesState.notebooks : [];
    if (notebooks.length <= 1) {
        showToast('至少保留一个笔记本');
        return;
    }
    const activeId = String(notesState.activeNotebookId || '').trim();
    const activeName = getActiveNotebookName();
    const ok = await confirmModalAsync('删除笔记本', `确定删除笔记本「${activeName}」吗？其内笔记将一并删除。`, 'danger');
    if (!ok) return;
    notesState.notebooks = notebooks.filter((n) => String(n.id || '') !== activeId);
    notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
        .filter((n) => String(n.notebookId || '') !== activeId);
    notesState.activeNotebookId = String((notesState.notebooks[0] && notesState.notebooks[0].id) || NOTES_DEFAULT_NOTEBOOK_ID);
    saveNotesToStorage();
    renderNotesList();
    showToast('已删除笔记本');
}

function sanitizeNotebookFilename(name) {
    const n = String(name || 'notes').trim();
    return (n || 'notes').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 48) || 'notes';
}

function downloadActiveNotebook() {
    const notes = getNotesForActiveNotebook();
    const notebookName = getActiveNotebookName();
    if (!notes.length) {
        showToast('当前笔记本为空');
        return;
    }
    const header = `# ${notebookName}\n\n导出时间：${new Date().toLocaleString()}\n\n---\n`;
    const body = notes.map((n, idx) => {
        const source = `${String(n.source || '聊天')}${n.sourceTitle ? ` · ${String(n.sourceTitle)}` : ''}`;
        const time = formatNoteTime(n.ts);
        return `\n## 笔记 ${idx + 1}\n\n> 来源：${source}\n> 时间：${time}\n\n${String(n.text || '')}\n`;
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `${sanitizeNotebookFilename(notebookName)}_${ts}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('已下载当前笔记本');
}

function formatNoteTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    try {
        return new Date(n * 1000).toLocaleString();
    } catch (e) {
        return '-';
    }
}

function normalizeNoteSearchText(raw) {
    return String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeNoteSearchTextLoose(raw) {
    return normalizeNoteSearchText(String(raw || '').replace(/[*_`#[\]()>|~\-]/g, ' '));
}

function buildNoteAnchorSnippet(raw, limit = 220) {
    const n = normalizeSelectionTextForNotes(raw);
    if (!n) return '';
    return n.slice(0, Math.max(48, Math.min(1000, Number(limit) || 220)));
}

function messageElementMatchesAnchor(messageEl, anchor) {
    if (!messageEl || !anchor || typeof anchor !== 'object') return false;
    const expectedRole = String(anchor.messageRole || '').trim();
    if (expectedRole && !messageEl.classList.contains(expectedRole)) return false;

    const plainNeedle = normalizeNoteSearchText(anchor.plainSnippet || '');
    if (plainNeedle) {
        const plainHaystack = normalizeNoteSearchText(messageEl.textContent || '');
        if (plainHaystack && plainHaystack.includes(plainNeedle)) return true;
    }

    const rawNeedle = normalizeNoteSearchText(anchor.snippet || '');
    if (rawNeedle) {
        const sourceNodes = Array.from(messageEl.querySelectorAll('.content-body, .message-bubble'));
        for (const node of sourceNodes) {
            if (!node || typeof node.__sourceMarkdown !== 'string') continue;
            const rawHaystack = normalizeNoteSearchText(node.__sourceMarkdown || '');
            if (rawHaystack && rawHaystack.includes(rawNeedle)) return true;
        }
        const looseNeedle = normalizeNoteSearchTextLoose(anchor.snippet || '');
        if (looseNeedle) {
            const plainHaystackLoose = normalizeNoteSearchTextLoose(messageEl.textContent || '');
            if (plainHaystackLoose && plainHaystackLoose.includes(looseNeedle)) return true;
        }
        return false;
    }

    return true;
}

let notesJumpHighlightTimer = null;
function highlightMessageForNoteJump(messageEl) {
    if (!messageEl) return;
    try {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (_) {
        // ignore
    }
    if (notesJumpHighlightTimer) {
        clearTimeout(notesJumpHighlightTimer);
        notesJumpHighlightTimer = null;
    }
    messageEl.classList.add('note-source-highlight');
    notesJumpHighlightTimer = setTimeout(() => {
        messageEl.classList.remove('note-source-highlight');
        notesJumpHighlightTimer = null;
    }, 2200);
}

async function jumpToChatSource(anchor) {
    const targetConversationId = String((anchor && anchor.conversationId) || currentConversationId || '').trim();
    if (!targetConversationId) {
        showToast('来源对话不存在或已删除');
        return false;
    }

    if (String(currentConversationId || '').trim() !== targetConversationId) {
        await loadConversation(targetConversationId);
    }

    const root = els.messagesContainer || document.getElementById('messagesContainer');
    if (!root) {
        showToast('来源对话不存在或已删除');
        return false;
    }
    const rows = Array.from(root.querySelectorAll('.message'));
    if (!rows.length) {
        showToast('来源对话不存在或已删除');
        return false;
    }

    let targetEl = null;
    const idx = Number(anchor && anchor.messageIndex);
    if (Number.isFinite(idx) && idx >= 0) {
        const byIndex = root.querySelector(`.message[data-index="${Math.floor(idx)}"]`);
        if (byIndex && messageElementMatchesAnchor(byIndex, anchor)) {
            targetEl = byIndex;
        }
    }
    if (!targetEl) {
        targetEl = rows.find((row) => messageElementMatchesAnchor(row, anchor)) || null;
    }
    if (!targetEl && Number.isFinite(idx) && idx >= 0) {
        const fallbackByIndex = root.querySelector(`.message[data-index="${Math.floor(idx)}"]`);
        if (fallbackByIndex) targetEl = fallbackByIndex;
    }
    if (!targetEl) {
        showToast('来源内容已变更或找不到');
        return false;
    }

    highlightMessageForNoteJump(targetEl);
    return true;
}

function contentContainsSnippetLoose(content, snippet) {
    const hay = normalizeNoteSearchTextLoose(content || '');
    const needle = normalizeNoteSearchTextLoose(snippet || '');
    if (!needle) return true;
    return hay.includes(needle);
}

function normalizeKnowledgeTitleKey(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

async function fetchKnowledgeByTitle(title) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) return { ok: false, title: '', data: null };
    try {
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(safeTitle)}`);
        const data = await res.json();
        if (data && data.success && data.knowledge) {
            return { ok: true, title: safeTitle, data };
        }
    } catch (_) {
        // ignore
    }
    return { ok: false, title: safeTitle, data: null };
}

async function resolveKnowledgeSourceForJump(anchor, fallbackTitle = '') {
    const anchorTitle = String((anchor && anchor.title) || '').trim();
    const altTitle = String(fallbackTitle || '').trim();
    const directCandidates = [anchorTitle, altTitle].filter(Boolean);

    for (const candidate of directCandidates) {
        const result = await fetchKnowledgeByTitle(candidate);
        if (result.ok) return result;
    }

    let metaData = null;
    try {
        const res = await fetch('/api/knowledge/list');
        metaData = await res.json();
    } catch (_) {
        metaData = null;
    }
    const basis = (metaData && metaData.basis_knowledge && typeof metaData.basis_knowledge === 'object')
        ? metaData.basis_knowledge
        : {};
    const allTitles = Object.keys(basis);
    if (!allTitles.length) return { ok: false, title: '', data: null };

    const byNorm = new Map();
    allTitles.forEach((t) => {
        const k = normalizeKnowledgeTitleKey(t);
        if (k && !byNorm.has(k)) byNorm.set(k, t);
    });

    const needles = directCandidates
        .map((t) => normalizeKnowledgeTitleKey(t))
        .filter(Boolean);
    for (const needle of needles) {
        const exact = byNorm.get(needle);
        if (exact) {
            const result = await fetchKnowledgeByTitle(exact);
            if (result.ok) return result;
        }
    }

    for (const needle of needles) {
        const fuzzy = allTitles.find((t) => {
            const key = normalizeKnowledgeTitleKey(t);
            return key.includes(needle) || needle.includes(key);
        });
        if (fuzzy) {
            const result = await fetchKnowledgeByTitle(fuzzy);
            if (result.ok) return result;
        }
    }

    return { ok: false, title: '', data: null };
}

async function jumpToKnowledgeSource(anchor, fallbackTitle = '') {
    const resolved = await resolveKnowledgeSourceForJump(anchor, fallbackTitle);
    if (!resolved.ok || !resolved.data) {
        showToast('来源知识不存在或已删除');
        return false;
    }
    const data = resolved.data;
    const resolvedTitle = String(resolved.title || '').trim();

    const snippetForLocate = buildNoteAnchorSnippet((anchor && (anchor.plainSnippet || anchor.snippet)) || '', 260);
    if (snippetForLocate) {
        const srcContent = String((data.knowledge && data.knowledge.content) || '');
        if (contentContainsSnippetLoose(srcContent, snippetForLocate)) {
            await openKnowledgeAtChunk(resolvedTitle, snippetForLocate, { from: 'note' }, false);
            return true;
        }
        await viewKnowledge(resolvedTitle, { forceEditMode: false, fromSearch: false });
        showToast('定位片段未命中，已打开来源知识');
        return true;
    }

    await viewKnowledge(resolvedTitle, { forceEditMode: false, fromSearch: false });
    return true;
}

async function jumpToNoteAnchorPayload(anchor, fallbackTitle = '') {
    const a = normalizeNoteAnchor(anchor);
    if (!a || !a.type) {
        showToast('该笔记缺少来源定位信息');
        return false;
    }
    if (a.type === 'chat') {
        return await jumpToChatSource(a);
    }
    if (a.type === 'knowledge') {
        return await jumpToKnowledgeSource(a, String(fallbackTitle || '').trim());
    }
    showToast('该笔记缺少来源定位信息');
    return false;
}

window.__nexoraJumpToNoteAnchor = async function(payload = {}) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const anchor = normalizeNoteAnchor(p.anchor) || null;
    const sourceTitle = String(p.sourceTitle || '').trim();
    return await jumpToNoteAnchorPayload(anchor, sourceTitle);
};

function buildFallbackAnchorFromNote(note) {
    const n = (note && typeof note === 'object') ? note : {};
    const source = String(n.source || '').trim();
    const sourceTitle = String(n.sourceTitle || '').trim();
    const plainSnippet = buildNoteAnchorSnippet(String(n.text || ''), 220);
    if (source.includes('知识')) {
        return {
            type: 'knowledge',
            title: sourceTitle,
            plainSnippet,
            snippet: plainSnippet
        };
    }
    return {
        type: 'chat',
        conversationId: String(currentConversationId || '').trim(),
        messageIndex: null,
        messageRole: '',
        plainSnippet,
        snippet: plainSnippet
    };
}

let noteSourceJumpInFlight = false;
async function jumpToNoteSource(noteId) {
    if (noteSourceJumpInFlight) return;
    const id = String(noteId || '').trim();
    if (!id) return;
    const notes = Array.isArray(notesState.items) ? notesState.items : [];
    const note = notes.find((n) => String((n && n.id) || '') === id);
    if (!note) {
        showToast('笔记不存在');
        return;
    }
    const anchor = normalizeNoteAnchor(note.anchor) || buildFallbackAnchorFromNote(note);
    if (!anchor || !anchor.type) {
        showToast('该笔记缺少来源定位信息');
        return;
    }

    if (
        NOTES_COMPANION_MODE
        && window.pywebview
        && window.pywebview.api
        && typeof window.pywebview.api.jump_note_source_external === 'function'
    ) {
        try {
            const res = await window.pywebview.api.jump_note_source_external({
                anchor,
                sourceTitle: String(note.sourceTitle || '')
            });
            if (res && res.success) return;
        } catch (_) {
            // fallback to local jump
        }
    }

    noteSourceJumpInFlight = true;
    try {
        await jumpToNoteAnchorPayload(anchor, String(note.sourceTitle || ''));
    } finally {
        noteSourceJumpInFlight = false;
    }
}

function reorderNotesWithinActiveNotebook(draggedId, targetId, insertBefore = true) {
    const dragId = String(draggedId || '').trim();
    const overId = String(targetId || '').trim();
    if (!dragId || !overId || dragId === overId) return false;
    const activeId = String(notesState.activeNotebookId || '').trim();
    const all = Array.isArray(notesState.items) ? notesState.items : [];
    const active = all.filter((n) => String((n && n.notebookId) || '') === activeId);
    const others = all.filter((n) => String((n && n.notebookId) || '') !== activeId);
    if (active.length < 2) return false;

    const order = active.map((n) => String((n && n.id) || ''));
    const from = order.indexOf(dragId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0) return false;
    const nextOrder = order.slice();
    const [moved] = nextOrder.splice(from, 1);
    let insertAt = nextOrder.indexOf(overId);
    if (insertAt < 0) insertAt = nextOrder.length;
    if (!insertBefore) insertAt += 1;
    insertAt = Math.max(0, Math.min(nextOrder.length, insertAt));
    nextOrder.splice(insertAt, 0, moved);

    if (nextOrder.join('|') === order.join('|')) return false;
    const byId = new Map(active.map((n) => [String((n && n.id) || ''), n]));
    const reorderedActive = nextOrder.map((id) => byId.get(id)).filter(Boolean);
    notesState.items = [...reorderedActive, ...others];
    return true;
}

function renderNotesBadge() {
    const btn = document.getElementById('toggleNotesPanel') || els.toggleNotesPanel;
    const badge = document.getElementById('notesCountBadge') || els.notesCountBadge;
    if (!btn || !badge) return;
    const count = getNotesForActiveNotebook().length;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.add('visible');
        btn.classList.add('has-notes');
    } else {
        badge.textContent = '0';
        badge.classList.remove('visible');
        btn.classList.remove('has-notes');
    }
}

function findConversationTitleById(conversationId) {
    const cid = String(conversationId || '').trim();
    if (!cid || !els.conversationList) return '';
    const rows = Array.from(els.conversationList.querySelectorAll('.conversation-item'));
    for (const row of rows) {
        if (String(row.dataset.conversationId || '').trim() !== cid) continue;
        const titleEl = row.querySelector('.title');
        const txt = titleEl ? String(titleEl.textContent || '').trim() : '';
        if (txt) return txt;
    }
    return '';
}

function resolveLiveNoteSourceTitle(note) {
    const n = (note && typeof note === 'object') ? note : {};
    const anchor = normalizeNoteAnchor(n.anchor);
    if (anchor && anchor.type === 'chat') {
        const latestTitle = findConversationTitleById(anchor.conversationId || '');
        if (latestTitle) return latestTitle;
    }
    if (anchor && anchor.type === 'knowledge') {
        const title = String(anchor.title || '').trim();
        if (title) return title;
    }
    return String(n.sourceTitle || '').trim();
}

function renderNotesList() {
    const listEl = els.notesList || document.getElementById('notesList');
    if (!listEl) return;
    renderNotebookSelector();
    const arr = getNotesForActiveNotebook();
    if (!arr.length) {
        listEl.innerHTML = '<div class="notes-empty">暂无笔记。选中文本后右键可添加。</div>';
        listEl.ondragover = null;
        listEl.ondrop = null;
        renderNotesBadge();
        setTimeout(() => {
            try {
                const panel = document.getElementById('notesPanel');
                if (panel) {
                    localStorage.setItem('nc_notes_html_snapshot', String(panel.outerHTML));
                    localStorage.setItem('nc_notes_html_ts', String(Date.now()));
                    if (window.parent && window.parent !== window) {
                        try { window.parent.postMessage({ type: 'NC_SYNC_NOTES_HTML', snapshot: String(panel.outerHTML) }, '*'); } catch(_) {}
                    }
                }
            } catch (_) {}
        }, 50);
        return;
    }
    listEl.innerHTML = '';
    let hasLiveTitleUpdate = false;
    arr.forEach((n) => {
        const card = document.createElement('article');
        card.className = 'note-item';
        card.dataset.noteId = String(n.id || '');
        card.draggable = true;

        const delBtn = document.createElement('button');
        delBtn.className = 'note-del-btn';
        delBtn.type = 'button';
        delBtn.title = '删除';
        delBtn.dataset.action = 'delete-note';
        delBtn.draggable = false;
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        const textDiv = document.createElement('div');
        textDiv.className = 'note-text';
        textDiv.innerHTML = renderMarkdownForNotes(String(n.text || ''));
        renderMathSafe(textDiv);
        highlightCode(textDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'note-meta';
        const sourceSpan = document.createElement('button');
        sourceSpan.type = 'button';
        sourceSpan.className = 'note-source note-source-link';
        sourceSpan.dataset.action = 'jump-note-source';
        sourceSpan.dataset.noteId = String(n.id || '');
        sourceSpan.draggable = false;
        sourceSpan.title = '跳转到来源';
        const liveSourceTitle = resolveLiveNoteSourceTitle(n);
        if (liveSourceTitle !== String(n.sourceTitle || '').trim()) {
            n.sourceTitle = liveSourceTitle;
            hasLiveTitleUpdate = true;
        }
        sourceSpan.textContent = `${String(n.source || '聊天')}${liveSourceTitle ? ` · ${String(liveSourceTitle)}` : ''}`;
        const timeSpan = document.createElement('span');
        timeSpan.className = 'note-time';
        timeSpan.textContent = formatNoteTime(n.ts);
        metaDiv.appendChild(sourceSpan);
        metaDiv.appendChild(timeSpan);

        card.appendChild(delBtn);
        card.appendChild(textDiv);
        card.appendChild(metaDiv);
        listEl.appendChild(card);
    });

    listEl.querySelectorAll('[data-action="delete-note"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const card = e.currentTarget.closest('.note-item');
            if (!card) return;
            const noteId = String(card.dataset.noteId || '').trim();
            if (!noteId) return;
            const ok = await confirmModalAsync('删除笔记', '确定删除这条笔记吗？', 'danger');
            if (!ok) return;
            notesState.items = (Array.isArray(notesState.items) ? notesState.items : [])
                .filter((n) => String(n.id || '') !== noteId);
            saveNotesToStorage();
            renderNotesList();
        });
    });

    listEl.querySelectorAll('[data-action="jump-note-source"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const noteId = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.noteId) || '').trim();
            if (!noteId) return;
            await jumpToNoteSource(noteId);
        });
    });

    let draggingNoteId = '';
    const clearDragClasses = () => {
        listEl.querySelectorAll('.note-item').forEach((el) => {
            el.classList.remove('dragging');
            el.classList.remove('drag-over-top');
            el.classList.remove('drag-over-bottom');
        });
    };

    listEl.querySelectorAll('.note-item').forEach((card) => {
        card.addEventListener('dragstart', (e) => {
            const noteId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!noteId) return;
            draggingNoteId = noteId;
            card.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try {
                    e.dataTransfer.setData('text/plain', noteId);
                } catch (_) {
                    // ignore
                }
            }
        });
        card.addEventListener('dragend', () => {
            draggingNoteId = '';
            clearDragClasses();
        });
        card.addEventListener('dragover', (e) => {
            if (!draggingNoteId) return;
            const overId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!overId || overId === draggingNoteId) return;
            e.preventDefault();
            clearDragClasses();
            const rect = card.getBoundingClientRect();
            const before = Number(e.clientY || 0) < (rect.top + rect.height / 2);
            card.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
        });
        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over-top');
            card.classList.remove('drag-over-bottom');
        });
        card.addEventListener('drop', (e) => {
            if (!draggingNoteId) return;
            e.preventDefault();
            const overId = String((card.dataset && card.dataset.noteId) || '').trim();
            if (!overId || overId === draggingNoteId) {
                clearDragClasses();
                return;
            }
            const rect = card.getBoundingClientRect();
            const before = Number(e.clientY || 0) < (rect.top + rect.height / 2);
            const changed = reorderNotesWithinActiveNotebook(draggingNoteId, overId, before);
            clearDragClasses();
            if (!changed) return;
            saveNotesToStorage();
            renderNotesList();
        });
    });

    listEl.ondragover = (e) => {
        if (!draggingNoteId) return;
        e.preventDefault();
    };
    listEl.ondrop = (e) => {
        if (!draggingNoteId) return;
        const overCard = e.target && e.target.closest ? e.target.closest('.note-item') : null;
        if (overCard) return;
        e.preventDefault();
        const activeNotes = getNotesForActiveNotebook();
        if (!activeNotes.length) return;
        const last = activeNotes[activeNotes.length - 1];
        const lastId = String((last && last.id) || '').trim();
        if (!lastId || lastId === draggingNoteId) return;
        const changed = reorderNotesWithinActiveNotebook(draggingNoteId, lastId, false);
        clearDragClasses();
        if (!changed) return;
        saveNotesToStorage();
        renderNotesList();
    };

    if (hasLiveTitleUpdate) {
        saveNotesToStorage();
    }
    renderNotesBadge();
    
    setTimeout(() => {
        try {
            const panel = document.getElementById('notesPanel');
            if (panel) {
                localStorage.setItem('nc_notes_html_snapshot', String(panel.outerHTML));
                localStorage.setItem('nc_notes_html_ts', String(Date.now()));
                if (window.parent && window.parent !== window) {
                    try { window.parent.postMessage({ type: 'NC_SYNC_NOTES_HTML', snapshot: String(panel.outerHTML) }, '*'); } catch(_) {}
                }
            }
        } catch (_) {}
    }, 50);
}

function syncNotesForConversation(_conversationId = currentConversationId) {
    // 兼容旧调用：当前改为全局笔记本模型，不再按会话分仓。
    if (!Array.isArray(notesState.notebooks) || notesState.notebooks.length === 0) {
        void hydrateNotesState();
    }
    renderNotesList();
}

function openNotesPanel() {
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    notesState.open = true;
    panel.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    bindNotesPanelMobileDrag();
    requestAnimationFrame(() => applyNotesMobilePanelPosition());
    renderNotesList();
    void fetchNotesStoreFromCloud().then((store) => {
        if (!store) return;
        applyNotesStoreToState(store);
        renderNotesList();
    });
}

function closeNotesPanel() {
    if (NOTES_COMPANION_MODE) return;
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    notesState.open = false;
    panel.classList.remove('active');
    panel.classList.remove('dragging');
    panel.classList.remove('resizing');
    panel.setAttribute('aria-hidden', 'true');
}

function logNotesBridge(message) {
    const msg = String(message || '').trim();
    if (!msg) return;
    try {
        const info = getNotesCompanionApiInfo();
        const api = info.api;
        if (api && typeof api.log_notes_bridge_event === 'function') {
            api.log_notes_bridge_event(msg);
        }
    } catch (_) {}
    try { console.log('[NexoraNotesBridge] ' + msg); } catch (_) {}
}

window.toggleNotesPanel = function() {
    if (!NOTES_COMPANION_MODE) {
        // Prefer external notes companion when bridge is available.
        // Fallback to in-page panel if companion open fails.
        Promise.resolve().then(async () => {
            const apiInfo = getNotesCompanionApiInfo();
            logNotesBridge('toggleNotesPanel companion_mode=0 source=' + String(apiInfo.source || 'none') + ' hasApi=' + String(!!apiInfo.api));
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (ok) return;
            }
            logNotesBridge('toggleNotesPanel fallback=open-inline-notes-panel');
            if (notesState.open) closeNotesPanel();
            else openNotesPanel();
        });
        return;
    }
    if (notesState.open) closeNotesPanel();
    else openNotesPanel();
};

function canOpenNotesCompanionWindow() {
    if (NOTES_COMPANION_MODE) return false;
    const info = getNotesCompanionApiInfo();
    const isDesktop = document.documentElement.classList.contains('nc-desktop-mode');
    return !!(info && info.api && typeof info.api.open_notes_companion === 'function') || isDesktop;
}

function getNotesCompanionApiInfo() {
    try {
        if (window.pywebview && window.pywebview.api) {
            return { api: window.pywebview.api, source: 'self' };
        }
    } catch (_) {}
    try {
        if (window.parent && window.parent !== window && window.parent.pywebview && window.parent.pywebview.api) {
            return { api: window.parent.pywebview.api, source: 'parent' };
        }
    } catch (_) {}
    try {
        if (window.top && window.top !== window && window.top.pywebview && window.top.pywebview.api) {
            return { api: window.top.pywebview.api, source: 'top' };
        }
    } catch (_) {}
    return { api: null, source: 'none' };
}

function getNotesCompanionApi() {
    return getNotesCompanionApiInfo().api;
}

async function openNotesCompanionWindow() {
    const info = getNotesCompanionApiInfo();
    const api = info && info.api;
    if (NOTES_COMPANION_MODE) {
        return false;
    }
    if (!api || typeof api.open_notes_companion !== 'function') {
        const isDesktop = document.documentElement.classList.contains('nc-desktop-mode');
        if (isDesktop) {
            logNotesBridge('openNotesCompanionWindow postMessage fallback');
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'NC_OPEN_NOTES_COMPANION' }, '*');
                return true;
            }
        }
        return false;
    }
    try {
        logNotesBridge('openNotesCompanionWindow call source=' + String(info.source || 'unknown'));
        const res = await api.open_notes_companion();
        logNotesBridge('openNotesCompanionWindow result=' + JSON.stringify(res || {}));
        const ok = !!(res && res.success);
        if (ok && notesState.open) {
            closeNotesPanel();
        }
        return ok;
    } catch (e) {
        logNotesBridge('openNotesCompanionWindow error=' + String(e || 'unknown'));
        return false;
    }
}

function isEditableTarget(target) {
    if (!target) return false;
    const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return true;
    return !!el.closest('[contenteditable=""], [contenteditable="true"]');
}

function isTargetInsideSelectableArea(target) {
    if (!target) return false;
    const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!el) return false;
    const msgRoot = els.messagesContainer || document.getElementById('messagesContainer');
    const viewerRoot = document.getElementById('knowledgeViewer');
    if (msgRoot && msgRoot.contains(el)) return true;
    if (viewerRoot && viewerRoot.style.display !== 'none' && viewerRoot.contains(el)) return true;
    return false;
}

function getSelectionPlainTextForNotes(sel) {
    const selection = sel || (window.getSelection ? window.getSelection() : null);
    if (!selection) return '';
    return normalizeSelectionTextForNotes(String(selection.toString() || '').trim());
}

function buildSelectionAnchorFromChatTarget(target, markdownText = '', plainText = '') {
    const t = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    const messageEl = t && t.closest ? t.closest('.message') : null;
    const messageIndexRaw = messageEl ? Number(messageEl.dataset.index) : NaN;
    const messageIndex = Number.isFinite(messageIndexRaw) ? Math.max(0, Math.floor(messageIndexRaw)) : null;
    const conversationId = String(currentConversationId || '').trim();
    let messageRole = '';
    if (messageEl) {
        if (messageEl.classList.contains('assistant')) messageRole = 'assistant';
        else if (messageEl.classList.contains('user')) messageRole = 'user';
    }
    return {
        type: 'chat',
        conversationId,
        messageIndex,
        messageRole,
        snippet: buildNoteAnchorSnippet(markdownText, 280),
        plainSnippet: buildNoteAnchorSnippet(plainText || markdownText, 280)
    };
}

function buildSelectionAnchorFromKnowledgeTarget(markdownText = '', plainText = '') {
    return {
        type: 'knowledge',
        title: String(currentViewingKnowledge || '').trim(),
        snippet: buildNoteAnchorSnippet(markdownText, 280),
        plainSnippet: buildNoteAnchorSnippet(plainText || markdownText, 280)
    };
}

function resolveSelectionSource(target, selectionText = '', plainText = '') {
    const t = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    const viewer = document.getElementById('knowledgeViewer');
    if (viewer && viewer.style.display !== 'none' && t && viewer.contains(t)) {
        const knowledgeTitle = String(currentViewingKnowledge || '').trim();
        const sourceTitle = knowledgeTitle || (els.conversationTitle ? String(els.conversationTitle.textContent || '').trim() : '');
        return {
            source: '知识库',
            sourceTitle,
            anchor: knowledgeTitle ? buildSelectionAnchorFromKnowledgeTarget(selectionText, plainText) : null
        };
    }
    return {
        source: '聊天',
        sourceTitle: els.conversationTitle ? String(els.conversationTitle.textContent || '').trim() : '',
        anchor: buildSelectionAnchorFromChatTarget(t, selectionText, plainText)
    };
}

function hideNotesContextMenu() {
    const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
    if (!menu) return;
    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    notesState.pendingSelectionText = '';
    notesState.pendingSelectionSource = null;
}

function showNotesContextMenu(x, y, selectionText, sourceMeta) {
    const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
    if (!menu) return;
    hidePinContextMenu();
    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 44;
    menu.style.left = `${Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 12))}px`;
    menu.style.top = `${Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 12))}px`;
    notesState.pendingSelectionText = normalizeSelectionTextForNotes(selectionText);
    notesState.pendingSelectionSource = sourceMeta && typeof sourceMeta === 'object' ? sourceMeta : null;
}

function hidePinContextMenu() {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    if (!menu) return;
    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    pinContextMenuState = null;
    pinContextMenuBusy = false;
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    if (actionBtn) actionBtn.disabled = false;
}

function updatePinContextMenuAction(state) {
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    if (!actionBtn) return;
    const pinned = !!(state && state.pinned);
    const label = pinned ? '解除置顶' : '置顶';
    actionBtn.title = label;
    const span = actionBtn.querySelector('span');
    if (span) span.textContent = label;
    const icon = actionBtn.querySelector('i');
    if (icon) icon.className = 'fa-solid fa-thumbtack';
}

function showPinContextMenu(x, y, payload) {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    if (!menu) return;
    const state = (payload && typeof payload === 'object') ? payload : null;
    if (!state || !state.targetType) return;
    hideNotesContextMenu();
    pinContextMenuState = { ...state };
    updatePinContextMenuAction(pinContextMenuState);
    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');
    const menuWidth = menu.offsetWidth || 136;
    const menuHeight = menu.offsetHeight || 44;
    const left = Math.min(Math.max(8, Number(x || 0)), Math.max(8, window.innerWidth - menuWidth - 12));
    const top = Math.min(Math.max(8, Number(y || 0)), Math.max(8, window.innerHeight - menuHeight - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

async function setConversationPinned(conversationId, pin) {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    const res = await fetch(`/api/conversations/${encodeURIComponent(cid)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: !!pin })
    });
    const data = await res.json();
    return !!(data && data.success);
}

async function setBasisKnowledgePinned(title, pin) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) return false;
    const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(safeTitle)}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: !!pin })
    });
    const data = await res.json();
    return !!(data && data.success);
}

function setConversationPinLocal(conversationId, pin) {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    let found = false;
    const source = Array.isArray(conversationListCache) ? conversationListCache : [];
    conversationListCache = source.map((item) => {
        const src = (item && typeof item === 'object') ? item : {};
        const itemId = String(src.conversation_id || src.id || '').trim();
        if (itemId !== cid) return src;
        found = true;
        return { ...src, pin: !!pin };
    });
    if (found) {
        renderConversationList(conversationListCache);
    }
    return found;
}

function setBasisPinLocal(title, pin) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) return false;
    let found = false;
    const source = Array.isArray(basisKnowledgeListCache) ? basisKnowledgeListCache : [];
    basisKnowledgeListCache = source.map((item) => {
        const src = (item && typeof item === 'object') ? item : {};
        const itemTitle = String((src && src.title) || (typeof item === 'string' ? item : '')).trim();
        if (itemTitle !== safeTitle) return item;
        found = true;
        const nextObj = {
            ...(src || {}),
            title: itemTitle,
            content: String((src && src.content) || itemTitle),
            pin: !!pin
        };
        return nextObj;
    });
    if (!found) return false;
    if (!knowledgeMetaCache || typeof knowledgeMetaCache !== 'object') {
        knowledgeMetaCache = {};
    }
    if (!knowledgeMetaCache[safeTitle] || typeof knowledgeMetaCache[safeTitle] !== 'object') {
        knowledgeMetaCache[safeTitle] = {};
    }
    knowledgeMetaCache[safeTitle].pin = !!pin;
    renderKnowledgeList(els.panelBasisList, basisKnowledgeListCache, 'basis');
    return true;
}

async function applyPinContextMenuAction() {
    if (!pinContextMenuState || pinContextMenuBusy) return;
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    const state = { ...pinContextMenuState };
    hidePinContextMenu();
    pinContextMenuBusy = true;
    if (actionBtn) actionBtn.disabled = true;
    try {
        const targetType = String(state.targetType || '').trim();
        const nextPin = !state.pinned;
        let ok = false;
        let patched = false;
        if (targetType === 'conversation') {
            patched = setConversationPinLocal(state.conversationId, nextPin);
            ok = await setConversationPinned(state.conversationId, nextPin);
            if (ok) {
                await loadConversations();
                showToast(nextPin ? '对话已置顶' : '已取消置顶');
            } else if (patched) {
                setConversationPinLocal(state.conversationId, state.pinned);
            }
        } else if (targetType === 'knowledge_basis') {
            patched = setBasisPinLocal(state.title, nextPin);
            ok = await setBasisKnowledgePinned(state.title, nextPin);
            if (ok) {
                await loadKnowledge(currentConversationId);
                showToast(nextPin ? '知识已置顶' : '已取消置顶');
            } else if (patched) {
                setBasisPinLocal(state.title, state.pinned);
            }
        }
        if (!ok) {
            if (targetType === 'conversation') {
                await loadConversations();
            } else if (targetType === 'knowledge_basis') {
                await loadKnowledge(currentConversationId);
            }
            showToast('置顶操作失败');
        }
    } catch (_) {
        const targetType = String(state.targetType || '').trim();
        if (targetType === 'conversation') {
            setConversationPinLocal(state.conversationId, state.pinned);
            await loadConversations();
        } else if (targetType === 'knowledge_basis') {
            setBasisPinLocal(state.title, state.pinned);
            await loadKnowledge(currentConversationId);
        }
        showToast('置顶操作失败');
    } finally {
        pinContextMenuBusy = false;
        if (actionBtn) actionBtn.disabled = false;
    }
}

function bindPinContextMenu() {
    const menu = els.pinContextMenu || document.getElementById('pinContextMenu');
    const actionBtn = els.pinContextMenuAction || document.getElementById('pinContextMenuAction');
    if (!menu || !actionBtn) return;
    if (menu.dataset.bindDone === '1') return;
    menu.dataset.bindDone = '1';

    actionBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await applyPinContextMenuAction();
    });

    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('active')) return;
        if (menu.contains(e.target)) return;
        hidePinContextMenu();
    }, true);

    document.addEventListener('scroll', () => {
        if (menu.classList.contains('active')) hidePinContextMenu();
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('active')) {
            hidePinContextMenu();
        }
    });
}

function normalizeSelectionTextForNotes(raw) {
    let text = String(raw || '');
    if (!text) return '';
    text = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '');

    const lines = text.split('\n');
    const tableLineCount = lines.filter((l) => /\|/.test(String(l || ''))).length;
    const looksLikeMarkdownTable = tableLineCount >= 2 || /^\s*\|[\s:\-|]+\|\s*$/m.test(text);
    const nonEmptyLines = lines.filter((l) => String(l || '').trim().length > 0);
    const shortLineCount = nonEmptyLines.filter((l) => String(l || '').trim().length <= 2).length;
    const shortRatio = nonEmptyLines.length > 0 ? (shortLineCount / nonEmptyLines.length) : 0;

    // 处理“每个字一行”的选区污染（常见于 KaTeX/复杂 DOM 文本复制）
    if (!looksLikeMarkdownTable && nonEmptyLines.length >= 8 && shortRatio >= 0.62) {
        const marker = '\uE001';
        text = text
            .replace(/\n{2,}/g, marker)
            .replace(/\n/g, ' ')
            .replace(new RegExp(marker, 'g'), '\n\n')
            .replace(/[ \t]{2,}/g, ' ');
    }

    return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
}

function bindSourceMarkdown(el, rawText) {
    if (!el) return;
    try {
        el.__sourceMarkdown = String(rawText || '');
        el.dataset.sourceKind = 'markdown';
    } catch (_) {
        // ignore
    }
}

function getKatexAnnotationTex(el) {
    if (!el || !el.querySelector) return '';
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    return ann ? String(ann.textContent || '').trim() : '';
}

function escapeMarkdownTableCell(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n+/g, '<br>')
        .replace(/\|/g, '\\|')
        .trim();
}

function extractMarkdownTableCell(cell, inPre = false) {
    if (!cell) return '';
    const chunks = [];
    Array.from(cell.childNodes || []).forEach((child) => {
        chunks.push(extractSelectionTextFromNode(child, inPre));
    });
    const merged = normalizeSelectionTextForNotes(chunks.join(' ').trim());
    return escapeMarkdownTableCell(merged);
}

function tableRowToMarkdown(row, inPre = false, expectedCols = 0) {
    if (!row || typeof row.querySelectorAll !== 'function') return '';
    const rawCells = Array.from(row.querySelectorAll('th,td'));
    const cells = rawCells.map((cell) => extractMarkdownTableCell(cell, inPre));
    while (expectedCols > 0 && cells.length < expectedCols) cells.push('');
    if (!cells.length) return '';
    return `| ${cells.join(' | ')} |`;
}

function tableElementToMarkdown(tableEl, inPre = false) {
    if (!tableEl || typeof tableEl.querySelectorAll !== 'function') return '';
    const rows = Array.from(tableEl.querySelectorAll('tr')).filter((row) => row && row.querySelector('th,td'));
    if (!rows.length) return '';
    const colCount = rows.reduce((maxCols, row) => {
        const n = row.querySelectorAll('th,td').length;
        return Math.max(maxCols, n);
    }, 0);
    if (!colCount) return '';

    const mdRows = rows.map((row) => tableRowToMarkdown(row, inPre, colCount)).filter(Boolean);
    if (!mdRows.length) return '';
    const sep = `| ${new Array(colCount).fill('---').join(' | ')} |`;
    const out = [mdRows[0], sep, ...mdRows.slice(1)];
    return `\n${out.join('\n')}\n`;
}

function extractSelectionTextFromNode(node, inPre = false) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return '';
    }
    const el = node.nodeType === Node.ELEMENT_NODE ? node : null;
    const tag = el ? String(el.tagName || '').toUpperCase() : '';
    const childText = (nextInPre = inPre) => {
        const children = Array.from(node.childNodes || []);
        let out = '';
        for (const child of children) out += extractSelectionTextFromNode(child, nextInPre);
        return out;
    };

    if (el) {
        if (tag === 'SCRIPT' || tag === 'STYLE') return '';
        if (tag === 'BR') return '\n';

        if (el.classList && el.classList.contains('katex-display')) {
            const tex = getKatexAnnotationTex(el);
            return tex ? `\n$$${tex}$$\n` : '';
        }
        if (el.classList && el.classList.contains('katex')) {
            if (el.closest('.katex-display')) return '';
            const tex = getKatexAnnotationTex(el);
            return tex ? `$${tex}$` : '';
        }
        if (el.classList && (el.classList.contains('katex-html') || el.classList.contains('katex-mathml'))) {
            return '';
        }
        if (tag === 'ANNOTATION' || tag === 'MATH' || tag === 'SEMANTICS') return '';
    }

    if (tag === 'STRONG' || tag === 'B') {
        const inner = childText(inPre).trim();
        return inner ? `**${inner}**` : '';
    }
    if (tag === 'EM' || tag === 'I') {
        const inner = childText(inPre).trim();
        return inner ? `*${inner}*` : '';
    }
    if (tag === 'S' || tag === 'DEL') {
        const inner = childText(inPre).trim();
        return inner ? `~~${inner}~~` : '';
    }
    if (tag === 'CODE' && !inPre) {
        const inner = childText(true).replace(/\n+/g, ' ').trim();
        return inner ? `\`${inner}\`` : '';
    }
    if (tag === 'PRE') {
        const inner = childText(true).replace(/\n+$/, '');
        return inner ? `\n\`\`\`\n${inner}\n\`\`\`\n` : '';
    }
    if (tag === 'A') {
        const label = childText(inPre).trim();
        const href = String((el && el.getAttribute && el.getAttribute('href')) || '').trim();
        if (label && href) return `[${label}](${href})`;
        return label;
    }
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
        const level = Number(tag.slice(1)) || 1;
        const inner = childText(inPre).trim();
        return inner ? `\n${'#'.repeat(level)} ${inner}\n` : '';
    }
    if (tag === 'BLOCKQUOTE') {
        const inner = childText(inPre).trim();
        if (!inner) return '';
        return `${inner.split('\n').map((line) => `> ${line}`).join('\n')}\n`;
    }
    if (tag === 'LI') {
        const inner = childText(inPre).trim();
        return inner ? `- ${inner}\n` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
        const inner = childText(inPre).trimEnd();
        return inner ? `${inner}\n` : '';
    }
    if (tag === 'P') {
        const inner = childText(inPre).trim();
        return inner ? `${inner}\n\n` : '';
    }
    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
        const inner = childText(inPre);
        return inner ? `${inner}\n` : '';
    }
    if (tag === 'TH' || tag === 'TD') {
        return extractMarkdownTableCell(el, inPre);
    }
    if (tag === 'TR') {
        const row = tableRowToMarkdown(el, inPre);
        return row ? `${row}\n` : '';
    }
    if (tag === 'TABLE') {
        const tableMd = tableElementToMarkdown(el, inPre);
        return tableMd || '';
    }
    if (tag === 'THEAD' || tag === 'TBODY') {
        const pseudoTable = document.createElement('table');
        pseudoTable.appendChild(el.cloneNode(true));
        const tableMd = tableElementToMarkdown(pseudoTable, inPre);
        return tableMd || '';
    }

    return childText(inPre);
}

function getSelectionTextForNotes(sel) {
    const selection = sel || (window.getSelection ? window.getSelection() : null);
    if (!selection || selection.rangeCount === 0) return '';
    const parts = [];
    for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        if (!range || range.collapsed) continue;
        const frag = range.cloneContents();
        const fragmentText = extractSelectionTextFromNode(frag, false);
        if (fragmentText && fragmentText.trim()) {
            parts.push(fragmentText);
            continue;
        }
        const plain = String(range.toString() || '').trim();
        if (plain) parts.push(plain);
    }
    return normalizeSelectionTextForNotes(parts.join('\n').trim());
}

function addNoteItemFromSelection(selectionText, sourceMeta = {}) {
    const text = normalizeSelectionTextForNotes(selectionText);
    if (!text) return;
    const source = sourceMeta && sourceMeta.source ? String(sourceMeta.source) : '聊天';
    const sourceTitle = sourceMeta && sourceMeta.sourceTitle ? String(sourceMeta.sourceTitle) : '';
    const anchor = normalizeNoteAnchor(sourceMeta && sourceMeta.anchor ? sourceMeta.anchor : null);
    const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        notebookId: String(notesState.activeNotebookId || NOTES_DEFAULT_NOTEBOOK_ID),
        text,
        source,
        sourceTitle,
        anchor,
        ts: Math.floor(Date.now() / 1000)
    };
    notesState.items = [item, ...(Array.isArray(notesState.items) ? notesState.items : [])];
    saveNotesToStorage();
    renderNotesList();
    showToast('已添加到笔记');
}

function getCurrentSelectionForNotes() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return { text: '', sourceMeta: null };
    const text = getSelectionTextForNotes(sel);
    if (!text) return { text: '', sourceMeta: null };
    const plainText = getSelectionPlainTextForNotes(sel);
    const node = sel.anchorNode || sel.focusNode;
    if (!isTargetInsideSelectableArea(node)) return { text: '', sourceMeta: null };
    return {
        text,
        sourceMeta: resolveSelectionSource(node, text, plainText)
    };
}

function loadNotesMobilePanelPosition() {
    try {
        const raw = localStorage.getItem(NOTES_PANEL_LAYOUT_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            const left = Number(obj && obj.left);
            const top = Number(obj && obj.top);
            const width = Number(obj && obj.width);
            const height = Number(obj && obj.height);
            if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)) {
                return { left, top, width, height };
            }
        }
    } catch (_) {
        // ignore
    }
    try {
        const rawLegacy = localStorage.getItem(NOTES_MOBILE_PANEL_POS_KEY);
        if (!rawLegacy) return null;
        const obj = JSON.parse(rawLegacy);
        const left = Number(obj && obj.left);
        const top = Number(obj && obj.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        return { left, top, width: null, height: null };
    } catch (_) {
        return null;
    }
}

function saveNotesMobilePanelPosition(left, top, width, height) {
    try {
        localStorage.setItem(NOTES_PANEL_LAYOUT_KEY, JSON.stringify({
            left: Math.round(Number(left || 0)),
            top: Math.round(Number(top || 0)),
            width: Math.round(Number(width || 0)),
            height: Math.round(Number(height || 0))
        }));
    } catch (_) {
        // ignore
    }
}

function getNotesPanelDefaultLayout(panel) {
    const p = panel || (els.notesPanel || document.getElementById('notesPanel'));
    const vw = Math.max(320, Number(window.innerWidth || 0));
    const vh = Math.max(320, Number(window.innerHeight || 0));
    const isMobile = isChatMobileLayout();
    const width = isMobile ? Math.min(380, Math.round(vw * 0.92)) : 360;
    const height = isMobile ? Math.min(520, Math.round(vh * 0.56)) : Math.min(560, Math.round(vh * 0.62));
    const top = isMobile ? Math.max(8, 62 + (window.visualViewport ? Math.max(0, window.visualViewport.offsetTop || 0) : 0)) : 78;
    const left = Math.max(8, vw - width - (isMobile ? 8 : 20));
    return {
        left,
        top,
        width: width || (p ? p.offsetWidth : 320) || 320,
        height: height || (p ? p.offsetHeight : 420) || 420
    };
}

function clampNotesMobilePanelPosition(left, top, panel, widthOverride, heightOverride) {
    const p = panel || (els.notesPanel || document.getElementById('notesPanel'));
    const d = getNotesPanelDefaultLayout(p);
    const vw = Math.max(320, Number(window.innerWidth || 0));
    const vh = Math.max(320, Number(window.innerHeight || 0));
    const margin = 8;
    const minWidth = isChatMobileLayout() ? 240 : 280;
    const minHeight = 220;
    const maxWidth = Math.max(minWidth, vw - margin * 2);
    const maxHeight = Math.max(minHeight, vh - margin * 2);

    const widthRaw = Number(widthOverride != null ? widthOverride : (notesMobilePanelState.width != null ? notesMobilePanelState.width : d.width));
    const heightRaw = Number(heightOverride != null ? heightOverride : (notesMobilePanelState.height != null ? notesMobilePanelState.height : d.height));
    const width = Math.max(minWidth, Math.min(maxWidth, Number.isFinite(widthRaw) ? widthRaw : d.width));
    const height = Math.max(minHeight, Math.min(maxHeight, Number.isFinite(heightRaw) ? heightRaw : d.height));

    const maxLeft = Math.max(margin, vw - width - margin);
    const maxTop = Math.max(margin, vh - height - margin);
    const safeLeft = Math.max(margin, Math.min(maxLeft, Number.isFinite(Number(left)) ? Number(left) : d.left));
    const safeTop = Math.max(margin, Math.min(maxTop, Number.isFinite(Number(top)) ? Number(top) : d.top));
    return { left: safeLeft, top: safeTop, width, height };
}

function applyNotesMobilePanelPosition(options = {}) {
    const panel = els.notesPanel || document.getElementById('notesPanel');
    if (!panel) return;
    const forceDefault = !!(options && options.forceDefault);
    if (forceDefault || notesMobilePanelState.left == null || notesMobilePanelState.top == null || notesMobilePanelState.width == null || notesMobilePanelState.height == null) {
        const saved = !forceDefault ? loadNotesMobilePanelPosition() : null;
        if (saved) {
            notesMobilePanelState.left = Number(saved.left);
            notesMobilePanelState.top = Number(saved.top);
            notesMobilePanelState.width = Number(saved.width);
            notesMobilePanelState.height = Number(saved.height);
        } else {
            const d = getNotesPanelDefaultLayout(panel);
            notesMobilePanelState.left = d.left;
            notesMobilePanelState.top = d.top;
            notesMobilePanelState.width = d.width;
            notesMobilePanelState.height = d.height;
        }
    }

    const rect = clampNotesMobilePanelPosition(
        notesMobilePanelState.left,
        notesMobilePanelState.top,
        panel,
        notesMobilePanelState.width,
        notesMobilePanelState.height
    );
    notesMobilePanelState.left = rect.left;
    notesMobilePanelState.top = rect.top;
    notesMobilePanelState.width = rect.width;
    notesMobilePanelState.height = rect.height;

    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}

function bindNotesPanelMobileDrag() {
    if (notesMobilePanelState.bound) return;
    notesMobilePanelState.bound = true;
    const panel = els.notesPanel || document.getElementById('notesPanel');
    const head = (els.notesPanelHead || document.querySelector('#notesPanel .notes-panel-head'));
    const resizeHandle = els.notesResizeHandle || document.getElementById('notesResizeHandle');
    if (!panel || !head) return;

    const stopInteract = () => {
        if (!notesMobilePanelState.dragging && !notesMobilePanelState.resizing) return;
        notesMobilePanelState.dragging = false;
        notesMobilePanelState.resizing = false;
        notesMobilePanelState.pointerId = null;
        saveNotesMobilePanelPosition(
            notesMobilePanelState.left,
            notesMobilePanelState.top,
            notesMobilePanelState.width,
            notesMobilePanelState.height
        );
        panel.classList.remove('dragging');
        panel.classList.remove('resizing');
    };

    const onMove = (e) => {
        if (!notesMobilePanelState.dragging && !notesMobilePanelState.resizing) return;
        if (notesMobilePanelState.pointerId != null && e.pointerId !== notesMobilePanelState.pointerId) return;
        const dx = Number(e.clientX || 0) - notesMobilePanelState.startClientX;
        const dy = Number(e.clientY || 0) - notesMobilePanelState.startClientY;

        if (notesMobilePanelState.dragging) {
            const next = clampNotesMobilePanelPosition(
                notesMobilePanelState.startLeft + dx,
                notesMobilePanelState.startTop + dy,
                panel,
                notesMobilePanelState.width,
                notesMobilePanelState.height
            );
            notesMobilePanelState.left = next.left;
            notesMobilePanelState.top = next.top;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            return;
        }

        if (notesMobilePanelState.resizing) {
            const next = clampNotesMobilePanelPosition(
                notesMobilePanelState.left,
                notesMobilePanelState.top,
                panel,
                notesMobilePanelState.startWidth + dx,
                notesMobilePanelState.startHeight + dy
            );
            notesMobilePanelState.width = next.width;
            notesMobilePanelState.height = next.height;
            notesMobilePanelState.left = next.left;
            notesMobilePanelState.top = next.top;
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.width = `${next.width}px`;
            panel.style.height = `${next.height}px`;
        }
    };

    head.addEventListener('pointerdown', (e) => {
        const t = e.target;
        if (t && t.closest('button, a, input, select, textarea, label')) return;
        if (!notesState.open) return;
        notesMobilePanelState.dragging = true;
        notesMobilePanelState.resizing = false;
        notesMobilePanelState.pointerId = e.pointerId;
        notesMobilePanelState.startClientX = Number(e.clientX || 0);
        notesMobilePanelState.startClientY = Number(e.clientY || 0);
        const rect = panel.getBoundingClientRect();
        notesMobilePanelState.startLeft = Number(rect.left || 0);
        notesMobilePanelState.startTop = Number(rect.top || 0);
        panel.classList.add('dragging');
        e.preventDefault();
    });

    if (resizeHandle) {
        resizeHandle.addEventListener('pointerdown', (e) => {
            if (!notesState.open) return;
            notesMobilePanelState.dragging = false;
            notesMobilePanelState.resizing = true;
            notesMobilePanelState.pointerId = e.pointerId;
            notesMobilePanelState.startClientX = Number(e.clientX || 0);
            notesMobilePanelState.startClientY = Number(e.clientY || 0);
            const rect = panel.getBoundingClientRect();
            notesMobilePanelState.startWidth = Number(rect.width || 0);
            notesMobilePanelState.startHeight = Number(rect.height || 0);
            notesMobilePanelState.left = Number(rect.left || 0);
            notesMobilePanelState.top = Number(rect.top || 0);
            panel.classList.add('resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', stopInteract);
    window.addEventListener('pointercancel', stopInteract);
}

function setMobileSelectionAddVisible(visible) {
    const btn = els.mobileSelectionAddBtn || document.getElementById('mobileSelectionAddBtn');
    if (!btn) return;
    if (isChatMobileLayout() && visible) {
        btn.classList.add('active');
        btn.setAttribute('aria-hidden', 'false');
    } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-hidden', 'true');
    }
}

function updateMobileSelectionQuickAdd() {
    if (!isChatMobileLayout()) {
        setMobileSelectionAddVisible(false);
        return;
    }
    const cur = getCurrentSelectionForNotes();
    if (cur.text) {
        notesState.pendingSelectionText = cur.text;
        notesState.pendingSelectionSource = cur.sourceMeta;
        setMobileSelectionAddVisible(true);
        return;
    }
    setMobileSelectionAddVisible(false);
}

function bindNotesContextCapture() {
    if (document.body && document.body.dataset.notesCtxBind === '1') return;
    if (document.body) document.body.dataset.notesCtxBind = '1';

    document.addEventListener('contextmenu', (e) => {
        if (isChatMobileLayout()) {
            hideNotesContextMenu();
            return;
        }
        const target = e.target;
        if (!isTargetInsideSelectableArea(target) || isEditableTarget(target)) {
            hideNotesContextMenu();
            return;
        }
        const sel = window.getSelection ? window.getSelection() : null;
        const text = getSelectionTextForNotes(sel);
        if (!text) {
            hideNotesContextMenu();
            return;
        }
        e.preventDefault();
        const plainText = getSelectionPlainTextForNotes(sel);
        const sourceMeta = resolveSelectionSource(target, text, plainText);
        showNotesContextMenu(Number(e.clientX || 0), Number(e.clientY || 0), text, sourceMeta);
    });

    document.addEventListener('click', (e) => {
        const menu = els.notesContextMenu || document.getElementById('notesContextMenu');
        if (!menu) return;
        if (menu.contains(e.target)) return;
        hideNotesContextMenu();
        updateMobileSelectionQuickAdd();
    }, true);

    document.addEventListener('scroll', () => {
        hideNotesContextMenu();
        updateMobileSelectionQuickAdd();
    }, true);
    document.addEventListener('selectionchange', () => {
        const cur = getCurrentSelectionForNotes();
        if (cur.text) {
            notesState.pendingSelectionText = cur.text;
            notesState.pendingSelectionSource = cur.sourceMeta;
        }
        updateMobileSelectionQuickAdd();
    });
    document.addEventListener('touchend', () => {
        if (!isChatMobileLayout()) return;
        setTimeout(() => updateMobileSelectionQuickAdd(), 60);
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideNotesContextMenu();
            if (!NOTES_COMPANION_MODE && notesState.open) closeNotesPanel();
        }
    });
}

function initNotesUi() {
    void hydrateNotesState();
    bindNotesPanelMobileDrag();
    if (els.closeNotesPanelBtn) {
        els.closeNotesPanelBtn.addEventListener('click', () => closeNotesPanel());
    }
    if (els.openNotesCompanionBtn) {
        if (NOTES_COMPANION_MODE) {
            els.openNotesCompanionBtn.style.display = 'none';
        } else {
            els.openNotesCompanionBtn.style.display = '';
            els.openNotesCompanionBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const ok = await openNotesCompanionWindow();
                if (!ok) {
                    showToast('独立笔记窗口暂不可用，已切换到页面内笔记');
                    openNotesPanel();
                }
            });
        }
    }
    if (els.notesNotebookSelect) {
        els.notesNotebookSelect.addEventListener('change', (e) => {
            const nextId = String(e.target.value || '').trim();
            if (!nextId) return;
            notesState.activeNotebookId = nextId;
            saveNotesToStorage();
            renderNotesList();
        });
    }
    if (els.createNotebookBtn) {
        els.createNotebookBtn.addEventListener('click', () => createNotebook());
    }
    if (els.clearNotebookBtn) {
        els.clearNotebookBtn.addEventListener('click', () => clearActiveNotebook());
    }
    if (els.deleteNotebookBtn) {
        els.deleteNotebookBtn.addEventListener('click', () => deleteActiveNotebook());
    }
    if (els.downloadNotebookBtn) {
        els.downloadNotebookBtn.addEventListener('click', () => downloadActiveNotebook());
    }
    if (els.notesAddSelectionBtn) {
        els.notesAddSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const text = notesState.pendingSelectionText || '';
            const sourceMeta = notesState.pendingSelectionSource || {};
            hideNotesContextMenu();
            if (!text) return;
            addNoteItemFromSelection(text, sourceMeta);
            if (!notesState.open) {
                if (canOpenNotesCompanionWindow()) {
                    void openNotesCompanionWindow();
                } else {
                    openNotesPanel();
                }
            }
        });
    }
    if (els.mobileSelectionAddBtn) {
        els.mobileSelectionAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const cur = getCurrentSelectionForNotes();
            const text = cur.text || notesState.pendingSelectionText || '';
            const sourceMeta = cur.sourceMeta || notesState.pendingSelectionSource || {};
            if (!text) {
                showToast('请先选中文本');
                setMobileSelectionAddVisible(false);
                return;
            }
            addNoteItemFromSelection(text, sourceMeta);
            setMobileSelectionAddVisible(false);
        });
    }
    bindNotesContextCapture();
    updateMobileSelectionQuickAdd();
    renderNotesList();
    if (NOTES_COMPANION_MODE) {
        if (document.body) document.body.classList.add('notes-companion-mode');
        if (els.closeNotesPanelBtn) els.closeNotesPanelBtn.style.display = 'none';
        openNotesPanel();
    }
    if (SETTINGS_COMPANION_MODE) {
        if (document.body) document.body.classList.add('settings-companion-mode');
        void openSettingsModal();
        const syncBounds = () => {
            try {
                const api = window.pywebview && window.pywebview.api;
                if (!api || !api.set_settings_window_bounds) return;
                const w = Number(window.outerWidth || window.innerWidth || 0);
                const h = Number(window.outerHeight || window.innerHeight || 0);
                api.set_settings_window_bounds(w, h);
            } catch (_) {
                // ignore
            }
        };
        let settingsBoundsTimer = null;
        window.addEventListener('resize', () => {
            if (settingsBoundsTimer) clearTimeout(settingsBoundsTimer);
            settingsBoundsTimer = setTimeout(() => {
                settingsBoundsTimer = null;
                syncBounds();
            }, 180);
        });
        syncBounds();
    }
}

function clampImageViewerScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(imageViewerState.maxScale, Math.max(imageViewerState.minScale, n));
}

function applyImageViewerTransform() {
    if (!els.imageViewerImage) return;
    els.imageViewerImage.style.transform = `translate(${imageViewerState.tx}px, ${imageViewerState.ty}px) scale(${imageViewerState.scale})`;
    if (els.imageViewerScaleLabel) {
        els.imageViewerScaleLabel.textContent = `${Math.round(imageViewerState.scale * 100)}%`;
    }
}

function resetImageViewerTransform() {
    imageViewerState.scale = 1;
    imageViewerState.tx = 0;
    imageViewerState.ty = 0;
    imageViewerState.dragging = false;
    if (els.imageViewerViewport) {
        els.imageViewerViewport.classList.remove('dragging');
    }
    applyImageViewerTransform();
}

function closeImageViewer() {
    imageViewerState.active = false;
    imageViewerState.dragging = false;
    if (els.imageViewerBackdrop) {
        els.imageViewerBackdrop.classList.remove('active');
        els.imageViewerBackdrop.setAttribute('aria-hidden', 'true');
    }
    if (els.imageViewerViewport) els.imageViewerViewport.classList.remove('dragging');
    if (els.imageViewerImage) {
        els.imageViewerImage.removeAttribute('src');
        els.imageViewerImage.removeAttribute('alt');
        els.imageViewerImage.style.transform = '';
    }
}

function openImageViewer(url, alt = 'image') {
    const safeUrl = String(url || '').trim();
    if (!safeUrl || !els.imageViewerBackdrop || !els.imageViewerImage) return;
    els.imageViewerImage.src = safeUrl;
    els.imageViewerImage.alt = String(alt || 'image');
    imageViewerState.active = true;
    els.imageViewerBackdrop.classList.add('active');
    els.imageViewerBackdrop.setAttribute('aria-hidden', 'false');
    resetImageViewerTransform();
}

function zoomImageViewer(factor) {
    if (!imageViewerState.active) return;
    const next = clampImageViewerScale(imageViewerState.scale * Number(factor || 1));
    imageViewerState.scale = next;
    applyImageViewerTransform();
}

function bindImageViewerEvents() {
    if (!els.imageViewerBackdrop || els.imageViewerBackdrop.dataset.bindDone === '1') return;
    els.imageViewerBackdrop.dataset.bindDone = '1';

    if (els.imageViewerClose) {
        els.imageViewerClose.addEventListener('click', closeImageViewer);
    }
    if (els.imageViewerReset) {
        els.imageViewerReset.addEventListener('click', resetImageViewerTransform);
    }
    if (els.imageViewerZoomIn) {
        els.imageViewerZoomIn.addEventListener('click', () => zoomImageViewer(1.2));
    }
    if (els.imageViewerZoomOut) {
        els.imageViewerZoomOut.addEventListener('click', () => zoomImageViewer(1 / 1.2));
    }
    els.imageViewerBackdrop.addEventListener('click', (e) => {
        if (e.target === els.imageViewerBackdrop) closeImageViewer();
    });

    if (els.imageViewerViewport) {
        els.imageViewerViewport.addEventListener('wheel', (e) => {
            if (!imageViewerState.active) return;
            e.preventDefault();
            if (e.deltaY < 0) zoomImageViewer(1.08);
            else zoomImageViewer(1 / 1.08);
        }, { passive: false });

        els.imageViewerViewport.addEventListener('mousedown', (e) => {
            if (!imageViewerState.active) return;
            imageViewerState.dragging = true;
            imageViewerState.dragStartX = e.clientX - imageViewerState.tx;
            imageViewerState.dragStartY = e.clientY - imageViewerState.ty;
            els.imageViewerViewport.classList.add('dragging');
        });

        window.addEventListener('mousemove', (e) => {
            if (!imageViewerState.active || !imageViewerState.dragging) return;
            imageViewerState.tx = e.clientX - imageViewerState.dragStartX;
            imageViewerState.ty = e.clientY - imageViewerState.dragStartY;
            applyImageViewerTransform();
        });

        window.addEventListener('mouseup', () => {
            if (!imageViewerState.dragging) return;
            imageViewerState.dragging = false;
            if (els.imageViewerViewport) els.imageViewerViewport.classList.remove('dragging');
        });
    }

    document.addEventListener('keydown', (e) => {
        if (!imageViewerState.active) return;
        if (e.key === 'Escape') closeImageViewer();
        else if (e.key === '+') zoomImageViewer(1.2);
        else if (e.key === '-') zoomImageViewer(1 / 1.2);
        else if (e.key === '0') resetImageViewerTransform();
    });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    if (NOTES_COMPANION_MODE) {
        return;
    }
    if (SETTINGS_COMPANION_MODE) {
        return;
    }
    loadModels();
    loadConversations();
    
    // Check URL param for conversation ID
    const urlParams = new URLSearchParams(window.location.search);
    const cid = urlParams.get('cid');
    const shouldRestoreMailView = isMailViewUrl() && !!document.getElementById('toggleMailView');
    if (shouldRestoreMailView) {
        setTimeout(() => openMailPlaceholderView(), 0);
    } else if (cid) {
        loadConversation(cid);
    } else {
        applyTokenMiniDisplay(0, 0);
        tokenBudgetState.roundInput = 0;
        renderTokenBudgetUi();
        // Init load knowledge even without conversation
        loadKnowledge(null);
    }
});

function initUI() {
    captureChatHeaderBaseState();
    bindImageViewerEvents();
    bindToolsModeDropdown();
    bindMobileHeaderMenu();
    initNotesUi();
    renderTokenBudgetUi();
    if (NOTES_COMPANION_MODE) {
        return;
    }
    bindPinContextMenu();
    mailViewState.sidebarCollapsed = loadMailSidebarCollapsedState();
    mailNotifyState.lastOpenTs = loadMailLastOpenTs();
    mailNotifyState.initialized = mailNotifyState.lastOpenTs > 0;
    mailNotifyState.newCount = 0;
    renderMailNotifyBadge();
    if (document.getElementById('toggleMailView')) {
        startMailPolling();
    }
    startClientToolPolling();
    startAgentStatusPolling(); // Agent WSS
    window.addEventListener('beforeunload', () => {
        stopMailPolling();
        stopClientToolPolling();
        if (agentStatusPollTimer) clearInterval(agentStatusPollTimer);
        if (notesCloudSyncTimer) {
            clearTimeout(notesCloudSyncTimer);
            notesCloudSyncTimer = null;
        }
        if (notesCloudSyncPendingStore) {
            // 页面关闭前尽量触发一次异步提交；浏览器可能中断请求，后续仍会以云端为准。
            void flushNotesCloudSync();
        }
    });
    window.addEventListener('resize', () => {
        if (!isChatMobileLayout()) {
            closeMobileHeaderMenu();
        } else {
            positionMobileHeaderMenuPanel();
        }
        if (notesState.open) {
            applyNotesMobilePanelPosition();
        } else if (!isChatMobileLayout()) {
            const panel = els.notesPanel || document.getElementById('notesPanel');
            if (panel) {
                panel.style.left = '';
                panel.style.top = '';
                panel.style.right = '';
                panel.style.bottom = '';
            }
        }
        updateMobileSelectionQuickAdd();
        if (!isMailMobileLayout()) {
            setMailMobileDetailMode(false);
        }
    });
    // Event Listeners
    if(els.sendBtn) els.sendBtn.addEventListener('click', sendMessage);
    
    // File Input
    if(els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    if (els.cancelFileUploadBtn) {
        els.cancelFileUploadBtn.addEventListener('click', () => {
            cancelCurrentFileUpload();
        });
    }
    bindGlobalFileDropUpload();
    
    if(els.messageInput) {
        els.messageInput.addEventListener('compositionstart', () => {
            isMessageInputComposing = true;
        });
        els.messageInput.addEventListener('compositionend', () => {
            isMessageInputComposing = false;
        });
        els.messageInput.addEventListener('paste', async (e) => {
            const pastedFiles = extractFilesFromClipboardEvent(e);
            if (!pastedFiles.length) return;
            e.preventDefault();
            await handleFileUploadFiles(pastedFiles, { source: 'paste', clearInput: false });
        });

        // Mobile fallback: if tap failed to focus textarea, recover once without moving caret.
        els.messageInput.addEventListener('touchend', () => {
            if (!isChatMobileLayout()) return;
            setTimeout(() => {
                ensureMessageInputFocus({ onlyIfBlurred: true, preserveSelection: true });
            }, 30);
        }, { passive: true });

        els.messageInput.addEventListener('keydown', (e) => {
            if ((e.isComposing || isMessageInputComposing) && e.key === 'Enter') {
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        // Auto-resize textarea
        els.messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto'; // Reset
        });
    }

    if (els.knowledgeSearchInput) {
        els.knowledgeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleKnowledgeSearch();
            }
        });
    }
    if (els.knowledgeSearchBtn) {
        els.knowledgeSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleKnowledgeSearch();
        });
    }
    if (els.cloudFileSearchInput) {
        els.cloudFileSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                loadCloudFiles();
            }
        });
    }
    if (els.cloudFileSearchBtn) {
        els.cloudFileSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadCloudFiles();
        });
    }
    const bulkBtn = document.getElementById('bulkVectorizeBtn');
    if (bulkBtn) {
        bulkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            bulkVectorizeAllBasis();
        });
    }

    // Auto-scroll logic
    if (els.messagesContainer) {
        // [Optimization] Immediate manual override listeners
        // This ensures that any user interaction immediately disables auto-scroll
        // providing a "crisp" detachment feeling like standard native apps.
        const breakAutoScroll = () => { shouldAutoScroll = false; };
        
        els.messagesContainer.addEventListener('wheel', (e) => {
            if (e.deltaY < 0) breakAutoScroll(); // Only on scroll up
        }, { passive: true });
        
        els.messagesContainer.addEventListener('touchmove', breakAutoScroll, { passive: true });

        els.messagesContainer.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = els.messagesContainer;
            const distance = scrollHeight - scrollTop - clientHeight;
            
            // [Optimization] Ultra-tight threshold (2px)
            // Only latch if we are practically at the very bottom.
            // This prevents the "rubber band" effect when dragging slightly up.
            if (distance <= 2) {
                shouldAutoScroll = true;
            } else {
                shouldAutoScroll = false;
            }
        });

        // Hover proxy: 鼠标在容器内时，按纵向位置匹配最近消息，显示该条操作栏
        els.messagesContainer.addEventListener('mousemove', (e) => {
            updateHoverProxyFromClientY(e.clientY);
        });
        els.messagesContainer.addEventListener('mouseenter', (e) => {
            updateHoverProxyFromClientY(e.clientY);
        });
        els.messagesContainer.addEventListener('mouseleave', () => {
            clearHoverProxyMessage();
        });
    }

    // Sidebar Toggles (desktop/mobile header buttons are bound in rebindHeaderActionButtons)
    const mobileToggle = document.getElementById('toggleSidebarMobile');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            toggleMobileSidebar();
        });
    }

    // Knowledge Panel
    const toggleKP = () => toggleKnowledgePanel();
    if (els.btnTogglePanel) els.btnTogglePanel.addEventListener('click', closeKnowledgePanel);
    if(els.btnToggleFilePanel) els.btnToggleFilePanel.addEventListener('click', (e) => {
        e.preventDefault();
        closeCloudFilePanel();
    });

    if(els.refreshKnowledgeBtn) {
        els.refreshKnowledgeBtn.addEventListener('click', () => loadKnowledge(currentConversationId));
    }
    if (els.refreshCloudFilesBtn) {
        els.refreshCloudFilesBtn.addEventListener('click', () => loadCloudFiles());
    }

    // New Chat
    if(els.newChatBtn) els.newChatBtn.addEventListener('click', () => createNewConversation());

// 说明
    if(els.tokenDisplay) els.tokenDisplay.addEventListener('click', openTokenModal);
    if(els.closeModalBtn) els.closeModalBtn.addEventListener('click', () => els.tokenModal.classList.remove('active'));
    if (els.tokenModal) bindBackdropSafeClose(els.tokenModal, () => els.tokenModal.classList.remove('active'));

    // User Menu & Admin
    if (els.usernameBtn) {
        els.usernameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            els.userMenu.classList.toggle('active');
            if (els.userMenu.classList.contains('active')) {
                checkUserRole(); // 说明
            }
        });
    }

    // Prevent menu from closing when clicking inside it
    if (els.userMenu) {
        els.userMenu.addEventListener('click', (e) => {
// 说明
        });
        
        // 点击菜单项后臊关闭
        els.userMenu.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                els.userMenu.classList.remove('active');
            });
        });
    }

    document.addEventListener('click', (e) => {
        if(els.userMenu) els.userMenu.classList.remove('active');
        const mobileHeaderMenu = document.getElementById('mobileHeaderMenu') || els.mobileHeaderMenu;
        if (mobileHeaderMenu && !mobileHeaderMenu.contains(e.target)) {
            closeMobileHeaderMenu();
        }

        // Mobile: tap blank area to close sidebar / knowledge panel
        if (isChatMobileLayout()) {
            const target = e.target;
            if (target && target.closest && target.closest('.modal-backdrop')) {
                return;
            }
            const mobileToggleBtn = document.getElementById('toggleSidebarMobile');

            if (els.sidebar && els.sidebar.classList.contains('mobile-open')) {
                const clickInSidebar = els.sidebar.contains(target);
                const clickOnToggle = (els.toggleSidebar && els.toggleSidebar.contains(target)) ||
                    (mobileToggleBtn && mobileToggleBtn.contains(target));
                if (!clickInSidebar && !clickOnToggle) {
                    closeMobileSidebar();
                }
            }

            if (els.knowledgePanel && els.knowledgePanel.classList.contains('visible')) {
                const clickInPanel = els.knowledgePanel.contains(target);
                const clickOnToggle = (els.toggleKnowledgePanel && els.toggleKnowledgePanel.contains(target)) ||
                    (els.btnTogglePanel && els.btnTogglePanel.contains(target));
                if (!clickInPanel && !clickOnToggle) {
                    closeKnowledgePanel();
                }
            }

            if (els.filePanel && els.filePanel.classList.contains('visible')) {
                const clickInPanel = els.filePanel.contains(target);
                const clickOnToggle = (els.toggleFilePanel && els.toggleFilePanel.contains(target)) ||
                    (els.btnToggleFilePanel && els.btnToggleFilePanel.contains(target));
                if (!clickInPanel && !clickOnToggle) {
                    closeCloudFilePanel();
                }
            }
        }
    });

    // Check user role and show admin menu if needed
    checkUserRole();
    rebindHeaderActionButtons();

    // Settings button click
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (els.userMenu) els.userMenu.classList.remove('active');
            openSettingsModal();
        });
    }

    // 添加用户 Modal 相馆
    const openAddUserBtn = document.getElementById('openAddUserForm'); 
    if (openAddUserBtn) {
        openAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openAddUserModal();
        });
    }

    const cancelAddUserBtn = document.getElementById('cancelAddUser');
    if (cancelAddUserBtn) {
        cancelAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAddUserModal();
        });
    }
    
// 说明
    const addUserModal = document.getElementById('addUserModal');
    if (addUserModal) {
        bindBackdropSafeClose(addUserModal, closeAddUserModal);
    }
    
// 说明
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (els.tokenModal) els.tokenModal.classList.remove('active');
        });
    }

    // Admin modal removed; admin features are merged into settings tabs.

    const submitAddUserBtn = document.getElementById('addUserBtn');
    if (submitAddUserBtn) {
        submitAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            submitAddUser();
        });
    }

    const adminUserFilterInput = document.getElementById('adminUserFilterInput');
    if (adminUserFilterInput) {
        adminUserFilterInput.addEventListener('input', (e) => {
            adminUserFilterKeyword = (e.target.value || '').trim().toLowerCase();
            renderAdminUsersList();
        });
    }
    const openAddMailUserBtn = document.getElementById('openAddMailUserForm');
    if (openAddMailUserBtn) {
        openAddMailUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            renderAdminMailCreateForm();
        });
    }
    const adminMailUserFilterInput = document.getElementById('adminMailUserFilterInput');
    if (adminMailUserFilterInput) {
        adminMailUserFilterInput.addEventListener('input', (e) => {
            adminMailUserFilterKeyword = (e.target.value || '').trim().toLowerCase();
            renderAdminMailUsersList();
        });
    }
    const adminMailGroupSelect = document.getElementById('adminMailGroupSelect');
    if (adminMailGroupSelect) {
        adminMailGroupSelect.addEventListener('change', async (e) => {
            adminMailGroup = (e.target.value || 'default').trim() || 'default';
            await loadAdminMailUsersList();
        });
    }

    const saveProfileBtn = document.getElementById('saveProfileBtn');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => saveUserProfile());
    }

    const avatarUploadBtn = document.getElementById('settingsAvatarUploadBtn');
    const avatarFileInput = document.getElementById('settingsAvatarFileInput');
    if (avatarUploadBtn && avatarFileInput) {
        avatarUploadBtn.addEventListener('click', () => avatarFileInput.click());
        avatarFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) openAvatarCropModal(file);
            e.target.value = '';
        });
    }

    const closeAvatarCropBtn = document.getElementById('closeAvatarCropBtn');
    if (closeAvatarCropBtn) {
        closeAvatarCropBtn.addEventListener('click', closeAvatarCropModal);
    }
    const cancelAvatarCropBtn = document.getElementById('cancelAvatarCropBtn');
    if (cancelAvatarCropBtn) {
        cancelAvatarCropBtn.addEventListener('click', closeAvatarCropModal);
    }
    const applyAvatarCropBtn = document.getElementById('applyAvatarCropBtn');
    if (applyAvatarCropBtn) {
        applyAvatarCropBtn.addEventListener('click', applyAvatarCropAndPreview);
    }
    const avatarCropModal = document.getElementById('avatarCropModal');
    if (avatarCropModal) {
        bindBackdropSafeClose(avatarCropModal, closeAvatarCropModal);
    }

    const addProviderBtn = document.getElementById('btnAddProvider');
    if (addProviderBtn) {
        addProviderBtn.addEventListener('click', () => openProviderEditor());
    }

    const addModelBtn = document.getElementById('btnAddModel');
    if (addModelBtn) {
        addModelBtn.addEventListener('click', () => openModelEditor());
    }

    const adminModelSearchInput = document.getElementById('adminModelSearchInput');
    if (adminModelSearchInput) {
        adminModelSearchInput.addEventListener('input', (e) => {
            adminModelSearchKeyword = (e.target.value || '').trim();
            renderAdminModelConfig({ resetModelsScroll: true });
        });
    }

    const textConfirmModal = document.getElementById('adminTextConfirmModal');
    if (textConfirmModal) {
        bindBackdropSafeClose(textConfirmModal, closeAdminTextConfirmModal);
    }

    const configModal = document.getElementById('adminConfigModal');
    if (configModal) {
        bindBackdropSafeClose(configModal, closeAdminConfigModal);
    }
    const configSaveBtn = document.getElementById('adminConfigSaveBtn');
    if (configSaveBtn) {
        configSaveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await saveAdminConfigModal();
        });
    }
}

function safeTokenInt(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}

function normalizeContextWindow(v) {
    const n = safeTokenInt(v);
    if (n < 1024) return 0;
    return Math.min(4000000, n);
}

function inferContextWindowByModelName(meta = {}) {
    const merged = `${String(meta.id || '')} ${String(meta.name || '')}`.toLowerCase();
    const kMatch = merged.match(/(?:^|[^0-9])(\d{2,4})k(?:[^0-9]|$)/);
    if (kMatch && kMatch[1]) {
        const k = safeTokenInt(kMatch[1]);
        if (k >= 16) return k * 1000;
    }
    return TOKEN_BUDGET_DEFAULT_LIMIT;
}

function resolveContextWindowForModel(modelId) {
    const meta = getModelMeta(modelId) || {};
    const explicit = normalizeContextWindow(
        meta.contextWindow != null ? meta.contextWindow
            : (meta.context_window != null ? meta.context_window : 0)
    );
    if (explicit > 0) {
        return { limit: explicit, estimated: false };
    }
    return { limit: inferContextWindowByModelName(meta), estimated: true };
}

function renderTokenBudgetUi() {
    const ring = els.tokenBudgetRing || document.getElementById('tokenBudgetRing');
    const usage = els.tokenBudgetUsage || document.getElementById('tokenBudgetUsage');
    const mini = els.tokenBudgetMini || document.getElementById('tokenBudgetMini');
    if (!ring || !usage || !mini) return;

    const limit = Math.max(1, normalizeContextWindow(tokenBudgetState.contextWindow) || TOKEN_BUDGET_DEFAULT_LIMIT);
    const used = safeTokenInt(tokenBudgetState.roundInput);
    const ratioRaw = used / limit;
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    const angle = Math.round(ratio * 360);

    let color = '#22c55e';
    if (ratioRaw >= 0.8) color = '#ef4444';
    else if (ratioRaw >= 0.6) color = '#f59e0b';

    mini.style.setProperty('--tb-color', color);
    mini.style.setProperty('--tb-angle', `${angle}deg`);
    usage.style.color = color;

    const remain = Math.max(0, limit - used);
    const prefix = tokenBudgetState.estimated ? '~' : '';
    usage.textContent = `CTX ${prefix}${used.toLocaleString()}/${limit.toLocaleString()}`;
    mini.title = `上下文窗口已用 ${Math.round(ratioRaw * 100)}% · 剩余 ${remain.toLocaleString()} tokens${tokenBudgetState.estimated ? '（估算上限）' : ''}`;
}

function updateTokenBudgetContextFromSelectedModel() {
    const ctx = resolveContextWindowForModel(selectedModelId);
    tokenBudgetState.contextWindow = ctx.limit;
    tokenBudgetState.estimated = !!ctx.estimated;
    renderTokenBudgetUi();
}

function updateTokenBudgetRoundInput(inputTokens) {
    const n = safeTokenInt(inputTokens);
    if (n <= 0) return;
    if (n > tokenBudgetState.roundInput) {
        tokenBudgetState.roundInput = n;
        renderTokenBudgetUi();
    }
}

function estimateTokenBudgetUsedFromConversationMessages(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    if (!arr.length) return 0;
    const assistantIo = [];
    arr.forEach((msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (String(msg.role || '').trim() !== 'assistant') return;
        const md = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
        const io = (md.io_tokens && typeof md.io_tokens === 'object') ? md.io_tokens : {};
        const inTok = safeTokenInt(io.input);
        const outTok = safeTokenInt(io.output);
        if (inTok <= 0 && outTok <= 0) return;
        assistantIo.push({ inTok, outTok });
    });
    if (!assistantIo.length) return 0;
    const lastInput = safeTokenInt(assistantIo[assistantIo.length - 1].inTok);
    let historyOutput = 0;
    for (let i = 0; i < assistantIo.length - 1; i += 1) {
        historyOutput += safeTokenInt(assistantIo[i].outTok);
    }
    return safeTokenInt(lastInput + historyOutput);
}

function applyTokenBudgetFromConversationMessages(messages) {
    const est = estimateTokenBudgetUsedFromConversationMessages(messages);
    tokenBudgetState.roundInput = est;
    renderTokenBudgetUi();
}

function buildModelBadgeText(modelName, searchFlag, inputTokens, outputTokens) {
    const model = String(modelName || '-').trim() || '-';
    const search = (typeof searchFlag === 'boolean') ? String(searchFlag) : String(searchFlag || 'unknown');
    const input = safeTokenInt(inputTokens).toLocaleString();
    const output = safeTokenInt(outputTokens).toLocaleString();
    return `${model} - search: ${search} - I/O: ${input}/${output}`;
}

function ensureMessageModelBadge(messageDiv) {
    if (!messageDiv) return null;
    const content = messageDiv.querySelector('.message-content');
    if (!content) return null;
    let badge = content.querySelector('.model-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'model-badge';
        content.appendChild(badge);
    }
    return badge;
}

function updateMessageModelBadge(messageDiv, state = {}) {
    if (!messageDiv) return;
    const badge = ensureMessageModelBadge(messageDiv);
    if (!badge) return;
    const nextState = {
        modelName: String((state && state.modelName) || ''),
        searchFlag: (state && Object.prototype.hasOwnProperty.call(state, 'searchFlag')) ? state.searchFlag : 'unknown',
        inputTokens: safeTokenInt(state && state.inputTokens),
        outputTokens: safeTokenInt(state && state.outputTokens)
    };
    messageDiv.__modelBadgeState = nextState;
    badge.textContent = buildModelBadgeText(
        nextState.modelName,
        nextState.searchFlag,
        nextState.inputTokens,
        nextState.outputTokens
    );
}

function applyUsageChunkToBadgeState(usageState, chunk) {
    if (!usageState || typeof usageState !== 'object') return;
    const inTokens = safeTokenInt(chunk && chunk.input_tokens);
    const outTokens = safeTokenInt(chunk && chunk.output_tokens);
    if (!usageState.snapshotInitialized) {
        usageState.input += inTokens;
        usageState.output += outTokens;
        usageState.snapshotInput = inTokens;
        usageState.snapshotOutput = outTokens;
        usageState.snapshotInitialized = true;
        return;
    }
    // 输入与输出快照独立处理，避免某一项回退导致另一项被错误整段重加。
    if (inTokens >= usageState.snapshotInput) {
        usageState.input += (inTokens - usageState.snapshotInput);
    } else {
        usageState.input += inTokens;
    }
    if (outTokens >= usageState.snapshotOutput) {
        usageState.output += (outTokens - usageState.snapshotOutput);
    } else {
        usageState.output += outTokens;
    }
    usageState.snapshotInput = inTokens;
    usageState.snapshotOutput = outTokens;
}

function estimateStreamTokensByText(text) {
    const s = String(text || '');
    if (!s) return 0;
    const nonAscii = (s.match(/[^\x00-\x7F]/g) || []).length;
    const ascii = s.length - nonAscii;
    return Math.max(1, Math.ceil(nonAscii / 1.25 + ascii / 4));
}

function applyTokenMiniDisplay(inputTokens, outputTokens) {
    if (els.totalInputTokens) els.totalInputTokens.textContent = safeTokenInt(inputTokens).toLocaleString();
    if (els.totalOutputTokens) els.totalOutputTokens.textContent = safeTokenInt(outputTokens).toLocaleString();
}

function renderTokenMiniFromState() {
    const inputNow = tokenMiniState.baseInput + tokenMiniState.streamInput;
    const outputStream = Math.max(tokenMiniState.streamOutput, tokenMiniState.estimatedStreamOutput);
    const outputNow = tokenMiniState.baseOutput + outputStream;
    applyTokenMiniDisplay(inputNow, outputNow);
    renderTokenBudgetUi();
}

function resetTokenMiniStreamPart() {
    tokenMiniState.streamInput = 0;
    tokenMiniState.streamOutput = 0;
    tokenMiniState.estimatedStreamOutput = 0;
    tokenMiniState.usageSnapshotInput = 0;
    tokenMiniState.usageSnapshotOutput = 0;
    tokenMiniState.usageSnapshotInitialized = false;
}

function beginTokenMiniStreaming() {
    tokenMiniState.streaming = true;
    tokenMiniState.conversationId = currentConversationId || null;
    resetTokenMiniStreamPart();
    tokenBudgetState.roundInput = 0;
    renderTokenMiniFromState();
}

function noteTokenMiniConversationId(conversationId) {
    const cid = conversationId ? String(conversationId) : null;
    if (!cid) return;
    if (!tokenMiniState.conversationId) {
        tokenMiniState.conversationId = cid;
    }
}

function onTokenStreamTextChunk(content) {
    if (!tokenMiniState.streaming) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(content);
    renderTokenMiniFromState();
}

function onTokenStreamReasoningChunk(content) {
    if (!tokenMiniState.streaming) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(content);
    renderTokenMiniFromState();
}

function onTokenStreamToolArgsChunk(content) {
    if (!tokenMiniState.streaming) return;
    const s = String(content || '');
    if (!s) return;
    tokenMiniState.estimatedStreamOutput += estimateStreamTokensByText(s);
    renderTokenMiniFromState();
}

function onTokenStreamUsageChunk(chunk) {
    if (!tokenMiniState.streaming) return;
    const inTokens = safeTokenInt(chunk && chunk.input_tokens);
    const outTokens = safeTokenInt(chunk && chunk.output_tokens);
    updateTokenBudgetRoundInput(inTokens);

    if (!tokenMiniState.usageSnapshotInitialized) {
        tokenMiniState.streamInput += inTokens;
        tokenMiniState.streamOutput += outTokens;
        tokenMiniState.usageSnapshotInput = inTokens;
        tokenMiniState.usageSnapshotOutput = outTokens;
        tokenMiniState.usageSnapshotInitialized = true;
        renderTokenMiniFromState();
        return;
    }

    // 输入与输出快照独立处理，避免 output 回退时把 input 也误当成整段增量。
    if (inTokens >= tokenMiniState.usageSnapshotInput) {
        tokenMiniState.streamInput += (inTokens - tokenMiniState.usageSnapshotInput);
    } else {
        tokenMiniState.streamInput += inTokens;
    }
    if (outTokens >= tokenMiniState.usageSnapshotOutput) {
        tokenMiniState.streamOutput += (outTokens - tokenMiniState.usageSnapshotOutput);
    } else {
        tokenMiniState.streamOutput += outTokens;
    }

    tokenMiniState.usageSnapshotInput = inTokens;
    tokenMiniState.usageSnapshotOutput = outTokens;
    renderTokenMiniFromState();
}

async function refreshTokenMiniForConversation(conversationId, options = {}) {
    const { keepStreamPart = false } = options;
    const cid = conversationId ? String(conversationId) : '';

    tokenMiniState.conversationId = cid || null;
    if (!keepStreamPart) resetTokenMiniStreamPart();

    if (!cid) {
        tokenMiniState.baseInput = 0;
        tokenMiniState.baseOutput = 0;
        if (!keepStreamPart) tokenBudgetState.roundInput = 0;
        renderTokenMiniFromState();
        return;
    }

    const reqId = ++tokenMiniState.requestSeq;
    try {
        const res = await fetch(`/api/tokens/stats?conversation_id=${encodeURIComponent(cid)}`);
        const data = await res.json();
        if (reqId !== tokenMiniState.requestSeq) return;
        if (!data || !data.success) return;
        tokenMiniState.baseInput = safeTokenInt(data.input_total);
        tokenMiniState.baseOutput = safeTokenInt(data.output_total);
        renderTokenMiniFromState();
    } catch (e) {
        console.error('Error loading conversation token stats', e);
    }
}

async function finishTokenMiniStreaming() {
    tokenMiniState.streaming = false;
    const cid = currentConversationId || tokenMiniState.conversationId;
    await refreshTokenMiniForConversation(cid, { keepStreamPart: false });
}

async function openTokenModal() {
    if(!els.tokenModal) return;
    els.tokenModal.classList.add('active');
    
    try {
        const res = await fetch('/api/tokens/stats');
        const data = await res.json();
        if(data.success) {
            if(els.modalTotalTokens) els.modalTotalTokens.textContent = data.total.toLocaleString();
            if(els.modalTodayTokens) els.modalTodayTokens.textContent = (data.today || 0).toLocaleString();
            
            // 渲染历史日志
            const logsTableBody = document.getElementById('tokenLogsTableBody');
            if (logsTableBody && data.history) {
                logsTableBody.innerHTML = data.history.map(log => {
                    const inTokens = Number(log.input_tokens || 0);
                    const outTokens = Number(log.output_tokens || 0);
                    const total = Number(log.total_tokens ?? (inTokens + outTokens));
                    const timeStr = log.timestamp ? log.timestamp.split(' ')[1] || log.timestamp : '-';
                    const dateStr = log.timestamp ? log.timestamp.split(' ')[0] : '-';
                    return `
                        <tr>
                            <td title="${log.timestamp}">
                                <div style="font-size: 11px; white-space: nowrap;">${dateStr}</div>
                                <div style="font-weight: bold; font-family: 'JetBrains Mono'; color: #64748b;">${timeStr}</div>
                            </td>
                            <td class="title-cell" title="${log.conversation_title || ''}">
                                <div class="text-truncate">${log.conversation_title || 'Chat Operation'}</div>
                            </td>
                            <td>
                                <span class="action-badge ${log.action}">${(log.action || 'chat').toUpperCase()}</span>
                            </td>
                            <td class="num">
                                <div style="font-size: 10px; color: #94a3b8;">${inTokens}+${outTokens}</div>
                                <div style="font-weight: 800; font-family: 'JetBrains Mono';">${total.toLocaleString()}</div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch(e) { console.error("Error loading token stats", e); }
}

// --- Conversations ---
async function loadConversations() {
    try {
        const res = await fetch('/api/conversations');
        const data = await res.json();
        // Assuming data is array or object with list
// 说明
        // Let's assume list for now or adapt.
        const list = Array.isArray(data) ? data : (data.conversations || []);
        conversationListCache = Array.isArray(list) ? [...list] : [];
        renderConversationList(list);
    } catch (e) {
        console.error("Failed to load conversations", e);
    }
}

function renderConversationList(conversations) {
    if(!els.conversationList) return;
    els.conversationList.innerHTML = '';

    const toUpdatedTs = (raw) => {
        const t = Date.parse(String(raw || ''));
        return Number.isFinite(t) ? t : 0;
    };
    const orderedConversations = Array.isArray(conversations) ? [...conversations] : [];
    orderedConversations.sort((a, b) => {
        const aPin = !!(a && a.pin);
        const bPin = !!(b && b.pin);
        if (aPin !== bPin) return aPin ? -1 : 1;
        return toUpdatedTs((b && b.updated_at) || '') - toUpdatedTs((a && a.updated_at) || '');
    });

    orderedConversations.forEach(c => {
        const div = document.createElement('div');
        const cid = c.conversation_id || c.id; // Handle both
        div.className = `conversation-item ${cid === currentConversationId ? 'active' : ''}`;
        div.dataset.conversationId = String(cid || '');
        const isPinned = !!(c && c.pin);
        div.dataset.pin = isPinned ? '1' : '0';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'title'; // Add class for CSS styling
        if (isPinned) {
            const pinIcon = document.createElement('i');
            pinIcon.className = 'fa-solid fa-thumbtack conversation-pin-icon';
            pinIcon.setAttribute('aria-hidden', 'true');
            titleSpan.appendChild(pinIcon);
        }
        titleSpan.appendChild(document.createTextNode(c.title || c.preview || `Conversation ${cid}`));
        div.appendChild(titleSpan);
        
        div.onclick = () => {
            // 如果当前正在查看知识库详情，先关闭
            if (currentViewingKnowledge) {
                closeKnowledgeView();
            }
            loadConversation(cid);
        };
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showPinContextMenu(e.clientX, e.clientY, {
                targetType: 'conversation',
                conversationId: String(cid || ''),
                pinned: isPinned
            });
        });
        
        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon-small delete-chat';
        delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteConversation(cid);
        };
        div.appendChild(delBtn);
        
        els.conversationList.appendChild(div);
    });
}

async function createNewConversation(silent = false) {
    const viewer = document.getElementById('knowledgeViewer');
    if (viewer && viewer.style.display !== 'none') {
        closeKnowledgeView();
    }
    currentConversationHasImageHistory = false;
    if(!silent) {
        // Clear UI
        currentConversationId = null;
        syncNotesForConversation(null);
        els.messagesContainer.innerHTML = `
            <div class="welcome-screen">
                <h1>Hello.</h1>
                <p>Start a new conversation.</p>
            </div>
        `;
        els.conversationTitle.textContent = 'New Chat';
        tokenMiniState.baseInput = 0;
        tokenMiniState.baseOutput = 0;
        resetTokenMiniStreamPart();
        tokenBudgetState.roundInput = 0;
        applyTokenMiniDisplay(0, 0);
        renderTokenBudgetUi();
        if(window.history.pushState) window.history.pushState({}, '', '/chat');
        
        // Refresh list to remove active state
        loadConversations();
    }
}

async function loadConversation(id) {
    const viewer = document.getElementById('knowledgeViewer');
    // 如果当前在知识/邮件等 viewer 页面，先统一恢复聊天 Header 与布局
    if (viewer && viewer.style.display !== 'none') {
        closeKnowledgeView();
    }

    // 清空导航栈和知识相关状态（直接跳转到新对话）
    navigationStack = [];
    currentSearchQuery = '';
    currentViewingKnowledge = null;
    originalHeaderState = null;
    
    currentConversationId = id;
    syncNotesForConversation(id);
    els.messagesContainer.innerHTML = ''; // Loading state
    tokenMiniState.conversationId = id ? String(id) : null;
    tokenMiniState.baseInput = 0;
    tokenMiniState.baseOutput = 0;
    resetTokenMiniStreamPart();
    tokenBudgetState.roundInput = 0;
    renderTokenMiniFromState();
    
    // Update URL
    if(window.history.pushState) window.history.pushState({}, '', `/chat?cid=${id}`);

    try {
        // Load messages
        const res = await fetch(`/api/conversations/${id}`);
        const data = await res.json();
        
        if (data.success && data.conversation) {
            refreshConversationImageHistoryFlag(data.conversation.messages || []);
            // Render
            renderMessages(data.conversation.messages, false, { instant: true });
            applyTokenBudgetFromConversationMessages(data.conversation.messages || []);
            if(els.conversationTitle) els.conversationTitle.textContent = data.conversation.title || "Conversation " + id;
            await refreshTokenMiniForConversation(id);
        } else {
            currentConversationHasImageHistory = false;
            console.error("Failed to load conversation:", data.message);
            await refreshTokenMiniForConversation(null);
        }
        
        // Update Token Counts (if available in stored data, otherwise calc)
        
        // Load Knowledge
        loadKnowledge(id);
        
        // Highlight in sidebar
        loadConversations(); 
        
    } catch (e) {
        currentConversationHasImageHistory = false;
        console.error("Error loading chat", e);
        await refreshTokenMiniForConversation(null);
    }
}

async function deleteConversation(id) {
    const ok = await confirmModalAsync('删除会话', '确定删除该会话吗？此操作不可撤销。', 'danger');
    if (!ok) return;
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if(currentConversationId === id) createNewConversation();
    loadConversations();
}

// --- Messaging ---
const sendIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const stopIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>`;

function updateSendButtonState() {
    if (!els.sendBtn) return;
    if (isGenerating) {
        els.sendBtn.disabled = false;
        els.sendBtn.classList.add('stop-mode');
        els.sendBtn.innerHTML = stopIcon;
        els.sendBtn.title = "Stop Generation";
    } else if (isUploadingFiles) {
        els.sendBtn.disabled = true;
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.innerHTML = sendIcon;
        els.sendBtn.title = "文件上传/向量化进行中";
    } else {
        els.sendBtn.disabled = false;
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.innerHTML = sendIcon;
        els.sendBtn.title = "Send Message";
    }
}

function messageHasImageAttachments(msg) {
    if (!msg || typeof msg !== 'object') return false;
    const metadata = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : null;
    const attachments = metadata && Array.isArray(metadata.attachments) ? metadata.attachments : [];
    if (!attachments.length) return false;
    return attachments.some((att) => {
        if (!att || typeof att !== 'object') return false;
        const type = String(att.type || '').toLowerCase();
        if (type && type !== 'image') return false;
        const assetId = String(att.asset_id || '').trim();
        const assetUrl = String(att.asset_url || '').trim();
        const url = String(att.url || '').trim();
        if (assetId || assetUrl) return true;
        if (!url) return false;
        if (url.startsWith('data:image/')) return true;
        if (/^https?:\/\//i.test(url)) return true;
        if (/\/api\/conversations\/[^/]+\/assets\/[^/?#]+/i.test(url)) return true;
        return false;
    });
}

function conversationHasImageHistory(messages) {
    if (!Array.isArray(messages) || !messages.length) return false;
    return messages.some((msg) => messageHasImageAttachments(msg));
}

function refreshConversationImageHistoryFlag(messages) {
    currentConversationHasImageHistory = conversationHasImageHistory(messages);
}

async function warnIfModelCannotUseHistoryImages(modelId) {
    if (!currentConversationHasImageHistory) return;
    try {
        const canVision = await isModelVisionCapable(modelId);
        if (!canVision) {
            showToast('该模型不支持图片，历史图片无法传入该模型。');
        }
    } catch (_) {
        // ignore capability check error
    }
}

function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
        isGenerating = false;
        updateSendButtonState();
    }
}

function normalizeToolsMode(raw) {
    const m = String(raw || '').trim().toLowerCase();
    if (m === 'off' || m === 'force' || m === 'auto') return m;
    return 'auto';
}

function formatToolsModeLabel(mode) {
    const m = normalizeToolsMode(mode);
    if (m === 'off') return 'Off';
    if (m === 'force') return 'Force';
    return 'Auto';
}

function closeToolsModeDropdown() {
    if (!els.toolsModeDropdown) return;
    els.toolsModeDropdown.classList.remove('open');
    if (els.toolsModeTrigger) els.toolsModeTrigger.setAttribute('aria-expanded', 'false');
}

function setToolsMode(mode) {
    const normalized = normalizeToolsMode(mode);
    if (els.toolsMode) els.toolsMode.value = normalized;
    if (els.toolsModeLabel) els.toolsModeLabel.textContent = formatToolsModeLabel(normalized);
    if (els.toolsModeMenu) {
        els.toolsModeMenu.querySelectorAll('.tool-mode-item').forEach((btn) => {
            const active = String(btn.dataset.mode || '').trim().toLowerCase() === normalized;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }
}

function bindToolsModeDropdown() {
    if (!els.toolsModeDropdown || !els.toolsModeTrigger || !els.toolsModeMenu) return;
    if (els.toolsModeDropdown.dataset.bindDone === '1') return;
    els.toolsModeDropdown.dataset.bindDone = '1';
    setToolsMode(els.toolsMode ? els.toolsMode.value : 'auto');

    els.toolsModeTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !els.toolsModeDropdown.classList.contains('open');
        closeToolsModeDropdown();
        if (willOpen) {
            els.toolsModeDropdown.classList.add('open');
            els.toolsModeTrigger.setAttribute('aria-expanded', 'true');
        }
    });

    els.toolsModeMenu.querySelectorAll('.tool-mode-item').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setToolsMode(btn.dataset.mode || 'auto');
            closeToolsModeDropdown();
        });
    });

    document.addEventListener('click', (e) => {
        if (!els.toolsModeDropdown || !els.toolsModeDropdown.contains(e.target)) {
            closeToolsModeDropdown();
        }
    });
}

function getToolsMode() {
    return normalizeToolsMode(els.toolsMode ? els.toolsMode.value : 'auto');
}

async function sendMessage() {
    const text = els.messageInput.value.trim();
    if (!text && !isGenerating && uploadedFileIds.length === 0) return;
    if (isUploadingFiles && !isGenerating) {
        showToast('文件上传或向量化处理中，请稍候或手动中断后再发送');
        return;
    }
    
// 说明
    if (isGenerating) {
        stopGeneration();
        return;
    }

    // Configs
    const model = selectedModelId;
    const enableThinking = els.checkThinking ? els.checkThinking.checked : true;
    const enableSearch = els.checkSearch ? els.checkSearch.checked : true;
    const toolsMode = getToolsMode();
    const enableTools = toolsMode !== 'off';
    let modelVisionCapableCache = null;
    const ensureModelVisionCapable = async () => {
        if (!model) return true;
        if (modelVisionCapableCache === null) {
            modelVisionCapableCache = await isModelVisionCapable(model);
        }
        return !!modelVisionCapableCache;
    };
    const hasImageAttachment = uploadedFileIds.some((f) => f && f.type === 'image');
    if (hasImageAttachment) {
        const canVision = await ensureModelVisionCapable();
        if (!canVision) {
            showToast(`当前模型不支持图片输入：${model || '-'}`);
            return;
        }
    }
    const allowHistoryImages = currentConversationHasImageHistory ? await ensureModelVisionCapable() : true;

    // UI Updates
    els.messageInput.value = '';
    els.messageInput.style.height = 'auto';

    // Prepare display content
    let displayContent = text;
    const pendingUserAttachments = [];
    if (uploadedFileIds.length > 0) {
        uploadedFileIds.forEach((f) => {
            if (!f) return;
            if (f.type === 'image') {
                if (f.url) {
                    pendingUserAttachments.push({
                        type: 'image',
                        url: f.url,
                        name: f.name || '',
                        mime: f.mime || '',
                        size: Number(f.size || 0)
                    });
                }
                return;
            }
            if (f.type === 'sandbox_file') {
                pendingUserAttachments.push({
                    type: 'sandbox_file',
                    name: f.name || '',
                    sandbox_path: f.sandbox_path || '',
                    size: Number(f.size || 0)
                });
                return;
            }
            if (f.type === 'text') {
                const textSize = Number(f.size || new Blob([String(f.content || '')]).size || 0);
                pendingUserAttachments.push({
                    type: 'text',
                    name: f.name || 'text',
                    size: textSize
                });
                return;
            }
            pendingUserAttachments.push({
                type: 'file',
                name: f.name || '',
                size: Number(f.size || 0)
            });
        });
    }

    // Add User Message to UI
    appendMessage({
        role: 'user',
        content: displayContent,
        metadata: pendingUserAttachments.length > 0 ? { attachments: pendingUserAttachments } : {}
    });
    if (pendingUserAttachments.length > 0) {
        currentConversationHasImageHistory = true;
    }
    
    // Reset auto-scroll
    shouldAutoScroll = true;

    // Separate text files from Volc files
    let finalMessage = text;
    const fileInputs = [];
    const sandboxPaths = [];
    
    uploadedFileIds.forEach(f => {
        if (f.type === 'text') {
            finalMessage += `\n\n--- Start of File: ${f.name} ---\n${f.content}\n--- End of File: ${f.name} ---\n`;
        } else if (f.type === 'sandbox_file') {
            if (f.sandbox_path) sandboxPaths.push(f.sandbox_path);
        } else if (f.type === 'image') {
            if (f.url) {
                fileInputs.push({
                    type: 'image_url',
                    url: f.url,
                    name: f.name || '',
                    mime: f.mime || ''
                });
            }
        } else {
            if (f.id) fileInputs.push(String(f.id));
        }
    });

    if (sandboxPaths.length > 0) {
        finalMessage += `\n\n[系统注入] 已上传文件到用户沙箱，请优先使用 file_list/file_create/file_read/file_find/file_write/file_remove 工具操作以下路径：\n${sandboxPaths.map(p => `- ${p}`).join('\n')}\n`;
    }

    // Prepare API Payload
    const payload = {
        message: finalMessage,
        model_name: model,
        conversation_id: currentConversationId,
        enable_thinking: enableThinking,
        enable_web_search: enableSearch,
        enable_tools: enableTools,
        tool_mode: toolsMode,
        file_ids: fileInputs,
        allow_history_images: allowHistoryImages
    };
    
    // Reset files
    uploadedFileIds = [];
    updateFilePreview();

    isGenerating = true;
    updateSendButtonState();
    beginTokenMiniStreaming();
    
    // Create Placeholder for AI Response
    const aiMsgId = Date.now().toString(); // Temporary ID
    const aiMsgDiv = appendMessage({ role: 'assistant', content: '', id: aiMsgId, pending: true });
    let currentFullContent = '';
    let currentSegmentContent = '';
    let currentContentSpan = null;
    let streamRenderFinalized = false;
    const toolArgsDeltaSeenByCallId = new Set();
    const modelBadgeState = {
        modelName: String(model || ''),
        searchFlag: 'unknown',
        inputTokens: 0,
        outputTokens: 0
    };
    const modelBadgeUsageState = {
        input: 0,
        output: 0,
        snapshotInput: 0,
        snapshotOutput: 0,
        snapshotInitialized: false
    };

    function finalizeStreamingContentRender() {
        if (streamRenderFinalized) return;
        streamRenderFinalized = true;
        try {
            const blocks = aiMsgDiv.querySelectorAll('.content-body[data-stream-live="1"]');
            blocks.forEach((block) => {
                const raw = String(block.dataset.streamRaw || '');
                const sourceText = rewriteCitationRefsMarkdown(raw, aiMsgDiv.__citationUrlMap || {});
                block.innerHTML = renderMarkdownWithNewTabLinks(sourceText);
                bindSourceMarkdown(block, sourceText);
                renderMathSafe(block);
                highlightCode(block);
                block.dataset.streamLive = '0';
            });
            const thinkingBlocks = aiMsgDiv.querySelectorAll('.thinking-block.reasoning-thinking-block[data-stream-live="1"] .thinking-content');
            thinkingBlocks.forEach((contentDiv) => {
                try { renderMathSafe(contentDiv); } catch (_) {}
                const host = contentDiv.closest('.thinking-block.reasoning-thinking-block');
                if (host) host.dataset.streamLive = '0';
            });
        } catch (_) {}
    }
    
    // Create new abort controller
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: currentAbortController.signal
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                finalizeStreamingContentRender();
// 说明
                const thinkingBlocks = aiMsgDiv.querySelectorAll('.thinking-block');
                thinkingBlocks.forEach(thinkingBlock => {
                    if (thinkingBlock.dataset.userToggled !== 'true') {
                        setTimeout(() => {
                            thinkingBlock.classList.add('collapsed');
                        }, 500);
                    }
                });
                break;
            }
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') {
                        isGenerating = false;
                        updateSendButtonState();
                        continue;
                    }
                    try {
                        const chunk = JSON.parse(jsonStr);
                        
                        if (chunk.conversation_id) {
                            const incomingCid = String(chunk.conversation_id || '').trim();
                            const oldCid = String(currentConversationId || '').trim();
                            currentConversationId = chunk.conversation_id;
                            if (incomingCid && incomingCid !== oldCid) {
                                syncNotesForConversation(incomingCid);
                            }
                            noteTokenMiniConversationId(chunk.conversation_id);
                        }

                        if (chunk.type === 'model_info') {
                            modelBadgeState.modelName = String(chunk.model_name || modelBadgeState.modelName || '');
                            modelBadgeState.searchFlag = (typeof chunk.search_enabled === 'boolean') ? chunk.search_enabled : modelBadgeState.searchFlag;
                            updateMessageModelBadge(aiMsgDiv, modelBadgeState);
                        }
                        
                        else if (chunk.type === 'content') {
                            currentFullContent += chunk.content;
                            onTokenStreamTextChunk(chunk.content);
                            
                            // 如果当前没有正在渲染的内容Span，或者它不是消息气泡的最后一丅素（说明丗插入了工具）
                            const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                            if (!currentContentSpan || msgContentContainer.lastElementChild !== currentContentSpan) {
                                currentContentSpan = createContentSpan(aiMsgDiv);
                                currentSegmentContent = '';
// 说明
                            }
                            
// 说明
                            // 注意：为了保持Markdown上下文一致，我们通常倾向于在同一个Block显示
                            // 但用户求在工具链下方显示，以必须开吖Block
                            currentSegmentContent += chunk.content;
                            const sourceText = rewriteCitationRefsMarkdown(currentSegmentContent, aiMsgDiv.__citationUrlMap || {});
                            currentContentSpan.dataset.streamRaw = currentSegmentContent;
                            currentContentSpan.dataset.streamLive = '1';
                            currentContentSpan.innerHTML = renderMarkdownWithNewTabLinks(sourceText);
                            bindSourceMarkdown(currentContentSpan, sourceText);
                            renderMathSafe(currentContentSpan);
                            highlightCode(currentContentSpan);
                        } 
                        else if (chunk.type === 'reasoning_content') { 
                           onTokenStreamReasoningChunk(chunk.content);
                           const msgContentContainer = aiMsgDiv.querySelector('.message-content');
// 说明
// 说明
                           let thinkingBlock = msgContentContainer.lastElementChild;
                           
                           if(!thinkingBlock || !thinkingBlock.classList.contains('reasoning-thinking-block')) {
                               thinkingBlock = document.createElement('div');
                               thinkingBlock.className = 'thinking-block reasoning-thinking-block'; // 流式输出时默认展
// 说明
                                thinkingBlock.innerHTML = `
                                 <div class="thinking-header">
                                     <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                         <circle cx="12" cy="12" r="10"></circle>
                                         <path d="M12 6v6l4 2"></path>
                                     </svg>
                                     <span class="thinking-title">思考</span>
                                     <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                         <polyline points="6 9 12 15 18 9"></polyline>
                                     </svg>
                                 </div>
                                 <div class="thinking-content"></div>
                               `;
                               
// 说明
                               const header = thinkingBlock.querySelector('.thinking-header');
                               header.addEventListener('click', function() {
                                   thinkingBlock.classList.toggle('collapsed');
// 说明
                               });
                               
// 说明
                               msgContentContainer.appendChild(thinkingBlock);
                           }
                            
                           const contentDiv = thinkingBlock.querySelector('.thinking-content');
                           contentDiv.textContent += chunk.content;
                           renderMathSafe(contentDiv);
                           thinkingBlock.dataset.streamLive = '1';
                        }
                        // --- New Chunk Types Support ---
                        else if (chunk.type === 'web_search') {
                            updateWebSearchStatus(aiMsgDiv, chunk.status, chunk.query, chunk.content);
                        }
                        else if (chunk.type === 'search_meta') {
                            appendSearchMeta(aiMsgDiv, chunk);
                        }
                        else if (chunk.type === 'function_call_delta') {
                            const toolName = resolveToolNameFromEvent(chunk);
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'delta', rawCallId, toolIndex);
                            if (rawCallId) toolArgsDeltaSeenByCallId.add(rawCallId);
                            onTokenStreamToolArgsChunk(chunk.arguments_delta || chunk.delta || '');
                            appendToolCallDelta(aiMsgDiv, {
                                ...chunk,
                                name: toolName || chunk.name,
                                call_id: callId,
                                __raw_call_id: rawCallId,
                                __tool_index: toolIndex
                            });
                        }
                        else if (chunk.type === 'function_call') {
                            const toolName = resolveToolNameFromEvent(chunk, chunk.name);
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'call', rawCallId, toolIndex);
                            rememberJsExecuteCanvasCall(aiMsgDiv, toolName, callId, toolIndex, chunk.arguments || '');
                            // 某些 provider 不发 delta，只在 done 里给完整 arguments；这种情况也要计入估算
                            if (!rawCallId || !toolArgsDeltaSeenByCallId.has(rawCallId)) {
                                onTokenStreamToolArgsChunk(chunk.arguments || '');
                            }
                            // Special handling for addBasis to show content
                            if (toolName === 'addBasis') {
                                try {
                                    const args = JSON.parse(chunk.arguments);
                                    appendAddBasisView(aiMsgDiv, args);
                                } catch(e) { console.error("Error parsing addBasis args", e); }
                            }
                            finalizeToolCallBadge(aiMsgDiv, toolName, callId, chunk.arguments, { toolIndex });
                        }
                        else if (chunk.type === 'function_result') {
                            const toolName = resolveToolNameFromEvent(chunk, chunk.name);
                            const rawCallId = String(chunk.call_id || chunk.callId || '').trim();
                            const toolIndex = (chunk.index === undefined || chunk.index === null) ? null : Number(chunk.index);
                            const callId = allocateToolCallId(aiMsgDiv, toolName, 'result', rawCallId, toolIndex);
                            updateLastToolResult(aiMsgDiv, toolName, chunk.result, callId, { toolIndex });
                            maybeRenderCanvasFromJsExecuteResult(aiMsgDiv, toolName, chunk.result, callId, toolIndex);
                        }
                        else if (chunk.type === 'token_usage') {
                            onTokenStreamUsageChunk(chunk);
                            applyUsageChunkToBadgeState(modelBadgeUsageState, chunk);
                            modelBadgeState.inputTokens = modelBadgeUsageState.input;
                            modelBadgeState.outputTokens = modelBadgeUsageState.output;
                            updateMessageModelBadge(aiMsgDiv, modelBadgeState);
                        }
                        else if (chunk.type === 'title') {
                            if(els.conversationTitle) els.conversationTitle.textContent = chunk.title;
                        }
                        else if (chunk.type === 'error') {
                            appendErrorEvent(aiMsgDiv, chunk.content || 'Unknown error');
                        }
                        
                    } catch (e) { console.error("Parse error", e); }
                }
            }
             // Auto-scroll
             if (shouldAutoScroll) {
                // Check if we are already near bottom before forcing script scroll
                // This prevents fighting if the user is actively trying to scroll up but hasn't passed threshold yet
                // However, if we just added content, we ARE effectively scrolled up.
                // So we really just want to apply scroll if the flag says so.
                requestAnimationFrame(() => {
                    els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
                });
             }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            appendErrorEvent(aiMsgDiv, '[Generation Terminated by User]');
        } else {
            appendErrorEvent(aiMsgDiv, e.message || 'Unknown error');
        }
        isGenerating = false;
    } finally {
        finalizeStreamingContentRender();
        isGenerating = false;
        currentAbortController = null;
        updateSendButtonState();
        aiMsgDiv.classList.remove('pending');
        await finishTokenMiniStreaming();
        loadConversations(); // Update list preview
        loadKnowledge(currentConversationId); // Refresh knowledge
    }
}

function updateWebSearchStatus(aiMsgDiv, status, query, fullContent, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const safeQuery = String(query || '').trim();
    // In history mode, we don't look for existing badges to update; we just append.
    let badge = null;
    if (!isHistory) {
        const rows = parent.querySelectorAll('.tool-usage[data-tool-name="Web Search"]');
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.dataset.pending !== 'true') continue;
            if (!safeQuery || !row.dataset.query || row.dataset.query === safeQuery) {
                badge = row;
                break;
            }
        }
    }
    
    // Construct display text
    let displayText = status || fullContent;
    
    if (!badge) {
        // Create new
        const div = document.createElement('div');
        div.className = 'tool-usage';
        div.dataset.toolName = 'Web Search';
        div.dataset.query = query || ''; // Store query
        div.dataset.pending = 'true';
        div.dataset.resolved = 'false';
        
        const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        
        div.innerHTML = `
            <div class="tool-badge">
                ${iconSvg}
                <span>Web Search</span>
                <span class="tool-status"></span>
                <span class="tool-toggle" aria-hidden="true">▸</span>
            </div>
            <div class="tool-output"></div>
        `;
        
        // 始终追加到末尾以保持时间线次序
        parent.appendChild(div);
        bindToolUsageToggle(div);
        placeCanvasCardsBelowToolChain(aiMsgDiv);
        
        badge = div;
    }
    
    // Update Logic
    // If we have a new query, update stored
    if (query) badge.dataset.query = query;
    const currentQuery = badge.dataset.query;
    
    if (currentQuery) {
        displayText = `${status}: ${currentQuery}`;
    }
    
    badge.querySelector('.tool-status').textContent = displayText;

    // 完成态后关闭复用；下一次搜索必须 append 新行
    const doneText = String(status || '').toLowerCase();
    const isDone = doneText.includes('完成') || doneText.includes('completed') || doneText.includes('done');
    if (isDone) {
        badge.dataset.pending = 'false';
        badge.dataset.resolved = 'true';
    }
}

function appendSearchMeta(aiMsgDiv, meta, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const toolName = 'Web Search Meta';
    let row = null;
    if (!isHistory) {
        const rows = parent.querySelectorAll('.tool-usage[data-tool-name="Web Search Meta"]');
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].dataset.pending === 'true') {
                row = rows[i];
                break;
            }
        }
    }
    if (!row) {
        row = appendToolEvent(aiMsgDiv, toolName, '来源已捕获', false, {
            reuseIfExists: false,
            pending: true
        });
    }
    if (!row) return;

    const searchResults = Array.isArray(meta && meta.search_results) ? meta.search_results : [];
    const citations = Array.isArray(meta && meta.citations) ? meta.citations : [];
    const usage = (meta && typeof meta.usage === 'object' && meta.usage) ? meta.usage : {};
    const plugins = (usage && typeof usage.plugins === 'object' && usage.plugins) ? usage.plugins : {};
    const requestId = String((meta && meta.request_id) || '').trim();

    const statusEl = row.querySelector('.tool-status');
    if (statusEl) statusEl.textContent = `sources=${searchResults.length}, citations=${citations.length}`;

    // Save citation map for stream-time markdown rewrite
    const citationMap = {};
    citations.forEach((c) => {
        const idx = Number(c && c.index ? c.index : 0);
        const url = String((c && c.url) || '').trim();
        if (idx > 0 && url) citationMap[idx] = url;
    });
    aiMsgDiv.__citationUrlMap = citationMap;

    const lines = [];
    if (requestId) lines.push(`request_id: ${requestId}`);
    if (plugins && Object.keys(plugins).length > 0) lines.push(`plugins: ${JSON.stringify(plugins)}`);
    if (citations.length > 0) {
        lines.push('');
        lines.push('Citations:');
        citations.forEach((c) => {
            const idx = Number(c && c.index ? c.index : 0);
            const title = String((c && c.title) || '').trim();
            const url = String((c && c.url) || '').trim();
            lines.push(`- [${idx || '?'}] ${title || '(no title)'}${url ? ` | ${url}` : ''}`);
        });
    }
    if (searchResults.length > 0) {
        lines.push('');
        lines.push('Search Results:');
        searchResults.slice(0, 12).forEach((r) => {
            const idx = Number(r && r.index ? r.index : 0);
            const title = String((r && r.title) || '').trim();
            const site = String((r && r.site_name) || '').trim();
            const url = String((r && r.url) || '').trim();
            lines.push(`- [${idx || '?'}] ${site ? `${site} · ` : ''}${title || '(no title)'}${url ? ` | ${url}` : ''}`);
        });
        if (searchResults.length > 12) {
            lines.push(`... (${searchResults.length - 12} more)`);
        }
    }

    const outDiv = row.querySelector('.tool-output');
    if (outDiv) {
        outDiv.textContent = lines.join('\n').trim() || 'No search metadata';
        if (outDiv.textContent.trim()) {
            row.classList.add('has-output');
            row.classList.add('expanded');
            scrollToolOutputToBottom(outDiv);
            scheduleToolAutoCollapse(row, 900);
        }
    }
    row.dataset.pending = 'false';
    row.dataset.resolved = 'true';
}

function appendErrorEvent(aiMsgDiv, message, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'tool-usage tool-error';
    div.dataset.toolName = 'Error';
    const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    div.innerHTML = `
        <div class="tool-badge">
            ${iconSvg}
            <span class="tool-name">Error</span>
            <span class="tool-status">${message || ''}</span>
            <span class="tool-toggle" aria-hidden="true">▸</span>
        </div>
        <div class="tool-output"></div>
    `;
    parent.appendChild(div);
    bindToolUsageToggle(div);
    placeCanvasCardsBelowToolChain(aiMsgDiv);
}

function appendAddBasisView(aiMsgDiv, args) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'add-basis-view';
    div.innerHTML = `
        <div class="add-basis-header">
            <span>ADDED KNOWLEDGE: ${args.title || 'Untitled'}</span>
            <span style="font-weight:normal; color:#999;">${(args.context || '').length} chars</span>
        </div>
        <div class="add-basis-content">${args.context || ''}</div>
    `;
    parent.appendChild(div);
    placeCanvasCardsBelowToolChain(aiMsgDiv);
}

function appendToolEvent(aiMsgDiv, name, details, isFunction = false, options = {}) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const toolName = String(name || '').trim() || 'tool';
    const opts = (options && typeof options === 'object') ? options : {};
    const callId = String(opts.callId || opts.call_id || '').trim();
    const reuseIfExists = !!opts.reuseIfExists;
    const pending = !!opts.pending;

    let div = null;
    if (reuseIfExists) {
        div = findToolUsage(parent, toolName, callId, true);
    }
    if (!div) {
        div = document.createElement('div');
        div.className = 'tool-usage';
        parent.appendChild(div);
        div.dataset.resolved = 'false';
    }
    div.dataset.toolName = toolName;
    if (callId) div.dataset.callId = callId;
    div.dataset.pending = pending ? 'true' : 'false';
    if (pending) div.dataset.resolved = 'false';

    // Icon selection
    let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>'; // default toolbox
    if(toolName === 'Web Search' || toolName === 'searchKeyword' || toolName === 'web_search') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    }

    let detailText = typeof details === 'object' ? JSON.stringify(details) : details;
    detailText = String(detailText || '');
    if (isFunction && detailText) {
        detailText = `参数: ${detailText.replace(/\s+/g, ' ').slice(0, 56)}${detailText.length > 56 ? '...' : ''}`;
    }

    div.innerHTML = `
        <div class="tool-badge">
            ${iconSvg}
            <span class="tool-name">${toolName}</span>
            <span class="tool-status">${detailText || ''}</span>
            <span class="tool-toggle" aria-hidden="true">▸</span>
        </div>
        <div class="tool-output"></div>
    `;
    bindToolUsageToggle(div);
    placeCanvasCardsBelowToolChain(aiMsgDiv);
    return div;
}

function bindToolUsageToggle(toolEl) {
    if (!toolEl || toolEl.dataset.toggleBound === '1') return;
    const badge = toolEl.querySelector('.tool-badge');
    if (!badge) return;
    badge.addEventListener('click', () => {
        if (!toolEl.classList.contains('has-output')) return;
        if (toolEl.__autoCollapseTimer) {
            clearTimeout(toolEl.__autoCollapseTimer);
            toolEl.__autoCollapseTimer = null;
        }
        toolEl.classList.toggle('expanded');
    });
    toolEl.dataset.toggleBound = '1';
}

function scheduleToolAutoCollapse(toolEl, delay = 260) {
    if (!toolEl) return;
    if (toolEl.__autoCollapseTimer) {
        clearTimeout(toolEl.__autoCollapseTimer);
    }
    toolEl.__autoCollapseTimer = setTimeout(() => {
        toolEl.classList.remove('expanded');
        toolEl.__autoCollapseTimer = null;
    }, Math.max(0, Number(delay) || 0));
}

function findToolUsage(parent, name, callId, pendingOnly = false) {
    const targetName = String(name || '').trim();
    const targetCallId = String(callId || '').trim();
    const rows = parent.querySelectorAll('.tool-usage');
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (pendingOnly && row.dataset.pending !== 'true') continue;
        if (targetCallId && row.dataset.callId === targetCallId) return row;
        if (!targetCallId && targetName && row.dataset.toolName === targetName) return row;
    }
    return null;
}

function findToolUsageByPhase(parent, name, callId, phase, pendingOnly = false) {
    if (!parent) return null;
    const targetName = String(name || '').trim();
    const targetCallId = String(callId || '').trim();
    const targetPhase = String(phase || '').trim();
    const rows = parent.querySelectorAll('.tool-usage');
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (pendingOnly && row.dataset.pending !== 'true') continue;
        if (targetPhase && String(row.dataset.phase || '').trim() !== targetPhase) continue;
        if (targetCallId && row.dataset.callId === targetCallId) return row;
        if (!targetCallId && targetName && row.dataset.toolName === targetName) return row;
    }
    return null;
}

function getToolCallState(aiMsgDiv) {
    if (!aiMsgDiv.__toolCallState || typeof aiMsgDiv.__toolCallState !== 'object') {
        aiMsgDiv.__toolCallState = {
            seq: 0,
            pendingByName: {},
            callIdByIndex: {},
            pendingQueue: [],
            activeAnonCallId: ''
        };
    }
    if (!aiMsgDiv.__toolCallState.callIdByIndex || typeof aiMsgDiv.__toolCallState.callIdByIndex !== 'object') {
        aiMsgDiv.__toolCallState.callIdByIndex = {};
    }
    if (!Array.isArray(aiMsgDiv.__toolCallState.pendingQueue)) {
        aiMsgDiv.__toolCallState.pendingQueue = [];
    }
    if (typeof aiMsgDiv.__toolCallState.activeAnonCallId !== 'string') {
        aiMsgDiv.__toolCallState.activeAnonCallId = '';
    }
    return aiMsgDiv.__toolCallState;
}

function allocateToolCallId(aiMsgDiv, toolName, phase, explicitCallId = '', toolIndex = null) {
    const state = getToolCallState(aiMsgDiv);
    const name = String(toolName || '').trim() || 'tool';
    const explicit = String(explicitCallId || '').trim();
    const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
        ? ''
        : String(Number(toolIndex));
    const pendingByName = state.pendingByName;
    const pendingQueue = state.pendingQueue;
    if (!Array.isArray(pendingByName[name])) pendingByName[name] = [];
    const queue = pendingByName[name];
    const enqueueOnce = (id) => {
        if (!id) return;
        if (!pendingQueue.includes(id)) pendingQueue.push(id);
    };
    const dequeueById = (id) => {
        if (!id) return;
        const qIdx = pendingQueue.indexOf(id);
        if (qIdx >= 0) pendingQueue.splice(qIdx, 1);
    };

    if (explicit) {
        if (idxKey) state.callIdByIndex[idxKey] = explicit;
        if (phase === 'result') {
            const idx = queue.indexOf(explicit);
            if (idx >= 0) queue.splice(idx, 1);
            dequeueById(explicit);
            if (state.activeAnonCallId === explicit) state.activeAnonCallId = '';
        } else if (!queue.includes(explicit)) {
            queue.push(explicit);
            enqueueOnce(explicit);
        }
        return explicit;
    }

    const createLocalId = () => `local-${++state.seq}`;
    if (idxKey) {
        if (!state.callIdByIndex[idxKey]) {
            state.callIdByIndex[idxKey] = createLocalId();
        }
        const byIndexId = state.callIdByIndex[idxKey];
        if (phase === 'result') {
            const idx = queue.indexOf(byIndexId);
            if (idx >= 0) queue.splice(idx, 1);
            dequeueById(byIndexId);
            if (state.activeAnonCallId === byIndexId) state.activeAnonCallId = '';
        } else if (!queue.includes(byIndexId)) {
            queue.push(byIndexId);
            enqueueOnce(byIndexId);
        }
        return byIndexId;
    }

    // No explicit call_id and no index: treat as anonymous stream.
    if (phase === 'delta') {
        if (!state.activeAnonCallId) {
            state.activeAnonCallId = createLocalId();
            if (!queue.includes(state.activeAnonCallId)) queue.push(state.activeAnonCallId);
            enqueueOnce(state.activeAnonCallId);
        }
        return state.activeAnonCallId;
    }
    if (phase === 'call') {
        // Close current anonymous delta stream at function-call boundary.
        if (state.activeAnonCallId) {
            const anonId = state.activeAnonCallId;
            state.activeAnonCallId = '';
            if (!queue.includes(anonId)) queue.push(anonId);
            enqueueOnce(anonId);
            return anonId;
        }
        const id = createLocalId();
        if (!queue.includes(id)) queue.push(id);
        enqueueOnce(id);
        return id;
    }
    if (phase === 'result') {
        let id = '';
        if (queue.length > 0) {
            id = queue.shift();
            dequeueById(id);
            if (state.activeAnonCallId === id) state.activeAnonCallId = '';
            return id;
        }
        if (pendingQueue.length > 0) {
            id = pendingQueue.shift();
            const byNameIdx = queue.indexOf(id);
            if (byNameIdx >= 0) queue.splice(byNameIdx, 1);
            if (state.activeAnonCallId === id) state.activeAnonCallId = '';
            return id;
        }
        if (state.activeAnonCallId) {
            id = state.activeAnonCallId;
            state.activeAnonCallId = '';
            dequeueById(id);
            return id;
        }
        return createLocalId();
    }
    if (phase === 'delta' || phase === 'call') {
        if (queue.length === 0) queue.push(createLocalId());
        enqueueOnce(queue[queue.length - 1]);
        return queue[queue.length - 1];
    }
    return createLocalId();
}

function formatToolArgsForOutput(argsRaw) {
    const raw = String(argsRaw || '').trim();
    if (!raw) return '';
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_) {
        return raw;
    }
}

function isCompleteJsonText(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    try {
        JSON.parse(s);
        return true;
    } catch (_) {
        return false;
    }
}

function shouldSplitToolArgsStream(existingRaw, incomingDelta) {
    const prev = String(existingRaw || '').trim();
    if (!prev) return false;
    if (!isCompleteJsonText(prev)) return false;
    const nextLead = String(incomingDelta || '').trimStart();
    return nextLead.startsWith('{') || nextLead.startsWith('[');
}

function beginNewAnonymousToolCall(aiMsgDiv, name) {
    const state = getToolCallState(aiMsgDiv);
    state.activeAnonCallId = '';
    return allocateToolCallId(aiMsgDiv, name, 'delta', '', null);
}

function formatToolDeltaStatus(argsRaw) {
    const _ = argsRaw; // keep signature stable for existing calls
    return '参数构建中';
}

function normalizeToolDisplayName(name) {
    return String(name || '').trim() || 'tool';
}

function resolveToolNameFromEvent(data, fallback = '') {
    const src = (data && typeof data === 'object') ? data : {};
    const direct = String(src.name || src.function_name || src.tool_name || '').trim();
    if (direct) return direct;
    const funcObj = (src.function && typeof src.function === 'object') ? src.function : null;
    if (funcObj) {
        const n = String(funcObj.name || '').trim();
        if (n) return n;
    }
    return String(fallback || '').trim();
}

function renameToolUsageRow(row, name) {
    if (!row) return;
    const safeName = normalizeToolDisplayName(name);
    row.dataset.toolName = safeName;
    const nameEl = row.querySelector('.tool-name');
    if (nameEl) nameEl.textContent = safeName;
}

function setToolUsageStatus(row, statusText) {
    if (!row) return;
    const statusEl = row.querySelector('.tool-status');
    if (statusEl) statusEl.textContent = String(statusText || '');
}

function scrollToolOutputToBottom(outputEl) {
    if (!outputEl) return;
    const doScroll = () => {
        outputEl.scrollTop = outputEl.scrollHeight;
    };
    doScroll();
    requestAnimationFrame(doScroll);
}

function findPendingToolUsageFallback(parent, name, callId = '', toolIndex = null) {
    if (!parent) return null;
    const safeName = normalizeToolDisplayName(name);
    const safeCallId = String(callId || '').trim();
    const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
        ? ''
        : String(Number(toolIndex));

    if (safeCallId) {
        const byCall = findToolUsage(parent, safeName, safeCallId, true) || findToolUsage(parent, 'tool', safeCallId, true);
        if (byCall) return byCall;
    }

    const rows = parent.querySelectorAll('.tool-usage');
    if (idxKey) {
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.dataset.pending !== 'true') continue;
            if (String(row.dataset.toolIndex || '') === idxKey) return row;
        }
    }

    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row.dataset.pending !== 'true') continue;
        if (row.dataset.toolName === safeName) return row;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row.dataset.pending !== 'true') continue;
        const n = String(row.dataset.toolName || '').trim();
        if (!n || n === 'tool') return row;
    }
    return null;
}

function ensureToolUsageForDelta(aiMsgDiv, name, callId, toolIndex = null) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const safeName = String(name || '').trim() || 'tool';
    const safeCallId = String(callId || '').trim();
    const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
        ? ''
        : String(Number(toolIndex));
    let row = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex);
    if (!row) {
        row = appendToolEvent(aiMsgDiv, safeName, '参数构建中...', true, {
            callId: safeCallId,
            reuseIfExists: true,
            pending: true
        });
    }
    row.dataset.pending = 'true';
    row.dataset.phase = 'build';
    if (safeCallId) row.dataset.callId = safeCallId;
    if (idxKey) row.dataset.toolIndex = idxKey;
    return row;
}

function appendToolCallDelta(aiMsgDiv, data) {
    const providedName = resolveToolNameFromEvent(data);
    const nameDeltaPiece = String((data && data.name_delta) || '').trim();
    const name = providedName || 'tool';
    const callId = String(data.call_id || data.callId || '').trim();
    const rawCallId = String(data.__raw_call_id || '').trim();
    const rawIndex = (data.__tool_index === undefined || data.__tool_index === null) ? null : Number(data.__tool_index);
    const delta = String(data.arguments_delta || data.delta || '');
    let row = ensureToolUsageForDelta(aiMsgDiv, name, callId, rawIndex);
    if (providedName) {
        row.dataset.nameAcc = providedName;
        renameToolUsageRow(row, providedName);
    } else if (nameDeltaPiece) {
        const acc = `${row.dataset.nameAcc || ''}${nameDeltaPiece}`;
        row.dataset.nameAcc = acc;
        if (String(acc || '').trim()) {
            renameToolUsageRow(row, acc);
        }
    }
    if (!delta) return;

    // provider 未提供稳定 call_id/index 时，若上一段参数已是完整 JSON，且新增量又从对象起始开始，
    // 视为新一轮工具调用，强制切分为新行，避免参数复用拼接。
    const missingStableIdentity = !rawCallId && (rawIndex === null || Number.isNaN(rawIndex));
    if (missingStableIdentity && shouldSplitToolArgsStream(row.dataset.argsRaw || '', delta)) {
        const freshCallId = beginNewAnonymousToolCall(aiMsgDiv, name);
        row = ensureToolUsageForDelta(aiMsgDiv, name, freshCallId, rawIndex);
    }

    const nextRaw = `${row.dataset.argsRaw || ''}${delta}`;
    row.dataset.argsRaw = nextRaw;
    const displayName = normalizeToolDisplayName(row.dataset.toolName || providedName || name);
    setToolUsageStatus(row, `${displayName} ${formatToolDeltaStatus(nextRaw)}:`);
    const outDiv = row.querySelector('.tool-output');
    if (outDiv) {
        outDiv.textContent = formatToolArgsForOutput(nextRaw);
        if (outDiv.textContent) {
            row.classList.add('has-output');
            row.classList.add('expanded'); // 调用进行中自动展开
            scrollToolOutputToBottom(outDiv);
        }
    }
}

function finalizeToolCallBadge(aiMsgDiv, name, callId, argumentsText = '', options = {}) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    let safeName = String(name || '').trim() || 'tool';
    const safeCallId = String(callId || '').trim();
    const toolIndex = (options && options.toolIndex !== undefined && options.toolIndex !== null)
        ? Number(options.toolIndex)
        : null;
    const idxKey = (toolIndex === null || Number.isNaN(toolIndex)) ? '' : String(toolIndex);
    const autoExpand = !(options && options.autoExpand === false);

    // Keep a dedicated "build" row so args are not overwritten by result.
    let buildRow = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex)
        || findToolUsageByPhase(parent, safeName, safeCallId, 'build', false);
    if ((safeName === 'tool') && buildRow) {
        const inherited = normalizeToolDisplayName(buildRow.dataset.toolName || '');
        if (inherited && inherited !== 'tool') safeName = inherited;
    }
    const finalArgs = String(argumentsText || (buildRow && buildRow.dataset ? buildRow.dataset.argsRaw : '') || '');
    if (!buildRow && finalArgs) {
        buildRow = appendToolEvent(aiMsgDiv, safeName, '', true, {
            callId: safeCallId,
            reuseIfExists: false,
            pending: false
        });
    }
    if (buildRow) {
        renameToolUsageRow(buildRow, safeName);
        buildRow.dataset.phase = 'build';
        if (safeCallId) buildRow.dataset.callId = safeCallId;
        if (idxKey) buildRow.dataset.toolIndex = idxKey;
        buildRow.dataset.pending = 'false';
        buildRow.dataset.resolved = 'true';
        if (finalArgs) buildRow.dataset.argsRaw = finalArgs;
        setToolUsageStatus(buildRow, `${safeName} 参数构建中:`);
        const buildOut = buildRow.querySelector('.tool-output');
        if (buildOut && buildRow.dataset.argsRaw) {
            buildOut.textContent = formatToolArgsForOutput(buildRow.dataset.argsRaw);
            if (buildOut.textContent.trim()) {
                buildRow.classList.add('has-output');
                buildRow.classList.add('expanded');
                scrollToolOutputToBottom(buildOut);
                scheduleToolAutoCollapse(buildRow, 380);
            }
        }
    }

    // Create/update dedicated exec row for runtime status/result.
    let row = findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false);
    if (!row) {
        row = appendToolEvent(aiMsgDiv, safeName, '', true, {
            callId: safeCallId,
            reuseIfExists: false,
            pending: false
        });
    }
    renameToolUsageRow(row, safeName);
    row.dataset.phase = 'exec';
    if (safeCallId) row.dataset.callId = safeCallId;
    if (idxKey) row.dataset.toolIndex = idxKey;
    row.dataset.pending = 'false';
    row.dataset.resolved = 'false';
    setToolUsageStatus(row, `${safeName} 执行中`);
    const outDiv = row.querySelector('.tool-output');
    if (outDiv) {
        outDiv.textContent = '';
        row.classList.remove('has-output');
        if (autoExpand) row.classList.add('expanded');
    }
}

function updateLastToolResult(aiMsgDiv, name, result, callId = '', options = {}) {
    // Find the last tool usage of this name that doesn't have a result yet
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    let safeName = String(name || '').trim() || 'tool';
    const safeCallId = String(callId || '').trim();
    const toolIndex = (options && options.toolIndex !== undefined && options.toolIndex !== null)
        ? Number(options.toolIndex)
        : null;
    const idxKey = (toolIndex === null || Number.isNaN(toolIndex)) ? '' : String(toolIndex);
    let target = findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false);
    if (!target) {
        target = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex);
    }
    if (!target && safeCallId) {
        target = findToolUsage(parent, safeName, safeCallId, false) || findToolUsage(parent, 'tool', safeCallId, false);
    }
    if (!target) {
        // 当 provider 不返回 call_id 时，按“最早未完成”匹配，避免覆盖最近一条
        const rows = parent.querySelectorAll('.tool-usage');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.dataset.resolved === 'true') continue;
            if (row.dataset.toolName === safeName || row.dataset.toolName === 'tool') {
                target = row;
                break;
            }
        }
    }
    if (!target) {
        target = appendToolEvent(aiMsgDiv, safeName, '', true, {
            callId: safeCallId,
            reuseIfExists: false,
            pending: false
        });
    }

    // Never overwrite build-row content with result; keep a dedicated exec row.
    const targetNameHint = target ? normalizeToolDisplayName(target.dataset.toolName || '') : '';
    if (safeName === 'tool' && targetNameHint && targetNameHint !== 'tool') {
        safeName = targetNameHint;
    }
    if (target && String(target.dataset.phase || '') === 'build') {
        let execRow = findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false);
        if (!execRow) {
            execRow = appendToolEvent(aiMsgDiv, safeName, '', true, {
                callId: safeCallId,
                reuseIfExists: false,
                pending: false
            });
        }
        target = execRow;
    }

    if (target) {
        if (safeName === 'tool') {
            const inherited = normalizeToolDisplayName(target.dataset.toolName || '');
            if (inherited && inherited !== 'tool') safeName = inherited;
        }
        renameToolUsageRow(target, safeName);
        target.dataset.phase = target.dataset.phase || 'exec';
        if (safeCallId) target.dataset.callId = safeCallId;
        if (idxKey) target.dataset.toolIndex = idxKey;
        target.dataset.pending = 'false';
        target.dataset.resolved = 'true';
        setToolUsageStatus(target, `${safeName} 完成:`);
        const outDiv = target.querySelector('.tool-output');
        const resultText = (typeof result === 'object') ? JSON.stringify(result, null, 2) : String(result || '');
        outDiv.textContent = resultText;
        if (outDiv.textContent.trim()) {
            target.classList.add('has-output');
            scrollToolOutputToBottom(outDiv);
        }
        // 调用结束后自动折叠
        scheduleToolAutoCollapse(target, 320);
    }
}

function createContentSpan(parentMsgDiv) {
    const parent = parentMsgDiv.querySelector('.message-content') || parentMsgDiv;
    const span = document.createElement('div');
    span.className = 'content-body fade-in';
    parent.appendChild(span);
    return span;
}

function appendUserAttachments(contentEl, msg) {
    if (!contentEl || !msg || !msg.metadata || !Array.isArray(msg.metadata.attachments)) return;
    const allAttachments = msg.metadata.attachments.filter((att) => att && typeof att === 'object');
    const imageAttachments = allAttachments.filter((att) => {
        if (!att || typeof att !== 'object') return false;
        const type = String(att.type || '').toLowerCase();
        const url = String(att.asset_url || att.url || '').trim();
        if (!url) return false;
        if (type === 'image' || type === 'image_url') return true;
        const mime = String(att.mime || '').toLowerCase();
        return mime.startsWith('image/');
    });
    const fileAttachments = allAttachments.filter((att) => !imageAttachments.includes(att));
    if (!imageAttachments.length && !fileAttachments.length) return;

    if (imageAttachments.length) {
        const wrap = document.createElement('div');
        wrap.className = 'message-attachments';
        imageAttachments.forEach((att) => {
            const rawUrl = String(att.asset_url || att.url || '').trim();
            const displayUrl = rawUrl.startsWith('/') ? rawUrl : rawUrl;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'message-attachment image';
            item.title = String(att.name || 'image').trim() || 'image';
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openImageViewer(displayUrl, item.title);
            });

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = displayUrl;
            img.alt = String(att.name || 'image').trim() || 'image';
            item.appendChild(img);

            wrap.appendChild(item);
        });
        contentEl.appendChild(wrap);
    }

    if (fileAttachments.length) {
        const wrap = document.createElement('div');
        wrap.className = 'message-attachments file-list';
        fileAttachments.forEach((att) => {
            const type = String(att.type || 'file').toLowerCase();
            const name = String(att.name || 'attachment').trim() || 'attachment';
            const sizeText = formatFileSize(att.size || 0);
            const chip = document.createElement('div');
            chip.className = 'message-attachment file';
            const iconClass = type === 'sandbox_file'
                ? 'fa-solid fa-folder-tree'
                : (type === 'text' ? 'fa-regular fa-file-lines' : 'fa-regular fa-file');
            chip.innerHTML = `
                <i class="${iconClass}" aria-hidden="true"></i>
                <span class="name">${escapeHtml(name)}</span>
                <span class="meta">${escapeHtml(sizeText)}</span>
            `;
            chip.title = type === 'sandbox_file'
                ? `沙箱文件: ${String(att.sandbox_path || '')}`
                : name;
            wrap.appendChild(chip);
        });
        contentEl.appendChild(wrap);
    }
}

function appendMessage(msg, index) {
    // If index is not provided (live message), calculate it based on current message count
    if (index === undefined || index === null) {
        index = els.messagesContainer.querySelectorAll('.message').length;
    }
    
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    if (msg.pending) div.classList.add('pending');
    div.dataset.index = index;
    div.dataset.conversationId = String(currentConversationId || '');
    
    // Avatar for AI
    if (msg.role === 'assistant') {
        const avatar = document.createElement('div');
        avatar.className = 'avatar ai';
        avatar.textContent = 'AI';
        div.appendChild(avatar);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    div.appendChild(content); // Append content container early so sub-renderers can find it
    div.__toolCallState = {
        seq: 0,
        pendingByName: {},
        callIdByIndex: {},
        pendingQueue: [],
        activeAnonCallId: ''
    };
    
    if (msg.role === 'user') {
        appendUserAttachments(content, msg);

        // Wrap user content in bubble for alignment
        const textContent = String(msg.content || '').trim();
        if (textContent) {
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.innerHTML = renderMarkdownWithNewTabLinks(textContent);
            bindSourceMarkdown(bubble, textContent);
            renderMathSafe(bubble);
            content.appendChild(bubble);
        }
        
        // User Message Actions (only delete)
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        actions.innerHTML = `
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;
        content.appendChild(actions);

    } else {
        // AI Message
        const processSteps = (msg.metadata && Array.isArray(msg.metadata.process_steps))
            ? msg.metadata.process_steps
            : [];
        const hasReasoningStep = processSteps.some((s) => s && s.type === 'reasoning_content');

        // 兼容老数据：仅 metadata.reasoning_content（无分段 step）
        if (msg.metadata && msg.metadata.reasoning_content && !hasReasoningStep) {
            const thinkingBlock = document.createElement('div');
            thinkingBlock.className = 'thinking-block reasoning-thinking-block collapsed'; // 默۵
            thinkingBlock.innerHTML = `
                <div class="thinking-header">
                    <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                    </svg>
                    <span class="thinking-title">思考</span>
                    <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="thinking-content"></div>
            `;
            
            // 添加点击事件监听
            const header = thinkingBlock.querySelector('.thinking-header');
            header.addEventListener('click', function() {
                thinkingBlock.classList.toggle('collapsed');
            });
            
            const thinkingContent = thinkingBlock.querySelector('.thinking-content');
            thinkingContent.textContent = msg.metadata.reasoning_content;
            renderMathSafe(thinkingContent);
            content.appendChild(thinkingBlock);
        }
        
        if (processSteps.length > 0) {
            processSteps.forEach(step => {
                if (step.type === 'reasoning_content') {
                    const thinkingBlock = document.createElement('div');
                    thinkingBlock.className = 'thinking-block reasoning-thinking-block collapsed';
                    thinkingBlock.innerHTML = `
                        <div class="thinking-header">
                            <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 6v6l4 2"></path>
                            </svg>
                            <span class="thinking-title">思考</span>
                            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </div>
                        <div class="thinking-content"></div>
                    `;
                    const header = thinkingBlock.querySelector('.thinking-header');
                    header.addEventListener('click', function() {
                        thinkingBlock.classList.toggle('collapsed');
                    });
                    const thinkingContent = thinkingBlock.querySelector('.thinking-content');
                    thinkingContent.textContent = String(step.content || '');
                    renderMathSafe(thinkingContent);
                    content.appendChild(thinkingBlock);
                }
                else if (step.type === 'web_search') {
                    updateWebSearchStatus(div, step.status || step.content, step.query, step.content, true);
                }
                else if (step.type === 'search_meta') {
                    appendSearchMeta(div, step, true);
                }
                else if (step.type === 'function_call') {
                    const toolName = resolveToolNameFromEvent(step, step.name);
                    if (toolName === 'addBasis') {
                        try {
                            const args = JSON.parse(step.arguments);
                            appendAddBasisView(div, args);
                        } catch(e) {}
                    }
                    const callId = allocateToolCallId(div, toolName, 'call', step.call_id || '', step.index);
                    rememberJsExecuteCanvasCall(div, toolName, callId, step.index, step.arguments || '');
                    finalizeToolCallBadge(div, toolName, callId, step.arguments || '', { autoExpand: false, toolIndex: step.index });
                }
                else if (step.type === 'function_result') {
                    const toolName = resolveToolNameFromEvent(step, step.name);
                    const callId = allocateToolCallId(div, toolName, 'result', step.call_id || '', step.index);
                    updateLastToolResult(div, toolName, step.result, callId, { toolIndex: step.index });
                    maybeRenderCanvasFromJsExecuteResult(div, toolName, step.result, callId, step.index);
                }
                else if (step.type === 'error') {
                    appendErrorEvent(div, step.content || step.message || 'Unknown error', true);
                }
                else if (step.type === 'content') {
                    // 对于历史记录补插的文本内容
                    const body = document.createElement('div');
                    body.className = 'content-body';
                    body.innerHTML = renderMarkdownWithNewTabLinks(step.content);
                    bindSourceMarkdown(body, step.content);
                    renderMathSafe(body);
                    highlightCode(body);
                    content.appendChild(body);
                }
            });
        }
        
        // Render main content (if not already handled by steps)
        // Note: For newer messages, content is often duplicated in steps as 'content' type
        const hasContentStep = processSteps.some((s) => s && s.type === 'content');
                               
        if(msg.content && !hasContentStep) {
            const body = document.createElement('div');
            body.className = 'content-body';
            body.innerHTML = renderMarkdownWithNewTabLinks(msg.content);
            bindSourceMarkdown(body, msg.content);
            renderMathSafe(body);
            highlightCode(body);
            content.appendChild(body);
        }

        // Add model badge/hint
        const modelName = msg.model_name || (msg.metadata && msg.metadata.model_name);
        if (modelName) {
            const ioMeta = (msg.metadata && msg.metadata.io_tokens && typeof msg.metadata.io_tokens === 'object')
                ? msg.metadata.io_tokens
                : {};
            updateMessageModelBadge(div, {
                modelName,
                searchFlag: (msg.metadata && typeof msg.metadata.search_enabled === 'boolean')
                    ? msg.metadata.search_enabled
                    : 'unknown',
                inputTokens: safeTokenInt(ioMeta.input),
                outputTokens: safeTokenInt(ioMeta.output)
            });
        }

        // AI Message Actions (Delete, Regenerate, Versioning)
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        
        // Branching (Versions)
        const versions = (msg.metadata && msg.metadata.versions) ? msg.metadata.versions : [];
        if (versions.length > 0) {
            const nav = buildVersionNavigation(msg);
            const totalVersions = nav.total;
            const currentVerNum = nav.current;
            const prevIdx = nav.prevIndex;
            const nextIdx = nav.nextIndex;

            actions.innerHTML += `
                <div class="version-switcher">
                    <button class="btn-ver" onclick="switchVersion(${index}, ${prevIdx === null ? 'null' : prevIdx})" title="上一版本" ${prevIdx === null ? 'disabled' : ''}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span>${currentVerNum} / ${totalVersions}</span>
                    <button class="btn-ver" onclick="switchVersion(${index}, ${nextIdx === null ? 'null' : nextIdx})" title="下一版本" ${nextIdx === null ? 'disabled' : ''}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
            `;
        }

        actions.innerHTML += `
            <button class="btn-action" onclick="copyGeneratedInfo(${index})" title="复制生成信息">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            <button class="btn-action" onclick="confirmRegenerate(${index})" title="重新回答">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"></path></svg>
            </button>
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;
        content.appendChild(actions);
    }

    els.messagesContainer.appendChild(div);
    
    // Remove welcome screen if exists
    const welcome = els.messagesContainer.querySelector('.welcome-screen');
    if(welcome) welcome.remove();

    // Scroll
    if (shouldAutoScroll && !isBatchRenderingMessages) {
        els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
    }
    
    return div; // Return main message div
}

function normalizeVariantTimestamp(v) {
    const raw = String((v && v.timestamp) || '').trim();
    if (!raw) return 0;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
}

function variantSignature(v) {
    const ts = String((v && v.timestamp) || '');
    const content = String((v && v.content) || '');
    return `${ts}::${content.slice(0, 120)}`;
}

function buildVersionNavigation(msg) {
    const versions = (msg && msg.metadata && Array.isArray(msg.metadata.versions)) ? msg.metadata.versions : [];
    const currentVariant = {
        content: msg ? msg.content : '',
        timestamp: msg ? msg.timestamp : '',
        __serverIndex: versions.length,
        __isCurrent: true
    };
    const pool = versions.map((v, i) => ({
        content: v.content || '',
        timestamp: v.timestamp || '',
        __serverIndex: i,
        __isCurrent: false
    }));
    pool.push(currentVariant);

    // 按时间升序；无时间时保持原顺序（serverIndex）
    const sorted = pool
        .map((v, i) => ({ ...v, __originOrder: i }))
        .sort((a, b) => {
            const ta = normalizeVariantTimestamp(a);
            const tb = normalizeVariantTimestamp(b);
            if (ta !== tb) return ta - tb;
            return a.__originOrder - b.__originOrder;
        });

    const currentSig = variantSignature(currentVariant);
    let currentPos = sorted.findIndex(v => variantSignature(v) === currentSig && v.__isCurrent);
    if (currentPos < 0) currentPos = sorted.length - 1;

    const prev = currentPos > 0 ? sorted[currentPos - 1] : null;
    const next = currentPos < sorted.length - 1 ? sorted[currentPos + 1] : null;

    return {
        total: sorted.length,
        current: currentPos + 1,
        prevIndex: prev ? Number(prev.__serverIndex) : null,
        nextIndex: next ? Number(next.__serverIndex) : null
    };
}

function renderMessages(messages, noScroll, options = {}) {
    // preserve welcome if empty
    refreshConversationImageHistoryFlag(Array.isArray(messages) ? messages : []);
    if(!messages || messages.length === 0) return;
    clearHoverProxyMessage();
    const opts = (options && typeof options === 'object') ? options : {};
    const instant = !!opts.instant;
    
    // Save current scroll position
    const oldScrollTop = els.messagesContainer.scrollTop;
    const prevInlineScrollBehavior = els.messagesContainer.style.scrollBehavior;
    if (instant) {
        els.messagesContainer.style.scrollBehavior = 'auto';
    }

    isBatchRenderingMessages = true;
    try {
        els.messagesContainer.innerHTML = '';
        messages.forEach((m, i) => appendMessage(m, i));
    } finally {
        isBatchRenderingMessages = false;
    }
    
    // Restore or scroll
    if (noScroll) {
        // Try to maintain the relative scroll position if desired, 
        // but usually for delete/version-switch we just want to stay where we are
        els.messagesContainer.scrollTop = oldScrollTop;
    } else if (shouldAutoScroll) {
        els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
    }

    if (instant) {
        // 恢复原来的滚动行为（通常是 CSS 中的 smooth）
        requestAnimationFrame(() => {
            els.messagesContainer.style.scrollBehavior = prevInlineScrollBehavior || '';
        });
    }
}

// Global modal functions
window.confirmDelete = function(index) {
    if (!currentConversationId) {
// 说明
        return;
    }
    showConfirm("删除确认", "确定要删除这条消息及其后的所有内容吗？此操作不可撤销。", "danger", async () => {
        try {
            const res = await fetch('/api/delete_message', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    conversation_id: currentConversationId,
                    index: index
                })
            });
            const data = await res.json();
            if(data.success) {
                // Silent reload: fetch data and render without triggering initial animation effects
                const convRes = await fetch(`/api/conversations/${currentConversationId}`);
                const convData = await convRes.json();
                if (convData.success) {
                    renderMessages(convData.conversation.messages, true);
                }
            } else {
                showToast("删除失败: " + data.message);
            }
        } catch(e) { console.error(e); }
    });
};

window.confirmRegenerate = function(index) {
    if (!currentConversationId) {
        showToast("此对话尚未保存，无法重新回答");
        return;
    }
    showConfirm("重新回答", "我们将保留当前回答并生成一个新版本，确定要重新生成吗？", "primary", async () => {
        // Trigger regeneration
        startRegenerate(index);
    });
};

async function startRegenerate(index) {
    if (isGenerating) return;
    
    const modelName = selectedModelId;
    const toolsMode = getToolsMode();
    const enableTools = toolsMode !== 'off';
    
    // Setup UI for generation
    isGenerating = true;
    updateSendButtonState();
    currentAbortController = new AbortController();
    
    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                conversation_id: currentConversationId,
                model_name: modelName,
                is_regenerate: true,
                regenerate_index: index,
                enable_thinking: els.checkThinking.checked,
                enable_web_search: els.checkSearch.checked,
                enable_tools: enableTools,
                tool_mode: toolsMode,
                show_token_usage: true
            }),
            signal: currentAbortController.signal
        });

        if (!response.ok) throw new Error("HTTP " + response.status);
        
        // Target specific message index for regeneration
        const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
        if (messageDiv) {
            const content = messageDiv.querySelector('.message-content');
            // 清理旧内容/工具链，避免重新生成时复用历史展示节点
            if (content) {
                content.querySelectorAll('.content-body,.thinking-block,.tool-usage,.add-basis-view,.msg-actions').forEach(el => el.remove());
            } else {
                // fallback
                messageDiv.querySelectorAll('.content-body,.thinking-block,.tool-usage,.add-basis-view,.msg-actions').forEach(el => el.remove());
            }
            messageDiv.__citationUrlMap = {};
            messageDiv.__toolCallState = {
                seq: 0,
                pendingByName: {},
                callIdByIndex: {},
                pendingQueue: [],
                activeAnonCallId: ''
            };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let accumulatedContent = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = jsonParseSafe(line.substring(6));
                    if(!data) continue;
                    
                    if (data.type === 'content') {
                        accumulatedContent += data.content;
                        updateMessageDivContent(index, accumulatedContent);
                    } else if (data.type === 'reasoning_content') {
                        updateMessageDivThinking(index, data.content);
                    } else if (data.type === 'web_search' || data.type === 'search_meta' || data.type === 'function_call_delta' || data.type === 'function_call' || data.type === 'function_result') {
                        updateMessageDivTools(index, data);
                    }
                } catch (e) { }
            }
        }
        
    } catch (e) {
        if (e.name === 'AbortError') console.log("Generation stopped.");
        else console.error(e);
    } finally {
        isGenerating = false;
        updateSendButtonState();
        
        // Final refresh to ensure all metadata/indices are locked
        const convRes = await fetch(`/api/conversations/${currentConversationId}`);
        const convData = await convRes.json();
        if (convData.success) {
            renderMessages(convData.conversation.messages, true);
        }
    }
}

function jsonParseSafe(str) {
    try { return JSON.parse(str); } catch(e) { return null; }
}

function updateMessageDivContent(index, fullText) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    let body = messageDiv.querySelector('.content-body');
    if (!body) {
        body = document.createElement('div');
        body.className = 'content-body';
        messageDiv.querySelector('.message-content').appendChild(body);
    }
    
    body.innerHTML = renderMarkdownWithNewTabLinks(fullText);
    bindSourceMarkdown(body, fullText);
    renderMathSafe(body);
    highlightCode(body);
    
    if (shouldAutoScroll) els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

function updateMessageDivThinking(index, delta) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    const content = messageDiv.querySelector('.message-content');
    let thinkingBlock = messageDiv.querySelector('.thinking-block.reasoning-thinking-block');
    
    if (!thinkingBlock) {
        thinkingBlock = document.createElement('div');
        thinkingBlock.className = 'thinking-block reasoning-thinking-block'; // No collapsed by default during live gen
        thinkingBlock.innerHTML = `
            <div class="thinking-header">
                <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                </svg>
                <span class="thinking-title">思考</span>
                <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="thinking-content"></div>
        `;
        content.prepend(thinkingBlock); 
        
        const header = thinkingBlock.querySelector('.thinking-header');
        header.addEventListener('click', () => thinkingBlock.classList.toggle('collapsed'));
    }
    
    const textTarget = thinkingBlock.querySelector('.thinking-content');
    textTarget.textContent += delta;
    renderMathSafe(textTarget);
}

function updateMessageDivTools(index, data) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    if (data.type === 'web_search') {
        updateWebSearchStatus(messageDiv, data.status, data.query, data.content);
    } else if (data.type === 'search_meta') {
        appendSearchMeta(messageDiv, data);
    } else if (data.type === 'function_call_delta') {
        const toolName = resolveToolNameFromEvent(data);
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'delta', rawCallId, toolIndex);
        appendToolCallDelta(messageDiv, {
            ...data,
            name: toolName || data.name,
            call_id: callId,
            __raw_call_id: rawCallId,
            __tool_index: toolIndex
        });
    } else if (data.type === 'function_call') {
        const toolName = resolveToolNameFromEvent(data, data.name);
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'call', rawCallId, toolIndex);
        rememberJsExecuteCanvasCall(messageDiv, toolName, callId, toolIndex, data.arguments || '');
        finalizeToolCallBadge(messageDiv, toolName, callId, data.arguments || '', { toolIndex });
    } else if (data.type === 'function_result') {
        const toolName = resolveToolNameFromEvent(data, data.name);
        const rawCallId = String(data.call_id || data.callId || '').trim();
        const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
        const callId = allocateToolCallId(messageDiv, toolName, 'result', rawCallId, toolIndex);
        updateLastToolResult(messageDiv, toolName, data.result, callId, { toolIndex });
        maybeRenderCanvasFromJsExecuteResult(messageDiv, toolName, data.result, callId, toolIndex);
    }
}

// Logic for Modal
window.showConfirm = function(title, message, type, onOk, onCancel) {
    const backdrop = document.getElementById('confirmBackdrop');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    
    if (!backdrop || !okBtn) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    
    // Cleanup old event listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    // Explicitly set text and style to ensure visibility
    if(type === 'danger') {
// 说明
        newOkBtn.className = "btn-confirm btn-confirm-del";
    } else {
// 说明
        newOkBtn.className = "btn-confirm";
    }
    backdrop.__confirmOnCancel = (typeof onCancel === 'function') ? onCancel : null;
    bindBackdropSafeClose(backdrop, () => window.closeConfirmModal());
    
    backdrop.classList.add('active');
    
    newOkBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        backdrop.classList.remove('active');
        const done = typeof onOk === 'function' ? onOk : null;
        backdrop.__confirmOnCancel = null;
        if (done) done();
    });
};

window.closeConfirmModal = function() {
    const backdrop = document.getElementById('confirmBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('active');
    const onCancel = backdrop.__confirmOnCancel;
    backdrop.__confirmOnCancel = null;
    if (typeof onCancel === 'function') onCancel();
};

function confirmModalAsync(title, message, type = 'danger') {
    return new Promise((resolve) => {
        window.showConfirm(title, message, type, () => resolve(true), () => resolve(false));
    });
}

window.switchVersion = async function(msgIndex, verIndex) {
    if (verIndex === null || verIndex === undefined || Number.isNaN(Number(verIndex))) return;
    try {
        const res = await fetch('/api/switch_version', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                conversation_id: currentConversationId,
                message_index: msgIndex,
                version_index: Number(verIndex)
            })
        });
        const data = await res.json();
        if(data.success) {
            // Switch also should be silent
            const convRes = await fetch(`/api/conversations/${currentConversationId}`);
            const convData = await convRes.json();
            if (convData.success) {
                renderMessages(convData.conversation.messages, true);
            }
        }
    } catch(e) { console.error(e); }
};


// --- Knowledge ---
async function loadKnowledge(cid) {
    // Knowledge is likely user-global, not per conversation, but we reload on chat interactions
    try {
        const [resBasis, resShort, resMeta] = await Promise.all([
            fetch('/api/knowledge/basis'),
            fetch('/api/knowledge/short'),
            fetch('/api/knowledge/list')
        ]);
        
        const basisData = await resBasis.json();
        const shortData = await resShort.json();
        const metaData = await resMeta.json();
        knowledgeMetaCache = (metaData && metaData.basis_knowledge) ? metaData.basis_knowledge : {};

        if (basisData.success) {
            basisKnowledgeListCache = Array.isArray(basisData.knowledge) ? [...basisData.knowledge] : [];
            renderKnowledgeList(els.panelBasisList, basisKnowledgeListCache, 'basis');
            if(els.panelBasisCount) els.panelBasisCount.textContent = basisKnowledgeListCache.length;
        } else {
            basisKnowledgeListCache = [];
        }
        if (shortData.success) {
            renderKnowledgeList(els.panelShortList, shortData.memories || [], 'short');
            if(els.panelShortCount) els.panelShortCount.textContent = (shortData.memories || []).length;
        }
        bindShortTermSectionToggle();

    } catch(e) { console.error("Error loading knowledge", e); }
}

function bindShortTermSectionToggle() {
    const list = els.panelShortList || document.getElementById('panelShortMemoryList');
    if (!list) return;
    const section = list.closest('.k-section');
    const title = section ? section.querySelector('.k-section-title') : null;
    if (!section || !title) return;
    if (title.dataset.shortToggleBound === '1') return;
    title.dataset.shortToggleBound = '1';
    title.classList.add('short-term-toggle');
    title.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('button,input,textarea,a')) return;
        section.classList.toggle('short-collapsed');
    });
}

async function attachKnowledgeToComposer(title, type = 'basis', shortContent = '') {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) return;
    let content = '';
    if (type === 'short') {
        content = String(shortContent || '').trim();
    } else {
        try {
            const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(safeTitle)}`);
            const data = await res.json();
            if (data && data.success && data.knowledge) {
                content = String(data.knowledge.content || '').trim();
            }
        } catch (_) {
            content = '';
        }
    }
    if (!content) {
        showToast('附加失败：未读取到内容');
        return;
    }
    const exists = uploadedFileIds.some((f) => {
        if (!f || String(f.type || '') !== 'text') return false;
        return String(f.name || '') === `知识库-${safeTitle}`;
    });
    if (exists) {
        showToast('该知识已附加');
        return;
    }
    uploadedFileIds.push({
        type: 'text',
        name: `知识库-${safeTitle}`,
        content,
        size: Number(new Blob([content]).size || 0),
        source: 'knowledge',
        knowledge_type: type
    });
    updateFilePreview();
    if (els.messageInput) els.messageInput.focus();
    showToast('已附加知识内容');
}

function renderKnowledgeList(container, items, type) {
    if(!container) return;
    container.innerHTML = '';

    const sourceItems = Array.isArray(items) ? items : [];
    const orderedItems = sourceItems
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            if (type === 'basis') {
                const aTitle = String(typeof a.item === 'string' ? a.item : (a.item && a.item.title) || '').trim();
                const bTitle = String(typeof b.item === 'string' ? b.item : (b.item && b.item.title) || '').trim();
                const aMeta = (knowledgeMetaCache && aTitle) ? (knowledgeMetaCache[aTitle] || {}) : {};
                const bMeta = (knowledgeMetaCache && bTitle) ? (knowledgeMetaCache[bTitle] || {}) : {};
                const aHasPin = !!(a.item && typeof a.item === 'object' && Object.prototype.hasOwnProperty.call(a.item, 'pin'));
                const bHasPin = !!(b.item && typeof b.item === 'object' && Object.prototype.hasOwnProperty.call(b.item, 'pin'));
                const aPinned = aHasPin ? !!a.item.pin : !!aMeta.pin;
                const bPinned = bHasPin ? !!b.item.pin : !!bMeta.pin;
                if (aPinned !== bPinned) return aPinned ? -1 : 1;
            }
            // 保持历史行为：默认按最近在前（reverse）
            return b.index - a.index;
        })
        .map((x) => x.item);

    orderedItems.forEach((item) => {
        const rawTitle = String(typeof item === 'string' ? item : (item && item.title) || '').trim();
        if (!rawTitle) return;
        const shortContent = String((item && item.content) || rawTitle).trim();
        const itemMeta = knowledgeMetaCache[rawTitle] || {};
        const hasPinField = !!(item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'pin'));
        const isPinned = type === 'basis' ? (hasPinField ? !!item.pin : !!itemMeta.pin) : false;

        const div = document.createElement('div');
        div.className = `knowledge-item ${type === 'short' ? 'knowledge-item-short' : 'knowledge-item-basis'}`;
        div.dataset.title = type === 'short' ? shortContent : rawTitle;
        if (type === 'basis') {
            div.dataset.pin = isPinned ? '1' : '0';
        }
        if (type === 'short') {
            div.dataset.shortOriginal = shortContent;
        }

        const row = document.createElement('div');
        row.className = 'knowledge-item-row';

        const label = document.createElement('span');
        label.className = 'knowledge-item-label';
        if (type === 'basis' && isPinned) {
            const pinIcon = document.createElement('i');
            pinIcon.className = 'fa-solid fa-thumbtack knowledge-pin-icon';
            pinIcon.setAttribute('aria-hidden', 'true');
            label.appendChild(pinIcon);
        }
        label.appendChild(document.createTextNode(type === 'short' ? shortContent : rawTitle));
        row.appendChild(label);

        const actions = document.createElement('div');
        actions.className = 'knowledge-item-actions';

        if (type === 'basis') {
            const progress = document.createElement('div');
            progress.className = 'knowledge-progress';
            div.appendChild(progress);

            const meta = knowledgeMetaCache[rawTitle] || {};
            const updatedAt = Number(meta.updated_at || 0);
            const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
            const vectorExists = (typeof meta.vector_exists === 'boolean') ? meta.vector_exists : true;
            const needVectorRefresh = (updatedAt > 0 && vectorUpdatedAt < updatedAt) || !vectorExists;
            if (needVectorRefresh) {
                div.classList.add('needs-vector');
                const vectorBtn = document.createElement('button');
                vectorBtn.type = 'button';
                vectorBtn.className = 'knowledge-item-btn vectorize';
                vectorBtn.dataset.role = 'vectorize';
                vectorBtn.title = !vectorExists ? '向量缺失，点击重新向量化' : '需要重新向量化';
                vectorBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
                vectorBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (vectorBtn.classList.contains('is-loading')) return;
                    vectorizeKnowledgeTitle(rawTitle);
                });
                actions.appendChild(vectorBtn);
                if (vectorizeTasks[rawTitle] && vectorizeTasks[rawTitle].running) {
                    vectorBtn.classList.add('is-loading');
                    vectorBtn.innerHTML = '<i class="fa-solid fa-spinner"></i>';
                    vectorBtn.title = '向量化中...';
                    vectorBtn.disabled = true;
                    div.classList.add('vector-uploading');
                }
            }
            row.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                showPinContextMenu(ev.clientX, ev.clientY, {
                    targetType: 'knowledge_basis',
                    title: rawTitle,
                    pinned: isPinned
                });
            });
            row.addEventListener('click', () => viewKnowledge(rawTitle));
        } else {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'knowledge-item-btn edit';
            editBtn.title = '编辑';
            editBtn.innerHTML = '<i class="fa-regular fa-pen-to-square"></i>';
            actions.appendChild(editBtn);

            editBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (div.classList.contains('editing')) return;
                const prevContent = String(div.dataset.shortOriginal || '').trim();
                div.classList.add('editing');
                label.classList.add('is-editing');
                label.innerHTML = '';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'knowledge-inline-input';
                input.value = prevContent;
                label.appendChild(input);

                editBtn.title = '保存';
                editBtn.innerHTML = '<i class="fa-solid fa-check"></i>';

                let submitting = false;
                const exitEditMode = (text) => {
                    div.classList.remove('editing');
                    label.classList.remove('is-editing');
                    label.textContent = String(text || '').trim();
                    editBtn.title = '编辑';
                    editBtn.innerHTML = '<i class="fa-regular fa-pen-to-square"></i>';
                };
                const commit = async (save) => {
                    if (submitting) return;
                    const nextContent = String(input.value || '').trim();
                    if (!save) {
                        exitEditMode(prevContent);
                        return;
                    }
                    if (!nextContent) {
                        showToast('短期记忆内容不能为空');
                        input.focus();
                        return;
                    }
                    if (nextContent === prevContent) {
                        exitEditMode(nextContent);
                        return;
                    }
                    submitting = true;
                    try {
                        const res = await fetch(`/api/knowledge/short/${encodeURIComponent(prevContent)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: nextContent, content: nextContent })
                        });
                        const data = await res.json();
                        if (!data || !data.success) {
                            showToast((data && (data.error || data.message)) ? (data.error || data.message) : '保存失败');
                            input.focus();
                            submitting = false;
                            return;
                        }
                        div.dataset.shortOriginal = nextContent;
                        div.dataset.title = nextContent;
                        exitEditMode(nextContent);
                        showToast('短期记忆已保存');
                    } catch (_) {
                        showToast('保存失败');
                        input.focus();
                        submitting = false;
                    }
                };

                editBtn.onclick = async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    await commit(true);
                    if (!div.classList.contains('editing')) {
                        editBtn.onclick = null;
                    }
                };
                input.addEventListener('keydown', async (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        await commit(true);
                    } else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        await commit(false);
                    }
                });
                input.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                });
                input.addEventListener('blur', async () => {
                    if (!div.classList.contains('editing')) return;
                    await commit(true);
                    if (!div.classList.contains('editing')) {
                        editBtn.onclick = null;
                    }
                });
                requestAnimationFrame(() => {
                    input.focus();
                    input.select();
                });
            });

            row.addEventListener('click', (ev) => {
                if (div.classList.contains('editing')) return;
                if (ev.target && ev.target.closest && ev.target.closest('.knowledge-item-actions')) return;
                div.classList.toggle('expanded');
            });
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'knowledge-item-btn delete';
        deleteBtn.title = '删除';
        deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const deleteTitle = type === 'short'
                ? String(div.dataset.shortOriginal || shortContent || '').trim()
                : rawTitle;
            confirmDeleteKnowledge(deleteTitle, type);
        });
        actions.appendChild(deleteBtn);

        row.appendChild(actions);
        div.appendChild(row);

        container.appendChild(div);
    });
}

// Confirm delete knowledge
function confirmDeleteKnowledge(title, type = 'basis') {
    window.showConfirm(
        '删除知识点',
        `确定要删除「${title}」吗？此操作无法撤销。`,
        'danger',
        async () => {
            await deleteKnowledge(title, type);
        }
    );
}

// Delete knowledge
async function deleteKnowledge(title, type = 'basis') {
    try {
        const endpoint = type === 'basis' ? `/api/knowledge/basis/${encodeURIComponent(title)}` : `/api/knowledge/short/${encodeURIComponent(title)}`;
        const response = await fetch(endpoint, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if(!data.success) {
            console.error('删除失败:', data.message);
            showToast((data && (data.error || data.message)) ? (data.error || data.message) : '删除失败');
            return;
        }
        
        // 如果当前正在浏览该知识点，则自动退出
        if(currentViewingKnowledge === title) {
            closeKnowledgeView();
        }
        
        // 刷新知识库列表
        loadKnowledge(currentConversationId);
        showToast('删除成功');
    } catch(e) {
        console.error('删除知识点失败:', e);
        showToast('删除失败');
    }
}

// --- Knowledge View Logic ---
let easyMDE = null;
let originalHeaderState = null;
let currentViewingKnowledge = null;
let knowledgeMetaCache = {};
let bulkVectorizeRunning = false;
let pendingHighlightData = null;

// 导航栈管理：追踪视图层级，支持多层返回
let navigationStack = [];
let currentSearchQuery = ''; // 保存搜索关键词，以便返回时重新显示
let chatHeaderBaseState = null;

function captureChatHeaderBaseState() {
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    if (!headerTitle || !headerLeft || !headerRight) return;
    if (!chatHeaderBaseState) {
        chatHeaderBaseState = {
            title: headerTitle.textContent || 'Untitled Conversation',
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
}

function getDesktopHeaderToolsHtml() {
    if (isChatMobileLayout()) return '';
    if (chatHeaderBaseState && String(chatHeaderBaseState.rightHTML || '').trim()) {
        return chatHeaderBaseState.rightHTML;
    }
    const headerRight = document.querySelector('.header-right');
    return headerRight ? String(headerRight.innerHTML || '') : '';
}

function applyDesktopHeaderTools(headerRightEl) {
    const target = headerRightEl || document.querySelector('.header-right');
    if (!target) return;
    target.innerHTML = getDesktopHeaderToolsHtml();
    rebindHeaderActionButtons();
}

function restoreHeaderState(state) {
    if (!state) return;
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    if (!headerTitle || !headerLeft || !headerRight) return;
    headerTitle.textContent = state.title || 'Untitled Conversation';
    headerLeft.innerHTML = state.leftHTML || '';
    headerRight.innerHTML = state.rightHTML || '';

    els.modelSelectContainer = document.getElementById('modelSelectContainer');
    els.currentModelDisplay = document.getElementById('currentModelDisplay');
    els.modelOptions = document.getElementById('modelOptions');
    try {
        loadModels();
    } catch (e) {
        console.error('restoreHeaderState: loadModels failed', e);
    }
    rebindHeaderActionButtons();
}

function rebindHeaderActionButtons() {
    els.toggleSidebar = document.getElementById('toggleSidebar');
    els.toggleWorkflowView = document.getElementById('toggleWorkflowView');
    els.toggleNotesPanel = document.getElementById('toggleNotesPanel');
    els.mobileHeaderMenu = document.getElementById('mobileHeaderMenu');
    els.mobileHeaderMenuTrigger = document.getElementById('mobileHeaderMenuTrigger');
    els.mobileHeaderMenuPanel = document.getElementById('mobileHeaderMenuPanel');
    els.mobileWorkflowMenuItem = document.getElementById('mobileWorkflowMenuItem');
    els.mobileNotesMenuItem = document.getElementById('mobileNotesMenuItem');
    els.toggleKnowledgePanel = document.getElementById('toggleKnowledgePanel');
    els.toggleFilePanel = document.getElementById('toggleFilePanel');
    els.toggleMailView = document.getElementById('toggleMailView');

    const toggleSidebar = els.toggleSidebar;
    if (toggleSidebar) {
        toggleSidebar.onclick = () => {
            if (isChatMobileLayout()) toggleMobileSidebar();
            else els.sidebar.classList.toggle('collapsed');
        };
    }
    const toggleKP = els.toggleKnowledgePanel;
    if (toggleKP) {
        toggleKP.onclick = () => toggleKnowledgePanel();
    }
    const toggleFile = els.toggleFilePanel;
    if (toggleFile) {
        toggleFile.onclick = () => toggleCloudFilePanel();
    }
    const toggleWorkflow = els.toggleWorkflowView;
    if (toggleWorkflow) {
        toggleWorkflow.onclick = () => openWorkflowPlaceholderView();
    }
    const toggleNotes = els.toggleNotesPanel;
    if (toggleNotes) {
        toggleNotes.onclick = async () => {
            if (canOpenNotesCompanionWindow()) {
                const ok = await openNotesCompanionWindow();
                if (!ok) showToast('打开独立笔记窗口失败');
                return;
            }
            toggleNotesPanel();
        };
        renderNotesBadge();
    }
    const toggleMail = els.toggleMailView;
    if (toggleMail) {
        toggleMail.onclick = () => openMailPlaceholderView();
        renderMailNotifyBadge();
    }
    bindMobileHeaderMenu();
}

// 保存当前状态
function saveCurrentViewerState(extra = {}) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    return {
        viewerDisplay: viewer.style.display,
        viewerHTML: viewer.innerHTML,
        msgsDisplay: msgs.style.display,
        inputDisplay: inputWrapper ? inputWrapper.style.display : 'block',
        headerTitle: headerTitle.textContent,
        headerLeft: headerLeft.innerHTML,
        headerRight: headerRight.innerHTML,
        extra,
        extra
    };
}

// 恢复状态
function restoreViewerState(state) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    viewer.style.display = state.viewerDisplay;
    viewer.innerHTML = state.viewerHTML;
    msgs.style.display = state.msgsDisplay;
    if (inputWrapper) inputWrapper.style.display = state.inputDisplay;
    headerTitle.textContent = state.headerTitle;
    headerLeft.innerHTML = state.headerLeft;
    headerRight.innerHTML = state.headerRight;
    if (state.extra && state.extra.searchQuery) {
        currentSearchQuery = state.extra.searchQuery;
    }
}

async function viewKnowledge(title, options = {}) {
    currentViewingKnowledge = title;
    const { forceEditMode = false, highlightData = null, fromSearch = false } = options;
    pendingHighlightData = highlightData;
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if(!viewer || !msgs) return;
    
    // 1. Save Header State
    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
    
    // 导航栈管理：如果是从搜索结果进来的，保存知识项到栈
    // navigationStack 会在 searchKnowledgeVectors 或 openKnowledgeAtChunk 中被管理
    if (navigationStack.length > 0) {
        // 在栈上添加知识项
        navigationStack.push({
            type: 'knowledge',
            title: title,
            state: saveCurrentViewerState() // 当前页面状态（用于返回时恢复）
        });
    }

    // 如果不是从搜索进入，清空导航栈（避免返回到搜索）
    if (!fromSearch) {
        navigationStack = [];
    }

    // 2. Fetch Content
    let content = '';
    try {
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`);
        const data = await res.json();
        if(data.success) content = data.knowledge.content;
    } catch(e) { console.error(e); }

    // 3. UI Switch
    msgs.style.display = 'none';
    if(inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'block';
    // 如果当前viewer是搜索页，先恢复为编辑器容器
    if (!document.getElementById('knowledgeEditor')) {
        viewer.innerHTML = '<textarea id="knowledgeEditor"></textarea>';
        // 搜索页替换会销毁编辑器，需重建
        easyMDE = null;
    }

    // 4. Update Header
    headerTitle.textContent = title;
    
    // Left: Back + Knowledge actions (设置/保存/删除)
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <button class="btn-icon knowledge-action" onclick="openKnowledgeSettingsModal()" title="设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <button class="btn-icon knowledge-action" id="btnSaveKnowledge" onclick="saveKnowledge('${title.replace(/'/g, "\\'")}')" title="保存">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        </button>
        <button class="btn-icon knowledge-action knowledge-action-danger" onclick="confirmDeleteKnowledge('${title.replace(/'/g, "\\'")}', 'basis')" title="删除">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    // 5. Initialize Editor
    if (!easyMDE) {
        easyMDE = new EasyMDE({ 
            element: document.getElementById('knowledgeEditor'),
            status: false,
            spellChecker: false,
            sideBySideFullscreen: false,
            previewRender: function(plainText) {
                const html = renderMarkdownWithNewTabLinks(plainText);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                renderMathSafe(tempDiv);
                
                return tempDiv.innerHTML;
            },
            toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", 
                      "link", "image", "table", "|", "preview", "side-by-side", "fullscreen"]
        });
        
        // 提示用户如何切换模式
        showToast('提示：点击编辑器工具栏中的“眼睛”图标可切换预览与编辑模式。');
    }
    // 如果编辑器存在但绑定的 DOM 已被替换，重新创建
    if (!easyMDE || !easyMDE.codemirror || !document.getElementById('knowledgeEditor')) {
        easyMDE = null;
        easyMDE = new EasyMDE({ 
            element: document.getElementById('knowledgeEditor'),
            status: false,
            spellChecker: false,
            sideBySideFullscreen: false,
            previewRender: function(plainText) {
                const html = renderMarkdownWithNewTabLinks(plainText);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                renderMathSafe(tempDiv);
                return tempDiv.innerHTML;
            },
            toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", 
                      "link", "image", "table", "|", "preview", "side-by-side", "fullscreen"]
        });
    }
    
    const viewportHeight = window.innerHeight;
    const headerHeight = 60; 
    easyMDE.codemirror.setSize(null, `${viewportHeight - headerHeight}px`);

    easyMDE.value(content || '');

    // Default to Preview Mode unless forced edit mode
    if (forceEditMode) {
        if (easyMDE.isPreviewActive()) {
            EasyMDE.togglePreview(easyMDE);
        }
    } else {
        // 直接进入预览模式
        if (!easyMDE.isPreviewActive()) {
            EasyMDE.togglePreview(easyMDE);
        }
    }

    const highlightWhenReady = (retryCount = 0) => {
        if (!pendingHighlightData || !pendingHighlightData.text) return;
        if (retryCount > 30) { // 最多重试30次（约4.5秒）
            console.warn('预览内容加载超时，取消高亮');
            pendingHighlightData = null;
            return;
        }
        
        const preview = document.querySelector('.editor-preview');
        if (!preview) {
            setTimeout(() => highlightWhenReady(retryCount + 1), 150);
            return;
        }
        
        // 检查预览内容是否真正包含文本内容（不只是HTML标签）
        const textContent = preview.textContent || '';
        const hasContent = textContent.trim().length > 50; // 至少有50个字符
        
        if (!hasContent) {
            setTimeout(() => highlightWhenReady(retryCount + 1), 150);
            return;
        }
        
        // 内容已加载，执行高亮
        highlightTextInPreview(pendingHighlightData.text, pendingHighlightData.meta);
        pendingHighlightData = null; // 清空，避免重复高亮
    };

    setTimeout(() => {
        easyMDE.codemirror.refresh();
        if (!forceEditMode) {
            setTimeout(() => highlightWhenReady(0), 200);
        }
    }, 150);
}

function highlightTextInPreview(text, meta = {}) {
    const preview = document.querySelector('.editor-preview');
    if (!preview) {
        console.warn('预览元素不存在');
        return;
    }
    
    // 获取预览中的所有文本节点
    const walker = document.createTreeWalker(
        preview,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let searchText = text;
    let foundNode = null;
    let foundOffset = -1;
    let node = walker.nextNode();
    
    // 查找包含目标文本的节点
    while (node) {
        const nodeText = node.textContent;
        const idx = nodeText.indexOf(searchText);
        if (idx >= 0) {
            foundNode = node;
            foundOffset = idx;
            break;
        }
        // 尝试简短版本
        if (text.length > 80) {
            const short = text.slice(0, 80);
            const idx2 = nodeText.indexOf(short);
            if (idx2 >= 0) {
                foundNode = node;
                foundOffset = idx2;
                searchText = short;
                break;
            }
        }
        node = walker.nextNode();
    }
    
    if (!foundNode) {
        console.warn('未找到匹配的文本节点');
        return;
    }
    
    const parent = foundNode.parentNode;
    if (!parent) return;
    
    // 创建高亮span
    const span = document.createElement('span');
    span.className = 'cm-search-highlight';
    span.style.backgroundColor = 'rgba(34, 197, 94, 0.25)';
    span.style.borderBottom = '1px solid rgba(34, 197, 94, 0.7)';
    
    // 分割文本节点
    const beforeText = foundNode.textContent.slice(0, foundOffset);
    const highlightedText = foundNode.textContent.slice(foundOffset, foundOffset + searchText.length);
    const afterText = foundNode.textContent.slice(foundOffset + searchText.length);
    
    const beforeNode = document.createTextNode(beforeText);
    const highlightNode = document.createTextNode(highlightedText);
    const afterNode = document.createTextNode(afterText);
    
    span.appendChild(highlightNode);
    
    parent.insertBefore(beforeNode, foundNode);
    parent.insertBefore(span, foundNode);
    parent.insertBefore(afterNode, foundNode);
    parent.removeChild(foundNode);
    
    // 先滚动到顶部，然后再滚动到高亮位置，形成从上到下的定位效果
    preview.scrollTop = 0;
    
    // 使用 requestAnimationFrame 确保滚动在下一帧执行
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // 增加延迟，让"从上到下"的滚动效果更明显
            setTimeout(() => {
                // 获取元素位置并手动滚动（更可靠）
                const spanRect = span.getBoundingClientRect();
                const previewRect = preview.getBoundingClientRect();
                const scrollOffset = spanRect.top - previewRect.top - (previewRect.height / 2) + preview.scrollTop;
                
                // 使用平滑滚动
                preview.scrollTo({
                    top: scrollOffset,
                    behavior: 'smooth'
                });
                
                // 添加短暂的脉冲动画效果
                span.style.transition = 'all 0.3s ease';
                span.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    span.style.transform = 'scale(1)';
                }, 400);
            }, 400);
        });
    });
}

function closeKnowledgeView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    const wasMailView = !!(viewer && viewer.querySelector('.mail-workspace'));

    currentViewingKnowledge = null;
    
    // 检查导航栈
    if (navigationStack.length > 1) {
        // 弹出当前项（知识详情），查看前一个项
        navigationStack.pop(); // 移除知识点
        const prevItem = navigationStack[navigationStack.length - 1];
        
        if (prevItem.type === 'search') {
            // 返回到搜索页面 - 重新渲染搜索结果
            const query = prevItem.query || currentSearchQuery;
            
            // 恢复搜索结果缓存
            if (prevItem.resultsCache && prevItem.resultsCache.length > 0) {
                lastKnowledgeSearchResults = prevItem.resultsCache;
            }
            
            // 重新显示搜索界面
            viewer.style.display = 'flex';
            viewer.style.flexDirection = 'column';
            msgs.style.display = 'none';
            if (inputWrapper) inputWrapper.style.display = 'none';
            
            // 更新Header
            headerTitle.textContent = '向量库搜索';
            headerLeft.innerHTML = `
                <button class="btn-icon" onclick="closeKnowledgeSearchResultView()" title="Back">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                </button>
            `;
            applyDesktopHeaderTools(headerRight);
            
            // 重新渲染搜索结果
            viewer.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                        <div style="font-size: 14px; color: #64748b;">搜索: <strong style="color: #0f172a;">${escapeHtml(query)}</strong></div>
                    </div>
                    <div id="knowledgeSearchResultsList" style="flex: 1; overflow-y: auto; padding: 0;"></div>
                </div>
            `;
            
            renderSearchResultsFromCache();
            return;
        } else if (prevItem.type === 'chat') {
            // 返回到聊天页面
            navigationStack.pop(); // 移除搜索项
        }
    }
    
    // 返回到聊天界面
    viewer.style.display = 'none';
    msgs.style.display = 'flex';
    if(inputWrapper) inputWrapper.style.display = 'block';
    navigationStack = []; // 清空栈

    if (originalHeaderState) {
        restoreHeaderState(originalHeaderState);
    } else if (chatHeaderBaseState) {
        restoreHeaderState(chatHeaderBaseState);
    }
    if (wasMailView) clearMailViewUrl();
    originalHeaderState = null;
}

window.openMailPlaceholderView = function() {
    closeKnowledgePanel();
    closeCloudFilePanel();
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight) return;

    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }

    currentViewingKnowledge = null;
    pendingHighlightData = null;
    navigationStack = [];
    if (isMailMobileLayout()) {
        mailViewState.sidebarCollapsed = false;
        saveMailSidebarCollapsedState(false);
    }
    setMailViewUrl(mailViewState.selectedId || '');
    if (mailViewState.folder === 'sent') {
        pollMailNotifyOnly();
    } else {
        updateMailNotifyFromMails(mailViewState.mails, { markChecked: true });
    }

    msgs.style.display = 'none';
    if (inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = '邮件';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <div class="mail-workspace ${mailViewState.sidebarCollapsed ? 'mail-sidebar-collapsed' : ''}" id="mailWorkspace">
            <aside class="mail-sidebar">
                <div class="mail-sidebar-head">
                    <button class="mail-sidebar-toggle-btn" type="button" onclick="toggleMailSidebar()" title="${mailViewState.sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}">
                        <i class="fa-solid ${mailViewState.sidebarCollapsed ? 'fa-angles-right' : 'fa-angles-left'}"></i>
                    </button>
                </div>
                <button class="btn-primary mail-compose-btn" type="button" title="写邮件" onclick="openMailComposeView()">
                    <i class="fa-solid fa-pen-to-square"></i>
                    <span>写邮件</span>
                </button>
                <div class="mail-folder-section">
                    <div class="mail-folder-title">邮箱分组</div>
                    <button class="mail-folder-item ${mailViewState.folder === 'all' ? 'active' : ''}" type="button" id="mailFolderInboxBtn" onclick="setMailFolder('all')">
                        <i class="fa-solid fa-inbox"></i>
                        <span>收件箱</span>
                        <span class="mail-folder-badge" id="mailInboxCountBadge">0</span>
                    </button>
                    <button class="mail-folder-item ${mailViewState.folder === 'unread' ? 'active' : ''}" type="button" id="mailFolderUnreadBtn" onclick="setMailFolder('unread')">
                        <i class="fa-regular fa-envelope"></i>
                        <span>未读</span>
                        <span class="mail-folder-badge alert" id="mailUnreadCountBadge">0</span>
                    </button>
                    <button class="mail-folder-item ${mailViewState.folder === 'sent' ? 'active' : ''}" type="button" id="mailFolderSentBtn" onclick="setMailFolder('sent')">
                        <i class="fa-regular fa-paper-plane"></i>
                        <span>发件箱</span>
                        <span class="mail-folder-badge" id="mailSentCountBadge">0</span>
                    </button>
                </div>
            </aside>
            <section class="mail-list-panel">
                <div class="mail-list-toolbar">
                    <div class="mail-toolbar-title" id="mailToolbarTitle">收件箱</div>
                    <div class="mail-list-search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input id="mailSearchInput" type="text" placeholder="搜索邮件主题 / 发件人">
                    </div>
                </div>
                <div class="mail-list-body" id="mailListBody"></div>
            </section>
            <section class="mail-detail-panel">
                <div class="mail-detail-head">
                    <div class="mail-detail-head-row">
                        <div class="mail-detail-head-left">
                            <button class="mail-mobile-back-btn" type="button" title="返回邮件列表" onclick="backToMailListMobile()">
                                <i class="fa-solid fa-arrow-left"></i>
                            </button>
                            <h3 id="mailDetailTitle">邮件详情</h3>
                        </div>
                        <div class="mail-icon-actions">
                            <button class="mail-icon-btn" type="button" title="刷新" onclick="refreshMailFolder()"><i class="fa-solid fa-rotate-right"></i></button>
                            <button class="mail-icon-btn" type="button" title="回复" onclick="openMailComposeReply()"><i class="fa-solid fa-reply"></i></button>
                            <button class="mail-icon-btn" type="button" title="转发" onclick="openMailComposeForward()"><i class="fa-solid fa-share"></i></button>
                            <button class="mail-icon-btn danger" type="button" title="删除" onclick="deleteCurrentMail()"><i class="fa-regular fa-trash-can"></i></button>
                        </div>
                    </div>
                    <div class="mail-detail-meta" id="mailDetailMeta"></div>
                </div>
                <div class="mail-detail-content" id="mailDetailContent"></div>
            </section>
        </div>
    `;
    setMailMobileDetailMode(false);
    initMailWorkspace();
};

const WORKFLOW_GRAPH_BASE_WIDTH = 1520;
const WORKFLOW_GRAPH_BASE_HEIGHT = 820;

function updateWorkflowCanvasScale() {
    const wrap = document.getElementById('workflowCanvasWrap');
    const fit = document.getElementById('workflowCanvasFit');
    const canvas = document.getElementById('workflowCanvas');
    if (!wrap || !fit || !canvas) return;

    const cs = window.getComputedStyle(wrap);
    const padY = (parseFloat(cs.paddingTop || '0') || 0) + (parseFloat(cs.paddingBottom || '0') || 0);
    const availableHeight = Math.max(120, wrap.clientHeight - padY);
    const scale = Math.min(1, availableHeight / WORKFLOW_GRAPH_BASE_HEIGHT);
    const clamped = Number.isFinite(scale) && scale > 0 ? scale : 1;

    canvas.style.transform = `scale(${clamped})`;
    fit.style.width = `${Math.round(WORKFLOW_GRAPH_BASE_WIDTH * clamped)}px`;
    fit.style.height = `${Math.round(WORKFLOW_GRAPH_BASE_HEIGHT * clamped)}px`;
}

function setWorkflowMainMode(mode) {
    const feed = document.getElementById('workflowMainFeed');
    const designer = document.getElementById('workflowMainDesigner');
    if (!feed || !designer) return;
    const safeMode = String(mode || '').trim().toLowerCase();
    const showDesigner = safeMode === 'designer';
    feed.style.display = showDesigner ? 'none' : 'grid';
    designer.style.display = showDesigner ? 'flex' : 'none';
    if (showDesigner) {
        requestAnimationFrame(() => updateWorkflowCanvasScale());
    }
}

function refreshWorkflowSidebarToggleState() {
    const ws = document.getElementById('workflowSidebar');
    if (!ws) return;
    const btn = ws.querySelector('.workflow-sidebar-toggle');
    if (!btn) return;
    btn.innerHTML = ws.classList.contains('collapsed')
        ? '<i class="fa-solid fa-angles-right"></i>'
        : '<i class="fa-solid fa-angles-left"></i>';
    btn.title = ws.classList.contains('collapsed') ? '展开侧栏' : '折叠侧栏';
}

function setWorkflowSidebarActiveWorkflow(workflowId) {
    const id = String(workflowId || '').trim();
    if (!id) return;
    document.querySelectorAll('.workflow-list-items li[data-workflow-id]').forEach((el) => {
        el.classList.toggle('active', String(el.dataset.workflowId || '') === id);
    });
}

function setWorkflowDesignerTitle(title, subtitle = '') {
    const t = document.getElementById('workflowDesignerTitle');
    const s = document.getElementById('workflowDesignerSub');
    if (t) t.textContent = String(title || '流程画布');
    if (s) s.textContent = String(subtitle || '可视化节点编排（占位）');
}

function selectWorkflowNode(nodeKey) {
    const key = String(nodeKey || '').trim();
    if (!key) return;
    document.querySelectorAll('.workflow-graph-node[data-node-key]').forEach((el) => {
        el.classList.toggle('active', String(el.dataset.nodeKey || '') === key);
    });
}

window.openWorkflowFeed = function() {
    setWorkflowMainMode('feed');
    document.querySelectorAll('.workflow-list-items li[data-workflow-id]').forEach((el) => {
        el.classList.remove('active');
    });
};

window.openWorkflowDesigner = function(workflowId, workflowTitle = '', workflowSub = '') {
    const id = String(workflowId || '').trim();
    if (!id) return;
    const ws = document.getElementById('workflowSidebar');
    if (ws) {
        ws.classList.remove('collapsed');
        refreshWorkflowSidebarToggleState();
    }
    setWorkflowSidebarActiveWorkflow(id);
    setWorkflowDesignerTitle(workflowTitle || '流程画布', workflowSub || '可视化节点编排（占位）');
    setWorkflowMainMode('designer');
    selectWorkflowNode('trigger');
};

window.openWorkflowPlaceholderView = function() {
    closeKnowledgePanel();
    closeCloudFilePanel();

    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight) return;

    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }

    currentViewingKnowledge = null;
    pendingHighlightData = null;
    navigationStack = [];

    msgs.style.display = 'none';
    if (inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = 'AI 自动流程';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <section class="workflow-workspace">
            <aside class="workflow-sidebar" id="workflowSidebar">
                <div class="workflow-sidebar-head">
                    <span class="workflow-sidebar-title">我的 AI 流程</span>
                    <button class="workflow-sidebar-toggle" type="button" title="折叠侧栏" onclick="toggleWorkflowSidebar()">
                        <i class="fa-solid fa-angles-left"></i>
                    </button>
                </div>
                <div class="workflow-sidebar-body">
                    <div class="workflow-sidebar-list">
                        <div class="workflow-list-group open" data-group="running">
                            <button class="workflow-list-group-title" type="button" onclick="toggleWorkflowListGroup('running')">
                                <i class="fa-solid fa-chevron-down"></i>
                                运行中
                            </button>
                            <ul class="workflow-list-items">
                                <li data-workflow-id="wf_daily_sync" onclick="openWorkflowDesigner('wf_daily_sync','日报聚合流程','已运行 42 次 · 平均耗时 11s')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-newspaper workflow-item-icon blue"></i>
                                        <span class="workflow-item-text">
                                            <strong>日报聚合</strong>
                                            <small>09:00 定时</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill success">RUN</span>
                                </li>
                                <li data-workflow-id="wf_kb_refresh" onclick="openWorkflowDesigner('wf_kb_refresh','知识库刷新流程','每 4 小时巡检一次 · 向量增量更新')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-database workflow-item-icon cyan"></i>
                                        <span class="workflow-item-text">
                                            <strong>知识刷新</strong>
                                            <small>增量同步</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill info">IDLE</span>
                                </li>
                            </ul>
                        </div>

                        <div class="workflow-list-group open" data-group="drafts">
                            <button class="workflow-list-group-title" type="button" onclick="toggleWorkflowListGroup('drafts')">
                                <i class="fa-solid fa-chevron-down"></i>
                                草稿
                            </button>
                            <ul class="workflow-list-items">
                                <li data-workflow-id="wf_mail_robot" onclick="openWorkflowDesigner('wf_mail_robot','邮件机器人流程','提取附件摘要并自动分发')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-envelope-open-text workflow-item-icon violet"></i>
                                        <span class="workflow-item-text">
                                            <strong>邮件机器人</strong>
                                            <small>待启用</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill warn">DRAFT</span>
                                </li>
                                <li data-workflow-id="wf_report_export" onclick="openWorkflowDesigner('wf_report_export','周报导出流程','每周五自动导出并分享')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-file-export workflow-item-icon amber"></i>
                                        <span class="workflow-item-text">
                                            <strong>周报导出</strong>
                                            <small>模板流程</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill neutral">NEW</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </aside>

            <div class="workflow-main">
                <div class="workflow-main-feed" id="workflowMainFeed">
                    <div class="workflow-feed-hero">
                        <div class="workflow-badge">Workflow Hub</div>
                        <h2>流程共享与近期动态</h2>
                        <p>默认展示公开流程与最近运行信息。点击左侧流程可进入对应画布。</p>
                    </div>

                    <section class="workflow-share-section">
                        <div class="workflow-section-head">
                            <h3>公开流程共享</h3>
                            <span>本周更新 18</span>
                        </div>
                        <div class="workflow-share-grid">
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag blue">知识库</span>
                                    <span class="workflow-share-uses">1.2k uses</span>
                                </div>
                                <h4>RAG 问答增强链路</h4>
                                <p>检索 + 重排 + 引用输出，适用于企业知识问答。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag cyan">自动化</span>
                                    <span class="workflow-share-uses">830 uses</span>
                                </div>
                                <h4>日报自动汇总</h4>
                                <p>收集群消息、文档、邮件，生成结构化日报。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag violet">运营</span>
                                    <span class="workflow-share-uses">640 uses</span>
                                </div>
                                <h4>多渠道内容分发</h4>
                                <p>从素材库生成多平台版本并自动发布。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag amber">客服</span>
                                    <span class="workflow-share-uses">512 uses</span>
                                </div>
                                <h4>工单分诊助手</h4>
                                <p>自动识别优先级，分配到对应处理人。</p>
                            </article>
                        </div>
                    </section>

                    <section class="workflow-recent-section">
                        <div class="workflow-section-head">
                            <h3>近期流程信息</h3>
                            <span>最近 24 小时</span>
                        </div>
                        <div class="workflow-recent-list">
                            <div class="workflow-recent-item">
                                <span class="dot success"></span>
                                <div>
                                    <strong>日报聚合</strong>
                                    <small>09:00 运行成功，耗时 9.8s，输出 3 条摘要</small>
                                </div>
                            </div>
                            <div class="workflow-recent-item">
                                <span class="dot warn"></span>
                                <div>
                                    <strong>知识刷新</strong>
                                    <small>10:30 部分文档分块失败，已自动重试</small>
                                </div>
                            </div>
                            <div class="workflow-recent-item">
                                <span class="dot info"></span>
                                <div>
                                    <strong>邮件机器人</strong>
                                    <small>新增共享模板版本 v1.3，可直接套用</small>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="workflow-main-designer" id="workflowMainDesigner" style="display:none;">
                    <div class="workflow-designer-head">
                        <div>
                            <h2 id="workflowDesignerTitle">流程画布</h2>
                            <p id="workflowDesignerSub">可视化节点编排（占位）</p>
                        </div>
                        <button type="button" class="workflow-designer-back" onclick="openWorkflowFeed()">返回共享页</button>
                    </div>

                    <div class="workflow-canvas-wrap" id="workflowCanvasWrap">
                        <div class="workflow-canvas-fit" id="workflowCanvasFit">
                            <div class="workflow-canvas workflow-graph" id="workflowCanvas">
                            <svg class="workflow-graph-links" viewBox="0 0 1520 820" preserveAspectRatio="none" aria-hidden="true">
                                <path d="M286 245 C 350 245, 372 185, 460 185"></path>
                                <path d="M286 245 C 350 245, 372 450, 460 450"></path>
                                <path d="M722 185 C 798 185, 822 120, 930 120"></path>
                                <path d="M722 185 C 798 185, 822 285, 930 285"></path>
                                <path d="M722 450 C 798 450, 822 400, 930 400"></path>
                                <path d="M722 450 C 798 450, 822 625, 930 625"></path>
                                <path d="M1192 120 C 1270 120, 1295 245, 1380 245"></path>
                                <path d="M1192 285 C 1270 285, 1295 245, 1380 245"></path>
                                <path d="M1192 400 C 1270 400, 1295 570, 1380 570"></path>
                                <path d="M1192 625 C 1270 625, 1295 570, 1380 570"></path>
                            </svg>

                            <div class="workflow-graph-node tone-trigger n-trigger active" data-node-key="trigger" onclick="selectWorkflowNode('trigger')">
                                <span class="workflow-node-icon"><i class="fa-regular fa-clock"></i></span>
                                <span class="workflow-node-title">触发器</span>
                                <small class="workflow-node-sub">定时 / Webhook</small>
                            </div>
                            <div class="workflow-graph-node tone-process n-a" data-node-key="a" onclick="selectWorkflowNode('a')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-list-check"></i></span>
                                <span class="workflow-node-title">主分支处理</span>
                                <small class="workflow-node-sub">聚合与结构化</small>
                            </div>
                            <div class="workflow-graph-node tone-process n-b" data-node-key="b" onclick="selectWorkflowNode('b')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-shield-halved"></i></span>
                                <span class="workflow-node-title">兜底分支</span>
                                <small class="workflow-node-sub">降级与补偿</small>
                            </div>
                            <div class="workflow-graph-node tone-tool n-a1" data-node-key="a1" onclick="selectWorkflowNode('a1')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                                <span class="workflow-node-title">检索增强</span>
                                <small class="workflow-node-sub">RAG Query</small>
                            </div>
                            <div class="workflow-graph-node tone-tool n-a2" data-node-key="a2" onclick="selectWorkflowNode('a2')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-code-branch"></i></span>
                                <span class="workflow-node-title">逻辑路由</span>
                                <small class="workflow-node-sub">条件分流</small>
                            </div>
                            <div class="workflow-graph-node tone-output n-b1" data-node-key="b1" onclick="selectWorkflowNode('b1')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-envelope"></i></span>
                                <span class="workflow-node-title">通知输出</span>
                                <small class="workflow-node-sub">Mail / IM</small>
                            </div>
                            <div class="workflow-graph-node tone-output n-b2" data-node-key="b2" onclick="selectWorkflowNode('b2')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-floppy-disk"></i></span>
                                <span class="workflow-node-title">存储归档</span>
                                <small class="workflow-node-sub">Knowledge / File</small>
                            </div>
                            <div class="workflow-graph-node tone-end n-end-top" data-node-key="end_a" onclick="selectWorkflowNode('end_a')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-check"></i></span>
                                <span class="workflow-node-title">成功收敛</span>
                                <small class="workflow-node-sub">主路径完成</small>
                            </div>
                            <div class="workflow-graph-node tone-end n-end-bottom" data-node-key="end_b" onclick="selectWorkflowNode('end_b')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-triangle-exclamation"></i></span>
                                <span class="workflow-node-title">异常收敛</span>
                                <small class="workflow-node-sub">兜底完成</small>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
    bindWorkflowCanvasInteractions();
    setWorkflowMainMode('feed');
};

function bindWorkflowCanvasInteractions() {
    const wrap = document.getElementById('workflowCanvasWrap');
    if (!wrap || wrap.dataset.bindDone === '1') return;
    wrap.dataset.bindDone = '1';

    wrap.addEventListener('wheel', (e) => {
        const absX = Math.abs(Number(e.deltaX || 0));
        const absY = Math.abs(Number(e.deltaY || 0));
        if (absY <= absX) return;
        e.preventDefault();
        wrap.scrollLeft += e.deltaY;
    }, { passive: false });

    if (!window.__workflowScaleResizeBound) {
        window.__workflowScaleResizeBound = true;
        window.addEventListener('resize', () => updateWorkflowCanvasScale());
    }
    requestAnimationFrame(() => {
        updateWorkflowCanvasScale();
    });
}

window.toggleWorkflowSidebar = function() {
    const ws = document.getElementById('workflowSidebar');
    if (!ws) return;
    ws.classList.toggle('collapsed');
    refreshWorkflowSidebarToggleState();
    updateWorkflowCanvasScale();
    setTimeout(() => updateWorkflowCanvasScale(), 220);
};

window.toggleWorkflowListGroup = function(groupId) {
    const key = String(groupId || '').trim();
    if (!key) return;
    const root = document.querySelector(`.workflow-list-group[data-group="${key}"]`);
    if (!root) return;
    root.classList.toggle('open');
};

window.copyGeneratedInfo = async function(index) {
    try {
        const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
        if (!messageDiv) return;
        const clone = messageDiv.cloneNode(true);
        clone.querySelectorAll('.msg-actions,.version-switcher,.thinking-block,.tool-usage,.model-badge,.add-basis-view').forEach(el => el.remove());
        const contentRoot = clone.querySelector('.message-content') || clone;
        const bodyTexts = Array.from(contentRoot.querySelectorAll('.content-body'))
            .map((el) => String(el.innerText || '').trim())
            .filter(Boolean);
        const text = String(bodyTexts.length ? bodyTexts.join('\n\n') : (contentRoot.innerText || '')).trim();
        if (!text) {
            showToast('没有可复制的生成信息');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        showToast('已复制生成信息');
    } catch (e) {
        console.error('copyGeneratedInfo failed', e);
        showToast('复制失败');
    }
};

function formatMailTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    const d = new Date(n * 1000);
    return d.toLocaleString();
}

function getMailDateGroupKey(ts) {
    const n = Number(ts || 0);
    if (!n) return 'unknown';
    const d = new Date(n * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getMailDateGroupLabel(groupKey) {
    if (!groupKey || groupKey === 'unknown') return '未知日期';
    const today = new Date();
    const ty = today.getFullYear();
    const tm = String(today.getMonth() + 1).padStart(2, '0');
    const td = String(today.getDate()).padStart(2, '0');
    const todayKey = `${ty}-${tm}-${td}`;
    if (groupKey === todayKey) return '今天';
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    const yy = yest.getFullYear();
    const ym = String(yest.getMonth() + 1).padStart(2, '0');
    const yd = String(yest.getDate()).padStart(2, '0');
    const yestKey = `${yy}-${ym}-${yd}`;
    if (groupKey === yestKey) return '昨天';
    return groupKey;
}

function parseRawMail(raw) {
    const src = String(raw || '');
    const splitMatch = src.match(/\r?\n\r?\n/);
    let headText = '';
    let body = src;
    if (splitMatch) {
        const idx = splitMatch.index || 0;
        headText = src.slice(0, idx);
        body = src.slice(idx + splitMatch[0].length);
    }

    const headers = {};
    if (headText) {
        const lines = headText.split(/\r?\n/);
        let currentKey = '';
        for (const line of lines) {
            if (!line) continue;
            if ((line.startsWith(' ') || line.startsWith('\t')) && currentKey) {
                headers[currentKey] = `${headers[currentKey] || ''} ${line.trim()}`.trim();
                continue;
            }
            const p = line.indexOf(':');
            if (p <= 0) continue;
            const k = line.slice(0, p).trim().toLowerCase();
            const v = line.slice(p + 1).trim();
            headers[k] = v;
            currentKey = k;
        }
    }

    const ct = String(headers['content-type'] || '').toLowerCase();
    const isHtml = ct.includes('text/html') || /<html[\s>]|<body[\s>]|<div[\s>]|<table[\s>]/i.test(body);
    body = decodeUnicodeEscapes(body);
    return { headers, body, isHtml };
}

function decodeUnicodeEscapes(text) {
    const src = String(text || '');
    if (!src || (src.indexOf('\\u') < 0 && src.indexOf('\\U') < 0 && src.indexOf('\\x') < 0)) return src;
    return src
        .replace(/\\U([0-9a-fA-F]{8})/g, (_, h) => {
            try {
                return String.fromCodePoint(parseInt(h, 16));
            } catch (e) {
                return `\\U${h}`;
            }
        })
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function extractMailSnippet(rawLike) {
    const parsed = parseRawMail(rawLike);
    const plain = parsed.isHtml ? htmlToText(parsed.body) : String(parsed.body || '').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    return plain.length > 110 ? `${plain.slice(0, 110)}...` : plain;
}

function getMailPlainTextForQuote(mail) {
    const m = mail || {};
    const text = decodeUnicodeEscapes(String(m.content_text || '')).trim();
    if (text) return text;

    const html = decodeUnicodeEscapes(String(m.content_html || '')).trim();
    if (html) return htmlToText(html);

    const raw = decodeUnicodeEscapes(String(m.content || '')).trim();
    if (raw) {
        const parsed = parseRawMail(raw);
        const body = String(parsed.body || '').trim();
        if (!body) return '';
        return parsed.isHtml ? htmlToText(body) : decodeUnicodeEscapes(body);
    }

    return decodeUnicodeEscapes(String(m.preview_text || '')).trim();
}

function getMailHtmlForForward(mail) {
    const m = mail || {};
    const html = decodeUnicodeEscapes(String(m.content_html || '')).trim();
    if (html) return html;

    const raw = decodeUnicodeEscapes(String(m.content || '')).trim();
    if (!raw) return '';
    const parsed = parseRawMail(raw);
    if (parsed.isHtml) {
        return String(parsed.body || '').trim();
    }
    return '';
}

function parseMailReadState(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

function normalizeMailItem(item) {
    const m = (item && typeof item === 'object') ? item : {};
    return {
        ...m,
        id: String(m.id || ''),
        is_read: parseMailReadState(m.is_read)
    };
}

function getVisibleMailsByFolder() {
    const all = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    if (mailViewState.folder === 'sent') {
        return all;
    }
    if (mailViewState.folder === 'unread') {
        return all.filter((m) => !parseMailReadState(m.is_read));
    }
    return all;
}

function getMailFolderTitle() {
    if (mailViewState.folder === 'unread') return '未读邮件';
    if (mailViewState.folder === 'sent') return '发件箱';
    return '收件箱';
}

function updateMailFolderUiState() {
    const inboxBtn = document.getElementById('mailFolderInboxBtn');
    const unreadBtn = document.getElementById('mailFolderUnreadBtn');
    const sentBtn = document.getElementById('mailFolderSentBtn');
    if (inboxBtn) inboxBtn.classList.toggle('active', mailViewState.folder === 'all');
    if (unreadBtn) unreadBtn.classList.toggle('active', mailViewState.folder === 'unread');
    if (sentBtn) sentBtn.classList.toggle('active', mailViewState.folder === 'sent');
    const titleEl = document.getElementById('mailToolbarTitle');
    if (titleEl) titleEl.textContent = getMailFolderTitle();
}

function updateMailItemInState(item) {
    const normalized = normalizeMailItem(item);
    const id = String(normalized.id || '');
    if (!id) return;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const idx = list.findIndex((m) => String(m.id || '') === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...normalized };
    } else {
        list.unshift(normalized);
    }
    mailViewState.mails = list;
}

function setMailReadStateLocal(mailId, isRead) {
    const id = String(mailId || '');
    if (!id) return;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const idx = list.findIndex((m) => String(m.id || '') === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], is_read: !!isRead };
        mailViewState.mails = list;
    }
    if (mailViewState.currentMail && String(mailViewState.currentMail.id || '') === id) {
        mailViewState.currentMail = { ...mailViewState.currentMail, is_read: !!isRead };
    }
}

async function markMailRead(mailId, isRead = true) {
    const id = String(mailId || '');
    if (!id) return false;
    const list = Array.isArray(mailViewState.mails) ? mailViewState.mails : [];
    const target = list.find((m) => String(m.id || '') === id);
    const oldValue = target ? !!target.is_read : false;
    if (oldValue === !!isRead) return true;

    // optimistic update for immediate UX: unread item moves to read section on open
    setMailReadStateLocal(id, !!isRead);
    renderMailList();

    try {
        const res = await fetch(`/api/mail/me/inbox/${encodeURIComponent(id)}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: !!isRead })
        });
        const data = await res.json();
        if (!data.success) {
            setMailReadStateLocal(id, oldValue);
            renderMailList();
            return false;
        }
        if (data.mail && typeof data.mail === 'object') {
            updateMailItemInState(data.mail);
        } else {
            setMailReadStateLocal(id, !!data.is_read);
        }
        renderMailList();
        return true;
    } catch (err) {
        setMailReadStateLocal(id, oldValue);
        renderMailList();
        return false;
    }
}

function renderMailDetailEmpty(text) {
    mailViewState.mode = (mailViewState.folder === 'sent') ? 'sent' : 'inbox';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    renderMailInboxActions();
    if (titleEl) titleEl.textContent = '邮件详情';
    if (metaEl) metaEl.innerHTML = '';
    if (contentEl) {
        contentEl.innerHTML = `<div class="mail-empty-state">${escapeHtml(text || '暂无邮件')}</div>`;
    }
}

function renderMailInboxActions() {
    const actionsEl = document.querySelector('.mail-icon-actions');
    if (!actionsEl) return;
    if (mailViewState.folder === 'sent') {
        actionsEl.innerHTML = `
            <button class="mail-icon-btn" type="button" title="刷新" onclick="refreshMailFolder()"><i class="fa-solid fa-rotate-right"></i></button>
            <button class="mail-icon-btn" type="button" title="转发" onclick="openMailComposeForward()"><i class="fa-solid fa-share"></i></button>
            <button class="mail-icon-btn danger" type="button" title="删除" onclick="deleteCurrentMail()"><i class="fa-regular fa-trash-can"></i></button>
        `;
        return;
    }
    actionsEl.innerHTML = `
        <button class="mail-icon-btn" type="button" title="刷新" onclick="refreshMailFolder()"><i class="fa-solid fa-rotate-right"></i></button>
        <button class="mail-icon-btn" type="button" title="回复" onclick="openMailComposeReply()"><i class="fa-solid fa-reply"></i></button>
        <button class="mail-icon-btn" type="button" title="转发" onclick="openMailComposeForward()"><i class="fa-solid fa-share"></i></button>
        <button class="mail-icon-btn danger" type="button" title="删除" onclick="deleteCurrentMail()"><i class="fa-regular fa-trash-can"></i></button>
    `;
}

function renderMailComposeForm(preset = {}) {
    mailViewState.mode = 'compose';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    const actionsEl = document.querySelector('.mail-icon-actions');
    if (!contentEl) return;

    const localMail = ((mailViewState.status || {}).local_mail || {});
    const sender = (mailViewState.status || {}).sender_address || localMail.address || localMail.username || '-';
    const toValue = String(preset.recipient || '').trim();
    const subjectValue = String(preset.subject || '').trim();
    const bodyValue = String(preset.content || '');
    const isHtml = !!preset.is_html;

    if (titleEl) titleEl.textContent = '写邮件';
    if (metaEl) {
        metaEl.innerHTML = `<span><i class="fa-regular fa-user"></i> 发件人: ${escapeHtml(sender)}</span>`;
    }
    if (actionsEl) {
        actionsEl.innerHTML = `
            <button class="mail-icon-btn" type="button" title="返回邮件列表" onclick="returnToInboxView()"><i class="fa-solid fa-inbox"></i></button>
            <button class="mail-icon-btn" type="button" title="发送" onclick="submitMailCompose()"><i class="fa-solid fa-paper-plane"></i></button>
        `;
    }

    contentEl.innerHTML = `
        <div class="mail-compose-form">
            <div class="form-group">
                <label>收件人</label>
                <input id="mailComposeTo" class="input-modern" type="text" placeholder="例如: user@example.com" value="${escapeHtml(toValue)}">
            </div>
            <div class="form-group">
                <label>主题</label>
                <input id="mailComposeSubject" class="input-modern" type="text" placeholder="邮件主题" value="${escapeHtml(subjectValue)}">
            </div>
            <div class="form-group">
                <label>内容</label>
                <textarea id="mailComposeContent" class="input-modern" style="min-height: 300px; resize: vertical;" placeholder="输入邮件内容...">${escapeHtml(bodyValue)}</textarea>
            </div>
            <div class="mail-compose-actions">
                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#64748b;">
                    <input id="mailComposeIsHtml" type="checkbox" ${isHtml ? 'checked' : ''}>
                    以 HTML 发送
                </label>
                <div class="mail-compose-btn-row">
                    <button class="btn-primary-outline btn-compact mail-compose-cancel-btn" type="button" onclick="returnToInboxView()">取消</button>
                    <button class="btn-primary btn-compact mail-compose-send-btn" type="button" onclick="submitMailCompose()">发送</button>
                </div>
            </div>
        </div>
    `;
}

function renderMailList() {
    const listEl = document.getElementById('mailListBody');
    const inboxBadgeEl = document.getElementById('mailInboxCountBadge');
    const unreadBadgeEl = document.getElementById('mailUnreadCountBadge');
    const sentBadgeEl = document.getElementById('mailSentCountBadge');
    if (!listEl) return;
    const prevScrollTop = listEl.scrollTop;
    const mails = (Array.isArray(mailViewState.mails) ? mailViewState.mails : []).map(normalizeMailItem);
    if (mailViewState.folder === 'sent') {
        mailViewState.sentTotal = mails.length;
    } else {
        mailViewState.inboxTotal = mails.length;
        mailViewState.unreadTotal = mails.filter((m) => !m.is_read).length;
    }
    const inboxCount = Math.max(0, Number(mailViewState.inboxTotal || 0));
    const unreadCount = Math.max(0, Number(mailViewState.unreadTotal || 0));
    const sentCount = Math.max(0, Number(mailViewState.sentTotal || 0));
    if (inboxBadgeEl) inboxBadgeEl.textContent = inboxCount > 99 ? '99+' : String(inboxCount);
    if (unreadBadgeEl) {
        unreadBadgeEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        unreadBadgeEl.classList.toggle('muted', unreadCount === 0);
    }
    if (sentBadgeEl) sentBadgeEl.textContent = sentCount > 99 ? '99+' : String(sentCount);

    updateMailFolderUiState();

    const visibleMails = getVisibleMailsByFolder().map(normalizeMailItem);
    if (visibleMails.length === 0) {
        const emptyText = mailViewState.folder === 'unread'
            ? '暂无未读邮件'
            : (mailViewState.folder === 'sent' ? '暂无发件记录' : '暂无邮件');
        listEl.innerHTML = `<div class="mail-empty-state">${emptyText}</div>`;
        saveMailListScroll(0);
        return;
    }

    const grouped = {};
    const groupOrder = [];
    for (const m of visibleMails) {
        const key = getMailDateGroupKey(m.timestamp);
        if (!grouped[key]) {
            grouped[key] = [];
            groupOrder.push(key);
        }
        grouped[key].push(m);
    }

    const renderSection = (groupKey, sectionMails) => {
        const title = getMailDateGroupLabel(groupKey);
        const sectionItems = sectionMails.map((m) => {
            const id = String(m.id || '');
            const eid = encodeURIComponent(id);
            const active = id === mailViewState.selectedId ? 'active' : '';
            const sender = m.sender || '-';
            const recipient = m.recipient || '-';
            const roleLabel = mailViewState.folder === 'sent' ? '收件人' : '来自';
            const roleValue = mailViewState.folder === 'sent' ? recipient : sender;
            const subject = m.subject || '(No Subject)';
            const snippet = extractMailSnippet(m.preview_text || m.preview || '');
            const unreadDot = (mailViewState.folder === 'sent' || m.is_read) ? '' : '<span class="mail-unread-dot" title="未读"></span>';
            return `
                <div class="mail-list-item ${active}" data-mail-eid="${eid}" onclick="selectMailItemById('${eid}')">
                    <div class="mail-list-top">
                        <span class="mail-subject-row">${unreadDot}<span class="mail-subject">${escapeHtml(subject)}</span></span>
                        <span class="mail-time">${escapeHtml(formatMailTime(m.timestamp))}</span>
                    </div>
                    <div class="mail-sender">${escapeHtml(roleLabel)}: ${escapeHtml(roleValue)}</div>
                    <div class="mail-snippet">${escapeHtml(snippet)}</div>
                </div>
            `;
        }).join('');
        return `
            <div class="mail-list-section">
                <div class="mail-list-section-title">${escapeHtml(title)} <span class="mail-list-section-count">${sectionMails.length}</span></div>
                ${sectionItems}
            </div>
        `;
    };

    listEl.innerHTML = groupOrder.map((k) => renderSection(k, grouped[k])).join('');

    if (mailViewState.restorePositionOnce) {
        const savedId = String(mailViewState.selectedId || '');
        const savedEid = encodeURIComponent(savedId);
        const activeEl = savedId ? listEl.querySelector(`.mail-list-item[data-mail-eid="${savedEid}"]`) : null;
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'center' });
        } else {
            listEl.scrollTop = loadMailListScroll();
        }
        mailViewState.restorePositionOnce = false;
    } else {
        listEl.scrollTop = prevScrollTop;
    }
}

async function loadMailCurrentFolder(query = '', options = {}) {
    if (mailViewState.folder === 'sent') {
        return loadMailSent(query, options);
    }
    return loadMailInbox(query, options);
}

async function loadMailInbox(query = '', options = {}) {
    const silent = !!(options && options.silent);
    const refreshDetail = !options || options.refreshDetail !== false;
    const forceNetwork = !!(options && options.forceNetwork);
    const requestId = ++mailViewState.inboxRequestId;
    const listEl = document.getElementById('mailListBody');
    if (!silent && listEl) listEl.innerHTML = `<div class="mail-empty-state">正在加载收件箱...</div>`;
    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const q = params.toString();
        const res = await fetch(`/api/mail/me/inbox${q ? `?${q}` : ''}`);
        const data = await res.json();
        if (requestId !== mailViewState.inboxRequestId) return;
        if (!data.success) {
            mailViewState.mails = [];
            mailViewState.selectedId = '';
            mailViewState.inboxTotal = 0;
            mailViewState.unreadTotal = 0;
            renderMailList();
            if (mailViewState.mode !== 'compose') {
                renderMailDetailEmpty(data.message || '收件箱加载失败');
            }
            return;
        }
        mailViewState.mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        mailViewState.inboxTotal = Number(data.total || mailViewState.mails.length || 0);
        mailViewState.unreadTotal = Number(data.unread_total || mailViewState.mails.filter((m) => !m.is_read).length || 0);
        updateMailNotifyFromMails(mailViewState.mails, { markChecked: isMailViewActiveInDom() });
        const visible = getVisibleMailsByFolder();
        if (!mailViewState.selectedId || !visible.some((m) => String(m.id || '') === mailViewState.selectedId)) {
            mailViewState.selectedId = visible[0] ? String(visible[0].id || '') : '';
        }
        saveMailSelectedId(mailViewState.selectedId);
        if (isMailViewActiveInDom()) {
            setMailViewUrl(mailViewState.selectedId || '');
        }
        renderMailList();
        const mobileAutoOpenAllowed = !isMailMobileLayout() || !!getMailIdFromUrl() || !!options.forceDetail;
        if (refreshDetail && mailViewState.selectedId && mailViewState.mode !== 'compose' && mobileAutoOpenAllowed) {
            await loadMailDetail(mailViewState.selectedId, { markAsRead: false });
        } else if (refreshDetail && mailViewState.mode !== 'compose') {
            setMailMobileDetailMode(false);
            renderMailDetailEmpty('收件箱为空');
        }
    } catch (err) {
        if (requestId !== mailViewState.inboxRequestId) return;
        mailViewState.mails = [];
        mailViewState.selectedId = '';
        mailViewState.inboxTotal = 0;
        mailViewState.unreadTotal = 0;
        renderMailList();
        if (mailViewState.mode !== 'compose') {
            renderMailDetailEmpty('邮件服务连接失败');
        }
    }
}

async function loadMailSent(query = '', options = {}) {
    const silent = !!(options && options.silent);
    const refreshDetail = !options || options.refreshDetail !== false;
    const forceNetwork = !!(options && options.forceNetwork);
    const requestId = ++mailViewState.inboxRequestId;
    const listEl = document.getElementById('mailListBody');
    if (!silent && listEl) listEl.innerHTML = `<div class="mail-empty-state">正在加载发件箱...</div>`;
    try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const q = params.toString();
        const res = await fetch(`/api/mail/me/sent${q ? `?${q}` : ''}`);
        const data = await res.json();
        if (requestId !== mailViewState.inboxRequestId) return;
        if (!data.success) {
            mailViewState.mails = [];
            mailViewState.selectedId = '';
            mailViewState.sentTotal = 0;
            renderMailList();
            if (mailViewState.mode !== 'compose') {
                renderMailDetailEmpty(data.message || '发件箱加载失败');
            }
            return;
        }
        mailViewState.mails = Array.isArray(data.mails) ? data.mails.map(normalizeMailItem) : [];
        mailViewState.sentTotal = Number(data.total || mailViewState.mails.length || 0);
        const visible = getVisibleMailsByFolder();
        if (!mailViewState.selectedId || !visible.some((m) => String(m.id || '') === mailViewState.selectedId)) {
            mailViewState.selectedId = visible[0] ? String(visible[0].id || '') : '';
        }
        saveMailSelectedId(mailViewState.selectedId);
        if (isMailViewActiveInDom()) {
            setMailViewUrl(mailViewState.selectedId || '');
        }
        renderMailList();
        const mobileAutoOpenAllowed = !isMailMobileLayout() || !!getMailIdFromUrl() || !!options.forceDetail;
        if (refreshDetail && mailViewState.selectedId && mailViewState.mode !== 'compose' && mobileAutoOpenAllowed) {
            await loadMailDetail(mailViewState.selectedId, { markAsRead: false });
        } else if (refreshDetail && mailViewState.mode !== 'compose') {
            setMailMobileDetailMode(false);
            renderMailDetailEmpty('发件箱为空');
        }
    } catch (err) {
        if (requestId !== mailViewState.inboxRequestId) return;
        mailViewState.mails = [];
        mailViewState.selectedId = '';
        mailViewState.sentTotal = 0;
        renderMailList();
        if (mailViewState.mode !== 'compose') {
            renderMailDetailEmpty('邮件服务连接失败');
        }
    }
}

async function loadMailDetail(mailId, options = {}) {
    if (!mailId) {
        renderMailDetailEmpty('请选择一封邮件');
        return;
    }
    const requestId = ++mailViewState.detailRequestId;
    const markAsRead = !!options.markAsRead;
    const forceNetwork = !!options.forceNetwork;
    const viewingSent = mailViewState.folder === 'sent';
    const titleEl = document.getElementById('mailDetailTitle');
    const metaEl = document.getElementById('mailDetailMeta');
    const contentEl = document.getElementById('mailDetailContent');
    renderMailInboxActions();
    if (titleEl) titleEl.textContent = '正在加载...';
    if (metaEl) metaEl.innerHTML = '';
    if (contentEl) contentEl.innerHTML = `<div class="mail-empty-state">正在加载邮件详情...</div>`;
    try {
        const basePath = viewingSent ? '/api/mail/me/sent' : '/api/mail/me/inbox';
        const params = new URLSearchParams();
        params.set('cache_mode', forceNetwork ? 'refresh' : 'cache_first');
        const res = await fetch(`${basePath}/${encodeURIComponent(mailId)}?${params.toString()}`);
        const data = await res.json();
        if (requestId !== mailViewState.detailRequestId) return;
        if (mailViewState.mode === 'compose') return;
        if (!data.success || !data.mail) {
            renderMailDetailEmpty(data.message || (viewingSent ? '读取发件失败' : '读取邮件失败'));
            return;
        }
        const mail = normalizeMailItem(data.mail);
        updateMailItemInState(mail);
        mailViewState.currentMail = mail;
        mailViewState.mode = viewingSent ? 'sent' : 'inbox';
        setMailMobileDetailMode(true);
        const parsed = parseRawMail(mail.content || '');
        const senderLine = mail.sender || parsed.headers['from'] || '-';
        const recipientLine = mail.recipient || parsed.headers['to'] || '-';
        const dateLine = mail.date || parsed.headers['date'] || formatMailTime(mail.timestamp);
        if (titleEl) titleEl.textContent = mail.subject || parsed.headers['subject'] || '(No Subject)';
        if (metaEl) {
            if (viewingSent) {
                metaEl.innerHTML = `
                    <span><i class="fa-regular fa-paper-plane"></i> 发件人: ${escapeHtml(senderLine)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(dateLine)}</span>
                    <span><i class="fa-regular fa-envelope"></i> 收件人: ${escapeHtml(recipientLine)}</span>
                `;
            } else {
                metaEl.innerHTML = `
                    <span><i class="fa-regular fa-user"></i> ${escapeHtml(senderLine)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(dateLine)}</span>
                    <span><i class="fa-regular fa-envelope"></i> ${escapeHtml(recipientLine)}</span>
                `;
            }
        }
        if (contentEl) {
            const htmlBody = decodeUnicodeEscapes(String(mail.content_html || '').trim());
            const textBody = decodeUnicodeEscapes(String(mail.content_text || '').trim());
            const rawBody = String(parsed.body || '').trim();
            if (!htmlBody && !textBody && !rawBody) {
                contentEl.innerHTML = `<div class="mail-empty-state">邮件内容为空</div>`;
            } else if (htmlBody) {
                contentEl.innerHTML = `<iframe class="mail-html-frame" title="mail-html" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`;
                const frame = contentEl.querySelector('.mail-html-frame');
                if (frame) {
                    frame.srcdoc = rewriteHtmlDocumentLinksToNewTab(htmlBody);
                }
            } else if (textBody) {
                contentEl.innerHTML = `<pre class="mail-raw-content">${escapeHtml(textBody)}</pre>`;
            } else if (parsed.isHtml) {
                contentEl.innerHTML = `<iframe class="mail-html-frame" title="mail-html" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`;
                const frame = contentEl.querySelector('.mail-html-frame');
                if (frame) frame.srcdoc = rewriteHtmlDocumentLinksToNewTab(rawBody);
            } else {
                contentEl.innerHTML = `<pre class="mail-raw-content">${escapeHtml(rawBody)}</pre>`;
            }
        }
        if (!viewingSent && markAsRead && !mail.is_read) {
            await markMailRead(mailId, true);
        }
    } catch (err) {
        if (requestId !== mailViewState.detailRequestId) return;
        if (mailViewState.mode === 'compose') return;
        renderMailDetailEmpty(viewingSent ? '读取发件失败' : '读取邮件失败');
    }
}

async function initMailWorkspace() {
    setMailMobileDetailMode(false);
    mailViewState.selectedId = getMailIdFromUrl() || loadMailSelectedId() || mailViewState.selectedId || '';
    mailViewState.restorePositionOnce = true;

    const listEl = document.getElementById('mailListBody');
    if (listEl && listEl.dataset.scrollBind !== '1') {
        listEl.dataset.scrollBind = '1';
        listEl.addEventListener('scroll', () => saveMailListScroll(listEl.scrollTop));
    }

    const searchEl = document.getElementById('mailSearchInput');
    if (searchEl) {
        searchEl.value = mailViewState.query || '';
        searchEl.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                mailViewState.query = (searchEl.value || '').trim();
                await loadMailCurrentFolder(mailViewState.query);
            }
        });
    }

    try {
        const statusRes = await fetch('/api/mail/me/status');
        const statusData = await statusRes.json();
        mailViewState.status = statusData;
        if (!statusData.success || !statusData.enabled) {
            renderMailList();
            renderMailDetailEmpty(statusData.message || '邮件系统未启用');
            return;
        }
        if (!statusData.linked) {
            renderMailList();
            renderMailDetailEmpty('当前用户未绑定邮箱账号，请联系管理员在设置中绑定');
            return;
        }
    } catch (err) {
        renderMailList();
        renderMailDetailEmpty('无法获取邮件状态');
        return;
    }
    await loadMailCurrentFolder(mailViewState.query || '');
}

window.selectMailItemById = async function(encodedMailId) {
    const mailId = decodeURIComponent(encodedMailId || '');
    if (!mailId) return;
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    mailViewState.selectedId = mailId;
    saveMailSelectedId(mailId);
    if (isMailViewActiveInDom()) {
        setMailViewUrl(mailId);
    }
    renderMailList();
    await loadMailDetail(mailId, { markAsRead: mailViewState.folder !== 'sent' });
    setMailMobileDetailMode(true);
};

window.refreshMailInbox = async function() {
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    await loadMailCurrentFolder(mailViewState.query || '', { forceNetwork: true });
};

window.refreshMailFolder = window.refreshMailInbox;

window.setMailFolder = async function(folder) {
    const f = String(folder || '').toLowerCase();
    if (f === 'sent') mailViewState.folder = 'sent';
    else if (f === 'unread') mailViewState.folder = 'unread';
    else mailViewState.folder = 'all';
    mailViewState.selectedId = '';
    saveMailSelectedId('');
    setMailMobileDetailMode(false);
    if (isMailViewActiveInDom()) {
        setMailViewUrl('');
    }
    renderMailList();
    renderMailDetailEmpty(mailViewState.folder === 'sent' ? '正在加载发件箱...' : '正在加载收件箱...');
    await loadMailCurrentFolder(mailViewState.query || '');
};

window.deleteCurrentMail = async function() {
    if (mailViewState.mode === 'compose') {
        showToast('写邮件模式下无法删除');
        return;
    }
    const id = String(mailViewState.selectedId || '');
    if (!id) {
        showToast('请选择要删除的邮件');
        return;
    }
    try {
        const basePath = mailViewState.folder === 'sent' ? '/api/mail/me/sent' : '/api/mail/me/inbox';
        const res = await fetch(`${basePath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '删除失败');
            return;
        }
        showToast(mailViewState.folder === 'sent' ? '发件记录已删除' : '邮件已删除');
        mailViewState.selectedId = '';
        saveMailSelectedId('');
        await loadMailCurrentFolder(mailViewState.query || '');
    } catch (err) {
        showToast('删除失败');
    }
};

window.returnToInboxView = async function() {
    mailViewState.mode = mailViewState.folder === 'sent' ? 'sent' : 'inbox';
    setMailMobileDetailMode(false);
    renderMailDetailEmpty('请选择一封邮件');
    if (mailViewState.selectedId) {
        await loadMailDetail(mailViewState.selectedId);
    }
};

window.openMailComposeView = function(preset = {}) {
    setMailViewUrl('');
    setMailMobileDetailMode(true);
    renderMailComposeForm(preset);
};

window.backToMailListMobile = function() {
    setMailMobileDetailMode(false);
};

window.openMailComposeReply = function() {
    const m = mailViewState.currentMail || null;
    if (!m) {
        showToast('请先选择一封邮件');
        return;
    }
    const recipient = String(m.sender || '').replace(/[<>]/g, '').trim();
    const subject = String(m.subject || '').startsWith('Re:') ? String(m.subject || '') : `Re: ${m.subject || ''}`;
    const bodyText = getMailPlainTextForQuote(m);
    const quote = bodyText ? `\n\n\n----- 原邮件 -----\n${bodyText}` : '';
    openMailComposeView({ recipient, subject, content: quote, is_html: false });
};

window.openMailComposeForward = function() {
    const m = mailViewState.currentMail || null;
    if (!m) {
        showToast('请先选择一封邮件');
        return;
    }
    const subject = String(m.subject || '').startsWith('Fwd:') ? String(m.subject || '') : `Fwd: ${m.subject || ''}`;
    const htmlBody = getMailHtmlForForward(m);
    if (htmlBody) {
        const quoteHtml = `
<div style="margin-top: 18px; padding-top: 12px; border-top: 1px solid #dbe3ef; color: #475569; font-size: 12px;">
  ----- 转发内容 -----
</div>
${htmlBody}
        `.trim();
        openMailComposeView({ recipient: '', subject, content: quoteHtml, is_html: true });
        return;
    }

    const bodyText = getMailPlainTextForQuote(m);
    const quote = bodyText ? `\n\n\n----- 转发内容 -----\n${bodyText}` : '';
    openMailComposeView({ recipient: '', subject, content: quote, is_html: false });
};

window.submitMailCompose = async function() {
    if (mailViewState.isSending) {
        showToast('邮件正在发送，请稍候...');
        return;
    }
    const toEl = document.getElementById('mailComposeTo');
    const subjectEl = document.getElementById('mailComposeSubject');
    const bodyEl = document.getElementById('mailComposeContent');
    const htmlEl = document.getElementById('mailComposeIsHtml');
    if (!toEl || !subjectEl || !bodyEl) return;

    const recipient = (toEl.value || '').trim();
    const subject = (subjectEl.value || '').trim();
    const content = bodyEl.value || '';
    const is_html = !!(htmlEl && htmlEl.checked);
    if (!recipient) {
        showToast('请输入收件人');
        return;
    }
    if (!content.trim()) {
        showToast('请输入邮件内容');
        return;
    }
    const payload = { recipient, subject, content, is_html };

    mailViewState.isSending = true;
    mailViewState.mode = 'inbox';
    renderMailDetailEmpty('邮件发送中，请稍候...');
    showToast('已提交发送请求');

    (async () => {
        try {
            const res = await fetch('/api/mail/me/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || '发送失败');
                return;
            }
            showToast('邮件已发送');
            if (mailViewState.folder !== 'sent') {
                mailViewState.sentTotal = Math.max(0, Number(mailViewState.sentTotal || 0) + 1);
                renderMailList();
            }
            await loadMailCurrentFolder(mailViewState.query || '');
        } catch (err) {
            showToast('发送失败');
        } finally {
            mailViewState.isSending = false;
        }
    })();
};

window.toggleMailSidebar = function() {
    mailViewState.sidebarCollapsed = !mailViewState.sidebarCollapsed;
    saveMailSidebarCollapsedState(mailViewState.sidebarCollapsed);
    const workspace = document.getElementById('mailWorkspace');
    if (workspace) workspace.classList.toggle('mail-sidebar-collapsed', mailViewState.sidebarCollapsed);
    const btn = document.querySelector('.mail-sidebar-toggle-btn');
    if (btn) {
        btn.title = mailViewState.sidebarCollapsed ? '展开侧栏' : '折叠侧栏';
        btn.innerHTML = `<i class="fa-solid ${mailViewState.sidebarCollapsed ? 'fa-angles-right' : 'fa-angles-left'}"></i>`;
    }
};

// --- Knowledge Search ---
let lastKnowledgeSearchResults = [];

async function handleKnowledgeSearch() {
    const input = els.knowledgeSearchInput;
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;
    await searchKnowledgeVectors(query);
}

async function searchKnowledgeVectors(query) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    // 关闭任何可能打开的知识库详情视图
    if (currentViewingKnowledge) {
        closeKnowledgeView();
    }
    
    // 导航栈管理：如果还没有搜索项在栈上，保存聊天页面状态
    if (navigationStack.length === 0) {
        // 第一次进入搜索，保存初始的聊天页面状态
        navigationStack.push({
            type: 'chat',
            state: {
                title: headerTitle.textContent,
                leftHTML: headerLeft.innerHTML,
                rightHTML: headerRight.innerHTML
            }
        });
    }
    
    // 保存原始状态（兼容旧代码）
    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
    
    // 显示搜索结果视图
    msgs.style.display = 'none';
    if(inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';
    
    // 更新Header
    headerTitle.textContent = '向量库搜索';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeSearchResultView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);
    
    // 更新viewer为搜索结果显示区
    viewer.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
            <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <div style="font-size: 14px; color: #64748b;">搜索: <strong style="color: #0f172a;">${escapeHtml(query)}</strong></div>
            </div>
            <div id="knowledgeSearchResultsList" style="flex: 1; overflow-y: auto; padding: 0;"></div>
        </div>
    `;
    
    const resultsList = document.getElementById('knowledgeSearchResultsList');
    resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">搜索中...</div>';
    
    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 8 })
        });
        const data = await res.json();
        if (!data.success) {
            resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">${data.message || '搜索失败'}</div>`;
            return;
        }
        const docs = (data.result && data.result.documents && data.result.documents[0]) ? data.result.documents[0] : [];
        const metas = (data.result && data.result.metadatas && data.result.metadatas[0]) ? data.result.metadatas[0] : [];
        const dists = (data.result && data.result.distances && data.result.distances[0]) ? data.result.distances[0] : [];
        if (docs.length === 0) {
            resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">没有结果</div>';
            return;
        }
        lastKnowledgeSearchResults = docs.map((doc, i) => ({
            doc,
            meta: metas[i] || {},
            dist: dists[i]
        }));

        resultsList.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
            const title = item.meta.title || 'Untitled';
            const preview = (item.doc || '').slice(0, 200);
            const score = item.dist != null ? (1 - item.dist) : 0;
            return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
                <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
                <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
            </div>`;
        }).join('');

        // 添加搜索结果的点击处理
        bindSearchResultHandlers();
        
        // 搜索结果加载完成后，保存搜索页面状态到栈
        currentSearchQuery = query;
        navigationStack.push({
            type: 'search',
            query: query,
            // 不保存 HTML，而是保存查询信息，返回时重新渲染
            resultsCache: lastKnowledgeSearchResults
        });
    } catch (e) {
        resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">搜索失败: ${e.message}</div>`;
    }
}

function bindSearchResultHandlers() {
    setTimeout(() => {
        document.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(el.getAttribute('data-idx'));
                const title = el.getAttribute('data-title');
                const item = lastKnowledgeSearchResults[idx];
                const chunkText = (item && item.doc) ? item.doc : '';
                if (title && chunkText) {
                    openKnowledgeAtChunk(title, chunkText, (item && item.meta) ? item.meta : {}, true);
                }
            };
        });
    }, 100);
}

function renderSearchResultsFromCache() {
    const list = document.getElementById('knowledgeSearchResultsList');
    if (!list) return;
    if (!lastKnowledgeSearchResults || lastKnowledgeSearchResults.length === 0) {
        list.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">无结果</div>';
        return;
    }
    list.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
        const title = item.meta.title || 'Untitled';
        const preview = (item.doc || '').slice(0, 200);
        const score = item.dist != null ? (1 - item.dist) : 0;
        return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
            <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
        </div>`;
    }).join('');
    bindSearchResultHandlers();
}

function closeKnowledgeSearchResultView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    viewer.style.display = 'none';
    viewer.innerHTML = '<textarea id="knowledgeEditor"></textarea>';
    msgs.style.display = 'flex';
    if(inputWrapper) inputWrapper.style.display = 'block';
    
    // 清除导航栈和搜索状态
    navigationStack = [];
    currentSearchQuery = '';

    if (originalHeaderState) {
        headerTitle.textContent = originalHeaderState.title;
        headerLeft.innerHTML = originalHeaderState.leftHTML;
        headerRight.innerHTML = originalHeaderState.rightHTML;
        els.modelSelectContainer = document.getElementById('modelSelectContainer');
        els.currentModelDisplay = document.getElementById('currentModelDisplay');
        els.modelOptions = document.getElementById('modelOptions');
        loadModels(); 
        
        const toggleSidebar = document.getElementById('toggleSidebar');
        if(toggleSidebar) toggleSidebar.onclick = () => {
            if (isChatMobileLayout()) toggleMobileSidebar();
            else els.sidebar.classList.toggle('collapsed');
        };
        const toggleKP = document.getElementById('toggleKnowledgePanel');
        if (toggleKP) toggleKP.onclick = () => toggleKnowledgePanel();
        const toggleFile = document.getElementById('toggleFilePanel');
        if(toggleFile) toggleFile.onclick = () => toggleCloudFilePanel();
        const toggleMail = document.getElementById('toggleMailView');
        if(toggleMail) toggleMail.onclick = () => openMailPlaceholderView();
    }
    originalHeaderState = null;
}

function closeKnowledgeSearchModal() {
    // 兼容性函数，调用新的搜索结果视图关闭函数
    closeKnowledgeSearchResultView();
}

async function openKnowledgeAtChunk(title, chunkText, meta = {}, fromSearch = false) {
    // 如果不是来自搜索，清除导航栈（直接跳转）
    if (!fromSearch) {
        navigationStack = [{
            type: 'chat',
            state: {
                title: document.getElementById('conversationTitle').textContent,
                leftHTML: document.querySelector('.header-left').innerHTML,
                rightHTML: document.querySelector('.header-right').innerHTML
            }
        }];
    }
    
    // 直接在预览模式下打开，带有高亮信息
    await viewKnowledge(title, { 
        forceEditMode: false,
        highlightData: { text: chunkText, meta },
        fromSearch
    });
}

function indexToPos(text, index) {
    const before = text.slice(0, index);
    const lines = before.split('\n');
    const line = lines.length - 1;
    const ch = lines[lines.length - 1].length;
    return { line, ch };
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function saveKnowledge(title) {
    if(!easyMDE) return;
    const content = easyMDE.value();
    
    try {
        const res = await fetch('/api/knowledge/basis/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ title, content })
        });
        const data = await res.json();
        if(data.success) {
            showToast('保存成功');
            const nowSec = Math.floor(Date.now() / 1000);
            const meta = (knowledgeMetaCache[title] && typeof knowledgeMetaCache[title] === 'object')
                ? knowledgeMetaCache[title]
                : {};
            meta.updated_at = Math.max(nowSec, Number(meta.updated_at || 0));
            if (Number(meta.vector_updated_at || 0) >= meta.updated_at) {
                meta.vector_updated_at = Math.max(0, meta.updated_at - 1);
            }
            knowledgeMetaCache[title] = meta;
            // 保存后立即刷新知识列表与元数据，让“需重新向量化”状态及时可见
            await loadKnowledge(currentConversationId);
        } else {
            showToast('保存失败: ' + data.message);
        }
    } catch (e) {
        showToast('请求异常: ' + e.message);
    }
}

// --- Knowledge Settings ---
async function openKnowledgeSettingsModal() {
    if (!currentViewingKnowledge) return;
    const title = currentViewingKnowledge;
    
    try {
        // Ensure we have username
        if(!currentUsername) await checkUserRole();

        const resMeta = await fetch('/api/knowledge/list');
        const metaData = await resMeta.json();
        
        const metadata = metaData.basis_knowledge[title];
        if (!metadata) return;

        document.getElementById('settingTargetTitle').value = title;
        document.getElementById('settingPublic').checked = metadata.public || false;
        document.getElementById('settingCollaborative').checked = metadata.collaborative || false;
        
        const base = window.location.origin;
        const shareId = metadata.share_id || '';
        const shareUrl = shareId ? `${base}/public/knowledge/${currentUsername}/${shareId}` : '';
        setShareLinkDisplay(shareUrl, metadata.public);
        
        if (metadata.updated_at) {
            document.getElementById('lastModifyTime').textContent = new Date(metadata.updated_at * 1000).toLocaleString();
        }

        loadVectorChunks(title);
        initKnowledgeSettingsTabs();
        if (vectorizeTitle && vectorizeTitle !== title) {
            resetVectorProgressUI();
        }
        vectorizeTitle = title;
        document.getElementById('knowledgeSettingsModal').classList.add('active');
        setVectorStatus('加载中...');
        loadVectorChunks(title);
    } catch(e) { console.error(e); }
}

function closeKnowledgeSettingsModal() {
    document.getElementById('knowledgeSettingsModal').classList.remove('active');
    resetVectorProgressUI();
}

function initKnowledgeSettingsTabs() {
    const modal = document.getElementById('knowledgeSettingsModal');
    if (!modal || modal.dataset.tabsInit === '1') return;
    modal.dataset.tabsInit = '1';
    const tabs = modal.querySelectorAll('.admin-tab');
    const contents = modal.querySelectorAll('.admin-tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            contents.forEach(c => c.classList.remove('active'));
            const panel = modal.querySelector(`#${target}-tab`);
            if (panel) panel.classList.add('active');
        });
    });
}

function setShareLinkDisplay(shareUrl, isPublic) {
    const shareSection = document.getElementById('shareLinkSection');
    const shareInput = document.getElementById('shareUrlDisplay');

    if (!shareSection || !shareInput) return;

    if (isPublic && shareUrl) {
        shareInput.value = shareUrl;
        shareSection.style.display = 'block';
    } else {
        shareSection.style.display = 'none';
        shareInput.value = '';
    }
}

async function applyKnowledgeSettings() {
    const oldTitle = currentViewingKnowledge;
    const newTitle = document.getElementById('settingTargetTitle').value.trim();
    const isPublic = document.getElementById('settingPublic').checked;
    const isCollaborative = document.getElementById('settingCollaborative').checked;
    
    if (!newTitle) return showToast('标题不能为空');

    try {
        const res = await fetch('/api/knowledge/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                title: oldTitle,
                new_title: newTitle,
                public: isPublic,
                collaborative: isCollaborative
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('设置已更新');
            
            // If title changed, we must reload the view
            if (newTitle !== oldTitle) {
                closeKnowledgeSettingsModal();
                closeKnowledgeView();
                viewKnowledge(newTitle);
            } else {
                const shareUrl = data.share_url || '';
                setShareLinkDisplay(shareUrl, isPublic);
            }
            loadKnowledge(); 
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch(e) { showToast('网络错: ' + e.message); }
}

function copyShareUrl() {
    const input = document.getElementById('shareUrlDisplay');
    input.select();
    document.execCommand('copy');
    showToast('链接已复制');
}

function showToast(msg) {
    let toast = document.querySelector('.toast-notification');
    if(!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

const SIMPLE_ICON_CDN_BASE = 'https://cdn.simpleicons.org';

function resolveProviderSimpleIconSlug(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (!p) return '';
    const exactMap = {
        github: 'github',
        aliyun: 'alibabacloud',
        alibabacloud: 'alibabacloud',
        volcengine: 'bytedance',
        bytedance: 'bytedance',
        tencent: 'qq',
        tencentcloud: 'qq',
        qq: 'qq',
        wechat: 'wechat',
        deepseek: 'deepseek',
        openai: 'openai'
    };
    if (exactMap[p]) return exactMap[p];
    if (p.includes('aliyun') || p.includes('alibaba')) return 'alibabacloud';
    if (p.includes('volc') || p.includes('byte')) return 'bytedance';
    if (p.includes('tencent')) return 'qq';
    if (p.includes('github')) return 'github';
    if (p.includes('openai')) return 'openai';
    if (p.includes('deepseek')) return 'deepseek';
    return '';
}

function providerIconFallbackText(text) {
    const src = String(text || '').trim();
    if (!src) return '?';
    const cleaned = src.replace(/[^0-9a-zA-Z\u4e00-\u9fa5]+/g, ' ').trim();
    if (!cleaned) return src.slice(0, 2).toUpperCase();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
    }
    if (/[\u4e00-\u9fa5]/.test(parts[0])) return parts[0].slice(0, 2);
    return parts[0].slice(0, 2).toUpperCase();
}

function renderProviderIconHtml(provider, options = {}) {
    const cls = String(options.className || 'provider-logo').trim() || 'provider-logo';
    const label = String(options.label || provider || 'Provider').trim() || 'Provider';
    const fallback = providerIconFallbackText(label);
    const fallbackHtml = `<span class="provider-logo-fallback">${escapeHtml(fallback)}</span>`;
    const slug = resolveProviderSimpleIconSlug(provider);
    if (!slug) {
        return `<span class="${cls} icon-fallback" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${fallbackHtml}</span>`;
    }
    const iconSrc = `${SIMPLE_ICON_CDN_BASE}/${encodeURIComponent(slug)}`;
    return `
        <span class="${cls}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
            <img src="${iconSrc}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer"
                 onerror="this.parentElement.classList.add('icon-fallback'); this.remove();">
            ${fallbackHtml}
        </span>
    `;
}

function renderProviderInlineHtml(provider, labelText = '') {
    const label = String(labelText || provider || '-').trim() || '-';
    return `
        <span class="provider-inline">
            ${renderProviderIconHtml(provider, { className: 'provider-logo provider-logo-sm', label })}
            <span class="provider-inline-label">${escapeHtml(label)}</span>
        </span>
    `;
}

async function loadModels() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if(data.models) {
            modelCatalog = Array.isArray(data.models) ? data.models : [];
            modelMetaById.clear();
            modelCatalog.forEach((m) => {
                if (!m || !m.id) return;
                modelMetaById.set(String(m.id), {
                    id: String(m.id),
                    name: String(m.name || m.id),
                    provider: String(m.provider || ''),
                    contextWindow: normalizeContextWindow(
                        m.context_window != null ? m.context_window
                            : (m.context_length != null ? m.context_length
                                : (m.max_context_tokens != null ? m.max_context_tokens
                                    : (m.max_input_tokens != null ? m.max_input_tokens : 0)))
                    )
                });
            });
            renderCustomModelSelect(modelCatalog, data.default_model);
            updateTokenBudgetContextFromSelectedModel();
        }
    } catch(e) { console.error("Error loading models", e); }
}

function renderCustomModelSelect(models, defaultModel) {
    if(!els.modelOptions) return;
    
    // Clear
    els.modelOptions.innerHTML = '';
    
    if (models.length === 0) {
        selectedModelId = null;
        if(els.currentModelName) els.currentModelName.textContent = '无可用的模型';
        return;
    }
    
    // Setup initial
    const stored = localStorage.getItem('selectedModel');
    const isValidStored = models.find(m => m.id === stored);
    const isValidDefault = models.find(m => m.id === defaultModel);
    
    selectedModelId = (isValidStored ? stored : (isValidDefault ? defaultModel : models[0].id));

    const providerLabelMap = {
        volcengine: '火山引擎',
        aliyun: '阿里云',
        stepfun: '阶跃星辰',
        github: 'GitHub',
        suanli: '算力猫',
        openai: 'OpenAI'
    };
    const providerOrderMap = {
        volcengine: 10,
        aliyun: 20,
        stepfun: 30,
        github: 40,
        suanli: 50,
        openai: 60
    };
    const normalizeProvider = (provider) => String(provider || 'other').toLowerCase();
    const providerLabel = (provider) => {
        const key = normalizeProvider(provider);
        return providerLabelMap[key] || (provider ? String(provider) : '其他');
    };
    const statusLabelMap = {
        good: '良好',
        normal: '正常',
        fast: '快速',
        slow: '缓慢',
        error: '错误'
    };
    const normalizeStatus = (status) => String(status || 'normal').toLowerCase();

    // Group by provider
    const groups = new Map();
    models.forEach((m) => {
        const key = normalizeProvider(m.provider);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    });

    // Render grouped chips
    const sortedProviders = Array.from(groups.keys()).sort((a, b) => {
        const ao = providerOrderMap[a] || 999;
        const bo = providerOrderMap[b] || 999;
        if (ao !== bo) return ao - bo;
        return providerLabel(a).localeCompare(providerLabel(b), 'zh-CN');
    });

    sortedProviders.forEach((providerKey) => {
        // 预热 vision 能力缓存，避免首次上传图片时等待
        ensureProviderVisionModelSet(providerKey).catch(() => {});

        const section = document.createElement('div');
        section.className = 'model-group';

        const title = document.createElement('div');
        title.className = 'model-group-title';
        const providerText = providerLabel(providerKey);
        title.innerHTML = `
            <span class="provider-title-main">
                ${renderProviderIconHtml(providerKey, { className: 'provider-logo provider-logo-sm', label: providerText })}
                <span class="label">${escapeHtml(providerText)}</span>
            </span>
        `;
        section.appendChild(title);

        const chips = document.createElement('div');
        chips.className = 'model-chip-wrap';

        groups.get(providerKey).forEach((m) => {
            const statusKey = normalizeStatus(m.status);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'model-chip';
            chip.dataset.modelId = m.id;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'model-chip-name';
            nameSpan.textContent = m.name;

            const statusSpan = document.createElement('span');
            statusSpan.className = `model-chip-status model-status-${statusKey}`;
            statusSpan.textContent = statusLabelMap[statusKey] || statusKey.toUpperCase();

            chip.appendChild(nameSpan);
            chip.appendChild(statusSpan);

            if (m.id === selectedModelId) chip.classList.add('same-as-selected');
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                selectModel(m.id, m.name);
            });
            chips.appendChild(chip);
        });

        section.appendChild(chips);
        els.modelOptions.appendChild(section);
    });
    
    // Set initial display
    const currentList = models.find(m => m.id === selectedModelId);
    if(currentList) els.currentModelDisplay.textContent = currentList.name;

    // Toggle logic
    els.currentModelDisplay.onclick = (e) => {
        e.stopPropagation();
        const isClosed = els.modelOptions.classList.contains('select-hide');
        closeAllSelects(); // Close any potential others or self cleanup
        
        if (isClosed) {
            if (isMobileViewport()) {
                dockModelOptionsForMobile();
                positionMobileModelOptions();
            }
            els.modelOptions.classList.remove('select-hide');
            els.currentModelDisplay.classList.add('select-arrow-active');
        }
    };

    if (!modelSelectListenersBound) {
        document.addEventListener('click', closeAllSelects);
        window.addEventListener('resize', () => {
            if (!els.modelOptions || els.modelOptions.classList.contains('select-hide')) return;
            if (isMobileViewport()) {
                dockModelOptionsForMobile();
                positionMobileModelOptions();
            } else {
                undockModelOptionsForMobile();
            }
        });
        modelSelectListenersBound = true;
    }
}

function getModelMeta(modelId) {
    const key = String(modelId || '').trim();
    if (!key) return null;
    return modelMetaById.get(key) || null;
}

function getSelectedModelMeta() {
    return getModelMeta(selectedModelId);
}

function normalizeProviderName(provider) {
    return String(provider || '').trim().toLowerCase();
}

function fallbackModelVisionMatch(modelId, modelName, provider) {
    const p = normalizeProviderName(provider);
    if (p !== 'volcengine') return false;
    const merged = `${String(modelId || '')} ${String(modelName || '')}`.toLowerCase();
    return ['vision', 'image', 'multimodal', 'vl', 'seed-1-8'].some((k) => merged.includes(k));
}

async function ensureProviderVisionModelSet(provider) {
    const p = normalizeProviderName(provider);
    if (!p) return null;
    if (providerVisionModelSetCache.has(p)) {
        return providerVisionModelSetCache.get(p);
    }
    if (providerVisionPendingFetch.has(p)) {
        return providerVisionPendingFetch.get(p);
    }

    const req = (async () => {
        try {
            const res = await fetch(`/api/provider/models?provider=${encodeURIComponent(p)}&capability=vision`);
            const data = await res.json();
            if (!data || !data.success || !Array.isArray(data.models)) {
                providerVisionModelSetCache.set(p, null);
                return null;
            }
            const set = new Set();
            data.models.forEach((m) => {
                const id = typeof m === 'string' ? m : (m && (m.id || m.model_id || m.name));
                const norm = String(id || '').trim().toLowerCase();
                if (norm) set.add(norm);
            });
            providerVisionModelSetCache.set(p, set);
            return set;
        } catch (e) {
            providerVisionModelSetCache.set(p, null);
            return null;
        } finally {
            providerVisionPendingFetch.delete(p);
        }
    })();

    providerVisionPendingFetch.set(p, req);
    return req;
}

async function isModelVisionCapable(modelId) {
    const meta = getModelMeta(modelId);
    if (!meta) return false;
    const provider = normalizeProviderName(meta.provider);
    const modelKey = String(meta.id || modelId || '').trim().toLowerCase();
    const byApi = await ensureProviderVisionModelSet(provider);
    if (byApi instanceof Set) {
        return byApi.has(modelKey);
    }
    return fallbackModelVisionMatch(meta.id, meta.name, meta.provider);
}

function isImageLikeFile(file) {
    if (!file) return false;
    const mime = String(file.type || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(file.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].some((ext) => name.endsWith(ext));
}

function readImageAsDataUrl(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.onabort = () => reject(new Error('图片读取已中断'));
        reader.onprogress = (evt) => {
            if (!evt || !evt.lengthComputable || typeof onProgress !== 'function') return;
            const percent = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
            onProgress(percent);
        };
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

async function selectModel(id, name) {
    selectedModelId = id;
    localStorage.setItem('selectedModel', id);
    els.currentModelDisplay.textContent = name;
    
    // Visual update
    els.modelOptions.querySelectorAll('.model-chip').forEach((chip) => {
        if (chip.dataset.modelId === id) chip.classList.add('same-as-selected');
        else chip.classList.remove('same-as-selected');
    });
    
    els.modelOptions.classList.add('select-hide');
    els.currentModelDisplay.classList.remove('select-arrow-active');
    undockModelOptionsForMobile();
    updateTokenBudgetContextFromSelectedModel();
    await warnIfModelCannotUseHistoryImages(id);
}

function closeAllSelects(e) {
    if(els.modelOptions && !els.modelOptions.classList.contains('select-hide')) {
        const clickedInsideContainer = !!(els.modelSelectContainer && e && els.modelSelectContainer.contains(e.target));
        const clickedInsideOptions = !!(els.modelOptions && e && els.modelOptions.contains(e.target));
        const clickedInside = clickedInsideContainer || clickedInsideOptions;
        if (!clickedInside) {
            els.modelOptions.classList.add('select-hide');
            els.currentModelDisplay.classList.remove('select-arrow-active');
            undockModelOptionsForMobile();
        }
    }
}

function isMobileViewport() {
    return window.innerWidth <= 980;
}

function dockModelOptionsForMobile() {
    if (!els.modelOptions || !els.modelSelectContainer || !isMobileViewport()) return;
    if (els.modelOptions.parentElement === document.body) return;
    modelOptionsDockState = {
        parent: els.modelSelectContainer,
        nextSibling: els.modelOptions.nextSibling
    };
    document.body.appendChild(els.modelOptions);
    els.modelOptions.dataset.mobileDocked = '1';
}

function undockModelOptionsForMobile() {
    if (!els.modelOptions || els.modelOptions.parentElement !== document.body || !modelOptionsDockState) return;
    try {
        const parent = modelOptionsDockState.parent;
        const next = modelOptionsDockState.nextSibling;
        if (parent && next && next.parentNode === parent) {
            parent.insertBefore(els.modelOptions, next);
        } else if (parent) {
            parent.appendChild(els.modelOptions);
        }
    } catch (err) {
        if (els.modelSelectContainer) {
            els.modelSelectContainer.appendChild(els.modelOptions);
        }
    }
    delete els.modelOptions.dataset.mobileDocked;
    els.modelOptions.style.position = '';
    els.modelOptions.style.left = '';
    els.modelOptions.style.top = '';
    els.modelOptions.style.width = '';
    els.modelOptions.style.maxWidth = '';
    els.modelOptions.style.maxHeight = '';
    els.modelOptions.style.zIndex = '';
    modelOptionsDockState = null;
}

function positionMobileModelOptions() {
    if (!els.modelOptions || !els.currentModelDisplay || !isMobileViewport()) return;
    const rect = els.currentModelDisplay.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    const width = Math.min(Math.max(260, Math.floor(vw * 0.92)), 380);
    const left = Math.max(6, Math.min(rect.left, vw - width - 6));
    const top = Math.min(Math.floor(rect.bottom + 8), Math.max(70, vh - 140));

    els.modelOptions.style.position = 'fixed';
    els.modelOptions.style.left = `${left}px`;
    els.modelOptions.style.top = `${top}px`;
    els.modelOptions.style.width = `${width}px`;
    els.modelOptions.style.maxWidth = `${Math.max(220, vw - 12)}px`;
    els.modelOptions.style.maxHeight = `${Math.floor(vh * 0.62)}px`;
    els.modelOptions.style.zIndex = '5200';
}


// --- Utils ---
function highlightCode(element) {
    if(window.hljs) {
        element.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
}


// --- File Upload ---
function ensureFileDropOverlayElement() {
    if (els.fileDropOverlay) return els.fileDropOverlay;
    let overlay = document.getElementById('fileDropOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fileDropOverlay';
        overlay.className = 'file-drop-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="file-drop-overlay-card">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <div class="file-drop-overlay-title">拖放文件以上传</div>
                <div class="file-drop-overlay-subtitle">松开鼠标后自动上传到当前对话</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    els.fileDropOverlay = overlay;
    return overlay;
}

function setFileDropOverlayVisible(visible) {
    const overlay = ensureFileDropOverlayElement();
    if (!overlay) return;
    const next = !!visible;
    isFileDropOverlayVisible = next;
    overlay.classList.toggle('active', next);
    overlay.setAttribute('aria-hidden', next ? 'false' : 'true');
}

function resetFileDropOverlayState() {
    fileDragDepth = 0;
    setFileDropOverlayVisible(false);
}

function dragEventHasFiles(e) {
    const dt = e && e.dataTransfer;
    if (!dt) return false;
    if (dt.items && dt.items.length > 0) {
        return Array.from(dt.items).some((item) => item && item.kind === 'file');
    }
    const types = dt.types ? Array.from(dt.types) : [];
    return types.includes('Files');
}

function bindGlobalFileDropUpload() {
    if (document.body && document.body.dataset.fileDropBound === '1') return;
    if (document.body) document.body.dataset.fileDropBound = '1';
    ensureFileDropOverlayElement();

    const onDragEnter = (e) => {
        if (!dragEventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        fileDragDepth += 1;
        setFileDropOverlayVisible(true);
    };

    const onDragOver = (e) => {
        if (!dragEventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (!isFileDropOverlayVisible) setFileDropOverlayVisible(true);
    };

    const onDragLeave = (e) => {
        if (!isFileDropOverlayVisible) return;
        if (dragEventHasFiles(e)) {
            e.preventDefault();
            e.stopPropagation();
        }
        fileDragDepth = Math.max(0, fileDragDepth - 1);
        if (fileDragDepth === 0) {
            setFileDropOverlayVisible(false);
        }
    };

    const onDrop = async (e) => {
        if (!dragEventHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : []);
        resetFileDropOverlayState();
        if (!files.length) return;
        await handleFileUploadFiles(files, { source: 'drop', clearInput: false });
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('blur', () => resetFileDropOverlayState());
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetFileDropOverlayState();
    });
}

function normalizeUploadFile(file, index = 0) {
    if (!file) return null;
    const asBlob = (file instanceof Blob) ? file : null;
    if (!asBlob) return null;
    const rawName = typeof file.name === 'string' ? file.name.trim() : '';
    if (rawName) return file;
    const mime = String(file.type || '').toLowerCase();
    const ext = mime.includes('png') ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
        : mime.includes('gif') ? 'gif'
        : mime.includes('webp') ? 'webp'
        : mime.includes('pdf') ? 'pdf'
        : mime.includes('json') ? 'json'
        : mime.includes('markdown') ? 'md'
        : mime.includes('text') ? 'txt'
        : 'bin';
    const prefix = mime.startsWith('image/') ? 'pasted-image' : 'pasted-file';
    const name = `${prefix}-${Date.now()}-${index + 1}.${ext}`;
    return new File([asBlob], name, {
        type: file.type || 'application/octet-stream',
        lastModified: Date.now()
    });
}

function extractFilesFromClipboardEvent(e) {
    const dt = e && e.clipboardData ? e.clipboardData : null;
    if (!dt) return [];
    const out = [];
    if (dt.items && dt.items.length > 0) {
        Array.from(dt.items).forEach((item, idx) => {
            if (!item || item.kind !== 'file') return;
            const f = item.getAsFile ? item.getAsFile() : null;
            const normalized = normalizeUploadFile(f, idx);
            if (normalized) out.push(normalized);
        });
        return out;
    }
    if (dt.files && dt.files.length > 0) {
        return Array.from(dt.files).map((f, idx) => normalizeUploadFile(f, idx)).filter(Boolean);
    }
    return out;
}

function setFileUploadProgress(options = {}) {
    if (!els.fileUploadProgressWrap || !els.fileUploadProgressFill || !els.fileUploadProgressText) return;
    const visible = !!options.visible;
    const stage = String(options.stage || 'upload');
    const percentRaw = Number(options.percent || 0);
    const percent = Math.max(0, Math.min(100, Number.isFinite(percentRaw) ? percentRaw : 0));
    const text = String(options.text || '');

    if (!visible) {
        els.fileUploadProgressWrap.style.display = 'none';
        els.fileUploadProgressFill.classList.remove('stage-vectorizing', 'stage-ready', 'stage-error');
        els.fileUploadProgressFill.style.width = '0%';
        els.fileUploadProgressText.textContent = '';
        if (els.cancelFileUploadBtn) {
            els.cancelFileUploadBtn.disabled = true;
        }
        return;
    }

    els.fileUploadProgressWrap.style.display = 'block';
    els.fileUploadProgressText.textContent = text;
    els.fileUploadProgressFill.classList.remove('stage-vectorizing', 'stage-ready', 'stage-error');

    if (stage === 'upload') {
        els.fileUploadProgressFill.style.width = `${percent}%`;
    } else if (stage === 'vectorizing') {
        const p = Math.max(1, Math.min(100, percent || 1));
        els.fileUploadProgressFill.style.width = `${p}%`;
        els.fileUploadProgressFill.classList.add('stage-vectorizing');
    } else if (stage === 'ready') {
        els.fileUploadProgressFill.style.width = '100%';
        els.fileUploadProgressFill.classList.add('stage-ready');
    } else if (stage === 'error') {
        els.fileUploadProgressFill.style.width = '100%';
        els.fileUploadProgressFill.classList.add('stage-error');
    }

    if (els.cancelFileUploadBtn) {
        const cancellable = stage === 'upload' || stage === 'vectorizing';
        els.cancelFileUploadBtn.disabled = !cancellable;
    }
}

function cancelCurrentFileUpload() {
    uploadCancelledByUser = true;
    if (currentUploadXhr) {
        try {
            currentUploadXhr.abort();
        } catch (e) {
            // ignore
        }
    }
    if (currentUploadTaskId) {
        fetch(`/api/upload/task/${encodeURIComponent(currentUploadTaskId)}/cancel`, {
            method: 'POST'
        }).catch(() => {});
    }
}

async function pollUploadTask(taskId, file, index, total) {
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) throw new Error('缺少上传任务ID');

    const maxRounds = 900; // up to ~7.5min at 500ms
    for (let round = 0; round < maxRounds; round++) {
        if (uploadCancelledByUser) {
            throw { code: 'upload_cancelled', message: '用户取消上传' };
        }
        const res = await fetch(`/api/upload/task/${encodeURIComponent(safeTaskId)}`, {
            method: 'GET',
            cache: 'no-store'
        });
        const data = await res.json();
        if (!data || !data.success || !data.task) {
            throw new Error((data && data.message) ? data.message : '任务查询失败');
        }
        const task = data.task;
        const status = String(task.status || '').toLowerCase();
        const stage = String(task.stage || '').toLowerCase();
        const progressRaw = Number(task.progress || 0);
        const progress = Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, progressRaw)) : 0;

        if (status === 'completed') {
            return task.result || {};
        }
        if (status === 'failed') {
            throw new Error(task.error || task.message || '上传失败');
        }
        if (status === 'cancelled') {
            throw { code: 'upload_cancelled', message: task.message || '任务已取消' };
        }

        // 后端总进度是全流程(解析+向量化)，前端这里强制映射为“蓝色向量化 0-100”
        let vectorPct = 0;
        if (stage === 'vectorizing' || status === 'running') {
            if (progress <= 35) vectorPct = 1;
            else if (progress >= 95) vectorPct = 100;
            else vectorPct = Math.round(((progress - 35) / 60) * 100);
        } else if (status === 'completed') {
            vectorPct = 100;
        } else {
            vectorPct = Math.max(1, Math.min(100, progress));
        }
        vectorPct = Math.max(1, Math.min(100, vectorPct));
        setFileUploadProgress({
            visible: true,
            stage: 'vectorizing',
            percent: vectorPct,
            text: `向量化 ${index + 1}/${total}: ${file.name} (${vectorPct}%)`
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('上传任务超时');
}

function uploadSingleFileWithProgress(file, index, total) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('file', file);
        currentUploadXhr = xhr;

        xhr.open('POST', '/api/upload', true);

        xhr.upload.onloadstart = () => {
            setFileUploadProgress({
                visible: true,
                stage: 'upload',
                percent: 0,
                text: `上传 ${index + 1}/${total}: ${file.name}`
            });
        };

        xhr.upload.onprogress = (evt) => {
            if (!evt || !evt.lengthComputable) return;
            const progress = (evt.loaded / evt.total) * 100;
            setFileUploadProgress({
                visible: true,
                stage: 'upload',
                percent: progress,
                text: `上传 ${index + 1}/${total}: ${file.name} (${Math.round(progress)}%)`
            });
        };

        xhr.upload.onload = () => {
            // 上传体完成后，请求仍在服务端向量化，切换蓝色阶段
            setFileUploadProgress({
                visible: true,
                stage: 'vectorizing',
                percent: 1,
                text: `向量化 ${index + 1}/${total}: ${file.name} (1%)`
            });
        };

        xhr.onerror = () => {
            currentUploadXhr = null;
            reject(new Error('网络错误'));
        };

        xhr.onabort = () => {
            currentUploadXhr = null;
            reject({ code: 'upload_aborted' });
        };

        xhr.onload = async () => {
            currentUploadXhr = null;
            let data = null;
            try {
                data = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText || '{}');
            } catch (e) {
                data = null;
            }

            if (!(xhr.status >= 200 && xhr.status < 300)) {
                const errMsg = (data && data.message) ? data.message : `HTTP ${xhr.status}`;
                reject(new Error(errMsg));
                return;
            }
            if (!data || !data.success) {
                const msg = data && data.message ? data.message : '上传失败';
                reject(new Error(msg));
                return;
            }

            const taskId = String(data.task_id || '').trim();
            if (!taskId) {
                resolve(data);
                return;
            }

            currentUploadTaskId = taskId;
            try {
                const finalData = await pollUploadTask(taskId, file, index, total);
                resolve(finalData);
            } catch (err) {
                reject(err);
            } finally {
                if (currentUploadTaskId === taskId) {
                    currentUploadTaskId = null;
                }
            }
        };

        xhr.send(formData);
    });
}

function appendUploadedFileEntry(data, fallbackFileName) {
    if (!data || !data.success) return;
    if (data.type === 'text') {
        uploadedFileIds.push({
            type: 'text',
            content: data.content,
            name: data.filename || fallbackFileName
        });
    } else if (data.type === 'sandbox_file') {
        uploadedFileIds.push({
            type: 'sandbox_file',
            name: data.update_file_name || data.filename || fallbackFileName,
            original_name: data.filename || fallbackFileName,
            sandbox_path: data.sandbox_path,
            stored_path: data.stored_path
        });
        if (data.vectorized === false && data.vector_message) {
            showToast(`文件已上传，临时向量化失败: ${data.vector_message}`);
        }
    } else {
        uploadedFileIds.push({
            type: 'file',
            id: data.file_id,
            name: data.filename || fallbackFileName
        });
    }
}

async function appendUploadedImageEntry(file, index, total) {
    const maxImageBytes = 8 * 1024 * 1024; // 8MB per image
    if (file.size > maxImageBytes) {
        throw new Error(`图片过大: ${file.name}，请控制在 8MB 以内`);
    }
    setFileUploadProgress({
        visible: true,
        stage: 'upload',
        percent: 0,
        text: `读取图片 ${index + 1}/${total}: ${file.name}`
    });
    const dataUrl = await readImageAsDataUrl(file, (p) => {
        setFileUploadProgress({
            visible: true,
            stage: 'upload',
            percent: p,
            text: `读取图片 ${index + 1}/${total}: ${file.name} (${p}%)`
        });
    });
    uploadedFileIds.push({
        type: 'image',
        name: file.name,
        mime: file.type || '',
        size: file.size || 0,
        url: dataUrl
    });
    updateFilePreview();
    setFileUploadProgress({
        visible: true,
        stage: 'ready',
        text: `图片就绪 ${index + 1}/${total}: ${file.name}`
    });
}

async function handleFileUploadFiles(fileList, options = {}) {
    const files = Array.from(fileList || [])
        .map((f, idx) => normalizeUploadFile(f, idx))
        .filter(Boolean);
    const clearInput = options && options.clearInput;
    if (!files.length) return;

    if (isUploadingFiles) {
        showToast('已有文件上传任务，请先等待完成或中断');
        if (typeof clearInput === 'function') clearInput();
        else if (clearInput !== false && els.fileInput) els.fileInput.value = '';
        return;
    }

    isUploadingFiles = true;
    uploadCancelledByUser = false;
    updateSendButtonState();

    try {
        const selectedMeta = getSelectedModelMeta();
        const selectedProvider = selectedMeta ? selectedMeta.provider : '';
        const selectedModel = selectedMeta ? selectedMeta.id : selectedModelId;
        const hasImage = files.some((f) => isImageLikeFile(f));
        const visionCapable = hasImage ? await isModelVisionCapable(selectedModel) : false;

        for (let i = 0; i < files.length; i++) {
            if (uploadCancelledByUser) break;
            const file = files[i];
            try {
                if (isImageLikeFile(file)) {
                    if (!visionCapable) {
                        showToast(`当前模型不支持图片输入：${selectedModel || '-'} (${selectedProvider || 'unknown'})`);
                        continue;
                    }
                    await appendUploadedImageEntry(file, i, files.length);
                    await new Promise((resolve) => setTimeout(resolve, 160));
                } else {
                    const data = await uploadSingleFileWithProgress(file, i, files.length);
                    appendUploadedFileEntry(data, file.name);
                    updateFilePreview();
                    setFileUploadProgress({
                        visible: true,
                        stage: 'ready',
                        text: `完成 ${i + 1}/${files.length}: ${file.name}`
                    });
                    await new Promise((resolve) => setTimeout(resolve, 220));
                }
            } catch (err) {
                if (err && (err.code === 'upload_aborted' || err.code === 'upload_cancelled')) {
                    showToast('文件上传已中断');
                    break;
                }
                const message = err && err.message ? err.message : '上传失败';
                showToast(`上传失败: ${message}`);
                setFileUploadProgress({
                    visible: true,
                    stage: 'error',
                    text: `失败 ${i + 1}/${files.length}: ${file.name}`
                });
                await new Promise((resolve) => setTimeout(resolve, 450));
            }
        }
    } finally {
        if (typeof clearInput === 'function') clearInput();
        else if (clearInput !== false && els.fileInput) els.fileInput.value = '';
        isUploadingFiles = false;
        currentUploadXhr = null;
        currentUploadTaskId = null;
        updateSendButtonState();
        if (els.filePanel && els.filePanel.classList.contains('visible')) {
            loadCloudFiles();
        }
        setTimeout(() => setFileUploadProgress({ visible: false }), 900);
        uploadCancelledByUser = false;
    }
}

async function handleFileUpload(e) {
    const files = Array.from((e && e.target && e.target.files) ? e.target.files : []);
    await handleFileUploadFiles(files, {
        source: 'picker',
        clearInput: () => {
            if (e && e.target) e.target.value = '';
            else if (els.fileInput) els.fileInput.value = '';
        }
    });
}

function getUploadPreviewIconClass(file) {
    const type = String((file && file.type) || '').toLowerCase();
    const name = String((file && file.name) || '').toLowerCase();
    if ((file && file.type) === 'image') return 'fa-regular fa-image';
    if (type === 'text' || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) return 'fa-regular fa-file-lines';
    if (name.endsWith('.pdf')) return 'fa-regular fa-file-pdf';
    if (name.endsWith('.doc') || name.endsWith('.docx')) return 'fa-regular fa-file-word';
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'fa-regular fa-file-excel';
    if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'fa-regular fa-file-powerpoint';
    if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) return 'fa-regular fa-file-zipper';
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.xml')) return 'fa-regular fa-file-code';
    return 'fa-regular fa-file';
}

function getUploadPreviewMeta(file) {
    const name = String((file && file.name) || '').trim();
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const size = Number(file && file.size ? file.size : 0);
    if (file && file.type === 'image') {
        return `image${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    if (file && file.type === 'text') {
        const textSize = size > 0 ? size : Number(new Blob([String(file.content || '')]).size || 0);
        return `${ext || 'txt'}${textSize > 0 ? ` · ${formatFileSize(textSize)}` : ''}`;
    }
    if (file && file.type === 'sandbox_file') {
        return `${ext || 'file'}${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    if (file && file.type === 'file') {
        return `${ext || 'file'}${size > 0 ? ` · ${formatFileSize(size)}` : ''}`;
    }
    return ext || 'file';
}

function updateFilePreview() {
    if(!els.filePreviewArea) return;
    els.filePreviewArea.innerHTML = '';
    
    if (uploadedFileIds.length === 0) {
        els.filePreviewArea.style.display = 'none';
        els.filePreviewArea.classList.remove('has-items');
        return;
    }
    
    els.filePreviewArea.style.display = 'flex';
    els.filePreviewArea.classList.add('has-items');
    
    uploadedFileIds.forEach((file, index) => {
        const card = document.createElement('div');
        const isImage = file && file.type === 'image' && String(file.url || '').trim();
        card.className = `upload-preview-card ${isImage ? 'is-image' : 'is-file'}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'upload-preview-remove';
        removeBtn.title = '移除';
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.addEventListener('click', () => window.removeUploadedFile(index));
        card.appendChild(removeBtn);

        const media = document.createElement('div');
        media.className = 'upload-preview-media';
        if (isImage) {
            const img = document.createElement('img');
            img.src = String(file.url || '');
            img.alt = String(file.name || 'image');
            img.loading = 'lazy';
            media.appendChild(img);
        } else {
            const icon = document.createElement('i');
            icon.className = getUploadPreviewIconClass(file);
            media.appendChild(icon);
        }
        card.appendChild(media);

        const body = document.createElement('div');
        body.className = 'upload-preview-body';

        const title = document.createElement('div');
        title.className = 'upload-preview-title';
        title.textContent = String((file && file.name) || '未命名文件');
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'upload-preview-meta';
        meta.textContent = getUploadPreviewMeta(file);
        body.appendChild(meta);

        card.appendChild(body);
        els.filePreviewArea.appendChild(card);
    });
}

window.removeUploadedFile = function(index) {
    uploadedFileIds.splice(index, 1);
    updateFilePreview();
}

function updateSidebarUserProfile(displayName, avatarUrl) {
    const avatarEl = document.getElementById('sidebar-avatar');
    if (avatarEl) {
        const nameChar = (displayName || 'U').charAt(0).toUpperCase();
        const hasAvatar = typeof avatarUrl === 'string' && avatarUrl.trim() !== '';
        if (hasAvatar) {
            avatarEl.classList.add('has-image');
            avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
            avatarEl.textContent = '';
            avatarEl.setAttribute('aria-label', displayName || 'avatar');
        } else {
            avatarEl.classList.remove('has-image');
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = nameChar;
        }
    }

    let profileName = document.getElementById('profileUserName');
    if (!profileName) {
        profileName = document.querySelector('.profile-name');
    }
    if (profileName && displayName) {
        profileName.textContent = displayName;
    }
}

// --- Admin Functions ---
// 查用户色并显示管理菜单
async function checkUserRole() {
    try {
        const res = await fetch('/api/user/info');
        const data = await res.json();
        if (data.success) {
            // API 返回结构是 data.user.{username, role}
            currentUsername = data.user.id;
            currentUserRole = data.user.role;
            const displayName = data.user.username || data.user.id;
            currentUserAvatarUrl = data.user.avatar_url || '';
            
            console.log('[DEBUG] checkUserRole - username:', currentUsername, 'role:', currentUserRole);
            updateSidebarUserProfile(displayName, currentUserAvatarUrl);

            // 处理管理员入口显示（迁移到设置页面）
            const settingsAdminGap = document.getElementById('settingsAdminGap');
            const settingsAdminBtns = document.querySelectorAll('#settingsModal .settings-admin-entry');
            if (currentUserRole === 'admin') {
                document.body.classList.add('is-admin');
                if (settingsAdminGap) settingsAdminGap.style.display = '';
                settingsAdminBtns.forEach((btn) => { btn.style.display = ''; });
                console.log('[ADMIN] User is admin, showing settings admin entry');
            } else {
                document.body.classList.remove('is-admin');
                if (settingsAdminGap) settingsAdminGap.style.display = 'none';
                settingsAdminBtns.forEach((btn) => { btn.style.display = 'none'; });
                console.log('[ADMIN] User is not admin, hiding settings admin entry');
            }
        }
    } catch (err) {
        console.log('Failed to check user role', err);
    }
}

// 打开管理后台
async function openAdminDashboard(defaultTab = 'users') {
    // Kept for compatibility, now routes into settings modal.
    await openSettingsModal();
    const tabMap = {
        users: 'admin-users',
        mail: 'admin-mail',
        stats: 'admin-stats',
        models: 'admin-models',
        chroma: 'admin-chroma'
    };
    switchSettingsTab(tabMap[defaultTab] || 'admin-users');
}

// 加载用户列表
async function loadAdminUsersList() {
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
            adminUsersCache = Array.isArray(data.users) ? data.users : [];
            if (!adminSelectedUserId || !adminUsersCache.some(u => (u.user_id || u.username) === adminSelectedUserId)) {
                const first = adminUsersCache[0];
                adminSelectedUserId = first ? (first.user_id || first.username) : null;
            }
            renderAdminUsersList();
            renderAdminUserDetail();
        }
    } catch (err) {
        console.error('Failed to load users list', err);
    }
}

function renderAdminUsersList() {
    const usersList = document.getElementById('adminUsersList');
    if (!usersList) return;
    const keyword = adminUserFilterKeyword;
    const filtered = adminUsersCache.filter((user) => {
        if (!keyword) return true;
        const roleText = user.role === 'admin' ? 'admin 管理员' : 'member 普通用户';
        const text = [
            user.username || '',
            user.user_id || '',
            user.last_ip || '',
            roleText
        ].join(' ').toLowerCase();
        return text.includes(keyword);
    });
    if (filtered.length === 0) {
        usersList.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">没有匹配的用户</div>';
        return;
    }
    usersList.innerHTML = filtered.map((user) => {
        const userId = user.user_id || user.username;
        const active = userId === adminSelectedUserId ? 'active' : '';
        const safeId = encodeURIComponent(userId);
        const avatar = user.avatar_url || getDefaultAvatarDataUrl(user.username || userId);
        return `
            <div class="admin-user-item ${active}" onclick="selectAdminUser('${safeId}')">
                <img class="admin-user-avatar" src="${avatar}" alt="avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(user.username || userId)}</div>
                    <div class="admin-user-meta">${escapeHtml(userId)} · ${escapeHtml(user.role || 'member')}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminUserDetail() {
    const detail = document.getElementById('adminUserDetail');
    if (!detail) return;
    const selected = adminUsersCache.find((u) => (u.user_id || u.username) === adminSelectedUserId);
    if (!selected) {
        detail.innerHTML = '<div class="admin-user-detail-empty">请选择左侧用户查看详情</div>';
        return;
    }
    const userId = selected.user_id || selected.username;
    const encodedUserId = encodeURIComponent(userId);
    const isSelf = userId === currentUsername;
    const avatar = selected.avatar_url || getDefaultAvatarDataUrl(selected.username || userId);
    const localMail = selected.local_mail || {};
    const currentMailUsername = (localMail.username || '').trim();
    const currentMailGroup = (localMail.group || 'default').trim() || 'default';
    const currentMailText = currentMailUsername ? `${currentMailUsername} @ ${currentMailGroup}` : '未绑定';
    const createdAt = selected.created_at ? new Date(selected.created_at * 1000).toLocaleString() : '-';
    const lastLogin = selected.last_login ? new Date(selected.last_login * 1000).toLocaleString() : '-';
    detail.innerHTML = `
        <div class="admin-user-detail-head">
            <img class="admin-user-avatar" src="${avatar}" alt="avatar">
            <div>
                <div class="admin-user-name" style="font-size:16px;">${escapeHtml(selected.username || userId)}</div>
                <div class="admin-user-meta">ID: ${escapeHtml(userId)}</div>
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>用户名</label>
                <input id="adminDetailNameInput" class="input-modern" value="${escapeHtml(selected.username || userId)}">
            </div>
            <div class="form-group">
                <label>角色</label>
                <select id="adminDetailRoleSelect" class="input-modern" ${isSelf ? 'disabled' : ''}>
                    <option value="member" ${selected.role === 'member' ? 'selected' : ''}>member</option>
                    <option value="admin" ${selected.role === 'admin' ? 'selected' : ''}>admin</option>
                </select>
            </div>
            <div class="form-group">
                <label>最后登录IP</label>
                <div class="admin-info-text">${escapeHtml(selected.last_ip || '-')}</div>
            </div>
            <div class="form-group">
                <label>Token 消耗</label>
                <div class="admin-info-text mono">${(selected.total_token_usage || 0).toLocaleString()}</div>
            </div>
            <div class="form-group">
                <label>创建时间</label>
                <div class="admin-info-text">${createdAt}</div>
            </div>
            <div class="form-group">
                <label>最后登录</label>
                <div class="admin-info-text">${lastLogin}</div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>绑定邮箱账户</label>
                <div class="admin-info-text" style="margin-bottom:8px;">当前: ${escapeHtml(currentMailText)}</div>
                <div style="display:flex; gap:8px;">
                    <input id="adminDetailMailUsernameInput" class="input-modern" type="text" placeholder="输入邮箱用户名，例如 himpq">
                    <button class="btn-primary-outline btn-compact" type="button" onclick="adminBindMailForUser('${encodeURIComponent(userId)}')">确认</button>
                </div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>重置密码</label>
                <div style="display:flex; gap:8px;">
                    <input id="adminDetailPasswordInput" class="input-modern" type="text" placeholder="输入新密码">
                    <button class="btn-primary-outline btn-compact" type="button" onclick="adminResetPassword('${encodeURIComponent(userId)}')">重置</button>
                </div>
            </div>
        </div>
        <div class="admin-user-actions">
            <button class="btn-primary-outline btn-compact" type="button" onclick="openUserModelPerm(decodeURIComponent('${encodedUserId}'))">模型权限</button>
            <button class="btn-primary-outline btn-compact" type="button" onclick="saveAdminUserProfile('${encodedUserId}')">保存资料</button>
            ${!isSelf ? `<button class="btn-danger-small btn-compact" type="button" onclick="deleteAdminUser(decodeURIComponent('${encodedUserId}'))">删除用户</button>` : ''}
        </div>
    `;
}

window.selectAdminUser = function(encodedUserId) {
    adminSelectedUserId = decodeURIComponent(encodedUserId || '');
    renderAdminUsersList();
    renderAdminUserDetail();
};

async function loadAdminMailGroups() {
    const groupSelect = document.getElementById('adminMailGroupSelect');
    if (!groupSelect) return;
    try {
        const res = await fetch('/api/admin/nexora-mail/groups');
        const data = await res.json();
        if (!data.success) {
            groupSelect.innerHTML = `<option value="default">default</option>`;
            groupSelect.value = 'default';
            adminMailGroup = 'default';
            return;
        }
        const groups = Array.isArray(data.groups) ? data.groups : [];
        const names = groups.map(g => String(g.group || '').trim()).filter(Boolean);
        if (!names.includes('default')) names.unshift('default');
        groupSelect.innerHTML = names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        if (!names.includes(adminMailGroup)) adminMailGroup = names[0] || 'default';
        groupSelect.value = adminMailGroup;
    } catch (err) {
        groupSelect.innerHTML = `<option value="default">default</option>`;
        groupSelect.value = 'default';
        adminMailGroup = 'default';
    }
}

async function loadAdminMailUsersList() {
    const listEl = document.getElementById('adminMailUsersList');
    if (listEl) listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">加载中...</div>';
    try {
        await loadAdminMailGroups();
        const res = await fetch(`/api/admin/nexora-mail/users?group=${encodeURIComponent(adminMailGroup)}`);
        const data = await res.json();
        if (!data.success) {
            adminMailUsersCache = [];
            adminSelectedMailUser = null;
            renderAdminMailUsersList();
            renderAdminMailDetailError(data.message || '读取邮箱用户失败');
            return;
        }
        adminMailUsersCache = Array.isArray(data.users) ? data.users : [];
        await ensureAdminUsersCacheForBinding();
        if (!adminSelectedMailUser || !adminMailUsersCache.some(u => (u.username || '') === adminSelectedMailUser)) {
            adminSelectedMailUser = adminMailUsersCache[0] ? adminMailUsersCache[0].username : null;
        }
        renderAdminMailUsersList();
        renderAdminMailUserDetail();
    } catch (err) {
        adminMailUsersCache = [];
        adminSelectedMailUser = null;
        renderAdminMailUsersList();
        renderAdminMailDetailError('邮箱服务连接失败');
    }
}

async function ensureAdminUsersCacheForBinding() {
    if (Array.isArray(adminUsersCache) && adminUsersCache.length > 0) return;
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
            adminUsersCache = data.users;
        }
    } catch (err) {
        // ignore
    }
}

function renderAdminMailUsersList() {
    const listEl = document.getElementById('adminMailUsersList');
    if (!listEl) return;
    const kw = adminMailUserFilterKeyword;
    const filtered = adminMailUsersCache.filter((item) => {
        if (!kw) return true;
        const perms = Array.isArray(item.permissions) ? item.permissions.join(' ') : '';
        const txt = `${item.username || ''} ${item.path || ''} ${perms}`.toLowerCase();
        return txt.includes(kw);
    });
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">没有匹配的邮箱用户</div>';
        return;
    }
    listEl.innerHTML = filtered.map((item) => {
        const uname = String(item.username || '');
        const active = uname === adminSelectedMailUser ? 'active' : '';
        const safe = encodeURIComponent(uname);
        const avatar = getDefaultAvatarDataUrl(uname || 'M');
        return `
            <div class="admin-user-item ${active}" onclick="selectAdminMailUser('${safe}')">
                <img class="admin-user-avatar" src="${avatar}" alt="avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">group: ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminMailDetailError(msg) {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    detail.innerHTML = `<div class="admin-user-detail-empty">${escapeHtml(msg || '加载失败')}</div>`;
}

function renderAdminMailCreateForm() {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    detail.innerHTML = `
        <div class="admin-user-detail-head">
            <div>
                <div class="admin-user-name" style="font-size:16px;">新建邮箱用户</div>
                <div class="admin-user-meta">当前组: ${escapeHtml(adminMailGroup)}</div>
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>邮箱用户名</label>
                <input id="adminMailCreateUsername" class="input-modern" placeholder="例如: alice">
            </div>
            <div class="form-group">
                <label>初始密码</label>
                <input id="adminMailCreatePassword" class="input-modern" type="text" placeholder="输入密码">
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>权限(可选，逗号分隔)</label>
                <input id="adminMailCreatePermissions" class="input-modern" placeholder="mailbox.read, mailbox.write">
            </div>
        </div>
        <div class="admin-user-actions">
            <button class="btn-primary-outline btn-compact" type="button" onclick="submitAdminMailCreateUser()">创建邮箱用户</button>
        </div>
    `;
}

function renderAdminMailUserDetail() {
    const detail = document.getElementById('adminMailUserDetail');
    if (!detail) return;
    const selected = adminMailUsersCache.find((u) => (u.username || '') === adminSelectedMailUser);
    if (!selected) {
        detail.innerHTML = '<div class="admin-user-detail-empty">请选择左侧邮箱用户查看详情</div>';
        return;
    }
    const uname = String(selected.username || '');
    const perms = Array.isArray(selected.permissions) ? selected.permissions : [];
    const permsText = perms.length ? perms.join(', ') : '-';
    const encoded = encodeURIComponent(uname);
    const avatar = getDefaultAvatarDataUrl(uname || 'M');
    const boundNexoraUser = (adminUsersCache || []).find((u) => {
        const lm = u && typeof u === 'object' ? (u.local_mail || {}) : {};
        return (lm.username || '') === uname && (lm.group || 'default') === adminMailGroup;
    }) || null;
    const boundPairHtml = boundNexoraUser ? `
        <div class="admin-bind-pair">
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${avatar}" alt="mail-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">Mail User · ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
            <div class="admin-bind-arrow" aria-hidden="true">↔</div>
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${boundNexoraUser.avatar_url || getDefaultAvatarDataUrl(boundNexoraUser.username || boundNexoraUser.user_id || 'U')}" alt="nexora-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(boundNexoraUser.username || boundNexoraUser.user_id || '')}</div>
                    <div class="admin-user-meta">UserID: ${escapeHtml(boundNexoraUser.user_id || '')}</div>
                </div>
            </div>
        </div>
    ` : `
        <div class="admin-bind-pair" style="grid-template-columns: minmax(0, 1fr);">
            <div class="admin-bind-card">
                <img class="admin-user-avatar" src="${avatar}" alt="mail-avatar">
                <div>
                    <div class="admin-user-name">${escapeHtml(uname)}</div>
                    <div class="admin-user-meta">Mail User · ${escapeHtml(adminMailGroup)}</div>
                </div>
            </div>
        </div>
    `;
    detail.innerHTML = `
        ${boundPairHtml}
        <div class="form-group" style="margin-bottom: 8px;">
            <div style="display:flex; gap:8px;">
                <input id="adminMailBindNexoraUserInput" class="input-modern" type="text" placeholder="输入 Nexora 用户ID，例如 mujica">
                <button class="btn-primary-outline btn-compact" type="button" onclick="adminBindNexoraUserForMail('${encoded}')">确认</button>
            </div>
        </div>
        <div class="admin-user-detail-grid">
            <div class="form-group">
                <label>邮箱用户名</label>
                <div class="admin-info-text">${escapeHtml(uname)}</div>
            </div>
            <div class="form-group">
                <label>权限</label>
                <div class="admin-info-text">${escapeHtml(permsText)}</div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>存储路径</label>
                <div class="admin-info-text mono">${escapeHtml(selected.path || '-')}</div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>重置密码</label>
                <div style="display:flex; gap:8px;">
                    <input id="adminMailPasswordInput" class="input-modern" type="text" placeholder="输入新密码">
                    <button class="btn-primary-outline btn-compact" type="button" onclick="adminResetMailPassword('${encoded}')">重置</button>
                </div>
            </div>
        </div>
        <div class="admin-user-actions">
            <button class="btn-danger-small btn-compact" type="button" onclick="adminDeleteMailUser('${encoded}')">删除邮箱用户</button>
        </div>
    `;
}

window.selectAdminMailUser = function(encodedUser) {
    adminSelectedMailUser = decodeURIComponent(encodedUser || '');
    renderAdminMailUsersList();
    renderAdminMailUserDetail();
};

window.submitAdminMailCreateUser = async function() {
    const unameEl = document.getElementById('adminMailCreateUsername');
    const pwdEl = document.getElementById('adminMailCreatePassword');
    const permsEl = document.getElementById('adminMailCreatePermissions');
    const username = (unameEl && unameEl.value ? unameEl.value : '').trim();
    const password = (pwdEl && pwdEl.value ? pwdEl.value : '').trim();
    const permsRaw = (permsEl && permsEl.value ? permsEl.value : '').trim();
    if (!username || !password) {
        showToast('请填写邮箱用户名和密码');
        return;
    }
    const permissions = permsRaw ? permsRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
    try {
        const res = await fetch('/api/admin/nexora-mail/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group: adminMailGroup,
                mail_username: username,
                password,
                permissions
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '创建失败');
            return;
        }
        showToast('邮箱用户创建成功');
        adminSelectedMailUser = username;
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('创建失败');
    }
};

window.adminResetMailPassword = async function(encodedUser) {
    const username = decodeURIComponent(encodedUser || '');
    const pwdEl = document.getElementById('adminMailPasswordInput');
    const password = (pwdEl && pwdEl.value ? pwdEl.value : '').trim();
    if (!password) {
        showToast('请输入新密码');
        return;
    }
    try {
        const res = await fetch('/api/admin/nexora-mail/users/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group: adminMailGroup, mail_username: username, password })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '重置失败');
            return;
        }
        showToast('邮箱密码已重置');
        pwdEl.value = '';
    } catch (err) {
        showToast('重置失败');
    }
};

window.adminBindMailForUser = async function(encodedUserId) {
    const userId = decodeURIComponent(encodedUserId || '');
    const input = document.getElementById('adminDetailMailUsernameInput');
    const mailUsername = (input && input.value ? input.value : '').trim();
    if (!userId || !mailUsername) {
        showToast('请输入要绑定的邮箱用户名');
        return;
    }
    try {
        const res = await fetch('/api/admin/nexora-mail/bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                mail_username: mailUsername
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '绑定失败');
            return;
        }
        showToast('邮箱绑定成功');
        await loadAdminUsersList();
        if (document.getElementById('settings-admin-mail-tab')?.classList.contains('active')) {
            await loadAdminMailUsersList();
        }
    } catch (err) {
        showToast('绑定失败');
    }
};

window.adminBindNexoraUserForMail = async function(encodedMailUser) {
    const mailUsername = decodeURIComponent(encodedMailUser || '');
    const input = document.getElementById('adminMailBindNexoraUserInput');
    const nexoraUserId = (input && input.value ? input.value : '').trim();
    if (!mailUsername || !nexoraUserId) {
        showToast('请输入目标 Nexora 用户ID');
        return;
    }
    try {
        const res = await fetch('/api/admin/nexora-mail/bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: nexoraUserId,
                group: adminMailGroup,
                mail_username: mailUsername
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '绑定失败');
            return;
        }
        showToast('绑定已更新');
        await loadAdminUsersList();
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('绑定失败');
    }
};

window.adminDeleteMailUser = async function(encodedUser) {
    const username = decodeURIComponent(encodedUser || '');
    if (!username) return;
    const ok = await confirmModalAsync('删除邮箱用户', `确认删除邮箱用户「${username}」吗？`, 'danger');
    if (!ok) return;
    try {
        const res = await fetch('/api/admin/nexora-mail/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group: adminMailGroup, mail_username: username })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '删除失败');
            return;
        }
        showToast('邮箱用户已删除');
        if (adminSelectedMailUser === username) adminSelectedMailUser = null;
        await loadAdminMailUsersList();
    } catch (err) {
        showToast('删除失败');
    }
};

function getDefaultAvatarDataUrl(name) {
    const ch = (name || 'U').charAt(0).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' rx='64' fill='#e2e8f0'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' font-size='56' fill='#334155' font-family='Arial'>${ch}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// --- 模型权限管理 ---
let currentTargetPermUser = null;

window.openUserModelPerm = async function(username) {
    currentTargetPermUser = username;
    const modal = document.getElementById('modelPermModal');
    if (!modal) return;
    
    const targetUserSpan = document.getElementById('permTargetUser');
    if(targetUserSpan) targetUserSpan.textContent = username;
    modal.classList.add('active');
    
    const listContainer = document.getElementById('modelPermList');
    if(listContainer) {
// 说明
    }
    
    try {
        const res = await fetch(`/api/admin/user/models?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        
        if (data.success && listContainer) {
            listContainer.innerHTML = data.models.map(m => `
                <div class="perm-item">
                    <label>
                        <input type="checkbox" class="model-perm-checkbox" data-id="${m.id}" ${!m.is_blocked ? 'checked' : ''}>
                        <div class="model-info">
                            <div class="model-name">${m.name}</div>
                            <div class="model-meta">
                                <span class="model-id">${m.id}</span>
                                ${m.provider ? `<span class="provider-badge">${m.provider}</span>` : ''}
                            </div>
                        </div>
                        <span class="status-badge ${!m.is_blocked ? 'status-allowed' : 'status-blocked'}">
                            ${!m.is_blocked ? '✓ 已开启' : '× 已禁用'}
                        </span>
                    </label>
                </div>
            `).join('');
        } else if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">${data.message || '获取失败'}</div>`;
        }
    } catch (err) {
        if (listContainer) listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">加载错误: ${err.message}</div>`;
    }
};

window.saveUserModelPermissions = async function() {
    if (!currentTargetPermUser) return;
    
    const checkboxes = document.querySelectorAll('.model-perm-checkbox');
    const blocked_models = [];
    checkboxes.forEach(cb => {
        if (!cb.checked) {
            blocked_models.push(cb.getAttribute('data-id'));
        }
    });
    
    try {
        const res = await fetch('/api/admin/user/models/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: currentTargetPermUser,
                blocked_models: blocked_models
            })
        });
        const data = await res.json();
        if (data.success) {
// 说明
            closeModelPermModal();
            // 如果修改的是当前登录用户，则刷新页面
            if (currentTargetPermUser === currentUsername) {
                setTimeout(() => location.reload(), 800);
            }
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch (err) {
        showToast('保存时发生错误');
    }
};

window.closeModelPermModal = function() {
    const modal = document.getElementById('modelPermModal');
    if (modal) modal.classList.remove('active');
    currentTargetPermUser = null;
};

let adminModelConfigCache = { models: {}, providers: {} };
let adminSelectedProvider = '';
let adminModelSearchKeyword = '';
let adminTextConfirmHandler = null;
let adminPanelScrollState = { providers: 0, models: 0 };
let adminConfigState = { mode: '', originalKey: '' };

function maskSecret(secret) {
    const s = String(secret || '');
    if (!s) return '(empty)';
    if (s.length <= 8) return '*'.repeat(s.length);
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

window.closeAdminTextConfirmModal = function() {
    const modal = document.getElementById('adminTextConfirmModal');
    const input = document.getElementById('adminTextConfirmInput');
    if (input) input.value = '';
    if (modal) modal.classList.remove('active');
    adminTextConfirmHandler = null;
};

function showAdminTextConfirmModal(onConfirm) {
    const modal = document.getElementById('adminTextConfirmModal');
    const input = document.getElementById('adminTextConfirmInput');
    const okBtn = document.getElementById('adminTextConfirmOkBtn');
    if (!modal || !input || !okBtn) return;

    adminTextConfirmHandler = onConfirm;
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 40);

    okBtn.onclick = async () => {
        const text = input.value.trim();
        if (text !== '确认修改') {
            showToast('请输入“确认修改”');
            return;
        }
        if (typeof adminTextConfirmHandler === 'function') {
            await adminTextConfirmHandler(text);
        }
        closeAdminTextConfirmModal();
    };
}

async function loadAdminModelConfig() {
    const listEl = document.getElementById('adminModelConfigList');
    if (!listEl) return;
    const searchInput = document.getElementById('adminModelSearchInput');
    if (searchInput && searchInput.value !== adminModelSearchKeyword) {
        searchInput.value = adminModelSearchKeyword;
    }
    listEl.innerHTML = '<div class="model-admin-empty">Loading...</div>';
    try {
        const res = await fetch('/api/admin/models/config');
        const data = await res.json();
        if (!data.success) {
            listEl.innerHTML = `<div class="model-admin-empty" style="color:#dc2626;">${escapeHtml(data.message || '加载失败')}</div>`;
            return;
        }
        adminModelConfigCache = {
            models: data.models || {},
            providers: data.providers || {}
        };
        const providerKeys = Object.keys(adminModelConfigCache.providers || {}).sort((a, b) => a.localeCompare(b));
        if (!adminSelectedProvider || !adminModelConfigCache.providers[adminSelectedProvider]) {
            adminSelectedProvider = providerKeys[0] || '';
        }
        renderAdminModelConfig();
    } catch (err) {
        listEl.innerHTML = `<div class="model-admin-empty" style="color:#dc2626;">${escapeHtml(err.message || '加载失败')}</div>`;
    }
}

function renderAdminModelConfig(options = {}) {
    const resetModelsScroll = !!options.resetModelsScroll;
    const listEl = document.getElementById('adminModelConfigList');
    if (!listEl) return;

    const oldProviderList = listEl.querySelector('.model-admin-col-list[data-col="providers"]');
    const oldModelList = listEl.querySelector('.model-admin-col-list[data-col="models"]');
    const providerScroll = oldProviderList ? oldProviderList.scrollTop : adminPanelScrollState.providers;
    const modelScroll = resetModelsScroll ? 0 : (oldModelList ? oldModelList.scrollTop : adminPanelScrollState.models);
    adminPanelScrollState.providers = providerScroll;
    adminPanelScrollState.models = modelScroll;

    const providers = adminModelConfigCache.providers || {};
    const models = adminModelConfigCache.models || {};
    const allProviderEntries = Object.entries(providers).sort((a, b) => a[0].localeCompare(b[0]));
    const query = String(adminModelSearchKeyword || '').trim().toLowerCase();

    const providerMatches = (providerKey, providerInfo) => {
        if (!query) return true;
        const baseUrl = (providerInfo && providerInfo.base_url) ? String(providerInfo.base_url) : '';
        return providerKey.toLowerCase().includes(query) || baseUrl.toLowerCase().includes(query);
    };
    const modelMatches = (modelId, modelInfo) => {
        if (!query) return true;
        const provider = (modelInfo && modelInfo.provider) ? String(modelInfo.provider) : '';
        const name = (modelInfo && modelInfo.name) ? String(modelInfo.name) : '';
        const status = (modelInfo && modelInfo.status) ? String(modelInfo.status) : '';
        return (
            modelId.toLowerCase().includes(query) ||
            name.toLowerCase().includes(query) ||
            status.toLowerCase().includes(query) ||
            provider.toLowerCase().includes(query)
        );
    };

    const providerEntries = allProviderEntries.filter(([providerKey, providerInfo]) => {
        if (providerMatches(providerKey, providerInfo)) return true;
        return Object.entries(models).some(([modelId, modelInfo]) => {
            const provider = (modelInfo && modelInfo.provider) ? String(modelInfo.provider) : '';
            return provider === providerKey && modelMatches(modelId, modelInfo);
        });
    });

    if (!providerEntries.some(([providerKey]) => providerKey === adminSelectedProvider)) {
        adminSelectedProvider = providerEntries[0] ? providerEntries[0][0] : '';
    }

    const selectedProviderInfo = providers[adminSelectedProvider] || {};
    const selectedProviderMatch = providerMatches(adminSelectedProvider, selectedProviderInfo);
    const modelEntries = Object.entries(models)
        .filter(([, info]) => !adminSelectedProvider || ((info && info.provider) || '') === adminSelectedProvider)
        .filter(([modelId, modelInfo]) => {
            if (!query) return true;
            if (selectedProviderMatch) return true;
            return modelMatches(modelId, modelInfo);
        })
        .sort((a, b) => a[0].localeCompare(b[0]));

    const providersHtml = providerEntries.length ? providerEntries.map(([key, info]) => `
        <div class="provider-item ${key === adminSelectedProvider ? 'active' : ''}" onclick="adminSelectProviderByEncoded('${encodeURIComponent(key)}')">
            <div class="model-admin-item-main provider-item-main">
                <div class="provider-item-head">
                    ${renderProviderIconHtml(key, { className: 'provider-logo provider-logo-md', label: key })}
                    <div class="provider-item-name">${escapeHtml(key)}</div>
                </div>
                <div class="provider-item-meta">${escapeHtml(maskSecret(info && info.api_key))}</div>
                <div class="provider-item-meta">${escapeHtml((info && info.base_url) || '')}</div>
            </div>
            <div class="model-admin-item-actions">
                <button class="model-icon-btn" title="Edit Provider" onclick="event.stopPropagation(); adminEditProviderByEncoded('${encodeURIComponent(key)}')"><i class="fa-solid fa-pen"></i></button>
                <button class="model-icon-btn model-icon-btn-danger" title="Delete Provider" onclick="event.stopPropagation(); adminDeleteProviderByEncoded('${encodeURIComponent(key)}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join('') : '<div class="model-admin-empty">无供应商</div>';

    const modelsHtml = modelEntries.length ? modelEntries.map(([id, info]) => `
        <div class="model-admin-item">
            <div class="model-admin-item-main">
                <div class="model-admin-item-name">${escapeHtml(id)} (${escapeHtml((info && info.name) || id)})</div>
                <div class="model-admin-item-meta">provider: ${renderProviderInlineHtml((info && info.provider) || '', (info && info.provider) || '-')}</div>
                <div class="model-admin-item-meta">status: ${escapeHtml((info && info.status) || 'normal')}</div>
            </div>
            <div class="model-admin-item-actions">
                <button class="model-icon-btn" title="修改模型" onclick="adminEditModelByEncoded('${encodeURIComponent(id)}')"><i class="fa-solid fa-pen"></i></button>
                <button class="model-icon-btn model-icon-btn-danger" title="Delete Model" onclick="adminDeleteModelByEncoded('${encodeURIComponent(id)}')"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join('') : `<div class="model-admin-empty">${adminSelectedProvider ? '该供应商无模型' : '无模型'}</div>`;

    listEl.innerHTML = `
        <div class="model-admin-master">
            <div class="model-admin-col">
                <div class="model-admin-col-title">供应商 (${providerEntries.length})</div>
                <div class="model-admin-col-list" data-col="providers">${providersHtml}</div>
            </div>
            <div class="model-admin-col">
                <div class="model-admin-col-title">模型 ${adminSelectedProvider ? `(${escapeHtml(adminSelectedProvider)})` : ''}</div>
                <div class="model-admin-col-list" data-col="models">${modelsHtml}</div>
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        const providerList = listEl.querySelector('.model-admin-col-list[data-col="providers"]');
        const modelList = listEl.querySelector('.model-admin-col-list[data-col="models"]');
        if (providerList) providerList.scrollTop = providerScroll;
        if (modelList) modelList.scrollTop = modelScroll;
    });
}

window.adminSelectProviderByEncoded = function(encoded) {
    const next = decodeURIComponent(encoded || '');
    if (next === adminSelectedProvider) return;
    adminSelectedProvider = next;
    renderAdminModelConfig({ resetModelsScroll: true });
};

function openAdminConfigModal(mode, payload = {}) {
    const modal = document.getElementById('adminConfigModal');
    const title = document.getElementById('adminConfigModalTitle');
    const providerFields = document.getElementById('adminConfigProviderFields');
    const modelFields = document.getElementById('adminConfigModelFields');
    if (!modal || !title || !providerFields || !modelFields) return;

    adminConfigState = {
        mode,
        originalKey: payload.originalKey || ''
    };

    if (mode === 'provider') {
        title.textContent = payload.originalKey ? '修改供应商' : '添加供应商';
        providerFields.style.display = '';
        modelFields.style.display = 'none';
        document.getElementById('adminProviderNameInput').value = payload.provider || '';
        document.getElementById('adminProviderApiKeyInput').value = payload.api_key || '';
        document.getElementById('adminProviderBaseUrlInput').value = payload.base_url || '';
    } else {
        title.textContent = payload.originalKey ? '修改模型' : '添加模型';
        providerFields.style.display = 'none';
        modelFields.style.display = '';
        document.getElementById('adminModelIdInput').value = payload.model_id || '';
        document.getElementById('adminModelNameInput').value = payload.name || '';
        document.getElementById('adminModelStatusInput').value = payload.status || 'normal';

        const providerSelect = document.getElementById('adminModelProviderInput');
        const providers = Object.keys(adminModelConfigCache.providers || {}).sort((a, b) => a.localeCompare(b));
        providerSelect.innerHTML = providers.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
        providerSelect.value = payload.provider || adminSelectedProvider || providers[0] || '';
    }

    modal.classList.add('active');
}

window.closeAdminConfigModal = function() {
    const modal = document.getElementById('adminConfigModal');
    if (modal) modal.classList.remove('active');
    adminConfigState = { mode: '', originalKey: '' };
};

async function saveAdminConfigModal() {
    try {
        if (adminConfigState.mode === 'provider') {
            const provider = (document.getElementById('adminProviderNameInput').value || '').trim();
            const apiKey = document.getElementById('adminProviderApiKeyInput').value || '';
            const baseUrl = document.getElementById('adminProviderBaseUrlInput').value || '';
            if (!provider) {
                showToast('供应商名称是必填项');
                return;
            }
            const res = await fetch('/api/admin/models/provider/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    api_key: apiKey,
                    base_url: baseUrl
                })
            });
            const data = await res.json();
            if (!data.success) {
                showToast('Save failed: ' + (data.message || 'Unknown error'));
                return;
            }
            adminSelectedProvider = provider;
            closeAdminConfigModal();
            await loadAdminModelConfig();
            return;
        }

        if (adminConfigState.mode === 'model') {
            const modelId = (document.getElementById('adminModelIdInput').value || '').trim();
            const modelName = (document.getElementById('adminModelNameInput').value || '').trim();
            const provider = (document.getElementById('adminModelProviderInput').value || '').trim();
            const status = (document.getElementById('adminModelStatusInput').value || 'normal').trim();
            if (!modelId || !provider) {
                showToast('模型ID和供应商是必填项');
                return;
            }
            const res = await fetch('/api/admin/models/model/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_model_id: (adminConfigState.originalKey || '').trim(),
                    model_id: modelId,
                    name: modelName || modelId,
                    provider,
                    status: status || 'normal'
                })
            });
            const data = await res.json();
            if (!data.success) {
                showToast('保存失败: ' + (data.message || '未知错误'));
                return;
            }
            adminSelectedProvider = provider;
            closeAdminConfigModal();
            await loadAdminModelConfig();
        }
    } catch (err) {
        showToast('保存失败: ' + (err.message || '未知错误'));
    }
}

async function openProviderEditor(providerName = '') {
    const providers = adminModelConfigCache.providers || {};
    const current = providerName ? (providers[providerName] || {}) : {};
    openAdminConfigModal('provider', {
        originalKey: providerName || '',
        provider: providerName || '',
        api_key: current.api_key || '',
        base_url: current.base_url || ''
    });
}

async function openModelEditor(modelId = '') {
    const models = adminModelConfigCache.models || {};
    const current = modelId ? (models[modelId] || {}) : {};
    openAdminConfigModal('model', {
        originalKey: modelId || '',
        model_id: modelId || '',
        name: current.name || '',
        provider: current.provider || adminSelectedProvider || '',
        status: current.status || 'normal'
    });
}

window.adminEditProvider = function(provider) {
    openProviderEditor(provider);
};

window.adminEditModel = function(modelId) {
    openModelEditor(modelId);
};

window.adminEditProviderByEncoded = function(encoded) {
    openProviderEditor(decodeURIComponent(encoded || ''));
};

window.adminDeleteProviderByEncoded = function(encoded) {
    window.adminDeleteProvider(decodeURIComponent(encoded || ''));
};

window.adminEditModelByEncoded = function(encoded) {
    openModelEditor(decodeURIComponent(encoded || ''));
};

window.adminDeleteModelByEncoded = function(encoded) {
    window.adminDeleteModel(decodeURIComponent(encoded || ''));
};

window.adminDeleteProvider = function(provider) {
    showAdminTextConfirmModal(async (confirmText) => {
        const res = await fetch('/api/admin/models/provider/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, confirm_text: confirmText })
        });
        const data = await res.json();
        if (!data.success) {
            showToast('删除失败: ' + (data.message || '未知错误'));
            return;
        }
        showToast('供应商已删除');
        await loadAdminModelConfig();
    });
};

window.adminDeleteModel = function(modelId) {
    showAdminTextConfirmModal(async (confirmText) => {
        const res = await fetch('/api/admin/models/model/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_id: modelId, confirm_text: confirmText })
        });
        const data = await res.json();
        if (!data.success) {
            showToast('删除失败: ' + (data.message || '未知错误'));
            return;
        }
        showToast('模型已删除');
        await loadAdminModelConfig();
    });
};

// 加载统计信息

// ChromaDB stats
async function loadAdminChromaStats() {
    try {
        const res = await fetch('/api/admin/chroma/stats');
        const data = await res.json();
        const statusEl = document.getElementById('statChromaStatus');
        const totalEl = document.getElementById('statChromaTotal');
        const listEl = document.getElementById('adminChromaList');

        if (!statusEl || !totalEl || !listEl) return;

        if (!data.success) {
            statusEl.textContent = 'error';
            totalEl.textContent = '-';
            listEl.innerHTML = `<tr><td colspan="2">${data.message || 'Failed to load'}</td></tr>`;
            return;
        }

        if (!data.enabled) {
            statusEl.textContent = 'disabled';
            totalEl.textContent = '0';
            listEl.innerHTML = `<tr><td colspan="2">ChromaDB disabled</td></tr>`;
            return;
        }

        statusEl.textContent = data.mode || 'service';
        totalEl.textContent = (data.total_vectors || 0).toLocaleString();

        const rows = (data.collections || []).map(c => {
            return `<tr><td>${c.name}</td><td class="mono">${(c.count || 0).toLocaleString()}</td></tr>`;
        }).join('');
        listEl.innerHTML = rows || '<tr><td colspan="2">无联系</td></tr>';
    } catch (err) {
        console.error('Failed to load chroma stats:', err);
    }
}

async function loadAdminStats() {
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
            const totalUsers = data.users.length;
            const adminCount = data.users.filter(u => u.role === 'admin').length;
            
            document.getElementById('statTotalUsers').textContent = totalUsers;
            document.getElementById('statAdminCount').textContent = adminCount;
            
            // Get token stats
            const tokenRes = await fetch('/api/admin/tokens/stats');
            const tokenData = await tokenRes.json();
            if (tokenData.success) {
                document.getElementById('statTotalTokens').textContent = (tokenData.total || 0).toLocaleString();
            }

            const trendRes = await fetch('/api/admin/tokens/timeseries?days=30');
            const trendData = await trendRes.json();
            if (trendData.success) {
                renderAdminTokenTrend(trendData);
            }

            const toolRes = await fetch('/api/admin/tools/stats?days=30');
            const toolData = await toolRes.json();
            if (toolData.success) {
                renderAdminToolTrend(toolData);
            }
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

function renderAdminTokenTrend(data) {
    const chartWrap = document.getElementById('adminTokenTrendChart');
    const meta = document.getElementById('adminTokenTrendMeta');
    const top = document.getElementById('adminTokenTrendTop');
    if (!chartWrap || !meta || !top) return;

    const labels = Array.isArray(data.labels) ? data.labels : [];
    const totalSeries = (data.series && Array.isArray(data.series.total_tokens)) ? data.series.total_tokens : [];
    const reqSeries = (data.series && Array.isArray(data.series.requests)) ? data.series.requests : [];

    if (!labels.length || !totalSeries.length) {
        chartWrap.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:12px;">暂无趋势数据</div>';
        meta.textContent = '-';
        top.innerHTML = '';
        return;
    }

    const totalSum = totalSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    const reqSum = reqSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    meta.textContent = `总请求 ${reqSum.toLocaleString()} · 总Token ${totalSum.toLocaleString()}`;

    const width = Math.max((chartWrap.clientWidth || 720) - 24, 360);
    const height = 220;
    const padL = 44;
    const padR = 14;
    const padT = 12;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(...totalSeries, 1);

    const points = totalSeries.map((v, i) => {
        const x = padL + (plotW * i / Math.max(totalSeries.length - 1, 1));
        const y = padT + plotH - ((Number(v) || 0) / maxVal) * plotH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const y = padT + plotH - (plotH * r);
        const val = Math.round(maxVal * r).toLocaleString();
        return `
            <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
        `;
    }).join('');

    const firstLabel = labels[0] || '';
    const midLabel = labels[Math.floor(labels.length / 2)] || '';
    const lastLabel = labels[labels.length - 1] || '';

    chartWrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${yTicks}
            <polyline fill="none" stroke="#2563eb" stroke-width="2.2" points="${points}" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="${padL}" y="${height - 8}" font-size="10" fill="#94a3b8">${firstLabel}</text>
            <text x="${padL + plotW / 2}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="middle">${midLabel}</text>
            <text x="${width - padR}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="end">${lastLabel}</text>
        </svg>
    `;

    const providers = Array.isArray(data.top_providers) ? data.top_providers.slice(0, 4) : [];
    const models = Array.isArray(data.top_models) ? data.top_models.slice(0, 4) : [];
    top.innerHTML = `
        <div class="trend-block">
            <div class="trend-title">Top Providers</div>
            ${(providers.length ? providers : [{name:'-', tokens:0}]).map(p => `
                <div class="trend-item"><span>${escapeHtml(String(p.name || '-'))}</span><span class="mono">${Number(p.tokens || 0).toLocaleString()}</span></div>
            `).join('')}
        </div>
        <div class="trend-block">
            <div class="trend-title">Top Models</div>
            ${(models.length ? models : [{name:'-', tokens:0}]).map(m => `
                <div class="trend-item"><span>${escapeHtml(String(m.name || '-'))}</span><span class="mono">${Number(m.tokens || 0).toLocaleString()}</span></div>
            `).join('')}
        </div>
    `;
}

function renderAdminToolTrend(data) {
    const chartWrap = document.getElementById('adminToolTrendChart');
    const meta = document.getElementById('adminToolTrendMeta');
    const top = document.getElementById('adminToolTrendTop');
    const totalCallsEl = document.getElementById('toolStatTotalCalls');
    const errorRateEl = document.getElementById('toolStatErrorRate');
    const avgLatencyEl = document.getElementById('toolStatAvgLatency');
    const failed24hEl = document.getElementById('toolStatFailed24h');
    if (!chartWrap || !meta || !top || !totalCallsEl || !errorRateEl || !avgLatencyEl || !failed24hEl) return;

    const summary = data.summary || {};
    totalCallsEl.textContent = Number(summary.total_calls || 0).toLocaleString();
    errorRateEl.textContent = `${Number(summary.error_rate || 0).toFixed(2)}%`;
    avgLatencyEl.textContent = Number(summary.avg_latency_ms || 0).toFixed(2);
    failed24hEl.textContent = Number((data.top_failed_tools_24h || []).length || 0).toLocaleString();

    const labels = Array.isArray(data.labels) ? data.labels : [];
    const callSeries = (data.series && Array.isArray(data.series.calls)) ? data.series.calls : [];
    const errSeries = (data.series && Array.isArray(data.series.errors)) ? data.series.errors : [];
    if (!labels.length || !callSeries.length) {
        meta.textContent = '-';
        chartWrap.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:12px;">暂无工具统计数据</div>';
        top.innerHTML = '';
        return;
    }

    const totalCalls = callSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    const totalErrs = errSeries.reduce((a, b) => a + (Number(b) || 0), 0);
    meta.textContent = `调用 ${totalCalls.toLocaleString()} · 错误 ${totalErrs.toLocaleString()}`;

    const width = Math.max((chartWrap.clientWidth || 720) - 24, 360);
    const height = 220;
    const padL = 44;
    const padR = 14;
    const padT = 12;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(...callSeries, ...errSeries, 1);

    const makePoints = (series) => series.map((v, i) => {
        const x = padL + (plotW * i / Math.max(series.length - 1, 1));
        const y = padT + plotH - ((Number(v) || 0) / maxVal) * plotH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const callPoints = makePoints(callSeries);
    const errPoints = makePoints(errSeries);

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => {
        const y = padT + plotH - (plotH * r);
        const val = Math.round(maxVal * r).toLocaleString();
        return `
            <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
        `;
    }).join('');

    const firstLabel = labels[0] || '';
    const midLabel = labels[Math.floor(labels.length / 2)] || '';
    const lastLabel = labels[labels.length - 1] || '';

    chartWrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${yTicks}
            <polyline fill="none" stroke="#0f172a" stroke-width="2.2" points="${callPoints}" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline fill="none" stroke="#dc2626" stroke-width="2.2" points="${errPoints}" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="${padL}" y="${height - 8}" font-size="10" fill="#94a3b8">${firstLabel}</text>
            <text x="${padL + plotW / 2}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="middle">${midLabel}</text>
            <text x="${width - padR}" y="${height - 8}" font-size="10" fill="#94a3b8" text-anchor="end">${lastLabel}</text>
        </svg>
    `;

    const topTools = Array.isArray(data.top_tools) ? data.top_tools.slice(0, 5) : [];
    const failedTools = Array.isArray(data.top_failed_tools_24h) ? data.top_failed_tools_24h.slice(0, 5) : [];
    top.innerHTML = `
        <div class="trend-block">
            <div class="trend-title">Top Tools</div>
            ${(topTools.length ? topTools : [{name:'-', calls:0, error_rate:0, avg_latency_ms:0}]).map(t => `
                <div class="trend-item">
                    <span>${escapeHtml(String(t.name || '-'))}</span>
                    <span class="mono">${Number(t.calls || 0).toLocaleString()} / ${Number(t.error_rate || 0).toFixed(1)}%</span>
                </div>
            `).join('')}
        </div>
        <div class="trend-block">
            <div class="trend-title">Top Failed (24h)</div>
            ${(failedTools.length ? failedTools : [{name:'-', errors:0}]).map(t => `
                <div class="trend-item">
                    <span>${escapeHtml(String(t.name || '-'))}</span>
                    <span class="mono">${Number(t.errors || 0).toLocaleString()}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// 说明
function switchAdminTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('#adminModal .admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Deactivate all buttons
    document.querySelectorAll('#adminModal .admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Activate selected button
    const selectedBtn = document.querySelector(`#adminModal [data-tab="${tabName}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');
    if (tabName === 'chroma') {
        loadAdminChromaStats();
    }
    if (tabName === 'models') {
        loadAdminModelConfig();
    }

}

// 切换添加用户
function openAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.add('active');
// 说明
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'none';
    }
}

function closeAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.remove('active');
// 说明
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'auto';
    }
}

// 添加用户
async function submitAddUser() {
    const username = document.getElementById('formUsername').value.trim();
    const password = document.getElementById('formPassword').value.trim();
    const role = document.getElementById('formRole').value;
    
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }
    
    try {
        const res = await fetch('/api/admin/user/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.success) {
            alert('用户添加成功');
            document.getElementById('formUsername').value = '';
            document.getElementById('formPassword').value = '';
            closeAddUserModal(); // 关闭
            adminSelectedUserId = username;
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        alert('Network error');
    }
}

// 删除用户
async function deleteAdminUser(username) {
    if (username === currentUsername) {
        showToast('你不能删除自己');
        return;
    }

    const ok = await confirmModalAsync('删除用户', `确定要删除用户「${username}」吗？`, 'danger');
    if (!ok) return;
    
    try {
        const res = await fetch('/api/admin/user/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_user_id: username })
        });
        const data = await res.json();
        if (data.success) {
            showToast('用户已删除');
            if (adminSelectedUserId === username) {
                adminSelectedUserId = null;
            }
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            showToast('删除失败: ' + data.message);
        }
    } catch (err) {
        showToast('网络错误');
    }
}

// 改变用户角色
async function changeUserRole(username, newRole) {
    if (username === currentUsername) {
        showToast('你不能修改自己的权限');
        return;
    }

    const ok = await confirmModalAsync(
        '修改用户权限',
        `确定要将「${username}」修改为${newRole === 'admin' ? '管理员' : '普通用户'}吗？`,
        'primary'
    );
    if (!ok) {
        return;
    }

    try {
        const res = await fetch('/api/admin/user/role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: username, role: newRole })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`已将 ${username} 改为${newRole === 'admin' ? '管理员' : '普通用户'}`);
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch (err) {
        showToast('网络错误');
    }
}

window.saveAdminUserProfile = async function(encodedUserId) {
    const userId = decodeURIComponent(encodedUserId || '');
    const nameInput = document.getElementById('adminDetailNameInput');
    const roleSelect = document.getElementById('adminDetailRoleSelect');
    if (!nameInput || !roleSelect) return;
    const displayName = (nameInput.value || '').trim();
    const role = roleSelect.value;
    if (!displayName) {
        showToast('用户名不能为空');
        return;
    }
    try {
        const profileRes = await fetch('/api/admin/user/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, display_name: displayName })
        });
        const profileData = await profileRes.json();
        if (!profileData.success) {
            showToast(profileData.message || '保存失败');
            return;
        }
        if (userId !== currentUsername) {
            const roleRes = await fetch('/api/admin/user/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, role })
            });
            const roleData = await roleRes.json();
            if (!roleData.success) {
                showToast(roleData.message || '角色更新失败');
                return;
            }
        }
        showToast('用户资料已保存');
        await loadAdminUsersList();
    } catch (err) {
        showToast('保存失败');
    }
};

window.adminResetPassword = async function(encodedUserId) {
    const userId = decodeURIComponent(encodedUserId || '');
    const pwdInput = document.getElementById('adminDetailPasswordInput');
    if (!pwdInput) return;
    const pwd = (pwdInput.value || '').trim();
    if (!pwd) {
        showToast('请输入新密码');
        return;
    }
    try {
        const res = await fetch('/api/admin/user/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_user_id: userId, password: pwd })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '重置失败');
            return;
        }
        showToast('密码已重置');
        pwdInput.value = '';
    } catch (err) {
        showToast('重置失败');
    }
};



async function updateVectorInSettings() {
    if (!currentViewingKnowledge) {
        showToast('请先选择知识点');
        return;
    }
    if (vectorizeTasks[currentViewingKnowledge] && vectorizeTasks[currentViewingKnowledge].running) {
        showToast('该知识点正在向量化');
        return;
    }
    showToast('正在更新到向量库，可先关闭窗口');
    setVectorStatus('更新中...');
    vectorizeTitle = currentViewingKnowledge;
    const runId = ++vectorizeRunId;
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : currentViewingKnowledge;
        if (runId !== vectorizeRunId) return;

        const metaRes = await fetch('/api/knowledge/list');
        const metaData = await metaRes.json();
        const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
        const meta = basisMeta[liveTitle] || {};
        const updatedAt = Number(meta.updated_at || 0);
        const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
        if (updatedAt > 0 && vectorUpdatedAt >= updatedAt) {
            const chunksRes = await fetch('/api/knowledge/vector/chunks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: liveTitle })
            });
            const chunksData = await chunksRes.json();
            const chunkCount = (chunksData && chunksData.chunks ? chunksData.chunks : []).length;
            if (chunkCount > 0) {
                showToast('内容未变化，已跳过');
                setVectorStatus('无需更新');
                return;
            }
        }

        if (vectorizeTitle === currentViewingKnowledge) startVectorProgress(100);
        const vectorizeData = await vectorizeKnowledgeTitle(liveTitle, {
            silent: true,
            onProgress: (pct, msg) => {
                if (vectorizeTitle !== currentViewingKnowledge) return;
                updateVectorProgress(Math.max(0, Math.min(100, Number(pct) || 0)), 100, msg);
            }
        });
        if (!vectorizeData.success) {
            setVectorStatus('向量化失败');
            if (vectorizeTitle === currentViewingKnowledge) {
                stopVectorProgress('向量化失败', true);
            }
            showToast('向量化失败: ' + (vectorizeData.message || '未知错误'));
            return;
        }
        const storedCount = Number(vectorizeData.stored_count || 0);
        if (vectorizeTitle === currentViewingKnowledge) updateVectorProgress(100, 100, `完成 ${storedCount} 块`);

        showToast('已更新到向量库');
        setVectorStatus(`已更新，${storedCount} 块`);
        if (vectorizeTitle === currentViewingKnowledge) {
            stopVectorProgress(`完成 ${storedCount} 块`);
        }
        loadVectorChunks(liveTitle);
    } catch (e) {
        showToast('向量化失败: ' + e.message);
        setVectorStatus('向量化失败');
        if (vectorizeTitle === currentViewingKnowledge) {
            stopVectorProgress('向量化失败', true);
        }
    }
}

async function deleteVectorInSettings() {
    if (!currentViewingKnowledge) {
        showToast('请先选择知识点');
        return;
    }
    const ok = await confirmModalAsync('删除向量数据', '确定删除该知识点在向量库中的所有内容吗？', 'danger');
    if (!ok) return;
    setVectorStatus('删除中...');
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : currentViewingKnowledge;
        const res = await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: liveTitle })
        });
        const data = await res.json();
        if (data.success) {
            showToast('向量已删除');
            setVectorStatus('已删除');
            if (knowledgeMetaCache[liveTitle]) {
                knowledgeMetaCache[liveTitle].vector_exists = false;
                knowledgeMetaCache[liveTitle].vector_updated_at = 0;
            }
            loadVectorChunks(liveTitle);
            loadKnowledge(currentConversationId);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'));
            setVectorStatus('删除失败');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message);
        setVectorStatus('删除失败');
    }
}

async function searchChroma() {
    const input = document.getElementById('chromaSearchInput');
    const results = document.getElementById('chromaSearchResults');
    if (!input || !results) return;
    const query = input.value.trim();
    if (!query) {
        results.style.display = 'block';
        results.textContent = '请输入查询内容';
        return;
    }

    results.style.display = 'block';
    results.textContent = '搜索中...';

    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 5 })
        });
        const data = await res.json();
        if (!data.success) {
            results.textContent = data.message || '搜索失败';
            return;
        }
        const result = data.result || {};
        const docs = result.documents && result.documents[0] ? result.documents[0] : [];
        const metas = result.metadatas && result.metadatas[0] ? result.metadatas[0] : [];
        const dists = result.distances && result.distances[0] ? result.distances[0] : [];
        if (docs.length === 0) {
            results.textContent = '没有结果';
            return;
        }
        const items = docs.map((doc, i) => ({
            doc,
            meta: metas[i],
            dist: dists[i],
            score: dists[i] != null ? (1 - dists[i]) : 0
        })).sort((a, b) => (b.score || 0) - (a.score || 0));

        results.innerHTML = items.map((item) => {
            const doc = item.doc || '';
            const meta = item.meta || {};
            const title = meta.title || 'Untitled';
            const scoreText = item.score != null ? item.score.toFixed(4) : '-';
            const preview = doc.length > 120 ? doc.slice(0, 120) + '...' : doc;
            return `<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0;">
                <div style="font-weight:600;">${title} <span style="color:#64748b; font-size:11px;">(score ${scoreText})</span></div>
                <div style="color:#64748b; font-size:12px;">${preview}</div>
            </div>`;
        }).join('');
    } catch (e) {
        results.textContent = '搜索失败: ' + e.message;
    }
}

async function loadVectorChunks(title) {
    const list = document.getElementById('vectorChunkList');
    if (!list) return;
    if (!title) {
        list.innerHTML = '<div style="color:#94a3b8;"></div>';
        setVectorStatus('请选择知识点');
        return;
    }
    list.innerHTML = '<div style="color:#94a3b8;">加载中...</div>';
    setVectorStatus('加载中...');
    try {
        const res = await fetch('/api/knowledge/vector/chunks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await res.json();
        if (!data.success) {
            list.innerHTML = `<div style="color:#ef4444;">${data.message || '加载失败'}</div>`;
            setVectorStatus('加载失败');
            return;
        }
        const chunks = data.chunks || [];
        if (chunks.length === 0) {
            list.innerHTML = '<div style="color:#94a3b8;">暂无数据</div>';
            setVectorStatus('暂无数据');
            return;
        }
        list.innerHTML = chunks.map(c => {
            const idx = c.chunk_id != null ? c.chunk_id : '-';
            const preview = (c.text || '').slice(0, 80);
            const id = c.id || '';
            const safeId = String(id).replace(/"/g, '&quot;');
            return `<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0; display:flex; gap:8px; align-items:flex-start; justify-content: space-between;">
                <div style="flex:1;">
                    <div style="font-weight:600;">Chunk ${idx}</div>
                    <div style="color:#64748b; font-size:12px; word-break: break-word;">${preview}</div>
                </div>
                <button class="btn-primary" onclick="deleteVectorChunk('${safeId}', '${title.replace("'", "\'")}')" style="background:#ef4444; padding: 4px 8px; font-size: 11px;">删除</button>
            </div>`;
        }).join('');
        setVectorStatus(`已加载 ${chunks.length} 块`);
    } catch (e) {
        list.innerHTML = `<div style="color:#ef4444;">加载失败: ${e.message}</div>`;
        setVectorStatus('加载失败');
    }
}

function setVectorStatus(text) {
    const el = document.getElementById('vectorStatusText');
    if (el) el.textContent = text;
}
function setKnowledgeItemProgress(title, percent, active = true, stage = 'vectorizing') {
    const container = els.panelBasisList;
    if (!container) return;
    const safeTitle = escapeCssSelector(title);
    const item = container.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
    if (!item) return;
    const bar = item.querySelector('.knowledge-progress');
    if (!bar) return;
    bar.classList.remove('vectorizing');
    if (stage === 'vectorizing') bar.classList.add('vectorizing');
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    bar.style.opacity = active ? '1' : '0';
    if (!active) {
        setTimeout(() => {
            bar.style.width = '0%';
        }, 200);
    }
}

function escapeCssSelector(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return String(value || '').replace(/"/g, '\\"');
}

async function createKnowledgeVectorizeTask(title, library = 'knowledge') {
    const res = await fetch('/api/knowledge/vectorize/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, library })
    });
    const data = await res.json();
    if (!res.ok || !data || !data.success || !data.task_id) {
        throw new Error((data && data.message) ? data.message : '创建知识向量化任务失败');
    }
    return String(data.task_id);
}

async function pollServerTask(taskId, onProgress) {
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) throw new Error('任务ID为空');
    const maxRounds = 1200;
    for (let i = 0; i < maxRounds; i++) {
        const res = await fetch(`/api/upload/task/${encodeURIComponent(safeTaskId)}`, {
            method: 'GET',
            cache: 'no-store'
        });
        const data = await res.json();
        if (!res.ok || !data || !data.success || !data.task) {
            throw new Error((data && data.message) ? data.message : '任务查询失败');
        }
        const task = data.task;
        const status = String(task.status || '').toLowerCase();
        const stage = String(task.stage || '').toLowerCase();
        const rawProgress = Number(task.progress || 0);
        const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
        if (typeof onProgress === 'function') onProgress({ status, stage, progress, task });
        if (status === 'completed') return task;
        if (status === 'failed') throw new Error(task.error || task.message || '任务失败');
        if (status === 'cancelled') throw new Error(task.message || '任务已取消');
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error('任务超时');
}

async function bulkVectorizeAllBasis() {
    if (bulkVectorizeRunning) {
        showToast('正在批量向量化，请稍候');
        return;
    }
    bulkVectorizeRunning = true;
    showToast('开始批量向量化');
    let titles = [];
    try {
        const metaRes = await fetch('/api/knowledge/list');
        const metaData = await metaRes.json();
        const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
        const listEls = els.panelBasisList ? Array.from(els.panelBasisList.querySelectorAll('.knowledge-item')) : [];
        titles = listEls.length > 0 ? listEls.map(el => el.dataset.title).filter(Boolean) : Object.keys(basisMeta);
        if (titles.length === 0) {
            showToast('没有可向量化的知识点');
            bulkVectorizeRunning = false;
            return;
        }
        for (const title of titles) {
            const meta = basisMeta[title] || {};
            const updatedAt = Number(meta.updated_at || 0);
            const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
            if (updatedAt > 0 && vectorUpdatedAt >= updatedAt) {
                const chunksRes = await fetch('/api/knowledge/vector/chunks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });
                const chunksData = await chunksRes.json();
                const chunkCount = (chunksData && chunksData.chunks ? chunksData.chunks : []).length;
                if (chunkCount > 0) {
                    setKnowledgeItemVectorState(title, null);
                    continue;
                }
            }
            await vectorizeKnowledgeTitle(title);
        }
    } catch (e) {
        showToast('批量向量化失败: ' + e.message);
    } finally {
        bulkVectorizeRunning = false;
        loadKnowledge(currentConversationId);
    }
}

async function vectorizeKnowledgeTitle(title, options = {}) {
    const silent = !!options.silent;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    if (vectorizeTasks[title] && vectorizeTasks[title].running) {
        return { success: false, message: '该知识点正在向量化' };
    }
    vectorizeTasks[title] = { running: true, runId: Date.now() };
    try {
        setKnowledgeItemVectorState(title, 'uploading');
        setKnowledgeItemProgress(title, 1, true, 'vectorizing');

        const taskId = await createKnowledgeVectorizeTask(title, 'knowledge');
        const task = await pollServerTask(taskId, ({ status, progress, task }) => {
            if (status === 'completed') return;
            // 后端进度为 12-96，前端知识条映射到 1-99
            let pct = 1;
            if (progress <= 12) pct = 1;
            else if (progress >= 96) pct = 99;
            else pct = Math.max(1, Math.min(99, Math.round(((progress - 12) / 84) * 100)));
            setKnowledgeItemProgress(title, pct, true, 'vectorizing');
            if (onProgress) onProgress(pct, String((task && task.message) || '向量化中'));
        });

        const result = (task && task.result) ? task.result : {};
        const storedCount = Number(result.stored_count || 0);

        if (knowledgeMetaCache[title]) {
            const updatedAt = Number(knowledgeMetaCache[title].updated_at || 0);
            knowledgeMetaCache[title].vector_updated_at = Math.max(updatedAt, Date.now());
            knowledgeMetaCache[title].vector_exists = true;
        }
        const list = els.panelBasisList;
        if (list) {
            const safeTitle = escapeCssSelector(title);
            const item = list.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
            if (item) {
                item.classList.remove('needs-vector');
                const vectorBtn = item.querySelector('.knowledge-item-btn.vectorize');
                if (vectorBtn) vectorBtn.remove();
            }
        }
        setKnowledgeItemProgress(title, 100, false, 'vectorizing');
        setKnowledgeItemVectorState(title, null);
        vectorizeTasks[title] = { running: false, runId: Date.now() };
        if (onProgress) onProgress(100, `完成 ${storedCount} 块`);
        if (!silent) showToast(`已更新到向量库 (${storedCount} 块)`);
        return { success: true, stored_count: storedCount };
    } catch (e) {
        setKnowledgeItemProgress(title, 100, false, 'vectorizing');
        setKnowledgeItemVectorState(title, null);
        vectorizeTasks[title] = { running: false, runId: Date.now() };
        if (onProgress) onProgress(100, '向量化失败');
        if (!silent) showToast('向量化失败: ' + (e && e.message ? e.message : '未知错误'));
        return { success: false, message: e && e.message ? e.message : '向量化失败' };
    }
}

let vectorProgressTimer = null;
let vectorizeRunId = 0;
let vectorizeTitle = null;
const vectorizeTasks = {};
function startVectorProgress(total) {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!wrap || !bar || !text) return;
    wrap.style.display = 'block';
    bar.style.width = '0%';
// 说明
    if (vectorProgressTimer) clearInterval(vectorProgressTimer);
    vectorProgressTimer = null;
    updateVectorProgress(0, total || 0);
}

function updateVectorProgress(done, total, message) {
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!bar || !text) return;
    if (!total) {
        bar.style.width = '0%';
        if (message) text.textContent = String(message);
        return;
    }
    const pct = Math.min(100, Math.round((done / total) * 100));
    bar.style.width = `${pct}%`;
    text.textContent = message ? String(message) : `向量化中 ${pct}%`;
}

function stopVectorProgress(message, isError = false) {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!wrap || !bar || !text) return;
    if (vectorProgressTimer) {
        clearInterval(vectorProgressTimer);
        vectorProgressTimer = null;
    }
    bar.style.width = '100%';
    bar.style.background = isError ? '#ef4444' : 'linear-gradient(90deg, #0f172a, #1e293b)';
    text.textContent = message || '完成';
    setTimeout(() => {
        wrap.style.display = 'none';
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #0f172a, #1e293b)';
        text.textContent = '';
    }, 1200);
}

function cancelVectorizeProgress() {
    vectorizeRunId += 1;
    vectorizeTitle = null;
    stopVectorProgress('已取消', true);
}

function resetVectorProgressUI() {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const textEl = document.getElementById('vectorProgressText');
    if (wrap) wrap.style.display = 'none';
    if (bar) {
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #0f172a, #1e293b)';
    }
    if (textEl) textEl.textContent = '';
}

async function deleteVectorChunk(vectorId, title) {
    if (!vectorId) return;
    const ok = await confirmModalAsync('删除向量分块', '确定删除该分块吗？', 'danger');
    if (!ok) return;
    setVectorStatus('删除中...');
    try {
        const res = await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vector_id: vectorId })
        });
        const data = await res.json();
        if (!data.success) {
            showToast('删除失败: ' + (data.message || 'Unknown error'));
            setVectorStatus('删除失败');
        }
        loadVectorChunks(title);
    } catch (e) {
        showToast('删除失败: ' + e.message);
        setVectorStatus('删除失败');
    }
}

function setKnowledgeItemVectorButtonState(item, mode = 'idle') {
    if (!item) return;
    const btn = item.querySelector('.knowledge-item-btn.vectorize');
    if (!btn) return;
    const isLoading = mode === 'loading';
    btn.classList.toggle('is-loading', isLoading);
    btn.disabled = isLoading;
    if (isLoading) {
        btn.title = '向量化中...';
        btn.innerHTML = '<i class="fa-solid fa-spinner"></i>';
    } else {
        btn.title = '需要重新向量化';
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    }
}

function setKnowledgeItemVectorState(title, state) {
    const container = els.panelBasisList;
    if (!container) return;
    const safeTitle = escapeCssSelector(title);
    const item = container.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
    if (!item) return;
    item.classList.remove('vector-pending', 'vector-uploading');
    if (state === 'pending') {
        item.classList.add('vector-pending');
        setKnowledgeItemVectorButtonState(item, 'idle');
        return;
    }
    if (state === 'uploading') {
        item.classList.add('vector-uploading');
        item.classList.add('needs-vector');
        setKnowledgeItemVectorButtonState(item, 'loading');
        return;
    }
    setKnowledgeItemVectorButtonState(item, 'idle');
}

// 设置模态框相关函数
async function openSettingsModal() {
    try {
        const settingsModal = document.getElementById('settingsModal');
        if (!settingsModal) {
            console.error('settingsModal not found in DOM');
            showToast('设置界面未加载');
            return;
        }
        settingsModal.classList.add('active');
        // 确保有用户名
        if (!currentUsername) await checkUserRole();

        // 初始化标签页事件
        initSettingsTabs();

        // 默认切换到个人资料
        switchSettingsTab('profile');
        pendingAvatarDataUrl = '';

        // 加载用户数据
        await loadUserSettings();
    } catch (e) {
        console.error('打开设置模态框失败:', e);
        showToast('加载设置失败');
    }
}

function closeSettingsModal() {
    if (SETTINGS_COMPANION_MODE) {
        try {
            const api = window.pywebview && window.pywebview.api;
            if (api && api.close_settings_window) {
                void api.close_settings_window();
                return;
            }
        } catch (_) {
            // ignore
        }
    }
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.classList.remove('active');
}

function initSettingsTabs() {
    const modal = document.getElementById('settingsModal');
    if (!modal || modal.dataset.settingsTabsInit === '1') return;
    modal.dataset.settingsTabsInit = '1';

    const tabs = modal.querySelectorAll('.admin-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            if (tabName) switchSettingsTab(tabName);
        });
    });
}

function switchSettingsTab(tabName) {
    // 隐藏所有标签页
    document.querySelectorAll('#settingsModal .admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // 取消激活所有按钮
    document.querySelectorAll('#settingsModal .admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    // 显示选中的标签页
    const selectedTab = document.getElementById('settings-' + tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    // 激活选中的按钮
    const selectedBtn = document.querySelector(`#settingsModal .admin-tab[data-tab="${tabName}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');

    if (tabName === 'admin-users') {
        adminUserFilterKeyword = '';
        const filterInput = document.getElementById('adminUserFilterInput');
        if (filterInput) filterInput.value = '';
        loadAdminUsersList();
        loadAdminStats();
    }
    if (tabName === 'admin-mail') {
        adminMailUserFilterKeyword = '';
        const filterInput = document.getElementById('adminMailUserFilterInput');
        if (filterInput) filterInput.value = '';
        loadAdminMailUsersList();
    }
    if (tabName === 'admin-stats') {
        loadAdminStats();
    }
    if (tabName === 'admin-models') {
        loadAdminModelConfig();
    }
    if (tabName === 'admin-chroma') {
        loadAdminChromaStats();
    }
}

async function loadUserSettings() {
    try {
        // 获取用户信息
        const userRes = await fetch('/api/user/info');
        const userData = await userRes.json();

        if (userData.success) {
            const user = userData.user;
            // 填充个人资料
            const usernameInput = document.getElementById('set-username-input');
            if (usernameInput) usernameInput.value = user.username || '';
            const userIdEl = document.getElementById('set-userid');
            if (userIdEl) userIdEl.textContent = `UserID: ${user.id || '-'}`;
            document.getElementById('set-created').textContent =
                user.created_at ? new Date(user.created_at * 1000).toLocaleString() : '2026-02-10（默认）';
            document.getElementById('set-lastlogin').textContent =
                user.last_login ? new Date(user.last_login * 1000).toLocaleString() : new Date().toLocaleString();
            currentUserAvatarUrl = user.avatar_url || '';
            const avatarImg = document.getElementById('settingsAvatarImg');
            if (avatarImg) {
                avatarImg.src = currentUserAvatarUrl || getDefaultAvatarDataUrl(user.username || user.id);
            }
            updateSidebarUserProfile(user.username || user.id, currentUserAvatarUrl);

            // 填充统计信息
            const stats = user.stats || {};
            document.getElementById('set-stat-convs').textContent = stats.total_conversations || 0;
            document.getElementById('set-stat-tokens').textContent = (stats.total_tokens || 0).toLocaleString();
            document.getElementById('set-stat-knowledge').textContent = stats.total_knowledge || 0;

            // 填充模型使用统计
            const modelStatsDiv = document.getElementById('modelUsageStats');
            if (stats.model_usage && Object.keys(stats.model_usage).length > 0) {
                const modelStatsHtml = Object.entries(stats.model_usage)
                    .sort(([, a], [, b]) => b - a)
                    .map(([model, count]) => `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 4px;">
                            <span style="color: #475569; font-weight: 500;">${model}</span>
                            <span style="color: #0f172a; font-weight: 600;">${count} 次调用</span>
                        </div>
                    `)
                    .join('');
                modelStatsDiv.innerHTML = modelStatsHtml;
            } else {
                modelStatsDiv.innerHTML = '<div style="color:#94a3b8;">暂无数据</div>';
            }
        }

        // 获取用户偏好设置
        const prefsRes = await fetch('/api/user/preferences');
        const prefsData = await prefsRes.json();

        if (prefsData.success) {
            const prefs = prefsData.preferences;
            // 填充偏好设置
            document.getElementById('set-defmodel').textContent = prefs.default_model || '自动选择';
            document.getElementById('set-theme').textContent = prefs.theme === 'dark' ? '暗色主题' : '亮色主题';
            document.getElementById('set-stream').textContent = prefs.streaming ? '流式输出 (开启)' : '完整输出 (关闭)';
            document.getElementById('set-lang').textContent = prefs.language === 'zh' ? '简体中文' : 'English';
        }

    } catch (e) {
        console.error('加载用户设置失败:', e);
    }
}

async function saveUserProfile() {
    const usernameInput = document.getElementById('set-username-input');
    const displayName = (usernameInput && usernameInput.value ? usernameInput.value : '').trim();
    if (!displayName) {
        showToast('用户名不能为空');
        return;
    }
    try {
        const res = await fetch('/api/user/profile/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                display_name: displayName,
                avatar_base64: pendingAvatarDataUrl || null
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || '保存失败');
            return;
        }
        pendingAvatarDataUrl = '';
        showToast('资料已保存');
        await loadUserSettings();
        await checkUserRole();
    } catch (e) {
        showToast('保存失败');
    }
}

const avatarCropState = {
    img: null,
    canvas: null,
    ctx: null,
    isDragging: false,
    startX: 0,
    startY: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    baseScale: 1,
    circleX: 0,
    circleY: 0,
    circleR: 0,
    drawWidth: 0,
    drawHeight: 0,
    drawX: 0,
    drawY: 0,
    rafPending: false
};

function openAvatarCropModal(file) {
    const modal = document.getElementById('avatarCropModal');
    const canvas = document.getElementById('avatarCropCanvas');
    const zoomInput = document.getElementById('avatarCropZoom');
    if (!modal || !canvas || !zoomInput) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            avatarCropState.img = img;
            avatarCropState.canvas = canvas;
            avatarCropState.ctx = canvas.getContext('2d');
            avatarCropState.zoom = 1;
            avatarCropState.offsetX = 0;
            avatarCropState.offsetY = 0;
            zoomInput.value = '100';
            const width = Math.max(480, Math.min(880, img.width));
            const height = Math.max(280, Math.min(460, img.height));
            canvas.width = width;
            canvas.height = height;
            avatarCropState.circleX = Math.round(width / 2);
            avatarCropState.circleY = Math.round(height / 2);
            avatarCropState.circleR = Math.round(Math.min(width, height) * 0.32);
            const minCoverScale = Math.max(
                (avatarCropState.circleR * 2) / img.width,
                (avatarCropState.circleR * 2) / img.height
            );
            avatarCropState.baseScale = minCoverScale;
            bindAvatarCropCanvasEvents();
            drawAvatarCropCanvas();
            modal.classList.add('active');
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function closeAvatarCropModal() {
    const modal = document.getElementById('avatarCropModal');
    if (modal) modal.classList.remove('active');
    avatarCropState.isDragging = false;
}

function bindAvatarCropCanvasEvents() {
    const canvas = avatarCropState.canvas;
    const zoomInput = document.getElementById('avatarCropZoom');
    if (!canvas || canvas.dataset.avatarBound === '1') return;
    canvas.dataset.avatarBound = '1';
    canvas.style.touchAction = 'none';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
        return { x, y };
    };

    const queueDraw = () => {
        if (avatarCropState.rafPending) return;
        avatarCropState.rafPending = true;
        requestAnimationFrame(() => {
            avatarCropState.rafPending = false;
            drawAvatarCropCanvas();
        });
    };

    canvas.addEventListener('pointerdown', (e) => {
        const p = getPos(e);
        avatarCropState.isDragging = true;
        avatarCropState.startX = p.x;
        avatarCropState.startY = p.y;
        if (canvas.setPointerCapture) {
            canvas.setPointerCapture(e.pointerId);
        }
        canvas.style.cursor = 'grabbing';
        queueDraw();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!avatarCropState.isDragging) return;
        const p = getPos(e);
        const dx = p.x - avatarCropState.startX;
        const dy = p.y - avatarCropState.startY;
        avatarCropState.offsetX += dx;
        avatarCropState.offsetY += dy;
        avatarCropState.startX = p.x;
        avatarCropState.startY = p.y;
        queueDraw();
    });

    const stopDrag = (e) => {
        if (!avatarCropState.isDragging) return;
        avatarCropState.isDragging = false;
        canvas.style.cursor = 'grab';
        if (canvas.releasePointerCapture && e && typeof e.pointerId === 'number') {
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);

    if (zoomInput) {
        zoomInput.addEventListener('input', (e) => {
            avatarCropState.zoom = Number(e.target.value || 100) / 100;
            queueDraw();
        });
    }
}

function drawAvatarCropCanvas() {
    const { canvas, ctx, img, zoom, baseScale, offsetX, offsetY, circleX, circleY, circleR } = avatarCropState;
    if (!canvas || !ctx || !img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = baseScale * zoom;
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const drawX = (canvas.width - drawWidth) / 2 + offsetX;
    const drawY = (canvas.height - drawHeight) / 2 + offsetY;
    avatarCropState.drawWidth = drawWidth;
    avatarCropState.drawHeight = drawHeight;
    avatarCropState.drawX = drawX;
    avatarCropState.drawY = drawY;

    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(circleX, circleY, circleR + 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
    ctx.stroke();

    drawAvatarPreviewCanvas();
}

function getAvatarCircleSourceRect() {
    const { img, circleX, circleY, circleR, drawX, drawY, drawWidth, drawHeight } = avatarCropState;
    if (!img || !drawWidth || !drawHeight) return null;
    const x = circleX - circleR;
    const y = circleY - circleR;
    const w = circleR * 2;
    const h = circleR * 2;

    const sx = Math.max(0, ((x - drawX) / drawWidth) * img.width);
    const sy = Math.max(0, ((y - drawY) / drawHeight) * img.height);
    const sw = Math.min(img.width - sx, (w / drawWidth) * img.width);
    const sh = Math.min(img.height - sy, (h / drawHeight) * img.height);
    return { sx, sy, sw, sh };
}

function drawAvatarPreviewCanvas() {
    const preview = document.getElementById('avatarPreviewCanvas');
    if (!preview || !avatarCropState.img) return;
    const pctx = preview.getContext('2d');
    const src = getAvatarCircleSourceRect();
    if (!src) return;
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.save();
    pctx.beginPath();
    pctx.arc(preview.width / 2, preview.height / 2, preview.width / 2 - 2, 0, Math.PI * 2);
    pctx.clip();
    pctx.drawImage(
        avatarCropState.img,
        src.sx,
        src.sy,
        src.sw,
        src.sh,
        0,
        0,
        preview.width,
        preview.height
    );
    pctx.restore();
}

function applyAvatarCropAndPreview() {
    const { img } = avatarCropState;
    if (!img) return;
    const src = getAvatarCircleSourceRect();
    if (!src) return;
    const size = 512;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const octx = out.getContext('2d');
    octx.clearRect(0, 0, size, size);
    // UI uses circle for positioning preview, but uploaded avatar keeps normal square image.
    octx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, size, size);
    pendingAvatarDataUrl = out.toDataURL('image/png');
    const avatarImg = document.getElementById('settingsAvatarImg');
    if (avatarImg) avatarImg.src = pendingAvatarDataUrl;
    closeAvatarCropModal();
    showToast('头像已裁切，点击“保存资料”后生效');
}
