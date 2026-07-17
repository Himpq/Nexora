(function () {
    const BODY_ACTIVE_CLASS = 'learning-workspace-active';
    const HOST_ACTIVE_CLASS = 'learning-workspace-host-active';
    const SIDEBAR_ACTIVE_CLASS = 'learning-workspace-sidebar-active';
    const SIDEBAR_CONVERSATION_CLASS = 'learning-sidebar-conversation-active';
    const PANEL_ACTIVE_CLASS = 'learning-workspace-panel-active';
    const INPUT_HIDDEN_CLASS = 'learning-mode-hidden';
    const READER_ACTIVE_CLASS = 'learning-reader-active';

    let active = false;

    function normalizeMode(value) {
        return String(value || '').trim().toLowerCase();
    }

    function resolveElements(elements) {
        const src = (elements && typeof elements === 'object') ? elements : {};
        return {
            sidebar: src.sidebar || document.getElementById('sidebar'),
            mainContent: src.mainContent || document.querySelector('.main-content'),
            inputDock: src.inputDock || document.querySelector('.input-dock'),
            learningSidebarPanel: src.learningSidebarPanel || document.getElementById('learningSidebarPanel'),
            learningMainPanel: src.learningMainPanel || document.getElementById('learningMainPanel')
        };
    }

    function isLearningWorkspaceState(state) {
        const src = (state && typeof state === 'object') ? state : {};
        return !!src.enabled && normalizeMode(src.sidebarMode) === 'learning';
    }

    function sync(state) {
        const src = (state && typeof state === 'object') ? state : {};
        const elements = resolveElements(src.elements);
        active = isLearningWorkspaceState(src);
        const readerActive = !!src.readerOpened;
        const sidebarView = String(src.sidebarView || '').trim().toLowerCase() === 'conversation'
            ? 'conversation'
            : 'list';

        document.body.classList.toggle(BODY_ACTIVE_CLASS, active);
        document.body.classList.toggle(READER_ACTIVE_CLASS, readerActive);
        document.body.classList.toggle(SIDEBAR_CONVERSATION_CLASS, active && sidebarView === 'conversation');

        if (elements.mainContent) {
            elements.mainContent.classList.toggle(HOST_ACTIVE_CLASS, active);
        }

        if (elements.sidebar) {
            elements.sidebar.classList.toggle(SIDEBAR_ACTIVE_CLASS, active);

            if (active) {
                elements.sidebar.classList.remove('collapsed');
            }
        }

        if (elements.learningSidebarPanel) {
            elements.learningSidebarPanel.classList.toggle(PANEL_ACTIVE_CLASS, active);
        }

        if (elements.learningMainPanel) {
            elements.learningMainPanel.classList.toggle(HOST_ACTIVE_CLASS, active);
        }

        if (elements.inputDock) {
            elements.inputDock.classList.toggle(INPUT_HIDDEN_CLASS, active);
        }

        return { active, readerActive };
    }

    function deactivate(elements) {
        return sync({ enabled: false, sidebarMode: 'nexora', elements });
    }

    function isActive() {
        return active;
    }

    window.NexoraLearningWorkspaceLayout = {
        sync,
        deactivate,
        isActive
    };
})();
