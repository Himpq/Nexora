// ApiService.ets - 业务接口层
// 每个方法对应一个后端端点，负责把 JSON 归一化成领域模型，UI 层只认识这里返回的类型

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConversationItem, KnowledgeItem, MailDetail, MailItem, ModelItem, NoteItem, NoteNotebook, NotesStore } from './AppConfig';
import { HttpResult, HttpUtil } from './HttpUtil';
import { Json } from './JsonUtil';
import { messageFromHistory, RawHistoryMessage } from './ChatTypes';
import { ChatMessage } from './ChatTypes';
import { TimeUtil } from './TimeUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraApi';

// 通用结果：success 表示业务成功，message 用于直接展示给用户的失败原因
export interface ApiListResult<T> {
    success: boolean;
    message: string;
    data: T[];
}

// 单次写操作结果：置顶 / 删除等变更类接口的归一化返回
export interface MutateResult {
    success: boolean;
    message: string;
}

// 预创建空会话返回：POST /api/conversations（服务端注释明言"供前端预创建使用"）
export interface ConversationCreateResult {
    success: boolean;
    message: string;
    conversationId: string;
    existed: boolean;
}

// 预创建请求体（ArkTS 限制：字面量须对应显式声明的 interface，不能赋给 Record）
interface CreateConversationRequestBody {
    title: string;
    conversation_mode?: string;
}

// 置顶请求体（ArkTS 限制：字面量须对应显式声明的 interface，不能赋给 Record）
interface PinRequestBody {
    pin: boolean;
}

export interface UserInfoResult {
    success: boolean;
    message: string;
    // 服务端登录 id（真正的凭证用户名）：仅用于修复本地被脏值污染的 username
    id: string;
    // 服务端展示名：/api/user/info 把 display_name 放在 user.username 字段，未配置时等同登录 id
    username: string;
    role: string;
    avatarUrl: string;
}

export interface MessageListResult {
    success: boolean;
    message: string;
    messages: ChatMessage[];
    hasMoreBefore: boolean;
    startIndex: number;
    total: number;
}

// 地图渲染配置：GET /api/map/provider → map_provider.map_renderer_config
export interface MapRendererConfigResult {
    success: boolean;
    message: string;
    provider: string;
    baiduMapAk: string;
    baiduMapVersion: string;
    tiandituMapTk: string;
    tiandituMapVersion: string;
}

// 地图 scene：GET /api/map/conversations/{cid}/maps/{mapId}/scene
export interface MapSceneResult {
    success: boolean;
    message: string;
    sceneJson: string;
}

// 知识库单条详情：GET /api/knowledge/basis/<title>
export interface KnowledgeDetailResult {
    success: boolean;
    message: string;
    title: string;
    content: string;
}

// 知识库空白创建结果：POST /api/knowledge/basis/blank
export interface KnowledgeCreateResult {
    success: boolean;
    message: string;
    title: string;
}

// 更新知识库请求体（ArkTS 限制：字面量须对应显式声明的 interface）
interface UpdateBasisRequestBody {
    title: string;
    content: string;
    url: string;
}

// 空白知识库创建请求体
interface CreateBlankRequestBody {
    title_prefix: string;
}

// 邮件已读标记请求体（ArkTS 限制：字面量须对应显式声明的 interface）
interface MailReadRequestBody {
    is_read: boolean;
}

// 邮件列表结果：收件箱/已发送共用，mails 已归一化为 MailItem
export interface MailListResult {
    success: boolean;
    message: string;
    mails: MailItem[];
}

// 邮件详情结果：正文为服务端提取的纯文本
export interface MailDetailResult {
    success: boolean;
    message: string;
    mail: MailDetail | null;
}

// 随笔云存储结果：后端返回三方合并后的完整快照，UI 层只消费归一化后的 NoteItem
export interface NotesStoreResult {
    success: boolean;
    message: string;
    store: NotesStore | null;
}

// Learning 运行时配置结果：管理端开关 + 前端工作区页面地址
export interface LearningRuntimeResult {
    success: boolean;
    message: string;
    enabled: boolean;
    frontendUrl: string;
}

interface NotesStoreRequestBody {
    store: NotesStorePayload;
    baseStore: NotesStorePayload;
}

interface NotesStorePayload {
    activeNotebookId: string;
    notebooks: NoteNotebookPayload[];
    notes: RemoteNotePayload[];
    updatedAt: number;
}

interface NoteNotebookPayload {
    id: string;
    name: string;
    ts: number;
}

interface RemoteNotePayload {
    id: string;
    notebookId: string;
    text: string;
    source: string;
    sourceTitle: string;
    anchor: Record<string, Object> | null;
    ts: number;
}

// 后端消息体里模型上下文窗口的候选字段名
const CONTEXT_WINDOW_KEYS: string[] = [
    'context_window',
    'context_length',
    'max_context_tokens',
    'max_input_tokens',
    'max_prompt_tokens'
];

export class ApiService {
    // 会话列表：GET /api/conversations
    static async fetchConversations(): Promise<ApiListResult<ConversationItem>> {
        const result: HttpResult = await HttpUtil.get('/api/conversations');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '会话列表');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), data: [] };
        }

        const rawList: Object[] = Json.array(payload, 'conversations');
        const list: ConversationItem[] = [];

        for (let i: number = 0; i < rawList.length; i++) {
            const item: ConversationItem | null = ApiService.toConversationItem(rawList[i]);

            if (item !== null) {
                list.push(item);
            }
        }

        hilog.info(DOMAIN, TAG, 'conversations loaded, count=%{public}d', list.length);
        return { success: true, message: '', data: list };
    }

    // 会话消息：GET /api/conversations/{id}/messages?limit=&before=
    // before=0 表示取最近 limit 条；before>0 表示取该索引之前 limit 条（更早的消息）
    static async fetchMessages(conversationId: string, limit: number, before: number): Promise<MessageListResult> {
        let path: string = '/api/conversations/' + encodeURIComponent(conversationId) + '/messages?limit=' + limit;

        if (before > 0) {
            path += '&before=' + before;
        }

        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '会话消息');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), messages: [], hasMoreBefore: false, startIndex: 0, total: 0 };
        }

        const rawList: Object[] = Json.array(payload, 'messages');
        const startIndex: number = Json.number(payload, 'start_index');
        const messages: ChatMessage[] = [];

        for (let i: number = 0; i < rawList.length; i++) {
            const raw: RawHistoryMessage = rawList[i] as RawHistoryMessage;
            messages.push(messageFromHistory(raw, startIndex + i));
        }

        return {
            success: true,
            message: '',
            messages: messages,
            hasMoreBefore: Json.boolean(payload, 'has_more_before'),
            startIndex: startIndex,
            total: Json.number(payload, 'total')
        };
    }

    // 地图渲染配置：GET /api/map/provider；渲染键嵌在 map_provider.map_renderer_config 一层之下
    static async fetchMapRendererConfig(): Promise<MapRendererConfigResult> {
        const result: HttpResult = await HttpUtil.get('/api/map/provider');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '地图配置');

        if (payload === null) {
            return {
                success: false,
                message: ApiService.describeFailure(result),
                provider: '',
                baiduMapAk: '',
                baiduMapVersion: '',
                tiandituMapTk: '',
                tiandituMapVersion: ''
            };
        }

        const providerNode: Record<string, Object> | null = Json.object(payload, 'map_provider');
        const renderer: Record<string, Object> | null = providerNode === null
            ? null
            : Json.object(providerNode, 'map_renderer_config');

        if (renderer === null) {
            return {
                success: false,
                message: '地图渲染配置缺失',
                provider: '',
                baiduMapAk: '',
                baiduMapVersion: '',
                tiandituMapTk: '',
                tiandituMapVersion: ''
            };
        }

        return {
            success: true,
            message: '',
            provider: Json.string(renderer, 'provider'),
            baiduMapAk: Json.string(renderer, 'baiduMapAk'),
            baiduMapVersion: Json.string(renderer, 'baiduMapVersion'),
            tiandituMapTk: Json.string(renderer, 'tiandituMapTk'),
            tiandituMapVersion: Json.string(renderer, 'tiandituMapVersion')
        };
    }

    // 地图 scene：GET /api/map/conversations/{cid}/maps/{mapId}/scene，scene 原样序列化交给渲染器
    static async fetchMapScene(conversationId: string, mapId: string): Promise<MapSceneResult> {
        const path: string = '/api/map/conversations/' + encodeURIComponent(conversationId)
            + '/maps/' + encodeURIComponent(mapId) + '/scene';
        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '地图记录');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), sceneJson: '' };
        }

        const scene: Record<string, Object> | null = Json.object(payload, 'scene');

        if (scene === null) {
            return { success: false, message: '地图记录不存在', sceneJson: '' };
        }

        return { success: true, message: '', sceneJson: JSON.stringify(scene) };
    }

    // 模型列表：GET /api/config，兼容数组与字典两种返回形态
    static async fetchModels(): Promise<ApiListResult<ModelItem>> {
        const result: HttpResult = await HttpUtil.get('/api/config');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '模型列表');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), data: [] };
        }

        const models: ModelItem[] = ApiService.normalizeModels(Json.fieldOrNull(payload, 'models'));
        return { success: true, message: '', data: models };
    }

    // 用户信息：GET /api/user/info
    static async fetchUserInfo(): Promise<UserInfoResult> {
        const result: HttpResult = await HttpUtil.get('/api/user/info');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '用户信息');

        if (payload === null) {
            return {
                success: false,
                message: ApiService.describeFailure(result),
                id: '',
                username: '',
                role: '',
                avatarUrl: ''
            };
        }

        const user: Record<string, Object> | null = Json.object(payload, 'user');
        const source: Record<string, Object> = user === null ? payload : user;

        return {
            success: true,
            message: '',
            id: Json.string(source, 'id'),
            username: Json.string(source, 'username'),
            role: Json.string(source, 'role'),
            avatarUrl: Json.string(source, 'avatar_url')
        };
    }

    // 置顶 / 取消置顶：PUT /api/conversations/{id}/pin
    static async pinConversation(conversationId: string, pin: boolean): Promise<MutateResult> {
        const path: string = '/api/conversations/' + encodeURIComponent(conversationId) + '/pin';
        const body: PinRequestBody = { pin: pin };
        const result: HttpResult = await HttpUtil.put(path, body);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // 删除会话（后端归档进回收站）：DELETE /api/conversations/{id}
    static async deleteConversation(conversationId: string): Promise<MutateResult> {
        const path: string = '/api/conversations/' + encodeURIComponent(conversationId);
        const result: HttpResult = await HttpUtil.delete(path);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // 预创建空会话：新对话首问在发流前先建会话，让 conversation_id 在流开始前已知
    // -> 侧栏可即时占位（回复途中即可见/高亮），且 ChatStreamClient 轮询兜底可凭 conversation_id 取流
    // mode 用于把会话固化在某个模式上（'learning' 的学习会话由后端持久化，后续消息自动沿用该模式）
    static async createConversation(title: string, mode: string = ''): Promise<ConversationCreateResult> {
        const safeTitle: string = title.trim();
        const body: CreateConversationRequestBody = { title: safeTitle.length > 0 ? safeTitle : '新对话' };
        const safeMode: string = mode.trim();

        if (safeMode.length > 0) {
            body.conversation_mode = safeMode;
        }

        const result: HttpResult = await HttpUtil.post('/api/conversations', body);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '预创建会话');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), conversationId: '', existed: false };
        }

        return {
            success: true,
            message: '',
            conversationId: Json.string(payload, 'conversation_id'),
            existed: Json.boolean(payload, 'existed')
        };
    }

    // ---------- 知识库 ----------
    // 知识库列表：GET /api/knowledge/basis?include_content=0（不带正文，列表场景）
    static async fetchKnowledgeList(): Promise<ApiListResult<KnowledgeItem>> {
        const result: HttpResult = await HttpUtil.get('/api/knowledge/basis?include_content=0');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '知识库列表');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), data: [] };
        }

        const rawList: Object[] = Json.array(payload, 'knowledge');
        const list: KnowledgeItem[] = [];

        for (let i: number = 0; i < rawList.length; i++) {
            const item: KnowledgeItem | null = ApiService.toKnowledgeItem(rawList[i]);

            if (item !== null) {
                list.push(item);
            }
        }

        hilog.info(DOMAIN, TAG, 'knowledge list loaded, count=%{public}d', list.length);
        return { success: true, message: '', data: list };
    }

    // 知识库单条详情：GET /api/knowledge/basis/<title>
    static async fetchKnowledgeDetail(title: string): Promise<KnowledgeDetailResult> {
        const path: string = '/api/knowledge/basis/' + encodeURIComponent(title);
        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '知识库详情');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), title: '', content: '' };
        }

        const knowledge: Record<string, Object> | null = Json.object(payload, 'knowledge');

        if (knowledge === null) {
            return { success: false, message: '知识库内容解析失败', title: '', content: '' };
        }

        return {
            success: true,
            message: '',
            title: Json.string(knowledge, 'title'),
            content: Json.string(knowledge, 'content')
        };
    }

    // 创建空白知识库：POST /api/knowledge/basis/blank，返回服务端生成的标题
    static async createBlankKnowledge(titlePrefix: string): Promise<KnowledgeCreateResult> {
        const body: CreateBlankRequestBody = { title_prefix: titlePrefix };
        const result: HttpResult = await HttpUtil.post('/api/knowledge/basis/blank', body);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '创建知识库');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), title: '' };
        }

        return {
            success: true,
            message: Json.string(payload, 'message'),
            title: Json.string(payload, 'title')
        };
    }

    // 更新知识库：PUT /api/knowledge/basis/<oldTitle>，body 含新标题与正文
    static async updateKnowledge(oldTitle: string, newTitle: string, content: string): Promise<MutateResult> {
        const path: string = '/api/knowledge/basis/' + encodeURIComponent(oldTitle);
        const body: UpdateBasisRequestBody = { title: newTitle, content: content, url: '' };
        const result: HttpResult = await HttpUtil.put(path, body);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // 删除知识库：DELETE /api/knowledge/basis/<title>
    static async deleteKnowledge(title: string): Promise<MutateResult> {
        const path: string = '/api/knowledge/basis/' + encodeURIComponent(title);
        const result: HttpResult = await HttpUtil.delete(path);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // 置顶 / 取消置顶：PUT /api/knowledge/basis/<title>/pin
    static async pinKnowledge(title: string, pin: boolean): Promise<MutateResult> {
        const path: string = '/api/knowledge/basis/' + encodeURIComponent(title) + '/pin';
        const body: PinRequestBody = { pin: pin };
        const result: HttpResult = await HttpUtil.put(path, body);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // 随笔快照：GET /api/notes/store
    static async fetchNotesStore(): Promise<NotesStoreResult> {
        const result: HttpResult = await HttpUtil.get('/api/notes/store');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '随笔列表');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), store: null };
        }

        const rawStore: Record<string, Object> | null = Json.object(payload, 'store');
        const store: NotesStore | null = rawStore === null ? null : ApiService.toNotesStore(rawStore);

        if (store === null) {
            return { success: false, message: '随笔数据解析失败', store: null };
        }

        hilog.info(DOMAIN, TAG, 'notes store loaded, count=%{public}d', store.notes.length);
        return { success: true, message: '', store: store };
    }

    // 随笔快照：PUT /api/notes/store，提交当前快照与上次云端基线，由服务端合并
    static async saveNotesStore(store: NotesStore, baseStore: NotesStore): Promise<NotesStoreResult> {
        const body: NotesStoreRequestBody = {
            store: ApiService.toNotesStorePayload(store),
            baseStore: ApiService.toNotesStorePayload(baseStore)
        };
        const result: HttpResult = await HttpUtil.put('/api/notes/store', body);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '保存随笔');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), store: null };
        }

        const rawStore: Record<string, Object> | null = Json.object(payload, 'store');
        const normalized: NotesStore | null = rawStore === null ? null : ApiService.toNotesStore(rawStore);

        if (normalized === null) {
            return { success: false, message: '保存后的随笔数据解析失败', store: null };
        }

        hilog.info(DOMAIN, TAG, 'notes store saved, count=%{public}d', normalized.notes.length);
        return { success: true, message: '', store: normalized };
    }

    // ---------- Learning ----------
    // Learning 运行时配置：GET /api/user/preferences（learning_runtime 在响应顶层，与 preferences 平级）
    static async fetchLearningRuntime(): Promise<LearningRuntimeResult> {
        const result: HttpResult = await HttpUtil.get('/api/user/preferences');
        const payload: Record<string, Object> | null = ApiService.readPayload(result, 'Learning 配置');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), enabled: false, frontendUrl: '' };
        }

        const runtime: Record<string, Object> | null = Json.object(payload, 'learning_runtime');

        if (runtime === null) {
            return { success: false, message: 'Learning 未配置', enabled: false, frontendUrl: '' };
        }

        const enabled: boolean = Json.boolean(runtime, 'enabled');
        const frontendUrl: string = Json.string(runtime, 'frontend_url');

        hilog.info(DOMAIN, TAG, 'learning runtime loaded, enabled=%{public}s', enabled ? 'true' : 'false');
        return { success: true, message: '', enabled: enabled, frontendUrl: frontendUrl };
    }

    // ---------- 邮件 ----------
    // 邮件列表：GET /api/mail/me/{inbox|sent}?offset=&limit=[&q=]，服务端按登录用户自动绑定邮箱
    // query 非空时作为服务端搜索关键字下发（q 参数）
    static async fetchMailList(box: string, offset: number, limit: number, query: string): Promise<MailListResult> {
        let path: string = '/api/mail/me/' + box + '?offset=' + offset + '&limit=' + limit;

        if (query.length > 0) {
            path += '&q=' + encodeURIComponent(query);
        }

        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '邮件列表');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), mails: [] };
        }

        const rawList: Object[] = Json.array(payload, 'mails');
        const mails: MailItem[] = [];

        for (let i: number = 0; i < rawList.length; i++) {
            const item: MailItem | null = ApiService.toMailItem(rawList[i], box);

            if (item !== null) {
                mails.push(item);
            }
        }

        hilog.info(DOMAIN, TAG, 'mail list loaded, box=%{public}s count=%{public}d', box, mails.length);
        return { success: true, message: '', mails: mails };
    }

    // 邮件详情：GET /api/mail/me/{box}/<mail_id>，正文取服务端提取的纯文本 content_text
    static async fetchMailDetail(box: string, mailId: string): Promise<MailDetailResult> {
        const path: string = '/api/mail/me/' + box + '/' + encodeURIComponent(mailId);
        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '邮件详情');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), mail: null };
        }

        const source: Record<string, Object> | null = Json.object(payload, 'mail');

        if (source === null) {
            return { success: false, message: '邮件内容解析失败', mail: null };
        }

        const timestamp: number = Json.number(source, 'timestamp');
        const id: string = Json.string(source, 'id');
        const mail: MailDetail = {
            id: id.length > 0 ? id : mailId,
            subject: Json.string(source, 'subject'),
            sender: Json.string(source, 'sender'),
            recipient: Json.string(source, 'recipient'),
            time: timestamp > 0 ? TimeUtil.short(timestamp) : Json.string(source, 'date'),
            content: Json.string(source, 'content_text'),
            contentHtml: Json.string(source, 'content_html')
        };
        return { success: true, message: '', mail: mail };
    }

    // 标记已读：PATCH /api/mail/me/inbox/<mail_id>/read（已发送箱无已读概念，仅收件箱调用）
    static async markMailRead(mailId: string): Promise<MutateResult> {
        const path: string = '/api/mail/me/inbox/' + encodeURIComponent(mailId) + '/read';
        const body: MailReadRequestBody = { is_read: true };
        const result: HttpResult = await HttpUtil.patch(path, body);

        if (result.code === 0 || !result.ok) {
            return { success: false, message: ApiService.describeFailure(result) };
        }

        return { success: true, message: '' };
    }

    // ---------- 内部实现 ----------
    // 统一判定：网络层失败或状态码非 200 一律视为业务失败，返回 null 交由调用方转成失败结果
    private static readPayload(result: HttpResult, scene: string): Record<string, Object> | null {
        if (result.code === 0) {
            hilog.error(DOMAIN, TAG, '%{public}s request failed, network unreachable', scene);
            return null;
        }

        if (!result.ok) {
            hilog.error(DOMAIN, TAG, '%{public}s request failed, code=%{public}d', scene, result.code);
            return null;
        }

        return Json.parseObject(result.body);
    }

    private static describeFailure(result: HttpResult): string {
        if (result.code === 0) {
            return '网络请求失败，请检查后端地址与网络';
        }

        if (result.code === 401) {
            return '登录已过期，请重新登录';
        }

        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        if (payload !== null) {
            const serverMessage: string = Json.string(payload, 'message');

            if (serverMessage.length > 0) {
                return serverMessage;
            }
        }

        return '请求失败(' + result.code + ')';
    }

    private static toConversationItem(raw: Object): ConversationItem | null {
        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'conversation_id');

        if (id.length === 0) {
            return null;
        }

        const title: string = Json.string(source, 'title');
        const updatedAt: number = Json.number(source, 'updated_at');

        return {
            id: id,
            title: title.length > 0 ? title : '新对话',
            preview: title,
            time: TimeUtil.short(updatedAt),
            mode: Json.string(source, 'conversation_mode'),
            pin: Json.boolean(source, 'pin')
        };
    }

    private static toKnowledgeItem(raw: Object): KnowledgeItem | null {
        const source: Record<string, Object> = raw as Record<string, Object>;
        const title: string = Json.string(source, 'title');

        if (title.length === 0) {
            return null;
        }

        const updatedAt: number = Json.number(source, 'updated_at');

        return {
            title: title,
            pin: Json.boolean(source, 'pin'),
            updatedAt: updatedAt,
            time: TimeUtil.short(updatedAt),
            basisId: Json.string(source, 'basis_id')
        };
    }

    private static toNotesStore(raw: Record<string, Object>): NotesStore | null {
        const rawNotebooks: Object[] = Json.array(raw, 'notebooks');
        const notebooks: NoteNotebook[] = [];

        for (let i: number = 0; i < rawNotebooks.length; i++) {
            const notebook: NoteNotebook | null = ApiService.toNoteNotebook(rawNotebooks[i]);

            if (notebook === null) {
                return null;
            }

            notebooks.push(notebook);
        }

        if (notebooks.length === 0) {
            return null;
        }

        const activeNotebookId: string = Json.string(raw, 'activeNotebookId');
        const notebookExists: boolean = notebooks.some((item: NoteNotebook): boolean => item.id === activeNotebookId);

        if (!notebookExists) {
            return null;
        }

        const rawNotes: Object[] = Json.array(raw, 'notes');
        const notes: NoteItem[] = [];

        for (let i: number = 0; i < rawNotes.length; i++) {
            const note: NoteItem | null = ApiService.toNoteItem(rawNotes[i]);

            if (note === null) {
                return null;
            }

            notes.push(note);
        }

        return {
            activeNotebookId: activeNotebookId,
            notebooks: notebooks,
            notes: notes,
            updatedAt: TimeUtil.toMillis(Json.number(raw, 'updatedAt'))
        };
    }

    private static toNoteNotebook(raw: Object): NoteNotebook | null {
        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');
        const name: string = Json.string(source, 'name');
        const ts: number = TimeUtil.toMillis(Json.number(source, 'ts'));

        if (id.length === 0 || name.length === 0 || ts <= 0) {
            return null;
        }

        return { id: id, name: name, ts: ts };
    }

    private static toNoteItem(raw: Object): NoteItem | null {
        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');
        const content: string = Json.string(source, 'text');
        const notebookId: string = Json.string(source, 'notebookId');
        const updatedAt: number = TimeUtil.toMillis(Json.number(source, 'ts'));

        if (id.length === 0 || content.trim().length === 0 || notebookId.length === 0 || updatedAt <= 0) {
            return null;
        }

        return {
            id: id,
            content: content,
            updatedAt: updatedAt,
            notebookId: notebookId,
            source: Json.string(source, 'source'),
            sourceTitle: Json.string(source, 'sourceTitle'),
            anchor: Json.object(source, 'anchor')
        };
    }

    private static toNotesStorePayload(store: NotesStore): NotesStorePayload {
        const notebooks: NoteNotebookPayload[] = store.notebooks.map((item: NoteNotebook): NoteNotebookPayload => {
            return { id: item.id, name: item.name, ts: item.ts };
        });
        const notes: RemoteNotePayload[] = store.notes.map((item: NoteItem): RemoteNotePayload => {
            return {
                id: item.id,
                notebookId: item.notebookId,
                text: item.content,
                source: item.source,
                sourceTitle: item.sourceTitle,
                anchor: item.anchor,
                ts: item.updatedAt
            };
        });

        return {
            activeNotebookId: store.activeNotebookId,
            notebooks: notebooks,
            notes: notes,
            updatedAt: Date.now()
        };
    }

    // 邮件列表项归一化：peer 按来源取发件人（收件箱）或收件人（已发送）；
    // 时间优先取 timestamp 短格式，缺失时直接展示服务端 date 文案
    private static toMailItem(raw: Object, box: string): MailItem | null {
        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');

        if (id.length === 0) {
            return null;
        }

        const subject: string = Json.string(source, 'subject');
        const timestamp: number = Json.number(source, 'timestamp');

        return {
            id: id,
            box: box,
            subject: subject.length > 0 ? subject : '（无主题）',
            peer: box === 'inbox' ? Json.string(source, 'sender') : Json.string(source, 'recipient'),
            time: timestamp > 0 ? TimeUtil.short(timestamp) : Json.string(source, 'date'),
            unread: !Json.boolean(source, 'is_read'),
            preview: Json.string(source, 'preview_text')
        };
    }

    // 模型字段归一化：支持 Array<string|Object> 与 {id: {...}} 两种形态
    private static normalizeModels(raw: Object | null): ModelItem[] {
        if (raw === null) {
            return [];
        }

        if (Array.isArray(raw)) {
            return ApiService.normalizeModelArray(raw as Object[]);
        }

        return ApiService.normalizeModelDict(raw as Record<string, Object>);
    }

    private static normalizeModelArray(items: Object[]): ModelItem[] {
        const models: ModelItem[] = [];

        for (let i: number = 0; i < items.length; i++) {
            const item: Object = items[i];

            if (typeof item === 'string') {
                const id: string = (item as string).trim();

                if (id.length > 0) {
                    models.push({ id: id, name: id, provider: '' });
                }

                continue;
            }

            const model: ModelItem | null = ApiService.toModelItem(item as Record<string, Object>);

            if (model !== null) {
                models.push(model);
            }
        }

        return models;
    }

    private static normalizeModelDict(dict: Record<string, Object>): ModelItem[] {
        const keys: string[] = Object.keys(dict);
        const models: ModelItem[] = [];

        for (let i: number = 0; i < keys.length; i++) {
            const id: string = keys[i].trim();

            if (id.length === 0) {
                continue;
            }

            const value: Object = dict[id];

            if (value === null || typeof value !== 'object') {
                models.push({ id: id, name: id, provider: '' });
                continue;
            }

            const model: ModelItem | null = ApiService.toModelItem(value as Record<string, Object>);

            if (model !== null) {
                models.push(model);
            }
        }

        return models;
    }

    private static toModelItem(source: Record<string, Object>): ModelItem | null {
        const id: string = Json.string(source, 'id').trim();

        if (id.length === 0) {
            return null;
        }

        const name: string = Json.string(source, 'name');
        const status: string = Json.string(source, 'status');
        const model: ModelItem = {
            id: id,
            name: name.length > 0 ? name : id,
            provider: Json.string(source, 'provider')
        };

        const contextWindow: number = ApiService.readContextWindow(source);

        if (contextWindow > 0) {
            model.contextWindow = contextWindow;
        }

        if (status.length > 0) {
            model.status = status;
        }

        return model;
    }

    private static readContextWindow(source: Record<string, Object>): number {
        for (let i: number = 0; i < CONTEXT_WINDOW_KEYS.length; i++) {
            const value: number = Json.number(source, CONTEXT_WINDOW_KEYS[i]);

            if (value >= 1024) {
                return Math.floor(value);
            }
        }

        return 0;
    }
}
