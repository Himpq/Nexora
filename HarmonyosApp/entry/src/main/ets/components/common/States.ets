/**
 * 通用状态组件：骨架屏 / 空态 / 行内错误态（§6.1）。
 */
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize } from '../../theme/DesignTokens';

@Component
export struct SkeletonCard {
  @StorageProp('nxDarkMode') nxDark: boolean = false;

  build() {
    Column({ space: NxGrid * 2 }) {
      Row()
        .width('55%')
        .height(14)
        .borderRadius(NxRadius.xs)
        .backgroundColor(nxPalette(this.nxDark).surface3)
      Row()
        .width('100%')
        .height(12)
        .borderRadius(NxRadius.xs)
        .backgroundColor(nxPalette(this.nxDark).surface3)
      Row()
        .width('78%')
        .height(12)
        .borderRadius(NxRadius.xs)
        .backgroundColor(nxPalette(this.nxDark).surface3)
    }
    .width('100%')
    .padding(NxGrid * 4)
    .borderRadius(NxRadius.md)
    .backgroundColor(nxPalette(this.nxDark).cardBg)
  }
}

@Component
export struct EmptyState {
  text: string = '';
  @StorageProp('nxDarkMode') nxDark: boolean = false;

  build() {
    Column({ space: NxGrid * 2 }) {
      Text(this.text)
        .fontSize(NxFontSize.md)
        .fontColor(nxPalette(this.nxDark).text3)
        .lineHeight(20)
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .padding(NxGrid * 6)
  }
}

@Component
export struct ErrorState {
  message: string = '';
  onRetry: () => void = () => {
  };
  @StorageProp('nxDarkMode') nxDark: boolean = false;

  build() {
    Row({ space: NxGrid * 2 }) {
      Text(this.message)
        .fontSize(NxFontSize.sm)
        .fontColor(nxPalette(this.nxDark).danger)
        .lineHeight(18)
        .layoutWeight(1)
      Button('重试')
        .height(28)
        .fontSize(NxFontSize.sm)
        .backgroundColor(nxPalette(this.nxDark).surface3)
        .fontColor(nxPalette(this.nxDark).text2)
        .onClick(() => {
          this.onRetry();
        })
    }
    .width('100%')
    .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
    .borderRadius(NxRadius.sm)
    .backgroundColor(nxPalette(this.nxDark).cardBg)
  }
}
