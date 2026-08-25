(function () {
    "use strict";

    const STAGES = [
        { key: "outline", label: "大纲", artifact: "source/outline.json", note: "项目结构与主题范围", runnable: true },
        { key: "script", label: "脚本", artifact: "source/script.json", note: "讲解正文与节奏", runnable: true },
        { key: "storyboard", label: "分镜", artifact: "source/storyboard.json", note: "场景拆分与视觉目标", runnable: true },
        { key: "images", label: "生图", artifact: "source/images.json", note: "场景图片资产", runnable: true },
        { key: "vision_description", label: "视觉复核", artifact: "source/image_descriptions.json", note: "图片描述与可用性", runnable: true },
        { key: "canvas", label: "画布", artifact: "source/canvas_manifest.json", note: "页面规格与幻灯片", runnable: true },
        { key: "slides", label: "幻灯片", artifact: "source/slides.json", note: "由画布阶段生成", runnable: false },
        { key: "audio", label: "配音", artifact: "source/audio.json", note: "旁白音频", runnable: true },
        { key: "clips", label: "分段视频", artifact: "source/clips.json", note: "场景视频片段", runnable: true },
        { key: "timeline", label: "时间线", artifact: "source/timeline.json", note: "镜头、字幕与时长", runnable: true },
        { key: "export", label: "导出", artifact: "exports/export.json", note: "成片与导出记录", runnable: true },
    ];
    const STATUS_LABELS = {
        pending: "等待",
        running: "运行中",
        done: "完成",
        failed: "失败",
        created: "已创建",
    };
    const FILE_FILTERS = [
        { key: "all", label: "全部" },
        { key: "json", label: "JSON" },
        { key: "image", label: "图片" },
        { key: "media", label: "媒体" },
        { key: "exports", label: "导出" },
    ];
    const KIND_LABELS = {
        json: "JSON",
        image: "图片",
        audio: "音频",
        video: "视频",
        text: "文本",
        file: "文件",
    };

    const state = {
        health: null,
        error: "",
        loadingProjects: false,
        creating: false,
        runningStage: "",
        projects: [],
        selectedProjectId: "",
        selectedProject: null,
        selectedProjectDir: "",
        files: [],
        fileFilter: "all",
        selectedFilePath: "",
        preview: {
            status: "empty",
            file: null,
            text: "",
            url: "",
            message: "",
        },
        creator: {
            title: "",
            duration: "90",
            style: "ppt",
            ratio: "16:9",
            contextText: "{}",
            promptsText: "{}",
        },
        refreshTimer: 0,
    };

    const el = {};

    document.addEventListener("DOMContentLoaded", init);

    function init() {
        cacheElements();
        bindEvents();
        hydrateIcons(document);
        renderAll();
        refreshProjects(true);
    }

    function cacheElements() {
        el.app = document.getElementById("videoWorkbenchApp");
        el.serviceStatus = document.getElementById("serviceStatus");
        el.refreshProjectsBtn = document.getElementById("refreshProjectsBtn");
        el.projectTitleInput = document.getElementById("projectTitleInput");
        el.projectContextInput = document.getElementById("projectContextInput");
        el.projectPromptsInput = document.getElementById("projectPromptsInput");
        el.createProjectBtn = document.getElementById("createProjectBtn");
        el.projectCount = document.getElementById("projectCount");
        el.projectList = document.getElementById("projectList");
        el.projectSummary = document.getElementById("projectSummary");
        el.stageGrid = document.getElementById("stageGrid");
        el.projectLogs = document.getElementById("projectLogs");
        el.fileFilters = document.getElementById("fileFilters");
        el.fileList = document.getElementById("fileList");
        el.filePreview = document.getElementById("filePreview");
        el.toast = document.getElementById("toast");
    }

    function bindEvents() {
        el.refreshProjectsBtn.addEventListener("click", () => refreshProjects(true));
        el.createProjectBtn.addEventListener("click", createProject);
        el.projectTitleInput.addEventListener("input", () => {
            state.creator.title = el.projectTitleInput.value;
        });
        el.projectContextInput.addEventListener("input", () => {
            state.creator.contextText = el.projectContextInput.value;
        });
        el.projectPromptsInput.addEventListener("input", () => {
            state.creator.promptsText = el.projectPromptsInput.value;
        });

        el.app.addEventListener("click", (event) => {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const optionButton = target.closest("[data-option-group] [data-option-value]");
            if (optionButton) {
                updateCreatorOption(optionButton);
                return;
            }

            const actionNode = target.closest("[data-action]");
            if (!actionNode) {
                return;
            }

            const action = String(actionNode.getAttribute("data-action") || "").trim();

            if (action === "select-project") {
                selectProject(String(actionNode.getAttribute("data-project-id") || "").trim());
                return;
            }

            if (action === "run-stage") {
                runStage(
                    String(actionNode.getAttribute("data-project-id") || "").trim(),
                    String(actionNode.getAttribute("data-stage") || "").trim()
                );
                return;
            }

            if (action === "open-file") {
                openFile(String(actionNode.getAttribute("data-file-path") || "").trim());
                return;
            }

            if (action === "set-file-filter") {
                state.fileFilter = String(actionNode.getAttribute("data-filter") || "all").trim() || "all";
                renderFiles();
            }
        });
    }

    function updateCreatorOption(button) {
        const group = button.closest("[data-option-group]");
        const key = String(group.getAttribute("data-option-group") || "").trim();
        const value = String(button.getAttribute("data-option-value") || "").trim();

        if (!Object.prototype.hasOwnProperty.call(state.creator, key)) {
            return;
        }

        state.creator[key] = value;
        renderCreatorOptions();
    }

    async function refreshProjects(manual) {
        clearRefreshTimer();
        state.loadingProjects = true;
        state.error = "";
        renderAll();

        try {
            const healthPayload = await requestJson("/health", { method: "GET" });
            const projectsPayload = await requestJson("/api/projects?limit=100", { method: "GET" });
            state.health = healthPayload;
            state.projects = normalizeProjects(projectsPayload.projects);
            syncSelectedProjectId();

            if (state.selectedProjectId) {
                await loadSelectedProject(state.selectedProjectId);
            } else {
                clearSelectedProject();
            }
        } catch (error) {
            state.error = error.message || "项目列表读取失败";
            if (manual) {
                showToast(state.error);
            }
        } finally {
            state.loadingProjects = false;
            renderAll();
            scheduleRefresh();
        }
    }

    async function selectProject(projectId) {
        if (!projectId || state.selectedProjectId === projectId) {
            return;
        }

        state.selectedProjectId = projectId;
        state.selectedFilePath = "";
        state.preview = emptyPreview();
        renderAll();

        try {
            await loadSelectedProject(projectId);
        } catch (error) {
            state.error = error.message || "项目读取失败";
            showToast(state.error);
        } finally {
            renderAll();
        }
    }

    async function loadSelectedProject(projectId) {
        const payload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "GET" });
        state.selectedProject = payload.project && typeof payload.project === "object" ? payload.project : null;
        state.selectedProjectDir = String(payload.project_dir || "");
        state.files = Array.isArray(payload.files) ? payload.files.map(normalizeFile).filter(Boolean) : [];

        if (state.selectedFilePath && !state.files.some((file) => file.relativePath === state.selectedFilePath)) {
            state.selectedFilePath = "";
            state.preview = emptyPreview();
        }
    }

    async function createProject() {
        const title = String(state.creator.title || "").trim();

        if (!title) {
            showToast("请输入项目标题");
            return;
        }

        let context;
        let extraPrompts;

        try {
            context = parseJsonObject(state.creator.contextText, "上下文 JSON");
            extraPrompts = parseJsonObject(state.creator.promptsText, "补充提示 JSON");
        } catch (error) {
            showToast(error.message || "JSON 格式错误");
            return;
        }

        state.creating = true;
        renderAll();

        try {
            const payload = await requestJson("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title,
                    created_by: "video_workbench",
                    context,
                    extra_prompts: extraPrompts,
                    options: {
                        duration_seconds: Number(state.creator.duration),
                        style: state.creator.style,
                        ratio: state.creator.ratio,
                    },
                }),
            });
            const project = payload.project && typeof payload.project === "object" ? payload.project : null;
            state.creator.title = "";
            el.projectTitleInput.value = "";
            showToast("项目已创建");

            if (project && project.id) {
                state.selectedProjectId = String(project.id);
            }

            await refreshProjects(false);
        } catch (error) {
            showToast(error.message || "项目创建失败");
        } finally {
            state.creating = false;
            renderAll();
        }
    }

    async function runStage(projectId, stage) {
        const stageRow = STAGES.find((item) => item.key === stage);

        if (!projectId || !stageRow || !stageRow.runnable || state.runningStage) {
            return;
        }

        state.runningStage = `${projectId}:${stage}`;
        markLocalStage(stage, "running");
        renderAll();

        try {
            await requestJson(`/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stage)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            showToast(`${stageRow.label} 已完成`);
            await refreshProjects(false);
        } catch (error) {
            showToast(error.message || "阶段执行失败");
            await loadSelectedProject(projectId).catch(() => {});
        } finally {
            state.runningStage = "";
            renderAll();
        }
    }

    async function openFile(relativePath) {
        const projectId = String(state.selectedProjectId || "").trim();
        const file = state.files.find((item) => item.relativePath === relativePath);

        if (!projectId || !file) {
            return;
        }

        state.selectedFilePath = file.relativePath;
        state.preview = {
            status: "loading",
            file,
            text: "",
            url: apiFileUrl(projectId, file.relativePath),
            message: "",
        };
        renderFiles();

        try {
            if (file.kind === "json") {
                const payload = await requestJson(apiArtifactUrl(projectId, file.relativePath), { method: "GET" });
                state.preview = {
                    status: "ready",
                    file,
                    text: JSON.stringify(payload.artifact, null, 4),
                    url: apiFileUrl(projectId, file.relativePath),
                    message: "",
                };
                renderFiles();
                return;
            }

            if (file.kind === "text") {
                const text = await requestText(apiFileUrl(projectId, file.relativePath));
                state.preview = {
                    status: "ready",
                    file,
                    text,
                    url: apiFileUrl(projectId, file.relativePath),
                    message: "",
                };
                renderFiles();
                return;
            }

            state.preview = {
                status: "ready",
                file,
                text: "",
                url: apiFileUrl(projectId, file.relativePath),
                message: "",
            };
            renderFiles();
        } catch (error) {
            state.preview = {
                status: "error",
                file,
                text: "",
                url: apiFileUrl(projectId, file.relativePath),
                message: error.message || "文件读取失败",
            };
            renderFiles();
        }
    }

    function renderAll() {
        renderServiceStatus();
        renderCreator();
        renderProjectList();
        renderProjectDetail();
        renderLogs();
        renderFiles();
        hydrateIcons(el.app);
    }

    function renderServiceStatus() {
        const status = el.serviceStatus;
        status.className = "service-status";

        if (state.error) {
            status.classList.add("is-error");
            status.textContent = state.error;
            return;
        }

        if (state.health && state.health.status === "ok") {
            status.classList.add("is-online");
            status.textContent = `${state.health.service || "NexoraVideoGenerator"} 在线`;
            return;
        }

        status.textContent = state.loadingProjects ? "连接中" : "未连接";
    }

    function renderCreator() {
        renderCreatorOptions();
        el.createProjectBtn.disabled = state.creating;
        el.createProjectBtn.innerHTML = `${iconSvg(state.creating ? "loader" : "plus")}<span>${state.creating ? "创建中" : "创建项目"}</span>`;

        if (document.activeElement !== el.projectTitleInput) {
            el.projectTitleInput.value = state.creator.title;
        }

        if (document.activeElement !== el.projectContextInput) {
            el.projectContextInput.value = state.creator.contextText;
        }

        if (document.activeElement !== el.projectPromptsInput) {
            el.projectPromptsInput.value = state.creator.promptsText;
        }
    }

    function renderCreatorOptions() {
        document.querySelectorAll("[data-option-group]").forEach((group) => {
            const key = String(group.getAttribute("data-option-group") || "").trim();
            const value = state.creator[key];

            group.querySelectorAll("[data-option-value]").forEach((button) => {
                const active = String(button.getAttribute("data-option-value") || "") === String(value || "");
                button.classList.toggle("is-active", active);
            });
        });
    }

    function renderProjectList() {
        el.projectCount.textContent = `${state.projects.length} 项`;

        if (state.loadingProjects && !state.projects.length) {
            el.projectList.innerHTML = '<div class="empty-state">正在读取项目</div>';
            return;
        }

        if (!state.projects.length) {
            el.projectList.innerHTML = '<div class="empty-state">暂无项目</div>';
            return;
        }

        el.projectList.innerHTML = state.projects.map((project) => {
            const projectId = String(project.id || "");
            const progress = stageProgress(project);
            const active = projectId === state.selectedProjectId;
            const updatedAt = formatTime(project.updated_at || project.created_at);
            return `
                <button class="project-row${active ? " is-active" : ""}" type="button" data-action="select-project" data-project-id="${escapeHtml(projectId)}">
                    <span class="project-row-title">${escapeHtml(project.title || projectId || "未命名项目")}</span>
                    <span class="project-row-meta">${escapeHtml(projectId)} · ${escapeHtml(project.status || "created")}</span>
                    <span class="project-row-meta">${progress.done}/${progress.total} 阶段 · ${escapeHtml(updatedAt)}</span>
                </button>
            `;
        }).join("");
    }

    function renderProjectDetail() {
        const project = state.selectedProject;

        if (!project) {
            el.projectSummary.innerHTML = '<div class="preview-empty">选择或创建一个视频项目</div>';
            el.stageGrid.innerHTML = "";
            return;
        }

        const progress = stageProgress(project);
        el.projectSummary.innerHTML = `
            <div>
                <h2>${escapeHtml(project.title || project.id || "未命名项目")}</h2>
            </div>
            <div class="summary-meta">
                <span>${escapeHtml(project.id || "")}</span>
                <span>${escapeHtml(project.status || "created")}</span>
                <span>${progress.done}/${progress.total} 阶段完成</span>
                <span>更新 ${escapeHtml(formatTime(project.updated_at || project.created_at))}</span>
            </div>
        `;

        renderStages(project);
    }

    function renderStages(project) {
        const stages = project.stages && typeof project.stages === "object" ? project.stages : {};

        el.stageGrid.innerHTML = STAGES.map((stage, index) => {
            const status = String(stages[stage.key] || "pending").trim() || "pending";
            const running = state.runningStage === `${project.id}:${stage.key}`;
            const stageClass = running ? "running" : status;
            const artifact = state.files.find((file) => file.relativePath === stage.artifact);
            const runLabel = running ? "运行中" : "运行";
            const runDisabled = running || !!state.runningStage || !stage.runnable;

            return `
                <article class="stage-card is-${escapeHtml(stageClass)}">
                    <div class="stage-card-head">
                        <span class="stage-index">${String(index + 1).padStart(2, "0")}</span>
                        <span class="status-badge is-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
                    </div>
                    <h3 class="stage-name">${escapeHtml(stage.label)}</h3>
                    <div class="stage-note">${escapeHtml(stage.note)}</div>
                    <div class="stage-actions">
                        <button class="stage-run-button" type="button" data-action="run-stage" data-project-id="${escapeHtml(project.id || "")}" data-stage="${escapeHtml(stage.key)}" ${runDisabled ? "disabled" : ""}>
                            ${iconSvg("play")}<span>${escapeHtml(runLabel)}</span>
                        </button>
                        ${artifact ? `
                            <button class="file-action-button" type="button" data-action="open-file" data-file-path="${escapeHtml(artifact.relativePath)}">
                                ${iconSvg("file")}<span>JSON</span>
                            </button>
                        ` : ""}
                    </div>
                </article>
            `;
        }).join("");
    }

    function renderLogs() {
        const project = state.selectedProject;

        if (!project) {
            el.projectLogs.innerHTML = '<div class="empty-state">暂无日志</div>';
            return;
        }

        const logs = Array.isArray(project.logs) ? project.logs.slice().reverse() : [];

        if (!logs.length) {
            el.projectLogs.innerHTML = '<div class="empty-state">暂无日志</div>';
            return;
        }

        el.projectLogs.innerHTML = logs.map((row) => `
            <div class="log-row">
                <span class="log-time">${escapeHtml(formatTime(row.time))}</span>
                <span class="log-type">${escapeHtml(row.type || "event")}</span>
                <span class="log-message">${escapeHtml(row.message || "")}</span>
            </div>
        `).join("");
    }

    function renderFiles() {
        renderFileFilters();
        renderFileList();
        renderFilePreview();
        hydrateIcons(el.fileList);
        hydrateIcons(el.filePreview);
    }

    function renderFileFilters() {
        el.fileFilters.innerHTML = FILE_FILTERS.map((filter) => `
            <button class="${state.fileFilter === filter.key ? "is-active" : ""}" type="button" data-action="set-file-filter" data-filter="${escapeHtml(filter.key)}">
                ${escapeHtml(filter.label)}
            </button>
        `).join("");
    }

    function renderFileList() {
        const files = filteredFiles();

        if (!state.selectedProject) {
            el.fileList.innerHTML = '<div class="empty-state">暂无项目文件</div>';
            return;
        }

        if (!files.length) {
            el.fileList.innerHTML = '<div class="empty-state">暂无匹配文件</div>';
            return;
        }

        el.fileList.innerHTML = files.map((file) => {
            const active = file.relativePath === state.selectedFilePath;
            return `
                <button class="file-row${active ? " is-active" : ""}" type="button" data-action="open-file" data-file-path="${escapeHtml(file.relativePath)}">
                    <span class="file-main">
                        <span class="file-name">${escapeHtml(file.name)}</span>
                        <span class="file-path">${escapeHtml(file.relativePath)} · ${formatFileSize(file.size)}</span>
                    </span>
                    <span class="file-badge">${escapeHtml(KIND_LABELS[file.kind] || file.kind)}</span>
                </button>
            `;
        }).join("");
    }

    function renderFilePreview() {
        const preview = state.preview;

        if (!state.selectedProject) {
            el.filePreview.innerHTML = '<div class="preview-empty">选择项目后查看产物文件</div>';
            return;
        }

        if (preview.status === "empty") {
            el.filePreview.innerHTML = '<div class="preview-empty">选择左侧文件</div>';
            return;
        }

        if (preview.status === "loading") {
            el.filePreview.innerHTML = '<div class="preview-empty">正在读取文件</div>';
            return;
        }

        const file = preview.file || {};
        const openLink = preview.url
            ? `<a class="preview-open-button" href="${escapeHtml(preview.url)}" target="_blank" rel="noreferrer">${iconSvg("external")}<span>打开</span></a>`
            : "";

        if (preview.status === "error") {
            el.filePreview.innerHTML = previewShell(file, openLink, `<pre>${escapeHtml(preview.message)}</pre>`);
            return;
        }

        if (file.kind === "image") {
            el.filePreview.innerHTML = previewShell(
                file,
                openLink,
                `<img class="preview-image" src="${escapeHtml(preview.url)}" alt="${escapeHtml(file.name || "image")}">`
            );
            return;
        }

        if (file.kind === "video") {
            el.filePreview.innerHTML = previewShell(
                file,
                openLink,
                `<video class="preview-media" src="${escapeHtml(preview.url)}" controls></video>`
            );
            return;
        }

        if (file.kind === "audio") {
            el.filePreview.innerHTML = previewShell(
                file,
                openLink,
                `<audio class="preview-audio" src="${escapeHtml(preview.url)}" controls></audio>`
            );
            return;
        }

        if (file.kind === "json" || file.kind === "text") {
            el.filePreview.innerHTML = previewShell(file, openLink, `<pre>${escapeHtml(preview.text)}</pre>`);
            return;
        }

        el.filePreview.innerHTML = previewShell(file, openLink, '<div class="preview-empty">文件可在新窗口打开</div>');
    }

    function previewShell(file, openLink, content) {
        return `
            <div class="preview-head">
                <div class="preview-title-wrap">
                    <div class="preview-title">${escapeHtml(file.name || "文件预览")}</div>
                    <div class="file-path">${escapeHtml(file.relativePath || "")}</div>
                </div>
                ${openLink}
            </div>
            <div class="preview-content">${content}</div>
        `;
    }

    function filteredFiles() {
        const rows = state.files.slice().sort(compareFiles);

        if (state.fileFilter === "all") {
            return rows;
        }

        if (state.fileFilter === "media") {
            return rows.filter((file) => file.kind === "audio" || file.kind === "video");
        }

        if (state.fileFilter === "exports") {
            return rows.filter((file) => file.area === "exports");
        }

        return rows.filter((file) => file.kind === state.fileFilter);
    }

    function compareFiles(left, right) {
        const areaOrder = { exports: 0, source: 1, project: 2 };
        const leftArea = areaOrder[left.area] ?? 9;
        const rightArea = areaOrder[right.area] ?? 9;

        if (leftArea !== rightArea) {
            return leftArea - rightArea;
        }

        return String(left.relativePath || "").localeCompare(String(right.relativePath || ""), "zh-CN");
    }

    function markLocalStage(stage, status) {
        if (!state.selectedProject || !state.selectedProject.stages) {
            return;
        }

        state.selectedProject.stages[stage] = status;
        state.selectedProject.status = `${stage}_${status}`;
    }

    function normalizeProjects(projects) {
        return (Array.isArray(projects) ? projects : [])
            .filter((project) => project && typeof project === "object")
            .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0));
    }

    function normalizeFile(file) {
        if (!file || typeof file !== "object") {
            return null;
        }

        const relativePath = String(file.relative_path || "").trim();

        if (!relativePath) {
            return null;
        }

        return {
            name: String(file.name || relativePath.split("/").pop() || relativePath),
            relativePath,
            area: String(file.area || "project"),
            kind: String(file.kind || "file"),
            mimeType: String(file.mime_type || ""),
            size: Number(file.size || 0),
            updatedAt: Number(file.updated_at || 0),
        };
    }

    function syncSelectedProjectId() {
        if (state.selectedProjectId && state.projects.some((project) => project.id === state.selectedProjectId)) {
            return;
        }

        state.selectedProjectId = state.projects.length ? String(state.projects[0].id || "") : "";
        state.selectedFilePath = "";
        state.preview = emptyPreview();
    }

    function clearSelectedProject() {
        state.selectedProject = null;
        state.selectedProjectDir = "";
        state.files = [];
        state.selectedFilePath = "";
        state.preview = emptyPreview();
    }

    function stageProgress(project) {
        const stages = project && project.stages && typeof project.stages === "object" ? project.stages : {};
        const total = STAGES.length;
        const done = STAGES.filter((stage) => stages[stage.key] === "done").length;
        return { done, total };
    }

    function emptyPreview() {
        return {
            status: "empty",
            file: null,
            text: "",
            url: "",
            message: "",
        };
    }

    function hasRunningProject() {
        return state.projects.some((project) => {
            const stages = project && project.stages && typeof project.stages === "object" ? project.stages : {};
            return String(project.status || "").includes("running") || Object.values(stages).includes("running");
        });
    }

    function scheduleRefresh() {
        if (!hasRunningProject()) {
            return;
        }

        state.refreshTimer = window.setTimeout(() => {
            state.refreshTimer = 0;
            refreshProjects(false);
        }, 4000);
    }

    function clearRefreshTimer() {
        if (!state.refreshTimer) {
            return;
        }

        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = 0;
    }

    async function requestJson(url, options) {
        const response = await fetch(url, {
            ...(options || {}),
            headers: {
                Accept: "application/json",
                ...((options && options.headers) ? options.headers : {}),
            },
        });
        const text = await response.text();
        let payload = {};

        if (text.trim()) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                throw new Error(`接口返回不是 JSON: ${text.slice(0, 160)}`);
            }
        }

        if (!response.ok || payload.success === false) {
            throw new Error(String(payload.message || payload.error || `HTTP ${response.status}`));
        }

        return payload;
    }

    async function requestText(url) {
        const response = await fetch(url, { headers: { Accept: "text/plain,*/*" } });
        const text = await response.text();

        if (!response.ok) {
            throw new Error(text || `HTTP ${response.status}`);
        }

        return text;
    }

    function parseJsonObject(text, label) {
        const source = String(text || "").trim();

        if (!source) {
            return {};
        }

        let payload;

        try {
            payload = JSON.parse(source);
        } catch (error) {
            throw new Error(`${label} 格式错误: ${error.message}`);
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error(`${label} 必须是 JSON 对象`);
        }

        return payload;
    }

    function apiFileUrl(projectId, relativePath) {
        return `/api/projects/${encodeURIComponent(projectId)}/files/${encodePath(relativePath)}`;
    }

    function apiArtifactUrl(projectId, relativePath) {
        return `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodePath(relativePath)}`;
    }

    function encodePath(path) {
        return String(path || "")
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/");
    }

    function formatTime(value) {
        const number = Number(value || 0);

        if (!number) {
            return "-";
        }

        return new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(number * 1000));
    }

    function formatFileSize(value) {
        const size = Number(value || 0);

        if (size < 1024) {
            return `${size} B`;
        }

        if (size < 1024 * 1024) {
            return `${(size / 1024).toFixed(1)} KB`;
        }

        return `${(size / 1024 / 1024).toFixed(1)} MB`;
    }

    function showToast(message) {
        el.toast.textContent = String(message || "");
        el.toast.classList.add("is-visible");

        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => {
            el.toast.classList.remove("is-visible");
        }, 3200);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function hydrateIcons(root) {
        if (!root) {
            return;
        }

        root.querySelectorAll("[data-icon]").forEach((node) => {
            node.innerHTML = iconSvg(String(node.getAttribute("data-icon") || ""));
        });
    }

    function iconSvg(name) {
        const icons = {
            refresh: '<path d="M21 12a9 9 0 0 1-15.2 6.5"/><path d="M3 12A9 9 0 0 1 18.2 5.5"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/>',
            plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
            play: '<path d="M8 5v14l11-7z"/>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>',
            external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
            loader: '<path d="M21 12a9 9 0 0 1-9 9"/><path d="M12 3a9 9 0 0 1 9 9"/>',
        };
        const body = icons[name] || icons.file;
        return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    }
})();
