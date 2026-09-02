// ApiService.ets - 业务接口层
// 每个方法对应一个后端端点，负责把 JSON 归一化成领域模型，UI 层只认识这里返回的类型

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConversationItem, ModelItem } from './AppConfig';
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

    // 会话消息：GET /api/conversations/{id}/messages
    static async fetchMessages(conversationId: string): Promise<MessageListResult> {
        const path: string = '/api/conversations/' + encodeURIComponent(conversationId) + '/messages?limit=50';
        const result: HttpResult = await HttpUtil.get(path);
        const payload: Record<string, Object> | null = ApiService.readPayload(result, '会话消息');

        if (payload === null) {
            return { success: false, message: ApiService.describeFailure(result), messages: [] };
        }

        const rawList: Object[] = Json.array(payload, 'messages');
        const messages: ChatMessage[] = [];

        for (let i: number = 0; i < rawList.length; i++) {
            const raw: RawHistoryMessage = rawList[i] as RawHistoryMessage;
            messages.push(messageFromHistory(raw, i));
        }

        return { success: true, message: '', messages: messages };
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
    static async createConversation(title: string): Promise<ConversationCreateResult> {
        const safeTitle: string = title.trim();
        const body: CreateConversationRequestBody = { title: safeTitle.length > 0 ? safeTitle : '新对话' };
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
