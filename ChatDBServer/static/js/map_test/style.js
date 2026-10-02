/**
 * GTA 风格底图样式，作用于百度个性化地图 V2（Map.setMapStyleV2）。
 *
 * 实测确认的百度个性化地图行为，样式必须逐条接管：
 * 1. weight 是覆盖百度内置线宽的绝对值，必须显式给。road / land 这类"一级兜底层"
 *    不继承 highway、local 的配置，漏配就退回默认暖米色（道路）或默认浅色描边（陆地）。
 * 2. 填充与描边要分开配。只改填充色，描边会保持默认色，省界、国界就是这么漏出来的。
 * 3. Baidu 底图线宽本身随缩放级别快速增长（实测 z15 约 2px，z18 可到 40px），
 *    而 stylers.level 分级在 custom_v2 接口上不生效，weight 只能给一个全局值。
 *    因此线宽无法用公式按级别配平，改由页面上的滑块整体调节。
 * 4. POI 保留图标与文字并配深色描边；纯符号底图好看但不可用，定位设施必须能读出名字。
 */

/** 一条 V2 样式规则；颜色必须是 #RRGGBBAA，末尾 ff 表示完全不透明。 */
const rule = (featureType, elementType, stylers) => ({ featureType, elementType, stylers });

/** 全透明描边；用于抹掉默认描边，不参与实际绘制。 */
const TRANSPARENT = '#00000000';

/** GTA 配色表；主路亮、次路暗，陆地纯黑，使路网成为画面唯一亮部。 */
export const gtaPalette = {
    land: '#0a0a0bff',
    green: '#0d1310ff',
    manmade: '#141416ff',
    water: '#596c81ff',
    local: '#56565aff',
    localStroke: '#1c1c1eff',
    arterial: '#b4b0a8ff',
    arterialStroke: '#35342fff',
    highway: '#d9d5ccff',
    highwayStroke: '#3f3e3aff',
    railway: '#4a4a48ff',
    railwayStroke: '#141414ff',
    poiText: '#c6cad0ff',
    poiTextStroke: '#0a0a0bff',
};

/** 各类道路的线宽基准；整体乘路网粗细系数，由页面滑块调节。 */
const ROAD_WEIGHT = {
    road: 4,
    local: 4,
    arterial: 6,
    highway: 8,
    railway: 5,
};

/** 路网粗细滑块的取值范围与默认值；1 表示直接采用上面的线宽基准。 */
export const ROAD_WIDTH_SCALE = { MIN: 0.3, MAX: 2, STEP: 0.05, DEFAULT: 1 };

/** 需要完全关闭的地名注记元素。 */
const ADMIN_LABELS = ['continent', 'country', 'province', 'city', 'district', 'districtlabel', 'town', 'poiname'];

/** 需要关闭路名注记的道路元素。 */
const ROAD_LABELS = ['road', 'highway', 'arterial', 'local', 'railway', 'subway'];

/** Baidu 缩放级别取值范围；stylers.level 只能落在这个区间内。 */
const MIN_ZOOM = 4;

/**
 * POI 起始显示级别。
 * 低于这个级别时 Baidu 只保留"重要 POI"，剩下的几乎全是政府机关标记，
 * 缩到省级范围就变成满屏红点，既不像 GTA 也没有信息量。
 */
const POI_MIN_ZOOM = 12;

/**
 * 面状元素。visibility 与 color 必须写在同一条规则里：
 * Baidu 对同元素的可见性、颜色、宽度采用"后设置者生效"，拆开写会互相顶掉。
 *
 * 描边一律输出全透明。底图背景元素默认带描边，只改填充色会让描边保持默认浅色，
 * 省界、国界就是这么漏出来的——和一级兜底道路层是同一个坑。
 */
const areaRules = (featureType, color) => [
    rule(featureType, 'geometry', { visibility: 'on', color }),
    rule(featureType, 'geometry.stroke', { color: TRANSPARENT }),
];

/** 关闭某类元素的全部标注，文字与图标一起关。 */
const hideLabelRule = (featureType) => rule(featureType, 'labels', { visibility: 'off' });

/** 生成 [from, to] 闭区间的缩放级别；Baidu 的 stylers.level 不支持区间，只能逐级下发。 */
const zoomLevels = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * POI 标注：图标与文字同时开启。
 * 文字保持 Baidu 按缩放级别自适应的字号，只接管配色；填充用浅灰、描边用深色，
 * 保证文字压在黑色路网上仍可读。fontsize 不做固定，否则低缩放级别会小到无法辨认。
 */
const poiLabelRules = (featureType) => [
    rule(featureType, 'labels', { visibility: 'on' }),
    rule(featureType, 'labels.icon', { visibility: 'on' }),
    rule(featureType, 'labels.text.fill', { color: gtaPalette.poiText }),
    rule(featureType, 'labels.text.stroke', { color: gtaPalette.poiTextStroke }),
];

/** 线状元素；weight 走 geometry，配色走 fill/stroke，与 Baidu 官方编辑器导出结构一致。 */
const roadRules = (featureType, weight, color, stroke) => [
    rule(featureType, 'geometry', { visibility: 'on', weight }),
    rule(featureType, 'geometry.fill', { color }),
    rule(featureType, 'geometry.stroke', { color: stroke }),
];

/** 道路配色表，road 与 local 共用细网配色，避免一级兜底层漏色。 */
const ROAD_COLOR = {
    highway: [gtaPalette.highway, gtaPalette.highwayStroke],
    arterial: [gtaPalette.arterial, gtaPalette.arterialStroke],
    local: [gtaPalette.local, gtaPalette.localStroke],
    road: [gtaPalette.local, gtaPalette.localStroke],
    railway: [gtaPalette.railway, gtaPalette.railwayStroke],
};

/**
 * 生成 GTA 样式规则。
 *
 * roadWidthScale 是路网粗细总系数。weight 没有可推导的换算公式——它同时受百度内置
 * 缩放和级别自身线宽影响，只能由人在当前缩放级别上目视定值，所以暴露成页面滑块，
 * 避免每换一个缩放级别就要改一次源码重新部署。
 */
export const createGtaMapStyle = (roadWidthScale = ROAD_WIDTH_SCALE.DEFAULT) => [
    // 地面：纯黑陆地 + 深灰建成区 + 低饱和蓝灰水域；描边清空以去掉省界与国界。
    ...areaRules('land', gtaPalette.land),
    ...areaRules('green', gtaPalette.green),
    ...areaRules('manmade', gtaPalette.manmade),
    ...areaRules('water', gtaPalette.water),

    // 道路：主干最亮最宽，次干最暗最窄，形成 GTA 的细网质感。
    ...Object.entries(ROAD_COLOR).flatMap(([featureType, [color, stroke]]) => roadRules(
        featureType,
        Math.max(1, Math.round(ROAD_WEIGHT[featureType] * roadWidthScale)),
        color,
        stroke,
    )),

    // GTA 底图不画建筑物、地铁与国界，也不画道路方向箭头。
    rule('building', 'geometry', { visibility: 'off' }),
    rule('subway', 'geometry', { visibility: 'off' }),
    rule('boundary', 'geometry', { visibility: 'off' }),
    rule('roadarrow', 'labels.icon', { visibility: 'off' }),

    // 海域名（渤海/黄海/东海）属于水体注记，不关的话缩小后会浮在纯黑陆地上。
    rule('water', 'labels', { visibility: 'off' }),

    // 路名不画：GTA 底图不留道路文字，避免与 POI 文字抢注意力。
    ...ROAD_LABELS.map(hideLabelRule),

    // 行政地名仍全部关闭，只保留 POI 图标与文字。
    ...ADMIN_LABELS.map(hideLabelRule),

    // POI：图标与文字同时展示，兼顾风格与可用性。
    ...poiLabelRules('poilabel'),

    // POI 按缩放级别逐级关闭：level 是单个级别而非区间，只能一档一档生成。
    ...zoomLevels(MIN_ZOOM, POI_MIN_ZOOM - 1).map(zoom => rule('poilabel', 'labels', { visibility: 'off', level: zoom })),
];