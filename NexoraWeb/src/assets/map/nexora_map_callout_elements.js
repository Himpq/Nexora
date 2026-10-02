const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function createMapSvgElement(tag, className) {
    const element = document.createElementNS(SVG_NAMESPACE, tag);
    element.classList.add(className);

    return element;
}

/** 独立点和合并圈共用同一种折线，所有标记放在折线上层。 */
export function createMapCalloutShape(svg, pinLayer, key, clustered = false) {
    const group = createMapSvgElement('g', 'nexora-map-callout');
    group.dataset[clustered ? 'clusterId' : 'markerId'] = key;
    const halo = createMapSvgElement('path', 'nexora-map-callout__halo');
    const line = createMapSvgElement('path', 'nexora-map-callout__line');
    group.append(halo, line);
    svg.insertBefore(group, pinLayer);

    return { group, halo, line };
}
