/**
 * tool-flow-search.test.mjs — 搜索类工具标题文案测试
 *
 * 验证 local_text_search / local_file_search_tree 不再落到「搜索信息」兜底，
 * 且标题包含调用参数（query / path）与结果统计（命中数 / 扫描文件数）。
 */

import assert from 'node:assert/strict'

import { buildChineseToolAction, getToolExecutionFlowKind } from '../src/stream/toolFlow.ts'

// ---------- local_text_search：目录搜索 ----------

const dirMarkdown = [
    '## Text Search',
    '- Query: `local_agent_chat_stream`',
    '- Scope: directory',
    '- Path: `F:\\Code\\AI\\ChatDB\\NexoraCode`',
    '- Matches: 3',
    '- Files: 12',
    '- Mode: literal',
    '',
    'F:\\Code\\AI\\ChatDB\\NexoraCode\\model\\Routes.py:820  def local_agent_chat_stream(',
].join('\n')

const dirTitle = buildChineseToolAction(
    'local_text_search',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode', query: 'local_agent_chat_stream' },
    dirMarkdown,
    dirMarkdown
)

assert.equal(dirTitle, '搜索文本 "local_agent_chat_stream" NexoraCode/ · 命中 3 处 / 扫描 12 文件')
assert.notEqual(dirTitle, '搜索信息')

// ---------- local_text_search：单文件搜索 ----------

const fileMarkdown = [
    '## Text Search',
    '- Query: `flask`',
    '- Scope: file',
    '- Path: `F:\\Code\\AI\\ChatDB\\NexoraCode\\requirements.txt`',
    '- Matches: 2',
    '- Files: 1',
    '- Mode: literal',
].join('\n')

const fileTitle = buildChineseToolAction(
    'local_text_search',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode\\requirements.txt', query: 'flask' },
    fileMarkdown,
    fileMarkdown
)

assert.equal(fileTitle, '搜索文本 "flask" requirements.txt · 命中 2 处 / 扫描 1 文件')

// ---------- local_text_search：流式期只有参数、还没有结果 ----------

const streamingTitle = buildChineseToolAction(
    'local_text_search',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode\\model', query: 'def _translate_event' }
)

assert.equal(streamingTitle, '搜索文本 "def _translate_event" model/')

// ---------- local_text_search：无命中 ----------

const emptyTitle = buildChineseToolAction(
    'local_text_search',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode\\model', query: '不存在的符号' },
    '## Text Search\n- Query: `不存在的符号`\n- Scope: directory\n- Path: `F:\\Code\\AI\\ChatDB\\NexoraCode\\model`\n- Matches: 0\n- Files: 24\n- Mode: literal\n\n(无匹配)',
    'query=不存在的符号 match_count=0'
)

assert.equal(emptyTitle, '搜索文本 "不存在的符号" model/ · 命中 0 处 / 扫描 24 文件')

// ---------- local_text_search：历史回放无标题头时靠 result 兜底 ----------

const legacyTitle = buildChineseToolAction(
    'local_text_search',
    {},
    'query=ring match_count=20\n\nF:\\a\\b.py:7  ring',
    'query=ring match_count=20'
)

assert.equal(legacyTitle, '搜索文本 "ring" · 命中 20 处')

// ---------- local_file_search_tree ----------

const treeMarkdown = [
    '## File Tree',
    '- Path: `F:\\Code\\AI\\ChatDB\\NexoraCode\\model`',
    '- Entries: 24',
    '- Scanned: 26',
    '',
    '- AgentLoop.py (67298 B)',
].join('\n')

const treeTitle = buildChineseToolAction(
    'local_file_search_tree',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode\\model' },
    treeMarkdown,
    treeMarkdown
)

assert.equal(treeTitle, '查找文件 model/ · 24 项')

// 无结果时仍显示目录名，不退化为兜底文案
const treeStreamingTitle = buildChineseToolAction(
    'local_file_search_tree',
    { path: 'F:\\Code\\AI\\ChatDB\\NexoraCode\\model' }
)

assert.equal(treeStreamingTitle, '查找文件 model/')
assert.notEqual(treeStreamingTitle, '搜索信息')

// ---------- 分支顺序：filesearchtree 不被 filesearch 截胡 ----------

assert.notEqual(
    buildChineseToolAction('local_file_search_tree', { path: '/a/b' }),
    buildChineseToolAction('local_file_find', { path: '/a/b' })
)

// ---------- 流程节点配色保持既有行为（本次只改标题文案） ----------

assert.equal(getToolExecutionFlowKind('local_text_search'), 'web')
assert.equal(getToolExecutionFlowKind('local_file_search_tree'), 'file')

console.log('Tool flow search tests passed')
