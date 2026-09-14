// ImageViewer.ets - 全屏图片查看器
// 黑色底 + Contain 适配，点击任意区域关闭（返回键由 MainChat 拦截）

import { Motion, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';

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

            // 半透明底衬：纯白图标压在任意图片上都可辨认；尺寸统一由 IconButton 约束
            IconButton({
                icon: $r('app.media.ic_close'),
                iconSize: Size.iconLarge,
                buttonSize: Size.touchTarget,
                tint: Color.White,
                bg: '#26FFFFFF',
                onTap: () => {
                    this.onClose();
                }
            })
                .margin({ top: Space.lg, right: Space.sm });
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
