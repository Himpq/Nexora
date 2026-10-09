import { createGtaMapStyle } from '../../../../ChatDBServer/static/js/map_test/style.js';

/** 按应用当前主题设置百度底图；浅色主题通过空样式恢复 SDK 默认图层。 */
export function applyBaiduMapTheme(map, resolvedTheme) {
    const isDark = resolvedTheme === 'dark';
    const styleJson = isDark ? createGtaMapStyle() : [];

    map.setMapStyleV2({ styleJson });
    map.setDisplayOptions({
        poi: true,
        poiIcon: true,
        poiText: true,
        building: !isDark,
        indoor: !isDark
    });

    console.info('[NexoraMapTheme] Map style updated', {
        theme: resolvedTheme,
        rules: styleJson.length
    });
}
