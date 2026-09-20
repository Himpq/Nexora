// ToolGallerySegment.ets - Exa 搜索结果的固定高度渲染单元
// 工具卡与图片画廊不能共用一个 ListItem：画廊结果异步到达时会让原行突然变高，
// List 尚未完成重新排版就会把后续 Markdown 行放进图片区域。

import { ToolCallItem } from '../../common/ChatTypes';
import { Size, Space } from '../../common/DesignToken';
import { ImageGallery } from './ImageGallery';

const GALLERY_HEIGHT: number = 126;

@Component
export struct ToolGallerySegment {
    @ObjectLink item: ToolCallItem;
    onOpenImage: (url: string) => void = () => {};

    build() {
        Column() {
            if (this.item.exaGallery !== null && this.item.exaGallery.items.length > 0) {
                ImageGallery({
                    items: this.item.exaGallery.items,
                    onOpenImage: this.onOpenImage
                });
            } else if (this.item.status === 'running') {
                LoadingProgress()
                    .width(Size.icon)
                    .height(Size.icon)
                    .color($r('app.color.brand_primary'));
            }
        }
        .width('100%')
        .height(GALLERY_HEIGHT)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Start);
    }
}
