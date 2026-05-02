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
  const final = extractTag(raw, "FINAL");
  return {
    thinkingTitle: extractTag(raw, "THINKING_TITLE"),
    thinking: extractTag(raw, "THINKING"),
    final: final || raw.trim(),
  };
}
