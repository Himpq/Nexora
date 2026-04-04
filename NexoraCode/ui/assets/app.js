/**
 * NexoraCode 前端逻辑
 * 职责：握手 → 加载设置 → 和 Nexora 服务器通信 → 渲染消息
 */

// ── 状态 ───────────────────────────────────────────────────
let TOKEN = null;
let nexoraUrl = null;
const conversations = [];   // { id, title, messages[] }
let currentConvId = null;

// ── DOM 引用 ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const messagesEl    = $('messages');
const inputEl       = $('input');
const btnSend       = $('btn-send');
const statusDot     = $('connection-status');
const toolStatusBar = $('tool-status-bar');
const toolStatusTxt = $('tool-status-text');
const convList      = $('conversation-list');
const convTitle     = $('conversation-title');

// ── 初始化 ─────────────────────────────────────────────────
(async function init() {
  // 1. 从本地服务器握手获取 token
  try {
    const r = await fetch('/api/handshake');
    const d = await r.json();
    TOKEN = d.token;
  } catch (e) {
    setStatus('disconnected');
    console.error('[handshake] failed', e);
    return;
  }

  // 2. 加载配置
  try {
    const r = await api('GET', 'nexora/api/settings');
    nexoraUrl = r.nexora_url;
    applySettings(r);
    setStatus('connected');
  } catch (e) {
    setStatus('disconnected');
  }

  // 3. 新建初始对话
  newConversation();
})();

// ── 基础 API 封装 ──────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'X-Local-Token': TOKEN, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`/api/${path}`, opts);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

// ── 连接状态 ───────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
  statusDot.title = { connected: '已连接 Nexora', disconnected: '未连接 Nexora', connecting: '连接中…' }[state] || '';
}

// ── 对话管理 ───────────────────────────────────────────────
function newConversation() {
  const id = Date.now().toString();
  const conv = { id, title: '新对话', messages: [] };
  conversations.unshift(conv);
  currentConvId = id;
  renderConvList();
  messagesEl.innerHTML = `
    <div class="welcome-screen">
      <h1>NexoraCode.</h1>
      <p>本地工具已就绪，开始对话吧。</p>
    </div>`;
  if (convTitle) convTitle.textContent = 'NexoraCode';
}

function renderConvList() {
  convList.innerHTML = conversations.map(c =>
    `<div class="conversation-item${c.id === currentConvId ? ' active' : ''}" onclick="switchConv('${c.id}')">
      <span class="title">${escHtml(c.title)}</span>
      <button class="delete-btn" onclick="deleteConv(event,'${c.id}')" title="删除">×</button>
    </div>`
  ).join('');
}

function deleteConv(e, id) {
  e.stopPropagation();
  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return;
  conversations.splice(idx, 1);
  if (currentConvId === id) newConversation();
  else renderConvList();
}

function switchConv(id) {
  currentConvId = id;
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  renderConvList();
  messagesEl.innerHTML = '';
  conv.messages.forEach(m => appendMessage(m.role, m.content, false));
  if (convTitle) convTitle.textContent = conv.title;
}

function currentConv() { return conversations.find(c => c.id === currentConvId); }

// ── 消息渲染 ───────────────────────────────────────────────
function appendMessage(role, content, animate = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'assistant') {
    div.innerHTML = renderMarkdown(content);
    if (animate) div.classList.add('cursor-blink');
  } else {
    // 用户消息用 bubble 包裹
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    div.appendChild(bubble);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function updateLastAssistantMessage(div, text, done = false) {
  div.innerHTML = renderMarkdown(text);
  if (done) {
    div.classList.remove('cursor-blink');
    // 触发 KaTeX 渲染
    if (window.renderMathInElement) {
      renderMathInElement(div, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    }
    // highlight.js
    div.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  // 保护行内数学公式不被 marked 破坏：先替换占位符
  const mathBlocks = [];
  let protected_ = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { mathBlocks.push(`$$${m}$$`); return `%%MATH${mathBlocks.length - 1}%%`; })
    .replace(/\$([^\n$]+?)\$/g, (_, m) => { mathBlocks.push(`$${m}$`); return `%%MATH${mathBlocks.length - 1}%%`; });

  let html = marked.parse(protected_, { breaks: true, gfm: true });

  // 还原数学公式（原始字符串，由 KaTeX auto-render 处理）
  mathBlocks.forEach((m, i) => {
    html = html.replace(`%%MATH${i}%%`, escHtml(m).replace(/\$/g, '$'));
  });

  return html;
}

// ── 工具调用卡片 ───────────────────────────────────────────
function appendToolCard(toolName, params, result, isError) {
  const card = document.createElement('div');
  card.className = `tool-call-card${isError ? ' error' : ''}`;
  card.innerHTML = `
    <div class="tool-name">⚙ ${escHtml(toolName)}</div>
    <div class="tool-result">${escHtml(JSON.stringify(result, null, 2))}</div>
  `;
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── 发送消息 ───────────────────────────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !TOKEN) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  btnSend.disabled = true;

  const conv = currentConv();
  conv.messages.push({ role: 'user', content: text });
  if (conv.title === '新对话' && text.length > 0) {
    conv.title = text.slice(0, 28) + (text.length > 28 ? '…' : '');
    if (convTitle) convTitle.textContent = conv.title;
  }
  renderConvList();
  appendMessage('user', text);

  // 显示 assistant 占位气泡（流式）
  const assistantDiv = appendMessage('assistant', '', true);
  setToolStatus(true, '正在连接…');

  let fullText = '';

  try {
    // SSE 流式请求
    const resp = await fetch('/api/nexora/api/chat', {
      method: 'POST',
      headers: {
        'X-Local-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: conv.messages,
        stream: true,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    setToolStatus(false);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop(); // 未完成的行留到下次

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') break;
        try {
          const chunk = JSON.parse(raw);
          if (chunk.type === 'text') {
            fullText += chunk.content;
            updateLastAssistantMessage(assistantDiv, fullText, false);
          } else if (chunk.type === 'tool_call') {
            setToolStatus(true, `执行工具：${chunk.tool}`);
          } else if (chunk.type === 'tool_result') {
            setToolStatus(false);
            appendToolCard(chunk.tool, chunk.params, chunk.result, !!chunk.error);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    fullText = `*请求失败：${e.message}*`;
    setStatus('disconnected');
  }

  updateLastAssistantMessage(assistantDiv, fullText, true);
  conv.messages.push({ role: 'assistant', content: fullText });
  setToolStatus(false);
  btnSend.disabled = false;
  inputEl.focus();
}

function setToolStatus(visible, text = '') {
  if (!toolStatusBar) return;
  toolStatusBar.classList.toggle('hidden', !visible);
  if (toolStatusTxt) toolStatusTxt.textContent = text;
}

// ── 设置面板 ───────────────────────────────────────────────
function applySettings(cfg) {
  $('cfg-nexora-url').value = cfg.nexora_url || '';
  $('cfg-allowed-dirs').value = (cfg.allowed_dirs || []).join('\n');
  $('cfg-shell-whitelist').value = (cfg.shell_whitelist || []).join('\n');
}

$('btn-settings').addEventListener('click', async () => {
  try {
    const cfg = await api('GET', 'nexora/api/settings');
    applySettings(cfg);
  } catch (_) {}
  $('settings-overlay').classList.remove('hidden');
});

function closeSettings() { $('settings-overlay').classList.add('hidden'); }
$('btn-close-settings').addEventListener('click', closeSettings);
$('btn-close-settings-2').addEventListener('click', closeSettings);

$('btn-save-settings').addEventListener('click', async () => {
  const cfg = {
    nexora_url: $('cfg-nexora-url').value.trim(),
    allowed_dirs: $('cfg-allowed-dirs').value.split('\n').map(s => s.trim()).filter(Boolean),
    shell_whitelist: $('cfg-shell-whitelist').value.split('\n').map(s => s.trim()).filter(Boolean),
  };
  try {
    await api('POST', 'nexora/api/settings', cfg);
    closeSettings();
    setStatus('connected');
  } catch (e) {
    alert('保存失败：' + e.message);
  }
});

$('settings-overlay').addEventListener('click', e => {
  if (e.target === $('settings-overlay')) closeSettings();
});

// ── 按钮事件 ───────────────────────────────────────────────
btnSend.addEventListener('click', sendMessage);
$('btn-new-chat').addEventListener('click', newConversation);

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 自动扩展输入框高度
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

// ── 工具函数 ───────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// KaTeX auto-render（由 katex contrib 触发）
function renderMathInDocument() {
  // auto-render.min.js 加载完成后会自动调用，这里作初始化钩子占位
}
