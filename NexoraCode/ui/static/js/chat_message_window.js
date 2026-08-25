(function () {
    'use strict';

    const MODULE_NAME = 'messageWindow';
    const CONVERSATION_INITIAL_MESSAGE_LIMIT = 10;
    const CONVERSATION_PREVIOUS_MESSAGE_LIMIT = 10;

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Message Window 模块');
        }

        return shared;
    }

    function createInitialState(conversationId = '') {
        return {
            conversationId: String(conversationId || '').trim(),
            messages: [],
            loadedStartIndex: 0,
            loadedEndIndex: -1,
            total: 0,
            hasMoreBefore: false,
            loadingBefore: false
        };
    }

    const shared = getShared();
    const sharedState = shared.state && typeof shared.state === 'object'
        ? shared.state
        : {};
    const state = sharedState.messageWindow && typeof sharedState.messageWindow === 'object'
        ? sharedState.messageWindow
        : createInitialState();
    sharedState.messageWindow = state;
    shared.state = sharedState;

    function assignState(nextState) {
        const normalized = nextState && typeof nextState === 'object'
            ? nextState
            : createInitialState();

        state.conversationId = String(normalized.conversationId || '').trim();
        state.messages = Array.isArray(normalized.messages) ? normalized.messages : [];
        state.loadedStartIndex = Number.isFinite(Number(normalized.loadedStartIndex))
            ? Math.max(0, Math.floor(Number(normalized.loadedStartIndex)))
            : 0;
        state.loadedEndIndex = Number.isFinite(Number(normalized.loadedEndIndex))
            ? Math.floor(Number(normalized.loadedEndIndex))
            : -1;
        state.total = Number.isFinite(Number(normalized.total))
            ? Math.max(0, Math.floor(Number(normalized.total)))
            : 0;
        state.hasMoreBefore = !!normalized.hasMoreBefore;
        state.loadingBefore = !!normalized.loadingBefore;

        return state;
    }

    function readMessageRenderIndex(message, defaultIndex = 0) {
        const explicitIndex = Number(message && message.__message_index);

        if (Number.isFinite(explicitIndex) && explicitIndex >= 0) {
            return Math.floor(explicitIndex);
        }

        const defaultValue = Number(defaultIndex);

        if (Number.isFinite(defaultValue) && defaultValue >= 0) {
            return Math.floor(defaultValue);
        }

        return 0;
    }

    function buildIndexedMessageRows(messages, indexOffset = 0) {
        const rows = Array.isArray(messages) ? messages : [];
        const offset = Number(indexOffset);
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;

        return rows.map((message, index) => {
            const source = (message && typeof message === 'object') ? message : {};

            return {
                ...source,
                __message_index: readMessageRenderIndex(source, safeOffset + index)
            };
        });
    }

    function resetConversationMessageWindowState(conversationId = '') {
        return assignState(createInitialState(conversationId));
    }

    function mergeIndexedMessageRows(firstRows, secondRows) {
        const byIndex = new Map();
        const putRows = (rows) => {
            (Array.isArray(rows) ? rows : []).forEach((row, position) => {
                const indexed = buildIndexedMessageRows([row], readMessageRenderIndex(row, position))[0];
                const messageIndex = readMessageRenderIndex(indexed, position);
                byIndex.set(messageIndex, indexed);
            });
        };

        putRows(firstRows);
        putRows(secondRows);

        return Array.from(byIndex.entries())
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map((entry) => entry[1]);
    }

    function setConversationMessageWindowFromPayload(conversationId, messages, messageWindow) {
        const cid = String(conversationId || '').trim();
        const windowInfo = (messageWindow && typeof messageWindow === 'object') ? messageWindow : {};
        const startRaw = Number(windowInfo.start_index);
        const endRaw = Number(windowInfo.end_index);
        const totalRaw = Number(windowInfo.total);
        const rows = Array.isArray(messages) ? messages : [];
        const startIndex = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
        const indexedRows = buildIndexedMessageRows(rows, startIndex);

        assignState({
            conversationId: cid,
            messages: indexedRows,
            loadedStartIndex: startIndex,
            loadedEndIndex: Number.isFinite(endRaw) && endRaw >= startIndex
                ? Math.floor(endRaw)
                : (indexedRows.length ? readMessageRenderIndex(indexedRows[indexedRows.length - 1], startIndex + indexedRows.length - 1) : -1),
            total: Number.isFinite(totalRaw) && totalRaw >= 0 ? Math.floor(totalRaw) : indexedRows.length,
            hasMoreBefore: !!windowInfo.has_more_before,
            loadingBefore: false
        });

        return indexedRows;
    }

    function refreshConversationMessageWindowRange() {
        const rows = state.messages || [];

        if (!rows.length) {
            state.loadedStartIndex = 0;
            state.loadedEndIndex = -1;
            state.hasMoreBefore = false;
            return state;
        }

        const indices = rows.map((row, position) => readMessageRenderIndex(row, position));
        const minIndex = Math.min(...indices);
        const maxIndex = Math.max(...indices);
        state.loadedStartIndex = Number.isFinite(minIndex) ? minIndex : 0;
        state.loadedEndIndex = Number.isFinite(maxIndex) ? maxIndex : -1;
        state.hasMoreBefore = state.loadedStartIndex > 0;

        return state;
    }

    function syncConversationMessageWindowFromSnapshot(conversationId, messages) {
        const cid = String(conversationId || '').trim();
        const rows = Array.isArray(messages) ? messages : [];

        if (!cid || state.conversationId !== cid) {
            return false;
        }

        const serverRowsByIndex = new Map();
        buildIndexedMessageRows(rows, 0).forEach((row, position) => {
            const messageIndex = readMessageRenderIndex(row, position);
            serverRowsByIndex.set(messageIndex, row);
        });

        state.messages = (Array.isArray(state.messages) ? state.messages : []).map((row, position) => {
            const messageIndex = readMessageRenderIndex(row, position);
            return serverRowsByIndex.get(messageIndex) || row;
        });
        state.total = rows.length;
        refreshConversationMessageWindowRange();

        return true;
    }

    function rememberVisibleMessageInWindow(conversationId, message, messageIndex) {
        const cid = String(conversationId || '').trim();

        if (!cid || state.conversationId !== cid) {
            return false;
        }

        const indexed = buildIndexedMessageRows([message], messageIndex)[0];
        state.messages = mergeIndexedMessageRows(
            state.messages,
            [indexed]
        );
        state.total = Math.max(
            Number(state.total || 0),
            readMessageRenderIndex(indexed, messageIndex) + 1
        );
        refreshConversationMessageWindowRange();

        return true;
    }

    shared.registerModule(MODULE_NAME, {
        CONVERSATION_INITIAL_MESSAGE_LIMIT,
        CONVERSATION_PREVIOUS_MESSAGE_LIMIT,
        state,
        readMessageRenderIndex,
        buildIndexedMessageRows,
        resetConversationMessageWindowState,
        mergeIndexedMessageRows,
        setConversationMessageWindowFromPayload,
        refreshConversationMessageWindowRange,
        syncConversationMessageWindowFromSnapshot,
        rememberVisibleMessageInWindow
    });
})();
