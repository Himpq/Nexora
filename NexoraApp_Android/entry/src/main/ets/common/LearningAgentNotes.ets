import { ApiService } from './ApiService';
import { NoteItem, NotesStore } from './AppConfig';
import { LearningHttp, LearningIdentity } from './LearningHttp';

// Use the same merge contract as NotesPage, so saving an answer never overwrites other notes.
export class LearningAgentNotes {
    private static check(owner: LearningIdentity | null): void {
        if (owner === null || !LearningHttp.isCurrent(owner)) { throw new Error('账号已切换，请重试'); }
    }

    static async context(): Promise<string> {
        const owner = LearningHttp.captureIdentity();
        LearningAgentNotes.check(owner);
        const result = await ApiService.fetchNotesStore();
        LearningAgentNotes.check(owner);
        if (!result.success || result.store === null) { throw new Error(result.message || '随笔暂时无法读取'); }
        return result.store.notes.slice().sort((a: NoteItem, b: NoteItem): number => b.updatedAt - a.updatedAt)
            .slice(0, 12).map((note: NoteItem): string => note.content).join('\n\n---\n\n').substring(0, 6000);
    }

    static async save(id: string, text: string, title: string): Promise<void> {
        const owner = LearningHttp.captureIdentity();
        LearningAgentNotes.check(owner);
        const result = await ApiService.fetchNotesStore();
        LearningAgentNotes.check(owner);
        if (!result.success || result.store === null) { throw new Error(result.message || '随笔暂时无法读取'); }
        const base: NotesStore = result.store;
        const noteId: string = 'learning_agent_' + id;
        if (base.notes.some((note: NoteItem): boolean => note.id === noteId)) { return; }
        const notebookId: string = base.activeNotebookId || (base.notebooks.length > 0 ? base.notebooks[0].id : 'default');
        const now: number = Date.now();
        const note: NoteItem = { id: noteId, content: text, updatedAt: now, notebookId: notebookId,
            source: 'agent', sourceTitle: title || 'Agent 学习记录', anchor: null };
        const updated: NotesStore = { activeNotebookId: notebookId,
            notebooks: base.notebooks.length > 0 ? base.notebooks : [{ id: notebookId, name: '随笔', ts: now }],
            notes: base.notes.concat([note]), updatedAt: now };
        LearningAgentNotes.check(owner);
        const saved = await ApiService.saveNotesStore(updated, base);
        LearningAgentNotes.check(owner);
        if (!saved.success) { throw new Error(saved.message || '随笔尚未保存，请重试'); }
    }
}
