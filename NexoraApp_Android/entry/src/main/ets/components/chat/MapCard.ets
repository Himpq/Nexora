// MapCard.ets - 地图工具结果卡片（ArkUI-X / Android）
// ArkWeb 承载与 Web 同款的 Baidu/天地图 JSAPI 渲染：
//   - scene 结果直接注入；map-ref 先用 HttpUtil（自动带 Cookie）拉取 scene 再注入
//   - 渲染状态由页面全局 __nexoraMapStatus 轮询读取，只依赖 ArkTS→JS 的 runJavaScript，
//     不依赖 ArkUI-X 未经验证的 javaScriptProxy 反向调用

import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { webview } from '@kit.ArkWeb';
import { ApiService } from '../../common/ApiService';
import { FontSize, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { Json } from '../../common/JsonUtil';
import { MapRendererConfig } from '../../common/MapRendererConfig';
import { MapCardData, readMapCardData, readSceneCardData } from '../../common/MapTool';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMapCard';

const MAP_HEIGHT: number = 240;
const STATUS_POLL_INTERVAL_MS: number = 300;
const STATUS_POLL_TIMEOUT_MS: number = 15000;

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
    private pollTimer: number = -1;
    private pollStartedAt: number = 0;

    aboutToAppear(): void {
        this.prepare();
    }

    aboutToDisappear(): void {
        this.stopStatusPoll();
    }

    // 解析工具结果 → 必要时拉取 scene → 拉取渲染配置 → 等待页面就绪后注入
    private async prepare(): Promise<void> {
        const data: MapCardData | null = readMapCardData(this.rawResult);

        if (data === null) {
            this.markError('地图数据不可用');
            return;
        }

        this.applyCardData(data);

        if (data.kind === 'ref') {
            const resolved: boolean = await this.resolveMapRef(data);

            if (!resolved) {
                return;
            }
        } else {
            this.payloadJson = data.payloadJson;
        }

        const config: string = await MapRendererConfig.ensure();

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

        const scene = await ApiService.fetchMapScene(conversationId, mapId);

        if (!scene.success || scene.sceneJson.length === 0) {
            this.markError(scene.message.length > 0 ? scene.message : '地图记录读取失败');
            return false;
        }

        const sceneData: MapCardData | null = readSceneCardData(scene.sceneJson, data.title);

        if (sceneData === null) {
            this.markError('地图记录解析失败');
            return false;
        }

        this.applyCardData(sceneData);
        this.payloadJson = sceneData.payloadJson;
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
            return;
        }

        this.injected = true;
        const script: string = 'window.NexoraMapBridge.render(' + this.payloadJson + ',' + this.configJson + ');';

        this.webController.runJavaScript(script).catch((error: BusinessError) => {
            hilog.error(DOMAIN, TAG, 'inject failed: %{public}s', JSON.stringify(error));
            this.markError('地图脚本注入失败');
        });
        this.startStatusPoll();
    }

    // 轮询页面全局状态：渲染脚本完成/失败时写入 ready/error
    private startStatusPoll(): void {
        this.pollStartedAt = Date.now();
        this.pollTimer = setInterval(() => {
            this.pollStatus();
        }, STATUS_POLL_INTERVAL_MS);
    }

    private pollStatus(): void {
        if (this.status !== 'loading') {
            this.stopStatusPoll();
            return;
        }

        if (Date.now() - this.pollStartedAt > STATUS_POLL_TIMEOUT_MS) {
            this.markError('地图加载超时');
            return;
        }

        this.webController.runJavaScript('window.__nexoraMapStatus').then((value: string) => {
            this.handleStatusValue(value);
        }).catch((error: BusinessError) => {
            hilog.warn(DOMAIN, TAG, 'poll status failed: %{public}s', JSON.stringify(error));
        });
    }

    private handleStatusValue(value: string): void {
        const status: string = MapCard.stripQuotes(value);

        if (status === 'ready') {
            this.markReady();
            return;
        }

        if (status === 'error') {
            this.webController.runJavaScript('window.__nexoraMapError').then((message: string) => {
                const detail: string = MapCard.stripQuotes(message);
                this.markError(detail.length > 0 ? detail : '地图渲染失败');
            }).catch(() => {
                this.markError('地图渲染失败');
            });
        }
    }

    // runJavaScript 返回的字符串值可能带 JSON 引号，统一剥除
    private static stripQuotes(value: string): string {
        return value.replace(/["']/g, '').trim();
    }

    private stopStatusPoll(): void {
        if (this.pollTimer >= 0) {
            clearInterval(this.pollTimer);
            this.pollTimer = -1;
        }
    }

    private markReady(): void {
        this.stopStatusPoll();
        this.status = 'ready';
    }

    private markError(message: string): void {
        this.stopStatusPoll();
        this.status = 'error';
        this.errorMessage = message;
        hilog.warn(DOMAIN, TAG, 'map render failed: %{public}s', message);
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
                    .onPageEnd(() => {
                        this.pageReady = true;
                        this.injectIfReady();
                    })
                    .onErrorReceive((event: OnErrorReceiveEvent) => {
                        hilog.error(DOMAIN, TAG, 'web error code=%{public}d info=%{public}s',
                            event.error.getErrorCode(), event.error.getErrorInfo());
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
