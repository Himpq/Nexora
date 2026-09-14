/**
 * 长按抽屉（重构方案 §二·第三步）：「它眼里的你」不再是一个 Tab，而是任一条目下滑出的
 *   ① 这一条：它当时看到了什么（ContextSnapshot）与裁决来源
 *   ② 它眼里的你：掌握度色条 + 可反驳的判断；反驳带文字时送回模型，由它回应并改写判断
 *   ③ 学习报告入口
 * 数据：GET /cognition/overview；反驳：POST /cognition/verdict（note → reply）。
 */
import { TimelineEntry, MirrorFacet, MirrorMasteryCell, MirrorOverviewData, MirrorEvidenceRef, VerdictData,
  JudgmentSummary, ContextSnapshot } from '../models/Index';
import { AgentApi, AgentEnvelope } from '../services/AgentApi';
import { SkeletonCard, EmptyState, ErrorState } from './common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxFontFamily, nxHeatColor, nxHeatTextColor } from '../theme/DesignTokens';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

@Component
export struct InspectSheet {
  entry: TimelineEntry | null = null;
  @State loading: boolean = false;
  @State errorText: string = '';
  @State facets: MirrorFacet[] = [];
  @State mastery: MirrorMasteryCell[] = [];
  @State expandedId: string = '';
  @State rebuttalFacetId: string = '';
  @State rebuttalText: string = '';
  @State replies: Map<string, string> = new Map<string, string>();
  @State busyFacetId: string = '';
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: AgentApi = new AgentApi();
  private reportLectureId: string = '';
  private reportBookId: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getCognitionOverview();
      const data: MirrorOverviewData = env.data as MirrorOverviewData;
      this.facets = data.facets;
      this.mastery = data.mastery;
      for (let i = 0; i < data.facets.length; i++) {
        if (data.facets[i].lectureId.length > 0) {
          this.reportLectureId = data.facets[i].lectureId;
          this.reportBookId = data.facets[i].bookId;
          break;
        }
      }
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '我对你的判断没取到：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.loading = false;
    }
  }

  /** 裁决一条判断；带 note 时反驳变成对话，模型的回应显示在该条下面。 */
  async verdict(facet: MirrorFacet, value: string, note: string = ''): Promise<void> {
    if (this.busyFacetId.length > 0) {
      return;
    }
    this.busyFacetId = facet.id;
    try {
      const evidence: string[] = [];
      for (const item of facet.evidence) {
        evidence.push(item.label);
      }
      const env: AgentEnvelope = await this.api.postCognitionVerdict(
        facet.id, value, facet.conceptId, facet.lectureId, facet.bookId, note, facet.claim, evidence);
      const data: VerdictData = env.data as VerdictData;
      if (data.reply !== undefined && data.reply !== null && data.reply.reply.length > 0) {
        this.replies.set(facet.id, data.reply.reply);
      } else if (note.length > 0) {
        this.replies.set(facet.id, '我记下了你的反驳，下次判断会把它算进去。');
      }
      this.rebuttalFacetId = '';
      this.rebuttalText = '';
      await this.load();
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = '回馈失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.busyFacetId = '';
    }
  }

  openReport(): void {
    const params: Record<string, Object> = {
      'lecture_id': this.reportLectureId,
      'book_id': this.reportBookId,
      'lecture_title': '',
    };
    router.pushUrl({ url: 'pages/Report', params: params });
  }

  private judgmentOf(): JudgmentSummary | null {
    if (this.entry === null || this.entry.judgment === undefined || this.entry.judgment === null) {
      return null;
    }
    return this.entry.judgment;
  }

  private contextOf(): ContextSnapshot | null {
    if (this.entry === null || this.entry.context === undefined || this.entry.context === null) {
      return null;
    }
    return this.entry.context;
  }

  private sourceLabel(judgment: JudgmentSummary): string {
    const who: string = judgment.source === 'model' ? '我自己判断的' : '按规则判断的';
    return who + ' · 把握 ' + Math.round(judgment.confidence * 100) + '%';
  }

  @Builder
  line(label: string, value: string) {
    if (value.length > 0) {
      Row({ space: NxGrid * 2 }) {
        Text(label)
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text4)
          .width(52)
        Text(value)
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .lineHeight(18)
          .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
    }
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(NxFontSize.xl)
      .fontFamily(NxFontFamily.serif)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.palette().text1)
      .width('100%')
      .margin({ top: NxGrid * 2 })
  }

  /** ① 这一条：它当时看到了什么。 */
  @Builder
  thisEntry() {
    if (this.entry !== null) {
      Column({ space: NxGrid * 2 }) {
        Text(this.entry.text)
          .fontSize(NxFontSize.lg)
          .fontFamily(NxFontFamily.serif)
          .fontColor(this.palette().text1)
          .lineHeight(22)
          .width('100%')
        if (this.entry.reason !== undefined && this.entry.reason.length > 0) {
          this.line('为什么', this.entry.reason)
        }
        if (this.judgmentOf() !== null) {
          this.line('谁判断', this.sourceLabel(this.judgmentOf()!))
          if (this.judgmentOf()!.wanted_to_say.length > 0) {
            this.line('本想说', this.judgmentOf()!.wanted_to_say)
          }
        }
        if (this.contextOf() !== null) {
          Text('我当时看到的')
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .letterSpacing(1)
            .width('100%')
            .margin({ top: NxGrid })
          this.line('时间', this.contextOf()!.time + (this.contextOf()!.weekday.length > 0 ? ' ' + this.contextOf()!.weekday : ''))
          this.line('日历', this.contextOf()!.calendar.join('；'))
          this.line('设备', (this.contextOf()!.dnd ? '免打扰 · ' : '') + (this.contextOf()!.scene !== 'unknown' ? this.contextOf()!.scene : '') + (this.contextOf()!.location !== 'unknown' ? ' · ' + this.contextOf()!.location : ''))
          this.line('有风险', this.contextOf()!.at_risk.join('；'))
          this.line('困惑', this.contextOf()!.confusion.join('；'))
          this.line('最近问过', this.contextOf()!.recent_questions.join('；'))
          this.line('你的回应', this.contextOf()!.recent_responses.join('、'))
        }
      }
      .width('100%')
      .padding(NxGrid * 4)
      .borderRadius(NxRadius.md)
      .backgroundColor(this.palette().cardBg)
    }
  }

  /** ② 它眼里的你。 */
  @Builder
  facetRow(facet: MirrorFacet) {
    Column({ space: NxGrid * 2 }) {
      Row({ space: NxGrid }) {
        Text(facet.claim)
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text1)
          .lineHeight(21)
          .layoutWeight(1)
        Text(Math.round(facet.confidence * 100) + '%')
          .fontSize(NxFontSize.xs)
          .fontColor(this.palette().text4)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      Row({ space: NxGrid * 3 }) {
        Text(this.expandedId === facet.id ? '收起依据' : '看依据')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .onClick(() => {
            this.expandedId = this.expandedId === facet.id ? '' : facet.id;
          })
        Blank()
        if (facet.userVerdict === 'disagree') {
          Text('你说不对')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().warning)
        } else if (facet.userVerdict === 'agree') {
          Text('你说对')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().success)
        } else {
          Text('说得对')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().success)
            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
            .onClick(() => {
              this.verdict(facet, 'agree');
            })
          Text('不对')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().danger)
            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
            .onClick(() => {
              this.rebuttalFacetId = this.rebuttalFacetId === facet.id ? '' : facet.id;
              this.rebuttalText = '';
            })
        }
      }
      .width('100%')
      if (this.expandedId === facet.id) {
        ForEach(facet.evidence, (item: MirrorEvidenceRef) => {
          Text('· ' + item.label)
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text3)
            .width('100%')
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }, (item: MirrorEvidenceRef, index: number) => item.label + '_' + index)
      }
      if (this.rebuttalFacetId === facet.id) {
        Row({ space: NxGrid * 2 }) {
          TextInput({ placeholder: '哪里不对？说一句，我会改判断', text: this.rebuttalText })
            .layoutWeight(1)
            .height(36)
            .fontSize(NxFontSize.sm)
            .backgroundColor(this.palette().surface2)
            .borderRadius(NxRadius.sm)
            .onChange((value: string) => {
              this.rebuttalText = value;
            })
          Button(this.busyFacetId === facet.id ? '在想…' : '反驳')
            .height(34)
            .fontSize(NxFontSize.sm)
            .backgroundColor(this.palette().primary)
            .fontColor(this.palette().onPrimary)
            .enabled(this.busyFacetId.length === 0)
            .onClick(() => {
              this.verdict(facet, 'disagree', this.rebuttalText);
            })
        }
        .width('100%')
      }
      if (this.replies.get(facet.id) !== undefined) {
        Text(this.replies.get(facet.id) as string)
          .fontSize(NxFontSize.sm)
          .fontFamily(NxFontFamily.serif)
          .fontColor(this.palette().text1)
          .lineHeight(19)
          .width('100%')
          .padding(NxGrid * 2)
          .borderRadius(NxRadius.xs)
          .backgroundColor(this.palette().dawnSoft)
      }
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.sm)
    .backgroundColor(this.palette().surface2)
  }

  /** 热力格只画有信号的概念（掌握度 > 0，按高到低，最多 9 个）；没碰过的用一句话带过。 */
  private heatCells(): MirrorMasteryCell[] {
    const touched: MirrorMasteryCell[] = [];
    for (const cell of this.mastery) {
      if (cell.mastery > 0) {
        touched.push(cell);
      }
    }
    touched.sort((a: MirrorMasteryCell, b: MirrorMasteryCell): number => b.mastery - a.mastery);
    return touched.slice(0, 9);
  }

  private untouchedCount(): number {
    let count: number = 0;
    for (const cell of this.mastery) {
      if (cell.mastery <= 0) {
        count++;
      }
    }
    return count;
  }

  build() {
    Scroll() {
      Column({ space: NxGrid * 3 }) {
        if (this.entry !== null) {
          this.sectionTitle('这一条')
          this.thisEntry()
        }

        this.sectionTitle('它眼里的你')
        if (this.loading) {
          SkeletonCard()
        }
        if (this.errorText.length > 0) {
          ErrorState({ message: this.errorText, onRetry: (): void => {
            this.load();
          } })
        }
        if (this.heatCells().length > 0) {
          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.heatCells(), (cell: MirrorMasteryCell) => {
              Column({ space: 2 }) {
                Text(cell.concept)
                  .fontSize(NxFontSize.xs)
                  .fontColor(nxHeatTextColor(cell.mastery, this.nxDark))
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
                Text(Math.round(cell.mastery * 100) + '%')
                  .fontSize(NxFontSize.sm)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(nxHeatTextColor(cell.mastery, this.nxDark))
              }
              .width('30%')
              .height(54)
              .padding(NxGrid * 2)
              .margin({ right: '3%', bottom: NxGrid * 2 })
              .borderRadius(NxRadius.xs)
              .backgroundColor(nxHeatColor(cell.mastery, this.nxDark))
              .justifyContent(FlexAlign.SpaceBetween)
              .alignItems(HorizontalAlign.Start)
            }, (cell: MirrorMasteryCell) => cell.concept + '_' + cell.chapterName)
          }
          .width('100%')
        }
        if (!this.loading && this.untouchedCount() > 0) {
          Text(this.heatCells().length > 0
            ? '还有 ' + this.untouchedCount() + ' 个概念你还没碰过，我先不下判断。'
            : '你还没留下学习信号，我先不下判断。')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().text3)
            .width('100%')
        }
        if (!this.loading && this.facets.length === 0) {
          EmptyState({ text: '我还在积累对你的判断，有把握了我会说。' })
        }
        ForEach(this.facets, (facet: MirrorFacet) => {
          this.facetRow(facet)
        }, (facet: MirrorFacet) => facet.id + '_' + (facet.userVerdict === null ? 'n' : facet.userVerdict))

        if (this.reportLectureId.length > 0) {
          Text('打开学习报告')
            .fontSize(NxFontSize.md)
            .fontColor(this.palette().primary)
            .width('100%')
            .textAlign(TextAlign.Center)
            .padding(NxGrid * 3)
            .borderRadius(NxRadius.sm)
            .backgroundColor(this.palette().primarySoft)
            .onClick(() => {
              this.openReport();
            })
        }
      }
      .width('100%')
      .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 2, bottom: NxGrid * 8 })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .align(Alignment.TopStart)
  }
}
