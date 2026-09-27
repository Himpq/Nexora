import { FontSize, Motion, Radius, Shadow, Size, Space } from '../../common/DesignToken';

// Agent owns its draft and transport; the card shares the main conversation's input shape.
@Component
export struct LearningAgentInput {
    @Link draft: string;
    @Prop sending: boolean = false;
    @Prop statusLabel: string = 'Agent 正在回应…';
    @Prop contextLabel: string = '';
    @StorageProp('insetBottom') private insetBottom: number = 0;
    @State private focused: boolean = false;
    onSend: () => void = () => {};

    build() {
        Column({ space: Space.sm }) {
            TextArea({ placeholder: '向 Agent 发送消息，继续今天的学习…', text: $$this.draft })
                .id('agent_input').fontSize(FontSize.body).fontColor($r('app.color.text_primary'))
                .caretColor($r('app.color.brand_primary')).backgroundColor(Color.Transparent)
                .borderRadius(0).padding(0)
                .constraintSize({ minHeight: Size.iconLarge, maxHeight: Size.inputMaxHeight })
                .maxLines(6).maxLength(3000)
                .onFocus(() => { this.focused = true; })
                .onBlur(() => { this.focused = false; })
            Row({ space: Space.sm }) {
                Row({ space: Space.xs }) {
                    Image($r('app.media.ic_spark')).width(Size.iconSmall).height(Size.iconSmall)
                        .fillColor($r('app.color.icon_secondary'))
                    Text(this.sending ? this.statusLabel : 'Agent' + (this.contextLabel.length > 0 ? ' · ' + this.contextLabel : ' · 学习模式'))
                        .fontSize(FontSize.caption).fontColor($r('app.color.text_secondary'))
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }.constraintSize({ maxWidth: '76%' })
                    .padding({ left: Space.md, right: Space.md, top: Space.xs, bottom: Space.xs })
                    .borderRadius(Radius.full).backgroundColor($r('app.color.bg_sunken'))
                Blank()
                Button({ type: ButtonType.Circle }) {
                    if (this.sending) {
                        LoadingProgress().width(Size.icon).height(Size.icon).color($r('app.color.text_inverse'))
                    } else {
                        Image($r('app.media.ic_send')).width(Size.icon).height(Size.icon).fillColor($r('app.color.text_inverse'))
                    }
                }.id('agent_send').width(Size.touchTarget).height(Size.touchTarget)
                    .backgroundColor($r('app.color.brand_primary'))
                    .enabled(!this.sending && this.draft.trim().length > 0)
                    .accessibilityText(this.sending ? 'Agent 正在回应' : '发送给 Agent')
                    .onClick(() => { this.onSend(); })
            }.width('100%').alignItems(VerticalAlign.Center)
        }.id('agent_ask').width('100%')
            .padding({ left: Space.lg, right: Space.xs, top: Space.lg, bottom: Space.md })
            .margin({ bottom: this.insetBottom }).borderRadius(Radius.xl)
            .backgroundColor($r('app.color.bg_card')).shadow(Shadow.card)
            .border({ width: this.focused ? 1 : 0, color: $r('app.color.brand_primary') })
            .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
    }
}
