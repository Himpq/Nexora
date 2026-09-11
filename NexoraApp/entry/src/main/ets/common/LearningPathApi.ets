// LearningPathApi.ets - 个性化学习路线与课程大纲
// 课程里有两层「该学什么」，来源不同、生成时机也不同：
//   outline —— 课程大纲。按课程生成并固化，每门课都有；sections 给出学习目标、关键概念、
//              难度与预计时长，是个性化路线赖以排序的原始素材。
//   path    —— 个性化学习路线。按「用户 + 课程」生成，把大纲小节落到具体教材章节并排出先后，
//              附带 AI 的学习建议（advice）与每章取舍理由（reason）；未生成时后端返回 cached=false。
// 两者都不在本地推算：没有就如实显示空态，绝不用本地顺序冒充个性化排序。

import { Json } from './JsonUtil';
import { LearningBody, LearningHttp } from './LearningHttp';

// 大纲小节对应的教材出处
export interface LearningOutlineSource {
    bookId: string;
    bookTitle: string;
    chapterName: string;
    chapterSummary: string;
}

// 大纲小节：课程该学什么的权威描述
export interface LearningOutlineSection {
    id: string;
    title: string;
    summary: string;
    objectives: string[];
    keyConcepts: string[];
    difficulty: string;
    estimatedMinutes: number;
    sources: LearningOutlineSource[];
}

export interface LearningOutline {
    courseTitle: string;
    lectureTitle: string;
    sections: LearningOutlineSection[];
}

// 学习路线章节：一个大纲小节落到某本教材的某个章节
export interface LearningPathChapter {
    index: number;
    name: string;
    bookId: string;
    bookTitle: string;
    chapterSummary: string;
    outlineSectionId: string;
    status: string;
    progression: string;
    reason: string;
    contentGenerated: boolean;
    contentGenerating: boolean;
    learningCompleted: boolean;
}

export interface LearningOutlineResult {
    success: boolean;
    message: string;
    outline: LearningOutline | null;
}

export interface LearningPathResult {
    success: boolean;
    message: string;
    cached: boolean;
    advice: string;
    chapters: LearningPathChapter[];
}

// 个性化章节正文：content 是后端生成的 Markdown 学习素材
export interface PathChapterResult {
    success: boolean;
    message: string;
    cached: boolean;
    content: string;
}

// load-path 的请求体
interface PathQueryBody {
    lecture_id: string;
}

// load-chapter 的请求体
interface ChapterQueryBody {
    lecture_id: string;
    chapter_index: number;
}

export class LearningPathApi {
    static readonly shared: LearningPathApi = new LearningPathApi();

    // 课程大纲：GET /api/frontend/outline/{lectureId}；未生成时后端返回 404
    async getOutline(lectureId: string): Promise<LearningOutlineResult> {
        const body: LearningBody = await LearningHttp.getJson(
            '/api/frontend/outline/' + encodeURIComponent(lectureId));

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, outline: null };
        }

        const raw: Record<string, Object> | null = Json.object(body.payload, 'outline');

        if (raw === null) {
            return { success: false, message: '课程大纲尚未生成', outline: null };
        }

        return { success: true, message: '', outline: LearningPathApi.toOutline(raw) };
    }

    // 学习路线：POST /api/frontend/personalized-learning/load-path
    async getPath(lectureId: string): Promise<LearningPathResult> {
        const payload: PathQueryBody = { lecture_id: lectureId };
        const body: LearningBody = await LearningHttp.postJson(
            '/api/frontend/personalized-learning/load-path', payload);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, cached: false, advice: '', chapters: [] };
        }

        return {
            success: true,
            message: '',
            cached: Json.boolean(body.payload, 'cached'),
            advice: Json.string(body.payload, 'advice'),
            chapters: LearningPathApi.readChapters(Json.array(body.payload, 'chapters')),
        };
    }

    // 个性化章节正文：POST /api/frontend/personalized-learning/load-chapter
    // 这一章的学习素材由后端按用户画像与学习路线单独生成，未必已经存在。
    // cached=false 是「还没生成」这一正常状态，不是请求失败，调用方必须区别对待。
    async loadChapter(lectureId: string, chapterIndex: number): Promise<PathChapterResult> {
        const payload: ChapterQueryBody = {
            lecture_id: lectureId,
            chapter_index: chapterIndex,
        };
        const body: LearningBody = await LearningHttp.postJson(
            '/api/frontend/personalized-learning/load-chapter', payload);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, cached: false, content: '' };
        }

        return {
            success: true,
            message: '',
            cached: Json.boolean(body.payload, 'cached'),
            content: Json.string(body.payload, 'content'),
        };
    }

    // ---------- 字段映射 ----------
    private static toOutline(raw: Record<string, Object>): LearningOutline {
        return {
            courseTitle: Json.string(raw, 'course_title'),
            lectureTitle: Json.string(raw, 'lecture_title'),
            sections: LearningPathApi.readSections(Json.array(raw, 'sections')),
        };
    }

    private static readSections(rows: Object[]): LearningOutlineSection[] {
        const result: LearningOutlineSection[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningOutlineSection | null = LearningPathApi.toSection(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static toSection(raw: Object | null): LearningOutlineSection | null {
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
            objectives: LearningPathApi.readStrings(Json.array(source, 'objectives')),
            keyConcepts: LearningPathApi.readStrings(Json.array(source, 'key_concepts')),
            difficulty: Json.string(source, 'difficulty'),
            estimatedMinutes: Json.number(source, 'estimated_minutes'),
            sources: LearningPathApi.readSources(Json.array(source, 'sources')),
        };
    }

    private static readSources(rows: Object[]): LearningOutlineSource[] {
        const result: LearningOutlineSource[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningOutlineSource | null = LearningPathApi.toSource(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static toSource(raw: Object | null): LearningOutlineSource | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const bookTitle: string = Json.string(source, 'book_title');
        const chapterName: string = Json.string(source, 'chapter_name');

        if (bookTitle.length === 0 && chapterName.length === 0) {
            return null;
        }

        return {
            bookId: Json.string(source, 'book_id'),
            bookTitle: bookTitle,
            chapterName: chapterName,
            chapterSummary: Json.string(source, 'chapter_summary'),
        };
    }

    private static readChapters(rows: Object[]): LearningPathChapter[] {
        const result: LearningPathChapter[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningPathChapter | null = LearningPathApi.toChapter(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static toChapter(raw: Object | null): LearningPathChapter | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const name: string = Json.string(source, 'name');

        if (name.length === 0) {
            return null;
        }

        return {
            index: Json.number(source, 'index'),
            name: name,
            bookId: Json.string(source, 'book_id'),
            bookTitle: Json.string(source, 'book_title'),
            chapterSummary: Json.string(source, 'chapter_summary'),
            outlineSectionId: Json.string(source, 'outline_section_id'),
            status: Json.string(source, 'status'),
            progression: Json.string(source, 'progression'),
            reason: Json.string(source, 'reason'),
            contentGenerated: Json.boolean(source, 'content_generated'),
            contentGenerating: Json.boolean(source, 'content_generating'),
            learningCompleted: Json.boolean(source, 'learning_completed'),
        };
    }

    // 字符串数组：非字符串项直接跳过，避免把对象拼进文本
    private static readStrings(rows: Object[]): string[] {
        const result: string[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            if (typeof rows[i] !== 'string') {
                continue;
            }

            const text: string = (rows[i] as string).trim();

            if (text.length > 0) {
                result.push(text);
            }
        }

        return result;
    }
}
