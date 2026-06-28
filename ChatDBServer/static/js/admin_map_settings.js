(function () {
    'use strict';

    const state = {
        payload: null,
        selectedProvider: ''
    };
    const providerConfigFields = {
        baidu: [
            'browser_ak',
            'browser_version',
            'server_ak',
            'server_sk',
            'auth_mode',
            'timeout',
            'coord_type',
            'ret_coordtype',
            'direction_base_url',
            'geocoding_url',
            'place_search_url'
        ],
        tianditu: [
            'tk',
            'browser_tk',
            'server_tk',
            'browser_version',
            'timeout',
            'coord_type',
            'driving_style',
            'transit_linetype',
            'drive_url',
            'transit_url',
            'geocoding_url',
            'place_search_url'
        ]
    };
    const providerConfigLabels = {
        browser_ak: '前端 AK',
        browser_version: 'JSAPI 版本',
        server_ak: '后端 AK',
        server_sk: '后端 SK',
        auth_mode: '认证模式',
        timeout: '超时秒数',
        coord_type: '坐标系',
        ret_coordtype: '返回坐标系',
        direction_base_url: '路线规划地址',
        geocoding_url: '地理编码地址',
        place_search_url: '地点检索地址',
        tk: '通用 TK',
        browser_tk: '前端 TK',
        server_tk: '后端 TK',
        driving_style: '驾车策略',
        transit_linetype: '公交策略',
        drive_url: '驾车规划地址',
        transit_url: '公交规划地址'
    };
    const fullWidthProviderConfigFields = new Set([
        'direction_base_url',
        'geocoding_url',
        'place_search_url',
        'drive_url',
        'transit_url'
    ]);

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function notify(message) {
        if (typeof window.showToast === 'function') {
            window.showToast(message);
            return;
        }

        console.log(message);
    }

    function readProviderRows() {
        const payload = state.payload || {};
        const providers = payload.providers && typeof payload.providers === 'object' ? payload.providers : {};
        const supported = Array.isArray(payload.supported_providers) ? payload.supported_providers : [];

        return supported.map((provider) => providers[provider]).filter(Boolean);
    }

    function getSelectedProviderRow() {
        const rows = readProviderRows();

        return rows.find((item) => String(item.provider || '') === String(state.selectedProvider || '')) || null;
    }

    function readProviderConfig(row) {
        return row && row.config && typeof row.config === 'object' ? row.config : {};
    }

    function renderProviderConfigField(provider, config, field) {
        const label = providerConfigLabels[field] || field;
        const value = config[field] === undefined || config[field] === null ? '' : String(config[field]);
        const fullWidth = fullWidthProviderConfigFields.has(field) ? ' admin-map-config-field-full' : '';

        if (field === 'auth_mode') {
            const akSelected = value === 'sn' ? '' : 'selected';
            const snSelected = value === 'sn' ? 'selected' : '';

            return `
                <div class="form-group${fullWidth}">
                    <label>${escapeHtml(label)}</label>
                    <select class="input-modern" data-map-config-field="${escapeHtml(field)}">
                        <option value="ak" ${akSelected}>ak</option>
                        <option value="sn" ${snSelected}>sn</option>
                    </select>
                </div>
            `;
        }

        if (field === 'timeout') {
            return `
                <div class="form-group${fullWidth}">
                    <label>${escapeHtml(label)}</label>
                    <input class="input-modern" type="number" min="1" max="120" step="1" value="${escapeHtml(value)}" data-map-config-field="${escapeHtml(field)}">
                </div>
            `;
        }

        return `
            <div class="form-group${fullWidth}">
                <label>${escapeHtml(label)}</label>
                <input class="input-modern" value="${escapeHtml(value)}" data-map-config-field="${escapeHtml(field)}">
            </div>
        `;
    }

    function renderProviderConfigFields(row) {
        const provider = String(row && row.provider ? row.provider : '');
        const fields = providerConfigFields[provider] || [];
        const config = readProviderConfig(row);

        return fields.map((field) => renderProviderConfigField(provider, config, field)).join('');
    }

    function readMapProviderConfigFromDetail(provider) {
        const detailEl = $('adminMapProviderDetail');
        const fields = providerConfigFields[provider] || [];
        const config = {};

        for (const field of fields) {
            const control = detailEl && detailEl.querySelector
                ? detailEl.querySelector(`[data-map-config-field="${field}"]`)
                : null;

            if (!control) {
                throw new Error(`缺少地图 API 配置字段: ${field}`);
            }

            const value = String(control.value || '').trim();

            if (field === 'timeout') {

                if (!/^\d+$/.test(value)) {
                    throw new Error('地图 API timeout 必须是整数');
                }

                const timeoutValue = Number.parseInt(value, 10);

                if (timeoutValue < 1 || timeoutValue > 120) {
                    throw new Error('地图 API timeout 必须在 1 到 120 秒之间');
                }

                config[field] = timeoutValue;
                continue;
            }

            config[field] = value;
        }

        return config;
    }

    function syncMapRendererConfig(payload) {
        const rendererConfig = window.NEXORA_MAP_RENDERER_CONFIG;

        if (!rendererConfig || typeof rendererConfig !== 'object' || !payload || typeof payload !== 'object') {
            return;
        }

        const providers = payload.providers && typeof payload.providers === 'object' ? payload.providers : {};
        const baiduConfig = readProviderConfig(providers.baidu);
        const tiandituConfig = readProviderConfig(providers.tianditu);

        rendererConfig.provider = String(payload.provider || rendererConfig.provider || 'baidu');
        rendererConfig.baiduMapAk = String(baiduConfig.browser_ak || '');
        rendererConfig.baiduMapVersion = String(baiduConfig.browser_version || '1.0');
        rendererConfig.tiandituMapTk = String(tiandituConfig.browser_tk || tiandituConfig.tk || '');
        rendererConfig.tiandituMapVersion = String(tiandituConfig.browser_version || '4.0');
    }

    function setLoading(text) {
        const listEl = $('adminMapProviderList');
        const detailEl = $('adminMapProviderDetail');

        if (listEl) {
            listEl.innerHTML = `<div class="admin-user-detail-empty">${escapeHtml(text || 'Loading...')}</div>`;
        }

        if (detailEl) {
            detailEl.innerHTML = '<div class="admin-user-detail-empty">请选择左侧 Provider 查看详情</div>';
        }
    }

    function renderProviderList() {
        const listEl = $('adminMapProviderList');

        if (!listEl) return;

        const payload = state.payload || {};
        const currentProvider = String(payload.provider || '');
        const rows = readProviderRows();

        if (!rows.length) {
            listEl.innerHTML = '<div class="admin-user-detail-empty">暂无地图 Provider 配置</div>';
            return;
        }

        listEl.innerHTML = rows.map((row) => {
            const provider = String(row.provider || '');
            const active = provider === state.selectedProvider ? 'active' : '';
            const currentBadge = provider === currentProvider
                ? '<span class="model-status-pill ok">默认</span>'
                : '<span class="model-status-pill muted">可选</span>';
            const readyBadge = row.ready
                ? '<span class="model-status-pill ok">配置完整</span>'
                : '<span class="model-status-pill warn">配置缺失</span>';
            const coordType = String(row.coord_type || '-');

            return `
                <div class="admin-user-item ${active}" data-map-provider="${escapeHtml(provider)}">
                    <span class="admin-user-avatar admin-map-provider-icon">
                        <i class="fa-regular fa-map" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name">${escapeHtml(provider)}</div>
                        <div class="admin-user-meta">
                            <span>${escapeHtml(coordType)}</span>
                        </div>
                        <div class="admin-user-meta admin-map-provider-badges">
                            ${currentBadge}
                            ${readyBadge}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderMissingList(row) {
        const missing = Array.isArray(row && row.missing) ? row.missing : [];

        if (!missing.length) {
            return '<div class="admin-info-text admin-map-ok-text">无缺失项</div>';
        }

        return `
            <div class="admin-map-missing-list">
                ${missing.map((item) => `
                    <div class="admin-map-missing-item">
                        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                        <span>${escapeHtml(item)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderHistoryPolicy(payload) {
        const policy = payload && payload.history_policy && typeof payload.history_policy === 'object'
            ? payload.history_policy
            : {};

        return `
            <div class="form-group" style="margin-bottom: 10px;">
                <label>历史记录策略</label>
                <div class="admin-map-policy">
                    <div>${escapeHtml(policy.summary || '历史地图按记录内 provider 渲染，新默认仅影响新地图。')}</div>
                    <div style="margin-top:6px;">${escapeHtml(policy.baidu_records || '')}</div>
                    <div style="margin-top:6px;">${escapeHtml(policy.tianditu_records || '')}</div>
                </div>
            </div>
        `;
    }

    function renderProviderDetail() {
        const detailEl = $('adminMapProviderDetail');

        if (!detailEl) return;

        const payload = state.payload || {};
        const row = getSelectedProviderRow();

        if (!row) {
            detailEl.innerHTML = '<div class="admin-user-detail-empty">请选择左侧 Provider 查看详情</div>';
            return;
        }

        const isCurrent = String(payload.provider || '') === String(row.provider || '');
        const saveAction = '<button class="btn-primary-outline btn-compact" type="button" data-map-save-config="1"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>保存配置</span></button>';
        const switchAction = isCurrent
            ? '<button class="btn-primary-outline btn-compact" type="button" disabled><i class="fa-solid fa-check" aria-hidden="true"></i><span>已是默认</span></button>'
            : `<button class="btn-primary-outline btn-compact" type="button" data-map-switch-provider="${escapeHtml(row.provider)}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>设为默认</span></button>`;

        detailEl.innerHTML = `
            <div class="admin-user-detail-head admin-map-detail-head">
                <div class="admin-map-detail-title">
                    <span class="admin-user-avatar admin-map-provider-icon">
                        <i class="fa-regular fa-map" aria-hidden="true"></i>
                    </span>
                    <div>
                        <div class="admin-user-name" style="font-size:16px;">${escapeHtml(row.provider)}</div>
                        <div class="admin-user-meta">${isCurrent ? '当前默认地图服务' : '可切换地图服务'}</div>
                    </div>
                </div>
                <div class="admin-user-actions admin-map-actions">
                    ${saveAction}
                    ${switchAction}
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 10px;">
                <label>缺失项</label>
                ${renderMissingList(row)}
            </div>
            <div class="admin-map-config-title">接口配置</div>
            <div class="admin-user-detail-grid admin-map-config-grid">
                ${renderProviderConfigFields(row)}
            </div>
            ${renderHistoryPolicy(payload)}
        `;
    }

    function renderConfigErrors() {
        const payload = state.payload || {};
        const errors = Array.isArray(payload.config_errors) ? payload.config_errors : [];
        const detailEl = $('adminMapProviderDetail');

        if (!detailEl || !errors.length) return;

        detailEl.insertAdjacentHTML('afterbegin', `
            <div class="admin-map-config-error">
                ${errors.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}
            </div>
        `);
    }

    function renderMapProviderSettings() {
        const payload = state.payload || {};
        const selectEl = $('adminMapProviderSelect');

        if (!state.selectedProvider) {
            state.selectedProvider = String(payload.provider || '');
        }

        if (selectEl && state.selectedProvider) {
            selectEl.value = String(state.selectedProvider || '');
        }

        renderProviderList();
        renderProviderDetail();
        renderConfigErrors();
    }

    async function loadMapProviderSettings() {
        setLoading('Loading...');

        try {
            const response = await fetch('/api/admin/map/provider', {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json'
                }
            });
            const data = await response.json().catch(() => null);

            if (!response.ok || !data || data.success === false) {
                throw new Error(data && data.message ? data.message : `地图 API 设置读取失败：${response.status}`);
            }

            state.payload = data.map_provider || {};
            state.selectedProvider = String(state.payload.provider || state.selectedProvider || '');
            renderMapProviderSettings();
            syncMapRendererConfig(state.payload);
        } catch (error) {
            const message = error && error.message ? error.message : String(error || '地图 API 设置读取失败');
            setLoading(message);
            notify(message);
        }
    }

    async function saveMapProviderSettings(options = {}) {
        const selectEl = $('adminMapProviderSelect');
        const provider = String(options.provider || state.selectedProvider || (selectEl && selectEl.value ? selectEl.value : '')).trim();
        const setDefault = !!options.setDefault;
        let config = {};

        if (!provider) {
            notify('请选择地图 Provider');
            return;
        }

        try {
            config = readMapProviderConfigFromDetail(provider);
        } catch (error) {
            notify(error && error.message ? error.message : String(error || '地图 API 配置读取失败'));
            return;
        }

        try {
            const failureMessage = setDefault ? '地图 Provider 切换失败' : '地图 API 配置保存失败';
            const response = await fetch('/api/admin/map/provider', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    provider,
                    config,
                    set_default: setDefault
                })
            });
            const data = await response.json().catch(() => null);

            if (!response.ok || !data || data.success === false) {
                state.payload = data && data.map_provider ? data.map_provider : state.payload;
                state.selectedProvider = provider;
                renderMapProviderSettings();
                syncMapRendererConfig(state.payload);
                throw new Error(data && data.message ? data.message : `${failureMessage}：${response.status}`);
            }

            state.payload = data.map_provider || {};
            state.selectedProvider = provider;
            renderMapProviderSettings();
            syncMapRendererConfig(state.payload);

            notify(data.message || '地图 Provider 已保存');
        } catch (error) {
            notify(error && error.message ? error.message : String(error || (setDefault ? '地图 Provider 切换失败' : '地图 API 配置保存失败')));
        }
    }

    function bindEvents() {
        const refreshBtn = $('adminMapProviderRefreshBtn');
        const listEl = $('adminMapProviderList');
        const selectEl = $('adminMapProviderSelect');
        const detailEl = $('adminMapProviderDetail');

        if (refreshBtn && refreshBtn.dataset.bound !== '1') {
            refreshBtn.dataset.bound = '1';
            refreshBtn.addEventListener('click', () => {
                void loadMapProviderSettings();
            });
        }

        if (listEl && listEl.dataset.bound !== '1') {
            listEl.dataset.bound = '1';
            listEl.addEventListener('click', (event) => {
                const item = event.target && event.target.closest
                    ? event.target.closest('[data-map-provider]')
                    : null;

                if (!item) return;

                state.selectedProvider = String(item.dataset.mapProvider || '');
                renderMapProviderSettings();
            });
        }

        if (selectEl && selectEl.dataset.bound !== '1') {
            selectEl.dataset.bound = '1';
            selectEl.addEventListener('change', () => {
                state.selectedProvider = String(selectEl.value || '');
                renderMapProviderSettings();
            });
        }

        if (detailEl && detailEl.dataset.bound !== '1') {
            detailEl.dataset.bound = '1';
            detailEl.addEventListener('click', (event) => {
                const switchBtn = event.target && event.target.closest
                    ? event.target.closest('[data-map-switch-provider]')
                    : null;
                const saveConfigBtn = event.target && event.target.closest
                    ? event.target.closest('[data-map-save-config]')
                    : null;

                if (saveConfigBtn) {
                    void saveMapProviderSettings({ setDefault: false });
                    return;
                }

                if (switchBtn) {
                    const provider = String(switchBtn.dataset.mapSwitchProvider || '');

                    if (selectEl) {
                        selectEl.value = provider;
                    }

                    state.selectedProvider = provider;
                    void saveMapProviderSettings({ provider, setDefault: true });
                    return;
                }
            });
        }

        document.addEventListener('click', (event) => {
            const tab = event.target && event.target.closest
                ? event.target.closest('#settingsModal .admin-tab[data-tab="admin-map"]')
                : null;

            if (tab) {
                window.setTimeout(() => {
                    void loadMapProviderSettings();
                }, 0);
            }
        });
    }

    function init() {
        bindEvents();

        const activeTab = document.querySelector('#settingsModal #settings-admin-map-tab.active');

        if (activeTab) {
            void loadMapProviderSettings();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
