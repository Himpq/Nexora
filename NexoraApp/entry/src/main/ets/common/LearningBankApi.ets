// LearningBankApi.ets - NexoraLearning 题库域接口
// 题库列表项把题干、选项、参考答案、解析折平进结构化对象，
// 页面只做渲染与作答收集；选项从题干正文里抽取（后端把选项内联在 question_content 中）。

import { Json } from './JsonUtil';
import { LearningBody, LearningHttp } from './LearningHttp';

// 单个选项（label 为 A/B/C/D，text 为选项正文）
export interface LearningOption {
    label: string;
    text: string;
}

// 题目（对齐后端 _question_bank_question_payload 展平后的字段）
export interface LearningQuestion {
    title: string;
    stem: string;
    answer: string;
    reason: string;
    difficulty: string;
    options: LearningOption[];
    isChoice: boolean;
}

// 题库列表项
export interface LearningBankItem {
    questionId: string;
    lectureId: string;
    lectureTitle: string;
    bookTitle: string;
    chapterName: string;
    answerState: string;
    question: LearningQuestion;
}

export interface LearningBankSummary {
    total: number;
    pending: number;
    submitted: number;
    needsReview: number;
}

export interface LearningBankResult {
    success: boolean;
    message: string;
    items: LearningBankItem[];
    summary: LearningBankSummary;
    hasNext: boolean;
    page: number;
}

// 空结果哨兵：页面以此为初值，避免在渲染层反复判空；每次调用返回新对象，避免多个 @State 共享同一实例

export function emptyBank(): LearningBankResult {
    return {
        success: false,
        message: '',
        items: [],
        summary: { total: 0, pending: 0, submitted: 0, needsReview: 0 },
        hasNext: false,
        page: 1,
    };
}

export interface LearningSubmitResult {
    success: boolean;
    message: string;
    // 后端只在能自动判题时给出对错，主观题返回 null
    hasVerdict: boolean;
    correct: boolean;
    referenceAnswer: string;
}

// 作答状态筛选值（与后端 answer_state 查询参数一致）
export class BankFilter {
    static readonly ALL: string = 'all';
    static readonly PENDING: string = 'pending';
    static readonly SUBMITTED: string = 'submitted';
    static readonly NEEDS_REVIEW: string = 'needs_review';
}

interface SubmitBody {
    question_id: string;
    student_answer: string;
}

// 选项行形态：A. / a、/ B：/ C) 开头
const OPTION_LINE: RegExp = /^\s*([A-Za-z])\s*[.、:：)]\s*(.+)$/;

export class LearningBankApi {
    static readonly shared: LearningBankApi = new LearningBankApi();

    // 题库分页：GET /api/frontend/question-bank?page=&page_size=&answer_state=
    async getItems(page: number, pageSize: number, answerState: string): Promise<LearningBankResult> {
        let path: string = '/api/frontend/question-bank?page=' + page + '&page_size=' + pageSize;

        if (answerState.length > 0 && answerState !== BankFilter.ALL) {
            path += '&answer_state=' + encodeURIComponent(answerState);
        }

        const body: LearningBody = await LearningHttp.getJson(path);
        const empty: LearningBankSummary = { total: 0, pending: 0, submitted: 0, needsReview: 0 };

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, items: [], summary: empty, hasNext: false, page: page };
        }

        const rows: Object[] = Json.array(body.payload, 'items');
        const items: LearningBankItem[] = [];

        for (let i: number = 0; i < rows.length; i++) {
            const item: LearningBankItem | null = LearningBankApi.toItem(rows[i]);

            if (item !== null) {
                items.push(item);
            }
        }

        const summaryNode: Record<string, Object> | null = Json.object(body.payload, 'summary');
        const pagination: Record<string, Object> | null = Json.object(body.payload, 'pagination');

        return {
            success: true,
            message: '',
            items: items,
            summary: summaryNode === null ? empty : {
                total: Json.number(summaryNode, 'total'),
                pending: Json.number(summaryNode, 'pending'),
                submitted: Json.number(summaryNode, 'submitted'),
                needsReview: Json.number(summaryNode, 'needs_review'),
            },
            hasNext: pagination !== null && Json.boolean(pagination, 'has_next'),
            page: page,
        };
    }

    // 提交作答：POST /api/frontend/question-bank/submit
    async submit(questionId: string, studentAnswer: string): Promise<LearningSubmitResult> {
        const payload: SubmitBody = { question_id: questionId, student_answer: studentAnswer };
        const body: LearningBody = await LearningHttp.postJson('/api/frontend/question-bank/submit', payload);

        if (!body.ok || body.payload === null) {
            return { success: false, message: body.message, hasVerdict: false, correct: false, referenceAnswer: '' };
        }

        const record: Record<string, Object> | null = Json.object(body.payload, 'record');
        const verdict: Object | null = record === null ? null : Json.fieldOrNull(record, 'is_correct');

        return {
            success: true,
            message: '',
            hasVerdict: typeof verdict === 'boolean',
            correct: verdict === true,
            referenceAnswer: record === null ? '' : Json.string(record, 'reference_answer'),
        };
    }

    // ---------- 字段映射 ----------
    private static toItem(raw: Object | null): LearningBankItem | null {
        if (!LearningHttp.isRecord(raw)) {
            return null;
        }

        const source: Record<string, Object> = raw as Record<string, Object>;
        const questionId: string = Json.string(source, 'question_id');

        if (questionId.length === 0) {
            return null;
        }

        const question: Record<string, Object> | null = Json.object(source, 'question');

        return {
            questionId: questionId,
            lectureId: Json.string(source, 'lecture_id'),
            lectureTitle: Json.string(source, 'lecture_title'),
            bookTitle: Json.string(source, 'book_title'),
            chapterName: Json.string(source, 'chapter_name'),
            answerState: Json.string(source, 'answer_state'),
            question: LearningBankApi.toQuestion(question),
        };
    }

    private static toQuestion(raw: Record<string, Object> | null): LearningQuestion {
        if (raw === null) {
            return { title: '', stem: '', answer: '', reason: '', difficulty: '', options: [], isChoice: false };
        }

        const content: string = Json.string(raw, 'question_content');
        const options: LearningOption[] = LearningBankApi.parseOptions(content);

        return {
            title: Json.string(raw, 'question_title'),
            stem: LearningBankApi.parseStem(content),
            answer: Json.string(raw, 'question_answer'),
            reason: Json.string(raw, 'question_reason'),
            difficulty: Json.string(raw, 'question_difficulty'),
            options: options,
            isChoice: options.length >= 2,
        };
    }

    // 选项抽取：题干正文中首个「字母 + 分隔符」行之后的所有同类行
    private static parseOptions(content: string): LearningOption[] {
        const lines: string[] = content.split('\n');
        const options: LearningOption[] = [];

        for (let i: number = 0; i < lines.length; i++) {
            const matched: RegExpMatchArray | null = lines[i].match(OPTION_LINE);

            if (matched === null) {
                continue;
            }

            options.push({ label: matched[1].toUpperCase(), text: matched[2].trim() });
        }

        return options;
    }

    // 题干：去掉选项行后的剩余正文
    private static parseStem(content: string): string {
        const lines: string[] = content.split('\n');
        const stemLines: string[] = [];

        for (let i: number = 0; i < lines.length; i++) {
            if (lines[i].match(OPTION_LINE) !== null) {
                break;
            }

            stemLines.push(lines[i]);
        }

        return stemLines.join('\n').trim();
    }

    // 参考答案中的选项字母：用于作答后高亮正确项（"B。C++项目…" -> "B"）
    static answerLetter(answer: string): string {
        const matched: RegExpMatchArray | null = answer.trim().match(/^\s*([A-Za-z])\s*[.、:：)。]?/);

        if (matched === null) {
            return '';
        }

        return matched[1].toUpperCase();
    }
}
