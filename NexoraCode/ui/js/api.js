/**
 * api.js — 云端 API 客户端
 *
 * 所有请求走相对路径，由本地代理（core/server.py）转发到云端 ChatDBServer。
 * 登录态为本地域 session cookie，由代理在 Set-Cookie 时改写。
 */
(function () {
    "use strict";

    async function request(method, url, body) {
        const opts = {
            method: method,
            credentials: "include",
            headers: {}
        };
        if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch(url, opts);
        let data = null;
        try {
            data = await resp.json();
        } catch (_) {
            data = null;
        }
        return { ok: resp.ok, status: resp.status, data: data };
    }

    function login(username, password) {
        return request("POST", "/login", { username: username, password: password });
    }

    function getUserInfo() {
        return request("GET", "/api/user/info?lite=1");
    }

    function logout() {
        return request("POST", "/logout");
    }

    function listConversations() {
        return request("GET", "/api/conversations");
    }

    function createConversation(title, metadata) {
        const payload = { title: title, conversation_mode: "chat", metadata: metadata || {} };
        return request("POST", "/api/conversations", payload);
    }

    function getConversation(conversationId) {
        return request("GET", "/api/conversations/" + encodeURIComponent(conversationId));
    }

    function getMessages(conversationId, limit) {
        const query = limit ? ("?limit=" + encodeURIComponent(limit)) : "";
        return request("GET", "/api/conversations/" + encodeURIComponent(conversationId) + "/messages" + query);
    }

    function getConfig() {
        return request("GET", "/api/config?");
    }

    function cancelChat(conversationId) {
        return request("POST", "/api/chat/stream/cancel", { conversation_id: conversationId });
    }

    function grantPermission(payload) {
        return request("POST", "/api/agent/permission/grant", payload);
    }

    function selectFolder() {
        return request("POST", "/nc/api/select-folder");
    }

    /**
     * 发起流式聊天。解析 SSE data: 行的 JSON，逐 chunk 回调。
     * 返回 abort 控制器供停止生成使用。
     */
    function streamChat(payload, onChunk, onDone, onError) {
        const controller = new AbortController();

        fetch("/api/chat/stream", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
            body: JSON.stringify(payload),
            signal: controller.signal
        }).then(async function (resp) {
            if (!resp.ok) {
                let msg = "HTTP " + resp.status;
                try {
                    const err = await resp.json();
                    msg = (err && (err.message || err.error)) || msg;
                } catch (_) {}
                throw new Error(msg);
            }
            if (!resp.body) {
                throw new Error("stream body is empty");
            }
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let done = false;

            while (!done) {
                const { done: readDone, value } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: !readDone });
                }
                if (readDone) {
                    buffer += decoder.decode();
                    done = true;
                }
                const lines = buffer.split("\n");
                buffer = done ? "" : (lines.pop() || "");

                for (const line of lines) {
                    if (!line.startsWith("data: ")) {
                        continue;
                    }
                    const raw = line.slice(6);
                    if (raw === "[DONE]") {
                        onDone();
                        continue;
                    }
                    try {
                        onChunk(JSON.parse(raw));
                    } catch (_) {
                        // 忽略无法解析的行
                    }
                }
            }
        }).catch(function (err) {
            if (err && err.name === "AbortError") {
                return;
            }
            onError(err);
        });

        return controller;
    }

    window.NexoraApi = {
        request: request,
        login: login,
        getUserInfo: getUserInfo,
        logout: logout,
        listConversations: listConversations,
        createConversation: createConversation,
        getConversation: getConversation,
        getMessages: getMessages,
        getConfig: getConfig,
        cancelChat: cancelChat,
        grantPermission: grantPermission,
        selectFolder: selectFolder,
        streamChat: streamChat
    };
})();
