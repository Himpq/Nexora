(function () {
    'use strict';

    const MODULE_NAME = 'knowledge';

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
        const viewKnowledge = requireKnowledgeDependency(deps, 'viewKnowledge');

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
        const viewKnowledge = requireKnowledgeDependency(deps, 'viewKnowledge');
        const closeKnowledgeView = requireKnowledgeDependency(deps, 'closeKnowledgeView');
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

                const memories = Array.isArray(data.memories) ? data.memories : [];
                renderKnowledgeList(els.panelShortList, memories, 'short');

                if (els.panelShortCount) {
                    els.panelShortCount.textContent = memories.length;
                }

                bindShortTermSectionToggle();
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

        function bindShortTermSectionToggle() {
            const els = readElements();
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
            bindShortTermSectionToggle,
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
        const viewKnowledge = requireKnowledgeDependency(deps, 'viewKnowledge');
        const loadKnowledge = requireKnowledgeDependency(deps, 'loadKnowledge');
        const loadVectorChunks = requireKnowledgeDependency(deps, 'loadVectorChunks');
        const resetVectorProgressUI = requireKnowledgeDependency(deps, 'resetVectorProgressUI');
        const setVectorStatus = requireKnowledgeDependency(deps, 'setVectorStatus');
        const getVectorizeTitle = requireKnowledgeDependency(deps, 'getVectorizeTitle');
        const setVectorizeTitle = requireKnowledgeDependency(deps, 'setVectorizeTitle');

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
                            knowledgeMetaCache[oldTitle].model_readonly = isModelReadonly;
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

    function createKnowledgeEditorController(deps = {}) {
        const state = deps && deps.state && typeof deps.state === 'object'
            ? deps.state
            : null;

        if (!state) {
            throw new Error('chat_knowledge 缺少知识编辑器运行态 state');
        }

        const createToastUiKnowledgeEditor = requireKnowledgeDependency(deps, 'createToastUiKnowledgeEditor');
        const viewKnowledge = requireKnowledgeDependency(deps, 'viewKnowledge');
        const closeKnowledgeView = requireKnowledgeDependency(deps, 'closeKnowledgeView');
        const scheduleAlignment = requireKnowledgeDependency(deps, 'scheduleAlignment');
        const getPreviewEl = requireKnowledgeDependency(deps, 'getPreviewEl');
        const getScrollerEl = requireKnowledgeDependency(deps, 'getScrollerEl');
        const getProseMirrorEl = requireKnowledgeDependency(deps, 'getProseMirrorEl');
        const getViewerEl = requireKnowledgeDependency(deps, 'getViewerEl');
        const logDebug = requireKnowledgeDependency(deps, 'logDebug');
        const collectLayoutSnapshot = requireKnowledgeDependency(deps, 'collectLayoutSnapshot');
        const summarizeNode = requireKnowledgeDependency(deps, 'summarizeNode');
        const mirrorProgressToBothModes = requireKnowledgeDependency(deps, 'mirrorProgressToBothModes');
        const applyToggleSnapshot = requireKnowledgeDependency(deps, 'applyToggleSnapshot');
        const syncToolbarState = requireKnowledgeDependency(deps, 'syncToolbarState');
        const getPendingImageUploadCount = requireKnowledgeDependency(deps, 'getPendingImageUploadCount');
        const getWorkspaceKnowledgeRequestFields = requireKnowledgeDependency(deps, 'getWorkspaceKnowledgeRequestFields');
        const getActiveWorkspaceKnowledgeContext = requireKnowledgeDependency(deps, 'getActiveWorkspaceKnowledgeContext');
        const getKnowledgeMetaCache = requireKnowledgeDependency(deps, 'getKnowledgeMetaCache');
        const getCurrentConversationId = requireKnowledgeDependency(deps, 'getCurrentConversationId');
        const loadKnowledge = requireKnowledgeDependency(deps, 'loadKnowledge');
        const showToast = requireKnowledgeDependency(deps, 'showToast');

        function getEditor() {
            return state.editor || null;
        }

        function setEditor(editor) {
            state.editor = editor || null;
            return state.editor;
        }

        function clearEditor() {
            state.editor = null;
        }

        function setCurrentTitle(title) {
            state.currentTitle = title;
            state.scroll.activeTitle = String(title || '').trim();
        }

        function setActiveScrollTitle(title) {
            state.scroll.activeTitle = String(title || '').trim();
        }

        function clearCurrentTitle() {
            state.currentTitle = null;
            state.scroll.activeTitle = '';
        }

        function setWorkspaceReturnContext(context) {
            state.workspaceReturnContext = context || null;
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
            [0, 40, 140, 320, 680].forEach((delay) => {
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
                    if (fromPreview) {
                        const previewProgress = readScrollableProgress(preview);
                        let cmInfo = null;
                        let targetTop = 0;

                        if (editor && editor.__editorType === 'toastui') {
                            const editorProgress = readScrollableProgress(scroller);
                            const editorMax = Math.max(0, Number((scroller.scrollHeight || 0) - (scroller.clientHeight || 0)));
                            targetTop = editorMax > 0
                                ? Math.round(editorMax * Number(previewProgress.ratio || 0))
                                : Math.max(0, Number(previewProgress.top || 0));
                            scroller.scrollTop = targetTop;
                            cmInfo = {
                                top: editorProgress.top,
                                height: Number(scroller.scrollHeight || 0),
                                clientHeight: Number(scroller.clientHeight || 0)
                            };
                        } else {
                            cmInfo = editor.codemirror.getScrollInfo ? editor.codemirror.getScrollInfo() : null;
                            const cmMax = Math.max(0, Number(((cmInfo && cmInfo.height) || 0) - ((cmInfo && cmInfo.clientHeight) || 0)));
                            targetTop = cmMax > 0
                                ? Math.round(cmMax * Number(previewProgress.ratio || 0))
                                : Math.max(0, Number(previewProgress.top || 0));
                            editor.codemirror.scrollTo(null, targetTop);
                        }

                        logDebug('mirrorScroll:applyToEditor', {
                            previewProgress,
                            cmInfo,
                            targetTop
                        });
                    } else {
                        const cmProgress = (editor && editor.__editorType === 'toastui')
                            ? readScrollableProgress(scroller)
                            : readCodeMirrorProgress();
                        const previewMax = Math.max(0, Number((preview.scrollHeight || 0) - (preview.clientHeight || 0)));
                        const targetTop = previewMax > 0
                            ? Math.round(previewMax * Number(cmProgress.ratio || 0))
                            : Math.max(0, Number(cmProgress.top || 0));

                        preview.scrollTop = targetTop;
                        logDebug('mirrorScroll:applyToPreview', {
                            cmProgress,
                            previewMax,
                            targetTop
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
                preview.addEventListener('scroll', () => {
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

                const refreshPreviewFromPm = () => {
                    const liveEditor = getEditor();

                    if (liveEditor && typeof liveEditor.__queuePreviewRender === 'function') {
                        liveEditor.__queuePreviewRender(true);
                    }
                };
                proseMirror.addEventListener('input', refreshPreviewFromPm);
                proseMirror.addEventListener('keyup', refreshPreviewFromPm);
                proseMirror.addEventListener('paste', refreshPreviewFromPm);
                proseMirror.addEventListener('cut', refreshPreviewFromPm);
                proseMirror.addEventListener('compositionend', refreshPreviewFromPm);
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

            if (getPendingImageUploadCount() > 0) {
                showToast('仍有图片上传中，请稍候再保存');
                return;
            }

            const content = editor.value();

            try {
                const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}/content`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        content,
                        ...getWorkspaceKnowledgeRequestFields(),
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('保存成功');

                    const nowSec = Math.floor(Date.now() / 1000);
                    const knowledgeMetaCache = getKnowledgeMetaCache();
                    const meta = (knowledgeMetaCache[title] && typeof knowledgeMetaCache[title] === 'object')
                        ? knowledgeMetaCache[title]
                        : {};
                    meta.updated_at = Math.max(nowSec, Number(meta.updated_at || 0));

                    if (Number(meta.vector_updated_at || 0) >= meta.updated_at) {
                    }

                    knowledgeMetaCache[title] = meta;

                    // 保存后立即刷新知识列表与元数据，让“需重新向量化”状态及时可见。
                    if (!getActiveWorkspaceKnowledgeContext()) {
                        await loadKnowledge(getCurrentConversationId());
                    }
                } else {
                    showToast('保存失败: ' + data.message);
                }
            } catch (e) {
                showToast('请求异常: ' + e.message);
            }
        }

        return {
            state,
            getEditor,
            setEditor,
            clearEditor,
            setCurrentTitle,
            setActiveScrollTitle,
            clearCurrentTitle,
            setWorkspaceReturnContext,
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
            isPreviewActive,
            isSideBySideActive,
            isFullscreenActive,
            createToastUiKnowledgeEditor,
            viewKnowledge,
            closeKnowledgeView,
            saveKnowledge,
            bindScrollTracking,
            bindToolbarHooks,
            installPreviewHooks,
            restoreScrollPosition,
            storeScrollPosition,
            scheduleAlignment,
            syncMirrorScroll,
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
