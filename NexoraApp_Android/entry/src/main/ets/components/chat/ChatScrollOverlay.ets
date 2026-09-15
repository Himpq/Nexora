// ChatScrollOverlay.ets - 对话列表滚动期间的轻量覆盖层
//
// 底部按钮和轮次指示器都由 onScrollIndex 驱动。它们属于滚动反馈，
// 不应让 MainChat 的整棵页面树随可视索引变化而重新执行 build。
// 状态单独放在 @Observed 对象中，并由本组件通过 @ObjectLink 观察，
// 使高频变化只落在覆盖层自身。

import { FontSize, Radius, Shadow, Size, Space } from '../../common/DesignToken';
import { TurnIndicatorPanel } from './TurnIndicatorPanel';

@Observed
export class ChatScrollOverlayState {
    showScrollBottom: boolean = false;
    activeTurnIndex: number = -1;
}

@Component
export struct ChatScrollOverlay {
    @ObjectLink state: ChatScrollOverlayState;
    @Prop turnCount: number = 0;
    @Prop messagesExist: boolean = false;
    onJump: (turnIndex: number) => void = () => {};
    onRequirePreviews: () => string[] = () => [];
    onScrollToEnd: () => void = () => {};

    build() {
        Stack() {
            if (this.state.showScrollBottom && this.messagesExist) {
                Stack() {
                    this.ScrollBottomButton();
                }
                .alignContent(Alignment.BottomEnd)
                .width('100%')
                .height('100%')
                .padding({ right: Space.lg, bottom: Space.lg })
                .hitTestBehavior(HitTestMode.None);
            }

            if (this.turnCount >= 2) {
                Stack() {
                    TurnIndicatorPanel({
                        turnCount: this.turnCount,
                        activeIndex: this.state.activeTurnIndex,
                        onJump: (turnIndex: number) => {
                            this.onJump(turnIndex);
                        },
                        onRequirePreviews: (): string[] => {
                            return this.onRequirePreviews();
                        }
                    });
                }
                .alignContent(Alignment.End)
                .width('100%')
                .height('100%')
                .padding({ right: Space.sm })
                .hitTestBehavior(HitTestMode.None);
            }
        }
        .height('100%')
        .width('100%')
        // 覆盖层的空白区域必须把命中测试传给下面的 List；只有按钮和轮次指示器自身接收点击。
        .hitTestBehavior(HitTestMode.None);
    }

    // 回到底部浮动按钮：保持原有位置与点击行为，状态更新不再触发主页面重建。
    @Builder
    ScrollBottomButton() {
        Column() {
            Image($r('app.media.ic_chevron_down'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.icon_secondary'));
        }
        .width(Size.touchTarget)
        .height(Size.touchTarget)
        .justifyContent(FlexAlign.Center)
        .borderRadius(Size.touchTarget / 2)
        .backgroundColor($r('app.color.bg_card'))
        .shadow(Shadow.raised)
        .onClick(() => {
            this.onScrollToEnd();
        });
    }
}
