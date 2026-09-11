// LearningCourses.ets - 课程库（在学课程进度 + 其他课程）
// 课程公开信息来自 /api/lectures，进度与当前章节来自 /api/frontend/dashboard，两者按课程 id 合并。
// 合并后按「是否已产生阅读记录」分为两组：在学课程排前面并展示进度条，
// 尚未开始的归入其他课程。首页原来那张「课程进度」清单搬到这里，课程相关内容不再分居两页。
// 每门课程都带封面：后端下发的 cover_path 是教材插图接口路径，为空时显示品牌色图标底。

import { LearningApi, LearningLecture } from '../../common/LearningApi';
import { LearningFormat } from '../../common/LearningFormat';
import { LearningDashboardLecture, LearningHomeApi } from '../../common/LearningHomeApi';
import { FontSize, Radius, Space } from '../../common/DesignToken';
import { AppState } from '../../common/AppState';
import { CoverImage, LoadingBlock, Placeholder, ProgressTrack, SectionHeader, TagPill } from './LearningWidgets';

// 课程封面为正方形：课程是入口，教材才是竖版书封，两种形态区分开
const COURSE_COVER: number = 56;

// 课程进度：只有已选课程（dashboard 已选列表）才有，未选课程无此记录
interface CourseProgress {
    progress: number;
    currentChapter: string;
    studyHours: number;
    lastActiveTs: number;
}

@Component
export struct LearningCourses {
    @ObjectLink app: AppState;
    onOpenCourse: (lectureId: string, title: string) => void = () => {};

    @State private lectures: LearningLecture[] = [];
    @State private studying: LearningLecture[] = [];
    @State private others: LearningLecture[] = [];
    @State private loading: boolean = true;
    @State private errorMessage: string = '';

    private progressById: Map<string, CourseProgress> = new Map<string, CourseProgress>();

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const lectureTask = LearningApi.shared.listLectures();
        const dashboardTask = LearningHomeApi.shared.getDashboard();

        const lectureResult = await lectureTask;
        const dashboardResult = await dashboardTask;

        this.loading = false;

        if (!lectureResult.success) {
            this.errorMessage = lectureResult.message;
            return;
        }

        this.progressById.clear();

        for (let i: number = 0; i < dashboardResult.dashboard.lectures.length; i++) {
            const item: LearningDashboardLecture = dashboardResult.dashboard.lectures[i];

            this.progressById.set(item.id, {
                progress: item.progress,
                currentChapter: item.currentChapter,
                studyHours: item.studyHours,
                lastActiveTs: item.lastActiveTs,
            });
        }

        this.lectures = lectureResult.lectures;
        this.studying = this.splitStudying();
        this.others = this.splitOthers();
    }

    // 在学课程：有阅读记录的课程，按最近活跃倒序
    private splitStudying(): LearningLecture[] {
        const result: LearningLecture[] = [];

        for (let i: number = 0; i < this.lectures.length; i++) {
            if (this.progressOf(this.lectures[i].id).progress > 0) {
                result.push(this.lectures[i]);
            }
        }

        result.sort((left: LearningLecture, right: LearningLecture): number => {
            return this.progressOf(right.id).lastActiveTs - this.progressOf(left.id).lastActiveTs;
        });

        return result;
    }

    // 其他课程：尚未产生阅读记录的课程
    private splitOthers(): LearningLecture[] {
        const result: LearningLecture[] = [];

        for (let i: number = 0; i < this.lectures.length; i++) {
            if (this.progressOf(this.lectures[i].id).progress <= 0) {
                result.push(this.lectures[i]);
            }
        }

        return result;
    }

    build() {
        Column() {
            if (this.loading) {
                LoadingBlock({ label: '正在加载课程' });
            } else if (this.errorMessage.length > 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '课程加载失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else if (this.lectures.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_book'),
                    title: '还没有可学习的课程',
                    hint: '在 NexoraLearning 工作台导入教材后，这里会自动出现课程',
                });
            } else {
                List({ space: Space.md }) {
                    if (this.studying.length > 0) {
                        ListItem() {
                            SectionHeader({
                                title: '在学课程',
                                subtitle: this.studying.length + ' 门有阅读记录',
                            })
                        }

                        ForEach(this.studying, (lecture: LearningLecture) => {
                            ListItem() {
                                this.StudyCard(lecture)
                            }
                        }, (lecture: LearningLecture) => 'studying_' + lecture.id)
                    }

                    if (this.others.length > 0) {
                        ListItem() {
                            SectionHeader({ title: '其他课程', subtitle: '尚未开始' })
                        }

                        ForEach(this.others, (lecture: LearningLecture) => {
                            ListItem() {
                                this.OtherCard(lecture)
                            }
                        }, (lecture: LearningLecture) => 'other_' + lecture.id)
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off)
                .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md });
            }
        }
        .width('100%')
        .height('100%');
    }

    // 在学课程卡：封面 + 标题 + 简介 + 进度条 + 当前章节
    @Builder
    StudyCard(lecture: LearningLecture) {
        Column({ space: Space.md }) {
            this.CoverRow(lecture)

            Column({ space: Space.xs }) {
                ProgressTrack({
                    ratio: this.progressOf(lecture.id).progress / 100,
                    trackHeight: 4,
                });

                Row() {
                    Text(this.studyHint(lecture.id))
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1);

                    Text(LearningFormat.percent(this.progressOf(lecture.id).progress / 100))
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_brand'));
                }
                .width('100%')
                .alignItems(VerticalAlign.Center);
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
            this.onOpenCourse(lecture.id, lecture.title);
        });
    }

    // 其他课程卡：封面 + 标题 + 简介 + 分类与教材数
    @Builder
    OtherCard(lecture: LearningLecture) {
        Column({ space: Space.md }) {
            this.CoverRow(lecture)

            Row({ space: Space.sm }) {
                if (lecture.category.length > 0) {
                    TagPill({ text: lecture.category });
                }

                TagPill({ text: lecture.bookCount + ' 本教材' });
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
            this.onOpenCourse(lecture.id, lecture.title);
        });
    }

    // 封面 + 标题 + 简介：两种课程卡共用的头部，抽出来避免重复
    @Builder
    CoverRow(lecture: LearningLecture) {
        Row({ space: Space.md }) {
            CoverImage({
                source: lecture.coverPath,
                frameWidth: COURSE_COVER,
                frameHeight: COURSE_COVER,
            })

            Column({ space: Space.xs }) {
                Text(lecture.title)
                    .fontSize(FontSize.bodyLarge)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%');

                Text(lecture.description.length > 0 ? lecture.description : '暂无课程简介')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%');
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .alignItems(VerticalAlign.Top);
    }

    private progressOf(lectureId: string): CourseProgress {
        const found: CourseProgress | undefined = this.progressById.get(lectureId);

        if (found === undefined) {
            return { progress: 0, currentChapter: '', studyHours: 0, lastActiveTs: 0 };
        }

        return found;
    }

    private studyHint(lectureId: string): string {
        const item: CourseProgress = this.progressOf(lectureId);
        let hint: string = '';

        if (item.currentChapter.length > 0) {
            hint = '当前 ' + item.currentChapter;
        }

        if (item.studyHours > 0) {
            hint = hint.length > 0
                ? hint + ' · 已学 ' + LearningFormat.hours(item.studyHours)
                : '已学 ' + LearningFormat.hours(item.studyHours);
        }

        return hint.length > 0 ? hint : '继续阅读';
    }
}
