// BackendConnectionSheet.ets - 登录前调整可部署后端的连接地址
// 地址只作为登录草稿，登录成功后由 AppState 统一保存。

import { FontSize, Radius, Size, Space } from '../../common/DesignToken';

@Component
export struct BackendConnectionSheet {
    @Link backendUrl: string;
    onClose: () => void = () => {};

    build() {
        Column({ space: Space.lg }) {
            Row() {
                Text('后端连接')
                    .fontSize(FontSize.title)
                    .fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_primary'))
                    .layoutWeight(1);

                Image($r('app.media.ic_close'))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor($r('app.color.text_secondary'))
                    .padding(Space.sm)
                    .onClick(() => {
                        this.onClose();
                    });
            }
            .width('100%');

            Text('部署地址')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .width('100%');

            TextInput({ placeholder: 'https://your-server.example', text: this.backendUrl })
                .type(InputType.Normal)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .caretColor($r('app.color.brand_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .backgroundColor($r('app.color.bg_sunken'))
                .borderRadius(Radius.md)
                .padding({ left: Space.md, right: Space.md })
                .height(48)
                .width('100%')
                .onChange((value: string) => {
                    this.backendUrl = value;
                });

            Text('登录时将连接到此地址')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'))
                .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .alignItems(HorizontalAlign.Start);
    }
}
