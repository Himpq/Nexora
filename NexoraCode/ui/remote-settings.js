(function () {
    'use strict';
    const status = document.getElementById('remote-status');
    const pair = document.getElementById('remote-pair');
    const toggle = document.getElementById('remote-toggle');
    let enabled = false;
    let busy = false;

    async function refresh(body) {
        if (busy) return;
        busy = true;
        pair.disabled = true;
        toggle.disabled = true;
        try {
            const response = await fetch('/api/local/remote', {
                method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            enabled = data.enabled;
            status.textContent = data.online ? '已连接 · ' + data.name : (data.enabled ? data.error || '正在连接…' : '远程连接已关闭');
            toggle.textContent = enabled ? '关闭远程连接' : '启用远程连接';
            if (!document.getElementById('remote-url').value && data.server_url) document.getElementById('remote-url').value = data.server_url;
            if (body && body.action === 'pair') document.getElementById('remote-code').value = '';
        } catch (error) {
            status.textContent = String(error.message || error);
        } finally {
            busy = false;
            pair.disabled = false;
            toggle.disabled = false;
        }
    }

    pair.addEventListener('click', () => refresh({
        action: 'pair', server_url: document.getElementById('remote-url').value,
        code: document.getElementById('remote-code').value, name: document.getElementById('remote-name').value
    }));
    toggle.addEventListener('click', () => refresh({ action: 'enable', enabled: !enabled }));
    refresh();
    const timer = setInterval(() => refresh(), 5000);
    window.addEventListener('pagehide', () => clearInterval(timer));
})();
