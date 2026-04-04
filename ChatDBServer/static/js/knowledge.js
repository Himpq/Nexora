// 全局变量
let currentTab = 'basis';
let editingKnowledge = null;

// DOM元素
const basisTabBtn = document.getElementById('basisTabBtn');
const shortTabBtn = document.getElementById('shortTabBtn');
const basisContent = document.getElementById('basisContent');
const shortContent = document.getElementById('shortContent');
const addBasisBtn = document.getElementById('addBasisBtn');
const addShortBtn = document.getElementById('addShortBtn');
const basisGrid = document.getElementById('basisGrid');
const shortList = document.getElementById('shortList');

// Modal相关
const addBasisModal = document.getElementById('addBasisModal');
const addShortModal = document.getElementById('addShortModal');
const viewModal = document.getElementById('viewModal');
const closeBtns = document.querySelectorAll('.close-btn');
const cancelBtns = document.querySelectorAll('.cancel-btn');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadBasisKnowledge();
    loadShortMemory();
    setupEventListeners();
});

// 设置事件监听
function setupEventListeners() {
    // Tab切换
    basisTabBtn.addEventListener('click', () => switchTab('basis'));
    shortTabBtn.addEventListener('click', () => switchTab('short'));
    
    // 添加按钮
    addBasisBtn.addEventListener('click', () => openAddBasisModal());
    addShortBtn.addEventListener('click', () => openAddShortModal());
    
    // 分享按钮
    document.getElementById('toggleShareBtn').addEventListener('click', toggleShare);

    // 关闭Modal
    closeBtns.forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    cancelBtns.forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    
    // 点击Modal外部关闭
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
    
    // 表单提交
    document.getElementById('basisForm').addEventListener('submit', handleBasisSubmit);
    document.getElementById('shortForm').addEventListener('submit', handleShortSubmit);
}

// 分享处理
async function toggleShare() {
    if (!editingKnowledge) {
        alert('请先保存后再开启分享');
        return;
    }
    const title = editingKnowledge;
    try {
        const response = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public: true })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('shareInfo').style.display = 'block';
            const shareLink = document.getElementById('shareLink');
            shareLink.href = data.share_url;
            shareLink.textContent = data.share_url;
            alert('公开协作已开启');
        }
    } catch (e) {
        alert('操作失败');
    }
}

// 切换Tab
function switchTab(tab) {
    currentTab = tab;
    
    if (tab === 'basis') {
        basisTabBtn.classList.add('active');
        shortTabBtn.classList.remove('active');
        basisContent.classList.add('active');
        shortContent.classList.remove('active');
    } else {
        shortTabBtn.classList.add('active');
        basisTabBtn.classList.remove('active');
        shortContent.classList.add('active');
        basisContent.classList.remove('active');
    }
}

// 加载基础知识
async function loadBasisKnowledge() {
    try {
        const response = await fetch('/api/knowledge/basis');
        const data = await response.json();
        
        if (data.success) {
            renderBasisKnowledge(data.knowledge);
        }
    } catch (error) {
        console.error('加载基础知识失败:', error);
        showError('加载基础知识失败');
    }
}

// 渲染基础知识
function renderBasisKnowledge(knowledgeList) {
    basisGrid.innerHTML = '';
    
    if (knowledgeList.length === 0) {
        basisGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #9ca3af;">暂无基础知识</div>';
        return;
    }
    
    knowledgeList.forEach(item => {
        const card = document.createElement('div');
        card.className = 'knowledge-card';
        
        // 截取内容预览
        const preview = item.content.length > 100 
            ? item.content.substring(0, 100) + '...' 
            : item.content;
        
        card.innerHTML = `
            <h3>${escapeHtml(item.title)}</h3>
            <p class="preview">${escapeHtml(preview)}</p>
            <div class="actions">
                <button onclick="viewBasisKnowledge('${item.title}')">查看</button>
                <button onclick="editBasisKnowledge('${item.title}')">编辑</button>
                <button onclick="deleteBasisKnowledge('${item.title}')" class="delete">删除</button>
            </div>
        `;
        
        basisGrid.appendChild(card);
    });
}

// 加载短期记忆
async function loadShortMemory() {
    try {
        const response = await fetch('/api/knowledge/short');
        const data = await response.json();
        
        if (data.success) {
            renderShortMemory(data.memories);
        }
    } catch (error) {
        console.error('加载短期记忆失败:', error);
        showError('加载短期记忆失败');
    }
}

// 渲染短期记忆
function renderShortMemory(memories) {
    shortList.innerHTML = '';
    
    if (memories.length === 0) {
        shortList.innerHTML = '<div style="text-align: center; padding: 40px; color: #9ca3af;">暂无短期记忆</div>';
        return;
    }
    
    memories.forEach(item => {
        const listItem = document.createElement('div');
        listItem.className = 'short-item';
        
        listItem.innerHTML = `
            <div class="content">
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.content)}</p>
            </div>
            <div class="actions">
                <button onclick="editShortMemory('${item.title}')">编辑</button>
                <button onclick="deleteShortMemory('${item.title}')" class="delete">删除</button>
            </div>
        `;
        
        shortList.appendChild(listItem);
    });
}

// 打开添加基础知识Modal
function openAddBasisModal() {
    editingKnowledge = null;
    document.getElementById('basisModalTitle').textContent = '添加基础知识';
    document.getElementById('basisTitle').value = '';
    document.getElementById('basisContent').value = '';
    document.getElementById('basisSubmitBtn').textContent = '添加';
    addBasisModal.classList.add('active');
}

// 打开添加短期记忆Modal
function openAddShortModal() {
    editingKnowledge = null;
    document.getElementById('shortModalTitle').textContent = '添加短期记忆';
    document.getElementById('shortTitle').value = '';
    document.getElementById('shortContent').value = '';
    document.getElementById('shortSubmitBtn').textContent = '添加';
    addShortModal.classList.add('active');
}

// 查看基础知识
async function viewBasisKnowledge(title) {
    try {
        const response = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`);
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('viewTitle').textContent = data.knowledge.title;
            document.getElementById('viewContent').textContent = data.knowledge.content;
            viewModal.classList.add('active');
        }
    } catch (error) {
        console.error('查看失败:', error);
        showError('查看失败');
    }
}

// 编辑基础知识
async function editBasisKnowledge(title) {
    try {
        const response = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`);
        const data = await response.json();
        
        if (data.success) {
            editingKnowledge = title;
            document.getElementById('basisModalTitle').textContent = '编辑基础知识';
            document.getElementById('basisTitle').value = data.knowledge.title;
            document.getElementById('basisContent').value = data.knowledge.content;
            document.getElementById('basisSubmitBtn').textContent = '保存';
            addBasisModal.classList.add('active');
        }
    } catch (error) {
        console.error('加载失败:', error);
        showError('加载失败');
    }
}

// 编辑短期记忆
async function editShortMemory(title) {
    try {
        const response = await fetch(`/api/knowledge/short/${encodeURIComponent(title)}`);
        const data = await response.json();
        
        if (data.success) {
            editingKnowledge = title;
            document.getElementById('shortModalTitle').textContent = '编辑短期记忆';
            document.getElementById('shortTitle').value = data.memory.title;
            document.getElementById('shortContent').value = data.memory.content;
            document.getElementById('shortSubmitBtn').textContent = '保存';
            addShortModal.classList.add('active');
        }
    } catch (error) {
        console.error('加载失败:', error);
        showError('加载失败');
    }
}

// 删除基础知识
async function deleteBasisKnowledge(title) {
    if (!confirm(`确定要删除"${title}"吗？`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/knowledge/basis/${encodeURIComponent(title)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            showSuccess('删除成功');
            loadBasisKnowledge();
        } else {
            showError(data.error || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showError('删除失败');
    }
}

// 删除短期记忆
async function deleteShortMemory(title) {
    if (!confirm(`确定要删除"${title}"吗？`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/knowledge/short/${encodeURIComponent(title)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            showSuccess('删除成功');
            loadShortMemory();
        } else {
            showError(data.error || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showError('删除失败');
    }
}

// 处理基础知识表单提交
async function handleBasisSubmit(e) {
    e.preventDefault();
    
    const title = document.getElementById('basisTitle').value.trim();
    const content = document.getElementById('basisContent').value.trim();
    
    if (!title || !content) {
        showError('请填写完整信息');
        return;
    }
    
    try {
        const url = editingKnowledge 
            ? `/api/knowledge/basis/${encodeURIComponent(editingKnowledge)}`
            : '/api/knowledge/basis';
        const method = editingKnowledge ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: title,
                content: content
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(editingKnowledge ? '保存成功' : '添加成功');
            closeAllModals();
            loadBasisKnowledge();
        } else {
            showError(data.error || '操作失败');
        }
    } catch (error) {
        console.error('提交失败:', error);
        showError('提交失败');
    }
}

// 处理短期记忆表单提交
async function handleShortSubmit(e) {
    e.preventDefault();
    
    const title = document.getElementById('shortTitle').value.trim();
    const content = document.getElementById('shortContent').value.trim();
    
    if (!title || !content) {
        showError('请填写完整信息');
        return;
    }
    
    try {
        const url = editingKnowledge 
            ? `/api/knowledge/short/${encodeURIComponent(editingKnowledge)}`
            : '/api/knowledge/short';
        const method = editingKnowledge ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: title,
                content: content
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(editingKnowledge ? '保存成功' : '添加成功');
            closeAllModals();
            loadShortMemory();
        } else {
            showError(data.error || '操作失败');
        }
    } catch (error) {
        console.error('提交失败:', error);
        showError('提交失败');
    }
}

// 关闭所有Modal
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('active');
    });
    editingKnowledge = null;
}

// 显示成功消息
function showSuccess(message) {
    // 简单的提示实现
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 显示错误消息
function showError(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ef4444;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);


