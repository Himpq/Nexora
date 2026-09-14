// ImageGallery.ets - Exa 搜索结果横向图片画廊
// 与 NexoraWeb ExaImageGallery.vue 对齐：直接贴在搜索工具行下方，无标题无数量，
// 卡片固定 4:3 比例，点击交给上层打开全屏查看器

import { FontSize, Radius, Space } from '../../common/DesignToken';
import { ExaImageItem } from '../../common/ExaMedia';

const CARD_WIDTH: number = 168;
const CARD_HEIGHT: number = 126;

@Component
export struct ImageGallery {
    // @Prop 保证工具结果二次更新（重答/历史替换）时画廊同步重建
    @Prop items: ExaImageItem[] = [];
    onOpenImage: (url: string) => void = () => {};

    // 加载失败的图片地址：保留卡片位置并显示明确状态
    @State private failedUrls: string[] = [];

    private isFailed(url: string): boolean {
        return this.failedUrls.indexOf(url) >= 0;
    }

    build() {
        Scroll() {
            Row({ space: Space.sm }) {
                ForEach(this.items, (item: ExaImageItem) => {
                    this.ImageCard(item);
                }, (item: ExaImageItem) => item.imageUrl);
            }
            .padding({ right: Space.xs })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .align(Alignment.Start);
    }

    @Builder
    ImageCard(item: ExaImageItem) {
        Stack() {
            if (this.isFailed(item.imageUrl)) {
                Text('图片无法加载')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            } else {
                Image(item.imageUrl)
                    .width(CARD_WIDTH)
                    .height(CARD_HEIGHT)
                    .objectFit(ImageFit.Cover)
                    .interpolation(ImageInterpolation.High)
                    .draggable(false)
                    .onError(() => {
                        if (!this.isFailed(item.imageUrl)) {
                            this.failedUrls = [...this.failedUrls, item.imageUrl];
                        }
                    });
            }
        }
        .width(CARD_WIDTH)
        .height(CARD_HEIGHT)
        .borderRadius(Radius.sm)
        .borderWidth(1)
        .borderColor($r('app.color.border'))
        .backgroundColor($r('app.color.bg_sunken'))
        .clip(true)
        .onClick(() => {
            if (!this.isFailed(item.imageUrl)) {
                this.onOpenImage(item.imageUrl);
            }
        });
    }
}
