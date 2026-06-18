export type ParsedAssistantResponse = {
  thinkingTitle?: string;
  thinking?: string;
  final: string;
};

function extractTag(raw: string, tag: string) {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = raw.match(pattern);
  return match?.[1]?.trim();
}

export function parseAssistantResponse(rawContent: string): ParsedAssistantResponse {
  const raw = String(rawContent || "");
  const thinkingTitle = extractTag(raw, "THINKING_TITLE");
  const thinking = extractTag(raw, "THINKING");
  const final = extractTag(raw, "FINAL");
  const cleaned = raw
    .replace(/<THINKING_TITLE>[\s\S]*?<\/THINKING_TITLE>/gi, "")
    .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, "")
    .replace(/<FINAL>[\s\S]*?<\/FINAL>/gi, "")
    .trim();
  return {
    thinkingTitle,
    thinking,
    final: final || cleaned || raw.trim(),
  };
}
