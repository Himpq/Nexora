/**
 * 模型选择组件 - 渲染模型芯片列表
 *
 * 按供应商分组渲染可选模型，支持自定义排序、标签、状态显示。
 *
 * 用法:
 *   import { renderModelSelect } from './chat_model_select.js';
 *   renderModelSelect({ root, models, selectedModelId, onSelect });
 */

const MODULE_NAME = 'modelSelect';

const STATUS_LABELS = {
    good: '良好',
    normal: '正常',
    fast: '快速',
    slow: '缓慢',
    error: '错误'
};

function createModelChip(model, providerKey, options) {
    const modelId = String((model && model.id) || '').trim();
    const rawName = String(options.getModelTitle(model) || modelId).trim() || modelId;
    const displayName = String(options.getModelLabel(model) || rawName).trim() || rawName;
    const statusKey = String(options.getModelStatus(model) || '').trim().toLowerCase();
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'model-chip';
    chip.dataset.modelId = modelId;
    chip.setAttribute('role', 'option');
    chip.setAttribute('aria-selected', modelId === options.selectedModelId ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'model-chip-name';
    name.textContent = displayName;
    name.title = rawName;
    chip.appendChild(name);

    if (statusKey) {
        const status = document.createElement('span');
        status.className = `model-chip-status model-status-${statusKey}`;
        status.textContent = STATUS_LABELS[statusKey] || statusKey.toUpperCase();
        chip.appendChild(status);
    }

    if (modelId === options.selectedModelId) {
        chip.classList.add('same-as-selected');
    }

    options.decorateChip(chip, model, providerKey);
    chip.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onSelect(modelId, model);
    });
    return chip;
}

function appendModelGroup(parent, providerKey, models, options, extraClass = '') {
    const section = document.createElement('section');
    section.className = `model-group ${extraClass}`.trim();

    const title = document.createElement('div');
    title.className = 'model-group-title';

    const titleMain = document.createElement('span');
    titleMain.className = 'provider-title-main';
    options.renderProviderTitle(titleMain, providerKey);
    title.appendChild(titleMain);
    section.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'model-chip-wrap';
    models.forEach((model) => {
        chips.appendChild(createModelChip(model, providerKey, options));
    });
    section.appendChild(chips);
    parent.appendChild(section);
}

/**
 * 渲染模型选择面板
 *
 * @param {Object} config - 渲染配置
 * @param {HTMLElement} config.root - 挂载容器
 * @param {Array} config.models - 模型列表
 * @param {string} config.selectedModelId - 当前选中模型 ID
 * @param {Function} config.onSelect - 选中回调 (modelId, model) => void
 * @returns {HTMLElement} 滚动容器元素
 */
export function renderModelSelect(config = {}) {
    const root = config.root;

    if (!root) {
        throw new Error('model select root is required');
    }

    const options = {
        selectedModelId: String(config.selectedModelId || '').trim(),
        normalizeProvider: typeof config.normalizeProvider === 'function'
            ? config.normalizeProvider
            : (value) => String(value || 'other').trim().toLowerCase() || 'other',
        compareProviders: typeof config.compareProviders === 'function'
            ? config.compareProviders
            : (left, right) => String(left).localeCompare(String(right)),
        getModelLabel: typeof config.getModelLabel === 'function'
            ? config.getModelLabel
            : (model) => String((model && (model.name || model.id)) || ''),
        getModelTitle: typeof config.getModelTitle === 'function'
            ? config.getModelTitle
            : (model) => String((model && (model.name || model.id)) || ''),
        getModelStatus: typeof config.getModelStatus === 'function'
            ? config.getModelStatus
            : (model) => String((model && model.status) || 'normal'),
        renderProviderTitle: typeof config.renderProviderTitle === 'function'
            ? config.renderProviderTitle
            : (target, providerKey) => {
                const label = document.createElement('span');
                label.className = 'label';
                label.textContent = String(providerKey || 'other');
                target.appendChild(label);
            },
        decorateChip: typeof config.decorateChip === 'function'
            ? config.decorateChip
            : () => {},
        onSelect: typeof config.onSelect === 'function'
            ? config.onSelect
            : () => {}
    };

    root.innerHTML = '';
    const scroll = document.createElement('div');
    scroll.className = 'model-options-scroll';
    root.appendChild(scroll);

    const leadingModels = Array.isArray(config.leadingModels) ? config.leadingModels : [];

    if (leadingModels.length > 0) {
        appendModelGroup(
            scroll,
            String(config.leadingGroupLabel || '自动'),
            leadingModels,
            options,
            String(config.leadingGroupClass || '')
        );
    }

    const groups = new Map();
    const models = Array.isArray(config.models) ? config.models : [];

    models.forEach((model) => {
        const providerKey = options.normalizeProvider(model && model.provider);

        if (!groups.has(providerKey)) {
            groups.set(providerKey, []);
        }

        groups.get(providerKey).push(model);
    });

    Array.from(groups.keys()).sort(options.compareProviders).forEach((providerKey) => {
        appendModelGroup(scroll, providerKey, groups.get(providerKey), options);
    });

    return scroll;
}

// 兼容期：注册到 NexoraChatShared，供尚未 ESM 化的模块通过 getModule('modelSelect') 调用
window.NexoraChatShared.registerModule(MODULE_NAME, {
    render: renderModelSelect
});
