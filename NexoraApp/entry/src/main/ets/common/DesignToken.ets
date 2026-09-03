// DesignToken.ets - 视觉度量与动效常量
// 颜色主题走 resources 下的 base/dark 资源（自动跟随系统深色模式），本文件只管与主题无关的度量与动效
// 组件内禁止硬编码圆角 / 间距 / 字号 / 时长，统一引用本文件的常量

import { curves } from '@kit.ArkUI';

// 圆角：越大越柔和，整体走大圆角风格
export class Radius {
    static readonly xs: number = 6;
    static readonly sm: number = 10;
    static readonly md: number = 14;
    static readonly lg: number = 18;
    static readonly xl: number = 24;
    static readonly full: number = 999;
}

// 间距：4 的倍数，页面级留白使用 Space
export class Space {
    static readonly xxs: number = 2;
    static readonly xs: number = 4;
    static readonly sm: number = 8;
    static readonly md: number = 12;
    static readonly lg: number = 16;
    static readonly xl: number = 20;
    static readonly xxl: number = 24;
    static readonly xxxl: number = 32;
}

// 字号：正文 15、辅助 13、标题梯度上浮
export class FontSize {
    static readonly micro: number = 10;
    static readonly caption: number = 11;
    static readonly small: number = 12;
    static readonly body: number = 15;
    static readonly bodyLarge: number = 16;
    static readonly title: number = 18;
    static readonly titleLarge: number = 22;
    static readonly display: number = 28;
}

// 行高：以字号倍率表达，保证同一段内行盒一致（修复旧版混用字号导致的文本偏移）
export class LineHeight {
    static readonly body: number = 25;
    static readonly bodyCode: number = 22;
    static readonly caption: number = 18;
    static readonly title: number = 26;
    static readonly display: number = 38;
}

// 控件尺寸
export class Size {
    static readonly iconSmall: number = 16;
    static readonly icon: number = 20;
    static readonly iconLarge: number = 24;
    static readonly avatar: number = 32;
    static readonly avatarLarge: number = 40;
    static readonly touchTarget: number = 44;
    static readonly sendButton: number = 36;
    static readonly inputMinHeight: number = 44;
    static readonly inputMaxHeight: number = 120;
    static readonly divider: number = 0.5;
}

// 阴影：分层表达层级关系，颜色为低透明度黑，深浅模式通用
export class Shadow {
    static readonly none: ShadowOptions = { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 };
    static readonly card: ShadowOptions = { radius: 16, color: '#140F1E0F', offsetX: 0, offsetY: 4 };
    static readonly raised: ShadowOptions = { radius: 24, color: '#140F1E1A', offsetX: 0, offsetY: 8 };
    static readonly float: ShadowOptions = { radius: 32, color: '#140F1E29', offsetX: 0, offsetY: 12 };
}

// 动效：统一时长与插值曲线，消除硬出现硬消失
export class Motion {
    static readonly durationFast: number = 160;
    static readonly durationBase: number = 240;
    static readonly durationSlow: number = 400;

    // 弹性曲线：用于弹层、按压回弹、列表插入
    static readonly spring: ICurve = curves.springMotion(0.42, 0.86);
    static readonly springSoft: ICurve = curves.springMotion(0.55, 0.92);
    // 缓出曲线：用于透明度淡入淡出
    static readonly easeOut: ICurve = curves.cubicBezierCurve(0.22, 1, 0.36, 1);
    static readonly easeInOut: ICurve = curves.cubicBezierCurve(0.4, 0, 0.2, 1);
}

// 按压态缩放：配合 scale 与 spring 使用
export class PressScale {
    static readonly normal: number = 1;
    static readonly pressed: number = 0.96;
    static readonly pressedDeep: number = 0.92;
}

// 入场动画延迟：用于首页各区域交错出现
export class StaggerDelay {
    static readonly greeting: number = 0;
    static readonly input: number = 80;
    static readonly actions: number = 160;
    static readonly recent: number = 240;
    static readonly actionCardBase: number = 40;
    static readonly actionCardStep: number = 60;
}

// 发光效果：用于装饰背景球和聚焦态
export class Glow {
    static readonly brandRadius: number = 120;
    static readonly brandOpacity: number = 0.12;
    static readonly secondaryRadius: number = 80;
    static readonly secondaryOpacity: number = 0.08;
    static readonly focusRadius: number = 20;
    static readonly focusOpacity: number = 0.15;
}

// 脉冲动画：用于连接状态指示器
export class Pulse {
    static readonly minScale: number = 0.85;
    static readonly maxScale: number = 1.15;
    static readonly minOpacity: number = 0.4;
    static readonly maxOpacity: number = 1;
    static readonly duration: number = 1600;
}

// 呼吸动画：用于空状态引导图标
export class Breathe {
    static readonly minScale: number = 0.95;
    static readonly maxScale: number = 1.05;
    static readonly duration: number = 2000;
}
