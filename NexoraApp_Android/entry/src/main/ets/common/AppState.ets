// AppState.ets - 全局应用状态
// 登录态、后端地址、模型选择、会话列表都挂在这里，页面只消费状态不做网络与持久化细节
// 采用进程内单例 + @Observed，任一处修改都会驱动已挂载页面刷新

import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConversationItem, DEFAULT_BACKEND_URL, KnowledgeItem, MailItem, ModelItem, NoteItem, NoteNotebook, NotesStore, sanitizeDisplayName } from './AppConfig';
import { ApiService, LearningRuntimeResult, NotesStoreResult, UserInfoResult } from './ApiService';
import { HttpUtil } from './HttpUtil';
import { Json } from './JsonUtil';
import { LearningApi } from './LearningApi';
import { PreferencesUtil } from './PreferencesUtil';
import { ReaderPalette, ReaderTheme } from './DesignToken';
import { RemoteImageCache } from './RemoteImageCache';
import { TimeUtil } from './TimeUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraState';

@Observed
export class AppState {
    // 会话与身份
    backendUrl: string = DEFAULT_BACKEND_URL;
    // 登录凭证用户名（不可被服务端展示名覆盖，登录预填依赖它）
    username: string = '';
    // 服务端展示名：拉取资料后填充，用于问候语与头像等展示位；未拉取时回退 username
    displayName: string = '';
    avatarUrl: string = '';
    loggedIn: boolean = false;

    // 生成参数
    models: ModelItem[] = [];
    selectedModelId: string = '';
    // selectedModelLabel 必须是属性而非 getter：@Observed 只追踪属性赋值，getter 依赖的 selectedModelId/models 变更不会触发 @ObjectLink 刷新
    selectedModelLabel: string = '选择模型';
    enableThinking: boolean = false;
    enableWebSearch: boolean = true;
    // 强制工具调用：true→请求体传 tool_mode='force'，false→传 'auto_off'
    forceTools: boolean = true;

    // 会话列表
    conversations: ConversationItem[] = [];
    conversationsLoading: boolean = false;
    conversationsError: string = '';
    // 会话列表请求序号：并发刷新时只采纳最后一次的结果，防止旧响应晚到把新状态（置顶等）覆盖回去
    private convRequestSeq: number = 0;
    // 本地占位会话：新会话在服务端落盘入库前（首问发出→回复结束之间存在延迟窗口），
    // 先本地插入占位项，保证模型回复中侧栏就能看到并高亮当前会话；
    // 服务端刷新结果一旦包含该 id 即自动移除占位，不会与真实数据重复
    private pendingLocals: ConversationItem[] = [];

    // 侧栏视图切换：对话列表 / 知识库列表
    sidebarView: 'chat' | 'knowledge' = 'chat';

    // 知识库列表
    knowledgeList: KnowledgeItem[] = [];
    knowledgeLoading: boolean = false;
    knowledgeError: string = '';
    private knowledgeRequestSeq: number = 0;

    // 邮箱视图：收件箱 / 已发送
    mailBox: 'inbox' | 'sent' = 'inbox';
    // 邮件搜索关键字：非空时随列表请求下发服务端 q 参数
    mailQuery: string = '';
    // 邮件列表（当前箱）
    mailList: MailItem[] = [];
    mailLoading: boolean = false;
    mailError: string = '';
    // 邮件列表请求序号：并发刷新时只采纳最后一次的结果（与会话列表同一防串台机制）
    private mailRequestSeq: number = 0;

    // 随笔：本地轻量记录，与知识库完全分离
    notes: NoteItem[] = [];
    notesLoading: boolean = false;
    notesError: string = '';
    private notesWriteChain: Promise<void> = Promise.resolve();
    private noteSequence: number = 0;
    private notesStore: NotesStore | null = null;
    // 最近一次成功读取/写入的云端快照，随笔保存必须以此作为三方合并基线
    private notesBaseStore: NotesStore | null = null;
    private notesMutationSeq: number = 0;
    private notesRequestSeq: number = 0;
    private notesRemoteReady: boolean = false;

    // Learning 入口：运行时开关与前端工作区地址（管理端配置，随偏好接口下发）
    learningEnabled: boolean = false;
    learningFrontendUrl: string = '';

    // 阅读器偏好（本地持久化，随启动恢复）：字号 / 行距档（0 紧凑 / 1 适中 / 2 疏松）/ 主题
    readerFontSize: number = 16;
    readerLineSpacing: number = 1;
    readerTheme: string = 'day';
    // 各书上次阅读章节（bookId → chapterIndex，内存 + 本地 JSON 双写）
    private readerPositions: Record<string, number> = {};

    private context: common.UIAbilityContext | null = null;

    // 系统返回键处理函数：由 MainChat 在 aboutToAppear 中注入，Index.onBackPress 调用
    backHandler: (() => boolean) | null = null;

    // 服务端头像原始 URL：与本地落地路径分开存放，用于判断 URL 是否变化、避免重复下载
    private avatarRemoteUrl: string = '';

    static readonly shared: AppState = new AppState();

    // 当前选中的模型，未选时返回空串（后端将使用默认模型）
    get selectedModel(): ModelItem | null {
        for (let i: number = 0; i < this.models.length; i++) {
            if (this.models[i].id === this.selectedModelId) {
                return this.models[i];
            }
        }

        return null;
    }

    get selectedModelName(): string {
        const model: ModelItem | null = this.selectedModel;
        return model === null ? '' : model.id;
    }

    // 根据 selectedModelId 和 models 计算展示标签，在 selectModel / refreshModels / restore / signOut 中调用
    private computeModelLabel(): string {
        const model: ModelItem | null = this.selectedModel;

        if (model !== null) {
            return model.provider.length > 0 ? model.provider + ' · ' + model.name : model.name;
        }

        return this.selectedModelId.length > 0 ? this.selectedModelId : '选择模型';
    }

    // 将模型标签同步到 AppStorage，驱动 @StorageProp('inputModelLabel') 的组件刷新
    private syncModelLabelToStorage(): void {
        AppStorage.setOrCreate('inputModelLabel', this.selectedModelLabel);
        hilog.info(DOMAIN, TAG, '[syncToStorage] wrote inputModelLabel=%{public}s', this.selectedModelLabel);
    }

    // ---------- 生命周期 ----------
    // 恢复本地持久化状态：后端地址、会话 Cookie、生成参数
    async restore(context: common.UIAbilityContext): Promise<void> {
        this.context = context;
        // 需登录图片的本地缓存需要 cacheDir，随启动一并注入
        RemoteImageCache.shared.attach(context);
        this.backendUrl = await PreferencesUtil.loadBackendUrl(context, DEFAULT_BACKEND_URL);
        // 历史版本可能把字面量 "undefined" 写进 username 键，读取即清洗，展示/预填不再依赖各页兜底
        this.username = sanitizeDisplayName(await PreferencesUtil.loadUsername(context));
        this.selectedModelId = await PreferencesUtil.loadSelectedModel(context);
        this.enableThinking = await PreferencesUtil.loadEnableThinking(context);
        this.enableWebSearch = await PreferencesUtil.loadEnableWebSearch(context);
        this.forceTools = await PreferencesUtil.loadForceTools(context);
        this.readerFontSize = await PreferencesUtil.loadReaderFontSize(context);
        this.readerLineSpacing = await PreferencesUtil.loadReaderLineSpacing(context);
        this.readerTheme = await PreferencesUtil.loadReaderTheme(context);
        this.readerPositions = AppState.parseReaderPositions(await PreferencesUtil.loadReaderPositions(context));
        await this.loadNotes();

        HttpUtil.setBackendUrl(this.backendUrl);
        HttpUtil.setSessionCookie(await PreferencesUtil.loadSessionCookie(context));
        this.selectedModelLabel = this.computeModelLabel();
        this.syncModelLabelToStorage();
        hilog.info(DOMAIN, TAG, 'state restored, backend=%{public}s', this.backendUrl);
    }

    // 已保存过 Cookie 才认为可能处于登录态，最终以服务端校验结果为准
    async validateSession(): Promise<boolean> {
        if (!HttpUtil.hasSession()) {
            this.loggedIn = false;
            return false;
        }

        this.loggedIn = await HttpUtil.checkSession();
        return this.loggedIn;
    }

    async signIn(backendUrl: string, username: string, password: string): Promise<string> {
        const result = await HttpUtil.login(backendUrl, username, password);

        if (!result.success) {
            return result.message;
        }

        this.backendUrl = HttpUtil.getBackendUrl();
        this.username = username;
        this.loggedIn = true;
        await this.persistSession();
        await this.loadNotes();
        await this.refreshModels();
        return '';
    }

    async signOut(): Promise<void> {
        await HttpUtil.logout();

        if (this.context !== null) {
            await PreferencesUtil.clearSession(this.context);
        }

        // 保留 username：退出后登录页用它预填账号；展示名与头像属于上个账号，必须清掉
        this.loggedIn = false;
        this.displayName = '';
        this.avatarUrl = '';
        this.avatarRemoteUrl = '';
        this.conversations = [];
        this.models = [];
        this.selectedModelId = '';
        this.selectedModelLabel = '选择模型';
        this.mailBox = 'inbox';
        this.mailList = [];
        this.mailError = '';
        // 退出即失效 Learning 内容接口（用户标识清空，避免串到下个账号）
        LearningApi.shared.configure('');
        this.notes = [];
        this.notesError = '';
        this.notesStore = null;
        this.notesBaseStore = null;
        this.notesMutationSeq = 0;
        this.notesRequestSeq += 1;
        this.notesRemoteReady = false;
        this.syncModelLabelToStorage();
    }

    // ---------- 配置 ----------
    async updateBackendUrl(url: string): Promise<void> {
        HttpUtil.setBackendUrl(url);
        this.backendUrl = HttpUtil.getBackendUrl();

        if (this.context !== null) {
            await PreferencesUtil.saveBackendUrl(this.context, this.backendUrl);
        }
    }

    async selectModel(modelId: string): Promise<void> {
        hilog.info(DOMAIN, TAG, '[selectModel] enter modelId=%{public}s', modelId);
        this.selectedModelId = modelId;
        this.selectedModelLabel = this.computeModelLabel();
        hilog.info(DOMAIN, TAG, '[selectModel] computed label=%{public}s', this.selectedModelLabel);
        this.syncModelLabelToStorage();

        if (this.context !== null) {
            await PreferencesUtil.saveSelectedModel(this.context, modelId);
        }
    }

    async setThinking(enabled: boolean): Promise<void> {
        this.enableThinking = enabled;

        if (this.context !== null) {
            await PreferencesUtil.saveEnableThinking(this.context, enabled);
        }
    }

    async setWebSearch(enabled: boolean): Promise<void> {
        this.enableWebSearch = enabled;

        if (this.context !== null) {
            await PreferencesUtil.saveEnableWebSearch(this.context, enabled);
        }
    }

    async setForceTools(enabled: boolean): Promise<void> {
        this.forceTools = enabled;

        if (this.context !== null) {
            await PreferencesUtil.saveForceTools(this.context, enabled);
        }
    }

    // ---------- 阅读器 ----------
    // 阅读偏好写入：内存即时生效 + 本地持久化，非法值收敛到合法范围
    async setReaderFontSize(size: number): Promise<void> {
        const next: number = size < 14 ? 14 : (size > 22 ? 22 : size);
        this.readerFontSize = next;

        if (this.context !== null) {
            await PreferencesUtil.saveReaderFontSize(this.context, next);
        }
    }

    async setReaderLineSpacing(index: number): Promise<void> {
        const next: number = index < 0 ? 0 : (index > 2 ? 2 : index);
        this.readerLineSpacing = next;

        if (this.context !== null) {
            await PreferencesUtil.saveReaderLineSpacing(this.context, next);
        }
    }

    async setReaderTheme(theme: string): Promise<void> {
        const next: string = theme === 'night' || theme === 'sepia' ? theme : 'day';
        this.readerTheme = next;

        if (this.context !== null) {
            await PreferencesUtil.saveReaderTheme(this.context, next);
        }
    }

    // 阅读器当前主题色板：阅读页统一取色
    readerPalette(): ReaderPalette {
        return ReaderTheme.byName(this.readerTheme);
    }

    // 阅读行高 = 字号 × 档位倍率（紧凑 1.5 / 适中 1.7 / 疏松 2.0）
    readerLineHeight(): number {
        const ratio: number = this.readerLineSpacing === 0 ? 1.5 : (this.readerLineSpacing === 2 ? 2.0 : 1.7);

        return Math.round(this.readerFontSize * ratio);
    }

    // 某书上次阅读章节（无记录返回 -1）
    readPosition(bookId: string): number {
        const value: number | undefined = this.readerPositions[bookId];

        return value === undefined ? -1 : value;
    }

    // 记录阅读位置：内存即时生效 + 本地 JSON 双写
    async saveReadPosition(bookId: string, chapterIndex: number): Promise<void> {
        if (bookId.length === 0 || chapterIndex < 0) {
            return;
        }

        this.readerPositions[bookId] = chapterIndex;

        if (this.context !== null) {
            await PreferencesUtil.saveReaderPositions(this.context, JSON.stringify(this.readerPositions));
        }
    }

    private static parseReaderPositions(raw: string): Record<string, number> {
        const out: Record<string, number> = {};

        try {
            const parsed: Object = JSON.parse(raw) as Object;

            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return out;
            }

            const record: Record<string, Object> = parsed as Record<string, Object>;
            const keys: string[] = Object.keys(record);

            for (let i: number = 0; i < keys.length; i++) {
                const value: Object | undefined = record[keys[i]];

                if (typeof value === 'number') {
                    out[keys[i]] = value as number;
                }
            }
        } catch {
            // 解析失败按空处理，不阻塞主流程
        }

        return out;
    }

    // ---------- 数据 ----------
    async refreshModels(): Promise<void> {
        const result = await ApiService.fetchModels();

        if (!result.success) {
            hilog.error(DOMAIN, TAG, 'load models failed: %{public}s', result.message);
            return;
        }

        this.models = result.data;

        if (this.selectedModelId.length === 0 && this.models.length > 0) {
            this.selectedModelId = this.models[0].id;
        }

        this.selectedModelLabel = this.computeModelLabel();
        this.syncModelLabelToStorage();
    }

    async refreshConversations(): Promise<void> {
        const seq: number = ++this.convRequestSeq;
        this.conversationsLoading = true;
        this.conversationsError = '';

        const result = await ApiService.fetchConversations();

        // 过期响应（期间又有更新的刷新发起）：直接丢弃，避免旧数据覆盖置顶/标题等最新状态
        if (seq !== this.convRequestSeq) {
            return;
        }

        this.conversationsLoading = false;

        if (!result.success) {
            this.conversationsError = result.message;
            return;
        }

        this.conversations = result.data;
        // 服务端真实数据落位后，重新前置仍未入库的本地占位（若有）
        this.applyConversationView();
    }

    // 新会话占位：会话 id 已由流首帧带回、但服务端会话列表里还没有它（入库延迟）时，
    // 本地前置一个占位项。标题/时间随回复推进可更新；列表里一旦出现真实项，占位自动让位。
    ensureConversationVisible(conversationId: string, title: string): void {
        if (conversationId.length === 0) {
            return;
        }

        const existing: boolean = this.conversations.some((item: ConversationItem): boolean => item.id === conversationId);

        if (existing) {
            return;
        }

        const pendingExists: boolean = this.pendingLocals.some((item: ConversationItem): boolean => item.id === conversationId);

        if (!pendingExists) {
            this.pendingLocals = [...this.pendingLocals, {
                id: conversationId,
                title: title.length > 0 ? title : '新对话',
                preview: '',
                time: '生成中…',
                mode: '',
                pin: false
            }];
        }

        this.applyConversationView();
    }

    // 更新本地占位项的标题/时间（流结束服务端落库后由 refresh 替换真实数据，占位自动清除）
    updatePendingConversation(conversationId: string, title: string): void {
        let changed: boolean = false;
        const updated: ConversationItem[] = this.pendingLocals.map((item: ConversationItem): ConversationItem => {
            if (item.id !== conversationId) {
                return item;
            }

            changed = true;
            return { id: item.id, title: title.length > 0 ? title : item.title, preview: item.preview, time: item.time, mode: item.mode, pin: item.pin };
        });

        if (changed) {
            this.pendingLocals = updated;
            this.applyConversationView();
        }
    }

    // 服务端数据与本地占位合并后作为对外可见列表
    private applyConversationView(): void {
        const realIds: string[] = this.conversations.map((item: ConversationItem): string => item.id);
        const ghosts: ConversationItem[] = this.pendingLocals.filter((item: ConversationItem): boolean => realIds.indexOf(item.id) < 0);
        this.conversations = [...ghosts, ...this.conversations];
    }

    // 置顶 / 取消置顶：成功后本地更新列表项并即时前移置顶项（无需等服务端刷新），失败返回可直接展示的错误文案
    async setConversationPin(conversationId: string, pin: boolean): Promise<string> {        const result = await ApiService.pinConversation(conversationId, pin);

        if (!result.success) {
            return result.message;
        }

        const updated: ConversationItem[] = this.conversations.map((item: ConversationItem): ConversationItem => {
            if (item.id !== conversationId) {
                return item;
            }

            return { id: item.id, title: item.title, preview: item.preview, time: item.time, mode: item.mode, pin: pin };
        });

        // 置顶项立即提到最前（稳定排序，非置顶项保持原有相对顺序）；取消置顶的位置交由随后的服务端刷新校正
        if (pin) {
            updated.sort((a: ConversationItem, b: ConversationItem): number => {
                if (a.pin === b.pin) {
                    return 0;
                }

                return a.pin ? -1 : 1;
            });
        }

        this.conversations = updated;
        return '';
    }

    // 删除会话（后端归档回收站）：成功后本地移除，失败返回错误文案
    async deleteConversation(conversationId: string): Promise<string> {
        const result = await ApiService.deleteConversation(conversationId);

        if (!result.success) {
            return result.message;
        }

        this.conversations = this.conversations.filter((item: ConversationItem): boolean => item.id !== conversationId);
        this.pendingLocals = this.pendingLocals.filter((item: ConversationItem): boolean => item.id !== conversationId);
        return '';
    }

    // ---------- 侧栏视图与知识库 ----------
    // 切换侧栏视图：切到知识库时自动拉取一次列表，保证数据不过期
    setSidebarView(view: 'chat' | 'knowledge'): void {
        if (this.sidebarView === view) {
            return;
        }

        this.sidebarView = view;

        if (view === 'knowledge') {
            this.refreshKnowledgeList();
        }
    }

    async refreshKnowledgeList(): Promise<void> {
        const seq: number = ++this.knowledgeRequestSeq;
        this.knowledgeLoading = true;
        this.knowledgeError = '';

        const result = await ApiService.fetchKnowledgeList();

        if (seq !== this.knowledgeRequestSeq) {
            return;
        }

        this.knowledgeLoading = false;

        if (!result.success) {
            this.knowledgeError = result.message;
            return;
        }

        this.knowledgeList = this.sortKnowledgeItems(result.data);
    }

    // 知识库列表排序：置顶优先，同级别按更新时间降序
    private sortKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
        const sorted: KnowledgeItem[] = items.slice();
        sorted.sort((a: KnowledgeItem, b: KnowledgeItem): number => {
            if (a.pin !== b.pin) {
                return a.pin ? -1 : 1;
            }

            return b.updatedAt - a.updatedAt;
        });
        return sorted;
    }

    // 置顶 / 取消置顶：成功后本地更新并重排，保证置顶项即时前移
    async setKnowledgePin(title: string, pin: boolean): Promise<string> {
        const result = await ApiService.pinKnowledge(title, pin);

        if (!result.success) {
            return result.message;
        }

        const updated: KnowledgeItem[] = this.knowledgeList.map((item: KnowledgeItem): KnowledgeItem => {
            if (item.title !== title) {
                return item;
            }

            return { title: item.title, pin: pin, updatedAt: item.updatedAt, time: item.time, basisId: item.basisId };
        });

        this.knowledgeList = this.sortKnowledgeItems(updated);
        return '';
    }

    // 删除知识库：成功后本地移除，失败返回错误文案
    async deleteKnowledge(title: string): Promise<string> {
        const result = await ApiService.deleteKnowledge(title);

        if (!result.success) {
            return result.message;
        }

        this.knowledgeList = this.knowledgeList.filter((item: KnowledgeItem): boolean => item.title !== title);
        return '';
    }

    // ---------- Learning ----------
    // 拉取 Learning 运行时配置，并把独立服务地址交给 Learning API 客户端。
    async refreshLearningRuntime(): Promise<void> {
        const result: LearningRuntimeResult = await ApiService.fetchLearningRuntime();

        if (!result.success) {
            this.learningEnabled = false;
            this.learningFrontendUrl = '';
            LearningApi.shared.configure(this.username, '');
            hilog.warn(DOMAIN, TAG, 'load learning runtime failed: %{public}s', result.message);
            return;
        }

        this.learningEnabled = result.enabled;
        this.learningFrontendUrl = result.frontendUrl;
        LearningApi.shared.configure(this.username, result.frontendUrl);
    }

    // ---------- 邮件 ----------
    // 切换邮箱视图：切箱即清空搜索与列表并重新拉取，避免两箱数据互串
    setMailBox(box: 'inbox' | 'sent'): void {
        if (this.mailBox === box) {
            return;
        }

        this.mailBox = box;
        this.mailQuery = '';
        this.mailList = [];
        this.mailError = '';
        this.refreshMailList();
    }

    // 更新搜索关键字并重新拉取：与当前关键字相同则不动作（重复回车不重复请求）
    setMailQuery(query: string): void {
        const next: string = query.trim();

        if (this.mailQuery === next) {
            return;
        }

        this.mailQuery = next;
        this.mailList = [];
        this.mailError = '';
        this.refreshMailList();
    }

    // 拉取当前箱的邮件列表首页（读取场景一次一页已足够，深入分页待有需求再加）
    async refreshMailList(): Promise<void> {
        const seq: number = ++this.mailRequestSeq;
        this.mailLoading = true;
        this.mailError = '';

        const result = await ApiService.fetchMailList(this.mailBox, 0, 50, this.mailQuery);

        // 过期响应丢弃：期间用户已切箱或再次刷新时，旧箱数据不允许覆盖新状态
        if (seq !== this.mailRequestSeq) {
            return;
        }

        this.mailLoading = false;

        if (!result.success) {
            this.mailError = result.message;
            return;
        }

        this.mailList = result.mails;
    }

    // ---------- 随笔 ----------
    // 生成仅供当前编辑态使用的 id；空白草稿不会立即写入列表，避免返回后产生空卡片
    newNoteId(): string {
        this.noteSequence += 1;
        return Date.now().toString() + '_' + this.noteSequence.toString();
    }

    // question 回答锁：后端不持久化作答态，App 重启后靠本地锁恢复已回答卡片
    async loadQuestionLocks(): Promise<string> {
        if (this.context === null) {
            return '{}';
        }

        return PreferencesUtil.loadQuestionLocks(this.context);
    }

    async saveQuestionLocks(storeJson: string): Promise<void> {
        if (this.context !== null) {
            await PreferencesUtil.saveQuestionLocks(this.context, storeJson);
        }
    }

    // 登录后从云端读取完整快照，并把它固定为后续保存的三方合并基线
    async refreshNotes(): Promise<void> {
        if (!this.loggedIn) {
            return;
        }

        const requestSeq: number = ++this.notesRequestSeq;
        this.notesLoading = true;
        this.notesRemoteReady = false;
        this.notesError = '';
        const result: NotesStoreResult = await ApiService.fetchNotesStore();

        if (requestSeq !== this.notesRequestSeq) {
            return;
        }

        this.notesLoading = false;

        if (!result.success || result.store === null) {
            this.notesRemoteReady = false;
            this.notesError = result.message;
            hilog.error(DOMAIN, TAG, '[refreshNotes] failed: %{public}s', result.message);
            return;
        }

        this.applyNotesStore(result.store);
        this.notesBaseStore = this.copyNotesStore(result.store);
        this.notesRemoteReady = true;
        await this.cacheNotes();
    }

    // 按更新时间降序保存随笔：本地先更新，云端依据基线做串行三方合并
    async saveNote(noteId: string, content: string): Promise<string> {
        if (noteId.trim().length === 0) {
            return '笔记标识无效';
        }

        if (!this.notesRemoteReady || this.notesStore === null) {
            return '云端随笔正在加载，请稍后再试';
        }

        const nextContent: string = content;
        const existing: NoteItem | null = this.findNote(noteId);

        if (nextContent.trim().length === 0) {
            if (existing === null) {
                return '';
            }

            this.notes = this.notes.filter((item: NoteItem): boolean => item.id !== noteId);
        } else if (existing === null) {
            this.notes = this.sortNotes([...this.notes, {
                id: noteId,
                content: nextContent,
                updatedAt: Date.now(),
                notebookId: this.notesStore.activeNotebookId,
                source: '随笔',
                sourceTitle: '',
                anchor: null
            }]);
        } else {
            this.notes = this.sortNotes(this.notes.map((item: NoteItem): NoteItem => {
                if (item.id !== noteId) {
                    return item;
                }

                return {
                    id: item.id,
                    content: nextContent,
                    updatedAt: Date.now(),
                    notebookId: item.notebookId,
                    source: item.source,
                    sourceTitle: item.sourceTitle,
                    anchor: item.anchor
                };
            }));
        }

        this.notesStore = this.storeWithNotes(this.notes);
        this.notesMutationSeq += 1;
        const mutationSeq: number = this.notesMutationSeq;
        await this.cacheNotes();
        return this.persistNotesSnapshot(this.notesStore, mutationSeq);
    }

    // 删除随笔：第一版不提供复杂回收站，删除后立即从本地列表移除并同步云端
    async deleteNote(noteId: string): Promise<string> {
        if (!this.notesRemoteReady || this.notesStore === null) {
            return '云端随笔正在加载，请稍后再试';
        }

        const next: NoteItem[] = this.notes.filter((item: NoteItem): boolean => item.id !== noteId);

        if (next.length === this.notes.length) {
            return '';
        }

        this.notes = next;
        this.notesStore = this.storeWithNotes(this.notes);
        this.notesMutationSeq += 1;
        const mutationSeq: number = this.notesMutationSeq;
        await this.cacheNotes();
        return this.persistNotesSnapshot(this.notesStore, mutationSeq);
    }

    private async loadNotes(): Promise<void> {
        this.notesBaseStore = null;
        this.notesRemoteReady = false;

        if (this.context === null || this.username.trim().length === 0) {
            this.notes = [];
            return;
        }

        this.notesLoading = true;
        this.notesError = '';

        try {
            const raw: string = await PreferencesUtil.loadNotes(this.context, this.username.trim());

            if (raw.length === 0) {
                this.notes = [];
                return;
            }

            const parsed: Object[] | null = Json.parseArray(raw);

            if (parsed === null) {
                this.notesError = '本地随笔数据无法读取，请清理应用数据后重试';
                return;
            }

            const loaded: NoteItem[] = [];

            for (let i: number = 0; i < parsed.length; i++) {
                const source: Record<string, Object> = parsed[i] as Record<string, Object>;
                const id: string = Json.string(source, 'id');
                const content: string = Json.string(source, 'content');
                const updatedAt: number = TimeUtil.toMillis(Json.number(source, 'updatedAt'));

                if (id.length === 0 || content.trim().length === 0 || updatedAt <= 0) {
                    this.notesError = '本地随笔数据格式错误，请清理应用数据后重试';
                    return;
                }

                loaded.push({
                    id: id,
                    content: content,
                    updatedAt: updatedAt,
                    notebookId: Json.string(source, 'notebookId').length > 0 ? Json.string(source, 'notebookId') : 'nb_default',
                    source: Json.string(source, 'source').length > 0 ? Json.string(source, 'source') : '随笔',
                    sourceTitle: Json.string(source, 'sourceTitle'),
                    anchor: Json.object(source, 'anchor')
                });
            }

            this.notes = this.sortNotes(loaded);
        } catch (error) {
            hilog.error(DOMAIN, TAG, '[loadNotes] failed: %{public}s', JSON.stringify(error));
            this.notesError = '本地随笔读取失败，请重试';
        } finally {
            this.notesLoading = false;
        }
    }

    private findNote(noteId: string): NoteItem | null {
        for (let i: number = 0; i < this.notes.length; i++) {
            if (this.notes[i].id === noteId) {
                return this.notes[i];
            }
        }

        return null;
    }

    private sortNotes(items: NoteItem[]): NoteItem[] {
        const sorted: NoteItem[] = items.slice();
        sorted.sort((a: NoteItem, b: NoteItem): number => b.updatedAt - a.updatedAt);
        return sorted;
    }

    private applyNotesStore(store: NotesStore): void {
        this.notesStore = {
            activeNotebookId: store.activeNotebookId,
            notebooks: store.notebooks.slice(),
            notes: this.sortNotes(store.notes),
            updatedAt: store.updatedAt
        };
        this.notes = this.sortNotes(store.notes);
    }

    private copyNotesStore(store: NotesStore): NotesStore {
        return {
            activeNotebookId: store.activeNotebookId,
            notebooks: store.notebooks.map((item: NoteNotebook): NoteNotebook => {
                return { id: item.id, name: item.name, ts: item.ts };
            }),
            notes: store.notes.map((item: NoteItem): NoteItem => {
                return {
                    id: item.id,
                    content: item.content,
                    updatedAt: item.updatedAt,
                    notebookId: item.notebookId,
                    source: item.source,
                    sourceTitle: item.sourceTitle,
                    anchor: item.anchor
                };
            }),
            updatedAt: store.updatedAt
        };
    }

    private storeWithNotes(notes: NoteItem[]): NotesStore {
        const store: NotesStore = this.notesStore as NotesStore;
        return {
            activeNotebookId: store.activeNotebookId,
            notebooks: store.notebooks.slice(),
            notes: notes.slice(),
            updatedAt: Date.now()
        };
    }

    // 所有云端写入串行执行，并保留请求序号，避免旧响应覆盖较新的本地编辑
    private persistNotesSnapshot(snapshot: NotesStore, mutationSeq: number): Promise<string> {
        const write: Promise<string> = this.notesWriteChain.then(
            (): Promise<string> => this.writeNotesSnapshot(snapshot, mutationSeq),
            (): Promise<string> => this.writeNotesSnapshot(snapshot, mutationSeq)
        );
        this.notesWriteChain = write.then(
            (): void => {},
            (): void => {}
        );
        return write;
    }

    private async writeNotesSnapshot(snapshot: NotesStore, mutationSeq: number): Promise<string> {
        if (this.notesBaseStore === null) {
            const message: string = '云端随笔基线缺失，请刷新后重试';
            this.notesError = message;
            hilog.error(DOMAIN, TAG, '[writeNotesSnapshot] base store missing');
            return message;
        }

        const result: NotesStoreResult = await ApiService.saveNotesStore(snapshot, this.notesBaseStore);

        if (!result.success || result.store === null) {
            this.notesError = result.message;
            hilog.error(DOMAIN, TAG, '[writeNotesSnapshot] failed: %{public}s', result.message);
            return result.message;
        }

        this.notesBaseStore = this.copyNotesStore(result.store);

        // 有更新的本地编辑排在当前请求后面时，不能用旧响应覆盖编辑器里的新内容。
        if (mutationSeq === this.notesMutationSeq) {
            this.applyNotesStore(result.store);
            await this.cacheNotes();
        }

        this.notesError = '';
        return '';
    }

    private async cacheNotes(): Promise<void> {
        if (this.context === null || this.username.trim().length === 0) {
            return;
        }

        try {
            await PreferencesUtil.saveNotes(this.context, this.username.trim(), JSON.stringify(this.notes));
        } catch (error) {
            hilog.error(DOMAIN, TAG, '[cacheNotes] failed: %{public}s', JSON.stringify(error));
        }
    }

    // 标记邮件已读：服务端落盘后同步更新本地列表项，列表未读点即时消失
    async markMailRead(mailId: string): Promise<string> {
        const result = await ApiService.markMailRead(mailId);

        if (!result.success) {
            return result.message;
        }

        const updated: MailItem[] = this.mailList.map((item: MailItem): MailItem => {
            if (item.id !== mailId) {
                return item;
            }

            return { id: item.id, box: item.box, subject: item.subject, peer: item.peer, time: item.time, unread: false, preview: item.preview };
        });

        this.mailList = updated;
        return '';
    }

    // 拉取服务端资料（展示名 / 头像），校正本地可能已失效或脏（字面量 "undefined"）的身份缓存
    async refreshUserProfile(): Promise<void> {
        if (!this.loggedIn) {
            return;
        }

        const result: UserInfoResult = await ApiService.fetchUserInfo();

        hilog.info(DOMAIN, TAG, '[refreshUserProfile] success=%{public}s, rawAvatarUrl=%{public}s', result.success, result.avatarUrl);

        if (!result.success) {
            return;
        }

        const display: string = sanitizeDisplayName(result.username);
        const serverId: string = sanitizeDisplayName(result.id);
        const avatar: string = this.toAbsoluteAvatarUrl(result.avatarUrl);

        hilog.info(DOMAIN, TAG, '[refreshUserProfile] normalized avatar=%{public}s, lastRemote=%{public}s', avatar, this.avatarRemoteUrl);

        // 凭证本身是脏值（历史版本误存 "undefined"）时才用服务端登录 id 回填并持久化，
        // 避免把展示名写进登录凭证导致下次登录预填被带偏
        if (serverId.length > 0 && sanitizeDisplayName(this.username).length === 0) {
            this.username = serverId;
            await this.persistSession();
        }

        // 展示名只进 displayName：服务端展示名与登录凭证可能不同，两者分开存放
        if (display.length > 0 && display !== this.displayName) {
            this.displayName = display;
        }

        // 头像：Image 组件无法加载自签 https 图片，需先下载到本地缓存再喂给 Image。
        // avatarRemoteUrl 记录上次成功落地的服务端 URL，未变化时跳过重复下载
        if (avatar.length === 0) {
            hilog.info(DOMAIN, TAG, '[refreshUserProfile] avatar empty, clear local');
            this.avatarRemoteUrl = '';
            this.avatarUrl = '';
        } else if (avatar !== this.avatarRemoteUrl) {
            const localPath: string = await this.fetchAvatarToLocal(avatar);

            if (localPath.length > 0) {
                this.avatarRemoteUrl = avatar;
                this.avatarUrl = localPath;
                hilog.info(DOMAIN, TAG, '[refreshUserProfile] avatar updated, localPath=%{public}s', localPath);
            }
        } else {
            hilog.info(DOMAIN, TAG, '[refreshUserProfile] avatar unchanged, skip download');
        }
    }

    // 下载网络头像到本地缓存，返回本地文件路径；Image 加载本地文件不涉及证书校验
    private async fetchAvatarToLocal(url: string): Promise<string> {
        if (this.context === null) {
            hilog.error(DOMAIN, TAG, '[fetchAvatarToLocal] context is null, cannot download');
            return '';
        }

        hilog.info(DOMAIN, TAG, '[fetchAvatarToLocal] downloading %{public}s', url);
        const buffer: ArrayBuffer | null = await HttpUtil.downloadBinary(url);

        if (buffer === null) {
            hilog.error(DOMAIN, TAG, '[fetchAvatarToLocal] download returned null for %{public}s', url);
            return '';
        }

        const localPath: string = this.context.cacheDir + '/avatar.png';
        const file: fs.File = fs.openSync(localPath, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
        fs.writeSync(file.fd, buffer);
        fs.closeSync(file);

        // Image 组件加载本地文件需 file:// URI 前缀，裸绝对路径会报 102091 get asset failed
        const fileUri: string = 'file://' + localPath;
        hilog.info(DOMAIN, TAG, '[fetchAvatarToLocal] ok, bytes=%{public}d, fileUri=%{public}s', buffer.byteLength, fileUri);
        return fileUri;
    }

    // 头像地址归一化：服务端无公网 base 时只回相对路径，此处补齐为当前后端可达的绝对地址
    private toAbsoluteAvatarUrl(raw: string): string {
        const path: string = raw.trim();

        if (path.length === 0 || path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }

        if (path.startsWith('/')) {
            let base: string = this.backendUrl;

            while (base.length > 0 && base.endsWith('/')) {
                base = base.substring(0, base.length - 1);
            }

            return base + path;
        }

        return path;
    }

    private async persistSession(): Promise<void> {
        if (this.context === null) {
            return;
        }

        await PreferencesUtil.saveBackendUrl(this.context, this.backendUrl);
        await PreferencesUtil.saveUsername(this.context, this.username);
        await PreferencesUtil.saveSessionCookie(this.context, HttpUtil.getSessionCookie());
    }
}
