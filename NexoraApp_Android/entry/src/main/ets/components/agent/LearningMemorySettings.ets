import { LearningAgentApi, agentFailure } from '../../common/LearningAgentApi';
import { LearningMemoriesData, LearningMemoryItem, LearningMemoryUpdateData, LearningMemoryForgetData } from '../../common/LearningAgentModels';
import { LearningHttp, LearningIdentity } from '../../common/LearningHttp';
import { LearningFormat } from '../../common/LearningFormat';
import { FontSize, LineHeight, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder, TagPill } from '../learning/LearningWidgets';

const MEMORY_TEXT_LIMIT: number = 2000;
const PERSONAL_MEMORY_KINDS: string[] = ['goal', 'preference', 'pace', 'difficulty', 'background', 'interest'];

@Component
export struct LearningMemorySettings {
    @Prop @Watch('onVisibleChanged') visible: boolean = true;
    @Prop inSheet: boolean = false;
    @StorageProp('nxSessionReady') @Watch('onIdentityChanged') private sessionReady: boolean = false;
    @StorageProp('nxLearningIdentityRevision') @Watch('onIdentityChanged') private identityRevision: number = 0;
    @StorageProp('insetBottom') private insetBottom: number = 0;
    onBack: () => void = () => {};
    onChanged: () => void = () => {};
    @State private items: LearningMemoryItem[] = [];
    @State private loading: boolean = false;
    @State private errorText: string = '';
    @State private editingId: string = '';
    @State private draftText: string = '';
    @State private forgetId: string = '';
    @State private busyId: string = '';
    @State private actionError: string = '';
    @State private notice: string = '';
    private alive: boolean = false;
    private version: number = 0;
    private owner: LearningIdentity | null = null;

    aboutToAppear(): void {
        this.alive = true;
        void this.load();
    }

    aboutToDisappear(): void {
        this.alive = false;
        this.clear();
    }

    private onVisibleChanged(): void {
        this.clear();
        if (this.alive && this.visible) {
            void this.load();
        }
    }

    private onIdentityChanged(): void {
        this.clear();
        if (this.alive && this.visible) {
            void this.load();
        }
    }

    private clear(): void {
        this.version++;
        this.owner = null;
        this.items = [];
        this.loading = false;
        this.errorText = '';
        this.editingId = '';
        this.draftText = '';
        this.forgetId = '';
        this.busyId = '';
        this.actionError = '';
        this.notice = '';
    }

    private ready(): boolean {
        return this.sessionReady && LearningHttp.configured;
    }

    private current(version: number, owner: LearningIdentity | null): boolean {
        return this.alive && this.visible && this.ready() && version === this.version && LearningHttp.isCurrent(owner);
    }

    private validItem(item: LearningMemoryItem): boolean {
        return item !== null && item !== undefined && typeof item === 'object' &&
            typeof item.id === 'string' && item.id.trim().length > 0 &&
            typeof item.text === 'string' && item.text.trim().length > 0 &&
            PERSONAL_MEMORY_KINDS.indexOf(item.kind) >= 0;
    }

    private async load(): Promise<void> {
        if (!this.alive || !this.visible || this.loading || this.busyId.length > 0 ||
            this.editingId.length > 0 || this.forgetId.length > 0) {
            return;
        }
        if (!this.ready()) {
            this.clear();
            return;
        }
        const owner: LearningIdentity | null = LearningHttp.captureIdentity();
        if (!LearningHttp.isCurrent(this.owner)) {
            this.items = [];
        }
        const version: number = ++this.version;
        this.owner = owner;
        this.loading = true;
        this.errorText = '';
        this.notice = '';
        try {
            const data: LearningMemoriesData = await LearningAgentApi.getMemories();
            if (!this.current(version, owner)) {
                return;
            }
            if (data === null || !Array.isArray(data.items)) {
                throw new Error('学习记忆返回的数据不完整，请重试');
            }
            this.items = data.items.filter((item: LearningMemoryItem) => this.validItem(item));
        } catch (error) {
            if (this.current(version, owner)) {
                this.errorText = agentFailure(error);
            }
        } finally {
            if (this.current(version, owner)) {
                this.loading = false;
            }
        }
    }

    private canAct(): boolean {
        return this.alive && this.visible && this.ready() && LearningHttp.isCurrent(this.owner) &&
            !this.loading && this.busyId.length === 0;
    }

    private beginEdit(id: string): void {
        if (!this.canAct() || this.editingId.length > 0 || this.forgetId.length > 0) {
            return;
        }
        const item: LearningMemoryItem | undefined = this.items.find((value: LearningMemoryItem) => value.id === id);
        if (item === undefined) {
            return;
        }
        this.editingId = item.id;
        this.draftText = item.text;
        this.actionError = '';
        this.notice = '';
    }

    private cancelEdit(): void {
        if (this.busyId.length > 0) {
            return;
        }
        this.editingId = '';
        this.draftText = '';
        this.actionError = '';
    }

    private canSave(): boolean {
        const text: string = this.draftText.trim();
        const item: LearningMemoryItem | undefined = this.items.find((value: LearningMemoryItem) => value.id === this.editingId);
        return this.canAct() && item !== undefined && text.length > 0 && text.length <= MEMORY_TEXT_LIMIT &&
            text !== item.text.trim();
    }

    private async saveEdit(): Promise<void> {
        if (!this.canSave()) {
            return;
        }
        const id: string = this.editingId;
        const text: string = this.draftText.trim();
        const owner: LearningIdentity | null = this.owner;
        const version: number = ++this.version;
        this.busyId = id;
        this.actionError = '';
        try {
            const result: LearningMemoryUpdateData = await LearningAgentApi.updateMemory(id, text);
            if (!this.current(version, owner)) {
                return;
            }
            if (result === null || result.updated !== true || !this.validItem(result.item)) {
                throw new Error('这条记忆暂时未能保存，请重试');
            }
            // The server returns a replacement record; retaining the old ID would break the next edit/forget.
            this.items = this.items.filter((item: LearningMemoryItem) => item.id === id || item.id !== result.item.id)
                .map((item: LearningMemoryItem) => item.id === id ? result.item : item);
            this.editingId = '';
            this.draftText = '';
            this.notice = '已更新，后续回答和学习建议会参考这条记忆。';
            this.onChanged();
        } catch (error) {
            if (this.current(version, owner)) {
                this.actionError = '保存失败：' + agentFailure(error);
            }
        } finally {
            if (this.current(version, owner)) {
                this.busyId = '';
            }
        }
    }

    private requestForget(id: string): void {
        if (!this.canAct() || this.editingId.length > 0 || this.forgetId.length > 0 ||
            !this.items.some((item: LearningMemoryItem) => item.id === id)) {
            return;
        }
        this.forgetId = id;
        this.actionError = '';
        this.notice = '';
    }

    private cancelForget(): void {
        if (this.busyId.length === 0) {
            this.forgetId = '';
            this.actionError = '';
        }
    }

    private async forget(): Promise<void> {
        if (!this.canAct() || this.forgetId.length === 0 ||
            !this.items.some((item: LearningMemoryItem) => item.id === this.forgetId)) {
            return;
        }
        const id: string = this.forgetId;
        const owner: LearningIdentity | null = this.owner;
        const version: number = ++this.version;
        this.busyId = id;
        this.actionError = '';
        try {
            const result: LearningMemoryForgetData = await LearningAgentApi.forgetMemory(id);
            if (!this.current(version, owner)) {
                return;
            }
            if (result === null || result.updated !== true) {
                throw new Error('这条记忆暂时未能忘记，请重试');
            }
            this.items = this.items.filter((item: LearningMemoryItem) => item.id !== id);
            this.forgetId = '';
            this.notice = '已忘记这条信息，历史对话仍会保留。';
            this.onChanged();
        } catch (error) {
            if (this.current(version, owner)) {
                this.actionError = '忘记失败：' + agentFailure(error);
            }
        } finally {
            if (this.current(version, owner)) {
                this.busyId = '';
            }
        }
    }

    private leave(): void {
        if (!this.alive) {
            return;
        }
        this.alive = false;
        this.clear();
        this.onBack();
    }

    private kindLabel(kind: string): string {
        if (kind === 'goal') { return '学习目标'; }
        if (kind === 'preference') { return '讲解偏好'; }
        if (kind === 'pace') { return '时间与节奏'; }
        if (kind === 'difficulty') { return '学习难点'; }
        if (kind === 'background') { return '学习基础'; }
        return '学习兴趣';
    }

    private updatedLabel(timestamp: number): string {
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return '';
        }
        return '更新于 ' + LearningFormat.day(timestamp > 100000000000 ? timestamp / 1000 : timestamp);
    }

    @Builder
    Header() {
        Column({ space: Space.xs }) {
            if (this.inSheet) {
                Row().width(Size.touchTarget).height(Space.xs).borderRadius(Radius.full)
                    .backgroundColor($r('app.color.border_strong')).margin({ top: Space.sm });
            }
            Row({ space: Space.xs }) {
                IconButton({ icon: $r('app.media.ic_back'), tint: $r('app.color.icon_primary'),
                    onTap: () => { this.leave(); } })
                    .id('learning_memory_back').accessibilityText('返回');
                Text('学习偏好与记忆').fontSize(FontSize.title).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary')).layoutWeight(1);
                IconButton({ icon: $r('app.media.ic_refresh'), tint: $r('app.color.icon_secondary'),
                    isEnabled: this.canAct() && this.editingId.length === 0 && this.forgetId.length === 0,
                    onTap: () => { void this.load(); } })
                    .id('learning_memory_refresh').accessibilityText('刷新学习记忆');
            }.width('100%').padding({ left: Space.xs, right: Space.sm });
        }.width('100%');
    }

    @Builder
    Editor(item: LearningMemoryItem) {
        Column({ space: Space.sm }) {
            TextArea({ text: this.draftText, placeholder: '写下你当前的学习目标或偏好' })
                .fontSize(FontSize.body).fontColor($r('app.color.text_primary'))
                .backgroundColor($r('app.color.bg_sunken')).borderRadius(Radius.md)
                .height(Size.inputMaxHeight).padding(Space.md).maxLength(MEMORY_TEXT_LIMIT)
                .enabled(this.busyId.length === 0).id('learning_memory_draft_' + item.id)
                .onChange((value: string) => { this.draftText = value; });
            Text('最多 2000 字，保存后用于后续回答和学习建议。')
                .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary')).width('100%');
            Row({ space: Space.sm }) {
                Blank();
                Button('取消', { type: ButtonType.Normal })
                    .fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
                    .backgroundColor(Color.Transparent).borderRadius(Radius.sm)
                    .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.md, right: Space.md })
                    .enabled(this.busyId.length === 0).id('learning_memory_cancel_edit_' + item.id)
                    .onClick(() => { this.cancelEdit(); });
                Button(this.busyId === item.id ? '保存中…' : '保存', { type: ButtonType.Normal })
                    .fontSize(FontSize.small).fontColor($r('app.color.text_brand'))
                    .backgroundColor($r('app.color.brand_soft')).borderRadius(Radius.sm)
                    .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.lg, right: Space.lg })
                    .enabled(this.canSave()).id('learning_memory_save_' + item.id)
                    .onClick(() => { void this.saveEdit(); });
            }.width('100%');
        }.width('100%');
    }

    @Builder
    ForgetConfirmation(item: LearningMemoryItem) {
        Column({ space: Space.xs }) {
            Text('忘记后将不再作为学习记忆使用，历史对话仍会保留。')
                .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_secondary')).width('100%');
            Row({ space: Space.sm }) {
                Blank();
                Button('取消', { type: ButtonType.Normal })
                    .fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
                    .backgroundColor(Color.Transparent).borderRadius(Radius.sm)
                    .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.md, right: Space.md })
                    .enabled(this.busyId.length === 0).id('learning_memory_cancel_forget_' + item.id)
                    .onClick(() => { this.cancelForget(); });
                Button(this.busyId === item.id ? '正在忘记…' : '确认忘记', { type: ButtonType.Normal })
                    .fontSize(FontSize.small).fontColor($r('app.color.text_danger'))
                    .backgroundColor($r('app.color.bg_sunken')).borderRadius(Radius.sm)
                    .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.md, right: Space.md })
                    .enabled(this.canAct()).id('learning_memory_confirm_forget_' + item.id)
                    .onClick(() => { void this.forget(); });
            }.width('100%');
        }.width('100%');
    }

    @Builder
    MemoryItem(item: LearningMemoryItem) {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                TagPill({ text: this.kindLabel(item.kind) });
                Blank();
                Text(this.updatedLabel(item.updated_at)).fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }.width('100%');
            if (this.editingId === item.id) {
                this.Editor(item);
            } else {
                Text(item.text).fontSize(FontSize.body).lineHeight(LineHeight.body)
                    .fontColor($r('app.color.text_primary')).width('100%');
                if (this.forgetId === item.id) {
                    this.ForgetConfirmation(item);
                } else {
                    Row({ space: Space.sm }) {
                        Blank();
                        Button('编辑', { type: ButtonType.Normal })
                            .fontSize(FontSize.small).fontColor($r('app.color.text_brand'))
                            .backgroundColor(Color.Transparent).borderRadius(Radius.sm)
                            .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.md, right: Space.md })
                            .enabled(this.canAct() && this.editingId.length === 0 && this.forgetId.length === 0)
                            .id('learning_memory_edit_' + item.id).onClick(() => { this.beginEdit(item.id); });
                        Button('忘记', { type: ButtonType.Normal })
                            .fontSize(FontSize.small).fontColor($r('app.color.text_secondary'))
                            .backgroundColor(Color.Transparent).borderRadius(Radius.sm)
                            .constraintSize({ minHeight: Size.touchTarget }).padding({ left: Space.md, right: Space.md })
                            .enabled(this.canAct() && this.editingId.length === 0 && this.forgetId.length === 0)
                            .id('learning_memory_forget_' + item.id).onClick(() => { this.requestForget(item.id); });
                    }.width('100%');
                }
            }
            if ((this.editingId === item.id || this.forgetId === item.id) && this.actionError.length > 0) {
                Text(this.actionError).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_danger')).width('100%').id('learning_memory_action_error');
            }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(Space.lg)
            .borderRadius(Radius.lg).backgroundColor($r('app.color.bg_card'));
    }

    build() {
        Column({ space: Space.md }) {
            this.Header();
            Scroll() {
                Column({ space: Space.md }) {
                    Text('保存的学习目标、时间安排和讲解偏好，用于调整回答和学习建议。你可以随时编辑或忘记。')
                        .fontSize(FontSize.small).lineHeight(LineHeight.caption)
                        .fontColor($r('app.color.text_secondary')).width('100%');
                    if (!this.ready()) {
                        Placeholder({ icon: $r('app.media.ic_person'), title: '学习服务尚未就绪',
                            hint: this.sessionReady ? '当前账号尚未连接学习服务，请返回设置检查服务配置。' : '登录并连接学习服务后，可管理保存的学习信息。' })
                            .id('learning_memory_unavailable');
                    } else if (this.loading) {
                        LoadingBlock({ label: '正在加载学习记忆…' });
                    } else {
                        if (this.errorText.length > 0) {
                            Placeholder({ icon: $r('app.media.ic_person'), title: '学习记忆暂时未能加载',
                                hint: this.errorText, actionLabel: '重试', onAction: () => { void this.load(); } })
                                .id('learning_memory_retry');
                        }
                        if (this.notice.length > 0) {
                            Text(this.notice).fontSize(FontSize.small).lineHeight(LineHeight.caption)
                                .fontColor($r('app.color.text_success')).width('100%').id('learning_memory_notice');
                        }
                        if (this.items.length === 0 && this.errorText.length === 0) {
                            Placeholder({ icon: $r('app.media.ic_person'), title: '暂时没有学习记忆',
                                hint: '在对话中告诉 Agent 你的学习目标或讲解偏好，保存后会显示在这里。' })
                                .id('learning_memory_empty');
                        }
                        ForEach(this.items, (item: LearningMemoryItem) => {
                            this.MemoryItem(item);
                        }, (item: LearningMemoryItem) => item.id + ':' + item.updated_at + ':' + item.text);
                    }
                }.width('100%').padding({ left: Space.lg, right: Space.lg, bottom: Space.xl + this.insetBottom });
            }.width('100%').layoutWeight(1).align(Alignment.TopStart).scrollBar(BarState.Off);
        }.width('100%').height('100%').backgroundColor($r('app.color.bg_page'));
    }
}
