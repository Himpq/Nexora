// ChatInputBar.ets - 对话输入栏
// 首页与对话页共用：多行自适应输入框 + 模型/能力开关 + 发送/停止按钮
// 发送与停止是同一个位置的状态切换，避免生成中按钮跳动
// 聚焦时输入栏边框提亮，失焦时恢复

import { hilog } from '@kit.PerformanceAnalysisKit';
import { FontSize, Motion, PressScale, Radius, Size, Space } from '../common/DesignToken';

const DOMAIN: number = 0x0001;
const TAG: string = 'ChatInputBar';

@Component
export struct ChatInputBar {
    @Link draft: string;
    // 模型展示 chip：通过 @StorageProp 从 AppStorage 获取模型名。
    // AppStorage 是应用级存储总线，不依赖组件树层级，比 @Provide/@Consume 更可靠
    @StorageProp('inputModelLabel') @Watch('onModelLabelChanged') inputModelLabel: string = '选择模型';
    // 沉浸式布局下页面一路铺到物理屏底，输入栏必须自己让开手势区
    @StorageProp('insetBottom') private insetBottom: number = 0;
    @Prop streaming: boolean = false;
    @Prop placeholder: string = '给 Nexora 发送消息…';
    onSend: () => void = () => {};
    onStop: () => void = () => {};
    onPickModel: () => void = () => {};

    @State private focused: boolean = false;
    @State private modelPressed: boolean = false;
    @State private sendPressed: boolean = false;

    aboutToAppear(): void {
        hilog.info(DOMAIN, TAG, '[init] inputModelLabel=%{public}s', this.inputModelLabel);
    }

    // @StorageProp 变更回调：确认 AppStorage 写入是否被 @StorageProp 检测到
    onModelLabelChanged(): void {
        hilog.info(DOMAIN, TAG, '[watch] inputModelLabel changed to: %{public}s', this.inputModelLabel);
    }

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
                // 模型 chip：直接内联而非走 @Builder，确保 @StorageProp 变更被 build() 依赖收集追踪
                Row({ space: Space.xs }) {
                    Image($r('app.media.ic_spark'))
                        .width(14)
                        .height(14)
                        .fillColor($r('app.color.icon_secondary'));

                    Text(this.inputModelLabel)
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_secondary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .constraintSize({ maxWidth: '68%' })
                .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
                .borderRadius(Radius.full)
                .backgroundColor(this.modelPressed ? $r('app.color.bg_pressed') : $r('app.color.bg_sunken'))
                .animation({ duration: Motion.durationPress, curve: Motion.press })
                .onTouch((event: TouchEvent) => {
                    if (event.type === TouchType.Down) {
                        this.modelPressed = true;
                    }

                    if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                        this.modelPressed = false;
                    }
                })
                .onClick(() => {
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
