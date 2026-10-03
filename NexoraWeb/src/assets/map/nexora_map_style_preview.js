import { createGtaMapStyle } from '../../../../ChatDBServer/static/js/map_test/style.js';

const MAP_STYLE_PREVIEW_PARAM = 'map-style-preview';

/** 仅在本地开发页通过 URL 参数试用 /test/map 的 GTA 底图样式。 */
export function applyMapStylePreview(map) {
    const enabled = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get(MAP_STYLE_PREVIEW_PARAM) === 'gta';

    if (!enabled) {
        return;
    }

    const styleJson = createGtaMapStyle();
    map.setMapStyleV2({ styleJson });
    map.setDisplayOptions({
        poi: true,
        poiIcon: true,
        poiText: true,
        building: false,
        indoor: false
    });
    console.info('[NexoraMapStylePreview] GTA map style applied', { rules: styleJson.length });
}
