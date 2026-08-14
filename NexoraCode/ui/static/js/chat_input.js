/**
 * chat_input.js — 输入文本工具函数
 *
 * 职责：不可见字符清理 / 中文判定 / Provider 图标回退源归一化；
 *   从 chat.js 批量迁移。纯工具函数，无外部依赖。
 *
 * 设计形态：函数式（无状态）
 */
const INVISIBLE_TEXT_CHARS = [
    String.fromCharCode(0x200B),
    String.fromCharCode(0x200C),
    String.fromCharCode(0x200D),
    String.fromCharCode(0x200E),
    String.fromCharCode(0x200F),
    String.fromCharCode(0x2060),
    String.fromCharCode(0xFEFF),
    String.fromCharCode(0x00AD),
].join('');
const INVISIBLE_TEXT_PATTERN = new RegExp(`[${INVISIBLE_TEXT_CHARS}]`, 'g');
const PRIVATE_USE_AREA_PATTERN = new RegExp(`[${String.fromCharCode(0xE000)}-${String.fromCharCode(0xF8FF)}]`, 'g');
const DIRTY_NOT_EQUAL_PLACEHOLDER = String.fromCharCode(0xE020);
function removeInvisibleTextChars(text) {
    return String(text || '').replace(INVISIBLE_TEXT_PATTERN, '');
}

function isBasicChineseChar(char) {
    const code = String(char || '').charCodeAt(0);

    return code >= 0x4E00 && code <= 0x9FA5;
}

function normalizeProviderIconFallbackSource(text) {
    let cleaned = '';
    let separatorPending = false;

    for (const char of String(text || '')) {
        if (/[0-9a-zA-Z]/.test(char) || isBasicChineseChar(char)) {
            cleaned += char;
            separatorPending = false;
            continue;
        }

        if (!separatorPending) {
            cleaned += ' ';
            separatorPending = true;
        }
    }

    return cleaned.trim();
}
export {
    DIRTY_NOT_EQUAL_PLACEHOLDER,
    INVISIBLE_TEXT_CHARS,
    INVISIBLE_TEXT_PATTERN,
    PRIVATE_USE_AREA_PATTERN,
    isBasicChineseChar,
    normalizeProviderIconFallbackSource,
    removeInvisibleTextChars,
};
