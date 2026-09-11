// LearningPath.ets - 个性化学习路线
// 页面把课程里的两层「该学什么」合成一条阅读流：
//   路线（有则优先）—— 按什么顺序学。顺序本身就是个性化排序，另附 AI 的整体建议与每章取舍理由。
//   大纲（每门课都有）—— 课程要求掌握什么。给出学习目标、关键概念、难度与预计时长。
// 有路线时以路线顺序为准，并把大纲小节的「应掌握 / 关键概念」挂到对应章节上；
// 无路线时退回大纲顺序，页顶说明路线尚未生成——绝不把大纲顺序伪装成个性化排序。

import { LearningFormat } from '../../common/LearningFormat';
import {
    LearningOutline,
    LearningOutlineSection,
    LearningPathApi,
    LearningPathChapter,
} from '../../common/LearningPathApi';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder, ProgressTrack, SectionHeader, TagPill } from './LearningWidgets';

// 大纲空值哨兵：加载完成前不参与渲染，避免渲染层反复判空
const EMPTY_OUTLINE: LearningOutline = {
    courseTitle: '',
    lectureTitle: '',
    sections: [],
};

// 单卡最多展示的学习目标与关键概念：再多会把卡片撑成一堵墙，剩余以「+N」提示
const MAX_OBJECTIVES: number = 3;
const MAX_CONCEPTS: number = 4;

// 页面展示单元：路线章节与大纲小节归一到这里，卡片只认这一种结构
interface PathUnit {
    order: number;
    // 路线章节下标：>=0 表示这一单元能打开个性化素材（无路线时只有大纲，值取 -1）
    chapterIndex: number;
    contentGenerated: boolean;
    title: string;
    bookTitle: string;
    status: string;
    reason: string;
    objectives: string[];
    keyConcepts: string[];
    difficulty: string;
    estimatedMinutes: number;
}

@Component
export struct LearningPath {
    @Prop lectureId: string = '';
    @Prop lectureTitle: string = '';
    onBack: () => void = () => {};
    onOpenChapter: (lectureId: string, chapterIndex: number, chapterTitle: string,
        bookTitle: string) => void = () => {};

    @State private courseOutline: LearningOutline = EMPTY_OUTLINE;
    @State private advice: string = '';
    @State private chapters: LearningPathChapter[] = [];
    @State private cached: boolean = false;
    @State private units: PathUnit[] = [];
    @State private loading: boolean = true;
    @State private errorMessage: string = '';

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const outlineTask = LearningPathApi.shared.getOutline(this.lectureId);
        const pathTask = LearningPathApi.shared.getPath(this.lectureId);

        const outlineResult = await outlineTask;
        const pathResult = await pathTask;

        this.loading = false;

        // 大纲与路线都拿不到才算整体失败；只有一边缺失属于正常状态
        if (!outlineResult.success && !pathResult.success) {
            this.errorMessage = outlineResult.message;
            return;
        }

        this.courseOutline = outlineResult.outline === null ? EMPTY_OUTLINE : outlineResult.outline;
        this.cached = pathResult.cached;
        this.advice = pathResult.advice;
        this.chapters = pathResult.chapters;
        this.units = this.buildUnits();
    }

    // 有路线用路线顺序，否则退回大纲顺序
    private hasRoute(): boolean {
        return this.cached && this.chapters.length > 0;
    }

    private buildUnits(): PathUnit[] {
        if (this.hasRoute()) {
            return this.routeUnits();
        }

        return this.courseOutlineUnits();
    }

    private routeUnits(): PathUnit[] {
        const result: PathUnit[] = [];

        for (let i: number = 0; i < this.chapters.length; i++) {
            const chapter: LearningPathChapter = this.chapters[i];
            const section: LearningOutlineSection | null = this.matchSection(chapter.outlineSectionId);

            result.push({
                order: i + 1,
                chapterIndex: chapter.index,
                contentGenerated: chapter.contentGenerated,
                title: chapter.name,
                bookTitle: chapter.bookTitle,
                status: chapter.status,
                reason: chapter.reason,
                objectives: section === null ? [] : section.objectives,
                keyConcepts: section === null ? [] : section.keyConcepts,
                difficulty: section === null ? '' : section.difficulty,
                estimatedMinutes: section === null ? 0 : section.estimatedMinutes,
            });
        }

        return result;
    }

    private courseOutlineUnits(): PathUnit[] {
        const result: PathUnit[] = [];

        for (let i: number = 0; i < this.courseOutline.sections.length; i++) {
            const section: LearningOutlineSection = this.courseOutline.sections[i];

            result.push({
                order: i + 1,
                chapterIndex: -1,
                contentGenerated: false,
                title: section.title,
                bookTitle: section.sources.length > 0 ? section.sources[0].bookTitle : '',
                status: '',
                reason: section.summary,
                objectives: section.objectives,
                keyConcepts: section.keyConcepts,
                difficulty: section.difficulty,
                estimatedMinutes: section.estimatedMinutes,
            });
        }

        return result;
    }

    // 后端两处小节编号补零位数不一致：大纲为 sec_001，路线章节存 sec_01。
    // 直接比字符串会全部落空，按尾部数字比较才能对上。
    private matchSection(outlineSectionId: string): LearningOutlineSection | null {
        const target: number = LearningPath.ordinalOf(outlineSectionId);

        if (target < 0) {
            return null;
        }

        for (let i: number = 0; i < this.courseOutline.sections.length; i++) {
            if (LearningPath.ordinalOf(this.courseOutline.sections[i].id) === target) {
                return this.courseOutline.sections[i];
            }
        }

        return null;
    }

    // 取标识里的数字部分：sec_01 / sec_001 都归到 1
    private static ordinalOf(sectionId: string): number {
        let digits: string = '';

        for (let i: number = 0; i < sectionId.length; i++) {
            const ch: string = sectionId.charAt(i);

            if (ch >= '0' && ch <= '9') {
                digits = digits + ch;
            }
        }

        if (digits.length === 0) {
            return -1;
        }

        return parseInt(digits, 10);
    }

    private completedCount(): number {
        let count: number = 0;

        for (let i: number = 0; i < this.chapters.length; i++) {
            if (this.chapters[i].learningCompleted) {
                count = count + 1;
            }
        }

        return count;
    }

    private generatedCount(): number {
        let count: number = 0;

        for (let i: number = 0; i < this.chapters.length; i++) {
            if (this.chapters[i].contentGenerated) {
                count = count + 1;
            }
        }

        return count;
    }

    build() {
        Column() {
            this.TopBar()

            if (this.loading) {
                LoadingBlock({ label: '正在整理学习路线' });
            } else if (this.errorMessage.length > 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '学习路线加载失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else if (this.units.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_target'),
                    title: '这门课程还没有学习规划',
                    hint: '在 NexoraLearning 工作台生成课程大纲后，这里会给出该学什么',
                });
            } else {
                Scroll() {
                    Column({ space: Space.lg }) {
                        if (this.hasRoute()) {
                            this.AdviceSection()
                            this.RouteProgress()
                        } else {
                            this.NoRouteNotice()
                        }

                        this.UnitSection()
                    }
                    .width('100%')
                    .padding({ left: Space.lg, right: Space.lg, top: Space.sm, bottom: Space.md })
                    .alignItems(HorizontalAlign.Start);
                }
                .width('100%')
                .layoutWeight(1)
                .scrollBar(BarState.Off);
            }
        }
        .width('100%')
        .height('100%');
    }

    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.iconLarge,
                buttonSize: Size.touchTarget,
                tint: $r('app.color.icon_primary'),
                onTap: () => {
                    this.onBack();
                }
            })

            Text('学习路线')
                .fontSize(FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .margin({ left: Space.xs });
        }
        .width('100%')
        .height(48)
        .padding({ left: Space.sm, right: Space.lg })
        .alignItems(VerticalAlign.Center);
    }

    // 路线建议：AI 依据画像与已学进度给出的整体方向
    @Builder
    AdviceSection() {
        if (this.advice.length > 0) {
            Column({ space: Space.md }) {
                SectionHeader({
                    title: '路线建议',
                    subtitle: this.lectureTitle.length > 0 ? this.lectureTitle : this.courseOutline.lectureTitle,
                });

                Row({ space: Space.md }) {
                    Image($r('app.media.ic_spark'))
                        .width(Size.icon)
                        .height(Size.icon)
                        .fillColor($r('app.color.brand_primary'))
                        .margin({ top: 2 });

                    Text(this.advice)
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_primary'))
                        .lineHeight(LineHeight.body)
                        .layoutWeight(1);
                }
                .width('100%')
                .padding(Space.lg)
                .borderRadius(Radius.lg)
                .backgroundColor($r('app.color.brand_soft'))
                .alignItems(VerticalAlign.Top);
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start);
        }
    }

    // 章节进度：完成度与素材就绪度分开说，两者含义不同
    @Builder
    RouteProgress() {
        Column({ space: Space.md }) {
            Row() {
                Text('已完成 ' + this.completedCount() + ' / ' + this.chapters.length + ' 章')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_primary'))
                    .layoutWeight(1);

                Text(LearningFormat.percent(this.chapters.length === 0
                    ? 0
                    : this.completedCount() / this.chapters.length))
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_brand'));
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            ProgressTrack({
                ratio: this.chapters.length === 0 ? 0 : this.completedCount() / this.chapters.length,
                trackHeight: 6,
            });

            Text(this.generatedCount() + ' 章学习素材已就绪')
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_tertiary'))
                .width('100%');
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start);
    }

    // 无路线说明：讲清下方列表来自大纲，不是排过序的个性化路线
    @Builder
    NoRouteNotice() {
        Row({ space: Space.md }) {
            Image($r('app.media.ic_target'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.icon_secondary'))
                .margin({ top: 2 });

            Column({ space: Space.xs }) {
                Text('这门课程还没有你的个性化学习路线')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_primary'))
                    .width('100%');

                Text('下方为课程大纲本身的内容规划，未按你的画像与进度重排')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .lineHeight(LineHeight.caption)
                    .width('100%');
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_sunken'))
        .alignItems(VerticalAlign.Top);
    }

    @Builder
    UnitSection() {
        Column({ space: Space.md }) {
            SectionHeader({
                title: this.hasRoute() ? '学习章节' : '课程大纲',
                subtitle: this.units.length + ' 个学习单元',
            });

            ForEach(this.units, (unit: PathUnit) => {
                this.UnitCard(unit)
            }, (unit: PathUnit) => 'unit_' + unit.order + '_' + unit.title);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start);
    }

    @Builder
    UnitCard(unit: PathUnit) {
        Column({ space: Space.md }) {
            Row({ space: Space.md }) {
                Text(unit.order + '')
                    .fontSize(FontSize.caption)
                    .fontColor(this.ordinalFg(unit.status))
                    .width(26)
                    .height(26)
                    .textAlign(TextAlign.Center)
                    .borderRadius(Radius.xs)
                    .backgroundColor(this.ordinalBg(unit.status));

                Column({ space: Space.xxs }) {
                    Text(unit.title)
                        .fontSize(FontSize.body)
                        .fontWeight(FontWeight.Medium)
                        .fontColor($r('app.color.text_primary'))
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%');

                    if (unit.bookTitle.length > 0) {
                        Text(unit.bookTitle)
                            .fontSize(FontSize.caption)
                            .fontColor($r('app.color.text_tertiary'))
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%');
                    }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start);

                if (this.statusText(unit.status).length > 0) {
                    TagPill({
                        text: this.statusText(unit.status),
                        tint: this.statusTint(unit.status),
                        bg: this.statusBg(unit.status),
                    })
                }
            }
            .width('100%')
            .alignItems(VerticalAlign.Top);

            if (unit.objectives.length > 0) {
                Column({ space: Space.sm }) {
                    Text('应掌握')
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'));

                    ForEach(unit.objectives.slice(0, MAX_OBJECTIVES), (line: string) => {
                        Row({ space: Space.sm }) {
                            Column()
                                .width(4)
                                .height(4)
                                .borderRadius(2)
                                .backgroundColor($r('app.color.brand_primary'))
                                .margin({ top: 6 });

                            Text(line)
                                .fontSize(FontSize.small)
                                .fontColor($r('app.color.text_secondary'))
                                .lineHeight(LineHeight.caption)
                                .layoutWeight(1);
                        }
                        .width('100%')
                        .alignItems(VerticalAlign.Top);
                    }, (line: string) => 'obj_' + unit.order + '_' + line);
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start);
            }

            if (unit.keyConcepts.length > 0) {
                Flex({ wrap: FlexWrap.Wrap }) {
                    ForEach(unit.keyConcepts.slice(0, MAX_CONCEPTS), (concept: string) => {
                        Column() {
                            TagPill({ text: concept })
                        }
                        .margin({ right: Space.xs, bottom: Space.xs });
                    }, (concept: string) => 'kc_' + unit.order + '_' + concept);

                    if (unit.keyConcepts.length > MAX_CONCEPTS) {
                        Text('+' + (unit.keyConcepts.length - MAX_CONCEPTS))
                            .fontSize(FontSize.micro)
                            .fontColor($r('app.color.text_tertiary'))
                            .margin({ top: Space.xs });
                    }
                }
                .width('100%');
            }

            // 取舍理由：AI 为什么把这一章排在这个位置
            if (unit.reason.length > 0) {
                Text(unit.reason)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .lineHeight(LineHeight.caption)
                    .width('100%')
                    .border({ width: { left: 2 }, color: $r('app.color.brand_primary') })
                    .padding({ left: Space.md });
            }

            if (this.metaText(unit).length > 0) {
                Text(this.metaText(unit))
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'))
                    .width('100%');
            }

            // 素材状态与入口：能读的单元才给箭头，避免点了没有反应
            if (unit.chapterIndex >= 0) {
                Row({ space: Space.xs }) {
                    Text(unit.contentGenerated ? '学习素材已就绪' : '学习素材未生成，点击生成')
                        .fontSize(FontSize.micro)
                        .fontColor(unit.contentGenerated
                            ? $r('app.color.text_brand')
                            : $r('app.color.text_tertiary'))
                        .layoutWeight(1);

                    Image($r('app.media.ic_chevron_right'))
                        .width(Size.iconSmall)
                        .height(Size.iconSmall)
                        .fillColor($r('app.color.icon_secondary'));
                }
                .width('100%')
                .alignItems(VerticalAlign.Center);
            }
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
            if (unit.chapterIndex < 0) {
                return;
            }

            this.onOpenChapter(this.lectureId, unit.chapterIndex, unit.title, unit.bookTitle);
        });
    }

    private metaText(unit: PathUnit): string {
        const duration: string = unit.estimatedMinutes > 0
            ? '约 ' + LearningFormat.hours(unit.estimatedMinutes / 60)
            : '';

        if (unit.difficulty.length > 0 && duration.length > 0) {
            return unit.difficulty + ' · ' + duration;
        }

        return unit.difficulty.length > 0 ? unit.difficulty : duration;
    }

    private ordinalBg(status: string): ResourceColor {
        if (status === 'current') {
            return $r('app.color.brand_primary');
        }

        if (status === 'completed') {
            return $r('app.color.brand_soft');
        }

        return $r('app.color.bg_sunken');
    }

    private ordinalFg(status: string): ResourceColor {
        if (status === 'current') {
            return $r('app.color.text_inverse');
        }

        if (status === 'completed') {
            return $r('app.color.text_brand');
        }

        return $r('app.color.text_secondary');
    }

    private statusText(status: string): string {
        if (status === 'completed') {
            return '已学完';
        }

        if (status === 'current') {
            return '进行中';
        }

        if (status === 'recommended') {
            return '建议下一章';
        }

        if (status === 'pending') {
            return '待开始';
        }

        return '';
    }

    private statusTint(status: string): ResourceColor {
        if (status === 'current') {
            return $r('app.color.text_inverse');
        }

        if (status === 'recommended') {
            return $r('app.color.warning');
        }

        if (status === 'completed') {
            return $r('app.color.brand_text');
        }

        return $r('app.color.text_secondary');
    }

    private statusBg(status: string): ResourceColor {
        if (status === 'current') {
            return $r('app.color.brand_primary');
        }

        if (status === 'completed') {
            return $r('app.color.brand_soft');
        }

        return $r('app.color.bg_sunken');
    }
}
