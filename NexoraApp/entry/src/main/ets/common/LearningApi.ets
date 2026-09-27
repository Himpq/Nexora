// LearningApi.ets - NexoraLearning 课程与教材域接口
// 导航坐标系：课程 /api/lectures → 教材 → 章节索引 /index → 章节正文 /chapter/{i}?paragraphs=1。
// 阅读器所需的「章 + 小节」两层结构、段落种类、图片占位全部在这一层现成解析，
// 页面只消费结构化对象，不再自行拆解服务端原始字段。

import { Json } from './JsonUtil';
import { LearningBody, LearningHttp } from './LearningHttp';

// 课程（对齐后端 core/lectures.py 字典结构）
export interface LearningLecture {
    id: string;
    title: string;
    description: string;
    category: string;
    status: string;
    coverPath: string;
    bookCount: number;
    updatedAt: number;
}

// 教材（对齐后端 book 字典与 agent 快照的 books 项）
export interface LearningBook {
    id: string;
    title: string;
    description: string;
    textStatus: string;
    textChars: number;
    coverPath: string;
    imagesCount: number;
}

// 教材哨兵：阅读器与课程目录在教材未就绪时不参与渲染，避免渲染层反复判空
export const NO_BOOK: LearningBook = {
    id: '',
    title: '',
    description: '',
    textStatus: '',
    textChars: 0,
    coverPath: '',
    imagesCount: 0,
};

// 小节：章节内部的二级结构，阅读器目录与进度都以此为最小单位
export interface LearningSession {
    index: number;
    name: string;
    summary: string;
    paragraphStart: number;
    paragraphEnd: number;
}

// 章节摘要（章节索引 /index 的 chapters 项）
export interface LearningChapterSummary {
    index: number;
    title: string;
    summary: string;
    paragraphStart: number;
    paragraphEnd: number;
    sessions: LearningSession[];
}

// 章节段落：kind 取 text / image，image 段落 text 为图片占位串（imageId 由占位串解析而来）
// 不引入后端的 heading_level：该字段在本教材全量数据中恒为 0，正文的标题层级写在段落文本自身，
// 由 ReaderPaginator 按文本形态判定，避免出现「字段存在但永远不生效」的死分支。
export interface LearningParagraph {
    index: number;
    kind: string;
    text: string;
    imageId: string;
    // 全书 plain 正文中的 Unicode 码点半开区间，不是 UTF-16 下标。
    start: number;
    end: number;
}

// 章节阅读内容（对齐 build_chapter_payload 返回）
// chapterStart / bookTotalChars 构成全书阅读进度；章节列表另由 /index 提供（含小节），此处不重复携带
export interface LearningChapterContent {
    chapterIndex: number;
    chapterTitle: string;
    chapterCount: number;
    chapterStart: number;
    // 后端章标识使用 START:LENGTH 字符串；与 read_ranges 的 [start, end) 不同。
    chapterRange: string;
    coordinateSpace: string;
    bookTotalChars: number;
    paragraphs: LearningParagraph[];
}

export interface LearningLectureListResult {
    success: boolean;
    message: string;
    lectures: LearningLecture[];
}

export interface LearningLectureDetailResult {
    success: boolean;
    message: string;
    lecture: LearningLecture | null;
    books: LearningBook[];
}

export interface LearningChapterListResult {
    success: boolean;
    message: string;
    chapters: LearningChapterSummary[];
}

export interface LearningChapterContentResult {
    success: boolean;
    message: string;
    content: LearningChapterContent | null;
}

// 只有课程 / 教材 ID 的入口可直接把成功结果交给 LearningReader。
export interface LearningReaderTargetResult {
    success: boolean;
    message: string;
    lecture: LearningLecture | null;
    book: LearningBook | null;
    chapters: LearningChapterSummary[];
}

// 图片占位串：{{nxl_image:<lecture>:<book>:<image_id>:<filename>}}
const IMAGE_PLACEHOLDER: RegExp = /\{\{nxl_image:([^:}]+):([^:}]+):([^:}]+):([^}]+)\}\}/;

export class LearningApi {
    static readonly shared: LearningApi = new LearningApi();

    // 用户标识与 Learning 独立服务地址由 AppState 注入。
    configure(username: string, frontendUrl: string = ''): void {
        LearningHttp.configure(username, frontendUrl);
    }

    get configured(): boolean {
        return LearningHttp.configured;
    }

    // 教材内图片绝对地址：阅读器段落图片走这里，交由 RemoteImageCache 落地缓存
    bookImageUrl(lectureId: string, bookId: string, imageId: string): string {
        return LearningHttp.absolute('/api/lectures/' + encodeURIComponent(lectureId)
            + '/books/' + encodeURIComponent(bookId) + '/images/' + encodeURIComponent(imageId));
    }

    // 课程封面 / 教材封面：后端下发相对路径，这里补成绝对地址
    assetUrl(path: string): string {
        const raw: string = path.trim();

        if (raw.length === 0) {
            return '';
        }

        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return raw;
        }

        return LearningHttp.absolute(raw.startsWith('/') ? raw : '/' + raw);
    }

    // 全部课程：GET /api/lectures
    async listLectures(): Promise<LearningLectureListResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/lectures');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, lectures: [] };
        }

        return {
            success: true,
            message: '',
            lectures: LearningApi.readLectures(Json.array(body.payload, 'lectures')),
        };
    }

    // 课程详情（含教材列表）：GET /api/lectures/{id}
    async getLecture(lectureId: string): Promise<LearningLectureDetailResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/lectures/' + encodeURIComponent(lectureId));

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, lecture: null, books: [] };
        }

        const lecture: LearningLecture | null = LearningApi.toLecture(Json.fieldOrNull(body.payload, 'lecture'));

        if (lecture === null) {
            return { success: false, message: '课程数据解析失败', lecture: null, books: [] };
        }

        return {
            success: true,
            message: '',
            lecture: lecture,
            books: LearningApi.readBooks(Json.array(body.payload, 'books')),
        };
    }

    // 教材章节目录：GET /api/lectures/{l}/books/{b}/index（校验后的阅读器坐标系）
    async getBookChapters(lectureId: string, bookId: string): Promise<LearningChapterListResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/lectures/' + encodeURIComponent(lectureId)
            + '/books/' + encodeURIComponent(bookId) + '/index');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, chapters: [] };
        }

        return {
            success: true,
            message: '',
            chapters: LearningApi.readChapters(Json.array(body.payload, 'chapters')),
        };
    }

    async resolveReaderTarget(lectureId: string, bookId: string): Promise<LearningReaderTargetResult> {
        if (lectureId.trim().length === 0 || bookId.trim().length === 0) {
            return { success: false, message: '缺少课程或教材信息', lecture: null, book: null, chapters: [] };
        }

        const detail: LearningLectureDetailResult = await this.getLecture(lectureId);

        if (!detail.success || detail.lecture === null) {
            return { success: false, message: detail.message, lecture: null, book: null, chapters: [] };
        }

        let book: LearningBook | null = null;

        for (let i: number = 0; i < detail.books.length; i++) {
            if (detail.books[i].id === bookId) {
                book = detail.books[i];
                break;
            }
        }

        if (book === null) {
            return { success: false, message: '课程中未找到这本教材', lecture: detail.lecture, book: null, chapters: [] };
        }

        const catalog: LearningChapterListResult = await this.getBookChapters(lectureId, bookId);

        if (!catalog.success || catalog.chapters.length === 0) {
            return {
                success: false,
                message: catalog.success ? '教材目录尚未就绪' : catalog.message,
                lecture: detail.lecture,
                book: book,
                chapters: [],
            };
        }

        return { success: true, message: '', lecture: detail.lecture, book: book, chapters: catalog.chapters };
    }

    // 章节正文：GET /api/lectures/{l}/books/{b}/chapter/{i}?paragraphs=1
    async getBookChapter(lectureId: string, bookId: string, chapterIndex: number): Promise<LearningChapterContentResult> {
        const body: LearningBody = await LearningHttp.getJson('/api/lectures/' + encodeURIComponent(lectureId)
            + '/books/' + encodeURIComponent(bookId) + '/chapter/' + chapterIndex + '?paragraphs=1');

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, content: null };
        }

        return { success: true, message: '', content: LearningApi.toChapterContent(body.payload) };
    }

    // ---------- 字段映射 ----------
    private static readLectures(rows: Object[]): LearningLecture[] {
        const result: LearningLecture[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningLecture | null = LearningApi.toLecture(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static readBooks(rows: Object[]): LearningBook[] {
        const result: LearningBook[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningBook | null = LearningApi.toBook(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static readChapters(rows: Object[]): LearningChapterSummary[] {
        const result: LearningChapterSummary[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningChapterSummary | null = LearningApi.toChapter(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    static readSessions(rows: Object[]): LearningSession[] {
        const result: LearningSession[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningSession | null = LearningApi.toSession(rows[i]);

            if (item !== null) {
                result.push(item);
            }
        }

        return result;
    }

    private static toLecture(raw: Object | null): LearningLecture | null {
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
            description: Json.string(source, 'description'),
            category: Json.string(source, 'category'),
            status: Json.string(source, 'status'),
            coverPath: LearningApi.shared.assetUrl(Json.string(source, 'cover_path')),
            bookCount: Json.number(source, 'book_count'),
            updatedAt: Json.number(source, 'updated_at'),
        };
    }

    private static toBook(raw: Object | null): LearningBook | null {
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
            description: Json.string(source, 'description'),
            textStatus: Json.string(source, 'text_status'),
            textChars: Json.number(source, 'text_chars'),
            coverPath: LearningApi.shared.assetUrl(Json.string(source, 'cover_path')),
            imagesCount: Json.number(source, 'images_count'),
        };
    }

    private static toSession(raw: Object | null): LearningSession | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const name: string = Json.string(source, 'session_name');

        if (name.length === 0) {
            return null;
        }

        return {
            index: Json.number(source, 'session_index'),
            name: name,
            summary: Json.string(source, 'summary'),
            paragraphStart: Json.number(source, 'paragraph_start'),
            paragraphEnd: Json.number(source, 'paragraph_end'),
        };
    }

    private static toChapter(raw: Object | null): LearningChapterSummary | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const index: number = Json.number(source, 'chapter_index');

        return {
            index: index,
            title: Json.string(source, 'chapter_name'),
            summary: Json.string(source, 'summary'),
            paragraphStart: Json.number(source, 'paragraph_start'),
            paragraphEnd: Json.number(source, 'paragraph_end'),
            sessions: LearningApi.readSessions(Json.array(source, 'sessions')),
        };
    }

    private static toParagraph(raw: Object | null): LearningParagraph | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const text: string = Json.string(source, 'text');

        if (text.length === 0) {
            return null;
        }

        return {
            index: Json.number(source, 'index'),
            kind: Json.string(source, 'kind'),
            text: text,
            imageId: LearningApi.imageIdOf(text),
            start: Json.number(source, 'start'),
            end: Json.number(source, 'end'),
        };
    }

    // 图片段落解析：命中占位串返回 image_id，普通文本返回空串
    private static imageIdOf(text: string): string {
        const matched: RegExpMatchArray | null = text.trim().match(IMAGE_PLACEHOLDER);

        if (matched === null) {
            return '';
        }

        return matched[3];
    }

    private static toChapterContent(payload: Record<string, Object>): LearningChapterContent {
        const rows: Object[] = Json.array(payload, 'paragraphs');
        const paragraphs: LearningParagraph[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningParagraph | null = LearningApi.toParagraph(rows[i]);

            if (item !== null) {
                paragraphs.push(item);
            }
        }

        return {
            chapterIndex: Json.number(payload, 'chapter_index'),
            chapterTitle: Json.string(payload, 'chapter_title'),
            chapterCount: Json.number(payload, 'chapter_count'),
            chapterStart: Json.number(payload, 'chapter_start'),
            chapterRange: Json.string(payload, 'chapter_range'),
            coordinateSpace: Json.string(payload, 'coordinate_space'),
            bookTotalChars: Json.number(payload, 'book_total_chars'),
            paragraphs: paragraphs,
        };
    }
}
