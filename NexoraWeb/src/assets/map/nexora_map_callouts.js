import { createMetroCalloutPath, isMapPointVisible } from './nexora_map_callout_geometry.js';
import { createMapCalloutShape, createMapSvgElement } from './nexora_map_callout_elements.js';
import { NexoraMapPointClusters } from './nexora_map_point_clusters.js';
import { NexoraMapClusterCallout } from './nexora_map_cluster_callout.js';

/** 标签集中覆盖在地图上方两角;移动只更新 SVG 属性,不重建地图或聊天内容。 */
export class NexoraMapCallouts {
    constructor(body, canvas, markers) {
        this.body = body;
        this.canvas = canvas;
        this.entries = [];
        this.clusters = new Map();
        this.clusterLayout = '';
        this.pointClusters = new NexoraMapPointClusters();
        this.frame = 0;
        this.inMotion = false;
        this.view = null;
        this.unsubscribe = null;
        this.activeIndex = -1;
        this.selectedIndex = -1;
        this.scheduleDraw = this.scheduleDraw.bind(this);
        this.sizeObserver = new ResizeObserver(this.scheduleDraw);

        this.svg = createMapSvgElement('svg', 'nexora-map-callout-lines');
        this.svg.setAttribute('aria-hidden', 'true');
        // 所有图钉统一放在线条上层,其他标记的线条不会切过图钉。
        this.pinLayer = createMapSvgElement('g', 'nexora-map-callout-pins');
        this.svg.append(this.pinLayer);

        this.left = this.createRail('left');
        this.right = this.createRail('right');
        this.body.classList.add('has-map-callouts');
        this.body.insertBefore(this.left.rail, this.canvas);
        this.body.append(this.right.rail, this.svg);

        // 按经度分两侧、按纬度排上下,地图拖动和缩放时标签顺序保持稳定。
        const ordered = markers.map((marker, index) => ({ marker, index }))
            .sort((left, right) => left.marker.point.lng - right.marker.point.lng || left.index - right.index);
        const midpoint = Math.ceil(ordered.length / 2);
        this.addEntries(ordered.slice(0, midpoint), this.left, 'left');
        this.addEntries(ordered.slice(midpoint), this.right, 'right');
    }

    createRail(side) {
        const rail = document.createElement('aside');
        rail.className = `nexora-map-callout-rail is-${side}`;
        rail.setAttribute('aria-label', `${side === 'left' ? '左' : '右'}侧地图标记`);
        const list = document.createElement('div');
        list.className = 'nexora-map-callout-list';
        list.addEventListener('scroll', this.scheduleDraw, { passive: true });
        rail.append(list);

        return { rail, list };
    }

    /** 每个标签和连接线只创建一次,名称用 textContent 写入。 */
    addEntries(items, rail, side) {
        items.sort((left, right) => right.marker.point.lat - left.marker.point.lat || left.index - right.index);

        items.forEach(({ marker, index }) => {
            const entry = { marker, index, side, list: rail.list, visible: null, cluster: null };
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nexora-map-tag';
            button.disabled = true;
            button.title = marker.label;
            button.dataset.markerId = marker.id;
            button.setAttribute('aria-label', `定位：${marker.label}`);
            button.setAttribute('aria-pressed', 'false');
            const name = document.createElement('span');
            name.className = 'nexora-map-tag__name';
            name.textContent = marker.label;
            button.append(name);
            button.addEventListener('pointerenter', () => this.setActive(index));
            button.addEventListener('pointerleave', () => this.setActive(this.selectedIndex));
            button.addEventListener('focus', () => this.setActive(index));
            button.addEventListener('blur', () => this.setActive(this.selectedIndex));
            button.addEventListener('click', () => this.focusEntry(entry));
            rail.list.append(button);

            const shape = createMapCalloutShape(this.svg, this.pinLayer, marker.id);
            const point = createMapSvgElement('path', 'nexora-map-callout__point');
            // 图钉底尖锚定真实经纬度,避免图标中心与折线落点出现偏移。
            point.setAttribute('d', 'M0 0C-4-6-10-12-10-19a10 10 0 0 1 20 0C10-12 4-6 0 0Z');
            this.pinLayer.append(point);
            Object.assign(entry, shape, { button, point });
            this.entries.push(entry);
        });
    }

    /** SDK 建图完成后接入真实投影与视图事件。 */
    connect(view) {
        this.view = view;
        this.unsubscribe = view.subscribe(this.scheduleDraw, (active) => {
            this.inMotion = active;
        });
        this.entries.forEach((entry) => { entry.button.disabled = false; });
        this.sizeObserver.observe(this.body);
        this.sizeObserver.observe(this.canvas);
        this.sizeObserver.observe(this.left.list);
        this.sizeObserver.observe(this.right.list);
        this.scheduleDraw();
    }

    setActive(index) {
        this.activeIndex = index;
        this.svg.classList.toggle('has-active', index >= 0);

        this.entries.forEach((entry) => {
            const active = entry.index === index;
            entry.button.classList.toggle('is-active', active);
            entry.button.setAttribute('aria-pressed', String(entry.index === this.selectedIndex));
            entry.group.classList.toggle('is-active', active);
            entry.point.classList.toggle('is-active', active);
        });
        this.clusters.forEach((cluster) => cluster.setActive(index));
    }

    /** 首次点击标签时定位并高亮;再次点击只取消高亮,不改变地图视野。 */
    focusEntry(entry) {
        if (this.selectedIndex === entry.index) {
            this.selectedIndex = -1;
            this.setActive(-1);

            return;
        }

        this.selectedIndex = entry.index;
        this.setActive(entry.index);

        if (entry.cluster) {
            this.view.fit(entry.cluster.members.map((member) => member.marker.point));

            return;
        }

        this.view.focus(entry.marker.point);
    }

    /** 仅成员变化时调整标签容器；原按钮复用，普通拖动不会触发 DOM 重排。 */
    updateClusterLayout(groups) {
        const signature = groups.map((group) => group.key).join(';');

        if (signature === this.clusterLayout) {
            return;
        }

        this.clusterLayout = signature;
        const previous = this.clusters;
        const next = new Map();
        const focused = document.activeElement;
        this.entries.forEach((entry) => { entry.cluster = null; });

        groups.forEach((group) => {
            let cluster = previous.get(group.key);

            if (!cluster) {
                cluster = new NexoraMapClusterCallout(
                    this.svg,
                    this.pinLayer,
                    group,
                    (index) => this.setActive(index === null ? this.selectedIndex : index),
                    (entry) => this.focusEntry(entry),
                );
                const members = [...cluster.members].sort((left, right) => right.marker.point.lat - left.marker.point.lat || left.index - right.index);
                cluster.button.append(...members.map((entry) => entry.button));
            }

            cluster.members.forEach((entry) => { entry.cluster = cluster; });
            next.set(group.key, cluster);
        });

        ['left', 'right'].forEach((side) => {
            const singles = this.entries.filter((entry) => !entry.cluster && entry.side === side)
                .map((entry) => ({ node: entry.button, latitude: entry.marker.point.lat, index: entry.index }));
            const grouped = [...next.values()].filter((cluster) => cluster.side === side)
                .map((cluster) => ({ node: cluster.button, latitude: Math.max(...cluster.members.map((entry) => entry.marker.point.lat)), index: cluster.members[0].index }));
            const items = [...singles, ...grouped].sort((left, right) => right.latitude - left.latitude || left.index - right.index);
            this[side].list.append(...items.map((item) => item.node));
        });

        // 按钮移入新容器后再移除旧圈，避免删除仍需复用的标签。
        previous.forEach((cluster, key) => {

            if (!next.has(key)) {
                cluster.destroy();
            }
        });

        this.clusters = next;

        if (this.entries.some((entry) => entry.button === focused)) {
            focused.focus({ preventScroll: true });
        }

        this.setActive(this.activeIndex);
        const groupedPoints = groups.reduce((count, group) => count + group.items.length, 0);
        console.info('[NexoraMapCallouts] Cluster layout changed', { groups: groups.length, groupedPoints, singlePoints: this.entries.length - groupedPoints });
    }

    /** 独立图钉与合并圈共用标签测量、滚动裁切与地铁折线绘制。 */
    drawLine(shape, tag, list, body, point, radius = 0) {
        const showLine = tag.top >= list.top && tag.bottom <= list.bottom;
        shape.halo.style.display = showLine ? '' : 'none';
        shape.line.style.display = showLine ? '' : 'none';

        if (!showLine) {
            return;
        }

        const anchor = {
            x: (shape.side === 'left' ? tag.right : tag.left) - body.left,
            y: tag.top + tag.height / 2 - body.top,
        };
        // 合并线停在圆周，圈内保持空心，不再穿到每个成员的位置。
        const endpoint = { x: point.x + (shape.side === 'left' ? -radius : radius), y: point.y };
        const path = createMetroCalloutPath(anchor, endpoint, shape.side);
        shape.halo.setAttribute('d', path);
        shape.line.setAttribute('d', path);
    }

    /** 移动事件在同一帧合并,每帧只测量一次地图容器。 */
    scheduleDraw() {

        if (this.frame !== 0 || !this.view) {
            return;
        }

        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.draw();

            if (this.inMotion) {
                this.scheduleDraw();
            }
        });
    }

    draw() {
        const body = this.body.getBoundingClientRect();
        const canvas = this.canvas.getBoundingClientRect();

        // 收起聊天时原地图可能暂时没有布局尺寸,不把隐藏容器误判为坐标移出视野。
        if (canvas.width === 0 || canvas.height === 0) {
            return;
        }

        const projected = this.entries.map((entry) => {
            const pixel = this.view.project(entry.marker.point);

            return { entry, pixel, visible: isMapPointVisible(pixel, canvas.width, canvas.height) };
        });
        const groups = this.pointClusters.create(projected);
        this.updateClusterLayout(groups);

        // 成员变化最多排版一次，之后统一读取标签尺寸再更新 SVG。
        const lists = {
            left: this.left.list.getBoundingClientRect(),
            right: this.right.list.getBoundingClientRect(),
        };
        const measured = projected.map((item) => ({
            ...item,
            tag: item.visible && !item.entry.cluster ? item.entry.button.getBoundingClientRect() : null,
            list: lists[item.entry.side],
        }));
        const measuredGroups = groups.map((group) => {
            const entry = this.clusters.get(group.key);

            return { ...group, entry, tag: entry.button.getBoundingClientRect(), list: lists[entry.side] };
        });

        this.svg.setAttribute('viewBox', `0 0 ${body.width} ${body.height}`);
        const changed = { visible: 0, outside: 0 };

        measured.forEach(({ entry, pixel, visible, tag, list }) => {

            if (entry.visible !== visible) {
                entry.visible = visible;
                entry.button.classList.toggle('is-offscreen', !visible);
                entry.button.setAttribute('aria-description', visible ? '标记位于当前地图视野内' : '标记位于当前视野外，点击可定位');
                changed[visible ? 'visible' : 'outside'] += 1;
            }

            const independent = visible && !entry.cluster;
            entry.point.style.display = independent ? '' : 'none';

            if (!independent) {
                entry.halo.style.display = 'none';
                entry.line.style.display = 'none';

                return;
            }

            const point = { x: pixel.x + canvas.left - body.left, y: pixel.y + canvas.top - body.top };
            entry.point.setAttribute('transform', `translate(${point.x} ${point.y})`);

            this.drawLine(entry, tag, list, body, point);
        });

        measuredGroups.forEach(({ entry, center, radius, tag, list }) => {
            const point = { x: center.x + canvas.left - body.left, y: center.y + canvas.top - body.top };
            entry.setGeometry(point, radius);
            this.drawLine(entry, tag, list, body, point, radius);
        });

        // 只记录可见状态变化的数量,不输出地点名称、坐标或每帧日志。
        if (changed.visible || changed.outside) {
            console.info('[NexoraMapCallouts] Viewport visibility changed', changed);
        }
    }

    /** 卡片离开页面时解除 SDK 事件、尺寸观察和待绘制帧。 */
    destroy() {
        this.unsubscribe?.();
        this.inMotion = false;
        this.sizeObserver.disconnect();
        this.left.list.removeEventListener('scroll', this.scheduleDraw);
        this.right.list.removeEventListener('scroll', this.scheduleDraw);

        if (this.frame !== 0) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        }

        this.left.rail.remove();
        this.right.rail.remove();
        this.clusters.forEach((cluster) => cluster.destroy());
        this.clusters.clear();
        this.entries.forEach((entry) => { entry.cluster = null; });
        this.pointClusters.previousGroups.clear();
        this.svg.remove();
        this.body.classList.remove('has-map-callouts');
        this.view = null;
    }
}
