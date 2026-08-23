<!--
    WorkspaceFilesPanel.vue — Workspace 文件面板

    卡片网格(auto-fill 小卡):图片缩略图 / 类型图标 + 名称两行截断 +
    "大小 · 类型"元信息 + 可见性开关;点击打开内置预览,右键弹出置顶菜单。
    对齐原版 renderWorkspaceProjectFileRows 的呈现密度。
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
                    :disabled="!canEditVisibility(entry)"
                    @toggle="toggleVisibility(entry)"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { CloudFileItem } from '@/api/files-center'
    import {
        fileDisplayName,
        fileIconClass,
        fileToneClass,
        formatFileSize,
        isImageFile,
    } from '@/api/files-center'
    import type { WorkspaceDetail, WorkspaceFileEntry } from '@/api/workspaces'
    import { workspaceFileUrl } from '@/api/workspaces'

    import { fileTypeText, normalizeVisibility, sortPinnedFirst } from '../workspaceDisplay'
    import { useWorkspaceActions, type WorkspaceResourceRef } from '../workspaceContext'

    import WorkspaceVisibilitySwitch from '../WorkspaceVisibilitySwitch.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()

    const files = computed<WorkspaceFileEntry[]>(() => {
        const items = Array.isArray(props.workspace.workspace_files) ? props.workspace.workspace_files : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    /** 条目 → 文件中心工具函数所需的形状(仅取其读取的字段) */
    function asCloudFile(entry: WorkspaceFileEntry): CloudFileItem {
        return {
            alias: String(entry.alias || ''),
            original_name: String(entry.original_name || ''),
            title: String(entry.title || ''),
            source_ext: String(entry.source_ext || ''),
        }
    }

    function displayName(entry: WorkspaceFileEntry): string {
        return fileDisplayName(asCloudFile(entry))
    }

    function toneClass(entry: WorkspaceFileEntry): string {
        return fileToneClass(asCloudFile(entry))
    }

    function iconClass(entry: WorkspaceFileEntry): string {
        return fileIconClass(asCloudFile(entry))
    }

    /** 图片缩略图走项目下载接口内联(added_by 定位跨用户沙箱) */
    function thumbnailUrl(entry: WorkspaceFileEntry): string {
        if (!isImageFile(asCloudFile(entry))) {
            return ''
        }

        return workspaceFileUrl(String(props.workspace.workspace_id || ''), entry.file_ref, String(entry.added_by || ''), true)
    }

    /** 卡片元信息:大小 · 类型 */
    function metaText(entry: WorkspaceFileEntry): string {
        return [formatFileSize(Number(entry.size || 0)), fileTypeText(entry)].filter(Boolean).join(' · ')
    }

    function canEditVisibility(entry: WorkspaceFileEntry): boolean {
        const owner = String(entry.added_by || props.workspace.owner_username || '').trim()

        return owner === actions.currentUserId()
    }

    function resourceRef(entry: WorkspaceFileEntry): WorkspaceResourceRef {
        return {
            type: 'file',
            ref: entry.file_ref,
            addedBy: String(entry.added_by || ''),
            visibility: normalizeVisibility(entry.visibility),
        }
    }

    function toggleVisibility(entry: WorkspaceFileEntry): void {
        const next = normalizeVisibility(entry.visibility) === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(resourceRef(entry), next)
    }

    function openMenu(event: MouseEvent, entry: WorkspaceFileEntry): void {
        actions.openResourceMenu(event, resourceRef(entry))
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
        color: var(--color-text-secondary);
        font-size: 14px;
        padding: 18px 10px;
    }

    .ws-file-card {
        position: relative;
        min-width: 0;
        min-height: 158px;
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

    .ws-file-card-media {
        width: 54px;
        height: 54px;
        display: flex;
        align-items: center;
        justify-content: center;
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
        width: 44px;
        height: 44px;
        border-radius: 9px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
    }

    .ws-pin-icon {
        color: var(--color-text-primary);
        font-size: 11px;
        margin-right: 5px;
    }

    .ws-file-card-name {
        width: 100%;
        min-width: 0;
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
