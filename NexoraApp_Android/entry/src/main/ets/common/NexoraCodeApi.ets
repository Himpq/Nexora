// 电脑任务协议：云端仅转发，所有会话与执行状态均来自目标电脑。
import { HttpUtil, HttpResult } from './HttpUtil';
import { Json } from './JsonUtil';

export interface RemoteDevice {
    id: string;
    name: string;
    online: boolean;
}

export interface RemoteConversation {
    id: string;
    title: string;
    project: Object | null;
    projectPath: string;
}

export interface RemoteTaskBody {
    request_id: string;
    conversation_id: string;
    message: string;
    model_name: string;
}

/** 电脑上可用的模型，id 形如 provider_id/model，与电脑侧解析模型的方式一致。 */
export interface RemoteModel {
    id: string;
    name: string;
    provider: string;
}

/** 电脑的模型目录。default_model 是电脑自己认的默认（来自 providers.json 的 default_id）。 */
export interface RemoteModelCatalog {
    defaultModel: string;
    models: RemoteModel[];
}

interface RpcQuery { after: number; }
interface RpcBody { path: string; method: string; body?: Object; query?: RpcQuery; }
interface LocalMetadata { nexoracode_project?: Object; }
interface CreateConversationBody { metadata: LocalMetadata; }
interface GrantBody { conversation_id: string; permission_request: Object; }

export class NexoraCodeApi {
    private static parse(result: HttpResult): Record<string, Object> {
        const payload: Record<string, Object> | null = Json.parseObject(result.body);

        if (!result.ok || payload === null) {
            throw new Error(payload === null ? '远程连接失败：' + result.code : Json.string(payload, 'message'));
        }

        return payload;
    }

    static async devices(): Promise<RemoteDevice[]> {
        const payload: Record<string, Object> = NexoraCodeApi.parse(await HttpUtil.get('/api/nexoracode/devices'));
        return Json.array(payload, 'devices').map((raw: Object): RemoteDevice => {
            const row: Record<string, Object> = raw as Record<string, Object>;
            return { id: Json.string(row, 'device_id'), name: Json.string(row, 'name'), online: Json.boolean(row, 'online') };
        });
    }

    static async rpc(deviceId: string, path: string, method: string = 'GET', body?: Object, after?: number): Promise<Record<string, Object>> {
        const payload: RpcBody = { path: path, method: method, body: body };

        if (after !== undefined) {
            payload.query = { after: after };
        }

        return NexoraCodeApi.parse(await HttpUtil.post('/api/nexoracode/devices/' + encodeURIComponent(deviceId) + '/rpc', payload));
    }

    static async conversations(deviceId: string): Promise<RemoteConversation[]> {
        const data: Record<string, Object> = await NexoraCodeApi.rpc(deviceId, '/api/conversations');
        return Json.array(data, 'conversations').map((raw: Object): RemoteConversation => {
            const row: Record<string, Object> = raw as Record<string, Object>;
            const metadata: Record<string, Object> | null = Json.object(row, 'metadata');
            const project: Record<string, Object> | null = metadata === null ? null : Json.object(metadata, 'nexoracode_project');
            return { id: Json.string(row, 'conversation_id'), title: Json.string(row, 'title'), project: project, projectPath: project === null ? '' : Json.string(project, 'path') };
        });
    }

    static async createConversation(deviceId: string, project: Object | null): Promise<string> {
        const metadata: LocalMetadata = {};

        if (project !== null) {
            metadata.nexoracode_project = project;
        }

        const body: CreateConversationBody = { metadata: metadata };
        const result: Record<string, Object> = await NexoraCodeApi.rpc(deviceId, '/api/conversations', 'POST', body);
        return Json.string(result, 'conversation_id');
    }

    /**
     * 读取电脑的模型目录。
     *
     * 必须显式把 default_model 下发给电脑：桌面端把用户选择存在浏览器 localStorage，
     * 云端与手机都看不到；下发空串让电脑回退内部默认，实际用的可能和用户以为的不同。
     */
    static async models(deviceId: string): Promise<RemoteModelCatalog> {
        const data: Record<string, Object> = await NexoraCodeApi.rpc(deviceId, '/api/config');
        const models: RemoteModel[] = Json.array(data, 'models').map((raw: Object): RemoteModel => {
            const row: Record<string, Object> = raw as Record<string, Object>;
            return { id: Json.string(row, 'id'), name: Json.string(row, 'name'), provider: Json.string(row, 'provider') };
        });
        return { defaultModel: Json.string(data, 'default_model'), models: models };
    }

    static async grant(deviceId: string, conversationId: string, permission: Object): Promise<void> {
        const body: GrantBody = { conversation_id: conversationId, permission_request: permission };
        await NexoraCodeApi.rpc(deviceId, '/api/agent/permission/grant', 'POST', body);
    }
}
