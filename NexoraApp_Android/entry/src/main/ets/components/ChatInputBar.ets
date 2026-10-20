// ChatInputBar.ets - 对话输入栏
// 首页与对话页共用：多行自适应输入框 + 能力开关 + 发送/停止按钮
// 发送与停止是同一个位置的状态切换，避免生成中按钮跳动
// 聚焦时输入栏边框提亮，失焦时恢复

import { FontSize, Motion, PressScale, Radius, Size, Space } from '../common/DesignToken';

@Component
export struct ChatInputBar {
    @Link draft: string;
    // 沉浸式布局下页面一路铺到物理屏底，输入栏必须自己让开手势区
    @StorageProp('insetBottom') private insetBottom: number = 0;
    @Prop streaming: boolean = false;
    @Prop placeholder: string = '给 Nexora 发送消息…';
    onSend: () => void = () => {};
    onStop: () => void = () => {};

    @State private focused: boolean = false;
    @State private sendPressed: boolean = false;

    build() {
        Column({ space: Space.sm }) {
            TextArea({ placeholder: this.placeholder, text: $$this.draft })
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .caretColor($r('app.color.brand_primary'))
                // 与外壳同底：取消默认填充与内层圆角，避免内层"二次圆角"把贴边的文本再裁一次
                .backgroundColor(Color.Transparent)
                .borderRadius(0)
                .padding(0)
                .constraintSize({ minHeight: 24, maxHeight: Size.inputMaxHeight })
                .maxLines(6)
                .onFocus(() => {
                    this.focused = true;
                })
                .onBlur(() => {
                    this.focused = false;
                });

            Row({ space: Space.sm }) {
                Blank();

                this.SendButton();
            }
            .width('100%')
            .height(Size.sendButton)
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.xs, top: Space.lg, bottom: Space.md })
        // 悬浮卡片形态：整块抬到手势区之上，卡片下方留白由页面底色接管
        .margin({ bottom: this.insetBottom })
        .borderRadius(Radius.xl)
        .backgroundColor($r('app.color.bg_card'))
        .shadow({
            radius: 12,
            color: this.focused ? '#1A4C6FFF' : '#140F1E14',
            offsetX: 0,
            offsetY: this.focused ? 2 : 6
        })
        .border({
            width: this.focused ? 1 : 0,
            color: $r('app.color.brand_primary'),
            style: BorderStyle.Solid
        })
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut });
    }

    // 发送 / 停止：同一位置切换，图标交叉淡入淡出并伴随轻微缩放
    @Builder
    SendButton() {
        Stack() {
            Image($r('app.media.ic_send'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.text_inverse'))
                .opacity(this.streaming ? 0 : 1)
                .scale({ x: this.streaming ? 0.6 : 1, y: this.streaming ? 0.6 : 1 });

            Image($r('app.media.ic_stop'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.text_inverse'))
                .opacity(this.streaming ? 1 : 0)
                .scale({ x: this.streaming ? 1 : 0.6, y: this.streaming ? 1 : 0.6 });
        }
        .width(Size.sendButton)
        .height(Size.sendButton)
        .borderRadius(Radius.full)
        .backgroundColor($r('app.color.brand_primary'))
        .scale({
            x: this.sendPressed ? PressScale.pressed : PressScale.normal,
            y: this.sendPressed ? PressScale.pressed : PressScale.normal
        })
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.sendPressed = true;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.sendPressed = false;
            }
        })
        .onClick(() => {
            if (this.streaming) {
                this.onStop();
                return;
            }

            this.onSend();
        });
    }
}
