// ChatInputBar.ets - 对话输入栏
// 首页与对话页共用：多行自适应输入框 + 模型/能力开关 + 发送/停止按钮
// 发送与停止是同一个位置的状态切换，避免生成中按钮跳动
// 聚焦时输入栏边框出现品牌色发光，失焦时恢复

import { FontSize, Glow, Motion, Radius, Size, Space } from '../common/DesignToken';

@Component
export struct ChatInputBar {
    @Link draft: string;
    // 模型展示 chip：通过 @StorageProp 从 AppStorage 获取模型名。
    // AppStorage 是应用级存储总线，不依赖组件树层级，比 @Provide/@Consume 更可靠
    @StorageProp('inputModelLabel') inputModelLabel: string = '选择模型';
    @Prop streaming: boolean = false;
    @Prop placeholder: string = '给 Nexora 发送消息…';
    onSend: () => void = () => {};
    onStop: () => void = () => {};
    onPickModel: () => void = () => {};

    @State private focused: boolean = false;

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
                // 模型 chip 限宽截断：超长模型名在自身内省略，不挤压右侧发送按钮。
                // 文本直接绑定 app.selectedModelLabel，@ObjectLink 驱动刷新
                this.ToggleChip(this.inputModelLabel, $r('app.media.ic_spark'), false, '68%', () => {
                    this.onPickModel();
                });

                Blank();

                this.SendButton();
            }
            .width('100%')
            .height(Size.sendButton)
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.xs, top: Space.lg, bottom: Space.md })
        .borderRadius(Radius.xl)
        .backgroundColor($r('app.color.bg_card'))
        .shadow({
            radius: this.focused ? Glow.focusRadius : 16,
            color: this.focused ? '#334C6FFF' : '#140F1E14',
            offsetX: 0,
            offsetY: this.focused ? 0 : 6
        })
        .border({
            width: this.focused ? 1.5 : 0,
            color: $r('app.color.brand_primary'),
            style: BorderStyle.Solid
        })
        .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
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
        .linearGradient({
            angle: 135,
            colors: [
                [$r('app.color.brand_primary'), 0],
                [$r('app.color.brand_secondary'), 1]
            ]
        })
        .animation({ duration: Motion.durationBase, curve: Motion.spring })
        .onClick(() => {
            if (this.streaming) {
                this.onStop();
                return;
            }

            this.onSend();
        });
    }

    // 能力开关 chip：激活态用品牌浅底 + 品牌文字；maxWidth 以百分比约束整颗 chip，
    // 文本超长在 chip 内省略，避免把同行其它固定元素（发送按钮）挤出容器
    @Builder
    ToggleChip(label: string, icon: ResourceStr, active: boolean, maxWidth: string, action: () => void) {
        Row({ space: Space.xs }) {
            Image(icon)
                .width(14)
                .height(14)
                .fillColor(active ? $r('app.color.text_brand') : $r('app.color.icon_secondary'));

            Text(label)
                .fontSize(FontSize.caption)
                .fontColor(active ? $r('app.color.text_brand') : $r('app.color.text_secondary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .constraintSize({ maxWidth: maxWidth })
        .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.full)
        .backgroundColor(active ? $r('app.color.brand_soft') : $r('app.color.bg_sunken'))
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        .onClick(action);
    }
}
