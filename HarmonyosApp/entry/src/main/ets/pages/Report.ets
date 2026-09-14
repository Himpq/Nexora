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
} from '../services/ReportApi';
import { SkeletonCard, EmptyState, ErrorState } from '../components/common/States';
import { nxPalette, NxPalette, NxRadius, NxGrid, NxFontSize, NxShadow } from '../theme/DesignTokens';

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
  @State relationCount: number = 0;
  @State tab: number = 0;
  @StorageProp('nxDarkMode') nxDark: boolean = false;
  private api: ReportApi = new ReportApi();
  private lectureId: string = '';
  private bookId: string = '';

  aboutToAppear(): void {
    const params = router.getParams() as ReportParams;
    if (params !== undefined && params !== null) {
      this.lectureId = params.lecture_id !== undefined ? params.lecture_id : '';
      this.bookId = params.book_id !== undefined ? params.book_id : '';
      this.lectureTitle = params.lecture_title !== undefined ? params.lecture_title : '';
    }
    this.load();
  }

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  async load(): Promise<void> {
    if (this.lectureId.length === 0) {
      this.errorText = '我不知道该给你看哪门课的报告。';
      return;
    }
    this.loading = true;
    this.errorText = '';
    try {
      const payload: ReportPayload = await this.api.getReport(this.lectureId, this.bookId);
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
      this.errorText = '报告我没取回来：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.loading = false;
    }
    this.loadGraph();
  }

  /** 知识图谱是附加信息，取不到不影响报告主线。 */
  async loadGraph(): Promise<void> {
    if (this.bookId.length === 0) {
      return;
    }
    try {
      const payload: GraphPayload = await this.api.getGraph(this.lectureId, this.bookId);
      if (payload.graph !== null && payload.graph !== undefined) {
        this.chapters = payload.graph.chapters !== undefined ? payload.graph.chapters : [];
        this.relationCount = payload.graph.relations !== undefined ? payload.graph.relations.length : 0;
      }
    } catch (err) {
      // 图谱未生成时静默：报告仍可看
    }
  }

  private accuracyLabel(): string {
    if (this.summary === null || this.summary.accuracy === null || this.summary.accuracy === undefined) {
      return '还没有稳定的正确率';
    }
    return Math.round(this.summary.accuracy * 100) + '%';
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
                this.metric('课程进度', this.summary.progress_percent + '%')
                this.metric('已读章节', this.summary.completed_chapters + '/' + this.summary.total_chapters)
                this.metric('学习时长', this.summary.study_hours + ' 小时')
              }
              .width('100%')
              Row() {
                this.metric('做过的题', String(this.summary.submitted_questions))
                this.metric('答对', String(this.summary.correct_questions))
                this.metric('正确率', this.accuracyLabel())
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

            if (this.weaknesses.length > 0) {
              this.noteList('我觉得你这里还薄弱', this.weaknesses, this.palette().warning)
            }
            if (this.recommendations.length > 0) {
              this.noteList('我建议你接下来', this.recommendations, this.palette().primary)
            }
          }

          if (this.tab === 1) {
            if (this.chapters.length === 0) {
              EmptyState({ text: '这本书的知识图谱我还没跑出来，跑完了会出现在这里。' })
            } else {
              Column({ space: NxGrid * 2 }) {
                Text('我从这本书里理出 ' + this.chapters.length + ' 章、' + this.relationCount + ' 条概念关系。')
                  .fontSize(NxFontSize.sm)
                  .fontColor(this.palette().text3)
                  .width('100%')
                ForEach(this.chapters, (chapter: GraphChapter, index: number) => {
                  Column({ space: NxGrid * 2 }) {
                    Text(chapter.name)
                      .fontSize(NxFontSize.lg)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.palette().text1)
                      .width('100%')
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
                          Text(concept.name)
                            .fontSize(NxFontSize.xs)
                            .fontColor(this.palette().primary)
                            .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
                            .borderRadius(NxRadius.xs)
                            .backgroundColor(this.palette().primarySoft)
                            .margin({ right: NxGrid, bottom: NxGrid })
                        }, (concept: GraphConcept, ci: number) => concept.name + '_' + ci)
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
