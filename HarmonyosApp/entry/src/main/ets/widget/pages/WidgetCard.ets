/**
 * 服务卡片 UI：今日卡（§9.3）。
 * 数据由 formProvider.updateForm 主动刷新推送，经 LocalStorage 绑定到 @LocalStorageProp。
 * （原实现是写死的字面量，updateForm 推进来的 title/minutes 从未上屏——卡片视觉永远不变。）
 * [好][晚点] → postCardAction message → EntryFormAbility.onFormEvent 回喂决策器。
 */
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize } from '../../theme/DesignTokens';

const cardStorage: LocalStorage = new LocalStorage();

@Entry(cardStorage)
@Component
struct WidgetCard {
  readonly TITLE: string = 'Nexora 教练';
  @LocalStorageProp('title') title: string = '我在看着你的进度，有需要我会说';
  @LocalStorageProp('minutes') minutes: string = '';
  @LocalStorageProp('percent') percent: number = 0;
  @LocalStorageProp('actionable') actionable: boolean = false;

  private palette(): NxPalette {
    // 卡片运行在独立进程，取不到应用的 AppStorage('nxDarkMode')。
    // 品牌渐变底在深浅色两套令牌里一致，文字统一走 onPrimary 系，故固定取浅色表即可。
    return nxPalette(false);
  }

  build() {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid * 2 }) {
        Text(this.TITLE)
          .fontSize(NxFontSize.md)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().onPrimary)
        Blank()
        if (this.minutes.length > 0) {
          Text(this.minutes)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().onPrimary)
            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: 2, bottom: 2 })
            .borderRadius(NxRadius.xs)
            .backgroundColor(this.palette().onPrimaryFill)
        }
      }
      .width('100%')

      Row({ space: NxGrid * 3 }) {
        // §9.3 今日卡要求的进度环（原实现缺失）。
        Stack() {
          Progress({ value: this.percent, total: 100, type: ProgressType.Ring })
            .width(40)
            .height(40)
            .color(this.palette().onPrimary)
            .backgroundColor(this.palette().onPrimaryFill)
            .style({ strokeWidth: 4 })
          Text(this.percent + '%')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().onPrimary)
        }
        .width(40)
        .height(40)

        Text(this.title)
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().onPrimary)
          .lineHeight(18)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      }
      .width('100%')
      .layoutWeight(1)

      Row({ space: NxGrid * 2 }) {
        Button('好')
          .height(28)
          .fontSize(NxFontSize.xs)
          .layoutWeight(1)
          .backgroundColor(this.palette().onPrimary)
          .fontColor(this.palette().primary)
          .onClick(() => {
            postCardAction(this, {
              action: 'message',
              params: { message: 'accept' },
            });
          })
        Button('晚点')
          .height(28)
          .fontSize(NxFontSize.xs)
          .layoutWeight(1)
          .backgroundColor(this.palette().onPrimaryFill)
          .fontColor(this.palette().onPrimary)
          .onClick(() => {
            postCardAction(this, {
              action: 'message',
              params: { message: 'defer' },
            });
          })
      }
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .padding(NxGrid * 3)
    .linearGradient({
      angle: 135,
      colors: [[this.palette().gradientStart, 0.0], [this.palette().gradientEnd, 1.0]],
    })
  }
}
