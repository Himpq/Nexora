(function () {
    'use strict';

    const LEARNING_SOURCE = 'nexora-learning';
    const HOST_SOURCE = 'nexora-host';
    const STATE_TYPE = 'nexora:course-workspace:state';
    const ACTION_TYPE = 'nexora:course-workspace:action';
    const LAYOUT_TYPE = 'nexora:course-workspace:layout';
    const POINTER_TYPE = 'nexora:learning-frame:pointerdown';

    let lastPayloadKey = '';
    let lastLectureId = '';
    let lastTitle = '';
    let lastHeroHtml = '';
    let syncTimer = null;
    let hostSidebarAutoCollapse = false;
    let hasHostLayoutState = false;

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
        const learningPathActive = isPaneActive('learningPathView');
        const courseHome = byId('courseHomePane');
        const reader = byId('readerPane');

        return !!(
            learningPathActive
            || (materialsActive && isShown(courseHome))
            || (materialsActive && isShown(reader))
        );
    }

    function readSnapshot() {
        const active = isCourseWorkspaceActive();
        const lectureId = active ? readLectureId() : '';
        const title = active ? readCourseTitle() : '';
        const heroHtml = active ? readHeroHtml() : '';

        return {
            source: LEARNING_SOURCE,
            type: STATE_TYPE,
            active,
            lecture_id: lectureId,
            title,
            hero_html: heroHtml,
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

    function handleHostAction(payload) {
        const src = payload && typeof payload === 'object' ? payload : {};

        if (String(src.source || '').trim().toLowerCase() !== HOST_SOURCE) {
            return;
        }

        const type = String(src.type || '').trim().toLowerCase();

        if (type === LAYOUT_TYPE) {
            hasHostLayoutState = true;
            hostSidebarAutoCollapse = !!src.sidebar_auto_collapse;
            syncHeroBodyVisibility();
            emitLayoutStateChange();
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
