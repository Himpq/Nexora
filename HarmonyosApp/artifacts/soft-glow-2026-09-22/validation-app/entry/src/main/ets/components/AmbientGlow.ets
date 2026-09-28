import { nxAmbientPalette, NxAmbientPalette, NxAmbientMotion } from '../theme/AmbientTokens';

/**
 * 原生装饰层：两张径向渐变做低频交接，不模糊正文，也不接收输入。
 * 只观察一次发送的生命周期，不订阅时间线或逐字文本。空闲无定时器，长等待十秒后静止。
 */
@Component
export struct AmbientGlow {
  @Prop placement: string = 'composer';
  @Prop dark: boolean = false;
  @Prop period: string = 'day';
  @Prop @Watch('synchronize') glowEnabled: boolean = true;
  @Prop @Watch('synchronize') exposed: boolean = true;
  @Prop @Watch('synchronize') reducedMotion: boolean = false;
  @Prop @Watch('synchronize') busy: boolean = false;
  @Prop @Watch('synchronize') illuminated: boolean = false;
  @Prop extent: number = 190;
  @State private drift: boolean = false;
  @State private quiet: boolean = false;
  private mounted: boolean = false;
  private wasBusy: boolean = false;
  private beganAt: number = 0;
  private quietTimer: number = -1;
  private cycleVersion: number = 0;

  aboutToAppear(): void {
    this.mounted = true;
    this.synchronize();
  }

  aboutToDisappear(): void {
    this.mounted = false;
    this.cycleVersion++;
    this.clearQuietTimer();
  }

  private clearQuietTimer(): void {
    if (this.quietTimer >= 0) {
      clearTimeout(this.quietTimer);
      this.quietTimer = -1;
    }
  }

  synchronize(): void {
    if (!this.mounted) {
      return;
    }
    this.clearQuietTimer();
    const version: number = ++this.cycleVersion;
    if (this.busy && !this.wasBusy) {
      this.beganAt = Date.now();
    }
    this.wasBusy = this.busy;
    const elapsed: number = this.busy ? Date.now() - this.beganAt : 0;
    if (this.busy) {
      this.quiet = elapsed >= NxAmbientMotion.quietAfter;
    } else if (!this.illuminated) {
      // busy/illuminated 的通知顺序不固定。收光前保持原来的弱光，避免结束瞬间反亮。
      this.quiet = false;
    }
    const active: boolean = this.busy && this.glowEnabled && this.exposed &&
      (this.placement !== 'top' || this.illuminated);
    this.drift = active && !this.reducedMotion && !this.quiet;
    if (active && !this.quiet) {
      this.quietTimer = setTimeout((): void => {
        if (!this.mounted || version !== this.cycleVersion) {
          return;
        }
        this.quietTimer = -1;
        this.quiet = true;
        this.drift = false;
      }, Math.max(1, NxAmbientMotion.quietAfter - elapsed));
    }
  }

  private colors(): NxAmbientPalette {
    return nxAmbientPalette(this.dark, this.period);
  }

  private strength(): number {
    if (!this.glowEnabled || !this.exposed) {
      return 0;
    }
    if (this.placement === 'top') {
      return this.illuminated ? (this.quiet ? 0.36 : 0.86) : 0;
    }
    return this.busy && !this.quiet ? 0.9 : 0.48;
  }

  private motionDuration(): number {
    if (!this.exposed || this.reducedMotion) {
      return 0;
    }
    return this.drift ? NxAmbientMotion.drift : NxAmbientMotion.fade;
  }

  build() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .radialGradient({
          center: ['28%', this.placement === 'top' ? '-10%' : '110%'],
          radius: this.extent * 1.12,
          colors: [[this.colors().core, 0], [this.colors().middle, 0.43], [this.colors().edge, 1]],
        })
        .translate({ x: this.drift ? 18 : -8, y: 0 })
        .opacity(this.drift ? 0.65 : 1)
        .animation({ duration: this.motionDuration(), curve: Curve.EaseInOut })
      Column()
        .width('100%')
        .height('100%')
        .radialGradient({
          center: ['76%', this.placement === 'top' ? '-16%' : '116%'],
          radius: this.extent * 1.15,
          colors: [[this.colors().companion, 0], [this.colors().companionMiddle, 0.46], [this.colors().companionEdge, 1]],
        })
        .translate({ x: this.drift ? -14 : 8, y: 0 })
        .opacity(this.drift ? 1 : 0.62)
        .animation({ duration: this.motionDuration(), curve: Curve.EaseInOut })
    }
    .width('100%')
    .height(this.extent)
    .opacity(this.strength())
    .animation({ duration: this.exposed && !this.reducedMotion ? NxAmbientMotion.fade : 0, curve: Curve.EaseInOut })
    .clip(true)
    .hitTestBehavior(HitTestMode.None)
    .accessibilityLevel('no-hide-descendants')
  }
}
