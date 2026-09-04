/**
 * §8 设计令牌：全部色值只出现在本目录（pages/ components/ 下禁止硬编码色值）。
 * 主题「夜与晨」（重构方案 §二·第三步）：
 *   夜色靛蓝承载它工作的时段（night），晨光橙承载它报告的时刻（dawn），白天用暖纸色。
 * 深色成套定义，通过 AppStorage('nxDarkMode') 切换。旧字段（primary/accent/gradient*）保留语义：
 *   primary = night，accent = dawn，其余页面无需改动即可换肤。
 */
export interface NxPalette {
  primary: string;
  primarySoft: string;
  gradientStart: string;
  gradientEnd: string;
  surface1: string;
  surface2: string;
  surface3: string;
  /** 页面为「凹」、卡片为「凸」：两套里卡片都比页面亮。 */
  pageBg: string;
  cardBg: string;
  /** 更高一层的卡片底：unattended 条目与产出物卡。 */
  cardBgRaised: string;
  text1: string;
  text2: string;
  text3: string;
  text4: string;
  danger: string;
  success: string;
  warning: string;
  highlight: string;
  border: string;
  accent: string;
  /** 渐变/主色底上的主文字。 */
  onPrimary: string;
  /** 渐变/主色底上的次级文字（半透明白）。 */
  onPrimarySoft: string;
  /** 渐变/主色底上的次级块底（半透明白）。 */
  onPrimaryFill: string;
  overlay: string;
  /** 夜：它在工作的时段。 */
  night: string;
  nightSoft: string;
  /** 晨：它报告的时刻。 */
  dawn: string;
  dawnSoft: string;
  /** 时间轴的轨道线。 */
  rail: string;
  /** 克制条目（agent_hold）的淡色文字。 */
  holdInk: string;
}

export const NxLightPalette: NxPalette = {
  primary: '#2B2D5C',
  primarySoft: '#E6E7F5',
  gradientStart: '#2B2D5C',
  gradientEnd: '#4A4D8C',
  surface1: '#FFFFFF',
  surface2: '#F1EEE6',
  surface3: '#E8E4DA',
  pageBg: '#F7F5F0',
  cardBg: '#FFFFFF',
  cardBgRaised: '#FFFDF8',
  text1: '#1C1A24',
  text2: '#4D4A5C',
  text3: '#7D7A8C',
  text4: '#B1AFBB',
  danger: '#A83A3A',
  success: '#2F7A4F',
  warning: '#B3541E',
  highlight: '#F2C94C',
  border: '#E2DFD6',
  accent: '#C8641E',
  onPrimary: '#FFFFFF',
  onPrimarySoft: '#D6FFFFFF',
  onPrimaryFill: '#2EFFFFFF',
  overlay: '#33000000',
  night: '#2B2D5C',
  nightSoft: '#E6E7F5',
  dawn: '#C8641E',
  dawnSoft: '#FBE9DB',
  rail: '#E2DFD6',
  holdInk: '#9A97A8',
};

export const NxDarkPalette: NxPalette = {
  primary: '#9DA0E6',
  primarySoft: '#262A4D',
  gradientStart: '#2B2D5C',
  gradientEnd: '#3D4080',
  surface1: '#1E1E28',
  surface2: '#262632',
  surface3: '#30303D',
  pageBg: '#15151C',
  cardBg: '#1E1E28',
  cardBgRaised: '#23232F',
  text1: '#ECEBF2',
  text2: '#BDBBCB',
  text3: '#8B889B',
  text4: '#5C5A6B',
  danger: '#E07070',
  success: '#6CC08B',
  warning: '#E6934F',
  highlight: '#F5C84B',
  border: '#33323F',
  accent: '#E88A45',
  onPrimary: '#FFFFFF',
  onPrimarySoft: '#D6FFFFFF',
  onPrimaryFill: '#2EFFFFFF',
  overlay: '#66000000',
  night: '#9DA0E6',
  nightSoft: '#262A4D',
  dawn: '#E88A45',
  dawnSoft: '#3D2A1C',
  rail: '#33323F',
  holdInk: '#6E6C7D',
};

export function nxPalette(dark: boolean): NxPalette {
  return dark ? NxDarkPalette : NxLightPalette;
}

/** 掌握度热力色阶（面二热力图）。色值只允许出现在本文件（§8）。 */
const NxHeatLight: string[] = ['#EEEEF6', '#CFD0EA', '#A5A7D6', '#6F72B0', '#2B2D5C'];
const NxHeatDark: string[] = ['#1D1D2C', '#262A4D', '#3A3E78', '#5E62A8', '#9DA0E6'];

/** mastery ∈ [0,1] → 热力底色。 */
export function nxHeatColor(mastery: number, dark: boolean): string {
  const scale: string[] = dark ? NxHeatDark : NxHeatLight;
  let level: number = Math.floor(mastery * scale.length);
  if (level < 0) {
    level = 0;
  }
  if (level >= scale.length) {
    level = scale.length - 1;
  }
  return scale[level];
}

/** 热力格上的文字色：深格用反白，浅格用正文色，保证两端都可读。 */
export function nxHeatTextColor(mastery: number, dark: boolean): string {
  const palette: NxPalette = nxPalette(dark);
  return mastery >= 0.6 ? palette.onPrimary : palette.text2;
}

/**
 * 阅读器专属主题（纸 / 羊皮 / 夜）。阅读器的深浅独立于 App 全局深色模式：
 * 用户在书里换到夜色，不该把时间线也翻成深色。色值只允许出现在本文件（§8）。
 */
export interface NxReaderTheme {
  id: string;
  label: string;
  /** 纸面。 */
  bg: string;
  /** 正文。 */
  ink: string;
  /** 章名 / 页码等附注。 */
  inkSoft: string;
  /** 划线颜色。 */
  underline: string;
  /** 选中 / 划线句子的淡底。 */
  markBg: string;
  /** 荧光笔填充。 */
  markFill: string;
  /** 顶栏小字（章名 / 时间电量）。 */
  chromeInk: string;
  /** 浮动操作条（长按菜单、底部面板）底色与文字。 */
  barBg: string;
  barInk: string;
  barInkSoft: string;
  /** 操作条上的强调项（问AI）。 */
  barAccent: string;
  /** 主题选择圆点的展示色。 */
  swatch: string;
  /** 该主题下的 sheet / 面板走深色还是浅色令牌。 */
  dark: boolean;
}

export const NxReaderThemes: NxReaderTheme[] = [
  {
    id: 'paper',
    label: '纸',
    bg: '#F7F3EA',
    ink: '#2A2622',
    inkSoft: '#8E8779',
    underline: '#C8641E',
    markBg: '#33E0B070',
    markFill: '#66F2C94C',
    chromeInk: '#8E8779',
    barBg: '#FFFFFFFF',
    barInk: '#2A2622',
    barInkSoft: '#7D7A8C',
    barAccent: '#2B2D5C',
    swatch: '#F7F3EA',
    dark: false,
  },
  {
    id: 'sepia',
    label: '羊皮',
    bg: '#E9DCC3',
    ink: '#3B2F22',
    inkSoft: '#8F7B5E',
    underline: '#B5541A',
    markBg: '#40D9A25A',
    markFill: '#66E0B070',
    chromeInk: '#8F7B5E',
    barBg: '#FFFFF8EA',
    barInk: '#3B2F22',
    barInkSoft: '#8F7B5E',
    barAccent: '#7A3E12',
    swatch: '#E9DCC3',
    dark: false,
  },
  {
    id: 'night',
    label: '夜',
    bg: '#1A1A1E',
    ink: '#B9B6AE',
    inkSoft: '#6E6C70',
    underline: '#E88A45',
    markBg: '#5A5A3A28',
    markFill: '#66C8641E',
    chromeInk: '#8B889B',
    barBg: '#FF2A2A30',
    barInk: '#E4E2DC',
    barInkSoft: '#8B889B',
    barAccent: '#9DA0E6',
    swatch: '#1A1A1E',
    dark: true,
  },
];

export function nxReaderTheme(id: string): NxReaderTheme {
  for (const theme of NxReaderThemes) {
    if (theme.id === id) {
      return theme;
    }
  }
  return NxReaderThemes[0];
}

/** 划线 / 荧光笔色点（番茄小说式：黄 / 绿 / 蓝 / 粉）。色值只允许出现在本文件。 */
export interface NxMarkSwatch {
  id: string;
  line: string;
  fill: string;
}

export const NxMarkSwatches: NxMarkSwatch[] = [
  { id: 'yellow', line: '#C9A227', fill: '#66F2C94C' },
  { id: 'green', line: '#2F7A4F', fill: '#6637C85A' },
  { id: 'blue', line: '#3D5A99', fill: '#664A90E2' },
  { id: 'pink', line: '#A83A3A', fill: '#66E07090' },
];

export function nxMarkSwatch(id: string): NxMarkSwatch {
  for (const item of NxMarkSwatches) {
    if (item.id === id) {
      return item;
    }
  }
  return NxMarkSwatches[0];
}

export interface NxRadiusSet {
  xs: number;
  sm: number;
  md: number;
  lg: number;
}

/** 圆角：6·10·14·18。比上一版收一档：留白与时间轴撑页面，不靠圆角卡片堆叠。 */
export const NxRadius: NxRadiusSet = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
};

/** 栅格：4 倍 */
export const NxGrid = 4;

export interface NxFontSizeSet {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  h: number;
  title: number;
  display: number;
}

/** 字阶：11–32 */
export const NxFontSize: NxFontSizeSet = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 15,
  xxl: 17,
  h: 20,
  title: 24,
  display: 32,
};

/** 字体家族：标题宋体、正文黑体、时间戳等宽（系统缺省字体自动回退）。 */
export interface NxFontFamilySet {
  serif: string;
  sans: string;
  mono: string;
}

export const NxFontFamily: NxFontFamilySet = {
  serif: 'HarmonyOS Serif SC, Noto Serif SC, serif',
  sans: 'HarmonyOS Sans SC, sans-serif',
  mono: 'HarmonyOS Sans SC, monospace',
};

export interface NxShadowSpec {
  radius: number;
  color: string;
  offsetX: number;
  offsetY: number;
}

export interface NxShadowSet {
  level1: NxShadowSpec;
  level2: NxShadowSpec;
}

/** 阴影 2 级 */
export const NxShadow: NxShadowSet = {
  level1: { radius: 8, color: '#12000000', offsetX: 0, offsetY: 2 } as NxShadowSpec,
  level2: { radius: 16, color: '#1C000000', offsetX: 0, offsetY: 6 } as NxShadowSpec,
};

export interface NxMotionSet {
  fast: number;
  normal: number;
  stagger: number;
  /** 状态字的呼吸周期。 */
  breath: number;
}

/** 动效：单次 ≤300ms；卡片入场错峰 30ms；呼吸 2.4s */
export const NxMotion: NxMotionSet = {
  fast: 150,
  normal: 300,
  stagger: 30,
  breath: 2400,
};
