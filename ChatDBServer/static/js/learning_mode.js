(function () {
    let sharedWelcomeIframe = null;
    let sharedMainIframe = null;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function ensureSharedIframe(kind, frontendUrl) {
        const useMain = kind === 'main';
        let frame = useMain ? sharedMainIframe : sharedWelcomeIframe;
        if (frame && frame.isConnected) {
            return frame;
        }
        frame = document.createElement('iframe');
        frame.className = 'learning-mode-frame';
        frame.src = String(frontendUrl || '').trim();
        frame.title = 'NexoraLearning';
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        if (useMain) {
            sharedMainIframe = frame;
        } else {
            sharedWelcomeIframe = frame;
        }
        return frame;
    }

    function renderWelcome(container, options = {}) {
        if (!container) return;
        const frontendUrl = String(options.frontendUrl || '').trim();
        container.classList.add('learning-mode-welcome-shell');
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        wrap.appendChild(ensureSharedIframe('welcome', frontendUrl));
    }

    function renderMainPanel(container, options = {}) {
        if (!container) return;
        const frontendUrl = String(options.frontendUrl || '').trim();
        container.innerHTML = '<div class="learning-mode-shell"><div class="learning-mode-frame-wrap"></div></div>';
        const wrap = container.querySelector('.learning-mode-frame-wrap');
        if (!wrap) return;
        wrap.appendChild(ensureSharedIframe('main', frontendUrl));
    }

    function renderSidebarPanel(container, options = {}) {
        if (!container) return;
        const username = String(options.username || '').trim() || '当前用户';
        const role = String(options.role || 'member').trim() || 'member';
        const enabled = !!options.enabled;
        const actionLabel = enabled ? 'New Chat' : 'New Learning';
        container.innerHTML = `
            <div class="learning-sidebar-shell">
                <button type="button" class="btn-primary-outline full-width" data-learning-action="new-learning">${escapeHtml(actionLabel)}</button>
                <div class="learning-sidebar-card">
                    <h3>Learning</h3>
                    <p><span class="learning-sidebar-user">${escapeHtml(username)}</span> 已切换到学习侧栏。</p>
                    <p>点击上方按钮进入学习界面；开启学习模式后，这里会直接使用 NexoraLearning 的学习会话。</p>
                </div>
                <div class="learning-sidebar-card">
                    <h3>当前规划</h3>
                    <ul>
                        <li>保留左侧 Nexora 对话列表切换能力</li>
                        <li>为 Learning 提供独立侧栏状态视图</li>
                        <li>后续接入真实课程 / 教材 / 模型任务状态</li>
                    </ul>
                </div>
                <div class="learning-sidebar-card">
                    <h3>账号信息</h3>
                    <p>角色：${escapeHtml(role)}</p>
                </div>
            </div>
        `;
    }

    window.NexoraLearningMode = {
        renderWelcome,
        renderMainPanel,
        renderSidebarPanel,
    };
})();
