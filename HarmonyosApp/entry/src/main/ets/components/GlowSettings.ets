/** 外观与氛围的独立选择；以 sheet 展示，立即生效并持久保存。 */
import { nxPalette, NxPalette, NxRadius, NxFontSize, NxFontFamily, NxGrid } from '../theme/DesignTokens';
import { GlowAppearance, GlowSchedule, sharedGlowPreferences } from '../theme/GlowPreferences';
import { AmbientGlow } from './AmbientGlow';

@Component
export struct GlowSettings {
  onClose: () => void = (): void => {};
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  @StorageProp('nxAppearance') appearance: GlowAppearance = 'system';
  @StorageProp('nxGlowSchedule') schedule: GlowSchedule = 'auto';
  @StorageProp('nxGlowEnabled') glowEnabled: boolean = true;
  @StorageProp('nxGlowReduceMotion') reduceMotion: boolean = false;
  @StorageProp('nxSystemReduceMotion') systemReduceMotion: boolean = false;
  @StorageProp('nxGlowPeriod') period: string = 'day';

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  @Builder
  appearanceOption(value: GlowAppearance, title: string, description: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: NxGrid }) {
        Column({ space: NxGrid }) {
          Text(title)
            .fontSize(NxFontSize.lg)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.palette().text1)
          Text(description)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text2)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(this.appearance === value ? '✓' : '')
          .fontSize(NxFontSize.xl)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().primary)
          .width(16)
      }
      .width('100%')
    }
    .id('nx-appearance-' + value)
    .height(68)
    .layoutWeight(1)
    .padding({ left: NxGrid * 3, right: NxGrid * 3 })
    .borderRadius(NxRadius.sm)
    .border({ width: 1, radius: NxRadius.sm, color: this.appearance === value ? this.palette().primary : this.palette().border })
    .backgroundColor(this.appearance === value ? this.palette().primarySoft : this.palette().cardBg)
    .accessibilityText(title + (this.appearance === value ? '，已选中' : ''))
    .accessibilityDescription(description)
    .onClick(() => {
      sharedGlowPreferences.setAppearance(value);
    })
  }

  @Builder
  scheduleOption(value: GlowSchedule, title: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: NxGrid }) {
        Text(title)
          .fontSize(NxFontSize.lg)
          .fontWeight(this.schedule === value ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.schedule === value ? this.palette().primary : this.palette().text2)
        if (this.schedule === value) {
          Text('✓')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().primary)
        }
      }
    }
    .id('nx-glow-schedule-' + value)
    .height(44)
    .layoutWeight(1)
    .padding({ left: NxGrid, right: NxGrid })
    .borderRadius(NxRadius.sm)
    .border({ width: 1, radius: NxRadius.sm, color: this.schedule === value ? this.palette().primary : this.palette().border })
    .backgroundColor(this.schedule === value ? this.palette().primarySoft : this.palette().cardBg)
    .accessibilityText(title + (this.schedule === value ? '，已选中' : ''))
    .onClick(() => {
      sharedGlowPreferences.setGlowSchedule(value);
    })
  }

  build() {
    Column() {
      Row() {
        Text('外观与柔光')
          .fontSize(NxFontSize.h)
          .fontFamily(NxFontFamily.serif)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
        Blank()
        Button('完成', { type: ButtonType.Normal })
          .id('nx-glow-settings-done')
          .height(44)
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().primary)
          .backgroundColor(Color.Transparent)
          .borderRadius(NxRadius.sm)
          .padding({ left: NxGrid * 3, right: NxGrid * 3 })
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .padding({ left: NxGrid * 6, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })

      Scroll() {
        Column({ space: NxGrid * 6 }) {
          Stack({ alignContent: Alignment.TopStart }) {
            AmbientGlow({
              placement: 'top', dark: this.nxDark, period: this.period,
              glowEnabled: this.glowEnabled, exposed: true, reducedMotion: true,
              illuminated: true, extent: 128,
            })
            Column({ space: NxGrid * 2 }) {
              Text((this.period === 'day' ? '昼光' : '夜光') + ' · ' + (this.nxDark ? '深色' : '浅色'))
                .fontSize(NxFontSize.sm)
                .fontColor(this.palette().text2)
              Text('给对话留一点温度')
                .fontSize(NxFontSize.h)
                .fontFamily(NxFontFamily.serif)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.palette().text1)
            }
            .alignItems(HorizontalAlign.Start)
            .padding(NxGrid * 5)
          }
          .id('nx-glow-preview')
          .width('100%')
          .height(128)
          .borderRadius(NxRadius.md)
          .border({ width: 1, color: this.palette().border })
          .backgroundColor(this.palette().pageBg)
          .clip(true)

          Column({ space: NxGrid * 3 }) {
            Text('页面外观')
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text1)
              .width('100%')
            Column({ space: NxGrid * 2 }) {
              Row({ space: NxGrid * 2 }) {
                this.appearanceOption('system', '跟随系统', '随系统深浅变化')
                this.appearanceOption('time', '跟随时段', '07:00 亮 · 19:00 暗')
              }
              .width('100%')
              Row({ space: NxGrid * 2 }) {
                this.appearanceOption('light', '浅色', '始终使用浅色页面')
                this.appearanceOption('dark', '深色', '始终使用深色页面')
              }
              .width('100%')
            }
            .width('100%')
          }
          .width('100%')

          Column({ space: NxGrid * 3 }) {
            Text('柔光氛围')
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text1)
              .width('100%')
            Row({ space: NxGrid * 2 }) {
              this.scheduleOption('auto', '随时段')
              this.scheduleOption('day', '昼光')
              this.scheduleOption('night', '夜光')
            }
            .width('100%')
            Text(this.schedule === 'auto' ? '07:00–19:00 为昼光，其余时段为夜光。' :
              (this.schedule === 'day' ? '温暖的杏橙与琥珀色，不改变页面明暗。' : '安静的紫色与灰紫色，不改变页面明暗。'))
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text2)
              .lineHeight(18)
              .width('100%')
          }
          .width('100%')

          Column({ space: NxGrid * 4 }) {
            Row({ space: NxGrid * 4 }) {
              Column({ space: NxGrid }) {
                Text('柔光')
                  .fontSize(NxFontSize.xl)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.palette().text1)
                Text('为首页和输入区添一层柔和光色。')
                  .fontSize(NxFontSize.sm)
                  .fontColor(this.palette().text2)
                  .lineHeight(18)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.glowEnabled })
                .id('nx-glow-enabled')
                .selectedColor(this.palette().buttonFill)
                .accessibilityText('柔光')
                .onChange((enabled: boolean) => {
                  sharedGlowPreferences.setEnabled(enabled);
                })
            }
            .width('100%')
            .constraintSize({ minHeight: 52 })

            Divider().color(this.palette().border)

            Row({ space: NxGrid * 4 }) {
              Column({ space: NxGrid }) {
                Text('减少动态')
                  .fontSize(NxFontSize.xl)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.palette().text1)
                Text(this.systemReduceMotion ? '系统已开启减弱动效，柔光保持静止。' : '保留光色，停止呼吸与流动。')
                  .fontSize(NxFontSize.sm)
                  .fontColor(this.palette().text2)
                  .lineHeight(18)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.reduceMotion || this.systemReduceMotion })
                .id('nx-glow-reduce-motion')
                .selectedColor(this.palette().buttonFill)
                .enabled(!this.systemReduceMotion)
                .accessibilityText('减少动态' + (this.systemReduceMotion ? '，由系统开启' : ''))
                .onChange((enabled: boolean) => {
                  sharedGlowPreferences.setReduceMotion(enabled);
                })
            }
            .width('100%')
            .constraintSize({ minHeight: 52 })
          }
          .width('100%')
        }
        .width('100%')
        .padding({ left: NxGrid * 6, right: NxGrid * 6, top: NxGrid * 2, bottom: NxGrid * 8 })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.TopStart)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.palette().pageBg)
  }
}
