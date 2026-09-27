import { LearningApi, LearningChapterSummary } from '../../common/LearningApi';
import { LearningAgentApi, agentFailure, NO_AGENT_TARGET } from '../../common/LearningAgentApi';
import { LearningBridge } from '../../common/LearningBridge';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import {
    LearnTarget, ContextData, TaskInfo, TaskData, ReviewQuestion, ReviewAnswerDraft,
    ReviewSubmitData, ReviewSubmitItem, FlowStateData, FlowSubmitData, FlowWrapupData, UncertainItem
} from '../../common/LearningAgentModels';
import { MarkdownView } from '../chat/MarkdownBlock';
import { IconButton } from '../common/IconButton';
import { ProgressTrack } from '../learning/LearningWidgets';
import { LearningAgentNavigationNotice } from './LearningAgentNavigationNotice';

interface ReviewActionView {
    label: string;
    identifier: string;
    enabled: boolean;
    primary: boolean;
    onTap: () => void;
}

interface ReviewQuestionView {
    question: ReviewQuestion;
    index: number;
}

interface ReviewOptionView {
    index: number;
    option: string;
    optionIndex: number;
}

// TodayTask and flow Quiz share rendering, while keeping their submission identities separate.
@Component
export struct LearningAgentReview {
    @Prop initialTarget: LearnTarget = NO_AGENT_TARGET;
    @Prop flowId: string = '';
    @Prop @Watch('onVisibleChanged') visible: boolean = true;
    @Prop navigationOpening: boolean = false;
    @Prop navigationError: string = '';
    @Prop navigationLabel: string = '正在打开教材…';
    @StorageProp('nxLearningBridgeTick') @Watch('onBridgeChanged') private bridgeTick: number = 0;
    onBack: () => void = () => {};
    onRead: (target: LearnTarget, flowId: string) => void = () => {};
    onSubmitted: () => void = () => {};
    onBusyChange: (busy: boolean) => void = () => {};
    @State private choices: LearnTarget[] = [];
    @State private selected: LearnTarget = NO_AGENT_TARGET;
    @State private chapters: LearningChapterSummary[] = [];
    @State private questions: ReviewQuestion[] = [];
    @State private answers: string[] = [];
    @State private origin: LearnTarget = NO_AGENT_TARGET;
    @State private loading: boolean = true;
    @State private generating: boolean = false;
    @State private submitting: boolean = false;
    @State private submitted: boolean = false;
    @State private submissionFailed: boolean = false;
    @State private errorText: string = '';
    @State private statusText: string = '';
    @State private resultText: string = '';
    @State private needsReading: boolean = false;
    @State private chapterLoading: boolean = false;
    @State private setupExpanded: boolean = true;
    @State private confirmRegenerate: boolean = false;
    @State private showBlankErrors: boolean = false;
    @State private interrupted: boolean = false;
    @State private resultNote: string = '';
    @State private resultItems: ReviewSubmitItem[] = [];
    @State private uncertain: UncertainItem[] = [];
    private taskId: string = '';
    private quizId: string = '';
    private attemptId: string = '';
    private version: number = 0;
    private choiceVersion: number = 0;
    private contextVersion: number = 0;
    private timer: number = -1;
    private alive: boolean = false;
    private polling: boolean = false;
    private flowRefreshPending: boolean = false;
    private scroller: Scroller | undefined = undefined;

    aboutToAppear(): void {
        this.alive = true;
        this.scroller = new Scroller();
        if (this.flowId.length > 0) {
            void this.loadFlow();
        } else {
            void this.loadChoices();
        }
    }

    aboutToDisappear(): void {
        this.setSubmitting(false);
        this.alive = false;
        this.version++;
        this.choiceVersion++;
        this.contextVersion++;
        this.stopTimer();
    }

    private setSubmitting(busy: boolean): void {
        if (this.submitting === busy) {
            return;
        }
        this.submitting = busy;
        this.onBusyChange(busy);
    }

    private onVisibleChanged(): void {
        if (!this.visible) {
            this.stopTimer();
            return;
        }
        if (this.flowId.length > 0 && !this.submitted) {
            void this.loadFlow();
        } else if (this.generating && this.taskId.length > 0) {
            void this.pollTask(this.version);
        }
    }

    private onBridgeChanged(): void {
        const event = LearningBridge.latest();
        if (this.alive && event !== null && event.type === 'flow_reading_done' && event.flowId === this.flowId) {
            this.flowRefreshPending = true;
            if (this.visible) {
                void this.loadFlow();
            }
        }
    }

    private stopTimer(): void {
        if (this.timer >= 0) {
            clearTimeout(this.timer);
            this.timer = -1;
        }
    }

    private async loadChoices(): Promise<void> {
        const version: number = ++this.contextVersion;
        this.loading = true;
        this.errorText = '';
        this.submissionFailed = false;
        try {
            const context: ContextData = await LearningAgentApi.getContext();
            if (!this.alive || version !== this.contextVersion) {
                return;
            }
            const choices: LearnTarget[] = [];
            for (const lecture of context.lectures) {
                for (const book of lecture.books) {
                    let chapterIndex: number = lecture.current_book_id === book.id &&
                        lecture.current_chapter_index !== undefined && lecture.current_chapter_index !== null
                        ? Math.max(0, lecture.current_chapter_index) : 0;
                    if (context.active_session !== undefined && context.active_session.lecture_id === lecture.id &&
                        context.active_session.book_id === book.id) {
                        chapterIndex = Math.max(0, context.active_session.chapter_index);
                    }
                    choices.push({ lecture_id: lecture.id, lecture_title: lecture.title,
                        book_id: book.id, book_title: book.title, chapter_index: chapterIndex,
                        chapter_name: '', chapter_range: '' });
                }
            }
            this.choices = choices;
            let selected: LearnTarget | null = null;
            const requestedTarget: LearnTarget = this.initialTarget;
            for (const choice of choices) {
                if (choice.lecture_id === requestedTarget.lecture_id && choice.book_id === requestedTarget.book_id) {
                    selected = requestedTarget;
                }
            }
            if (selected === null && choices.length > 0) {
                selected = choices[0];
            }
            if (selected === null) {
                this.statusText = '先去学习选择教材，再来复习。';
            } else {
                await this.chooseBook(selected);
            }
            if (!this.alive || version !== this.contextVersion) {
                return;
            }
            const pending: string = AppStorage.get<string>('nxPendingReviewTask') || '';
            if (pending.length > 0 && this.alive) {
                AppStorage.setOrCreate('nxPendingReviewTask', '');
                this.taskId = pending;
                this.generating = true;
                void this.pollTask(++this.version);
            }
        } catch (error) {
            if (this.alive && version === this.contextVersion) {
                this.errorText = agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.contextVersion) {
                this.loading = false;
            }
        }
    }

    private async chooseBook(target: LearnTarget): Promise<void> {
        if (this.generating || this.submitting) {
            return;
        }
        this.selected = target;
        this.chapters = [];
        this.chapterLoading = true;
        this.confirmRegenerate = false;
        this.errorText = '';
        this.submissionFailed = false;
        const version: number = ++this.choiceVersion;
        try {
            const result = await LearningApi.shared.getBookChapters(target.lecture_id, target.book_id);
            if (!this.alive || version !== this.choiceVersion) {
                return;
            }
            if (!result.success) {
                this.errorText = result.message;
                return;
            }
            this.chapters = result.chapters;
            let chapter: LearningChapterSummary | null = null;
            for (const item of this.chapters) {
                if (item.index === target.chapter_index) {
                    chapter = item;
                }
            }
            if (chapter === null && this.chapters.length > 0) {
                chapter = this.chapters[0];
            }
            if (chapter !== null) {
                this.chooseChapter(chapter);
            } else {
                this.statusText = '这本教材还没有可复习的章节，可以换一本。';
            }
        } catch (error) {
            if (this.alive && version === this.choiceVersion) {
                this.errorText = '章节没有取到：' + agentFailure(error);
            }
        } finally {
            if (this.alive && version === this.choiceVersion) {
                this.chapterLoading = false;
            }
        }
    }

    private chooseChapter(chapter: LearningChapterSummary): void {
        if (this.generating || this.submitting) {
            return;
        }
        this.confirmRegenerate = false;
        this.selected = {
            lecture_id: this.selected.lecture_id, lecture_title: this.selected.lecture_title,
            book_id: this.selected.book_id, book_title: this.selected.book_title,
            chapter_index: chapter.index, chapter_name: chapter.title, chapter_range: ''
        };
    }

    private async startReview(): Promise<void> {
        if (this.generating || this.submitting || this.chapterLoading || this.selected.book_id.length === 0) {
            return;
        }
        this.stopTimer();
        const version: number = ++this.version;
        this.origin = this.selected;
        this.questions = [];
        this.answers = [];
        this.resultText = '';
        this.resultNote = '';
        this.resultItems = [];
        this.uncertain = [];
        this.errorText = '';
        this.submissionFailed = false;
        this.submitted = false;
        this.interrupted = false;
        this.showBlankErrors = false;
        this.confirmRegenerate = false;
        this.setupExpanded = false;
        this.generating = true;
        this.taskId = '';
        this.quizId = '';
        this.attemptId = '';
        this.statusText = '正在根据这一章准备复习题。';
        this.scrollToTop();
        try {
            const data: TaskData = await LearningAgentApi.reviewPlan(this.origin);
            if (!this.alive || version !== this.version) {
                return;
            }
            this.taskId = data.task.task_id;
            if (!this.consumeTask(data.task)) {
                void this.pollTask(version);
            }
        } catch (error) {
            if (this.alive && version === this.version) {
                this.errorText = agentFailure(error);
                this.generating = false;
                this.statusText = '';
            }
        }
    }

    private consumeTask(task: TaskInfo): boolean {
        if (task.status === 'failed') {
            this.generating = false;
            this.errorText = task.error !== null && task.error !== undefined ? task.error.message : '出题失败，请重新生成';
            this.statusText = '';
            return true;
        }
        if (task.status !== 'completed') {
            this.statusText = task.status === 'queued' ? '已加入出题队列，题目准备好后会自动显示。' : '正在根据本章内容准备题目。';
            return false;
        }
        this.generating = false;
        this.quizId = task.result.quiz_id;
        this.attemptId = task.result.attempt_id || task.task_id;
        const source = this.choices.find((target: LearnTarget): boolean =>
            target.lecture_id === task.result.lecture_id && target.book_id === task.result.book_id);
        this.origin = { lecture_id: task.result.lecture_id,
            lecture_title: source !== undefined ? source.lecture_title : this.origin.lecture_title,
            book_id: task.result.book_id, book_title: source !== undefined ? source.book_title : this.origin.book_title,
            chapter_index: task.result.chapter_index, chapter_name: task.result.chapter_name, chapter_range: '' };
        this.replaceQuestions(task.result.questions || []);
        this.statusText = this.questions.length > 0 ? '先独立作答，提交后再看参考答案。' : '本次没有生成题目，可以重新出题或换一章。';
        return true;
    }

    private async pollTask(version: number): Promise<void> {
        if (!this.alive || !this.visible || this.polling || version !== this.version) {
            return;
        }
        this.polling = true;
        try {
            const data: TaskData = await LearningAgentApi.getTask(this.taskId);
            if (this.alive && version === this.version) {
                this.errorText = '';
                this.submissionFailed = false;
                this.consumeTask(data.task);
            }
        } catch (error) {
            if (this.alive && version === this.version) {
                this.errorText = '暂时没同步上：' + agentFailure(error);
                this.submissionFailed = false;
            }
        } finally {
            this.polling = false;
            if (this.alive && this.visible && this.generating && version === this.version) {
                this.timer = setTimeout(() => { void this.pollTask(version); }, 2000);
            }
        }
    }

    private async loadFlow(): Promise<void> {
        if (!this.alive || !this.visible || this.submitting) {
            return;
        }
        if (this.polling) {
            this.flowRefreshPending = true;
            return;
        }
        this.stopTimer();
        this.flowRefreshPending = false;
        const version: number = this.version;
        this.polling = true;
        try {
            const flow: FlowStateData = await LearningAgentApi.getFlow(this.flowId);
            if (!this.alive || version !== this.version) {
                return;
            }
            if (flow.status === 'not_found') {
                throw new Error('这次复习流程已不可用，请回时间线重新开始');
            }
            this.origin = flow.target;
            this.selected = flow.target;
            this.errorText = '';
            this.submissionFailed = false;
            this.needsReading = flow.step === 'opened';
            this.interrupted = flow.step === 'aborted';
            if (this.interrupted) {
                this.needsReading = false;
                this.generating = false;
                this.submitted = false;
                this.statusText = '这轮没有完成。你可以回读这一章，或回到 Agent 开始新一轮。';
            } else if (flow.status === 'done') {
                this.submitted = true;
                this.generating = false;
                this.needsReading = false;
                this.applyFlowResult(flow.wrapup);
            } else if (flow.quiz !== undefined && flow.quiz.status === 'completed') {
                const questions: ReviewQuestion[] = [];
                for (const question of flow.quiz.questions) {
                    questions.push({ type: question.type, title: question.title, content: question.content,
                        options: question.options || [], source_id: question.source_id, source: question.source,
                        answer: question.answer, difficulty: '', hint: '' });
                }
                this.replaceQuestions(questions);
                this.generating = false;
                this.statusText = questions.length > 0 ? '先独立作答，提交后再看参考答案。' : '这次没有取到可作答的题目，可以重新同步。';
            } else if (flow.quiz !== undefined && flow.quiz.status === 'failed') {
                this.generating = false;
                this.errorText = flow.quiz.error || '本次出题失败，请返回时间线查看';
                this.statusText = '';
            } else {
                this.generating = !this.needsReading;
                this.statusText = this.needsReading ? '先读完目标章节，再回来做题。' : '已收到阅读完成记录，正在准备题目…';
            }
        } catch (error) {
            if (this.alive && version === this.version) {
                this.errorText = agentFailure(error);
                this.submissionFailed = false;
                this.generating = false;
            }
        } finally {
            this.polling = false;
            if (this.alive && version === this.version) {
                this.loading = false;
            }
            if (this.alive && this.visible && (this.generating || this.flowRefreshPending) && version === this.version) {
                this.timer = setTimeout(() => { void this.loadFlow(); }, this.flowRefreshPending ? 0 : 2000);
            }
        }
    }

    private questionId(question: ReviewQuestion, index: number): string {
        return question.source_id !== undefined && question.source_id.length > 0 ? question.source_id : 'q' + index;
    }

    private replaceQuestions(next: ReviewQuestion[]): void {
        const previous: Map<string, string> = new Map<string, string>();
        for (let index: number = 0; index < this.questions.length; index++) {
            previous.set(this.questionId(this.questions[index], index), this.answers[index] || '');
        }
        this.questions = next;
        this.answers = next.map((question: ReviewQuestion, index: number): string =>
            previous.get(this.questionId(question, index)) || '');
    }

    private options(question: ReviewQuestion): string[] {
        if (question.type === 'text' || question.type === 'short_answer' || question.type === '简答题') {
            return [];
        }
        const result: string[] = (question.options || []).filter((option: string): boolean =>
            option.trim().length > 0 && ['无', '暂无', 'none', 'n/a', '-', '—', '选项', '略'].indexOf(option.trim().toLowerCase()) < 0);
        return result.length >= 2 ? result : [];
    }

    private setAnswer(index: number, answer: string): void {
        if (this.submitting || this.submitted || this.interrupted || index < 0 || index >= this.questions.length) {
            return;
        }
        const next: string[] = this.answers.slice();
        next[index] = answer;
        this.answers = next;
        if (this.showBlankErrors) {
            this.errorText = this.blankAnswerMessage();
            this.showBlankErrors = this.errorText.length > 0;
        }
    }

    private blankAnswerMessage(): string {
        const remaining: number = this.questions.length - this.answeredCount();
        return remaining > 0 ? '还有 ' + remaining + ' 题未作答。选一个答案，或写下你的想法后再提交。' : '';
    }

    private async submit(): Promise<void> {
        if (this.submitting || this.submitted || this.generating || this.interrupted || this.questions.length === 0) {
            return;
        }
        this.submissionFailed = false;
        if (this.answeredCount() < this.questions.length) {
            this.showBlankErrors = true;
            this.errorText = this.blankAnswerMessage();
            this.scrollToTop();
            return;
        }
        this.setSubmitting(true);
        this.confirmRegenerate = false;
        this.showBlankErrors = false;
        this.errorText = '';
        const version: number = this.version;
        try {
            const answers: ReviewAnswerDraft[] = this.questions.map((question: ReviewQuestion, index: number): ReviewAnswerDraft => ({
                question_id: this.questionId(question, index), answer: this.answers[index].trim()
            }));
            let result: string = '';
            let note: string = '';
            let resultItems: ReviewSubmitItem[] = [];
            let flowWrapup: FlowWrapupData | undefined = undefined;
            if (this.flowId.length > 0) {
                const response: FlowSubmitData = await LearningAgentApi.submitFlow(this.flowId, answers);
                flowWrapup = response.state.wrapup !== undefined ? response.state.wrapup : response.wrapup as FlowWrapupData;
            } else {
                const response: ReviewSubmitData = await LearningAgentApi.submitReview(this.quizId, this.attemptId, this.origin, answers);
                result = typeof response.quiz_correct === 'number' && typeof response.quiz_total === 'number'
                    ? response.quiz_correct + ' / ' + response.quiz_total : response.score;
                resultItems = response.items || [];
                note = '本轮作答已记入学习记录。';
                if (resultItems.length > 0 && resultItems.every((item: ReviewSubmitItem): boolean => item.duplicate === true)) {
                    note = '这是本轮已记录的成绩，没有重复累计。';
                }
            }
            if (this.alive && version === this.version) {
                if (this.flowId.length > 0) {
                    this.applyFlowResult(flowWrapup);
                } else {
                    this.resultText = result || '成绩已记录';
                    this.resultNote = note;
                    this.resultItems = resultItems;
                }
                this.submitted = true;
                this.setupExpanded = false;
                this.scrollToTop();
                this.onSubmitted();
            }
        } catch (error) {
            if (this.alive && version === this.version) {
                this.errorText = '提交失败，答案已保留：' + agentFailure(error);
                this.submissionFailed = true;
                this.scrollToTop();
            }
        } finally {
            if (this.alive && version === this.version) {
                this.setSubmitting(false);
            }
        }
    }

    private errorRetryKind(): string {
        if (this.errorText.length === 0) { return ''; }
        if (this.submissionFailed) { return 'submit'; }
        if (this.flowId.length > 0) { return this.questions.length === 0 ? 'flow' : ''; }
        if (this.choices.length === 0) { return 'context'; }
        return this.chapters.length === 0 && this.selected.book_id.length > 0 ? 'chapters' : '';
    }

    private async retryError(): Promise<void> {
        const kind: string = this.errorRetryKind();
        if (kind === 'submit') { await this.submit(); }
        else if (kind === 'flow') { await this.loadFlow(); }
        else if (kind === 'context') { await this.loadChoices(); }
        else if (kind === 'chapters') { await this.chooseBook(this.selected); }
    }

    private applyFlowResult(wrapup: FlowWrapupData | undefined): void {
        this.resultText = wrapup !== undefined && wrapup !== null && typeof wrapup.quizScore === 'string' && wrapup.quizScore.length > 0
            ? wrapup.quizScore : '结果待同步';
        this.resultNote = this.resultText === '结果待同步' ? '作答已提交，暂时没有取到本轮成绩。' : '本轮结果已记入学习时间线。';
        const uncertain: UncertainItem[] = [];
        if (wrapup !== undefined && wrapup !== null && Array.isArray(wrapup.uncertain)) {
            for (const row of wrapup.uncertain) {
                const item = row as UncertainItem;
                if (item !== null && item !== undefined && typeof item.questionId === 'string' && typeof item.why === 'string') {
                    uncertain.push(item);
                }
            }
        }
        this.uncertain = uncertain;
    }

    private answeredCount(): number {
        let count: number = 0;
        for (let index: number = 0; index < this.questions.length; index++) {
            if ((this.answers[index] || '').trim().length > 0) {
                count++;
            }
        }
        return count;
    }

    private requestReview(): void {
        if (!this.submitted && this.answeredCount() > 0) {
            this.confirmRegenerate = true;
            this.scrollToTop();
            return;
        }
        void this.startReview();
    }

    private scrollToTop(): void {
        this.scroller?.scrollEdge(Edge.Top);
    }

    private readTarget(): LearnTarget {
        return this.origin.book_id.length > 0 && (this.questions.length > 0 || this.generating || this.needsReading || this.submitted || this.interrupted)
            ? this.origin : this.selected;
    }

    private openReading(): void {
        if (!this.submitting && !this.navigationOpening && this.readTarget().book_id.length > 0) {
            this.onRead(this.readTarget(), this.interrupted || this.submitted ? '' : this.flowId);
        }
    }

    private questionResult(question: ReviewQuestion, index: number): ReviewSubmitItem | undefined {
        const id: string = this.questionId(question, index);
        return this.resultItems.find((item: ReviewSubmitItem): boolean => item.question_id === id);
    }

    private isUncertain(question: ReviewQuestion, index: number): boolean {
        const id: string = this.questionId(question, index);
        return this.uncertain.some((item: UncertainItem): boolean => item.questionId === id);
    }

    private questionStatus(question: ReviewQuestion, index: number): string {
        if (this.submitted) {
            if (this.isUncertain(question, index)) {
                return '待确认';
            }
            const result = this.questionResult(question, index);
            if (result !== undefined && typeof result.is_correct === 'boolean') {
                return result.is_correct ? '答对了' : '需要回顾';
            }
            return '已提交';
        }
        if (this.interrupted) {
            return '本轮已结束';
        }
        return (this.answers[index] || '').trim().length > 0 ? '已作答' : '未作答';
    }

    private questionStatusColor(question: ReviewQuestion, index: number): ResourceColor {
        const result = this.questionResult(question, index);
        if (this.submitted && !this.isUncertain(question, index) && result !== undefined && typeof result.is_correct === 'boolean') {
            return result.is_correct ? $r('app.color.text_success') : $r('app.color.text_danger');
        }
        if (this.showBlankErrors && (this.answers[index] || '').trim().length === 0) {
            return $r('app.color.text_danger');
        }
        return this.submitted || (this.answers[index] || '').trim().length > 0
            ? $r('app.color.text_brand') : $r('app.color.text_secondary');
    }

    private uncertainLabel(item: UncertainItem): string {
        for (let index: number = 0; index < this.questions.length; index++) {
            if (this.questionId(this.questions[index], index) === item.questionId) {
                return '第 ' + (index + 1) + ' 题';
            }
        }
        return '待确认的题目';
    }

    private optionText(option: string): string {
        return option.replace(/^[A-Ha-h][.、．)）]\s*/, '');
    }

    private hasNumericScore(): boolean {
        return /^\s*\d+\s*\/\s*\d+\s*$/.test(this.resultText);
    }

    private bookOptions(): SelectOption[] {
        return this.choices.map((target: LearnTarget): SelectOption => ({ value: target.book_title }));
    }

    private chapterOptions(): SelectOption[] {
        return this.chapters.map((chapter: LearningChapterSummary): SelectOption => ({ value: chapter.title }));
    }

    build() {
        Column() {
            this.Header()
            LearningAgentNavigationNotice({ opening: this.submitting || this.navigationOpening, errorText: this.navigationError,
                loadingText: this.submitting ? '正在保存作答，请稍候…' : this.navigationLabel,
                controlPrefix: this.submitting ? 'agent_review_submission' : 'agent_review_navigation' })
            if (this.questions.length > 0 && !this.submitted && !this.interrupted) {
                Column({ space: Space.sm }) {
                    Row() {
                        Text('作答进度').fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
                        Blank()
                        Text(this.answeredCount() + ' / ' + this.questions.length + ' 题')
                            .fontSize(FontSize.small).fontColor($r('app.color.text_brand')).id('agent_review_progress')
                    }.width('100%')
                    ProgressTrack({ ratio: this.answeredCount() / this.questions.length, trackHeight: Space.xs })
                }.width('100%').padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.md })
                .backgroundColor($r('app.color.bg_card'))
            }
            Scroll(this.scroller) {
                Column({ space: Space.lg }) {
                    if (this.loading) {
                        this.LoadingPanel()
                    }
                    if (this.submitted) {
                        this.ResultPanel()
                    }
                    if (!this.loading && this.flowId.length === 0 && this.choices.length === 0 && this.errorText.length === 0) {
                        this.EmptyPanel()
                    }
                    if (this.origin.book_id.length > 0 && (this.questions.length > 0 || this.generating || this.needsReading || this.interrupted)) {
                        this.SourcePanel()
                    }
                    if (this.confirmRegenerate) {
                        this.RegeneratePanel()
                    }
                    if (!this.loading && this.flowId.length === 0 && this.choices.length > 0 &&
                        !this.confirmRegenerate && (this.setupExpanded || (this.questions.length === 0 && !this.generating))) {
                        this.SetupPanel()
                    }
                    if (this.generating && !this.loading) {
                        this.WaitingPanel()
                    }
                    if (this.errorText.length > 0) {
                        this.ErrorPanel()
                    }
                    if (this.needsReading && !this.loading) {
                        Column({ space: Space.md }) {
                            Text('先把这一章读完').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                                .fontColor($r('app.color.text_primary')).width('100%')
                            Text('在阅读器中确认“读完这一章”后，Agent 会继续准备小测。')
                                .fontSize(FontSize.body).fontColor($r('app.color.text_secondary')).lineHeight(LineHeight.body).width('100%')
                            this.Action({ label: '继续读这一章', identifier: 'agent_review_continue_reading', enabled: !this.submitting && !this.navigationOpening,
                                primary: true, onTap: () => { this.openReading(); } })
                        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
                    }
                    if (this.interrupted) {
                        Column({ space: Space.md }) {
                            Text('这轮尚未完成').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                                .fontColor($r('app.color.text_primary')).width('100%')
                            Text(this.statusText).fontSize(FontSize.body).fontColor($r('app.color.text_secondary'))
                                .lineHeight(LineHeight.body).width('100%').id('agent_review_interrupted')
                            this.Action({ label: '回到 Agent', identifier: 'agent_review_interrupted_back', enabled: true,
                                primary: true, onTap: () => { this.onBack(); } })
                        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
                    }
                    if (!this.loading && !this.generating && !this.submitted && !this.needsReading && !this.interrupted && this.statusText.length > 0) {
                        Text(this.statusText).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                            .fontColor($r('app.color.text_secondary')).width('100%')
                    }
                    if (!this.loading && this.flowId.length > 0 && !this.generating && !this.submitted && !this.needsReading &&
                        !this.interrupted && this.questions.length === 0 && this.errorText.length === 0) {
                        this.Action({ label: '重新同步题目', identifier: 'agent_review_sync_empty', enabled: true,
                            primary: false, onTap: () => { void this.loadFlow(); } })
                    }
                    ForEach(this.questions, (question: ReviewQuestion, index: number) => {
                        this.QuestionPanel({ question: question, index: index })
                    }, (question: ReviewQuestion, index: number) => this.questionId(question, index))
                    if (!this.submitted && !this.interrupted && this.questions.length > 0) {
                        Column({ space: Space.sm }) {
                            Text(this.submitting ? '正在保存本轮作答，答案会保留。' :
                                (this.answeredCount() < this.questions.length ? '还有 ' + (this.questions.length - this.answeredCount()) + ' 题未作答' : '已完成作答，提交后查看本轮结果。'))
                                .fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                            this.Action({ label: this.submitting ? '正在提交…' : '提交作答', identifier: 'agent_review_submit',
                                enabled: !this.submitting && !this.generating, primary: true, onTap: () => { void this.submit(); } })
                        }.width('100%').padding({ top: Space.xs, bottom: Space.sm })
                    }
                }.width('100%').padding({ left: Space.lg, right: Space.lg, top: Space.lg, bottom: Space.xxxl })
                .alignItems(HorizontalAlign.Start)
            }.layoutWeight(1).width('100%').scrollBar(BarState.Off).id('agent_review_scroll')
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page')).id('agent_review_page')
    }

    @Builder
    private Header() {
        Row({ space: Space.sm }) {
            IconButton({ icon: $r('app.media.ic_back'), tint: $r('app.color.icon_primary'), isEnabled: !this.submitting,
                onTap: () => { this.onBack(); } })
                .accessibilityText('返回 Agent').id('agent_review_back')
            Column({ space: Space.xxs }) {
                Text(this.flowId.length > 0 ? '读后小测' : '章节复习')
                    .fontSize(FontSize.title).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
                Text('Agent').fontSize(FontSize.caption).fontColor($r('app.color.text_secondary'))
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            Button('回读', { type: ButtonType.Normal }).height(Size.touchTarget)
                .padding({ left: Space.md, right: Space.md }).borderRadius(Radius.md)
                .fontSize(FontSize.small).fontColor($r('app.color.text_brand')).backgroundColor($r('app.color.brand_soft'))
                .enabled(this.readTarget().book_id.length > 0 && !this.submitting && !this.loading && !this.navigationOpening)
                .onClick(() => { this.openReading(); }).id('agent_review_read')
        }.width('100%').padding({ left: Space.sm, right: Space.lg, top: Space.sm, bottom: Space.sm })
        .backgroundColor($r('app.color.bg_card'))
    }

    @Builder
    private Action($$: ReviewActionView) {
        Button($$.label, { type: ButtonType.Normal }).width('100%').height(Size.touchTarget)
            .fontSize(FontSize.body).fontWeight(FontWeight.Medium).borderRadius(Radius.md)
            .backgroundColor($$.primary ? $r('app.color.brand_primary') : $r('app.color.brand_soft'))
            .fontColor($$.primary ? $r('app.color.text_inverse') : $r('app.color.text_brand'))
            .enabled($$.enabled).opacity($$.enabled ? 1 : 0.5).onClick(() => { $$.onTap(); }).id($$.identifier)
    }

    @Builder
    private LoadingPanel() {
        Column({ space: Space.md }) {
            LoadingProgress().width(Size.avatar).height(Size.avatar).color($r('app.color.brand_primary'))
            Text(this.flowId.length > 0 ? '正在同步这次学习' : '正在读取你的教材')
                .fontSize(FontSize.body).fontColor($r('app.color.text_secondary'))
        }.width('100%').padding(Space.xxxl).borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card')).id('agent_review_loading')
    }

    @Builder
    private EmptyPanel() {
        Column({ space: Space.md }) {
            Image($r('app.media.ic_book')).width(Size.avatar).height(Size.avatar).fillColor($r('app.color.icon_brand'))
            Text('先选一本想学的教材').fontSize(FontSize.title).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
            Text('在侧边栏的“学习”中选择课程和教材，再来做章节复习。')
                .fontSize(FontSize.body).lineHeight(LineHeight.body).textAlign(TextAlign.Center).fontColor($r('app.color.text_secondary'))
            this.Action({ label: '返回 Agent', identifier: 'agent_review_empty_back', enabled: true,
                primary: false, onTap: () => { this.onBack(); } })
        }.width('100%').padding(Space.xl).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .id('agent_review_empty')
    }

    @Builder
    private SourcePanel() {
        Column({ space: Space.sm }) {
            Row() {
                Text('本轮来源').fontSize(FontSize.caption).fontColor($r('app.color.text_secondary'))
                Blank()
                if (this.flowId.length === 0 && this.questions.length > 0 && !this.setupExpanded) {
                    Button('调整下一组', { type: ButtonType.Normal }).height(Size.touchTarget)
                        .fontSize(FontSize.small).fontColor($r('app.color.text_brand')).backgroundColor(Color.Transparent)
                        .enabled(!this.submitting && !this.generating)
                        .onClick(() => { this.setupExpanded = true; }).id('agent_review_change_scope')
                }
            }.width('100%')
            Text(this.origin.chapter_name || '当前章节').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                .lineHeight(LineHeight.title).fontColor($r('app.color.text_primary')).width('100%')
            if (this.origin.book_title.length > 0 || this.origin.lecture_title.length > 0) {
                Text(this.origin.book_title || this.origin.lecture_title).fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary')).lineHeight(LineHeight.caption).width('100%')
            }
        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .id('agent_review_source')
    }

    @Builder
    private SetupPanel() {
        Column({ space: Space.md }) {
            Text(this.questions.length > 0 ? '下一组练什么' : '选一章，检查自己的理解')
                .fontSize(FontSize.title).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
            Text('教材').fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
            Select(this.bookOptions()).value(this.selected.book_title).width('100%').height(Size.touchTarget)
                .font({ size: FontSize.body }).fontColor($r('app.color.text_primary'))
                .backgroundColor($r('app.color.bg_sunken')).borderRadius(Radius.md)
                .enabled(!this.loading && !this.generating && !this.submitting)
                .onSelect((index: number) => {
                    if (index >= 0 && index < this.choices.length) {
                        void this.chooseBook(this.choices[index]);
                    }
                }).id('agent_review_book_select')
            Text('章节').fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
            Select(this.chapterOptions()).value(this.chapterLoading ? '正在读取章节…' : (this.selected.chapter_name || '选择章节'))
                .width('100%').height(Size.touchTarget).font({ size: FontSize.body }).fontColor($r('app.color.text_primary'))
                .backgroundColor($r('app.color.bg_sunken')).borderRadius(Radius.md)
                .enabled(!this.loading && !this.chapterLoading && !this.generating && !this.submitting && this.chapters.length > 0)
                .onSelect((index: number) => {
                    if (index >= 0 && index < this.chapters.length) {
                        this.chooseChapter(this.chapters[index]);
                    }
                }).id('agent_review_chapter_select')
            if (this.questions.length > 0) {
                Text('调整这里不改变当前题目的来源。重新出题后才进入下一轮。')
                    .fontSize(FontSize.small).lineHeight(LineHeight.caption).fontColor($r('app.color.text_secondary')).width('100%')
            }
            this.Action({ label: this.questions.length > 0 ? '再出一组' : '准备复习题', identifier: 'agent_review_generate',
                enabled: !this.loading && !this.chapterLoading && !this.generating && !this.submitting && this.chapters.length > 0,
                primary: true, onTap: () => { this.requestReview(); } })
        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
    }

    @Builder
    private WaitingPanel() {
        Row({ space: Space.md }) {
            LoadingProgress().width(Size.avatar).height(Size.avatar).color($r('app.color.brand_primary'))
            Column({ space: Space.xs }) {
                Text('正在准备题目').fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
                Text(this.statusText).fontSize(FontSize.small).lineHeight(LineHeight.caption).fontColor($r('app.color.text_secondary'))
                Text('题目就绪后会自动显示。也可以先回读本章。')
                    .fontSize(FontSize.small).lineHeight(LineHeight.caption).fontColor($r('app.color.text_secondary'))
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').alignItems(VerticalAlign.Top).padding(Space.lg)
        .borderRadius(Radius.lg).backgroundColor($r('app.color.brand_soft')).id('agent_review_generating')
    }

    @Builder
    private ErrorPanel() {
        Column({ space: Space.md }) {
            Text(this.showBlankErrors ? '还有题目需要作答' : '这一步没有完成')
                .fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).width('100%')
            Text(this.errorText).fontSize(FontSize.body).lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_danger')).width('100%').id('agent_review_error')
            if (this.errorRetryKind() === 'submit') {
                this.Action({ label: '重新提交', identifier: 'agent_review_retry_submit', enabled: !this.submitting && !this.generating,
                    primary: false, onTap: () => { void this.retryError(); } })
            } else if (this.errorRetryKind() === 'flow') {
                this.Action({ label: '重新同步', identifier: 'agent_review_retry_flow', enabled: !this.submitting,
                    primary: false, onTap: () => { void this.retryError(); } })
            } else if (this.errorRetryKind() === 'context') {
                this.Action({ label: '重新读取教材', identifier: 'agent_review_retry_context', enabled: !this.loading,
                    primary: false, onTap: () => { void this.retryError(); } })
            } else if (this.errorRetryKind() === 'chapters') {
                this.Action({ label: '重新读取章节', identifier: 'agent_review_retry_chapters', enabled: !this.chapterLoading,
                    primary: false, onTap: () => { void this.retryError(); } })
            }
        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .border({ width: Size.divider, color: $r('app.color.border') })
    }

    @Builder
    private RegeneratePanel() {
        Column({ space: Space.md }) {
            Text('要换掉这一组题目吗？').fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).width('100%')
            Text('重新出题会替换当前题目和填写内容，已经记录的成绩会保留。')
                .fontSize(FontSize.body).lineHeight(LineHeight.body).fontColor($r('app.color.text_secondary')).width('100%')
            this.Action({ label: '保留这一组', identifier: 'agent_review_keep_draft', enabled: !this.submitting,
                primary: true, onTap: () => { this.confirmRegenerate = false; } })
            this.Action({ label: '确认重新出题', identifier: 'agent_review_confirm_generate', enabled: !this.submitting && !this.generating,
                primary: false, onTap: () => { void this.startReview(); } })
        }.width('100%').padding(Space.lg).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .border({ width: Size.divider, color: $r('app.color.border_strong') }).id('agent_review_regenerate_confirmation')
    }

    @Builder
    private OptionContent($$: ReviewOptionView) {
        Text(String.fromCharCode(65 + $$.optionIndex)).fontSize(FontSize.small).fontWeight(FontWeight.Medium)
            .width(Size.iconLarge).height(Size.iconLarge).lineHeight(Size.iconLarge)
            .textAlign(TextAlign.Center).borderRadius(Radius.full)
            .backgroundColor(this.answers[$$.index] === $$.option ? $r('app.color.brand_primary') : $r('app.color.bg_card'))
            .fontColor(this.answers[$$.index] === $$.option ? $r('app.color.text_inverse') : $r('app.color.text_secondary'))
        Text(this.optionText($$.option)).fontSize(FontSize.body).lineHeight(LineHeight.body)
            .fontColor($r('app.color.text_primary')).layoutWeight(1).textAlign(TextAlign.Start)
        if (this.answers[$$.index] === $$.option) {
            Image($r('app.media.ic_check')).width(Size.iconSmall).height(Size.iconSmall).fillColor($r('app.color.icon_brand'))
        }
    }

    @Builder
    private QuestionPanel($$: ReviewQuestionView) {
        Column({ space: Space.lg }) {
            Row({ space: Space.sm }) {
                Text('第 ' + ($$.index + 1) + ' 题').fontSize(FontSize.small).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_brand')).padding({ left: Space.sm, right: Space.sm, top: Space.xs, bottom: Space.xs })
                    .borderRadius(Radius.xs).backgroundColor($r('app.color.brand_soft'))
                Text(this.options($$.question).length > 0 ? '选择题' : '简答题')
                    .fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
                Blank()
                Text(this.questionStatus($$.question, $$.index)).fontSize(FontSize.small).fontColor(this.questionStatusColor($$.question, $$.index))
                    .id('agent_review_question_status_' + $$.index)
            }.width('100%')
            MarkdownView({ source: $$.question.content || $$.question.title }).width('100%')
            if (this.options($$.question).length > 0) {
                Column({ space: Space.sm }) {
                    ForEach(this.options($$.question), (option: string, optionIndex: number) => {
                        if (this.submitted || this.interrupted) {
                            Row({ space: Space.md }) {
                                this.OptionContent({ index: $$.index, option: option, optionIndex: optionIndex })
                            }.width('100%').constraintSize({ minHeight: Size.touchTarget }).alignItems(VerticalAlign.Top)
                            .padding(Space.md).borderRadius(Radius.md)
                            .border({ width: Size.divider, color: this.answers[$$.index] === option ? $r('app.color.brand_primary') : $r('app.color.border') })
                            .backgroundColor(this.answers[$$.index] === option ? $r('app.color.brand_soft') : $r('app.color.bg_sunken'))
                            .accessibilityText('第 ' + ($$.index + 1) + ' 题，选项 ' + String.fromCharCode(65 + optionIndex) + '，' + option +
                                (this.answers[$$.index] === option ? '，已选' : '') + '，只读')
                            .id('agent_review_option_' + $$.index + '_' + optionIndex)
                        } else {
                            Button({ type: ButtonType.Normal }) {
                                Row({ space: Space.md }) {
                                    this.OptionContent({ index: $$.index, option: option, optionIndex: optionIndex })
                                }.width('100%').alignItems(VerticalAlign.Top)
                            }.width('100%').height('auto').constraintSize({ minHeight: Size.touchTarget })
                            .padding(Space.md).borderRadius(Radius.md)
                            .border({ width: Size.divider, color: this.answers[$$.index] === option ? $r('app.color.brand_primary') : $r('app.color.border') })
                            .backgroundColor(this.answers[$$.index] === option ? $r('app.color.brand_soft') : $r('app.color.bg_sunken'))
                            .enabled(!this.submitting)
                            .onClick(() => { this.setAnswer($$.index, option); })
                            .accessibilityText('第 ' + ($$.index + 1) + ' 题，选项 ' + String.fromCharCode(65 + optionIndex) + '，' + option +
                                (this.answers[$$.index] === option ? '，已选' : ''))
                            .id('agent_review_option_' + $$.index + '_' + optionIndex)
                        }
                    }, (option: string, optionIndex: number) => option + ':' + optionIndex)
                }.width('100%')
            } else if (this.submitted || this.interrupted) {
                Column({ space: Space.sm }) {
                    Text('你的作答').fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
                    MarkdownView({ source: this.answers[$$.index] || '本页没有保留这道题的作答。' }).width('100%')
                }.width('100%').padding(Space.md).borderRadius(Radius.md).backgroundColor($r('app.color.bg_sunken'))
            } else {
                TextArea({ text: this.answers[$$.index] || '', placeholder: '用自己的话写下理解，不确定的地方也可以写出来' })
                    .width('100%').height(Size.inputMaxHeight).fontSize(FontSize.body).fontColor($r('app.color.text_primary'))
                    .placeholderColor($r('app.color.text_tertiary')).backgroundColor($r('app.color.bg_sunken'))
                    .padding(Space.md).borderRadius(Radius.md)
                    .border({ width: Size.divider, color: this.showBlankErrors && (this.answers[$$.index] || '').trim().length === 0
                        ? $r('app.color.text_danger') : $r('app.color.border') })
                    .enabled(!this.submitting).onChange((value: string) => { this.setAnswer($$.index, value); })
                    .accessibilityText('第 ' + ($$.index + 1) + ' 题的答案').id('agent_review_answer_' + $$.index)
            }
            if (this.submitted && $$.question.answer.length > 0) {
                Divider().color($r('app.color.divider')).strokeWidth(Size.divider)
                Column({ space: Space.sm }) {
                    Text('参考答案').fontSize(FontSize.small).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_secondary')).width('100%')
                    MarkdownView({ source: $$.question.answer }).width('100%')
                }.width('100%').id('agent_review_reference_' + $$.index)
            }
        }.padding(Space.lg).width('100%').borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start).id('agent_review_question_' + $$.index)
    }

    @Builder
    private ResultPanel() {
        Column({ space: Space.md }) {
            Row({ space: Space.sm }) {
                Image($r('app.media.ic_check')).width(Size.iconLarge).height(Size.iconLarge).fillColor($r('app.color.icon_brand'))
                Text('本轮作答已提交').fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
            }.width('100%')
            Text(this.resultText).fontSize(FontSize.display).fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary')).width('100%').id('agent_review_result_score')
            if (this.hasNumericScore()) {
                Text('答对 / 本轮题数').fontSize(FontSize.small).fontColor($r('app.color.text_secondary')).width('100%')
            }
            Text(this.resultNote).fontSize(FontSize.body).lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_secondary')).width('100%')
            if (this.uncertain.length > 0) {
                Column({ space: Space.sm }) {
                    Text('还有 ' + this.uncertain.length + ' 题待确认').fontSize(FontSize.body).fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary')).width('100%')
                    ForEach(this.uncertain, (item: UncertainItem, index: number) => {
                        Text(this.uncertainLabel(item) + '：' + item.why).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                            .fontColor($r('app.color.text_secondary')).width('100%').id('agent_review_uncertain_' + index)
                    }, (item: UncertainItem) => item.questionId)
                    Text('这些题目仍需核对，暂不代表已经掌握。')
                        .fontSize(FontSize.small).lineHeight(LineHeight.caption).fontColor($r('app.color.text_secondary')).width('100%')
                }.width('100%').padding(Space.md).borderRadius(Radius.md).backgroundColor($r('app.color.bg_sunken'))
            }
            this.Action({ label: '完成复习', identifier: 'agent_review_result_back', enabled: !this.submitting,
                primary: true, onTap: () => { this.onBack(); } })
            if (this.flowId.length === 0) {
                this.Action({ label: '再练一组', identifier: 'agent_review_result_again', enabled: !this.submitting && !this.generating,
                    primary: false, onTap: () => { void this.startReview(); } })
            } else if (this.resultText === '结果待同步') {
                this.Action({ label: '重新同步结果', identifier: 'agent_review_retry_result', enabled: !this.submitting,
                    primary: false, onTap: () => { void this.loadFlow(); } })
            }
        }.width('100%').padding(Space.xl).borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'))
        .id('agent_review_result')
    }
}
