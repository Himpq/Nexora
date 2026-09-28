/**
 * 对话侧 Markdown + 轻量 LaTeX。
 * 覆盖标题 / 加粗 / 斜体 / 行内代码 / 列表 / 引用 / 代码块 / $...$ 与 $$...$$。
 * 复杂公式转成可读 Unicode，不引入 WebView。
 */
import { nxPalette, NxPalette, NxFontSize, NxFontFamily, NxRadius, NxGrid } from '../../theme/DesignTokens';

export class MdInline {
  key: string = '';
  kind: string = 'text';
  text: string = '';
}

export class MdBlock {
  key: string = '';
  kind: string = 'p';
  inlines: MdInline[] = [];
  text: string = '';
  /** 有序列表的原始编号（保留输入编号，回答里说「第 2 步」时页面能对上）。 */
  ordinal: string = '';
  /** 表格：每行的单元格。 */
  rows: string[][] = [];
}

/**
 * 键值里带上内容指纹：流式释放时同一段落的文字在变而序号不变，
 * ForEach 只认键，序号键会让最后一段停在第一次渲染的样子。
 */
function nxHash(text: string): string {
  let h: number = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

function pushInline(target: MdInline[], kind: string, text: string, seq: number): number {
  if (text.length === 0) {
    return seq;
  }
  const item = new MdInline();
  item.key = 'i' + seq + '_' + nxHash(text);
  item.kind = kind;
  item.text = text;
  target.push(item);
  return seq + 1;
}

function takeInlineToken(line: string, cursor: number): string[] {
  const rest = line.slice(cursor);
  if (rest.length === 0) {
    return ['', '', '0'];
  }
  if (rest.charAt(0) === '`') {
    const close = rest.indexOf('`', 1);
    if (close > 0) {
      return ['code', rest.slice(1, close), String(close + 1)];
    }
  }
  if (rest.startsWith('$$')) {
    const close = rest.indexOf('$$', 2);
    if (close > 1) {
      return ['math', rest.slice(2, close), String(close + 2)];
    }
  }
  if (rest.charAt(0) === '$') {
    const close = rest.indexOf('$', 1);
    if (close > 0) {
      return ['math', rest.slice(1, close), String(close + 1)];
    }
  }
  if (rest.startsWith('**')) {
    const close = rest.indexOf('**', 2);
    if (close > 1) {
      return ['strong', rest.slice(2, close), String(close + 2)];
    }
  }
  if (rest.startsWith('__')) {
    const close = rest.indexOf('__', 2);
    if (close > 1) {
      return ['strong', rest.slice(2, close), String(close + 2)];
    }
  }
  if (rest.charAt(0) === '*' && rest.length > 1 && rest.charAt(1) !== ' ') {
    const close = rest.indexOf('*', 1);
    if (close > 0) {
      return ['em', rest.slice(1, close), String(close + 1)];
    }
  }
  let next = rest.length;
  const markers: number[] = [];
  const tick = rest.indexOf('`');
  const dollar = rest.indexOf('$');
  const star2 = rest.indexOf('**');
  const under2 = rest.indexOf('__');
  const star = rest.indexOf('*');
  if (tick >= 0) {
    markers.push(tick);
  }
  if (dollar >= 0) {
    markers.push(dollar);
  }
  if (star2 >= 0) {
    markers.push(star2);
  }
  if (under2 >= 0) {
    markers.push(under2);
  }
  if (star > 0) {
    markers.push(star);
  }
  for (let i = 0; i < markers.length; i++) {
    if (markers[i] < next) {
      next = markers[i];
    }
  }
  if (next <= 0) {
    next = 1;
  }
  return ['text', rest.slice(0, next), String(next)];
}

function parseInlines(line: string, seqStart: number): MdInline[] {
  const rows: MdInline[] = [];
  let cursor = 0;
  let seq = seqStart;
  while (cursor < line.length) {
    const token = takeInlineToken(line, cursor);
    const kind = token[0];
    const text = token[1];
    const consumed = Number(token[2]);
    if (consumed <= 0) {
      break;
    }
    if (kind === 'math') {
      seq = pushInline(rows, 'math', renderLatex(text), seq);
    } else {
      seq = pushInline(rows, kind, text, seq);
    }
    cursor += consumed;
  }
  return rows;
}

function replaceAll(source: string, from: string, to: string): string {
  if (from.length === 0) {
    return source;
  }
  return source.split(from).join(to);
}

/** 只有当 LaTeX 里没有这些无法可靠降级的结构时才转 Unicode；否则保留原文（2026-09-21 审查 I3）。 */
function latexTooComplex(text: string): boolean {
  return /\\begin\{|\\end\{|\\matrix|\\cases|\\over(?![a-z])|\\underbrace|\\overbrace|\\stackrel|\\xrightarrow/.test(text);
}

/** 递归展开 \frac / \sqrt（原正则只处理无嵌套的一层）。 */
function expandNested(text: string): string {
  let previous = '';
  let current = text;
  let guard = 0;
  while (previous !== current && guard < 12) {
    guard++;
    previous = current;
    current = current.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    current = current.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
    current = current.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1');
  }
  return current;
}

export function renderLatex(source: string): string {
  let text = source.trim();
  if (text.startsWith('$$') && text.endsWith('$$') && text.length >= 4) {
    text = text.slice(2, text.length - 2);
  } else if (text.startsWith('$') && text.endsWith('$') && text.length >= 2) {
    text = text.slice(1, text.length - 1);
  }
  if (latexTooComplex(text)) {
    // 不能靠删符号伪装成功渲染：保留原文，界面按等宽公式显示。
    return text.trim();
  }
  // 集合括号 \{ \} 先换成占位，最后再还原，避免被末尾的「去花括号」一起删掉。
  text = replaceAll(text, '\\{', '\u0001');
  text = replaceAll(text, '\\}', '\u0002');
  text = expandNested(text);
  text = text.replace(/\\sqrt\s+([A-Za-z0-9]+)/g, '√$1');
  text = text.replace(/\\left\s*([()\[\]|.])/g, '$1');
  text = text.replace(/\\right\s*([()\[\]|.])/g, '$1');
  text = text.replace(/\\left/g, '');
  text = text.replace(/\\right/g, '');
  text = text.replace(/\\,/g, ' ');
  text = text.replace(/\\;/g, ' ');
  text = text.replace(/\^\{([^{}]+)\}/g, '^($1)');
  text = text.replace(/_\{([^{}]+)\}/g, '_($1)');
  const pairs: string[][] = [
    ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'],
    ['\\epsilon', 'ε'], ['\\theta', 'θ'], ['\\lambda', 'λ'], ['\\mu', 'μ'],
    ['\\pi', 'π'], ['\\sigma', 'σ'], ['\\omega', 'ω'], ['\\phi', 'φ'],
    ['\\psi', 'ψ'], ['\\Delta', 'Δ'], ['\\Omega', 'Ω'], ['\\Sigma', 'Σ'],
    ['\\times', '×'], ['\\cdot', '·'], ['\\div', '÷'], ['\\pm', '±'],
    ['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'], ['\\approx', '≈'],
    ['\\infty', '∞'], ['\\sum', '∑'], ['\\int', '∫'], ['\\prod', '∏'],
    ['\\partial', '∂'], ['\\nabla', '∇'], ['\\in', '∈'], ['\\notin', '∉'],
    ['\\subset', '⊂'], ['\\cup', '∪'], ['\\cap', '∩'], ['\\rightarrow', '→'],
    ['\\leftarrow', '←'], ['\\Rightarrow', '⇒'], ['\\to', '→'],
    ['\\ldots', '…'], ['\\cdots', '⋯'], ['\\quad', '  '],
    ['\\sin', 'sin'], ['\\cos', 'cos'], ['\\tan', 'tan'], ['\\log', 'log'],
    ['\\ln', 'ln'], ['\\exp', 'exp'], ['\\min', 'min'], ['\\max', 'max'],
    ['\\hbar', 'ℏ'], ['\\ell', 'ℓ'],
  ];
  for (let i = 0; i < pairs.length; i++) {
    text = replaceAll(text, pairs[i][0], pairs[i][1]);
  }
  text = replaceAll(text, '\\%', '%');
  text = replaceAll(text, '\\_', '_');
  text = replaceAll(text, '\\&', '&');
  text = replaceAll(text, '\\\\', '\n');
  text = text.replace(/\^2/g, '²');
  text = text.replace(/\^3/g, '³');
  text = text.replace(/\^n/g, 'ⁿ');
  text = text.replace(/_0/g, '₀');
  text = text.replace(/_1/g, '₁');
  text = text.replace(/_2/g, '₂');
  text = text.replace(/_i/g, 'ᵢ');
  text = text.replace(/_n/g, 'ₙ');
  text = text.replace(/[{}]/g, '');
  text = replaceAll(text, '\u0001', '{');
  text = replaceAll(text, '\u0002', '}');
  return text.trim();
}

function headingLevel(line: string): number {
  if (line.startsWith('### ')) {
    return 3;
  }
  if (line.startsWith('## ')) {
    return 2;
  }
  if (line.startsWith('# ')) {
    return 1;
  }
  return 0;
}

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const text = source.replace(/\r\n/g, '\n');
  let index = 0;
  let seq = 0;
  const pushBlock = (kind: string, raw: string, inlines: MdInline[], ordinal: string = '', rows: string[][] = []): void => {
    const block = new MdBlock();
    block.key = 'b' + seq + '_' + nxHash(raw);
    seq++;
    block.kind = kind;
    block.text = raw;
    block.inlines = inlines;
    block.ordinal = ordinal;
    block.rows = rows;
    blocks.push(block);
  };
  // 表格：连续的 | a | b | 行；第二行是 |---|---| 分隔线时跳过。
  const tableRows: string[][] = [];
  let tableRaw: string = '';
  const flushTable = (): void => {
    if (tableRows.length > 0) {
      pushBlock('table', tableRaw, [], '', tableRows.slice());
    }
    tableRows.length = 0;
    tableRaw = '';
  };
  while (index < text.length) {
    if (text.startsWith('```', index)) {
      flushTable();
      const start = index + 3;
      let nl = text.indexOf('\n', start);
      if (nl < 0) {
        nl = start;
      }
      const close = text.indexOf('```', nl + 1);
      const body = close >= 0 ? text.slice(nl + 1, close) : text.slice(nl + 1);
      pushBlock('code', body.replace(/\s+$/, ''), []);
      index = close >= 0 ? close + 3 : text.length;
      if (index < text.length && text.charAt(index) === '\n') {
        index++;
      }
      continue;
    }
    if (text.startsWith('$$', index)) {
      flushTable();
      const close = text.indexOf('$$', index + 2);
      const body = close >= 0 ? text.slice(index + 2, close) : text.slice(index + 2);
      const inline = new MdInline();
      inline.kind = 'math';
      inline.text = renderLatex(body);
      inline.key = 'm' + seq + '_' + nxHash(inline.text);
      pushBlock('math', inline.text, [inline]);
      index = close >= 0 ? close + 2 : text.length;
      if (index < text.length && text.charAt(index) === '\n') {
        index++;
      }
      continue;
    }
    let end = text.indexOf('\n', index);
    if (end < 0) {
      end = text.length;
    }
    const line = text.slice(index, end);
    index = end < text.length ? end + 1 : text.length;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushTable();
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const inner = trimmed.slice(1, trimmed.length - 1);
      if (/^[\s|:\-]+$/.test(inner)) {
        continue;
      }
      const cells: string[] = [];
      for (const cell of inner.split('|')) {
        cells.push(cell.trim());
      }
      tableRows.push(cells);
      tableRaw += trimmed + '\n';
      continue;
    }
    flushTable();
    const heading = headingLevel(trimmed);
    if (heading > 0) {
      const title = trimmed.replace(/^#{1,3}\s+/, '');
      pushBlock('h' + heading, title, parseInlines(title, seq * 10));
      continue;
    }
    if (trimmed.startsWith('> ')) {
      const quote = trimmed.slice(2);
      pushBlock('quote', quote, parseInlines(quote, seq * 10));
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-*+]\s+/, '');
      pushBlock('li', item, parseInlines(item, seq * 10));
      continue;
    }
    const ordered = trimmed.match(/^(\d+)[.)]\s+/);
    if (ordered !== null) {
      const item = trimmed.slice(ordered[0].length);
      pushBlock('ol', item, parseInlines(item, seq * 10), ordered[1] + '.');
      continue;
    }
    pushBlock('p', trimmed, parseInlines(trimmed, seq * 10));
  }
  flushTable();
  if (blocks.length === 0 && source.trim().length > 0) {
    pushBlock('p', source.trim(), parseInlines(source.trim(), 0));
  }
  return blocks;
}

@Component
export struct MarkdownView {
  /** @Prop：父组件（如流式释放中的 TimelineEntryView）重渲染时正文要跟着变，普通成员只在创建时赋一次。 */
  @Prop source: string = '';
  serif: boolean = true;
  bodySize: number = NxFontSize.xl;
  lineH: number = 23;
  ink: string = '';
  muted: string = '';
  codeBg: string = '';
  @StorageProp('nxDarkMode') nxDark: boolean = false;

  private palette(): NxPalette {
    return nxPalette(this.nxDark);
  }

  private inkColor(): string {
    return this.ink.length > 0 ? this.ink : this.palette().text1;
  }

  private mutedColor(): string {
    return this.muted.length > 0 ? this.muted : this.palette().text3;
  }

  private codeBackground(): string {
    return this.codeBg.length > 0 ? this.codeBg : this.palette().surface3;
  }

  @Builder
  inlineView(item: MdInline, heading: boolean) {
    if (item.kind === 'strong') {
      Span(item.text)
        .fontWeight(FontWeight.Bold)
        .fontSize(heading ? this.bodySize + 1 : this.bodySize)
        .fontColor(this.inkColor())
    } else if (item.kind === 'em') {
      Span(item.text)
        .fontStyle(FontStyle.Italic)
        .fontSize(this.bodySize)
        .fontColor(this.inkColor())
    } else if (item.kind === 'code') {
      Span(item.text)
        .fontFamily(NxFontFamily.mono)
        .fontSize(this.bodySize - 1)
        .fontColor(this.palette().night)
    } else if (item.kind === 'math') {
      // 仍含 \ 命令的公式是「无法可靠降级、保留原文」的结果：用等宽而不是斜体，避免看起来像渲染成功。
      Span(item.text)
        .fontStyle(item.text.indexOf('\\') >= 0 ? FontStyle.Normal : FontStyle.Italic)
        .fontFamily(item.text.indexOf('\\') >= 0 ? NxFontFamily.mono : NxFontFamily.serif)
        .fontSize(item.text.indexOf('\\') >= 0 ? this.bodySize - 2 : this.bodySize)
        .fontColor(this.palette().dawn)
    } else {
      Span(item.text)
        .fontSize(heading ? this.bodySize + 1 : this.bodySize)
        .fontWeight(heading ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.inkColor())
    }
  }

  @Builder
  blockView(block: MdBlock) {
    if (block.kind === 'code') {
      Text(block.text)
        .fontSize(NxFontSize.sm)
        .fontFamily(NxFontFamily.mono)
        .fontColor(this.inkColor())
        .lineHeight(18)
        .width('100%')
        .padding(NxGrid * 2)
        .borderRadius(NxRadius.xs)
        .backgroundColor(this.codeBackground())
    } else if (block.kind === 'math') {
      Text(block.text)
        .fontSize(block.text.indexOf('\\') >= 0 ? this.bodySize - 2 : this.bodySize)
        .fontStyle(block.text.indexOf('\\') >= 0 ? FontStyle.Normal : FontStyle.Italic)
        .fontFamily(block.text.indexOf('\\') >= 0 ? NxFontFamily.mono : NxFontFamily.serif)
        .fontColor(this.palette().dawn)
        .width('100%')
        .textAlign(block.text.indexOf('\\') >= 0 ? TextAlign.Start : TextAlign.Center)
        .padding({ top: NxGrid, bottom: NxGrid })
    } else if (block.kind === 'quote') {
      Row({ space: NxGrid * 2 }) {
        Column()
          .width(2)
          .height('100%')
          .backgroundColor(this.palette().dawn)
        Text() {
          ForEach(block.inlines, (item: MdInline) => {
            this.inlineView(item, false)
          }, (item: MdInline) => item.key)
        }
        .fontSize(this.bodySize)
        .fontColor(this.mutedColor())
        .lineHeight(this.lineH)
        .layoutWeight(1)
      }
      .width('100%')
    } else if (block.kind === 'table') {
      // 表格：首行为表头，等宽列；列多时横向滚动。
      Scroll() {
        Column({ space: 0 }) {
          ForEach(block.rows, (row: string[], ri: number) => {
            Row({ space: 0 }) {
              ForEach(row, (cell: string, ci: number) => {
                Text(cell)
                  .fontSize(NxFontSize.sm)
                  .fontWeight(ri === 0 ? FontWeight.Medium : FontWeight.Normal)
                  .fontColor(this.inkColor())
                  .lineHeight(18)
                  .constraintSize({ minWidth: 72, maxWidth: 220 })
                  .padding({ left: NxGrid * 2, right: NxGrid * 2, top: NxGrid, bottom: NxGrid })
                  .border({ width: 0.5, color: this.mutedColor() })
              }, (cell: string, ci: number) => ci + '_' + cell)
            }
            .backgroundColor(ri === 0 ? this.codeBackground() : Color.Transparent)
          }, (row: string[], ri: number) => ri + '_' + row.join('|'))
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    } else if (block.kind === 'li' || block.kind === 'ol') {
      Row({ space: NxGrid }) {
        Text(block.kind === 'ol' ? (block.ordinal.length > 0 ? block.ordinal : '·') : '•')
          .fontSize(this.bodySize)
          .fontColor(this.palette().dawn)
          .constraintSize({ minWidth: block.kind === 'ol' ? 18 : 0 })
        Text() {
          ForEach(block.inlines, (item: MdInline) => {
            this.inlineView(item, false)
          }, (item: MdInline) => item.key)
        }
        .fontSize(this.bodySize)
        .fontColor(this.inkColor())
        .lineHeight(this.lineH)
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
    } else {
      Text() {
        ForEach(block.inlines, (item: MdInline) => {
          this.inlineView(item, block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3')
        }, (item: MdInline) => item.key)
      }
      .width('100%')
      .fontFamily(this.serif ? NxFontFamily.serif : NxFontFamily.sans)
      .fontSize(block.kind === 'h1' ? this.bodySize + 3 : (block.kind === 'h2' ? this.bodySize + 2 : this.bodySize))
      .fontWeight(block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3' ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(this.inkColor())
      .lineHeight(this.lineH)
    }
  }

  build() {
    Column({ space: NxGrid }) {
      ForEach(parseMarkdown(this.source), (block: MdBlock) => {
        this.blockView(block)
      }, (block: MdBlock) => block.key)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
