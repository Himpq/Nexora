// IconButton.ets - 通用图标按钮
// 统一按压回弹与禁用态表现，全 App 的图标点击入口都走这里，避免各处重复写 onTouch + scale

import { Motion, PressScale, Size } from '../../common/DesignToken';

@Component
export struct IconButton {
    @Prop icon: ResourceStr;
    @Prop iconSize: number = Size.icon;
    @Prop buttonSize: number = Size.touchTarget;
    @Prop tint: ResourceColor = $r('app.color.icon_secondary');
    @Prop bg: ResourceColor = Color.Transparent;
    @Prop isEnabled: boolean = true;
    onTap: () => void = () => {};

    @State private pressed: boolean = false;

    build() {
        Column() {
            Image(this.icon)
                .width(this.iconSize)
                .height(this.iconSize)
                .fillColor(this.tint);
        }
        .width(this.buttonSize)
        .height(this.buttonSize)
        .justifyContent(FlexAlign.Center)
        .borderRadius(this.buttonSize / 2)
        .backgroundColor(this.bg)
        .opacity(this.isEnabled ? 1 : 0.35)
        .scale({ x: this.pressed ? PressScale.pressed : PressScale.normal, y: this.pressed ? PressScale.pressed : PressScale.normal })
        .animation({ duration: Motion.durationFast, curve: Motion.spring })
        .onTouch((event: TouchEvent) => {
            if (!this.isEnabled) {
                return;
            }

            this.pressed = event.type === TouchType.Down;
        })
        .onClick(() => {
            if (this.isEnabled) {
                this.onTap();
            }
        });
    }
}
