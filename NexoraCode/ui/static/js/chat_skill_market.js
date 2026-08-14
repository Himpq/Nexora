/**
 * chat_skill_market.js
 * Skill 市场 + 个人 Skill 管理模块
 * 负责：子标签切换、市场浏览/搜索/安装、个人 Skill 创建/编辑/删除/发布
 */
(function () {
    'use strict';

    const MODULE_NAME = 'skillMarket';

    // ==================== 状态 ====================

    let marketState = {
        skills: [],
        total: 0,
        page: 1,
        loading: false,
        query: '',
        sort: 'installs'
    };

    let personalSkillEditorState = {
        mode: 'create',
        skillId: '',
        saving: false
    };

    // ==================== 工具函数 ====================

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str || '');
        return div.innerHTML;
    }

    function showToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        }
    }

    function normalizeSkillModeValue(raw) {
        const token = String(raw || '').trim().toLowerCase();
        if (token === 'force') return 'force';
        if (token === 'auto' || token === 'auto_tools') return 'auto';
        return 'off';
    }

    function formatModeLabel(mode) {
        const m = normalizeSkillModeValue(mode);
        if (m === 'force') return 'Force';
        if (m === 'auto') return 'Auto';
        return 'Off';
    }

    function formatOriginLabel(origin) {
        if (origin === 'market') return '市场安装';
        if (origin === 'self') return '自建';
        if (origin === 'global') return '全局';
        return '';
    }

    // ==================== 子标签切换 ====================

    function initSkillSubTabs() {
        const container = document.getElementById('settings-skills-tab');
        if (!container || container.dataset.skillSubtabsInit === '1') return;

        container.dataset.skillSubtabsInit = '1';

        container.querySelectorAll('.skill-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const tabName = btn.getAttribute('data-skill-subtab');
                if (tabName) switchSkillSubTab(tabName);
            });
        });
    }

    function switchSkillSubTab(tabName) {
        const container = document.getElementById('settings-skills-tab');
        if (!container) return;

        container.querySelectorAll('.skill-subtab').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-skill-subtab') === tabName);
        });

        container.querySelectorAll('.skill-subtab-content').forEach(function (panel) {
            panel.classList.remove('active');
        });

        const target = document.getElementById('skill-subtab-' + tabName);
        if (target) target.classList.add('active');

        if (tabName === 'market') {
            loadMarketSkills();
        }
    }

    // ==================== 市场浏览 ====================

    async function loadMarketSkills(force) {
        if (marketState.loading && !force) return;

        marketState.loading = true;
        const listEl = document.getElementById('skillMarketList');

        try {
            const params = new URLSearchParams();
            if (marketState.query) params.set('q', marketState.query);
            params.set('sort', marketState.sort);
            params.set('page', String(marketState.page));
            params.set('page_size', '20');

            const res = await fetch('/api/skills/market?' + params.toString(), {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            marketState.skills = Array.isArray(data.skills) ? data.skills : [];
            marketState.total = data.total || 0;
            marketState.page = data.page || 1;

            renderMarketList();
        } catch (e) {
            if (listEl) {
                listEl.innerHTML = '<div class="settings-skill-empty">加载失败：' + escapeHtml(e.message || 'unknown') + '</div>';
            }
        } finally {
            marketState.loading = false;
        }
    }

    function renderMarketList() {
        const listEl = document.getElementById('skillMarketList');
        if (!listEl) return;

        const skills = marketState.skills;

        if (!skills.length) {
            listEl.innerHTML = '<div class="settings-skill-empty">市场暂无 Skill</div>';
            return;
        }

        listEl.innerHTML = skills.map(function (item) {
            const sid = escapeHtml(item.id || '');
            const title = escapeHtml(item.title || sid);
            const desc = escapeHtml(item.description || '暂无描述');
            const author = escapeHtml(item.author || '匿名');
            const version = escapeHtml(item.version || '');
            const installs = parseInt(item.install_count || 0, 10);
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const installed = !!item.installed;

            const tagsHtml = tags.length
                ? '<div class="skill-market-tags">' + tags.map(function (t) {
                    return '<span class="skill-market-tag">' + escapeHtml(t) + '</span>';
                }).join('') + '</div>'
                : '';

            const actionBtn = installed
                ? '<button type="button" class="btn-skill-installed" disabled>已安装</button>'
                : '<button type="button" class="btn-skill-install" data-action="install-skill" data-skill-id="' + sid + '">安装</button>';

            return '' +
                '<div class="skill-market-card">' +
                    '<div class="skill-market-card-body">' +
                        '<div class="skill-market-card-title">' + title + '</div>' +
                        '<div class="skill-market-card-desc">' + desc + '</div>' +
                        tagsHtml +
                        '<div class="skill-market-card-meta">' +
                            '<span>by ' + author + '</span>' +
                            (version ? '<span>v' + version + '</span>' : '') +
                            '<span>' + installs + ' 次安装</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="skill-market-card-actions">' +
                        '<button type="button" class="btn-skill-detail" data-action="view-skill-detail" data-skill-id="' + sid + '">详情</button>' +
                        actionBtn +
                    '</div>' +
                '</div>';
        }).join('');

        bindMarketCardEvents(listEl);
    }

    function bindMarketCardEvents(listEl) {
        listEl.querySelectorAll('[data-action="install-skill"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const sid = btn.getAttribute('data-skill-id');
                if (sid) installMarketSkill(sid, btn);
            });
        });

        listEl.querySelectorAll('[data-action="view-skill-detail"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const sid = btn.getAttribute('data-skill-id');
                if (sid) openMarketSkillDetail(sid);
            });
        });
    }

    // ==================== 市场安装 ====================

    async function installMarketSkill(skillId, btn) {
        if (btn) btn.disabled = true;

        try {
            const res = await fetch('/api/skills/market/' + encodeURIComponent(skillId) + '/install', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            showToast('Skill 已安装');
            await loadMarketSkills(true);

            // 刷新「我的 Skill」列表
            if (typeof window.loadSkillSettings === 'function') {
                window.loadSkillSettings(true);
            }
        } catch (e) {
            showToast('安装失败：' + (e.message || 'unknown'));
            if (btn) btn.disabled = false;
        }
    }

    // ==================== 市场详情弹窗 ====================

    async function openMarketSkillDetail(skillId) {
        try {
            const res = await fetch('/api/skills/market/' + encodeURIComponent(skillId), {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            const skill = data.skill || {};
            showSkillDetailModal(skill, 'market');
        } catch (e) {
            showToast('加载详情失败：' + (e.message || 'unknown'));
        }
    }

    function showSkillDetailModal(skill, source) {
        const modal = document.getElementById('skillMarketDetailModal');
        if (!modal) return;

        const titleEl = document.getElementById('skillDetailTitle');
        const metaEl = document.getElementById('skillDetailMeta');
        const contentEl = document.getElementById('skillDetailContent');
        const installBtn = document.getElementById('skillDetailInstallBtn');

        if (titleEl) titleEl.textContent = skill.title || skill.id || 'Skill 详情';

        if (metaEl) {
            const parts = [];
            if (skill.author) parts.push('作者：' + skill.author);
            if (skill.version) parts.push('版本：' + skill.version);
            if (skill.mode) parts.push('模式：' + formatModeLabel(skill.mode));

            const tools = Array.isArray(skill.required_tools) ? skill.required_tools : [];
            if (tools.length) parts.push('工具：' + tools.join(', '));

            metaEl.textContent = parts.join('  ·  ');
        }

        if (contentEl) {
            contentEl.value = skill.main_content || '';
            contentEl.readOnly = true;
        }

        if (installBtn) {
            if (source === 'market') {
                installBtn.style.display = '';
                installBtn.disabled = !!skill.installed;
                installBtn.textContent = skill.installed ? '已安装' : '安装';
                installBtn.setAttribute('data-skill-id', skill.id || '');
            } else {
                installBtn.style.display = 'none';
            }
        }

        modal.classList.add('active');
    }

    function closeSkillDetailModal() {
        const modal = document.getElementById('skillMarketDetailModal');
        if (modal) modal.classList.remove('active');
    }

    // ==================== 个人 Skill 创建/编辑 ====================

    function openPersonalSkillEditor(skillId) {
        const modal = document.getElementById('personalSkillEditorModal');
        if (!modal) return;

        const titleInput = document.getElementById('psEditorTitle');
        const idInput = document.getElementById('psEditorId');
        const descInput = document.getElementById('psEditorDesc');
        const tagsInput = document.getElementById('psEditorTags');
        const toolsInput = document.getElementById('psEditorTools');
        const modeSelect = document.getElementById('psEditorMode');
        const contentArea = document.getElementById('psEditorContent');
        const modalTitle = document.getElementById('psEditorModalTitle');
        const publishBtn = document.getElementById('psEditorPublishBtn');

        if (skillId) {
            // 编辑模式：从当前 skill 列表查找
            personalSkillEditorState.mode = 'edit';
            personalSkillEditorState.skillId = skillId;

            const skill = findPersonalSkillById(skillId);
            if (!skill) {
                showToast('未找到该 Skill');
                return;
            }

            if (modalTitle) modalTitle.textContent = '编辑 Skill';
            if (titleInput) titleInput.value = skill.title || '';
            if (idInput) { idInput.value = skill.id || ''; idInput.readOnly = true; }
            if (descInput) descInput.value = skill.description || '';
            if (tagsInput) tagsInput.value = (skill.tags || []).join(', ');
            if (toolsInput) toolsInput.value = (skill.required_tools || []).join(', ');
            if (modeSelect) modeSelect.value = normalizeSkillModeValue(skill.mode || 'auto');
            if (contentArea) contentArea.value = skill.main_content || '';
            if (publishBtn) publishBtn.style.display = '';
        } else {
            // 创建模式
            personalSkillEditorState.mode = 'create';
            personalSkillEditorState.skillId = '';

            if (modalTitle) modalTitle.textContent = '新建 Skill';
            if (titleInput) titleInput.value = '';
            if (idInput) { idInput.value = ''; idInput.readOnly = false; }
            if (descInput) descInput.value = '';
            if (tagsInput) tagsInput.value = '';
            if (toolsInput) toolsInput.value = '';
            if (modeSelect) modeSelect.value = 'auto';
            if (contentArea) contentArea.value = '';
            if (publishBtn) publishBtn.style.display = 'none';
        }

        personalSkillEditorState.saving = false;
        modal.classList.add('active');
    }

    function closePersonalSkillEditor() {
        const modal = document.getElementById('personalSkillEditorModal');
        if (modal) modal.classList.remove('active');
    }

    function findPersonalSkillById(skillId) {
        const sid = String(skillId || '').trim();
        if (!sid) return null;

        if (typeof window.getSkillById === 'function') {
            return window.getSkillById(sid);
        }

        return null;
    }

    async function savePersonalSkill() {
        if (personalSkillEditorState.saving) return;

        const titleInput = document.getElementById('psEditorTitle');
        const idInput = document.getElementById('psEditorId');
        const descInput = document.getElementById('psEditorDesc');
        const tagsInput = document.getElementById('psEditorTags');
        const toolsInput = document.getElementById('psEditorTools');
        const modeSelect = document.getElementById('psEditorMode');
        const contentArea = document.getElementById('psEditorContent');

        const title = (titleInput ? titleInput.value : '').trim();
        if (!title) {
            showToast('标题不能为空');
            return;
        }

        const payload = {
            title: title,
            id: (idInput ? idInput.value : '').trim() || undefined,
            description: (descInput ? descInput.value : '').trim(),
            tags: (tagsInput ? tagsInput.value : '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
            required_tools: (toolsInput ? toolsInput.value : '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
            mode: modeSelect ? modeSelect.value : 'auto',
            main_content: contentArea ? contentArea.value : ''
        };

        personalSkillEditorState.saving = true;
        const saveBtn = document.getElementById('psEditorSaveBtn');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const isEdit = personalSkillEditorState.mode === 'edit';
            const url = isEdit
                ? '/api/skills/my/' + encodeURIComponent(personalSkillEditorState.skillId)
                : '/api/skills/my';
            const method = isEdit ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method: method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skill: payload })
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            showToast(isEdit ? 'Skill 已更新' : 'Skill 已创建');
            closePersonalSkillEditor();

            // 刷新列表
            if (typeof window.loadSkillSettings === 'function') {
                window.loadSkillSettings(true);
            }
        } catch (e) {
            showToast('保存失败：' + (e.message || 'unknown'));
        } finally {
            personalSkillEditorState.saving = false;
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function deletePersonalSkill(skillId) {
        const sid = String(skillId || '').trim();
        if (!sid) return;

        if (!confirm('确定删除该个人 Skill？此操作不可撤销。')) return;

        try {
            const res = await fetch('/api/skills/my/' + encodeURIComponent(sid), {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            showToast('Skill 已删除');

            if (typeof window.loadSkillSettings === 'function') {
                window.loadSkillSettings(true);
            }
        } catch (e) {
            showToast('删除失败：' + (e.message || 'unknown'));
        }
    }

    // ==================== 发布到市场 ====================

    async function publishSkillToMarket(skillId) {
        const sid = String(skillId || '').trim();

        // 从编辑器获取当前内容（如果正在编辑）
        const titleInput = document.getElementById('psEditorTitle');
        const descInput = document.getElementById('psEditorDesc');
        const tagsInput = document.getElementById('psEditorTags');
        const toolsInput = document.getElementById('psEditorTools');
        const modeSelect = document.getElementById('psEditorMode');
        const contentArea = document.getElementById('psEditorContent');
        const idInput = document.getElementById('psEditorId');

        const title = (titleInput ? titleInput.value : '').trim();
        if (!title) {
            showToast('标题不能为空，无法发布');
            return;
        }

        if (!confirm('发布后所有用户可在市场看到该 Skill，确认发布？')) return;

        const payload = {
            id: (idInput ? idInput.value : '').trim() || sid || undefined,
            title: title,
            description: (descInput ? descInput.value : '').trim(),
            tags: (tagsInput ? tagsInput.value : '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
            required_tools: (toolsInput ? toolsInput.value : '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
            mode: modeSelect ? modeSelect.value : 'auto',
            main_content: contentArea ? contentArea.value : '',
            version: '1.0.0'
        };

        try {
            const res = await fetch('/api/skills/market/publish', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skill: payload })
            });
            const data = await res.json().catch(function () { return {}; });

            if (!res.ok || !data.success) {
                throw new Error(data.message || 'HTTP ' + res.status);
            }

            const actionText = data.action === 'updated' ? '已更新' : '已发布';
            showToast('Skill ' + actionText + '到市场');
        } catch (e) {
            showToast('发布失败：' + (e.message || 'unknown'));
        }
    }

    // ==================== 搜索与排序事件 ====================

    function initMarketToolbar() {
        const searchInput = document.getElementById('skillMarketSearchInput');
        const sortSelect = document.getElementById('skillMarketSortSelect');

        if (searchInput) {
            let debounceTimer = null;
            searchInput.addEventListener('input', function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function () {
                    marketState.query = searchInput.value.trim();
                    marketState.page = 1;
                    loadMarketSkills(true);
                }, 400);
            });
        }

        if (sortSelect) {
            sortSelect.addEventListener('change', function () {
                marketState.sort = sortSelect.value;
                marketState.page = 1;
                loadMarketSkills(true);
            });
        }
    }

    // ==================== Skill 文件上传 ====================

    /**
     * 解析上传的 Skill 文件。
     * 兼容两类输入：
     *  1. 标准 .skill 格式（头部 key: value + ---content--- 分隔正文）→ 结构化解析
     *  2. 任意文本文件（md/txt/json 等）→ 全文作为正文，文件名作为默认标题
     */
    function parseSkillText(rawText, fileName) {
        const text = String(rawText || '');
        if (!text.trim()) return null;

        const defaultTitle = deriveTitleFromFileName(fileName);

        const lines = text.split(/\r?\n/);
        let markerIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (String(lines[i] || '').trim().toLowerCase() === '---content---') {
                markerIndex = i;
                break;
            }
        }

        // 无分隔符时，检查开头若干行是否像 .skill 头部（含 title:/id: 等字段）
        const hasSkillHeader = markerIndex >= 0 || looksLikeSkillHeader(lines);

        if (!hasSkillHeader) {
            // 非 .skill 格式：全文作为正文
            return {
                id: '',
                title: defaultTitle,
                description: '',
                tags: '',
                required_tools: '',
                mode: 'auto',
                version: '',
                main_content: text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
            };
        }

        // 标准 .skill 格式：解析头部 + 正文
        const headerLines = markerIndex < 0 ? lines : lines.slice(0, markerIndex);
        const contentLines = markerIndex < 0 ? [] : lines.slice(markerIndex + 1);

        const header = {};
        headerLines.forEach(function (rawLine) {
            const line = String(rawLine || '').trim();
            if (!line || line.startsWith('#')) return;

            const sep = line.indexOf(':') >= 0 ? ':' : (line.indexOf('=') >= 0 ? '=' : '');
            if (!sep) return;

            const idx = line.indexOf(sep);
            const key = line.slice(0, idx).trim().toLowerCase();
            const value = line.slice(idx + 1).trim();
            if (key) header[key] = value;
        });

        return {
            id: header.id || '',
            title: header.title || defaultTitle,
            description: header.description || '',
            tags: header.tags || '',
            required_tools: header.required_tools || '',
            mode: header.mode || 'auto',
            version: header.version || '',
            main_content: contentLines.join('\n').replace(/[\r\n]+$/, '')
        };
    }

    /**
     * 判断文件开头是否像 .skill 头部（前 15 行内出现 title:/id:/mode: 等字段）
     */
    function looksLikeSkillHeader(lines) {
        const headerKeys = ['title:', 'id:', 'required_tools:', 'mode:', 'author:', 'version:'];
        const scanCount = Math.min(lines.length, 15);

        for (let i = 0; i < scanCount; i++) {
            const line = String(lines[i] || '').trim().toLowerCase();
            for (let k = 0; k < headerKeys.length; k++) {
                if (line.indexOf(headerKeys[k]) === 0) return true;
            }
        }

        return false;
    }

    /**
     * 从文件名推导默认标题（去掉扩展名）
     */
    function deriveTitleFromFileName(fileName) {
        const name = String(fileName || '').trim();
        if (!name) return '';

        const base = name.replace(/\.[^./\\]+$/, '');
        return base.trim();
    }

    /**
     * 用解析出的 Skill 预填编辑器（创建模式）
     */
    function prefillEditorFromSkill(parsed) {
        const titleInput = document.getElementById('psEditorTitle');
        const idInput = document.getElementById('psEditorId');
        const descInput = document.getElementById('psEditorDesc');
        const tagsInput = document.getElementById('psEditorTags');
        const toolsInput = document.getElementById('psEditorTools');
        const modeSelect = document.getElementById('psEditorMode');
        const contentArea = document.getElementById('psEditorContent');
        const modalTitle = document.getElementById('psEditorModalTitle');
        const publishBtn = document.getElementById('psEditorPublishBtn');

        personalSkillEditorState.mode = 'create';
        personalSkillEditorState.skillId = '';

        if (modalTitle) modalTitle.textContent = '上传 Skill';
        if (titleInput) titleInput.value = parsed.title || '';
        if (idInput) { idInput.value = parsed.id || ''; idInput.readOnly = false; }
        if (descInput) descInput.value = parsed.description || '';
        if (tagsInput) tagsInput.value = parsed.tags || '';
        if (toolsInput) toolsInput.value = parsed.required_tools || '';
        if (modeSelect) modeSelect.value = normalizeSkillModeValue(parsed.mode || 'auto');
        if (contentArea) contentArea.value = parsed.main_content || '';
        if (publishBtn) publishBtn.style.display = 'none';

        personalSkillEditorState.saving = false;

        const modal = document.getElementById('personalSkillEditorModal');
        if (modal) modal.classList.add('active');
    }

    /**
     * 处理用户上传的 .skill 文件
     */
    function handleSkillFileUpload(file) {
        if (!file) return;

        const fileName = file.name || '';
        const reader = new FileReader();
        reader.onload = function (e) {
            const text = String(e.target && e.target.result ? e.target.result : '');
            const parsed = parseSkillText(text, fileName);

            if (!parsed || (!parsed.title && !parsed.main_content)) {
                showToast('无法解析该 Skill 文件，请检查格式');
                return;
            }

            prefillEditorFromSkill(parsed);
        };
        reader.onerror = function () {
            showToast('读取文件失败');
        };
        reader.readAsText(file, 'utf-8');
    }

    // ==================== 初始化 ====================

    let moduleInitialized = false;

    function initSkillMarketModule() {
        if (moduleInitialized) return;
        moduleInitialized = true;

        initSkillSubTabs();
        initMarketToolbar();

        // 新建 Skill 按钮
        const createBtn = document.getElementById('btnCreatePersonalSkill');
        if (createBtn) {
            createBtn.addEventListener('click', function () {
                openPersonalSkillEditor(null);
            });
        }

        // 上传 Skill 按钮 + 文件输入框
        const uploadBtn = document.getElementById('btnUploadPersonalSkill');
        const uploadInput = document.getElementById('skillUploadFileInput');

        if (uploadBtn && uploadInput) {
            uploadBtn.addEventListener('click', function () {
                uploadInput.value = '';
                uploadInput.click();
            });

            uploadInput.addEventListener('change', function () {
                const file = uploadInput.files && uploadInput.files[0];
                if (file) handleSkillFileUpload(file);
            });
        }

        // 市场详情弹窗关闭
        const detailCloseBtn = document.getElementById('skillDetailCloseBtn');
        if (detailCloseBtn) {
            detailCloseBtn.addEventListener('click', closeSkillDetailModal);
        }

        const detailBackdrop = document.getElementById('skillMarketDetailModal');
        if (detailBackdrop) {
            detailBackdrop.addEventListener('click', function (e) {
                if (e.target === detailBackdrop) closeSkillDetailModal();
            });
        }

        // 详情弹窗安装按钮
        const detailInstallBtn = document.getElementById('skillDetailInstallBtn');
        if (detailInstallBtn) {
            detailInstallBtn.addEventListener('click', function () {
                const sid = detailInstallBtn.getAttribute('data-skill-id');
                if (sid) installMarketSkill(sid, detailInstallBtn);
            });
        }

        // 个人 Skill 编辑器按钮
        const psSaveBtn = document.getElementById('psEditorSaveBtn');
        if (psSaveBtn) {
            psSaveBtn.addEventListener('click', savePersonalSkill);
        }

        const psCancelBtn = document.getElementById('psEditorCancelBtn');
        if (psCancelBtn) {
            psCancelBtn.addEventListener('click', closePersonalSkillEditor);
        }

        const psPublishBtn = document.getElementById('psEditorPublishBtn');
        if (psPublishBtn) {
            psPublishBtn.addEventListener('click', function () {
                publishSkillToMarket(personalSkillEditorState.skillId);
            });
        }

        const psEditorBackdrop = document.getElementById('personalSkillEditorModal');
        if (psEditorBackdrop) {
            psEditorBackdrop.addEventListener('click', function (e) {
                if (e.target === psEditorBackdrop) closePersonalSkillEditor();
            });
        }
    }

    // ==================== 暴露给外部的接口 ====================

    function getShared() {
        return window.NexoraChatShared;
    }

    // 注册模块
    if (getShared() && typeof getShared().registerModule === 'function') {
        getShared().registerModule(MODULE_NAME, {
            initSkillMarketModule: initSkillMarketModule,
            loadMarketSkills: loadMarketSkills,
            openPersonalSkillEditor: openPersonalSkillEditor,
            deletePersonalSkill: deletePersonalSkill,
            publishSkillToMarket: publishSkillToMarket,
            switchSkillSubTab: switchSkillSubTab
        });
    }

    // 同时挂载到 window 供 chat.js 直接调用
    window.NexoraSkillMarket = {
        initSkillMarketModule: initSkillMarketModule,
        loadMarketSkills: loadMarketSkills,
        openPersonalSkillEditor: openPersonalSkillEditor,
        deletePersonalSkill: deletePersonalSkill,
        publishSkillToMarket: publishSkillToMarket,
        switchSkillSubTab: switchSkillSubTab
    };
})();
