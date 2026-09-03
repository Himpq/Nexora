// BrandLogo.ets - 品牌标识
// 渐变圆角底 + 火花图形，深浅模式共用一套渐变（品牌色本身已区分明暗）

import { Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct BrandLogo {
    @Prop diameter: number = Size.avatar;
    @Prop showShadow: boolean = true;

    build() {
        Stack() {
            Image($r('app.media.ic_spark'))
                .width(this.diameter * 0.55)
                .height(this.diameter * 0.55)
                .fillColor($r('app.color.text_inverse'));
        }
        .width(this.diameter)
        .height(this.diameter)
        .borderRadius(Radius.md)
        .linearGradient({
            angle: 135,
            colors: [
                [$r('app.color.brand_primary'), 0],
                [$r('app.color.brand_secondary'), 1]
            ]
        })
        .shadow(this.showShadow
            ? { radius: 8, color: '#334C6FFF', offsetX: 0, offsetY: 3 }
            : { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 });
    }
}

// 品牌文字：名称 + 可选副标题，用于首页与设置面板顶部
@Component
export struct BrandTitle {
    @Prop title: string = 'Nexora';
    @Prop subtitle: string = '';
    @Prop titleSize: number = 16;

    build() {
        Column({ space: Space.xxs }) {
            Text(this.title)
                .fontSize(this.titleSize)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'));

            if (this.subtitle.length > 0) {
                Text(this.subtitle)
                    .fontSize(11)
                    .fontColor($r('app.color.text_tertiary'));
            }
        }
        .alignItems(HorizontalAlign.Start);
    }
}
