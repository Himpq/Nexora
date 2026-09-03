// ListRows.ets - 设置类列表行
// 开关行 / 跳转行 / 危险操作行三种形态，统一图标尺寸、缩进与按压反馈

import { FontSize, Motion, Radius, Size, Space } from '../../common/DesignToken';

// 开关行：用于生成参数类开关
@Component
export struct SwitchRow {
    @Prop icon: ResourceStr;
    @Prop title: string;
    @Prop subtitle: string = '';
    @Prop checked: boolean = false;
    @Prop tint: ResourceColor = $r('app.color.brand_primary');
    onChanged: (checked: boolean) => void = () => {};

    build() {
        Row({ space: Space.md }) {
            Image(this.icon)
                .width(Size.icon)
                .height(Size.icon)
                .fillColor(this.tint);

            Column({ space: Space.xxs }) {
                Text(this.title)
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'));

                if (this.subtitle.length > 0) {
                    Text(this.subtitle)
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'));
                }
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            Toggle({ type: ToggleType.Switch, isOn: this.checked })
                .selectedColor($r('app.color.brand_primary'))
                .onChange((checked: boolean) => {
                    this.onChanged(checked);
                });
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'));
    }
}

// 跳转行：右侧展示当前值并带箭头
@Component
export struct NavRow {
    @Prop icon: ResourceStr;
    @Prop title: string;
    @Prop value: string = '';
    @Prop tint: ResourceColor = $r('app.color.icon_secondary');
    onTap: () => void = () => {};

    @State private pressed: boolean = false;

    build() {
        Row({ space: Space.md }) {
            Image(this.icon)
                .width(Size.icon)
                .height(Size.icon)
                .fillColor(this.tint);

            Text(this.title)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);

            if (this.value.length > 0) {
                Text(this.value)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    // 限宽保证超长当前值（如模型 "provider · 名称"）省略而非溢出把整行撑破
                    .constraintSize({ maxWidth: '45%' });
            }

            Image($r('app.media.ic_chevron_right'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.icon_secondary'));
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor(this.pressed ? $r('app.color.bg_hover') : $r('app.color.bg_card'))
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        .onTouch((event: TouchEvent) => {
            this.pressed = event.type === TouchType.Down;
        })
        .onClick(() => {
            this.onTap();
        });
    }
}

// 危险操作行：退出登录等破坏性入口
@Component
export struct DangerRow {
    @Prop title: string;
    @Prop icon: ResourceStr = $r('app.media.ic_logout');
    onTap: () => void = () => {};

    build() {
        Row({ space: Space.md }) {
            Image(this.icon)
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.text_danger'));

            Text(this.title)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_danger'))
                .layoutWeight(1);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .onClick(() => {
            this.onTap();
        });
    }
}
