import { NexoraMapCallouts } from './nexora_map_callouts.js';
import { NexoraMapPool } from './nexora_map_pool.js';
import { BAIDU_PROVIDER, isSupportedMapProvider, mountMapProvider, releaseMapProvider } from './nexora_map_providers.js';
import { TOOL_STAGE_OPEN_EVENT, TOOL_STAGE_RESIZE_EVENT } from '@/ui/toolStage';
import './nexora_map_callouts.css';
import './nexora_map_clusters.css';

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
    const MIN_ZOOM = 3;
    const MAX_ZOOM = 19;

    /**
     * 同时存活的地图实例上限。
     *
     * 一张 WebGL 地图实测占用 200MB 以上:
     * 两个名额优先给当前可见和最近离屏的地图,长会话的实例数仍保持常数级。
     */
    const MAX_LIVE_MAPS = 2;

    /** 提前建图距离覆盖一次常见快速滚动,让 iframe 初始化在进入视口前完成。 */
    const MAP_ENTER_MARGIN = '900px 0px';

    let mapSeq = 0;
    let scanTimer = null;

    const instances = new Map();

    function getRendererConfig() {
        const config = window.NEXORA_MAP_RENDERER_CONFIG;

        if (!config || typeof config !== 'object') {
            return {};
        }

        return config;
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

        if (!isSupportedMapProvider(provider)) {
            throw new Error(`当前地图渲染器不支持 ${provider}`);
        }

        const markers = normalizeMarkers(payload);
        const polylines = normalizePolylines(payload);
        const viewportBounds = readViewportBounds(markers, polylines);

        const center = payload.center
            ? normalizeCoordinate(payload.center, 'center')
            : readBoundsCenter(viewportBounds);

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
            viewportBounds,
            fitViewport: payload.fitViewport !== false && (!payload.viewport || payload.viewport.fitBounds !== false)
        };
    }

    /**
     * 只保留外接矩形。
     *
     * 原实现把所有标记点和路线点的引用拼成平铺数组;取景只需要矩形的两个角点,
     * 不必保留额外的引用数组或为取景再次构造全部 SDK 坐标。
     */
    function readViewportBounds(markers, polylines) {
        const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };

        const include = (point) => {
            bounds.west = Math.min(bounds.west, point.lng);
            bounds.east = Math.max(bounds.east, point.lng);
            bounds.south = Math.min(bounds.south, point.lat);
            bounds.north = Math.max(bounds.north, point.lat);
        };

        markers.forEach((marker) => include(marker.point));
        polylines.forEach((polyline) => polyline.points.forEach(include));

        return Number.isFinite(bounds.west) ? bounds : null;
    }

    function readBoundsCenter(bounds) {
        return bounds ? { lng: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 } : null;
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

    async function resolveMapPayload(payload, signal) {
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
            signal,
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

        const body = document.createElement('div');
        body.className = 'nexora-map-card-body';

        const canvas = document.createElement('div');
        canvas.className = 'nexora-map-canvas';
        canvas.id = `nexora-map-canvas-${Date.now()}-${++mapSeq}`;

        const footer = document.createElement('div');
        footer.className = 'nexora-map-card-footer';

        body.append(canvas);
        header.append(title, status);
        shell.append(header, body, footer);

        const parts = { shell, header, title, status, body, canvas, footer };
        const expand = createToolStageButton(parts);

        // 放大入口必须常驻:挂起状态的卡片没有 SDK 实例,但它仍然是可放大的地图结果。
        footer.append(expand);
        setCardState(parts, 'suspended');
        setStatus(parts, '待加载');

        return { ...parts, expand };
    }

    function setStatus(parts, text) {
        parts.status.textContent = text;
        parts.status.classList.remove('is-error');
    }

    /** 卡片状态统一由壳属性驱动:状态标签和占位提示的样式都挂在这一处。 */
    function setCardState(parts, state) {
        parts.shell.dataset.nexoraMapState = state;
    }

    function createToolStageButton(parts) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nexora-map-expand';
        button.title = '放大显示';
        button.setAttribute('aria-label', '放大显示地图');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M9 4H4v5M4 4l6 6M15 20h5v-5m0 5-6-6');
        icon.appendChild(path);
        button.appendChild(icon);

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent(TOOL_STAGE_OPEN_EVENT, {
                detail: {
                    element: parts.shell,
                    title: parts.title.textContent || '地图',
                    controlsTarget: parts.header,
                    trigger: button
                }
            }));
        });

        return button;
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

        const stats = items.map((item) => {
            const span = document.createElement('span');
            span.textContent = item;
            return span;
        });

        parts.footer.replaceChildren(...stats, parts.expand);
    }

    function renderError(parts, error) {
        parts.body.replaceChildren();

        const errorEl = document.createElement('div');
        errorEl.className = 'nexora-map-card-error';
        errorEl.textContent = error && error.message ? error.message : String(error || '地图渲染失败');

        parts.body.appendChild(errorEl);
        parts.footer.replaceChildren();
        parts.status.classList.add('is-error');
        parts.status.textContent = '失败';
        setCardState(parts, 'error');
    }

    /**
     * 挂起态:清掉 SDK 留下的瓦片与控件节点,卡片只保留标题、统计和重新进入视野的提示。
     * canvas 必须清空,否则已销毁实例的 DOM 会一直占着内存。
     */
    function renderSuspended(parts) {
        parts.canvas.replaceChildren();
        parts.body.replaceChildren(parts.canvas);
        parts.body.classList.remove('has-map-callouts');
        parts.footer.append(parts.expand);
        delete parts.canvas.dataset.mapProvider;
        setStatus(parts, '待加载');
        setCardState(parts, 'suspended');
    }

    function bindToolStageResize(parts, map) {
        const resize = () => {
            if (typeof map.checkResize !== 'function') {
                console.warn('[mapRenderer] 当前地图 SDK 未提供 checkResize，容器变化后无法重铺地图');
                return;
            }

            map.checkResize();
        };
        parts.shell.addEventListener(TOOL_STAGE_RESIZE_EVENT, resize);

        return () => parts.shell.removeEventListener(TOOL_STAGE_RESIZE_EVENT, resize);
    }

    /**
     * 按实例预算建图。
     *
     * 只有进入预算的卡片才会走到这里,服务端返回的场景也只在这一轮构建期间存在:
     * 地图引用每次激活都重新拉取,挂起时不保留那份可能很大的对象。
     */
    async function buildLiveMap(entry, { isCurrent, signal, onContextReload }) {
        const { parts, payload } = entry;
        let callouts = null;
        let mounted = null;
        let config = null;

        try {
            const resolvedPayload = await resolveMapPayload(payload, signal);

            if (!isCurrent()) {
                return null;
            }

            config = normalizePayload(resolvedPayload);
            // 上一轮失败会移除 canvas;每次建图先恢复完整容器和放大入口。
            renderSuspended(parts);
            setCardState(parts, 'loading');
            setStatus(parts, '加载中');

            parts.title.textContent = config.title;
            renderFooter(parts, config);
            mounted = await mountMapProvider(
                config.provider,
                getRendererConfig(),
                parts.canvas,
                config,
                isCurrent,
                signal,
                onContextReload
            );

            if (!mounted) {
                renderSuspended(parts);

                return null;
            }

            if (!isCurrent()) {
                releaseMapProvider(config.provider, mounted.map, mounted.frame);
                renderSuspended(parts);

                return null;
            }

            if (config.markers.length > 0) {
                // 标签覆盖地图,不改变 SDK 画布尺寸;首次适配使用完整地图范围。
                callouts = new NexoraMapCallouts(parts.body, parts.canvas, config.markers);
            }

            callouts?.connect(mounted.view);
            setCardState(parts, 'live');

            const live = {
                map: mounted.map,
                frame: mounted.frame,
                parts,
                callouts,
                provider: config.provider,
                unbindResize: bindToolStageResize(parts, mounted.map)
            };

            instances.set(parts.canvas.id, live);
            console.info('[NexoraMapRenderer] Map instance mounted', JSON.stringify({
                canvasId: parts.canvas.id,
                provider: config.provider,
                markers: config.markers.length,
                polylines: config.polylines.length,
                live: instances.size
            }));

            return live;
        } catch (error) {
            callouts?.destroy();

            if (mounted) {
                releaseMapProvider(config.provider, mounted.map, mounted.frame);
            }

            if (isCurrent()) {
                console.error('[NexoraMapRenderer] Map render failed', { message: error.message });
                renderError(parts, error);
            } else {
                renderSuspended(parts);
            }

            return null;
        }
    }

    /**
     * 销毁地图实例。
     *
     * 顺序固定为:标注 → 舞台缩放监听 → SDK 上下文 → 残留 DOM → 实例登记。
     * 少任何一步都会留下事件监听或瓦片节点,地图反复进出视野时内存只增不减。
     */
    function destroyLiveMap(live) {
        if (!live) {
            return;
        }

        live.callouts?.destroy();
        live.unbindResize();
        releaseMapProvider(live.provider, live.map, live.frame);
        instances.delete(live.parts.canvas.id);
        renderSuspended(live.parts);
        console.info('[NexoraMapRenderer] Map instance released', JSON.stringify({
            canvasId: live.parts.canvas.id,
            focused: Boolean(live.parts.shell.closest('.tool-stage-focus__surface')),
            live: instances.size
        }));
    }

    /** 实例预算池:限制地图实例总数,并短暂保留离屏地图以复用上下文。 */
    const pool = new NexoraMapPool({
        maxLive: MAX_LIVE_MAPS,
        enterMargin: MAP_ENTER_MARGIN,
        build: buildLiveMap,
        destroy: destroyLiveMap
    });

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
        pool.attach({ element: parts.shell, parts, payload });
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

        // 会话视图卸载时 messagesContainer 本身可能一起移除,单独监听根节点的删除生命周期。
        const lifecycle = new MutationObserver((records) => {

            if (records.some((record) => record.removedNodes.length > 0)) {
                pool.detachDisconnected();
            }
        });
        lifecycle.observe(document.body, { childList: true, subtree: true });
    }

    function renderPayload(container, payload) {
        if (!container) {
            throw new Error('renderPayload 需要 container');
        }

        const parts = createMapShell(payload);
        container.append(parts.shell);
        pool.attach({ element: parts.shell, parts, payload });

        return parts.shell;
    }

    window.NexoraMapRenderer = {
        renderAll: scan,
        renderPayload,
        instances,
        pool
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installObserver, { once: true });
    } else {
        installObserver();
    }
})();
