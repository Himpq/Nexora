/**
 * chat_render.js — 消息渲染编排
 *
 * 职责：思维块/Reasoning 创建/折叠/追加/插入，Markdown/LaTeX 协调入口；从 chat.js 批量迁移。
 * 调用现有 chat_markdown.js / chat_latex.js 的 window 桥接，不重复实现。
 *
 * 对外 window 桥接清单：
 *   - 无（函数供 chat.js import 调用）
 *
 * 依赖 store 子域：
 *   - store.conversation
 *
 * 设计形态：函数式
 */
import { store } from './store/index.js';
import {
    getNexoraChatTools,
    highlightCode,
    renderMarkdownWithNewTabLinks,
    renderMathSafe,
} from './chat.js?v=20260819_toast_unify_01';
import {
    bindSourceMarkdown,
} from './chat_notes.js?v=20260810_chatjs_split_01';

// --- Helper: Create Thinking Block ---
function toggleThinkingBlockCollapsed(thinkingBlock) {
    if (!thinkingBlock) return;
    thinkingBlock.dataset.userToggled = 'true';
    thinkingBlock.classList.toggle('collapsed');
}

function createThinkingBlock(isCollapsed = false) {
    const block = document.createElement('div');
    block.className = 'thinking-block reasoning-thinking-block execution-flow-item execution-flow-thinking';
    block.dataset.streamLive = '0';
    block.dataset.userToggled = 'false';
    block.dataset.autoCollapsed = isCollapsed ? 'true' : 'false';
    if (isCollapsed) {
        block.classList.add('collapsed');
    }

    const header = document.createElement('div');
    header.className = 'thinking-header execution-flow-header';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-brain thinking-icon';

    const node = document.createElement('span');
    node.className = 'execution-flow-node thinking-flow-node';
    node.appendChild(icon);

    const main = document.createElement('span');
    main.className = 'execution-flow-main';

    const title = document.createElement('span');
    title.className = 'thinking-title execution-flow-title';
    title.textContent = '思考过程';

    const summary = document.createElement('span');
    summary.className = 'thinking-summary execution-flow-summary';
    summary.textContent = '等待内容';

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down chevron-icon';

    const content = document.createElement('div');
    content.className = 'thinking-content';

    main.appendChild(title);
    main.appendChild(summary);
    header.appendChild(node);
    header.appendChild(main);
    header.appendChild(chevron);
    header.addEventListener('click', () => toggleThinkingBlockCollapsed(block));
    block.appendChild(header);
    block.appendChild(content);
    updateThinkingBlockSummary(block, '');
    return block;
}

function clipExecutionFlowText(...args) {
    return getNexoraChatTools().clipExecutionFlowText(...args);
}

function parseExecutionFlowJson(...args) {
    return getNexoraChatTools().parseExecutionFlowJson(...args);
}

function unescapeExecutionFlowJsonFragment(...args) {
    return getNexoraChatTools().unescapeExecutionFlowJsonFragment(...args);
}

function readExecutionFlowJsonStringToken(...args) {
    return getNexoraChatTools().readExecutionFlowJsonStringToken(...args);
}

function parseExecutionFlowPartialJson(...args) {
    return getNexoraChatTools().parseExecutionFlowPartialJson(...args);
}

function basenameForExecutionFlow(...args) {
    return getNexoraChatTools().basenameForExecutionFlow(...args);
}

function hostForExecutionFlow(...args) {
    return getNexoraChatTools().hostForExecutionFlow(...args);
}

function readExecutionFlowArg(...args) {
    return getNexoraChatTools().readExecutionFlowArg(...args);
}

function buildFileToolRunningDisplay(...args) {
    return getNexoraChatTools().buildFileToolRunningDisplay(...args);
}

function getExecutionFlowArgs(...args) {
    return getNexoraChatTools().getExecutionFlowArgs(...args);
}

function getExecutionFlowPhaseText(...args) {
    return getNexoraChatTools().getExecutionFlowPhaseText(...args);
}

function parseExecutionFlowPayload(...args) {
    return getNexoraChatTools().parseExecutionFlowPayload(...args);
}

function unwrapExecutionFlowPayload(...args) {
    return getNexoraChatTools().unwrapExecutionFlowPayload(...args);
}

function normalizeExecutionFlowCount(...args) {
    return getNexoraChatTools().normalizeExecutionFlowCount(...args);
}

function readExecutionFlowMarkdownCount(...args) {
    return getNexoraChatTools().readExecutionFlowMarkdownCount(...args);
}

function readExecutionFlowPayloadPath(...args) {
    return getNexoraChatTools().readExecutionFlowPayloadPath(...args);
}

function readExecutionFlowPayloadCount(...args) {
    return getNexoraChatTools().readExecutionFlowPayloadCount(...args);
}

function readExecutionFlowResultCount(...args) {
    return getNexoraChatTools().readExecutionFlowResultCount(...args);
}

function readExecutionFlowResultText(...args) {
    return getNexoraChatTools().readExecutionFlowResultText(...args);
}

function appendExecutionFlowCount(...args) {
    return getNexoraChatTools().appendExecutionFlowCount(...args);
}

function buildChineseToolAction(...args) {
    return getNexoraChatTools().buildChineseToolAction(...args);
}

function setToolUsagePrimaryText(...args) {
    return getNexoraChatTools().setToolUsagePrimaryText(...args);
}

function updateThinkingBlockSummary(thinkingBlock, sourceText = '') {
    if (!thinkingBlock) return;

    const contentEl = thinkingBlock.querySelector('.thinking-content');
    const summaryEl = thinkingBlock.querySelector('.thinking-summary');
    const raw = String(
        sourceText
        || (contentEl && (contentEl.dataset.rawText || contentEl.dataset.streamRaw || contentEl.textContent))
        || ''
    );
    const charCount = raw.length;
    const isLive = String(thinkingBlock.dataset.streamLive || '') === '1'
        || !!(contentEl && String(contentEl.dataset.streamLive || '') === '1');
    const summary = charCount > 0
        ? `${isLive ? '正在思考' : '已记录'} · ${charCount} 字`
        : '等待内容';

    if (summaryEl) {
        summaryEl.textContent = summary;
    }

    thinkingBlock.classList.toggle('is-live', isLive);
}

function markReasoningThinkingBlockLive(thinkingBlock) {
    if (!thinkingBlock) return;

    const contentEl = thinkingBlock.querySelector('.thinking-content');
    thinkingBlock.dataset.streamLive = '1';

    if (contentEl) {
        contentEl.dataset.streamLive = '1';
    }

    if (thinkingBlock.dataset.userToggled !== 'true') {
        thinkingBlock.classList.remove('collapsed');
        thinkingBlock.dataset.autoCollapsed = 'false';
    }
}

function finishReasoningThinkingBlock(thinkingBlock, sourceText = '') {
    if (!thinkingBlock) return;

    const contentEl = thinkingBlock.querySelector('.thinking-content');
    const raw = String(
        sourceText
        || (contentEl && (
            (typeof contentEl.__sourceMarkdown === 'string')
                ? contentEl.__sourceMarkdown
                : (contentEl.dataset.rawText || contentEl.dataset.streamRaw || contentEl.textContent)
        ))
        || ''
    );

    thinkingBlock.dataset.streamLive = '0';

    if (contentEl) {
        contentEl.dataset.streamLive = '0';
    }

    if (thinkingBlock.dataset.userToggled !== 'true') {
        thinkingBlock.classList.add('collapsed');
        thinkingBlock.dataset.autoCollapsed = 'true';
    }

    updateThinkingBlockSummary(thinkingBlock, raw);
}

function appendReasoningThinkingBlock(container, sourceText, options = {}) {
    if (!container) return null;

    const raw = String(sourceText || '');
    if (!raw) return null;

    const opts = (options && typeof options === 'object') ? options : {};
    const reuseBlock = opts.reuseBlock
        && opts.reuseBlock.isConnected
        && opts.reuseBlock.classList
        && opts.reuseBlock.classList.contains('reasoning-thinking-block')
        ? opts.reuseBlock
        : null;
    const thinkingBlock = reuseBlock || createThinkingBlock(true);
    const thinkingContent = thinkingBlock.querySelector('.thinking-content');
    const existingRaw = reuseBlock ? readReasoningContentRaw(thinkingContent) : '';
    const nextRaw = `${existingRaw}${buildReasoningAppendText(existingRaw, raw, !!reuseBlock)}`;

    // 历史思考过程必须走 Markdown 渲染链路，否则 HTML 会折叠保存下来的换行。
    if (thinkingContent) {
        thinkingContent.dataset.rawText = nextRaw;
        thinkingContent.dataset.streamRaw = nextRaw;
        thinkingContent.dataset.streamLive = '0';
        thinkingContent.innerHTML = renderMarkdownWithNewTabLinks(nextRaw, { breaks: true });
        bindSourceMarkdown(thinkingContent, nextRaw);
    }

    thinkingBlock.dataset.streamLive = '0';

    if (!reuseBlock) {
        container.appendChild(thinkingBlock);
    }

    if (thinkingContent) {
        renderMathSafe(thinkingContent);
        highlightCode(thinkingContent);
    }

    updateThinkingBlockSummary(thinkingBlock, nextRaw);

    return thinkingBlock;
}

function getToolExecutionFlowKind(...args) {
    return getNexoraChatTools().getToolExecutionFlowKind(...args);
}

function applyToolExecutionFlowKind(...args) {
    return getNexoraChatTools().applyToolExecutionFlowKind(...args);
}

function cleanExecutionFlowMarkdownValue(...args) {
    return getNexoraChatTools().cleanExecutionFlowMarkdownValue(...args);
}

function extractMarkdownField(...args) {
    return getNexoraChatTools().extractMarkdownField(...args);
}

function extractMarkdownTitle(...args) {
    return getNexoraChatTools().extractMarkdownTitle(...args);
}

function buildToolResultSummaryFromMarkdown(...args) {
    return getNexoraChatTools().buildToolResultSummaryFromMarkdown(...args);
}

function updateToolUsageResultSummary(...args) {
    return getNexoraChatTools().updateToolUsageResultSummary(...args);
}

function getLatestReasoningThinkingBlock(messageDiv) {
    if (!messageDiv) return null;
    const blocks = messageDiv.querySelectorAll('.thinking-block.reasoning-thinking-block');
    return blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

function getPrimaryReasoningThinkingBlock(messageDiv) {
    if (!messageDiv) return null;
    const blocks = messageDiv.querySelectorAll('.thinking-block.reasoning-thinking-block');
    return blocks.length > 0 ? blocks[0] : null;
}

function readReasoningContentRaw(contentEl) {
    if (!contentEl) return '';

    if (contentEl.dataset && typeof contentEl.dataset.streamRaw === 'string' && contentEl.dataset.streamRaw) {
        return String(contentEl.dataset.streamRaw || '');
    }

    if (contentEl.dataset && typeof contentEl.dataset.rawText === 'string' && contentEl.dataset.rawText) {
        return String(contentEl.dataset.rawText || '');
    }

    if (typeof contentEl.__sourceMarkdown === 'string') {
        return String(contentEl.__sourceMarkdown || '');
    }

    return String(contentEl.textContent || '');
}

function buildReasoningAppendText(existingRaw, nextText, separateSegment = false) {
    const existing = String(existingRaw || '');
    const next = String(nextText || '');

    if (!next) {
        return '';
    }

    if (!separateSegment || !existing) {
        return next;
    }

    if (existing.endsWith('\n') || next.startsWith('\n')) {
        return next;
    }

    return `\n\n${next}`;
}

function hasReasoningThinkingBlockContent(thinkingBlock) {
    if (!thinkingBlock) return false;

    const contentEl = thinkingBlock.querySelector('.thinking-content');
    const raw = readReasoningContentRaw(contentEl);

    return !!String(raw || (contentEl && contentEl.textContent) || '').trim();
}

function insertReasoningThinkingBlock(messageDiv, container, thinkingBlock) {
    if (!thinkingBlock) return;

    const target = container || (messageDiv && messageDiv.querySelector('.message-content')) || messageDiv;

    if (!target) return;

    const timelineSelector = [
        '.thinking-block',
        '.content-body',
        '.tool-usage',
        '.add-basis-view',
        '.question-tool-card',
        '.puzzle-tool-card'
    ].join(',');
    const hasTimelineNode = Array.from(target.children || []).some((child) => {
        return child && child.matches && child.matches(timelineSelector);
    });

    if (hasTimelineNode) {
        target.appendChild(thinkingBlock);
    } else {
        target.prepend(thinkingBlock);
    }
}

function resolveReasoningThinkingBlockForAppend(messageDiv, container) {
    if (!messageDiv) return null;

    getNexoraChatTools().collapseResolvedToolUsages(messageDiv);

    const canReuseActiveSegment = !!messageDiv.__reasoningSegmentOpen;
    let thinkingBlock = canReuseActiveSegment ? messageDiv.__activeReasoningThinkingBlock : null;

    if (thinkingBlock && (!thinkingBlock.isConnected || !thinkingBlock.classList.contains('reasoning-thinking-block'))) {
        thinkingBlock = null;
    }

    if (!thinkingBlock && canReuseActiveSegment) {
        thinkingBlock = getLatestReasoningThinkingBlock(messageDiv);
    }

    if (!thinkingBlock && !canReuseActiveSegment) {
        const latestBlock = getLatestReasoningThinkingBlock(messageDiv);

        if (latestBlock && !hasReasoningThinkingBlockContent(latestBlock)) {
            thinkingBlock = latestBlock;
        }
    }

    if (!thinkingBlock) {
        thinkingBlock = createThinkingBlock(false);
        insertReasoningThinkingBlock(messageDiv, container, thinkingBlock);
    }

    messageDiv.__activeReasoningThinkingBlock = thinkingBlock;
    messageDiv.__reasoningSegmentOpen = true;
    return thinkingBlock;
}

// ─── 命名导出（供 chat.js import） ───
export {
    appendExecutionFlowCount,
    appendReasoningThinkingBlock,
    applyToolExecutionFlowKind,
    basenameForExecutionFlow,
    buildChineseToolAction,
    buildFileToolRunningDisplay,
    buildReasoningAppendText,
    buildToolResultSummaryFromMarkdown,
    cleanExecutionFlowMarkdownValue,
    clipExecutionFlowText,
    createThinkingBlock,
    extractMarkdownField,
    extractMarkdownTitle,
    finishReasoningThinkingBlock,
    getExecutionFlowArgs,
    getExecutionFlowPhaseText,
    getLatestReasoningThinkingBlock,
    getPrimaryReasoningThinkingBlock,
    getToolExecutionFlowKind,
    hasReasoningThinkingBlockContent,
    hostForExecutionFlow,
    insertReasoningThinkingBlock,
    markReasoningThinkingBlockLive,
    normalizeExecutionFlowCount,
    parseExecutionFlowJson,
    parseExecutionFlowPartialJson,
    parseExecutionFlowPayload,
    readExecutionFlowArg,
    readExecutionFlowJsonStringToken,
    readExecutionFlowMarkdownCount,
    readExecutionFlowPayloadCount,
    readExecutionFlowPayloadPath,
    readExecutionFlowResultCount,
    readExecutionFlowResultText,
    readReasoningContentRaw,
    resolveReasoningThinkingBlockForAppend,
    setToolUsagePrimaryText,
    toggleThinkingBlockCollapsed,
    unescapeExecutionFlowJsonFragment,
    unwrapExecutionFlowPayload,
    updateThinkingBlockSummary,
    updateToolUsageResultSummary,
};
