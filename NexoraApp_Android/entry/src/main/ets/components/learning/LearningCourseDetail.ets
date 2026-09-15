// LearningCourseDetail.ets - 课程目录（教材切换 + 章节目录 + 上次读到）
// 从课程进入阅读的中间层：确认读哪本教材、读到哪一章，再交给阅读器。
// 「上次读到」优先取本地阅读位置，本地无记录时退回首页概览给出的当前章节名。

import { LearningApi, LearningBook, LearningChapterSummary, LearningLecture, NO_BOOK } from '../../common/LearningApi';
import { LearningFormat } from '../../common/LearningFormat';
import { LearningDashboardLecture, LearningHomeApi } from '../../common/LearningHomeApi';
import { FontSize, Radius, Size, Space } from '../../common/DesignToken';
import { AppState } from '../../common/AppState';
import { IconButton } from '../common/IconButton';
import { CoverImage, LoadingBlock, Placeholder, SectionHeader, TagPill } from './LearningWidgets';

// 课程哨兵：加载完成前不参与渲染，避免渲染层反复判空
const NO_LECTURE: LearningLecture = {
    id: '',
    title: '',
    description: '',
    category: '',
    status: '',
    coverPath: '',
    bookCount: 0,
    updatedAt: 0,
};

// 教材封面尺寸：后端封面图为竖版书封（宽高比约 1:1.35）
const BOOK_COVER_WIDTH: number = 62;
const BOOK_COVER_HEIGHT: number = 86;
// 主视区封面：目录从属于教材，教材本体要给出足够辨识度，比书架缩略图大一档
const BOOK_HERO_WIDTH: number = 92;
const BOOK_HERO_HEIGHT: number = 124;
// 书架卡片宽度 = 封面宽 + 左右内边距（各 8）。卡片宽若直接取封面宽，
// padding 会向内挤压内容区，封面反而比内容区宽 16vp，左右各溢出卡片 8vp。
const BOOK_CARD_WIDTH: number = BOOK_COVER_WIDTH + 16;

// 两种学习模式：读教材原文 / 读按画像重排的个性化路线，二者并列而非主次
enum StudyMode {
    READ = 0,
    PATH = 1,
}

@Component
export struct LearningCourseDetail {
    @ObjectLink app: AppState;
    @Prop lectureId: string = '';
    @Prop lectureTitle: string = '';
    onBack: () => void = () => {};
    onOpenBook: (lectureId: string, book: LearningBook,
        chapters: LearningChapterSummary[], startChapter: number) => void = () => {};
    onOpenReport: (lectureId: string, lectureTitle: string) => void = () => {};
    onOpenPath: (lectureId: string, lectureTitle: string) => void = () => {};

    @State private lecture: LearningLecture = NO_LECTURE;
    @State private books: LearningBook[] = [];
    @State private chapters: LearningChapterSummary[] = [];
    @State private selectedBookId: string = '';
    @State private loading: boolean = true;
    @State private chaptersLoading: boolean = false;
    @State private errorMessage: string = '';

    // 首页概览给出的当前章节名，用于本地无阅读位置时兜底定位（真实数据来源，非造值）
    private continueChapterTitle: string = '';

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const lectureTask = LearningApi.shared.getLecture(this.lectureId);
        const dashboardTask = LearningHomeApi.shared.getDashboard();

        const lectureResult = await lectureTask;
        const dashboardResult = await dashboardTask;

        this.loading = false;

        if (!lectureResult.success || lectureResult.lecture === null) {
            this.errorMessage = lectureResult.message;
            return;
        }

        this.lecture = lectureResult.lecture;
        this.books = lectureResult.books;
        this.continueChapterTitle = this.lookupContinueChapter(dashboardResult.dashboard.lectures);

        if (this.books.length > 0) {
            await this.selectBook(this.defaultBookId());
        }
    }

    private lookupContinueChapter(lectures: LearningDashboardLecture[]): string {
        for (let i: number = 0; i < lectures.length; i++) {
            if (lectures[i].id === this.lectureId) {
                return lectures[i].currentChapter;
            }
        }

        return '';
    }

    // 默认教材：优先有阅读记录的那本，否则第一本
    private defaultBookId(): string {
        for (let i: number = 0; i < this.books.length; i++) {
            if (this.app.readPosition(this.books[i].id) >= 0) {
                return this.books[i].id;
            }
        }

        return this.books[0].id;
    }

    private async selectBook(bookId: string): Promise<void> {
        this.selectedBookId = bookId;
        this.chaptersLoading = true;
        this.chapters = [];

        const result = await LearningApi.shared.getBookChapters(this.lectureId, bookId);

        this.chaptersLoading = false;

        if (!result.success) {
            this.errorMessage = result.message;
            return;
        }

        this.chapters = result.chapters;
    }

    // 起始章节：本地阅读位置 > 首页概览的当前章节名 > 第一章
    private startChapterIndex(): number {
        const saved: number = this.app.readPosition(this.selectedBookId);

        if (saved >= 0) {
            return saved;
        }

        if (this.continueChapterTitle.length > 0) {
            for (let i: number = 0; i < this.chapters.length; i++) {
                if (this.chapters[i].title === this.continueChapterTitle) {
                    return this.chapters[i].index;
                }
            }
        }

        return 0;
    }

    private currentBook(): LearningBook {
        for (let i: number = 0; i < this.books.length; i++) {
            if (this.books[i].id === this.selectedBookId) {
                return this.books[i];
            }
        }

        return NO_BOOK;
    }

    private startReading(): void {
        const book: LearningBook = this.currentBook();

        if (book.id.length === 0) {
            return;
        }

        this.onOpenBook(this.lectureId, book, this.chapters, this.startChapterIndex());
    }

    build() {
        Column() {
            this.TopBar()

            if (this.loading) {
                LoadingBlock({ label: '正在打开课程' });
            } else if (this.lecture.id.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '课程打开失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else {
                List({ space: Space.md }) {
                    ListItem() {
                        this.BookHero(this.currentBook())
                    }

                    // 书架只在有多本教材时出现：单本教材的身份已由主视区给出，再列一排是重复信息
                    if (this.books.length > 1) {
                        ListItem() {
                            this.BookShelf()
                        }
                    }

                    ListItem() {
                        this.ModeRow()
                    }

                    ListItem() {
                        SectionHeader({
                            title: '章节目录',
                            subtitle: this.chapters.length > 0 ? '共 ' + this.chapters.length + ' 章' : '',
                        })
                    }

                    if (this.chaptersLoading) {
                        ListItem() {
                            LoadingBlock({ label: '正在加载目录' });
                        }
                    } else if (this.chapters.length === 0) {
                        ListItem() {
                            this.ChapterEmpty()
                        }
                    }

                    ForEach(this.chapters, (chapter: LearningChapterSummary) => {
                        ListItem() {
                            this.ChapterRow(chapter)
                        }
                    }, (chapter: LearningChapterSummary) => 'ch_' + this.selectedBookId + '_' + chapter.index)

                    ListItem() {
                        this.ReportEntry()
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off)
                .padding({ left: Space.lg, right: Space.lg })
                // 纵向留白走 contentStart/EndOffset：写在 padding 上会变成裁切死带（列表底部永远空一条）
                .contentStartOffset(Space.sm)
                .contentEndOffset(Space.md);
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

            Text(this.lecture.title.length > 0 ? this.lecture.title : this.lectureTitle)
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

    // 教材主视区：当前教材的封面 + 简介 + 规模。
    // 目录是「这本教材的目录」，所以教材本体必须先于目录出现，用户才知道自己在读什么。
    @Builder
    BookHero(book: LearningBook) {
        Column({ space: Space.md }) {
            Row({ space: Space.md }) {
                CoverImage({
                    source: book.coverPath,
                    frameWidth: BOOK_HERO_WIDTH,
                    frameHeight: BOOK_HERO_HEIGHT,
                    corner: Radius.md,
                })

                Column({ space: Space.xs }) {
                    Text(book.title.length > 0 ? book.title : '未选择教材')
                        .fontSize(FontSize.bodyLarge)
                        .fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary'))
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%');

                    if (this.bookMeta(book).length > 0) {
                        Text(this.bookMeta(book))
                            .fontSize(FontSize.caption)
                            .fontColor($r('app.color.text_tertiary'))
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%');
                    }

                    if (this.lecture.category.length > 0) {
                        TagPill({ text: this.lecture.category })
                            .margin({ top: Space.xxs });
                    }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);
            }
            .width('100%')
            .alignItems(VerticalAlign.Top);

            Text(book.description.length > 0 ? book.description : '这本教材还没有简介')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .lineHeight(20)
                .maxLines(4)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    // 教材规模：章数 > 插图数 > 正文字数，能拿到什么就列什么
    private bookMeta(book: LearningBook): string {
        const parts: string[] = [];

        if (this.chapters.length > 0) {
            parts.push(this.chapters.length + ' 章');
        }

        if (book.imagesCount > 0) {
            parts.push(book.imagesCount + ' 张插图');
        }

        if (book.textChars > 0) {
            parts.push(LearningFormat.chars(book.textChars));
        }

        return parts.join(' · ');
    }

    // 教材书架：横滑切换教材，切换后重新拉取该教材目录。
    // 只有一本教材时同样展示——用户需要确认自己正在读的到底是哪本书。
    @Builder
    BookShelf() {
        Scroll() {
            Row({ space: Space.md }) {
                ForEach(this.books, (book: LearningBook) => {
                    Column({ space: Space.sm }) {
                        CoverImage({
                            source: book.coverPath,
                            frameWidth: BOOK_COVER_WIDTH,
                            frameHeight: BOOK_COVER_HEIGHT,
                            corner: Radius.sm,
                        })

                        Text(book.title)
                            .fontSize(FontSize.caption)
                            .fontColor(this.selectedBookId === book.id
                                ? $r('app.color.text_brand')
                                : $r('app.color.text_secondary'))
                            .maxLines(2)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%');

                        Text(this.bookHint(book))
                            .fontSize(FontSize.micro)
                            .fontColor($r('app.color.text_tertiary'))
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%');
                    }
                    .width(BOOK_CARD_WIDTH)
                    .padding(Space.sm)
                    .borderRadius(Radius.md)
                    .backgroundColor(this.selectedBookId === book.id
                        ? $r('app.color.brand_soft')
                        : $r('app.color.bg_sunken'))
                    .alignItems(HorizontalAlign.Start)
                    .onClick(() => {
                        if (this.selectedBookId !== book.id) {
                            this.selectBook(book.id).then(() => {
                            });
                        }
                    });
                }, (book: LearningBook) => 'book_' + book.id);
            }
            .padding({ bottom: Space.xs });
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .align(Alignment.Start);
    }

    // 教材副信息：优先插图数，无插图时退回正文字数
    private bookHint(book: LearningBook): string {
        if (book.imagesCount > 0) {
            return book.imagesCount + ' 张插图';
        }

        return LearningFormat.chars(book.textChars);
    }

    // 两种学习模式并排：教材原文按章分页精读，个性化学习按画像与进度重排。
    // 二者都是「学习」，只是模式不同，所以给同等分量，不做主次之分。
    @Builder
    ModeRow() {
        Row({ space: Space.md }) {
            this.ModeCard('继续阅读', this.readActionLabel(), $r('app.media.ic_play'), StudyMode.READ)
            this.ModeCard('个性化学习', '按你的画像排学习顺序', $r('app.media.ic_target'), StudyMode.PATH)
        }
        .width('100%')
        .alignItems(VerticalAlign.Top);
    }

    @Builder
    ModeCard(title: string, hint: string, icon: ResourceStr, mode: number) {
        Column({ space: Space.sm }) {
            Image(icon)
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor(mode === StudyMode.READ
                    ? $r('app.color.text_inverse')
                    : $r('app.color.brand_primary'));

            Text(title)
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor(mode === StudyMode.READ
                    ? $r('app.color.text_inverse')
                    : $r('app.color.text_primary'))
                .maxLines(1);

            Text(hint)
                .fontSize(FontSize.micro)
                .fontColor(mode === StudyMode.READ
                    ? $r('app.color.text_inverse')
                    : $r('app.color.text_tertiary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%');
        }
        .layoutWeight(1)
        .height(104)
        .padding(Space.md)
        .borderRadius(Radius.lg)
        .backgroundColor(mode === StudyMode.READ
            ? $r('app.color.brand_primary')
            : $r('app.color.bg_card'))
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
            if (mode === StudyMode.READ) {
                this.startReading();
                return;
            }

            this.onOpenPath(this.lectureId,
                this.lecture.title.length > 0 ? this.lecture.title : this.lectureTitle);
        });
    }

    private readActionLabel(): string {
        const saved: number = this.app.readPosition(this.selectedBookId);

        if (saved >= 0 && this.chapters.length > 0) {
            return '第 ' + (saved + 1) + ' 章' + this.bookHintOfSelected();
        }

        if (this.continueChapterTitle.length > 0) {
            return this.continueChapterTitle;
        }

        return '从第一章开始';
    }

    private bookHintOfSelected(): string {
        const book: LearningBook = this.currentBook();

        return book.id.length === 0 ? '' : ' · ' + book.title;
    }

    @Builder
    ReportEntry() {
        Row({ space: Space.md }) {
            Image($r('app.media.ic_chart'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.brand_primary'));

            Column({ space: Space.xxs }) {
                Text('学习报告')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'));

                Text('进度、正确率与薄弱环节')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            Image($r('app.media.ic_chevron_right'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.icon_secondary'));
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
            this.onOpenReport(this.lectureId, this.lecture.title);
        });
    }

    @Builder
    ChapterEmpty() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_book'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.icon_secondary'));

            Text(this.errorMessage.length > 0 ? '目录加载失败' : '这本教材还没有可阅读的章节')
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_secondary'));

            if (this.errorMessage.length > 0) {
                Text(this.errorMessage)
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .textAlign(TextAlign.Center);

                Text('重新加载目录')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_brand'))
                    .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.sm })
                    .borderRadius(Radius.full)
                    .backgroundColor($r('app.color.brand_soft'))
                    .onClick(() => {
                        this.selectBook(this.selectedBookId).then(() => {
                        });
                    });
            }
        }
        .width('100%')
        .padding({ top: Space.xl, bottom: Space.xl })
        .alignItems(HorizontalAlign.Center);
    }

    @Builder
    ChapterRow(chapter: LearningChapterSummary) {
        Row({ space: Space.md }) {
            Text((chapter.index + 1) + '')
                .fontSize(FontSize.small)
                .fontColor(this.isContinueChapter(chapter) ? $r('app.color.text_inverse') : $r('app.color.text_secondary'))
                .width(26)
                .height(26)
                .textAlign(TextAlign.Center)
                .borderRadius(Radius.xs)
                .backgroundColor(this.isContinueChapter(chapter)
                    ? $r('app.color.brand_primary')
                    : $r('app.color.bg_sunken'));

            Column({ space: Space.xxs }) {
                Text(chapter.title.length > 0 ? chapter.title : '第 ' + (chapter.index + 1) + ' 章')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%');

                Text(this.chapterHint(chapter))
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%');
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.md)
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
            const book: LearningBook = this.currentBook();

            if (book.id.length === 0) {
                return;
            }

            this.onOpenBook(this.lectureId, book, this.chapters, chapter.index);
        });
    }

    private isContinueChapter(chapter: LearningChapterSummary): boolean {
        return chapter.index === this.startChapterIndex();
    }

    private chapterHint(chapter: LearningChapterSummary): string {
        const paragraphs: number = chapter.paragraphEnd - chapter.paragraphStart + 1;

        if (chapter.sessions.length > 0) {
            return chapter.sessions.length + ' 节 · ' + paragraphs + ' 段';
        }

        return paragraphs + ' 段';
    }
}
