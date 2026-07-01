// Kept as a local literal union (mirroring navigation/types) so this pure
// utility has no dependency on the navigation layer and stays unit-testable.
export type BookContentMode = "text" | "bookinfo" | "bookdetail";

export type BookParagraph = string;

export type BookChapter = {
  index: number;
  name: string;
  range: string;
  summary?: string;
  /** Raw `<chapter>` block, kept for the "mark complete" payload. */
  detailXml: string;
  paragraphs: BookParagraph[];
};

export type ParsedBookContent =
  | { kind: "chapters"; chapters: BookChapter[] }
  | { kind: "paragraphs"; paragraphs: BookParagraph[] };

// Tags whose entire content (text included) is metadata we render separately
// (chapter title/range/summary), so they must be removed — not just untagged —
// to avoid duplicating that text inside the body.
//
// NOTE: chapter_detail is intentionally NOT in this list. It is the body
// container; we unwrap it (strip the tags, keep the inner text) via the
// generic ANY_TAG_PATTERN in toParagraphs. Removing it with its content would
// delete the actual readable text.
const METADATA_TAG_PATTERN =
  /<\/?(?:chapter_name|chapter_range|chapter_summary)\b[^>]*>[\s\S]*?<\/(?:chapter_name|chapter_range|chapter_summary)>|<\/?(?:chapter_name|chapter_range|chapter_summary)\b[^>]*\/?>/gi;

const ANY_TAG_PATTERN = /<[^>]+>/g;

/** Strip every XML/HTML tag from a string, preserving inner text. */
export function stripTags(input: string): string {
  return String(input || "").replace(ANY_TAG_PATTERN, "");
}

/**
 * Split cleaned text into paragraphs. Each non-empty line becomes its own
 * paragraph block — predictable for book text where the source parser already
 * separates paragraphs with newlines. All XML/HTML tags are stripped, but
 * their inner text is preserved (so `<chapter_detail>真实正文</chapter_detail>`
 * yields the body text, not an empty string).
 */
export function toParagraphs(input: string): BookParagraph[] {
  const cleaned = String(input || "")
    .replace(/\r/g, "")
    .replace(ANY_TAG_PATTERN, "")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  return cleaned;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
  return String(block.match(re)?.[1] || "").trim();
}

function chapterBody(block: string): BookParagraph[] {
  // Drop metadata tags (with their content) so the title/range/summary don't
  // reappear in the body, then unwrap any remaining tags (incl. chapter_detail,
  // which carries the body text) and split into paragraphs. toParagraphs keeps
  // the inner text of every remaining tag, so the body is never lost here.
  const withoutMetadata = block.replace(METADATA_TAG_PATTERN, "");
  return toParagraphs(withoutMetadata);
}

/**
 * Parse raw book content (which may carry `<chapter>` XML markup for the
 * bookinfo/bookdetail modes) into a renderable structure. For `text` mode or
 * any content without chapter blocks, returns a flat paragraph list. All XML
 * tags are stripped so readers never see angle-bracket markup.
 */
export function parseBookContent(
  content: string | undefined | null,
  mode: BookContentMode,
): ParsedBookContent {
  const source = String(content || "").trim();
  if (!source) {
    return { kind: "paragraphs", paragraphs: [] };
  }

  if (mode === "bookinfo" || mode === "bookdetail") {
    const chapters: BookChapter[] = [];
    const blockPattern = /<chapter(?:\s[^>]*)?>([\s\S]*?)<\/chapter>/gi;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockPattern.exec(source))) {
      const block = String(blockMatch[0] || "");
      const name = extractTag(block, "chapter_name");
      const range = extractTag(block, "chapter_range");
      const summary = extractTag(block, "chapter_summary");
      const paragraphs = chapterBody(block);
      if (!name && !range && paragraphs.length === 0) {
        continue;
      }
      chapters.push({
        index: chapters.length,
        name,
        range,
        summary: summary || undefined,
        detailXml: block,
        paragraphs,
      });
    }

    if (chapters.length > 0) {
      // Top-level fallback: if every chapter body ended up empty (unexpected
      // structure), don't show titles with no text — flatten the whole source.
      const anyBody = chapters.some((c) => c.paragraphs.length > 0);
      if (anyBody) {
        return { kind: "chapters", chapters };
      }
      const flat = toParagraphs(source);
      if (flat.length > 0) {
        return { kind: "paragraphs", paragraphs: flat };
      }
      // Keep the chapters (with names) as a last resort so the page isn't blank.
      return { kind: "chapters", chapters };
    }
  }

  return { kind: "paragraphs", paragraphs: toParagraphs(source) };
}

/** First chapter (if any) — used by the reader for chapter-progress context. */
export function firstChapterOf(parsed: ParsedBookContent): BookChapter | null {
  return parsed.kind === "chapters" && parsed.chapters.length > 0
    ? parsed.chapters[0]
    : null;
}
