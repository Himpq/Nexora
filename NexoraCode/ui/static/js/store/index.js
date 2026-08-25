/**
 * Store 入口 - 组合所有域子 store 为统一单例
 *
 * 用法:
 *   import { store } from './store/index.js';
 *   store.conversation.currentId;
 *   store.user.username;
 *   store.conversation.subscribe('isGenerating', (val) => { ... });
 *
 * 设计原则:
 *   - Store 只持有跨模块共享的核心状态
 *   - 模块私有状态（admin 面板、notes、timeline 等）留在各自模块内
 *   - 控制器实例（streamStateController 等）仍由 chat.js 创建，不纳入 Store
 */
import { ConversationStore } from './ConversationStore.js';
import { UserStore } from './UserStore.js';
import { ModelStore } from './ModelStore.js';
import { StreamStore } from './StreamStore.js';

class AppStore {

    constructor() {
        this.conversation = new ConversationStore();
        this.user = new UserStore();
        this.model = new ModelStore();
        this.stream = new StreamStore();
    }

    /**
     * 切换会话时统一重置各域状态
     * 由 loadConversation 流程调用
     */
    resetForConversation(conversationId) {
        this.conversation.patch({
            currentId: conversationId,
            isGenerating: false,
            abortController: null,
            pendingRegenerateFilter: null
        });

        this.stream.resetTokenMini(conversationId);
    }
}

// 全局单例
export const store = new AppStore();
