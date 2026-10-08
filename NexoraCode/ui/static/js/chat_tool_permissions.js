const TOOL_PERMISSION_MODES = [
    { id: 'read_only', name: '只读' },
    { id: 'confirm', name: '写入 / 命令确认' },
    { id: 'auto', name: '自动审批' },
    { id: 'full', name: '完全访问' },
];

function getPermissionMode(mode) {
    return TOOL_PERMISSION_MODES.find((item) => item.id === mode) || null;
}

// 通过本地权限接口读取或保存模式，保留服务端校验边界。
async function requestToolPermissionSettings(method, body) {
    const options = {
        method,
        credentials: 'include',
        headers: {},
    };

    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch('/api/local/permissions', options);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.success) {
        throw new Error((data && data.message) || '工具权限设置请求失败');
    }

    return data;
}

// 将单图标菜单绑定到输入容器，并同步本地权限模式。
function bindToolPermissionSwitcher() {
    const root = document.getElementById('toolPermissionSwitcher');
    const trigger = document.getElementById('toolPermissionSwitcherTrigger');
    const menu = document.getElementById('toolPermissionSwitcherMenu');
    const container = root ? root.closest('.input-container') : null;
    const note = document.getElementById('toolPermissionSwitcherAutoNote');
    const feedback = document.getElementById('toolPermissionSwitcherFeedback');

    if (!root || !trigger || !menu || !container || !note || !feedback) {
        return;
    }

    const optionButtons = Array.from(menu.querySelectorAll('[data-permission-mode]'));
    const state = {
        mode: '',
        approvalModelId: '',
        savedApprovalModelId: '',
        models: [],
        loaded: false,
        refreshing: false,
        saving: false,
        error: '',
    };

    function hasApprovalModel() {
        return !!state.approvalModelId && state.models.some((model) => (
            String(model.id || '') === state.approvalModelId
        ));
    }

    function currentModelId() {
        const modelId = String(localStorage.getItem('selectedModel') || '').trim();

        return state.models.some((model) => String(model.id || '') === modelId)
            ? modelId
            : '';
    }

    function applySettings(settings) {
        state.mode = String(settings.mode || '');
        state.models = Array.isArray(settings.models) ? settings.models : [];
        state.savedApprovalModelId = String(settings.approval_model_id || '');
        state.approvalModelId = state.models.some((model) => (
            String(model.id || '') === state.savedApprovalModelId
        ))
            ? state.savedApprovalModelId
            : currentModelId();
        state.loaded = true;
        state.error = '';
    }

    // 同步当前模式、图标提示和自动审批可用状态。
    function render() {
        const activeMode = getPermissionMode(state.mode);
        const modelReady = hasApprovalModel();

        trigger.setAttribute('aria-busy', String(!state.loaded || state.refreshing || state.saving));
        trigger.dataset.mode = state.mode;
        trigger.title = state.error
            ? '工具权限设置加载失败'
            : activeMode
                ? `工具权限：${activeMode.name}`
                : '工具权限：加载中';
        trigger.setAttribute('aria-label', activeMode
            ? `工具权限：${activeMode.name}`
            : '工具权限');

        optionButtons.forEach((button) => {
            const mode = String(button.dataset.permissionMode || '');
            const selected = mode === state.mode;
            const unavailableAuto = mode === 'auto' && !modelReady;

            button.setAttribute('aria-checked', String(selected));
            button.disabled = !state.loaded || state.refreshing || state.saving || unavailableAuto;
        });

        note.hidden = modelReady;
    }

    function focusCurrentOption() {
        if (menu.hidden || state.refreshing) {
            return;
        }

        const activeOption = optionButtons.find((button) => (
            button.getAttribute('aria-checked') === 'true' && !button.disabled
        ));
        const firstAvailableOption = optionButtons.find((button) => !button.disabled);
        const focusTarget = activeOption || firstAvailableOption;

        if (focusTarget) {
            focusTarget.focus();
        }
    }

    // 每次打开菜单都从服务端读取设置，及时反映独立设置窗口的保存结果。
    async function refreshSettings() {
        if (state.refreshing || state.saving) {
            return;
        }

        state.refreshing = true;
        state.loaded = false;
        state.error = '';
        feedback.hidden = true;
        render();

        try {
            const settings = await requestToolPermissionSettings('GET');
            applySettings(settings);
        } catch (error) {
            state.error = String((error && error.message) || '工具权限模式加载失败');
            feedback.textContent = state.error;
            feedback.hidden = menu.hidden;
        } finally {
            state.refreshing = false;
            render();
            focusCurrentOption();
        }
    }

    function closeMenu(restoreFocus) {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        container.classList.remove('permission-switcher-open');

        if (restoreFocus) {
            trigger.focus();
        }
    }

    function openMenu() {
        if (state.saving) {
            return;
        }

        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        container.classList.add('permission-switcher-open');
        feedback.hidden = true;

        if (!state.refreshing) {
            void refreshSettings();
        }

        focusCurrentOption();
    }

    // 先校验审批模型，再保存模式并反馈接口结果。
    async function selectMode(mode) {
        if (!getPermissionMode(mode) || !state.loaded || state.refreshing || state.saving) {
            return;
        }

        if (mode === 'auto' && !hasApprovalModel()) {
            feedback.textContent = '请先在设置的“工具权限”中选择审批模型。';
            feedback.hidden = false;
            return;
        }

        const approvalModelId = hasApprovalModel() ? state.approvalModelId : '';

        if (mode === state.mode && approvalModelId === state.savedApprovalModelId) {
            closeMenu(true);
            return;
        }

        state.saving = true;
        feedback.hidden = true;
        render();

        try {
            await requestToolPermissionSettings('POST', {
                mode,
                approval_model_id: approvalModelId,
            });
            state.mode = mode;
            state.approvalModelId = approvalModelId;
            state.savedApprovalModelId = approvalModelId;
            render();
            closeMenu(true);
        } catch (error) {
            feedback.textContent = String((error && error.message) || '工具权限设置保存失败');
            feedback.hidden = false;
        } finally {
            state.saving = false;
            render();
        }
    }

    trigger.addEventListener('click', () => {
        if (menu.hidden) {
            openMenu();
            return;
        }

        closeMenu(false);
    });

    menu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-permission-mode]');

        if (button && !button.disabled) {
            selectMode(String(button.dataset.permissionMode || ''));
        }
    });

    menu.addEventListener('keydown', (event) => {
        const availableOptions = optionButtons.filter((button) => !button.disabled);
        const currentIndex = availableOptions.indexOf(document.activeElement);
        let nextIndex = -1;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(true);
            return;
        }

        if (event.key === 'Tab') {
            closeMenu(false);
            return;
        }

        if (event.key === 'ArrowDown') {
            nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % availableOptions.length;
        } else if (event.key === 'ArrowUp') {
            nextIndex = currentIndex < 0
                ? availableOptions.length - 1
                : (currentIndex - 1 + availableOptions.length) % availableOptions.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = availableOptions.length - 1;
        }

        if (nextIndex >= 0 && availableOptions[nextIndex]) {
            event.preventDefault();
            availableOptions[nextIndex].focus();
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (!root.contains(event.target) && !menu.hidden) {
            closeMenu(false);
        }
    });

    window.__ncRefreshToolPermissions = refreshSettings;
    void refreshSettings();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToolPermissionSwitcher, { once: true });
} else {
    bindToolPermissionSwitcher();
}
