/**
 * 今日任务与复习：对最近学习且已完成精读的章节异步生成复习题，轮询任务状态，
 * 完成后结构化渲染选择题/简答题（含答案与提示）。
 * 云端 review-plan 对无知识图谱概念的章节会返回 TASK_FAILED，页面会原样展示原因。
 */
import {
  AgentApi,
  AgentEnvelope,
  ContextData,
  ContextBook,
  ContextLecture,
  RecentRecord,
  LearnTarget,
  ReviewPlanData,
  TaskData,
  ReviewQuestion,
} from '../services/AgentApi';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct TodayTask {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State chapterText: string = '正在定位学习章节…';
  @State taskStatus: string = '';
  @State taskError: string = '';
  @State quizId: string = '';
  @State questions: ReviewQuestion[] = [];
  private api: AgentApi = new AgentApi();
  private target: LearnTarget | null = null;
  private timerId: number = -1;

  aboutToAppear(): void {
    this.loadTarget();
  }

  aboutToDisappear(): void {
    this.stopPolling();
  }

  stopPolling(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  async loadTarget(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getContext();
      const ctxData: ContextData = env.data as ContextData;
      let chosenLecture: ContextLecture | null = null;
      let chosenBook: ContextBook | null = null;
      for (const lecture of ctxData.lectures) {
        for (const book of lecture.books) {
          if (book.refinement_status === 'done') {
            chosenLecture = lecture;
            chosenBook = book;
            break;
          }
        }
        if (chosenLecture !== null) {
          break;
        }
      }
      if (chosenLecture !== null && chosenBook !== null) {
        let chapterIndex: number = 0;
        if (ctxData.active_session.book_id === chosenBook.id) {
          chapterIndex = ctxData.active_session.chapter_index;
        } else {
          for (const record of ctxData.recent_learning_records) {
            if (record.book_id === chosenBook.id) {
              chapterIndex = record.chapter_index;
              break;
            }
          }
        }
        const target: LearnTarget = {
          lecture_id: chosenLecture.id,
          lecture_title: chosenLecture.title,
          book_id: chosenBook.id,
          book_title: chosenBook.title,
          chapter_index: chapterIndex,
          chapter_name: '',
          chapter_range: '',
        };
        this.target = target;
        this.chapterText = chosenBook.title + ' · 第' + (chapterIndex + 1) + '章';
      } else {
        this.chapterText = '未找到已完成精读的教材';
      }
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '加载学习上下文失败';
    } finally {
      this.loading = false;
    }
  }

  async startReview(): Promise<void> {
    if (this.target === null) {
      this.errorText = '暂无可用学习章节，请先完成教材精读。';
      return;
    }
    this.loading = true;
    this.errorText = '';
    this.taskError = '';
    this.questions = [];
    this.quizId = '';
    try {
      const env: AgentEnvelope = await this.api.postReviewPlan(this.target, 3);
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
    this.timerId = setInterval(() => {
      this.pollTask(taskId);
    }, 5000);
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
        }
      } else if (data.task.status === 'failed') {
        this.stopPolling();
        if (data.task.error) {
          this.taskError = data.task.error.message;
        } else {
          this.taskError = '任务失败，未返回原因';
        }
      }
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '轮询失败：' + (e.message.length > 0 ? e.message : '网络错误');
    }
  }

  optionLabel(index: number): string {
    return String.fromCharCode(65 + index) + '. ';
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Row() {
          Button('返回')
            .height(32)
            .fontSize(12)
            .onClick(() => {
              router.back();
            })
          Blank()
          Text('今日任务与复习')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
          Blank()
          Text('  ')
            .width(48)
        }
        .width('100%')

        if (this.loading) {
          LoadingProgress()
            .width(40)
            .height(40)
            .margin({ top: 24 })
        }

        if (this.errorText.length > 0) {
          Text(this.errorText)
            .fontSize(13)
            .fontColor('#E64545')
            .width('100%')
        }

        Column({ space: 8 }) {
          Text('复习章节')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text(this.chapterText)
            .fontSize(15)
            .width('100%')
          Text('复习题由服务端异步生成：选择最近学习且已完成精读的章节，保证章节存在知识图谱概念。')
            .fontSize(12)
            .fontColor('#8A8A8A')
            .width('100%')
          Button('生成 3 道复习题')
            .width('100%')
            .height(40)
            .fontSize(14)
            .onClick(() => {
              this.startReview();
            })
        }
        .width('100%')
        .padding(16)
        .borderRadius(14)
        .backgroundColor('#F1F5FF')

        if (this.taskStatus.length > 0) {
          Text('任务状态：' + this.taskStatus)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.taskStatus === 'failed' ? '#E64545' : '#1A1A1A')
            .width('100%')
          if (this.taskError.length > 0) {
            Text(this.taskError)
              .fontSize(13)
              .fontColor('#E64545')
              .width('100%')
          }
        }

        if (this.questions.length > 0) {
          ForEach(this.questions, (question: ReviewQuestion, index: number) => {
            Column({ space: 6 }) {
              Row() {
                Text('第 ' + (index + 1) + ' 题')
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                Blank()
                Text(question.type === 'choice' ? '选择题' : '简答题')
                  .fontSize(11)
                  .fontColor('#4A7DFF')
                Text(question.difficulty)
                  .fontSize(11)
                  .fontColor('#B26A00')
                  .margin({ left: 6 })
              }
              .width('100%')
              Text(question.title)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .width('100%')
              Text(question.content)
                .fontSize(13)
                .lineHeight(20)
                .width('100%')
              if (question.options.length > 0) {
                ForEach(question.options, (option: string, optIndex: number) => {
                  Text(this.optionLabel(optIndex) + option)
                    .fontSize(13)
                    .lineHeight(19)
                    .fontColor(option === question.answer ? '#1A7F37' : '#333333')
                    .width('100%')
                }, (option: string, optIndex: number) => option + '_' + optIndex)
              }
              Text('答案：' + question.answer)
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor('#1A7F37')
                .width('100%')
              if (question.hint.length > 0) {
                Text('提示：' + question.hint)
                  .fontSize(12)
                  .fontColor('#8A8A8A')
                  .width('100%')
              }
            }
            .width('100%')
            .padding(14)
            .borderRadius(12)
            .backgroundColor('#F5F5F5')
          }, (question: ReviewQuestion, index: number) => question.source_id + '_' + index)
        }
      }
      .width('100%')
      .padding(16)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#FFFFFF')
    .align(Alignment.TopStart)
  }
}
