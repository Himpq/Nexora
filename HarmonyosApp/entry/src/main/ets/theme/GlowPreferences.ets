/**
 * 昼夜柔光的偏好与生命周期。页面明暗和光色时段独立：
 * nxDarkMode 继续驱动全局令牌，nxGlowPeriod 只决定柔光色域。
 */
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { accessibility } from '@kit.AccessibilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { nxGlowPeriodAt, nxNextGlowBoundaryAt } from '../services/SoftGlowState';
import { nxApplySystemBars } from './SystemBars';

export type GlowAppearance = 'system' | 'time' | 'light' | 'dark';
export type GlowSchedule = 'auto' | 'day' | 'night';

const GLOW_PREFERENCES_NAME = 'nx_glow_preferences';

// API 23+ 要求注册、注销使用同一个具名 callback，避免重复注册导致泄漏。
function onSystemReduceMotionChanged(enabled: boolean): void {
  AppStorage.setOrCreate('nxSystemReduceMotion', enabled);
}

export class GlowPreferences {
  private context: common.UIAbilityContext | undefined = undefined;
  private store: preferences.Preferences | undefined = undefined;
  private mainWindow: window.Window | undefined = undefined;
  private initialized: boolean = false;
  private systemDark: boolean = false;
  private foreground: boolean = false;
  private boundaryTimer: number = -1;
  private boundaryVersion: number = 0;
  private observingReduceMotion: boolean = false;

  init(context: common.UIAbilityContext): void {
    this.context = context;
    if (!this.initialized) {
      this.initialized = true;
      try {
        this.store = preferences.getPreferencesSync(context, { name: GLOW_PREFERENCES_NAME });
      } catch (err) {
        hilog.warn(0x0000, 'nxGlow', 'Unable to open appearance preferences.');
      }
      AppStorage.setOrCreate('nxAppearance', this.readAppearance());
      AppStorage.setOrCreate('nxGlowSchedule', this.readSchedule());
      AppStorage.setOrCreate('nxGlowEnabled', this.readBoolean('nxGlowEnabled', true));
      AppStorage.setOrCreate('nxGlowReduceMotion', this.readBoolean('nxGlowReduceMotion', false));
      AppStorage.setOrCreate('nxAppForeground', this.foreground);
      AppStorage.setOrCreate('nxSystemReduceMotion', false);
    }
    this.observeReduceMotion();
    this.refresh();
  }

  /** 创建窗口后保存引用；初次系统栏仍由 EntryAbility 的既有逻辑应用。 */
  attachWindow(win: window.Window | undefined): void {
    this.mainWindow = win;
  }

  /** undefined colorMode 常见于字体/语言配置更新，不能把它误当作浅色。 */
  refresh(systemDark?: boolean): void {
    if (systemDark !== undefined) {
      this.systemDark = systemDark;
    } else if (this.context !== undefined) {
      const mode = this.context.config.colorMode;
      if (mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK) {
        this.systemDark = true;
      } else if (mode === ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT) {
        this.systemDark = false;
      }
    }

    const now = Date.now();
    const localPeriod = nxGlowPeriodAt(now);
    const appearance = AppStorage.get<GlowAppearance>('nxAppearance') || 'system';
    const schedule = AppStorage.get<GlowSchedule>('nxGlowSchedule') || 'auto';
    const dark = appearance === 'dark' ||
      (appearance === 'system' && this.systemDark) ||
      (appearance === 'time' && localPeriod === 'night');
    AppStorage.setOrCreate('nxDarkMode', dark);
    AppStorage.setOrCreate('nxGlowPeriod', schedule === 'auto' ? localPeriod : schedule);
    this.refreshReduceMotion();
    if (this.mainWindow !== undefined && AppStorage.get<boolean>('nxReaderImmersive') !== true) {
      nxApplySystemBars(this.mainWindow, dark);
    }
    this.scheduleBoundary(now);
  }

  setAppearance(value: GlowAppearance): void {
    AppStorage.setOrCreate('nxAppearance', value);
    this.persist('nxAppearance', value);
    this.refresh();
  }

  setGlowSchedule(value: GlowSchedule): void {
    AppStorage.setOrCreate('nxGlowSchedule', value);
    this.persist('nxGlowSchedule', value);
    this.refresh();
  }

  setEnabled(enabled: boolean): void {
    AppStorage.setOrCreate('nxGlowEnabled', enabled);
    this.persist('nxGlowEnabled', enabled);
  }

  setReduceMotion(enabled: boolean): void {
    // 用户偏好与系统偏好分开保存；关闭本项不能覆盖系统的减弱动效。
    AppStorage.setOrCreate('nxGlowReduceMotion', enabled);
    this.persist('nxGlowReduceMotion', enabled);
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground;
    AppStorage.setOrCreate('nxAppForeground', foreground);
    if (foreground) {
      this.refresh();
    } else {
      this.clearBoundaryTimer();
    }
  }

  dispose(): void {
    this.setForeground(false);
    if (this.observingReduceMotion) {
      try {
        accessibility.offAnimationReduceStateChange(onSystemReduceMotionChanged);
      } catch (err) {
        hilog.warn(0x0000, 'nxGlow', 'Unable to unsubscribe reduce-motion changes.');
      }
      this.observingReduceMotion = false;
    }
    this.mainWindow = undefined;
    this.context = undefined;
    this.store = undefined;
    this.initialized = false;
  }

  private readAppearance(): GlowAppearance {
    const value = this.readValue('nxAppearance', 'system');
    if (value === 'time' || value === 'light' || value === 'dark') {
      return value;
    }
    return 'system';
  }

  private readSchedule(): GlowSchedule {
    const value = this.readValue('nxGlowSchedule', 'auto');
    return value === 'day' || value === 'night' ? value : 'auto';
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const value = this.readValue(key, fallback);
    return typeof value === 'boolean' ? value : fallback;
  }

  private readValue(key: string, fallback: string | boolean): preferences.ValueType {
    if (this.store !== undefined) {
      try {
        return this.store.getSync(key, fallback);
      } catch (err) {
        hilog.warn(0x0000, 'nxGlow', 'Unable to read appearance preference %{public}s.', key);
      }
    }
    return fallback;
  }

  private persist(key: string, value: string | boolean): void {
    if (this.store === undefined) {
      return;
    }
    try {
      this.store.putSync(key, value);
      this.store.flush().catch((err: Error) => {
        hilog.warn(0x0000, 'nxGlow', 'Unable to save appearance preference: %{public}s', err.message);
      });
    } catch (err) {
      hilog.warn(0x0000, 'nxGlow', 'Unable to write appearance preference %{public}s.', key);
    }
  }

  private observeReduceMotion(): void {
    if (this.observingReduceMotion) {
      return;
    }
    try {
      accessibility.onAnimationReduceStateChange(onSystemReduceMotionChanged);
      this.observingReduceMotion = true;
    } catch (err) {
      hilog.warn(0x0000, 'nxGlow', 'Reduce-motion subscription is unavailable.');
    }
  }

  private refreshReduceMotion(): void {
    try {
      AppStorage.setOrCreate('nxSystemReduceMotion', accessibility.isAnimationReduceEnabledSync());
    } catch (err) {
      // 查询失败时保持上次系统值，避免意外重新启用动画。
      hilog.warn(0x0000, 'nxGlow', 'Unable to refresh system reduce-motion setting.');
    }
  }

  private clearBoundaryTimer(): void {
    this.boundaryVersion++;
    if (this.boundaryTimer !== -1) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = -1;
    }
  }

  private scheduleBoundary(now: number): void {
    this.clearBoundaryTimer();
    if (!this.foreground) {
      return;
    }
    const next = nxNextGlowBoundaryAt(now);
    if (!Number.isFinite(next)) {
      return;
    }
    const version = this.boundaryVersion;
    this.boundaryTimer = setTimeout(() => {
      // 清除时已排进消息队列的旧回调，不能覆盖回前台后新建的 timer 引用。
      if (version !== this.boundaryVersion) {
        return;
      }
      this.boundaryTimer = -1;
      if (this.foreground) {
        this.refresh();
      }
    }, Math.max(1, next - now));
  }
}

export const sharedGlowPreferences: GlowPreferences = new GlowPreferences();
