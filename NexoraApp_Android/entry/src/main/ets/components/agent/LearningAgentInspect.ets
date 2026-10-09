import { TimelineEntry, EvidenceRef } from '../../common/LearningAgentModels';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { LearningFormat } from '../../common/LearningFormat';
import { IconButton } from '../common/IconButton';
import { Placeholder, SectionHeader, TagPill } from '../learning/LearningWidgets';

// A recommendation explains its saved evidence, independently of today's learner profile.
@Component
export struct LearningAgentInspect {
    @Prop entry: TimelineEntry | null = null;
    @StorageProp('insetBottom') private insetBottom: number = 0;
    onClose: () => void = () => {};
    @State private contextExpanded: boolean = false;

    private sourceLabel(source: string): string {
        if (source === 'reading') { return '阅读记录'; }
        if (source === 'progress') { return '学习记录'; }
        if (source === 'quiz' || source === 'review') { return '作答记录'; }
        if (['memory', 'conversation', 'app', 'user_message'].indexOf(source) >= 0) { return '你的表述'; }
        if (source === 'reflection') { return '回顾与推断'; }
        if (source === 'confusion') { return '提问记录'; }
        return '参考记录';
    }

    private eventTime(timestamp: number): string {
        if (!Number.isFinite(timestamp) || timestamp <= 0) { return ''; }
        return LearningFormat.moment(timestamp > 100000000000 ? timestamp / 1000 : timestamp);
    }

    private reasonText(): string {
        return this.entry !== null && this.entry.reason ? this.entry.reason.trim() : '';
    }

    private evidenceItems(): EvidenceRef[] {
        if (this.entry === null) { return []; }
        return (this.entry.evidence || []).filter((evidence: EvidenceRef): boolean =>
            (evidence.label || '').trim().length > 0 || (evidence.detail || '').trim().length > 0);
    }

    private contextLabel(raw: string, isScene: boolean): string {
        const label: string = raw.trim();
        const value: string = label.toLowerCase();
        if (value === 'unknown') { return '未获取'; }
        if (value === 'unavailable') { return '暂不可用'; }
        if (value === 'denied' || value === 'blocked' || value === 'unauthorized') { return '未授权'; }
        if (value === 'unsupported') { return '设备暂不支持'; }
        if (isScene) {
            if (value === 'normal') { return '日常'; }
            if (value === 'dnd') { return '免打扰'; }
            if (value === 'study') { return '学习'; }
            if (value === 'sleep') { return '睡眠'; }
        } else {
            if (value === 'home') { return '家中'; }
            if (value === 'school') { return '学校'; }
        }
        return /[\u3400-\u9FFF]/.test(label) ? label : '未提供';
    }

    private contextText(): string {
        if (this.entry === null || this.entry.context === undefined || this.entry.context === null) { return ''; }
        const context = this.entry.context;
        const lines: string[] = [];
        if (context.time) { lines.push(context.time + ' ' + (context.weekday || '')); }
        if (context.scene) { lines.push('场景：' + this.contextLabel(context.scene, true)); }
        if (context.location) { lines.push('位置：' + this.contextLabel(context.location, false)); }
        if (context.dnd) { lines.push('当时开启免打扰'); }
        if ((context.calendar || []).length > 0) { lines.push('当时的日程：' + context.calendar.join('；')); }
        if ((context.at_risk || []).length > 0) { lines.push('建议复习：' + context.at_risk.join('、')); }
        if ((context.confusion || []).length > 0) { lines.push('已有疑问：' + context.confusion.join('、')); }
        return lines.join('\n');
    }

    @Builder
    Header() {
        Column({ space: Space.xs }) {
            Row().width(Size.touchTarget).height(Space.xs).borderRadius(Radius.full)
                .backgroundColor($r('app.color.border_strong')).margin({ top: Space.sm });
            Row({ space: Space.sm }) {
                Text('依据与说明').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).layoutWeight(1);
                IconButton({ icon: $r('app.media.ic_close'), tint: $r('app.color.icon_primary'),
                    onTap: () => { this.onClose(); }
                }).id('agent_inspect_close').accessibilityText('关闭依据与说明');
            }.width('100%').padding({ left: Space.lg, right: Space.sm });
        }.width('100%');
    }

    @Builder
    EvidenceItem(evidence: EvidenceRef) {
        Column({ space: Space.xs }) {
            Text(this.sourceLabel(evidence.source)).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_brand')).width('100%');
            Text(evidence.label || evidence.detail || '').fontSize(FontSize.body).lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_primary')).width('100%');
            if (evidence.detail && evidence.label && evidence.detail !== evidence.label) {
                Text(evidence.detail).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_secondary')).width('100%');
            }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.md)
            .borderRadius(Radius.md).backgroundColor($r('app.color.bg_sunken'));
    }

    @Builder
    EntryEvidence() {
        if (this.entry !== null) {
            Column({ space: Space.md }) {
                Row() {
                    TagPill({ text: '这条记录', tint: $r('app.color.text_brand'), bg: $r('app.color.brand_soft') });
                    Blank();
                    Text(this.eventTime(this.entry.ts)).fontSize(FontSize.small).fontColor($r('app.color.text_secondary'));
                }.width('100%');
                if (this.entry.text.length > 0) {
                    Text(this.entry.text).fontSize(FontSize.bodyLarge).fontWeight(FontWeight.Medium)
                        .lineHeight(LineHeight.body).fontColor($r('app.color.text_primary')).width('100%')
                        .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                if (this.reasonText().length > 0) {
                    Text(this.reasonText()).fontSize(FontSize.body).lineHeight(LineHeight.body)
                        .fontColor($r('app.color.text_secondary')).width('100%').id('agent_inspect_reason');
                }
                if (this.evidenceItems().length > 0) {
                    SectionHeader({ title: '参考了这些信息' });
                    ForEach(this.evidenceItems(), (evidence: EvidenceRef) => {
                        this.EvidenceItem(evidence);
                    }, (evidence: EvidenceRef, index: number) => evidence.source + ':' + evidence.label + ':' + index);
                } else if (this.reasonText().length === 0) {
                    Text('这条记录暂未保存具体依据。').fontSize(FontSize.body).lineHeight(LineHeight.body)
                        .fontColor($r('app.color.text_secondary')).width('100%').id('agent_inspect_no_evidence');
                }
                if (this.contextText().length > 0) {
                    Button(this.contextExpanded ? '收起当时的情况' : '查看当时的情况', { type: ButtonType.Normal })
                        .fontSize(FontSize.small).fontColor($r('app.color.text_brand')).backgroundColor(Color.Transparent)
                        .constraintSize({ minHeight: Size.touchTarget }).width('100%')
                        .id('agent_inspect_context_toggle').onClick(() => { this.contextExpanded = !this.contextExpanded; });
                    if (this.contextExpanded) {
                        Text(this.contextText()).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                            .fontColor($r('app.color.text_secondary')).width('100%').id('agent_inspect_context');
                    }
                }
            }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
                .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
        }
    }

    build() {
        Column() {
            this.Header();
            Scroll() {
                Column({ space: Space.md }) {
                    if (this.entry !== null) {
                        this.EntryEvidence();
                    } else {
                        Placeholder({ icon: $r('app.media.ic_spark'), title: '这条记录暂不可用',
                            hint: '返回今日，查看最近的学习建议。' });
                    }
                }.width('100%').alignItems(HorizontalAlign.Start)
                    .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.xxl + this.insetBottom });
            }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off).id('agent_inspect_scroll');
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page')).id('agent_inspect_page');
    }
}
