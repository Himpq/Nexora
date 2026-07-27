(function () {
    'use strict';

    const MAP_SELECTOR = [
        'pre > code.language-nexora-map',
        'pre > code.lang-nexora-map',
        'pre > code.language-nexora-map-ref',
        'pre > code.lang-nexora-map-ref',
        'pre > code.language-json',
        'pre > code.lang-json'
    ].join(',');

    const MAP_KIND = 'nexora-map';
    const MAP_REF_KIND = 'nexora-map-ref';
    const BAIDU_PROVIDER = 'baidu';
    const TIANDITU_PROVIDER = 'tianditu';
    const SUPPORTED_PROVIDERS = new Set([BAIDU_PROVIDER, TIANDITU_PROVIDER]);
    const MIN_ZOOM = 3;
    const MAX_ZOOM = 19;

    let mapSeq = 0;
    let scanTimer = null;
    let baiduLoadPromise = null;
    let tiandituLoadPromise = null;

    const instances = new Map();

    function getRendererConfig() {
        const config = window.NEXORA_MAP_RENDERER_CONFIG;

        if (!config || typeof config !== 'object') {
            return {};
        }

        return config;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readFiniteNumber(value, fieldName) {
        const num = Number(value);

        if (!Number.isFinite(num)) {
            throw new Error(`${fieldName} 必须是有效数字`);
        }

        return num;
    }

    function normalizeCoordinate(value, fieldName) {
        if (Array.isArray(value)) {
            if (value.length < 2) {
                throw new Error(`${fieldName} 必须包含经度和纬度`);
            }

            return {
                lng: readFiniteNumber(value[0], `${fieldName}.lng`),
                lat: readFiniteNumber(value[1], `${fieldName}.lat`)
            };
        }

        if (!value || typeof value !== 'object') {
            throw new Error(`${fieldName} 必须是坐标对象或坐标数组`);
        }

        const lngValue = value.lng ?? value.lon ?? value.longitude;
        const latValue = value.lat ?? value.latitude;

        return {
            lng: readFiniteNumber(lngValue, `${fieldName}.lng`),
            lat: readFiniteNumber(latValue, `${fieldName}.lat`)
        };
    }

    function normalizeZoom(value) {
        if (value === undefined || value === null || value === '') {
            return 11;
        }

        const zoom = readFiniteNumber(value, 'zoom');

        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
            throw new Error(`zoom 必须在 ${MIN_ZOOM}-${MAX_ZOOM} 之间`);
        }

        return zoom;
    }

    function normalizeMarkerLayer(item, fieldName, index) {
        if (!item || typeof item !== 'object') {
            throw new Error(`${fieldName} 必须是对象`);
        }

        const point = normalizeCoordinate(item.point || item.position || item, fieldName);
        const label = String(item.label || item.name || item.title || `标记 ${index + 1}`).trim();

        return {
            id: String(item.id || `marker-${index + 1}`).trim(),
            point,
            label
        };
    }

    function collectMarkerLayers(payload) {
        const markers = [];

        if (Array.isArray(payload.markers)) {
            markers.push(...payload.markers);
        }

        if (Array.isArray(payload.layers)) {
            payload.layers.forEach((layer) => {
                const type = String((layer && layer.type) || '').trim().toLowerCase();

                if (type === 'marker') {
                    markers.push(layer);
                }
            });
        }

        return markers;
    }

    function normalizeMarkers(payload) {
        return collectMarkerLayers(payload).map((item, index) => {
            return normalizeMarkerLayer(item, `markers[${index}]`, index);
        });
    }

    function normalizePolylinePoints(points, fieldName) {
        if (!Array.isArray(points)) {
            throw new Error(`${fieldName}.points 必须是坐标数组`);
        }

        if (points.length < 2) {
            throw new Error(`${fieldName}.points 至少需要两个坐标`);
        }

        return points.map((item, index) => normalizeCoordinate(item, `${fieldName}.points[${index}]`));
    }

    function collectPolylineLayers(payload) {
        const rawPolylines = [];

        if (Array.isArray(payload.polylines)) {
            rawPolylines.push(...payload.polylines);
        }

        if (Array.isArray(payload.routes)) {
            rawPolylines.push(...payload.routes);
        }

        if (Array.isArray(payload.layers)) {
            payload.layers.forEach((layer) => {
                const type = String((layer && layer.type) || '').trim().toLowerCase();

                if (type === 'route' || type === 'polyline' || type === 'line') {
                    rawPolylines.push(layer);
                }
            });
        }

        return rawPolylines;
    }

    function readLayerStyle(item) {
        const style = item && typeof item.style === 'object' ? item.style : {};

        return {
            color: String(style.color || item.color || item.strokeColor || '#2563eb').trim(),
            weight: Number(style.width || style.weight || item.width || item.weight || item.strokeWeight || 5),
            opacity: Number(style.opacity || item.opacity || item.strokeOpacity || 0.82),
            outlineColor: String(style.outlineColor || item.outlineColor || '').trim(),
            outlineWeight: Number(style.outlineWidth || style.outlineWeight || item.outlineWidth || item.outlineWeight || 0)
        };
    }

    function normalizePolylines(payload) {
        return collectPolylineLayers(payload).map((item, index) => {
            if (!item || typeof item !== 'object') {
                throw new Error(`polylines[${index}] 必须是对象`);
            }

            const geometry = item.geometry && typeof item.geometry === 'object' ? item.geometry : {};
            const rawPoints = geometry.points || item.points || item.path || item.coordinates;
            const points = normalizePolylinePoints(rawPoints, `polylines[${index}]`);
            const label = String(item.label || item.name || item.title || `路线 ${index + 1}`).trim();
            const style = readLayerStyle(item);
            const color = style.color;
            const weight = style.weight;
            const opacity = style.opacity;
            const outlineColor = style.outlineColor;
            const outlineWeight = style.outlineWeight;

            if (!Number.isFinite(weight) || weight <= 0) {
                throw new Error(`polylines[${index}].weight 必须是正数`);
            }

            if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
                throw new Error(`polylines[${index}].opacity 必须在 0-1 之间`);
            }

            return {
                id: String(item.id || `polyline-${index + 1}`).trim(),
                points,
                label,
                color,
                weight,
                opacity,
                outlineColor,
                outlineWeight
            };
        });
    }

    function normalizePayload(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('地图 payload 必须是 JSON 对象');
        }

        const provider = String(payload.provider || BAIDU_PROVIDER).trim().toLowerCase();

        if (!SUPPORTED_PROVIDERS.has(provider)) {
            throw new Error(`当前地图渲染器不支持 ${provider}`);
        }

        const markers = normalizeMarkers(payload);
        const polylines = normalizePolylines(payload);
        const viewportPoints = [];

        markers.forEach((marker) => viewportPoints.push(marker.point));
        polylines.forEach((polyline) => viewportPoints.push(...polyline.points));

        const center = payload.center
            ? normalizeCoordinate(payload.center, 'center')
            : viewportPoints[0];

        if (!center) {
            throw new Error('地图 payload 缺少 center 或可渲染坐标');
        }

        return {
            provider,
            title: String(payload.title || payload.name || '地图').trim(),
            subtitle: String(payload.subtitle || payload.description || '').trim(),
            coordinateSystem: String(payload.coordinateSystem || payload.coordType || '').trim(),
            center,
            zoom: normalizeZoom(payload.zoom),
            markers,
            polylines,
            viewportPoints,
            fitViewport: payload.fitViewport !== false && (!payload.viewport || payload.viewport.fitBounds !== false)
        };
    }

    function getCodeLanguage(codeEl) {
        const className = String(codeEl.className || '');
        const matched = className.match(/(?:^|\s)(?:language|lang)-([^\s]+)/);

        return matched ? matched[1].toLowerCase() : '';
    }

    function parseMapPayload(codeEl) {
        const language = getCodeLanguage(codeEl);
        const source = String(codeEl.textContent || '').trim();

        if (!source) {
            return null;
        }

        if (language !== MAP_KIND && language !== MAP_REF_KIND && language !== 'json') {
            return null;
        }

        let payload;

        try {
            payload = JSON.parse(source);
        } catch (error) {
            if (language === MAP_KIND || language === MAP_REF_KIND) {
                throw new Error(`地图 JSON 解析失败：${error.message}`);
            }

            return null;
        }

        if (language === MAP_KIND || language === MAP_REF_KIND) {
            return payload;
        }

        const kind = String(payload.type || payload.kind || payload.renderer || '').trim().toLowerCase();

        return kind === MAP_KIND || kind === MAP_REF_KIND ? payload : null;
    }

    function getCurrentConversationId() {
        const config = getRendererConfig();
        const configuredId = String(config.conversationId || config.conversation_id || '').trim();

        if (configuredId) {
            return configuredId;
        }

        try {
            if (typeof currentConversationId !== 'undefined') {
                return String(currentConversationId || '').trim();
            }
        } catch (error) {
            return '';
        }

        return '';
    }

    function getMapId(payload) {
        return String(
            (payload && (payload.mapId || payload.map_id || payload.renderId || payload.render_id || payload.id)) || ''
        ).trim();
    }

    function getMapConversationId(payload) {
        return String(
            (payload && (payload.conversationId || payload.conversation_id)) || getCurrentConversationId()
        ).trim();
    }

    async function resolveMapPayload(payload) {
        const kind = String((payload && (payload.type || payload.kind || payload.renderer)) || '').trim().toLowerCase();

        if (kind !== MAP_REF_KIND) {
            return payload;
        }

        const mapId = getMapId(payload);
        const conversationId = getMapConversationId(payload);

        if (!conversationId) {
            throw new Error('地图引用缺少 conversationId');
        }

        if (!mapId) {
            throw new Error('地图引用缺少 mapId');
        }

        const response = await fetch(`/api/map/conversations/${encodeURIComponent(conversationId)}/maps/${encodeURIComponent(mapId)}/scene`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data || data.success === false || !data.scene) {
            const message = data && data.message ? data.message : `地图记录读取失败：${response.status}`;
            throw new Error(message);
        }

        return data.scene;
    }

    function createMapShell(payload) {
        const shell = document.createElement('section');
        shell.className = 'nexora-map-card';
        shell.dataset.nexoraMapCard = '1';

        const header = document.createElement('div');
        header.className = 'nexora-map-card-header';

        const title = document.createElement('div');
        title.className = 'nexora-map-card-title';
        title.textContent = String((payload && (payload.title || payload.name)) || '地图');

        const status = document.createElement('div');
        status.className = 'nexora-map-card-status';
        status.textContent = '加载中';

        const body = document.createElement('div');
        body.className = 'nexora-map-card-body';

        const canvas = document.createElement('div');
        canvas.className = 'nexora-map-canvas';
        canvas.id = `nexora-map-canvas-${Date.now()}-${++mapSeq}`;

        const footer = document.createElement('div');
        footer.className = 'nexora-map-card-footer';

        body.appendChild(canvas);
        header.appendChild(title);
        header.appendChild(status);
        shell.appendChild(header);
        shell.appendChild(body);
        shell.appendChild(footer);

        return {
            shell,
            title,
            status,
            body,
            canvas,
            footer
        };
    }

    function setStatus(parts, text, state) {
        parts.status.textContent = text;
        parts.status.classList.toggle('is-ready', state === 'ready');
        parts.status.classList.toggle('is-error', state === 'error');
    }

    function renderFooter(parts, config) {
        const items = [
            `标记 ${config.markers.length}`,
            `线 ${config.polylines.length}`
        ];

        if (config.coordinateSystem) {
            items.push(`坐标 ${config.coordinateSystem}`);
        }

        if (config.subtitle) {
            items.push(config.subtitle);
        }

        parts.footer.replaceChildren(...items.map((item) => {
            const span = document.createElement('span');
            span.textContent = item;
            return span;
        }));
    }

    function renderError(parts, error) {
        parts.body.replaceChildren();

        const errorEl = document.createElement('div');
        errorEl.className = 'nexora-map-card-error';
        errorEl.textContent = error && error.message ? error.message : String(error || '地图渲染失败');

        parts.body.appendChild(errorEl);
        parts.footer.replaceChildren();
        setStatus(parts, '失败', 'error');
    }

    function getBaiduMapAk() {
        const config = getRendererConfig();
        const ak = String(config.baiduMapAk || '').trim();

        if (!ak) {
            throw new Error('NEXORA_MAP_RENDERER_CONFIG.baiduMapAk 未配置');
        }

        return ak;
    }

    function loadBaiduMapGl() {
        if (window.BMapGL) {
            return Promise.resolve(window.BMapGL);
        }

        if (baiduLoadPromise) {
            return baiduLoadPromise;
        }

        baiduLoadPromise = new Promise((resolve, reject) => {
            const ak = getBaiduMapAk();
            const config = getRendererConfig();
            const version = String(config.baiduMapVersion || '1.0').trim();
            const callbackName = `__nexoraBaiduMapCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
            const script = document.createElement('script');

            window[callbackName] = function () {
                delete window[callbackName];

                if (window.BMapGL) {
                    resolve(window.BMapGL);
                    return;
                }

                reject(new Error('百度地图脚本已加载，但 window.BMapGL 不存在'));
            };

            script.src = `https://api.map.baidu.com/api?type=webgl&v=${encodeURIComponent(version)}&ak=${encodeURIComponent(ak)}&callback=${encodeURIComponent(callbackName)}`;
            script.async = true;
            script.onerror = function () {
                delete window[callbackName];
                baiduLoadPromise = null;
                reject(new Error('百度地图 GL JSAPI 脚本加载失败'));
            };

            document.head.appendChild(script);
        });

        return baiduLoadPromise;
    }

    function getTiandituMapTk() {
        const config = getRendererConfig();
        const tk = String(config.tiandituMapTk || '').trim();

        if (!tk) {
            throw new Error('NEXORA_MAP_RENDERER_CONFIG.tiandituMapTk 未配置');
        }

        return tk;
    }

    function loadTiandituMap() {
        if (window.T && window.T.Map && window.T.LngLat) {
            return Promise.resolve(window.T);
        }

        if (tiandituLoadPromise) {
            return tiandituLoadPromise;
        }

        tiandituLoadPromise = new Promise((resolve, reject) => {
            const tk = getTiandituMapTk();
            const config = getRendererConfig();
            const version = String(config.tiandituMapVersion || '4.0').trim();
            const script = document.createElement('script');

            script.src = `https://api.tianditu.gov.cn/api?v=${encodeURIComponent(version)}&tk=${encodeURIComponent(tk)}`;
            script.async = true;
            script.onload = function () {
                if (window.T && window.T.Map && window.T.LngLat) {
                    resolve(window.T);
                    return;
                }

                tiandituLoadPromise = null;
                reject(new Error('天地图 JSAPI 脚本已加载，但 window.T 不存在'));
            };
            script.onerror = function () {
                tiandituLoadPromise = null;
                reject(new Error('天地图 JSAPI 脚本加载失败'));
            };

            document.head.appendChild(script);
        });

        return tiandituLoadPromise;
    }

    function toBaiduPoint(BMapGL, point) {
        return new BMapGL.Point(point.lng, point.lat);
    }

    function addMarker(BMapGL, map, markerConfig) {
        const point = toBaiduPoint(BMapGL, markerConfig.point);
        const marker = new BMapGL.Marker(point);
        const label = new BMapGL.Label(`<span class="nexora-map-label">${escapeHtml(markerConfig.label)}</span>`, {
            offset: new BMapGL.Size(14, -14)
        });

        marker.setLabel(label);
        map.addOverlay(marker);

        return marker;
    }

    function addPolyline(BMapGL, map, polylineConfig) {
        const points = polylineConfig.points.map((point) => toBaiduPoint(BMapGL, point));
        const overlays = [];

        if (polylineConfig.outlineColor && Number.isFinite(polylineConfig.outlineWeight) && polylineConfig.outlineWeight > polylineConfig.weight) {
            const outline = new BMapGL.Polyline(points, {
                strokeColor: polylineConfig.outlineColor,
                strokeWeight: polylineConfig.outlineWeight,
                strokeOpacity: 0.86
            });

            map.addOverlay(outline);
            overlays.push(outline);
        }

        const polyline = new BMapGL.Polyline(points, {
            strokeColor: polylineConfig.color,
            strokeWeight: polylineConfig.weight,
            strokeOpacity: polylineConfig.opacity
        });

        map.addOverlay(polyline);
        overlays.push(polyline);

        return overlays;
    }

    function toTiandituPoint(T, point) {
        return new T.LngLat(point.lng, point.lat);
    }

    function addTiandituMarker(T, map, markerConfig) {
        const point = toTiandituPoint(T, markerConfig.point);
        const marker = new T.Marker(point);
        const labelCls = T.Label || T.DOMLabel;
        const label = new labelCls({
            text: `<span class="nexora-map-label">${escapeHtml(markerConfig.label)}</span>`,
            position: point,
            offset: new T.Point(14, -14)
        });

        map.addOverLay(marker);
        map.addOverLay(label);

        return marker;
    }

    function addTiandituPolyline(T, map, polylineConfig) {
        const points = polylineConfig.points.map((point) => toTiandituPoint(T, point));
        const overlays = [];

        if (polylineConfig.outlineColor && Number.isFinite(polylineConfig.outlineWeight) && polylineConfig.outlineWeight > polylineConfig.weight) {
            const outline = new T.Polyline(points, {
                color: polylineConfig.outlineColor,
                weight: polylineConfig.outlineWeight,
                opacity: 0.86
            });

            map.addOverLay(outline);
            overlays.push(outline);
        }

        const polyline = new T.Polyline(points, {
            color: polylineConfig.color,
            weight: polylineConfig.weight,
            opacity: polylineConfig.opacity
        });

        map.addOverLay(polyline);
        overlays.push(polyline);

        return overlays;
    }

    async function renderBaiduMap(parts, resolvedPayload, config) {
        const BMapGL = await loadBaiduMapGl();
        const center = toBaiduPoint(BMapGL, config.center);
        const map = new BMapGL.Map(parts.canvas.id);

        parts.canvas.dataset.mapProvider = BAIDU_PROVIDER;
        map.centerAndZoom(center, config.zoom);
        map.enableScrollWheelZoom(true);
        map.addControl(new BMapGL.ScaleControl());
        map.addControl(new BMapGL.ZoomControl());

        config.markers.forEach((marker) => addMarker(BMapGL, map, marker));
        config.polylines.forEach((polyline) => addPolyline(BMapGL, map, polyline));

        if (config.fitViewport && config.viewportPoints.length > 1) {
            const viewportPoints = config.viewportPoints.map((point) => toBaiduPoint(BMapGL, point));
            map.setViewport(viewportPoints);
        }

        instances.set(parts.canvas.id, {
            map,
            payload: resolvedPayload,
            config
        });
    }

    async function renderTiandituMap(parts, resolvedPayload, config) {
        const T = await loadTiandituMap();
        const center = toTiandituPoint(T, config.center);
        const map = new T.Map(parts.canvas.id);

        parts.canvas.dataset.mapProvider = TIANDITU_PROVIDER;
        map.centerAndZoom(center, config.zoom);
        map.enableScrollWheelZoom();
        map.addControl(new T.Control.Zoom());
        map.addControl(new T.Control.Scale());

        config.markers.forEach((marker) => addTiandituMarker(T, map, marker));
        config.polylines.forEach((polyline) => addTiandituPolyline(T, map, polyline));

        if (config.fitViewport && config.viewportPoints.length > 1) {
            const viewportPoints = config.viewportPoints.map((point) => toTiandituPoint(T, point));
            map.setViewport(viewportPoints);
        }

        instances.set(parts.canvas.id, {
            map,
            payload: resolvedPayload,
            config
        });
    }

    async function renderMap(parts, payload) {
        try {
            const resolvedPayload = await resolveMapPayload(payload);
            const config = normalizePayload(resolvedPayload);

            parts.title.textContent = config.title;
            renderFooter(parts, config);

            if (config.provider === TIANDITU_PROVIDER) {
                await renderTiandituMap(parts, resolvedPayload, config);
            } else {
                await renderBaiduMap(parts, resolvedPayload, config);
            }

            setStatus(parts, '已渲染', 'ready');
        } catch (error) {
            renderError(parts, error);
        }
    }

    function renderCodeBlock(codeEl) {
        if (!codeEl || codeEl.dataset.nexoraMapProcessed === '1') {
            return;
        }

        let payload = null;

        try {
            payload = parseMapPayload(codeEl);
        } catch (error) {
            codeEl.dataset.nexoraMapProcessed = '1';
            const pre = codeEl.closest('pre');
            const parts = createMapShell({ title: '地图' });
            pre.replaceWith(parts.shell);
            renderError(parts, error);
            return;
        }

        if (!payload) {
            return;
        }

        const pre = codeEl.closest('pre');

        if (!pre || pre.dataset.nexoraMapReplaced === '1') {
            return;
        }

        codeEl.dataset.nexoraMapProcessed = '1';
        pre.dataset.nexoraMapReplaced = '1';

        const parts = createMapShell(payload);
        pre.replaceWith(parts.shell);
        renderMap(parts, payload);
    }

    function scan(root) {
        const base = root && root.querySelectorAll ? root : document;
        const nodes = Array.from(base.querySelectorAll(MAP_SELECTOR));

        nodes.forEach(renderCodeBlock);
    }

    function scheduleScan(root) {
        if (scanTimer) {
            window.clearTimeout(scanTimer);
        }

        scanTimer = window.setTimeout(() => {
            scanTimer = null;
            scan(root || document);
        }, 120);
    }

    function installObserver() {
        const root = document.getElementById('messagesContainer') || document.body;

        scan(root);

        const observer = new MutationObserver(() => scheduleScan(root));
        observer.observe(root, {
            childList: true,
            subtree: true
        });
    }

    function renderPayload(container, payload) {
        if (!container) {
            throw new Error('renderPayload 需要 container');
        }

        const parts = createMapShell(payload);
        container.appendChild(parts.shell);
        renderMap(parts, payload);

        return parts.shell;
    }

    window.NexoraMapRenderer = {
        renderAll: scan,
        renderPayload,
        instances
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installObserver, { once: true });
    } else {
        installObserver();
    }
})();
