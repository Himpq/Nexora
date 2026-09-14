// ExaMedia.ets - Exa Web Search 结果媒体归一化
// 与 NexoraWeb stream/exaMedia.ts 对齐：display_media 优先，老会话从原始 results 兜底，
// 画廊图片只接受 https 外链，展示文本移除独立 Markdown 图片行

import { Json } from './JsonUtil';

export interface ExaImageItem {
    imageUrl: string;
    title: string;
    sourceUrl: string;
}

export interface ExaImageGallery {
    query: string;
    items: ExaImageItem[];
}

// 工具名判定：容忍空格与连字符写法
export function isExaWebSearchToolName(toolName: string): boolean {
    const compact: string = toolName.trim().replace(/[\s-]/g, '_').toLowerCase();

    return compact === 'exa_web_search';
}

// 只接受可直接展示的 https 图片地址
function normalizeImageUrl(raw: string): string {
    const value: string = raw.trim();

    return value.startsWith('https://') ? value : '';
}

// 来源链接允许常规 http/https 页面地址
function normalizeSourceUrl(raw: string): string {
    const value: string = raw.trim();

    if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }

    return '';
}

// 原始媒体条目 → 画廊条目：去重、过滤与规范化在同一个入口完成
function buildGallery(query: string, rawItems: Object[]): ExaImageGallery | null {
    const items: ExaImageItem[] = [];
    const seen: Set<string> = new Set();

    for (let i: number = 0; i < rawItems.length; i++) {
        const rawItem: Object = rawItems[i];

        if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
            continue;
        }

        const record: Record<string, Object> = rawItem as Record<string, Object>;
        const rawImage: string = Json.string(record, 'image_url').length > 0
            ? Json.string(record, 'image_url')
            : Json.string(record, 'image');
        const imageUrl: string = normalizeImageUrl(rawImage);

        if (imageUrl.length === 0 || seen.has(imageUrl)) {
            continue;
        }

        seen.add(imageUrl);

        const rawSource: string = Json.string(record, 'source_url').length > 0
            ? Json.string(record, 'source_url')
            : Json.string(record, 'url');

        items.push({
            imageUrl: imageUrl,
            title: Json.string(record, 'title').trim(),
            sourceUrl: normalizeSourceUrl(rawSource)
        });
    }

    if (items.length === 0) {
        return null;
    }

    return { query: query.trim(), items: items };
}

// 读取结构化 display_media（type=exa_image_gallery）
export function readExaImageGallery(raw: Object | null): ExaImageGallery | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }

    const record: Record<string, Object> = raw as Record<string, Object>;

    if (Json.string(record, 'type') !== 'exa_image_gallery') {
        return null;
    }

    return buildGallery(Json.string(record, 'query'), Json.array(record, 'items'));
}

// 从 Exa 原始结果读取画廊：历史消息没有 display_media 时继续展示图片
export function readExaImageGalleryFromResult(rawResult: string): ExaImageGallery | null {
    const payload: Record<string, Object> | null = Json.parseObject(rawResult);

    if (payload === null) {
        return null;
    }

    const structured: ExaImageGallery | null = readExaImageGallery(Json.fieldOrNull(payload, 'display_media'));

    if (structured !== null) {
        return structured;
    }

    if (Json.fieldOrNull(payload, 'success') === false) {
        return null;
    }

    return buildGallery(Json.string(payload, 'query'), Json.array(payload, 'results'));
}

// 独立 Markdown 图片行判定：整行只有一个 https 图片引用
function isStandaloneImageLine(line: string): boolean {
    const trimmed: string = line.trim();

    if (!trimmed.startsWith('![')) {
        return false;
    }

    const bracket: number = trimmed.indexOf('](');

    if (bracket < 0 || !trimmed.endsWith(')')) {
        return false;
    }

    const url: string = trimmed.substring(bracket + 2, trimmed.length - 1).trim();

    return url.startsWith('https://');
}

// 删除展示文本中的独立 Markdown 图片行，保留搜索文字与来源
export function stripExaImageMarkdown(markdownText: string): string {
    if (markdownText.length === 0) {
        return '';
    }

    const lines: string[] = markdownText.replace(/\r\n/g, '\n').split('\n');
    const kept: string[] = [];

    for (let i: number = 0; i < lines.length; i++) {
        if (!isStandaloneImageLine(lines[i])) {
            kept.push(lines[i]);
        }
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
