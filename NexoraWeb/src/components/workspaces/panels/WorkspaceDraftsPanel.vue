<!--
    WorkspaceDraftsPanel.vue — Workspace 草稿面板

    展示 workspace_drafts 条目列表(模型经 workspace_draft_add 工具写入或手动新建)。
    行内编辑卡负责手动新建;删除仅手动进行,模型只拥有新增权限。
-->

<template>
    <div class="ws-drafts">
        <div class="ws-drafts-toolbar">
            <span class="ws-drafts-count">{{ drafts.length ? `${drafts.length} 条草稿` : '' }}</span>
            <button
                class="ws-drafts-new-btn"
                :class="{ 'is-open': composing }"
                type="button"
                :title="composing ? '收起新建草稿' : '新建草稿'"
                :aria-label="composing ? '收起新建草稿' : '新建草稿'"
                @click="toggleComposer"
            >
                <i :class="composing ? 'fa-solid fa-chevron-up' : 'fa-solid fa-plus'" aria-hidden="true"></i>
                <span>新建草稿</span>
            </button>
        </div>

        <!-- 行内新建编辑卡 -->
        <div v-if="composing" class="ws-drafts-composer">
            <input
                ref="titleInputRef"
                v-model="draftTitle"
                class="ws-drafts-composer-title"
                type="text"
                maxlength="120"
                placeholder="草稿标题(必填,最多 120 字)"
                aria-label="草稿标题"
                :disabled="saving"
            >
            <textarea
                v-model="draftContent"
                class="ws-drafts-composer-content"
                maxlength="4000"
                rows="6"
                placeholder="草稿内容(必填,最多 4000 字,支持 Markdown)"
                aria-label="草稿内容"
                :disabled="saving"
            ></textarea>
            <div class="ws-drafts-composer-foot">
                <span class="ws-drafts-composer-hint">{{ draftContent.length }} / 4000</span>
                <span class="ws-drafts-composer-actions">
                    <button class="ws-drafts-btn" type="button" :disabled="saving" @click="closeComposer">取消</button>
                    <button class="ws-drafts-btn is-primary" type="button" :disabled="saving" @click="submitDraft">
                        <i v-if="saving" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                        <span>保存</span>
                    </button>
                </span>
            </div>
        </div>

        <!-- 草稿列表 -->
        <div class="ws-drafts-list">
            <div v-if="!drafts.length" class="ws-empty">暂无草稿。对话中让模型记录重要数据,或手动新建草稿。</div>
            <article v-for="draft in drafts" :key="String(draft.draft_id || draft.title)" class="ws-drafts-card">
                <header class="ws-drafts-card-head">
                    <span class="ws-drafts-card-icon"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></span>
                    <strong class="ws-drafts-card-title">{{ draft.title || '未命名草稿' }}</strong>
                    <button
                        class="ws-drafts-card-remove"
                        type="button"
                        title="删除草稿"
                        aria-label="删除草稿"
                        @click="actions.removeDraft(draft)"
                    >
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                </header>
                <MarkdownView v-if="content(draft)" class="ws-drafts-card-content" :content="content(draft)" />
                <footer class="ws-drafts-card-meta">
                    <span>{{ [addedBy(draft), addedAt(draft)].filter(Boolean).join(' · ') }}</span>
                </footer>
            </article>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref } from 'vue'

    import MarkdownView from '@/components/MarkdownView.vue'

    import type { WorkspaceDetail, WorkspaceDraftEntry } from '@/api/workspaces'
    import { formatWorkspaceDate } from '@/api/workspaces'

    import { useWorkspaceActions } from '../workspaceContext'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()

    const drafts = computed<WorkspaceDraftEntry[]>(() => {
        const list = props.workspace.workspace_drafts

        if (!Array.isArray(list)) {
            return []
        }

        // 新草稿在前,便于先看最近沉淀的数据
        return [...list].sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')))
    })

    function content(draft: WorkspaceDraftEntry): string {
        return String(draft.content || '').trim()
    }

    function addedBy(draft: WorkspaceDraftEntry): string {
        return draft.added_by ? `@${draft.added_by}` : ''
    }

    function addedAt(draft: WorkspaceDraftEntry): string {
        return formatWorkspaceDate(draft.added_at)
    }

    /** ===== 行内新建编辑卡 ===== */
    const composing = ref(false)
    const saving = ref(false)
    const draftTitle = ref('')
    const draftContent = ref('')
    const titleInputRef = ref<HTMLInputElement | null>(null)

    async function toggleComposer(): Promise<void> {
        if (composing.value) {
            closeComposer()

            return
        }

        composing.value = true

        await nextTick(() => {
            titleInputRef.value?.focus()
        })
    }

    function closeComposer(): void {
        composing.value = false
        draftTitle.value = ''
        draftContent.value = ''
    }

    async function submitDraft(): Promise<void> {
        if (saving.value) {
            return
        }

        const title = draftTitle.value.trim()

        if (!title) {
            titleInputRef.value?.focus()

            return
        }

        const content = draftContent.value.trim()

        if (!content) {
            return
        }

        saving.value = true

        try {
            const saved = await actions.addDraft(title, content)

            if (saved) {
                closeComposer()
            }
        } finally {
            saving.value = false
        }
    }
</script>

<style scoped>
    .ws-drafts {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 2px 10px 32px;
    }

    .ws-drafts-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 32px;
    }

    .ws-drafts-count {
        color: var(--color-text-secondary);
        font-size: 13px;
    }

    .ws-drafts-new-btn {
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 0 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease;
    }

    .ws-drafts-new-btn:hover,
    .ws-drafts-new-btn.is-open {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
    }

    /* ===== 行内新建编辑卡 ===== */
    .ws-drafts-composer {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-bg-elevated);
        padding: 14px;
    }

    .ws-drafts-composer-title {
        width: 100%;
        height: 38px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        box-sizing: border-box;
        padding: 0 12px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        outline: none;
    }

    .ws-drafts-composer-title:focus,
    .ws-drafts-composer-content:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-drafts-composer-content {
        width: 100%;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        box-sizing: border-box;
        padding: 10px 12px;
        font: inherit;
        font-size: 14px;
        line-height: 1.6;
        resize: vertical;
        min-height: 120px;
        outline: none;
    }

    .ws-drafts-composer-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .ws-drafts-composer-hint {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ws-drafts-composer-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }

    .ws-drafts-btn {
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 14px;
        font: inherit;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease;
    }

    .ws-drafts-btn:hover:not(:disabled) {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
    }

    .ws-drafts-btn.is-primary {
        border-color: var(--color-accent-text);
        background: var(--color-accent-surface);
        color: var(--color-accent-text);
    }

    .ws-drafts-btn:disabled {
        cursor: default;
        opacity: 0.68;
    }

    /* ===== 草稿卡片 ===== */
    .ws-drafts-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .ws-drafts-card {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-bg-elevated);
        padding: 14px 16px;
    }

    .ws-drafts-card-head {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .ws-drafts-card-icon {
        width: 30px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        font-size: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    .ws-drafts-card-title {
        flex: 1 1 auto;
        min-width: 0;
        color: var(--color-text-primary);
        font-size: 15px;
        font-weight: 650;
        line-height: 1.4;
        overflow-wrap: anywhere;
    }

    .ws-drafts-card-remove {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        padding: 0;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
    }

    .ws-drafts-card-remove:hover:not(:disabled) {
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    .ws-drafts-card-remove:disabled {
        cursor: default;
        opacity: 0.72;
    }

    .ws-drafts-card-content {
        margin-top: 10px;
        color: var(--color-text-primary);
        font-size: 14px;
        line-height: 1.7;
        overflow-wrap: anywhere;
    }

    .ws-drafts-card-meta {
        margin-top: 10px;
        color: var(--color-text-secondary);
        font-size: 12px;
    }
</style>
