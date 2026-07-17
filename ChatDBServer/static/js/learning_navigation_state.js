(function () {
    // 统一持有两套 Sidebar 的恢复意图，避免视图、会话和阅读器状态互相覆盖。
    class LearningNavigationState {
        constructor() {
            this.sidebarView = 'list';
            this.lastConversationIds = {
                nexora: '',
                learning: '',
            };
            this.learningListScrollTop = 0;
            this.readerOpened = false;
            this.readerSuspended = false;
        }

        normalizeSidebarView(view) {
            return String(view || '').trim().toLowerCase() === 'conversation'
                ? 'conversation'
                : 'list';
        }

        setSidebarView(view) {
            this.sidebarView = this.normalizeSidebarView(view);
            return this.sidebarView;
        }

        getSidebarView() {
            return this.sidebarView;
        }

        rememberConversation(mode, conversationId) {
            const normalizedMode = String(mode || '').trim().toLowerCase() === 'learning'
                ? 'learning'
                : 'nexora';
            this.lastConversationIds[normalizedMode] = String(conversationId || '').trim();
        }

        getRememberedConversation(mode) {
            const normalizedMode = String(mode || '').trim().toLowerCase() === 'learning'
                ? 'learning'
                : 'nexora';
            return this.lastConversationIds[normalizedMode];
        }

        clearRememberedConversation(mode) {
            this.rememberConversation(mode, '');
        }

        captureLearningListScroll(scrollTop) {
            const normalizedTop = Number(scrollTop);

            if (!Number.isFinite(normalizedTop) || normalizedTop < 0) {
                throw new Error('Learning 列表滚动位置必须是非负有限数值');
            }

            this.learningListScrollTop = normalizedTop;
            return this.learningListScrollTop;
        }

        getLearningListScroll() {
            return this.learningListScrollTop;
        }

        setReaderOpened(opened) {
            this.readerOpened = !!opened;

            if (!this.readerOpened) {
                this.readerSuspended = false;
            }

            return this.readerOpened;
        }

        suspendReader() {
            const changed = this.readerOpened && !this.readerSuspended;
            this.readerSuspended = this.readerOpened;
            return changed;
        }

        resumeReader() {
            const resumed = this.readerOpened && this.readerSuspended;
            this.readerSuspended = false;
            return resumed;
        }

        isReaderOpened() {
            return this.readerOpened;
        }

        isReaderSuspended() {
            return this.readerSuspended;
        }

        isReaderHostActive() {
            return this.readerOpened && !this.readerSuspended;
        }
    }

    window.NexoraLearningNavigationState = {
        create() {
            return new LearningNavigationState();
        },
    };
})();
