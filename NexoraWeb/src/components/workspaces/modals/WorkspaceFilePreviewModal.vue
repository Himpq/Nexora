<!--
    WorkspaceFilePreviewModal.vue — Workspace 文件内置预览弹窗

    文本走项目 read 接口(支持跨用户共享文件),图片走项目 download 内联;
    底部提供下载。替代旧版借道文件中心详情的路径。
-->

<template>
    <Modal :open="open" title="文件预览" size="default" @close="emit('close')">
        <div class="ws-preview-meta">{{ metaText }}</div>
        <div class="ws-preview-content">
            <div v-if="loading" class="ws-preview-state">加载中...</div>
            <div v-else-if="loadError" class="ws-preview-state">{{ loadError }}</div>
            <template v-else-if="file">
                <img
                    v-if="isImage"
                    class="ws-preview-image"
                    :src="downloadUrl"
                    :alt="displayName"
                >
                <pre v-else-if="content" class="ws-preview-pre">{{ content }}</pre>
                <div v-else class="ws-preview-state">文件内容为空</div>
            </template>
        </div>

        <template #footer>
            <a class="ws-preview-download" :href="downloadUrl" :download="displayName">
                <i class="fa-solid fa-download" aria-hidden="true"></i>
                <span>下载</span>
            </a>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import {
        fileDisplayName,
        formatFileSize,
        isImageFile,
    } from '@/api/files-center'
    import type { WorkspaceFileEntry } from '@/api/workspaces'
    import { readWorkspaceFile, workspaceFileUrl } from '@/api/workspaces'

    import { toCloudFileItem } from '../workspaceResource'

    import Modal from '@/ui/Modal.vue'

    const props = defineProps<{
        open: boolean
        workspaceId: string
        file: WorkspaceFileEntry | null
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    const content = ref('')
    const loading = ref(false)
    const loadError = ref('')

    const displayName = computed(() => props.file ? fileDisplayName(toCloudFileItem(props.file)) : '')

    const isImage = computed(() => Boolean(props.file && isImageFile(toCloudFileItem(props.file))))

    const addedBy = computed(() => String(props.file?.added_by || ''))

    const downloadUrl = computed(() => workspaceFileUrl(
        props.workspaceId,
        String(props.file?.file_ref || ''),
        addedBy.value,
        true
    ))

    const metaText = computed(() => {
        if (!props.file) {
            return ''
        }

        const parts = [
            `大小:${formatFileSize(Number(props.file.size || 0))}`,
            String(props.file.updated_at || props.file.created_at || '').trim(),
        ]

        return parts.filter(Boolean).join(' · ')
    })

    watch(
        () => [props.open, props.file?.file_ref, addedBy.value] as const,
        ([opened]) => {
            if (!opened || !props.file) {
                content.value = ''
                loadError.value = ''

                return
            }

            if (isImage.value) {
                return
            }

            void loadContent()
        },
        { immediate: true }
    )

    async function loadContent(): Promise<void> {
        if (!props.file) {
            return
        }

        loading.value = true

        try {
            const data = await readWorkspaceFile(props.workspaceId, props.file.file_ref, addedBy.value)

            content.value = data.content
            loadError.value = ''
        } catch (error) {
            content.value = ''
            loadError.value = error instanceof Error ? error.message : '文件读取失败'
        } finally {
            loading.value = false
        }
    }
</script>

<style scoped>
    .ws-preview-meta {
        min-height: 20px;
        color: var(--color-text-secondary);
        font-size: 12px;
        margin-bottom: 10px;
    }

    .ws-preview-content {
        max-height: min(520px, 58vh);
        overflow: auto;
    }

    .ws-preview-state {
        color: var(--color-text-secondary);
        font-size: 13px;
        padding: 12px 2px;
    }

    .ws-preview-image {
        max-width: 100%;
        display: block;
        margin: 0 auto;
    }

    .ws-preview-pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--color-text-primary);
        font-size: 13px;
        line-height: 1.6;
    }

    .ws-preview-download {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: var(--gddp-control-height);
        padding: 0 16px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--gddp-border-radius);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
    }

    .ws-preview-download:hover {
        background: var(--color-bg-sunken);
    }
</style>
