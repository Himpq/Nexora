/**
 * notes.ts — 笔记 API
 *
 * 对应后端路由:
 *   GET /api/notes/store     读取全量笔记存储
 *   PUT /api/notes/store     全量覆盖保存
 */

import { apiFetch } from './client'

export interface NotebookItem {
    id: string
    name: string
    ts: number
}

export interface NoteAnchor {
    type: 'chat' | 'knowledge'
    conversationId?: string
    messageIndex?: number
    messageRole?: string
    title?: string
    snippet?: string
    plainSnippet?: string
}

export interface NoteItem {
    id: string
    notebookId: string
    text: string
    source?: string
    sourceTitle?: string
    anchor?: NoteAnchor | null
    ts: number
}

export interface NotesStore {
    activeNotebookId: string
    notebooks: NotebookItem[]
    notes: NoteItem[]
    updatedAt: number
}

interface NotesStoreResponse {
    success: boolean
    store?: NotesStore
}

/** 读取当前用户笔记存储 */
export async function fetchNotesStore(): Promise<NotesStore | null> {
    const data = await apiFetch<NotesStoreResponse>('/api/notes/store')

    return data.store || null
}

/** 保存全量笔记存储 */
export async function saveNotesStore(store: NotesStore): Promise<void> {
    await apiFetch<{ success: boolean }>('/api/notes/store', {
        method: 'PUT',
        body: JSON.stringify({ store }),
    })
}
