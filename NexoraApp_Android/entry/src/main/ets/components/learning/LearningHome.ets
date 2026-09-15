// LearningHome.ets - 学习首页（内容聚合面板）
// 首页只回答「我现在该学什么」：学习概览 → 继续学习 → 学习通知 → 资源推送 → 学习动态。
// 课程进度归「课程库」、题库速览归「题库」，首页不再重复罗列明细，避免同一份数据在两页各说一遍。
// 所有数据均来自 NexoraLearning 真实接口，无内容时不占位造数据，直接隐藏该区块。

import { emptyBank, LearningBankApi, LearningBankResult } from '../../common/LearningBankApi';
import { LearningFormat } from '../../common/LearningFormat';
import {
    LearningDashboard,
    LearningDashboardLecture,
    emptyDashboard,
    LearningHomeApi,
    LearningNotice,
} from '../../common/LearningHomeApi';
import {
    LearningFeedItem,
    LearningPush,
    LearningProfileData,
    emptyProfile,
    LearningStudioApi,
} from '../../common/LearningStudioApi';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { AppState } from '../../common/AppState';
import { CardShell, CoverImage, LoadingBlock, Placeholder, ProgressTrack, SectionHeader, StatTile, TagPill } from './LearningWidgets';

// 首页资源推送横向卡的宽度：露出下一张卡的一角，暗示可横滑
const PUSH_CARD_WIDTH: number = 232;

// 继续学习卡封面：与课程库保持同一形态（正方形课程封面）
const CONTINUE_COVER: number = 56;

// 焦点课程哨兵：加载完成前不参与渲染，避免渲染层反复判空
const NO_FOCUS: LearningDashboardLecture = {
    id: '',
    title: '',
    description: '',
    category: '',
    status: '',
    coverPath: '',
    bookCount: 0,
    progress: 0,
    currentChapter: '',
    nextChapter: '',
    studyHours: 0,
    lastActiveTs: 0,
};
const HOME_NOTICE_LIMIT: number = 3;
const HOME_FEED_LIMIT: number = 3;

@Component
export struct LearningHome {
    @ObjectLink app: AppState;
    onOpenCourse: (lectureId: string, title: string) => void = () => {};
    onOpenBank: () => void = () => {};
    onOpenStudio: () => void = () => {};

    @State private dashboard: LearningDashboard = emptyDashboard();
    @State private focus: LearningDashboardLecture = NO_FOCUS;
    @State private notices: LearningNotice[] = [];
    @State private pushes: LearningPush[] = [];
    @State private feeds: LearningFeedItem[] = [];
    @State private bank: LearningBankResult = emptyBank();
    @State private profile: LearningProfileData = emptyProfile();
    @State private loading: boolean = true;
    @State private errorMessage: string = '';
    @State private appeared: boolean = false;

    aboutToAppear(): void {
        this.load().then(() => {
        });
        setTimeout(() => {
            this.appeared = true;
        }, 0);
    }

    // 并行发起各域请求后依次回收：串行等待会把首页拖成多次往返的时间总和
    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const dashboardTask = LearningHomeApi.shared.getDashboard();
        const noticeTask = LearningHomeApi.shared.getNotices(HOME_NOTICE_LIMIT);
        const pushTask = LearningStudioApi.shared.getPushes();
        const feedTask = LearningStudioApi.shared.getFeeds(HOME_FEED_LIMIT);
        const bankTask = LearningBankApi.shared.getItems(1, 1, '');
        const profileTask = LearningStudioApi.shared.getProfile();

        const dashboardResult = await dashboardTask;
        const noticeResult = await noticeTask;
        const pushResult = await pushTask;
        const feedResult = await feedTask;
        const bankResult = await bankTask;
        const profileResult = await profileTask;

        this.loading = false;

        if (!dashboardResult.success && !noticeResult.success && !pushResult.success && !feedResult.success) {
            this.errorMessage = dashboardResult.message;
            return;
        }

        this.dashboard = dashboardResult.dashboard;
        this.focus = LearningHome.pickFocus(this.dashboard.lectures);
        this.notices = noticeResult.notices;
        this.pushes = pushResult.pushes;
        this.feeds = feedResult.items;
        this.bank = bankResult;
        this.profile = profileResult.profile;
    }

    build() {
        Scroll() {
            Column({ space: Space.lg }) {
                this.Overview()

                if (this.loading) {
                    LoadingBlock({ label: '正在整理学习数据' });
                } else if (this.errorMessage.length > 0) {
                    Placeholder({
                        icon: $r('app.media.ic_error'),
                        title: '学习数据加载失败',
                        hint: this.errorMessage,
                        actionLabel: '重新加载',
                        onAction: () => {
                            this.load();
                        }
                    });
                } else {
                    this.ContinueCard()
                    this.NoticeSection()
                    this.PushSection()
                    this.FeedSection()
                }
            }
            .width('100%')
            .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.md })
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .height('100%')
        .scrollBar(BarState.Off)
        .opacity(this.appeared ? 1 : 0)
        .translate({ y: this.appeared ? 0 : 10 })
        .animation({ duration: Motion.durationSlow, curve: Motion.easeOut });
    }

    // ---------- 学习概览 ----------
    // 收进一张卡：三组统计并排 + 一句「下一步该干嘛」，
    // 原来的大标题加三块裸数字会把首屏撑满，却没告诉用户该点哪里
    @Builder
    Overview() {
        Column({ space: Space.md }) {
            Row({ space: Space.sm }) {
                Text(this.overviewHint())
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);

                TagPill({
                    text: LearningFormat.percent(this.profile.completionRate) + ' 画像',
                    tint: $r('app.color.text_brand'),
                    bg: $r('app.color.brand_soft'),
                });
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            Row() {
                StatTile({
                    value: this.dashboard.totalLectures + '',
                    label: '在学课程',
                    tint: $r('app.color.text_primary'),
                });

                StatTile({
                    value: this.dashboard.totalBooks + '',
                    label: '教材',
                    tint: $r('app.color.text_primary'),
                });

                StatTile({
                    value: LearningFormat.hours(this.dashboard.totalStudyHours),
                    label: '累计时长',
                    tint: $r('app.color.text_brand'),
                });
            }
            .width('100%');
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.lg, bottom: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    private overviewHint(): string {
        if (this.profile.filledCount <= 0) {
            return '完成画像后，题目与资源会更贴合你的薄弱环节';
        }

        if (this.bank.summary.pending > 0) {
            return '还有 ' + this.bank.summary.pending + ' 道题待作答';
        }

        return '画像维度 ' + this.profile.filledCount + '/' + this.profile.totalCount + ' 已完善';
    }

    // ---------- 继续学习 ----------
    @Builder
    ContinueCard() {
        if (this.focus.id.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({ title: '继续学习', subtitle: '接着上次的进度往下读' });

                CardShell({
                    contentPadding: Space.lg,
                    cardBg: $r('app.color.brand_soft'),
                    borderTint: $r('app.color.brand_primary'),
                    onTap: () => {
                        this.onOpenCourse(this.focus.id, this.focus.title);
                    }
                }) {
                    Column({ space: Space.md }) {
                        Row({ space: Space.md }) {
                            CoverImage({
                                source: this.focus.coverPath,
                                frameWidth: CONTINUE_COVER,
                                frameHeight: CONTINUE_COVER,
                            })

                            Column({ space: Space.xs }) {
                                Text(this.focus.title)
                                    .fontSize(FontSize.bodyLarge)
                                    .fontWeight(FontWeight.Medium)
                                    .fontColor($r('app.color.text_primary'))
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('100%');

                                Text(this.continueHint(this.focus))
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.text_secondary'))
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('100%');
                            }
                            .layoutWeight(1)
                            .alignItems(HorizontalAlign.Start);
                        }
                        .width('100%')
                        .alignItems(VerticalAlign.Center);

                        ProgressTrack({
                            ratio: this.focus.progress / 100,
                            trackHeight: 6,
                            trackColor: $r('app.color.bg_card'),
                        });

                        Row() {
                            Text(LearningFormat.percent(this.focus.progress / 100) + ' 已完成')
                                .fontSize(FontSize.caption)
                                .fontColor($r('app.color.text_tertiary'));

                            Blank();

                            Row({ space: Space.xs }) {
                                Image($r('app.media.ic_play'))
                                    .width(Size.iconSmall)
                                    .height(Size.iconSmall)
                                    .fillColor($r('app.color.brand_primary'));

                                Text('继续阅读')
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.text_brand'));
                            }
                            .alignItems(VerticalAlign.Center);
                        }
                        .width('100%')
                        .alignItems(VerticalAlign.Center);
                    }
                    .width('100%')
                    .alignItems(HorizontalAlign.Start);
                }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
    }

    // 焦点课程：最近活跃的一门；无在学课程时返回哨兵，首页据此整块隐藏
    private static pickFocus(lectures: LearningDashboardLecture[]): LearningDashboardLecture {
        if (lectures.length === 0) {
            return NO_FOCUS;
        }

        let focus: LearningDashboardLecture = lectures[0];

        for (let i: number = 1; i < lectures.length; i++) {
            if (lectures[i].lastActiveTs > focus.lastActiveTs) {
                focus = lectures[i];
            }
        }

        return focus;
    }

    private continueHint(lecture: LearningDashboardLecture): string {
        if (lecture.nextChapter.length > 0) {
            return '上次读到 ' + lecture.currentChapter + '，接着读 ' + lecture.nextChapter;
        }

        if (lecture.currentChapter.length > 0) {
            return '上次读到 ' + lecture.currentChapter;
        }

        return '还没有开始阅读，从第一章开始';
    }

    // ---------- 学习通知 ----------
    @Builder
    NoticeSection() {
        if (this.notices.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({ title: '学习通知' });

                Column() {
                    ForEach(this.notices, (notice: LearningNotice, index: number) => {
                        Column() {
                            Row({ space: Space.md }) {
                                Column()
                                    .width(6)
                                    .height(6)
                                    .borderRadius(3)
                                    .backgroundColor($r('app.color.brand_primary'))
                                    .margin({ top: 7 });

                                Column({ space: Space.xxs }) {
                                    Text(notice.title)
                                        .fontSize(FontSize.body)
                                        .fontColor($r('app.color.text_primary'))
                                        .maxLines(1)
                                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                                        .width('100%');

                                    Text(notice.content)
                                        .fontSize(FontSize.small)
                                        .fontColor($r('app.color.text_secondary'))
                                        .maxLines(2)
                                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                                        .lineHeight(LineHeight.caption)
                                        .width('100%');

                                    Text(LearningFormat.moment(notice.date))
                                        .fontSize(FontSize.micro)
                                        .fontColor($r('app.color.text_tertiary'));
                                }
                                .layoutWeight(1)
                                .alignItems(HorizontalAlign.Start);
                            }
                            .width('100%')
                            .alignItems(VerticalAlign.Top)
                            .padding({ top: index === 0 ? 0 : Space.md, bottom: Space.md })
                            .onClick(() => {
                                if (notice.lectureId.length > 0) {
                                    this.onOpenCourse(notice.lectureId, '');
                                }
                            });

                            if (index < this.notices.length - 1) {
                                Divider()
                                    .strokeWidth(0.5)
                                    .color($r('app.color.divider'));
                            }
                        }
                        .width('100%')
                        .alignItems(HorizontalAlign.Start);
                    }, (notice: LearningNotice) => 'notice_' + notice.id);
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

    // ---------- 资源推送 ----------
    @Builder
    PushSection() {
        if (this.pushes.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({
                    title: '为你推送',
                    subtitle: '依据学习画像生成',
                    actionLabel: '全部资源',
                    onAction: () => {
                        this.onOpenStudio();
                    }
                });

                Scroll() {
                    Row({ space: Space.md }) {
                        ForEach(this.pushes, (push: LearningPush) => {
                            Column({ space: Space.sm }) {
                                TagPill({
                                    text: push.badge.length > 0 ? push.badge : '学习资源',
                                    tint: $r('app.color.text_brand'),
                                    bg: $r('app.color.brand_soft'),
                                });

                                Text(push.title)
                                    .fontSize(FontSize.body)
                                    .fontWeight(FontWeight.Medium)
                                    .fontColor($r('app.color.text_primary'))
                                    .maxLines(2)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('100%');

                                Text(push.subtitle.length > 0 ? push.subtitle : push.description)
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.text_secondary'))
                                    .maxLines(3)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .lineHeight(LineHeight.caption)
                                    .layoutWeight(1)
                                    .width('100%');
                            }
                            .width(PUSH_CARD_WIDTH)
                            .height(148)
                            .padding(Space.md)
                            .borderRadius(Radius.lg)
                            .backgroundColor($r('app.color.bg_card'))
                            .alignItems(HorizontalAlign.Start)
                            .onClick(() => {
                                this.onOpenStudio();
                            });
                        }, (push: LearningPush) => 'push_' + push.id);
                    }
                    .padding({ right: Space.lg });
                }
                .width('100%')
                .scrollable(ScrollDirection.Horizontal)
                .scrollBar(BarState.Off)
                .align(Alignment.Start);
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
    }

    // ---------- 学习动态 ----------
    @Builder
    FeedSection() {
        if (this.feeds.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({
                    title: '学习动态',
                    actionLabel: '更多',
                    onAction: () => {
                        this.onOpenStudio();
                    }
                });

                Column({ space: Space.md }) {
                    ForEach(this.feeds, (feed: LearningFeedItem) => {
                        Row({ space: Space.md }) {
                            Stack() {
                                Text(feed.authorName.length > 0 ? feed.authorName.substring(0, 1) : '学')
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.brand_text'));
                            }
                            .width(32)
                            .height(32)
                            .borderRadius(Radius.full)
                            .backgroundColor($r('app.color.brand_soft'));

                            Column({ space: Space.xxs }) {
                                Text(feed.authorName.length > 0 ? feed.authorName : '匿名')
                                    .fontSize(FontSize.small)
                                    .fontColor($r('app.color.text_secondary'));

                                Text(feed.content)
                                    .fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary'))
                                    .maxLines(3)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .lineHeight(LineHeight.body)
                                    .width('100%');
                            }
                            .layoutWeight(1)
                            .alignItems(HorizontalAlign.Start);
                        }
                        .width('100%')
                        .alignItems(VerticalAlign.Top);
                    }, (feed: LearningFeedItem) => 'feed_' + feed.id);
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
