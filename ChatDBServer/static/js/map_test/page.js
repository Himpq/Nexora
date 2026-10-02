import { createGtaMapStyle, ROAD_WIDTH_SCALE } from './style.js';
import { MapDiagnostics } from './diagnostics.js';

/** 独立测试页生命周期，失败明确展示阶段，不切换其他地图服务。 */
class MapStyleLab {
    constructor() {
        this.status = document.querySelector('#status');
        this.map = null;
        this.stage = 'config';
        this.style = 'gta';
        this.roadWidthScale = ROAD_WIDTH_SCALE.DEFAULT;
        this.diagnostics = new MapDiagnostics(document.querySelector('#map'));
    }

    /** 仅使用登录用户的浏览器配置接口，不访问管理员密钥接口。 */
    async start() {
        try {
            const response = await fetch('/api/map/provider', { credentials: 'same-origin' });

            if (response.status === 401 || response.status === 403 || response.redirected) {
                document.querySelector('#login').hidden = false;
                throw new Error('请先登录，再刷新地图测试页。');
            }

            if (!response.ok) {
                throw new Error(`地图配置请求失败（HTTP ${response.status}）。`);
            }

            const data = await response.json();
            const config = data.map_provider?.map_renderer_config;

            if (!data.success || !config?.baiduMapAk || !config.baiduMapVersion) {
                throw new Error('百度浏览器地图配置不完整，请在管理设置中配置。');
            }

            this.stage = 'sdk';
            this.status.textContent = '正在加载百度地图…';
            const sdk = await this.loadSdk(config);
            this.stage = 'map';
            this.diagnostics.assertSize('before-constructor');
            this.map = new sdk.Map('map', { enableMapClick: false });
            this.diagnostics.assertSize('after-constructor');
            this.map.centerAndZoom(new sdk.Point(114.177, 22.287), 14);
            this.applyStyle('gta');
            this.map.enableScrollWheelZoom(true);
            this.map.addControl(new sdk.ScaleControl());
            this.map.addControl(new sdk.ZoomControl());
            const tileTimer = window.setTimeout(() => {
                this.status.dataset.error = 'true';
                this.status.textContent = '地图瓦片尚未就绪，请检查网络、AK 授权及域名白名单。';
                console.error('[MapStyleLab] Tiles timed out', { stage: 'tiles' });
                this.diagnostics.snapshot('tiles-timeout');
            }, 20000);
            this.map.addEventListener('tilesloaded', () => {
                window.clearTimeout(tileTimer);
                try {
                    this.diagnostics.assertSize('tiles-loaded');
                    this.status.dataset.error = 'false';
                    // tilesloaded 仅说明瓦片事件触发，不能证明 WebGL 已成功绘制。
                    this.status.textContent = '瓦片加载完成 · 拖动浏览，或切换原图对比。';
                } catch (error) {
                    this.status.dataset.error = 'true';
                    this.status.textContent = error.message;
                }
            });
            this.bindControls(sdk);
            this.bindRoadWidth();
            this.bindZoomReadout();
            this.status.textContent = '样式已应用，等待地图瓦片加载…';
            console.info('[MapStyleLab] Initialized', { style: 'gta', zoom: 14 });
        } catch (error) {
            this.status.dataset.error = 'true';
            this.status.textContent = error.message;
            console.error('[MapStyleLab] Initialization failed', { stage: this.stage });
        }
    }

    /** 只在 SDK 回调后创建地图；不把含 AK 的 URL 或响应写入日志。 */
    loadSdk(config) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const timer = window.setTimeout(() => finish(new Error('百度 SDK 加载超时，请检查网络和浏览器 AK 的域名白名单。')), 20000);
            const finish = (error) => {
                window.clearTimeout(timer);
                delete window.__mapStyleLabReady;

                if (error) {
                    script.remove();
                    reject(error);
                    return;
                }

                resolve(window.BMapGL);
            };
            window.__mapStyleLabReady = () => {

                if (typeof window.BMapGL?.Map !== 'function') {
                    finish(new Error('百度 SDK 回调后地图构造函数不可用。'));
                    return;
                }

                finish();
            };
            script.onerror = () => finish(new Error('百度 SDK 加载失败，请检查网络。'));
            script.src = `https://api.map.baidu.com/api?type=webgl&v=${encodeURIComponent(config.baiduMapVersion)}&ak=${encodeURIComponent(config.baiduMapAk)}&callback=__mapStyleLabReady`;
            document.head.appendChild(script);
        });
    }

    /** V2 样式必须在 centerAndZoom 后设置；同时管理 POI 显示开关。 */
    applyStyle(style) {
        this.style = style;
        const isGta = style === 'gta';
        const styleJson = isGta ? createGtaMapStyle(this.roadWidthScale) : [];
        this.map.setMapStyleV2({ styleJson });
        this.map.setDisplayOptions({
            // 图标与文字常开：GTA 也必须能读出设施名称，配色交给样式里的 labels 规则。
            poi: true,
            poiIcon: true,
            poiText: true,
            building: !isGta,
            indoor: !isGta,
        });
        console.info('[MapStyleLab] Style applied', {
            style,
            rules: styleJson.length,
            roadWidthScale: this.roadWidthScale,
            poiIconVisible: true,
            poiTextVisible: true,
            zoom: this.map.getZoom(),
        });
    }

    /**
     * 路网粗细滑块。拖动即时重建样式并重新下发，让线宽在当前缩放级别上直接调到位，
     * 不必为了换一个系数改源码再刷新页面。
     */
    bindRoadWidth() {
        const slider = document.querySelector('#road-width');
        const readout = document.querySelector('#road-width-value');
        slider.min = ROAD_WIDTH_SCALE.MIN;
        slider.max = ROAD_WIDTH_SCALE.MAX;
        slider.step = ROAD_WIDTH_SCALE.STEP;
        slider.value = ROAD_WIDTH_SCALE.DEFAULT;
        slider.disabled = false;
        slider.addEventListener('input', () => {
            this.roadWidthScale = Number(slider.value);
            readout.textContent = this.roadWidthScale.toFixed(2);

            if (this.style === 'gta') {
                this.applyStyle('gta');
            }
        });
        readout.textContent = ROAD_WIDTH_SCALE.DEFAULT.toFixed(2);
    }

    /** 缩放级别读数：线宽没有按级别配平的手段，必须让人知道当前处在哪一级。 */
    bindZoomReadout() {
        const readout = document.querySelector('#zoom-readout');

        const refresh = () => {
            readout.textContent = `缩放 z${this.map.getZoom()}`;
        };

        this.map.addEventListener('zoomend', refresh);
        refresh();
    }

    /** 样式切换保留位置和缩放级别，便于比较同一区域。 */
    bindControls(sdk) {
        const buttons = document.querySelectorAll('[data-style]');

        for (const button of buttons) {
            button.disabled = false;
            button.addEventListener('click', () => {
                this.applyStyle(button.dataset.style);

                for (const item of buttons) {
                    item.setAttribute('aria-pressed', String(item === button));
                }

                console.info('[MapStyleLab] Style changed', { style: button.dataset.style });
                this.diagnostics.snapshot('style-changed');
            });
        }

        const reset = document.querySelector('#reset');
        reset.disabled = false;
        reset.addEventListener('click', () => this.map.centerAndZoom(new sdk.Point(114.177, 22.287), 14));
    }
}

void new MapStyleLab().start();
