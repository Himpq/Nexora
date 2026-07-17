(function () {
    'use strict';

    const LEARNING_SOURCE = 'nexora-learning';
    const STATE_TYPE = 'nexora:course-workspace:state';
    const HOST_SOURCE = 'nexora-host';
    const ACTION_TYPE = 'nexora:course-workspace:action';
    const LAYOUT_TYPE = 'nexora:course-workspace:layout';

    const BODY_WORKSPACE_CLASS = 'learning-workspace-active';
    const BODY_COURSE_CLASS = 'learning-course-workspace-active';
    const BODY_COURSE_CONTEXT_CLASS = 'learning-course-context-active';
    const HOST_WORKSPACE_CLASS = 'learning-workspace-host-active';
    const HOST_COURSE_CLASS = 'learning-course-workspace-host-active';
    const SIDEBAR_WORKSPACE_CLASS = 'learning-workspace-sidebar-active';
    const SIDEBAR_COURSE_CLASS = 'learning-course-workspace-sidebar-active';
    const INPUT_HIDDEN_CLASS = 'learning-mode-hidden';
    const WORKSPACE_TAB_REVEAL_CLASS = 'is-workspace-tab-revealing';
    const WORKSPACE_PANEL_ENTER_CLASS = 'is-workspace-panel-entering';
    const SIDEBAR_PANEL_REVEAL_CLASS = 'is-sidebar-panel-revealing';
    const WORKSPACE_ANIMATION_MS = 180;

    let workspaceSelected = false;
    let courseAvailable = false;
    let userLeftWorkspace = false;
    let workspaceSuppressed = false;
    let currentState = {};
    let restoreSnapshot = null;

    const animationTimers = new WeakMap();

    function byId(id) {
        return document.getElementById(id);
    }

    function resolveElements() {
        return {
            sidebar: byId('sidebar'),
            mainContent: document.querySelector('.main-content'),
            inputDock: document.querySelector('.input-dock'),
            conversationList: byId('conversationList'),
            learningSidebarPanel: byId('learningSidebarPanel'),
            courseWorkspacePanel: byId('learningCourseWorkspacePanel'),
            messagesContainer: byId('messagesContainer'),
            learningMainPanel: byId('learningMainPanel'),
            conversationTitle: byId('conversationTitle'),
            nexoraTab: byId('sidebarBrandNexoraTab'),
            learningTab: byId('sidebarBrandLearningTab'),
            workspaceTab: byId('sidebarBrandWorkspaceTab'),
        };
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizePayload(payload) {
        const src = payload && typeof payload === 'object' ? payload : {};

        return {
            active: !!src.active,
            lectureId: normalizeText(src.lecture_id || src.lectureId || ''),
            title: normalizeText(src.title || src.course_title || '课程工作区') || '课程工作区',
            heroHtml: String(src.hero_html || src.heroHtml || ''),
        };
    }

    function captureElementState(element) {
        if (!element) return null;

        return {
            display: element.style.display,
            hidden: element.hidden,
            collapsed: element.classList.contains('collapsed'),
            workspaceClass: element.classList.contains(HOST_WORKSPACE_CLASS),
            sidebarWorkspaceClass: element.classList.contains(SIDEBAR_WORKSPACE_CLASS),
            inputHiddenClass: element.classList.contains(INPUT_HIDDEN_CLASS),
        };
    }

    function captureTabState(element) {
        if (!element) return null;

        return {
            active: element.classList.contains('active'),
            pressed: element.getAttribute('aria-pressed'),
            hidden: element.hidden,
            display: element.style.display,
        };
    }

    function restoreElementDisplay(element, state) {
        if (!element || !state) return;
        element.style.display = state.display;
        element.hidden = state.hidden;

        if (Object.prototype.hasOwnProperty.call(state, 'collapsed')) {
            element.classList.toggle('collapsed', !!state.collapsed);
        }
    }

    function restoreTabState(element, state) {
        if (!element || !state) return;
        element.classList.toggle('active', !!state.active);
        element.setAttribute('aria-pressed', state.pressed || (state.active ? 'true' : 'false'));
        element.hidden = state.hidden;
        element.style.display = state.display;
    }

    function clearAnimationTimer(element) {
        if (!element) return;

        const timerId = animationTimers.get(element);

        if (typeof timerId === 'number') {
            window.clearTimeout(timerId);
        }

        animationTimers.delete(element);
    }

    function scheduleAnimationCleanup(element, className, delay) {
        if (!element || !className) return;

        clearAnimationTimer(element);

        const timerId = window.setTimeout(() => {
            element.classList.remove(className);
            animationTimers.delete(element);
        }, delay);

        animationTimers.set(element, timerId);
    }

    function resetAnimationClass(element, className) {
        if (!element || !className) return;
        clearAnimationTimer(element);
        element.classList.remove(className);
    }

    // 统一控制 Workspace 相关的轻量动效，避免不同入口的切换反馈不一致。
    function playAnimationClass(element, className, delay) {
        if (!element || !className) return;

        resetAnimationClass(element, className);
        void element.offsetWidth;
        element.classList.add(className);
        scheduleAnimationCleanup(element, className, delay);
    }

    function isElementVisible(element) {
        if (!element || element.hidden) {
            return false;
        }

        const styles = window.getComputedStyle(element);

        return styles.display !== 'none' && styles.visibility !== 'hidden';
    }

    function animateWorkspacePanelEnter(panel) {
        if (!panel || !isElementVisible(panel)) {
            return;
        }

        playAnimationClass(panel, WORKSPACE_PANEL_ENTER_CLASS, WORKSPACE_ANIMATION_MS);
    }

    function animateWorkspaceTabReveal(tab) {
        if (!tab || !isElementVisible(tab)) {
            return;
        }

        playAnimationClass(tab, WORKSPACE_TAB_REVEAL_CLASS, WORKSPACE_ANIMATION_MS);
    }

    function animateSidebarPanelReveal(panel) {
        if (!panel || !isElementVisible(panel)) {
            return;
        }

        playAnimationClass(panel, SIDEBAR_PANEL_REVEAL_CLASS, WORKSPACE_ANIMATION_MS);
    }

    // 切出 Workspace 后延后一帧检查当前可见侧栏，和宿主侧栏切换逻辑对齐。
    function animateSidebarAfterWorkspaceExit(elements) {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                animateSidebarPanelReveal(elements.conversationList);
                animateSidebarPanelReveal(elements.learningSidebarPanel);
            });
        });
    }

    function captureLearningSidebarState(elements) {
        const bridge = window.NexoraLearningSidebarBridge;
        const view = bridge && typeof bridge.getSidebarView === 'function'
            ? String(bridge.getSidebarView() || '').trim().toLowerCase()
            : 'list';
        const conversationId = bridge && typeof bridge.getCurrentConversationId === 'function'
            ? String(bridge.getCurrentConversationId() || '').trim()
            : '';

        return {
            view: view === 'conversation' ? 'conversation' : 'list',
            conversationId,
            scrollTop: elements.learningSidebarPanel
                ? Math.max(0, Number(elements.learningSidebarPanel.scrollTop || 0))
                : 0,
        };
    }

    function restoreLearningSidebarScroll(elements, state) {
        if (!elements.learningSidebarPanel || !state || state.view !== 'list') return;

        const scrollTop = Math.max(0, Number(state.scrollTop || 0));

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                elements.learningSidebarPanel.scrollTop = scrollTop;
            });
        });
    }

    function captureLayout(elements) {
        // 进入课程 Workspace 前记录当前聊天页布局，退出时按原状态恢复。
        return {
            bodyWorkspace: document.body.classList.contains(BODY_WORKSPACE_CLASS),
            inputDock: captureElementState(elements.inputDock),
            mainContent: captureElementState(elements.mainContent),
            sidebar: captureElementState(elements.sidebar),
            conversationList: captureElementState(elements.conversationList),
            learningSidebarPanel: captureElementState(elements.learningSidebarPanel),
            courseWorkspacePanel: captureElementState(elements.courseWorkspacePanel),
            messagesContainer: captureElementState(elements.messagesContainer),
            learningMainPanel: captureElementState(elements.learningMainPanel),
            learningSidebarState: captureLearningSidebarState(elements),
            nexoraTab: captureTabState(elements.nexoraTab),
            learningTab: captureTabState(elements.learningTab),
            workspaceTab: captureTabState(elements.workspaceTab),
            conversationTitle: elements.conversationTitle ? elements.conversationTitle.textContent : '',
        };
    }

    function restoreLayout(elements) {
        if (!restoreSnapshot) return;

        document.body.classList.toggle(BODY_WORKSPACE_CLASS, !!restoreSnapshot.bodyWorkspace);
        document.body.classList.remove(BODY_COURSE_CLASS);

        if (elements.mainContent) {
            elements.mainContent.classList.toggle(HOST_WORKSPACE_CLASS, !!(restoreSnapshot.mainContent && restoreSnapshot.mainContent.workspaceClass));
            elements.mainContent.classList.remove(HOST_COURSE_CLASS);
        }

        if (elements.sidebar) {
            elements.sidebar.classList.toggle(SIDEBAR_WORKSPACE_CLASS, !!(restoreSnapshot.sidebar && restoreSnapshot.sidebar.sidebarWorkspaceClass));
            elements.sidebar.classList.remove(SIDEBAR_COURSE_CLASS);
        }

        if (elements.inputDock) {
            elements.inputDock.classList.toggle(INPUT_HIDDEN_CLASS, !!(restoreSnapshot.inputDock && restoreSnapshot.inputDock.inputHiddenClass));
        }

        restoreElementDisplay(elements.conversationList, restoreSnapshot.conversationList);
        restoreElementDisplay(elements.learningSidebarPanel, restoreSnapshot.learningSidebarPanel);
        restoreElementDisplay(elements.courseWorkspacePanel, restoreSnapshot.courseWorkspacePanel);
        restoreElementDisplay(elements.messagesContainer, restoreSnapshot.messagesContainer);
        restoreElementDisplay(elements.learningMainPanel, restoreSnapshot.learningMainPanel);
        restoreLearningSidebarScroll(elements, restoreSnapshot.learningSidebarState);

        restoreTabState(elements.nexoraTab, restoreSnapshot.nexoraTab);
        restoreTabState(elements.learningTab, restoreSnapshot.learningTab);
        restoreTabState(elements.workspaceTab, restoreSnapshot.workspaceTab);

        if (elements.courseWorkspacePanel) {
            resetAnimationClass(elements.courseWorkspacePanel, WORKSPACE_PANEL_ENTER_CLASS);
            elements.courseWorkspacePanel.classList.remove('is-active');
        }

        resetAnimationClass(elements.conversationList, SIDEBAR_PANEL_REVEAL_CLASS);
        resetAnimationClass(elements.learningSidebarPanel, SIDEBAR_PANEL_REVEAL_CLASS);
        resetAnimationClass(elements.workspaceTab, WORKSPACE_TAB_REVEAL_CLASS);

        if (elements.conversationTitle && restoreSnapshot.conversationTitle) {
            elements.conversationTitle.textContent = restoreSnapshot.conversationTitle;
        }
    }

    function setTabActive(tab, active) {
        if (!tab) return;
        tab.classList.toggle('active', !!active);
        tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function syncWorkspaceTab(elements, selected) {
        if (!elements.workspaceTab) return;

        const wasVisible = isElementVisible(elements.workspaceTab);
        const visible = !!courseAvailable && !workspaceSuppressed;

        elements.workspaceTab.hidden = !visible;
        elements.workspaceTab.style.display = visible ? '' : 'none';
        setTabActive(elements.workspaceTab, !!selected && visible);

        if (visible && !wasVisible) {
            animateWorkspaceTabReveal(elements.workspaceTab);
        }

        if (!visible) {
            resetAnimationClass(elements.workspaceTab, WORKSPACE_TAB_REVEAL_CLASS);
        }

        if (selected) {
            setTabActive(elements.nexoraTab, false);
            setTabActive(elements.learningTab, false);
        }
    }

    function clearWorkspaceLayoutOnly(elements) {
        document.body.classList.remove(BODY_COURSE_CLASS);

        if (elements.mainContent) {
            elements.mainContent.classList.remove(HOST_COURSE_CLASS);
        }

        if (elements.sidebar) {
            elements.sidebar.classList.remove(SIDEBAR_COURSE_CLASS);
        }

        if (elements.courseWorkspacePanel) {
            resetAnimationClass(elements.courseWorkspacePanel, WORKSPACE_PANEL_ENTER_CLASS);
            elements.courseWorkspacePanel.hidden = true;
            elements.courseWorkspacePanel.style.display = 'none';
            elements.courseWorkspacePanel.classList.remove('is-active');
        }
    }

    function ensureLearningMainPanel() {
        if (typeof window.renderLearningMainPanel !== 'function') return;

        Promise.resolve()
            .then(() => window.renderLearningMainPanel())
            .then(() => {
                postWorkspaceLayoutState();
            })
            .catch((error) => {
                console.error('加载课程 Workspace 学习面板失败:', error);
            });
    }

    function getLearningMainFrame() {
        const elements = resolveElements();
        const root = elements.learningMainPanel;

        if (!root) {
            return null;
        }

        const frame = root.querySelector('.learning-mode-frame');

        return frame instanceof HTMLIFrameElement ? frame : null;
    }

    function getLearningFrameOrigin(frame) {
        if (!(frame instanceof HTMLIFrameElement)) {
            return '*';
        }

        try {
            const src = String(frame.getAttribute('src') || frame.src || '').trim();
            return src ? new URL(src, window.location.href).origin : '*';
        } catch (_error) {
            return '*';
        }
    }

    function postWorkspaceAction(action, lectureId) {
        const frame = getLearningMainFrame();

        if (!frame || !frame.contentWindow) {
            console.error('课程 Workspace 操作失败：Learning iframe 未就绪。', {
                action,
                lectureId,
            });
            return;
        }

        frame.contentWindow.postMessage({
            source: HOST_SOURCE,
            type: ACTION_TYPE,
            action: String(action || '').trim(),
            lecture_id: String(lectureId || '').trim(),
        }, getLearningFrameOrigin(frame));
    }

    function isSidebarOverlayLayout() {
        try {
            if (typeof window.isSidebarOverlayLayout === 'function') {
                return !!window.isSidebarOverlayLayout();
            }
        } catch (_error) {
            // ignore and read current sidebar style below
        }

        const sidebar = document.getElementById('sidebar');

        if (!sidebar) {
            return false;
        }

        const styles = window.getComputedStyle(sidebar);
        const position = String(styles.position || '').trim().toLowerCase();

        return position === 'fixed' || position === 'absolute';
    }

    function isSidebarAutoCollapseLayout() {
        return isSidebarOverlayLayout();
    }

    function postWorkspaceLayoutState() {
        const frame = getLearningMainFrame();

        if (!frame || !frame.contentWindow) {
            return;
        }

        frame.contentWindow.postMessage({
            source: HOST_SOURCE,
            type: LAYOUT_TYPE,
            sidebar_auto_collapse: isSidebarAutoCollapseLayout(),
        }, getLearningFrameOrigin(frame));
    }

    function applyWorkspaceLayout(elements, options) {
        const opts = options && typeof options === 'object' ? options : {};

        // Workspace 只接管课程预览，不改聊天消息历史。
        document.body.classList.add(BODY_WORKSPACE_CLASS, BODY_COURSE_CLASS);

        if (elements.sidebar) {
            elements.sidebar.classList.add(SIDEBAR_WORKSPACE_CLASS, SIDEBAR_COURSE_CLASS);
            elements.sidebar.classList.remove('collapsed');
        }

        if (elements.mainContent) {
            elements.mainContent.classList.add(HOST_WORKSPACE_CLASS, HOST_COURSE_CLASS);
        }

        if (elements.conversationList) {
            elements.conversationList.style.display = 'none';
        }

        if (elements.learningSidebarPanel) {
            elements.learningSidebarPanel.style.display = 'none';
        }

        if (elements.courseWorkspacePanel) {
            elements.courseWorkspacePanel.hidden = false;
            elements.courseWorkspacePanel.style.display = '';
            elements.courseWorkspacePanel.classList.add('is-active');

            if (opts.animatePanel) {
                animateWorkspacePanelEnter(elements.courseWorkspacePanel);
            } else {
                resetAnimationClass(elements.courseWorkspacePanel, WORKSPACE_PANEL_ENTER_CLASS);
            }
        }

        if (elements.messagesContainer) {
            elements.messagesContainer.style.display = 'none';
        }

        if (elements.learningMainPanel) {
            elements.learningMainPanel.style.display = '';
        }

        if (elements.inputDock) {
            elements.inputDock.classList.add(INPUT_HIDDEN_CLASS);
        }

        if (elements.conversationTitle) {
            elements.conversationTitle.textContent = currentState.title || '课程工作区';
        }

        syncWorkspaceTab(elements, true);
        ensureLearningMainPanel();
    }

    function renderPanel() {
        const elements = resolveElements();
        const panel = elements.courseWorkspacePanel;
        if (!panel) return;

        panel.innerHTML = `
            <section class="course-workspace-shell" aria-label="课程 Workspace">
                <div class="course-workspace-hero-copy">
                    ${currentState.heroHtml || ''}
                </div>
            </section>
        `;
    }

    function activateWorkspace(state) {
        const elements = resolveElements();
        const shouldAnimatePanel = !workspaceSelected;
        currentState = state || currentState;
        workspaceSuppressed = false;

        if (!workspaceSelected) {
            restoreSnapshot = captureLayout(elements);
        }

        workspaceSelected = true;
        userLeftWorkspace = false;
        renderPanel();
        applyWorkspaceLayout(elements, { animatePanel: shouldAnimatePanel });
    }

    function leaveWorkspaceSelection(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const elements = resolveElements();
        const wasWorkspaceSelected = workspaceSelected;

        userLeftWorkspace = true;

        if (workspaceSelected && opts.restore) {
            restoreLayout(elements);
        } else {
            clearWorkspaceLayoutOnly(elements);
        }

        workspaceSelected = false;
        restoreSnapshot = null;
        syncWorkspaceTab(elements, false);

        if (wasWorkspaceSelected) {
            animateSidebarAfterWorkspaceExit(elements);
        }
    }

    function closeCourseWorkspace() {
        const elements = resolveElements();

        if (workspaceSelected) {
            restoreLayout(elements);
        } else {
            clearWorkspaceLayoutOnly(elements);
        }

        workspaceSelected = false;
        courseAvailable = false;
        document.body.classList.remove(BODY_COURSE_CONTEXT_CLASS);
        workspaceSuppressed = false;
        userLeftWorkspace = false;
        currentState = {};
        restoreSnapshot = null;
        syncWorkspaceTab(elements, false);
    }

    function syncFromPayload(payload) {
        const nextState = normalizePayload(payload);

        if (!nextState.active) {
            closeCourseWorkspace();
            return;
        }

        courseAvailable = true;
        document.body.classList.add(BODY_COURSE_CONTEXT_CLASS);
        currentState = nextState;

        const elements = resolveElements();
        syncWorkspaceTab(elements, workspaceSelected);

        if (workspaceSelected || !userLeftWorkspace) {
            activateWorkspace(nextState);
        }
    }

    function handleWorkspaceTabClick(event) {
        if (!courseAvailable) return;

        event.preventDefault();
        event.stopPropagation();
        activateWorkspace(currentState);
    }

    function handleWorkspacePanelClick(event) {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const actionBtn = target.closest('#learningCourseWorkspacePanel [data-action]');

        if (!actionBtn) {
            return;
        }

        const action = String(actionBtn.getAttribute('data-action') || '').trim().toLowerCase();
        const lectureId = String(actionBtn.getAttribute('data-lecture-id') || currentState.lectureId || '').trim();

        if (action !== 'toggle-learning' && action !== 'start-learning-path') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        postWorkspaceAction(action, lectureId);
    }

    function handleDocumentClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        if (target.closest('#sidebarBrandWorkspaceTab')) return;

        if (target.closest('#sidebarBrandNexoraTab')) {
            if (courseAvailable) {
                workspaceSuppressed = true;
                leaveWorkspaceSelection({ restore: false });
            }
            return;
        }

        if (target.closest('#sidebarBrandLearningTab')) {
            if (courseAvailable) {
                workspaceSuppressed = false;
                // 用户主动切回 NexoraLearning 时只退出课程 Workspace，不覆盖 sidebar 自身的 Learning 切换结果。
                leaveWorkspaceSelection({ restore: false });
            }
        }
    }

    function handleMessage(event) {
        const payload = event && event.data;
        if (!payload || typeof payload !== 'object') return;
        if (String(payload.source || '').trim().toLowerCase() !== LEARNING_SOURCE) return;
        if (String(payload.type || '').trim().toLowerCase() !== STATE_TYPE) return;

        syncFromPayload(payload);
    }

    function init() {
        const elements = resolveElements();

        if (elements.workspaceTab) {
            elements.workspaceTab.addEventListener('click', handleWorkspaceTabClick);
        }

        if (elements.courseWorkspacePanel) {
            elements.courseWorkspacePanel.addEventListener('click', handleWorkspacePanelClick);
        }

        document.addEventListener('click', handleDocumentClick);
        window.addEventListener('message', handleMessage);
        window.addEventListener('resize', postWorkspaceLayoutState);
        syncWorkspaceTab(elements, false);
        window.setTimeout(postWorkspaceLayoutState, 0);
    }

    window.NexoraLearningCourseWorkspace = {
        sync: syncFromPayload,
        close: closeCourseWorkspace,
        isAvailable: () => courseAvailable,
        isActive: () => workspaceSelected,
        getLectureId: () => String(currentState.lectureId || '').trim(),
        getCourseTitle: () => String(currentState.title || '').trim(),
        getLearningSidebarRestoreState: () => {
            const state = restoreSnapshot && restoreSnapshot.learningSidebarState;

            if (!state) return null;

            return {
                view: state.view,
                conversationId: state.conversationId,
                scrollTop: state.scrollTop,
            };
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
