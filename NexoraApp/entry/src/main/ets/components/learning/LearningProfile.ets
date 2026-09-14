// LearningProfile.ets - 学习画像与学习报告入口
// 画像由 NexoraLearning 依据学习记录对话生成：8 个维度（含专业、目标、薄弱环节）与 6 项能力评分。
// 评分未评估时后端下发 null，这里显示「未评估」而不是伪造 0 分。

import { LearningFormat } from '../../common/LearningFormat';
import { LearningDashboardLecture, LearningHomeApi } from '../../common/LearningHomeApi';
import {
    emptyProfile,
    LearningProfileData,
    LearningProfileDimension,
    LearningScore,
    LearningStudioApi,
} from '../../common/LearningStudioApi';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { LoadingBlock, Placeholder, ProgressTrack, SectionHeader, TagPill } from './LearningWidgets';

// 评分满分：后端 score 为 0..5 的整数
const SCORE_MAX: number = 5;

@Component
export struct LearningProfile {
    onOpenReport: (lectureId: string, lectureTitle: string) => void = () => {};
    // 评估不在本页完成：交回宿主新建 learning 会话，由 NexoraLearning 画像访谈链路逐维提问并写回评分
    onStartInterview: () => void = () => {};

    @State private profile: LearningProfileData = emptyProfile();
    @State private lectures: LearningDashboardLecture[] = [];
    @State private loading: boolean = true;
    @State private errorMessage: string = '';

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const profileTask = LearningStudioApi.shared.getProfile();
        const dashboardTask = LearningHomeApi.shared.getDashboard();

        const profileResult = await profileTask;
        const dashboardResult = await dashboardTask;

        this.loading = false;

        if (!profileResult.success) {
            this.errorMessage = profileResult.message;
            return;
        }

        this.profile = profileResult.profile;
        this.lectures = dashboardResult.dashboard.lectures;
    }

    build() {
        Column() {
            if (this.loading) {
                LoadingBlock({ label: '正在加载学习画像' });
            } else if (this.errorMessage.length > 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '学习画像加载失败',
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
                        this.Completion()
                        this.Interview()
                        this.Dimensions()
                        this.Scores()
                        this.Reports()
                    }
                    .width('100%')
                    .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
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

    // ---------- 画像完成度 ----------
    @Builder
    Completion() {
        Column({ space: Space.md }) {
            Row() {
                Text(LearningFormat.percent(this.profile.completionRate))
                    .fontSize(FontSize.display)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_brand'));

                Blank();

                TagPill({
                    text: this.lectures.length + ' 门在学课程',
                    tint: $r('app.color.text_brand'),
                    bg: $r('app.color.brand_soft'),
                });
            }
            .width('100%')
            .alignItems(VerticalAlign.Bottom);

            Text('画像完善度')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'));

            ProgressTrack({
                ratio: this.profile.completionRate,
                trackHeight: 6,
            });

            Text(this.completionHint())
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_tertiary'))
                .lineHeight(18)
                .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    private completionHint(): string {
        if (this.profile.totalCount <= 0) {
            return '尚未建立画像，继续学习后系统会自动补全';
        }

        if (this.profile.filledCount >= this.profile.totalCount) {
            return '画像维度已全部完善，题目与资源会持续贴合你的薄弱环节';
        }

        return '还有 ' + (this.profile.totalCount - this.profile.filledCount) + ' 个维度待完善';
    }

    // ---------- 六维快速评估 ----------
    // 评分只能由对话产生：模型逐维给出选择题，用户点选后模型调用 submit_profile_score 写回。
    // 本页只负责发起学习会话（conversation_mode=learning + interview 载荷），不在这里伪造分数。
    @Builder
    Interview() {
        Column({ space: Space.md }) {
            SectionHeader({
                title: '六维能力评估',
                subtitle: this.profile.scoredCount + ' / ' + this.profile.scoreTotal + ' 项已评估',
            });

            Text(this.interviewHint())
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .lineHeight(LineHeight.caption)
                .width('100%');

            Text(this.interviewLabel())
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_inverse'))
                .width('100%')
                .height(44)
                .textAlign(TextAlign.Center)
                .borderRadius(Radius.md)
                .backgroundColor($r('app.color.brand_primary'))
                .onClick(() => {
                    this.onStartInterview();
                });

            Text('评估在新开的学习对话里进行，逐题点选即可，答完回到本页刷新')
                .fontSize(FontSize.micro)
                .fontColor($r('app.color.text_tertiary'))
                .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    private interviewLabel(): string {
        if (this.profile.scoreTotal > 0 && this.profile.scoredCount >= this.profile.scoreTotal) {
            return '重新评估';
        }

        return this.profile.scoredCount > 0 ? '继续评估' : '开始快速评估';
    }

    private interviewHint(): string {
        if (this.profile.scoreTotal > 0 && this.profile.scoredCount >= this.profile.scoreTotal) {
            return '六项能力均已评估。重答一轮可以覆盖旧分，评估结果会用于调整学习路线与题目难度';
        }

        if (this.profile.scoredCount > 0) {
            return '还有 ' + (this.profile.scoreTotal - this.profile.scoredCount) + ' 项未评估，继续完成即可补齐六维能力图';
        }

        return '用几道选择题快速建立你的六维能力基线，评估结果决定学习路线怎么排、题目给多难';
    }

    // ---------- 画像维度 ----------
    @Builder
    Dimensions() {
        if (this.profile.dimensions.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({ title: '画像维度' });

                Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
                    ForEach(this.profile.dimensions, (dimension: LearningProfileDimension) => {
                        Column({ space: Space.xs }) {
                            Text(dimension.name)
                                .fontSize(FontSize.caption)
                                .fontColor($r('app.color.text_tertiary'))
                                .maxLines(1)
                                .textOverflow({ overflow: TextOverflow.Ellipsis })
                                .width('100%');

                            Text(dimension.filled && dimension.value.length > 0 ? dimension.value : '待完善')
                                .fontSize(FontSize.small)
                                .fontColor(dimension.filled
                                    ? $r('app.color.text_primary')
                                    : $r('app.color.text_tertiary'))
                                .lineHeight(20)
                                .width('100%');
                        }
                        .width('48%')
                        .padding(Space.md)
                        .borderRadius(Radius.md)
                        .backgroundColor($r('app.color.bg_card'))
                        .alignItems(HorizontalAlign.Start)
                        .margin({ bottom: Space.md });
                    }, (dimension: LearningProfileDimension) => 'dim_' + dimension.key);
                }
                .width('100%');
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
    }

    // ---------- 能力评分 ----------
    @Builder
    Scores() {
        if (this.profile.scores.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({
                    title: '能力评分',
                    subtitle: this.profile.scoredCount + '/' + this.profile.scores.length + ' 项已评估',
                });

                Column({ space: Space.lg }) {
                    ForEach(this.profile.scores, (score: LearningScore) => {
                        Column({ space: Space.sm }) {
                            Row() {
                                Text(score.name)
                                    .fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary'));

                                Blank();

                                Text(score.hasScore ? score.score + ' / ' + SCORE_MAX : '未评估')
                                    .fontSize(FontSize.small)
                                    .fontColor(score.hasScore
                                        ? $r('app.color.text_brand')
                                        : $r('app.color.text_tertiary'));
                            }
                            .width('100%')
                            .alignItems(VerticalAlign.Center);

                            ProgressTrack({
                                ratio: score.hasScore ? score.score / SCORE_MAX : 0,
                                trackHeight: 4,
                            });

                            if (score.evidence.length > 0) {
                                Text(score.evidence)
                                    .fontSize(FontSize.caption)
                                    .fontColor($r('app.color.text_tertiary'))
                                    .lineHeight(18)
                                    .width('100%');
                            }
                        }
                        .width('100%')
                        .alignItems(HorizontalAlign.Start);
                    }, (score: LearningScore) => 'score_' + score.key);
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

    // ---------- 学习报告入口 ----------
    @Builder
    Reports() {
        Column({ space: Space.md }) {
            SectionHeader({
                title: '学习报告',
                subtitle: '按课程查看进度、正确率与薄弱环节',
            });

            if (this.lectures.length === 0) {
                Column() {
                    Text('还没有在学课程，报告会在开始学习后生成')
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_tertiary'));
                }
                .width('100%')
                .padding(Space.lg)
                .borderRadius(Radius.lg)
                .backgroundColor($r('app.color.bg_card'))
                .alignItems(HorizontalAlign.Start);
            } else {
                Column() {
                    ForEach(this.lectures, (lecture: LearningDashboardLecture) => {
                        Row({ space: Space.md }) {
                            Image($r('app.media.ic_chart'))
                                .width(Size.icon)
                                .height(Size.icon)
                                .fillColor($r('app.color.brand_primary'));

                            Column({ space: Space.xxs }) {
                                Text(lecture.title)
                                    .fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary'))
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('100%');

                                Text('进度 ' + LearningFormat.percent(lecture.progress / 100)
                                    + (lecture.currentChapter.length > 0 ? ' · 当前 ' + lecture.currentChapter : ''))
                                    .fontSize(FontSize.caption)
                                    .fontColor($r('app.color.text_tertiary'))
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('100%');
                            }
                            .layoutWeight(1)
                            .alignItems(HorizontalAlign.Start);

                            Image($r('app.media.ic_chevron_right'))
                                .width(Size.iconSmall)
                                .height(Size.iconSmall)
                                .fillColor($r('app.color.icon_secondary'));
                        }
                        .width('100%')
                        .padding({ top: Space.md, bottom: Space.md })
                        .alignItems(VerticalAlign.Center)
                        .onClick(() => {
                            this.onOpenReport(lecture.id, lecture.title);
                        });
                    }, (lecture: LearningDashboardLecture) => 'report_' + lecture.id);
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.lg })
                .borderRadius(Radius.lg)
                .backgroundColor($r('app.color.bg_card'))
                .alignItems(HorizontalAlign.Start);
            }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }
}
