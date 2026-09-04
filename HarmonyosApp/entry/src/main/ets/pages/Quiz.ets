/**
 * N5 闭环答题页（§6.5 简化沉浸面）：flow 的复习题作答 → 判分 → 验收摘要。
 * 数据：GET /flow/state（题目）→ POST /flow/submit（判分 → wrapup 卡已由后端写入时间线）。
 */
import { router } from '@kit.ArkUI';
import { FlowStateData, FlowQuestion, FlowSubmitData } from '../models/Index';
import { AgentApi, AgentEnvelope } from '../services/AgentApi';
import { SkeletonCard, ErrorState } from '../components/common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize } from '../theme/DesignTokens';
import { BusinessError } from '@kit.BasicServicesKit';

interface AnswerDraft {
  question_id: string;
  answer: string;
}

@Entry
@Component
struct Quiz {
  @State loading: boolean = true;
  @State errorText: string = '';
  @State questions: FlowQuestion[] = [];
  @State answers: string[] = [];
  @State submitted: boolean = false;
  @State wrapup: object | null = null;
  @State submitting: boolean = false;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();
  private flowId: string = '';

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, Object>;
    if (params !== undefined && params !== null) {
      this.flowId = params.flow_id as string;
    }
    this.load();
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getFlowState(this.flowId);
      const data: FlowStateData = env.data as FlowStateData;
      this.questions = data.quiz.questions;
      const drafts: string[] = [];
      for (const question of this.questions) {
        drafts.push('');
      }
      this.answers = drafts;
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '加载题目失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.loading = false;
    }
  }

  questionKey(index: number): string {
    const question = this.questions[index];
    return String(question.source_id !== undefined && question.source_id.length > 0 ? question.source_id : 'q' + index);
  }

  private isDummyOption(option: string): boolean {
    const text = option.trim().toLowerCase();
    return text.length === 0 || text === '无' || text === '暂无' || text === 'none' || text === 'n/a' || text === '-' ||
      text === '—' || text === '选项' || text === '略';
  }

  private visibleOptions(question: FlowQuestion): string[] {
    const rows: string[] = [];
    for (const option of question.options) {
      if (!this.isDummyOption(option)) {
        rows.push(option);
      }
    }
    return rows;
  }

  private isChoice(question: FlowQuestion): boolean {
    if (question.type === 'text' || question.type === 'short_answer' || question.type === '简答题') {
      return false;
    }
    return this.visibleOptions(question).length >= 2;
  }

  async submit(): Promise<void> {
    if (this.submitting || this.submitted) {
      return;
    }
    this.submitting = true;
    this.errorText = '';
    const payload: AnswerDraft[] = [];
    for (let index = 0; index < this.questions.length; index++) {
      payload.push({ question_id: this.questionKey(index), answer: this.answers[index].trim() });
    }
    try {
      const env: AgentEnvelope = await this.api.postFlowSubmit(this.flowId, payload);
      const data: FlowSubmitData = env.data as FlowSubmitData;
      this.wrapup = data.wrapup;
      this.submitted = true;
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '提交失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.submitting = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: NxGrid * 3 }) {
        Row() {
          Button('返回')
            .height(32)
            .fontSize(NxFontSize.sm)
            .backgroundColor(this.palette().surface3)
            .fontColor(this.palette().text2)
            .onClick(() => {
              router.back();
            })
          Blank()
          Text('课后小测')
            .fontSize(NxFontSize.h)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette().text1)
          Blank()
          Column()
            .width(48)
        }
        .width('100%')

        if (this.loading) {
          SkeletonCard()
          SkeletonCard()
        }

        if (this.errorText.length > 0) {
          ErrorState({ message: this.errorText, onRetry: (): void => {
            this.load();
          } })
        }

        if (this.submitted) {
          Column({ space: NxGrid * 2 }) {
            Text('做完了')
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().text1)
              .width('100%')
            Text('验收卡已写进时间线，回去看一眼吧。')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
              .width('100%')
            Button('回到时间线')
              .width('100%')
              .height(40)
              .fontSize(NxFontSize.lg)
              .backgroundColor(this.palette().primary)
              .fontColor(this.palette().onPrimary)
              .onClick(() => {
                router.back();
              })
          }
          .width('100%')
          .padding(NxGrid * 4)
          .borderRadius(NxRadius.md)
          .backgroundColor(this.palette().cardBg)
        } else {
          ForEach(this.questions, (question: FlowQuestion, index: number) => {
            Column({ space: NxGrid * 2 }) {
              Text('第 ' + (index + 1) + ' 题')
                .fontSize(NxFontSize.xs)
                .fontColor(this.palette().primary)
                .width('100%')
              Text(question.content.length > 0 ? question.content : question.title)
                .fontSize(NxFontSize.lg)
                .fontColor(this.palette().text1)
                .lineHeight(22)
                .width('100%')
              if (this.isChoice(question)) {
                ForEach(this.visibleOptions(question), (option: string, optIndex: number) => {
                  Row({ space: NxGrid }) {
                    Text(String.fromCharCode(65 + optIndex) + '. ' + option)
                      .fontSize(NxFontSize.md)
                      .fontColor(this.palette().text2)
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .padding(NxGrid * 2)
                  .borderRadius(NxRadius.xs)
                  .backgroundColor(this.answers[index] === option ? this.palette().primarySoft : this.palette().surface2)
                  .onClick(() => {
                    const next: string[] = [];
                    for (let i = 0; i < this.answers.length; i++) {
                      next.push(i === index ? option : this.answers[i]);
                    }
                    this.answers = next;
                  })
                }, (option: string, optIndex: number) => option + '_' + optIndex)
              } else {
                TextArea({ placeholder: '用自己的话写', text: this.answers[index] })
                  .width('100%')
                  .height(72)
                  .fontSize(NxFontSize.md)
                  .onChange((value: string) => {
                    const next: string[] = [];
                    for (let i = 0; i < this.answers.length; i++) {
                      next.push(i === index ? value : this.answers[i]);
                    }
                    this.answers = next;
                  })
              }
            }
            .width('100%')
            .padding(NxGrid * 3)
            .borderRadius(NxRadius.sm)
            .backgroundColor(this.palette().cardBg)
          }, (question: FlowQuestion, index: number) => this.questionKey(index))

          Button(this.submitting ? '我在判…' : '交卷')
            .width('100%')
            .height(42)
            .fontSize(NxFontSize.lg)
            .backgroundColor(this.palette().primary)
            .fontColor(this.palette().onPrimary)
            .enabled(!this.submitting && this.questions.length > 0)
            .onClick(() => {
              this.submit();
            })
        }
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
