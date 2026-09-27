// Agent / cognition contracts stay separate from LearningQuestionApi's question bank.
import { LearningBody, LearningHttp, LearningIdentity } from './LearningHttp';
import { Json } from './JsonUtil';
import {
    AgentEnvelope, LearnTarget, ReviewAnswerDraft, TimelineEntry, ContextData,
    TodayData, OpenSessionData, PlanData, FlowStateData, FlowSubmitData,
    TaskData, ReviewSubmitData, MirrorOverviewData, MirrorFacet, VerdictData,
    ReportPayload, GraphPayload, AskAnswer, LearningMemoriesData, LearningMemoryUpdateData,
    LearningMemoryForgetData
} from './LearningAgentModels';

const AGENT_ROOT: string = '/api/agent/v1';
// Context answers wait for model generation; ordinary Agent operations keep the transport default.
const GENERATION_READ_TIMEOUT: number = 90000;

interface AgentPlanRequest { intent: string; available_minutes: number; }
interface AgentQuestionRequest {
    question: string;
    source: string;
    lecture_id?: string;
    book_id?: string;
    chapter_index?: number;
}
interface AgentDecisionRequest { decision_id: string; response: string; }
interface AgentAcceptRequest { target: LearnTarget; }
interface AgentFlowSubmitRequest { flow_id: string; answers: ReviewAnswerDraft[]; }
interface AgentReviewPlanRequest { lecture_id: string; book_id: string; chapter_index: number; limit: number; }
interface AgentReviewSubmitRequest {
    quiz_id: string;
    attempt_id: string;
    lecture_id: string;
    book_id: string;
    chapter_index: number;
    chapter_name: string;
    answers: ReviewAnswerDraft[];
}
interface AgentVerdictRequest {
    facet_id: string;
    verdict: string;
    concept_id: string;
    lecture_id: string;
    book_id: string;
}
interface AgentMemoryUpdateRequest { memory_id: string; text: string; }
interface AgentMemoryForgetRequest { memory_id: string; }

export class LearningAgentApi {
    private static body(result: LearningBody): Record<string, Object> {
        if (!result.ok || result.payload === null) {
            throw new Error(result.message.length > 0 ? result.message : '学习服务暂时不可用');
        }
        return result.payload;
    }

    private static envelope(result: LearningBody): AgentEnvelope {
        const raw: Record<string, Object> = LearningAgentApi.body(result);
        if (!Json.boolean(raw, 'success') || Json.object(raw, 'data') === null) {
            throw new Error('Agent 返回的数据不完整');
        }
        return raw as Object as AgentEnvelope;
    }

    private static ready(): void {
        if (!LearningHttp.configured || AppStorage.get<boolean>('nxSessionReady') !== true) {
            throw new Error('请先登录并启用学习服务');
        }
    }

    private static async get(path: string): Promise<AgentEnvelope> {
        return LearningAgentApi.envelope(await LearningAgentApi.content(AGENT_ROOT + path));
    }

    private static async content(path: string): Promise<LearningBody> {
        LearningAgentApi.ready();
        const owner: LearningIdentity | null = LearningHttp.captureIdentity();
        const result: LearningBody = await LearningHttp.getJson(path, owner);
        LearningAgentApi.ready();
        if (!LearningHttp.isCurrent(owner)) {
            throw new Error('账号或学习服务已切换，请重新打开');
        }
        return result;
    }

    private static async post(path: string, payload: Object, readTimeoutMs?: number): Promise<AgentEnvelope> {
        LearningAgentApi.ready();
        const owner: LearningIdentity | null = LearningHttp.captureIdentity();
        const result: LearningBody = await LearningHttp.postJson(AGENT_ROOT + path, payload, owner, readTimeoutMs);
        LearningAgentApi.ready();
        if (!LearningHttp.isCurrent(owner)) {
            throw new Error('账号或学习服务已切换，请重新打开');
        }
        if (result.status === 404 && (path === '/memories/update' || path === '/memories/forget')) {
            throw new Error('这条记忆已失效，请刷新列表后重试');
        }
        return LearningAgentApi.envelope(result);
    }

    static async getToday(): Promise<TodayData> {
        return (await LearningAgentApi.get('/today')).data as TodayData;
    }

    static async getEvents(): Promise<TimelineEntry[]> {
        const env: AgentEnvelope = await LearningAgentApi.get('/events?limit=120');
        return Json.array(env.data as Record<string, Object>, 'entries') as TimelineEntry[];
    }

    static async getContext(): Promise<ContextData> {
        return (await LearningAgentApi.get('/context')).data as ContextData;
    }

    static async openSession(): Promise<OpenSessionData> {
        const request: Record<string, string> = {};
        return (await LearningAgentApi.post('/open-session', request)).data as OpenSessionData;
    }

    static async plan(intent: string): Promise<PlanData> {
        const request: AgentPlanRequest = { intent: intent, available_minutes: 30 };
        return (await LearningAgentApi.post('/plan', request)).data as PlanData;
    }

    static async ask(question: string, target: LearnTarget | null): Promise<AskAnswer> {
        const payload: AgentQuestionRequest = { question: question, source: 'app' };
        if (target !== null) {
            payload.lecture_id = target.lecture_id;
            payload.book_id = target.book_id;
            payload.chapter_index = target.chapter_index;
        }
        return (await LearningAgentApi.post('/ask-in-context', payload, GENERATION_READ_TIMEOUT)).data as AskAnswer;
    }

    static respondDecision(decisionId: string, response: string): Promise<AgentEnvelope> {
        const request: AgentDecisionRequest = { decision_id: decisionId, response: response };
        return LearningAgentApi.post('/decision/respond', request);
    }

    static async acceptFlow(target: LearnTarget): Promise<FlowStateData> {
        const request: AgentAcceptRequest = { target: target };
        return (await LearningAgentApi.post('/flow/accept', request)).data as FlowStateData;
    }

    static async getFlow(flowId: string): Promise<FlowStateData> {
        return (await LearningAgentApi.get('/flow/state?flow_id=' + encodeURIComponent(flowId))).data as FlowStateData;
    }

    static async submitFlow(flowId: string, answers: ReviewAnswerDraft[]): Promise<FlowSubmitData> {
        const request: AgentFlowSubmitRequest = { flow_id: flowId, answers: answers };
        return (await LearningAgentApi.post('/flow/submit', request)).data as FlowSubmitData;
    }

    static async reviewPlan(target: LearnTarget): Promise<TaskData> {
        const request: AgentReviewPlanRequest = {
            lecture_id: target.lecture_id, book_id: target.book_id, chapter_index: target.chapter_index, limit: 3
        };
        return (await LearningAgentApi.post('/review-plan', request)).data as TaskData;
    }

    static async getTask(taskId: string): Promise<TaskData> {
        return (await LearningAgentApi.get('/tasks/' + encodeURIComponent(taskId))).data as TaskData;
    }

    static async submitReview(quizId: string, attemptId: string, target: LearnTarget,
        answers: ReviewAnswerDraft[]): Promise<ReviewSubmitData> {
        const request: AgentReviewSubmitRequest = {
            quiz_id: quizId, attempt_id: attemptId, lecture_id: target.lecture_id,
            book_id: target.book_id, chapter_index: target.chapter_index,
            chapter_name: target.chapter_name, answers: answers
        };
        return (await LearningAgentApi.post('/review/submit', request)).data as ReviewSubmitData;
    }

    static async cognition(): Promise<MirrorOverviewData> {
        return (await LearningAgentApi.get('/cognition/overview')).data as MirrorOverviewData;
    }

    static async getMemories(): Promise<LearningMemoriesData> {
        const result: LearningBody = await LearningAgentApi.content(AGENT_ROOT + '/memories');
        if (result.status === 404) {
            throw new Error('当前学习服务尚未支持记忆管理，请更新服务后再试');
        }
        return LearningAgentApi.envelope(result).data as LearningMemoriesData;
    }

    static async updateMemory(memoryId: string, text: string): Promise<LearningMemoryUpdateData> {
        const request: AgentMemoryUpdateRequest = { memory_id: memoryId, text: text };
        return (await LearningAgentApi.post('/memories/update', request)).data as LearningMemoryUpdateData;
    }

    static async forgetMemory(memoryId: string): Promise<LearningMemoryForgetData> {
        const request: AgentMemoryForgetRequest = { memory_id: memoryId };
        return (await LearningAgentApi.post('/memories/forget', request)).data as LearningMemoryForgetData;
    }

    static async verdict(facet: MirrorFacet, verdict: string): Promise<VerdictData> {
        const request: AgentVerdictRequest = {
            facet_id: facet.id, verdict: verdict, concept_id: facet.conceptId,
            lecture_id: facet.lectureId, book_id: facet.bookId
        };
        return (await LearningAgentApi.post('/cognition/verdict', request)).data as VerdictData;
    }

    static async getReport(target: LearnTarget): Promise<ReportPayload> {
        return LearningAgentApi.body(await LearningAgentApi.content('/api/frontend/learning/report?lecture_id=' +
            encodeURIComponent(target.lecture_id) + '&book_id=' + encodeURIComponent(target.book_id))) as Object as ReportPayload;
    }

    static async getGraph(target: LearnTarget): Promise<GraphPayload> {
        return LearningAgentApi.body(await LearningAgentApi.content('/api/frontend/knowledge-graph?lecture_id=' +
            encodeURIComponent(target.lecture_id) + '&book_id=' + encodeURIComponent(target.book_id))) as Object as GraphPayload;
    }
}

export function agentFailure(error: Object): string {
    const failure: Error = error as Error;
    return failure.message !== undefined && failure.message.length > 0 ? failure.message : '网络暂时不可用，请重试';
}

export const NO_AGENT_TARGET: LearnTarget = {
    lecture_id: '', lecture_title: '', book_id: '', book_title: '',
    chapter_index: 0, chapter_name: '', chapter_range: ''
};
