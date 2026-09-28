import { common } from '@kit.AbilityKit';
import { Identity } from '../services/Identity';
import { NxEnv } from '../config/Env';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxFontFamily } from '../theme/DesignTokens';

/** Cloud account sign-in. The visual hierarchy follows ChatApp's monochrome login surface. */
@Component
export struct LoginView {
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  @State username: string = '';
  @State password: string = '';
  @State errorText: string = '';
  @State submitting: boolean = false;

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  private async submit(): Promise<void> {
    if (this.username.trim().length === 0 || this.password.length === 0) {
      this.errorText = '请输入账号和密码';
      return;
    }
    const context: common.Context | undefined = this.getUIContext().getHostContext();
    if (context === undefined) {
      this.errorText = '当前无法建立登录会话';
      return;
    }
    this.submitting = true;
    this.errorText = '';
    try {
      await Identity.login(context, this.username, this.password);
      this.password = '';
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : '网络错误，请稍后重试';
    } finally {
      this.submitting = false;
    }
  }

  build() {
    Column({ space: NxGrid * 5 }) {
      Column({ space: NxGrid * 2 }) {
        Text('NEXORA')
          .fontSize(NxFontSize.xs)
          .fontFamily(NxFontFamily.mono)
          .fontColor(this.palette().text3)
          .letterSpacing(2)
        Text('欢迎回来')
          .fontSize(NxFontSize.title)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.palette().text1)
        Text('登录后继续你的学习轨迹')
          .fontSize(NxFontSize.md)
          .fontColor(this.palette().text3)
      }
      .alignItems(HorizontalAlign.Start)

      Column({ space: NxGrid * 3 }) {
        TextInput({ placeholder: '账号', text: this.username })
          .height(52)
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text1)
          .backgroundColor(this.palette().cardBg)
          .borderRadius(NxRadius.sm)
          .border({ width: 1, color: this.palette().border })
          .padding({ left: NxGrid * 4, right: NxGrid * 4 })
          .onChange((value: string) => {
            this.username = value;
            this.errorText = '';
          })
        TextInput({ placeholder: '密码', text: this.password })
          .type(InputType.Password)
          .height(52)
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text1)
          .backgroundColor(this.palette().cardBg)
          .borderRadius(NxRadius.sm)
          .border({ width: 1, color: this.palette().border })
          .padding({ left: NxGrid * 4, right: NxGrid * 4 })
          .onChange((value: string) => {
            this.password = value;
            this.errorText = '';
          })
        if (this.errorText.length > 0) {
          Text(this.errorText)
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().danger)
            .width('100%')
        }
        Button(this.submitting ? '登录中…' : '登录')
          .enabled(!this.submitting)
          .height(52)
          .width('100%')
          .fontSize(NxFontSize.lg)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().onButton)
          .backgroundColor(this.palette().buttonFill)
          .borderRadius(NxRadius.sm)
          .onClick(() => {
            this.submit();
          })
      }
      .width('100%')

      Text(NxEnv.USE_LOCAL ? '本地联调模式' : 'Nexora 云端账号')
        .fontSize(NxFontSize.xs)
        .fontColor(this.palette().text4)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: NxGrid * 6, right: NxGrid * 6, top: NxGrid * 5, bottom: NxGrid * 5 })
    .backgroundColor(this.palette().pageBg)
  }
}
