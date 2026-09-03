// AppState.ets - 全局应用状态
// 登录态、后端地址、模型选择、会话列表都挂在这里，页面只消费状态不做网络与持久化细节
// 采用进程内单例 + @Observed，任一处修改都会驱动已挂载页面刷新

import common from '@ohos.app.ability.common';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConversationItem, DEFAULT_BACKEND_URL, KnowledgeItem, ModelItem, sanitizeDisplayName } from './AppConfig';
import { ApiService, UserInfoResult } from './ApiService';
import { HttpUtil } from './HttpUtil';
import { PreferencesUtil } from './PreferencesUtil';

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

    private context: common.UIAbilityContext | null = null;

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
        this.backendUrl = await PreferencesUtil.loadBackendUrl(context, DEFAULT_BACKEND_URL);
        // 历史版本可能把字面量 "undefined" 写进 username 键，读取即清洗，展示/预填不再依赖各页兜底
        this.username = sanitizeDisplayName(await PreferencesUtil.loadUsername(context));
        this.selectedModelId = await PreferencesUtil.loadSelectedModel(context);
        this.enableThinking = await PreferencesUtil.loadEnableThinking(context);
        this.enableWebSearch = await PreferencesUtil.loadEnableWebSearch(context);
        this.forceTools = await PreferencesUtil.loadForceTools(context);

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
        this.conversations = [];
        this.models = [];
        this.selectedModelId = '';
        this.selectedModelLabel = '选择模型';
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

    // 拉取服务端资料（展示名 / 头像），校正本地可能已失效或脏（字面量 "undefined"）的身份缓存
    async refreshUserProfile(): Promise<void> {
        if (!this.loggedIn) {
            return;
        }

        const result: UserInfoResult = await ApiService.fetchUserInfo();

        if (!result.success) {
            return;
        }

        const display: string = sanitizeDisplayName(result.username);
        const serverId: string = sanitizeDisplayName(result.id);
        const avatar: string = this.toAbsoluteAvatarUrl(result.avatarUrl);

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

        if (avatar.length > 0 && avatar !== this.avatarUrl) {
            this.avatarUrl = avatar;
        }
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
