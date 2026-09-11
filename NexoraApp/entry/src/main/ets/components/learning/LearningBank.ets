// LearningBank.ets - 题库（筛选 + 作答 + 判题反馈）
// 题目选项由题干正文抽取（后端把选项内联在 question_content 中），选择或是填空都走同一个提交接口：
// 能自动判题时给出对错与正确项，主观题只回执已提交并给出参考答案。

import {
    BankFilter,
    emptyBank,
    LearningBankApi,
    LearningBankItem,
    LearningBankSummary,
    LearningOption,
} from '../../common/LearningBankApi';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { LoadingBlock, Placeholder, ProgressTrack, StatTile } from './LearningWidgets';

const PAGE_SIZE: number = 8;

interface BankFilterOption {
    value: string;
    label: string;
}

const FILTERS: BankFilterOption[] = [
    { value: BankFilter.ALL, label: '全部' },
    { value: BankFilter.PENDING, label: '待作答' },
    { value: BankFilter.SUBMITTED, label: '已提交' },
    { value: BankFilter.NEEDS_REVIEW, label: '待复习' },
];

// 列表项：题目本体 + 本地作答状态（草稿、提交结果），提交后答案区常驻展示
interface BankEntry {
    item: LearningBankItem;
    draft: string;
    submitted: boolean;
    hasVerdict: boolean;
    correct: boolean;
    reference: string;
}

@Component
export struct LearningBank {
    @State private entries: BankEntry[] = [];
    @State private summary: LearningBankSummary = emptyBank().summary;
    @State private filter: string = BankFilter.PENDING;
    @State private page: number = 1;
    @State private hasNext: boolean = false;
    @State private loading: boolean = true;
    @State private loadingMore: boolean = false;
    @State private submittingIndex: number = -1;
    @State private errorMessage: string = '';

    aboutToAppear(): void {
        this.load(true).then(() => {
        });
    }

    private async load(reset: boolean): Promise<void> {
        if (reset) {
            this.loading = true;
            this.page = 1;
            this.errorMessage = '';
        } else {
            this.loadingMore = true;
        }

        const result = await LearningBankApi.shared.getItems(this.page, PAGE_SIZE, this.filter);

        this.loading = false;
        this.loadingMore = false;

        if (!result.success) {
            this.errorMessage = result.message;
            return;
        }

        const next: BankEntry[] = reset ? [] : this.entries.slice();

        for (let i: number = 0; i < result.items.length; i++) {
            next.push({
                item: result.items[i],
                draft: '',
                submitted: false,
                hasVerdict: false,
                correct: false,
                reference: '',
            });
        }

        this.entries = next;
        this.summary = result.summary;
        this.hasNext = result.hasNext;
    }

    private changeFilter(value: string): void {
        if (this.filter === value) {
            return;
        }

        this.filter = value;
        this.entries = [];
        this.load(true).then(() => {
        });
    }

    private loadMore(): void {
        if (!this.hasNext || this.loadingMore) {
            return;
        }

        this.page = this.page + 1;
        this.load(false).then(() => {
        });
    }

    // 草稿与结果都是新对象：@State 数组按元素替换才可靠触发重渲染
    private patchDraft(index: number, draft: string): void {
        const current: BankEntry = this.entries[index];

        this.replaceEntry(index, {
            item: current.item,
            draft: draft,
            submitted: current.submitted,
            hasVerdict: current.hasVerdict,
            correct: current.correct,
            reference: current.reference,
        });
    }

    private patchResult(index: number, hasVerdict: boolean, correct: boolean, reference: string): void {
        const current: BankEntry = this.entries[index];

        this.replaceEntry(index, {
            item: current.item,
            draft: current.draft,
            submitted: true,
            hasVerdict: hasVerdict,
            correct: correct,
            reference: reference,
        });
    }

    private replaceEntry(index: number, entry: BankEntry): void {
        const next: BankEntry[] = this.entries.slice();

        next[index] = entry;
        this.entries = next;
    }

    private async submit(index: number): Promise<void> {
        const entry: BankEntry = this.entries[index];

        if (entry.submitted || entry.draft.length === 0 || this.submittingIndex >= 0) {
            return;
        }

        this.submittingIndex = index;

        const result = await LearningBankApi.shared.submit(entry.item.questionId, entry.draft);

        this.submittingIndex = -1;

        if (!result.success) {
            this.errorMessage = result.message;
            return;
        }

        this.patchResult(index, result.hasVerdict, result.correct, result.referenceAnswer);
        this.summary = {
            total: this.summary.total,
            pending: this.summary.pending > 0 ? this.summary.pending - 1 : 0,
            submitted: this.summary.submitted + 1,
            needsReview: this.summary.needsReview,
        };
    }

    build() {
        Column() {
            this.Header()
            this.Filters()

            if (this.loading) {
                LoadingBlock({ label: '正在加载题目' });
            } else if (this.errorMessage.length > 0 && this.entries.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '题目加载失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load(true).then(() => {
                        });
                    }
                });
            } else if (this.entries.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_target'),
                    title: '这个筛选下没有题目',
                    hint: '换个筛选条件看看，或到课程里继续学习以生成新题',
                });
            } else {
                List({ space: Space.md }) {
                    ForEach(this.entries, (entry: BankEntry, index: number) => {
                        ListItem() {
                            this.QuestionCard(entry, index)
                        }
                    }, (entry: BankEntry) => 'q_' + entry.item.questionId)

                    if (this.hasNext) {
                        ListItem() {
                            Text(this.loadingMore ? '加载中…' : '加载更多')
                                .fontSize(FontSize.small)
                                .fontColor($r('app.color.text_brand'))
                                .width('100%')
                                .height(44)
                                .textAlign(TextAlign.Center)
                                .borderRadius(Radius.md)
                                .backgroundColor($r('app.color.bg_card'))
                                .onClick(() => {
                                    this.loadMore();
                                });
                        }
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off)
                .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.md });
            }
        }
        .width('100%')
        .height('100%');
    }

    // 题库速览：待作答 / 已提交 / 待复习 三项统计 + 完成度。
    // 这三项原本摊在首页，现收进题库页顶端——下方筛选项就是这三个维度，
    // 统计与对应筛选挨在一起才读得通，也免得同一份数据在两页各说一遍。
    @Builder
    Header() {
        Column({ space: Space.md }) {
            Row() {
                StatTile({
                    value: this.summary.pending + '',
                    label: '待作答',
                    tint: $r('app.color.text_brand'),
                });

                StatTile({
                    value: this.summary.submitted + '',
                    label: '已提交',
                    tint: $r('app.color.text_primary'),
                });

                StatTile({
                    value: this.summary.needsReview + '',
                    label: '待复习',
                    tint: $r('app.color.warning'),
                });
            }
            .width('100%');

            Column({ space: Space.sm }) {
                ProgressTrack({
                    ratio: this.summary.total <= 0 ? 0 : this.summary.submitted / this.summary.total,
                    trackHeight: 4,
                });

                Text('共 ' + this.summary.total + ' 题 · 已提交 ' + this.summary.submitted + ' 题')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .width('100%');
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.lg)
        .margin({ left: Space.lg, right: Space.lg, top: Space.md })
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    Filters() {
        Scroll() {
            Row({ space: Space.sm }) {
                ForEach(FILTERS, (option: BankFilterOption) => {
                    Text(option.label)
                        .fontSize(FontSize.small)
                        .fontColor(this.filter === option.value
                            ? $r('app.color.text_brand')
                            : $r('app.color.text_secondary'))
                        .padding({ left: Space.md, right: Space.md, top: Space.sm, bottom: Space.sm })
                        .borderRadius(Radius.full)
                        .backgroundColor(this.filter === option.value
                            ? $r('app.color.brand_soft')
                            : $r('app.color.bg_card'))
                        .onClick(() => {
                            this.changeFilter(option.value);
                        });
                }, (option: BankFilterOption) => 'filter_' + option.value);
            }
            .padding({ left: Space.lg, right: Space.lg });
        }
        .width('100%')
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .align(Alignment.Start)
        .padding({ top: Space.md, bottom: Space.md });
    }

    // ---------- 题目卡 ----------
    @Builder
    QuestionCard(entry: BankEntry, index: number) {
        Column({ space: Space.md }) {
            Row({ space: Space.sm }) {
                if (entry.item.chapterName.length > 0) {
                    Text(entry.item.chapterName)
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_brand'))
                        .padding({ left: Space.sm, right: Space.sm, top: Space.xxs, bottom: Space.xxs })
                        .borderRadius(Radius.xs)
                        .backgroundColor($r('app.color.brand_soft'));
                }

                if (entry.item.question.difficulty.length > 0) {
                    Text(entry.item.question.difficulty)
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));
                }

                Blank();

                Text(this.stateLabel(entry))
                    .fontSize(FontSize.micro)
                    .fontColor(this.stateColor(entry));
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            Text(entry.item.question.title.length > 0
                ? entry.item.question.title
                : entry.item.question.stem)
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_primary'))
                .lineHeight(LineHeight.body)
                .width('100%');

            Text(entry.item.question.stem)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .lineHeight(20)
                .width('100%')
                .visibility(entry.item.question.title.length > 0 && entry.item.question.stem.length > 0
                    ? Visibility.Visible
                    : Visibility.None);

            if (entry.item.question.isChoice) {
                this.Options(entry, index)
            } else {
                this.FreeAnswer(entry, index)
            }

            if (!entry.submitted) {
                this.SubmitAction(entry, index)
            } else {
                this.AnswerPanel(entry)
            }
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    Options(entry: BankEntry, index: number) {
        Column({ space: Space.sm }) {
            ForEach(entry.item.question.options, (option: LearningOption) => {
                Row({ space: Space.sm }) {
                    Text(option.label)
                        .fontSize(FontSize.small)
                        .fontColor(this.optionTextColor(entry, option))
                        .width(24)
                        .height(24)
                        .textAlign(TextAlign.Center)
                        .borderRadius(Radius.full)
                        .backgroundColor(this.optionBadgeColor(entry, option));

                    Text(option.text)
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_primary'))
                        .lineHeight(20)
                        .layoutWeight(1);
                }
                .width('100%')
                .padding(Space.sm)
                .borderRadius(Radius.sm)
                .borderWidth(this.isPicked(entry, option) ? 1 : 0)
                .borderColor($r('app.color.brand_primary'))
                .alignItems(VerticalAlign.Top)
                .onClick(() => {
                    if (!entry.submitted) {
                        this.patchDraft(index, option.label);
                    }
                });
            }, (option: LearningOption) => 'opt_' + entry.item.questionId + '_' + option.label);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    // 非选择题作答输入：不加受控 text 回写，避免逐字符输入时光标被重置到末尾
    @Builder
    FreeAnswer(entry: BankEntry, index: number) {
        TextInput({ placeholder: '写下你的答案' })
            .fontSize(FontSize.small)
            .height(44)
            .borderRadius(Radius.sm)
            .backgroundColor($r('app.color.bg_sunken'))
            .enabled(!entry.submitted)
            .onChange((value: string) => {
                this.patchDraft(index, value);
            });
    }

    // 提交入口：选项点选后仍需显式提交，避免误触直接判题
    @Builder
    SubmitAction(entry: BankEntry, index: number) {
        Text(this.submittingIndex === index ? '提交中…' : '提交作答')
            .fontSize(FontSize.small)
            .fontColor($r('app.color.text_inverse'))
            .width('100%')
            .height(40)
            .textAlign(TextAlign.Center)
            .borderRadius(Radius.sm)
            .backgroundColor($r('app.color.brand_primary'))
            .opacity(entry.draft.length === 0 ? 0.45 : 1)
            .onClick(() => {
                this.submit(index).then(() => {
                });
            });
    }

    @Builder
    AnswerPanel(entry: BankEntry) {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                Image(this.verdictIcon(entry))
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .fillColor(this.stateColor(entry));

                Text(this.verdictLabel(entry))
                    .fontSize(FontSize.small)
                    .fontColor(this.stateColor(entry));
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            if (entry.reference.length > 0) {
                Column({ space: Space.xxs }) {
                    Text('参考答案')
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));

                    Text(entry.reference)
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_primary'))
                        .lineHeight(20)
                        .width('100%');
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start);
            }

            if (entry.item.question.reason.length > 0) {
                Column({ space: Space.xxs }) {
                    Text('解析')
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));

                    Text(entry.item.question.reason)
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_secondary'))
                        .lineHeight(20)
                        .width('100%');
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start);
            }
        }
        .width('100%')
        .padding(Space.md)
        .borderRadius(Radius.sm)
        .backgroundColor($r('app.color.bg_sunken'))
        .alignItems(HorizontalAlign.Start);
    }

    // ---------- 状态派生 ----------
    private stateLabel(entry: BankEntry): string {
        if (entry.submitted) {
            return entry.hasVerdict ? (entry.correct ? '正确' : '错误') : '已提交';
        }

        return entry.item.answerState === 'submitted' ? '已作答' : '待作答';
    }

    private stateColor(entry: BankEntry): ResourceColor {
        if (!entry.submitted) {
            return $r('app.color.text_tertiary');
        }

        if (!entry.hasVerdict) {
            return $r('app.color.text_brand');
        }

        return entry.correct ? $r('app.color.success') : $r('app.color.danger');
    }

    private verdictIcon(entry: BankEntry): ResourceStr {
        return entry.hasVerdict && !entry.correct ? $r('app.media.ic_close') : $r('app.media.ic_check');
    }

    private verdictLabel(entry: BankEntry): string {
        if (!entry.hasVerdict) {
            return '已提交，等待批阅';
        }

        return entry.correct ? '回答正确' : '回答错误';
    }

    private isPicked(entry: BankEntry, option: LearningOption): boolean {
        if (!entry.submitted) {
            return entry.draft === option.label;
        }

        return this.isCorrectOption(entry, option) || entry.draft === option.label;
    }

    private isCorrectOption(entry: BankEntry, option: LearningOption): boolean {
        return LearningBankApi.answerLetter(entry.item.question.answer) === option.label;
    }

    // 提交前只高亮所选；提交后正确项与错选项各自着色，答错也看得见自己选了什么
    private optionTextColor(entry: BankEntry, option: LearningOption): ResourceColor {
        return this.isPicked(entry, option) ? $r('app.color.text_inverse') : $r('app.color.text_secondary');
    }

    private optionBadgeColor(entry: BankEntry, option: LearningOption): ResourceColor {
        if (!entry.submitted) {
            return entry.draft === option.label ? $r('app.color.brand_primary') : $r('app.color.chip_bg');
        }

        if (this.isCorrectOption(entry, option)) {
            return $r('app.color.brand_primary');
        }

        if (entry.draft === option.label) {
            return $r('app.color.danger');
        }

        return $r('app.color.chip_bg');
    }
}
