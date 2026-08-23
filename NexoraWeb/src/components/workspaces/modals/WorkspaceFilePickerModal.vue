<!--
    WorkspaceFilePickerModal.vue — 添加已有云端文件弹窗

    搜索(回车/按钮触发)+ 文件列表(alias 标题,"大小 · 时间 · 原始名"元信息);
    已归入的文件标记"已加入"并禁用;点击未加入文件立即归入并关闭。
-->

<template>
    <Modal :open="open" title="添加云端文件" size="sm" @close="emit('close')">
        <div class="ws-picker-body">
            <div class="ws-picker-search">
                <input
                    v-model="query"
                    class="ws-picker-input"
                    type="search"
                    placeholder="搜索文件"
                    aria-label="搜索文件"
                    @keydown.enter="load"
                    @keydown.esc.prevent="emit('close')"
                >
                <Button variant="secondary" size="icon" icon="fa-solid fa-magnifying-glass" title="搜索" aria-label="搜索" @click="load" />
            </div>

            <div class="ws-picker-list">
                <div v-if="loading" class="ws-picker-state">加载中...</div>
                <div v-else-if="loadError" class="ws-picker-state">{{ loadError }}</div>
                <div v-else-if="!files.length" class="ws-picker-state">暂无云端文件,请先在文件中心上传</div>

                <button
                    v-for="file in files"
                    v-else
                    :key="fileRefOf(file)"
                    class="ws-picker-item"
                    :class="{ 'is-marked': isMarked(file) }"
                    type="button"
                    :aria-disabled="isMarked(file)"
                    @click="handlePick(file)"
                >
                    <span class="ws-picker-icon"><i :class="fileIconClass(file)" aria-hidden="true"></i></span>
                    <span class="ws-picker-main">
                        <span class="ws-picker-title">{{ fileDisplayName(file) }}</span>
                        <span class="ws-picker-meta">{{ metaText(file) }}</span>
                    </span>
                    <span class="ws-picker-state">{{ isMarked(file) ? '已加入' : '添加' }}</span>
                </button>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
    import { ref, watch } from 'vue'

    import type { CloudFileItem } from '@/api/files-center'
    import {
        fileDisplayName,
        fileIconClass,
        fileRef as cloudFileRef,
        formatFileSize,
        formatFileUpdatedAt,
        listFiles,
    } from '@/api/files-center'

    import Button from '@/ui/Button.vue'
    import Modal from '@/ui/Modal.vue'

    const props = defineProps<{
        open: boolean
        /** 已归入项目的 file_ref 集合 */
        markedRefs: string[]
    }>()

    const emit = defineEmits<{
        close: []
        pick: [file: CloudFileItem]
    }>()

    const query = ref('')
    const files = ref<CloudFileItem[]>([])
    const loading = ref(false)
    const loadError = ref('')

    function fileRefOf(file: CloudFileItem): string {
        return cloudFileRef(file)
    }

    function isMarked(file: CloudFileItem): boolean {
        return props.markedRefs.includes(fileRefOf(file))
    }

    function metaText(file: CloudFileItem): string {
        const original = String(file.original_name || '').trim()
        const alias = fileDisplayName(file)

        return [
            formatFileSize(Number(file.size || 0)),
            formatFileUpdatedAt(Number(file.updated_at || 0)),
            original && original !== alias ? original : '',
        ].filter(Boolean).join(' · ')
    }

    watch(
        () => props.open,
        (opened) => {
            if (!opened) {
                return
            }

            query.value = ''
            loadError.value = ''

            void load()
        },
        { immediate: true }
    )

    async function load(): Promise<void> {
        loading.value = true

        try {
            const data = await listFiles(query.value.trim())

            files.value = data.files
            loadError.value = ''
        } catch (error) {
            files.value = []
            loadError.value = error instanceof Error ? error.message : '文件列表读取失败'
        } finally {
            loading.value = false
        }
    }

    function handlePick(file: CloudFileItem): void {
        if (isMarked(file)) {
            return
        }

        emit('pick', file)
    }
</script>

<style scoped>
    .ws-picker-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .ws-picker-search {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 38px;
        align-items: center;
        gap: 10px;
    }

    .ws-picker-input {
        height: 38px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        padding: 0 12px;
        box-sizing: border-box;
        font: inherit;
        font-size: 13px;
        outline: none;
    }

    .ws-picker-input:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-picker-list {
        max-height: min(420px, 56vh);
        overflow: auto;
        display: grid;
        gap: 6px;
    }

    .ws-picker-state {
        color: var(--color-text-secondary);
        font-size: 12px;
        padding: 16px 8px;
    }

    .ws-picker-item {
        width: 100%;
        min-height: 54px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        font: inherit;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
    }

    .ws-picker-item:hover {
        background: var(--color-bg-sunken);
    }

    .ws-picker-item.is-marked {
        cursor: default;
        opacity: 0.68;
    }

    .ws-picker-icon {
        width: 32px;
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .ws-picker-main {
        min-width: 0;
        display: grid;
        gap: 3px;
    }

    .ws-picker-title,
    .ws-picker-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-picker-title {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
    }

    .ws-picker-meta {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ws-picker-state {
        color: var(--color-text-secondary);
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
    }
</style>
