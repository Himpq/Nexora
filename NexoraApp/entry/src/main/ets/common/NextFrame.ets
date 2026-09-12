// NextFrame.ets - 把一次动作推迟到下一帧执行
// ArkUI 在状态变更后的那一帧才完成排版：流式回调里刚挂上的独立区块（工具结果 / 选择题 /
// 图片画廊）此时还没有真实高度，同步发起的 scrollToIndex 用的仍是旧高度，区块会落在视口
// 下方、表现为「自动滚动失效」。把滚动推到下一帧即可贴住排版完成后的真正底部。
// 官方亦要求 onSizeChange 等布局同步回调内改用本方式异步处理，避免改动被并入动画闭包。

import { FrameCallback } from '@kit.ArkUI';

export class NextFrameCallback extends FrameCallback {
    private readonly action: () => void;

    constructor(action: () => void) {
        super();
        this.action = action;
    }

    onFrame(frameTimeInNano: number): void {
        this.action();
    }
}
