(function () {
    'use strict';

    const MODULE_NAME = 'admin';
    const ADMIN_SYSTEM_SELECT_ROOT_SELECTOR = '#settingsModal [data-admin-system-select], #adminConfigModal [data-admin-system-select]';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Admin 模块');
        }

        return shared;
    }

    function requireAdminDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_admin 缺少依赖: ${name}`);
        }

        return value;
    }

    function createAdminSystemControlsController(deps = {}) {
        const normalizeModelProviderKey = requireAdminDependency(deps, 'normalizeModelProviderKey');
        const compareModelProviderKeys = requireAdminDependency(deps, 'compareModelProviderKeys');
        const getModelProviderLabel = requireAdminDependency(deps, 'getModelProviderLabel');
        const renderProviderIconHtml = requireAdminDependency(deps, 'renderProviderIconHtml');

        let controlsBound = false;
        let selectMenuSeq = 0;
        const selectDockState = new WeakMap();

        function getAdminSystemSelectRoot(valueId) {
            const id = String(valueId || '').trim();

            if (!id) {
                return null;
            }

            const roots = document.querySelectorAll(ADMIN_SYSTEM_SELECT_ROOT_SELECTOR);

            return Array.from(roots).find((node) => String(node.dataset.adminSystemSelect || '') === id) || null;
        }

        function getAdminSystemSelectRoots() {
            return Array.from(document.querySelectorAll(ADMIN_SYSTEM_SELECT_ROOT_SELECTOR));
        }

        function getAdminSystemSelectValueId(root) {
            return root ? String(root.dataset.adminSystemSelect || '').trim() : '';
        }

        function getAdminSystemSelectMenu(root) {
            if (!root) {
                return null;
            }

            const dockState = selectDockState.get(root);

            if (dockState && dockState.menu) {
                return dockState.menu;
            }

            const menu = root.querySelector('[data-admin-system-select-menu]');

            if (menu) {
                menu.dataset.adminSystemSelectOwner = getAdminSystemSelectValueId(root);
            }

            return menu;
        }

        function getAdminSystemSelectRootFromMenu(menu) {
            const ownerId = menu ? String(menu.dataset.adminSystemSelectOwner || '').trim() : '';

            return ownerId ? getAdminSystemSelectRoot(ownerId) : null;
        }

        function dockAdminSystemSelectMenu(root) {
            const menu = getAdminSystemSelectMenu(root);
            const dockTarget = (root && root.closest('.modal-backdrop')) || document.getElementById('settingsModal') || document.body;

            if (!root || !menu || menu.parentElement === dockTarget) {
                return menu;
            }

            const dockState = {
                menu,
                parent: menu.parentNode,
                nextSibling: menu.nextSibling,
            };

            selectMenuSeq += 1;
            menu.dataset.adminSystemSelectOwner = getAdminSystemSelectValueId(root);
            menu.dataset.adminSystemDocked = '1';
            menu.id = menu.id || `adminSystemSelectMenu${selectMenuSeq}`;
            selectDockState.set(root, dockState);
            dockTarget.appendChild(menu);

            return menu;
        }

        function undockAdminSystemSelectMenu(root) {
            const dockState = root ? selectDockState.get(root) : null;

            if (!dockState || !dockState.menu) {
                return;
            }

            const menu = dockState.menu;
            const parent = dockState.parent;
            const nextSibling = dockState.nextSibling;

            if (parent && parent.isConnected) {

                if (nextSibling && nextSibling.parentNode === parent) {
                    parent.insertBefore(menu, nextSibling);
                } else {
                    parent.appendChild(menu);
                }
            }

            delete menu.dataset.adminSystemDocked;
            menu.classList.remove('is-open');
            selectDockState.delete(root);
        }

        function resetAdminSystemSelectMenuPosition(root) {
            const menu = getAdminSystemSelectMenu(root);

            if (!menu) {
                return;
            }

            menu.style.left = '';
            menu.style.top = '';
            menu.style.width = '';
            menu.style.maxHeight = '';
            menu.style.setProperty('--admin-system-select-menu-width', '');
        }

        function positionAdminSystemSelectMenu(root) {
            if (!root) {
                return;
            }

            const trigger = root.querySelector('[data-admin-system-select-trigger]');
            const menu = getAdminSystemSelectMenu(root);

            if (!trigger || !menu) {
                return;
            }

            const rect = trigger.getBoundingClientRect();
            const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
            const margin = 12;
            const isModelMenu = menu.classList.contains('is-model-menu');
            const preferredWidth = isModelMenu ? Math.max(rect.width, 560) : rect.width;
            const width = Math.max(220, Math.min(preferredWidth, viewportWidth - margin * 2));
            const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
            const belowSpace = viewportHeight - rect.bottom - margin;
            const aboveSpace = rect.top - margin;
            const menuMaxHeight = Math.max(160, Math.min(isModelMenu ? 420 : 280, Math.max(belowSpace, aboveSpace)));
            const openBelow = belowSpace >= Math.min(menuMaxHeight, 220) || belowSpace >= aboveSpace;
            const top = openBelow
                ? Math.min(rect.bottom + 8, viewportHeight - margin - menuMaxHeight)
                : Math.max(margin, rect.top - 8 - menuMaxHeight);

            menu.style.setProperty('--admin-system-select-menu-width', `${width}px`);
            menu.style.width = `${width}px`;
            menu.style.left = `${left}px`;
            menu.style.top = `${Math.max(margin, top)}px`;
            menu.style.maxHeight = `${menuMaxHeight}px`;
        }

        function repositionOpenAdminSystemSelect() {
            const root = getAdminSystemSelectRoots().find((node) => node.classList.contains('open')) || null;

            if (root) {
                positionAdminSystemSelectMenu(root);
            }
        }

        function closeAdminSystemSelects(exceptRoot = null) {
            getAdminSystemSelectRoots().forEach((root) => {

                if (exceptRoot && root === exceptRoot) {
                    return;
                }

                if (!root.classList.contains('open')) {
                    return;
                }

                root.classList.remove('open');
                const menu = getAdminSystemSelectMenu(root);

                if (menu) {
                    menu.classList.remove('is-open');
                }

                resetAdminSystemSelectMenuPosition(root);
                undockAdminSystemSelectMenu(root);

                const trigger = root.querySelector('[data-admin-system-select-trigger]');

                if (trigger) {
                    trigger.setAttribute('aria-expanded', 'false');
                }
            });
        }

        function setAdminSystemSelectOpen(root, open) {
            if (!root) {
                return;
            }

            const shouldOpen = !!open;
            const trigger = root.querySelector('[data-admin-system-select-trigger]');
            const menu = shouldOpen ? dockAdminSystemSelectMenu(root) : getAdminSystemSelectMenu(root);

            root.classList.toggle('open', shouldOpen);

            if (trigger) {
                trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            }

            if (menu) {
                menu.classList.toggle('is-open', shouldOpen);
            }

            if (shouldOpen) {
                positionAdminSystemSelectMenu(root);
            } else {
                resetAdminSystemSelectMenuPosition(root);
                undockAdminSystemSelectMenu(root);
            }
        }

        function syncAdminSystemSelectDisplay(valueId) {
            const id = String(valueId || '').trim();
            const input = document.getElementById(id);
            const root = getAdminSystemSelectRoot(id);

            if (!input || !root) {
                return;
            }

            const value = String(input.value || '');
            const labelEl = root.querySelector('[data-admin-system-select-label]');
            const menu = getAdminSystemSelectMenu(root);
            const optionNodes = menu ? Array.from(menu.querySelectorAll('[data-admin-system-select-option]')) : [];
            const selectedOption = optionNodes.find((node) => String(node.dataset.value || '') === value) || null;
            const labelText = selectedOption
                ? String(selectedOption.dataset.label || selectedOption.textContent || '').trim()
                : (value || '不指定');

            optionNodes.forEach((node) => {
                const active = String(node.dataset.value || '') === value;
                node.classList.toggle('active', active);
                node.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            if (labelEl) {
                labelEl.textContent = labelText || '不指定';
            }
        }

        function setAdminSystemCustomSelectValue(valueId, value) {
            const id = String(valueId || '').trim();
            const input = document.getElementById(id);

            if (!input) {
                return;
            }

            const nextValue = value == null ? '' : String(value);
            const changed = input.value !== nextValue;

            input.value = nextValue;
            syncAdminSystemSelectDisplay(id);

            if (changed) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        function buildAdminSystemSelectOption(item, currentValue) {
            const value = String(item && item.value != null ? item.value : '');
            const label = String(item && item.label != null ? item.label : (value || '不指定'));
            const meta = String(item && item.meta != null ? item.meta : '');
            const active = value === currentValue;
            const option = document.createElement('button');
            const main = document.createElement('span');

            option.type = 'button';
            option.className = 'admin-system-select-option';
            option.dataset.adminSystemSelectOption = '1';
            option.dataset.value = value;
            option.dataset.label = label;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', active ? 'true' : 'false');
            option.classList.toggle('active', active);

            if (item && item.stale) {
                option.classList.add('is-stale');
            }

            main.className = 'admin-system-select-option-main';
            main.textContent = label || '不指定';
            option.appendChild(main);

            if (meta) {
                const metaEl = document.createElement('span');
                metaEl.className = 'admin-system-select-option-meta';
                metaEl.textContent = meta;
                option.appendChild(metaEl);
            }

            return option;
        }

        function buildAdminSystemModelSelectChip(item, currentValue) {
            const value = String(item && item.value != null ? item.value : '');
            const label = String(item && item.label != null ? item.label : (value || '不指定'));
            const meta = String(item && item.meta != null ? item.meta : '');
            const active = value === currentValue;
            const chip = document.createElement('button');
            const name = document.createElement('span');

            chip.type = 'button';
            chip.className = 'admin-system-select-option admin-system-model-chip';
            chip.dataset.adminSystemSelectOption = '1';
            chip.dataset.value = value;
            chip.dataset.label = label;
            chip.setAttribute('role', 'option');
            chip.setAttribute('aria-selected', active ? 'true' : 'false');
            chip.classList.toggle('active', active);

            if (item && item.stale) {
                chip.classList.add('is-stale');
            }

            name.className = 'admin-system-model-chip-name';
            name.textContent = label || '不指定';
            chip.appendChild(name);

            if (meta) {
                const metaEl = document.createElement('span');
                metaEl.className = 'admin-system-model-chip-meta';
                metaEl.textContent = meta;
                chip.appendChild(metaEl);
            }

            if (value) {
                chip.title = value;
            }

            return chip;
        }

        function appendAdminSystemModelSelectGroups(menu, optionItems, currentValue) {
            const groups = new Map();

            optionItems.forEach((item) => {
                const value = String(item && item.value != null ? item.value : '');
                const provider = value ? normalizeModelProviderKey(item && item.provider) : '__default__';

                if (!groups.has(provider)) {
                    groups.set(provider, []);
                }

                groups.get(provider).push(item);
            });

            const sortedProviders = Array.from(groups.keys()).sort((a, b) => {

                if (a === '__default__') {
                    return -1;
                }

                if (b === '__default__') {
                    return 1;
                }

                return compareModelProviderKeys(a, b);
            });

            sortedProviders.forEach((providerKey) => {
                const group = document.createElement('div');
                const title = document.createElement('div');
                const main = document.createElement('span');
                const label = document.createElement('span');
                const providerLabel = providerKey === '__default__' ? '默认' : getModelProviderLabel(providerKey);

                group.className = 'admin-system-model-group';
                title.className = 'admin-system-model-group-title';
                main.className = 'provider-title-main';
                label.className = 'label';
                label.textContent = providerLabel;
                main.innerHTML = renderProviderIconHtml(providerKey, { className: 'provider-logo provider-logo-sm', label: providerLabel });
                main.appendChild(label);
                title.appendChild(main);
                group.appendChild(title);

                const chips = document.createElement('div');
                chips.className = 'admin-system-model-chip-wrap';

                groups.get(providerKey).forEach((item) => {
                    chips.appendChild(buildAdminSystemModelSelectChip(item, currentValue));
                });

                group.appendChild(chips);
                menu.appendChild(group);
            });
        }

        function setAdminSystemSelectOptions(valueId, optionItems, selectedValue, options = {}) {
            const id = String(valueId || '').trim();
            const root = getAdminSystemSelectRoot(id);
            const menu = getAdminSystemSelectMenu(root);

            if (!root || !menu) {
                return;
            }

            menu.dataset.adminSystemSelectOwner = id;

            const currentValue = String(selectedValue == null ? '' : selectedValue).trim();
            const items = Array.isArray(optionItems) ? optionItems : [];
            const modelMenu = !!(options && options.modelMenu);

            menu.innerHTML = '';
            menu.classList.toggle('is-model-menu', modelMenu);

            if (modelMenu) {
                const scroll = document.createElement('div');

                scroll.className = 'admin-system-select-scroll';
                appendAdminSystemModelSelectGroups(scroll, items, currentValue);
                menu.appendChild(scroll);
            } else {
                items.forEach((item) => {
                    menu.appendChild(buildAdminSystemSelectOption(item, currentValue));
                });
            }

            setAdminSystemCustomSelectValue(id, currentValue);
        }

        function setAdminSystemSwitchState(button, value) {
            if (!button) {
                return;
            }

            const enabled = !!value;
            const isCheckbox = button instanceof HTMLInputElement && button.type === 'checkbox';

            if (isCheckbox) {
                const wrap = button.closest('.admin-system-enable-check');
                const label = wrap ? wrap.querySelector('span') : null;

                button.checked = enabled;
                button.dataset.checked = enabled ? '1' : '0';
                button.setAttribute('aria-checked', enabled ? 'true' : 'false');

                if (wrap) {
                    wrap.classList.toggle('is-on', enabled);
                }

                if (label) {
                    label.textContent = enabled ? '启用' : '关闭';
                }

                return;
            }

            const stateText = button.querySelector('[data-admin-system-switch-text]');

            button.dataset.checked = enabled ? '1' : '0';
            button.classList.toggle('is-on', enabled);
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');

            if (stateText) {
                stateText.textContent = enabled ? '启用' : '停用';
            }
        }

        function initAdminSystemCustomControls() {
            document.querySelectorAll('#settingsModal [data-admin-system-switch]').forEach((button) => {

                if (button.dataset.bound === '1') {
                    return;
                }

                button.dataset.bound = '1';
                setAdminSystemSwitchState(button, button.checked || button.classList.contains('is-on') || button.dataset.checked === '1');

                if (button instanceof HTMLInputElement && button.type === 'checkbox') {
                    button.addEventListener('change', () => {
                        setAdminSystemSwitchState(button, button.checked);
                    });
                } else {
                    button.addEventListener('click', () => {
                        setAdminSystemSwitchState(button, button.dataset.checked !== '1');
                    });
                }
            });

            getAdminSystemSelectRoots().forEach((root) => {
                syncAdminSystemSelectDisplay(getAdminSystemSelectValueId(root));
            });

            if (controlsBound) {
                return;
            }

            controlsBound = true;

            document.addEventListener('click', (event) => {
                const target = event.target;

                if (!(target instanceof Element)) {
                    closeAdminSystemSelects();
                    return;
                }

                const option = target.closest('[data-admin-system-select-option]');

                if (option) {
                    const menu = option.closest('[data-admin-system-select-menu]');
                    const root = option.closest('[data-admin-system-select]') || getAdminSystemSelectRootFromMenu(menu);

                    if (root) {
                        event.preventDefault();
                        setAdminSystemCustomSelectValue(getAdminSystemSelectValueId(root), option.dataset.value || '');
                        closeAdminSystemSelects();
                        return;
                    }
                }

                const trigger = target.closest('[data-admin-system-select-trigger]');

                if (trigger) {
                    const root = trigger.closest('[data-admin-system-select]');

                    if (root) {
                        event.preventDefault();
                        const shouldOpen = !root.classList.contains('open');
                        closeAdminSystemSelects(root);
                        setAdminSystemSelectOpen(root, shouldOpen);
                        return;
                    }
                }

                if (target.closest('[data-admin-system-select-menu][data-admin-system-docked="1"]')) {
                    return;
                }

                if (!target.closest('[data-admin-system-select]')) {
                    closeAdminSystemSelects();
                }
            });

            document.addEventListener('keydown', (event) => {

                if (event.key === 'Escape') {
                    closeAdminSystemSelects();
                }
            });

            window.addEventListener('resize', repositionOpenAdminSystemSelect);
            document.addEventListener('scroll', repositionOpenAdminSystemSelect, true);
        }

        return {
            getAdminSystemSelectRoot,
            getAdminSystemSelectRoots,
            getAdminSystemSelectValueId,
            getAdminSystemSelectMenu,
            getAdminSystemSelectRootFromMenu,
            dockAdminSystemSelectMenu,
            undockAdminSystemSelectMenu,
            resetAdminSystemSelectMenuPosition,
            positionAdminSystemSelectMenu,
            repositionOpenAdminSystemSelect,
            closeAdminSystemSelects,
            setAdminSystemSelectOpen,
            syncAdminSystemSelectDisplay,
            setAdminSystemCustomSelectValue,
            buildAdminSystemSelectOption,
            buildAdminSystemModelSelectChip,
            appendAdminSystemModelSelectGroups,
            setAdminSystemSelectOptions,
            setAdminSystemSwitchState,
            initAdminSystemCustomControls,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createAdminSystemControlsController,
    });
})();
