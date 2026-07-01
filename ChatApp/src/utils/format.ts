export function formatCount(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return "0";
  return String(numberValue);
}

export function compactText(value: unknown, maxLength = 120) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, Math.max(0, maxLength));
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Human relative time for feed/comment timestamps.
 *
 * Rules (per product spec):
 * - < 1 minute            → 刚刚
 * - < 1 hour              → x分钟前
 * - < 24 hours            → x小时前
 * Sensible extension beyond 24h:
 * - < 7 days              → x天前
 * - same calendar year    → M月D日
 * - otherwise             → Y年M月D日
 *
 * Accepts seconds (the backend convention) or milliseconds — values below
 * 1e12 are treated as seconds. Empty/invalid/zero → "".
 */
export function formatRelativeTime(timestamp: unknown): string {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";

  const thenMs = numeric < 1e12 ? numeric * 1000 : numeric;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - thenMs) / 1000));

  if (diffSeconds < 60) return "刚刚";

  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;

  const then = new Date(thenMs);
  const month = then.getMonth() + 1;
  const day = then.getDate();
  if (then.getFullYear() === new Date().getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${then.getFullYear()}年${month}月${day}日`;
}
