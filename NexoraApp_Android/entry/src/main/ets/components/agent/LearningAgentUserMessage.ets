import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';

// User messages keep the main chat's bubble direction; the timeline rail belongs to the right edge.
@Component
export struct LearningAgentUserMessage {
    @Prop text: string;
    @Prop timeLabel: string;
    @Prop pending: boolean = false;
    @Prop errorText: string = '';
    // Supply a unique prefix for each timeline entry when locating individual messages in the UI.
    @Prop controlPrefix: string = 'agent_user_message';
    onRefresh: (() => void) | undefined = undefined;

    build() {
        Column() {
            Stack({ alignContent: Alignment.TopEnd }) {
                Column({ space: Space.sm }) {
                    Text(this.timeLabel)
                        .id(this.controlPrefix + '_time')
                        .fontSize(FontSize.small)
                        .lineHeight(LineHeight.caption)
                        .fontColor($r('app.color.text_secondary'))
                        .textAlign(TextAlign.End);

                    Row() {
                        Text(this.text)
                            .id(this.controlPrefix + '_text')
                            .fontSize(FontSize.body)
                            .lineHeight(LineHeight.body)
                            .fontColor($r('app.color.text_inverse'))
                            .textAlign(TextAlign.Start)
                            .wordBreak(WordBreak.BREAK_WORD)
                            .padding(Space.md)
                            .constraintSize({ maxWidth: '78%' })
                            .backgroundColor($r('app.color.bubble_user'))
                            .borderRadius({
                                topLeft: Radius.lg,
                                topRight: Radius.lg,
                                bottomLeft: Radius.lg,
                                bottomRight: Radius.sm
                            })
                            .copyOption(CopyOptions.LocalDevice);
                    }.width('100%').justifyContent(FlexAlign.End);

                    if (this.errorText.length > 0) {
                        Column({ space: Space.xs }) {
                            Text('暂未收到回复：' + this.errorText)
                                .id(this.controlPrefix + '_error')
                                .fontSize(FontSize.small)
                                .lineHeight(LineHeight.caption)
                                .fontColor($r('app.color.text_danger'))
                                .textAlign(TextAlign.End)
                                .wordBreak(WordBreak.BREAK_WORD);
                            if (this.onRefresh !== undefined) {
                                Button('刷新结果', { type: ButtonType.Normal })
                                    .id(this.controlPrefix + '_refresh')
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.text_brand'))
                                    .backgroundColor(Color.Transparent)
                                    .borderRadius(Radius.sm)
                                    .constraintSize({ minHeight: Size.touchTarget })
                                    .padding({ left: Space.sm, right: Space.sm })
                                    .onClick(() => {
                                        if (this.onRefresh !== undefined) {
                                            this.onRefresh();
                                        }
                                    });
                            }
                        }.constraintSize({ maxWidth: '78%' }).alignItems(HorizontalAlign.End);
                    } else if (this.pending) {
                        Text('Agent 正在回应…')
                            .id(this.controlPrefix + '_pending')
                            .fontSize(FontSize.small)
                            .lineHeight(LineHeight.caption)
                            .fontColor($r('app.color.text_secondary'))
                            .textAlign(TextAlign.End);
                    }
                }.id(this.controlPrefix + '_timeline_axis')
                    .width('100%')
                    .padding({ right: Space.xl, bottom: Space.xl })
                    .alignItems(HorizontalAlign.End)
                    .border({ width: { right: Size.divider }, color: $r('app.color.border') });

                Row().id(this.controlPrefix + '_timeline_dot')
                    .width(Space.sm).height(Space.sm).borderRadius(Radius.full)
                    .backgroundColor($r('app.color.border_strong'))
                    .position({ right: -Space.xs, top: Space.sm });
            }.width('100%');
        }.id(this.controlPrefix).width('100%').padding({ right: Space.sm });
    }
}
