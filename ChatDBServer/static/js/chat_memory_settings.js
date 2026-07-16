(function () {
    'use strict';

    const MODULE_NAME = 'memorySettings';
    const CURRENT_CONVERSATION_MODEL = '';

    let availableModels = [];
    let selectedModelId = CURRENT_CONVERSATION_MODEL;
    let modelSaveBusy = false;
    let modelOptionsPortalParent = null;

    function readElements() {
        return {
            textarea: document.getElementById('settingsMemoryProfile'),
            status: document.getElementById('settingsMemoryProfileStatus'),
            refreshButton: document.getElementById('refreshMemoryProfileBtn'),
            modelContainer: document.getElementById('memoryModelSelectContainer'),
            modelSelected: document.getElementById('memoryModelSelected'),
            modelOptions: document.getElementById('memoryModelOptions'),
            modelStatus: document.getElementById('settingsMemoryModelStatus')
        };
    }

    function setStatus(element, message, error = false) {
        if (!element) {
            return;
        }

        element.textContent = String(message || '');
        element.classList.toggle('is-error', !!error);
    }

    function setRefreshBusy(button, busy) {
        if (!button) {
            return;
        }

        button.disabled = !!busy;
        button.classList.toggle('is-loading', !!busy);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    async function loadProfile() {
        const elements = readElements();

        if (!elements.textarea) {
            return;
        }

        elements.textarea.value = '';
        elements.textarea.placeholder = '正在读取用户记忆...';
        setStatus(elements.status, '正在读取');
        setRefreshBusy(elements.refreshButton, true);

        try {
            const response = await fetch('/api/memory/profile');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(String(data.error || data.message || `HTTP ${response.status}`));
            }

            const profile = String(data.profile || '');
            elements.textarea.value = profile;
            elements.textarea.placeholder = '';
            setStatus(elements.status, `当前记忆 ${profile.length} 字符`);
        } catch (error) {
            elements.textarea.value = '';
            elements.textarea.placeholder = '用户记忆读取失败';
            setStatus(elements.status, String((error && error.message) || '用户记忆读取失败'), true);
        } finally {
            setRefreshBusy(elements.refreshButton, false);
        }
    }

    function normalizeModel(model) {
        const source = model && typeof model === 'object' ? model : {};
        const id = String(source.id || '').trim();

        return {
            id,
            name: String(source.name || id).trim() || id,
            provider: String(source.provider || 'other').trim() || 'other',
            status: String(source.status || 'normal').trim().toLowerCase() || 'normal'
        };
    }

    function getSelectedModel() {
        return availableModels.find((model) => model.id === selectedModelId) || null;
    }

    function updateSelectedModelDisplay(elements) {
        if (!elements.modelSelected) {
            return;
        }

        if (!selectedModelId) {
            elements.modelSelected.textContent = '使用当前对话模型';
            return;
        }

        const selectedModel = getSelectedModel();
        elements.modelSelected.textContent = selectedModel
            ? selectedModel.name
            : `不可用模型: ${selectedModelId}`;
    }

    function closeModelOptions(elements = readElements()) {
        if (!elements.modelOptions || !elements.modelSelected) {
            return;
        }

        elements.modelOptions.classList.add('select-hide');
        elements.modelSelected.classList.remove('select-arrow-active');
        elements.modelSelected.setAttribute('aria-expanded', 'false');

        if (modelOptionsPortalParent && elements.modelOptions.parentElement === document.body) {
            modelOptionsPortalParent.appendChild(elements.modelOptions);
        }

        modelOptionsPortalParent = null;
        elements.modelOptions.style.removeProperty('left');
        elements.modelOptions.style.removeProperty('right');
        elements.modelOptions.style.removeProperty('top');
        elements.modelOptions.style.removeProperty('bottom');
        elements.modelOptions.style.removeProperty('max-height');
    }

    function openModelOptions(elements = readElements()) {
        if (!elements.modelOptions || !elements.modelSelected) {
            return;
        }

        modelOptionsPortalParent = elements.modelOptions.parentElement;
        document.body.appendChild(elements.modelOptions);
        elements.modelOptions.classList.remove('select-hide');
        elements.modelSelected.classList.add('select-arrow-active');
        elements.modelSelected.setAttribute('aria-expanded', 'true');

        const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 0);
        const viewportHeight = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 0);
        const anchorRect = elements.modelSelected.getBoundingClientRect();
        const menuWidth = Math.min(340, viewportWidth - 24);
        const left = Math.max(12, Math.min(anchorRect.left, viewportWidth - menuWidth - 12));
        const measuredHeight = Math.min(300, elements.modelOptions.scrollHeight || 300);
        const spaceBelow = viewportHeight - anchorRect.bottom - 12;
        const openBelow = spaceBelow >= Math.min(measuredHeight, 180);
        const availableHeight = openBelow
            ? Math.max(140, spaceBelow)
            : Math.max(140, anchorRect.top - 12);
        const maxHeight = Math.min(300, availableHeight);
        const top = openBelow
            ? anchorRect.bottom + 6
            : Math.max(12, anchorRect.top - Math.min(measuredHeight, maxHeight) - 6);

        elements.modelOptions.style.setProperty('left', `${left}px`, 'important');
        elements.modelOptions.style.setProperty('right', 'auto', 'important');
        elements.modelOptions.style.setProperty('top', `${top}px`, 'important');
        elements.modelOptions.style.setProperty('bottom', 'auto', 'important');
        elements.modelOptions.style.setProperty('max-height', `${maxHeight}px`, 'important');
    }

    function renderModelOptions() {
        const elements = readElements();

        if (!elements.modelOptions) {
            return;
        }

        window.NexoraChatShared.getModule('modelSelect').render({
            root: elements.modelOptions,
            models: availableModels,
            selectedModelId,
            leadingGroupLabel: '自动',
            leadingGroupClass: 'settings-memory-model-auto-group',
            leadingModels: [{
                id: CURRENT_CONVERSATION_MODEL,
                name: '使用当前对话模型',
                provider: '自动',
                status: ''
            }],
            getModelLabel: (model) => String((model && model.name) || ''),
            getModelTitle: (model) => String((model && model.name) || ''),
            getModelStatus: (model) => String((model && model.status) || ''),
            onSelect: (modelId) => {
                void saveModelPreference(modelId);
            }
        });

        updateSelectedModelDisplay(elements);
    }

    async function saveModelPreference(modelId) {
        if (modelSaveBusy) {
            return;
        }

        const elements = readElements();
        const nextModelId = String(modelId || '').trim();
        const previousModelId = selectedModelId;

        if (nextModelId === previousModelId) {
            closeModelOptions(elements);
            return;
        }

        modelSaveBusy = true;
        selectedModelId = nextModelId;
        updateSelectedModelDisplay(elements);
        closeModelOptions(elements);

        if (elements.modelSelected) {
            elements.modelSelected.disabled = true;
        }

        setStatus(elements.modelStatus, '正在保存记忆更新模型');

        try {
            const response = await fetch('/api/user/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memory_update_model: nextModelId })
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(String(data.message || `HTTP ${response.status}`));
            }

            selectedModelId = String((data.preferences || {}).memory_update_model || '').trim();
            renderModelOptions();
            setStatus(
                elements.modelStatus,
                selectedModelId ? '已保存指定记忆更新模型' : '记忆更新将使用当前对话模型'
            );
        } catch (error) {
            selectedModelId = previousModelId;
            renderModelOptions();
            setStatus(
                elements.modelStatus,
                `保存失败: ${String((error && error.message) || 'unknown')}`,
                true
            );
        } finally {
            modelSaveBusy = false;

            if (elements.modelSelected) {
                elements.modelSelected.disabled = false;
            }
        }
    }

    async function loadModelSelector(preferences = {}) {
        const elements = readElements();

        if (!elements.modelSelected || !elements.modelOptions) {
            return;
        }

        selectedModelId = String((preferences || {}).memory_update_model || '').trim();
        elements.modelSelected.disabled = true;
        updateSelectedModelDisplay(elements);
        setStatus(elements.modelStatus, '正在读取可用模型');

        try {
            const response = await fetch('/api/config?context_refresh=cache');
            const data = await response.json();

            if (!response.ok || !data.success || !Array.isArray(data.models)) {
                throw new Error(String(data.message || `HTTP ${response.status}`));
            }

            availableModels = data.models
                .map(normalizeModel)
                .filter((model) => !!model.id);
            renderModelOptions();

            if (selectedModelId && !getSelectedModel()) {
                setStatus(elements.modelStatus, '已保存的记忆更新模型当前不可用，请重新选择', true);
            } else {
                setStatus(
                    elements.modelStatus,
                    selectedModelId ? '使用指定模型更新记忆' : '记忆更新将使用当前对话模型'
                );
            }
        } catch (error) {
            availableModels = [];
            renderModelOptions();
            setStatus(
                elements.modelStatus,
                `模型列表读取失败: ${String((error && error.message) || 'unknown')}`,
                true
            );
        } finally {
            elements.modelSelected.disabled = false;
        }
    }

    function bind() {
        const elements = readElements();

        if (elements.refreshButton && elements.refreshButton.dataset.bound !== '1') {
            elements.refreshButton.dataset.bound = '1';
            elements.refreshButton.addEventListener('click', () => {
                void loadProfile();
            });
        }

        if (elements.modelSelected && elements.modelSelected.dataset.bound !== '1') {
            elements.modelSelected.dataset.bound = '1';
            elements.modelSelected.addEventListener('click', (event) => {
                event.stopPropagation();

                if (!elements.modelOptions || modelSaveBusy) {
                    return;
                }

                const closed = elements.modelOptions.classList.contains('select-hide');

                if (closed) {
                    openModelOptions(elements);
                } else {
                    closeModelOptions(elements);
                }
            });
        }

        if (document.documentElement.dataset.memoryModelCloseBound !== '1') {
            document.documentElement.dataset.memoryModelCloseBound = '1';
            document.addEventListener('click', (event) => {
                const currentElements = readElements();

                if (
                    currentElements.modelContainer
                    && !currentElements.modelContainer.contains(event.target)
                    && currentElements.modelOptions
                    && !currentElements.modelOptions.contains(event.target)
                ) {
                    closeModelOptions(currentElements);
                }
            });
        }

        if (document.documentElement.dataset.memoryModelViewportBound !== '1') {
            document.documentElement.dataset.memoryModelViewportBound = '1';
            window.addEventListener('resize', () => {
                closeModelOptions(readElements());
            });
            document.addEventListener('scroll', (event) => {
                const currentElements = readElements();

                if (
                    currentElements.modelOptions
                    && !currentElements.modelOptions.classList.contains('select-hide')
                    && !currentElements.modelOptions.contains(event.target)
                ) {
                    closeModelOptions(currentElements);
                }
            }, true);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeModelOptions(readElements());
                }
            });
        }
    }

    const shared = window.NexoraChatShared;

    if (!shared || typeof shared.registerModule !== 'function') {
        throw new Error('NexoraChatShared 未初始化，无法注册用户记忆设置模块');
    }

    shared.registerModule(MODULE_NAME, {
        bind,
        loadProfile,
        loadModelSelector
    });
})();
