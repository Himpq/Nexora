/**
 * 今日任务与复习：挑一章（默认是你上次读到的那一章），异步生成复习题，轮询任务状态，
 * 完成后逐题作答式渲染（先想再看答案）。
 * 之前这里要求教材 refinement_status === 'done'（精读管线跑完）才允许出题，而演示数据里没有一本满足，
 * 于是永远卡在「先完成精读」。后端 review-plan 本就只依赖章节正文，这里改为任何可读教材都能出题。
 * 云端 review-plan 对无知识图谱概念的章节可能返回 TASK_FAILED，页面会原样展示原因。
 *
 * 2026-09-21 审查修复（复习会话模型）：
 * - 题组内容（quizId）、一次练习（attemptId = 生成任务 id）、生成请求（taskId）三个身份分开；
 *   结算带 attempt_id，后端按这一轮累计，「再出一组」不再继承上一轮的完成态与成绩。
 * - 题组来源在出题时冻结（origin）：换书 / 换章后旧题仍归原章，提交只用 origin。
 * - 轮询单飞 + 版本隔离：晚到的 completed 回包不会清掉刚填的答案；离页取消。
 * - 结算时若已作答题被服务端标 duplicate，按「上次记录」提示，不假称刚写入。
 * - 简答框用键盘高度上推页面，第三题输入与结算按钮不被键盘盖住。
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
  ReviewSubmitItem,
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
import { common } from '@kit.AbilityKit';
import { router, window } from '@kit.ArkUI';

class BookChoice {
  key: string = '';
  lectureId: string = '';
  lectureTitle: string = '';
  bookId: string = '';
  bookTitle: string = '';
  /** 默认复习章节：本地上次读到 > 后端会话 > 规范当前章节 > 按时间取最近记录 > 0。 */
  chapterIndex: number = 0;
  chapterTitle: string = '';
}

/** 一道题在本轮里的状态：本地草稿 + 服务端结算结果。 */
class QuestionState {
  picked: string = '';
  revealed: boolean = false;
  settled: boolean = false;
  /** 服务端对这题的判定；未结算为 ''。 */
  verdict: string = '';
  /** 这一轮里这题此前已结算过（服务端 duplicate），本次提交没有新入账。 */
  duplicate: boolean = false;
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
  @State attemptId: string = '';
  /** 出题时冻结的来源：换书 / 换章不影响已出的题组归属。 */
  @State origin: LearnTarget | null = null;
  @State questions: ReviewQuestion[] = [];
  @State states: QuestionState[] = [];
  @State submitting: boolean = false;
  @State submitted: boolean = false;
  @State scoreText: string = '';
  @State progressText: string = '';
  @State showPickerSheet: boolean = false;
  @State pickerKind: string = '';
  @State keyboardInset: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();
  private readerApi: ReaderApi = new ReaderApi();
  private timerId: number = -1;
  private requestedLecture: string = '';
  private requestedBook: string = '';
  private requestedChapter: number = -1;
  /** 轮询隔离：每次 startReview 递增；旧任务的回包一律丢弃。 */
  private reviewVersion: number = 0;
  private pollInFlight: boolean = false;
  private tocVersion: number = 0;
  private hostWindow: window.Window | undefined = undefined;
  private scroller: Scroller = new Scroller();
  private disposed: boolean = false;

  aboutToAppear(): void {
    this.disposed = false;
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
      if (params.chapter_index !== undefined) {
        // 从报告 / 图谱「练这一章」进来：直接定到那一章。
        this.requestedChapter = Number(params.chapter_index);
      }
    }
    this.listenKeyboard();
    this.loadTarget();
    // 系统入口（小艺 / A2A）后台已排好题：续接那次生成任务，不让用户重新点「生成」。
    const pending: string | undefined = AppStorage.get<string>('nxPendingReviewTask');
    if (pending !== undefined && pending.length > 0) {
      AppStorage.setOrCreate('nxPendingReviewTask', '');
      this.resumeTask(pending);
    }
  }

  /** 续接后台创建的生成任务：来源以任务结果为准。 */
  private resumeTask(taskId: string): void {
    const version = ++this.reviewVersion;
    this.resetSession();
    this.taskStatus = 'running';
    this.origin = null;
    this.beginPolling(taskId, version);
  }

  aboutToDisappear(): void {
    this.disposed = true;
    this.reviewVersion++;
    this.tocVersion++;
    this.stopPolling();
    if (this.hostWindow !== undefined) {
      try {
        this.hostWindow.off('keyboardHeightChange');
      } catch (err) {
        // 窗口已销毁
      }
    }
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  // ---------- 键盘 ----------

  private listenKeyboard(): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined) {
      return;
    }
    window.getLastWindow(host as common.UIAbilityContext).then((win: window.Window) => {
      this.hostWindow = win;
      win.on('keyboardHeightChange', (height: number): void => {
        const vp: number = this.getUIContext().px2vp(height > 0 ? height : 0);
        if (Math.abs(vp - this.keyboardInset) >= 1) {
          this.keyboardInset = vp;
          if (vp > 0) {
            this.revealFocused();
          }
        }
      });
    }).catch((err: Error) => {
    });
  }

  /** 键盘弹起后把简答框滚进可视区（底部已按键盘高度留白，滚到底即可露出输入框与结算按钮）。 */
  private revealFocused(): void {
    setTimeout((): void => {
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (err) {
        // 尚未挂载
      }
    }, 120);
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

  private bookTitleOf(bookId: string): string {
    for (const book of this.books) {
      if (book.bookId === bookId) {
        return book.bookTitle;
      }
    }
    return '';
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
          } else if (ctx.active_session.lecture_id === lecture.id && ctx.active_session.book_id === book.id &&
            ctx.active_session.chapter_index >= 0) {
            choice.chapterIndex = ctx.active_session.chapter_index;
            choice.chapterTitle = ctx.active_session.chapter_name;
          } else if (lecture.current_book_id === book.id && lecture.current_chapter_index !== undefined &&
            lecture.current_chapter_index !== null && lecture.current_chapter_index >= 0) {
            choice.chapterIndex = lecture.current_chapter_index;
            choice.chapterTitle = lecture.current_chapter;
          } else {
            let latestTimestamp = -1;
            for (const record of ctx.recent_learning_records) {
              if (record.lecture_id === lecture.id && record.book_id === book.id &&
                record.chapter_index >= 0 && record.timestamp > latestTimestamp) {
                choice.chapterIndex = record.chapter_index;
                choice.chapterTitle = record.chapter_name;
                latestTimestamp = record.timestamp;
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
      if (this.requestedChapter >= 0) {
        initial.chapterIndex = this.requestedChapter;
        initial.chapterTitle = '';
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
    const version = ++this.tocVersion;
    try {
      const index = await this.readerApi.getIndex(choice.lectureId, choice.bookId);
      if (version !== this.tocVersion) {
        return;
      }
      if (index.success === true) {
        this.chapters = index.chapters;
        if (this.chapterIndex >= this.chapters.length) {
          this.chapterIndex = 0;
        }
      }
    } catch (err) {
      // 目录取不到就只按默认章节出题
    } finally {
      if (version === this.tocVersion) {
        this.tocLoading = false;
      }
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

  /** 当前选择与已出题组的来源是否不同（用于提示「这组题还是原来那一章的」）。 */
  private originDiffers(): boolean {
    const choice = this.chosen();
    if (this.origin === null || choice === null) {
      return false;
    }
    return this.origin.lecture_id !== choice.lectureId || this.origin.book_id !== choice.bookId ||
      this.origin.chapter_index !== this.chapterIndex;
  }

  private originLabel(): string {
    if (this.origin === null) {
      return '';
    }
    return this.origin.book_title.length > 0 ? this.origin.book_title + ' · ' + this.origin.chapter_name : this.origin.chapter_name;
  }

  private resetSession(): void {
    this.questions = [];
    this.states = [];
    this.quizId = '';
    this.attemptId = '';
    this.origin = null;
    this.submitted = false;
    this.scoreText = '';
    this.progressText = '';
    this.taskError = '';
  }

  async startReview(): Promise<void> {
    const choice = this.chosen();
    if (choice === null) {
      this.errorText = '先选一本教材。';
      return;
    }
    if (this.taskStatus === 'running' || this.taskStatus === 'queued') {
      return;
    }
    const version = ++this.reviewVersion;
    this.stopPolling();
    this.loading = true;
    this.errorText = '';
    this.resetSession();
    const target: LearnTarget = {
      lecture_id: choice.lectureId,
      lecture_title: choice.lectureTitle,
      book_id: choice.bookId,
      book_title: choice.bookTitle,
      chapter_index: this.chapterIndex,
      chapter_name: this.chapterLabel(),
      chapter_range: '',
    };
    this.taskStatus = 'queued';
    try {
      const env: AgentEnvelope = await this.api.postReviewPlan(target, 3);
      if (version !== this.reviewVersion) {
        return;
      }
      const data: ReviewPlanData = env.data as ReviewPlanData;
      this.taskStatus = data.task.status;
      this.origin = target;
      this.beginPolling(data.task.task_id, version);
    } catch (err) {
      if (version !== this.reviewVersion) {
        return;
      }
      const e = err as BusinessError;
      this.taskStatus = '';
      this.errorText = e.message.length > 0 ? e.message : '创建复习任务失败';
    } finally {
      if (version === this.reviewVersion) {
        this.loading = false;
      }
    }
  }

  beginPolling(taskId: string, version: number): void {
    this.stopPolling();
    this.pollTask(taskId, version);
    this.timerId = setInterval(() => {
      this.pollTask(taskId, version);
    }, 4000);
  }

  async pollTask(taskId: string, version: number): Promise<void> {
    if (this.pollInFlight || version !== this.reviewVersion || this.disposed) {
      return;
    }
    this.pollInFlight = true;
    try {
      const env: AgentEnvelope = await this.api.getTask(taskId);
      if (version !== this.reviewVersion || this.disposed) {
        return;
      }
      const data: TaskData = env.data as TaskData;
      this.taskStatus = data.task.status;
      if (data.task.status === 'completed') {
        this.stopPolling();
        // 题组已装载过就不再重置（同一任务的重复 completed 回包不能清答案）。
        if (data.task.result && this.questions.length === 0) {
          this.quizId = data.task.result.quiz_id;
          this.attemptId = data.task.result.attempt_id !== undefined && data.task.result.attempt_id.length > 0
            ? data.task.result.attempt_id : taskId;
          this.questions = data.task.result.questions;
          const next: QuestionState[] = [];
          for (const question of this.questions) {
            next.push(new QuestionState());
          }
          this.states = next;
          if (data.task.result.chapter_name.length > 0 || this.origin === null) {
            // 以任务实际解析到的来源为准（端侧标签可能是「第 N 章」占位；后台续接的任务没有本地 origin）。
            const prior: LearnTarget | null = this.origin;
            const origin: LearnTarget = {
              lecture_id: data.task.result.lecture_id.length > 0 ? data.task.result.lecture_id : (prior !== null ? prior.lecture_id : ''),
              lecture_title: prior !== null ? prior.lecture_title : '',
              book_id: data.task.result.book_id.length > 0 ? data.task.result.book_id : (prior !== null ? prior.book_id : ''),
              book_title: prior !== null ? prior.book_title : this.bookTitleOf(data.task.result.book_id),
              chapter_index: data.task.result.chapter_index,
              chapter_name: data.task.result.chapter_name.length > 0 ? data.task.result.chapter_name : (prior !== null ? prior.chapter_name : ''),
              chapter_range: '',
            };
            this.origin = origin;
          }
        }
      } else if (data.task.status === 'failed') {
        this.stopPolling();
        this.taskError = this.readableTaskError(data.task.error ? data.task.error.message : '');
      }
    } catch (err) {
      if (version !== this.reviewVersion || this.disposed) {
        return;
      }
      const e = err as BusinessError;
      this.errorText = '轮询失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.pollInFlight = false;
    }
  }

  /** 后端 TASK_FAILED 的原文可能是英文异常或超时栈；给用户一句能理解、能下一步的话。 */
  private readableTaskError(raw: string): string {
    const text = raw.trim();
    if (text.length === 0) {
      return '这次没出成，也没拿到原因。可以再试一次，或换一章。';
    }
    if (/timed? ?out|timeout|超时/i.test(text)) {
      return '出题等太久超时了。稍后再点一次，或换一章试试。';
    }
    if (/结构校验|不合格|概念/.test(text)) {
      return text;
    }
    return '这次没出成：' + text + '。可以再试一次，或换一章。';
  }

  private statusText(): string {
    if (this.taskStatus === 'queued') {
      return '排队中，我马上开始出题…';
    }
    if (this.taskStatus === 'running') {
      return '我在读这一章出题，通常十几秒，最长可能一两分钟。';
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

  private stateAt(index: number): QuestionState {
    return index >= 0 && index < this.states.length ? this.states[index] : new QuestionState();
  }

  private updateState(index: number, mutate: (state: QuestionState) => void): void {
    const next: QuestionState[] = [];
    for (let i = 0; i < this.states.length; i++) {
      const copy = new QuestionState();
      copy.picked = this.states[i].picked;
      copy.revealed = this.states[i].revealed;
      copy.settled = this.states[i].settled;
      copy.verdict = this.states[i].verdict;
      copy.duplicate = this.states[i].duplicate;
      if (i === index) {
        mutate(copy);
      }
      next.push(copy);
    }
    this.states = next;
  }

  private settledCount(): number {
    let count = 0;
    for (const state of this.states) {
      if (state.settled) {
        count++;
      }
    }
    return count;
  }

  private applySubmitResult(data: ReviewSubmitData, indexes: number[]): void {
    const byId: Map<string, ReviewSubmitItem> = new Map<string, ReviewSubmitItem>();
    for (const item of data.items) {
      byId.set(item.question_id, item);
    }
    const next: QuestionState[] = [];
    for (let i = 0; i < this.questions.length; i++) {
      const copy = new QuestionState();
      const prev = this.stateAt(i);
      copy.picked = prev.picked;
      copy.revealed = prev.revealed;
      copy.settled = prev.settled;
      copy.verdict = prev.verdict;
      copy.duplicate = prev.duplicate;
      if (indexes.indexOf(i) >= 0) {
        copy.settled = true;
        copy.revealed = true;
        const item = byId.get(this.questionId(this.questions[i], i));
        if (item !== undefined) {
          copy.verdict = item.is_correct ? 'correct' : 'wrong';
          copy.duplicate = item.duplicate === true;
        }
      }
      next.push(copy);
    }
    this.states = next;
    const quizCorrect = data.quiz_correct !== undefined ? data.quiz_correct : data.correct;
    const quizTotal = data.quiz_total !== undefined ? data.quiz_total : this.questions.length;
    const quizSettled = data.quiz_settled !== undefined ? data.quiz_settled : this.settledCount();
    this.progressText = '已结算 ' + quizSettled + '/' + quizTotal + ' · 目前对 ' + quizCorrect + ' 题';
    // 完成态只信这一轮：服务端 completed 与本地全部结算都成立才算做完。
    const localDone = this.settledCount() >= this.questions.length && this.questions.length > 0;
    if ((data.completed === true && quizSettled >= this.questions.length) || localDone) {
      this.scoreText = '这组题你对了 ' + quizCorrect + '/' + quizTotal + '。' +
        (data.evidence_written !== undefined && data.evidence_written > 0 ? '掌握度已按这几题更新。' : '');
      this.submitted = true;
      AppStorage.setOrCreate('nxStudyTick', Date.now());
    }
  }

  /** 提交只用出题时冻结的来源，不看当前选择器。 */
  private submitTarget(): LearnTarget | null {
    if (this.origin !== null) {
      return this.origin;
    }
    const choice = this.chosen();
    if (choice === null) {
      return null;
    }
    const target: LearnTarget = {
      lecture_id: choice.lectureId,
      lecture_title: choice.lectureTitle,
      book_id: choice.bookId,
      book_title: choice.bookTitle,
      chapter_index: this.chapterIndex,
      chapter_name: this.chapterLabel(),
      chapter_range: '',
    };
    return target;
  }

  /**
   * 逐题结算：翻牌那一刻就把这道题交给后端判（有作答按对错；没作答直接看答案按错误、低权重）。
   * 之前是纯端侧翻牌 + 三题一起「交给我判」，翻了牌不点交卷后端就零记录，掌握度永远 unknown。
   */
  async settleQuestion(index: number): Promise<void> {
    const target = this.submitTarget();
    if (target === null || index < 0 || index >= this.questions.length || this.stateAt(index).settled ||
      this.submitting || this.submitted || this.quizId.length === 0) {
      return;
    }
    const answer = this.stateAt(index).picked.trim();
    const draft: ReviewAnswerDraft = {
      question_id: this.questionId(this.questions[index], index),
      answer: answer,
      revealed_without_answer: answer.length === 0,
    };
    const version = this.reviewVersion;
    this.submitting = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.postReviewSubmit(this.quizId, target, [draft], this.attemptId);
      if (version !== this.reviewVersion) {
        return;
      }
      this.applySubmitResult(env.data as ReviewSubmitData, [index]);
    } catch (err) {
      if (version !== this.reviewVersion) {
        return;
      }
      const e = err as BusinessError;
      this.errorText = '第 ' + (index + 1) + ' 题没结算上：' + (e.message.length > 0 ? e.message : '网络错误') + '。你的作答还在，再点一次即可。';
    } finally {
      if (version === this.reviewVersion) {
        this.submitting = false;
      }
    }
  }

  /** 全部结算：把还没翻牌的题一次交上去（没作答的按「直接看答案」算）。 */
  async submitReview(): Promise<void> {
    const target = this.submitTarget();
    if (target === null || this.submitting || this.submitted || this.questions.length === 0 || this.quizId.length === 0) {
      return;
    }
    const payload: ReviewAnswerDraft[] = [];
    const indexes: number[] = [];
    for (let index = 0; index < this.questions.length; index++) {
      if (this.stateAt(index).settled) {
        continue;
      }
      const answer = this.stateAt(index).picked.trim();
      const draft: ReviewAnswerDraft = {
        question_id: this.questionId(this.questions[index], index),
        answer: answer,
        revealed_without_answer: answer.length === 0,
      };
      payload.push(draft);
      indexes.push(index);
    }
    if (payload.length === 0) {
      return;
    }
    const version = this.reviewVersion;
    this.submitting = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.postReviewSubmit(this.quizId, target, payload, this.attemptId);
      if (version !== this.reviewVersion) {
        return;
      }
      this.applySubmitResult(env.data as ReviewSubmitData, indexes);
    } catch (err) {
      if (version !== this.reviewVersion) {
        return;
      }
      const e = err as BusinessError;
      this.errorText = (e.message.length > 0 ? e.message : '这组题我没判上') + '。你的作答还在，再点一次即可。';
    } finally {
      if (version === this.reviewVersion) {
        this.submitting = false;
      }
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

  /** 结算后的那句话：按服务端结果说，不按本地草稿猜。 */
  private settledLabel(index: number): string {
    const state = this.stateAt(index);
    if (state.duplicate) {
      return '这题这一轮之前已经记过了，按上次的结果算。';
    }
    if (state.picked.trim().length === 0) {
      return '没作答就看答案，我按没会记下。';
    }
    if (state.verdict === 'correct') {
      return '答对了，已记下。';
    }
    if (state.verdict === 'wrong') {
      return '这题记为没答对；对照参考再看一眼。';
    }
    return '这题已按你的作答记下。';
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
    const state = this.stateAt(index);
    if (state.revealed && this.isCorrect(question, option, optIndex)) {
      return this.palette().success;
    }
    if (state.revealed && state.picked === option) {
      return this.palette().danger;
    }
    if (state.picked === option) {
      return this.palette().primary;
    }
    return this.palette().text2;
  }

  private optionFill(question: ReviewQuestion, option: string, optIndex: number, index: number): string {
    const state = this.stateAt(index);
    if (state.revealed && this.isCorrect(question, option, optIndex)) {
      return this.palette().primarySoft;
    }
    if (state.picked === option) {
      return this.palette().primarySoft;
    }
    return this.palette().surface2;
  }

  /** 章节 / 教材选择行。作为普通组件内联在 build 里读取 @State，标题随选择即时刷新（原 Builder 按值传参不刷新）。 */
  @Builder
  pickerRow(caption: string, kind: string) {
    Column({ space: NxGrid }) {
      Text(caption)
        .fontSize(NxFontSize.xs)
        .fontColor(this.palette().text3)
        .width('100%')
      Row() {
        Column({ space: 2 }) {
          Text(kind === 'book' ? (this.chosen() !== null ? this.chosen()!.bookTitle : '') : this.chapterLabel())
            .fontSize(NxFontSize.lg)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.palette().text1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          if (kind === 'book') {
            if (this.chosen() !== null && this.chosen()!.lectureTitle !== this.chosen()!.bookTitle) {
              Text(this.chosen()!.lectureTitle)
                .fontSize(NxFontSize.xs)
                .fontColor(this.palette().text3)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
            }
          } else {
            Text(this.chapterHint())
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
        this.openPicker(kind);
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
              // 只有这一题已结算才锁；别的题的完成态不影响这题作答。
              if (this.stateAt(index).settled || this.submitted) {
                return;
              }
              this.updateState(index, (state: QuestionState): void => {
                state.picked = option;
              });
            })
        }, (option: string, optIndex: number) => option + '_' + optIndex)
      } else {
        TextArea({ placeholder: '用自己的话写', text: this.stateAt(index).picked })
          .width('100%')
          .height(72)
          .fontSize(NxFontSize.md)
          .enabled(!this.stateAt(index).settled && !this.submitted)
          .onFocus(() => {
            // 模拟器实测（2026-09-22）：全局 RESIZE 只压缩了滚动区，简答框仍留在键盘下面；
            // 键盘弹起后把页面滚到底，让输入框和结算按钮露出来。
            this.revealFocused();
          })
          .onChange((value: string) => {
            this.updateState(index, (state: QuestionState): void => {
              state.picked = value;
            });
          })
      }
      if (this.stateAt(index).revealed) {
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
        if (this.stateAt(index).settled) {
          Text(this.settledLabel(index))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
      } else {
        Button(this.submitting ? '记录中…' : (this.isChoice(question) ? '看答案（同时结算这题）' : '先写完，再看参考'))
          .width('100%')
          .height(40)
          .fontSize(NxFontSize.md)
          .backgroundColor(this.palette().primarySoft)
          .fontColor(this.palette().primary)
          .enabled(!this.submitting && !this.submitted)
          .onClick(() => {
            this.settleQuestion(index);
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
    Scroll(this.scroller) {
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
            this.pickerRow('教材', 'book')
            this.pickerRow('章节', 'chapter')
          }
          Row() {
            Text('题目按这一章正文现出，通常十几秒。')
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
            .backgroundColor(this.palette().buttonFill)
            .fontColor(this.palette().onButton)
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
          if (this.taskStatus === 'failed') {
            Button('再试一次')
              .width('100%')
              .height(40)
              .fontSize(NxFontSize.md)
              .backgroundColor(this.palette().primarySoft)
              .fontColor(this.palette().primary)
              .onClick(() => {
                this.startReview();
              })
          }
        }

        if (this.questions.length > 0) {
          if (this.originDiffers()) {
            Text('这组题是按「' + this.originLabel() + '」出的，成绩也会记到那一章；要换章就点「再出一组」。')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().warning)
              .lineHeight(18)
              .width('100%')
          }
          ForEach(this.questions, (question: ReviewQuestion, index: number) => {
            this.questionCard(question, index)
          }, (question: ReviewQuestion, index: number) => this.attemptId + '_' + question.source_id + '_' + index)
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
            Column({ space: NxGrid * 2 }) {
              Text(this.progressText.length > 0 ? this.progressText : '每翻开一题的答案，我就把那题记下；三题齐了自动出分。')
                .fontSize(NxFontSize.sm)
                .fontColor(this.palette().text3)
                .width('100%')
              Button(this.submitting ? '我在判…' : '剩下的一起结算')
                .width('100%')
                .height(44)
                .fontSize(NxFontSize.lg)
                .backgroundColor(this.palette().buttonFill)
                .fontColor(this.palette().onButton)
                .enabled(!this.submitting && this.quizId.length > 0)
                .onClick(() => {
                  this.submitReview();
                })
            }
            .width('100%')
          }
        }
      }
      .width('100%')
      .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 4, bottom: NxGrid * 4 + this.keyboardInset })
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
