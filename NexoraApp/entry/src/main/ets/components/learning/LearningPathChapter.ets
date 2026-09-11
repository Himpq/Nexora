// LearningPathChapter.ets - 个性化章节阅读
// 与教材阅读器（LearningReader）是两种不同的学习模式：
//   LearningReader 读的是教材原文，逐段分页；
//   本页读的是后端按「用户画像 + 学习路线 + 本章范围」生成的学习素材（Markdown）。
// 素材未必已经生成，未生成时如实说明并提供生成入口——边生成边显示，
// 而不是先转圈几分钟再一次性出现（生成一章要跑一次长文模型）。

import { PathChapterResult, LearningPathApi } from '../../common/LearningPathApi';
import { LearningChapterStream } from '../../common/LearningChapterStream';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder } from './LearningWidgets';
import { MarkdownView } from './MarkdownView';

// 流式正文刷新节流：delta 可能每秒来几十次，逐次重排 Markdown 会明显掉帧
const FLUSH_INTERVAL: number = 400;

@Component
export struct LearningPathChapter {
    @Prop lectureId: string = '';
    @Prop chapterIndex: number = 0;
    @Prop chapterTitle: string = '';
    @Prop bookTitle: string = '';
    onBack: () => void = () => {};

    @State private loading: boolean = true;
    @State private cached: boolean = false;
    @State private content: string = '';
    @State private generating: boolean = false;
    @State private statusText: string = '';
    @State private errorMessage: string = '';

    private streamBuffer: string = '';
    private flushTimer: number = -1;

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    aboutToDisappear(): void {
        this.stopFlush();
        LearningChapterStream.shared.cancel();
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const result: PathChapterResult = await LearningPathApi.shared.loadChapter(this.lectureId, this.chapterIndex);

        this.loading = false;

        if (!result.success) {
            this.errorMessage = result.message;
            return;
        }

        this.cached = result.cached;
        this.content = result.content;
    }

    private async startGenerate(): Promise<void> {
        if (this.generating) {
            return;
        }

        this.generating = true;
        this.errorMessage = '';
        this.streamBuffer = '';
        this.content = '';
        this.statusText = '正在按你的画像与学习路线生成本章素材…';
        this.startFlush();

        await LearningChapterStream.shared.generate(this.lectureId, this.chapterIndex, {
            onDelta: (text: string) => {
                this.streamBuffer = this.streamBuffer + text;
            },
            onStatus: (message: string) => {
                this.statusText = message;
            },
            onFinished: (success: boolean, message: string) => {
                this.finishGenerate(success, message);
            }
        });
    }

    private finishGenerate(success: boolean, message: string): void {
        this.stopFlush();
        this.generating = false;
        this.content = this.streamBuffer;
        this.statusText = '';

        if (!success) {
            this.errorMessage = message;
            return;
        }

        // 生成成功时后端已落盘，回读一次拿到最终稿（流式文本与落盘文本可能有收尾差异）
        this.cached = true;

        LearningPathApi.shared.loadChapter(this.lectureId, this.chapterIndex).then((result: PathChapterResult) => {
            if (result.success && result.cached) {
                this.content = result.content;
            }
        });
    }

    private startFlush(): void {
        if (this.flushTimer >= 0) {
            return;
        }

        this.flushTimer = setInterval(() => {
            if (this.streamBuffer !== this.content) {
                this.content = this.streamBuffer;
            }
        }, FLUSH_INTERVAL);
    }

    private stopFlush(): void {
        if (this.flushTimer < 0) {
            return;
        }

        clearInterval(this.flushTimer);
        this.flushTimer = -1;
    }

    build() {
        Column() {
            this.TopBar()

            if (this.loading) {
                LoadingBlock({ label: '正在读取本章素材' });
            } else if (this.errorMessage.length > 0 && this.content.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '本章素材打开失败',
                    hint: this.errorMessage,
                    actionLabel: '重新读取',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else if (!this.cached && !this.generating) {
                Placeholder({
                    icon: $r('app.media.ic_spark'),
                    title: '这一章的学习素材还没有生成',
                    hint: '生成后会结合你的画像、学习路线建议与本章教材范围，重新组织成一份可直接读的学习材料',
                    actionLabel: '生成本章素材',
                    onAction: () => {
                        this.startGenerate().then(() => {
                        });
                    }
                });
            } else {
                Column() {
                    if (this.generating) {
                        this.GeneratingBar()
                    }

                    if (this.errorMessage.length > 0) {
                        this.ErrorBar()
                    }

                    Scroll() {
                        Column({ space: Space.md }) {
                            Text(this.chapterTitle)
                                .fontSize(FontSize.titleLarge)
                                .fontWeight(FontWeight.Medium)
                                .fontColor($r('app.color.text_primary'))
                                .width('100%');

                            if (this.bookTitle.length > 0) {
                                Text(this.bookTitle)
                                    .fontSize(FontSize.caption)
                                    .fontColor($r('app.color.text_tertiary'))
                                    .width('100%');
                            }

                            if (this.content.length > 0) {
                                MarkdownView({ body: this.content })
                            } else {
                                LoadingBlock({ label: this.statusText.length > 0 ? this.statusText : '正在生成…' });
                            }
                        }
                        .width('100%')
                        .padding({ left: Space.lg, right: Space.lg, bottom: Space.md })
                        .alignItems(HorizontalAlign.Start);
                    }
                    .layoutWeight(1)
                    .width('100%')
                    .scrollBar(BarState.Off);
                }
                .width('100%')
                .layoutWeight(1);
            }
        }
        .width('100%')
        .height('100%');
    }

    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.iconLarge,
                buttonSize: Size.touchTarget,
                tint: $r('app.color.icon_primary'),
                onTap: () => {
                    this.onBack();
                }
            })

            Text('个性化学习')
                .fontSize(FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .margin({ left: Space.xs });
        }
        .width('100%')
        .height(48)
        .padding({ left: Space.sm, right: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    // 生成中提示：素材由模型逐段产出，给出明确状态比单纯的进度圈更让人知道发生什么
    @Builder
    GeneratingBar() {
        Row({ space: Space.md }) {
            LoadingProgress()
                .width(Size.icon)
                .height(Size.icon)
                .color($r('app.color.brand_primary'));

            Text(this.statusText.length > 0 ? this.statusText : '正在生成…')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .layoutWeight(1);
        }
        .width('100%')
        .padding(Space.md)
        .margin({ left: Space.lg, right: Space.lg, top: Space.sm })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.brand_soft'))
        .alignItems(VerticalAlign.Center);
    }

    @Builder
    ErrorBar() {
        Text('生成中断：' + this.errorMessage + '（下方为已生成的部分）')
            .fontSize(FontSize.caption)
            .fontColor($r('app.color.danger'))
            .lineHeight(LineHeight.caption)
            .width('100%')
            .padding(Space.md)
            .margin({ left: Space.lg, right: Space.lg, top: Space.sm })
            .borderRadius(Radius.md)
            .backgroundColor($r('app.color.bg_sunken'));
    }
}
