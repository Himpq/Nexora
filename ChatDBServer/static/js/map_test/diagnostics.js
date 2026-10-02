import { gtaPalette } from './style.js';

/** 仅记录布局与画布尺寸，禁止记录地图配置、请求 URL 或密钥。 */
export class MapDiagnostics {
    constructor(container) {
        this.container = container;
        this.contextLost = false;
        this.observeStyleRequests();
        container.addEventListener('webglcontextlost', () => {
            this.contextLost = true;
            this.snapshot('context-lost');
        }, true);
    }

    /** 只观察百度样式转换响应，日志不包含 URL、请求头或 AK。 */
    observeStyleRequests() {
        // XHR 回调里的 this 是请求对象而非诊断实例，样式比对必须提前捕获实例。
        const diagnostics = this;
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            const target = new URL(url, window.location.href);

            if (target.hostname === 'api.map.baidu.com' && /^\/custom\/[^/]+\/mapstyle$/.test(target.pathname)) {
                this.addEventListener('load', () => {
                    let result;

                    try {
                        result = JSON.parse(this.responseText);
                    } catch {
                        console.error('[MapStyleLab] Style response is not JSON', this.status);
                        return;
                    }

                    const styleGroups = result.data?.style;
                    console.info('[MapStyleLab] Style service ' + JSON.stringify({
                        httpStatus: this.status,
                        status: result.status,
                        // parseStyleData 只接受恰好 3 组，否则 SDK 直接丢弃自定义样式退回内置默认。
                        groupCount: Array.isArray(styleGroups) ? styleGroups.length : null,
                        groupSizes: Array.isArray(styleGroups)
                            ? styleGroups.map((group) => (Array.isArray(group) ? group.length : typeof group))
                            : null,
                        missingColors: diagnostics.findMissingColors(JSON.stringify(styleGroups)),
                    }));
                }, { once: true });
            }

            return originalOpen.call(this, method, url, ...args);
        };
    }

    /**
     * 找出百度返回样式中没有出现的配色键。
     * 服务端不认领的规则不会进入响应，缺键即说明该条规则没生效；
     * 颜色字面量直接取自样式表，避免诊断处再写一份色值。
     */
    findMissingColors(styles) {
        const body = (styles || '').toLowerCase();

        return Object.entries(gtaPalette)
            .filter(([, color]) => !body.includes(color.slice(1)))
            .map(([key]) => key);
    }

    /** 对照 SDK 创建前后的尺寸，定位零尺寸容器或渲染缓冲区。 */
    snapshot(stage) {
        const size = {
            width: this.container.clientWidth,
            height: this.container.clientHeight,
            position: getComputedStyle(this.container).position,
            pixelRatio: window.devicePixelRatio,
            contextLost: this.contextLost,
            canvases: Array.from(this.container.querySelectorAll('canvas'), canvas => ({
                width: canvas.width,
                height: canvas.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight,
            })),
        };
        console.info('[MapStyleLab] Rendering dimensions', { stage, ...size });
        return size;
    }

    assertSize(stage) {
        const size = this.snapshot(stage);

        if (size.width <= 0 || size.height <= 0) {
            throw new Error(`地图容器尺寸异常：${size.width} × ${size.height}（${stage}）。`);
        }

        if (this.contextLost) {
            throw new Error('地图 WebGL 上下文已丢失，请提供 Rendering dimensions 日志。');
        }
    }
}
