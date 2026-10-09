import { BaiduMapView, TiandituMapView } from './nexora_map_view.js';
import { loadBaiduMapGl, loadTiandituMap } from './nexora_map_sdk_loader.js';
import { NexoraMapFrame } from './nexora_map_frame.js';
import { theme } from '../../ui/theme';
import { applyBaiduMapTheme } from './nexora_map_theme.js';

export const BAIDU_PROVIDER = 'baidu';
export const TIANDITU_PROVIDER = 'tianditu';

/** 路线描边的不透明度,与原渲染器一致,只用来压住相交处。 */
const OUTLINE_OPACITY = 0.86;

/**
 * 地图 provider 适配层。
 *
 * 两种 SDK 的建图顺序、取景范围一致,释放接口分别由子类实现:
 * 建图顺序统一放在基类的 mount,子类只提供 SDK 自己的调用,新增 provider
 * 不需要再复制一整套渲染流程。
 */
class NexoraMapProvider {
    constructor(name) {
        this.name = name;
    }

    /** 建图流程:实例 → 视野 → 控件 → 覆盖物 → 取景 → 标注投影。 */
    mount(sdk, canvas, config, frame) {
        const map = this.createMap(sdk, canvas.id);

        try {
            canvas.dataset.mapProvider = this.name;
            map.centerAndZoom(this.toPoint(sdk, config.center), config.zoom);
            this.decorate(sdk, map);
            config.polylines.forEach((polyline) => this.addPolyline(sdk, map, polyline, frame));

            if (config.fitViewport && config.viewportBounds) {
                map.setViewport(this.toSdkPoints(sdk, [
                    { lng: config.viewportBounds.west, lat: config.viewportBounds.south },
                    { lng: config.viewportBounds.east, lat: config.viewportBounds.north }
                ], frame));
            }

            return { map, view: this.createView(sdk, map, frame) };
        } catch (error) {
            this.release(map, frame);

            throw error;
        }
    }

    /** 两家 SDK 的地图构造函数同名,基类直接完成实例创建。 */
    createMap(sdk, canvasId) {
        return new sdk.Map(canvasId);
    }

    /** 取景只需要外接矩形的两个角点,不必把全部路线点再复制一份交给 SDK。 */
    toSdkPoints(sdk, positions, frame) {
        const points = positions.map((point) => this.toPoint(sdk, point));

        // SDK 使用 instanceof Array 校验,数组也必须属于地图所在的页面上下文。
        return frame ? frame.host.Array.from(points) : points;
    }

    /** 描边用于压住相交的路线,权重必须大于主线才有意义。 */
    hasOutline(polyline) {
        return !!polyline.outlineColor
            && Number.isFinite(polyline.outlineWeight)
            && polyline.outlineWeight > polyline.weight;
    }
}

class BaiduMapProvider extends NexoraMapProvider {
    constructor() {
        super(BAIDU_PROVIDER);
    }

    /** 浏览器卸载独立页面,同时停止 SDK 请求、定时任务并释放 WebGL。 */
    release(map, frame) {
        frame.destroy();
    }

    toPoint(sdk, position) {
        return new sdk.Point(position.lng, position.lat);
    }

    decorate(sdk, map) {
        map.enableScrollWheelZoom(true);
        map.addControl(new sdk.ScaleControl());
        map.addControl(new sdk.ZoomControl());
        applyBaiduMapTheme(map, theme.resolved);
    }

    addPolyline(sdk, map, polyline, frame) {
        const points = this.toSdkPoints(sdk, polyline.points, frame);

        if (this.hasOutline(polyline)) {
            map.addOverlay(new sdk.Polyline(points, {
                strokeColor: polyline.outlineColor,
                strokeWeight: polyline.outlineWeight,
                strokeOpacity: OUTLINE_OPACITY
            }));
        }

        map.addOverlay(new sdk.Polyline(points, {
            strokeColor: polyline.color,
            strokeWeight: polyline.weight,
            strokeOpacity: polyline.opacity
        }));
    }

    createView(sdk, map, frame) {
        return new BaiduMapView(sdk, map, frame.host);
    }
}

class TiandituMapProvider extends NexoraMapProvider {
    constructor() {
        super(TIANDITU_PROVIDER);
    }

    /** 天地图 4.0 没有公开 destroy;建图前验证实际的生命周期释放接口。 */
    createMap(sdk, canvasId) {
        if (typeof sdk.Map.prototype.Qq !== 'function') {
            throw new Error('天地图 SDK 缺少 4.0 地图释放接口 Qq,请核对 SDK 版本');
        }

        return super.createMap(sdk, canvasId);
    }

    /** 4.0 SDK 的 Qq 解绑容器事件、窗口 resize、交互处理器并卸载所有图层。 */
    release(map) {
        map.clearOverLays();
        map.Qq();
    }

    toPoint(sdk, position) {
        return new sdk.LngLat(position.lng, position.lat);
    }

    decorate(sdk, map) {
        map.enableScrollWheelZoom();
        map.addControl(new sdk.Control.Zoom());
        map.addControl(new sdk.Control.Scale());
    }

    addPolyline(sdk, map, polyline) {
        const points = this.toSdkPoints(sdk, polyline.points);

        if (this.hasOutline(polyline)) {
            map.addOverLay(new sdk.Polyline(points, {
                color: polyline.outlineColor,
                weight: polyline.outlineWeight,
                opacity: OUTLINE_OPACITY
            }));
        }

        map.addOverLay(new sdk.Polyline(points, {
            color: polyline.color,
            weight: polyline.weight,
            opacity: polyline.opacity
        }));
    }

    createView(sdk, map) {
        return new TiandituMapView(sdk, map);
    }
}

const providers = new Map([
    [BAIDU_PROVIDER, new BaiduMapProvider()],
    [TIANDITU_PROVIDER, new TiandituMapProvider()]
]);

export function isSupportedMapProvider(name) {
    return providers.has(name);
}

/** 加载 SDK 并建图,渲染流程因此不需要知道各家的脚本地址与全局命名空间。 */
export async function mountMapProvider(name, rendererConfig, canvas, config, isCurrent, signal, onContextReload) {
    const frame = name === BAIDU_PROVIDER ? new NexoraMapFrame(canvas, onContextReload) : null;

    try {
        const target = frame ? await frame.open(signal) : { host: window, canvas };
        const sdk = name === TIANDITU_PROVIDER
            ? await loadTiandituMap(rendererConfig)
            : await loadBaiduMapGl(rendererConfig, target.host, signal);

        if (!isCurrent()) {
            frame?.destroy();

            return null;
        }

        const mounted = providers.get(name).mount(sdk, target.canvas, config, frame);
        canvas.dataset.mapProvider = name;

        return { ...mounted, frame };
    } catch (error) {
        frame?.destroy();

        throw error;
    }
}

/** 与建图成对使用:释放 SDK 持有的上下文、覆盖物与瓦片缓存。 */
export function releaseMapProvider(name, map, frame) {
    providers.get(name).release(map, frame);
}
