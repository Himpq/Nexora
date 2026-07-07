(function () {
    'use strict';

    const shared = window.NexoraChatShared;

    if (!shared || typeof shared.registerModule !== 'function') {
        throw new Error('NexoraChatShared is required before chat_files.js');
    }

    function requireFileCenterScrollContainer() {
        const view = document.querySelector('.file-center-view');

        if (view instanceof HTMLElement) {
            return view;
        }

        throw new Error('Files scroll container .file-center-view is missing');
    }

    function captureFileCenterScrollPosition(state) {
        if (!state || typeof state !== 'object') {
            throw new Error('fileCenterState is required');
        }

        const scrollContainer = requireFileCenterScrollContainer();

        state.listScrollTop = Math.max(0, Number(scrollContainer.scrollTop || 0));
    }

    function resetFileCenterScrollPosition(state) {
        if (!state || typeof state !== 'object') {
            throw new Error('fileCenterState is required');
        }

        const scrollContainer = requireFileCenterScrollContainer();

        state.listScrollTop = 0;
        scrollContainer.scrollTop = 0;
    }

    // Files 详情页重绘会替换内部 DOM，返回列表后需要恢复真实滚动容器的位置。
    function restoreFileCenterScrollPosition(state) {
        if (!state || typeof state !== 'object') {
            throw new Error('fileCenterState is required');
        }

        const top = Math.max(0, Number(state.listScrollTop || 0));
        const apply = () => {
            const scrollContainer = requireFileCenterScrollContainer();

            scrollContainer.scrollTop = top;
        };

        apply();
        requestAnimationFrame(apply);
    }

    function renderUploadDialogCloseButton() {
        return `
            <button class="btn-close-circle file-center-upload-dialog-close" id="fileCenterUploadDialogClose" type="button" title="关闭" aria-label="关闭">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
        `;
    }

    shared.registerModule('files', {
        captureFileCenterScrollPosition,
        resetFileCenterScrollPosition,
        restoreFileCenterScrollPosition,
        renderUploadDialogCloseButton,
    });
})();
