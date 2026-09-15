// NotesEntryCard.ets - 首页随笔直达卡片
// 只负责入口展示，不承载笔记数据；点击后由 MainChat 打开 NotesPage 的新建态

import { FontSize, Motion, PressScale, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct NotesEntryCard {
    onTap: () => void = () => {};

    @State private pressed: boolean = false;

    build() {
        Row({ space: Space.md }) {
            Column() {
                Image($r('app.media.ic_edit'))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor($r('app.color.text_brand'));
            }
            .width(40)
            .height(40)
            .justifyContent(FlexAlign.Center)
            .borderRadius(Radius.sm)
            .backgroundColor($r('app.color.brand_soft'));

            Column({ space: Space.xxs }) {
                Text('记一条随笔')
                    .fontSize(FontSize.body)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'));

                Text('想到就写，自动保存')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            Image($r('app.media.ic_chevron_right'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.icon_secondary'));
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor(this.pressed ? $r('app.color.bg_pressed') : $r('app.color.bg_card'))
        .border({ width: 1, color: $r('app.color.divider') })
        .scale({
            x: this.pressed ? PressScale.pressed : PressScale.normal,
            y: this.pressed ? PressScale.pressed : PressScale.normal
        })
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.pressed = true;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressed = false;
            }
        })
        .onClick(() => {
            this.onTap();
        });
    }
}
