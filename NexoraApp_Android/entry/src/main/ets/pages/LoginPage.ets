// LoginPage.ets - 登录页（未登录时的宿主首页）
// 后端地址 + 账号 + 密码三栏表单，登录成功回调宿主切进主界面
// 地址默认取持久化值；登录按钮在提交期间禁用并显示进度，错误直接展示在表单下方

import { sanitizeDisplayName } from '../common/AppConfig';
import { AppState } from '../common/AppState';
import { FontSize, Glow, LineHeight, Motion, Radius, Size, Space } from '../common/DesignToken';
import { BrandLogo } from '../components/common/BrandLogo';

@Component
export struct LoginPage {
    @State app: AppState = AppState.shared;
    onLoggedIn: () => void = () => {};

    @State private backendDraft: string = '';
    @State private usernameDraft: string = '';
    @State private passwordDraft: string = '';
    @State private submitting: boolean = false;
    @State private errorText: string = '';

    aboutToAppear(): void {
        this.backendDraft = this.app.backendUrl;
        // 历史脏值（字面量 "undefined" 等）不进入预填，避免账号框直接显示 undefined
        this.usernameDraft = sanitizeDisplayName(this.app.username);
        this.passwordDraft = '';
        this.errorText = '';
    }

    build() {
        Stack() {
            // 装饰背景光球：与首页同源，柔和品牌氛围
            this.BackgroundGlow();

            Scroll() {
                Column({ space: Space.xl }) {
                    this.BrandBlock();

                    this.FormCard();

                    if (this.errorText.length > 0) {
                        Text(this.errorText)
                            .fontSize(FontSize.small)
                            .fontColor($r('app.color.text_danger'))
                            .width('100%')
                            .padding({ left: Space.md, right: Space.md })
                            .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationFast, curve: Motion.easeOut }));
                    }
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.lg, top: 96, bottom: Space.xxl })
                .alignItems(HorizontalAlign.Start);
            }
            .width('100%')
            .height('100%')
            .scrollBar(BarState.Off);
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    // ---------- 区域 ----------
    @Builder
    BackgroundGlow() {
        Stack() {
            Circle()
                .width(Glow.brandRadius * 2)
                .height(Glow.brandRadius * 2)
                .fill($r('app.color.brand_primary'))
                .opacity(Glow.brandOpacity)
                .position({ x: -60, y: 40 })
                .blur(40);

            Circle()
                .width(Glow.secondaryRadius * 2)
                .height(Glow.secondaryRadius * 2)
                .fill($r('app.color.brand_secondary'))
                .opacity(Glow.secondaryOpacity)
                .position({ x: 240, y: 160 })
                .blur(30);
        }
        .width('100%')
        .height('100%');
    }

    @Builder
    BrandBlock() {
        Column({ space: Space.md }) {
            BrandLogo({ diameter: 64 });

            Column({ space: Space.xs }) {
                Text('Nexora')
                    .fontSize(28)
                    .fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_primary'));

                Text('深度思考 · 联网搜索 · 知识库')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_secondary'));
            }
            .alignItems(HorizontalAlign.Center);
        }
        .width('100%')
        .padding({ bottom: Space.sm })
        .alignItems(HorizontalAlign.Center);
    }

    @Builder
    FormCard() {
        Column({ space: Space.md }) {
            this.FieldRow('后端地址', 'http://host:port', this.backendDraft, false, (value: string) => {
                this.backendDraft = value;
            });

            this.FieldRow('账号', '请输入用户名', this.usernameDraft, false, (value: string) => {
                this.usernameDraft = value;
            });

            this.FieldRow('密码', '请输入密码', this.passwordDraft, true, (value: string) => {
                this.passwordDraft = value;
            });

            this.SubmitButton();
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.xl)
        .backgroundColor($r('app.color.bg_card'))
        .shadow({
            radius: 24,
            color: '#140F1E1A',
            offsetX: 0,
            offsetY: 8
        });
    }

    // 统一输入行：小标签 + 圆角输入框
    @Builder
    FieldRow(label: string, placeholder: string, value: string, password: boolean, onChange: (value: string) => void) {
        Column({ space: Space.xs }) {
            Text(label)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .width('100%');

            TextInput({
                placeholder: placeholder,
                text: value
            })
                .type(password ? InputType.Password : InputType.Normal)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .caretColor($r('app.color.brand_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .placeholderFont({ size: FontSize.body })
                .backgroundColor($r('app.color.bg_sunken'))
                .borderRadius(Radius.md)
                .padding({ left: Space.md, right: Space.md })
                .height(48)
                .width('100%')
                .onChange(onChange);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    // 渐变主按钮：提交中禁用并显示进度
    @Builder
    SubmitButton() {
        Row() {
            if (this.submitting) {
                LoadingProgress()
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .color(Color.White)
                    .margin({ right: Space.sm });
            }

            Text(this.submitting ? '登录中…' : '登录')
                .fontSize(FontSize.bodyLarge)
                .fontColor($r('app.color.text_inverse'));
        }
        .width('100%')
        .height(48)
        .justifyContent(FlexAlign.Center)
        .borderRadius(Radius.md)
        .linearGradient({
            angle: 135,
            colors: [
                [$r('app.color.brand_primary'), 0],
                [$r('app.color.brand_secondary'), 1]
            ]
        })
        .opacity(this.submitting ? 0.7 : 1)
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        .margin({ top: Space.sm })
        .onClick(() => {
            this.submit();
        });
    }

    // ---------- 行为 ----------
    private submit(): void {
        if (this.submitting) {
            return;
        }

        const backend: string = this.backendDraft.trim();
        const username: string = this.usernameDraft.trim();

        if (backend.length === 0) {
            this.errorText = '请填写后端地址';
            return;
        }

        if (username.length === 0 || this.passwordDraft.length === 0) {
            this.errorText = '请填写账号与密码';
            return;
        }

        this.submitting = true;
        this.errorText = '';

        this.app.signIn(backend, username, this.passwordDraft).then((message: string) => {
            this.submitting = false;

            if (message.length > 0) {
                this.errorText = message;
                return;
            }

            this.onLoggedIn();
        });
    }
}
