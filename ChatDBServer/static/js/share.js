(function () {
    'use strict';

    const state = {
        code: '',
        transfer: null,
        loading: false
    };

    const elements = {
        form: document.getElementById('shareCodeForm'),
        codeInput: document.getElementById('shareCodeInput'),
        queryBtn: document.getElementById('shareQueryBtn'),
        status: document.getElementById('shareStatus'),
        filePanel: document.getElementById('shareFilePanel'),
        fileName: document.getElementById('shareFileName'),
        fileSize: document.getElementById('shareFileSize'),
        fileExpires: document.getElementById('shareFileExpires'),
        fileDownloads: document.getElementById('shareFileDownloads'),
        fileType: document.getElementById('shareFileType'),
        downloadBtn: document.getElementById('shareDownloadBtn')
    };

    function compactTransferCode(value) {
        return String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    }

    function formatFileSize(bytes) {
        const size = Number(bytes || 0);

        if (!Number.isFinite(size) || size <= 0) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = size;
        let index = 0;

        while (value >= 1024 && index < units.length - 1) {
            value = value / 1024;
            index += 1;
        }

        const digits = value >= 100 || index === 0 ? 0 : 1;
        return `${value.toFixed(digits)} ${units[index]}`;
    }

    function formatUnixTime(seconds) {
        const timestamp = Number(seconds || 0);

        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return '未设置';
        }

        const date = new Date(timestamp * 1000);
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function getTransferTypeText(transfer) {
        const type = String((transfer && transfer.transfer_type) || '').trim();

        if (type === 'live') {
            return '在线传输';
        }

        return '云文件';
    }

    function setLoading(loading) {
        state.loading = !!loading;

        if (elements.queryBtn) {
            elements.queryBtn.disabled = state.loading;
        }

        if (elements.downloadBtn) {
            elements.downloadBtn.disabled = state.loading || !state.transfer;
        }
    }

    function setStatus(message, isError) {
        if (!elements.status) {
            return;
        }

        elements.status.textContent = String(message || '');
        elements.status.classList.toggle('is-error', !!isError);
    }

    function clearTransferPanel() {
        state.transfer = null;

        if (elements.filePanel) {
            elements.filePanel.hidden = true;
        }

        if (elements.downloadBtn) {
            elements.downloadBtn.disabled = true;
        }
    }

    function renderTransferPanel(transfer) {
        state.transfer = transfer;

        if (elements.fileName) {
            elements.fileName.textContent = String(transfer.file_name || '未命名文件');
        }

        if (elements.fileSize) {
            elements.fileSize.textContent = formatFileSize(transfer.size);
        }

        if (elements.fileExpires) {
            elements.fileExpires.textContent = formatUnixTime(transfer.expires_at);
        }

        if (elements.fileDownloads) {
            elements.fileDownloads.textContent = `${Number(transfer.remaining_downloads || 0)} / ${Number(transfer.max_downloads || 0)}`;
        }

        if (elements.fileType) {
            elements.fileType.textContent = getTransferTypeText(transfer);
        }

        if (elements.filePanel) {
            elements.filePanel.hidden = false;
        }

        if (elements.downloadBtn) {
            elements.downloadBtn.disabled = false;
        }
    }

    async function readResponseJson(response, defaultMessage) {
        let data = null;

        try {
            data = await response.json();
        } catch (error) {
            throw new Error(`${defaultMessage}（HTTP ${response.status}）`);
        }

        if (!response.ok || !data || !data.success) {
            throw new Error(String((data && data.message) || `${defaultMessage}（HTTP ${response.status}）`));
        }

        return data;
    }

    async function queryTransferByCode(code) {
        const safeCode = compactTransferCode(code);

        if (!safeCode) {
            throw new Error('请输入读取码');
        }

        const response = await fetch(`/api/files/transfer/${encodeURIComponent(safeCode)}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await readResponseJson(response, '读取文件信息失败');

        if (!data.transfer || typeof data.transfer !== 'object') {
            throw new Error('后端未返回文件信息');
        }

        return {
            code: safeCode,
            transfer: data.transfer
        };
    }

    async function handleQuerySubmit(event) {
        event.preventDefault();

        if (state.loading) {
            return;
        }

        clearTransferPanel();
        setLoading(true);
        setStatus('正在读取文件信息...', false);

        try {
            const result = await queryTransferByCode(elements.codeInput ? elements.codeInput.value : '');
            state.code = result.code;
            renderTransferPanel(result.transfer);
            setStatus('文件信息已读取，确认后可以开始下载。', false);
        } catch (error) {
            setStatus(String((error && error.message) || '读取文件信息失败'), true);
        } finally {
            setLoading(false);
        }
    }

    function handleDownloadClick() {
        const safeCode = compactTransferCode(state.code || (elements.codeInput ? elements.codeInput.value : ''));

        if (!safeCode) {
            setStatus('请输入读取码', true);
            return;
        }

        window.location.assign(`/api/files/transfer/${encodeURIComponent(safeCode)}/download`);
    }

    function initCodeFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (!code || !elements.codeInput) {
            return;
        }

        elements.codeInput.value = code;
        elements.form.requestSubmit();
    }

    function init() {
        if (!elements.form || !elements.codeInput || !elements.downloadBtn) {
            return;
        }

        elements.form.addEventListener('submit', (event) => {
            void handleQuerySubmit(event);
        });

        elements.downloadBtn.addEventListener('click', handleDownloadClick);
        clearTransferPanel();
        initCodeFromUrl();
    }

    init();
}());
