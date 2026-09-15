// UserAttachments.ets - 用户消息附件区
// 图片附件渲染缩略图（点击经宿主打开全屏查看器），非图片附件渲染文件胶囊；
// 多图自动换行并右对齐，与用户气泡同侧

import { isImageAttachment, MessageAttachment } from '../../common/ChatTypes';
import { FontSize, Radius, Space } from '../../common/DesignToken';
import { RemoteImage } from './RemoteImage';

@Component
export struct UserAttachments {
    @Prop attachments: MessageAttachment[] = [];
    onOpenImage: (localPath: string) => void = () => {};

    // 附件缩略图边长：两张并排不超出气泡侧最大宽度，三张自动换行
    private thumbSize: number = 108;

    build() {
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.End, alignItems: ItemAlign.End }) {
            ForEach(this.attachments, (att: MessageAttachment) => {
                if (isImageAttachment(att)) {
                    RemoteImage({
                        source: att.url,
                        frameWidth: this.thumbSize,
                        frameHeight: this.thumbSize,
                        interpolation: ImageInterpolation.Low,
                        onOpen: (localPath: string) => {
                            this.onOpenImage(localPath);
                        }
                    })
                        .margin({ left: Space.xs, top: Space.xs });
                } else {
                    this.FileChip(att);
                }
            }, (att: MessageAttachment) => att.url + '|' + att.name);
        }
        .width('100%');
    }

    // 非图片附件：附件图标 + 文件名胶囊（不可点击，仅展示）
    @Builder
    FileChip(att: MessageAttachment) {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_attach'))
                .width(14)
                .height(14)
                .fillColor($r('app.color.text_secondary'));

            Text(att.name)
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_secondary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 180 });
        }
        .padding({ left: Space.sm, right: Space.sm, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.full)
        .backgroundColor($r('app.color.bg_sunken'))
        .margin({ left: Space.xs, top: Space.xs });
    }
}
