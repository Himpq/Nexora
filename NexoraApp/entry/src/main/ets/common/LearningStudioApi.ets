// LearningStudioApi.ets - NexoraLearning 学习资源 / 学习动态 / 学习画像域接口
// 资源工作台产出物（文章与视频）、首页推送卡、动态流、六维画像四条链路共用一处解析，
// 页面按需取用，不再各自拆字段。

import { Json } from './JsonUtil';
import { LearningBody, LearningHttp } from './LearningHttp';

// 学习资源（工作台产出物，content 为 Markdown）
export interface LearningResource {
    id: string;
    title: string;
    summary: string;
    resourceType: string;
    lectureTitle: string;
    status: string;
    content: string;
    publishedAt: number;
}

// 资源哨兵：文章页在资源未就绪时不参与渲染，避免渲染层反复判空
export const NO_RESOURCE: LearningResource = {
    id: '',
    title: '',
    summary: '',
    resourceType: '',
    lectureTitle: '',
    status: '',
    content: '',
    publishedAt: 0,
};

// 首页资源推送卡（文章 / 视频两类）
export interface LearningPush {
    id: string;
    title: string;
    subtitle: string;
    badge: string;
    type: string;
    description: string;
    lectureId: string;
}

// 学习动态条目
export interface LearningFeedItem {
    id: string;
    authorName: string;
    content: string;
    timestamp: number;
    likesCount: number;
    commentsCount: number;
}

// 画像维度（后端 dimensions 为 key -> {name, value, filled} 的字典）
export interface LearningProfileDimension {
    key: string;
    name: string;
    value: string;
    filled: boolean;
}

// 画像评分项（未评估时 score 为 null，用 hasScore 表达）
export interface LearningScore {
    key: string;
    name: string;
    evidence: string;
    hasScore: boolean;
    score: number;
}

export interface LearningProfileData {
    dimensions: LearningProfileDimension[];
    scores: LearningScore[];
    filledCount: number;
    totalCount: number;
    scoredCount: number;
    scoreTotal: number;
    completionRate: number;
}

export interface LearningResourceResult {
    success: boolean;
    message: string;
    resources: LearningResource[];
}

export interface LearningPushResult {
    success: boolean;
    message: string;
    pushes: LearningPush[];
}

export interface LearningFeedResult {
    success: boolean;
    message: string;
    items: LearningFeedItem[];
}

export interface LearningProfileResult {
    success: boolean;
    message: string;
    profile: LearningProfileData;
}

// 空画像：每次调用返回新对象，避免多个 @State 共享同一实例

export function emptyProfile(): LearningProfileData {
    return {
        dimensions: [],
        scores: [],
        filledCount: 0,
        totalCount: 0,
        scoredCount: 0,
        scoreTotal: 0,
        completionRate: 0,
    };
}

export class LearningStudioApi {
    static readonly shared: LearningStudioApi = new LearningStudioApi();

    // 学习资源列表：GET /api/frontend/learning-resources?limit=
    async getResources(limit: number): Promise<LearningResourceResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/learning-resources?limit=' + limit);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, resources: [] };
        }

        const rows: Object[] = Json.array(body.payload, 'items');
        const resources: LearningResource[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningResource | null = LearningStudioApi.toResource(rows[i]);

            if (item !== null) {
                resources.push(item);
            }
        }

        return { success: true, message: '', resources: resources };
    }

    // 首页资源推送：GET /api/frontend/learning-resource-pushes
    async getPushes(): Promise<LearningPushResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/learning-resource-pushes');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, pushes: [] };
        }

        const rows: Object[] = Json.array(body.payload, 'items');
        const pushes: LearningPush[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningPush | null = LearningStudioApi.toPush(rows[i]);

            if (item !== null) {
                pushes.push(item);
            }
        }

        return { success: true, message: '', pushes: pushes };
    }

    // 学习动态：GET /api/frontend/learning-feeds?limit=
    async getFeeds(limit: number): Promise<LearningFeedResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/learning-feeds?limit=' + limit);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, items: [] };
        }

        const rows: Object[] = Json.array(body.payload, 'items');
        const items: LearningFeedItem[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningFeedItem | null = LearningStudioApi.toFeedItem(rows[i]);

            if (item !== null) {
                items.push(item);
            }
        }

        return { success: true, message: '', items: items };
    }

    // 六维画像：GET /api/frontend/profile-center
    async getProfile(): Promise<LearningProfileResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/profile-center');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, profile: emptyProfile() };
        }

        return { success: true, message: '', profile: LearningStudioApi.toProfile(body.payload) };
    }

    // ---------- 字段映射 ----------
    private static toResource(raw: Object | null): LearningResource | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');

        if (id.length === 0) {
            return null;
        }

        return {
            id: id,
            title: Json.string(source, 'title'),
            summary: Json.string(source, 'summary'),
            resourceType: Json.string(source, 'resource_type'),
            lectureTitle: Json.string(source, 'lecture_title'),
            status: Json.string(source, 'status'),
            content: Json.string(source, 'content'),
            publishedAt: Json.number(source, 'published_at'),
        };
    }

    private static toPush(raw: Object | null): LearningPush | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');

        if (id.length === 0) {
            return null;
        }

        return {
            id: id,
            title: Json.string(source, 'title'),
            subtitle: Json.string(source, 'subtitle'),
            badge: Json.string(source, 'badge'),
            type: Json.string(source, 'type'),
            description: Json.string(source, 'description'),
            lectureId: Json.string(source, 'lectureId'),
        };
    }

    private static toFeedItem(raw: Object | null): LearningFeedItem | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'id');

        if (id.length === 0) {
            return null;
        }

        const author: Record<string, Object> | null = Json.object(source, 'author');

        return {
            id: id,
            authorName: author === null ? '' : Json.string(author, 'username'),
            content: Json.string(source, 'content'),
            timestamp: Json.number(source, 'timestamp'),
            likesCount: Json.number(source, 'likes_count'),
            commentsCount: Json.number(source, 'comments_count'),
        };
    }

    private static toProfile(payload: Record<string, Object>): LearningProfileData {
        return {
            dimensions: LearningStudioApi.toDimensions(Json.object(payload, 'dimensions')),
            scores: LearningStudioApi.toScores(Json.array(payload, 'scores')),
            filledCount: Json.number(payload, 'profile_filled_count'),
            totalCount: Json.number(payload, 'profile_total'),
            scoredCount: Json.number(payload, 'scored_count'),
            scoreTotal: Json.number(payload, 'score_total'),
            completionRate: Json.number(payload, 'profile_completion'),
        };
    }

    // 维度字典 -> 有序数组：字典键序即后端定义的维度顺序
    private static toDimensions(node: Record<string, Object> | null): LearningProfileDimension[] {
        const result: LearningProfileDimension[] = [];

        if (node === null) {
            return result;
        }

        const keys: string[] = Object.keys(node);

        for (let i: number = 0; i < keys.length; i++) {
            const item: Record<string, Object> | null = Json.object(node, keys[i]);

            if (item === null) {
                continue;
            }

            result.push({
                key: keys[i],
                name: Json.string(item, 'name'),
                value: Json.string(item, 'value'),
                filled: Json.boolean(item, 'filled'),
            });
        }

        return result;
    }

    private static toScores(rows: Object[]): LearningScore[] {
        const result: LearningScore[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            if (!LearningHttp.isRecord(rows[i])) {
                continue;
            }

            const source: Record<string, Object> = rows[i] as Record<string, Object>;
            // score 未评估时为 null：用 hasScore 区分「0 分」与「未评估」
            const scoreValue: Object | null = Json.fieldOrNull(source, 'score');
            const hasScore: boolean = typeof scoreValue === 'number';

            result.push({
                key: Json.string(source, 'key'),
                name: Json.string(source, 'name'),
                evidence: Json.string(source, 'evidence'),
                hasScore: hasScore,
                score: hasScore ? (scoreValue as number) : 0,
            });
        }

        return result;
    }
}
