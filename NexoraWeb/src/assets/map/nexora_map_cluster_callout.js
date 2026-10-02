import { createMapCalloutShape, createMapSvgElement } from './nexora_map_callout_elements.js';

/** 同一圈中的名称保留原按钮，紧凑放入共同边框，只画一条连接线。 */
export class NexoraMapClusterCallout {
    constructor(svg, pinLayer, cluster, onActive, onFocus) {
        this.key = cluster.key;
        this.members = cluster.items.map((item) => item.entry);
        const leftCount = this.members.filter((entry) => entry.side === 'left').length;
        this.side = leftCount * 2 === this.members.length
            ? this.members[0].side
            : leftCount * 2 > this.members.length ? 'left' : 'right';
        this.list = this.members.find((entry) => entry.side === this.side).list;
        this.button = document.createElement('div');
        this.button.className = 'nexora-map-tag-group';
        this.button.dataset.clusterId = this.key;
        this.button.setAttribute('role', 'group');
        this.button.setAttribute('aria-label', `${this.members.length} 个临近地点，点击名称可放大查看`);
        Object.assign(this, createMapCalloutShape(svg, pinLayer, this.key, true));

        this.point = createMapSvgElement('g', 'nexora-map-callout__cluster');
        this.point.dataset.clusterId = this.key;
        this.circleHalo = createMapSvgElement('circle', 'nexora-map-cluster__halo');
        this.circle = createMapSvgElement('circle', 'nexora-map-cluster__circle');
        this.point.append(this.circleHalo, this.circle);
        pinLayer.append(this.point);
        this.circle.addEventListener('pointerenter', () => onActive(this.members[0].index));
        this.circle.addEventListener('pointerleave', () => onActive(null));
        this.circle.addEventListener('click', () => onFocus(this.members[0]));
    }

    setGeometry(point, radius) {
        this.point.setAttribute('transform', `translate(${point.x} ${point.y})`);
        this.circleHalo.setAttribute('r', String(radius));
        this.circle.setAttribute('r', String(radius));
    }

    setActive(index) {
        const active = this.members.some((entry) => entry.index === index);
        this.button.classList.toggle('is-active', active);
        this.group.classList.toggle('is-active', active);
        this.point.classList.toggle('is-active', active);
    }

    destroy() {
        this.button.remove();
        this.group.remove();
        this.point.remove();
    }
}
