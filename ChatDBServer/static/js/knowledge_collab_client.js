(function () {
    'use strict';

    function clampIndex(value, text) {
        const length = String(text || '').length;
        const index = Number.isFinite(Number(value)) ? Number(value) : 0;

        return Math.max(0, Math.min(length, Math.floor(index)));
    }

    function buildReplaceOperation(before, after) {
        const oldText = String(before || '');
        const newText = String(after || '');

        if (oldText === newText) {
            return null;
        }

        let start = 0;
        const oldLength = oldText.length;
        const newLength = newText.length;

        while (start < oldLength && start < newLength && oldText[start] === newText[start]) {
            start += 1;
        }

        let oldEnd = oldLength;
        let newEnd = newLength;

        while (
            oldEnd > start
            && newEnd > start
            && oldText[oldEnd - 1] === newText[newEnd - 1]
        ) {
            oldEnd -= 1;
            newEnd -= 1;
        }

        return {
            start,
            delete_count: oldEnd - start,
            insert_text: newText.slice(start, newEnd),
        };
    }

    function applyOperation(text, operation) {
        const source = String(text || '');
        const op = operation && typeof operation === 'object' ? operation : {};
        const start = clampIndex(op.start, source);
        const deleteCount = Math.max(0, Number(op.delete_count || 0));
        const end = Math.min(source.length, start + deleteCount);
        const insertText = String(op.insert_text || '');

        return source.slice(0, start) + insertText + source.slice(end);
    }

    function transformOffset(offset, operation, preferAfterInsert) {
        const op = operation && typeof operation === 'object' ? operation : {};
        const start = Math.max(0, Number(op.start || 0));
        const deleteCount = Math.max(0, Number(op.delete_count || 0));
        const insertLength = String(op.insert_text || '').length;
        const end = start + deleteCount;
        const value = Math.max(0, Number(offset || 0));

        if (value < start) {
            return value;
        }

        if (value > end) {
            return Math.max(0, value + insertLength - deleteCount);
        }

        if (value === start && preferAfterInsert) {
            return start + insertLength;
        }

        return start;
    }

    function transformOperation(operation, committed, preferAfterInsert) {
        const op = { ...(operation || {}) };
        const start = Math.max(0, Number(op.start || 0));
        const end = start + Math.max(0, Number(op.delete_count || 0));
        const nextStart = transformOffset(start, committed, !!preferAfterInsert);
        const nextEnd = transformOffset(end, committed, !!preferAfterInsert);

        op.start = Math.max(0, nextStart);
        op.delete_count = Math.max(0, nextEnd - nextStart);
        return op;
    }

    function offsetToLineCol(text, offset) {
        const source = String(text || '');
        const safeOffset = clampIndex(offset, source);
        const before = source.slice(0, safeOffset);
        const lines = before.split('\n');

        return {
            offset: safeOffset,
            line: Math.max(0, lines.length - 1),
            col: Math.max(0, String(lines[lines.length - 1] || '').length),
        };
    }

    // ---- Toast UI Editor v3 (ProseMirror) helpers ----
    // v3 的 markdown 模式下文档结构为“每行一个段落节点”，
    // 因此文本 offset 与 PM pos 的换算关系为 pos = offset + line + 1。

    function getToastMarkdownView(editor) {
        try {
            if (editor && editor.mdEditor && editor.mdEditor.view) {
                return editor.mdEditor.view;
            }
        } catch (_) {}

        return null;
    }

    function getToastViewText(view) {
        // 注意：不能用 doc.textBetween(0, size, '\n')——空段落不会产生分隔符，
        // 连续空行会被折叠，导致 offset 计算和增量校验全部失准。
        try {
            const doc = view.state.doc;
            const lines = [];

            for (let i = 0; i < doc.childCount; i += 1) {
                lines.push(String(doc.child(i).textContent || ''));
            }

            return lines.join('\n');
        } catch (_) {
            return '';
        }
    }

    function pmPosToTextOffset(view, pos) {
        const doc = view.state.doc;
        const target = Math.max(0, Number(pos) || 0);
        let offset = 0;
        let consumed = 0;

        for (let i = 0; i < doc.childCount; i += 1) {
            const child = doc.child(i);
            const textLength = String(child.textContent || '').length;

            if (target <= consumed) {
                return offset;
            }

            if (target <= consumed + 1 + textLength) {
                return offset + Math.max(0, Math.min(textLength, target - consumed - 1));
            }

            offset += textLength + 1;
            consumed += child.nodeSize;
        }

        return Math.max(0, offset - 1);
    }

    function lineColToPmPos(view, line, col) {
        const doc = view.state.doc;

        if (!doc.childCount) {
            return 0;
        }

        const target = Math.max(0, Math.min(Math.floor(Number(line) || 0), doc.childCount - 1));
        let pos = 0;

        for (let i = 0; i < target; i += 1) {
            pos += doc.child(i).nodeSize;
        }

        const node = doc.child(target);

        return pos + 1 + Math.max(0, Math.min(Math.floor(Number(col) || 0), node.content.size));
    }

    function textOffsetToPmPos(view, text, offset) {
        const lineCol = offsetToLineCol(text, offset);

        return lineColToPmPos(view, lineCol.line, lineCol.col);
    }

    function getToastCursorOffset(editor) {
        const view = getToastMarkdownView(editor);

        if (!view) {
            return 0;
        }

        try {
            return pmPosToTextOffset(view, Number(view.state.selection.from || 0));
        } catch (_) {
            return 0;
        }
    }

    function getToastSelectionOffsets(editor) {
        const view = getToastMarkdownView(editor);

        if (!view) {
            return { head: 0, anchor: 0 };
        }

        try {
            const selection = view.state.selection;
            const head = pmPosToTextOffset(view, Number(selection.head || selection.from || 0));
            const anchor = pmPosToTextOffset(view, Number(selection.anchor || selection.from || 0));

            return { head, anchor };
        } catch (_) {
            return { head: 0, anchor: 0 };
        }
    }

    function setToastCursorOffset(editor, offset) {
        const view = getToastMarkdownView(editor);

        if (!view) {
            return false;
        }

        try {
            const text = getToastViewText(view);
            const pos = textOffsetToPmPos(view, text, clampIndex(offset, text));
            const $pos = view.state.doc.resolve(pos);
            const SelectionCtor = view.state.selection.constructor;

            if (!SelectionCtor || typeof SelectionCtor.near !== 'function') {
                return false;
            }

            // 不调用 focus / scrollIntoView，避免拉扯本地滚动位置
            view.dispatch(view.state.tr.setSelection(SelectionCtor.near($pos)).setMeta('addToHistory', false));
            return true;
        } catch (_) {
            return false;
        }
    }

    function applyToastOperation(editor, operation, nextText) {
        const view = getToastMarkdownView(editor);
        const op = operation && typeof operation === 'object' ? operation : null;

        if (!view || !op) {
            return false;
        }

        try {
            const current = getToastViewText(view);
            const start = clampIndex(op.start, current);
            const end = clampIndex(start + Math.max(0, Number(op.delete_count || 0)), current);
            const from = textOffsetToPmPos(view, current, start);
            const to = textOffsetToPmPos(view, current, end);
            const insertText = String(op.insert_text || '');
            const lines = insertText.split('\n');
            let tr = view.state.tr;

            if (lines.length === 1) {
                tr = tr.insertText(insertText, from, to);
            } else {
                const schema = view.state.schema;
                const paraType = schema.nodes.paragraph;

                if (!paraType) {
                    return false;
                }

                const FragmentCtor = view.state.doc.content.constructor;
                const SliceCtor = view.state.doc.slice(0, 0).constructor;
                const paras = lines.map((lineText) => paraType.create(null, lineText ? schema.text(lineText) : null));

                tr = tr.replaceRange(from, to, new SliceCtor(FragmentCtor.from(paras), 1, 1));
            }

            view.dispatch(tr.setMeta('addToHistory', false));

            // 校验结果，与目标文本不一致则回退到全量替换
            return getToastViewText(view) === String(nextText || '');
        } catch (_) {
            return false;
        }
    }

    function createToastCursorOverlay(options = {}) {
        const opts = options && typeof options === 'object' ? options : {};
        const overlayState = {
            layer: null,
            lastMembers: [],
            selfId: '',
            raf: 0,
            boundScroller: null,
        };

        function getView() {
            const editor = typeof opts.getEditor === 'function' ? opts.getEditor() : null;

            return getToastMarkdownView(editor);
        }

        function getHost() {
            return typeof opts.getHost === 'function' ? opts.getHost() : null;
        }

        function ensureLayer(host) {
            if (overlayState.layer && overlayState.layer.parentNode === host) {
                return overlayState.layer;
            }

            if (overlayState.layer && overlayState.layer.parentNode) {
                overlayState.layer.remove();
            }

            if (window.getComputedStyle(host).position === 'static') {
                host.style.position = 'relative';
            }

            let layer = host.querySelector(':scope > .knowledge-collab-cursor-overlay-layer');

            if (!layer) {
                layer = document.createElement('div');
                layer.className = 'knowledge-collab-cursor-overlay-layer';
                host.appendChild(layer);
            }

            overlayState.layer = layer;
            return layer;
        }

        function scheduleReposition() {
            if (overlayState.raf) {
                return;
            }

            overlayState.raf = window.requestAnimationFrame(() => {
                overlayState.raf = 0;
                render(overlayState.lastMembers, overlayState.selfId);
            });
        }

        function bindScroll(view, host) {
            const target = host || (view && view.dom) || null;

            if (!target || overlayState.boundScroller === target) {
                return;
            }

            overlayState.boundScroller = target;
            // capture 捕获 host 内任意后代滚动（ProseMirror 或其父容器）
            target.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
        }

        function createWidget(member) {
            const widget = document.createElement('span');
            widget.className = 'knowledge-collab-cursor-bookmark';

            if (typeof opts.getColor === 'function') {
                widget.style.setProperty('--knowledge-collab-color', opts.getColor(member.client_id));
            }

            widget.innerHTML = [
                '<span class="knowledge-collab-cursor-line"></span>',
                '<span class="knowledge-collab-cursor-label"></span>'
            ].join('');

            const label = widget.querySelector('.knowledge-collab-cursor-label');

            if (label) {
                label.textContent = typeof opts.getName === 'function' ? String(opts.getName(member) || '协作者') : '协作者';
            }

            return widget;
        }

        function appendSelectionRects(layer, layerRect, view, text, member, from, to) {
            const color = typeof opts.getColor === 'function' ? opts.getColor(member.client_id) : '#2563eb';
            const lines = text.split('\n');
            const startLC = offsetToLineCol(text, Math.min(from, to));
            const endLC = offsetToLineCol(text, Math.max(from, to));
            // 超长选区截断，避免渲染卡顿
            const lastLine = Math.min(endLC.line, startLC.line + 200);

            for (let line = startLC.line; line <= lastLine; line += 1) {
                const lineText = String(lines[line] || '');
                const colStart = line === startLC.line ? startLC.col : 0;
                const colEnd = line === endLC.line ? endLC.col : lineText.length;
                let a = null;
                let b = null;

                try {
                    a = view.coordsAtPos(lineColToPmPos(view, line, colStart));
                    b = view.coordsAtPos(lineColToPmPos(view, line, colEnd));
                } catch (_) {
                    continue;
                }

                const rect = document.createElement('span');
                rect.className = 'knowledge-collab-selection-rect';
                rect.style.setProperty('--knowledge-collab-color', color);

                if (Math.abs(a.top - b.top) < 2) {
                    // 同一视觉行：精确矩形
                    rect.style.left = `${Math.min(a.left, b.left) - layerRect.left}px`;
                    rect.style.top = `${a.top - layerRect.top}px`;
                    rect.style.width = `${Math.max(4, Math.abs(b.left - a.left))}px`;
                    rect.style.height = `${Math.max(12, a.bottom - a.top)}px`;
                } else {
                    // 该行发生了自动换行：整块覆盖该逻辑行的可视区域
                    rect.style.left = '0';
                    rect.style.top = `${Math.min(a.top, b.top) - layerRect.top}px`;
                    rect.style.width = `${Math.max(4, layerRect.width)}px`;
                    rect.style.height = `${Math.max(12, Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top))}px`;
                }

                layer.appendChild(rect);
            }
        }

        function render(members, selfId) {
            overlayState.lastMembers = Array.isArray(members) ? members : [];
            overlayState.selfId = String(selfId || '');

            const view = getView();
            const host = getHost();

            if (!view || !host) {
                clear();
                return;
            }

            bindScroll(view, host);

            const layer = ensureLayer(host);
            layer.innerHTML = '';

            const text = getToastViewText(view);
            const layerRect = layer.getBoundingClientRect();

            overlayState.lastMembers.forEach((member) => {
                const clientId = String((member && member.client_id) || '').trim();
                const cursor = member && member.cursor && typeof member.cursor === 'object' ? member.cursor : null;

                if (!clientId || clientId === overlayState.selfId || !cursor) {
                    return;
                }

                const offset = cursor.offset !== undefined
                    ? clampIndex(cursor.offset, text)
                    : clampIndex(
                        text.split('\n').slice(0, Math.max(0, Number(cursor.line || 0))).join('\n').length
                        + (Number(cursor.line || 0) > 0 ? 1 : 0)
                        + Math.max(0, Number(cursor.col || 0)),
                        text
                    );

                // 选区高亮（anchor 与光标不重合时）
                const anchor = cursor.anchor !== undefined && cursor.anchor !== null
                    ? clampIndex(cursor.anchor, text)
                    : offset;

                if (anchor !== offset) {
                    appendSelectionRects(layer, layerRect, view, text, member, anchor, offset);
                }

                let coords = null;

                try {
                    coords = view.coordsAtPos(textOffsetToPmPos(view, text, offset));
                } catch (_) {
                    return;
                }

                const widget = createWidget(member);
                widget.style.left = `${Number(coords.left || 0) - layerRect.left}px`;
                widget.style.top = `${Number(coords.top || 0) - layerRect.top}px`;

                const caret = widget.querySelector('.knowledge-collab-cursor-line');
                const caretHeight = Math.max(12, Number(coords.bottom || 0) - Number(coords.top || 0));

                if (caret) {
                    caret.style.top = '0';
                    caret.style.height = `${caretHeight}px`;
                }

                layer.appendChild(widget);
            });
        }

        function clear() {
            overlayState.lastMembers = [];

            if (overlayState.layer) {
                overlayState.layer.innerHTML = '';
            }
        }

        return { render, clear, reposition: scheduleReposition };
    }

    function createOfflineMask(getHost) {
        let mask = null;

        return {
            show(message) {
                const host = typeof getHost === 'function' ? getHost() : null;

                if (!host) {
                    return;
                }

                if (window.getComputedStyle(host).position === 'static') {
                    host.style.position = 'relative';
                }

                if (!mask || mask.parentNode !== host) {
                    if (mask) {
                        mask.remove();
                    }

                    mask = document.createElement('div');
                    mask.className = 'knowledge-collab-offline-mask';
                    mask.innerHTML = '<div class="knowledge-collab-offline-tip"></div>';
                    host.appendChild(mask);
                }

                const tip = mask.querySelector('.knowledge-collab-offline-tip');

                if (tip) {
                    tip.textContent = String(message || '实时协作已断开，正在重连…');
                }
            },
            hide() {
                if (mask) {
                    mask.remove();
                    mask = null;
                }
            },
        };
    }

    function createClient(options = {}) {
        const opts = options && typeof options === 'object' ? options : {};
        const state = {
            socket: null,
            clientId: '',
            revision: 0,
            textShadow: '',
            active: false,
            closedByClient: false,
            localTimer: 0,
            cursorTimer: 0,
            pingTimer: 0,
            reconnectTimer: 0,
            pendingOp: null,
            applyingRemote: false,
            memberIds: null,
            memberInfo: {},
        };

        function getText() {
            return String(typeof opts.getText === 'function' ? opts.getText() : '');
        }

        function setText(value, meta) {
            if (typeof opts.setText !== 'function') {
                return undefined;
            }

            state.applyingRemote = true;

            try {
                return opts.setText(String(value || ''), meta || {});
            } finally {
                setTimeout(() => {
                    state.applyingRemote = false;
                }, 0);
            }
        }

        function setStatus(kind, text) {
            if (typeof opts.setStatus === 'function') {
                opts.setStatus(kind, text);
            }
        }

        function renderMembers(members, selfId) {
            const list = Array.isArray(members) ? members : [];
            const currentSelfId = selfId || state.clientId;

            // 成员进出播报（首次快照不播报存量成员）
            if (typeof opts.notifyPresence === 'function') {
                const ids = new Set(list.map((m) => String((m && m.client_id) || '')).filter(Boolean));

                if (state.memberIds) {
                    list.forEach((member) => {
                        const id = String((member && member.client_id) || '');

                        if (id && id !== currentSelfId && !state.memberIds.has(id)) {
                            opts.notifyPresence(member, 'join');
                        }
                    });
                    state.memberIds.forEach((id) => {
                        if (id && id !== currentSelfId && !ids.has(id)) {
                            opts.notifyPresence(state.memberInfo[id] || { client_id: id }, 'leave');
                        }
                    });
                }

                state.memberIds = ids;
                state.memberInfo = {};
                list.forEach((member) => {
                    state.memberInfo[String((member && member.client_id) || '')] = member;
                });
            }

            if (typeof opts.renderMembers === 'function') {
                opts.renderMembers(list, currentSelfId);
            }

            if (typeof opts.renderCursors === 'function') {
                opts.renderCursors(list, currentSelfId);
            }
        }

        function getCursorOffset() {
            if (typeof opts.getCursorOffset === 'function') {
                return clampIndex(opts.getCursorOffset(), getText());
            }

            return 0;
        }

        function setCursorOffset(offset) {
            if (typeof opts.setCursorOffset === 'function') {
                opts.setCursorOffset(offsetToLineCol(getText(), offset));
            }
        }

        function getCursorPayload() {
            const text = getText();
            const payload = offsetToLineCol(text, getCursorOffset());

            if (typeof opts.getCursorAnchor === 'function') {
                payload.anchor = clampIndex(opts.getCursorAnchor(), text);
            }

            return payload;
        }

        function send(payload) {
            if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
                return false;
            }

            state.socket.send(JSON.stringify(payload && typeof payload === 'object' ? payload : {}));
            return true;
        }

        function scheduleReconnect() {
            if (state.closedByClient || state.reconnectTimer) {
                return;
            }

            state.reconnectTimer = setTimeout(() => {
                state.reconnectTimer = 0;
                start();
            }, 1600);
        }

        function clearTimers() {
            if (state.localTimer) {
                clearTimeout(state.localTimer);
                state.localTimer = 0;
            }

            if (state.cursorTimer) {
                clearTimeout(state.cursorTimer);
                state.cursorTimer = 0;
            }

            if (state.pingTimer) {
                clearInterval(state.pingTimer);
                state.pingTimer = 0;
            }

            if (state.reconnectTimer) {
                clearTimeout(state.reconnectTimer);
                state.reconnectTimer = 0;
            }
        }

        function handleSnapshot(payload) {
            state.clientId = String(payload.client_id || '');
            state.revision = Number(payload.revision || 0);
            state.textShadow = String(payload.content || '');
            state.pendingOp = null;
            state.active = true;
            setText(state.textShadow, { source: 'snapshot' });
            renderMembers(payload.members, state.clientId);
            setStatus('ok', '实时协作已连接');

            if (typeof opts.onConnectionChange === 'function') {
                opts.onConnectionChange(true);
            }

            sendCursorNow();
        }

        async function verifyServerHash(expectedHash) {
            const expected = String(expectedHash || '').trim();

            // shadow 应当等于服务器文本；有未确认 op 时无法直接比对
            if (!expected || state.pendingOp || !window.crypto || !window.crypto.subtle) {
                return;
            }

            const snapshotText = state.textShadow;

            try {
                const digest = await window.crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(snapshotText)
                );
                const actual = Array.from(new Uint8Array(digest))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');

                if (
                    actual !== expected
                    && state.active
                    && !state.pendingOp
                    && snapshotText === state.textShadow
                    && state.socket
                ) {
                    // 本地与服务器内容分叉，强制重连拉取快照
                    setStatus('saving', '内容失配，正在重新同步...');
                    state.socket.close();
                }
            } catch (_) {}
        }

        function applyRemoteOperation(payload) {
            const rawOperation = payload && payload.op && typeof payload.op === 'object' ? payload.op : null;

            if (!rawOperation) {
                return;
            }

            const isSelf = String(payload.client_id || '') === state.clientId;

            if (isSelf) {
                state.revision = Number(payload.revision || state.revision || 0);
                state.pendingOp = null;
                // textShadow 此时已等于服务器文本（flush 时置为 server+pending，
                // ack 即 pending 落库），不能覆盖为 getText()——否则 ack 之后、
                // flush 之前打出的字符会被吞掉，永远同步不到远端。
                renderMembers(payload.members, state.clientId);
                setStatus('ok', '已同步');
                verifyServerHash(payload.content_hash);
                flushLocalChange();
                return;
            }

            const shadowBefore = state.textShadow;
            const currentText = getText();
            let operation = { ...rawOperation };

            // 1) 与未确认的 pendingOp 双向 transform。
            //    服务端会把我们的 pendingOp 排在这条已提交 op 之前（同位置插入时），
            //    所以本地应用远端 op 时要让它落到 pending 插入内容之后（preferAfterInsert）。
            if (state.pendingOp) {
                const opAfterPending = transformOperation(operation, state.pendingOp, true);
                state.pendingOp = transformOperation(state.pendingOp, operation, false);
                operation = opAfterPending;
            }

            state.textShadow = applyOperation(shadowBefore, operation);

            // 2) 编辑器里可能还有未 flush 的本地输入（buffer），
            //    远端 op 的坐标必须先经过 buffer transform 才能应用到编辑器文本
            const bufferOp = buildReplaceOperation(shadowBefore, currentText);
            const editorOp = bufferOp ? transformOperation(operation, bufferOp, true) : operation;

            const cursor = getCursorOffset();
            const nextText = applyOperation(currentText, editorOp);
            const nextCursor = transformOffset(cursor, editorOp, false);
            state.revision = Number(payload.revision || state.revision || 0);
            const incremental = setText(nextText, { source: 'remote_op', operation: editorOp }) === true;

            // 增量事务应用时 ProseMirror 已自动映射本地选区，
            // 不要再重设光标（避免多余的 caret 联动/滚动）
            if (!incremental) {
                setCursorOffset(nextCursor);
            }

            renderMembers(payload.members, state.clientId);
            setStatus('ok', '已同步远端输入');
            verifyServerHash(payload.content_hash);
        }

        function handleMessage(payload) {
            const type = String(payload && payload.type || '').trim();

            if (type === 'knowledge_collab_snapshot') {
                handleSnapshot(payload);
                return;
            }

            if (type === 'knowledge_collab_op') {
                applyRemoteOperation(payload);
                return;
            }

            if (type === 'knowledge_collab_members' || type === 'knowledge_collab_cursor') {
                renderMembers(payload.members, state.clientId);
                return;
            }

            if (type === 'knowledge_collab_saved') {
                if (payload.saved === false) {
                    setStatus('error', String(payload.message || '实时内容落盘失败'));
                } else {
                    setStatus('ok', '已落盘');
                }
                return;
            }

            if (type === 'error') {
                setStatus('error', String(payload.message || '协作通道错误'));
            }
        }

        function flushLocalChange() {
            if (!state.active || state.applyingRemote || state.pendingOp) {
                return;
            }

            const currentText = getText();
            const operation = buildReplaceOperation(state.textShadow, currentText);

            if (!operation) {
                return;
            }

            operation.op_id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
            state.pendingOp = { ...operation };
            state.textShadow = currentText;
            send({
                type: 'edit_op',
                revision: state.revision,
                ...operation,
                cursor: getCursorPayload(),
            });
            setStatus('saving', '实时同步中...');
        }

        function notifyLocalChange() {
            if (!state.active || state.applyingRemote) {
                return false;
            }

            if (state.localTimer) {
                clearTimeout(state.localTimer);
            }

            state.localTimer = setTimeout(() => {
                state.localTimer = 0;
                flushLocalChange();
            }, 45);
            scheduleCursorSend();
            return true;
        }

        function sendCursorNow() {
            if (!state.active) {
                return false;
            }

            return send({
                type: 'cursor',
                cursor: getCursorPayload(),
            });
        }

        function scheduleCursorSend() {
            if (state.cursorTimer) {
                clearTimeout(state.cursorTimer);
            }

            state.cursorTimer = setTimeout(() => {
                state.cursorTimer = 0;
                sendCursorNow();
            }, 160);
        }

        function start() {
            if (!opts.wsUrl || state.closedByClient) {
                return;
            }

            clearTimers();
            state.active = false;

            try {
                state.socket = new WebSocket(opts.wsUrl);
            } catch (e) {
                setStatus('error', `协作通道启动失败: ${String((e && e.message) || e)}`);
                scheduleReconnect();
                return;
            }

            state.socket.addEventListener('open', () => {
                setStatus('saving', '正在连接实时协作...');
                state.pingTimer = setInterval(() => {
                    send({ type: 'ping', ts: Date.now() });
                }, 25000);
            });

            state.socket.addEventListener('message', (event) => {
                try {
                    handleMessage(JSON.parse(event.data || '{}'));
                } catch (e) {
                    setStatus('error', `协作消息解析失败: ${String((e && e.message) || e)}`);
                }
            });

            state.socket.addEventListener('close', () => {
                state.active = false;
                state.socket = null;
                clearTimers();

                if (!state.closedByClient) {
                    setStatus('error', '实时协作已断开，正在重连');

                    if (typeof opts.onConnectionChange === 'function') {
                        opts.onConnectionChange(false);
                    }

                    scheduleReconnect();
                }
            });

            state.socket.addEventListener('error', () => {
                if (state.closedByClient) {
                    return;
                }

                setStatus('error', '实时协作通道异常');
            });
        }

        function stop() {
            state.closedByClient = true;
            state.active = false;
            clearTimers();

            if (state.socket) {
                state.socket.close();
                state.socket = null;
            }
        }

        return {
            start,
            stop,
            notifyLocalChange,
            flushNow: flushLocalChange,
            sendCursorNow,
            scheduleCursorSend,
            isActive: () => state.active,
            isApplyingRemote: () => state.applyingRemote,
            getClientId: () => state.clientId,
        };
    }

    window.NexoraKnowledgeCollab = {
        createClient,
        buildReplaceOperation,
        applyOperation,
        offsetToLineCol,
        getToastMarkdownView,
        getToastCursorOffset,
        getToastSelectionOffsets,
        setToastCursorOffset,
        applyToastOperation,
        createToastCursorOverlay,
        createOfflineMask,
    };
})();
