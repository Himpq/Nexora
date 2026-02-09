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
    userCount: document.getElementById('userCount'),
    knowledgeSearchInput: document.getElementById('knowledgeSearchInput'),
    knowledgeSearchBtn: document.getElementById('knowledgeSearchBtn')
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

    if (els.knowledgeSearchInput) {
        els.knowledgeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleKnowledgeSearch();
            }
        });
    }
    if (els.knowledgeSearchBtn) {
        els.knowledgeSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleKnowledgeSearch();
        });
    }
    const bulkBtn = document.getElementById('bulkVectorizeBtn');
    if (bulkBtn) {
        bulkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            bulkVectorizeAllBasis();
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

// 说明
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
                checkUserRole(); // 说明
            }
        });
    }

    // Prevent menu from closing when clicking inside it
    if (els.userMenu) {
        els.userMenu.addEventListener('click', (e) => {
// 说明
        });
        
        // 点击菜单项后臊关闭
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
// 说明
            if (els.userMenu) els.userMenu.classList.remove('active'); // 说明
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
                const selection = window.getSelection ? window.getSelection().toString() : '';
                if (selection) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                adminModal.classList.remove('active');
            }
        });
    }

    // 添加用户 Modal 相馆
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
    
// 说明
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
    
// 说明
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (els.tokenModal) els.tokenModal.classList.remove('active');
        });
    }

    // Admin tabs (admin modal only)
    document.querySelectorAll('#adminModal .admin-tab').forEach(tab => {
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
// 说明
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
    
// 说明
    // Assuming backend returns sorted or we just list them.
    
    conversations.forEach(c => {
        const div = document.createElement('div');
        const cid = c.conversation_id || c.id; // Handle both
        div.className = `conversation-item ${cid === currentConversationId ? 'active' : ''}`;
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'title'; // Add class for CSS styling
        titleSpan.textContent = c.title || c.preview || `Conversation ${cid}`;
        div.appendChild(titleSpan);
        
        div.onclick = () => {
            // 如果当前正在查看知识库详情，先关闭
            if (currentViewingKnowledge) {
                closeKnowledgeView();
            }
            loadConversation(cid);
        };
        
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
    // 清空导航栈和知识相关状态（直接跳转到新对话）
    navigationStack = [];
    currentSearchQuery = '';
    currentViewingKnowledge = null;
    originalHeaderState = null;
    
    // 如果正在查看知识，关闭知识视图
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    if (viewer && msgs && viewer.style.display !== 'none') {
        viewer.style.display = 'none';
        msgs.style.display = 'flex';
        if (inputWrapper) inputWrapper.style.display = 'block';
    }
    
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
    
// 说明
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
// 说明
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
                            
                            // 如果当前没有正在渲染的内容Span，或者它不是消息气泡的最后一丅素（说明丗插入了工具）
                            const msgContentContainer = aiMsgDiv.querySelector('.message-content');
                            if (!currentContentSpan || msgContentContainer.lastElementChild !== currentContentSpan) {
                                currentContentSpan = createContentSpan(aiMsgDiv);
// 说明
                            }
                            
// 说明
                            // 注意：为了保持Markdown上下文一致，我们通常倾向于在同一个Block显示
                            // 但用户求在工具链下方显示，以必须开吖Block
                            currentContentSpan.innerHTML = marked.parse(currentRoundContent);
                            renderMathInElement(currentContentSpan);
                            highlightCode(currentContentSpan);
                        } 
                        else if (chunk.type === 'reasoning_content') { 
                           const msgContentContainer = aiMsgDiv.querySelector('.message-content');
// 说明
// 说明
                           let thinkingBlock = msgContentContainer.lastElementChild;
                           
                           if(!thinkingBlock || !thinkingBlock.classList.contains('thinking-block')) {
                               thinkingBlock = document.createElement('div');
                               thinkingBlock.className = 'thinking-block'; // 流式输出时默认展
// 说明
                               thinkingBlock.innerHTML = `
                                <div class="thinking-header">
                                    <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <path d="M12 6v6l4 2"></path>
                                    </svg>
// 说明
                                    <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </div>
                                <div class="thinking-content"></div>
                               `;
                               
// 说明
                               const header = thinkingBlock.querySelector('.thinking-header');
                               header.addEventListener('click', function() {
                                   thinkingBlock.classList.toggle('collapsed');
// 说明
                               });
                               
// 说明
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
                            appendErrorEvent(aiMsgDiv, chunk.content || 'Unknown error');
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
            appendErrorEvent(aiMsgDiv, '[Generation Terminated by User]');
        } else {
            appendErrorEvent(aiMsgDiv, e.message || 'Unknown error');
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

function appendErrorEvent(aiMsgDiv, message, isHistory = false) {
    const parent = aiMsgDiv.querySelector('.message-content') || aiMsgDiv;
    const div = document.createElement('div');
    div.className = 'tool-usage tool-error';
    div.dataset.toolName = 'Error';
    const iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    div.innerHTML = `
        <div class="tool-badge">
            ${iconSvg}
            <span class="tool-name">Error</span>
            <span class="tool-status">${message || ''}</span>
        </div>
        <div class="tool-output" style="display:none;"></div>
    `;
    parent.appendChild(div);
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
    
// 说明
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
            thinkingBlock.className = 'thinking-block collapsed'; // 默۵
            thinkingBlock.innerHTML = `
                <div class="thinking-header">
                    <svg class="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                    </svg>
// 说明
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
        
// 说明
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
                else if (step.type === 'error') {
                    appendErrorEvent(div, step.content || step.message || 'Unknown error', true);
                }
                else if (step.type === 'content') {
                    // 对于历史记录丩插的文本内
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
        const versions = (msg.metadata && msg.metadata.versions) ? msg.metadata.versions : [];
        if (versions.length > 0) {
            // 在当前逻辑中，versions 数组里存的是之前的版本
            // 假设 versions 有 2 个元素，那么当前是第 3 个版本
            const totalVersions = versions.length + 1;
            const currentVerNum = totalVersions; // 默认当前显示的是最新的

            actions.innerHTML += `
                <div class="version-switcher">
                    <button class="btn-ver" onclick="switchVersion(${index}, ${versions.length - 1})" title="鿴һ汾">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span>${currentVerNum} / ${totalVersions}</span>
// 说明
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
// 说明
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
// 说明
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
// 说明
        newOkBtn.className = "btn-confirm btn-confirm-del";
    } else {
// 说明
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
        const [resBasis, resShort, resMeta] = await Promise.all([
            fetch('/api/knowledge/basis'),
            fetch('/api/knowledge/short'),
            fetch('/api/knowledge/list')
        ]);
        
        const basisData = await resBasis.json();
        const shortData = await resShort.json();
        const metaData = await resMeta.json();
        knowledgeMetaCache = (metaData && metaData.basis_knowledge) ? metaData.basis_knowledge : {};

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
        div.dataset.title = title;
        div.style.position = 'relative';
        div.style.overflow = 'hidden';
        div.style.paddingRight = '26px';
        const label = document.createElement('span');
        label.textContent = title;
        label.style.position = 'relative';
        label.style.zIndex = '1';
        label.style.display = 'block';
        label.style.paddingRight = '12px';
        div.appendChild(label);
        div.style.cursor = 'pointer';
        const progress = document.createElement('div');
        progress.className = 'knowledge-progress';
        progress.style.position = 'absolute';
        progress.style.left = '0';
        progress.style.bottom = '0';
        progress.style.height = '100%';
        progress.style.opacity = '0.18';
        progress.style.width = '0%';
        progress.style.background = 'rgba(34, 197, 94, 0.7)';
        progress.style.transition = 'width 120ms ease';
        progress.style.zIndex = '0';
        div.appendChild(progress);
        if (type === 'basis') {
            const spinner = document.createElement('div');
            spinner.className = 'vector-spinner';
            div.appendChild(spinner);
        }
        // Add refresh icon for basis when vector is stale
        if (type === 'basis') {
            const meta = knowledgeMetaCache[title] || {};
            const updatedAt = Number(meta.updated_at || 0);
            const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
            if (updatedAt > 0 && vectorUpdatedAt < updatedAt) {
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-rotate';
                icon.style.position = 'absolute';
                icon.style.right = '6px';
                icon.style.top = '50%';
                icon.style.transform = 'translateY(-50%)';
                icon.style.fontSize = '12px';
                icon.style.color = '#16a34a';
                icon.style.zIndex = '2';
                icon.style.cursor = 'pointer';
                icon.title = '闇€要重新向量化';
                icon.onclick = (e) => {
                    e.stopPropagation();
                    vectorizeKnowledgeTitle(title);
                };
                div.appendChild(icon);
            }
        }
        // Add click handler to view details ONLY for basis for now
        if(type === 'basis') {
             div.onclick = () => viewKnowledge(title);
        }
        else {
            div.onclick = () => {} // 说明
        }
        container.appendChild(div);
    });
}


// --- Knowledge View Logic ---
let easyMDE = null;
let originalHeaderState = null;
let currentViewingKnowledge = null;
let knowledgeMetaCache = {};
let bulkVectorizeRunning = false;
let pendingHighlightData = null;

// 导航栈管理：追踪视图层级，支持多层返回
let navigationStack = [];
let currentSearchQuery = ''; // 保存搜索关键词，以便返回时重新显示

// 保存当前状态
function saveCurrentViewerState(extra = {}) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    return {
        viewerDisplay: viewer.style.display,
        viewerHTML: viewer.innerHTML,
        msgsDisplay: msgs.style.display,
        inputDisplay: inputWrapper ? inputWrapper.style.display : 'block',
        headerTitle: headerTitle.textContent,
        headerLeft: headerLeft.innerHTML,
        headerRight: headerRight.innerHTML,
        extra,
        extra
    };
}

// 恢复状态
function restoreViewerState(state) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    viewer.style.display = state.viewerDisplay;
    viewer.innerHTML = state.viewerHTML;
    msgs.style.display = state.msgsDisplay;
    if (inputWrapper) inputWrapper.style.display = state.inputDisplay;
    headerTitle.textContent = state.headerTitle;
    headerLeft.innerHTML = state.headerLeft;
    headerRight.innerHTML = state.headerRight;
    if (state.extra && state.extra.searchQuery) {
        currentSearchQuery = state.extra.searchQuery;
    }
}

async function viewKnowledge(title, options = {}) {
    currentViewingKnowledge = title;
    const { forceEditMode = false, highlightData = null, fromSearch = false } = options;
    pendingHighlightData = highlightData;
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    if(!viewer || !msgs) return;
    
    // 1. Save Header State
    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
    
    // 导航栈管理：如果是从搜索结果进来的，保存知识项到栈
    // navigationStack 会在 searchKnowledgeVectors 或 openKnowledgeAtChunk 中被管理
    if (navigationStack.length > 0) {
        // 在栈上添加知识项
        navigationStack.push({
            type: 'knowledge',
            title: title,
            state: saveCurrentViewerState() // 当前页面状态（用于返回时恢复）
        });
    }

    // 如果不是从搜索进入，清空导航栈（避免返回到搜索）
    if (!fromSearch) {
        navigationStack = [];
    }

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
    // 如果当前viewer是搜索页，先恢复为编辑器容器
    if (!document.getElementById('knowledgeEditor')) {
        viewer.innerHTML = '<textarea id="knowledgeEditor"></textarea>';
        // 搜索页替换会销毁编辑器，需重建
        easyMDE = null;
    }

    // 4. Update Header
    headerTitle.textContent = title;
    
    // Back Button (Left)
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;

    // Right Buttons: Settings, Save, Delete (All Icons)
    headerRight.innerHTML = `
        <button class="btn-icon knowledge-action" onclick="openKnowledgeSettingsModal()" title="设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <button class="btn-icon knowledge-action" id="btnSaveKnowledge" onclick="saveKnowledge('${title.replace(/'/g, "\\'")}')" title="保存">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        </button>
        <button class="btn-icon knowledge-action knowledge-action-danger" onclick="confirmDeleteKnowledge('${title.replace(/'/g, "\\'")}')" title="删除">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
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
        showToast('提示：点击编辑器工具栏中的“眼睛”图标可切换预览与编辑模式。');
    }
    // 如果编辑器存在但绑定的 DOM 已被替换，重新创建
    if (!easyMDE || !easyMDE.codemirror || !document.getElementById('knowledgeEditor')) {
        easyMDE = null;
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
    }
    
    const viewportHeight = window.innerHeight;
    const headerHeight = 60; 
    easyMDE.codemirror.setSize(null, `${viewportHeight - headerHeight}px`);

    easyMDE.value(content || '');

    // Default to Preview Mode unless forced edit mode
    if (forceEditMode) {
        if (easyMDE.isPreviewActive()) {
            EasyMDE.togglePreview(easyMDE);
        }
    } else {
        // 直接进入预览模式
        if (!easyMDE.isPreviewActive()) {
            EasyMDE.togglePreview(easyMDE);
        }
    }

    const highlightWhenReady = (retryCount = 0) => {
        if (!pendingHighlightData || !pendingHighlightData.text) return;
        if (retryCount > 30) { // 最多重试30次（约4.5秒）
            console.warn('预览内容加载超时，取消高亮');
            pendingHighlightData = null;
            return;
        }
        
        const preview = document.querySelector('.editor-preview');
        if (!preview) {
            setTimeout(() => highlightWhenReady(retryCount + 1), 150);
            return;
        }
        
        // 检查预览内容是否真正包含文本内容（不只是HTML标签）
        const textContent = preview.textContent || '';
        const hasContent = textContent.trim().length > 50; // 至少有50个字符
        
        if (!hasContent) {
            setTimeout(() => highlightWhenReady(retryCount + 1), 150);
            return;
        }
        
        // 内容已加载，执行高亮
        highlightTextInPreview(pendingHighlightData.text, pendingHighlightData.meta);
        pendingHighlightData = null; // 清空，避免重复高亮
    };

    setTimeout(() => {
        easyMDE.codemirror.refresh();
        if (!forceEditMode) {
            setTimeout(() => highlightWhenReady(0), 200);
        }
    }, 150);
}

function highlightTextInPreview(text, meta = {}) {
    const preview = document.querySelector('.editor-preview');
    if (!preview) {
        console.warn('预览元素不存在');
        return;
    }
    
    // 获取预览中的所有文本节点
    const walker = document.createTreeWalker(
        preview,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let searchText = text;
    let foundNode = null;
    let foundOffset = -1;
    let node = walker.nextNode();
    
    // 查找包含目标文本的节点
    while (node) {
        const nodeText = node.textContent;
        const idx = nodeText.indexOf(searchText);
        if (idx >= 0) {
            foundNode = node;
            foundOffset = idx;
            break;
        }
        // 尝试简短版本
        if (text.length > 80) {
            const short = text.slice(0, 80);
            const idx2 = nodeText.indexOf(short);
            if (idx2 >= 0) {
                foundNode = node;
                foundOffset = idx2;
                searchText = short;
                break;
            }
        }
        node = walker.nextNode();
    }
    
    if (!foundNode) {
        console.warn('未找到匹配的文本节点');
        return;
    }
    
    const parent = foundNode.parentNode;
    if (!parent) return;
    
    // 创建高亮span
    const span = document.createElement('span');
    span.className = 'cm-search-highlight';
    span.style.backgroundColor = 'rgba(34, 197, 94, 0.25)';
    span.style.borderBottom = '1px solid rgba(34, 197, 94, 0.7)';
    
    // 分割文本节点
    const beforeText = foundNode.textContent.slice(0, foundOffset);
    const highlightedText = foundNode.textContent.slice(foundOffset, foundOffset + searchText.length);
    const afterText = foundNode.textContent.slice(foundOffset + searchText.length);
    
    const beforeNode = document.createTextNode(beforeText);
    const highlightNode = document.createTextNode(highlightedText);
    const afterNode = document.createTextNode(afterText);
    
    span.appendChild(highlightNode);
    
    parent.insertBefore(beforeNode, foundNode);
    parent.insertBefore(span, foundNode);
    parent.insertBefore(afterNode, foundNode);
    parent.removeChild(foundNode);
    
    // 先滚动到顶部，然后再滚动到高亮位置，形成从上到下的定位效果
    preview.scrollTop = 0;
    
    // 使用 requestAnimationFrame 确保滚动在下一帧执行
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // 增加延迟，让"从上到下"的滚动效果更明显
            setTimeout(() => {
                // 获取元素位置并手动滚动（更可靠）
                const spanRect = span.getBoundingClientRect();
                const previewRect = preview.getBoundingClientRect();
                const scrollOffset = spanRect.top - previewRect.top - (previewRect.height / 2) + preview.scrollTop;
                
                // 使用平滑滚动
                preview.scrollTo({
                    top: scrollOffset,
                    behavior: 'smooth'
                });
                
                // 添加短暂的脉冲动画效果
                span.style.transition = 'all 0.3s ease';
                span.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    span.style.transform = 'scale(1)';
                }, 400);
            }, 400);
        });
    });
}

function closeKnowledgeView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    currentViewingKnowledge = null;
    
    // 检查导航栈
    if (navigationStack.length > 1) {
        // 弹出当前项（知识详情），查看前一个项
        navigationStack.pop(); // 移除知识点
        const prevItem = navigationStack[navigationStack.length - 1];
        
        if (prevItem.type === 'search') {
            // 返回到搜索页面 - 重新渲染搜索结果
            const query = prevItem.query || currentSearchQuery;
            
            // 恢复搜索结果缓存
            if (prevItem.resultsCache && prevItem.resultsCache.length > 0) {
                lastKnowledgeSearchResults = prevItem.resultsCache;
            }
            
            // 重新显示搜索界面
            viewer.style.display = 'flex';
            viewer.style.flexDirection = 'column';
            msgs.style.display = 'none';
            if (inputWrapper) inputWrapper.style.display = 'none';
            
            // 更新Header
            headerTitle.textContent = '向量库搜索';
            headerLeft.innerHTML = `
                <button class="btn-icon" onclick="closeKnowledgeSearchResultView()" title="Back">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                </button>
            `;
            headerRight.innerHTML = '';
            
            // 重新渲染搜索结果
            viewer.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                        <div style="font-size: 14px; color: #64748b;">搜索: <strong style="color: #0f172a;">${escapeHtml(query)}</strong></div>
                    </div>
                    <div id="knowledgeSearchResultsList" style="flex: 1; overflow-y: auto; padding: 0;"></div>
                </div>
            `;
            
            renderSearchResultsFromCache();
            return;
        } else if (prevItem.type === 'chat') {
            // 返回到聊天页面
            navigationStack.pop(); // 移除搜索项
        }
    }
    
    // 返回到聊天界面
    viewer.style.display = 'none';
    msgs.style.display = 'flex';
    if(inputWrapper) inputWrapper.style.display = 'block';
    navigationStack = []; // 清空栈

    if (originalHeaderState) {
        headerTitle.textContent = originalHeaderState.title;
        headerLeft.innerHTML = originalHeaderState.leftHTML;
        headerRight.innerHTML = originalHeaderState.rightHTML;
        els.modelSelectContainer = document.getElementById('modelSelectContainer');
        els.currentModelDisplay = document.getElementById('currentModelDisplay');
        els.modelOptions = document.getElementById('modelOptions');
        loadModels(); 
        
        const toggleSidebar = document.getElementById('toggleSidebar');
        if(toggleSidebar) toggleSidebar.onclick = () => {
            if (window.innerWidth <= 768) els.sidebar.classList.toggle('mobile-open');
            else els.sidebar.classList.toggle('collapsed');
        };
        const toggleKP = document.getElementById('toggleKnowledgePanel');
        if(toggleKP) toggleKP.onclick = () => els.knowledgePanel.classList.toggle('visible');
    }
    originalHeaderState = null;
}

// --- Knowledge Search ---
let lastKnowledgeSearchResults = [];

async function handleKnowledgeSearch() {
    const input = els.knowledgeSearchInput;
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;
    await searchKnowledgeVectors(query);
}

async function searchKnowledgeVectors(query) {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    
    // 关闭任何可能打开的知识库详情视图
    if (currentViewingKnowledge) {
        closeKnowledgeView();
    }
    
    // 导航栈管理：如果还没有搜索项在栈上，保存聊天页面状态
    if (navigationStack.length === 0) {
        // 第一次进入搜索，保存初始的聊天页面状态
        navigationStack.push({
            type: 'chat',
            state: {
                title: headerTitle.textContent,
                leftHTML: headerLeft.innerHTML,
                rightHTML: headerRight.innerHTML
            }
        });
    }
    
    // 保存原始状态（兼容旧代码）
    if (!originalHeaderState) {
        originalHeaderState = {
            title: headerTitle.textContent,
            leftHTML: headerLeft.innerHTML,
            rightHTML: headerRight.innerHTML
        };
    }
    
    // 显示搜索结果视图
    msgs.style.display = 'none';
    if(inputWrapper) inputWrapper.style.display = 'none';
    viewer.style.display = 'flex';
    viewer.style.flexDirection = 'column';
    
    // 更新Header
    headerTitle.textContent = '向量库搜索';
    headerLeft.innerHTML = `
        <button class="btn-icon" onclick="closeKnowledgeSearchResultView()" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
    `;
    headerRight.innerHTML = '';
    
    // 更新viewer为搜索结果显示区
    viewer.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
            <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                <div style="font-size: 14px; color: #64748b;">搜索: <strong style="color: #0f172a;">${escapeHtml(query)}</strong></div>
            </div>
            <div id="knowledgeSearchResultsList" style="flex: 1; overflow-y: auto; padding: 0;"></div>
        </div>
    `;
    
    const resultsList = document.getElementById('knowledgeSearchResultsList');
    resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">搜索中...</div>';
    
    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 8 })
        });
        const data = await res.json();
        if (!data.success) {
            resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">${data.message || '搜索失败'}</div>`;
            return;
        }
        const docs = (data.result && data.result.documents && data.result.documents[0]) ? data.result.documents[0] : [];
        const metas = (data.result && data.result.metadatas && data.result.metadatas[0]) ? data.result.metadatas[0] : [];
        const dists = (data.result && data.result.distances && data.result.distances[0]) ? data.result.distances[0] : [];
        if (docs.length === 0) {
            resultsList.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">没有结果</div>';
            return;
        }
        lastKnowledgeSearchResults = docs.map((doc, i) => ({
            doc,
            meta: metas[i] || {},
            dist: dists[i]
        }));

        resultsList.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
            const title = item.meta.title || 'Untitled';
            const preview = (item.doc || '').slice(0, 200);
            const score = item.dist != null ? (1 - item.dist) : 0;
            return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
                <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
                <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
            </div>`;
        }).join('');

        // 添加搜索结果的点击处理
        bindSearchResultHandlers();
        
        // 搜索结果加载完成后，保存搜索页面状态到栈
        currentSearchQuery = query;
        navigationStack.push({
            type: 'search',
            query: query,
            // 不保存 HTML，而是保存查询信息，返回时重新渲染
            resultsCache: lastKnowledgeSearchResults
        });
    } catch (e) {
        resultsList.innerHTML = `<div style="padding: 20px; color:#ef4444; text-align: center;">搜索失败: ${e.message}</div>`;
    }
}

function bindSearchResultHandlers() {
    setTimeout(() => {
        document.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(el.getAttribute('data-idx'));
                const title = el.getAttribute('data-title');
                const item = lastKnowledgeSearchResults[idx];
                const chunkText = (item && item.doc) ? item.doc : '';
                if (title && chunkText) {
                    openKnowledgeAtChunk(title, chunkText, (item && item.meta) ? item.meta : {}, true);
                }
            };
        });
    }, 100);
}

function renderSearchResultsFromCache() {
    const list = document.getElementById('knowledgeSearchResultsList');
    if (!list) return;
    if (!lastKnowledgeSearchResults || lastKnowledgeSearchResults.length === 0) {
        list.innerHTML = '<div style="padding: 20px; color:#94a3b8; text-align: center;">无结果</div>';
        return;
    }
    list.innerHTML = lastKnowledgeSearchResults.map((item, idx) => {
        const title = item.meta.title || 'Untitled';
        const preview = (item.doc || '').slice(0, 200);
        const score = item.dist != null ? (1 - item.dist) : 0;
        return `<div class="search-result-item" data-idx="${idx}" data-title="${escapeHtml(title)}" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background = '#f8fafc'" onmouseout="this.style.background = 'transparent'">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 6px;">${escapeHtml(title)} <span style="color: #64748b; font-size: 11px;">(score ${score.toFixed(4)})</span></div>
            <div style="color: #64748b; font-size: 13px; line-height: 1.6;">${escapeHtml(preview)}</div>
        </div>`;
    }).join('');
    bindSearchResultHandlers();
}

function closeKnowledgeSearchResultView() {
    const viewer = document.getElementById('knowledgeViewer');
    const msgs = document.getElementById('messagesContainer');
    const inputWrapper = document.getElementById('inputWrapper');
    const headerTitle = document.getElementById('conversationTitle');
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');

    viewer.style.display = 'none';
    viewer.innerHTML = '<textarea id="knowledgeEditor"></textarea>';
    msgs.style.display = 'flex';
    if(inputWrapper) inputWrapper.style.display = 'block';
    
    // 清除导航栈和搜索状态
    navigationStack = [];
    currentSearchQuery = '';

    if (originalHeaderState) {
        headerTitle.textContent = originalHeaderState.title;
        headerLeft.innerHTML = originalHeaderState.leftHTML;
        headerRight.innerHTML = originalHeaderState.rightHTML;
        els.modelSelectContainer = document.getElementById('modelSelectContainer');
        els.currentModelDisplay = document.getElementById('currentModelDisplay');
        els.modelOptions = document.getElementById('modelOptions');
        loadModels(); 
        
        const toggleSidebar = document.getElementById('toggleSidebar');
        if(toggleSidebar) toggleSidebar.onclick = () => {
            if (window.innerWidth <= 768) els.sidebar.classList.toggle('mobile-open');
            else els.sidebar.classList.toggle('collapsed');
        };
        const toggleKP = document.getElementById('toggleKnowledgePanel');
        if(toggleKP) toggleKP.onclick = () => els.knowledgePanel.classList.toggle('visible');
    }
    originalHeaderState = null;
}

function closeKnowledgeSearchModal() {
    // 兼容性函数，调用新的搜索结果视图关闭函数
    closeKnowledgeSearchResultView();
}

async function openKnowledgeAtChunk(title, chunkText, meta = {}, fromSearch = false) {
    // 如果不是来自搜索，清除导航栈（直接跳转）
    if (!fromSearch) {
        navigationStack = [{
            type: 'chat',
            state: {
                title: document.getElementById('conversationTitle').textContent,
                leftHTML: document.querySelector('.header-left').innerHTML,
                rightHTML: document.querySelector('.header-right').innerHTML
            }
        }];
    }
    
    // 直接在预览模式下打开，带有高亮信息
    await viewKnowledge(title, { 
        forceEditMode: false,
        highlightData: { text: chunkText, meta },
        fromSearch
    });
}

function indexToPos(text, index) {
    const before = text.slice(0, index);
    const lines = before.split('\n');
    const line = lines.length - 1;
    const ch = lines[lines.length - 1].length;
    return { line, ch };
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
    showConfirm("删除知识", `确定要彻底删除 “${title}” 吗？此操作无法撤销。`, "danger", () => deleteKnowledge(title));
}

async function deleteKnowledge(title) {
    try {
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        closeConfirmModal();
        
        if(data.success) {
// 说明
            closeKnowledgeView();
            loadKnowledge(); 
        } else {
// 说明
        }
    } catch(e) {
        closeConfirmModal();
        showToast('쳣: ' + e.message);
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
        
        const base = window.location.origin;
        const shareId = metadata.share_id || '';
        const shareUrl = shareId ? `${base}/public/knowledge/${currentUsername}/${shareId}` : '';
        setShareLinkDisplay(shareUrl, metadata.public);
        
        if (metadata.updated_at) {
            document.getElementById('lastModifyTime').textContent = new Date(metadata.updated_at * 1000).toLocaleString();
        }

        loadVectorChunks(title);
        initKnowledgeSettingsTabs();
        if (vectorizeTitle && vectorizeTitle !== title) {
            resetVectorProgressUI();
        }
        vectorizeTitle = title;
        document.getElementById('knowledgeSettingsModal').classList.add('active');
        setVectorStatus('加载中...');
        loadVectorChunks(title);
    } catch(e) { console.error(e); }
}

function closeKnowledgeSettingsModal() {
    document.getElementById('knowledgeSettingsModal').classList.remove('active');
    resetVectorProgressUI();
}

function initKnowledgeSettingsTabs() {
    const modal = document.getElementById('knowledgeSettingsModal');
    if (!modal || modal.dataset.tabsInit === '1') return;
    modal.dataset.tabsInit = '1';
    const tabs = modal.querySelectorAll('.admin-tab');
    const contents = modal.querySelectorAll('.admin-tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            contents.forEach(c => c.classList.remove('active'));
            const panel = modal.querySelector(`#${target}-tab`);
            if (panel) panel.classList.add('active');
        });
    });
}

function setShareLinkDisplay(shareUrl, isPublic) {
    const shareSection = document.getElementById('shareLinkSection');
    const shareInput = document.getElementById('shareUrlDisplay');

    if (!shareSection || !shareInput) return;

    if (isPublic && shareUrl) {
        shareInput.value = shareUrl;
        shareSection.style.display = 'block';
    } else {
        shareSection.style.display = 'none';
        shareInput.value = '';
    }
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
            
            // If title changed, we must reload the view
            if (newTitle !== oldTitle) {
                closeKnowledgeSettingsModal();
                closeKnowledgeView();
                viewKnowledge(newTitle);
            } else {
                const shareUrl = data.share_url || '';
                setShareLinkDisplay(shareUrl, isPublic);
            }
            loadKnowledge(); 
        } else {
            showToast('更新失败: ' + data.message);
        }
    } catch(e) { showToast('网络错: ' + e.message); }
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
            <span style="cursor:pointer; font-weight:bold; color:#666;" onclick="removeUploadedFile(${index})">&times;</span>
        `;
        els.filePreviewArea.appendChild(badge);
    });
}

window.removeUploadedFile = function(index) {
    uploadedFileIds.splice(index, 1);
    updateFilePreview();
}

// --- Admin Functions ---
// 查用户色并显示管理菜单
async function checkUserRole() {
    try {
        const res = await fetch('/api/user/info');
        const data = await res.json();
        if (data.success) {
            currentUsername = data.username;
            currentUserRole = data.role;
            
// 说明
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
    if (userMenu) userMenu.classList.remove('active'); // 臊۵菜单
    
    if (!adminModal) return;
    adminModal.classList.add('active');
    
    // Load users list
    await loadAdminUsersList();
    
    // Load stats
    await loadAdminStats();
    await loadAdminChromaStats();
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
// 说明
    }
    
    try {
        const res = await fetch(`/api/admin/user/models?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        
        if (data.success && listContainer) {
            listContainer.innerHTML = data.models.map(m => `
                <div class="perm-item" style="display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid #f1f5f9; transition: all 0.2s ease; background: white;">
                    <label style="display: flex; align-items: center; cursor: pointer; width: 100%; margin: 0; user-select: none;">
                        <input type="checkbox" class="model-perm-checkbox" data-id="${m.id}" ${!m.is_blocked ? 'checked' : ''} style="margin-right: 14px; width: 18px; height: 18px; cursor: pointer; accent-color: #0f172a; flex-shrink: 0;">
                        <div style="display: flex; flex-direction: column; flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-weight: 600; font-size: 14px; color: #1e293b;">${m.name}</span>
                                ${m.provider ? `<span style="font-size: 11px; color: #94a3b8; background: #f0f4f8; padding: 2px 8px; border-radius: 3px;">${m.provider}</span>` : ''}
                            </div>
                            <span style="font-size: 12px; color: #94a3b8; font-family: 'Monaco', 'Menlo', monospace; margin-top: 2px;">${m.id}</span>
                        </div>
                        <span style="font-size: 11px; color: #cbd5e1; margin-left: 8px; flex-shrink: 0; padding: 4px 8px; background: ${!m.is_blocked ? '#dcfce7' : '#fee2e2'}; border-radius: 3px; font-weight: 500;">
                            ${!m.is_blocked ? '✓ 可用' : '✗ 禁用'}
                        </span>
                    </label>
                </div>
            `).join('');
        } else if (listContainer) {
            listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">${data.message || '获取失败'}</div>`;
        }
    } catch (err) {
        if (listContainer) listContainer.innerHTML = `<div style="padding: 20px; color: #ef4444; text-align: center; font-size: 13px;">加载错误: ${err.message}</div>`;
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
// 说明
            closeModelPermModal();
            // 如果俔的是当前登录用户，则刷新页面
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

// ChromaDB stats
async function loadAdminChromaStats() {
    try {
        const res = await fetch('/api/admin/chroma/stats');
        const data = await res.json();
        const statusEl = document.getElementById('statChromaStatus');
        const totalEl = document.getElementById('statChromaTotal');
        const listEl = document.getElementById('adminChromaList');

        if (!statusEl || !totalEl || !listEl) return;

        if (!data.success) {
            statusEl.textContent = 'error';
            totalEl.textContent = '-';
            listEl.innerHTML = `<tr><td colspan="2">${data.message || 'Failed to load'}</td></tr>`;
            return;
        }

        if (!data.enabled) {
            statusEl.textContent = 'disabled';
            totalEl.textContent = '0';
            listEl.innerHTML = `<tr><td colspan="2">ChromaDB disabled</td></tr>`;
            return;
        }

        statusEl.textContent = data.mode || 'service';
        totalEl.textContent = (data.total_vectors || 0).toLocaleString();

        const rows = (data.collections || []).map(c => {
            return `<tr><td>${c.name}</td><td class="mono">${(c.count || 0).toLocaleString()}</td></tr>`;
        }).join('');
        listEl.innerHTML = rows || '<tr><td colspan="2">No collections</td></tr>';
    } catch (err) {
        console.error('Failed to load chroma stats:', err);
    }
}

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

// 说明
function switchAdminTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('#adminModal .admin-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Deactivate all buttons
    document.querySelectorAll('#adminModal .admin-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Activate selected button
    const selectedBtn = document.querySelector(`#adminModal [data-tab="${tabName}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');
    if (tabName === 'chroma') {
        loadAdminChromaStats();
    }

}

// 切换添加用户
function openAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.add('active');
// 说明
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.pointerEvents = 'none';
    }
}

function closeAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
        modal.classList.remove('active');
// 说明
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
            closeAddUserModal(); // رյ
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



async function updateVectorInSettings() {
    if (!currentViewingKnowledge) {
        showToast('请先选择知识点');
        return;
    }
    if (vectorizeTasks[currentViewingKnowledge] && vectorizeTasks[currentViewingKnowledge].running) {
        showToast('该知识点正在向量化');
        return;
    }
    showToast('正在更新到向量库，可先关闭窗口');
    setVectorStatus('更新中...');
    vectorizeTitle = currentViewingKnowledge;
    const runId = ++vectorizeRunId;
    vectorizeTasks[currentViewingKnowledge] = { running: true, runId };
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : currentViewingKnowledge;
        if (runId !== vectorizeRunId) return;

        const metaRes = await fetch('/api/knowledge/list');
        const metaData = await metaRes.json();
        const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
        const meta = basisMeta[liveTitle] || {};
        const updatedAt = Number(meta.updated_at || 0);
        const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
        if (updatedAt > 0 && vectorUpdatedAt >= updatedAt) {
            const chunksRes = await fetch('/api/knowledge/vector/chunks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: liveTitle })
            });
            const chunksData = await chunksRes.json();
            const chunkCount = (chunksData && chunksData.chunks ? chunksData.chunks : []).length;
            if (chunkCount > 0) {
                showToast('内容未变化，已跳过');
                setVectorStatus('无需更新');
                vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
                return;
            }
        }

        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(liveTitle)}`);
        const data = await res.json();
        if (!data.success) {
            showToast('读取知识内容失败');
            setVectorStatus('读取失败');
            vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
            return;
        }
        const content = data.knowledge && data.knowledge.content ? data.knowledge.content : '';
        const title = data.knowledge && data.knowledge.title ? data.knowledge.title : liveTitle;

        const cfgRes = await fetch('/api/knowledge/vector/config');
        const cfgData = await cfgRes.json();
        const chunkSize = cfgData.chunk_size || 800;
        const chunkOverlap = cfgData.chunk_overlap || 120;
        const chunks = splitTextForVector(content, chunkSize, chunkOverlap);
        if (chunks.length === 0) {
            showToast('内容为空');
            setVectorStatus('内容为空');
            vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
            return;
        }

        if (vectorizeTitle === currentViewingKnowledge) {
            startVectorProgress(chunks.length);
        }

        await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });

        let storedCount = 0;
        for (let i = 0; i < chunks.length; i++) {
            if (runId !== vectorizeRunId) return;
            const chunkObj = chunks[i];
            const resChunk = await fetch('/api/knowledge/vectorize/chunk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    text: chunkObj.text,
                    chunk_id: i,
                    chunk_total: chunks.length,
                    metadata: {
                        chunk_start: chunkObj.start,
                        chunk_end: chunkObj.end
                    }
                })
            });
            const dataChunk = await resChunk.json();
            if (!dataChunk.success) {
                setVectorStatus('向量化失败');
                if (vectorizeTitle === currentViewingKnowledge) {
                    stopVectorProgress(`失败：${i + 1}/${chunks.length}`, true);
                }
                showToast('向量化失败: ' + (dataChunk.message || '未知错误'));
                vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
                return;
            }
            storedCount += 1;
            if (vectorizeTitle === currentViewingKnowledge) {
                updateVectorProgress(i + 1, chunks.length);
            }
        }

        showToast('已更新到向量库');
        setVectorStatus(`已更新，${storedCount} 块`);
        if (vectorizeTitle === currentViewingKnowledge) {
            stopVectorProgress(`完成 ${storedCount} 块`);
        }
        loadVectorChunks(title);
        vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
        await fetch('/api/knowledge/vector/mark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
    } catch (e) {
        showToast('向量化失败: ' + e.message);
        setVectorStatus('向量化失败');
        if (vectorizeTitle === currentViewingKnowledge) {
            stopVectorProgress('向量化失败', true);
        }
        vectorizeTasks[currentViewingKnowledge] = { running: false, runId };
    }
}

async function deleteVectorInSettings() {
    if (!currentViewingKnowledge) {
        showToast('请先选择知识点');
        return;
    }
    if (!confirm('确定要删除知识点在向量库中的所有内容吗？')) return;
    setVectorStatus('删除中...');
    try {
        const titleInput = document.getElementById('settingTargetTitle');
        const liveTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : currentViewingKnowledge;
        const res = await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: liveTitle })
        });
        const data = await res.json();
        if (data.success) {
            showToast('向量已删除');
            setVectorStatus('已删除');
            loadVectorChunks(liveTitle);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'));
            setVectorStatus('删除失败');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message);
        setVectorStatus('删除失败');
    }
}

async function searchChroma() {
    const input = document.getElementById('chromaSearchInput');
    const results = document.getElementById('chromaSearchResults');
    if (!input || !results) return;
    const query = input.value.trim();
    if (!query) {
        results.style.display = 'block';
        results.textContent = '请输入查询内容';
        return;
    }

    results.style.display = 'block';
    results.textContent = '搜索中...';

    try {
        const res = await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, top_k: 5 })
        });
        const data = await res.json();
        if (!data.success) {
            results.textContent = data.message || '搜索失败';
            return;
        }
        const result = data.result || {};
        const docs = result.documents && result.documents[0] ? result.documents[0] : [];
        const metas = result.metadatas && result.metadatas[0] ? result.metadatas[0] : [];
        const dists = result.distances && result.distances[0] ? result.distances[0] : [];
        if (docs.length === 0) {
            results.textContent = '没有结果';
            return;
        }
        const items = docs.map((doc, i) => ({
            doc,
            meta: metas[i],
            dist: dists[i],
            score: dists[i] != null ? (1 - dists[i]) : 0
        })).sort((a, b) => (b.score || 0) - (a.score || 0));

        results.innerHTML = items.map((item) => {
            const doc = item.doc || '';
            const meta = item.meta || {};
            const title = meta.title || 'Untitled';
            const scoreText = item.score != null ? item.score.toFixed(4) : '-';
            const preview = doc.length > 120 ? doc.slice(0, 120) + '...' : doc;
            return `<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0;">
                <div style="font-weight:600;">${title} <span style="color:#64748b; font-size:11px;">(score ${scoreText})</span></div>
                <div style="color:#64748b; font-size:12px;">${preview}</div>
            </div>`;
        }).join('');
    } catch (e) {
        results.textContent = '搜索失败: ' + e.message;
    }
}

async function loadVectorChunks(title) {
    const list = document.getElementById('vectorChunkList');
    if (!list) return;
    if (!title) {
        list.innerHTML = '<div style="color:#94a3b8;"></div>';
        setVectorStatus('请选择知识点');
        return;
    }
    list.innerHTML = '<div style="color:#94a3b8;">加载中...</div>';
    setVectorStatus('加载中...');
    try {
        const res = await fetch('/api/knowledge/vector/chunks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await res.json();
        if (!data.success) {
            list.innerHTML = `<div style="color:#ef4444;">${data.message || '加载失败'}</div>`;
            setVectorStatus('加载失败');
            return;
        }
        const chunks = data.chunks || [];
        if (chunks.length === 0) {
            list.innerHTML = '<div style="color:#94a3b8;">暂无数据</div>';
            setVectorStatus('暂无数据');
            return;
        }
        list.innerHTML = chunks.map(c => {
            const idx = c.chunk_id != null ? c.chunk_id : '-';
            const preview = (c.text || '').slice(0, 80);
            const id = c.id || '';
            const safeId = String(id).replace(/"/g, '&quot;');
            return `<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0; display:flex; gap:8px; align-items:flex-start; justify-content: space-between;">
                <div style="flex:1;">
                    <div style="font-weight:600;">Chunk ${idx}</div>
                    <div style="color:#64748b; font-size:12px; word-break: break-word;">${preview}</div>
                </div>
                <button class="btn-primary" onclick="deleteVectorChunk('${safeId}', '${title.replace("'", "\'")}')" style="background:#ef4444; padding: 4px 8px; font-size: 11px;">删除</button>
            </div>`;
        }).join('');
        setVectorStatus(`已加载 ${chunks.length} 块`);
    } catch (e) {
        list.innerHTML = `<div style="color:#ef4444;">加载失败: ${e.message}</div>`;
        setVectorStatus('加载失败');
    }
}

function setVectorStatus(text) {
    const el = document.getElementById('vectorStatusText');
    if (el) el.textContent = text;
}
function setKnowledgeItemProgress(title, percent, active = true) {
    const container = els.panelBasisList;
    if (!container) return;
    const safeTitle = escapeCssSelector(title);
    const item = container.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
    if (!item) return;
    const bar = item.querySelector('.knowledge-progress');
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    bar.style.opacity = active ? '1' : '0';
    if (!active) {
        setTimeout(() => {
            bar.style.width = '0%';
        }, 200);
    }
}

function escapeCssSelector(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return String(value || '').replace(/"/g, '\\"');
}

async function bulkVectorizeAllBasis() {
    if (bulkVectorizeRunning) {
        showToast('正在批量向量化，请稍候');
        return;
    }
    bulkVectorizeRunning = true;
    showToast('开始批量向量化');
    try {
        const metaRes = await fetch('/api/knowledge/list');
        const metaData = await metaRes.json();
        const basisMeta = metaData && metaData.basis_knowledge ? metaData.basis_knowledge : {};
        const listEls = els.panelBasisList ? Array.from(els.panelBasisList.querySelectorAll('.knowledge-item')) : [];
        const titles = listEls.length > 0 ? listEls.map(el => el.dataset.title).filter(Boolean) : Object.keys(basisMeta);
        if (titles.length === 0) {
            showToast('没有可向量化的知识点');
            bulkVectorizeRunning = false;
            return;
        }
        titles.forEach(t => setKnowledgeItemVectorState(t, 'pending'));
        for (const title of titles) {
            const meta = basisMeta[title] || {};
            const updatedAt = Number(meta.updated_at || 0);
            const vectorUpdatedAt = Number(meta.vector_updated_at || 0);
            if (updatedAt > 0 && vectorUpdatedAt >= updatedAt) {
                const chunksRes = await fetch('/api/knowledge/vector/chunks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });
                const chunksData = await chunksRes.json();
                const chunkCount = (chunksData && chunksData.chunks ? chunksData.chunks : []).length;
                if (chunkCount > 0) {
                    setKnowledgeItemVectorState(title, null);
                    continue;
                }
            }
            setKnowledgeItemVectorState(title, 'uploading');
            await vectorizeKnowledgeTitle(title);
            setKnowledgeItemVectorState(title, null);
        }
    } catch (e) {
        showToast('批量向量化失败: ' + e.message);
    } finally {
        titles.forEach(t => setKnowledgeItemVectorState(t, null));
        bulkVectorizeRunning = false;
        loadKnowledge(currentConversationId);
    }
}

async function vectorizeKnowledgeTitle(title) {
    try {
        setKnowledgeItemProgress(title, 1, true);
        const res = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`);
        const data = await res.json();
        if (!data.success) {
            setKnowledgeItemProgress(title, 100, false);
            return;
        }
        const content = data.knowledge && data.knowledge.content ? data.knowledge.content : '';
        const cfgRes = await fetch('/api/knowledge/vector/config');
        const cfgData = await cfgRes.json();
        const chunkSize = cfgData.chunk_size || 800;
        const chunkOverlap = cfgData.chunk_overlap || 120;
        const chunks = splitTextForVector(content, chunkSize, chunkOverlap);
        if (chunks.length === 0) {
            setKnowledgeItemProgress(title, 100, false);
            return;
        }
        await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        for (let i = 0; i < chunks.length; i++) {
            const chunkObj = chunks[i];
            const resChunk = await fetch('/api/knowledge/vectorize/chunk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    text: chunkObj.text,
                    chunk_id: i,
                    chunk_total: chunks.length,
                    metadata: {
                        chunk_start: chunkObj.start,
                        chunk_end: chunkObj.end
                    }
                })
            });
            const dataChunk = await resChunk.json();
            if (!dataChunk.success) {
                setKnowledgeItemProgress(title, 100, false);
                return;
            }
            const pct = Math.round(((i + 1) / chunks.length) * 100);
            setKnowledgeItemProgress(title, pct, true);
        }
        await fetch('/api/knowledge/vector/mark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        if (knowledgeMetaCache[title]) {
            const updatedAt = Number(knowledgeMetaCache[title].updated_at || 0);
            knowledgeMetaCache[title].vector_updated_at = Math.max(updatedAt, Date.now());
        }
        const list = els.panelBasisList;
        if (list) {
            const safeTitle = escapeCssSelector(title);
            const item = list.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
            if (item) {
                const icon = item.querySelector('.fa-rotate');
                if (icon) icon.remove();
            }
        }
        setKnowledgeItemProgress(title, 100, false);
    } catch (e) {
        setKnowledgeItemProgress(title, 100, false);
    }
}

let vectorProgressTimer = null;
let vectorizeRunId = 0;
let vectorizeTitle = null;
const vectorizeTasks = {};
function startVectorProgress(total) {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!wrap || !bar || !text) return;
    wrap.style.display = 'block';
    bar.style.width = '0%';
// 说明
    if (vectorProgressTimer) clearInterval(vectorProgressTimer);
    vectorProgressTimer = null;
    updateVectorProgress(0, total || 0);
}

function updateVectorProgress(done, total) {
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!bar || !text) return;
    if (!total) {
        bar.style.width = '0%';
// 说明
        return;
    }
    const pct = Math.min(100, Math.round((done / total) * 100));
    bar.style.width = `${pct}%`;
// 说明
}

function stopVectorProgress(message, isError = false) {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const text = document.getElementById('vectorProgressText');
    if (!wrap || !bar || !text) return;
    if (vectorProgressTimer) {
        clearInterval(vectorProgressTimer);
        vectorProgressTimer = null;
    }
    bar.style.width = '100%';
    bar.style.background = isError ? '#ef4444' : 'linear-gradient(90deg, #0f172a, #1e293b)';
    text.textContent = message || '完成';
    setTimeout(() => {
        wrap.style.display = 'none';
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #0f172a, #1e293b)';
        text.textContent = '';
    }, 1200);
}

function cancelVectorizeProgress() {
    vectorizeRunId += 1;
    vectorizeTitle = null;
    stopVectorProgress('已取消', true);
}

function resetVectorProgressUI() {
    const wrap = document.getElementById('vectorProgressWrap');
    const bar = document.getElementById('vectorProgressBar');
    const textEl = document.getElementById('vectorProgressText');
    if (wrap) wrap.style.display = 'none';
    if (bar) {
        bar.style.width = '0%';
        bar.style.background = 'linear-gradient(90deg, #0f172a, #1e293b)';
    }
    if (textEl) textEl.textContent = '';
}


function splitTextForVector(t, maxLen, overlap) {
    if (!t) return [];
    if (!maxLen || maxLen <= 0) return [t];
    if (!overlap) overlap = 0;
    if (overlap >= maxLen) overlap = Math.floor(maxLen / 4);
    const text = t.replace(/\r\n/g, '\n');
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + maxLen, text.length);
        chunks.push({
            text: text.slice(start, end),
            start,
            end
        });
        if (end === text.length) break;
        start = Math.max(0, end - overlap);
    }
    return chunks;
}

async function deleteVectorChunk(vectorId, title) {
    if (!vectorId) return;
    if (!confirm('确定删除该分块吗？')) return;
    setVectorStatus('删除中...');
    try {
        const res = await fetch('/api/knowledge/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vector_id: vectorId })
        });
        const data = await res.json();
        if (!data.success) {
            showToast('删除失败: ' + (data.message || 'Unknown error'));
            setVectorStatus('删除失败');
        }
        loadVectorChunks(title);
    } catch (e) {
        showToast('删除失败: ' + e.message);
        setVectorStatus('删除失败');
    }
}

function setKnowledgeItemVectorState(title, state) {
    const container = els.panelBasisList;
    if (!container) return;
    const safeTitle = escapeCssSelector(title);
    const item = container.querySelector(`.knowledge-item[data-title="${safeTitle}"]`);
    if (!item) return;
    item.classList.remove('vector-pending', 'vector-uploading');
    if (state === 'pending') item.classList.add('vector-pending');
    if (state === 'uploading') item.classList.add('vector-uploading');
}
