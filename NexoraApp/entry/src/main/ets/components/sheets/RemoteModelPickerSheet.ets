import { RemoteModel } from '../../common/NexoraCodeApi';
import { FontSize, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct RemoteModelPickerSheet {
    @Prop models: RemoteModel[] = [];
    @Prop selectedId: string = '';
    onPicked: (modelId: string, label: string) => void = (_modelId: string, _label: string): void => {};

    build() {
        Column({ space: Space.sm }) {
            Column()
                .width(36)
                .height(4)
                .borderRadius(Radius.full)
                .backgroundColor($r('app.color.border_strong'))
                .margin({ top: Space.sm, bottom: Space.xs });

            Text('选择电脑模型')
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .width('100%')
                .textAlign(TextAlign.Start)
                .padding({ left: Space.lg, bottom: Space.sm });

            if (this.models.length === 0) {
                Text('这台电脑没有可用模型')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_tertiary'))
                    .width('100%')
                    .textAlign(TextAlign.Start)
                    .padding({ left: Space.lg, right: Space.lg, top: Space.xl });
            } else {
                List({ space: Space.xs }) {
                    ForEach(this.models, (model: RemoteModel) => {
                        ListItem() {
                            Row({ space: Space.md }) {
                                Column({ space: Space.xxs }) {
                                    Text(model.name)
                                        .fontSize(FontSize.body)
                                        .fontWeight(FontWeight.Medium)
                                        .fontColor($r('app.color.text_primary'))
                                        .width('100%')
                                        .textAlign(TextAlign.Start)
                                        .maxLines(1)
                                        .textOverflow({ overflow: TextOverflow.Ellipsis });
                                    Text(model.provider + ' · ' + model.id)
                                        .fontSize(FontSize.caption)
                                        .fontColor($r('app.color.text_tertiary'))
                                        .width('100%')
                                        .textAlign(TextAlign.Start)
                                        .maxLines(1)
                                        .textOverflow({ overflow: TextOverflow.Ellipsis });
                                }
                                .layoutWeight(1)
                                .alignItems(HorizontalAlign.Start);

                                if (model.id === this.selectedId) {
                                    Image($r('app.media.ic_check'))
                                        .width(Size.icon)
                                        .height(Size.icon)
                                        .fillColor($r('app.color.brand_primary'));
                                }
                            }
                            .width('100%')
                            .padding({ left: Space.md, right: Space.md, top: Space.md, bottom: Space.md })
                            .borderRadius(Radius.lg)
                            .backgroundColor(model.id === this.selectedId
                                ? $r('app.color.brand_soft') : $r('app.color.bg_card'))
                            .onClick(() => this.onPicked(model.id, model.name + ' · ' + model.provider));
                        }
                        .padding({ left: Space.md, right: Space.md });
                    }, (model: RemoteModel) => model.id);
                }
                .layoutWeight(1)
                .divider({ strokeWidth: 0 })
                .padding({ bottom: Space.xl });
            }
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .backgroundColor($r('app.color.bg_page'));
    }
}
