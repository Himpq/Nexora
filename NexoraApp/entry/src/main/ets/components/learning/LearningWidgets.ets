// LearningWidgets.ets - 学习工作区共用展示单元
// 首页 / 课程 / 题库 / 资源 / 画像五个页面共用同一套区块外壳、统计块、进度条与占位态，
// 避免每个页面各写一份导致样式漂移（本工程禁止重复代码）。

import { FontSize, LineHeight, Motion, PressScale, Radius, Size, Space } from '../../common/DesignToken';
import { RemoteImage } from '../chat/RemoteImage';

// 区块标题：标题 +（可选）同行说明 +（可选）右侧动作
// 刻意不用品牌色竖条：一页里会重复出现四五个区块标题，装饰条会让层级互相抵消、页面变吵；
// 说明文字降为 caption 并与标题同行，避免每块都占两行标题高度
@Component
export struct SectionHeader {
    @Prop title: string = '';
    @Prop subtitle: string = '';
    @Prop actionLabel: string = '';
    onAction: () => void = () => {};

    build() {
        Row({ space: Space.sm }) {
            Text(this.title)
                .fontSize(FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'));

            if (this.subtitle.length > 0) {
                Text(this.subtitle)
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);
            } else {
                Blank();
            }

            if (this.actionLabel.length > 0) {
                Text(this.actionLabel)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_brand'))
                    .padding({ left: Space.sm, right: Space.xs, top: Space.xs, bottom: Space.xs })
                    .onClick(() => {
                        this.onAction();
                    });
            }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center);
    }
}

// 统计块：数值 + 说明，用于首页概览
@Component
export struct StatTile {
    @Prop value: string = '';
    @Prop label: string = '';
    @Prop tint: ResourceColor = $r('app.color.text_primary');

    build() {
        Column({ space: Space.xs }) {
            Text(this.value)
                .fontSize(FontSize.titleLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.tint);

            Text(this.label)
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_tertiary'));
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Center);
    }
}

// 进度条：轨道 + 填充，比例自动收敛到 0..1
@Component
export struct ProgressTrack {
    @Prop ratio: number = 0;
    @Prop trackHeight: number = 6;
    @Prop tint: ResourceColor = $r('app.color.brand_primary');
    @Prop trackColor: ResourceColor = $r('app.color.bg_sunken');

    build() {
        Row() {
            Row()
                .width(Math.round(ProgressTrack.clamp(this.ratio) * 100) + '%')
                .height(this.trackHeight)
                .borderRadius(this.trackHeight / 2)
                .backgroundColor(this.tint);
        }
        .width('100%')
        .height(this.trackHeight)
        .borderRadius(this.trackHeight / 2)
        .backgroundColor(this.trackColor);
    }

    private static clamp(ratio: number): number {
        if (ratio < 0) {
            return 0;
        }

        return ratio > 1 ? 1 : ratio;
    }
}

// 小标签：分类 / 状态 / 徽标
@Component
export struct TagPill {
    @Prop text: string = '';
    @Prop tint: ResourceColor = $r('app.color.chip_text');
    @Prop bg: ResourceColor = $r('app.color.chip_bg');

    build() {
        Text(this.text)
            .fontSize(FontSize.micro)
            .fontColor(this.tint)
            .maxLines(1)
            .padding({ left: Space.sm, right: Space.sm, top: Space.xxs, bottom: Space.xxs })
            .borderRadius(Radius.xs)
            .backgroundColor(this.bg);
    }
}

// 占位态：空数据 / 失败 / 未启用统一外观，动作按钮可选
@Component
export struct Placeholder {
    @Prop icon: ResourceStr = $r('app.media.ic_book');
    @Prop title: string = '';
    @Prop hint: string = '';
    @Prop actionLabel: string = '';
    // 配色默认走系统色；固定色板表面（阅读器纸张）需注入自己的色阶
    @Prop iconColor: ResourceColor = $r('app.color.icon_secondary');
    @Prop titleColor: ResourceColor = $r('app.color.text_secondary');
    @Prop hintColor: ResourceColor = $r('app.color.text_tertiary');
    @Prop actionBg: ResourceColor = $r('app.color.brand_soft');
    @Prop actionFg: ResourceColor = $r('app.color.text_brand');
    onAction: () => void = () => {};

    build() {
        Column({ space: Space.sm }) {
            Image(this.icon)
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor(this.iconColor);

            Text(this.title)
                .fontSize(FontSize.bodyLarge)
                .fontColor(this.titleColor)
                .textAlign(TextAlign.Center);

            if (this.hint.length > 0) {
                Text(this.hint)
                    .fontSize(FontSize.small)
                    .fontColor(this.hintColor)
                    .textAlign(TextAlign.Center)
                    .lineHeight(LineHeight.caption);
            }

            if (this.actionLabel.length > 0) {
                Text(this.actionLabel)
                    .fontSize(FontSize.small)
                    .fontColor(this.actionFg)
                    .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.sm })
                    .borderRadius(Radius.full)
                    .backgroundColor(this.actionBg)
                    .margin({ top: Space.xs })
                    .onClick(() => {
                        this.onAction();
                    });
            }
        }
        .width('100%')
        .padding({ top: Space.xxxl, bottom: Space.xxxl, left: Space.xl, right: Space.xl })
        .alignItems(HorizontalAlign.Center);
    }
}

// 加载态：转圈 + 文案
@Component
export struct LoadingBlock {
    @Prop label: string = '加载中';

    build() {
        Column({ space: Space.md }) {
            LoadingProgress()
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .color($r('app.color.brand_primary'));

            Text(this.label)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .padding({ top: Space.xxxl, bottom: Space.xxxl })
        .alignItems(HorizontalAlign.Center);
    }
}

// 通用卡片外壳：统一圆角、内边距与按压反馈
@Component
export struct CardShell {
    @Prop contentPadding: number = Space.lg;
    @Prop cardBg: ResourceColor = $r('app.color.bg_card');
    @Prop borderTint: ResourceColor = Color.Transparent;
    onTap: () => void = () => {};

    @BuilderParam content: () => void;

    @State private pressed: boolean = false;

    build() {
        Column() {
            this.content();
        }
        .width('100%')
        .padding(this.contentPadding)
        .borderRadius(Radius.lg)
        .backgroundColor(this.cardBg)
        .border({ width: 1, color: this.borderTint })
        .scale({
            x: this.pressed ? PressScale.pressed : PressScale.normal,
            y: this.pressed ? PressScale.pressed : PressScale.normal,
        })
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.pressed = true;
            } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressed = false;
            }
        })
        .onClick(() => {
            this.onTap();
        });
    }
}

// 封面图：课程封面与教材封面共用。
// 有 cover_path 时交给 RemoteImage（经图片缓存下载后以 file:// 展示，网络下载不走 ArkUI Image 直连）；
// 后端未下发封面（cover_path 为空串）是真实状态，此时显示品牌色底 + 图标，
// 而不是 RemoteImage 的「加载失败」——缺封面与下载失败是两件不同的事，不能混为一谈。
@Component
export struct CoverImage {
    @Prop source: string = '';
    @Prop icon: ResourceStr = $r('app.media.ic_book');
    @Prop frameWidth: number = 56;
    @Prop frameHeight: number = 56;
    @Prop corner: number = Radius.md;
    onOpen: (localPath: string) => void = () => {};

    build() {
        if (this.source.length > 0) {
            RemoteImage({
                source: this.source,
                frameWidth: this.frameWidth,
                frameHeight: this.frameHeight,
                fit: ImageFit.Cover,
                corner: this.corner,
                onOpen: this.onOpen,
            })
        } else {
            Stack() {
                Image(this.icon)
                    .width(CoverImage.iconRatio(this.frameWidth))
                    .height(CoverImage.iconRatio(this.frameWidth))
                    .fillColor($r('app.color.brand_primary'));
            }
            .width(this.frameWidth)
            .height(this.frameHeight)
            .borderRadius(this.corner)
            .backgroundColor($r('app.color.brand_soft'));
        }
    }

    // 无封面时的图标尺寸跟随封面框长边，避免小框里出现过大图标
    private static iconRatio(frameWidth: number): number {
        return Math.max(Size.icon, Math.round(frameWidth * 0.42));
    }
}
