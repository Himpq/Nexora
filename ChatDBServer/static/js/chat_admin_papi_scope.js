(function () {
    'use strict';

    const state = {
        users: [],
        keys: [],
        filterOwner: '',
        selectors: new Map(),
        dependencies: null,
        initialized: false,
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showMessage(message) {
        if (typeof window.showToast !== 'function') {
            throw new Error('缺少前端依赖函数: showToast');
        }

        window.showToast(String(message || ''));
    }

    function selectorState(name) {
        if (!state.selectors.has(name)) {
            state.selectors.set(name, {
                activeIndex: 0,
                filteredUsers: [],
                visible: false,
            });
        }

        return state.selectors.get(name);
    }

    function selectorElements(name) {
        const map = {
            filter: ['adminPapiOwnerFilterSelector', 'adminPapiOwnerFilterInput', 'adminPapiOwnerFilterMenu'],
            detail: ['adminPublicApiOwnerSelector', 'adminPublicApiOwnerInput', 'adminPublicApiOwnerMenu'],
            modal: ['adminPublicApiModalOwnerSelector', 'adminPublicApiModalOwnerInput', 'adminPublicApiModalOwnerMenu'],
        };
        const ids = map[name];

        if (!ids) {
            throw new Error(`未知 PAPI 用户选择器: ${name}`);
        }

        return {
            root: document.getElementById(ids[0]),
            input: document.getElementById(ids[1]),
            menu: document.getElementById(ids[2]),
        };
    }

    function allOwners() {
        const result = [];
        const seen = new Set();
        const append = (value) => {
            const userId = String(value || '').trim();

            if (!userId || seen.has(userId)) {
                return;
            }

            seen.add(userId);
            result.push(userId);
        };

        state.users.forEach((user) => append(user?.user_id || user?.username));
        state.keys.forEach((key) => append(key?.owner));
        return result;
    }

    function filterUsers(query) {
        const normalized = String(query || '').trim().toLowerCase();
        const rows = allOwners();

        if (!normalized) {
            return rows.slice(0, 12);
        }

        return rows.filter((userId) => userId.toLowerCase().includes(normalized)).slice(0, 12);
    }

    function hideSelector(name) {
        const selector = selectorState(name);
        const { input, menu } = selectorElements(name);
        selector.visible = false;

        if (input) {
            input.setAttribute('aria-expanded', 'false');
        }

        if (menu) {
            menu.hidden = true;
            menu.style.display = 'none';
            menu.innerHTML = '';
        }
    }

    function renderSelector(name) {
        const selector = selectorState(name);
        const { input, menu } = selectorElements(name);

        if (!input || !menu) {
            return;
        }

        if (!selector.visible) {
            hideSelector(name);
            return;
        }

        input.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        menu.style.display = 'grid';

        const rows = selector.filteredUsers;
        const allItem = name === 'filter'
            ? '<button class="learning-feed-mention-item admin-user-token-item" type="button" role="option" data-papi-owner-index="-1"><span class="learning-feed-mention-meta admin-user-token-meta"><span class="learning-feed-mention-name">全部用户</span></span></button>'
            : '';

        if (!rows.length && !allItem) {
            menu.innerHTML = '<div class="admin-user-token-empty">没有匹配的用户</div>';
            return;
        }

        menu.innerHTML = allItem + rows.map((userId, index) => {
            const active = index === selector.activeIndex ? ' is-active' : '';
            return `
                <button class="learning-feed-mention-item admin-user-token-item${active}" type="button" role="option" aria-selected="${active ? 'true' : 'false'}" data-papi-owner-index="${index}">
                    <span class="admin-user-avatar admin-public-api-key-icon"><i class="fa-solid fa-user" aria-hidden="true"></i></span>
                    <span class="learning-feed-mention-meta admin-user-token-meta">
                        <span class="learning-feed-mention-name">${escapeHtml(userId)}</span>
                    </span>
                </button>
            `;
        }).join('');
    }

    function selectOwner(name, owner) {
        const value = String(owner || '').trim();
        const { input } = selectorElements(name);

        if (input) {
            input.value = value;
        }

        if (name === 'filter') {
            state.filterOwner = value;

            if (state.dependencies && typeof state.dependencies.onFilterChanged === 'function') {
                state.dependencies.onFilterChanged();
            }
        }

        hideSelector(name);
    }

    function showSelector(name) {
        const selector = selectorState(name);
        const { input } = selectorElements(name);
        selector.filteredUsers = filterUsers(input?.value || '');
        selector.activeIndex = 0;
        selector.visible = true;
        renderSelector(name);
    }

    function bindSelector(name) {
        // 三个用户名输入框共用相同的非原生菜单和键盘导航行为。
        const { root, input, menu } = selectorElements(name);

        if (!root || !input || !menu || root.dataset.papiScopeBound === '1') {
            return;
        }

        root.dataset.papiScopeBound = '1';
        input.addEventListener('focus', () => showSelector(name));
        input.addEventListener('input', () => {
            if (name === 'filter') {
                state.filterOwner = String(input.value || '').trim();

                if (state.dependencies && typeof state.dependencies.onFilterChanged === 'function') {
                    state.dependencies.onFilterChanged();
                }
            }

            showSelector(name);
        });
        input.addEventListener('keydown', (event) => {
            const selector = selectorState(name);
            const rows = selector.filteredUsers;

            if (event.key === 'Escape') {
                event.preventDefault();
                hideSelector(name);
                return;
            }

            if (!rows.length) {
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                selector.activeIndex = (selector.activeIndex + 1) % rows.length;
                renderSelector(name);
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                selector.activeIndex = (selector.activeIndex - 1 + rows.length) % rows.length;
                renderSelector(name);
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                selectOwner(name, rows[selector.activeIndex]);
            }
        });
        menu.addEventListener('mousedown', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-papi-owner-index]') : null;

            if (!target) {
                return;
            }

            event.preventDefault();
            const index = Number(target.getAttribute('data-papi-owner-index'));

            if (name === 'filter' && index === -1) {
                selectOwner(name, '');
                return;
            }

            const userId = selectorState(name).filteredUsers[index];

            if (userId) {
                selectOwner(name, userId);
            }
        });
        document.addEventListener('mousedown', (event) => {
            if (event.target instanceof Node && !root.contains(event.target)) {
                hideSelector(name);
            }
        });
    }

    function scopeValue(containerId) {
        const active = document.querySelector(`#${containerId} [data-papi-scope].active`);
        return String(active?.getAttribute('data-papi-scope') || '').trim();
    }

    function setScopeValue(containerId, value) {
        document.querySelectorAll(`#${containerId} [data-papi-scope]`).forEach((button) => {
            const active = String(button.getAttribute('data-papi-scope') || '') === String(value || '');
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function bindScopeSegment(containerId) {
        const container = document.getElementById(containerId);

        if (!container || container.dataset.papiScopeBound === '1') {
            return;
        }

        container.dataset.papiScopeBound = '1';
        container.querySelectorAll('[data-papi-scope]').forEach((button) => {
            button.addEventListener('click', () => {
                setScopeValue(containerId, button.dataset.papiScope || '');
            });
        });
    }

    async function loadUsers() {
        const response = await fetch('/api/admin/users');
        const payload = await response.json();

        if (!response.ok || !payload || payload.success !== true) {
            throw new Error(String(payload?.message || `加载用户失败: ${response.status}`));
        }

        state.users = Array.isArray(payload.users) ? payload.users : [];
    }

    function init(dependencies) {
        state.dependencies = dependencies || state.dependencies;

        if (state.initialized) {
            return;
        }

        state.initialized = true;
        bindSelector('filter');
        bindSelector('detail');
        bindSelector('modal');
        bindScopeSegment('adminPublicApiScopeSegment');
        bindScopeSegment('adminPublicApiModalScopeSegment');
        void loadUsers().catch((error) => {
            console.error('[PAPI_SCOPE] failed to load users', error);
            showMessage(error.message || '加载用户列表失败');
        });
    }

    function setKeys(keys) {
        state.keys = Array.isArray(keys) ? keys : [];
    }

    function filterKeys(keys) {
        // 管理端仅在本地筛选已授权获取的全部 Key，不向普通用户暴露该列表。
        const rows = Array.isArray(keys) ? keys : [];
        const owner = String(state.filterOwner || '').trim().toLowerCase();

        if (!owner) {
            return rows;
        }

        return rows.filter((item) => String(item?.owner || '').trim().toLowerCase().includes(owner));
    }

    function describeKey(key) {
        const scope = String(key?.scope || '').trim().toLowerCase();
        const owner = String(key?.owner || '').trim();
        const scopeLabel = scope === 'owner'
            ? '用户私有'
            : (scope === 'global' ? '全局访问' : '范围无效');
        return `<span class="papi-scope-badge ${escapeHtml(scope)}">${escapeHtml(scopeLabel)}</span><span class="papi-owner-label">${escapeHtml(owner || '-')}</span>`;
    }

    function renderSelection(key) {
        const scope = String(key?.scope || 'global').trim().toLowerCase();
        const owner = String(key?.owner || '').trim();
        setScopeValue('adminPublicApiScopeSegment', scope);
        const { input } = selectorElements('detail');

        if (input) {
            input.value = owner;
        }
    }

    function collectSettings() {
        const scope = scopeValue('adminPublicApiScopeSegment');
        const { input } = selectorElements('detail');
        const owner = String(input?.value || '').trim();

        if (!scope) {
            throw new Error('请选择 Key 访问范围');
        }

        if (scope === 'owner' && !owner) {
            throw new Error('用户私有 Key 必须选择所属用户');
        }

        return { scope, owner };
    }

    function prepareModal(mode, key) {
        const fields = document.getElementById('adminPublicApiModalScopeFields');
        const isRegenerate = mode === 'regenerate';

        if (fields) {
            fields.hidden = isRegenerate;
        }

        if (isRegenerate) {
            return;
        }

        const scope = String(key?.scope || 'global').trim().toLowerCase();
        const owner = String(key?.owner || '').trim();
        setScopeValue('adminPublicApiModalScopeSegment', scope);
        const { input } = selectorElements('modal');

        if (input) {
            input.value = owner;
        }
    }

    function collectCreateFields() {
        const scope = scopeValue('adminPublicApiModalScopeSegment');
        const { input } = selectorElements('modal');
        const owner = String(input?.value || '').trim();

        if (!scope) {
            throw new Error('请选择 Key 访问范围');
        }

        if (scope === 'owner' && !owner) {
            throw new Error('用户私有 Key 必须选择所属用户');
        }

        return { scope, owner };
    }

    window.NexoraAdminPapiScope = Object.freeze({
        init,
        setKeys,
        filterKeys,
        describeKey,
        renderSelection,
        collectSettings,
        prepareModal,
        collectCreateFields,
    });
})();
