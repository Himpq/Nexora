(function () {
    'use strict';

    const MODULE_NAME = 'admin';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Admin 模块');
        }

        return shared;
    }

    function getAdminSystemModule() {
        return getShared().getModule('adminSystem');
    }

    function requireFunction(deps, key) {
        const fn = deps && deps[key];

        if (typeof fn !== 'function') {
            throw new Error(`Chat Admin 缺少依赖函数: ${key}`);
        }

        return fn;
    }

    function maybeCall(deps, key, ...args) {
        const fn = deps && deps[key];

        if (typeof fn === 'function') {
            return fn(...args);
        }

        return undefined;
    }

    function createAdminSettingsTabsController(deps = {}) {
        const closeQuotaAdjustPopover = requireFunction(deps, 'closeQuotaAdjustPopover');
        const getSettingsModal = requireFunction(deps, 'getSettingsModal');

        function initSettingsTabs() {
            const modal = getSettingsModal();

            if (!modal || modal.dataset.settingsTabsInit === '1') return;

            modal.dataset.settingsTabsInit = '1';
            modal.querySelectorAll('.admin-tab').forEach((tab) => {
                tab.addEventListener('click', () => {
                    const tabName = tab.getAttribute('data-tab');

                    if (tabName) {
                        switchSettingsTab(tabName);
                    }
                });
            });
        }

        function activateSettingsTab(tabName) {
            const modal = getSettingsModal();

            if (modal && modal.dataset) {
                modal.dataset.activeSettingsTab = String(tabName || '');
            }

            document.querySelectorAll('#settingsModal .admin-tab-content').forEach((tab) => {
                tab.classList.remove('active');
            });

            document.querySelectorAll('#settingsModal .admin-tab').forEach((btn) => {
                btn.classList.remove('active');
            });

            const selectedTab = document.getElementById(`settings-${tabName}-tab`);

            if (selectedTab) {
                selectedTab.classList.add('active');
                selectedTab.scrollTop = 0;
            }

            const selectedBtn = document.querySelector(`#settingsModal .admin-tab[data-tab="${tabName}"]`);

            if (selectedBtn) selectedBtn.classList.add('active');

            const settingsContent = modal ? modal.querySelector('.admin-content.settings-content') : null;

            if (settingsContent) settingsContent.scrollTop = 0;
        }

        function switchSettingsTab(tabName) {
            if (tabName !== 'quota' && tabName !== 'admin-models') {
                closeQuotaAdjustPopover();
            }

            activateSettingsTab(tabName);

            if (tabName === 'admin-users') {
                maybeCall(deps, 'resetAdminUserFilter');
                maybeCall(deps, 'loadAdminUsersList');
                maybeCall(deps, 'loadAdminStats');
            }

            if (tabName === 'admin-system') {
                void maybeCall(deps, 'loadAdminSystemSettings');
            }

            if (tabName === 'admin-mail') {
                maybeCall(deps, 'resetAdminMailFilter');
                maybeCall(deps, 'loadAdminMailUsersList');
            }

            if (tabName === 'admin-stats') {
                maybeCall(deps, 'loadAdminStats');
            }

            if (tabName === 'quota') {
                void maybeCall(deps, 'loadServerQuotaSettings');
            }

            if (tabName === 'admin-models') {
                maybeCall(deps, 'loadAdminModelConfig');
                void maybeCall(deps, 'loadServerQuotaSettings');
            }

            if (tabName === 'admin-gen-image') {
                maybeCall(deps, 'resetAdminGenImageApiFilter');
                void maybeCall(deps, 'loadAdminGenImageApis');
            }

            if (tabName === 'admin-auth') {
                void maybeCall(deps, 'loadAdminPublicApiAuth');
            }

            if (tabName === 'admin-chroma') {
                maybeCall(deps, 'loadAdminChromaStats');
            }

            if (tabName === 'skills') {
                void maybeCall(deps, 'loadSkillSettings', true);
            }
        }

        return {
            initSettingsTabs,
            switchSettingsTab,
        };
    }

    function createAdminSettingsEventsController(deps = {}) {
        function bindClick(id, handler) {
            const el = document.getElementById(id);

            if (!el) return;

            el.addEventListener('click', (event) => {
                event.preventDefault();
                void handler(event);
            });
        }

        function bindInput(id, handler) {
            const el = document.getElementById(id);

            if (!el) return;

            el.addEventListener('input', handler);
        }

        function bindChange(id, handler) {
            const el = document.getElementById(id);

            if (!el) return;

            el.addEventListener('change', (event) => {
                void handler(event);
            });
        }

        async function handleQuotaUnitChange(event) {
            const target = event && event.target ? event.target : null;
            const nextValue = target ? target.value : '';
            const normalized = requireFunction(deps, 'normalizeAdminQuotaDisplayUnit')(nextValue);

            requireFunction(deps, 'setAdminQuotaDisplayUnit')(normalized);
            requireFunction(deps, 'saveAdminQuotaDisplayUnitPreference')(normalized);

            if (target) target.value = normalized;

            if (requireFunction(deps, 'hasAdminServerQuotaProviders')()) {
                requireFunction(deps, 'renderAdminModelConfig')({ preserveProviderList: true });
                return;
            }

            if (requireFunction(deps, 'isCurrentUserAdmin')()) {
                await requireFunction(deps, 'loadServerQuotaSettings')();
            }
        }

        function syncQuotaUnitSelect() {
            const unitSelect = document.getElementById('adminQuotaUnitSelect');

            if (!unitSelect) return;

            const displayUnit = requireFunction(deps, 'loadAdminQuotaDisplayUnitPreference')();
            requireFunction(deps, 'setAdminQuotaDisplayUnit')(displayUnit);
            unitSelect.value = displayUnit;
        }

        function bindAdminSettingsEvents() {
            bindInput('adminUserFilterInput', (event) => {
                requireFunction(deps, 'setAdminUserFilterKeyword')(event.target.value || '');
                requireFunction(deps, 'renderAdminUsersList')();
            });

            bindClick('openAddMailUserForm', () => requireFunction(deps, 'renderAdminMailCreateForm')());

            bindInput('adminMailUserFilterInput', (event) => {
                requireFunction(deps, 'setAdminMailUserFilterKeyword')(event.target.value || '');
                requireFunction(deps, 'renderAdminMailUsersList')();
            });

            bindChange('adminMailGroupSelect', async (event) => {
                requireFunction(deps, 'setAdminMailGroup')(event.target.value || 'default');
                await requireFunction(deps, 'loadAdminMailUsersList')();
            });

            bindClick('btnAddProvider', () => requireFunction(deps, 'openProviderEditor')());
            bindClick('btnAddModel', () => requireFunction(deps, 'openModelEditor')());

            bindInput('adminModelSearchInput', (event) => {
                requireFunction(deps, 'setAdminModelSearchKeyword')(event.target.value || '');
                requireFunction(deps, 'renderAdminModelConfig')({ resetModelsScroll: true });
            });

            bindClick('btnAddGenImageApi', () => requireFunction(deps, 'openAdminGenImageApiEditor')());

            bindInput('adminGenImageApiSearchInput', (event) => {
                requireFunction(deps, 'setAdminGenImageApiFilterKeyword')(event.target.value || '');
                requireFunction(deps, 'renderAdminGenImageApis')();
            });

            syncQuotaUnitSelect();
            bindChange('adminQuotaUnitSelect', handleQuotaUnitChange);

            bindClick('adminPublicApiGenerateBtn', () => requireFunction(deps, 'openAdminPublicApiKeyModal')('generate'));
            bindClick('adminPublicApiRegenerateBtn', () => requireFunction(deps, 'openAdminPublicApiKeyModal')('regenerate'));
            bindClick('adminPublicApiRevokeBtn', () => requireFunction(deps, 'revokeAdminPublicApiKey')());
            bindClick('adminPublicApiSaveSettingsBtn', () => requireFunction(deps, 'saveAdminPublicApiSettings')());
            bindClick('adminPublicApiSaveGlobalBtn', () => requireFunction(deps, 'saveAdminPublicApiGlobalSettings')());

            maybeCall(deps, 'initAdminUserTokenStatsControls');

            const publicApiModal = document.getElementById('adminPublicApiKeyModal');

            if (publicApiModal) {
                requireFunction(deps, 'bindBackdropSafeClose')(
                    publicApiModal,
                    requireFunction(deps, 'closeAdminPublicApiKeyModal')
                );
            }

            bindClick('adminPublicApiKeyModalConfirmBtn', () => requireFunction(deps, 'submitAdminPublicApiKeyAction')());

            const textConfirmModal = document.getElementById('adminTextConfirmModal');

            if (textConfirmModal) {
                requireFunction(deps, 'bindBackdropSafeClose')(
                    textConfirmModal,
                    requireFunction(deps, 'closeAdminTextConfirmModal')
                );
            }

            const configModal = document.getElementById('adminConfigModal');

            if (configModal) {
                requireFunction(deps, 'bindBackdropSafeClose')(
                    configModal,
                    requireFunction(deps, 'closeAdminConfigModal')
                );
            }

            bindInput('adminProviderApiTypeInput', () => requireFunction(deps, 'syncAdminProviderApiTypeFields')());
            bindChange('adminProviderApiTypeInput', () => requireFunction(deps, 'syncAdminProviderApiTypeFields')());
            bindClick('adminConfigSaveBtn', () => requireFunction(deps, 'saveAdminConfigModal')());

            const ollamaStatusModal = document.getElementById('ollamaModelStatusModal');

            if (ollamaStatusModal) {
                requireFunction(deps, 'bindBackdropSafeClose')(
                    ollamaStatusModal,
                    requireFunction(deps, 'closeAdminOllamaModelStatusModal')
                );
            }

            bindClick('ollamaModelStatusCloseBtn', () => requireFunction(deps, 'closeAdminOllamaModelStatusModal')());
            bindClick('ollamaModelStatusRefreshBtn', () => requireFunction(deps, 'refreshAdminOllamaModelStatus')());
            bindClick('ollamaModelStatusActionBtn', () => requireFunction(deps, 'toggleAdminOllamaModelStatus')());
        }

        return {
            bindAdminSettingsEvents,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createAdminSystemControlsController(...args) {
            return getAdminSystemModule().createAdminSystemControlsController(...args);
        },
        createAdminSettingsTabsController,
        createAdminSettingsEventsController,
    });
})();
