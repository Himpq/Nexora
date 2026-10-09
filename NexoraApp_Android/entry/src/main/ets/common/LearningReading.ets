// 阅读事实：每章一个累计会话，持久化 outbox 按服务和账号隔离。
import common from '@ohos.app.ability.common';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Json } from './JsonUtil';
import { LearningHttp, LearningIdentity } from './LearningHttp';
import { PreferencesUtil } from './PreferencesUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraReading';
const OUTBOX_PREFIX: string = 'nx_reading_outbox_';

/** Python plain 坐标按 Unicode 码点计数，不能使用 UTF-16 的 length。 */
export function nxCodePointLength(text: string): number {
    let count: number = 0;
    for (let index: number = 0; index < text.length; index++) {
        const code: number = text.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
            const next: number = text.charCodeAt(index + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) {
                index++;
            }
        }
        count++;
    }
    return count;
}

export function nxReadingScope(owner: LearningIdentity | null = LearningHttp.captureIdentity()): string {
    return owner === null ? '' : owner.scope;
}

export class ReadingCheckpoint {
    lecture_id: string = '';
    book_id: string = '';
    chapter_index: number = 0;
    chapter_name: string = '';
    chapter_range: string = '';
    coordinate_space: string = 'plain';
    session_id: string = '';
    started_at_ms: number = 0;
    observed_at_ms: number = 0;
    sequence: number = 0;
    active_duration_ms: number = 0;
    read_ranges: number[][] = [];
    paragraph_index: number = 0;
    page_index: number = 0;
    // 本地元数据不会放进 HTTP body。创建时固定归属，退出登录后也不能改绑。
    owner: LearningIdentity | null;
    day_key: string = '';

    constructor(owner: LearningIdentity | null = LearningHttp.captureIdentity()) {
        this.owner = owner;
    }
}

function copyRanges(ranges: number[][]): number[][] {
    const result: number[][] = [];
    for (const range of ranges) {
        if (range.length === 2 && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) &&
            range[0] >= 0 && range[1] > range[0]) {
            result.push([range[0], range[1]]);
        }
    }
    return result;
}

function mergeRanges(left: number[][], right: number[][]): number[][] {
    const ranges: number[][] = copyRanges(left).concat(copyRanges(right));
    ranges.sort((a: number[], b: number[]): number => a[0] - b[0]);
    const merged: number[][] = [];
    for (const range of ranges) {
        if (merged.length === 0 || range[0] > merged[merged.length - 1][1]) {
            merged.push(range);
        } else {
            const last: number[] = merged[merged.length - 1];
            last[1] = Math.max(last[1], range[1]);
        }
    }
    return merged;
}

export function nxCopyReadingCheckpoint(source: ReadingCheckpoint): ReadingCheckpoint {
    const point: ReadingCheckpoint = new ReadingCheckpoint(source.owner);
    point.lecture_id = source.lecture_id;
    point.book_id = source.book_id;
    point.chapter_index = source.chapter_index;
    point.chapter_name = source.chapter_name;
    point.chapter_range = source.chapter_range;
    point.coordinate_space = source.coordinate_space;
    point.session_id = source.session_id;
    point.started_at_ms = source.started_at_ms;
    point.observed_at_ms = source.observed_at_ms;
    point.sequence = source.sequence;
    point.active_duration_ms = source.active_duration_ms;
    point.read_ranges = copyRanges(source.read_ranges);
    point.paragraph_index = source.paragraph_index;
    point.page_index = source.page_index;
    point.day_key = source.day_key;
    return point;
}

/** 前台计时与覆盖独立；某页连续可记录 2 秒才加入其范围。 */
export class ReadingSession {
    private point: ReadingCheckpoint;
    private active: boolean = false;
    private accountedAt: number = 0;
    private pageDwellMs: number = 0;
    private visibleRanges: number[][] = [];

    constructor(point: ReadingCheckpoint) {
        this.point = point;
        this.accountedAt = point.started_at_ms;
    }

    private settle(now: number): void {
        const elapsed: number = Math.max(0, now - this.accountedAt);
        if (this.active && this.visibleRanges.length > 0) {
            this.point.active_duration_ms += elapsed;
            this.pageDwellMs += elapsed;
            if (this.pageDwellMs >= 2000) {
                this.point.read_ranges = mergeRanges(this.point.read_ranges, this.visibleRanges);
            }
        }
        // 时钟短暂倒退时不能把同一段时间重复计入。
        this.accountedAt = Math.max(this.accountedAt, now);
    }

    enterPage(ranges: number[][], active: boolean, now: number): void {
        this.settle(now);
        this.visibleRanges = copyRanges(ranges);
        this.pageDwellMs = 0;
        this.active = active;
    }

    setActive(active: boolean, now: number): void {
        this.settle(now);
        this.active = active;
        if (!active) {
            this.pageDwellMs = 0;
        }
    }

    snapshot(paragraphIndex: number, pageIndex: number, now: number): ReadingCheckpoint {
        this.settle(now);
        this.point.sequence++;
        this.point.paragraph_index = Math.max(0, paragraphIndex);
        this.point.page_index = Math.max(0, pageIndex);
        this.point.observed_at_ms = Math.max(this.accountedAt, now);
        this.point.day_key = readingDay(this.point.observed_at_ms);
        return nxCopyReadingCheckpoint(this.point);
    }
}

function readingDay(timestamp: number): string {
    const date: Date = new Date(timestamp);
    // 后端用 time.localtime 聚合；尚无服务时区契约，因此同时保留设备自然日
    // 和 UTC 的边界。不会为了合并同一会话而抹掉前一日的累计快照。
    return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + '_' +
        Math.floor(timestamp / 86400000);
}

function sameCheckpointDay(left: ReadingCheckpoint, right: ReadingCheckpoint): boolean {
    return left.session_id === right.session_id && left.day_key === right.day_key;
}

let readingWrite: Promise<void> = Promise.resolve();

function withReadingWrite(action: () => Promise<void>): Promise<void> {
    const pending: Promise<void> = readingWrite.then(action);
    readingWrite = pending.catch((): void => {
        // 解除串行锁，异常仍从 pending 返回给原调用方。
    });
    return pending;
}

function isNonnegativeInteger(value: Object | null): boolean {
    return typeof value === 'number' && Number.isSafeInteger(value as number) && (value as number) >= 0;
}

function parseCheckpoint(raw: Object, scope: string): ReadingCheckpoint | null {
    if (!LearningHttp.isRecord(raw)) {
        return null;
    }
    const row: Record<string, Object> = raw as Record<string, Object>;
    const identity: Record<string, Object> | null = Json.object(row, 'owner');
    if (identity === null) {
        return null;
    }
    const username: string = Json.string(identity, 'username');
    const serviceBase: string = Json.string(identity, 'serviceBase');
    if (username.length === 0 || serviceBase.length === 0 || Json.string(identity, 'scope') !== scope ||
        encodeURIComponent(serviceBase) + '|' + encodeURIComponent(username) !== scope) {
        return null;
    }
    const owner: LearningIdentity = {
        username: username, serviceBase: serviceBase, scope: scope, revision: Json.number(identity, 'revision')
    };
    const numericKeys: string[] = ['chapter_index', 'started_at_ms', 'observed_at_ms', 'sequence',
        'active_duration_ms', 'paragraph_index', 'page_index'];
    for (const key of numericKeys) {
        if (!isNonnegativeInteger(Json.fieldOrNull(row, key))) {
            return null;
        }
    }
    const point: ReadingCheckpoint = new ReadingCheckpoint(owner);
    point.lecture_id = Json.string(row, 'lecture_id');
    point.book_id = Json.string(row, 'book_id');
    point.chapter_index = Json.number(row, 'chapter_index');
    point.chapter_name = Json.string(row, 'chapter_name');
    point.chapter_range = Json.string(row, 'chapter_range');
    point.coordinate_space = Json.string(row, 'coordinate_space');
    point.session_id = Json.string(row, 'session_id');
    point.started_at_ms = Json.number(row, 'started_at_ms');
    point.observed_at_ms = Json.number(row, 'observed_at_ms');
    point.sequence = Json.number(row, 'sequence');
    point.active_duration_ms = Json.number(row, 'active_duration_ms');
    point.paragraph_index = Json.number(row, 'paragraph_index');
    point.page_index = Json.number(row, 'page_index');
    point.day_key = Json.string(row, 'day_key');
    if (point.day_key.length === 0) {
        point.day_key = readingDay(point.observed_at_ms);
    }
    if (point.lecture_id.length === 0 || point.book_id.length === 0 || point.session_id.length === 0 ||
        point.coordinate_space !== 'plain' || point.started_at_ms > point.observed_at_ms ||
        (point.started_at_ms > 0 && point.active_duration_ms > point.observed_at_ms - point.started_at_ms + 1000)) {
        return null;
    }
    const ranges: Object | null = Json.fieldOrNull(row, 'read_ranges');
    if (!Array.isArray(ranges)) {
        return null;
    }
    const pairs: Object[] = ranges as Object[];
    if (pairs.length > 4096 || (pairs.length > 0 && point.active_duration_ms <= 0)) {
        return null;
    }
    for (const pair of pairs) {
        if (!Array.isArray(pair)) {
            return null;
        }
        const values: Object[] = pair as Object[];
        if (values.length !== 2 || !isNonnegativeInteger(values[0]) || !isNonnegativeInteger(values[1]) ||
            (values[1] as number) <= (values[0] as number)) {
            return null;
        }
        point.read_ranges.push([values[0] as number, values[1] as number]);
    }
    return point;
}

async function readPending(context: common.UIAbilityContext, scope: string): Promise<ReadingCheckpoint[]> {
    const raw: string = await PreferencesUtil.loadString(context, OUTBOX_PREFIX + scope, '');
    if (raw.length === 0) {
        return [];
    }
    const rows: Object[] | null = Json.parseArray(raw);
    const points: ReadingCheckpoint[] = [];
    let invalid: boolean = rows === null;
    if (rows !== null) {
        for (const row of rows) {
            const point: ReadingCheckpoint | null = parseCheckpoint(row, scope);
            if (point !== null) {
                points.push(point);
            } else {
                invalid = true;
            }
        }
    }
    if (invalid) {
        // 先留原件再隔离坏项；磁盘失败时不能覆盖原队列，也不发送未落盘内容。
        await PreferencesUtil.saveString(context, OUTBOX_PREFIX + 'invalid_' + scope, raw);
        await PreferencesUtil.saveString(context, OUTBOX_PREFIX + scope, JSON.stringify(points));
        hilog.warn(DOMAIN, TAG, 'invalid local reading records quarantined');
    }
    return points;
}

export async function nxPendingReading(context: common.UIAbilityContext, scope: string): Promise<ReadingCheckpoint[]> {
    let pending: ReadingCheckpoint[] = [];
    await withReadingWrite(async (): Promise<void> => {
        pending = await readPending(context, scope);
    });
    return pending;
}

export function nxQueueReading(context: common.UIAbilityContext, scope: string, point: ReadingCheckpoint): Promise<void> {
    // 在进入异步串行队列之前复制，调用者随后翻页不能修改待落盘数据。
    const queued: ReadingCheckpoint | null = parseCheckpoint(point, scope);
    if (scope.length === 0 || queued === null) {
        return Promise.reject(new Error('阅读记录缺少有效身份或快照字段'));
    }
    return withReadingWrite(async (): Promise<void> => {
        const pending: ReadingCheckpoint[] = await readPending(context, scope);
        const next: ReadingCheckpoint[] = [];
        let newest: ReadingCheckpoint = queued;
        for (const previous of pending) {
            if (sameCheckpointDay(previous, queued)) {
                if (previous.sequence > newest.sequence) {
                    newest = previous;
                }
            } else {
                next.push(previous);
            }
        }
        next.push(newest);
        await PreferencesUtil.saveString(context, OUTBOX_PREFIX + scope, JSON.stringify(next));
    });
}

export function nxAcknowledgeReading(context: common.UIAbilityContext, scope: string,
    point: ReadingCheckpoint): Promise<void> {
    return withReadingWrite(async (): Promise<void> => {
        const next: ReadingCheckpoint[] = [];
        const pending: ReadingCheckpoint[] = await readPending(context, scope);
        for (const previous of pending) {
            if (!sameCheckpointDay(previous, point) || previous.sequence > point.sequence) {
                next.push(previous);
            }
        }
        await PreferencesUtil.saveString(context, OUTBOX_PREFIX + scope, JSON.stringify(next));
    });
}

/** 若上次 flush 失败可能只更新了 Preferences 内存；发请求前再次确保已落盘。 */
export async function nxDurablePendingReading(context: common.UIAbilityContext,
    scope: string): Promise<ReadingCheckpoint[]> {
    let pending: ReadingCheckpoint[] = [];
    await withReadingWrite(async (): Promise<void> => {
        pending = await readPending(context, scope);
        pending.sort((left: ReadingCheckpoint, right: ReadingCheckpoint): number => {
            if (left.session_id === right.session_id) {
                return left.sequence - right.sequence;
            }
            return left.session_id < right.session_id ? -1 : 1;
        });
        await PreferencesUtil.saveString(context, OUTBOX_PREFIX + scope, JSON.stringify(pending));
    });
    return pending;
}
