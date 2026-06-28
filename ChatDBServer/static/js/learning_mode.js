(function () {
    let sharedWelcomeIframe = null;
    let sharedMainIframe = null;
    let sidebarUnmount = null;
    let sidebarReaderOpened = false;
    let sidebarContainerRef = null;
    let sidebarOptionsRef = {};
    const sidebarFoldState = new Map();
    let currentFrontendUrl = '';
    let currentRuntimeUsername = '';
    let activePuzzleFullscreen = null;
    const puzzleSubmissionRegistryKey = 'nexora_learning_puzzle_registry_v1';

    // ---- Chat bridge (registered by chat.js) ----
    let chatBridge = null;
    function registerChatBridge(bridge) {
        chatBridge = bridge && typeof bridge === 'object' ? bridge : null;
        if (chatBridge) {
            setLearningRuntimeUsername(chatBridge.username);
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function hashText(value) {
        const text = String(value || '');
        let h = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            h ^= text.charCodeAt(i);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return String(h >>> 0);
    }

    function setLearningRuntimeUsername(username) {
        const normalized = String(username || '').trim();

        if (normalized) {
            currentRuntimeUsername = normalized;
        }

        return currentRuntimeUsername;
    }

    function buildLearningFrontendUrl(frontendUrl, username) {
        const raw = String(frontendUrl || '').trim();
        const runtimeUsername = setLearningRuntimeUsername(username);

        if (!raw) return '';

        const url = new URL(raw, window.location.href);

        if (runtimeUsername) {
            url.searchParams.set('username', runtimeUsername);
        }

        return url.toString();
    }

    function buildStablePuzzleCardId(payload, fallbackPrefix = 'puzzle') {
        const raw = payload && typeof payload === 'object' ? payload : {};
        const explicitId = String(raw.puzzle_id || '').trim();
        if (explicitId) return explicitId;
        const title = String(raw.title || '').trim();
        const steps = Array.isArray(raw.steps)
            ? raw.steps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const fingerprint = `${title}::${steps.join('||')}`;
        return `${fallbackPrefix}_${hashText(fingerprint)}`;
    }

    function readPuzzleSubmissionRegistry() {
        try {
            const raw = window.localStorage.getItem(puzzleSubmissionRegistryKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writePuzzleSubmissionRegistry(registry) {
        try {
            window.localStorage.setItem(puzzleSubmissionRegistryKey, JSON.stringify(registry && typeof registry === 'object' ? registry : {}));
        } catch (err) {
            try {
                console.warn('[LearningMode] puzzle registry write failed', {
                    key: puzzleSubmissionRegistryKey,
                    message: err && err.message ? String(err.message) : String(err || '')
                });
            } catch (_) {}
        }
    }

    function getStoredPuzzleSubmissionRecord(puzzleId) {
        const pid = String(puzzleId || '').trim();
        if (!pid) return null;
        const registry = readPuzzleSubmissionRegistry();
        const record = registry[pid];
        return record && typeof record === 'object' ? record : null;
    }

    function setStoredPuzzleSubmissionRecord(puzzleId, record) {
        const pid = String(puzzleId || '').trim();
        if (!pid) return;
        const registry = readPuzzleSubmissionRegistry();
        registry[pid] = record && typeof record === 'object' ? record : {};
        writePuzzleSubmissionRegistry(registry);
    }

    // ---- Server-side puzzle state persistence ----
    const _puzzleSaveTimers = {};

    async function fetchPuzzleStatesFromServer(convId) {
        const cid = String(convId || '').trim();
        if (!cid) return {};
        try {
            const res = await fetch(`/api/conversations/${cid}/puzzle-states`);
            const data = await res.json();
            return (data && data.success && data.puzzle_states && typeof data.puzzle_states === 'object')
                ? data.puzzle_states : {};
        } catch (_) { return {}; }
    }

    function savePuzzleStateToServer(convId, puzzleId, state, immediate = false) {
        const cid = String(convId || '').trim();
        const pid = String(puzzleId || '').trim();
        if (!cid || !pid || !state || typeof state !== 'object') return;
        const key = `${cid}::${pid}`;
        if (!immediate) {
            if (_puzzleSaveTimers[key]) clearTimeout(_puzzleSaveTimers[key]);
            _puzzleSaveTimers[key] = setTimeout(() => {
                delete _puzzleSaveTimers[key];
                _doSavePuzzleState(cid, pid, state);
            }, 300);
            return;
        }
        if (_puzzleSaveTimers[key]) { clearTimeout(_puzzleSaveTimers[key]); delete _puzzleSaveTimers[key]; }
        _doSavePuzzleState(cid, pid, state);
    }

    function _doSavePuzzleState(convId, puzzleId, state) {
        fetch(`/api/conversations/${convId}/puzzle-states`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ puzzle_id: puzzleId, state }),
        }).catch(() => {});
    }

    function handlePuzzleStateUpdateFromIframe(event) {
        const data = event && event.data;
        if (!data || typeof data !== 'object') return false;
        if (String(data.type || '').trim() !== 'nexora:puzzle:state-update') return false;
        const pid = String(data.puzzle_id || '').trim();
        const snap = data.state;
        if (!pid || !snap || typeof snap !== 'object') return true;
        const convId = (typeof currentConversationId !== 'undefined') ? currentConversationId : null;
        if (convId) {
            savePuzzleStateToServer(convId, pid, snap, false);
        }
        return true;
    }

    function resolveLearningPuzzleUrl(frontendUrl, username) {
        const base = String(frontendUrl || currentFrontendUrl || '').trim();
        const runtimeUsername = setLearningRuntimeUsername(username);

        if (!base) return '/api/frontend/puzzle';

        const url = new URL(base, window.location.href);
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/puzzle`;

        if (runtimeUsername) {
            url.searchParams.set('username', runtimeUsername);
        }

        return url.toString();
    }

    function syncPuzzleCardLockState(card) {
        if (!card) return;
        const iframe = card.querySelector('.puzzle-card-iframe');
        if (!iframe || !iframe.contentWindow) return;
        const puzzleId = String((card.dataset && card.dataset.puzzleId) || '').trim();
        const resolved = String(card.dataset.resolved || '').trim().toLowerCase() === 'true';
        if (!resolved) {
            try {
                iframe.contentWindow.postMessage({ type: 'nexora:puzzle:unlock' }, '*');
            } catch (_) {}
            try {
                console.log('[LearningMode] syncPuzzleCardLockState unlock', { puzzleId });
            } catch (_) {}
            return;
        }
        let submission = null;
        const rawSubmission = String(card.dataset.puzzleSubmission || '').trim();
        if (rawSubmission) {
            try {
                submission = JSON.parse(rawSubmission);
            } catch (_) {
                submission = null;
            }
        }
        try {
            iframe.contentWindow.postMessage(
                {
                    type: 'nexora:puzzle:lock',
                    ordered_steps: Array.isArray(submission && submission.ordered_steps) ? submission.ordered_steps : [],
                    submission: submission && typeof submission === 'object' ? submission : null,
                },
                '*'
            );
        } catch (_) {}
        try {
            console.log('[LearningMode] syncPuzzleCardLockState lock', { puzzleId });
        } catch (_) {}
    }

    function createPuzzleCardNode(puzzle, options = {}) {
        const payload = (puzzle && typeof puzzle === 'object') ? puzzle : {};
        const wrap = document.createElement('div');
        wrap.className = 'puzzle-tool-card';
        wrap.dataset.toolName = 'puzzle';
        const payloadResolved = !!(payload.resolved || (Array.isArray(payload.ordered_steps) && payload.ordered_steps.length > 0));
        wrap.dataset.pending = payloadResolved ? 'false' : 'true';
        wrap.dataset.resolved = payloadResolved ? 'true' : 'false';
        const title = escapeHtml(String(payload.title || '拼接式解题').trim());
        const steps = Array.isArray(payload.steps)
            ? payload.steps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const cardId = String(options.cardId || buildStablePuzzleCardId(payload));
        wrap.dataset.puzzleId = cardId;
        const storedRecord = getStoredPuzzleSubmissionRecord(cardId);
        const shouldUseStoredResolved = !!(storedRecord && storedRecord.submission && typeof storedRecord.submission === 'object');
        try {
            console.log('[LearningMode] createPuzzleCardNode', {
                cardId,
                payloadHasId: !!String(payload.puzzle_id || '').trim(),
                payloadResolved,
                shouldUseStoredResolved
            });
        } catch (_) {}
        if (payloadResolved || shouldUseStoredResolved) {
            const sourceOrdered = shouldUseStoredResolved
                ? (Array.isArray(storedRecord.ordered_steps) ? storedRecord.ordered_steps : [])
                : (Array.isArray(payload.ordered_steps) ? payload.ordered_steps : []);
            const sourceSubmission = shouldUseStoredResolved
                ? storedRecord.submission
                : (payload.submission && typeof payload.submission === 'object' ? payload.submission : null);
            const submissionPayload = normalizePuzzleSubmissionPayload(sourceOrdered, sourceSubmission);
            wrap.dataset.pending = 'false';
            wrap.dataset.resolved = 'true';
            try {
                wrap.dataset.puzzleSubmission = JSON.stringify(submissionPayload);
            } catch (_) {
                wrap.dataset.puzzleSubmission = '';
            }
        }
        wrap.innerHTML = `
            <div class="puzzle-card-body puzzle-card-body-plain" data-puzzle-card-id="${cardId}">
                <button type="button" class="puzzle-card-fullscreen-btn" aria-label="展开拼图" title="展开拼图">
                    <i class="fa-solid fa-expand"></i>
                </button>
                <div class="puzzle-card-stage">
                    <iframe class="puzzle-card-iframe" title="${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
                </div>
            </div>
        `;
        const iframe = wrap.querySelector('.puzzle-card-iframe');
        if (iframe) {
            iframe.src = resolveLearningPuzzleUrl(options.frontendUrl, options.username || (chatBridge && chatBridge.username));
            iframe.addEventListener('load', () => {
                try {
                    const initPayload = {
                        type: 'nexora:puzzle:init',
                        puzzle_id: cardId,
                        title: String(payload.title || '拼接式解题').trim(),
                        steps: steps.slice(),
                    };
                    iframe.contentWindow.postMessage(initPayload, '*');
                    // 发送服务端保存的画布状态（如有）
                    const serverState = options.serverState;
                    if (serverState && typeof serverState === 'object') {
                        iframe.contentWindow.postMessage({ type: 'nexora:puzzle:restore', state: serverState }, '*');
                    }
                    syncPuzzleCardLockState(wrap);
                } catch (_) {}
            });
        }
        return wrap;
    }

    function getPuzzleMainContentHost() {
        return document.querySelector('.main-content');
    }

    function ensurePuzzleFullscreenLayer(host) {
        if (!host) return null;
        let layer = host.querySelector('#learningPuzzleFullscreenLayer');
        if (layer) return layer;
        layer = document.createElement('div');
        layer.id = 'learningPuzzleFullscreenLayer';
        layer.className = 'learning-puzzle-fullscreen-layer';
        host.appendChild(layer);
        return layer;
    }

    function syncPuzzleFullscreenButton(card, fullscreen) {
        if (!card) return;
        const btn = card.querySelector('.puzzle-card-fullscreen-btn');
        if (!btn) return;
        btn.setAttribute('aria-label', fullscreen ? '退出全屏' : '展开拼图');
        btn.title = fullscreen ? '退出全屏' : '展开拼图';
        btn.innerHTML = fullscreen
            ? '<i class="fa-solid fa-compress"></i>'
            : '<i class="fa-solid fa-expand"></i>';
    }

    function exitPuzzleFullscreen() {
        const state = activePuzzleFullscreen;
        if (!state) return false;
        const card = state.card;
        const host = state.host;
        const layer = state.layer;
        if (card && card.classList) {
            card.classList.remove('is-puzzle-fullscreen');
            syncPuzzleFullscreenButton(card, false);
        }
        const placeholder = state.placeholder;
        if (placeholder && placeholder.parentNode && card) {
            placeholder.parentNode.insertBefore(card, placeholder);
            placeholder.parentNode.removeChild(placeholder);
        } else if (card && state.fallbackParent && state.fallbackParent.appendChild) {
            state.fallbackParent.appendChild(card);
        }
        if (layer) {
            layer.classList.remove('active');
            const extraNodes = Array.from(layer.childNodes || []).filter((node) => node !== card);
            extraNodes.forEach((node) => {
                try { layer.removeChild(node); } catch (_) {}
            });
        }
        if (host) {
            host.classList.remove('learning-puzzle-fullscreen-host');
        }
        activePuzzleFullscreen = null;
        return true;
    }

    function enterPuzzleFullscreen(card) {
        if (!card) return false;
        const host = getPuzzleMainContentHost();
        if (!host) return false;
        if (activePuzzleFullscreen && activePuzzleFullscreen.card === card) {
            return true;
        }
        if (activePuzzleFullscreen) {
            exitPuzzleFullscreen();
        }
        const parent = card.parentNode;
        const placeholder = document.createComment('learning-puzzle-fullscreen-placeholder');
        if (parent) {
            parent.insertBefore(placeholder, card);
        }
        const layer = ensurePuzzleFullscreenLayer(host);
        if (!layer) return false;
        host.classList.add('learning-puzzle-fullscreen-host');
        layer.classList.add('active');
        layer.innerHTML = '';
        card.classList.add('is-puzzle-fullscreen');
        syncPuzzleFullscreenButton(card, true);
        layer.appendChild(card);
        activePuzzleFullscreen = {
            card,
            host,
            layer,
            placeholder,
            fallbackParent: parent || null,
        };
        setTimeout(() => {
            syncPuzzleCardLockState(card);
        }, 80);
        return true;
    }

    function togglePuzzleFullscreen(card) {
        if (!card) return;
        if (activePuzzleFullscreen && activePuzzleFullscreen.card === card) {
            exitPuzzleFullscreen();
            setTimeout(() => {
                syncPuzzleCardLockState(card);
            }, 80);
            return;
        }
        enterPuzzleFullscreen(card);
    }

    function bindPuzzleFullscreenEvents() {
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const btn = target.closest('.puzzle-card-fullscreen-btn');
            if (btn) {
                event.preventDefault();
                event.stopPropagation();
                const card = btn.closest('.puzzle-tool-card');
                if (card) {
                    togglePuzzleFullscreen(card);
                }
                return;
            }
            if (!activePuzzleFullscreen) return;
            const autoExitTrigger = target.closest('.conversation-item, #newChatBtn, #sidebarBrandNexoraTab, #sidebarBrandLearningTab');
            if (autoExitTrigger) {
                exitPuzzleFullscreen();
            }
        }, true);
        document.addEventListener('keydown', (event) => {
            if (!activePuzzleFullscreen) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                exitPuzzleFullscreen();
            }
        });
    }

    function findPuzzleCardBySourceWindow(sourceWindow, root) {
        if (!sourceWindow) return null;
        const scope = root && root.querySelectorAll ? root : document;
        const frames = Array.from(scope.querySelectorAll('.puzzle-card-iframe'));
        for (const frame of frames) {
            if (!(frame instanceof HTMLIFrameElement)) continue;
            if (frame.contentWindow === sourceWindow) {
                const card = frame.closest('.puzzle-tool-card');
                if (card) return card;
            }
        }
        return null;
    }

    function normalizePuzzleSubmissionPayload(orderedSteps, submission) {
        const rows = Array.isArray(orderedSteps)
            ? orderedSteps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const graph = submission && typeof submission === 'object' && submission.graph && typeof submission.graph === 'object'
            ? submission.graph
            : {};
        const connections = Array.isArray(graph.connections)
            ? graph.connections.map((conn) => ({
                from_text: String(conn && conn.from_text || '').trim(),
                to_text: String(conn && conn.to_text || '').trim(),
            })).filter((conn) => conn.from_text && conn.to_text).slice(0, 64)
            : [];
        return {
            type: 'puzzle_submission',
            ordered_steps: rows,
            graph: {
                node_count: Number(graph.node_count || 0),
                edge_count: Number(graph.edge_count || 0),
                branch_count: Number(graph.branch_count || 0),
                has_cycle: !!graph.has_cycle,
                component_count: Number(graph.component_count || 0),
                connections,
            }
        };
    }

    function buildPuzzleSubmissionInjectionText(orderedSteps, submission) {
        const compact = normalizePuzzleSubmissionPayload(orderedSteps, submission);
        const lines = ['[Puzzle Submission]'];
        const steps = Array.isArray(compact.ordered_steps) ? compact.ordered_steps : [];
        const graph = compact.graph && typeof compact.graph === 'object' ? compact.graph : {};
        if (steps.length) lines.push(`MainSteps: ${steps.join(' -> ')}`);
        lines.push(
            `Graph: n=${Number(graph.node_count || 0)}, e=${Number(graph.edge_count || 0)}, b=${Number(graph.branch_count || 0)}, cyc=${graph.has_cycle ? '1' : '0'}, c=${Number(graph.component_count || 0)}`
        );
        const connections = Array.isArray(graph.connections) ? graph.connections : [];
        if (connections.length) {
            const edgeLines = [];
            connections.slice(0, 40).forEach((conn) => {
                const from = String(conn && conn.from_text || '').trim();
                const to = String(conn && conn.to_text || '').trim();
                if (!from || !to) return;
                edgeLines.push(`${from} -> ${to}`);
            });
            if (edgeLines.length) {
                lines.push(`Edges: ${edgeLines.join(' | ')}`);
            }
            if (connections.length > 40) {
                lines.push(`MoreEdges: ${connections.length - 40}`);
            }
        }
        lines.push('');
        lines.push('以上是用户提交的拼图结果，请评价其正确性并给出反馈，不要再次输出拼图工具。');
        return lines.join('\n');
    }

    function summarizePuzzleSubmission(orderedSteps, submission) {
        const rows = Array.isArray(orderedSteps)
            ? orderedSteps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const graph = submission && typeof submission === 'object' && submission.graph && typeof submission.graph === 'object'
            ? submission.graph
            : {};
        const edgeCount = Number(graph.edge_count || 0);
        return `已提交拼图结果（${rows.length}步 / ${edgeCount}连线）`;
    }

    function resolveStoredPuzzleSubmissionById(puzzleId) {
        const record = getStoredPuzzleSubmissionRecord(String(puzzleId || '').trim());
        if (!record || typeof record !== 'object') return null;
        const ordered = Array.isArray(record.ordered_steps) ? record.ordered_steps.map((item) => String(item || '').trim()).filter(Boolean) : [];
        const submission = record.submission && typeof record.submission === 'object' ? record.submission : null;
        if (!ordered.length && !submission) return null;
        return {
            ordered_steps: ordered,
            submission,
            submitted_at: Number(record.submitted_at || 0),
        };
    }

    function markPuzzleCardSubmitted(card, orderedSteps, submission) {
        if (!card) return;
        const rows = Array.isArray(orderedSteps)
            ? orderedSteps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        card.dataset.pending = 'false';
        card.dataset.resolved = 'true';
        const submissionPayload = normalizePuzzleSubmissionPayload(rows, submission);
        const puzzleId = String((card.dataset && card.dataset.puzzleId) || '').trim();
        if (puzzleId) {
            setStoredPuzzleSubmissionRecord(puzzleId, {
                ordered_steps: rows,
                submission: submissionPayload,
                submitted_at: Date.now(),
            });
        }
        try {
            card.dataset.puzzleSubmission = JSON.stringify(submissionPayload);
        } catch (_) {
            card.dataset.puzzleSubmission = '';
        }
        card.classList.add('is-submitted');
        const body = card.querySelector('.puzzle-card-body');
        if (body) {
            body.classList.add('answered');
        }
        const iframe = card.querySelector('.puzzle-card-iframe');
        if (iframe) syncPuzzleCardLockState(card);
        // 提交时立即保存到服务端（锁定状态）
        const convId = (typeof currentConversationId !== 'undefined') ? currentConversationId : null;
        if (convId && puzzleId) {
            savePuzzleStateToServer(convId, puzzleId, {
                locked: true,
                submission: submissionPayload,
                submitted_at: Date.now(),
            }, true);
        }
    }

    function handlePuzzleFramePayload(event) {
        const data = event && event.data;
        if (!data || typeof data !== 'object') return false;
        if (String(data.type || '').trim() !== 'nexora:puzzle:submit') return false;
        const orderedSteps = Array.isArray(data.ordered_steps)
            ? data.ordered_steps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const submission = (data.submission && typeof data.submission === 'object') ? data.submission : null;
        try {
            console.log('[LearningMode] puzzle submit payload', {
                steps: orderedSteps.length,
                sourceWindow: !!(event && event.source),
                hasSubmission: !!submission
            });
        } catch (_) {}
        window.dispatchEvent(new CustomEvent('nexora:learning-puzzle-submit', {
            detail: {
                sourceWindow: event.source,
                puzzle_id: String(data.puzzle_id || '').trim(),
                orderedSteps,
                submission,
            }
        }));
        return true;
    }

    function ensureSharedIframe(kind, frontendUrl) {
        const useMain = kind === 'main';
        let frame = useMain ? sharedMainIframe : sharedWelcomeIframe;
        const nextSrc = String(frontendUrl || '').trim();
        if (frame && frame.isConnected) {
            if (nextSrc && frame.src !== nextSrc) {
                frame.src = nextSrc;
            }
            return frame;
        }
        frame = document.createElement('iframe');
        frame.className = 'learning-mode-frame';
        frame.src = nextSrc;
        frame.title = 'NexoraLearning';
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        if (useMain) {
            sharedMainIframe = frame;
        } else {
            sharedWelcomeIframe = frame;
        }
        return frame;
    }

    function getSharedMainWindow() {
        try {
            return sharedMainIframe && sharedMainIframe.contentWindow ? sharedMainIframe.contentWindow : null;
        } catch (_) {
            return null;
        }
    }

    function postToSharedMainFrame(payload) {
        const win = getSharedMainWindow();
        const data = payload && typeof payload === 'object' ? payload : {};
        const type = String(data.type || '').trim();

        if (!win) {
            console.error('[LearningMode] main iframe is not ready for host command', { type });
            return false;
        }

        const frontendUrl = String(currentFrontendUrl || '').trim();
        const origin = (() => {
            try { return frontendUrl ? new URL(frontendUrl).origin : '*'; } catch (_) { return '*'; }
        })();

        try {
            win.postMessage(data, origin === '*' ? '*' : origin);
            return true;
        } catch (err) {
            console.error('[LearningMode] post host command failed', {
                type,
                message: err && err.message ? String(err.message) : String(err || '')
            });
            return false;
        }
    }

    function closeReaderFromHost(options = {}) {
        const source = options && typeof options === 'object' ? options : {};
        const closeReason = String(source.closeReason || source.reason || 'host_reader_close').trim();
        const closeTarget = String(source.closeTarget || source.targetSidebarMode || source.target || '').trim();

        return postToSharedMainFrame({
            source: 'nexora-host',
            type: 'nexora:reader:close',
            close_reason: closeReason,
            close_target: closeTarget,
        });
    }

    function renderWelcome(container, options = {}) {
        if (!container) return;
        const frontendUrl = buildLearningFrontendUrl(options.frontendUrl, options.username);
        container.classList.add('learning-mode-welcome-shell');
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        wrap.appendChild(ensureSharedIframe('welcome', frontendUrl));
    }

    function renderMainPanel(container, options = {}) {
        if (!container) return;
        const frontendUrl = buildLearningFrontendUrl(options.frontendUrl, options.username);
        currentFrontendUrl = frontendUrl;
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        const frame = ensureSharedIframe('main', frontendUrl);
        if (frame && frame.dataset.hostPointerRelayBound !== '1') {
            frame.dataset.hostPointerRelayBound = '1';
            frame.addEventListener('pointerdown', () => {
                window.dispatchEvent(new CustomEvent('nexora:learning-frame-pointerdown'));
            }, true);
        }
        wrap.appendChild(frame);
    }

    function renderSidebarMarkdown(target, role, text) {
        if (!target) return;
        const normalizedRole = String(role || '').trim().toLowerCase();
        const raw = String(text || '');
        const canMarkdown = (
            normalizedRole === 'assistant'
            && typeof window.renderMarkdownWithNewTabLinks === 'function'
        );
        if (!canMarkdown) {
            target.textContent = raw;
            return;
        }
        target.innerHTML = window.renderMarkdownWithNewTabLinks(raw);
        try {
            if (typeof window.bindSourceMarkdown === 'function') {
                window.bindSourceMarkdown(target, raw);
            }
        } catch (_) {}
        try {
            if (typeof window.renderMathSafe === 'function') {
                window.renderMathSafe(target, { force: true });
            }
        } catch (_) {}
    }

    function renderSidebarQuestionPart(target, part, bridge) {
        if (!target) return;
        const item = (part && typeof part === 'object') ? part : {};
        const question = (item.question && typeof item.question === 'object') ? item.question : {};
        const questionId = String(question.question_id || '').trim();
        const questionCardId = String(question.question_card_id || questionId || '').trim();
        const title = String(question.question_title || 'Question').trim();
        const content = String(question.question_content || '').trim();
        const choices = Array.isArray(question.choices) ? question.choices : [];
        const allowOther = question.allow_other !== false;
        const resolved = !!question.resolved;
        const answer = String(question.answer || '').trim();

        const card = document.createElement('div');
        card.className = `learning-sidebar-question-card${resolved ? ' is-answered' : ''}`;

        const top = document.createElement('div');
        top.className = 'learning-sidebar-question-top';
        const kicker = document.createElement('span');
        kicker.className = 'learning-sidebar-question-kicker';
        kicker.textContent = 'QUESTION';
        const pill = document.createElement('span');
        pill.className = 'learning-sidebar-question-pill';
        pill.textContent = resolved ? '已回答' : '待回答';
        top.appendChild(kicker);
        top.appendChild(pill);
        card.appendChild(top);

        const titleEl = document.createElement('div');
        titleEl.className = 'learning-sidebar-question-title';
        titleEl.textContent = title;
        card.appendChild(titleEl);

        const contentEl = document.createElement('div');
        contentEl.className = 'learning-sidebar-question-content';
        contentEl.textContent = content;
        card.appendChild(contentEl);

        const submitAnswer = async (rawAnswer) => {
            const finalAnswer = String(rawAnswer || '').trim();
            if (!finalAnswer || resolved) return;
            if (bridge && typeof bridge.submitQuestionAnswer === 'function') {
                await bridge.submitQuestionAnswer(finalAnswer, questionCardId);
                return;
            }
            if (bridge && typeof bridge.send === 'function') {
                await bridge.send(finalAnswer);
            }
        };

        if (choices.length) {
            const choiceWrap = document.createElement('div');
            choiceWrap.className = 'learning-sidebar-question-choices';
            choices.forEach((choice) => {
                const safeChoice = String(choice || '').trim();
                if (!safeChoice) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'learning-sidebar-question-choice';
                btn.textContent = safeChoice;
                btn.disabled = resolved;
                btn.addEventListener('click', async () => {
                    await submitAnswer(safeChoice);
                });
                choiceWrap.appendChild(btn);
            });
            card.appendChild(choiceWrap);
        }

        if (allowOther) {
            const otherWrap = document.createElement('div');
            otherWrap.className = 'learning-sidebar-question-other';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'learning-sidebar-question-input';
            input.placeholder = '其他答案';
            input.disabled = resolved;
            const submit = document.createElement('button');
            submit.type = 'button';
            submit.className = 'learning-sidebar-question-submit';
            submit.textContent = '提交';
            submit.disabled = resolved;
            submit.addEventListener('click', async () => {
                await submitAnswer(input.value || '');
            });
            input.addEventListener('keydown', async (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    await submitAnswer(input.value || '');
                }
            });
            otherWrap.appendChild(input);
            otherWrap.appendChild(submit);
            card.appendChild(otherWrap);
        }

        if (resolved && answer) {
            const answerEl = document.createElement('div');
            answerEl.className = 'learning-sidebar-question-answer';
            answerEl.textContent = `你的回答：${answer}`;
            card.appendChild(answerEl);
        }

        target.innerHTML = '';
        target.appendChild(card);
    }

    function renderSidebarToolPart(target, part) {
        if (!target) return;
        const item = (part && typeof part === 'object') ? part : {};
        const title = String(item.title || '工具调用').trim();
        const status = String(item.status || '').trim();
        const content = String(item.content || '').trim();
        const phase = String(item.phase || '').trim().toLowerCase();
        const pending = !!item.pending;

        const card = document.createElement('div');
        card.className = 'learning-sidebar-tool-card';

        const meta = document.createElement('div');
        meta.className = 'learning-sidebar-tool-meta';

        const nameEl = document.createElement('span');
        nameEl.className = 'learning-sidebar-tool-name';
        nameEl.textContent = title || '工具调用';
        meta.appendChild(nameEl);

        const badgeText = status || (phase === 'build'
            ? '参数构建中'
            : (phase === 'exec' ? (pending ? '执行中' : '执行完成') : ''));
        if (badgeText) {
            const statusEl = document.createElement('span');
            statusEl.className = `learning-sidebar-tool-status${pending ? ' is-pending' : ''}`;
            statusEl.textContent = badgeText;
            meta.appendChild(statusEl);
        }

        card.appendChild(meta);

        if (content) {
            const out = document.createElement('pre');
            out.className = 'learning-sidebar-tool-output';
            out.textContent = content;
            card.appendChild(out);
        }

        target.innerHTML = '';
        target.appendChild(card);
    }

    function renderSidebarPartBody(target, role, part, bridge) {
        if (!target) return;
        const item = (part && typeof part === 'object') ? part : {};
        const format = String(item.format || '').trim().toLowerCase();
        const text = String(item.content || '');
        if (format === 'question') {
            renderSidebarQuestionPart(target, item, bridge);
            return;
        }
        if (format === 'tool') {
            renderSidebarToolPart(target, item);
            return;
        }
        if (format === 'markdown') {
            renderSidebarMarkdown(target, role, text);
            return;
        }
        target.textContent = text;
    }

    function buildSidebarFoldKey(messageIndex, partIndex, part) {
        const item = (part && typeof part === 'object') ? part : {};
        const kind = String(item.kind || 'content').trim().toLowerCase();
        const callId = String(item.call_id || '').trim();
        const toolIndex = String(item.tool_index || '').trim();
        const title = String(item.title || '').trim();
        const status = String(item.status || '').trim();
        const content = String(item.content || '').trim();
        if (kind === 'tool' && (callId || toolIndex || title)) {
            return ['tool', callId, toolIndex, title, String(item.phase || '').trim()].join('::');
        }
        return [messageIndex, partIndex, kind, callId, toolIndex, title, status, content.slice(0, 160)].join('::');
    }

    function createFoldablePart(role, part, messageIndex, partIndex, bridge) {
        const kind = String(part && part.kind ? part.kind : 'content').trim().toLowerCase();
        const block = document.createElement('div');
        block.className = `learning-sidebar-part is-${escapeHtml(kind || 'content')}`;

        const body = document.createElement('div');
        body.className = `learning-sidebar-chat-text is-${escapeHtml(kind || 'content')}`;
        renderSidebarPartBody(body, role, part, bridge);

        if (kind === 'thinking' || kind === 'tool') {
            const foldKey = buildSidebarFoldKey(messageIndex, partIndex, part);
            const details = document.createElement('details');
            details.className = `learning-sidebar-fold learning-sidebar-fold-${kind}`;
            const pending = !!(part && part.pending);
            const shouldAutoOpen = pending;
            if (sidebarFoldState.has(foldKey)) {
                details.open = sidebarFoldState.get(foldKey) === true;
            } else {
                details.open = shouldAutoOpen;
            }
            details.dataset.foldKey = foldKey;
            details.addEventListener('toggle', () => {
                sidebarFoldState.set(foldKey, !!details.open);
            });

            const summary = document.createElement('summary');
            summary.className = 'learning-sidebar-part-label';
            summary.innerHTML = kind === 'thinking'
                ? '<span class="learning-sidebar-part-label-text">思考过程</span><span class="learning-sidebar-part-label-chevron">▾</span>'
                : `<span class="learning-sidebar-part-label-text">${escapeHtml(String(part && part.title ? part.title : '工具调用'))}</span><span class="learning-sidebar-part-label-chevron">▾</span>`;

            const content = document.createElement('div');
            content.className = 'learning-sidebar-part-content';
            content.appendChild(body);

            details.appendChild(summary);
            details.appendChild(content);
            block.appendChild(details);
            return block;
        }

        block.appendChild(body);
        return block;
    }

    function renderSidebarChat(container) {
        const bridge = window.NexoraLearningSidebarBridge;
        if (!bridge) {
            container.innerHTML = '<div class="learning-mode-welcome-loading">学习侧栏桥接未就绪。</div>';
            return;
        }

        let shell = container.querySelector('.learning-sidebar-chat');
        if (!shell) {
            container.innerHTML = `
                <div class="learning-sidebar-chat">
                    <div class="learning-sidebar-chat-log"></div>
                    <div class="learning-sidebar-chat-compose">
                        <textarea class="learning-sidebar-chat-input" placeholder="结合当前学习上下文继续提问..."></textarea>
                        <button type="button" class="learning-sidebar-chat-send" aria-label="发送" title="发送" data-action="send">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        </button>
                    </div>
                </div>
            `;
            shell = container.querySelector('.learning-sidebar-chat');
        }

        const log = shell ? shell.querySelector('.learning-sidebar-chat-log') : null;
        const input = shell ? shell.querySelector('.learning-sidebar-chat-input') : null;
        const sendBtn = shell ? shell.querySelector('.learning-sidebar-chat-send') : null;
        if (!shell || !log || !input || !sendBtn) return;

        if (!input.dataset.bound) {
            input.dataset.bound = 'true';
            input.addEventListener('input', () => {
                bridge.setInputValue?.(input.value);
                renderSidebarChat(container);
            });
            input.addEventListener('keydown', async (event) => {
                const liveGenerating = !!bridge.isGenerating?.();
                const livePendingSend = !!bridge.isPendingSend?.();
                const liveCanStop = liveGenerating && typeof bridge.stop === 'function';
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    const text = String(input.value || '').trim();
                    if (!text || liveGenerating || livePendingSend) return;
                    await bridge.send?.(text);
                    return;
                }
                if (event.key === 'Escape' && liveCanStop) {
                    event.preventDefault();
                    await bridge.stop?.();
                }
            });
        }

        if (!sendBtn.dataset.bound) {
            sendBtn.dataset.bound = 'true';
            sendBtn.addEventListener('click', async () => {
                const liveGenerating = !!bridge.isGenerating?.();
                const livePendingSend = !!bridge.isPendingSend?.();
                const liveCanStop = liveGenerating && typeof bridge.stop === 'function';
                if (liveCanStop) {
                    await bridge.stop?.();
                    return;
                }
                const text = String(input.value || '').trim();
                if (!text || liveGenerating || livePendingSend) return;
                await bridge.send?.(text);
            });
        }

        const messages = Array.isArray(bridge.getMessages?.()) ? bridge.getMessages() : [];
        const inputValue = String(bridge.getInputValue?.() || '');
        const generating = !!bridge.isGenerating?.();
        const pendingSend = !!bridge.isPendingSend?.();
        const canStop = generating && typeof bridge.stop === 'function';
        const trimmedInput = String(inputValue || '').trim();
        const sendDisabled = canStop ? false : (pendingSend || !!bridge.isBusy?.() || !trimmedInput);
        const hadFocus = document.activeElement === input;
        const selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : null;
        const selectionEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : null;

        if (input.value !== inputValue) {
            input.value = inputValue;
        }
        input.disabled = false;
        input.readOnly = false;
        input.setAttribute('aria-busy', generating ? 'true' : 'false');

        sendBtn.disabled = sendDisabled;
        sendBtn.dataset.action = canStop ? 'stop' : 'send';
        sendBtn.classList.toggle('is-stop', canStop);
        sendBtn.setAttribute('aria-label', canStop ? '中断' : '发送');
        sendBtn.title = canStop ? '中断' : '发送';
        sendBtn.innerHTML = canStop
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

        if (!log.dataset.autoScrollBound) {
            log.dataset.autoScrollBound = 'true';
            log.dataset.atBottom = 'true';
            log.addEventListener('scroll', () => {
                // 实时采集：用户在底部附近时（阈值 20px）重新激活自动跟底
                const maxScroll = log.scrollHeight - log.clientHeight;
                log.dataset.atBottom = maxScroll <= 0 || log.scrollTop >= maxScroll - 20 ? 'true' : 'false';
            }, { passive: true });
        }

        // replaceChildren 之前测量旧滚动位置
        const oldMaxScroll = log.scrollHeight - log.clientHeight;
        const wasAtBottom = log.dataset.atBottom !== 'false' &&
            (oldMaxScroll <= 0 || log.scrollTop >= oldMaxScroll - 45);

        log.replaceChildren();
        if (!messages.length) {
            const empty = document.createElement('div');
            empty.className = 'learning-sidebar-chat-empty';
            empty.textContent = '暂无消息，进入阅读器后可在此直接对话。';
            log.appendChild(empty);
        } else {
            messages.forEach((row, messageIndex) => {
                const role = String(row && row.role ? row.role : 'assistant').trim().toLowerCase();
                const msg = document.createElement('div');
                msg.className = `learning-sidebar-chat-msg is-${escapeHtml(role || 'assistant')}`;

                const roleDiv = document.createElement('div');
                roleDiv.className = 'learning-sidebar-chat-role';
                roleDiv.textContent = role === 'user' ? '你' : (role === 'assistant' ? 'Nexora' : '系统');
                msg.appendChild(roleDiv);

                const parts = Array.isArray(row && row.parts) ? row.parts : [];
                if (!parts.length) {
                    const textDiv = document.createElement('div');
                    textDiv.className = 'learning-sidebar-chat-text';
                    renderSidebarMarkdown(textDiv, role, row && row.content ? row.content : '');
                    msg.appendChild(textDiv);
                } else {
                    parts.forEach((part, partIndex) => {
                        msg.appendChild(createFoldablePart(role, part, messageIndex, partIndex, bridge));
                    });
                }
                log.appendChild(msg);
            });

            if (wasAtBottom) {
                log.scrollTop = log.scrollHeight;
            }
        }

        if (hadFocus) {
            try {
                input.focus({ preventScroll: true });
                if (selectionStart !== null && selectionEnd !== null) {
                    const maxPos = input.value.length;
                    input.setSelectionRange(
                        Math.max(0, Math.min(selectionStart, maxPos)),
                        Math.max(0, Math.min(selectionEnd, maxPos))
                    );
                }
            } catch (_) {}
        }
    }

    function renderSidebarDefault(container, options = {}) {
        const username = String(options.username || '').trim() || '当前用户';
        const role = String(options.role || 'member').trim() || 'member';
        container.innerHTML = `
            <div class="learning-sidebar-shell">
                <div class="learning-sidebar-card">
                    <h3>Learning</h3>
                    <p><span class="learning-sidebar-user">${escapeHtml(username)}</span> 当前在学习模式。</p>
                    <p>进入阅读器后，这里会切换为学习对话面板。</p>
                </div>
                <div class="learning-sidebar-card">
                    <h3>当前状态</h3>
                    <p>角色：${escapeHtml(role)}</p>
                    <p>侧栏：概览</p>
                </div>
            </div>
        `;
    }

    function applySidebarByState() {
        if (!sidebarContainerRef || !sidebarContainerRef.isConnected) return;
        if (sidebarUnmount) {
            try { sidebarUnmount(); } catch (_) {}
            sidebarUnmount = null;
        }
        const sidebarMode = String((sidebarOptionsRef || {}).sidebarMode || '').trim().toLowerCase();
        if (sidebarMode === 'learning') {
            renderSidebarChat(sidebarContainerRef);
            const bridge = window.NexoraLearningSidebarBridge;
            if (bridge && typeof bridge.subscribe === 'function') {
                sidebarUnmount = bridge.subscribe(() => {
                    renderSidebarChat(sidebarContainerRef);
                });
            }
            return;
        }
        renderSidebarDefault(sidebarContainerRef, sidebarOptionsRef || {});
    }

    function handleReaderStatePayload(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (String(payload.source || '').trim().toLowerCase() !== 'nexora-learning') return;
        if (String(payload.type || '').trim().toLowerCase() !== 'nexora:reader:state') return;
        if (activePuzzleFullscreen) {
            exitPuzzleFullscreen();
        }
        sidebarReaderOpened = !!payload.opened;
        applySidebarByState();
    }

    async function postFeedViaIframe(content) {
        const win = getSharedMainWindow();
        if (!win) throw new Error('Learning iframe 未就绪。');
        const frontendUrl = String(currentFrontendUrl || '').trim();
        const origin = (() => {
            try { return frontendUrl ? new URL(frontendUrl).origin : '*'; } catch (_) { return '*'; }
        })();
        const requestId = `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return await new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                window.removeEventListener('message', onMessage);
                reject(new Error('发布动态超时。'));
            }, 12000);
            function cleanup() {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
            }
            function onMessage(event) {
                const data = event && event.data;
                if (!data || typeof data !== 'object') return;
                if (String(data.source || '').trim().toLowerCase() !== 'nexora-learning') return;
                if (String(data.type || '').trim().toLowerCase() !== 'nexora:feed-compose:result') return;
                if (String(data.requestId || '') !== requestId) return;
                if (done) return;
                done = true;
                cleanup();
                if (data.success === false) reject(new Error(String(data.error || '发布动态失败。')));
                else resolve(data);
            }
            window.addEventListener('message', onMessage);
            try {
                win.postMessage({
                    source: 'nexora-learning',
                    type: 'nexora:feed-compose:submit',
                    requestId,
                    content: String(content || ''),
                }, origin === '*' ? '*' : origin);
            } catch (err) {
                cleanup();
                reject(err);
            }
        });
    }

    async function searchFeedUsersViaIframe(query, limit = 8) {
        const win = getSharedMainWindow();
        if (!win) throw new Error('Learning iframe 未就绪。');
        const frontendUrl = String(currentFrontendUrl || '').trim();
        const origin = (() => {
            try { return frontendUrl ? new URL(frontendUrl).origin : '*'; } catch (_) { return '*'; }
        })();
        const requestId = `feed_users_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return await new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                window.removeEventListener('message', onMessage);
                reject(new Error('查询用户超时。'));
            }, 12000);
            function cleanup() {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
            }
            function onMessage(event) {
                const data = event && event.data;
                if (!data || typeof data !== 'object') return;
                if (String(data.source || '').trim().toLowerCase() !== 'nexora-learning') return;
                if (String(data.type || '').trim().toLowerCase() !== 'nexora:feed-users:search:result') return;
                if (String(data.requestId || '') !== requestId) return;
                if (done) return;
                done = true;
                cleanup();
                if (data.success === false) reject(new Error(String(data.error || '查询用户失败。')));
                else resolve(Array.isArray(data.items) ? data.items : []);
            }
            window.addEventListener('message', onMessage);
            try {
                win.postMessage({
                    source: 'nexora-learning',
                    type: 'nexora:feed-users:search',
                    requestId,
                    q: String(query || ''),
                    limit: Number(limit) || 8,
                }, origin === '*' ? '*' : origin);
            } catch (err) {
                cleanup();
                reject(err);
            }
        });
    }

    function renderSidebarPanel(container, options = {}) {
        if (!container) return;
        sidebarContainerRef = container;
        sidebarOptionsRef = options || {};
        applySidebarByState();
    }

    function destroySidebarPanel() {
        if (sidebarUnmount) {
            try { sidebarUnmount(); } catch (_) {}
            sidebarUnmount = null;
        }
        sidebarContainerRef = null;
    }

    window.addEventListener('message', (event) => {
        if (handlePuzzleStateUpdateFromIframe(event)) return;
        if (handlePuzzleFramePayload(event)) return;
        handleReaderStatePayload(event && event.data);
        const data = event && event.data;
        const msgType = String(data && data.type ? data.type : '').trim().toLowerCase();

        if (data && typeof data === 'object'
            && String(data.source || '').trim().toLowerCase() === 'nexora-learning'
            && msgType === 'nexora:learning:pointerdown') {
            window.dispatchEvent(new CustomEvent('nexora:learning-frame-pointerdown'));
            return;
        }

        // 处理来自 NexoraLearning iframe 的提示词注入请求
        if (data && typeof data === 'object'
            && String(data.source || '').trim().toLowerCase() === 'nexora-learning'
            && msgType === 'nexora:inject-prompt') {
            injectPromptToMainInput(String(data.text || '').trim());
        }
    });

    // 同页面 CustomEvent 兜底（非 iframe 场景）
    window.addEventListener('nexora:inject-prompt', (event) => {
        const data = event && event.detail;
        if (data && typeof data === 'object') {
            injectPromptToMainInput(String(data.text || '').trim());
        }
    });

    function injectPromptToMainInput(text) {
        if (!text) return;
        const textarea = document.getElementById('messageInput');
        if (!textarea) return;
        textarea.value = text;
        textarea.focus();
        // 触发 input 事件让框架感知到值变化
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    window.addEventListener('nexora:reader:state', (event) => {
        handleReaderStatePayload(event && event.detail);
    });

    // ---- Puzzle functions (migrated from chat.js) ----

    function resolvePuzzleCardId(payload, step, messageDiv) {
        const rawPayload = (payload && typeof payload === 'object') ? payload : {};
        const explicitId = String(rawPayload.puzzle_id || '').trim();
        if (explicitId) return explicitId;
        const payloadCallId = String(rawPayload.call_id || '').trim();
        if (payloadCallId) return payloadCallId;
        const stepCallId = String((step && step.call_id) || '').trim();
        if (stepCallId) return stepCallId;
        const messageIndex = Number(messageDiv && messageDiv.dataset ? messageDiv.dataset.index : NaN);
        const safeIndex = Number.isFinite(messageIndex) ? String(Math.max(0, Math.floor(messageIndex))) : 'x';
        const existingCount = messageDiv
            ? Array.from(messageDiv.querySelectorAll('.puzzle-tool-card')).length
            : 0;
        return `puzzle_msg_${safeIndex}_${existingCount}`;
    }

    function extractPuzzlePayload(rawResult) {
        if (!rawResult) return null;
        if (typeof rawResult === 'object') {
            if (rawResult.puzzle && typeof rawResult.puzzle === 'object') return rawResult.puzzle;
            if (rawResult.title && Array.isArray(rawResult.steps)) return rawResult;
            return null;
        }
        const text = String(rawResult || '').trim();
        if (!text) return null;
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
                if (parsed.puzzle && typeof parsed.puzzle === 'object') return parsed.puzzle;
                if (parsed.title && Array.isArray(parsed.steps)) return parsed;
            }
        } catch (_) {}
        return null;
    }

    function rememberLockedPuzzle(puzzleId, submission = null) {
        if (!chatBridge) return;
        const locks = chatBridge.learningInteractionLocks;
        if (!locks) return;
        const pid = String(puzzleId || '').trim();
        if (!pid) return;
        const key = chatBridge.getLearningInteractionLockKey();
        if (!locks.puzzles.has(key)) {
            locks.puzzles.set(key, new Map());
        }
        locks.puzzles.get(key).set(pid, submission && typeof submission === 'object' ? submission : {});
    }

    function getLockedPuzzleSubmission(puzzleId) {
        const pid = String(puzzleId || '').trim();
        if (!pid) return null;
        // 优先检查服务端缓存
        if (chatBridge) {
            const cached = (chatBridge.getCachedPuzzleStates ? chatBridge.getCachedPuzzleStates() : {})[pid];
            if (cached && typeof cached === 'object' && cached.locked && cached.submission) {
                return {
                    ordered_steps: Array.isArray(cached.submission.ordered_steps) ? cached.submission.ordered_steps : [],
                    submission: cached.submission,
                    submitted_at: cached.submitted_at || 0,
                };
            }
        }
        const stored = resolveStoredPuzzleSubmissionById(pid);
        if (stored) return stored;
        if (!chatBridge) return null;
        const locks = chatBridge.learningInteractionLocks;
        if (!locks) return null;
        const key = chatBridge.getLearningInteractionLockKey();
        const bucket = locks.puzzles.get(key);
        if (!bucket) return null;
        const row = bucket.get(pid);
        return row && typeof row === 'object' ? row : null;
    }

    function applyPuzzleAnswer(puzzleCard, orderedSteps) {
        markPuzzleCardSubmitted(puzzleCard, orderedSteps, null);
        if (!puzzleCard) return;
        const body = puzzleCard.querySelector('.puzzle-card-body');
        const rows = Array.isArray(orderedSteps)
            ? orderedSteps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (body) {
            body.classList.add('answered');
            const iframe = body.querySelector('.puzzle-card-iframe');
            if (iframe) iframe.setAttribute('tabindex', '-1');
            const answer = body.querySelector('.puzzle-card-answer');
            if (answer) {
                answer.hidden = false;
                answer.innerHTML = rows.length
                    ? `<div class="puzzle-card-answer-title">已提交步骤</div><ol>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`
                    : '<div class="puzzle-card-answer-title">已提交步骤</div><div>无有效步骤</div>';
            }
            const pill = body.querySelector('.question-card-pill');
            if (pill) pill.textContent = 'Submitted';
        }
        puzzleCard.dataset.pending = 'false';
        puzzleCard.dataset.resolved = 'true';
    }

    async function submitPuzzleAnswer(orderedSteps, puzzleCard = null, submission = null, puzzleIdHint = '') {
        const rows = Array.isArray(orderedSteps)
            ? orderedSteps.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (!rows.length) return;
        const puzzleId = (puzzleCard
            ? String((puzzleCard.dataset && puzzleCard.dataset.puzzleId) || '').trim()
            : '')
            || String(puzzleIdHint || '').trim()
            || (submission && typeof submission === 'object' ? String(submission.puzzle_id || '').trim() : '');
        if (puzzleId) {
            rememberLockedPuzzle(puzzleId, submission && typeof submission === 'object' ? submission : { ordered_steps: rows });
        }
        if (puzzleCard) {
            markPuzzleCardSubmitted(puzzleCard, rows, submission);
        }
        const displayText = summarizePuzzleSubmission(rows, submission);
        if (chatBridge && typeof chatBridge.sendMessage === 'function') {
            await chatBridge.sendMessage({
                displayContentOverride: displayText,
                puzzle_submission: { puzzle_id: puzzleId, ordered_steps: rows },
            });
        }
    }

    async function handlePuzzleIframeSubmit(detail) {
        const payload = (detail && typeof detail === 'object') ? detail : {};
        const puzzleCard = findPuzzleCardBySourceWindow(payload.sourceWindow, chatBridge && chatBridge.messagesContainer)
            || findPuzzleCardBySourceWindow(payload.sourceWindow);
        const orderedSteps = Array.isArray(payload.orderedSteps) ? payload.orderedSteps : [];
        const submission = (payload.submission && typeof payload.submission === 'object') ? payload.submission : null;
        const resolvedSteps = orderedSteps.length
            ? orderedSteps
            : (Array.isArray(submission && submission.ordered_steps) ? submission.ordered_steps : []);
        const puzzleIdHint = String(payload.puzzle_id || (submission && submission.puzzle_id) || '').trim();
        try {
            console.log('[LearningMode] handlePuzzleIframeSubmit', {
                hasCard: !!puzzleCard,
                steps: resolvedSteps.length,
                hasSubmission: !!submission,
                puzzleIdHint
            });
        } catch (_) {}
        await submitPuzzleAnswer(resolvedSteps, puzzleCard, submission, puzzleIdHint);
        return true;
    }

    function appendPuzzleStep(messageDiv, step) {
        if (!messageDiv || !step || typeof step !== 'object') return;
        const content = messageDiv.querySelector('.message-content');
        if (!content) return;
        const rawPayload = (step.puzzle && typeof step.puzzle === 'object') ? step.puzzle : step;
        const payload = (rawPayload && typeof rawPayload === 'object') ? { ...rawPayload } : {};
        const fallbackCardId = resolvePuzzleCardId(payload, step, messageDiv);
        if (!String(payload.puzzle_id || '').trim()) {
            payload.puzzle_id = fallbackCardId;
        }
        // 从服务端缓存取画布状态
        const serverState = chatBridge
            ? ((chatBridge.getCachedPuzzleStates ? chatBridge.getCachedPuzzleStates() : {})[fallbackCardId] || (chatBridge.getCachedPuzzleStates ? chatBridge.getCachedPuzzleStates() : {})[payload.puzzle_id] || null)
            : null;
        // 如果服务端有提交记录，同步到内存锁
        if (serverState && serverState.locked && serverState.submission) {
            rememberLockedPuzzle(fallbackCardId, serverState.submission);
        }
        try {
            console.log('[LearningMode] appendPuzzleStep', {
                puzzleId: payload.puzzle_id,
                hasStepCallId: !!String((step && step.call_id) || '').trim(),
                hasServerState: !!serverState,
                messageIndex: Number(messageDiv && messageDiv.dataset ? messageDiv.dataset.index : NaN)
            });
        } catch (_) {}
        const frontendUrl = chatBridge ? chatBridge.frontendUrl : '';
        const username = chatBridge ? chatBridge.username : '';
        const node = createPuzzleCardNode(payload, { cardId: fallbackCardId, serverState, frontendUrl, username });
        if (!node) {
            const ensureAssets = chatBridge && typeof chatBridge.ensureLearningModeAssets === 'function'
                ? chatBridge.ensureLearningModeAssets
                : null;
            if (!ensureAssets) return;
            void ensureAssets().then(() => {
                const retryNode = createPuzzleCardNode(payload, { cardId: fallbackCardId, serverState, frontendUrl, username });
                if (!retryNode) return;
                const puzzleIdRetry = String((retryNode.dataset && retryNode.dataset.puzzleId) || payload.puzzle_id || '').trim();
                const rememberedSubmissionRetry = getLockedPuzzleSubmission(puzzleIdRetry);
                if (rememberedSubmissionRetry) {
                    const ordered = Array.isArray(rememberedSubmissionRetry.ordered_steps) ? rememberedSubmissionRetry.ordered_steps : [];
                    markPuzzleCardSubmitted(retryNode, ordered, rememberedSubmissionRetry);
                    retryNode.dataset.pending = 'false';
                    retryNode.dataset.resolved = 'true';
                }
                content.appendChild(retryNode);
                if (chatBridge && typeof chatBridge.placeInteractiveCardsBelowToolChain === 'function') {
                    chatBridge.placeInteractiveCardsBelowToolChain(messageDiv);
                }
            }).catch(() => {});
            return;
        }
        const puzzleId = String((node.dataset && node.dataset.puzzleId) || payload.puzzle_id || '').trim();
        const rememberedSubmission = getLockedPuzzleSubmission(puzzleId);
        if (rememberedSubmission) {
            const ordered = Array.isArray(rememberedSubmission.ordered_steps) ? rememberedSubmission.ordered_steps : [];
            markPuzzleCardSubmitted(node, ordered, rememberedSubmission);
            node.dataset.pending = 'false';
            node.dataset.resolved = 'true';
        }
        content.appendChild(node);
        if (chatBridge && typeof chatBridge.placeInteractiveCardsBelowToolChain === 'function') {
            chatBridge.placeInteractiveCardsBelowToolChain(messageDiv);
        }
    }

    window.NexoraLearningMode = {
        registerChatBridge,
        renderWelcome,
        renderMainPanel,
        renderSidebarPanel,
        destroySidebarPanel,
        closeReaderFromHost,
        postFeedViaIframe,
        searchFeedUsersViaIframe,
        createPuzzleCardNode,
        findPuzzleCardBySourceWindow,
        markPuzzleCardSubmitted,
        buildPuzzleSubmissionInjectionText,
        summarizePuzzleSubmission,
        resolveStoredPuzzleSubmissionById,
        exitPuzzleFullscreen,
        fetchPuzzleStatesFromServer,
        savePuzzleStateToServer,
        resolvePuzzleCardId,
        extractPuzzlePayload,
        rememberLockedPuzzle,
        getLockedPuzzleSubmission,
        applyPuzzleAnswer,
        submitPuzzleAnswer,
        handlePuzzleIframeSubmit,
        appendPuzzleStep,
    };

    bindPuzzleFullscreenEvents();
})();
