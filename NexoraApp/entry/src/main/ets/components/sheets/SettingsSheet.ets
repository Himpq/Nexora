// SettingsSheet.ets - 设置面板（bindSheet 内容）
// 后端地址、生成参数、退出登录集中在这里，地址保存后立即生效并触发数据重载

import { sanitizeDisplayName } from '../../common/AppConfig';
import { AppState } from '../../common/AppState';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { DangerRow, NavRow, SwitchRow } from '../common/ListRows';
import { UserAvatar } from '../common/UserAvatar';

@Component
export struct SettingsSheet {
    @ObjectLink app: AppState;
    onSaved: () => void = () => {};
    onSignOut: () => void = () => {};
    onOpenModelPicker: () => void = () => {};

    @State private urlDraft: string = '';
    @State private saving: boolean = false;

    aboutToAppear(): void {
        this.urlDraft = this.app.backendUrl;
    }

    build() {
        Column({ space: Space.md }) {
            Column()
                .width(36)
                .height(4)
                .borderRadius(Radius.full)
                .backgroundColor($r('app.color.border_strong'))
                .margin({ top: Space.sm, bottom: Space.xs });

            Text('设置')
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .width('100%')
                .padding({ left: Space.lg });

            Scroll() {
                Column({ space: Space.md }) {
                    this.AccountCard();
                    this.BackendEditor();

                    SwitchRow({
                        icon: $r('app.media.ic_thinking'),
                        title: '深度思考',
                        subtitle: '让模型先展开推理再作答',
                        checked: this.app.enableThinking,
                        tint: $r('app.color.text_brand'),
                        onChanged: (checked: boolean) => {
                            this.app.setThinking(checked);
                        }
                    });

                    SwitchRow({
                        icon: $r('app.media.ic_search'),
                        title: '联网搜索',
                        subtitle: '回答前先检索实时信息',
                        checked: this.app.enableWebSearch,
                        tint: $r('app.color.text_brand'),
                        onChanged: (checked: boolean) => {
                            this.app.setWebSearch(checked);
                        }
                    });

                    SwitchRow({
                        icon: $r('app.media.ic_wrench'),
                        title: '强制工具调用',
                        subtitle: '下发全部业务工具给模型',
                        checked: this.app.forceTools,
                        tint: $r('app.color.text_brand'),
                        onChanged: (checked: boolean) => {
                            this.app.setForceTools(checked);
                        }
                    });

                    NavRow({
                        icon: $r('app.media.ic_spark'),
                        title: '默认模型',
                        value: this.app.selectedModelLabel,
                        tint: $r('app.color.text_brand'),
                        onTap: () => {
                            this.onOpenModelPicker();
                        }
                    });

                    DangerRow({
                        title: '退出登录',
                        onTap: () => {
                            this.onSignOut();
                        }
                    });

                    Text('Nexora Harmony · 内部演示版')
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'))
                        .width('100%')
                        .textAlign(TextAlign.Center)
                        .margin({ top: Space.sm, bottom: Space.xl });
                }
                .width('100%')
                .padding({ left: Space.md, right: Space.md });
            }
            .layoutWeight(1)
            .scrollBar(BarState.Off);
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    @Builder
    AccountCard() {
        Row({ space: Space.md }) {
            UserAvatar({
                name: this.accountDisplayName(),
                avatarUrl: this.app.avatarUrl,
                diameter: Size.avatarLarge
            });

            Column({ space: Space.xxs }) {
                Text(this.accountDisplayName())
                    .fontSize(FontSize.body)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'));

                Text(this.app.backendUrl)
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'));
    }

    // 账号名称（含兜底）：UI 统一走普通方法而非原型 getter——
    // @ObjectLink 组件的 UI 更新路径下 getter 间接取值曾返回 undefined 触发崩溃
    private accountDisplayName(): string {
        const display: string = sanitizeDisplayName(this.app.displayName);

        if (display.length > 0) {
            return display;
        }

        const user: string = sanitizeDisplayName(this.app.username);
        return user.length > 0 ? user : '未登录';
    }

    // 后端地址编辑：保存按钮仅在内容变化时可用
    @Builder
    BackendEditor() {
        Column({ space: Space.sm }) {
            Text('后端地址')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .width('100%');

            Row({ space: Space.sm }) {
                TextInput({ placeholder: 'http://host:port', text: this.urlDraft })
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'))
                    .backgroundColor($r('app.color.bg_sunken'))
                    .borderRadius(Radius.md)
                    .padding({ left: Space.md, right: Space.md })
                    .layoutWeight(1)
                    .height(Size.inputMinHeight)
                    .onChange((value: string) => {
                        this.urlDraft = value;
                    });

                Text('保存')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_inverse'))
                    .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.sm })
                    .borderRadius(Radius.md)
                    .linearGradient({
                        angle: 135,
                        colors: [
                            [$r('app.color.brand_primary'), 0],
                            [$r('app.color.brand_secondary'), 1]
                        ]
                    })
                    .opacity(this.isSaveEnabled() ? 1 : 0.4)
                    .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
                    .onClick(() => {
                        this.saveBackendUrl();
                    });
            }
            .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'));
    }

    private isSaveEnabled(): boolean {
        return !this.saving && this.urlDraft.trim().length > 0 && this.urlDraft.trim() !== this.app.backendUrl;
    }

    private saveBackendUrl(): void {
        if (!this.isSaveEnabled()) {
            return;
        }

        this.saving = true;

        this.app.updateBackendUrl(this.urlDraft.trim()).then(() => {
            this.saving = false;
            this.onSaved();
        });
    }
}
