// ToolSegment.ets - 一次工具调用的完整视觉单元
// 工具卡 + 结果附加物（Exa 图片画廊 / 地图卡片）；
// 条件在本组件 build 内求值，@ObjectLink item 变化时能正确带出后到的画廊与地图

import { ToolCallItem } from '../../common/ChatTypes';
import { Space } from '../../common/DesignToken';
import { ImageGallery } from './ImageGallery';
import { MapCard } from './MapCard';
import { ToolCallCard } from './ToolCallCard';

@Component
export struct ToolSegment {
    @ObjectLink item: ToolCallItem;
    conversationId: string = '';
    onOpenImage: (url: string) => void = () => {};

    build() {
        Column({ space: Space.sm }) {
            ToolCallCard({ item: this.item });

            if (this.item.exaGallery !== null) {
                if (this.item.exaGallery.items.length > 0) {
                    ImageGallery({
                        items: this.item.exaGallery.items,
                        onOpenImage: this.onOpenImage
                    });
                }
            }

            if (this.item.mapResultJson.length > 0 && this.item.status === 'done') {
                MapCard({
                    rawResult: this.item.mapResultJson,
                    conversationId: this.conversationId
                });
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }
}
