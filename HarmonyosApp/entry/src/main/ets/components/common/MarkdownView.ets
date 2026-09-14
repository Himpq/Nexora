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
}

function pushInline(target: MdInline[], kind: string, text: string, seq: number): number {
  if (text.length === 0) {
    return seq;
  }
  const item = new MdInline();
  item.key = 'i' + seq;
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

export function renderLatex(source: string): string {
  let text = source.trim();
  if (text.startsWith('$$') && text.endsWith('$$') && text.length >= 4) {
    text = text.slice(2, text.length - 2);
  } else if (text.startsWith('$') && text.endsWith('$') && text.length >= 2) {
    text = text.slice(1, text.length - 1);
  }
  text = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
  text = text.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  text = text.replace(/\\sqrt\s+([A-Za-z0-9]+)/g, '√$1');
  text = text.replace(/\\text\{([^{}]+)\}/g, '$1');
  text = text.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
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
  text = replaceAll(text, '\\{', '{');
  text = replaceAll(text, '\\}', '}');
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
  const pushBlock = (kind: string, raw: string, inlines: MdInline[]): void => {
    const block = new MdBlock();
    block.key = 'b' + seq;
    seq++;
    block.kind = kind;
    block.text = raw;
    block.inlines = inlines;
    blocks.push(block);
  };
  while (index < text.length) {
    if (text.startsWith('```', index)) {
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
      const close = text.indexOf('$$', index + 2);
      const body = close >= 0 ? text.slice(index + 2, close) : text.slice(index + 2);
      const inline = new MdInline();
      inline.key = 'm' + seq;
      inline.kind = 'math';
      inline.text = renderLatex(body);
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
      continue;
    }
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
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^\d+[.)]\s+/, '');
      pushBlock('ol', item, parseInlines(item, seq * 10));
      continue;
    }
    pushBlock('p', trimmed, parseInlines(trimmed, seq * 10));
  }
  if (blocks.length === 0 && source.trim().length > 0) {
    pushBlock('p', source.trim(), parseInlines(source.trim(), 0));
  }
  return blocks;
}

@Component
export struct MarkdownView {
  source: string = '';
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
      Span(item.text)
        .fontStyle(FontStyle.Italic)
        .fontFamily(NxFontFamily.serif)
        .fontSize(this.bodySize)
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
        .fontSize(this.bodySize)
        .fontStyle(FontStyle.Italic)
        .fontFamily(NxFontFamily.serif)
        .fontColor(this.palette().dawn)
        .width('100%')
        .textAlign(TextAlign.Center)
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
    } else if (block.kind === 'li' || block.kind === 'ol') {
      Row({ space: NxGrid }) {
        Text(block.kind === 'ol' ? '·' : '•')
          .fontSize(this.bodySize)
          .fontColor(this.palette().dawn)
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
