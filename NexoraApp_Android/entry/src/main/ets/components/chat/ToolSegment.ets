// ToolSegment.ets - 工具卡与地图结果的渲染单元
// Exa 图片画廊单独由 ToolGallerySegment 占用一个固定高度的 ListItem，
// 避免异步图片结果改变工具卡所在行的高度。

import { ToolCallItem } from '../../common/ChatTypes';
import { Space } from '../../common/DesignToken';
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
