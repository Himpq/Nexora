// NotesPage.ets - 轻量随笔页
// 列表按日期分组，编辑态只保留正文输入与自动保存，不引入知识库的标题/预览/菜单体系

import { common } from '@kit.AbilityKit';
import { AppState } from '../../common/AppState';
import { NoteItem } from '../../common/AppConfig';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { TimeUtil } from '../../common/TimeUtil';
import { VoiceRecognizerService } from '../../common/VoiceRecognizerService';
import { IconButton } from '../common/IconButton';

const ONE_DAY_MS: number = 24 * 60 * 60 * 1000;

@Component
export struct NotesPage {
    @ObjectLink app: AppState;
    @Link @Watch('onEditorOpenChanged') noteEditorOpen: boolean;
    onBack: () => void = () => {};
    @Prop launchEditor: boolean = false;

    @State private searchDraft: string = '';
    @State private activeNoteId: string = '';
    @State private contentDraft: string = '';
    @State private saveLabel: string = '自动保存';
    @State private pressedNoteId: string = '';
    @State private voiceListening: boolean = false;
    @State private voiceError: string = '';
    @State private voiceLevels: number[] = [0.15, 0.22, 0.32, 0.18, 0.28, 0.14, 0.2, 0.3, 0.16, 0.24, 0.18, 0.28, 0.2, 0.14, 0.26, 0.18, 0.22, 0.15];
    private saveTimer: number = -1;
    private voiceBaseText: string = '';
    private voiceCommittedText: string = '';
    private voiceDraftText: string = '';
    private readonly voiceService: VoiceRecognizerService = new VoiceRecognizerService();

    aboutToAppear(): void {
        if (this.launchEditor && this.noteEditorOpen) {
            this.prepareNewNote();
        }
    }

    aboutToDisappear(): void {
        this.clearSaveTimer();
        this.voiceService.cancel();
    }

    build() {
        Column() {
            this.TopBar();

            if (this.noteEditorOpen) {
                Column() {
                    this.EditorArea();
                }
                .width('100%')
                .layoutWeight(1)
                .transition(TransitionEffect.asymmetric(
                    TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY),
                    TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                ).animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            } else {
                Column() {
                    this.ListArea();
                }
                .width('100%')
                .layoutWeight(1)
                .transition(TransitionEffect.asymmetric(
                    TransitionEffect.translate({ x: '-100%' }).combine(TransitionEffect.OPACITY),
                    TransitionEffect.translate({ x: '-100%' }).combine(TransitionEffect.OPACITY)
                ).animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            }
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'))
        .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
    }

    // 顶栏：列表态新建，编辑态显示自动保存状态；返回键由本组件先处理编辑态
    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.icon,
                buttonSize: Size.touchTarget,
                onTap: () => {
                    this.handleBack();
                }
            });

            Text('随笔')
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'));

            Blank()
                .layoutWeight(1);

            if (this.noteEditorOpen) {
                Row() {
                    Text(this.saveLabel)
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'));
                }
                .width(Size.touchTarget)
                .height(Size.touchTarget)
                .justifyContent(FlexAlign.Center);
            } else {
                IconButton({
                    icon: $r('app.media.ic_plus'),
                    iconSize: Size.icon,
                    buttonSize: Size.touchTarget,
                    onTap: () => {
                        this.prepareNewNote();
                        this.noteEditorOpen = true;
                    }
                });
            }
        }
        .width('100%')
        .padding({ left: Space.xs, right: Space.xs, top: Space.sm, bottom: Space.sm });
    }

    // 列表态：本地搜索只过滤已经加载的轻量条目，不改变 AppState 原始数据
    @Builder
    ListArea() {
        this.SearchBar();

        if (this.app.notesLoading) {
            this.LoadingHint();
        } else if (this.app.notesError.length > 0) {
            this.ErrorHint();
        } else if (this.visibleNotes().length === 0) {
            this.EmptyHint();
        } else {
            Scroll() {
                Column({ space: Space.xs }) {
                    ForEach(this.visibleNotes(), (item: NoteItem, index: number) => {
                        if (this.isGroupStart(item, index)) {
                            Text(this.groupLabel(item.updatedAt))
                                .fontSize(FontSize.caption)
                                .fontWeight(FontWeight.Medium)
                                .fontColor($r('app.color.text_tertiary'))
                                .width('100%')
                                .padding({ left: Space.xs, top: Space.md, bottom: Space.xs });
                        }

                        this.NoteRow(item);
                    }, (item: NoteItem) => item.id);
                }
                .width('100%')
                .constraintSize({ minHeight: '100%' })
                .justifyContent(FlexAlign.Start)
                .alignItems(HorizontalAlign.Start)
                .padding({ left: Space.lg, right: Space.lg, bottom: Space.xl });
            }
            .layoutWeight(1)
            .width('100%')
            .scrollBar(BarState.Auto)
            .scrollBarWidth(3)
            .scrollBarColor('#3A000000');
        }
    }

    @Builder
    SearchBar() {
        Row({ space: Space.sm }) {
            Image($r('app.media.ic_search'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.icon_secondary'));

            TextInput({ placeholder: '搜索随笔', text: this.searchDraft })
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .backgroundColor(Color.Transparent)
                .padding({ left: 0, right: 0 })
                .layoutWeight(1)
                .height(36)
                .onChange((value: string) => {
                    this.searchDraft = value;
                });

            if (this.searchDraft.length > 0) {
                IconButton({
                    icon: $r('app.media.ic_close'),
                    iconSize: 14,
                    buttonSize: 28,
                    onTap: () => {
                        this.searchDraft = '';
                    }
                });
            }
        }
        .width('100%')
        .height(40)
        .padding({ left: Space.md, right: Space.xs })
        .backgroundColor($r('app.color.bg_sunken'))
        .borderRadius(Radius.sm)
        .margin({ left: Space.lg, right: Space.lg, bottom: Space.xs });
    }

    @Builder
    NoteRow(item: NoteItem) {
        Column({ space: Space.xxs }) {
            Row({ space: Space.xs }) {
                Text(this.noteTitle(item))
                    .fontSize(FontSize.body)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);

                Text(TimeUtil.short(item.updatedAt))
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }
            .width('100%');

            Text(this.notePreview(item))
                .fontSize(FontSize.caption)
                .lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%');
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: Space.lg, right: Space.md, top: Space.md, bottom: Space.md })
        .borderRadius(Radius.md)
        .backgroundColor(this.pressedNoteId === item.id ? $r('app.color.bg_pressed') : $r('app.color.bg_card'))
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.pressedNoteId = item.id;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressedNoteId = '';
            }
        })
        .onClick(() => {
            this.openNote(item);
        });
    }

    @Builder
    EditorArea() {
        Column() {
            TextArea({ placeholder: '想到什么就写下来…', text: this.contentDraft })
                .fontSize(FontSize.bodyLarge)
                .lineHeight(LineHeight.body)
                .fontColor($r('app.color.text_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .backgroundColor(Color.Transparent)
                .padding({ left: Space.lg, right: Space.lg, top: Space.lg, bottom: Space.lg })
                .layoutWeight(1)
                .width('100%')
                .onChange((value: string) => {
                    this.contentDraft = value;
                    this.scheduleSave();
                });

            this.EditorTools();
        }
        .width('100%')
        .layoutWeight(1);
    }

    @Builder
    EditorTools() {
        Row({ space: Space.sm }) {
            IconButton({
                icon: this.voiceListening ? $r('app.media.ic_stop') : $r('app.media.ic_mic'),
                iconSize: Size.icon,
                buttonSize: 40,
                tint: this.voiceListening ? $r('app.color.icon_brand') : $r('app.color.icon_secondary'),
                bg: this.voiceListening ? $r('app.color.brand_soft') : $r('app.color.bg_sunken'),
                onTap: () => {
                    this.toggleVoiceRecognition();
                }
            });

            if (this.voiceListening) {
                this.VoiceWaveform();
            }

            Text(this.voiceListening ? '正在识别 · 点击结束' : this.voiceError.length > 0 ? this.voiceError : '语音输入')
                .fontSize(FontSize.caption)
                .fontColor(this.voiceError.length > 0
                    ? $r('app.color.text_danger')
                    : this.voiceListening ? $r('app.color.text_brand') : $r('app.color.text_secondary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);

            if (!this.voiceListening && this.voiceError.length === 0) {
                Text('纯文本 / 轻 Markdown · 自动保存')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
        }
        .width('100%')
        .height(48)
        .padding({ left: Space.lg, right: Space.lg, bottom: Space.sm });
    }

    @Builder
    VoiceWaveform() {
        Row({ space: 3 }) {
            ForEach(this.voiceLevels, (level: number, index: number) => {
                Column()
                    .width(3)
                    .height(4 + level * 20)
                    .backgroundColor($r('app.color.icon_brand'))
                    .borderRadius(2)
                    .animation({ duration: Motion.durationFast, curve: Motion.easeOut });
            }, (_level: number, index: number) => index.toString());
        }
        .width(88)
        .height(28)
        .alignItems(VerticalAlign.Center);
    }

    @Builder
    LoadingHint() {
        Column() {
            LoadingProgress()
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .color($r('app.color.brand_primary'));
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    EmptyHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_edit'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.icon_secondary'));

            Text(this.searchDraft.trim().length > 0 ? '没有匹配的随笔' : '还没有随笔')
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_secondary'));

            if (this.searchDraft.trim().length === 0) {
                Text('点击右上角开始记录')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    ErrorHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.text_danger'));

            Text(this.app.notesError)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .textAlign(TextAlign.Center);
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .padding({ left: Space.xl, right: Space.xl });
    }

    // ---------- 行为 ----------

    private visibleNotes(): NoteItem[] {
        const query: string = this.searchDraft.trim().toLowerCase();

        if (query.length === 0) {
            return this.app.notes;
        }

        return this.app.notes.filter((item: NoteItem): boolean => item.content.toLowerCase().indexOf(query) >= 0);
    }

    private isGroupStart(item: NoteItem, index: number): boolean {
        if (index === 0) {
            return true;
        }

        const items: NoteItem[] = this.visibleNotes();
        return this.groupLabel(items[index - 1].updatedAt) !== this.groupLabel(item.updatedAt);
    }

    private groupLabel(timestamp: number): string {
        const millis: number = TimeUtil.toMillis(timestamp);
        const target: Date = new Date(millis);
        const now: Date = new Date();
        const todayStart: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        if (millis >= todayStart) {
            return '今天';
        }

        if (millis >= todayStart - ONE_DAY_MS) {
            return '昨天';
        }

        return target.getFullYear().toString() + '年' + this.pad(target.getMonth() + 1) + '月' + this.pad(target.getDate()) + '日';
    }

    private noteTitle(item: NoteItem): string {
        const firstLine: string = item.content.split('\n')[0].trim();
        return firstLine.length > 0 ? firstLine : '未命名随笔';
    }

    private notePreview(item: NoteItem): string {
        const lines: string[] = item.content.split('\n');

        if (lines.length <= 1) {
            return item.content.trim();
        }

        const preview: string = lines.slice(1).join(' ').trim();
        return preview.length > 0 ? preview : item.content.trim();
    }

    private pad(value: number): string {
        return value < 10 ? '0' + value.toString() : value.toString();
    }

    private prepareNewNote(): void {
        this.clearSaveTimer();
        this.voiceService.cancel();
        this.voiceListening = false;
        this.voiceError = '';
        this.resetVoiceDraft();
        this.activeNoteId = this.app.newNoteId();
        this.contentDraft = '';
        this.saveLabel = '自动保存';
    }

    private openNote(item: NoteItem): void {
        this.clearSaveTimer();
        this.voiceService.cancel();
        this.voiceListening = false;
        this.voiceError = '';
        this.resetVoiceDraft();
        this.activeNoteId = item.id;
        this.contentDraft = item.content;
        this.saveLabel = '已保存';
        this.noteEditorOpen = true;
    }

    private handleBack(): void {
        if (this.noteEditorOpen) {
            this.voiceService.cancel();
            this.voiceListening = false;
            this.flushSave();
            this.noteEditorOpen = false;
            return;
        }

        this.onBack();
    }

    private onEditorOpenChanged(): void {
        if (!this.noteEditorOpen) {
            this.flushSave();
        }
    }

    private scheduleSave(): void {
        this.clearSaveTimer();
        this.saveLabel = '保存中…';
        this.saveTimer = setTimeout(() => {
            this.saveTimer = -1;
            this.flushSave();
        }, 650);
    }

    private async toggleVoiceRecognition(): Promise<void> {
        if (this.voiceListening) {
            this.voiceService.finish();
            return;
        }

        const host = this.getUIContext().getHostContext();

        if (host === undefined) {
            this.voiceError = '无法获取应用上下文，暂时不能使用语音输入';
            return;
        }

        this.voiceError = '';
        this.voiceBaseText = this.contentDraft;
        this.voiceCommittedText = '';
        this.voiceDraftText = '';
        this.resetVoiceLevels();
        this.voiceListening = true;

        const message: string = await this.voiceService.start(host as common.UIAbilityContext, {
            onText: (text: string, isFinal: boolean): void => {
                const spokenText: string = text.trim();

                if (spokenText.length === 0) {
                    return;
                }

                if (isFinal) {
                    this.voiceCommittedText = this.appendVoiceText(this.voiceCommittedText, spokenText);
                    this.voiceDraftText = '';
                    this.scheduleSave();
                } else {
                    this.voiceDraftText = spokenText;
                }

                this.contentDraft = this.composeVoiceText();
            },
            onState: (isListening: boolean, status: string): void => {
                this.voiceListening = isListening;

                if (!isListening && status !== '识别完成') {
                    this.voiceError = status;
                }

                if (!isListening) {
                    this.resetVoiceLevels();
                }
            },
            onLevel: (level: number): void => {
                this.pushVoiceLevel(level);
            }
        });

        if (message.length > 0) {
            this.voiceListening = false;
            this.voiceError = message;
            this.resetVoiceLevels();
        }
    }

    private composeVoiceText(): string {
        let voiceText: string = this.voiceCommittedText;

        if (this.voiceDraftText.length > 0) {
            voiceText = this.appendVoiceText(voiceText, this.voiceDraftText);
        }

        if (voiceText.length === 0) {
            return this.voiceBaseText;
        }

        if (this.voiceBaseText.length === 0) {
            return voiceText;
        }

        const separator: string = this.voiceBaseText.endsWith('\n') ? '' : '\n';
        return this.voiceBaseText + separator + voiceText;
    }

    private appendVoiceText(existing: string, incoming: string): string {
        if (existing.length === 0) {
            return incoming;
        }

        return existing + '\n' + incoming;
    }

    private resetVoiceDraft(): void {
        this.voiceBaseText = '';
        this.voiceCommittedText = '';
        this.voiceDraftText = '';
        this.resetVoiceLevels();
    }

    private resetVoiceLevels(): void {
        this.voiceLevels = [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04,
            0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04];
    }

    private pushVoiceLevel(level: number): void {
        const nextLevels: number[] = this.voiceLevels.slice(1);
        nextLevels.push(Math.max(0.04, Math.min(1, level)));
        this.voiceLevels = nextLevels;
    }

    private flushSave(): void {
        this.clearSaveTimer();

        if (this.activeNoteId.length === 0) {
            return;
        }

        if (this.app.notesLoading) {
            this.saveLabel = '同步中…';
            this.saveTimer = setTimeout(() => {
                this.saveTimer = -1;
                this.flushSave();
            }, 650);
            return;
        }

        const noteId: string = this.activeNoteId;
        const content: string = this.contentDraft;
        this.app.saveNote(noteId, content).then((message: string) => {
            this.saveLabel = message.length > 0 ? message : '已保存';
        });
    }

    private clearSaveTimer(): void {
        if (this.saveTimer >= 0) {
            clearTimeout(this.saveTimer);
            this.saveTimer = -1;
        }
    }
}
