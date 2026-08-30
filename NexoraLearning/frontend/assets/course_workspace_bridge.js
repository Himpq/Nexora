(function () {
    'use strict';

    const LEARNING_SOURCE = 'nexora-learning';
    const HOST_SOURCE = 'nexora-host';
    const STATE_TYPE = 'nexora:course-workspace:state';
    const ACTION_TYPE = 'nexora:course-workspace:action';
    const LAYOUT_TYPE = 'nexora:course-workspace:layout';
    const POINTER_TYPE = 'nexora:learning-frame:pointerdown';
    const USER_OPEN_TYPE = 'nexora:course-workspace:user-open';
    const DASHBOARD_OPEN_TAB_TYPE = 'nexora:dashboard:open-tab';
    const DASHBOARD_OPEN_STUDIO_TYPE = 'nexora:dashboard:open-studio';
    const DASHBOARD_LAYOUT_TYPE = 'nexora:dashboard:layout';

    let lastPayloadKey = '';
    let lastLectureId = '';
    let lastTitle = '';
    let lastHeroHtml = '';
    let syncTimer = null;
    let hostSidebarAutoCollapse = false;
    let hasHostLayoutState = false;
    let pendingUserOpenLectureId = '';

    function byId(id) {
        return document.getElementById(id);
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isPaneActive(id) {
        const node = byId(id);
        return !!(node && node.classList.contains('is-active'));
    }

    function isShown(node) {
        return !!(node && !node.hidden && node.getAttribute('hidden') === null);
    }

    function readText(selector) {
        const node = document.querySelector(selector);
        return normalizeText(node ? node.textContent : '');
    }

    function readLectureId() {
        const selectors = [
            '#courseHomeContent [data-action="start-learning-path"][data-lecture-id]',
            '#courseHomeContent [data-lecture-id]',
            '#learningPathMarkdown [data-lecture-id]',
            '#learningPathOutline [data-lecture-id]',
            '#courseHomeContent [data-lecture-home-id]',
        ];

        for (const selector of selectors) {
            const node = document.querySelector(selector);

            if (!node) {
                continue;
            }

            const lectureId = normalizeText(node.getAttribute('data-lecture-id') || node.getAttribute('data-lecture-home-id') || '');

            if (lectureId) {
                lastLectureId = lectureId;
                return lectureId;
            }
        }

        return lastLectureId;
    }

    function readCourseTitle() {
        const title = readText('.learning-panel-hero-title')
            || readText('#courseHomeSubtitle')
            || readText('#readerSubTitle')
            || lastTitle
            || '课程 Workspace';

        if (title && title !== 'Learning') {
            lastTitle = title;
        }

        return lastTitle || title;
    }

    function absolutizeUrl(value) {
        const text = String(value || '').trim();

        if (!text) {
            return '';
        }

        return new URL(text, window.location.href).href;
    }

    function absolutizeSrcset(value) {
        return String(value || '').split(',').map((part) => {
            const segments = part.trim().split(/\s+/);
            const url = segments.shift();

            if (!url) {
                return '';
            }

            return [absolutizeUrl(url)].concat(segments).join(' ');
        }).filter(Boolean).join(', ');
    }

    function escapeAttributeValue(value) {
        const text = String(value || '').trim();

        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(text);
        }

        return text.replace(/["\\]/g, '\\$&');
    }

    function serializeHeroNode(node) {
        const clone = node.cloneNode(true);
        const idNodes = clone.querySelectorAll('[id]');
        const srcNodes = clone.querySelectorAll('[src]');
        const srcsetNodes = clone.querySelectorAll('[srcset]');

        clone.removeAttribute('id');

        idNodes.forEach((item) => {
            item.removeAttribute('id');
        });

        srcNodes.forEach((item) => {
            const value = absolutizeUrl(item.getAttribute('src'));

            if (value) {
                item.setAttribute('src', value);
            }
        });

        srcsetNodes.forEach((item) => {
            const value = absolutizeSrcset(item.getAttribute('srcset'));

            if (value) {
                item.setAttribute('srcset', value);
            }
        });

        return clone.outerHTML;
    }

    function readHeroHtml() {
        const node = document.querySelector('.learning-panel-hero-body');

        if (node) {
            lastHeroHtml = serializeHeroNode(node);
        }

        return lastHeroHtml;
    }

    function syncHeroBodyVisibility() {
        const node = document.querySelector('.learning-panel-hero-body');

        if (!node) {
            return;
        }

        node.classList.toggle('is-host-mobile-layout', !!hostSidebarAutoCollapse);
    }

    function emitLayoutStateChange() {
        window.dispatchEvent(new CustomEvent(LAYOUT_TYPE, {
            detail: {
                source: HOST_SOURCE,
                type: LAYOUT_TYPE,
                sidebar_auto_collapse: !!hostSidebarAutoCollapse,
            },
        }));
    }

    function isSidebarAutoCollapseLayout() {
        return !!hostSidebarAutoCollapse;
    }

    function isCourseWorkspaceActive() {
        if (isSidebarAutoCollapseLayout()) {
            return false;
        }

        const materialsActive = isPaneActive('materialsView');
        const courseHome = byId('courseHomePane');

        // 教材 Reader 由 reader state 接管沉浸主视图；个性化学习（学习路线）页面不展示
        // 课程 Workspace，故 Workspace 只代表课程主页。
        return !!(materialsActive && isShown(courseHome));
    }

    function readTabs() {
        const tabs = [];

        document.querySelectorAll('.course-home-tab').forEach((btn) => {
            if (btn.hidden) {
                return;
            }

            const key = normalizeText(btn.getAttribute('data-tab') || '');
            const label = normalizeText(btn.textContent);

            if (!key || !label) {
                return;
            }

            tabs.push({
                key,
                label,
                active: btn.classList.contains('is-active'),
            });
        });

        return tabs;
    }

    function readActiveTab(tabs) {
        const active = (tabs || []).find((tab) => tab.active);

        return active ? active.key : '';
    }

    function readSnapshot() {
        const active = isCourseWorkspaceActive();
        const lectureId = active ? readLectureId() : '';
        const title = active ? readCourseTitle() : '';
        const heroHtml = active ? readHeroHtml() : '';
        const tabs = active ? readTabs() : [];

        return {
            source: LEARNING_SOURCE,
            type: STATE_TYPE,
            active,
            lecture_id: lectureId,
            title,
            hero_html: heroHtml,
            tabs,
            active_tab: active ? readActiveTab(tabs) : '',
            activation: active && lectureId === pendingUserOpenLectureId ? 'user' : 'sync',
        };
    }

    function clickNode(node) {
        if (!node || typeof node.click !== 'function') {
            return false;
        }

        node.click();
        scheduleSync(40);
        window.setTimeout(() => scheduleSync(0), 180);
        return true;
    }

    function findCourseActionButton(action, lectureId) {
        const safeAction = String(action || '').trim();
        const safeLectureId = String(lectureId || '').trim();

        if (!safeAction || !safeLectureId) {
            return null;
        }

        return document.querySelector(`[data-action="${escapeAttributeValue(safeAction)}"][data-lecture-id="${escapeAttributeValue(safeLectureId)}"]`);
    }

    function handleToggleLearning(lectureId) {
        const safeLectureId = String(lectureId || '').trim();

        if (!safeLectureId) {
            return;
        }

        clickNode(findCourseActionButton('toggle-learning', safeLectureId));
    }

    function handleStartLearningPath(lectureId) {
        const safeLectureId = String(lectureId || '').trim();

        if (!safeLectureId) {
            return;
        }

        clickNode(findCourseActionButton('start-learning-path', safeLectureId));
    }

    function handleSwitchTab(tabKey) {
        const safeTab = String(tabKey || '').trim();

        if (!safeTab) {
            return;
        }

        const tabBtn = document.querySelector(`.course-home-tab[data-tab="${escapeAttributeValue(safeTab)}"]`);

        clickNode(tabBtn);
    }

    /**
     * 归一化宿主消息：同时接受旧协议(source=nexora-host)与 NexoraWeb 新信封
     * (protocol=nexora-learning v1, source=host)，新信封映射为旧协议后统一处理。
     * 映射关系与 NexoraWeb/src/bridge/learningBridge.ts 的 HostLearningCommand 对齐。
     */
    function normalizeHostEnvelope(payload) {
        const src = payload && typeof payload === 'object' ? payload : {};

        if (src.protocol !== 'nexora-learning' || Number(src.version) !== 1 || String(src.source || '') !== 'host') {
            return src;
        }

        const type = String(src.type || '').trim().toLowerCase();

        if (type === 'layout') {
            return {
                source: HOST_SOURCE,
                type: LAYOUT_TYPE,
                sidebar_auto_collapse: !!src.sidebar_auto_collapse,
            };
        }

        if (type === 'action') {
            return {
                source: HOST_SOURCE,
                type: ACTION_TYPE,
                action: String(src.action || '').trim().toLowerCase(),
                lecture_id: String(src.lecture_id || ''),
                tab: String(src.tab || ''),
            };
        }

        if (type === 'open-course') {
            return {
                source: HOST_SOURCE,
                type: ACTION_TYPE,
                action: 'toggle-learning',
                lecture_id: String(src.lecture_id || ''),
            };
        }

        if (type === 'start-learning-path') {
            return {
                source: HOST_SOURCE,
                type: ACTION_TYPE,
                action: 'start-learning-path',
                lecture_id: String(src.lecture_id || ''),
            };
        }

        if (type === 'switch-tab') {
            return {
                source: HOST_SOURCE,
                type: ACTION_TYPE,
                action: 'switch-tab',
                tab: String(src.tab || ''),
            };
        }

        if (type === 'open-dashboard-tab') {
            return {
                source: HOST_SOURCE,
                type: DASHBOARD_OPEN_TAB_TYPE,
                tab: String(src.tab || ''),
            };
        }

        if (type === 'open-studio') {
            return {
                source: HOST_SOURCE,
                type: DASHBOARD_OPEN_STUDIO_TYPE,
                studio: String(src.studio || ''),
            };
        }

        if (type === 'dashboard-layout') {
            return {
                source: HOST_SOURCE,
                type: DASHBOARD_LAYOUT_TYPE,
                nav_visible: !!src.nav_visible,
            };
        }

        return src;
    }

    function handleHostAction(payload) {
        const isV1Envelope = !!(payload && typeof payload === 'object' && payload.protocol === 'nexora-learning');
        const src = normalizeHostEnvelope(payload);

        if (String(src.source || '').trim().toLowerCase() !== HOST_SOURCE) {
            return;
        }

        const type = String(src.type || '').trim().toLowerCase();

        // dashboard 系消息的消费方是 iframe 内应用层监听器(09_events_init.js),bridge 只做
        // 协议转换:新信封归一化为旧格式后回投同窗口一次,应用层按 source=nexora-host 接收。
        // 回投仅限新信封来源,归一化产物本身无 protocol 字段,天然不会二次回投。
        if (type === DASHBOARD_OPEN_TAB_TYPE || type === DASHBOARD_OPEN_STUDIO_TYPE || type === DASHBOARD_LAYOUT_TYPE) {
            if (isV1Envelope) {
                window.postMessage(src, '*');
            }
            return;
        }

        if (type === LAYOUT_TYPE) {
            const nextCollapse = !!src.sidebar_auto_collapse;
            const firstLayout = !hasHostLayoutState;
            const changed = hostSidebarAutoCollapse !== nextCollapse;

            hasHostLayoutState = true;
            hostSidebarAutoCollapse = nextCollapse;
            syncHeroBodyVisibility();

            // 宿主每次 STATE 同步都会回发 LAYOUT，但布局未变化时不向应用层派发，
            // 避免 layout 监听触发 renderLectureDetail 整页重建（闪烁 + 滚动位置丢失）
            if (firstLayout || changed) {
                emitLayoutStateChange();
            }

            scheduleSync(0);
            return;
        }

        if (type !== ACTION_TYPE) {
            return;
        }

        const action = String(src.action || '').trim().toLowerCase();
        const lectureId = String(src.lecture_id || '').trim();

        if (action === 'toggle-learning') {
            handleToggleLearning(lectureId);
            return;
        }

        if (action === 'start-learning-path') {
            handleStartLearningPath(lectureId);
            return;
        }

        if (action === 'switch-tab') {
            handleSwitchTab(src.tab);
        }
    }

    function emitHostPayload(payload) {
        window.dispatchEvent(new CustomEvent(payload.type, { detail: payload }));

        if (window.parent) {
            window.parent.postMessage(payload, '*');
        }
    }

    function emitPointerPayload() {
        emitHostPayload({
            source: LEARNING_SOURCE,
            type: POINTER_TYPE,
        });
    }

    function syncNow(force) {
        syncHeroBodyVisibility();
        const payload = readSnapshot();
        const payloadKey = JSON.stringify(payload);

        if (!force && payloadKey === lastPayloadKey) {
            return;
        }

        lastPayloadKey = payloadKey;
        emitHostPayload(payload);

        if (payload.activation === 'user') {
            pendingUserOpenLectureId = '';
        }
    }

    function handleUserCourseOpen(event) {
        const detail = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
        const lectureId = normalizeText(detail.lecture_id || detail.lectureId || '');

        if (!lectureId) return;

        pendingUserOpenLectureId = lectureId;
        syncNow(true);
    }

    function scheduleSync(delay) {
        if (syncTimer) {
            window.clearTimeout(syncTimer);
        }

        syncTimer = window.setTimeout(() => {
            syncTimer = null;
            syncNow(false);
        }, Number.isFinite(Number(delay)) ? Number(delay) : 80);
    }

    function bindDomObservers() {
        if (!document.body || typeof MutationObserver !== 'function') {
            return;
        }

        const observer = new MutationObserver(() => scheduleSync(80));
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'style', 'src', 'srcset', 'data-lecture-id', 'data-lecture-home-id'],
        });
    }

    function bindEvents() {
        window.addEventListener('resize', () => scheduleSync(120));
        window.addEventListener('message', (event) => handleHostAction(event && event.data));
        window.addEventListener(USER_OPEN_TYPE, handleUserCourseOpen);

        document.addEventListener('pointerdown', () => {
            emitPointerPayload();
        }, true);

        document.addEventListener('click', () => {
            scheduleSync(40);
            window.setTimeout(() => scheduleSync(0), 180);
        }, true);
    }

    function init() {
        bindEvents();
        bindDomObservers();
        scheduleSync(0);
    }

    window.NXCourseWorkspaceBridge = {
        readSnapshot,
        hasLayoutState: () => !!hasHostLayoutState,
        isSidebarAutoCollapseLayout: () => !!hostSidebarAutoCollapse,
        sync: () => syncNow(true),
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
