/**
 * NexoraSettingsManagement - 设置管理面板基础设施
 *
 * 提供设置面板的布局校验、tab 激活、列表状态渲染等通用能力。
 *
 * 用法:
 *   import { NexoraSettingsManagement } from './chat_settings_management.js';
 *   NexoraSettingsManagement.init();
 *   NexoraSettingsManagement.registerActivation('apikeys', () => { ... });
 */

const PANEL_SELECTOR = '#settingsModal .settings-management-panel';
const activationHandlers = new Map();

function requireElement(element, message) {
    if (!(element instanceof HTMLElement)) {
        throw new Error(message);
    }

    return element;
}

function validatePanel(panel) {
    const panelId = String(panel.id || '').trim();

    if (!panelId) {
        throw new Error('设置管理面板缺少 id');
    }

    requireElement(
        panel.querySelector(':scope > .settings-management-toolbar'),
        `${panelId} 缺少 settings-management-toolbar`,
    );
    const layout = requireElement(
        panel.querySelector(':scope > .settings-management-layout'),
        `${panelId} 缺少 settings-management-layout`,
    );
    requireElement(
        layout.querySelector(':scope > .settings-management-list'),
        `${panelId} 缺少 settings-management-list`,
    );
    requireElement(
        layout.querySelector(':scope > .settings-management-detail'),
        `${panelId} 缺少 settings-management-detail`,
    );

    panel.dataset.settingsManagementReady = '1';
}

function init() {
    const panels = Array.from(document.querySelectorAll(PANEL_SELECTOR));

    if (!panels.length) {
        throw new Error('未找到设置管理面板');
    }

    panels.forEach(validatePanel);
}

function activate(tabName) {
    const normalizedTabName = String(tabName).trim();
    const panel = document.getElementById(`settings-${normalizedTabName}-tab`);

    if (!panel || !panel.classList.contains('settings-management-panel')) {
        return;
    }

    if (panel.dataset.settingsManagementReady !== '1') {
        throw new Error(`${panel.id} 尚未通过设置管理布局校验`);
    }

    const layout = requireElement(
        panel.querySelector(':scope > .settings-management-layout'),
        `${panel.id} 缺少 settings-management-layout`,
    );
    const list = requireElement(
        layout.querySelector(':scope > .settings-management-list'),
        `${panel.id} 缺少 settings-management-list`,
    );
    const detail = requireElement(
        layout.querySelector(':scope > .settings-management-detail'),
        `${panel.id} 缺少 settings-management-detail`,
    );

    panel.scrollTop = 0;
    list.scrollTop = 0;
    detail.scrollTop = 0;

    const handler = activationHandlers.get(normalizedTabName);

    if (handler) {
        handler();
    }
}

function registerActivation(tabName, handler) {
    const normalizedTabName = String(tabName).trim();

    if (!normalizedTabName) {
        throw new Error('设置管理面板激活回调缺少 tabName');
    }

    if (typeof handler !== 'function') {
        throw new Error(`${normalizedTabName} 的设置管理面板激活回调无效`);
    }

    if (activationHandlers.has(normalizedTabName)) {
        throw new Error(`${normalizedTabName} 已注册设置管理面板激活回调`);
    }

    activationHandlers.set(normalizedTabName, handler);
}

function renderListState(list, state) {
    const target = requireElement(list, '列表状态缺少目标元素');

    if (!state || typeof state !== 'object') {
        throw new Error('列表状态参数无效');
    }

    if (typeof state.message !== 'string' || typeof state.tone !== 'string') {
        throw new Error('列表状态 message 和 tone 必须为字符串');
    }

    const message = state.message.trim();
    const tone = state.tone.trim();

    if (!message) {
        throw new Error('列表状态缺少 message');
    }

    if (tone !== 'neutral' && tone !== 'error') {
        throw new Error(`不支持的列表状态类型: ${tone}`);
    }

    const status = document.createElement('div');
    status.className = 'admin-user-detail-empty settings-management-list-state';
    status.classList.toggle('is-error', tone === 'error');
    status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    status.textContent = message;
    target.replaceChildren(status);
}

export const NexoraSettingsManagement = Object.freeze({
    activate,
    init,
    registerActivation,
    renderListState,
});

// 兼容期：保留 window 挂载
window.NexoraSettingsManagement = NexoraSettingsManagement;
