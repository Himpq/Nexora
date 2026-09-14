// LearningReport.ets - 课程学习报告
// 报告数据来自 /api/frontend/learning/report：进度、章节与小节完成度、作答正确率、薄弱环节与学习建议。
// 正确率在无作答记录时后端下发 null，此时显示「暂无作答」而不是 0%。

import { LearningFormat } from '../../common/LearningFormat';
import { emptyReport, LearningHomeApi, LearningReport, LearningReportItem } from '../../common/LearningHomeApi';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder, ProgressTrack, SectionHeader, StatTile, TagPill } from './LearningWidgets';

@Component
export struct LearningReportView {
    @Prop lectureId: string = '';
    @Prop lectureTitle: string = '';
    onBack: () => void = () => {};

    @State private report: LearningReport = emptyReport();
    @State private loading: boolean = true;
    @State private errorMessage: string = '';

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const result = await LearningHomeApi.shared.getReport(this.lectureId);

        this.loading = false;

        if (!result.success || result.report === null) {
            this.errorMessage = result.message;
            return;
        }

        this.report = result.report;
    }

    build() {
        Column() {
            this.TopBar()

            if (this.loading) {
                LoadingBlock({ label: '正在生成学习报告' });
            } else if (this.errorMessage.length > 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '学习报告加载失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else {
                Scroll() {
                    Column({ space: Space.lg }) {
                        this.Summary()
                        this.Progress()
                        this.Questions()
                        this.Items('薄弱环节', '这些地方还需要再练', this.report.weaknesses, $r('app.color.warning'))
                        this.Items('学习建议', '下一步可以这样做', this.report.recommendations, $r('app.color.brand_primary'))
                    }
                    .width('100%')
                    .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.md })
                    .alignItems(HorizontalAlign.Start);
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off);
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

            Text('学习报告')
                .fontSize(FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .layoutWeight(1)
                .margin({ left: Space.xs });
        }
        .width('100%')
        .height(48)
        .padding({ left: Space.sm, right: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    @Builder
    Summary() {
        Column({ space: Space.md }) {
            Row() {
                Column({ space: Space.xxs }) {
                    Text(this.report.lectureTitle.length > 0 ? this.report.lectureTitle : this.lectureTitle)
                        .fontSize(FontSize.title)
                        .fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary'))
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%');

                    Text('已学 ' + LearningFormat.hours(this.report.studyHours))
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_tertiary'));
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);

                TagPill({
                    text: LearningFormat.percent(this.report.progressPercent / 100),
                    tint: $r('app.color.text_brand'),
                    bg: $r('app.color.brand_soft'),
                });
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            ProgressTrack({
                ratio: this.report.progressPercent / 100,
                trackHeight: 6,
            });
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    Progress() {
        Row() {
            StatTile({
                value: this.report.completedChapters + '/' + this.report.totalChapters,
                label: '章节',
                tint: $r('app.color.text_primary'),
            });

            StatTile({
                value: this.report.completedSessions + '/' + this.report.totalSessions,
                label: '小节',
                tint: $r('app.color.text_primary'),
            });

            StatTile({
                value: LearningFormat.percent(this.report.profileCompletionRate),
                label: '画像完善',
                tint: $r('app.color.text_brand'),
            });
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    Questions() {
        Row() {
            StatTile({
                value: this.report.submittedQuestions + '',
                label: '已作答',
                tint: $r('app.color.text_primary'),
            });

            StatTile({
                value: this.report.correctQuestions + '',
                label: '答对',
                tint: $r('app.color.success'),
            });

            StatTile({
                value: this.report.hasAccuracy ? LearningFormat.percent(this.report.accuracy / 100) : '暂无',
                label: '正确率',
                tint: this.report.hasAccuracy ? $r('app.color.text_brand') : $r('app.color.text_tertiary'),
            });
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    Items(title: string, subtitle: string, items: LearningReportItem[], tint: ResourceColor) {
        if (items.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({ title: title, subtitle: subtitle });

                Column() {
                    ForEach(items, (item: LearningReportItem, index: number) => {
                        Column() {
                            Row({ space: Space.md }) {
                                Column()
                                    .width(6)
                                    .height(6)
                                    .borderRadius(3)
                                    .backgroundColor(tint)
                                    .margin({ top: 7 });

                                Column({ space: Space.xxs }) {
                                    Text(item.title)
                                        .fontSize(FontSize.body)
                                        .fontColor($r('app.color.text_primary'))
                                        .width('100%');

                                    if (item.detail.length > 0) {
                                        Text(item.detail)
                                            .fontSize(FontSize.small)
                                            .fontColor($r('app.color.text_secondary'))
                                            .lineHeight(LineHeight.caption)
                                            .width('100%');
                                    }
                                }
                                .layoutWeight(1)
                                .alignItems(HorizontalAlign.Start);
                            }
                            .width('100%')
                            .alignItems(VerticalAlign.Top)
                            .padding({ top: index === 0 ? 0 : Space.md, bottom: Space.md });

                            if (index < items.length - 1) {
                                Divider()
                                    .strokeWidth(0.5)
                                    .color($r('app.color.divider'));
                            }
                        }
                        .width('100%')
                        .alignItems(HorizontalAlign.Start);
                    }, (item: LearningReportItem, index: number) => 'item_' + index + '_' + item.title);
                }
                .width('100%')
                .padding(Space.lg)
                .borderRadius(Radius.lg)
                .backgroundColor($r('app.color.bg_card'))
                .alignItems(HorizontalAlign.Start);
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
    }
}
