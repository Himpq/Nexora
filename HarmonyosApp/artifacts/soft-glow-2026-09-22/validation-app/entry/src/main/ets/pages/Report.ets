/**
 * 学习报告与知识图谱（端内页）。
 *
 * 原先书房与面二的这两个入口都把后端拼的 entry 网页丢给系统浏览器打开——
 * 既跳出 App，也让「端侧 Agent」的说服力落空，且违反 §11.3 的浏览器跳转零命中要求。
 * 这里用 ArkUI 端内实现。
 *
 * 数据：ReportApi（/api/frontend/learning/report 与 /api/frontend/knowledge-graph）。
 * 文案遵守 §7：第一人称，不用功能式话术。
 */
import { router } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  ReportApi,
  ReportPayload,
  ReportSummary,
  ReportNote,
  GraphPayload,
  GraphChapter,
  GraphConcept,
  GraphRelation,
} from '../services/ReportApi';
import { SkeletonCard, EmptyState, ErrorState } from '../components/common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxShadow } from '../theme/DesignTokens';
import { AgentApi, AgentEnvelope, ContextData } from '../services/AgentApi';
import { ReaderApi } from '../services/ReaderApi';
import { nxLastBook } from '../services/ReadingState';

class ReportParams {
  lecture_id: string = '';
  book_id: string = '';
  lecture_title: string = '';
}

@Entry
@Component
struct Report {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State lectureTitle: string = '';
  @State summary: ReportSummary | null = null;
  @State weaknesses: ReportNote[] = [];
  @State recommendations: ReportNote[] = [];
  @State chapters: GraphChapter[] = [];
  @State relations: GraphRelation[] = [];
  @State relationCount: number = 0;
  @State bookCoverage: number = -1;
  @State courseCoverage: number = -1;
  @State tab: number = 0;
  /** 图谱状态：idle | loading | ready | empty | error。 */
  @State graphState: string = 'idle';
  @State graphError: string = '';
  @State graphLoadedAt: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  @StorageProp('nxStudyTick') @Watch('onStudyChanged') studyTick: number = 0;
  private api: ReportApi = new ReportApi();
  private agentApi: AgentApi = new AgentApi();
  private readerApi: ReaderApi = new ReaderApi();
  private lectureId: string = '';
  private bookId: string = '';
  private loadVersion: number = 0;
  private attached: boolean = false;

  aboutToAppear(): void {
    this.attached = true;
    const params = router.getParams() as ReportParams;
    if (params !== undefined && params !== null) {
      this.lectureId = params.lecture_id !== undefined ? params.lecture_id : '';
      this.bookId = params.book_id !== undefined ? params.book_id : '';
      this.lectureTitle = params.lecture_title !== undefined ? params.lecture_title : '';
    }
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

  onPageShow(): void {
    if (this.summary !== null) {
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
      await this.readerApi.flushReadingProgress();
      await this.resolveTarget();
      if (version !== this.loadVersion) {
        return;
      }
      const payload: ReportPayload = await this.api.getReport(this.lectureId, this.bookId);
      if (version !== this.loadVersion) {
        return;
      }
      if (payload.success !== true) {
        throw new Error(payload.error !== undefined ? payload.error : '报告没取回来');
      }
      this.summary = payload.summary;
      this.weaknesses = payload.weaknesses !== undefined ? payload.weaknesses : [];
      this.recommendations = payload.recommendations !== undefined ? payload.recommendations : [];
      if (this.lectureTitle.length === 0) {
        this.lectureTitle = payload.lecture_title;
      }
    } catch (err) {
      const e = err as BusinessError;
      if (version === this.loadVersion) {
        this.errorText = '报告我没取回来：' + (e.message.length > 0 ? e.message : '网络错误');
      }
    } finally {
      if (version === this.loadVersion) {
        this.loading = false;
      }
    }
    if (version === this.loadVersion) {
      this.loadGraph(version);
    }
  }

  private async resolveTarget(): Promise<void> {
    if (this.lectureId.length > 0 && this.bookId.length > 0) {
      return;
    }
    const env: AgentEnvelope = await this.agentApi.getContext();
    const context: ContextData = env.data as ContextData;
    const last = nxLastBook();
    const wanted = this.lectureId.length > 0 ? this.lectureId : (last !== null ? last.lectureId : '');
    for (const lecture of context.lectures) {
      if (wanted.length > 0 && lecture.id !== wanted) {
        continue;
      }
      this.lectureId = lecture.id;
      this.lectureTitle = lecture.title;
      this.bookId = lecture.books.length > 0 ? lecture.books[0].id : '';
      if (last !== null && last.lectureId === lecture.id) {
        for (const book of lecture.books) {
          if (book.id === last.bookId) {
            this.bookId = book.id;
          }
        }
      }
      return;
    }
    if (this.lectureId.length === 0 && context.lectures.length > 0) {
      this.lectureId = context.lectures[0].id;
      this.lectureTitle = context.lectures[0].title;
      this.bookId = context.lectures[0].books.length > 0 ? context.lectures[0].books[0].id : '';
      return;
    }
    throw new Error('选好一门课程后，我会把阅读和练习记录整理在这里。');
  }

  /** 知识图谱是附加信息，取不到不影响报告主线；但要分清「没生成」与「取失败」（2026-09-21 审查 F16）。 */
  async loadGraph(version: number = this.loadVersion): Promise<void> {
    if (this.bookId.length === 0) {
      return;
    }
    this.graphState = 'loading';
    try {
      const payload: GraphPayload = await this.api.getGraph(this.lectureId, this.bookId);
      if (version !== this.loadVersion) {
        return;
      }
      if (payload.graph !== null && payload.graph !== undefined) {
        this.chapters = payload.graph.chapters !== undefined ? payload.graph.chapters : [];
        this.relations = payload.graph.relations !== undefined ? payload.graph.relations : [];
        this.relationCount = this.relations.length;
        this.bookCoverage = payload.graph.book_reading_progress_percent !== undefined ? payload.graph.book_reading_progress_percent : -1;
        this.courseCoverage = payload.graph.course_reading_progress_percent !== undefined ? payload.graph.course_reading_progress_percent : -1;
        this.graphState = this.chapters.length > 0 ? 'ready' : 'empty';
        this.graphLoadedAt = Date.now();
      } else {
        this.graphState = 'empty';
      }
    } catch (err) {
      if (version !== this.loadVersion) {
        return;
      }
      const e = err as BusinessError;
      this.graphState = 'error';
      this.graphError = e.message.length > 0 ? e.message : '网络错误';
    }
  }

  private graphStatusText(): string {
    if (this.graphState === 'loading') {
      return '正在取这本书的概念关系…';
    }
    if (this.graphState === 'error') {
      return '概念关系这次没取到：' + this.graphError +
        (this.graphLoadedAt > 0 ? '。下面是上次取到的版本。' : '');
    }
    return '';
  }

  private accuracyLabel(): string {
    if (this.summary === null || this.summary.accuracy === null || this.summary.accuracy === undefined) {
      return '还没有稳定的正确率';
    }
    return Math.round(this.summary.accuracy * 100) + '%';
  }

  private percentLabel(value: number): string {
    return value > 0 && value < 0.1 ? '<0.1%' : Math.round(value * 10) / 10 + '%';
  }

  private readingLabel(): string {
    if (this.summary === null) {
      return '0%';
    }
    return this.percentLabel(this.summary.reading_progress_percent !== undefined ? this.summary.reading_progress_percent : this.summary.progress_percent);
  }

  /** 口径同屏：顶部三格是「本书」，右侧补一句「本课程 x%」，避免与书房的课程级数字看起来矛盾。 */
  private scopeCaption(): string {
    if (this.summary === null) {
      return '';
    }
    const scope = this.summary.scope_label !== undefined && this.summary.scope_label.length > 0 ? this.summary.scope_label : '本书';
    const course = this.summary.course_reading_progress_percent;
    if (scope !== '本课程' && course !== undefined && course !== null) {
      return '以上按' + scope + '统计 · 本课程整体阅读覆盖 ' + this.percentLabel(course);
    }
    return '以上按' + scope + '统计';
  }

  private relationLabel(type: string): string {
    if (type === 'prerequisite') {
      return '先修';
    }
    if (type === 'related') {
      return '相关';
    }
    if (type === 'contrast') {
      return '对比';
    }
    if (type === 'applies') {
      return '应用';
    }
    if (type === 'extends') {
      return '扩展';
    }
    if (type === 'part_of') {
      return '属于';
    }
    return type;
  }

  private conceptTone(concept: GraphConcept): string {
    if (concept.status === 'stable') {
      return this.palette().success;
    }
    if (concept.status === 'at_risk') {
      return this.palette().danger;
    }
    if (concept.status === 'developing') {
      return this.palette().warning;
    }
    return this.palette().primary;
  }

  /** 图谱章节 → 阅读器（章序号来自后端 chapter_index，缺失时按列表位置）。 */
  private chapterIndexOf(chapter: GraphChapter): number {
    if (chapter.chapter_index !== undefined && chapter.chapter_index >= 0) {
      return chapter.chapter_index;
    }
    return this.chapters.indexOf(chapter);
  }

  openChapter(chapter: GraphChapter): void {
    const params: Record<string, Object> = {
      'lecture_id': this.lectureId,
      'book_id': this.bookId,
      'book_title': '',
      'chapter_index': this.chapterIndexOf(chapter),
      'chapter_name': chapter.name,
    };
    router.pushUrl({ url: 'pages/Reader', params: params });
  }

  openReview(chapter: GraphChapter): void {
    const params: Record<string, Object> = {
      'lecture_id': this.lectureId,
      'book_id': this.bookId,
      'chapter_index': this.chapterIndexOf(chapter),
    };
    router.pushUrl({ url: 'pages/TodayTask', params: params });
  }

  private durationLabel(): string {
    if (this.summary === null) {
      return '0 秒';
    }
    if (this.summary.reading_seconds === undefined) {
      return this.summary.study_hours + ' 小时';
    }
    const seconds = this.summary.reading_seconds;
    return seconds < 60 ? Math.round(seconds) + ' 秒' : Math.round(seconds / 6) / 10 + ' 分钟';
  }

  @Builder
  metric(label: string, value: string) {
    Column({ space: 2 }) {
      Text(value)
        .fontSize(NxFontSize.h)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
      Text(label)
        .fontSize(NxFontSize.xs)
        .fontColor(this.palette().text3)
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  noteList(title: string, notes: ReportNote[], accent: string) {
    Column({ space: NxGrid * 2 }) {
      Text(title)
        .fontSize(NxFontSize.xl)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.palette().text1)
        .width('100%')
      ForEach(notes, (note: ReportNote, index: number) => {
        Column({ space: NxGrid }) {
          Text(note.title)
            .fontSize(NxFontSize.md)
            .fontWeight(FontWeight.Medium)
            .fontColor(accent)
            .width('100%')
          Text(note.detail)
            .fontSize(NxFontSize.sm)
            .fontColor(this.palette().text2)
            .lineHeight(19)
            .width('100%')
        }
        .width('100%')
        .padding(NxGrid * 3)
        .borderRadius(NxRadius.sm)
        .backgroundColor(this.palette().surface2)
      }, (note: ReportNote, index: number) => note.title + '_' + index)
    }
    .width('100%')
    .padding(NxGrid * 4)
    .borderRadius(NxRadius.md)
    .backgroundColor(this.palette().cardBg)
    .shadow({
      radius: NxShadow.level1.radius,
      color: NxShadow.level1.color,
      offsetX: NxShadow.level1.offsetX,
      offsetY: NxShadow.level1.offsetY,
    })
  }

  build() {
    Column() {
      Row({ space: NxGrid * 2 }) {
        Text('返回')
          .fontSize(NxFontSize.sm)
          .fontColor(this.palette().primary)
          .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
          .onClick(() => {
            router.back();
          })
        Text(this.lectureTitle.length > 0 ? this.lectureTitle : '学习报告')
          .fontSize(NxFontSize.h)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.palette().text1)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .padding({ bottom: NxGrid * 2 })

      Row({ space: NxGrid * 2 }) {
        ForEach(['报告', '知识图谱'], (name: string, index: number) => {
          Text(name)
            .fontSize(NxFontSize.md)
            .fontWeight(this.tab === index ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(this.tab === index ? this.palette().primary : this.palette().text3)
            .padding({ left: NxGrid * 3, right: NxGrid * 3, top: NxGrid * 2, bottom: NxGrid * 2 })
            .borderRadius(NxRadius.xs)
            .backgroundColor(this.tab === index ? this.palette().primarySoft : this.palette().pageBg)
            .onClick(() => {
              this.tab = index;
            })
        }, (name: string) => name)
        Blank()
      }
      .width('100%')

      Scroll() {
        Column({ space: NxGrid * 3 }) {
          if (this.loading) {
            SkeletonCard()
            SkeletonCard()
          }

          if (this.errorText.length > 0) {
            ErrorState({ message: this.errorText, onRetry: (): void => {
              this.load();
            } })
          }

          if (this.tab === 0 && this.summary !== null) {
            Column({ space: NxGrid * 3 }) {
              Row() {
                this.metric('阅读覆盖（' + (this.summary.scope_label !== undefined ? this.summary.scope_label : '本书') + '）', this.readingLabel())
                this.metric('确认读完', this.summary.completed_chapters + '/' + this.summary.total_chapters + ' 章')
                this.metric('前台阅读', this.durationLabel())
              }
              .width('100%')
              Row() {
                this.metric('做过的题', String(this.summary.submitted_questions))
                this.metric('答对', String(this.summary.correct_questions))
                this.metric('正确率', this.accuracyLabel())
              }
              .width('100%')
              Text(this.scopeCaption())
                .fontSize(NxFontSize.xs)
                .fontColor(this.palette().text3)
                .width('100%')
            }
            .width('100%')
            .padding(NxGrid * 4)
            .borderRadius(NxRadius.md)
            .backgroundColor(this.palette().cardBg)
            .shadow({
              radius: NxShadow.level1.radius,
              color: NxShadow.level1.color,
              offsetX: NxShadow.level1.offsetX,
              offsetY: NxShadow.level1.offsetY,
            })

            if (this.weaknesses.length > 0) {
              this.noteList('我觉得你这里还薄弱', this.weaknesses, this.palette().warning)
            }
            if (this.recommendations.length > 0) {
              this.noteList('我建议你接下来', this.recommendations, this.palette().primary)
            }
          }

          if (this.tab === 1) {
            if (this.graphStatusText().length > 0) {
              Row({ space: NxGrid * 2 }) {
                Text(this.graphStatusText())
                  .fontSize(NxFontSize.sm)
                  .fontColor(this.graphState === 'error' ? this.palette().danger : this.palette().text3)
                  .lineHeight(18)
                  .layoutWeight(1)
                if (this.graphState === 'error') {
                  Button('重试')
                    .height(36)
                    .fontSize(NxFontSize.sm)
                    .backgroundColor(this.palette().surface3)
                    .fontColor(this.palette().text2)
                    .onClick(() => {
                      this.loadGraph(this.loadVersion);
                    })
                }
              }
              .width('100%')
            }
            if (this.chapters.length === 0) {
              if (this.graphState === 'empty') {
                EmptyState({ text: '阅读记录已经单独保存；这本书的概念关系还没整理出来，整理好后会出现在这里。' })
              } else if (this.graphState !== 'loading' && this.graphState !== 'error') {
                EmptyState({ text: '阅读记录已经单独保存；这本书的概念关系整理好后，会出现在这里。' })
              }
            } else {
              Column({ space: NxGrid * 2 }) {
                Text('我从这本书里理出 ' + this.chapters.length + ' 章、' + this.relationCount + ' 条概念关系。' +
                  (this.bookCoverage >= 0 ? '本书阅读覆盖 ' + this.percentLabel(this.bookCoverage) : '') +
                  (this.courseCoverage >= 0 && this.courseCoverage !== this.bookCoverage ? ' · 本课程 ' + this.percentLabel(this.courseCoverage) : ''))
                  .fontSize(NxFontSize.sm)
                  .fontColor(this.palette().text3)
                  .width('100%')
                if (this.relations.length > 0) {
                  Column({ space: NxGrid }) {
                    Text('概念之间的关系')
                      .fontSize(NxFontSize.md)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.palette().text1)
                      .width('100%')
                    ForEach(this.relations, (rel: GraphRelation, ri: number) => {
                      Row({ space: NxGrid }) {
                        Text(rel.from)
                          .fontSize(NxFontSize.sm)
                          .fontColor(this.palette().text2)
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                        Text('— ' + this.relationLabel(rel.type) + ' →')
                          .fontSize(NxFontSize.xs)
                          .fontColor(this.palette().primary)
                        Text(rel.to)
                          .fontSize(NxFontSize.sm)
                          .fontColor(this.palette().text2)
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                      }
                      .width('100%')
                    }, (rel: GraphRelation, ri: number) => rel.from + '_' + rel.to + '_' + ri)
                  }
                  .width('100%')
                  .padding(NxGrid * 3)
                  .borderRadius(NxRadius.sm)
                  .backgroundColor(this.palette().cardBg)
                }
                ForEach(this.chapters, (chapter: GraphChapter, index: number) => {
                  Column({ space: NxGrid * 2 }) {
                    Text(chapter.name)
                      .fontSize(NxFontSize.lg)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.palette().text1)
                      .width('100%')
                    if (chapter.reading_percent !== undefined) {
                      Text('本章阅读覆盖 ' + this.percentLabel(chapter.reading_percent!) + (chapter.completed === true ? ' · 已确认读完' : ' · 尚未确认读完'))
                        .fontSize(NxFontSize.sm)
                        .fontColor(this.palette().text3)
                        .width('100%')
                    }
                    if (chapter.summary !== undefined && chapter.summary.length > 0) {
                      Text(chapter.summary)
                        .fontSize(NxFontSize.sm)
                        .fontColor(this.palette().text3)
                        .lineHeight(19)
                        .maxLines(3)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%')
                    }
                    Flex({ wrap: FlexWrap.Wrap }) {
                      ForEach(chapter.concepts !== undefined ? chapter.concepts : [],
                        (concept: GraphConcept, ci: number) => {
                          Text(concept.name + (concept.mastery !== undefined && concept.mastery !== null ? ' ' + Math.round(concept.mastery * 100) + '%' : ''))
                            .fontSize(NxFontSize.xs)
                            .fontColor(this.conceptTone(concept))
                            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
                            .borderRadius(NxRadius.xs)
                            .backgroundColor(this.palette().primarySoft)
                            .margin({ right: NxGrid, bottom: NxGrid })
                            .onClick(() => {
                              // 概念标签的下一步（2026-09-21 审查）：进入该章原文。
                              this.openChapter(chapter);
                            })
                        }, (concept: GraphConcept, ci: number) => concept.name + '_' + ci)
                    }
                    .width('100%')
                    Row({ space: NxGrid * 2 }) {
                      Text('去读这一章')
                        .fontSize(NxFontSize.xs)
                        .fontColor(this.palette().primary)
                        .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
                        .borderRadius(NxRadius.xs)
                        .backgroundColor(this.palette().cardBgRaised)
                        .onClick(() => {
                          this.openChapter(chapter);
                        })
                      Text('练这一章')
                        .fontSize(NxFontSize.xs)
                        .fontColor(this.palette().primary)
                        .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid * 2, bottom: NxGrid * 2 })
                        .borderRadius(NxRadius.xs)
                        .backgroundColor(this.palette().cardBgRaised)
                        .onClick(() => {
                          this.openReview(chapter);
                        })
                    }
                    .width('100%')
                  }
                  .width('100%')
                  .padding(NxGrid * 4)
                  .borderRadius(NxRadius.md)
                  .backgroundColor(this.palette().cardBg)
                  .shadow({
                    radius: NxShadow.level1.radius,
                    color: NxShadow.level1.color,
                    offsetX: NxShadow.level1.offsetX,
                    offsetY: NxShadow.level1.offsetY,
                  })
                }, (chapter: GraphChapter, index: number) => chapter.name + '_' + index)
              }
              .width('100%')
            }
          }
        }
        .width('100%')
        .padding({ top: NxGrid * 3, bottom: NxGrid * 6 })
      }
      .layoutWeight(1)
      .width('100%')
      .align(Alignment.TopStart)
    }
    .width('100%')
    .height('100%')
    .padding({ left: NxGrid * 4, right: NxGrid * 4, top: NxGrid * 3 })
    .backgroundColor(this.palette().pageBg)
  }
}
