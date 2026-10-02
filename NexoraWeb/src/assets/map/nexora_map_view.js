/** 两种 SDK 统一提供地图容器中的像素坐标,不使用经纬度比例猜测屏幕位置。 */
export class NexoraMapView {
    constructor(map, createPoint, projectPoint, events) {
        this.map = map;
        this.createPoint = createPoint;
        this.projectPoint = projectPoint;
        this.events = events;
    }

    project(point) {
        const pixel = this.projectPoint(this.createPoint(point));

        if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) {
            throw new Error('地图 SDK 未返回有效的容器像素坐标');
        }

        return pixel;
    }

    focus(point) {
        this.map.panTo(this.createPoint(point));
    }

    /** 点击合并圈时让 SDK 放大到成员范围，下一帧按实际点距拆开。 */
    fit(points) {
        this.map.setViewport(points.map((point) => this.createPoint(point)));
    }

    /** SDK 在缩放中间未必逐帧发事件,从开始到结束持续同步真实投影坐标。 */
    subscribe(listener, onMotionChange) {
        const motions = new Set();
        const bindings = this.events.map((event) => [event, listener]);

        ['move', 'zoom'].forEach((motion) => {
            const update = (active) => {

                if (active) {
                    motions.add(motion);
                } else {
                    motions.delete(motion);
                }

                onMotionChange(motions.size > 0);
                listener();
            };
            bindings.push([`${motion}start`, () => update(true)]);
            bindings.push([`${motion}end`, () => update(false)]);
        });

        bindings.forEach(([event, handler]) => this.map.addEventListener(event, handler));

        return () => {
            bindings.forEach(([event, handler]) => this.map.removeEventListener(event, handler));
        };
    }
}

export class BaiduMapView extends NexoraMapView {
    constructor(BMapGL, map) {
        super(
            map,
            (point) => new BMapGL.Point(point.lng, point.lat),
            (point) => map.pointToPixel(point),
            ['moving', 'moveend', 'zoomend', 'resize', 'tilesloaded'],
        );
    }
}

export class TiandituMapView extends NexoraMapView {
    constructor(T, map) {
        super(
            map,
            (point) => new T.LngLat(point.lng, point.lat),
            (point) => map.lngLatToContainerPoint(point),
            ['move', 'moveend', 'zoomend', 'resize', 'load'],
        );
    }
}
