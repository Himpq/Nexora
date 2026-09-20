// QuestionCard.ets - question / ask_for_permission 交互卡片
// 与 NexoraWeb MessageItem question 卡片对齐：等待回答时可选选项或自由输入，
// 提交后锁定并作为普通用户消息发送（由 MainChat 承接）

import { FontSize, LineHeight, Motion, PressScale, Radius, Space } from '../../common/DesignToken';
import { QuestionItem } from '../../common/QuestionLocks';

@Component
export struct QuestionCard {
    @ObjectLink item: QuestionItem;
    onAnswer: (item: QuestionItem, answer: string) => void = () => {};
    // 行身份（见 ChatRenderItem.key）：复用取回时 aboutToAppear 不会重跑，
    // 不重置就会把上一行的输入草稿带到这一行的「其他」选项里
    @Prop @Watch('onRowIdentityChanged') rowIdentity: string = '';

    // 其他选项输入草稿
    @State private otherDraft: string = '';
    @State private pressedChoice: string = '';

    // 身份变化 = 换了行：丢弃上一行遗留的瞬时输入态
    private onRowIdentityChanged(): void {
        this.otherDraft = '';
        this.pressedChoice = '';
    }

    private submit(answer: string): void {
        const text: string = answer.trim();

        if (text.length === 0 || this.item.answered || this.item.submitting) {
            return;
        }

        this.otherDraft = '';
        this.onAnswer(this.item, text);
    }

    private canSubmitOther(): boolean {
        return this.otherDraft.trim().length > 0 && !this.item.answered && !this.item.submitting;
    }

    private kickerText(): string {
        return this.item.isPermissionCard() ? '权限请求' : '提问';
    }

    private pillText(): string {
        if (this.item.answered) {
            return '已回答';
        }

        return this.item.isPermissionCard() ? '等待授权' : '等待回答';
    }

    build() {
        Column({ space: Space.sm }) {
            Row() {
                Text(this.kickerText())
                    .fontSize(FontSize.caption)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_brand'));

                Blank();

                Text(this.pillText())
                    .fontSize(FontSize.micro)
                    .fontColor(this.item.answered ? $r('app.color.text_success') : $r('app.color.text_tertiary'))
                    .padding({ left: Space.sm, right: Space.sm, top: Space.xxs, bottom: Space.xxs })
                    .borderRadius(Radius.full)
                    .backgroundColor($r('app.color.bg_sunken'));
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            Text(this.item.payload.questionTitle.length > 0 ? this.item.payload.questionTitle : '问题')
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .width('100%');

            if (this.item.payload.questionContent.length > 0) {
                Text(this.item.payload.questionContent)
                    .fontSize(FontSize.small)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_secondary'))
                    .width('100%');
            }

            if (!this.item.answered) {
                if (this.item.payload.choices.length > 0) {
                    Column({ space: Space.sm }) {
                        ForEach(this.item.payload.choices, (choice: string) => {
                            this.ChoiceButton(choice);
                        }, (choice: string, index: number) => choice + '_' + index);
                    }
                    .width('100%');
                }

                if (this.item.payload.allowOther) {
                    this.OtherInput();
                }
            } else {
                Text('你的回答：' + this.item.answer)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .width('100%')
                    .padding({ top: Space.xxs });
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(Space.md)
        .borderRadius(Radius.md)
        .borderWidth(1)
        .borderColor($r('app.color.border'))
        .backgroundColor($r('app.color.bg_card'));
    }

    // 选项按钮：品牌描边，整行可点，按下轻微缩放
    @Builder
    ChoiceButton(choice: string) {
        Text(choice)
            .fontSize(FontSize.small)
            .fontColor($r('app.color.text_brand'))
            .textAlign(TextAlign.Center)
            .width('100%')
            .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
            .borderRadius(Radius.sm)
            .borderWidth(1)
            .borderColor($r('app.color.brand_primary'))
            .backgroundColor(this.pressedChoice === choice
                ? $r('app.color.chip_bg_active')
                : $r('app.color.bg_card'))
            .scale({
                x: this.pressedChoice === choice ? PressScale.pressed : PressScale.normal,
                y: this.pressedChoice === choice ? PressScale.pressed : PressScale.normal
            })
            .animation({ duration: Motion.durationPress, curve: Motion.press })
            .onTouch((event: TouchEvent) => {
                if (event.type === TouchType.Down) {
                    this.pressedChoice = choice;
                }

                if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                    this.pressedChoice = '';
                }
            })
            .onClick(() => {
                this.submit(choice);
            });
    }

    @Builder
    OtherInput() {
        Row({ space: Space.sm }) {
            TextInput({ text: this.otherDraft, placeholder: '其他…' })
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .backgroundColor($r('app.color.bg_sunken'))
                .borderRadius(Radius.sm)
                .padding({ left: Space.sm, right: Space.sm })
                .height(38)
                .layoutWeight(1)
                .enabled(!this.item.submitting)
                .onChange((value: string) => {
                    this.otherDraft = value;
                })
                .onSubmit(() => {
                    this.submit(this.otherDraft);
                });

            Text('提交')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_inverse'))
                .textAlign(TextAlign.Center)
                .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
                .borderRadius(Radius.sm)
                .backgroundColor(this.canSubmitOther()
                    ? $r('app.color.brand_primary')
                    : $r('app.color.skeleton'))
                .onClick(() => {
                    this.submit(this.otherDraft);
                });
        }
        .width('100%');
    }
}
