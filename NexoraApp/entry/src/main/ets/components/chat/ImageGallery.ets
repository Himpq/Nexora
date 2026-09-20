// ImageGallery.ets - Exa 搜索结果横向图片画廊
// 与 NexoraWeb ExaImageGallery.vue 对齐：直接贴在搜索工具行下方，无标题无数量，
// 卡片固定 4:3 比例，点击交给上层打开全屏查看器

import { Radius, Space } from '../../common/DesignToken';
import { ExaImageItem } from '../../common/ExaMedia';

const CARD_WIDTH: number = 168;
const CARD_HEIGHT: number = 126;

@Component
export struct ImageGallery {
    // @Prop 保证工具结果二次更新（重答/历史替换）时画廊同步重建
    @Prop @Watch('onItemsChanged') items: ExaImageItem[] = [];
    onOpenImage: (url: string) => void = () => {};

    // 加载失败的图片地址：这些卡片直接从画廊移除（不可达外链不占位、不留灰色框）
    @State private failedUrls: string[] = [];

    // 画廊内容换了就丢弃失败清单：复用取回时 aboutToAppear 不会重跑，
    // 上一行的失败地址会连坐隐藏新行的图片，而画廊高度按可见卡片数计算，
    // 全部被隐藏时高度直接归零 —— 表现为行高塌陷
    private onItemsChanged(): void {
        this.failedUrls = [];
    }

    private isFailed(url: string): boolean {
        return this.failedUrls.indexOf(url) >= 0;
    }

    // 可见卡片：加载失败的地址不参与渲染，全部失败时画廊自然收起（内容高度归零）
    private visibleItems(): ExaImageItem[] {
        return this.items.filter((item: ExaImageItem) => !this.isFailed(item.imageUrl));
    }

    build() {
        Scroll() {
            Row({ space: Space.sm }) {
                ForEach(this.visibleItems(), (item: ExaImageItem) => {
                    this.ImageCard(item);
                }, (item: ExaImageItem) => item.imageUrl);
            }
            .padding({ right: Space.xs })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .height(this.visibleItems().length > 0 ? CARD_HEIGHT : 0)
        .align(Alignment.Start);
    }

    @Builder
    ImageCard(item: ExaImageItem) {
        Image(item.imageUrl)
            .width(CARD_WIDTH)
            .height(CARD_HEIGHT)
            .objectFit(ImageFit.Cover)
            .interpolation(ImageInterpolation.High)
            .draggable(false)
            // 不可达外链直接移出画廊：onError 后该地址不再参与渲染，不留灰色占位卡
            .onError(() => {
                if (!this.isFailed(item.imageUrl)) {
                    this.failedUrls = [...this.failedUrls, item.imageUrl];
                }
            })
            .borderRadius(Radius.sm)
            .clip(true)
            .onClick(() => {
                this.onOpenImage(item.imageUrl);
            });
    }
}
