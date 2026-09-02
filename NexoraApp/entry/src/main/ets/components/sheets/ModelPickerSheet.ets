// ModelPickerSheet.ets - 模型选择面板（bindSheet 内容）
// 半模态抽屉里平铺模型清单，选中项打勾，点击即切换并回写持久化

import { ModelItem } from '../../common/AppConfig';
import { AppState } from '../../common/AppState';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct ModelPickerSheet {
    @ObjectLink app: AppState;
    onPicked: (modelId: string) => void = () => {};

    build() {
        Column({ space: Space.sm }) {
            Column()
                .width(36)
                .height(4)
                .borderRadius(Radius.full)
                .backgroundColor($r('app.color.border_strong'))
                .margin({ top: Space.sm, bottom: Space.xs });

            Text('选择模型')
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .width('100%')
                .padding({ left: Space.lg, bottom: Space.sm });

            if (this.app.models.length === 0) {
                this.EmptyHint();
            } else {
                List({ space: Space.xs }) {
                    ForEach(this.app.models, (model: ModelItem) => {
                        ListItem() {
                            this.ModelRow(model);
                        }
                        .padding({ left: Space.md, right: Space.md });
                    }, (model: ModelItem) => model.id);
                }
                .layoutWeight(1)
                .divider({ strokeWidth: 0 })
                .padding({ bottom: Space.xl });
            }
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    @Builder
    ModelRow(model: ModelItem) {
        Row({ space: Space.md }) {
            Column({ space: Space.xxs }) {
                Text(model.name)
                    .fontSize(FontSize.body)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });

                Text(this.describe(model))
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            if (model.id === this.app.selectedModelId) {
                Image($r('app.media.ic_check'))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor($r('app.color.brand_primary'));
            }
        }
        .width('100%')
        .padding({ left: Space.md, right: Space.md, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor(model.id === this.app.selectedModelId
            ? $r('app.color.brand_soft')
            : $r('app.color.bg_card'))
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        .onClick(() => {
            this.onPicked(model.id);
        });
    }

    @Builder
    EmptyHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_cloud'))
                .width(32)
                .height(32)
                .fillColor($r('app.color.icon_secondary'));

            Text('暂无可用模型，请在设置中检查后端地址')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .height(160)
        .justifyContent(FlexAlign.Center);
    }

    private describe(model: ModelItem): string {
        if (model.provider.length === 0) {
            return model.id;
        }

        if (model.contextWindow === undefined) {
            return model.provider;
        }

        return model.provider + ' · 上下文 ' + Math.floor(model.contextWindow / 1024) + 'K';
    }
}
