/**
 * 今日任务与复习：挑一章（默认是你上次读到的那一章），异步生成复习题，轮询任务状态，
 * 完成后逐题作答式渲染（先想再看答案）。
 * 之前这里要求教材 refinement_status === 'done'（精读管线跑完）才允许出题，而演示数据里没有一本满足，
 * 于是永远卡在「先完成精读」。后端 review-plan 本就只依赖章节正文，这里改为任何可读教材都能出题。
 * 云端 review-plan 对无知识图谱概念的章节可能返回 TASK_FAILED，页面会原样展示原因。
 */
import {
  AgentEnvelope,
  ContextData,
  ContextBook,
  ContextLecture,
  LearnTarget,
  ReviewAnswerDraft,
  ReviewPlanData,
  ReviewSubmitData,
  TaskData,
  ReviewQuestion,
} from '../models/Index';
import { AgentApi } from '../services/AgentApi';
import { ReaderApi, ChapterMeta } from '../services/ReaderApi';
import { sharedCache } from '../services/cache/CacheStore';
import { nxReadPosition } from '../services/ReadingState';
import { SkeletonCard } from '../components/common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize } from '../theme/DesignTokens';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

class BookChoice {
  key: string = '';
  lectureId: string = '';
  lectureTitle: string = '';
  bookId: string = '';
  bookTitle: string = '';
  /** 默认复习章节：本地上次读到 > 后端会话 > 最近记录 > 0。 */
  chapterIndex: number = 0;
  chapterTitle: string = '';
}

@Entry
@Component
struct TodayTask {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State books: BookChoice[] = [];
  @State chosenKey: string = '';
  @State chapters: ChapterMeta[] = [];
  @State chapterIndex: number = 0;
  @State tocLoading: boolean = false;
  @State taskStatus: string = '';
  @State taskError: string = '';
  @State quizId: string = '';
  @State questions: ReviewQuestion[] = [];
  @State revealed: boolean[] = [];
  @State picked: string[] = [];
  @State submitting: boolean = false;
  @State submitted: boolean = false;
  @State scoreText: string = '';
  @State showPickerSheet: boolean = false;
  @State pickerKind: string = '';
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();
  private readerApi: ReaderApi = new ReaderApi();
  private timerId: number = -1;
  private requestedLecture: string = '';
  private requestedBook: string = '';

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      sharedCache.init(context);
    }
    const params = router.getParams() as Record<string, Object>;
    if (params !== undefined && params !== null) {
      if (params.lecture_id !== undefined) {
        this.requestedLecture = String(params.lecture_id);
      }
      if (params.book_id !== undefined) {
        this.requestedBook = String(params.book_id);
      }
    }
    this.loadTarget();
  }

  aboutToDisappear(): void {
    this.stopPolling();
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  stopPolling(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private chosen(): BookChoice | null {
    for (const book of this.books) {
      if (book.key === this.chosenKey) {
        return book;
      }
    }
    return null;
  }

  async loadTarget(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getContext();
      const ctx: ContextData = env.data as ContextData;
      const choices: BookChoice[] = [];
      for (const lecture of ctx.lectures) {
        for (const book of lecture.books) {
          const choice = new BookChoice();
          choice.key = lecture.id + '/' + book.id;
          choice.lectureId = lecture.id;
          choice.lectureTitle = lecture.title;
          choice.bookId = book.id;
          choice.bookTitle = book.title;
          const position = nxReadPosition(lecture.id, book.id);
          if (position !== null) {
            choice.chapterIndex = position.chapter;
            choice.chapterTitle = position.chapterTitle;
          } else if (ctx.active_session.book_id === book.id) {
            choice.chapterIndex = ctx.active_session.chapter_index;
            choice.chapterTitle = ctx.active_session.chapter_name;
          } else {
            for (const record of ctx.recent_learning_records) {
              if (record.book_id === book.id) {
                choice.chapterIndex = record.chapter_index;
                choice.chapterTitle = record.chapter_name;
                break;
              }
            }
          }
          choices.push(choice);
        }
      }
      this.books = choices;
      if (choices.length === 0) {
        this.errorText = '还没有可复习的教材，先去书房读一章。';
        return;
      }
      let initial: BookChoice = choices[0];
      for (const choice of choices) {
        if (choice.lectureId === this.requestedLecture && (this.requestedBook.length === 0 || choice.bookId === this.requestedBook)) {
          initial = choice;
          break;
        }
      }
      this.chooseBook(initial);
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '加载学习上下文失败';
    } finally {
      this.loading = false;
    }
  }

  async chooseBook(choice: BookChoice): Promise<void> {
    this.chosenKey = choice.key;
    this.chapterIndex = choice.chapterIndex;
    this.chapters = [];
    this.tocLoading = true;
    try {
      const index = await this.readerApi.getIndex(choice.lectureId, choice.bookId);
      if (index.success === true) {
        this.chapters = index.chapters;
        if (this.chapterIndex >= this.chapters.length) {
          this.chapterIndex = 0;
        }
      }
    } catch (err) {
      // 目录取不到就只按默认章节出题
    } finally {
      this.tocLoading = false;
    }
  }

  private chapterHint(): string {
    if (this.chapters.length > 0) {
      return this.chapters.length + ' 章，点这里换';
    }
    if (this.tocLoading) {
      return '正在取目录…';
    }
    return '按上次读到的章节出题';
  }

  private chapterLabel(): string {
    for (const chapter of this.chapters) {
      if (chapter.index === this.chapterIndex) {
        return chapter.title;
      }
    }
    const choice = this.chosen();
    if (choice !== null && choice.chapterTitle.length > 0 && choice.chapterIndex === this.chapterIndex) {
      return choice.chapterTitle;
    }
    return '第 ' + (this.chapterIndex + 1) + ' 章';
  }

  async startReview(): Promise<void> {
    const choice = this.chosen();
    if (choice === null) {
      this.errorText = '先选一本教材。';
      return;
    }
    this.loading = true;
    this.errorText = '';
    this.taskError = '';
    this.questions = [];
    this.revealed = [];
    this.picked = [];
    this.quizId = '';
    this.submitted = false;
    this.scoreText = '';
    try {
      const target: LearnTarget = {
        lecture_id: choice.lectureId,
        lecture_title: choice.lectureTitle,
        book_id: choice.bookId,
        book_title: choice.bookTitle,
        chapter_index: this.chapterIndex,
        chapter_name: this.chapterLabel(),
        chapter_range: '',
      };
      const env: AgentEnvelope = await this.api.postReviewPlan(target, 3);
      const data: ReviewPlanData = env.data as ReviewPlanData;
      this.taskStatus = data.task.status;
      this.beginPolling(data.task.task_id);
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '创建复习任务失败';
    } finally {
      this.loading = false;
    }
  }

  beginPolling(taskId: string): void {
    this.stopPolling();
    this.pollTask(taskId);
    this.timerId = setInterval(() => {
      this.pollTask(taskId);
    }, 4000);
  }

  async pollTask(taskId: string): Promise<void> {
    try {
      const env: AgentEnvelope = await this.api.getTask(taskId);
      const data: TaskData = env.data as TaskData;
      this.taskStatus = data.task.status;
      if (data.task.status === 'completed') {
        this.stopPolling();
        if (data.task.result) {
          this.quizId = data.task.result.quiz_id;
          this.questions = data.task.result.questions;
          const flags: boolean[] = [];
          const picks: string[] = [];
          for (const question of this.questions) {
            flags.push(false);
            picks.push('');
          }
          this.revealed = flags;
          this.picked = picks;
        }
      } else if (data.task.status === 'failed') {
        this.stopPolling();
        this.taskError = data.task.error ? data.task.error.message : '任务失败，未返回原因';
      }
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '轮询失败：' + (e.message.length > 0 ? e.message : '网络错误');
    }
  }

  private statusText(): string {
    if (this.taskStatus === 'queued') {
      return '排队中，我马上开始出题…';
    }
    if (this.taskStatus === 'running') {
      return '我在读这一章，出题需要十几秒…';
    }
    if (this.taskStatus === 'completed') {
      return '出好了，先自己想一想，再看答案。';
    }
    if (this.taskStatus === 'failed') {
      return '这次没出成。';
    }
    return this.taskStatus;
  }

  optionLabel(index: number): string {
    return String.fromCharCode(65 + index) + '. ';
  }

  private isDummyOption(option: string): boolean {
    const text = option.trim().toLowerCase();
    return text.length === 0 || text === '无' || text === '暂无' || text === 'none' || text === 'n/a' || text === '-' ||
      text === '—' || text === '选项' || text === '略';
  }

  private visibleOptions(question: ReviewQuestion): string[] {
    const rows: string[] = [];
    for (const option of question.options) {
      if (!this.isDummyOption(option)) {
        rows.push(option);
      }
    }
    return rows;
  }

  private isChoice(question: ReviewQuestion): boolean {
    if (question.type === 'text' || question.type === 'short_answer' || question.type === '简答题') {
      return false;
    }
    return this.visibleOptions(question).length >= 2;
  }

  private questionId(question: ReviewQuestion, index: number): string {
    return question.source_id.length > 0 ? question.source_id : ('q' + index);
  }

  async submitReview(): Promise<void> {
    const choice = this.chosen();
    if (choice === null || this.submitting || this.submitted || this.questions.length === 0) {
      return;
    }
    this.submitting = true;
    this.errorText = '';
    const payload: ReviewAnswerDraft[] = [];
    for (let index = 0; index < this.questions.length; index++) {
      const draft: ReviewAnswerDraft = {
        question_id: this.questionId(this.questions[index], index),
        answer: this.picked[index] !== undefined ? this.picked[index].trim() : '',
      };
      payload.push(draft);
    }
    try {
      const target: LearnTarget = {
        lecture_id: choice.lectureId,
        lecture_title: choice.lectureTitle,
        book_id: choice.bookId,
        book_title: choice.bookTitle,
        chapter_index: this.chapterIndex,
        chapter_name: this.chapterLabel(),
        chapter_range: '',
      };
      const env: AgentEnvelope = await this.api.postReviewSubmit(this.quizId, target, payload);
      const data: ReviewSubmitData = env.data as ReviewSubmitData;
      this.scoreText = data.score;
      this.submitted = true;
      const flags: boolean[] = [];
      for (const question of this.questions) {
        flags.push(true);
      }
      this.revealed = flags;
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '这组题我没判上';
    } finally {
      this.submitting = false;
    }
  }

  /** 后端答案可能是选项原文、字母（"C"）、或 "C. MAIN 表空间"。 */
  private isCorrect(question: ReviewQuestion, option: string, optIndex: number): boolean {
    const answer = question.answer.trim();
    if (answer === option) {
      return true;
    }
    const letter = String.fromCharCode(65 + optIndex);
    const upper = answer.toUpperCase();
    if (upper === letter) {
      return true;
    }
    if (upper.indexOf(letter + '.') === 0 || upper.indexOf(letter + '、') === 0 || upper.indexOf(letter + ' ') === 0) {
      return true;
    }
    if (answer.indexOf(option) >= 0) {
      return true;
    }
    return false;
  }

  private answerText(question: ReviewQuestion): string {
    const answer = question.answer.trim();
    if (answer.length === 1 && question.options.length > 0) {
      const idx = answer.toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < question.options.length) {
        return answer.toUpperCase() + '. ' + question.options[idx];
      }
    }
    return answer;
  }

  openChapterInReader(): void {
    const choice = this.chosen();
    if (choice === null) {
      return;
    }
    const params: Record<string, Object> = {
      'lecture_id': choice.lectureId,
      'book_id': choice.bookId,
      'book_title': choice.bookTitle,
      'chapter_index': this.chapterIndex,
      'chapter_name': this.chapterLabel(),
    };
    router.pushUrl({ url: 'pages/Reader', params: params });
  }

  private optionInk(question: ReviewQuestion, option: string, optIndex: number, index: number): string {
    if (this.revealed[index] && this.isCorrect(question, option, optIndex)) {
      return this.palette().success;
    }
    if (this.revealed[index] && this.picked[index] === option) {
      return this.palette().danger;
    }
    if (this.picked[index] === option) {
      return this.palette().primary;
    }
    return this.palette().text2;
  }

  private optionFill(question: ReviewQuestion, option: string, optIndex: number, index: number): string {
    if (this.revealed[index] && this.isCorrect(question, option, optIndex)) {
      return this.palette().primarySoft;
    }
    if (this.picked[index] === option) {
      return this.palette().primarySoft;
    }
    return this.palette().surface2;
  }

  @Builder
  pickerRow(caption: string, title: string, hint: string, onTap: () => void) {
    Column({ space: NxGrid }) {
      Text(caption)
        .fontSize(NxFontSize.xs)
        .fontColor(this.palette().text3)
        .width('100%')
      Row() {
        Column({ space: 2 }) {
          Text(title)
            .fontSize(NxFontSize.lg)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.palette().text1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          if (hint.length > 0) {
            Text(hint)
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Text('选择')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().cardBg)
      }
      .width('100%')
      .padding({ top: NxGrid, bottom: NxGrid })
      .onClick(() => {
        onTap();
      })
    }
    .width('100%')
  }

  private openPicker(kind: string): void {
    this.pickerKind = kind;
    this.showPickerSheet = true;
  }

  @Builder
  pickerSheet() {
    Column({ space: NxGrid * 2 }) {
      Text(this.pickerKind === 'chapter' ? '选章节' : '选教材')
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      if (this.pickerKind === 'chapter' && this.tocLoading) {
        Text('我在取目录…')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
      }
      if (this.pickerKind === 'chapter') {
        List() {
          ForEach(this.chapters, (chapter: ChapterMeta) => {
            ListItem() {
              Row() {
                Text(chapter.title)
                  .fontSize(NxFontSize.lg)
                  .fontColor(chapter.index === this.chapterIndex ? this.palette().primary : this.palette().text2)
                  .layoutWeight(1)
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (chapter.index === this.chapterIndex) {
                  Text('在用')
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().primary)
                }
              }
              .width('100%')
              .padding({ top: NxGrid * 3, bottom: NxGrid * 3 })
              .onClick(() => {
                this.chapterIndex = chapter.index;
                this.showPickerSheet = false;
              })
            }
          }, (chapter: ChapterMeta) => String(chapter.index))
        }
        .layoutWeight(1)
        .width('100%')
        .divider({ strokeWidth: 1, color: this.palette().border })
      } else {
        List() {
          ForEach(this.books, (book: BookChoice) => {
            ListItem() {
              Row() {
                Column({ space: 2 }) {
                  Text(book.bookTitle)
                    .fontSize(NxFontSize.lg)
                    .fontColor(book.key === this.chosenKey ? this.palette().primary : this.palette().text1)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (book.lectureTitle.length > 0 && book.lectureTitle !== book.bookTitle) {
                    Text(book.lectureTitle)
                      .fontSize(NxFontSize.xs)
                      .fontColor(this.palette().text3)
                  }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                if (book.key === this.chosenKey) {
                  Text('在用')
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().primary)
                }
              }
              .width('100%')
              .padding({ top: NxGrid * 3, bottom: NxGrid * 3 })
              .onClick(() => {
                this.chooseBook(book);
                this.showPickerSheet = false;
              })
            }
          }, (book: BookChoice) => book.key)
        }
        .layoutWeight(1)
        .width('100%')
        .divider({ strokeWidth: 1, color: this.palette().border })
      }
    }
    .width('100%')
    .height('100%')
    .padding(NxGrid * 4)
  }

  @Builder
  questionCard(question: ReviewQuestion, index: number) {
    Column({ space: NxGrid * 2 }) {
      Row() {
        Text('第 ' + (index + 1) + ' 题')
          .fontSize(NxFontSize.md)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
        Blank()
        Text(this.isChoice(question) ? '选择题' : '简答题')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
        if (question.difficulty.length > 0) {
          Text(question.difficulty)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().warning)
            .margin({ left: NxGrid * 2 })
        }
      }
      .width('100%')
      if (question.title.length > 0 && question.title !== question.content) {
        Text(question.title)
          .fontSize(NxFontSize.lg)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
          .width('100%')
      }
      Text(question.content)
        .fontSize(NxFontSize.md)
        .lineHeight(20)
        .fontColor(this.palette().text2)
        .width('100%')
      if (this.isChoice(question)) {
        ForEach(this.visibleOptions(question), (option: string, optIndex: number) => {
          Text(this.optionLabel(optIndex) + option)
            .fontSize(NxFontSize.md)
            .lineHeight(19)
            .width('100%')
            .padding(NxGrid * 2)
            .borderRadius(NxRadius.xs)
            .fontColor(this.optionInk(question, option, optIndex, index))
            .backgroundColor(this.optionFill(question, option, optIndex, index))
            .onClick(() => {
              if (this.revealed[index] || this.submitted) {
                return;
              }
              const next: string[] = [];
              for (let i = 0; i < this.picked.length; i++) {
                next.push(i === index ? option : this.picked[i]);
              }
              this.picked = next;
            })
        }, (option: string, optIndex: number) => option + '_' + optIndex)
      } else {
        TextArea({ placeholder: '用自己的话写', text: this.picked[index] })
          .width('100%')
          .height(72)
          .fontSize(NxFontSize.md)
          .enabled(!this.submitted)
          .onChange((value: string) => {
            const next: string[] = [];
            for (let i = 0; i < this.picked.length; i++) {
              next.push(i === index ? value : this.picked[i]);
            }
            this.picked = next;
          })
      }
      if (this.revealed[index]) {
        Text('答案：' + this.answerText(question))
          .fontSize(NxFontSize.md)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().success)
          .width('100%')
        if (question.hint.length > 0) {
          Text('提示：' + question.hint)
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().text3)
            .width('100%')
        }
      } else {
        Button(this.isChoice(question) ? '看答案' : '先写完，再看参考')
          .width('100%')
          .height(40)
          .fontSize(NxFontSize.md)
          .backgroundColor(this.palette().primarySoft)
          .fontColor(this.palette().primary)
          .onClick(() => {
            const flags: boolean[] = [];
            for (let i = 0; i < this.revealed.length; i++) {
              flags.push(i === index ? true : this.revealed[i]);
            }
            this.revealed = flags;
          })
      }
    }
    .width('100%')
    .padding(NxGrid * 4)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().cardBg)
  }

  build() {
    Column() {
    Scroll() {
      Column({ space: NxGrid * 3 }) {
        Row({ space: NxGrid * 2 }) {
          Text('‹ 返回')
            .fontSize(NxFontSize.lg)
            .fontColor(this.palette().text2)
            .padding({ right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
            .onClick(() => {
              router.back();
            })
          Text('今日复习')
            .fontSize(NxFontSize.h)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette().text1)
            .layoutWeight(1)
        }
        .width('100%')

        if (this.errorText.length > 0) {
          Text(this.errorText)
            .fontSize(NxFontSize.md)
            .fontColor(this.palette().danger)
            .width('100%')
        }

        Column({ space: NxGrid * 3 }) {
          Text('复习哪一章')
            .fontSize(NxFontSize.lg)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.palette().text1)
            .width('100%')
          if (this.loading && this.books.length === 0) {
            SkeletonCard()
          }
          if (this.chosen() !== null) {
            this.pickerRow(
              '教材',
              this.chosen()!.bookTitle,
              this.chosen()!.lectureTitle !== this.chosen()!.bookTitle ? this.chosen()!.lectureTitle : '',
              (): void => {
                this.openPicker('book');
              }
            )
            this.pickerRow(
              '章节',
              this.chapterLabel(),
              this.chapterHint(),
              (): void => {
                this.openPicker('chapter');
              }
            )
          }
          Row() {
            Text('题目按这一章正文现出，大约十几秒。')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
              .layoutWeight(1)
            if (this.chosen() !== null) {
              Text('去读这一章')
                .fontSize(NxFontSize.sm)
                .fontColor(this.palette().primary)
                .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
                .borderRadius(NxRadius.xs)
                .backgroundColor(this.palette().cardBg)
                .onClick(() => {
                  this.openChapterInReader();
                })
            }
          }
          .width('100%')
          Button(this.taskStatus === 'running' || this.taskStatus === 'queued' ? '出题中…' : '生成 3 道复习题')
            .width('100%')
            .height(44)
            .fontSize(NxFontSize.lg)
            .backgroundColor(this.palette().primary)
            .fontColor(this.palette().onPrimary)
            .enabled(this.chosen() !== null && this.taskStatus !== 'running' && this.taskStatus !== 'queued')
            .onClick(() => {
              this.startReview();
            })
        }
        .width('100%')
        .padding(NxGrid * 4)
        .borderRadius(NxRadius.md)
        .backgroundColor(this.palette().primarySoft)

        if (this.taskStatus.length > 0) {
          Row({ space: NxGrid * 2 }) {
            if (this.taskStatus === 'running' || this.taskStatus === 'queued') {
              LoadingProgress()
                .width(18)
                .height(18)
                .color(this.palette().primary)
            }
            Text(this.statusText())
              .fontSize(NxFontSize.md)
              .fontColor(this.taskStatus === 'failed' ? this.palette().danger : this.palette().text2)
              .layoutWeight(1)
          }
          .width('100%')
          if (this.taskError.length > 0) {
            Text(this.taskError)
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().danger)
              .width('100%')
          }
        }

        if (this.questions.length > 0) {
          ForEach(this.questions, (question: ReviewQuestion, index: number) => {
            this.questionCard(question, index)
          }, (question: ReviewQuestion, index: number) => question.source_id + '_' + index)
          if (this.submitted) {
            Column({ space: NxGrid * 2 }) {
              Text(this.scoreText.length > 0 ? this.scoreText : '这组题已经记下。')
                .fontSize(NxFontSize.lg)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.palette().success)
                .width('100%')
              Button('再出一组')
                .width('100%')
                .height(44)
                .fontSize(NxFontSize.lg)
                .backgroundColor(this.palette().primarySoft)
                .fontColor(this.palette().primary)
                .onClick(() => {
                  this.startReview();
                })
            }
            .width('100%')
            .padding(NxGrid * 4)
            .borderRadius(NxRadius.sm)
            .backgroundColor(this.palette().cardBg)
          } else {
            Button(this.submitting ? '我在判…' : '交给我判')
              .width('100%')
              .height(44)
              .fontSize(NxFontSize.lg)
              .backgroundColor(this.palette().primary)
              .fontColor(this.palette().onPrimary)
              .enabled(!this.submitting && this.quizId.length > 0)
              .onClick(() => {
                this.submitReview();
              })
          }
        }
      }
      .width('100%')
      .padding(NxGrid * 4)
    }
    .width('100%')
    .layoutWeight(1)
    .align(Alignment.TopStart)
    .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.palette().pageBg)
    .bindSheet($$this.showPickerSheet, this.pickerSheet(), {
      height: SheetSize.LARGE,
      showClose: true,
      dragBar: true,
      backgroundColor: this.palette().pageBg,
    })
  }
}
