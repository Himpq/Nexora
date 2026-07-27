(function () {
    'use strict';

    const state = {
        keys: [],
        selectedKeyId: '',
        expireOptions: [],
        permissionLabels: {},
        modalCompleted: false,
        dialogController: null,
    };

    function requireGlobalFunction(name) {
        const func = window[name];

        if (typeof func !== 'function') {
            throw new Error(`缺少前端依赖函数: ${name}`);
        }

        return func;
    }

    function showMessage(message) {
        requireGlobalFunction('showToast')(String(message || ''));
    }

    function getSettingsManagement() {
        const module = window.NexoraSettingsManagement;

        if (
            !module
            || typeof module.registerActivation !== 'function'
            || typeof module.renderListState !== 'function'
        ) {
            throw new Error('NexoraSettingsManagement 模块未初始化');
        }

        return module;
    }

    function getSettingsDialog() {
        const module = window.NexoraSettingsDialog;

        if (
            !module
            || typeof module.confirm !== 'function'
            || typeof module.copyText !== 'function'
            || typeof module.createDialogController !== 'function'
            || typeof module.getExpiryValue !== 'function'
            || typeof module.localizePublicApiExpiryOptions !== 'function'
            || typeof module.renderExpirySlider !== 'function'
        ) {
            throw new Error('NexoraSettingsDialog 模块未初始化');
        }

        return module;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatDateTime(value) {
        const raw = String(value || '').trim();

        if (!raw) {
            return '永久有效';
        }

        const date = new Date(raw);

        if (!Number.isFinite(date.getTime())) {
            return raw;
        }

        return date.toLocaleString('zh-CN', { hour12: false });
    }

    async function requestJson(url, options = {}) {
        // 统一把 HTTP 状态和业务失败转为可展示的异常，调用方不再误报成功。
        const response = await fetch(url, options);
        let payload;

        try {
            payload = await response.json();
        } catch (error) {
            throw new Error(`接口返回了无效 JSON: ${response.status}`);
        }

        if (!response.ok || !payload || payload.success !== true) {
            throw new Error(String(payload?.message || `请求失败: ${response.status}`));
        }

        return payload;
    }

    function selectedKey() {
        return state.keys.find((item) => String(item?.id || '') === state.selectedKeyId) || null;
    }

    function renderPermissionControls(container, permissions) {
        if (!container) {
            return;
        }

        const values = permissions && typeof permissions === 'object' ? permissions : {};
        container.innerHTML = Object.entries(state.permissionLabels).map(([permissionId, label]) => `
            <label class="settings-toggle-item">
                <input class="settings-toggle-input" type="checkbox" data-papi-permission="${escapeHtml(permissionId)}" ${values[permissionId] !== false ? 'checked' : ''}>
                <span class="settings-toggle-label">${escapeHtml(label)}</span>
                <span class="settings-toggle-track" aria-hidden="true"></span>
            </label>
        `).join('');
    }

    function collectPermissions(container) {
        const permissions = {};

        container?.querySelectorAll('input[data-papi-permission]').forEach((input) => {
            permissions[String(input.dataset.papiPermission || '')] = !!input.checked;
        });

        return permissions;
    }

    function renderKeyList() {
        const list = document.getElementById('userPapiKeyList');

        if (!list) {
            return;
        }

        if (!state.keys.length) {
            getSettingsManagement().renderListState(list, {
                message: '暂无 API Key',
                tone: 'neutral',
            });
            return;
        }

        list.innerHTML = state.keys.map((item) => {
            const keyId = String(item?.id || '').trim();
            const active = keyId === state.selectedKeyId ? ' active' : '';
            const status = item?.is_expired ? '已过期' : '有效';
            return `
                <button class="admin-user-item papi-key-list-item${active}" type="button" data-user-papi-key-id="${escapeHtml(keyId)}">
                    <span class="admin-user-avatar admin-public-api-key-icon"><i class="fa-solid fa-key" aria-hidden="true"></i></span>
                    <span class="papi-key-list-main">
                        <span class="admin-user-name">${escapeHtml(item?.name || keyId)}</span>
                        <span class="admin-user-meta mono">${escapeHtml(item?.key_preview || '-')}</span>
                        <span class="papi-scope-badge owner">用户私有 · ${escapeHtml(status)}</span>
                    </span>
                </button>
            `;
        }).join('');

        list.querySelectorAll('[data-user-papi-key-id]').forEach((button) => {
            button.addEventListener('click', () => {
                state.selectedKeyId = String(button.dataset.userPapiKeyId || '').trim();
                renderKeyList();
                renderKeyDetail();
            });
        });
    }

    function renderKeyDetail() {
        const key = selectedKey();
        const empty = document.getElementById('userPapiKeyEmpty');
        const content = document.getElementById('userPapiKeyDetailContent');

        if (empty) {
            empty.hidden = !!key;
        }

        if (content) {
            content.hidden = !key;
        }

        if (!key) {
            return;
        }

        const nameInput = document.getElementById('userPapiKeyNameInput');
        const preview = document.getElementById('userPapiKeyPreview');
        const createdAt = document.getElementById('userPapiKeyCreatedAt');
        const expiresAt = document.getElementById('userPapiKeyExpiresAt');

        if (nameInput) {
            nameInput.value = String(key.name || '');
        }

        if (preview) {
            preview.textContent = String(key.key_preview || '-');
        }

        if (createdAt) {
            createdAt.textContent = formatDateTime(key.created_at);
        }

        if (expiresAt) {
            expiresAt.textContent = formatDateTime(key.expires_at);
        }

        getSettingsDialog().renderExpirySlider(
            document.getElementById('userPapiKeyExpireSlider'),
            getSettingsDialog().localizePublicApiExpiryOptions(state.expireOptions),
            String(key.expire_option || '').trim(),
        );
        renderPermissionControls(
            document.getElementById('userPapiKeyPermissions'),
            key.permissions || {},
        );
    }

    function applyPayload(payload) {
        // 服务端只返回当前会话用户的 owner Key，前端不保留跨用户缓存。
        state.keys = Array.isArray(payload?.keys) ? payload.keys : [];
        state.expireOptions = Array.isArray(payload?.expire_options) ? payload.expire_options : [];
        state.permissionLabels = payload?.permission_labels && typeof payload.permission_labels === 'object'
            ? payload.permission_labels
            : {};

        getSettingsDialog().renderExpirySlider(
            document.getElementById('userPapiKeyModalExpireSlider'),
            getSettingsDialog().localizePublicApiExpiryOptions(state.expireOptions),
            'forever',
        );

        if (!state.keys.some((item) => String(item?.id || '') === state.selectedKeyId)) {
            state.selectedKeyId = String(state.keys[0]?.id || '');
        }

        renderKeyList();
        renderKeyDetail();
    }

    async function loadUserApiKeys() {
        // 进入设置页或完成写操作后从服务端重新取得真实状态。
        const list = document.getElementById('userPapiKeyList');
        const createButton = document.getElementById('userPapiKeyCreateBtn');

        if (createButton) {
            createButton.disabled = true;
        }

        if (list) {
            list.setAttribute('aria-busy', 'true');
            getSettingsManagement().renderListState(list, {
                message: '正在加载 API Key...',
                tone: 'neutral',
            });
        }

        try {
            const payload = await requestJson('/api/user/papi-keys');
            applyPayload(payload);

            if (createButton) {
                createButton.disabled = false;
            }
        } catch (error) {
            showMessage(error.message || '加载 API Key 失败');

            if (list) {
                getSettingsManagement().renderListState(list, {
                    message: String(error.message || '加载失败'),
                    tone: 'error',
                });
            }
        } finally {
            if (list) {
                list.removeAttribute('aria-busy');
            }
        }
    }

    function resetModal() {
        const form = document.getElementById('userPapiKeyModalForm');
        const result = document.getElementById('userPapiKeyPlainResult');
        const plainValue = document.getElementById('userPapiKeyPlainValue');
        const confirmButton = document.getElementById('userPapiKeyModalConfirmBtn');
        const cancelButton = document.getElementById('userPapiKeyModalCancelBtn');
        state.modalCompleted = false;

        if (plainValue) {
            plainValue.textContent = '';
        }

        if (form) {
            form.hidden = false;
        }

        if (result) {
            result.hidden = true;
        }

        if (confirmButton) {
            confirmButton.textContent = '创建';
        }

        if (cancelButton) {
            cancelButton.hidden = false;
        }

    }

    function ensureDialogController() {
        if (state.dialogController) {
            return state.dialogController;
        }

        state.dialogController = getSettingsDialog().createDialogController({
            dialogId: 'userPapiKeyModal',
            onClose: resetModal,
        });

        return state.dialogController;
    }

    function closeModal() {
        ensureDialogController().close('action');
    }

    function openCreateModal() {
        const modalTitle = document.getElementById('userPapiKeyModalTitle');
        const nameInput = document.getElementById('userPapiKeyModalNameInput');
        state.modalCompleted = false;

        if (modalTitle) {
            modalTitle.textContent = '新建 API Key';
        }

        if (nameInput) {
            nameInput.value = '';
        }

        getSettingsDialog().renderExpirySlider(
            document.getElementById('userPapiKeyModalExpireSlider'),
            getSettingsDialog().localizePublicApiExpiryOptions(state.expireOptions),
            'forever',
        );
        renderPermissionControls(document.getElementById('userPapiKeyModalPermissions'), {});
        ensureDialogController().open({ initialFocus: nameInput });
    }

    function showPlainKey(plainKey, title) {
        const modalTitle = document.getElementById('userPapiKeyModalTitle');
        const form = document.getElementById('userPapiKeyModalForm');
        const result = document.getElementById('userPapiKeyPlainResult');
        const plainValue = document.getElementById('userPapiKeyPlainValue');
        const confirmButton = document.getElementById('userPapiKeyModalConfirmBtn');
        const cancelButton = document.getElementById('userPapiKeyModalCancelBtn');
        state.modalCompleted = true;

        if (modalTitle) {
            modalTitle.textContent = title;
        }

        if (form) {
            form.hidden = true;
        }

        if (result) {
            result.hidden = false;
        }

        if (plainValue) {
            plainValue.textContent = String(plainKey || '');
        }

        if (confirmButton) {
            confirmButton.textContent = '关闭';
        }

        if (cancelButton) {
            cancelButton.hidden = true;
        }

        ensureDialogController().open({
            initialFocus: document.getElementById('userPapiKeyCopyBtn'),
        });
    }

    async function submitCreate() {
        if (state.modalCompleted) {
            closeModal();
            return;
        }

        const name = String(document.getElementById('userPapiKeyModalNameInput')?.value || '').trim();
        const expire = getSettingsDialog().getExpiryValue(
            document.getElementById('userPapiKeyModalExpireSlider'),
        );
        const permissions = collectPermissions(document.getElementById('userPapiKeyModalPermissions'));
        const button = document.getElementById('userPapiKeyModalConfirmBtn');

        if (button) {
            button.disabled = true;
        }

        try {
            const payload = await requestJson('/api/user/papi-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, expire, permissions }),
            });
            state.selectedKeyId = String(payload.key?.id || '');
            await loadUserApiKeys();
            showPlainKey(payload.public_api_key, 'API Key 创建成功');
            showMessage('API Key 已创建');
        } catch (error) {
            showMessage(error.message || '创建 API Key 失败');
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    async function saveSelectedKey() {
        const key = selectedKey();

        if (!key) {
            showMessage('请先选择 API Key');
            return;
        }

        const name = String(document.getElementById('userPapiKeyNameInput')?.value || '').trim();
        const expire = getSettingsDialog().getExpiryValue(
            document.getElementById('userPapiKeyExpireSlider'),
        );
        const permissions = collectPermissions(document.getElementById('userPapiKeyPermissions'));

        try {
            await requestJson(`/api/user/papi-keys/${encodeURIComponent(key.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, expire, permissions }),
            });
            await loadUserApiKeys();
            showMessage('API Key 设置已保存');
        } catch (error) {
            showMessage(error.message || '保存 API Key 失败');
        }
    }

    async function rotateSelectedKey() {
        const key = selectedKey();

        if (!key) {
            showMessage('请先选择 API Key');
            return;
        }

        const confirmed = await getSettingsDialog().confirm({
            confirmLabel: '轮换',
            message: '轮换后旧 Key 会立即失效，是否继续？',
            dialogId: 'papiKeyConfirmModal',
            title: '轮换 API Key',
            tone: 'primary',
        });

        if (!confirmed) {
            return;
        }

        const expire = getSettingsDialog().getExpiryValue(
            document.getElementById('userPapiKeyExpireSlider'),
        );

        try {
            const payload = await requestJson(`/api/user/papi-keys/${encodeURIComponent(key.id)}/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expire }),
            });
            await loadUserApiKeys();
            showPlainKey(payload.public_api_key, 'API Key 轮换成功');
            showMessage('API Key 已轮换');
        } catch (error) {
            showMessage(error.message || '轮换 API Key 失败');
        }
    }

    async function deleteSelectedKey() {
        const key = selectedKey();

        if (!key) {
            showMessage('请先选择 API Key');
            return;
        }

        const confirmed = await getSettingsDialog().confirm({
            confirmLabel: '删除',
            message: `确认删除“${String(key.name || key.id)}”吗？此操作不可撤销。`,
            dialogId: 'papiKeyConfirmModal',
            title: '删除 API Key',
            tone: 'danger',
        });

        if (!confirmed) {
            return;
        }

        try {
            await requestJson(`/api/user/papi-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
            state.selectedKeyId = '';
            await loadUserApiKeys();
            showMessage('API Key 已删除');
        } catch (error) {
            showMessage(error.message || '删除 API Key 失败');
        }
    }

    async function copyPlainKey() {
        const plainKey = String(document.getElementById('userPapiKeyPlainValue')?.textContent || '').trim();

        if (!plainKey) {
            showMessage('当前没有可复制的 Key');
            return;
        }

        try {
            await getSettingsDialog().copyText(plainKey);
            showMessage('API Key 已复制');
        } catch (error) {
            showMessage(`复制失败: ${error.message || error}`);
        }
    }

    function bindButton(id, handler) {
        const button = document.getElementById(id);

        if (!button || button.dataset.papiBound === '1') {
            return;
        }

        button.dataset.papiBound = '1';
        button.addEventListener('click', () => {
            void handler();
        });
    }

    function initUserApiKeysTab() {
        ensureDialogController();
        bindButton('userPapiKeyCreateBtn', openCreateModal);
        bindButton('userPapiKeyRefreshBtn', loadUserApiKeys);
        bindButton('userPapiKeySaveBtn', saveSelectedKey);
        bindButton('userPapiKeyRotateBtn', rotateSelectedKey);
        bindButton('userPapiKeyDeleteBtn', deleteSelectedKey);
        bindButton('userPapiKeyModalConfirmBtn', submitCreate);
        bindButton('userPapiKeyCopyBtn', copyPlainKey);
    }

    window.NexoraUserApiKeys = Object.freeze({
        initUserApiKeysTab,
        loadUserApiKeys,
    });

    getSettingsManagement().registerActivation('user-api-keys', () => {
        initUserApiKeysTab();
        void loadUserApiKeys();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUserApiKeysTab, { once: true });
    } else {
        initUserApiKeysTab();
    }
})();
