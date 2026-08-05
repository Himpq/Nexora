/**
 * NexoraSettingsDialog - 设置小窗/确认框基础设施
 *
 * 提供统一的对话框控制器创建、确认弹窗、有效期滑条等 UI 工具。
 *
 * 用法:
 *   import { NexoraSettingsDialog } from './chat_settings_dialog.js';
 *   const controller = NexoraSettingsDialog.createDialogController({ dialogId: 'myDialog' });
 */

const controllers = new Map();
const confirmStates = new Map();

// 全站 modal-backdrop 的唯一层级权威。所有旧入口只可委托此处登记或同步状态。
const registeredModalBackdrops = new Map();
const activeModalBackdrops = [];

const PUBLIC_API_EXPIRY_LABELS = Object.freeze({
    '1d': '1 天',
    '7d': '7 天',
    '1m': '1 个月',
    '3m': '3 个月',
    forever: '永久',
});

const activeDialogIds = [];
const MODAL_STACK_STEP = 20;
let escapeBound = false;
let modalBackdropDocumentObserver = null;

function getModalLayerBase() {
    const rawValue = getComputedStyle(document.documentElement)
        .getPropertyValue('--settings-dialog-layer-base')
        .trim();
    const layerBase = Number(rawValue);

    if (!Number.isInteger(layerBase) || layerBase < 1) {
        throw new Error('共享设置小窗缺少有效的层级基线');
    }

    return layerBase;
}

function getModalLayerStep() {
    return MODAL_STACK_STEP;
}

function requireModalBackdrop(backdrop) {
    if (!(backdrop instanceof HTMLElement) || !backdrop.classList.contains('modal-backdrop')) {
        throw new Error('弹窗栈只能登记 modal-backdrop 元素');
    }

    return backdrop;
}

function removeActiveModalBackdrop(backdrop) {
    const index = activeModalBackdrops.indexOf(backdrop);

    if (index >= 0) {
        activeModalBackdrops.splice(index, 1);
    }
}

function syncModalBackdropStack() {
    const layerBase = getModalLayerBase();

    activeModalBackdrops.forEach((backdrop, stackIndex) => {
        backdrop.style.setProperty(
            'z-index',
            String(layerBase + (stackIndex * getModalLayerStep())),
            'important',
        );
        backdrop.dataset.settingsDialogStackIndex = String(stackIndex);
    });
}

function updateModalBackdropStack(backdrop, promoteActiveBackdrop) {
    const target = requireModalBackdrop(backdrop);
    const state = registeredModalBackdrops.get(target);

    if (!state) {
        throw new Error('弹窗尚未登记到统一弹窗栈');
    }

    const isActive = target.classList.contains('active');

    if (isActive) {
        if (!state.active || promoteActiveBackdrop) {
            removeActiveModalBackdrop(target);
            activeModalBackdrops.push(target);
        }

        state.active = true;
    } else {
        removeActiveModalBackdrop(target);
        state.active = false;
        target.style.removeProperty('z-index');
        delete target.dataset.settingsDialogStackIndex;
    }

    syncModalBackdropStack();
}

function registerModalBackdrop(backdrop) {
    const target = requireModalBackdrop(backdrop);
    const existingState = registeredModalBackdrops.get(target);

    if (existingState) {
        return target;
    }

    const state = {
        active: false,
        observer: null,
    };
    state.observer = new MutationObserver(() => {
        const isActive = target.classList.contains('active');

        if (isActive !== state.active) {
            updateModalBackdropStack(target, false);
        }
    });
    state.observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    registeredModalBackdrops.set(target, state);
    target.dataset.modalStackBound = '1';
    updateModalBackdropStack(target, false);

    return target;
}

function handleModalBackdropStackingChange(backdrop) {
    const target = registerModalBackdrop(backdrop);
    updateModalBackdropStack(target, true);
}

function registerAddedModalBackdrops(node) {
    if (!(node instanceof HTMLElement)) {
        return;
    }

    if (node.classList.contains('modal-backdrop')) {
        registerModalBackdrop(node);
    }

    node.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
        registerModalBackdrop(backdrop);
    });
}

function initializeModalBackdropStacking() {
    if (!(document.body instanceof HTMLBodyElement)) {
        throw new Error('统一弹窗栈初始化时缺少 document.body');
    }

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
        registerModalBackdrop(backdrop);
    });

    if (modalBackdropDocumentObserver) {
        return;
    }

    modalBackdropDocumentObserver = new MutationObserver((records) => {
        records.forEach((record) => {
            record.addedNodes.forEach(registerAddedModalBackdrops);
        });
    });
    modalBackdropDocumentObserver.observe(document.body, { childList: true, subtree: true });
}

function requireElement(element, message) {
    if (!(element instanceof HTMLElement)) {
        throw new Error(message);
    }

    return element;
}

function requireElementById(id, message) {
    return requireElement(document.getElementById(id), message);
}

function removeActiveDialogId(dialogId) {
    const index = activeDialogIds.indexOf(dialogId);

    if (index >= 0) {
        activeDialogIds.splice(index, 1);
    }
}

function bindEscape() {
    if (escapeBound) {
        return;
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !activeDialogIds.length) {
            return;
        }

        const dialogId = activeDialogIds[activeDialogIds.length - 1];
        const controller = controllers.get(dialogId);

        if (!controller) {
            throw new Error(`${dialogId} 缺少设置小窗控制器`);
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        controller.close('escape');
    }, true);

    escapeBound = true;
}

function createDialogController(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('设置小窗控制器参数无效');
    }

    const dialogId = String(config.dialogId).trim();

    if (!dialogId) {
        throw new Error('设置小窗缺少 dialogId');
    }

    if (controllers.has(dialogId)) {
        throw new Error(`${dialogId} 已创建设置小窗控制器`);
    }

    if (config.onClose !== undefined && typeof config.onClose !== 'function') {
        throw new Error(`${dialogId} 的 onClose 必须为函数`);
    }

    const backdrop = requireElementById(dialogId, `未找到设置小窗: ${dialogId}`);
    registerModalBackdrop(backdrop);
    const dialog = requireElement(
        backdrop.querySelector(':scope > .settings-dialog'),
        `${dialogId} 缺少 settings-dialog`,
    );
    requireElement(
        dialog.querySelector(':scope > .settings-dialog-head'),
        `${dialogId} 缺少 settings-dialog-head`,
    );
    requireElement(
        dialog.querySelector(':scope > .settings-dialog-body'),
        `${dialogId} 缺少 settings-dialog-body`,
    );
    requireElement(
        dialog.querySelector(':scope > .settings-dialog-footer'),
        `${dialogId} 缺少 settings-dialog-footer`,
    );
    const dismissButtons = Array.from(
        backdrop.querySelectorAll('[data-settings-dialog-close]'),
    );

    if (!dismissButtons.length) {
        throw new Error(`${dialogId} 缺少关闭控件`);
    }

    let restoreFocusTarget = null;

    function close(reason) {
        if (!backdrop.classList.contains('active')) {
            return;
        }

        backdrop.classList.remove('active');
        backdrop.setAttribute('aria-hidden', 'true');
        removeActiveDialogId(dialogId);
        handleModalBackdropStackingChange(backdrop);

        if (config.onClose) {
            config.onClose(reason);
        }

        if (restoreFocusTarget instanceof HTMLElement && restoreFocusTarget.isConnected) {
            restoreFocusTarget.focus();
        }

        restoreFocusTarget = null;
    }

    function open(options) {
        if (!options || typeof options !== 'object') {
            throw new Error(`${dialogId} 的打开参数无效`);
        }

        if (options.initialFocus !== undefined && !(options.initialFocus instanceof HTMLElement)) {
            throw new Error(`${dialogId} 的 initialFocus 无效`);
        }

        if (!backdrop.classList.contains('active')) {
            restoreFocusTarget = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        }

        removeActiveDialogId(dialogId);
        activeDialogIds.push(dialogId);
        document.body.appendChild(backdrop);
        backdrop.classList.add('active');
        backdrop.setAttribute('aria-hidden', 'false');
        handleModalBackdropStackingChange(backdrop);

        if (options.initialFocus) {
            options.initialFocus.focus();
        }
    }

    backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) {
            close('backdrop');
        }
    });
    dismissButtons.forEach((button) => {
        button.addEventListener('click', () => close('control'));
    });

    const controller = Object.freeze({
        close,
        element: backdrop,
        open,
    });
    controllers.set(dialogId, controller);
    bindEscape();
    return controller;
}

function normalizeExpiryOptions(options) {
    if (!Array.isArray(options) || options.length < 2) {
        throw new Error('有效期滑条至少需要两个档位');
    }

    const ids = new Set();

    return options.map((option, index) => {
        if (!option || typeof option !== 'object') {
            throw new Error(`有效期滑条第 ${index + 1} 个档位无效`);
        }

        const id = String(option.id).trim();
        const label = String(option.label).trim();

        if (!id || !label) {
            throw new Error(`有效期滑条第 ${index + 1} 个档位缺少 id 或 label`);
        }

        if (ids.has(id)) {
            throw new Error(`有效期滑条存在重复档位: ${id}`);
        }

        ids.add(id);
        return { id, label };
    });
}

function localizePublicApiExpiryOptions(rawOptions) {
    const options = normalizeExpiryOptions(rawOptions);

    if (options.length !== Object.keys(PUBLIC_API_EXPIRY_LABELS).length) {
        throw new Error(`Public API 有效期档位数量错误: ${options.length}`);
    }

    return options.map((option) => {
        const label = PUBLIC_API_EXPIRY_LABELS[option.id];

        if (!label) {
            throw new Error(`Public API 存在未知有效期档位: ${option.id}`);
        }

        return { id: option.id, label };
    });
}

function setExpiryIndex(container, input, output, marks, options, index) {
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
        throw new Error(`有效期滑条索引越界: ${index}`);
    }

    const selected = options[index];
    const progress = options.length === 1 ? 0 : (index / (options.length - 1)) * 100;
    input.value = String(index);
    input.setAttribute('aria-valuetext', selected.label);
    input.style.setProperty('--settings-expiry-progress', `${progress}%`);
    output.textContent = selected.label;
    container.dataset.settingsExpiryValue = selected.id;
    marks.forEach((mark, markIndex) => {
        const active = markIndex === index;
        mark.classList.toggle('active', active);
        mark.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function renderExpirySlider(container, rawOptions, selectedId) {
    const target = requireElement(container, '有效期滑条缺少容器');
    const options = normalizeExpiryOptions(rawOptions);
    const normalizedSelectedId = String(selectedId).trim();
    const selectedIndex = options.findIndex((option) => option.id === normalizedSelectedId);

    if (selectedIndex < 0) {
        throw new Error(`有效期滑条不支持档位: ${normalizedSelectedId}`);
    }

    const current = document.createElement('div');
    current.className = 'settings-expiry-slider-current';
    current.append(document.createTextNode('当前'));
    const output = document.createElement('strong');
    current.append(output);

    const input = document.createElement('input');
    input.className = 'settings-expiry-slider-input';
    input.id = `${target.id}Input`;
    input.type = 'range';
    input.min = '0';
    input.max = String(options.length - 1);
    input.step = '1';
    input.setAttribute('aria-label', target.getAttribute('aria-label') || '有效期');

    const marksWrap = document.createElement('div');
    marksWrap.className = 'settings-expiry-slider-marks';
    marksWrap.style.setProperty('--settings-expiry-count', String(options.length));
    const marks = options.map((option, index) => {
        const mark = document.createElement('button');
        mark.className = 'settings-expiry-slider-mark';
        mark.type = 'button';
        mark.textContent = option.label;
        mark.addEventListener('click', () => {
            setExpiryIndex(target, input, output, marks, options, index);
        });
        marksWrap.append(mark);
        return mark;
    });

    input.addEventListener('input', () => {
        setExpiryIndex(target, input, output, marks, options, Number(input.value));
    });
    target.replaceChildren(current, input, marksWrap);
    target.classList.add('settings-expiry-slider');
    target.dataset.settingsExpiryOptions = JSON.stringify(options);
    setExpiryIndex(target, input, output, marks, options, selectedIndex);
}

function getExpiryValue(container) {
    const target = requireElement(container, '有效期滑条缺少容器');
    const value = String(target.dataset.settingsExpiryValue).trim();

    if (!value) {
        throw new Error('有效期滑条尚未设置值');
    }

    return value;
}

function setExpiryDisabled(container, disabled) {
    const target = requireElement(container, '有效期滑条缺少容器');
    const input = requireElement(
        target.querySelector('.settings-expiry-slider-input'),
        '有效期滑条尚未渲染',
    );
    const normalizedDisabled = disabled === true;
    input.disabled = normalizedDisabled;
    target.querySelectorAll('.settings-expiry-slider-mark').forEach((mark) => {
        mark.disabled = normalizedDisabled;
    });
    target.classList.toggle('is-disabled', normalizedDisabled);
}

function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);

    if (className) {
        element.className = className;
    }

    if (textContent) {
        element.textContent = textContent;
    }

    return element;
}

function settleConfirm(dialogId, confirmed) {
    const state = confirmStates.get(dialogId);

    if (!state) {
        return;
    }

    confirmStates.delete(dialogId);
    const controller = controllers.get(dialogId);

    if (!controller) {
        throw new Error(`${dialogId} 缺少设置小窗控制器`);
    }

    controller.close(confirmed ? 'confirm' : 'cancel');
    state.resolve(Boolean(confirmed));
}

function ensureConfirmDialog(dialogId) {
    const existingController = controllers.get(dialogId);

    if (existingController) {
        return existingController;
    }

    const backdrop = createElement('div', 'modal-backdrop settings-dialog-backdrop');
    backdrop.id = dialogId;
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = createElement('div', 'modal settings-dialog settings-dialog-compact');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', `${dialogId}Title`);
    dialog.setAttribute('aria-describedby', `${dialogId}Desc`);

    const head = createElement('div', 'modal-head settings-dialog-head');
    const title = createElement('h3', '', '确认操作');
    title.id = `${dialogId}Title`;
    const closeButton = createElement('button', 'btn-close-circle settings-dialog-close');
    closeButton.type = 'button';
    closeButton.dataset.settingsDialogClose = '';
    closeButton.setAttribute('aria-label', '关闭');
    closeButton.title = '关闭';
    closeButton.textContent = '×';
    head.append(title, closeButton);

    const body = createElement('div', 'modal-body settings-dialog-body');
    const description = createElement('p', 'settings-dialog-description');
    description.id = `${dialogId}Desc`;
    body.appendChild(description);

    const footer = createElement('div', 'modal-footer settings-dialog-footer');
    const cancelButton = createElement('button', 'btn-cancel', '取消');
    cancelButton.id = `${dialogId}CancelBtn`;
    cancelButton.type = 'button';
    cancelButton.dataset.settingsDialogClose = '';
    const confirmButton = createElement('button', 'btn-confirm', '确认');
    confirmButton.id = `${dialogId}ConfirmBtn`;
    confirmButton.type = 'button';
    footer.append(cancelButton, confirmButton);

    dialog.append(head, body, footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const controller = createDialogController({
        dialogId,
        onClose() {
            const pending = confirmStates.get(dialogId);

            if (pending) {
                confirmStates.delete(dialogId);
                pending.resolve(false);
            }
        },
    });
    confirmButton.addEventListener('click', () => settleConfirm(dialogId, true));

    return controller;
}

/**
 * 弹出确认对话框，返回 Promise<boolean>
 */
function confirm(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('设置确认窗参数无效');
    }

    const dialogId = String(config.dialogId || '').trim();
    const title = String(config.title || '').trim();
    const message = String(config.message || '').trim();
    const confirmLabel = String(config.confirmLabel || '').trim();
    const tone = String(config.tone || '').trim();

    if (!dialogId || !title || !message || !confirmLabel) {
        throw new Error('设置确认窗缺少必要信息');
    }

    if (tone !== 'primary' && tone !== 'danger') {
        throw new Error(`设置确认窗不支持类型: ${tone}`);
    }

    if (confirmStates.has(dialogId)) {
        throw new Error(`${dialogId} 已在等待用户确认`);
    }

    const controller = ensureConfirmDialog(dialogId);
    requireElementById(`${dialogId}Title`, `${dialogId} 缺少标题`).textContent = title;
    requireElementById(`${dialogId}Desc`, `${dialogId} 缺少说明`).textContent = message;
    const confirmButton = requireElementById(`${dialogId}ConfirmBtn`, `${dialogId} 缺少确认按钮`);
    confirmButton.className = tone === 'danger' ? 'btn-danger-solid' : 'btn-confirm';
    confirmButton.textContent = confirmLabel;

    return new Promise((resolve) => {
        confirmStates.set(dialogId, { resolve });
        controller.open({
            initialFocus: requireElementById(`${dialogId}CancelBtn`, `${dialogId} 缺少取消按钮`),
        });
    });
}

async function copyText(value) {
    const text = String(value || '').trim();

    if (!text) {
        throw new Error('没有可复制的内容');
    }

    const clipboard = window.navigator?.clipboard;

    if (!clipboard || typeof clipboard.writeText !== 'function') {
        throw new Error('当前浏览器不支持安全剪贴板 API');
    }

    await clipboard.writeText(text);
}

export const NexoraSettingsDialog = Object.freeze({
    confirm,
    copyText,
    createDialogController,
    getModalLayerBase,
    getModalLayerStep,
    getExpiryValue,
    handleModalBackdropStackingChange,
    initializeModalBackdropStacking,
    localizePublicApiExpiryOptions,
    registerModalBackdrop,
    renderExpirySlider,
    setExpiryDisabled,
});

// 兼容期：保留 window 挂载
window.NexoraSettingsDialog = NexoraSettingsDialog;
initializeModalBackdropStacking();
