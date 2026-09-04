// KnowledgeEditorSheet.ets - 知识库编辑弹层（bindSheet 内容）
// 拉取单条知识库正文，提供标题编辑 + Markdown 编辑/预览切换 + 保存/删除
// 新建知识库由宿主先调 createBlankKnowledge 落盘后再打开本弹层，弹层只处理已存在条目的编辑

import { promptAction } from '@kit.ArkUI';
import { AppState } from '../../common/AppState';
import { ApiService } from '../../common/ApiService';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { MarkdownView } from '../chat/MarkdownBlock';

@Component
export struct KnowledgeEditorSheet {
    @ObjectLink app: AppState;
    @Prop targetTitle: string = '';
    onSaved: () => void = () => {};
    onDeleted: () => void = () => {};
    onClose: () => void = () => {};

    @State private titleDraft: string = '';
    @State private contentDraft: string = '';
    @State private preview: boolean = false;
    @State private loading: boolean = true;
    @State private saving: boolean = false;
    @State private error: string = '';
    // 已加载的原始正文：用于判断内容是否变更，避免无改动时仍可点保存
    private loadedContent: string = '';

    aboutToAppear(): void {
        this.titleDraft = this.targetTitle;
        this.loadDetail();
    }

    build() {
        Column() {
            this.Header();

            this.ModeSwitcher();

            this.ContentArea();
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    // 顶栏：返回 + 标题输入 + 保存
    @Builder
    Header() {
        Row({ space: Space.sm }) {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.icon,
                buttonSize: Size.touchTarget,
                onTap: () => {
                    this.onClose();
                }
            });

            TextInput({ placeholder: '知识库标题', text: this.titleDraft })
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .backgroundColor($r('app.color.bg_sunken'))
                .borderRadius(Radius.md)
                .padding({ left: Space.md, right: Space.md })
                .layoutWeight(1)
                .height(Size.inputMinHeight)
                .maxLines(1)
                .onChange((value: string) => {
                    this.titleDraft = value;
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
                    this.save();
                });
        }
        .width('100%')
        .height(Size.touchTarget + Space.sm)
        .padding({ left: Space.md, right: Space.md, top: Space.sm });
    }

    // 编辑 / 预览切换 + 删除入口
    @Builder
    ModeSwitcher() {
        Row() {
            Text('编辑')
                .fontSize(FontSize.body)
                .fontWeight(!this.preview ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(!this.preview ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .onClick(() => {
                    this.preview = false;
                });

            Text('预览')
                .fontSize(FontSize.body)
                .fontWeight(this.preview ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(this.preview ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .onClick(() => {
                    this.preview = true;
                });

            IconButton({
                icon: $r('app.media.ic_delete'),
                iconSize: Size.iconSmall,
                buttonSize: Size.touchTarget,
                onTap: () => {
                    this.confirmDelete();
                }
            });
        }
        .width('100%')
        .height(Size.touchTarget)
        .padding({ left: Space.md, right: Space.md });
    }

    // 内容区：加载 / 错误 / 预览 / 编辑四态
    @Builder
    ContentArea() {
        if (this.loading) {
            Column() {
                LoadingProgress()
                    .width(Size.iconLarge)
                    .height(Size.iconLarge)
                    .color($r('app.color.brand_primary'));
            }
            .width('100%')
            .layoutWeight(1)
            .justifyContent(FlexAlign.Center);
        } else if (this.error.length > 0) {
            Column({ space: Space.sm }) {
                Image($r('app.media.ic_error'))
                    .width(Size.iconLarge)
                    .height(Size.iconLarge)
                    .fillColor($r('app.color.text_danger'));

                Text(this.error)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_danger'))
                    .textAlign(TextAlign.Center);
            }
            .width('100%')
            .layoutWeight(1)
            .justifyContent(FlexAlign.Center)
            .padding({ left: Space.xl, right: Space.xl });
        } else if (this.preview) {
            Scroll() {
                Column() {
                    MarkdownView({
                        source: this.contentDraft,
                        accentColor: $r('app.color.text_brand')
                    });
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.xl });
            }
            .layoutWeight(1)
            .scrollBar(BarState.Auto)
            .scrollBarWidth(3)
            .scrollBarColor('#3A000000');
        } else {
            TextArea({ placeholder: '在此输入 Markdown 内容', text: this.contentDraft })
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .backgroundColor($r('app.color.bg_sunken'))
                .borderRadius(Radius.md)
                .padding({ left: Space.md, right: Space.md, top: Space.md, bottom: Space.md })
                .layoutWeight(1)
                .width('100%')
                .margin({ left: Space.md, right: Space.md, bottom: Space.md })
                .onChange((value: string) => {
                    this.contentDraft = value;
                });
        }
    }

    // ---------- 行为 ----------
    private isSaveEnabled(): boolean {
        return !this.saving && this.titleDraft.trim().length > 0 && (this.titleDraft.trim() !== this.targetTitle || this.contentDraft !== this.loadedContent);
    }

    private loadDetail(): void {
        this.loading = true;
        this.error = '';

        ApiService.fetchKnowledgeDetail(this.targetTitle).then((result) => {
            this.loading = false;

            if (!result.success) {
                this.error = result.message;
                return;
            }

            this.titleDraft = result.title.length > 0 ? result.title : this.targetTitle;
            this.contentDraft = result.content;
            this.loadedContent = result.content;
        });
    }

    private save(): void {
        const newTitle: string = this.titleDraft.trim();

        if (newTitle.length === 0 || this.saving) {
            return;
        }

        this.saving = true;

        ApiService.updateKnowledge(this.targetTitle, newTitle, this.contentDraft).then((result) => {
            this.saving = false;

            if (!result.success) {
                promptAction.showToast({ message: result.message, duration: 2000 });
                return;
            }

            promptAction.showToast({ message: '已保存', duration: 1200 });
            this.onSaved();
        });
    }

    private confirmDelete(): void {
        promptAction.showDialog({
            title: '删除知识库',
            message: '确定删除「' + this.targetTitle + '」？此操作不可撤销。',
            buttons: [
                { text: '取消', color: $r('app.color.text_secondary') },
                { text: '删除', color: $r('app.color.text_danger') }
            ]
        }).then((dialogResult) => {
            if (dialogResult.index === 1) {
                this.executeDelete();
            }
        });
    }

    private executeDelete(): void {
        this.saving = true;

        ApiService.deleteKnowledge(this.targetTitle).then((result) => {
            this.saving = false;

            if (!result.success) {
                promptAction.showToast({ message: result.message, duration: 2000 });
                return;
            }

            promptAction.showToast({ message: '已删除', duration: 1200 });
            this.onDeleted();
        });
    }
}