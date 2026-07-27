(function () {
    'use strict';

    const MODULE_NAME = 'knowledge';
    const knowledgeAlignLogger = window.NexoraLog.logger('KnowledgeAlign');
    const knowledgeSyncLogger = window.NexoraLog.logger('KnowledgeSync');

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Knowledge 模块');
        }

        return shared;
    }

    function requireKnowledgeDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_knowledge 缺少依赖: ${name}`);
        }

        return value;
    }

    function createKnowledgeController(deps = {}) {
        const escapeHtml = requireKnowledgeDependency(deps, 'escapeHtml');
        const showToast = requireKnowledgeDependency(deps, 'showToast');
        const buildNoteAnchorSnippet = requireKnowledgeDependency(deps, 'buildNoteAnchorSnippet');
        const contentContainsSnippetLoose = requireKnowledgeDependency(deps, 'contentContainsSnippetLoose');
        const openKnowledgeAtChunk = requireKnowledgeDependency(deps, 'openKnowledgeAtChunk');

        function splitKnowledgeReferencePayload(payload) {
            const raw = String(payload || '').trim();
            const commaIndex = raw.indexOf(',');

            if (commaIndex < 0) {
                return {
                    source: raw,
                    snippet: ''
                };
            }

            return {
                source: raw.slice(0, commaIndex).trim(),
                snippet: raw.slice(commaIndex + 1).trim()
            };
        }

        function clipKnowledgeReferenceLabel(text, limit = 18) {
            const value = String(text || '').replace(/\s+/g, ' ').trim();

            if (value.length <= limit) {
                return value;
            }

            return `${value.slice(0, Math.max(0, limit - 1)).trim()}...`;
        }

        function renderKnowledgeReferenceTag(payload) {
            const parsed = splitKnowledgeReferencePayload(payload);
            const source = String(parsed.source || '').trim();
            const snippet = String(parsed.snippet || '').trim();

            if (!source) {
                return escapeHtml(`[kb]${String(payload || '')}[/kb]`);
            }

            const label = clipKnowledgeReferenceLabel(source);
            const title = snippet ? `知识来源：${source}\n${snippet}` : `知识来源：${source}`;

            return [
                '<button type="button" class="kb-reference" data-kb-source="',
                escapeHtml(source),
                '" data-kb-snippet="',
                escapeHtml(snippet),
                '" title="',
                escapeHtml(title),
                '"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>',
                escapeHtml(label),
                '</span></button>'
            ].join('');
        }

        function protectKnowledgeReferencesInMarkdown(text) {
            const refs = [];
            const protectedText = String(text || '').replace(/\[kb\]([\s\S]*?)\[\/kb\]/g, (_match, payload) => {
                const index = refs.length;
                refs.push(renderKnowledgeReferenceTag(payload));
                return `@@NEXORA_KB_REF_${index}@@`;
            });

            return {
                text: protectedText,
                refs
            };
        }

        function restoreKnowledgeReferencesInHtml(html, refs = []) {
            let output = String(html || '');

            refs.forEach((refHtml, index) => {
                output = output.split(`@@NEXORA_KB_REF_${index}@@`).join(refHtml);
            });

            return output;
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
            const anchorBasisId = String((anchor && anchor.basis_id) || (anchor && anchor.basisId) || '').trim();
            const altTitle = String(fallbackTitle || '').trim();
            const directCandidates = [anchorTitle, anchorBasisId, altTitle].filter(Boolean);

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

            for (const candidate of directCandidates) {
                const matchedTitle = allTitles.find((title) => {
                    const meta = basis[title] && typeof basis[title] === 'object' ? basis[title] : {};
                    return String(meta.basis_id || '').trim() === candidate;
                });

                if (matchedTitle) {
                    const result = await fetchKnowledgeByTitle(matchedTitle);

                    if (result.ok) return result;
                }
            }

            const byNorm = new Map();
            allTitles.forEach((title) => {
                const key = normalizeKnowledgeTitleKey(title);

                if (key && !byNorm.has(key)) byNorm.set(key, title);
            });

            const needles = directCandidates
                .map((title) => normalizeKnowledgeTitleKey(title))
                .filter(Boolean);

            for (const needle of needles) {
                const exact = byNorm.get(needle);

                if (exact) {
                    const result = await fetchKnowledgeByTitle(exact);

                    if (result.ok) return result;
                }
            }

            for (const needle of needles) {
                const fuzzy = allTitles.find((title) => {
                    const key = normalizeKnowledgeTitleKey(title);
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

        return {
            splitKnowledgeReferencePayload,
            clipKnowledgeReferenceLabel,
            renderKnowledgeReferenceTag,
            protectKnowledgeReferencesInMarkdown,
            restoreKnowledgeReferencesInHtml,
            normalizeKnowledgeTitleKey,
            fetchKnowledgeByTitle,
            resolveKnowledgeSourceForJump,
            jumpToKnowledgeSource,
        };
    }

    function createKnowledgeSidebarController(deps = {}) {
        const getElements = requireKnowledgeDependency(deps, 'getElements');
        const getCurrentConversationId = requireKnowledgeDependency(deps, 'getCurrentConversationId');
        const getUploadedFileIds = requireKnowledgeDependency(deps, 'getUploadedFileIds');
        const getCurrentViewingKnowledge = requireKnowledgeDependency(deps, 'getCurrentViewingKnowledge');
        const getKnowledgeMetaCache = requireKnowledgeDependency(deps, 'getKnowledgeMetaCache');
        const setKnowledgeMetaCache = requireKnowledgeDependency(deps, 'setKnowledgeMetaCache');
        const getBasisKnowledgeListCache = requireKnowledgeDependency(deps, 'getBasisKnowledgeListCache');
        const setBasisKnowledgeListCache = requireKnowledgeDependency(deps, 'setBasisKnowledgeListCache');
        const isKnowledgeVectorizationEnabled = requireKnowledgeDependency(deps, 'isKnowledgeVectorizationEnabled');
        const setKnowledgeVectorizationEnabled = requireKnowledgeDependency(deps, 'setKnowledgeVectorizationEnabled');
        const isBulkVectorizeRunning = requireKnowledgeDependency(deps, 'isBulkVectorizeRunning');
        const showToast = requireKnowledgeDependency(deps, 'showToast');
        const updateFilePreview = requireKnowledgeDependency(deps, 'updateFilePreview');
        const showPinContextMenu = requireKnowledgeDependency(deps, 'showPinContextMenu');
        const vectorizeKnowledgeTitle = requireKnowledgeDependency(deps, 'vectorizeKnowledgeTitle');
        const getVectorizeTasks = requireKnowledgeDependency(deps, 'getVectorizeTasks');
        const registerModalBackdropStacking = requireKnowledgeDependency(deps, 'registerModalBackdropStacking');
        const bindBackdropSafeClose = requireKnowledgeDependency(deps, 'bindBackdropSafeClose');
        const handleBackdropStackingChange = requireKnowledgeDependency(deps, 'handleBackdropStackingChange');
        const showConfirm = requireKnowledgeDependency(deps, 'showConfirm');

        let blankKnowledgeTitleModalResolver = null;

        function readElements() {
            const elements = getElements();

            if (!elements || typeof elements !== 'object') {
                throw new Error('chat_knowledge 需要有效的 elements 对象');
            }

            return elements;
        }

        function ensureBlankKnowledgeTitleModal() {
            let modal = document.getElementById('blankKnowledgeTitleModal');

            if (modal) {
                return modal;
            }

            modal = document.createElement('div');
            modal.id = 'blankKnowledgeTitleModal';
            modal.className = 'modal-backdrop workspace-create-modal-backdrop';
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="modal workspace-create-modal" role="dialog" aria-modal="true" aria-labelledby="blankKnowledgeTitleModalTitle">
                    <div class="modal-head">
                        <h3 id="blankKnowledgeTitleModalTitle">新建知识库</h3>
                        <button id="blankKnowledgeTitleModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div class="modal-body workspace-create-modal-body">
                        <label class="workspace-create-field" for="blankKnowledgeTitleInput">
                            <span>标题</span>
                            <input id="blankKnowledgeTitleInput" class="input-modern" type="text" maxlength="120" placeholder="例如：讨论记录">
                        </label>
                    </div>
                    <div class="modal-footer workspace-create-modal-footer">
                        <button id="blankKnowledgeTitleModalCancelBtn" class="btn-cancel" type="button">取消</button>
                        <button id="blankKnowledgeTitleModalConfirmBtn" class="btn-confirm" type="button">创建</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            registerModalBackdropStacking(modal);
            bindBackdropSafeClose(modal, closeBlankKnowledgeTitleModal);

            modal.querySelector('#blankKnowledgeTitleModalCloseBtn')?.addEventListener('click', closeBlankKnowledgeTitleModal);
            modal.querySelector('#blankKnowledgeTitleModalCancelBtn')?.addEventListener('click', closeBlankKnowledgeTitleModal);
            modal.querySelector('#blankKnowledgeTitleModalConfirmBtn')?.addEventListener('click', submitBlankKnowledgeTitleModal);
            modal.querySelector('#blankKnowledgeTitleInput')?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitBlankKnowledgeTitleModal();
                    return;
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeBlankKnowledgeTitleModal();
                }
            });

            return modal;
        }

        function closeBlankKnowledgeTitleModal() {
            const modal = document.getElementById('blankKnowledgeTitleModal');

            if (!modal) {
                return;
            }

            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            handleBackdropStackingChange(modal);

            if (blankKnowledgeTitleModalResolver) {
                blankKnowledgeTitleModalResolver(null);
                blankKnowledgeTitleModalResolver = null;
            }
        }

        function submitBlankKnowledgeTitleModal() {
            const modal = ensureBlankKnowledgeTitleModal();
            const input = modal.querySelector('#blankKnowledgeTitleInput');
            const title = String((input && input.value) || '').trim();

            if (!title) {
                showToast('请输入知识库标题');

                if (input) {
                    input.focus();
                }

                return;
            }

            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            handleBackdropStackingChange(modal);

            if (blankKnowledgeTitleModalResolver) {
                blankKnowledgeTitleModalResolver(title);
                blankKnowledgeTitleModalResolver = null;
            }
        }

        function openBlankKnowledgeTitleModal(options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const modal = ensureBlankKnowledgeTitleModal();
            const input = modal.querySelector('#blankKnowledgeTitleInput');
            const confirmBtn = modal.querySelector('#blankKnowledgeTitleModalConfirmBtn');
            const titleEl = modal.querySelector('#blankKnowledgeTitleModalTitle');

            if (blankKnowledgeTitleModalResolver) {
                blankKnowledgeTitleModalResolver(null);
                blankKnowledgeTitleModalResolver = null;
            }

            if (titleEl) {
                titleEl.textContent = String(opts.modalTitle || '新建知识库');
            }

            if (input) {
                input.value = String(opts.defaultTitle || '').trim();
            }

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '创建';
            }

            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            handleBackdropStackingChange(modal);

            setTimeout(() => {
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 0);

            return new Promise((resolve) => {
                blankKnowledgeTitleModalResolver = resolve;
            });
        }

        function syncBulkVectorizeButtonVisibility() {
            const els = readElements();
            const btn = els.bulkVectorizeBtn || document.getElementById('bulkVectorizeBtn');

            if (!btn) {
                return;
            }

            const visible = isKnowledgeVectorizationEnabled() === true;
            btn.hidden = !visible;
            btn.disabled = !visible || isBulkVectorizeRunning();
        }

        async function loadKnowledge() {
            const els = readElements();

            try {
                const res = await fetch('/api/knowledge/sidebar');
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
                }

                setKnowledgeMetaCache((data && data.basis_knowledge) ? data.basis_knowledge : {});
                setKnowledgeVectorizationEnabled(!!(data && data.vectorization_enabled));
                syncBulkVectorizeButtonVisibility();

                const basisItems = Array.isArray(data.knowledge) ? [...data.knowledge] : [];
                setBasisKnowledgeListCache(basisItems);
                renderKnowledgeList(els.panelBasisList, basisItems, 'basis');

                if (els.panelBasisCount) {
                    els.panelBasisCount.textContent = basisItems.length;
                }

            } catch (e) {
                setKnowledgeVectorizationEnabled(false);
                syncBulkVectorizeButtonVisibility();
                console.error('Error loading knowledge', e);
            }
        }

        async function createBlankBasisKnowledge() {
            const els = readElements();

            if (!els.createBlankBasisBtn) {
                return;
            }

            if (els.createBlankBasisBtn.disabled) {
                return;
            }

            const titlePrefix = await openBlankKnowledgeTitleModal({
                modalTitle: '新建知识库',
            });

            if (!titlePrefix) {
                return;
            }

            els.createBlankBasisBtn.disabled = true;

            try {
                const res = await fetch('/api/knowledge/basis/blank', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title_prefix: titlePrefix,
                    }),
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error((data && data.message) || '空白知识库创建失败');
                }

                const title = String(data.title || '').trim();

                if (!title) {
                    throw new Error('空白知识库标题为空');
                }

                await loadKnowledge(getCurrentConversationId());
                showToast('空白知识库已创建');
                await viewKnowledge(title, {
                    forceEditMode: true,
                });
            } catch (error) {
                console.error('createBlankBasisKnowledge failed', error);
                showToast(String((error && error.message) || '空白知识库创建失败'));
            } finally {
                els.createBlankBasisBtn.disabled = false;
            }
        }

        async function attachKnowledgeToComposer(title, type = 'basis', shortContent = '') {
            const els = readElements();
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

            const uploadedFileIds = getUploadedFileIds();
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

            if (els.messageInput) {
                els.messageInput.focus();
            }

            showToast('已附加知识内容');
        }

        function renderKnowledgeList(container, items, type) {
            if (!container) return;

            container.innerHTML = '';

            const knowledgeMetaCache = getKnowledgeMetaCache();
            const vectorizeTasks = getVectorizeTasks();
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

                const titleText = document.createElement('span');
                titleText.className = 'knowledge-item-title-text';
                titleText.textContent = type === 'short' ? shortContent : rawTitle;
                label.appendChild(titleText);
                row.appendChild(label);

                const actions = document.createElement('div');
                actions.className = 'knowledge-item-actions';

                if (type === 'basis') {
                    const progress = document.createElement('div');
                    progress.className = 'knowledge-progress';
                    div.appendChild(progress);

                    const meta = knowledgeMetaCache[rawTitle] || {};
                    const vectorExists = (typeof meta.vector_exists === 'boolean') ? meta.vector_exists : true;
                    const needVectorRefresh = isKnowledgeVectorizationEnabled() && meta.needs_vector_refresh === true;

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

        function confirmDeleteKnowledge(title, type = 'basis') {
            showConfirm(
                '删除知识点',
                `确定要删除「${title}」吗？此操作无法撤销。`,
                'danger',
                async () => {
                    await deleteKnowledge(title, type);
                }
            );
        }

        async function deleteKnowledge(title, type = 'basis') {
            try {
                const endpoint = type === 'basis'
                    ? `/api/knowledge/basis/${encodeURIComponent(title)}`
                    : `/api/knowledge/short/${encodeURIComponent(title)}`;
                const response = await fetch(endpoint, {
                    method: 'DELETE'
                });
                const data = await response.json();

                if (!data.success) {
                    console.error('删除失败:', data.message);
                    showToast((data && (data.error || data.message)) ? (data.error || data.message) : '删除失败');
                    return;
                }

                if (getCurrentViewingKnowledge() === title) {
                    closeKnowledgeView();
                }

                loadKnowledge(getCurrentConversationId());
                showToast('删除成功');
            } catch (e) {
                console.error('删除知识点失败:', e);
                showToast('删除失败');
            }
        }

        function setBasisPinLocal(title, pin) {
            const els = readElements();
            const safeTitle = String(title || '').trim();

            if (!safeTitle) return false;

            let found = false;
            const source = Array.isArray(getBasisKnowledgeListCache()) ? getBasisKnowledgeListCache() : [];
            const nextItems = source.map((item) => {
                const src = (item && typeof item === 'object') ? item : {};
                const itemTitle = String((src && src.title) || (typeof item === 'string' ? item : '')).trim();

                if (itemTitle !== safeTitle) return item;

                found = true;

                return {
                    ...(src || {}),
                    title: itemTitle,
                    content: String((src && src.content) || itemTitle),
                    pin: !!pin
                };
            });

            setBasisKnowledgeListCache(nextItems);

            if (!found) return false;

            const metaCache = getKnowledgeMetaCache();
            const nextMetaCache = (metaCache && typeof metaCache === 'object') ? metaCache : {};

            if (!nextMetaCache[safeTitle] || typeof nextMetaCache[safeTitle] !== 'object') {
                nextMetaCache[safeTitle] = {};
            }

            nextMetaCache[safeTitle].pin = !!pin;
            setKnowledgeMetaCache(nextMetaCache);
            renderKnowledgeList(els.panelBasisList, nextItems, 'basis');
            return true;
        }

        return {
            ensureBlankKnowledgeTitleModal,
            closeBlankKnowledgeTitleModal,
            submitBlankKnowledgeTitleModal,
            openBlankKnowledgeTitleModal,
            syncBulkVectorizeButtonVisibility,
            loadKnowledge,
            createBlankBasisKnowledge,
            attachKnowledgeToComposer,
            renderKnowledgeList,
            confirmDeleteKnowledge,
            deleteKnowledge,
            setBasisPinLocal,
        };
    }

    async function createKnowledgeVectorizeTask(title, library = 'knowledge') {
        const res = await fetch('/api/knowledge/vector/tasks', {
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

    async function pollKnowledgeVectorTask(taskId, onProgress) {
        const safeTaskId = String(taskId || '').trim();

        if (!safeTaskId) {
            throw new Error('任务ID为空');
        }

        const maxRounds = 1200;

        for (let i = 0; i < maxRounds; i += 1) {
            const res = await fetch(`/api/knowledge/vector/tasks/${encodeURIComponent(safeTaskId)}`, {
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

            if (typeof onProgress === 'function') {
                onProgress({ status, stage, progress, task });
            }

            if (status === 'completed') {
                return task;
            }

            if (status === 'failed') {
                throw new Error(task.error || task.message || '任务失败');
            }

            if (status === 'cancelled') {
                throw new Error(task.message || '任务已取消');
            }

            await new Promise((resolve) => setTimeout(resolve, 400));
        }

        throw new Error('任务超时');
    }

    function createKnowledgeVectorController(deps = {}) {
        const getElements = requireKnowledgeDependency(deps, 'getElements');
        const getCurrentConversationId = requireKnowledgeDependency(deps, 'getCurrentConversationId');
        const getCurrentViewingKnowledge = requireKnowledgeDependency(deps, 'getCurrentViewingKnowledge');
        const getKnowledgeMetaCache = requireKnowledgeDependency(deps, 'getKnowledgeMetaCache');
        const isKnowledgeVectorizationEnabled = requireKnowledgeDependency(deps, 'isKnowledgeVectorizationEnabled');
        const setKnowledgeVectorizationEnabled = requireKnowledgeDependency(deps, 'setKnowledgeVectorizationEnabled');
        const setBulkVectorizeRunning = requireKnowledgeDependency(deps, 'setBulkVectorizeRunning');
        const showToast = requireKnowledgeDependency(deps, 'showToast');
        const confirmModalAsync = requireKnowledgeDependency(deps, 'confirmModalAsync');
        const syncBulkVectorizeButtonVisibility = requireKnowledgeDependency(deps, 'syncBulkVectorizeButtonVisibility');
        const loadKnowledge = requireKnowledgeDependency(deps, 'loadKnowledge');
        const escapeCssSelector = requireKnowledgeDependency(deps, 'escapeCssSelector');
        const createKnowledgeVectorizeTask = requireKnowledgeDependency(deps, 'createKnowledgeVectorizeTask');
        const pollKnowledgeVectorTask = requireKnowledgeDependency(deps, 'pollKnowledgeVectorTask');

        let vectorProgressTimer = null;
        let vectorizeRunId = 0;
        let vectorizeTitle = null;
        const vectorizeTasks = {};

        function getVectorizeTasks() {
            return vectorizeTasks;
        }

        function getVectorizeTitle() {
            return vectorizeTitle;
        }

        function setVectorizeTitle(title) {
            vectorizeTitle = title;
        }

        function nextVectorizeRunId() {
            vectorizeRunId += 1;
            return vectorizeRunId;
        }

        function getVectorizeRunId() {
            return vectorizeRunId;
        }

        function setVectorStatus(text) {
            const el = document.getElementById('vectorStatusText');

            if (el) el.textContent = text;
        }

        function setKnowledgeItemProgress(title, percent, active = true, stage = 'vectorizing') {
            const els = getElements();
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

        async function bulkVectorizeAllBasis() {
            setBulkVectorizeRunning(true);
            syncBulkVectorizeButtonVisibility();
            showToast('开始批量向量化');

            try {
                const metaRes = await fetch('/api/knowledge/list');
                const metaData = await metaRes.json();
                setKnowledgeVectorizationEnabled(!!(metaData && metaData.vectorization_enabled));
                syncBulkVectorizeButtonVisibility();

                if (!isKnowledgeVectorizationEnabled()) {
                    showToast('知识向量化未启用或未配置');
                    setBulkVectorizeRunning(false);
                    syncBulkVectorizeButtonVisibility();
                    return;
                }

                const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
                const els = getElements();
                const listEls = els.panelBasisList ? Array.from(els.panelBasisList.querySelectorAll('.knowledge-item')) : [];
                const titles = listEls.length > 0 ? listEls.map(el => el.dataset.title).filter(Boolean) : Object.keys(basisMeta);

                if (titles.length === 0) {
                    showToast('没有可向量化的知识点');
                    setBulkVectorizeRunning(false);
                    syncBulkVectorizeButtonVisibility();
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
                setBulkVectorizeRunning(false);
                syncBulkVectorizeButtonVisibility();
                loadKnowledge(getCurrentConversationId());
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
                const task = await pollKnowledgeVectorTask(taskId, ({ status, progress, task }) => {
                    if (status === 'completed') return;

                    // 后端进度为 12-96，前端知识条映射到 1-99。
                    let pct = 1;

                    if (progress <= 12) pct = 1;
                    else if (progress >= 96) pct = 99;
                    else pct = Math.max(1, Math.min(99, Math.round(((progress - 12) / 84) * 100)));

                    setKnowledgeItemProgress(title, pct, true, 'vectorizing');

                    if (onProgress) onProgress(pct, String((task && task.message) || '向量化中'));
                });

                const result = (task && task.result) ? task.result : {};
                const storedCount = Number(result.stored_count || 0);
                const knowledgeMetaCache = getKnowledgeMetaCache();

                if (knowledgeMetaCache[title]) {
                    const updatedAt = Number(knowledgeMetaCache[title].updated_at || 0);
                    knowledgeMetaCache[title].vector_updated_at = Math.max(updatedAt, Date.now());
                    knowledgeMetaCache[title].vector_exists = true;
                    knowledgeMetaCache[title].needs_vector_refresh = false;
                }

                const els = getElements();
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

        function startVectorProgress(total) {
            const wrap = document.getElementById('vectorProgressWrap');
            const bar = document.getElementById('vectorProgressBar');
            const text = document.getElementById('vectorProgressText');

            if (!wrap || !bar || !text) return;

            wrap.style.display = 'block';
            bar.style.width = '0%';

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
            nextVectorizeRunId();
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
                const res = await fetch(`/api/knowledge/vector/chunks/${encodeURIComponent(vectorId)}`, {
                    method: 'DELETE'
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
            const els = getElements();
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

                list.innerHTML = '';
                chunks.forEach((chunk) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'padding:6px 0; border-bottom:1px dashed #e2e8f0; display:flex; gap:8px; align-items:flex-start; justify-content: space-between;';

                    const body = document.createElement('div');
                    body.style.cssText = 'flex:1;';

                    const indexEl = document.createElement('div');
                    indexEl.style.cssText = 'font-weight:600;';
                    indexEl.textContent = `Chunk ${chunk.chunk_id != null ? chunk.chunk_id : '-'}`;

                    const previewEl = document.createElement('div');
                    previewEl.style.cssText = 'color:#64748b; font-size:12px; word-break: break-word;';
                    previewEl.textContent = String(chunk.text == null ? '' : chunk.text).slice(0, 80);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'btn-primary';
                    deleteBtn.style.cssText = 'background:#ef4444; padding: 4px 8px; font-size: 11px;';
                    deleteBtn.textContent = '删除';

                    // 使用事件绑定避免标题或向量 ID 中的引号破坏内联 JS。
                    deleteBtn.addEventListener('click', () => {
                        deleteVectorChunk(String(chunk.id == null ? '' : chunk.id), title);
                    });

                    body.appendChild(indexEl);
                    body.appendChild(previewEl);
                    row.appendChild(body);
                    row.appendChild(deleteBtn);
                    list.appendChild(row);
                });
                setVectorStatus(`已加载 ${chunks.length} 块`);
            } catch (e) {
                list.innerHTML = `<div style="color:#ef4444;">加载失败: ${e.message}</div>`;
                setVectorStatus('加载失败');
            }
        }

        return {
            getVectorizeTasks,
            getVectorizeTitle,
            setVectorizeTitle,
            nextVectorizeRunId,
            getVectorizeRunId,
            setVectorStatus,
            setKnowledgeItemProgress,
            bulkVectorizeAllBasis,
            vectorizeKnowledgeTitle,
            startVectorProgress,
            updateVectorProgress,
            stopVectorProgress,
            cancelVectorizeProgress,
            resetVectorProgressUI,
            deleteVectorChunk,
            setKnowledgeItemVectorButtonState,
            setKnowledgeItemVectorState,
            loadVectorChunks,
        };
    }

    function createKnowledgeSettingsController(deps = {}) {
        const getCurrentViewingKnowledge = requireKnowledgeDependency(deps, 'getCurrentViewingKnowledge');
        const getCurrentUsername = requireKnowledgeDependency(deps, 'getCurrentUsername');
        const ensureCurrentUser = requireKnowledgeDependency(deps, 'ensureCurrentUser');
        const getActiveWorkspaceKnowledgeContext = requireKnowledgeDependency(deps, 'getActiveWorkspaceKnowledgeContext');
        const getWorkspaceKnowledgeRequestFields = requireKnowledgeDependency(deps, 'getWorkspaceKnowledgeRequestFields');
        const appendWorkspaceKnowledgeQuery = requireKnowledgeDependency(deps, 'appendWorkspaceKnowledgeQuery');
        const getKnowledgeMetaCache = requireKnowledgeDependency(deps, 'getKnowledgeMetaCache');
        const getCurrentConversationId = requireKnowledgeDependency(deps, 'getCurrentConversationId');
        const showToast = requireKnowledgeDependency(deps, 'showToast');
        const loadKnowledge = requireKnowledgeDependency(deps, 'loadKnowledge');
        const loadVectorChunks = requireKnowledgeDependency(deps, 'loadVectorChunks');
        const resetVectorProgressUI = requireKnowledgeDependency(deps, 'resetVectorProgressUI');
        const setVectorStatus = requireKnowledgeDependency(deps, 'setVectorStatus');
        const getVectorizeTitle = requireKnowledgeDependency(deps, 'getVectorizeTitle');
        const setVectorizeTitle = requireKnowledgeDependency(deps, 'setVectorizeTitle');
        const _startOwnerKnowledgeCollab = requireKnowledgeDependency(deps, 'startOwnerKnowledgeCollab');
        const _stopKnowledgeCollab = requireKnowledgeDependency(deps, 'stopKnowledgeCollab');

        let knowledgeSettingsVectorLoadedTitle = '';

        function getActiveKnowledgeShareUsername() {
            const context = getActiveWorkspaceKnowledgeContext();

            if (context && context.user) {
                return context.user;
            }

            return String(getCurrentUsername() || '').trim();
        }

        function buildKnowledgeShareUrl(shareId) {
            const safeShareId = String(shareId || '').trim();
            const shareUsername = getActiveKnowledgeShareUsername();

            if (!safeShareId || !shareUsername) {
                return '';
            }

            return `${window.location.origin}/public/knowledge/${shareUsername}/${safeShareId}`;
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

        function applyKnowledgeSettingsMetadata(title, metadata = {}) {
            const safeTitle = String(title || '').trim();
            const meta = (metadata && typeof metadata === 'object') ? metadata : {};

            const titleInput = document.getElementById('settingTargetTitle');
            const publicInput = document.getElementById('settingPublic');
            const collaborativeInput = document.getElementById('settingCollaborative');
            const readonlyInput = document.getElementById('settingModelReadonly');
            const lastModify = document.getElementById('lastModifyTime');

            if (titleInput) titleInput.value = safeTitle;
            if (publicInput) publicInput.checked = !!meta.public;
            if (collaborativeInput) collaborativeInput.checked = !!meta.collaborative;
            if (readonlyInput) readonlyInput.checked = meta.model_readonly === true;

            const shareUrl = buildKnowledgeShareUrl(meta.share_id || '');
            setShareLinkDisplay(shareUrl, !!meta.public);

            if (lastModify) {
                if (meta.updated_at) {
                    lastModify.textContent = new Date(Number(meta.updated_at) * 1000).toLocaleString();
                } else {
                    lastModify.textContent = '-';
                }
            }
        }

        function resetKnowledgeSettingsVectorPanel() {
            knowledgeSettingsVectorLoadedTitle = '';
            resetVectorProgressUI();
            setVectorStatus('进入向量页后加载');

            const list = document.getElementById('vectorChunkList');

            if (list) {
                list.innerHTML = '<div style="color:#94a3b8;">进入向量页后加载分块</div>';
            }
        }

        function ensureKnowledgeSettingsVectorLoaded() {
            const titleInput = document.getElementById('settingTargetTitle');
            const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : getCurrentViewingKnowledge();
            const safeTitle = String(liveTitle || '').trim();

            if (!safeTitle || knowledgeSettingsVectorLoadedTitle === safeTitle) {
                return;
            }

            knowledgeSettingsVectorLoadedTitle = safeTitle;
            loadVectorChunks(safeTitle);
        }

        async function refreshKnowledgeSettingsMetadata(title) {
            const safeTitle = String(title || '').trim();

            if (!safeTitle) return;

            try {
                if (!getCurrentUsername()) {
                    await ensureCurrentUser();
                }

                const listUrl = appendWorkspaceKnowledgeQuery('/api/knowledge/list', safeTitle);
                const resMeta = await fetch(listUrl);
                const metaData = await resMeta.json();
                const metadata = metaData && metaData.basis_knowledge ? metaData.basis_knowledge[safeTitle] : null;

                if (!metadata) {
                    return;
                }

                const knowledgeMetaCache = getKnowledgeMetaCache();
                knowledgeMetaCache[safeTitle] = metadata;

                const titleInput = document.getElementById('settingTargetTitle');
                const modalTitle = titleInput ? String(titleInput.value || '').trim() : safeTitle;

                if (String(getCurrentViewingKnowledge() || '').trim() === safeTitle && modalTitle === safeTitle) {
                    applyKnowledgeSettingsMetadata(safeTitle, metadata);
                }
            } catch (e) {
                console.error(e);
            }
        }

        function openKnowledgeSettingsModal() {
            const currentViewingKnowledge = getCurrentViewingKnowledge();

            if (!currentViewingKnowledge) return;

            const title = currentViewingKnowledge;
            const knowledgeMetaCache = getKnowledgeMetaCache();
            const metadata = (knowledgeMetaCache && knowledgeMetaCache[title] && typeof knowledgeMetaCache[title] === 'object')
                ? knowledgeMetaCache[title]
                : {};

            applyKnowledgeSettingsMetadata(title, metadata);
            initKnowledgeSettingsTabs();
            setKnowledgeSettingsActiveTab('ks-basic');

            if (getVectorizeTitle() && getVectorizeTitle() !== title) {
                resetVectorProgressUI();
            }

            setVectorizeTitle(title);
            resetKnowledgeSettingsVectorPanel();

            const modal = document.getElementById('knowledgeSettingsModal');

            if (modal) modal.classList.add('active');

            void refreshKnowledgeSettingsMetadata(title);
        }

        function closeKnowledgeSettingsModal() {
            const modal = document.getElementById('knowledgeSettingsModal');

            if (modal) modal.classList.remove('active');

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
                    if (target === 'ks-vector') {
                        ensureKnowledgeSettingsVectorLoaded();
                    }
                });
            });
        }

        function setKnowledgeSettingsActiveTab(target) {
            const modal = document.getElementById('knowledgeSettingsModal');

            if (!modal) return;

            const safeTarget = String(target || 'ks-basic').trim() || 'ks-basic';
            const tabs = modal.querySelectorAll('.admin-tab');
            const contents = modal.querySelectorAll('.admin-tab-content');

            tabs.forEach((tab) => {
                tab.classList.toggle('active', String(tab.getAttribute('data-tab') || '') === safeTarget);
            });

            contents.forEach((content) => {
                content.classList.remove('active');
            });

            const panel = modal.querySelector(`#${safeTarget}-tab`);

            if (panel) panel.classList.add('active');
            if (safeTarget === 'ks-vector') {
                ensureKnowledgeSettingsVectorLoaded();
            }
        }

        async function applyKnowledgeSettings() {
            const oldTitle = getCurrentViewingKnowledge();
            const workspaceContext = getActiveWorkspaceKnowledgeContext();
            const newTitle = document.getElementById('settingTargetTitle').value.trim();
            const isPublic = document.getElementById('settingPublic').checked;
            const isCollaborative = document.getElementById('settingCollaborative').checked;
            const isModelReadonly = document.getElementById('settingModelReadonly').checked;

            if (!newTitle) return showToast('标题不能为空');

            try {
                const res = await fetch('/api/knowledge/settings', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        title: oldTitle,
                        new_title: newTitle,
                        public: isPublic,
                        collaborative: isCollaborative,
                        model_readonly: isModelReadonly,
                        ...getWorkspaceKnowledgeRequestFields(),
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('设置已更新');

                    if (newTitle !== oldTitle) {
                        closeKnowledgeSettingsModal();
                        await viewKnowledge(newTitle, {
                            workspaceContext,
                        });
                    } else {
                        const shareUrl = data.share_url || '';
                        setShareLinkDisplay(shareUrl, isPublic);

                        const knowledgeMetaCache = getKnowledgeMetaCache();

                        if (knowledgeMetaCache[oldTitle]) {
                            knowledgeMetaCache[oldTitle].public = isPublic;
                            knowledgeMetaCache[oldTitle].collaborative = isCollaborative;
                            knowledgeMetaCache[oldTitle].model_readonly = isModelReadonly;
                        }

                        const liveMeta = knowledgeMetaCache[oldTitle] || {};

                        if (isPublic && isCollaborative) {
                            _startOwnerKnowledgeCollab(oldTitle, liveMeta);
                        } else {
                            _stopKnowledgeCollab();
                        }
                    }

                    if (!workspaceContext) {
                        loadKnowledge(getCurrentConversationId());
                    }
                } else {
                    showToast('更新失败: ' + data.message);
                }
            } catch(e) {
                showToast('网络错: ' + e.message);
            }
        }

        function copyShareUrl() {
            const input = document.getElementById('shareUrlDisplay');

            if (!input) return;

            input.select();
            document.execCommand('copy');
            showToast('链接已复制');
        }

        return {
            getActiveKnowledgeShareUsername,
            buildKnowledgeShareUrl,
            applyKnowledgeSettingsMetadata,
            resetKnowledgeSettingsVectorPanel,
            ensureKnowledgeSettingsVectorLoaded,
            refreshKnowledgeSettingsMetadata,
            openKnowledgeSettingsModal,
            closeKnowledgeSettingsModal,
            initKnowledgeSettingsTabs,
            setShareLinkDisplay,
            applyKnowledgeSettings,
            copyShareUrl,
            setKnowledgeSettingsActiveTab,
        };
    }

    function createKnowledgeWorkspaceController(deps = {}) {
        const getKnowledgeWorkspaceReturnContext = requireKnowledgeDependency(deps, 'getKnowledgeWorkspaceReturnContext');
        const getCurrentUsername = requireKnowledgeDependency(deps, 'getCurrentUsername');

        function getActiveWorkspaceKnowledgeContext() {
            const knowledgeWorkspaceReturnContext = getKnowledgeWorkspaceReturnContext();

            if (!knowledgeWorkspaceReturnContext || typeof knowledgeWorkspaceReturnContext !== 'object') {
                return null;
            }

            const workspaceId = String(knowledgeWorkspaceReturnContext.workspaceId || '').trim();
            const user = String(knowledgeWorkspaceReturnContext.user || '').trim();

            if (!workspaceId || !user) {
                return null;
            }

            return {
                workspaceId,
                workspaceTitle: String(knowledgeWorkspaceReturnContext.workspaceTitle || '').trim(),
                user,
            };
        }

        function getWorkspaceKnowledgeRequestFields() {
            const context = getActiveWorkspaceKnowledgeContext();

            if (!context) {
                return {};
            }

            return {
                workspace_id: context.workspaceId,
                workspace: context.workspaceId,
                workspaces: context.workspaceId,
                user: context.user,
            };
        }

        function appendWorkspaceKnowledgeQuery(url, title = '') {
            const fields = getWorkspaceKnowledgeRequestFields();
            const keys = Object.keys(fields);

            if (!keys.length) {
                return url;
            }

            const params = new URLSearchParams();
            keys.forEach((key) => {
                params.set(key, fields[key]);
            });

            if (title) {
                params.set('title', title);
            }

            return `${url}?${params.toString()}`;
        }

        function getActiveKnowledgeShareUsername() {
            const context = getActiveWorkspaceKnowledgeContext();

            if (context && context.user) {
                return context.user;
            }

            return String(getCurrentUsername() || '').trim();
        }

        return {
            getActiveWorkspaceKnowledgeContext,
            getWorkspaceKnowledgeRequestFields,
            appendWorkspaceKnowledgeQuery,
            getActiveKnowledgeShareUsername,
        };
    }

    function createKnowledgeEditorState() {
        return {
            editor: null,
            currentTitle: null,
            currentVersion: null,
            pendingLocalSaves: Object.create(null),
            savingTitles: Object.create(null),
            queuedSaveTitles: Object.create(null),
            collabClient: null,
            collabTitle: '',
            collabApplyingRemote: false,
            collabCursorOverlay: null,
            collabOfflineMask: null,
            workspaceReturnContext: null,
            pendingHighlightData: null,
            scroll: {
                activeTitle: '',
                byTitle: Object.create(null),
                syncLock: false,
                delegatedBound: false,
                pendingToggleSnapshot: null,
                modeSwitchActive: false,
                restoreTimeouts: [],
                lastSource: null,
                resetTimer: null,
                // 打开/切换后的稳定窗口截止时间戳。窗口内的非用户滚动会立即吸附回
                // 目标位置，避免异步预览渲染把预览甩离目标（产生跳底闪烁）
                settleUntil: 0,
                // 当前恢复目标，供稳定窗口内滚动监听即时吸附复用
                targetTop: 0,
                targetRatio: 0,
                targetIsPreview: true,
                // 最近一次用户输入（wheel/touch/pointer/keydown）时间戳，用于区分
                // 用户滚动与渲染引起的滚动
                lastUserInputAt: 0
            },
            hooks: {
                previewInstalled: false,
                toolbarInstalled: false
            },
            align: {
                widgets: [],
                debounce: null,
                retryTimers: [],
                runToken: 0,
                lastRunAt: 0,
                busy: false,
                lastInputAt: 0,
                scrollMap: null
            }
        };
    }

    function createKnowledgeEditorController(deps = {}) {
        const state = createKnowledgeEditorState();

        const getPreviewEl = requireKnowledgeDependency(deps, 'getPreviewEl');
        const getScrollerEl = requireKnowledgeDependency(deps, 'getScrollerEl');
        const getProseMirrorEl = requireKnowledgeDependency(deps, 'getProseMirrorEl');
        const getViewerEl = requireKnowledgeDependency(deps, 'getViewerEl');
        const logDebug = requireKnowledgeDependency(deps, 'logDebug');
        const collectLayoutSnapshot = requireKnowledgeDependency(deps, 'collectLayoutSnapshot');
        const summarizeNode = requireKnowledgeDependency(deps, 'summarizeNode');
        const getPendingImageUploadCount = requireKnowledgeDependency(deps, 'getPendingImageUploadCount');
        const getWorkspaceKnowledgeRequestFields = requireKnowledgeDependency(deps, 'getWorkspaceKnowledgeRequestFields');
        const appendWorkspaceKnowledgeQuery = requireKnowledgeDependency(deps, 'appendWorkspaceKnowledgeQuery');
        const getActiveWorkspaceKnowledgeContext = requireKnowledgeDependency(deps, 'getActiveWorkspaceKnowledgeContext');
        const getKnowledgeMetaCache = requireKnowledgeDependency(deps, 'getKnowledgeMetaCache');
        const getCurrentConversationId = requireKnowledgeDependency(deps, 'getCurrentConversationId');
        const getCurrentUsername = requireKnowledgeDependency(deps, 'getCurrentUsername');
        const loadKnowledge = requireKnowledgeDependency(deps, 'loadKnowledge');
        const showToast = requireKnowledgeDependency(deps, 'showToast');
        const bindSourceMarkdown = requireKnowledgeDependency(deps, 'bindSourceMarkdown');
        const renderMathSafe = requireKnowledgeDependency(deps, 'renderMathSafe');
        const isDebugEnabled = requireKnowledgeDependency(deps, 'isDebugEnabled');
        const escapeRegexPattern = requireKnowledgeDependency(deps, 'escapeRegexPattern');
        const normalizeUploadFile = requireKnowledgeDependency(deps, 'normalizeUploadFile');
        const normalizeKnowledgeImageFileName = requireKnowledgeDependency(deps, 'normalizeKnowledgeImageFileName');
        const allocateKnowledgeImageSlot = requireKnowledgeDependency(deps, 'allocateKnowledgeImageSlot');
        const uploadKnowledgeImageByFile = requireKnowledgeDependency(deps, 'uploadKnowledgeImageByFile');
        const buildKnowledgeImagePlaceholderToken = requireKnowledgeDependency(deps, 'buildKnowledgeImagePlaceholderToken');
        const buildKnowledgeImagePlaceholderMarkdown = requireKnowledgeDependency(deps, 'buildKnowledgeImagePlaceholderMarkdown');
        const normalizeKnowledgeImageAltText = requireKnowledgeDependency(deps, 'normalizeKnowledgeImageAltText');
        const trackPendingImageUpload = requireKnowledgeDependency(deps, 'trackPendingImageUpload');
        const releasePendingImageUpload = requireKnowledgeDependency(deps, 'releasePendingImageUpload');
        const extractFilesFromClipboardEvent = requireKnowledgeDependency(deps, 'extractFilesFromClipboardEvent');
        const knowledgeImagePendingAlt = String(deps.knowledgeImagePendingAlt || '').trim();
        const knowledgeImageFailedAlt = String(deps.knowledgeImageFailedAlt || '').trim();
        const normalizeWorkspaceConversationHeaderContext = requireKnowledgeDependency(deps, 'normalizeWorkspaceConversationHeaderContext');
        const restoreWorkspaceDetailInputContainer = requireKnowledgeDependency(deps, 'restoreWorkspaceDetailInputContainer');
        const getOriginalHeaderState = requireKnowledgeDependency(deps, 'getOriginalHeaderState');
        const setOriginalHeaderState = requireKnowledgeDependency(deps, 'setOriginalHeaderState');
        const getNavigationStack = requireKnowledgeDependency(deps, 'getNavigationStack');
        const setNavigationStack = requireKnowledgeDependency(deps, 'setNavigationStack');
        const saveCurrentViewerState = requireKnowledgeDependency(deps, 'saveCurrentViewerState');
        const getElements = requireKnowledgeDependency(deps, 'getElements');
        const syncTurnIndicatorVisibility = requireKnowledgeDependency(deps, 'syncTurnIndicatorVisibility');
        const applyDesktopHeaderTools = requireKnowledgeDependency(deps, 'applyDesktopHeaderTools');
        const hideFileCenterContextMenu = requireKnowledgeDependency(deps, 'hideFileCenterContextMenu');
        const closeFileCenterSortDropdown = requireKnowledgeDependency(deps, 'closeFileCenterSortDropdown');
        const exitLearningFeedComposeMode = requireKnowledgeDependency(deps, 'exitLearningFeedComposeMode');
        const getCurrentSearchQuery = requireKnowledgeDependency(deps, 'getCurrentSearchQuery');
        const setLastKnowledgeSearchResults = requireKnowledgeDependency(deps, 'setLastKnowledgeSearchResults');
        const renderSearchResultsFromCache = requireKnowledgeDependency(deps, 'renderSearchResultsFromCache');
        const escapeHtml = requireKnowledgeDependency(deps, 'escapeHtml');
        const selectWorkspaceProject = requireKnowledgeDependency(deps, 'selectWorkspaceProject');
        const resizeMessageInput = requireKnowledgeDependency(deps, 'resizeMessageInput');
        const restoreHeaderState = requireKnowledgeDependency(deps, 'restoreHeaderState');
        const getChatHeaderBaseState = requireKnowledgeDependency(deps, 'getChatHeaderBaseState');
        const clearMailViewUrl = requireKnowledgeDependency(deps, 'clearMailViewUrl');
        const syncLearningHeaderMode = requireKnowledgeDependency(deps, 'syncLearningHeaderMode');

        if (!knowledgeImagePendingAlt || !knowledgeImageFailedAlt) {
            throw new Error('chat_knowledge 缺少知识图片上传状态文案');
        }

        function readCurrentVersion() {
            const version = state.currentVersion && typeof state.currentVersion === 'object'
                ? state.currentVersion
                : {};

            return {
                contentRevision: String(version.contentRevision || version.content_revision || '').trim(),
                contentHash: String(version.contentHash || version.content_hash || '').trim(),
                updatedAt: version.updatedAt || version.updated_at || 0,
                basisId: String(version.basisId || version.basis_id || '').trim(),
                syncedContent: String(version.syncedContent || ''),
            };
        }

        function setCurrentVersion(payload = {}, syncedContent = null) {
            const data = payload && typeof payload === 'object' ? payload : {};
            const prev = readCurrentVersion();

            state.currentVersion = {
                title: String(data.title || state.currentTitle || '').trim(),
                contentRevision: String(data.content_revision || data.contentRevision || prev.contentRevision || '').trim(),
                contentHash: String(data.content_hash || data.contentHash || prev.contentHash || '').trim(),
                updatedAt: data.updated_at || data.updatedAt || prev.updatedAt || 0,
                basisId: String(data.basis_id || data.basisId || prev.basisId || '').trim(),
                syncedContent: syncedContent == null ? prev.syncedContent : String(syncedContent || ''),
            };

            return state.currentVersion;
        }

        function escapeKnowledgeCollabHtml(value) {
            return String(value || '').replace(/[&<>"']/g, (ch) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[ch]));
        }

        function stopKnowledgeCollab() {
            if (state.collabClient) {
                state.collabClient.stop();
            }

            clearOwnerKnowledgeCollabCursorMarkers();

            if (state.collabOfflineMask) {
                state.collabOfflineMask.hide();
            }

            state.collabClient = null;
            state.collabTitle = '';
            state.collabApplyingRemote = false;

            const members = document.getElementById('ownerKnowledgeCollabMembers');

            if (members) {
                members.innerHTML = '';
            }
        }

        function clearOwnerKnowledgeCollabCursorMarkers() {
            if (state.collabCursorOverlay) {
                state.collabCursorOverlay.clear();
            }
        }

        function getOwnerKnowledgeCollabCursorColor(clientId) {
            const palette = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#be123c'];
            const key = String(clientId || '');
            let hash = 0;

            for (let i = 0; i < key.length; i += 1) {
                hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
            }

            return palette[hash % palette.length];
        }

        function getOwnerKnowledgeCollabOfflineMask() {
            if (
                !state.collabOfflineMask
                && window.NexoraKnowledgeCollab
                && typeof window.NexoraKnowledgeCollab.createOfflineMask === 'function'
            ) {
                state.collabOfflineMask = window.NexoraKnowledgeCollab.createOfflineMask(() => (
                    document.querySelector('#knowledgeEditor .toastui-editor-md-container')
                    || document.getElementById('knowledgeEditor')
                ));
            }

            return state.collabOfflineMask;
        }

        function getOwnerKnowledgeCollabCursorOverlay() {
            if (
                !state.collabCursorOverlay
                && window.NexoraKnowledgeCollab
                && typeof window.NexoraKnowledgeCollab.createToastCursorOverlay === 'function'
            ) {
                state.collabCursorOverlay = window.NexoraKnowledgeCollab.createToastCursorOverlay({
                    getEditor: () => {
                        const editor = getEditor();
                        return editor && editor.__editor ? editor.__editor : null;
                    },
                    getHost: () => (
                        document.querySelector('#knowledgeEditor .toastui-editor-md-container')
                        || document.getElementById('knowledgeEditor')
                    ),
                    getColor: getOwnerKnowledgeCollabCursorColor,
                    getName: (member) => (
                        String(member.display_name || (member.role === 'owner' ? getCurrentUsername() : '匿名协作者')).trim() || '协作者'
                    ),
                });
            }

            return state.collabCursorOverlay;
        }

        function renderOwnerKnowledgeCollabCursors(members, selfClientId) {
            const overlay = getOwnerKnowledgeCollabCursorOverlay();

            if (overlay) {
                overlay.render(members, selfClientId);
            }
        }

        function renderOwnerKnowledgeCollabMembers(members, selfClientId) {
            const host = document.getElementById('ownerKnowledgeCollabMembers');

            if (!host) return;

            const list = Array.isArray(members) ? members : [];

            host.innerHTML = list.map((member) => {
                const name = String(member.display_name || (member.role === 'owner' ? getCurrentUsername() : '匿名协作者')).trim();
                const cursor = member.cursor && typeof member.cursor === 'object' ? member.cursor : null;
                const cursorText = cursor ? `L${Number(cursor.line || 0) + 1}:C${Number(cursor.col || 0) + 1}` : '在线';
                const isSelf = String(member.client_id || '') === String(selfClientId || '');

                return [
                    '<span class="knowledge-collab-member',
                    isSelf ? ' is-self' : '',
                    '"><span class="knowledge-collab-dot"></span><span class="knowledge-collab-name">',
                    escapeKnowledgeCollabHtml(name),
                    '</span><span class="knowledge-collab-cursor">',
                    escapeKnowledgeCollabHtml(cursorText),
                    '</span></span>'
                ].join('');
            }).join('');
        }

        function getOwnerEditorCursorOffset() {
            const editor = getEditor();
            const rawEditor = editor && editor.__editor ? editor.__editor : null;

            if (
                rawEditor
                && window.NexoraKnowledgeCollab
                && typeof window.NexoraKnowledgeCollab.getToastSelectionOffsets === 'function'
            ) {
                return window.NexoraKnowledgeCollab.getToastSelectionOffsets(rawEditor).head;
            }

            return 0;
        }

        function getOwnerEditorCursorAnchor() {
            const editor = getEditor();
            const rawEditor = editor && editor.__editor ? editor.__editor : null;

            if (
                rawEditor
                && window.NexoraKnowledgeCollab
                && typeof window.NexoraKnowledgeCollab.getToastSelectionOffsets === 'function'
            ) {
                return window.NexoraKnowledgeCollab.getToastSelectionOffsets(rawEditor).anchor;
            }

            return 0;
        }

        function setOwnerEditorCursorOffset(cursor) {
            const editor = getEditor();
            const rawEditor = editor && editor.__editor ? editor.__editor : null;
            const data = cursor && typeof cursor === 'object' ? cursor : {};

            if (
                rawEditor
                && window.NexoraKnowledgeCollab
                && typeof window.NexoraKnowledgeCollab.setToastCursorOffset === 'function'
                && window.NexoraKnowledgeCollab.setToastCursorOffset(rawEditor, Number(data.offset || 0))
            ) {
                return;
            }

            if (!editor || !editor.codemirror || typeof editor.codemirror.setCursor !== 'function') {
                return;
            }

            editor.codemirror.setCursor(Number(data.line || 0), Number(data.col || 0));
        }

        function getOwnerKnowledgeCollabWsUrl(meta = {}) {
            const shareId = String(meta.share_id || '').trim();
            const owner = getActiveKnowledgeShareUsername();

            if (!owner || !shareId) {
                return '';
            }

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const params = new URLSearchParams();
            params.set('role', 'owner');
            params.set('display_name', getCurrentUsername() || owner);
            return `${protocol}//${window.location.host}/ws/knowledge/collab/${encodeURIComponent(owner)}/${encodeURIComponent(shareId)}?${params.toString()}`;
        }

        function startOwnerKnowledgeCollab(title, metadata = {}) {
            const safeTitle = String(title || '').trim();
            const meta = metadata && typeof metadata === 'object' ? metadata : {};
            const shareId = String(meta.share_id || '').trim();

            stopKnowledgeCollab();

            if (!window.NexoraKnowledgeCollab || !safeTitle || !shareId || !meta.public || !meta.collaborative) {
                return;
            }

            const editor = getEditor();

            if (!editor) {
                return;
            }

            state.collabTitle = safeTitle;
            state.collabClient = window.NexoraKnowledgeCollab.createClient({
                wsUrl: getOwnerKnowledgeCollabWsUrl(meta),
                getText: () => {
                    const liveEditor = getEditor();
                    return liveEditor ? String(liveEditor.value() || '') : '';
                },
                setText: (value, meta = {}) => {
                    const liveEditor = getEditor();

                    if (!liveEditor || state.collabTitle !== String(state.currentTitle || '').trim()) {
                        return false;
                    }

                    const snapshot = captureEditorViewportSnapshot();
                    state.collabApplyingRemote = true;

                    let incremental = false;

                    if (typeof liveEditor.applyTextOperation === 'function') {
                        incremental = liveEditor.applyTextOperation(meta.operation, String(value || '')) === true;
                    } else {
                        liveEditor.value(String(value || ''));
                    }

                    setCurrentVersion({ title: safeTitle }, String(value || ''));

                    if (!incremental) {
                        knowledgeSyncLogger.debug('[KnowledgeCollab] incremental apply fell back to full replace', {
                            title: safeTitle,
                            operation: meta.operation || null,
                        });
                        restoreEditorViewportSnapshot(snapshot);
                    }

                    setTimeout(() => {
                        state.collabApplyingRemote = false;
                    }, 120);
                    return incremental;
                },
                getCursorOffset: getOwnerEditorCursorOffset,
                getCursorAnchor: getOwnerEditorCursorAnchor,
                setCursorOffset: setOwnerEditorCursorOffset,
                notifyPresence: (member, action) => {
                    const name = String(
                        (member && member.display_name)
                        || (member && member.role === 'owner' ? getCurrentUsername() : '匿名协作者')
                    ).trim() || '协作者';
                    showToast(action === 'join' ? `${name} 加入了协作` : `${name} 离开了协作`);
                },
                onConnectionChange: (connected) => {
                    const mask = getOwnerKnowledgeCollabOfflineMask();

                    if (!mask) {
                        return;
                    }

                    if (connected) {
                        mask.hide();
                    } else {
                        mask.show('实时协作已断开，正在重连…');
                    }
                },
                setStatus: (kind, text) => {
                    const label = String(text || '').trim();

                    if (label && kind === 'error') {
                        showToast(label);
                    }
                },
                renderMembers: renderOwnerKnowledgeCollabMembers,
                renderCursors: renderOwnerKnowledgeCollabCursors,
            });
            state.collabClient.start();

            const viewer = getViewerEl();

            if (viewer && viewer.dataset.knowledgeCollabCursorBound !== '1') {
                viewer.dataset.knowledgeCollabCursorBound = '1';
                ['keyup', 'mouseup', 'touchend'].forEach((eventName) => {
                    viewer.addEventListener(eventName, () => {
                        if (state.collabClient && state.collabClient.isActive()) {
                            state.collabClient.scheduleCursorSend();
                        }
                    }, true);
                });
            }
        }

        function updateKnowledgeMetaFromVersion(title, payload = {}) {
            const safeTitle = String(title || state.currentTitle || '').trim();
            const data = payload && typeof payload === 'object' ? payload : {};

            if (!safeTitle) return;

            const knowledgeMetaCache = getKnowledgeMetaCache();
            const meta = (knowledgeMetaCache[safeTitle] && typeof knowledgeMetaCache[safeTitle] === 'object')
                ? knowledgeMetaCache[safeTitle]
                : {};

            if (data.updated_at || data.updatedAt) {
                meta.updated_at = data.updated_at || data.updatedAt;
            }

            if (data.basis_id || data.basisId) {
                meta.basis_id = data.basis_id || data.basisId;
            }

            if (Number(meta.vector_updated_at || 0) >= Number(meta.updated_at || 0)) {
                meta.needs_vector_refresh = false;
            } else if (Number(meta.updated_at || 0) > 0) {
                meta.needs_vector_refresh = true;
            }

            knowledgeMetaCache[safeTitle] = meta;
        }

        function normalizeSyncIdentity(value) {
            return String(value || '').trim().toLowerCase();
        }

        function isSelfKnowledgeChangedEvent(payload = {}) {
            const data = payload && typeof payload === 'object' ? payload : {};
            const source = String(data.source || '').trim();
            const actor = normalizeSyncIdentity(data.actor_username || data.actorUsername);
            const current = normalizeSyncIdentity(getCurrentUsername());

            return source === 'owner_save' && !!actor && !!current && actor === current;
        }

        function captureEditorViewportSnapshot() {
            const title = String(state.currentTitle || state.scroll.activeTitle || '').trim();
            const preview = getPreviewEl();
            const scroller = getScrollerEl();
            const isPreview = isPreviewActive();
            const cmInfo = state.editor && state.editor.codemirror && typeof state.editor.codemirror.getScrollInfo === 'function'
                ? state.editor.codemirror.getScrollInfo()
                : null;

            return {
                title,
                isPreview,
                sourceMode: isPreview ? 'preview' : 'edit',
                previewTop: readScrollableProgress(preview).top,
                previewRatio: readScrollableProgress(preview).ratio,
                previewLeft: preview ? Number(preview.scrollLeft || 0) : 0,
                editTop: state.editor && state.editor.__editorType === 'toastui'
                    ? readScrollableProgress(scroller).top
                    : readCodeMirrorProgress().top,
                editRatio: state.editor && state.editor.__editorType === 'toastui'
                    ? readScrollableProgress(scroller).ratio
                    : readCodeMirrorProgress().ratio,
                editLeft: scroller ? Number(scroller.scrollLeft || 0) : 0,
                cmLeft: Number((cmInfo && cmInfo.left) || 0),
                cmTop: Number((cmInfo && cmInfo.top) || 0),
                windowX: Number(window.scrollX || 0),
                windowY: Number(window.scrollY || window.pageYOffset || 0),
            };
        }

        function restoreEditorViewportSnapshot(snapshot) {
            const data = snapshot && typeof snapshot === 'object' ? snapshot : null;
            const title = String(data && data.title || '').trim();

            if (!data || !title || title !== String(state.currentTitle || '').trim()) return;

            const titleState = getTitleState(title);
            titleState.previewTop = Number(data.previewTop || 0);
            titleState.previewRatio = Number(data.previewRatio || 0);
            titleState.editTop = Number(data.editTop || 0);
            titleState.editRatio = Number(data.editRatio || 0);

            const applyExactScroll = () => {
                const preview = getPreviewEl();
                const scroller = getScrollerEl();
                const editor = getEditor();

                if (preview) {
                    preview.scrollTop = Math.max(0, Number(data.previewTop || 0));
                    preview.scrollLeft = Math.max(0, Number(data.previewLeft || 0));
                }

                if (editor && editor.codemirror && typeof editor.codemirror.scrollTo === 'function') {
                    editor.codemirror.scrollTo(
                        Math.max(0, Number(data.cmLeft || data.editLeft || 0)),
                        Math.max(0, Number(data.cmTop || data.editTop || 0))
                    );
                }

                if (scroller) {
                    scroller.scrollTop = Math.max(0, Number(data.editTop || 0));
                    scroller.scrollLeft = Math.max(0, Number(data.editLeft || 0));
                }

                window.scrollTo(Number(data.windowX || 0), Number(data.windowY || 0));
            };

            restoreScrollPosition(!!data.isPreview, data);
            applyExactScroll();

            [0, 80, 240].forEach((delay) => {
                setTimeout(() => {
                    applyExactScroll();
                }, delay);
            });
        }

        function mergeKnowledgeContent(base, local, remote) {
            const baseText = String(base || '');
            const localText = String(local || '');
            const remoteText = String(remote || '');

            if (remoteText === localText) return remoteText;
            if (localText === baseText) return remoteText;
            if (!baseText || baseText === remoteText) return localText;

            const baseLines = baseText.split('\n');
            const localLines = localText.split('\n');
            const remoteLines = remoteText.split('\n');
            const maxLen = Math.max(baseLines.length, localLines.length, remoteLines.length);
            const merged = [];

            for (let i = 0; i < maxLen; i += 1) {
                const baseLine = i < baseLines.length ? baseLines[i] : undefined;
                const localLine = i < localLines.length ? localLines[i] : undefined;
                const remoteLine = i < remoteLines.length ? remoteLines[i] : undefined;
                const localChanged = localLine !== baseLine;
                const remoteChanged = remoteLine !== baseLine;

                if (!localChanged && !remoteChanged) {
                    merged.push(baseLine !== undefined ? remoteLine : '');
                } else if (remoteChanged && !localChanged) {
                    merged.push(remoteLine !== undefined ? remoteLine : '');
                } else if (localChanged && !remoteChanged) {
                    merged.push(localLine !== undefined ? localLine : '');
                } else {
                    merged.push(localLine !== undefined ? localLine : '');
                }
            }

            return merged.join('\n');
        }

        function applyRemoteContentToEditor(payload = {}) {
            const editor = getEditor();
            const server = payload && typeof payload.server === 'object' ? payload.server : payload;
            const hasRemoteContent = !!(
                server
                && typeof server === 'object'
                && Object.prototype.hasOwnProperty.call(server, 'content')
            );
            const remoteContent = hasRemoteContent ? String(server.content || '') : '';

            if (!editor || !hasRemoteContent) return false;

            const version = readCurrentVersion();
            const localContent = String(editor.value() || '');
            const merged = mergeKnowledgeContent(version.syncedContent, localContent, remoteContent);
            const remoteChangedAgainstBase = remoteContent !== String(version.syncedContent || '');

            if (merged === localContent) {
                setCurrentVersion(server, remoteContent);
                updateKnowledgeMetaFromVersion(state.currentTitle, server);
                knowledgeSyncLogger.debug('[KnowledgeSync] remote update kept editor content', {
                    title: state.currentTitle,
                    remoteChangedAgainstBase,
                    localLength: localContent.length,
                    remoteLength: remoteContent.length,
                    contentRevision: server.content_revision || server.contentRevision || ''
                });

                if (remoteChangedAgainstBase) {
                    showToast('远端更新已合并，请检查后保存');
                }

                return true;
            }

            const viewportSnapshot = captureEditorViewportSnapshot();
            editor.value(merged);

            setCurrentVersion(server, remoteContent);
            updateKnowledgeMetaFromVersion(state.currentTitle, server);
            restoreEditorViewportSnapshot(viewportSnapshot);
            showToast(merged === remoteContent ? '已同步远端更新' : '远端更新已合并，请检查后保存');
            return true;
        }

        async function reloadCurrentKnowledgeFromServer(title) {
            const safeTitle = String(title || state.currentTitle || '').trim();

            if (!safeTitle) return false;

            try {
                const res = await fetch(appendWorkspaceKnowledgeQuery(
                    `/api/knowledge/basis/${encodeURIComponent(safeTitle)}`,
                    safeTitle,
                ));
                const data = await res.json();

                if (!res.ok || !data || !data.success || !data.knowledge) {
                    return false;
                }

                return applyRemoteContentToEditor(data.knowledge);
            } catch (e) {
                console.error('reload current knowledge failed', e);
                return false;
            }
        }

        async function syncCurrentKnowledgeFromServer(reason = '') {
            const safeTitle = String(state.currentTitle || '').trim();

            if (!safeTitle) return false;

            knowledgeSyncLogger.debug('[KnowledgeSync] reconciling current knowledge from server', {
                title: safeTitle,
                reason: String(reason || '').trim(),
                currentRevision: readCurrentVersion().contentRevision || ''
            });

            return reloadCurrentKnowledgeFromServer(safeTitle);
        }

        function getEditor() {
            return state.editor || null;
        }

        function getEditorCodeMirror() {
            const editor = getEditor();

            return editor && editor.codemirror ? editor.codemirror : null;
        }

        function isToastUiEditor() {
            const editor = getEditor();

            return !!(editor && editor.__editorType === 'toastui');
        }

        function setEditor(editor) {
            state.editor = editor || null;
            return state.editor;
        }

        function clearEditor() {
            state.editor = null;
        }

        function destroyEditor() {
            const editor = getEditor();

            stopKnowledgeCollab();

            if (editor && typeof editor.__cleanupPreviewBridge === 'function') {
                try {
                    editor.__cleanupPreviewBridge();
                } catch (_) {}
            }

            if (
                editor
                && editor.__editorType === 'toastui'
                && editor.__editor
                && typeof editor.__editor.destroy === 'function'
            ) {
                try {
                    editor.__editor.destroy();
                } catch (_) {}
            }

            clearEditor();
        }

        function getCurrentTitle() {
            return String(state.currentTitle || '').trim();
        }

        function setCurrentTitle(title) {
            const nextTitle = String(title || '').trim();

            if (state.currentTitle && String(state.currentTitle || '').trim() !== nextTitle) {
                stopKnowledgeCollab();
            }

            state.currentTitle = title;
            state.currentVersion = null;
            state.scroll.activeTitle = nextTitle;
        }

        function setActiveScrollTitle(title) {
            state.scroll.activeTitle = String(title || '').trim();
        }

        function getActiveScrollTitle() {
            return String(state.scroll.activeTitle || '').trim();
        }

        function setPendingToggleSnapshot(snapshot) {
            state.scroll.pendingToggleSnapshot = snapshot || null;
        }

        function clearCurrentTitle() {
            stopKnowledgeCollab();
            state.currentTitle = null;
            state.currentVersion = null;
            state.scroll.activeTitle = '';
        }

        function setWorkspaceReturnContext(context) {
            state.workspaceReturnContext = context || null;
        }

        function getWorkspaceReturnContext() {
            return state.workspaceReturnContext || null;
        }

        function clearWorkspaceReturnContext() {
            state.workspaceReturnContext = null;
        }

        function setPendingHighlightData(data) {
            state.pendingHighlightData = data || null;
        }

        function clearPendingHighlightData() {
            state.pendingHighlightData = null;
        }

        function getPendingHighlightData() {
            return state.pendingHighlightData || null;
        }

        function getTitleState(title = state.currentTitle || '') {
            const key = String(title || '').trim() || '__default__';

            if (!state.scroll.byTitle[key]) {
                state.scroll.byTitle[key] = {
                    previewTop: 0,
                    editTop: 0,
                    previewRatio: 0,
                    editRatio: 0
                };
            }

            return state.scroll.byTitle[key];
        }

        function clearTitleState(title = '') {
            const key = String(title || '').trim();

            if (key && state.scroll.byTitle && typeof state.scroll.byTitle === 'object') {
                delete state.scroll.byTitle[key];
            }
        }

        function readScrollableProgress(el) {
            if (!el) return { top: 0, ratio: 0 };

            const top = Math.max(0, Number(el.scrollTop || 0));
            const max = Math.max(0, Number((el.scrollHeight || 0) - (el.clientHeight || 0)));
            const ratio = max > 0 ? Math.max(0, Math.min(1, top / max)) : 0;

            return { top, ratio };
        }

        function applyScrollableProgress(el, preferredTop = 0, preferredRatio = 0) {
            if (!el) return;

            const max = Math.max(0, Number((el.scrollHeight || 0) - (el.clientHeight || 0)));
            const ratio = Math.max(0, Math.min(1, Number(preferredRatio || 0)));
            const top = max > 0
                ? Math.max(0, Math.min(max, Math.round(max * ratio)))
                : Math.max(0, Number(preferredTop || 0));

            el.scrollTop = top;
        }

        function readCodeMirrorProgress() {
            const editor = getEditor();

            if (!editor || !editor.codemirror || typeof editor.codemirror.getScrollInfo !== 'function') {
                return { top: 0, ratio: 0 };
            }

            try {
                const info = editor.codemirror.getScrollInfo();
                const top = Math.max(0, Number((info && info.top) || 0));
                const max = Math.max(0, Number(((info && info.height) || 0) - ((info && info.clientHeight) || 0)));
                const ratio = max > 0 ? Math.max(0, Math.min(1, top / max)) : 0;

                return { top, ratio };
            } catch (_) {
                return { top: 0, ratio: 0 };
            }
        }

        function applyCodeMirrorProgress(preferredTop = 0, preferredRatio = 0) {
            const editor = getEditor();

            if (!editor || !editor.codemirror || typeof editor.codemirror.getScrollInfo !== 'function') return;

            try {
                const info = editor.codemirror.getScrollInfo();
                const max = Math.max(0, Number(((info && info.height) || 0) - ((info && info.clientHeight) || 0)));
                const ratio = Math.max(0, Math.min(1, Number(preferredRatio || 0)));
                const top = max > 0
                    ? Math.max(0, Math.min(max, Math.round(max * ratio)))
                    : Math.max(0, Number(preferredTop || 0));

                editor.codemirror.scrollTo(null, top);
            } catch (_) {}
        }

        function cancelRestores() {
            state.scroll.restoreTimeouts.forEach(clearTimeout);
            state.scroll.restoreTimeouts = [];
        }

        function cancelAlignRetries() {
            state.align.retryTimers.forEach((timer) => clearTimeout(timer));
            state.align.retryTimers = [];
        }

        function resetAlignWidgets() {
            state.align.widgets.forEach((widget) => {
                if (widget && typeof widget.clear === 'function') {
                    widget.clear();
                }
            });
            state.align.widgets = [];
            state.align.scrollMap = null;
        }

        function addAlignWidget(widget) {
            if (widget) {
                state.align.widgets.push(widget);
            }
        }

        function nextAlignRunToken() {
            state.align.runToken += 1;
            return state.align.runToken;
        }

        function isCurrentAlignRunToken(runToken) {
            return runToken === state.align.runToken;
        }

        function getLastAlignRunAt() {
            return Number(state.align.lastRunAt || 0);
        }

        function setLastAlignRunAt(value) {
            state.align.lastRunAt = Number(value || 0);
        }

        function getLastAlignInputAt() {
            return Number(state.align.lastInputAt || 0);
        }

        function isAlignBusy() {
            return !!state.align.busy;
        }

        function setAlignBusy(value) {
            state.align.busy = !!value;
        }

        function addAlignRetryTimer(timer) {
            state.align.retryTimers.push(timer);
        }

        function isPreviewActive() {
            const editor = getEditor();

            return !!(editor && editor.isPreviewActive && editor.isPreviewActive());
        }

        function isSideBySideActive() {
            const editor = getEditor();

            if (editor && editor.__editorType === 'toastui') {
                return !!(typeof editor.isSideBySideActive === 'function' && editor.isSideBySideActive());
            }

            return !!(
                document.querySelector('#knowledgeViewer .CodeMirror-sided')
                || document.querySelector('#knowledgeViewer .editor-preview-side.editor-preview-active-side')
            );
        }

        function isFullscreenActive() {
            const editor = getEditor();

            if (editor && editor.__editorType === 'toastui') {
                return !!editor.__isFullscreen;
            }

            const toolbar = document.querySelector('#knowledgeViewer .editor-toolbar');

            return !!(toolbar && toolbar.classList.contains('fullscreen'));
        }

        function syncToolbarState() {
            const toolbar = document.querySelector('#knowledgeViewer .editor-toolbar');

            if (!toolbar) return;

            const previewActive = isPreviewActive();
            const sideBySideActive = isSideBySideActive();
            const fullscreenActive = isFullscreenActive();
            const previewBtn = toolbar.querySelector('.preview');
            const sideBtn = toolbar.querySelector('.side-by-side');
            const fullscreenBtn = toolbar.querySelector('.fullscreen');

            if (previewBtn) previewBtn.classList.toggle('active', previewActive && !sideBySideActive);
            if (sideBtn) sideBtn.classList.toggle('active', sideBySideActive);
            if (fullscreenBtn) fullscreenBtn.classList.toggle('active', fullscreenActive);

            toolbar.querySelectorAll('[data-cmd]').forEach((node) => {
                node.classList.toggle('disabled', previewActive && !sideBySideActive);
                node.setAttribute('aria-disabled', (previewActive && !sideBySideActive) ? 'true' : 'false');
            });
        }

        function getPreviewContentEl() {
            return document.querySelector('#knowledgeViewer .nexora-toast-preview .toastui-editor-contents')
                || document.querySelector('#knowledgeViewer .toastui-editor-md-preview .toastui-editor-contents')
                || document.querySelector('#knowledgeViewer .editor-preview')
                || document.querySelector('#knowledgeViewer .editor-preview-side.editor-preview-active-side');
        }

        function togglePreviewMode() {
            const editor = getEditor();

            if (!editor) return;

            if (typeof editor.togglePreview === 'function') {
                editor.togglePreview();
                return;
            }

            if (typeof EasyMDE !== 'undefined' && EasyMDE && typeof EasyMDE.togglePreview === 'function') {
                EasyMDE.togglePreview(editor);
            }
        }

        function exitSpecialModes() {
            const editor = getEditor();

            if (!editor) return;

            try {
                if (isFullscreenActive() && typeof editor.toggleFullScreen === 'function') {
                    editor.toggleFullScreen();
                }
            } catch (_) {}

            try {
                if (isSideBySideActive() && typeof editor.toggleSideBySide === 'function') {
                    editor.toggleSideBySide();
                }
            } catch (_) {}
        }

        function highlightTextInPreview(text, meta = {}) {
            const preview = getPreviewContentEl();

            if (!preview) {
                console.warn('预览元素不存在');
                return;
            }

            // 高亮来源于搜索跳转，需要直接操作预览 DOM 的文本节点。
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

            while (node) {
                const nodeText = node.textContent;
                const idx = nodeText.indexOf(searchText);

                if (idx >= 0) {
                    foundNode = node;
                    foundOffset = idx;
                    break;
                }

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

            const span = document.createElement('span');
            span.className = 'cm-search-highlight';
            span.style.backgroundColor = 'rgba(34, 197, 94, 0.25)';
            span.style.borderBottom = '1px solid rgba(34, 197, 94, 0.7)';

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

            preview.scrollTop = 0;

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const spanRect = span.getBoundingClientRect();
                        const previewRect = preview.getBoundingClientRect();
                        const scrollOffset = spanRect.top - previewRect.top - (previewRect.height / 2) + preview.scrollTop;

                        preview.scrollTo({
                            top: scrollOffset,
                            behavior: 'smooth'
                        });

                        span.style.transition = 'all 0.3s ease';
                        span.style.transform = 'scale(1.05)';

                        setTimeout(() => {
                            span.style.transform = 'scale(1)';
                        }, 400);
                    }, 400);
                });
            });
        }

        function getScrollMetrics() {
            const preview = getPreviewEl();
            const previewProgress = preview ? readScrollableProgress(preview) : { top: 0, ratio: 0 };
            const previewMax = preview ? Math.max(0, Number((preview.scrollHeight || 0) - (preview.clientHeight || 0))) : 0;
            let editProgress = { top: 0, ratio: 0 };
            let editMax = 0;

            if (getEditorCodeMirror() && typeof getEditorCodeMirror().getScrollInfo === 'function') {
                const info = getEditorCodeMirror().getScrollInfo();
                editProgress = readCodeMirrorProgress();
                editMax = Math.max(0, Number(((info && info.height) || 0) - ((info && info.clientHeight) || 0)));
            }

            return {
                previewProgress,
                previewMax,
                editProgress,
                editMax
            };
        }

        function captureToggleSnapshot(forcePreviewSource = null) {
            const title = String(getCurrentTitle() || getActiveScrollTitle() || '').trim();
            if (!title) return null;

            const metrics = getScrollMetrics();
            const usePreviewSource = forcePreviewSource != null
                ? !!forcePreviewSource
                : (isSideBySideActive()
                    ? metrics.previewMax >= metrics.editMax
                    : isPreviewActive());
            const sourceProgress = usePreviewSource ? metrics.previewProgress : metrics.editProgress;

            return {
                title,
                sourceMode: usePreviewSource ? 'preview' : 'edit',
                previewTop: sourceProgress.top,
                previewRatio: sourceProgress.ratio,
                editTop: sourceProgress.top,
                editRatio: sourceProgress.ratio,
                previewMax: metrics.previewMax,
                editMax: metrics.editMax
            };
        }

        function mirrorProgressToBothModes(forcePreviewSource = null) {
            const snapshot = captureToggleSnapshot(forcePreviewSource);
            if (!snapshot) return;

            const state = getTitleState(snapshot.title);
            state.previewTop = snapshot.previewTop;
            state.previewRatio = snapshot.previewRatio;
            state.editTop = snapshot.editTop;
            state.editRatio = snapshot.editRatio;
            setActiveScrollTitle(snapshot.title);
            logDebug('mirrorProgress', {
                title: snapshot.title,
                mode: snapshot.sourceMode,
                previewTop: state.previewTop,
                previewRatio: state.previewRatio,
                editTop: state.editTop,
                editRatio: state.editRatio,
                previewMax: snapshot.previewMax,
                editMax: snapshot.editMax
            });
            setPendingToggleSnapshot(snapshot);
        }

        function applyToggleSnapshot(snapshot, forcePreview = null) {
            if (!snapshot) return;
            const isPreview = forcePreview != null ? !!forcePreview : isPreviewActive();
            if (isPreview) {
                const preview = getPreviewEl();
                if (preview) {
                    applyScrollableProgress(preview, snapshot.previewTop, snapshot.previewRatio);
                }
            } else {
                const scroller = getScrollerEl();
                if (scroller) {
                    applyScrollableProgress(scroller, snapshot.editTop, snapshot.editRatio);
                }
                applyCodeMirrorProgress(snapshot.editTop, snapshot.editRatio);
            }
            logDebug('toggleSnapshotRestore', {
                title: snapshot.title,
                sourceMode: snapshot.sourceMode,
                isPreview,
                previewTop: snapshot.previewTop,
                previewRatio: snapshot.previewRatio,
                editTop: snapshot.editTop,
                editRatio: snapshot.editRatio
            });
        }

        function isAlignDebugEnabled() {
            return !!window.__NEXORA_ALIGN_DEBUG;
        }

        function mapKnowledgePreviewAnchorType(node) {
            if (node && node.classList && node.classList.contains('nexora-preview-cm-header')) return 'heading';
            const tag = String((node && node.tagName) || '').toUpperCase();
            if (/^H[1-6]$/.test(tag)) return 'heading';
            if (tag === 'PRE') return 'code';
            if (tag === 'TABLE') return 'table';
            if (tag === 'BLOCKQUOTE') return 'blockquote';
            if (tag === 'UL' || tag === 'OL') return 'list';
            if (tag === 'HR') return 'hr';
            return 'paragraph';
        }

        function extractKnowledgePreviewHeadingLevel(node) {
            if (!node) return 0;
            const tag = String(node.tagName || '').toUpperCase();
            if (/^H[1-6]$/.test(tag)) return Number(tag.slice(1));
            const dataLevel = Number(node.dataset && node.dataset.cmHeaderLevel);
            if (Number.isFinite(dataLevel) && dataLevel >= 1 && dataLevel <= 6) return dataLevel;
            const cls = String(node.className || '');
            const match = /\bcm-header-(\d)\b/.exec(cls);
            if (match) return Number(match[1]);
            return 1;
        }

        function normalizePreviewHeadingTags(root) {
            if (!root || !root.querySelectorAll) return;
            const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
            headings.forEach((heading) => {
                const level = Number(String(heading.tagName || 'H1').slice(1)) || 1;
                const replacement = document.createElement('div');
                const normalizedLevel = Math.max(1, Math.min(6, level));
                replacement.className = `nexora-preview-cm-header nexora-preview-cm-header-${normalizedLevel} cm-header cm-header-${normalizedLevel}`;
                replacement.dataset.cmHeaderLevel = String(normalizedLevel);
                if (heading.id) replacement.id = heading.id;
                replacement.innerHTML = heading.innerHTML;
                heading.replaceWith(replacement);
            });
        }

        function getKnowledgeEditorEffectiveCmBottom(cm) {
            if (!cm || typeof cm.lineCount !== 'function' || cm.lineCount() <= 0) return 0;
            let lastLine = Math.max(0, cm.lineCount() - 1);
            while (lastLine > 0 && !String(cm.getLine(lastLine) || '').trim()) {
                lastLine -= 1;
            }
            const lastTop = Number(cm.heightAtLine(lastLine, "local") || 0);
            const lineHandle = cm.getLineHandle(lastLine);
            const lineHeight = Number((lineHandle && lineHandle.height) || cm.defaultTextHeight() || 0);
            return Math.max(0, Math.round(lastTop + lineHeight));
        }

        function collectKnowledgeEditorMarkdownAnchors(cm) {
            const anchors = [];
            let inFence = false;
            let previousType = '';
            let previousWasBlank = true;

            for (let i = 0; i < cm.lineCount(); i++) {
                const line = String(cm.getLine(i) || '');
                const trimmed = line.trim();

                if (/^```/.test(trimmed)) {
                    if (!inFence) {
                        anchors.push({ line: i, type: 'code', level: 0, textNorm: '' });
                    }
                    inFence = !inFence;
                    previousType = 'fence';
                    previousWasBlank = false;
                    continue;
                }

                if (inFence) continue;

                if (!trimmed) {
                    previousWasBlank = true;
                    continue;
                }

                let currentType = 'paragraph';
                let level = 0;
                let textRaw = trimmed;
                const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
                if (headingMatch) {
                    currentType = 'heading';
                    level = headingMatch[1].length;
                    textRaw = headingMatch[2];
                } else if (/^>\s?/.test(trimmed)) {
                    currentType = 'blockquote';
                    textRaw = trimmed.replace(/^>\s?/, '');
                } else if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
                    currentType = 'list';
                } else if (/^\|.+\|$/.test(trimmed) || /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+$/.test(trimmed)) {
                    currentType = 'table';
                } else if (/^[-*_]{3,}\s*$/.test(trimmed)) {
                    currentType = 'hr';
                    textRaw = '';
                }

                if (previousWasBlank || currentType !== previousType || currentType === 'heading' || currentType === 'hr') {
                    anchors.push({
                        line: i,
                        type: currentType,
                        level,
                        textNorm: normalizeKnowledgeAnchorText(textRaw)
                    });
                }

                previousType = currentType;
                previousWasBlank = false;
            }

            return anchors;
        }

        function collectKnowledgeEditorPreviewAnchors(preview) {
            if (!preview) return [];
            const anchorTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'PRE', 'TABLE', 'BLOCKQUOTE', 'UL', 'OL', 'HR']);
            const directChildren = Array.from(preview.children || []).filter((node) => {
                const tag = String(node.tagName || '').toUpperCase();
                return anchorTags.has(tag) || (node.classList && node.classList.contains('nexora-preview-cm-header'));
            });
            const nodes = directChildren.length > 0
                ? directChildren
                : Array.from(preview.querySelectorAll('h1, h2, h3, h4, h5, h6, p, pre, table, blockquote, ul, ol, hr, .nexora-preview-cm-header'));
            return nodes.map((el) => {
                return {
                    el,
                    type: mapKnowledgePreviewAnchorType(el),
                    level: extractKnowledgePreviewHeadingLevel(el),
                    textNorm: normalizeKnowledgeAnchorText(el.textContent || '')
                };
            });
        }

        function normalizeKnowledgeAnchorText(text) {
            return String(text || '')
                .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
                .replace(/[`*_~>#\[\]()!.,:;'"，。！？：；、\s]+/g, '')
                .toLowerCase();
        }

        function areKnowledgeAnchorsCompatible(cmAnchor, previewAnchor) {
            if (!cmAnchor || !previewAnchor) return false;
            if (cmAnchor.type === previewAnchor.type) {
                if (cmAnchor.type === 'heading') {
                    const levelMatch = !cmAnchor.level || !previewAnchor.level || cmAnchor.level === previewAnchor.level;
                    if (!levelMatch) return false;
                    if (cmAnchor.textNorm && previewAnchor.textNorm) {
                        return cmAnchor.textNorm === previewAnchor.textNorm
                            || cmAnchor.textNorm.includes(previewAnchor.textNorm)
                            || previewAnchor.textNorm.includes(cmAnchor.textNorm);
                    }
                    return true;
                }

                if ((cmAnchor.type === 'paragraph' || cmAnchor.type === 'blockquote') && cmAnchor.textNorm && previewAnchor.textNorm) {
                    return cmAnchor.textNorm.includes(previewAnchor.textNorm)
                        || previewAnchor.textNorm.includes(cmAnchor.textNorm);
                }

                return true;
            }

            if (cmAnchor.type === 'paragraph' && (previewAnchor.type === 'paragraph' || previewAnchor.type === 'blockquote')) return true;
            if (cmAnchor.type === 'blockquote' && (previewAnchor.type === 'paragraph' || previewAnchor.type === 'blockquote')) return true;
            return false;
        }

        function scoreKnowledgeAnchorPair(cmAnchor, previewAnchor) {
            if (!areKnowledgeAnchorsCompatible(cmAnchor, previewAnchor)) return -1;

            let score = 10;
            const cmType = String((cmAnchor && cmAnchor.type) || '');
            const previewType = String((previewAnchor && previewAnchor.type) || '');
            const cmText = String((cmAnchor && cmAnchor.textNorm) || '');
            const previewText = String((previewAnchor && previewAnchor.textNorm) || '');

            if (cmType === previewType) score += 20;
            if (cmType === 'heading' && Number(cmAnchor.level || 0) === Number(previewAnchor.level || 0)) score += 20;
            if (cmText && previewText) {
                if (cmText === previewText) score += 100;
                else if (cmText.includes(previewText) || previewText.includes(cmText)) score += 60;
            }

            return score;
        }

        function buildKnowledgeSemanticAnchorPairs(cmAnchors, previewAnchors) {
            const pairs = [];
            let cmIndex = 0;
            let previewIndex = 0;
            const lookahead = 16;

            while (cmIndex < cmAnchors.length && previewIndex < previewAnchors.length) {
                const directScore = scoreKnowledgeAnchorPair(cmAnchors[cmIndex], previewAnchors[previewIndex]);

                if (directScore >= 0) {
                    pairs.push({cmAnchor: cmAnchors[cmIndex], previewAnchor: previewAnchors[previewIndex]});
                    cmIndex += 1;
                    previewIndex += 1;
                    continue;
                }

                let nextPreviewIndex = -1;
                let nextPreviewScore = -1;
                for (let index = previewIndex + 1; index < Math.min(previewAnchors.length, previewIndex + lookahead); index += 1) {
                    const score = scoreKnowledgeAnchorPair(cmAnchors[cmIndex], previewAnchors[index]);
                    if (score >= 40 && score > nextPreviewScore) {
                        nextPreviewIndex = index;
                        nextPreviewScore = score;
                    }
                }

                let nextCmIndex = -1;
                let nextCmScore = -1;
                for (let index = cmIndex + 1; index < Math.min(cmAnchors.length, cmIndex + lookahead); index += 1) {
                    const score = scoreKnowledgeAnchorPair(cmAnchors[index], previewAnchors[previewIndex]);
                    if (score >= 40 && score > nextCmScore) {
                        nextCmIndex = index;
                        nextCmScore = score;
                    }
                }

                if (nextPreviewIndex >= 0 && (nextCmIndex < 0 || (nextPreviewIndex - previewIndex) <= (nextCmIndex - cmIndex))) {
                    previewIndex = nextPreviewIndex;
                    continue;
                }

                if (nextCmIndex >= 0) {
                    cmIndex = nextCmIndex;
                    continue;
                }

                cmIndex += 1;
                previewIndex += 1;
            }

            return pairs;
        }

        function buildKnowledgeScrollAnchorMap(preview, cm) {
            if (!preview || !cm || typeof cm.getScrollInfo !== 'function') return null;

            const cmAnchors = collectKnowledgeEditorMarkdownAnchors(cm);
            const previewAnchors = collectKnowledgeEditorPreviewAnchors(preview);
            const anchorPairs = buildKnowledgeSemanticAnchorPairs(cmAnchors, previewAnchors);

            if (!anchorPairs.length) return null;

            const cmInfo = cm.getScrollInfo();
            const editorMax = Math.max(0, Number((cmInfo.height || 0) - (cmInfo.clientHeight || 0)));
            const previewMax = Math.max(0, Number((preview.scrollHeight || 0) - (preview.clientHeight || 0)));
            const points = [{editorTop: 0, previewTop: 0, type: 'start'}];
            let semanticPointCount = 0;

            anchorPairs.forEach((pair) => {
                const cmLine = Number(pair.cmAnchor && pair.cmAnchor.line);
                const previewNode = pair.previewAnchor && pair.previewAnchor.el;

                if (!Number.isFinite(cmLine) || !previewNode) return;

                const editorTop = Math.max(0, Math.min(editorMax, Number(cm.heightAtLine(cmLine, 'local') || 0)));
                const previewTop = Math.max(0, Math.min(previewMax, Number(previewNode.offsetTop || 0)));
                const previous = points[points.length - 1];
                semanticPointCount += 1;

                if (editorTop < previous.editorTop || previewTop < previous.previewTop) return;
                if (editorTop === previous.editorTop && previewTop === previous.previewTop) return;

                points.push({
                    editorTop,
                    previewTop,
                    type: String((pair.cmAnchor && pair.cmAnchor.type) || 'block')
                });
            });

            const last = points[points.length - 1];

            if (last.editorTop !== editorMax || last.previewTop !== previewMax) {
                points.push({editorTop: editorMax, previewTop: previewMax, type: 'end'});
            }

            if (!semanticPointCount || points.length < 2) return null;

            return {
                points,
                pairCount: anchorPairs.length,
                editorMax,
                previewMax
            };
        }

        function getKnowledgeScrollAnchorMap(preview, cm) {
            if (state.align.scrollMap) {
                return state.align.scrollMap;
            }

            state.align.scrollMap = buildKnowledgeScrollAnchorMap(preview, cm);

            return state.align.scrollMap;
        }

        function projectKnowledgeScrollTop(anchorMap, sourceKey, targetKey, sourceTop) {
            const points = anchorMap && Array.isArray(anchorMap.points) ? anchorMap.points : [];

            if (points.length < 2) return null;

            const sourceValue = Math.max(0, Number(sourceTop || 0));
            let lower = points[0];
            let upper = points[points.length - 1];

            for (let index = 1; index < points.length; index += 1) {
                const candidate = points[index];

                if (sourceValue <= Number(candidate[sourceKey] || 0)) {
                    upper = candidate;
                    break;
                }

                lower = candidate;
            }

            const sourceStart = Number(lower[sourceKey] || 0);
            const sourceEnd = Number(upper[sourceKey] || 0);
            const targetStart = Number(lower[targetKey] || 0);
            const targetEnd = Number(upper[targetKey] || 0);
            const segmentSize = sourceEnd - sourceStart;
            const segmentProgress = segmentSize > 0
                ? Math.max(0, Math.min(1, (sourceValue - sourceStart) / segmentSize))
                : 0;

            return Math.round(targetStart + ((targetEnd - targetStart) * segmentProgress));
        }

        function clearKnowledgeAlignmentStyles(preview) {
            const previewAnchors = collectKnowledgeEditorPreviewAnchors(preview);

            previewAnchors.forEach(({ el }) => {
                if (!el || !el.dataset) return;

                if (el.dataset.nexoraAlignBound === '1') {
                    el.style.marginTop = '';
                    delete el.dataset.nexoraAlignBound;
                }

                if (el.dataset.nexoraAlignMarginBottom === '1') {
                    el.style.marginBottom = '';
                    delete el.dataset.nexoraAlignMarginBottom;
                }
            });

            preview.style.paddingBottom = '';
        }

        function alignBlocks(mode = 'full') {
            if (isToastUiEditor()) return;
            if (!isSideBySideActive()) return;
            const preview = getPreviewEl();
            const scroller = getScrollerEl();
            if (!preview || !scroller || !getEditorCodeMirror()) return;

            const cm = getEditorCodeMirror();

            resetAlignWidgets();
            clearKnowledgeAlignmentStyles(preview);
            state.align.scrollMap = null;
            const cmAnchors = collectKnowledgeEditorMarkdownAnchors(cm);
            const previewAnchors = collectKnowledgeEditorPreviewAnchors(preview);
            const semanticPairs = buildKnowledgeSemanticAnchorPairs(cmAnchors, previewAnchors);
            state.align.scrollMap = buildKnowledgeScrollAnchorMap(preview, cm);

            if (isAlignDebugEnabled()) {
                logDebug('alignAnchors', {
                    mode,
                    cmAnchors: cmAnchors.length,
                    previewAnchors: previewAnchors.length,
                    semanticPairs: semanticPairs.length,
                    scrollMapPoints: state.align.scrollMap ? state.align.scrollMap.points.length : 0,
                    layoutPaddingRemoved: true
                });
            }

            const pendingImages = Array.from(preview.querySelectorAll('img')).filter((img) => !img.complete);
            pendingImages.forEach((img) => {
                if (img.dataset.nexoraAlignLoadBound === '1') return;
                img.dataset.nexoraAlignLoadBound = '1';
                const onDone = () => {
                    delete img.dataset.nexoraAlignLoadBound;
                    if (isSideBySideActive()) {
                        scheduleAlignment('image');
                    }
                };
                img.addEventListener('load', onDone, { once: true });
                img.addEventListener('error', onDone, { once: true });
            });
        }

        function scheduleAlignment(reason = 'typing') {
            if (isToastUiEditor()) return;
            if (!isSideBySideActive()) return;
            state.align.scrollMap = null;
            cancelAlignRetries();
            const runToken = nextAlignRunToken();
            const now = Date.now();
            let delays;
            if (reason === 'toggle') {
                delays = [0, 180, 420];
            } else if (reason === 'layout') {
                delays = [100, 320];
            } else if (reason === 'image') {
                delays = [120, 380];
            } else {
                delays = [1200];
                if (now - getLastAlignRunAt() < 300) {
                    delays = [1400];
                }
            }

            delays.forEach((delay) => {
                const timer = setTimeout(() => {
                    if (!isCurrentAlignRunToken(runToken)) return;
                    if (!isSideBySideActive()) return;
                    if (reason === 'typing' && (Date.now() - getLastAlignInputAt()) < 650) return;
                    if (isAlignBusy()) return;
                    setAlignBusy(true);
                    requestAnimationFrame(() => {
                        try {
                            if (!isCurrentAlignRunToken(runToken)) return;
                            if (!isSideBySideActive()) return;
                            alignBlocks(reason === 'typing' ? 'light' : 'full');
                            if (reason !== 'typing') {
                                syncMirrorScroll(false);
                            }
                            setLastAlignRunAt(Date.now());
                        } finally {
                            setAlignBusy(false);
                        }
                    });
                }, delay);
                addAlignRetryTimer(timer);
            });
        }

        function restoreScrollPosition(forcePreview = null, preferredSnapshot = null) {
            const title = String(state.currentTitle || state.scroll.activeTitle || '').trim();

            if (!title) return;

            const titleState = getTitleState(title);
            const isPreview = forcePreview != null ? !!forcePreview : isPreviewActive();
            const snapshot = preferredSnapshot && String(preferredSnapshot.title || '').trim() === title
                ? preferredSnapshot
                : (state.scroll.pendingToggleSnapshot && String(state.scroll.pendingToggleSnapshot.title || '').trim() === title
                    ? state.scroll.pendingToggleSnapshot
                    : null);
            const chooseScrollTop = (primary, secondary) => {
                if (Number.isFinite(Number(primary)) && Number(primary) >= 0) return Number(primary);
                if (Number.isFinite(Number(secondary)) && Number(secondary) >= 0) return Number(secondary);
                return 0;
            };
            const snapshotTop = (() => {
                if (!snapshot) return null;
                if (snapshot.sourceMode === 'preview') return snapshot.previewTop;
                if (snapshot.sourceMode === 'edit') return snapshot.editTop;
                return isPreview ? snapshot.previewTop : snapshot.editTop;
            })();
            const snapshotRatio = (() => {
                if (!snapshot) return null;
                if (snapshot.sourceMode === 'preview') return snapshot.previewRatio;
                if (snapshot.sourceMode === 'edit') return snapshot.editRatio;
                return isPreview ? snapshot.previewRatio : snapshot.editRatio;
            })();
            const preferredTop = snapshot
                ? Number(snapshotTop || 0)
                : (isPreview
                    ? chooseScrollTop(titleState.previewTop, titleState.editTop)
                    : chooseScrollTop(titleState.editTop, titleState.previewTop));
            const preferredRatio = snapshot
                ? Math.max(0, Math.min(1, Number(snapshotRatio || 0)))
                : (isPreview
                    ? (Number.isFinite(titleState.previewRatio) ? titleState.previewRatio : titleState.editRatio)
                    : (Number.isFinite(titleState.editRatio) ? titleState.editRatio : titleState.previewRatio));

            logDebug('restoreScroll:prepare', {
                title,
                isPreview,
                preferredTop,
                preferredRatio,
                snapshot,
                state: titleState,
                layout: collectLayoutSnapshot()
            });

            const attemptRestore = () => {
                if (isPreview) {
                    const target = getPreviewEl();
                    if (!target) return;

                    applyScrollableProgress(target, preferredTop, preferredRatio);
                    logDebug('restoreScroll:previewApplied', {
                        title,
                        preferredTop,
                        preferredRatio,
                        target: summarizeNode(target)
                    });
                    return;
                }

                const target = getScrollerEl();

                if (target) {
                    applyScrollableProgress(target, preferredTop, preferredRatio);
                }

                if (!(state.editor && state.editor.__editorType === 'toastui')) {
                    applyCodeMirrorProgress(preferredTop, preferredRatio);
                }

                logDebug('restoreScroll:editApplied', {
                    title,
                    preferredTop,
                    preferredRatio,
                    target: summarizeNode(target)
                });
            };

            cancelRestores();
            // 记录当前恢复目标，稳定窗口内滚动监听检测到渲染引起的偏移时立即吸附回该位置
            state.scroll.targetTop = preferredTop;
            state.scroll.targetRatio = preferredRatio;
            state.scroll.targetIsPreview = isPreview;
            // 恢复档位需覆盖 ToastUI 原生预览异步渲染完成的时机（可能晚于 680ms），
            // 否则渲染完成后预览被甩到底部时已无恢复动作兜底
            const restoreTicks = [0, 40, 140, 320, 680, 1200, 2000];
            state.scroll.settleUntil = Date.now() + restoreTicks[restoreTicks.length - 1] + 300;
            restoreTicks.forEach((delay) => {
                state.scroll.restoreTimeouts.push(setTimeout(() => requestAnimationFrame(attemptRestore), delay));
            });
        }

        function storeScrollPosition(forcePreview = null) {
            const title = String(state.currentTitle || state.scroll.activeTitle || '').trim();

            if (!title) return;

            const titleState = getTitleState(title);
            const preview = getPreviewEl();
            const scroller = getScrollerEl();
            const isPreview = forcePreview != null ? !!forcePreview : isPreviewActive();

            if (isPreview && preview) {
                const progress = readScrollableProgress(preview);
                titleState.previewTop = progress.top;
                titleState.previewRatio = progress.ratio;
            } else if (!isPreview && scroller) {
                const progress = readCodeMirrorProgress();
                titleState.editTop = progress.top;
                titleState.editRatio = progress.ratio;
            }

            setActiveScrollTitle(title);
        }

        function syncMirrorScroll(fromPreview) {
            if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;
            if (!isSideBySideActive()) return;
            if (isToastUiEditor()) return;

            const preview = getPreviewEl();
            const scroller = getScrollerEl();
            const editor = getEditor();

            if (!preview || !scroller || !editor || !editor.codemirror) return;

            if (fromPreview && state.scroll.lastSource === 'editor') return;
            if (!fromPreview && state.scroll.lastSource === 'preview') return;

            state.scroll.lastSource = fromPreview ? 'preview' : 'editor';
            clearTimeout(state.scroll.resetTimer);
            state.scroll.resetTimer = setTimeout(() => {
                state.scroll.lastSource = null;
            }, 50);

            state.scroll.syncLock = true;
            logDebug('mirrorScroll:start', {
                fromPreview,
                preview: summarizeNode(preview),
                scroller: summarizeNode(scroller),
                layout: collectLayoutSnapshot()
            });

            requestAnimationFrame(() => {
                try {
                    const anchorMap = getKnowledgeScrollAnchorMap(preview, editor.codemirror);

                    if (!anchorMap) {
                        logDebug('mirrorScroll:skip', {
                            fromPreview,
                            reason: 'no_semantic_anchor_map'
                        });
                        return;
                    }

                    if (fromPreview) {
                        const previewProgress = readScrollableProgress(preview);
                        const targetTop = projectKnowledgeScrollTop(
                            anchorMap,
                            'previewTop',
                            'editorTop',
                            previewProgress.top
                        );

                        editor.codemirror.scrollTo(null, targetTop);

                        logDebug('mirrorScroll:applyToEditor', {
                            previewProgress,
                            targetTop,
                            anchorPairs: anchorMap.pairCount
                        });
                    } else {
                        const cmProgress = readCodeMirrorProgress();
                        const targetTop = projectKnowledgeScrollTop(
                            anchorMap,
                            'editorTop',
                            'previewTop',
                            cmProgress.top
                        );

                        preview.scrollTop = targetTop;
                        logDebug('mirrorScroll:applyToPreview', {
                            cmProgress,
                            targetTop,
                            anchorPairs: anchorMap.pairCount
                        });
                    }
                } finally {
                    requestAnimationFrame(() => {
                        state.scroll.syncLock = false;
                        logDebug('mirrorScroll:end', {
                            fromPreview,
                            preview: summarizeNode(preview),
                            scroller: summarizeNode(scroller)
                        });
                    });
                }
            });
        }

        function readActiveTitle() {
            return String(state.currentTitle || state.scroll.activeTitle || '').trim();
        }

        function bindScrollTracking() {
            const title = readActiveTitle();

            if (!title) return;

            const preview = getPreviewEl();

            if (preview && preview.dataset.nexoraScrollBound !== '1') {
                preview.dataset.nexoraScrollBound = '1';

                // 记录用户输入时间戳，供稳定窗口内区分"用户滚动"与"渲染引起的滚动"
                ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((eventName) => {
                    preview.addEventListener(eventName, () => {
                        state.scroll.lastUserInputAt = Date.now();
                    }, { passive: true, capture: true });
                });

                preview.addEventListener('scroll', () => {
                    // 稳定窗口内（打开/切换刚结束）：
                    // - 分屏模式有独立的编辑器↔预览滚动同步(syncToastExactScroll)，吸附会
                    //   与之冲突导致编辑器卡死在顶部，故直接走下方正常逻辑交给同步机制
                    // - 纯预览模式下，对非用户触发的滚动（ToastUI 异步渲染）立即吸附回目标
                    //   消除"跳底闪烁"；用户真实滚动走正常逻辑不被干扰
                    if (Date.now() < state.scroll.settleUntil && !isSideBySideActive()) {
                        const recentUserInput = Date.now() - (state.scroll.lastUserInputAt || 0) < 150;

                        if (!recentUserInput) {
                            requestAnimationFrame(() => {
                                if (Date.now() < state.scroll.settleUntil && state.scroll.targetIsPreview) {
                                    applyScrollableProgress(preview, state.scroll.targetTop, state.scroll.targetRatio);
                                }
                            });
                            return;
                        }
                    }

                    cancelRestores();

                    if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;

                    const activeTitle = readActiveTitle();

                    if (!activeTitle) return;

                    const titleState = getTitleState(activeTitle);
                    const progress = readScrollableProgress(preview);
                    titleState.previewTop = progress.top;
                    titleState.previewRatio = progress.ratio;
                    setActiveScrollTitle(activeTitle);
                    logDebug('previewScroll', {
                        title: activeTitle,
                        top: progress.top,
                        ratio: progress.ratio,
                        preview: summarizeNode(preview)
                    });
                    syncMirrorScroll(true);
                }, { passive: true });
            }

            const scroller = getScrollerEl();

            if (scroller && scroller.dataset.nexoraScrollBound !== '1') {
                scroller.dataset.nexoraScrollBound = '1';
                scroller.addEventListener('scroll', () => {
                    // 稳定窗口内同预览监听器：不取消恢复、不记录瞬时位置
                    if (Date.now() < state.scroll.settleUntil) return;

                    cancelRestores();

                    if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;

                    const editor = getEditor();

                    if (!editor || !editor.codemirror) return;

                    const activeTitle = readActiveTitle();

                    if (!activeTitle) return;

                    const titleState = getTitleState(activeTitle);
                    const progress = editor && editor.__editorType === 'toastui'
                        ? readScrollableProgress(scroller)
                        : readCodeMirrorProgress();
                    titleState.editTop = progress.top;
                    titleState.editRatio = progress.ratio;
                    setActiveScrollTitle(activeTitle);
                    logDebug('editScroll', {
                        title: activeTitle,
                        top: progress.top,
                        ratio: progress.ratio,
                        scroller: summarizeNode(scroller)
                    });
                    syncMirrorScroll(false);
                }, { passive: true });
            }

            const editor = getEditor();

            if (editor && editor.__editorType === 'toastui' && editor.codemirror && typeof editor.codemirror.on === 'function') {
                if (editor.codemirror.__nexoraScrollBound !== true) {
                    editor.codemirror.__nexoraScrollBound = true;
                    editor.codemirror.on('scroll', () => {
                        cancelRestores();

                        if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;

                        const activeTitle = readActiveTitle();

                        if (!activeTitle) return;

                        const titleState = getTitleState(activeTitle);
                        const progress = readCodeMirrorProgress();
                        titleState.editTop = progress.top;
                        titleState.editRatio = progress.ratio;
                        setActiveScrollTitle(activeTitle);
                        logDebug('editScroll:cm', {
                            title: activeTitle,
                            top: progress.top,
                            ratio: progress.ratio,
                            scroller: summarizeNode(getScrollerEl())
                        });
                        syncMirrorScroll(false);
                    });
                }
            }

            const proseMirror = getProseMirrorEl();

            if (proseMirror && proseMirror.dataset.nexoraPmBound !== '1') {
                proseMirror.dataset.nexoraPmBound = '1';
                proseMirror.addEventListener('scroll', () => {
                    cancelRestores();

                    if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;

                    const activeTitle = readActiveTitle();

                    if (!activeTitle) return;

                    const titleState = getTitleState(activeTitle);
                    const progress = readScrollableProgress(proseMirror);
                    titleState.editTop = progress.top;
                    titleState.editRatio = progress.ratio;
                    setActiveScrollTitle(activeTitle);
                    logDebug('editScroll:pm', {
                        title: activeTitle,
                        top: progress.top,
                        ratio: progress.ratio,
                        scroller: summarizeNode(proseMirror)
                    });
                    syncMirrorScroll(false);
                }, { passive: true });
            }

            const viewer = getViewerEl();

            if (viewer && !state.scroll.delegatedBound) {
                state.scroll.delegatedBound = true;
                viewer.addEventListener('scroll', (event) => {
                    cancelRestores();

                    if (state.scroll.modeSwitchActive || state.scroll.syncLock) return;

                    const activeTitle = readActiveTitle();

                    if (!activeTitle) return;

                    const target = event && event.target;

                    if (!target || !target.classList) return;

                    if (
                        target.classList.contains('editor-preview-side')
                        || target.classList.contains('editor-preview')
                        || target.classList.contains('editor-preview-full')
                    ) {
                        const titleState = getTitleState(activeTitle);
                        const progress = readScrollableProgress(target);
                        titleState.previewTop = progress.top;
                        titleState.previewRatio = progress.ratio;
                        setActiveScrollTitle(activeTitle);
                        syncMirrorScroll(true);
                        return;
                    }

                    if (target.classList.contains('CodeMirror-scroll')) {
                        const titleState = getTitleState(activeTitle);
                        const progress = readCodeMirrorProgress();
                        titleState.editTop = progress.top;
                        titleState.editRatio = progress.ratio;
                        setActiveScrollTitle(activeTitle);
                        syncMirrorScroll(false);
                    }
                }, true);
            }
        }

        function createToastUiKnowledgeEditor(initialValue = '') {
            const host = document.getElementById('knowledgeEditor');
            const ToastEditor = window.toastui && window.toastui.Editor;
            if (!host || !ToastEditor) return null;

            const getToastCodeMirror = () => {
                try {
                    if (editor && editor.mdEditor && editor.mdEditor.cm) return editor.mdEditor.cm;
                } catch (_) {}
                try {
                    if (editor && typeof editor.getCurrentModeEditor === 'function') {
                        const modeEditor = editor.getCurrentModeEditor();
                        if (modeEditor && modeEditor.cm) return modeEditor.cm;
                    }
                } catch (_) {}
                return null;
            };
            const offsetToCodeMirrorPos = (text, offset) => {
                const source = String(text || '');
                const safeOffset = Math.max(0, Math.min(source.length, Number(offset || 0)));
                const before = source.slice(0, safeOffset);
                const lines = before.split('\n');

                return {
                    line: Math.max(0, lines.length - 1),
                    ch: Math.max(0, String(lines[lines.length - 1] || '').length)
                };
            };
            const getToastUiRoot = () => host.querySelector('.toastui-editor-defaultUI');
            const getToastEditorContainer = () => host.querySelector('.toastui-editor-md-container');
            const getToastVerticalPane = () => (
                host.querySelector('.toastui-editor-md-container .toastui-editor-md-vertical-style')
                || host.querySelector('.toastui-editor-md-vertical-style')
            );
            const getToastEditPane = () => host.querySelector('.toastui-editor-md-container');
            const getToastProseMirrorEl = () => host.querySelector('.ProseMirror');
            const getToastPreviewPane = () => {
                if (typeof editor.getEditorElements !== 'function') return null;

                const elements = editor.getEditorElements();

                return elements && elements.mdPreview ? elements.mdPreview : null;
            };
            const getToastSplitter = () => host.querySelector('.toastui-editor-md-splitter');
            const getToastNativePreviewPane = () => {
                const pane = getToastPreviewPane();

                if (!pane) return null;

                pane.classList.add('nexora-toast-preview');

                return pane;
            };
            const getToastNativeSplitter = () => {
                const splitter = getToastSplitter();

                if (!splitter) return null;

                splitter.classList.add('nexora-toast-splitter');

                return splitter;
            };
            const getToastPreviewContentRoot = () => {
                const pane = getToastNativePreviewPane();
                return pane ? pane.querySelector('.toastui-editor-contents') : null;
            };
            const findBestScrollableDescendant = (root) => {
                if (!root || !root.querySelectorAll) return null;
                const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
                let best = null;
                let bestOverflow = -1;
                candidates.forEach((node) => {
                    if (!node || node.nodeType !== 1) return;
                    const className = String(node.className || '');
                    if (className.includes('nexora-toast-preview')) return;
                    const overflow = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
                    if (overflow <= 0) return;
                    const score = /CodeMirror|ProseMirror|toastui-editor/.test(className) ? overflow + 100000 : overflow;
                    if (score > bestOverflow) {
                        bestOverflow = score;
                        best = node;
                    }
                });
                return best;
            };
            const getToastEditorScroller = () => {
                const proseMirror = getToastProseMirrorEl();
                if (proseMirror) return proseMirror;
                const editPane = getToastEditPane();
                const discovered = findBestScrollableDescendant(editPane);
                if (discovered) return discovered;
                return host.querySelector('.toastui-editor-md-container .CodeMirror-scroll')
                    || host.querySelector('.toastui-editor-md-container .toastui-editor');
            };

            host.innerHTML = '';
            const editor = new ToastEditor({
                el: host,
                initialEditType: 'markdown',
                previewStyle: 'vertical',
                height: '100%',
                initialValue: String(initialValue || ''),
                usageStatistics: false,
                hideModeSwitch: true,
                toolbarItems: []
            });
            try {
                if (typeof editor.changeMode === 'function') {
                    editor.changeMode('markdown', true);
                }
            } catch (_) {}

            let viewMode = 'preview';
            let fullscreen = false;
            let previewRenderDebounceTimer = 0;
            let previewBridgeCleanupFns = [];
            let toastScrollMapTimer = 0;
            let toastScrollMapFrame = 0;
            let toastScrollMap = null;
            let toastScrollSyncLock = false;
            let toastScrollSyncReleaseFrame = 0;
            const previewRenderTypingDelay = 180;

            const collectToastPreviewBlockNodes = (previewRoot) => {
                if (!previewRoot) return [];

                return Array.from(previewRoot.querySelectorAll('[data-nodeid]')).filter((node) => {
                    const parentBlock = node.parentElement
                        ? node.parentElement.closest('[data-nodeid]')
                        : null;

                    return !parentBlock || !previewRoot.contains(parentBlock);
                });
            };

            const readToastMarkdownNodeRange = (toastMark, previewNode, editorLineCount) => {
                const nodeId = Number(previewNode.getAttribute('data-nodeid'));

                if (!Number.isFinite(nodeId)) return null;

                const markdownNode = toastMark.findNodeById(nodeId);
                const sourcePos = markdownNode && Array.isArray(markdownNode.sourcepos)
                    ? markdownNode.sourcepos
                    : null;

                if (!sourcePos || !Array.isArray(sourcePos[0]) || !Array.isArray(sourcePos[1])) return null;

                const startLine = Math.max(0, Math.min(editorLineCount - 1, Number(sourcePos[0][0] || 1) - 1));
                const endLine = Math.max(startLine, Math.min(editorLineCount - 1, Number(sourcePos[1][0] || 1) - 1));

                return {nodeId, startLine, endLine};
            };

            const readToastNodeScrollTop = (node, scroller) => {
                const nodeRect = node.getBoundingClientRect();
                const scrollerRect = scroller.getBoundingClientRect();

                return Math.max(
                    0,
                    Number(scroller.scrollTop || 0)
                        + Number(nodeRect.top || 0)
                        - Number(scrollerRect.top || 0)
                );
            };

            const projectToastScrollTop = (points, sourceKey, targetKey, sourceTop) => {
                if (!Array.isArray(points) || points.length < 2) return null;

                const sourceValue = Math.max(0, Number(sourceTop || 0));
                let lower = points[0];
                let upper = points[points.length - 1];

                for (let index = 1; index < points.length; index += 1) {
                    const point = points[index];

                    if (sourceValue <= Number(point[sourceKey] || 0)) {
                        upper = point;
                        break;
                    }

                    lower = point;
                }

                const sourceStart = Number(lower[sourceKey] || 0);
                const sourceEnd = Number(upper[sourceKey] || 0);
                const targetStart = Number(lower[targetKey] || 0);
                const targetEnd = Number(upper[targetKey] || 0);
                const sourceLength = sourceEnd - sourceStart;
                const progress = sourceLength > 0
                    ? Math.max(0, Math.min(1, (sourceValue - sourceStart) / sourceLength))
                    : 0;

                return Math.round(targetStart + ((targetEnd - targetStart) * progress));
            };

            const rebuildToastExactScrollMap = (reason = 'render') => {
                const previewPane = getToastNativePreviewPane();
                const previewRoot = getToastPreviewContentRoot();
                const proseMirror = getToastProseMirrorEl();
                const markdownEditor = editor && editor.mdEditor;
                const markdownView = markdownEditor && markdownEditor.view;
                const toastMark = markdownEditor && typeof markdownEditor.getToastMark === 'function'
                    ? markdownEditor.getToastMark()
                    : null;

                toastScrollMap = null;

                if (!previewPane || !previewRoot || !proseMirror || !markdownView || !toastMark) {
                    console.error('[KnowledgeEditor] 精确滚动映射初始化失败', {
                        reason,
                        previewPane: !!previewPane,
                        previewRoot: !!previewRoot,
                        proseMirror: !!proseMirror,
                        markdownView: !!markdownView,
                        toastMark: !!toastMark
                    });
                    return null;
                }

                const editorLines = Array.from(markdownView.dom.children || []);
                const previewBlocks = collectToastPreviewBlockNodes(previewRoot);
                const editorMax = Math.max(0, Number(proseMirror.scrollHeight || 0) - Number(proseMirror.clientHeight || 0));
                const previewMax = Math.max(0, Number(previewPane.scrollHeight || 0) - Number(previewPane.clientHeight || 0));
                const points = [{editorTop: 0, previewTop: 0, nodeId: 0}];

                previewBlocks.forEach((previewNode) => {
                    const range = readToastMarkdownNodeRange(toastMark, previewNode, editorLines.length);

                    if (!range) return;

                    const editorNode = editorLines[range.startLine];

                    if (!editorNode) return;

                    const editorTop = Math.max(0, Math.min(editorMax, Number(editorNode.offsetTop || 0)));
                    const previewTop = Math.max(0, Math.min(previewMax, readToastNodeScrollTop(previewNode, previewPane)));
                    const previous = points[points.length - 1];

                    if (editorTop < previous.editorTop || previewTop < previous.previewTop) return;
                    if (editorTop === previous.editorTop && previewTop === previous.previewTop) return;

                    points.push({editorTop, previewTop, nodeId: range.nodeId});
                });

                const lastPoint = points[points.length - 1];

                if (lastPoint.editorTop !== editorMax || lastPoint.previewTop !== previewMax) {
                    points.push({editorTop: editorMax, previewTop: previewMax, nodeId: -1});
                }

                if (points.length < 2) {
                    console.error('[KnowledgeEditor] 精确滚动映射没有生成有效锚点', {
                        reason,
                        editorLines: editorLines.length,
                        previewBlocks: previewBlocks.length,
                        editorMax,
                        previewMax
                    });
                    return null;
                }

                toastScrollMap = {points, editorMax, previewMax};
                window.__nexoraKnowledgeBlockSyncStats = {
                    reason,
                    editorLines: editorLines.length,
                    previewBlocks: previewBlocks.length,
                    scrollPoints: points.length,
                    editorMax,
                    previewMax
                };

                return toastScrollMap;
            };

            const releaseToastScrollSyncLock = () => {
                if (toastScrollSyncReleaseFrame) cancelAnimationFrame(toastScrollSyncReleaseFrame);

                toastScrollSyncReleaseFrame = requestAnimationFrame(() => {
                    toastScrollSyncReleaseFrame = 0;
                    toastScrollSyncLock = false;
                });
            };

            const syncToastExactScroll = (fromPreview) => {
                if (viewMode !== 'split' || toastScrollSyncLock) return;

                const previewPane = getToastNativePreviewPane();
                const proseMirror = getToastProseMirrorEl();
                const editorMax = proseMirror
                    ? Math.max(0, Number(proseMirror.scrollHeight || 0) - Number(proseMirror.clientHeight || 0))
                    : 0;
                const previewMax = previewPane
                    ? Math.max(0, Number(previewPane.scrollHeight || 0) - Number(previewPane.clientHeight || 0))
                    : 0;
                const map = !toastScrollMap
                    || Math.abs(Number(toastScrollMap.editorMax || 0) - editorMax) > 2
                    || Math.abs(Number(toastScrollMap.previewMax || 0) - previewMax) > 2
                    ? rebuildToastExactScrollMap('scroll-range-change')
                    : toastScrollMap;

                if (!previewPane || !proseMirror || !map) return;

                toastScrollSyncLock = true;

                if (fromPreview) {
                    const previewTop = Math.max(0, Number(previewPane.scrollTop || 0));
                    const atBottom = map.previewMax - previewTop <= 2;
                    const targetTop = atBottom
                        ? map.editorMax
                        : projectToastScrollTop(map.points, 'previewTop', 'editorTop', previewTop);

                    if (targetTop !== null) proseMirror.scrollTop = targetTop;
                } else {
                    const editorTop = Math.max(0, Number(proseMirror.scrollTop || 0));
                    const atBottom = map.editorMax - editorTop <= 2;
                    const targetTop = atBottom
                        ? map.previewMax
                        : projectToastScrollTop(map.points, 'editorTop', 'previewTop', editorTop);

                    if (targetTop !== null) previewPane.scrollTop = targetTop;
                }

                releaseToastScrollSyncLock();
            };

            const scheduleToastExactScrollMapRebuild = (reason = 'render', delay = 40) => {
                clearTimeout(toastScrollMapTimer);

                if (toastScrollMapFrame) {
                    cancelAnimationFrame(toastScrollMapFrame);
                    toastScrollMapFrame = 0;
                }

                if (viewMode !== 'split') return;

                toastScrollMapTimer = setTimeout(() => {
                    toastScrollMapTimer = 0;
                    toastScrollMapFrame = requestAnimationFrame(() => {
                        toastScrollMapFrame = requestAnimationFrame(() => {
                            toastScrollMapFrame = 0;
                            rebuildToastExactScrollMap(reason);
                        });
                    });
                }, Math.max(0, Number(delay || 0)));
            };

            const queueToastPreviewRender = (
                preserveScroll = false,
                delay = previewRenderTypingDelay,
                markdownSnapshot = String(editor.getMarkdown() || '')
            ) => {
                if (viewMode === 'edit') return;

                if (previewRenderDebounceTimer) {
                    clearTimeout(previewRenderDebounceTimer);
                    previewRenderDebounceTimer = 0;
                }

                previewRenderDebounceTimer = setTimeout(() => {
                    previewRenderDebounceTimer = 0;
                    renderToastPreview(preserveScroll, markdownSnapshot);
                }, Math.max(0, Number(delay || 0)));
            };

            const renderToastPreview = (
                preserveScroll = true,
                markdownSnapshot = String(editor.getMarkdown() || '')
            ) => {
                if (viewMode === 'edit') return;

                const pane = getToastNativePreviewPane();
                const root = getToastPreviewContentRoot();
                if (!pane || !root) return;
                const markdown = String(markdownSnapshot || '');

                if (String(editor.getMarkdown() || '') !== markdown) return;

                bindSourceMarkdown(root, markdown);
                renderMathSafe(root);
                toastScrollMap = null;
                scheduleToastExactScrollMapRebuild('preview-render', 40);
                if (isDebugEnabled()) {
                    logDebug('toastPreviewRender', {
                        preserveScroll,
                        markdownLength: markdown.length,
                        pane: summarizeNode(pane),
                        root: summarizeNode(root)
                    });
                }
            };
            const setViewMode = (mode) => {
                logDebug('toastSetViewMode:start', {
                    requestedMode: mode,
                    previousMode: viewMode,
                    layout: collectLayoutSnapshot()
                });
                viewMode = String(mode || 'split');
                host.classList.remove('knowledge-toast-mode-edit', 'knowledge-toast-mode-preview', 'knowledge-toast-mode-split');
                if (viewMode === 'edit') {
                    host.classList.add('knowledge-toast-mode-edit');
                } else if (viewMode === 'preview') {
                    host.classList.add('knowledge-toast-mode-preview');
                } else {
                    viewMode = 'split';
                    host.classList.add('knowledge-toast-mode-split');
                }

                const toolbar = host.querySelector('.editor-toolbar');
                if (toolbar) {
                    const previewBtn = toolbar.querySelector('.preview');
                    const sideBtn = toolbar.querySelector('.side-by-side');
                    if (previewBtn) previewBtn.classList.toggle('active', viewMode === 'preview');
                    if (sideBtn) sideBtn.classList.toggle('active', viewMode === 'split');
                }

                try {
                    if (typeof editor.changePreviewStyle === 'function') {
                        editor.changePreviewStyle('vertical');
                    }
                } catch (_) {}

                const mdContainer = getToastEditorContainer();
                const uiRoot = getToastUiRoot();
                const editPane = getToastEditPane();
                const previewPane = getToastNativePreviewPane();
                const splitter = getToastNativeSplitter();
                const builtInPreview = getToastPreviewPane();
                const builtInSplitter = getToastSplitter();
                if (builtInPreview && builtInPreview !== previewPane) builtInPreview.style.setProperty('display', 'none', 'important');
                if (builtInSplitter && builtInSplitter !== splitter) builtInSplitter.style.setProperty('display', 'none', 'important');
                if (uiRoot && mdContainer && editPane && previewPane && splitter) {
                    if (previewPane.parentElement !== uiRoot) {
                        uiRoot.appendChild(previewPane);
                    }
                    if (splitter.parentElement !== uiRoot) {
                        uiRoot.appendChild(splitter);
                    }
                    mdContainer.classList.add('nexora-toast-layout');
                    editPane.classList.add('nexora-toast-edit-pane');
                    previewPane.classList.add('nexora-toast-preview-pane');
                    splitter.classList.add('nexora-toast-divider');
                    uiRoot.classList.remove('nexora-mode-edit', 'nexora-mode-preview', 'nexora-mode-split');
                    uiRoot.classList.add(viewMode === 'split' ? 'nexora-mode-split' : (viewMode === 'preview' ? 'nexora-mode-preview' : 'nexora-mode-edit'));

                    uiRoot.style.setProperty('display', 'grid', 'important');
                    uiRoot.style.setProperty('grid-template-rows', 'auto minmax(0, 1fr)', 'important');
                    uiRoot.style.setProperty('align-items', 'stretch', 'important');
                    uiRoot.style.setProperty('min-height', '0', 'important');
                    uiRoot.style.setProperty('height', '100%', 'important');

                    const toolbarEl = toolbar;
                    if (toolbarEl) {
                        toolbarEl.style.setProperty('grid-row', '1', 'important');
                        toolbarEl.style.setProperty('grid-column', '1 / -1', 'important');
                    }

                    editPane.style.setProperty('min-height', '0', 'important');
                    editPane.style.setProperty('height', '100%', 'important');
                    editPane.style.setProperty('overflow', 'hidden', 'important');
                    editPane.style.setProperty('position', 'relative', 'important');
                    editPane.style.setProperty('grid-row', '2', 'important');

                    previewPane.style.setProperty('min-height', '0', 'important');
                    previewPane.style.setProperty('height', '100%', 'important');
                    previewPane.style.setProperty('overflow-y', 'auto', 'important');
                    previewPane.style.setProperty('overflow-x', 'hidden', 'important');
                    previewPane.style.setProperty('position', 'relative', 'important');
                    previewPane.style.setProperty('grid-row', '2', 'important');

                    splitter.style.setProperty('width', '1px', 'important');
                    splitter.style.setProperty('min-width', '1px', 'important');
                    splitter.style.setProperty('background', '#e5e7eb', 'important');
                    splitter.style.setProperty('grid-row', '2', 'important');

                    if (viewMode === 'split') {
                        uiRoot.style.setProperty('grid-template-columns', 'minmax(0, 1fr) 1px minmax(0, 1fr)', 'important');
                        editPane.style.setProperty('display', 'block', 'important');
                        editPane.style.setProperty('grid-column', '1', 'important');
                        previewPane.style.setProperty('display', 'block', 'important');
                        previewPane.style.setProperty('grid-column', '3', 'important');
                        splitter.style.setProperty('display', 'block', 'important');
                        splitter.style.setProperty('grid-column', '2', 'important');
                    } else if (viewMode === 'preview') {
                        uiRoot.style.setProperty('grid-template-columns', 'minmax(0, 1fr)', 'important');
                        editPane.style.setProperty('display', 'none', 'important');
                        previewPane.style.setProperty('display', 'block', 'important');
                        previewPane.style.setProperty('grid-column', '1', 'important');
                        splitter.style.setProperty('display', 'none', 'important');
                    } else {
                        uiRoot.style.setProperty('grid-template-columns', 'minmax(0, 1fr)', 'important');
                        editPane.style.setProperty('display', 'block', 'important');
                        editPane.style.setProperty('grid-column', '1', 'important');
                        previewPane.style.setProperty('display', 'none', 'important');
                        splitter.style.setProperty('display', 'none', 'important');
                    }
                }

                if (toolbar) {
                    toolbar.querySelectorAll('[data-cmd]').forEach((node) => {
                        node.classList.toggle('disabled', viewMode === 'preview');
                        node.setAttribute('aria-disabled', viewMode === 'preview' ? 'true' : 'false');
                    });
                }
                renderToastPreview(viewMode !== 'preview');
                if (viewMode === 'split') {
                    toastScrollMap = null;
                    scheduleToastExactScrollMapRebuild('mode-switch', 120);
                } else {
                    toastScrollMap = null;
                }
                requestAnimationFrame(() => {
                    const cm = getToastCodeMirror();
                    try {
                        if (cm && typeof cm.refresh === 'function') cm.refresh();
                    } catch (_) {}
                    logDebug('toastSetViewMode:afterRefresh', {
                        finalMode: viewMode,
                        layoutBrief: {
                            verticalParent: uiRoot ? String(uiRoot.className || '') : '',
                            verticalDisplay: uiRoot ? String((window.getComputedStyle(uiRoot).display || '')) : '',
                            verticalColumns: uiRoot ? String((window.getComputedStyle(uiRoot).gridTemplateColumns || '')) : '',
                            editParent: editPane && editPane.parentElement ? String(editPane.parentElement.className || '') : '',
                            previewParent: previewPane && previewPane.parentElement ? String(previewPane.parentElement.className || '') : '',
                            editDisplay: editPane ? String((window.getComputedStyle(editPane).display || '')) : '',
                            previewDisplay: previewPane ? String((window.getComputedStyle(previewPane).display || '')) : '',
                            splitterDisplay: splitter ? String((window.getComputedStyle(splitter).display || '')) : ''
                        },
                        layout: collectLayoutSnapshot()
                    });
                });
            };

            const setFullscreen = (enabled) => {
                fullscreen = !!enabled;
                host.classList.toggle('knowledge-toast-fullscreen', fullscreen);
                const toolbar = host.querySelector('.editor-toolbar');
                if (toolbar) {
                    const fullBtn = toolbar.querySelector('.fullscreen');
                    if (fullBtn) fullBtn.classList.toggle('active', fullscreen);
                }
            };

            const commandAliases = {
                heading: ['heading'],
                bold: ['bold'],
                italic: ['italic'],
                strike: ['strike'],
                quote: ['blockQuote', 'quote'],
                ul: ['bulletList', 'unorderedList', 'ul'],
                ol: ['orderedList', 'ol'],
                link: ['addLink', 'link'],
                image: ['addImage', 'image'],
                table: ['addTable', 'table']
            };

            const runToastCommand = (aliases, payload) => {
                const list = Array.isArray(aliases) ? aliases : [aliases];
                for (let i = 0; i < list.length; i++) {
                    const name = String(list[i] || '').trim();
                    if (!name) continue;
                    try {
                        const result = typeof payload === 'undefined'
                            ? editor.exec(name)
                            : editor.exec(name, payload);
                        if (result !== false) return true;
                    } catch (_) {}
                }
                return false;
            };

            const getSelectedMarkdownText = () => {
                try {
                    if (typeof editor.getSelectedText === 'function') {
                        return String(editor.getSelectedText() || '').trim();
                    }
                } catch (_) {}
                return '';
            };

            const insertMarkdownFallback = (markdown) => {
                const text = String(markdown || '');
                if (!text) return;
                try {
                    if (typeof editor.replaceSelection === 'function') {
                        editor.replaceSelection(text);
                        return;
                    }
                } catch (_) {}
                try {
                    if (typeof editor.insertText === 'function') {
                        editor.insertText(text);
                        return;
                    }
                } catch (_) {}
                try {
                    const current = String(editor.getMarkdown() || '');
                    editor.setMarkdown(current + text, false);
                } catch (_) {}
            };

            const replaceKnowledgeImagePlaceholder = (placeholderToken, resolveMarkdown) => {
                const token = String(placeholderToken || '').trim();
                if (!token) return false;
                const markdown = String(editor.getMarkdown() || '');
                if (!markdown.includes(token)) return false;
                const cm = getToastCodeMirror();
                const scroller = getToastEditorScroller();
                const windowScrollY = Number(window.scrollY || window.pageYOffset || 0);
                const cmScrollInfo = cm && typeof cm.getScrollInfo === 'function' ? cm.getScrollInfo() : null;
                const cmSelections = cm && typeof cm.listSelections === 'function' ? cm.listSelections() : null;
                const cmCursor = cm && typeof cm.getCursor === 'function' ? cm.getCursor() : null;
                const scrollerTop = scroller ? Number(scroller.scrollTop || 0) : 0;
                const scrollerLeft = scroller ? Number(scroller.scrollLeft || 0) : 0;
                const escapedToken = escapeRegexPattern(token);
                const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedToken}\\)`, 'g');
                let changed = false;
                const next = markdown.replace(pattern, (_, altText) => {
                    changed = true;
                    const safeAlt = String(altText || '').trim();
                    const out = resolveMarkdown(safeAlt);
                    return String(out || '');
                });
                if (!changed) return false;
                editor.setMarkdown(next, false);
                if (cm) {
                    try {
                        if (cmSelections && cmSelections.length > 0 && typeof cm.setSelections === 'function') {
                            cm.setSelections(cmSelections);
                        } else if (cmCursor && typeof cm.setCursor === 'function') {
                            cm.setCursor(cmCursor);
                        }
                    } catch (_) {}
                }
                if (cm && cmScrollInfo && typeof cm.scrollTo === 'function') {
                    cm.scrollTo(Number(cmScrollInfo.left || 0), Number(cmScrollInfo.top || 0));
                }
                if (scroller) {
                    scroller.scrollTop = scrollerTop;
                    scroller.scrollLeft = scrollerLeft;
                }
                requestAnimationFrame(() => {
                    if (cm) {
                        try {
                            if (cmSelections && cmSelections.length > 0 && typeof cm.setSelections === 'function') {
                                cm.setSelections(cmSelections);
                            } else if (cmCursor && typeof cm.setCursor === 'function') {
                                cm.setCursor(cmCursor);
                            }
                        } catch (_) {}
                    }
                    if (scroller) {
                        scroller.scrollTop = scrollerTop;
                        scroller.scrollLeft = scrollerLeft;
                    }
                    window.scrollTo(window.scrollX || 0, windowScrollY);
                });
                return true;
            };

            const allocateAndUploadKnowledgeImage = async (file) => {
                const picked = normalizeUploadFile(file, 0) || file;
                const mime = String((picked && picked.type) || '').toLowerCase();
                if (!mime.startsWith('image/')) {
                    throw new Error('仅支持图片文件');
                }
                const size = Number((picked && picked.size) || 0);
                if (size > 12 * 1024 * 1024) {
                    throw new Error('图片过大，请控制在 12MB 以内');
                }
                const fileName = normalizeKnowledgeImageFileName(picked, `knowledge-image-${Date.now()}`);
                const basisTitle = String(state.currentTitle || '').trim();
                const allocated = await allocateKnowledgeImageSlot(fileName, basisTitle);
                const imageId = String(allocated.image_id || '').trim().toLowerCase();
                if (!imageId) {
                    throw new Error('图片分配失败：image_id 为空');
                }
                const placeholderToken = buildKnowledgeImagePlaceholderToken(imageId);
                if (!placeholderToken) {
                    throw new Error('图片分配失败：占位符无效');
                }
                const placeholderMarkdown = buildKnowledgeImagePlaceholderMarkdown(placeholderToken, `${knowledgeImagePendingAlt} ${fileName}`);
                insertMarkdownFallback(`${placeholderMarkdown}\n`);
                trackPendingImageUpload(imageId, {
                    imageId,
                    fileName,
                    placeholderToken,
                    startedAt: Date.now()
                });

                try {
                    const uploaded = await uploadKnowledgeImageByFile({
                        imageId,
                        file: picked,
                        fileName,
                        basisTitle
                    });
                    const finalUrl = String(uploaded.image_url || '').trim();
                    if (!finalUrl) {
                        throw new Error('上传成功但返回地址为空');
                    }
                    const replaced = replaceKnowledgeImagePlaceholder(placeholderToken, (existingAlt) => {
                        const alt = normalizeKnowledgeImageAltText(existingAlt || fileName);
                        return `![${alt}](${finalUrl})`;
                    });
                    if (!replaced) {
                        showToast(`图片已上传：${fileName}（占位符已被删除，可手动插入）`);
                    } else {
                        showToast(`图片已上传：${fileName}`);
                    }
                    return uploaded;
                } catch (err) {
                    const errText = String((err && err.message) || err || '上传失败').trim() || '上传失败';
                    replaceKnowledgeImagePlaceholder(placeholderToken, () => {
                        const failedAlt = `${knowledgeImageFailedAlt} ${normalizeKnowledgeImageAltText(fileName)}`;
                        return `![${failedAlt}](${placeholderToken})`;
                    });
                    throw new Error(errText);
                } finally {
                    releasePendingImageUpload(imageId);
                }
            };

            const handleKnowledgeImageFiles = async (files) => {
                const items = Array.isArray(files) ? files : [];
                const imageFiles = items.filter((f) => {
                    const mime = String((f && f.type) || '').toLowerCase();
                    return mime.startsWith('image/');
                });
                if (!imageFiles.length) return;
                for (let i = 0; i < imageFiles.length; i++) {
                    try {
                        await allocateAndUploadKnowledgeImage(imageFiles[i]);
                    } catch (err) {
                        showToast(String((err && err.message) || err || '图片上传失败'));
                    }
                }
            };

            const handleToolbarCommand = async (cmd) => {
                const command = String(cmd || '').trim();
                if (!command) return;

                if (command === 'heading' || command.startsWith('heading:')) {
                    let level = 2;
                    if (command.startsWith('heading:')) {
                        const parsedLevel = Number(command.split(':')[1] || 2);
                        if (Number.isFinite(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 6) {
                            level = parsedLevel;
                        }
                    }
                    if (!runToastCommand(commandAliases.heading, { level })) {
                        insertMarkdownFallback(`\n${'#'.repeat(level)} 标题`);
                    }
                    return;
                }

                if (command === 'link') {
                    const selected = getSelectedMarkdownText();
                    const linkUrl = 'https://';
                    const linkText = selected || '链接文本';
                    if (!runToastCommand(commandAliases.link, { linkUrl, linkText })) {
                        insertMarkdownFallback(`[${linkText}](${linkUrl})`);
                    }
                    showToast('已插入链接模板');
                    return;
                }

                if (command === 'image') {
                    const picker = document.createElement('input');
                    picker.type = 'file';
                    picker.accept = 'image/*';
                    picker.multiple = true;
                    picker.style.display = 'none';
                    document.body.appendChild(picker);
                    const cleanupPicker = () => {
                        if (picker.parentNode) picker.parentNode.removeChild(picker);
                    };
                    picker.addEventListener('change', async () => {
                        const files = picker.files ? Array.from(picker.files) : [];
                        try {
                            await handleKnowledgeImageFiles(files);
                        } finally {
                            cleanupPicker();
                        }
                    }, { once: true });
                    setTimeout(cleanupPicker, 60000);
                    picker.click();
                    if (!picker.parentNode) {
                        const altText = getSelectedMarkdownText() || '图片描述';
                        if (!runToastCommand(commandAliases.image, { imageUrl: 'https://', altText })) {
                            insertMarkdownFallback(`![${altText}](https://)`);
                        }
                    }
                    return;
                }

                if (command === 'table') {
                    const rowCount = 2;
                    const columnCount = 2;
                    if (!runToastCommand(commandAliases.table, { rowCount, columnCount })) {
                        const headers = Array.from({ length: columnCount }, (_, i) => `列${i + 1}`);
                        const divider = Array.from({ length: columnCount }, () => '---');
                        const body = Array.from({ length: Math.max(1, rowCount - 1) }, () => `| ${Array.from({ length: columnCount }, () => ' ').join(' | ')} |`).join('\n');
                        insertMarkdownFallback(`\n| ${headers.join(' | ')} |\n| ${divider.join(' | ')} |\n${body}`);
                    }
                    showToast('已插入表格模板');
                    return;
                }

                const aliases = commandAliases[command] || [command];
                if (!runToastCommand(aliases)) {
                    if (command === 'quote') insertMarkdownFallback('\n> ');
                    if (command === 'ul') insertMarkdownFallback('\n- ');
                    if (command === 'ol') insertMarkdownFallback('\n1. ');
                }
            };

            const toolbar = document.createElement('div');
            toolbar.className = 'editor-toolbar';
            toolbar.innerHTML = `
                <div class="heading-control">
                    <a role="button" tabindex="0" class="heading" data-cmd="heading" title="标题"><i class="fa fa-header"></i></a>
                    <div class="heading-menu" hidden>
                        <button type="button" class="heading-option" data-cmd="heading:1">#</button>
                        <button type="button" class="heading-option" data-cmd="heading:2">##</button>
                        <button type="button" class="heading-option" data-cmd="heading:3">###</button>
                        <button type="button" class="heading-option" data-cmd="heading:4">####</button>
                    </div>
                </div>
                <a role="button" tabindex="0" class="bold" data-cmd="bold" title="粗体"><i class="fa fa-bold"></i></a>
                <a role="button" tabindex="0" class="italic" data-cmd="italic" title="斜体"><i class="fa fa-italic"></i></a>
                <a role="button" tabindex="0" class="strikethrough" data-cmd="strike" title="删除线"><i class="fa fa-strikethrough"></i></a>
                <i class="separator"></i>
                <a role="button" tabindex="0" class="quote" data-cmd="quote" title="引用"><i class="fa fa-quote-left"></i></a>
                <a role="button" tabindex="0" class="unordered-list" data-cmd="ul" title="无序列表"><i class="fa fa-list-ul"></i></a>
                <a role="button" tabindex="0" class="ordered-list" data-cmd="ol" title="有序列表"><i class="fa fa-list-ol"></i></a>
                <a role="button" tabindex="0" class="link" data-cmd="link" title="链接"><i class="fa fa-link"></i></a>
                <a role="button" tabindex="0" class="image" data-cmd="image" title="图片"><i class="fa-solid fa-image"></i></a>
                <a role="button" tabindex="0" class="table" data-cmd="table" title="表格"><i class="fa fa-table"></i></a>
                <i class="separator"></i>
                <a role="button" tabindex="0" class="preview" data-action="preview" title="预览"><i class="fa fa-eye"></i></a>
                <a role="button" tabindex="0" class="side-by-side" data-action="split" title="分屏"><i class="fa fa-columns"></i></a>
                <a role="button" tabindex="0" class="fullscreen" data-action="fullscreen" title="全屏"><i class="fa fa-arrows-alt"></i></a>
            `;
            toolbar.addEventListener('click', (e) => {
                const btn = e.target && e.target.closest ? e.target.closest('[data-cmd], [data-action]') : null;
                if (!btn || !toolbar.contains(btn)) return;
                e.preventDefault();
                const headingControl = btn.closest('.heading-control');
                if (headingControl && btn.classList.contains('heading')) {
                    const menu = headingControl.querySelector('.heading-menu');
                    if (menu) {
                        const willShow = !!menu.hidden;
                        toolbar.querySelectorAll('.heading-menu').forEach((node) => {
                            node.hidden = true;
                        });
                        menu.hidden = !willShow;
                    }
                    return;
                }
                toolbar.querySelectorAll('.heading-menu').forEach((node) => {
                    node.hidden = true;
                });
                const cmd = String(btn.dataset.cmd || '');
                const action = String(btn.dataset.action || '');
                logDebug('toastToolbarClick', {
                    cmd,
                    action,
                    currentMode: viewMode,
                    layout: collectLayoutSnapshot()
                });
                if (cmd) {
                    if (viewMode === 'preview') return;
                    void handleToolbarCommand(cmd);
                    return;
                }
                if (action === 'preview') {
                    const editProgress = readScrollableProgress(getToastEditorScroller());
                    const snapshot = {
                        title: String(state.currentTitle || '').trim(),
                        sourceMode: viewMode,
                        previewTop: readScrollableProgress(getPreviewEl()).top,
                        previewRatio: readScrollableProgress(getPreviewEl()).ratio,
                        editTop: editProgress.top,
                        editRatio: editProgress.ratio
                    };
                    setViewMode(viewMode === 'preview' ? 'edit' : 'preview');
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 0);
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 80);
                    return;
                }
                if (action === 'split') {
                    const editProgress = readScrollableProgress(getToastEditorScroller());
                    const snapshot = {
                        title: String(state.currentTitle || '').trim(),
                        sourceMode: viewMode,
                        previewTop: readScrollableProgress(getPreviewEl()).top,
                        previewRatio: readScrollableProgress(getPreviewEl()).ratio,
                        editTop: editProgress.top,
                        editRatio: editProgress.ratio
                    };
                    setViewMode(viewMode === 'split' ? 'edit' : 'split');
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 0);
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 80);
                    return;
                }
                if (action === 'fullscreen') {
                    setFullscreen(!fullscreen);
                }
            });
            if (!window.__nexoraKnowledgeHeadingMenuDismissBound) {
                document.addEventListener('pointerdown', (e) => {
                    const editorToolbar = document.querySelector('#knowledgeViewer .editor-toolbar');
                    if (!editorToolbar || editorToolbar.contains(e.target)) return;
                    editorToolbar.querySelectorAll('.heading-menu').forEach((node) => {
                        node.hidden = true;
                    });
                });
                window.__nexoraKnowledgeHeadingMenuDismissBound = true;
            }

            const uiRoot = host.querySelector('.toastui-editor-defaultUI');
            if (uiRoot) {
                const toastToolbar = uiRoot.querySelector('.toastui-editor-toolbar');
                if (toastToolbar) {
                    toastToolbar.style.display = 'none';
                }
                if (uiRoot.firstChild) {
                    uiRoot.insertBefore(toolbar, uiRoot.firstChild);
                } else {
                    uiRoot.appendChild(toolbar);
                }
            } else {
                host.insertBefore(toolbar, host.firstChild);
            }
            setViewMode('preview');
            try {
                if (typeof editor.on === 'function') {
                    const onEditorChange = () => {
                        const markdownSnapshot = String(editor.getMarkdown() || '');

                        toastScrollMap = null;
                        queueToastPreviewRender(true, previewRenderTypingDelay, markdownSnapshot);

                        if (
                            state.collabClient
                            && state.collabClient.isActive()
                            && !state.collabApplyingRemote
                        ) {
                            state.collabClient.notifyLocalChange();
                        }
                    };
                    editor.on('change', onEditorChange);
                }
            } catch (_) {}

            const handlePasteImageUploadEvent = (evt) => {
                const files = extractFilesFromClipboardEvent(evt).filter((f) => {
                    const mime = String((f && f.type) || '').toLowerCase();
                    return mime.startsWith('image/');
                });
                if (!files.length) return false;
                evt.preventDefault();
                evt.stopPropagation();
                void handleKnowledgeImageFiles(files);
                return true;
            };

            const handleDropImageUploadEvent = (evt) => {
                const dt = evt && evt.dataTransfer ? evt.dataTransfer : null;
                if (!dt || !dt.files || dt.files.length <= 0) return false;
                const files = Array.from(dt.files)
                    .map((f, idx) => normalizeUploadFile(f, idx))
                    .filter((f) => {
                        const mime = String((f && f.type) || '').toLowerCase();
                        return mime.startsWith('image/');
                    });
                if (!files.length) return false;
                evt.preventDefault();
                evt.stopPropagation();
                void handleKnowledgeImageFiles(files);
                return true;
            };

            const bindKnowledgeImageUploadBridge = () => {
                const targets = [];
                const scroller = getToastEditorScroller();
                if (scroller) targets.push(scroller);
                if (host && !targets.includes(host)) targets.push(host);
                if (!targets.length) return;
                const onPaste = (evt) => { handlePasteImageUploadEvent(evt); };
                const onDrop = (evt) => { handleDropImageUploadEvent(evt); };
                targets.forEach((target) => {
                    target.addEventListener('paste', onPaste, true);
                    target.addEventListener('drop', onDrop, true);
                });
                previewBridgeCleanupFns.push(() => {
                    targets.forEach((target) => {
                        target.removeEventListener('paste', onPaste, true);
                        target.removeEventListener('drop', onDrop, true);
                    });
                });
            };

            const bindPreviewBridge = () => {
                const proseMirror = getToastProseMirrorEl();
                const previewRoot = getToastPreviewContentRoot();

                if (!proseMirror || !previewRoot) return;
                const previewPane = getToastNativePreviewPane();
                const onWindowResize = () => scheduleToastExactScrollMapRebuild('window-resize', 160);
                const onPreviewAssetLoad = (event) => {
                    const target = event && event.target;

                    if (target && String(target.tagName || '').toUpperCase() === 'IMG') {
                        scheduleToastExactScrollMapRebuild('image-load', 80);
                    }
                };
                const onEditorScroll = () => syncToastExactScroll(false);
                const onPreviewScroll = () => syncToastExactScroll(true);

                try {
                    editor.exec('toggleScrollSync', {active: false});
                } catch (error) {
                    console.error('[KnowledgeEditor] 关闭 Toast UI 原生滚动同步失败', error);
                }

                window.addEventListener('resize', onWindowResize, { passive: true });
                previewRoot.addEventListener('load', onPreviewAssetLoad, true);
                proseMirror.addEventListener('scroll', onEditorScroll, { passive: true });
                if (previewPane) previewPane.addEventListener('scroll', onPreviewScroll, { passive: true });
                previewBridgeCleanupFns.push(() => {
                    window.removeEventListener('resize', onWindowResize);
                    previewRoot.removeEventListener('load', onPreviewAssetLoad, true);
                    proseMirror.removeEventListener('scroll', onEditorScroll);
                    if (previewPane) previewPane.removeEventListener('scroll', onPreviewScroll);
                });
            };
            requestAnimationFrame(() => {
                bindPreviewBridge();
                bindKnowledgeImageUploadBridge();
            });

            const codemirrorCompat = {
                on: (eventName, handler) => {
                    if (typeof handler !== 'function') return;
                    if (eventName === 'change') {
                        try {
                            if (typeof editor.on === 'function') {
                                editor.on('change', handler);
                            }
                        } catch (_) {}
                        return;
                    }
                    if (eventName === 'scroll') {
                        const cm = getToastCodeMirror();
                        try {
                            if (cm && typeof cm.on === 'function') {
                                cm.on('scroll', handler);
                            }
                        } catch (_) {}
                    }
                },
                refresh: () => {
                    const cm = getToastCodeMirror();
                    try {
                        if (cm && typeof cm.refresh === 'function') cm.refresh();
                    } catch (_) {}
                },
                getScrollInfo: () => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.getScrollInfo === 'function') {
                        try {
                            return cm.getScrollInfo();
                        } catch (_) {}
                    }
                    const scroller = getToastEditorScroller();
                    if (!scroller) return { top: 0, height: 0, clientHeight: 0 };
                    return {
                        top: Math.max(0, Number(scroller.scrollTop || 0)),
                        height: Math.max(0, Number(scroller.scrollHeight || 0)),
                        clientHeight: Math.max(0, Number(scroller.clientHeight || 0))
                    };
                },
                scrollTo: (_x, y) => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.scrollTo === 'function') {
                        try {
                            cm.scrollTo(null, Math.max(0, Number(y || 0)));
                            return;
                        } catch (_) {}
                    }
                    const scroller = getToastEditorScroller();
                    if (!scroller) return;
                    scroller.scrollTop = Math.max(0, Number(y || 0));
                },
                getScrollerElement: () => getToastEditorScroller(),
                setBookmark: (pos, options) => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.setBookmark === 'function') {
                        return cm.setBookmark(pos, options);
                    }

                    return null;
                },
                posFromIndex: (index) => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.posFromIndex === 'function') {
                        return cm.posFromIndex(index);
                    }

                    return offsetToCodeMirrorPos(String(editor.getMarkdown() || ''), index);
                },
                cursorCoords: (pos, mode) => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.cursorCoords === 'function') {
                        return cm.cursorCoords(pos, mode);
                    }

                    const line = Math.max(0, Number((pos && pos.line) || 0));
                    const ch = Math.max(0, Number((pos && pos.ch) || 0));
                    const textHeight = 22;

                    return {
                        left: ch * 8,
                        right: ch * 8,
                        top: line * textHeight,
                        bottom: (line + 1) * textHeight
                    };
                },
                setCursor: (line, ch) => {
                    const cm = getToastCodeMirror();
                    if (cm && typeof cm.setCursor === 'function') {
                        try {
                            cm.setCursor(line, ch);
                        } catch (_) {}
                    }
                },
                lineCount: () => String(editor.getMarkdown() || '').split('\n').length,
                getLine: (line) => {
                    const lines = String(editor.getMarkdown() || '').split('\n');
                    return String(lines[Math.max(0, Number(line) || 0)] || '');
                },
                heightAtLine: (line) => (Math.max(0, Number(line) || 0) * 22),
                defaultTextHeight: () => 22,
                getLineHandle: () => ({ height: 22 }),
                addLineWidget: () => ({ clear: () => {} })
            };

            const toastKnowledgeEditorApi = {
                __editorType: 'toastui',
                __editor: editor,
                __alignedBound: true,
                __renderPreviewNow: renderToastPreview,
                get __viewMode() {
                    return viewMode;
                },
                get __isFullscreen() {
                    return fullscreen;
                },
                value(nextValue) {
                    if (typeof nextValue === 'undefined') {
                        return editor.getMarkdown();
                    }
                    const markdown = String(nextValue || '');

                    editor.setMarkdown(markdown, false);

                    return markdown;
                },
                applyTextOperation(operation, nextValue) {
                    const nextText = String(nextValue || '');
                    const op = operation && typeof operation === 'object' ? operation : null;

                    if (
                        op
                        && window.NexoraKnowledgeCollab
                        && typeof window.NexoraKnowledgeCollab.applyToastOperation === 'function'
                        && window.NexoraKnowledgeCollab.applyToastOperation(editor, op, nextText)
                    ) {
                        return true;
                    }

                    const cm = getToastCodeMirror();

                    if (op && cm && typeof cm.replaceRange === 'function') {
                        const current = String(editor.getMarkdown() || '');
                        const start = Math.max(0, Math.min(current.length, Number(op.start || 0)));
                        const deleteCount = Math.max(0, Number(op.delete_count || 0));
                        const end = Math.max(start, Math.min(current.length, start + deleteCount));
                        const from = typeof cm.posFromIndex === 'function' ? cm.posFromIndex(start) : offsetToCodeMirrorPos(current, start);
                        const to = typeof cm.posFromIndex === 'function' ? cm.posFromIndex(end) : offsetToCodeMirrorPos(current, end);

                        cm.replaceRange(String(op.insert_text || ''), from, to, '+remote');

                        if (String(editor.getMarkdown() || '') === nextText) {
                            return true;
                        }
                    }

                    this.value(nextText);
                    return false;
                },
                isPreviewActive() {
                    return viewMode !== 'edit';
                },
                isSideBySideActive() {
                    return viewMode === 'split';
                },
                togglePreview() {
                    const snapshot = {
                        title: String(state.currentTitle || '').trim(),
                        sourceMode: viewMode,
                        previewTop: readScrollableProgress(getToastNativePreviewPane()).top,
                        previewRatio: readScrollableProgress(getToastNativePreviewPane()).ratio,
                        editTop: readCodeMirrorProgress().top,
                        editRatio: readCodeMirrorProgress().ratio
                    };
                    setViewMode(viewMode === 'preview' ? 'edit' : 'preview');
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 0);
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 80);
                },
                toggleFullScreen() {
                    setFullscreen(!fullscreen);
                },
                toggleSideBySide() {
                    const snapshot = {
                        title: String(state.currentTitle || '').trim(),
                        sourceMode: viewMode,
                        previewTop: readScrollableProgress(getToastNativePreviewPane()).top,
                        previewRatio: readScrollableProgress(getToastNativePreviewPane()).ratio,
                        editTop: readCodeMirrorProgress().top,
                        editRatio: readCodeMirrorProgress().ratio
                    };
                    setViewMode(viewMode === 'split' ? 'edit' : 'split');
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 0);
                    setTimeout(() => restoreScrollPosition(viewMode !== 'edit', snapshot), 80);
                },
                codemirror: codemirrorCompat
            };

            toastKnowledgeEditorApi.__cleanupPreviewBridge = () => {
                if (previewRenderDebounceTimer) {
                    clearTimeout(previewRenderDebounceTimer);
                    previewRenderDebounceTimer = 0;
                }
                clearTimeout(toastScrollMapTimer);
                toastScrollMapTimer = 0;
                if (toastScrollMapFrame) {
                    cancelAnimationFrame(toastScrollMapFrame);
                    toastScrollMapFrame = 0;
                }
                if (toastScrollSyncReleaseFrame) {
                    cancelAnimationFrame(toastScrollSyncReleaseFrame);
                    toastScrollSyncReleaseFrame = 0;
                }
                toastScrollSyncLock = false;
                toastScrollMap = null;
                delete window.__nexoraKnowledgeBlockSyncStats;
                previewBridgeCleanupFns.forEach((fn) => {
                    try { fn(); } catch (_) {}
                });
                previewBridgeCleanupFns = [];
            };

            return toastKnowledgeEditorApi;
        }

        async function viewKnowledge(title, options = {}) {
            setCurrentTitle(title);
            const {
                forceEditMode = false,
                highlightData = null,
                fromSearch = false,
                workspaceContext = null,
            } = options;
            const normalizedWorkspaceContext = workspaceContext
                ? normalizeWorkspaceConversationHeaderContext(workspaceContext)
                : null;
            const workspaceKnowledgeUser = workspaceContext && typeof workspaceContext === 'object'
                ? String(workspaceContext.user || workspaceContext.addedBy || workspaceContext.added_by || '').trim()
                : '';
            const workspaceReturnTab = workspaceContext && typeof workspaceContext === 'object'
                ? String(workspaceContext.returnTab || workspaceContext.return_tab || '').trim()
                : '';
            const nextWorkspaceReturnContext = normalizedWorkspaceContext && normalizedWorkspaceContext.workspaceId
                ? {
                    ...normalizedWorkspaceContext,
                    user: workspaceKnowledgeUser,
                }
                : null;

            if (nextWorkspaceReturnContext && workspaceReturnTab) {
                nextWorkspaceReturnContext.returnTab = workspaceReturnTab;
            }

            setWorkspaceReturnContext(nextWorkspaceReturnContext);
            setPendingHighlightData(highlightData);
            if (!fromSearch && !highlightData) {
                const state = getTitleState(title);
                state.previewTop = 0;
                state.previewRatio = 0;
                state.editTop = 0;
                state.editRatio = 0;
            }
            const viewer = document.getElementById('knowledgeViewer');
            const msgs = document.getElementById('messagesContainer');
            const inputWrapper = document.getElementById('inputWrapper');
            const headerTitle = document.getElementById('conversationTitle');
            const headerLeft = document.querySelector('.header-left');
            const headerRight = document.querySelector('.header-right');
            const elements = getElements();
            const navigationStack = getNavigationStack();

            if(!viewer || !msgs) return;

            restoreWorkspaceDetailInputContainer();

            logDebug('viewKnowledge:start', {
                title,
                forceEditMode,
                fromSearch,
                hasHighlightData: !!highlightData,
                workspaceReturnContext: state.workspaceReturnContext
                    ? {
                        workspaceId: state.workspaceReturnContext.workspaceId,
                        user: state.workspaceReturnContext.user,
                        returnTab: state.workspaceReturnContext.returnTab || '',
                    }
                    : null,
                state: getTitleState(title)
            });

            // 1. Save Header State
            if (!getOriginalHeaderState()) {
                setOriginalHeaderState({
                    title: headerTitle.textContent,
                    leftHTML: headerLeft.innerHTML,
                    rightHTML: headerRight.innerHTML
                });
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
                setNavigationStack([]);
            }

            // 2. Fetch Content
            let content = '';
            let knowledgeMetadata = {};
            try {
                const contentUrl = appendWorkspaceKnowledgeQuery(
                    `/api/knowledge/basis/${encodeURIComponent(title)}`,
                    title,
                );
                const res = await fetch(contentUrl);
                const data = await res.json();
                if(data.success) {
                    content = data.knowledge.content;
                    setCurrentVersion(data.knowledge, content);

                    if (data.knowledge && data.knowledge.metadata && typeof data.knowledge.metadata === 'object') {
                        getKnowledgeMetaCache()[title] = data.knowledge.metadata;
                        knowledgeMetadata = data.knowledge.metadata;
                    }
                }
            } catch(e) { console.error(e); }

            // 3. UI Switch
            msgs.style.display = 'none';
            if (elements.learningMainPanel) {
                elements.learningMainPanel.style.display = 'none';
            }
            const inputDock = document.querySelector('.input-dock');
            if (inputDock) inputDock.style.display = 'none';
            if(inputWrapper) inputWrapper.style.display = 'none';
            viewer.style.display = 'flex';
            viewer.style.flexDirection = 'column';
            syncTurnIndicatorVisibility();
            // 如果当前viewer是搜索页，先恢复为编辑器容器
            const existingEditorMount = document.getElementById('knowledgeEditor');
            if (!existingEditorMount || String(existingEditorMount.tagName || '').toUpperCase() !== 'DIV') {
                viewer.innerHTML = '<div id="knowledgeEditor" class="knowledge-toast-editor"></div>';
                // 搜索页替换会销毁编辑器，需重建
                destroyEditor();
            }

            // 4. Update Header
            headerTitle.textContent = title;
            const backHandler = state.workspaceReturnContext
                ? 'closeWorkspaceKnowledgeView()'
                : 'closeKnowledgeView()';

            // Left: Back + Knowledge actions (设置/保存/删除)
            headerLeft.innerHTML = `
                <button class="btn-icon" onclick="${backHandler}" title="Back">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                </button>
                <button class="btn-icon knowledge-action" onclick="openKnowledgeSettingsModal()" title="设置">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
                <button class="btn-icon knowledge-action" id="btnSaveKnowledge" onclick="saveKnowledge('${title.replace(/'/g, "\\'")}')" title="保存">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                </button>
                <button class="btn-icon knowledge-action" id="exportKnowledgeBtn" onclick="exportKnowledgeToWord('${title.replace(/'/g, "\\'")}')" title="导出 Word">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                </button>
                <button class="btn-icon knowledge-action knowledge-action-danger" onclick="confirmDeleteKnowledge('${title.replace(/'/g, "\\'")}', 'basis')" title="删除">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
            applyDesktopHeaderTools(headerRight);

            if (headerRight) {
                const collabBar = document.createElement('div');
                collabBar.className = 'knowledge-collab-strip knowledge-collab-owner-bar';
                collabBar.innerHTML = '<div id="ownerKnowledgeCollabMembers" class="knowledge-collab-members"></div>';
                headerRight.prepend(collabBar);
            }

            // 5. Initialize Editor (Toast UI)
            if (!state.editor || state.editor.__editorType !== 'toastui' || !document.getElementById('knowledgeEditor')) {
                destroyEditor();
                setEditor(createToastUiKnowledgeEditor(content || ''));
            }
            if (!state.editor) {
                showToast('Markdown Editor 初始化失败');
                return;
            }
            installPreviewHooks();

            if (!state.editor.__alignedBound) {
                state.editor.codemirror.on("change", () => {
                    state.align.lastInputAt = Date.now();
                    clearTimeout(state.align.debounce);
                    state.align.debounce = setTimeout(() => {
                        if (isSideBySideActive()) {
                            scheduleAlignment('typing');
                        }
                    }, 700);
                });
                state.editor.__alignedBound = true;
            }

            const viewportHeight = window.innerHeight;
            const headerHeight = 60;

            state.editor.value(content || '');
            startOwnerKnowledgeCollab(title, knowledgeMetadata);
            try {
                if (state.editor && state.editor.codemirror) {
                    state.editor.codemirror.scrollTo(null, 0);
                    if (typeof state.editor.codemirror.setCursor === 'function') {
                        state.editor.codemirror.setCursor(0, 0);
                    }
                }
            } catch (_) {}
            logDebug('viewKnowledge:afterValue', {
                title,
                forceEditMode,
                fromSearch,
                hasHighlightData: !!highlightData,
                layout: collectLayoutSnapshot()
            });

            // Default to Preview Mode unless forced edit mode
            if (forceEditMode) {
                if (isPreviewActive()) {
                    storeScrollPosition(true);
                    togglePreviewMode();
                }
            } else {
                if (!isPreviewActive()) {
                    storeScrollPosition(false);
                    togglePreviewMode();
                }
            }
            bindScrollTracking();
            restoreScrollPosition(isPreviewActive());
            [0, 40, 140, 320, 680].forEach((delay) => {
                setTimeout(() => {
                    bindScrollTracking();
                    restoreScrollPosition(isPreviewActive());
                    if (isSideBySideActive() && (delay === 0 || delay === 320 || delay === 680)) {
                        scheduleAlignment('layout');
                    }
                    syncToolbarState();
                    logDebug('viewKnowledge:stabilizeTick', {
                        delay,
                        isPreviewActive: isPreviewActive(),
                        isSideBySideActive: isSideBySideActive(),
                        layout: collectLayoutSnapshot()
                    });
                }, delay);
            });

            const highlightWhenReady = (retryCount = 0) => {
                if (!state.pendingHighlightData || !state.pendingHighlightData.text) return;
                if (retryCount > 30) { // 最多重试30次（约4.5秒）
                    console.warn('预览内容加载超时，取消高亮');
                    clearPendingHighlightData();
                    return;
                }

                const preview = getPreviewContentEl();
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
                highlightTextInPreview(state.pendingHighlightData.text, state.pendingHighlightData.meta);
                clearPendingHighlightData(); // 清空，避免重复高亮
            };

            setTimeout(() => {
                state.editor.codemirror.refresh();
                if (!forceEditMode) {
                    setTimeout(() => highlightWhenReady(0), 200);
                }
            }, 150);
            syncTurnIndicatorVisibility();
        }

        function closeKnowledgeView(options = {}) {
            const closeOptions = (options && typeof options === 'object') ? options : {};
            const useNavigationStack = closeOptions.useNavigationStack !== false;
            const syncLearningHeader = closeOptions.syncLearningHeader !== false;
            const workspaceReturnContext = closeOptions.restoreWorkspaceContext === true
                ? state.workspaceReturnContext
                : null;
            const viewer = document.getElementById('knowledgeViewer');
            const msgs = document.getElementById('messagesContainer');
            const inputWrapper = document.getElementById('inputWrapper');
            const headerTitle = document.getElementById('conversationTitle');
            const headerLeft = document.querySelector('.header-left');
            const headerRight = document.querySelector('.header-right');
            const wasMailView = !!(viewer && viewer.querySelector('.mail-workspace'));
            const closingTitle = String(state.currentTitle || '').trim();
            const originalHeaderState = getOriginalHeaderState();
            const chatHeaderBaseState = getChatHeaderBaseState();
            const navigationStack = getNavigationStack();
            const elements = getElements();

            hideFileCenterContextMenu();
            closeFileCenterSortDropdown();

            restoreWorkspaceDetailInputContainer();
            exitLearningFeedComposeMode({ clear: false });
            exitSpecialModes();
            storeScrollPosition();
            clearTitleState(closingTitle);
            clearCurrentTitle();
            clearWorkspaceReturnContext();

            // 检查导航栈
            if (useNavigationStack && navigationStack.length > 1) {
                // 弹出当前项（知识详情），查看前一个项
                navigationStack.pop(); // 移除知识点
                const prevItem = navigationStack[navigationStack.length - 1];

                if (prevItem.type === 'search') {
                    // 返回到搜索页面 - 重新渲染搜索结果
                    const query = prevItem.query || getCurrentSearchQuery();

                    // 恢复搜索结果缓存
                    if (prevItem.resultsCache && prevItem.resultsCache.length > 0) {
                        setLastKnowledgeSearchResults(prevItem.resultsCache);
                    }

                    // 重新显示搜索界面
                    viewer.style.display = 'flex';
                    viewer.style.flexDirection = 'column';
                    msgs.style.display = 'none';
                    if (inputWrapper) inputWrapper.style.display = 'none';
                    syncTurnIndicatorVisibility();

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

            if (workspaceReturnContext && workspaceReturnContext.workspaceId) {
                const returnTab = String(workspaceReturnContext.returnTab || workspaceReturnContext.return_tab || '').trim();

                logDebug('closeKnowledgeView:workspaceReturn', {
                    workspaceId: workspaceReturnContext.workspaceId,
                    returnTab,
                });
                setNavigationStack([]);
                void selectWorkspaceProject(workspaceReturnContext.workspaceId, {
                    activeDetailTab: returnTab,
                    source: 'knowledge-return',
                });
                return;
            }

            // 返回到聊天界面
            viewer.style.display = 'none';
            msgs.style.display = 'flex';
            const inputDock = document.querySelector('.input-dock');
            if (inputDock) inputDock.style.display = 'block';
            if(inputWrapper) inputWrapper.style.display = 'block';
            if (elements.messageInput && elements.messageInput.value) {
                requestAnimationFrame(() => {
                    resizeMessageInput();
                });
            }
            setNavigationStack([]); // 清空栈

            if (originalHeaderState) {
                restoreHeaderState(originalHeaderState);
            } else if (chatHeaderBaseState) {
                restoreHeaderState(chatHeaderBaseState);
            }
            if (wasMailView) clearMailViewUrl();
            setOriginalHeaderState(null);

            if (syncLearningHeader) {
                void syncLearningHeaderMode();
            }

            syncTurnIndicatorVisibility();
        }

        function bindToolbarHooks() {
            if (state.hooks.toolbarInstalled) return;

            state.hooks.toolbarInstalled = true;

            document.addEventListener('pointerdown', (event) => {
                const target = event.target && event.target.closest
                    ? event.target.closest('#knowledgeViewer .editor-toolbar a, #knowledgeViewer .editor-toolbar button')
                    : null;

                if (!target || !state.currentTitle || !state.editor) return;
                if (state.editor && state.editor.__editorType === 'toastui') return;

                const cls = String(target.className || '');

                if (!/\bpreview\b|\bside-by-side\b|\bfullscreen\b/.test(cls)) return;

                state.scroll.modeSwitchActive = true;
                logDebug('toolbarPointerDown', {
                    cls,
                    previewActive: isPreviewActive(),
                    sideBySideActive: isSideBySideActive()
                });
                mirrorProgressToBothModes();
            }, true);

            document.addEventListener('click', (event) => {
                const target = event.target && event.target.closest
                    ? event.target.closest('#knowledgeViewer .editor-toolbar a, #knowledgeViewer .editor-toolbar button')
                    : null;

                if (!target || !state.currentTitle || !state.editor) return;
                if (state.editor && state.editor.__editorType === 'toastui') return;

                const cls = String(target.className || '');

                if (!/\bpreview\b|\bside-by-side\b|\bfullscreen\b/.test(cls)) return;

                logDebug('toolbarClick', {
                    cls,
                    previewActive: isPreviewActive(),
                    sideBySideActive: isSideBySideActive()
                });

                const pendingSnapshot = state.scroll.pendingToggleSnapshot
                    ? { ...state.scroll.pendingToggleSnapshot }
                    : null;

                [0, 40, 140].forEach((delay) => {
                    setTimeout(() => {
                        if (state.editor && state.editor.codemirror && typeof state.editor.codemirror.refresh === 'function') {
                            state.editor.codemirror.refresh();
                        }

                        bindScrollTracking();
                        applyToggleSnapshot(pendingSnapshot, isPreviewActive());
                        restoreScrollPosition(isPreviewActive(), pendingSnapshot);

                        if (isSideBySideActive() && delay === 140) {
                            scheduleAlignment('toggle');
                        }

                        syncToolbarState();
                        logDebug('toolbarRefresh', {
                            cls,
                            previewActive: isPreviewActive(),
                            sideBySideActive: isSideBySideActive()
                        });

                        if (delay === 140) {
                            logDebug('toolbarTransitionComplete', {
                                cls,
                                previewActive: isPreviewActive(),
                                sideBySideActive: isSideBySideActive()
                            });
                        }
                    }, delay);
                });

                setTimeout(() => {
                    state.scroll.modeSwitchActive = false;
                    state.scroll.pendingToggleSnapshot = null;
                }, 680);
            }, true);
        }

        function installPreviewHooks() {
            if (state.hooks.previewInstalled) return;

            state.hooks.previewInstalled = true;
            bindToolbarHooks();

            if (!window.__nexoraKnowledgeEditorSaveShortcutBound) {
                document.addEventListener('keydown', async (event) => {
                    const viewer = getViewerEl();

                    if (!state.currentTitle || !state.editor || !viewer || viewer.style.display === 'none') return;

                    const key = String(event.key || '').toLowerCase();

                    if (!(event.ctrlKey || event.metaKey) || key !== 's') return;

                    event.preventDefault();
                    event.stopPropagation();
                    await saveKnowledge(state.currentTitle);
                }, true);
                window.__nexoraKnowledgeEditorSaveShortcutBound = true;
            }
        }

        async function saveKnowledge(title) {
            const editor = getEditor();

            if (!editor) return;
            const safeTitle = String(title || state.currentTitle || '').trim();

            if (!safeTitle) return;

            if (
                state.collabClient
                && state.collabClient.isActive()
                && state.collabTitle === safeTitle
            ) {
                state.collabClient.flushNow();
                showToast('已请求实时同步');
                return;
            }

            if (getPendingImageUploadCount() > 0) {
                showToast('仍有图片上传中，请稍候再保存');
                return;
            }

            if (state.savingTitles[safeTitle]) {
                state.queuedSaveTitles[safeTitle] = true;
                knowledgeSyncLogger.debug('[KnowledgeSync] owner save queued during in-flight save', {
                    title: safeTitle
                });
                showToast('正在保存，已排队最新修改');
                return;
            }

            const content = editor.value();
            const version = readCurrentVersion();
            state.savingTitles[safeTitle] = true;
            state.pendingLocalSaves[safeTitle] = {
                content,
                startedAt: Date.now(),
            };

            try {
                knowledgeSyncLogger.debug('[KnowledgeSync] saving owner knowledge', {
                    title: safeTitle,
                    baseRevision: version.contentRevision || '',
                    baseHash: version.contentHash ? String(version.contentHash).slice(0, 12) : '',
                    contentLength: content.length
                });

                const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(safeTitle)}/content`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        content,
                        base_content_revision: version.contentRevision,
                        base_content_hash: version.contentHash,
                        ...getWorkspaceKnowledgeRequestFields(),
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('保存成功');
                    setCurrentVersion(data, content);
                    knowledgeSyncLogger.debug('[KnowledgeSync] owner save accepted', {
                        title: safeTitle,
                        contentRevision: data.content_revision || data.contentRevision || '',
                        contentHash: data.content_hash ? String(data.content_hash).slice(0, 12) : ''
                    });

                    updateKnowledgeMetaFromVersion(safeTitle, data);

                    // 保存后立即刷新知识列表与元数据，让“需重新向量化”状态及时可见。
                    if (!getActiveWorkspaceKnowledgeContext()) {
                        void loadKnowledge(getCurrentConversationId());
                    }
                } else if (data && data.code === 'knowledge_content_conflict') {
                    knowledgeSyncLogger.warn('[KnowledgeSync] owner save conflict', {
                        title: safeTitle,
                        baseRevision: version.contentRevision || '',
                        serverRevision: data.server && (data.server.content_revision || data.server.contentRevision) || '',
                        serverHash: data.server && data.server.content_hash ? String(data.server.content_hash).slice(0, 12) : ''
                    });

                    if (!applyRemoteContentToEditor(data)) {
                        showToast(String(data.message || '知识内容已被其他编辑端更新，请刷新后重试'));
                    }
                } else {
                    showToast('保存失败: ' + data.message);
                }
            } catch (e) {
                showToast('请求异常: ' + e.message);
            } finally {
                delete state.pendingLocalSaves[safeTitle];
                delete state.savingTitles[safeTitle];

                if (state.queuedSaveTitles[safeTitle]) {
                    delete state.queuedSaveTitles[safeTitle];

                    if (String(state.currentTitle || '').trim() === safeTitle && getEditor()) {
                        void saveKnowledge(safeTitle);
                    }
                }
            }
        }

        async function handleKnowledgeChangedEvent(payload = {}) {
            const data = payload && typeof payload === 'object' ? payload : {};
            const eventTitle = String(data.title || '').trim();
            const currentTitle = String(state.currentTitle || '').trim();

            if (!eventTitle) return false;

            if (!currentTitle || eventTitle !== currentTitle) {
                updateKnowledgeMetaFromVersion(eventTitle, data);

                if (!getActiveWorkspaceKnowledgeContext()) {
                    void loadKnowledge(getCurrentConversationId());
                }

                return false;
            }

            const incomingRevision = String(data.content_revision || '').trim();
            const incomingHash = String(data.content_hash || '').trim();
            const version = readCurrentVersion();
            const pendingLocalSave = state.pendingLocalSaves[eventTitle] || null;
            const hasIncomingContent = Object.prototype.hasOwnProperty.call(data, 'content');
            const incomingContent = hasIncomingContent ? String(data.content || '') : '';
            const editor = getEditor();
            const currentContent = editor ? String(editor.value() || '') : '';
            const selfChange = isSelfKnowledgeChangedEvent(data);

            knowledgeSyncLogger.debug('[KnowledgeSync] received owner websocket event', {
                title: eventTitle,
                source: data.source || '',
                actor: data.actor_username || '',
                selfChange,
                hasIncomingContent,
                pendingLocalSave: !!pendingLocalSave,
                incomingRevision,
                currentRevision: version.contentRevision || '',
                incomingHash: incomingHash ? incomingHash.slice(0, 12) : '',
                currentHash: version.contentHash ? String(version.contentHash).slice(0, 12) : ''
            });

            if (
                incomingRevision
                && incomingRevision === version.contentRevision
                && (!incomingHash || incomingHash === version.contentHash)
            ) {
                return true;
            }

            if (
                selfChange
                && (
                    pendingLocalSave
                    || (hasIncomingContent && incomingContent === currentContent)
                )
            ) {
                setCurrentVersion(data, pendingLocalSave ? pendingLocalSave.content : currentContent);
                updateKnowledgeMetaFromVersion(eventTitle, data);
                delete state.pendingLocalSaves[eventTitle];
                knowledgeSyncLogger.debug('[KnowledgeSync] ignored local save echo', {
                    title: eventTitle,
                    source: data.source || '',
                    actor: data.actor_username || '',
                    contentRevision: incomingRevision
                });
                return true;
            }

            if (hasIncomingContent) {
                knowledgeSyncLogger.debug('[KnowledgeSync] applying websocket content', {
                    title: eventTitle,
                    source: data.source || '',
                    actor: data.actor_username || '',
                    contentRevision: incomingRevision
                });
                return applyRemoteContentToEditor(data);
            }

            knowledgeSyncLogger.debug('[KnowledgeSync] reloading current knowledge from event', {
                title: eventTitle,
                source: data.source || '',
                actor: data.actor_username || '',
                contentRevision: incomingRevision
            });
            return reloadCurrentKnowledgeFromServer(currentTitle);
        }

        return {
            getEditor,
            getEditorCodeMirror,
            isToastUiEditor,
            setEditor,
            clearEditor,
            destroyEditor,
            getCurrentTitle,
            setCurrentTitle,
            setActiveScrollTitle,
            getActiveScrollTitle,
            setPendingToggleSnapshot,
            clearCurrentTitle,
            setWorkspaceReturnContext,
            getWorkspaceReturnContext,
            clearWorkspaceReturnContext,
            setPendingHighlightData,
            clearPendingHighlightData,
            getPendingHighlightData,
            getTitleState,
            clearTitleState,
            readScrollableProgress,
            applyScrollableProgress,
            readCodeMirrorProgress,
            applyCodeMirrorProgress,
            cancelRestores,
            cancelAlignRetries,
            resetAlignWidgets,
            addAlignWidget,
            nextAlignRunToken,
            isCurrentAlignRunToken,
            getLastAlignRunAt,
            setLastAlignRunAt,
            getLastAlignInputAt,
            isAlignBusy,
            setAlignBusy,
            addAlignRetryTimer,
            isPreviewActive,
            isSideBySideActive,
            isFullscreenActive,
            getPreviewContentEl,
            togglePreviewMode,
            exitSpecialModes,
            highlightTextInPreview,
            createToastUiKnowledgeEditor,
            viewKnowledge,
            closeKnowledgeView,
            saveKnowledge,
            handleKnowledgeChangedEvent,
            syncCurrentKnowledgeFromServer,
            bindScrollTracking,
            bindToolbarHooks,
            installPreviewHooks,
            restoreScrollPosition,
            storeScrollPosition,
            getScrollMetrics,
            captureToggleSnapshot,
            mirrorProgressToBothModes,
            applyToggleSnapshot,
            normalizePreviewHeadingTags,
            alignBlocks,
            scheduleAlignment,
            syncMirrorScroll,
            startOwnerKnowledgeCollab,
            stopKnowledgeCollab,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createKnowledgeController,
        createKnowledgeSidebarController,
        createKnowledgeVectorController,
        createKnowledgeSettingsController,
        createKnowledgeEditorController,
        createKnowledgeWorkspaceController,
        createKnowledgeVectorizeTask,
        pollKnowledgeVectorTask,
    });
})();
