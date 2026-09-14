/**
 * 时间线条目渲染器（§6.1）：@Reusable + LazyForEach。
 * unattended 条目：左侧 3vp 强调条 + 时间戳 + reason；reason 可展开依据链（evidence）。
 * 主动推送卡（proactive）：好 / 晚点 / 不用了 → /decision/respond 回喂决策器。
 * plan 卡：开始学习 → /open-session。其余卡片类型走通用摘要渲染（#5/#9 等任务逐步专化）。
 */
import { TimelineEntry, ProactiveCard, PlanCard, PrepCard, PrepStep, PrereqCard, ConfusionCard,
  ConfusionBreakdown, WrapupCard, QuizCard, MasteryShift, UncertainItem, MessageCard, EvidenceRef,
  JudgmentSummary, ContextSnapshot } from '../../models/Index';
import { AgentApi, AgentEnvelope } from '../../services/AgentApi';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxFontFamily, NxShadow } from '../../theme/DesignTokens';
import { sharedTts } from '../../capability/tts';
import { MarkdownView } from '../common/MarkdownView';
import { ThinkingLine } from '../common/ThinkingLine';

export function formatEntryTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hh = (date.getHours() < 10 ? '0' : '') + date.getHours();
  const mm = (date.getMinutes() < 10 ? '0' : '') + date.getMinutes();
  if (sameDay) {
    return hh + ':' + mm;
  }
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hh + ':' + mm;
}

function cardSummary(card: MessageCard | null | undefined): string {
  if (card === null || card === undefined) {
    return '';
  }
  if (card.type === 'prep') {
    return (card as PrepCard).chapter;
  }
  if (card.type === 'prereq') {
    return (card as PrereqCard).concept;
  }
  if (card.type === 'confusion') {
    return (card as ConfusionCard).concept;
  }
  if (card.type === 'wrapup') {
    return (card as WrapupCard).chapter;
  }
  if (card.type === 'mail') {
    return card.subject;
  }
  if (card.type === 'search') {
    return card.query;
  }
  if (card.type === 'kbfile') {
    return card.fileName;
  }
  if (card.type === 'video') {
    return card.title;
  }
  if (card.type === 'citation') {
    return card.excerpt;
  }
  if (card.type === 'progress') {
    return card.label;
  }
  if (card.type === 'chart') {
    return card.kind;
  }
  return '';
}

@Reusable
@Component
export struct TimelineEntryView {
  @State entry: TimelineEntry = {
    id: '',
    kind: 'system',
    ts: 0,
    text: '',
    unattended: false,
  };
  @State evidenceOpen: boolean = false;
  @State responding: boolean = false;
  @State expanded: boolean = false;
  @State contextOpen: boolean = false;
  @State stepsOpen: boolean = false;
  onResponded: () => void = () => {
  };
  onOpenSession: () => void = () => {
  };
  onOpenPlan: () => void = () => {
  };
  onOpenPrereq: (lectureId: string, bookId: string, chapterIndex: number, chapterName: string) => void =
    (lectureId: string, bookId: string, chapterIndex: number, chapterName: string) => {
    };
  onAcceptFlow: (flowId: string) => void = (flowId: string) => {
  };
  onOpenQuiz: (flowId: string) => void = (flowId: string) => {
  };
  onCitationAnchor: (anchor: string) => void = (anchor: string) => {
  };
  /** 长按任一条 → 抽屉：它当时看到了什么 + 它眼里的你。 */
  onInspect: (entry: TimelineEntry) => void = (entry: TimelineEntry) => {
  };
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();

  aboutToReuse(params: Record<string, Object>): void {
    this.entry = params.entry as TimelineEntry;
    this.evidenceOpen = false;
    this.responding = false;
    this.expanded = false;
    this.contextOpen = false;
    this.stepsOpen = false;
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  private durationLabel(durationMs: number): string {
    const minutes = Math.max(1, Math.round(durationMs / 60000));
    return '约 ' + minutes + ' 分钟';
  }

  private decisionId(): string {
    const actions = this.entry.actions;
    if (actions !== undefined && actions.length > 0) {
      for (const chip of actions) {
        if (chip.action === 'decision_accept' && chip.payload !== undefined) {
          return chip.payload.decision_id;
        }
      }
    }
    return this.entry.id;
  }

  async respond(response: string): Promise<void> {
    if (this.responding || this.entry.status !== undefined && this.entry.status !== 'pending') {
      return;
    }
    this.responding = true;
    try {
      const env: AgentEnvelope = await this.api.postDecisionRespond(this.decisionId(), response);
      this.entry.status = response;
      this.onResponded();
      if (response === 'accept') {
        // N5 闭环：accept 后端已建流程，端侧带 flow_id 进阅读器。
        const actions = env.next_actions;
        let flowId: string = '';
        if (actions !== undefined && actions.length > 0) {
          for (const action of actions) {
            if (action.type === 'flow') {
              flowId = action.flow_id !== undefined ? action.flow_id : '';
            }
          }
        }
        if (flowId.length > 0) {
          this.onAcceptFlow(flowId);
        } else {
          this.onOpenSession();
        }
      }
    } catch (err) {
      this.entry.status = 'error';
    } finally {
      this.responding = false;
    }
  }

  @Builder
  proactiveCard(card: ProactiveCard) {
    Column({ space: NxGrid * 3 }) {
      // 标题 + 时长芯片：渐变底上一律走 onPrimary 系令牌（原用 text1/text3/primary 是蓝底蓝字）。
      Row({ space: NxGrid * 2 }) {
        Text(card.title)
          .fontSize(NxFontSize.xxl)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().onPrimary)
          .lineHeight(24)
          .layoutWeight(1)
        Text('约 ' + card.minutes + ' 分钟')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().onPrimary)
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().onPrimaryFill)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      if (card.reason.length > 0) {
        Text(card.reason)
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().onPrimarySoft)
          .lineHeight(19)
          .width('100%')
      }

      // 操作独占一行：原先与时长挤在同一 Row，窄屏三个按钮必被压扁。
      if (this.entry.status === undefined || this.entry.status === 'pending') {
        Row({ space: NxGrid * 2 }) {
          Button(card.accept)
            .layoutWeight(2)
            .height(34)
            .fontSize(NxFontSize.md)
            .backgroundColor(this.palette().onPrimary)
            .fontColor(this.palette().primary)
            .enabled(!this.responding)
            .onClick(() => {
              this.respond('accept');
            })
          Button(card.defer)
            .layoutWeight(1)
            .height(34)
            .fontSize(NxFontSize.sm)
            .backgroundColor(this.palette().onPrimaryFill)
            .fontColor(this.palette().onPrimary)
            .enabled(!this.responding)
            .onClick(() => {
              this.respond('defer');
            })
          Button(card.dismiss)
            .layoutWeight(1)
            .height(34)
            .fontSize(NxFontSize.sm)
            .backgroundColor(this.palette().onPrimaryFill)
            .fontColor(this.palette().onPrimarySoft)
            .enabled(!this.responding)
            .onClick(() => {
              this.respond('dismiss');
            })
        }
        .width('100%')
      } else {
        Text(this.entry.status === 'accept' ? '已确认，正在打开学习会话' : (this.entry.status === 'defer' ? '已确认，稍后再提醒' : '已确认，不再提醒'))
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().onPrimarySoft)
          .width('100%')
      }
    }
    .width('100%')
    .padding(NxGrid * 4)
    .borderRadius(NxRadius.md)
    .linearGradient({
      angle: 135,
      colors: [[this.palette().gradientStart, 0.0], [this.palette().gradientEnd, 1.0]],
    })
    .shadow({
      radius: NxShadow.level2.radius,
      color: NxShadow.level2.color,
      offsetX: NxShadow.level2.offsetX,
      offsetY: NxShadow.level2.offsetY,
    })
  }

  @Builder
  prepCard(card: PrepCard) {
    Column({ space: NxGrid * 2 }) {
      Row() {
        Text(card.chapter)
          .fontSize(NxFontSize.xl)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
          .layoutWeight(1)
        Text(this.durationLabel(card.durationMs))
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
      }
      .width('100%')
      Text('划了 ' + card.highlights.length + ' 个重点 · 出了 ' + card.quizCount + ' 道题')
        .fontSize(NxFontSize.sm)
        .fontColor(this.palette().text3)
        .width('100%')
      if (card.highlights.length > 0) {
        ForEach(card.highlights, (highlight: string) => {
          Text('· ' + highlight)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text2)
            .width('100%')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }, (highlight: string) => highlight)
      }
      if (card.briefing !== undefined) {
        Column({ space: NxGrid }) {
          Text('我猜你今天还会在' + card.briefing.concept + '上卡住——上次卡了 ' + card.briefing.hitCount + ' 次——讲解我备好了。')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().text1)
            .lineHeight(19)
            .width('100%')
          Text('预判讲解 · 约 ' + card.briefing.minutes + ' 分钟')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().primary)
            .width('100%')
        }
        .width('100%')
        .padding(NxGrid * 2)
        .borderRadius(NxRadius.xs)
        .backgroundColor(this.palette().primarySoft)
      }
      if (card.steps !== undefined && card.steps.length > 0) {
        Column({ space: NxGrid }) {
          Row() {
            Text(this.stepsOpen ? '收起阶段步骤' : '看阶段步骤（' + card.steps.length + ' 步）')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().primary)
            Blank()
          }
          .width('100%')
          .onClick(() => {
            this.stepsOpen = !this.stepsOpen;
          })
          if (this.stepsOpen) {
            ForEach(card.steps, (step: PrepStep) => {
              Column({ space: 2 }) {
                Row() {
                  Text(step.type.length > 0 ? step.type : '阶段')
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().text3)
                  Blank()
                }
                .width('100%')
                if (step.title.length > 0) {
                  Text(step.title)
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().text2)
                    .width('100%')
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                if (step.preview.length > 0) {
                  Text(step.preview)
                    .fontSize(NxFontSize.xs)
                    .fontColor(this.palette().text4)
                    .width('100%')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
              }
              .width('100%')
              .padding({ top: NxGrid, bottom: NxGrid })
            }, (step: PrepStep, index: number) => step.type + '_' + step.title + '_' + index)
          }
        }
        .width('100%')
        .padding(NxGrid * 2)
        .borderRadius(NxRadius.xs)
        .backgroundColor(this.palette().surface3)
      }
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().primarySoft)
  }

  private confusionKindLabel(kind: string): string {
    if (kind === 'selection') {
      return '划线没问';
    }
    if (kind === 'ask') {
      return '提问';
    }
    if (kind === 'idle') {
      return '停顿';
    }
    if (kind === 'wrong') {
      return '做错';
    }
    return kind;
  }

  @Builder
  confusionCard(card: ConfusionCard) {
    Column({ space: NxGrid * 2 }) {
      Text(card.concept)
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      Text('你在这上面卡过 ' + card.hitCount + ' 次。')
        .fontSize(NxFontSize.md)
        .fontColor(this.palette().text2)
        .width('100%')
      Row({ space: NxGrid }) {
        ForEach(card.breakdown, (item: ConfusionBreakdown) => {
          Column({ space: 2 }) {
            Text(String(item.count))
              .fontSize(NxFontSize.xl)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette().primary)
            Text(this.confusionKindLabel(item.kind))
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
          }
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().primarySoft)
        }, (item: ConfusionBreakdown) => item.kind)
      }
      .width('100%')
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().surface2)
  }

  @Builder
  prereqCard(card: PrereqCard) {
    Column({ space: NxGrid * 2 }) {
      Text(card.concept)
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      Text('来自：' + card.fromCourse + ' · 当前掌握度 ' + Math.round(card.masteryDelta * 100) + '%')
        .fontSize(NxFontSize.sm)
        .fontColor(this.palette().text3)
        .width('100%')
      Button('先过一遍（约 ' + card.minutes + ' 分钟）')
        .width('100%')
        .height(34)
        .fontSize(NxFontSize.md)
        .backgroundColor(this.palette().primary)
        .fontColor(this.palette().onPrimary)
        .onClick(() => {
          const lectureId = card.fromLectureId !== undefined ? card.fromLectureId : '';
          const bookId = card.fromBookId !== undefined ? card.fromBookId : '';
          const chapterIndex = card.fromChapterIndex !== undefined ? card.fromChapterIndex : -1;
          this.onOpenPrereq(lectureId, bookId, chapterIndex, card.fromCourse);
        })
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().primarySoft)
  }

  @Builder
  quizCard(card: QuizCard) {
    Column({ space: NxGrid * 2 }) {
      Text(card.stem)
        .fontSize(NxFontSize.lg)
        .fontColor(this.palette().text1)
        .width('100%')
      Button('开始答题')
        .width('100%')
        .height(34)
        .fontSize(NxFontSize.md)
        .backgroundColor(this.palette().primary)
        .fontColor(this.palette().onPrimary)
        .onClick(() => {
          this.onOpenQuiz(card.flowId !== undefined ? card.flowId : '');
        })
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().primarySoft)
  }

  @State uncertainResolved: string[] = [];

  @Builder
  wrapupCard(card: WrapupCard) {
    Column({ space: NxGrid * 2 }) {
      Row() {
        Text('验收卡')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
        Blank()
        Text('约 ' + card.minutes + ' 分钟 · 答对 ' + card.quizScore)
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text3)
      }
      .width('100%')
      Text(card.chapter)
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      if (card.masteryShift.length > 0) {
        ForEach(card.masteryShift, (item: MasteryShift) => {
          Text('· ' + item.concept + '的掌握度从 ' + item.from + ' 升到 ' + item.to)
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().success)
            .width('100%')
        }, (item: MasteryShift) => item.concept)
      }
      if (card.uncertain.length > 0) {
        Column({ space: NxGrid }) {
          ForEach(card.uncertain, (item: UncertainItem) => {
            Column({ space: NxGrid }) {
              Text('我拿不准：' + item.why)
                .fontSize(NxFontSize.sm)
                .fontColor(this.palette().text2)
                .width('100%')
              if (this.uncertainResolved.indexOf(item.questionId) >= 0) {
                Text('已裁决')
                  .fontSize(NxFontSize.xs)
                  .fontColor(this.palette().success)
                  .width('100%')
              } else {
                Row({ space: NxGrid * 2 }) {
                  Button('对')
                    .height(28)
                    .fontSize(NxFontSize.sm)
                    .backgroundColor(this.palette().surface3)
                    .fontColor(this.palette().text2)
                    .onClick(() => {
                      this.verdictUncertain(card, item.questionId, 'agree');
                    })
                  Button('不对')
                    .height(28)
                    .fontSize(NxFontSize.sm)
                    .backgroundColor(this.palette().surface3)
                    .fontColor(this.palette().text2)
                    .onClick(() => {
                      this.verdictUncertain(card, item.questionId, 'disagree');
                    })
                }
                .width('100%')
              }
            }
            .width('100%')
            .padding(NxGrid * 2)
            .borderRadius(NxRadius.xs)
            .backgroundColor(this.palette().surface3)
          }, (item: UncertainItem) => item.questionId)
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().surface2)
  }

  async verdictUncertain(card: WrapupCard, questionId: string, verdict: string): Promise<void> {
    const flowId = card.flowId !== undefined ? card.flowId : '';
    if (flowId.length === 0) {
      return;
    }
    try {
      await this.api.postFlowUncertain(flowId, questionId, verdict);
      this.uncertainResolved.push(questionId);
    } catch (err) {
      // 回喂失败保留按钮，用户可重试
    }
  }

  @Builder
  planCard(card: PlanCard) {
    Column({ space: NxGrid * 2 }) {
      Text(card.chapter)
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      Row() {
        Text('约 ' + card.minutes + ' 分钟')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().primary)
        Blank()
      }
      .width('100%')
      if (card.why.length > 0) {
        Text(card.why)
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .width('100%')
      }
      Button('开始学习')
        .width('100%')
        .height(34)
        .fontSize(NxFontSize.md)
        .backgroundColor(this.palette().primary)
        .fontColor(this.palette().onPrimary)
        .onClick(() => {
          this.onOpenPlan();
        })
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().primarySoft)
  }

  @Builder
  citationCard() {
    Column({ space: NxGrid * 2 }) {
      Text(cardSummary(this.entry.card))
        .fontSize(NxFontSize.md)
        .fontColor(this.palette().text2)
        .lineHeight(20)
        .width('100%')
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Button('回到原文')
        .height(30)
        .fontSize(NxFontSize.sm)
        .backgroundColor(this.palette().primarySoft)
        .fontColor(this.palette().primary)
        .onClick(() => {
          this.onCitationAnchor(this.entry.id);
        })
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().surface2)
  }

  @Builder
  genericCard() {
    Column({ space: NxGrid }) {
      if (cardSummary(this.entry.card) !== '') {
        Text(cardSummary(this.entry.card))
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text1)
          .width('100%')
      }
      if (this.entry.text.length > 0) {
        Text(this.entry.text)
          .fontSize(NxFontSize.md)
          .fontColor(this.palette().text2)
          .width('100%')
      }
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().surface2)
  }

  /**
   * 自主性标签。后端把所有决策条目硬编码成 unattended=true，用它区分度为零，
   * 所以这里按 kind + 条目自身时刻推导——只陈述数据支持的事实，不猜用户在不在。
   */
  private autonomyLabel(): string {
    if (this.entry.kind === 'agent_hold') {
      return '我忍住了';
    }
    if (this.entry.kind !== 'agent_act') {
      return '';
    }
    const hour: number = new Date(this.entry.ts).getHours();
    const night: boolean = hour >= 22 || hour < 7;
    const card: MessageCard | null | undefined = this.entry.card;
    const isPrep: boolean = card !== null && card !== undefined && card.type === 'prep';
    if (isPrep && night) {
      return '你睡着的时候';
    }
    if (night) {
      return '你不在的时候';
    }
    return '我主动做的';
  }

  /** 决策器抑制原因的人话标签（对应后端 _SUPPRESS_REASON 的八种）。 */
  private suppressLabel(key: string): string {
    if (key === 'judgment') {
      return '我判断不是时候';
    }
    if (key === 'silent_hours') {
      return '静默时段';
    }
    if (key === 'daily_cap') {
      return '今日已达上限';
    }
    if (key === 'cooldown') {
      return '这章刚提醒过';
    }
    if (key === 'backoff') {
      return '连续没理会，退避中';
    }
    if (key === 'defer') {
      return '你点了晚点';
    }
    if (key === 'do_not_disturb') {
      return '你开着免打扰';
    }
    if (key === 'low_score') {
      return '时机分不够';
    }
    return '';
  }

  /**
   * 克制的证据（§11.4 第 4 条）：它为什么选择不说话，以及当时算了多少分。
   * 后端字段缺失时整块不渲染，不影响其余显示。
   */
  @Builder
  holdEvidence() {
    Row({ space: NxGrid * 2 }) {
      if (this.entry.suppressed_by !== undefined && this.suppressLabel(this.entry.suppressed_by).length > 0) {
        Text(this.suppressLabel(this.entry.suppressed_by))
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text2)
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().surface3)
      }
      if (typeof this.entry.score === 'number') {
        // 后端部分 hold（如流程超时收敛）没有分数，JSON 里是 null，不能只判 undefined。
        Text('决策分 ' + this.entry.score.toFixed(2) + ' / 门槛 0.55')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text4)
      }
      Blank()
    }
    .width('100%')
  }

  private channelLabel(channel: string): string {
    if (channel === 'notify') {
      return '通知';
    }
    if (channel === 'liveview') {
      return '实况窗';
    }
    if (channel === 'xiaoyi_suggest') {
      return '小艺建议';
    }
    if (channel === 'card') {
      return '卡片';
    }
    return channel;
  }

  private judgmentData(): JudgmentSummary | null {
    return this.entry.judgment !== undefined && this.entry.judgment !== null ? this.entry.judgment : null;
  }

  private contextData(): ContextSnapshot | null {
    return this.entry.context !== undefined && this.entry.context !== null ? this.entry.context : null;
  }

  /** Judgment Loop 的可解释快照：只有后端确实返回字段时才出现。 */
  @Builder
  contextSnapshot() {
    Column({ space: NxGrid }) {
      if (this.judgmentData() !== null) {
        Row({ space: NxGrid }) {
          Text(this.judgmentData()!.source === 'model' ? '模型裁决' : '规则裁决')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().primary)
          if (this.channelLabel(this.judgmentData()!.act).length > 0) {
            Text(this.channelLabel(this.judgmentData()!.act))
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
          }
          Text('把握 ' + Math.round(this.judgmentData()!.confidence * 100) + '%')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text4)
          Blank()
        }
        .width('100%')
        if (this.judgmentData()!.wanted_to_say.length > 0) {
          Text('本来想说：' + this.judgmentData()!.wanted_to_say)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
      }
      if (this.contextData() !== null) {
        Text('当时看到的上下文')
          .fontSize(NxFontSize.xs)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text2)
          .width('100%')
        if (this.contextData()!.time.length > 0) {
          Text(this.contextData()!.time + (this.contextData()!.weekday.length > 0 ? ' · ' + this.contextData()!.weekday : ''))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
        if (this.contextData()!.calendar.length > 0) {
          Text('日历：' + this.contextData()!.calendar.join('、'))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
        Row({ space: NxGrid * 2 }) {
          if (this.contextData()!.scene.length > 0 && this.contextData()!.scene !== 'unknown') {
            Text('场景 · ' + this.contextData()!.scene)
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
          }
          if (this.contextData()!.location.length > 0 && this.contextData()!.location !== 'unknown') {
            Text('位置 · ' + this.contextData()!.location)
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
          }
          if (this.contextData()!.dnd) {
            Text('免打扰')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().warning)
          }
          Blank()
        }
        .width('100%')
        if (this.contextData()!.at_risk.length > 0) {
          Text('有风险：' + this.contextData()!.at_risk.join('、'))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
        if (this.contextData()!.confusion.length > 0) {
          Text('困惑：' + this.contextData()!.confusion.join('、'))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
        }
        if (this.contextData()!.recent_questions.length > 0) {
          Text('最近问过：' + this.contextData()!.recent_questions.join('、'))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        if (this.contextData()!.recent_responses.length > 0) {
          Text('最近回应：' + this.contextData()!.recent_responses.join('、'))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
    }
    .width('100%')
    .padding(NxGrid * 2)
    .borderRadius(NxRadius.xs)
    .backgroundColor(this.palette().surface3)
  }

  /** 用户消息：右对齐窄气泡，与 Agent 的便签在视觉上分开；同样挂在时间轴上。 */
  @Builder
  userBubble() {
    Column({ space: NxGrid }) {
      Row() {
        Blank()
        Text(this.entry.text)
          .fontSize(NxFontSize.md)
          .fontColor(this.palette().onPrimary)
          .lineHeight(20)
          .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
          .borderRadius(NxRadius.md)
          .backgroundColor(this.palette().primary)
          .constraintSize({ maxWidth: '78%' })
      }
      .width('100%')
      Row() {
        Blank()
        Text(formatEntryTime(this.entry.ts))
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text4)
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: NxGrid * 5, bottom: NxGrid * 4 })
    .border({ width: { left: 1 }, color: this.palette().rail })
  }

  build() {
    Column() {
      if (this.entry.kind === 'user_msg') {
        this.userBubble()
      } else {
        this.agentEntry()
      }
    }
    .width('100%')
  }

  /** 时间轴圆点：夜靛蓝 = 它在工作；晨橙 = 它报告 / 在等你；克制条目淡色。 */
  private dotColor(): string {
    if (this.entry.kind === 'agent_hold') {
      return this.palette().holdInk;
    }
    if (this.entry.kind === 'system' || this.entry.kind === 'tool_step') {
      return this.palette().text4;
    }
    const hour: number = new Date(this.entry.ts).getHours();
    if (hour >= 23 || hour < 8) {
      return this.palette().night;
    }
    if (this.entry.kind === 'agent_act' || this.entry.kind === 'agent_msg') {
      return this.palette().dawn;
    }
    return this.palette().text3;
  }

  private isHold(): boolean {
    return this.entry.kind === 'agent_hold';
  }

  @Builder
  agentEntry() {
    // 便签而不是卡片：左侧一条时间轴轨道 + 圆点，内容不加边框与阴影，靠留白分隔。
    Stack({ alignContent: Alignment.TopStart }) {
      Column({ space: NxGrid }) {
        if (this.entry.status !== 'thinking') {
        Row() {
          Text(formatEntryTime(this.entry.ts))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text4)
            .fontFamily(NxFontFamily.mono)
          if (this.autonomyLabel().length > 0) {
            Text(this.autonomyLabel())
              .fontSize(NxFontSize.xs)
              .fontColor(this.isHold() ? this.palette().holdInk : this.palette().dawn)
              .margin({ left: NxGrid * 2 })
          } else if (this.entry.kind === 'system') {
            Text('系统')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text4)
              .margin({ left: NxGrid * 2 })
          }
          if (this.entry.kind === 'agent_act' && this.entry.channel !== undefined && this.entry.channel.length > 0 && this.entry.channel !== 'card' && this.entry.channel !== 'hold') {
            // 出现的形态：它在系统的哪个入口出现（重构方案第二步）。
            Text('出现在' + this.channelLabel(this.entry.channel))
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().primary)
              .padding({ left: NxGrid * 2, right: NxGrid * 2, top: 1, bottom: 1 })
              .borderRadius(NxRadius.xs)
              .backgroundColor(this.palette().primarySoft)
              .margin({ left: NxGrid * 2 })
          }
          Blank()
          if ((this.entry.kind === 'agent_act' || this.entry.kind === 'agent_msg') &&
            this.entry.status !== 'thinking' && this.entry.text.length > 0) {
            Text('朗读')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text4)
              .margin({ right: NxGrid * 2 })
              .onClick(() => {
                sharedTts.speakText(this.entry.text, (message: string): void => {
                });
              })
          }
          if (this.entry.status !== undefined && this.entry.status === 'accept') {
            Text('已开始')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().success)
          } else if (this.entry.status !== undefined && this.entry.status === 'dismiss') {
            Text('已放下')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text4)
          } else if (this.entry.status !== undefined && this.entry.status === 'defer') {
            Text('稍后再说')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().warning)
          }
        }
        .width('100%')
        }

        if (this.entry.status === 'thinking') {
          ThinkingLine()
        } else if (this.entry.kind === 'agent_msg') {
          MarkdownView({
            source: this.entry.text,
            serif: true,
            bodySize: NxFontSize.xl,
            lineH: 23,
          })
        } else {
          Text(this.entry.text)
            .fontSize(this.entry.kind === 'system' || this.entry.kind === 'tool_step' ? NxFontSize.sm : NxFontSize.xl)
            .fontFamily(this.entry.kind === 'agent_act' || this.entry.kind === 'agent_hold' ? NxFontFamily.serif : NxFontFamily.sans)
            .fontColor(this.isHold() ? this.palette().holdInk : (this.entry.kind === 'system' ? this.palette().text3 : this.palette().text1))
            .lineHeight(23)
            .width('100%')
        }

        if (this.isHold()) {
          this.holdEvidence()
        }

        if (this.entry.reason !== undefined && this.entry.reason.length > 0) {
          // 「为什么」折叠：默认只露一行。
          Row({ space: NxGrid }) {
            Text('为什么 · ' + this.entry.reason)
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().text3)
              .lineHeight(18)
              .layoutWeight(1)
              .maxLines(this.expanded ? 12 : 1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.expanded ? '收起' : '展开')
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().primary)
          }
          .width('100%')
          .onClick(() => {
            this.expanded = !this.expanded;
          })
        }

        if (this.expanded && this.entry.evidence !== undefined) {
          ForEach(this.entry.evidence, (item: EvidenceRef, index: number) => {
            Text('· ' + item.label)
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
              .width('100%')
          }, (item: EvidenceRef, index: number) => item.label + '_' + index)
        }

        if (this.expanded && (this.entry.judgment !== undefined || this.entry.context !== undefined)) {
          this.contextSnapshot()
        }

        if (this.entry.card !== null && this.entry.card !== undefined) {
          if (this.entry.card.type === 'proactive') {
            this.proactiveCard(this.entry.card as ProactiveCard)
          } else if (this.entry.card.type === 'prep') {
            this.prepCard(this.entry.card as PrepCard)
          } else if (this.entry.card.type === 'confusion') {
            this.confusionCard(this.entry.card as ConfusionCard)
          } else if (this.entry.card.type === 'prereq') {
            this.prereqCard(this.entry.card as PrereqCard)
          } else if (this.entry.card.type === 'plan') {
            this.planCard(this.entry.card as PlanCard)
          } else if (this.entry.card.type === 'quiz') {
            this.quizCard(this.entry.card as QuizCard)
          } else if (this.entry.card.type === 'wrapup') {
            this.wrapupCard(this.entry.card as WrapupCard)
          } else if (this.entry.card.type === 'citation') {
            this.citationCard()
          } else {
            this.genericCard()
          }
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: NxGrid * 5, right: NxGrid, top: NxGrid, bottom: NxGrid * 5 })
      .border({ width: { left: 1 }, color: this.palette().rail })

      Circle()
        .width(this.isHold() ? 7 : 10)
        .height(this.isHold() ? 7 : 10)
        .fill(this.dotColor())
        .position({ x: this.isHold() ? -3 : -4.5, y: NxGrid + 3 })
    }
    .width('100%')
    .clip(false)
    .gesture(LongPressGesture({ repeat: false }).onAction(() => {
      this.onInspect(this.entry);
    }))
  }
}
