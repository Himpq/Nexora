(function () {
    'use strict';

    const MODULE_NAME = 'conversationBranches';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册会话分支模块');
        }

        return shared;
    }

    function requireDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_conversation_branches 缺少依赖: ${name}`);
        }

        return value;
    }

    function createConversationBranchController(deps = {}) {
        const getCurrentConversationId = requireDependency(deps, 'getCurrentConversationId');
        const isConversationStreamRunning = requireDependency(deps, 'isConversationStreamRunning');
        const getActiveWorkspaceConversationContext = requireDependency(deps, 'getActiveWorkspaceConversationContext');
        const loadConversation = requireDependency(deps, 'loadConversation');
        const loadConversations = requireDependency(deps, 'loadConversations');
        const showToast = requireDependency(deps, 'showToast');
        const inFlightKeys = new Set();

        async function readJsonResponse(response) {
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                throw new Error(String(data.message || `创建分支失败（HTTP ${response.status}）`));
            }

            return data;
        }

        async function forkFromMessage(messageIndex) {
            const conversationId = String(getCurrentConversationId() || '').trim();
            const normalizedIndex = Number(messageIndex);

            if (!conversationId) {
                showToast('当前对话尚未保存，无法创建分支');
                return null;
            }

            if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) {
                showToast('分支节点无效，请刷新会话后重试');
                return null;
            }

            if (isConversationStreamRunning(conversationId)) {
                showToast('当前会话仍在生成，完成后才能创建分支');
                return null;
            }

            const requestKey = `${conversationId}:${normalizedIndex}`;

            if (inFlightKeys.has(requestKey)) {
                return null;
            }

            inFlightKeys.add(requestKey);

            try {
                const workspaceContext = getActiveWorkspaceConversationContext();
                const workspaceId = workspaceContext
                    ? String(workspaceContext.workspaceId || workspaceContext.workspace_id || '').trim()
                    : '';
                const payload = {
                    message_index: normalizedIndex,
                };

                if (workspaceId) {
                    payload.workspace_id = workspaceId;
                }

                const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/fork`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                const data = await readJsonResponse(response);
                const branchConversationId = String(data.conversation_id || '').trim();

                if (!branchConversationId) {
                    throw new Error('服务端未返回分支 conversation_id');
                }

                await loadConversation(branchConversationId, {
                    workspaceContext: workspaceId ? workspaceContext : null,
                });
                await loadConversations();
                showToast(`已创建分支：${String(data.title || branchConversationId)}`);
                return data;
            } catch (error) {
                showToast(String((error && error.message) || '创建分支失败'));
                return null;
            } finally {
                inFlightKeys.delete(requestKey);
            }
        }

        return {
            forkFromMessage,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createConversationBranchController,
    });
})();
