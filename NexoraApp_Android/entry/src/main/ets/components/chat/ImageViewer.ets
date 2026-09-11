// ImageViewer.ets - 全屏图片查看器
// 黑色底 + Contain 适配，点击任意区域关闭（返回键由 MainChat 拦截）

import { Motion, Size, Space } from '../../common/DesignToken';

@Component
export struct ImageViewer {
    @Prop url: string = '';
    onClose: () => void = () => {};

    build() {
        Stack({ alignContent: Alignment.TopEnd }) {
            Image(this.url)
                .width('100%')
                .height('100%')
                .objectFit(ImageFit.Contain)
                .draggable(false)
                .onError(() => {
                    this.onClose();
                });

            Image($r('app.media.ic_close'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor(Color.White)
                .margin({ top: Space.xl, right: Space.lg })
                .padding(Space.sm)
                .onClick(() => {
                    this.onClose();
                });
        }
        .width('100%')
        .height('100%')
        .backgroundColor(Color.Black)
        .onClick(() => {
            this.onClose();
        })
        .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationFast, curve: Motion.easeOut }));
    }
}
