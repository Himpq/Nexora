/**
 * Agent 回复侧的思考态：无气泡、无底色，「我想想」后面的点按顺序点亮。
 */
import { nxPalette, NxPalette, NxFontSize, NxFontFamily, NxGrid } from '../../theme/DesignTokens';

@Component
export struct ThinkingLine {
  @State step: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private timerId: number = -1;

  aboutToAppear(): void {
    this.timerId = setInterval((): void => {
      this.step = (this.step + 1) % 3;
    }, 380);
  }

  aboutToDisappear(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  build() {
    Row() {
      Text('我想想')
        .fontSize(NxFontSize.xl)
        .fontFamily(NxFontFamily.serif)
        .fontColor(this.palette().text3)
      Text('.')
        .fontSize(NxFontSize.xl)
        .fontFamily(NxFontFamily.serif)
        .fontColor(this.palette().text3)
        .opacity(this.step >= 0 ? 1 : 0.15)
        .margin({ left: 1 })
      Text('.')
        .fontSize(NxFontSize.xl)
        .fontFamily(NxFontFamily.serif)
        .fontColor(this.palette().text3)
        .opacity(this.step >= 1 ? 1 : 0.15)
      Text('.')
        .fontSize(NxFontSize.xl)
        .fontFamily(NxFontFamily.serif)
        .fontColor(this.palette().text3)
        .opacity(this.step >= 2 ? 1 : 0.15)
    }
    .width('100%')
    .justifyContent(FlexAlign.Start)
    .alignItems(VerticalAlign.Bottom)
    .padding({ top: NxGrid, bottom: NxGrid })
  }
}
