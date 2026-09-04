// QuickActionGrid.ets - 首页快捷能力宫格
// 两列卡片，点击后把对应提示词写入输入框，用户接着补充具体内容即可发送
// 每张卡片有独立的按压态（缩放+阴影+边框联动）和交错入场动画

import { QuickAction } from '../common/AppConfig';
import { FontSize, LineHeight, Motion, PressScale, Radius, Shadow, Size, Space, StaggerDelay } from '../common/DesignToken';

@Component
export struct QuickActionGrid {
    @Prop actions: QuickAction[];
    @Prop activatedId: string = '';
    onPick: (action: QuickAction) => void = () => {};

    // 每张卡片的按压态独立管理，避免一个按下影响全部
    @State private pressedIds: Map<string, boolean> = new Map();

    // 交错入场动画状态
    @State private visible: boolean = false;

    aboutToAppear(): void {
        setTimeout(() => { this.visible = true; }, StaggerDelay.actions);
    }

    build() {
        Grid() {
            ForEach(this.actions, (action: QuickAction, index: number) => {
                GridItem() {
                    this.ActionCard(action, index);
                }
            }, (action: QuickAction) => action.id);
        }
        .columnsTemplate('1fr 1fr')
        .columnsGap(Space.md)
        .rowsGap(Space.md)
        .width('100%')
        // 固定高度撑开两行，避免懒加载容器在无高度约束下只渲染首行
        .height(264);
    }

    @Builder
    ActionCard(action: QuickAction, index: number) {
        Column({ space: Space.xs }) {
            Column() {
                Image(this.iconOf(action.id))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor(action.id === this.activatedId
                        ? $r('app.color.text_brand')
                        : $r('app.color.icon_secondary'));
            }
            .width(36)
            .height(36)
            .justifyContent(FlexAlign.Center)
            .borderRadius(Radius.sm)
            .backgroundColor(action.id === this.activatedId
                ? $r('app.color.brand_soft')
                : $r('app.color.bg_sunken'))
            .animation({ duration: Motion.durationFast, curve: Motion.easeOut });

            Text(action.label)
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1);

            Text(action.hint)
                .fontSize(FontSize.caption)
                .lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_tertiary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(Space.md)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .border({
            width: action.id === this.activatedId ? 1.5 : 0,
            color: $r('app.color.brand_primary')
        })
        .shadow(this.isPressed(action.id)
            ? Shadow.raised
            : action.id === this.activatedId
                ? Shadow.card
                : Shadow.none)
        .scale({
            x: this.isPressed(action.id) ? PressScale.pressedDeep : PressScale.normal,
            y: this.isPressed(action.id) ? PressScale.pressedDeep : PressScale.normal
        })
        .animation({ duration: Motion.durationFast, curve: Motion.spring })
        // 交错入场：每张卡片延迟出现
        .opacity(this.visible ? 1 : 0)
        .translate({ y: this.visible ? 0 : 20 })
        .animation({
            duration: Motion.durationBase,
            curve: Motion.easeOut,
            delay: index * StaggerDelay.actionCardStep
        })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.pressedIds.set(action.id, true);
            } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressedIds.set(action.id, false);
            }
        })
        .onClick(() => {
            this.onPick(action);
        });
    }

    private isPressed(actionId: string): boolean {
        return this.pressedIds.get(actionId) === true;
    }

    private iconOf(actionId: string): ResourceStr {
        if (actionId === 'deep_think') {
            return $r('app.media.ic_thinking');
        }

        if (actionId === 'web_search') {
            return $r('app.media.ic_search');
        }

        if (actionId === 'knowledge') {
            return $r('app.media.ic_book');
        }

        return $r('app.media.ic_edit');
    }
}
