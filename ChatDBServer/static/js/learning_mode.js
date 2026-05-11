(function () {
    let sharedWelcomeIframe = null;
    let sharedMainIframe = null;
    let sidebarUnmount = null;
    let sidebarReaderOpened = false;
    let sidebarContainerRef = null;
    let sidebarOptionsRef = {};
    const sidebarFoldState = new Map();

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function ensureSharedIframe(kind, frontendUrl) {
        const useMain = kind === 'main';
        let frame = useMain ? sharedMainIframe : sharedWelcomeIframe;
        if (frame && frame.isConnected) {
            return frame;
        }
        frame = document.createElement('iframe');
        frame.className = 'learning-mode-frame';
        frame.src = String(frontendUrl || '').trim();
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

    function renderWelcome(container, options = {}) {
        if (!container) return;
        const frontendUrl = String(options.frontendUrl || '').trim();
        container.classList.add('learning-mode-welcome-shell');
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        wrap.appendChild(ensureSharedIframe('welcome', frontendUrl));
    }

    function renderMainPanel(container, options = {}) {
        if (!container) return;
        const frontendUrl = String(options.frontendUrl || '').trim();
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        wrap.appendChild(ensureSharedIframe('main', frontendUrl));
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
                await bridge.submitQuestionAnswer(finalAnswer, questionId);
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

        if (questionId) {
            const meta = document.createElement('div');
            meta.className = 'learning-sidebar-question-meta';
            meta.textContent = `Question ID: ${questionId}`;
            card.appendChild(meta);
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
            const shouldAutoOpen = kind === 'thinking' || (kind === 'tool' && !!(part && part.pending));
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
        const messages = Array.isArray(bridge.getMessages?.()) ? bridge.getMessages() : [];
        const inputValue = String(bridge.getInputValue?.() || '');
        const generating = !!bridge.isGenerating?.();
        const pendingSend = !!bridge.isPendingSend?.();
        const canStop = generating && typeof bridge.stop === 'function';
        const sendDisabled = pendingSend || (!canStop && !!bridge.isBusy?.());
        container.innerHTML = `
            <div class="learning-sidebar-chat">
                <div class="learning-sidebar-chat-log"></div>
                <div class="learning-sidebar-chat-compose">
                    <textarea class="learning-sidebar-chat-input" placeholder="结合当前学习上下文继续提问...">${escapeHtml(inputValue)}</textarea>
                    <button type="button" class="learning-sidebar-chat-send${canStop ? ' is-stop' : ''}" aria-label="${canStop ? '中断' : '发送'}" title="${canStop ? '中断' : '发送'}" data-action="${canStop ? 'stop' : 'send'}" ${sendDisabled ? 'disabled' : ''}>
                        ${canStop
                            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>'
                            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>'
                        }
                    </button>
                </div>
            </div>
        `;
        const log = container.querySelector('.learning-sidebar-chat-log');
        if (log) {
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
            }
            log.scrollTop = log.scrollHeight;
        }

        const input = container.querySelector('.learning-sidebar-chat-input');
        const sendBtn = container.querySelector('.learning-sidebar-chat-send');
        if (input) {
            input.addEventListener('input', () => {
                bridge.setInputValue?.(input.value);
            });
            input.addEventListener('keydown', async (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    const text = String(input.value || '').trim();
                    if (!text || generating || pendingSend) return;
                    await bridge.send?.(text);
                    return;
                }
                if (event.key === 'Escape' && canStop) {
                    event.preventDefault();
                    await bridge.stop?.();
                }
            });
        }
        if (sendBtn) {
            sendBtn.addEventListener('click', async () => {
                if (canStop) {
                    await bridge.stop?.();
                    return;
                }
                if (!input) return;
                const text = String(input.value || '').trim();
                if (!text || generating || pendingSend) return;
                await bridge.send?.(text);
            });
        }
    }

    function renderSidebarDefault(container, options = {}) {
        const username = String(options.username || '').trim() || '当前用户';
        const role = String(options.role || 'member').trim() || 'member';
        container.innerHTML = `
            <div class="learning-sidebar-shell">
                <button type="button" class="btn-primary-outline full-width" data-learning-action="new-learning">New Learning</button>
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
        if (sidebarReaderOpened) {
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
        sidebarReaderOpened = !!payload.opened;
        applySidebarByState();
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
        handleReaderStatePayload(event && event.data);
    });

    window.addEventListener('nexora:reader:state', (event) => {
        handleReaderStatePayload(event && event.detail);
    });

    window.NexoraLearningMode = {
        renderWelcome,
        renderMainPanel,
        renderSidebarPanel,
        destroySidebarPanel,
    };
})();
