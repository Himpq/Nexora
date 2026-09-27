// 阅读器到 agent 的轻量事件桥，成功持久化后递增 tick。
import { LearningHttp, LearningIdentity } from './LearningHttp';

export type LearningBridgeEventType = 'reading_synced' | 'chapter_completed' | 'flow_reading_done';

export interface LearningBridgeEvent {
    type: LearningBridgeEventType;
    scope: string;
    lectureId: string;
    bookId: string;
    chapterIndex: number;
    flowId: string;
    tick: number;
    identityRevision: number;
}

export class LearningBridge {
    static readonly tickKey: string = 'nxLearningBridgeTick';
    private static readonly eventKey: string = 'nxLearningBridgeEvent';

    static latest(): LearningBridgeEvent | null {
        const event: LearningBridgeEvent | undefined = AppStorage.get<LearningBridgeEvent>(LearningBridge.eventKey);
        const owner: LearningIdentity | null = LearningHttp.captureIdentity();
        if (event === undefined || owner === null || event.scope !== owner.scope || event.identityRevision !== owner.revision) {
            return null;
        }
        return event;
    }

    static emit(type: LearningBridgeEventType, owner: LearningIdentity | null, lectureId: string = '',
        bookId: string = '', chapterIndex: number = -1, flowId: string = ''): void {
        if (owner === null || !LearningHttp.isCurrent(owner)) {
            return;
        }
        const previous: number | undefined = AppStorage.get<number>(LearningBridge.tickKey);
        const tick: number = Math.max(Date.now(), (previous !== undefined ? previous : 0) + 1);
        const event: LearningBridgeEvent = {
            type: type, scope: owner.scope, lectureId: lectureId, bookId: bookId,
            chapterIndex: chapterIndex, flowId: flowId, tick: tick, identityRevision: owner.revision
        };
        // 先写 payload，@Watch tick 的订阅者随后读取到的一定是同一次事件。
        AppStorage.setOrCreate(LearningBridge.eventKey, event);
        AppStorage.setOrCreate(LearningBridge.tickKey, tick);
    }
}
