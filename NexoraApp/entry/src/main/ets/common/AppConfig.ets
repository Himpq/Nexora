// AppConfig.ets - 全局常量与领域枚举
// 只放编译期常量与纯类型，运行期状态一律走 AppState，避免静态变量成为隐藏状态

export const DEFAULT_BACKEND_URL: string = 'http://154.37.212.129';

// ---------- 存储键 ----------
export class StorageKey {
    static readonly backendUrl: string = 'backend_url';
    static readonly sessionCookie: string = 'session_cookie';
    static readonly username: string = 'username';
    static readonly selectedModel: string = 'selected_model';
    static readonly enableThinking: string = 'enable_thinking';
    static readonly enableWebSearch: string = 'enable_web_search';
    static readonly forceTools: string = 'force_tools';
    static readonly notesPrefix: string = 'notes_';
    // question 回答锁：JSON 字典 { "conversationId::cardId": "answer" }，与 Web localStorage 同构
    static readonly questionLocks: string = 'question_locks';
    // 阅读器偏好：字号（数字字符串）/ 行距档（0 紧凑 / 1 适中 / 2 疏松）/ 主题（day/night/sepia）
    static readonly readerFontSize: string = 'reader_font_size';
    static readonly readerLineSpacing: string = 'reader_line_spacing';
    static readonly readerTheme: string = 'reader_theme';
    // 各书上次阅读章节：JSON 字典 { bookId: chapterIndex }
    static readonly readerPositions: string = 'reader_positions';
}

// ---------- 领域模型 ----------
// 模型条目：后端 /api/config 归一化后的形态
export interface ModelItem {
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    status?: string;
}

// 快捷能力：首页 chip，点击后附加到本次提问的生成参数
export interface QuickAction {
    id: string;
    label: string;
    hint: string;
    prompt: string;
}

// 首页快捷能力清单
export const QUICK_ACTIONS: QuickAction[] = [
    {
        id: 'deep_think',
        label: '深度思考',
        hint: '开启推理链路，先想后答',
        prompt: '请对下面这个问题做深度分析，先列出你的推理过程，再给出结论：'
    },
    {
        id: 'web_search',
        label: '联网搜索',
        hint: '实时检索后作答',
        prompt: '请先联网检索最新资料，再回答：'
    },
    {
        id: 'knowledge',
        label: '知识库',
        hint: '基于团队知识库作答',
        prompt: '请基于知识库中的内容回答，并标注引用来源：'
    },
    {
        id: 'write',
        label: '帮我写作',
        hint: '润色与结构化表达',
        prompt: '请帮我完成下面的写作任务，注意结构清晰、语言自然：'
    }
];

// 会话列表条目
export interface ConversationItem {
    id: string;
    title: string;
    preview: string;
    time: string;
    mode: string;
    pin: boolean;
}

// 知识库列表条目：title 既是展示名也是唯一标识（后端以 title 为 key）
export interface KnowledgeItem {
    title: string;
    pin: boolean;
    updatedAt: number;
    time: string;
    basisId: string;
}

// 邮件列表条目：收件箱 / 已发送共用，box 标记来源；peer 按来源取发件人或收件人
export interface MailItem {
    id: string;
    box: string;
    subject: string;
    peer: string;
    time: string;
    unread: boolean;
    preview: string;
}

// 邮件详情：GET /api/mail/me/{box}/<id> 归一化后的形态；正文优先用 contentHtml（HTML 邮件），
// 纯文本邮件只有 content；两字段都来自服务端提取结果
export interface MailDetail {
    id: string;
    subject: string;
    sender: string;
    recipient: string;
    time: string;
    content: string;
    contentHtml: string;
}

// 随笔条目：只保存正文与更新时间，标题和日期分组由界面从正文与时间派生
export interface NoteItem {
    id: string;
    content: string;
    updatedAt: number;
    notebookId: string;
    source: string;
    sourceTitle: string;
    anchor: Record<string, Object> | null;
}

// 后端笔记本元数据：第一版 UI 不展示切换器，但保存时必须原样保留
export interface NoteNotebook {
    id: string;
    name: string;
    ts: number;
}

// /api/notes/store 的完整快照；保存时同时提交 baseStore，由服务端做三方合并
export interface NotesStore {
    activeNotebookId: string;
    notebooks: NoteNotebook[];
    notes: NoteItem[];
    updatedAt: number;
}

// ---------- 展示名清洗 ----------
// 历史版本可能把字面量 "undefined" 落进了持久化昵称，展示前统一归空，避免界面出现 "晚上好undefined"
// 入参放宽为可空：持久化/服务端字段在极端时序下可能为 undefined，一律归空而不是抛异常
export function sanitizeDisplayName(raw: string | undefined): string {
    if (raw === undefined) {
        return '';
    }

    const trimmed: string = raw.trim();

    if (trimmed.length === 0) {
        return '';
    }

    if (trimmed === 'undefined' || trimmed === 'null' || trimmed === 'NaN') {
        return '';
    }

    return trimmed;
}

// ---------- 问候语 ----------
// 依据当前时段返回首页问候语
export function greetingOfHour(hour: number): string {
    if (hour < 6) {
        return '夜深了';
    }

    if (hour < 11) {
        return '早上好';
    }

    if (hour < 14) {
        return '中午好';
    }

    if (hour < 18) {
        return '下午好';
    }

    return '晚上好';
}
