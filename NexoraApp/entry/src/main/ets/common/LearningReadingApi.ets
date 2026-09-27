// 教材阅读事实、遥测与 agent 阅读流程；统一通过 LearningHttp 发送。
import common from '@ohos.app.ability.common';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Json } from './JsonUtil';
import { LearningBridge } from './LearningBridge';
import { LearningBody, LearningHttp, LearningIdentity } from './LearningHttp';
import {
    ReadingCheckpoint, nxCopyReadingCheckpoint, nxQueueReading, nxDurablePendingReading, nxAcknowledgeReading
} from './LearningReading';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraReadingApi';

export type LearningReadingSyncStatus = 'synced' | 'pending' | 'failed';

export interface LearningReadingSaveResult {
    saved: boolean;
    status: LearningReadingSyncStatus;
}

export interface LearningReadingActionResult {
    ok: boolean;
    message: string;
}

export interface LearningChapterCompleteResult {
    ok: boolean;
    message: string;
    alreadyCompleted: boolean;
}

export interface LearningReadingAnswer {
    ok: boolean;
    message: string;
    answer: string;
}

export interface LearningReadingTelemetryOptions {
    scroll?: number;
    selText?: string;
    focus?: string;
}

interface ReadingProgressBody {
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    chapter_name: string;
    chapter_range: string;
    coordinate_space: string;
    session_id: string;
    started_at_ms: number;
    observed_at_ms: number;
    sequence: number;
    active_duration_ms: number;
    read_ranges: number[][];
    paragraph_index: number;
    page_index: number;
}

interface ChapterCompleteBody {
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    chapter_name: string;
    chapter_range: string;
    coordinate_space: string;
}

interface AskInContextBody {
    question: string;
    source: string;
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    context_text: string;
}

interface ReadingDoneBody {
    flow_id: string;
    event: string;
}

interface ReadingTelemetryExtra {
    session_key: string;
    active_duration_ms: number;
    lecture_id: string;
}

interface ReadingTelemetryRow {
    stream: string;
    event: string;
    uid: string;
    bid: string;
    ci: number;
    si: number;
    scroll?: number;
    sel_text?: string;
    focus?: string;
    extra: ReadingTelemetryExtra;
}

interface ReadingTelemetryBody {
    user_id: string;
    events: ReadingTelemetryRow[];
}

interface ReadingDrainResult {
    status: LearningReadingSyncStatus;
    drained: boolean;
}

class ReadingDrainFlight {
    owner: LearningIdentity;
    dirty: boolean = false;
    promise: Promise<LearningReadingSyncStatus> = Promise.resolve('pending');

    constructor(owner: LearningIdentity) {
        this.owner = owner;
    }
}

export class LearningReadingApi {
    // 每个 scope 只存在一次发送任务；慢网络下多个心跳共享它，不追加重试长队。
    private static drains: Map<string, ReadingDrainFlight> = new Map<string, ReadingDrainFlight>();

    static async queueReadingProgress(context: common.UIAbilityContext, point: ReadingCheckpoint): Promise<LearningReadingSyncStatus> {
        const result: LearningReadingSaveResult = await LearningReadingApi.saveReadingProgress(context, point);
        return result.status;
    }

    // 显式完成先确认这份快照已落盘；历史坏记录同步失败不能冒充本次保存失败。
    static async saveReadingProgress(context: common.UIAbilityContext, point: ReadingCheckpoint): Promise<LearningReadingSaveResult> {
        const queued: ReadingCheckpoint = nxCopyReadingCheckpoint(point);
        const owner: LearningIdentity | null = queued.owner;
        if (owner === null) {
            return { saved: false, status: 'failed' };
        }
        try {
            await nxQueueReading(context, owner.scope, queued);
        } catch {
            hilog.error(DOMAIN, TAG, 'reading checkpoint could not be saved');
            LearningReadingApi.setStatus(owner, 'failed');
            return { saved: false, status: 'failed' };
        }
        if (!LearningHttp.isCurrent(owner)) {
            return { saved: true, status: 'pending' };
        }
        const status: LearningReadingSyncStatus = await LearningReadingApi.scheduleDrain(context, owner);
        LearningReadingApi.setStatus(owner, status);
        return { saved: true, status: status };
    }

    static async flushReadingProgress(context: common.UIAbilityContext): Promise<boolean> {
        const owner: LearningIdentity | null = LearningHttp.captureIdentity();
        if (owner === null) {
            return false;
        }
        const status: LearningReadingSyncStatus = await LearningReadingApi.scheduleDrain(context, owner);
        LearningReadingApi.setStatus(owner, status);
        return status === 'synced';
    }

    private static scheduleDrain(context: common.UIAbilityContext,
        owner: LearningIdentity): Promise<LearningReadingSyncStatus> {
        const prior: ReadingDrainFlight | undefined = LearningReadingApi.drains.get(owner.scope);
        if (prior !== undefined) {
            if (prior.owner.revision !== owner.revision) {
                // A→B→A：旧代次响应可 ACK 原快照，新登录补发须使用新的身份快照。
                return LearningReadingApi.resumeDrain(context, owner, prior);
            }
            prior.dirty = true;
            return prior.promise;
        }
        const flight: ReadingDrainFlight = new ReadingDrainFlight(owner);
        LearningReadingApi.drains.set(owner.scope, flight);
        flight.promise = LearningReadingApi.runDrain(context, flight);
        return flight.promise;
    }

    private static async resumeDrain(context: common.UIAbilityContext, owner: LearningIdentity,
        prior: ReadingDrainFlight): Promise<LearningReadingSyncStatus> {
        await prior.promise;
        return LearningHttp.isCurrent(owner) ? LearningReadingApi.scheduleDrain(context, owner) : 'pending';
    }

    private static async runDrain(context: common.UIAbilityContext,
        flight: ReadingDrainFlight): Promise<LearningReadingSyncStatus> {
        let failed: boolean = false;
        try {
            while (true) {
                flight.dirty = false;
                const result: ReadingDrainResult = await LearningReadingApi.drainReadingProgress(context, flight.owner);
                failed = failed || result.status === 'failed';
                // 只在已排空时处理 lost-wakeup 竞态；网络或存储失败一轮即停，等下次触发。
                if (!result.drained || !flight.dirty || !LearningHttp.isCurrent(flight.owner)) {
                    return failed ? 'failed' : result.status;
                }
            }
        } finally {
            if (LearningReadingApi.drains.get(flight.owner.scope) === flight) {
                LearningReadingApi.drains.delete(flight.owner.scope);
            }
        }
    }

    private static async drainReadingProgress(context: common.UIAbilityContext,
        owner: LearningIdentity): Promise<ReadingDrainResult> {
        let discarded: boolean = false;
        let syncedPoint: ReadingCheckpoint | null = null;
        try {
            while (LearningHttp.isCurrent(owner)) {
                const pending: ReadingCheckpoint[] = await nxDurablePendingReading(context, owner.scope);
                if (!LearningHttp.isCurrent(owner)) {
                    return { status: 'pending', drained: false };
                }
                if (pending.length === 0) {
                    return { status: discarded ? 'failed' : 'synced', drained: true };
                }
                const point: ReadingCheckpoint = pending[0];
                let body: LearningBody;
                try {
                    body = await LearningHttp.postJson('/api/frontend/learning/reading-progress',
                        LearningReadingApi.progressBody(point), owner);
                } catch {
                    // 请求异常时记录已安全落盘，只是待同步；不冒充本地保存失败。
                    return { status: discarded ? 'failed' : 'pending', drained: false };
                }
                if (LearningReadingApi.succeeded(body)) {
                    // 即使等待响应期间切了账号，ACK 也只能删除原 scope 的原日原序号。
                    await nxAcknowledgeReading(context, owner.scope, point);
                    syncedPoint = point;
                    continue;
                }
                if (body.status === 400 || body.status === 404 || body.status === 409) {
                    // ProgressConflict(409) 只表示 session_id 被复用到其他章节或开始时间。
                    // 重新发同一快照不能修复；重新造 id 又可能重复记时，所以移出并日志。
                    await nxAcknowledgeReading(context, owner.scope, point);
                    discarded = true;
                    hilog.warn(DOMAIN, TAG, 'discarded reading checkpoint status=%{public}d chapter=%{public}d reason=%{public}s',
                        body.status, point.chapter_index, body.message);
                    continue;
                }
                // 0/5xx 以及鉴权、限流等可能恢复的失败留在 outbox，下次心跳或登录补发。
                return { status: discarded ? 'failed' : 'pending', drained: false };
            }
            return { status: 'pending', drained: false };
        } catch {
            hilog.error(DOMAIN, TAG, 'reading drain failed; remaining checkpoints retained');
            return { status: 'failed', drained: false };
        } finally {
            if (syncedPoint !== null) {
                LearningBridge.emit('reading_synced', owner, syncedPoint.lecture_id, syncedPoint.book_id, syncedPoint.chapter_index);
            }
        }
    }

    static async postChapterComplete(point: ReadingCheckpoint): Promise<LearningChapterCompleteResult> {
        const owner: LearningIdentity | null = point.owner;
        if (!LearningHttp.isCurrent(owner)) {
            return { ok: false, message: '学习身份已变更，请重新打开章节', alreadyCompleted: false };
        }
        const request: ChapterCompleteBody = {
            lecture_id: point.lecture_id, book_id: point.book_id, chapter_index: point.chapter_index,
            chapter_name: point.chapter_name, chapter_range: point.chapter_range, coordinate_space: 'plain'
        };
        try {
            const body: LearningBody = await LearningHttp.postJson('/api/frontend/learning/chapter-complete', request, owner);
            if (!LearningReadingApi.succeeded(body) || body.payload === null) {
                return { ok: false, message: body.message.length > 0 ? body.message : '这一章暂时未能标记为读完', alreadyCompleted: false };
            }
            LearningBridge.emit('chapter_completed', owner, request.lecture_id, request.book_id, request.chapter_index);
            return { ok: true, message: '', alreadyCompleted: Json.boolean(body.payload, 'already_completed') };
        } catch {
            return { ok: false, message: '这一章暂时未能标记为读完，请稍后重试', alreadyCompleted: false };
        }
    }

    static async postTelemetry(point: ReadingCheckpoint, event: string,
        options: LearningReadingTelemetryOptions = {}): Promise<boolean> {
        const owner: LearningIdentity | null = point.owner;
        if (owner === null || !LearningHttp.isCurrent(owner)) {
            return false;
        }
        const extra: ReadingTelemetryExtra = {
            session_key: point.session_id, active_duration_ms: point.active_duration_ms, lecture_id: point.lecture_id
        };
        const row: ReadingTelemetryRow = {
            stream: 'reading', event: event, uid: owner.username, bid: point.book_id,
            ci: point.chapter_index, si: point.paragraph_index, extra: extra
        };
        if (options.scroll !== undefined && Number.isFinite(options.scroll)) {
            row.scroll = Math.max(0, Math.min(1, options.scroll));
        }
        if (options.selText !== undefined) {
            row.sel_text = options.selText;
        }
        if (options.focus !== undefined) {
            row.focus = options.focus;
        }
        const request: ReadingTelemetryBody = { user_id: owner.username, events: [row] };
        try {
            const body: LearningBody = await LearningHttp.postJson('/api/telemetry/ingest', request, owner);
            return LearningReadingApi.succeeded(body);
        } catch {
            // 遥测只是行为线索，失败直接丢弃，不污染阅读事实 outbox。
            return false;
        }
    }

    static async askInContext(point: ReadingCheckpoint, question: string, contextText: string): Promise<LearningReadingAnswer> {
        const owner: LearningIdentity | null = point.owner;
        if (!LearningHttp.isCurrent(owner)) {
            return { ok: false, message: '学习身份已变更，请重新打开章节', answer: '' };
        }
        if (question.trim().length === 0) {
            return { ok: false, message: '请输入想问的问题', answer: '' };
        }
        const request: AskInContextBody = {
            question: question.trim(), source: 'app', lecture_id: point.lecture_id,
            book_id: point.book_id, chapter_index: point.chapter_index, context_text: contextText
        };
        try {
            const body: LearningBody = await LearningHttp.postJson('/api/agent/v1/ask-in-context', request, owner);
            if (!LearningHttp.isCurrent(owner)) {
                return { ok: false, message: '学习身份已变更', answer: '' };
            }
            if (!LearningReadingApi.succeeded(body) || body.payload === null) {
                return { ok: false, message: body.message.length > 0 ? body.message : '暂时未能得到回答', answer: '' };
            }
            const data: Record<string, Object> | null = Json.object(body.payload, 'data');
            const answer: string = data === null ? '' : Json.string(data, 'answer');
            return answer.length > 0 ? { ok: true, message: '', answer: answer }
                : { ok: false, message: '回答为空，请稍后重试', answer: '' };
        } catch {
            return { ok: false, message: '暂时未能得到回答，请稍后重试', answer: '' };
        }
    }

    static async postReadingDone(flowId: string,
        owner: LearningIdentity | null = LearningHttp.captureIdentity()): Promise<LearningReadingActionResult> {
        if (!LearningHttp.isCurrent(owner)) {
            return { ok: false, message: '学习身份已变更，复习流程未推进' };
        }
        if (flowId.trim().length === 0) {
            return { ok: false, message: '缺少复习流程' };
        }
        const request: ReadingDoneBody = { flow_id: flowId, event: 'reading_done' };
        try {
            const body: LearningBody = await LearningHttp.postJson('/api/agent/v1/flow/event', request, owner);
            if (!LearningReadingApi.succeeded(body)) {
                return { ok: false, message: body.message.length > 0 ? body.message : '复习流程暂时未能推进' };
            }
            LearningBridge.emit('flow_reading_done', owner, '', '', -1, flowId);
            return { ok: true, message: '' };
        } catch {
            return { ok: false, message: '复习流程暂时未能推进，请稍后重试' };
        }
    }

    private static succeeded(body: LearningBody): boolean {
        return body.ok && body.payload !== null && Json.boolean(body.payload, 'success');
    }

    private static setStatus(owner: LearningIdentity, status: LearningReadingSyncStatus): void {
        if (LearningHttp.isCurrent(owner)) {
            AppStorage.setOrCreate('nxReadingSyncStatus', status);
        }
    }

    private static progressBody(point: ReadingCheckpoint): ReadingProgressBody {
        return {
            lecture_id: point.lecture_id, book_id: point.book_id, chapter_index: point.chapter_index,
            chapter_name: point.chapter_name, chapter_range: point.chapter_range, coordinate_space: 'plain',
            session_id: point.session_id, started_at_ms: point.started_at_ms, observed_at_ms: point.observed_at_ms,
            sequence: point.sequence, active_duration_ms: point.active_duration_ms, read_ranges: point.read_ranges,
            paragraph_index: point.paragraph_index, page_index: point.page_index
        };
    }
}
