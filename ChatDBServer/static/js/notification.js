(function() {
    const API_URL = '/api/notifications';
    const state = {
        items: [],
        unreadCount: 0,
        loading: false,
        loaded: false,
        error: '',
        submittingAnnouncement: false,
        pendingDeleteNotificationId: '',
        adminStateSnapshot: false,
        adminStateObserver: null
    };

    function getElements() {
        return {
            panel: document.getElementById('chatNotificationPopover'),
            toggle: document.getElementById('toggleNotificationPanel'),
            badge: document.getElementById('chatNotificationBadge')
        };
    }

    function getAnnouncementElements() {
        return {
            openBtn: document.getElementById('openAnnouncementModalBtn'),
            modal: document.getElementById('announcementModal'),
            closeBtn: document.getElementById('closeAnnouncementModalBtn'),
            cancelBtn: document.getElementById('cancelAnnouncementModalBtn'),
            submitBtn: document.getElementById('submitAnnouncementBtn'),
            titleInput: document.getElementById('announcementTitleInput'),
            contentInput: document.getElementById('announcementContentInput'),
            levelSelect: document.getElementById('announcementLevelSelect'),
            levelButton: document.getElementById('announcementLevelSelectButton'),
            levelMenu: document.getElementById('announcementLevelSelectMenu')
        };
    }

    function getLevelLabel(level) {
        const normalized = String(level || 'info').trim().toLowerCase();

        if (normalized === 'success') return '完成';
        if (normalized === 'warning') return '提醒';
        if (normalized === 'error') return '重要';

        return '普通';
    }

    function isCurrentUserAdmin() {
        return !!(document.body && document.body.classList.contains('is-admin'));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showNotificationError(message) {
        console.error('[Notification]', message);

        if (typeof window.showToast === 'function') {
            window.showToast(message);
        }
    }

    function updateBadge(count) {
        const elements = getElements();
        const badge = elements.badge;
        const normalized = Number(count || 0);

        if (!badge) return;

        if (normalized <= 0) {
            badge.hidden = true;
            badge.textContent = '';
            return;
        }

        badge.hidden = false;
        badge.textContent = normalized > 99 ? '99+' : String(normalized);
    }

    function formatNotificationTime(value) {
        const numeric = Number(value || 0);

        if (!numeric) return '';

        const timeMs = numeric > 1000000000000 ? numeric : numeric * 1000;
        const date = new Date(timeMs);

        if (Number.isNaN(date.getTime())) return '';

        const diffSeconds = Math.max(0, Math.floor((Date.now() - timeMs) / 1000));

        if (diffSeconds < 60) return '刚刚';
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
        if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)} 天前`;

        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    async function requestJson(url, options) {
        const requestOptions = options || {};
        const headers = Object.assign(
            {'Accept': 'application/json'},
            requestOptions.headers || {}
        );

        const response = await fetch(url, Object.assign({}, requestOptions, {headers}));
        let data = null;

        try {
            data = await response.json();
        } catch (error) {
            throw new Error(`接口返回非 JSON：${response.status}`);
        }

        if (!response.ok || !data || data.success !== true) {
            const message = data && (data.message || data.error)
                ? (data.message || data.error)
                : `请求失败：${response.status}`;
            throw new Error(message);
        }

        return data;
    }

    function getItemId(item) {
        return String(item && item.notification_id ? item.notification_id : '').trim();
    }

    function setUnreadCount(count) {
        const normalized = Math.max(0, Number(count || 0));
        state.unreadCount = Number.isFinite(normalized) ? normalized : 0;
        updateBadge(state.unreadCount);
    }

    function applyNotificationList(items, unreadCount) {
        state.items = Array.isArray(items) ? items : [];
        state.loaded = true;
        state.error = '';
        setUnreadCount(unreadCount);
    }

    function upsertNotificationItem(item) {
        const notificationId = getItemId(item);

        if (!notificationId) {
            console.error('[Notification] notification_created missing notification_id', item);
            return false;
        }

        const nextItem = Object.assign({}, item);
        const existingIndex = state.items.findIndex((row) => getItemId(row) === notificationId);

        if (existingIndex >= 0) {
            state.items = state.items.map((row, index) => index === existingIndex ? nextItem : row);
            return true;
        }

        state.items = [nextItem].concat(state.items).slice(0, 20);
        return true;
    }

    function updateNotificationItem(item) {
        const notificationId = getItemId(item);

        if (!notificationId) {
            console.error('[Notification] notification update missing notification_id', item);
            return false;
        }

        state.items = state.items.map((row) => {
            if (getItemId(row) !== notificationId) return row;

            return Object.assign({}, row, item);
        });
        return true;
    }

    function removeNotificationItem(item) {
        const notificationId = getItemId(item);

        if (!notificationId) {
            console.error('[Notification] notification_removed missing notification_id', item);
            return false;
        }

        state.items = state.items.filter((row) => getItemId(row) !== notificationId);
        return true;
    }

    function renderLevelIcon(level) {
        const normalized = String(level || 'info').toLowerCase();

        if (normalized === 'success') return 'fa-circle-check';
        if (normalized === 'warning') return 'fa-triangle-exclamation';
        if (normalized === 'error') return 'fa-circle-exclamation';

        return 'fa-bell';
    }

    function isPublicNotification(item) {
        const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : {};

        return !!(
            item
            && (
                item.public
                || String(item.scope || '').trim() === 'public'
                || meta.announcement === true
            )
        );
    }

    function renderNotificationItem(item) {
        const notificationId = getItemId(item);
        const title = String(item && item.title ? item.title : '').trim();
        const content = String(item && item.content ? item.content : '').trim();
        const source = String(item && item.source ? item.source : '').trim();
        const timeText = formatNotificationTime(item && item.date);
        const level = String(item && item.level ? item.level : 'info').toLowerCase();
        const itemClass = item && item.read ? 'chat-notification-item is-read' : 'chat-notification-item';
        const metaParts = [source, timeText].filter(Boolean);
        const isPublic = isPublicNotification(item);
        const canRemove = !isPublic || isCurrentUserAdmin();
        const removeLabel = isPublic ? '删除全体公告' : '删除通知';
        const readButtonHtml = item && item.read
            ? ''
            : `
                <button class="chat-notification-action chat-notification-read" type="button" data-notification-action="read" data-notification-id="${escapeHtml(notificationId)}" title="标记已读" aria-label="标记已读">
                    <i class="fa-regular fa-envelope-open" aria-hidden="true"></i>
                </button>
            `;
        const removeButtonHtml = canRemove
            ? `
                <button class="chat-notification-action chat-notification-remove${isPublic ? ' is-public-delete' : ''}" type="button" data-notification-action="remove" data-notification-id="${escapeHtml(notificationId)}" title="${removeLabel}" aria-label="${removeLabel}">
                    <i class="fa-solid ${isPublic ? 'fa-trash-can' : 'fa-xmark'}" aria-hidden="true"></i>
                </button>
            `
            : '';
        const actionsHtml = readButtonHtml || removeButtonHtml
            ? `<div class="chat-notification-actions">${readButtonHtml}${removeButtonHtml}</div>`
            : '<div class="chat-notification-actions" aria-hidden="true"></div>';

        return `
            <article class="${itemClass}" data-notification-id="${escapeHtml(notificationId)}">
                <div class="chat-notification-icon chat-notification-icon-${escapeHtml(level)}">
                    <i class="fa-solid ${escapeHtml(renderLevelIcon(level))}" aria-hidden="true"></i>
                </div>
                <div class="chat-notification-main">
                    <div class="chat-notification-item-title">${escapeHtml(title)}</div>
                    ${content ? `<div class="chat-notification-content">${escapeHtml(content)}</div>` : ''}
                    ${metaParts.length ? `<div class="chat-notification-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
                </div>
                ${actionsHtml}
            </article>
        `;
    }

    function renderPanel() {
        const panel = getElements().panel;

        if (!panel) return;

        let bodyHtml = '';
        const adminActionHtml = isCurrentUserAdmin()
            ? `
                <button class="chat-notification-add" id="openAnnouncementModalBtn" type="button" data-notification-action="announcement" title="设置公告" aria-label="设置公告">
                    <i class="fa-solid fa-plus" aria-hidden="true"></i>
                </button>
            `
            : '';

        if (state.loading && !state.loaded) {
            bodyHtml = '<div class="chat-notification-state">正在加载...</div>';
        } else if (state.error) {
            bodyHtml = `<div class="chat-notification-state chat-notification-state-error">${escapeHtml(state.error)}</div>`;
        } else if (!state.items.length) {
            bodyHtml = '<div class="chat-notification-state">暂无通知</div>';
        } else {
            bodyHtml = `
                <div class="chat-notification-list">
                    ${state.items.map(renderNotificationItem).join('')}
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="chat-notification-header">
                <div>
                    <div class="chat-notification-title">通知</div>
                    <div class="chat-notification-subtitle">${state.unreadCount > 0 ? `${state.unreadCount} 条未读` : '已全部读完'}</div>
                </div>
                ${adminActionHtml}
            </div>
            ${bodyHtml}
        `;
    }

    async function loadNotifications() {
        if (state.loading) return;

        state.loading = true;
        state.error = '';
        renderPanel();

        try {
            const data = await requestJson(`${API_URL}?limit=20`);
            applyNotificationList(data.items, data.unread_count);
        } catch (error) {
            state.error = error && error.message ? error.message : String(error || '通知加载失败');
            showNotificationError(state.error);
        } finally {
            state.loading = false;
            renderPanel();
        }
    }

    async function markNotificationRead(notificationId) {
        const targetId = String(notificationId || '').trim();

        if (!targetId) return;

        const existing = state.items.find((item) => getItemId(item) === targetId);

        if (existing && existing.read) return;

        try {
            const data = await requestJson(`${API_URL}/${encodeURIComponent(targetId)}/read`, {method: 'POST'});
            state.items = state.items.map((item) => {
                if (getItemId(item) !== targetId) return item;

                return Object.assign({}, item, {read: true, read_at: data.item && data.item.read_at});
            });
            setUnreadCount(data.unread_count);
            renderPanel();
        } catch (error) {
            showNotificationError(error && error.message ? error.message : String(error || '通知状态更新失败'));
        }
    }

    async function removeNotification(notificationId) {
        const targetId = String(notificationId || '').trim();

        if (!targetId) {
            return false;
        }

        try {
            const data = await requestJson(`${API_URL}/${encodeURIComponent(targetId)}/remove`, {method: 'POST'});
            state.items = state.items.filter((item) => getItemId(item) !== targetId);
            setUnreadCount(data.unread_count);
            renderPanel();
            return true;
        } catch (error) {
            showNotificationError(error && error.message ? error.message : String(error || '移除通知失败'));
            return false;
        }
    }

    function findNotificationById(notificationId) {
        const targetId = String(notificationId || '').trim();

        if (!targetId) {
            return null;
        }

        return state.items.find((item) => getItemId(item) === targetId) || null;
    }

    function ensureNotificationDeleteModal() {
        let modal = document.getElementById('notificationDeleteModal');

        if (modal) {
            return modal;
        }

        modal = document.createElement('div');
        modal.id = 'notificationDeleteModal';
        modal.className = 'modal-backdrop chat-notification-delete-modal-backdrop';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="modal chat-notification-delete-modal" role="dialog" aria-modal="true" aria-labelledby="notificationDeleteModalTitle">
                <div class="modal-head">
                    <h3 id="notificationDeleteModalTitle">删除通知</h3>
                    <button id="notificationDeleteModalCloseBtn" class="btn-modal-close" type="button" title="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="modal-body chat-notification-delete-body">
                    <p id="notificationDeleteModalText">确认删除这条通知？</p>
                </div>
                <div class="modal-footer chat-notification-delete-footer">
                    <button id="notificationDeleteModalCancelBtn" class="btn-cancel" type="button">取消</button>
                    <button id="notificationDeleteModalConfirmBtn" class="btn-confirm btn-confirm-del" type="button">删除</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        if (typeof window.registerModalBackdropStacking === 'function') {
            window.registerModalBackdropStacking(modal);
        }

        modal.querySelector('#notificationDeleteModalCloseBtn')?.addEventListener('click', closeNotificationDeleteModal);
        modal.querySelector('#notificationDeleteModalCancelBtn')?.addEventListener('click', closeNotificationDeleteModal);
        modal.querySelector('#notificationDeleteModalConfirmBtn')?.addEventListener('click', () => {
            void confirmNotificationDelete();
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeNotificationDeleteModal(event);
            }
        });

        return modal;
    }

    function getNotificationDeleteCopy(item) {
        const isPublic = isPublicNotification(item);
        const fallbackTitle = isPublic ? '这条公告' : '这条通知';
        const title = String(item && item.title ? item.title : fallbackTitle).trim();

        if (isPublic) {
            return {
                title: '删除全体公告',
                text: `确认删除全体公告「${title}」？删除后所有用户都不会再看到这条公告。`,
                confirmLabel: '删除公告'
            };
        }

        return {
            title: '删除通知',
            text: `确认删除通知「${title}」？删除后只会从你的通知列表中移除。`,
            confirmLabel: '删除通知'
        };
    }

    function openNotificationDeleteModal(notificationId) {
        const item = findNotificationById(notificationId);

        if (!item) {
            showNotificationError('通知不存在');
            return;
        }

        const modal = ensureNotificationDeleteModal();
        const modalTitle = modal.querySelector('#notificationDeleteModalTitle');
        const text = modal.querySelector('#notificationDeleteModalText');
        const confirmBtn = modal.querySelector('#notificationDeleteModalConfirmBtn');
        const copy = getNotificationDeleteCopy(item);

        state.pendingDeleteNotificationId = getItemId(item);

        if (modalTitle) {
            modalTitle.textContent = copy.title;
        }

        if (text) {
            text.textContent = copy.text;
        }

        if (confirmBtn) {
            confirmBtn.dataset.confirmLabel = copy.confirmLabel;
            confirmBtn.textContent = copy.confirmLabel;
        }

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');

        if (typeof window.handleBackdropStackingChange === 'function') {
            window.handleBackdropStackingChange(modal);
        }
    }

    function closeNotificationDeleteModal(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const modal = document.getElementById('notificationDeleteModal');

        if (!modal) {
            return;
        }

        state.pendingDeleteNotificationId = '';
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');

        if (typeof window.handleBackdropStackingChange === 'function') {
            window.handleBackdropStackingChange(modal);
        }
    }

    async function confirmNotificationDelete() {
        const notificationId = String(state.pendingDeleteNotificationId || '').trim();
        const modal = ensureNotificationDeleteModal();
        const confirmBtn = modal.querySelector('#notificationDeleteModalConfirmBtn');

        if (!notificationId) {
            closeNotificationDeleteModal();
            return;
        }

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '删除中...';
        }

        try {
            const removed = await removeNotification(notificationId);

            if (removed) {
                closeNotificationDeleteModal();
            }
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = confirmBtn.dataset.confirmLabel || '删除';
            }
        }
    }

    function handleRealtimeNotification(event) {
        const payload = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
        const msgType = String(payload.type || '').trim();
        const item = payload.item && typeof payload.item === 'object' ? payload.item : null;

        if (!item) {
            console.error('[Notification] realtime payload missing item', payload);
            return;
        }

        let changed = false;

        if (msgType === 'notification_created') {
            changed = upsertNotificationItem(item);
        } else if (msgType === 'notification_read') {
            changed = updateNotificationItem(item);
        } else if (msgType === 'notification_removed') {
            changed = removeNotificationItem(item);
        }

        if (!changed) return;

        state.loaded = true;
        state.error = '';
        setUnreadCount(payload.unread_count);
        renderPanel();
    }

    function setOpen(isOpen) {
        const elements = getElements();
        const panel = elements.panel;
        const toggle = elements.toggle;

        if (!panel) return;

        panel.classList.toggle('open', !!isOpen);
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

        if (toggle) {
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }

        if (isOpen) {
            loadNotifications();
        }
    }

    function togglePanel(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const panel = getElements().panel;

        if (!panel) return;

        setOpen(!panel.classList.contains('open'));
    }

    function closeMobileMenu() {
        if (typeof window.closeMobileHeaderMenu === 'function') {
            window.closeMobileHeaderMenu();
        }
    }

    function handlePanelClick(event) {
        const target = event.target;
        const actionButton = target && target.closest ? target.closest('[data-notification-action]') : null;

        if (actionButton) {
            event.preventDefault();
            event.stopPropagation();

            const action = actionButton.getAttribute('data-notification-action');

            if (action === 'announcement') {
                openAnnouncementModal(event);
                return;
            }

            if (action === 'read') {
                markNotificationRead(actionButton.getAttribute('data-notification-id'));
                return;
            }

            if (action === 'remove') {
                openNotificationDeleteModal(actionButton.getAttribute('data-notification-id'));
                return;
            }
        }
    }

    function isAnnouncementModalOpen() {
        const modal = getAnnouncementElements().modal;
        return !!(modal && modal.classList.contains('active'));
    }

    function setAnnouncementLevel(level) {
        const elements = getAnnouncementElements();
        const normalized = ['info', 'success', 'warning', 'error'].includes(String(level || '').trim())
            ? String(level || '').trim()
            : 'info';

        if (elements.levelSelect) {
            elements.levelSelect.value = normalized;
        }

        if (elements.levelButton) {
            const label = elements.levelButton.querySelector('[data-announcement-level-label]');

            if (label) {
                label.textContent = getLevelLabel(normalized);
            }
        }

        if (elements.levelMenu) {
            elements.levelMenu.querySelectorAll('[data-announcement-level-option]').forEach((option) => {
                const selected = String(option.getAttribute('data-value') || '') === normalized;
                option.classList.toggle('active', selected);
                option.setAttribute('aria-selected', selected ? 'true' : 'false');
            });
        }
    }

    function setAnnouncementLevelMenuOpen(open) {
        const elements = getAnnouncementElements();
        const isOpen = !!open;

        if (elements.levelMenu) {
            elements.levelMenu.hidden = !isOpen;
            elements.levelMenu.classList.toggle('open', isOpen);
        }

        if (elements.levelButton) {
            elements.levelButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
    }

    function isNotificationDeleteModalOpen() {
        const modal = document.getElementById('notificationDeleteModal');
        return !!(modal && modal.classList.contains('active'));
    }

    function getActiveNotificationModal() {
        const announcementModal = getAnnouncementElements().modal;
        const deleteModal = document.getElementById('notificationDeleteModal');

        if (announcementModal && announcementModal.classList.contains('active')) {
            return announcementModal;
        }

        if (deleteModal && deleteModal.classList.contains('active')) {
            return deleteModal;
        }

        return null;
    }

    function openAnnouncementModal(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (!isCurrentUserAdmin()) {
            showNotificationError('只有管理员可以发布公告');
            return;
        }

        const elements = getAnnouncementElements();

        if (!elements.modal) return;

        elements.modal.classList.add('active');
        elements.modal.setAttribute('aria-hidden', 'false');
        setAnnouncementLevelMenuOpen(false);
        setAnnouncementLevel(elements.levelSelect && elements.levelSelect.value ? elements.levelSelect.value : 'info');

        if (elements.titleInput) {
            elements.titleInput.focus();
        }
    }

    function closeAnnouncementModal(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const modal = getAnnouncementElements().modal;

        if (!modal) return;

        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }

    function clearAnnouncementForm() {
        const elements = getAnnouncementElements();

        if (elements.titleInput) {
            elements.titleInput.value = '';
        }

        if (elements.contentInput) {
            elements.contentInput.value = '';
        }

        if (elements.levelSelect) {
            elements.levelSelect.value = 'info';
        }

        setAnnouncementLevel('info');
        setAnnouncementLevelMenuOpen(false);
    }

    async function submitAnnouncementDraft(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (state.submittingAnnouncement) return;

        const elements = getAnnouncementElements();
        const title = String(elements.titleInput && elements.titleInput.value ? elements.titleInput.value : '').trim();
        const content = String(elements.contentInput && elements.contentInput.value ? elements.contentInput.value : '').trim();
        const level = String(elements.levelSelect && elements.levelSelect.value ? elements.levelSelect.value : 'info').trim();

        if (!title) {
            showNotificationError('公告标题不能为空');
            return;
        }

        if (!content) {
            showNotificationError('公告内容不能为空');
            return;
        }

        state.submittingAnnouncement = true;

        if (elements.submitBtn) {
            elements.submitBtn.disabled = true;
            elements.submitBtn.textContent = '发布中...';
        }

        try {
            const data = await requestJson(`${API_URL}/announcement`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    title,
                    content,
                    level,
                    source: '管理员公告'
                })
            });

            if (data.item) {
                upsertNotificationItem(data.item);
                setUnreadCount(data.unread_count);
                state.loaded = true;
                state.error = '';
                renderPanel();
            }

            clearAnnouncementForm();
            closeAnnouncementModal();

            if (typeof window.showToast === 'function') {
                window.showToast(`公告已发布给 ${Number(data.target_count || 0)} 个用户`);
            }
        } catch (error) {
            showNotificationError(error && error.message ? error.message : String(error || '公告发布失败'));
        } finally {
            state.submittingAnnouncement = false;

            if (elements.submitBtn) {
                elements.submitBtn.disabled = false;
                elements.submitBtn.textContent = '发布';
            }
        }
    }

    function handleAnnouncementBackdropClick(event) {
        const modal = getAnnouncementElements().modal;

        if (modal && event.target === modal) {
            closeAnnouncementModal(event);
        }
    }

    function initAnnouncementModal() {
        const elements = getAnnouncementElements();

        if (elements.openBtn) {
            elements.openBtn.addEventListener('click', openAnnouncementModal);
        }

        if (elements.closeBtn) {
            elements.closeBtn.addEventListener('click', closeAnnouncementModal);
        }

        if (elements.cancelBtn) {
            elements.cancelBtn.addEventListener('click', closeAnnouncementModal);
        }

        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', submitAnnouncementDraft);
        }

        if (elements.levelButton) {
            elements.levelButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const expanded = elements.levelButton.getAttribute('aria-expanded') === 'true';
                setAnnouncementLevelMenuOpen(!expanded);
            });
        }

        if (elements.levelMenu) {
            elements.levelMenu.addEventListener('click', (event) => {
                const target = event.target;
                const option = target && target.closest ? target.closest('[data-announcement-level-option]') : null;

                if (!option) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                setAnnouncementLevel(option.getAttribute('data-value'));
                setAnnouncementLevelMenuOpen(false);
            });
        }

        if (elements.modal) {
            elements.modal.addEventListener('click', handleAnnouncementBackdropClick);
        }

        setAnnouncementLevel('info');
    }

    function syncAdminState() {
        const nextAdminState = isCurrentUserAdmin();

        if (state.adminStateSnapshot === nextAdminState) {
            return;
        }

        state.adminStateSnapshot = nextAdminState;
        renderPanel();
    }

    function initAdminStateObserver() {
        if (!document.body) {
            return;
        }

        if (state.adminStateObserver) {
            return;
        }

        state.adminStateSnapshot = isCurrentUserAdmin();

        state.adminStateObserver = new MutationObserver(syncAdminState);
        state.adminStateObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    function handleDocumentClick(event) {
        const target = event.target;
        const clickedToggle = target && target.closest ? target.closest('#toggleNotificationPanel') : null;
        const clickedMobileItem = target && target.closest ? target.closest('#mobileNotificationMenuItem') : null;
        const panel = getElements().panel;
        const activeNotificationModal = getActiveNotificationModal();

        if (clickedToggle) {
            togglePanel(event);
            return;
        }

        if (clickedMobileItem) {
            event.preventDefault();
            event.stopPropagation();
            closeMobileMenu();
            setOpen(true);
            return;
        }

        if (activeNotificationModal && activeNotificationModal.contains(target)) {
            const clickedLevelSelect = target && target.closest ? target.closest('[data-announcement-level-select]') : null;

            if (!clickedLevelSelect) {
                setAnnouncementLevelMenuOpen(false);
            }

            return;
        }

        if (isAnnouncementModalOpen()) {
            setAnnouncementLevelMenuOpen(false);
        }

        if (!panel || !panel.classList.contains('open')) return;

        if (!panel.contains(target)) {
            setOpen(false);
        }
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            if (isNotificationDeleteModalOpen()) {
                closeNotificationDeleteModal();
                return;
            }

            if (isAnnouncementModalOpen()) {
                const elements = getAnnouncementElements();

                if (elements.levelButton && elements.levelButton.getAttribute('aria-expanded') === 'true') {
                    setAnnouncementLevelMenuOpen(false);
                    return;
                }

                closeAnnouncementModal(event);
                return;
            }

            setOpen(false);
        }
    }

    function init() {
        const panel = getElements().panel;

        if (panel) {
            panel.addEventListener('click', handlePanelClick);
        }

        initAnnouncementModal();
        initAdminStateObserver();
        renderPanel();
        loadNotifications();
    }

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('nexora:notification:wss', handleRealtimeNotification);

    window.ChatNotificationPanel = {
        open: function() { setOpen(true); },
        close: function() { setOpen(false); },
        toggle: togglePanel,
        reload: loadNotifications
    };

    init();
})();
