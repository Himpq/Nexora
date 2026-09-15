// RemoteImage.ets - 需登录图片的展示单元
// 通过 RemoteImageCache 把服务端附件下载到本地后以 file:// 展示，
// 加载中显示占位、失败显示错误态；点击回调本地路径交由全屏查看器打开。
// 尺寸与填充方式由调用方给定：聊天附件用正方形 Cover，阅读器插图用矩形 Contain。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { FontSize, Radius, Size, Space } from '../../common/DesignToken';
import { HttpUtil } from '../../common/HttpUtil';
import { RemoteImageCache } from '../../common/RemoteImageCache';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraRemoteImage';

@Component
export struct RemoteImage {
    // 服务端下载路径（相对 /api/... 或绝对 URL）
    @Prop @Watch('onSourceChanged') source: string = '';
    @Prop frameWidth: number = 108;
    @Prop frameHeight: number = 108;
    @Prop fit: ImageFit = ImageFit.Cover;
    @Prop corner: number = Radius.md;
    // 小尺寸缩略图使用低成本采样；阅读器插图保持默认高质量采样。
    @Prop interpolation: ImageInterpolation = ImageInterpolation.High;
    onOpen: (localPath: string) => void = () => {};

    @State private localPath: string = '';
    @State private failed: boolean = false;
    private loadSequence: number = 0;

    aboutToAppear(): void {
        this.load();
    }

    onSourceChanged(): void {
        this.load();
    }

    private load(): void {
        this.loadSequence += 1;
        const loadId: number = this.loadSequence;
        this.localPath = '';
        this.failed = false;

        const source: string = this.source;
        const route: string = HttpUtil.pathForLog(source);

        if (source.length === 0) {
            hilog.error(DOMAIN, TAG, '[image] load rejected id=%{public}d route=%{public}s reason=empty source', loadId, route);
            this.failed = true;
            return;
        }

        hilog.info(DOMAIN, TAG, '[image] load start id=%{public}d route=%{public}s', loadId, route);

        RemoteImageCache.shared.resolve(source).then((path: string) => {
            // 加载期间 source 已切换：本次结果作废，等待新 source 的回调
            if (this.source !== source) {
                hilog.info(DOMAIN, TAG, '[image] load stale id=%{public}d route=%{public}s', loadId, route);
                return;
            }

            if (path.length === 0) {
                hilog.warn(DOMAIN, TAG, '[image] load resolved empty id=%{public}d route=%{public}s', loadId, route);
                this.failed = true;
                return;
            }

            this.localPath = path;
            hilog.info(DOMAIN, TAG, '[image] load resolved id=%{public}d route=%{public}s', loadId, route);
        }).catch((err: Object) => {
            // 下载层必须把异常转成可见失败，不能让图片永久停留在加载态。
            if (this.source === source) {
                this.failed = true;
            }

            hilog.error(DOMAIN, TAG, '[image] load rejected id=%{public}d route=%{public}s error=%{public}s',
                loadId, route, JSON.stringify(err));
        });
    }

    build() {
        Stack() {
            if (this.localPath.length > 0) {
                Image(this.localPath)
                    .width(this.frameWidth)
                    .height(this.frameHeight)
                    // 按实际显示框限制解码尺寸，避免聊天缩略图滚动时解码整张原图。
                    .sourceSize({ width: this.frameWidth, height: this.frameHeight })
                    .objectFit(this.fit)
                    .interpolation(this.interpolation)
                    .borderRadius(this.corner)
                    .draggable(false)
                    .onError((error: ImageError) => {
                        hilog.error(DOMAIN, TAG, '[image] local decode failed route=%{public}s error=%{public}s',
                            HttpUtil.pathForLog(this.source), JSON.stringify(error));
                        this.localPath = '';
                        this.failed = true;
                    })
                    .onClick(() => {
                        this.onOpen(this.localPath);
                    });
            } else if (this.failed) {
                Column({ space: Space.xxs }) {
                    Image($r('app.media.ic_error'))
                        .width(Size.icon)
                        .height(Size.icon)
                        .fillColor($r('app.color.icon_secondary'));

                    Text('加载失败')
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));
                }
                .width(this.frameWidth)
                .height(this.frameHeight)
                .justifyContent(FlexAlign.Center)
                .borderRadius(this.corner)
                .backgroundColor($r('app.color.bg_sunken'));
            } else {
                Column() {
                    LoadingProgress()
                        .width(Size.iconLarge)
                        .height(Size.iconLarge)
                        .color($r('app.color.brand_primary'));
                }
                .width(this.frameWidth)
                .height(this.frameHeight)
                .justifyContent(FlexAlign.Center)
                .borderRadius(this.corner)
                .backgroundColor($r('app.color.bg_sunken'));
            }
        }
        .width(this.frameWidth)
        .height(this.frameHeight);
    }
}
