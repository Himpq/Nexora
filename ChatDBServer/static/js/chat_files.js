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
                <svg class="file-center-upload-dialog-close-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M4 4L12 12M12 4L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                </svg>
            </button>
        `;
    }

    const FILE_CENTER_LIVE_TRANSFER_CHUNK_SIZE = 1024 * 1024;

    function requireFileDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_files 缺少依赖: ${name}`);
        }

        return value;
    }

    function formatFileSize(bytes) {
        const n = Number(bytes || 0);
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let val = n;
        let idx = 0;
        while (val >= 1024 && idx < units.length - 1) {
            val /= 1024;
            idx += 1;
        }
        return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
    }
    
    function formatByteRate(bytesPerSecond) {
        const n = Number(bytesPerSecond || 0);
    
        if (!Number.isFinite(n) || n <= 0) {
            return '0 B/s';
        }
    
        return `${formatFileSize(n)}/s`;
    }
    
    function createFileCenterUploadDialogState(overrides = {}) {
        return {
            files: [],
            activeCode: '',
            downloadUrl: '',
            heartbeatTimer: 0,
            eventTimer: 0,
            lastEventId: 0,
            busy: false,
            activeFile: null,
            currentDownloadId: '',
            transferUploadActive: false,
            transferUploadDone: false,
            transferBytesSent: 0,
            transferStartedAt: 0,
            transferLastBytes: 0,
            transferLastAt: 0,
            transferSpeedBps: 0,
            transferAbortController: null,
            ...overrides
        };
    }

    function createFileUploadController(deps = {}) {
        const getElements = requireFileDependency(deps, 'getElements');
        const showToast = requireFileDependency(deps, 'showToast');
        const normalizeUploadFile = requireFileDependency(deps, 'normalizeUploadFile');
        const isImageLikeFile = requireFileDependency(deps, 'isImageLikeFile');
        const readImageAsDataUrl = requireFileDependency(deps, 'readImageAsDataUrl');
        const updateFilePreview = requireFileDependency(deps, 'updateFilePreview');
        const updateSendButtonState = requireFileDependency(deps, 'updateSendButtonState');
        const loadCloudFiles = requireFileDependency(deps, 'loadCloudFiles');
        const getUploadedFileIds = requireFileDependency(deps, 'getUploadedFileIds');
        const setIsUploadingFiles = requireFileDependency(deps, 'setIsUploadingFiles');
        let isUploadingFiles = false;
        let currentUploadXhr = null;
        let currentUploadTaskId = null;
        let uploadCancelledByUser = false;

        function getUploadElements() {
            const value = getElements();
            return value && typeof value === 'object' ? value : {};
        }

        function setUploadingState(value) {
            isUploadingFiles = !!value;
            setIsUploadingFiles(isUploadingFiles);
        }

        function setFileUploadProgress(options = {}) {
            if (!getUploadElements().fileUploadProgressWrap || !getUploadElements().fileUploadProgressFill || !getUploadElements().fileUploadProgressText) return;
            const visible = !!options.visible;
            const stage = String(options.stage || 'upload');
            const percentRaw = Number(options.percent || 0);
            const percent = Math.max(0, Math.min(100, Number.isFinite(percentRaw) ? percentRaw : 0));
            const text = String(options.text || '');
        
            if (!visible) {
                getUploadElements().fileUploadProgressWrap.style.display = 'none';
                getUploadElements().fileUploadProgressFill.classList.remove('stage-vectorizing', 'stage-ready', 'stage-error');
                getUploadElements().fileUploadProgressFill.style.width = '0%';
                getUploadElements().fileUploadProgressText.textContent = '';
                if (getUploadElements().cancelFileUploadBtn) {
                    getUploadElements().cancelFileUploadBtn.disabled = true;
                }
                return;
            }
        
            getUploadElements().fileUploadProgressWrap.style.display = 'block';
            getUploadElements().fileUploadProgressText.textContent = text;
            getUploadElements().fileUploadProgressFill.classList.remove('stage-vectorizing', 'stage-ready', 'stage-error');
        
            if (stage === 'upload') {
                getUploadElements().fileUploadProgressFill.style.width = `${percent}%`;
            } else if (stage === 'vectorizing') {
                const p = Math.max(1, Math.min(100, percent || 1));
                getUploadElements().fileUploadProgressFill.style.width = `${p}%`;
                getUploadElements().fileUploadProgressFill.classList.add('stage-vectorizing');
            } else if (stage === 'ready') {
                getUploadElements().fileUploadProgressFill.style.width = '100%';
                getUploadElements().fileUploadProgressFill.classList.add('stage-ready');
            } else if (stage === 'error') {
                getUploadElements().fileUploadProgressFill.style.width = '100%';
                getUploadElements().fileUploadProgressFill.classList.add('stage-error');
            }
        
            if (getUploadElements().cancelFileUploadBtn) {
                const cancellable = stage === 'upload' || stage === 'vectorizing';
                getUploadElements().cancelFileUploadBtn.disabled = !cancellable;
            }
        }

        // 汇总整批上传结果，避免上层弹窗把单文件失败误判为整批成功。
        function createUploadBatchResult(total) {
            return {
                total: Math.max(0, Number(total || 0)),
                successCount: 0,
                failureCount: 0,
                cancelled: false,
                errors: []
            };
        }

        function recordUploadBatchFailure(result, file, message) {
            if (!result || typeof result !== 'object') return;

            const safeMessage = String(message || '上传失败');
            result.failureCount += 1;
            result.errors.push({
                name: String((file && file.name) || ''),
                message: safeMessage
            });
        }
        
        function cancelCurrentFileUpload() {
            uploadCancelledByUser = true;
            if (currentUploadXhr) {
                try {
                    currentUploadXhr.abort();
                } catch (e) {
                    // ignore
                }
            }
            if (currentUploadTaskId) {
                fetch(`/api/upload/task/${encodeURIComponent(currentUploadTaskId)}/cancel`, {
                    method: 'POST'
                }).catch(() => {});
            }
        }
        
        async function pollUploadTask(taskId, file, index, total) {
            const safeTaskId = String(taskId || '').trim();
            if (!safeTaskId) throw new Error('缺少上传任务ID');
        
            const maxRounds = 900; // up to ~7.5min at 500ms
            for (let round = 0; round < maxRounds; round++) {
                if (uploadCancelledByUser) {
                    throw { code: 'upload_cancelled', message: '用户取消上传' };
                }
                const res = await fetch(`/api/upload/task/${encodeURIComponent(safeTaskId)}`, {
                    method: 'GET',
                    cache: 'no-store'
                });
                const data = await res.json();
                if (!data || !data.success || !data.task) {
                    throw new Error((data && data.message) ? data.message : '任务查询失败');
                }
                const task = data.task;
                const status = String(task.status || '').toLowerCase();
                const stage = String(task.stage || '').toLowerCase();
                const progressRaw = Number(task.progress || 0);
                const progress = Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, progressRaw)) : 0;
        
                if (status === 'completed') {
                    return task.result || {};
                }
                if (status === 'failed') {
                    throw new Error(task.error || task.message || '上传失败');
                }
                if (status === 'cancelled') {
                    throw { code: 'upload_cancelled', message: task.message || '任务已取消' };
                }
        
                // 后端总进度是全流程(解析+向量化)，前端这里强制映射为“蓝色向量化 0-100”
                let vectorPct = 0;
                if (stage === 'vectorizing' || status === 'running') {
                    if (progress <= 35) vectorPct = 1;
                    else if (progress >= 95) vectorPct = 100;
                    else vectorPct = Math.round(((progress - 35) / 60) * 100);
                } else if (status === 'completed') {
                    vectorPct = 100;
                } else {
                    vectorPct = Math.max(1, Math.min(100, progress));
                }
                vectorPct = Math.max(1, Math.min(100, vectorPct));
                setFileUploadProgress({
                    visible: true,
                    stage: 'vectorizing',
                    percent: vectorPct,
                    text: `向量化 ${index + 1}/${total}: ${file.name} (${vectorPct}%)`
                });
        
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            throw new Error('上传任务超时');
        }
        
        function uploadSingleFileWithProgress(file, index, total, options = {}) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const formData = new FormData();
                const uploadOptions = (options && typeof options === 'object') ? options : {};
                let uploadStartedAt = 0;
                formData.append('file', file);
        
                if (uploadOptions.targetPath) {
                    formData.append('target_path', String(uploadOptions.targetPath || '').trim());
                }
        
                currentUploadXhr = xhr;
        
                xhr.open('POST', '/api/upload', true);
        
                xhr.upload.onloadstart = () => {
                    uploadStartedAt = performance.now();
                    setFileUploadProgress({
                        visible: true,
                        stage: 'upload',
                        percent: 0,
                        text: `上传 ${index + 1}/${total}: ${file.name}`
                    });
                };
        
                xhr.upload.onprogress = (evt) => {
                    if (!evt || !evt.lengthComputable) return;
                    const progress = (evt.loaded / evt.total) * 100;
                    const now = performance.now();
                    const startedAt = uploadStartedAt || now;
                    const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
                    const speedText = formatByteRate(evt.loaded / elapsedSeconds);
        
                    uploadStartedAt = startedAt;
                    setFileUploadProgress({
                        visible: true,
                        stage: 'upload',
                        percent: progress,
                        text: `上传 ${index + 1}/${total}: ${file.name} (${Math.round(progress)}% · ${speedText})`
                    });
                };
        
                xhr.upload.onload = () => {
                    // 上传体完成后，请求仍在服务端向量化，切换蓝色阶段
                    setFileUploadProgress({
                        visible: true,
                        stage: 'vectorizing',
                        percent: 1,
                        text: `向量化 ${index + 1}/${total}: ${file.name} (1%)`
                    });
                };
        
                xhr.onerror = () => {
                    currentUploadXhr = null;
                    reject(new Error('网络错误'));
                };
        
                xhr.onabort = () => {
                    currentUploadXhr = null;
                    reject({ code: 'upload_aborted' });
                };
        
                xhr.onload = async () => {
                    currentUploadXhr = null;
                    let data = null;
                    try {
                        data = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText || '{}');
                    } catch (e) {
                        data = null;
                    }
        
                    if (!(xhr.status >= 200 && xhr.status < 300)) {
                        const errMsg = (data && data.message) ? data.message : `HTTP ${xhr.status}`;
                        reject(new Error(errMsg));
                        return;
                    }
                    if (!data || !data.success) {
                        const msg = data && data.message ? data.message : '上传失败';
                        reject(new Error(msg));
                        return;
                    }
        
                    const taskId = String(data.task_id || '').trim();
                    if (!taskId) {
                        resolve(data);
                        return;
                    }
        
                    currentUploadTaskId = taskId;
                    try {
                        const finalData = await pollUploadTask(taskId, file, index, total);
                        resolve(finalData);
                    } catch (err) {
                        reject(err);
                    } finally {
                        if (currentUploadTaskId === taskId) {
                            currentUploadTaskId = null;
                        }
                    }
                };
        
                xhr.send(formData);
            });
        }
        
        function showUploadVectorMessage(data) {
            if (data && data.vectorized === false && data.vector_message) {
                showToast(`文件已上传，临时向量化失败: ${data.vector_message}`);
            }
        }
        
        function appendUploadedFileEntry(data, fallbackFileName) {
            if (!data || !data.success) return;
            const parsedSize = Number(
                data.size != null ? data.size
                    : (data.file_size != null ? data.file_size : 0)
            );
            const normalizedSize = Number.isFinite(parsedSize) ? Math.max(0, Math.floor(parsedSize)) : 0;
            if (data.type === 'text') {
                const textContent = String(data.content || '');
                const textSize = normalizedSize > 0 ? normalizedSize : Number(new Blob([textContent]).size || 0);
                getUploadedFileIds().push({
                    type: 'text',
                    content: textContent,
                    name: data.filename || fallbackFileName,
                    size: textSize
                });
            } else if (data.type === 'sandbox_file') {
                getUploadedFileIds().push({
                    type: 'sandbox_file',
                    name: data.update_file_name || data.filename || fallbackFileName,
                    original_name: data.filename || fallbackFileName,
                    sandbox_path: data.sandbox_path,
                    stored_path: data.stored_path,
                    size: normalizedSize
                });
                showUploadVectorMessage(data);
            } else {
                getUploadedFileIds().push({
                    type: 'file',
                    id: data.file_id,
                    name: data.filename || fallbackFileName,
                    size: normalizedSize
                });
            }
        }
        
        async function appendUploadedImageEntry(file, index, total) {
            const maxImageBytes = 8 * 1024 * 1024; // 8MB per image
            if (file.size > maxImageBytes) {
                throw new Error(`图片过大: ${file.name}，请控制在 8MB 以内`);
            }
            setFileUploadProgress({
                visible: true,
                stage: 'upload',
                percent: 0,
                text: `读取图片 ${index + 1}/${total}: ${file.name}`
            });
            const dataUrl = await readImageAsDataUrl(file, (p) => {
                setFileUploadProgress({
                    visible: true,
                    stage: 'upload',
                    percent: p,
                    text: `读取图片 ${index + 1}/${total}: ${file.name} (${p}%)`
                });
            });
            getUploadedFileIds().push({
                type: 'image',
                name: file.name,
                mime: file.type || '',
                size: file.size || 0,
                url: dataUrl
            });
            updateFilePreview();
            setFileUploadProgress({
                visible: true,
                stage: 'ready',
                text: `图片就绪 ${index + 1}/${total}: ${file.name}`
            });
        }
        
        async function handleFileUploadFiles(fileList, options = {}) {
            const files = Array.from(fileList || [])
                .map((f, idx) => normalizeUploadFile(f, idx))
                .filter(Boolean);
            const uploadResult = createUploadBatchResult(files.length);
            const clearInput = options && options.clearInput;
            const attachToInput = !(options && options.attachToInput === false);
            const uploadImagesAsFiles = !!(options && options.uploadImagesAsFiles === true);
            if (!files.length) return uploadResult;
        
            if (isUploadingFiles) {
                const message = '已有文件上传任务，请先等待完成或中断';
                showToast(message);
                recordUploadBatchFailure(uploadResult, { name: '当前上传任务' }, message);
                if (typeof clearInput === 'function') clearInput();
                else if (clearInput !== false && getUploadElements().fileInput) getUploadElements().fileInput.value = '';
                return uploadResult;
            }
        
            setUploadingState(true);
            uploadCancelledByUser = false;
            updateSendButtonState();
        
            try {
                for (let i = 0; i < files.length; i++) {
                    if (uploadCancelledByUser) break;
                    const file = files[i];
                    try {
                        if (isImageLikeFile(file) && !uploadImagesAsFiles) {
                            await appendUploadedImageEntry(file, i, files.length);
                            uploadResult.successCount += 1;
                            await new Promise((resolve) => setTimeout(resolve, 160));
                        } else {
                            const data = await uploadSingleFileWithProgress(file, i, files.length, {
                                targetPath: options && options.targetPath,
                            });
                            if (attachToInput) {
                                appendUploadedFileEntry(data, file.name);
                                updateFilePreview();
                            } else {
                                showUploadVectorMessage(data);
                            }
                            setFileUploadProgress({
                                visible: true,
                                stage: 'ready',
                                text: `完成 ${i + 1}/${files.length}: ${file.name}`
                            });
                            uploadResult.successCount += 1;
                            await new Promise((resolve) => setTimeout(resolve, 220));
                        }
                    } catch (err) {
                        if (err && (err.code === 'upload_aborted' || err.code === 'upload_cancelled')) {
                            uploadResult.cancelled = true;
                            showToast('文件上传已中断');
                            break;
                        }
                        const message = err && err.message ? err.message : '上传失败';
                        recordUploadBatchFailure(uploadResult, file, message);
                        showToast(`上传失败: ${message}`);
                        setFileUploadProgress({
                            visible: true,
                            stage: 'error',
                            text: `失败 ${i + 1}/${files.length}: ${file.name}`
                        });
                        await new Promise((resolve) => setTimeout(resolve, 450));
                    }
                }
            } finally {
                if (typeof clearInput === 'function') clearInput();
                else if (clearInput !== false && getUploadElements().fileInput) getUploadElements().fileInput.value = '';
                setUploadingState(false);
                currentUploadXhr = null;
                currentUploadTaskId = null;
                updateSendButtonState();
                if (getUploadElements().filePanel && getUploadElements().filePanel.classList.contains('visible')) {
                    loadCloudFiles();
                }
                setTimeout(() => setFileUploadProgress({ visible: false }), 900);
                uploadCancelledByUser = false;
            }

            return uploadResult;
        }

        return {
            setFileUploadProgress,
            cancelCurrentFileUpload,
            pollUploadTask,
            uploadSingleFileWithProgress,
            showUploadVectorMessage,
            appendUploadedFileEntry,
            appendUploadedImageEntry,
            handleFileUploadFiles,
        };
    }

    function createFileCenterUploadController(deps = {}) {
        const escapeHtml = requireFileDependency(deps, 'escapeHtml');
        const showToast = requireFileDependency(deps, 'showToast');
        const copyTextToClipboardSafe = requireFileDependency(deps, 'copyTextToClipboardSafe');
        const handleFileUploadFiles = requireFileDependency(deps, 'handleFileUploadFiles');
        const loadFileCenterFiles = requireFileDependency(deps, 'loadFileCenterFiles');
        const normalizeFileCenterPath = requireFileDependency(deps, 'normalizeFileCenterPath');
        const getFileCenterCurrentPath = requireFileDependency(deps, 'getFileCenterCurrentPath');
        let fileCenterUploadDialogState = createFileCenterUploadDialogState();

        async function uploadFileCenterFiles(files, clearInput) {
            const selectedFiles = Array.from(files || []);
        
            if (!selectedFiles.length) {
                showToast('请先选择文件');
                return false;
            }
        
            const uploadResult = await handleFileUploadFiles(selectedFiles, {
                source: 'file-center',
                attachToInput: false,
                uploadImagesAsFiles: true,
                targetPath: normalizeFileCenterPath(getFileCenterCurrentPath()),
                clearInput: () => {
                    if (typeof clearInput === 'function') {
                        clearInput();
                    }
                }
            });

            if (uploadResult && Number(uploadResult.successCount || 0) > 0) {
                await loadFileCenterFiles({ keepSelection: true });
            }
        
            return !!(
                uploadResult
                && Number(uploadResult.total || 0) > 0
                && Number(uploadResult.successCount || 0) === Number(uploadResult.total || 0)
                && Number(uploadResult.failureCount || 0) === 0
                && uploadResult.cancelled !== true
            );
        }
        
        function ensureFileCenterUploadDialog() {
            let modal = document.getElementById('fileCenterUploadDialog');
        
            if (modal) {
                return modal;
            }
        
            modal = document.createElement('div');
            modal.id = 'fileCenterUploadDialog';
            modal.className = 'modal-backdrop file-center-upload-dialog-backdrop';
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="file-center-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="fileCenterUploadDialogTitle">
                    <div class="file-center-upload-dialog-head">
                        <div>
                            <h3 id="fileCenterUploadDialogTitle">上传文件</h3>
                            <p>选择文件后可上传到 Files，或保持窗口打开进行在线传输。</p>
                        </div>
                        ${renderUploadDialogCloseButton()}
                    </div>
                    <div class="file-center-upload-dialog-body">
                        <section class="file-center-upload-dropzone" id="fileCenterUploadDropzone" tabindex="0" role="button" aria-label="选择或拖拽文件">
                            <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                            <strong>拖拽文件到这里</strong>
                            <span>或点击打开文件选择窗口</span>
                            <div class="file-center-upload-selected" id="fileCenterUploadSelected">未选择文件</div>
                        </section>
                        <aside class="file-center-upload-actions">
                            <button class="file-center-upload-action primary" id="fileCenterUploadDirectBtn" type="button">
                                <i class="fa-solid fa-upload" aria-hidden="true"></i>
                                <span>直接上传</span>
                            </button>
                            <button class="file-center-upload-action" id="fileCenterUploadTransferBtn" type="button">
                                <i class="fa-solid fa-link" aria-hidden="true"></i>
                                <span>在线传输</span>
                            </button>
                            <div class="file-center-live-transfer-panel" id="fileCenterLiveTransferPanel" hidden>
                                <div class="file-center-live-transfer-status" id="fileCenterLiveTransferStatus">等待创建传输链接</div>
                                <div class="file-center-live-transfer-link-row" id="fileCenterLiveTransferLinkRow" hidden>
                                    <input id="fileCenterLiveTransferLinkInput" type="text" readonly value="">
                                    <button class="file-center-tool-btn" id="fileCenterLiveTransferCopyBtn" type="button" title="复制下载地址" aria-label="复制下载地址">
                                        <i class="fa-regular fa-copy" aria-hidden="true"></i>
                                    </button>
                                </div>
                                <div class="file-center-live-transfer-code" id="fileCenterLiveTransferCode"></div>
                                <div class="file-center-live-transfer-progress" id="fileCenterLiveTransferProgress" hidden>
                                    <div class="file-center-live-transfer-progress-bar">
                                        <div class="file-center-live-transfer-progress-fill" id="fileCenterLiveTransferProgressFill"></div>
                                    </div>
                                    <div class="file-center-live-transfer-progress-meta">
                                        <span id="fileCenterLiveTransferProgressBytes">0 B / 0 B</span>
                                        <span id="fileCenterLiveTransferProgressSpeed">0 B/s</span>
                                    </div>
                                </div>
                                <div class="file-center-live-transfer-events" id="fileCenterLiveTransferEvents"></div>
                            </div>
                        </aside>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            bindFileCenterUploadDialog(modal);
        
            return modal;
        }
        
        function bindFileCenterUploadDialog(modal) {
            const closeBtn = modal.querySelector('#fileCenterUploadDialogClose');
            const dropzone = modal.querySelector('#fileCenterUploadDropzone');
            const directBtn = modal.querySelector('#fileCenterUploadDirectBtn');
            const transferBtn = modal.querySelector('#fileCenterUploadTransferBtn');
            const copyBtn = modal.querySelector('#fileCenterLiveTransferCopyBtn');
        
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    void closeFileCenterUploadDialog({ notifyTransferClosed: true });
                });
            }
        
            if (dropzone) {
                const openPicker = () => {
                    const input = document.getElementById('fileCenterUploadInput');
        
                    if (input) {
                        input.click();
                    }
                };
        
                dropzone.addEventListener('click', openPicker);
                dropzone.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        
                    event.preventDefault();
                    openPicker();
                });
                dropzone.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    dropzone.classList.add('drag-over');
                });
                dropzone.addEventListener('dragleave', () => {
                    dropzone.classList.remove('drag-over');
                });
                dropzone.addEventListener('drop', (event) => {
                    event.preventDefault();
                    dropzone.classList.remove('drag-over');
                    setFileCenterUploadDialogFiles(event.dataTransfer ? event.dataTransfer.files : []);
                });
            }
        
            if (directBtn) {
                directBtn.addEventListener('click', () => {
                    void directUploadFromFileCenterDialog();
                });
            }
        
            if (transferBtn) {
                transferBtn.addEventListener('click', () => {
                    void createLiveTransferFromFileCenterDialog();
                });
            }
        
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    const text = String(fileCenterUploadDialogState.downloadUrl || '').trim();
        
                    if (!text) {
                        showToast('暂无可复制的下载地址');
                        return;
                    }
        
                    try {
                        await copyTextToClipboardSafe(text);
                        showToast('下载地址已复制');
                    } catch (error) {
                        showToast('复制失败');
                    }
                });
            }
        
            if (window.__fileCenterUploadBeforeUnloadBound !== true) {
                window.__fileCenterUploadBeforeUnloadBound = true;
                window.addEventListener('beforeunload', () => {
                    revokeActiveFileCenterLiveTransfer({ beacon: true });
                });
            }
        }
        
        function openFileCenterUploadDialog() {
            const modal = ensureFileCenterUploadDialog();
        
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            renderFileCenterUploadDialog();
        }
        
        async function closeFileCenterUploadDialog(options = {}) {
            const modal = document.getElementById('fileCenterUploadDialog');
            const notifyTransferClosed = !!(options && options.notifyTransferClosed === true);
            const hadLiveTransfer = !!String(fileCenterUploadDialogState.activeCode || '').trim();
            const revoked = await revokeActiveFileCenterLiveTransfer();
        
            stopFileCenterLiveTransferTimers();
            fileCenterUploadDialogState = createFileCenterUploadDialogState();
        
            const input = document.getElementById('fileCenterUploadInput');
        
            if (input) {
                input.value = '';
            }
        
            if (modal) {
                modal.classList.remove('active');
                modal.setAttribute('aria-hidden', 'true');
            }
        
            if (notifyTransferClosed && hadLiveTransfer) {
                showToast(revoked ? '已关闭下载入口' : '关闭下载入口失败');
            }
        }
        
        function setFileCenterUploadDialogFiles(fileList) {
            if (String(fileCenterUploadDialogState.activeCode || '').trim()) {
                showToast('请先关闭当前在线传输');
                return;
            }
        
            fileCenterUploadDialogState.files = Array.from(fileList || []).filter(Boolean);
            renderFileCenterUploadDialog();
        }
        
        function renderFileCenterUploadDialog() {
            const selected = document.getElementById('fileCenterUploadSelected');
            const panel = document.getElementById('fileCenterLiveTransferPanel');
            const status = document.getElementById('fileCenterLiveTransferStatus');
            const linkRow = document.getElementById('fileCenterLiveTransferLinkRow');
            const linkInput = document.getElementById('fileCenterLiveTransferLinkInput');
            const codeEl = document.getElementById('fileCenterLiveTransferCode');
        
            if (selected) {
                const files = fileCenterUploadDialogState.files;
        
                if (!files.length) {
                    selected.textContent = '未选择文件';
                } else {
                    selected.innerHTML = files.map((file) => {
                        const name = escapeHtml(String(file.name || '未命名文件'));
                        const size = escapeHtml(formatFileSize(Number(file.size || 0)));
        
                        return `<span>${name}<small>${size}</small></span>`;
                    }).join('');
                }
            }
        
            if (panel) {
                panel.hidden = !fileCenterUploadDialogState.activeCode && !fileCenterUploadDialogState.busy;
            }
        
            if (status && !fileCenterUploadDialogState.activeCode && !fileCenterUploadDialogState.busy) {
                status.textContent = '等待创建传输链接';
            }
        
            if (linkRow) {
                linkRow.hidden = !fileCenterUploadDialogState.downloadUrl;
            }
        
            if (linkInput) {
                linkInput.value = fileCenterUploadDialogState.downloadUrl || '';
            }
        
            if (codeEl) {
                codeEl.textContent = fileCenterUploadDialogState.activeCode
                    ? `读取码：${fileCenterUploadDialogState.activeCode}`
                    : '';
            }
        
            renderFileCenterLiveTransferProgress();
        }
        
        function renderFileCenterLiveTransferProgress() {
            const progress = document.getElementById('fileCenterLiveTransferProgress');
            const fill = document.getElementById('fileCenterLiveTransferProgressFill');
            const bytesEl = document.getElementById('fileCenterLiveTransferProgressBytes');
            const speedEl = document.getElementById('fileCenterLiveTransferProgressSpeed');
            const file = fileCenterUploadDialogState.activeFile;
            const total = Number(file && file.size ? file.size : 0);
            const sent = Math.max(0, Math.min(total, Number(fileCenterUploadDialogState.transferBytesSent || 0)));
            const hasProgress = !!fileCenterUploadDialogState.currentDownloadId
                || fileCenterUploadDialogState.transferUploadActive
                || fileCenterUploadDialogState.transferUploadDone
                || sent > 0;
            const percent = total > 0 ? Math.max(0, Math.min(100, (sent / total) * 100)) : (fileCenterUploadDialogState.transferUploadDone ? 100 : 0);
        
            if (progress) {
                progress.hidden = !hasProgress;
            }
        
            if (fill) {
                fill.style.width = `${percent}%`;
            }
        
            if (bytesEl) {
                bytesEl.textContent = `${formatFileSize(sent)} / ${formatFileSize(total)}`;
            }
        
            if (speedEl) {
                speedEl.textContent = fileCenterUploadDialogState.transferUploadDone
                    ? '传输完成'
                    : formatByteRate(fileCenterUploadDialogState.transferSpeedBps || 0);
            }
        }
        
        async function directUploadFromFileCenterDialog() {
            if (fileCenterUploadDialogState.busy) return;
        
            const files = Array.from(fileCenterUploadDialogState.files || []);
        
            if (!files.length) {
                showToast('请先选择文件');
                return;
            }
        
            fileCenterUploadDialogState.busy = true;
            renderFileCenterUploadDialog();
        
            try {
                const uploaded = await uploadFileCenterFiles(files, () => {
                    const input = document.getElementById('fileCenterUploadInput');
        
                    if (input) {
                        input.value = '';
                    }
                });
        
                if (uploaded) {
                    fileCenterUploadDialogState.files = [];
                    showToast('文件已上传');
                    void closeFileCenterUploadDialog();
                }
            } finally {
                fileCenterUploadDialogState.busy = false;
                renderFileCenterUploadDialog();
            }
        }
        
        async function createLiveTransferFromFileCenterDialog() {
            if (fileCenterUploadDialogState.busy) return;
        
            const files = Array.from(fileCenterUploadDialogState.files || []);
        
            if (!files.length) {
                showToast('请先选择文件');
                return;
            }
        
            if (files.length !== 1) {
                showToast('在线传输一次只能选择一个文件');
                return;
            }
        
            await revokeActiveFileCenterLiveTransfer();
            stopFileCenterLiveTransferTimers();
            fileCenterUploadDialogState.busy = true;
            fileCenterUploadDialogState.activeFile = files[0];
            fileCenterUploadDialogState.currentDownloadId = '';
            fileCenterUploadDialogState.transferUploadActive = false;
            fileCenterUploadDialogState.transferUploadDone = false;
            fileCenterUploadDialogState.transferBytesSent = 0;
            fileCenterUploadDialogState.transferStartedAt = 0;
            fileCenterUploadDialogState.transferLastBytes = 0;
            fileCenterUploadDialogState.transferLastAt = 0;
            fileCenterUploadDialogState.transferSpeedBps = 0;
            updateFileCenterLiveTransferStatus('正在创建在线传输...');
            renderFileCenterUploadDialog();
        
            try {
                const res = await fetch('/api/files/live-transfer/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        file_name: files[0].name || 'transfer.bin',
                        file_size: Number(files[0].size || 0),
                        mime_type: files[0].type || 'application/octet-stream',
                        expires_in_minutes: 30,
                        max_downloads: 1
                    })
                });
                const data = await res.json();
        
                if (!data || !data.success) {
                    throw new Error(String((data && data.message) || '创建在线传输失败'));
                }
        
                const transfer = data.transfer || {};
                const code = String(transfer.code || '').trim();
        
                if (!code) {
                    throw new Error('后端未返回读取码');
                }
        
                fileCenterUploadDialogState.activeCode = code;
                fileCenterUploadDialogState.downloadUrl = new URL(`/api/files/transfer/${encodeURIComponent(code)}/download`, window.location.origin).toString();
                fileCenterUploadDialogState.lastEventId = 0;
                updateFileCenterLiveTransferStatus('在线传输已开启，等待接收端打开链接。');
                startFileCenterLiveTransferTimers(code);
                renderFileCenterUploadDialog();
            } catch (error) {
                updateFileCenterLiveTransferStatus(String((error && error.message) || '创建在线传输失败'));
                showToast(String((error && error.message) || '创建在线传输失败'));
            } finally {
                fileCenterUploadDialogState.busy = false;
                renderFileCenterUploadDialog();
            }
        }
        
        function updateFileCenterLiveTransferStatus(text) {
            const panel = document.getElementById('fileCenterLiveTransferPanel');
            const status = document.getElementById('fileCenterLiveTransferStatus');
        
            if (panel) {
                panel.hidden = false;
            }
        
            if (status) {
                status.textContent = String(text || '');
            }
        }
        
        function assertFileCenterLiveTransferActive(code, downloadId = '') {
            const activeCode = String(fileCenterUploadDialogState.activeCode || '').trim();
            const currentDownloadId = String(fileCenterUploadDialogState.currentDownloadId || '').trim();
            const expectedDownloadId = String(downloadId || '').trim();
        
            if (!activeCode || activeCode !== String(code || '').trim()) {
                throw new Error('在线传输已关闭');
            }
        
            if (expectedDownloadId && currentDownloadId && currentDownloadId !== expectedDownloadId) {
                throw new Error('接收端连接已切换');
            }
        }
        
        async function readFileCenterLiveTransferJson(res, defaultMessage) {
            let data = null;
        
            try {
                data = await res.json();
            } catch (error) {
                data = null;
            }
        
            if (!(res && res.ok) || !data || !data.success) {
                throw new Error(String((data && data.message) || defaultMessage || '在线传输请求失败'));
            }
        
            return data;
        }
        
        function updateFileCenterLiveTransferUploadProgress(sentBytes) {
            const now = performance.now();
            const sent = Math.max(0, Number(sentBytes || 0));
        
            if (!fileCenterUploadDialogState.transferStartedAt) {
                fileCenterUploadDialogState.transferStartedAt = now;
                fileCenterUploadDialogState.transferLastAt = now;
                fileCenterUploadDialogState.transferLastBytes = 0;
            }
        
            const elapsedSeconds = Math.max(0.001, (now - fileCenterUploadDialogState.transferStartedAt) / 1000);
            fileCenterUploadDialogState.transferBytesSent = sent;
            fileCenterUploadDialogState.transferSpeedBps = sent / elapsedSeconds;
            fileCenterUploadDialogState.transferLastAt = now;
            fileCenterUploadDialogState.transferLastBytes = sent;
        
            renderFileCenterLiveTransferProgress();
        }
        
        async function sendFileCenterLiveTransferChunk(code, downloadId, chunkIndex, chunk, abortController) {
            const res = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/chunk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Live-Transfer-Download-Id': downloadId,
                    'X-Live-Transfer-Chunk-Index': String(chunkIndex)
                },
                body: chunk,
                signal: abortController ? abortController.signal : undefined,
                cache: 'no-store'
            });
        
            return readFileCenterLiveTransferJson(res, '发送在线传输分片失败');
        }
        
        async function finishFileCenterLiveTransferUpload(code, downloadId, file, abortController) {
            const res = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/finish`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Live-Transfer-Download-Id': downloadId
                },
                body: JSON.stringify({
                    file_size: Number(file && file.size ? file.size : 0)
                }),
                signal: abortController ? abortController.signal : undefined,
                cache: 'no-store'
            });
        
            return readFileCenterLiveTransferJson(res, '结束在线传输失败');
        }
        
        async function startFileCenterLiveTransferUpload(code, downloadId) {
            const safeCode = String(code || '').trim();
            const safeDownloadId = String(downloadId || '').trim();
        
            if (!safeCode || !safeDownloadId) {
                throw new Error('缺少接收端连接 ID');
            }
        
            if (fileCenterUploadDialogState.transferUploadActive || fileCenterUploadDialogState.transferUploadDone) {
                return;
            }
        
            const file = fileCenterUploadDialogState.activeFile || (fileCenterUploadDialogState.files || [])[0];
        
            if (!file) {
                throw new Error('未找到待传输文件');
            }
        
            const abortController = new AbortController();
            const totalBytes = Number(file.size || 0);
            let offset = 0;
            let chunkIndex = 0;
        
            fileCenterUploadDialogState.currentDownloadId = safeDownloadId;
            fileCenterUploadDialogState.activeFile = file;
            fileCenterUploadDialogState.transferUploadActive = true;
            fileCenterUploadDialogState.transferUploadDone = false;
            fileCenterUploadDialogState.transferAbortController = abortController;
            fileCenterUploadDialogState.transferStartedAt = 0;
            fileCenterUploadDialogState.transferBytesSent = 0;
            fileCenterUploadDialogState.transferSpeedBps = 0;
            updateFileCenterLiveTransferStatus('接收端已连接，正在在线传输...');
            renderFileCenterLiveTransferProgress();
        
            try {
                assertFileCenterLiveTransferActive(safeCode, safeDownloadId);
        
                while (offset < totalBytes) {
                    const nextOffset = Math.min(offset + FILE_CENTER_LIVE_TRANSFER_CHUNK_SIZE, totalBytes);
                    const chunk = file.slice(offset, nextOffset);
        
                    await sendFileCenterLiveTransferChunk(safeCode, safeDownloadId, chunkIndex, chunk, abortController);
                    offset = nextOffset;
                    chunkIndex += 1;
                    updateFileCenterLiveTransferUploadProgress(offset);
                    assertFileCenterLiveTransferActive(safeCode, safeDownloadId);
                }
        
                await finishFileCenterLiveTransferUpload(safeCode, safeDownloadId, file, abortController);
                fileCenterUploadDialogState.transferUploadDone = true;
                fileCenterUploadDialogState.transferUploadActive = false;
                fileCenterUploadDialogState.transferAbortController = null;
                updateFileCenterLiveTransferUploadProgress(totalBytes);
                updateFileCenterLiveTransferStatus('文件已发送，等待接收端保存完成。');
            } catch (error) {
                fileCenterUploadDialogState.transferUploadActive = false;
                fileCenterUploadDialogState.transferAbortController = null;
        
                if (error && error.name === 'AbortError') {
                    updateFileCenterLiveTransferStatus('在线传输已中断');
                    return;
                }
        
                updateFileCenterLiveTransferStatus(String((error && error.message) || '在线传输失败'));
                showToast(String((error && error.message) || '在线传输失败'));
            } finally {
                renderFileCenterLiveTransferProgress();
            }
        }
        
        function startFileCenterLiveTransferTimers(code) {
            stopFileCenterLiveTransferTimers();
        
            const sendHeartbeat = async () => {
                const activeCode = String(fileCenterUploadDialogState.activeCode || '').trim();
        
                if (!activeCode || activeCode !== code) return;
        
                try {
                    const res = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/heartbeat`, {
                        method: 'POST',
                        cache: 'no-store'
                    });
                    const data = await res.json();
        
                    if (!data || !data.success) {
                        throw new Error(String((data && data.message) || '在线传输已失效'));
                    }
                } catch (error) {
                    updateFileCenterLiveTransferStatus(String((error && error.message) || '在线传输已失效'));
                    stopFileCenterLiveTransferTimers();
                }
            };
            const pollEvents = async () => {
                const activeCode = String(fileCenterUploadDialogState.activeCode || '').trim();
        
                if (!activeCode || activeCode !== code) return;
        
                try {
                    const res = await fetch(`/api/files/live-transfer/${encodeURIComponent(code)}/events?since=${encodeURIComponent(fileCenterUploadDialogState.lastEventId || 0)}`, {
                        cache: 'no-store'
                    });
                    const data = await res.json();
        
                    if (!data || !data.success) return;
        
                    renderFileCenterLiveTransferEvents(data.events || []);
                } catch (error) {
                    console.warn('poll live transfer events failed', error);
                }
            };
        
            void sendHeartbeat();
            void pollEvents();
            fileCenterUploadDialogState.heartbeatTimer = window.setInterval(sendHeartbeat, 5000);
            fileCenterUploadDialogState.eventTimer = window.setInterval(pollEvents, 2000);
        }
        
        function renderFileCenterLiveTransferEvents(events) {
            const list = document.getElementById('fileCenterLiveTransferEvents');
            const items = Array.isArray(events) ? events : [];
        
            if (!list || !items.length) return;
        
            const html = items.map((event) => {
                const eventId = Number(event.id || 0);
                const at = Number(event.at || 0) * 1000;
                const timeText = at ? new Date(at).toLocaleString() : '';
                const ip = escapeHtml(String(event.ip || '未知 IP'));
                const ua = escapeHtml(String(event.user_agent || '未知 UA'));
                const type = String(event.type || '').trim();
                const rawMessage = String(event.message || '');
                const message = escapeHtml(rawMessage);
                const bytesTransferred = Number(event.bytes_transferred || 0);
                const bytesText = bytesTransferred > 0 ? escapeHtml(formatFileSize(bytesTransferred)) : '';
                let label = '传输事件';
        
                fileCenterUploadDialogState.lastEventId = Math.max(fileCenterUploadDialogState.lastEventId || 0, eventId);
        
                if (type === 'download_request') {
                    label = '接收端已连接';
                    const downloadId = String(event.download_id || '').trim();
        
                    if (downloadId) {
                        void startFileCenterLiveTransferUpload(fileCenterUploadDialogState.activeCode, downloadId)
                            .catch((error) => {
                                const messageText = String((error && error.message) || '在线传输失败');
        
                                updateFileCenterLiveTransferStatus(messageText);
                                showToast(messageText);
                            });
                    }
                } else if (type === 'download_complete' || type === 'download') {
                    label = '接收完成';
                    fileCenterUploadDialogState.transferUploadDone = true;
                    fileCenterUploadDialogState.transferUploadActive = false;
                    fileCenterUploadDialogState.transferSpeedBps = 0;
                    if (fileCenterUploadDialogState.activeFile) {
                        fileCenterUploadDialogState.transferBytesSent = Number(fileCenterUploadDialogState.activeFile.size || 0);
                    }
                    updateFileCenterLiveTransferStatus('接收端已完成下载。');
                } else if (type === 'download_aborted') {
                    label = '接收端已断开';
                    fileCenterUploadDialogState.transferUploadActive = false;
                    updateFileCenterLiveTransferStatus(rawMessage || '接收端已断开');
                } else if (type === 'download_failed') {
                    label = '传输失败';
                    fileCenterUploadDialogState.transferUploadActive = false;
                    updateFileCenterLiveTransferStatus(rawMessage || '在线传输失败');
                }
        
                return `
                    <div class="file-center-live-transfer-event">
                        <strong>${escapeHtml(label)}</strong>
                        <span>${escapeHtml(timeText)}</span>
                        <code>${ip}</code>
                        <small>${ua}</small>
                        ${bytesText ? `<small>已传输 ${bytesText}</small>` : ''}
                        ${message ? `<small>${message}</small>` : ''}
                    </div>
                `;
            }).join('');
        
            list.insertAdjacentHTML('afterbegin', html);
            renderFileCenterLiveTransferProgress();
        }
        
        function stopFileCenterLiveTransferTimers() {
            if (fileCenterUploadDialogState.heartbeatTimer) {
                window.clearInterval(fileCenterUploadDialogState.heartbeatTimer);
                fileCenterUploadDialogState.heartbeatTimer = 0;
            }
        
            if (fileCenterUploadDialogState.eventTimer) {
                window.clearInterval(fileCenterUploadDialogState.eventTimer);
                fileCenterUploadDialogState.eventTimer = 0;
            }
        }
        
        async function revokeActiveFileCenterLiveTransfer(options = {}) {
            const code = String(fileCenterUploadDialogState.activeCode || '').trim();
        
            if (!code) return false;
        
            if (fileCenterUploadDialogState.transferAbortController) {
                try {
                    fileCenterUploadDialogState.transferAbortController.abort();
                } catch (error) {
                    // ignore abort errors
                }
            }
        
            fileCenterUploadDialogState.transferAbortController = null;
            fileCenterUploadDialogState.transferUploadActive = false;
            fileCenterUploadDialogState.activeCode = '';
            fileCenterUploadDialogState.downloadUrl = '';
        
            const url = `/api/files/live-transfer/${encodeURIComponent(code)}/revoke`;
        
            if (options && options.beacon === true && navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([], { type: 'application/octet-stream' }));
                return true;
            }
        
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    cache: 'no-store',
                    keepalive: !!(options && options.beacon === true)
                });
                const data = await res.json();
        
                if (!data || !data.success) {
                    throw new Error(String((data && data.message) || '关闭在线传输失败'));
                }
        
                return true;
            } catch (error) {
                console.warn('revoke live transfer failed', error);
                return false;
            }
        }

        return {
            uploadFileCenterFiles,
            ensureFileCenterUploadDialog,
            bindFileCenterUploadDialog,
            openFileCenterUploadDialog,
            closeFileCenterUploadDialog,
            setFileCenterUploadDialogFiles,
            renderFileCenterUploadDialog,
            renderFileCenterLiveTransferProgress,
            directUploadFromFileCenterDialog,
            createLiveTransferFromFileCenterDialog,
            updateFileCenterLiveTransferStatus,
            assertFileCenterLiveTransferActive,
            readFileCenterLiveTransferJson,
            updateFileCenterLiveTransferUploadProgress,
            sendFileCenterLiveTransferChunk,
            finishFileCenterLiveTransferUpload,
            startFileCenterLiveTransferUpload,
            startFileCenterLiveTransferTimers,
            renderFileCenterLiveTransferEvents,
            stopFileCenterLiveTransferTimers,
            revokeActiveFileCenterLiveTransfer,
        };
    }

    shared.registerModule('files', {
        captureFileCenterScrollPosition,
        resetFileCenterScrollPosition,
        restoreFileCenterScrollPosition,
        renderUploadDialogCloseButton,
        formatFileSize,
        formatByteRate,
        createFileCenterUploadDialogState,
        createFileUploadController,
        createFileCenterUploadController,
    });
})();
