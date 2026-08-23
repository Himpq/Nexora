<!--
    WorkspaceFilesPanel.vue — Workspace 文件面板

    卡片网格(auto-fill 小卡):图片缩略图 / 类型图标 + 名称两行截断 +
    "大小 · 类型"元信息 + 可见性开关;点击打开内置预览,右键弹出置顶菜单。
    悬停 tooltip 汇总名称/添加者/大小/类型/更新时间(对齐原版多行 title)。
-->

<template>
    <div class="ws-files-grid">
        <div v-if="!files.length" class="ws-empty">暂无文件</div>

        <div
            v-for="entry in files"
            :key="`${entry.file_ref}:${String(entry.added_by || '')}`"
            class="ws-file-card is-clickable"
            :class="{ 'is-pinned': entry.pin }"
            role="button"
            tabindex="0"
            :aria-label="`打开文件:${displayName(entry)}`"
            :title="cardTooltip(entry)"
            @click="actions.openFile(entry)"
            @keydown.enter.prevent="actions.openFile(entry)"
            @contextmenu.prevent="openMenu($event, entry)"
        >
            <div class="ws-file-card-media">
                <img v-if="thumbnailUrl(entry)" class="ws-file-thumb" :src="thumbnailUrl(entry)" :alt="displayName(entry)">
                <span v-else class="ws-file-icon" :class="toneClass(entry)">
                    <i :class="iconClass(entry)" aria-hidden="true"></i>
                </span>
            </div>
            <div class="ws-file-card-name">
                <i v-if="entry.pin" class="fa-solid fa-thumbtack ws-pin-icon" aria-hidden="true"></i>{{ displayName(entry) }}
            </div>
            <div class="ws-file-card-meta">{{ metaText(entry) }}</div>
            <div class="ws-file-card-switch">
                <WorkspaceVisibilitySwitch
                    :visibility="String(entry.visibility || '')"
                    :disabled="!canEdit(entry)"
                    :saving="savingKey === rowKey(entry)"
                    @toggle="toggleVisibility(entry)"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import {
        fileDisplayName,
        fileIconClass,
        fileToneClass,
        formatFileSize,
        isImageFile,
    } from '@/api/files-center'
    import type { WorkspaceDetail, WorkspaceFileEntry } from '@/api/workspaces'
    import { formatWorkspaceDate, workspaceFileUrl } from '@/api/workspaces'

    import { canEditVisibilityOf, fileRef, isVisibilitySwitchTarget, resourceRowKey, toCloudFileItem } from '../workspaceResource'
    import { fileTypeText, sortPinnedFirst } from '../workspaceDisplay'
    import { useVisibilitySavingKey, useWorkspaceActions } from '../workspaceContext'

    import WorkspaceVisibilitySwitch from '../WorkspaceVisibilitySwitch.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()
    const savingKey = useVisibilitySavingKey()

    const files = computed<WorkspaceFileEntry[]>(() => {
        const items = Array.isArray(props.workspace.workspace_files) ? props.workspace.workspace_files : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    function displayName(entry: WorkspaceFileEntry): string {
        return fileDisplayName(toCloudFileItem(entry))
    }

    function toneClass(entry: WorkspaceFileEntry): string {
        return fileToneClass(toCloudFileItem(entry))
    }

    function iconClass(entry: WorkspaceFileEntry): string {
        return fileIconClass(toCloudFileItem(entry))
    }

    /** 图片缩略图走项目下载接口内联(added_by 定位跨用户沙箱) */
    function thumbnailUrl(entry: WorkspaceFileEntry): string {
        if (!isImageFile(toCloudFileItem(entry))) {
            return ''
        }

        return workspaceFileUrl(String(props.workspace.workspace_id || ''), entry.file_ref, String(entry.added_by || ''), true)
    }

    /** 卡片元信息:大小 · 类型 */
    function metaText(entry: WorkspaceFileEntry): string {
        return [formatFileSize(Number(entry.size || 0)), fileTypeText(entry)].filter(Boolean).join(' · ')
    }

    /** 悬停 tooltip(对齐原版多行 title:名称/@添加者/大小/类型/更新时间) */
    function cardTooltip(entry: WorkspaceFileEntry): string {
        const date = formatWorkspaceDate(entry.updated_at || entry.added_at || entry.created_at)

        return [
            displayName(entry),
            entry.added_by ? `@${entry.added_by}` : '',
            formatFileSize(Number(entry.size || 0)),
            fileTypeText(entry),
            date !== '-' ? `更新:${date}` : '',
        ].filter(Boolean).join('\n')
    }

    function canEdit(entry: WorkspaceFileEntry): boolean {
        return canEditVisibilityOf(props.workspace, entry.added_by, actions.currentUserId())
    }

    function rowKey(entry: WorkspaceFileEntry): string {
        return resourceRowKey(fileRef(entry))
    }

    function toggleVisibility(entry: WorkspaceFileEntry): void {
        const target = fileRef(entry)
        const next = target.visibility === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(target, next)
    }

    /** 开关区域右键不弹置顶菜单(对齐原版 visibility-toggle 排除) */
    function openMenu(event: MouseEvent, entry: WorkspaceFileEntry): void {
        if (isVisibilitySwitchTarget(event.target)) {
            return
        }

        actions.openResourceMenu(event, fileRef(entry))
    }
</script>

<style scoped>
    .ws-files-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
        gap: 10px 8px;
        align-items: start;
    }

    .ws-empty {
        grid-column: 1 / -1;
    }

    .ws-file-card {
        position: relative;
        min-width: 0;
        /* 高度由固定媒体区 + 2 行标题 + 元信息 + 开关自然撑开,不强制 min-height,
           保证缩略图与类型图标卡片高度统一(对齐原版卡片网格的整齐排布)。 */
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-primary);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 7px;
        padding: 10px 8px;
        cursor: pointer;
        transition: background-color 0.12s ease, border-color 0.12s ease;
    }

    .ws-file-card:hover,
    .ws-file-card:focus-visible {
        border-color: var(--color-border);
        background: var(--color-bg-hover);
        outline: none;
    }

    /* 媒体区固定 54px(缩略图与类型图标同框),消除图片/非图片卡片的高度差 */
    .ws-file-card-media {
        width: 54px;
        height: 54px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    .ws-file-thumb {
        width: 54px;
        height: 54px;
        border: 1px solid var(--color-border);
        border-radius: 9px;
        background: var(--color-bg-sunken);
        object-fit: cover;
        display: block;
    }

    .ws-file-icon {
        width: 54px;
        height: 54px;
        border-radius: 9px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
    }

    /* 标题固定预留 2 行高度,长名省略号截断,避免单行/双行卡片错位 */
    .ws-file-card-name {
        width: 100%;
        min-width: 0;
        min-height: calc(13px * 1.35 * 2);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
        line-height: 1.35;
        text-align: center;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow-wrap: anywhere;
    }

    .ws-pin-icon {
        margin-right: 5px;
    }

    .ws-file-card-meta {
        width: 100%;
        min-height: 16px;
        color: var(--color-text-secondary);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-file-card-switch {
        margin-top: auto;
        display: flex;
        justify-content: center;
    }
</style>
