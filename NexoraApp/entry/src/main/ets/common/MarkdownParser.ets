// MarkdownParser.ets - Markdown 结构化解析（纯逻辑，不含任何 UI）
// 输出「块 + 行内片段」两级结构，渲染层只负责把结构翻译成组件，不再在 UI 里做字符串判断

// 行内片段：用布尔位表达样式叠加，渲染层据此选择字体与颜色
export interface InlinePiece {
    text: string;
    bold: boolean;
    italic: boolean;
    code: boolean;
    href: string;
}

export type BlockType = 'heading' | 'paragraph' | 'code' | 'quote' | 'list' | 'divider';

export interface ListItem {
    marker: string;
    inline: InlinePiece[];
}

export interface MarkdownBlock {
    type: BlockType;
    level: number;
    language: string;
    codeText: string;
    ordered: boolean;
    inline: InlinePiece[];
    items: ListItem[];
}

// 行内扫描器：顺序扫描源串，命中标记就切出一个片段
// 之所以做成有状态类，是因为链接解析需要同时返回片段与结束下标
class InlineScanner {
    private readonly source: string;
    private index: number = 0;
    private buffer: string = '';
    private readonly pieces: InlinePiece[] = [];

    constructor(source: string) {
        this.source = source;
    }

    scan(): InlinePiece[] {
        while (this.index < this.source.length) {
            const char: string = this.source[this.index];

            if (char === '`' && this.tryReadCode()) {
                continue;
            }

            if (char === '*' && this.tryReadStrong()) {
                continue;
            }

            if (char === '*' && this.tryReadEmphasis()) {
                continue;
            }

            if (char === '[' && this.tryReadLink()) {
                continue;
            }

            this.buffer += char;
            this.index += 1;
        }

        this.flushBuffer();
        return this.pieces;
    }

    private flushBuffer(): void {
        if (this.buffer.length === 0) {
            return;
        }

        this.pieces.push({ text: this.buffer, bold: false, italic: false, code: false, href: '' });
        this.buffer = '';
    }

    // `code`
    private tryReadCode(): boolean {
        const end: number = this.source.indexOf('`', this.index + 1);

        if (end <= this.index + 1) {
            return false;
        }

        this.flushBuffer();
        this.pieces.push({
            text: this.source.substring(this.index + 1, end),
            bold: false,
            italic: false,
            code: true,
            href: ''
        });
        this.index = end + 1;
        return true;
    }

    // **bold**
    private tryReadStrong(): boolean {
        if (this.source[this.index + 1] !== '*') {
            return false;
        }

        const end: number = this.source.indexOf('**', this.index + 2);

        if (end <= this.index + 2) {
            return false;
        }

        this.flushBuffer();
        this.pushNested(this.source.substring(this.index + 2, end), true, false);
        this.index = end + 2;
        return true;
    }

    // *italic*
    private tryReadEmphasis(): boolean {
        const end: number = this.source.indexOf('*', this.index + 1);

        if (end <= this.index + 1) {
            return false;
        }

        this.flushBuffer();
        this.pushNested(this.source.substring(this.index + 1, end), false, true);
        this.index = end + 1;
        return true;
    }

    // [text](url)
    private tryReadLink(): boolean {
        const labelEnd: number = this.source.indexOf(']', this.index);

        if (labelEnd < 0 || this.source[labelEnd + 1] !== '(') {
            return false;
        }

        const urlEnd: number = this.source.indexOf(')', labelEnd + 2);

        if (urlEnd < 0) {
            return false;
        }

        this.flushBuffer();
        this.pieces.push({
            text: this.source.substring(this.index + 1, labelEnd),
            bold: false,
            italic: false,
            code: false,
            href: this.source.substring(labelEnd + 2, urlEnd)
        });
        this.index = urlEnd + 1;
        return true;
    }

    // 加粗 / 斜体内部允许继续嵌套行内样式，递归解析后叠加当前样式位
    private pushNested(inner: string, bold: boolean, italic: boolean): void {
        const nested: InlinePiece[] = InlineScanner.parse(inner);

        for (let i: number = 0; i < nested.length; i++) {
            const piece: InlinePiece = nested[i];
            this.pieces.push({
                text: piece.text,
                bold: bold || piece.bold,
                italic: italic || piece.italic,
                code: piece.code,
                href: piece.href
            });
        }
    }

    static parse(text: string): InlinePiece[] {
        return new InlineScanner(text).scan();
    }
}

// 块级解析器：按行推进，负责识别围栏代码块、标题、引用、列表、分割线与段落
class BlockScanner {
    private readonly lines: string[];
    private index: number = 0;
    private readonly blocks: MarkdownBlock[] = [];

    constructor(source: string) {
        this.lines = source.replace(/\r\n/g, '\n').split('\n');
    }

    scan(): MarkdownBlock[] {
        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (BlockScanner.isBlank(line)) {
                this.index += 1;
                continue;
            }

            if (BlockScanner.isFence(line)) {
                this.readCodeBlock();
                continue;
            }

            if (BlockScanner.isDivider(line)) {
                this.blocks.push(BlockScanner.emptyBlock('divider'));
                this.index += 1;
                continue;
            }

            const headingLevel: number = BlockScanner.headingLevel(line);

            if (headingLevel > 0) {
                this.blocks.push({
                    type: 'heading',
                    level: headingLevel,
                    language: '',
                    codeText: '',
                    ordered: false,
                    inline: InlineScanner.parse(line.substring(headingLevel + 1).trim()),
                    items: []
                });
                this.index += 1;
                continue;
            }

            if (line.startsWith('>')) {
                this.readQuote();
                continue;
            }

            if (BlockScanner.listMarker(line).length > 0) {
                this.readList();
                continue;
            }

            this.readParagraph();
        }

        return this.blocks;
    }

    // 围栏代码块：```lang 开始，直到收尾围栏或文本结束
    private readCodeBlock(): void {
        const language: string = this.lines[this.index].substring(3).trim();
        this.index += 1;

        const body: string[] = [];

        while (this.index < this.lines.length) {
            if (BlockScanner.isFence(this.lines[this.index])) {
                this.index += 1;
                break;
            }

            body.push(this.lines[this.index]);
            this.index += 1;
        }

        this.blocks.push({
            type: 'code',
            level: 0,
            language: language,
            codeText: body.join('\n'),
            ordered: false,
            inline: [],
            items: []
        });
    }

    // 引用块：连续的 > 行合并为一段，行内保留换行
    private readQuote(): void {
        const body: string[] = [];

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (!line.startsWith('>')) {
                break;
            }

            body.push(line.substring(1).trim());
            this.index += 1;
        }

        this.blocks.push({
            type: 'quote',
            level: 0,
            language: '',
            codeText: '',
            ordered: false,
            inline: InlineScanner.parse(body.join('\n')),
            items: []
        });
    }

    // 列表块：连续的同类型标记行合并为一个列表
    private readList(): void {
        const items: ListItem[] = [];
        const firstMarker: string = BlockScanner.listMarker(this.lines[this.index]);
        const ordered: boolean = BlockScanner.isOrderedMarker(firstMarker);
        let order: number = 1;

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (BlockScanner.isBlank(line)) {
                break;
            }

            const marker: string = BlockScanner.listMarker(line);

            if (marker.length === 0) {
                break;
            }

            // 有序列表的序号按出现顺序重排，避免后端序号错乱影响展示
            const label: string = ordered ? order.toString() + '.' : '';
            items.push({
                marker: label,
                inline: InlineScanner.parse(line.substring(marker.length).trim())
            });
            order += 1;
            this.index += 1;
        }

        this.blocks.push({
            type: 'list',
            level: 0,
            language: '',
            codeText: '',
            ordered: ordered,
            inline: [],
            items: items
        });
    }

    // 段落：读到空行或下一个块起始标记为止，整段合并成一个 Text 自动换行
    private readParagraph(): void {
        const body: string[] = [];

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (BlockScanner.isBlank(line) || BlockScanner.startsNewBlock(line)) {
                break;
            }

            body.push(line.trim());
            this.index += 1;
        }

        this.blocks.push({
            type: 'paragraph',
            level: 0,
            language: '',
            codeText: '',
            ordered: false,
            inline: InlineScanner.parse(body.join('')),
            items: []
        });
    }

    private static emptyBlock(type: BlockType): MarkdownBlock {
        return { type: type, level: 0, language: '', codeText: '', ordered: false, inline: [], items: [] };
    }

    // 有序列表标记形如 "1."，无序为 "-" / "*" / "+"
    private static listMarker(line: string): string {
        if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('+ ')) {
            return line.substring(0, 2);
        }

        const dot: number = line.indexOf('. ');

        if (dot > 0 && dot <= 3 && BlockScanner.isDigits(line.substring(0, dot))) {
            return line.substring(0, dot + 2);
        }

        return '';
    }

    private static isOrderedMarker(marker: string): boolean {
        return marker.length > 2 && BlockScanner.isDigits(marker.substring(0, marker.length - 2));
    }

    private static isDigits(text: string): boolean {
        for (let i: number = 0; i < text.length; i++) {
            if (text[i] < '0' || text[i] > '9') {
                return false;
            }
        }

        return text.length > 0;
    }

    private static startsNewBlock(line: string): boolean {
        return BlockScanner.isFence(line)
            || BlockScanner.isDivider(line)
            || BlockScanner.headingLevel(line) > 0
            || line.startsWith('>')
            || BlockScanner.listMarker(line).length > 0;
    }

    private static isFence(line: string): boolean {
        return line.trimStart().startsWith('```');
    }

    private static isDivider(line: string): boolean {
        const trimmed: string = line.trim();

        if (trimmed.length < 3) {
            return false;
        }

        const first: string = trimmed[0];

        if (first !== '-' && first !== '*' && first !== '_') {
            return false;
        }

        for (let i: number = 0; i < trimmed.length; i++) {
            if (trimmed[i] !== first) {
                return false;
            }
        }

        return true;
    }

    private static headingLevel(line: string): number {
        let level: number = 0;

        while (level < line.length && line[level] === '#') {
            level += 1;
        }

        if (level === 0 || level > 6 || line[level] !== ' ') {
            return 0;
        }

        return level;
    }

    private static isBlank(line: string): boolean {
        return line.trim().length === 0;
    }
}

export class MarkdownParser {
    // 把 Markdown 原文解析为块列表；空文本返回空列表，由调用方决定是否展示占位
    static parse(source: string): MarkdownBlock[] {
        if (source.trim().length === 0) {
            return [];
        }

        return new BlockScanner(source).scan();
    }
}
