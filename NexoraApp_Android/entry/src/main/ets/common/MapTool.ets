// MapTool.ets - 地图工具结果解析
// 与 NexoraWeb stream/toolFlow.ts 对齐：scene 对象 / ```nexora-map 围栏 / map_id 引用
// 三种来源归一成地图卡片数据；工具展示文本剔除 ### Scene 原始段

import { Json } from './JsonUtil';

// 地图类工具名集合（与 Web MAP_TOOL_NAMES 一致）
const MAP_TOOL_NAMES: Set<string> = new Set([
    'map_render',
    'maprenderscene',
    'maprender',
    'map_render_scene',
    'map_calc_distance',
    'mapcalcdistance',
    'map_calc_straight_distance',
    'map_calc_route',
    'mapcalcroute',
    'map_route_plan',
    'map_geocode',
    'mapgeocode',
    'map_poi_search',
    'mappoisearch',
    'map_search_place'
]);

export function isMapToolName(name: string): boolean {
    const compact: string = name.trim().replace(/[\s-]/g, '_').toLowerCase();

    return MAP_TOOL_NAMES.has(compact);
}

// 地图卡片数据：kind=scene 直接渲染；kind=ref 由卡片按 conversationId 拉取 scene
export interface MapCardData {
    kind: string;
    payloadJson: string;
    title: string;
    provider: string;
    coordinateSystem: string;
    markerCount: number;
    polylineCount: number;
}

// 引用载荷：Web 渲染器 map-ref 的同构形态
interface MapRefPayload {
    type: string;
    mapId: string;
    title: string;
}

// 地图结果 ID：对齐 Web readMapResultId 的字段优先级
function readMapResultId(payload: Record<string, Object>): string {
    const keys: string[] = ['map_id', 'mapId', 'render_id', 'renderId', 'record_id', 'recordId'];

    for (let i: number = 0; i < keys.length; i++) {
        const value: string = Json.string(payload, keys[i]).trim();

        if (value.length > 0) {
            return value;
        }
    }

    return '';
}

// 从 markdown 围栏中提取地图 JSON：第一个 ```nexora-map* 围栏
function extractFenceObject(markdown: string): Record<string, Object> | null {
    const start: number = markdown.indexOf('```nexora-map');

    if (start < 0) {
        return null;
    }

    const lineEnd: number = markdown.indexOf('\n', start);

    if (lineEnd < 0) {
        return null;
    }

    const end: number = markdown.indexOf('```', lineEnd);

    if (end < 0) {
        return null;
    }

    return Json.parseObject(markdown.substring(lineEnd + 1, end).trim());
}

function countLayerType(layers: Object[], types: string[]): number {
    let count: number = 0;

    for (let i: number = 0; i < layers.length; i++) {
        const layer: Object = layers[i];

        if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) {
            continue;
        }

        const type: string = Json.string(layer as Record<string, Object>, 'type').trim().toLowerCase();

        if (types.indexOf(type) >= 0) {
            count++;
        }
    }

    return count;
}

// 标记数量：markers 数组 + layers 中 type=marker
function countMarkers(scene: Record<string, Object>): number {
    return Json.array(scene, 'markers').length + countLayerType(Json.array(scene, 'layers'), ['marker']);
}

// 线数量：polylines/routes 数组 + layers 中路线类型
function countPolylines(scene: Record<string, Object>): number {
    return Json.array(scene, 'polylines').length
        + Json.array(scene, 'routes').length
        + countLayerType(Json.array(scene, 'layers'), ['route', 'polyline', 'line']);
}

// scene 对象 → 卡片数据
function buildSceneCard(scene: Record<string, Object>, payloadTitle: string, payloadProvider: string): MapCardData {
    const sceneTitle: string = Json.string(scene, 'title').trim();
    const sceneProvider: string = Json.string(scene, 'provider').trim().toLowerCase();
    const coordinateSystem: string = Json.string(scene, 'coordinateSystem').length > 0
        ? Json.string(scene, 'coordinateSystem')
        : Json.string(scene, 'coordType');
    const title: string = sceneTitle.length > 0 ? sceneTitle : (payloadTitle.trim().length > 0 ? payloadTitle.trim() : '地图');

    return {
        kind: 'scene',
        payloadJson: JSON.stringify(scene),
        title: title,
        provider: sceneProvider.length > 0 ? sceneProvider : payloadProvider.trim().toLowerCase(),
        coordinateSystem: coordinateSystem.trim(),
        markerCount: countMarkers(scene),
        polylineCount: countPolylines(scene)
    };
}

// map-ref 载荷 → 卡片数据（scene 由 MapCard 按 conversationId 拉取）
function buildRefCard(ref: MapRefPayload, payloadTitle: string): MapCardData {
    const title: string = ref.title.trim().length > 0 ? ref.title.trim() : (payloadTitle.trim().length > 0 ? payloadTitle.trim() : '地图');

    return {
        kind: 'ref',
        payloadJson: JSON.stringify(ref),
        title: title,
        provider: '',
        coordinateSystem: '',
        markerCount: 0,
        polylineCount: 0
    };
}

// 拉取到的 scene JSON → 卡片数据（更新标题/标记数/坐标系）
export function readSceneCardData(sceneJson: string, fallbackTitle: string): MapCardData | null {
    const scene: Record<string, Object> | null = Json.parseObject(sceneJson);

    if (scene === null) {
        return null;
    }

    return buildSceneCard(scene, fallbackTitle, '');
}

// 工具结果 JSON → 地图卡片数据；无可用地图时返回 null
export function readMapCardData(rawResult: string): MapCardData | null {
    const payload: Record<string, Object> | null = Json.parseObject(rawResult);

    if (payload === null) {
        return null;
    }

    if (Json.fieldOrNull(payload, 'success') === false) {
        return null;
    }

    const payloadTitle: string = Json.string(payload, 'title');
    const payloadProvider: string = Json.string(payload, 'provider');
    const scene: Record<string, Object> | null = Json.object(payload, 'scene');

    if (scene !== null) {
        return buildSceneCard(scene, payloadTitle, payloadProvider);
    }

    const markdown: string = Json.string(payload, 'markdown');

    if (markdown.length > 0) {
        const fenced: Record<string, Object> | null = extractFenceObject(markdown);

        if (fenced !== null) {
            const kind: string = Json.string(fenced, 'type').trim().toLowerCase();

            if (kind === 'nexora-map-ref') {
                const ref: MapRefPayload = {
                    type: 'nexora-map-ref',
                    mapId: readMapResultId(fenced),
                    title: Json.string(fenced, 'title')
                };

                return buildRefCard(ref, payloadTitle);
            }

            return buildSceneCard(fenced, payloadTitle, payloadProvider);
        }
    }

    const mapId: string = readMapResultId(payload);

    if (mapId.length > 0) {
        const ref: MapRefPayload = {
            type: 'nexora-map-ref',
            mapId: mapId,
            title: payloadTitle
        };

        return buildRefCard(ref, payloadTitle);
    }

    return null;
}

// 去掉结果展示文本的 "### Scene" 段（工具输出面板不展示原始场景 JSON）
export function stripMapSceneSection(markdownText: string): string {
    const source: string = markdownText.trim();
    const marker: string = '### Scene';
    const index: number = source.indexOf(marker);

    if (index < 0) {
        return source;
    }

    const beforeOk: boolean = index === 0 || source.charAt(index - 1) === '\n';
    const afterIndex: number = index + marker.length;
    const afterOk: boolean = afterIndex >= source.length || source.charAt(afterIndex) === '\n';

    if (!beforeOk || !afterOk) {
        return source;
    }

    return source.substring(0, index).trim();
}
