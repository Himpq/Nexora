/**
 * app.js — NexoraCode 本地自绘 UI 主逻辑
 *
 * 项目模式专用：登录 → 绑定本地项目 → 新建/切换会话 → 云端引擎流式聊天。
 * 本地工具经 WSS 由云端引擎执行，UI 负责展示工具调用与权限询问卡片。
 */
(function () {
    "use strict";

    const API = window.NexoraApi;
    const MD = window.NexoraMarkdown;

    const state = {
        user: null,
        models: [],
        modelName: "",
        conversations: [],
        currentConversationId: "",
        currentProject: null,
        streaming: false,
        abortController: null
    };

    const PROJ_KEY = "nexoracode_project";

    const $ = function (id) {
        return document.getElementById(id);
    };

    // ===== 视图切换 =====

    function showView(name) {
        $("view-login").classList.toggle("hidden", name !== "login");
        $("view-main").classList.toggle("hidden", name !== "main");
    }

    // ===== 登录 =====

    async function checkLogin() {
        const res = await API.getUserInfo();
        if (res.ok && res.data && res.data.success) {
            state.user = res.data.user || res.data;
            enterMain();
            return true;
        }
        showView("login");
        return false;
    }

    async function doLogin(ev) {
        ev.preventDefault();
        const username = $("login-username").value.trim();
        const password = $("login-password").value;
        if (!username || !password) {
            $("login-error").textContent = "请输入用户名和密码";
            return;
        }
        $("login-error").textContent = "";
        const res = await API.login(username, password);
        if (res.ok && res.data && res.data.success) {
            await checkLogin();
        } else {
            $("login-error").textContent = (res.data && res.data.message) || "登录失败";
        }
    }

    async function doLogout() {
        await API.logout();
        state.user = null;
        resetMain();
        showView("login");
    }

    // ===== 模型 =====

    async function loadModels() {
        try {
            const res = await API.getConfig();
            if (!res.ok || !res.data) {
                return;
            }
            const models = res.data.models || {};
            const list = [];
            for (const key of Object.keys(models)) {
                const m = models[key];
                if (m && m.disabled) {
                    continue;
                }
                const label = (m && (m.name || m.label)) || key;
                list.push({ id: key, label: String(label) });
            }
            state.models = list.sort(function (a, b) {
                return a.label.localeCompare(b.label);
            });
            const sel = $("model-select");
            sel.innerHTML = "";
            for (const m of list) {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.label;
                sel.appendChild(opt);
            }
            const preferred = String(localStorage.getItem("nc_model") || "");
            if (preferred && list.some(function (m) { return m.id === preferred; })) {
                sel.value = preferred;
            }
            state.modelName = sel.value;
        } catch (_) {}
    }

    // ===== 项目 =====

    function loadProject() {
        try {
            state.currentProject = JSON.parse(localStorage.getItem(PROJ_KEY) || "null");
        } catch (_) {
            state.currentProject = null;
        }
        renderProject();
    }

    function renderProject() {
        const panel = $("project-panel");
        const project = state.currentProject;
        panel.innerHTML = "";
        if (!project || !project.path) {
            panel.innerHTML = '<div class="project-empty">未绑定项目</div>';
            return;
        }
        const item = document.createElement("div");
        item.className = "project-item";
        item.innerHTML =
            '<div class="p-name"></div><div class="p-path"></div>';
        item.querySelector(".p-name").textContent = project.name || "本地项目";
        item.querySelector(".p-path").textContent = project.path;
        panel.appendChild(item);
    }

    async function selectProject() {
        const res = await API.selectFolder();
        if (!res.ok || !res.data || !res.data.success) {
            if (res.data && res.data.cancelled) {
                return;
            }
            alert((res.data && res.data.message) || "选择项目失败");
            return;
        }
        const path = String(res.data.path || "").trim();
        if (!path) {
            return;
        }
        const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
        state.currentProject = {
            project_id: "proj_" + Date.now().toString(36),
            name: name,
            path: path,
            subtitle: path
        };
        localStorage.setItem(PROJ_KEY, JSON.stringify(state.currentProject));
        renderProject();
    }

    function buildProjectMetadata() {
        const project = state.currentProject;
        if (!project || !project.path) {
            return {};
        }
        return {
            nexoracode_project: {
                project_id: project.project_id,
                name: project.name,
                path: project.path,
                subtitle: project.subtitle || project.path || "本地项目",
                tree_scanned_at: project.tree_scanned_at || ""
            }
        };
    }

    // ===== 会话 =====

    async function loadConversations() {
        const res = await API.listConversations();
        if (!res.ok || !res.data) {
            return;
        }
        const items = res.data.conversations || res.data.items || [];
        state.conversations = items;
        renderConversations();
    }

    function getConvProjectName(conv) {
        if (!conv || typeof conv !== "object") {
            return "";
        }
        const project = (conv.nexoracode_project && typeof conv.nexoracode_project === "object")
            ? conv.nexoracode_project
            : ((conv.metadata && conv.metadata.nexoracode_project && typeof conv.metadata.nexoracode_project === "object")
                ? conv.metadata.nexoracode_project
                : null);
        if (!project) {
            return "";
        }
        return String(project.name || project.path || "项目").trim();
    }

    function formatConvTime(value) {
        if (!value) {
            return "";
        }
        const text = String(value);
        const match = text.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
        return match ? match[1] : text.slice(0, 16);
    }

    function renderConversations() {
        const list = $("conv-list");
        list.innerHTML = "";

        const groups = {};
        for (const conv of state.conversations) {
            const projectName = getConvProjectName(conv) || "通用会话";
            if (!groups[projectName]) {
                groups[projectName] = [];
            }
            groups[projectName].push(conv);
        }

        const names = Object.keys(groups).sort(function (a, b) {
            return a === "通用会话" ? 1 : (b === "通用会话" ? -1 : a.localeCompare(b));
        });

        for (const name of names) {
            const group = document.createElement("div");
            group.className = "conv-group";

            const label = document.createElement("div");
            label.className = "conv-group-label" + (name !== "通用会话" ? " has-project" : "");
            label.textContent = name;
            group.appendChild(label);

            const items = document.createElement("div");
            items.className = "conv-group-items";

            for (const conv of groups[name]) {
                const convId = String(conv.conversation_id || conv.id || "");
                const item = document.createElement("div");
                item.className = "conv-item";
                if (convId === state.currentConversationId) {
                    item.classList.add("active");
                }
                const title = conv.title || "未命名会话";
                const time = formatConvTime(conv.updated_at || conv.updated_at);
                item.innerHTML = '<div class="c-title"></div><div class="c-meta"></div>';
                item.querySelector(".c-title").textContent = title;
                if (time) {
                    item.querySelector(".c-meta").textContent = time;
                }
                item.addEventListener("click", function () {
                    openConversation(convId);
                });
                items.appendChild(item);
            }

            group.appendChild(items);
            list.appendChild(group);
        }
    }

    async function newConversation() {
        if (state.streaming) {
            return;
        }
        state.currentConversationId = "";
        $("chat-title").textContent = "新会话";
        $("messages").innerHTML = "";
        renderConversations();
        const input = $("input");
        input.value = "";
        input.focus();
    }

    async function createConversation(title) {
        const metadata = buildProjectMetadata();
        const res = await API.createConversation(title || "新会话", metadata);
        if (!res.ok || !res.data || !res.data.success) {
            alert((res.data && res.data.message) || "创建会话失败");
            return "";
        }
        return String(res.data.conversation_id || "").trim();
    }

    async function openConversation(conversationId) {
        if (!conversationId || conversationId === state.currentConversationId) {
            return;
        }
        state.currentConversationId = conversationId;
        renderConversations();
        $("messages").innerHTML = "";
        const res = await API.getConversation(conversationId);
        if (res.ok && res.data) {
            const conv = res.data.conversation || res.data;
            $("chat-title").textContent = conv.title || "会话";
            const meta = conv.metadata || {};
            if (meta.nexoracode_project) {
                renderProjectBanner(meta.nexoracode_project);
            }
        }
        const msgRes = await API.getMessages(conversationId, 50);
        const messages = (msgRes.data && (msgRes.data.messages || msgRes.data.items)) || [];
        renderHistory(messages);
    }

    function renderProjectBanner(project) {
        const title = $("chat-title");
        if (project && project.name) {
            title.textContent = title.textContent + " · " + project.name;
        }
    }

    // ===== 历史消息渲染 =====

    function renderHistory(messages) {
        const container = $("messages");
        for (const msg of messages) {
            if (msg.role === "user") {
                appendUserMessage(msg.content || "");
            } else if (msg.role === "assistant") {
                appendAssistantMessage(msg.content || "", msg.tools || msg.function_calls || null);
            }
        }
        scrollToBottom();
    }

    // ===== 消息渲染 =====

    function createMessageEl(role) {
        const wrap = document.createElement("div");
        wrap.className = "message " + role;
        const roleEl = document.createElement("div");
        roleEl.className = "msg-role";
        roleEl.textContent = role === "user" ? "你" : "NexoraCode";
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        wrap.appendChild(roleEl);
        wrap.appendChild(bubble);
        $("messages").appendChild(wrap);
        return { wrap: wrap, bubble: bubble };
    }

    function appendUserMessage(text) {
        const el = createMessageEl("user");
        el.bubble.textContent = text;
        scrollToBottom();
        return el;
    }

    function appendAssistantMessage(text, tools) {
        const el = createMessageEl("assistant");
        if (text) {
            el.bubble.innerHTML = MD.renderMarkdown(text, false);
        }
        if (tools && tools.length) {
            for (const tool of tools) {
                appendToolCardEl(el.wrap, tool);
            }
        }
        scrollToBottom();
        return el;
    }

    function scrollToBottom() {
        const container = $("messages");
        container.scrollTop = container.scrollHeight;
    }

    // ===== 工具卡片 =====

    function appendToolCardEl(parent, tool) {
        const card = document.createElement("div");
        card.className = "tool-card";
        card.innerHTML =
            '<div class="tool-head"><span class="t-name"></span><span class="t-status ok">完成</span></div>' +
            '<div class="tool-body hidden"></div>';
        card.querySelector(".t-name").textContent = tool.name || tool.tool || "工具";
        const body = card.querySelector(".tool-body");
        const argsText = tool.arguments || tool.args || "";
        if (argsText) {
            body.textContent = typeof argsText === "string" ? argsText : JSON.stringify(argsText, null, 2);
        }
        const result = tool.result;
        if (result) {
            body.innerHTML = "<pre></pre>";
            body.querySelector("pre").textContent = MD.renderToolResult(result);
        }
        if (argsText || result) {
            body.classList.remove("hidden");
        }
        card.querySelector(".tool-head").addEventListener("click", function () {
            body.classList.toggle("hidden");
        });
        parent.appendChild(card);
        return card;
    }

    function ensureStreamToolCard(callId, name) {
        const streamEl = getStreamMessage();
        if (!streamEl) {
            return null;
        }
        let card = streamEl.querySelector('[data-call-id="' + callId + '"]');
        if (card) {
            return card;
        }
        card = document.createElement("div");
        card.className = "tool-card";
        card.dataset.callId = callId;
        card.innerHTML =
            '<div class="tool-head"><span class="t-name"></span><span class="t-status running">运行中…</span></div>' +
            '<div class="tool-body hidden"></div>';
        card.querySelector(".t-name").textContent = name || "工具";
        card.querySelector(".tool-head").addEventListener("click", function () {
            card.querySelector(".tool-body").classList.toggle("hidden");
        });
        streamEl.appendChild(card);
        return card;
    }

    function updateStreamToolCard(callId, patch) {
        const streamEl = getStreamMessage();
        if (!streamEl) {
            return;
        }
        const card = streamEl.querySelector('[data-call-id="' + callId + '"]');
        if (!card) {
            return;
        }
        if (patch.args) {
            const body = card.querySelector(".tool-body");
            body.innerHTML = "<pre></pre>";
            body.querySelector("pre").textContent = MD.renderToolResult(patch.args);
            body.classList.remove("hidden");
        }
        if (patch.result !== undefined) {
            const body = card.querySelector(".tool-body");
            body.innerHTML = "<pre></pre>";
            body.querySelector("pre").textContent = MD.renderToolResult(patch.result);
            body.classList.remove("hidden");
        }
        if (patch.success !== undefined) {
            const status = card.querySelector(".t-status");
            status.className = "t-status " + (patch.success ? "ok" : "err");
            status.textContent = patch.success ? "完成" : "失败";
        }
    }

    // ===== 权限卡片 =====

    function tryRenderPermissionQuestion(rawText) {
        if (typeof rawText !== "string") {
            return null;
        }
        const trimmed = rawText.trim();
        if (!trimmed.startsWith("{")) {
            return null;
        }
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch (_) {
            return null;
        }
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        const question = parsed.question;
        if (!question || typeof question !== "object") {
            return null;
        }
        const permission = question.permission_request;
        if (!permission || typeof permission !== "object") {
            return null;
        }
        return permission;
    }

    function renderPermissionCard(parent, permission, conversationId) {
        const card = document.createElement("div");
        card.className = "permission-card";
        const operationText = { read: "读取", write: "写入", read_write: "读取和写入" }[permission.operation || permission.access] || "访问";
        const scopeText = (permission.scope === "dir" ? "目录" : "文件");
        card.innerHTML =
            '<div class="p-title">请求访问权限</div>' +
            '<div class="p-detail"></div>' +
            '<div class="p-reason"></div>' +
            '<div class="p-actions"><button class="btn primary" type="button" data-act="allow">允许</button><button class="btn" type="button" data-act="deny">拒绝</button></div>';
        card.querySelector(".p-detail").textContent = "模型需要临时" + operationText + "这个本地" + scopeText + "：" + (permission.path || "");
        card.querySelector(".p-reason").textContent = "原因：" + (permission.reason || "");
        card.querySelector('[data-act="allow"]').addEventListener("click", async function () {
            const btn = card.querySelector('[data-act="allow"]');
            btn.disabled = true;
            btn.textContent = "处理中…";
            const res = await API.grantPermission({
                conversation_id: conversationId,
                permission_request: {
                    path: permission.path,
                    scope: permission.scope || "file",
                    access: permission.access || permission.operation || "read",
                    reason: permission.reason || "",
                    sensitive: Boolean(permission.sensitive)
                }
            });
            if (res.ok && res.data && res.data.success) {
                card.querySelector(".p-title").textContent = "已允许";
                card.querySelector(".p-reason").textContent = "已授权本次对话临时访问，模型将自动重试。";
                card.querySelector(".p-actions").remove();
            } else {
                btn.disabled = false;
                btn.textContent = "允许";
                card.querySelector(".p-reason").textContent = (res.data && res.data.message) || "授权失败";
            }
        });
        card.querySelector('[data-act="deny"]').addEventListener("click", function () {
            card.querySelector(".p-title").textContent = "已拒绝";
            card.querySelector(".p-reason").textContent = "本次对话无法访问该路径。";
            card.querySelector(".p-actions").remove();
        });
        parent.appendChild(card);
        return card;
    }

    // ===== 聊天流 =====

    let streamMessage = null;
    let streamContent = "";

    function getStreamMessage() {
        return streamMessage;
    }

    function beginStreamMessage() {
        streamContent = "";
        streamMessage = document.createElement("div");
        streamMessage.className = "message assistant";
        const roleEl = document.createElement("div");
        roleEl.className = "msg-role";
        roleEl.textContent = "NexoraCode";
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        streamMessage.appendChild(roleEl);
        streamMessage.appendChild(bubble);
        $("messages").appendChild(streamMessage);
    }

    function appendStreamContent(delta) {
        streamContent += String(delta || "");
        const bubble = streamMessage.querySelector(".msg-bubble");

        const permission = tryRenderPermissionQuestion(streamContent);
        if (permission) {
            renderPermissionCard(streamMessage, permission, state.currentConversationId);
            streamContent = "";
            bubble.innerHTML = "";
            return;
        }

        bubble.innerHTML = MD.renderMarkdown(streamContent, true);
        scrollToBottom();
    }

    function finalizeStreamMessage() {
        if (streamMessage) {
            const bubble = streamMessage.querySelector(".msg-bubble");
            bubble.innerHTML = MD.renderMarkdown(streamContent, false);
        }
        streamMessage = null;
        streamContent = "";
        scrollToBottom();
    }

    function handleChunk(chunk) {
        const type = String(chunk.type || "");
        if (type === "conversation_id") {
            const cid = String(chunk.conversation_id || "");
            if (cid) {
                state.currentConversationId = cid;
            }
            return;
        }
        if (type === "content") {
            if (!streamMessage) {
                beginStreamMessage();
            }
            appendStreamContent(chunk.content || chunk.text || chunk.delta || "");
            return;
        }
        if (type === "reasoning_content") {
            return;
        }
        if (type === "question") {
            const permission = chunk.question && chunk.question.permission_request;
            if (permission) {
                if (!streamMessage) {
                    beginStreamMessage();
                }
                renderPermissionCard(streamMessage, permission, state.currentConversationId);
            }
            return;
        }
        if (type === "function_call" || type === "function_call_running" || type === "function_call_delta") {
            const fn = chunk.function || {};
            const name = String(chunk.name || fn.name || "");
            const args = chunk.arguments || chunk.arguments_delta || fn.arguments || "";
            const callId = String(chunk.call_id || chunk.id || (name + "_" + (chunk.index || 0)));
            const card = ensureStreamToolCard(callId, name);
            if (card && args) {
                updateStreamToolCard(callId, { args: args });
            }
            return;
        }
        if (type === "function_result" || type === "tool_result") {
            const name = String(chunk.name || "");
            const callId = String(chunk.call_id || chunk.id || "");
            const result = chunk.result;
            const success = chunk.success !== false;
            updateStreamToolCard(callId || (name + "_0"), { result: result, success: success });
            return;
        }
        if (type === "error") {
            appendAssistantMessage("错误：" + (chunk.message || chunk.error || "未知错误"), null);
            return;
        }
    }

    function setStreaming(flag) {
        state.streaming = flag;
        $("btn-send").classList.toggle("hidden", flag);
        $("btn-stop").classList.toggle("hidden", !flag);
        $("input-status").textContent = flag ? "生成中…" : "";
    }

    async function sendMessage() {
        const input = $("input");
        const text = input.value.trim();
        if (!text || state.streaming) {
            return;
        }
        appendUserMessage(text);
        input.value = "";
        input.style.height = "auto";
        input.focus();

        let conversationId = state.currentConversationId;
        if (!conversationId) {
            conversationId = await createConversation("");
            if (!conversationId) {
                return;
            }
            state.currentConversationId = conversationId;
            renderConversations();
        }

        const payload = {
            message: text,
            conversation_id: conversationId,
            model_name: state.modelName,
            enable_tools: true,
            tool_mode: "force",
            enable_thinking: false
        };

        setStreaming(true);
        beginStreamMessage();

        state.abortController = API.streamChat(payload, handleChunk, function () {
            finalizeStreamMessage();
            setStreaming(false);
            loadConversations();
        }, function (err) {
            if (streamMessage) {
                const bubble = streamMessage.querySelector(".msg-bubble");
                bubble.innerHTML = MD.renderMarkdown(streamContent + "\n\n**（生成中断）**", false);
            }
            streamMessage = null;
            streamContent = "";
            setStreaming(false);
            try { console.error("[chat] stream error:", err); } catch (_) {}
        });
    }

    function stopStream() {
        if (!state.streaming) {
            return;
        }
        if (state.currentConversationId) {
            API.cancelChat(state.currentConversationId);
        }
        if (state.abortController) {
            state.abortController.abort();
        }
        finalizeStreamMessage();
        setStreaming(false);
    }

    // ===== 初始化 =====

    function resetMain() {
        state.conversations = [];
        state.currentConversationId = "";
        state.streaming = false;
        $("messages").innerHTML = "";
        $("conv-list").innerHTML = "";
        $("chat-title").textContent = "新会话";
    }

    function enterMain() {
        showView("main");
        loadModels();
        loadConversations();
        loadProject();
        $("input").focus();
    }

    function bindEvents() {
        $("login-form").addEventListener("submit", doLogin);
        $("btn-logout").addEventListener("click", doLogout);
        $("btn-select-project").addEventListener("click", selectProject);
        $("btn-new-conv").addEventListener("click", newConversation);
        $("btn-send").addEventListener("click", sendMessage);
        $("btn-stop").addEventListener("click", stopStream);

        const input = $("input");
        input.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                sendMessage();
            }
        });
        input.addEventListener("input", function () {
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 180) + "px";
        });

        $("model-select").addEventListener("change", function () {
            state.modelName = this.value;
            localStorage.setItem("nc_model", this.value);
        });
    }

    function init() {
        bindEvents();
        checkLogin();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
