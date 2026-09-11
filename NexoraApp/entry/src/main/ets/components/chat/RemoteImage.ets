// RemoteImage.ets - 需登录图片的展示单元
// 通过 RemoteImageCache 把服务端附件下载到本地后以 file:// 展示，
// 加载中显示占位、失败显示错误态；点击回调本地路径交由全屏查看器打开。
// 尺寸与填充方式由调用方给定：聊天附件用正方形 Cover，阅读器插图用矩形 Contain。

import { FontSize, Radius, Size, Space } from '../../common/DesignToken';
import { RemoteImageCache } from '../../common/RemoteImageCache';

@Component
export struct RemoteImage {
    // 服务端下载路径（相对 /api/... 或绝对 URL）
    @Prop @Watch('onSourceChanged') source: string = '';
    @Prop frameWidth: number = 108;
    @Prop frameHeight: number = 108;
    @Prop fit: ImageFit = ImageFit.Cover;
    @Prop corner: number = Radius.md;
    onOpen: (localPath: string) => void = () => {};

    @State private localPath: string = '';
    @State private failed: boolean = false;

    aboutToAppear(): void {
        this.load();
    }

    onSourceChanged(): void {
        this.load();
    }

    private load(): void {
        this.localPath = '';
        this.failed = false;

        const source: string = this.source;

        if (source.length === 0) {
            this.failed = true;
            return;
        }

        RemoteImageCache.shared.resolve(source).then((path: string) => {
            // 加载期间 source 已切换：本次结果作废，等待新 source 的回调
            if (this.source !== source) {
                return;
            }

            if (path.length === 0) {
                this.failed = true;
                return;
            }

            this.localPath = path;
        });
    }

    build() {
        Stack() {
            if (this.localPath.length > 0) {
                Image(this.localPath)
                    .width(this.frameWidth)
                    .height(this.frameHeight)
                    .objectFit(this.fit)
                    .borderRadius(this.corner)
                    .draggable(false)
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
