import { LearningAgentApi, agentFailure, NO_AGENT_TARGET } from '../../common/LearningAgentApi';
import { LearnTarget, ReportPayload, ReportSummary, ReportNote, GraphChapter, GraphConcept, GraphRelation } from '../../common/LearningAgentModels';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder, ProgressTrack, SectionHeader, TagPill } from '../learning/LearningWidgets';
import { LearningAgentNavigationNotice } from './LearningAgentNavigationNotice';

// Reading facts and assessment evidence stay separate, even when shown in the same workspace.
@Component
export struct LearningAgentReport {
    @Prop @Watch('onTargetChanged') target: LearnTarget = NO_AGENT_TARGET;
    @Prop @Watch('onVisibleChanged') visible: boolean = true;
    @Prop embedded: boolean = false;
    @Prop navigationOpening: boolean = false;
    @Prop navigationError: string = '';
    @Prop navigationLabel: string = '正在打开教材…';
    @StorageProp('nxLearningBridgeTick') @Watch('onBridgeChanged') private bridgeTick: number = 0;
    @StorageProp('insetBottom') private insetBottom: number = 0;
    onBack: () => void = () => {};
    onRead: (target: LearnTarget) => void = () => {};
    onReview: (target: LearnTarget) => void = () => {};
    @State private loading: boolean = true;
    @State private graphLoading: boolean = true;
    @State private errorText: string = '';
    @State private graphError: string = '';
    @State private summary: ReportSummary | null = null;
    @State private weaknesses: ReportNote[] = [];
    @State private recommendations: ReportNote[] = [];
    @State private chapters: GraphChapter[] = [];
    @State private relations: GraphRelation[] = [];
    @State private graphExpanded: boolean = false;
    @State private graphEpoch: number = 0;
    private version: number = 0;
    private alive: boolean = false;

    aboutToAppear(): void {
        this.alive = true;
        void this.load();
    }

    aboutToDisappear(): void {
        this.alive = false;
        this.version++;
    }

    private onTargetChanged(): void {
        this.version++;
        this.summary = null;
        this.weaknesses = [];
        this.recommendations = [];
        this.chapters = [];
        this.relations = [];
        this.graphExpanded = false;
        if (this.alive && this.visible) {
            void this.load();
        }
    }

    private onVisibleChanged(): void {
        if (!this.visible) {
            this.version++;
            this.loading = false;
            this.graphLoading = false;
        } else if (this.alive) {
            void this.load();
        }
    }

    private onBridgeChanged(): void {
        if (this.visible && this.alive) {
            void this.load();
        }
    }

    private async load(): Promise<void> {
        if (!this.alive || !this.visible) {
            return;
        }
        const version: number = ++this.version;
        this.errorText = '';
        this.graphError = '';
        if (this.target.lecture_id.length === 0) {
            this.loading = false;
            this.graphLoading = false;
            return;
        }
        this.loading = true;
        void this.loadGraph(version);
        try {
            const data: ReportPayload = await LearningAgentApi.getReport(this.target);
            if (!this.alive || version !== this.version) {
                return;
            }
            if (data.success === false) {
                throw new Error(data.error || '学习记录暂时未能加载，请稍后重试');
            }
            this.summary = data.summary;
            this.weaknesses = data.weaknesses || [];
            this.recommendations = data.recommendations || [];
        } catch (error) {
            if (this.alive && version === this.version) {
                this.errorText = agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.version) {
                this.loading = false;
            }
        }
    }

    private async loadGraph(version: number): Promise<void> {
        this.graphLoading = true;
        this.graphError = '';
        try {
            const data = await LearningAgentApi.getGraph(this.target);
            if (!this.alive || version !== this.version) {
                return;
            }
            if (data.success === false) {
                throw new Error('概念关系暂时未能加载，请稍后重试');
            }
            this.chapters = data.graph !== null ? data.graph.chapters || [] : [];
            this.relations = data.graph !== null ? data.graph.relations || [] : [];
            this.graphEpoch++;
        } catch (error) {
            if (this.alive && version === this.version) {
                this.graphError = agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.version) {
                this.graphLoading = false;
            }
        }
    }

    private chapterTarget(chapter: GraphChapter, index: number): LearnTarget {
        return { lecture_id: this.target.lecture_id, lecture_title: this.target.lecture_title,
            book_id: this.target.book_id, book_title: this.target.book_title,
            chapter_index: chapter.chapter_index !== undefined ? chapter.chapter_index : index,
            chapter_name: chapter.name, chapter_range: '' };
    }

    private hasReadingTarget(): boolean {
        return this.target.lecture_id.length > 0 && this.target.book_id.length > 0;
    }

    private scopeLabel(): string {
        return this.summary !== null && this.summary.scope_label
            ? this.summary.scope_label : this.target.book_id.length > 0 ? '本书' : '本课程';
    }

    private readingPercent(): number {
        if (this.summary === null) {
            return 0;
        }
        const percent: number = this.summary.reading_progress_percent !== undefined
            ? this.summary.reading_progress_percent : this.summary.progress_percent;
        return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    }

    private readingLabel(): string {
        if (this.summary === null || this.summary.total_chapters <= 0) {
            return '暂无章节记录';
        }
        return this.summary.completed_chapters + ' / ' + this.summary.total_chapters + ' 章已读完';
    }

    private readingDetail(): string {
        if (this.summary === null) { return ''; }
        const details: string[] = [];
        const seconds: number | undefined = this.summary.reading_seconds;
        if (seconds !== undefined && Number.isFinite(seconds) && seconds >= 0) {
            const minutes: number = Math.floor(seconds / 60);
            const hours: number = Math.floor(minutes / 60);
            const duration: string = seconds === 0 ? '0 分钟' : seconds < 60 ? '不足 1 分钟' :
                hours > 0 ? hours + ' 小时' + (minutes % 60 > 0 ? ' ' + minutes % 60 + ' 分钟' : '') : minutes + ' 分钟';
            details.push('累计阅读 ' + duration);
        }
        const chapters: number | undefined = this.summary.read_chapters;
        if (chapters !== undefined && Number.isFinite(chapters) && chapters > 0) {
            details.push('读过 ' + Math.floor(chapters) + ' 章');
        }
        return details.join(' · ');
    }

    private hasAssessment(): boolean {
        return this.summary !== null && this.summary.submitted_questions > 0 &&
            this.summary.accuracy !== null && this.summary.accuracy !== undefined &&
            Number.isFinite(this.summary.accuracy);
    }

    private accuracyLabel(): string {
        if (!this.hasAssessment() || this.summary === null || this.summary.accuracy === null) {
            return this.summary !== null && this.summary.submitted_questions > 0 ? '作答待反馈' : '尚未测评';
        }
        return '正确率 ' + Math.round(Math.max(0, Math.min(1, this.summary.accuracy)) * 100) + '%';
    }

    private assessmentDetail(): string {
        if (this.summary === null || this.summary.submitted_questions <= 0) {
            return '完成小测后，这里会补充理解情况。';
        }
        return '已提交 ' + this.summary.submitted_questions + ' 题' +
            (this.summary.reviewed_questions > 0 ? ' · 已批阅 ' + this.summary.reviewed_questions + ' 题' : '');
    }

    private conceptLabel(concept: GraphConcept): string {
        if (concept.status === 'unknown' || concept.status === 'unverified' ||
            concept.mastery === undefined || concept.mastery === null ||
            !Number.isFinite(concept.mastery) || concept.assessed_count === 0) {
            return concept.status === 'unverified' ? '读过，待验证' : '尚未测评';
        }
        if (concept.status === 'at_risk') {
            return '建议再练习';
        }
        if (concept.status === 'stable') {
            return '目前较稳定';
        }
        return '理解发展中';
    }

    private chapterReadingLabel(chapter: GraphChapter): string {
        if (chapter.completed === true) {
            return '已确认读完';
        }
        if (chapter.reading_percent !== undefined && Number.isFinite(chapter.reading_percent) &&
            chapter.reading_percent > 0) {
            return '阅读覆盖 ' + Math.round(Math.min(100, chapter.reading_percent)) + '%';
        }
        return '尚无阅读记录';
    }

    @Builder
    Header() {
        Row({ space: Space.sm }) {
            IconButton({
                icon: $r('app.media.ic_back'), tint: $r('app.color.icon_primary'),
                onTap: () => { this.onBack(); }
            }).id('agent_report_back').accessibilityText('返回 Agent');
            Text('学习情况')
                .fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).layoutWeight(1);
            IconButton({
                icon: $r('app.media.ic_refresh'), tint: $r('app.color.icon_primary'),
                isEnabled: !this.loading && !this.graphLoading,
                onTap: () => { void this.load(); }
            }).id('agent_report_refresh').accessibilityText('刷新学习情况');
        }
        .width('100%').padding({ left: Space.xs, right: Space.sm, top: Space.xs, bottom: Space.xs });
    }

    @Builder
    ContentHeading() {
        Row({ space: Space.sm }) {
            Column({ space: Space.xs }) {
                Text(this.target.book_title || this.target.lecture_title || '你的学习记录')
                    .fontSize(FontSize.titleLarge).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).width('100%');
                Text('读过的内容，与理解的情况分开看')
                    .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }.layoutWeight(1).alignItems(HorizontalAlign.Start);
            if (this.embedded) {
                IconButton({
                    icon: $r('app.media.ic_refresh'), tint: $r('app.color.icon_secondary'),
                    isEnabled: !this.loading && !this.graphLoading,
                    onTap: () => { void this.load(); }
                }).id('agent_report_embedded_refresh').accessibilityText('刷新学习情况');
            }
        }.width('100%').alignItems(VerticalAlign.Center);
    }

    @Builder
    SummaryCards() {
        Column({ space: Space.md }) {
            Row() {
                SectionHeader({ title: '阅读事实' }).layoutWeight(1);
                TagPill({ text: this.scopeLabel(), tint: $r('app.color.text_brand'), bg: $r('app.color.brand_soft') });
            }.width('100%');
            Text(this.readingLabel()).fontSize(FontSize.titleLarge).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).width('100%').id('agent_report_reading_summary');
            if (this.readingDetail().length > 0) {
                Text(this.readingDetail()).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_secondary')).width('100%').id('agent_report_reading_detail');
            }
            if (this.summary !== null && this.summary.total_chapters > 0) {
                ProgressTrack({ ratio: this.readingPercent() / 100 });
                Text('阅读覆盖 ' + Math.round(this.readingPercent() * 10) / 10 + '%')
                    .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%');
            }
            Text('阅读进度记录你读过什么。读完之后，可以用小测了解理解情况。')
                .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary')).width('100%');
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));

        Column({ space: Space.md }) {
            SectionHeader({ title: '作答与理解' });
            Text(this.accuracyLabel()).fontSize(FontSize.titleLarge).fontWeight(FontWeight.Medium)
                .fontColor(this.hasAssessment() ? $r('app.color.text_brand') : $r('app.color.text_primary'))
                .width('100%').id('agent_report_assessment_summary');
            Text(this.assessmentDetail()).fontSize(FontSize.body).lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_secondary')).width('100%');
            if (this.hasAssessment()) {
                Text('这是已有作答的反馈，理解情况会随着新的记录更新。')
                    .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    ErrorCard(title: string, detail: string, controlId: string) {
        Column({ space: Space.sm }) {
            Text(title).fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).width('100%');
            Text(detail).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary')).width('100%');
            if (this.summary !== null) {
                Text('已加载的记录仍可查看。').fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }
            Button('重新加载', { type: ButtonType.Normal })
                .fontSize(FontSize.body).fontColor($r('app.color.text_brand'))
                .backgroundColor($r('app.color.brand_soft')).borderRadius(Radius.md)
                .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.lg, right: Space.lg })
                .enabled(!this.loading && !this.graphLoading)
                .id(controlId).onClick(() => { void this.load(); });
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    NoteSection(title: string, showWeaknesses: boolean) {
        Column({ space: Space.md }) {
            SectionHeader({ title: title });
            ForEach(showWeaknesses ? this.weaknesses : this.recommendations, (note: ReportNote) => {
                Column({ space: Space.xs }) {
                    Text(note.title).fontSize(FontSize.body).fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary')).width('100%');
                    if (note.detail.length > 0) {
                        Text(note.detail).fontSize(FontSize.body).lineHeight(LineHeight.body)
                            .fontColor($r('app.color.text_secondary')).width('100%');
                    }
                }.width('100%').alignItems(HorizontalAlign.Start);
            }, (note: ReportNote, index: number) => note.title + ':' + note.detail + ':' + index);
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    TargetActions(currentTarget: () => LearnTarget, controlPrefix: string) {
        Row({ space: Space.md }) {
            Button('继续阅读', { type: ButtonType.Normal })
                .fontSize(FontSize.body).fontColor($r('app.color.text_brand'))
                .backgroundColor($r('app.color.brand_soft')).borderRadius(Radius.md)
                .constraintSize({ minHeight: Size.touchTarget }).layoutWeight(1)
                .enabled(!this.navigationOpening)
                .id(controlPrefix + '_read').onClick(() => { this.onRead(currentTarget()); });
            Button('复习这一章', { type: ButtonType.Normal })
                .fontSize(FontSize.body).fontColor($r('app.color.text_inverse'))
                .backgroundColor($r('app.color.brand_primary')).borderRadius(Radius.md)
                .constraintSize({ minHeight: Size.touchTarget }).layoutWeight(1)
                .enabled(!this.navigationOpening)
                .id(controlPrefix + '_review').onClick(() => { this.onReview(currentTarget()); });
        }.width('100%');
    }

    @Builder
    ChapterCard(chapter: GraphChapter, index: number) {
        Column({ space: Space.md }) {
            Text(chapter.name).fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).width('100%');
            Text(this.chapterReadingLabel(chapter)).fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary')).width('100%');
            if (chapter.summary.length > 0) {
                Text(chapter.summary).fontSize(FontSize.body).lineHeight(LineHeight.body)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }
            if ((chapter.concepts || []).length === 0) {
                Text('暂时没有这一章的概念记录。').fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }
            ForEach(chapter.concepts || [], (concept: GraphConcept) => {
                Column({ space: Space.xs }) {
                    Text(concept.name).fontSize(FontSize.body).fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary')).width('100%');
                    Text(this.conceptLabel(concept) +
                        (concept.assessed_count !== undefined && concept.assessed_count > 0
                            ? ' · ' + concept.assessed_count + ' 条测评依据' : ''))
                        .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                        .fontColor($r('app.color.text_secondary')).width('100%');
                    if (concept.detail) {
                        Text(concept.detail).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                            .fontColor($r('app.color.text_secondary')).width('100%');
                    }
                }.width('100%').padding(Space.md).alignItems(HorizontalAlign.Start)
                    .borderRadius(Radius.md).backgroundColor($r('app.color.bg_sunken'));
            }, (concept: GraphConcept, conceptIndex: number) => (concept.concept_id || concept.name) + ':' + conceptIndex);
            if (this.hasReadingTarget()) {
                this.TargetActions((): LearnTarget => this.chapterTarget(chapter, index), 'agent_report_chapter_' + index);
            }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
    }

    @Builder
    GraphSection() {
        Column({ space: Space.md }) {
            Button({ type: ButtonType.Normal }) {
                Row({ space: Space.sm }) {
                    Column({ space: Space.xs }) {
                        Text('章节与概念关系').fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium)
                            .fontColor($r('app.color.text_primary')).width('100%');
                        Text(this.graphExpanded ? '按章节查看理解情况与知识关联' : '展开查看每一章的记录')
                            .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%');
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start);
                    Image(this.graphExpanded ? $r('app.media.ic_chevron_up') : $r('app.media.ic_chevron_down'))
                        .width(Size.icon).height(Size.icon).fillColor($r('app.color.icon_secondary'));
                }.width('100%').padding(Space.lg);
            }.width('100%').borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
                .id('agent_report_graph_toggle').onClick(() => { this.graphExpanded = !this.graphExpanded; });
            if (this.graphExpanded) {
                if (this.graphLoading) {
                    LoadingBlock({ label: '正在同步概念关系' }).id('agent_report_graph_loading');
                }
                if (this.graphError.length > 0) {
                    this.ErrorCard('概念关系暂时不可用', this.graphError, 'agent_report_graph_retry');
                } else if (!this.graphLoading && this.chapters.length === 0) {
                    Placeholder({ icon: $r('app.media.ic_book'), title: '还没有概念关系',
                        hint: '可以先继续阅读，已有学习记录会保留。' })
                        .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card')).id('agent_report_graph_empty');
                }
                ForEach(this.chapters, (chapter: GraphChapter, index: number) => {
                    this.ChapterCard(chapter, index);
                }, (chapter: GraphChapter, index: number) => chapter.name + ':' + index + ':' + this.graphEpoch);
                if (this.relations.length > 0) {
                    Column({ space: Space.md }) {
                        SectionHeader({ title: '概念之间的联系' });
                        ForEach(this.relations, (relation: GraphRelation) => {
                            Column({ space: Space.xs }) {
                                Text(relation.from + ' → ' + relation.to).fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary')).lineHeight(LineHeight.body).width('100%');
                                if (relation.label) {
                                    Text(relation.label).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                                        .fontColor($r('app.color.text_secondary')).width('100%');
                                }
                            }.width('100%').alignItems(HorizontalAlign.Start);
                        }, (relation: GraphRelation, index: number) => relation.from + ':' + relation.to + ':' + index + ':' + this.graphEpoch);
                    }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
                        .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
                }
            }
        }.width('100%').alignItems(HorizontalAlign.Start);
    }

    build() {
        Column() {
            if (!this.embedded) {
                this.Header();
            }
            LearningAgentNavigationNotice({ opening: this.navigationOpening, errorText: this.navigationError,
                loadingText: this.navigationLabel, controlPrefix: 'agent_report_navigation' });
            Scroll() {
                Column({ space: Space.lg }) {
                    this.ContentHeading();
                    if (this.target.lecture_id.length === 0) {
                        Placeholder({ icon: $r('app.media.ic_book'), title: '先从一门课程开始',
                            hint: '在「学习」中选择课程后，可以在这里查看学习情况。' }).id('agent_report_no_target');
                    } else {
                        if (this.loading) {
                            LoadingBlock({ label: this.summary === null ? '正在整理学习记录' : '正在更新学习记录' })
                                .id('agent_report_loading');
                        }
                        if (this.errorText.length > 0) {
                            this.ErrorCard('学习记录暂时未能更新', this.errorText, 'agent_report_retry');
                        }
                        if (this.summary !== null) {
                            this.SummaryCards();
                        }
                        if (this.hasReadingTarget()) {
                            this.TargetActions((): LearnTarget => this.target, 'agent_report');
                        }
                        if (this.weaknesses.length > 0) {
                            this.NoteSection('可以再练的地方', true);
                        }
                        if (this.recommendations.length > 0) {
                            this.NoteSection('下一步建议', false);
                        }
                        this.GraphSection();
                    }
                }.width('100%').alignItems(HorizontalAlign.Start)
                    .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.xxl + this.insetBottom });
            }.layoutWeight(1).width('100%').scrollBar(BarState.Off).id('agent_report_scroll');
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page')).id('agent_report_page');
    }
}
