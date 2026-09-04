/**
 * 书房（§6.2）：课程 / 教材 / 复习 / 学习工作区入口。从主界面右上角滑出的半屏抽屉。
 * 工具层，不必 agent 化。数据：GET /context（多门课全部展示，不再只取第一门）。
 *
 * 导航约定：从书房推入的页面（阅读器 / 今日任务 / 学习报告）返回时应回到书房而不是主界面——
 * 推页前写 AppStorage('nxReturnToStudy')，Index.onPageShow 据此重新拉起抽屉。
 */
import { ContextData, ContextLecture, ContextBook, OpenSessionData } from '../models/Index';
import { AgentApi, AgentEnvelope } from '../services/AgentApi';
import { SkeletonCard, ErrorState } from '../components/common/States';
import { sharedCache } from '../services/cache/CacheStore';
import { ReadingPosition, nxReadPosition, nxLastBook } from '../services/ReadingState';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize } from '../theme/DesignTokens';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

@Component
export struct StudyView {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State lectures: ContextLecture[] = [];
  @State selectedLectureId: string = '';
  @State opening: boolean = false;
  @State lastBookLabel: string = '';
  @State positionLabels: Map<string, string> = new Map<string, string>();
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  /** 阅读器记完一章 / 页面回到前台时 +1，书房据此刷新进度。 */
  @StorageProp('nxStudyTick') @Watch('onTick') tick: number = 0;
  private api: AgentApi = new AgentApi();

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
    }
    this.load();
  }

  onTick(): void {
    this.load();
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  private selectedLecture(): ContextLecture | null {
    for (const lecture of this.lectures) {
      if (lecture.id === this.selectedLectureId) {
        return lecture;
      }
    }
    return this.lectures.length > 0 ? this.lectures[0] : null;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getContext();
      const ctx: ContextData = env.data as ContextData;
      this.lectures = ctx.lectures;
      const last: ReadingPosition | null = nxLastBook();
      if (last !== null) {
        this.lastBookLabel = last.bookTitle.length > 0 ? last.bookTitle + ' · ' + last.chapterTitle : last.chapterTitle;
      }
      let preferred: string = last !== null ? last.lectureId : '';
      if (preferred.length === 0 && ctx.active_session.lecture_id !== undefined) {
        preferred = ctx.active_session.lecture_id;
      }
      let found = false;
      for (const lecture of this.lectures) {
        if (lecture.id === this.selectedLectureId) {
          found = true;
        }
      }
      if (!found) {
        this.selectedLectureId = '';
        for (const lecture of this.lectures) {
          if (lecture.id === preferred) {
            this.selectedLectureId = lecture.id;
          }
        }
        if (this.selectedLectureId.length === 0 && this.lectures.length > 0) {
          this.selectedLectureId = this.lectures[0].id;
        }
      }
      const labels: Map<string, string> = new Map<string, string>();
      for (const lecture of this.lectures) {
        for (const book of lecture.books) {
          const position = nxReadPosition(lecture.id, book.id);
          if (position !== null && position.chapterTitle.length > 0) {
            labels.set(book.id, '上次读到 ' + position.chapterTitle);
          }
        }
      }
      this.positionLabels = labels;
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '加载学习上下文失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.loading = false;
    }
  }

  private pushFromStudy(url: string, params: Record<string, Object>): void {
    AppStorage.setOrCreate('nxReturnToStudy', true);
    router.pushUrl({ url: url, params: params });
  }

  /**
   * 继续学习：优先回到本地记住的「上次读到」（书 / 章 / 页 / 纸色 / 字号都由阅读器恢复）；
   * 没有本地记录时才向后端开会话拿目标章节。始终端内打开阅读器（§11.3 浏览器跳转零命中）。
   */
  async continueLearning(): Promise<void> {
    if (this.opening) {
      return;
    }
    this.opening = true;
    try {
      const last: ReadingPosition | null = nxLastBook();
      if (last !== null && last.lectureId.length > 0 && last.bookId.length > 0) {
        const params: Record<string, Object> = {
          'lecture_id': last.lectureId,
          'book_id': last.bookId,
          'book_title': last.bookTitle,
          'chapter_index': last.chapter,
          'chapter_name': last.chapterTitle,
          'resume': true,
        };
        this.pushFromStudy('pages/Reader', params);
        return;
      }
      const env: AgentEnvelope = await this.api.postOpenSession();
      const data: OpenSessionData = env.data as OpenSessionData;
      const params: Record<string, Object> = {
        'lecture_id': data.target.lecture_id,
        'book_id': data.target.book_id,
        'book_title': data.target.book_title,
        'chapter_index': data.target.chapter_index,
        'chapter_name': data.target.chapter_name,
        'resume': true,
      };
      this.pushFromStudy('pages/Reader', params);
    } catch (err) {
      const lecture = this.selectedLecture();
      if (lecture !== null && lecture.books.length > 0) {
        this.openBook(lecture, lecture.books[0]);
      } else {
        this.errorText = '还没有教材，先去添加一本。';
      }
    } finally {
      this.opening = false;
    }
  }

  /** 端内打开某本教材：有本地位置就回到那一页，否则从第一章开始。 */
  openBook(lecture: ContextLecture, book: ContextBook): void {
    if (lecture.id.length === 0 || book.id.length === 0) {
      this.errorText = '这本书还没准备好，我打不开它。';
      return;
    }
    const position = nxReadPosition(lecture.id, book.id);
    const params: Record<string, Object> = {
      'lecture_id': lecture.id,
      'book_id': book.id,
      'book_title': book.title,
      'chapter_index': position !== null ? position.chapter : 0,
      'chapter_name': position !== null ? position.chapterTitle : '',
      'resume': position !== null,
    };
    this.pushFromStudy('pages/Reader', params);
  }

  openTodayTask(): void {
    const lecture = this.selectedLecture();
    const last: ReadingPosition | null = nxLastBook();
    let bookId = lecture !== null && lecture.books.length > 0 ? lecture.books[0].id : '';
    if (last !== null && lecture !== null && last.lectureId === lecture.id && last.bookId.length > 0) {
      bookId = last.bookId;
    }
    const params: Record<string, Object> = {
      'lecture_id': lecture !== null ? lecture.id : '',
      'book_id': bookId,
    };
    this.pushFromStudy('pages/TodayTask', params);
  }

  openReport(): void {
    const lecture = this.selectedLecture();
    const params: Record<string, Object> = {
      'lecture_id': lecture !== null ? lecture.id : '',
      'book_id': lecture !== null && lecture.books.length > 0 ? lecture.books[0].id : '',
      'lecture_title': lecture !== null ? lecture.title : '',
    };
    this.pushFromStudy('pages/Report', params);
  }

  private statusLabel(book: ContextBook): string {
    const status = book.refinement_status;
    if (status === 'done' || status === 'completed') {
      return '我精读过';
    }
    if (status === 'running' || status === 'processing' || status === 'extracting') {
      return '我在读';
    }
    if (status === 'failed' || status === 'error') {
      return '解析失败';
    }
    if (status === 'queued') {
      return '排队中';
    }
    if (status === 'extracted' || status === 'uploaded') {
      return '可阅读';
    }
    return status;
  }

  private bookLength(book: ContextBook): string {
    const chars = book.text_chars !== undefined ? book.text_chars : 0;
    if (chars >= 10000) {
      return Math.round(chars / 10000 * 10) / 10 + ' 万字';
    }
    if (chars > 0) {
      return chars + ' 字';
    }
    return '';
  }

  @Builder
  courseChip(lecture: ContextLecture) {
    Column({ space: NxGrid }) {
      Text(lecture.title)
        .fontSize(NxFontSize.sm)
        .fontWeight(lecture.id === this.selectedLectureId ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(lecture.id === this.selectedLectureId ? this.palette().onPrimary : this.palette().text2)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(lecture.progress_percent + '%')
        .fontSize(NxFontSize.xs)
        .fontColor(lecture.id === this.selectedLectureId ? this.palette().onPrimarySoft : this.palette().text3)
    }
    .constraintSize({ maxWidth: 180 })
    .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
    .borderRadius(NxRadius.sm)
    .backgroundColor(lecture.id === this.selectedLectureId ? this.palette().night : this.palette().surface2)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.selectedLectureId = lecture.id;
    })
  }

  build() {
    Scroll() {
      Column({ space: NxGrid * 3 }) {
        Row() {
          Text('书房')
            .fontSize(NxFontSize.title)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette().text1)
        }
        .width('100%')

        if (this.loading && this.lectures.length === 0) {
          SkeletonCard()
          SkeletonCard()
        }

        if (this.errorText.length > 0) {
          ErrorState({ message: this.errorText, onRetry: (): void => {
            this.load();
          } })
        }

        if (this.lectures.length > 1) {
          Scroll() {
            Row({ space: NxGrid * 2 }) {
              ForEach(this.lectures, (lecture: ContextLecture) => {
                this.courseChip(lecture)
              }, (lecture: ContextLecture) => lecture.id)
            }
          }
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          .width('100%')
        }

        if (this.selectedLecture() !== null) {
          Column({ space: NxGrid * 2 }) {
            Text('课程进度')
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text1)
              .width('100%')
            Text(this.selectedLecture()!.title)
              .fontSize(NxFontSize.lg)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text2)
              .width('100%')
            Text(this.selectedLecture()!.current_chapter.length > 0
              ? '读到：' + this.selectedLecture()!.current_chapter
              : '还没开始读哪一章')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
              .width('100%')
            Progress({ value: this.selectedLecture()!.progress_percent, total: 100, type: ProgressType.Linear })
              .width('100%')
              .height(6)
              .color(this.palette().primary)
            Text('已读完 ' + this.selectedLecture()!.progress_percent + '% 的章节 · 在阅读器里翻到章末或点「读完这章」会记入进度')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
              .width('100%')
          }
          .width('100%')
          .padding(NxGrid * 4)
          .borderRadius(NxRadius.md)
          .backgroundColor(this.palette().cardBg)

          Column({ space: NxGrid * 2 }) {
            Text('教材')
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text1)
              .width('100%')
            if (this.selectedLecture()!.books.length === 0) {
              Text('这门课还没有教材。')
                .fontSize(NxFontSize.sm)
                .fontColor(this.palette().text3)
                .width('100%')
            }
            ForEach(this.selectedLecture()!.books, (book: ContextBook) => {
              Row({ space: NxGrid * 2 }) {
                Column({ space: 2 }) {
                  Text(book.title)
                    .fontSize(NxFontSize.lg)
                    .fontColor(this.palette().text2)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text((this.positionLabels.has(book.id) ? this.positionLabels.get(book.id) + ' · ' : '') +
                    this.statusLabel(book) + (this.bookLength(book).length > 0 ? ' · ' + this.bookLength(book) : ''))
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().text3)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                Text(this.positionLabels.has(book.id) ? '接着读' : '打开')
                  .fontSize(NxFontSize.xs)
                  .fontColor(this.palette().primary)
                  .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
                  .borderRadius(NxRadius.xs)
                  .backgroundColor(this.palette().primarySoft)
              }
              .width('100%')
              .padding({ top: NxGrid * 2, bottom: NxGrid * 2 })
              .onClick(() => {
                this.openBook(this.selectedLecture()!, book);
              })
            }, (book: ContextBook) => book.id)
          }
          .width('100%')
          .padding(NxGrid * 4)
          .borderRadius(NxRadius.md)
          .backgroundColor(this.palette().cardBg)
        }

        Column({ space: NxGrid * 2 }) {
          Button(this.lastBookLabel.length > 0 ? '继续学习 · ' + this.lastBookLabel : '继续学习（打开工作区）')
            .width('100%')
            .height(40)
            .fontSize(NxFontSize.lg)
            .backgroundColor(this.palette().primary)
            .fontColor(this.palette().onPrimary)
            .enabled(!this.opening)
            .onClick(() => {
              this.continueLearning();
            })
          Button('今日任务与复习')
            .width('100%')
            .height(40)
            .fontSize(NxFontSize.lg)
            .backgroundColor(this.palette().primarySoft)
            .fontColor(this.palette().primary)
            .onClick(() => {
              this.openTodayTask();
            })
          Button('学习报告与知识图谱')
            .width('100%')
            .height(40)
            .fontSize(NxFontSize.lg)
            .backgroundColor(this.palette().surface3)
            .fontColor(this.palette().text2)
            .onClick(() => {
              this.openReport();
            })
        }
        .width('100%')
      }
      .width('100%')
      .padding(NxGrid * 4)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.palette().pageBg)
    .align(Alignment.TopStart)
  }
}
