/**
 * StreamStore - 流式生成状态
 *
 * 管理 token 用量追踪、上下文预算等流式过程中的实时状态。
 * 注意：streamStateController 等控制器实例仍由 chat.js 创建和持有，
 * 此处只管理纯数据状态。
 */
import { ReactiveStore } from './ReactiveStore.js';

export class StreamStore extends ReactiveStore {

    constructor() {
        super({
            // 实时 token 用量
            tokenMini: {
                conversationId: null,
                baseInput: 0,
                baseOutput: 0,
                streamInput: 0,
                streamOutput: 0,
                estimatedStreamOutput: 0,
                usageSnapshotInput: 0,
                usageSnapshotOutput: 0,
                usageSnapshotInitialized: false,
                requestSeq: 0,
                streaming: false
            },

            // 上下文窗口预算
            tokenBudget: {
                contextWindow: 0,
                estimated: true,
                missingContextWindow: true,
                roundInput: 0,
                includeContext: true,
                latestInputTokens: 0,
                latestRawInputTokens: 0,
                latestCachedInputTokens: 0,
                cumulativeInputTokens: 0,
                cumulativeRawInputTokens: 0,
                cumulativeCachedInputTokens: 0,
                toolInputEstimate: 0,
                toolInputTokens: 0,
                systemPromptTokens: 0,
                tokenBreakdownExact: false
            },

            // 是否强制压缩上下文（一次性标志）
            forceContextCompressionOnce: false
        });
    }

    get tokenMini() {
        return this.get('tokenMini');
    }

    get tokenBudget() {
        return this.get('tokenBudget');
    }

    /**
     * 重置 token 用量追踪（切换会话时调用）
     */
    resetTokenMini(conversationId) {
        this.set('tokenMini', {
            conversationId: conversationId,
            baseInput: 0,
            baseOutput: 0,
            streamInput: 0,
            streamOutput: 0,
            estimatedStreamOutput: 0,
            usageSnapshotInput: 0,
            usageSnapshotOutput: 0,
            usageSnapshotInitialized: false,
            requestSeq: 0,
            streaming: false
        });
    }

    /**
     * 更新 token 用量的部分字段
     */
    patchTokenMini(partial) {
        const current = this.get('tokenMini');
        this.set('tokenMini', { ...current, ...partial });
    }

    /**
     * 更新上下文预算的部分字段
     */
    patchTokenBudget(partial) {
        const current = this.get('tokenBudget');
        this.set('tokenBudget', { ...current, ...partial });
    }
}
