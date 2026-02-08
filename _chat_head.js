// Global State
let currentConversationId = null;
let currentAbortController = null;
let isGenerating = false;
let shouldAutoScroll = true; // Auto-scroll control
let uploadedFileIds = []; // Uploaded files {id, name}
let currentUsername = null;
let currentUserRole = 'member';

// DOM Elements
const els = {
    sidebar: document.getElementById('sidebar'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    fileInput: document.getElementById('fileInput'),
    filePreviewArea: document.getElementById('filePreviewArea'),
    sendBtn: document.getElementById('sendBtn'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    // New Model Selector
    modelSelectContainer: document.getElementById('modelSelectContainer'),
    currentModelDisplay: document.getElementById('currentModelDisplay'),
    modelOptions: document.getElementById('modelOptions'),
    // ...
    conversationList: document.getElementById('conversationList'),
    newChatBtn: document.getElementById('newChatBtn'),
    conversationTitle: document.getElementById('conversationTitle'),
    knowledgePanel: document.getElementById('knowledgePanel'),
    toggleKnowledgePanel: document.getElementById('toggleKnowledgePanel'),
    btnTogglePanel: document.getElementById('btnTogglePanel'), // Close button inside panel
    refreshKnowledgeBtn: document.getElementById('refreshKnowledgeBtn'),
    panelBasisList: document.getElementById('panelBasisKnowledgeList'),
    panelShortList: document.getElementById('panelShortMemoryList'),
    panelBasisCount: document.getElementById('panelBasisCount'),
    panelShortCount: document.getElementById('panelShortCount'),
    tokenDisplay: document.getElementById('tokenDisplay'),
    modalTotalTokens: document.getElementById('modalTotalTokens'),
    modalTodayTokens: document.getElementById('modalTodayTokens'),
    tokenModal: document.getElementById('tokenModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    totalInputTokens: document.getElementById('totalInputTokens'),
    totalOutputTokens: document.getElementById('totalOutputTokens'),
    // Options
    checkThinking: document.getElementById('enableThinking'),
    checkSearch: document.getElementById('enableWebSearch'),
    checkTools: document.getElementById('enableTools'),
    // Admin & User Menu
    userMenu: document.getElementById('userMenu'),
    usernameBtn: document.getElementById('usernameBtn'),
    adminLink: document.getElementById('adminBackendBtn'),
    adminModal: document.getElementById('adminModal'),
    closeAdminBtn: document.getElementById('closeAdminBtn'),
    userTableBody: document.getElementById('userTableBody'),
    userCount: document.getElementById('userCount')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    loadModels();
    loadConversations();
    
    // Check URL param for conversation ID
    const urlParams = new URLSearchParams(window.location.search);
    const cid = urlParams.get('cid');
    if (cid) {
        loadConversation(cid);
    } else {
        // Init load knowledge even without conversation
        loadKnowledge(null);
    }
});

function initUI() {
    // Event Listeners
    if(els.sendBtn) els.sendBtn.addEventListener('click', sendMessage);
    
    // File Input
    if(els.fileInput) els.fileInput.addEventListener('change', handleFileUpload);
    
    if(els.messageInput) {
        els.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        // Auto-resize textarea
        els.messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto'; // Reset
        });
    }

    // Auto-scroll logic
    if (els.messagesContainer) {
        // [Optimization] Immediate manual override listeners
        // This ensures that any user interaction immediately disables auto-scroll
        // providing a "crisp" detachment feeling like standard native apps.
        const breakAutoScroll = () => { shouldAutoScroll = false; };
        
        els.messagesContainer.addEventListener('wheel', (e) => {
            if (e.deltaY < 0) breakAutoScroll(); // Only on scroll up
        }, { passive: true });
        
        els.messagesContainer.addEventListener('touchmove', breakAutoScroll, { passive: true });

        els.messagesContainer.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = els.messagesContainer;
            const distance = scrollHeight - scrollTop - clientHeight;
            
            // [Optimization] Ultra-tight threshold (2px)
            // Only latch if we are practically at the very bottom.
            // This prevents the "rubber band" effect when dragging slightly up.
            if (distance <= 2) {
                shouldAutoScroll = true;
            } else {
                shouldAutoScroll = false;
            }
        });
    }

    // Sidebar Toggles
    if(els.toggleSidebar) {
        els.toggleSidebar.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                els.sidebar.classList.toggle('mobile-open');
            } else {
                els.sidebar.classList.toggle('collapsed');
            }
        });
    }
    
    const mobileToggle = document.getElementById('toggleSidebarMobile');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            els.sidebar.classList.toggle('mobile-open');
        });
    }

    // Knowledge Panel
    const toggleKP = () => els.knowledgePanel.classList.toggle('visible');
    if(els.toggleKnowledgePanel) els.toggleKnowledgePanel.addEventListener('click', toggleKP);
    if(els.btnTogglePanel) els.btnTogglePanel.addEventListener('click', toggleKP);

    if(els.refreshKnowledgeBtn) {
        els.refreshKnowledgeBtn.addEventListener('click', () => loadKnowledge(currentConversationId));
    }

    // New Chat
    if(els.newChatBtn) els.newChatBtn.addEventListener('click', () => createNewConversation());

    // Token Modal
    if(els.tokenDisplay) els.tokenDisplay.addEventListener('click', openTokenModal);
    if(els.closeModalBtn) els.closeModalBtn.addEventListener('click', () => els.tokenModal.classList.remove('active'));
    if(els.tokenModal) els.tokenModal.addEventListener('click', (e) => {
        if(e.target === els.tokenModal) els.tokenModal.classList.remove('active');
    });

    // User Menu & Admin
    if (els.usernameBtn) {
        els.usernameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            els.userMenu.classList.toggle('active');
            if (els.userMenu.classList.contains('active')) {
                checkUserRole(); // 展开菜单时实时获取权限
            }
        });
    }

    // Prevent menu from closing when clicking inside it
    if (els.userMenu) {
        els.userMenu.addEventListener('click', (e) => {
            // e.stopPropagation(); // 这一行去掉，允许冒泡到 document.click 来关闭菜单，或者手动关闭
        });
        
        // 点击菜单项后自动关闭
        els.userMenu.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                els.userMenu.classList.remove('active');
            });
        });
    }

    document.addEventListener('click', () => {
        if(els.userMenu) els.userMenu.classList.remove('active');
    });

    // Check user role and show admin menu if needed
    checkUserRole();

    // Settings button click
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (els.userMenu) els.userMenu.classList.remove('active');
            // Currently settings is a placeholder
            showToast('设置功能稍后上线');
        });
    }

    // Admin button click
    const adminBtn = document.getElementById('adminBackendBtn');
    if (adminBtn) {
        adminBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 阻止冒泡
            if (els.userMenu) els.userMenu.classList.remove('active'); // 明确关闭小菜单
            openAdminDashboard();
        });
    }

    // Admin Modal close button
    const closeAdminBtn = document.getElementById('closeAdminModal');
    if (closeAdminBtn) {
        closeAdminBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const adminModal = document.getElementById('adminModal');
            if (adminModal) adminModal.classList.remove('active');
        });
    }

    // Admin Modal backdrop click
    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
        adminModal.addEventListener('click', (e) => {
            if (e.target === adminModal) {
                e.preventDefault();
                e.stopPropagation();
                adminModal.classList.remove('active');
            }
        });
    }

    // 添加用户 Modal 相关
    const openAddUserBtn = document.getElementById('openAddUserForm'); 
    if (openAddUserBtn) {
        openAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openAddUserModal();
        });
    }

    const cancelAddUserBtn = document.getElementById('cancelAddUser');
    if (cancelAddUserBtn) {
        cancelAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAddUserModal();
        });
    }
    
    // 给 AddUser Modal 的背景也加个点击关闭
    const addUserModal = document.getElementById('addUserModal');
    if (addUserModal) {
        addUserModal.addEventListener('click', (e) => {
            if (e.target === addUserModal) {
                e.preventDefault();
                e.stopPropagation();
                closeAddUserModal();
            }
        });
    }
    
    // 给 Token Modal 的具体关闭按钮也补一下
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (els.tokenModal) els.tokenModal.classList.remove('active');
        });
    }

    // Admin tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchAdminTab(tabName);
        });
    });

    const submitAddUserBtn = document.getElementById('addUserBtn');
    if (submitAddUserBtn) {
        submitAddUserBtn.addEventListener('click', (e) => {
            e.preventDefault();
            submitAddUser();
        });
    }
}

async function openTokenModal() {
    if(!els.tokenModal) return;
    els.tokenModal.classList.add('active');
    
    try {
        const res = await fetch('/api/tokens/stats');
        const data = await res.json();
        if(data.success) {
            if(els.modalTotalTokens) els.modalTotalTokens.textContent = data.total.toLocaleString();
            if(els.modalTodayTokens) els.modalTodayTokens.textContent = (data.today || 0).toLocaleString();
            
            // 渲染历史日志
            const logsTableBody = document.getElementById('tokenLogsTableBody');
            if (logsTableBody && data.history) {
                logsTableBody.innerHTML = data.history.map(log => {
                    const total = (log.input_tokens || 0) + (log.output_tokens || 0);
                    const timeStr = log.timestamp ? log.timestamp.split(' ')[1] || log.timestamp : '-';
                    const dateStr = log.timestamp ? log.timestamp.split(' ')[0] : '-';
                    return `
                        <tr>
                            <td title="${log.timestamp}">
                                <div style="font-size: 11px; white-space: nowrap;">${dateStr}</div>
                                <div style="font-weight: bold; font-family: 'JetBrains Mono'; color: #64748b;">${timeStr}</div>
                            </td>
                            <td class="title-cell" title="${log.conversation_title || ''}">
                                <div class="text-truncate">${log.conversation_title || 'Chat Operation'}</div>
                            </td>
                            <td>
                                <span class="action-badge ${log.action}">${(log.action || 'chat').toUpperCase()}</span>
                            </td>
                            <td class="num">
                                <div style="font-size: 10px; color: #94a3b8;">${log.input_tokens}+${log.output_tokens}</div>
                                <div style="font-weight: 800; font-family: 'JetBrains Mono';">${total.toLocaleString()}</div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch(e) { console.error("Error loading token stats", e); }
}

// --- Conversations ---
async function loadConversations() {
    try {
        const res = await fetch('/api/conversations');
        const data = await res.json();
        // Assuming data is array or object with list
        // API usually returns dict keys as IDs? Or list?
        // Let's assume list for now or adapt.
        const list = Array.isArray(data) ? data : (data.conversations || []);
        renderConversationList(list);
    } catch (e) {
        console.error("Failed to load conversations", e);
    }
}

function renderConversationList(conversations) {
    if(!els.conversationList) return;
    els.conversationList.innerHTML = '';
    
    // Sort logic if needed? 
    // Assuming backend returns sorted or we just list them.
    
    conversations.forEach(c => {
        const div = document.createElement('div');
        const cid = c.conversation_id || c.id; // Handle both
        div.className = `conversation-item ${cid === currentConversationId ? 'active' : ''}`;
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'title'; // Add class for CSS styling
        titleSpan.textContent = c.title || c.preview || `Conversation ${cid}`;
        div.appendChild(titleSpan);
        
        div.onclick = () => loadConversation(cid);
        
        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon-small delete-chat';
        delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteConversation(cid);
        };
        div.appendChild(delBtn);
        
        els.conversationList.appendChild(div);
    });
}

async function createNewConversation(silent = false) {
    if(!silent) {
        // Clear UI
        currentConversationId = null;
        els.messagesContainer.innerHTML = `
            <div class="welcome-screen">
                <h1>Hello.</h1>
                <p>Start a new conversation.</p>
            </div>
        `;
        els.conversationTitle.textContent = 'New Chat';
        els.totalInputTokens.textContent = '0';
        els.totalOutputTokens.textContent = '0';
        if(window.history.pushState) window.history.pushState({}, '', '/chat');
        
        // Refresh list to remove active state
        loadConversations();
    }
}

async function loadConversation(id) {
    currentConversationId = id;
    els.messagesContainer.innerHTML = ''; // Loading state
    
    // Update URL
    if(window.history.pushState) window.history.pushState({}, '', `/chat?cid=${id}`);

    try {
        // Load messages
        const res = await fetch(`/api/conversations/${id}`);
        const data = await res.json();
        
        if (data.success && data.conversation) {
            // Render
            renderMessages(data.conversation.messages);
            if(els.conversationTitle) els.conversationTitle.textContent = data.conversation.title || "Conversation " + id;
        } else {
            console.error("Failed to load conversation:", data.message);
        }
        
        // Update Token Counts (if available in stored data, otherwise calc)
        
        // Load Knowledge
        loadKnowledge(id);
        
        // Highlight in sidebar
        loadConversations(); 
        
    } catch (e) {
        console.error("Error loading chat", e);
    }
}

async function deleteConversation(id) {
    if(!confirm("Delete this conversation?")) return;
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if(currentConversationId === id) createNewConversation();
    loadConversations();
}

// --- Messaging ---
const sendIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const stopIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>`;

function updateSendButtonState() {
    if (!els.sendBtn) return;
    if (isGenerating) {
        els.sendBtn.classList.add('stop-mode');
        els.sendBtn.innerHTML = stopIcon;
        els.sendBtn.title = "Stop Generation";
    } else {
        els.sendBtn.classList.remove('stop-mode');
        els.sendBtn.innerHTML = sendIcon;
        els.sendBtn.title = "Send Message";
    }
}

function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
        isGenerating = false;
        updateSendButtonState();
    }
}

async function sendMessage() {
    const text = els.messageInput.value.trim();
    if (!text && !isGenerating && uploadedFileIds.length === 0) return;
    
    // 如果正在生成，则点击按钮的行为是停止生成
    if (isGenerating) {
        stopGeneration();
        return;
    }

    // UI Updates
    els.messageInput.value = '';
    els.messageInput.style.height = 'auto';
    
    // Configs
    const model = selectedModelId;
    const enableThinking = els.checkThinking ? els.checkThinking.checked : true;
    const enableSearch = els.checkSearch ? els.checkSearch.checked : true;
    const enableTools = els.checkTools ? els.checkTools.checked : true;

    // Prepare display content
    let displayContent = text;
    if (uploadedFileIds.length > 0) {
        displayContent += '\n\n' + uploadedFileIds.map(f => {
            return f.type === 'text' ? `[File Content: ${f.name}]` : `[Attachment: ${f.name}]`;
        }).join(' ');
    }

    // Add User Message to UI
    appendMessage({ role: 'user', content: displayContent });
    
    // Reset auto-scroll
    shouldAutoScroll = true;

    // Separate text files from Volc files
    let finalMessage = text;
    const volcFileIds = [];
    
    uploadedFileIds.forEach(f => {
        if (f.type === 'text') {
            finalMessage += `\n\n--- Start of File: ${f.name} ---\n${f.content}\n--- End of File: ${f.name} ---\n`;
        } else {
            volcFileIds.push(f.id);
        }
    });

    // Prepare API Payload
    const payload = {
        message: finalMessage,
        model_name: model,
        conversation_id: currentConversationId,
        enable_thinking: enableThinking,
        enable_web_search: enableSearch,
        enable_tools: enableTools,
        file_ids: volcFileIds
    };
    
    // Reset files
    uploadedFileIds = [];
    updateFilePreview();

    isGenerating = true;
    updateSendButtonState();
    
    // Create Placeholder for AI Response
    const aiMsgId = Date.now().toString(); // Temporary ID
    const aiMsgDiv = appendMessage({ role: 'assistant', content: '', id: aiMsgId, pending: true });
    let currentFullContent = '';
    let currentRoundContent = '';
    let currentContentSpan = null;
    
    // Create new abort controller
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: currentAbortController.signal
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // 流结束后，自动折叠所有思考栏（除非用户手动操作过）
                const thinkingBlocks = aiMsgDiv.querySelectorAll('.thinking-block');
                thinkingBlocks.forEach(thinkingBlock => {
                    if (thinkingBlock.dataset.userToggled !== 'true') {
                        setTimeout(() => {
                            thinkingBlock.classList.add('collapsed');
                        }, 500);
                    }
                });
                break;
            }
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') {
                        isGenerating = false;
                        updateSendButtonState();
                        continue;
                    }
                    try {
                        const chunk = JSON.parse(jsonStr);
                        
                        if (chunk.conversation_id) {
                            currentConversationId = chunk.conversation_id;
                        }

                        if (chunk.type === 'model_info') {
                            const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                            if (msgContentContainer && !msgContentContainer.querySelector('.model-badge')) {
                                const badge = document.createElement('div');
                                badge.className = 'model-badge';
                                badge.textContent = chunk.model_name;
                                msgContentContainer.appendChild(badge); 
                            }
                        }
                        
                        else if (chunk.type === 'content') {
                            currentFullContent += chunk.content;
                            currentRoundContent += chunk.content;
                            
                            // 如果当前没有正在渲染的内容Span，或者它不是消息气泡的最后一个元素（说明中间插入了工具）
                            const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                            if (!currentContentSpan || msgContentContainer.lastElementChild !== currentContentSpan) {
                                currentContentSpan = createContentSpan(aiMsgDiv);
                                currentRoundContent = chunk.content; // 新Round开始
                            }
                            
                            // 渲染当前Round的内容
                            // 注意：为了保持Markdown上下文一致性，我们通常倾向于在同一个Block显示
                            // 但用户要求在工具链下方显示，所以必须开启新Block
                            currentContentSpan.innerHTML = marked.parse(currentRoundContent);
                            renderMathInElement(currentContentSpan);
                            highlightCode(currentContentSpan);
                        } 
                        else if (chunk.type === 'reasoning_content') { 
                           const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                           // 核心逻辑：检查容器最后一个元素是否已经是正在输出的思考框
                           // 这样如果中间插入了工具调用，lastElementChild 就不再是当前思考框，从而触发新建
                           let thinkingBlock = msgContentContainer.lastElementChild;
                           
                           if(!thinkingBlock || !thinkingBlock.classList.contains('thinking-block')) {
                               thinkingBlock = document.createElement('div');
                               thinkingBlock.className = 'thinking-block'; // 流式输出时默认展开
                               thinkingBlock.dataset.userToggled = 'false'; // 跟踪用户是否手动操作过
                               thinkingBlock.innerHTML = `
                                <div class="thinking-header">
                                    <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <path d="M12 6v6l4 2"></path>
                                    </svg>
                                    <span class="thinking-title">思考过程</span>
                                    <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </div>
                                <div class="thinking-content"></div>
                               `;
                               
                               // 添加点击事件监听，记录用户手动操作
                               const header = thinkingBlock.querySelector('.thinking-header');
                               header.addEventListener('click', function() {
                                   thinkingBlock.classList.toggle('collapsed');
                                   thinkingBlock.dataset.userToggled = 'true'; // 标记用户已手动操作
                               });
                               
                               // 始终追加到末尾以保持时间线次序
                               msgContentContainer.appendChild(thinkingBlock);
                           }
                           
                           const contentDiv = thinkingBlock.querySelector('.thinking-content');
                           contentDiv.textContent += chunk.content;
                        }
                        // --- New Chunk Types Support ---
                        else if (chunk.type === 'web_search') {
                            updateWebSearchStatus(aiMsgDiv, chunk.status, chunk.query, chunk.content);
                        }
                        else if (chunk.type === 'function_call') {
                            // Special handling for addBasis to show content
                            if (chunk.name === 'addBasis') {
                                try {
                                    const args = JSON.parse(chunk.arguments);
                                    appendAddBasisView(aiMsgDiv, args);
                                } catch(e) { console.error("Error parsing addBasis args", e); }
                            }
                            appendToolEvent(aiMsgDiv, chunk.name, chunk.arguments, true);
                        }
                        else if (chunk.type === 'function_result') {
                            updateLastToolResult(aiMsgDiv, chunk.name, chunk.result);
                        }
                        else if (chunk.type === 'token_usage') {
                            if(els.totalInputTokens) els.totalInputTokens.textContent = chunk.total_tokens || chunk.input_tokens + chunk.output_tokens;
                        }
                        else if (chunk.type === 'title') {
                            if(els.conversationTitle) els.conversationTitle.textContent = chunk.title;
                        }
                        else if (chunk.type === 'error') {
                            aiMsgDiv.innerHTML += `<div class="error" style="color:red; margin:10px;">Error: ${chunk.content}</div>`;
                        }
                        
                    } catch (e) { console.error("Parse error", e); }
                }
            }
             // Auto-scroll
             if (shouldAutoScroll) {
                // Check if we are already near bottom before forcing script scroll
                // This prevents fighting if the user is actively trying to scroll up but hasn't passed threshold yet
                // However, if we just added content, we ARE effectively scrolled up.
                // So we really just want to apply scroll if the flag says so.
                requestAnimationFrame(() => {
                    els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
                });
             }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            aiMsgDiv.innerHTML += `<div class="error" style="color:#666; font-size:12px; margin-top:5px;">[Generation Terminated by User]</div>`;
        } else {
            aiMsgDiv.innerHTML += `<div class="error">Error: ${e.message}</div>`;
        }
        isGenerating = false;
    } finally {
        isGenerating = false;
        currentAbortController = null;
        updateSendButtonState();
        aiMsgDiv.classList.remove('pending');
        loadConversations(); // Update list preview
        loadKnowledge(currentConversationId); // Refresh knowledge
    }
}

function updateWebSearchStatus(aiMsgDiv, status, query, fullContent, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    
    // In history mode, we don't look for existing badges to update; we just append.
    let badge = isHistory ? null : parent.querySelector('.tool-usage[data-tool-name="Web Search"]:last-of-type');
    
    // Construct display text
    let displayText = status || fullContent;
    
    if (!badge) {
        // Create new
        const div = document.createElement('div');
        div.className = 'tool-usage';
        div.dataset.toolName = 'Web Search';
        div.dataset.query = query || ''; // Store query
        
        const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        
        div.innerHTML = `
            <div class="tool-badge">
                ${iconSvg}
                <span>Web Search</span>
                <span class="tool-status"></span>
            </div>
            <div class="tool-output" style="display:none;"></div>
        `;
        
        // 始终追加到末尾以保持时间线次序
        parent.appendChild(div);
        
        badge = div;
    }
    
    // Update Logic
    // If we have a new query, update stored
    if (query) badge.dataset.query = query;
    const currentQuery = badge.dataset.query;
    
    if (currentQuery) {
        displayText = `${status}: ${currentQuery}`;
    }
    
    badge.querySelector('.tool-status').textContent = displayText;
}

function appendAddBasisView(aiMsgDiv, args) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'add-basis-view';
    div.innerHTML = `
        <div class="add-basis-header">
            <span>ADDED KNOWLEDGE: ${args.title || 'Untitled'}</span>
            <span style="font-weight:normal; color:#999;">${(args.context || '').length} chars</span>
        </div>
        <div class="add-basis-content">${args.context || ''}</div>
    `;
    parent.appendChild(div);
}

function appendToolEvent(aiMsgDiv, name, details, isFunction = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const contentBody = parent.querySelector('.content-body');
    
    const div = document.createElement('div');
    div.className = 'tool-usage';
    div.dataset.toolName = name; // Marker
    
    // Icon selection
    let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>'; // default toolbox
    if(name === 'Web Search' || name === 'searchKeyword' || name === 'web_search') {
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    }

    let detailText = typeof details === 'object' ? JSON.stringify(details) : details;
    if(isFunction && detailText) detailText = `argsStr: ${detailText.substring(0, 50)}...`;

    div.innerHTML = `
        <div class="tool-badge">
            ${iconSvg}
            <span>${name}</span>
            <span class="tool-status">${detailText || ''}</span>
        </div>
        <div class="tool-output" style="display:none;"></div>
    `;
    
    // If content exists, insert before it? Usually tools come before content or interleaved.
    // If we are strictly streaming, we append to parent. 
    // But if 'content' already started, appending to parent puts it AFTER content, which is fine for interleaved.
    parent.appendChild(div);
    return div;
}

function updateLastToolResult(aiMsgDiv, name, result) {
    // Find the last tool usage of this name that doesn't have a result yet
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const tools = parent.querySelectorAll(`.tool-usage`);
    // Iterate backwards
    let target = null;
    for (let i = tools.length - 1; i >= 0; i--) {
        const t = tools[i];
        // Check if it matches name (loose check) and has hidden output (empty)
        // Just picking the last tool usage is usually safe given sequential execution
        if (t.dataset.toolName === name || (name === 'web_search' && t.dataset.toolName === 'Web Search')) {
            target = t;
            break;
        }
    }
    
    if (target) {
        const outDiv = target.querySelector('.tool-output');
        outDiv.style.display = 'block';
        outDiv.textContent = typeof result === 'object' ? JSON.stringify(result, null, 2) : result;
    }
}

function createContentSpan(parentMsgDiv) {
    const parent = parentMsgDiv.querySelector('.message-content') || parentMsgDiv;
    const span = document.createElement('div');
    span.className = 'content-body fade-in';
    parent.appendChild(span);
    return span;
}

function appendMessage(msg, index) {
    // If index is not provided (live message), calculate it based on current message count
    if (index === undefined || index === null) {
        index = els.messagesContainer.querySelectorAll('.message').length;
    }
    
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    if (msg.pending) div.classList.add('pending');
    div.dataset.index = index;
    
    // Avatar for AI
    if (msg.role === 'assistant') {
        const avatar = document.createElement('div');
        avatar.className = 'avatar ai';
        avatar.textContent = 'AI';
        div.appendChild(avatar);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    div.appendChild(content); // Append content container early so sub-renderers can find it
    
    if (msg.role === 'user') {
        // Wrap user content in bubble for alignment
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = marked.parse(msg.content);
        renderMathInElement(bubble, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false}
            ],
            throwOnError: false
        });
        content.appendChild(bubble);
        
        // User Message Actions (only delete)
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        actions.innerHTML = `
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;
        content.appendChild(actions);

    } else {
        // AI Message
        
        // Render reasoning_content (thinking process) if exists
        if (msg.metadata && msg.metadata.reasoning_content) {
            const thinkingBlock = document.createElement('div');
            thinkingBlock.className = 'thinking-block collapsed'; // 默认折叠
            thinkingBlock.innerHTML = `
                <div class="thinking-header">
                    <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                    </svg>
                    <span class="thinking-title">思考过程</span>
                    <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="thinking-content"></div>
            `;
            
            // 添加点击事件监听
            const header = thinkingBlock.querySelector('.thinking-header');
            header.addEventListener('click', function() {
                thinkingBlock.classList.toggle('collapsed');
            });
            
            thinkingBlock.querySelector('.thinking-content').textContent = msg.metadata.reasoning_content;
            content.appendChild(thinkingBlock);
        }
        
        // 渲染工具调用过程（Metadata中保存的Steps）
        if (msg.metadata && msg.metadata.process_steps) {
            msg.metadata.process_steps.forEach(step => {
                if (step.type === 'web_search') {
                    updateWebSearchStatus(div, step.status || step.content, step.query, step.content, true);
                }
                else if (step.type === 'function_call') {
                    if (step.name === 'addBasis') {
                        try {
                            const args = JSON.parse(step.arguments);
                            appendAddBasisView(div, args);
                        } catch(e) {}
                    }
                    appendToolEvent(div, step.name, step.arguments, true);
                }
                else if (step.type === 'function_result') {
                    updateLastToolResult(div, step.name, step.result);
                }
                else if (step.type === 'content') {
                    // 对于历史记录中穿插的文本内容
                    const body = document.createElement('div');
                    body.className = 'content-body';
                    body.innerHTML = marked.parse(step.content);
                    renderMathInElement(body);
                    highlightCode(body);
                    content.appendChild(body);
                }
            });
        }
        
        // Render main content (if not already handled by steps)
        // Note: For newer messages, content is often duplicated in steps as 'content' type
        const hasContentStep = msg.metadata && msg.metadata.process_steps && 
                               msg.metadata.process_steps.some(s => s.type === 'content');
                               
        if(msg.content && !hasContentStep) {
            const body = document.createElement('div');
            body.className = 'content-body';
            body.innerHTML = marked.parse(msg.content);
            renderMathInElement(body);
            highlightCode(body);
            content.appendChild(body);
        }

        // Add model badge/hint
        const modelName = msg.model_name || (msg.metadata && msg.metadata.model_name);
        if (modelName) {
            const badge = document.createElement('div');
            badge.className = 'model-badge';
            badge.textContent = modelName;
            content.appendChild(badge);
        }

        // AI Message Actions (Delete, Regenerate, Versioning)
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        
        // Branching (Versions)
        const versions = msg.metadata?.versions || [];
        if (versions.length > 0) {
            // 在我们的逻辑中，versions 数组里存的是之前的版本
            // 假设 versions 有 2 个元素，那么当前是第 3 个版本
            const totalVersions = versions.length + 1;
            const currentVerNum = totalVersions; // 默认当前显示的是最新的

            actions.innerHTML += `
                <div class="version-switcher">
                    <button class="btn-ver" onclick="switchVersion(${index}, ${versions.length - 1})" title="查看上一版本">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span>${currentVerNum} / ${totalVersions}</span>
                    <button class="btn-ver" disabled title="已经是最新版本">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
            `;
        }

        actions.innerHTML += `
            <button class="btn-action" onclick="confirmRegenerate(${index})" title="重新回答">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"></path></svg>
            </button>
            <button class="btn-action btn-del" onclick="confirmDelete(${index})" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
            </button>
        `;
        content.appendChild(actions);
    }

    els.messagesContainer.appendChild(div);
    
    // Remove welcome screen if exists
    const welcome = els.messagesContainer.querySelector('.welcome-screen');
    if(welcome) welcome.remove();

    // Scroll
    if (shouldAutoScroll) {
        els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
    }
    
    return div; // Return main message div
}

function renderMessages(messages, noScroll) {
    // preserve welcome if empty
    if(!messages || messages.length === 0) return;
    
    // Save current scroll position
    const oldScrollTop = els.messagesContainer.scrollTop;
    const oldScrollHeight = els.messagesContainer.scrollHeight;

    els.messagesContainer.innerHTML = '';
    messages.forEach((m, i) => appendMessage(m, i));
    
    // Restore or scroll
    if (noScroll) {
        // Try to maintain the relative scroll position if desired, 
        // but usually for delete/version-switch we just want to stay where we are
        els.messagesContainer.scrollTop = oldScrollTop;
    } else if (shouldAutoScroll) {
        els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
    }
}

// Global modal functions
window.confirmDelete = function(index) {
    if (!currentConversationId) {
        alert("此对话尚未保存，无法删除");
        return;
    }
    showConfirm("删除确认", "确定要删除这条消息及其后的所有内容吗？此操作不可撤销。", "danger", async () => {
        try {
            const res = await fetch('/api/delete_message', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    conversation_id: currentConversationId,
                    index: index
                })
            });
            const data = await res.json();
            if(data.success) {
                // Silent reload: fetch data and render without triggering initial animation effects
                const convRes = await fetch(`/api/conversations/${currentConversationId}`);
                const convData = await convRes.json();
                if (convData.success) {
                    renderMessages(convData.conversation.messages, true);
                }
            } else {
                alert("删除失败: " + data.message);
            }
        } catch(e) { console.error(e); }
    });
};

window.confirmRegenerate = function(index) {
    if (!currentConversationId) {
        alert("此对话尚未保存，无法重新回答");
        return;
    }
    showConfirm("重新回答", "我们将保留当前回答并生成一个新版本，确定要重新生成吗？", "primary", async () => {
        // Trigger regeneration
        startRegenerate(index);
    });
};

async function startRegenerate(index) {
    if (isGenerating) return;
    
    const modelName = selectedModelId;
    
    // Setup UI for generation
    isGenerating = true;
    updateSendButtonState();
    currentAbortController = new AbortController();
    
    try {
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                conversation_id: currentConversationId,
                model_name: modelName,
                is_regenerate: true,
                regenerate_index: index,
                enable_thinking: els.checkThinking.checked,
                enable_web_search: els.checkSearch.checked,
                enable_tools: els.checkTools.checked,
                show_token_usage: true
            }),
            signal: currentAbortController.signal
        });

        if (!response.ok) throw new Error("HTTP " + response.status);
        
        // Target specific message index for regeneration
        const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
        if (messageDiv) {
            const content = messageDiv.querySelector('.message-content');
            // Clean content while keeping model badge and actions toolbar skeletal
            const body = messageDiv.querySelector('.content-body');
            if (body) body.innerHTML = '';
            
            // Remove existing thinking blocks to restart
            const oldThinking = messageDiv.querySelector('.thinking-block');
            if (oldThinking) oldThinking.remove();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let accumulatedContent = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = jsonParseSafe(line.substring(6));
                    if(!data) continue;
                    
                    if (data.type === 'content') {
                        accumulatedContent += data.content;
                        updateMessageDivContent(index, accumulatedContent);
                    } else if (data.type === 'reasoning_content') {
                        updateMessageDivThinking(index, data.content);
                    } else if (data.type === 'web_search' || data.type === 'function_call' || data.type === 'function_result') {
                        updateMessageDivTools(index, data);
                    }
                } catch (e) { }
            }
        }
        
    } catch (e) {
        if (e.name === 'AbortError') console.log("Generation stopped.");
        else console.error(e);
    } finally {
        isGenerating = false;
        updateSendButtonState();
        
        // Final refresh to ensure all metadata/indices are locked
        const convRes = await fetch(`/api/conversations/${currentConversationId}`);
        const convData = await convRes.json();
        if (convData.success) {
            renderMessages(convData.conversation.messages, true);
        }
    }
}

function jsonParseSafe(str) {
    try { return JSON.parse(str); } catch(e) { return null; }
}

function updateMessageDivContent(index, fullText) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    let body = messageDiv.querySelector('.content-body');
    if (!body) {
        body = document.createElement('div');
        body.className = 'content-body';
        messageDiv.querySelector('.message-content').appendChild(body);
    }
    
    body.innerHTML = marked.parse(fullText);
    renderMathInElement(body);
    highlightCode(body);
    
    if (shouldAutoScroll) els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

function updateMessageDivThinking(index, delta) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    const content = messageDiv.querySelector('.message-content');
    let thinkingBlock = messageDiv.querySelector('.thinking-block');
    
    if (!thinkingBlock) {
        thinkingBlock = document.createElement('div');
        thinkingBlock.className = 'thinking-block'; // No collapsed by default during live gen
        thinkingBlock.innerHTML = `
            <div class="thinking-header">
                <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                </svg>
                <span class="thinking-title">思考过程</span>
                <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="thinking-content"></div>
        `;
        content.prepend(thinkingBlock); 
        
        const header = thinkingBlock.querySelector('.thinking-header');
        header.addEventListener('click', () => thinkingBlock.classList.toggle('collapsed'));
    }
    
    const textTarget = thinkingBlock.querySelector('.thinking-content');
    textTarget.textContent += delta;
}

function updateMessageDivTools(index, data) {
    const messageDiv = document.querySelector(`.message[data-index="${index}"]`);
    if (!messageDiv) return;
    
    if (data.type === 'web_search') {
        updateWebSearchStatus(messageDiv, data.status, data.query, data.content);
    } else if (data.type === 'function_call') {
        appendToolEvent(messageDiv, data.name, data.arguments);
    } else if (data.type === 'function_result') {
        updateLastToolResult(messageDiv, data.name, data.result);
    }
}

// Logic for Modal
window.showConfirm = function(title, message, type, onOk) {
    const backdrop = document.getElementById('confirmBackdrop');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    
    if (!backdrop || !okBtn) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    
    // Cleanup old event listeners
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    // Explicitly set text and style to ensure visibility
    if(type === 'danger') {
        newOkBtn.textContent = "确认删除";
        newOkBtn.className = "btn-confirm btn-confirm-del";
    } else {
        newOkBtn.textContent = "确定重新生成";
        newOkBtn.className = "btn-confirm";
    }
    
    backdrop.classList.add('active');
    
    newOkBtn.addEventListener('click', () => {
        backdrop.classList.remove('active');
        onOk();
    });
};

window.closeConfirmModal = function() {
    document.getElementById('confirmBackdrop').classList.remove('active');
};

window.switchVersion = async function(msgIndex, verIndex) {
    try {
        const res = await fetch('/api/switch_version', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                conversation_id: currentConversationId,
                message_index: msgIndex,
                version_index: verIndex
            })
        });
        const data = await res.json();
        if(data.success) {
            // Switch also should be silent
            const convRes = await fetch(`/api/conversations/${currentConversationId}`);
            const convData = await convRes.json();
            if (convData.success) {
                renderMessages(convData.conversation.messages, true);
            }
        }
    } catch(e) { console.error(e); }
};


// --- Knowledge ---
async function loadKnowledge(cid) {
    // Knowledge is likely user-global, not per conversation, but we reload on chat interactions
    try {
        const [resBasis, resShort] = await Promise.all([
            fetch('/api/knowledge/basis'),
            fetch('/api/knowledge/short')
        ]);
        
        const basisData = await resBasis.json();
        const shortData = await resShort.json();

        if (basisData.success) {
            renderKnowledgeList(els.panelBasisList, basisData.knowledge || [], 'basis');
            if(els.panelBasisCount) els.panelBasisCount.textContent = (basisData.knowledge || []).length;
        }
        if (shortData.success) {
            renderKnowledgeList(els.panelShortList, shortData.knowledge || [], 'short');
            if(els.panelShortCount) els.panelShortCount.textContent = (shortData.knowledge || []).length;
        }

    } catch(e) { console.error("Error loading knowledge", e); }
}

function renderKnowledgeList(container, items, type) {
    if(!container) return;
    container.innerHTML = '';
    items.forEach(item => {
        const title = typeof item === 'string' ? item : item.title;
        const div = document.createElement('div');
        div.className = 'knowledge-item';
        div.textContent = title;
        div.style.cursor = 'pointer';
        // Add click handler to view details ONLY for basis for now
        if(type === 'basis') {
             div.onclick = () => viewKnowledge(title);
        }
        else {
            div.onclick = () => {} // Maybe view short term too?
        }
        container.appendChild(div);
    });
}


// --- Knowledge View Logic ---
let easyMDE = null;
let originalHeaderState = null;
let currentViewingKnowledge = null;

async function viewKnowledge(title) {
    currentViewingKnowledge = title;
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if(!viewer || !msgs) return;
    
    // 1. Save Header State
    originalHeaderState = {
        title: headerTitle.textContent,
        leftHTML: headerLeft.innerHTML,
        rightHTML: headerRight.innerHTML
    };

    // 2. Fetch Content
    let content = '';
    try {
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`);
        const data = await res.json();
        if(data.success) content = data.knowledge.content;
    } catch(e) { console.error(e); }

    // 3. UI Switch
    msgs.style.display = 'none';
    if(inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'block';

    // 4. Update Header
    headerTitle.textContent = title;
    
    // Back Button (Left)
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;

    // Right Buttons: Settings, Save, Delete
    headerRight.innerHTML = `
        <div class="header-actions">
            <button class="btn-header-save" id="btnSaveKnowledge" onclick="saveKnowledge('${title.replace(/'/g, "\\'")}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                保存
            </button>
            <div class="header-divider"></div>
            <button class="btn-header-icon" onclick="openKnowledgeSettingsModal()" title="设置">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button class="btn-header-icon danger" onclick="confirmDeleteKnowledge('${title.replace(/'/g, "\\'")}')" title="删除">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>
    `;

    // 5. Initialize Editor
    if (!easyMDE) {
        easyMDE = new EasyMDE({ 
            element: document.getElementById('knowledgeEditor'),
            status: false,
            spellChecker: false,
            sideBySideFullscreen: false,
            previewRender: function(plainText) {
                const html = marked.parse(plainText);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                renderMathInElement(tempDiv, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
                return tempDiv.innerHTML;
            },
            toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", 
                      "link", "image", "table", "|", "preview", "side-by-side", "fullscreen"]
        });
        
        // 提示用户如何切换模式
        showToast('小贴士：点击编辑器工具栏中的“眼睛”图标可切换预览与编辑模式');
    }
    
    // Default to Preview Mode
    if (!easyMDE.isPreviewActive()) {
        EasyMDE.togglePreview(easyMDE);
    }
    
    const viewportHeight = window.innerHeight;
    const headerHeight = 60; 
    easyMDE.codemirror.setSize(null, `${viewportHeight - headerHeight}px`);

    easyMDE.value(content || '');
    setTimeout(() => easyMDE.codemirror.refresh(), 100);
}

function closeKnowledgeView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    viewer.style.display = 'none';
    msgs.style.display = 'flex';
    if(inputWrapper) inputWrapper.style.display = 'block';

    if (originalHeaderState) {
        headerTitle.textContent = originalHeaderState.title;
        headerLeft.innerHTML = originalHeaderState.leftHTML;
        headerRight.innerHTML = originalHeaderState.rightHTML;
        loadModels(); 
        
        const toggleSidebar = document.getElementById('toggleSidebar');
        if(toggleSidebar) toggleSidebar.onclick = () => {
            if (window.innerWidth <= 768) els.sidebar.classList.toggle('mobile-open');
            else els.sidebar.classList.toggle('collapsed');
        };
        const toggleKP = document.getElementById('toggleKnowledgePanel');
        if(toggleKP) toggleKP.onclick = () => els.knowledgePanel.classList.toggle('visible');
    }
    currentViewingKnowledge = null;
}

async function saveKnowledge(title) {
    if(!easyMDE) return;
    const content = easyMDE.value();
    
    try {
        const res = await fetch('/api/knowledge/basis/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ title, content })
        });
        const data = await res.json();
        if(data.success) {
            showToast('保存成功');
        } else {
            showToast('保存失败: ' + data.message);
        }
    } catch (e) {
        showToast('请求异常: ' + e.message);
    }
}

function confirmDeleteKnowledge(title) {
    showConfirm("删除知识", `确定要彻底删除 "${title}" 吗？此操作无法撤销。`, "danger", () => deleteKnowledge(title));
}

async function deleteKnowledge(title) {
    try {
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        closeConfirmModal();
        
        if(data.success) {
            showToast('删除成功');
            closeKnowledgeView();
            loadKnowledge(); 
        } else {
            showToast('删除失败: ' + (data.message || data.error));
        }
    } catch(e) {
        closeConfirmModal();
        showToast('请求异常: ' + e.message);
    }
}

// --- Knowledge Settings ---
async function openKnowledgeSettingsModal() {
    if (!currentViewingKnowledge) return;
    const title = currentViewingKnowledge;
    
    try {
        // Ensure we have username
        if(!currentUsername) await checkUserRole();

        const resMeta = await fetch('/api/knowledge/list');
        const metaData = await resMeta.json();
        
        const metadata = metaData.basis_knowledge[title];
        if (!metadata) return;

        document.getElementById('settingTargetTitle').value = title;
        document.getElementById('settingPublic').checked = metadata.public || false;
        document.getElementById('settingCollaborative').checked = metadata.collaborative || false;
        
        const shareSection = document.getElementById('shareLinkSection');
        if (metadata.public) {
            shareSection.style.display = 'block';
            const base = window.location.origin;
            // Ensure share_id is present (api returns it now)
            const shareId = metadata.share_id || 'unknown';
            document.getElementById('shareUrlDisplay').value = `${base}/public/knowledge/${currentUsername}/${shareId}`;
        } else {
            shareSection.style.display = 'none';
        }
        
        if (metadata.updated_at) {
            document.getElementById('lastModifyTime').textContent = new Date(metadata.updated_at * 1000).toLocaleString();
        }

        document.getElementById('knowledgeSettingsModal').classList.add('active');
    } catch(e) { console.error(e); }
}

function closeKnowledgeSettingsModal() {
    document.getElementById('knowledgeSettingsModal').classList.remove('active');
}

async function applyKnowledgeSettings() {
    const oldTitle = currentViewingKnowledge;
    const newTitle = document.getElementById('settingTargetTitle').value.trim();
    const isPublic = document.getElementById('settingPublic').checked;
    const isCollaborative = document.getElementById('settingCollaborative').checked;
    
    if (!newTitle) return showToast('标题不能为空');

    try {
        const res = await fetch('/api/knowledge/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                title: oldTitle,
                new_title: newTitle,
                public: isPublic,
                collaborative: isCollaborative
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('设置已更新');
            // update local current share_id if provided
            if (data.share_url) {
                // Update the share URL immediately
                const shareSection = document.getElementById('shareLinkSection');
                const urlInput = document.getElementById('shareUrlDisplay');
                shareSection.style.display = 'block';
                urlInput.value = data.share_url;
            } else if (!isPublic) {
                document.getElementById('shareLinkSection').style.display = 'none';
            }

            if (newTitle !== oldTitle) {
                closeKnowledgeSettingsModal(); // Must close if title changed as view logic depends on title
                closeKnowledgeView();
                viewKnowledge(newTitle);
            } else {
                // Do not close modal, user might want to copy link
                // Update title just in case
                if(currentViewingKnowledge) currentViewingKnowledge = newTitle;
            }
            loadKnowledge(); 
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch(e) { showToast('网络错误: ' + e.message); }
}

function copyShareUrl() {
    const input = document.getElementById('shareUrlDisplay');
    input.select();
    document.execCommand('copy');
    showToast('链接已复制');
}

function showToast(msg) {
    let toast = document.querySelector('.toast-notification');
    if(!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function loadKnowledge(cid) {
    try {
        const [resBasis, resShort] = await Promise.all([
            fetch('/api/knowledge/basis'),
            fetch('/api/knowledge/short')
        ]);
        
        const basisData = await resBasis.json();
        const shortData = await resShort.json();

        if (basisData.success) {
            renderKnowledgeList(els.panelBasisList, basisData.knowledge || [], 'basis');
            if(els.panelBasisCount) els.panelBasisCount.textContent = (basisData.knowledge || []).length;
        }
        if (shortData.success) {
            renderKnowledgeList(els.panelShortList, shortData.memories || shortData.knowledge || [], 'short');
            if(els.panelShortCount) els.panelShortCount.textContent = (shortData.memories || shortData.knowledge || []).length;
        }

    } catch(e) { console.error("Error loading knowledge", e); }
}

async function loadModels() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if(data.models) {
            renderCustomModelSelect(data.models, data.default_model);
        }
    } catch(e) { console.error("Error loading models", e); }
}

function renderCustomModelSelect(models, defaultModel) {
    if(!els.modelOptions) return;
    
    // Clear
    els.modelOptions.innerHTML = '';
    
    if (models.length === 0) {
        selectedModelId = null;
        if(els.currentModelName) els.currentModelName.textContent = '无可用的模型';
        return;
    }
    
    // Setup initial
    const stored = localStorage.getItem('selectedModel');
    const isValidStored = models.find(m => m.id === stored);
    const isValidDefault = models.find(m => m.id === defaultModel);
    
    selectedModelId = (isValidStored ? stored : (isValidDefault ? defaultModel : models[0].id));
    
    // Render Options
    models.forEach(m => {
        const div = document.createElement('div');
        div.className = 'model-option';
        const providerName = m.provider === 'volcengine' ? '火山' : 
                             m.provider === 'stepfun' ? '阶跃' : 
                             m.provider === 'suanli' ? '算力' : m.provider;
        
        const status = m.status || 'normal';
        const statusText = status === 'good' ? '快速' : 
                           status === 'slow' ? '缓慢' : 
                           status === 'error' ? '错误' : '正常';
        
        div.innerHTML = `
            <span class="name">${m.name}</span>
            <span class="provider">${providerName}</span>
            <span class="status-tag ${status}">${statusText}</span>
        `;
        div.onclick = () => selectModel(m.id, m.name);
        if(m.id === selectedModelId) div.classList.add('same-as-selected');
        els.modelOptions.appendChild(div);
    });
    
    // Set initial display
    const currentList = models.find(m => m.id === selectedModelId);
    if(currentList) els.currentModelDisplay.textContent = currentList.name;

    // Toggle logic
    els.currentModelDisplay.onclick = (e) => {
        e.stopPropagation();
        const isClosed = els.modelOptions.classList.contains('select-hide');
        closeAllSelects(); // Close any potential others or self cleanup
        
        if (isClosed) {
            els.modelOptions.classList.remove('select-hide');
            els.currentModelDisplay.classList.add('select-arrow-active');
        }
    };
    
    document.addEventListener('click', closeAllSelects);
}

function selectModel(id, name) {
    selectedModelId = id;
    localStorage.setItem('selectedModel', id);
    els.currentModelDisplay.textContent = name;
    
    // Visual update
    Array.from(els.modelOptions.children).forEach(c => {
         if(c.textContent === name) c.classList.add('same-as-selected');
         else c.classList.remove('same-as-selected');
    });
    
    els.modelOptions.classList.add('select-hide');
    els.currentModelDisplay.classList.remove('select-arrow-active');
}

function closeAllSelects(e) {
    if(els.modelOptions && !els.modelOptions.classList.contains('select-hide')) {
        // If click was outside container
         els.modelOptions.classList.add('select-hide');
         els.currentModelDisplay.classList.remove('select-arrow-active');
    }
}


// --- Utils ---
function highlightCode(element) {
    if(window.hljs) {
        element.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
}


// --- File Upload ---
async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    for (let file of files) {
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const loadingBadge = document.createElement('div');
            loadingBadge.textContent = 'Uploading ' + file.name + '...';
            loadingBadge.className = 'file-badge loading';
            loadingBadge.style.cssText = 'background:#eee; padding:2px 8px; border-radius:12px; font-size:12px;';
            if(els.filePreviewArea) {
                els.filePreviewArea.appendChild(loadingBadge);
                els.filePreviewArea.style.display = 'flex';
            }

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            loadingBadge.remove();

            if (data.success) {
                // Store based on type
                if (data.type === 'text') {
                    uploadedFileIds.push({
                        type: 'text', // local marker
                        content: data.content,
                        name: data.filename
                    });
                } else {
                    uploadedFileIds.push({
                        type: 'file',
                        id: data.file_id,
                        name: data.filename
                    });
                }
                updateFilePreview();
            } else {
                alert('Upload failed: ' + data.message);
            }
        } catch (err) {
            console.error(err);
            alert('Upload error');
        }
    }
    e.target.value = '';
}

function updateFilePreview() {
    if(!els.filePreviewArea) return;
    els.filePreviewArea.innerHTML = '';
    
    if (uploadedFileIds.length === 0) {
        els.filePreviewArea.style.display = 'none';
        return;
    }
    
    els.filePreviewArea.style.display = 'flex';
    
    uploadedFileIds.forEach((file, index) => {
        const badge = document.createElement('div');
        badge.className = 'file-badge';
        badge.style.cssText = 'background:#e1e4e8; padding:2px 8px; border-radius:12px; font-size:12px; display:flex; align-items:center; gap:5px;';
        
        badge.innerHTML = `
            <span>${file.name}</span>
            <span style="cursor:pointer; font-weight:bold; color:#666;" onclick="removeUploadedFile(${index})">×</span>
        `;
        els.filePreviewArea.appendChild(badge);
    });
}

window.removeUploadedFile = function(index) {
    uploadedFileIds.splice(index, 1);
    updateFilePreview();
}

// --- Admin Functions ---
// 检查用户角色并显示管理菜单
async function checkUserRole() {
    try {
        const res = await fetch('/api/user/info');
        const data = await res.json();
        if (data.success) {
            currentUsername = data.username;
            currentUserRole = data.role;
            
            // 设置头像首字母
            const avatar = document.getElementById('sidebar-avatar');
            if (avatar && data.username) {
                avatar.textContent = data.username.charAt(0).toUpperCase();
            }

            // 更新侧边栏用户名显示
            const profileName = document.querySelector('.profile-name');
            if (profileName) profileName.textContent = data.username;

            const adminBtn = document.getElementById('adminBackendBtn');
            if (data.role === 'admin') {
                document.body.classList.add('is-admin');
                if (adminBtn) {
                    adminBtn.style.setProperty('display', 'flex', 'important');
                }
            } else {
                document.body.classList.remove('is-admin');
                if (adminBtn) {
                    adminBtn.style.setProperty('display', 'none', 'important');
                }
            }
        }
    } catch (err) {
        console.log('Failed to check user role', err);
    }
}

// 打开管理后台
async function openAdminDashboard() {
    const adminModal = document.getElementById('adminModal');
    const userMenu = document.getElementById('userMenu');
    if (userMenu) userMenu.classList.remove('active'); // 自动折叠菜单
    
    if (!adminModal) return;
    adminModal.classList.add('active');
    
    // Load users list
    await loadAdminUsersList();
    
    // Load stats
    await loadAdminStats();
}

// 加载用户列表
async function loadAdminUsersList() {
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
            const usersList = document.getElementById('adminUsersList');
            if (!usersList) return;
            
            usersList.innerHTML = data.users.map(user => {
                const isSelf = user.username === currentUsername;
                return `
                    <tr class="${isSelf ? 'user-self' : ''}">
                        <td>
                            <strong>${user.username}</strong>
                            ${isSelf ? '<span style="color:#64748b; font-size:11px; margin-left:4px;">(YOU)</span>' : ''}
                        </td>
                        <td><code style="background:#f1f5f9; padding:2px 4px; border-radius:4px; font-size:12px;">${user.password}</code></td>
                        <td style="color:#64748b;">${user.last_ip || '-'}</td>
                        <td class="mono" style="font-weight:600;">${user.total_token_usage.toLocaleString()}</td>
                        <td>
                            <span class="badge ${user.role}">
                                ${user.role === 'admin' ? 'ADMIN' : 'MEMBER'}
                            </span>
                        </td>
                        <td>
                            <div style="display:flex; gap:8px;">
                                <button class="btn-primary-outline" style="padding: 2px 8px; font-size: 11px;" onclick="openUserModelPerm('${user.username}')">模型</button>
                                ${!isSelf ? `
                                    <button class="btn-primary-outline" onclick="changeUserRole('${user.username}', '${user.role === 'admin' ? 'member' : 'admin'}')">
                                        ${user.role === 'admin' ? '降级' : '提升'}
                                    </button>
                                    <button class="btn-danger-small" onclick="deleteAdminUser('${user.username}')">删除</button>
                                ` : `
                                    <span style="color:#ccc; font-size:12px;">Locked</span>
                                `}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Failed to load users list', err);
    }
}

// --- 模型权限管理 ---
let currentTargetPermUser = null;

window.openUserModelPerm = async function(username) {
    currentTargetPermUser = username;
    const modal = document.getElementById('modelPermModal');
    if (!modal) return;
    
    const targetUserSpan = document.getElementById('permTargetUser');
    if(targetUserSpan) targetUserSpan.textContent = username;
    modal.classList.add('active');
    
    const listContainer = document.getElementById('modelPermList');
    if(listContainer) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">加载模型列表中...</div>';
    }
    
    try {
        const res = await fetch(`/api/admin/user/models?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        
        if (data.success && listContainer) {
            listContainer.innerHTML = data.models.map(m => `
                <div class="perm-item" style="display: flex; align-items: center; padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">
                    <label style="display: flex; align-items: center; cursor: pointer; width: 100%; margin: 0;">
                        <input type="checkbox" class="model-perm-checkbox" data-id="${m.id}" ${!m.is_blocked ? 'checked' : ''} style="margin-right: 12px; width: 16px; height: 16px;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-weight: 600; font-size: 14px; color: #1e293b;">${m.name}</span>
                            <span style="font-size: 11px; color: #64748b; font-family: monospace;">${m.id}</span>
                        </div>
                    </label>
                </div>
            `).join('');
        } else if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444;">${data.message || '获取失败'}</div>`;
        }
    } catch (err) {
        if (listContainer) listContainer.innerHTML = '<div style="padding: 20px; color: #ef4444;">网络请求失败</div>';
    }
};

window.saveUserModelPermissions = async function() {
    if (!currentTargetPermUser) return;
    
    const checkboxes = document.querySelectorAll('.model-perm-checkbox');
    const blocked_models = [];
    checkboxes.forEach(cb => {
        if (!cb.checked) {
            blocked_models.push(cb.getAttribute('data-id'));
        }
    });
    
    try {
        const res = await fetch('/api/admin/user/models/update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: currentTargetPermUser,
                blocked_models: blocked_models
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('权限更新成功');
            closeModelPermModal();
            // 如果修改的是当前登录用户，则刷新页面
            if (currentTargetPermUser === currentUsername) {
                setTimeout(() => location.reload(), 800);
            }
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch (err) {
        showToast('保存时发生错误');
    }
};

window.closeModelPermModal = function() {
    const modal = document.getElementById('modelPermModal');
    if (modal) modal.classList.remove('active');
    currentTargetPermUser = null;
};

// 加载统计信息
async function loadAdminStats() {
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
            const totalUsers = data.users.length;
            const adminCount = data.users.filter(u => u.role === 'admin').length;
            
            document.getElementById('statTotalUsers').textContent = totalUsers;
            document.getElementById('statAdminCount').textContent = adminCount;
            
            // Get token stats
            const tokenRes = await fetch('/api/admin/tokens/stats');
            const tokenData = await tokenRes.json();
            if (tokenData.success) {
                document.getElementById('statTotalTokens').textContent = (tokenData.total || 0).toLocaleString();
            }
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// 切换标签页
function switchAdminTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Deactivate all buttons
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Activate selected button
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// 切换添加用户弹窗
function openAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.add('active');
        // 禁止底层管理弹窗的点击
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'none';
    }
}

function closeAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.remove('active');
        // 恢复底层管理弹窗的点击
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'auto';
    }
}

// 添加用户
async function submitAddUser() {
    const username = document.getElementById('formUsername').value.trim();
    const password = document.getElementById('formPassword').value.trim();
    const role = document.getElementById('formRole').value;
    
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }
    
    try {
        const res = await fetch('/api/admin/user/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.success) {
            alert('用户添加成功');
            document.getElementById('formUsername').value = '';
            document.getElementById('formPassword').value = '';
            closeAddUserModal(); // 关闭弹窗
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        alert('Network error');
    }
}

// 删除用户
async function deleteAdminUser(username) {
    if (username === currentUsername) {
        alert('你不能删除自己');
        return;
    }

    if (!confirm(`确定要删除用户 ${username} 吗？`)) return;
    
    try {
        const res = await fetch('/api/admin/user/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_username: username })
        });
        const data = await res.json();
        if (data.success) {
            alert('用户已删除');
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        alert('Network error');
    }
}

// 改变用户角色
async function changeUserRole(username, newRole) {
    if (username === currentUsername) {
        alert('你不能修改自己的权限');
        return;
    }
    
    // 增加确认弹窗
    if (!confirm(`确定要将 ${username} 的权限修改为 ${newRole === 'admin' ? '管理员' : '普通用户'} 吗？`)) {
        return;
    }

    try {
        const res = await fetch('/api/admin/user/role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, role: newRole })
        });
        const data = await res.json();
        if (data.success) {
            alert(`已将 ${username} 改为${newRole === 'admin' ? '管理员' : '普通用户'}`);
            await loadAdminUsersList();
            await loadAdminStats();
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        alert('Network error');
    }
}

