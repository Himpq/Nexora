/**
 * 长按抽屉（重构方案 §二·第三步）：「它眼里的你」不再是一个 Tab，而是任一条目下滑出的
 *   ① 这一条：它当时看到了什么（ContextSnapshot）与裁决来源
 *   ② 它眼里的你：掌握度色条 + 可反驳的判断；反驳带文字时送回模型，由它回应并改写判断
 *   ③ 学习报告入口
 * 数据：GET /cognition/overview；反驳：POST /cognition/verdict（note → reply）。
 */
import { TimelineEntry, MirrorFacet, MirrorMasteryCell, MirrorOverviewData, MirrorEvidenceRef, VerdictData,
  JudgmentSummary, ContextSnapshot, MirrorActivity, MirrorCourse, ContextData } from '../models/Index';
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
  @State activity: MirrorActivity | null = null;
  @State courses: MirrorCourse[] = [];
  @State graphStatus: string = '';
  @State expandedId: string = '';
  @State rebuttalFacetId: string = '';
  @State rebuttalText: string = '';
  @State replies: Map<string, string> = new Map<string, string>();
  @State busyFacetId: string = '';
  /** 正在就地更改表态的条目 id。 */
  @State revising: string = '';
  /** 从「这一条」进入时，整份镜像默认折叠。 */
  @State showMirrorBelow: boolean = false;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  @StorageProp('nxStudyTick') @Watch('onStudyChanged') studyTick: number = 0;
  private api: AgentApi = new AgentApi();
  private reportLectureId: string = '';
  private reportBookId: string = '';
  private loadVersion: number = 0;
  private attached: boolean = false;

  aboutToAppear(): void {
    this.attached = true;
    this.load();
  }

  aboutToDisappear(): void {
    this.attached = false;
    this.loadVersion++;
  }

  onStudyChanged(): void {
    if (this.attached) {
      this.load();
    }
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  async load(): Promise<void> {
    const version = ++this.loadVersion;
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.getCognitionOverview();
      if (version !== this.loadVersion) {
        return;
      }
      const data: MirrorOverviewData = env.data as MirrorOverviewData;
      this.facets = data.facets;
      this.mastery = data.mastery;
      this.activity = data.activity !== undefined ? data.activity : null;
      this.courses = data.courses !== undefined ? data.courses : [];
      this.graphStatus = data.graph_status !== undefined ? data.graph_status : '';
      this.reportLectureId = '';
      this.reportBookId = '';
      if (this.courses.length > 0) {
        this.reportLectureId = this.courses[0].lecture_id;
        this.reportBookId = this.courses[0].book_id !== undefined ? this.courses[0].book_id! : '';
      } else {
        for (const facet of data.facets) {
          if (facet.lectureId.length > 0) {
            this.reportLectureId = facet.lectureId;
            this.reportBookId = facet.bookId;
            break;
          }
        }
      }
      if (this.reportLectureId.length === 0) {
        try {
          const context = await this.api.getContext();
          const snapshot = context.data as ContextData;
          if (version === this.loadVersion && snapshot.lectures.length > 0) {
            this.reportLectureId = snapshot.lectures[0].id;
            this.reportBookId = snapshot.lectures[0].books.length > 0 ? snapshot.lectures[0].books[0].id : '';
          }
        } catch (err) {
          // 课程入口不可用时仍展示已取得的阅读和交流证据。
        }
      }
    } catch (err) {
      const e = err as BusinessError;
      if (version === this.loadVersion) {
        this.errorText = '镜像暂时没同步上：' + (e.message.length > 0 ? e.message : '请稍后再试');
      }
    } finally {
      if (version === this.loadVersion) {
        this.loading = false;
      }
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
      this.revising = '';
      await this.load();
      AppStorage.setOrCreate('nxStudyTick', Date.now());
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

  /** 依据的来源与时间（2026-09-21 审查：原话 / 阅读事实 / 模型推断分开标注）。 */
  private evidenceMeta(item: MirrorEvidenceRef): string {
    const source: string = item.source === 'app' || item.source === 'conversation' || item.source === 'rebuttal' || item.source === 'memory' ? '你的原话' :
      (item.source === 'reading' || item.source === 'progress' ? '阅读 / 答题记录' : (item.source === 'review' || item.source === 'quiz' ? '答题记录' :
        (item.source === 'confusion' || item.source === 'mirror' ? '我的推断' : item.source)));
    if (item.occurredAt !== undefined && item.occurredAt > 0) {
      const d = new Date(item.occurredAt > 10000000000 ? item.occurredAt : item.occurredAt * 1000);
      return source + ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    return source;
  }

  /** 把握度只对模型判断有意义；原话本身不谈把握。 */
  private confidenceLabel(facet: MirrorFacet): string {
    if (facet.kind === 'memory' || (facet.saidOn !== undefined && facet.saidOn.length > 0)) {
      return '';
    }
    return '把握 ' + Math.round(facet.confidence * 100) + '%';
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
      if (facet.insight === true || (facet.saidOn !== undefined && facet.saidOn.length > 0)) {
        Text(facet.insight === true ? '我的观察 · 夜间反思' : '你 ' + facet.saidOn + ' 说过')
          .fontSize(NxFontSize.xs)
          .fontColor(facet.insight === true ? this.palette().primary : this.palette().text4)
          .width('100%')
      }
      Row({ space: NxGrid }) {
        Text(facet.claim)
          .fontSize(NxFontSize.lg)
          .fontColor(this.palette().text1)
          .lineHeight(21)
          .layoutWeight(1)
        if (this.confidenceLabel(facet).length > 0) {
          Text(this.confidenceLabel(facet))
            .fontSize(NxFontSize.xs)
            .fontColor(this.palette().text4)
        }
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
        if (facet.userVerdict === 'disagree' || facet.userVerdict === 'agree') {
          // 已表态的条目保留就地更改（2026-09-21 审查 F12）：点一下切换到可再次表态。
          Text(facet.userVerdict === 'agree' ? '你说对' : '你说不对')
            .fontSize(NxFontSize.sm)
            .fontColor(facet.userVerdict === 'agree' ? this.palette().success : this.palette().warning)
          Text(this.revising === facet.id ? '取消' : '改一下')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().primary)
            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
            .onClick(() => {
              this.revising = this.revising === facet.id ? '' : facet.id;
              this.rebuttalFacetId = '';
            })
        }
        if (facet.userVerdict === null || facet.userVerdict === undefined || facet.userVerdict.length === 0 || this.revising === facet.id) {
          if (facet.userVerdict !== 'agree') {
            Text('说得对')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().success)
              .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
              .onClick(() => {
                this.verdict(facet, 'agree');
              })
          }
          if (facet.userVerdict !== 'disagree') {
            Text('不对')
              .fontSize(NxFontSize.sm)
              .fontColor(this.palette().danger)
              .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
              .onClick(() => {
                this.rebuttalFacetId = this.rebuttalFacetId === facet.id ? '' : facet.id;
                this.rebuttalText = '';
              })
          }
        }
      }
      .width('100%')
      if (this.expandedId === facet.id) {
        ForEach(facet.evidence, (item: MirrorEvidenceRef) => {
          Column({ space: 2 }) {
            Text('· ' + item.label)
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text3)
              .width('100%')
            Text(this.evidenceMeta(item))
              .fontSize(NxFontSize.xs)
              .fontColor(this.palette().text4)
              .width('100%')
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
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
            .backgroundColor(this.palette().buttonFill)
            .fontColor(this.palette().onButton)
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

  private isAssessed(cell: MirrorMasteryCell): boolean {
    return typeof cell.mastery === 'number' && cell.status !== 'unknown' && cell.status !== 'unverified';
  }

  /** 未验证不等于零分；真实评估得到的 0 则必须保留。 */
  private heatCells(): MirrorMasteryCell[] {
    const touched: MirrorMasteryCell[] = [];
    for (const cell of this.mastery) {
      if (this.isAssessed(cell)) {
        touched.push(cell);
      }
    }
    touched.sort((a: MirrorMasteryCell, b: MirrorMasteryCell): number => b.mastery! - a.mastery!);
    return touched.slice(0, 9);
  }

  private untouchedCount(): number {
    let count: number = 0;
    for (const cell of this.mastery) {
      if (!this.isAssessed(cell)) {
        count++;
      }
    }
    return count;
  }

  private touchedCount(): number {
    let count: number = 0;
    for (const cell of this.mastery) {
      if (this.isAssessed(cell)) {
        count++;
      }
    }
    return count;
  }

  private averageMastery(): number | null {
    let total: number = 0;
    let count: number = 0;
    for (const cell of this.mastery) {
      if (this.isAssessed(cell)) {
        total += cell.mastery!;
        count++;
      }
    }
    return count > 0 ? total / count : null;
  }

  private weakestConcept(): string {
    let weakest: MirrorMasteryCell | null = null;
    for (const cell of this.mastery) {
      if (this.isAssessed(cell) && (weakest === null || cell.mastery! < weakest.mastery!)) {
        weakest = cell;
      }
    }
    return weakest === null ? '' : weakest.concept;
  }

  private activityLabel(): string {
    if (this.activity === null) {
      return '';
    }
    const seconds = this.activity.reading_seconds || 0;
    const duration = seconds < 60 ? Math.round(seconds) + ' 秒' : Math.round(seconds / 60) + ' 分钟';
    return '前台阅读 ' + duration + ' · 读过 ' + (this.activity.read_chapters || 0) + ' 章 · 交流 ' +
      (this.activity.conversation_count || 0) + ' 次 · 记下 ' + (this.activity.memory_count || 0) + ' 条长期记忆';
  }

  private assessmentLabel(): string {
    const average = this.averageMastery();
    if (average === null) {
      if (this.graphStatus === 'building') {
        return '我正在为这门课建知识图谱，掌握度稍后出现。';
      }
      if (this.graphStatus === 'stale') {
        return '这门课的知识图谱比大纲旧，我会在下次选课时重建；掌握度暂按旧图谱算。';
      }
      if (this.graphStatus === 'missing') {
        return '这门课还没有知识图谱，掌握度暂时算不出来；阅读和交流照常记录。';
      }
      return '掌握度待验证；我会通过提问和练习，继续确认你的理解。';
    }
    return '已评估 ' + this.touchedCount() + ' 个概念，平均掌握度 ' + Math.round(average * 100) + '%。';
  }

  @Builder
  mirrorPulse() {
    Column({ space: NxGrid * 2 }) {
      Row() {
        Text('当前镜像')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .letterSpacing(1)
        Blank()
        Text(this.facets.length > 0 ? '可反驳' : '正在成形')
          .fontSize(NxFontSize.xs)
          .fontColor(this.facets.length > 0 ? this.palette().primary : this.palette().text3)
      }
      .width('100%')
      if (this.activity !== null) {
        Text(this.activityLabel())
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text2)
          .lineHeight(19)
          .width('100%')
      }
      Text(this.assessmentLabel())
        .fontSize(NxFontSize.sm)
        .fontColor(this.palette().text3)
        .lineHeight(19)
        .width('100%')
      if (this.facets.length > 0) {
        Text(this.facets[0].claim)
          .fontSize(NxFontSize.xl)
          .fontFamily(NxFontFamily.serif)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text1)
          .lineHeight(25)
          .width('100%')
        Text('这条判断来自 ' + this.facets[0].evidence.length + ' 条学习信号，点“看依据”可以逐条核对。')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .lineHeight(18)
          .width('100%')
      } else if (this.touchedCount() > 0) {
        Text('我正在把你的学习轨迹拼成一张地图。')
          .fontSize(NxFontSize.xl)
          .fontFamily(NxFontFamily.serif)
          .fontColor(this.palette().text1)
          .lineHeight(25)
          .width('100%')
        Text('下一步可以再看「' + this.weakestConcept() + '」，看看哪些地方需要换一种讲法。')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .lineHeight(18)
          .width('100%')
      } else {
        Text('我正在认识你的学习方式。')
          .fontSize(NxFontSize.xl)
          .fontFamily(NxFontFamily.serif)
          .fontColor(this.palette().text1)
          .lineHeight(25)
          .width('100%')
        Text('阅读和交流会留下线索；关于理解程度的判断，要等更多验证。')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().text3)
          .lineHeight(18)
          .width('100%')
      }
    }
    .width('100%')
    .padding(NxGrid * 3)
    .borderRadius(NxRadius.md)
    .backgroundColor(this.palette().cardBg)
  }

  build() {
    Scroll() {
      Column({ space: NxGrid * 3 }) {
        if (this.entry !== null) {
          this.sectionTitle('这一条')
          this.thisEntry()
          // 「这一条」默认聚焦本条；整份镜像折叠为入口（2026-09-21 审查）。
          Text(this.showMirrorBelow ? '收起「它眼里的你」' : '展开「它眼里的你」')
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().primary)
            .padding({ top: NxGrid * 2, bottom: NxGrid * 2 })
            .onClick(() => {
              this.showMirrorBelow = !this.showMirrorBelow;
            })
        }

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

        if (this.entry === null || this.showMirrorBelow) {
        this.sectionTitle('它眼里的你')
        if (!this.loading && this.errorText.length === 0) {
          this.mirrorPulse()
        }
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
                  .fontColor(nxHeatTextColor(cell.mastery!, this.nxDark))
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
                Text(Math.round(cell.mastery! * 100) + '%')
                  .fontSize(NxFontSize.sm)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(nxHeatTextColor(cell.mastery!, this.nxDark))
              }
              .width('30%')
              .height(54)
              .padding(NxGrid * 2)
              .margin({ right: '3%', bottom: NxGrid * 2 })
              .borderRadius(NxRadius.xs)
              .backgroundColor(nxHeatColor(cell.mastery!, this.nxDark))
              .justifyContent(FlexAlign.SpaceBetween)
              .alignItems(HorizontalAlign.Start)
            }, (cell: MirrorMasteryCell) => cell.concept + '_' + cell.chapterName)
          }
          .width('100%')
        }
        if (!this.loading && this.untouchedCount() > 0) {
          Text('还有 ' + this.untouchedCount() + ' 个概念待验证；阅读记录会保留，掌握程度继续一起确认。')
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
