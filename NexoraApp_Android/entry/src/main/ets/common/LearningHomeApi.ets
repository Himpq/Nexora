// LearningHomeApi.ets - NexoraLearning 学习首页域接口
// 首页不再是一张课程表：概览统计、当前焦点课程、学习通知、课程级学习报告都来自这里，
// 与题库 / 资源域各自独立，互不耦合。

import { Json } from './JsonUtil';
import { LearningBody, LearningHttp } from './LearningHttp';
import { LearningApi } from './LearningApi';

// 已选课程快照（dashboard.lectures[].lecture）
export interface LearningDashboardLecture {
    id: string;
    title: string;
    description: string;
    category: string;
    status: string;
    coverPath: string;
    bookCount: number;
    progress: number;
    currentChapter: string;
    nextChapter: string;
    studyHours: number;
    lastActiveTs: number;
}

export interface LearningDashboard {
    lectures: LearningDashboardLecture[];
    totalLectures: number;
    totalBooks: number;
    totalStudyHours: number;
}

// 首页通知（chapter_complete / learning_profile 等事件流）
export interface LearningNotice {
    id: string;
    title: string;
    content: string;
    date: number;
    source: string;
    lectureId: string;
}

// 学习报告的建议 / 薄弱环节条目
export interface LearningReportItem {
    title: string;
    detail: string;
}

// 课程级学习报告（/api/frontend/learning/report）
export interface LearningReport {
    lectureId: string;
    lectureTitle: string;
    progressPercent: number;
    completedChapters: number;
    totalChapters: number;
    completedSessions: number;
    totalSessions: number;
    studyHours: number;
    submittedQuestions: number;
    correctQuestions: number;
    hasAccuracy: boolean;
    accuracy: number;
    profileCompletionRate: number;
    weaknesses: LearningReportItem[];
    recommendations: LearningReportItem[];
}

export interface LearningDashboardResult {
    success: boolean;
    message: string;
    dashboard: LearningDashboard;
}

export interface LearningNoticeResult {
    success: boolean;
    message: string;
    notices: LearningNotice[];
}

export interface LearningReportResult {
    success: boolean;
    message: string;
    report: LearningReport | null;
}

// 空概览：每次调用返回新对象，避免多个 @State 共享同一实例
export function emptyDashboard(): LearningDashboard {
    return {
        lectures: [],
        totalLectures: 0,
        totalBooks: 0,
        totalStudyHours: 0,
    };
}

// 空报告：每次调用返回新对象，避免多个 @State 共享同一实例
export function emptyReport(): LearningReport {
    return {
        lectureId: '',
        lectureTitle: '',
        progressPercent: 0,
        completedChapters: 0,
        totalChapters: 0,
        completedSessions: 0,
        totalSessions: 0,
        studyHours: 0,
        submittedQuestions: 0,
        correctQuestions: 0,
        hasAccuracy: false,
        accuracy: 0,
        profileCompletionRate: 0,
        weaknesses: [],
        recommendations: [],
    };
}

export class LearningHomeApi {
    static readonly shared: LearningHomeApi = new LearningHomeApi();

    // 首页概览：GET /api/frontend/dashboard（仅返回用户已选课程，含进度与学习时长）
    async getDashboard(): Promise<LearningDashboardResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/dashboard');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, dashboard: emptyDashboard() };
        }

        return { success: true, message: '', dashboard: LearningHomeApi.toDashboard(body.payload) };
    }

    // 首页通知：GET /api/frontend/notifications
    async getNotices(limit: number): Promise<LearningNoticeResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/frontend/notifications?limit=' + limit);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, notices: [] };
        }

        const rows: Object[] = Json.array(body.payload, 'items');
        const notices: LearningNotice[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningNotice | null = LearningHomeApi.toNotice(rows[i]);

            if (item !== null) {
                notices.push(item);
            }
        }

        return { success: true, message: '', notices: notices };
    }

    // 课程学习报告：GET /api/frontend/learning/report?lecture_id=
    async getReport(lectureId: string): Promise<LearningReportResult> {
        const body: LearningBody = await LearningHttp.getJson(
            '/api/frontend/learning/report?lecture_id=' + encodeURIComponent(lectureId));

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, report: null };
        }

        return { success: true, message: '', report: LearningHomeApi.toReport(body.payload) };
    }

    // ---------- 字段映射 ----------
    private static toDashboard(payload: Record<string, Object>): LearningDashboard {
        const rows: Object[] = Json.array(payload, 'lectures');
        const lectures: LearningDashboardLecture[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningDashboardLecture | null = LearningHomeApi.toDashboardLecture(rows[i]);

            if (item !== null) {
                lectures.push(item);
            }
        }

        return {
            lectures: lectures,
            totalLectures: Json.number(payload, 'total_lectures'),
            totalBooks: Json.number(payload, 'total_books'),
            totalStudyHours: Json.number(payload, 'total_study_hours'),
        };
    }

    private static toDashboardLecture(raw: Object | null): LearningDashboardLecture | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const row: Record<string, Object> = raw as Record<string, Object>;
        const lecture: Record<string, Object> | null = Json.object(row, 'lecture');

        if (lecture === null) {
            return null;
        }

        const id: string = Json.string(lecture, 'id');

        if (id.length === 0) {
            return null;
        }

        return {
            id: id,
            title: Json.string(lecture, 'title'),
            description: Json.string(lecture, 'description'),
            category: Json.string(lecture, 'category'),
            status: Json.string(lecture, 'status'),
            coverPath: LearningApi.shared.assetUrl(Json.string(lecture, 'cover_path')),
            bookCount: Json.number(row, 'books_count'),
            progress: Json.number(lecture, 'progress'),
            currentChapter: Json.string(lecture, 'current_chapter'),
            nextChapter: Json.string(lecture, 'next_chapter'),
            studyHours: Json.number(lecture, 'study_hours'),
            lastActiveTs: Json.number(lecture, 'last_active_ts'),
        };
    }

    private static toNotice(raw: Object | null): LearningNotice | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const id: string = Json.string(source, 'notification_id');

        if (id.length === 0) {
            return null;
        }

        return {
            id: id,
            title: Json.string(source, 'title'),
            content: Json.string(source, 'content'),
            date: Json.number(source, 'date'),
            source: Json.string(source, 'source'),
            lectureId: Json.string(source, 'lecture_id'),
        };
    }

    private static toReport(payload: Record<string, Object>): LearningReport {
        const summary: Record<string, Object> | null = Json.object(payload, 'summary');
        // accuracy 在无作答记录时后端下发 null：用 hasAccuracy 显式表达「尚未产生正确率」，不伪造 0%
        const accuracy: Object | null = summary === null ? null : Json.fieldOrNull(summary, 'accuracy');
        const hasAccuracy: boolean = typeof accuracy === 'number';

        return {
            lectureId: Json.string(payload, 'lecture_id'),
            lectureTitle: Json.string(payload, 'lecture_title'),
            progressPercent: summary === null ? 0 : Json.number(summary, 'progress_percent'),
            completedChapters: summary === null ? 0 : Json.number(summary, 'completed_chapters'),
            totalChapters: summary === null ? 0 : Json.number(summary, 'total_chapters'),
            completedSessions: summary === null ? 0 : Json.number(summary, 'completed_sessions'),
            totalSessions: summary === null ? 0 : Json.number(summary, 'total_sessions'),
            studyHours: summary === null ? 0 : Json.number(summary, 'study_hours'),
            submittedQuestions: summary === null ? 0 : Json.number(summary, 'submitted_questions'),
            correctQuestions: summary === null ? 0 : Json.number(summary, 'correct_questions'),
            hasAccuracy: hasAccuracy,
            accuracy: hasAccuracy ? (accuracy as number) : 0,
            profileCompletionRate: summary === null ? 0 : Json.number(summary, 'profile_completion_rate'),
            weaknesses: LearningHomeApi.toReportItems(Json.array(payload, 'weaknesses')),
            recommendations: LearningHomeApi.toReportItems(Json.array(payload, 'recommendations')),
        };
    }

    private static toReportItems(rows: Object[]): LearningReportItem[] {
        const items: LearningReportItem[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            if (!LearningHttp.isRecord(rows[i])) {
                continue;
            }

            const source: Record<string, Object> = rows[i] as Record<string, Object>;
            const title: string = Json.string(source, 'title');

            if (title.length === 0) {
                continue;
            }

            items.push({ title: title, detail: Json.string(source, 'detail') });
        }

        return items;
    }
}
