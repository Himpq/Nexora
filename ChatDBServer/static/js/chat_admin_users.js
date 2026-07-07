(function () {
    'use strict';

    const MODULE_NAME = 'adminUsers';

    let adminUsersCache = [];
    let adminSelectedUserId = null;
    let adminUserFilterKeyword = '';
    let currentTargetPermUser = null;
    let adminUserEventsBound = false;

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Admin Users 模块');
        }

        return shared;
    }

    function requireFunction(deps, key) {
        const fn = deps && deps[key];

        if (typeof fn !== 'function') {
            throw new Error(`Chat Admin Users 缺少依赖函数: ${key}`);
        }

        return fn;
    }

    function createAdminUsersController(deps = {}) {
        const escapeHtml = requireFunction(deps, 'escapeHtml');
        const showToast = requireFunction(deps, 'showToast');
        const getCurrentUsername = requireFunction(deps, 'getCurrentUsername');
        const getDefaultAvatarDataUrl = requireFunction(deps, 'getDefaultAvatarDataUrl');
        const isNexoraMailEnabled = requireFunction(deps, 'isNexoraMailEnabled');
        const confirmModalAsync = requireFunction(deps, 'confirmModalAsync');
        const loadAdminStats = requireFunction(deps, 'loadAdminStats');
        const readAdminJsonResponse = requireFunction(deps, 'readAdminJsonResponse');
        const closeAddUserModal = requireFunction(deps, 'closeAddUserModal');

        function getUsersCache() {
            return adminUsersCache;
        }

        function setAdminUserFilterKeyword(value) {
            adminUserFilterKeyword = String(value || '').trim().toLowerCase();
        }

        function resetAdminUserFilterKeyword() {
            adminUserFilterKeyword = '';
        }

        function setSelectedUserId(userId) {
            adminSelectedUserId = String(userId || '').trim() || null;
        }

        async function ensureAdminUsersCache() {
            if (Array.isArray(adminUsersCache) && adminUsersCache.length > 0) return adminUsersCache;

            await loadAdminUsersList({ render: false });
            return adminUsersCache;
        }

        async function loadAdminUsersList(options = {}) {
            const shouldRender = !(options && options.render === false);

            try {
                const res = await fetch('/api/admin/users');
                const data = await res.json();

                if (data.success) {
                    adminUsersCache = Array.isArray(data.users) ? data.users : [];

                    if (!adminSelectedUserId || !adminUsersCache.some((u) => (u.user_id || u.username) === adminSelectedUserId)) {
                        const first = adminUsersCache[0];
                        adminSelectedUserId = first ? (first.user_id || first.username) : null;
                    }

                    if (shouldRender) {
                        renderAdminUsersList();
                        renderAdminUserDetail();
                    }
                }
            } catch (err) {
                console.error('Failed to load users list', err);
            }

            return adminUsersCache;
        }

        function renderAdminUsersList() {
            const usersList = document.getElementById('adminUsersList');

            if (!usersList) return;

            const keyword = adminUserFilterKeyword;
            const filtered = adminUsersCache.filter((user) => {
                if (!keyword) return true;

                const roleText = user.role === 'admin' ? 'admin 管理员' : 'member 普通用户';
                const text = [
                    user.username || '',
                    user.user_id || '',
                    user.last_ip || '',
                    roleText
                ].join(' ').toLowerCase();

                return text.includes(keyword);
            });

            if (filtered.length === 0) {
                usersList.innerHTML = '<div class="admin-user-detail-empty" style="padding:12px;">没有匹配的用户</div>';
                return;
            }

            usersList.innerHTML = filtered.map((user) => {
                const userId = user.user_id || user.username;
                const active = userId === adminSelectedUserId ? 'active' : '';
                const safeId = encodeURIComponent(userId);
                const avatar = user.avatar_url || getDefaultAvatarDataUrl(user.username || userId);

                return `
                    <div class="admin-user-item ${active}" data-admin-user-action="select-user" data-admin-user-id="${escapeHtml(safeId)}">
                        <img class="admin-user-avatar" src="${avatar}" alt="avatar">
                        <div>
                            <div class="admin-user-name">${escapeHtml(user.username || userId)}</div>
                            <div class="admin-user-meta">${escapeHtml(userId)} · ${escapeHtml(user.role || 'member')}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderAdminUserDetail() {
            const detail = document.getElementById('adminUserDetail');

            if (!detail) return;

            const selected = adminUsersCache.find((u) => (u.user_id || u.username) === adminSelectedUserId);

            if (!selected) {
                detail.innerHTML = '<div class="admin-user-detail-empty">请选择左侧用户查看详情</div>';
                return;
            }

            const userId = selected.user_id || selected.username;
            const encodedUserId = encodeURIComponent(userId);
            const isSelf = userId === getCurrentUsername();
            const avatar = selected.avatar_url || getDefaultAvatarDataUrl(selected.username || userId);
            const localMail = selected.local_mail || {};
            const currentMailUsername = (localMail.username || '').trim();
            const currentMailGroup = (localMail.group || 'default').trim() || 'default';
            const currentMailText = currentMailUsername ? `${currentMailUsername} @ ${currentMailGroup}` : '未绑定';
            const createdAt = selected.created_at ? new Date(selected.created_at * 1000).toLocaleString() : '-';
            const lastLogin = selected.last_login ? new Date(selected.last_login * 1000).toLocaleString() : '-';
            const mailBindingHtml = isNexoraMailEnabled() ? `
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>绑定邮箱账户</label>
                        <div class="admin-info-text" style="margin-bottom:8px;">当前: ${escapeHtml(currentMailText)}</div>
                        <div style="display:flex; gap:8px;">
                            <input id="adminDetailMailUsernameInput" class="input-modern" type="text" placeholder="输入邮箱用户名，例如 himpq">
                            <button class="btn-primary-outline btn-compact" type="button" data-admin-mail-action="bind-mail-for-user" data-admin-user-id="${escapeHtml(encodedUserId)}">确认</button>
                        </div>
                    </div>
            ` : '';

            detail.innerHTML = `
                <div class="admin-user-detail-head">
                    <img class="admin-user-avatar" src="${avatar}" alt="avatar">
                    <div>
                        <div class="admin-user-name" style="font-size:16px;">${escapeHtml(selected.username || userId)}</div>
                        <div class="admin-user-meta">ID: ${escapeHtml(userId)}</div>
                    </div>
                </div>
                <div class="admin-user-detail-grid">
                    <div class="form-group">
                        <label>用户名</label>
                        <input id="adminDetailNameInput" class="input-modern" value="${escapeHtml(selected.username || userId)}">
                    </div>
                    <div class="form-group">
                        <label>角色</label>
                        <select id="adminDetailRoleSelect" class="input-modern" ${isSelf ? 'disabled' : ''}>
                            <option value="member" ${selected.role === 'member' ? 'selected' : ''}>member</option>
                            <option value="admin" ${selected.role === 'admin' ? 'selected' : ''}>admin</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>最后登录IP</label>
                        <div class="admin-info-text">${escapeHtml(selected.last_ip || '-')}</div>
                    </div>
                    <div class="form-group">
                        <label>Token 消耗</label>
                        <div class="admin-info-text mono">${(selected.total_token_usage || 0).toLocaleString()}</div>
                    </div>
                    <div class="form-group">
                        <label>创建时间</label>
                        <div class="admin-info-text">${createdAt}</div>
                    </div>
                    <div class="form-group">
                        <label>最后登录</label>
                        <div class="admin-info-text">${lastLogin}</div>
                    </div>
                    ${mailBindingHtml}
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>重置密码</label>
                        <div style="display:flex; gap:8px;">
                            <input id="adminDetailPasswordInput" class="input-modern" type="text" placeholder="输入新密码">
                            <button class="btn-primary-outline btn-compact" type="button" data-admin-user-action="reset-password" data-admin-user-id="${escapeHtml(encodedUserId)}">重置</button>
                        </div>
                    </div>
                </div>
                <div class="admin-user-actions">
                    <button class="btn-primary-outline btn-compact" type="button" data-admin-user-action="open-model-perm" data-admin-user-id="${escapeHtml(encodedUserId)}">模型权限</button>
                    <button class="btn-primary-outline btn-compact" type="button" data-admin-user-action="save-profile" data-admin-user-id="${escapeHtml(encodedUserId)}">保存资料</button>
                    ${!isSelf ? `<button class="btn-danger-small btn-compact" type="button" data-admin-user-action="delete-user" data-admin-user-id="${escapeHtml(encodedUserId)}">删除用户</button>` : ''}
                </div>
            `;
        }

        function selectAdminUser(encodedUserId) {
            adminSelectedUserId = decodeURIComponent(encodedUserId || '');
            renderAdminUsersList();
            renderAdminUserDetail();
        }

        async function submitAddUser() {
            const usernameEl = document.getElementById('formUsername');
            const passwordEl = document.getElementById('formPassword');
            const roleEl = document.getElementById('formRole');
            const username = (usernameEl && usernameEl.value ? usernameEl.value : '').trim();
            const password = (passwordEl && passwordEl.value ? passwordEl.value : '').trim();
            const role = roleEl ? roleEl.value : 'member';

            if (!username || !password) {
                showToast('请输入用户名和密码');
                return;
            }

            try {
                const res = await fetch('/api/admin/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, role })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('用户添加成功');

                    if (usernameEl) usernameEl.value = '';
                    if (passwordEl) passwordEl.value = '';

                    closeAddUserModal();
                    adminSelectedUserId = username;
                    await loadAdminUsersList();
                    await loadAdminStats();
                    return;
                }

                showToast('添加失败: ' + (data.message || '未知错误'));
            } catch (err) {
                showToast('添加用户失败');
            }
        }

        async function openUserModelPerm(username) {
            currentTargetPermUser = username;

            const modal = document.getElementById('modelPermModal');

            if (!modal) return;

            const targetUserSpan = document.getElementById('permTargetUser');

            if (targetUserSpan) targetUserSpan.textContent = username;

            modal.classList.add('active');

            const listContainer = document.getElementById('modelPermList');

            try {
                const res = await fetch(`/api/admin/user/models?username=${encodeURIComponent(username)}`, {
                    headers: { 'Accept': 'application/json' }
                });
                const data = await readAdminJsonResponse(res, '模型权限加载失败');

                if (data.success && listContainer) {
                    listContainer.innerHTML = data.models.map((m) => `
                        <div class="perm-item">
                            <label>
                                <input type="checkbox" class="model-perm-checkbox" data-id="${escapeHtml(m.id || '')}" ${!m.is_blocked ? 'checked' : ''}>
                                <div class="model-info">
                                    <div class="model-name">${escapeHtml(m.name || m.id || '')}</div>
                                    <div class="model-meta">
                                        <span class="model-id">${escapeHtml(m.id || '')}</span>
                                        ${m.provider ? `<span class="provider-badge">${escapeHtml(m.provider)}</span>` : ''}
                                    </div>
                                </div>
                                <span class="status-badge ${!m.is_blocked ? 'status-allowed' : 'status-blocked'}">
                                    ${!m.is_blocked ? '✓ 已开启' : '× 已禁用'}
                                </span>
                            </label>
                        </div>
                    `).join('');
                } else if (listContainer) {
                    listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">${escapeHtml(data.message || data.error || '获取失败')}</div>`;
                }
            } catch (err) {
                if (listContainer) {
                    listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">加载错误: ${escapeHtml(err.message)}</div>`;
                }
            }
        }

        async function saveUserModelPermissions() {
            if (!currentTargetPermUser) return;

            const checkboxes = document.querySelectorAll('.model-perm-checkbox');
            const blockedModels = [];

            checkboxes.forEach((checkbox) => {
                if (!checkbox.checked) {
                    blockedModels.push(checkbox.getAttribute('data-id'));
                }
            });

            try {
                const res = await fetch('/api/admin/user/models/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: currentTargetPermUser,
                        blocked_models: blockedModels
                    })
                });
                const data = await readAdminJsonResponse(res, '模型权限保存失败');

                if (data.success) {
                    closeModelPermModal();

                    if (currentTargetPermUser === getCurrentUsername()) {
                        setTimeout(() => location.reload(), 800);
                    }
                    return;
                }

                showToast('更新失败: ' + (data.message || data.error || '未知错误'));
            } catch (err) {
                showToast('保存时发生错误: ' + err.message);
            }
        }

        function closeModelPermModal() {
            const modal = document.getElementById('modelPermModal');

            if (modal) modal.classList.remove('active');

            currentTargetPermUser = null;
        }

        async function deleteAdminUser(username) {
            if (username === getCurrentUsername()) {
                showToast('你不能删除自己');
                return;
            }

            const ok = await confirmModalAsync('删除用户', `确定要删除用户「${username}」吗？`, 'danger');

            if (!ok) return;

            try {
                const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
                    method: 'DELETE'
                });
                const data = await res.json();

                if (data.success) {
                    showToast('用户已删除');

                    if (adminSelectedUserId === username) {
                        adminSelectedUserId = null;
                    }

                    await loadAdminUsersList();
                    await loadAdminStats();
                    return;
                }

                showToast('删除失败: ' + data.message);
            } catch (err) {
                showToast('网络错误');
            }
        }

        async function changeUserRole(username, newRole) {
            if (username === getCurrentUsername()) {
                showToast('你不能修改自己的权限');
                return;
            }

            const ok = await confirmModalAsync(
                '修改用户权限',
                `确定要将「${username}」修改为${newRole === 'admin' ? '管理员' : '普通用户'}吗？`,
                'primary'
            );

            if (!ok) return;

            try {
                const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/role`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: newRole })
                });
                const data = await res.json();

                if (data.success) {
                    showToast(`已将 ${username} 改为${newRole === 'admin' ? '管理员' : '普通用户'}`);
                    await loadAdminUsersList();
                    await loadAdminStats();
                    return;
                }

                showToast('更新失败: ' + data.message);
            } catch (err) {
                showToast('网络错误');
            }
        }

        async function saveAdminUserProfile(encodedUserId) {
            const userId = decodeURIComponent(encodedUserId || '');
            const nameInput = document.getElementById('adminDetailNameInput');
            const roleSelect = document.getElementById('adminDetailRoleSelect');

            if (!nameInput || !roleSelect) return;

            const displayName = (nameInput.value || '').trim();
            const role = roleSelect.value;

            if (!displayName) {
                showToast('用户名不能为空');
                return;
            }

            try {
                const profileRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/profile`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ display_name: displayName })
                });
                const profileData = await profileRes.json();

                if (!profileData.success) {
                    showToast(profileData.message || '保存失败');
                    return;
                }

                if (userId !== getCurrentUsername()) {
                    const roleRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role })
                    });
                    const roleData = await roleRes.json();

                    if (!roleData.success) {
                        showToast(roleData.message || '角色更新失败');
                        return;
                    }
                }

                showToast('用户资料已保存');
                await loadAdminUsersList();
            } catch (err) {
                showToast('保存失败');
            }
        }

        async function adminResetPassword(encodedUserId) {
            const userId = decodeURIComponent(encodedUserId || '');
            const pwdInput = document.getElementById('adminDetailPasswordInput');

            if (!pwdInput) return;

            const pwd = (pwdInput.value || '').trim();

            if (!pwd) {
                showToast('请输入新密码');
                return;
            }

            try {
                const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pwd })
                });
                const data = await res.json();

                if (!data.success) {
                    showToast(data.message || '重置失败');
                    return;
                }

                showToast('密码已重置');
                pwdInput.value = '';
            } catch (err) {
                showToast('重置失败');
            }
        }

        function bindAdminUserManagementEvents() {
            if (adminUserEventsBound) return;

            adminUserEventsBound = true;

            document.addEventListener('click', (event) => {
                const target = event.target && event.target.closest
                    ? event.target.closest('[data-admin-user-action]')
                    : null;

                if (!target) return;

                const action = String(target.dataset.adminUserAction || '').trim();
                const encodedUserId = target.dataset.adminUserId || '';
                const userId = decodeURIComponent(encodedUserId || '');

                if (!action) return;

                event.preventDefault();

                if (action === 'select-user') {
                    selectAdminUser(encodedUserId);
                    return;
                }

                if (action === 'reset-password') {
                    void adminResetPassword(encodedUserId);
                    return;
                }

                if (action === 'open-model-perm') {
                    void openUserModelPerm(userId);
                    return;
                }

                if (action === 'save-profile') {
                    void saveAdminUserProfile(encodedUserId);
                    return;
                }

                if (action === 'delete-user') {
                    void deleteAdminUser(userId);
                    return;
                }

                if (action === 'close-model-perm') {
                    closeModelPermModal();
                    return;
                }

                if (action === 'save-model-perm') {
                    void saveUserModelPermissions();
                }
            });
        }

        bindAdminUserManagementEvents();

        return {
            getUsersCache,
            setAdminUserFilterKeyword,
            resetAdminUserFilterKeyword,
            setSelectedUserId,
            ensureAdminUsersCache,
            loadAdminUsersList,
            renderAdminUsersList,
            renderAdminUserDetail,
            selectAdminUser,
            submitAddUser,
            openUserModelPerm,
            saveUserModelPermissions,
            closeModelPermModal,
            deleteAdminUser,
            changeUserRole,
            saveAdminUserProfile,
            adminResetPassword,
            bindAdminUserManagementEvents,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        createAdminUsersController,
    });
})();
