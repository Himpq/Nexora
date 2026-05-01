export function formatCount(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return "0";
  return String(numberValue);
}

export function compactText(value: unknown, maxLength = 120) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}
