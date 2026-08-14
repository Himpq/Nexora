(function () {
    'use strict';

    const MODULE_NAME = 'tools';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Tools 模块');
        }

        return shared;
    }

    function clipExecutionFlowText(text, limit = 96) {
    
        const value = String(text || '').replace(/\s+/g, ' ').trim();
    
    
    
        if (value.length <= limit) {
    
            return value;
    
        }
    
    
    
        return `${value.slice(0, Math.max(0, limit - 1)).trim()}...`;
    
    }
    
    function parseExecutionFlowJson(raw) {
    
        const text = String(raw || '').trim();
    
    
    
        if (!text) {
    
            return null;
    
        }
    
    
    
        try {
    
            const value = JSON.parse(text);
    
            return value && typeof value === 'object' ? value : null;
    
        } catch (_) {
    
            return null;
    
        }
    
    }
    
    function unescapeExecutionFlowJsonFragment(value) {
    
        const text = String(value || '');
    
    
    
        try {
    
            return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
    
        } catch (_) {
    
            return text
    
                .replace(/\\"/g, '"')
    
                .replace(/\\\\/g, '\\')
    
                .replace(/\\n/g, '\n')
    
                .replace(/\\r/g, '\r')
    
                .replace(/\\t/g, '\t');
    
        }
    
    }
    
    function readExecutionFlowJsonStringToken(text, start) {
    
        let i = Number(start || 0);
    
        let value = '';
    
        let escaped = false;
    
    
    
        if (text[i] !== '"') {
    
            return { ok: false, closed: false, value: '', next: i };
    
        }
    
    
    
        i += 1;
    
    
    
        while (i < text.length) {
    
            const ch = text[i];
    
    
    
            if (escaped) {
    
                value += `\\${ch}`;
    
                escaped = false;
    
                i += 1;
    
                continue;
    
            }
    
    
    
            if (ch === '\\') {
    
                escaped = true;
    
                i += 1;
    
                continue;
    
            }
    
    
    
            if (ch === '"') {
    
                return {
    
                    ok: true,
    
                    closed: true,
    
                    value: unescapeExecutionFlowJsonFragment(value),
    
                    next: i + 1
    
                };
    
            }
    
    
    
            value += ch;
    
            i += 1;
    
        }
    
    
    
        return {
    
            ok: true,
    
            closed: false,
    
            value: unescapeExecutionFlowJsonFragment(value),
    
            next: i
    
        };
    
    }
    
    function parseExecutionFlowPartialJson(raw) {
    
        const text = String(raw || '').trim();
    
    
    
        if (!text.startsWith('{')) {
    
            return {};
    
        }
    
    
    
        const out = {};
    
        let i = 1;
    
    
    
        while (i < text.length) {
    
            while (i < text.length && /[\s,]/.test(text[i])) i += 1;
    
            if (i >= text.length || text[i] === '}') break;
    
            if (text[i] !== '"') break;
    
    
    
            const keyToken = readExecutionFlowJsonStringToken(text, i);
    
            if (!keyToken.ok || !keyToken.closed) break;
    
            const key = String(keyToken.value || '').trim();
    
            i = keyToken.next;
    
    
    
            while (i < text.length && /\s/.test(text[i])) i += 1;
    
            if (text[i] !== ':') break;
    
            i += 1;
    
            while (i < text.length && /\s/.test(text[i])) i += 1;
    
            if (!key || i >= text.length) break;
    
    
    
            if (text[i] === '"') {
    
                const valueToken = readExecutionFlowJsonStringToken(text, i);
    
                if (valueToken.ok && String(valueToken.value || '').trim()) {
    
                    out[key] = String(valueToken.value || '');
    
                }
    
                i = valueToken.next;
    
                continue;
    
            }
    
    
    
            let valueStart = i;
    
            let depth = 0;
    
            let inString = false;
    
            let escaped = false;
    
    
    
            while (i < text.length) {
    
                const ch = text[i];
    
    
    
                if (inString) {
    
                    if (escaped) {
    
                        escaped = false;
    
                    } else if (ch === '\\') {
    
                        escaped = true;
    
                    } else if (ch === '"') {
    
                        inString = false;
    
                    }
    
                    i += 1;
    
                    continue;
    
                }
    
    
    
                if (ch === '"') {
    
                    inString = true;
    
                    i += 1;
    
                    continue;
    
                }
    
    
    
                if (ch === '{' || ch === '[') {
    
                    depth += 1;
    
                    i += 1;
    
                    continue;
    
                }
    
    
    
                if (ch === '}' || ch === ']') {
    
                    if (depth <= 0) break;
    
                    depth -= 1;
    
                    i += 1;
    
                    continue;
    
                }
    
    
    
                if (ch === ',' && depth === 0) break;
    
                i += 1;
    
            }
    
    
    
            const rawValue = text.slice(valueStart, i).trim();
    
            if (rawValue && !/^[{\[]/.test(rawValue)) {
    
                out[key] = rawValue.replace(/,$/, '').trim();
    
            }
    
        }
    
    
    
        return out;
    
    }
    
    function basenameForExecutionFlow(value) {
    
        const text = String(value || '').trim();
    
    
    
        if (!text) {
    
            return '';
    
        }
    
    
    
        const cleaned = text.replace(/^file:\/\//i, '');
    
        const parts = cleaned.split(/[\\/]+/).filter(Boolean);
    
        return parts.length > 0 ? parts[parts.length - 1] : cleaned;
    
    }
    
    function hostForExecutionFlow(value) {
    
        const text = String(value || '').trim();
    
    
    
        if (!text) {
    
            return '';
    
        }
    
    
    
        try {
    
            const url = new URL(text);
    
            return url.hostname || text;
    
        } catch (_) {
    
            return text.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || text;
    
        }
    
    }
    
    function readExecutionFlowArg(args, names) {
    
        const source = args && typeof args === 'object' ? args : {};
    
    
    
        for (const name of names) {
    
            const value = source[name];
    
    
    
            if (value !== undefined && value !== null && String(value).trim()) {
    
                return String(value).trim();
    
            }
    
        }
    
    
    
        return '';
    
    }
    
    function buildFileToolRunningDisplay(toolName, args = {}) {
    
        const name = String(toolName || '').trim();
    
        const compact = name.replace(/[\s_-]+/g, '').toLowerCase();
    
    
    
        if (!compact.includes('file')) {
    
            return null;
    
        }
    
    
    
        const path = readExecutionFlowArg(args, ['path', 'file_path', 'file', 'sandbox_path', 'target_path']);
    
        const content = args && args.content !== undefined && args.content !== null ? String(args.content) : '';
    
        const replacement = args && args.replacement !== undefined && args.replacement !== null ? String(args.replacement) : '';
    
        const oldText = args && args.old_text !== undefined && args.old_text !== null ? String(args.old_text) : '';
    
        const newText = args && args.new_text !== undefined && args.new_text !== null ? String(args.new_text) : '';
    
        const patchText = args && args.patch !== undefined && args.patch !== null ? String(args.patch) : '';
    
        const edits = Array.isArray(args && args.edits) ? args.edits : [];
    
    
    
        if (compact.includes('filewrite') || compact.includes('filecreate')) {
    
            const writeMode = content
    
                ? 'overwrite'
    
                : replacement
    
                ? 'line_replace'
    
                : (oldText || newText)
    
                ? 'text_replace'
    
                : 'prepare';
    
            const statusText = compact.includes('filecreate') ? '准备创建文件' : '准备写入文件';
    
            const lines = [
    
                statusText,
    
                `path: ${path || '(未提供)'}`,
    
                `mode: ${writeMode}`
    
            ];
    
    
    
            if (content) {
    
                lines.push(`content_chars: ${content.length}`);
    
            }
    
    
    
            if (replacement) {
    
                lines.push(`replacement_chars: ${replacement.length}`);
    
            }
    
    
    
            if (oldText || newText) {
    
                lines.push(`old_text_chars: ${oldText.length}`);
    
                lines.push(`new_text_chars: ${newText.length}`);
    
            }
    
    
    
            return {
    
                statusText,
    
                progressText: lines.join('\n')
    
            };
    
        }
    
    
    
        if (compact.includes('filepatch')) {
    
            const confirmPreviewId = readExecutionFlowArg(args, ['confirm_preview_id']);
    
            const dryRun = !!(args && args.dry_run);
    
            const mode = confirmPreviewId ? 'confirm' : dryRun ? 'dry_run' : 'prepare';
    
            const statusText = confirmPreviewId ? '准备确认写入 patch' : '准备生成 patch 预览';
    
            const lines = [
    
                statusText,
    
                `path: ${path || '(未提供)'}`,
    
                `mode: ${mode}`
    
            ];
    
    
    
            if (edits.length > 0) {
    
                lines.push(`edit_count: ${edits.length}`);
    
            }
    
    
    
            if (patchText) {
    
                lines.push(`patch_chars: ${patchText.length}`);
    
            }
    
    
    
            if (confirmPreviewId) {
    
                lines.push(`confirm_preview_id: ${confirmPreviewId}`);
    
            }
    
    
    
            return {
    
                statusText,
    
                progressText: lines.join('\n')
    
            };
    
        }
    
    
    
        return null;
    
    }
    
    function getExecutionFlowArgs(row) {
    
        if (!row) {
    
            return {};
    
        }
    
    
    
        const parsed = parseExecutionFlowJson(row.dataset.argsRaw || '');
    
        return parsed || parseExecutionFlowPartialJson(row.dataset.argsRaw || '') || {};
    
    }
    
    function getExecutionFlowPhaseText(rawStatus) {
    
        const text = String(rawStatus || '').trim();
    
    
    
        if (!text) {
    
            return '';
    
        }
    
    
    
        if (/参数|构建|准备/.test(text)) {
    
            return '准备中';
    
        }
    
    
    
        if (/执行中|运行中|搜索中|打开中/.test(text)) {
    
            return '执行中';
    
        }
    
    
    
        if (/完成|成功|done|completed/i.test(text)) {
    
            return '完成';
    
        }
    
    
    
        return clipExecutionFlowText(text.replace(/^[\w.-]+\s*/, '').replace(/:$/, ''), 28);
    
    }
    
    function parseExecutionFlowPayload(raw) {
    
        if (raw && typeof raw === 'object') {
    
            return raw;
    
        }
    
    
    
        const text = String(raw || '').trim();
    
    
    
        if (!text) {
    
            return null;
    
        }
    
    
    
        try {
    
            return JSON.parse(text);
    
        } catch (_) {
    
            return null;
    
        }
    
    }
    
    function unwrapExecutionFlowPayload(payload) {
    
        let current = payload;
    
        const wrapperKeys = new Set([
    
            'success',
    
            'result',
    
            'error',
    
            'message',
    
            'traceback',
    
            'elapsed_ms',
    
            'duration_ms',
    
            'request_id'
    
        ]);
    
    
    
        for (let i = 0; i < 2; i += 1) {
    
            if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, 'result')) {
    
                break;
    
            }
    
    
    
            const keys = Object.keys(current);
    
            const looksWrapped = keys.length > 0 && keys.every((key) => wrapperKeys.has(key));
    
    
    
            if (!looksWrapped) {
    
                break;
    
            }
    
    
    
            const inner = current.result;
    
            const parsedInner = parseExecutionFlowPayload(inner);
    
            current = parsedInner !== null ? parsedInner : inner;
    
        }
    
    
    
        return current;
    
    }
    
    function normalizeExecutionFlowCount(value) {
    
        if (value === undefined || value === null || value === '') {
    
            return null;
    
        }
    
    
    
        const match = String(value).replace(/,/g, '').match(/\d+/);
    
        const count = match ? Number.parseInt(match[0], 10) : Number.NaN;
    
    
    
        return Number.isFinite(count) && count >= 0 ? count : null;
    
    }
    
    function readExecutionFlowMarkdownCount(markdownText, fieldNames) {
    
        const fields = Array.isArray(fieldNames) ? fieldNames : [];
    
    
    
        for (const field of fields) {
    
            const raw = extractMarkdownField(markdownText, field);
    
            const count = normalizeExecutionFlowCount(raw);
    
    
    
            if (count !== null) {
    
                return count;
    
            }
    
        }
    
    
    
        return null;
    
    }
    
    function readExecutionFlowPayloadPath(payload, path) {
    
        const parts = String(path || '').split('.').filter(Boolean);
    
        let current = payload;
    
    
    
        for (const part of parts) {
    
            if (!current || typeof current !== 'object') {
    
                return undefined;
    
            }
    
    
    
            current = current[part];
    
        }
    
    
    
        return current;
    
    }
    
    function readExecutionFlowPayloadCount(payload, numberKeys = [], arrayKeys = []) {
    
        const data = unwrapExecutionFlowPayload(payload);
    
    
    
        if (Array.isArray(data)) {
    
            return data.length;
    
        }
    
    
    
        if (!data || typeof data !== 'object') {
    
            return null;
    
        }
    
    
    
        for (const key of numberKeys) {
    
            const count = normalizeExecutionFlowCount(readExecutionFlowPayloadPath(data, key));
    
    
    
            if (count !== null) {
    
                return count;
    
            }
    
        }
    
    
    
        for (const key of arrayKeys) {
    
            const value = readExecutionFlowPayloadPath(data, key);
    
    
    
            if (Array.isArray(value)) {
    
                return value.length;
    
            }
    
        }
    
    
    
        return null;
    
    }
    
    function readExecutionFlowResultCount(markdownText, resultText, markdownFields, numberKeys, arrayKeys) {
    
        const fromMarkdown = readExecutionFlowMarkdownCount(markdownText, markdownFields);
    
    
    
        if (fromMarkdown !== null) {
    
            return fromMarkdown;
    
        }
    
    
    
        return readExecutionFlowPayloadCount(parseExecutionFlowPayload(resultText), numberKeys, arrayKeys);
    
    }
    
    function readExecutionFlowResultText(markdownText, resultText, markdownFields, payloadPaths) {
    
        const fields = Array.isArray(markdownFields) ? markdownFields : [];
    
    
    
        for (const field of fields) {
    
            const value = extractMarkdownField(markdownText, field);
    
    
    
            if (value) {
    
                return value;
    
            }
    
        }
    
    
    
        const data = unwrapExecutionFlowPayload(parseExecutionFlowPayload(resultText));
    
        const paths = Array.isArray(payloadPaths) ? payloadPaths : [];
    
    
    
        for (const path of paths) {
    
            const value = readExecutionFlowPayloadPath(data, path);
    
    
    
            if (value !== undefined && value !== null && String(value).trim()) {
    
                return String(value).trim();
    
            }
    
        }
    
    
    
        return '';
    
    }
    
    function appendExecutionFlowCount(text, count, unit) {
    
        return count !== null ? `${text} 获取到${count}${unit}` : text;
    
    }
    
    function buildChineseToolAction(toolName, args = {}, markdownText = '', resultText = '', row = null) {
    
        const name = String(toolName || '').trim();
    
        const compact = name.replace(/[\s_-]+/g, '').toLowerCase();
    
        const markdown = String(markdownText || '');
    
        const result = String(resultText || '');
    
        const fileFromMarkdown = extractMarkdownField(markdown, 'File');
    
        const commandFromMarkdown = extractMarkdownField(markdown, 'Command');
    
        const title = extractMarkdownTitle(markdown);
    
        const path = readExecutionFlowArg(args, ['path', 'file', 'file_path', 'filepath', 'sandbox_path', 'target_path']);
    
        const url = readExecutionFlowArg(args, ['url', 'href', 'page_url']);
    
        const query = readExecutionFlowArg(args, ['query', 'keyword', 'q']) || String((row && row.dataset.query) || '').trim();
    
        const command = readExecutionFlowArg(args, ['command', 'cmd']) || commandFromMarkdown;
    
        const objectTitle = readExecutionFlowArg(args, ['title', 'name', 'key']);
    
        const fileName = basenameForExecutionFlow(fileFromMarkdown || path);
    
        const urlHost = hostForExecutionFlow(url);
    
    
    
        if (compact === 'memoryprofileread' || compact === 'getuserprofilememory' || compact === 'memoryread') {
    
            return '读取用户画像';
    
        }
    
    
    
        if (compact.includes('memory') && (compact.includes('update') || compact.includes('write') || compact.includes('append'))) {
    
            return '写入用户画像';
    
        }
    
    
    
        if (compact.includes('localfileprobe') || /local file probe/i.test(title)) {
    
            return fileName ? `探测文件 ${fileName}` : '探测文件';
    
        }
    
    
    
        if (compact.includes('filecreate')) {
    
            return fileName ? `创建文件 ${fileName}` : '创建文件';
    
        }
    
    
    
        if (compact.includes('fileread') || /file read/i.test(title)) {
    
            return fileName ? `读取文件 ${fileName}` : '读取文件';
    
        }
    
    
    
        if (compact.includes('filewrite') || /file written/i.test(title)) {
    
            return fileName ? `写入文件 ${fileName}` : '写入文件';
    
        }
    
    
    
        if (compact.includes('filepatch') || /file patch preview|file modified/i.test(title)) {
    
            if (/preview/i.test(title) || /preview_id/i.test(result)) {
    
                return fileName ? `预览文件修改 ${fileName}` : '预览文件修改';
    
            }
    
    
    
            return fileName ? `写入文件 ${fileName}` : '写入文件';
    
        }
    
    
    
        if (compact.includes('filelist')) {
    
            return fileName ? `读取目录 ${fileName}` : '读取目录';
    
        }
    
    
    
        if (compact.includes('filefind') || compact.includes('filesearch')) {
    
            return fileName ? `查找文件 ${fileName}` : '查找文件';
    
        }
    
    
    
        if (compact.includes('fileremove') || compact.includes('filedelete')) {
    
            return fileName ? `删除文件 ${fileName}` : '删除文件';
    
        }
    
    
    
        if (compact.includes('browserpageopen') || compact.includes('webrender') || compact.includes('openpage')) {
    
            return urlHost ? `打开网页 ${urlHost}` : '打开网页';
    
        }
    
    
    
        if (compact.includes('browserpageread') || compact.includes('webgetcontent') || compact.includes('readpage')) {
    
            return urlHost ? `读取网页 ${urlHost}` : '读取网页';
    
        }
    
    
    
        if (compact.includes('browserpageclick') || compact.includes('webclick')) {
    
            return '点击网页元素';
    
        }
    
    
    
        if (compact.includes('browserpageinput') || compact.includes('webinput')) {
    
            return '输入网页内容';
    
        }
    
    
    
        if (compact.includes('browserpageeval') || compact.includes('webexecjs')) {
    
            return '执行网页脚本';
    
        }
    
    
    
        if (compact.includes('browserpagescroll')) {
    
            return '滚动网页';
    
        }
    
    
    
        if (compact.includes('browserpagelist')) {
    
            return '读取浏览器页面';
    
        }
    
    
    
        if (compact.includes('shell') || compact.includes('terminal')) {
    
            return command ? `执行命令 ${clipExecutionFlowText(command, 34)}` : '执行命令';
    
        }
    
    
    
        if (compact.includes('websearch') || compact.includes('searchkeyword') || compact === 'websearchmeta') {
    
            return query ? `搜索网页 ${clipExecutionFlowText(query, 34)}` : '搜索网页';
    
        }
    
    
    
        if (compact.includes('imagesearch')) {
    
            return query ? `搜索图片 ${clipExecutionFlowText(query, 34)}` : '搜索图片';
    
        }
    
    
    
        if (compact.includes('generateimage')) {
    
            return '生成图片';
    
        }
    
    
    
        if (compact.includes('contextcompression')) {
    
            return '压缩上下文';
    
        }
    
    
    
        if (compact.includes('contextread') || compact === 'getcontext') {
    
            return '读取长上下文';
    
        }
    
    
    
        if (compact.includes('contextclear') || compact === 'clearcontext') {
    
            return '清理上下文';
    
        }
    
    
    
        if (compact === 'knowledgelist') {
    
            const count = readExecutionFlowResultCount(
    
                markdown,
    
                result,
    
                ['Total', 'Results', 'Items'],
    
                ['total', 'count', 'results'],
    
                ['items', 'results']
    
            );
    
            return appendExecutionFlowCount('读取知识库信息', count, '条信息');
    
        }
    
    
    
        if (compact.includes('knowledgegraphread')) {
    
            return '读取知识图谱';
    
        }
    
    
    
        if (compact.includes('knowledgesearch') || compact.includes('searchknowledge')) {
    
            const count = readExecutionFlowResultCount(
    
                markdown,
    
                result,
    
                ['Results', 'Matched', 'Total', 'Articles', 'Returned'],
    
                ['results', 'matched', 'total', 'returned', 'count'],
    
                ['items', 'matches', 'articles', 'results']
    
            );
    
            const base = query ? `搜索知识库 ${clipExecutionFlowText(query, 34)}` : '搜索知识库';
    
            return appendExecutionFlowCount(base, count, '条信息');
    
        }
    
    
    
        if (compact.includes('knowledgebasisread')) {
    
            const count = readExecutionFlowResultCount(
    
                markdown,
    
                result,
    
                ['Matched', 'Results', 'Total'],
    
                ['matched', 'total', 'count'],
    
                ['matches', 'items', 'results']
    
            );
    
            if (count !== null && (/knowledge content matches/i.test(title) || /Matched:/i.test(markdown))) {
    
                return appendExecutionFlowCount('读取知识库信息', count, '条信息');
    
            }
    
    
    
            return objectTitle ? `读取知识库信息 ${clipExecutionFlowText(objectTitle, 34)}` : '读取知识库信息';
    
        }
    
    
    
        if (compact.includes('knowledge') && (compact.includes('create') || compact.includes('update') || compact.includes('delete') || compact.includes('link'))) {
    
            return objectTitle ? `写入知识库 ${clipExecutionFlowText(objectTitle, 34)}` : '写入知识库';
    
        }
    
    
    
        const isMailTool = compact.includes('email') || compact.includes('mail');
    
    
    
        if (isMailTool && compact.includes('send')) {
    
            const subject = readExecutionFlowArg(args, ['subject', 'title'])
    
                || readExecutionFlowResultText(markdown, result, ['Subject', 'Title'], ['subject', 'title']);
    
            return subject ? `发送邮件 ${clipExecutionFlowText(subject, 34)}` : '发送邮件';
    
        }
    
    
    
        if (isMailTool && compact.includes('list')) {
    
            const count = readExecutionFlowResultCount(
    
                markdown,
    
                result,
    
                ['Total', 'Results', 'Mails', 'Emails'],
    
                ['total', 'count', 'results'],
    
                ['mails', 'emails', 'items']
    
            );
    
            return appendExecutionFlowCount('读取邮件', count, '封邮件');
    
        }
    
    
    
        if (isMailTool && (compact.includes('get') || compact.includes('read'))) {
    
            const mailTitle = readExecutionFlowResultText(
    
                markdown,
    
                result,
    
                ['Subject', 'Title'],
    
                ['mail.subject', 'mail.title', 'subject', 'title']
    
            );
    
            const mailId = readExecutionFlowArg(args, ['mail_id', 'id']);
    
            const label = mailTitle || mailId;
    
            return label ? `读取邮件内容 打开邮件 ${clipExecutionFlowText(label, 42)}` : '读取邮件内容';
    
        }
    
    
    
        if (compact.includes('read') || compact.includes('get') || compact.includes('list')) {
    
            return '读取信息';
    
        }
    
    
    
        if (compact.includes('write') || compact.includes('update') || compact.includes('create') || compact.includes('delete') || compact.includes('save')) {
    
            return '写入信息';
    
        }
    
    
    
        if (compact.includes('search') || compact.includes('find')) {
    
            return '搜索信息';
    
        }
    
    
    
        return '执行工具';
    
    }
    
    function setToolUsagePrimaryText(row, text) {
    
        if (!row) return;
    
    
    
        const titleEl = row.querySelector('.tool-name');
    
    
    
        if (titleEl) {
    
            const value = text || '执行工具';
    
            titleEl.textContent = clipExecutionFlowText(value, 96);
    
            titleEl.title = value;
    
        }
    
    }
    
    function getToolExecutionFlowKind(toolName) {
    
        const compact = String(toolName || '').trim().replace(/[\s_-]+/g, '').toLowerCase();
    
    
    
        if (!compact) return 'tool';
    
        if (compact.includes('error')) return 'error';
    
        if (compact.includes('file') || compact.includes('patch')) return 'file';
    
        if (compact.includes('shell') || compact.includes('terminal') || compact.includes('exec')) return 'shell';
    
        if (compact.includes('search') || compact.includes('web')) return 'web';
    
        if (compact.includes('browser') || compact.includes('page')) return 'browser';
    
        if (compact.includes('context') || compact.includes('compression')) return 'context';
    
        if (compact.includes('image')) return 'image';
    
        if (compact.includes('knowledge') || compact.includes('memory')) return 'knowledge';
    
    
    
        return 'tool';
    
    }
    
    function applyToolExecutionFlowKind(row, toolName) {
    
        if (!row) return;
    
    
    
        const kind = getToolExecutionFlowKind(toolName);
    
        row.classList.add('execution-flow-item');
    
        row.dataset.flowKind = kind;
    
    }
    
    function cleanExecutionFlowMarkdownValue(value) {
    
        return String(value || '')
    
            .replace(/`/g, '')
    
            .replace(/\*\*/g, '')
    
            .trim();
    
    }
    
    function extractMarkdownField(markdownText, fieldName) {
    
        const name = String(fieldName || '').trim().toLowerCase();
    
        const lines = String(markdownText || '').split(/\r?\n/);
    
    
    
        for (const line of lines) {
    
            const idx = line.indexOf(':');
    
    
    
            if (idx <= 0) {
    
                continue;
    
            }
    
    
    
            const key = line.slice(0, idx).replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim().toLowerCase();
    
    
    
            if (key === name) {
    
                return cleanExecutionFlowMarkdownValue(line.slice(idx + 1));
    
            }
    
        }
    
    
    
        return '';
    
    }
    
    function extractMarkdownTitle(markdownText) {
    
        const lines = String(markdownText || '').split(/\r?\n/);
    
    
    
        for (const line of lines) {
    
            const value = line.trim();
    
    
    
            if (value.startsWith('## ')) {
    
                return cleanExecutionFlowMarkdownValue(value.replace(/^#+\s*/, ''));
    
            }
    
        }
    
    
    
        return '';
    
    }
    
    function readPatchLineStats(markdownText) {
        const linesValue = extractMarkdownField(markdownText, 'Lines');
        const match = String(linesValue || '').match(/^\+(\d+)\s*\/\s*-(\d+)$/);

        if (!match) {
            return null;
        }

        return {
            added: Number(match[1]),
            removed: Number(match[2])
        };
    }

    function renderToolUsageChangeStats(row, markdownText) {
        if (!row) return;

        const statusEl = row.querySelector('.tool-status');

        if (!statusEl) return;

        const stats = readPatchLineStats(markdownText);
        statusEl.classList.toggle('has-change-stats', !!stats);

        if (!stats) {
            statusEl.textContent = '完成';
            statusEl.title = '完成';
            return;
        }

        const documentRef = row.ownerDocument;
        const addedEl = documentRef.createElement('span');
        const removedEl = documentRef.createElement('span');
        addedEl.className = 'tool-change-count is-added';
        removedEl.className = 'tool-change-count is-removed';
        addedEl.textContent = `+${stats.added}`;
        removedEl.textContent = `-${stats.removed}`;
        statusEl.replaceChildren(addedEl, removedEl);
        statusEl.title = `新增 ${stats.added} 行，删除 ${stats.removed} 行`;
    }

    function collapseResolvedToolUsages(root, exceptRow = null) {
        if (!root || typeof root.querySelectorAll !== 'function') return;

        root.querySelectorAll('.tool-usage.execution-flow-item.expanded').forEach((row) => {
            if (row === exceptRow) return;
            if (row.dataset.resolved !== 'true') return;
            if (row.dataset.userToggled === 'true') return;
            if (row.classList.contains('is-running')) return;
            row.classList.remove('expanded');
        });
    }

    function buildToolResultSummaryFromMarkdown(toolName, markdownText) {
    
        const title = extractMarkdownTitle(markdownText);
    
        const file = extractMarkdownField(markdownText, 'File');
    
        const changed = extractMarkdownField(markdownText, 'Changed');
    
        const mode = extractMarkdownField(markdownText, 'Mode');
    
        const size = extractMarkdownField(markdownText, 'Size');
    
        const lines = extractMarkdownField(markdownText, 'Lines');
    
        const previewId = extractMarkdownField(markdownText, 'Preview ID');
    
        const encodingHint = extractMarkdownField(markdownText, 'Encoding Hint');
    
        const exitCode = extractMarkdownField(markdownText, 'Exit Code');
    
        const command = extractMarkdownField(markdownText, 'Command');
    
    
    
        if (/file patch preview/i.test(title)) {
    
            return clipExecutionFlowText(['Patch 预览', file, lines, previewId].filter(Boolean).join(' · '));
    
        }
    
    
    
        if (/file modified/i.test(title)) {
    
            return clipExecutionFlowText(['写入完成', file, changed ? `changed=${changed}` : '', lines].filter(Boolean).join(' · '));
    
        }
    
    
    
        if (/local file probe/i.test(title)) {
    
            return clipExecutionFlowText(['探测文件', file, encodingHint, size].filter(Boolean).join(' · '));
    
        }
    
    
    
        if (/file read/i.test(title)) {
    
            return clipExecutionFlowText(['读取文件', file, mode, size].filter(Boolean).join(' · '));
    
        }
    
    
    
        if (/shell command/i.test(title)) {
    
            return clipExecutionFlowText(['Shell', exitCode ? `exit=${exitCode}` : '', command].filter(Boolean).join(' · '));
    
        }
    
    
    
        return clipExecutionFlowText(title || toolName || '工具完成');
    
    }
    
    function updateToolUsageResultSummary(row, toolName, result, markdownText, resultText = '') {
    
        if (!row) return;
    
    
    
        const args = getExecutionFlowArgs(row);
    
        const primaryText = buildChineseToolAction(toolName, args, markdownText, resultText, row);
    
        setToolUsagePrimaryText(row, primaryText);
    
    
    
        renderToolUsageChangeStats(row, markdownText);
    
    }

    function findToolUsage(parent, name, callId, pendingOnly = false) {
        const targetName = String(name || '').trim();
        const targetCallId = String(callId || '').trim();
        const rows = parent.querySelectorAll('.tool-usage');
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (pendingOnly && row.dataset.pending !== 'true') continue;
            if (targetCallId && row.dataset.callId === targetCallId) return row;
            if (!targetCallId && targetName && row.dataset.toolName === targetName) return row;
        }
        return null;
    }
    
    function findToolUsageByPhase(parent, name, callId, phase, pendingOnly = false) {
        if (!parent) return null;
        const targetName = String(name || '').trim();
        const targetCallId = String(callId || '').trim();
        const targetPhase = String(phase || '').trim();
        const rows = parent.querySelectorAll('.tool-usage');
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (pendingOnly && row.dataset.pending !== 'true') continue;
            if (targetPhase && String(row.dataset.phase || '').trim() !== targetPhase) continue;
            if (targetCallId && row.dataset.callId === targetCallId) return row;
            if (!targetCallId && targetName && row.dataset.toolName === targetName) return row;
        }
        return null;
    }
    
    function getToolCallState(aiMsgDiv) {
        if (!aiMsgDiv.__toolCallState || typeof aiMsgDiv.__toolCallState !== 'object') {
            aiMsgDiv.__toolCallState = {
                seq: 0,
                pendingByName: {},
                callIdByIndex: {},
                pendingQueue: [],
                explicitIdByLocalId: {},
                activeAnonCallId: '',
                argsDeltaSeenByCallId: {}
            };
        }
        if (!aiMsgDiv.__toolCallState.callIdByIndex || typeof aiMsgDiv.__toolCallState.callIdByIndex !== 'object') {
            aiMsgDiv.__toolCallState.callIdByIndex = {};
        }
        if (!Array.isArray(aiMsgDiv.__toolCallState.pendingQueue)) {
            aiMsgDiv.__toolCallState.pendingQueue = [];
        }
        if (!aiMsgDiv.__toolCallState.explicitIdByLocalId || typeof aiMsgDiv.__toolCallState.explicitIdByLocalId !== 'object') {
            aiMsgDiv.__toolCallState.explicitIdByLocalId = {};
        }
        if (typeof aiMsgDiv.__toolCallState.activeAnonCallId !== 'string') {
            aiMsgDiv.__toolCallState.activeAnonCallId = '';
        }
        if (!aiMsgDiv.__toolCallState.argsDeltaSeenByCallId || typeof aiMsgDiv.__toolCallState.argsDeltaSeenByCallId !== 'object') {
            aiMsgDiv.__toolCallState.argsDeltaSeenByCallId = {};
        }
        return aiMsgDiv.__toolCallState;
    }
    
    function rememberToolArgsDeltaSeen(aiMsgDiv, callId) {
        const id = String(callId || '').trim();
    
        if (!aiMsgDiv || !id) {
            return;
        }
    
        const state = getToolCallState(aiMsgDiv);
        state.argsDeltaSeenByCallId[id] = true;
    }
    
    function hasToolArgsDeltaSeen(aiMsgDiv, callId) {
        const id = String(callId || '').trim();
    
        if (!aiMsgDiv || !id) {
            return false;
        }
    
        const state = getToolCallState(aiMsgDiv);
        return !!state.argsDeltaSeenByCallId[id];
    }
    
    function removePendingToolCallId(state, callId) {
        const id = String(callId || '').trim();
        if (!state || !id) return;
    
        const pendingQueue = Array.isArray(state.pendingQueue) ? state.pendingQueue : [];
        for (let i = pendingQueue.length - 1; i >= 0; i -= 1) {
            if (pendingQueue[i] === id) pendingQueue.splice(i, 1);
        }
    
        const pendingByName = state.pendingByName && typeof state.pendingByName === 'object'
            ? state.pendingByName
            : {};
        Object.keys(pendingByName).forEach((name) => {
            const queue = Array.isArray(pendingByName[name]) ? pendingByName[name] : [];
            for (let i = queue.length - 1; i >= 0; i -= 1) {
                if (queue[i] === id) queue.splice(i, 1);
            }
        });
    }
    
    function rememberPendingToolCallId(aiMsgDiv, callId, toolName) {
        const id = String(callId || '').trim();
        const name = normalizeToolDisplayName(toolName);
        if (!aiMsgDiv || !id || !name) return;
    
        const state = getToolCallState(aiMsgDiv);
        if (!state.pendingByName || typeof state.pendingByName !== 'object') {
            state.pendingByName = {};
        }
    
        if (!Array.isArray(state.pendingByName[name])) {
            state.pendingByName[name] = [];
        }
    
        if (!state.pendingByName[name].includes(id)) {
            state.pendingByName[name].push(id);
        }
    
        if (!Array.isArray(state.pendingQueue)) {
            state.pendingQueue = [];
        }
    
        if (!state.pendingQueue.includes(id)) {
            state.pendingQueue.push(id);
        }
    }
    
    function migratePendingToolCallId(aiMsgDiv, oldCallId, newCallId, toolName) {
        const oldId = String(oldCallId || '').trim();
        const newId = String(newCallId || '').trim();
        const name = normalizeToolDisplayName(toolName);
        if (!aiMsgDiv || !newId) return;
    
        const state = getToolCallState(aiMsgDiv);
        if (oldId && oldId !== newId) {
            removePendingToolCallId(state, oldId);
            state.explicitIdByLocalId[oldId] = newId;
    
            if (state.activeAnonCallId === oldId) {
                state.activeAnonCallId = newId;
            }
        }
    
        rememberPendingToolCallId(aiMsgDiv, newId, name);
    }
    
    function allocateToolCallId(aiMsgDiv, toolName, phase, explicitCallId = '', toolIndex = null) {
        const state = getToolCallState(aiMsgDiv);
        const name = String(toolName || '').trim() || 'tool';
        const explicit = String(explicitCallId || '').trim();
        const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
            ? ''
            : String(Number(toolIndex));
        const pendingByName = state.pendingByName;
        const pendingQueue = state.pendingQueue;
        if (!Array.isArray(pendingByName[name])) pendingByName[name] = [];
        const queue = pendingByName[name];
        const enqueueOnce = (id) => {
            if (!id) return;
            if (!pendingQueue.includes(id)) pendingQueue.push(id);
        };
        const dequeueById = (id) => {
            if (!id) return;
            const qIdx = pendingQueue.indexOf(id);
            if (qIdx >= 0) pendingQueue.splice(qIdx, 1);
        };
    
        if (explicit) {
            if (idxKey) state.callIdByIndex[idxKey] = explicit;
            if (phase === 'result') {
                const idx = queue.indexOf(explicit);
                if (idx >= 0) queue.splice(idx, 1);
                dequeueById(explicit);
                if (state.activeAnonCallId === explicit) state.activeAnonCallId = '';
            } else if (!queue.includes(explicit)) {
                queue.push(explicit);
                enqueueOnce(explicit);
            }
            return explicit;
        }
    
        const createLocalId = () => `local-${++state.seq}`;
        if (idxKey) {
            if (!state.callIdByIndex[idxKey]) {
                state.callIdByIndex[idxKey] = createLocalId();
            }
            const byIndexId = state.callIdByIndex[idxKey];
            if (phase === 'result') {
                const idx = queue.indexOf(byIndexId);
                if (idx >= 0) queue.splice(idx, 1);
                dequeueById(byIndexId);
                if (state.activeAnonCallId === byIndexId) state.activeAnonCallId = '';
            } else if (!queue.includes(byIndexId)) {
                queue.push(byIndexId);
                enqueueOnce(byIndexId);
            }
            return byIndexId;
        }
    
        // No explicit call_id and no index: treat as anonymous stream.
        if (phase === 'delta') {
            if (!state.activeAnonCallId) {
                state.activeAnonCallId = createLocalId();
                if (!queue.includes(state.activeAnonCallId)) queue.push(state.activeAnonCallId);
                enqueueOnce(state.activeAnonCallId);
            }
            return state.activeAnonCallId;
        }
        if (phase === 'call') {
            // Close current anonymous delta stream at function-call boundary.
            if (state.activeAnonCallId) {
                const anonId = state.activeAnonCallId;
                state.activeAnonCallId = '';
                if (!queue.includes(anonId)) queue.push(anonId);
                enqueueOnce(anonId);
                return anonId;
            }
            const id = createLocalId();
            if (!queue.includes(id)) queue.push(id);
            enqueueOnce(id);
            return id;
        }
        if (phase === 'result') {
            let id = '';
            if (queue.length > 0) {
                id = queue.shift();
                dequeueById(id);
                if (state.activeAnonCallId === id) state.activeAnonCallId = '';
                return id;
            }
            if (pendingQueue.length > 0) {
                id = pendingQueue.shift();
                const byNameIdx = queue.indexOf(id);
                if (byNameIdx >= 0) queue.splice(byNameIdx, 1);
                if (state.activeAnonCallId === id) state.activeAnonCallId = '';
                return id;
            }
            if (state.activeAnonCallId) {
                id = state.activeAnonCallId;
                state.activeAnonCallId = '';
                dequeueById(id);
                return id;
            }
            return createLocalId();
        }
        if (phase === 'delta' || phase === 'call') {
            if (queue.length === 0) queue.push(createLocalId());
            enqueueOnce(queue[queue.length - 1]);
            return queue[queue.length - 1];
        }
        return createLocalId();
    }
    
    function normalizeToolDisplayName(name) {
        return String(name || '').trim() || 'tool';
    }
    
    function resolveToolNameFromEvent(data, fallback = '') {
        const src = (data && typeof data === 'object') ? data : {};
        const direct = String(src.name || src.function_name || src.tool_name || '').trim();
        if (direct) return direct;
    
        const funcObj = (src.function && typeof src.function === 'object') ? src.function : null;
        if (funcObj) {
            const n = String(funcObj.name || '').trim();
            if (n) return n;
        }
    
        const toolCallObj = (src.tool_call && typeof src.tool_call === 'object') ? src.tool_call : null;
        const toolCallFunction = toolCallObj && typeof toolCallObj.function === 'object' ? toolCallObj.function : null;
        if (toolCallFunction) {
            const n = String(toolCallFunction.name || '').trim();
            if (n) return n;
        }
    
        const deltaObj = (src.delta && typeof src.delta === 'object') ? src.delta : null;
        const deltaFunction = deltaObj && typeof deltaObj.function === 'object' ? deltaObj.function : null;
        if (deltaFunction) {
            const n = String(deltaFunction.name || '').trim();
            if (n) return n;
        }
    
        const toolCalls = Array.isArray(src.tool_calls) ? src.tool_calls : [];
        for (const call of toolCalls) {
            if (!call || typeof call !== 'object') continue;
            const fn = call.function && typeof call.function === 'object' ? call.function : null;
            const n = String((fn && fn.name) || call.name || '').trim();
            if (n) return n;
        }
    
        const deltaToolCalls = deltaObj && Array.isArray(deltaObj.tool_calls) ? deltaObj.tool_calls : [];
        for (const call of deltaToolCalls) {
            if (!call || typeof call !== 'object') continue;
            const fn = call.function && typeof call.function === 'object' ? call.function : null;
            const n = String((fn && fn.name) || call.name || '').trim();
            if (n) return n;
        }
    
        return String(fallback || '').trim();
    }
    
    function findPendingToolUsageFallback(parent, name, callId = '', toolIndex = null) {
        if (!parent) return null;
        const safeName = normalizeToolDisplayName(name);
        const safeCallId = String(callId || '').trim();
        const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
            ? ''
            : String(Number(toolIndex));
    
        if (safeCallId) {
            const byCall = findToolUsage(parent, safeName, safeCallId, true) || findToolUsage(parent, 'tool', safeCallId, true);
            if (byCall) return byCall;
        }
    
        const rows = parent.querySelectorAll('.tool-usage');
        if (idxKey) {
            for (let i = rows.length - 1; i >= 0; i--) {
                const row = rows[i];
                if (row.dataset.pending !== 'true') continue;
                if (String(row.dataset.toolIndex || '') === idxKey) return row;
            }
        }
    
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.dataset.pending !== 'true') continue;
            if (row.dataset.toolName === safeName) return row;
        }
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.dataset.pending !== 'true') continue;
            const n = String(row.dataset.toolName || '').trim();
            if (!n || n === 'tool') return row;
        }
        return null;
    }
    
    function findToolUsageForRunning(parent, name, callId, toolIndex = null) {
        const safeName = normalizeToolDisplayName(name);
        const safeCallId = String(callId || '').trim();
    
        return findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex)
            || findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false)
            || findToolUsageByPhase(parent, safeName, safeCallId, 'build', false)
            || findToolUsage(parent, safeName, safeCallId, false);
    }
    
    function resolveToolCallIdForRunning(aiMsgDiv, name, rawCallId, toolIndex = null) {
        const safeName = normalizeToolDisplayName(name);
        const safeRawCallId = String(rawCallId || '').trim();
    
        if (safeRawCallId || (toolIndex !== null && toolIndex !== undefined && !Number.isNaN(Number(toolIndex)))) {
            return allocateToolCallId(aiMsgDiv, safeName, 'call', safeRawCallId, toolIndex);
        }
    
        const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
        const row = findToolUsageForRunning(parent, safeName, '', toolIndex);
        const existingCallId = String((row && row.dataset && row.dataset.callId) || '').trim();
    
        if (existingCallId) {
            return existingCallId;
        }
    
        return allocateToolCallId(aiMsgDiv, safeName, 'call', '', toolIndex);
    }

    function createToolEventController(deps = {}) {
        const requiredDeps = [
            'escapeHtml',
            'placeCanvasCardsBelowToolChain',
            'syncInteractiveCardsBelowToolChain'
        ];

        requiredDeps.forEach((name) => {

            if (typeof deps[name] !== 'function') {
                throw new Error(`Chat Tools 工具事件控制器缺少依赖: ${name}`);
            }
        });

        function appendToolEvent(aiMsgDiv, name, details, isFunction = false, options = {}) {
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            const toolName = String(name || '').trim() || 'tool';
            const opts = (options && typeof options === 'object') ? options : {};
            const callId = String(opts.callId || opts.call_id || '').trim();
            const reuseIfExists = !!opts.reuseIfExists;
            const pending = !!opts.pending;

            let div = null;
            if (reuseIfExists) {
                div = findToolUsage(parent, toolName, callId, true);
            }
            if (!div) {
                collapseResolvedToolUsages(parent);
                div = document.createElement('div');
                div.className = 'tool-usage execution-flow-item';
                parent.appendChild(div);
                div.dataset.resolved = 'false';
            }
            div.dataset.toolName = toolName;
            applyToolExecutionFlowKind(div, toolName);
            if (callId) div.dataset.callId = callId;
            div.dataset.pending = pending ? 'true' : 'false';
            if (pending) div.dataset.resolved = 'false';
            div.dataset.userToggled = 'false';
            if (pending) {
                div.classList.add('is-running');
            }

            let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>';
            if (toolName === 'Web Search' || toolName === 'search' || toolName === 'knowledge_search_keyword' || toolName === 'search_keyword' || toolName === 'searchKeyword' || toolName === 'web_search') {
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
            }

            const rawDetailText = typeof details === 'object' ? JSON.stringify(details) : details;
            let detailText = String(rawDetailText || '');
            if (isFunction && detailText) {
                detailText = `参数: ${clipExecutionFlowText(detailText, 72)}`;
            }
            const primaryText = buildChineseToolAction(toolName, parseExecutionFlowJson(rawDetailText) || {}, '', '', div);
            const phaseText = pending ? '准备中' : getExecutionFlowPhaseText(detailText);

            div.innerHTML = `
                <div class="tool-badge execution-flow-header">
                    <span class="execution-flow-node" aria-hidden="true">${iconSvg}</span>
                    <span class="execution-flow-main">
                        <span class="tool-name execution-flow-title" title="${deps.escapeHtml(toolName)}">${deps.escapeHtml(primaryText)}</span>
                    </span>
                    <span class="tool-status execution-flow-summary">${deps.escapeHtml(phaseText || '准备中')}</span>
                    <span class="tool-toggle" aria-hidden="true">▸</span>
                </div>
                <div class="tool-output"></div>
            `;
            bindToolUsageToggle(div);
            deps.placeCanvasCardsBelowToolChain(aiMsgDiv);
            deps.syncInteractiveCardsBelowToolChain(aiMsgDiv);
            return div;
        }

        function bindToolUsageToggle(toolEl) {
            if (!toolEl || toolEl.dataset.toggleBound === '1') return;
            const badge = toolEl.querySelector('.tool-badge');
            if (!badge) return;
            badge.addEventListener('click', () => {
                if (!toolEl.classList.contains('has-output')) return;
                toolEl.dataset.userToggled = 'true';
                toolEl.classList.toggle('expanded');
            });
            toolEl.dataset.toggleBound = '1';
        }

        function formatToolArgsForOutput(argsRaw) {
            const raw = String(argsRaw || '').trim();
            if (!raw) return '';
            try {
                return JSON.stringify(JSON.parse(raw), null, 2);
            } catch (_) {
                return raw;
            }
        }

        function isCompleteJsonText(raw) {
            const s = String(raw || '').trim();
            if (!s) return false;
            try {
                JSON.parse(s);
                return true;
            } catch (_) {
                return false;
            }
        }

        function shouldSplitToolArgsStream(existingRaw, incomingDelta) {
            const prev = String(existingRaw || '').trim();
            if (!prev) return false;
            if (!isCompleteJsonText(prev)) return false;
            const nextLead = String(incomingDelta || '').trimStart();
            return nextLead.startsWith('{') || nextLead.startsWith('[');
        }

        function beginNewAnonymousToolCall(aiMsgDiv, name) {
            const state = getToolCallState(aiMsgDiv);
            state.activeAnonCallId = '';
            return allocateToolCallId(aiMsgDiv, name, 'delta', '', null);
        }

        function formatToolDeltaStatus(argsRaw) {
            const _ = argsRaw;
            return '参数构建中';
        }

        function renameToolUsageRow(row, name) {
            if (!row) return;
            const safeName = normalizeToolDisplayName(name);
            row.dataset.toolName = safeName;
            applyToolExecutionFlowKind(row, safeName);
            const nameEl = row.querySelector('.tool-name');
            if (nameEl) {
                nameEl.textContent = buildChineseToolAction(safeName, getExecutionFlowArgs(row), '', '', row);
                nameEl.title = safeName;
            }
        }

        function setToolUsageStatus(row, statusText) {
            if (!row) return;
            const safeName = normalizeToolDisplayName(row.dataset.toolName || '');
            setToolUsagePrimaryText(row, buildChineseToolAction(safeName, getExecutionFlowArgs(row), '', '', row));
            const statusEl = row.querySelector('.tool-status');
            if (statusEl) {
                const raw = String(statusText || '');
                const compact = getExecutionFlowPhaseText(raw);
                statusEl.textContent = compact;
                statusEl.title = compact;
            }
        }

        function yieldToolStreamPaint() {
            // 本地文件写入常在同一批 SSE 中完成；让执行中状态先进入浏览器绘制队列。
            return new Promise((resolve) => {
                requestAnimationFrame(() => resolve());
            });
        }

        const TOOL_STREAM_PAINT_MIN_INTERVAL_MS = 80;
        const TOOL_STREAM_PAINT_DEBT_LIMIT = 3;
        const TOOL_STREAM_PAINT_DEBT_CHARS = 384;
        const toolStreamPaintAtByMessage = new WeakMap();
        const toolStreamPaintDebtByMessage = new WeakMap();

        function getToolStreamPaintDebt(data) {
            const type = String(data && data.type || '').trim();

            if (type !== 'function_call_delta') {
                return 1;
            }

            const delta = String(
                (data && (data.arguments_delta || data.delta || data.name_delta))
                || ''
            );

            return Math.max(1, Math.ceil(delta.length / TOOL_STREAM_PAINT_DEBT_CHARS));
        }

        function shouldYieldToolStreamPaintForChunk(data) {
            const type = String(data && data.type || '').trim();

            if (type === 'function_call' || type === 'function_call_running') {
                return true;
            }

            if (type !== 'function_call_delta') {
                return false;
            }

            const delta = String(
                (data && (data.arguments_delta || data.delta || data.name_delta))
                || ''
            );

            if (!delta) {
                return false;
            }

            const toolName = resolveToolNameFromEvent(data, data && data.name);
            const compact = String(toolName || '').replace(/[\s_-]+/g, '').toLowerCase();

            return compact.includes('file') || delta.length >= 64;
        }

        async function yieldToolStreamPaintForChunk(messageDiv, data, force = false) {
            if (!messageDiv) {
                return;
            }

            if (!force && !shouldYieldToolStreamPaintForChunk(data)) {
                return;
            }

            const now = (window.performance && typeof window.performance.now === 'function')
                ? window.performance.now()
                : Date.now();
            const lastPaintAt = Number(toolStreamPaintAtByMessage.get(messageDiv) || 0);

            if (!force && now - lastPaintAt < TOOL_STREAM_PAINT_MIN_INTERVAL_MS) {
                const nextDebt = Number(toolStreamPaintDebtByMessage.get(messageDiv) || 0) + getToolStreamPaintDebt(data);

                if (nextDebt < TOOL_STREAM_PAINT_DEBT_LIMIT) {
                    toolStreamPaintDebtByMessage.set(messageDiv, nextDebt);
                    return;
                }
            }

            toolStreamPaintDebtByMessage.set(messageDiv, 0);
            toolStreamPaintAtByMessage.set(messageDiv, now);
            await yieldToolStreamPaint();
        }

        function scrollToolOutputToBottom(outputEl) {
            if (!outputEl) return;
            const doScroll = () => {
                outputEl.scrollTop = outputEl.scrollHeight;
            };
            doScroll();
            requestAnimationFrame(doScroll);
        }

        function scrollToolOutputToTop(outputEl) {
            if (!outputEl) return;
            const doScroll = () => {
                outputEl.scrollTop = 0;
            };
            doScroll();
            requestAnimationFrame(doScroll);
        }

        function ensureToolUsageForDelta(aiMsgDiv, name, callId, toolIndex = null) {
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            const safeName = String(name || '').trim() || 'tool';
            const safeCallId = String(callId || '').trim();
            const idxKey = (toolIndex === null || toolIndex === undefined || Number.isNaN(Number(toolIndex)))
                ? ''
                : String(Number(toolIndex));
            let row = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex);
            if (!row) {
                row = appendToolEvent(aiMsgDiv, safeName, '参数构建中...', true, {
                    callId: safeCallId,
                    reuseIfExists: true,
                    pending: true
                });
            }
            const previousCallId = String((row && row.dataset && row.dataset.callId) || '').trim();
            row.dataset.pending = 'true';
            row.dataset.phase = 'build';
            if (safeCallId) row.dataset.callId = safeCallId;
            if (idxKey) row.dataset.toolIndex = idxKey;
            migratePendingToolCallId(aiMsgDiv, previousCallId, row.dataset.callId || safeCallId, safeName);
            return row;
        }

        function appendToolCallDelta(aiMsgDiv, data) {
            const providedName = resolveToolNameFromEvent(data);
            const nameDeltaPiece = String((data && data.name_delta) || '').trim();
            const name = providedName || 'tool';
            const callId = String(data.call_id || data.callId || '').trim();
            const rawCallId = String(data.__raw_call_id || '').trim();
            const rawIndex = (data.__tool_index === undefined || data.__tool_index === null) ? null : Number(data.__tool_index);
            const delta = String(data.arguments_delta || data.delta || '');
            let row = ensureToolUsageForDelta(aiMsgDiv, name, callId, rawIndex);
            if (providedName) {
                row.dataset.nameAcc = providedName;
                renameToolUsageRow(row, providedName);
                rememberPendingToolCallId(aiMsgDiv, row.dataset.callId || callId, providedName);
            } else if (nameDeltaPiece) {
                const acc = `${row.dataset.nameAcc || ''}${nameDeltaPiece}`;
                row.dataset.nameAcc = acc;
                if (String(acc || '').trim()) {
                    renameToolUsageRow(row, acc);
                    rememberPendingToolCallId(aiMsgDiv, row.dataset.callId || callId, acc);
                }
            }
            if (!delta) return;

            // provider 未提供稳定 call_id/index 时，若上一段参数已是完整 JSON，且新增量又从对象起始开始，
            // 视为新一轮工具调用，强制切分为新行，避免参数复用拼接。
            const missingStableIdentity = !rawCallId && (rawIndex === null || Number.isNaN(rawIndex));
            if (missingStableIdentity && shouldSplitToolArgsStream(row.dataset.argsRaw || '', delta)) {
                const freshCallId = beginNewAnonymousToolCall(aiMsgDiv, name);
                row = ensureToolUsageForDelta(aiMsgDiv, name, freshCallId, rawIndex);
            }

            const nextRaw = `${row.dataset.argsRaw || ''}${delta}`;
            row.dataset.argsRaw = nextRaw;
            const displayName = normalizeToolDisplayName(row.dataset.toolName || providedName || name);
            const partialArgs = parseExecutionFlowPartialJson(nextRaw) || {};
            const fileRunningDisplay = buildFileToolRunningDisplay(displayName, partialArgs);
            setToolUsageStatus(row, `${displayName} ${formatToolDeltaStatus(nextRaw)}:`);
            const outDiv = row.querySelector('.tool-output');
            if (outDiv) {
                outDiv.textContent = fileRunningDisplay
                    ? fileRunningDisplay.progressText
                    : formatToolArgsForOutput(nextRaw);
                if (outDiv.textContent) {
                    row.classList.add('has-output');

                    if (row.dataset.userToggled !== 'true') {
                        row.classList.add('expanded');
                    }

                    scrollToolOutputToBottom(outDiv);
                }
            }
        }

        function finalizeToolCallBadge(aiMsgDiv, name, callId, argumentsText = '', options = {}) {
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            let safeName = String(name || '').trim() || 'tool';
            const safeCallId = String(callId || '').trim();
            const toolIndex = (options && options.toolIndex !== undefined && options.toolIndex !== null)
                ? Number(options.toolIndex)
                : null;
            const idxKey = (toolIndex === null || Number.isNaN(toolIndex)) ? '' : String(toolIndex);
            const autoExpand = !(options && options.autoExpand === false);

            let row = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex)
                || findToolUsageByPhase(parent, safeName, safeCallId, 'build', false)
                || findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false);
            if ((safeName === 'tool') && row) {
                const inherited = normalizeToolDisplayName(row.dataset.toolName || '');
                if (inherited && inherited !== 'tool') safeName = inherited;
            }
            const finalArgs = String(argumentsText || (row && row.dataset ? row.dataset.argsRaw : '') || '');
            if (!row) {
                row = appendToolEvent(aiMsgDiv, safeName, '', true, {
                    callId: safeCallId,
                    reuseIfExists: false,
                    pending: false
                });
            }
            if (!row) return;

            const previousCallId = String(row.dataset.callId || '').trim();
            if (finalArgs) row.dataset.argsRaw = finalArgs;
            renameToolUsageRow(row, safeName);
            row.dataset.phase = 'exec';
            if (safeCallId) row.dataset.callId = safeCallId;
            if (idxKey) row.dataset.toolIndex = idxKey;
            migratePendingToolCallId(aiMsgDiv, previousCallId, row.dataset.callId || safeCallId, safeName);
            row.dataset.pending = 'false';
            row.dataset.resolved = 'false';
            const finalArgsObj = parseExecutionFlowJson(finalArgs) || parseExecutionFlowPartialJson(finalArgs) || {};
            const fileRunningDisplay = buildFileToolRunningDisplay(safeName, finalArgsObj);
            setToolUsageStatus(row, fileRunningDisplay ? fileRunningDisplay.statusText : `${safeName} 执行中`);
            const outDiv = row.querySelector('.tool-output');
            if (outDiv) {
                outDiv.textContent = fileRunningDisplay
                    ? fileRunningDisplay.progressText
                    : row.dataset.argsRaw
                    ? formatToolArgsForOutput(row.dataset.argsRaw)
                    : '';
                row.classList.toggle('has-output', !!outDiv.textContent.trim());
                if (autoExpand) {
                    row.classList.add('is-running');

                    if (row.dataset.userToggled !== 'true') {
                        row.classList.toggle('expanded', !!outDiv.textContent.trim());
                    }
                }
                if (outDiv.textContent.trim()) {
                    scrollToolOutputToBottom(outDiv);
                }
            }
        }

        function updateToolCallRunning(aiMsgDiv, data) {
            if (!aiMsgDiv || !data || typeof data !== 'object') {
                return;
            }

            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            const toolName = resolveToolNameFromEvent(data, data.name) || 'tool';

            if (toolName === 'question' || toolName === 'learning_card' || toolName === 'puzzle') {
                return;
            }

            const rawCallId = String(data.call_id || data.callId || '').trim();
            const toolIndex = (data.index === undefined || data.index === null) ? null : Number(data.index);
            const callId = resolveToolCallIdForRunning(aiMsgDiv, toolName, rawCallId, toolIndex);
            const idxKey = (toolIndex === null || Number.isNaN(toolIndex)) ? '' : String(toolIndex);
            let row = findToolUsageForRunning(parent, toolName, callId, toolIndex);

            if (!row) {
                row = appendToolEvent(aiMsgDiv, toolName, '执行中', true, {
                    callId,
                    reuseIfExists: false,
                    pending: false
                });
            }

            if (!row) {
                return;
            }

            const argsRaw = String(data.arguments || '').trim();
            const previousCallId = String(row.dataset.callId || '').trim();

            if (argsRaw) {
                row.dataset.argsRaw = argsRaw;
            }

            renameToolUsageRow(row, toolName);
            row.dataset.phase = 'exec';
            row.dataset.pending = 'false';
            row.dataset.resolved = 'false';

            if (callId) {
                row.dataset.callId = callId;
            }

            if (idxKey) {
                row.dataset.toolIndex = idxKey;
            }

            migratePendingToolCallId(aiMsgDiv, previousCallId, row.dataset.callId || callId, toolName);
            row.classList.add('is-running');
            row.classList.remove('done');

            const statusText = String(data.status_text || data.statusText || '').trim();
            const progressText = String(data.progress_text || data.progressText || '').trim();
            setToolUsageStatus(row, statusText || '执行中');

            const outDiv = row.querySelector('.tool-output');

            if (outDiv && progressText) {
                outDiv.textContent = progressText;
                row.classList.toggle('has-output', !!outDiv.textContent.trim());

                if (outDiv.textContent.trim() && row.dataset.userToggled !== 'true') {
                    row.classList.add('expanded');
                    scrollToolOutputToBottom(outDiv);
                }
            } else if (outDiv && row.dataset.argsRaw) {
                outDiv.textContent = formatToolArgsForOutput(row.dataset.argsRaw);
                row.classList.toggle('has-output', !!outDiv.textContent.trim());

                if (outDiv.textContent.trim() && row.dataset.userToggled !== 'true') {
                    row.classList.add('expanded');
                    scrollToolOutputToBottom(outDiv);
                }
            }
        }

        return {
            appendToolEvent,
            bindToolUsageToggle,
            formatToolArgsForOutput,
            isCompleteJsonText,
            shouldSplitToolArgsStream,
            beginNewAnonymousToolCall,
            formatToolDeltaStatus,
            renameToolUsageRow,
            setToolUsageStatus,
            yieldToolStreamPaint,
            getToolStreamPaintDebt,
            shouldYieldToolStreamPaintForChunk,
            yieldToolStreamPaintForChunk,
            scrollToolOutputToBottom,
            scrollToolOutputToTop,
            ensureToolUsageForDelta,
            appendToolCallDelta,
            finalizeToolCallBadge,
            updateToolCallRunning
        };
    }

    function createToolResultController(deps = {}) {
        const requiredDeps = [
            'getCurrentConversationId',
            'renderMarkdownWithNewTabLinks',
            'bindSourceMarkdown',
            'renderMathSafe',
            'highlightCode',
            'syncGeneratedImageViewportLimit',
            'appendToolEvent',
            'renameToolUsageRow',
            'setToolUsageStatus',
            'scrollToolOutputToBottom',
            'scrollToolOutputToTop',
            'maybeRenderCanvasFromJsExecuteResult'
        ];

        requiredDeps.forEach((name) => {

            if (typeof deps[name] !== 'function') {
                throw new Error(`Chat Tools 结果控制器缺少依赖: ${name}`);
            }
        });

        function isGenerateImageToolName(name) {
            const compact = String(name || '').trim().replace(/[_\-\s]/g, '').toLowerCase();
            return compact === 'generateimage';
        }

        function parseToolResultPayload(result) {
            if (result && typeof result === 'object') {
                return result;
            }

            const text = String(result || '').trim();

            if (!text) {
                return null;
            }

            try {
                return JSON.parse(text);
            } catch (e) {
                return null;
            }
        }

        function isMapToolName(name) {
            const compact = String(name || '').trim().replace(/[\s-]/g, '_').toLowerCase();
            const mapToolNames = new Set([
                'map_render',
                'maprenderscene',
                'maprender',
                'map_render_scene',
                'map_calc_distance',
                'mapcalcdistance',
                'map_calc_straight_distance',
                'map_calc_route',
                'mapcalcroute',
                'map_route_plan',
                'map_geocode',
                'mapgeocode',
                'map_poi_search',
                'mappoisearch',
                'map_search_place'
            ]);

            return mapToolNames.has(compact);
        }

        function readMapResultId(payload) {
            if (!payload || typeof payload !== 'object') {
                return '';
            }

            return String(
                payload.map_id
                || payload.mapId
                || payload.render_id
                || payload.renderId
                || payload.record_id
                || payload.recordId
                || ''
            ).trim();
        }

        function readMapResultConversationId(payload) {
            if (!payload || typeof payload !== 'object') {
                return String(deps.getCurrentConversationId() || '').trim();
            }

            return String(
                payload.conversation_id
                || payload.conversationId
                || deps.getCurrentConversationId()
                || ''
            ).trim();
        }

        function buildMapResultMarkdown(payload) {
            if (!payload || typeof payload !== 'object') {
                return '';
            }

            const markdown = String(payload.markdown || '').trim();

            if (markdown) {
                return markdown;
            }

            if (payload.scene && typeof payload.scene === 'object' && !Array.isArray(payload.scene)) {
                return `\`\`\`nexora-map\n${JSON.stringify(payload.scene, null, 4)}\n\`\`\``;
            }

            const mapId = readMapResultId(payload);
            const conversationId = readMapResultConversationId(payload);

            if (!mapId || !conversationId) {
                return '';
            }

            const title = String(payload.title || '地图').trim() || '地图';
            const mapRef = {
                type: 'nexora-map-ref',
                mapId,
                map_id: mapId,
                renderId: mapId,
                conversationId,
                conversation_id: conversationId,
                title
            };

            return `\`\`\`nexora-map-ref\n${JSON.stringify(mapRef, null, 4)}\n\`\`\``;
        }

        function stripMapSceneSection(markdownText) {
            const source = String(markdownText || '').trim();

            if (!source) {
                return '';
            }

            const match = source.match(/(?:^|\n)### Scene(?:\n|$)/);

            if (!match) {
                return source;
            }

            return source.slice(0, match.index).trim();
        }

        function readContentBodySourceText(node) {
            if (!node) {
                return '';
            }

            if (typeof node.__sourceMarkdown === 'string') {
                return node.__sourceMarkdown;
            }

            return String(node.dataset.streamRaw || node.dataset.rawText || node.textContent || '');
        }

        function collectContentMarkdownBeforeNode(parent, stopNode) {
            if (!parent || !stopNode) {
                return '';
            }

            const parts = [];
            const nodes = Array.from(parent.children || []);

            for (const node of nodes) {
                if (node === stopNode) {
                    break;
                }

                if (!node.classList || !node.classList.contains('content-body')) {
                    continue;
                }

                if (
                    node.classList.contains('generated-image-result')
                    || node.classList.contains('generated-map-result')
                ) {
                    continue;
                }

                parts.push(readContentBodySourceText(node));
            }

            return parts.join('');
        }

        function normalizeGenerateImageProgress(payload) {
            const source = payload && Array.isArray(payload.progress) ? payload.progress : [];
            const logs = [];

            source.forEach((entry) => {
                let text = '';

                if (typeof entry === 'string') {
                    text = entry.trim();
                } else if (entry && typeof entry === 'object') {
                    text = String(entry.log || entry.message || entry.text || '').trim();
                } else {
                    text = String(entry || '').trim();
                }

                if (text) {
                    logs.push(text);
                }
            });

            return logs;
        }

        function appendGenerateImageProgress(root, progressLogs) {
            if (!root || !Array.isArray(progressLogs) || progressLogs.length === 0) {
                return;
            }

            const wrap = document.createElement('div');
            wrap.className = 'generate-image-progress';

            const title = document.createElement('div');
            title.className = 'generate-image-progress-title';
            title.textContent = '生成进度';
            wrap.appendChild(title);

            const list = document.createElement('div');
            list.className = 'generate-image-progress-list';

            progressLogs.forEach((text, index) => {
                const item = document.createElement('div');
                item.className = index === progressLogs.length - 1
                    ? 'generate-image-progress-item current'
                    : 'generate-image-progress-item';
                item.textContent = text;
                list.appendChild(item);
            });

            wrap.appendChild(list);
            root.appendChild(wrap);
        }

        function renderGenerateImageToolOutput(outDiv, toolName, result) {
            if (!outDiv || !isGenerateImageToolName(toolName)) {
                return false;
            }

            const payload = parseToolResultPayload(result);
            const progressLogs = normalizeGenerateImageProgress(payload);
            const statusMessage = String((payload && payload.message) || '图片生成完成').trim();

            if (!payload || payload.success !== true) {
                return false;
            }

            const outputLogs = progressLogs.length > 0 ? progressLogs : [statusMessage];
            outDiv.classList.remove('tool-output-markdown');
            outDiv.classList.add('generate-image-tool-output');
            outDiv.innerHTML = '';
            appendGenerateImageProgress(outDiv, outputLogs);
            deps.bindSourceMarkdown(outDiv, outputLogs.join('\n'));

            return true;
        }

        function renderGenerateImageResultInMessage(aiMsgDiv, result, callId, anchorEl) {
            if (!aiMsgDiv) {
                return false;
            }

            const payload = parseToolResultPayload(result);

            if (!payload || payload.success !== true) {
                return false;
            }

            const markdown = String(payload.markdown || '').trim();

            if (!markdown) {
                return false;
            }

            const safeCallId = String(callId || '').trim();
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            const existing = Array.from(parent.querySelectorAll('.content-body.generated-image-result')).find((node) => {
                if (safeCallId && String(node.dataset.callId || '') === safeCallId) {
                    return true;
                }

                return !safeCallId && typeof node.__sourceMarkdown === 'string' && node.__sourceMarkdown === markdown;
            });

            if (existing) {
                const hasFollowup = !!parent.querySelector('.content-body.generated-image-followup');
                aiMsgDiv.__generatedImageResultAnchor = existing;
                aiMsgDiv.__generatedImageTextPrefix = collectContentMarkdownBeforeNode(parent, existing);
                aiMsgDiv.__contentAfterGeneratedImage = !hasFollowup;
                return true;
            }

            const body = document.createElement('div');
            body.className = 'content-body generated-image-result fade-in';
            body.dataset.toolName = 'generate_image';

            if (safeCallId) {
                body.dataset.callId = safeCallId;
            }

            body.innerHTML = deps.renderMarkdownWithNewTabLinks(markdown, { breaks: false });
            deps.bindSourceMarkdown(body, markdown);

            if (anchorEl && anchorEl.parentElement === parent) {
                anchorEl.insertAdjacentElement('afterend', body);
            } else {
                parent.appendChild(body);
            }

            aiMsgDiv.__contentAfterGeneratedImage = true;
            aiMsgDiv.__generatedImageResultAnchor = body;
            aiMsgDiv.__generatedImageTextPrefix = collectContentMarkdownBeforeNode(parent, body);
            aiMsgDiv.__generatedImageFollowupSpan = null;
            deps.syncGeneratedImageViewportLimit();
            return true;
        }

        function renderMapResultInMessage(aiMsgDiv, toolName, result, callId, anchorEl) {
            if (!aiMsgDiv || !isMapToolName(toolName)) {
                return false;
            }

            const payload = parseToolResultPayload(result);

            if (!payload || payload.success !== true) {
                return false;
            }

            const markdown = buildMapResultMarkdown(payload);

            if (!markdown) {
                return false;
            }

            const safeCallId = String(callId || '').trim();
            const mapId = readMapResultId(payload);
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            const existing = Array.from(parent.querySelectorAll('.content-body.generated-map-result')).find((node) => {
                if (safeCallId && String(node.dataset.callId || '') === safeCallId) {
                    return true;
                }

                if (mapId && String(node.dataset.mapId || '') === mapId) {
                    return true;
                }

                return !safeCallId && !mapId && typeof node.__sourceMarkdown === 'string' && node.__sourceMarkdown === markdown;
            });

            if (existing) {
                return true;
            }

            const body = document.createElement('div');
            body.className = 'content-body generated-map-result fade-in';
            body.dataset.toolName = String(toolName || 'map_tool').trim() || 'map_tool';

            if (safeCallId) {
                body.dataset.callId = safeCallId;
            }

            if (mapId) {
                body.dataset.mapId = mapId;
            }

            body.innerHTML = deps.renderMarkdownWithNewTabLinks(markdown, { breaks: false });
            deps.bindSourceMarkdown(body, markdown);

            if (anchorEl && anchorEl.parentElement === parent) {
                anchorEl.insertAdjacentElement('afterend', body);
            } else {
                parent.appendChild(body);
            }

            if (window.NexoraMapRenderer && typeof window.NexoraMapRenderer.renderAll === 'function') {
                window.NexoraMapRenderer.renderAll(body);
            }

            return true;
        }

        function resolveToolResultDisplayMarkdown(result, options = {}) {
            const opts = (options && typeof options === 'object') ? options : {};
            const candidates = [
                opts.modelVisibleResult,
                opts.model_visible_result,
                opts.markdownResult,
                opts.markdown_result
            ];

            for (const value of candidates) {
                if (value === undefined || value === null) continue;
                const text = (typeof value === 'object') ? JSON.stringify(value, null, 2) : String(value || '');
                if (text.trim()) return text;
            }

            return '';
        }

        function setToolResultMarkdownSource(outDiv, markdownText) {
            if (!outDiv) return false;

            const source = String(markdownText || '').trim();
            if (!source) return false;

            outDiv.classList.remove('generate-image-tool-output');
            outDiv.classList.add('tool-output-markdown');
            outDiv.innerHTML = deps.renderMarkdownWithNewTabLinks(source, { breaks: false });
            deps.bindSourceMarkdown(outDiv, source);
            deps.renderMathSafe(outDiv);
            deps.highlightCode(outDiv);
            return true;
        }

        function updateLastToolResult(aiMsgDiv, name, result, callId = '', options = {}) {
            const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
            let safeName = String(name || '').trim() || 'tool';
            const safeCallId = String(callId || '').trim();
            const toolIndex = (options && options.toolIndex !== undefined && options.toolIndex !== null)
                ? Number(options.toolIndex)
                : null;
            const idxKey = (toolIndex === null || Number.isNaN(toolIndex)) ? '' : String(toolIndex);
            let target = findToolUsageByPhase(parent, safeName, safeCallId, 'exec', false);
            if (!target) {
                target = findPendingToolUsageFallback(parent, safeName, safeCallId, toolIndex);
            }
            if (!target && safeCallId) {
                target = findToolUsage(parent, safeName, safeCallId, false) || findToolUsage(parent, 'tool', safeCallId, false);
            }
            if (!target) {
                // 当 provider 不返回 call_id 时，按“最早未完成”匹配，避免覆盖最近一条
                const rows = parent.querySelectorAll('.tool-usage');
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.dataset.resolved === 'true') continue;
                    if (row.dataset.toolName === safeName || row.dataset.toolName === 'tool') {
                        target = row;
                        break;
                    }
                }
            }
            if (!target) {
                target = deps.appendToolEvent(aiMsgDiv, safeName, '', true, {
                    callId: safeCallId,
                    reuseIfExists: false,
                    pending: false
                });
            }

            const targetNameHint = target ? normalizeToolDisplayName(target.dataset.toolName || '') : '';
            if (safeName === 'tool' && targetNameHint && targetNameHint !== 'tool') {
                safeName = targetNameHint;
            }

            if (target) {
                const previousCallId = String(target.dataset.callId || '').trim();
                if (safeName === 'tool') {
                    const inherited = normalizeToolDisplayName(target.dataset.toolName || '');
                    if (inherited && inherited !== 'tool') safeName = inherited;
                }
                deps.renameToolUsageRow(target, safeName);
                target.dataset.phase = 'exec';
                if (safeCallId) target.dataset.callId = safeCallId;
                if (idxKey) target.dataset.toolIndex = idxKey;
                const state = getToolCallState(aiMsgDiv);
                removePendingToolCallId(state, previousCallId);
                removePendingToolCallId(state, target.dataset.callId || safeCallId);
                target.dataset.pending = 'false';
                target.dataset.resolved = 'true';
                target.classList.remove('is-running');
                deps.setToolUsageStatus(target, `${safeName} 完成:`);
                const outDiv = target.querySelector('.tool-output');
                const displayMarkdown = resolveToolResultDisplayMarkdown(result, options);
                const renderedMap = renderMapResultInMessage(aiMsgDiv, safeName, result, safeCallId, target);
                const outputMarkdown = renderedMap ? stripMapSceneSection(displayMarkdown) : displayMarkdown;
                const resultText = (typeof result === 'object') ? JSON.stringify(result, null, 2) : String(result || '');

                const renderedGenerateImage = renderGenerateImageToolOutput(outDiv, safeName, result);

                if (renderedGenerateImage) {
                    renderGenerateImageResultInMessage(aiMsgDiv, result, safeCallId, target);
                }

                if (!renderedGenerateImage) {
                    const displayedMarkdownSource = setToolResultMarkdownSource(outDiv, outputMarkdown);
                    if (!displayedMarkdownSource) {
                        outDiv.classList.remove('tool-output-markdown');
                        outDiv.classList.remove('generate-image-tool-output');
                        outDiv.textContent = resultText;
                    }
                }

                if (outDiv.textContent.trim() || outDiv.querySelector('img')) {
                    target.classList.add('has-output');

                    if (target.dataset.userToggled !== 'true') {
                        target.classList.add('expanded');
                        deps.scrollToolOutputToTop(outDiv);
                    }
                }

                if (!renderedGenerateImage) {
                    updateToolUsageResultSummary(target, safeName, result, outputMarkdown, resultText);
                }

            }

            deps.maybeRenderCanvasFromJsExecuteResult(aiMsgDiv, safeName, result, safeCallId, toolIndex);
        }

        return {
            isGenerateImageToolName,
            parseToolResultPayload,
            isMapToolName,
            readMapResultId,
            readMapResultConversationId,
            buildMapResultMarkdown,
            stripMapSceneSection,
            readContentBodySourceText,
            collectContentMarkdownBeforeNode,
            normalizeGenerateImageProgress,
            appendGenerateImageProgress,
            renderGenerateImageToolOutput,
            renderGenerateImageResultInMessage,
            renderMapResultInMessage,
            resolveToolResultDisplayMarkdown,
            setToolResultMarkdownSource,
            updateLastToolResult
        };
    }

    getShared().registerModule(MODULE_NAME, {
        clipExecutionFlowText,
        parseExecutionFlowJson,
        unescapeExecutionFlowJsonFragment,
        readExecutionFlowJsonStringToken,
        parseExecutionFlowPartialJson,
        basenameForExecutionFlow,
        hostForExecutionFlow,
        readExecutionFlowArg,
        buildFileToolRunningDisplay,
        getExecutionFlowArgs,
        getExecutionFlowPhaseText,
        parseExecutionFlowPayload,
        unwrapExecutionFlowPayload,
        normalizeExecutionFlowCount,
        readExecutionFlowMarkdownCount,
        readExecutionFlowPayloadPath,
        readExecutionFlowPayloadCount,
        readExecutionFlowResultCount,
        readExecutionFlowResultText,
        appendExecutionFlowCount,
        buildChineseToolAction,
        setToolUsagePrimaryText,
        getToolExecutionFlowKind,
        applyToolExecutionFlowKind,
        cleanExecutionFlowMarkdownValue,
        extractMarkdownField,
        extractMarkdownTitle,
        readPatchLineStats,
        renderToolUsageChangeStats,
        collapseResolvedToolUsages,
        buildToolResultSummaryFromMarkdown,
        updateToolUsageResultSummary,
        findToolUsage,
        findToolUsageByPhase,
        getToolCallState,
        rememberToolArgsDeltaSeen,
        hasToolArgsDeltaSeen,
        removePendingToolCallId,
        rememberPendingToolCallId,
        migratePendingToolCallId,
        allocateToolCallId,
        normalizeToolDisplayName,
        resolveToolNameFromEvent,
        findPendingToolUsageFallback,
        findToolUsageForRunning,
        resolveToolCallIdForRunning,
        createToolEventController,
        createToolResultController,
    });
})();
