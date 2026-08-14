/**
 * chat_workflow.js — 工作流视图四件套（Feed/Designer/Placeholder/Sidebar）
 *
 * 职责：工作流视图四件套（Feed/Designer/Placeholder/Sidebar）；从 chat.js 批量迁移。
 * 共享可变状态通过 window.xxx live-binding 读写（exposeLiveState 桥接）。
 *
 * 对外 window 桥接清单：
 *   - openWorkflowFeed
 *   - openWorkflowDesigner
 *   - openWorkflowPlaceholderView
 *   - toggleWorkflowSidebar
 *   - toggleWorkflowListGroup
 *   - copyGeneratedInfo
 *   - copyUserMessage
 *
 * 依赖 store 子域：
 *   - store.conversation
 *
 * 设计形态：函数式
 */
import { store } from './store/index.js';
import {
    applyDesktopHeaderTools,
    closeKnowledgeView,
    knowledgeEditorController,
    messageActionsController,
    refreshWorkflowSidebarToggleState,
    restoreWorkspaceDetailInputContainerForConversationLoad,
    selectWorkflowNode,
    setWorkflowDesignerTitle,
    setWorkflowMainMode,
    setWorkflowSidebarActiveWorkflow,
    updateWorkflowCanvasScale,
} from './chat.js?v=20260731_profile_center_01';
import {
    closeCloudFilePanel,
    closeKnowledgePanel,
} from './chat_wss_sync.js?v=20260810_chatjs_split_01';

function openWorkflowFeed() {
    setWorkflowMainMode('feed');
    document.querySelectorAll('.workflow-list-items li[data-workflow-id]').forEach((el) => {
        el.classList.remove('active');
    });
};

function openWorkflowDesigner(workflowId, workflowTitle = '', workflowSub = '') {
    const id = String(workflowId || '').trim();
    if (!id) return;
    const ws = document.getElementById('workflowSidebar');
    if (ws) {
        ws.classList.remove('collapsed');
        refreshWorkflowSidebarToggleState();
    }
    setWorkflowSidebarActiveWorkflow(id);
    setWorkflowDesignerTitle(workflowTitle || '流程画布', workflowSub || '可视化节点编排（占位）');
    setWorkflowMainMode('designer');
    selectWorkflowNode('trigger');
};

function openWorkflowPlaceholderView() {
    closeKnowledgePanel();
    closeCloudFilePanel();

    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if (!viewer || !msgs || !headerTitle || !headerLeft || !headerRight) return;

    restoreWorkspaceDetailInputContainerForConversationLoad();

    if (!window.originalHeaderState) {
        window.originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }

    knowledgeEditorController.clearCurrentTitle();
    knowledgeEditorController.clearPendingHighlightData();
    window.navigationStack = [];

    msgs.style.display = 'none';
    const inputDock = document.querySelector('.input-dock');
    if (inputDock) inputDock.style.display = 'none';
    if (inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';

    headerTitle.textContent = 'AI 自动流程';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    applyDesktopHeaderTools(headerRight);

    viewer.innerHTML = `
        <section class="workflow-workspace">
            <aside class="workflow-sidebar" id="workflowSidebar">
                <div class="workflow-sidebar-head">
                    <span class="workflow-sidebar-title">我的 AI 流程</span>
                    <button class="workflow-sidebar-toggle" type="button" title="折叠侧栏" onclick="toggleWorkflowSidebar()">
                        <i class="fa-solid fa-angles-left"></i>
                    </button>
                </div>
                <div class="workflow-sidebar-body">
                    <div class="workflow-sidebar-list">
                        <div class="workflow-list-group open" data-group="running">
                            <button class="workflow-list-group-title" type="button" onclick="toggleWorkflowListGroup('running')">
                                <i class="fa-solid fa-chevron-down"></i>
                                运行中
                            </button>
                            <ul class="workflow-list-items">
                                <li data-workflow-id="wf_daily_sync" onclick="openWorkflowDesigner('wf_daily_sync','日报聚合流程','已运行 42 次 · 平均耗时 11s')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-newspaper workflow-item-icon blue"></i>
                                        <span class="workflow-item-text">
                                            <strong>日报聚合</strong>
                                            <small>09:00 定时</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill success">RUN</span>
                                </li>
                                <li data-workflow-id="wf_kb_refresh" onclick="openWorkflowDesigner('wf_kb_refresh','知识库刷新流程','每 4 小时巡检一次 · 向量增量更新')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-database workflow-item-icon cyan"></i>
                                        <span class="workflow-item-text">
                                            <strong>知识刷新</strong>
                                            <small>增量同步</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill info">IDLE</span>
                                </li>
                            </ul>
                        </div>

                        <div class="workflow-list-group open" data-group="drafts">
                            <button class="workflow-list-group-title" type="button" onclick="toggleWorkflowListGroup('drafts')">
                                <i class="fa-solid fa-chevron-down"></i>
                                草稿
                            </button>
                            <ul class="workflow-list-items">
                                <li data-workflow-id="wf_mail_robot" onclick="openWorkflowDesigner('wf_mail_robot','邮件机器人流程','提取附件摘要并自动分发')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-envelope-open-text workflow-item-icon violet"></i>
                                        <span class="workflow-item-text">
                                            <strong>邮件机器人</strong>
                                            <small>待启用</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill warn">DRAFT</span>
                                </li>
                                <li data-workflow-id="wf_report_export" onclick="openWorkflowDesigner('wf_report_export','周报导出流程','每周五自动导出并分享')">
                                    <span class="workflow-item-main">
                                        <i class="fa-solid fa-file-export workflow-item-icon amber"></i>
                                        <span class="workflow-item-text">
                                            <strong>周报导出</strong>
                                            <small>模板流程</small>
                                        </span>
                                    </span>
                                    <span class="workflow-pill neutral">NEW</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </aside>

            <div class="workflow-main">
                <div class="workflow-main-feed" id="workflowMainFeed">
                    <div class="workflow-feed-hero">
                        <div class="workflow-badge">Workflow Hub</div>
                        <h2>流程共享与近期动态</h2>
                        <p>默认展示公开流程与最近运行信息。点击左侧流程可进入对应画布。</p>
                    </div>

                    <section class="workflow-share-section">
                        <div class="workflow-section-head">
                            <h3>公开流程共享</h3>
                            <span>本周更新 18</span>
                        </div>
                        <div class="workflow-share-grid">
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag blue">知识库</span>
                                    <span class="workflow-share-uses">1.2k uses</span>
                                </div>
                                <h4>RAG 问答增强链路</h4>
                                <p>检索 + 重排 + 引用输出，适用于企业知识问答。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag cyan">自动化</span>
                                    <span class="workflow-share-uses">830 uses</span>
                                </div>
                                <h4>日报自动汇总</h4>
                                <p>收集群消息、文档、邮件，生成结构化日报。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag violet">运营</span>
                                    <span class="workflow-share-uses">640 uses</span>
                                </div>
                                <h4>多渠道内容分发</h4>
                                <p>从素材库生成多平台版本并自动发布。</p>
                            </article>
                            <article class="workflow-share-card">
                                <div class="workflow-share-card-head">
                                    <span class="workflow-share-tag amber">客服</span>
                                    <span class="workflow-share-uses">512 uses</span>
                                </div>
                                <h4>工单分诊助手</h4>
                                <p>自动识别优先级，分配到对应处理人。</p>
                            </article>
                        </div>
                    </section>

                    <section class="workflow-recent-section">
                        <div class="workflow-section-head">
                            <h3>近期流程信息</h3>
                            <span>最近 24 小时</span>
                        </div>
                        <div class="workflow-recent-list">
                            <div class="workflow-recent-item">
                                <span class="dot success"></span>
                                <div>
                                    <strong>日报聚合</strong>
                                    <small>09:00 运行成功，耗时 9.8s，输出 3 条摘要</small>
                                </div>
                            </div>
                            <div class="workflow-recent-item">
                                <span class="dot warn"></span>
                                <div>
                                    <strong>知识刷新</strong>
                                    <small>10:30 部分文档分块失败，已自动重试</small>
                                </div>
                            </div>
                            <div class="workflow-recent-item">
                                <span class="dot info"></span>
                                <div>
                                    <strong>邮件机器人</strong>
                                    <small>新增共享模板版本 v1.3，可直接套用</small>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="workflow-main-designer" id="workflowMainDesigner" style="display:none;">
                    <div class="workflow-designer-head">
                        <div>
                            <h2 id="workflowDesignerTitle">流程画布</h2>
                            <p id="workflowDesignerSub">可视化节点编排（占位）</p>
                        </div>
                        <button type="button" class="workflow-designer-back" onclick="openWorkflowFeed()">返回共享页</button>
                    </div>

                    <div class="workflow-canvas-wrap" id="workflowCanvasWrap">
                        <div class="workflow-canvas-fit" id="workflowCanvasFit">
                            <div class="workflow-canvas workflow-graph" id="workflowCanvas">
                            <svg class="workflow-graph-links" viewBox="0 0 1520 820" preserveAspectRatio="none" aria-hidden="true">
                                <path d="M286 245 C 350 245, 372 185, 460 185"></path>
                                <path d="M286 245 C 350 245, 372 450, 460 450"></path>
                                <path d="M722 185 C 798 185, 822 120, 930 120"></path>
                                <path d="M722 185 C 798 185, 822 285, 930 285"></path>
                                <path d="M722 450 C 798 450, 822 400, 930 400"></path>
                                <path d="M722 450 C 798 450, 822 625, 930 625"></path>
                                <path d="M1192 120 C 1270 120, 1295 245, 1380 245"></path>
                                <path d="M1192 285 C 1270 285, 1295 245, 1380 245"></path>
                                <path d="M1192 400 C 1270 400, 1295 570, 1380 570"></path>
                                <path d="M1192 625 C 1270 625, 1295 570, 1380 570"></path>
                            </svg>

                            <div class="workflow-graph-node tone-trigger n-trigger active" data-node-key="trigger" onclick="selectWorkflowNode('trigger')">
                                <span class="workflow-node-icon"><i class="fa-regular fa-clock"></i></span>
                                <span class="workflow-node-title">触发器</span>
                                <small class="workflow-node-sub">定时 / Webhook</small>
                            </div>
                            <div class="workflow-graph-node tone-process n-a" data-node-key="a" onclick="selectWorkflowNode('a')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-list-check"></i></span>
                                <span class="workflow-node-title">主分支处理</span>
                                <small class="workflow-node-sub">聚合与结构化</small>
                            </div>
                            <div class="workflow-graph-node tone-process n-b" data-node-key="b" onclick="selectWorkflowNode('b')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-shield-halved"></i></span>
                                <span class="workflow-node-title">兜底分支</span>
                                <small class="workflow-node-sub">降级与补偿</small>
                            </div>
                            <div class="workflow-graph-node tone-tool n-a1" data-node-key="a1" onclick="selectWorkflowNode('a1')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                                <span class="workflow-node-title">检索增强</span>
                                <small class="workflow-node-sub">RAG Query</small>
                            </div>
                            <div class="workflow-graph-node tone-tool n-a2" data-node-key="a2" onclick="selectWorkflowNode('a2')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-code-branch"></i></span>
                                <span class="workflow-node-title">逻辑路由</span>
                                <small class="workflow-node-sub">条件分流</small>
                            </div>
                            <div class="workflow-graph-node tone-output n-b1" data-node-key="b1" onclick="selectWorkflowNode('b1')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-envelope"></i></span>
                                <span class="workflow-node-title">通知输出</span>
                                <small class="workflow-node-sub">Mail / IM</small>
                            </div>
                            <div class="workflow-graph-node tone-output n-b2" data-node-key="b2" onclick="selectWorkflowNode('b2')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-floppy-disk"></i></span>
                                <span class="workflow-node-title">存储归档</span>
                                <small class="workflow-node-sub">Knowledge / File</small>
                            </div>
                            <div class="workflow-graph-node tone-end n-end-top" data-node-key="end_a" onclick="selectWorkflowNode('end_a')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-check"></i></span>
                                <span class="workflow-node-title">成功收敛</span>
                                <small class="workflow-node-sub">主路径完成</small>
                            </div>
                            <div class="workflow-graph-node tone-end n-end-bottom" data-node-key="end_b" onclick="selectWorkflowNode('end_b')">
                                <span class="workflow-node-icon"><i class="fa-solid fa-triangle-exclamation"></i></span>
                                <span class="workflow-node-title">异常收敛</span>
                                <small class="workflow-node-sub">兜底完成</small>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
    bindWorkflowCanvasInteractions();
    setWorkflowMainMode('feed');
};

function bindWorkflowCanvasInteractions() {
    const wrap = document.getElementById('workflowCanvasWrap');
    if (!wrap || wrap.dataset.bindDone === '1') return;
    wrap.dataset.bindDone = '1';

    wrap.addEventListener('wheel', (e) => {
        const absX = Math.abs(Number(e.deltaX || 0));
        const absY = Math.abs(Number(e.deltaY || 0));
        if (absY <= absX) return;
        e.preventDefault();
        wrap.scrollLeft += e.deltaY;
    }, { passive: false });

    if (!window.__workflowScaleResizeBound) {
        window.__workflowScaleResizeBound = true;
        window.addEventListener('resize', () => updateWorkflowCanvasScale());
    }
    requestAnimationFrame(() => {
        updateWorkflowCanvasScale();
    });
}

function toggleWorkflowSidebar() {
    const ws = document.getElementById('workflowSidebar');
    if (!ws) return;
    ws.classList.toggle('collapsed');
    refreshWorkflowSidebarToggleState();
    updateWorkflowCanvasScale();
    setTimeout(() => updateWorkflowCanvasScale(), 220);
};

function toggleWorkflowListGroup(groupId) {
    const key = String(groupId || '').trim();
    if (!key) return;
    const root = document.querySelector(`.workflow-list-group[data-group="${key}"]`);
    if (!root) return;
    root.classList.toggle('open');
};

function copyGeneratedInfo(index) {
    return messageActionsController.copyGeneratedInfo(index);
};

async function copyTextToClipboardSafe(text) {
    const payload = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
        return;
    }
    const ta = document.createElement('textarea');
    ta.value = payload;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
}

function copyUserMessage(index) {
    return messageActionsController.copyUserMessage(index);
};

// ─── window 桥接 ───
window.openWorkflowFeed = openWorkflowFeed;
window.openWorkflowDesigner = openWorkflowDesigner;
window.openWorkflowPlaceholderView = openWorkflowPlaceholderView;
window.toggleWorkflowSidebar = toggleWorkflowSidebar;
window.toggleWorkflowListGroup = toggleWorkflowListGroup;
window.copyGeneratedInfo = copyGeneratedInfo;
window.copyUserMessage = copyUserMessage;

// ─── 命名导出（供 chat.js 过渡期 import） ───
export {
    bindWorkflowCanvasInteractions,
    copyGeneratedInfo,
    copyTextToClipboardSafe,
    copyUserMessage,
    openWorkflowDesigner,
    openWorkflowFeed,
    openWorkflowPlaceholderView,
    toggleWorkflowListGroup,
    toggleWorkflowSidebar,
};
