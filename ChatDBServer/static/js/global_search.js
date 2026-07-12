/**
 * 全局搜索命令面板（Ctrl+K / Cmd+K）
 *
 * 功能：
 * 1. 跨会话搜索：标题命中 + 消息全文命中（后端 /api/search/global）
 * 2. 消息命中点击后跳转会话并定位到消息（复用 jumpToChatSource 的窗口外加载与高亮）
 * 3. 空输入时展示快速动作列表
 *
 * 依赖 chat.js 提供的全局函数：loadConversation、jumpToChatSource、
 * createNewConversation、showToast。本文件须在 chat.js 之后加载。
 */

class GlobalSearchPalette {

    constructor() {
        this.overlay = null;
        this.input = null;
        this.resultsBox = null;
        this.items = [];
        this.activeIndex = -1;
        this.searchTimer = null;
        this.searchSeq = 0;

        // 快速动作：空输入时展示，后续扩展直接向数组追加
        this.quickActions = [
            {
                icon: 'plus',
                title: '新建对话',
                meta: '开启一个空白会话',
                run: () => createNewConversation()
            }
        ];
    }

    // ─────── DOM 构建 ───────────────────────────────────────────────

    ensureDom() {
        if (this.overlay) return;

        const overlay = document.createElement('div');
        overlay.className = 'gsp-overlay';
        overlay.hidden = true;

        const panel = document.createElement('div');
        panel.className = 'gsp-panel';

        const inputRow = document.createElement('div');
        inputRow.className = 'gsp-input-row';
        inputRow.appendChild(this.svgIcon('search'));

        const input = document.createElement('input');
        input.className = 'gsp-input';
        input.type = 'text';
        input.placeholder = '搜索对话与消息…';
        input.setAttribute('aria-label', '全局搜索');
        inputRow.appendChild(input);

        const escHint = document.createElement('kbd');
        escHint.className = 'gsp-kbd';
        escHint.textContent = 'Esc';
        inputRow.appendChild(escHint);

        const resultsBox = document.createElement('div');
        resultsBox.className = 'gsp-results';

        const footer = document.createElement('div');
        footer.className = 'gsp-footer';
        footer.textContent = '↑↓ 选择 · Enter 打开 · Esc 关闭';

        panel.appendChild(inputRow);
        panel.appendChild(resultsBox);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', (event) => {
            if (!panel.contains(event.target)) this.close();
        });

        input.addEventListener('input', () => this.scheduleSearch());

        this.overlay = overlay;
        this.input = input;
        this.resultsBox = resultsBox;
    }

    svgIcon(name) {
        const paths = {
            search: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path>',
            chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
            message: '<path d="M4 4h16v12H8l-4 4z"></path><path d="M8 9h8"></path><path d="M8 12h5"></path>',
            plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
            book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>'
        };

        const wrap = document.createElement('span');
        wrap.className = 'gsp-icon';
        wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + (paths[name] || paths.search) + '</svg>';
        return wrap;
    }

    // ─────── 打开 / 关闭 ────────────────────────────────────────────

    open() {
        this.ensureDom();
        this.overlay.hidden = false;
        this.input.focus();
        this.input.select();
        this.renderForKeyword(this.input.value.trim());
    }

    close() {
        if (!this.overlay || this.overlay.hidden) return;

        this.overlay.hidden = true;
        this.input.blur();
    }

    toggle() {
        this.ensureDom();

        if (this.overlay.hidden) {
            this.open();
        } else {
            this.close();
        }
    }

    isOpen() {
        return !!this.overlay && !this.overlay.hidden;
    }

    // ─────── 键盘 ───────────────────────────────────────────────────

    /**
     * 全部键盘处理放在 document 捕获阶段：面板打开时无论焦点在哪，
     * Esc/↑↓/Enter 都有效，且不会触发页面其他组件的按键逻辑。
     */
    handleGlobalKeydown(event) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'k') {
            event.preventDefault();
            event.stopPropagation();
            this.toggle();
            return;
        }

        if (!this.isOpen()) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActive(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            this.moveActive(-1);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.runActive();
        }
    }

    // ─────── 搜索 ───────────────────────────────────────────────────

    scheduleSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);

        const keyword = this.input.value.trim();
        this.searchTimer = setTimeout(() => this.renderForKeyword(keyword), 250);
    }

    renderForKeyword(keyword) {
        if (!keyword) {
            this.renderQuickActions();
            return;
        }

        this.runSearch(keyword);
    }

    async runSearch(keyword) {
        const seq = ++this.searchSeq;
        this.renderStatus('搜索中…');

        let payload = null;

        try {
            const resp = await fetch(`/api/search/global?q=${encodeURIComponent(keyword)}`);
            payload = await resp.json();
        } catch (_) {
            payload = null;
        }

        // 丢弃过期请求的响应，避免旧结果覆盖新输入
        if (seq !== this.searchSeq || !this.isOpen()) return;

        if (!payload || !payload.success) {
            this.renderStatus('搜索失败，请稍后重试');
            return;
        }

        this.renderResults(payload, keyword);
    }

    // ─────── 渲染 ───────────────────────────────────────────────────

    resetResults() {
        this.resultsBox.textContent = '';
        this.items = [];
        this.activeIndex = -1;
    }

    renderStatus(text) {
        this.resetResults();

        const status = document.createElement('div');
        status.className = 'gsp-status';
        status.textContent = text;
        this.resultsBox.appendChild(status);
    }

    renderQuickActions() {
        this.resetResults();
        this.appendGroup('快速动作', this.quickActions.map((action) => this.buildItem({
            icon: action.icon,
            title: action.title,
            meta: action.meta,
            run: action.run
        })));
        this.setActive(this.items.length ? 0 : -1);
    }

    renderResults(payload, keyword) {
        this.resetResults();

        const titles = Array.isArray(payload.titles) ? payload.titles : [];
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const knowledge = Array.isArray(payload.knowledge) ? payload.knowledge : [];
        const files = Array.isArray(payload.files) ? payload.files : [];

        if (!titles.length && !messages.length && !knowledge.length && !files.length) {
            this.renderStatus('没有找到相关内容');
            return;
        }

        if (titles.length) {
            this.appendGroup('对话', titles.map((item) => this.buildItem({
                icon: 'chat',
                title: item.title,
                titleKeyword: keyword,
                meta: item.preview,
                run: () => loadConversation(item.conversation_id)
            })));
        }

        if (messages.length) {
            this.appendGroup('消息', messages.map((item) => this.buildItem({
                icon: 'message',
                title: item.snippet,
                titleKeyword: keyword,
                meta: `${item.role === 'user' ? '我' : '助手'} · ${item.title}`,
                run: () => jumpToChatSource({
                    conversationId: item.conversation_id,
                    messageIndex: item.message_index,
                    messageRole: item.role
                })
            })));
        }

        if (knowledge.length) {
            this.appendGroup('知识库', knowledge.map((item) => this.buildItem({
                icon: 'book',
                title: item.title,
                titleKeyword: keyword,
                meta: item.snippet,
                run: () => viewKnowledge(item.title)
            })));
        }

        if (files.length) {
            this.appendGroup('云盘文件', files.map((item) => this.buildItem({
                icon: 'file',
                title: item.name,
                titleKeyword: keyword,
                meta: item.alias === item.name ? '云盘文件' : item.alias,
                run: async () => {
                    window.openFilesFrameView();
                    await loadFileCenterFiles();
                    openFileCenterFileDetail(item.alias);
                }
            })));
        }

        this.setActive(this.items.length ? 0 : -1);
    }

    appendGroup(titleText, itemElements) {
        if (!itemElements.length) return;

        const group = document.createElement('div');
        group.className = 'gsp-group';

        const groupTitle = document.createElement('div');
        groupTitle.className = 'gsp-group-title';
        groupTitle.textContent = titleText;
        group.appendChild(groupTitle);

        for (const element of itemElements) {
            group.appendChild(element);
        }

        this.resultsBox.appendChild(group);
    }

    buildItem({ icon, title, titleKeyword, meta, run }) {
        const item = document.createElement('div');
        item.className = 'gsp-item';
        item.appendChild(this.svgIcon(icon));

        const textCol = document.createElement('div');
        textCol.className = 'gsp-item-text';

        const titleLine = document.createElement('div');
        titleLine.className = 'gsp-item-title';
        this.appendHighlightedText(titleLine, String(title || ''), titleKeyword);
        textCol.appendChild(titleLine);

        if (meta) {
            const metaLine = document.createElement('div');
            metaLine.className = 'gsp-item-meta';
            metaLine.textContent = String(meta);
            textCol.appendChild(metaLine);
        }

        item.appendChild(textCol);

        const index = this.items.length;
        item.addEventListener('mouseenter', () => this.setActive(index));
        item.addEventListener('click', () => {
            this.setActive(index);
            this.runActive();
        });

        this.items.push({ element: item, run });
        return item;
    }

    /**
     * 用文本节点 + <mark> 构造高亮内容，全程不把数据拼进 innerHTML。
     */
    appendHighlightedText(container, text, keyword) {
        const keywordLower = String(keyword || '').toLowerCase();

        if (!keywordLower) {
            container.textContent = text;
            return;
        }

        let rest = text;

        while (rest) {
            const hitPos = rest.toLowerCase().indexOf(keywordLower);

            if (hitPos < 0) {
                container.appendChild(document.createTextNode(rest));
                break;
            }

            if (hitPos > 0) {
                container.appendChild(document.createTextNode(rest.slice(0, hitPos)));
            }

            const mark = document.createElement('mark');
            mark.className = 'gsp-mark';
            mark.textContent = rest.slice(hitPos, hitPos + keywordLower.length);
            container.appendChild(mark);

            rest = rest.slice(hitPos + keywordLower.length);
        }
    }

    // ─────── 选中项管理 ─────────────────────────────────────────────

    setActive(index) {
        if (this.activeIndex >= 0 && this.items[this.activeIndex]) {
            this.items[this.activeIndex].element.classList.remove('is-active');
        }

        this.activeIndex = index;

        if (index >= 0 && this.items[index]) {
            const element = this.items[index].element;
            element.classList.add('is-active');
            element.scrollIntoView({ block: 'nearest' });
        }
    }

    moveActive(delta) {
        if (!this.items.length) return;

        const next = (this.activeIndex + delta + this.items.length) % this.items.length;
        this.setActive(next);
    }

    async runActive() {
        const current = this.items[this.activeIndex];

        if (!current) return;

        this.close();

        try {
            await current.run();
        } catch (_) {
            showToast('打开失败，请重试');
        }
    }
}

const globalSearchPalette = new GlobalSearchPalette();

document.addEventListener('keydown', (event) => globalSearchPalette.handleGlobalKeydown(event), true);
