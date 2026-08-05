(function () {
    'use strict';

    const pendingState = window.__nexoraSidebarBrandPendingState;
    const restoredState = pendingState && typeof pendingState === 'object' ? pendingState : {};
    const restoredLearning = restoredState.learning && typeof restoredState.learning === 'object'
        ? restoredState.learning
        : {};
    const restoredWorkspace = restoredState.workspace && typeof restoredState.workspace === 'object'
        ? restoredState.workspace
        : {};
    const state = {
        learningEnabled: !!restoredLearning.enabled,
        learningActive: !!restoredLearning.active,
        workspaceAvailable: !!restoredWorkspace.available,
        workspaceActive: !!restoredWorkspace.active,
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function setTabVisible(tab, visible) {
        if (!tab) return;

        tab.hidden = !visible;
        tab.style.display = visible ? '' : 'none';
    }

    function setTabActive(tab, active) {
        if (!tab) return;

        tab.classList.toggle('active', !!active);
        tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    /**
     * 全局品牌栏状态机。Workspace 选中时显示 Learning 与 Workspace；
     * 课程内切回 Learning 后同时保留 Nexora、Learning 与 Workspace。
     */
    function render() {
        const tabs = byId('sidebarBrandTabs');
        const nexoraTab = byId('sidebarBrandNexoraTab');
        const learningTab = byId('sidebarBrandLearningTab');
        const workspaceTab = byId('sidebarBrandWorkspaceTab');
        const workspaceActive = state.workspaceAvailable && state.workspaceActive;
        // Learning 未启用时不允许 learning 选中态：chat.js 对未启用的 Learning 点击
        // 直接 return 不切换视图，下划线若乐观移动会留下与业务不一致的选中态。
        const learningActive = state.learningEnabled && state.learningActive;
        const mode = workspaceActive ? 'workspace' : (learningActive ? 'learning' : 'nexora');
        const workspaceVisible = state.workspaceAvailable && (workspaceActive || learningActive);

        setTabVisible(nexoraTab, !workspaceActive);
        // Learning 是全局一级入口，不能由异步偏好或课程资源状态决定是否可见。
        setTabVisible(learningTab, true);
        setTabVisible(workspaceTab, workspaceVisible);

        setTabActive(nexoraTab, mode === 'nexora');
        setTabActive(learningTab, mode === 'learning');
        setTabActive(workspaceTab, mode === 'workspace');

        if (tabs) {
            tabs.dataset.sidebarBrandMode = mode;
        }
    }

    function setLearningState(nextState) {
        const next = nextState && typeof nextState === 'object' ? nextState : {};
        state.learningEnabled = !!next.enabled;
        // 未启用的 learning 不存在选中态，与 render 的门控保持同一不变量。
        state.learningActive = !!next.enabled && !!next.active;
        persistPendingState('learning', {
            enabled: state.learningEnabled,
            active: state.learningActive,
        });
        render();
    }

    function setWorkspaceState(nextState) {
        const next = nextState && typeof nextState === 'object' ? nextState : {};
        state.workspaceAvailable = !!next.available;
        state.workspaceActive = state.workspaceAvailable && !!next.active;
        persistPendingState('workspace', {
            available: state.workspaceAvailable,
            active: state.workspaceActive,
        });
        render();
    }

    function persistPendingState(scope, nextState) {
        const current = window.__nexoraSidebarBrandPendingState;
        const pending = current && typeof current === 'object' ? current : {};
        pending[scope] = nextState;
        window.__nexoraSidebarBrandPendingState = pending;
    }

    function selectModeFromTabClick(mode) {
        if (mode === 'workspace' && !state.workspaceAvailable) return;
        if (mode === 'learning' && !state.learningEnabled) return;

        state.learningActive = mode === 'learning';
        state.workspaceActive = mode === 'workspace';
        persistPendingState('learning', {
            enabled: state.learningEnabled,
            active: state.learningActive,
        });
        persistPendingState('workspace', {
            available: state.workspaceAvailable,
            active: state.workspaceActive,
        });
        render();
    }

    function handleBrandTabClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const tab = target.closest('[data-sidebar-mode]');
        if (!tab || !tab.closest('#sidebarBrandTabs')) return;

        const mode = String(tab.dataset.sidebarMode || '').trim().toLowerCase();
        if (mode === 'nexora' || mode === 'learning' || mode === 'workspace') {
            // 点击是品牌导航最早且最可靠的状态来源；业务模块可在随后异步校正它。
            selectModeFromTabClick(mode);
        }
    }

    window.NexoraSidebarBrand = {
        setLearningState,
        setWorkspaceState,
        sync: render,
    };

    // sidebar-header 会在 Workspace/Learning 间改变 tab 数量和宽度。
    // pointerdown 阶段提前 render 会让按钮在 pointerup 前位移，浏览器因此取消正式 click，
    // 表现为第一次只移动下划线、第二次才执行内容切换。品牌状态只能由 click 提交。
    document.addEventListener('click', handleBrandTabClick);
    render();
})();
