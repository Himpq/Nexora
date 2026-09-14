// StreamingDots.ets - 生成中指示器
// 三点依次呼吸：靠 delay 制造固定相位差，三条无限循环动画自然形成波浪

import { Motion, Size, Space } from '../../common/DesignToken';

const DOT_SIZE: number = 6;
const DOT_DIM: number = 0.28;
const DOT_BRIGHT: number = 1;
const DOT_DURATION: number = 480;
const DOT_STEP_DELAY: number = 160;

@Component
export struct StreamingDots {
    @State private firstOpacity: number = DOT_DIM;
    @State private secondOpacity: number = DOT_DIM;
    @State private thirdOpacity: number = DOT_DIM;

    build() {
        Row({ space: Space.xs }) {
            this.Dot(this.firstOpacity);
            this.Dot(this.secondOpacity);
            this.Dot(this.thirdOpacity);
        }
        .height(Size.icon)
        .alignItems(VerticalAlign.Center)
        .onAppear(() => {
            this.playLoop();
        });
    }

    @Builder
    Dot(opacity: number) {
        Circle()
            .width(DOT_SIZE)
            .height(DOT_SIZE)
            .fill($r('app.color.brand_primary'))
            .opacity(opacity);
    }

    // 三条动画参数一致，仅 delay 递增，形成首尾相接的呼吸序列
    private playLoop(): void {
        animateTo({ duration: DOT_DURATION, delay: 0, curve: Curve.EaseInOut, iterations: -1, playMode: PlayMode.Alternate }, () => {
            this.firstOpacity = DOT_BRIGHT;
        });

        animateTo({ duration: DOT_DURATION, delay: DOT_STEP_DELAY, curve: Curve.EaseInOut, iterations: -1, playMode: PlayMode.Alternate }, () => {
            this.secondOpacity = DOT_BRIGHT;
        });

        animateTo({ duration: DOT_DURATION, delay: DOT_STEP_DELAY * 2, curve: Curve.EaseInOut, iterations: -1, playMode: PlayMode.Alternate }, () => {
            this.thirdOpacity = DOT_BRIGHT;
        });
    }
}
