/** 标签连接仅使用水平、垂直和 45 度线段,保留地铁图式折角。 */
export function createMetroCalloutPath(anchor, point, side) {
    const direction = side === 'left' ? 1 : -1;
    const distanceX = Math.abs(point.x - anchor.x);
    const distanceY = point.y - anchor.y;
    const diagonal = Math.min(Math.abs(distanceY), Math.max(0, distanceX - 24));
    const endX = point.x - direction * Math.min(12, distanceX / 2);
    const bendX = endX - direction * diagonal;
    const bendY = anchor.y + Math.sign(distanceY) * diagonal;

    return `M ${anchor.x} ${anchor.y} H ${bendX} L ${endX} ${bendY} V ${point.y} H ${point.x}`;
}

/** 是否仍在地图实际可见范围内,与缩放级别无关,拖动同样会更新此状态。 */
export function isMapPointVisible(point, width, height) {
    return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}
