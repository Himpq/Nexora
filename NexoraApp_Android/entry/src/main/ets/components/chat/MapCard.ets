// MapCard.ets - 地图工具结果卡片
// 与 NexoraWeb nexora_map_renderer 对齐：ArkWeb 承载同款 Baidu/天地图 JSAPI 渲染，
// scene 直接注入；map-ref 先用现有 HttpUtil（自动带 Cookie）拉取 scene 再注入

import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { webview } from '@kit.ArkWeb';
import { ApiService, MAP_HTTP_TIMEOUT_MS } from '../../common/ApiService';
import { FontSize, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { Json } from '../../common/JsonUtil';
import { MapRendererConfig } from '../../common/MapRendererConfig';
import { MapCardData, readMapCardData, readSceneCardData } from '../../common/MapTool';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMapCard';

const MAP_HEIGHT: number = 240;
const RENDER_TIMEOUT_MS: number = 30000;
let mapTraceSequence: number = 0;

class MapRenderBridgeCallbacks {
    private readyHandler: () => void;
    private errorHandler: (message: string) => void;
    private progressHandler: (stage: string) => void;

    constructor(
        readyHandler: () => void,
        errorHandler: (message: string) => void,
        progressHandler: (stage: string) => void
    ) {
        this.readyHandler = readyHandler;
        this.errorHandler = errorHandler;
        this.progressHandler = progressHandler;
    }

    markReady(): void {
        setTimeout((): void => {
            this.readyHandler();
        }, 0);
    }

    markError(message: string): void {
        setTimeout((): void => {
            this.errorHandler(message);
        }, 0);
    }

    markProgress(stage: string): void {
        setTimeout((): void => {
            this.progressHandler(stage);
        }, 0);
    }
}

// Keep callback fields outside the JS proxy target; the registered target exposes methods only.
class MapRenderBridge {
    private static callbacks: Map<MapRenderBridge, MapRenderBridgeCallbacks> = new Map();

    bind(
        readyHandler: () => void,
        errorHandler: (message: string) => void,
        progressHandler: (stage: string) => void
    ): void {
        MapRenderBridge.callbacks.set(this,
            new MapRenderBridgeCallbacks(readyHandler, errorHandler, progressHandler));
    }

    release(): void {
        MapRenderBridge.callbacks.delete(this);
    }

    private getCallbacks(): MapRenderBridgeCallbacks | undefined {
        return MapRenderBridge.callbacks.get(this);
    }

    markReady(): void {
        const callbacks: MapRenderBridgeCallbacks | undefined = this.getCallbacks();

        if (callbacks !== undefined) {
            callbacks.markReady();
        }
    }

    markError(message: string): void {
        const callbacks: MapRenderBridgeCallbacks | undefined = this.getCallbacks();

        if (callbacks !== undefined) {
            callbacks.markError(message);
        }
    }

    markProgress(stage: string): void {
        const callbacks: MapRenderBridgeCallbacks | undefined = this.getCallbacks();

        if (callbacks !== undefined) {
            callbacks.markProgress(stage);
        }
    }
}

@Component
export struct MapCard {
    @Prop rawResult: string = '';
    @Prop conversationId: string = '';

    @State private status: string = 'loading';
    @State private title: string = '地图';
    @State private provider: string = '';
    @State private coordinateSystem: string = '';
    @State private markerCount: number = 0;
    @State private polylineCount: number = 0;
    @State private errorMessage: string = '';
    @State private payloadJson: string = '';
    @State private configJson: string = '';

    private webController: webview.WebviewController = new webview.WebviewController();
    private pageReady: boolean = false;
    private injected: boolean = false;
    private bridgeRegistered: boolean = false;
    private renderTimer: number = -1;
    private traceId: string = '';
    private bridgeObjectName: string = '';
    private renderStartedAt: number = 0;
    private activeStage: string = 'created';
    private bridge: MapRenderBridge = new MapRenderBridge();

    aboutToAppear(): void {
        this.bridge.bind(
            (): void => {
                this.markReady();
            },
            (message: string): void => {
                this.markError(message);
            },
            (stage: string): void => {
                this.markProgress(stage);
            }
        );
        mapTraceSequence++;
        this.traceId = 'map-' + mapTraceSequence.toString();
        this.bridgeObjectName = 'nexoraMapBridge' + mapTraceSequence.toString();
        this.renderStartedAt = Date.now();
        this.beginStage('prepare');
        this.renderTimer = setTimeout((): void => {
            if (this.status === 'loading') {
                this.logErrorEvent('timeout', this.activeStage,
                    'limitMs=' + RENDER_TIMEOUT_MS.toString() + ' provider=' + this.provider);
                this.markError('地图加载超时');
            }
        }, RENDER_TIMEOUT_MS);
        this.prepare().catch((error: BusinessError) => {
            this.logErrorEvent('prepare_exception', this.activeStage,
                'code=' + error.code.toString() + ' message=' + error.message);
            this.markError('地图准备失败');
        });
    }

    aboutToDisappear(): void {
        this.logEvent('disappear', this.activeStage);
        this.clearRenderTimer();

        if (this.bridgeRegistered) {
            try {
                this.webController.deleteJavaScriptRegister(this.bridgeObjectName);
                this.logEvent('bridge_released', 'cleanup');
            } catch (error) {
                const businessError: BusinessError = error as BusinessError;
                this.logErrorEvent('bridge_release_failed', 'cleanup',
                    'code=' + businessError.code.toString() + ' message=' + businessError.message);
            }

            this.bridgeRegistered = false;
        }

        this.bridge.release();
    }

    // 解析工具结果 → 必要时拉取 scene → 拉取渲染配置 → 等待页面就绪后注入
    private async prepare(): Promise<void> {
        const parseStartedAt: number = this.beginStage('parse_tool_result');
        const data: MapCardData | null = readMapCardData(this.rawResult);
        this.completeStage('parse_tool_result', parseStartedAt, 'valid=' + (data !== null).toString());

        if (data === null) {
            this.markError('地图数据不可用');
            return;
        }

        this.applyCardData(data);
        this.logEvent('payload_ready', 'parse_tool_result', 'kind=' + data.kind +
            ' provider=' + data.provider + ' markers=' + data.markerCount.toString() +
            ' polylines=' + data.polylineCount.toString());

        if (data.kind === 'ref') {
            const resolved: boolean = await this.resolveMapRef(data);

            if (!resolved) {
                return;
            }
        } else {
            this.payloadJson = data.payloadJson;
        }

        const configStartedAt: number = this.beginStage('renderer_config',
            'requestTimeoutMs=' + MAP_HTTP_TIMEOUT_MS.toString());
        const config: string = await MapRendererConfig.ensure();
        this.completeStage('renderer_config', configStartedAt, 'available=' + (config.length > 0).toString());

        if (config.length === 0) {
            this.markError('地图渲染配置不可用');
            return;
        }

        this.configJson = config;
        this.injectIfReady();
    }

    // map-ref：按 conversationId + mapId 拉取 scene，成功后刷新标题与统计
    private async resolveMapRef(data: MapCardData): Promise<boolean> {
        const ref: Record<string, Object> | null = Json.parseObject(data.payloadJson);
        const mapId: string = ref === null ? '' : Json.string(ref, 'mapId');
        const conversationId: string = this.conversationId.trim();

        if (mapId.length === 0 || conversationId.length === 0) {
            this.markError('地图引用缺少上下文');
            return false;
        }

        const requestStartedAt: number = this.beginStage('scene_request',
            'requestTimeoutMs=' + MAP_HTTP_TIMEOUT_MS.toString());
        const scene = await ApiService.fetchMapScene(conversationId, mapId);
        this.completeStage('scene_request', requestStartedAt, 'success=' + scene.success.toString());

        if (!scene.success || scene.sceneJson.length === 0) {
            this.markError(scene.message.length > 0 ? scene.message : '地图记录读取失败');
            return false;
        }

        const parseStartedAt: number = this.beginStage('parse_scene');
        const sceneData: MapCardData | null = readSceneCardData(scene.sceneJson, data.title);
        this.completeStage('parse_scene', parseStartedAt, 'valid=' + (sceneData !== null).toString());

        if (sceneData === null) {
            this.markError('地图记录解析失败');
            return false;
        }

        this.applyCardData(sceneData);
        this.payloadJson = sceneData.payloadJson;
        this.logEvent('scene_ready', 'parse_scene', 'provider=' + sceneData.provider +
            ' markers=' + sceneData.markerCount.toString() + ' polylines=' + sceneData.polylineCount.toString());
        return true;
    }

    private applyCardData(data: MapCardData): void {
        this.title = data.title;
        this.provider = data.provider;
        this.coordinateSystem = data.coordinateSystem;
        this.markerCount = data.markerCount;
        this.polylineCount = data.polylineCount;
    }

    // 页面与数据都就绪后注入一次（runJavaScript 在 onPageEnd 之前不可用）
    private injectIfReady(): void {
        if (!this.pageReady || this.injected || this.payloadJson.length === 0 || this.configJson.length === 0) {
            const waitingFor: string[] = [];

            if (!this.pageReady) {
                waitingFor.push('web_page');
            }

            if (this.payloadJson.length === 0) {
                waitingFor.push('payload');
            }

            if (this.configJson.length === 0) {
                waitingFor.push('config');
            }

            this.activeStage = 'renderer_prerequisites';
            this.logEvent('waiting', this.activeStage, waitingFor.join(','));
            return;
        }

        this.injected = true;
        // Return page and bridge state with the render call so missing Web assets or proxy methods are visible.
        const script: string = '(function() {' +
            'var bridge = window.' + this.bridgeObjectName + ';' +
            'window.nexoraMapBridge = bridge;' +
            'var renderer = window.NexoraMapBridge;' +
            'var probe = {' +
            'readyState: document.readyState,' +
            'renderer: typeof renderer,' +
            'render: renderer ? typeof renderer.render : "undefined",' +
            'bridge: typeof bridge,' +
            'progress: bridge ? typeof bridge.markProgress : "undefined",' +
            'canvas: !!document.getElementById("nexora-map-canvas")' +
            '};' +
            'try {' +
            'if (probe.progress === "function") {' +
            'bridge.markProgress("renderer_probe");' +
            'probe.bridgeCall = "returned";' +
            '}' +
            '} catch (error) {' +
            'probe.bridgeCallError = String(error);' +
            '}' +
            'try {' +
            'renderer.render(' + this.payloadJson + ',' + this.configJson + ');' +
            'probe.renderCall = "returned";' +
            '} catch (error) {' +
            'probe.renderCallError = String(error);' +
            '}' +
            'return JSON.stringify(probe);' +
            '})()';
        const injectStartedAt: number = this.beginStage('inject_renderer',
            'bridgeObjectName=' + this.bridgeObjectName);

        this.webController.runJavaScript(script)
            .then((result): void => {
                this.completeStage('inject_renderer', injectStartedAt);
                this.logEvent('renderer_probe', 'inject_renderer', 'result=' + String(result).slice(0, 500));
            })
            .catch((error: BusinessError) => {
                this.logErrorEvent('inject_failed', 'inject_renderer', JSON.stringify(error));
                this.markError('地图脚本注入失败');
            });
    }

    private markReady(): void {
        this.clearRenderTimer();
        this.logEvent('ready', this.activeStage, 'provider=' + this.provider);
        this.status = 'ready';
    }

    private markError(message: string): void {
        this.clearRenderTimer();
        this.logErrorEvent('failed', this.activeStage, 'message=' + message);
        this.status = 'error';
        this.errorMessage = message;
    }

    private markProgress(stage: string): void {
        this.activeStage = stage;
        this.logEvent('progress', stage);
    }

    private beginStage(stage: string, detail: string = ''): number {
        this.activeStage = stage;
        const startedAt: number = Date.now();
        this.logEvent('start', stage, detail);
        return startedAt;
    }

    private completeStage(stage: string, startedAt: number, detail: string = ''): void {
        const duration: string = 'durationMs=' + (Date.now() - startedAt).toString();
        this.logEvent('complete', stage, detail.length > 0 ? duration + ' ' + detail : duration);
    }

    private logEvent(event: string, stage: string, detail: string = ''): void {
        const elapsedMs: number = this.renderStartedAt > 0 ? Date.now() - this.renderStartedAt : 0;
        hilog.info(DOMAIN, TAG,
            'trace=%{public}s event=%{public}s stage=%{public}s elapsedMs=%{public}d detail=%{public}s',
            this.traceId, event, stage, elapsedMs, detail);
    }

    private logErrorEvent(event: string, stage: string, detail: string = ''): void {
        const elapsedMs: number = this.renderStartedAt > 0 ? Date.now() - this.renderStartedAt : 0;
        hilog.error(DOMAIN, TAG,
            'trace=%{public}s event=%{public}s stage=%{public}s elapsedMs=%{public}d detail=%{public}s',
            this.traceId, event, stage, elapsedMs, detail);
    }

    private clearRenderTimer(): void {
        if (this.renderTimer >= 0) {
            clearTimeout(this.renderTimer);
            this.renderTimer = -1;
        }
    }

    private statusText(): string {
        if (this.status === 'ready') {
            return '已渲染';
        }

        return this.status === 'error' ? '失败' : '加载中';
    }

    private statusColor(): ResourceColor {
        if (this.status === 'ready') {
            return $r('app.color.text_success');
        }

        return this.status === 'error' ? $r('app.color.text_danger') : $r('app.color.text_tertiary');
    }

    build() {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                Text(this.title)
                    .fontSize(FontSize.small)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);

                Text(this.statusText())
                    .fontSize(FontSize.micro)
                    .fontColor(this.statusColor());
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            Stack() {
                Web({ src: $rawfile('map/map_renderer.html'), controller: this.webController })
                    .width('100%')
                    .height(MAP_HEIGHT)
                    .javaScriptAccess(true)
                    // 天地图 JSAPI 用 localStorage 做组件缓存与版本判断，禁用它会让 async 注入链路异常
                    .domStorageAccess(true)
                    .zoomAccess(false)
                    .backgroundColor('#F1F2F6')
                    .hitTestBehavior(HitTestMode.Block)
                    .nestedScroll({
                        scrollUp: NestedScrollMode.SELF_ONLY,
                        scrollDown: NestedScrollMode.SELF_ONLY,
                        scrollLeft: NestedScrollMode.SELF_ONLY,
                        scrollRight: NestedScrollMode.SELF_ONLY
                    })
                    .onControllerAttached(() => {
                        const registerStartedAt: number = this.beginStage('bridge_register');

                        try {
                            this.webController.registerJavaScriptProxy(
                                this.bridge,
                                this.bridgeObjectName,
                                ['markReady', 'markError', 'markProgress']
                            );
                            this.bridgeRegistered = true;
                            this.completeStage('bridge_register', registerStartedAt,
                                'name=' + this.bridgeObjectName + ' methods=markReady,markError,markProgress');
                        } catch (error) {
                            const businessError: BusinessError = error as BusinessError;
                            this.logErrorEvent('bridge_registration_failed', 'bridge_register',
                                'code=' + businessError.code.toString() + ' message=' + businessError.message);
                            this.markError('地图桥接注册失败');
                        }
                    })
                    .onPageBegin(() => {
                        this.activeStage = 'web_page_loading';
                        this.logEvent('start', 'web_page');
                    })
                    .onPageEnd(() => {
                        this.pageReady = true;
                        this.activeStage = 'web_page_ready';
                        this.logEvent('complete', 'web_page', 'pageEnd=true');
                        this.injectIfReady();
                    })
                    .onErrorReceive((event: OnErrorReceiveEvent) => {
                        this.activeStage = 'web_page_error';
                        this.logErrorEvent('web_error', this.activeStage,
                            'code=' + event.error.getErrorCode().toString() + ' info=' + event.error.getErrorInfo());
                    });

                if (this.status === 'loading') {
                    Column() {
                        LoadingProgress()
                            .width(Size.iconLarge)
                            .height(Size.iconLarge)
                            .color($r('app.color.brand_primary'));
                    }
                    .width('100%')
                    .height(MAP_HEIGHT)
                    .justifyContent(FlexAlign.Center)
                    .backgroundColor($r('app.color.bg_sunken'));
                }

                if (this.status === 'error') {
                    Column({ space: Space.xs }) {
                        Text(this.errorMessage.length > 0 ? this.errorMessage : '地图渲染失败')
                            .fontSize(FontSize.small)
                            .fontColor($r('app.color.text_secondary'))
                            .textAlign(TextAlign.Center);
                    }
                    .width('100%')
                    .height(MAP_HEIGHT)
                    .justifyContent(FlexAlign.Center)
                    .padding({ left: Space.lg, right: Space.lg })
                    .backgroundColor($r('app.color.bg_sunken'));
                }
            }
            .width('100%')
            .height(MAP_HEIGHT)
            .borderRadius(Radius.sm)
            .clip(true)
            .backgroundColor($r('app.color.bg_sunken'));

            Row({ space: Space.md }) {
                Text('标记 ' + this.markerCount)
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));

                Text('线 ' + this.polylineCount)
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));

                if (this.coordinateSystem.length > 0) {
                    Text('坐标 ' + this.coordinateSystem)
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));
                }
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(Space.md)
        .borderRadius(Radius.md)
        .borderWidth(1)
        .borderColor($r('app.color.border'))
        .backgroundColor($r('app.color.bg_card'))
        .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
    }
}
