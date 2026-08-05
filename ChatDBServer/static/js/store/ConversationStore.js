/**
 * ConversationStore - 会话核心状态
 *
 * 管理当前会话 ID、生成状态、会话列表缓存、导航序列等。
 * 这些是跨模块读写最频繁的状态。
 */
import { ReactiveStore } from './ReactiveStore.js';

export class ConversationStore extends ReactiveStore {

    constructor() {
        super({
            // 当前活跃会话 ID
            currentId: null,

            // 是否正在生成（流式输出中）
            isGenerating: false,

            // 当前请求的 AbortController
            abortController: null,

            // 会话列表缓存
            listCache: [],

            // 会话导航序列号（防止过期加载）
            navigationSeq: 0,

            // 当前会话加载的 AbortController
            loadController: null,

            // 会话模式: 'chat' | 'learning'
            mode: 'chat',

            // 侧边栏作用域: 'nexora' | 'learning'
            sidebarScope: 'nexora',

            // 搜索关键词（返回时恢复用）
            searchQuery: '',

            // 是否包含图片历史
            hasImageHistory: false,

            // 待重新生成的过滤条件 {conversationId, index}
            pendingRegenerateFilter: { conversationId: '', index: -1 }
        });
    }

    get currentId() {
        return this.get('currentId');
    }

    set currentId(value) {
        this.set('currentId', value);
    }

    get isGenerating() {
        return this.get('isGenerating');
    }

    set isGenerating(value) {
        this.set('isGenerating', value);
    }

    get listCache() {
        return this.get('listCache');
    }

    set listCache(value) {
        this.set('listCache', value);
    }

    /**
     * 推进导航序列号，返回新序列号
     * 用于使旧的异步加载请求失效
     */
    advanceNavigationSeq() {
        const next = this.get('navigationSeq') + 1;
        this.set('navigationSeq', next);
        return next;
    }

    /**
     * 判断给定会话是否为当前活跃会话
     */
    isCurrent(conversationId) {
        return this.get('currentId') === conversationId;
    }
}
