// MarkdownParser.ets - Markdown 结构化解析（纯逻辑，不含任何 UI）
// 输出「块 + 行内片段」两级结构，渲染层只负责把结构翻译成组件，不再在 UI 里做字符串判断

import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMd';

// 行内片段：用布尔位表达样式叠加，渲染层据此选择字体与颜色
export interface InlinePiece {
    text: string;
    bold: boolean;
    italic: boolean;
    code: boolean;
    href: string;
}

export type BlockType = 'heading' | 'paragraph' | 'code' | 'quote' | 'list' | 'divider' | 'table';

export interface ListItem {
    marker: string;
    inline: InlinePiece[];
}

// 表格数据：表头 + 数据行 + 每列对齐方式（'left'|'center'|'right'|''）
export interface TableData {
    headers: string[];
    rows: string[][];
    aligns: string[];
}

export interface MarkdownBlock {
    type: BlockType;
    level: number;
    language: string;
    codeText: string;
    ordered: boolean;
    inline: InlinePiece[];
    items: ListItem[];
    table: TableData | null;
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
        hilog.info(DOMAIN, TAG, '[scan] lineCount=%{public}d', this.lines.length);

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
                    items: [],
                    table: null
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

            if (BlockScanner.isTableStart(this.lines, this.index)) {
                this.readTable();
                continue;
            }

            // 宽松表格：连续多行含 | 且列数一致但无分隔行（AI 常省略分隔行）
            if (BlockScanner.isLooseTableStart(this.lines, this.index)) {
                this.readLooseTable();
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
            items: [],
            table: null
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
            items: [],
            table: null
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
            items: items,
            table: null
        });
    }

    // 表格块：表头行 + 分隔行 + 连续的数据行
    private readTable(): void {
        const headers: string[] = BlockScanner.splitRow(this.lines[this.index]);
        const aligns: string[] = BlockScanner.parseAlign(this.lines[this.index + 1]);
        this.index += 2;

        const rows: string[][] = [];

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (!BlockScanner.isTableRow(line)) {
                break;
            }

            rows.push(BlockScanner.splitRow(line));
            this.index += 1;
        }

        hilog.info(DOMAIN, TAG, '[readTable] cols=%{public}d rows=%{public}d', headers.length, rows.length);

        this.blocks.push({
            type: 'table',
            level: 0,
            language: '',
            codeText: '',
            ordered: false,
            inline: [],
            items: [],
            table: { headers: headers, rows: rows, aligns: aligns }
        });
    }

    // 宽松表格块：无分隔行，首行为表头，后续连续同列数行为数据行，对齐全默认
    private readLooseTable(): void {
        const headers: string[] = BlockScanner.splitRow(this.lines[this.index]);
        const colCount: number = headers.length;
        const rows: string[][] = [];
        this.index += 1;

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (!BlockScanner.isTableRow(line) || BlockScanner.splitRow(line).length !== colCount) {
                break;
            }

            rows.push(BlockScanner.splitRow(line));
            this.index += 1;
        }

        const aligns: string[] = [];
        for (let i: number = 0; i < colCount; i++) {
            aligns.push('');
        }

        hilog.info(DOMAIN, TAG, '[readLooseTable] cols=%{public}d rows=%{public}d', colCount, rows.length);

        this.blocks.push({
            type: 'table',
            level: 0,
            language: '',
            codeText: '',
            ordered: false,
            inline: [],
            items: [],
            table: { headers: headers, rows: rows, aligns: aligns }
        });
    }

    // 段落：读到空行或下一个块起始标记为止，整段合并成一个 Text 自动换行
    private readParagraph(): void {
        const body: string[] = [];

        while (this.index < this.lines.length) {
            const line: string = this.lines[this.index];

            if (BlockScanner.isBlank(line) || BlockScanner.startsNewBlock(this.lines, this.index)) {
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
            items: [],
            table: null
        });
    }

    private static emptyBlock(type: BlockType): MarkdownBlock {
        return { type: type, level: 0, language: '', codeText: '', ordered: false, inline: [], items: [], table: null };
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

    private static startsNewBlock(lines: string[], index: number): boolean {
        const line: string = lines[index];
        return BlockScanner.isFence(line)
            || BlockScanner.isDivider(line)
            || BlockScanner.headingLevel(line) > 0
            || line.startsWith('>')
            || BlockScanner.listMarker(line).length > 0
            || BlockScanner.isTableStart(lines, index)
            || BlockScanner.isLooseTableStart(lines, index);
    }

    // 表格起始：当前行是表格行，且下一行是分隔行，且两者列数一致
    private static isTableStart(lines: string[], index: number): boolean {
        if (index + 1 >= lines.length) {
            return false;
        }

        const header: string = lines[index];
        const separator: string = lines[index + 1];

        if (!BlockScanner.isTableRow(header) || !BlockScanner.isTableSeparator(separator)) {
            return false;
        }

        return BlockScanner.splitRow(header).length === BlockScanner.splitRow(separator).length;
    }

    // 宽松表格起始：连续 >= 2 行含 | 且列数 >= 2 且一致，无分隔行
    private static isLooseTableStart(lines: string[], index: number): boolean {
        if (index + 1 >= lines.length) {
            return false;
        }

        const first: string = lines[index];

        if (!BlockScanner.isTableRow(first)) {
            return false;
        }

        const colCount: number = BlockScanner.splitRow(first).length;

        if (colCount < 2) {
            return false;
        }

        let i: number = index + 1;
        while (i < lines.length) {
            if (!BlockScanner.isTableRow(lines[i]) || BlockScanner.splitRow(lines[i]).length !== colCount) {
                break;
            }

            i += 1;
        }

        return i - index >= 2;
    }

    // 表格行：非空且含 |
    private static isTableRow(line: string): boolean {
        return line.trim().length > 0 && line.indexOf('|') >= 0;
    }

    // 表格分隔行：每个单元格只含 - 和 :，且至少一个 -
    private static isTableSeparator(line: string): boolean {
        const cells: string[] = BlockScanner.splitRow(line);

        if (cells.length === 0) {
            return false;
        }

        for (let i: number = 0; i < cells.length; i++) {
            const cell: string = cells[i].trim();

            if (cell.length < 1) {
                return false;
            }

            for (let j: number = 0; j < cell.length; j++) {
                const ch: string = cell[j];

                if (ch !== '-' && ch !== ':') {
                    return false;
                }
            }
        }

        return true;
    }

    // 拆分表格行：去首尾 | 后按 | 切分，每个单元格 trim
    private static splitRow(line: string): string[] {
        let trimmed: string = line.trim();

        if (trimmed.startsWith('|')) {
            trimmed = trimmed.substring(1);
        }

        if (trimmed.endsWith('|')) {
            trimmed = trimmed.substring(0, trimmed.length - 1);
        }

        const raw: string[] = trimmed.split('|');
        const result: string[] = [];

        for (let i: number = 0; i < raw.length; i++) {
            result.push(raw[i].trim());
        }

        return result;
    }

    // 解析分隔行的对齐：:--: center / :-- left / --: right / -- 默认
    private static parseAlign(separatorLine: string): string[] {
        const cells: string[] = BlockScanner.splitRow(separatorLine);
        const aligns: string[] = [];

        for (let i: number = 0; i < cells.length; i++) {
            const cell: string = cells[i].trim();
            const left: boolean = cell.startsWith(':');
            const right: boolean = cell.endsWith(':');

            if (left && right) {
                aligns.push('center');
            } else if (right) {
                aligns.push('right');
            } else if (left) {
                aligns.push('left');
            } else {
                aligns.push('');
            }
        }

        return aligns;
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
        hilog.info(DOMAIN, TAG, '[parse] sourceLen=%{public}d', source.length);

        if (source.trim().length === 0) {
            return [];
        }

        const blocks: MarkdownBlock[] = new BlockScanner(source).scan();
        hilog.info(DOMAIN, TAG, '[parse] done blockCount=%{public}d', blocks.length);
        return blocks;
    }
}
