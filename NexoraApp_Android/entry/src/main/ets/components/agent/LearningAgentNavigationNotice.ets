import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';

// Navigation feedback stays above the scrollable content, including when opening a chapter near the bottom.
@Component
export struct LearningAgentNavigationNotice {
    @Prop opening: boolean = false;
    @Prop errorText: string = '';
    @Prop loadingText: string = '正在打开教材…';
    @Prop controlPrefix: string = 'agent_navigation';

    build() {
        if (this.opening || this.errorText.length > 0) {
            Column() {
                Row({ space: Space.sm }) {
                    if (this.opening) {
                        LoadingProgress().width(Size.icon).height(Size.icon).color($r('app.color.brand_primary'));
                    }
                    Text(this.opening ? this.loadingText : this.errorText)
                        .fontSize(FontSize.small).lineHeight(LineHeight.caption).layoutWeight(1)
                        .fontColor(this.opening ? $r('app.color.text_secondary') : $r('app.color.text_danger'));
                }.width('100%').alignItems(VerticalAlign.Top).padding(Space.md)
                    .borderRadius(Radius.md).backgroundColor($r('app.color.bg_card'))
                    .id(this.controlPrefix + (this.opening ? '_loading' : '_error'));
            }.width('100%').padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.sm });
        }
    }
}
