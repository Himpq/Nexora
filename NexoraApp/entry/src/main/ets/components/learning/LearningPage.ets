// LearningPage.ets - 学习工作区宿主（原生 ArkUI 自绘，不走 WebView）
// 结构：底部五个 Tab（首页 / 课程 / 题库 / 资源 / 我的）+ 下钻层级
//      （课程目录 / 阅读器 / 文章 / 学习报告 / 学习路线 / 个性化章节）。
//
// 导航：宿主维护一个真正的层级栈 frames，栈底恒为 Tab 工作区。
//   压栈时只有新帧从右侧滑入，下层保持挂载不动；出栈时栈顶滑回右侧、下层原样露出。
//   这既是系统「返回上一级」的堆叠语义，也让下层页面不必重建（Tab 选中态、列表滚动位置都留住）。
//   早期版本只有一个 level 数字、下层条件卸载：返回一律跳回工作区（学习路线退不到课程目录），
//   且下层被卸载时会播放自己的退场动画，方向刚好与前进相反。
//
// 返回键编排：宿主把「栈深度」写入 @Link navDepth，逐级弹出；
//   阅读器内部浮层（目录、排版设置）由宿主转发一次返回请求，保证返回键行为确定。

import { AppState } from '../../common/AppState';
import { LearningChapterSummary } from '../../common/LearningApi';
import { LearningResource } from '../../common/LearningStudioApi';
import { FontSize, Motion, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LearningBank } from './LearningBank';
import { LearningCourseDetail } from './LearningCourseDetail';
import { LearningCourses } from './LearningCourses';
import { LearningHome } from './LearningHome';
import { LearningPath } from './LearningPath';
import { LearningPathChapter } from './LearningPathChapter';
import { LearningProfile } from './LearningProfile';
import { LearningReader } from './LearningReader';
import { LearningReportView } from './LearningReport';
import { LearningArticle, LearningStudio } from './LearningStudio';

// 底部 Tab
enum WorkspaceTab {
    HOME = 0,
    COURSE = 1,
    BANK = 2,
    STUDIO = 3,
    PROFILE = 4,
}

// 层级：0 为 Tab 工作区，>0 为下钻层
enum WorkspaceLevel {
    TAB = 0,
    COURSE_DETAIL = 1,
    READER = 2,
    ARTICLE = 3,
    REPORT = 4,
    PATH = 5,
    PATH_CHAPTER = 6,
}

interface TabItem {
    tab: number;
    label: string;
}

const TABS: TabItem[] = [
    { tab: WorkspaceTab.HOME, label: '首页' },
    { tab: WorkspaceTab.COURSE, label: '课程' },
    { tab: WorkspaceTab.BANK, label: '题库' },
    { tab: WorkspaceTab.STUDIO, label: '资源' },
    { tab: WorkspaceTab.PROFILE, label: '我的' },
];

// 顶栏与底部 Tab 栏高度：顶栏高度对齐子页面原有标题行，切换 Tab 时内容不跳动
const WORKSPACE_BAR_HEIGHT: number = 52;
const TAB_BAR_HEIGHT: number = 56;

@Component
export struct LearningPage {
    @ObjectLink app: AppState;
    // 宿主返回键编排：与 frames.length - 1 不一致表示外层要求回退一层
    @Link @Watch('onNavDepthBack') navDepth: number;
    onBack: () => void = () => {};
    onOpenImage: (url: string) => void = () => {};
    // 交回聊天主界面发起一轮学习会话（画像快速评估用）：宿主新建 learning 会话并发出开场消息
    onStartProfileInterview: () => void = () => {};

    @State private tab: number = WorkspaceTab.HOME;
    // 底部 Tab 栏在沉浸式布局下自己让开手势区（避让高度由 EntryAbility 量好下发）
    @StorageProp('insetBottom') private insetBottom: number = 0;
    // 层级栈：栈底恒为 TAB，栈顶即当前显示页
    @State private frames: number[] = [WorkspaceLevel.TAB];

    // 课程目录上下文
    @State private detailLectureId: string = '';
    @State private detailLectureTitle: string = '';

    // 阅读器上下文
    @State private readerLectureId: string = '';
    @State private readerBookId: string = '';
    @State private readerBookTitle: string = '';
    @State private readerChapters: LearningChapterSummary[] = [];
    @State private readerStartChapter: number = 0;

    // 文章阅读上下文
    @State private articleTitle: string = '';
    @State private articleBody: string = '';

    // 学习报告上下文
    @State private reportLectureId: string = '';
    @State private reportLectureTitle: string = '';

    // 学习路线上下文
    @State private pathLectureId: string = '';
    @State private pathLectureTitle: string = '';

    // 个性化章节上下文
    @State private chapterLectureId: string = '';
    @State private chapterTitle: string = '';
    @State private chapterBookTitle: string = '';
    @State private chapterIndex: number = 0;
    @State private chapterCompleted: boolean = false;

    // 路线刷新信号：章节页标记学完后自增，路线帧据此重读进度
    @State private pathRefreshToken: number = 0;

    // 阅读器浮层是否展开，以及转交给阅读器的返回请求
    @State private readerOverlayOpen: boolean = false;
    @State private readerBackToken: number = 0;

    build() {
        Stack({ alignContent: Alignment.TopStart }) {
            // 页面底色层：窗口是沉浸式布局，本层与各帧一样铺到物理屏底，顺手兜住 Tab 区背景
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_page'));

            ForEach(this.frames, (level: number) => {
                this.Frame(level)
            }, (level: number) => 'frame_' + level);
        }
        .width('100%')
        .height('100%');
    }

    // 栈中的一帧：除栈底的 Tab 工作区以外，各层从右侧滑入 / 滑回右侧
    @Builder
    Frame(level: number) {
        if (level === WorkspaceLevel.TAB) {
            this.WorkspaceFrame()
        } else if (level === WorkspaceLevel.COURSE_DETAIL) {
            LearningCourseDetail({
                app: this.app,
                lectureId: this.detailLectureId,
                lectureTitle: this.detailLectureTitle,
                onBack: () => {
                    this.goBack();
                },
                onOpenBook: (lectureId: string, bookId: string, bookTitle: string,
                    chapters: LearningChapterSummary[], startChapter: number) => {
                    this.openBook(lectureId, bookId, bookTitle, chapters, startChapter);
                },
                onOpenReport: (lectureId: string, title: string) => {
                    this.openReport(lectureId, title);
                },
                onOpenPath: (lectureId: string, title: string) => {
                    this.openPath(lectureId, title);
                }
            })
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_page'))
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        } else if (level === WorkspaceLevel.READER) {
            LearningReader({
                app: this.app,
                lectureId: this.readerLectureId,
                bookId: this.readerBookId,
                bookTitle: this.readerBookTitle,
                chapters: this.readerChapters,
                startChapterIndex: this.readerStartChapter,
                navDepth: $navDepth,
                navLevel: this.frameIndex(WorkspaceLevel.READER),
                readerOverlayOpen: $readerOverlayOpen,
                readerBackToken: $readerBackToken,
                onBack: () => {
                    this.goBack();
                },
                onOpenImage: (url: string) => {
                    this.onOpenImage(url);
                }
            })
                .width('100%')
                .height('100%')
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        } else if (level === WorkspaceLevel.ARTICLE) {
            LearningArticle({
                title: this.articleTitle,
                body: this.articleBody,
                onBack: () => {
                    this.goBack();
                }
            })
                .width('100%')
                .height('100%')
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        } else if (level === WorkspaceLevel.REPORT) {
            LearningReportView({
                lectureId: this.reportLectureId,
                lectureTitle: this.reportLectureTitle,
                onBack: () => {
                    this.goBack();
                }
            })
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_page'))
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        } else if (level === WorkspaceLevel.PATH) {
            LearningPath({
                lectureId: this.pathLectureId,
                lectureTitle: this.pathLectureTitle,
                refreshToken: this.pathRefreshToken,
                onBack: () => {
                    this.goBack();
                },
                onOpenChapter: (lectureId: string, chapterIndex: number, chapterTitle: string,
                    bookTitle: string, learningCompleted: boolean) => {
                    this.openPathChapter(lectureId, chapterIndex, chapterTitle, bookTitle, learningCompleted);
                }
            })
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_page'))
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        } else {
            LearningPathChapter({
                lectureId: this.chapterLectureId,
                chapterIndex: this.chapterIndex,
                chapterTitle: this.chapterTitle,
                bookTitle: this.chapterBookTitle,
                learningCompleted: this.chapterCompleted,
                onBack: () => {
                    this.goBack();
                },
                onCompleted: () => {
                    this.chapterCompleted = true;
                    this.pathRefreshToken = this.pathRefreshToken + 1;
                }
            })
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_page'))
                .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
        }
    }

    // Tab 工作区：常驻栈底，下钻期间保持挂载
    @Builder
    WorkspaceFrame() {
        Column() {
            this.WorkspaceBar()

            this.TabContent()

            this.TabBar()
        }
        .width('100%')
        .height('100%');
    }

    @Builder
    TabContent() {
        if (this.tab === WorkspaceTab.HOME) {
            LearningHome({
                app: this.app,
                onOpenCourse: (lectureId: string, title: string) => {
                    this.openCourse(lectureId, title);
                },
                onOpenBank: () => {
                    this.tab = WorkspaceTab.BANK;
                },
                onOpenStudio: () => {
                    this.tab = WorkspaceTab.STUDIO;
                }
            })
                .width('100%')
                .layoutWeight(1);
        } else if (this.tab === WorkspaceTab.COURSE) {
            LearningCourses({
                app: this.app,
                onOpenCourse: (lectureId: string, title: string) => {
                    this.openCourse(lectureId, title);
                }
            })
                .width('100%')
                .layoutWeight(1);
        } else if (this.tab === WorkspaceTab.BANK) {
            LearningBank()
                .width('100%')
                .layoutWeight(1);
        } else if (this.tab === WorkspaceTab.STUDIO) {
            LearningStudio({
                onOpenArticle: (resource: LearningResource) => {
                    this.openArticle(resource);
                }
            })
                .width('100%')
                .layoutWeight(1);
        } else {
            LearningProfile({
                onOpenReport: (lectureId: string, title: string) => {
                    this.openReport(lectureId, title);
                },
                onStartInterview: () => {
                    this.onStartProfileInterview();
                }
            })
                .width('100%')
                .layoutWeight(1);
        }
    }

    // 工作区顶栏：左侧返回按钮退回聊天主界面（此处是 Tab 层唯一可点的返回入口）
    // 五个 Tab 的标题统一由这里承担，子页面不再各写一份标题行，避免两级标题互相抵消
    @Builder
    WorkspaceBar() {
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

            Text(this.tabTitle())
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);
        }
        .width('100%')
        .height(WORKSPACE_BAR_HEIGHT)
        .padding({ right: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    private tabTitle(): string {
        if (this.tab === WorkspaceTab.COURSE) {
            return '课程库';
        }

        if (this.tab === WorkspaceTab.BANK) {
            return '题库';
        }

        if (this.tab === WorkspaceTab.STUDIO) {
            return '学习资源';
        }

        if (this.tab === WorkspaceTab.PROFILE) {
            return '我的学习';
        }

        return '学习工作区';
    }

    @Builder
    TabBar() {
        Stack({ alignContent: Alignment.Top }) {
            // 底色层铺满整条（含手势区），Tab 内容仍停在手势区之上
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor($r('app.color.bg_card'));

            Row() {
                ForEach(TABS, (item: TabItem) => {
                    Column({ space: Space.xxs }) {
                        Image(this.tabIcon(item.tab))
                            .width(22)
                            .height(22)
                            .fillColor(this.tab === item.tab
                                ? $r('app.color.brand_primary')
                                : $r('app.color.icon_secondary'));

                        Text(item.label)
                            .fontSize(FontSize.micro)
                            .fontColor(this.tab === item.tab
                                ? $r('app.color.text_brand')
                                : $r('app.color.text_tertiary'));
                    }
                    .layoutWeight(1)
                    .height(TAB_BAR_HEIGHT)
                    .justifyContent(FlexAlign.Center)
                    .onClick(() => {
                        this.tab = item.tab;
                    });
                }, (item: TabItem) => 'tab_' + item.tab);
            }
            .width('100%')
            .height(TAB_BAR_HEIGHT)
            .border({ width: { top: Size.divider }, color: $r('app.color.divider') })
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .height(TAB_BAR_HEIGHT + this.insetBottom);
    }

    private tabIcon(tab: number): ResourceStr {
        if (tab === WorkspaceTab.COURSE) {
            return $r('app.media.ic_book');
        }

        if (tab === WorkspaceTab.BANK) {
            return $r('app.media.ic_target');
        }

        if (tab === WorkspaceTab.STUDIO) {
            return $r('app.media.ic_spark');
        }

        if (tab === WorkspaceTab.PROFILE) {
            return $r('app.media.ic_person');
        }

        return $r('app.media.ic_home');
    }

    // ---------- 导航栈 ----------
    private topFrame(): number {
        return this.frames[this.frames.length - 1];
    }

    private frameIndex(level: number): number {
        return this.frames.indexOf(level);
    }

    private navigateTo(level: number): void {
        if (this.frames.indexOf(level) >= 0) {
            return;
        }

        this.frames = this.frames.concat([level]);
        this.navDepth = this.frames.length - 1;
    }

    private popFrame(): void {
        if (this.frames.length <= 1) {
            return;
        }

        this.frames = this.frames.slice(0, this.frames.length - 1);
        this.navDepth = this.frames.length - 1;
    }

    private onNavDepthBack(): void {
        // 深度与自身栈一致说明是自身导航引起的变更，不参与回退
        if (this.navDepth === this.frames.length - 1) {
            return;
        }

        // 阅读器浮层展开时，这次返回交给阅读器消费（关闭浮层而不是退出阅读器）
        if (this.topFrame() === WorkspaceLevel.READER && this.readerOverlayOpen) {
            this.readerBackToken = this.readerBackToken + 1;
            this.navDepth = this.frames.length - 1;
            return;
        }

        this.popFrame();
    }

    private goBack(): void {
        if (this.frames.length <= 1) {
            this.onBack();
            return;
        }

        this.popFrame();
    }

    // ---------- 下钻 ----------
    private openCourse(lectureId: string, title: string): void {
        this.detailLectureId = lectureId;
        this.detailLectureTitle = title;
        this.navigateTo(WorkspaceLevel.COURSE_DETAIL);
    }

    private openBook(lectureId: string, bookId: string, bookTitle: string,
        chapters: LearningChapterSummary[], startChapter: number): void {
        this.readerLectureId = lectureId;
        this.readerBookId = bookId;
        this.readerBookTitle = bookTitle;
        this.readerChapters = chapters;
        this.readerStartChapter = startChapter;
        this.readerOverlayOpen = false;
        this.navigateTo(WorkspaceLevel.READER);
    }

    private openArticle(resource: LearningResource): void {
        this.articleTitle = resource.title;
        this.articleBody = resource.content;
        this.navigateTo(WorkspaceLevel.ARTICLE);
    }

    private openReport(lectureId: string, title: string): void {
        this.reportLectureId = lectureId;
        this.reportLectureTitle = title;
        this.navigateTo(WorkspaceLevel.REPORT);
    }

    private openPath(lectureId: string, title: string): void {
        this.pathLectureId = lectureId;
        this.pathLectureTitle = title;
        this.navigateTo(WorkspaceLevel.PATH);
    }

    private openPathChapter(lectureId: string, chapterIndex: number, chapterTitle: string,
        bookTitle: string, learningCompleted: boolean): void {
        this.chapterLectureId = lectureId;
        this.chapterIndex = chapterIndex;
        this.chapterTitle = chapterTitle;
        this.chapterBookTitle = bookTitle;
        this.chapterCompleted = learningCompleted;
        this.navigateTo(WorkspaceLevel.PATH_CHAPTER);
    }
}
